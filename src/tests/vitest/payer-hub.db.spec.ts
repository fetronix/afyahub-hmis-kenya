/** Authenticated HTTP + disposable PostgreSQL. Synthetic records only; no payer network. */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeDb } from './support/db.ts';
import { db, pool } from '../../db/index.ts';
import { matchRecordedPayerPayment } from '../../insurance/hub/recorded-payment.ts';
import { recordIntegrationDiagnostic } from '../../insurance/audit/diagnostics.service.ts';
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
  'insurance.payers.read',
  'insurance.payers.manage',
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
    let suToken: string,
      aToken: string,
      bToken: string,
      noPatientToken: string,
      catalogueToken: string,
      delegatedToken: string,
      tenantToken: string;
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
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) ON CONFLICT(tenant_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id',
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
      aToken = await actor('a', facA, 'FACILITY_ADMIN', facilityGrants);
      bToken = await actor('b', facB, 'FACILITY_ADMIN', facilityGrants);
      delegatedToken = await actor('delegated', facA, `PAYER_DELEGATED_${suffix}`, facilityGrants);
      tenantToken = await actor('tenant-wide', null, `PAYER_TENANT_${suffix}`, facilityGrants);
      catalogueToken = await actor('catalogue', facA, `PAYER_CATALOGUE_${suffix}`, [
        'payer_hub.catalogue.read',
      ]);
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
        (await call(delegatedToken, 'GET', `/api/payer-hub/facility/catalogue?facilityId=${facA}`))
          .status,
      ).toBe(200);
      expect(
        (await call(tenantToken, 'GET', `/api/payer-hub/facility/catalogue?facilityId=${facA}`))
          .status,
      ).toBe(403);
      const delegated = await call(
        delegatedToken,
        'PUT',
        `/api/payer-hub/facility/payers/${provider}/activation`,
        { facilityId: facA, isActive: true },
      );
      expect(delegated.status).toBe(403);
      expect(delegated.data.error).toBe('FACILITY_ADMIN_REQUIRED');
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

    it('revokes payer references within the facility, audits attempts, and uses a new replacement namespace', async () => {
      const root = `/api/payer-hub/facility/payers/${provider}/environments/SANDBOX`;
      expect((await call(null, 'POST', `${root}/revoke`, { facilityId: facA })).status).toBe(401);
      expect(
        (await call(delegatedToken, 'POST', `${root}/revoke`, { facilityId: facA })).status,
      ).toBe(403);
      expect((await call(bToken, 'POST', `${root}/revoke`, { facilityId: facB })).status).toBe(404);
      const before = (
        await pool.query(
          `SELECT id,secret_env_prefix,revoked_at FROM insurance_payer_environment_configs
        WHERE provider_id=$1 AND facility_id=$2 AND environment='SANDBOX'`,
          [provider, facA],
        )
      ).rows[0];
      const revoked = await call(aToken, 'POST', `${root}/revoke`, { facilityId: facA });
      expect(revoked.status).toBe(200);
      expect(revoked.data).toMatchObject({ revoked: true, alreadyRevoked: false });
      expect(
        (await call(aToken, 'POST', `${root}/revoke`, { facilityId: facA })).data,
      ).toMatchObject({ alreadyRevoked: true });
      const catalogue = await call(
        aToken,
        'GET',
        `/api/payer-hub/facility/catalogue?facilityId=${facA}`,
      );
      const payer = catalogue.data.providers.find((item: any) => item.id === provider);
      expect(payer.environments.find((item: any) => item.environment === 'SANDBOX')).toMatchObject({
        revoked: true,
        configured: false,
        connectionVerified: false,
      });
      // Manual facility workflows remain active; local revocation does not claim provider-side revocation.
      expect(payer.isActive).toBe(true);
      expect(revoked.data.message).toMatch(/provider and server operator/i);
      const audit = await call(
        aToken,
        'GET',
        `/api/payer-hub/facility/configuration-audit?facilityId=${facA}`,
      );
      expect(
        audit.data.events.some(
          (event: any) => event.action === 'REVOKE' && event.resource === 'payer_hub.environment',
        ),
      ).toBe(true);
      expect(
        audit.data.events.some(
          (event: any) => event.action === 'TEST' && event.resource === 'payer_hub.connection',
        ),
      ).toBe(true);
      const replacement = await call(aToken, 'PUT', root, {
        facilityId: facA,
        providerIdentifier: 'SYNTHETIC',
      });
      expect(replacement.status).toBe(200);
      expect(replacement.data.secretReference).toBe(`${before.secret_env_prefix}_V2`);
      const row = (
        await pool.query(
          'SELECT secret_env_prefix,credential_generation,revoked_at FROM insurance_payer_environment_configs WHERE id=$1',
          [before.id],
        )
      ).rows[0];
      expect(row).toMatchObject({
        credential_generation: 2,
        revoked_at: null,
        secret_env_prefix: `${before.secret_env_prefix}_V2`,
      });
      expect(replacement.data.connectionVerified).toBe(false);
    });

    it('enforces administrator-only legacy configuration and masks untrusted historical metadata', async () => {
      const id = (
        await pool.query(
          `SELECT id FROM insurance_payer_configs WHERE tenant_id=$1 AND facility_id=$2 AND payer_code=$3`,
          [tenant, facA, payerCode],
        )
      ).rows[0].id;
      const path = `/api/insurance/payers/${id}`;
      const sentinel = 'synthetic-payer-nested-secret';
      const legacyClaim = {
        requireDiagnosis: true,
        nested: [{ token: sentinel }],
        apiKey: sentinel,
      };
      const legacyPreauth = { requirePreauthForImaging: false, amountThresholdKes: sentinel };
      await pool.query(
        `UPDATE insurance_payer_configs SET claim_requirements=$2::jsonb,preauth_requirements=$3::jsonb,
        last_connection_summary=$4,missing_requirements=$5::jsonb,notes=$4 WHERE id=$1`,
        [
          id,
          JSON.stringify(legacyClaim),
          JSON.stringify(legacyPreauth),
          sentinel,
          JSON.stringify([sentinel]),
        ],
      );
      const read = await call(aToken, 'GET', path);
      expect(read.status).toBe(200);
      expect(read.data.claimRequirements).toEqual({ requireDiagnosis: true });
      expect(read.data.preauthRequirements).toEqual({ requirePreauthForImaging: false });
      expect(JSON.stringify(read.data)).not.toContain(sentinel);
      expect(
        (
          await call(delegatedToken, 'PATCH', path, {
            claimRequirements: { requireDiagnosis: true },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(tenantToken, 'PATCH', path, {
            facilityId: facA,
            claimRequirements: { requireDiagnosis: true },
          })
        ).status,
      ).toBe(403);
      for (const invalid of [
        { claimRequirements: { requireDiagnosis: true, password: sentinel } },
        { claimRequirements: [{ token: sentinel }] },
        { claimRequirements: { allowedCodingSystems: [{ token: sentinel }] } },
        { preauthRequirements: { amountThresholdKes: sentinel } },
        { notes: sentinel },
      ]) {
        const rejected = await call(aToken, 'PATCH', path, invalid);
        expect(rejected.status).toBe(400);
        expect(JSON.stringify(rejected.data)).not.toContain(sentinel);
      }
      const after = (
        await pool.query(
          'SELECT claim_requirements,preauth_requirements,notes FROM insurance_payer_configs WHERE id=$1',
          [id],
        )
      ).rows[0];
      expect(after).toMatchObject({
        claim_requirements: legacyClaim,
        preauth_requirements: legacyPreauth,
        notes: sentinel,
      });
      const updated = await call(aToken, 'PATCH', path, {
        claimRequirements: { maxSubmissionDays: 30 },
        preauthRequirements: { requirePreauthForImaging: true },
      });
      expect(updated.status).toBe(200);
      expect(updated.data.claimRequirements).toMatchObject({
        requireDiagnosis: true,
        maxSubmissionDays: 30,
      });
      expect(JSON.stringify(updated.data)).not.toContain(sentinel);
      const diagnosticsBefore = (
        await pool.query(
          'SELECT count(*)::int AS count FROM insurance_integration_diagnostics WHERE tenant_id=$1 AND facility_id=$2',
          [tenant, facA],
        )
      ).rows[0].count;
      const snapshot = await call(aToken, 'GET', `${path}/connection-status`);
      expect(snapshot.status).toBe(200);
      expect(snapshot.data.verified).toBe(false);
      expect(snapshot.data.httpStatus).toBeNull();
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS count FROM insurance_integration_diagnostics WHERE tenant_id=$1 AND facility_id=$2',
            [tenant, facA],
          )
        ).rows[0].count,
      ).toBe(diagnosticsBefore);
    });

    it('scopes insurance diagnostic and audit histories to one facility and withholds historical provider text', async () => {
      const sentinel = 'synthetic-diagnostic-secret';
      const diagnostic = await pool.query(
        `INSERT INTO insurance_integration_diagnostics(tenant_id,facility_id,payer_code,adapter_key,environment,operation,outcome,correlation_id,summary)
        VALUES($1,$2,$4,'manual','SANDBOX','CONNECTION_STATUS_PROBE','SUCCESS','synthetic',$5),
              ($1,$3,$4,'manual','SANDBOX','CONNECTION_STATUS_PROBE','SUCCESS','synthetic-other',$5) RETURNING id`,
        [tenant, facA, facB, payerCode, sentinel],
      );
      const audits = await pool.query(
        `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details)
        VALUES($1,$2,'synthetic','PRIVATE_INSURANCE_SYNTHETIC','insurance_payer_config','1',$4),
              ($1,$3,'synthetic','PRIVATE_INSURANCE_SYNTHETIC','insurance_payer_config','1',$4) RETURNING id`,
        [tenant, facA, facB, sentinel],
      );
      await recordIntegrationDiagnostic({
        tenantId: tenant,
        facilityId: facA,
        payerCode,
        adapterKey: 'manual',
        environment: 'SANDBOX',
        operation: 'CONNECTION_STATUS_PROBE',
        outcome: sentinel,
        summary: sentinel,
        errorCode: sentinel,
        correlationId: sentinel,
      });
      const written = (
        await pool.query(
          `SELECT summary,error_code,outcome,correlation_id FROM insurance_integration_diagnostics
        WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id DESC LIMIT 1`,
          [tenant, facA],
        )
      ).rows[0];
      expect(JSON.stringify(written)).not.toContain(sentinel);
      expect(written).toMatchObject({ outcome: 'OTHER', error_code: null });
      const response = await call(aToken, 'GET', `/api/insurance/diagnostics?facilityId=${facA}`);
      expect(response.status).toBe(200);
      expect(
        response.data.diagnostics.some((event: any) => event.id === diagnostic.rows[0].id),
      ).toBe(true);
      expect(
        response.data.diagnostics.some((event: any) => event.id === diagnostic.rows[1].id),
      ).toBe(false);
      expect(response.data.auditEvents.some((event: any) => event.id === audits.rows[0].id)).toBe(
        true,
      );
      expect(response.data.auditEvents.some((event: any) => event.id === audits.rows[1].id)).toBe(
        false,
      );
      expect(
        response.data.auditEvents.every(
          (event: any) => event.facilityId === facA && !('details' in event),
        ),
      ).toBe(true);
      expect(JSON.stringify(response.data)).not.toContain(sentinel);
      expect(
        (await call(bToken, 'GET', `/api/insurance/diagnostics?facilityId=${facA}`)).status,
      ).toBe(403);
    });

    it('shows Jubilee as unassigned manual metadata and restricts the configuration audit', async () => {
      const catalogue = await call(
        aToken,
        'GET',
        `/api/payer-hub/facility/catalogue?facilityId=${facA}`,
      );
      expect(catalogue.status).toBe(200);
      const jubilee = catalogue.data.providers.find((payer: any) => payer.code === 'JUBILEE');
      expect(jubilee).toMatchObject({
        isAssigned: false,
        isActive: false,
        adapterKey: 'manual',
        connectionStatus: 'NOT_VERIFIED',
      });
      expect(jubilee.processing).toContain('Manual internal processing');
      expect(jubilee.workflows).toEqual([]);
      const path = `/api/payer-hub/facility/configuration-audit?facilityId=${facA}`;
      expect((await call(null, 'GET', path)).status).toBe(401);
      expect((await call(catalogueToken, 'GET', path)).status).toBe(403);
      expect((await call(suToken, 'GET', path)).status).toBe(403);
      expect((await call(bToken, 'GET', path)).status).toBe(403);
      const audit = await call(aToken, 'GET', path);
      expect(audit.status).toBe(200);
      expect(audit.data.events.length).toBeGreaterThan(0);
      expect(
        audit.data.events.every(
          (event: any) => event.resource.startsWith('payer_hub.') && !('details' in event),
        ),
      ).toBe(true);
      expect(JSON.stringify(audit.data)).not.toContain('Synthetic manual insurer');
      const other = await call(
        bToken,
        'GET',
        `/api/payer-hub/facility/configuration-audit?facilityId=${facB}`,
      );
      expect(other.status).toBe(200);
      expect(
        other.data.events.every(
          (event: any) => !audit.data.events.some((a: any) => a.id === event.id),
        ),
      ).toBe(true);
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
