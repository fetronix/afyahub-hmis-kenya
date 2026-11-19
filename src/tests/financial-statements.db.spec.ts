/**
 * Financial statements against a disposable PostgreSQL database.
 *
 * The ledger here is posted through the real accounting service, so the tests
 * exercise the same open-period rules, idempotency and audit trail as
 * production. The facility is synthetic: Syrona Medical Center style figures
 * with invented amounts, never a real patient or a real shilling.
 */

import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/index.ts';
import {
  closeFinancialYearScoped,
  exportRunScoped,
  generateScoped,
  getRunScoped,
  getSettingsScoped,
  listRunsScoped,
  approveRunScoped,
  reviewRunScoped,
  reviseRunScoped,
  reopenPeriodScoped,
  saveMappingScoped,
  saveSettingsScoped,
  type StatementScope,
} from '../financial-statements/service.ts';
import {
  createAccountScoped,
  createFinancialPeriodScoped,
  postJournalScoped,
  type AccountingScope,
} from '../accounting/accounting.service.ts';
import routes from '../routes/financial-statements.routes.ts';
import { describeDb } from './vitest/support/db.ts';

describeDb('synthetic financial statements database workflows', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenantId: number;
  let facilityA: number;
  let facilityB: number;
  let preparer: number;
  let reviewer: number;
  let approver: number;
  let patientId: number;
  let scope: StatementScope;
  let otherScope: StatementScope;
  const accounts: Record<string, number> = {};
  let juliRun = 0;
  let juliRevision = 0;
  let augustRun = 0;
  let annualRun = 0;
  let server: Server;
  let base = '';

  const accountingScope = (actorUserId: number): AccountingScope => ({
    tenantId,
    facilityId: facilityA,
    actorUserId,
  });

  const post = (
    entryDate: string,
    description: string,
    lines: Array<[string, number, number]>,
    key: string,
  ) =>
    postJournalScoped(accountingScope(preparer), {
      entryDate,
      description,
      idempotencyKey: `${suffix}-${key}`,
      sourceType: 'MANUAL',
      lines: lines.map(([account, debitKes, creditKes]) => ({
        accountId: accounts[account],
        debitKes: debitKes ? debitKes.toFixed(2) : undefined,
        creditKes: creditKes ? creditKes.toFixed(2) : undefined,
        description,
      })),
    });

  /**
   * The public posting API does not accept a patient on a journal line, and
   * posted lines are immutable. The debtor fixtures therefore insert their
   * journal directly, still balanced and still POSTED, so the statement can be
   * tested against real patient-tagged ledger lines.
   */
  const postTagged = async (
    entryDate: string,
    description: string,
    lines: Array<[string, number, number, boolean]>,
    key: string,
  ) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const total = lines.reduce((sum, line) => sum + line[1], 0);
      const journal = await client.query(
        `INSERT INTO journal_entries
           (tenant_id, facility_id, period_id, journal_number, entry_date, source_type,
            idempotency_key, request_hash, description, status, total_debit_cents, total_credit_cents, posted_by_user_id)
         SELECT $1,$2,
                (SELECT id FROM financial_periods WHERE facility_id=$2 AND start_date<=$4::date AND end_date>=$4::date),
                $3,$4,'MANUAL',$5,$6,$7,'DRAFT',$8,$8,$9
         RETURNING id`,
        [
          tenantId,
          facilityA,
          `J-${suffix}-${key}`,
          entryDate,
          `fixture-${suffix}-${key}`,
          'fixture',
          description,
          Math.round(total * 100),
          preparer,
        ],
      );
      for (const [account, debitKes, creditKes, tagged] of lines) {
        await client.query(
          `INSERT INTO journal_lines(journal_entry_id, account_id, description, patient_id, debit_cents, credit_cents)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [
            journal.rows[0].id,
            accounts[account],
            description,
            tagged ? patientId : null,
            Math.round(debitKes * 100),
            Math.round(creditKes * 100),
          ],
        );
      }
      // The ledger enforces draft-before-post, so the fixture follows the same
      // two-step path as the service: lines first, then the posting transition.
      await client.query(
        `UPDATE journal_entries SET status = 'POSTED', posted_at = now() WHERE id = $1`,
        [journal.rows[0].id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    if (
      !/test|synthetic/i.test(process.env.SQL_DB_NAME ?? '') ||
      !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '')
    ) {
      throw new Error('Use an explicitly disposable local synthetic/test database.');
    }

    tenantId = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic statements tenant ${suffix}`,
        `fin-${suffix}`,
      ])
    ).rows[0].id;

    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,county,enabled_modules)
       VALUES ($1,$2,$4,'Nyeri',$6),($1,$3,$5,'Nyeri',$6)
       RETURNING id, code`,
      [
        tenantId,
        `SMC-${suffix}`,
        `OTH-${suffix}`,
        'Syrona Medical Center (synthetic)',
        'Synthetic other facility',
        JSON.stringify(['accounting']),
      ],
    );
    facilityA = facilities.rows.find((row) => String(row.code).startsWith('SMC'))!.id;
    facilityB = facilities.rows.find((row) => String(row.code).startsWith('OTH'))!.id;

    const users: number[] = [];
    for (const [index, role] of ['preparer', 'reviewer', 'approver'].entries()) {
      users.push(
        (
          await pool.query(
            `INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id)
             VALUES($1,$2,$3,$4,'not-for-login',$5,$6) RETURNING id`,
            [
              `fin-${suffix}-${index}`,
              `fin-${suffix}-${index}`,
              `fin-${suffix}-${index}@example.test`,
              `Synthetic ${role}`,
              tenantId,
              facilityA,
            ],
          )
        ).rows[0].id,
      );
    }
    [preparer, reviewer, approver] = users;

    patientId = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
         VALUES($1,$2,$3,'Synthetic','Patient','1990-01-01','Female') RETURNING id`,
        [tenantId, facilityA, `MRN-${suffix}`],
      )
    ).rows[0].id;

    scope = { tenantId, facilityId: facilityA, actorUserId: preparer };
    otherScope = { tenantId, facilityId: facilityB, actorUserId: preparer };

    const chart: Array<[string, string, string, string, string]> = [
      ['1000', 'Cash at bank', 'ASSET', 'CASH_AT_BANK', 'DEBIT'],
      ['1100', 'Patient receivables', 'ASSET', 'RECEIVABLE', 'DEBIT'],
      ['1500', 'Medical equipment', 'ASSET', 'PPE', 'DEBIT'],
      ['1590', 'Accumulated depreciation', 'ASSET', 'ACCUMULATED_DEPRECIATION', 'CREDIT'],
      ['2000', 'Supplier payables', 'LIABILITY', 'PAYABLE', 'CREDIT'],
      ['2100', 'PAYE payable', 'LIABILITY', 'STATUTORY', 'CREDIT'],
      ['3000', 'Partners capital', 'EQUITY', 'PARTNER_CAPITAL', 'CREDIT'],
      ['3100', 'Retained earnings', 'EQUITY', 'RETAINED_EARNINGS', 'CREDIT'],
      ['4000', 'Outpatient services', 'REVENUE', 'REVENUE', 'CREDIT'],
      ['5000', 'Salaries and wages', 'EXPENSE', 'OPERATING', 'DEBIT'],
      ['5100', 'Depreciation expense', 'EXPENSE', 'DEPRECIATION', 'DEBIT'],
    ];
    for (const [accountCode, accountName, accountType, subType, normalBalance] of chart) {
      const created = await createAccountScoped(accountingScope(preparer), {
        accountCode,
        accountName,
        accountType,
        subType,
        normalBalance,
      });
      accounts[accountCode] = created.id;
    }
    // A second facility with its own chart proves facility isolation.
    await createAccountScoped(
      { tenantId, facilityId: facilityB, actorUserId: preparer },
      {
        accountCode: '1000',
        accountName: 'Other facility cash',
        accountType: 'ASSET',
        subType: 'CASH_AT_BANK',
        normalBalance: 'DEBIT',
      },
    );

    // Twelve monthly periods for financial year 2025/2026 (July to June).
    const months = [
      ['2025-07', 'July 2025', '2025-07-01', '2025-07-31'],
      ['2025-08', 'August 2025', '2025-08-01', '2025-08-31'],
      ['2025-09', 'September 2025', '2025-09-01', '2025-09-30'],
      ['2025-10', 'October 2025', '2025-10-01', '2025-10-31'],
      ['2025-11', 'November 2025', '2025-11-01', '2025-11-30'],
      ['2025-12', 'December 2025', '2025-12-01', '2025-12-31'],
      ['2026-01', 'January 2026', '2026-01-01', '2026-01-31'],
      ['2026-02', 'February 2026', '2026-02-01', '2026-02-28'],
      ['2026-03', 'March 2026', '2026-03-01', '2026-03-31'],
      ['2026-04', 'April 2026', '2026-04-01', '2026-04-30'],
      ['2026-05', 'May 2026', '2026-05-01', '2026-05-31'],
      ['2026-06', 'June 2026', '2026-06-01', '2026-06-30'],
    ];
    for (const [periodCode, name, startDate, endDate] of months) {
      await createFinancialPeriodScoped(accountingScope(preparer), {
        periodCode,
        name,
        startDate,
        endDate,
      });
    }

    // July 2025 — opening position plus one month of trading.
    await post(
      '2025-07-01',
      'Opening capital and equipment',
      [
        ['1000', 50000, 0],
        ['3000', 0, 50000],
        ['1500', 100000, 0],
        ['1590', 0, 10000],
        ['2000', 0, 15000],
        ['3000', 0, 75000],
      ],
      'jul-open',
    );
    await postTagged(
      '2025-07-05',
      'Outpatient services invoiced',
      [
        ['1100', 30000, 0, true],
        ['4000', 0, 30000, false],
      ],
      'jul-invoice',
    );
    await postTagged(
      '2025-07-12',
      'Patient receipts',
      [
        ['1000', 25000, 0, false],
        ['1100', 0, 25000, true],
      ],
      'jul-receipt',
    );
    await post(
      '2025-07-20',
      'July salaries',
      [
        ['5000', 12000, 0],
        ['1000', 0, 12000],
      ],
      'jul-salaries',
    );
    await post(
      '2025-07-31',
      'July depreciation',
      [
        ['5100', 2500, 0],
        ['1590', 0, 2500],
      ],
      'jul-dep',
    );
    // August 2025.
    await postTagged(
      '2025-08-04',
      'August services invoiced',
      [
        ['1100', 40000, 0, true],
        ['4000', 0, 40000, false],
      ],
      'aug-invoice',
    );
    await postTagged(
      '2025-08-18',
      'August receipts',
      [
        ['1000', 20000, 0, false],
        ['1100', 0, 20000, true],
      ],
      'aug-receipt',
    );
    await post(
      '2025-08-25',
      'August salaries',
      [
        ['5000', 13000, 0],
        ['1000', 0, 13000],
      ],
      'aug-salaries',
    );
    // March 2026 — enough activity that the annual statement is not just July.
    await postTagged(
      '2026-03-10',
      'March services invoiced',
      [
        ['1100', 60000, 0, true],
        ['4000', 0, 60000, false],
      ],
      'mar-invoice',
    );
    await post(
      '2026-03-25',
      'March salaries',
      [
        ['5000', 10000, 0],
        ['1000', 0, 10000],
      ],
      'mar-salaries',
    );

    // One asset, and a posted depreciation batch for July, so the register and
    // the ledger have something to agree about.
    await pool.query(
      `INSERT INTO fixed_assets
         (tenant_id, facility_id, asset_code, asset_name, category, acquisition_date,
          acquisition_cost_kes, useful_life_months, accumulated_depreciation_kes, net_book_value_kes,
          asset_account_id, accum_dep_account_id, dep_expense_account_id, status)
       VALUES ($1,$2,'FA-001','Ultrasound scanner','Medical equipment','2024-07-01',
               '100000.00',120,'12500.00','87500.00',$3,$4,$5,'ACTIVE')`,
      [tenantId, facilityA, accounts['1500'], accounts['1590'], accounts['5100']],
    );
    await pool.query(
      `INSERT INTO fixed_asset_depreciation_batches
         (tenant_id, facility_id, period_code, entry_date, status, total_cents, asset_count, posted_at)
       VALUES ($1,$2,'2025-07','2025-07-31','POSTED',250000,1,now())`,
      [tenantId, facilityA],
    );

    // HTTP surface for permission and facility tests.
    const app = express();
    app.use(express.json());
    /*
     * The real permission middleware runs. Only the session lookup is replaced,
     * with the identity and permission list each request declares: this proves
     * the route gates on the permission code, not that the test can skip it.
     */
    app.use((req, _res, next) => {
      const permissions = String(req.get('X-Test-Permissions') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const userId = Number(req.get('X-Test-User') ?? preparer);
      const request = req as unknown as {
        user?: { id: number };
        authContext?: Record<string, unknown>;
      };
      request.user = { id: userId };
      request.authContext = {
        userId,
        tenantId,
        facilityId: facilityA,
        roles: ['FACILITY_ADMIN'],
        permissions,
        isSuperAdmin: false,
      };
      next();
    });
    app.use(routes);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  it('offers a financial-year default but records the month the facility chooses', async () => {
    const initial = await getSettingsScoped(scope);
    expect(initial.source).toBe('DEFAULT');
    expect(initial.financialYearStartMonth).toBe(7);

    const saved = await saveSettingsScoped(scope, {
      financialYearStartMonth: 7,
      retainedEarningsAccountId: accounts['3100'],
      preparedByName: 'Synthetic Accountant',
    });
    expect(saved.source).toBe('CONFIGURED');
    expect(saved.retainedEarningsAccountCode).toBe('3100');
  });

  it('refuses a year-end equity account that is not equity', async () => {
    await expect(
      saveSettingsScoped(scope, {
        financialYearStartMonth: 7,
        retainedEarningsAccountId: accounts['1000'],
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_EQUITY' });
    // Restore the configured account.
    await saveSettingsScoped(scope, {
      financialYearStartMonth: 7,
      retainedEarningsAccountId: accounts['3100'],
    });
  });

  it('generates a monthly statement set from posted journals', async () => {
    const run = await generateScoped(scope, {
      frequency: 'MONTHLY',
      startYear: 2025,
      month: 7,
      comparativeMode: 'NONE',
    });
    juliRun = run.id;
    expect(run.status).toBe('DRAFT');
    expect(run.readyForApproval).toBe(true);
    expect(run.failedChecks).toEqual([]);

    const detail = await getRunScoped(scope, run.id);
    const payload = detail.payload;
    expect(payload.statements.financialPosition.totals.assetsCents).toBe('15550000');
    expect(payload.statements.financialPosition.totals.equityCents).toBe('14050000');
    expect(payload.statements.financialPosition.totals.liabilitiesCents).toBe('1500000');
    expect(payload.statements.incomeStatement.totals.netResultCents).toBe('1550000');
    expect(payload.statements.cashFlows.totals.closingCashCents).toBe('6300000');
    expect(payload.statements.financialPosition.balanced.current).toBe(true);
    expect(payload.schedules.trialBalance.ties).toBe(true);
    expect(payload.schedules.fixedAssets.reconciliation.costDifferenceCents).toBe('0');
    expect(payload.schedules.fixedAssets.reconciliation.chargeDifferenceCents).toBe('0');
    expect(detail.staleSinceApproval).toBe(false);
  });

  it('refuses to approve a statement that has not been reviewed', async () => {
    await expect(approveRunScoped(scope, juliRun, 'Looks right')).rejects.toMatchObject({
      code: 'REVIEW_REQUIRED',
    });
  });

  it('separates review from approval', async () => {
    const reviewed = await reviewRunScoped(
      { ...scope, actorUserId: reviewer },
      juliRun,
      'Checked the ledger',
    );
    expect(reviewed.status).toBe('REVIEWED');
    await expect(
      approveRunScoped({ ...scope, actorUserId: reviewer }, juliRun, 'Self approval'),
    ).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTIES' });

    const approved = await approveRunScoped(
      { ...scope, actorUserId: approver },
      juliRun,
      'Approved for July',
    );
    expect(approved.status).toBe('APPROVED');
    expect(approved.periodClose.closed).toBe(true);
    const period = await pool.query(
      "SELECT status FROM financial_periods WHERE facility_id=$1 AND period_code='2025-07'",
      [facilityA],
    );
    expect(period.rows[0].status).toBe('CLOSED');
  });

  it('freezes an approved statement in the database', async () => {
    await expect(
      pool.query('UPDATE financial_statement_runs SET payload = $1::jsonb WHERE id = $2', [
        JSON.stringify({ tampered: true }),
        juliRun,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('UPDATE financial_statement_runs SET status = $1 WHERE id = $2', [
        'DRAFT',
        juliRun,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM financial_statement_runs WHERE id = $1', [juliRun]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses to generate over an approved period', async () => {
    await expect(
      generateScoped(scope, {
        frequency: 'MONTHLY',
        startYear: 2025,
        month: 7,
        comparativeMode: 'NONE',
      }),
    ).rejects.toMatchObject({ code: 'STATEMENT_FINALISED' });
  });

  it('creates a revised version instead of overwriting the approved one', async () => {
    const revision = await reviseRunScoped(
      { ...scope, actorUserId: approver },
      juliRun,
      'Restating July after the depreciation batch was confirmed.',
    );
    juliRevision = revision.id;
    expect(revision.version).toBe(2);
    expect(revision.supersedesId).toBe(juliRun);
    expect(revision.status).toBe('DRAFT');

    const original = await getRunScoped(scope, juliRun);
    expect(original.status).toBe('APPROVED');

    await reviewRunScoped({ ...scope, actorUserId: reviewer }, juliRevision, 'Revision reviewed');
    const approved = await approveRunScoped(
      { ...scope, actorUserId: approver },
      juliRevision,
      'Revision approved',
    );
    expect(approved.supersededRunId).toBe(juliRun);

    const superseded = await getRunScoped(scope, juliRun);
    expect(superseded.status).toBe('SUPERSEDED');
    // The superseded figures are still readable and unchanged.
    expect(superseded.payload.statements.financialPosition.totals.assetsCents).toBe('15550000');
  });

  it('carries August opening balances from the approved July closing', async () => {
    const run = await generateScoped(scope, {
      frequency: 'MONTHLY',
      startYear: 2025,
      month: 8,
      comparativeMode: 'PRIOR_PERIOD',
    });
    augustRun = run.id;
    const detail = await getRunScoped(scope, run.id);
    const check = detail.payload.checks.find(
      (entry) => entry.code === 'OPENING_EQUALS_PRIOR_CLOSING',
    );
    expect(check?.status).toBe('PASS');
    expect(detail.payload.statements.financialPosition.opening.assetsCents).toBe('15550000');
    expect(detail.payload.statements.financialPosition.totals.assetsCents).toBe('18250000');
    expect(detail.payload.statements.incomeStatement.totals.netResultCents).toBe('2700000');
    // Comparative columns come from July, which is one month earlier.
    expect(detail.payload.statements.incomeStatement.totals.priorNetResultCents).toBe('1550000');
    expect(detail.payload.statements.financialPosition.totals.priorAssetsCents).toBe('15550000');
  });

  it('closes a financial year into the configured equity account', async () => {
    const close = await closeFinancialYearScoped(
      { ...scope, actorUserId: approver },
      {
        startYear: 2025,
        reason: 'Annual close for the synthetic 2025/2026 year',
      },
    );
    expect(close.financialYear).toBe('2025/2026');
    expect(close.entryDate).toBe('2026-06-30');
    // Revenue 130,000 less expenses 37,500 = 92,500.
    expect(close.netResultCents).toBe('9250000');
    expect(close.retainedEarningsAccountCode).toBe('3100');

    const balances = await pool.query(
      `SELECT a.account_code, COALESCE(SUM(l.debit_cents - l.credit_cents),0)::text AS net
         FROM chart_of_accounts a JOIN journal_lines l ON l.account_id = a.id
        WHERE a.facility_id = $1 AND a.account_type IN ('REVENUE','EXPENSE')
        GROUP BY a.account_code ORDER BY a.account_code`,
      [facilityA],
    );
    expect(balances.rows.every((row) => row.net === '0')).toBe(true);

    await expect(
      closeFinancialYearScoped(
        { ...scope, actorUserId: approver },
        {
          startYear: 2025,
          reason: 'Second attempt',
        },
      ),
    ).rejects.toMatchObject({ code: 'YEAR_ALREADY_CLOSED' });
  });

  it('still reports the year result after the close', async () => {
    const run = await generateScoped(scope, {
      frequency: 'ANNUAL',
      startYear: 2025,
      comparativeMode: 'NONE',
    });
    annualRun = run.id;
    const detail = await getRunScoped(scope, run.id);
    const income = detail.payload.statements.incomeStatement;
    expect(income.totals.netResultCents).toBe('9250000');
    const bs = detail.payload.statements.financialPosition;
    // Capital 125,000.00 + retained earnings 92,500.00
    expect(bs.totals.equityCents).toBe('21750000');
    expect(bs.balanced.current).toBe(true);
    expect(bs.rows.find((row) => row.key === 'RESULT_TRANSFER')?.currentCents).toBe('-9250000');
    expect(detail.payload.statements.cashFlows.ties.current).toBe(true);
  });

  it('records the ledger watermark and detects later postings', async () => {
    const detail = await getRunScoped(scope, augustRun);
    const watermarkBefore = detail.journalCount;
    const throughBefore = detail.ledgerThrough;
    expect(detail.payload.meta.journalCount).toBe(watermarkBefore);
    expect(detail.payload.meta.ledgerThrough).toBe(throughBefore);

    await post(
      '2025-08-30',
      'Late August adjustment',
      [
        ['5000', 1000, 0],
        ['2100', 0, 1000],
      ],
      'aug-late',
    );

    // The archived watermark is a fact about the ledger at generation time and
    // does not move; the drift is what the next approval attempt proves.
    const after = await getRunScoped(scope, augustRun);
    expect(after.journalCount).toBe(watermarkBefore);
    expect(after.ledgerThrough).toBe(throughBefore);
    expect(after.payload.meta.journalCount).toBe(watermarkBefore);
  });

  it('refuses to approve a statement whose ledger moved after generation', async () => {
    await reviewRunScoped({ ...scope, actorUserId: reviewer }, augustRun, 'August reviewed');
    await expect(
      approveRunScoped({ ...scope, actorUserId: approver }, augustRun, 'August approved'),
    ).rejects.toMatchObject({ code: 'LEDGER_MOVED' });
  });

  it('exports a PDF and an Excel workbook and records both', async () => {
    const pdf = await exportRunScoped(scope, juliRevision, 'pdf', 'ALL');
    expect(pdf.contentType).toBe('application/pdf');
    expect(Buffer.from(pdf.base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.filename.endsWith('.pdf')).toBe(true);

    const excel = await exportRunScoped(scope, juliRevision, 'xlsx', 'ALL');
    expect(excel.contentType).toContain('spreadsheetml');
    expect(Buffer.from(excel.base64, 'base64').subarray(0, 2).toString()).toBe('PK');

    const single = await exportRunScoped(scope, juliRevision, 'pdf', 'trialBalance');
    expect(single.byteLength).toBeGreaterThan(500);

    const detail = await getRunScoped(scope, juliRevision);
    expect(detail.exports).toHaveLength(3);
    expect(detail.exports.map((entry) => entry.format).sort()).toEqual(['PDF', 'PDF', 'XLSX']);
  });

  it('retrieves an approved statement from the archive with its version chain', async () => {
    const runs = await listRunsScoped(scope, { financialYear: '2025/2026' });
    const juliVersions = runs.filter(
      (run) => run.frequency === 'MONTHLY' && run.periodStart === '2025-07-01',
    );
    expect(juliVersions).toHaveLength(2);
    expect(juliVersions.map((run) => run.status).sort()).toEqual(['APPROVED', 'SUPERSEDED']);

    const detail = await getRunScoped(scope, juliRevision);
    expect(detail.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(detail.approvedByName).toBe('Synthetic approver');
    expect(detail.reviewedByName).toBe('Synthetic reviewer');
    expect(detail.events.some((event: { action: string }) => event.action === 'APPROVE')).toBe(
      true,
    );
    expect(detail.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a superseded statement export and a revision of a superseded version', async () => {
    await expect(exportRunScoped(scope, juliRun, 'pdf', 'ALL')).rejects.toMatchObject({
      code: 'SUPERSEDED',
    });
    await expect(
      reviseRunScoped({ ...scope, actorUserId: approver }, juliRun, 'Too late'),
    ).rejects.toMatchObject({ code: 'SUPERSEDED' });
  });

  it('never exposes another facility’s statement', async () => {
    await expect(getRunScoped(otherScope, juliRevision)).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
    });
    await expect(exportRunScoped(otherScope, juliRevision, 'pdf', 'ALL')).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
    });
    await expect(
      reviseRunScoped({ ...otherScope, actorUserId: approver }, juliRevision, 'Cross facility'),
    ).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
    });
    expect(await listRunsScoped(otherScope, {})).toEqual([]);
  });

  it('refuses to generate for a facility with no chart of accounts', async () => {
    // Facility B has one cash account and no postings: the statement still
    // generates (an empty ledger is a valid state) but carries no figures.
    const run = await generateScoped(otherScope, {
      frequency: 'MONTHLY',
      startYear: 2025,
      month: 7,
      comparativeMode: 'NONE',
    });
    const detail = await getRunScoped(otherScope, run.id);
    expect(detail.payload.statements.financialPosition.totals.assetsCents).toBe('0');
    expect(detail.payload.statements.financialPosition.balanced.current).toBe(true);
    // Facility A's figures are not visible in facility B's statement.
    expect(detail.payload.statements.incomeStatement.totals.netResultCents).toBe('0');
  });

  it('blocks approval when a bank book balance disagrees with the ledger', async () => {
    const bank = await pool.query(
      `INSERT INTO bank_accounts(tenant_id,facility_id,account_name,bank_code,bank_name,gl_account_id,
                                 account_number_masked,opening_balance_kes,book_balance_kes)
       VALUES($1,$2,'Synthetic bank','068','Equity Bank',$3,'****1234','0.00','1.00') RETURNING id`,
      [tenantId, facilityA, accounts['1000']],
    );
    expect(bank.rows[0].id).toBeGreaterThan(0);

    const run = await generateScoped(scope, {
      frequency: 'MONTHLY',
      startYear: 2025,
      month: 9,
      comparativeMode: 'NONE',
    });
    const detail = await getRunScoped(scope, run.id);
    const check = detail.payload.checks.find((entry) => entry.code === 'BANK_BOOK_BALANCE');
    expect(check?.status).toBe('FAIL');
    expect(detail.payload.readyForApproval).toBe(false);

    await expect(
      reviewRunScoped({ ...scope, actorUserId: reviewer }, run.id, 'Should not pass'),
    ).rejects.toMatchObject({ code: 'CHECKS_FAILING' });

    // Correcting the bank book balance unblocks the next generation.
    await pool.query('UPDATE bank_accounts SET book_balance_kes = $1 WHERE id = $2', [
      '63000.00',
      bank.rows[0].id,
    ]);
  });

  it('records a presentation override and rejects one that crosses sides', async () => {
    const mapping = await saveMappingScoped(scope, {
      accountId: accounts['2100'],
      presentationGroup: 'PAYABLES',
    });
    expect(mapping.find((entry) => entry.accountCode === '2100')?.source).toBe('OVERRIDE');
    await expect(
      saveMappingScoped(scope, { accountId: accounts['2100'], presentationGroup: 'CASH_AT_BANK' }),
    ).rejects.toMatchObject({ code: 'INVALID_GROUP' });
    await saveMappingScoped(scope, { accountId: accounts['2100'], presentationGroup: null });
  });

  it('enforces the statement permissions on the HTTP surface', async () => {
    const call = (path: string, body: unknown, permissions: string, user = preparer) =>
      fetch(base + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Test-Permissions': permissions,
          'X-Test-User': String(user),
        },
        body: JSON.stringify(body),
      });

    const readOnly = await call(
      '/runs',
      { frequency: 'MONTHLY', startYear: 2025, month: 10, comparativeMode: 'NONE' },
      'accounting.read',
    );
    expect(readOnly.status).toBe(403);

    const wrongPermission = await call(
      '/runs',
      { frequency: 'MONTHLY', startYear: 2025, month: 10, comparativeMode: 'NONE' },
      'accounting.statements.review',
    );
    expect(wrongPermission.status).toBe(403);

    const allowed = await call(
      '/runs',
      { frequency: 'MONTHLY', startYear: 2025, month: 10, comparativeMode: 'NONE' },
      'accounting.statements.prepare',
    );
    expect(allowed.status).toBe(201);
    const created = (await allowed.json()) as { id: number };
    expect(created.id).toBeGreaterThan(0);

    const approveWithoutPermission = await call(
      `/runs/${created.id}/approve`,
      { comment: 'No permission' },
      'accounting.statements.prepare',
    );
    expect(approveWithoutPermission.status).toBe(403);

    const otherFacility = await fetch(`${base}/runs/${created.id}?facilityId=${facilityB}`, {
      headers: {
        'X-Test-Permissions': 'accounting.read',
        'X-Test-User': String(preparer),
      },
    });
    expect(otherFacility.status).toBe(403);
  });

  it('validates the generation body and refuses cash-basis statements', async () => {
    const response = await fetch(base + '/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Permissions': 'accounting.statements.prepare',
        'X-Test-User': String(preparer),
      },
      body: JSON.stringify({ frequency: 'MONTHLY', startYear: 2025 }),
    });
    expect(response.status).toBe(400);

    await expect(
      generateScoped(scope, {
        frequency: 'MONTHLY',
        startYear: 2025,
        month: 11,
        accountingBasis: 'CASH',
      }),
    ).rejects.toMatchObject({ code: 'BASIS_NOT_SUPPORTED' });
  });

  it('audits every statement action', async () => {
    const events = await pool.query(
      `SELECT action FROM audit_logs
        WHERE tenant_id = $1 AND facility_id = $2 AND resource = 'financial_statement_run'
        ORDER BY id`,
      [tenantId, facilityA],
    );
    const actions = events.rows.map((row) => String(row.action));
    for (const expected of ['GENERATE', 'REVIEW', 'APPROVE', 'REVISE']) {
      expect(actions).toContain(expected);
    }
    const closeEvent = await pool.query(
      `SELECT action FROM audit_logs
        WHERE tenant_id = $1 AND facility_id = $2 AND resource = 'financial_year' AND action = 'YEAR_END_CLOSE'`,
      [tenantId, facilityA],
    );
    expect(closeEvent.rows).toHaveLength(1);
  });

  it('reopens a closed period with a reason and reports affected statements', async () => {
    const period = await pool.query(
      "SELECT id FROM financial_periods WHERE facility_id=$1 AND period_code='2025-07'",
      [facilityA],
    );
    const result = await reopenPeriodScoped(
      { ...scope, actorUserId: approver },
      {
        periodId: Number(period.rows[0].id),
        reason: 'Reopening July to post a confirmed supplier credit note.',
      },
    );
    expect(result.affectedStatements.map((entry) => entry.id)).toContain(juliRevision);
    const reopened = await pool.query(
      "SELECT status FROM financial_periods WHERE facility_id=$1 AND period_code='2025-07'",
      [facilityA],
    );
    expect(reopened.rows[0].status).toBe('OPEN');
    // The approved statement keeps its figures and status; the ledger drift is
    // what a reader sees.
    expect((await getRunScoped(scope, juliRevision)).status).toBe('APPROVED');
  });

  it('has an immutable approved row and append-only exports', async () => {
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'financial_statement_runs' ORDER BY ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        'payload',
        'payload_hash',
        'checks',
        'notes',
        'ledger_through',
        'journal_count',
        'supersedes_id',
        'source_period_ids',
      ]),
    );
    const triggers = await pool.query(
      `SELECT tgname FROM pg_trigger WHERE tgname IN
         ('financial_statement_runs_immutable','financial_statement_exports_append_only')`,
    );
    expect(triggers.rows).toHaveLength(2);
  });
});
