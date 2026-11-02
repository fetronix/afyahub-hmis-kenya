import { and, eq } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { databaseNow, readBedEvidence, type BedExecutor } from '../inpatient/bed-evidence.ts';
import { BedPolicyError } from '../inpatient/bed-night-policy.ts';
import { parseMoneyToCents } from './settlement.ts';
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
