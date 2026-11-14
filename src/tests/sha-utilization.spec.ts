import { fetchBenefitUtilizationAndBalances } from '../integrations/sha/sha.utilization.ts';
import { mockContext } from './support/sha-test-fixtures.ts';
import { describe, expect, it } from 'vitest';
import { member, mockAdapter, unavailableAdapter } from './support/sha-test-fixtures.ts';

describe('utilization and balances', () => {
  const request = {
    ...member,
    interventionCode: 'TEST-CODE',
    includePomsfBalances: true,
    includeBedOccupancy: true,
    policyYear: 2026,
  };
  it('preserves mock arithmetic and labels it as a simulation', async () => {
    const result = await mockAdapter().fetchBenefitUtilizationAndBalances(request);
    expect(result).toMatchObject({
      reachable: true,
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
    });
    expect(result.utilization[0].individualRemainingLimitKes).toBe('38000.00');
    expect(result.pomsfBalances[0].policyYear).toBe('2026');
    expect(result.bedOccupancy?.totalBeds).toBe(80);
  });
  it('does not treat missing configuration as a balance', async () => {
    expect(await unavailableAdapter().fetchBenefitUtilizationAndBalances(request)).toMatchObject({
      reachable: false,
      source: 'UNAVAILABLE',
      utilization: [],
      pomsfBalances: [],
      bedOccupancy: null,
    });
  });
  it('runs the extracted concern with the shared context', async () => {
    expect(await fetchBenefitUtilizationAndBalances(mockContext(), request)).toMatchObject({
      reachable: true,
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
    });
  });
});
