/**
 * Fixed-asset maintenance, inspections, lifecycle events and supporting
 * documents.
 *
 * HISTORY IS APPEND-ONLY
 * ----------------------
 * Nothing here deletes a maintenance job, an inspection, a document or a
 * lifecycle event. A schedule can be retired (`is_active = false`) and a
 * planned inspection can be completed, but the record of what happened to an
 * asset survives every later transfer, repair and status change — that is the
 * evidence an auditor or a biomedical engineer needs.
 */

import { createHash } from 'node:crypto';

import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';

import * as schema from '../db/schema.ts';
import { db } from '../db/index.ts';
import {
  audit,
  centsAsKes,
  completeMaintenanceInTx,
  createMaintenance,
  fail,
  findAsset,
  isoDate,
  money,
  optionalText,
  positiveId,
  requiredText,
  withTx,
  type AssetScope,
  type Tx,
} from './fixed-assets.service.ts';
import { addPeriods, daysInPeriod } from './depreciation.ts';

const FREQUENCIES = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'HALF_YEARLY',
  'ANNUAL',
  'CUSTOM',
] as const;
type Frequency = (typeof FREQUENCIES)[number];

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const ASSET_STATUSES = [
  'REGISTERED',
  'ACTIVE',
  'UNDER_MAINTENANCE',
  'TEMPORARILY_UNAVAILABLE',
  'IMPAIRED',
  'RETIRED',
  'DISPOSED',
] as const;
type AssetStatus = (typeof ASSET_STATUSES)[number];

const EVENT_TYPES = [
  'REGISTERED',
  'REGISTRATION',
  'ACTIVATED',
  'ACTIVATION',
  'TRANSFER',
  'CUSTODIAN_CHANGE',
  'LOCATION_CHANGE',
  'STATUS_CHANGE',
  'MAINTENANCE_START',
  'MAINTENANCE_COMPLETE',
  'INSPECTION',
  'IMPAIRMENT',
  'REVALUATION',
  'RETIREMENT',
  'DISPOSAL',
  'WRITE_OFF',
  'DEPRECIATION_REVERSAL',
] as const;
type EventType = (typeof EVENT_TYPES)[number];

const DOCUMENT_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Add calendar months to an ISO date, clamping to the last day of the month. */
export function addMonthsToDate(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const zeroBased = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = (zeroBased % 12) + 1;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/** The next due date implied by a frequency, counted from the completion date. */
export function nextDueDateFor(
  frequency: Frequency,
  fromDate: string,
  intervalDays?: number | null,
): string {
  switch (frequency) {
    case 'DAILY':
      return addMonthsToDate(fromDate, 0) === fromDate
        ? new Date(Date.parse(`${fromDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
        : fromDate;
    case 'WEEKLY':
      return new Date(Date.parse(`${fromDate}T00:00:00Z`) + 7 * 86_400_000)
        .toISOString()
        .slice(0, 10);
    case 'MONTHLY':
      return addMonthsToDate(fromDate, 1);
    case 'QUARTERLY':
      return addMonthsToDate(fromDate, 3);
    case 'HALF_YEARLY':
      return addMonthsToDate(fromDate, 6);
    case 'ANNUAL':
      return addMonthsToDate(fromDate, 12);
    case 'CUSTOM': {
      if (
        !intervalDays ||
        !Number.isInteger(intervalDays) ||
        intervalDays < 1 ||
        intervalDays > 3650
      )
        fail(400, 'INVALID_INTERVAL', 'A custom schedule needs an interval of 1–3650 days.');
      return new Date(Date.parse(`${fromDate}T00:00:00Z`) + intervalDays * 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
    default:
      return fail(400, 'INVALID_FREQUENCY', 'Unsupported maintenance frequency.');
  }
}

/* ============================================================
   PREVENTIVE MAINTENANCE SCHEDULES
   ============================================================ */

export type ScheduleFilter = { assetId?: number; includeInactive?: boolean; dueOnly?: boolean };

export async function listMaintenanceSchedules(scope: AssetScope, filter: ScheduleFilter = {}) {
  const conditions = [
    eq(schema.fixedAssetMaintenanceSchedules.tenantId, scope.tenantId),
    eq(schema.fixedAssetMaintenanceSchedules.facilityId, scope.facilityId),
  ];
  if (filter.assetId)
    conditions.push(eq(schema.fixedAssetMaintenanceSchedules.assetId, filter.assetId));
  if (!filter.includeInactive)
    conditions.push(eq(schema.fixedAssetMaintenanceSchedules.isActive, true));
  if (filter.dueOnly)
    conditions.push(lte(schema.fixedAssetMaintenanceSchedules.nextDueDate, today()));

  const rows = await db
    .select({
      id: schema.fixedAssetMaintenanceSchedules.id,
      assetId: schema.fixedAssetMaintenanceSchedules.assetId,
      assetCode: schema.fixedAssets.assetCode,
      assetName: schema.fixedAssets.assetName,
      name: schema.fixedAssetMaintenanceSchedules.name,
      frequency: schema.fixedAssetMaintenanceSchedules.frequency,
      intervalDays: schema.fixedAssetMaintenanceSchedules.intervalDays,
      nextDueDate: schema.fixedAssetMaintenanceSchedules.nextDueDate,
      lastCompletedDate: schema.fixedAssetMaintenanceSchedules.lastCompletedDate,
      instructions: schema.fixedAssetMaintenanceSchedules.instructions,
      responsibleDepartmentId: schema.fixedAssetMaintenanceSchedules.responsibleDepartmentId,
      departmentName: schema.departments.name,
      assignedTechnician: schema.fixedAssetMaintenanceSchedules.assignedTechnician,
      vendor: schema.fixedAssetMaintenanceSchedules.vendor,
      estimatedCostCents: schema.fixedAssetMaintenanceSchedules.estimatedCostCents,
      isActive: schema.fixedAssetMaintenanceSchedules.isActive,
    })
    .from(schema.fixedAssetMaintenanceSchedules)
    .innerJoin(
      schema.fixedAssets,
      eq(schema.fixedAssets.id, schema.fixedAssetMaintenanceSchedules.assetId),
    )
    .leftJoin(
      schema.departments,
      eq(schema.departments.id, schema.fixedAssetMaintenanceSchedules.responsibleDepartmentId),
    )
    .where(and(...conditions))
    .orderBy(asc(schema.fixedAssetMaintenanceSchedules.nextDueDate))
    .limit(500);

  /* The status is derived on read so it cannot go stale overnight. */
  const now = today();
  return rows.map((row) => ({
    ...row,
    status: !row.isActive
      ? 'INACTIVE'
      : row.nextDueDate < now
        ? 'OVERDUE'
        : row.nextDueDate === now
          ? 'DUE'
          : 'SCHEDULED',
    daysUntilDue: Math.round(
      (Date.parse(`${row.nextDueDate}T00:00:00Z`) - Date.parse(`${now}T00:00:00Z`)) / 86_400_000,
    ),
  }));
}

export async function createMaintenanceSchedule(scope: AssetScope, input: Record<string, unknown>) {
  const assetId = positiveId(input.assetId, 'Asset');
  const name = requiredText(input.name, 'Schedule name', 160);
  const frequency = String(input.frequency ?? '').toUpperCase();
  if (!FREQUENCIES.includes(frequency as Frequency))
    fail(
      400,
      'INVALID_FREQUENCY',
      'Frequency must be DAILY, WEEKLY, MONTHLY, QUARTERLY, HALF_YEARLY, ANNUAL or CUSTOM.',
    );
  const intervalDays = input.intervalDays ? Number(input.intervalDays) : null;
  if (frequency === 'CUSTOM' && (!intervalDays || intervalDays < 1 || intervalDays > 3650))
    fail(400, 'INVALID_INTERVAL', 'A custom schedule needs an interval of 1–3650 days.');
  const nextDue = isoDate(input.nextDueDate, 'Next due date');
  const estimatedCostCents =
    input.estimatedCostKes === undefined ? 0n : money(input.estimatedCostKes, 'Estimated cost');
  const departmentId = input.responsibleDepartmentId
    ? positiveId(input.responsibleDepartmentId, 'Responsible department')
    : null;

  return withTx(async (tx) => {
    const asset = await findAsset(tx, scope, assetId);
    if (['DISPOSED', 'RETIRED'].includes(asset.status))
      fail(
        409,
        'ASSET_INACTIVE',
        'A disposed or retired asset cannot be put on a maintenance schedule.',
      );
    await assertDepartment(tx, scope, departmentId);
    const [created] = await tx
      .insert(schema.fixedAssetMaintenanceSchedules)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        assetId,
        name,
        frequency,
        intervalDays: intervalDays ?? undefined,
        nextDueDate: nextDue,
        instructions: optionalText(input.instructions, 'Instructions', 2000) ?? undefined,
        responsibleDepartmentId: departmentId ?? undefined,
        assignedTechnician: optionalText(input.assignedTechnician, 'Technician', 160) ?? undefined,
        vendor: optionalText(input.vendor, 'Vendor', 160) ?? undefined,
        estimatedCostCents: estimatedCostCents.toString(),
        createdByUserId: scope.actorId,
      })
      .returning();
    await audit(
      tx,
      scope,
      'fixed_asset_maintenance_schedules',
      created.id,
      'CREATE',
      `Scheduled ${frequency} preventive maintenance for ${asset.assetCode}, first due ${nextDue}.`,
    );
    return created;
  });
}

export async function updateMaintenanceSchedule(
  scope: AssetScope,
  id: number,
  input: Record<string, unknown>,
) {
  return withTx(async (tx) => {
    const schedule = await findSchedule(tx, scope, id, true);
    const frequency = input.frequency ? String(input.frequency).toUpperCase() : schedule.frequency;
    if (!FREQUENCIES.includes(frequency as Frequency))
      fail(400, 'INVALID_FREQUENCY', 'Unsupported maintenance frequency.');
    const departmentId = input.responsibleDepartmentId
      ? positiveId(input.responsibleDepartmentId, 'Responsible department')
      : (schedule.responsibleDepartmentId ?? null);
    await assertDepartment(tx, scope, departmentId);
    const intervalDays = input.intervalDays ? Number(input.intervalDays) : schedule.intervalDays;
    if (frequency === 'CUSTOM' && (!intervalDays || intervalDays < 1))
      fail(400, 'INVALID_INTERVAL', 'A custom schedule needs an interval of 1–3650 days.');

    const [updated] = await tx
      .update(schema.fixedAssetMaintenanceSchedules)
      .set({
        name: input.name ? requiredText(input.name, 'Schedule name', 160) : schedule.name,
        frequency,
        intervalDays: intervalDays ?? null,
        nextDueDate: input.nextDueDate
          ? isoDate(input.nextDueDate, 'Next due date')
          : schedule.nextDueDate,
        instructions:
          optionalText(input.instructions, 'Instructions', 2000) ?? schedule.instructions,
        responsibleDepartmentId: departmentId,
        assignedTechnician:
          optionalText(input.assignedTechnician, 'Technician', 160) ?? schedule.assignedTechnician,
        vendor: optionalText(input.vendor, 'Vendor', 160) ?? schedule.vendor,
        estimatedCostCents:
          input.estimatedCostKes === undefined
            ? schedule.estimatedCostCents
            : money(input.estimatedCostKes, 'Estimated cost').toString(),
        isActive: input.isActive === undefined ? schedule.isActive : Boolean(input.isActive),
        updatedAt: new Date(),
      })
      .where(eq(schema.fixedAssetMaintenanceSchedules.id, id))
      .returning();
    await audit(
      tx,
      scope,
      'fixed_asset_maintenance_schedules',
      id,
      'UPDATE',
      `Updated schedule; active=${updated.isActive}, next due ${updated.nextDueDate}.`,
    );
    return updated;
  });
}

/** Retiring a schedule keeps every job it ever generated. */
export async function retireMaintenanceSchedule(
  scope: AssetScope,
  id: number,
  input: Record<string, unknown> = {},
) {
  return withTx(async (tx) => {
    const schedule = await findSchedule(tx, scope, id, true);
    if (!schedule.isActive) fail(409, 'SCHEDULE_INACTIVE', 'This schedule is already inactive.');
    const [updated] = await tx
      .update(schema.fixedAssetMaintenanceSchedules)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(schema.fixedAssetMaintenanceSchedules.id, id))
      .returning();
    await audit(
      tx,
      scope,
      'fixed_asset_maintenance_schedules',
      id,
      'RETIRE',
      typeof input.reason === 'string' && input.reason.trim()
        ? `Retired schedule: ${input.reason.trim().slice(0, 500)}`
        : 'Retired schedule.',
    );
    return updated;
  });
}

/**
 * Record the completion of a scheduled service: the job, the cost journal and
 * the next due date move together, so the schedule can never "forget" a service
 * that was paid for.
 */
export async function completeScheduledMaintenance(
  scope: AssetScope,
  scheduleId: number,
  input: Record<string, unknown>,
) {
  const completedDate = isoDate(input.completedDate ?? today(), 'Completion date');
  const costCents = input.costKes === undefined ? 0n : money(input.costKes, 'Maintenance cost');
  const expenseAccountId = input.expenseAccountId
    ? positiveId(input.expenseAccountId, 'Expense account')
    : null;
  const creditAccountId = input.creditAccountId
    ? positiveId(input.creditAccountId, 'Payment/credit account')
    : null;
  if (costCents > 0n && (!expenseAccountId || !creditAccountId))
    fail(
      400,
      'ACCOUNTS_REQUIRED',
      'A costed maintenance job needs an expense account and a payment/credit account.',
    );

  const schedule = await withTx(async (tx) => findSchedule(tx, scope, scheduleId, true));
  if (!schedule.isActive) fail(409, 'SCHEDULE_INACTIVE', 'This schedule is inactive.');
  if (schedule.lastCompletedDate && completedDate < schedule.lastCompletedDate)
    fail(
      400,
      'DATE_BEFORE_LAST',
      'The completion date cannot be before the last recorded completion.',
    );

  const created = await createMaintenance(scope, {
    assetId: schedule.assetId,
    maintenanceDate: completedDate,
    maintenanceType: 'PREVENTIVE',
    description: requiredText(
      input.description ?? `${schedule.name} — scheduled preventive maintenance`,
      'Description',
      500,
    ),
    costKes: input.costKes ?? '0',
    expenseAccountId: expenseAccountId ?? undefined,
    creditAccountId: creditAccountId ?? undefined,
    vendor: input.vendor ?? schedule.vendor ?? undefined,
  });

  const updated = await withTx(async (tx, client) => {
    await tx
      .update(schema.fixedAssetMaintenance)
      .set({
        scheduleId: schedule.id,
        assignedTechnician:
          optionalText(input.technician, 'Technician', 160) ?? schedule.assignedTechnician,
        repairActions: optionalText(input.actionsTaken, 'Actions taken', 2000) ?? undefined,
        partsUsed: optionalText(input.partsUsed, 'Parts used', 1000) ?? undefined,
        downtimeHours:
          input.downtimeHours === undefined || input.downtimeHours === null
            ? undefined
            : String(Number(input.downtimeHours)),
      })
      .where(eq(schema.fixedAssetMaintenance.id, created.id));
    const job = await findJob(tx, scope, created.id, true);
    const completed = await completeMaintenanceInTx(
      tx,
      client,
      scope,
      job,
      { creditAccountId: creditAccountId ?? undefined },
      completedDate,
    );
    const nextDue = nextDueDateFor(
      schedule.frequency as Frequency,
      completedDate,
      schedule.intervalDays,
    );
    await tx
      .update(schema.fixedAssetMaintenanceSchedules)
      .set({ lastCompletedDate: completedDate, nextDueDate: nextDue, updatedAt: new Date() })
      .where(eq(schema.fixedAssetMaintenanceSchedules.id, schedule.id));
    await recordEventInTx(tx, scope, {
      assetId: schedule.assetId,
      eventType: 'MAINTENANCE_COMPLETE',
      effectiveDate: completedDate,
      reason: `${schedule.name} completed on schedule`,
      details: `Next service due ${nextDue}.`,
    });
    return { ...completed, nextDueDate: nextDue, scheduleId: schedule.id };
  });
  return updated;
}

/* ============================================================
   CORRECTIVE MAINTENANCE
   ============================================================ */

export async function createCorrectiveMaintenance(
  scope: AssetScope,
  input: Record<string, unknown>,
) {
  const assetId = positiveId(input.assetId, 'Asset');
  const reportedDate = isoDate(input.reportedDate ?? today(), 'Reported date');
  const priority = String(input.priority ?? 'MEDIUM').toUpperCase();
  if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number]))
    fail(400, 'INVALID_PRIORITY', 'Priority must be LOW, MEDIUM, HIGH or CRITICAL.');
  const problemDescription = requiredText(input.problemDescription, 'Fault description', 2000);

  const job = await createMaintenance(scope, {
    assetId,
    maintenanceDate: reportedDate,
    maintenanceType: 'CORRECTIVE',
    description: requiredText(
      input.description ?? problemDescription.slice(0, 200),
      'Description',
      500,
    ),
    vendor: input.vendor,
    costKes: '0',
  });

  return withTx(async (tx) => {
    const [updated] = await tx
      .update(schema.fixedAssetMaintenance)
      .set({
        priority,
        reportedDate,
        problemDescription,
        assignedTechnician: optionalText(input.assignedTechnician, 'Technician', 160) ?? undefined,
      })
      .where(eq(schema.fixedAssetMaintenance.id, job.id))
      .returning();
    await audit(
      tx,
      scope,
      'fixed_asset_maintenance',
      job.id,
      'REPORT_FAULT',
      `Corrective job opened at ${priority} priority: ${problemDescription.slice(0, 300)}`,
    );
    return updated;
  });
}

/** Close a corrective job with the work done, the parts used and the cost. */
export async function completeCorrectiveMaintenance(
  scope: AssetScope,
  id: number,
  input: Record<string, unknown>,
) {
  const completedDate = isoDate(input.completedDate ?? today(), 'Completion date');
  const repairActions = requiredText(input.repairActions, 'Repair actions', 4000);
  const costCents = input.costKes === undefined ? 0n : money(input.costKes, 'Repair cost');
  const expenseAccountId = input.expenseAccountId
    ? positiveId(input.expenseAccountId, 'Expense account')
    : null;
  const creditAccountId = input.creditAccountId
    ? positiveId(input.creditAccountId, 'Payment/credit account')
    : null;
  if (costCents > 0n && (!expenseAccountId || !creditAccountId))
    fail(
      400,
      'ACCOUNTS_REQUIRED',
      'A costed repair needs an expense account and a payment/credit account.',
    );

  return withTx(async (tx, client) => {
    const job = await findJob(tx, scope, id, true);
    if (job.status !== 'PLANNED')
      fail(409, 'INVALID_STATUS', 'Only an open maintenance job can be completed.');
    await tx
      .update(schema.fixedAssetMaintenance)
      .set({
        costKes: centsAsKes(costCents),
        expenseAccountId: expenseAccountId ?? job.expenseAccountId,
        repairActions,
        partsUsed: optionalText(input.partsUsed, 'Parts used', 1000) ?? job.partsUsed,
        downtimeHours:
          input.downtimeHours === undefined || input.downtimeHours === null
            ? job.downtimeHours
            : String(Number(input.downtimeHours)),
        assignedTechnician:
          optionalText(input.assignedTechnician, 'Technician', 160) ?? job.assignedTechnician,
      })
      .where(eq(schema.fixedAssetMaintenance.id, id));
    const refreshed = await findJob(tx, scope, id, true);
    const completed = await completeMaintenanceInTx(
      tx,
      client,
      scope,
      refreshed,
      { creditAccountId: creditAccountId ?? undefined },
      completedDate,
    );
    await recordEventInTx(tx, scope, {
      assetId: job.assetId,
      eventType: 'MAINTENANCE_COMPLETE',
      effectiveDate: completedDate,
      reason: `Corrective repair completed: ${repairActions.slice(0, 300)}`,
      details: `Cost ${centsAsKes(costCents)} KES.`,
    });
    return completed;
  });
}

/** Verification is a separate act from the technician's own sign-off. */
export async function verifyMaintenance(
  scope: AssetScope,
  id: number,
  input: Record<string, unknown>,
) {
  return withTx(async (tx) => {
    const job = await findJob(tx, scope, id, true);
    if (job.status !== 'COMPLETED')
      fail(409, 'INVALID_STATUS', 'Only a completed job can be verified.');
    if (job.verifiedAt) fail(409, 'ALREADY_VERIFIED', 'This job has already been verified.');
    const [verified] = await tx
      .update(schema.fixedAssetMaintenance)
      .set({
        verifiedAt: new Date(),
        verifiedByUserId: scope.actorId,
        verificationNotes: requiredText(input.verificationNotes, 'Verification notes', 2000),
      })
      .where(eq(schema.fixedAssetMaintenance.id, id))
      .returning();
    await audit(
      tx,
      scope,
      'fixed_asset_maintenance',
      id,
      'VERIFY',
      'Maintenance completion verified by a second officer.',
    );
    return verified;
  });
}

export async function listMaintenanceJobs(
  scope: AssetScope,
  filter: { assetId?: number; type?: string; status?: string } = {},
) {
  const conditions = [
    eq(schema.fixedAssetMaintenance.tenantId, scope.tenantId),
    eq(schema.fixedAssetMaintenance.facilityId, scope.facilityId),
  ];
  if (filter.assetId) conditions.push(eq(schema.fixedAssetMaintenance.assetId, filter.assetId));
  if (filter.type) conditions.push(eq(schema.fixedAssetMaintenance.maintenanceType, filter.type));
  if (filter.status) conditions.push(eq(schema.fixedAssetMaintenance.status, filter.status));

  return db
    .select({
      id: schema.fixedAssetMaintenance.id,
      assetId: schema.fixedAssetMaintenance.assetId,
      assetCode: schema.fixedAssets.assetCode,
      assetName: schema.fixedAssets.assetName,
      scheduleId: schema.fixedAssetMaintenance.scheduleId,
      maintenanceDate: schema.fixedAssetMaintenance.maintenanceDate,
      reportedDate: schema.fixedAssetMaintenance.reportedDate,
      maintenanceType: schema.fixedAssetMaintenance.maintenanceType,
      priority: schema.fixedAssetMaintenance.priority,
      description: schema.fixedAssetMaintenance.description,
      problemDescription: schema.fixedAssetMaintenance.problemDescription,
      assignedTechnician: schema.fixedAssetMaintenance.assignedTechnician,
      vendor: schema.fixedAssetMaintenance.vendor,
      repairActions: schema.fixedAssetMaintenance.repairActions,
      partsUsed: schema.fixedAssetMaintenance.partsUsed,
      downtimeHours: schema.fixedAssetMaintenance.downtimeHours,
      costKes: schema.fixedAssetMaintenance.costKes,
      status: schema.fixedAssetMaintenance.status,
      completedDate: schema.fixedAssetMaintenance.completedDate,
      journalEntryId: schema.fixedAssetMaintenance.journalEntryId,
      verifiedAt: schema.fixedAssetMaintenance.verifiedAt,
      verificationNotes: schema.fixedAssetMaintenance.verificationNotes,
    })
    .from(schema.fixedAssetMaintenance)
    .innerJoin(schema.fixedAssets, eq(schema.fixedAssets.id, schema.fixedAssetMaintenance.assetId))
    .where(and(...conditions))
    .orderBy(
      desc(schema.fixedAssetMaintenance.maintenanceDate),
      desc(schema.fixedAssetMaintenance.id),
    )
    .limit(500);
}

/* ============================================================
   INSPECTIONS
   ============================================================ */

type ChecklistItem = { item: string; result: string; notes?: string | null };

function parseChecklist(value: unknown): ChecklistItem[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) fail(400, 'INVALID_CHECKLIST', 'The checklist must be a list.');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object')
      fail(400, 'INVALID_CHECKLIST', `Checklist item ${index + 1} is invalid.`);
    const record = entry as Record<string, unknown>;
    return {
      item: requiredText(record.item, `Checklist item ${index + 1}`, 200),
      result: requiredText(record.result, `Checklist result ${index + 1}`, 120),
      notes: optionalText(record.notes, `Checklist note ${index + 1}`, 500),
    };
  });
}

export async function listInspections(
  scope: AssetScope,
  filter: { assetId?: number; status?: string; from?: string; to?: string } = {},
) {
  const conditions = [
    eq(schema.fixedAssetInspections.tenantId, scope.tenantId),
    eq(schema.fixedAssetInspections.facilityId, scope.facilityId),
  ];
  if (filter.assetId) conditions.push(eq(schema.fixedAssetInspections.assetId, filter.assetId));
  if (filter.status) conditions.push(eq(schema.fixedAssetInspections.status, filter.status));
  if (filter.from) conditions.push(gte(schema.fixedAssetInspections.inspectionDate, filter.from));
  if (filter.to) conditions.push(lte(schema.fixedAssetInspections.inspectionDate, filter.to));
  return db
    .select({
      id: schema.fixedAssetInspections.id,
      assetId: schema.fixedAssetInspections.assetId,
      assetCode: schema.fixedAssets.assetCode,
      assetName: schema.fixedAssets.assetName,
      inspectionDate: schema.fixedAssetInspections.inspectionDate,
      inspectorName: schema.fixedAssetInspections.inspectorName,
      conditionAssessment: schema.fixedAssetInspections.conditionAssessment,
      findings: schema.fixedAssetInspections.findings,
      recommendations: schema.fixedAssetInspections.recommendations,
      followUpActions: schema.fixedAssetInspections.followUpActions,
      nextInspectionDate: schema.fixedAssetInspections.nextInspectionDate,
      status: schema.fixedAssetInspections.status,
      checklist: schema.fixedAssetInspections.checklist,
      attachmentReference: schema.fixedAssetInspections.attachmentReference,
      completedAt: schema.fixedAssetInspections.completedAt,
    })
    .from(schema.fixedAssetInspections)
    .innerJoin(schema.fixedAssets, eq(schema.fixedAssets.id, schema.fixedAssetInspections.assetId))
    .where(and(...conditions))
    .orderBy(
      desc(schema.fixedAssetInspections.inspectionDate),
      desc(schema.fixedAssetInspections.id),
    )
    .limit(500);
}

export async function createInspection(scope: AssetScope, input: Record<string, unknown>) {
  const assetId = positiveId(input.assetId, 'Asset');
  const inspectionDate = isoDate(input.inspectionDate ?? today(), 'Inspection date');
  const status = String(input.status ?? 'COMPLETED').toUpperCase();
  if (!['PLANNED', 'COMPLETED'].includes(status))
    fail(400, 'INVALID_STATUS', 'An inspection is either PLANNED or COMPLETED.');
  const checklist = parseChecklist(input.checklist);
  const conditionAssessment = optionalText(input.conditionAssessment, 'Condition', 40);
  if (
    conditionAssessment &&
    !['GOOD', 'FAIR', 'POOR', 'UNDER_REPAIR'].includes(conditionAssessment)
  )
    fail(400, 'INVALID_CONDITION', 'Condition must be GOOD, FAIR, POOR or UNDER_REPAIR.');
  const nextInspectionDate = input.nextInspectionDate
    ? isoDate(input.nextInspectionDate, 'Next inspection date')
    : null;

  return withTx(async (tx) => {
    const asset = await findAsset(tx, scope, assetId);
    if (['DISPOSED', 'RETIRED'].includes(asset.status))
      fail(409, 'ASSET_INACTIVE', 'A disposed or retired asset cannot be inspected.');
    const [created] = await tx
      .insert(schema.fixedAssetInspections)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        assetId,
        inspectionDate,
        inspectorName: optionalText(input.inspectorName, 'Inspector', 160) ?? undefined,
        conditionAssessment: conditionAssessment ?? undefined,
        findings: optionalText(input.findings, 'Findings', 4000) ?? undefined,
        recommendations: optionalText(input.recommendations, 'Recommendations', 4000) ?? undefined,
        followUpActions: optionalText(input.followUpActions, 'Follow-up', 2000) ?? undefined,
        nextInspectionDate: nextInspectionDate ?? undefined,
        checklist: checklist ?? undefined,
        attachmentReference:
          optionalText(input.attachmentReference, 'Attachment reference', 200) ?? undefined,
        status,
        completedAt: status === 'COMPLETED' ? new Date() : null,
        recordedByUserId: scope.actorId,
      })
      .returning();
    await audit(
      tx,
      scope,
      'fixed_asset_inspections',
      created.id,
      status === 'COMPLETED' ? 'RECORD' : 'SCHEDULE',
      `${status === 'COMPLETED' ? 'Recorded' : 'Scheduled'} inspection of ${asset.assetCode} on ${inspectionDate}.`,
    );
    return created;
  });
}

export async function completeInspection(
  scope: AssetScope,
  id: number,
  input: Record<string, unknown>,
) {
  return withTx(async (tx) => {
    const [inspection] = await tx
      .select()
      .from(schema.fixedAssetInspections)
      .where(
        and(
          eq(schema.fixedAssetInspections.id, id),
          eq(schema.fixedAssetInspections.tenantId, scope.tenantId),
          eq(schema.fixedAssetInspections.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!inspection) fail(404, 'INSPECTION_NOT_FOUND', 'Inspection not found in this facility.');
    if (inspection.status !== 'PLANNED')
      fail(409, 'INVALID_STATUS', 'Only a planned inspection can be completed.');
    const condition = String(input.conditionAssessment ?? '');
    if (!['GOOD', 'FAIR', 'POOR', 'UNDER_REPAIR'].includes(condition))
      fail(
        400,
        'INVALID_CONDITION',
        'Record the condition found: GOOD, FAIR, POOR or UNDER_REPAIR.',
      );
    const [completed] = await tx
      .update(schema.fixedAssetInspections)
      .set({
        status: 'COMPLETED',
        completedAt: new Date(),
        inspectorName:
          optionalText(input.inspectorName, 'Inspector', 160) ?? inspection.inspectorName,
        conditionAssessment: condition,
        findings: requiredText(input.findings, 'Findings', 4000),
        recommendations:
          optionalText(input.recommendations, 'Recommendations', 4000) ??
          inspection.recommendations,
        followUpActions:
          optionalText(input.followUpActions, 'Follow-up', 2000) ?? inspection.followUpActions,
        nextInspectionDate: input.nextInspectionDate
          ? isoDate(input.nextInspectionDate, 'Next inspection date')
          : inspection.nextInspectionDate,
        checklist: parseChecklist(input.checklist) ?? inspection.checklist,
        updatedAt: new Date(),
      })
      .where(eq(schema.fixedAssetInspections.id, id))
      .returning();
    await audit(
      tx,
      scope,
      'fixed_asset_inspections',
      id,
      'COMPLETE',
      `Inspection completed with condition ${condition}.`,
    );
    return completed;
  });
}

/* ============================================================
   LIFECYCLE
   ============================================================ */

/**
 * Allowed state moves. DISPOSED is deliberately unreachable here: disposal
 * posts the journal that removes cost and accumulated depreciation, so it must
 * go through the disposal workflow rather than a status edit that would leave
 * the ledger disagreeing with the register.
 */
const TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  REGISTERED: ['ACTIVE', 'UNDER_MAINTENANCE', 'TEMPORARILY_UNAVAILABLE', 'RETIRED'],
  ACTIVE: ['UNDER_MAINTENANCE', 'TEMPORARILY_UNAVAILABLE', 'IMPAIRED', 'RETIRED'],
  UNDER_MAINTENANCE: ['ACTIVE', 'TEMPORARILY_UNAVAILABLE', 'IMPAIRED', 'RETIRED'],
  TEMPORARILY_UNAVAILABLE: ['ACTIVE', 'UNDER_MAINTENANCE', 'IMPAIRED', 'RETIRED'],
  IMPAIRED: ['ACTIVE', 'TEMPORARILY_UNAVAILABLE', 'RETIRED'],
  RETIRED: [],
  DISPOSED: [],
};

export async function listLifecycleEvents(
  scope: AssetScope,
  filter: { assetId?: number; eventType?: string; limit?: number } = {},
) {
  const conditions = [
    eq(schema.fixedAssetLifecycleEvents.tenantId, scope.tenantId),
    eq(schema.fixedAssetLifecycleEvents.facilityId, scope.facilityId),
  ];
  if (filter.assetId) conditions.push(eq(schema.fixedAssetLifecycleEvents.assetId, filter.assetId));
  if (filter.eventType)
    conditions.push(eq(schema.fixedAssetLifecycleEvents.eventType, filter.eventType));
  return db
    .select({
      id: schema.fixedAssetLifecycleEvents.id,
      assetId: schema.fixedAssetLifecycleEvents.assetId,
      assetCode: schema.fixedAssets.assetCode,
      assetName: schema.fixedAssets.assetName,
      eventType: schema.fixedAssetLifecycleEvents.eventType,
      effectiveDate: schema.fixedAssetLifecycleEvents.effectiveDate,
      fromStatus: schema.fixedAssetLifecycleEvents.fromStatus,
      toStatus: schema.fixedAssetLifecycleEvents.toStatus,
      reason: schema.fixedAssetLifecycleEvents.reason,
      details: schema.fixedAssetLifecycleEvents.details,
      journalEntryId: schema.fixedAssetLifecycleEvents.journalEntryId,
      recordedByUserId: schema.fixedAssetLifecycleEvents.recordedByUserId,
      createdAt: schema.fixedAssetLifecycleEvents.createdAt,
    })
    .from(schema.fixedAssetLifecycleEvents)
    .innerJoin(
      schema.fixedAssets,
      eq(schema.fixedAssets.id, schema.fixedAssetLifecycleEvents.assetId),
    )
    .where(and(...conditions))
    .orderBy(
      desc(schema.fixedAssetLifecycleEvents.effectiveDate),
      desc(schema.fixedAssetLifecycleEvents.id),
    )
    .limit(Math.min(500, Math.max(1, filter.limit ?? 200)));
}

async function recordEventInTx(
  tx: Tx,
  scope: AssetScope,
  input: {
    assetId: number;
    eventType: EventType;
    effectiveDate: string;
    reason: string;
    details?: string | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    journalEntryId?: number | null;
  },
) {
  const [event] = await tx
    .insert(schema.fixedAssetLifecycleEvents)
    .values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      assetId: input.assetId,
      eventType: input.eventType,
      effectiveDate: input.effectiveDate,
      fromStatus: input.fromStatus ?? undefined,
      toStatus: input.toStatus ?? undefined,
      reason: input.reason.slice(0, 2000),
      details: input.details ?? undefined,
      journalEntryId: input.journalEntryId ?? undefined,
      recordedByUserId: scope.actorId,
      approvedByUserId: scope.actorId,
    })
    .returning();
  return event;
}

/**
 * Move an asset between the documented states. The reason and effective date
 * are mandatory: "why is this asset not in service, and from when" is exactly
 * the question an asset register exists to answer.
 */
export async function changeAssetStatus(
  scope: AssetScope,
  id: number,
  input: Record<string, unknown>,
) {
  const toStatus = String(input.status ?? '').toUpperCase();
  if (!ASSET_STATUSES.includes(toStatus as AssetStatus))
    fail(400, 'INVALID_STATUS', 'Unknown asset status.');
  const effectiveDate = isoDate(input.effectiveDate ?? today(), 'Effective date');
  const reason = requiredText(input.reason, 'Reason', 500);

  return withTx(async (tx) => {
    const asset = await findAsset(tx, scope, id, true);
    const fromStatus = asset.status as AssetStatus;
    if (fromStatus === toStatus)
      fail(409, 'NO_STATUS_CHANGE', `The asset is already ${toStatus.toLowerCase()}.`);
    if (toStatus === 'DISPOSED')
      fail(
        409,
        'USE_DISPOSAL_WORKFLOW',
        'Disposal must be recorded through the disposal workflow so its journal is posted.',
      );
    if (!TRANSITIONS[fromStatus]?.includes(toStatus as AssetStatus))
      fail(
        409,
        'INVALID_TRANSITION',
        `${fromStatus} cannot move directly to ${toStatus}. Use retirement or disposal for end-of-life assets.`,
      );
    const [updated] = await tx
      .update(schema.fixedAssets)
      .set({
        status: toStatus,
        condition: toStatus === 'UNDER_MAINTENANCE' ? 'UNDER_REPAIR' : asset.condition,
        retiredAt: toStatus === 'RETIRED' ? new Date() : asset.retiredAt,
        retirementReason: toStatus === 'RETIRED' ? reason : asset.retirementReason,
        updatedAt: new Date(),
      })
      .where(eq(schema.fixedAssets.id, id))
      .returning();
    const event = await recordEventInTx(tx, scope, {
      assetId: id,
      eventType: toStatus === 'RETIRED' ? 'RETIREMENT' : 'STATUS_CHANGE',
      effectiveDate,
      reason,
      fromStatus,
      toStatus,
    });
    await audit(
      tx,
      scope,
      'fixed_assets',
      id,
      'STATUS_CHANGE',
      `${fromStatus} → ${toStatus}: ${reason}`,
    );
    return { asset: updated, event };
  });
}

/* ============================================================
   DOCUMENTS
   ============================================================ */

export async function uploadAssetDocument(scope: AssetScope, input: Record<string, unknown>) {
  const assetId = positiveId(input.assetId, 'Asset');
  const title = requiredText(input.title, 'Document title', 200);
  const filename = requiredText(input.filename, 'Filename', 200);
  const mimeType = String(input.mimeType ?? '').toLowerCase();
  if (!DOCUMENT_MIME.includes(mimeType as (typeof DOCUMENT_MIME)[number]))
    fail(400, 'INVALID_MIME', 'Documents must be PDF, PNG, JPEG or WebP.');
  if (typeof input.contentBase64 !== 'string' || !input.contentBase64.trim())
    fail(400, 'CONTENT_REQUIRED', 'The document content is required.');
  let content: Buffer;
  try {
    content = Buffer.from(input.contentBase64, 'base64');
  } catch {
    return fail(400, 'INVALID_CONTENT', 'The document content is not valid base64.');
  }
  if (!content.length) fail(400, 'INVALID_CONTENT', 'The document is empty.');
  if (content.length > MAX_DOCUMENT_BYTES)
    fail(413, 'DOCUMENT_TOO_LARGE', 'A document may be at most 8 MB.');
  const sha256 = createHash('sha256').update(content).digest('hex');

  return withTx(async (tx) => {
    const asset = await findAsset(tx, scope, assetId);
    if (asset.status === 'DISPOSED')
      fail(409, 'ASSET_DISPOSED', 'A disposed asset cannot receive new documents.');
    const maintenanceId = input.maintenanceId
      ? positiveId(input.maintenanceId, 'Maintenance record')
      : null;
    const inspectionId = input.inspectionId ? positiveId(input.inspectionId, 'Inspection') : null;
    if (maintenanceId) {
      const job = await findJob(tx, scope, maintenanceId);
      if (job.assetId !== assetId)
        fail(400, 'LINK_MISMATCH', 'That maintenance record belongs to another asset.');
    }
    if (inspectionId) {
      const [inspection] = await tx
        .select({ assetId: schema.fixedAssetInspections.assetId })
        .from(schema.fixedAssetInspections)
        .where(
          and(
            eq(schema.fixedAssetInspections.id, inspectionId),
            eq(schema.fixedAssetInspections.facilityId, scope.facilityId),
          ),
        )
        .limit(1);
      if (!inspection) fail(404, 'INSPECTION_NOT_FOUND', 'Inspection not found in this facility.');
      if (inspection.assetId !== assetId)
        fail(400, 'LINK_MISMATCH', 'That inspection belongs to another asset.');
    }
    const [created] = await tx
      .insert(schema.fixedAssetDocuments)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        assetId,
        maintenanceId: maintenanceId ?? undefined,
        inspectionId: inspectionId ?? undefined,
        title,
        documentType: requiredText(input.documentType, 'Document type', 60).toUpperCase(),
        filename,
        mimeType,
        byteSize: content.length,
        sha256,
        content,
        uploadedByUserId: scope.actorId,
      })
      .returning({
        id: schema.fixedAssetDocuments.id,
        title: schema.fixedAssetDocuments.title,
        documentType: schema.fixedAssetDocuments.documentType,
        filename: schema.fixedAssetDocuments.filename,
        mimeType: schema.fixedAssetDocuments.mimeType,
        byteSize: schema.fixedAssetDocuments.byteSize,
        sha256: schema.fixedAssetDocuments.sha256,
        createdAt: schema.fixedAssetDocuments.createdAt,
      });
    await audit(
      tx,
      scope,
      'fixed_asset_documents',
      created.id,
      'UPLOAD',
      `Uploaded ${created.documentType} “${title}” (${created.byteSize} bytes, sha256 ${sha256.slice(0, 12)}…).`,
    );
    return created;
  });
}

export async function listAssetDocuments(scope: AssetScope, assetId: number) {
  return db
    .select({
      id: schema.fixedAssetDocuments.id,
      assetId: schema.fixedAssetDocuments.assetId,
      maintenanceId: schema.fixedAssetDocuments.maintenanceId,
      inspectionId: schema.fixedAssetDocuments.inspectionId,
      title: schema.fixedAssetDocuments.title,
      documentType: schema.fixedAssetDocuments.documentType,
      filename: schema.fixedAssetDocuments.filename,
      mimeType: schema.fixedAssetDocuments.mimeType,
      byteSize: schema.fixedAssetDocuments.byteSize,
      sha256: schema.fixedAssetDocuments.sha256,
      createdAt: schema.fixedAssetDocuments.createdAt,
    })
    .from(schema.fixedAssetDocuments)
    .where(
      and(
        eq(schema.fixedAssetDocuments.tenantId, scope.tenantId),
        eq(schema.fixedAssetDocuments.facilityId, scope.facilityId),
        eq(schema.fixedAssetDocuments.assetId, assetId),
      ),
    )
    .orderBy(desc(schema.fixedAssetDocuments.createdAt));
}

export async function getAssetDocument(scope: AssetScope, id: number) {
  const [document] = await db
    .select()
    .from(schema.fixedAssetDocuments)
    .where(
      and(
        eq(schema.fixedAssetDocuments.id, id),
        eq(schema.fixedAssetDocuments.tenantId, scope.tenantId),
        eq(schema.fixedAssetDocuments.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!document) fail(404, 'DOCUMENT_NOT_FOUND', 'Document not found in this facility.');
  // Integrity is checked on read: the row is only served if its bytes still hash
  // to the digest recorded at upload.
  const digest = createHash('sha256').update(document.content).digest('hex');
  if (digest !== document.sha256)
    fail(409, 'DOCUMENT_CORRUPT', 'The stored document does not match its recorded checksum.');
  return document;
}

/* ============================================================
   SHARED LOOKUPS
   ============================================================ */

async function findSchedule(tx: Tx, scope: AssetScope, id: number, forUpdate = false) {
  const [schedule] = await tx
    .select()
    .from(schema.fixedAssetMaintenanceSchedules)
    .where(
      and(
        eq(schema.fixedAssetMaintenanceSchedules.id, id),
        eq(schema.fixedAssetMaintenanceSchedules.tenantId, scope.tenantId),
        eq(schema.fixedAssetMaintenanceSchedules.facilityId, scope.facilityId),
      ),
    )
    .limit(1)
    .for(forUpdate ? 'update' : 'share');
  if (!schedule)
    fail(404, 'SCHEDULE_NOT_FOUND', 'Maintenance schedule not found in this facility.');
  return schedule;
}

async function findJob(tx: Tx, scope: AssetScope, id: number, forUpdate = false) {
  const [job] = await tx
    .select()
    .from(schema.fixedAssetMaintenance)
    .where(
      and(
        eq(schema.fixedAssetMaintenance.id, id),
        eq(schema.fixedAssetMaintenance.tenantId, scope.tenantId),
        eq(schema.fixedAssetMaintenance.facilityId, scope.facilityId),
      ),
    )
    .limit(1)
    .for(forUpdate ? 'update' : 'share');
  if (!job) fail(404, 'MAINTENANCE_NOT_FOUND', 'Maintenance record not found in this facility.');
  return job;
}

async function assertDepartment(tx: Tx, scope: AssetScope, departmentId: number | null) {
  if (!departmentId) return;
  const [department] = await tx
    .select({ id: schema.departments.id })
    .from(schema.departments)
    .where(
      and(
        eq(schema.departments.id, departmentId),
        eq(schema.departments.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!department) fail(404, 'DEPARTMENT_NOT_FOUND', 'Department not found in this facility.');
}

/** Everything the asset detail screen needs beyond the register row itself. */
export async function assetOperations(scope: AssetScope, assetId: number) {
  const [schedules, jobs, inspections, lifecycle, documents] = await Promise.all([
    listMaintenanceSchedules(scope, { assetId, includeInactive: true }),
    listMaintenanceJobs(scope, { assetId }),
    listInspections(scope, { assetId }),
    listLifecycleEvents(scope, { assetId }),
    listAssetDocuments(scope, assetId),
  ]);
  const overdue = schedules.filter((schedule) => schedule.status === 'OVERDUE').length;
  const due = schedules.filter((schedule) => schedule.status === 'DUE').length;
  return {
    schedules,
    jobs,
    inspections,
    lifecycle,
    documents,
    summary: {
      activeSchedules: schedules.filter((schedule) => schedule.isActive).length,
      overdueSchedules: overdue,
      dueSchedules: due,
      openCorrectiveJobs: jobs.filter(
        (job) => job.maintenanceType === 'CORRECTIVE' && job.status === 'PLANNED',
      ).length,
      completedMaintenance: jobs.filter((job) => job.status === 'COMPLETED').length,
      totalMaintenanceCostCents: jobs
        .filter((job) => job.status === 'COMPLETED')
        .reduce((sum, job) => sum + BigInt(Math.round(Number(job.costKes) * 100)), 0n)
        .toString(),
      lastInspectionDate: inspections[0]?.inspectionDate ?? null,
    },
  };
}

/* ============================================================
   FACILITY DASHBOARD
   ============================================================ */

export async function maintenanceDashboard(scope: AssetScope) {
  const now = today();
  const in30Days = addMonthsToDate(now, 1);
  const [dueRows, jobs, inspections] = await Promise.all([
    listMaintenanceSchedules(scope, {}),
    listMaintenanceJobs(scope, { status: 'PLANNED' }),
    listInspections(scope, { status: 'PLANNED' }),
  ]);
  return {
    dueToday: dueRows.filter((row) => row.nextDueDate === now),
    overdue: dueRows.filter((row) => row.nextDueDate < now),
    upcoming: dueRows.filter((row) => row.nextDueDate > now && row.nextDueDate <= in30Days),
    openCorrective: jobs.filter((job) => job.maintenanceType === 'CORRECTIVE'),
    openPreventive: jobs.filter((job) => job.maintenanceType === 'PREVENTIVE'),
    plannedInspections: inspections.filter(
      (inspection) => (inspection.inspectionDate ?? '') <= in30Days,
    ),
  };
}

/**
 * A per-facility counter used by the dashboard tiles. Kept as SQL rather than
 * loading every asset into memory.
 */
export async function assetCounters(scope: AssetScope) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      inService: sql<number>`count(*) FILTER (WHERE ${schema.fixedAssets.status} = 'ACTIVE')::int`,
      underMaintenance: sql<number>`count(*) FILTER (WHERE ${schema.fixedAssets.status} = 'UNDER_MAINTENANCE')::int`,
      unimpaired: sql<number>`count(*) FILTER (WHERE ${schema.fixedAssets.status} = 'IMPAIRED')::int`,
      retired: sql<number>`count(*) FILTER (WHERE ${schema.fixedAssets.status} = 'RETIRED')::int`,
      disposed: sql<number>`count(*) FILTER (WHERE ${schema.fixedAssets.status} = 'DISPOSED')::int`,
      costCents: sql<string>`coalesce(sum(${schema.fixedAssets.acquisitionCostKes}), 0)::numeric(20,2) * 100`,
      netBookCents: sql<string>`coalesce(sum(${schema.fixedAssets.netBookValueKes}), 0)::numeric(20,2) * 100`,
    })
    .from(schema.fixedAssets)
    .where(
      and(
        eq(schema.fixedAssets.tenantId, scope.tenantId),
        eq(schema.fixedAssets.facilityId, scope.facilityId),
      ),
    );
  return {
    total: row?.total ?? 0,
    inService: row?.inService ?? 0,
    underMaintenance: row?.underMaintenance ?? 0,
    impaired: row?.unimpaired ?? 0,
    retired: row?.retired ?? 0,
    disposed: row?.disposed ?? 0,
    costCents: String(Math.round(Number(row?.costCents ?? 0))),
    netBookCents: String(Math.round(Number(row?.netBookCents ?? 0))),
  };
}

/** Guarded re-export for callers that only need a period's end date. */
export function periodEnd(period: string): string {
  return `${period}-${String(daysInPeriod(addPeriods(period, 0))).padStart(2, '0')}`;
}
