import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blindIndex,
  decryptField,
  describeFieldEncryption,
  encryptField,
  FieldCryptoError,
  isEncryptedField,
  isFieldEncryptionConfigured,
  normaliseIdentifier,
} from '../security/field-crypto.ts';
import {
  identifierLookup,
  openPatientIdentifiers,
  rowHasPlaintextIdentifier,
  sealPatientIdentifiers,
} from '../security/patient-identifiers.ts';

import { describe, expect, it } from 'vitest';
import { functionBody, queriesSource } from './support/schema-source.ts';

const KEY = randomBytes(32).toString('base64');

function withKey<T>(key: string | null, fn: () => T): T {
  const previous = process.env.FIELD_ENCRYPTION_KEY;

  if (key === null) {
    delete process.env.FIELD_ENCRYPTION_KEY;
  } else {
    process.env.FIELD_ENCRYPTION_KEY = key;
  }

  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.FIELD_ENCRYPTION_KEY;
    } else {
      process.env.FIELD_ENCRYPTION_KEY = previous;
    }
  }
}

describe('Field encryption — regression tests', () => {
  it('run', async () => {
    /* ============================================================
       1. No key means no pretending
       ============================================================ */

    withKey(null, () => {
      expect(
        !isFieldEncryptionConfigured(),
        'Encryption reports "not configured" when FIELD_ENCRYPTION_KEY is absent',
      ).toBe(true);

      const description = describeFieldEncryption();

      expect(description.configured === false, 'The description says the control is off').toBe(
        true,
      );

      /*
       * The critical property: without a key, values pass through. A
       * module that threw here would make every existing deployment
       * unable to read its own data after an upgrade.
       */
      expect(
        encryptField('12345678') === '12345678',
        'Without a key, encryption is a passthrough, not a failure',
      ).toBe(true);

      expect(decryptField('12345678') === '12345678', 'Without a key, plaintext still reads').toBe(
        true,
      );
    });

    /* ============================================================
       2. A wrong key is rejected, not ignored
       ============================================================ */

    withKey('not-even-base64', () => {
      expect(!isFieldEncryptionConfigured(), 'A malformed key does not count as configured').toBe(
        true,
      );
    });

    withKey(randomBytes(16).toString('base64'), () => {
      expect(
        !isFieldEncryptionConfigured(),
        'A 16-byte key is rejected (AES-256 needs 32 bytes)',
      ).toBe(true);
    });

    /* ============================================================
       3. Round trip
       ============================================================ */

    withKey(KEY, () => {
      expect(isFieldEncryptionConfigured(), 'A 32-byte base64 key is accepted').toBe(true);

      const value = '12345678';

      const sealed = encryptField(value) as string;

      expect(sealed !== value, 'The ciphertext is not the plaintext').toBe(true);
      expect(isEncryptedField(sealed), 'The ciphertext carries the version prefix').toBe(true);
      expect(sealed.startsWith('v1:'), 'The prefix is v1').toBe(true);

      expect(decryptField(sealed) === value, 'Decryption returns the original value').toBe(true);

      expect(decryptField(null) === null, 'null stays null').toBe(true);
      expect(decryptField(undefined) === null, 'undefined reads as null').toBe(true);
      expect(decryptField('') === '', 'An empty value stays empty').toBe(true);

      /*
       * Equality leak check: two seals of the same identifier must
       * differ, or the ciphertext itself becomes a lookup key.
       */
      const first = encryptField(value);
      const second = encryptField(value);

      expect(first !== second, 'Two seals of the same value differ (random IV)').toBe(true);
      expect(
        decryptField(first) === decryptField(second),
        'Both still decrypt to the same value',
      ).toBe(true);

      /*
       * Tamper detection. Flip one character of the payload and the
       * authentication tag must fail.
       */
      const parts = (sealed as string).split(':');
      const payload = Buffer.from(parts[3], 'base64');

      payload[0] = payload[0] ^ 0xff;

      const tampered = [parts[0], parts[1], parts[2], payload.toString('base64')].join(':');

      expect(() => decryptField(tampered), 'A modified ciphertext fails authentication').toThrow();

      expect(
        () => decryptField('v1:only:three'),
        'A malformed payload is refused rather than returned',
      ).toThrow();
    });

    /* ============================================================
       4. Key rotation safety
       ============================================================ */

    withKey(KEY, () => {
      const sealed = encryptField('87654321');

      const otherKey = randomBytes(32).toString('base64');

      withKey(otherKey, () => {
        expect(
          () => decryptField(sealed),
          'A value sealed under another key does not decrypt into garbage',
        ).toThrow();
      });

      withKey(null, () => {
        expect(
          () => decryptField(sealed),
          'Reading an encrypted value with no key is an error, never a plaintext fallback',
        ).toThrow();
      });
    });

    /* ============================================================
       5. Blind index
       ============================================================ */

    withKey(KEY, () => {
      const one = blindIndex('12345678', 'patients.national_id') as string;
      const two = blindIndex('12345678', 'patients.national_id');

      expect(one === two, 'The blind index is deterministic').toBe(true);
      expect(one !== '12345678', 'The blind index is not the value').toBe(true);
      expect(one.length >= 32, 'The blind index is a full-length HMAC').toBe(true);

      expect(
        blindIndex('12345678', 'patients.sha_number') !== one,
        'The same value under a different purpose yields a different index',
      ).toBe(true);

      expect(
        blindIndex('12345679', 'patients.national_id') !== one,
        'A different value yields a different index',
      ).toBe(true);

      expect(
        blindIndex(' 12345678 ', 'patients.national_id') === one,
        'The index normalises surrounding whitespace',
      ).toBe(true);

      withKey(null, () => {
        expect(
          blindIndex('12345678', 'patients.national_id') === null,
          'Without a key there is no blind index to write',
        ).toBe(true);
      });
    });

    /* ============================================================
       6. Patient identifier helpers
       ============================================================ */

    withKey(KEY, () => {
      const sealedRow = sealPatientIdentifiers({
        id: 1,
        nationalId: '12345678',
        shaNumber: 'SHA-000-111',
      });

      expect(
        isEncryptedField(sealedRow.nationalId ?? ''),
        'sealPatientIdentifiers seals the national id',
      ).toBe(true);
      expect(
        isEncryptedField(sealedRow.shaNumber ?? ''),
        'sealPatientIdentifiers seals the SHA number',
      ).toBe(true);
      expect(
        typeof sealedRow.nationalIdBlindIndex === 'string' &&
          sealedRow.nationalIdBlindIndex.length > 0,
        'sealPatientIdentifiers writes the blind index',
      ).toBe(true);
      expect(
        !rowHasPlaintextIdentifier(sealedRow),
        'The sealed row no longer holds plaintext',
      ).toBe(true);

      const opened = openPatientIdentifiers(sealedRow);

      expect(opened.nationalId === '12345678', 'Opening restores the national id').toBe(true);
      expect(opened.shaNumber === 'SHA-000-111', 'Opening restores the SHA number').toBe(true);

      /*
       * Legacy rows written before the key existed must keep working.
       * Otherwise switching encryption on is a data-loss event.
       */
      const legacy = openPatientIdentifiers({
        id: 2,
        nationalId: '87654321',
        shaNumber: null,
      });

      expect(legacy.nationalId === '87654321', 'Legacy plaintext reads unchanged').toBe(true);
      expect(legacy.shaNumber === null, 'A null identifier stays null').toBe(true);

      const lookup = identifierLookup('12345678', 'nationalId');

      expect(
        lookup === sealedRow.nationalIdBlindIndex,
        'identifierLookup matches what sealing wrote',
      ).toBe(true);

      expect(
        identifierLookup('', 'nationalId') === null,
        'An empty search term produces no lookup token',
      ).toBe(true);

      /*
       * An error must say what happened. A FieldCryptoError carries a
       * message an operator can act on; a generic Error does not.
       */
      withKey(randomBytes(32).toString('base64'), () => {
        try {
          decryptField(sealedRow.nationalId!);
          throw new Error('decrypt should have thrown');
        } catch (error) {
          expect(
            error instanceof FieldCryptoError,
            'A decryption failure is a FieldCryptoError',
          ).toBe(true);
        }
      });
    });

    /* ============================================================
       7. Normalisation
       ============================================================ */

    expect(
      normaliseIdentifier('  1234-5678 ') === '12345678',
      'Normalisation trims and drops separators',
    ).toBe(true);
    expect(normaliseIdentifier('abc 123') === 'ABC123', 'Normalisation uppercases').toBe(true);
    expect(
      normaliseIdentifier('1234-5678') === '12345678',
      'Separators are dropped, so a national ID typed either way finds the same row',
    ).toBe(true);

    /* ============================================================
       8. Every read path that returns a patient opens the row
       ============================================================ */

    {
      const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

      const code = (path: string) =>
        readFileSync(resolve(root, path), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');

      const queries = queriesSource();

      for (const [fn, label] of [
        ['getPatientById', 'getPatientById'],
        ['getPatientByIdScoped', 'getPatientByIdScoped'],
        ['getPatientsScoped', 'getPatientsScoped'],
      ] as Array<[string, string]>) {
        const block = functionBody(queries, fn);

        expect(
          block.includes('openPatientIdentifiers(') || block.includes('openPatientRows('),
          `${label} opens the identifiers before returning them`,
        ).toBe(true);
      }

      expect(
        /insert\(schema\.patients\)[\s\S]{0,200}sealPatientIdentifiers\(/.test(queries),
        'Patient inserts seal the identifiers',
      ).toBe(true);

      expect(
        /update\(schema\.patients\)[\s\S]{0,300}sealPatientIdentifiers\(/.test(queries),
        'Patient updates seal the identifiers',
      ).toBe(true);

      /*
       * The DHA eligibility call needs the real national ID. If it sent
       * the ciphertext, coverage checks would fail against every patient
       * on a keyed deployment.
       */
      const dha = code('src/integrations/dha/dha.service.ts');

      expect(
        dha.includes('openPatientIdentifiers('),
        'The DHA service opens sealed identifiers before sending them',
      ).toBe(true);
    }

    /* ============================================================
       9. No compiled-in default key
       ============================================================ */

    withKey(null, () => {
      /*
       * If someone adds a fallback constant to make the feature "work
       * out of the box", this fails. A default key is not a secret.
       */
      expect(
        encryptField('sensitive') === 'sensitive',
        'There is no fallback key: absent configuration means absent encryption',
      ).toBe(true);
    });
  });
});
