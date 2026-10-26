/**
 * JaliCare HMIS
 * Health Worker Registry — response normalisation
 *
 * Turns whatever `/professionals` returns into one of the statuses the
 * workflow is allowed to use, and refuses to upgrade a partial answer
 * into a confident one.
 *
 * Two rules decide almost every branch here:
 *
 *   1. A registration is not a licence. `REGISTRATION_VERIFIED` says the
 *      regulator's register contains this person. `LICENCE_CONFIRMED` is
 *      only returned when an explicit licence status was present, said it
 *      is active, and no expiry date contradicts it.
 *
 *   2. Absence of evidence is not a failed check. If a field is missing,
 *      that is reported as unknown and routed to manual review. It is
 *      never shown to an administrator as "not registered".
 *
 * The response schema is not published in a machine-readable form, so the
 * candidate key lists below are declared explicitly and every match is
 * recorded. `mapping: 'provisional'` travels with the result until the
 * shape has been confirmed against a real sandbox record.
 */

import type {
  NormalisationResult,
  PractitionerRecord,
  VerificationStatus,
} from './practitioner.contracts.ts';

type Bag = Record<string, unknown>;

/**
 * Candidate keys, in priority order. These are *candidate* names, not
 * claims about the published schema: whatever is found is recorded in
 * `matchedFields`, and anything unrecognised is counted, never guessed.
 */
const KEYS = {
  fullName: ['fullName', 'full_name', 'name', 'practitionerName', 'practitioner_name'],
  firstName: ['firstName', 'first_name', 'givenName', 'given_name'],
  lastName: ['lastName', 'last_name', 'surname', 'familyName', 'family_name'],
  registrationNumber: [
    'registrationNumber',
    'registration_number',
    'regNumber',
    'reg_number',
    'registrationNo',
    'registration_no',
  ],
  licenceNumber: [
    'licenseNumber',
    'licenceNumber',
    'license_number',
    'licence_number',
    'practiceLicenseNumber',
    'practice_license_number',
  ],
  regulator: ['regulator', 'regulatoryBody', 'regulatory_body', 'council', 'regulatorCode'],
  profession: [
    'profession',
    'cadre',
    'professionalCategory',
    'professional_category',
    'category',
    'designation',
  ],
  specialty: ['specialty', 'speciality', 'specialization', 'specialisation', 'specialties'],
  registrationStatus: ['registrationStatus', 'registration_status', 'regStatus', 'reg_status'],
  licenceStatus: [
    'licenseStatus',
    'licenceStatus',
    'license_status',
    'licence_status',
    'practiceLicenseStatus',
    'practice_license_status',
  ],
  licenceExpiry: [
    'licenseExpiryDate',
    'licenceExpiryDate',
    'license_expiry_date',
    'licence_expiry_date',
    'licenseExpiry',
    'licenceExpiry',
    'expiryDate',
    'expiry_date',
    'licenseValidTo',
  ],
  registrationDate: ['registrationDate', 'registration_date', 'dateRegistered', 'date_registered'],
  externalId: ['id', 'practitionerId', 'practitioner_id', 'workerId', 'worker_id', 'uuid'],
} as const;

function isBag(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function read(bag: Bag, keys: readonly string[]): { value: string | null; key: string | null } {
  for (const key of keys) {
    const value = asText(bag[key]);

    if (value) return { value, key };
  }

  return { value: null, key: null };
}

/** Strip the envelope and unwrap single-element arrays. */
export function unwrapRecord(message: unknown): {
  bag: Bag | null;
  multiple: boolean;
} {
  if (Array.isArray(message)) {
    if (message.length === 1 && isBag(message[0])) {
      return { bag: message[0], multiple: false };
    }

    return { bag: null, multiple: message.length > 1 };
  }

  if (!isBag(message)) return { bag: null, multiple: false };

  /* Some envelopes nest the record under data / result / results. */
  for (const key of ['data', 'result', 'record', 'practitioner']) {
    const nested = message[key];

    if (isBag(nested)) return unwrapRecord(nested);
  }

  if (Object.keys(message).length === 0) return { bag: null, multiple: false };

  return { bag: message, multiple: false };
}

const HONORIFICS = new Set(['dr', 'prof', 'mr', 'mrs', 'ms', 'miss', 'sir']);

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/[\s'-]+/)
    .filter((token) => token.length >= 2 && !HONORIFICS.has(token));
}

/**
 * Do two names plausibly describe the same person?
 *
 * Deliberately generous: any shared token of two or more characters is
 * enough, because a mismatch is a serious accusation and a false positive
 * costs an administrator a minute of review. A clear disagreement — no
 * shared token at all — is what triggers IDENTITY_MISMATCH.
 */
export function namesPlausiblyMatch(a: string, b: string): boolean {
  const left = nameTokens(a);
  const right = nameTokens(b);

  if (left.length === 0 || right.length === 0) return true;

  return left.some((token) => right.includes(token));
}

function parseDateish(value: string | null): Date | null {
  if (!value) return null;

  const direct = new Date(value);

  if (!Number.isNaN(direct.getTime())) return direct;

  /* dd/mm/yyyy — common on Kenyan regulator records. */
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

  if (match) {
    const [, day, month, year] = match;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

const INACTIVE_WORDS = /inactive|withdrawn|suspend|revok|cancel|struck|deregist|removed/i;
const EXPIRED_WORDS = /expired|expiry|lapsed|not\s*current/i;
const ACTIVE_WORDS =
  /active|valid|current|registered|licensed|licenced|good\s*standing|in\s*good\s*standing/i;

export interface NormaliseInput {
  /** The `message` member of the response body. */
  message: unknown;
  regulator: string;
  identificationNumber: string;
  /** Name entered by the administrator, when known. */
  expectedFullName?: string | null;
  /** Injectable clock so tests do not depend on today's date. */
  now?: Date;
}

export function normalisePractitioner(input: NormaliseInput): NormalisationResult {
  const now = input.now ?? new Date();
  const { bag, multiple } = unwrapRecord(input.message);

  const emptyRecord: PractitionerRecord = {
    fullName: null,
    registrationNumber: null,
    licenceNumber: null,
    regulator: null,
    profession: null,
    specialty: null,
    registrationStatus: null,
    licenceStatus: null,
    licenceExpiry: null,
    registrationDate: null,
    externalId: null,
  };

  if (multiple) {
    return {
      record: emptyRecord,
      status: 'MANUAL_REVIEW_REQUIRED',
      matchedFields: [],
      warnings: [
        'The registry returned more than one practitioner for this identifier. Confirm which record belongs to the applicant before continuing.',
      ],
      mapping: 'provisional',
      unrecognisedKeys: [],
    };
  }

  if (!bag) {
    return {
      record: emptyRecord,
      status: 'RECORD_NOT_FOUND',
      matchedFields: [],
      warnings: [
        `The registry returned no practitioner for ${input.regulator} registration number ${input.identificationNumber}.`,
      ],
      mapping: 'provisional',
      unrecognisedKeys: [],
    };
  }

  const matchedFields: string[] = [];
  const warnings: string[] = [];

  const take = (keys: readonly string[]): string | null => {
    const found = read(bag, keys);

    if (found.key) matchedFields.push(found.key);

    return found.value;
  };

  const fullNameFromParts = [read(bag, KEYS.firstName), read(bag, KEYS.lastName)]
    .filter((part) => part.value)
    .map((part) => part.value as string);

  for (const part of [read(bag, KEYS.firstName), read(bag, KEYS.lastName)]) {
    if (part.key) matchedFields.push(part.key);
  }

  const record: PractitionerRecord = {
    fullName:
      read(bag, KEYS.fullName).value ??
      (fullNameFromParts.length > 0 ? fullNameFromParts.join(' ') : null),
    registrationNumber: take(KEYS.registrationNumber),
    licenceNumber: take(KEYS.licenceNumber),
    regulator: take(KEYS.regulator),
    profession: take(KEYS.profession),
    specialty: take(KEYS.specialty),
    registrationStatus: take(KEYS.registrationStatus),
    licenceStatus: take(KEYS.licenceStatus),
    licenceExpiry: take(KEYS.licenceExpiry),
    registrationDate: take(KEYS.registrationDate),
    externalId: take(KEYS.externalId),
  };

  if (read(bag, KEYS.fullName).key) {
    matchedFields.push(read(bag, KEYS.fullName).key as string);
  }

  const unrecognisedKeys = Object.keys(bag).filter((key) => !matchedFields.includes(key));

  /* ----------------------------------------------------------
     Identity
     ---------------------------------------------------------- */

  let identityMismatch = false;

  if (record.fullName && input.expectedFullName) {
    if (!namesPlausiblyMatch(record.fullName, input.expectedFullName)) {
      identityMismatch = true;
      warnings.push(
        `The registry name (${record.fullName}) does not match the name entered (${input.expectedFullName}).`,
      );
    } else if (
      !nameTokens(record.fullName).every((token) =>
        nameTokens(input.expectedFullName as string).includes(token),
      )
    ) {
      warnings.push(
        `The registry name (${record.fullName}) differs in part from the name entered. Confirm it is the same person.`,
      );
    }
  } else if (!record.fullName) {
    warnings.push(
      'The response did not include a practitioner name, so identity could not be compared.',
    );
  }

  if (
    record.registrationNumber &&
    record.registrationNumber.replace(/\s+/g, '').toLowerCase() !==
      input.identificationNumber.replace(/\s+/g, '').toLowerCase()
  ) {
    warnings.push(
      'The registration number returned differs from the one submitted. Confirm the number was typed correctly.',
    );
  }

  /* ----------------------------------------------------------
     Registration status
     ---------------------------------------------------------- */

  const registrationSaysInactive =
    record.registrationStatus !== null && INACTIVE_WORDS.test(record.registrationStatus);

  if (registrationSaysInactive) {
    return {
      record,
      status: 'REGISTRATION_INACTIVE',
      matchedFields,
      warnings: [
        ...warnings,
        `The register reports this registration as "${record.registrationStatus}".`,
      ],
      mapping: 'provisional',
      unrecognisedKeys,
    };
  }

  /* ----------------------------------------------------------
     Licence status
     ---------------------------------------------------------- */

  const expiryDate = parseDateish(record.licenceExpiry);
  const expiryInPast = expiryDate !== null && expiryDate.getTime() < now.getTime();

  const licenceSaysExpired =
    record.licenceStatus !== null &&
    (EXPIRED_WORDS.test(record.licenceStatus) || INACTIVE_WORDS.test(record.licenceStatus));

  const licenceSaysActive =
    record.licenceStatus !== null && ACTIVE_WORDS.test(record.licenceStatus);

  let status: VerificationStatus = 'REGISTRATION_VERIFIED';

  if (expiryInPast || licenceSaysExpired) {
    status = 'LICENCE_EXPIRED';

    if (expiryInPast && record.licenceExpiry) {
      warnings.push(`The licence expired on ${record.licenceExpiry}.`);
    }

    if (licenceSaysExpired && record.licenceStatus) {
      warnings.push(`The register reports the licence as "${record.licenceStatus}".`);
    }
  } else if (licenceSaysActive) {
    status = 'LICENCE_CONFIRMED';
  } else if (record.licenceNumber || record.licenceStatus) {
    warnings.push(
      'A licence was returned but its currency could not be established from the response. Confirm the licence dates before relying on it.',
    );
  } else {
    warnings.push(
      'Registration was found, but no practising licence was returned. A registration is not a licence.',
    );
  }

  if (identityMismatch) status = 'IDENTITY_MISMATCH';

  /*
   * Nothing usable came back: no name, no status, no dates. This is not a
   * failed check and it is certainly not a verified one.
   */
  const nothingUseful =
    !record.fullName &&
    !record.registrationStatus &&
    !record.licenceStatus &&
    !record.licenceExpiry;

  if (nothingUseful && !identityMismatch) {
    status = 'MANUAL_REVIEW_REQUIRED';
    warnings.push(
      'The response did not contain any field this build recognises, so no status could be established. Send it for manual review; do not treat it as verified.',
    );
  }

  return {
    record,
    status,
    matchedFields: Array.from(new Set(matchedFields)),
    warnings,
    mapping: 'provisional',
    unrecognisedKeys,
  };
}
