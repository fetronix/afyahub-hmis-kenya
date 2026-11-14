import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import {
  checkPatientEligibility,
  getEligibilityVerificationById,
  listFacilityRecentEligibilityChecks,
  listPatientEligibilityHistory,
  resolvePatientClientRegistryIdentity,
} from '../insurance/eclaims/eligibility.service.ts';
import type { InsuranceActorScope } from '../insurance/eclaims/contracts.ts';
import type {
  ClientRegistrySearchResult,
  EligibilityGatewayResult,
} from '../integrations/sha/sha.types.ts';
import { mockAdapter } from './support/sha-test-fixtures.ts';
import { describeDb, testPool } from './vitest/support/db.ts';

// This exercises synthetic records and injected gateway results; no DHA/SHA service is contacted.
const registryResult: ClientRegistrySearchResult = {
  found: true,
  source: 'SANDBOX_SIMULATION',
  mode: 'mock',
  isSimulated: true,
  crId: 'synthetic-registry-id',
  fullName: null,
  firstName: null,
  lastName: null,
  gender: null,
  dateOfBirth: null,
  isAlive: true,
  deceasedDateTime: null,
  citizenship: null,
  county: null,
  subCounty: null,
  preferredPrimaryCareNetwork: null,
  errorMessage: null,
  correlationId: 'synthetic-registry-correlation',
};
const unavailableResult: EligibilityGatewayResult = {
  outcome: 'Unable to verify',
  source: 'UNAVAILABLE',
  mode: 'mock',
  isSimulated: false,
  payerReference: null,
  memberCrNumber: null,
  memberStatus: null,
  isAlive: null,
  facilityBiometricsEnforced: null,
  whitelistedForOtp: null,
  hasPomsfScheme: false,
  schemes: [],
  schemeDetails: [],
  coverageStartDate: null,
  coverageEndDate: null,
  restrictions: [],
  reason: 'synthetic upstream failure',
  possibleSolution: null,
  responseClassification: 'UPSTREAM_ERROR',
  correlationId: 'synthetic-eligibility-correlation',
};

describeDb('SHA eligibility identity and isolation (injected gateway)', () => {
  const pool = testPool();
  const suffix = randomUUID().slice(0, 8);
  let scope: InsuranceActorScope;
  let otherFacilityId: number;
  let patientId: number;
  let validEncounter: number;
  const nationalId = `TEST-ID-${suffix}`;
  const makePatient = async (
    tag: string,
    values: { national?: string; sha?: string; cr?: string } = {},
  ) =>
    (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender,national_id,sha_number,dha_client_registry_id)
       VALUES($1,$2,$3,'Synthetic',$4,'2000-01-01','Unknown',$5,$6,$7) RETURNING id`,
        [
          scope.tenantId,
          scope.facilityId,
          `SHA-ID-${tag}-${suffix}`,
          tag,
          values.national ?? null,
          values.sha ?? null,
          values.cr ?? null,
        ],
      )
    ).rows[0].id as number;

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    const tenantId = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic identity tenant',
        `sha-id-${suffix}`,
      ])
    ).rows[0].id;
    const facilities = await pool.query(
      'INSERT INTO facilities(tenant_id,code,name) VALUES($1,$2,$4),($1,$3,$5) RETURNING id',
      [tenantId, `SHA-ID-A-${suffix}`, `SHA-ID-B-${suffix}`, 'Synthetic A', 'Synthetic B'],
    );
    const facilityId = facilities.rows[0].id as number;
    otherFacilityId = facilities.rows[1].id as number;
    const uid = `sha-id-user-${suffix}`;
    const userId = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic test user','not-for-login',$3,$4) RETURNING id`,
        [uid, `${uid}@example.test`, tenantId, facilityId],
      )
    ).rows[0].id as number;
    scope = { tenantId, facilityId, userId, userUid: uid };
    patientId = await makePatient('main', { national: nationalId });
    validEncounter = (
      await pool.query(
        `INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status)
       VALUES($1,$2,$3,'OUTPATIENT','COMPLETED') RETURNING id`,
        [tenantId, facilityId, patientId],
      )
    ).rows[0].id;
  });

  it('rejects mismatched, unknown and missing identifiers before invoking the gateway', async () => {
    const adapter = mockAdapter();
    const search = vi
      .spyOn(adapter, 'searchClientRegistryPatient')
      .mockResolvedValue(registryResult);
    await expect(
      resolvePatientClientRegistryIdentity(
        scope,
        { patientId, identificationType: 'NATIONAL_ID', identificationValue: 'TEST-OTHER-9999' },
        adapter,
      ),
    ).rejects.toMatchObject({ code: 'IDENTIFIER_PATIENT_MISMATCH' });
    await expect(
      resolvePatientClientRegistryIdentity(
        scope,
        {
          patientId,
          identificationType: 'INVALID' as 'NATIONAL_ID',
          identificationValue: nationalId,
        },
        adapter,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IDENTIFICATION_TYPE' });
    const noId = await makePatient('missing');
    await expect(
      resolvePatientClientRegistryIdentity(scope, { patientId: noId }, adapter),
    ).rejects.toMatchObject({ code: 'MISSING_SHA_IDENTIFIER' });
    await expect(
      resolvePatientClientRegistryIdentity(
        { ...scope, facilityId: otherFacilityId },
        { patientId },
        adapter,
      ),
    ).rejects.toMatchObject({ code: 'PATIENT_NOT_FOUND' });
    expect(search).not.toHaveBeenCalled();
  });

  it.each([
    ['CR_ID', 'CLIENT_REGISTRY_ID'],
    ['SHA', 'SHA_NUMBER'],
    ['NATIONAL_ID', 'NATIONAL_ID'],
    ['BIRTH_NOTIFICATION', 'BIRTH_NOTIFICATION'],
    ['BIRTH_CERTIFICATE', 'BIRTH_CERTIFICATE'],
    ['ALIEN_ID', 'ALIEN_ID'],
    ['REFUGEE_ID', 'REFUGEE_ID'],
    ['MANDATE_NUMBER', 'MANDATE_NUMBER'],
    ['PASSPORT', 'PASSPORT'],
  ])(
    'selects an existing %s identifier as %s without writing a simulated CR ID',
    async (storedType, expectedType) => {
      const id = await makePatient(storedType);
      const value = `TEST-${storedType}-${suffix}`;
      await pool.query(
        'INSERT INTO patient_identifiers(patient_id,id_type,id_value) VALUES($1,$2,$3)',
        [id, storedType, value],
      );
      const adapter = mockAdapter();
      const search = vi
        .spyOn(adapter, 'searchClientRegistryPatient')
        .mockResolvedValue(registryResult);
      const result = await resolvePatientClientRegistryIdentity(scope, { patientId: id }, adapter);
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({ identificationType: expectedType, identificationValue: value }),
      );
      expect(result.registry.isSimulated).toBe(true);
      expect(result.patient.dhaClientRegistryId).toBeNull();
      const row = await pool.query('SELECT dha_client_registry_id FROM patients WHERE id=$1', [id]);
      expect(row.rows[0].dha_client_registry_id).toBeNull();
    },
  );

  it('prefers a recorded registry ID and verifies an explicitly recorded national ID', async () => {
    const id = await makePatient('priority', { national: nationalId, cr: `TEST-CR-${suffix}` });
    const adapter = mockAdapter();
    const search = vi
      .spyOn(adapter, 'searchClientRegistryPatient')
      .mockResolvedValue(registryResult);
    await resolvePatientClientRegistryIdentity(scope, { patientId: id }, adapter);
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        identificationType: 'CLIENT_REGISTRY_ID',
        identificationValue: `TEST-CR-${suffix}`,
      }),
    );
    await resolvePatientClientRegistryIdentity(
      scope,
      { patientId: id, identificationType: 'NATIONAL_ID', identificationValue: ` ${nationalId} ` },
      adapter,
    );
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        identificationType: 'NATIONAL_ID',
        identificationValue: nationalId,
      }),
    );
  });

  it('rejects encounters outside the patient/facility before invoking eligibility', async () => {
    const adapter = mockAdapter();
    const check = vi.spyOn(adapter, 'checkEligibility').mockResolvedValue(unavailableResult);
    await expect(
      checkPatientEligibility(scope, { patientId, encounterId: 2_147_483_647 }, adapter),
    ).rejects.toMatchObject({ code: 'ENCOUNTER_NOT_FOUND' });
    expect(check).not.toHaveBeenCalled();
  });

  it('records unavailable results as unavailable, without updating authoritative patient eligibility', async () => {
    const adapter = mockAdapter();
    const check = vi.spyOn(adapter, 'checkEligibility').mockResolvedValue(unavailableResult);
    const result = await checkPatientEligibility(
      scope,
      { patientId, encounterId: validEncounter, intendedServiceArea: ' lab ' },
      adapter,
    );
    expect(result.verification).toMatchObject({
      outcome: 'Unable to verify',
      source: 'UNAVAILABLE',
      responseClassification: 'UPSTREAM_ERROR',
      encounterId: validEncounter,
      intendedServiceArea: 'LAB',
    });
    expect(result.verification.identificationHint).not.toContain(nationalId);
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({
        identificationType: 'NATIONAL_ID',
        identificationValue: nationalId,
      }),
    );
    const patient = await pool.query(
      'SELECT dha_eligibility_status,dha_eligibility_checked_at FROM patients WHERE id=$1',
      [patientId],
    );
    expect(patient.rows[0]).toEqual({
      dha_eligibility_status: null,
      dha_eligibility_checked_at: null,
    });
    const record = await getEligibilityVerificationById(scope, result.verification.id);
    expect(record.outcome).toBe('Unable to verify');
    await expect(
      getEligibilityVerificationById(
        { ...scope, facilityId: otherFacilityId },
        result.verification.id,
      ),
    ).rejects.toMatchObject({ code: 'ELIGIBILITY_VERIFICATION_NOT_FOUND' });
    expect(
      (await listPatientEligibilityHistory(scope, patientId)).history.map((row) => row.id),
    ).toContain(result.verification.id);
    expect((await listFacilityRecentEligibilityChecks(scope, 1)).map((row) => row.id)).toContain(
      result.verification.id,
    );
    const audits = await pool.query(
      "SELECT details FROM audit_logs WHERE action='SHA_ELIGIBILITY_CHECKED' AND resource_id=$1",
      [String(result.verification.id)],
    );
    expect(audits.rows[0].details).not.toContain(nationalId);
  });

  it('does not promote simulated eligible or pending responses into the authoritative cache', async () => {
    const adapter = mockAdapter();
    const check = vi.spyOn(adapter, 'checkEligibility');
    check.mockResolvedValueOnce({
      ...unavailableResult,
      outcome: 'Eligible',
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
      responseClassification: 'CONFIRMED_ELIGIBLE',
    });
    const simulated = await checkPatientEligibility(scope, { patientId }, adapter);
    expect(simulated.verification).toMatchObject({
      outcome: 'Eligible',
      isSimulated: true,
      source: 'SANDBOX_SIMULATION',
    });
    check.mockResolvedValueOnce({
      ...unavailableResult,
      outcome: 'Pending',
      source: 'AUTHORITATIVE_PAYER',
      mode: 'sandbox',
      responseClassification: 'CONFIRMED_PENDING',
    });
    await checkPatientEligibility(scope, { patientId }, adapter);
    const patient = await pool.query(
      'SELECT dha_eligibility_status,dha_eligibility_checked_at FROM patients WHERE id=$1',
      [patientId],
    );
    expect(patient.rows[0]).toEqual({
      dha_eligibility_status: null,
      dha_eligibility_checked_at: null,
    });
  });

  it('updates cache only for an explicitly confirmed, non-simulated injected result', async () => {
    const adapter = mockAdapter();
    vi.spyOn(adapter, 'checkEligibility').mockResolvedValue({
      ...unavailableResult,
      outcome: 'Ineligible',
      source: 'AUTHORITATIVE_PAYER',
      mode: 'sandbox',
      isAlive: false,
      memberCrNumber: 'TEST-CONFIRMED-CR',
      responseClassification: 'CONFIRMED_DECEASED',
    });
    await checkPatientEligibility(scope, { patientId }, adapter);
    const patient = await pool.query(
      'SELECT dha_eligibility_status,dha_client_registry_id FROM patients WHERE id=$1',
      [patientId],
    );
    expect(patient.rows[0]).toEqual({
      dha_eligibility_status: 'DECEASED',
      dha_client_registry_id: 'TEST-CONFIRMED-CR',
    });
  });
});
