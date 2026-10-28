/** Authenticated HTTP + disposable PostgreSQL. Synthetic records only; no payer network. */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeDb } from './support/db.ts';
import { db, pool } from '../../db/index.ts';
import { matchRecordedPayerPayment } from '../../insurance/hub/recorded-payment.ts';
import { createSession } from '../../auth/session.service.ts';

const platformGrants = [
  'payer_hub.global.read',
  'payer_hub.global.manage',
  'payer_hub.assign',
  'payer_hub.production.approve',
];
const facilityGrants = [
  'payer_hub.catalogue.read',
  'payer_hub.facility.manage',
  'payer_hub.credentials.manage',
  'payer_hub.production.request',
  'patients.read',
  'billing.payments.record',
  'insurance.read',
  'insurance.claims.create',
  'insurance.claims.manage',
  'insurance.members.manage',
  'insurance.eligibility.check',
  'insurance.sha.read',
  'insurance.sha.eligibility.check',
  'insurance.sha.reconciliation.manage',
];

describeDb(
  'payer hub authenticated HTTP and database policy (synthetic, no provider calls)',
  () => {
    let server: Server,
      base: string,
      tenant: number,
      facA: number,
      facB: number,
      patientA: number,
      patientB: number,
      invoice: number;
    let suToken: string, aToken: string, bToken: string, noPatientToken: string;
    let provider: number, claim: number, assignment: number;
    const suffix = randomUUID().slice(0, 8);
    const payerCode = `TEST${suffix.toUpperCase()}`;
    const call = async (token: string | null, method: string, path: string, body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: (await response.json()) as Record<string, any> };
    };
    beforeAll(async () => {
      if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
        throw new Error('Disposable test database required');
      tenant = (
        await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
          `Synthetic payer ${suffix}`,
          `payer-${suffix}`,
        ])
      ).rows[0].id;
      const facilities = await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic A',$4::jsonb),($1,$3,'Synthetic B',$4::jsonb) RETURNING id`,
        [
          tenant,
          `pa-${suffix}`,
          `pb-${suffix}`,
          JSON.stringify(['insurance', 'finance', 'registration', 'interoperability']),
        ],
      );
      facA = facilities.rows[0].id;
      facB = facilities.rows[1].id;
      for (const code of [...platformGrants, ...facilityGrants])
        await pool.query(
          `INSERT INTO permissions(code,name,module) VALUES($1,$1,'insurance') ON CONFLICT(code) DO NOTHING`,
          [code],
        );
      const actor = async (
        tag: string,
        facility: number | null,
        role: string,
        grants: string[],
        global = false,
      ) => {
        const u = await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,$1,'synthetic','ACTIVE',$3,$4) RETURNING id`,
          [
            `payer-${tag}-${suffix}`,
            `payer-${tag}-${suffix}@example.test`,
            global ? null : tenant,
            facility,
          ],
        );
        const r = await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [global ? null : tenant, role],
        );
        await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
          u.rows[0].id,
          r.rows[0].id,
        ]);
        for (const grant of grants)
          await pool.query(
            'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING',
            [r.rows[0].id, grant],
          );
        return (await createSession({ userId: u.rows[0].id, securityVersion: 1 })).sessionToken;
      };
      suToken = await actor('platform', null, 'SUPER_ADMIN', platformGrants, true);
      aToken = await actor('a', facA, `PAYER_A_${suffix}`, facilityGrants);
      bToken = await actor('b', facB, `PAYER_B_${suffix}`, facilityGrants);
      noPatientToken = await actor(
        'no-patient',
        facA,
        `PAYER_NOPAT_${suffix}`,
        facilityGrants.filter((p) => p !== 'patients.read'),
      );
      const patients = await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$4,'Synthetic','A','2000-01-01','Unknown'),($1,$3,$5,'Synthetic','B','2000-01-01','Unknown') RETURNING id`,
        [tenant, facA, facB, `p-a-${suffix}`, `p-b-${suffix}`],
      );
      patientA = patients.rows[0].id;
      patientB = patients.rows[1].id;
      invoice = (
        await pool.query(
          `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status) VALUES($1,$2,$3,$4,'100.00','0.00','100.00','Unpaid') RETURNING id`,
          [tenant, facA, patientA, `PAYER-INV-${suffix}`],
        )
      ).rows[0].id;
      await pool.query(
        `INSERT INTO billing_items(invoice_id,item_type,description,quantity,unit_price,total_amount) VALUES($1,'Consultation','Synthetic service',1,'100.00','100.00')`,
        [invoice],
      );
      const { createApp } = await import('../../app.ts');
      server = (await createApp()).listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('separates platform registration, assignments, activation and actual claims', async () => {
      expect((await call(null, 'GET', '/api/payer-hub/platform')).status).toBe(401);
      expect(
        (await call(aToken, 'POST', '/api/payer-hub/platform/payers', { code: payerCode })).status,
      ).toBe(403);
      expect(
        (await call(suToken, 'GET', `/api/payer-hub/facility/catalogue?facilityId=${facA}`)).status,
      ).toBe(403);
      const registered = await call(suToken, 'POST', '/api/payer-hub/platform/payers', {
        code: payerCode,
        displayName: 'Synthetic manual insurer',
        informationUrl: 'https://example.test/insurer',
      });
      expect(registered.status).toBe(201);
      provider = registered.data.payer.id;
      expect(
        (
          await call(aToken, 'PUT', `/api/payer-hub/facility/payers/${provider}/activation`, {
            isActive: true,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(
            suToken,
            'PUT',
            `/api/payer-hub/platform/payers/${provider}/facilities/${facA}`,
            { isAllowed: true },
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await call(suToken, 'PATCH', `/api/payer-hub/platform/payers/${provider}`, {
            status: 'ACTIVE',
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(
            aToken,
            'POST',
            `/api/payer-hub/facility/payers/${provider}/access-request`,
            {},
          )
        ).status,
      ).toBe(201);
      const assigned = await call(
        suToken,
        'PUT',
        `/api/payer-hub/platform/payers/${provider}/facilities/${facA}`,
        { isAllowed: true },
      );
      expect(assigned.status).toBe(200);
      assignment = assigned.data.assignment.id;
      expect(
        (
          await call(bToken, 'PUT', `/api/payer-hub/facility/payers/${provider}/activation`, {
            isActive: true,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(aToken, 'PUT', `/api/payer-hub/facility/payers/${provider}/activation`, {
            isActive: true,
          })
        ).status,
      ).toBe(200);
      expect(
        (await call(bToken, 'GET', `/api/payer-hub/facility/catalogue?facilityId=${facA}`)).status,
      ).toBe(403);
      const catalog = await call(aToken, 'GET', '/api/payer-hub/facility/catalogue');
      const payer = catalog.data.providers.find((p: any) => p.id === provider);
      expect(payer.usableForNewClaims).toBe(true);
      expect(payer.connectionStatus).toBe('NOT_VERIFIED');
      expect(
        (
          await call(
            aToken,
            'POST',
            `/api/payer-hub/facility/payers/${provider}/connection-test`,
            {},
          )
        ).data,
      ).toMatchObject({ tested: false, verified: false });
      expect(
        (
          await call(
            aToken,
            'PUT',
            `/api/payer-hub/facility/payers/${provider}/environments/SANDBOX`,
            { clientSecret: 'synthetic-secret-must-not-be-stored' },
          )
        ).status,
      ).toBe(400);
      const environment = await call(
        aToken,
        'PUT',
        `/api/payer-hub/facility/payers/${provider}/environments/SANDBOX`,
        { providerIdentifier: 'SYNTHETIC' },
      );
      expect(environment.status).toBe(200);
      expect(JSON.stringify(environment.data)).not.toContain('synthetic-secret-must-not-be-stored');
      expect(
        (
          await call(
            aToken,
            'POST',
            `/api/payer-hub/facility/payers/${provider}/production-request`,
            {},
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await call(
            suToken,
            'POST',
            `/api/payer-hub/platform/assignments/${assignment}/production-decision`,
            { decision: 'APPROVED', reference: 'synthetic-reference' },
          )
        ).status,
      ).toBe(409);
      expect(
        (await call(noPatientToken, 'POST', '/api/claims', { invoiceId: invoice, payerCode }))
          .status,
      ).toBe(403);
      expect(
        (await call(bToken, 'POST', '/api/claims', { invoiceId: invoice, payerCode })).status,
      ).toBe(404);
      expect(
        (
          await call(aToken, 'POST', '/api/insurance/members', {
            patientId: patientB,
            payerCode,
            memberNumber: 'SYNTHETIC-MEMBER',
          })
        ).status,
      ).toBe(404);
      const member = await call(aToken, 'POST', '/api/insurance/members', {
        patientId: patientA,
        payerCode,
        memberNumber: `SYNTH-${suffix}`,
      });
      expect(member.status).toBe(201);
      const unavailable = await call(aToken, 'POST', '/api/insurance/eligibility/check', {
        patientId: patientA,
        payerCode,
        memberPolicyId: member.data.id,
        verificationMode: 'ADAPTER',
      });
      expect(unavailable.status).toBe(403);
      expect(unavailable.data.error).toBe('PAYER_TRANSPORT_BLOCKED');
      expect(
        (
          await call(aToken, 'POST', '/api/insurance/eligibility/check', {
            patientId: patientA,
            payerCode,
            memberPolicyId: member.data.id,
            memberNumber: 'OTHER-PATIENT',
            verificationMode: 'MANUAL',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call(
            suToken,
            'PUT',
            `/api/payer-hub/platform/payers/${provider}/workflows/CLAIM_PREPARE`,
            { isAllowed: false },
          )
        ).status,
      ).toBe(200);
      expect(
        (await call(aToken, 'POST', '/api/claims', { invoiceId: invoice, payerCode })).status,
      ).toBe(403);
      expect(
        (
          await call(
            suToken,
            'PUT',
            `/api/payer-hub/platform/payers/${provider}/workflows/CLAIM_PREPARE`,
            { isAllowed: true },
          )
        ).status,
      ).toBe(200);
      const draft = await call(aToken, 'POST', '/api/claims', {
        invoiceId: invoice,
        payerCode,
        payerName: 'not-authoritative',
      });
      expect(draft.status).toBe(201);
      claim = draft.data.claim.id;
      expect(draft.data.claim.payerName).toBe('Synthetic manual insurer');
      expect((await call(aToken, 'POST', `/api/claims/${claim}/submit`, {})).status).toBe(400);
      expect(
        (
          await call(aToken, 'POST', `/api/claims/${claim}/submit`, {
            manualReference: 'TEST-DISPATCH-1',
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(aToken, 'POST', `/api/claims/${claim}/adjudicate`, {
            approvedAmount: '100.00',
          })
        ).status,
      ).toBe(200);
      expect((await call(aToken, 'POST', `/api/claims/${claim}/settle`, {})).status).toBe(400);
      const inv = await pool.query(
        'SELECT paid_amount,balance_amount FROM billing_invoices WHERE id=$1',
        [invoice],
      );
      expect(inv.rows[0]).toMatchObject({ paid_amount: '0.00', balance_amount: '100.00' });
      expect(
        (
          await call(suToken, 'PATCH', `/api/payer-hub/platform/payers/${provider}`, {
            status: 'DISABLED',
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(aToken, 'POST', `/api/claims/${claim}/settle`, {
            billingPaymentId: 123,
            remittanceReference: 'TEST-REF',
          })
        ).status,
      ).toBe(403);
      const history = await call(aToken, 'GET', '/api/claims');
      expect(history.status).toBe(200);
      expect(history.data.some((c: any) => c.id === claim)).toBe(true);
      const after = await call(aToken, 'GET', '/api/payer-hub/facility/catalogue');
      expect(after.data.providers.find((p: any) => p.id === provider).usableForNewClaims).toBe(
        false,
      );
      // A separately recorded billing receipt can be matched, but only with the
      // same invoice, insurer, amount and real reference. No extra receipt is made.
      expect(
        (
          await call(suToken, 'PATCH', `/api/payer-hub/platform/payers/${provider}`, {
            status: 'ACTIVE',
          })
        ).status,
      ).toBe(200);
      const receipt = await call(aToken, 'POST', '/api/billing/payments', {
        invoiceId: invoice,
        amount: '100.00',
        paymentMethod: `Insurance - ${payerCode}`,
        referenceCode: `SYNTHETIC-EFT-${suffix}`,
      });
      expect(receipt.status).toBe(201);
      const paymentId = receipt.data.payment.id;
      expect(
        (
          await call(aToken, 'POST', `/api/claims/${claim}/settle`, {
            billingPaymentId: paymentId,
            remittanceReference: 'WRONG-REFERENCE',
          })
        ).status,
      ).toBe(409);
      const settled = await call(aToken, 'POST', `/api/claims/${claim}/settle`, {
        billingPaymentId: paymentId,
        remittanceReference: `SYNTHETIC-EFT-${suffix}`,
      });
      expect(settled.status).toBe(200);
      expect(settled.data.claim.status).toBe('Settled');
      expect(
        (
          await call(aToken, 'POST', `/api/claims/${claim}/settle`, {
            billingPaymentId: paymentId,
            remittanceReference: `SYNTHETIC-EFT-${suffix}`,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS count FROM billing_payments WHERE invoice_id=$1',
            [invoice],
          )
        ).rows[0].count,
      ).toBe(1);
      await expect(
        db.transaction((tx) =>
          matchRecordedPayerPayment(tx, {
            paymentId,
            invoiceId: invoice,
            payerCode,
            remittanceReference: `SYNTHETIC-EFT-${suffix}`,
            bankReference: null,
            amountCents: 10000,
          }),
        ),
      ).rejects.toThrow(/already allocated/i);
      expect(
        (
          await pool.query('SELECT paid_amount,balance_amount FROM billing_invoices WHERE id=$1', [
            invoice,
          ])
        ).rows[0],
      ).toMatchObject({ paid_amount: '100.00', balance_amount: '0.00' });
    });

    it('enforces patient association and blocks legacy DHA/SHA transport and callbacks', async () => {
      const sha = (await pool.query(`SELECT id FROM insurance_payer_definitions WHERE code='SHA'`))
        .rows[0].id;
      expect(
        (
          await call(suToken, 'PUT', `/api/payer-hub/platform/payers/${sha}/facilities/${facA}`, {
            isAllowed: true,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(aToken, 'PUT', `/api/payer-hub/facility/payers/${sha}/activation`, {
            isActive: true,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(aToken, 'POST', '/api/insurance/sha/eligibility/check', {
            patientId: patientB,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await call(aToken, 'POST', '/api/insurance/sha/eligibility/check', {
            patientId: patientA,
          })
        ).data.error,
      ).toBe('SHA_TRANSPORT_BLOCKED');
      expect(
        (await call(aToken, 'GET', '/api/insurance/sha/remittances/123/claims')).data.error,
      ).toBe('SHA_TRANSPORT_BLOCKED');
      expect(
        (await call(aToken, 'POST', `/api/integrations/dha/patients/${patientA}/eligibility`, {}))
          .data.error,
      ).toBe('SHA_TRANSPORT_BLOCKED');
      expect(
        (
          await call(
            noPatientToken,
            'POST',
            `/api/integrations/dha/patients/${patientA}/eligibility`,
            {},
          )
        ).status,
      ).toBe(403);
      expect((await call(null, 'POST', '/api/webhooks/sha/status', {})).status).toBe(503);
    });
  },
);
