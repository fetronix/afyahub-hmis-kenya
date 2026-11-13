/**
 * Operations status — does an operator learn that work is stuck?
 *
 * Every fixture below is synthetic. The assertions are about what the endpoint
 * measures, not about whether the numbers are "good": this file deliberately
 * checks that an old item is reported as old, that another facility's work is
 * invisible, and that the payload carries no patient identity.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { describeDb, testPool } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('facility operations status (synthetic PostgreSQL)', () => {
  const pool = testPool();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);

  let tenant: number;
  let otherTenant: number;
  let facilityA: number;
  let facilityB: number;
  let otherFacility: number;
  let adminA: number;
  let noAuditUser: number;
  let tenantBUser: number;
  let tokenA: string;
  let tokenNoAudit: string;
  let tokenB: string;
  let base: string;
  let close: () => Promise<void>;

  const status = (token = tokenA, query = '') =>
    httpJson(base, 'GET', `/api/ops/status${query}`, { token });

  beforeAll(async () => {
    const tenants = await pool.query(
      `INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id`,
      ['Synthetic ops tenant', `ops-${suffix}`, 'Synthetic ops other tenant', `ops-b-${suffix}`],
    );
    tenant = tenants.rows[0].id;
    otherTenant = tenants.rows[1].id;

    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,level,mfl_code,enabled_modules)
       VALUES($1,$2,'Synthetic ops A','Level 4',$5,'["registration","insurance","billing","audit"]'::jsonb),
             ($1,$3,'Synthetic ops A second','Level 4',$6,'["registration","insurance","billing","audit"]'::jsonb),
             ($4,$7,'Synthetic ops other','Level 4',$8,'["registration","insurance","billing","audit"]'::jsonb)
       RETURNING id`,
      [
        tenant,
        `OPS-A-${suffix}`,
        `OPS-A2-${suffix}`,
        otherTenant,
        `MFL-OPSA-${suffix}`,
        `MFL-OPSA2-${suffix}`,
        `OPS-B-${suffix}`,
        `MFL-OPSB-${suffix}`,
      ],
    );
    facilityA = facilities.rows[0].id;
    facilityB = facilities.rows[1].id;
    otherFacility = facilities.rows[2].id;

    const makeUser = async (label: string, tenantId: number, facilityId: number) =>
      (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
           VALUES($1,$1,$2,'Synthetic ops staff','test-only','ACTIVE',$3,$4) RETURNING id`,
          [`ops-${label}-${suffix}`, `ops-${label}-${suffix}@example.test`, tenantId, facilityId],
        )
      ).rows[0].id as number;

    adminA = await makeUser('admin', tenant, facilityA);
    noAuditUser = await makeUser('noaudit', tenant, facilityA);
    tenantBUser = await makeUser('tenantb', otherTenant, otherFacility);

    const grant = async (label: string, userId: number, codes: string[]) => {
      const roleId = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `OPS-${label}-${suffix}`],
        )
      ).rows[0].id;
      for (const code of codes) {
        await pool.query(
          "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT (code) DO NOTHING",
          [code],
        );
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING',
          [roleId, code],
        );
      }
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [userId, roleId]);
    };
    await grant('ADMIN', adminA, ['audit.read', 'patients.read']);
    await grant('NOAUDIT', noAuditUser, ['patients.read']);

    const otherRole = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [otherTenant, `OPS-B-${suffix}`],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES('audit.read','audit.read','synthetic') ON CONFLICT (code) DO NOTHING",
    );
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
      [otherRole, 'audit.read'],
    );
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
      tenantBUser,
      otherRole,
    ]);

    [tokenA, tokenNoAudit, tokenB] = await Promise.all(
      [adminA, noAuditUser, tenantBUser].map(
        async (userId) => (await createSession({ userId, securityVersion: 1 })).sessionToken,
      ),
    );

    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));

    const patient = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
         VALUES($1,$2,$3,'Synthetic','Ops Patient','1991-05-06','Male') RETURNING id`,
        [tenant, facilityA, `OPS-PAT-${suffix}`],
      )
    ).rows[0].id;

    const invoice = (
      await pool.query(
        `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status)
         VALUES($1,$2,$3,$4,'900.00','0.00','900.00','Pending') RETURNING id`,
        [tenant, facilityA, patient, `OPS-INV-${suffix}`],
      )
    ).rows[0].id;

    const payment = (
      await pool.query(
        `INSERT INTO billing_payments(invoice_id,receipt_number,amount,payment_method,cashier_name,payment_date)
         VALUES($1,$2,'100.00','CASH','Synthetic cashier','2026-10-01') RETURNING id`,
        [invoice, `OPS-RCPT-${suffix}`],
      )
    ).rows[0].id;

    /*
     * Dispatch reservations carry a trigger that requires the referenced claim
     * to exist in the same tenant and facility — a guard cannot point at a
     * foreign claim. So every synthetic reservation below gets a real claim,
     * with its own patient and invoice.
     */
    const makeClaim = async (tenantId: number, facilityId: number, label: string) => {
      const patientId = (
        await pool.query(
          `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
           VALUES($1,$2,$3,'Synthetic','Ops claim patient','1991-05-06','Male') RETURNING id`,
          [tenantId, facilityId, `OPS-CPAT-${label}-${suffix}`],
        )
      ).rows[0].id;
      const invoiceId = (
        await pool.query(
          `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status)
           VALUES($1,$2,$3,$4,'100.00','0.00','100.00','Pending') RETURNING id`,
          [tenantId, facilityId, patientId, `OPS-CINV-${label}-${suffix}`],
        )
      ).rows[0].id;
      return (
        await pool.query(
          `INSERT INTO sha_eclaims(
             tenant_id,facility_id,patient_id,invoice_id,claim_number,claim_uuid,
             billable_start,billable_end,total_billed_amount,total_claimed_amount,status)
           VALUES($1,$2,$3,$4,$5,$6,'2026-10-01','2026-10-01','100.00','100.00','READY_FOR_SUBMISSION')
           RETURNING id`,
          [tenantId, facilityId, patientId, invoiceId, `OPS-CLM-${label}-${suffix}`, randomUUID()],
        )
      ).rows[0].id as number;
    };

    const [claimA1, claimA2, claimB, claimOther] = await Promise.all([
      makeClaim(tenant, facilityA, 'A1'),
      makeClaim(tenant, facilityA, 'A2'),
      makeClaim(tenant, facilityB, 'B1'),
      makeClaim(otherTenant, otherFacility, 'OTH'),
    ]);

    // Two dispatch reservations here, one in the second facility, one in the
    // other tenant. Only the first two are this facility's work.
    await pool.query(
      `INSERT INTO insurance_claim_dispatch_guards(
         tenant_id,facility_id,workflow,claim_id,claim_revision,attempt_number,correlation_id,state,actor_user_id,created_at,updated_at)
       VALUES
         ($1,$2,'SHA',$11,0,1,$5,'UNCERTAIN',$7, now() - interval '3 days', now() - interval '3 days'),
         ($1,$2,'SHA',$12,0,2,$6,'IN_FLIGHT',$7, now() - interval '1 hour', now() - interval '1 hour'),
         ($1,$3,'SHA',$13,0,1,$8,'UNCERTAIN',$7, now(), now()),
         ($4,$9,'SHA',$14,0,1,$10,'UNCERTAIN',$7, now(), now())`,
      [
        tenant,
        facilityA,
        facilityB,
        otherTenant,
        `ops-corr-1-${suffix}`,
        `ops-corr-2-${suffix}`,
        adminA,
        `ops-corr-3-${suffix}`,
        otherFacility,
        `ops-corr-4-${suffix}`,
        claimA1,
        claimA2,
        claimB,
        claimOther,
      ],
    );

    await pool.query(
      `INSERT INTO billing_charge_attempts(
         tenant_id,facility_id,patient_id,source_type,source_id,item_type,reason,status,created_at,updated_at)
       VALUES
         ($1,$2,$3,'LAB_ORDER',1,'LAB','No tariff configured','PENDING', now() - interval '2 days', now()),
         ($1,$2,$3,'RADIOLOGY_ORDER',2,'RADIOLOGY','No tariff configured','PENDING', now(), now()),
         ($1,$2,$3,'LAB_ORDER',3,'LAB','Priced later','BILLED', now() - interval '5 days', now())`,
      [tenant, facilityA, patient],
    );

    /*
     * A refund request can only be created in its REQUESTED state; a trigger
     * refuses any other initial status, which is why there is no synthetic
     * APPROVED row here. That is the behaviour being relied on, not worked
     * around.
     */
    await pool.query(
      `INSERT INTO billing_refund_requests(
         tenant_id,facility_id,invoice_id,payment_id,request_number,amount,refund_method,reason,
         idempotency_key,request_hash,status,requested_by_user_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'100.00','CASH','Synthetic duplicate receipt',$6,$8,'REQUESTED',$7,
               now() - interval '4 hours', now())`,
      [
        tenant,
        facilityA,
        invoice,
        payment,
        `OPS-REF-1-${suffix}`,
        `ops-ref-key-1-${suffix}`,
        adminA,
        'a'.repeat(64),
      ],
    );

    // One acknowledged call and two failures inside the window; one failure
    // outside it, which must not be counted.
    await pool.query(
      `INSERT INTO insurance_integration_diagnostics(
         tenant_id,facility_id,payer_code,adapter_key,environment,operation,outcome,correlation_id,summary,created_at)
       VALUES
         ($1,$2,'BRITAM','britam_direct','UNCONFIGURED','CLAIM_SUBMIT','ACKNOWLEDGED',$3,'synthetic', now() - interval '2 hours'),
         ($1,$2,'BRITAM','britam_direct','UNCONFIGURED','CLAIM_SUBMIT','FAILED_TRANSPORT',$4,'synthetic', now() - interval '1 hour'),
         ($1,$2,'SHA','sha_afyalink','SANDBOX','ELIGIBILITY_VERIFY','AWAITING_DOCUMENTATION',$5,'synthetic', now() - interval '30 minutes'),
         ($1,$2,'BRITAM','britam_direct','UNCONFIGURED','CLAIM_SUBMIT','FAILED_TRANSPORT',$6,'synthetic', now() - interval '2 days')`,
      [
        tenant,
        facilityA,
        `ops-diag-1-${suffix}`,
        `ops-diag-2-${suffix}`,
        `ops-diag-3-${suffix}`,
        `ops-diag-4-${suffix}`,
      ],
    );
  });

  afterAll(async () => {
    await close?.();
  });

  it('reports this facility work queues with real counts and ages', async () => {
    const res = await status();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.facilityId).toBe(facilityA);

    const queues = res.body.workQueues;
    expect(queues.claimDispatchReviews.count).toBe(2);
    expect(queues.claimDispatchReviews.byState).toEqual({ UNCERTAIN: 1, IN_FLIGHT: 1 });
    // Oldest reservation was created three days ago.
    expect(queues.claimDispatchReviews.oldestAgeMinutes).toBeGreaterThanOrEqual(3 * 24 * 60 - 5);

    expect(queues.unbilledCharges.count).toBe(2);
    expect(queues.unbilledCharges.oldestAgeMinutes).toBeGreaterThanOrEqual(2 * 24 * 60 - 5);

    expect(queues.refundRequestsAwaitingDecision.count).toBe(1);
    expect(queues.refundRequestsAwaitingDecision.oldestAgeMinutes).toBeGreaterThanOrEqual(200);

    for (const queue of Object.values(queues) as Array<{ nextAction: string }>) {
      expect(queue.nextAction.length).toBeGreaterThan(10);
    }
  });

  it('counts only failures inside the window and never calls an unknown outcome a success', async () => {
    const res = await status();
    expect(res.body.integration.windowHours).toBe(24);
    expect(res.body.integration.observed).toBe(3);
    expect(res.body.integration.flaggedFailures).toBe(2);

    const operations = res.body.integration.byOperation as Array<{
      operation: string;
      outcome: string;
      count: number;
    }>;
    const failure = operations.find((row) => row.outcome === 'FAILED_TRANSPORT');
    expect(failure?.count).toBe(1);
    expect(operations.some((row) => row.outcome === 'ACKNOWLEDGED')).toBe(true);
    expect(res.body.integration.note).toMatch(/neither counted as success nor as failure/i);
  });

  it('compares the applied migrations with the packaged journal', async () => {
    const res = await status();
    expect(res.body.schema.expectedMigrations).toBe(88);
    expect(res.body.schema.appliedMigrations).toBe(88);
    expect(res.body.schema.upToDate).toBe(true);
  });

  it('returns no patient identity or free text', async () => {
    const res = await status();
    const payload = JSON.stringify(res.body);
    expect(payload).not.toContain(`OPS-PAT-${suffix}`);
    expect(payload).not.toContain('Ops Patient');
    expect(payload).not.toContain(invoiceNumberForTest());
    expect(payload).not.toContain('Synthetic duplicate receipt');

    // The limitations are stated in the payload, not just in this test.
    expect(res.body.limitations.join(' ')).toMatch(/no patient/i);
    expect(res.body.limitations.join(' ')).toMatch(/not claimed by this endpoint/i);
  });

  it('scopes to the caller facility and refuses another tenant', async () => {
    // Super-admin style cross-facility request is refused for a facility user.
    const other = await status(tokenA, `?facilityId=${facilityB}`);
    expect(other.status).toBe(403);

    const foreign = await status(tokenB, `?facilityId=${facilityA}`);
    expect([403, 404]).toContain(foreign.status);

    // Tenant B sees its own numbers only.
    const own = await status(tokenB);
    expect(own.status).toBe(200);
    expect(own.body.workQueues.claimDispatchReviews.count).toBe(1);
    expect(own.body.workQueues.unbilledCharges.count).toBe(0);
  });

  it('requires the audit permission', async () => {
    const res = await status(tokenNoAudit);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  it('does not appear on the public system router', async () => {
    // /api/health stays public; /api/ops/status must not be reachable without a
    // session even though both are "status" endpoints.
    const anonymous = await httpJson(base, 'GET', '/api/ops/status', {});
    expect(anonymous.status).toBe(401);
  });
});

function invoiceNumberForTest(): string {
  return 'OPS-INV-';
}
