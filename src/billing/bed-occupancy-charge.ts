import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { databaseNow, readBedEvidence, type BedExecutor } from '../inpatient/bed-evidence.ts';
import { BedPolicyError } from '../inpatient/bed-night-policy.ts';
import { parseMoneyToCents } from './settlement.ts';
import { calendarDateInZone } from '../dashboard/timezone.ts';
import type { ChargeRequest } from './billing.service.ts';

export type BedOccupancyResolution =
  | { price: string; bedId: number; occupancyId: number; nightId: number; admissionId: number;
      code: string; name: string; unit: string; serviceDate: string; performedAt: Date }
  | { failure: { code: string; message: string } };
const fail = (code: string, message: string): BedOccupancyResolution => ({ failure: { code, message } });

/** Price a night from persisted, scope-checked occupancy evidence, never current bed/ward prices or a tariff. */
export async function resolveBedOccupancyCharge(executor: BedExecutor, request: ChargeRequest): Promise<BedOccupancyResolution> {
  const date = request.idempotencySuffix;
  if (request.sourceType !== 'BED_DAY' || typeof request.sourceId !== 'number' || !Number.isSafeInteger(request.sourceId) ||
      !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (request.serviceDate && request.serviceDate !== date) || (request.quantity ?? 1) !== 1)
    return fail('BED_NIGHT_IDENTITY_REQUIRED', 'A recorded admission and single bed-night date are required.');
  const [admission] = await executor.select().from(schema.admissions).where(eq(schema.admissions.id, request.sourceId)).limit(1);
  if (!admission || admission.tenantId !== request.tenantId || admission.facilityId !== request.facilityId || admission.patientId !== request.patientId || admission.status !== 'Discharged')
    return fail('BED_ADMISSION_SCOPE_INVALID', 'The discharged admission is not available in this facility.');
  if (!admission.encounterId)
    return fail('BED_ENCOUNTER_REQUIRED', 'The admission has no linked encounter. An authorized user must link the verified encounter before retrying.');
  if (admission.encounterId !== (request.encounterId ?? null))
    return fail('BED_ENCOUNTER_CONFLICT', 'The admission and billing encounter do not match; review before retrying.');
  // Interpret the application's UTC-written, timezone-less encounter fields
  // independently of the Node host timezone. Legacy dates are only a guard.
  const [encounter] = await executor.select({ id: schema.encounters.id, encounterType: schema.encounters.encounterType,
    startedAt: sql<Date>`${schema.encounters.startedAt} AT TIME ZONE 'UTC'`.mapWith((value: string) => new Date(value)),
    endedAt: sql<Date | null>`${schema.encounters.endedAt} AT TIME ZONE 'UTC'`.mapWith((value: string) => new Date(value)),
  }).from(schema.encounters).where(and(
    eq(schema.encounters.id, admission.encounterId), eq(schema.encounters.tenantId, admission.tenantId),
    eq(schema.encounters.facilityId, admission.facilityId), eq(schema.encounters.patientId, admission.patientId),
  )).limit(1);
  if (!encounter || encounter.encounterType.trim().toUpperCase() !== 'INPATIENT')
    return fail('BED_ENCOUNTER_CONFLICT', 'The linked encounter is not a verified inpatient encounter for this patient and facility.');
  const [night] = await executor.select().from(schema.inpatientBedNights).where(and(
    eq(schema.inpatientBedNights.admissionId, admission.id), eq(schema.inpatientBedNights.tenantId, admission.tenantId),
    eq(schema.inpatientBedNights.facilityId, admission.facilityId), eq(schema.inpatientBedNights.patientId, admission.patientId),
    eq(schema.inpatientBedNights.billingDate, date))).limit(1);
  if (!night) return fail('BED_NIGHT_EVIDENCE_REQUIRED', 'No reviewed bed-night evidence exists for this date; do not use the current bed rate.');
  let evidence: Awaited<ReturnType<typeof readBedEvidence>>;
  try { evidence = await readBedEvidence(executor, admission, await databaseNow(executor)); }
  catch (error) {
    if (error instanceof BedPolicyError) return fail(error.code, error.message);
    throw error;
  }
  const firstPeriod = evidence.periods[0];
  const lastPeriod = evidence.periods.at(-1);
  if (!firstPeriod || !lastPeriod?.endedAt ||
      calendarDateInZone(evidence.policy.timezone, encounter.startedAt) > calendarDateInZone(evidence.policy.timezone, lastPeriod.endedAt) ||
      (encounter.endedAt && calendarDateInZone(evidence.policy.timezone, encounter.endedAt) < calendarDateInZone(evidence.policy.timezone, firstPeriod.startedAt)))
    return fail('BED_ENCOUNTER_CONFLICT', 'The linked inpatient encounter dates do not overlap the recorded stay.');
  const computed = evidence.nights.find((entry) => entry.date === date);
  const occupancy = evidence.periods.find((period) => period.id === night.occupancyId);
  if (!computed || !occupancy || computed.occupancyId !== night.occupancyId ||
      computed.cutoffAt?.getTime() !== night.cutoffAt?.getTime() ||
      computed.rate !== night.unitPriceSnapshot || night.unitPriceSnapshot !== night.totalSnapshot ||
      (parseMoneyToCents(night.unitPriceSnapshot) ?? 0) <= 0 ||
      (request.serviceRef?.id != null && request.serviceRef.id !== occupancy.wardId))
    return fail('BED_NIGHT_EVIDENCE_CONFLICT', 'The saved rate, cutoff or bed occupancy does not match the recorded stay.');
  const performedAt = night.cutoffAt ?? occupancy.endedAt;
  if (!performedAt) return fail('BED_NIGHT_EVIDENCE_CONFLICT', 'The bed-night event time is missing.');
  return {
    price: night.unitPriceSnapshot!, bedId: occupancy.bedId, occupancyId: occupancy.id,
    nightId: night.id, admissionId: admission.id, code: `BED-${occupancy.bedId}`,
    name: `${occupancy.wardNameSnapshot} / ${occupancy.bedNumberSnapshot} — ${date}`,
    unit: 'Night', serviceDate: date, performedAt,
  };
}
