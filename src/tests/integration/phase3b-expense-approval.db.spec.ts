/** Synthetic PostgreSQL and authenticated HTTP only. No payment or provider transfer occurs. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import {
  createAccountScoped,
  createFinancialPeriodScoped,
  closeFinancialPeriodScoped,
  reverseJournalScoped,
  transaction,
  postInsideTransaction,
  type AccountingScope,
} from '../../accounting/accounting.service.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Phase 3B independent expense approval and source-linked posting', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  let tenant: number,
    otherTenant: number,
    facility: number,
    sibling: number,
    foreignFacility: number;
  let requesterId: number,
    reviewerId: number,
    foreignActorId: number,
    date: string,
    closedPeriod: number;
  let expenseAccount: number, payableAccount: number;
  let requesterToken: string,
    reviewerToken: string,
    approverOnlyToken: string,
    posterOnlyToken: string;
  let siblingToken: string, foreignToken: string, platformToken: string;
  let base: string, close: () => Promise<void>;
  let scope: AccountingScope;
  const call = (method: string, path: string, token: string, body?: object) =>
    httpJson(base, method, path, { token, body });
  const createExpense = async (extra: Record<string, unknown> = {}) => {
    const result = await call('POST', '/api/accounting/expenses', requesterToken, {
      facilityId: facility,
      expenseAccountId: expenseAccount,
      payableAccountId: payableAccount,
      amountKes: '50.00',
      incurredDate: date,
      idempotencyKey: randomUUID(),
      payeeName: 'Synthetic supplier',
      category: 'Synthetic expense',
      description: 'Synthetic independently reviewed expense',
      supportingDocuments: [
        { name: 'Synthetic invoice', storageReference: 'private/test-document' },
      ],
      ...extra,
    });
    expect(result.status).toBe(201);
    return result.body.expenseId as number;
  };
  const detail = async (id: number, token = reviewerToken, fac = facility) => {
    const response = await call(
      'GET',
      `/api/accounting/expenses?facilityId=${fac}&search=${id}`,
      token,
    );
    expect(response.status).toBe(200);
    const row = response.body.expenses.find((entry: { id: number }) => entry.id === id);
    expect(row).toBeTruthy();
    return row;
  };
  const approve = (
    id: number,
    reviewHash: string,
    token = reviewerToken,
    notes = 'Reviewed synthetic evidence',
  ) =>
    call('POST', `/api/accounting/expenses/${id}/approve-and-post`, token, {
      facilityId: facility,
      reviewHash,
      notes,
    });

  beforeAll(async () => {
    if (!/synthetic.*test|test.*synthetic/i.test(process.env.SQL_DB_NAME ?? ''))
      throw new Error('Explicit synthetic test database required.');
    date = (await pool.query('SELECT current_date::text AS day')).rows[0].day;
    [tenant, otherTenant] = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id', [
        'Synthetic expense tenant',
        `p3be-${suffix}`,
        'Synthetic foreign tenant',
        `p3bef-${suffix}`,
      ])
    ).rows.map((r) => r.id);
    [facility, sibling, foreignFacility] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES
         ($1,$2,'Synthetic A','["finance","accounting"]'),
         ($1,$3,'Synthetic B','["finance","accounting"]'),
         ($4,$5,'Synthetic foreign','["finance","accounting"]') RETURNING id`,
        [tenant, `P3BEA-${suffix}`, `P3BEB-${suffix}`, otherTenant, `P3BEF-${suffix}`],
      )
    ).rows.map((r) => r.id);
    const permissions = [
      'accounting.read',
      'accounting.expenses.request',
      'accounting.expenses.approve',
      'accounting.journals.post',
    ];
    for (const code of permissions)
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'accounting') ON CONFLICT(code) DO NOTHING",
        [code],
      );
    const actor = async (
      tag: string,
      t: number | null,
      f: number | null,
      grants: string[],
      roleName?: string,
    ) => {
      const id = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
           VALUES($1,$1,$2,'Synthetic actor','test-only','ACTIVE',$3,$4) RETURNING id`,
          [`p3be-${tag}-${suffix}`, `p3be-${tag}-${suffix}@example.test`, t, f],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [t, roleName ?? `P3BE_${tag}_${suffix}`],
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
    const requester = await actor('requester', tenant, facility, permissions);
    const reviewer = await actor('reviewer', tenant, facility, [
      'accounting.read',
      'accounting.expenses.approve',
      'accounting.journals.post',
    ]);
    const approver = await actor('approver', tenant, facility, [
      'accounting.read',
      'accounting.expenses.approve',
    ]);
    const poster = await actor('poster', tenant, facility, [
      'accounting.read',
      'accounting.journals.post',
    ]);
    const siblingUser = await actor('sibling', tenant, sibling, permissions);
    const foreign = await actor('foreign', otherTenant, foreignFacility, permissions);
    const platform = await actor('platform', null, null, permissions, 'SUPER_ADMIN');
    requesterId = requester.id;
    reviewerId = reviewer.id;
    foreignActorId = foreign.id;
    requesterToken = requester.token;
    reviewerToken = reviewer.token;
    approverOnlyToken = approver.token;
    posterOnlyToken = poster.token;
    siblingToken = siblingUser.token;
    foreignToken = foreign.token;
    platformToken = platform.token;
    scope = { tenantId: tenant, facilityId: facility, actorUserId: requesterId };
    expenseAccount = (
      await createAccountScoped(scope, {
        accountCode: 'P3-EXP',
        accountName: 'Synthetic expense',
        accountType: 'EXPENSE',
        subType: 'GENERAL',
        normalBalance: 'DEBIT',
      })
    ).id;
    payableAccount = (
      await createAccountScoped(scope, {
        accountCode: 'P3-AP',
        accountName: 'Synthetic payable',
        accountType: 'LIABILITY',
        subType: 'PAYABLE',
        normalBalance: 'CREDIT',
      })
    ).id;
    const year = date.slice(0, 4);
    await createFinancialPeriodScoped(scope, {
      periodCode: 'SYN-CURRENT',
      name: 'Synthetic current',
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    });
    closedPeriod = (
      await createFinancialPeriodScoped(scope, {
        periodCode: 'SYN-CLOSED',
        name: 'Synthetic closed',
        startDate: '2001-01-01',
        endDate: '2001-12-31',
      })
    ).id;
    await closeFinancialPeriodScoped(
      { ...scope, actorUserId: reviewerId },
      closedPeriod,
      'Synthetic closed period',
    );
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('requires independent approval, both financial permissions and matching facility/tenant scope', async () => {
    const id = await createExpense();
    const row = await detail(id);
    expect(row).toMatchObject({
      accountingStatus: 'NOT_POSTED',
      expenseAccount: { id: expenseAccount },
      payableAccount: { id: payableAccount },
    });
    expect(row.reviewHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await approve(id, row.reviewHash, requesterToken)).body.error).toBe(
      'SELF_APPROVAL_FORBIDDEN',
    );
    expect((await approve(id, row.reviewHash, approverOnlyToken)).status).toBe(403);
    expect((await approve(id, row.reviewHash, posterOnlyToken)).status).toBe(403);
    expect((await approve(id, row.reviewHash, siblingToken)).status).toBe(403);
    expect((await approve(id, row.reviewHash, foreignToken)).status).toBe(403);
    expect((await approve(id, row.reviewHash, platformToken)).status).toBe(403);
    const hidden = await call(
      'POST',
      `/api/accounting/expenses/${id}/approve-and-post`,
      siblingToken,
      { facilityId: sibling, reviewHash: row.reviewHash, notes: 'Synthetic' },
    );
    expect(hidden.status).toBe(404);
    const persisted = await pool.query(
      'SELECT status,reviewed_by_user_id,posted_journal_id FROM expense_requests WHERE id=$1',
      [id],
    );
    expect(persisted.rows[0]).toEqual({
      status: 'SUBMITTED',
      reviewed_by_user_id: null,
      posted_journal_id: null,
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM journal_entries WHERE source_type='EXPENSE_REQUEST' AND source_id=$1",
          [String(id)],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('posts exactly one balanced source-linked payable under concurrent retries, without claiming payment', async () => {
    const id = await createExpense();
    const row = await detail(id);
    const results = await Promise.all(Array.from({ length: 5 }, () => approve(id, row.reviewHash)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(4);
    expect(results.every((r) => r.body.paymentRecorded === false)).toBe(true);
    const journalId = results[0].body.journalId;
    expect(results.every((r) => r.body.journalId === journalId)).toBe(true);
    expect((await approve(id, row.reviewHash, reviewerToken, 'Changed approval note')).status).toBe(
      409,
    );
    const changedHash = await approve(id, 'b'.repeat(64));
    expect(changedHash.status).toBe(409);
    expect(changedHash.body.error).toBe('EXPENSE_ALREADY_REVIEWED');
    const state = await pool.query(
      `SELECT e.status,e.reviewed_by_user_id,e.posted_journal_id,j.source_type,j.source_id,j.status journal_status,
       j.total_debit_cents::text debit,j.total_credit_cents::text credit
       FROM expense_requests e JOIN journal_entries j ON j.id=e.posted_journal_id WHERE e.id=$1`,
      [id],
    );
    expect(state.rows[0]).toMatchObject({
      status: 'POSTED',
      reviewed_by_user_id: reviewerId,
      posted_journal_id: journalId,
      source_type: 'EXPENSE_REQUEST',
      source_id: String(id),
      journal_status: 'POSTED',
      debit: '5000',
      credit: '5000',
    });
    const lines = await pool.query(
      'SELECT account_id,debit_cents::text debit,credit_cents::text credit FROM journal_lines WHERE journal_entry_id=$1 ORDER BY id',
      [journalId],
    );
    expect(lines.rows).toEqual([
      { account_id: expenseAccount, debit: '5000', credit: '0' },
      { account_id: payableAccount, debit: '0', credit: '5000' },
    ]);
    const audit = await pool.query(
      "SELECT action FROM audit_logs WHERE facility_id=$1 AND resource='expense_request' AND resource_id=$2 ORDER BY id",
      [facility, String(id)],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['REQUEST', 'APPROVE', 'POST']);
    const approvalAudit = await pool.query(
      "SELECT details FROM audit_logs WHERE facility_id=$1 AND resource='expense_request' AND resource_id=$2 AND action='APPROVE'",
      [facility, String(id)],
    );
    expect(JSON.parse(approvalAudit.rows[0].details).reviewHash).toBe(row.reviewHash);
    const overview = await call(
      'GET',
      `/api/accounting/overview?facilityId=${facility}&startDate=${date}&endDate=${date}`,
      reviewerToken,
    );
    expect(overview.status).toBe(200);
    expect(overview.body.trialBalance.balanced).toBe(true);
    expect(
      BigInt(overview.body.profitAndLoss.postedExpensesKes.replace('.', '')),
    ).toBeGreaterThanOrEqual(5000n);
  });

  it('rejects stale or changed source evidence rather than approving an unreviewed amount', async () => {
    const id = await createExpense();
    const original = await detail(id);
    await pool.query("UPDATE expense_requests SET amount_kes='51.00' WHERE id=$1", [id]);
    const failed = await approve(id, original.reviewHash);
    expect(failed.status).toBe(409);
    expect(failed.body.error).toBe('EXPENSE_REVIEW_CHANGED');
    const changed = await detail(id);
    expect(changed.reviewHash).toBeNull();
    expect(changed.reviewIssue).toBe('SOURCE_CHANGED');
    expect(
      (await pool.query('SELECT status,posted_journal_id FROM expense_requests WHERE id=$1', [id]))
        .rows[0],
    ).toEqual({ status: 'SUBMITTED', posted_journal_id: null });

    const currencyId = await createExpense();
    const currencyReview = await detail(currencyId);
    await pool.query("UPDATE expense_requests SET currency='USD' WHERE id=$1", [currencyId]);
    const currencyResult = await approve(currencyId, currencyReview.reviewHash);
    expect(currencyResult.status).toBe(409);
    expect(currencyResult.body.error).toBe('EXPENSE_REVIEW_CHANGED');
    const currencyChanged = await detail(currencyId);
    expect(currencyChanged.currency).toBe('USD');
    expect(currencyChanged.reviewHash).toBeNull();
    expect(currencyChanged.reviewIssue).toBe('SOURCE_CHANGED');
  });

  it('requires a fresh review when an unused facility account label changes', async () => {
    const localExpense = (
      await createAccountScoped(scope, {
        accountCode: `P3-REVIEW-${suffix}`,
        accountName: 'Synthetic original account',
        accountType: 'EXPENSE',
        subType: 'GENERAL',
        normalBalance: 'DEBIT',
      })
    ).id;
    const id = await createExpense({ expenseAccountId: localExpense });
    const original = await detail(id);
    await pool.query(
      "UPDATE chart_of_accounts SET account_name='Synthetic renamed account' WHERE id=$1",
      [localExpense],
    );
    const failed = await approve(id, original.reviewHash);
    expect(failed.status).toBe(409);
    expect(failed.body.error).toBe('EXPENSE_REVIEW_CHANGED');
    const refreshed = await detail(id);
    expect(refreshed.expenseAccount.name).toBe('Synthetic renamed account');
    expect(refreshed.reviewHash).not.toBe(original.reviewHash);
    expect((await approve(id, refreshed.reviewHash)).status).toBe(201);
  });

  it('rejects unconfigured, wrong-type or cross-facility account choices', async () => {
    const foreignScope = {
      tenantId: otherTenant,
      facilityId: foreignFacility,
      actorUserId: foreignActorId,
    };
    const foreignExpense = (
      await createAccountScoped(foreignScope, {
        accountCode: `FOREIGN-${suffix}`,
        accountName: 'Foreign expense',
        accountType: 'EXPENSE',
        subType: 'GENERAL',
        normalBalance: 'DEBIT',
      })
    ).id;
    const baseInput = {
      facilityId: facility,
      payableAccountId: payableAccount,
      amountKes: '25.00',
      incurredDate: date,
      payeeName: 'Synthetic',
      category: 'Synthetic',
      description: 'Synthetic',
      idempotencyKey: randomUUID(),
    };
    expect(
      (
        await call('POST', '/api/accounting/expenses', requesterToken, {
          ...baseInput,
          expenseAccountId: foreignExpense,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/api/accounting/expenses', requesterToken, {
          ...baseInput,
          expenseAccountId: payableAccount,
        })
      ).status,
    ).toBe(400);
    expect((await call('POST', '/api/accounting/expenses', requesterToken, baseInput)).status).toBe(
      400,
    );
    // A synthetic malformed legacy reference must not disclose another facility's account.
    const corrupt = await createExpense();
    await pool.query('UPDATE expense_requests SET expense_account_id=$1 WHERE id=$2', [
      foreignExpense,
      corrupt,
    ]);
    const review = await detail(corrupt);
    expect(review.expenseAccount).toEqual({ id: null, code: null, name: null });
    expect(review.reviewHash).toBeNull();
  });

  it('flags an unlinked source journal and rolls back a duplicate approval attempt', async () => {
    const id = await createExpense();
    const reviewed = await detail(id);
    // Simulate a historical source journal that was never linked to its request.
    await transaction((client) =>
      postInsideTransaction(
        client,
        { ...scope, actorUserId: reviewerId },
        {
          entryDate: date,
          description: 'Synthetic unlinked historical journal',
          idempotencyKey: randomUUID(),
          sourceType: 'EXPENSE_REQUEST',
          sourceId: String(id),
          totalCents: 5000n,
          lines: [
            {
              accountId: expenseAccount,
              debitCents: 5000n,
              creditCents: 0n,
              description: null,
              serviceLine: null,
            },
            {
              accountId: payableAccount,
              debitCents: 0n,
              creditCents: 5000n,
              description: null,
              serviceLine: null,
            },
          ],
        },
      ),
    );
    expect((await detail(id)).accountingStatus).toBe('REVIEW_REQUIRED');
    const retry = await approve(id, reviewed.reviewHash);
    expect(retry.status).toBe(409);
    expect(retry.body.error).toBe('EXPENSE_POSTING_INCONSISTENT');
    expect(
      (
        await pool.query('SELECT status,reviewed_by_user_id FROM expense_requests WHERE id=$1', [
          id,
        ])
      ).rows[0],
    ).toEqual({ status: 'SUBMITTED', reviewed_by_user_id: null });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE resource='expense_request' AND resource_id=$1 AND action='APPROVE'",
          [String(id)],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('flags an inconsistent legacy-linked journal instead of reporting or replaying it as posted', async () => {
    const id = await createExpense();
    // Construct a synthetic inconsistent historical link without disabling database guards.
    const legacy = await transaction((client) =>
      postInsideTransaction(
        client,
        { ...scope, actorUserId: reviewerId },
        {
          entryDate: date,
          description: 'Synthetic inconsistent historical amount',
          idempotencyKey: randomUUID(),
          sourceType: 'EXPENSE_REQUEST',
          sourceId: String(id),
          totalCents: 6000n,
          lines: [
            {
              accountId: expenseAccount,
              debitCents: 6000n,
              creditCents: 0n,
              description: null,
              serviceLine: null,
            },
            {
              accountId: payableAccount,
              debitCents: 0n,
              creditCents: 6000n,
              description: null,
              serviceLine: null,
            },
          ],
        },
      ),
    );
    await pool.query(
      "UPDATE expense_requests SET status='POSTED',posted_journal_id=$1 WHERE id=$2",
      [legacy.journal.id, id],
    );
    const row = await detail(id);
    expect(row.accountingStatus).toBe('REVIEW_REQUIRED');
    const retry = await call('POST', `/api/accounting/expenses/${id}/post`, reviewerToken, {
      facilityId: facility,
    });
    expect(retry.status).toBe(409);
    expect(retry.body.error).toBe('EXPENSE_POSTING_INCONSISTENT');

    const alternateAccount = (
      await createAccountScoped(scope, {
        accountCode: `P3-ALTERNATE-${suffix}`,
        accountName: 'Synthetic alternate expense account',
        accountType: 'EXPENSE',
        subType: 'GENERAL',
        normalBalance: 'DEBIT',
      })
    ).id;
    const wrongAccountId = await createExpense();
    const wrongAccountJournal = await transaction((client) =>
      postInsideTransaction(
        client,
        { ...scope, actorUserId: reviewerId },
        {
          entryDate: date,
          description: 'Synthetic inconsistent historical account',
          idempotencyKey: randomUUID(),
          sourceType: 'EXPENSE_REQUEST',
          sourceId: String(wrongAccountId),
          totalCents: 5000n,
          lines: [
            {
              accountId: alternateAccount,
              debitCents: 5000n,
              creditCents: 0n,
              description: null,
              serviceLine: null,
            },
            {
              accountId: payableAccount,
              debitCents: 0n,
              creditCents: 5000n,
              description: null,
              serviceLine: null,
            },
          ],
        },
      ),
    );
    await pool.query(
      "UPDATE expense_requests SET status='POSTED',posted_journal_id=$1 WHERE id=$2",
      [wrongAccountJournal.journal.id, wrongAccountId],
    );
    expect((await detail(wrongAccountId)).accountingStatus).toBe('REVIEW_REQUIRED');
    const accountRetry = await call(
      'POST',
      `/api/accounting/expenses/${wrongAccountId}/post`,
      reviewerToken,
      { facilityId: facility },
    );
    expect(accountRetry.status).toBe(409);
    expect(accountRetry.body.error).toBe('EXPENSE_POSTING_INCONSISTENT');
  });

  it('rolls approval and posting back together when the period is closed', async () => {
    const id = await createExpense({ incurredDate: '2001-06-01' });
    const row = await detail(id);
    const failed = await approve(id, row.reviewHash);
    expect(failed.status).toBe(409);
    expect(failed.body.error).toBe('OPEN_PERIOD_REQUIRED');
    expect(
      (
        await pool.query(
          'SELECT status,reviewed_by_user_id,posted_journal_id FROM expense_requests WHERE id=$1',
          [id],
        )
      ).rows[0],
    ).toEqual({ status: 'SUBMITTED', reviewed_by_user_id: null, posted_journal_id: null });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM journal_entries WHERE source_type='EXPENSE_REQUEST' AND source_id=$1",
          [String(id)],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('rolls back the approval, journal and audit if the expense audit write fails', async () => {
    const id = await createExpense();
    const row = await detail(id);
    const name = `p3be_audit_${suffix}`;
    await pool.query(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource='expense_request' AND NEW.action='POST' AND NEW.facility_id=${facility} THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      const failed = await approve(id, row.reviewHash);
      expect(failed.status).toBe(500);
      expect(
        (
          await pool.query(
            'SELECT status,reviewed_by_user_id,posted_journal_id FROM expense_requests WHERE id=$1',
            [id],
          )
        ).rows[0],
      ).toEqual({ status: 'SUBMITTED', reviewed_by_user_id: null, posted_journal_id: null });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM journal_entries WHERE source_type='EXPENSE_REQUEST' AND source_id=$1",
            [String(id)],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM audit_logs WHERE resource='expense_request' AND resource_id=$1 AND action='APPROVE'",
            [String(id)],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.query(`DROP TRIGGER ${name} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${name}()`);
    }
  });

  it('serializes an expense replay with a concurrent journal reversal', async () => {
    const id = await createExpense();
    const row = await detail(id);
    const result = await approve(id, row.reviewHash);
    expect(result.status).toBe(201);
    const journal = result.body.journalId as number;
    const holder = await pool.connect();
    let committed = false;
    let replay: ReturnType<typeof approve> | null = null;
    try {
      await holder.query('BEGIN');
      const blocker = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      await holder.query('SELECT id FROM journal_entries WHERE id=$1 FOR UPDATE', [journal]);
      replay = approve(id, row.reviewHash);
      let waiting = false;
      for (let attempt = 0; attempt < 120 && !waiting; attempt++) {
        const blocked = await pool.query(
          'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))) AS waiting',
          [blocker],
        );
        waiting = blocked.rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
      // Commit a synthetic reversal while the replay is blocked on the original journal.
      await postInsideTransaction(
        holder,
        { ...scope, actorUserId: reviewerId },
        {
          entryDate: date,
          description: 'Synthetic concurrent reversal',
          idempotencyKey: randomUUID(),
          sourceType: 'REVERSAL',
          reversalOf: journal,
          reversalReason: 'Synthetic concurrent correction',
          totalCents: 5000n,
          lines: [
            {
              accountId: expenseAccount,
              debitCents: 0n,
              creditCents: 5000n,
              description: null,
              serviceLine: null,
            },
            {
              accountId: payableAccount,
              debitCents: 5000n,
              creditCents: 0n,
              description: null,
              serviceLine: null,
            },
          ],
        },
      );
      await holder.query('COMMIT');
      committed = true;
      const outcome = await replay;
      expect(outcome.status).toBe(409);
      expect(outcome.body.error).toBe('EXPENSE_POSTING_REVERSED');
      expect((await detail(id)).accountingStatus).toBe('REVERSED');
    } finally {
      if (!committed) await holder.query('ROLLBACK');
      holder.release();
      if (replay) await replay.catch(() => undefined);
    }
  });

  it('shows a reversal explicitly and does not replay a reversed expense as posted', async () => {
    const id = await createExpense();
    const row = await detail(id);
    const result = await approve(id, row.reviewHash);
    expect(result.status).toBe(201);
    const journal = result.body.journalId as number;
    const before = await call(
      'GET',
      `/api/accounting/overview?facilityId=${facility}&startDate=${date}&endDate=${date}`,
      reviewerToken,
    );
    const reversal = await reverseJournalScoped({ ...scope, actorUserId: reviewerId }, journal, {
      entryDate: date,
      reason: 'Synthetic correction',
      idempotencyKey: randomUUID(),
    });
    const after = await detail(id);
    expect(after).toMatchObject({
      accountingStatus: 'REVERSED',
      reversalJournalId: reversal.journal.id,
    });
    const retry = await approve(id, row.reviewHash);
    expect(retry.status).toBe(409);
    expect(retry.body.error).toBe('EXPENSE_POSTING_REVERSED');
    const manualRetry = await call('POST', `/api/accounting/expenses/${id}/post`, reviewerToken, {
      facilityId: facility,
    });
    expect(manualRetry.status).toBe(409);
    expect(manualRetry.body.error).toBe('EXPENSE_POSTING_REVERSED');
    const afterReport = await call(
      'GET',
      `/api/accounting/overview?facilityId=${facility}&startDate=${date}&endDate=${date}`,
      reviewerToken,
    );
    expect(afterReport.body.trialBalance.balanced).toBe(true);
    const cents = (amount: string) => BigInt(amount.replace('.', ''));
    expect(
      cents(before.body.profitAndLoss.postedExpensesKes) -
        cents(afterReport.body.profitAndLoss.postedExpensesKes),
    ).toBe(5000n);
  });
});
