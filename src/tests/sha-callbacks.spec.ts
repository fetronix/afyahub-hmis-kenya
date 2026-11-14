import { registerCallbackEndpoint } from '../integrations/sha/sha.callbacks.ts';
import { mockContext } from './support/sha-test-fixtures.ts';
import { describe, expect, it } from 'vitest';
import { mockAdapter, scope, unavailableAdapter } from './support/sha-test-fixtures.ts';

describe('callback registration', () => {
  const request = {
    ...scope,
    entityType: 'claim' as const,
    environment: 'sandbox' as const,
    baseUrl: 'https://app.invalid',
    callbackPath: '/test-callback',
  };
  it('rejects invalid environments and insecure callback URLs even in mock mode', async () => {
    const adapter = mockAdapter();
    expect(
      await adapter.registerCallbackEndpoint({ ...request, environment: 'prod' as 'sandbox' }),
    ).toMatchObject({ registered: false, source: 'UNAVAILABLE' });
    expect(
      await adapter.registerCallbackEndpoint({ ...request, baseUrl: 'http://app.invalid' }),
    ).toMatchObject({ registered: false, source: 'UNAVAILABLE' });
    expect(await adapter.registerCallbackEndpoint(request)).toMatchObject({
      registered: true,
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
    });
  });
  it('does not report registration without configured credentials', async () => {
    expect(await unavailableAdapter().registerCallbackEndpoint(request)).toMatchObject({
      registered: false,
      source: 'UNAVAILABLE',
      isSimulated: false,
    });
  });
  it('runs the extracted concern with the shared context', async () => {
    expect(await registerCallbackEndpoint(mockContext(), request)).toMatchObject({
      registered: true,
      source: 'SANDBOX_SIMULATION',
      isSimulated: true,
    });
  });
});
