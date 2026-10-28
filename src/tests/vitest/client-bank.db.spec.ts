import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { pool } from '../../db/index.ts';
import { describeDb } from './support/db.ts';
import {
  createAccountScoped,
  createFinancialPeriodScoped,
  postJournalScoped,
  type AccountingScope,
} from '../../accounting/accounting.service.ts';
import {
  createBankAccountScoped,
  importStatementScoped,
  matchBankTransactionScoped,
  previewBankReconciliationScoped,
  saveBankReconciliationScoped,
} from '../../accounting/bank-integration.service.ts';

describeDb('imported bank statement reconciliation against PostgreSQL', () => {
  let a: AccountingScope,
    b: AccountingScope,
    bankAccountId: number,
    lineId: number,
    statementId: number,
    bankTxId: number;
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? 'jalicare_test').includes('test'))
      throw new Error('Test database required.');
    const x = randomUUID().slice(0, 8);
    const t = await pool.query(
      'INSERT INTO tenants (name,slug) VALUES ($1,$2),($3,$4) RETURNING id',
      [`Bank A ${x}`, `bank-a-${x}`, `Bank B ${x}`, `bank-b-${x}`],
    );
    const f = await pool.query(
      'INSERT INTO facilities (tenant_id,code,name) VALUES ($1,$2,$3),($4,$5,$6) RETURNING id',
      [t.rows[0].id, `KA-${x}`, 'Synthetic A', t.rows[1].id, `KB-${x}`, 'Synthetic B'],
    );
    const u = await pool.query(
      'INSERT INTO users (uid,username,email,password_hash,full_name,tenant_id,facility_id) VALUES ($1,$2,$3,$4,$5,$6,$7),($8,$9,$10,$11,$12,$13,$14) RETURNING id',
      [
        `ka-${x}`,
        `ka-${x}`,
        `ka-${x}@example.test`,
        'test',
        'Synthetic',
        t.rows[0].id,
        f.rows[0].id,
        `kb-${x}`,
        `kb-${x}`,
        `kb-${x}@example.test`,
        'test',
        'Synthetic',
        t.rows[1].id,
        f.rows[1].id,
      ],
    );
    a = { tenantId: t.rows[0].id, facilityId: f.rows[0].id, actorUserId: u.rows[0].id };
    b = { tenantId: t.rows[1].id, facilityId: f.rows[1].id, actorUserId: u.rows[1].id };
    const bankGl = await createAccountScoped(a, {
      accountCode: '101',
      accountName: 'Bank',
      accountType: 'ASSET',
      subType: 'BANK',
      normalBalance: 'DEBIT',
    });
    const revenue = await createAccountScoped(a, {
      accountCode: '401',
      accountName: 'Income',
      accountType: 'REVENUE',
      subType: 'GENERAL',
      normalBalance: 'CREDIT',
    });
    await createFinancialPeriodScoped(a, {
      periodCode: '2026-10',
      name: 'October',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    const journal = await postJournalScoped(a, {
      entryDate: '2026-10-10',
      description: 'Synthetic receipt',
      idempotencyKey: 'journal',
      lines: [
        { accountId: bankGl.id, debitKes: '100.00' },
        { accountId: revenue.id, creditKes: '100.00' },
      ],
    });
    const line = await pool.query(
      'SELECT id FROM journal_lines WHERE journal_entry_id=$1 AND account_id=$2',
      [journal.journal.id, bankGl.id],
    );
    lineId = line.rows[0].id;
    const account = await createBankAccountScoped(a, {
      accountName: 'Synthetic account',
      bankCode: 'TEST',
      bankName: 'Synthetic bank',
      accountLastFour: '1234',
      glAccountId: bankGl.id,
    });
    bankAccountId = account.id;
    expect(account.connectorMode).toBe('STATEMENT_IMPORT_ONLY');
  });
  it('imports atomically, detects retries and refuses cross-facility access', async () => {
    const input = {
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      closingBalanceKes: '100.00',
      csvText:
        'date,reference,description,direction,amount\n2026-10-10,REF-1,Synthetic receipt,INFLOW,100.00',
    };
    const first = await importStatementScoped(a, bankAccountId, input);
    statementId = first.statementImportId;
    expect((await importStatementScoped(a, bankAccountId, input)).idempotentReplay).toBe(true);
    await expect(importStatementScoped(b, bankAccountId, input)).rejects.toMatchObject({
      code: 'BANK_ACCOUNT_NOT_FOUND',
    });
    await expect(
      importStatementScoped(a, bankAccountId, { ...input, closingBalanceKes: '200.00' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_STATEMENT_LINE' });
    const imports = await pool.query(
      'SELECT count(*)::int AS count FROM bank_statement_imports WHERE bank_account_id=$1',
      [bankAccountId],
    );
    expect(imports.rows[0].count).toBe(1);
    const txs = await pool.query(
      'SELECT id,origin_classification FROM bank_transactions WHERE statement_import_id=$1',
      [statementId],
    );
    bankTxId = txs.rows[0].id;
    expect(txs.rows[0].origin_classification).toBe('IMPORTED_STATEMENT');
  });
  it('matches the exact posted bank ledger line and requires review', async () => {
    const before = await previewBankReconciliationScoped(a, bankAccountId, statementId);
    expect(before.unmatchedStatementCount).toBe(1);
    expect(before.bankConfirmed).toBe(false);
    await expect(
      saveBankReconciliationScoped(a, bankAccountId, statementId, {
        idempotencyKey: 'rec',
        periodCode: '2026-10',
        reviewNotes: 'Synthetic review',
      }),
    ).rejects.toMatchObject({ code: 'RECONCILIATION_INCOMPLETE' });
    await expect(matchBankTransactionScoped(b, bankTxId, lineId)).rejects.toMatchObject({
      code: 'BANK_TRANSACTION_NOT_FOUND',
    });
    expect((await matchBankTransactionScoped(a, bankTxId, lineId)).idempotentReplay).toBe(false);
    expect((await matchBankTransactionScoped(a, bankTxId, lineId)).idempotentReplay).toBe(true);
    const after = await previewBankReconciliationScoped(a, bankAccountId, statementId);
    expect(after).toMatchObject({
      worksheetBalanced: true,
      differenceKes: '0.00',
      unmatchedStatementCount: 0,
      bankConfirmed: false,
    });
    const saved = await saveBankReconciliationScoped(a, bankAccountId, statementId, {
      idempotencyKey: 'rec',
      periodCode: '2026-10',
      reviewNotes: 'Synthetic review',
    });
    expect(saved.idempotentReplay).toBe(false);
    expect(
      (
        await saveBankReconciliationScoped(a, bankAccountId, statementId, {
          idempotencyKey: 'rec',
          periodCode: '2026-10',
          reviewNotes: 'Synthetic review',
        })
      ).idempotentReplay,
    ).toBe(true);
    const status = await pool.query('SELECT status FROM bank_reconciliations WHERE id=$1', [
      saved.reconciliationId,
    ]);
    expect(status.rows[0].status).toBe('REVIEWED_IMPORT');
  });
});
