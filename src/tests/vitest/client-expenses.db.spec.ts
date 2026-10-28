import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { pool } from '../../db/index.ts';
import { describeDb } from './support/db.ts';
import {
  closeFinancialPeriodScoped,
  createAccountScoped,
  createExpenseRequestScoped,
  createFinancialPeriodScoped,
  decideExpenseRequestScoped,
  postApprovedExpenseScoped,
  type AccountingScope,
} from '../../accounting/accounting.service.ts';

describeDb('expense request controls against PostgreSQL', () => {
  let requester: AccountingScope,
    reviewer: AccountingScope,
    expenseAccount: number,
    payableAccount: number,
    periodId: number,
    expenseId: number;
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? 'jalicare_test').includes('test'))
      throw new Error('Test database required.');
    const x = randomUUID().slice(0, 8);
    const t = await pool.query('INSERT INTO tenants (name,slug) VALUES ($1,$2) RETURNING id', [
      `Expense ${x}`,
      `exp-${x}`,
    ]);
    const f = await pool.query(
      'INSERT INTO facilities (tenant_id,code,name) VALUES ($1,$2,$3) RETURNING id',
      [t.rows[0].id, `EX-${x}`, 'Synthetic'],
    );
    const users = await pool.query(
      'INSERT INTO users (uid,username,email,password_hash,full_name,tenant_id,facility_id) VALUES ($1,$2,$3,$4,$5,$6,$7),($8,$9,$10,$11,$12,$13,$14) RETURNING id',
      [
        `ex1-${x}`,
        `ex1-${x}`,
        `ex1-${x}@example.test`,
        'test',
        'Synthetic requester',
        t.rows[0].id,
        f.rows[0].id,
        `ex2-${x}`,
        `ex2-${x}`,
        `ex2-${x}@example.test`,
        'test',
        'Synthetic reviewer',
        t.rows[0].id,
        f.rows[0].id,
      ],
    );
    requester = { tenantId: t.rows[0].id, facilityId: f.rows[0].id, actorUserId: users.rows[0].id };
    reviewer = { ...requester, actorUserId: users.rows[1].id };
    expenseAccount = (
      await createAccountScoped(requester, {
        accountCode: '500',
        accountName: 'Expense',
        accountType: 'EXPENSE',
        subType: 'GENERAL',
        normalBalance: 'DEBIT',
      })
    ).id;
    payableAccount = (
      await createAccountScoped(requester, {
        accountCode: '200',
        accountName: 'Payable',
        accountType: 'LIABILITY',
        subType: 'PAYABLE',
        normalBalance: 'CREDIT',
      })
    ).id;
    periodId = (
      await createFinancialPeriodScoped(requester, {
        periodCode: '2026-10',
        name: 'October',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
      })
    ).id;
  });
  it('requires an independent approval and posts a payable, not a payment', async () => {
    const input = {
      expenseAccountId: expenseAccount,
      payableAccountId: payableAccount,
      amountKes: '50.00',
      incurredDate: '2026-10-10',
      idempotencyKey: 'expense-1',
      payeeName: 'Synthetic supplier',
      category: 'Synthetic',
      description: 'Synthetic expense',
      supportingDocuments: [{ name: 'Receipt', storageReference: 'private/receipt.pdf' }],
    };
    const created = await createExpenseRequestScoped(requester, input);
    expenseId = created.expenseId;
    expect(created.documentsVerified).toBe(false);
    expect((await createExpenseRequestScoped(requester, input)).idempotentReplay).toBe(true);
    await expect(
      createExpenseRequestScoped(requester, { ...input, amountKes: '51.00' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(postApprovedExpenseScoped(reviewer, expenseId)).rejects.toMatchObject({
      code: 'EXPENSE_NOT_APPROVED',
    });
    await expect(
      decideExpenseRequestScoped(requester, expenseId, { decision: 'APPROVE', notes: 'Self' }),
    ).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
    await decideExpenseRequestScoped(reviewer, expenseId, {
      decision: 'APPROVE',
      notes: 'Reviewed by another user',
    });
    const posted = await postApprovedExpenseScoped(reviewer, expenseId);
    expect(posted.paymentRecorded).toBe(false);
    expect((await postApprovedExpenseScoped(reviewer, expenseId)).idempotentReplay).toBe(true);
    const lines = await pool.query(
      'SELECT debit_cents,credit_cents FROM journal_lines WHERE journal_entry_id=$1 ORDER BY id',
      [posted.journalId],
    );
    expect(lines.rows).toHaveLength(2);
  });
  it('does not partially post an approved request into a closed period', async () => {
    const second = await createExpenseRequestScoped(requester, {
      expenseAccountId: expenseAccount,
      payableAccountId: payableAccount,
      amountKes: '10.00',
      incurredDate: '2026-10-11',
      idempotencyKey: 'expense-2',
      payeeName: 'Synthetic',
      category: 'Synthetic',
      description: 'Synthetic',
    });
    await decideExpenseRequestScoped(reviewer, second.expenseId, {
      decision: 'APPROVE',
      notes: 'Reviewed',
    });
    await closeFinancialPeriodScoped(reviewer, periodId, 'Period close');
    await expect(postApprovedExpenseScoped(reviewer, second.expenseId)).rejects.toMatchObject({
      code: 'OPEN_PERIOD_REQUIRED',
    });
    const row = await pool.query(
      'SELECT status,posted_journal_id FROM expense_requests WHERE id=$1',
      [second.expenseId],
    );
    expect(row.rows[0]).toEqual({ status: 'APPROVED', posted_journal_id: null });
  });
});
