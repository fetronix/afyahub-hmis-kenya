import { PaymentHubError } from '../errors.ts';
import type { HealthCapability, ProviderBoundary } from './contracts.ts';

/**
 * Only the documented sandbox authentication endpoints are implemented. A
 * token is not evidence of account access, an API subscription, a payment or
 * a settled bank transaction. No token is persisted or returned to a caller.
 *
 * KCB: https://buni.kcbgroup.com/getting-started
 * Jenga: https://developer.jengahq.io/guides/get-started/developer-quickstart
 */
const KCB_SANDBOX_TOKEN = 'https://uat.buni.kcbgroup.com/token';
const JENGA_SANDBOX_TOKEN =
  'https://uat.finserve.africa/authentication/api/v3/authenticate/merchant';
const TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 65536;

export interface KcbCredentials {
  consumerKey: string;
  consumerSecret: string;
}
export interface EquityCredentials {
  merchantCode: string;
  consumerSecret: string;
  apiKey: string;
}

function field(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  // HTTP header values must not contain control characters. Do not silently
  // trim or otherwise change provider-issued secret material.
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 512 ||
    value !== value.trim() ||
    /[^\x20-\x7e]/.test(value)
  )
    throw new PaymentHubError(
      'INVALID_CREDENTIALS',
      'Supply valid provider-issued application credentials.',
    );
  return value;
}

export function validateKcbCredentials(input: Record<string, unknown>): KcbCredentials {
  const consumerKey = field(input, 'consumerKey');
  const consumerSecret = field(input, 'consumerSecret');
  // Basic authentication uses the first colon as its separator; a colon in
  // the user/client ID is ambiguous. A colon in the secret remains intact.
  if (consumerKey.includes(':'))
    throw new PaymentHubError(
      'INVALID_CREDENTIALS',
      'Supply valid provider-issued application credentials.',
    );
  return { consumerKey, consumerSecret };
}

export function validateEquityCredentials(input: Record<string, unknown>): EquityCredentials {
  return {
    merchantCode: field(input, 'merchantCode'),
    consumerSecret: field(input, 'consumerSecret'),
    apiKey: field(input, 'apiKey'),
  };
}

/** One bounded, non-redirecting request. No automatic retry or provider body in errors. */
async function checkToken(
  fetcher: typeof fetch,
  endpoint: string,
  options: RequestInit,
  tokenField: 'access_token' | 'accessToken',
): Promise<void> {
  try {
    const response = await fetcher(endpoint, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok || !response.body) throw new Error('unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('oversized');
      }
      chunks.push(item.value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
    const token = (body as Record<string, unknown>)[tokenField];
    if (typeof token !== 'string' || !token.trim() || token.length > 8192 || /[\r\n]/.test(token))
      throw new Error('invalid token');
    // Deliberately discard token and response. The test is authentication only.
  } catch {
    throw new PaymentHubError(
      'PROVIDER_UNAVAILABLE',
      'Provider authentication failed or timed out. No provider details were retained.',
      503,
    );
  }
}

export class KcbBuniAdapter implements ProviderBoundary, HealthCapability {
  readonly descriptor = bankDescriptor('KCB_BUNI');
  readonly health = this;
  constructor(
    private readonly credentials: KcbCredentials,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async check(): Promise<void> {
    const basic = Buffer.from(
      `${this.credentials.consumerKey}:${this.credentials.consumerSecret}`,
    ).toString('base64');
    await checkToken(
      this.fetcher,
      KCB_SANDBOX_TOKEN,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
      },
      'access_token',
    );
  }
}

export class EquityAdapter implements ProviderBoundary, HealthCapability {
  readonly descriptor = bankDescriptor('EQUITY');
  readonly health = this;
  constructor(
    private readonly credentials: EquityCredentials,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async check(): Promise<void> {
    await checkToken(
      this.fetcher,
      JENGA_SANDBOX_TOKEN,
      {
        method: 'POST',
        headers: {
          'Api-Key': this.credentials.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          merchantCode: this.credentials.merchantCode,
          consumerSecret: this.credentials.consumerSecret,
        }),
      },
      'accessToken',
    );
  }
}

/** NCBA and unconfigured providers remain fail-closed without an official contract. */
export class NcbaAdapter implements ProviderBoundary {
  readonly descriptor = {
    key: 'NCBA',
    implementedCapabilities: [],
    sandboxOnly: true,
    productionReady: false,
    note: 'NCBA API contract, authentication and sandbox access not yet verified.',
  } as const;
}
export class UnconfiguredProviderAdapter implements ProviderBoundary {
  readonly descriptor = {
    key: 'UNCONFIGURED',
    implementedCapabilities: [],
    sandboxOnly: true,
    productionReady: false,
    note: 'No provider adapter has been implemented.',
  } as const;
}

/** Discover capabilities without constructing an adapter with invented credentials. */
export function bankDescriptor(key: 'KCB_BUNI' | 'EQUITY') {
  if (key === 'KCB_BUNI')
    return {
      key,
      implementedCapabilities: ['HEALTH'],
      sandboxOnly: true,
      productionReady: false,
      note: 'Sandbox authentication only; account access, transactions, callbacks and production are not implemented or verified.',
    } as const;
  return {
    key,
    implementedCapabilities: ['HEALTH'],
    sandboxOnly: true,
    productionReady: false,
    note: 'Jenga sandbox authentication only; account access, statements, transfers, callbacks and production are not implemented or verified.',
  } as const;
}
