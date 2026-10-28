import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { PaymentHubError } from './errors.ts';

export interface SecretScope {
  tenantId: number;
  facilityId: number;
  integrationId: number;
}

/** A separate 32-byte deployment key; credentials are never persisted without it. */
function key(): Buffer {
  const raw = process.env.PAYMENT_HUB_ENCRYPTION_KEY ?? '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    throw new PaymentHubError(
      'SECRET_STORE_UNCONFIGURED',
      'Payment credential storage is not configured on the server.',
      503,
    );
  }
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== raw) {
    throw new PaymentHubError(
      'SECRET_STORE_UNCONFIGURED',
      'Payment credential storage is not configured on the server.',
      503,
    );
  }
  return decoded;
}
function aad(scope: SecretScope): Buffer {
  return Buffer.from(`payment-hub:v1:${scope.tenantId}:${scope.facilityId}:${scope.integrationId}`);
}
export function encryptFacilitySecret(scope: SecretScope, value: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(aad(scope));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}
export function decryptFacilitySecret(scope: SecretScope, blob: string): Record<string, string> {
  try {
    const [version, iv, tag, ciphertext, extra] = blob.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext || extra) throw new Error('invalid');
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAAD(aad(scope));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const decoded = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const value: unknown = JSON.parse(decoded);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    return value as Record<string, string>;
  } catch (error) {
    if (error instanceof PaymentHubError) throw error;
    throw new PaymentHubError(
      'SECRET_UNAVAILABLE',
      'Stored credentials cannot be accessed. Contact an administrator.',
      503,
    );
  }
}
/** HMAC avoids leaving low-entropy phone numbers recoverable from a plain hash. */
export function privateDigest(value: string): string {
  return createHmac('sha256', key()).update(value).digest('hex');
}
