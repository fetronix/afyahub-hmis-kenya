/** Synthetic PostgreSQL and HTTP refund tests; no provider transfers occur. */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { createSession } from '../../auth/session.service.ts';
import { reverseJournalScoped } from '../../accounting/accounting.service.ts';
import { recordSettledPayment } from '../../billing/payments.service.ts';
import { recordManualRefund } from '../../billing/refunds.service.ts';
import { db, pool } from '../../db/index.ts';
import { matchRecordedPayerPayment } from '../../insurance/hub/recorded-payment.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Manual refund receipts (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, facility: number, otherFacility: number, patient: number, userId: number;
  let token: string,
    readerToken: string,
    foreignToken: string,
    platformToken: string,
    base: string,
    close: () => Promise<void>;
  let ctx: AuthorizationContext;
  let serial = 0;
  const call = (path: string, body: object, auth = token) =>
    httpJson(base, 'POST', path, { token: auth, body });
  const invoice = async (amount = '100.00') => {
    const id = (
      await pool.query(
        "INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,credit_balance,status) VALUES($1,$2,$3,$4,$5,'0.00',$5,'0.00','Pending') RETURNING id",
        [tenant, facility, patient, `RF-${suffix}-${++serial}`, amount],
      )
    ).rows[0].id as number;
    await pool.query(
      "INSERT INTO billing_items(invoice_id,item_type,description,quantity,unit_price,total_amount) VALUES($1,'Synthetic','Synthetic service',1,$2,$2)",
      [id, amount],
    );
    return id;
  };
  const receipt = async (
    invoiceId: number,
    amount = '100.00',
    method = 'Cash',
    allowOverpayment = false,
  ) =>
    (
      await recordSettledPayment(
        ctx,
        { facilityId: facility, invoiceId, amount, paymentMethod: method, allowOverpayment },
        'Synthetic cashier',
      )
    ).payment;
  const body = (invoiceId: number, paymentId: number, amount = '30.00', key = randomUUID()) => ({
    facilityId: facility,
    invoiceId,
    paymentId,
    amount,
    refundMethod: 'CASH',
    reason: 'Synthetic manual refund',
    manualConfirmation: true,
    idempotencyKey: key,
  });
  const state = async (id: number) =>
    (
      await pool.query(
        'SELECT paid_amount::text AS paid,balance_amount::text AS balance,credit_balance::text AS credit,status FROM billing_invoices WHERE id=$1',
        [id],
      )
    ).rows[0];

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic refund ${suffix}`,
        `refund-${suffix}`,
      ])
    ).rows[0].id;
    [facility, otherFacility] = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic A',$4::jsonb),($1,$3,'Synthetic B',$4::jsonb) RETURNING id",
        [tenant, `RFA-${suffix}`, `RFB-${suffix}`, JSON.stringify(['finance', 'accounting'])],
      )
    ).rows.map((r) => r.id);
    patient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Refund Patient','2000-01-01','Other') RETURNING id",
        [tenant, facility, `RFP-${suffix}`],
      )
    ).rows[0].id;
    for (const code of [
      'billing.read',
      'billing.payments.record',
      'billing.refunds.record',
      'accounting.read',
    ])
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'billing') ON CONFLICT(code) DO NOTHING",
        [code],
      );
    const actor = async (tag: string, fac: number, grants: string[]) => {
      const id = (
        await pool.query(
          "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,$3,'test-only','ACTIVE',$4,$5) RETURNING id",
          [
            `refund-${tag}-${suffix}`,
            `refund-${tag}-${suffix}@example.test`,
            `Synthetic ${tag}`,
            tenant,
            fac,
          ],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `REF_${tag}_${suffix}`],
        )
      ).rows[0].id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
      for (const code of grants)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, code],
        );
      return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
    };
    const manager = await actor('manager', facility, [
      'billing.read',
      'billing.payments.record',
      'billing.refunds.record',
      'accounting.read',
    ]);
    const reader = await actor('reader', facility, ['billing.read']);
    const foreign = await actor('foreign', otherFacility, [
      'billing.read',
      'billing.refunds.record',
    ]);
    userId = manager.id;
    token = manager.token;
    readerToken = reader.token;
    foreignToken = foreign.token;
    // A separate synthetic global role intentionally contains stale financial
    // grants: the runtime boundary must deny them without deleting history.
    const globalUser = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic platform actor','test-only','ACTIVE',NULL,NULL) RETURNING id`,
        [`refund-platform-${suffix}`, `refund-platform-${suffix}@example.test`],
      )
    ).rows[0].id;
    const globalRole = (
      await pool.query(
        `INSERT INTO roles(tenant_id,name,is_active) VALUES(NULL,'SUPER_ADMIN',true) RETURNING id`,
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
      globalUser,
      globalRole,
    ]);
    await pool.query(
      `INSERT INTO role_permissions(role_id,permission_id)
      SELECT $1,id FROM permissions WHERE code IN ('billing.read','billing.payments.record','billing.refunds.record','accounting.read')`,
      [globalRole],
    );
    platformToken = (await createSession({ userId: globalUser, securityVersion: 1 })).sessionToken;
    ctx = {
      userId,
      tenantId: tenant,
      facilityId: facility,
      roles: [],
      permissions: ['billing.read', 'billing.refunds.record'],
      isSuperAdmin: false,
    };
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('authorizes facility refunds and prevents platform and cross-facility access', async () => {
    const id = await invoice(),
      p = await receipt(id),
      input = body(id, p.id);
    expect((await call('/api/billing/refunds', input, readerToken)).status).toBe(403);
    expect((await call('/api/billing/refunds', input, foreignToken)).status).toBe(403);
    await expect(
      recordManualRefund({ ...ctx, isSuperAdmin: true, tenantId: null, facilityId: null }, input),
    ).rejects.toMatchObject({ code: 'REFUND_FORBIDDEN' });
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM billing_refunds WHERE invoice_id=$1', [id]))
        .rows[0].n,
    ).toBe(0);
    expect((await state(id)).paid).toBe('100.00');
  });

  it('denies global administrators with stale financial grants while retaining facility access', async () => {
    const invoiceId = await invoice(),
      payment = await receipt(invoiceId);
    expect(
      (
        await httpJson(base, 'GET', `/api/invoices?facilityId=${facility}`, {
          token: platformToken,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await httpJson(
          base,
          'GET',
          `/api/accounting/overview?facilityId=${facility}&startDate=2026-01-01&endDate=2026-12-31`,
          { token: platformToken },
        )
      ).status,
    ).toBe(403);
    expect(
      (await call('/api/billing/refunds', body(invoiceId, payment.id), platformToken)).status,
    ).toBe(403);
    expect(
      (await httpJson(base, 'GET', `/api/invoices?facilityId=${facility}`, { token })).status,
    ).toBe(200);
    const grants = (
      await pool.query(
        `SELECT count(*)::int n FROM role_permissions rp JOIN roles r ON r.id=rp.role_id
      JOIN permissions p ON p.id=rp.permission_id JOIN user_roles ur ON ur.role_id=r.id JOIN users u ON u.id=ur.user_id
      WHERE u.uid=$1 AND p.code='billing.read'`,
        [`refund-platform-${suffix}`],
      )
    ).rows[0].n;
    expect(grants).toBe(1); // The seed/runtime boundary does not silently delete historical grants.
  });

  it('records an additive refund and one audit under concurrent same-key retries', async () => {
    const id = await invoice(),
      p = await receipt(id),
      input = body(id, p.id);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => call('/api/billing/refunds', input)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
    const refund = results.find((r) => r.status === 201)!.body.refund;
    expect(results.every((r) => r.body.refund.id === refund.id)).toBe(true);
    expect(refund).toMatchObject({
      paymentId: p.id,
      invoiceId: id,
      amount: '30.00',
      status: 'MANUALLY_RECORDED',
    });
    expect(results[0].body.accounting).toBe('NOT_POSTED');
    expect(await state(id)).toMatchObject({
      paid: '70.00',
      balance: '30.00',
      credit: '0.00',
      status: 'Partially Paid',
    });
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM billing_payments WHERE id=$1', [p.id]))
        .rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM audit_logs WHERE resource='RefundReceipt' AND resource_id=$1",
          [String(refund.id)],
        )
      ).rows[0].n,
    ).toBe(1);
    const mismatch = await call('/api/billing/refunds', { ...input, amount: '31.00' });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toBe('REFUND_IDEMPOTENCY_CONFLICT');
    const found = await call('/api/billing/refunds/status', {
      facilityId: facility,
      idempotencyKey: input.idempotencyKey,
    });
    expect(found.body).toMatchObject({ status: 'RECORDED', refund: { id: refund.id } });
    expect(
      (
        await call(
          '/api/billing/refunds/status',
          { facilityId: otherFacility, idempotencyKey: input.idempotencyKey },
          foreignToken,
        )
      ).body,
    ).toEqual({ status: 'NOT_FOUND' });
    const detail = await httpJson(base, 'GET', `/api/invoices/${id}`, { token });
    expect(detail.body.refunds).toHaveLength(1);
    expect(detail.body.refunds[0]).not.toHaveProperty('idempotencyKey');
    expect(detail.body.refunds[0]).not.toHaveProperty('requestHash');
    await expect(
      pool.query("UPDATE billing_refunds SET reason='edited' WHERE id=$1", [refund.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM billing_refunds WHERE id=$1', [refund.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('serializes competing partial refunds so the receipt cannot be over-refunded', async () => {
    const id = await invoice(),
      p = await receipt(id);
    const results = await Promise.all([
      call('/api/billing/refunds', body(id, p.id, '60.00')),
      call('/api/billing/refunds', body(id, p.id, '60.00')),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error).toBe('REFUND_EXCEEDS_RECEIPT');
    expect(await state(id)).toMatchObject({ paid: '40.00', balance: '60.00' });
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM billing_refunds WHERE payment_id=$1', [
          p.id,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it('updates credit and balance exactly and allows a subsequent receipt after a refund', async () => {
    const id = await invoice(),
      p = await receipt(id, '130.00', 'Cash', true);
    expect(await state(id)).toMatchObject({ paid: '130.00', balance: '0.00', credit: '30.00' });
    expect((await call('/api/billing/refunds', body(id, p.id, '50.00'))).status).toBe(201);
    expect(await state(id)).toMatchObject({
      paid: '80.00',
      balance: '20.00',
      credit: '0.00',
      status: 'Partially Paid',
    });
    await receipt(id, '20.00');
    expect(await state(id)).toMatchObject({
      paid: '100.00',
      balance: '0.00',
      credit: '0.00',
      status: 'Paid',
    });
    const report = await httpJson(
      base,
      'GET',
      `/api/accounting/billing-consistency?facilityId=${facility}&startDate=2000-01-01&endDate=2099-12-31&afterId=${id - 1}&limit=1`,
      { token },
    );
    expect(report.body.invoices[0].issues).toEqual([]);
    expect(report.body.invoices[0]).toMatchObject({ paymentTotal: '150.00', refundTotal: '50.00' });
    expect(report.body.limitations.ledgerReconciliation).toBe('NOT_IMPLEMENTED');
  });

  it('requires manual attestation, non-cash reference and payer review; never initiates a transfer', async () => {
    const id = await invoice(),
      p = await receipt(id);
    expect(
      (await call('/api/billing/refunds', { ...body(id, p.id), manualConfirmation: false })).status,
    ).toBe(400);
    expect(
      (await call('/api/billing/refunds', { ...body(id, p.id), refundMethod: 'CARD' })).status,
    ).toBe(400);
    expect((await call('/api/billing/refunds', { ...body(id, p.id), amount: '0.00' })).status).toBe(
      400,
    );
    const payerId = await invoice(),
      payer = await receipt(payerId, '100.00', 'SHA');
    const blocked = await call('/api/billing/refunds', body(payerId, payer.id));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('PAYER_REFUND_REVIEW_REQUIRED');
    const manual = await call('/api/billing/refunds', {
      ...body(id, p.id),
      refundMethod: 'CARD',
      externalReference: 'MANUAL-SLIP-123',
    });
    expect(manual.status).toBe(201);
    expect(manual.body.refund.status).toBe('MANUALLY_RECORDED');
  });

  it('refuses payer allocation of any receipt that already has a refund', async () => {
    const id = await invoice(),
      p = await receipt(id);
    expect((await call('/api/billing/refunds', body(id, p.id))).status).toBe(201);
    await expect(
      db.transaction((tx) =>
        matchRecordedPayerPayment(tx, {
          paymentId: p.id,
          invoiceId: id,
          payerCode: 'CASH',
          remittanceReference: 'synthetic',
          bankReference: null,
          amountCents: 10000,
        }),
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_REFUNDED' });
  });

  it('deterministically rejects an ordinary receipt linked to a SHA claim', async () => {
    const id = await invoice(),
      payment = await receipt(id);
    await pool.query(
      `INSERT INTO sha_eclaims(tenant_id,facility_id,patient_id,invoice_id,claim_number,claim_uuid,billable_start,billable_end,total_billed_amount,total_claimed_amount,settled_payment_id)
      VALUES($1,$2,$3,$4,$5,$6,'2026-01-01','2026-01-01','100.00','100.00',$7)`,
      [tenant, facility, patient, id, `SYN-SHA-${randomUUID()}`, randomUUID(), payment.id],
    );
    const response = await call('/api/billing/refunds', body(id, payment.id));
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('PAYER_REFUND_REVIEW_REQUIRED');
    expect((await state(id)).paid).toBe('100.00');
  });

  it('deterministically rejects an ordinary receipt linked to a private claim', async () => {
    const id = await invoice(),
      payment = await receipt(id);
    const policy = (
      await pool.query(
        `INSERT INTO insurance_member_policies(tenant_id,facility_id,patient_id,payer_code,member_number)
      VALUES($1,$2,$3,'SYNTHETIC',$4) RETURNING id`,
        [tenant, facility, patient, randomUUID()],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO private_insurance_claims(tenant_id,facility_id,patient_id,member_policy_id,invoice_id,payer_code,claim_number,idempotency_key,service_date_start,service_date_end,gross_invoice_amount,proposed_claim_amount,settled_payment_id)
      VALUES($1,$2,$3,$4,$5,'SYNTHETIC',$6,$7,'2026-01-01','2026-01-01','100.00','100.00',$8)`,
      [
        tenant,
        facility,
        patient,
        policy,
        id,
        `SYN-PRIVATE-${randomUUID()}`,
        randomUUID(),
        payment.id,
      ],
    );
    const response = await call('/api/billing/refunds', body(id, payment.id));
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('PAYER_REFUND_REVIEW_REQUIRED');
    expect((await state(id)).paid).toBe('100.00');
  });

  it('reports each invoice source without claiming that unposted receipts or refunds reached the ledger', async () => {
    const id = await invoice(),
      p = await receipt(id);
    expect((await call('/api/billing/refunds', body(id, p.id, '25.00'))).status).toBe(201);
    const url = `/api/accounting/billing-ledger-review?facilityId=${facility}&startDate=2000-01-01&endDate=2099-12-31&afterId=${id - 1}&limit=1`;
    expect((await httpJson(base, 'GET', url, { token: readerToken })).status).toBe(403);
    expect((await httpJson(base, 'GET', url, { token: foreignToken })).status).toBe(403);
    const response = await httpJson(base, 'GET', url, { token });
    expect(response.status).toBe(200);
    expect(response.body.ledgerPageSummary).toMatchObject({
      examined: 3,
      unposted: 3,
      requiringReview: 3,
    });
    expect(response.body.sourceEvents.map((e: any) => e.sourceType).sort()).toEqual([
      'BILLING_ITEM',
      'BILLING_PAYMENT',
      'BILLING_REFUND',
    ]);
    expect(response.body.sourceEvents.every((e: any) => e.issues.includes('UNPOSTED'))).toBe(true);
    expect(response.body.limitations.ledgerReconciliation).toBe('PARTIAL');
  });

  it('compares source-linked journal totals without declaring account classification reconciled', async () => {
    const id = await invoice(),
      payment = await receipt(id);
    const item = (await pool.query('SELECT id FROM billing_items WHERE invoice_id=$1', [id]))
      .rows[0].id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const period = (
        await client.query(
          "INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date) VALUES($1,$2,$3,'Synthetic period','2000-01-01','2099-12-31') RETURNING id",
          [tenant, facility, `TEST-${suffix}`],
        )
      ).rows[0].id;
      const accounts = (
        await client.query(
          "INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance) VALUES($1,$2,$3,'Synthetic debit','ASSET','TEST','DEBIT'),($1,$2,$4,'Synthetic credit','REVENUE','TEST','CREDIT') RETURNING id",
          [tenant, facility, `D-${suffix}`, `C-${suffix}`],
        )
      ).rows.map((r) => r.id);
      for (const [type, sourceId, cents] of [
        ['BILLING_ITEM', item, 10000],
        ['BILLING_PAYMENT', payment.id, 5000],
      ] as const) {
        const unique = randomUUID();
        const journal = (
          await client.query(
            "INSERT INTO journal_entries(tenant_id,facility_id,period_id,journal_number,entry_date,source_type,source_id,idempotency_key,request_hash,description,status,total_debit_cents,total_credit_cents) VALUES($1,$2,$3,$4,'2026-01-01',$5,$6,$7,$8,'Synthetic journal','DRAFT',$9,$9) RETURNING id",
            [
              tenant,
              facility,
              period,
              `J-${unique}`,
              type,
              String(sourceId),
              unique,
              unique,
              cents,
            ],
          )
        ).rows[0].id;
        await client.query(
          'INSERT INTO journal_lines(journal_entry_id,account_id,debit_cents,credit_cents) VALUES($1,$2,$4,0),($1,$3,0,$4)',
          [journal, accounts[0], accounts[1], cents],
        );
        await client.query("UPDATE journal_entries SET status='POSTED' WHERE id=$1", [journal]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const url = `/api/accounting/billing-ledger-review?facilityId=${facility}&startDate=2000-01-01&endDate=2099-12-31&afterId=${id - 1}&limit=1`;
    const response = await httpJson(base, 'GET', url, { token });
    expect(response.status).toBe(200);
    expect(
      response.body.sourceEvents.find((e: any) => e.sourceType === 'BILLING_ITEM'),
    ).toMatchObject({ assessment: 'AMOUNT_MATCH_ONLY', issues: [] });
    expect(
      response.body.sourceEvents.find((e: any) => e.sourceType === 'BILLING_PAYMENT').issues,
    ).toContain('JOURNAL_AMOUNT_MISMATCH');
    expect(response.body.limitations.notice).toMatch(/does not verify the accounts/i);
    const original = (
      await pool.query(
        `SELECT id FROM journal_entries WHERE tenant_id=$1 AND facility_id=$2 AND source_type='BILLING_ITEM' AND source_id=$3`,
        [tenant, facility, String(item)],
      )
    ).rows[0].id;
    await reverseJournalScoped(
      { tenantId: tenant, facilityId: facility, actorUserId: userId },
      original,
      {
        entryDate: '2026-01-02',
        reason: 'Synthetic controlled reversal',
        idempotencyKey: randomUUID(),
      },
    );
    const afterReversal = await httpJson(base, 'GET', url, { token });
    expect(
      afterReversal.body.sourceEvents.find((e: any) => e.sourceType === 'BILLING_ITEM').issues,
    ).toContain('REVERSAL_REQUIRES_REVIEW');
  });

  it('serializes payer linking with refunds and rejects a receipt already linked on a SHA claim', async () => {
    const id = await invoice();
    const syntheticReference = `SYN-${suffix}`;
    const payment = (
      await recordSettledPayment(
        ctx,
        {
          invoiceId: id,
          facilityId: facility,
          amount: '100.00',
          paymentMethod: 'Cash',
          transactionCode: syntheticReference,
        },
        'Synthetic cashier',
      )
    ).payment;
    const linkClaim = () =>
      db.transaction(async (tx) => {
        await matchRecordedPayerPayment(tx, {
          paymentId: payment.id,
          invoiceId: id,
          payerCode: 'CASH',
          remittanceReference: syntheticReference,
          bankReference: null,
          amountCents: 10000,
        });
        await tx.execute(sql`INSERT INTO sha_eclaims(tenant_id,facility_id,patient_id,invoice_id,claim_number,claim_uuid,billable_start,billable_end,total_billed_amount,total_claimed_amount,settled_payment_id)
        VALUES(${tenant},${facility},${patient},${id},${'SYN-CLAIM-' + randomUUID()},${randomUUID()},'2026-01-01','2026-01-01','100.00','100.00',${payment.id})`);
      });
    const outcomes = await Promise.allSettled([
      linkClaim(),
      recordManualRefund(ctx, body(id, payment.id, '20.00')),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const refunded = Number(
      (
        await pool.query('SELECT count(*)::int AS n FROM billing_refunds WHERE payment_id=$1', [
          payment.id,
        ])
      ).rows[0].n,
    );
    const linked = Number(
      (
        await pool.query('SELECT count(*)::int AS n FROM sha_eclaims WHERE settled_payment_id=$1', [
          payment.id,
        ])
      ).rows[0].n,
    );
    expect(refunded + linked).toBe(1);
    if (linked)
      await expect(
        db.transaction((tx) =>
          matchRecordedPayerPayment(tx, {
            paymentId: payment.id,
            invoiceId: id,
            payerCode: 'CASH',
            remittanceReference: syntheticReference,
            bankReference: null,
            amountCents: 10000,
          }),
        ),
      ).rejects.toMatchObject({ code: 'PAYMENT_ALREADY_ALLOCATED' });
  });

  it('rolls back receipt, invoice and audit together if the audit write fails', async () => {
    const id = await invoice(),
      p = await receipt(id);
    const name = `refund_audit_${suffix.replaceAll('-', '')}`;
    const client = await pool.connect();
    try {
      await client.query(
        `CREATE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN IF NEW.resource='RefundReceipt' AND NEW.user_id='${userId}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
      );
      await client.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      expect((await call('/api/billing/refunds', body(id, p.id))).status).toBe(500);
      expect(await state(id)).toMatchObject({ paid: '100.00', balance: '0.00' });
      expect(
        (
          await pool.query('SELECT count(*)::int AS n FROM billing_refunds WHERE invoice_id=$1', [
            id,
          ])
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await client.query(`DROP TRIGGER IF EXISTS ${name} ON audit_logs`);
      await client.query(`DROP FUNCTION IF EXISTS ${name}()`);
      client.release();
    }
  });
});
