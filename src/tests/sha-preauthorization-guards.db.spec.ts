import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import type { InsuranceActorScope } from '../insurance/eclaims/contracts.ts';
import {
  authorizePatientVisitConsent,
  cancelPreauthorization,
  createPreauthorization,
  getPreauthorizationById,
  listPreauthorizations,
  submitPreauthorization,
  updatePreauthorization,
} from '../insurance/eclaims/preauthorization.service.ts';
import { mockAdapter } from './support/sha-test-fixtures.ts';
import { describeDb, testPool } from './vitest/support/db.ts';

// All identifiers and codes are synthetic syntax fixtures, NOT official catalog entries.
// These tests make no external submission and create no payer approval.
describeDb('SHA preauthorization local guards', () => {
  const pool = testPool();
  const suffix = randomUUID().slice(0, 8);
  let scope: InsuranceActorScope;
  let otherFacilityId: number;
  let patientId: number;
  let otherPatientId: number;
  let consentPatientId: number;
  let otherEncounterId: number;
  let draftId: number;
  const validInput = () => ({
    patientId,
    clinicalIndication: 'Synthetic test indication',
    primaryDiagnosisCode: 'TEST-DIAGNOSIS',
    primaryDiagnosisDisplay: 'Synthetic test diagnosis',
    requestedServiceCode: 'SHA-TEST-ONLY',
    requestedServiceName: 'Synthetic test service',
    estimatedAmount: '100.00',
  });

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    const tenantId = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic preauth tenant',
        `preauth-${suffix}`,
      ])
    ).rows[0].id;
    const facilities = await pool.query(
      'INSERT INTO facilities(tenant_id,code,name) VALUES($1,$2,$4),($1,$3,$5) RETURNING id',
      [tenantId, `PRE-A-${suffix}`, `PRE-B-${suffix}`, 'Synthetic A', 'Synthetic B'],
    );
    const facilityId = facilities.rows[0].id as number;
    otherFacilityId = facilities.rows[1].id;
    const uid = `preauth-user-${suffix}`;
    const userId = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic test user','not-for-login',$3,$4) RETURNING id`,
        [uid, `${uid}@example.test`, tenantId, facilityId],
      )
    ).rows[0].id;
    scope = { tenantId, facilityId, userId, userUid: uid };
    const patients = await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender,dha_client_registry_id)
       VALUES($1,$2,$4,'Synthetic','Draft','2000-01-01','Unknown',NULL),
             ($1,$3,$5,'Synthetic','Other','2000-01-01','Unknown',NULL),
             ($1,$2,$6,'Synthetic','Consent','2000-01-01','Unknown',$7) RETURNING id`,
      [
        tenantId,
        facilityId,
        otherFacilityId,
        `PRE-DRAFT-${suffix}`,
        `PRE-OTHER-${suffix}`,
        `PRE-CONSENT-${suffix}`,
        `TEST-CR-${suffix}`,
      ],
    );
    [patientId, otherPatientId, consentPatientId] = patients.rows.map((row) => row.id);
    otherEncounterId = (
      await pool.query(
        `INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status)
       VALUES($1,$2,$3,'OUTPATIENT','COMPLETED') RETURNING id`,
        [tenantId, otherFacilityId, otherPatientId],
      )
    ).rows[0].id;
    const draft = await createPreauthorization(scope, validInput());
    draftId = draft.id;
  });

  it('validates required information, quantity, code syntax, regulator and amount before creating drafts', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ clinicalIndication: ' ' }, 'INVALID_PREAUTH_INPUT'],
      [{ primaryDiagnosisCode: '' }, 'INVALID_PREAUTH_INPUT'],
      [{ requestedServiceName: '' }, 'INVALID_PREAUTH_INPUT'],
      [{ quantity: 0 }, 'INVALID_QUANTITY'],
      [{ quantity: 1.5 }, 'INVALID_QUANTITY'],
      [{ requestedServiceCode: '123456789' }, 'INVALID_SHA_CATALOGUE_CODE'],
      [{ practitionerRegulator: 'NOT_A_REGULATOR' }, 'INVALID_PRACTITIONER_REGULATOR'],
      [{ estimatedAmount: '-1' }, 'INVALID_MONETARY_AMOUNT'],
      [{ estimatedAmount: '1.999' }, 'INVALID_MONETARY_AMOUNT'],
    ];
    for (const [change, code] of cases) {
      await expect(
        createPreauthorization(scope, { ...validInput(), ...change }),
      ).rejects.toMatchObject({ code });
    }
    const count = await pool.query(
      'SELECT count(*)::int AS count FROM insurance_preauthorizations WHERE facility_id=$1',
      [scope.facilityId],
    );
    expect(count.rows[0].count).toBe(1);
  });

  it('rejects cross-facility patients and unrelated encounter, eligibility, tariff and authorization links', async () => {
    await expect(
      createPreauthorization(scope, { ...validInput(), patientId: otherPatientId }),
    ).rejects.toMatchObject({ code: 'PATIENT_NOT_FOUND' });
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ encounterId: otherEncounterId }, 'ENCOUNTER_NOT_FOUND'],
      [{ eligibilityVerificationId: 2147483647 }, 'ELIGIBILITY_NOT_FOUND'],
      [{ tariffId: 2147483647 }, 'TARIFF_NOT_FOUND'],
      [{ consentToken: randomUUID() }, 'AUTHORIZATION_REQUIRED'],
      [{ authorizationId: 2147483647 }, 'AUTHORIZATION_NOT_FOUND'],
    ];
    for (const [change, code] of cases) {
      await expect(
        createPreauthorization(scope, { ...validInput(), ...change }),
      ).rejects.toMatchObject({ code });
    }
    await expect(
      getPreauthorizationById({ ...scope, facilityId: otherFacilityId }, draftId),
    ).rejects.toMatchObject({ code: 'PREAUTH_NOT_FOUND' });
  });

  it('validates consent identity, intervention syntax and practitioner regulator without gateway calls', async () => {
    const adapter = mockAdapter();
    const authorization = vi.spyOn(adapter, 'createVisitAuthorization');
    await expect(
      authorizePatientVisitConsent(scope, { patientId, interventions: [] }, adapter),
    ).rejects.toMatchObject({ code: 'MISSING_CLIENT_REGISTRY_ID' });
    await expect(
      authorizePatientVisitConsent(
        scope,
        { patientId: consentPatientId, memberCrNumber: 'OTHER-TEST-ID', interventions: [] },
        adapter,
      ),
    ).rejects.toMatchObject({ code: 'IDENTIFIER_PATIENT_MISMATCH' });
    await expect(
      authorizePatientVisitConsent(
        scope,
        { patientId: consentPatientId, interventions: [] },
        adapter,
      ),
    ).rejects.toMatchObject({ code: 'MISSING_INTERVENTIONS' });
    await expect(
      authorizePatientVisitConsent(
        scope,
        { patientId: consentPatientId, interventions: ['invalid code'] },
        adapter,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_SHA_CATALOGUE_CODE' });
    await expect(
      authorizePatientVisitConsent(
        scope,
        {
          patientId: consentPatientId,
          interventions: ['SHA-TEST-ONLY'],
          practitionerRegulator: 'BAD' as 'KMPDC',
        },
        adapter,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PRACTITIONER_REGULATOR' });
    expect(authorization).not.toHaveBeenCalled();
  });

  it('keeps drafts local, scoped and unapproved, and requires an authoritative reference for approval', async () => {
    const draft = await getPreauthorizationById(scope, draftId);
    expect(draft).toMatchObject({
      status: 'DRAFT',
      source: 'LOCAL_DRAFT',
      approvedAmount: null,
      payerAuthReference: null,
    });
    expect(
      (await listPreauthorizations(scope, { patientId, status: 'draft' })).map((item) => item.id),
    ).toContain(draftId);
    expect(await listPreauthorizations({ ...scope, facilityId: otherFacilityId })).toEqual([]);
    await expect(
      updatePreauthorization(scope, draftId, { status: 'APPROVED' }),
    ).rejects.toMatchObject({ code: 'MISSING_PAYER_AUTH_REFERENCE' });
    await expect(
      updatePreauthorization(scope, draftId, { status: 'REJECTED' }),
    ).rejects.toMatchObject({ code: 'REJECTION_REASON_REQUIRED' });
    await expect(
      updatePreauthorization(scope, draftId, { status: 'EXPIRED' }),
    ).rejects.toMatchObject({ code: 'INVALID_PREAUTH_TRANSITION' });
    const updated = await updatePreauthorization(scope, draftId, {
      quantity: 2,
      estimatedAmount: '125.50',
      supportingNotes: 'Synthetic local revision',
    });
    expect(updated).toMatchObject({
      status: 'DRAFT',
      quantity: 2,
      estimatedAmount: '125.50',
      approvedAmount: null,
      payerAuthReference: null,
    });
  });

  it('requires patient and facility identifiers and submission context before using a mock adapter', async () => {
    const adapter = mockAdapter();
    const submit = vi.spyOn(adapter, 'submitBundle');
    await expect(submitPreauthorization(scope, draftId, adapter)).rejects.toMatchObject({
      code: 'MISSING_PATIENT_IDENTIFIER',
    });
    await pool.query('UPDATE patients SET dha_client_registry_id=$1 WHERE id=$2', [
      `TEST-CR-${suffix}`,
      patientId,
    ]);
    await expect(submitPreauthorization(scope, draftId, adapter)).rejects.toMatchObject({
      code: 'FACILITY_REGISTRY_REQUIRED',
    });
    await pool.query('UPDATE facilities SET mfl_code=$1 WHERE id=$2', [
      `TEST-FACILITY-${suffix}`,
      scope.facilityId,
    ]);
    await expect(submitPreauthorization(scope, draftId, adapter)).rejects.toMatchObject({
      code: 'PREAUTH_CONTEXT_REQUIRED',
    });
    expect(submit).not.toHaveBeenCalled();
    expect((await getPreauthorizationById(scope, draftId)).status).toBe('DRAFT');
  });

  it('cancels a local draft with an auditable reason without fabricating a gateway result', async () => {
    const adapter = mockAdapter();
    const cancel = vi.spyOn(adapter, 'cancelHiePreauth');
    await expect(cancelPreauthorization(scope, draftId, 'no', adapter)).rejects.toMatchObject({
      code: 'INVALID_CANCEL_REASON',
    });
    const result = await cancelPreauthorization(
      scope,
      draftId,
      'Synthetic local cancellation',
      adapter,
    );
    expect(result.preauthorization).toMatchObject({
      status: 'CANCELLED',
      approvedAmount: null,
      payerAuthReference: null,
    });
    expect(result.gateway).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
    await expect(
      cancelPreauthorization(scope, draftId, 'Again after cancellation', adapter),
    ).rejects.toMatchObject({ code: 'INVALID_PREAUTH_TRANSITION' });
    await expect(submitPreauthorization(scope, draftId, adapter)).rejects.toMatchObject({
      code: 'PREAUTH_ALREADY_SUBMITTED',
    });
    const audits = await pool.query(
      "SELECT action FROM audit_logs WHERE tenant_id=$1 AND resource='insurance_preauthorizations' AND resource_id=$2 ORDER BY id",
      [scope.tenantId, String(draftId)],
    );
    expect(audits.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'SHA_PREAUTH_CREATED',
        'SHA_PREAUTH_UPDATED',
        'SHA_PREAUTH_CANCELLED',
      ]),
    );
  });
});
