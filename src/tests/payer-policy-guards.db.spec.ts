import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { beforeAll, expect, it, vi } from 'vitest';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import {
  dhaLegacyGuard,
  legacyClaimsGuard,
  privatePolicyGuard,
  shaPolicyGuard,
} from '../insurance/hub/guards.ts';
import { assignPayer, registerPayer, updatePayer } from '../insurance/hub/service.ts';
import { createPrivatePayer } from '../insurance/payers/payer-config.service.ts';
import { describeDb, testPool } from './vitest/support/db.ts';

type Guard = (req: AuthRequest, res: Response, next: NextFunction) => Promise<unknown>;

/** Direct middleware tests use real policy queries, synthetic rows and no provider calls. */
describeDb('payer policy guard classification and isolation', () => {
  const pool = testPool();
  const suffix = randomUUID().slice(0, 8);
  const payerCode = `TEST${suffix.toUpperCase()}`;
  let context: AuthorizationContext;
  let otherFacilityId: number;
  let patientId: number;
  let otherPatientId: number;
  let invoiceId: number;
  let payerId: number;
  let memberId: number;
  let benefitId: number;
  let mappingId: number;
  let preauthId: number;
  let privateClaimId: number;
  let legacyClaimId: number;
  let unmappedClaimId: number;

  async function guard(
    middleware: Guard,
    method: string,
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, unknown>;
      auth?: AuthorizationContext | null;
    } = {},
  ) {
    const req = {
      method,
      path,
      body: options.body ?? {},
      query: options.query ?? {},
      authContext: options.auth === undefined ? context : options.auth,
    } as unknown as AuthRequest;
    const result: { status: number; payload: Record<string, unknown> | null } = {
      status: 200,
      payload: null,
    };
    const response = {
      status(code: number) {
        result.status = code;
        return this;
      },
      json(payload: Record<string, unknown>) {
        result.payload = payload;
        return this;
      },
    } as unknown as Response;
    const next = vi.fn();
    await middleware(req, response, next);
    return { ...result, next, req };
  }

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    const tenantId = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic guard tenant',
        `guard-${suffix}`,
      ])
    ).rows[0].id;
    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,enabled_modules)
       VALUES($1,$2,'Synthetic A','["insurance"]'::jsonb),($1,$3,'Synthetic B','[]'::jsonb) RETURNING id`,
      [tenantId, `GUARD-A-${suffix}`, `GUARD-B-${suffix}`],
    );
    const facilityId = facilities.rows[0].id as number;
    otherFacilityId = facilities.rows[1].id;
    const uid = `guard-user-${suffix}`;
    const userId = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic test user','not-for-login',$3,$4) RETURNING id`,
        [uid, `${uid}@example.test`, tenantId, facilityId],
      )
    ).rows[0].id;
    context = {
      userId,
      tenantId,
      facilityId,
      roles: [],
      permissions: ['patients.read'],
      isSuperAdmin: false,
    };
    const patients = await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
       VALUES($1,$2,$4,'Synthetic','A','2000-01-01','Unknown'),($1,$3,$5,'Synthetic','B','2000-01-01','Unknown') RETURNING id`,
      [tenantId, facilityId, otherFacilityId, `GUARD-A-${suffix}`, `GUARD-B-${suffix}`],
    );
    [patientId, otherPatientId] = patients.rows.map((row) => row.id);
    invoiceId = (
      await pool.query(
        `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status)
       VALUES($1,$2,$3,$4,'100.00','0.00','100.00','Unpaid') RETURNING id`,
        [tenantId, facilityId, patientId, `GUARD-INV-${suffix}`],
      )
    ).rows[0].id;
    const provider = await registerPayer(userId, {
      code: payerCode,
      displayName: 'Synthetic manual payer',
      informationUrl: 'https://example.test/payer',
    });
    await updatePayer(userId, provider.id, { status: 'ACTIVE' });
    await assignPayer(userId, provider.id, facilityId, true);
    payerId = (
      await createPrivatePayer({
        tenantId,
        facilityId,
        actorUserId: userId,
        actorUserUid: uid,
        input: { payerCode, payerName: 'Synthetic manual payer', isActive: true },
      })
    ).id;
    const shaProvider = await pool.query(
      "SELECT id FROM insurance_payer_definitions WHERE code='SHA'",
    );
    await assignPayer(userId, shaProvider.rows[0].id, facilityId, true);
    await pool.query(
      `INSERT INTO insurance_payer_configs(tenant_id,facility_id,payer_code,payer_name,payer_type,adapter_key,is_active)
       VALUES($1,$2,'SHA','SHA','PUBLIC_SCHEME','sha_afyalink',true)`,
      [tenantId, facilityId],
    );
    memberId = (
      await pool.query(
        `INSERT INTO insurance_member_policies(tenant_id,facility_id,patient_id,payer_code,member_number)
       VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [tenantId, facilityId, patientId, payerCode, `TEST-MEMBER-${suffix}`],
      )
    ).rows[0].id;
    benefitId = (
      await pool.query(
        `INSERT INTO payer_benefit_rules(tenant_id,facility_id,payer_code,rule_code,benefit_package,service_category,source_reference,effective_from)
       VALUES($1,$2,$3,$4,'TEST','TEST','synthetic only','2026-01-01') RETURNING id`,
        [tenantId, facilityId, payerCode, `TEST-RULE-${suffix}`],
      )
    ).rows[0].id;
    mappingId = (
      await pool.query(
        `INSERT INTO payer_service_code_mappings(tenant_id,facility_id,payer_code,local_code,local_description,service_area,payer_service_code,payer_service_name)
       VALUES($1,$2,$3,$4,'synthetic','test','TEST-ONLY','synthetic') RETURNING id`,
        [tenantId, facilityId, payerCode, `TEST-LOCAL-${suffix}`],
      )
    ).rows[0].id;
    preauthId = (
      await pool.query(
        `INSERT INTO insurance_preauthorizations(tenant_id,facility_id,patient_id,payer_code,preauth_number,external_bundle_id,clinical_indication,primary_diagnosis_code,primary_diagnosis_display,requested_service_code,requested_service_name,estimated_amount)
       VALUES($1,$2,$3,$4,$5,$6,'synthetic','TEST','synthetic','TEST','synthetic','0') RETURNING id`,
        [tenantId, facilityId, patientId, payerCode, `TEST-PA-${suffix}`, randomUUID()],
      )
    ).rows[0].id;
    privateClaimId = (
      await pool.query(
        `INSERT INTO private_insurance_claims(tenant_id,facility_id,patient_id,member_policy_id,invoice_id,payer_code,claim_number,idempotency_key,service_date_start,service_date_end,gross_invoice_amount,proposed_claim_amount)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'2026-01-01','2026-01-01','100.00','100.00') RETURNING id`,
        [
          tenantId,
          facilityId,
          patientId,
          memberId,
          invoiceId,
          payerCode,
          `TEST-PRIVATE-${suffix}`,
          randomUUID(),
        ],
      )
    ).rows[0].id;
    const claims = await pool.query(
      `INSERT INTO insurance_claims(tenant_id,facility_id,patient_id,invoice_id,claim_number,payer_code,payer_name,claim_amount)
       VALUES($1,$2,$3,$4,$5,$7,'Synthetic manual payer','100.00'),($1,$2,$3,$4,$6,NULL,'Unknown synthetic legacy payer','100.00') RETURNING id`,
      [
        tenantId,
        facilityId,
        patientId,
        invoiceId,
        `TEST-LEGACY-${suffix}`,
        `TEST-UNKNOWN-${suffix}`,
        payerCode,
      ],
    );
    [legacyClaimId, unmappedClaimId] = claims.rows.map((row) => row.id);
  });

  it('requires a facility-scoped account, matching facility identifiers and an enabled insurance module', async () => {
    for (const options of [
      { auth: null },
      { auth: { ...context, isSuperAdmin: true } },
      { body: { facilityId: context.facilityId }, query: { facilityId: otherFacilityId } },
      { body: { facilityId: 0 } },
      { body: { facilityId: otherFacilityId } },
    ]) {
      const result = await guard(privatePolicyGuard, 'GET', '/payers', options);
      expect(result.status).toBe(403);
      expect(result.next).not.toHaveBeenCalled();
    }
    const disabled = await guard(privatePolicyGuard, 'GET', '/payers', {
      auth: { ...context, facilityId: otherFacilityId },
    });
    expect(disabled.payload).toMatchObject({ error: 'FACILITY_MODULE_DISABLED' });
  });

  it('enforces patient-record permission and facility association for SHA and private routes', async () => {
    const noPermission = { ...context, permissions: [] };
    for (const middleware of [shaPolicyGuard, privatePolicyGuard]) {
      const denied = await guard(middleware, 'GET', '/patients/1/history', { auth: noPermission });
      expect(denied.payload).toMatchObject({ error: 'PATIENT_PERMISSION_REQUIRED' });
      const foreign = await guard(middleware, 'GET', `/patients/${otherPatientId}/history`);
      expect(foreign.payload).toMatchObject({ error: 'PATIENT_NOT_FOUND' });
      const own = await guard(middleware, 'GET', `/patients/${patientId}/history`);
      expect(own.next).toHaveBeenCalledOnce();
    }
    const mismatch = await guard(shaPolicyGuard, 'POST', '/eligibility/check', {
      body: { payerCode },
    });
    expect(mismatch.payload).toMatchObject({ error: 'PAYER_MISMATCH' });
  });

  it('blocks external SHA operations even for an assigned, active facility', async () => {
    const paths = [
      '/registry/patient-search',
      '/eligibility/check',
      '/benefits/hie-lookup',
      '/authorizations/consent',
      '/preauthorizations/1/submit',
      '/claims/1/submit',
      '/remittances/sync',
      '/callbacks/register',
    ];
    for (const path of paths) {
      const blocked = await guard(shaPolicyGuard, 'POST', path);
      expect(blocked.payload).toMatchObject({ error: 'SHA_TRANSPORT_BLOCKED' });
      expect(blocked.next).not.toHaveBeenCalled();
    }
    expect((await guard(shaPolicyGuard, 'GET', '/configuration')).next).toHaveBeenCalledOnce();
    expect((await guard(shaPolicyGuard, 'POST', '/service-mappings')).next).toHaveBeenCalledOnce();
  });

  it('classifies manual private workflows from registered payer records, not client claims', async () => {
    const allowed: Array<[string, string, Record<string, unknown>]> = [
      ['GET', `/payers/${payerId}`, {}],
      ['POST', '/members', { payerCode }],
      ['PATCH', `/members/${memberId}`, {}],
      ['POST', '/eligibility/check', { memberPolicyId: memberId, verificationMode: 'MANUAL' }],
      ['POST', '/benefits/validate', { payerCode }],
      ['PATCH', `/benefits/${benefitId}`, {}],
      ['PATCH', `/mappings/${mappingId}`, {}],
      ['POST', '/preauthorizations', { memberPolicyId: memberId }],
      ['PATCH', `/preauthorizations/${preauthId}`, {}],
      ['POST', '/claims/prepare', { memberPolicyId: memberId }],
      ['POST', `/claims/${privateClaimId}/validate`, {}],
      ['POST', `/claims/${privateClaimId}/submit`, { submissionMode: 'MANUAL' }],
      ['POST', '/remittances/import', { payerCode }],
    ];
    for (const [method, path, body] of allowed) {
      const result = await guard(privatePolicyGuard, method, path, { body });
      expect(result.payload, `${method} ${path}`).toBeNull();
      expect(result.next, `${method} ${path}`).toHaveBeenCalledOnce();
    }
    const mismatch = await guard(privatePolicyGuard, 'PATCH', `/members/${memberId}`, {
      body: { payerCode: 'OTHER' },
    });
    expect(mismatch.payload).toMatchObject({ error: 'PAYER_MISMATCH' });
    expect((await guard(privatePolicyGuard, 'POST', '/members')).payload).toMatchObject({
      error: 'PAYER_REQUIRED',
    });
    expect(
      (await guard(privatePolicyGuard, 'POST', '/members', { body: { payerCode: 'SHA' } })).payload,
    ).toMatchObject({ error: 'PAYER_MISMATCH' });
    expect((await guard(privatePolicyGuard, 'POST', '/unclassified')).payload).toMatchObject({
      error: 'PAYER_OPERATION_UNCLASSIFIED',
    });
    expect(
      (await guard(privatePolicyGuard, 'POST', '/claims/prepare', { body: { memberPolicyId: -1 } }))
        .payload,
    ).toMatchObject({ error: 'INVALID_ID' });
    expect((await guard(privatePolicyGuard, 'PATCH', '/members/2147483647')).payload).toMatchObject(
      { error: 'RECORD_NOT_FOUND' },
    );
  });

  it('blocks private external eligibility, submission and status even when manual workflows are enabled', async () => {
    const operations: Array<[string, string, Record<string, unknown>]> = [
      ['POST', '/eligibility/check', { memberPolicyId: memberId }],
      ['POST', `/preauthorizations/${preauthId}/submit`, { submissionMode: 'ADAPTER' }],
      ['POST', `/claims/${privateClaimId}/submit`, { submissionMode: 'API' }],
      ['GET', `/claims/${privateClaimId}/status`, {}],
      ['GET', `/payers/${payerId}/connection-status`, {}],
    ];
    for (const [method, path, body] of operations) {
      const result = await guard(privatePolicyGuard, method, path, { body });
      expect(result.payload, `${method} ${path}`).toMatchObject({
        error: 'PAYER_TRANSPORT_BLOCKED',
      });
      expect(result.next).not.toHaveBeenCalled();
    }
  });

  it('guards legacy claim creation and submission without modifying the invoice or sending a claim', async () => {
    const created = await guard(legacyClaimsGuard, 'POST', '/api/claims', {
      body: { invoiceId, payerCode, payerName: 'untrusted input' },
    });
    expect(created.next).toHaveBeenCalledOnce();
    expect(created.req.body).toMatchObject({ payerCode, payerName: 'Synthetic manual payer' });
    expect(
      (
        await guard(legacyClaimsGuard, 'POST', '/api/claims', {
          body: { invoiceId: -1, payerCode },
        })
      ).payload,
    ).toMatchObject({ error: 'INVOICE_NOT_FOUND' });
    expect((await guard(legacyClaimsGuard, 'POST', '/api/claims/invalid')).payload).toMatchObject({
      error: 'PAYER_OPERATION_UNCLASSIFIED',
    });
    expect(
      (await guard(legacyClaimsGuard, 'POST', '/api/claims/2147483647/submit')).payload,
    ).toMatchObject({ error: 'CLAIM_NOT_FOUND' });
    expect(
      (await guard(legacyClaimsGuard, 'POST', `/api/claims/${unmappedClaimId}/submit`)).payload,
    ).toMatchObject({ error: 'LEGACY_PAYER_UNMAPPED' });
    expect(
      (await guard(legacyClaimsGuard, 'POST', `/api/claims/${legacyClaimId}/submit`)).payload,
    ).toMatchObject({ error: 'MANUAL_REFERENCE_REQUIRED' });
    expect(
      (
        await guard(legacyClaimsGuard, 'POST', `/api/claims/${legacyClaimId}/submit`, {
          body: { manualReference: 'synthetic-test-reference' },
        })
      ).next,
    ).toHaveBeenCalledOnce();
    const invoice = await pool.query(
      'SELECT status,paid_amount FROM billing_invoices WHERE id=$1',
      [invoiceId],
    );
    expect(invoice.rows[0]).toMatchObject({ status: 'Unpaid', paid_amount: '0.00' });
  });

  it('applies the same patient and external access rules to legacy DHA routes', async () => {
    expect(
      (await guard(dhaLegacyGuard, 'GET', '/readiness', { auth: null })).next,
    ).toHaveBeenCalledOnce();
    expect(
      (await guard(dhaLegacyGuard, 'GET', `/patients/${otherPatientId}/eligibility`)).payload,
    ).toMatchObject({ error: 'PATIENT_NOT_FOUND' });
    expect(
      (await guard(dhaLegacyGuard, 'GET', `/patients/${patientId}/eligibility`)).payload,
    ).toMatchObject({ error: 'SHA_TRANSPORT_BLOCKED' });
    expect((await guard(dhaLegacyGuard, 'POST', '/mappings')).next).toHaveBeenCalledOnce();
  });
});
