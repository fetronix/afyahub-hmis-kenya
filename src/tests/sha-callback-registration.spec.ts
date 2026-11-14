import { describe, expect, it, vi } from 'vitest';
import { json, scope, stubbedAdapter } from './support/sha-test-fixtures.ts';

// HTTP is injected and every hostname is .invalid. These tests do not contact DHA.
const request = {
  ...scope,
  entityType: 'claim' as const,
  environment: 'sandbox' as const,
  baseUrl: 'https://client.invalid',
  callbackPath: 'callback/test',
};

describe('SHA callback registration with injected responses', () => {
  it('registers an endpoint then an operation using encoded IDs and an explicit secret reference', async () => {
    const calls: Array<{
      url: string;
      body: Record<string, unknown>;
      headers: Record<string, string>;
    }> = [];
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        body: JSON.parse(String(init?.body)),
        headers: init?.headers as Record<string, string>,
      });
      if (url.endsWith('/tenants/token')) return json({ access_token: 'synthetic-token' });
      if (url.endsWith('/operations')) return json({ operation_id: 'operation-1' });
      return json({ endpoint_id: 'endpoint/a b' });
    });
    const secretRef = ['synthetic', 'reference'].join(':');
    const result = await stubbedAdapter(fetchImpl).registerCallbackEndpoint({
      ...request,
      authType: 'bearer_static',
      secretRef,
    });
    expect(result).toMatchObject({
      registered: true,
      isSimulated: false,
      endpointId: 'endpoint/a b',
      operationId: 'operation-1',
      correlationId: scope.correlationId,
    });
    expect(calls).toHaveLength(3);
    expect(calls[1].body).toMatchObject({
      environment: 'sandbox',
      base_url: 'https://client.invalid',
      auth_type: 'bearer_static',
      secret_ref: secretRef,
    });
    expect(calls[2].url).toContain('endpoint%2Fa%20b/operations');
    expect(calls[2].body).toMatchObject({ method: 'POST', path: '/callback/test' });
    expect(calls[2].headers['X-Facility-Id']).toBe('TEST-FACILITY');
    expect(JSON.stringify(result)).not.toContain(secretRef);
  });

  it.each([
    { status: 403, payload: {}, expectedSource: 'AUTHORITATIVE_PAYER' },
    { status: 503, payload: {}, expectedSource: 'UNAVAILABLE' },
    { status: 200, payload: {}, expectedSource: 'UNAVAILABLE' },
  ])(
    'does not register or send an operation after an unusable endpoint response ($status)',
    async ({ status, payload, expectedSource }) => {
      const fetchImpl = vi.fn<typeof fetch>(async (input) =>
        String(input).endsWith('/tenants/token')
          ? json({ access_token: 'synthetic-token' })
          : json(payload, status),
      );
      const result = await stubbedAdapter(fetchImpl).registerCallbackEndpoint(request);
      expect(result).toMatchObject({ registered: false, source: expectedSource, endpointId: null });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['missing operation identifier', () => json({})],
    ['invalid operation response', () => new Response('not JSON', { status: 200 })],
    ['empty operation identifier', () => json({ operation_id: '  ' })],
  ])(
    'does not claim registration after a successful HTTP response with %s',
    async (_label, response) => {
      const fetchImpl = vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith('/tenants/token')) return json({ access_token: 'synthetic-token' });
        if (url.endsWith('/operations')) return response();
        return json({ endpoint_id: 'synthetic-endpoint' });
      });
      const result = await stubbedAdapter(fetchImpl).registerCallbackEndpoint(request);
      expect(result).toMatchObject({
        registered: false,
        source: 'UNAVAILABLE',
        endpointId: 'synthetic-endpoint',
        operationId: null,
      });
      expect(result.errorMessage).toContain('operation identifier');
    },
  );

  it('reports operation rejection rather than successful registration', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/tenants/token')) return json({ access_token: 'synthetic-token' });
      if (url.endsWith('/operations')) return json({}, 502);
      return json({ endpoint_id: 'synthetic-endpoint' });
    });
    const result = await stubbedAdapter(fetchImpl).registerCallbackEndpoint(request);
    expect(result).toMatchObject({
      registered: false,
      source: 'UNAVAILABLE',
      endpointId: 'synthetic-endpoint',
      operationId: null,
    });
    expect(result.errorMessage).toContain('HTTP 502');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('classifies transport failure as unavailable and never fabricates registration', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('synthetic network failure');
    });
    const result = await stubbedAdapter(fetchImpl).registerCallbackEndpoint(request);
    expect(result).toMatchObject({
      registered: false,
      source: 'UNAVAILABLE',
      endpointId: null,
      operationId: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
