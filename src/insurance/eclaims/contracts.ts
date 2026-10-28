/**
 * JaliCare HMIS
 * Payer-Independent Insurance Domain Engine — Contracts, State Machines & Audit Helpers
 *
 * Designed so SHA is the primary public scheme adapter today while private
 * insurers / HMO adapters can plug into the exact same domain rules, tables,
 * state machines, and decimal-safe financial math tomorrow.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { formatCents, parseMoneyToCents } from '../../billing/settlement.ts';

export class InsuranceDomainError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, httpStatus = 400, details?: unknown) {
    super(message);
    this.name = 'InsuranceDomainError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export interface InsuranceActorScope {
  tenantId: number;
  facilityId: number;
  userId: number;
  userUid: string;
  userEmail?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export const ECLAIM_STATUSES = [
  'DRAFT',
  'VALIDATION_FAILED',
  'READY_FOR_SUBMISSION',
  'SUBMITTED',
  'ACKNOWLEDGED',
  'REJECTED',
  'PARTIALLY_ADJUDICATED',
  'ADJUDICATED',
  'PAID',
  'DISPUTED',
  'CANCELLED',
] as const;

export type EclaimStatus = (typeof ECLAIM_STATUSES)[number];

/**
 * Authoritative server-side state machine for SHA eClaims.
 * Invalid transitions are rejected with 409 CONFLICT.
 */
export const ECLAIM_STATE_TRANSITIONS: Record<EclaimStatus, readonly EclaimStatus[]> = {
  DRAFT: ['VALIDATION_FAILED', 'READY_FOR_SUBMISSION', 'CANCELLED'],
  VALIDATION_FAILED: ['DRAFT', 'VALIDATION_FAILED', 'READY_FOR_SUBMISSION', 'CANCELLED'],
  READY_FOR_SUBMISSION: [
    'DRAFT',
    'VALIDATION_FAILED',
    'READY_FOR_SUBMISSION',
    'SUBMITTED',
    'CANCELLED',
  ],
  SUBMITTED: [
    'ACKNOWLEDGED',
    'PARTIALLY_ADJUDICATED',
    'ADJUDICATED',
    'REJECTED',
    'VALIDATION_FAILED',
  ],
  ACKNOWLEDGED: [
    'ACKNOWLEDGED',
    'PARTIALLY_ADJUDICATED',
    'ADJUDICATED',
    'REJECTED',
    'PAID',
    'DISPUTED',
  ],
  REJECTED: ['DRAFT', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'DISPUTED', 'CANCELLED'],
  PARTIALLY_ADJUDICATED: ['ADJUDICATED', 'PAID', 'DISPUTED'],
  ADJUDICATED: ['PAID', 'DISPUTED'],
  PAID: ['DISPUTED'],
  DISPUTED: ['PARTIALLY_ADJUDICATED', 'ADJUDICATED', 'PAID', 'REJECTED', 'CANCELLED'],
  CANCELLED: [],
};

export function canTransitionEclaimStatus(from: string, to: EclaimStatus): boolean {
  if (!ECLAIM_STATUSES.includes(from as EclaimStatus)) return false;
  return ECLAIM_STATE_TRANSITIONS[from as EclaimStatus].includes(to);
}

export function assertEclaimTransition(from: string, to: EclaimStatus): void {
  if (!canTransitionEclaimStatus(from, to)) {
    throw new InsuranceDomainError(
      'INVALID_CLAIM_STATE_TRANSITION',
      `Cannot transition eClaim from ${from} to ${to}.`,
      409,
    );
  }
}

export const PREAUTH_STATUSES = [
  'DRAFT',
  'PENDING',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
] as const;

export type PreauthStatus = (typeof PREAUTH_STATUSES)[number];

export const PREAUTH_STATE_TRANSITIONS: Record<PreauthStatus, readonly PreauthStatus[]> = {
  DRAFT: ['PENDING', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'CANCELLED'],
  PENDING: ['PENDING', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  APPROVED: ['PENDING', 'EXPIRED', 'CANCELLED'],
  PARTIALLY_APPROVED: ['PENDING', 'APPROVED', 'EXPIRED', 'CANCELLED'],
  REJECTED: ['DRAFT', 'PENDING', 'CANCELLED'],
  EXPIRED: ['PENDING', 'CANCELLED'],
  CANCELLED: [],
};

export function canTransitionPreauthStatus(from: string, to: PreauthStatus): boolean {
  if (!PREAUTH_STATUSES.includes(from as PreauthStatus)) return false;
  return PREAUTH_STATE_TRANSITIONS[from as PreauthStatus].includes(to);
}

export type BenefitDecision =
  | 'COVERED'
  | 'NOT_COVERED'
  | 'AUTHORIZATION_REQUIRED'
  | 'INCOMPLETE_INFORMATION'
  | 'UNABLE_TO_VERIFY';

export function requireMoneyCents(
  value: string | number | null | undefined,
  label: string,
): number {
  const cents = parseMoneyToCents(value);
  if (cents === null || cents < 0) {
    throw new InsuranceDomainError(
      'INVALID_MONETARY_AMOUNT',
      `${label} must be a non-negative monetary amount with at most 2 decimal places.`,
      400,
    );
  }
  return cents;
}

export function multiplyMoneyCents(unitCents: number, quantity: number): number {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new InsuranceDomainError(
      'INVALID_QUANTITY',
      'Quantity must be a positive whole number.',
      400,
    );
  }
  const total = unitCents * quantity;
  if (!Number.isSafeInteger(total)) {
    throw new InsuranceDomainError('AMOUNT_OVERFLOW', 'Calculated line amount overflowed.', 400);
  }
  return total;
}

export { formatCents, parseMoneyToCents };

/**
 * Extract numeric Kenya KEPH facility level (Level 2 .. Level 6) for accreditation checks.
 */
export function parseFacilityLevelRank(level: string | null | undefined): number | null {
  if (!level) return null;
  const match = level.match(/([1-6])/);
  return match ? Number(match[1]) : null;
}

export function isDateWithinWindow(
  targetDate: string,
  effectiveFrom?: string | null,
  effectiveTo?: string | null,
): boolean {
  if (effectiveFrom && targetDate < effectiveFrom) return false;
  if (effectiveTo && targetDate > effectiveTo) return false;
  return true;
}

/**
 * Enforce tenant + facility boundary on the active facility and return it.
 */
export async function loadScopedFacility(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
) {
  const [facility] = await db
    .select()
    .from(schema.facilities)
    .where(
      and(
        eq(schema.facilities.id, scope.facilityId),
        eq(schema.facilities.tenantId, scope.tenantId),
      ),
    )
    .limit(1);

  if (!facility) {
    throw new InsuranceDomainError(
      'FACILITY_SCOPE_NOT_FOUND',
      'Active facility could not be resolved inside the authenticated tenant.',
      404,
    );
  }
  return facility;
}

/**
 * Enforce tenant boundary on an existing JaliCare patient (no duplicate registration).
 */
export async function loadTenantPatient(tenantId: number, patientId: number) {
  const [patient] = await db
    .select()
    .from(schema.patients)
    .where(and(eq(schema.patients.id, patientId), eq(schema.patients.tenantId, tenantId)))
    .limit(1);

  if (!patient) {
    throw new InsuranceDomainError(
      'PATIENT_NOT_FOUND',
      'Patient does not exist in this tenant.',
      404,
    );
  }
  return patient;
}

/**
 * Write minimal, non-PHI-bloated audit log entries to `audit_logs`.
 * Never logs raw National IDs, full clinical notes, or secrets.
 */
export async function recordInsuranceAuditEvent(
  scope: InsuranceActorScope,
  params: {
    action: string;
    resource: string;
    resourceId: string | number;
    summary: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(schema.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: scope.userUid,
    action: params.action,
    resource: params.resource,
    resourceId: String(params.resourceId),
    details: JSON.stringify(params.summary),
    ipAddress: scope.ipAddress ?? null,
    userAgent: scope.userAgent ?? null,
  });
}
