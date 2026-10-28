/**
 * Sandbox-only, based on Safaricom's published reference implementation:
 * https://github.com/safaricom/mpesa-node-library/tree/master/src/endpoints
 * The 2019 reference is not proof that an account is approved or that a
 * current live environment has been tested. Do not promote this adapter to
 * production without reconfirming the provider contract and callback security.
 */
import { PaymentHubError } from '../errors.ts';
import type {
  CollectionCapability,
  HealthCapability,
  ProviderBoundary,
  StatusCapability,
} from './contracts.ts';

const SANDBOX = 'https://sandbox.safaricom.co.ke';
const timeoutMs = 8000;
export interface DarajaCredentials {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  transactionType: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline';
}
export function validateDarajaCredentials(input: Record<string, unknown>): DarajaCredentials {
  const get = (name: string, max: number) => {
    const value = typeof input[name] === 'string' ? String(input[name]).trim() : '';
    if (!value || value.length > max || /[\r\n]/.test(value))
      throw new PaymentHubError(
        'INVALID_CREDENTIALS',
        'Supply all required Daraja credential fields.',
      );
    return value;
  };
  const consumerKey = get('consumerKey', 256),
    consumerSecret = get('consumerSecret', 256),
    passkey = get('passkey', 512),
    shortcode = get('shortcode', 20);
  const transactionType = get('transactionType', 40);
  if (
    !/^\d{4,12}$/.test(shortcode) ||
    !['CustomerPayBillOnline', 'CustomerBuyGoodsOnline'].includes(transactionType)
  ) {
    throw new PaymentHubError(
      'INVALID_CREDENTIALS',
      'Use an approved shortcode and transaction type.',
    );
  }
  return {
    consumerKey,
    consumerSecret,
    passkey,
    shortcode,
    transactionType: transactionType as DarajaCredentials['transactionType'],
  };
}

export function normalizeDarajaQuery(
  value: unknown,
  expectedCheckoutId: string,
): { outcome: 'CONFIRMED' | 'UNKNOWN'; resultCode: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { outcome: 'UNKNOWN', resultCode: null };
  const data = value as Record<string, unknown>;
  const code =
    typeof data.ResultCode === 'string' || typeof data.ResultCode === 'number'
      ? String(data.ResultCode)
      : null;
  const responseCode =
    typeof data.ResponseCode === 'string' || typeof data.ResponseCode === 'number'
      ? String(data.ResponseCode)
      : null;
  // If returned, the provider's identifier must agree. A mere HTTP 200,
  // a ResponseCode of 0, a callback, or an unknown result is never success.
  if (data.CheckoutRequestID !== undefined && data.CheckoutRequestID !== expectedCheckoutId)
    return { outcome: 'UNKNOWN', resultCode: null };
  return {
    outcome: responseCode === '0' && code === '0' ? 'CONFIRMED' : 'UNKNOWN',
    resultCode: code && /^\d{1,8}$/.test(code) ? code : null,
  };
}
function timestamp(): string {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14);
}
function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export class DarajaSandboxAdapter
  implements ProviderBoundary, CollectionCapability, StatusCapability, HealthCapability
{
  readonly descriptor = {
    key: 'MPESA_DARAJA',
    implementedCapabilities: ['PAYMENT_COLLECTION', 'PAYMENT_STATUS', 'NOTIFICATIONS', 'HEALTH'],
    sandboxOnly: true,
    productionReady: false,
    note: 'Sandbox reference implementation; callback is an unverified hint. Production use is blocked.',
  } as const;
  readonly collection = this;
  readonly status = this;
  readonly health = this;
  readonly notifications = { authenticity: 'UNVERIFIED_HINT' } as const;
  constructor(
    private readonly credentials: DarajaCredentials,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private async request(path: string, options: RequestInit): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetcher(`${SANDBOX}${path}`, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error('provider unavailable');
      // Bound bytes while streaming, not after response.text() has already
      // buffered an arbitrarily large provider response in memory.
      if (!response.body) throw new Error('empty response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > 65536) {
          await reader.cancel();
          throw new Error('response too large');
        }
        chunks.push(part.value);
      }
      const parsed: unknown = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('invalid response');
      return parsed as Record<string, unknown>;
    } catch {
      // Never include provider bodies, credential values, headers, or phone numbers in errors/logs.
      throw new PaymentHubError(
        'PROVIDER_UNAVAILABLE',
        'Provider request failed or timed out; the outcome may be unknown.',
        503,
      );
    }
  }
  private async token(): Promise<string> {
    const basic = Buffer.from(
      `${this.credentials.consumerKey}:${this.credentials.consumerSecret}`,
    ).toString('base64');
    const result = await this.request('/oauth/v1/generate?grant_type=client_credentials', {
      method: 'GET',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
    });
    if (
      typeof result.access_token !== 'string' ||
      !result.access_token ||
      result.access_token.length > 4096
    )
      throw new PaymentHubError(
        'PROVIDER_UNAVAILABLE',
        'Provider authentication could not be confirmed.',
        503,
      );
    return result.access_token;
  }
  async check(): Promise<void> {
    await this.token();
  }
  private async post(path: string, data: Record<string, unknown>) {
    const token = await this.token();
    return this.request(path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }
  private authFields() {
    const time = timestamp();
    return {
      BusinessShortCode: this.credentials.shortcode,
      Password: Buffer.from(
        `${this.credentials.shortcode}${this.credentials.passkey}${time}`,
      ).toString('base64'),
      Timestamp: time,
    };
  }
  async initiate(input: {
    phone: string;
    amountKes: number;
    callbackUrl: string;
    accountReference: string;
  }) {
    if (
      !/^254[17]\d{8}$/.test(input.phone) ||
      !Number.isSafeInteger(input.amountKes) ||
      input.amountKes <= 0 ||
      !/^[A-Za-z0-9-]{1,12}$/.test(input.accountReference)
    )
      throw new PaymentHubError(
        'INVALID_COLLECTION',
        'Use a Kenyan phone number, whole KES amount and valid reference.',
      );
    const url = new URL(input.callbackUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new PaymentHubError(
        'CALLBACK_UNCONFIGURED',
        'A public HTTPS callback URL is required.',
        503,
      );
    const result = await this.post('/mpesa/stkpush/v1/processrequest', {
      ...this.authFields(),
      TransactionType: this.credentials.transactionType,
      Amount: input.amountKes,
      PartyA: input.phone,
      PartyB: this.credentials.shortcode,
      PhoneNumber: input.phone,
      CallBackURL: input.callbackUrl,
      AccountReference: input.accountReference,
      TransactionDesc: 'Invoice',
    });
    if (String(result.ResponseCode) !== '0' || !safeId(result.CheckoutRequestID))
      throw new PaymentHubError(
        'PROVIDER_RESPONSE_UNKNOWN',
        'Provider response did not establish that the request was accepted.',
        503,
      );
    return { checkoutRequestId: result.CheckoutRequestID };
  }
  async query(checkoutRequestId: string) {
    if (!safeId(checkoutRequestId))
      throw new PaymentHubError('INVALID_REFERENCE', 'Payment reference is invalid.');
    const response = await this.post('/mpesa/stkpushquery/v1/query', {
      ...this.authFields(),
      CheckoutRequestID: checkoutRequestId,
    });
    return normalizeDarajaQuery(response, checkoutRequestId);
  }
}
