import { checkEligibility } from '../integrations/sha/sha.eligibility.ts';
import { mockContext } from './support/sha-test-fixtures.ts';
import { describe, expect, it } from 'vitest';
import {
  identity,
  json,
  mockAdapter,
  stubbedAdapter,
  unavailableAdapter,
} from './support/sha-test-fixtures.ts';

describe('eligibility workflow', () => {
  it('labels simulated results and never turns an unavailable gateway into ineligibility', async () => {
    const simulated = await mockAdapter().checkEligibility({
      ...identity,
      identificationValue: '12345000',
    });
    expect(simulated).toMatchObject({
      outcome: 'Unable to verify',
      source: 'UNAVAILABLE',
      isSimulated: true,
    });
    expect(await unavailableAdapter().checkEligibility(identity)).toMatchObject({
      outcome: 'Unable to verify',
      source: 'UNAVAILABLE',
      isSimulated: false,
      responseClassification: 'CONFIG_MISSING',
    });
  });

  it('keeps an upstream failure distinct from an eligibility decision', async () => {
    const adapter = stubbedAdapter(async (url) =>
      String(url).includes('/tenants/token')
        ? json({ access_token: 'test-token', expires_in: 900 })
        : json({ eligible: true }, 503),
    );
    expect(await adapter.checkEligibility(identity)).toMatchObject({
      outcome: 'Unable to verify',
      source: 'UNAVAILABLE',
      isSimulated: false,
      responseClassification: 'UPSTREAM_ERROR',
    });
  });
  it('runs the extracted concern with the shared context', async () => {
    expect(
      await checkEligibility(mockContext(), { ...identity, identificationValue: '12345000' }),
    ).toMatchObject({ outcome: 'Unable to verify', isSimulated: true });
  });
});
