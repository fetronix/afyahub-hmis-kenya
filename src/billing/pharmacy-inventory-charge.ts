import { and, asc, eq } from 'drizzle-orm';
import type { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { calendarDateInZone, validTimezone } from '../dashboard/timezone.ts';
import { parseIsoDate } from '../inventory/inventory-contracts.ts';
import type { ChargeRequest } from './billing.service.ts';
import { parseMoneyToCents } from './settlement.ts';

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type Allocation = { batchId: number; batchNumber: string; expiryDate: string; quantity: number };

export type PharmacyInventoryResolution =
  | {
      price: string;
      itemId: number;
      prescriptionId: number;
      code: string;
      name: string;
      unit: string;
      serviceDate: string;
      performedAt: Date;
      stockTracking: 'FEFO' | 'untracked';
      allocations: Allocation[];
    }
  | { failure: { code: string; message: string } };

const fail = (code: string, message: string): PharmacyInventoryResolution => ({
  failure: { code, message },
});
const present = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Resolve only from an actual, scoped dispensing and its immutable stock-time
 * evidence. Current inventory prices, caller-supplied prices, names and
 * facility service tariffs are deliberately never used to price the event.
 */
export async function resolvePharmacyInventoryCharge(
  executor: Executor,
  request: ChargeRequest,
): Promise<PharmacyInventoryResolution> {
  if (
    request.sourceType !== 'PHARMACY' ||
    typeof request.sourceId !== 'number' ||
    !Number.isSafeInteger(request.sourceId) ||
    request.sourceId <= 0
  )
    return fail('DISPENSATION_REQUIRED', 'A recorded dispensing is required for medicine billing.');

  const [dispense] = await executor
    .select()
    .from(schema.pharmacyDispensations)
    .where(eq(schema.pharmacyDispensations.id, request.sourceId))
    .limit(1);
  if (
    !dispense ||
    dispense.tenantId !== request.tenantId ||
    dispense.facilityId !== request.facilityId ||
    dispense.patientId !== request.patientId ||
    !dispense.itemId ||
    !Number.isSafeInteger(dispense.quantityDispensed) ||
    dispense.quantityDispensed <= 0 ||
    dispense.quantityDispensed !== (request.quantity ?? 1)
  )
    return fail('DISPENSATION_SCOPE_OR_QUANTITY_INVALID', 'Dispensing identity or quantity requires review.');

  if (!dispense.prescriptionId)
    return fail(
      'PRESCRIPTION_NOT_RECORDED',
      'The dispensing has no linked prescription; billing requires review.',
    );
  const [prescription] = await executor
    .select({ encounterId: schema.encounters.id })
    .from(schema.medications)
    .innerJoin(schema.encounters, eq(schema.medications.encounterId, schema.encounters.id))
    .where(
      and(
        eq(schema.medications.id, dispense.prescriptionId),
        eq(schema.medications.patientId, request.patientId),
        eq(schema.encounters.patientId, request.patientId),
        eq(schema.encounters.tenantId, request.tenantId),
        eq(schema.encounters.facilityId, request.facilityId),
      ),
    )
    .limit(1);
  if (!prescription || prescription.encounterId !== (request.encounterId ?? null))
    return fail('PRESCRIPTION_SCOPE_INVALID', 'The prescription and encounter require review.');

  const [item] = await executor
    .select({ id: schema.inventoryItems.id })
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.id, dispense.itemId),
        eq(schema.inventoryItems.facilityId, request.facilityId),
      ),
    )
    .limit(1);
  if (!item) return fail('INVENTORY_SCOPE_INVALID', 'The selected facility product requires review.');

  const [recordedRequest] = await executor
    .select({ tracking: schema.pharmacyDispenseRequests.stockTracking })
    .from(schema.pharmacyDispenseRequests)
    .where(
      and(
        eq(schema.pharmacyDispenseRequests.dispensationId, dispense.id),
        eq(schema.pharmacyDispenseRequests.tenantId, request.tenantId),
        eq(schema.pharmacyDispenseRequests.facilityId, request.facilityId),
      ),
    )
    .limit(1);
  if (!recordedRequest)
    return fail(
      'DISPENSATION_EVIDENCE_MISSING',
      'The historical dispensing lacks controlled stock and price evidence; do not use a current price.',
    );

  if (
    !present(dispense.itemCodeSnapshot) ||
    !present(dispense.itemNameSnapshot) ||
    !present(dispense.itemUnitSnapshot) ||
    !present(dispense.dispensingDateSnapshot) ||
    !parseIsoDate(dispense.dispensingDateSnapshot) ||
    !validTimezone(dispense.dispensingTimezoneSnapshot) ||
    !(dispense.dispensedAt instanceof Date) ||
    !Number.isFinite(dispense.dispensedAt.getTime()) ||
    calendarDateInZone(dispense.dispensingTimezoneSnapshot, dispense.dispensedAt) !==
      dispense.dispensingDateSnapshot
  )
    return fail('DISPENSING_SNAPSHOT_INCOMPLETE', 'The dispensing product, unit or date evidence is incomplete.');
  if ((parseMoneyToCents(dispense.sellingPriceSnapshot) ?? 0) <= 0)
    return fail(
      'INVENTORY_PRICE_NOT_CONFIGURED',
      'No positive facility selling price was recorded when this medicine was dispensed; it cannot be repriced automatically.',
    );

  const allocationRows = await executor
    .select({
      batchId: schema.pharmacyDispenseAllocations.batchId,
      batchNumber: schema.pharmacyDispenseAllocations.batchNumber,
      expiryDate: schema.pharmacyDispenseAllocations.expiryDate,
      quantity: schema.pharmacyDispenseAllocations.quantity,
      itemId: schema.inventoryBatches.itemId,
    })
    .from(schema.pharmacyDispenseAllocations)
    .innerJoin(
      schema.inventoryBatches,
      eq(schema.pharmacyDispenseAllocations.batchId, schema.inventoryBatches.id),
    )
    .where(eq(schema.pharmacyDispenseAllocations.dispensationId, dispense.id))
    .orderBy(asc(schema.pharmacyDispenseAllocations.id));
  const tracking = recordedRequest.tracking;
  if (
    tracking !== 'FEFO' ||
    (!allocationRows.length ||
        allocationRows.some(
          (allocation) =>
            allocation.itemId !== item.id ||
            !present(allocation.batchNumber) ||
            !parseIsoDate(allocation.expiryDate) ||
            allocation.expiryDate < dispense.dispensingDateSnapshot! ||
            !Number.isSafeInteger(allocation.quantity) ||
            allocation.quantity <= 0,
        ) ||
        allocationRows.reduce((sum, allocation) => sum + allocation.quantity, 0) !==
          dispense.quantityDispensed)
  )
    return fail('DISPENSATION_BATCH_EVIDENCE_INVALID', 'Dispensing batch allocations require reconciliation.');

  return {
    price: dispense.sellingPriceSnapshot!,
    itemId: item.id,
    prescriptionId: dispense.prescriptionId,
    code: dispense.itemCodeSnapshot,
    name: dispense.itemNameSnapshot,
    unit: dispense.itemUnitSnapshot,
    serviceDate: dispense.dispensingDateSnapshot,
    performedAt: dispense.dispensedAt,
    stockTracking: tracking,
    allocations: allocationRows.map(({ batchId, batchNumber, expiryDate, quantity }) => ({
      batchId,
      batchNumber,
      expiryDate,
      quantity,
    })),
  };
}
