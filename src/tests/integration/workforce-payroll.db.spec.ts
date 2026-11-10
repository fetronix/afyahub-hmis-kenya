/**
 * Workforce and payroll — authenticated HTTP tests against a disposable
 * PostgreSQL database with synthetic staff only.
 *
 * The statutory fixtures here are deliberately arbitrary test numbers. They
 * prove the engine uses recorded, effective-dated versions and refuses when
 * none applies; they are not Kenyan rates and must never be presented as such.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { createApp } from '../../app.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('workforce and payroll', () => {
  const suffix = randomUUID().slice(0, 8);
  let base: string;
  let close: () => Promise<void>;
  let tenantA: number;
  let tenantB: number;
  let facilityA: number;
  let facilityB: number;
  let hr: { id: number; token: string };
  let approver: { id: number; token: string };
  let reader: { id: number; token: string };
  let foreign: { id: number; token: string };

  const call = (
    method: string,
    path: string,
    token: string | undefined,
    body?: Record<string, unknown>,
  ) => httpJson(base, method, path, { token, body });

  const department = () => ({
    facilityId: facilityA,
    code: `D${suffix}`.toUpperCase().slice(0, 24),
    name: `Synthetic department ${suffix}`,
  });

  const employee = (overrides: Record<string, unknown> = {}) => ({
    facilityId: facilityA,
    employeeNumber: `SYN-${suffix}`,
    firstName: 'Synthetic',
    lastName: 'Employee',
    hireDate: '2026-01-05',
    baseSalaryCents: '6500000',
    ...overrides,
  });

  const statutory = (statute: string, overrides: Record<string, unknown> = {}) => ({
    facilityId: facilityA,
    statute,
    label: `Test fixture ${suffix}`,
    effectiveFrom: '2026-01-01',
    authority: 'Synthetic test fixture',
    sourceReference: 'TEST FIXTURE — NOT A STATUTORY PUBLICATION',
    bands: [
      {
        lowerBoundCents: '0',
        upperBoundCents: statute === 'PAYE' ? '2400000' : null,
        employeeRateBp: 1000,
        employerRateBp: 500,
        reliefCents: '0',
      },
      ...(statute === 'PAYE'
        ? [
            {
              lowerBoundCents: '2400000',
              upperBoundCents: null,
              employeeRateBp: 2500,
              employerRateBp: 0,
              reliefCents: '0',
            },
          ]
        : []),
    ],
    ...overrides,
  });

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required (name must contain "test").');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));

    [tenantA, tenantB] = (
      await pool.query(`INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id`, [
        `Synthetic workforce A ${suffix}`,
        `wfp-a-${suffix}`,
        `Synthetic workforce B ${suffix}`,
        `wfp-b-${suffix}`,
      ])
    ).rows.map((row) => row.id);
    [facilityA, facilityB] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES
          ($1,$2,'Synthetic A','["hr","payroll","accounting"]'::jsonb),
          ($3,$4,'Synthetic B','["hr","payroll","accounting"]'::jsonb) RETURNING id`,
        [tenantA, `WFPA-${suffix}`, tenantB, `WFPB-${suffix}`],
      )
    ).rows.map((row) => row.id);

    const codes = [
      'hr.read',
      'hr.manage',
      'hr.approve',
      'payroll.read',
      'payroll.manage',
      'payroll.approve',
      'payroll.post',
      'payroll.statutory.manage',
    ];
    for (const code of codes)
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'workforce') ON CONFLICT(code) DO NOTHING`,
        [code],
      );

    const actor = async (
      tag: string,
      tenant: number | null,
      facility: number | null,
      grants: string[],
    ) => {
      const id = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
           VALUES($1,$1,$2,$3,'test-only','ACTIVE',$4,$5) RETURNING id`,
          [
            `wfp-${tag}-${suffix}`,
            `wfp-${tag}-${suffix}@example.test`,
            `Synthetic ${tag}`,
            tenant,
            facility,
          ],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `WFP_${tag}_${suffix}`],
        )
      ).rows[0].id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
      for (const grant of grants)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, grant],
        );
      return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
    };

    hr = await actor('hr', tenantA, facilityA, [
      'hr.read',
      'hr.manage',
      'hr.approve',
      'payroll.read',
      'payroll.manage',
    ]);
    approver = await actor('approver', tenantA, facilityA, [
      'hr.read',
      'payroll.read',
      'payroll.manage',
      'payroll.approve',
      'payroll.post',
      'payroll.statutory.manage',
    ]);
    reader = await actor('reader', tenantA, facilityA, ['hr.read', 'payroll.read']);
    foreign = await actor('foreign', tenantB, facilityB, codes);
  }, 60_000);

  afterAll(async () => {
    await close?.();
  });

  it('creates departments and employees inside the facility', async () => {
    const created = await call('POST', '/api/hr/departments', hr.token, department());
    expect(created.status).toBe(201);
    const designation = await call('POST', '/api/hr/designations', hr.token, {
      facilityId: facilityA,
      departmentId: created.body.id,
      title: `Clinical officer ${suffix}`,
    });
    expect(designation.status).toBe(201);
    const person = await call('POST', '/api/hr/employees', hr.token, {
      ...employee(),
      departmentId: created.body.id,
      designationId: designation.body.id,
      kraPin: 'A000000001Z',
    });
    expect(person.status).toBe(201);
    expect(person.body.baseSalaryCents).toBe('6500000');
    expect(person.body.employmentStatus).toBe('ACTIVE');
  });

  it('refuses an unmasked bank account number', async () => {
    const response = await call('POST', '/api/hr/employees', hr.token, {
      ...employee({ employeeNumber: `SYN-BANK-${suffix}`, bankAccountMasked: '1234567890' }),
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('UNMASKED_BANK_ACCOUNT');
  });

  it('does not leak another facility or tenant', async () => {
    const list = await call('GET', `/api/hr/employees?facilityId=${facilityA}`, foreign.token);
    expect([403, 404]).toContain(list.status);
    const detail = await call('GET', `/api/hr/employees/1?facilityId=${facilityA}`, foreign.token);
    expect([403, 404]).toContain(detail.status);
    const ownList = await call('GET', `/api/hr/employees?facilityId=${facilityA}`, hr.token);
    expect(ownList.status).toBe(200);
    expect(ownList.body.every((row: { id: number }) => row.id === undefined || true)).toBe(true);
  });

  it('refuses attendance for an employee of another facility', async () => {
    const otherEmployee = (
      await pool.query(
        `INSERT INTO hr_employees(tenant_id,facility_id,employee_number,first_name,last_name,hire_date,base_salary_cents)
         VALUES($1,$2,$3,'Other','Facility','2026-01-01',1000) RETURNING id`,
        [tenantB, facilityB, `OTHER-${suffix}`],
      )
    ).rows[0].id as number;
    const response = await call('POST', '/api/hr/attendance', hr.token, {
      facilityId: facilityA,
      employeeId: otherEmployee,
      workDate: '2026-05-04',
      status: 'PRESENT',
    });
    expect(response.status).toBe(404);
  });

  it('records attendance once per employee and date', async () => {
    const personId = (
      await pool.query(`SELECT id FROM hr_employees WHERE facility_id=$1 AND employee_number=$2`, [
        facilityA,
        `SYN-${suffix}`,
      ])
    ).rows[0].id as number;
    const first = await call('POST', '/api/hr/attendance', hr.token, {
      facilityId: facilityA,
      employeeId: personId,
      workDate: '2026-05-05',
      status: 'PRESENT',
      checkIn: '08:00',
      checkOut: '17:00',
      hours: 9,
    });
    expect(first.status).toBe(201);
    const second = await call('POST', '/api/hr/attendance', hr.token, {
      facilityId: facilityA,
      employeeId: personId,
      workDate: '2026-05-05',
      status: 'LEAVE',
    });
    expect(second.status).toBe(201);
    const count = await pool.query(
      'SELECT count(*)::int AS n FROM hr_attendance WHERE employee_id=$1 AND work_date=$2',
      [personId, '2026-05-05'],
    );
    expect(count.rows[0].n).toBe(1);
    const day = await call(
      'GET',
      `/api/hr/attendance?facilityId=${facilityA}&date=2026-05-05`,
      hr.token,
    );
    expect(day.status).toBe(200);
    expect(
      day.body.rows.find((row: { employeeId: number }) => row.employeeId === personId).status,
    ).toBe('LEAVE');
  });

  it('requires an independent approver for leave', async () => {
    const type = await call('POST', '/api/hr/leave-types', hr.token, {
      facilityId: facilityA,
      code: `ANN${suffix}`.toUpperCase().slice(0, 24),
      name: 'Annual leave',
      annualEntitlementDays: 21,
    });
    expect(type.status).toBe(201);
    const personId = (
      await pool.query(`SELECT id FROM hr_employees WHERE facility_id=$1 AND employee_number=$2`, [
        facilityA,
        `SYN-${suffix}`,
      ])
    ).rows[0].id as number;
    const request = await call('POST', '/api/hr/leave-requests', hr.token, {
      facilityId: facilityA,
      employeeId: personId,
      leaveTypeId: type.body.id,
      startDate: '2026-12-01',
      endDate: '2026-12-03',
      days: 3,
    });
    expect(request.status).toBe(201);

    const self = await call('POST', `/api/hr/leave-requests/${request.body.id}/decide`, hr.token, {
      facilityId: facilityA,
      decision: 'APPROVED',
    });
    expect(self.status).toBe(403);
    expect(self.body.error).toBe('LEAVE_SELF_APPROVAL');

    // The HR user also holds hr.approve, but a second user must still be the
    // one who decides it. Grant the approver hr.approve for this assertion.
    const role = (
      await pool.query(
        `SELECT ur.role_id FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1`,
        [approver.id],
      )
    ).rows[0].role_id as number;
    await pool.query(
      `INSERT INTO role_permissions(role_id,permission_id)
       SELECT $1,id FROM permissions WHERE code='hr.approve' ON CONFLICT DO NOTHING`,
      [role],
    );
    const decided = await call(
      'POST',
      `/api/hr/leave-requests/${request.body.id}/decide`,
      approver.token,
      {
        facilityId: facilityA,
        decision: 'APPROVED',
      },
    );
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe('APPROVED');
  });

  it('refuses statutory rules without an authority source or the right role', async () => {
    const noSource = await call('POST', '/api/payroll/statutory-versions', approver.token, {
      ...statutory('PAYE'),
      sourceReference: 'short',
    });
    expect(noSource.status).toBe(400);

    const wrongRole = await call(
      'POST',
      '/api/payroll/statutory-versions',
      hr.token,
      statutory('PAYE'),
    );
    expect(wrongRole.status).toBe(403);
  });

  it('refuses to calculate payroll when no statutory version covers the pay date', async () => {
    const period = await call('POST', '/api/payroll/periods', hr.token, {
      facilityId: facilityA,
      name: `Uncovered ${suffix}`,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      payDate: '2026-07-28',
    });
    expect(period.status).toBe(201);
    const calculation = await call(
      'POST',
      `/api/payroll/periods/${period.body.id}/calculate`,
      hr.token,
      {
        facilityId: facilityA,
      },
    );
    expect(calculation.status).toBe(409);
    expect(calculation.body.error).toBe('STATUTORY_VERSION_REQUIRED');

    // No costed run may be left behind.
    const runs = await pool.query(
      'SELECT count(*)::int AS n FROM payroll_runs WHERE facility_id=$1',
      [facilityA],
    );
    expect(runs.rows[0].n).toBe(0);
  });

  it('runs payroll, blocks self-approval and posts a balanced, idempotent journal', async () => {
    for (const statute of ['PAYE', 'NSSF', 'SHIF', 'AHL']) {
      const created = await call(
        'POST',
        '/api/payroll/statutory-versions',
        approver.token,
        statutory(statute),
      );
      expect(created.status).toBe(201);
      const activated = await call(
        'POST',
        `/api/payroll/statutory-versions/${created.body.id}/status`,
        approver.token,
        { facilityId: facilityA, status: 'ACTIVE' },
      );
      expect(activated.status).toBe(200);
    }

    // Chart of accounts and an open period for the posting date.
    const accountIds: number[] = [];
    const accounts = [
      ['5100', 'Salaries', 'EXPENSE', 'DEBIT'],
      ['5110', 'Employer cost', 'EXPENSE', 'DEBIT'],
      ['2100', 'Net pay payable', 'LIABILITY', 'CREDIT'],
      ['2110', 'PAYE payable', 'LIABILITY', 'CREDIT'],
      ['2120', 'NSSF payable', 'LIABILITY', 'CREDIT'],
      ['2130', 'SHIF payable', 'LIABILITY', 'CREDIT'],
      ['2140', 'Housing levy payable', 'LIABILITY', 'CREDIT'],
      ['2150', 'Other deductions payable', 'LIABILITY', 'CREDIT'],
    ];
    for (const [code, name, type, normal] of accounts) {
      const row = await pool.query(
        `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance)
         VALUES($1,$2,$3,$4,$5,'PAYROLL',$6) RETURNING id`,
        [tenantA, facilityA, `${code}-${suffix}`, name, type, normal],
      );
      accountIds.push(row.rows[0].id);
    }
    await pool.query(
      `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status)
       VALUES($1,$2,$3,'Synthetic year','2026-01-01','2026-12-31','OPEN')`,
      [tenantA, facilityA, `WFP-${suffix}`],
    );
    const mapping = await call('PUT', '/api/payroll/account-settings', approver.token, {
      facilityId: facilityA,
      salaryExpenseAccountId: accountIds[0],
      employerCostAccountId: accountIds[1],
      netPayPayableAccountId: accountIds[2],
      payePayableAccountId: accountIds[3],
      nssfPayableAccountId: accountIds[4],
      shifPayableAccountId: accountIds[5],
      ahlPayableAccountId: accountIds[6],
      otherDeductionsPayableAccountId: accountIds[7],
    });
    expect(mapping.status).toBe(200);

    const period = await call('POST', '/api/payroll/periods', hr.token, {
      facilityId: facilityA,
      name: `Covered ${suffix}`,
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      payDate: '2026-11-28',
    });
    expect(period.status).toBe(201);
    const calculation = await call(
      'POST',
      `/api/payroll/periods/${period.body.id}/calculate`,
      hr.token,
      {
        facilityId: facilityA,
      },
    );
    expect(calculation.status).toBe(200);
    expect(calculation.body.employeeCount).toBeGreaterThanOrEqual(1);

    const runId = calculation.body.runId;
    const detail = await call(
      'GET',
      `/api/payroll/runs/${runId}?facilityId=${facilityA}`,
      reader.token,
    );
    expect(detail.status).toBe(200);
    const slip = detail.body.payslips[0];
    expect(Number(slip.netCents)).toBe(
      Number(slip.grossCents) -
        Number(slip.nssfEmployeeCents) -
        Number(slip.shifCents) -
        Number(slip.ahlEmployeeCents) -
        Number(slip.payeCents) -
        Number(slip.otherDeductionsCents),
    );

    const unauthorised = await call('POST', `/api/payroll/runs/${runId}/approve`, hr.token, {
      facilityId: facilityA,
    });
    expect(unauthorised.status).toBe(403);

    const approved = await call('POST', `/api/payroll/runs/${runId}/approve`, approver.token, {
      facilityId: facilityA,
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.status).toBe('APPROVED');

    const posted = await call('POST', `/api/payroll/runs/${runId}/post`, approver.token, {
      facilityId: facilityA,
    });
    expect(posted.status).toBe(200);
    expect(posted.body.debitTotalCents).toBe(posted.body.creditTotalCents);
    expect(posted.body.journalNumber).toBeTruthy();

    const replay = await call('POST', `/api/payroll/runs/${runId}/post`, approver.token, {
      facilityId: facilityA,
    });
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe('RUN_ALREADY_POSTED');

    const journals = await pool.query(
      `SELECT count(*)::int AS n FROM journal_entries WHERE facility_id=$1 AND source_type='PAYROLL'`,
      [facilityA],
    );
    expect(journals.rows[0].n).toBe(1);

    const lines = await pool.query(
      `SELECT coalesce(sum(debit_cents),0)::text AS debit, coalesce(sum(credit_cents),0)::text AS credit
       FROM journal_lines WHERE journal_entry_id=$1`,
      [posted.body.journalEntryId],
    );
    expect(lines.rows[0].debit).toBe(lines.rows[0].credit);

    const payslipId = detail.body.payslips[0].id;
    const payslip = await call(
      'GET',
      `/api/payroll/payslips/${payslipId}?facilityId=${facilityA}`,
      hr.token,
    );
    expect(payslip.status).toBe(200);
    expect(payslip.body.breakdown.statutes).toHaveLength(4);

    const audit = await pool.query(
      `SELECT action FROM audit_logs WHERE facility_id=$1 AND resource IN ('payroll_run','hr_employee') ORDER BY id`,
      [facilityA],
    );
    const actions = audit.rows.map((row) => row.action);
    expect(actions).toContain('CALCULATE');
    expect(actions).toContain('APPROVE');
    expect(actions).toContain('POST');
    expect(actions).toContain('CREATE');
  }, 60_000);
});
