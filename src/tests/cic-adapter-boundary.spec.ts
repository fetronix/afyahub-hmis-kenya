import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_PAYER_OPERATIONS, type PayerRuntimeConfig } from '../insurance/core/types.ts';
import { CicInsuranceAdapter } from '../insurance/payers/cic.adapter.ts';

// Synthetic values; no external contract, endpoint or credentials are assumed.
const payer: PayerRuntimeConfig = {
  payerId: 1,
  tenantId: 2,
  facilityId: 3,
  payerCode: 'CIC',
  payerName: 'Synthetic CIC configuration',
  payerType: 'PRIVATE',
  isActive: true,
  integrationType: 'DIRECT_API',
  adapterKey: 'cic_direct',
  gatewayProvider: null,
  environment: 'UNCONFIGURED',
  connectionStatus: 'AWAITING_DOCUMENTATION',
  apiBaseUrl: null,
  authMethod: 'NONE',
  secretEnvPrefix: null,
  providerIdentifier: null,
  defaultCodingSystem: 'ICD-10',
  requireVerifiedEligibility: true,
  eligibilityMaxAgeHours: 24,
  claimRequirements: {},
  preauthRequirements: {},
};

describe('CIC connector remains an unverified boundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not advertise supported capabilities or verified connectivity', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected network call'));
    const adapter = new CicInsuranceAdapter();
    const capabilities = adapter.getCapabilities();
    expect(adapter.isGatewayAdapter).toBe(false);
    expect(capabilities.map((item) => item.operation)).toEqual(ALL_PAYER_OPERATIONS);
    expect(
      capabilities.every(
        (item) =>
          !item.supportedByContract && !item.readyInCurrentConfig && item.mode === 'UNSUPPORTED',
      ),
    ).toBe(true);
    expect(await adapter.probeConnection()).toMatchObject({
      verified: false,
      connectionStatus: 'AWAITING_DOCUMENTATION',
      httpStatus: null,
      missingRequirements: adapter.getRequiredOnboardingChecklist(),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns unsupported for eligibility, preauthorization, submission and status without a network call', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected network call'));
    const adapter = new CicInsuranceAdapter();
    const request = {
      payer,
      correlationId: 'synthetic-correlation',
      memberNumber: 'synthetic-member',
    };
    const outcomes = await Promise.all([
      adapter.verifyEligibility({ ...request, serviceDate: '2026-01-01' }),
      adapter.submitPreauthorization({
        ...request,
        preauthNumber: 'synthetic-preauth',
        clinicalIndication: 'synthetic indication',
        diagnosisCode: 'test-only',
        diagnosisDisplay: 'test-only',
        codingSystem: 'test-only',
        requestedItems: [],
        estimatedAmount: '0.00',
      }),
      adapter.submitClaim({
        ...request,
        claimNumber: 'synthetic-claim',
        idempotencyKey: 'synthetic-idempotency',
        encounterType: 'OPD',
        serviceDateStart: '2026-01-01',
        serviceDateEnd: '2026-01-01',
        currency: 'KES',
        grossAmount: '0.00',
        discountAmount: '0.00',
        copayAmount: '0.00',
        proposedClaimAmount: '0.00',
        diagnoses: [],
        lines: [],
      }),
      adapter.queryClaimStatus(payer),
    ]);
    expect(outcomes.map((result) => result.operation)).toEqual([
      'ELIGIBILITY_VERIFY',
      'PREAUTHORIZATION_SUBMIT',
      'CLAIM_SUBMIT',
      'CLAIM_STATUS',
    ]);
    for (const result of outcomes) {
      expect(result).toMatchObject({
        supported: false,
        code: 'AWAITING_DOCUMENTATION',
        payerCode: 'CIC',
        adapterKey: 'cic_direct',
      });
      expect(result.requiredFromInsurer.length).toBeGreaterThan(0);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
