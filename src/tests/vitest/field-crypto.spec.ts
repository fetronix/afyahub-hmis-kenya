/**
 * Field encryption — sealing direct identifiers before they reach the database
 *
 * `src/security/field-crypto.ts` is what stands between a stolen table dump
 * and a patient's national ID. Its header is explicit that it does not
 * encrypt the database — that is the host's job — and that what it adds is
 * the part the application can own: sealing direct identifiers so a careless
 * `SELECT *` in a support session does not expose them.
 *
 * The properties that matter, and that a wrong implementation would still
 * appear to satisfy:
 *
 *   1. **Round trip.** Every value that goes in comes back out, including
 *      non-ASCII, emoji and long strings.
 *   2. **Freshness.** Encrypting the same identifier twice gives two
 *      different ciphertexts, because the IV is random. Without this, a dump
 *      would show which patients share an identifier by matching byte
 *      patterns, and an attacker could confirm a guess offline.
 *   3. **Tamper detection.** A single altered bit anywhere in the payload
 *      throws. AES-GCM's tag is worthless if the code catches the failure
 *      and returns a wrong identifier instead.
 *   4. **No silent plaintext.** A sealed value read with the wrong key, or
 *      with no key, throws rather than returning ciphertext as if it were
 *      the identifier.
 *   5. **Blind index is the opposite of the ciphertext**: deterministic,
 *      domain-separated by purpose, and normalised so `1234-5678` and
 *      `1234 5678` find the same patient.
 *   6. **Constant-time comparison** does not throw or leak on a length
 *      mismatch.
 *
 * Every key, identifier and value below is generated in the test. Nothing
 * here is a real credential, and no real patient identifier appears.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

import {
  FieldCryptoError,
  blindIndex,
  decryptField,
  describeFieldEncryption,
  encryptField,
  isEncryptedField,
  isFieldEncryptionConfigured,
  normaliseIdentifier,
  safeEqual,
} from '../../security/field-crypto.ts';

/* ============================================================
   Key handling for the tests
   ============================================================ */

const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');

const originalKey = process.env.FIELD_ENCRYPTION_KEY;

function installKey(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.FIELD_ENCRYPTION_KEY;
  } else {
    process.env.FIELD_ENCRYPTION_KEY = value;
  }
}

beforeEach(() => {
  installKey(KEY_A);
});

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.FIELD_ENCRYPTION_KEY;
  } else {
    process.env.FIELD_ENCRYPTION_KEY = originalKey;
  }
});

/* ============================================================
   1. Configuration
   ============================================================ */

describe('configuration', () => {
  it('reports a configured key', () => {
    expect(isFieldEncryptionConfigured()).toBe(true);
    expect(describeFieldEncryption().configured).toBe(true);
  });

  it('reports the absence of a key without failing', () => {
    installKey(undefined);

    expect(isFieldEncryptionConfigured()).toBe(false);

    const status = describeFieldEncryption();
    expect(status.configured).toBe(false);
    expect(status.detail).toContain('FIELD_ENCRYPTION_KEY');
    /* The message must tell an administrator what to do. */
    expect(status.detail).toContain('32-byte');
  });

  it('treats a blank key as no key at all', () => {
    /* A `.env` line `FIELD_ENCRYPTION_KEY=` is a mistake, not a key. */
    for (const blank of ['', '   ', '\t\n']) {
      installKey(blank);
      expect(isFieldEncryptionConfigured(), JSON.stringify(blank)).toBe(false);
    }
  });

  it('refuses a key that is the wrong length', () => {
    for (const bytes of [1, 16, 31, 33, 64]) {
      installKey(randomBytes(bytes).toString('base64'));

      /* The read path must throw - a short key must never be stretched. */
      expect(() => encryptField('12345678'), `${bytes} bytes`).toThrow(FieldCryptoError);
      expect(() => encryptField('12345678'), `${bytes} bytes`).toThrow(/32 bytes/);
    }
  });

  it('reports a malformed key as unconfigured instead of throwing', () => {
    /*
     * `isFieldEncryptionConfigured` and the readiness report are called on
     * every health check. A bad key must degrade to "not configured", not
     * take down the readiness endpoint.
     */
    installKey(randomBytes(16).toString('base64'));

    expect(isFieldEncryptionConfigured()).toBe(false);

    const status = describeFieldEncryption();
    expect(status.configured).toBe(false);
    expect(status.detail).toMatch(/32 bytes|unusable/);
  });

  it('does not fall back to a compiled-in default', () => {
    /* The header is explicit: a default key would be worse than none. */
    installKey(undefined);
    expect(encryptField('12345678')).toBe('12345678');
  });
});

/* ============================================================
   2. Round trip
   ============================================================ */

describe('round trip', () => {
  const values = [
    '12345678',
    'SHA-2026-000123',
    'Wanjiku',
    '  spaces  preserved  ',
    'Ünïcødé',
    'emoji 😀 and 中文',
    'a'.repeat(5000),
    '1234\n5678',
    'quote\'s and "double"',
  ];

  it('returns every value unchanged', () => {
    for (const value of values) {
      expect(decryptField(encryptField(value))).toBe(value);
    }
  });

  it('seals the value rather than storing it', () => {
    const sealed = encryptField('12345678');

    expect(sealed).not.toBeNull();
    expect(sealed).not.toContain('12345678');
    expect(isEncryptedField(sealed)).toBe(true);
  });

  it('uses the documented version prefix and four-part shape', () => {
    const sealed = String(encryptField('12345678'));
    const parts = sealed.split(':');

    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    /* iv 12 bytes -> 16 base64url chars; tag 16 bytes -> 22 chars. */
    expect(Buffer.from(parts[1], 'base64url')).toHaveLength(12);
    expect(Buffer.from(parts[2], 'base64url')).toHaveLength(16);
  });

  it('produces a different ciphertext each time', () => {
    /*
     * Random IV. If this ever became deterministic, two patients with the
     * same national ID would be linkable from a dump, and an attacker could
     * confirm a guessed identifier by encrypting it themselves.
     */
    const first = String(encryptField('12345678'));
    const second = String(encryptField('12345678'));

    expect(first).not.toBe(second);

    /* Different ciphertext, same plaintext - provided the key is unchanged. */
    expect(decryptField(first)).toBe('12345678');
    expect(decryptField(second)).toBe('12345678');
  });

  it('randomises even the IV of two encryptions of the empty-ish value', () => {
    const a = String(encryptField('0'));
    const b = String(encryptField('0'));

    expect(a.split(':')[1]).not.toBe(b.split(':')[1]);
  });
});

/* ============================================================
   3. Absent values
   ============================================================ */

describe('absent values', () => {
  it('leaves null and undefined as null rather than inventing a value', () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeNull();
    expect(decryptField(null)).toBeNull();
    expect(decryptField(undefined)).toBeNull();
  });

  it('leaves the empty string empty', () => {
    /* An empty identifier is not a short identifier. */
    expect(encryptField('')).toBe('');
    expect(decryptField('')).toBe('');
  });
});

/* ============================================================
   4. Tamper detection
   ============================================================ */

function tamper(sealed: string, part: 1 | 2 | 3): string {
  const parts = sealed.split(':');
  const bytes = Buffer.from(parts[part], 'base64url');

  /* Flip one bit in the first byte, preserving length exactly. */
  bytes[0] = bytes[0] ^ 0x01;

  parts[part] = bytes.toString('base64url');

  return parts.join(':');
}

describe('tamper detection', () => {
  it('rejects an altered ciphertext', () => {
    const sealed = String(encryptField('12345678'));

    expect(() => decryptField(tamper(sealed, 3))).toThrow(FieldCryptoError);
    expect(() => decryptField(tamper(sealed, 3))).toThrow(/failed authentication/);
  });

  it('rejects an altered authentication tag', () => {
    const sealed = String(encryptField('12345678'));

    expect(() => decryptField(tamper(sealed, 2))).toThrow(/failed authentication/);
  });

  it('rejects an altered IV', () => {
    /* A changed IV decrypts to a different plaintext, which the tag catches. */
    const sealed = String(encryptField('12345678'));

    expect(() => decryptField(tamper(sealed, 1))).toThrow(/failed authentication/);
  });

  it('rejects a value sealed under a different key', () => {
    const sealed = String(encryptField('12345678'));

    installKey(KEY_B);

    expect(() => decryptField(sealed)).toThrow(FieldCryptoError);
    expect(() => decryptField(sealed)).toThrow(/key is wrong or the value was altered/);
  });

  it('refuses to read a sealed value when no key is configured', () => {
    /*
     * Returning the ciphertext here would look like success and quietly
     * write a v1:... string into a UI field.
     */
    const sealed = String(encryptField('12345678'));

    installKey(undefined);

    expect(() => decryptField(sealed)).toThrow(FieldCryptoError);
    expect(() => decryptField(sealed)).toThrow(/Restore the key/);
  });

  it('rejects a malformed payload instead of guessing', () => {
    for (const bad of ['v1:onlyone', 'v1:a:b', 'v1:a:b:c:d', 'v1:::a:b:c']) {
      expect(() => decryptField(bad), bad).toThrow(FieldCryptoError);
    }

    /* `v1` with no colon is not a sealed value at all - it is a legacy
     * plaintext row that happens to start with those two characters. */
    expect(decryptField('v1')).toBe('v1');
  });

  it('rejects an IV or tag of the wrong size', () => {
    /* A truncated IV must be caught before it reaches the decipher. */
    const short = `v1:${Buffer.alloc(4).toString('base64url')}:${Buffer.alloc(16).toString('base64url')}:${Buffer.alloc(4).toString('base64url')}`;
    const shortTag = `v1:${Buffer.alloc(12).toString('base64url')}:${Buffer.alloc(4).toString('base64url')}:${Buffer.alloc(4).toString('base64url')}`;

    expect(() => decryptField(short)).toThrow(/invalid IV or tag/);
    expect(() => decryptField(shortTag)).toThrow(/invalid IV or tag/);
  });
});

/* ============================================================
   5. Legacy plaintext rows
   ============================================================ */

describe('legacy plaintext', () => {
  it('returns a value without the version prefix unchanged', () => {
    /*
     * Rows written before a key existed are plaintext. Turning encryption on
     * is therefore not a migration, and no existing record becomes
     * unreadable.
     */
    for (const legacy of ['12345678', 'SHA-2026-000123', 'Wanjiku', ' v2:looks-like-a-version']) {
      expect(decryptField(legacy)).toBe(legacy);
    }
  });

  it('recognises only the v1 prefix as sealed', () => {
    expect(isEncryptedField('v1:a:b:c')).toBe(true);
    expect(isEncryptedField('v2:a:b:c')).toBe(false);
    expect(isEncryptedField('12345678')).toBe(false);
    expect(isEncryptedField('V1:a:b:c')).toBe(false);

    expect(isEncryptedField(null)).toBe(false);
    expect(isEncryptedField(undefined)).toBe(false);
    expect(isEncryptedField(12345678)).toBe(false);
    expect(isEncryptedField({ v: 1 })).toBe(false);
  });

  it('does not encrypt when no key is configured, and says so', () => {
    installKey(undefined);

    expect(encryptField('12345678')).toBe('12345678');
    expect(describeFieldEncryption().detail).toContain('plaintext');
  });
});

/* ============================================================
   6. Identifier normalisation
   ============================================================ */

describe('normaliseIdentifier', () => {
  it('removes separators that carry no meaning in these identifiers', () => {
    /* One patient must not be three patients because a clerk typed a dash. */
    const canonical = '12345678';

    for (const spelling of [
      '12345678',
      '1234-5678',
      '1234 5678',
      '1234 5678 ',
      '1234.5678',
      '1234/5678',
      '1234_5678',
    ]) {
      expect(normaliseIdentifier(spelling), spelling).toBe(canonical);
    }
  });

  it('upper-cases so letter identifiers compare equal', () => {
    expect(normaliseIdentifier('sha-2026-000123')).toBe('SHA2026000123');
    expect(normaliseIdentifier('SHA 2026 000123')).toBe('SHA2026000123');
  });

  it('collapses repeated separators and trims', () => {
    expect(normaliseIdentifier('  12--34..56  ')).toBe('123456');
    expect(normaliseIdentifier('   ')).toBe('');
  });

  it('leaves ordinary characters alone', () => {
    expect(normaliseIdentifier('WANJIKU')).toBe('WANJIKU');
    expect(normaliseIdentifier('ÜNÏCØDÉ')).toBe('ÜNÏCØDÉ');
  });
});

/* ============================================================
   7. Blind index
   ============================================================ */

describe('blindIndex', () => {
  it('is deterministic for the same value and purpose', () => {
    /*
     * The opposite of the ciphertext, and deliberately so: exact-match
     * lookup on an encrypted column is only possible if the token is stable.
     */
    expect(blindIndex('12345678', 'national_id')).toBe(blindIndex('12345678', 'national_id'));
  });

  it('is stable across the spellings normalisation folds together', () => {
    const expected = blindIndex('12345678', 'national_id');

    for (const spelling of ['1234-5678', '1234 5678', ' 12345678 ']) {
      expect(blindIndex(spelling, 'national_id'), spelling).toBe(expected);
    }
  });

  it('separates purposes so one identifier cannot collide across columns', () => {
    /* The same number used as a national ID and as a SHA number must not
     * produce the same token, or a lookup in one column would find the
     * other. */
    expect(blindIndex('12345678', 'national_id')).not.toBe(blindIndex('12345678', 'sha_number'));
  });

  it('changes with the key', () => {
    const withA = blindIndex('12345678', 'national_id');

    installKey(KEY_B);

    expect(blindIndex('12345678', 'national_id')).not.toBe(withA);
  });

  it('is a 64-character hex digest', () => {
    expect(blindIndex('12345678', 'national_id')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns null for absent or empty values', () => {
    expect(blindIndex(null, 'national_id')).toBeNull();
    expect(blindIndex(undefined, 'national_id')).toBeNull();
    expect(blindIndex('', 'national_id')).toBeNull();
    expect(blindIndex('   -  ', 'national_id')).toBeNull();
  });

  it('returns null when no key is configured', () => {
    /* Null is the honest answer: there is no way to compute a keyed token,
     * and a token computed from something else would not match stored rows. */
    installKey(undefined);
    expect(blindIndex('12345678', 'national_id')).toBeNull();
  });

  it('does not reveal the value', () => {
    expect(blindIndex('12345678', 'national_id')).not.toContain('12345678');
  });
});

/* ============================================================
   8. Constant-time comparison
   ============================================================ */

describe('safeEqual', () => {
  it('compares equal strings as equal', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('', '')).toBe(true);
  });

  it('compares different strings as different', () => {
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
  });

  it('does not throw on a length mismatch', () => {
    /*
     * `timingSafeEqual` throws when the buffers differ in length. The length
     * check in front of it is load-bearing: without it, comparing a short
     * attacker-supplied token against a stored one would raise instead of
     * returning false, and a caller without a try/catch would turn an
     * ordinary mismatch into a 500.
     */
    expect(() => safeEqual('a', 'aaaaaaaaaaaaaaaaaaaa')).not.toThrow();
    expect(safeEqual('a', 'aaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('compares multi-byte strings by bytes, not characters', () => {
    expect(safeEqual('é', 'é')).toBe(true);
    expect(safeEqual('é', 'e')).toBe(false);
  });
});
