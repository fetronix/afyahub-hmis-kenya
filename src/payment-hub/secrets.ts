import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { PaymentHubError } from './errors.ts';

export interface SecretScope {
  tenantId: number;
  facilityId: number;
  integrationId: number;
}

/** All keys are supplied by the server's secret manager/environment, never the database. */
function readKey(name: string): Buffer {
  const raw = process.env[name] ?? '';
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
function legacyKey(): Buffer {
  return readKey('PAYMENT_HUB_ENCRYPTION_KEY');
}
function activeKeyId(): string | null {
  const id = process.env.PAYMENT_HUB_ACTIVE_VAULT_KEY_ID;
  if (id === undefined || id === '') return null;
  // Fixed syntax prevents access to arbitrary environment variables and makes
  // the ciphertext's key selector unambiguous. LEGACY denotes v1 only.
  if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(id) || id === 'LEGACY') {
    throw new PaymentHubError(
      'SECRET_STORE_UNCONFIGURED',
      'Payment credential storage is not configured on the server.',
      503,
    );
  }
  return id;
}
function versionedKey(id: string): Buffer {
  if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(id) || id === 'LEGACY')
    throw new Error('invalid key identifier');
  return readKey(`PAYMENT_HUB_VAULT_KEY_${id}`);
}
function aad(scope: SecretScope, version: 'v1' | 'v2', keyId?: string): Buffer {
  const prefix = version === 'v1' ? 'payment-hub:v1' : `payment-hub:v2:${keyId}`;
  return Buffer.from(`${prefix}:${scope.tenantId}:${scope.facilityId}:${scope.integrationId}`);
}

/** Random-IV AES-256-GCM. Existing v1 records remain readable during a staged migration. */
export function encryptFacilitySecret(scope: SecretScope, value: Record<string, string>): string {
  const id = activeKeyId();
  const version = id ? 'v2' : 'v1';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', id ? versionedKey(id) : legacyKey(), iv);
  cipher.setAAD(aad(scope, version, id ?? undefined));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [
    version,
    ...(id ? [id] : []),
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}
export function decryptFacilitySecret(scope: SecretScope, blob: string): Record<string, string> {
  try {
    const parts = blob.split('.');
    const version = parts[0];
    if ((version === 'v1' && parts.length !== 4) || (version === 'v2' && parts.length !== 5))
      throw new Error('invalid');
    if (version !== 'v1' && version !== 'v2') throw new Error('invalid');
    const id = version === 'v2' ? parts[1] : undefined;
    const offset = version === 'v2' ? 2 : 1;
    const iv = Buffer.from(parts[offset], 'base64');
    const tag = Buffer.from(parts[offset + 1], 'base64');
    const ciphertext = Buffer.from(parts[offset + 2], 'base64');
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw new Error('invalid');
    const decipher = createDecipheriv('aes-256-gcm', id ? versionedKey(id) : legacyKey(), iv);
    decipher.setAAD(aad(scope, version, id));
    decipher.setAuthTag(tag);
    const decoded = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
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

/** Re-encrypt one scoped record with the configured active versioned key. */
export function rotateFacilitySecret(scope: SecretScope, blob: string): string {
  if (!activeKeyId())
    throw new PaymentHubError(
      'KEY_ROTATION_UNAVAILABLE',
      'An active versioned vault key must be configured before rotating stored credentials.',
      503,
    );
  return encryptFacilitySecret(scope, decryptFacilitySecret(scope, blob));
}

/**
 * Historical idempotency and credential-identity digests use this stable key.
 * Do not change it when rotating vault encryption keys: existing digests cannot
 * all be recreated from their deliberately discarded plaintext inputs.
 */
export function privateDigest(value: string): string {
  return createHmac('sha256', legacyKey()).update(value).digest('hex');
}
