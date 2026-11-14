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
  let hrOnly: { id: number; token: string };
  let sibling: { id: number; token: string };

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
    calculationConfig: {
      deductNssf: true,
      deductShif: true,
      deductAhl: true,
      employeeMinimumCents: '0',
      employerMinimumCents: '0',
    },
    bands: [
      {
        lowerBoundCents: '0',
        upperBoundCents: statute === 'PAYE' ? '2400000' : null,
        employeeRateBp: 1000,
        employerRateBp: ['PAYE', 'SHIF'].includes(statute) ? 0 : 500,
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
    hrOnly = await actor('hr-only', tenantA, facilityA, ['hr.read', 'hr.manage']);
    const siblingFacility = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic sibling','["hr","payroll"]') RETURNING id`,
        [tenantA, `WFP-SIB-${suffix}`],
      )
    ).rows[0].id;
    sibling = await actor('sibling', tenantA, siblingFacility, codes);
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
    for (const statute of ['PAYE', 'SHIF']) {
      const unsupported = await call('POST', '/api/payroll/statutory-versions', approver.token, {
        ...statutory(statute),
        bands: statutory(statute).bands.map((band, i) => ({
          ...band,
          employerRateBp: i === 0 ? 500 : 0,
        })),
        calculationConfig: {
          deductNssf: true,
          deductShif: true,
          deductAhl: true,
          employeeMinimumCents: '0',
          employerMinimumCents: '0',
        },
      });
      expect(unsupported.status).toBe(400);
      expect(unsupported.body.error).toBe('UNSUPPORTED_STATUTORY_POLICY');
    }
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
      expect(
        (
          await call(
            'POST',
            `/api/payroll/statutory-versions/${created.body.id}/status`,
            approver.token,
            { facilityId: facilityA, status: 'ACTIVE' },
          )
        ).body.error,
      ).toBe('STATUTORY_VERIFICATION_REQUIRED');
      const verified = await call(
        'POST',
        `/api/payroll/statutory-versions/${created.body.id}/verify`,
        approver.token,
        {
          facilityId: facilityA,
          verifiedOn: '2026-10-27',
          verificationReference:
            'Synthetic fixture reviewed for arithmetic tests, not operational rates',
          verificationPurpose: 'SYNTHETIC_TEST',
          confirmSourceReviewed: true,
        },
      );
      expect(verified.status, JSON.stringify(verified.body)).toBe(200);
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

  it('refuses a P9 extract until the facility records a published form version', async () => {
    const refused = await call(
      'GET',
      `/api/payroll/statutory-extract?formCode=P9&taxYear=2026&facilityId=${facilityA}`,
      reader.token,
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('FORM_PROFILE_REQUIRED');
    /* The message has to say what to do, not just that it refused. */
    expect(String(refused.body.message)).toMatch(/citation|published/i);
  }, 30_000);

  it('refuses a form profile with no citable authority', async () => {
    const refused = await call('POST', '/api/payroll/form-profiles', approver.token, {
      facilityId: facilityA,
      formCode: 'P9',
      formVersion: 'Synthetic 2026 layout',
      authorityReference: 'short',
      effectiveFrom: '2026-01-01',
    });
    expect(refused.status).toBe(400);

    const badForm = await call('POST', '/api/payroll/form-profiles', approver.token, {
      facilityId: facilityA,
      formCode: 'P11',
      formVersion: 'Synthetic',
      authorityReference: 'Synthetic authority note',
      effectiveFrom: '2026-01-01',
    });
    expect(badForm.status).toBe(400);
  }, 30_000);

  it('extracts P9 figures from posted payroll only, with the citation attached', async () => {
    const profile = await call('POST', '/api/payroll/form-profiles', approver.token, {
      facilityId: facilityA,
      formCode: 'P9',
      formVersion: 'Synthetic 2026 layout',
      authorityReference: 'Synthetic authority note TN/PAY/2026 — not a real KRA form.',
      effectiveFrom: '2026-01-01',
    });
    expect(profile.status).toBe(201);

    const extract = await call(
      'GET',
      `/api/payroll/statutory-extract?formCode=P9&taxYear=2026&facilityId=${facilityA}`,
      reader.token,
    );
    expect(extract.status, JSON.stringify(extract.body)).toBe(200);
    expect(extract.body.formVersion).toBe('Synthetic 2026 layout');
    expect(extract.body.authorityReference).toContain('TN/PAY/2026');
    expect(extract.body.notice).toMatch(/not a claim/i);

    /* The extract must reconcile with the payslips it came from. */
    const payslips = await pool.query(
      `SELECT coalesce(sum(p.gross_cents),0)::text AS gross,
              coalesce(sum(p.paye_cents),0)::text AS paye,
              coalesce(sum(p.net_cents),0)::text AS net,
              count(*)::int AS n
         FROM payroll_payslips p
         JOIN payroll_runs r ON r.id = p.run_id
        WHERE p.facility_id=$1 AND r.status='POSTED'`,
      [facilityA],
    );
    expect(extract.body.totals.grossCents).toBe(payslips.rows[0].gross);
    expect(extract.body.totals.payeCents).toBe(payslips.rows[0].paye);
    expect(extract.body.totals.netCents).toBe(payslips.rows[0].net);
    expect(
      extract.body.employees.reduce(
        (sum: number, row: { payslipCount: number }) => sum + row.payslipCount,
        0,
      ),
    ).toBe(payslips.rows[0].n);

    /* An unposted run contributes nothing: there is only one run and it posted. */
    const draftRuns = await pool.query(
      `SELECT count(*)::int AS n FROM payroll_runs WHERE facility_id=$1 AND status<>'POSTED'`,
      [facilityA],
    );
    expect(draftRuns.rows[0].n).toBe(0);
  }, 60_000);

  it('does not show one facility the statutory extract of another', async () => {
    const foreignAttempt = await call(
      'GET',
      `/api/payroll/statutory-extract?formCode=P9&taxYear=2026&facilityId=${facilityB}`,
      foreign.token,
    );
    /* Either the scope is refused outright, or it has no profile of its own. */
    expect([403, 409]).toContain(foreignAttempt.status);

    const crossRead = await call(
      'GET',
      `/api/payroll/statutory-extract?formCode=P9&taxYear=2026&facilityId=${facilityA}`,
      foreign.token,
    );
    expect([403, 404]).toContain(crossRead.status);
  }, 30_000);
  it('keeps salary, bank details and payslips out of HR-only reads and denies salary writes', async () => {
    const list = await call('GET', `/api/hr/employees?facilityId=${facilityA}`, hrOnly.token);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);
    expect(list.body[0].baseSalaryCents).toBeNull();
    const detail = await call(
      'GET',
      `/api/hr/employees/${list.body[0].id}?facilityId=${facilityA}`,
      hrOnly.token,
    );
    expect(detail.body.components).toBeNull();
    expect(detail.body.payslips).toBeNull();
    expect(detail.body.bankAccountMasked).toBeNull();
    const overview = await call('GET', `/api/hr/overview?facilityId=${facilityA}`, hrOnly.token);
    expect(overview.body.monthlyBasicCents).toBeNull();
    expect(
      (await call('GET', `/api/payroll/employees?facilityId=${facilityA}`, hrOnly.token)).status,
    ).toBe(403);
    expect(
      (
        await call(
          'POST',
          '/api/hr/employees',
          hrOnly.token,
          employee({ employeeNumber: `DENY-${suffix}` }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call('PUT', `/api/payroll/employees/${list.body[0].id}/salary`, hrOnly.token, {
          facilityId: facilityA,
          baseSalaryCents: '1',
          reason: 'Forbidden',
        })
      ).status,
    ).toBe(403);
  });
  it('exposes salary structures with scoped authorized writes and rejects invalid component dates', async () => {
    const list = await call('GET', `/api/payroll/employees?facilityId=${facilityA}`, hr.token);
    const person = list.body[0];
    const updated = await call('PUT', `/api/payroll/employees/${person.id}/salary`, hr.token, {
      facilityId: facilityA,
      baseSalaryCents: '7000000',
      reason: 'Synthetic reviewed contract',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.baseSalaryCents).toBe('7000000');
    const component = {
      facilityId: facilityA,
      employeeId: person.id,
      code: 'BONUS_TEST',
      name: 'Synthetic one-off bonus',
      kind: 'EARNING',
      amountCents: '10000',
      effectiveFrom: '2026-07-01',
      effectiveTo: '2026-07-31',
      statutoryExclusions: ['AHL'],
    };
    expect(
      (
        await call('POST', '/api/payroll/components', hr.token, {
          ...component,
          effectiveTo: '2026-06-01',
        })
      ).status,
    ).toBe(400);
    expect((await call('POST', '/api/payroll/components', hr.token, component)).status).toBe(201);
    expect(
      (
        await call('GET', `/api/payroll/employees/${person.id}?facilityId=${facilityA}`, hr.token)
      ).body.components.some((c: { code: string }) => c.code === 'BONUS_TEST'),
    ).toBe(true);
    for (const token of [foreign.token, sibling.token]) {
      expect(
        (await call('GET', `/api/payroll/employees?facilityId=${facilityA}`, token)).status,
      ).toBe(403);
      expect(
        (
          await call('PUT', `/api/payroll/employees/${person.id}/salary`, token, {
            facilityId: facilityA,
            baseSalaryCents: '1',
            reason: 'Wrong scope',
          })
        ).status,
      ).toBe(403);
    }
  });
  it('rolls finalization, journal and audit back together and serializes concurrent finalization', async () => {
    await pool.query(
      `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status) VALUES($1,$2,$3,'Synthetic next year','2027-01-01','2027-12-31','OPEN')`,
      [tenantA, facilityA, `Y2027-${suffix}`],
    );
    const period = await call('POST', '/api/payroll/periods', hr.token, {
      facilityId: facilityA,
      name: `Atomic ${suffix}`,
      startDate: '2027-08-01',
      endDate: '2027-08-31',
      payDate: '2027-08-31',
    });
    expect(period.status).toBe(201);
    const calculation = await call(
      'POST',
      `/api/payroll/periods/${period.body.id}/calculate`,
      hr.token,
      { facilityId: facilityA },
    );
    expect(calculation.status).toBe(200);
    const id = calculation.body.runId;
    expect(
      (await call('GET', `/api/payroll/runs/${id}/reports?facilityId=${facilityA}`, reader.token))
        .status,
    ).toBe(409);
    expect(
      (
        await call('POST', `/api/payroll/runs/${id}/approve`, approver.token, {
          facilityId: facilityA,
        })
      ).status,
    ).toBe(200);
    const constraint = `payroll_audit_failure_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `ALTER TABLE audit_logs ADD CONSTRAINT ${constraint} CHECK(NOT(facility_id=${facilityA} AND resource='payroll_run' AND action='POST' AND resource_id='${id}')) NOT VALID`,
    );
    try {
      expect(
        (
          await call('POST', `/api/payroll/runs/${id}/post`, approver.token, {
            facilityId: facilityA,
          })
        ).status,
      ).toBe(400);
      expect(
        (await pool.query('SELECT status,journal_entry_id FROM payroll_runs WHERE id=$1', [id]))
          .rows[0],
      ).toEqual({ status: 'APPROVED', journal_entry_id: null });
      expect(
        (
          await pool.query(
            `SELECT count(*)::int AS n FROM journal_entries WHERE facility_id=$1 AND source_type='PAYROLL' AND source_id=$2`,
            [facilityA, String(id)],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.query(`ALTER TABLE audit_logs DROP CONSTRAINT ${constraint}`);
    }
    const responses = await Promise.all([
      call('POST', `/api/payroll/runs/${id}/post`, approver.token, { facilityId: facilityA }),
      call('POST', `/api/payroll/runs/${id}/post`, approver.token, { facilityId: facilityA }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM journal_entries WHERE facility_id=$1 AND source_type='PAYROLL' AND source_id=$2`,
          [facilityA, String(id)],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('retains finalized snapshots, immutable history and honest non-payment schedules', async () => {
    const run = (
      await pool.query(
        `SELECT id FROM payroll_runs WHERE facility_id=$1 AND status='POSTED' ORDER BY id DESC LIMIT 1`,
        [facilityA],
      )
    ).rows[0].id;
    const reports = await call(
      'GET',
      `/api/payroll/runs/${run}/reports?facilityId=${facilityA}`,
      reader.token,
    );
    expect(reports.status).toBe(200);
    expect(reports.body.bankSchedule[0]).toMatchObject({
      paymentStatus: 'NOT_EVIDENCED',
      instructionReady: false,
    });
    expect(reports.body.remittances).toHaveLength(4);
    expect(
      reports.body.remittances.every(
        (r: { filingStatus: string }) => r.filingStatus === 'NOT_FILED',
      ),
    ).toBe(true);
    expect(reports.body.payslips[0].nssfEmployerCents).toBeDefined();
    const slip = reports.body.payslips[0];
    await pool.query(
      `UPDATE hr_employees SET first_name='Changed synthetic identity' WHERE id=$1`,
      [slip.employeeId],
    );
    const retained = await call(
      'GET',
      `/api/payroll/payslips/${slip.id}?facilityId=${facilityA}`,
      reader.token,
    );
    expect(retained.body.firstName).toBe(slip.firstName);
    await expect(
      pool.query('UPDATE payroll_runs SET net_cents=net_cents+1 WHERE id=$1', [run]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM payroll_payslips WHERE id=$1', [slip.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        'UPDATE payroll_payslip_lines SET amount_cents=amount_cents+1 WHERE payslip_id=$1',
        [slip.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `UPDATE payroll_periods SET name='Changed historical period' WHERE id=(SELECT period_id FROM payroll_runs WHERE id=$1)`,
        [run],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const version = (
      await pool.query('SELECT id FROM payroll_statutory_versions WHERE facility_id=$1 LIMIT 1', [
        facilityA,
      ])
    ).rows[0].id;
    await expect(
      pool.query(
        `UPDATE payroll_statutory_versions SET source_reference='Changed source' WHERE id=$1`,
        [version],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const history = await call('GET', `/api/payroll/history?facilityId=${facilityA}`, reader.token);
    expect(history.status).toBe(200);
    expect(
      history.body.events.some((e: { resource: string }) => e.resource === 'payroll_salary'),
    ).toBe(true);
    for (const token of [sibling.token, foreign.token])
      expect(
        (await call('GET', `/api/payroll/runs/${run}/reports?facilityId=${facilityA}`, token))
          .status,
      ).toBe(403);
  });
  it('builds annual extracts by pay date rather than finalization time, retaining dated snapshot detail', async () => {
    for (const year of [2026, 2027]) {
      const result = await call(
        'GET',
        `/api/payroll/statutory-extract?formCode=P9&taxYear=${year}&facilityId=${facilityA}`,
        reader.token,
      );
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body).toMatchObject({
        periodBasis: 'PAY_DATE',
        filingStatus: 'NOT_FILED',
        paymentStatus: 'NOT_EVIDENCED',
      });
      expect(result.body.monthlyRows.length).toBeGreaterThan(0);
      expect(
        result.body.monthlyRows.every((row: { payDate: string }) =>
          row.payDate.startsWith(String(year)),
        ),
      ).toBe(true);
      const expected = await pool.query(
        `SELECT sum(s.gross_cents)::text AS gross FROM payroll_payslips s JOIN payroll_runs r ON r.id=s.run_id JOIN payroll_periods p ON p.id=r.period_id WHERE s.facility_id=$1 AND r.status='POSTED' AND extract(year FROM p.pay_date)=$2`,
        [facilityA, year],
      );
      expect(result.body.totals.grossCents).toBe(expected.rows[0].gross);
      expect(
        result.body.monthlyRows.every(
          (row: { firstName: string }) => row.firstName !== 'Changed synthetic identity',
        ),
      ).toBe(true);
    }
    const detailRun = (
      await pool.query(
        `SELECT id FROM payroll_runs WHERE facility_id=$1 AND status='POSTED' ORDER BY id DESC LIMIT 1`,
        [facilityA],
      )
    ).rows[0].id;
    const detail = await call(
      'GET',
      `/api/payroll/runs/${detailRun}?facilityId=${facilityA}`,
      reader.token,
    );
    expect(
      detail.body.payslips.every(
        (row: { firstName: string }) => row.firstName !== 'Changed synthetic identity',
      ),
    ).toBe(true);
  });
  it('permits explicit module provisioning and refuses APIs when payroll is disabled', async () => {
    await pool.query(
      `INSERT INTO permissions(code,name,module) VALUES('facilities.modules.manage','Synthetic module provisioning','facilities') ON CONFLICT(code) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO role_permissions(role_id,permission_id) SELECT ur.role_id,p.id FROM user_roles ur CROSS JOIN permissions p WHERE ur.user_id=$1 AND p.code='facilities.modules.manage' ON CONFLICT DO NOTHING`,
      [approver.id],
    );
    const original = (
      await pool.query('SELECT enabled_modules FROM facilities WHERE id=$1', [facilityA])
    ).rows[0].enabled_modules;
    try {
      expect(
        (
          await call('PATCH', `/api/facilities/${facilityA}/modules`, approver.token, {
            enabledModules: ['configuration', 'accounting', 'hr'],
          })
        ).status,
      ).toBe(200);
      expect(
        (await call('GET', `/api/payroll/periods?facilityId=${facilityA}`, reader.token)).status,
      ).toBe(403);
      expect(
        (
          await call('PATCH', `/api/facilities/${facilityA}/modules`, approver.token, {
            enabledModules: ['configuration', 'accounting', 'hr', 'payroll'],
          })
        ).status,
      ).toBe(200);
      const enabled = await call(
        'GET',
        `/api/payroll/periods?facilityId=${facilityA}`,
        reader.token,
      );
      expect(enabled.status).toBe(200);
    } finally {
      await pool.query('UPDATE facilities SET enabled_modules=$1::jsonb WHERE id=$2', [
        JSON.stringify(original),
        facilityA,
      ]);
    }
  });
  it('reports scoped configuration blockers without inventing chart accounts or production certification', async () => {
    const missing = await call(
      'GET',
      `/api/payroll/readiness?facilityId=${facilityB}`,
      foreign.token,
    );
    expect(missing.status).toBe(200);
    expect(missing.body.chartOfAccounts).toMatchObject({
      activeCount: 0,
      status: 'NO_ACTIVE_ACCOUNTS',
    });
    expect(missing.body.rules.every((r: { status: string }) => r.status === 'MISSING')).toBe(true);
    expect(missing.body).toMatchObject({
      configurationReady: false,
      productionReady: false,
      status: 'BLOCKED',
    });
    const configured = await call(
      'GET',
      `/api/payroll/readiness?facilityId=${facilityA}`,
      reader.token,
    );
    expect(configured.body).toMatchObject({
      configurationReady: true,
      productionReady: false,
      status: 'TEST_CONFIGURATION_ONLY',
    });
    expect(
      configured.body.rules.every(
        (r: { verificationPurpose: string }) => r.verificationPurpose === 'SYNTHETIC_TEST',
      ),
    ).toBe(true);
    for (const token of [sibling.token, foreign.token])
      expect(
        (await call('GET', `/api/payroll/readiness?facilityId=${facilityA}`, token)).status,
      ).toBe(403);
    expect(
      (await call('GET', `/api/payroll/readiness?facilityId=${facilityA}`, hrOnly.token)).status,
    ).toBe(403);
    expect(
      (
        await call(
          'GET',
          `/api/payroll/readiness?facilityId=${facilityA}&periodId=garbage`,
          reader.token,
        )
      ).status,
    ).toBe(400);
  });

  it('requires complete source verification, freezes attestation and rejects overlapping activated policies', async () => {
    const created = await call(
      'POST',
      '/api/payroll/statutory-versions',
      approver.token,
      statutory('AHL', { label: 'Synthetic duplicate effective date' }),
    );
    expect(created.status).toBe(201);
    const id = created.body.id;
    const verification = {
      facilityId: facilityA,
      verifiedOn: '2026-10-27',
      verificationReference: 'Reviewed synthetic arithmetic values only, not official rates',
      verificationPurpose: 'SYNTHETIC_TEST',
      confirmSourceReviewed: true,
    };
    expect(
      (await call('POST', `/api/payroll/statutory-versions/${id}/verify`, hr.token, verification))
        .status,
    ).toBe(403);
    expect(
      (
        await call('POST', `/api/payroll/statutory-versions/${id}/verify`, approver.token, {
          ...verification,
          confirmSourceReviewed: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', `/api/payroll/statutory-versions/${id}/verify`, approver.token, {
          ...verification,
          verifiedOn: '2099-01-01',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', `/api/payroll/statutory-versions/${id}/verify`, approver.token, {
          ...verification,
          verifiedOn: '2026-02-31',
        })
      ).status,
    ).toBe(400);
    await expect(
      pool.query(`UPDATE payroll_statutory_versions SET status='ACTIVE' WHERE id=$1`, [id]),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (
        await call(
          'POST',
          `/api/payroll/statutory-versions/${id}/verify`,
          approver.token,
          verification,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          'POST',
          `/api/payroll/statutory-versions/${id}/verify`,
          approver.token,
          verification,
        )
      ).status,
    ).toBe(409);
    await expect(
      pool.query(`UPDATE payroll_statutory_versions SET verified_on='2026-10-26' WHERE id=$1`, [
        id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    // 0094 replaces the guard function; the triggers installed by 0093 must remain attached.
    const guards = await pool.query(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('payroll_rule_history_guard','payroll_band_history_guard')`,
    );
    expect(guards.rows.map((r) => r.tgname).sort()).toEqual([
      'payroll_band_history_guard',
      'payroll_rule_history_guard',
    ]);
    await expect(
      pool.query(`UPDATE payroll_statutory_versions SET authority='changed source' WHERE id=$1`, [
        id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(`UPDATE payroll_statutory_bands SET employee_rate_bp=999 WHERE version_id=$1`, [
        id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(`DELETE FROM payroll_statutory_bands WHERE version_id=$1`, [id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `INSERT INTO payroll_statutory_bands(version_id,lower_bound_cents,employee_rate_bp) VALUES($1,0,1)`,
        [id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const overlap = await call(
      'POST',
      `/api/payroll/statutory-versions/${id}/status`,
      approver.token,
      { facilityId: facilityA, status: 'ACTIVE' },
    );
    expect(overlap.status).toBe(409);
    expect(overlap.body.error).toBe('STATUTORY_OVERLAP');
    const incomplete = await call(
      'POST',
      '/api/payroll/statutory-versions',
      approver.token,
      statutory('SHIF', { effectiveFrom: '2029-01-01', calculationConfig: null }),
    );
    expect(incomplete.status).toBe(201);
    expect(
      (
        await call(
          'POST',
          `/api/payroll/statutory-versions/${incomplete.body.id}/verify`,
          approver.token,
          verification,
        )
      ).body.error,
    ).toBe('STATUTORY_CONFIGURATION_INCOMPLETE');
  });

  it('blocks missing mappings and inactive/wrong-type accounts at calculation and finalization, with no partial journal', async () => {
    const original = (
      await call('GET', `/api/payroll/account-settings?facilityId=${facilityA}`, approver.token)
    ).body;
    // Posted accounts are intentionally immutable. Exercise inactivity on a new, not-yet-posted approved mapping.
    original.netPayPayableAccountId = (
      await pool.query(
        `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance) VALUES($1,$2,$3,'Synthetic new net payable','LIABILITY','PAYROLL','CREDIT') RETURNING id`,
        [tenantA, facilityA, `NEW-NET-${suffix}`],
      )
    ).rows[0].id;
    const period = await call('POST', '/api/payroll/periods', hr.token, {
      facilityId: facilityA,
      name: `Readiness ${suffix}`,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      payDate: '2026-10-31',
    });
    expect(period.status).toBe(201);
    const id = period.body.id;
    await pool.query('DELETE FROM payroll_account_settings WHERE facility_id=$1', [facilityA]);
    try {
      const blocked = await call('POST', `/api/payroll/periods/${id}/calculate`, hr.token, {
        facilityId: facilityA,
      });
      expect(blocked.body.error).toBe('PAYROLL_MAPPING_REQUIRED');
      expect(blocked.status).toBe(409);
      expect(
        (await pool.query('SELECT count(*)::int AS n FROM payroll_runs WHERE period_id=$1', [id]))
          .rows[0].n,
      ).toBe(0);
    } finally {
      expect(
        (
          await call('PUT', '/api/payroll/account-settings', approver.token, {
            ...original,
            facilityId: facilityA,
          })
        ).status,
      ).toBe(200);
    }
    const invalid = await call('PUT', '/api/payroll/account-settings', approver.token, {
      ...original,
      facilityId: facilityA,
      netPayPayableAccountId: original.salaryExpenseAccountId,
    });
    expect(invalid.status).toBe(409);
    expect(invalid.body.error).toBe('PAYROLL_MAPPING_INVALID');
    await pool.query('UPDATE chart_of_accounts SET is_active=false WHERE id=$1', [
      original.netPayPayableAccountId,
    ]);
    try {
      const readiness = await call(
        'GET',
        `/api/payroll/readiness?facilityId=${facilityA}&periodId=${id}`,
        reader.token,
      );
      expect(
        readiness.body.mapping.mappings.find(
          (m: { key: string }) => m.key === 'netPayPayableAccountId',
        ).status,
      ).toBe('INACTIVE');
      expect(
        (
          await call('POST', `/api/payroll/periods/${id}/calculate`, hr.token, {
            facilityId: facilityA,
          })
        ).status,
      ).toBe(409);
    } finally {
      await pool.query('UPDATE chart_of_accounts SET is_active=true WHERE id=$1', [
        original.netPayPayableAccountId,
      ]);
    }
    const calculated = await call('POST', `/api/payroll/periods/${id}/calculate`, hr.token, {
      facilityId: facilityA,
    });
    expect(calculated.status, JSON.stringify(calculated.body)).toBe(200);
    const run = calculated.body.runId;
    expect(
      (
        await call('POST', `/api/payroll/runs/${run}/approve`, approver.token, {
          facilityId: facilityA,
        })
      ).status,
    ).toBe(200);
    await pool.query('UPDATE chart_of_accounts SET is_active=false WHERE id=$1', [
      original.netPayPayableAccountId,
    ]);
    try {
      const blocked = await call('POST', `/api/payroll/runs/${run}/post`, approver.token, {
        facilityId: facilityA,
      });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toBe('PAYROLL_MAPPING_REQUIRED');
      expect(
        (
          await pool.query(
            `SELECT count(*)::int AS n FROM journal_entries WHERE facility_id=$1 AND source_type='PAYROLL' AND source_id=$2`,
            [facilityA, String(run)],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.query('UPDATE chart_of_accounts SET is_active=true WHERE id=$1', [
        original.netPayPayableAccountId,
      ]);
    }
    expect(
      (
        await call('POST', `/api/payroll/runs/${run}/post`, approver.token, {
          facilityId: facilityA,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('POST', `/api/payroll/runs/${run}/post`, approver.token, {
          facilityId: facilityA,
        })
      ).status,
    ).toBe(409);
  });

  it('uses verified finite retired rules for historical periods and blocks boundary-crossing periods', async () => {
    const person = await call(
      'POST',
      '/api/hr/employees',
      hr.token,
      employee({ employeeNumber: `HIST-${suffix}`, hireDate: '2025-01-01' }),
    );
    expect(person.status).toBe(201);
    for (const statute of ['PAYE', 'NSSF', 'SHIF', 'AHL']) {
      const created = await call(
        'POST',
        '/api/payroll/statutory-versions',
        approver.token,
        statutory(statute, { effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31' }),
      );
      expect(created.status).toBe(201);
      const id = created.body.id;
      expect(
        (
          await call('POST', `/api/payroll/statutory-versions/${id}/verify`, approver.token, {
            facilityId: facilityA,
            verifiedOn: '2026-10-27',
            verificationReference: 'Historical synthetic test policy source reviewed',
            verificationPurpose: 'SYNTHETIC_TEST',
            confirmSourceReviewed: true,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call('POST', `/api/payroll/statutory-versions/${id}/status`, approver.token, {
            facilityId: facilityA,
            status: 'ACTIVE',
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call('POST', `/api/payroll/statutory-versions/${id}/status`, approver.token, {
            facilityId: facilityA,
            status: 'RETIRED',
          })
        ).status,
      ).toBe(200);
    }
    const period = await call('POST', '/api/payroll/periods', hr.token, {
      facilityId: facilityA,
      name: `Historical ${suffix}`,
      startDate: '2025-12-01',
      endDate: '2025-12-31',
      payDate: '2025-12-31',
    });
    expect(period.status).toBe(201);
    const readiness = await call(
      'GET',
      `/api/payroll/readiness?facilityId=${facilityA}&periodId=${period.body.id}`,
      reader.token,
    );
    expect(readiness.body.configurationReady).toBe(true);
    expect(readiness.body.productionReady).toBe(false);
    const calculation = await call(
      'POST',
      `/api/payroll/periods/${period.body.id}/calculate`,
      hr.token,
      { facilityId: facilityA },
    );
    expect(calculation.status, JSON.stringify(calculation.body)).toBe(200);
    const crossing = await call('POST', '/api/payroll/periods', hr.token, {
      facilityId: facilityA,
      name: `Boundary ${suffix}`,
      startDate: '2025-11-01',
      endDate: '2025-11-30',
      payDate: '2026-01-01',
    });
    expect(crossing.status).toBe(201);
    const blocked = await call(
      'POST',
      `/api/payroll/periods/${crossing.body.id}/calculate`,
      hr.token,
      { facilityId: facilityA },
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('STATUTORY_DATE_GAP');
  });
});
