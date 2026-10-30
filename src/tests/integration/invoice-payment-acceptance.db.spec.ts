/** Synthetic PostgreSQL tests for receipt, invoice voiding and transaction races. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { createSession } from '../../auth/session.service.ts';
import { recordSettledPayment } from '../../billing/payments.service.ts';
import { pool } from '../../db/index.ts';
import { recordPayment, voidInvoiceScoped } from '../../db/queries/billing.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

async function waitForBlockedBy(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      'SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
      [pid],
    );
    if (result.rows[0].count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Expected database lock was not observed.');
}

describeDb('Invoice and payment acceptance (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, facility: number, patient: number, actorId: number;
  let token: string,
    readerToken: string,
    foreignToken: string,
    base: string,
    close: () => Promise<void>;
  let ctx: AuthorizationContext;
  let invoiceCounter = 0;
  const call = (method: string, path: string, auth?: string, body?: Record<string, unknown>) =>
    httpJson(base, method, path, { token: auth, body });
  const invoice = async () => {
    const id = (
      await pool.query(
        "INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status) VALUES($1,$2,$3,$4,'100.00','0.00','100.00','Pending') RETURNING id",
        [tenant, facility, patient, `INV-ACCEPT-${suffix}-${++invoiceCounter}`],
      )
    ).rows[0].id as number;
    await pool.query(
      "INSERT INTO billing_items(invoice_id,item_type,description,quantity,unit_price,total_amount) VALUES($1,'Synthetic','Synthetic service',1,'100.00','100.00')",
      [id],
    );
    return id;
  };
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    const [a, b] = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id', [
        `Synthetic billing ${suffix}`,
        `bill-a-${suffix}`,
        `Synthetic other ${suffix}`,
        `bill-b-${suffix}`,
      ])
    ).rows.map((r) => r.id);
    tenant = a;
    const [f, otherFacility] = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic A',$5::jsonb),($3,$4,'Synthetic B',$5::jsonb) RETURNING id",
        [tenant, `BA-${suffix}`, b, `BB-${suffix}`, JSON.stringify(['finance'])],
      )
    ).rows.map((r) => r.id);
    facility = f;
    patient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Test','2000-01-01','Other') RETURNING id",
        [tenant, facility, `BP-${suffix}`],
      )
    ).rows[0].id;
    for (const code of ['billing.read', 'billing.update', 'billing.payments.record'])
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'billing') ON CONFLICT(code) DO NOTHING",
        [code],
      );
    const actor = async (tag: string, t: number, f: number, grants: string[]) => {
      const id = (
        await pool.query(
          "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,$3,'test-only','ACTIVE',$4,$5) RETURNING id",
          [`bill-${tag}-${suffix}`, `bill-${tag}-${suffix}@example.test`, `Synthetic ${tag}`, t, f],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [t, `BILL_${tag}_${suffix}`],
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
    const manager = await actor('manager', tenant, facility, [
      'billing.read',
      'billing.update',
      'billing.payments.record',
    ]);
    const reader = await actor('reader', tenant, facility, ['billing.read']);
    const foreign = await actor('foreign', b, otherFacility, [
      'billing.read',
      'billing.update',
      'billing.payments.record',
    ]);
    actorId = manager.id;
    token = manager.token;
    readerToken = reader.token;
    foreignToken = foreign.token;
    ctx = {
      userId: actorId,
      tenantId: tenant,
      facilityId: facility,
      roles: [],
      permissions: [],
      isSuperAdmin: false,
    };
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('retains an unpaid voided invoice and lines, records an audit, and refuses later receipts', async () => {
    const id = await invoice();
    expect(
      (
        await call('POST', `/api/invoices/${id}/void`, readerToken, {
          reason: 'Synthetic duplicate',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('POST', `/api/invoices/${id}/void`, foreignToken, {
          reason: 'Synthetic duplicate',
        })
      ).status,
    ).toBe(403);
    const result = await call('POST', `/api/invoices/${id}/void`, token, {
      reason: 'Synthetic duplicate',
    });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('Void');
    expect(
      (await call('POST', `/api/invoices/${id}/void`, token, { reason: 'Synthetic retry' })).status,
    ).toBe(409);
    const payment = await call('POST', '/api/billing/payments', token, {
      invoiceId: id,
      facilityId: facility,
      amount: '25.00',
      paymentMethod: 'Cash',
    });
    expect(payment.status).toBe(409);
    expect(payment.body.error).toBe('INVOICE_VOIDED');
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM billing_items WHERE invoice_id=$1', [id]))
        .rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM billing_payments WHERE invoice_id=$1', [
          id,
        ])
      ).rows[0].n,
    ).toBe(0);
    const audits = await pool.query(
      "SELECT action,details FROM audit_logs WHERE resource='Invoice' AND resource_id=$1",
      [String(id)],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0].action).toBe('UPDATE');
    expect(audits.rows[0].details).not.toContain('Synthetic duplicate');
  });

  it('records a partial receipt and rejects a paid invoice void or duplicate mobile reference', async () => {
    const id = await invoice();
    const body = {
      invoiceId: id,
      facilityId: facility,
      amount: '40.00',
      paymentMethod: 'M-Pesa',
      transactionCode: `AB${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
    };
    expect((await call('POST', '/api/billing/payments', readerToken, body)).status).toBe(403);
    const first = await call('POST', '/api/billing/payments', token, body);
    expect(first.status).toBe(201);
    expect(first.body.invoice).toMatchObject({
      paidAmount: '40.00',
      balanceAmount: '60.00',
      status: 'Partially Paid',
    });
    expect(first.body.payment.receiptNumber).toMatch(/^RCP-/);
    expect((await call('POST', '/api/billing/payments', token, body)).status).toBe(409);
    expect(
      (await call('POST', `/api/invoices/${id}/void`, token, { reason: 'Synthetic duplicate' }))
        .status,
    ).toBe(409);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM billing_payments WHERE invoice_id=$1', [
          id,
        ])
      ).rows[0].n,
    ).toBe(1);
    // Receipt records local entry only; no live mobile-money confirmation is tested.
  });

  it('refuses voiding when a legacy payment exists even if invoice totals disagree', async () => {
    const id = await invoice();
    await pool.query(
      "INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name) VALUES($1,$2,'Cash','10.00','Synthetic')",
      [id, `RCP-INCONSISTENT-${suffix}`],
    );
    await expect(voidInvoiceScoped(ctx, id, 'Synthetic correction')).rejects.toMatchObject({
      status: 409,
    });
    expect(
      (await pool.query('SELECT status,voided_at FROM billing_invoices WHERE id=$1', [id])).rows[0],
    ).toEqual({ status: 'Pending', voided_at: null });
  });

  it('requires review instead of treating missing amounts as zero', async () => {
    for (const column of ['total_amount', 'paid_amount', 'balance_amount', 'credit_balance']) {
      const id = await invoice();
      await pool.query(`UPDATE billing_invoices SET ${column}=NULL WHERE id=$1`, [id]);
      await expect(voidInvoiceScoped(ctx, id, 'Synthetic missing amount')).rejects.toMatchObject({
        status: 409,
      });
      expect(
        (await pool.query('SELECT status,voided_at FROM billing_invoices WHERE id=$1', [id]))
          .rows[0],
      ).toEqual({ status: 'Pending', voided_at: null });
    }
  });

  it('blocks payment on missing amounts or disagreement with the payment ledger', async () => {
    for (const column of ['total_amount', 'paid_amount', 'balance_amount', 'credit_balance']) {
      const id = await invoice();
      await pool.query(`UPDATE billing_invoices SET ${column}=NULL WHERE id=$1`, [id]);
      const result = await call('POST', '/api/billing/payments', token, {
        invoiceId: id,
        facilityId: facility,
        amount: '10.00',
        paymentMethod: 'Cash',
      });
      expect(result.status).toBe(409);
      expect(result.body.error).toBe('INVOICE_RECONCILIATION_REQUIRED');
      expect(
        (await pool.query('SELECT id FROM billing_payments WHERE invoice_id=$1', [id])).rows,
      ).toHaveLength(0);
    }
    const id = await invoice();
    await pool.query(
      "INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name) VALUES($1,$2,'Cash','10.00','Synthetic')",
      [id, `RCP-LEDGER-${suffix}`],
    );
    const result = await call('POST', '/api/billing/payments', token, {
      invoiceId: id,
      facilityId: facility,
      amount: '10.00',
      paymentMethod: 'Cash',
    });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('INVOICE_RECONCILIATION_REQUIRED');
    expect(
      (await pool.query('SELECT id FROM billing_payments WHERE invoice_id=$1', [id])).rows,
    ).toHaveLength(1);
  });

  it('also refuses missing or inconsistent amounts in the legacy payment helper', async () => {
    const payment = (invoiceId: number) => ({
      invoiceId,
      receiptNumber: `LEGACY-${suffix}-${invoiceId}`,
      paymentMethod: 'Cash',
      amount: '10.00',
      cashierName: 'Synthetic',
    });
    for (const column of ['total_amount', 'paid_amount', 'balance_amount', 'credit_balance']) {
      const id = await invoice();
      await pool.query(`UPDATE billing_invoices SET ${column}=NULL WHERE id=$1`, [id]);
      await expect(recordPayment(payment(id))).rejects.toThrow('Failed to record patient payment');
      expect(
        (await pool.query('SELECT id FROM billing_payments WHERE invoice_id=$1', [id])).rows,
      ).toHaveLength(0);
    }
    const inconsistent = await invoice();
    await pool.query(
      "INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name) VALUES($1,$2,'Cash','10.00','Synthetic')",
      [inconsistent, `LEGACY-INCONSISTENT-${suffix}`],
    );
    await expect(recordPayment(payment(inconsistent))).rejects.toThrow(
      'Failed to record patient payment',
    );
    expect(
      (await pool.query('SELECT id FROM billing_payments WHERE invoice_id=$1', [inconsistent]))
        .rows,
    ).toHaveLength(1);
  });

  it('supports successive partial payments while preserving a receipt audit for each', async () => {
    const id = await invoice();
    const paymentBody = { invoiceId: id, facilityId: facility, paymentMethod: 'Cash' };
    const first = await call('POST', '/api/billing/payments', token, {
      ...paymentBody,
      amount: '40.00',
    });
    const second = await call('POST', '/api/billing/payments', token, {
      ...paymentBody,
      amount: '60.00',
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.invoice).toMatchObject({
      paidAmount: '100.00',
      balanceAmount: '0.00',
      status: 'Paid',
    });
    for (const p of [first.body.payment, second.body.payment]) {
      expect(
        (
          await pool.query(
            "SELECT id FROM audit_logs WHERE resource='Payment' AND resource_id=$1",
            [String(p.id)],
          )
        ).rows,
      ).toHaveLength(1);
    }
  });

  it('rolls back receipt and balance when the payment audit fails', async () => {
    const id = await invoice();
    const fn = `test_payment_audit_${suffix.replaceAll('-', '')}`,
      trigger = `test_payment_audit_trigger_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`,
    );
    try {
      await pool.query(
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.facility_id = ${facility} AND NEW.resource = 'Payment') EXECUTE FUNCTION "${fn}"()`,
      );
      await expect(
        recordSettledPayment(
          ctx,
          { invoiceId: id, facilityId: facility, amount: '10.00', paymentMethod: 'Cash' },
          'Synthetic',
        ),
      ).rejects.toThrow();
      expect(
        (
          await pool.query('SELECT paid_amount,balance_amount FROM billing_invoices WHERE id=$1', [
            id,
          ])
        ).rows[0],
      ).toEqual({ paid_amount: '0.00', balance_amount: '100.00' });
      expect(
        (await pool.query('SELECT id FROM billing_payments WHERE invoice_id=$1', [id])).rows,
      ).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${trigger}" ON audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
  });

  it('cannot void a payment that commits while the void request is waiting', async () => {
    const id = await invoice(),
      holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      const pid = (await holder.query('SELECT pg_backend_pid() AS id')).rows[0].id;
      await holder.query('SELECT id FROM billing_invoices WHERE id=$1 FOR UPDATE', [id]);
      const pending = voidInvoiceScoped(ctx, id, 'Synthetic race').then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
      await waitForBlockedBy(pid);
      // Simulate the transactionally committed receipt that acquired the lock first.
      await holder.query(
        "INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name) VALUES($1,$2,'Cash','40.00','Synthetic')",
        [id, `RCP-RACE-${suffix}`],
      );
      await holder.query(
        "UPDATE billing_invoices SET paid_amount='40.00',balance_amount='60.00',status='Partially Paid' WHERE id=$1",
        [id],
      );
      await holder.query('COMMIT');
      const result = await pending;
      expect(result.error).toMatchObject({ status: 409 });
      expect(
        (
          await pool.query(
            'SELECT status,paid_amount,voided_at FROM billing_invoices WHERE id=$1',
            [id],
          )
        ).rows[0],
      ).toEqual({ status: 'Partially Paid', paid_amount: '40.00', voided_at: null });
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });

  it('rolls back invoice voiding if its audit entry cannot be written', async () => {
    const id = await invoice();
    const fn = `test_invoice_audit_${suffix.replaceAll('-', '')}`;
    const trigger = `test_invoice_audit_trigger_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`,
    );
    try {
      await pool.query(
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.facility_id = ${facility} AND NEW.resource = 'Invoice') EXECUTE FUNCTION "${fn}"()`,
      );
      await expect(voidInvoiceScoped(ctx, id, 'Synthetic audit rollback')).rejects.toThrow();
      expect(
        (await pool.query('SELECT status,voided_at FROM billing_invoices WHERE id=$1', [id]))
          .rows[0],
      ).toEqual({ status: 'Pending', voided_at: null });
      expect(
        (
          await pool.query(
            "SELECT id FROM audit_logs WHERE resource='Invoice' AND resource_id=$1",
            [String(id)],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${trigger}" ON audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
  });

  it('serializes concurrent payment and void: exactly one commits', async () => {
    const id = await invoice();
    const outcomes = await Promise.allSettled([
      voidInvoiceScoped(ctx, id, 'Synthetic concurrent void'),
      recordSettledPayment(
        ctx,
        { facilityId: facility, invoiceId: id, amount: '50.00', paymentMethod: 'Cash' },
        'Synthetic cashier',
      ),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const state = (
      await pool.query('SELECT status,paid_amount,voided_at FROM billing_invoices WHERE id=$1', [
        id,
      ])
    ).rows[0];
    const receipts = (await pool.query('SELECT id FROM billing_payments WHERE invoice_id=$1', [id]))
      .rows;
    if (state.status === 'Void') {
      expect(state.paid_amount).toBe('0.00');
      expect(receipts).toHaveLength(0);
    } else {
      expect(state.status).toBe('Partially Paid');
      expect(state.voided_at).toBeNull();
      expect(receipts).toHaveLength(1);
    }
  });
});
