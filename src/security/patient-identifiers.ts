/**
 * JaliCare HMIS
 * Patient identifier sealing
 *
 * Two columns on `patients` are direct identifiers: `national_id` and
 * `sha_number`. They are read and written through this module and
 * nowhere else, so there is exactly one place that decides whether a
 * value is sealed, and one place that opens it.
 *
 * Every function is a no-op when `FIELD_ENCRYPTION_KEY` is absent, and
 * every decoder passes legacy plaintext through unchanged. Turning
 * encryption on does not require a migration of existing rows; it
 * applies to what is written afterwards, and the readiness report
 * states which rows are still plaintext.
 */

import { blindIndex, decryptField, encryptField, isEncryptedField } from './field-crypto.ts';

export const NATIONAL_ID_INDEX_PURPOSE = 'patients.national_id';
export const SHA_NUMBER_INDEX_PURPOSE = 'patients.sha_number';

export interface PatientIdentifierColumns {
  nationalId?: string | null;
  shaNumber?: string | null;
  nationalIdBlindIndex?: string | null;
  shaNumberBlindIndex?: string | null;
}

/**
 * Prepare a patient row for writing.
 *
 * The blind index is derived from the plaintext before it is sealed,
 * because it cannot be derived afterwards.
 */
export function sealPatientIdentifiers<T extends PatientIdentifierColumns>(
  data: T,
): T & PatientIdentifierColumns {
  const sealed: PatientIdentifierColumns = { ...data };

  if ('nationalId' in data) {
    sealed.nationalIdBlindIndex = blindIndex(data.nationalId ?? null, NATIONAL_ID_INDEX_PURPOSE);
    sealed.nationalId = encryptField(data.nationalId ?? null);
  }

  if ('shaNumber' in data) {
    sealed.shaNumberBlindIndex = blindIndex(data.shaNumber ?? null, SHA_NUMBER_INDEX_PURPOSE);
    sealed.shaNumber = encryptField(data.shaNumber ?? null);
  }

  return sealed as T & PatientIdentifierColumns;
}

/**
 * Open a patient row for display.
 *
 * A decryption failure is not swallowed: returning a wrong identifier
 * is worse than returning an error.
 */
export function openPatientIdentifiers<T extends PatientIdentifierColumns>(row: T): T {
  return {
    ...row,
    nationalId: row.nationalId === undefined ? row.nationalId : decryptField(row.nationalId),
    shaNumber: row.shaNumber === undefined ? row.shaNumber : decryptField(row.shaNumber),
  };
}

export function openPatientRows<T extends PatientIdentifierColumns>(rows: T[]): T[] {
  return rows.map(openPatientIdentifiers);
}

/** True when this row still holds a plaintext identifier. */
export function rowHasPlaintextIdentifier(row: PatientIdentifierColumns): boolean {
  const value = row.nationalId ?? row.shaNumber;

  if (!value) return false;

  return !isEncryptedField(value);
}

/**
 * The lookup token for an exact identifier match, or null when
 * encryption is off (in which case the caller falls back to a plain
 * equality search on the stored value).
 */
export function identifierLookup(
  value: string | null | undefined,
  field: 'nationalId' | 'shaNumber',
): string | null {
  return blindIndex(
    value ?? null,
    field === 'nationalId' ? NATIONAL_ID_INDEX_PURPOSE : SHA_NUMBER_INDEX_PURPOSE,
  );
}
