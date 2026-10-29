import { submitHieVirtualClaim } from '../integrations/sha/sha.virtual-claim.ts';
import { mockContext } from './support/sha-test-fixtures.ts';
import { describe, expect, it } from 'vitest';
import { mockAdapter, scope, unavailableAdapter } from './support/sha-test-fixtures.ts';

describe('virtual claim dispatch', () => {
  const request = {
    ...scope,
    consentToken: 'test-consent',
    subType: 'op' as const,
    invoiceNumber: 'TEST-INVOICE',
    dischargeReason: 'OTHER' as const,
    diagnoses: [],
    lines: [],
  };
  it('preserves simulated acknowledgment without inventing an approved amount', async () => {
    expect(await mockAdapter().submitHieVirtualClaim(request)).toMatchObject({
      accepted: true,
      outcome: 'ACKNOWLEDGED',
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
      approvedAmountKes: null,
    });
  });
  it('returns failure when unconfigured', async () => {
    expect(await unavailableAdapter().submitHieVirtualClaim(request)).toMatchObject({
      accepted: false,
      outcome: 'FAILED',
      source: 'UNAVAILABLE',
      isSimulated: false,
    });
  });
  it('runs the extracted concern with the shared context', async () => {
    expect(await submitHieVirtualClaim(mockContext(), request)).toMatchObject({
      accepted: true,
      outcome: 'ACKNOWLEDGED',
      isSimulated: true,
      approvedAmountKes: null,
    });
  });
});
