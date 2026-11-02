import { and, asc, eq, isNull } from 'drizzle-orm';
import type { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { BedPolicyError, calculateBedNights, validBedPolicy, type BedNightPolicy } from './bed-night-policy.ts';

export type BedExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
export type AdmissionRow = typeof schema.admissions.$inferSelect;
export type OccupancyRow = typeof schema.inpatientBedOccupancies.$inferSelect;

/** Read the original snapshot, or a separately authorized reviewed history. */
export async function readBedEvidence(executor: BedExecutor, admission: AdmissionRow, asOf: Date) {
  const [review] = await executor.select().from(schema.inpatientBedBillingReviews)
    .where(and(eq(schema.inpatientBedBillingReviews.admissionId, admission.id),
      eq(schema.inpatientBedBillingReviews.tenantId, admission.tenantId),
      eq(schema.inpatientBedBillingReviews.facilityId, admission.facilityId),
      eq(schema.inpatientBedBillingReviews.patientId, admission.patientId))).limit(1);
  const [snapshot] = await executor.select().from(schema.inpatientBedStaySnapshots)
    .where(and(eq(schema.inpatientBedStaySnapshots.admissionId, admission.id),
      eq(schema.inpatientBedStaySnapshots.tenantId, admission.tenantId),
      eq(schema.inpatientBedStaySnapshots.facilityId, admission.facilityId),
      eq(schema.inpatientBedStaySnapshots.patientId, admission.patientId))).limit(1);
  if (!review && !snapshot)
    throw new BedPolicyError('BED_HISTORY_REVIEW_REQUIRED', 'No occupancy and policy snapshots were captured for this historical stay.');
  if (!review && (snapshot!.manualAdmissionTime || snapshot!.manualDischargeTime))
    throw new BedPolicyError('BED_MANUAL_TIME_REVIEW_REQUIRED', 'A client-supplied clinical time needs an evidence-based bed billing review. An older client may have supplied it automatically; its origin cannot be assumed.');
  const chosen = review ?? snapshot!;
  const policy: BedNightPolicy = {
    timezone: chosen.timezoneSnapshot ?? '',
    cutoffMinutes: chosen.cutoffMinutes ?? -1,
    graceMinutes: chosen.graceMinutes ?? -1,
    sameDayRule: chosen.sameDayRule as BedNightPolicy['sameDayRule'],
  };
  if (!validBedPolicy(policy))
    throw new BedPolicyError('BED_POLICY_REVIEW_REQUIRED', 'No valid facility bed policy was recorded for this stay; current settings cannot be applied retroactively.');
  const periods = await executor.select().from(schema.inpatientBedOccupancies)
    .where(and(eq(schema.inpatientBedOccupancies.admissionId, admission.id),
      eq(schema.inpatientBedOccupancies.tenantId, admission.tenantId),
      eq(schema.inpatientBedOccupancies.facilityId, admission.facilityId),
      eq(schema.inpatientBedOccupancies.patientId, admission.patientId),
      review ? eq(schema.inpatientBedOccupancies.reviewId, review.id) : isNull(schema.inpatientBedOccupancies.reviewId)))
    .orderBy(asc(schema.inpatientBedOccupancies.startedAt), asc(schema.inpatientBedOccupancies.id));
  const last = periods.at(-1);
  if (!last || last.bedId !== admission.bedId || last.wardId !== admission.wardId ||
      (admission.status === 'Admitted' ? last.endedAt !== null : last.endedAt === null))
    throw new BedPolicyError('BED_OCCUPANCY_REVIEW_REQUIRED', 'The occupancy history does not match the admission and needs review.');
  const nights = calculateBedNights(policy, periods, asOf);
  return { policy, periods, nights, review, snapshot };
}

export async function databaseNow(executor: BedExecutor): Promise<Date> {
  // Raw Drizzle execution returns PostgreSQL timestamps as strings; an
  // explicit epoch avoids host timezone parsing and preserves milliseconds.
  const result = await executor.execute<{ milliseconds: string }>(sqlNow);
  const milliseconds = Number(result.rows[0]?.milliseconds);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) throw new Error('DATABASE_TIME_UNAVAILABLE');
  return new Date(milliseconds);
}

import { sql } from 'drizzle-orm';
const sqlNow = sql`select floor(extract(epoch from clock_timestamp()) * 1000)::bigint as milliseconds`;
