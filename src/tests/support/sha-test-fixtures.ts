import { ShaGatewayAdapter } from '../../integrations/sha/sha.adapter.ts';
import { ShaGatewayContext } from '../../integrations/sha/sha.context.ts';
import { loadShaConfig } from '../../integrations/sha/sha.config.ts';

// All values are synthetic. No test invokes a real payer, registry or bank.
export const scope = {
  tenantId: 1,
  facilityId: 2,
  actorUserId: 3,
  correlationId: 'test-correlation',
};
export const identity = {
  ...scope,
  identificationType: 'NATIONAL_ID',
  identificationValue: '12345',
};
export const member = { ...scope, memberCrNumber: 'CR-TEST' };

export function mockAdapter(): ShaGatewayAdapter {
  return new ShaGatewayAdapter({ config: loadShaConfig({ mode: 'mock' }), recordAuditCall: false });
}

export function mockContext(): ShaGatewayContext {
  return new ShaGatewayContext({ config: loadShaConfig({ mode: 'mock' }), recordAuditCall: false });
}

export function unavailableAdapter(): ShaGatewayAdapter {
  return new ShaGatewayAdapter({
    config: loadShaConfig({
      mode: 'sandbox',
      clientId: null,
      clientSecret: null,
      facilityRegistryCode: null,
    }),
    fetchImpl: async () => {
      throw new Error('A disabled adapter must not call fetch');
    },
    recordAuditCall: false,
  });
}

export function stubbedAdapter(fetchImpl: typeof fetch): ShaGatewayAdapter {
  return new ShaGatewayAdapter({
    config: loadShaConfig({
      mode: 'sandbox',
      middlewareBaseUrl: 'https://gateway.invalid',
      eclaimsBaseUrl: 'https://payer.invalid',
      clientId: 'synthetic-client',
      clientSecret: 'synthetic-secret',
      facilityRegistryCode: 'TEST-FACILITY',
      maxGetRetries: 1,
    }),
    fetchImpl,
    recordAuditCall: false,
  });
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}
