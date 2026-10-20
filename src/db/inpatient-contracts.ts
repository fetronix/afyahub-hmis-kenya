/**
 * JaliCare HMIS
 * Inpatient status contracts and domain errors.
 *
 * This module is deliberately free of database imports so that the
 * contracts can be unit-tested without a PostgreSQL connection.
 *
 * Both the query layer and the tests import from here, which keeps the
 * server status vocabulary, the UI vocabulary and the test expectations
 * locked together.
 */

/* ============================================================
   DOMAIN ERRORS
   ============================================================ */

export type InpatientErrorCode =
  | 'INVALID_INPUT'
  | 'FACILITY_NOT_FOUND'
  | 'PATIENT_NOT_FOUND'
  | 'ENCOUNTER_NOT_FOUND'
  | 'WARD_NOT_FOUND'
  | 'BED_NOT_FOUND'
  | 'ADMISSION_NOT_FOUND'
  | 'BED_OCCUPIED'
  | 'BED_NOT_AVAILABLE'
  | 'PATIENT_ALREADY_ADMITTED'
  | 'ADMISSION_ALREADY_CLOSED'
  | 'BED_STATUS_CONFLICT'
  | 'BED_STATUS_NOT_ALLOWED';

/**
 * Domain error raised by the inpatient layer.
 *
 * `status` is the HTTP status the route should return:
 *   400 invalid input
 *   404 not found inside the authorised scope
 *   409 conflict with current state (occupied bed, closed admission)
 *
 * Scope violations are NOT raised here: they throw ScopeAccessError,
 * which the route maps to 403.
 */
export class InpatientDomainError extends Error {
  public readonly code: InpatientErrorCode;
  public readonly status: number;

  constructor(
    code: InpatientErrorCode,
    message: string,
    status = 400,
  ) {
    super(message);

    this.name = 'InpatientDomainError';
    this.code = code;
    this.status = status;
  }
}

/* ============================================================
   ADMISSION STATUS
   ============================================================ */

export const ACTIVE_ADMISSION_STATUS = 'Admitted';
export const CLOSED_ADMISSION_STATUS = 'Discharged';

export const ADMISSION_STATUSES = [
  ACTIVE_ADMISSION_STATUS,
  CLOSED_ADMISSION_STATUS,
] as const;

export const ADMISSION_STATUS_SET = new Set<string>(ADMISSION_STATUSES);

/* ============================================================
   BED STATUS
   ============================================================ */

export const BED_STATUSES = [
  'Available',
  'Occupied',
  'Cleaning',
  'Maintenance',
  'Reserved',
] as const;

export const BED_STATUS_SET = new Set<string>(BED_STATUSES);

/**
 * Statuses an authorised user may set directly.
 *
 * 'Occupied' is deliberately excluded: occupancy may only be created by
 * admitting a patient, never by an endpoint that accepts a
 * client-supplied patient ID.
 */
export const BED_STATUS_SETTABLE = new Set<string>([
  'Available',
  'Cleaning',
  'Maintenance',
  'Reserved',
]);
