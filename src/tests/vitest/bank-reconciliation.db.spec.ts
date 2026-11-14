/**
 * Bank reconciliation operations against real PostgreSQL.
 *
 * Covers what the import/match path did not: suggesting likely matches,
 * explaining unmatched items, reversing a wrong match, approving a
 * reconciliation under segregation of duties and a period lock, and reporting.
 *
 * The existing import/match/reconcile behaviour is covered by
 * `client-bank.db.spec.ts` and is deliberately not repeated here.
 *
 * All data is synthetic. Nothing in this file contacts a bank, and no figure
 * here is a live bank balance.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';

import {
  closeFinancialPeriodScoped,
  createAccountScoped,
  createFinancialPeriodScoped,
  postJournalScoped,
  type AccountingScope,
} from '../../accounting/accounting.service.ts';
import {
  approveBankReconciliationScoped,
  bankReconciliationReportScoped,
  createBankAccountScoped,
  importStatementScoped,
  investigateUnmatchedScoped,
  matchBankTransactionScoped,
  postBankStatementAdjustmentScoped,
  saveBankReconciliationScoped,
  suggestMatchesForTransactionScoped,
  unmatchBankTransactionScoped,
} from '../../accounting/bank-integration.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from './support/db.ts';

describeDb('bank reconciliation operations', () => {
  const suffix = randomUUID().slice(0, 8);
  let preparer: AccountingScope; // raises statements and matches them
  let approver: AccountingScope; // a second person at the same facility
  let outsider: AccountingScope; // another tenant entirely
  let bankAccountId: number;
  /**
   * A second account used only by the approval flow. A reconciliation is per
   * account as at a date, so an account still holding unmatched lines from other
   * tests can never balance — which is correct, and is why the approval fixture
   * gets an account of its own.
   */
  let approvalAccountId: number;
  /** The statement that ends up reconciled and approved, used for the refusal tests. */
  let approvalStatementId: number;

  /** A posted journal on the bank GL, returning the bank-side line id. */
  async function postBankEntry(
    scope: AccountingScope,
    input: {
      date: string;
      reference: string;
      amount: string;
      direction: 'INFLOW' | 'OUTFLOW';
      glCode?: string;
    },
  ): Promise<{ journalId: number; lineId: number }> {
    const bankGl = await pool.query(
      'SELECT id FROM chart_of_accounts WHERE facility_id=$1 AND account_code=$2',
      [scope.facilityId, input.glCode ?? '101'],
    );
    const other = await pool.query(
      'SELECT id FROM chart_of_accounts WHERE facility_id=$1 AND account_code=$2',
      [scope.facilityId, input.direction === 'INFLOW' ? '401' : '501'],
    );
    const lines =
      input.direction === 'INFLOW'
        ? [
            { accountId: bankGl.rows[0].id, debitKes: input.amount },
            { accountId: other.rows[0].id, creditKes: input.amount },
          ]
        : [
            { accountId: other.rows[0].id, debitKes: input.amount },
            { accountId: bankGl.rows[0].id, creditKes: input.amount },
          ];
    const journal = await postJournalScoped(scope, {
      entryDate: input.date,
      description: input.reference,
      reference: input.reference,
      idempotencyKey: `journal-${input.reference}-${randomUUID().slice(0, 6)}`,
      lines,
    });
    const line = await pool.query(
      'SELECT id FROM journal_lines WHERE journal_entry_id=$1 AND account_id=$2',
      [journal.journal.id, bankGl.rows[0].id],
    );
    return { journalId: journal.journal.id, lineId: line.rows[0].id };
  }

  async function importStatement(
    csv: string,
    options: { start?: string; end?: string; closing?: string; accountId?: number } = {},
  ): Promise<number> {
    const result = await importStatementScoped(preparer, options.accountId ?? bankAccountId, {
      startDate: options.start ?? '2026-10-01',
      endDate: options.end ?? '2026-10-31',
      closingBalanceKes: options.closing ?? '0.00',
      csvText: csv,
    });
    return result.statementImportId;
  }

  async function transactionIdByReference(
    reference: string,
    accountId = bankAccountId,
  ): Promise<number> {
    const row = await pool.query(
      'SELECT id FROM bank_transactions WHERE bank_account_id=$1 AND reference_number=$2 ORDER BY id DESC',
      [accountId, reference],
    );
    return row.rows[0].id;
  }

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Test database required.');

    const tenants = await pool.query(
      'INSERT INTO tenants (name,slug) VALUES ($1,$2),($3,$4) RETURNING id',
      [`Recon A ${suffix}`, `recon-a-${suffix}`, `Recon B ${suffix}`, `recon-b-${suffix}`],
    );
    const facilities = await pool.query(
      'INSERT INTO facilities (tenant_id,code,name) VALUES ($1,$2,$3),($4,$5,$6) RETURNING id',
      [
        tenants.rows[0].id,
        `RA-${suffix}`,
        'Synthetic A',
        tenants.rows[1].id,
        `RB-${suffix}`,
        'Synthetic B',
      ],
    );
    const users = await pool.query(
      `INSERT INTO users (uid,username,email,password_hash,full_name,tenant_id,facility_id)
       VALUES ($1,$1,$2,'t','Preparer',$3,$4),($5,$5,$6,'t','Approver',$3,$4),($7,$7,$8,'t','Outsider',$9,$10)
       RETURNING id`,
      [
        `rp-${suffix}`,
        `rp-${suffix}@example.test`,
        tenants.rows[0].id,
        facilities.rows[0].id,
        `ra-${suffix}`,
        `ra-${suffix}@example.test`,
        `ro-${suffix}`,
        `ro-${suffix}@example.test`,
        tenants.rows[1].id,
        facilities.rows[1].id,
      ],
    );

    const base = {
      tenantId: tenants.rows[0].id as number,
      facilityId: facilities.rows[0].id as number,
    };
    preparer = { ...base, actorUserId: users.rows[0].id };
    approver = { ...base, actorUserId: users.rows[1].id };
    outsider = {
      tenantId: tenants.rows[1].id,
      facilityId: facilities.rows[1].id,
      actorUserId: users.rows[2].id,
    };

    /* Both facilities get the chart of accounts the journals need. */
    for (const scope of [preparer, outsider]) {
      await createAccountScoped(scope, {
        accountCode: '101',
        accountName: 'Bank',
        accountType: 'ASSET',
        subType: 'BANK',
        normalBalance: 'DEBIT',
      });
      await createAccountScoped(scope, {
        accountCode: '401',
        accountName: 'Income',
        accountType: 'REVENUE',
        subType: 'GENERAL',
        normalBalance: 'CREDIT',
      });
      await createAccountScoped(scope, {
        accountCode: '501',
        accountName: 'Expenses',
        accountType: 'EXPENSE',
        subType: 'GENERAL',
        normalBalance: 'DEBIT',
      });
      await createFinancialPeriodScoped(scope, {
        periodCode: '2026-10',
        name: 'October 2026',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
      });
    }

    const bankGl = await pool.query(
      'SELECT id FROM chart_of_accounts WHERE facility_id=$1 AND account_code=$2',
      [preparer.facilityId, '101'],
    );
    const account = await createBankAccountScoped(preparer, {
      accountName: 'Synthetic reconciliation account',
      bankCode: 'TEST',
      bankName: 'Synthetic bank',
      accountLastFour: '4321',
      glAccountId: bankGl.rows[0].id,
    });
    bankAccountId = account.id;

    /*
     * A facility may register only one bank account per ledger account, so the
     * approval fixture needs its own GL account rather than sharing the first.
     */
    const secondBankGl = await createAccountScoped(preparer, {
      accountCode: '102',
      accountName: 'Bank 2',
      accountType: 'ASSET',
      subType: 'BANK',
      normalBalance: 'DEBIT',
    });
    const approvalAccount = await createBankAccountScoped(preparer, {
      accountName: 'Synthetic approval account',
      bankCode: 'TEST',
      bankName: 'Synthetic bank',
      accountLastFour: '8765',
      glAccountId: secondBankGl.id,
    });
    approvalAccountId = approvalAccount.id;
  }, 180_000);

  it('suggests posted ledger lines that could explain a statement line, without matching anything', async () => {
    const { lineId } = await postBankEntry(preparer, {
      date: '2026-10-12',
      reference: 'INV-9001',
      amount: '1250.00',
      direction: 'INFLOW',
    });
    await importStatement(
      'date,reference,description,direction,amount\n' +
        '2026-10-12,INV-9001,Patient settlement INFLOW,INFLOW,1250.00',
    );
    const transactionId = await transactionIdByReference('INV-9001');

    const result = await suggestMatchesForTransactionScoped(preparer, transactionId);

    expect(result.suggestions.length).toBeGreaterThan(0);
    const best = result.suggestions[0];
    expect(best.journalLineId).toBe(lineId);
    expect(best.amountKes).toBe('1250.00');
    expect(best.direction).toBe('INFLOW');
    /* Matching reference and same date is the strongest evidence available. */
    expect(best.confidence).toBe('EXACT');
    expect(best.reasons.join(' ')).toContain('Reference appears');

    /* A suggestion must not have written a match. */
    const row = await pool.query('SELECT match_status FROM bank_transactions WHERE id=$1', [
      transactionId,
    ]);
    expect(row.rows[0].match_status).toBe('UNMATCHED');
  }, 120_000);

  it('never suggests a line of the wrong amount, direction or account', async () => {
    /* The same date, a plausible reference, but a different amount. */
    await postBankEntry(preparer, {
      date: '2026-10-14',
      reference: 'CHQ-7001',
      amount: '999.00',
      direction: 'OUTFLOW',
    });
    await importStatement(
      'date,reference,description,direction,amount\n' +
        '2026-10-14,CHQ-7001,Settlement cheque,OUTFLOW,500.00',
    );
    const transactionId = await transactionIdByReference('CHQ-7001');

    const result = await suggestMatchesForTransactionScoped(preparer, transactionId);
    expect(result.suggestions).toHaveLength(0);
  }, 120_000);

  it('explains unmatched items instead of only counting them', async () => {
    await importStatement(
      'date,reference,description,direction,amount\n' +
        '2026-10-20,BANK-CHG,Bank charges,OUTFLOW,350.00',
    );

    const report = await investigateUnmatchedScoped(preparer, bankAccountId);
    const charge = report.items.find((item) => item.reference === 'BANK-CHG');

    expect(charge).toBeDefined();
    expect(charge!.suggestionCount).toBe(0);
    expect(charge!.requiresLedgerEntry).toBe(true);
    expect(charge!.likelyExplanation).toContain('Bank charges');
    /* Ledger entries with no statement line are listed too. */
    expect(Array.isArray(report.ledgerOnlyCandidates)).toBe(true);
    expect(report.notice).toContain('confirmation from the bank');
  }, 120_000);

  it('reverses a wrong match with an audit record, leaving the journal untouched', async () => {
    const { lineId, journalId } = await postBankEntry(preparer, {
      date: '2026-10-16',
      reference: 'REV-3001',
      amount: '740.00',
      direction: 'INFLOW',
    });
    await importStatement(
      'date,reference,description,direction,amount\n' +
        '2026-10-16,REV-3001,Synthetic receipt,INFLOW,740.00',
    );
    const transactionId = await transactionIdByReference('REV-3001');
    await matchBankTransactionScoped(preparer, transactionId, lineId);

    const before = await pool.query('SELECT match_status FROM bank_transactions WHERE id=$1', [
      transactionId,
    ]);
    expect(before.rows[0].match_status).toBe('MATCHED');

    const result = await unmatchBankTransactionScoped(
      preparer,
      transactionId,
      'Matched the wrong receipt; correcting.',
    );
    expect(result.unmatched).toBe(true);
    expect(result.previousJournalLineId).toBe(lineId);

    const after = await pool.query(
      'SELECT match_status, matched_journal_line_id FROM bank_transactions WHERE id=$1',
      [transactionId],
    );
    expect(after.rows[0].match_status).toBe('UNMATCHED');
    expect(after.rows[0].matched_journal_line_id).toBeNull();

    /* Unmatching is about the pairing, never about the accounting record. */
    const journal = await pool.query('SELECT status FROM journal_entries WHERE id=$1', [journalId]);
    expect(journal.rows[0].status).toBe('POSTED');

    const auditRow = await pool.query(
      `SELECT details FROM audit_logs
        WHERE resource='bank_transaction' AND resource_id=$1 AND action='UNMATCH'
        ORDER BY id DESC LIMIT 1`,
      [String(transactionId)],
    );
    expect(auditRow.rows.length).toBe(1);
    expect(JSON.parse(auditRow.rows[0].details).reason).toContain('wrong receipt');
  }, 120_000);

  it('refuses to unmatch something that was never matched', async () => {
    const transactionId = await transactionIdByReference('BANK-CHG');
    await expect(
      unmatchBankTransactionScoped(preparer, transactionId, 'Trying anyway'),
    ).rejects.toThrow(/not matched/i);
  }, 60_000);

  it('requires a second person to approve a reconciliation', async () => {
    /*
     * A clean statement and its ledger line, so the worksheet balances.
     */
    await postBankEntry(preparer, {
      date: '2026-10-22',
      reference: 'APR-5001',
      amount: '3000.00',
      direction: 'INFLOW',
      glCode: '102',
    });
    const statementId = await importStatement(
      'date,reference,description,direction,amount\n' +
        '2026-10-22,APR-5001,Approval fixture,INFLOW,3000.00',
      {
        start: '2026-10-22',
        end: '2026-10-22',
        /* The single 3,000 inflow is the whole balance of this account. */
        closing: '3000.00',
        accountId: approvalAccountId,
      },
    );

    /* Match everything on this account so the worksheet can balance. */
    const unmatched = await pool.query(
      `SELECT id FROM bank_transactions
        WHERE bank_account_id=$1 AND match_status='UNMATCHED'`,
      [approvalAccountId],
    );
    for (const row of unmatched.rows) {
      const suggestions = await suggestMatchesForTransactionScoped(preparer, row.id);
      if (suggestions.suggestions[0])
        await matchBankTransactionScoped(
          preparer,
          row.id,
          suggestions.suggestions[0].journalLineId,
        );
    }

    const prepared = await saveBankReconciliationScoped(preparer, approvalAccountId, statementId, {
      idempotencyKey: `recon-${suffix}`,
      periodCode: '2026-10',
      reviewNotes: 'Synthetic reconciliation for the approval test.',
    });
    approvalStatementId = statementId;
    expect(prepared.reconciliationId).toBeTruthy();

    /* The preparer cannot approve their own work. */
    await expect(
      approveBankReconciliationScoped(preparer, prepared.reconciliationId, {
        approvalNotes: 'Approving my own work',
      }),
    ).rejects.toThrow(/someone other than the person who prepared/i);

    /* A second person can. */
    const approved = await approveBankReconciliationScoped(approver, prepared.reconciliationId, {
      approvalNotes: 'Reviewed the matches and the worksheet.',
    });
    expect(approved.status).toBe('APPROVED');

    const row = await pool.query(
      'SELECT status, approved_by_user_id, approved_at FROM bank_reconciliations WHERE id=$1',
      [prepared.reconciliationId],
    );
    expect(row.rows[0].status).toBe('APPROVED');
    expect(row.rows[0].approved_by_user_id).toBe(approver.actorUserId);
    expect(row.rows[0].approved_at).not.toBeNull();

    const auditRow = await pool.query(
      `SELECT details FROM audit_logs
        WHERE resource='bank_reconciliation' AND resource_id=$1 AND action='APPROVE'`,
      [String(prepared.reconciliationId)],
    );
    expect(auditRow.rows.length).toBe(1);
    expect(JSON.parse(auditRow.rows[0].details).preparedBy).toBe(preparer.actorUserId);
  }, 180_000);

  it('refuses to change a match once a reconciliation covering it is approved', async () => {
    const transactionId = await transactionIdByReference('APR-5001', approvalAccountId);
    await expect(
      unmatchBankTransactionScoped(preparer, transactionId, 'Changing an approved record'),
    ).rejects.toThrow(/already approved/i);
  }, 60_000);

  it('refuses to approve a reconciliation inside a closed financial period', async () => {
    /*
     * A closed period is a statement of fact about the books. Approving a
     * reconciliation into one afterwards would change what the closed period
     * asserts, so the approval is refused rather than dated into history.
     */
    const period = await createFinancialPeriodScoped(preparer, {
      periodCode: '2026-09',
      name: 'September 2026',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    const thirdBankGl = await createAccountScoped(preparer, {
      accountCode: '103',
      accountName: 'Bank 3',
      accountType: 'ASSET',
      subType: 'BANK',
      normalBalance: 'DEBIT',
    });
    const account = await createBankAccountScoped(preparer, {
      accountName: 'Synthetic closed-period account',
      bankCode: 'TEST',
      bankName: 'Synthetic bank',
      accountLastFour: '9999',
      glAccountId: thirdBankGl.id,
    });

    await postBankEntry(preparer, {
      date: '2026-09-15',
      reference: 'SEP-1001',
      amount: '1500.00',
      direction: 'INFLOW',
      glCode: '103',
    });
    const statementId = await importStatementScoped(preparer, account.id, {
      startDate: '2026-09-15',
      endDate: '2026-09-15',
      closingBalanceKes: '1500.00',
      csvText:
        'date,reference,description,direction,amount\n' +
        '2026-09-15,SEP-1001,Closed period fixture,INFLOW,1500.00',
    }).then((result) => result.statementImportId);

    const transactionId = await transactionIdByReference('SEP-1001', account.id);
    const suggestions = await suggestMatchesForTransactionScoped(preparer, transactionId);
    await matchBankTransactionScoped(
      preparer,
      transactionId,
      suggestions.suggestions[0].journalLineId,
    );

    const prepared = await saveBankReconciliationScoped(preparer, account.id, statementId, {
      idempotencyKey: `recon-closed-${suffix}`,
      periodCode: '2026-09',
      reviewNotes: 'Prepared while the period was open.',
    });

    /* The period closes after the work was done, before anyone signs it off. */
    await closeFinancialPeriodScoped(
      preparer,
      (period as { id: number }).id,
      'Month closed for the period-lock test.',
    );

    await expect(
      approveBankReconciliationScoped(approver, prepared.reconciliationId, {
        approvalNotes: 'Approving into a closed period',
      }),
    ).rejects.toThrow(/closed/i);

    const row = await pool.query(
      'SELECT status, approved_by_user_id FROM bank_reconciliations WHERE id=$1',
      [prepared.reconciliationId],
    );
    expect(row.rows[0].status).not.toBe('APPROVED');
    expect(row.rows[0].approved_by_user_id).toBeNull();
  }, 180_000);

  it('posts a bank charge as a balanced adjustment through the normal journal path', async () => {
    /*
     * A bank charge appears on the statement with nothing in the books to match
     * it to. The adjustment posts a new journal; it must balance, carry the bank
     * side automatically, and be traceable to the statement it came from.
     */
    const statementId = await importStatement(
      'date,reference,description,direction,amount\n' +
        '2026-10-25,ADJ-CHG,Unrecorded bank charge,OUTFLOW,120.00',
      { start: '2026-10-25', end: '2026-10-25', closing: '0.00' },
    );
    const expenses = await pool.query(
      'SELECT id FROM chart_of_accounts WHERE facility_id=$1 AND account_code=$2',
      [preparer.facilityId, '501'],
    );

    const result = await postBankStatementAdjustmentScoped(preparer, statementId, {
      entryDate: '2026-10-25',
      description: 'Bank charge per statement',
      reference: 'ADJ-CHG',
      idempotencyKey: `adj-${suffix}`,
      lines: [{ accountId: expenses.rows[0].id, debitKes: '120.00' }],
    });

    expect(result.journalId).toBeTruthy();

    const journal = await pool.query(
      'SELECT total_debit_cents, total_credit_cents, status FROM journal_entries WHERE id=$1',
      [result.journalId],
    );
    /* Double entry: the poster refuses anything that does not net to zero. */
    expect(journal.rows[0].total_debit_cents).toBe(journal.rows[0].total_credit_cents);
    expect(journal.rows[0].status).toBe('POSTED');

    const bankSide = await pool.query(
      `SELECT l.credit_cents FROM journal_lines l
         JOIN bank_accounts a ON a.gl_account_id=l.account_id
        WHERE l.journal_entry_id=$1 AND a.id=$2`,
      [result.journalId, bankAccountId],
    );
    expect(bankSide.rows[0].credit_cents).toBe('12000');

    const auditRow = await pool.query(
      `SELECT details FROM audit_logs
        WHERE resource='bank_statement_import' AND resource_id=$1 AND action='ADJUST'`,
      [String(statementId)],
    );
    expect(auditRow.rows.length).toBe(1);
    expect(JSON.parse(auditRow.rows[0].details).side).toBe('CREDIT_BANK');
  }, 120_000);

  it('refuses an adjustment once the statement has been reconciled and approved', async () => {
    const expenses = await pool.query(
      'SELECT id FROM chart_of_accounts WHERE facility_id=$1 AND account_code=$2',
      [preparer.facilityId, '501'],
    );
    await expect(
      postBankStatementAdjustmentScoped(preparer, approvalStatementId, {
        entryDate: '2026-10-22',
        description: 'Late adjustment',
        idempotencyKey: `adj-late-${suffix}`,
        lines: [{ accountId: expenses.rows[0].id, debitKes: '10.00' }],
      }),
    ).rejects.toThrow(/approved/i);
  }, 60_000);

  it('keeps another tenant out of the account entirely', async () => {
    await expect(investigateUnmatchedScoped(outsider, bankAccountId)).rejects.toThrow(/not found/i);
    await expect(bankReconciliationReportScoped(outsider, bankAccountId)).rejects.toThrow(
      /not found/i,
    );
  }, 60_000);

  it('reports every statement with its reconciliation state and the gaps', async () => {
    const report = await bankReconciliationReportScoped(preparer, approvalAccountId);

    expect(report.account.account_name).toBe('Synthetic approval account');
    expect(report.statementCount).toBe(1);
    expect(report.approvedCount).toBe(1);
    expect(report.unreconciledCount).toBe(0);
    expect(report.transactionTotals.length).toBeGreaterThan(0);
    expect(report.notice).toContain('not a live bank balance');
  }, 60_000);
});
