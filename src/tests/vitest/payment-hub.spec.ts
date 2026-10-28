import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decryptFacilitySecret,
  encryptFacilitySecret,
  privateDigest,
} from '../../payment-hub/secrets.ts';
import { providerBoundary } from '../../payment-hub/adapters/index.ts';
import {
  DarajaSandboxAdapter,
  normalizeDarajaQuery,
  validateDarajaCredentials,
} from '../../payment-hub/adapters/daraja.ts';
import { isDelegablePermission } from '../../auth/staff-role-policy.ts';

const secretKey = createHash('sha256')
  .update('synthetic payment hub encryption key for tests only')
  .digest('base64');
const scope = { tenantId: 1, facilityId: 2, integrationId: 3 };
const fake = {
  consumerKey: 'synthetic-consumer',
  consumerSecret: 'synthetic-secret',
  passkey: 'synthetic-passkey',
  shortcode: '123456',
  transactionType: 'CustomerPayBillOnline' as const,
};
afterEach(() => {
  delete process.env.PAYMENT_HUB_ENCRYPTION_KEY;
  vi.restoreAllMocks();
});

describe('payment provider capability boundaries', () => {
  it('keeps individual banks unavailable and never advertises transfers', () => {
    for (const key of ['KCB_BUNI', 'NCBA', 'EQUITY', 'UNCONFIGURED'])
      expect(providerBoundary(key).descriptor.implementedCapabilities).toEqual([]);
    const daraja = providerBoundary('MPESA_DARAJA');
    expect(daraja.descriptor).toMatchObject({ sandboxOnly: true, productionReady: false });
    expect(daraja.descriptor.implementedCapabilities).toContain('PAYMENT_COLLECTION');
    expect(daraja.descriptor.implementedCapabilities).not.toContain('TRANSFER');
    expect(daraja.notifications?.authenticity).toBe('UNVERIFIED_HINT');
  });
  it('allows finance tasks to be explicitly delegated but not provider administration, credentials or transfers', () => {
    expect(
      isDelegablePermission({ code: 'payment_hub.transactions.read', module: 'payment_hub' }),
    ).toBe(true);
    expect(
      isDelegablePermission({ code: 'payment_hub.reconciliation.manage', module: 'payment_hub' }),
    ).toBe(true);
    for (const code of [
      'payment_hub.global.manage',
      'payment_hub.assign',
      'payment_hub.credentials.manage',
      'payment_hub.production.approve',
      'payment_hub.transfers.initiate',
    ])
      expect(isDelegablePermission({ code, module: 'payment_hub' })).toBe(false);
  });
});
describe('encrypted facility credentials', () => {
  it('requires a deployment key, encrypts with random IVs and binds tenant/facility/integration as AAD', () => {
    expect(() => encryptFacilitySecret(scope, { secret: 'synthetic' })).toThrow(/not configured/i);
    process.env.PAYMENT_HUB_ENCRYPTION_KEY = secretKey;
    const a = encryptFacilitySecret(scope, { secret: 'synthetic-secret' }),
      b = encryptFacilitySecret(scope, { secret: 'synthetic-secret' });
    expect(a).not.toBe(b);
    expect(a).not.toContain('synthetic-secret');
    expect(decryptFacilitySecret(scope, a)).toEqual({ secret: 'synthetic-secret' });
    expect(() => decryptFacilitySecret({ ...scope, facilityId: 99 }, a)).toThrow(
      /cannot be accessed/i,
    );
    const parts = a.split('.');
    parts[3] = Buffer.from('tampered ciphertext').toString('base64');
    expect(() => decryptFacilitySecret(scope, parts.join('.'))).toThrow(/cannot be accessed/i);
    expect(privateDigest('private value')).not.toContain('private value');
  });
});
describe('Daraja sandbox reference adapter, mocked transport only', () => {
  it('acceptance is not payment; query requires both result codes and matching reference', () => {
    for (const body of [
      { ResponseCode: '0' },
      { ResponseCode: '0', ResultCode: '4999' },
      { ResponseCode: '0', ResultCode: 1032 },
      { ResponseCode: '1', ResultCode: '0' },
      { ResponseCode: '0', ResultCode: '0', CheckoutRequestID: 'wrong' },
      null,
    ]) {
      expect(normalizeDarajaQuery(body, 'known').outcome).toBe('UNKNOWN');
    }
    expect(
      normalizeDarajaQuery(
        { ResponseCode: '0', ResultCode: 0, CheckoutRequestID: 'known' },
        'known',
      ).outcome,
    ).toBe('CONFIRMED');
  });
  it('makes the documented OAuth, STK push and query requests only through injected mocks', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'mock-token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ResponseCode: '0', CheckoutRequestID: 'ws_synthetic' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'mock-token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ResponseCode: '0', ResultCode: '0', CheckoutRequestID: 'ws_synthetic' }),
          { status: 200 },
        ),
      );
    const adapter = new DarajaSandboxAdapter(fake, transport);
    const sent = await adapter.initiate({
      phone: '254700000001',
      amountKes: 20,
      callbackUrl: 'https://example.test/api/payment-hub/webhooks/mpesa',
      accountReference: 'I123',
    });
    expect(sent).toEqual({ checkoutRequestId: 'ws_synthetic' });
    expect(String(transport.mock.calls[0][0])).toBe(
      'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    );
    expect(String(transport.mock.calls[1][0])).toBe(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
    );
    const request = JSON.parse(String(transport.mock.calls[1][1]?.body));
    expect(request).toMatchObject({
      BusinessShortCode: '123456',
      TransactionType: 'CustomerPayBillOnline',
      Amount: 20,
      PartyA: '254700000001',
      AccountReference: 'I123',
    });
    expect(request.Password).toBeTruthy();
    expect(await adapter.query('ws_synthetic')).toEqual({ outcome: 'CONFIRMED', resultCode: '0' });
    expect(String(transport.mock.calls[3][0])).toContain('/mpesa/stkpushquery/v1/query');
    expect(transport.mock.calls[0][1]?.redirect).toBe('error');
    expect(transport.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it('fails safely on timeouts, unexpected bodies, insecure callbacks and invalid credentials', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('synthetic timeout and sensitive body'));
    const adapter = new DarajaSandboxAdapter(fake, transport);
    await expect(adapter.check()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(
      adapter.initiate({
        phone: '254700000001',
        amountKes: 5,
        callbackUrl: 'http://example.test/callback',
        accountReference: 'I1',
      }),
    ).rejects.toMatchObject({ code: 'CALLBACK_UNCONFIGURED' });
    expect(() => validateDarajaCredentials({ ...fake, transactionType: 'invented' })).toThrow();
    const invalid = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('not-json', { status: 200 }));
    await expect(new DarajaSandboxAdapter(fake, invalid).check()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    const oversized = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('x'.repeat(65537), { status: 200 }));
    await expect(new DarajaSandboxAdapter(fake, oversized).check()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });
});
