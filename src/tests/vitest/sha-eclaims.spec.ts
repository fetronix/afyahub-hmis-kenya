/**
 * JaliCare HMIS
 * SHA eClaims, DHA HIE v1 & Kenya eClaims FHIR R4 IG v0.1.0 — Unit & Contract Suite
 *
 * Exercises (strictly mocked / synthetic — distinguished from live sandbox tests):
 *   1. Gateway configuration safety (`mock` default, `production` opt-in + HTTPS guard,
 *      `fr-code` headers, Draft v0.1.0 IG notice, secret redaction)
 *   2. Client Registry (`CR ID`) resolution & Eligibility verification (`isAlive === false`
 *      deceased hard-block before scheme evaluation, `POMSF*`/`TSC`/`USALAMA` prefix matching,
 *      `facilityBiometricsEnforced`, `whitelistedForOtp`, and `Unable to verify` on HTTP 5xx /
 *      timeout / missing credentials)
 *   3. HIE Benefits, Sub-Benefits, Intervention Matrix, Utilization, POMSF Balances & Bed Occupancy
 *   4. Beneficiary Consent & Visit Authorization (`AUTHORIZED` vs `AUTHORIZED_PENDING_VISIT`),
 *      6-variant HIE `/preauths`, HIE Virtual Claim dispatch (`op` `/claims/submit` vs `ip` `/claims/discharge`),
 *      Callback registration (`'prod'` rejected), and 2-step `bank_reference` Remittances
 *   5. Kenya eClaims FHIR R4 v0.1.0 Bundle construction & validator (inline `Organization/sha-insurer`,
 *      `Patient.name.family`, `Coverage.subscriber`/`class`, `Condition`, `Practitioner`,
 *      `MedicationRequest`/`MedicationDispense`, `DiagnosticReport`, SNOMED CT prohibition, `KES` currency,
 *      and SHA intervention combination rules)
 *   6. Pre-submission validation engine, state machines & decimal-safe cents arithmetic
 *   7. Granular RBAC permissions, delegation protections, Express route gates & `/api/webhooks/sha/status`
 *      constant-time secret verification
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  describeShaConnectionStatus,
  loadShaConfig,
  SHA_SANDBOX_AFYALINK_BASE_URL,
  SHA_SANDBOX_FHIR_IG_BASE_URL,
} from '../../integrations/sha/sha.config.ts';
import {
  buildShaFhirBundle,
  evaluateShaInterventionCombinations,
  isPomsfSchemeCode,
  isValidShaCatalogueCode,
  KE_ECLAIMS_PROFILES,
  parseShaBundleSubmissionResponse,
  parseShaClaimStatusResponse,
  parseShaPaymentNotice,
  SNOMED_CT_URI,
  validateShaFhirBundle,
} from '../../integrations/sha/sha.fhir.ts';
import {
  interpretShaEligibilityPayload,
  mapToHieIdentificationType,
  ShaGatewayAdapter,
} from '../../integrations/sha/sha.adapter.ts';
import {
  assertEclaimTransition,
  isConsistentShaDispatch,
  canTransitionEclaimStatus,
  canTransitionPreauthStatus,
  formatCents,
  multiplyMoneyCents,
  parseFacilityLevelRank,
  requireMoneyCents,
} from '../../insurance/eclaims/contracts.ts';
import {
  evaluateClaimValidationRules,
  type ClaimValidationContext,
} from '../../insurance/eclaims/claims-workflow.service.ts';
import { isDelegablePermission, isRestrictedRolePermission } from '../../auth/staff-role-policy.ts';

process.env.NODE_ENV = 'test';

const ENV_KEYS = [
  'SHA_MODE',
  'SHA_ALLOW_PRODUCTION',
  'SHA_MIDDLEWARE_BASE_URL',
  'SHA_AFYALINK_BASE_URL',
  'SHA_FHIR_IG_BASE_URL',
  'SHA_CLIENT_ID',
  'SHA_CLIENT_SECRET',
  'SHA_FACILITY_REGISTRY_CODE',
  'SHA_FACILITY_ID_TYPE',
  'SHA_TENANT_ID',
  'SHA_WEBHOOK_SECRET',
  'DHA_MODE',
  'DHA_ALLOW_PRODUCTION',
  'DHA_BASE_URL',
  'DHA_CLIENT_ID',
  'DHA_CLIENT_SECRET',
  'DHA_FACILITY_CODE',
] as const;

const savedEnv = new Map<string, string | undefined>();
const SYNTHETIC_SECRET = 'synthetic-sha-secret-do-not-expose-9999';
const SYNTHETIC_WEBHOOK_SECRET = 'synthetic-webhook-hmac-secret-7777';

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv.set(k, process.env[k]);
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const prev = savedEnv.get(k);
    if (prev === undefined) delete process.env[k];
    else process.env[k] = prev;
  }
  savedEnv.clear();
});

describe('1. SHA Gateway Configuration, Headers & Secret Redaction (Mocked Unit)', () => {
  it('defaults safely to mock simulation mode with fr-code facility ID type', () => {
    const cfg = loadShaConfig();
    expect(cfg.mode).toBe('mock');
    expect(cfg.enabled).toBe(true);
    expect(cfg.facilityIdType).toBe('fr-code');
    expect(cfg.middlewareBaseUrl).toBeNull();
    expect(cfg.eclaimsBaseUrl).toBeNull();
  });

  it('disables sandbox mode with clear missing settings when credentials are absent', () => {
    process.env.SHA_MODE = 'sandbox';
    const cfg = loadShaConfig();
    expect(cfg.mode).toBe('sandbox');
    expect(cfg.enabled).toBe(false);
    expect(cfg.disabledReason).toContain('SHA_CLIENT_ID');
    expect(cfg.disabledReason).toContain('SHA_CLIENT_SECRET');
    expect(cfg.disabledReason).toContain('SHA_FACILITY_REGISTRY_CODE');
    expect(cfg.eclaimsBaseUrl).toBe(SHA_SANDBOX_AFYALINK_BASE_URL);
    expect(SHA_SANDBOX_FHIR_IG_BASE_URL).toBe('https://nshr-uat.sha.go.ke/fhir');
  });

  it('refuses production mode unless SHA_ALLOW_PRODUCTION=true AND explicit https:// URLs exist', () => {
    process.env.SHA_MODE = 'production';
    process.env.SHA_CLIENT_ID = 'prod-client';
    process.env.SHA_CLIENT_SECRET = SYNTHETIC_SECRET;
    process.env.SHA_FACILITY_REGISTRY_CODE = 'FID-47-100001-1';
    process.env.SHA_MIDDLEWARE_BASE_URL = 'https://api.example-sha.go.ke/v1';
    process.env.SHA_AFYALINK_BASE_URL = 'https://eclaims.example-sha.go.ke';

    const blocked = loadShaConfig();
    expect(blocked.enabled).toBe(false);
    expect(blocked.disabledReason).toContain('SHA_ALLOW_PRODUCTION=true');

    process.env.SHA_ALLOW_PRODUCTION = 'true';
    const enabled = loadShaConfig();
    expect(enabled.enabled).toBe(true);
    expect(enabled.disabledReason).toBeNull();
  });

  it('never leaks clientSecret or webhookSecret in describeShaConnectionStatus() and surfaces FHIR IG v0.1.0 Draft notice', () => {
    process.env.SHA_MODE = 'sandbox';
    process.env.SHA_CLIENT_ID = 'uat-client-01';
    process.env.SHA_CLIENT_SECRET = SYNTHETIC_SECRET;
    process.env.SHA_WEBHOOK_SECRET = SYNTHETIC_WEBHOOK_SECRET;
    process.env.SHA_FACILITY_REGISTRY_CODE = 'FID-47-000123-9';

    const report = describeShaConnectionStatus(loadShaConfig());
    const serialized = JSON.stringify(report);

    expect(report.hasClientId).toBe(true);
    expect(report.hasClientSecret).toBe(true);
    expect(report.hasWebhookSecret).toBe(true);
    expect(report.fhirIgDraftNotice).toContain('v0.1.0');
    expect(report.capabilities.length).toBeGreaterThanOrEqual(9);
    expect(serialized).not.toContain(SYNTHETIC_SECRET);
    expect(serialized).not.toContain(SYNTHETIC_WEBHOOK_SECRET);
  });
});

describe('2. Client Registry Resolution, Deceased Hard-Block & Eligibility Safety (Mocked Unit)', () => {
  it('maps identification types accurately to official DHA HIE query parameters', () => {
    expect(mapToHieIdentificationType('CLIENT_REGISTRY_ID')).toBe('ClientRegistry ID');
    expect(mapToHieIdentificationType('NATIONAL_ID')).toBe('National ID');
    expect(mapToHieIdentificationType('BIRTH_NOTIFICATION')).toBe('Birth Notification');
    expect(mapToHieIdentificationType('MANDATE_NUMBER')).toBe('Mandate Number');
  });

  it('blocks deceased beneficiaries (isAlive=false) BEFORE scheme evaluation and matches POMSF prefixes', () => {
    const deceasedEvenWithEligibleScheme = interpretShaEligibilityPayload(200, {
      memberCrNumber: 'CR99006666',
      isAlive: false,
      statusCode: 1,
      schemes: [
        {
          schemeCode: 'SHIF',
          schemeName: 'Social Health Insurance Fund',
          coverage: { status: 'ELIGIBLE' },
        },
      ],
    });
    expect(deceasedEvenWithEligibleScheme.outcome).toBe('Ineligible');
    expect(deceasedEvenWithEligibleScheme.isAlive).toBe(false);
    expect(deceasedEvenWithEligibleScheme.responseClassification).toBe('CONFIRMED_DECEASED');

    const pomsfEligible = interpretShaEligibilityPayload(200, {
      memberCrNumber: 'CR99007777',
      isAlive: true,
      facilityBiometricsEnforced: true,
      whitelistedForOTP: false,
      schemes: [
        {
          schemeCode: 'POMSF-TSC',
          schemeName: 'Teachers Medical Scheme',
          memberType: 'PRINCIPAL',
          coverage: { status: 'ELIGIBLE', startDate: '2026-01-01', endDate: '2026-12-31' },
        },
        {
          schemeCode: 'SHIF',
          schemeName: 'SHIF',
          coverage: { status: 'ELIGIBLE' },
        },
      ],
    });
    expect(pomsfEligible.outcome).toBe('Eligible');
    expect(pomsfEligible.hasPomsfScheme).toBe(true);
    expect(pomsfEligible.facilityBiometricsEnforced).toBe(true);
    expect(pomsfEligible.whitelistedForOtp).toBe(false);
    expect(isPomsfSchemeCode('POMSF-NPS')).toBe(true);
    expect(isPomsfSchemeCode('TSC')).toBe(true);
    expect(isPomsfSchemeCode('USALAMA')).toBe(true);
    expect(isPomsfSchemeCode('SHIF')).toBe(false);
  });

  it('parses Eligible, Ineligible, Pending, and Manual review required payloads accurately', () => {
    const eligible = interpretShaEligibilityPayload(200, {
      message: {
        eligible: 1,
        id: 'CR-99001122',
        status: 'ACTIVE',
        schemes: ['SHIF', 'PHC'],
        coverageStartDate: '2026-01-01',
        coverageEndDate: '2026-12-31',
      },
    });
    expect(eligible.outcome).toBe('Eligible');
    expect(eligible.responseClassification).toBe('CONFIRMED_ELIGIBLE');
    expect(eligible.memberCrNumber).toBe('CR-99001122');

    const ineligible = interpretShaEligibilityPayload(200, {
      message: {
        eligible: 0,
        status: 'SUSPENDED',
        reason: 'SHIF household contribution in arrears',
      },
    });
    expect(ineligible.outcome).toBe('Ineligible');
    expect(ineligible.responseClassification).toBe('CONFIRMED_INELIGIBLE');

    const pending = interpretShaEligibilityPayload(200, {
      data: { member_status: 'PENDING', reason: 'Awaiting means-testing activation' },
    });
    expect(pending.outcome).toBe('Pending');

    const review = interpretShaEligibilityPayload(200, {
      data: { member_status: 'IDENTITY_CONFLICT' },
    });
    expect(review.outcome).toBe('Manual review required');
  });

  it('NEVER converts HTTP 500, missing credentials, timeout, or malformed JSON into Ineligible or Eligible', async () => {
    expect(interpretShaEligibilityPayload(503, { error: 'Service Unavailable' }).outcome).toBe(
      'Unable to verify',
    );
    expect(interpretShaEligibilityPayload(200, { unexpected: 'shape' }).outcome).toBe(
      'Unable to verify',
    );

    const unconfiguredAdapter = new ShaGatewayAdapter({
      config: loadShaConfig({
        mode: 'sandbox',
        clientId: null,
        clientSecret: null,
        facilityRegistryCode: null,
      }),
      recordAuditCall: false,
    });
    const missingRes = await unconfiguredAdapter.checkEligibility({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      identificationType: 'SHA_NUMBER',
      identificationValue: 'SHA-12345678',
    });
    expect(missingRes.outcome).toBe('Unable to verify');
    expect(missingRes.responseClassification).toBe('CONFIG_MISSING');
    expect(missingRes.isSimulated).toBe(false);

    const timeoutFetch: typeof fetch = async (url) => {
      if (String(url).includes('/tenants/token')) {
        return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 600 }), {
          status: 200,
        });
      }
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    };

    const timeoutAdapter = new ShaGatewayAdapter({
      config: loadShaConfig({
        mode: 'sandbox',
        middlewareBaseUrl: 'https://ilm-dev.dha.go.ke/uat-middleware/api/v1',
        eclaimsBaseUrl: SHA_SANDBOX_AFYALINK_BASE_URL,
        clientId: 'cid',
        clientSecret: 'csec',
        facilityRegistryCode: 'FID-47-100002-1',
        maxGetRetries: 0,
      }),
      fetchImpl: timeoutFetch,
      recordAuditCall: false,
    });

    const timeoutRes = await timeoutAdapter.checkEligibility({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      identificationType: 'NATIONAL_ID',
      identificationValue: '22334455',
    });
    expect(timeoutRes.outcome).toBe('Unable to verify');
    expect(timeoutRes.responseClassification).toBe('UPSTREAM_TIMEOUT');
  });

  it('sends X-Facility-Id and X-Facility-Id-Type: fr-code headers, retries GET once on 503, and NEVER auto-retries POST bundle submissions', async () => {
    let getCalls = 0;
    let postCalls = 0;
    let capturedHeaders: Record<string, string> = {};

    const stubFetch: typeof fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('/tenants/token')) {
        return new Response(JSON.stringify({ access_token: 'tok-uat', expires_in: 900 }), {
          status: 200,
        });
      }
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      if (init?.method === 'GET') {
        getCalls += 1;
        if (getCalls === 1) {
          return new Response(JSON.stringify({ error: 'temporary' }), { status: 503 });
        }
        return new Response(JSON.stringify({ message: { eligible: 1, id: 'CR-777' } }), {
          status: 200,
        });
      }
      postCalls += 1;
      return new Response(JSON.stringify({ state: 'failed_dispatch', errors: ['Upstream 502'] }), {
        status: 502,
      });
    };

    const adapter = new ShaGatewayAdapter({
      config: loadShaConfig({
        mode: 'sandbox',
        middlewareBaseUrl: 'https://ilm-dev.dha.go.ke/uat-middleware/api/v1',
        eclaimsBaseUrl: SHA_SANDBOX_AFYALINK_BASE_URL,
        clientId: 'cid',
        clientSecret: 'csec',
        facilityRegistryCode: 'FID-47-100003-1',
        maxGetRetries: 1,
      }),
      fetchImpl: stubFetch,
      recordAuditCall: false,
    });

    const elig = await adapter.checkEligibility({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      identificationType: 'SHA_NUMBER',
      identificationValue: 'SHA-88881111',
    });
    expect(getCalls).toBe(2);
    expect(elig.outcome).toBe('Eligible');
    expect(elig.source).toBe('AUTHORITATIVE_PAYER');
    expect(capturedHeaders['X-Facility-Id']).toBe('FID-47-100003-1');
    expect(capturedHeaders['X-Facility-Id-Type']).toBe('fr-code');

    const bundleDispatch = await adapter.submitBundle({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      operation: 'claims.submit',
      bundleUuid: '00000000-0000-4000-8000-000000000001',
      claimUuid: '00000000-0000-4000-8000-000000000002',
      fhirBundle: { resourceType: 'Bundle' },
    });
    expect(postCalls).toBe(1);
    expect(bundleDispatch.accepted).toBe(false);
    expect(bundleDispatch.payerReference).toBeNull();
  });

  it('exercises DHA HIE v1 Client Registry, Benefits, Utilization, Consent Auth, Preauth, Virtual Claim, Callback Guard & 2-Step Remittances in mock mode', async () => {
    const mockAdapter = new ShaGatewayAdapter({
      config: loadShaConfig({ mode: 'mock' }),
      recordAuditCall: false,
    });

    const crRes = await mockAdapter.searchClientRegistryPatient({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      identificationType: 'NATIONAL_ID',
      identificationValue: '30112233',
    });
    expect(crRes.found).toBe(true);
    expect(crRes.crId).toMatch(/^CR/);
    expect(crRes.isSimulated).toBe(true);

    const crMissing = await mockAdapter.searchClientRegistryPatient({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      identificationType: 'NATIONAL_ID',
      identificationValue: '30114040',
    });
    expect(crMissing.found).toBe(false);

    const benefits = await mockAdapter.fetchPatientBenefitsAndInterventions({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      memberCrNumber: 'CR30117777',
    });
    expect(benefits.reachable).toBe(true);
    expect(benefits.interventions.length).toBeGreaterThanOrEqual(2);
    expect(benefits.interventions.some((i) => i.needsPreauth)).toBe(true);

    const util = await mockAdapter.fetchBenefitUtilizationAndBalances({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      memberCrNumber: 'CR30117777',
      interventionCode: 'SHA-19-152',
      includePomsfBalances: true,
      includeBedOccupancy: true,
    });
    expect(util.reachable).toBe(true);
    expect(util.utilization[0].individualRemainingLimitKes).toBe('38000.00');
    expect(util.pomsfBalances).toHaveLength(1);
    expect(util.bedOccupancy?.totalBeds).toBeGreaterThan(0);

    const electiveAuth = await mockAdapter.createVisitAuthorization({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      memberCrNumber: 'CR30117777',
      serviceType: 'INPATIENT',
      consentMethod: 'OTP',
      otp: '123456',
      interventions: ['SHA-19-152'],
      isElectivePreVisit: true,
    });
    expect(electiveAuth.authorized).toBe(true);
    expect(electiveAuth.authStatus).toBe('AUTHORIZED_PENDING_VISIT');
    expect(electiveAuth.consentToken).toBeTruthy();

    const hiePa = await mockAdapter.submitHiePreauth({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      consentToken: electiveAuth.consentToken!,
      variant: 'IMAGING',
      isElective: true,
      interventionCode: 'SHA-19-152',
      serviceStart: '2026-10-28',
      serviceEnd: '2026-10-28',
      clinicalIndications: 'Stroke rule-out',
      diagnoses: [{ icdCode: '8B20', name: 'Stroke', diagnosisType: 'PRIMARY' }],
      items: [{ code: 'SHA-19-152', name: 'MRI Brain', quantity: 1, unitPriceKes: '10000.00' }],
    });
    expect(hiePa.accepted).toBe(true);
    expect(hiePa.hiePreauthGuid).toBeTruthy();

    const vClaim = await mockAdapter.submitHieVirtualClaim({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      consentToken: electiveAuth.consentToken!,
      subType: 'ip',
      invoiceNumber: 'INV-TEST-001',
      dischargeReason: 'RECOVERED',
      dischargeDate: '2026-10-28',
      diagnoses: [{ icdCode: '8B20', interventionCode: 'SHA-07-001' }],
      lines: [
        {
          interventionCode: 'SHA-07-001',
          serviceName: 'IPD Bed Day',
          quantity: 2,
          unitPriceKes: '4000.00',
        },
      ],
    });
    expect(vClaim.accepted).toBe(true);

    // Reject 'prod' per official HIE callback registration rules!
    const badCb = await mockAdapter.registerCallbackEndpoint({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      baseUrl: 'https://hmis.example.test',
      callbackPath: '/api/webhooks/sha/status',
      environment: 'prod' as unknown as 'production',
      entityType: 'claim',
    });
    expect(badCb.registered).toBe(false);
    expect(badCb.errorMessage).toContain('prod');

    const rems = await mockAdapter.fetchFacilityRemittances({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
    });
    expect(rems.remittances.length).toBeGreaterThan(0);
    const paidClaims = await mockAdapter.fetchClaimsPaidByRemittance({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      bankReference: rems.remittances[0].bankReference,
    });
    expect(paidClaims.claims.length).toBeGreaterThan(0);
  });

  it('exercises DHA HIE v1 sandbox HTTP transport branches via injected fetch stubs (not live network)', async () => {
    const sandboxFetch: typeof fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('/tenants/token')) {
        return new Response(JSON.stringify({ access_token: 'tok-sandbox-1', expires_in: 900 }), {
          status: 200,
        });
      }
      if (u.includes('/patients?') && init?.method === 'GET') {
        return new Response(
          JSON.stringify({
            patients: [
              {
                id: 'CR99008811',
                first_name: 'Synthetic',
                last_name: 'Patient',
                gender: 'female',
                date_of_birth: '1990-05-01',
                deceased_datetime: null,
                dependants: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.includes('/patients/benefits/interventions')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                code: 'SHA-19-152',
                name: 'MRI Brain',
                fund: 'SHIF',
                paymentMechanism: 'FEE_FOR_SERVICE',
                overallTariff: 10000,
                needsPreauth: true,
                needsManualPreauthApproval: true,
                needsDoctorAuthorization: true,
                requiresRadiologyPreauth: true,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.includes('/patients/sub-benefits')) {
        return new Response(
          JSON.stringify({ data: [{ code: 'SUB-19', name: 'Radiology', parentCode: 'SHA-19' }] }),
          { status: 200 },
        );
      }
      if (u.includes('/patients/benefits/utilization')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                crId: 'CR99008811',
                code: 'SHA-19-152',
                limitScope: 'INDIVIDUAL',
                individualMaxLimit: 50000,
                individualUtilisedLimit: 10000,
                householdMaxLimit: 100000,
                householdUtilisedLimit: 10000,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.includes('/patients/benefits')) {
        return new Response(
          JSON.stringify({
            data: [{ code: 'SHA-19', name: 'Imaging', fund: 'SHIF', status: 'ACTIVE' }],
          }),
          { status: 200 },
        );
      }
      if (u.includes('/patients/pomsf-balances')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                schemeCode: 'POMSF-TSC',
                policyYear: '2026',
                annualAllocation: 150000,
                utilisedAmount: 25000,
                remainingBalance: 125000,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.includes('/beds/occupancy')) {
        return new Response(
          JSON.stringify({ totalBeds: 100, occupiedBeds: 62, occupancyRate: 62 }),
          { status: 200 },
        );
      }
      if (u.includes('/claims/authorize')) {
        return new Response(
          JSON.stringify({
            guid: 'GUID-AUTH-01',
            token: 'CONSENT-TOK-01',
            authCode: 'AC-01',
            status: 'AUTHORIZED',
            needsPreauth: false,
          }),
          { status: 200 },
        );
      }
      if (u.includes('/authorizations/covers')) {
        return new Response(JSON.stringify({ selected: true }), { status: 200 });
      }
      if (u.includes('/claims/visit')) {
        return new Response(JSON.stringify({ edi_claim_guid: 'VCLM-999' }), { status: 200 });
      }
      if (u.includes('/preauths/cancel')) {
        return new Response(JSON.stringify({ status: 'CANCELLED' }), { status: 200 });
      }
      if (u.includes('/preauths') && init?.method === 'GET') {
        return new Response(
          JSON.stringify({
            data: [
              {
                guid: 'PA-GUID-1',
                authCode: 'PA-AUTH-1',
                status: 'APPROVED',
                doctorApproved: true,
                finalApprovedAmount: 10000,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.includes('/preauths') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            guid: 'PA-GUID-1',
            authCode: 'PA-AUTH-1',
            status: 'PENDING',
            needsDoctorApproval: true,
            totalInterimApprovedAmountForPreauth: 10000,
          }),
          { status: 201 },
        );
      }
      if (
        u.includes('/claims/diagnoses') ||
        u.includes('/claims/lines') ||
        u.includes('/claims/preview')
      ) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (u.includes('/claims/submit') || u.includes('/claims/discharge')) {
        return new Response(JSON.stringify({ claim_id: 'HIE-CLM-77', status: 'SUBMITTED' }), {
          status: 200,
        });
      }
      if (u.includes('/remittances/claims') || u.includes('bank_reference=')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                claim_id: 'HIE-CLM-77',
                claim_number: 'ECLM-SHA-000001',
                approved_amount: 10000,
                paid_amount: 10000,
                status: 'PAID',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.includes('/remittances')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                bank_reference: 'BNK-2026-01',
                remittance_reference: 'REM-2026-01',
                payment_date: '2026-10-28',
                total_amount: 10000,
                payment_channel: 'EFT',
                claim_count: 1,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.includes('/endpoints')) {
        return new Response(JSON.stringify({ id: 'EP-1', operation_id: 'OP-1' }), { status: 201 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const sbAdapter = new ShaGatewayAdapter({
      config: loadShaConfig({
        mode: 'sandbox',
        middlewareBaseUrl: 'https://ilm-dev.dha.go.ke/uat-middleware/api/v1',
        eclaimsBaseUrl: SHA_SANDBOX_AFYALINK_BASE_URL,
        clientId: 'sb-cid',
        clientSecret: 'sb-sec',
        facilityRegistryCode: 'FID-47-115307-8',
      }),
      fetchImpl: sandboxFetch,
      recordAuditCall: false,
    });

    const cr = await sbAdapter.searchClientRegistryPatient({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      identificationType: 'NATIONAL_ID',
      identificationValue: '29887766',
    });
    expect(cr.found).toBe(true);
    expect(cr.isSimulated).toBe(false);
    expect(cr.crId).toBe('CR99008811');

    const ben = await sbAdapter.fetchPatientBenefitsAndInterventions({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      memberCrNumber: 'CR99008811',
      parentBenefitCode: 'SHA-19',
      accessPoint: 'OP',
    });
    expect(ben.reachable).toBe(true);
    expect(ben.isSimulated).toBe(false);
    expect(ben.interventions[0].specialistFlags.requiresRadiologyPreauth).toBe(true);

    const util = await sbAdapter.fetchBenefitUtilizationAndBalances({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      memberCrNumber: 'CR99008811',
      interventionCode: 'SHA-19-152',
      includePomsfBalances: true,
      includeBedOccupancy: true,
    });
    expect(util.utilization[0].individualRemainingLimitKes).toBe('40000.00');
    expect(util.pomsfBalances[0].remainingBalanceKes).toBe('125000.00');

    const visitAuth = await sbAdapter.createVisitAuthorization({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      memberCrNumber: 'CR99008811',
      serviceType: 'OUTPATIENT',
      consentMethod: 'OTP',
      otp: '654321',
      interventions: ['SHA-12-001'],
      selectedPomsfScheme: 'POMSF-TSC',
      startVirtualClaimImmediately: true,
    });
    expect(visitAuth.authorized).toBe(true);
    expect(visitAuth.virtualClaimId).toBe('VCLM-999');

    const paSub = await sbAdapter.submitHiePreauth({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      consentToken: 'CONSENT-TOK-01',
      variant: 'IMAGING',
      isElective: false,
      interventionCode: 'SHA-19-152',
      serviceStart: '2026-10-28',
      serviceEnd: '2026-10-28',
      clinicalIndications: 'Neurology workup',
      diagnoses: [{ icdCode: '8B20', name: 'Stroke' }],
      items: [{ code: 'SHA-19-152', name: 'MRI', quantity: 1, unitPriceKes: '10000.00' }],
      doctors: [{ registrationNumber: 'A123', regulationBody: 'KMPDC' }],
    });
    expect(paSub.accepted).toBe(true);

    const paPoll = await sbAdapter.queryHiePreauths({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      consentToken: 'CONSENT-TOK-01',
    });
    expect(paPoll.doctorApproved).toBe(true);

    const paCancel = await sbAdapter.cancelHiePreauth({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      consentToken: 'CONSENT-TOK-01',
      reason: 'Patient deferred scan',
    });
    expect(paCancel.cancelled).toBe(true);

    const vcSub = await sbAdapter.submitHieVirtualClaim({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      consentToken: 'CONSENT-TOK-01',
      subType: 'op',
      invoiceNumber: 'INV-77',
      dischargeReason: 'RECOVERED',
      diagnoses: [{ icdCode: '8B20', interventionCode: 'SHA-12-001' }],
      lines: [
        {
          interventionCode: 'SHA-12-001',
          serviceName: 'OPD Consultation',
          unitPriceKes: '1000.00',
          quantity: 1,
        },
      ],
    });
    expect(vcSub.accepted).toBe(true);
    expect(vcSub.payerReference).toBe('HIE-CLM-77');

    const remList = await sbAdapter.fetchFacilityRemittances({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      fromDate: '2026-10-01',
      toDate: '2026-10-28',
    });
    expect(remList.remittances[0].bankReference).toBe('BNK-2026-01');

    const remClaims = await sbAdapter.fetchClaimsPaidByRemittance({
      tenantId: 1,
      facilityId: 1,
      actorUserId: 1,
      bankReference: 'BNK-2026-01',
    });
    expect(remClaims.claims[0].paidAmountKes).toBe('10000.00');
  });
});

describe('SHA dispatch outcome consistency', () => {
  it('never treats failed, contradictory, non-2xx or error-bearing responses as success', () => {
    expect(
      isConsistentShaDispatch({ accepted: true, outcome: 'FAILED', httpStatus: 200, errors: [] }),
    ).toBe(false);
    expect(
      isConsistentShaDispatch({
        accepted: false,
        outcome: 'APPROVED',
        httpStatus: 200,
        errors: [],
      }),
    ).toBe(false);
    expect(
      isConsistentShaDispatch({ accepted: true, outcome: 'APPROVED', httpStatus: 503, errors: [] }),
    ).toBe(false);
    expect(
      isConsistentShaDispatch({
        accepted: true,
        outcome: 'ACKNOWLEDGED',
        httpStatus: 200,
        errors: ['error'],
      }),
    ).toBe(false);
    expect(
      isConsistentShaDispatch({ accepted: true, outcome: 'REJECTED', httpStatus: 200, errors: [] }),
    ).toBe(false);
    expect(
      isConsistentShaDispatch({
        accepted: false,
        outcome: 'REJECTED',
        httpStatus: 200,
        errors: ['denied'],
      }),
    ).toBe(true);
    expect(
      isConsistentShaDispatch({
        accepted: true,
        outcome: 'ACKNOWLEDGED',
        httpStatus: 202,
        errors: [],
      }),
    ).toBe(true);
  });
});

describe('3. Kenya eClaims FHIR R4 v0.1.0 Bundle Builder, Validator & Combination Rules (Mocked Unit)', () => {
  it('constructs a draft IPD bundle with inline clinical resources (not external conformance evidence)', () => {
    const bundle = buildShaFhirBundle({
      bundleUuid: 'b-uuid-001',
      claimUuid: 'c-uuid-001',
      claimNumber: 'ECLM-SHA-000001',
      use: 'claim',
      claimType: 'institutional',
      subType: 'ip',
      schemeCode: 'SHIF',
      facilityRegistryCode: 'FID-47-100999-2',
      facilityName: 'Nyeri County Teaching Hospital',
      patient: {
        internalId: 42,
        shaNumber: 'SHA-9001002',
        nationalId: '30112233',
        crNumber: 'CR-42',
        fullName: 'Wanjiku Patient',
        firstName: 'Wanjiku',
        lastName: 'Patient',
        gender: 'Female',
        birthDate: '1991-04-15',
      },
      encounterId: 108,
      admissionDate: '2026-10-20',
      dischargeDate: '2026-10-24',
      billableStart: '2026-10-20',
      billableEnd: '2026-10-24',
      createdIso: '2026-10-28T08:00:00.000Z',
      totalClaimedKes: '18500.00',
      preAuthReferences: ['AUTH-REAL-991'],
      previousClaimReference: 'CLM-PRIOR-001',
      attendingPractitioner: {
        registrationNumber: 'A12345',
        regulator: 'KMPDC',
        fullName: 'Dr. Kamau',
      },
      diagnoses: [{ code: 'CA40.0', display: 'Bacterial pneumonia', system: 'ICD-11' }],
      items: [
        {
          sequence: 1,
          payerServiceCode: 'SHA-IP-010',
          payerServiceName: 'Inpatient Medical Ward Bed Day',
          servicedStart: '2026-10-20',
          servicedEnd: '2026-10-24',
          quantity: 4,
          unitPriceKes: '4625.00',
          netKes: '18500.00',
        },
      ],
      medications: [
        {
          id: 1,
          drugName: 'Ceftriaxone 1g IV',
          dosageInstruction: '1g BD (5 days)',
          quantityDispensed: 10,
          dispensedOn: '2026-10-21T08:00:00.000Z',
        },
      ],
      diagnosticReports: [
        {
          id: 1,
          category: 'LAB',
          code: 'FBC-01',
          display: 'Full Haemogram',
          conclusion: 'Elevated neutrophils',
        },
      ],
    });

    const validation = validateShaFhirBundle(bundle);
    expect(validation.valid).toBe(true);

    const entries = bundle.entry as Array<{ resource: Record<string, unknown> }>;
    const types = entries.map((e) => e.resource.resourceType);
    expect(types).toEqual([
      'Organization',
      'Organization',
      'Patient',
      'Coverage',
      'Practitioner',
      'Encounter',
      'EpisodeOfCare',
      'Condition',
      'MedicationRequest',
      'MedicationDispense',
      'DiagnosticReport',
      'Claim',
    ]);

    const resource = (kind: string) =>
      entries.find((entry) => entry.resource.resourceType === kind)!.resource;
    expect(resource('Coverage').status).toBe('draft');
    expect(resource('Encounter').status).toBe('unknown');
    expect(resource('MedicationRequest').status).toBe('unknown');
    expect(
      (resource('MedicationRequest').medicationCodeableConcept as { coding?: unknown }).coding,
    ).toBeUndefined();
    expect(resource('DiagnosticReport').status).toBe('unknown');
    expect((resource('DiagnosticReport').code as { coding?: unknown }).coding).toBeUndefined();
    expect(resource('Condition').clinicalStatus).toBeUndefined();

    const claim = entries[entries.length - 1].resource;
    expect(claim.use).toBe('claim');
    expect((claim.total as { value: number; currency: string }).value).toBe(18500);
    expect((claim.total as { value: number; currency: string }).currency).toBe('KES');
    expect((claim.insurance as Array<{ preAuthRef?: string[] }>)[0].preAuthRef).toEqual([
      'AUTH-REAL-991',
    ]);
    expect(claim.related).toBeDefined();
  });

  it('prohibits SNOMED CT coding and non-KES currencies in validateShaFhirBundle()', () => {
    const validBundle = buildShaFhirBundle({
      bundleUuid: 'b-snomed-test',
      claimUuid: 'c-snomed-test',
      claimNumber: 'ECLM-SHA-000099',
      use: 'claim',
      claimType: 'institutional',
      subType: 'op',
      schemeCode: 'SHIF',
      facilityRegistryCode: 'FID-47-100999-2',
      facilityName: 'Nyeri Clinic',
      patient: { internalId: 9, shaNumber: 'SHA-999', fullName: 'Jane Wambui' },
      billableStart: '2026-10-28',
      billableEnd: '2026-10-28',
      createdIso: '2026-10-28T09:00:00.000Z',
      totalClaimedKes: '1000.00',
      diagnoses: [{ code: '8B20', display: 'Stroke' }],
      items: [
        {
          sequence: 1,
          payerServiceCode: 'SHA-12-001',
          payerServiceName: 'OPD Visit',
          servicedStart: '2026-10-28',
          servicedEnd: '2026-10-28',
          quantity: 1,
          unitPriceKes: '1000.00',
          netKes: '1000.00',
        },
      ],
    });

    // Inject prohibited SNOMED CT URI & USD currency to verify rejection
    const corrupted = JSON.parse(JSON.stringify(validBundle)) as Record<string, unknown>;
    const entries = corrupted.entry as Array<{ resource: Record<string, unknown> }>;
    const claim = entries.find((e) => e.resource.resourceType === 'Claim')!.resource;
    (claim.total as { currency: string }).currency = 'USD';
    (
      claim.diagnosis as Array<{ diagnosisCodeableConcept: { coding: Array<{ system: string }> } }>
    )[0].diagnosisCodeableConcept.coding[0].system = SNOMED_CT_URI;

    const check = validateShaFhirBundle(corrupted);
    expect(check.valid).toBe(false);
    expect(check.issues.map((i) => i.code)).toContain('FHIR_PROHIBITED_SNOMED_CT');
    expect(check.issues.map((i) => i.code)).toContain('FHIR_NON_KES_CURRENCY');
  });

  it('enforces official SHA intervention catalogue formatting & standalone combination rules', () => {
    expect(isValidShaCatalogueCode('SHA-19-152')).toBe(true);
    expect(isValidShaCatalogueCode('SHA-IMG-010')).toBe(true);
    expect(isValidShaCatalogueCode('PMF-001')).toBe(true);
    expect(isValidShaCatalogueCode('386661006')).toBe(false); // SNOMED CT concept ID rejected

    // SHA-12 (Outpatient) is standalone and must NOT combine with SHA-19 (Imaging)
    const badCombo = evaluateShaInterventionCombinations(['SHA-12-001', 'SHA-19-152']);
    expect(badCombo.valid).toBe(false);
    expect(badCombo.violations[0]).toContain('SHA-12');

    // SHA-07 (IPD) + SHA-03 (Lab) + SHA-19 (Imaging) are pairable
    const goodCombo = evaluateShaInterventionCombinations([
      'SHA-07-001',
      'SHA-03-010',
      'SHA-19-152',
    ]);
    expect(goodCombo.valid).toBe(true);
  });

  it('enforces the AfyaLink Primary Healthcare (PHC) KES 0.00 total rule and imaging preauth profile', () => {
    const phcBundle = buildShaFhirBundle({
      bundleUuid: 'b-phc-1',
      claimUuid: 'c-phc-1',
      claimNumber: 'ECLM-SHA-000002',
      use: 'preauthorization',
      preauthCategory: 'IMAGING',
      claimType: 'institutional',
      subType: 'op',
      schemeCode: 'PHC',
      facilityRegistryCode: 'FID-47-100999-2',
      facilityName: 'Nyeri Clinic',
      patient: { internalId: 7, shaNumber: 'SHA-777', fullName: 'Synthetic Patient' },
      billableStart: '2026-10-28',
      billableEnd: '2026-10-28',
      createdIso: '2026-10-28T09:00:00.000Z',
      isPhcClaim: true,
      totalClaimedKes: '1500.00',
      diagnoses: [{ code: '8B20', display: 'Stroke evaluation' }],
      items: [
        {
          sequence: 1,
          payerServiceCode: 'SHA-IMG-001',
          payerServiceName: 'CT Head',
          servicedStart: '2026-10-28',
          servicedEnd: '2026-10-28',
          quantity: 1,
          unitPriceKes: '1500.00',
          netKes: '1500.00',
        },
      ],
    });

    const entries = phcBundle.entry as Array<{ resource: Record<string, unknown> }>;
    const claim = entries.find((e) => e.resource.resourceType === 'Claim')!.resource;
    expect((claim.meta as { profile: string[] }).profile).toContain(
      KE_ECLAIMS_PROFILES.imagingPreauth,
    );
    expect((claim.total as { value: number }).value).toBe(0);
  });

  it('parses FHIR ClaimResponse, OperationOutcome, Bundle searchset status queries, and PaymentNotice cleanly', () => {
    const opOutcome = parseShaBundleSubmissionResponse(422, {
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', diagnostics: 'Missing ICD-11 coding on Claim.diagnosis[0]' }],
    });
    expect(opOutcome.accepted).toBe(false);
    expect(opOutcome.payerReference).toBeNull();
    expect(opOutcome.rejectionReason).toContain('Missing ICD-11 coding');

    const claimResp = parseShaBundleSubmissionResponse(200, {
      resourceType: 'ClaimResponse',
      id: 'CRESP-1002',
      outcome: 'complete',
      preAuthRef: 'PA-AUTH-88412',
      total: [{ amount: { value: 12000, currency: 'KES' } }],
    });
    expect(claimResp.accepted).toBe(true);
    // Processing completion and a reference do not establish payer approval.
    expect(claimResp.outcome).toBe('ACKNOWLEDGED');
    expect(claimResp.payerReference).toBe('PA-AUTH-88412');
    expect(claimResp.approvedAmountKes).toBeNull();
    expect(parseShaBundleSubmissionResponse(200, { id: 'synthetic-reference' }).accepted).toBe(
      false,
    );
    expect(
      parseShaBundleSubmissionResponse(200, { resourceType: 'ClaimResponse', id: 'synthetic' })
        .accepted,
    ).toBe(false);
    expect(parseShaBundleSubmissionResponse(503, { status: 'queued' }).accepted).toBe(false);

    const status = parseShaClaimStatusResponse(200, {
      data: {
        claim_id: 'SHA-CLM-551',
        state: 'partially_approved',
        approved_amount: '9500.50',
        reason: 'Consumables capped at SHIF schedule',
      },
    });
    expect(status.recognized).toBe(true);
    expect(status.mappedStatus).toBe('PARTIALLY_ADJUDICATED');
    expect(status.approvedAmountKes).toBe('9500.50');

    const notice = parseShaPaymentNotice({
      resourceType: 'PaymentNotice',
      id: 'PN-901',
      paymentDate: '2026-10-28',
      amount: { value: 9500.5, currency: 'KES' },
      request: { reference: 'Claim/ECLM-SHA-000001' },
    });
    expect(notice).toEqual({
      payerRemittanceRef: 'PN-901',
      paymentDate: '2026-10-28',
      amountKes: '9500.50',
      claimReference: 'ECLM-SHA-000001',
    });
  });
});

describe('4. Pre-Submission Validation Engine, State Machines & Decimal-Safe Money (Mocked Unit)', () => {
  const validBase: ClaimValidationContext = {
    hasPatientShaOrNationalId: true,
    facilityRegistryCode: 'FID-47-100001-1',
    requireVerifiedEligibility: true,
    eligibilityOutcome: 'Eligible',
    isBeneficiaryAlive: true,
    eligibilityCheckedAt: new Date(Date.now() - 3_600_000),
    eligibilityMaxAgeHours: 24,
    billableStart: '2026-10-25',
    billableEnd: '2026-10-28',
    subType: 'op',
    hasAdmissionRecord: false,
    hasDischargeDate: false,
    diagnosesCount: 1,
    diagnoses: [
      { code: '8B20', display: 'Synthetic diagnosis', system: 'ICD-11', type: 'principal' },
    ],
    isPhcClaim: false,
    totalClaimedCents: 350000,
    hasDuplicateActiveInvoiceClaim: false,
    items: [
      {
        sequence: 1,
        description: 'Specialist Consultation',
        payerServiceCode: 'SHA-OP-002',
        servicedStart: '2026-10-26',
        servicedEnd: '2026-10-26',
        quantity: 1,
        claimedUnitCents: 350000,
        claimedNetCents: 350000,
        requiresPreauth: false,
        preauthReference: null,
        preauthApprovedAndValid: false,
      },
    ],
  };

  it('passes clean claim packages with zero ERROR issues', () => {
    const issues = evaluateClaimValidationRules(validBase);
    expect(issues.filter((i) => i.severity === 'ERROR')).toHaveLength(0);
  });

  it('rejects missing or unknown diagnosis coding instead of guessing an ICD system', () => {
    const issues = evaluateClaimValidationRules({
      ...validBase,
      diagnoses: [{ code: 'Z00', display: 'Synthetic', type: 'principal' }],
    });
    expect(issues.map((i) => i.code)).toContain('INCOMPLETE_DIAGNOSIS_CODING');
    const unknown = evaluateClaimValidationRules({
      ...validBase,
      diagnoses: [{ code: 'Z00', display: 'Synthetic', system: 'OTHER', type: 'principal' }],
    });
    expect(unknown.map((i) => i.code)).toContain('INCOMPLETE_DIAGNOSIS_CODING');
  });

  it('catches deceased beneficiary, SNOMED CT diagnosis, standalone intervention conflicts, unmapped codes, and total mismatch', () => {
    const broken = evaluateClaimValidationRules({
      ...validBase,
      eligibilityOutcome: 'Unable to verify',
      isBeneficiaryAlive: false,
      subType: 'ip',
      hasAdmissionRecord: false,
      diagnosesCount: 1,
      diagnoses: [{ code: '386661006', system: 'http://snomed.info/sct' }],
      hasDuplicateActiveInvoiceClaim: true,
      totalClaimedCents: 400000,
      items: [
        {
          ...validBase.items[0],
          payerServiceCode: 'SHA-12-001',
          requiresPreauth: true,
          preauthReference: null,
          preauthApprovedAndValid: false,
          servicedStart: '2026-10-19',
        },
        {
          ...validBase.items[0],
          sequence: 2,
          payerServiceCode: 'SHA-19-152',
          claimedUnitCents: 100000,
          claimedNetCents: 100000,
        },
      ],
    });

    const codes = broken.map((i) => i.code);
    expect(codes).toContain('BENEFICIARY_DECEASED');
    expect(codes).toContain('PATIENT_NOT_CONFIRMED_ELIGIBLE');
    expect(codes).toContain('PROHIBITED_SNOMED_CT');
    expect(codes).toContain('SHA_INTERVENTION_COMBINATION_CONFLICT');
    expect(codes).toContain('MISSING_IPD_ADMISSION');
    expect(codes).toContain('DUPLICATE_INVOICE_CLAIM');
    expect(codes).toContain('ITEM_DATE_OUTSIDE_BILLABLE_PERIOD');
    expect(codes).toContain('MISSING_OR_INVALID_PREAUTH');
    expect(codes).toContain('CLAIM_TOTAL_MISMATCH');
  });

  it('enforces strict claim & preauth state transitions and decimal-safe cents math', () => {
    expect(canTransitionEclaimStatus('DRAFT', 'READY_FOR_SUBMISSION')).toBe(true);
    expect(canTransitionEclaimStatus('DRAFT', 'PAID')).toBe(false);
    expect(canTransitionEclaimStatus('REJECTED', 'SUBMITTED')).toBe(true);
    expect(canTransitionEclaimStatus('PAID', 'DRAFT')).toBe(false);
    expect(() => assertEclaimTransition('DRAFT', 'PAID')).toThrow(/Cannot transition eClaim/);

    expect(canTransitionPreauthStatus('DRAFT', 'PENDING')).toBe(true);
    expect(canTransitionPreauthStatus('CANCELLED', 'APPROVED')).toBe(false);

    const unit = requireMoneyCents('1234.56', 'unit');
    expect(unit).toBe(123456);
    expect(formatCents(multiplyMoneyCents(unit, 3))).toBe('3703.68');
    expect(parseFacilityLevelRank('Level 4')).toBe(4);
  });
});

describe('5. RBAC Policy, Webhook Secret Guard & Express Route Surface (Mocked Unit)', () => {
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    const { createApp } = await import('../../app.ts');
    const app = await createApp();
    server = await new Promise<Server>((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });
    const addr = server.address();
    if (addr && typeof addr === 'object') {
      baseUrl = `http://127.0.0.1:${addr.port}`;
    }
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });

  it('seeds all 11 granular insurance.sha.* permissions and protects configuration from custom-role self-delegation', () => {
    const seedSource = readFileSync(resolve(process.cwd(), 'src/seeds/permissions.ts'), 'utf8');
    const expectedCodes = [
      'insurance.sha.read',
      'insurance.sha.eligibility.check',
      'insurance.sha.benefits.validate',
      'insurance.sha.preauthorization.create',
      'insurance.sha.claims.read',
      'insurance.sha.claims.prepare',
      'insurance.sha.claims.submit',
      'insurance.sha.claims.resubmit',
      'insurance.sha.remittance.read',
      'insurance.sha.reconciliation.manage',
      'insurance.sha.configuration.manage',
    ];
    for (const code of expectedCodes) {
      expect(seedSource).toContain(`'${code}'`);
    }

    expect(
      isDelegablePermission({ code: 'insurance.sha.eligibility.check', module: 'insurance' }),
    ).toBe(true);
    expect(
      isDelegablePermission({ code: 'insurance.sha.claims.prepare', module: 'insurance' }),
    ).toBe(true);
    expect(
      isDelegablePermission({ code: 'insurance.sha.configuration.manage', module: 'insurance' }),
    ).toBe(false);
    expect(isRestrictedRolePermission({ code: 'insurance.sha.read', module: 'insurance' })).toBe(
      false,
    );
  });

  it('protects every /api/insurance/sha/* endpoint behind authentication (401 when unauthenticated)', async () => {
    const protectedEndpoints: Array<[string, string]> = [
      ['GET', '/api/insurance/sha/connection-status'],
      ['POST', '/api/insurance/sha/registry/patient-search'],
      ['POST', '/api/insurance/sha/eligibility/check'],
      ['GET', '/api/insurance/sha/eligibility/1'],
      ['GET', '/api/insurance/sha/patients/1/eligibility-history'],
      ['POST', '/api/insurance/sha/benefits/validate'],
      ['POST', '/api/insurance/sha/benefits/hie-lookup'],
      ['GET', '/api/insurance/sha/patients/1/benefits'],
      ['GET', '/api/insurance/sha/authorizations'],
      ['POST', '/api/insurance/sha/authorizations/consent'],
      ['POST', '/api/insurance/sha/preauthorizations'],
      ['PATCH', '/api/insurance/sha/preauthorizations/1'],
      ['POST', '/api/insurance/sha/preauthorizations/1/submit'],
      ['GET', '/api/insurance/sha/preauthorizations/1/status'],
      ['POST', '/api/insurance/sha/preauthorizations/1/cancel'],
      ['GET', '/api/insurance/sha/claims'],
      ['POST', '/api/insurance/sha/claims/prepare'],
      ['GET', '/api/insurance/sha/claims/1'],
      ['POST', '/api/insurance/sha/claims/1/validate'],
      ['POST', '/api/insurance/sha/claims/1/submit'],
      ['POST', '/api/insurance/sha/claims/1/resubmit'],
      ['GET', '/api/insurance/sha/claims/1/status'],
      ['GET', '/api/insurance/sha/remittances'],
      ['POST', '/api/insurance/sha/remittances/sync'],
      ['GET', '/api/insurance/sha/remittances/1/claims'],
      ['POST', '/api/insurance/sha/remittances/1/reconcile'],
      ['POST', '/api/insurance/sha/callbacks/register'],
      ['GET', '/api/insurance/sha/callbacks'],
      ['GET', '/api/insurance/sha/operational-report'],
    ];

    for (const [method, path] of protectedEndpoints) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : undefined,
        body: method !== 'GET' ? JSON.stringify({}) : undefined,
      });
      expect(res.status, `${method} ${path} must require authentication`).toBe(401);
    }
  });

  it('refuses /api/webhooks/sha/status with 503 when SHA_WEBHOOK_SECRET is unset and 401 when credentials are invalid', async () => {
    delete process.env.SHA_WEBHOOK_SECRET;
    const unconfiguredRes = await fetch(`${baseUrl}/api/webhooks/sha/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: 'claim', entity_id: 'CLM-1' }),
    });
    expect(unconfiguredRes.status).toBe(503);

    process.env.SHA_WEBHOOK_SECRET = SYNTHETIC_WEBHOOK_SECRET;
    const unauthorizedRes = await fetch(`${baseUrl}/api/webhooks/sha/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-secret-token',
      },
      body: JSON.stringify({ entity_type: 'claim', entity_id: 'CLM-1' }),
    });
    expect(unauthorizedRes.status).toBe(401);
  });
});
