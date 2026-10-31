/**
 * JaliCare HMIS
 * Pharmacy stock service: batches, expiry and FEFO dispensing.
 *
 * inventory_batches existed but nothing wrote to it and nothing read
 * from it, so stock was a single number on inventory_items that could
 * be driven negative by a double-click. This service makes the batch
 * table the source of truth for anything received with a batch number
 * and an expiry date.
 *
 * Two paths are supported deliberately:
 *
 *   Tracked   — the item has at least one batch row. Dispensing must
 *               draw first-expiry-first-out and is refused when the
 *               usable stock cannot cover the request.
 *   Untracked — the item has no batch rows, as is the case for every
 *               item created before this change. Dispensing uses the
 *               plain-count behaviour only when the recorded stock is
 *               sufficient; expiry cannot be verified and is disclosed.
 *
 * Scoping: inventory_batches has no facility column, so every query
 * reaches the facility through inventory_items.facility_id. Neither
 * table is ever read without that join.
 */

import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { getFacilityByIdScoped, requirePatientInTenant } from '../db/queries.ts';
import { loadPatientInScope } from '../db/queries/shared.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { billingServiceKeys } from '../billing/tariff-codes.ts';
import { codesForFamily } from '../billing/tariff-matching.ts';

import {
  daysUntilExpiry,
  expiryStatus,
  parseIsoDate,
  planFefo,
  stockValueCents,
  todayKey,
  type BatchExpiryStatus,
} from './inventory-contracts.ts';

/* ============================================================
   ERRORS
   ============================================================ */

export type InventoryErrorCode =
  | 'INVALID_INPUT'
  | 'ITEM_NOT_FOUND'
  | 'FACILITY_NOT_FOUND'
  | 'BATCH_NOT_FOUND'
  | 'INSUFFICIENT_STOCK'
  | 'STOCK_RECONCILIATION_REQUIRED'
  | 'EXPIRED_BATCH'
  | 'PATIENT_NOT_FOUND'
  | 'PRESCRIPTION_NOT_FOUND'
  | 'PRESCRIPTION_ALREADY_DISPENSED'
  | 'PRESCRIPTION_QUANTITY_REVIEW'
  | 'PRESCRIPTION_QUANTITY_EXCEEDED'
  | 'PRESCRIPTION_PRODUCT_REVIEW'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'DISPENSATION_REVIEW_REQUIRED';

export class InventoryDomainError extends Error {
  public readonly code: InventoryErrorCode;
  public readonly status: number;
  public readonly detail?: Record<string, unknown>;

  constructor(
    code: InventoryErrorCode,
    message: string,
    status = 400,
    detail?: Record<string, unknown>,
  ) {
    super(message);

    this.name = 'InventoryDomainError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/* ============================================================
   TYPES
   ============================================================ */

export interface InventoryBatchRow {
  id: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  unit: string | null;
  batchNumber: string;
  expiryDate: string;
  quantityRemaining: number;
  costPerUnit: string;
  daysToExpiry: number | null;
  status: BatchExpiryStatus;
}

export interface ExpirySummary {
  facilityId: number;
  generatedAt: string;
  horizonDays: number;
  expiredBatches: number;
  expiredUnits: number;
  expiringBatches: number;
  expiringUnits: number;
  expiredValueCents: number;
  expiringValueCents: number;
  /** Distinct items with anything expired or expiring. */
  affectedItems: number;
  items: Array<{
    itemId: number;
    itemCode: string;
    itemName: string;
    expiredUnits: number;
    expiringUnits: number;
    earliestExpiry: string;
  }>;
}

export interface ReceiveBatchInput {
  batchNumber?: unknown;
  expiryDate?: unknown;
  quantity?: unknown;
  costPerUnit?: unknown;
}

interface FacilityContext {
  facilityId: number;
  tenantId: number;
}

/* ============================================================
   INTERNAL HELPERS
   ============================================================ */

async function resolveFacility(
  context: AuthorizationContext,
  requestedFacilityId?: number | null,
): Promise<FacilityContext> {
  const facilityId = resolveFacilityScope(context, requestedFacilityId);

  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new InventoryDomainError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  }

  return { facilityId: facility.id, tenantId: facility.tenantId };
}

function parsePositiveInt(value: unknown, label: string, max: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InventoryDomainError(
      'INVALID_INPUT',
      `${label} must be a whole number greater than zero.`,
    );
  }

  if (parsed > max) {
    throw new InventoryDomainError('INVALID_INPUT', `${label} must not exceed ${max}.`);
  }

  return parsed;
}

function parseCost(value: unknown): string {
  if (value === undefined || value === null || value === '') return '0';

  const parsed = typeof value === 'number' ? value : Number(String(value));

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InventoryDomainError('INVALID_INPUT', 'Cost per unit must be zero or more.');
  }

  return parsed.toFixed(2);
}

/* ============================================================
   RECEIVE STOCK INTO A BATCH
   ============================================================ */

export async function receiveBatchScoped(
  context: AuthorizationContext,
  itemId: number,
  input: ReceiveBatchInput,
  requestedFacilityId?: number | null,
) {
  const { facilityId } = await resolveFacility(context, requestedFacilityId);

  const batchNumber = typeof input.batchNumber === 'string' ? input.batchNumber.trim() : '';

  if (batchNumber.length === 0 || batchNumber.length > 64) {
    throw new InventoryDomainError(
      'INVALID_INPUT',
      'Batch number is required and must be 64 characters or fewer.',
    );
  }

  const expiryRaw = typeof input.expiryDate === 'string' ? input.expiryDate.trim() : '';

  const expiry = parseIsoDate(expiryRaw);

  if (!expiry) {
    throw new InventoryDomainError(
      'INVALID_INPUT',
      'Expiry date must be a real date in YYYY-MM-DD format.',
    );
  }

  /*
   * Receiving stock that has already expired is always a mistake, and
   * accepting it would quietly poison every FEFO calculation afterwards.
   */
  if (expiryRaw < todayKey()) {
    throw new InventoryDomainError(
      'EXPIRED_BATCH',
      `Batch ${batchNumber} expired on ${expiryRaw} and cannot be received.`,
      400,
    );
  }

  const quantity = parsePositiveInt(input.quantity, 'Quantity', 1_000_000);
  const costPerUnit = parseCost(input.costPerUnit);

  const [item] = await db
    .select()
    .from(schema.inventoryItems)
    .where(
      and(eq(schema.inventoryItems.id, itemId), eq(schema.inventoryItems.facilityId, facilityId)),
    )
    .limit(1);

  if (!item) {
    throw new InventoryDomainError('ITEM_NOT_FOUND', 'Stock item not found.', 404);
  }

  return db.transaction(async (tx) => {
    /*
     * Re-receiving the same batch number tops the lot up rather than
     * violating inventory_batches_item_batch_idx. The expiry already on
     * the row wins: a different date for the same batch number is a
     * data-entry problem, not a reason to extend shelf life.
     */
    // All stock operations acquire the item lock before a batch lock.
    // Updating first prevents a receive/dispense lock-order deadlock.
    const [updatedItem] = await tx
      .update(schema.inventoryItems)
      .set({
        currentStock: sql`${schema.inventoryItems.currentStock} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.inventoryItems.id, item.id),
          eq(schema.inventoryItems.facilityId, facilityId),
          sql`${schema.inventoryItems.currentStock} >= 0`,
        ),
      )
      .returning();
    if (!updatedItem) {
      throw new InventoryDomainError(
        'STOCK_RECONCILIATION_REQUIRED',
        'Recorded stock is missing or invalid; review it before receiving a batch.',
        409,
      );
    }

    const [batch] = await tx
      .insert(schema.inventoryBatches)
      .values({
        itemId: item.id,
        batchNumber,
        expiryDate: expiryRaw,
        quantityRemaining: quantity,
        costPerUnit,
      })
      .onConflictDoUpdate({
        target: [schema.inventoryBatches.itemId, schema.inventoryBatches.batchNumber],
        set: {
          quantityRemaining: sql`${schema.inventoryBatches.quantityRemaining} + ${quantity}`,
          costPerUnit,
        },
      })
      .returning();

    return {
      batch: {
        ...batch,
        expiryDate: batch?.expiryDate ?? expiryRaw,
      },
      item: updatedItem,
      received: quantity,
      expiryMismatch: batch && batch.expiryDate !== expiryRaw ? batch.expiryDate : null,
    };
  });
}

/* ============================================================
   READ BATCHES
   ============================================================ */

export async function getBatchesScoped(
  context: AuthorizationContext,
  options: {
    facilityId?: number | null;
    itemId?: number | null;
    status?: BatchExpiryStatus | 'All';
    horizonDays?: number;
  } = {},
): Promise<InventoryBatchRow[]> {
  const { facilityId } = await resolveFacility(context, options.facilityId);

  const conditions = [eq(schema.inventoryItems.facilityId, facilityId)];

  if (typeof options.itemId === 'number' && Number.isSafeInteger(options.itemId)) {
    conditions.push(eq(schema.inventoryBatches.itemId, options.itemId));
  }

  const rows = await db
    .select({
      id: schema.inventoryBatches.id,
      itemId: schema.inventoryBatches.itemId,
      itemCode: schema.inventoryItems.itemCode,
      itemName: schema.inventoryItems.name,
      unit: schema.inventoryItems.unit,
      batchNumber: schema.inventoryBatches.batchNumber,
      expiryDate: schema.inventoryBatches.expiryDate,
      quantityRemaining: schema.inventoryBatches.quantityRemaining,
      costPerUnit: schema.inventoryBatches.costPerUnit,
    })
    .from(schema.inventoryBatches)
    .innerJoin(schema.inventoryItems, eq(schema.inventoryBatches.itemId, schema.inventoryItems.id))
    .where(and(...conditions))
    .orderBy(asc(schema.inventoryBatches.expiryDate), asc(schema.inventoryBatches.id));

  const today = todayKey();
  const horizon = options.horizonDays ?? 30;

  const decorated = rows.map((row) => ({
    ...row,
    costPerUnit: String(row.costPerUnit ?? '0'),
    daysToExpiry: daysUntilExpiry(row.expiryDate, today),
    status: expiryStatus(row.expiryDate, today, horizon),
  }));

  if (!options.status || options.status === 'All') return decorated;

  return decorated.filter((row) => row.status === options.status);
}

/* ============================================================
   EXPIRY SUMMARY
   ============================================================ */

export async function getExpirySummaryScoped(
  context: AuthorizationContext,
  requestedFacilityId?: number | null,
  horizonDays = 30,
): Promise<ExpirySummary> {
  const { facilityId } = await resolveFacility(context, requestedFacilityId);

  const batches = await getBatchesScoped(context, {
    facilityId,
    horizonDays,
  });

  const summary: ExpirySummary = {
    facilityId,
    generatedAt: new Date().toISOString(),
    horizonDays,
    expiredBatches: 0,
    expiredUnits: 0,
    expiringBatches: 0,
    expiringUnits: 0,
    expiredValueCents: 0,
    expiringValueCents: 0,
    affectedItems: 0,
    items: [],
  };

  const byItem = new Map<
    number,
    {
      itemId: number;
      itemCode: string;
      itemName: string;
      expiredUnits: number;
      expiringUnits: number;
      earliestExpiry: string;
    }
  >();

  for (const batch of batches) {
    if (batch.status === 'OK') continue;

    const expired = batch.status === 'Expired';

    if (expired) {
      summary.expiredBatches += 1;
      summary.expiredUnits += batch.quantityRemaining;
      summary.expiredValueCents += stockValueCents([
        { quantityRemaining: batch.quantityRemaining, costPerUnit: batch.costPerUnit },
      ]);
    } else {
      summary.expiringBatches += 1;
      summary.expiringUnits += batch.quantityRemaining;
      summary.expiringValueCents += stockValueCents([
        { quantityRemaining: batch.quantityRemaining, costPerUnit: batch.costPerUnit },
      ]);
    }

    const entry = byItem.get(batch.itemId) ?? {
      itemId: batch.itemId,
      itemCode: batch.itemCode,
      itemName: batch.itemName,
      expiredUnits: 0,
      expiringUnits: 0,
      earliestExpiry: batch.expiryDate,
    };

    if (expired) {
      entry.expiredUnits += batch.quantityRemaining;
    } else {
      entry.expiringUnits += batch.quantityRemaining;
    }

    if (batch.expiryDate < entry.earliestExpiry) {
      entry.earliestExpiry = batch.expiryDate;
    }

    byItem.set(batch.itemId, entry);
  }

  summary.items = [...byItem.values()].sort((a, b) => {
    if (a.expiredUnits !== b.expiredUnits) return b.expiredUnits - a.expiredUnits;

    return a.earliestExpiry < b.earliestExpiry ? -1 : 1;
  });

  summary.affectedItems = summary.items.length;

  return summary;
}

/* ============================================================
   DISPENSE — FEFO
   ============================================================ */

export interface DispenseInput {
  prescriptionId?: unknown;
  patientId?: unknown;
  itemId?: unknown;
  quantityDispensed?: unknown;
  dispensedBy?: unknown;
  notes?: unknown;
  batchNumber?: unknown;
  facilityId?: unknown;
  tenantId?: unknown;
  idempotencyKey?: unknown;
}

export interface DispenseResult {
  dispensation: typeof schema.pharmacyDispensations.$inferSelect;
  stockTracking: 'FEFO' | 'untracked';
  allocations: Array<{
    batchId: number;
    batchNumber: string;
    expiryDate: string;
    quantity: number;
  }>;
  stockAfter: number | null;
  replayed: boolean;
  prescriptionComplete: boolean;
  billingContext: { drugName: string; encounterId: number | null };
}

/** Read a prior request without starting a new dispensing action. */
export async function getDispenseRequestStatusScoped(
  context: AuthorizationContext,
  input: { facilityId?: number; idempotencyKey: unknown },
): Promise<
  | { status: 'NOT_FOUND' }
  | { status: 'RECORDED'; prescriptionId: number | null; quantity: number; dispensationId: number }
> {
  const { tenantId, facilityId } = await resolveFacility(context, input.facilityId);
  const key = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new InventoryDomainError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid retry identity is required.',
      400,
    );
  }
  return db.transaction(async (tx) => {
    // Wait for a same-key transaction already in progress. NOT_FOUND does
    // not authorize inventing a new key: a delayed request might still arrive.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pharmacy:${facilityId}:${key}`}, 0))`,
    );
    const [found] = await tx
      .select({
        request: schema.pharmacyDispenseRequests,
        dispensation: schema.pharmacyDispensations,
      })
      .from(schema.pharmacyDispenseRequests)
      .innerJoin(
        schema.pharmacyDispensations,
        eq(schema.pharmacyDispensations.id, schema.pharmacyDispenseRequests.dispensationId),
      )
      .where(
        and(
          eq(schema.pharmacyDispenseRequests.tenantId, tenantId),
          eq(schema.pharmacyDispenseRequests.facilityId, facilityId),
          eq(schema.pharmacyDispenseRequests.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (!found) return { status: 'NOT_FOUND' as const };
    const dispense = found.dispensation;
    if (dispense.tenantId !== tenantId || dispense.facilityId !== facilityId) {
      throw new InventoryDomainError(
        'DISPENSATION_REVIEW_REQUIRED',
        'The recorded dispensing requires review.',
        409,
      );
    }
    return {
      status: 'RECORDED' as const,
      prescriptionId: dispense.prescriptionId,
      quantity: dispense.quantityDispensed,
      dispensationId: dispense.id,
    };
  });
}

/**
 * Dispense against a patient, consuming stock first-expiry-first-out.
 *
 * Everything happens in one transaction with the batch rows locked, so
 * two tills cannot both draw the last ten tablets.
 */
export async function dispenseFefoScoped(
  context: AuthorizationContext,
  input: DispenseInput,
): Promise<DispenseResult> {
  const { facilityId, tenantId } = await resolveFacility(
    context,
    typeof input.facilityId === 'number' ? input.facilityId : undefined,
  );

  const patientId = parsePositiveInt(input.patientId, 'Patient ID', 2_147_483_647);
  const quantity = parsePositiveInt(input.quantityDispensed, 'Quantity dispensed', 100_000);

  const dispensedBy =
    typeof input.dispensedBy === 'string' && input.dispensedBy.trim()
      ? input.dispensedBy.trim().slice(0, 120)
      : 'Pharmacy';

  const patient = await requirePatientInTenant(context, patientId, tenantId);

  if (!patient) {
    throw new InventoryDomainError('PATIENT_NOT_FOUND', 'Patient not found.', 404);
  }

  // A successful dispensing must identify the stock item actually handed out.
  const itemId = parsePositiveInt(input.itemId, 'Stock item ID', 2_147_483_647);

  const prescriptionId =
    input.prescriptionId === undefined || input.prescriptionId === null
      ? null
      : parsePositiveInt(input.prescriptionId, 'Prescription ID', 2_147_483_647);

  // A prescription supplies an encounter that is checked inside the
  // transaction below. An unlinked dispense must independently establish
  // that the patient is registered at, or has been seen at, this facility;
  // membership in the same tenant alone does not grant facility access.
  if (prescriptionId === null) {
    await loadPatientInScope({ ...context, tenantId, facilityId }, patientId);
  }

  const notes = typeof input.notes === 'string' ? input.notes.slice(0, 2000) : null;
  const batchNumber =
    typeof input.batchNumber === 'string' && input.batchNumber.trim()
      ? input.batchNumber.trim().slice(0, 120)
      : null;
  const key = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new InventoryDomainError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Supply a unique idempotency key for each dispensing action and reuse it for retries.',
      400,
    );
  }
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        tenantId,
        facilityId,
        patientId,
        prescriptionId,
        itemId,
        quantity,
        notes,
        batchNumber,
      }),
    )
    .digest('hex');
  const today = todayKey();

  return db.transaction(async (tx) => {
    // Same-key requests serialize even when they refer to different prescriptions.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pharmacy:${facilityId}:${key}`}, 0))`,
    );
    const [priorRequest] = await tx
      .select({
        request: schema.pharmacyDispenseRequests,
        dispensation: schema.pharmacyDispensations,
      })
      .from(schema.pharmacyDispenseRequests)
      .innerJoin(
        schema.pharmacyDispensations,
        eq(schema.pharmacyDispensations.id, schema.pharmacyDispenseRequests.dispensationId),
      )
      .where(
        and(
          eq(schema.pharmacyDispenseRequests.tenantId, tenantId),
          eq(schema.pharmacyDispenseRequests.facilityId, facilityId),
          eq(schema.pharmacyDispenseRequests.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (priorRequest) {
      if (priorRequest.request.requestHash !== requestHash) {
        throw new InventoryDomainError(
          'IDEMPOTENCY_CONFLICT',
          'This idempotency key was used for a different dispensing request.',
          409,
        );
      }
      if (
        priorRequest.dispensation.tenantId !== tenantId ||
        priorRequest.dispensation.facilityId !== facilityId ||
        priorRequest.dispensation.patientId !== patientId ||
        priorRequest.dispensation.prescriptionId !== prescriptionId ||
        priorRequest.dispensation.itemId !== itemId ||
        priorRequest.dispensation.quantityDispensed !== quantity
      ) {
        throw new InventoryDomainError(
          'DISPENSATION_REVIEW_REQUIRED',
          'The recorded dispensing requires review before replay.',
          409,
        );
      }
      const priorAllocations = await tx
        .select({
          batchId: schema.pharmacyDispenseAllocations.batchId,
          batchNumber: schema.pharmacyDispenseAllocations.batchNumber,
          expiryDate: schema.pharmacyDispenseAllocations.expiryDate,
          quantity: schema.pharmacyDispenseAllocations.quantity,
        })
        .from(schema.pharmacyDispenseAllocations)
        .where(eq(schema.pharmacyDispenseAllocations.dispensationId, priorRequest.dispensation.id))
        .orderBy(asc(schema.pharmacyDispenseAllocations.id));
      const [priorItem] = await tx
        .select({ name: schema.inventoryItems.name })
        .from(schema.inventoryItems)
        .where(
          and(
            eq(schema.inventoryItems.id, itemId),
            eq(schema.inventoryItems.facilityId, facilityId),
          ),
        )
        .limit(1);
      const [priorPrescription] =
        prescriptionId === null
          ? []
          : await tx
              .select()
              .from(schema.medications)
              .where(
                and(
                  eq(schema.medications.id, prescriptionId),
                  eq(schema.medications.patientId, patientId),
                ),
              )
              .limit(1);
      if (
        !priorItem ||
        (prescriptionId !== null && !priorPrescription) ||
        !['FEFO', 'untracked'].includes(priorRequest.request.stockTracking)
      ) {
        throw new InventoryDomainError(
          'DISPENSATION_REVIEW_REQUIRED',
          'The recorded dispensing requires review before replay.',
          409,
        );
      }
      return {
        dispensation: priorRequest.dispensation,
        stockTracking: priorRequest.request.stockTracking as 'FEFO' | 'untracked',
        allocations: priorAllocations,
        stockAfter: priorRequest.request.stockAfter,
        replayed: true,
        prescriptionComplete: prescriptionId === null || priorPrescription?.status === 'Dispensed',
        billingContext: {
          drugName: priorPrescription?.drugName ?? priorItem.name,
          encounterId: priorPrescription?.encounterId ?? null,
        },
      };
    }
    /*
     * Declared here, assigned once inside the branch below, and read only
     * inside it. The previous `| null = null` initialiser was never read
     * on any path, which is what the linter reported.
     */
    let item: typeof schema.inventoryItems.$inferSelect;
    let prescription: typeof schema.medications.$inferSelect | null = null;
    let remainingAfter: number | null = null;
    if (prescriptionId !== null) {
      const [foundPrescription] = await tx
        .select()
        .from(schema.medications)
        .where(eq(schema.medications.id, prescriptionId))
        .limit(1)
        .for('update');
      if (!foundPrescription || foundPrescription.patientId !== patientId) {
        throw new InventoryDomainError(
          'PRESCRIPTION_NOT_FOUND',
          'Prescription not found in the authorized facility.',
          404,
        );
      }
      const [encounter] = await tx
        .select({ id: schema.encounters.id })
        .from(schema.encounters)
        .where(
          and(
            eq(schema.encounters.id, foundPrescription.encounterId),
            eq(schema.encounters.patientId, patientId),
            eq(schema.encounters.tenantId, tenantId),
            eq(schema.encounters.facilityId, facilityId),
          ),
        )
        .limit(1);
      if (!encounter) {
        throw new InventoryDomainError(
          'PRESCRIPTION_NOT_FOUND',
          'Prescription not found in the authorized facility.',
          404,
        );
      }
      if (!['Prescribed', 'Partially Dispensed'].includes(foundPrescription.status ?? '')) {
        throw new InventoryDomainError(
          'PRESCRIPTION_ALREADY_DISPENSED',
          'Prescription is not available for dispensing.',
          409,
        );
      }
      const prior = await tx
        .select({
          quantity: schema.pharmacyDispensations.quantityDispensed,
          patientId: schema.pharmacyDispensations.patientId,
          tenantId: schema.pharmacyDispensations.tenantId,
          facilityId: schema.pharmacyDispensations.facilityId,
          itemId: schema.pharmacyDispensations.itemId,
        })
        .from(schema.pharmacyDispensations)
        .where(eq(schema.pharmacyDispensations.prescriptionId, prescriptionId));
      const prescribed = foundPrescription.quantity;
      if (
        !Number.isSafeInteger(prescribed) ||
        !prescribed ||
        prescribed <= 0 ||
        prior.some(
          (row) =>
            !Number.isSafeInteger(row.quantity) ||
            row.quantity <= 0 ||
            row.patientId !== patientId ||
            row.tenantId !== tenantId ||
            row.facilityId !== facilityId ||
            !row.itemId,
        )
      ) {
        throw new InventoryDomainError(
          'PRESCRIPTION_QUANTITY_REVIEW',
          'Prescription and previous dispensations require reconciliation.',
          409,
        );
      }
      const alreadyDispensed = prior.reduce((total, row) => total + row.quantity, 0);
      if (
        (foundPrescription.status === 'Prescribed' && alreadyDispensed !== 0) ||
        (foundPrescription.status === 'Partially Dispensed' &&
          (alreadyDispensed <= 0 || alreadyDispensed >= prescribed))
      ) {
        throw new InventoryDomainError(
          'PRESCRIPTION_QUANTITY_REVIEW',
          'Prescription status and dispensing history require reconciliation.',
          409,
        );
      }
      if (prior.some((row) => row.itemId !== itemId)) {
        throw new InventoryDomainError(
          'PRESCRIPTION_PRODUCT_REVIEW',
          'A different product requires an authorized substitution workflow.',
          409,
        );
      }
      if (quantity > prescribed - alreadyDispensed) {
        throw new InventoryDomainError(
          'PRESCRIPTION_QUANTITY_EXCEEDED',
          'Quantity exceeds the remaining prescribed amount.',
          409,
        );
      }
      remainingAfter = prescribed - alreadyDispensed - quantity;
      prescription = foundPrescription;
    }
    let allocations: DispenseResult['allocations'] = [];
    let stockTracking: 'FEFO' | 'untracked' = 'untracked';
    let stockAfter: number | null = null;

    {
      const [found] = await tx
        .select()
        .from(schema.inventoryItems)
        .where(
          and(
            eq(schema.inventoryItems.id, itemId),
            eq(schema.inventoryItems.facilityId, facilityId),
          ),
        )
        .limit(1)
        .for('update');

      if (!found || found.isActive === false) {
        throw new InventoryDomainError('ITEM_NOT_FOUND', 'Active stock item not found.', 404);
      }

      item = found;
      if (item.currentStock === null || item.currentStock < quantity) {
        throw new InventoryDomainError(
          'INSUFFICIENT_STOCK',
          'Recorded stock is insufficient or requires reconciliation.',
          409,
        );
      }

      const lots = await tx
        .select({
          id: schema.inventoryBatches.id,
          batchNumber: schema.inventoryBatches.batchNumber,
          expiryDate: schema.inventoryBatches.expiryDate,
          quantityRemaining: schema.inventoryBatches.quantityRemaining,
        })
        .from(schema.inventoryBatches)
        .where(eq(schema.inventoryBatches.itemId, item.id))
        .for('update');

      if (lots.length > 0) {
        stockTracking = 'FEFO';

        const plan = planFefo(lots, quantity, today);

        if (plan.shortfall > 0) {
          const detail = {
            requested: quantity,
            available: plan.usableUnits,
            expired: plan.expiredUnits,
            itemCode: item.itemCode,
          };

          throw new InventoryDomainError(
            'INSUFFICIENT_STOCK',
            plan.expiredUnits > 0
              ? `Not enough unexpired ${item.name}: ${plan.usableUnits} usable, ${plan.expiredUnits} expired, ${quantity} requested.`
              : `Not enough ${item.name} in stock: ${plan.usableUnits} available, ${quantity} requested.`,
            409,
            detail,
          );
        }

        allocations = plan.allocations;

        for (const allocation of plan.allocations) {
          await tx
            .update(schema.inventoryBatches)
            .set({
              quantityRemaining: sql`${schema.inventoryBatches.quantityRemaining} - ${allocation.quantity}`,
            })
            .where(eq(schema.inventoryBatches.id, allocation.batchId));
        }
      }

      const [updatedItem] = await tx
        .update(schema.inventoryItems)
        .set({
          currentStock: sql`COALESCE(${schema.inventoryItems.currentStock}, 0) - ${quantity}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.inventoryItems.id, item.id))
        .returning();

      stockAfter = updatedItem?.currentStock ?? null;
    }

    const [dispensation] = await tx
      .insert(schema.pharmacyDispensations)
      .values({
        tenantId,
        facilityId,
        prescriptionId,
        patientId,
        itemId,
        /*
         * A draw can span several lots. The column is text, so record
         * every batch number consumed — a recall needs all of them.
         */
        batchNumber:
          allocations.length > 0
            ? allocations.map((allocation) => allocation.batchNumber).join(', ')
            : batchNumber,
        quantityDispensed: quantity,
        dispensedBy,
        notes,
      })
      .returning();

    if (prescriptionId !== null) {
      await tx
        .update(schema.medications)
        .set({ status: remainingAfter === 0 ? 'Dispensed' : 'Partially Dispensed' })
        .where(
          and(
            eq(schema.medications.id, prescriptionId),
            eq(schema.medications.patientId, patientId),
          ),
        );
    }

    if (allocations.length) {
      await tx.insert(schema.pharmacyDispenseAllocations).values(
        allocations.map((allocation) => ({
          dispensationId: dispensation.id,
          batchId: allocation.batchId,
          batchNumber: allocation.batchNumber,
          expiryDate: allocation.expiryDate,
          quantity: allocation.quantity,
        })),
      );
    }
    await tx.insert(schema.pharmacyDispenseRequests).values({
      tenantId,
      facilityId,
      idempotencyKey: key,
      requestHash,
      dispensationId: dispensation.id,
      stockTracking,
      stockAfter,
    });

    await tx.insert(schema.auditLogs).values({
      tenantId,
      facilityId,
      userId: String(context.userId),
      action: 'CREATE',
      resource: 'PharmacyDispensation',
      resourceId: String(dispensation.id),
      details: `Dispensation recorded; stock tracking: ${stockTracking}.`,
    });

    // The clinical/stock transaction also records the durable billing work.
    // A process crash after commit cannot make the charge disappear: the
    // existing charge-attempt worklist can retry this source. This is not a
    // price and does not claim that billing has completed.
    const drugName = prescription?.drugName ?? item.name;
    const codes = codesForFamily({ family: 'PHARMACY', name: drugName });
    const [billingWork] = await tx
      .insert(schema.billingChargeAttempts)
      .values({
        tenantId,
        facilityId,
        patientId,
        encounterId: prescription?.encounterId ?? null,
        sourceType: 'PHARMACY',
        sourceId: dispensation.id,
        itemType: 'Pharmacy',
        description: drugName,
        codes,
        serviceKeys: billingServiceKeys('PHARMACY', [drugName]),
        family: 'PHARMACY',
        serviceName: drugName,
        serviceRefType: 'PHARMACY',
        serviceRefId: item.id,
        serviceRefCode: item.itemCode,
        quantity,
        fallbackUnitPrice: null,
        reason: 'BILLING_PENDING',
        detail: 'Dispensing recorded; automatic billing has not completed.',
        codesTried: [],
        status: 'PENDING',
        attempts: 0,
      })
      .returning({ id: schema.billingChargeAttempts.id });
    if (!billingWork) throw new Error('PHARMACY_BILLING_WORK_NOT_RECORDED');
    await tx.insert(schema.auditLogs).values({
      tenantId,
      facilityId,
      userId: String(context.userId),
      action: 'CREATE',
      resource: 'BillingChargeAttempt',
      resourceId: String(billingWork.id),
      details: 'Billing work recorded with pharmacy dispensation; no price or payment is implied.',
    });
    return {
      dispensation,
      stockTracking,
      allocations,
      stockAfter,
      replayed: false,
      prescriptionComplete: prescriptionId === null || remainingAfter === 0,
      billingContext: {
        drugName: prescription?.drugName ?? item.name,
        encounterId: prescription?.encounterId ?? null,
      },
    };
  });
}

/* ============================================================
   STOCK-ON-HAND BY ITEM (for the pharmacy picker)
   ============================================================ */

export async function getItemBatchStockScoped(
  context: AuthorizationContext,
  itemIds: number[],
  requestedFacilityId?: number | null,
) {
  if (itemIds.length === 0) return [];

  const { facilityId } = await resolveFacility(context, requestedFacilityId);

  const where = and(
    eq(schema.inventoryItems.facilityId, facilityId),
    inArray(schema.inventoryBatches.itemId, itemIds),
  );

  const rows = await db
    .select({
      itemId: schema.inventoryBatches.itemId,
      expiryDate: schema.inventoryBatches.expiryDate,
      quantityRemaining: schema.inventoryBatches.quantityRemaining,
    })
    .from(schema.inventoryBatches)
    .innerJoin(schema.inventoryItems, eq(schema.inventoryBatches.itemId, schema.inventoryItems.id))
    .where(where);

  const today = todayKey();

  const byItem = new Map<number, { usable: number; expired: number; batches: number }>();

  for (const row of rows) {
    const entry = byItem.get(row.itemId) ?? { usable: 0, expired: 0, batches: 0 };

    entry.batches += 1;

    if (expiryStatus(row.expiryDate, today) === 'Expired') {
      entry.expired += row.quantityRemaining;
    } else {
      entry.usable += row.quantityRemaining;
    }

    byItem.set(row.itemId, entry);
  }

  return [...byItem.entries()].map(([itemId, value]) => ({ itemId, ...value }));
}
