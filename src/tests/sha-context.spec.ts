import { ShaGatewayContext } from '../integrations/sha/sha.context.ts';
import { loadShaConfig } from '../integrations/sha/sha.config.ts';
import { describe, expect, it } from 'vitest';
import { identity, json, scope, stubbedAdapter } from './support/sha-test-fixtures.ts';

describe('gateway transport shared by workflows', () => {
  it('caches the token per adapter, retries GETs only and retains facility headers', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    let eligibilityGets = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      const entry = {
        url: String(url),
        method: init?.method ?? 'GET',
        headers: init?.headers as Record<string, string>,
      };
      calls.push(entry);
      if (entry.url.includes('/tenants/token'))
        return json({ access_token: 'test-token', expires_in: 900 });
      if (entry.url.includes('/patients/eligibility')) {
        eligibilityGets += 1;
        return eligibilityGets === 1 ? json({}, 503) : json({ eligible: true });
      }
      if (entry.url.includes('/patients?')) return json({ patients: [{ id: 'CR-TEST' }] });
      return json({}, 503);
    };
    const adapter = stubbedAdapter(fetchImpl);
    expect((await adapter.checkEligibility(identity)).outcome).toBe('Eligible');
    expect((await adapter.searchClientRegistryPatient(identity)).found).toBe(true);
    const submitted = await adapter.submitBundle({
      ...scope,
      operation: 'claims.submit',
      bundleUuid: 'test-bundle',
      claimUuid: 'test-claim',
      fhirBundle: {},
    });
    expect(submitted.accepted).toBe(false);
    expect(calls.filter((c) => c.url.includes('/tenants/token'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('/patients/eligibility'))).toHaveLength(2);
    expect(calls.filter((c) => c.url.includes('/bundle'))).toHaveLength(1);
    expect(calls.find((c) => c.url.includes('/patients/eligibility'))?.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'X-Facility-Id': 'TEST-FACILITY',
      'X-Facility-Id-Type': 'fr-code',
    });
    await stubbedAdapter(fetchImpl).searchClientRegistryPatient(identity);
    expect(calls.filter((c) => c.url.includes('/tenants/token'))).toHaveLength(2);
  });
  it('resolves facility overrides while keeping credentials out of connection reports', () => {
    const config = loadShaConfig({
      mode: 'sandbox',
      middlewareBaseUrl: 'https://gateway.invalid',
      eclaimsBaseUrl: 'https://payer.invalid',
      clientId: 'synthetic-client',
      clientSecret: 'synthetic-secret',
      facilityRegistryCode: 'TEST-ORIGINAL',
    });
    const context = new ShaGatewayContext({ config, recordAuditCall: false });
    expect(context.resolveConfig('  TEST-OVERRIDE  ').facilityRegistryCode).toBe('TEST-OVERRIDE');
    const status = context.getConnectionStatus('TEST-OVERRIDE');
    expect(status.facilityRegistryCode).toBe('TEST-OVERRIDE');
    expect(JSON.stringify(status)).not.toContain('synthetic-secret');
  });
});
