/**
 * JaliCare HMIS — stock control.
 *
 * Three operations change stock on hand outside receiving and dispensing:
 *
 *   1. an adjustment, with a mandatory reason code, for damage, expiry, a
 *      supplier return or a documented correction;
 *   2. a physical count, which records what was actually on the shelf and posts
 *      the variance as one adjustment per item;
 *   3. a store transfer, which moves stock between locations without changing
 *      the facility total.
 *
 * Every one of them appends to `inventory_movements` in the same transaction
 * as the quantity change, so stock on hand can always be explained. Nothing is
 * ever updated or deleted from the ledger.
 *
 * A decrease may not take stock below zero, and a stock-tracked adjustment also
 * reduces the batch lot it came from so the batch ledger and the item total do
 * not drift apart.
 */

import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';

import { db, pool } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { optionalOrderText } from '../procurement/order-items.ts';

export type StockScope = {
  tenantId: number;
  facilityId: number;
  actorId: number;
  actorName: string;
};

type Tx = NodePgDatabase<Record<string, never>> & { $client: PoolClient };

async function withTx<T>(fn: (tx: Tx, client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = drizzle(client) as unknown as Tx;
    const result = await fn(tx, client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class StockError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StockError';
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new StockError(statusCode, code, message);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reason codes are a closed list. A free-text reason cannot be reported on, and
 * "other" would become the de facto code for every unexplained variance.
 */
export const ADJUSTMENT_REASONS = {
  DAMAGE: 'DAMAGED_STOCK',
  EXPIRY: 'EXPIRED_STOCK',
  SUPPLIER_RETURN: 'RETURNED_TO_SUPPLIER',
  COUNT_CORRECTION: 'COUNT_CORRECTION',
  DATA_ENTRY: 'DATA_ENTRY_CORRECTION',
  DONATION: 'DONATION_RECEIVED',
} as const;

const REASON_CODES = Object.keys(ADJUSTMENT_REASONS);

function isoDate(value: unknown, label: string): string {
  const raw = String(value ?? '').trim();
  if (!ISO_DATE.test(raw)) fail(400, 'INVALID_INPUT', `${label} must be YYYY-MM-DD.`);
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw)
    fail(400, 'INVALID_INPUT', `${label} must be a real calendar date.`);
  return raw;
}
function positiveInt(value: unknown, label: string, max = 1_000_000): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max)
    fail(400, 'INVALID_INPUT', `${label} must be a positive whole number.`);
  return parsed;
}
function nonNegativeInt(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    fail(400, 'INVALID_INPUT', `${label} must be zero or a positive whole number.`);
  return parsed;
}
function text(value: unknown, label: string, max: number, required = false): string | null {
  const parsed = optionalOrderText(value, label, max);
  if (!parsed && required) fail(400, 'INVALID_INPUT', `${label} is required.`);
  return parsed;
}

type TxForStock = Tx;

async function loadItem(tx: TxForStock, scope: StockScope, itemId: number, lock = false) {
  const query = tx
    .select()
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.id, itemId),
        eq(schema.inventoryItems.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  const [item] = lock ? await query.for('update') : await query;
  if (!item) fail(404, 'STOCK_ITEM_NOT_FOUND', 'Stock item not found for this facility.');
  return item;
}

async function appendMovement(
  tx: TxForStock,
  scope: StockScope,
  entry: {
    itemId: number;
    batchId?: number | null;
    movementType: string;
    quantityDelta: number;
    stockAfter: number;
    reasonCode?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
    storeFrom?: string | null;
    storeTo?: string | null;
    notes?: string | null;
    date: string;
  },
) {
  await tx.insert(schema.inventoryMovements).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    itemId: entry.itemId,
    batchId: entry.batchId ?? null,
    movementType: entry.movementType,
    quantityDelta: entry.quantityDelta,
    stockAfter: entry.stockAfter,
    reasonCode: entry.reasonCode ?? null,
    referenceType: entry.referenceType ?? null,
    referenceId: entry.referenceId ?? null,
    storeFrom: entry.storeFrom ?? null,
    storeTo: entry.storeTo ?? null,
    notes: entry.notes ?? null,
    actorUserId: scope.actorId,
    actorName: scope.actorName,
    movementDate: entry.date,
  });
}

/**
 * Apply an integer delta to an item and, when a batch is named, to that lot.
 * Returns the stock after the change. Callers must already hold the item lock.
 */
async function applyDelta(
  tx: TxForStock,
  scope: StockScope,
  item: { id: number; currentStock: number | null; name: string },
  delta: number,
  batchId: number | null,
) {
  const current = item.currentStock ?? 0;
  const next = current + delta;
  if (next < 0)
    fail(
      409,
      'NEGATIVE_STOCK',
      `"${item.name}" has ${current} on hand; ${Math.abs(delta)} cannot be removed.`,
    );

  if (batchId !== null) {
    const [batch] = await tx
      .select()
      .from(schema.inventoryBatches)
      .where(
        and(eq(schema.inventoryBatches.id, batchId), eq(schema.inventoryBatches.itemId, item.id)),
      )
      .limit(1)
      .for('update');
    if (!batch) fail(404, 'BATCH_NOT_FOUND', 'That batch does not belong to this item.');
    if (delta < 0) {
      const remaining = batch.quantityRemaining + delta;
      if (remaining < 0)
        fail(
          409,
          'BATCH_QUANTITY_EXCEEDED',
          `Batch ${batch.batchNumber} holds ${batch.quantityRemaining}; ${Math.abs(delta)} cannot be removed from it.`,
        );
      await tx
        .update(schema.inventoryBatches)
        .set({ quantityRemaining: remaining })
        .where(eq(schema.inventoryBatches.id, batchId));
    } else {
      await tx
        .update(schema.inventoryBatches)
        .set({ quantityRemaining: batch.quantityRemaining + delta })
        .where(eq(schema.inventoryBatches.id, batchId));
    }
  } else if (delta < 0) {
    /*
     * A decrease must not leave the lots holding more than the item does, or
     * the batch ledger and the stock figure drift apart and valuation starts
     * overstating the shelf. Draw the excess from the earliest-expiring lots
     * first (the same order dispensing uses) so a write-off consumes what
     * would have been wasted first.
     */
    const lots = await tx
      .select()
      .from(schema.inventoryBatches)
      .where(eq(schema.inventoryBatches.itemId, item.id))
      .orderBy(asc(schema.inventoryBatches.expiryDate), asc(schema.inventoryBatches.id))
      .for('update');
    const lotTotal = lots.reduce((sum, lot) => sum + lot.quantityRemaining, 0);
    let excess = lotTotal - next;
    for (const lot of lots) {
      if (excess <= 0) break;
      const take = Math.min(lot.quantityRemaining, excess);
      if (take <= 0) continue;
      await tx
        .update(schema.inventoryBatches)
        .set({ quantityRemaining: lot.quantityRemaining - take })
        .where(eq(schema.inventoryBatches.id, lot.id));
      excess -= take;
    }
  }

  await tx
    .update(schema.inventoryItems)
    .set({ currentStock: next, updatedAt: new Date() })
    .where(eq(schema.inventoryItems.id, item.id));

  return next;
}

/* ------------------------------------------------------------- adjustments */

export async function adjustStock(scope: StockScope, body: Record<string, unknown>) {
  const itemId = positiveInt(body.itemId, 'Stock item');
  const reason = String(body.reasonCode ?? '')
    .trim()
    .toUpperCase();
  if (!REASON_CODES.includes(reason))
    fail(400, 'INVALID_REASON', `Choose a reason code: ${REASON_CODES.join(', ')}.`);
  const direction = String(body.direction ?? '').toUpperCase();
  if (!['INCREASE', 'DECREASE'].includes(direction))
    fail(400, 'INVALID_DIRECTION', 'Direction must be INCREASE or DECREASE.');
  const quantity = positiveInt(body.quantity, 'Quantity');
  const movementDate = isoDate(body.movementDate, 'Adjustment date');
  const batchId =
    body.batchId === undefined || body.batchId === null || body.batchId === ''
      ? null
      : positiveInt(body.batchId, 'Batch');
  const notes = text(body.notes, 'Notes', 500);
  const delta = direction === 'INCREASE' ? quantity : -quantity;

  const result = await withTx(async (tx) => {
    const item = await loadItem(tx, scope, itemId, true);
    const stockAfter = await applyDelta(tx, scope, item, delta, batchId);
    await appendMovement(tx, scope, {
      itemId,
      batchId,
      movementType: reason === ADJUSTMENT_REASONS.EXPIRY ? 'WRITE_OFF' : 'ADJUSTMENT',
      quantityDelta: delta,
      stockAfter,
      reasonCode: reason,
      referenceType: 'ADJUSTMENT',
      referenceId: `${itemId}:${movementDate}:${Date.now().toString(36)}`,
      notes,
      date: movementDate,
    });
    await tx.insert(schema.auditLogs).values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      userId: String(scope.actorId),
      resource: 'InventoryAdjustment',
      resourceId: String(itemId),
      action: 'ADJUST',
      details: `${direction} ${quantity} ${item.unit ?? 'unit'} of ${item.name} (${reason}); stock now ${stockAfter}.`,
    });
    return { itemId, stockAfter, delta };
  });

  return { ...result, item: await getStockItem(scope, itemId) };
}

export async function listMovements(
  scope: StockScope,
  filters: { itemId?: number; from?: string; to?: string; limit?: number } = {},
) {
  const conditions = [
    eq(schema.inventoryMovements.tenantId, scope.tenantId),
    eq(schema.inventoryMovements.facilityId, scope.facilityId),
  ];
  if (filters.itemId) conditions.push(eq(schema.inventoryMovements.itemId, filters.itemId));
  if (filters.from) conditions.push(gte(schema.inventoryMovements.movementDate, filters.from));
  if (filters.to) conditions.push(lte(schema.inventoryMovements.movementDate, filters.to));
  const limit = Math.min(500, Math.max(1, Number(filters.limit ?? 200) || 200));
  const rows = await db
    .select({
      movement: schema.inventoryMovements,
      itemName: schema.inventoryItems.name,
      itemCode: schema.inventoryItems.itemCode,
    })
    .from(schema.inventoryMovements)
    .leftJoin(schema.inventoryItems, eq(schema.inventoryItems.id, schema.inventoryMovements.itemId))
    .where(and(...conditions))
    .orderBy(desc(schema.inventoryMovements.id))
    .limit(limit);
  return rows.map((row) => ({
    ...row.movement,
    itemName: row.itemName,
    itemCode: row.itemCode,
  }));
}

/* ------------------------------------------------------------------ counts */

export async function createStockCount(scope: StockScope, body: Record<string, unknown>) {
  const countNumber = text(body.countNumber, 'Count number', 40, true)!;
  const countDate = isoDate(body.countDate, 'Count date');
  const storeLocation = text(body.storeLocation, 'Store location', 120);

  const created = await withTx(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.inventoryStockCounts.id })
      .from(schema.inventoryStockCounts)
      .where(
        and(
          eq(schema.inventoryStockCounts.facilityId, scope.facilityId),
          eq(schema.inventoryStockCounts.countNumber, countNumber),
        ),
      )
      .limit(1);
    if (existing) fail(409, 'COUNT_NUMBER_IN_USE', 'This count number is already in use.');

    const itemConditions = [
      eq(schema.inventoryItems.facilityId, scope.facilityId),
      eq(schema.inventoryItems.isActive, true),
    ];
    if (storeLocation) itemConditions.push(eq(schema.inventoryItems.storeLocation, storeLocation));
    const items = await tx
      .select({
        id: schema.inventoryItems.id,
        currentStock: schema.inventoryItems.currentStock,
      })
      .from(schema.inventoryItems)
      .where(and(...itemConditions));
    if (!items.length)
      fail(
        409,
        'NO_ITEMS_TO_COUNT',
        storeLocation
          ? 'No active stock items are stored at that location.'
          : 'No active stock items to count.',
      );

    const [count] = await tx
      .insert(schema.inventoryStockCounts)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        countNumber,
        countDate,
        storeLocation,
        status: 'OPEN',
        notes: text(body.notes, 'Notes', 500),
        countedByUserId: scope.actorId,
        countedByName: scope.actorName,
      })
      .returning();

    await tx.insert(schema.inventoryStockCountLines).values(
      items.map((item) => ({
        countId: count.id,
        itemId: item.id,
        expectedQuantity: item.currentStock ?? 0,
      })),
    );
    await tx.insert(schema.auditLogs).values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      userId: String(scope.actorId),
      resource: 'InventoryStockCount',
      resourceId: String(count.id),
      action: 'CREATE',
      details: `Physical count ${countNumber} opened for ${items.length} item(s).`,
    });
    return count;
  });

  return getStockCount(scope, created.id);
}

export async function getStockCount(scope: StockScope, id: number) {
  const [count] = await db
    .select()
    .from(schema.inventoryStockCounts)
    .where(
      and(
        eq(schema.inventoryStockCounts.id, id),
        eq(schema.inventoryStockCounts.tenantId, scope.tenantId),
        eq(schema.inventoryStockCounts.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!count) fail(404, 'STOCK_COUNT_NOT_FOUND', 'Stock count not found.');
  const lines = await db
    .select({
      line: schema.inventoryStockCountLines,
      itemName: schema.inventoryItems.name,
      itemCode: schema.inventoryItems.itemCode,
      unit: schema.inventoryItems.unit,
      unitCost: schema.inventoryItems.unitCost,
    })
    .from(schema.inventoryStockCountLines)
    .leftJoin(
      schema.inventoryItems,
      eq(schema.inventoryItems.id, schema.inventoryStockCountLines.itemId),
    )
    .where(eq(schema.inventoryStockCountLines.countId, id))
    .orderBy(asc(schema.inventoryStockCountLines.id));
  return {
    ...count,
    lines: lines.map((row) => ({
      ...row.line,
      itemName: row.itemName,
      itemCode: row.itemCode,
      unit: row.unit,
      unitCost: row.unitCost,
    })),
  };
}

export async function listStockCounts(scope: StockScope) {
  return db
    .select()
    .from(schema.inventoryStockCounts)
    .where(
      and(
        eq(schema.inventoryStockCounts.tenantId, scope.tenantId),
        eq(schema.inventoryStockCounts.facilityId, scope.facilityId),
      ),
    )
    .orderBy(desc(schema.inventoryStockCounts.id))
    .limit(100);
}

export async function recordCountedQuantity(
  scope: StockScope,
  countId: number,
  body: Record<string, unknown>,
) {
  const itemId = positiveInt(body.itemId, 'Stock item');
  const countedQuantity = nonNegativeInt(body.countedQuantity, 'Counted quantity');

  await withTx(async (tx) => {
    const [count] = await tx
      .select()
      .from(schema.inventoryStockCounts)
      .where(
        and(
          eq(schema.inventoryStockCounts.id, countId),
          eq(schema.inventoryStockCounts.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!count) fail(404, 'STOCK_COUNT_NOT_FOUND', 'Stock count not found.');
    if (count.status !== 'OPEN') fail(409, 'COUNT_CLOSED', 'This count is no longer open.');

    const [line] = await tx
      .select()
      .from(schema.inventoryStockCountLines)
      .where(
        and(
          eq(schema.inventoryStockCountLines.countId, countId),
          eq(schema.inventoryStockCountLines.itemId, itemId),
        ),
      )
      .limit(1);
    if (!line) fail(404, 'COUNT_LINE_NOT_FOUND', 'That item is not part of this count.');

    await tx
      .update(schema.inventoryStockCountLines)
      .set({
        countedQuantity,
        varianceQuantity: countedQuantity - line.expectedQuantity,
        notes: text(body.notes, 'Notes', 300),
      })
      .where(eq(schema.inventoryStockCountLines.id, line.id));
  });

  return getStockCount(scope, countId);
}

/**
 * Post the variance of an open count.
 *
 * Each counted line whose counted quantity differs from what the system
 * expected becomes one adjustment movement. Lines that were never counted are
 * left alone rather than treated as zero, because an untouched line is missing
 * evidence, not evidence of an empty shelf.
 */
export async function postStockCount(scope: StockScope, countId: number) {
  const result = await withTx(async (tx) => {
    const [count] = await tx
      .select()
      .from(schema.inventoryStockCounts)
      .where(
        and(
          eq(schema.inventoryStockCounts.id, countId),
          eq(schema.inventoryStockCounts.tenantId, scope.tenantId),
          eq(schema.inventoryStockCounts.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!count) fail(404, 'STOCK_COUNT_NOT_FOUND', 'Stock count not found.');
    if (count.status !== 'OPEN') fail(409, 'COUNT_CLOSED', 'This count has already been posted.');

    const lines = await tx
      .select()
      .from(schema.inventoryStockCountLines)
      .where(eq(schema.inventoryStockCountLines.countId, countId))
      .orderBy(asc(schema.inventoryStockCountLines.id));
    const counted = lines.filter((line) => line.countedQuantity !== null);
    if (!counted.length)
      fail(409, 'NO_COUNTED_LINES', 'Record at least one counted quantity before posting.');

    let adjusted = 0;
    let netVariance = 0;
    for (const line of counted) {
      const variance = (line.countedQuantity ?? 0) - line.expectedQuantity;
      if (variance === 0) continue;
      const item = await loadItem(tx, scope, line.itemId, true);
      const stockAfter = await applyDelta(tx, scope, item, variance, null);
      await appendMovement(tx, scope, {
        itemId: line.itemId,
        movementType: 'COUNT_VARIANCE',
        quantityDelta: variance,
        stockAfter,
        reasonCode: 'PHYSICAL_COUNT',
        referenceType: 'STOCK_COUNT',
        referenceId: String(countId),
        notes: line.notes,
        date: count.countDate,
      });
      adjusted += 1;
      netVariance += variance;
    }

    await tx
      .update(schema.inventoryStockCounts)
      .set({
        status: 'POSTED',
        postedAt: new Date(),
        postedByUserId: scope.actorId,
        updatedAt: new Date(),
      })
      .where(eq(schema.inventoryStockCounts.id, countId));
    await tx.insert(schema.auditLogs).values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      userId: String(scope.actorId),
      resource: 'InventoryStockCount',
      resourceId: String(countId),
      action: 'POST',
      details: `Count ${count.countNumber} posted: ${adjusted} variance line(s), net ${netVariance}.`,
    });

    return { adjusted, netVariance };
  });

  return { ...result, count: await getStockCount(scope, countId) };
}

/* --------------------------------------------------------------- transfers */

export async function createTransfer(scope: StockScope, body: Record<string, unknown>) {
  const transferNumber = text(body.transferNumber, 'Transfer number', 40, true)!;
  const transferDate = isoDate(body.transferDate, 'Transfer date');
  const storeFrom = text(body.storeFrom, 'Source store', 120, true)!;
  const storeTo = text(body.storeTo, 'Destination store', 120, true)!;
  if (storeFrom === storeTo)
    fail(400, 'SAME_STORE', 'The source and destination stores must differ.');
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) fail(400, 'INVALID_INPUT', 'Add at least one item to the transfer.');
  const items = rawItems.map((entry, index) => {
    const line = (entry ?? {}) as Record<string, unknown>;
    return {
      itemId: positiveInt(line.itemId, `Line ${index + 1} stock item`),
      quantity: positiveInt(line.quantity, `Line ${index + 1} quantity`),
    };
  });

  const result = await withTx(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.inventoryTransfers.id })
      .from(schema.inventoryTransfers)
      .where(
        and(
          eq(schema.inventoryTransfers.facilityId, scope.facilityId),
          eq(schema.inventoryTransfers.transferNumber, transferNumber),
        ),
      )
      .limit(1);
    if (existing) fail(409, 'TRANSFER_NUMBER_IN_USE', 'This transfer number is already in use.');

    const [transfer] = await tx
      .insert(schema.inventoryTransfers)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        transferNumber,
        transferDate,
        storeFrom,
        storeTo,
        status: 'POSTED',
        notes: text(body.notes, 'Notes', 500),
        actorUserId: scope.actorId,
        actorName: scope.actorName,
      })
      .returning();

    for (const line of items) {
      const item = await loadItem(tx, scope, line.itemId, true);
      if (line.quantity > (item.currentStock ?? 0))
        fail(
          409,
          'INSUFFICIENT_STOCK',
          `"${item.name}" has ${item.currentStock ?? 0} on hand; ${line.quantity} cannot be moved.`,
        );
      await tx.insert(schema.inventoryTransferItems).values({
        transferId: transfer.id,
        itemId: line.itemId,
        quantity: line.quantity,
      });
      // A transfer does not change the facility total, so the ledger records
      // both legs: one out of the source store and one into the destination.
      for (const leg of ['OUT', 'IN'] as const) {
        await appendMovement(tx, scope, {
          itemId: line.itemId,
          movementType: leg === 'OUT' ? 'TRANSFER_OUT' : 'TRANSFER_IN',
          quantityDelta: leg === 'OUT' ? -line.quantity : line.quantity,
          stockAfter: item.currentStock ?? 0,
          reasonCode: 'STORE_TRANSFER',
          referenceType: 'TRANSFER',
          referenceId: `${transfer.id}:${line.itemId}:${leg}`,
          storeFrom,
          storeTo,
          date: transferDate,
        });
      }
    }

    await tx.insert(schema.auditLogs).values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      userId: String(scope.actorId),
      resource: 'InventoryTransfer',
      resourceId: String(transfer.id),
      action: 'POST',
      details: `Transfer ${transferNumber}: ${items.length} item(s) from ${storeFrom} to ${storeTo}.`,
    });

    return transfer;
  });

  return getTransfer(scope, result.id);
}

export async function getTransfer(scope: StockScope, id: number) {
  const [transfer] = await db
    .select()
    .from(schema.inventoryTransfers)
    .where(
      and(
        eq(schema.inventoryTransfers.id, id),
        eq(schema.inventoryTransfers.tenantId, scope.tenantId),
        eq(schema.inventoryTransfers.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!transfer) fail(404, 'TRANSFER_NOT_FOUND', 'Transfer not found.');
  const lines = await db
    .select({
      line: schema.inventoryTransferItems,
      itemName: schema.inventoryItems.name,
      itemCode: schema.inventoryItems.itemCode,
      unit: schema.inventoryItems.unit,
    })
    .from(schema.inventoryTransferItems)
    .leftJoin(
      schema.inventoryItems,
      eq(schema.inventoryItems.id, schema.inventoryTransferItems.itemId),
    )
    .where(eq(schema.inventoryTransferItems.transferId, id));
  return {
    ...transfer,
    items: lines.map((row) => ({
      ...row.line,
      itemName: row.itemName,
      itemCode: row.itemCode,
      unit: row.unit,
    })),
  };
}

export async function listTransfers(scope: StockScope) {
  const rows = await db
    .select()
    .from(schema.inventoryTransfers)
    .where(
      and(
        eq(schema.inventoryTransfers.tenantId, scope.tenantId),
        eq(schema.inventoryTransfers.facilityId, scope.facilityId),
      ),
    )
    .orderBy(desc(schema.inventoryTransfers.id))
    .limit(100);
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const lines = await db
    .select()
    .from(schema.inventoryTransferItems)
    .where(inArray(schema.inventoryTransferItems.transferId, ids));
  return rows.map((row) => ({
    ...row,
    itemCount: lines.filter((line) => line.transferId === row.id).length,
    totalQuantity: lines
      .filter((line) => line.transferId === row.id)
      .reduce((sum, line) => sum + line.quantity, 0),
  }));
}

/* --------------------------------------------------------------- reporting */

export async function getStockItem(scope: StockScope, itemId: number) {
  const item = await loadItem(db as unknown as TxForStock, scope, itemId);
  return item;
}

/**
 * Stock valuation at the current batch cost.
 *
 * A batch with no recorded cost is reported separately rather than valued at
 * zero, because zero would understate the balance and hide missing evidence.
 */
export async function getValuation(scope: StockScope) {
  const rows = await pool.query(
    `SELECT b.id            AS "batchId",
            b.item_id       AS "itemId",
            i.item_code     AS "itemCode",
            i.name          AS "itemName",
            i.category      AS "category",
            b.batch_number  AS "batchNumber",
            b.expiry_date   AS "expiryDate",
            b.quantity_remaining AS "quantity",
            b.cost_per_unit AS "unitCost",
            i.selling_price AS "sellingPrice"
       FROM inventory_batches b
       JOIN inventory_items i ON i.id = b.item_id
      WHERE i.facility_id = $1
        AND b.quantity_remaining > 0
      ORDER BY i.name, b.expiry_date`,
    [scope.facilityId],
  );

  let valuedCents = 0n;
  let unvaluedBatches = 0;
  let unvaluedQuantity = 0;
  const batches = rows.rows.map((row) => {
    const quantity = Number(row.quantity);
    const cost = row.unitCost === null ? null : Math.round(Number(row.unitCost) * 100);
    if (cost === null) {
      unvaluedBatches += 1;
      unvaluedQuantity += quantity;
    } else {
      valuedCents += BigInt(quantity) * BigInt(cost);
    }
    return {
      ...row,
      quantity,
      valueCents: cost === null ? null : String(quantity * cost),
    };
  });

  /*
   * Stock that exists without a lot is real stock on the shelf, so it is not
   * hidden. It cannot be valued at a batch cost, so it is reported separately
   * and excluded from the total instead of being priced at zero.
   */
  const unbatched = await pool.query(
    `SELECT i.id, i.item_code AS "itemCode", i.name, i.current_stock AS "currentStock",
            COALESCE(SUM(b.quantity_remaining), 0)::int AS "batchQuantity"
       FROM inventory_items i
       LEFT JOIN inventory_batches b ON b.item_id = i.id
      WHERE i.facility_id = $1 AND i.is_active = TRUE
      GROUP BY i.id
     HAVING COALESCE(i.current_stock, 0) <> COALESCE(SUM(b.quantity_remaining), 0)`,
    [scope.facilityId],
  );

  const byCategory = new Map<string, { category: string; quantity: number; valueCents: bigint }>();
  for (const batch of batches) {
    const key = batch.category ?? 'Uncategorised';
    const current = byCategory.get(key) ?? { category: key, quantity: 0, valueCents: 0n };
    current.quantity += batch.quantity;
    if (batch.valueCents !== null) current.valueCents += BigInt(batch.valueCents);
    byCategory.set(key, current);
  }

  return {
    batches,
    categories: [...byCategory.values()].map((row) => ({
      category: row.category,
      quantity: row.quantity,
      valueKes: (Number(row.valueCents) / 100).toFixed(2),
    })),
    totalKes: (Number(valuedCents) / 100).toFixed(2),
    unvaluedBatches,
    unvaluedQuantity,
    batchReconciliation: unbatched.rows.map((row) => ({
      itemId: Number(row.id),
      itemCode: row.itemCode,
      itemName: row.name,
      currentStock: Number(row.currentStock ?? 0),
      batchQuantity: Number(row.batchQuantity ?? 0),
      difference: Number(row.currentStock ?? 0) - Number(row.batchQuantity ?? 0),
    })),
    note: 'Valued at the batch cost recorded when the stock was received. Batches without a recorded cost are counted but not valued.',
  };
}

/** Items at or below their reorder level, for the replenishment list. */
export async function getReorderAlerts(scope: StockScope) {
  return db
    .select({
      id: schema.inventoryItems.id,
      itemCode: schema.inventoryItems.itemCode,
      name: schema.inventoryItems.name,
      unit: schema.inventoryItems.unit,
      currentStock: schema.inventoryItems.currentStock,
      reorderLevel: schema.inventoryItems.reorderLevel,
      storeLocation: schema.inventoryItems.storeLocation,
    })
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.facilityId, scope.facilityId),
        eq(schema.inventoryItems.isActive, true),
        sql`COALESCE(${schema.inventoryItems.currentStock}, 0) <= COALESCE(${schema.inventoryItems.reorderLevel}, 0)`,
      ),
    )
    .orderBy(asc(schema.inventoryItems.name))
    .limit(200);
}

export async function updateReorderLevel(
  scope: StockScope,
  itemId: number,
  body: Record<string, unknown>,
) {
  const reorderLevel = nonNegativeInt(body.reorderLevel, 'Reorder level');
  const item = await loadItem(db as unknown as TxForStock, scope, itemId);
  await db
    .update(schema.inventoryItems)
    .set({ reorderLevel, updatedAt: new Date() })
    .where(eq(schema.inventoryItems.id, item.id));
  await db.insert(schema.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: String(scope.actorId),
    resource: 'InventoryItem',
    resourceId: String(item.id),
    action: 'UPDATE',
    details: `Reorder level changed from ${item.reorderLevel} to ${reorderLevel}.`,
  });
  return { itemId: item.id, reorderLevel };
}
