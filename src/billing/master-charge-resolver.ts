import { and, eq, isNull, or, sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import type { db } from '../db/index.ts';
import { calendarDateInZone, validTimezone } from '../dashboard/timezone.ts';
import { parseMoneyToCents } from './settlement.ts';
import { dateVerdict, unitVerdict, type CatalogueServiceType } from './tariff-resolver.ts';
import type { ChargeRequest } from './billing.service.ts';

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type Master = typeof schema.masterServices.$inferSelect;
type Tariff = typeof schema.facilityServiceTariffs.$inferSelect;
export type MasterChargeResolution =
  | {
      master: Master;
      tariff: Tariff;
      rule: 'LINK' | 'CODE';
      serviceDate: string;
      performedAt: Date | null;
    }
  | { failure: { code: string; message: string } };
const fail = (code: string, message: string): MasterChargeResolution => ({
  failure: { code, message },
});
const norm = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const deliveryCodes: Record<string, string> = {
  'Spontaneous Vertex': 'JC-DELIVERY-VERTEX',
  'Assisted Vaginal': 'JC-DELIVERY-ASSISTED',
  Breech: 'JC-DELIVERY-BREECH',
  Vacuum: 'JC-DELIVERY-VACUUM',
  Forceps: 'JC-DELIVERY-FORCEPS',
  'Caesarean Section': 'JC-DELIVERY-CAESAREAN',
};
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

export function masterDepartmentMatches(
  tariffDepartment: string,
  masterDepartment: string,
): boolean {
  return department(tariffDepartment) === department(masterDepartment);
}

/**
 * Resolve from persisted clinical identities, never a description, specimen,
 * modality, drug name or family-wide rate. A performed/completed source and a
 * reviewed master mapping are both prerequisites to automatic billing.
 */
export async function resolveMasterCharge(
  executor: Executor,
  request: ChargeRequest,
): Promise<MasterChargeResolution> {
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
    masterId: number | null = null,
    masterCode: string | null = null;
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
      if (!row.consultationMasterServiceId)
        return fail(
          'CONSULTATION_SELECTION_REQUIRED',
          'The consultation service requires explicit review before billing.',
        );
      // Older encounters may have no review flag. Their type alone is not a
      // reviewed selection, so they must follow the same safe review path.
      masterId = row.consultationMasterServiceId;
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
      if (!row.testId)
        return fail(
          'CATALOGUE_NOT_FOUND',
          'The investigation has no exact laboratory catalogue identity; a specimen or free-text name cannot price it.',
        );
      if (row.clinicalException || !row.reviewedSpecimenOptionId)
        return fail(
          'SOURCE_REVIEW_REQUIRED',
          'This investigation requires controlled specimen and identity review before billing; an unreviewed test ID or specimen is not sufficient.',
        );
      const [specimen] = await executor
        .select({ type: schema.labTestSpecimenOptions.specimenType })
        .from(schema.labTestSpecimenOptions)
        .where(
          and(
            eq(schema.labTestSpecimenOptions.id, row.reviewedSpecimenOptionId),
            eq(schema.labTestSpecimenOptions.testId, row.testId),
            eq(schema.labTestSpecimenOptions.tenantId, request.tenantId),
            eq(schema.labTestSpecimenOptions.facilityId, request.facilityId),
            isNull(schema.labTestSpecimenOptions.retiredAt),
          ),
        )
        .limit(1)
        .for('share');
      if (!specimen || !row.specimenType?.trim() || norm(specimen.type) !== norm(row.specimenType))
        return fail(
          'SOURCE_REVIEW_REQUIRED',
          'The recorded specimen no longer matches its reviewed investigation option.',
        );
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
        return fail('CATALOGUE_NOT_FOUND', 'The laboratory test does not belong to this facility.');
      sourceKind = 'LAB_TEST';
      sourceId = row.testId;
      sourceCode = test.code;
      sourceUnit = 'Test';
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
      if (!row.masterServiceId)
        return fail(
          'CATALOGUE_NOT_FOUND',
          'No specific imaging examination was selected; a modality or free-text name cannot price it.',
        );
      masterId = row.masterServiceId;
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
        masterCode = 'JC-ADMISSION';
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
      masterCode = deliveryCodes[row.deliveryMode] ?? null;
      eventDate = textDate(row.deliveredAt);
      break;
    }
    default:
      return fail(
        'CATALOGUE_NOT_FOUND',
        'This source has no verified master-service mapping; it requires billing review.',
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
  return resolveConfiguredService(executor, {
    tenantId: request.tenantId,
    facilityId: request.facilityId,
    sourceType: request.sourceType,
    sourceKind,
    sourceId,
    sourceCode,
    sourceUnit,
    masterId,
    masterCode,
    eventDate,
    performedAt,
  });
}

/**
 * The same exact identity and tariff checks power clinical price previews and
 * completed-service billing. This function does not establish that a service
 * occurred; only resolveMasterCharge's source-specific checks can do that.
 */
export async function resolveConfiguredService(
  executor: Executor,
  input: {
    tenantId: number;
    facilityId: number;
    sourceType: ChargeRequest['sourceType'];
    sourceKind?: 'LAB_TEST' | 'PHARMACY' | 'BED_DAY' | null;
    sourceId?: number | null;
    sourceCode?: string | null;
    sourceUnit?: string | null;
    masterId?: number | null;
    masterCode?: string | null;
    eventDate: string;
    performedAt?: Date | null;
  },
): Promise<MasterChargeResolution> {
  const request = input;
  const { sourceKind, sourceId, sourceCode, sourceUnit, masterId, masterCode, eventDate } = input;
  const performedAt = input.performedAt ?? null;
  let master: Master | undefined;
  let rule: 'LINK' | 'CODE' = 'CODE';
  if (sourceKind && sourceId) {
    const [mapping] = await executor
      .select({ master: schema.masterServices })
      .from(schema.masterServiceSources)
      .innerJoin(
        schema.masterServices,
        eq(schema.masterServices.id, schema.masterServiceSources.masterServiceId),
      )
      .where(
        and(
          eq(schema.masterServiceSources.tenantId, request.tenantId),
          eq(schema.masterServiceSources.facilityId, request.facilityId),
          eq(schema.masterServiceSources.sourceType, sourceKind),
          eq(schema.masterServiceSources.sourceId, sourceId),
          eq(schema.masterServiceSources.isActive, true),
          or(
            isNull(schema.masterServices.tenantId),
            eq(schema.masterServices.tenantId, request.tenantId),
          ),
        ),
      )
      .limit(1)
      .for('share');
    master = mapping?.master;
    rule = 'LINK';
    if (!master && sourceCode?.trim()) {
      const matchingSources =
        sourceKind === 'LAB_TEST'
          ? await executor
              .select({ id: schema.labTests.id })
              .from(schema.labTests)
              .where(
                and(
                  eq(schema.labTests.facilityId, request.facilityId),
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
                    eq(schema.inventoryItems.facilityId, request.facilityId),
                    sql`upper(trim(${schema.inventoryItems.itemCode})) = upper(trim(${sourceCode}))`,
                  ),
                )
                .limit(2)
            : await executor
                .select({ id: schema.wards.id })
                .from(schema.wards)
                .where(
                  and(
                    eq(schema.wards.facilityId, request.facilityId),
                    sql`upper(trim(${schema.wards.code})) = upper(trim(${sourceCode}))`,
                  ),
                )
                .limit(2);
      if (matchingSources.length !== 1)
        return fail(
          'SOURCE_CODE_AMBIGUOUS',
          'The clinical source code is not unique in this facility. An explicit source mapping is required.',
        );
    }
    if (!master && sourceCode?.trim()) {
      const aliases = await executor
        .select({ master: schema.masterServices })
        .from(schema.masterServiceAliases)
        .innerJoin(
          schema.masterServices,
          eq(schema.masterServices.id, schema.masterServiceAliases.masterServiceId),
        )
        .where(
          and(
            eq(schema.masterServiceAliases.tenantId, request.tenantId),
            eq(schema.masterServiceAliases.facilityId, request.facilityId),
            eq(schema.masterServiceAliases.sourceType, sourceKind),
            eq(schema.masterServiceAliases.isActive, true),
            sql`upper(trim(${schema.masterServiceAliases.alias})) = upper(trim(${sourceCode}))`,
          ),
        )
        .limit(2)
        .for('share');
      if (aliases.length > 1)
        return fail(
          'ALIAS_AMBIGUOUS',
          'Multiple approved aliases match this source code; review the mapping.',
        );
      master = aliases[0]?.master;
    }
    // Identical codes alone do not establish an approved relationship, and
    // must not resurrect a retired source mapping. A reviewed source link or
    // approved structured alias is required even for an unambiguous match.
  } else if (masterId) {
    // Joining the facility tariff also proves that this master is available here.
    const [row] = await executor
      .select({ master: schema.masterServices })
      .from(schema.masterServices)
      .innerJoin(
        schema.facilityServiceTariffs,
        and(
          eq(schema.facilityServiceTariffs.masterServiceId, schema.masterServices.id),
          eq(schema.facilityServiceTariffs.tenantId, request.tenantId),
          eq(schema.facilityServiceTariffs.facilityId, request.facilityId),
        ),
      )
      .where(
        and(
          eq(schema.masterServices.id, masterId),
          or(
            isNull(schema.masterServices.tenantId),
            eq(schema.masterServices.tenantId, request.tenantId),
          ),
        ),
      )
      .limit(1)
      .for('share');
    master = row?.master;
    rule = 'LINK';
  } else if (masterCode) {
    const [row] = await executor
      .select()
      .from(schema.masterServices)
      .where(
        and(eq(schema.masterServices.code, masterCode), isNull(schema.masterServices.tenantId)),
      )
      .limit(1)
      .for('share');
    master = row;
  }
  if (
    !master ||
    !master.isActive ||
    (master.tenantId !== null && master.tenantId !== request.tenantId) ||
    (master.originFacilityId !== null && master.originFacilityId !== request.facilityId)
  )
    return fail(
      'MASTER_MAPPING_MISSING',
      'No active reviewed master service is mapped to this clinical source in this facility.',
    );
  if (sourceKind && (!sourceUnit || norm(sourceUnit) !== norm(master.unit)))
    return fail(
      'SOURCE_UNIT_MISMATCH',
      'The current clinical source unit differs from the reviewed master unit.',
    );
  const expected =
    request.sourceType === 'LAB_ORDER'
      ? 'LABORATORY'
      : request.sourceType === 'MATERNITY'
        ? 'DELIVERY'
        : request.sourceType;
  if (master.billingFamily !== expected)
    return fail(
      'MASTER_FAMILY_MISMATCH',
      'The mapped service belongs to a different billing family.',
    );
  const [tariff] = await executor
    .select()
    .from(schema.facilityServiceTariffs)
    .where(
      and(
        eq(schema.facilityServiceTariffs.tenantId, request.tenantId),
        eq(schema.facilityServiceTariffs.facilityId, request.facilityId),
        eq(schema.facilityServiceTariffs.masterServiceId, master.id),
      ),
    )
    .limit(1)
    .for('share');
  if (!tariff)
    return fail('TARIFF_NOT_MAPPED', 'No facility tariff is mapped to this master service.');
  const cents = parseMoneyToCents(tariff.fee);
  if (cents === null || cents <= 0)
    return fail('ZERO_PRICE', 'The facility price is unconfigured; KES 0.00 is not a free charge.');
  if (!tariff.isActive || !tariff.autoBill)
    return fail('TARIFF_INACTIVE', 'The service or automatic billing is disabled.');
  if (
    tariff.approvalStatus !== 'APPROVED' ||
    !tariff.approvedByUserId ||
    !tariff.approvedAt ||
    !tariff.approvalReference
  )
    return fail('TARIFF_UNAPPROVED', 'The facility tariff requires explicit approval.');
  const validity = dateVerdict(tariff.effectiveFrom, tariff.effectiveTo, eventDate);
  if (validity !== 'OK')
    return fail(
      validity,
      'The tariff is outside its effective dates for the clinical service date.',
    );
  if (!masterDepartmentMatches(tariff.department, master.department))
    return fail(
      'WRONG_DEPARTMENT',
      'The mapped tariff department does not match the master service.',
    );
  const type = (
    master.billingFamily === 'LABORATORY' ? 'LAB_TEST' : master.billingFamily
  ) as CatalogueServiceType;
  if (norm(tariff.unit) !== norm(master.unit) || unitVerdict(type, tariff.unit) !== 'OK')
    return fail(
      'UNIT_INCOMPATIBLE',
      'The tariff unit does not match the master service billing unit.',
    );
  return { master, tariff, rule, serviceDate: eventDate, performedAt };
}
