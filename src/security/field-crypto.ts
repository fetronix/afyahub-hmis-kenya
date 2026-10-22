/**
 * JaliCare HMIS
 * Field encryption
 *
 * Encryption at rest is mostly a hosting decision — the PostgreSQL
 * volume, its snapshots and its backups. Nothing in this file changes
 * that, and the readiness register still scores "encryption at rest"
 * as an operational control.
 *
 * What this module adds is the part an application *can* own: direct
 * identifiers — a national ID, a SHA number — can be sealed before they
 * reach the database, so a stolen table dump or a careless `SELECT *`
 * in a support session does not expose them.
 *
 * Design
 * ======
 *
 *   - AES-256-GCM with a random 96-bit IV per value. The authentication
 *     tag is stored with the ciphertext, so a modified row fails to
 *     decrypt instead of returning a wrong identifier.
 *   - A version prefix (`v1:`) so the format can change without a
 *     migration guessing what it is looking at.
 *   - **Blind indexes.** An encrypted column cannot be searched with
 *     `ILIKE`. Exact-match lookups use an HMAC of the normalised value,
 *     which leaks equality and nothing else. It is stored in a separate
 *     column and indexed.
 *   - **Legacy passthrough.** Rows written before a key existed are
 *     plaintext and are returned unchanged. Encryption therefore never
 *     makes existing data unreadable, and turning the feature on is not
 *     a migration.
 *
 * The key comes from `FIELD_ENCRYPTION_KEY` (base64, 32 bytes). When it
 * is absent the application runs exactly as before and the readiness
 * report says the control is not configured. There is no default key:
 * a compiled-in default would be worse than none.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class FieldCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldCryptoError';
  }
}

function readKey(): Buffer | null {
  const raw = process.env.FIELD_ENCRYPTION_KEY;

  if (!raw || raw.trim() === '') return null;

  let key: Buffer;

  try {
    key = Buffer.from(raw.trim(), 'base64');
  } catch {
    throw new FieldCryptoError(
      'FIELD_ENCRYPTION_KEY is not valid base64.',
    );
  }

  if (key.length !== KEY_BYTES) {
    throw new FieldCryptoError(
      `FIELD_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (base64 of 32 random bytes).`,
    );
  }

  return key;
}

/** True when a key is configured. Never throws on a malformed key. */
export function isFieldEncryptionConfigured(): boolean {
  try {
    return readKey() !== null;
  } catch {
    return false;
  }
}

export interface FieldEncryptionStatus {
  configured: boolean;
  detail: string;
}

export function describeFieldEncryption(): FieldEncryptionStatus {
  let key: Buffer | null = null;

  try {
    key = readKey();
  } catch (error) {
    return {
      configured: false,
      detail:
        error instanceof Error
          ? error.message
          : 'FIELD_ENCRYPTION_KEY is present but unusable.',
    };
  }

  return key
    ? {
        configured: true,
        detail:
          'Direct identifiers are sealed with AES-256-GCM before they are stored. Exact-match lookup uses an HMAC blind index.',
      }
    : {
        configured: false,
        detail:
          'FIELD_ENCRYPTION_KEY is not set, so direct identifiers are stored as plaintext in the database. Set a base64-encoded 32-byte key to enable field encryption; existing rows remain readable either way.',
      };
}

export function isEncryptedField(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`);
}

/**
 * Seal a value.
 *
 * Null, undefined and empty strings stay as they are: encrypting an
 * absent identifier would invent one.
 */
export function encryptField(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;

  const plaintext = String(value);

  if (plaintext === '') return '';

  const key = readKey();

  // No key configured: store as before. The status report says so.
  if (!key) return plaintext;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/**
 * Open a sealed value.
 *
 * A value without the version prefix is a legacy plaintext row and is
 * returned unchanged. A value that *looks* sealed but fails
 * authentication throws rather than returning garbage — a tampered
 * identifier must never be silently accepted.
 */
export function decryptField(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;

  const stored = String(value);

  if (!isEncryptedField(stored)) return stored;

  const key = readKey();

  if (!key) {
    throw new FieldCryptoError(
      'An encrypted field was read while FIELD_ENCRYPTION_KEY is not configured. Restore the key that wrote it.',
    );
  }

  const parts = stored.split(':');

  if (parts.length !== 4) {
    throw new FieldCryptoError('An encrypted field has a malformed payload.');
  }

  const [, ivPart, tagPart, cipherPart] = parts;

  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  const ciphertext = Buffer.from(cipherPart, 'base64url');

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new FieldCryptoError('An encrypted field has an invalid IV or tag.');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new FieldCryptoError(
      'An encrypted field failed authentication: the key is wrong or the value was altered.',
    );
  }
}

/** Normalise before hashing so ' 1234 ' and '1234' index the same. */
/**
 * Normalise an identifier before hashing it.
 *
 * Kenyan national IDs and SHA numbers are written with and without
 * separators — `12345678`, `1234-5678`, `1234 5678`. If the blind
 * index kept those distinct, a search that typed the number in a
 * different shape would report "no such patient" for a patient who is
 * right there. Separators carry no meaning in these identifiers, so
 * they are removed along with whitespace.
 *
 * This changes the hash of any value already written, which is why it
 * must be settled before the first row is sealed. Migration 0017 has
 * not been run in any environment at the time of writing; if it ever
 * has, the columns must be re-backed-fill before this rule changes.
 */
export function normaliseIdentifier(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s\-\/._]+/g, '');
}

/**
 * Deterministic lookup token for an encrypted column.
 *
 * This is what makes an encrypted identifier searchable by exact
 * value. It is deliberately not reversible, and it is domain-separated
 * by `purpose` so the same national ID used as a SHA number cannot
 * collide across columns.
 */
export function blindIndex(
  value: string | null | undefined,
  purpose: string,
): string | null {
  if (value === null || value === undefined) return null;

  const normalised = normaliseIdentifier(String(value));

  if (normalised === '') return null;

  const key = readKey();

  if (!key) return null;

  return createHmac('sha256', key)
    .update(`${purpose}:${normalised}`)
    .digest('hex');
}

/** Constant-time comparison, for callers that check a token themselves. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}
