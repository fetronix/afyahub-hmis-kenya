import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { hasAllPermissions, hasAnyPermission } from '../auth/authorization.service.ts';
import { requireFacilityScope, requireTenantScope, resolveFacilityScope, ScopeAccessError } from '../auth/scope.service.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { InpatientDomainError } from '../db/inpatient-contracts.ts';
import { requireInpatientFacility, requirePositiveId } from '../db/queries/shared.ts';
import { validTimezone } from '../dashboard/timezone.ts';
import { lockChargeIdentity, recordChargeAttempt } from '../billing/charge-attempts.ts';
import { buildIdempotencyKey, type ChargeRequest } from '../billing/billing.service.ts';
import { parseMoneyToCents, formatCents } from '../billing/settlement.ts';
import { BedPolicyError, validBedPolicy, type BedNightPolicy } from './bed-night-policy.ts';
import { databaseNow, readBedEvidence, type AdmissionRow, type BedExecutor, type OccupancyRow } from './bed-evidence.ts';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const invalid = (message: string, status = 400) => new InpatientDomainError('INVALID_INPUT', message, status);
const financialPermission = (context: AuthorizationContext, permissions: string[]) => {
  if (!hasAllPermissions(context, permissions)) throw invalid('Facility inpatient and billing permissions are required.', 403);
};
const text = (v: unknown, label: string, max = 500) => {
  if (typeof v !== 'string' || v.trim().length < 3 || v.trim().length > max)
    throw invalid(`${label} must be 3–${max} characters.`);
  return v.trim();
};

/** Match the module-gated facility to the admission, including tenant-level users. */
export function requireSelectedAdmissionFacility(context: AuthorizationContext, admission: { tenantId: number; facilityId: number }, requestedFacilityId?: number) {
  requireTenantScope(context, admission.tenantId);
  requireFacilityScope(context, admission.tenantId, admission.facilityId);
  if (resolveFacilityScope(context, requestedFacilityId) !== admission.facilityId)
    throw new ScopeAccessError('The admission is not in the selected facility.', 'FACILITY_SCOPE_MISMATCH');
}

export async function getBedBillingPolicy(context: AuthorizationContext, requestedFacilityId?: number) {
  const facility = await requireInpatientFacility(context, requestedFacilityId);
  const [policy] = await db.select().from(schema.inpatientBedBillingPolicies)
    .where(and(eq(schema.inpatientBedBillingPolicies.tenantId, facility.tenantId), eq(schema.inpatientBedBillingPolicies.facilityId, facility.id))).limit(1);
  return policy ?? null;
}

export async function setBedBillingPolicy(context: AuthorizationContext, input: {
  facilityId?: unknown; cutoffMinutes?: unknown; graceMinutes?: unknown; sameDayRule?: unknown; expectedRevision?: unknown; reason?: unknown;
}) {
  financialPermission(context, ['inpatient.wards.update', 'billing.update']);
  const requestedFacilityId = input.facilityId == null ? undefined : requirePositiveId(input.facilityId, 'facility ID');
  const facility = await requireInpatientFacility(context, requestedFacilityId);
  const cutoffMinutes = input.cutoffMinutes, graceMinutes = input.graceMinutes;
  const sameDayRule = input.sameDayRule;
  const reason = text(input.reason, 'Reason');
  if (typeof cutoffMinutes !== 'number' || typeof graceMinutes !== 'number' ||
      !Number.isInteger(cutoffMinutes) || cutoffMinutes < 0 || cutoffMinutes > 1439 ||
      !Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 1439 ||
      (sameDayRule !== 'ONE' && sameDayRule !== 'ZERO')) throw invalid('Enter a cutoff, grace period and same-day rule.');
  return db.transaction(async (tx) => {
    const [lockedFacility] = await tx.select({ id: schema.facilities.id, timezone: schema.facilities.timezone, tenantTimezone: schema.tenants.timezone })
      .from(schema.facilities).innerJoin(schema.tenants, eq(schema.facilities.tenantId, schema.tenants.id))
      .where(and(eq(schema.facilities.id, facility.id), eq(schema.facilities.tenantId, facility.tenantId)))
      .for('update', { of: schema.facilities });
    if (!lockedFacility || !validTimezone(lockedFacility.timezone ?? lockedFacility.tenantTimezone))
      throw invalid('Set a valid facility or tenant timezone before configuring bed billing.');
    const [old] = await tx.select().from(schema.inpatientBedBillingPolicies)
      .where(eq(schema.inpatientBedBillingPolicies.facilityId, facility.id)).for('update');
    if ((old && input.expectedRevision !== old.revision) || (!old && input.expectedRevision != null))
      throw invalid('The bed billing policy changed; refresh and review before saving.', 409);
    const [saved] = old
      ? await tx.update(schema.inpatientBedBillingPolicies).set({ cutoffMinutes, graceMinutes, sameDayRule, revision: old.revision + 1, updatedByUserId: context.userId, updatedAt: new Date() }).where(eq(schema.inpatientBedBillingPolicies.id, old.id)).returning()
      : await tx.insert(schema.inpatientBedBillingPolicies).values({ tenantId: facility.tenantId, facilityId: facility.id, cutoffMinutes, graceMinutes, sameDayRule, updatedByUserId: context.userId }).returning();
    await tx.insert(schema.auditLogs).values({ tenantId: facility.tenantId, facilityId: facility.id, userId: String(context.userId), action: old ? 'UPDATE' : 'CREATE', resource: 'InpatientBedBillingPolicy', resourceId: String(saved.id), details: JSON.stringify({ before: old ? { cutoffMinutes: old.cutoffMinutes, graceMinutes: old.graceMinutes, sameDayRule: old.sameDayRule, revision: old.revision } : null, after: { cutoffMinutes, graceMinutes, sameDayRule, revision: saved.revision }, reason }) });
    return saved;
  });
}

export async function captureBedStay(tx: Transaction, context: AuthorizationContext, admission: AdmissionRow, bed: typeof schema.beds.$inferSelect, ward: typeof schema.wards.$inferSelect, at: Date, manualAdmissionTime: boolean) {
  const [scope] = await tx.select({ timezone: schema.facilities.timezone, tenantTimezone: schema.tenants.timezone })
    .from(schema.facilities).innerJoin(schema.tenants, eq(schema.facilities.tenantId, schema.tenants.id))
    .where(and(eq(schema.facilities.id, admission.facilityId), eq(schema.facilities.tenantId, admission.tenantId)))
    .for('share', { of: schema.facilities });
  const [policy] = await tx.select().from(schema.inpatientBedBillingPolicies)
    .where(and(eq(schema.inpatientBedBillingPolicies.tenantId, admission.tenantId), eq(schema.inpatientBedBillingPolicies.facilityId, admission.facilityId))).for('share');
  const zone = scope?.timezone ?? scope?.tenantTimezone;
  await tx.insert(schema.inpatientBedStaySnapshots).values({
    admissionId: admission.id, tenantId: admission.tenantId, facilityId: admission.facilityId, patientId: admission.patientId,
    timezoneSnapshot: validTimezone(zone) ? zone : null,
    cutoffMinutes: policy?.cutoffMinutes ?? null, graceMinutes: policy?.graceMinutes ?? null,
    sameDayRule: policy?.sameDayRule ?? null, policyRevision: policy?.revision ?? null,
    manualAdmissionTime,
  });
  await captureBedPeriod(tx, context, admission, bed, ward, at);
}

export async function captureBedPeriod(tx: Transaction, context: AuthorizationContext, admission: AdmissionRow, bed: typeof schema.beds.$inferSelect, ward: typeof schema.wards.$inferSelect, at: Date) {
  const price = !bed.dailyChargeReviewRequired && (parseMoneyToCents(bed.dailyCharge) ?? 0) > 0 ? bed.dailyCharge : null;
  return tx.insert(schema.inpatientBedOccupancies).values({
    admissionId: admission.id, tenantId: admission.tenantId, facilityId: admission.facilityId, patientId: admission.patientId,
    wardId: ward.id, bedId: bed.id, startedAt: at, dailyRateSnapshot: price,
    bedNumberSnapshot: bed.bedNumber, bedTypeSnapshot: bed.bedType, wardNameSnapshot: ward.name,
    recordedByUserId: context.userId,
  }).returning();
}

/** Legacy stays may have no captured period. Do not guess their start or rate. */
export async function closeCurrentBedPeriod(tx: Transaction, admission: AdmissionRow, at: Date) {
  const rows = await tx.select().from(schema.inpatientBedOccupancies)
    .where(and(eq(schema.inpatientBedOccupancies.admissionId, admission.id), isNull(schema.inpatientBedOccupancies.reviewId), isNull(schema.inpatientBedOccupancies.endedAt))).for('update');
  if (rows.length > 1) throw new Error('BED_OPEN_PERIOD_CONFLICT');
  if (!rows.length) return false;
  const row = rows[0];
  if (row.bedId !== admission.bedId || row.wardId !== admission.wardId || row.patientId !== admission.patientId || at < row.startedAt)
    throw new InpatientDomainError('BED_STATUS_CONFLICT', 'Recorded bed occupancy conflicts with the admission; review is required.', 409);
  await tx.update(schema.inpatientBedOccupancies).set({ endedAt: at }).where(eq(schema.inpatientBedOccupancies.id, row.id));
  return true;
}

function requestFor(admission: AdmissionRow, date: string, occupancy?: OccupancyRow): ChargeRequest {
  return {
    tenantId: admission.tenantId, facilityId: admission.facilityId, patientId: admission.patientId,
    encounterId: admission.encounterId ?? null, sourceType: 'BED_DAY', sourceId: admission.id,
    idempotencySuffix: date, serviceDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    codes: [], family: 'BED_DAY', serviceName: 'bed occupancy', itemType: 'Inpatient', quantity: 1,
    description: occupancy ? `${occupancy.wardNameSnapshot} / ${occupancy.bedNumberSnapshot} — ${date}` : 'Bed occupancy requires review',
    ...(occupancy ? { serviceRef: { type: 'BED_DAY' as const, id: occupancy.wardId }, wardName: occupancy.wardNameSnapshot } : {}),
  };
}

async function queueReview(tx: Transaction, admission: AdmissionRow, problem: BedPolicyError) {
  const request = requestFor(admission, 'REVIEW');
  await lockChargeIdentity(tx, admission.facilityId, 'BED_DAY', admission.id, 'REVIEW');
  const id = await recordChargeAttempt(tx, request, { charged: false, reason: 'BED_OCCUPANCY_REVIEW', diagnosis: { code: problem.code, label: 'Bed occupancy review' }, message: problem.message });
  if (id === null) throw new Error('BED_BILLING_QUEUE_UNAVAILABLE');
  return { nights: 0, requests: [] as ChargeRequest[], review: { code: problem.code, message: problem.message } };
}

/** Atomically save all cutoff, rate and amount evidence and their queue identities. */
export async function stageDischargedBedNights(tx: Transaction, admission: AdmissionRow, at: Date) {
  let evidence: Awaited<ReturnType<typeof readBedEvidence>>;
  try {
    evidence = await readBedEvidence(tx, admission, at);
    if (evidence.nights.some((night) => (parseMoneyToCents(night.rate) ?? 0) <= 0))
      throw new BedPolicyError('BED_RATE_REVIEW_REQUIRED', 'A positive, confirmed daily bed rate was not captured for every billable period.');
  } catch (error) {
    if (error instanceof BedPolicyError) return queueReview(tx, admission, error);
    throw error;
  }
  const requests: ChargeRequest[] = [];
  for (const night of evidence.nights) {
    const occupancy = evidence.periods.find((p) => p.id === night.occupancyId)!;
    const request = requestFor(admission, night.date, occupancy);
    await lockChargeIdentity(tx, admission.facilityId, 'BED_DAY', admission.id, night.date);
    const [saved] = await tx.insert(schema.inpatientBedNights).values({
      admissionId: admission.id, tenantId: admission.tenantId, facilityId: admission.facilityId, patientId: admission.patientId,
      occupancyId: occupancy.id, billingDate: night.date, cutoffAt: night.cutoffAt,
      unitPriceSnapshot: night.rate, totalSnapshot: night.rate,
    }).onConflictDoNothing().returning();
    if (!saved) {
      const [existing] = await tx.select().from(schema.inpatientBedNights).where(and(eq(schema.inpatientBedNights.admissionId, admission.id), eq(schema.inpatientBedNights.billingDate, night.date))).limit(1);
      if (!existing || existing.occupancyId !== occupancy.id || existing.unitPriceSnapshot !== night.rate || existing.cutoffAt?.getTime() !== night.cutoffAt?.getTime())
        throw new Error('BED_NIGHT_EVIDENCE_CONFLICT');
    }
    const [item] = await tx.select({ id: schema.billingItems.id }).from(schema.billingItems).where(eq(schema.billingItems.idempotencyKey, buildIdempotencyKey(request))).limit(1);
    const attempts = await tx.select({ status: schema.billingChargeAttempts.status }).from(schema.billingChargeAttempts).where(and(
      eq(schema.billingChargeAttempts.tenantId, admission.tenantId), eq(schema.billingChargeAttempts.facilityId, admission.facilityId),
      eq(schema.billingChargeAttempts.sourceType, 'BED_DAY'), eq(schema.billingChargeAttempts.sourceId, admission.id), eq(schema.billingChargeAttempts.idempotencySuffix, night.date)));
    if (!item && !attempts.some((row) => row.status !== 'SUPERSEDED')) {
      const queued = await recordChargeAttempt(tx, request, { charged: false, reason: 'BED_OCCUPANCY_REVIEW', message: 'Bed-night evidence recorded; invoice billing pending.' });
      if (queued === null) throw new Error('BED_BILLING_QUEUE_UNAVAILABLE');
    }
    requests.push(request);
  }
  return { nights: requests.length, requests, review: null };
}

/** Mark work staged only in the transaction that durably saved the nights/review queue. */
export async function markBedBillingStaged(tx: Transaction, admission: AdmissionRow, userId: number) {
  const [marked] = await tx.update(schema.inpatientBedBillingWork).set({ stagedAt: sql`clock_timestamp()` })
    .where(and(eq(schema.inpatientBedBillingWork.admissionId, admission.id),
      eq(schema.inpatientBedBillingWork.tenantId, admission.tenantId),
      eq(schema.inpatientBedBillingWork.facilityId, admission.facilityId),
      eq(schema.inpatientBedBillingWork.patientId, admission.patientId),
      isNull(schema.inpatientBedBillingWork.stagedAt)))
    .returning({ admissionId: schema.inpatientBedBillingWork.admissionId });
  if (marked) await tx.insert(schema.auditLogs).values({
    tenantId: admission.tenantId, facilityId: admission.facilityId, userId: String(userId),
    action: 'UPDATE', resource: 'InpatientBedBillingWork', resourceId: String(admission.id),
    details: 'Bed billing evidence and queue identities staged.',
  });
}

const canInspectBedAttempts = (context: AuthorizationContext) =>
  hasAnyPermission(context, ['billing.read', 'billing.create', 'billing.update']);

/** A scoped index of admissions with unresolved bed work, not the generic tariff queue. */
export async function getUnresolvedBedBilling(context: AuthorizationContext, requestedFacilityId?: number, offset = 0) {
  if (!hasAllPermissions(context, ['inpatient.read']) || !canInspectBedAttempts(context))
    throw invalid('Inpatient and facility billing permissions are required.', 403);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000)
    throw invalid('Enter a valid bed billing page offset.');
  const facility = await requireInpatientFacility(context, requestedFacilityId);
  const lastActivity = sql`greatest(max(${schema.billingChargeAttempts.lastAttemptAt}), max(${schema.inpatientBedBillingWork.createdAt}))`;
  const pageSize = 50;
  const rows = await db.select({
    admissionId: schema.admissions.id,
    admissionStatus: schema.admissions.status,
    pendingAttempts: sql<number>`count(${schema.billingChargeAttempts.id})::int`,
    stagingPending: sql<boolean>`bool_or(${schema.inpatientBedBillingWork.admissionId} is not null and ${schema.inpatientBedBillingWork.stagedAt} is null)`,
  }).from(schema.admissions)
    .leftJoin(schema.billingChargeAttempts, and(
      eq(schema.billingChargeAttempts.sourceId, schema.admissions.id),
      eq(schema.billingChargeAttempts.tenantId, schema.admissions.tenantId),
      eq(schema.billingChargeAttempts.facilityId, schema.admissions.facilityId),
      eq(schema.billingChargeAttempts.patientId, schema.admissions.patientId),
      eq(schema.billingChargeAttempts.sourceType, 'BED_DAY'),
      eq(schema.billingChargeAttempts.status, 'PENDING'),
    ))
    .leftJoin(schema.inpatientBedBillingWork, and(
      eq(schema.inpatientBedBillingWork.admissionId, schema.admissions.id),
      eq(schema.inpatientBedBillingWork.tenantId, schema.admissions.tenantId),
      eq(schema.inpatientBedBillingWork.facilityId, schema.admissions.facilityId),
      eq(schema.inpatientBedBillingWork.patientId, schema.admissions.patientId),
    ))
    .where(and(
      eq(schema.admissions.tenantId, facility.tenantId),
      eq(schema.admissions.facilityId, facility.id),
      or(isNotNull(schema.billingChargeAttempts.id), and(isNotNull(schema.inpatientBedBillingWork.admissionId), isNull(schema.inpatientBedBillingWork.stagedAt))),
    ))
    .groupBy(schema.admissions.id, schema.admissions.status)
    .orderBy(desc(lastActivity), desc(schema.admissions.id))
    .limit(pageSize + 1).offset(offset);
  return { admissions: rows.slice(0, pageSize), hasMore: rows.length > pageSize, offset, pageSize };
}

export async function getBedBillingView(context: AuthorizationContext, admissionId: number, requestedFacilityId?: number) {
  const id = requirePositiveId(admissionId, 'admission ID');
  const [admission] = await db.select().from(schema.admissions).where(eq(schema.admissions.id, id)).limit(1);
  if (!admission) throw new InpatientDomainError('ADMISSION_NOT_FOUND', 'Admission not found.', 404);
  requireSelectedAdmissionFacility(context, admission, requestedFacilityId);
  const at = await databaseNow(db);
  const [staySnapshot] = await db.select({
    timezoneSnapshot: schema.inpatientBedStaySnapshots.timezoneSnapshot,
    cutoffMinutes: schema.inpatientBedStaySnapshots.cutoffMinutes,
    graceMinutes: schema.inpatientBedStaySnapshots.graceMinutes,
    sameDayRule: schema.inpatientBedStaySnapshots.sameDayRule,
    policyRevision: schema.inpatientBedStaySnapshots.policyRevision,
    manualAdmissionTime: schema.inpatientBedStaySnapshots.manualAdmissionTime,
    manualDischargeTime: schema.inpatientBedStaySnapshots.manualDischargeTime,
    capturedAt: schema.inpatientBedStaySnapshots.capturedAt,
  }).from(schema.inpatientBedStaySnapshots).where(and(
    eq(schema.inpatientBedStaySnapshots.admissionId, id),
    eq(schema.inpatientBedStaySnapshots.tenantId, admission.tenantId),
    eq(schema.inpatientBedStaySnapshots.facilityId, admission.facilityId),
    eq(schema.inpatientBedStaySnapshots.patientId, admission.patientId),
  )).limit(1);
  let unresolved: { attempts: Array<{ id: number; idempotencySuffix: string | null; reason: string; diagnosisCode: string | null; attempts: number; lastAttemptAt: Date }>; hasMore: boolean; stagingPending: boolean } | null = null;
  if (canInspectBedAttempts(context)) {
    const [work] = await db.select({ stagedAt: schema.inpatientBedBillingWork.stagedAt }).from(schema.inpatientBedBillingWork).where(and(
      eq(schema.inpatientBedBillingWork.admissionId, id),
      eq(schema.inpatientBedBillingWork.tenantId, admission.tenantId),
      eq(schema.inpatientBedBillingWork.facilityId, admission.facilityId),
      eq(schema.inpatientBedBillingWork.patientId, admission.patientId),
    )).limit(1);
    const attempts = await db.select({
      id: schema.billingChargeAttempts.id, idempotencySuffix: schema.billingChargeAttempts.idempotencySuffix,
      reason: schema.billingChargeAttempts.reason, diagnosisCode: schema.billingChargeAttempts.diagnosisCode,
      attempts: schema.billingChargeAttempts.attempts, lastAttemptAt: schema.billingChargeAttempts.lastAttemptAt,
    }).from(schema.billingChargeAttempts).where(and(
      eq(schema.billingChargeAttempts.tenantId, admission.tenantId),
      eq(schema.billingChargeAttempts.facilityId, admission.facilityId),
      eq(schema.billingChargeAttempts.patientId, admission.patientId),
      eq(schema.billingChargeAttempts.sourceType, 'BED_DAY'),
      eq(schema.billingChargeAttempts.sourceId, admission.id),
      eq(schema.billingChargeAttempts.status, 'PENDING'),
    )).orderBy(asc(schema.billingChargeAttempts.id)).limit(101);
    unresolved = { attempts: attempts.slice(0, 100), hasMore: attempts.length > 100, stagingPending: Boolean(work && work.stagedAt === null) };
  }
  const periods = await db.select().from(schema.inpatientBedOccupancies).where(and(eq(schema.inpatientBedOccupancies.admissionId, id), isNull(schema.inpatientBedOccupancies.reviewId))).orderBy(asc(schema.inpatientBedOccupancies.startedAt));
  const transfers = await db.select({ fromWardId: schema.admissionTransfers.fromWardId, fromBedId: schema.admissionTransfers.fromBedId, toWardId: schema.admissionTransfers.toWardId, toBedId: schema.admissionTransfers.toBedId, transferredAt: schema.admissionTransfers.transferredAt }).from(schema.admissionTransfers)
    .where(and(eq(schema.admissionTransfers.admissionId, id), eq(schema.admissionTransfers.tenantId, admission.tenantId), eq(schema.admissionTransfers.facilityId, admission.facilityId))).orderBy(asc(schema.admissionTransfers.transferredAt), asc(schema.admissionTransfers.id));
  const clinical = { patientId: admission.patientId, encounterId: admission.encounterId, admissionDate: admission.admissionDate, dischargeDate: admission.dischargeDate, status: admission.status, wardId: admission.wardId, bedId: admission.bedId };
  const diagnostics = { staySnapshot: staySnapshot ?? null, unresolved };
  try {
    const evidence = await readBedEvidence(db, admission, at);
    if (evidence.nights.some((night) => (parseMoneyToCents(night.rate) ?? 0) <= 0))
      throw new BedPolicyError('BED_RATE_REVIEW_REQUIRED', 'A positive, confirmed daily bed rate was not captured for every billable period.');
    const sum = evidence.nights.reduce((total, n) => total === null || parseMoneyToCents(n.rate) === null ? null : total + parseMoneyToCents(n.rate)!, 0 as number | null);
    return { admissionId: id, admission: clinical, transfers, asOf: at, ...diagnostics, policy: evidence.policy, periods: evidence.periods,
      durationSeconds: Math.max(0, Math.floor(((evidence.periods.at(-1)?.endedAt ?? at).getTime() - evidence.periods[0].startedAt.getTime()) / 1000)),
      nights: evidence.nights.length, estimatedAmount: sum === null ? null : formatCents(sum), review: null };
  } catch (error) {
    if (!(error instanceof BedPolicyError)) throw error;
    return { admissionId: id, admission: clinical, transfers, asOf: at, ...diagnostics, policy: null, periods, durationSeconds: periods.length ? Math.max(0, Math.floor(((periods.at(-1)?.endedAt ?? at).getTime() - periods[0].startedAt.getTime()) / 1000)) : null,
      nights: null, estimatedAmount: null, review: { code: error.code, message: error.message } };
  }
}

export { requestFor as bedNightChargeRequest };

/** Explicitly link a missing encounter; never guess or replace an existing link. */
export async function linkBedBillingEncounter(context: AuthorizationContext, admissionId: number, rawEncounterId: unknown, rawReason: unknown, requestedFacilityId?: number) {
  financialPermission(context, ['inpatient.read', 'clinical.read', 'billing.update']);
  const id = requirePositiveId(admissionId, 'admission ID');
  const encounterId = requirePositiveId(rawEncounterId, 'encounter ID');
  const reason = text(rawReason, 'Reason');
  return db.transaction(async (tx) => {
    const [admission] = await tx.select().from(schema.admissions).where(eq(schema.admissions.id, id)).for('update');
    if (!admission) throw new InpatientDomainError('ADMISSION_NOT_FOUND', 'Admission not found.', 404);
    requireSelectedAdmissionFacility(context, admission, requestedFacilityId);
    if (admission.encounterId != null) {
      if (admission.encounterId === encounterId) return admission;
      throw invalid('This admission already has an encounter; changing it requires controlled financial reconciliation.', 409);
    }
    const [encounter] = await tx.select({ id: schema.encounters.id }).from(schema.encounters).where(and(
      eq(schema.encounters.id, encounterId), eq(schema.encounters.tenantId, admission.tenantId),
      eq(schema.encounters.facilityId, admission.facilityId), eq(schema.encounters.patientId, admission.patientId))).limit(1).for('share');
    if (!encounter) throw new InpatientDomainError('ENCOUNTER_NOT_FOUND', 'Encounter not found for this patient in this facility.', 404);
    const [prior] = await tx.select({ id: schema.billingItems.id }).from(schema.billingItems)
      .where(and(eq(schema.billingItems.sourceType, 'BED_DAY'), eq(schema.billingItems.sourceId, admission.id))).limit(1);
    if (prior) throw invalid('Existing bed-night invoice lines require financial reconciliation before linking an encounter.', 409);
    const [updated] = await tx.update(schema.admissions).set({ encounterId, updatedAt: new Date() })
      .where(eq(schema.admissions.id, id)).returning();
    await tx.insert(schema.auditLogs).values({ tenantId: admission.tenantId, facilityId: admission.facilityId, userId: String(context.userId), action: 'UPDATE', resource: 'Admission', resourceId: String(id), details: JSON.stringify({ change: 'linked_missing_bed_billing_encounter', encounterId, reason }) });
    return updated;
  });
}

export interface BedHistoryReviewInput {
  timezone?: unknown;
  cutoffMinutes?: unknown;
  graceMinutes?: unknown;
  sameDayRule?: unknown;
  reason?: unknown;
  evidenceReference?: unknown;
  affirmReviewedHistoryAndCharges?: unknown;
  periods?: unknown;
}

/**
 * A finance/clinical user explicitly attests to documentary historical facts.
 * Original admissions/transfers and unresolved attempts are retained. Existing
 * billed/voided bed transactions are deliberately outside this correction.
 */
export async function reviewBedHistory(context: AuthorizationContext, rawAdmissionId: number, input: BedHistoryReviewInput, requestedFacilityId?: number) {
  financialPermission(context, ['inpatient.read', 'clinical.read', 'billing.update']);
  const admissionId = requirePositiveId(rawAdmissionId, 'admission ID');
  const reason = text(input.reason, 'Reason');
  const evidenceReference = text(input.evidenceReference, 'Evidence reference');
  if (input.affirmReviewedHistoryAndCharges !== true)
    throw invalid('Confirm that the occupancy history, historical prices, policy and prior bed billing were reviewed.');
  const policy: BedNightPolicy = { timezone: String(input.timezone ?? ''), cutoffMinutes: Number(input.cutoffMinutes),
    graceMinutes: Number(input.graceMinutes), sameDayRule: input.sameDayRule as BedNightPolicy['sameDayRule'] };
  if (!validBedPolicy(policy) || typeof input.cutoffMinutes !== 'number' || typeof input.graceMinutes !== 'number')
    throw invalid('Supply the documented historical facility timezone, cutoff, grace and same-day policy.');
  if (!Array.isArray(input.periods) || input.periods.length < 1 || input.periods.length > 200)
    throw invalid('Provide one verified period for each actual bed assignment.');
  const periods = input.periods.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw invalid('Each bed period must contain documented values.');
    const value = raw as Record<string, unknown>;
    const wardId = requirePositiveId(value.wardId, 'ward ID'), bedId = requirePositiveId(value.bedId, 'bed ID');
    const parseInstant = (field: unknown, label: string) => {
      if (typeof field !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(field))
        throw invalid(`${label} must include an explicit timezone offset.`);
      const date = new Date(field);
      if (!Number.isFinite(date.getTime())) throw invalid(`${label} is invalid.`);
      return date;
    };
    const startedAt = parseInstant(value.startedAt, 'Period start'), endedAt = parseInstant(value.endedAt, 'Period end');
    const rate = parseMoneyToCents(value.dailyRate as string);
    if (rate === null || rate <= 0 || rate > 9_999_999_999) throw invalid('Each historical daily rate must be a positive recorded amount.');
    return { wardId, bedId, startedAt, endedAt, dailyRate: formatCents(rate) };
  });
  return db.transaction(async (tx) => {
    const [admission] = await tx.select().from(schema.admissions).where(eq(schema.admissions.id, admissionId)).for('update');
    if (!admission) throw new InpatientDomainError('ADMISSION_NOT_FOUND', 'Admission not found.', 404);
    requireSelectedAdmissionFacility(context, admission, requestedFacilityId);
    if (admission.status !== 'Discharged') throw invalid('Historical bed review is available after discharge; do not guess a still-open stay.', 409);
    const [previousReview] = await tx.select({ id: schema.inpatientBedBillingReviews.id }).from(schema.inpatientBedBillingReviews).where(eq(schema.inpatientBedBillingReviews.admissionId, admission.id)).limit(1);
    if (previousReview) throw invalid('This stay already has a signed bed-history review; later changes require a controlled financial correction.', 409);
    const [night] = await tx.select({ id: schema.inpatientBedNights.id }).from(schema.inpatientBedNights).where(eq(schema.inpatientBedNights.admissionId, admission.id)).limit(1);
    const [item] = await tx.select({ id: schema.billingItems.id }).from(schema.billingItems).where(and(eq(schema.billingItems.sourceType, 'BED_DAY'), eq(schema.billingItems.sourceId, admission.id))).limit(1);
    const attempts = await tx.select().from(schema.billingChargeAttempts).where(and(eq(schema.billingChargeAttempts.tenantId, admission.tenantId), eq(schema.billingChargeAttempts.facilityId, admission.facilityId), eq(schema.billingChargeAttempts.sourceType, 'BED_DAY'), eq(schema.billingChargeAttempts.sourceId, admission.id))).orderBy(asc(schema.billingChargeAttempts.id));
    if (night || item || attempts.some((a) => a.status !== 'PENDING' && a.status !== 'SUPERSEDED'))
      throw invalid('Existing calculated, billed or voided bed charges require a separate controlled financial reconciliation.', 409);
    const transfers = await tx.select().from(schema.admissionTransfers).where(and(eq(schema.admissionTransfers.admissionId, admission.id), eq(schema.admissionTransfers.tenantId, admission.tenantId), eq(schema.admissionTransfers.facilityId, admission.facilityId))).orderBy(asc(schema.admissionTransfers.transferredAt), asc(schema.admissionTransfers.id));
    if (periods.length !== transfers.length + 1) throw invalid('The reviewed periods must match the recorded transfer history.', 409);
    for (let i = 0; i < transfers.length; i++) {
      const t = transfers[i], from = periods[i], to = periods[i + 1];
      if (t.fromWardId !== from.wardId || t.fromBedId !== from.bedId || t.toWardId !== to.wardId || t.toBedId !== to.bedId ||
          from.endedAt.getTime() !== to.startedAt.getTime() || from.endedAt.getTime() !== t.transferredAt.getTime())
        throw invalid('Reviewed periods must follow the recorded transfer chain and time without overlaps or gaps. Conflicting legacy timestamps need separate reconciliation.', 409);
    }
    const last = periods.at(-1)!;
    if (last.wardId !== admission.wardId || last.bedId !== admission.bedId)
      throw invalid('The final reviewed bed does not match the admission.', 409);
    const now = await databaseNow(tx);
    for (const [index, period] of periods.entries()) {
      if (period.endedAt < period.startedAt || period.endedAt > now || (index && periods[index - 1].endedAt.getTime() !== period.startedAt.getTime()))
        throw invalid('Periods must be ordered, contiguous, and not in the future.', 409);
    }
    // Reject obvious conflicts with unambiguous ISO clinical timestamps.
    for (const [clinical, instant] of [[admission.admissionDate, periods[0].startedAt], [admission.dischargeDate, last.endedAt]] as const) {
      if (clinical && /(?:Z|[+-]\d\d:\d\d)$/.test(clinical)) {
        const recorded = new Date(clinical);
        if (!Number.isFinite(recorded.getTime()) || recorded.getTime() !== instant.getTime())
          throw invalid('The reviewed time conflicts with an explicitly zoned admission or discharge timestamp.', 409);
      }
    }
    const scopedBeds = [] as Array<{ bed: typeof schema.beds.$inferSelect; ward: typeof schema.wards.$inferSelect }>;
    for (const period of periods) {
      const [entry] = await tx.select({ bed: schema.beds, ward: schema.wards }).from(schema.beds)
        .innerJoin(schema.wards, eq(schema.beds.wardId, schema.wards.id)).where(and(eq(schema.beds.id, period.bedId), eq(schema.wards.id, period.wardId), eq(schema.wards.facilityId, admission.facilityId))).limit(1).for('share');
      if (!entry) throw invalid('Every reviewed bed and ward must belong to this facility.', 409);
      scopedBeds.push(entry);
    }
    // Validate calculation before writing an attestation or superseding pending attempts.
    const { calculateBedNights } = await import('./bed-night-policy.ts');
    try { calculateBedNights(policy, periods.map((p, i) => ({ id: i + 1, startedAt: p.startedAt, endedAt: p.endedAt, dailyRateSnapshot: p.dailyRate })), now); }
    catch (error) { if (error instanceof BedPolicyError) throw invalid(error.message, 409); throw error; }
    for (const attempt of attempts) await lockChargeIdentity(tx, admission.facilityId, 'BED_DAY', admission.id, attempt.idempotencySuffix);
    const [review] = await tx.insert(schema.inpatientBedBillingReviews).values({
      admissionId: admission.id, tenantId: admission.tenantId, facilityId: admission.facilityId, patientId: admission.patientId,
      timezoneSnapshot: policy.timezone, cutoffMinutes: policy.cutoffMinutes, graceMinutes: policy.graceMinutes, sameDayRule: policy.sameDayRule,
      evidenceReference, reason, reviewedByUserId: context.userId,
    }).returning();
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i], entry = scopedBeds[i];
      await tx.insert(schema.inpatientBedOccupancies).values({ admissionId: admission.id, tenantId: admission.tenantId, facilityId: admission.facilityId, patientId: admission.patientId,
        wardId: p.wardId, bedId: p.bedId, startedAt: p.startedAt, endedAt: p.endedAt, dailyRateSnapshot: p.dailyRate,
        bedNumberSnapshot: entry.bed.bedNumber, bedTypeSnapshot: entry.bed.bedType, wardNameSnapshot: entry.ward.name, reviewId: review.id, recordedByUserId: context.userId });
    }
    for (const attempt of attempts.filter((a) => a.status === 'PENDING')) {
      await tx.update(schema.billingChargeAttempts).set({ status: 'SUPERSEDED', updatedAt: now }).where(eq(schema.billingChargeAttempts.id, attempt.id));
      await tx.insert(schema.auditLogs).values({ tenantId: admission.tenantId, facilityId: admission.facilityId, userId: String(context.userId), action: 'UPDATE', resource: 'BillingChargeAttempt', resourceId: String(attempt.id), details: `Pending bed attempt superseded by explicit bed-history review #${review.id}; original identity and detail retained.` });
    }
    await tx.insert(schema.auditLogs).values({ tenantId: admission.tenantId, facilityId: admission.facilityId, userId: String(context.userId), action: 'CREATE', resource: 'InpatientBedBillingReview', resourceId: String(review.id), details: JSON.stringify({ admissionId, reason, evidenceReference, priorAttemptsReviewed: attempts.length }) });
    const staged = await stageDischargedBedNights(tx, admission, now);
    if (staged.review) throw new Error('REVIEWED_BED_HISTORY_INVALID');
    await markBedBillingStaged(tx, admission, context.userId);
    return { reviewId: review.id, nights: staged.nights };
  });
}
