import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.ts';
import {
  closeFinancialPeriodScoped,
  createAccountScoped,
  createFinancialPeriodScoped,
  getAccountingOverviewScoped,
  postJournalScoped,
  reverseJournalScoped,
  type AccountingScope,
} from '../../accounting/accounting.service.ts';
import { describeDb } from './support/db.ts';

// Synthetic disposable PostgreSQL data only; no real patients or credentials.
describeDb('facility ledger against PostgreSQL', () => {
  let a: AccountingScope;
  let b: AccountingScope;
  let asset: { id: number };
  let revenue: { id: number };
  let foreign: { id: number };
  let periodJan: { id: number };
  let journalId: number;

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? 'jalicare_test').includes('test'))
      throw new Error('Test database required.');
    const suffix = randomUUID().slice(0, 8);
    const tenant = await pool.query(
      'INSERT INTO tenants (name,slug) VALUES ($1,$2),($3,$4) RETURNING id',
      [`Ledger A ${suffix}`, `led-a-${suffix}`, `Ledger B ${suffix}`, `led-b-${suffix}`],
    );
    const facilities = await pool.query(
      'INSERT INTO facilities (tenant_id,code,name) VALUES ($1,$2,$3),($4,$5,$6) RETURNING id',
      [
        tenant.rows[0].id,
        `LA-${suffix}`,
        'Synthetic A',
        tenant.rows[1].id,
        `LB-${suffix}`,
        'Synthetic B',
      ],
    );
    const users = await pool.query(
      'INSERT INTO users (uid,username,email,password_hash,full_name,tenant_id,facility_id) VALUES ($1,$2,$3,$4,$5,$6,$7),($8,$9,$10,$11,$12,$13,$14) RETURNING id',
      [
        `la-${suffix}`,
        `la-${suffix}`,
        `la-${suffix}@example.test`,
        'test-only',
        'Synthetic A',
        tenant.rows[0].id,
        facilities.rows[0].id,
        `lb-${suffix}`,
        `lb-${suffix}`,
        `lb-${suffix}@example.test`,
        'test-only',
        'Synthetic B',
        tenant.rows[1].id,
        facilities.rows[1].id,
      ],
    );
    a = {
      tenantId: tenant.rows[0].id,
      facilityId: facilities.rows[0].id,
      actorUserId: users.rows[0].id,
    };
    b = {
      tenantId: tenant.rows[1].id,
      facilityId: facilities.rows[1].id,
      actorUserId: users.rows[1].id,
    };
    asset = await createAccountScoped(a, {
      accountCode: '1100',
      accountName: 'Receivable',
      accountType: 'ASSET',
      subType: 'RECEIVABLE',
      normalBalance: 'DEBIT',
    });
    revenue = await createAccountScoped(a, {
      accountCode: '4000',
      accountName: 'Revenue',
      accountType: 'REVENUE',
      subType: 'REVENUE',
      normalBalance: 'CREDIT',
    });
    foreign = await createAccountScoped(b, {
      accountCode: '1100',
      accountName: 'Foreign receivable',
      accountType: 'ASSET',
      subType: 'RECEIVABLE',
      normalBalance: 'DEBIT',
    });
    periodJan = await createFinancialPeriodScoped(a, {
      periodCode: '2026-01',
      name: 'January',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    await createFinancialPeriodScoped(a, {
      periodCode: '2026-02',
      name: 'February',
      startDate: '2026-02-01',
      endDate: '2026-02-28',
    });
  });

  it('rejects overlapping periods and accounts from another facility', async () => {
    await expect(
      createFinancialPeriodScoped(a, {
        periodCode: 'overlap',
        name: 'Overlap',
        startDate: '2026-01-31',
        endDate: '2026-02-02',
      }),
    ).rejects.toMatchObject({ code: 'PERIOD_CONFLICT' });
    await expect(
      postJournalScoped(a, {
        entryDate: '2026-01-10',
        description: 'Cross facility',
        idempotencyKey: 'cross',
        lines: [
          { accountId: foreign.id, debitKes: '1.00' },
          { accountId: revenue.id, creditKes: '1.00' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_OUT_OF_SCOPE' });
  });

  it('atomically posts once under concurrent retries and rejects idempotency-key reuse', async () => {
    const request = {
      entryDate: '2026-01-10',
      description: 'Synthetic accrual',
      idempotencyKey: 'same-journal',
      lines: [
        { accountId: asset.id, debitKes: '100.00' },
        { accountId: revenue.id, creditKes: '100.00' },
      ],
    };
    const results = await Promise.all([
      postJournalScoped(a, request),
      postJournalScoped(a, request),
    ]);
    expect(results.filter((r) => r.idempotentReplay)).toHaveLength(1);
    expect(results[0].journal.id).toBe(results[1].journal.id);
    journalId = results[0].journal.id;
    await expect(
      postJournalScoped(a, { ...request, description: 'Different request' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const lines = await pool.query(
      'SELECT COUNT(*)::int AS count FROM journal_lines WHERE journal_entry_id=$1',
      [journalId],
    );
    expect(lines.rows[0].count).toBe(2);
    const audit = await pool.query(
      "SELECT COUNT(*)::int AS count FROM audit_logs WHERE resource='journal_entries' AND resource_id=$1 AND action='POST'",
      [String(journalId)],
    );
    expect(audit.rows[0].count).toBe(1);
  });

  it('protects posted lines and rejects unbalanced direct SQL writes at commit', async () => {
    await expect(
      pool.query('UPDATE journal_lines SET debit_cents=1 WHERE journal_entry_id=$1', [journalId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query("UPDATE journal_entries SET description='rewritten' WHERE id=$1", [journalId]),
    ).rejects.toMatchObject({ code: '23514' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const header = await client.query(
        `INSERT INTO journal_entries (tenant_id,facility_id,period_id,journal_number,entry_date,source_type,idempotency_key,request_hash,description,status,total_debit_cents,total_credit_cents,posted_by_user_id) VALUES ($1,$2,$3,$4,'2026-01-12','MANUAL',$5,'hash','SQL test','DRAFT',100,100,$6) RETURNING id`,
        [
          a.tenantId,
          a.facilityId,
          periodJan.id,
          `raw-${randomUUID()}`,
          `raw-${randomUUID()}`,
          a.actorUserId,
        ],
      );
      await client.query(
        'INSERT INTO journal_lines (journal_entry_id,account_id,debit_cents,credit_cents) VALUES ($1,$2,100,0),($1,$3,0,50)',
        [header.rows[0].id, asset.id, revenue.id],
      );
      await client.query("UPDATE journal_entries SET status='POSTED' WHERE id=$1", [
        header.rows[0].id,
      ]);
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('closes a period, requires reversal in an open period and keeps both journals', async () => {
    await closeFinancialPeriodScoped(a, periodJan.id, 'Month-end review');
    await expect(
      postJournalScoped(a, {
        entryDate: '2026-01-20',
        description: 'Late',
        idempotencyKey: 'late',
        lines: [
          { accountId: asset.id, debitKes: '1.00' },
          { accountId: revenue.id, creditKes: '1.00' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'OPEN_PERIOD_REQUIRED' });
    await expect(
      reverseJournalScoped(a, journalId, {
        entryDate: '2026-01-25',
        reason: 'Correction',
        idempotencyKey: 'rev-closed',
      }),
    ).rejects.toMatchObject({ code: 'OPEN_PERIOD_REQUIRED' });
    const reversed = await reverseJournalScoped(a, journalId, {
      entryDate: '2026-02-05',
      reason: 'Correction',
      idempotencyKey: 'rev-open',
    });
    expect(reversed.journal.id).not.toBe(journalId);
    const replay = await reverseJournalScoped(a, journalId, {
      entryDate: '2026-02-05',
      reason: 'Correction',
      idempotencyKey: 'rev-open',
    });
    expect(replay.idempotentReplay).toBe(true);
    await expect(
      reverseJournalScoped(a, journalId, {
        entryDate: '2026-02-05',
        reason: 'Another reversal',
        idempotencyKey: 'rev-other',
      }),
    ).rejects.toMatchObject({ code: 'JOURNAL_ALREADY_REVERSED' });
    const jan = await getAccountingOverviewScoped(a, '2026-01-01', '2026-01-31');
    const feb = await getAccountingOverviewScoped(a, '2026-01-01', '2026-02-28');
    expect(jan.trialBalance).toMatchObject({
      debitKes: '100.00',
      creditKes: '100.00',
      balanced: true,
    });
    expect(jan.balanceSheet.balanced).toBe(true);
    expect(feb.profitAndLoss.ledgerResultKes).toBe('0.00');
    expect(feb.balanceSheet.balanced).toBe(true);
    expect(feb.limitations.billingReconciliation).toBe('NOT_IMPLEMENTED');
  });
});
