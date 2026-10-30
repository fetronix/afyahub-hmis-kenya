import { fetchPatientBenefitsAndInterventions } from '../integrations/sha/sha.benefits.ts';
import { mockContext } from './support/sha-test-fixtures.ts';
import { describe, expect, it } from 'vitest';
import { member, mockAdapter, unavailableAdapter } from './support/sha-test-fixtures.ts';

describe('benefit and intervention lookup', () => {
  it('labels the built-in fixtures as simulated, not payer-confirmed', async () => {
    const result = await mockAdapter().fetchPatientBenefitsAndInterventions(member);
    expect(result).toMatchObject({
      reachable: true,
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
    });
    expect(result.interventions.length).toBeGreaterThan(0);
    expect(result.interventions.some((item) => item.needsPreauth)).toBe(true);
  });
  it('returns unavailable and no benefits without configuration', async () => {
    expect(await unavailableAdapter().fetchPatientBenefitsAndInterventions(member)).toMatchObject({
      reachable: false,
      source: 'UNAVAILABLE',
      isSimulated: false,
      benefits: [],
      interventions: [],
    });
  });
  it('runs the extracted concern with the shared context', async () => {
    expect(await fetchPatientBenefitsAndInterventions(mockContext(), member)).toMatchObject({
      reachable: true,
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
    });
  });
});
