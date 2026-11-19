/**
 * Published statutory rulebook, calculation preview and payroll reversal —
 * authenticated HTTP tests against a disposable PostgreSQL database.
 *
 * The catalogue transcribed in `src/workforce/statutory-rulebook.ts` is the
 * subject here: install it, verify it as a named user, activate it, then check
 * that the November 2026 worked example is reproduced from the stored version
 * rows rather than from constants in the engine.
 *
 * Nothing in this file proves legal compliance. It proves that the software
 * reads the recorded rule, that the trace adds up, and that a posted run can be
 * corrected without rewriting history.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { createApp } from '../../app.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('payroll statutory rulebook, preview and reversal', () => {
  const suffix = randomUUID().slice(0, 8);
  let base: string;
  let close: () => Promise<void>;
  let tenantId: number;
  let facilityId: number;
  let manager: { id: number; token: string };
  let approver: { id: number; token: string };
  let reader: { id: number; token: string };
  const accountIds: number[] = [];

  const call = (
    method: string,
    path: string,
    token: string | undefined,
    body?: Record<string, unknown>,
  ) => httpJson(base, method, path, { token, body });

  const preview = (body: Record<string, unknown>) =>
    call('POST', '/api/payroll/preview', manager.token, { facilityId, ...body });

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required (name must contain "test").');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));

    tenantId = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic rulebook ${suffix}`,
        `rbk-${suffix}`,
      ])
    ).rows[0].id;
    facilityId = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules)
         VALUES($1,$2,'Synthetic rulebook','["hr","payroll","accounting"]'::jsonb) RETURNING id`,
        [tenantId, `RBK-${suffix}`],
      )
    ).rows[0].id;

    for (const code of [
      'hr.read',
      'hr.manage',
      'payroll.read',
      'payroll.manage',
      'payroll.approve',
      'payroll.post',
      'payroll.statutory.manage',
    ])
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'workforce') ON CONFLICT(code) DO NOTHING`,
        [code],
      );

    const actor = async (tag: string, grants: string[]) => {
      const id = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
           VALUES($1,$1,$2,$3,'test-only','ACTIVE',$4,$5) RETURNING id`,
          [
            `rbk-${tag}-${suffix}`,
            `rbk-${tag}-${suffix}@example.test`,
            `Synthetic ${tag}`,
            tenantId,
            facilityId,
          ],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenantId, `RBK_${tag}_${suffix}`],
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

    // The manager may approve in principle; the service still refuses a run
    // they calculated themselves, which is what the test below exercises.
    manager = await actor('manager', [
      'hr.read',
      'hr.manage',
      'payroll.read',
      'payroll.manage',
      'payroll.approve',
      'payroll.statutory.manage',
    ]);
    approver = await actor('approver', [
      'hr.read',
      'payroll.read',
      'payroll.manage',
      'payroll.approve',
      'payroll.post',
    ]);
    reader = await actor('reader', ['hr.read', 'payroll.read']);

    // A posted run needs a facility chart; payroll never creates one.
    for (const [code, name, type, normal] of [
      ['5100', 'Salaries', 'EXPENSE', 'DEBIT'],
      ['5110', 'Employer cost', 'EXPENSE', 'DEBIT'],
      ['2100', 'Net pay payable', 'LIABILITY', 'CREDIT'],
      ['2110', 'PAYE payable', 'LIABILITY', 'CREDIT'],
      ['2120', 'NSSF payable', 'LIABILITY', 'CREDIT'],
      ['2130', 'SHIF payable', 'LIABILITY', 'CREDIT'],
      ['2140', 'Housing levy payable', 'LIABILITY', 'CREDIT'],
      ['2150', 'Other deductions payable', 'LIABILITY', 'CREDIT'],
    ] as const) {
      accountIds.push(
        (
          await pool.query(
            `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance)
             VALUES($1,$2,$3,$4,$5,'PAYROLL',$6) RETURNING id`,
            [tenantId, facilityId, `${code}-${suffix}`, name, type, normal],
          )
        ).rows[0].id,
      );
    }
    // One open accounting period covers both the pay date and a later reversal.
    await pool.query(
      `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status)
       VALUES($1,$2,$3,'Synthetic year','2026-01-01','2027-12-31','OPEN')`,
      [tenantId, facilityId, `RBK-${suffix}`],
    );
  }, 60_000);

  afterAll(async () => {
    await close?.();
  });

  it('lists the published catalogue with sources and shows what is not installed', async () => {
    const listed = await call(
      'GET',
      `/api/payroll/statutory-rulebook?facilityId=${facilityId}&effectiveOn=2026-11-30`,
      reader.token,
    );
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const entries = listed.body.entries as Array<Record<string, unknown>>;
    expect(entries.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(['PAYE-2024-12', 'NSSF-2026-02', 'SHIF-2024-10', 'AHL-2024-03']),
    );
    for (const entry of entries) {
      expect(entry.sourceTitle).toBeTruthy();
      expect(entry.sourceUrl).toMatch(/^https:\/\//);
      expect(entry.authority).toBeTruthy();
      expect(entry.installedVersionId).toBeNull();
      expect(entry.appliesOnSelectedDate).toBe(
        String(entry.effectiveFrom) <= '2026-11-30' &&
          (entry.effectiveTo === null || String(entry.effectiveTo) >= '2026-11-30'),
      );
    }
    // NSSF before February 2026 is genuinely not in the catalogue; the gap must
    // be visible rather than filled with a guessed rate.
    const december = await call(
      'GET',
      `/api/payroll/statutory-rulebook?facilityId=${facilityId}&effectiveOn=2025-12-15`,
      reader.token,
    );
    const nssf = (december.body.entries as Array<Record<string, unknown>>).find(
      (entry) => entry.statute === 'NSSF',
    )!;
    expect(nssf.appliesOnSelectedDate).toBe(false);
  });

  it('refuses to preview before any rule is recorded', async () => {
    const response = await preview({ payDate: '2026-11-30', grossKes: '100000.00' });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('STATUTORY_VERSION_REQUIRED');
  });

  it('installs the covering rules as drafts, idempotently, with their bands', async () => {
    const installed = await call('POST', '/api/payroll/statutory-rulebook/install', manager.token, {
      facilityId,
      effectiveOn: '2026-11-30',
    });
    expect(installed.status, JSON.stringify(installed.body)).toBe(201);
    expect(installed.body.installed).toHaveLength(4);
    expect(installed.body.installed.map((row: { statute: string }) => row.statute).sort()).toEqual([
      'AHL',
      'NSSF',
      'PAYE',
      'SHIF',
    ]);
    expect(installed.body.skipped).toHaveLength(0);

    const again = await call('POST', '/api/payroll/statutory-rulebook/install', manager.token, {
      facilityId,
      effectiveOn: '2026-11-30',
    });
    expect(again.status).toBe(201);
    expect(again.body.installed).toHaveLength(0);
    expect(again.body.skipped).toHaveLength(4);

    const versions = await call(
      'GET',
      `/api/payroll/statutory-versions?facilityId=${facilityId}`,
      reader.token,
    );
    const rows = versions.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.status).toBe('DRAFT');
    const paye = rows.find((row) => row.statute === 'PAYE')!;
    expect((paye.bands as unknown[]).length).toBe(5);
    expect(paye.ruleName).toBeTruthy();
    expect(paye.calculationMethod).toBeTruthy();
    expect(paye.currency).toBe('KES');
    expect(String(paye.sourceUrl)).toMatch(/^https:\/\//);
    const nssf = rows.find((row) => row.statute === 'NSSF')!;
    // Tier I and Tier II are separate bands; the limits live in the row.
    expect(
      (nssf.bands as Array<Record<string, unknown>>).map((band) => band.lowerBoundCents),
    ).toEqual(['0', '900000']);
  });

  it('will not activate an unverified draft, then verifies and activates all four', async () => {
    const versions = await call(
      'GET',
      `/api/payroll/statutory-versions?facilityId=${facilityId}`,
      reader.token,
    );
    const ids = (versions.body as Array<Record<string, number>>).map((row) => row.id);

    const blocked = await call(
      'POST',
      `/api/payroll/statutory-versions/${ids[0]}/status`,
      manager.token,
      {
        facilityId,
        status: 'ACTIVE',
      },
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('STATUTORY_VERIFICATION_REQUIRED');

    for (const id of ids) {
      const verified = await call(
        'POST',
        `/api/payroll/statutory-versions/${id}/verify`,
        manager.token,
        {
          facilityId,
          verifiedOn: '2026-10-27',
          verificationReference: `Catalogue source reviewed for synthetic test ${suffix}`,
          verificationPurpose: 'AUTHORITY_SOURCE',
          confirmSourceReviewed: true,
        },
      );
      expect(verified.status, JSON.stringify(verified.body)).toBe(200);
      const activated = await call(
        'POST',
        `/api/payroll/statutory-versions/${id}/status`,
        manager.token,
        { facilityId, status: 'ACTIVE' },
      );
      expect(activated.status, JSON.stringify(activated.body)).toBe(200);
      expect(activated.body.status).toBe('ACTIVE');
    }
  });

  it('reproduces the November 2026 worked example from the stored rule versions', async () => {
    const response = await preview({ payDate: '2026-11-30', grossKes: '100000.00' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const slip = response.body.slip as Record<string, string>;

    expect(slip.grossCents).toBe('10000000');
    expect(slip.nssfEmployeeCents).toBe('600000');
    expect(slip.nssfEmployerCents).toBe('600000');
    expect(slip.shifCents).toBe('275000');
    expect(slip.ahlEmployeeCents).toBe('150000');
    expect(slip.ahlEmployerCents).toBe('150000');
    expect(slip.taxableCents).toBe('8975000');
    expect(slip.payeBeforeReliefCents).toBe('2170835');
    expect(slip.personalReliefCents).toBe('240000');
    expect(slip.payeCents).toBe('1930835');
    expect(slip.netCents).toBe('7044165');
    expect(slip.employerContributionsCents).toBe('750000');
    expect(slip.employerCostCents).toBe('10750000');

    // The trace keeps every step, including both NSSF tiers.
    const lines = response.body.slip.lines as Array<{ code: string; amountCents: string }>;
    const codes = lines.map((line) => line.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'BASIC',
        'NSSF_T1',
        'NSSF_T2',
        'SHIF',
        'AHL',
        'PAYE',
        'NET',
        'NSSF_EMPLOYER_T1',
        'NSSF_EMPLOYER_T2',
        'AHL_EMPLOYER',
      ]),
    );
    // The PAYE trace records the bands actually charged; a 100,000 salary
    // reaches the third band, and the SHIF and AHL versions say which dates
    // they were effective so a payslip can be explained later.
    const statutes = response.body.slip.statutes as Array<{ statute: string; bands: unknown[] }>;
    expect(statutes.find((row) => row.statute === 'PAYE')!.bands).toHaveLength(3);
    const versions = response.body.ruleVersions as Array<Record<string, unknown>>;
    expect(versions).toHaveLength(4);
    for (const version of versions)
      expect(String(version.sourceReference).length).toBeGreaterThan(8);

    // A preview writes nothing: no payslip, run or journal.
    const leaked = await pool.query(
      `SELECT (SELECT count(*)::int FROM payroll_payslips WHERE facility_id=$1) AS slips,
              (SELECT count(*)::int FROM payroll_runs WHERE facility_id=$1) AS runs,
              (SELECT count(*)::int FROM journal_entries WHERE facility_id=$1) AS journals`,
      [facilityId],
    );
    expect(leaked.rows[0]).toEqual({ slips: 0, runs: 0, journals: 0 });
  });

  it('applies the SHIF floor, NSSF floors and ceilings, and Tiers I and II separately', async () => {
    const at = async (grossKes: string) => {
      const response = await preview({ payDate: '2026-11-30', grossKes });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return response.body.slip as Record<string, string>;
    };

    // Below the SHIF floor: the minimum applies.
    expect((await at('10000.00')).shifCents).toBe('30000');
    // At and below the NSSF lower earnings limit: Tier I only.
    expect((await at('9000.00')).nssfEmployeeCents).toBe('54000');
    expect((await at('5000.00')).nssfEmployeeCents).toBe('30000');
    // Between the limits: Tier I is capped, Tier II takes the excess.
    const eighteen = await at('18000.00');
    expect(eighteen.nssfEmployeeCents).toBe('108000');
    // At the upper limit, and above it, the contribution stops.
    expect((await at('108000.00')).nssfEmployeeCents).toBe('648000');
    expect((await at('500000.00')).nssfEmployeeCents).toBe('648000');
  });

  it('charges bands cumulatively and turns relief off for a non-resident', async () => {
    const resident = await preview({ payDate: '2026-11-30', grossKes: '1000000.00' });
    expect(resident.status).toBe(200);
    expect((resident.body.slip as Record<string, string>).taxableCents).toBe('95102000');
    expect((resident.body.slip as Record<string, string>).payeCents).toBe('29274035');
    expect(
      (resident.body.slip.statutes as Array<{ statute: string; bands: unknown[] }>).find(
        (row) => row.statute === 'PAYE',
      )!.bands,
    ).toHaveLength(5);

    const nonResident = await preview({
      payDate: '2026-11-30',
      grossKes: '1000000.00',
      taxResidency: 'NON_RESIDENT',
    });
    expect(nonResident.status).toBe(200);
    expect((nonResident.body.slip as Record<string, string>).personalReliefCents).toBe('0');
    expect((nonResident.body.slip as Record<string, string>).payeCents).toBe('29514035');
  });

  it('separates a qualifying pension deduction from an ordinary saving deduction', async () => {
    const response = await preview({
      payDate: '2026-11-30',
      grossKes: '100000.00',
      components: [
        {
          code: 'PENSION',
          name: 'Qualifying pension',
          kind: 'DEDUCTION',
          amountKes: '20000.00',
          taxDeductible: true,
        },
        {
          code: 'SACCO',
          name: 'SACCO savings',
          kind: 'DEDUCTION',
          amountKes: '5000.00',
          taxDeductible: false,
        },
      ],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const slip = response.body.slip as Record<string, string>;
    // Taxable income falls by the qualifying contribution, net falls by both.
    expect(slip.qualifyingPensionCents).toBe('2000000');
    expect(slip.taxableCents).toBe('6975000');
    expect(slip.otherDeductionsCents).toBe('2500000');
  });

  it('excludes a regular cash allowance from nothing but keeps an irregular bonus out of AHL', async () => {
    const response = await preview({
      payDate: '2026-11-30',
      grossKes: '100000.00',
      components: [
        {
          code: 'HOUSE',
          name: 'House allowance',
          kind: 'EARNING',
          amountKes: '15000.00',
        },
        {
          code: 'BONUS',
          name: 'Irregular bonus',
          kind: 'EARNING',
          amountKes: '20000.00',
          statutoryExclusions: ['AHL'],
        },
      ],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const slip = response.body.slip as Record<string, string>;
    expect(slip.grossCents).toBe('13500000');
    // The house allowance is part of the AHL base; the bonus is not.
    expect(slip.ahlEmployeeCents).toBe('172500');
    expect(slip.shifCents).toBe('371250');
  });

  it('refuses a preview on a date no NSSF rule covers instead of borrowing a rate', async () => {
    const response = await preview({ payDate: '2025-12-15', grossKes: '100000.00' });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('STATUTORY_VERSION_REQUIRED');
    expect(String(response.body.message)).toContain('NSSF');
  });

  it('calculates, approves, posts and reverses a run with a balanced contra journal', async () => {
    const employee = await call('POST', '/api/hr/employees', manager.token, {
      facilityId,
      employeeNumber: `RBK-${suffix}`,
      firstName: 'Synthetic',
      lastName: 'Payroll',
      hireDate: '2026-01-05',
      baseSalaryCents: '10000000',
    });
    expect(employee.status, JSON.stringify(employee.body)).toBe(201);
    expect(employee.body.insurancePremiumMonthlyCents).toBe('0');

    const mapping = await call('PUT', '/api/payroll/account-settings', manager.token, {
      facilityId,
      salaryExpenseAccountId: accountIds[0],
      employerCostAccountId: accountIds[1],
      netPayPayableAccountId: accountIds[2],
      payePayableAccountId: accountIds[3],
      nssfPayableAccountId: accountIds[4],
      shifPayableAccountId: accountIds[5],
      ahlPayableAccountId: accountIds[6],
      otherDeductionsPayableAccountId: accountIds[7],
    });
    expect(mapping.status, JSON.stringify(mapping.body)).toBe(200);

    const period = await call('POST', '/api/payroll/periods', manager.token, {
      facilityId,
      name: `Rulebook ${suffix}`,
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      payDate: '2026-11-28',
    });
    expect(period.status).toBe(201);
    const calculation = await call(
      'POST',
      `/api/payroll/periods/${period.body.id}/calculate`,
      manager.token,
      { facilityId },
    );
    expect(calculation.status, JSON.stringify(calculation.body)).toBe(200);
    const runId = calculation.body.runId as number;

    const detail = await call(
      'GET',
      `/api/payroll/runs/${runId}?facilityId=${facilityId}`,
      reader.token,
    );
    expect(detail.status).toBe(200);
    const slip = detail.body.payslips[0];
    expect(String(slip.netCents)).toBe('7044165');
    expect(String(slip.payeCents)).toBe('1930835');

    // The calculator may not approve their own run; a second named approver must.
    const selfApproval = await call('POST', `/api/payroll/runs/${runId}/approve`, manager.token, {
      facilityId,
    });
    expect(selfApproval.status).toBe(403);
    expect(selfApproval.body.error).toBe('PAYROLL_SELF_APPROVAL');
    const approved = await call('POST', `/api/payroll/runs/${runId}/approve`, approver.token, {
      facilityId,
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const posted = await call('POST', `/api/payroll/runs/${runId}/post`, approver.token, {
      facilityId,
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(posted.body.debitTotalCents).toBe(posted.body.creditTotalCents);
    const originalJournalId = posted.body.journalEntryId as number;

    const reversed = await call('POST', `/api/payroll/runs/${runId}/reverse`, approver.token, {
      facilityId,
      reason: 'Synthetic reversal test — salary corrected before payment',
    });
    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    expect(reversed.body.status).toBe('REVERSED');
    expect(reversed.body.reversalJournalEntryId).not.toBe(originalJournalId);

    const again = await call('POST', `/api/payroll/runs/${runId}/reverse`, approver.token, {
      facilityId,
      reason: 'Second attempt must not post a second contra',
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('RUN_ALREADY_REVERSED');

    // The original journal is untouched and still posted; the contra mirrors it.
    const journals = await pool.query(
      `SELECT id, status, reversal_of_journal_id,
              total_debit_cents::text AS debit, total_credit_cents::text AS credit
         FROM journal_entries WHERE id = ANY($1::int[]) ORDER BY id`,
      [[originalJournalId, resolvedJournalId(reversed.body)]],
    );
    const original = journals.rows.find((row) => row.id === originalJournalId)!;
    const contra = journals.rows.find((row) => row.id !== originalJournalId)!;
    expect(original.status).toBe('POSTED');
    expect(original.reversal_of_journal_id).toBeNull();
    expect(contra.status).toBe('POSTED');
    expect(contra.reversal_of_journal_id).toBe(originalJournalId);
    expect(contra.debit).toBe(original.credit);
    expect(contra.credit).toBe(original.debit);

    // Deleting the payslips of a reversed run is refused: the extract history stays.
    await expect(
      pool.query('DELETE FROM payroll_payslips WHERE run_id=$1', [runId]),
    ).rejects.toMatchObject({ code: '23514' });

    // Recalculation of the reversed period is allowed again, creating a new run.
    const recalculation = await call(
      'POST',
      `/api/payroll/periods/${period.body.id}/calculate`,
      manager.token,
      { facilityId },
    );
    expect(recalculation.status, JSON.stringify(recalculation.body)).toBe(200);
    expect(recalculation.body.runId).not.toBe(runId);
  });

  it('prorates a mid-month joiner by calendar days and charges statutes on what was earned', async () => {
    const joiner = await call('POST', '/api/hr/employees', manager.token, {
      facilityId,
      employeeNumber: `MID-${suffix}`,
      firstName: 'Synthetic',
      lastName: 'Joiner',
      hireDate: '2027-02-15',
      baseSalaryCents: '10000000',
    });
    expect(joiner.status, JSON.stringify(joiner.body)).toBe(201);

    const period = await call('POST', '/api/payroll/periods', manager.token, {
      facilityId,
      name: `Mid-month ${suffix}`,
      startDate: '2027-02-01',
      endDate: '2027-02-28',
      payDate: '2027-02-26',
    });
    expect(period.status).toBe(201);
    const calculation = await call(
      'POST',
      `/api/payroll/periods/${period.body.id}/calculate`,
      manager.token,
      { facilityId },
    );
    expect(calculation.status, JSON.stringify(calculation.body)).toBe(200);

    const detail = await call(
      'GET',
      `/api/payroll/runs/${calculation.body.runId}?facilityId=${facilityId}`,
      reader.token,
    );
    const slip = (detail.body.payslips as Array<Record<string, unknown>>).find(
      (row) => row.employeeNumber === `MID-${suffix}`,
    )!;
    const breakdown = slip.breakdown as {
      proration: { paidDays: number; totalDays: number; baseSalaryCents: string };
      lines: Array<{ code: string; amountCents: string }>;
    };
    // 15–28 February inclusive is 14 of 28 days: exactly half.
    expect(breakdown.proration).toMatchObject({ paidDays: 14, totalDays: 28 });
    expect(breakdown.proration.baseSalaryCents).toBe('5000000');
    expect(String(slip.grossCents)).toBe('5000000');
    // NSSF 6%, SHIF 2.75%, AHL 1.5% on 50,000 — not on the full 100,000.
    expect(String(slip.nssfEmployeeCents)).toBe('300000');
    expect(String(slip.shifCents)).toBe('137500');
    expect(String(slip.ahlEmployeeCents)).toBe('75000');
    /*
     * Taxable 44,875: 24,000@10% = 2,400; 8,333@25% = 2,083.25; the remaining
     * 12,542@30% = 3,762.60 → 8,245.85 gross tax, less 2,400 personal relief
     * = 5,845.85. Net 50,000 − 3,000 − 1,375 − 750 − 5,845.85 = 39,029.15.
     */
    expect(String(slip.payeCents)).toBe('584585');
    expect(String(slip.netCents)).toBe('3902915');
  });

  it('refuses to post a run whose rule versions were replaced after calculation', async () => {
    /*
     * A run is a snapshot. If the rules change between approval and posting,
     * the journal would record figures that no longer match the versions the
     * facility says are active. Refusing is the only honest outcome; the run
     * must be recalculated against the replaced rules.
     */
    const period = await call('POST', '/api/payroll/periods', manager.token, {
      facilityId,
      name: `Snapshot ${suffix}`,
      startDate: '2026-12-01',
      endDate: '2026-12-31',
      payDate: '2026-12-24',
    });
    expect(period.status).toBe(201);
    const calculation = await call(
      'POST',
      `/api/payroll/periods/${period.body.id}/calculate`,
      manager.token,
      { facilityId },
    );
    expect(calculation.status, JSON.stringify(calculation.body)).toBe(200);
    const runId = calculation.body.runId as number;
    expect(
      (await call('POST', `/api/payroll/runs/${runId}/approve`, approver.token, { facilityId }))
        .status,
    ).toBe(200);

    const versions = await call(
      'GET',
      `/api/payroll/statutory-versions?facilityId=${facilityId}`,
      reader.token,
    );
    const paye = (versions.body as Array<Record<string, unknown>>).find(
      (row) => row.statute === 'PAYE' && row.status === 'ACTIVE',
    )!;
    expect(
      (
        await call('POST', `/api/payroll/statutory-versions/${paye.id}/status`, manager.token, {
          facilityId,
          status: 'RETIRED',
        })
      ).status,
    ).toBe(200);

    const replacement = await call('POST', '/api/payroll/statutory-versions', manager.token, {
      facilityId,
      statute: 'PAYE',
      label: `Replacement ${suffix}`,
      effectiveFrom: '2024-12-27',
      authority: 'Synthetic authority',
      sourceReference: `Synthetic replacement rule for test ${suffix}`,
      ruleName: 'Synthetic single-band PAYE',
      calculationMethod: 'PROGRESSIVE_MONTHLY_BANDS_WITH_RELIEFS',
      calculationConfig: {
        deductNssf: true,
        deductShif: true,
        deductAhl: true,
        personalReliefCents: '240000',
        employeeMinimumCents: '0',
        employerMinimumCents: '0',
      },
      bands: [
        {
          sequence: 1,
          lowerBoundCents: '0',
          upperBoundCents: null,
          employeeRateBp: 1000,
          employerRateBp: 0,
          employeeFixedCents: '0',
          employerFixedCents: '0',
          employeeCapCents: null,
          employerCapCents: null,
          reliefCents: '0',
        },
      ],
    });
    expect(replacement.status, JSON.stringify(replacement.body)).toBe(201);
    expect(
      (
        await call(
          'POST',
          `/api/payroll/statutory-versions/${replacement.body.id}/verify`,
          manager.token,
          {
            facilityId,
            verifiedOn: '2026-10-27',
            verificationReference: `Synthetic replacement review ${suffix}`,
            verificationPurpose: 'SYNTHETIC_TEST',
            confirmSourceReviewed: true,
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          'POST',
          `/api/payroll/statutory-versions/${replacement.body.id}/status`,
          manager.token,
          {
            facilityId,
            status: 'ACTIVE',
          },
        )
      ).status,
    ).toBe(200);

    const blocked = await call('POST', `/api/payroll/runs/${runId}/post`, approver.token, {
      facilityId,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('PAYROLL_RULE_SNAPSHOT_MISMATCH');
    expect(blocked.body.message).toContain('recalculate');

    const journals = await pool.query(
      `SELECT count(*)::int AS n FROM journal_entries WHERE source_type='PAYROLL' AND source_id=$1`,
      [String(runId)],
    );
    expect(journals.rows[0].n).toBe(0);
  });

  function resolvedJournalId(body: Record<string, unknown>): number {
    return Number(body.reversalJournalEntryId);
  }
});
