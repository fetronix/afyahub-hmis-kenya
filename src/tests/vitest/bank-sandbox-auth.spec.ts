import { describe, expect, it, vi } from 'vitest';
import {
  EquityAdapter,
  KcbBuniAdapter,
  validateEquityCredentials,
  validateKcbCredentials,
} from '../../payment-hub/adapters/banks.ts';
import { providerBoundary } from '../../payment-hub/adapters/index.ts';

const kcb = { consumerKey: 'synthetic-kcb-key', consumerSecret: 'synthetic-kcb-secret' };
const equity = {
  merchantCode: 'synthetic-jenga-merchant',
  consumerSecret: 'synthetic-jenga-secret',
  apiKey: 'synthetic-jenga-api-key',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('bank sandbox authentication — mocked transports only', () => {
  it('constructs the documented KCB sandbox token request, discards the token and exposes no financial capability', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ access_token: 'synthetic-access-token' }));
    const adapter = new KcbBuniAdapter(kcb, fetcher);
    expect(await adapter.check()).toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://uat.buni.kcbgroup.com/token');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      body: 'grant_type=client_credentials',
      headers: {
        Authorization: `Basic ${Buffer.from(`${kcb.consumerKey}:${kcb.consumerSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(adapter.descriptor.implementedCapabilities).toEqual(['HEALTH']);
    expect(adapter.descriptor.productionReady).toBe(false);
    expect(providerBoundary('KCB_BUNI', kcb).accountInformation).toBeUndefined();
    expect(providerBoundary('KCB_BUNI', kcb).transfer).toBeUndefined();
  });

  it('constructs the documented Jenga merchant authentication request and discards both tokens', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        accessToken: 'synthetic-access',
        refreshToken: 'synthetic-refresh',
        tokenType: 'Bearer',
      }),
    );
    const adapter = new EquityAdapter(equity, fetcher);
    expect(await adapter.check()).toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://uat.finserve.africa/authentication/api/v3/authenticate/merchant');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        'Api-Key': equity.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      merchantCode: equity.merchantCode,
      consumerSecret: equity.consumerSecret,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(adapter.descriptor.implementedCapabilities).toEqual(['HEALTH']);
    expect(adapter.descriptor.productionReady).toBe(false);
    expect(providerBoundary('EQUITY', equity).accountInformation).toBeUndefined();
    expect(providerBoundary('EQUITY', equity).notifications).toBeUndefined();
  });

  it.each([
    ['HTTP error', json({ message: 'synthetic-provider-secret' }, 401)],
    ['missing token', json({ status: 'ok' })],
    ['empty token', json({ access_token: '' })],
    ['malformed token', json({ access_token: 'bad\nvalue' })],
    ['wrong JSON shape', json([])],
    ['invalid JSON', new Response('not-json', { status: 200 })],
    ['oversized body', new Response('x'.repeat(65537), { status: 200 })],
  ])(
    'fails closed on %s without retrying or exposing provider details',
    async (_name, response) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      const adapter = new KcbBuniAdapter(kcb, fetcher);
      const error = await adapter.check().catch((e: Error) => e);
      expect(error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', status: 503 });
      expect(String(error)).not.toContain('synthetic-provider-secret');
      expect(String(error)).not.toContain(kcb.consumerSecret);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it('sanitizes network and timeout failures and does not retry', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`timeout ${equity.consumerSecret}`));
    const error = await new EquityAdapter(equity, fetcher).check().catch((e: Error) => e);
    expect(error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', status: 503 });
    expect(String(error)).not.toContain(equity.consumerSecret);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('passes an eight-second abort signal to the transport and sanitizes an abort', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    try {
      let signalAborted = false;
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
        signalAborted = Boolean(init?.signal?.aborted);
        throw new Error('synthetic transport abort with secret');
      });
      const error = await new KcbBuniAdapter(kcb, fetcher).check().catch((e: Error) => e);
      expect(signalAborted).toBe(true);
      expect(error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', status: 503 });
      expect(String(error)).not.toContain('synthetic transport abort with secret');
      expect(timeout).toHaveBeenCalledWith(8000);
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      timeout.mockRestore();
    }
  });

  it('does not treat an HTTP 200 Jenga response without the documented accessToken as success', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ access_token: 'wrong-field' }));
    await expect(new EquityAdapter(equity, fetcher).check()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('rejects invalid or ambiguous credential bytes without echoing the values', () => {
    for (const value of ['', ' leading', 'line\nbreak', 'a:b', 'x'.repeat(513)]) {
      expect(() => validateKcbCredentials({ ...kcb, consumerKey: value })).toThrow(
        /valid provider-issued/i,
      );
    }
    expect(() => validateEquityCredentials({ ...equity, apiKey: 'bad\r\nheader' })).toThrow(
      /valid provider-issued/i,
    );
    expect(
      validateKcbCredentials({ ...kcb, consumerSecret: 'secret:with-colon' }).consumerSecret,
    ).toBe('secret:with-colon');
    expect(validateEquityCredentials(equity)).toEqual(equity);
  });
});
