import {
  fetchFacilityRemittances,
  fetchClaimsPaidByRemittance,
} from '../integrations/sha/sha.remittances.ts';
import { mockContext } from './support/sha-test-fixtures.ts';
import { describe, expect, it } from 'vitest';
import { mockAdapter, scope, unavailableAdapter } from './support/sha-test-fixtures.ts';

describe('remittance queries', () => {
  it('labels both mock query stages as simulated', async () => {
    const adapter = mockAdapter();
    const list = await adapter.fetchFacilityRemittances(scope);
    expect(list).toMatchObject({
      reachable: true,
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
    });
    const lines = await adapter.fetchClaimsPaidByRemittance({
      ...scope,
      bankReference: list.remittances[0].bankReference,
    });
    expect(lines).toMatchObject({
      reachable: true,
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
    });
    expect(lines.claims.length).toBeGreaterThan(0);
  });
  it('returns no payment confirmation on an unavailable gateway', async () => {
    const adapter = unavailableAdapter();
    expect(await adapter.fetchFacilityRemittances(scope)).toMatchObject({
      reachable: false,
      source: 'UNAVAILABLE',
      remittances: [],
    });
    expect(
      await adapter.fetchClaimsPaidByRemittance({ ...scope, bankReference: 'TEST-REF' }),
    ).toMatchObject({ reachable: false, source: 'UNAVAILABLE', claims: [] });
  });
  it('runs the extracted concern with the shared context', async () => {
    const context = mockContext();
    expect(await fetchFacilityRemittances(context, scope)).toMatchObject({
      reachable: true,
      isSimulated: true,
    });
    expect(
      await fetchClaimsPaidByRemittance(context, { ...scope, bankReference: 'TEST' }),
    ).toMatchObject({ reachable: true, isSimulated: true });
  });
});
