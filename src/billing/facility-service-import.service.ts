import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { tariffModuleForDepartment } from './tariff-departments.ts';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { formatCents, parseMoneyToCents } from './settlement.ts';
import {
  createFacilityServiceInput,
  facilityServiceDay,
  FacilityServiceError,
  requireFacilityServiceModule,
  type FacilityServiceScope,
} from './facility-service-input.ts';
import {
  auditFacilityService,
  createFacilityServiceWithTariff,
} from './facility-service-operations.ts';

const KIND = 'FACILITY_SERVICE_CATALOGUE_V1';
const batchRowInput = createFacilityServiceInput
  .extend({ effectiveFrom: facilityServiceDay, effectiveTo: facilityServiceDay })
  .strict()
  .refine((row) => !row.effectiveFrom || !row.effectiveTo || row.effectiveFrom <= row.effectiveTo);

type Row = {
  code: string;
  name: string;
  description: string;
  department: string;
  category: z.output<typeof createFacilityServiceInput>['category'];
  unit: string;
  isActive: boolean;
  autoBill: boolean;
  initialPrice: string;
  initialTariffCode: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};
type IndexedRow = { row: number; value: Row };
type Issue = { row: number; reasons: string[] };
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, 'select'> | Pick<Transaction, 'select'>;
type Created = {
  kind: typeof KIND;
  serviceId: number;
  tariffId: number;
  serviceCode: string;
  tariffCode: string;
};

export class FacilityServiceImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly issues?: Issue[],
  ) {
    super(message);
  }
}

function normalize(facility: FacilityServiceScope, input: unknown, checkEnabled = true) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 200)
    throw new FacilityServiceImportError('INVALID_BATCH_SIZE', 'Provide between 1 and 200 rows.');
  const rows: IndexedRow[] = [];
  const issues: Issue[] = [];
  for (const [index, value] of input.entries()) {
    const parsed = batchRowInput.safeParse(value);
    if (!parsed.success) {
      issues.push({ row: index + 1, reasons: ['INVALID_SERVICE_OR_TARIFF'] });
      continue;
    }
    const data = parsed.data;
    let department: string;
    try {
      const module = tariffModuleForDepartment(data.department);
      // A replay must still be identifiable if a clinical module was disabled
      // after the original commit. New writes recheck actual modules under lock.
      const scope = checkEnabled
        ? facility
        : { ...facility, enabledModules: module ? [module] : [] };
      department = requireFacilityServiceModule(scope, data.department, data.category);
    } catch (error) {
      if (!(error instanceof FacilityServiceError)) throw error;
      issues.push({ row: index + 1, reasons: [error.code] });
      continue;
    }
    const cents = parseMoneyToCents(data.initialPrice);
    // The shared money validator is stricter than this parser. Fail closed if
    // either implementation ever changes rather than silently assuming zero.
    if (cents === null || cents < 0) {
      issues.push({ row: index + 1, reasons: ['INVALID_PRICE'] });
      continue;
    }
    rows.push({
      row: index + 1,
      value: {
        code: data.code,
        name: data.name,
        description: data.description,
        department,
        category: data.category,
        unit: data.unit,
        isActive: data.isActive,
        autoBill: data.autoBill,
        initialPrice: formatCents(cents),
        initialTariffCode: data.initialTariffCode ?? data.code,
        effectiveFrom: data.effectiveFrom ?? null,
        effectiveTo: data.effectiveTo ?? null,
      },
    });
  }
  return { rows, issues, rowCount: input.length };
}

async function conflicts(reader: Reader, facility: FacilityServiceScope, rows: IndexedRow[]) {
  if (!rows.length) return [];
  const serviceCodes = rows.map(({ value }) => value.code);
  const tariffCodes = rows.map(({ value }) => value.initialTariffCode);
  const [services, tariffs] = await Promise.all([
    reader
      .select({ code: sql<string>`upper(trim(${schema.facilityServices.code}))` })
      .from(schema.facilityServices)
      .where(
        and(
          eq(schema.facilityServices.tenantId, facility.tenantId),
          eq(schema.facilityServices.facilityId, facility.id),
          inArray(sql<string>`upper(trim(${schema.facilityServices.code}))`, serviceCodes),
        ),
      ),
    reader
      .select({ code: sql<string>`upper(trim(${schema.facilityServiceTariffs.code}))` })
      .from(schema.facilityServiceTariffs)
      .where(
        and(
          eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
          eq(schema.facilityServiceTariffs.facilityId, facility.id),
          inArray(sql<string>`upper(trim(${schema.facilityServiceTariffs.code}))`, tariffCodes),
        ),
      ),
  ]);
  const existingServices = new Set(services.map((record) => record.code));
  const existingTariffs = new Set(tariffs.map((record) => record.code));
  return rows.flatMap(({ row, value }) => {
    const reasons: string[] = [];
    if (serviceCodes.filter((code) => code === value.code).length > 1)
      reasons.push('DUPLICATE_SERVICE_CODE_IN_BATCH');
    if (tariffCodes.filter((code) => code === value.initialTariffCode).length > 1)
      reasons.push('DUPLICATE_TARIFF_CODE_IN_BATCH');
    if (existingServices.has(value.code)) reasons.push('SERVICE_CODE_ALREADY_EXISTS');
    // Include inactive, archived and unlinked historical tariffs: never reuse
    // their identities or overwrite them through a bulk import.
    if (existingTariffs.has(value.initialTariffCode)) reasons.push('TARIFF_CODE_ALREADY_EXISTS');
    return reasons.length ? [{ row, reasons }] : [];
  });
}

export async function previewFacilityServiceImport(facility: FacilityServiceScope, input: unknown) {
  const parsed = normalize(facility, input);
  const issues = [...parsed.issues, ...(await conflicts(db, facility, parsed.rows))].sort(
    (a, b) => a.row - b.row,
  );
  return {
    valid: issues.length === 0,
    rowCount: parsed.rowCount,
    // Only fully valid batches can be reviewed/confirmed. Never return arbitrary
    // unknown fields or values from an invalid row.
    rows: issues.length ? [] : parsed.rows.map(({ value }) => value),
    issues,
  };
}

function validKey(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value.trim()))
    throw new FacilityServiceImportError(
      'INVALID_IDEMPOTENCY_KEY',
      'A valid retry identity is required.',
    );
  return value.trim();
}

function validApproval(value: unknown) {
  const approval = typeof value === 'string' ? value.trim() : '';
  if (
    approval.length < 3 ||
    approval.length > 200 ||
    [...approval].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new FacilityServiceImportError(
      'APPROVAL_REFERENCE_REQUIRED',
      'A documented facility approval reference is required.',
    );
  return approval;
}

function requestHash(rows: Row[], approvalReference: string) {
  return createHash('sha256')
    .update(JSON.stringify({ kind: KIND, rows, approvalReference }))
    .digest('hex');
}

function createdResult(value: unknown): Created[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) return null;
  if (
    !value.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        item.kind === KIND &&
        Number.isSafeInteger(item.serviceId) &&
        item.serviceId > 0 &&
        Number.isSafeInteger(item.tariffId) &&
        item.tariffId > 0 &&
        typeof item.serviceCode === 'string' &&
        typeof item.tariffCode === 'string',
    )
  )
    return null;
  return value.map((item) => ({
    kind: KIND,
    serviceId: item.serviceId,
    tariffId: item.tariffId,
    serviceCode: item.serviceCode,
    tariffCode: item.tariffCode,
  }));
}

export async function importFacilityServices(
  facility: FacilityServiceScope,
  actor: number,
  input: Record<string, unknown>,
) {
  const key = validKey(input.idempotencyKey);
  if (input.confirmed !== true)
    throw new FacilityServiceImportError(
      'APPROVAL_REFERENCE_REQUIRED',
      'Explicit confirmation and a documented facility approval reference are required.',
    );
  const approval = validApproval(input.approvalReference);
  // Validate syntax before looking for a replay, but use persisted module state
  // under lock before a new write. A replay does not create or alter rows.
  const parsed = normalize(facility, input.rows, false);
  if (parsed.issues.length)
    throw new FacilityServiceImportError(
      'INVALID_BATCH',
      'Review the invalid rows; nothing was imported.',
      400,
      parsed.issues,
    );
  const rows = parsed.rows.map(({ value }) => value);
  const hash = requestHash(rows, approval);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`facility-service-import:${key}`}, ${facility.id}))`,
    );
    const [previous] = await tx
      .select()
      .from(schema.facilityTariffImportBatches)
      .where(
        and(
          eq(schema.facilityTariffImportBatches.tenantId, facility.tenantId),
          eq(schema.facilityTariffImportBatches.facilityId, facility.id),
          eq(schema.facilityTariffImportBatches.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (previous) {
      const created = createdResult(previous.result);
      if (previous.requestHash !== hash || !created || created.length !== previous.rowCount)
        throw new FacilityServiceImportError(
          'IDEMPOTENCY_CONFLICT',
          'This retry identity belongs to a different import.',
          409,
        );
      return {
        idempotentReplay: true,
        batchId: previous.id,
        rowCount: previous.rowCount,
        services: created,
      };
    }
    const [locked] = await tx
      .select({ enabledModules: schema.facilities.enabledModules })
      .from(schema.facilities)
      .where(
        and(
          eq(schema.facilities.id, facility.id),
          eq(schema.facilities.tenantId, facility.tenantId),
        ),
      )
      .limit(1)
      .for('update');
    if (!locked)
      throw new FacilityServiceImportError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
    const current = { ...facility, enabledModules: locked.enabledModules };
    if (!Array.isArray(current.enabledModules) || !current.enabledModules.includes('finance'))
      throw new FacilityServiceImportError(
        'FACILITY_MODULE_DISABLED',
        'Finance is not enabled for this facility.',
        403,
      );
    // Revalidate every module after taking the facility lock and before writing.
    const rechecked = normalize(current, input.rows);
    if (rechecked.issues.length)
      throw new FacilityServiceImportError(
        'BATCH_CONFLICT',
        'Facility settings changed; nothing was imported.',
        409,
        rechecked.issues,
      );
    const issues = await conflicts(tx, current, rechecked.rows);
    if (issues.length)
      throw new FacilityServiceImportError(
        'BATCH_CONFLICT',
        'Review the import conflicts; nothing was imported.',
        409,
        issues,
      );
    const created: Created[] = [];
    for (const { value } of rechecked.rows) {
      const result = await createFacilityServiceWithTariff(tx, current, actor, value);
      created.push({
        kind: KIND,
        serviceId: result.service.id,
        tariffId: result.tariff.id,
        serviceCode: result.service.code,
        tariffCode: result.tariff.code,
      });
    }
    const [batch] = await tx
      .insert(schema.facilityTariffImportBatches)
      .values({
        tenantId: facility.tenantId,
        facilityId: facility.id,
        actorUserId: actor,
        idempotencyKey: key,
        requestHash: hash,
        approvalReference: approval,
        result: created,
        rowCount: created.length,
      })
      .returning({ id: schema.facilityTariffImportBatches.id });
    await auditFacilityService(tx, facility, actor, 'IMPORT', 'FACILITY_SERVICE_IMPORT', batch.id, {
      approvalReference: approval,
      rowCount: created.length,
      services: created,
    });
    return {
      idempotentReplay: false,
      batchId: batch.id,
      rowCount: created.length,
      services: created,
    };
  });
}

/** NOT_FOUND is a point-in-time observation, not proof that a request cannot commit later. */
export async function facilityServiceImportStatus(
  facility: FacilityServiceScope,
  keyInput: unknown,
  expected?: { rows: unknown; approvalReference: unknown },
) {
  const key = validKey(keyInput);
  let expectedHash: string | null = null;
  if (expected) {
    const parsed = normalize(facility, expected.rows, false);
    if (parsed.issues.length)
      throw new FacilityServiceImportError(
        'INVALID_BATCH',
        'The original request is invalid.',
        400,
        parsed.issues,
      );
    expectedHash = requestHash(
      parsed.rows.map(({ value }) => value),
      validApproval(expected.approvalReference),
    );
  }
  const [batch] = await db
    .select()
    .from(schema.facilityTariffImportBatches)
    .where(
      and(
        eq(schema.facilityTariffImportBatches.tenantId, facility.tenantId),
        eq(schema.facilityTariffImportBatches.facilityId, facility.id),
        eq(schema.facilityTariffImportBatches.idempotencyKey, key),
      ),
    )
    .limit(1);
  if (!batch) return { status: 'NOT_FOUND' as const };
  const services = createdResult(batch.result);
  if (
    !services ||
    services.length !== batch.rowCount ||
    (expectedHash !== null && expectedHash !== batch.requestHash)
  )
    return { status: 'KEY_IN_USE' as const };
  return {
    status: 'RECORDED' as const,
    batchId: batch.id,
    rowCount: batch.rowCount,
    services,
    requestMatched: expectedHash !== null,
  };
}
