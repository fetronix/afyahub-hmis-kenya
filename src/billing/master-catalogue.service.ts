import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { unitVerdict, type CatalogueServiceType } from './tariff-resolver.ts';
import { masterDepartmentMatches } from './master-charge-resolver.ts';

export class MasterCatalogueError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type Facility = { id: number; tenantId: number; enabledModules: unknown };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function positiveId(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new MasterCatalogueError('INVALID_ID', 'A valid ID is required.');
  return result;
}
function price(value: unknown): string {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text))
    throw new MasterCatalogueError(
      'INVALID_PRICE',
      'Enter a nonnegative KES amount with at most two decimal places.',
    );
  return Number(text).toFixed(2);
}
function date(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new MasterCatalogueError('INVALID_DATE', 'Enter a valid ISO calendar date.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new MasterCatalogueError('INVALID_DATE', 'Enter a valid ISO calendar date.');
  return value;
}
function requireRevision(value: unknown): number {
  return positiveId(value);
}
function sourceType(family: string): CatalogueServiceType {
  return family === 'LABORATORY' ? 'LAB_TEST' : (family as CatalogueServiceType);
}
function normUnit(unit: string): string {
  return unit.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}
function auditSnapshot(t: typeof schema.facilityServiceTariffs.$inferSelect) {
  return {
    code: t.code,
    masterServiceId: t.masterServiceId,
    description: t.description,
    department: t.department,
    unit: t.unit,
    fee: t.fee,
    effectiveFrom: t.effectiveFrom,
    effectiveTo: t.effectiveTo,
    isActive: t.isActive,
    autoBill: t.autoBill,
    approvalStatus: t.approvalStatus,
    approvedAt: t.approvedAt,
    approvalReference: t.approvalReference,
    revision: t.revision,
  };
}
async function auditTariff(
  tx: Tx,
  facility: Facility,
  actor: number,
  action: string,
  before: typeof schema.facilityServiceTariffs.$inferSelect | null,
  after: typeof schema.facilityServiceTariffs.$inferSelect,
) {
  await tx.insert(schema.auditLogs).values({
    tenantId: facility.tenantId,
    facilityId: facility.id,
    userId: String(actor),
    action,
    resource: 'FACILITY_SERVICE_TARIFF',
    resourceId: String(after.id),
    details: JSON.stringify({
      before: before ? auditSnapshot(before) : null,
      after: auditSnapshot(after),
    }),
  });
}
async function lockFacility(tx: Tx, facility: Facility) {
  const [locked] = await tx
    .select()
    .from(schema.facilities)
    .where(
      and(eq(schema.facilities.id, facility.id), eq(schema.facilities.tenantId, facility.tenantId)),
    )
    .for('update');
  if (!locked) throw new MasterCatalogueError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  if (!Array.isArray(locked.enabledModules) || !locked.enabledModules.includes('finance'))
    throw new MasterCatalogueError(
      'FINANCE_DISABLED',
      'Finance is disabled for this facility.',
      403,
    );
}

/** Only this facility's source-backed services, global identities and its explicit tariffs. */
export async function listMasterCatalogue(facility: Facility) {
  return db
    .select({ master: schema.masterServices, tariff: schema.facilityServiceTariffs })
    .from(schema.masterServices)
    .leftJoin(
      schema.facilityServiceTariffs,
      and(
        eq(schema.facilityServiceTariffs.masterServiceId, schema.masterServices.id),
        eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
        eq(schema.facilityServiceTariffs.facilityId, facility.id),
      ),
    )
    .where(
      and(
        eq(schema.masterServices.isActive, true),
        or(
          isNull(schema.masterServices.tenantId),
          and(
            eq(schema.masterServices.tenantId, facility.tenantId),
            eq(schema.masterServices.originFacilityId, facility.id),
          ),
          eq(schema.facilityServiceTariffs.facilityId, facility.id),
        ),
      ),
    )
    .orderBy(
      asc(schema.masterServices.department),
      asc(schema.masterServices.description),
      asc(schema.masterServices.id),
    );
}

/**
 * Synchronise only real facility-owned catalogue rows and source-defined global
 * services. No name/code crosswalk is guessed and existing tariffs are never updated.
 */
export async function syncMasterCatalogue(facility: Facility, actor: number) {
  return db.transaction(async (tx) => {
    await lockFacility(tx, facility);
    let servicesCreated = 0,
      mappingsCreated = 0,
      tariffsCreated = 0,
      skippedMissingUnit = 0;
    const labs = await tx
      .select()
      .from(schema.labTests)
      .where(and(eq(schema.labTests.facilityId, facility.id), eq(schema.labTests.isActive, true)));
    const items = await tx
      .select()
      .from(schema.inventoryItems)
      .where(
        and(
          eq(schema.inventoryItems.facilityId, facility.id),
          eq(schema.inventoryItems.isActive, true),
        ),
      );
    const wards = await tx
      .select()
      .from(schema.wards)
      .where(and(eq(schema.wards.facilityId, facility.id), eq(schema.wards.isActive, true)));
    const sources = [
      ...labs.map((x) => ({
        kind: 'LAB_TEST',
        id: x.id,
        name: x.name,
        unit: 'Test',
        family: 'LABORATORY',
        department: 'laboratory',
        prefix: 'LAB',
      })),
      ...items.map((x) => ({
        kind: 'PHARMACY',
        id: x.id,
        name: x.name,
        unit: x.unit ?? '',
        family: 'PHARMACY',
        department: 'pharmacy',
        prefix: 'ITEM',
      })),
      ...wards.map((x) => ({
        kind: 'BED_DAY',
        id: x.id,
        name: `${x.name} bed-day`,
        unit: 'Day',
        family: 'BED_DAY',
        department: 'inpatient',
        prefix: 'WARD',
      })),
    ];
    for (const source of sources) {
      if (!source.name.trim() || !source.unit.trim() || source.unit.length > 50) {
        skippedMissingUnit++;
        continue;
      }
      const code = `JC-T${facility.tenantId}-${source.prefix}-${source.id}`;
      const [inserted] = await tx
        .insert(schema.masterServices)
        .values({
          tenantId: facility.tenantId,
          code,
          description: source.name.trim().slice(0, 500),
          department: source.department,
          billingFamily: source.family,
          unit: source.unit.trim(),
          clinicalSource: source.kind,
          originFacilityId: facility.id,
          originSourceId: source.id,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) servicesCreated++;
      const [master] = inserted
        ? [inserted]
        : await tx
            .select()
            .from(schema.masterServices)
            .where(
              and(
                eq(schema.masterServices.tenantId, facility.tenantId),
                eq(schema.masterServices.originFacilityId, facility.id),
                eq(schema.masterServices.clinicalSource, source.kind),
                eq(schema.masterServices.originSourceId, source.id),
              ),
            )
            .limit(1);
      if (!master)
        throw new MasterCatalogueError(
          'CATALOGUE_CONFLICT',
          'A service code or source conflicts; review before synchronising.',
          409,
        );
      // Never recreate an explicitly retired mapping during synchronisation.
      // Its reviewed history is authoritative even when no active mapping exists.
      const [historicalMapping] = await tx
        .select({ id: schema.masterServiceSources.id })
        .from(schema.masterServiceSources)
        .where(
          and(
            eq(schema.masterServiceSources.tenantId, facility.tenantId),
            eq(schema.masterServiceSources.facilityId, facility.id),
            eq(schema.masterServiceSources.sourceType, source.kind),
            eq(schema.masterServiceSources.sourceId, source.id),
          ),
        )
        .limit(1);
      if (!historicalMapping) {
        const [mapping] = await tx
          .insert(schema.masterServiceSources)
          .values({
            tenantId: facility.tenantId,
            facilityId: facility.id,
            sourceType: source.kind,
            sourceId: source.id,
            masterServiceId: master.id,
            createdByUserId: actor,
          })
          .onConflictDoNothing()
          .returning({ id: schema.masterServiceSources.id });
        if (mapping) mappingsCreated++;
      }
    }
    const masters = await tx
      .select()
      .from(schema.masterServices)
      .where(
        and(
          eq(schema.masterServices.isActive, true),
          or(
            isNull(schema.masterServices.tenantId),
            and(
              eq(schema.masterServices.tenantId, facility.tenantId),
              eq(schema.masterServices.originFacilityId, facility.id),
            ),
          ),
        ),
      );
    for (const master of masters) {
      const [created] = await tx
        .insert(schema.facilityServiceTariffs)
        .values({
          tenantId: facility.tenantId,
          facilityId: facility.id,
          code: master.code,
          description: master.description,
          department: master.department,
          unit: master.unit,
          fee: '0.00',
          isActive: false,
          autoBill: false,
          masterServiceId: master.id,
        })
        .onConflictDoNothing()
        .returning();
      if (created) {
        tariffsCreated++;
        await auditTariff(tx, facility, actor, 'CREATE', null, created);
      }
    }
    return {
      servicesCreated,
      mappingsCreated,
      tariffsCreated,
      skippedMissingUnit,
      note: 'Existing tariffs and prices are not modified. New entries are inactive, unapproved and unconfigured.',
    };
  });
}

/** An administrator defines an actual examination for the implemented imaging workflow. */
export async function createImagingService(
  facility: Facility,
  actor: number,
  input: { description?: unknown },
) {
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (!description || description.length > 500)
    throw new MasterCatalogueError(
      'INVALID_DESCRIPTION',
      'An examination description is required.',
    );
  return db.transaction(async (tx) => {
    await lockFacility(tx, facility);
    const code = `JC-T${facility.tenantId}-RAD-${randomUUID().replaceAll('-', '').toUpperCase()}`;
    const [master] = await tx
      .insert(schema.masterServices)
      .values({
        tenantId: facility.tenantId,
        code,
        description,
        department: 'radiology',
        billingFamily: 'RADIOLOGY',
        unit: 'Study',
        clinicalSource: 'RADIOLOGY_EXAMINATION',
      })
      .returning();
    const [tariff] = await tx
      .insert(schema.facilityServiceTariffs)
      .values({
        tenantId: facility.tenantId,
        facilityId: facility.id,
        code,
        description,
        department: 'radiology',
        unit: 'Study',
        fee: '0.00',
        isActive: false,
        autoBill: false,
        masterServiceId: master.id,
      })
      .returning();
    await auditTariff(tx, facility, actor, 'CREATE', null, tariff);
    return { master, tariff };
  });
}

export interface TariffEdit {
  tariffId: unknown;
  revision: unknown;
  fee: unknown;
  unit: unknown;
  effectiveFrom?: unknown;
  effectiveTo?: unknown;
  isActive: unknown;
  autoBill: unknown;
}
function parseEdit(input: TariffEdit) {
  const tariffId = positiveId(input.tariffId),
    revision = requireRevision(input.revision),
    fee = price(input.fee);
  const unit = typeof input.unit === 'string' ? input.unit.trim() : '';
  const effectiveFrom = date(input.effectiveFrom),
    effectiveTo = date(input.effectiveTo);
  if (
    !unit ||
    unit.length > 50 ||
    typeof input.isActive !== 'boolean' ||
    typeof input.autoBill !== 'boolean'
  )
    throw new MasterCatalogueError(
      'INVALID_TARIFF',
      'Provide a unit and explicit activation settings.',
    );
  if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo)
    throw new MasterCatalogueError(
      'INVALID_DATES',
      'The end date must not precede the start date.',
    );
  return {
    tariffId,
    revision,
    fee,
    unit,
    effectiveFrom,
    effectiveTo,
    isActive: input.isActive,
    autoBill: input.autoBill,
  };
}

/** Atomic bulk edit with optimistic revisions; approval is invalidated on any changed pricing input. */
export async function editMasterTariffs(facility: Facility, actor: number, input: unknown) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 200)
    throw new MasterCatalogueError('INVALID_BATCH', 'Provide 1–200 tariff edits.');
  const edits = input
    .map((x) => parseEdit(x as TariffEdit))
    .sort((a, b) => a.tariffId - b.tariffId);
  if (new Set(edits.map((x) => x.tariffId)).size !== edits.length)
    throw new MasterCatalogueError('DUPLICATE_TARIFF', 'A tariff may appear only once.');
  return db.transaction(async (tx) => {
    await lockFacility(tx, facility);
    const result: Array<typeof schema.facilityServiceTariffs.$inferSelect> = [];
    for (const edit of edits) {
      const [before] = await tx
        .select()
        .from(schema.facilityServiceTariffs)
        .where(
          and(
            eq(schema.facilityServiceTariffs.id, edit.tariffId),
            eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
            eq(schema.facilityServiceTariffs.facilityId, facility.id),
          ),
        )
        .for('update');
      if (!before || !before.masterServiceId)
        throw new MasterCatalogueError(
          'TARIFF_NOT_FOUND',
          'A mapped tariff was not found in this facility.',
          404,
        );
      if (before.revision !== edit.revision)
        throw new MasterCatalogueError(
          'TARIFF_CHANGED',
          'A tariff changed since it was loaded; refresh before saving. Nothing was changed.',
          409,
        );
      const [after] = await tx
        .update(schema.facilityServiceTariffs)
        .set({
          fee: edit.fee,
          unit: edit.unit,
          effectiveFrom: edit.effectiveFrom,
          effectiveTo: edit.effectiveTo,
          isActive: edit.isActive,
          autoBill: edit.autoBill,
          updatedAt: new Date(),
        })
        .where(eq(schema.facilityServiceTariffs.id, before.id))
        .returning();
      await auditTariff(tx, facility, actor, 'UPDATE', before, after);
      result.push(after);
    }
    return result;
  });
}

export async function approveMasterTariff(
  facility: Facility,
  actor: number,
  tariffId: unknown,
  revision: unknown,
  reference: unknown,
) {
  const id = positiveId(tariffId),
    expected = requireRevision(revision);
  const approval = typeof reference === 'string' ? reference.trim() : '';
  if (
    approval.length < 3 ||
    approval.length > 200 ||
    [...approval].some((char) => char.charCodeAt(0) < 32)
  )
    throw new MasterCatalogueError(
      'APPROVAL_REFERENCE_REQUIRED',
      'Provide an approval reference (3–200 characters).',
    );
  return db.transaction(async (tx) => {
    await lockFacility(tx, facility);
    const [row] = await tx
      .select({ tariff: schema.facilityServiceTariffs, master: schema.masterServices })
      .from(schema.facilityServiceTariffs)
      .innerJoin(
        schema.masterServices,
        eq(schema.masterServices.id, schema.facilityServiceTariffs.masterServiceId),
      )
      .where(
        and(
          eq(schema.facilityServiceTariffs.id, id),
          eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
          eq(schema.facilityServiceTariffs.facilityId, facility.id),
        ),
      )
      .for('update');
    if (!row) throw new MasterCatalogueError('TARIFF_NOT_FOUND', 'Mapped tariff not found.', 404);
    if (row.tariff.revision !== expected)
      throw new MasterCatalogueError(
        'TARIFF_CHANGED',
        'Tariff changed; refresh before approving.',
        409,
      );
    if (
      !row.tariff.isActive ||
      !row.tariff.autoBill ||
      Number(row.tariff.fee) <= 0 ||
      !row.master.isActive ||
      !masterDepartmentMatches(row.tariff.department, row.master.department) ||
      normUnit(row.tariff.unit) !== normUnit(row.master.unit) ||
      unitVerdict(sourceType(row.master.billingFamily), row.tariff.unit) !== 'OK'
    )
      throw new MasterCatalogueError(
        'TARIFF_NOT_APPROVABLE',
        'Enable the service and automatic billing, enter a positive price, and use the master service unit before approval.',
        409,
      );
    const [after] = await tx
      .update(schema.facilityServiceTariffs)
      .set({
        approvalStatus: 'APPROVED',
        approvedByUserId: actor,
        approvedAt: new Date(),
        approvalReference: approval,
        updatedAt: new Date(),
      })
      .where(eq(schema.facilityServiceTariffs.id, id))
      .returning();
    await auditTariff(tx, facility, actor, 'APPROVE', row.tariff, after);
    return after;
  });
}

/** Attach a reviewed legacy price without changing that price or its code. */
export async function attachLegacyTariff(
  facility: Facility,
  actor: number,
  masterId: unknown,
  tariffId: unknown,
  revision: unknown,
) {
  const mid = positiveId(masterId),
    tid = positiveId(tariffId),
    expected = requireRevision(revision);
  return db.transaction(async (tx) => {
    await lockFacility(tx, facility);
    const catalogue = await tx
      .select()
      .from(schema.masterServices)
      .where(
        and(
          eq(schema.masterServices.id, mid),
          eq(schema.masterServices.isActive, true),
          or(
            isNull(schema.masterServices.tenantId),
            and(
              eq(schema.masterServices.tenantId, facility.tenantId),
              eq(schema.masterServices.originFacilityId, facility.id),
            ),
          ),
        ),
      )
      .limit(1);
    // A facility-owned imaging master has no origin source; it is visible via its existing placeholder.
    const [existingPlaceholder] = await tx
      .select()
      .from(schema.facilityServiceTariffs)
      .where(
        and(
          eq(schema.facilityServiceTariffs.facilityId, facility.id),
          eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
          eq(schema.facilityServiceTariffs.masterServiceId, mid),
        ),
      )
      .for('update');
    if (!catalogue.length && !existingPlaceholder)
      throw new MasterCatalogueError(
        'SERVICE_NOT_FOUND',
        'Service is not available in this facility.',
        404,
      );
    const [legacy] = await tx
      .select()
      .from(schema.facilityServiceTariffs)
      .where(
        and(
          eq(schema.facilityServiceTariffs.id, tid),
          eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
          eq(schema.facilityServiceTariffs.facilityId, facility.id),
        ),
      )
      .for('update');
    if (!legacy) throw new MasterCatalogueError('TARIFF_NOT_FOUND', 'Tariff not found.', 404);
    if (legacy.revision !== expected)
      throw new MasterCatalogueError(
        'TARIFF_CHANGED',
        'Tariff changed; refresh before linking.',
        409,
      );
    if (legacy.masterServiceId && legacy.masterServiceId !== mid)
      throw new MasterCatalogueError(
        'TARIFF_ALREADY_MAPPED',
        'Tariff is already mapped to another service.',
        409,
      );
    if (existingPlaceholder && existingPlaceholder.id !== legacy.id) {
      const [used] = await tx
        .select({ id: schema.billingItems.id })
        .from(schema.billingItems)
        .where(eq(schema.billingItems.tariffId, existingPlaceholder.id))
        .limit(1);
      if (
        used ||
        Number(existingPlaceholder.fee) !== 0 ||
        existingPlaceholder.isActive ||
        existingPlaceholder.approvalStatus !== 'DRAFT'
      )
        throw new MasterCatalogueError(
          'MAPPED_TARIFF_EXISTS',
          'The existing mapped tariff needs authorized review; it was not replaced.',
          409,
        );
      const [detached] = await tx
        .update(schema.facilityServiceTariffs)
        .set({ masterServiceId: null, updatedAt: new Date() })
        .where(eq(schema.facilityServiceTariffs.id, existingPlaceholder.id))
        .returning();
      await auditTariff(tx, facility, actor, 'UPDATE', existingPlaceholder, detached);
    }
    const [after] = await tx
      .update(schema.facilityServiceTariffs)
      .set({ masterServiceId: mid, updatedAt: new Date() })
      .where(eq(schema.facilityServiceTariffs.id, legacy.id))
      .returning();
    await auditTariff(tx, facility, actor, 'UPDATE', legacy, after);
    return after;
  });
}

export async function tariffHistory(facility: Facility, tariffId: unknown) {
  const id = positiveId(tariffId);
  const [tariff] = await db
    .select({ id: schema.facilityServiceTariffs.id })
    .from(schema.facilityServiceTariffs)
    .where(
      and(
        eq(schema.facilityServiceTariffs.id, id),
        eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
        eq(schema.facilityServiceTariffs.facilityId, facility.id),
      ),
    )
    .limit(1);
  if (!tariff) throw new MasterCatalogueError('TARIFF_NOT_FOUND', 'Tariff not found.', 404);
  return db
    .select({
      id: schema.auditLogs.id,
      action: schema.auditLogs.action,
      userId: schema.auditLogs.userId,
      details: schema.auditLogs.details,
      createdAt: schema.auditLogs.timestamp,
    })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.tenantId, facility.tenantId),
        eq(schema.auditLogs.facilityId, facility.id),
        eq(schema.auditLogs.resource, 'FACILITY_SERVICE_TARIFF'),
        eq(schema.auditLogs.resourceId, String(id)),
      ),
    )
    .orderBy(asc(schema.auditLogs.id))
    .limit(500);
}

type SourceKind = 'LAB_TEST' | 'PHARMACY' | 'BED_DAY';
function sourceKind(value: unknown): SourceKind {
  if (value !== 'LAB_TEST' && value !== 'PHARMACY' && value !== 'BED_DAY')
    throw new MasterCatalogueError(
      'INVALID_SOURCE_TYPE',
      'Select an existing laboratory test, dispensed product or ward.',
    );
  return value;
}
async function sourceInFacility(tx: Tx, facility: Facility, kind: SourceKind, id: number) {
  if (kind === 'LAB_TEST') {
    const [row] = await tx
      .select({ id: schema.labTests.id, code: schema.labTests.code, unit: sql<string>`'Test'` })
      .from(schema.labTests)
      .where(and(eq(schema.labTests.id, id), eq(schema.labTests.facilityId, facility.id)))
      .limit(1);
    return row;
  }
  if (kind === 'PHARMACY') {
    const [row] = await tx
      .select({
        id: schema.inventoryItems.id,
        code: schema.inventoryItems.itemCode,
        unit: schema.inventoryItems.unit,
      })
      .from(schema.inventoryItems)
      .where(
        and(eq(schema.inventoryItems.id, id), eq(schema.inventoryItems.facilityId, facility.id)),
      )
      .limit(1);
    return row;
  }
  const [row] = await tx
    .select({ id: schema.wards.id, code: schema.wards.code, unit: sql<string>`'Day'` })
    .from(schema.wards)
    .where(and(eq(schema.wards.id, id), eq(schema.wards.facilityId, facility.id)))
    .limit(1);
  return row;
}
async function targetMaster(tx: Tx, facility: Facility, id: number, kind: SourceKind) {
  const [row] = await tx
    .select({ master: schema.masterServices })
    .from(schema.masterServices)
    .innerJoin(
      schema.facilityServiceTariffs,
      and(
        eq(schema.facilityServiceTariffs.masterServiceId, schema.masterServices.id),
        eq(schema.facilityServiceTariffs.facilityId, facility.id),
        eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
      ),
    )
    .where(and(eq(schema.masterServices.id, id), eq(schema.masterServices.isActive, true)))
    .limit(1);
  const expected = kind === 'LAB_TEST' ? 'LABORATORY' : kind;
  if (
    !row ||
    row.master.billingFamily !== expected ||
    (row.master.tenantId !== null && row.master.tenantId !== facility.tenantId) ||
    (row.master.originFacilityId !== null && row.master.originFacilityId !== facility.id)
  )
    throw new MasterCatalogueError(
      'SERVICE_NOT_FOUND',
      'The service is not available for this source in the facility.',
      404,
    );
  return row.master;
}
function reviewReference(value: unknown): string {
  const reference = typeof value === 'string' ? value.trim() : '';
  if (reference.length < 3 || reference.length > 200)
    throw new MasterCatalogueError(
      'REVIEW_REFERENCE_REQUIRED',
      'Enter a review reference of 3–200 characters.',
    );
  return reference;
}

/** Audited, explicit source identity changes; no old mapping is deleted. */
export async function setMasterSourceMapping(
  facility: Facility,
  actor: number,
  masterId: unknown,
  input: { sourceType?: unknown; sourceId?: unknown; reviewReference?: unknown },
) {
  const id = positiveId(masterId),
    kind = sourceKind(input.sourceType),
    sourceId = positiveId(input.sourceId),
    review = reviewReference(input.reviewReference);
  return db.transaction(async (tx) => {
    await lockFacility(tx, facility);
    const master = await targetMaster(tx, facility, id, kind);
    const source = await sourceInFacility(tx, facility, kind, sourceId);
    if (!source || !source.unit || normUnit(source.unit) !== normUnit(master.unit))
      throw new MasterCatalogueError(
        'SOURCE_UNIT_MISMATCH',
        'The selected source is missing or its billing unit differs from the master service.',
        409,
      );
    const [previous] = await tx
      .select()
      .from(schema.masterServiceSources)
      .where(
        and(
          eq(schema.masterServiceSources.facilityId, facility.id),
          eq(schema.masterServiceSources.tenantId, facility.tenantId),
          eq(schema.masterServiceSources.sourceType, kind),
          eq(schema.masterServiceSources.sourceId, sourceId),
          eq(schema.masterServiceSources.isActive, true),
        ),
      )
      .for('update');
    if (previous?.masterServiceId === id) return previous;
    if (previous)
      await tx
        .update(schema.masterServiceSources)
        .set({ isActive: false })
        .where(eq(schema.masterServiceSources.id, previous.id));
    const [mapping] = await tx
      .insert(schema.masterServiceSources)
      .values({
        tenantId: facility.tenantId,
        facilityId: facility.id,
        sourceType: kind,
        sourceId,
        masterServiceId: id,
        createdByUserId: actor,
      })
      .returning();
    await tx.insert(schema.auditLogs).values({
      tenantId: facility.tenantId,
      facilityId: facility.id,
      userId: String(actor),
      action: 'UPDATE',
      resource: 'MASTER_SERVICE_SOURCE',
      resourceId: String(mapping.id),
      details: JSON.stringify({
        sourceType: kind,
        sourceId,
        previousMasterServiceId: previous?.masterServiceId ?? null,
        masterServiceId: id,
        reviewReference: review,
      }),
    });
    return mapping;
  });
}

/** Explicitly approve a structured legacy code from one actual source record. */
export async function approveMasterAlias(
  facility: Facility,
  actor: number,
  masterId: unknown,
  input: { sourceType?: unknown; sourceId?: unknown; reviewReference?: unknown },
) {
  const id = positiveId(masterId),
    kind = sourceKind(input.sourceType),
    sourceId = positiveId(input.sourceId),
    review = reviewReference(input.reviewReference);
  return db.transaction(async (tx) => {
    await lockFacility(tx, facility);
    const master = await targetMaster(tx, facility, id, kind);
    const source = await sourceInFacility(tx, facility, kind, sourceId);
    if (
      !source ||
      !source.code ||
      !source.unit ||
      normUnit(source.unit) !== normUnit(master.unit) ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(source.code.trim())
    )
      throw new MasterCatalogueError(
        'INVALID_ALIAS_SOURCE',
        'The source must have a structured code and the same billing unit.',
        409,
      );
    const matches =
      kind === 'LAB_TEST'
        ? await tx
            .select({ id: schema.labTests.id })
            .from(schema.labTests)
            .where(
              and(
                eq(schema.labTests.facilityId, facility.id),
                sql`upper(trim(${schema.labTests.code})) = upper(trim(${source.code}))`,
              ),
            )
            .limit(2)
        : kind === 'PHARMACY'
          ? await tx
              .select({ id: schema.inventoryItems.id })
              .from(schema.inventoryItems)
              .where(
                and(
                  eq(schema.inventoryItems.facilityId, facility.id),
                  sql`upper(trim(${schema.inventoryItems.itemCode})) = upper(trim(${source.code}))`,
                ),
              )
              .limit(2)
          : await tx
              .select({ id: schema.wards.id })
              .from(schema.wards)
              .where(
                and(
                  eq(schema.wards.facilityId, facility.id),
                  sql`upper(trim(${schema.wards.code})) = upper(trim(${source.code}))`,
                ),
              )
              .limit(2);
    if (matches.length !== 1)
      throw new MasterCatalogueError(
        'SOURCE_CODE_AMBIGUOUS',
        'That code is not unique within the facility; map the source ID instead.',
        409,
      );
    const [existing] = await tx
      .select()
      .from(schema.masterServiceAliases)
      .where(
        and(
          eq(schema.masterServiceAliases.facilityId, facility.id),
          eq(schema.masterServiceAliases.sourceType, kind),
          eq(schema.masterServiceAliases.isActive, true),
          sql`upper(trim(${schema.masterServiceAliases.alias})) = upper(trim(${source.code}))`,
        ),
      )
      .limit(1);
    if (existing)
      throw new MasterCatalogueError(
        'ALIAS_EXISTS',
        'An approved alias already exists for that source code; review it before changing it.',
        409,
      );
    const [alias] = await tx
      .insert(schema.masterServiceAliases)
      .values({
        tenantId: facility.tenantId,
        facilityId: facility.id,
        sourceType: kind,
        alias: source.code.trim().toUpperCase(),
        masterServiceId: id,
        approvedByUserId: actor,
        approvalReference: review,
      })
      .returning();
    await tx.insert(schema.auditLogs).values({
      tenantId: facility.tenantId,
      facilityId: facility.id,
      userId: String(actor),
      action: 'APPROVE',
      resource: 'MASTER_SERVICE_ALIAS',
      resourceId: String(alias.id),
      details: JSON.stringify({
        sourceType: kind,
        sourceId,
        code: alias.alias,
        masterServiceId: id,
        reviewReference: review,
      }),
    });
    return alias;
  });
}

export async function listMasterMappings(facility: Facility, masterId: unknown) {
  const id = positiveId(masterId);
  const [tariff] = await db
    .select({ id: schema.facilityServiceTariffs.id })
    .from(schema.facilityServiceTariffs)
    .where(
      and(
        eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
        eq(schema.facilityServiceTariffs.facilityId, facility.id),
        eq(schema.facilityServiceTariffs.masterServiceId, id),
      ),
    )
    .limit(1);
  if (!tariff)
    throw new MasterCatalogueError(
      'SERVICE_NOT_FOUND',
      'Service not available in this facility.',
      404,
    );
  const sources = await db
    .select()
    .from(schema.masterServiceSources)
    .where(
      and(
        eq(schema.masterServiceSources.tenantId, facility.tenantId),
        eq(schema.masterServiceSources.facilityId, facility.id),
        eq(schema.masterServiceSources.masterServiceId, id),
      ),
    )
    .orderBy(asc(schema.masterServiceSources.id));
  const aliases = await db
    .select()
    .from(schema.masterServiceAliases)
    .where(
      and(
        eq(schema.masterServiceAliases.tenantId, facility.tenantId),
        eq(schema.masterServiceAliases.facilityId, facility.id),
        eq(schema.masterServiceAliases.masterServiceId, id),
      ),
    )
    .orderBy(asc(schema.masterServiceAliases.id));
  return { sources, aliases };
}

/** Retire, never delete, a reviewed alias. Historical invoices are untouched. */
export async function retireMasterAlias(
  facility: Facility,
  actor: number,
  aliasId: unknown,
  reasonInput: unknown,
) {
  const id = positiveId(aliasId),
    reason = reviewReference(reasonInput);
  return db.transaction(async (tx) => {
    await lockFacility(tx, facility);
    const [alias] = await tx
      .select()
      .from(schema.masterServiceAliases)
      .where(
        and(
          eq(schema.masterServiceAliases.id, id),
          eq(schema.masterServiceAliases.tenantId, facility.tenantId),
          eq(schema.masterServiceAliases.facilityId, facility.id),
        ),
      )
      .for('update');
    if (!alias)
      throw new MasterCatalogueError('ALIAS_NOT_FOUND', 'Alias not found in this facility.', 404);
    if (!alias.isActive)
      throw new MasterCatalogueError(
        'ALIAS_ALREADY_RETIRED',
        'This alias is already retired.',
        409,
      );
    const [updated] = await tx
      .update(schema.masterServiceAliases)
      .set({ isActive: false })
      .where(eq(schema.masterServiceAliases.id, id))
      .returning();
    await tx.insert(schema.auditLogs).values({
      tenantId: facility.tenantId,
      facilityId: facility.id,
      userId: String(actor),
      action: 'UPDATE',
      resource: 'MASTER_SERVICE_ALIAS',
      resourceId: String(id),
      details: JSON.stringify({
        action: 'RETIRE',
        reason,
        sourceType: alias.sourceType,
        code: alias.alias,
        masterServiceId: alias.masterServiceId,
      }),
    });
    return updated;
  });
}
