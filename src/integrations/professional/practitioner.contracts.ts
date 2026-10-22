/**
 * JaliCare HMIS
 * Health Worker Registry — contracts
 *
 * SOURCE OF TRUTH
 * ---------------
 * https://hie-docs.dha.go.ke/registries/health-worker-registry
 * https://hie-docs.dha.go.ke/docs/registries/process/professionalSearch
 *
 * Captured 21 October 2026:
 *
 *   GET  {base}/professionals
 *        ?identification_number=<string, required>
 *        ?identification_type=<registration_number | National ID | Alien ID | Refugee ID>
 *        ?regulator=<KMPDC | COC | NCK | PPB>            (optional)
 *
 *   200 -> { message: object }   (the practitioner record)
 *
 * The endpoint enum is what this file follows. Note that the workflow guide
 * also mentions a `license_number` identifier type; the endpoint reference
 * does not list it, so it is deliberately not offered here. If DHA adds it,
 * it belongs in DHA_IDENTIFICATION_TYPES and the field map, not in a guess.
 *
 * WHAT IS *NOT* KNOWN YET
 * -----------------------
 * The reference renders the 200 body as `{ message: object }` without
 * expanding the object's properties. No field names for the practitioner
 * record are published in the machine-readable reference, and DHA does not
 * expose an OpenAPI document at a discoverable path. Rather than invent
 * keys, `practitioner.normalise.ts` reads a declared, ordered set of
 * candidate keys and reports exactly which ones it found. Anything it did
 * not find is reported as unknown and routed to human review — never
 * guessed, and never upgraded into a "verified" status.
 *
 * That is the honest position until the first sandbox call returns a real
 * record: the request mapping is verified, the response mapping is
 * provisional and says so.
 */

/** The regulator enum exactly as published on the registry endpoint. */
export const DHA_REGULATOR_CODES = ['KMPDC', 'COC', 'NCK', 'PPB'] as const;

export type DhaRegulatorCode = (typeof DHA_REGULATOR_CODES)[number];

/** Identification types accepted by /professionals, exactly as published. */
export const PRACTITIONER_IDENTIFICATION_TYPES = [
  'registration_number',
  'National ID',
  'Alien ID',
  'Refugee ID',
] as const;

export type PractitionerIdentificationType =
  (typeof PRACTITIONER_IDENTIFICATION_TYPES)[number];

export const HWR_ENDPOINTS = {
  practitioner: '/professionals',
} as const;

export interface RegulatorDefinition {
  code: DhaRegulatorCode;
  /** Full statutory name, for display only. */
  name: string;
  shortName: string;
  /** Professions this regulator licenses, in JaliCare's own words. */
  professions: string[];
  /**
   * True when the published Health Worker Registry endpoint accepts this
   * regulator in its `regulator` enum. False means no automated check is
   * possible and the manual workflow must be used.
   */
  apiSupported: boolean;
  website: string;
  /** Staff role names in STAFF_ROLE_CATALOGUE that map to this regulator. */
  staffRoles: string[];
}

export const REGULATORS: RegulatorDefinition[] = [
  {
    code: 'KMPDC',
    name: 'Kenya Medical Practitioners and Dentists Council',
    shortName: 'KMPDC',
    professions: ['Medical practitioner', 'Dentist', 'Community oral health officer'],
    apiSupported: true,
    website: 'https://kmpdc.go.ke/',
    staffRoles: ['DOCTOR'],
  },
  {
    code: 'NCK',
    name: 'Nursing Council of Kenya',
    shortName: 'NCK',
    professions: ['Registered nurse', 'Midwife', 'Enrolled nurse'],
    apiSupported: true,
    website: 'https://nckenya.com/',
    staffRoles: ['NURSE'],
  },
  {
    code: 'COC',
    name: 'Clinical Officers Council',
    shortName: 'COC',
    professions: ['Clinical officer'],
    apiSupported: true,
    website: 'https://clinicalofficerscouncil.org/',
    staffRoles: ['CLINICAL_OFFICER'],
  },
  {
    code: 'PPB',
    name: 'Pharmacy and Poisons Board',
    shortName: 'PPB',
    professions: ['Pharmacist', 'Pharmaceutical technologist'],
    apiSupported: true,
    website: 'https://www.pharmacyboardkenya.org/',
    staffRoles: ['PHARMACIST'],
  },
];

/**
 * Staff roles that require a professional credential before an invitation
 * can be issued.
 *
 * Laboratory technologists are regulated by the Kenya Medical Laboratory
 * Technicians and Technologists Board, which is **not** in the published
 * regulator enum. There is therefore no authorised automated check for
 * them, and they are excluded rather than pointed at an invented endpoint.
 */
export const CLINICAL_STAFF_ROLES: string[] = [
  'DOCTOR',
  'CLINICAL_OFFICER',
  'NURSE',
  'PHARMACIST',
];

export function regulatorByCode(code: string | null | undefined) {
  if (!code) return null;

  return REGULATORS.find((regulator) => regulator.code === code.toUpperCase()) ?? null;
}

export function regulatorForStaffRole(roleName: string | null | undefined) {
  if (!roleName) return null;

  const upper = roleName.trim().toUpperCase();

  return REGULATORS.find((regulator) => regulator.staffRoles.includes(upper)) ?? null;
}

export function requiresProfessionalVerification(roleName: string | null | undefined): boolean {
  if (!roleName) return false;

  return CLINICAL_STAFF_ROLES.includes(roleName.trim().toUpperCase());
}

/* ============================================================
   VERIFICATION STATUS
   ============================================================ */

/**
 * The status vocabulary requested for this workflow.
 *
 * Two of these are deliberately distinct:
 *
 *   REGISTRATION_VERIFIED  the registry knows this person and the
 *                          registration is live.
 *   LICENCE_CONFIRMED      an explicit practising licence was returned
 *                          and it is current.
 *
 * A registration is not a licence. Kenya requires both, and conflating
 * them is how an unlicensed practitioner ends up on a rota.
 */
export type VerificationStatus =
  | 'NOT_VERIFIED'
  | 'PENDING'
  | 'REGISTRATION_VERIFIED'
  | 'LICENCE_CONFIRMED'
  | 'LICENCE_EXPIRED'
  | 'REGISTRATION_INACTIVE'
  | 'IDENTITY_MISMATCH'
  | 'RECORD_NOT_FOUND'
  | 'SERVICE_UNAVAILABLE'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'MANUALLY_VERIFIED';

/** Statuses that permit a staff invitation for a clinical role. */
export const INVITABLE_STATUSES: VerificationStatus[] = [
  'REGISTRATION_VERIFIED',
  'LICENCE_CONFIRMED',
  'MANUALLY_VERIFIED',
];

export function isInvitableStatus(status: string | null | undefined): boolean {
  if (!status) return false;

  return INVITABLE_STATUSES.includes(status as VerificationStatus);
}

export const STATUS_LABELS: Record<VerificationStatus, string> = {
  NOT_VERIFIED: 'Not verified',
  PENDING: 'Verification pending',
  REGISTRATION_VERIFIED: 'Registration verified',
  LICENCE_CONFIRMED: 'Current licence confirmed',
  LICENCE_EXPIRED: 'Licence expired',
  REGISTRATION_INACTIVE: 'Registration inactive or withdrawn',
  IDENTITY_MISMATCH: 'Identity mismatch',
  RECORD_NOT_FOUND: 'Record not found',
  SERVICE_UNAVAILABLE: 'Verification service unavailable',
  MANUAL_REVIEW_REQUIRED: 'Manual review required',
  MANUALLY_VERIFIED: 'Manually verified against regulator record',
};

/** Statuses an administrator must resolve by hand. */
export const REVIEW_STATUSES: VerificationStatus[] = [
  'IDENTITY_MISMATCH',
  'MANUAL_REVIEW_REQUIRED',
  'RECORD_NOT_FOUND',
];

/**
 * The normalised practitioner record.
 *
 * Every field here is `null` when the response did not carry it. Null
 * means "the response did not say", not "no".
 */
export interface PractitionerRecord {
  fullName: string | null;
  registrationNumber: string | null;
  licenceNumber: string | null;
  regulator: string | null;
  profession: string | null;
  specialty: string | null;
  /** Raw status strings exactly as returned, never re-worded. */
  registrationStatus: string | null;
  licenceStatus: string | null;
  licenceExpiry: string | null;
  registrationDate: string | null;
  /** External identifier for the record, if the response carries one. */
  externalId: string | null;
}

export interface NormalisationResult {
  record: PractitionerRecord;
  status: VerificationStatus;
  /** Candidate keys that were present, for the audit trail. */
  matchedFields: string[];
  /** Concerns a human has to look at, in plain language. */
  warnings: string[];
  /**
   * 'provisional' until the response shape has been confirmed against a
   * live sandbox record. The UI and the readiness report both show it.
   */
  mapping: 'provisional' | 'confirmed';
  /** Names that could not be interpreted, keys only — never values. */
  unrecognisedKeys: string[];
}
