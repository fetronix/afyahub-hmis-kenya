/** Authenticated HTTP against isolated synthetic PostgreSQL; no external provider is contacted. */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeDb } from './support/db.ts';
import { pool } from '../../db/index.ts';
import { createSession } from '../../auth/session.service.ts';

describeDb('claim disclosure and receipt cancellation HTTP boundaries', () => {
  let server: Server,
    base: string,
    facility: number,
    otherFacility: number,
    invoice: number,
    claim: number,
    preauthorization: number,
    user: number;
  let authorized: string, restricted: string, other: string;
  const suffix = randomUUID().slice(0, 8);
  const tokenValue = `synthetic-consent-secret-${suffix}`;
  const bundleValue = `synthetic-fhir-private-${suffix}`;
  const nestedValue = `synthetic-nested-private-${suffix}`;
  const authCodeValue = `synthetic-auth-code-${suffix}`;
  const call = async (token: string | null, method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, headers: r.headers, data: (await r.json()) as Record<string, any> };
  };
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Synthetic test database required');
    const tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic HTTP ${suffix}`,
        `unified-http-${suffix}`,
      ])
    ).rows[0].id;
    const facs = await pool.query(
      "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic HTTP A',$4::jsonb),($1,$3,'Synthetic HTTP B',$4::jsonb) RETURNING id",
      [tenant, `uha-${suffix}`, `uhb-${suffix}`, JSON.stringify(['insurance', 'finance'])],
    );
    facility = facs.rows[0].id;
    otherFacility = facs.rows[1].id;
    const grants = [
      'patients.read',
      'clinical.read',
      'billing.read',
      'billing.payments.record',
      'insurance.sha.read',
      'insurance.sha.claims.read',
    ];
    for (const code of grants)
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
        [code],
      );
    const actor = async (tag: string, fac: number, codes: string[]) => {
      const u = (
        await pool.query(
          "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,$1,'synthetic','ACTIVE',$3,$4) RETURNING id",
          [`uh-${tag}-${suffix}`, `uh-${tag}-${suffix}@example.test`, tenant, fac],
        )
      ).rows[0].id;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `UH_${tag}_${suffix}`],
        )
      ).rows[0].id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [u, role]);
      for (const code of codes)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING',
          [role, code],
        );
      return {
        id: u,
        token: (await createSession({ userId: u, securityVersion: 1 })).sessionToken,
      };
    };
    const a = await actor('authorized', facility, grants);
    user = a.id;
    authorized = a.token;
    restricted = (await actor('restricted', facility, ['patients.read', 'insurance.sha.read']))
      .token;
    other = (await actor('other', otherFacility, grants)).token;
    const patient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','HTTP Patient','2000-01-01','Other') RETURNING id",
        [tenant, facility, `UH-MRN-${suffix}`],
      )
    ).rows[0].id;
    invoice = (
      await pool.query(
        "INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status) VALUES($1,$2,$3,$4,'100','0','100','Unpaid') RETURNING id",
        [tenant, facility, patient, `UH-INV-${suffix}`],
      )
    ).rows[0].id;
    claim = (
      await pool.query(
        "INSERT INTO sha_eclaims(tenant_id,facility_id,patient_id,invoice_id,claim_number,claim_uuid,billable_start,billable_end,total_billed_amount,total_claimed_amount,consent_token,fhir_bundle,diagnoses_snapshot,supporting_summary) VALUES($1,$2,$3,$4,$5,$6,'2026-01-01','2026-01-01','100','100',$7,$8::jsonb,$9::jsonb,$10::jsonb) RETURNING id",
        [
          tenant,
          facility,
          patient,
          invoice,
          `UH-CLAIM-${suffix}`,
          randomUUID(),
          tokenValue,
          JSON.stringify({ private: bundleValue }),
          JSON.stringify([
            { code: 'Z00', display: 'Synthetic', system: 'ICD-10', type: 'principal' },
          ]),
          JSON.stringify({ private: 'synthetic-summary' }),
        ],
      )
    ).rows[0].id;
    await pool.query('UPDATE sha_eclaims SET adjudication_summary=$1::jsonb WHERE id=$2', [
      JSON.stringify({ unexpected: nestedValue }),
      claim,
    ]);
    await pool.query(
      "INSERT INTO sha_eclaim_status_history(eclaim_id,to_status,source,reason,metadata) VALUES($1,'DRAFT','SYSTEM','Synthetic history',$2::jsonb)",
      [claim, JSON.stringify({ unexpected: nestedValue })],
    );
    await pool.query(
      "INSERT INTO sha_eclaim_submissions(eclaim_id,attempt_number,operation,bundle_uuid,environment_mode,request_correlation_id,outcome,errors) VALUES($1,1,'synthetic',$2,'mock',$3,'FAILED',$4::jsonb)",
      [claim, randomUUID(), randomUUID(), JSON.stringify([nestedValue])],
    );
    await pool.query(
      'INSERT INTO sha_patient_authorizations(tenant_id,facility_id,patient_id,consent_token,auth_code) VALUES($1,$2,$3,$4,$5)',
      [tenant, facility, patient, tokenValue, authCodeValue],
    );
    preauthorization = (
      await pool.query(
        "INSERT INTO insurance_preauthorizations(tenant_id,facility_id,patient_id,preauth_number,external_bundle_id,clinical_indication,primary_diagnosis_code,primary_diagnosis_display,requested_service_code,requested_service_name,estimated_amount,consent_token,fhir_bundle) VALUES($1,$2,$3,$4,$5,'Synthetic indication','Z00','Synthetic diagnosis','SYNTH','Synthetic service','100',$6,$7::jsonb) RETURNING id",
        [
          tenant,
          facility,
          patient,
          `UH-PA-${suffix}`,
          randomUUID(),
          tokenValue,
          JSON.stringify({ private: bundleValue }),
        ],
      )
    ).rows[0].id;
    const { createApp } = await import('../../app.ts');
    server = (await createApp()).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('minimizes list data, requires clinical permission for detail, redacts secrets, audits and isolates facilities', async () => {
    expect((await call(null, 'GET', '/api/insurance/sha/claims')).status).toBe(401);
    const list = await call(restricted, 'GET', `/api/insurance/sha/claims?facilityId=${facility}`);
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toContain('no-store');
    expect(list.data.claims).toHaveLength(1);
    expect(JSON.stringify(list.data)).not.toContain(tokenValue);
    expect(JSON.stringify(list.data)).not.toContain(bundleValue);
    expect(JSON.stringify(list.data)).not.toContain(nestedValue);
    expect(list.data.claims[0]).not.toHaveProperty('diagnosesSnapshot');
    expect(list.data.claims[0]).not.toHaveProperty('supportingSummary');
    expect(
      (await call(restricted, 'GET', `/api/insurance/sha/claims/${claim}?facilityId=${facility}`))
        .status,
    ).toBe(403);
    const detail = await call(
      authorized,
      'GET',
      `/api/insurance/sha/claims/${claim}?facilityId=${facility}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.data.claim.hasConsentToken).toBe(true);
    expect(detail.data.claim).not.toHaveProperty('consentToken');
    expect(detail.data.claim).not.toHaveProperty('fhirBundle');
    expect(JSON.stringify(detail.data)).not.toContain(tokenValue);
    expect(JSON.stringify(detail.data)).not.toContain(bundleValue);
    expect(JSON.stringify(detail.data)).not.toContain(nestedValue);
    expect(detail.data.claim).not.toHaveProperty('adjudicationSummary');
    expect(detail.data.claim.submissions[0]).not.toHaveProperty('errors');
    expect(detail.data.claim.statusHistory[0]).not.toHaveProperty('metadata');
    expect(
      (await call(other, 'GET', `/api/insurance/sha/claims/${claim}?facilityId=${otherFacility}`))
        .status,
    ).toBe(404);
    const log = await pool.query(
      "SELECT count(*)::int n FROM patient_record_access_logs WHERE user_id=$1 AND record_type='ShaClaim' AND record_id=$2",
      [user, claim],
    );
    expect(log.rows[0].n).toBe(1);
    const stored = await pool.query(
      'SELECT consent_token,fhir_bundle FROM sha_eclaims WHERE id=$1',
      [claim],
    );
    expect(stored.rows[0].consent_token).toBe(tokenValue);
    expect(stored.rows[0].fhir_bundle.private).toBe(bundleValue);
  });

  it('keeps preauthorization and visit-consent secrets server-side and audits authorized clinical reads', async () => {
    const authorizations = await call(
      authorized,
      'GET',
      `/api/insurance/sha/authorizations?facilityId=${facility}`,
    );
    expect(authorizations.status).toBe(200);
    expect(authorizations.headers.get('cache-control')).toContain('no-store');
    expect(authorizations.data.authorizations[0]).toMatchObject({
      hasConsentToken: true,
      hasAuthCode: true,
    });
    expect(JSON.stringify(authorizations.data)).not.toContain(tokenValue);
    expect(JSON.stringify(authorizations.data)).not.toContain(authCodeValue);
    expect(
      (await call(restricted, 'GET', `/api/insurance/sha/preauthorizations?facilityId=${facility}`))
        .status,
    ).toBe(403);
    const list = await call(
      authorized,
      'GET',
      `/api/insurance/sha/preauthorizations?facilityId=${facility}`,
    );
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toContain('no-store');
    expect(list.data.preauthorizations[0].hasConsentToken).toBe(true);
    expect(JSON.stringify(list.data)).not.toContain(tokenValue);
    expect(JSON.stringify(list.data)).not.toContain(bundleValue);
    const detail = await call(
      authorized,
      'GET',
      `/api/insurance/sha/preauthorizations/${preauthorization}?facilityId=${facility}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.data.preauthorization).not.toHaveProperty('consentToken');
    expect(detail.data.preauthorization).not.toHaveProperty('fhirBundle');
    expect(
      (
        await call(
          other,
          'GET',
          `/api/insurance/sha/preauthorizations/${preauthorization}?facilityId=${otherFacility}`,
        )
      ).status,
    ).toBe(404);
    const logs = await pool.query(
      "SELECT record_type FROM patient_record_access_logs WHERE user_id=$1 AND record_id=$2 AND record_type IN ('ShaPreauthorization','ShaPreauthorizationSummary') ORDER BY record_type",
      [user, preauthorization],
    );
    expect(logs.rows.map((row) => row.record_type)).toEqual([
      'ShaPreauthorization',
      'ShaPreauthorizationSummary',
    ]);
    const stored = await pool.query(
      'SELECT consent_token,fhir_bundle FROM insurance_preauthorizations WHERE id=$1',
      [preauthorization],
    );
    expect(stored.rows[0].consent_token).toBe(tokenValue);
    expect(stored.rows[0].fhir_bundle.private).toBe(bundleValue);
  });

  it('requires permission and facility scope, records one cancellation audit, and detects changed identity', async () => {
    const key = randomUUID(),
      body = {
        facilityId: facility,
        invoiceId: invoice,
        idempotencyKey: key,
        reason: 'Synthetic reviewed request',
      };
    expect(
      (await call(restricted, 'POST', '/api/billing/payments/cancel-pending', body)).status,
    ).toBe(403);
    expect((await call(other, 'POST', '/api/billing/payments/cancel-pending', body)).status).toBe(
      403,
    );
    const first = await call(authorized, 'POST', '/api/billing/payments/cancel-pending', body);
    expect(first.status).toBe(200);
    expect(first.data).toMatchObject({ status: 'CANCELLED', idempotentReplay: false });
    const replay = await call(authorized, 'POST', '/api/billing/payments/cancel-pending', body);
    expect(replay.data).toMatchObject({ status: 'CANCELLED', idempotentReplay: true });
    expect(
      (
        await call(authorized, 'POST', '/api/billing/payments/cancel-pending', {
          ...body,
          reason: 'Different review',
        })
      ).status,
    ).toBe(409);
    const audit = await pool.query(
      "SELECT count(*)::int n FROM audit_logs WHERE facility_id=$1 AND resource='PaymentRequest' AND action='CANCEL' AND resource_id=$2",
      [facility, String(invoice)],
    );
    expect(audit.rows[0].n).toBe(1);
    expect(
      (
        await call(authorized, 'POST', '/api/billing/payments/status', {
          facilityId: facility,
          idempotencyKey: key,
        })
      ).data,
    ).toMatchObject({ status: 'CANCELLED', invoiceId: invoice });
  });
});
