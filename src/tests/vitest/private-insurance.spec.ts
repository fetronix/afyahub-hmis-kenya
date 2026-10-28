/**
 * JaliCare HMIS — Private Insurance Multi-Payer Module (Britam & PACIS First)
 * Unit, Adapter, Financial, Validation, Security & SmartLink Fixture Suite
 */

import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDelegablePermission, isRestrictedRolePermission } from '../../auth/staff-role-policy.ts';
import {
  canTransitionPrivateClaimStatus,
  canTransitionPrivatePreauthStatus,
  computeBenefitFinancialsCents,
  inferPrivateServiceCategory,
  moneyToCentsStrict,
  PrivateInsuranceError,
  type PayerRuntimeConfig,
} from '../../insurance/core/types.ts';
import {
  getPayerAdapter,
  inspectSecretEnvPresence,
  isSecureHttpsEndpoint,
  listRegisteredPayerAdapters,
} from '../../insurance/core/adapter-registry.ts';
import { sanitizeAuditMetadata } from '../../insurance/audit/diagnostics.service.ts';
import { BritamInsuranceAdapter } from '../../insurance/payers/britam.adapter.ts';
import { PacisInsuranceAdapter } from '../../insurance/payers/pacis.adapter.ts';
import {
  interpretSmartLinkEligibilityPayload,
  SMARTLINK_DOCUMENTED_OPERATIONS,
  SmartLinkGatewayAdapter,
} from '../../insurance/payers/smartlink.adapter.ts';
import {
  ManualFilePayerAdapter,
  ShaPayerBridgeAdapter,
} from '../../insurance/payers/manual.adapter.ts';
import { evaluatePrivateClaimValidation } from '../../insurance/claims/private-claims.service.ts';
import { isEffectiveOnDate } from '../../insurance/mappings/mappings.service.ts';
import {
  serializePayerConfig,
  toPayerRuntimeConfig,
} from '../../insurance/payers/payer-config.service.ts';

function makeRuntimeConfig(overrides: Partial<PayerRuntimeConfig> = {}): PayerRuntimeConfig {
  return {
    payerId: 1,
    tenantId: 10,
    facilityId: 20,
    payerCode: 'BRITAM',
    payerName: 'Britam Insurance Kenya',
    payerType: 'PRIVATE',
    isActive: true,
    integrationType: 'MANUAL',
    adapterKey: 'britam_direct',
    gatewayProvider: null,
    environment: 'UNCONFIGURED',
    connectionStatus: 'AWAITING_DOCUMENTATION',
    apiBaseUrl: null,
    authMethod: 'NONE',
    secretEnvPrefix: 'TEST_BRITAM_SPEC',
    providerIdentifier: null,
    defaultCodingSystem: 'ICD-10',
    requireVerifiedEligibility: true,
    eligibilityMaxAgeHours: 24,
    claimRequirements: {
      requireMemberNumber: true,
      requireDiagnosis: true,
      requireSignedClaimForm: true,
    },
    preauthRequirements: {
      requirePreauthForImaging: true,
    },
    ...overrides,
  };
}

describe('Private Insurance multi-payer adapter registry & Britam/PACIS separation', () => {
  it('registers independent Britam, PACIS, SmartLink gateway, Manual, and SHA adapters', () => {
    const adapters = listRegisteredPayerAdapters();
    const keys = adapters.map((a) => a.adapterKey);

    expect(keys).toContain('britam_direct');
    expect(keys).toContain('pacis_direct');
    expect(keys).toContain('smartlink_gateway');
    expect(keys).toContain('manual');
    expect(keys).toContain('sha_afyalink');

    const smartlink = adapters.find((a) => a.adapterKey === 'smartlink_gateway');
    const britam = adapters.find((a) => a.adapterKey === 'britam_direct');
    const pacis = adapters.find((a) => a.adapterKey === 'pacis_direct');

    expect(smartlink?.isGatewayAdapter).toBe(true);
    expect(britam?.isGatewayAdapter).toBe(false);
    expect(pacis?.isGatewayAdapter).toBe(false);
  });

  it('defaults unprovisioned Britam and PACIS direct adapters to honest AWAITING_DOCUMENTATION and CAPABILITY_UNAVAILABLE without inventing URLs or fake approvals', async () => {
    const britamAdapter = new BritamInsuranceAdapter();
    const pacisAdapter = new PacisInsuranceAdapter();

    const britamCfg = makeRuntimeConfig({
      payerCode: 'BRITAM',
      integrationType: 'DIRECT_API',
      adapterKey: 'britam_direct',
    });
    const pacisCfg = makeRuntimeConfig({
      payerCode: 'PACIS',
      payerName: 'PACIS Insurance Company Ltd',
      integrationType: 'DIRECT_API',
      adapterKey: 'pacis_direct',
      secretEnvPrefix: 'TEST_PACIS_SPEC',
    });

    const emptySecrets = inspectSecretEnvPresence('TEST_BRITAM_SPEC', 'NONE', {});

    const britamProbe = await britamAdapter.probeConnection(britamCfg, emptySecrets);
    const pacisProbe = await pacisAdapter.probeConnection(pacisCfg, emptySecrets);

    expect(britamProbe.verified).toBe(false);
    expect(['NOT_CONFIGURED', 'AWAITING_DOCUMENTATION']).toContain(britamProbe.connectionStatus);
    expect(pacisProbe.verified).toBe(false);
    expect(['NOT_CONFIGURED', 'AWAITING_DOCUMENTATION']).toContain(pacisProbe.connectionStatus);

    const britamElig = await britamAdapter.verifyEligibility(
      {
        correlationId: 'corr-1',
        payer: britamCfg,
        memberNumber: 'BRM-1001',
        serviceDate: '2026-10-28',
      },
      emptySecrets,
    );
    expect(britamElig.supported).toBe(false);
    if (!britamElig.supported) {
      expect(britamElig.requiredFromInsurer.length).toBeGreaterThan(0);
    }

    const pacisPreauth = await pacisAdapter.submitPreauthorization(
      {
        correlationId: 'corr-2',
        payer: pacisCfg,
        preauthNumber: 'PA-PACIS-20261028-0001',
        memberNumber: 'PAC-2002',
        clinicalIndication: 'Appendicitis',
        diagnosisCode: 'K35.80',
        diagnosisDisplay: 'Acute appendicitis',
        codingSystem: 'ICD-10',
        requestedItems: [
          {
            payerServiceCode: 'SURG-01',
            serviceName: 'Appendectomy',
            quantity: 1,
            unitPrice: '45000.00',
            estimatedTotal: '45000.00',
          },
        ],
        estimatedAmount: '45000.00',
      },
      emptySecrets,
    );
    expect(pacisPreauth.supported).toBe(false);

    const britamClaim = await britamAdapter.submitClaim(
      {
        correlationId: 'corr-3',
        payer: britamCfg,
        claimNumber: 'CLM-BRITAM-20261028-0001',
        idempotencyKey: 'idem-corr-3',
        memberNumber: 'BRM-1001',
        encounterType: 'OPD',
        serviceDateStart: '2026-10-28',
        serviceDateEnd: '2026-10-28',
        currency: 'KES',
        grossAmount: '2500.00',
        discountAmount: '0.00',
        copayAmount: '500.00',
        proposedClaimAmount: '2000.00',
        diagnoses: [{ code: 'J06.9', display: 'URI', system: 'ICD-10', type: 'PRIMARY' }],
        lines: [],
      },
      emptySecrets,
    );
    expect(britamClaim.supported).toBe(false);
  });

  it('supports internal manual / portal workflow adapter without claiming live API verification', async () => {
    const manualAdapter = new ManualFilePayerAdapter();
    const cfg = makeRuntimeConfig({ adapterKey: 'manual', integrationType: 'MANUAL' });
    const emptySecrets = inspectSecretEnvPresence(null, 'NONE', {});
    const probe = await manualAdapter.probeConnection(cfg, emptySecrets);
    expect(probe.verified).toBe(false);

    const elig = await manualAdapter.verifyEligibility({
      correlationId: 'corr-man',
      payer: cfg,
      memberNumber: 'BRM-99',
      serviceDate: '2026-10-28',
    });
    expect(elig.supported).toBe(false);
  });
});

describe('SmartLink Third-Party Gateway adapter & malformed/timeout resilience', () => {
  it('supports all 11 SmartLink workflow capabilities only when explicitly configured as THIRD_PARTY_GATEWAY and classifies 503/malformed responses safely', async () => {
    let mode: 'healthy' | 'timeout_503' | 'malformed' = 'healthy';

    const adapter = new SmartLinkGatewayAdapter({
      async verifyMemberSession() {
        if (mode === 'timeout_503') {
          return { httpStatus: 503, body: { error: 'Service Unavailable' }, durationMs: 120 };
        }
        if (mode === 'malformed') {
          return { httpStatus: 200, body: '<<<not-an-object>>>', durationMs: 35 };
        }
        return {
          httpStatus: 200,
          body: {
            eligible: true,
            referenceNumber: 'SL-REF-7788',
            visitSessionId: 'SL-SESS-99',
            planName: 'Corporate Gold',
          },
          durationMs: 40,
        };
      },
      async submitPreauth() {
        return {
          httpStatus: 200,
          body: { status: 'APPROVED', authorizationNumber: 'SL-PA-101', approvedAmount: '8500.00' },
          durationMs: 45,
        };
      },
      async submitClaim() {
        return {
          httpStatus: 200,
          body: { status: 'ACKNOWLEDGED', claimReference: 'SL-CLM-505' },
          durationMs: 50,
        };
      },
      async fetchClaimStatus() {
        return {
          httpStatus: 200,
          body: { status: 'ADJUDICATED', approvedAmount: '2000.00' },
          durationMs: 30,
        };
      },
    });

    const slCfg = makeRuntimeConfig({
      payerCode: 'BRITAM',
      integrationType: 'THIRD_PARTY_GATEWAY',
      adapterKey: 'smartlink_gateway',
      gatewayProvider: 'SmartLink',
      environment: 'SANDBOX',
      apiBaseUrl: 'https://sandbox-gateway.example.test',
      authMethod: 'OAUTH2_CLIENT_CREDENTIALS',
      secretEnvPrefix: 'TEST_SL_SPEC',
      providerIdentifier: 'HOSP-NYERI-01',
    });

    const presentSecrets = inspectSecretEnvPresence('TEST_SL_SPEC', 'OAUTH2_CLIENT_CREDENTIALS', {
      TEST_SL_SPEC_CLIENT_ID: 'synthetic-sl-client',
      TEST_SL_SPEC_CLIENT_SECRET: 'synthetic-sl-secret',
    });
    expect(presentSecrets.allRequiredSecretsPresent).toBe(true);

    const caps = adapter.getCapabilities(slCfg, presentSecrets);
    const supportedCaps = caps.filter((c) => c.supportedByContract);
    expect(supportedCaps).toHaveLength(SMARTLINK_DOCUMENTED_OPERATIONS.length);
    expect(supportedCaps.every((c) => c.readyInCurrentConfig)).toBe(true);

    const okElig = await adapter.verifyEligibility(
      {
        correlationId: 'sl-corr-1',
        payer: slCfg,
        memberNumber: 'BRM-SL-100',
        serviceDate: '2026-10-28',
      },
      presentSecrets,
    );
    expect(okElig.supported).toBe(true);
    if (okElig.supported) {
      expect(okElig.outcome).toBe('Eligible');
      expect(okElig.visitSessionRef).toBe('SL-SESS-99');
    }

    // Upstream 503 must map to 'Unable to verify' (UPSTREAM_UNAVAILABLE), NEVER 'Ineligible'
    mode = 'timeout_503';
    const downElig = await adapter.verifyEligibility(
      {
        correlationId: 'sl-corr-2',
        payer: slCfg,
        memberNumber: 'BRM-SL-100',
        serviceDate: '2026-10-28',
      },
      presentSecrets,
    );
    expect(downElig.supported).toBe(true);
    if (downElig.supported) {
      expect(downElig.outcome).toBe('Unable to verify');
      expect(downElig.responseClassification).toBe('UPSTREAM_UNAVAILABLE');
    }

    // Malformed payload must map to 'Unable to verify' (MALFORMED_RESPONSE), NEVER crash
    mode = 'malformed';
    const badJsonElig = await adapter.verifyEligibility(
      {
        correlationId: 'sl-corr-3',
        payer: slCfg,
        memberNumber: 'BRM-SL-100',
        serviceDate: '2026-10-28',
      },
      presentSecrets,
    );
    expect(badJsonElig.supported).toBe(true);
    if (badJsonElig.supported) {
      expect(badJsonElig.outcome).toBe('Unable to verify');
      expect(badJsonElig.responseClassification).toBe('MALFORMED_RESPONSE');
    }
  });
});

describe('Decimal-safe benefit, copayment, deductible, and claim validation logic', () => {
  it('computes fixed copay, percentage copay, deductible, and per-visit caps accurately in integer cents', () => {
    const fixed = computeBenefitFinancialsCents({
      unitAmountKes: '2500.00',
      quantity: 1,
      copayType: 'FIXED',
      copayValueKesOrPercent: '500.00',
      deductibleAmountKes: '0.00',
      coinsurancePercent: '0.00',
    });
    expect(fixed.copayCents).toBe(50000);
    expect(fixed.estimatedClaimableCents).toBe(200000);
    expect(fixed.patientContributionCents).toBe(50000);

    const pctWithCap = computeBenefitFinancialsCents({
      unitAmountKes: '10000.00',
      quantity: 1,
      copayType: 'PERCENTAGE',
      copayValueKesOrPercent: '10',
      deductibleAmountKes: '1000.00',
      coinsurancePercent: '0.00',
      perVisitLimitKes: '7000.00',
    });
    expect(pctWithCap.deductibleCents).toBe(100_000);
    expect(pctWithCap.copayCents).toBe(90_000);
    expect(pctWithCap.estimatedClaimableCents).toBe(700_000);
    expect(pctWithCap.patientContributionCents).toBe(300_000);
    expect(pctWithCap.cappedByLimit).toBe(true);
  });

  it('enforces effective date windows and category inference across all hospital departments', () => {
    expect(isEffectiveOnDate('2026-01-01', '2026-12-31', '2026-10-28')).toBe(true);
    expect(isEffectiveOnDate('2027-01-01', null, '2026-10-28')).toBe(false);
    expect(inferPrivateServiceCategory('Radiology CT')).toBe('IMAGING');
    expect(inferPrivateServiceCategory('Pharmacy Dispense')).toBe('PHARMACY');
    expect(inferPrivateServiceCategory('Inpatient General Ward Bed')).toBe('INPATIENT_BED');
  });

  it('catches unmapped codes, missing diagnoses, missing preauth, missing attachments, and duplicate claims before submission', () => {
    const issues = evaluatePrivateClaimValidation({
      payerCode: 'BRITAM',
      memberStatus: 'ACTIVE',
      memberNumber: 'BRM-100',
      policyNumber: 'POL-100',
      policyValidFrom: '2026-01-01',
      policyValidTo: '2026-12-31',
      requireVerifiedEligibility: true,
      eligibilityOutcome: null,
      serviceDateStart: '2026-10-28',
      serviceDateEnd: '2026-10-28',
      encounterType: 'OPD',
      currency: 'KES',
      diagnoses: [],
      attachments: [],
      claimRequirements: {
        requireMemberNumber: true,
        requireDiagnosis: true,
        requireSignedClaimForm: true,
      },
      preauthRequirements: {
        requirePreauthForImaging: true,
      },
      preauthStatus: null,
      preauthReference: null,
      hasDuplicateActiveClaim: true,
      grossCents: 500000,
      discountCents: 0,
      copayCents: 50000,
      proposedClaimCents: 450000,
      lines: [
        {
          lineNumber: 1,
          itemDescription: 'CT Scan Chest',
          serviceCategory: 'IMAGING',
          mappingStatus: 'UNMAPPED',
          payerServiceCode: null,
          requiresPreauth: true,
          grossCents: 500000,
          discountCents: 0,
          copayCents: 50000,
          proposedClaimCents: 450000,
        },
      ],
    });

    const errorIssues = issues.filter((i) => i.severity === 'ERROR');
    expect(errorIssues.length).toBeGreaterThanOrEqual(5);
    const codes = errorIssues.map((i) => i.code);
    expect(codes).toContain('DUPLICATE_ACTIVE_CLAIM');
    expect(codes).toContain('MISSING_CONFIRMED_ELIGIBILITY');
    expect(codes).toContain('MISSING_CLINICAL_DIAGNOSIS');
    expect(codes).toContain('UNMAPPED_SERVICE_LINE');
    expect(codes).toContain('MISSING_APPROVED_PREAUTHORIZATION');
    expect(codes).toContain('MISSING_SIGNED_CLAIM_FORM');
  });

  it('enforces legal preauthorization and claim state transitions and scrubs secrets from audit metadata', () => {
    expect(canTransitionPrivatePreauthStatus('DRAFT', 'REQUESTED')).toBe(true);
    expect(canTransitionPrivatePreauthStatus('CANCELLED', 'APPROVED')).toBe(false);
    expect(canTransitionPrivatePreauthStatus('EXPIRED', 'APPROVED')).toBe(false);
    expect(canTransitionPrivateClaimStatus('READY', 'SUBMITTED')).toBe(true);
    expect(canTransitionPrivateClaimStatus('DRAFT', 'PAID')).toBe(false);
    expect(canTransitionPrivateClaimStatus('REJECTED', 'READY')).toBe(true);

    const scrubbed = sanitizeAuditMetadata({
      payerCode: 'BRITAM',
      client_secret: 'myTopSecret123',
      nested: { bearerToken: 'eyJhbGciOiJIUzI1NiJ9', safeField: 'OK' },
    });
    expect(scrubbed.client_secret).toBe('[REDACTED]');
    expect((scrubbed.nested as Record<string, unknown>).bearerToken).toBe('[REDACTED]');
    expect((scrubbed.nested as Record<string, unknown>).safeField).toBe('OK');

    const envPresence = inspectSecretEnvPresence('NON_EXISTENT_PREFIX_XYZ', 'API_KEY_HEADER', {});
    expect(envPresence.allRequiredSecretsPresent).toBe(false);
  });

  it('exercises full adapter operations, SHA bridge, HTTPS enforcement, config serialization, and all validation branches', async () => {
    expect(isSecureHttpsEndpoint('https://api.example.test/v1')).toBe(true);
    expect(isSecureHttpsEndpoint('http://insecure.example.test')).toBe(false);
    expect(isSecureHttpsEndpoint(null)).toBe(false);
    expect(getPayerAdapter('britam_direct')?.adapterKey).toBe('britam_direct');
    expect(getPayerAdapter('unknown_adapter')).toBeUndefined();

    expect(moneyToCentsStrict('125.50', 'amount')).toBe(12550);
    expect(() => moneyToCentsStrict('-10', 'amount')).toThrow(PrivateInsuranceError);
    expect(() => moneyToCentsStrict('abc', 'amount')).toThrow(PrivateInsuranceError);

    // SHA Bridge & Manual adapters full method surface
    const shaBridge = new ShaPayerBridgeAdapter();
    const manualAdapter = new ManualFilePayerAdapter();
    const emptySecrets = inspectSecretEnvPresence(null, 'NONE', {});
    const manualCfg = makeRuntimeConfig({ adapterKey: 'manual', integrationType: 'FILE_EXPORT' });
    const shaCfg = makeRuntimeConfig({
      payerCode: 'SHA',
      payerType: 'PUBLIC',
      adapterKey: 'sha_afyalink',
      integrationType: 'THIRD_PARTY_GATEWAY',
    });

    expect(manualAdapter.getRequiredOnboardingChecklist(manualCfg)).toBeDefined();
    expect(manualAdapter.getCapabilities(manualCfg, emptySecrets).length).toBeGreaterThan(0);
    expect(
      (
        await manualAdapter.submitPreauthorization({
          correlationId: 'm-pa',
          payer: manualCfg,
          preauthNumber: 'PA-1',
          memberNumber: 'M-1',
          clinicalIndication: 'Test',
          diagnosisCode: 'J06.9',
          diagnosisDisplay: 'URI',
          codingSystem: 'ICD-10',
          requestedItems: [],
          estimatedAmount: '1000.00',
        })
      ).supported,
    ).toBe(false);
    expect(
      (
        await manualAdapter.submitClaim({
          correlationId: 'm-clm',
          payer: manualCfg,
          claimNumber: 'CLM-1',
          idempotencyKey: 'ik-1',
          memberNumber: 'M-1',
          encounterType: 'OPD',
          serviceDateStart: '2026-10-28',
          serviceDateEnd: '2026-10-28',
          currency: 'KES',
          grossAmount: '1000.00',
          discountAmount: '0.00',
          copayAmount: '0.00',
          proposedClaimAmount: '1000.00',
          diagnoses: [],
          lines: [],
        })
      ).supported,
    ).toBe(false);
    expect((await manualAdapter.queryClaimStatus(manualCfg)).supported).toBe(false);

    expect(shaBridge.getRequiredOnboardingChecklist().length).toBeGreaterThanOrEqual(0);
    expect(shaBridge.getCapabilities().length).toBeGreaterThan(0);
    expect((await shaBridge.probeConnection()).connectionStatus).toBeDefined();
    expect(
      (
        await shaBridge.verifyEligibility({
          correlationId: 'sha-1',
          payer: shaCfg,
          memberNumber: 'SHA-1',
          serviceDate: '2026-10-28',
        })
      ).supported,
    ).toBe(false);
    expect(
      (
        await shaBridge.submitPreauthorization({
          correlationId: 'sha-pa',
          payer: shaCfg,
          preauthNumber: 'PA-SHA',
          memberNumber: 'SHA-1',
          clinicalIndication: 'Ind',
          diagnosisCode: 'A00',
          diagnosisDisplay: 'Test',
          codingSystem: 'ICD-11',
          requestedItems: [],
          estimatedAmount: '500.00',
        })
      ).supported,
    ).toBe(false);
    expect(
      (
        await shaBridge.submitClaim({
          correlationId: 'sha-clm',
          payer: shaCfg,
          claimNumber: 'CLM-SHA',
          idempotencyKey: 'ik-sha',
          memberNumber: 'SHA-1',
          encounterType: 'OPD',
          serviceDateStart: '2026-10-28',
          serviceDateEnd: '2026-10-28',
          currency: 'KES',
          grossAmount: '500.00',
          discountAmount: '0.00',
          copayAmount: '0.00',
          proposedClaimAmount: '500.00',
          diagnoses: [],
          lines: [],
        })
      ).supported,
    ).toBe(false);
    expect((await shaBridge.queryClaimStatus(shaCfg)).supported).toBe(false);

    // Britam & PACIS capabilities, checklists, status queries & HTTPS probe paths
    const britam = new BritamInsuranceAdapter();
    const pacis = new PacisInsuranceAdapter();
    const britamUrlCfg = makeRuntimeConfig({
      payerCode: 'BRITAM',
      integrationType: 'DIRECT_API',
      adapterKey: 'britam_direct',
      apiBaseUrl: 'https://britam-uat.example.test',
      authMethod: 'OAUTH2_CLIENT_CREDENTIALS',
      providerIdentifier: 'BRM-PROV-1',
    });
    const pacisUrlCfg = makeRuntimeConfig({
      payerCode: 'PACIS',
      integrationType: 'DIRECT_API',
      adapterKey: 'pacis_direct',
      apiBaseUrl: 'https://pacis-uat.example.test',
      authMethod: 'API_KEY_HEADER',
      providerIdentifier: 'PAC-PROV-1',
    });
    const fullSecrets = inspectSecretEnvPresence('TEST_X', 'OAUTH2_CLIENT_CREDENTIALS', {
      TEST_X_CLIENT_ID: 'id',
      TEST_X_CLIENT_SECRET: 'sec',
      TEST_X_API_KEY: 'key',
    });

    expect(britam.getRequiredOnboardingChecklist(britamUrlCfg).length).toBeGreaterThan(0);
    expect(britam.getCapabilities(britamUrlCfg, fullSecrets).length).toBeGreaterThan(0);
    expect((await britam.probeConnection(britamUrlCfg, fullSecrets)).connectionStatus).toBe(
      'AWAITING_DOCUMENTATION',
    );
    expect((await britam.queryClaimStatus(britamUrlCfg, 'REF', 'c-3', fullSecrets)).supported).toBe(
      false,
    );

    expect(pacis.getRequiredOnboardingChecklist(pacisUrlCfg).length).toBeGreaterThan(0);
    expect(pacis.getCapabilities(pacisUrlCfg, fullSecrets).length).toBeGreaterThan(0);
    expect((await pacis.probeConnection(pacisUrlCfg, fullSecrets)).connectionStatus).toBe(
      'AWAITING_DOCUMENTATION',
    );
    expect((await pacis.queryClaimStatus(pacisUrlCfg, 'REF', 'c-4', fullSecrets)).supported).toBe(
      false,
    );

    // SmartLink payload parser & preauth/claim/status/probe methods
    expect(
      interpretSmartLinkEligibilityPayload({ eligible: false, reason: 'Policy lapsed' }, 200, 15)
        .outcome,
    ).toBe('Ineligible');
    expect(interpretSmartLinkEligibilityPayload({ status: 'PENDING' }, 200, 15).outcome).toBe(
      'Pending',
    );
    expect(interpretSmartLinkEligibilityPayload({ status: 'UNKNOWN' }, 200, 15).outcome).toBe(
      'Unable to verify',
    );

    const slAdapter = new SmartLinkGatewayAdapter({
      async verifyMemberSession() {
        return { httpStatus: 200, body: { eligible: true }, durationMs: 10 };
      },
      async submitPreauth() {
        return {
          httpStatus: 200,
          body: {
            status: 'APPROVED',
            authorizationNumber: 'SL-AUTH-9',
            approvedAmount: '4000.00',
          },
          durationMs: 20,
        };
      },
      async submitClaim() {
        return {
          httpStatus: 200,
          body: { status: 'ACKNOWLEDGED', claimReference: 'SL-CLM-9' },
          durationMs: 25,
        };
      },
      async fetchClaimStatus() {
        return {
          httpStatus: 200,
          body: { status: 'PAID', approvedAmount: '4000.00', paidAmount: '4000.00' },
          durationMs: 15,
        };
      },
      async probeHealth() {
        return { httpStatus: 200, body: { healthy: true }, durationMs: 12 };
      },
    });

    const slReadyCfg = makeRuntimeConfig({
      payerCode: 'BRITAM',
      integrationType: 'THIRD_PARTY_GATEWAY',
      adapterKey: 'smartlink_gateway',
      gatewayProvider: 'SmartLink',
      environment: 'SANDBOX',
      apiBaseUrl: 'https://sl.example.test',
      authMethod: 'OAUTH2_CLIENT_CREDENTIALS',
      providerIdentifier: 'PROV-1',
    });

    expect(slAdapter.getRequiredOnboardingChecklist(slReadyCfg)).toBeDefined();
    const slProbe = await slAdapter.probeConnection(slReadyCfg, fullSecrets);
    expect(slProbe.verified).toBe(true);

    const slPa = await slAdapter.submitPreauthorization(
      {
        correlationId: 'sl-pa-1',
        payer: slReadyCfg,
        preauthNumber: 'PA-SL-1',
        memberNumber: 'M-1',
        clinicalIndication: 'Test',
        diagnosisCode: 'J06.9',
        diagnosisDisplay: 'URI',
        codingSystem: 'ICD-10',
        requestedItems: [],
        estimatedAmount: '4000.00',
      },
      fullSecrets,
    );
    expect(slPa.supported).toBe(true);

    const slClm = await slAdapter.submitClaim(
      {
        correlationId: 'sl-clm-1',
        payer: slReadyCfg,
        claimNumber: 'CLM-SL-1',
        idempotencyKey: 'ik-sl-1',
        memberNumber: 'M-1',
        encounterType: 'OPD',
        serviceDateStart: '2026-10-28',
        serviceDateEnd: '2026-10-28',
        currency: 'KES',
        grossAmount: '4000.00',
        discountAmount: '0.00',
        copayAmount: '0.00',
        proposedClaimAmount: '4000.00',
        diagnoses: [{ code: 'J06.9', display: 'URI', system: 'ICD-10', type: 'PRIMARY' }],
        lines: [],
      },
      fullSecrets,
    );
    expect(slClm.supported).toBe(true);

    const slStat = await slAdapter.queryClaimStatus(slReadyCfg, 'SL-CLM-9', 'c-sl', fullSecrets);
    expect(slStat.supported).toBe(true);

    // Payer config serialization redacts secrets and maps runtime fields
    const fakeRow = {
      id: 77,
      tenantId: 1,
      facilityId: 2,
      payerCode: 'BRITAM',
      payerName: 'Britam Insurance Kenya',
      payerType: 'PRIVATE',
      integrationType: 'MANUAL',
      adapterKey: 'britam_direct',
      gatewayProvider: null,
      environment: 'UNCONFIGURED',
      connectionStatus: 'AWAITING_DOCUMENTATION',
      apiBaseUrl: null,
      authMethod: 'NONE',
      secretEnvPrefix: 'BRITAM_API',
      providerIdentifier: 'PROV-77',
      facilityRegistryCode: null,
      accreditationLevel: null,
      contractedSchemes: ['CORP'],
      defaultCodingSystem: 'ICD-10',
      requireVerifiedEligibility: true,
      eligibilityMaxAgeHours: 24,
      supportedOperations: [],
      claimRequirements: { requireMemberNumber: true },
      preauthRequirements: { requirePreauthForImaging: true },
      missingRequirements: [],
      lastConnectionCheckAt: null,
      lastConnectionSummary: null,
      isActive: true,
      notes: null,
      updatedByUserId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    process.env.BRITAM_API_CLIENT_SECRET = 'SuperSecretValueDoNotLeak999';
    try {
      const runtime = toPayerRuntimeConfig(fakeRow);
      expect(runtime.payerCode).toBe('BRITAM');
      const serialized = serializePayerConfig(fakeRow);
      expect(serialized.secretReference.envPrefix).toBe('BRITAM_API');
      expect(serialized.secretReference.hasClientSecret).toBe(true);
      expect(JSON.stringify(serialized)).not.toContain('SuperSecretValueDoNotLeak999');
    } finally {
      delete process.env.BRITAM_API_CLIENT_SECRET;
    }

    // Additional validation edge branches (expired policy, bad date range, math mismatch, coinsurance)
    const coins = computeBenefitFinancialsCents({
      unitAmountKes: '5000.00',
      quantity: 2,
      discountAmountKes: '1000.00',
      copayType: 'NONE',
      coinsurancePercent: '20',
      annualLimitRemainingKes: '6000.00',
    });
    expect(coins.cappedByLimit).toBe(true);
    expect(coins.estimatedClaimableCents).toBe(600_000);

    const edgeIssues = evaluatePrivateClaimValidation({
      payerCode: 'PACIS',
      memberStatus: 'EXPIRED',
      memberNumber: '',
      policyNumber: '',
      policyValidFrom: '2026-05-01',
      policyValidTo: '2026-06-01',
      requireVerifiedEligibility: false,
      eligibilityOutcome: 'Eligible',
      serviceDateStart: '2026-07-10',
      serviceDateEnd: '2026-07-01',
      encounterType: 'IPD',
      currency: 'USD',
      diagnoses: [{ code: 'J00', display: 'Cold', system: 'SNOMED' }],
      attachments: [],
      claimRequirements: {
        requirePolicyNumber: true,
        requireInvoiceAttachment: true,
        maxSubmissionDays: 30,
        allowedCodingSystems: ['ICD-10'],
      },
      preauthRequirements: {
        requirePreauthForInpatient: true,
        amountThresholdKes: 1000,
      },
      preauthStatus: 'APPROVED',
      preauthReference: 'PAC-AUTH-1',
      hasDuplicateActiveClaim: false,
      grossCents: 200000,
      discountCents: 0,
      copayCents: 0,
      proposedClaimCents: 0,
      lines: [
        {
          lineNumber: 1,
          itemDescription: 'Ward Bed',
          serviceCategory: 'INPATIENT_BED',
          mappingStatus: 'MAPPED',
          payerServiceCode: 'PAC-BED',
          requiresPreauth: false,
          grossCents: 100000,
          discountCents: 0,
          copayCents: 0,
          proposedClaimCents: 50000,
        },
      ],
      nowIsoDate: '2026-10-28',
    });
    const edgeCodes = edgeIssues.map((i) => i.code);
    expect(edgeCodes).toContain('INACTIVE_MEMBER_POLICY');
    expect(edgeCodes).toContain('MISSING_MEMBER_NUMBER');
    expect(edgeCodes).toContain('MISSING_POLICY_NUMBER');
    expect(edgeCodes).toContain('SERVICE_AFTER_POLICY_EXPIRY');
    expect(edgeCodes).toContain('INVALID_SERVICE_DATE_RANGE');
    expect(edgeCodes).toContain('LATE_CLAIM_SUBMISSION_WINDOW');
    expect(edgeCodes).toContain('UNSUPPORTED_DIAGNOSIS_CODING_SYSTEM');
    expect(edgeCodes).toContain('UNSUPPORTED_CURRENCY');
    expect(edgeCodes).toContain('LINE_CALCULATION_MISMATCH');
    expect(edgeCodes).toContain('CLAIM_HEADER_TOTAL_MISMATCH');
    expect(edgeCodes).toContain('ZERO_OR_NEGATIVE_CLAIM_AMOUNT');
    expect(edgeCodes).toContain('MISSING_INVOICE_ATTACHMENT');
  });
});

describe('RBAC permissions & Express /api/insurance/* route security', () => {
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

  it('seeds all 11 Private Insurance RBAC permissions and restricts payer/mapping governance to admins', () => {
    const seedSource = readFileSync(resolve(process.cwd(), 'src/seeds/permissions.ts'), 'utf8');
    const expectedCodes = [
      'insurance.payers.read',
      'insurance.payers.manage',
      'insurance.members.read',
      'insurance.members.manage',
      'insurance.eligibility.check',
      'insurance.benefits.validate',
      'insurance.mappings.manage',
      'insurance.preauthorization.manage',
      'insurance.private.claims.prepare',
      'insurance.private.claims.submit',
      'insurance.private.remittance.reconcile',
    ];
    for (const code of expectedCodes) {
      expect(seedSource).toContain(`'${code}'`);
    }

    expect(
      isDelegablePermission({ code: 'insurance.eligibility.check', module: 'insurance' }),
    ).toBe(true);
    expect(
      isDelegablePermission({ code: 'insurance.private.claims.prepare', module: 'insurance' }),
    ).toBe(true);
    expect(isDelegablePermission({ code: 'insurance.payers.manage', module: 'insurance' })).toBe(
      false,
    );
    expect(isDelegablePermission({ code: 'insurance.mappings.manage', module: 'insurance' })).toBe(
      false,
    );
    expect(isRestrictedRolePermission({ code: 'insurance.payers.read', module: 'insurance' })).toBe(
      false,
    );
  });

  it('protects every /api/insurance/* endpoint behind authentication (401 when unauthenticated)', async () => {
    const protectedEndpoints: Array<[string, string]> = [
      ['GET', '/api/insurance/dashboard'],
      ['GET', '/api/insurance/diagnostics'],
      ['GET', '/api/insurance/payers'],
      ['POST', '/api/insurance/payers'],
      ['GET', '/api/insurance/payers/1'],
      ['PATCH', '/api/insurance/payers/1'],
      ['GET', '/api/insurance/payers/1/capabilities'],
      ['GET', '/api/insurance/payers/1/connection-status'],
      ['GET', '/api/insurance/members'],
      ['POST', '/api/insurance/members'],
      ['GET', '/api/insurance/members/1'],
      ['PATCH', '/api/insurance/members/1'],
      ['POST', '/api/insurance/eligibility/check'],
      ['GET', '/api/insurance/eligibility/1'],
      ['GET', '/api/insurance/patients/1/eligibility-history'],
      ['POST', '/api/insurance/benefits/validate'],
      ['GET', '/api/insurance/mappings'],
      ['POST', '/api/insurance/mappings'],
      ['PATCH', '/api/insurance/mappings/1'],
      ['POST', '/api/insurance/preauthorizations'],
      ['GET', '/api/insurance/preauthorizations'],
      ['GET', '/api/insurance/preauthorizations/1'],
      ['POST', '/api/insurance/preauthorizations/1/submit'],
      ['POST', '/api/insurance/preauthorizations/1/attachments'],
      ['POST', '/api/insurance/claims/prepare'],
      ['GET', '/api/insurance/claims'],
      ['GET', '/api/insurance/claims/1'],
      ['POST', '/api/insurance/claims/1/validate'],
      ['POST', '/api/insurance/claims/1/submit'],
      ['POST', '/api/insurance/claims/1/resubmit'],
      ['GET', '/api/insurance/claims/1/status'],
      ['GET', '/api/insurance/remittances'],
      ['POST', '/api/insurance/remittances/import'],
      ['POST', '/api/insurance/remittances/1/reconcile'],
      ['GET', '/api/insurance/reconciliation'],
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
});
