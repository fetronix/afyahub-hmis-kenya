/** Synthetic PostgreSQL tests of the shared charge/payment/void boundary. */
import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { chargeForService, type ChargeRequest } from '../../billing/billing.service.ts';
import { recordSettledPayment } from '../../billing/payments.service.ts';
import {
  chargeAndRecord,
  recordChargeAttempt,
  retryChargeAttempt,
  retryPendingChargeAttempts,
  voidChargeAttempt,
} from '../../billing/charge-attempts.ts';
import { db, pool } from '../../db/index.ts';
import { voidInvoiceScoped } from '../../db/queries/billing.ts';
import { describeDb } from '../vitest/support/db.ts';

async function waitForBlockedBy(pid: number, minimum = 1) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `WITH RECURSIVE waiting(pid) AS (
         SELECT $1::int
         UNION
         SELECT activity.pid FROM pg_stat_activity AS activity
         JOIN waiting ON waiting.pid = ANY(pg_blocking_pids(activity.pid))
       ) SELECT (count(*) - 1)::int AS count FROM waiting`,
      [pid],
    );
    if (result.rows[0].count >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Expected database lock was not observed.');
}

describeDb('Automatic charge transaction boundary (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, facility: number, patient: number, actor: number;
  let ctx: AuthorizationContext;
  let serial = 0;
  const tariffCode = `SYN-CHARGE-${suffix}`;
  const items = new Map<number, { priced: number; unpriced: number }>();
  // Use actual synthetic dispensations, not a synthetic MANUAL billing bypass.
  const request = async (
    patientId = patient,
    facilityId = facility,
    priced = true,
  ): Promise<ChargeRequest> => {
    const products = items.get(facilityId)!;
    const itemId = priced ? products.priced : products.unpriced;
    const sourceId = (
      await pool.query(
        "INSERT INTO pharmacy_dispensations(tenant_id,facility_id,patient_id,item_id,quantity_dispensed,dispensed_by) VALUES($1,$2,$3,$4,1,'Synthetic') RETURNING id",
        [tenant, facilityId, patientId, itemId],
      )
    ).rows[0].id as number;
    return {
      tenantId: tenant,
      facilityId,
      patientId,
      codes: [tariffCode],
      family: 'PHARMACY',
      serviceName: priced ? 'Synthetic priced item' : 'Synthetic unpriced item',
      sourceType: 'PHARMACY',
      sourceId,
      itemType: 'Synthetic',
    };
  };
  const configureFacility = async (facilityId: number) => {
    const priced = (
      await pool.query(
        "INSERT INTO inventory_items(facility_id,item_code,name,unit) VALUES($1,$2,'Synthetic priced item','Tablet') RETURNING id",
        [facilityId, `ITEM-${suffix}`],
      )
    ).rows[0].id as number;
    const unpriced = (
      await pool.query(
        "INSERT INTO inventory_items(facility_id,item_code,name,unit) VALUES($1,$2,'Synthetic unpriced item','Tablet') RETURNING id",
        [facilityId, `NOITEM-${suffix}`],
      )
    ).rows[0].id as number;
    const service = (
      await pool.query(
        "INSERT INTO facility_services(tenant_id,facility_id,code,name,description,department,category,unit,is_active,auto_bill) VALUES($1,$2,$3,'Synthetic priced item','Synthetic priced item','pharmacy','PHARMACY','Tablet',true,true) RETURNING id",
        [tenant, facilityId, `ITEM-${suffix}`.toUpperCase()],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee,facility_service_id,is_active,auto_bill) VALUES($1,$2,$3,'Synthetic charge','pharmacy','Tablet','7.50',$4,true,true)",
      [tenant, facilityId, tariffCode, service],
    );
    items.set(facilityId, { priced, unpriced });
  };
  const makeInvoice = async () => {
    const id = (
      await pool.query(
        "INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,credit_balance,status) VALUES($1,$2,$3,$4,'100.00','0.00','100.00','0.00','Pending') RETURNING id",
        [tenant, facility, patient, `SYN-CHARGE-INV-${suffix}-${++serial}`],
      )
    ).rows[0].id as number;
    await pool.query(
      "INSERT INTO billing_items(invoice_id,item_type,description,quantity,unit_price,total_amount) VALUES($1,'Synthetic','Synthetic existing item',1,'100.00','100.00')",
      [id],
    );
    return id;
  };

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic charge ${suffix}`,
        `charge-${suffix}`,
      ])
    ).rows[0].id;
    facility = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic charge facility',$3::jsonb) RETURNING id",
        [tenant, `FC-${suffix}`, JSON.stringify(['finance'])],
      )
    ).rows[0].id;
    patient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Charge','2000-01-01','Other') RETURNING id",
        [tenant, facility, `CH-${suffix}`],
      )
    ).rows[0].id;
    actor = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic','test-only','ACTIVE',$3,$4) RETURNING id",
        [`charge-${suffix}`, `charge-${suffix}@example.test`, tenant, facility],
      )
    ).rows[0].id;
    await configureFacility(facility);
    ctx = {
      userId: actor,
      tenantId: tenant,
      facilityId: facility,
      roles: [],
      permissions: [],
      isSuperAdmin: false,
    };
  });

  it('recognizes a previously billed event even after its tariff is deactivated', async () => {
    const another = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Retry','2000-01-01','Other') RETURNING id",
        [tenant, facility, `RETRY-${suffix}`],
      )
    ).rows[0].id;
    const same = await request(another);
    const initial = await chargeAndRecord(db, same);
    expect(initial.charged).toBe(true);
    await pool.query(
      'UPDATE facility_service_tariffs SET is_active=false WHERE facility_id=$1 AND code=$2',
      [facility, tariffCode],
    );
    try {
      const retry = await chargeAndRecord(db, same);
      expect(retry).toMatchObject({
        charged: false,
        reason: 'DUPLICATE',
        invoiceId: initial.invoiceId,
        itemId: initial.itemId,
      });
      expect(
        (
          await pool.query(
            'SELECT id FROM billing_charge_attempts WHERE facility_id=$1 AND source_type=$2 AND source_id=$3',
            [facility, same.sourceType, same.sourceId],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await pool.query(
        'UPDATE facility_service_tariffs SET is_active=true WHERE facility_id=$1 AND code=$2',
        [facility, tariffCode],
      );
    }
  });

  it('keeps one retry-queue row when concurrent unpriced attempts collide', async () => {
    const another = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Unpriced','2000-01-01','Other') RETURNING id",
        [tenant, facility, `UNPRICED-${suffix}`],
      )
    ).rows[0].id;
    const same = await request(another, facility, false);
    const fn = `test_queue_race_${suffix.replaceAll('-', '')}`;
    const trigger = `test_queue_race_trigger_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER "${trigger}" BEFORE INSERT ON billing_charge_attempts FOR EACH ROW WHEN (NEW.facility_id = ${facility} AND NEW.source_id = ${same.sourceId}) EXECUTE FUNCTION "${fn}"()`,
    );
    try {
      const results = await Promise.all([chargeAndRecord(db, same), chargeAndRecord(db, same)]);
      expect(results.every((r) => r.reason === 'TARIFF_NOT_CONFIGURED')).toBe(true);
      expect(
        results.every((r) => !r.message?.includes('could not be recorded in the retry queue')),
      ).toBe(true);
      const rows = (
        await pool.query(
          'SELECT attempts,status FROM billing_charge_attempts WHERE facility_id=$1 AND source_type=$2 AND source_id=$3',
          [facility, same.sourceType, same.sourceId],
        )
      ).rows;
      expect(rows).toEqual([{ attempts: 2, status: 'PENDING' }]);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${trigger}" ON billing_charge_attempts`);
      await pool.query(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
  });

  it('serializes queue write-off against retry and never bills a voided attempt', async () => {
    const another = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Queue','2000-01-01','Other') RETURNING id",
        [tenant, facility, `QRACE-${suffix}`],
      )
    ).rows[0].id;
    const req = await request(another);
    const attemptId = await recordChargeAttempt(db, req, {
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
      message: 'Synthetic queued charge',
    });
    expect(attemptId).toBeTypeOf('number');
    const input = {
      tenantId: tenant,
      facilityId: facility,
      attemptId: attemptId!,
      actorUserId: actor,
    };
    const [retried, writtenOff] = await Promise.all([
      retryChargeAttempt(db, input),
      voidChargeAttempt(db, { ...input, reason: 'Synthetic authorized write-off' }),
    ]);
    const row = (
      await pool.query('SELECT status,resolved_item_id FROM billing_charge_attempts WHERE id=$1', [
        attemptId,
      ])
    ).rows[0];
    const lines = (
      await pool.query(
        'SELECT b.id FROM billing_items b JOIN billing_invoices i ON i.id=b.invoice_id WHERE i.patient_id=$1',
        [another],
      )
    ).rows;
    if (writtenOff) {
      expect(retried?.status).toBe('VOID');
      expect(row.status).toBe('VOID');
      expect(lines).toHaveLength(0);
    } else {
      expect(retried?.status).toBe('BILLED');
      expect(row.status).toBe('BILLED');
      expect(lines).toHaveLength(1);
      expect(row.resolved_item_id).toBe(lines[0].id);
    }
    expect(
      (
        await pool.query(
          "SELECT id FROM audit_logs WHERE resource='BillingChargeAttempt' AND resource_id=$1",
          [String(attemptId)],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it('serializes a direct clinical replay with write-off and preserves the terminal outcome', async () => {
    const another = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Replay','2000-01-01','Other') RETURNING id",
        [tenant, facility, `DIRECT-${suffix}`],
      )
    ).rows[0].id;
    const req = await request(another);
    const attemptId = await recordChargeAttempt(db, req, {
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
      message: 'Synthetic queued charge',
    });
    const [replay, writtenOff] = await Promise.all([
      chargeAndRecord(db, req),
      voidChargeAttempt(db, {
        tenantId: tenant,
        facilityId: facility,
        attemptId: attemptId!,
        actorUserId: actor,
        reason: 'Synthetic authorized write-off',
      }),
    ]);
    const attempt = (
      await pool.query('SELECT status,resolved_item_id FROM billing_charge_attempts WHERE id=$1', [
        attemptId,
      ])
    ).rows[0];
    const lines = (
      await pool.query(
        'SELECT b.id FROM billing_items b JOIN billing_invoices i ON i.id=b.invoice_id WHERE i.patient_id=$1',
        [another],
      )
    ).rows;
    if (writtenOff) {
      expect(replay).toMatchObject({ charged: false, reason: 'ATTEMPT_VOIDED' });
      expect(attempt.status).toBe('VOID');
      expect(lines).toHaveLength(0);
      expect(await chargeAndRecord(db, req)).toMatchObject({ reason: 'ATTEMPT_VOIDED' });
    } else {
      expect(replay.charged).toBe(true);
      expect(attempt.status).toBe('BILLED');
      expect(lines).toHaveLength(1);
      expect(attempt.resolved_item_id).toBe(lines[0].id);
      expect(await chargeAndRecord(db, req)).toMatchObject({
        charged: false,
        reason: 'DUPLICATE',
        itemId: lines[0].id,
      });
    }
  });

  it('never bills a written-off source through a later clinical replay', async () => {
    const another = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','VoidReplay','2000-01-01','Other') RETURNING id",
        [tenant, facility, `VOIDDIRECT-${suffix}`],
      )
    ).rows[0].id;
    const req = await request(another);
    const attemptId = await recordChargeAttempt(db, req, {
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
    });
    expect(
      await voidChargeAttempt(db, {
        tenantId: tenant,
        facilityId: facility,
        attemptId: attemptId!,
        actorUserId: actor,
        reason: 'Synthetic authorized write-off',
      }),
    ).toBe(true);
    expect(await chargeAndRecord(db, req)).toMatchObject({
      charged: false,
      reason: 'ATTEMPT_VOIDED',
    });
    expect(
      (await pool.query('SELECT id FROM billing_invoices WHERE patient_id=$1', [another])).rows,
    ).toHaveLength(0);
  });

  it('rolls back a direct replay if queue-resolution audit fails', async () => {
    const another = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','ReplayAudit','2000-01-01','Other') RETURNING id",
        [tenant, facility, `DIRECTAUDIT-${suffix}`],
      )
    ).rows[0].id;
    const req = await request(another);
    const attemptId = await recordChargeAttempt(db, req, {
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
    });
    const fn = `test_direct_queue_audit_${suffix.replaceAll('-', '')}`;
    const trigger = `test_direct_queue_trigger_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER "${trigger}" BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.facility_id = ${facility} AND NEW.resource = 'BillingChargeAttempt') EXECUTE FUNCTION "${fn}"()`,
    );
    try {
      expect(await chargeAndRecord(db, req)).toMatchObject({
        charged: false,
        reason: 'INVALID_INPUT',
      });
      expect(
        (await pool.query('SELECT status FROM billing_charge_attempts WHERE id=$1', [attemptId]))
          .rows[0].status,
      ).toBe('PENDING');
      expect(
        (await pool.query('SELECT id FROM billing_invoices WHERE patient_id=$1', [another])).rows,
      ).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${trigger}" ON audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
  });

  it('does not write off a legacy pending attempt that already has a billed line, and counts it as a verified duplicate', async () => {
    const isolatedFacility = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic batch facility',$3::jsonb) RETURNING id",
        [tenant, `BATCH-${suffix}`, JSON.stringify(['finance'])],
      )
    ).rows[0].id;
    const another = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Duplicate','2000-01-01','Other') RETURNING id",
        [tenant, isolatedFacility, `BATCHPAT-${suffix}`],
      )
    ).rows[0].id;
    await configureFacility(isolatedFacility);
    const req = await request(another, isolatedFacility);
    const billed = await chargeAndRecord(db, req);
    expect(billed.charged).toBe(true);
    // Simulate a legacy pending row left behind after a successful charge.
    const attemptId = await recordChargeAttempt(db, req, {
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
    });
    expect(
      await voidChargeAttempt(db, {
        tenantId: tenant,
        facilityId: isolatedFacility,
        attemptId: attemptId!,
        actorUserId: actor,
        reason: 'Synthetic authorized write-off',
      }),
    ).toBe(false);
    const summary = await retryPendingChargeAttempts(db, {
      tenantId: tenant,
      facilityId: isolatedFacility,
      actorUserId: actor,
    });
    expect(summary).toMatchObject({
      tried: 1,
      billed: 0,
      duplicates: 1,
      stillPending: 0,
      skipped: 0,
    });
    const attempt = (
      await pool.query('SELECT status,resolved_item_id FROM billing_charge_attempts WHERE id=$1', [
        attemptId,
      ])
    ).rows[0];
    expect(attempt).toEqual({ status: 'DUPLICATE', resolved_item_id: billed.itemId });
  });

  it('refuses historical queue contradictions instead of inferring a bill or undoing a write-off', async () => {
    const another = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','History','2000-01-01','Other') RETURNING id",
        [tenant, facility, `HISTORY-${suffix}`],
      )
    ).rows[0].id;
    const req = await request(another);
    const oldId = await recordChargeAttempt(db, req, {
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
    });
    expect(
      await voidChargeAttempt(db, {
        tenantId: tenant,
        facilityId: facility,
        attemptId: oldId!,
        actorUserId: actor,
        reason: 'Synthetic historical write-off',
      }),
    ).toBe(true);
    // The old implementation could create another pending row after write-off.
    const laterId = await recordChargeAttempt(db, req, {
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
    });
    expect(
      await retryChargeAttempt(db, {
        tenantId: tenant,
        facilityId: facility,
        attemptId: laterId!,
        actorUserId: actor,
      }),
    ).toMatchObject({ status: 'PENDING', result: { charged: false, reason: 'INVALID_INPUT' } });
    expect(await chargeAndRecord(db, req)).toMatchObject({ reason: 'ATTEMPT_VOIDED' });
    expect(
      (await pool.query('SELECT id FROM billing_invoices WHERE patient_id=$1', [another])).rows,
    ).toHaveLength(0);
  });

  it('rolls back a retried charge when the attempt audit cannot be recorded', async () => {
    const another = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Audit','2000-01-01','Other') RETURNING id",
        [tenant, facility, `QAUDIT-${suffix}`],
      )
    ).rows[0].id;
    const req = await request(another);
    const attemptId = await recordChargeAttempt(db, req, {
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
      message: 'Synthetic queued charge',
    });
    const fn = `test_queue_audit_${suffix.replaceAll('-', '')}`;
    const trigger = `test_queue_audit_trigger_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER "${trigger}" BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.facility_id = ${facility} AND NEW.resource = 'BillingChargeAttempt') EXECUTE FUNCTION "${fn}"()`,
    );
    try {
      await expect(
        retryChargeAttempt(db, {
          tenantId: tenant,
          facilityId: facility,
          attemptId: attemptId!,
          actorUserId: actor,
        }),
      ).rejects.toThrow();
      expect(
        (await pool.query('SELECT status FROM billing_charge_attempts WHERE id=$1', [attemptId]))
          .rows[0].status,
      ).toBe('PENDING');
      expect(
        (await pool.query('SELECT id FROM billing_invoices WHERE patient_id=$1', [another])).rows,
      ).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${trigger}" ON audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
  });

  it('serializes competing first charges and retries without duplicate or empty invoices', async () => {
    const anotherPatient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Concurrent','2000-01-01','Other') RETURNING id",
        [tenant, facility, `CC-${suffix}`],
      )
    ).rows[0].id as number;
    const one = await request(anotherPatient),
      two = await request(anotherPatient);
    const results = await Promise.all([
      chargeForService(db, one),
      chargeForService(db, two),
      chargeForService(db, one),
    ]);
    expect(results.filter((r) => r.charged)).toHaveLength(2);
    expect(results.filter((r) => r.reason === 'DUPLICATE')).toHaveLength(1);
    const invoices = (
      await pool.query(
        'SELECT id,total_amount,balance_amount FROM billing_invoices WHERE patient_id=$1',
        [anotherPatient],
      )
    ).rows;
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ total_amount: '15.00', balance_amount: '15.00' });
    expect(
      (await pool.query('SELECT id FROM billing_items WHERE invoice_id=$1', [invoices[0].id])).rows,
    ).toHaveLength(2);
    expect(
      (
        await pool.query(
          "SELECT id FROM audit_logs WHERE facility_id=$1 AND resource='BillingItem' AND resource_id IN (SELECT id::text FROM billing_items WHERE invoice_id=$2)",
          [facility, invoices[0].id],
        )
      ).rows,
    ).toHaveLength(2);
  });

  it('never appends a charge after a waiting void commits', async () => {
    const id = await makeInvoice(),
      holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      const pid = (await holder.query('SELECT pg_backend_pid() AS id')).rows[0].id;
      await holder.query('SELECT id FROM billing_invoices WHERE id=$1 FOR UPDATE', [id]);
      const voiding = voidInvoiceScoped(ctx, id, 'Synthetic race review');
      await waitForBlockedBy(pid);
      const charging = chargeForService(db, await request());
      await waitForBlockedBy(pid, 2);
      await holder.query('COMMIT');
      const [voided, charged] = await Promise.all([voiding, charging]);
      expect(voided.status).toBe('Void');
      expect(charged.charged).toBe(true);
      expect(charged.invoiceId).not.toBe(id);
      expect(
        (await pool.query('SELECT id FROM billing_items WHERE invoice_id=$1', [id])).rows,
      ).toHaveLength(1);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });

  it('serializes a charge before a waiting receipt and preserves the updated balance', async () => {
    const id = await makeInvoice(),
      holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      const pid = (await holder.query('SELECT pg_backend_pid() AS id')).rows[0].id;
      await holder.query('SELECT id FROM billing_invoices WHERE id=$1 FOR UPDATE', [id]);
      const charging = chargeForService(db, await request());
      await waitForBlockedBy(pid);
      const paying = recordSettledPayment(
        ctx,
        { invoiceId: id, facilityId: facility, amount: '100.00', paymentMethod: 'Cash' },
        'Synthetic',
      );
      await waitForBlockedBy(pid, 2);
      await holder.query('COMMIT');
      const [charged, paid] = await Promise.all([charging, paying]);
      expect(charged.invoiceId).toBe(id);
      expect(paid.invoice).toMatchObject({
        totalAmount: '107.50',
        paidAmount: '100.00',
        balanceAmount: '7.50',
      });
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });

  it('rejects unknown line/header money and rolls back a failed charge audit', async () => {
    const id = await makeInvoice();
    await pool.query('UPDATE billing_items SET total_amount=NULL WHERE invoice_id=$1', [id]);
    await expect(chargeForService(db, await request())).rejects.toThrow(
      'INVOICE_RECONCILIATION_REQUIRED',
    );
    expect(
      (await pool.query('SELECT id FROM billing_items WHERE invoice_id=$1', [id])).rows,
    ).toHaveLength(1);
    await pool.query("UPDATE billing_items SET total_amount='100.00' WHERE invoice_id=$1", [id]);
    const fn = `test_charge_audit_${suffix.replaceAll('-', '')}`;
    const trigger = `test_charge_audit_trigger_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`,
    );
    try {
      await pool.query(
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.facility_id = ${facility} AND NEW.resource = 'BillingItem') EXECUTE FUNCTION "${fn}"()`,
      );
      await expect(chargeForService(db, await request())).rejects.toThrow();
      expect(
        (
          await pool.query('SELECT total_amount,balance_amount FROM billing_invoices WHERE id=$1', [
            id,
          ])
        ).rows[0],
      ).toEqual({ total_amount: '100.00', balance_amount: '100.00' });
      expect(
        (await pool.query('SELECT id FROM billing_items WHERE invoice_id=$1', [id])).rows,
      ).toHaveLength(1);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${trigger}" ON audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
  });
});
