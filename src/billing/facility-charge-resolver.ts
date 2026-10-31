import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import type { db } from '../db/index.ts';
import { calendarDateInZone, validTimezone } from '../dashboard/timezone.ts';
import { parseMoneyToCents } from './settlement.ts';
import { dateVerdict, unitVerdict, type CatalogueServiceType } from './tariff-resolver.ts';
import type { ChargeRequest } from './billing.service.ts';

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type FacilityService = typeof schema.facilityServices.$inferSelect;
type Tariff = typeof schema.facilityServiceTariffs.$inferSelect;
export type FacilityChargeResolution =
  | {
      service: FacilityService;
      tariff: Tariff;
      rule: 'LINK' | 'CODE';
      serviceDate: string;
      performedAt: Date | null;
    }
  | { failure: { code: string; message: string } };
const fail = (code: string, message: string): FacilityChargeResolution => ({
  failure: { code, message },
});
const norm = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
function isoDate(value: string | null | undefined): string | null {
  const text = value?.slice(0, 10) ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const dt = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0, 10) === text ? text : null;
}
function department(value: string): string {
  const key = norm(value).replaceAll(/[- ]+/g, '_');
  return (
    (
      { outpatient: 'opd', lab: 'laboratory', imaging: 'radiology', ward: 'inpatient' } as Record<
        string,
        string
      >
    )[key] ?? key
  );
}

/**
 * Resolve from persisted clinical identities, never a description, specimen,
 * modality, drug name or family-wide rate. The source must be performed/completed and resolve to an explicit facility-owned service.
 */
export async function resolveFacilityCharge(
  executor: Executor,
  request: ChargeRequest,
): Promise<FacilityChargeResolution> {
  if (
    typeof request.sourceId !== 'number' ||
    !Number.isSafeInteger(request.sourceId) ||
    request.sourceId <= 0
  )
    return fail('SOURCE_ID_REQUIRED', 'A stable clinical source identity is required.');
  const [zone] = await executor
    .select({ timezone: schema.facilities.timezone, tenantTimezone: schema.tenants.timezone })
    .from(schema.facilities)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.facilities.tenantId))
    .where(
      and(
        eq(schema.facilities.id, request.facilityId),
        eq(schema.facilities.tenantId, request.tenantId),
      ),
    )
    .limit(1);
  const timezone = zone?.timezone ?? zone?.tenantTimezone;
  if (!validTimezone(timezone))
    return fail(
      'TIMEZONE_REQUIRED',
      'The facility timezone must be configured before a tariff date can be selected.',
    );
  let sourceKind: 'LAB_TEST' | 'PHARMACY' | 'BED_DAY' | null = null;
  let sourceId: number | null = null,
    sourceCode: string | null = null,
    sourceUnit: string | null = null,
    serviceId: number | null = null;
  let eventDate: string | null = null;
  let performedAt: Date | null = null;
  const dateOf = (value: Date | null | undefined) =>
    value instanceof Date && Number.isFinite(value.getTime())
      ? calendarDateInZone(timezone, value)
      : null;
  const textDate = (value: string | null | undefined): string | null => {
    const day = isoDate(value);
    if (!day || !value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return day;
    // Older admission records contain an unzoned wall clock. Preserve its
    // calendar date but do not invent an absolute service timestamp.
    if (/^\d{4}-\d{2}-\d{2}[ T]([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return day;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/i.test(value))
      return null;
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return null;
    performedAt = parsed;
    return dateOf(parsed);
  };
  const scope = (
    row:
      | { tenantId: number; facilityId: number; patientId: number; encounterId?: number | null }
      | undefined,
  ) =>
    Boolean(
      row &&
      row.tenantId === request.tenantId &&
      row.facilityId === request.facilityId &&
      row.patientId === request.patientId &&
      (row.encounterId === undefined ||
        (row.encounterId ?? null) === (request.encounterId ?? null)),
    );
  switch (request.sourceType) {
    case 'CONSULTATION': {
      const [row] = await executor
        .select()
        .from(schema.encounters)
        .where(eq(schema.encounters.id, request.sourceId))
        .limit(1);
      if (
        !row ||
        !scope({
          tenantId: row.tenantId,
          facilityId: row.facilityId,
          patientId: row.patientId,
          encounterId: row.id,
        }) ||
        row.status.toUpperCase() !== 'COMPLETED'
      )
        return fail(
          'SOURCE_NOT_COMPLETED',
          'The consultation is not a completed encounter in this facility.',
        );
      if (!row.consultationFacilityServiceId)
        return fail(
          'CONSULTATION_SELECTION_REQUIRED',
          'No facility consultation was selected; the completed visit requires billing review.',
        );
      serviceId = row.consultationFacilityServiceId;
      performedAt = row.endedAt;
      eventDate = dateOf(performedAt);
      break;
    }
    case 'LAB_ORDER': {
      const [row] = await executor
        .select()
        .from(schema.labOrders)
        .where(eq(schema.labOrders.id, request.sourceId))
        .limit(1);
      if (!row || !scope(row))
        return fail('SOURCE_NOT_FOUND', 'The laboratory order is not available in this facility.');
      if (row.status !== 'Completed' || !row.completedAt || !row.completedByUserId)
        return fail(
          'SOURCE_NOT_COMPLETED',
          'The investigation must be explicitly confirmed complete after result verification.',
        );
      const results = await executor
        .select({
          patientId: schema.labResults.patientId,
          status: schema.labResults.status,
          at: schema.labResults.verifiedAt,
        })
        .from(schema.labResults)
        .where(eq(schema.labResults.orderId, row.id));
      if (
        !results.length ||
        results.some(
          (result) =>
            result.patientId !== row.patientId || result.status !== 'Verified' || !result.at,
        )
      )
        return fail(
          'SOURCE_REVIEW_REQUIRED',
          'All recorded investigation results require verification before billing.',
        );
      if (!row.testId && !row.facilityServiceId)
        return fail(
          'SERVICE_NOT_SELECTED',
          'The investigation has no selected facility identity; a specimen or free-text name cannot price it.',
        );
      // Existing explicitly unlinked exceptions are not silently recoded.
      if (row.clinicalException || !row.specimenType?.trim())
        return fail(
          'SOURCE_REVIEW_REQUIRED',
          'Investigation identity and specimen require review.',
        );
      if (row.testId) {
        const [test] = await executor
          .select({ id: schema.labTests.id, code: schema.labTests.code })
          .from(schema.labTests)
          .where(
            and(
              eq(schema.labTests.id, row.testId),
              eq(schema.labTests.facilityId, request.facilityId),
            ),
          )
          .limit(1);
        if (!test)
          return fail(
            'SERVICE_NOT_SELECTED',
            'The laboratory test does not belong to this facility.',
          );
        sourceKind = 'LAB_TEST';
        sourceId = row.testId;
        sourceCode = test.code;
        sourceUnit = 'Test';
      }
      serviceId = row.facilityServiceId ?? null;
      performedAt = row.completedAt;
      eventDate = dateOf(performedAt);
      break;
    }
    case 'RADIOLOGY': {
      const [row] = await executor
        .select()
        .from(schema.radiologyOrders)
        .where(eq(schema.radiologyOrders.id, request.sourceId))
        .limit(1);
      if (!row || !scope(row))
        return fail('SOURCE_NOT_FOUND', 'The imaging order is not available in this facility.');
      if (row.status !== 'Reported' || !row.reportedAt)
        return fail(
          'SOURCE_NOT_COMPLETED',
          'An imaging report is required before billing this examination.',
        );
      if (!row.facilityServiceId)
        return fail(
          'SERVICE_NOT_SELECTED',
          'No facility examination was selected; a modality or free-text name cannot price it.',
        );
      serviceId = row.facilityServiceId;
      performedAt = row.reportedAt;
      eventDate = dateOf(performedAt);
      break;
    }
    case 'PHARMACY': {
      const [row] = await executor
        .select()
        .from(schema.pharmacyDispensations)
        .where(eq(schema.pharmacyDispensations.id, request.sourceId))
        .limit(1);
      if (!row || !scope(row) || !row.itemId || row.quantityDispensed !== (request.quantity ?? 1))
        return fail('SOURCE_REVIEW_REQUIRED', 'Dispensing identity or quantity requires review.');
      const [item] = await executor
        .select({
          id: schema.inventoryItems.id,
          code: schema.inventoryItems.itemCode,
          unit: schema.inventoryItems.unit,
        })
        .from(schema.inventoryItems)
        .where(
          and(
            eq(schema.inventoryItems.id, row.itemId),
            eq(schema.inventoryItems.facilityId, request.facilityId),
          ),
        )
        .limit(1);
      if (!item)
        return fail(
          'CATALOGUE_NOT_FOUND',
          'The dispensed product is not in this facility inventory.',
        );
      sourceKind = 'PHARMACY';
      sourceId = row.itemId;
      sourceCode = item.code;
      sourceUnit = item.unit;
      performedAt = row.dispensedAt;
      eventDate = dateOf(performedAt);
      break;
    }
    case 'ADMISSION':
    case 'BED_DAY': {
      const [row] = await executor
        .select()
        .from(schema.admissions)
        .where(eq(schema.admissions.id, request.sourceId))
        .limit(1);
      if (!row || !scope(row))
        return fail('SOURCE_NOT_FOUND', 'The admission is not available in this facility.');
      if (request.sourceType === 'ADMISSION') {
        if (!row.facilityServiceId)
          return fail(
            'ADMISSION_SELECTION_REQUIRED',
            'No facility admission service was recorded; billing review is required.',
          );
        serviceId = row.facilityServiceId;
        eventDate = textDate(row.admissionDate);
      } else {
        if (request.serviceRef?.type !== 'BED_DAY' || !request.serviceRef.id)
          return fail(
            'WARD_ID_REQUIRED',
            'The original occupied ward identity is missing; review the stay before retrying.',
          );
        const [ward] = await executor
          .select({ id: schema.wards.id, code: schema.wards.code })
          .from(schema.wards)
          .where(
            and(
              eq(schema.wards.id, request.serviceRef.id),
              eq(schema.wards.facilityId, request.facilityId),
            ),
          )
          .limit(1);
        if (!ward)
          return fail('WARD_ID_REQUIRED', 'The occupied ward is not available in this facility.');
        const date = isoDate(request.idempotencySuffix);
        const start = isoDate(row.admissionDate),
          end = row.dischargeDate ? isoDate(row.dischargeDate) : calendarDateInZone(timezone);
        if (
          !date ||
          date !== request.idempotencySuffix ||
          !start ||
          !end ||
          date < start ||
          date > end ||
          date > calendarDateInZone(timezone)
        )
          return fail(
            'BED_DAY_DATE_INVALID',
            'The bed-day date is outside the documented stay or is not yet available.',
          );
        const transfers = await executor
          .select({
            fromWardId: schema.admissionTransfers.fromWardId,
            toWardId: schema.admissionTransfers.toWardId,
            at: schema.admissionTransfers.transferredAt,
          })
          .from(schema.admissionTransfers)
          .where(
            and(
              eq(schema.admissionTransfers.admissionId, row.id),
              eq(schema.admissionTransfers.tenantId, request.tenantId),
              eq(schema.admissionTransfers.facilityId, request.facilityId),
            ),
          )
          .orderBy(schema.admissionTransfers.transferredAt, schema.admissionTransfers.id);
        let occupied = transfers.length ? transfers[0].fromWardId : row.wardId;
        if (!occupied)
          return fail('WARD_HISTORY_REQUIRED', 'The original occupied ward cannot be verified.');
        for (const transfer of transfers) {
          if (calendarDateInZone(timezone, transfer.at) <= date) occupied = transfer.toWardId;
        }
        if (occupied !== ward.id)
          return fail(
            'WARD_HISTORY_CONFLICT',
            'The queued ward does not match the recorded occupancy for this date.',
          );
        sourceKind = 'BED_DAY';
        sourceId = ward.id;
        sourceCode = ward.code;
        sourceUnit = 'Day';
        eventDate = isoDate(request.idempotencySuffix);
      }
      break;
    }
    case 'MATERNITY': {
      const [row] = await executor
        .select()
        .from(schema.deliveries)
        .where(eq(schema.deliveries.id, request.sourceId))
        .limit(1);
      if (!row || !scope(row))
        return fail('SOURCE_NOT_FOUND', 'The delivery is not available in this facility.');
      if (!row.facilityServiceId)
        return fail(
          'DELIVERY_SELECTION_REQUIRED',
          'No facility delivery service was selected; the delivery requires billing review.',
        );
      serviceId = row.facilityServiceId;
      eventDate = textDate(row.deliveredAt);
      break;
    }
    case 'PROCEDURE': {
      const [row] = await executor
        .select({ procedure: schema.clinicalProcedures, encounter: schema.encounters })
        .from(schema.clinicalProcedures)
        .innerJoin(
          schema.encounters,
          eq(schema.encounters.id, schema.clinicalProcedures.encounterId),
        )
        .where(eq(schema.clinicalProcedures.id, request.sourceId))
        .limit(1);
      if (
        !row ||
        !scope({
          tenantId: row.encounter.tenantId,
          facilityId: row.encounter.facilityId,
          patientId: row.procedure.patientId,
          encounterId: row.encounter.id,
        }) ||
        row.procedure.patientId !== row.encounter.patientId
      )
        return fail('SOURCE_NOT_FOUND', 'The procedure is not available in this facility.');
      if (row.procedure.status?.trim().toUpperCase() !== 'COMPLETED')
        return fail(
          'SOURCE_NOT_COMPLETED',
          'The procedure must be explicitly completed before billing.',
        );
      sourceCode = row.procedure.procedureCode;
      performedAt = row.procedure.performedAt;
      eventDate = dateOf(performedAt);
      break;
    }
    default:
      return fail(
        'SERVICE_NOT_SELECTED',
        'This source has no facility service identity; it requires billing review.',
      );
  }
  if (!eventDate)
    return fail(
      'SERVICE_DATE_REQUIRED',
      'The clinical service date is unavailable or invalid; review before billing.',
    );
  if (request.serviceDate && request.serviceDate !== eventDate)
    return fail(
      'SERVICE_DATE_CONFLICT',
      'The source date and queued date differ; review before billing.',
    );
  return resolveConfiguredFacilityService(executor, {
    tenantId: request.tenantId,
    facilityId: request.facilityId,
    sourceType: request.sourceType,
    sourceKind,
    sourceId,
    sourceCode,
    sourceUnit,
    serviceId,
    eventDate,
    performedAt,
  });
}

/** One exact service identity and its facility tariff. No master catalogue,
 * implicit description matching, family fallback or specimen-code pricing. */
export async function resolveConfiguredFacilityService(
  executor: Executor,
  input: {
    tenantId: number;
    facilityId: number;
    sourceType: ChargeRequest['sourceType'];
    sourceKind?: 'LAB_TEST' | 'PHARMACY' | 'BED_DAY' | null;
    sourceId?: number | null;
    sourceCode?: string | null;
    sourceUnit?: string | null;
    serviceId?: number | null;
    eventDate: string;
    performedAt?: Date | null;
  },
): Promise<FacilityChargeResolution> {
  const { sourceKind, sourceId, sourceCode, sourceUnit, serviceId, eventDate } = input;
  const expected =
    input.sourceType === 'LAB_ORDER'
      ? 'LABORATORY'
      : input.sourceType === 'MATERNITY'
        ? 'DELIVERY'
        : input.sourceType;
  if (!serviceId && (!sourceCode?.trim() || (sourceKind && !sourceId)))
    return fail(
      'SERVICE_NOT_SELECTED',
      'The clinical source has no explicit facility service code or selection.',
    );

  // Source codes must identify exactly one real item in this facility.
  if (!serviceId && sourceKind && sourceCode) {
    const matches =
      sourceKind === 'LAB_TEST'
        ? await executor
            .select({ id: schema.labTests.id })
            .from(schema.labTests)
            .where(
              and(
                eq(schema.labTests.facilityId, input.facilityId),
                sql`upper(trim(${schema.labTests.code})) = upper(trim(${sourceCode}))`,
              ),
            )
            .limit(2)
        : sourceKind === 'PHARMACY'
          ? await executor
              .select({ id: schema.inventoryItems.id })
              .from(schema.inventoryItems)
              .where(
                and(
                  eq(schema.inventoryItems.facilityId, input.facilityId),
                  sql`upper(trim(${schema.inventoryItems.itemCode})) = upper(trim(${sourceCode}))`,
                ),
              )
              .limit(2)
          : await executor
              .select({ id: schema.wards.id })
              .from(schema.wards)
              .where(
                and(
                  eq(schema.wards.facilityId, input.facilityId),
                  sql`upper(trim(${schema.wards.code})) = upper(trim(${sourceCode}))`,
                ),
              )
              .limit(2);
    if (matches.length !== 1 || matches[0].id !== sourceId)
      return fail(
        'SOURCE_CODE_AMBIGUOUS',
        'The clinical source code is not unique in this facility.',
      );
  }
  const [service] = await executor
    .select()
    .from(schema.facilityServices)
    .where(
      and(
        eq(schema.facilityServices.tenantId, input.tenantId),
        eq(schema.facilityServices.facilityId, input.facilityId),
        serviceId
          ? eq(schema.facilityServices.id, serviceId)
          : sql`upper(trim(${schema.facilityServices.code})) = upper(trim(${sourceCode}))`,
      ),
    )
    .limit(1)
    .for('share');
  if (!service || service.category !== expected)
    return fail(
      'SERVICE_NOT_CONFIGURED',
      'No facility service with this exact clinical identity and category is configured.',
    );
  if (
    serviceId &&
    sourceKind === 'LAB_TEST' &&
    sourceCode &&
    norm(service.code) !== norm(sourceCode)
  )
    return fail(
      'SOURCE_CODE_MISMATCH',
      'The facility service no longer matches the recorded laboratory test.',
    );
  if (!service.isActive || !service.autoBill)
    return fail('SERVICE_INACTIVE', 'The service or automatic billing is disabled.');
  if (sourceKind === 'PHARMACY' && (!sourceUnit || norm(sourceUnit) !== norm(service.unit)))
    return fail(
      'SOURCE_UNIT_MISMATCH',
      'The dispensed product unit differs from the facility service unit.',
    );
  const [tariff] = await executor
    .select()
    .from(schema.facilityServiceTariffs)
    .where(
      and(
        eq(schema.facilityServiceTariffs.tenantId, input.tenantId),
        eq(schema.facilityServiceTariffs.facilityId, input.facilityId),
        eq(schema.facilityServiceTariffs.facilityServiceId, service.id),
        eq(schema.facilityServiceTariffs.isActive, true),
        isNull(schema.facilityServiceTariffs.archivedAt),
      ),
    )
    .limit(1)
    .for('share');
  if (!tariff)
    return fail(
      'TARIFF_NOT_CONFIGURED',
      'No active facility tariff is configured for this service.',
    );
  const cents = parseMoneyToCents(tariff.fee);
  if (cents === null || cents <= 0)
    return fail('ZERO_PRICE', 'The facility price is unconfigured; KES 0.00 is not a free charge.');
  if (!tariff.autoBill)
    return fail('AUTOMATIC_BILLING_DISABLED', 'Automatic billing is disabled for this tariff.');
  const validity = dateVerdict(tariff.effectiveFrom, tariff.effectiveTo, eventDate);
  if (validity !== 'OK')
    return fail(
      validity,
      'The tariff is outside its effective dates for the clinical service date.',
    );
  if (department(tariff.department) !== department(service.department))
    return fail('WRONG_DEPARTMENT', 'The tariff department does not match the facility service.');
  const type = (
    service.category === 'LABORATORY' ? 'LAB_TEST' : service.category
  ) as CatalogueServiceType;
  if (norm(tariff.unit) !== norm(service.unit) || unitVerdict(type, tariff.unit) !== 'OK')
    return fail('UNIT_INCOMPATIBLE', 'The tariff unit does not match the facility service.');
  return {
    service,
    tariff,
    rule: serviceId ? 'LINK' : 'CODE',
    serviceDate: eventDate,
    performedAt: input.performedAt ?? null,
  };
}
