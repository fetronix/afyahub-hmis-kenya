/**
 * JaliCare HMIS
 * Field encryption — regression tests
 *
 * These exercise the real AES-256-GCM path with a real key. They exist
 * because "encryption configured" is easy to claim and easy to get
 * wrong in ways a source grep cannot see:
 *
 *   - a fixed IV, which makes equal identifiers produce equal
 *     ciphertext and defeats the point;
 *   - a default key compiled into the source, which is not a secret;
 *   - silent decryption failure that returns the plaintext;
 *   - a blind index that is just the value again.
 *
 * Run with: npx tsx src/tests/field-encryption.test.ts
 */

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

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertThrows(fn: () => unknown, label: string): void {
  checks += 1;

  try {
    fn();
  } catch {
    return;
  }

  throw new Error(`FAILED: ${label} (no error was thrown)`);
}

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

function run(): void {
  /* ============================================================
     1. No key means no pretending
     ============================================================ */

  withKey(null, () => {
    assert(
      !isFieldEncryptionConfigured(),
      'Encryption reports "not configured" when FIELD_ENCRYPTION_KEY is absent',
    );

    const description = describeFieldEncryption();

    assert(
      description.configured === false,
      'The description says the control is off',
    );

    /*
     * The critical property: without a key, values pass through. A
     * module that threw here would make every existing deployment
     * unable to read its own data after an upgrade.
     */
    assert(
      encryptField('12345678') === '12345678',
      'Without a key, encryption is a passthrough, not a failure',
    );

    assert(
      decryptField('12345678') === '12345678',
      'Without a key, plaintext still reads',
    );
  });

  /* ============================================================
     2. A wrong key is rejected, not ignored
     ============================================================ */

  withKey('not-even-base64', () => {
    assert(
      !isFieldEncryptionConfigured(),
      'A malformed key does not count as configured',
    );
  });

  withKey(randomBytes(16).toString('base64'), () => {
    assert(
      !isFieldEncryptionConfigured(),
      'A 16-byte key is rejected (AES-256 needs 32 bytes)',
    );
  });

  /* ============================================================
     3. Round trip
     ============================================================ */

  withKey(KEY, () => {
    assert(isFieldEncryptionConfigured(), 'A 32-byte base64 key is accepted');

    const value = '12345678';

    const sealed = encryptField(value) as string;

    assert(sealed !== value, 'The ciphertext is not the plaintext');
    assert(isEncryptedField(sealed), 'The ciphertext carries the version prefix');
    assert(sealed.startsWith('v1:'), 'The prefix is v1');

    assert(
      decryptField(sealed) === value,
      'Decryption returns the original value',
    );

    assert(decryptField(null) === null, 'null stays null');
    assert(decryptField(undefined) === null, 'undefined reads as null');
    assert(decryptField('') === '', 'An empty value stays empty');

    /*
     * Equality leak check: two seals of the same identifier must
     * differ, or the ciphertext itself becomes a lookup key.
     */
    const first = encryptField(value);
    const second = encryptField(value);

    assert(first !== second, 'Two seals of the same value differ (random IV)');
    assert(
      decryptField(first) === decryptField(second),
      'Both still decrypt to the same value',
    );

    /*
     * Tamper detection. Flip one character of the payload and the
     * authentication tag must fail.
     */
    const parts = (sealed as string).split(':');
    const payload = Buffer.from(parts[3], 'base64');

    payload[0] = payload[0] ^ 0xff;

    const tampered = [parts[0], parts[1], parts[2], payload.toString('base64')].join(':');

    assertThrows(
      () => decryptField(tampered),
      'A modified ciphertext fails authentication',
    );

    assertThrows(
      () => decryptField('v1:only:three'),
      'A malformed payload is refused rather than returned',
    );
  });

  /* ============================================================
     4. Key rotation safety
     ============================================================ */

  withKey(KEY, () => {
    const sealed = encryptField('87654321');

    const otherKey = randomBytes(32).toString('base64');

    withKey(otherKey, () => {
      assertThrows(
        () => decryptField(sealed),
        'A value sealed under another key does not decrypt into garbage',
      );
    });

    withKey(null, () => {
      assertThrows(
        () => decryptField(sealed),
        'Reading an encrypted value with no key is an error, never a plaintext fallback',
      );
    });
  });

  /* ============================================================
     5. Blind index
     ============================================================ */

  withKey(KEY, () => {
    const one = blindIndex('12345678', 'patients.national_id') as string;
    const two = blindIndex('12345678', 'patients.national_id');

    assert(one === two, 'The blind index is deterministic');
    assert(one !== '12345678', 'The blind index is not the value');
    assert(one.length >= 32, 'The blind index is a full-length HMAC');

    assert(
      blindIndex('12345678', 'patients.sha_number') !== one,
      'The same value under a different purpose yields a different index',
    );

    assert(
      blindIndex('12345679', 'patients.national_id') !== one,
      'A different value yields a different index',
    );

    assert(
      blindIndex(' 12345678 ', 'patients.national_id') === one,
      'The index normalises surrounding whitespace',
    );

    withKey(null, () => {
      assert(
        blindIndex('12345678', 'patients.national_id') === null,
        'Without a key there is no blind index to write',
      );
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

    assert(
      isEncryptedField(sealedRow.nationalId ?? ''),
      'sealPatientIdentifiers seals the national id',
    );
    assert(
      isEncryptedField(sealedRow.shaNumber ?? ''),
      'sealPatientIdentifiers seals the SHA number',
    );
    assert(
      typeof sealedRow.nationalIdBlindIndex === 'string' &&
        sealedRow.nationalIdBlindIndex.length > 0,
      'sealPatientIdentifiers writes the blind index',
    );
    assert(
      !rowHasPlaintextIdentifier(sealedRow),
      'The sealed row no longer holds plaintext',
    );

    const opened = openPatientIdentifiers(sealedRow);

    assert(opened.nationalId === '12345678', 'Opening restores the national id');
    assert(opened.shaNumber === 'SHA-000-111', 'Opening restores the SHA number');

    /*
     * Legacy rows written before the key existed must keep working.
     * Otherwise switching encryption on is a data-loss event.
     */
    const legacy = openPatientIdentifiers({
      id: 2,
      nationalId: '87654321',
      shaNumber: null,
    });

    assert(legacy.nationalId === '87654321', 'Legacy plaintext reads unchanged');
    assert(legacy.shaNumber === null, 'A null identifier stays null');

    const lookup = identifierLookup('12345678', 'nationalId');

    assert(
      lookup === sealedRow.nationalIdBlindIndex,
      'identifierLookup matches what sealing wrote',
    );

    assert(
      identifierLookup('', 'nationalId') === null,
      'An empty search term produces no lookup token',
    );

    /*
     * An error must say what happened. A FieldCryptoError carries a
     * message an operator can act on; a generic Error does not.
     */
    withKey(randomBytes(32).toString('base64'), () => {
      try {
        decryptField(sealedRow.nationalId!);
        throw new Error('decrypt should have thrown');
      } catch (error) {
        assert(
          error instanceof FieldCryptoError,
          'A decryption failure is a FieldCryptoError',
        );
      }
    });
  });

  /* ============================================================
     7. Normalisation
     ============================================================ */

  assert(
    normaliseIdentifier('  1234-5678 ') === '12345678',
    'Normalisation trims and drops separators',
  );
  assert(
    normaliseIdentifier('abc 123') === 'ABC123',
    'Normalisation uppercases',
  );
  assert(
    normaliseIdentifier('1234-5678') === '12345678',
    'Separators are dropped, so a national ID typed either way finds the same row',
  );

  /* ============================================================
     8. Every read path that returns a patient opens the row
     ============================================================ */

  {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

    const code = (path: string) =>
      readFileSync(resolve(root, path), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    const queries = code('src/db/queries.ts');

    for (const [fn, label] of [
      ['getPatientById', 'getPatientById'],
      ['getPatientByIdScoped', 'getPatientByIdScoped'],
      ['getPatientsScoped', 'getPatientsScoped'],
    ] as Array<[string, string]>) {
      const start = queries.indexOf(`export async function ${fn}(`);
      const next = queries.indexOf('export async function', start + 1);
      const block =
        start === -1
          ? ''
          : queries.slice(start, next === -1 ? start + 6000 : next);

      assert(
        block.includes('openPatientIdentifiers(') || block.includes('openPatientRows('),
        `${label} opens the identifiers before returning them`,
      );
    }

    assert(
      /insert\(schema\.patients\)[\s\S]{0,200}sealPatientIdentifiers\(/.test(queries),
      'Patient inserts seal the identifiers',
    );

    assert(
      /update\(schema\.patients\)[\s\S]{0,300}sealPatientIdentifiers\(/.test(queries),
      'Patient updates seal the identifiers',
    );

    /*
     * The DHA eligibility call needs the real national ID. If it sent
     * the ciphertext, coverage checks would fail against every patient
     * on a keyed deployment.
     */
    const dha = code('src/integrations/dha/dha.service.ts');

    assert(
      dha.includes('openPatientIdentifiers('),
      'The DHA service opens sealed identifiers before sending them',
    );
  }

  /* ============================================================
     9. No compiled-in default key
     ============================================================ */

  withKey(null, () => {
    /*
     * If someone adds a fallback constant to make the feature "work
     * out of the box", this fails. A default key is not a secret.
     */
    assert(
      encryptField('sensitive') === 'sensitive',
      'There is no fallback key: absent configuration means absent encryption',
    );
  });
}

run();

console.log(`\nField encryption: ${checks} assertions passed.`);
