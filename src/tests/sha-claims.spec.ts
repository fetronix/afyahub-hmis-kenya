import { submitBundle, queryClaimStatus } from '../integrations/sha/sha.claims.ts';
import { mockContext } from './support/sha-test-fixtures.ts';
import { describe, expect, it } from 'vitest';
import { mockAdapter, scope, unavailableAdapter } from './support/sha-test-fixtures.ts';

describe('FHIR bundle and claim status', () => {
  const request = {
    ...scope,
    operation: 'claims.submit' as const,
    bundleUuid: 'synthetic-bundle',
    claimUuid: 'synthetic-claim',
    fhirBundle: {},
  };
  it('keeps acknowledgment distinct from approval and payment', async () => {
    const adapter = mockAdapter();
    expect(await adapter.submitBundle(request)).toMatchObject({
      accepted: true,
      outcome: 'ACKNOWLEDGED',
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
      approvedAmountKes: null,
    });
    expect(
      await adapter.queryClaimStatus({ ...scope, claimUuid: request.claimUuid }),
    ).toMatchObject({ mappedStatus: 'ACKNOWLEDGED', paidAmountKes: null, isSimulated: true });
  });
  it('does not report submission or status on an unavailable gateway', async () => {
    const adapter = unavailableAdapter();
    expect(await adapter.submitBundle(request)).toMatchObject({
      accepted: false,
      outcome: 'FAILED',
      source: 'UNAVAILABLE',
    });
    expect(
      await adapter.queryClaimStatus({ ...scope, claimUuid: request.claimUuid }),
    ).toMatchObject({ recognized: false, mappedStatus: null, source: 'UNAVAILABLE' });
  });
  it('runs the extracted concern with the shared context', async () => {
    const context = mockContext();
    expect(await submitBundle(context, request)).toMatchObject({
      accepted: true,
      outcome: 'ACKNOWLEDGED',
      isSimulated: true,
    });
    expect(
      await queryClaimStatus(context, { ...scope, claimUuid: request.claimUuid }),
    ).toMatchObject({ mappedStatus: 'ACKNOWLEDGED', isSimulated: true });
  });
});
