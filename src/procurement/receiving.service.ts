/**
 * JaliCare HMIS — goods receiving and accounts payable.
 *
 * The chain implemented here is:
 *
 *   approved purchase order → goods received note (stock actually arrives)
 *   → supplier invoice (AP credited, expense debited) → supplier payment
 *   (AP debited, bank credited).
 *
 * Integrity rules:
 *
 *  - a note may never receive more than the quantity still outstanding on the
 *    purchase order line, and only for an order in an approved/receiving state;
 *  - stock movements and the note commit in one transaction, so a note cannot
 *    exist without the stock it claims, or the reverse;
 *  - the invoice is posted through the general ledger's own
 *    `postInsideTransaction`, inside the same transaction as the invoice row;
 *  - a payment can never exceed the invoice balance, and pays the AP account
 *    that the invoice credited;
 *  - every write is idempotent on a caller-supplied key.
 */

import { createHash } from 'node:crypto';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';

import {
  postInsideTransaction,
  type AccountingScope,
  type JournalLine,
} from '../accounting/accounting.service.ts';
import { db, pool } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import {
  linkMovementToJournal,
  postSupplierInvoiceClearing,
  lockFacilityForStockMutation,
  postStockReceipt,
  recordMovementAllocations,
} from '../inventory/inventory-accounting.service.ts';
import { assertPayable, matchSupplierInvoice } from './matching.service.ts';
import { optionalOrderText } from './order-items.ts';

export type ReceivingScope = {
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

export class ReceivingError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReceivingError';
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new ReceivingError(statusCode, code, message);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Orders in these states may still receive goods. */
const RECEIVABLE_STATUSES = ['Approved', 'Partially Received', 'Ordered', 'In Transit'];
const TERMINAL_ORDER_STATUSES = ['Cancelled', 'Rejected', 'Pending Approval'];

function accountingScope(scope: ReceivingScope): AccountingScope {
  return {
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    actorUserId: scope.actorId,
  };
}
function isoDate(value: unknown, label: string): string {
  const raw = String(value ?? '').trim();
  if (!ISO_DATE.test(raw)) fail(400, 'INVALID_INPUT', `${label} must be YYYY-MM-DD.`);
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw)
    fail(400, 'INVALID_INPUT', `${label} must be a real calendar date.`);
  return raw;
}
function positiveNumber(value: unknown, label: string, max = 1_000_000): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max)
    fail(400, 'INVALID_INPUT', `${label} must be greater than zero.`);
  return parsed;
}
function nonNegativeMoney(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000_000)
    fail(400, 'INVALID_INPUT', `${label} must be a non-negative amount.`);
  return Math.round(parsed * 100) / 100;
}
function positiveInt(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    fail(400, 'INVALID_INPUT', `${label} must be a positive whole number.`);
  return parsed;
}
function money(cents: bigint): string {
  return (Number(cents) / 100).toFixed(2);
}
function cents(value: string | number | null | undefined): bigint {
  return BigInt(Math.round(Number(value ?? 0) * 100));
}
function hash(value: unknown): string {
  // Request bodies carry integer-cent BigInts, which JSON.stringify refuses.
  return createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)),
    )
    .digest('hex');
}

/* ------------------------------------------------------------------ reads */

export async function listGoodsReceivedNotes(scope: ReceivingScope, orderId?: number) {
  const conditions = [
    eq(schema.goodsReceivedNotes.tenantId, scope.tenantId),
    eq(schema.goodsReceivedNotes.facilityId, scope.facilityId),
  ];
  if (orderId) conditions.push(eq(schema.goodsReceivedNotes.purchaseOrderId, orderId));
  const notes = await db
    .select()
    .from(schema.goodsReceivedNotes)
    .where(and(...conditions))
    .orderBy(desc(schema.goodsReceivedNotes.id))
    .limit(100);
  const ids = notes.map((note) => note.id);
  const items = ids.length
    ? await db
        .select()
        .from(schema.goodsReceivedNoteItems)
        .where(inArray(schema.goodsReceivedNoteItems.goodsReceivedNoteId, ids))
        .orderBy(asc(schema.goodsReceivedNoteItems.id))
    : [];
  const invoices = ids.length
    ? await db
        .select({
          id: schema.supplierInvoices.id,
          goodsReceivedNoteId: schema.supplierInvoices.goodsReceivedNoteId,
          invoiceNumber: schema.supplierInvoices.invoiceNumber,
          status: schema.supplierInvoices.status,
        })
        .from(schema.supplierInvoices)
        .where(inArray(schema.supplierInvoices.goodsReceivedNoteId, ids))
    : [];
  return notes.map((note) => ({
    ...note,
    items: items.filter((item) => item.goodsReceivedNoteId === note.id),
    invoice: invoices.find((invoice) => invoice.goodsReceivedNoteId === note.id) ?? null,
  }));
}

/** Outstanding quantities per purchase order line, used by the receiving form. */
export async function outstandingOrderLines(scope: ReceivingScope, orderId: number) {
  const [order] = await db
    .select()
    .from(schema.purchaseOrders)
    .where(
      and(
        eq(schema.purchaseOrders.id, orderId),
        eq(schema.purchaseOrders.tenantId, scope.tenantId),
        eq(schema.purchaseOrders.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!order) fail(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found.');

  const lines = await db
    .select()
    .from(schema.purchaseOrderItems)
    .where(eq(schema.purchaseOrderItems.purchaseOrderId, orderId))
    .orderBy(asc(schema.purchaseOrderItems.lineNumber));
  const received = await db
    .select({
      purchaseOrderItemId: schema.goodsReceivedNoteItems.purchaseOrderItemId,
      quantity: sql<string>`sum(${schema.goodsReceivedNoteItems.quantityReceived})`,
    })
    .from(schema.goodsReceivedNoteItems)
    .innerJoin(
      schema.goodsReceivedNotes,
      eq(schema.goodsReceivedNotes.id, schema.goodsReceivedNoteItems.goodsReceivedNoteId),
    )
    .where(
      and(
        eq(schema.goodsReceivedNotes.purchaseOrderId, orderId),
        eq(schema.goodsReceivedNotes.status, 'POSTED'),
      ),
    )
    .groupBy(schema.goodsReceivedNoteItems.purchaseOrderItemId);

  return {
    order,
    lines: lines.map((line) => {
      const already = Number(
        received.find((r) => r.purchaseOrderItemId === line.id)?.quantity ?? 0,
      );
      const ordered = Number(line.quantity);
      return {
        ...line,
        receivedQuantity: already,
        outstandingQuantity: Math.max(0, Math.round((ordered - already) * 1000) / 1000),
      };
    }),
  };
}

/* ------------------------------------------------------------ goods receipt */

export async function postGoodsReceivedNote(scope: ReceivingScope, body: Record<string, unknown>) {
  const orderId = positiveInt(body.purchaseOrderId, 'Purchase order');
  const grnNumber = optionalOrderText(body.grnNumber, 'GRN number', 40);
  if (!grnNumber) fail(400, 'INVALID_INPUT', 'A GRN number is required.');
  const receivedDate = isoDate(body.receivedDate, 'Received date');
  const idempotencyKey = optionalOrderText(body.idempotencyKey, 'Idempotency key', 120);
  if (!idempotencyKey) fail(400, 'INVALID_INPUT', 'An idempotency key is required.');
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) fail(400, 'INVALID_INPUT', 'Record at least one received line.');

  const lines = rawLines.map((entry, index) => {
    const line = (entry ?? {}) as Record<string, unknown>;
    const inventoryItemId =
      line.inventoryItemId === undefined ||
      line.inventoryItemId === null ||
      line.inventoryItemId === ''
        ? null
        : positiveInt(line.inventoryItemId, `Line ${index + 1} stock item`);
    const quantity =
      Math.round(positiveNumber(line.quantityReceived, `Line ${index + 1} quantity`) * 1000) / 1000;
    const unitCost = nonNegativeMoney(line.unitCost, `Line ${index + 1} unit cost`);
    const batchNumber = optionalOrderText(line.batchNumber, `Line ${index + 1} batch`, 64);
    const expiryDate =
      line.expiryDate === undefined || line.expiryDate === null || line.expiryDate === ''
        ? null
        : isoDate(line.expiryDate, `Line ${index + 1} expiry`);
    if (inventoryItemId && (!batchNumber || !expiryDate))
      fail(
        400,
        'BATCH_EVIDENCE_REQUIRED',
        `Line ${index + 1} adds stock, so it needs a batch number and expiry date.`,
      );
    return {
      purchaseOrderItemId: positiveInt(line.purchaseOrderItemId, `Line ${index + 1} order line`),
      inventoryItemId,
      quantity,
      unitCost,
      batchNumber,
      expiryDate,
      lineTotalCents: BigInt(Math.round(quantity * unitCost * 100)),
    };
  });

  const requestHash = hash({ orderId, grnNumber, receivedDate, lines });
  const accountingScope = {
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    actorUserId: scope.actorId,
  };

  const result = await withTx(async (tx, client) => {
    /* Shared lock: an opening balance cannot be posted underneath this receipt. */
    await lockFacilityForStockMutation(tx, scope.facilityId);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', [
      `procurement-grn:${scope.facilityId}:${idempotencyKey}`,
      scope.facilityId,
    ]);
    const [prior] = await tx
      .select()
      .from(schema.goodsReceivedNotes)
      .where(
        and(
          eq(schema.goodsReceivedNotes.facilityId, scope.facilityId),
          eq(schema.goodsReceivedNotes.grnNumber, grnNumber),
        ),
      )
      .limit(1);
    if (prior) {
      if (prior.status === 'REVERSED')
        fail(409, 'GRN_REVERSED', 'This goods received note was reversed; raise a new one.');
      return { id: prior.id, replayed: true, requestHash };
    }

    const [order] = await tx
      .select()
      .from(schema.purchaseOrders)
      .where(
        and(
          eq(schema.purchaseOrders.id, orderId),
          eq(schema.purchaseOrders.tenantId, scope.tenantId),
          eq(schema.purchaseOrders.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!order) fail(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found.');
    if (TERMINAL_ORDER_STATUSES.includes(order.status ?? ''))
      fail(
        409,
        'PURCHASE_ORDER_NOT_RECEIVABLE',
        `A ${order.status} order cannot receive goods. Approve it first.`,
      );
    if (!RECEIVABLE_STATUSES.includes(order.status ?? ''))
      fail(
        409,
        'PURCHASE_ORDER_NOT_RECEIVABLE',
        `A ${order.status} order cannot receive goods yet.`,
      );

    const orderLines = await tx
      .select()
      .from(schema.purchaseOrderItems)
      .where(eq(schema.purchaseOrderItems.purchaseOrderId, orderId));
    const byId = new Map(orderLines.map((line) => [line.id, line]));

    for (const line of lines) {
      const ordered = byId.get(line.purchaseOrderItemId);
      if (!ordered || ordered.isActive === false)
        fail(400, 'ORDER_LINE_NOT_FOUND', 'A received line does not belong to this order.');
      const [received] = await tx
        .select({
          quantity: sql<string>`COALESCE(SUM(${schema.goodsReceivedNoteItems.quantityReceived}), 0)`,
        })
        .from(schema.goodsReceivedNoteItems)
        .innerJoin(
          schema.goodsReceivedNotes,
          eq(schema.goodsReceivedNotes.id, schema.goodsReceivedNoteItems.goodsReceivedNoteId),
        )
        .where(
          and(
            eq(schema.goodsReceivedNoteItems.purchaseOrderItemId, line.purchaseOrderItemId),
            eq(schema.goodsReceivedNotes.status, 'POSTED'),
          ),
        );
      const outstanding =
        Math.round((Number(ordered.quantity) - Number(received.quantity)) * 1000) / 1000;
      if (line.quantity > outstanding + 1e-9)
        fail(
          409,
          'OVER_RECEIPT',
          `Line "${ordered.description}" has ${outstanding} outstanding; ${line.quantity} cannot be received.`,
        );
    }

    const totalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0n);
    const [note] = await tx
      .insert(schema.goodsReceivedNotes)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        grnNumber,
        purchaseOrderId: orderId,
        supplierId: order.supplierId,
        receivedDate,
        receivedByUserId: scope.actorId,
        receivedByName: scope.actorName,
        status: 'POSTED',
        inventoryValueKes: money(totalCents),
        notes: optionalOrderText(body.notes, 'Notes', 500),
      })
      .returning();

    /* The note is one economic event, so it earns one journal; the value is
       accumulated across lines rather than posted piecemeal. */
    let receivedValueCents = 0n;
    const receivedMovementIds: number[] = [];

    for (const line of lines) {
      const ordered = byId.get(line.purchaseOrderItemId)!;
      let batchId: number | null = null;
      if (line.inventoryItemId) {
        // Lock the item first: receiving and dispensing both change stock on
        // hand, and the same lock order keeps them from deadlocking.
        const [item] = await tx
          .select({
            id: schema.inventoryItems.id,
            name: schema.inventoryItems.name,
            currentStock: schema.inventoryItems.currentStock,
          })
          .from(schema.inventoryItems)
          .where(
            and(
              eq(schema.inventoryItems.id, line.inventoryItemId),
              eq(schema.inventoryItems.facilityId, scope.facilityId),
            ),
          )
          .limit(1)
          .for('update');
        if (!item)
          fail(
            404,
            'STOCK_ITEM_NOT_FOUND',
            'A received stock item does not belong to this facility.',
          );

        const [existing] = await tx
          .select()
          .from(schema.inventoryBatches)
          .where(
            and(
              eq(schema.inventoryBatches.itemId, line.inventoryItemId),
              eq(schema.inventoryBatches.batchNumber, line.batchNumber!),
            ),
          )
          .limit(1)
          .for('update');
        if (existing && existing.expiryDate !== line.expiryDate)
          fail(
            409,
            'BATCH_EXPIRY_MISMATCH',
            'This batch number already has a different expiry date. Review the physical lot.',
          );
        if (existing && cents(existing.costPerUnit) !== cents(line.unitCost))
          fail(
            409,
            'BATCH_COST_MISMATCH',
            'This lot already has a different unit cost. Review the receipt rather than restating earlier stock value.',
          );
        if (existing) {
          const quantity = Math.floor(line.quantity);
          if (line.quantity !== quantity)
            fail(
              400,
              'FRACTIONAL_STOCK_QUANTITY',
              'Stock-tracked lines must be whole units because the batch ledger counts units.',
            );
          await tx
            .update(schema.inventoryBatches)
            .set({
              quantityRemaining: sql`${schema.inventoryBatches.quantityRemaining} + ${quantity}`,
            })
            .where(eq(schema.inventoryBatches.id, existing.id));
          batchId = existing.id;
        } else {
          const quantity = Math.floor(line.quantity);
          if (line.quantity !== quantity)
            fail(
              400,
              'FRACTIONAL_STOCK_QUANTITY',
              'Stock-tracked lines must be whole units because the batch ledger counts units.',
            );
          const [batch] = await tx
            .insert(schema.inventoryBatches)
            .values({
              itemId: line.inventoryItemId,
              batchNumber: line.batchNumber!,
              expiryDate: line.expiryDate!,
              quantityRemaining: quantity,
              costPerUnit: line.unitCost.toFixed(2),
            })
            .returning({ id: schema.inventoryBatches.id });
          batchId = batch.id;
        }

        /*
         * Goods received are stock on hand, not just a lot row. The item total
         * and the ledger move with the batch inside this same transaction, so
         * a posted note can never leave the shelf unexplained. The GRN line is
         * the ledger reference, and the unique index on
         * (facility, reference_type, reference_id, movement_type) refuses a
         * second RECEIPT for the same line.
         */
        const stockQuantity = Math.floor(line.quantity);
        const [updatedItem] = await tx
          .update(schema.inventoryItems)
          .set({
            currentStock: sql`COALESCE(${schema.inventoryItems.currentStock}, 0) + ${stockQuantity}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.inventoryItems.id, line.inventoryItemId),
              eq(schema.inventoryItems.facilityId, scope.facilityId),
              sql`COALESCE(${schema.inventoryItems.currentStock}, 0) <= ${2_147_483_647 - stockQuantity}`,
            ),
          )
          .returning({ currentStock: schema.inventoryItems.currentStock });
        if (!updatedItem)
          fail(
            409,
            'STOCK_RECONCILIATION_REQUIRED',
            'Recorded stock for a received item is invalid; review it before posting this note.',
          );

        const [movement] = await tx
          .insert(schema.inventoryMovements)
          .values({
            tenantId: scope.tenantId,
            facilityId: scope.facilityId,
            itemId: line.inventoryItemId,
            batchId,
            movementType: 'RECEIPT',
            quantityDelta: stockQuantity,
            stockAfter: updatedItem.currentStock ?? stockQuantity,
            reasonCode: 'GOODS_RECEIVED',
            referenceType: 'GOODS_RECEIVED_NOTE',
            referenceId: `${note.id}:${line.purchaseOrderItemId}`,
            notes: `Received against ${grnNumber}.`,
            actorUserId: scope.actorId,
            actorName: scope.actorName,
            movementDate: receivedDate,
          })
          .returning({ id: schema.inventoryMovements.id });

        /*
         * Preserve the lot cost so a later issue, write-off or count variance
         * can be valued without guessing, then post the receipt. The value is
         * the cost of the units that actually entered stock: quantities are
         * held as whole units, so a fractional line stocks only its whole part
         * and the remainder never sits on the shelf. Posting the full line
         * total here would value stock the facility does not hold.
         */
        const stockUnitCostCents = Math.round(line.unitCost * 100);
        if (batchId !== null) {
          await recordMovementAllocations(client, accountingScope, movement.id, [
            { batchId, quantity: stockQuantity, unitCostCents: stockUnitCostCents },
          ]);
        }
        receivedValueCents += BigInt(stockQuantity) * BigInt(stockUnitCostCents);
        receivedMovementIds.push(movement.id);
      }

      await tx.insert(schema.goodsReceivedNoteItems).values({
        goodsReceivedNoteId: note.id,
        purchaseOrderItemId: line.purchaseOrderItemId,
        inventoryItemId: line.inventoryItemId,
        description: ordered.description,
        quantityReceived: line.quantity.toFixed(3),
        unitCost: line.unitCost.toFixed(2),
        lineTotal: money(line.lineTotalCents),
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        inventoryBatchId: batchId,
      });
    }

    /*
     * One journal for the note. A facility on the expense basis, or one with
     * no policy at all, posts nothing here and the call returns null — the
     * procurement flow is unchanged for every facility that has not opted in.
     */
    const receiptJournalId = await postStockReceipt(client, accountingScope, {
      grnId: note.id,
      grnNumber,
      entryDate: receivedDate,
      valueCents: receivedValueCents,
    });
    if (receiptJournalId !== null) {
      for (const movementId of receivedMovementIds) {
        await linkMovementToJournal(client, accountingScope, movementId, receiptJournalId);
      }
    }

    const after = await tx
      .select({
        purchaseOrderItemId: schema.goodsReceivedNoteItems.purchaseOrderItemId,
        quantity: sql<string>`SUM(${schema.goodsReceivedNoteItems.quantityReceived})`,
      })
      .from(schema.goodsReceivedNoteItems)
      .innerJoin(
        schema.goodsReceivedNotes,
        eq(schema.goodsReceivedNotes.id, schema.goodsReceivedNoteItems.goodsReceivedNoteId),
      )
      .where(
        and(
          eq(schema.goodsReceivedNotes.purchaseOrderId, orderId),
          eq(schema.goodsReceivedNotes.status, 'POSTED'),
        ),
      )
      .groupBy(schema.goodsReceivedNoteItems.purchaseOrderItemId);
    const fullyReceived = orderLines.every((line) => {
      const total = Number(after.find((row) => row.purchaseOrderItemId === line.id)?.quantity ?? 0);
      return total + 1e-9 >= Number(line.quantity);
    });
    const nextStatus = fullyReceived ? 'Received' : 'Partially Received';
    await tx
      .update(schema.purchaseOrders)
      .set({ status: nextStatus, revision: sql`${schema.purchaseOrders.revision} + 1` })
      .where(eq(schema.purchaseOrders.id, orderId));
    await tx.insert(schema.purchaseOrderEvents).values({
      purchaseOrderId: orderId,
      eventType: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
      fromStatus: order.status,
      toStatus: nextStatus,
      actorUserId: scope.actorId,
      note: grnNumber,
      details: { goodsReceivedNoteId: note.id },
    });
    await tx.insert(schema.auditLogs).values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      userId: String(scope.actorId),
      resource: 'GoodsReceivedNote',
      resourceId: String(note.id),
      action: 'POST',
      details: `Goods received note ${grnNumber} posted for purchase order ${order.poNumber}.`,
    });

    return { id: note.id, replayed: false, requestHash, status: nextStatus };
  });

  return {
    ...result,
    note: await getGoodsReceivedNote(scope, result.id),
  };
}

export async function getGoodsReceivedNote(scope: ReceivingScope, id: number) {
  const [note] = await db
    .select()
    .from(schema.goodsReceivedNotes)
    .where(
      and(
        eq(schema.goodsReceivedNotes.id, id),
        eq(schema.goodsReceivedNotes.tenantId, scope.tenantId),
        eq(schema.goodsReceivedNotes.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!note) fail(404, 'GRN_NOT_FOUND', 'Goods received note not found.');
  const items = await db
    .select()
    .from(schema.goodsReceivedNoteItems)
    .where(eq(schema.goodsReceivedNoteItems.goodsReceivedNoteId, id))
    .orderBy(asc(schema.goodsReceivedNoteItems.id));
  const [invoice] = await db
    .select()
    .from(schema.supplierInvoices)
    .where(eq(schema.supplierInvoices.goodsReceivedNoteId, id))
    .limit(1);
  return { ...note, items, invoice: invoice ?? null };
}

/* ------------------------------------------------------------ AP invoices */

export async function createSupplierInvoice(scope: ReceivingScope, body: Record<string, unknown>) {
  const grnId = positiveInt(body.goodsReceivedNoteId, 'Goods received note');
  const invoiceNumber = optionalOrderText(body.invoiceNumber, 'Invoice number', 64);
  if (!invoiceNumber) fail(400, 'INVALID_INPUT', 'An invoice number is required.');
  const invoiceDate = isoDate(body.invoiceDate, 'Invoice date');
  const dueDate =
    body.dueDate === undefined || body.dueDate === null || body.dueDate === ''
      ? null
      : isoDate(body.dueDate, 'Due date');
  const expenseAccountId = positiveInt(body.expenseAccountId, 'Expense account');
  const apAccountId = positiveInt(body.apAccountId, 'Accounts payable account');
  const taxCents = BigInt(Math.round(nonNegativeMoney(body.taxAmount ?? 0, 'Tax') * 100));
  const idempotencyKey = optionalOrderText(body.idempotencyKey, 'Idempotency key', 120);
  if (!idempotencyKey) fail(400, 'INVALID_INPUT', 'An idempotency key is required.');
  const entryDate = isoDate(body.entryDate ?? invoiceDate, 'Posting date');

  const created = await withTx(async (tx, client) => {
    const [note] = await tx
      .select()
      .from(schema.goodsReceivedNotes)
      .where(
        and(
          eq(schema.goodsReceivedNotes.id, grnId),
          eq(schema.goodsReceivedNotes.tenantId, scope.tenantId),
          eq(schema.goodsReceivedNotes.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!note) fail(404, 'GRN_NOT_FOUND', 'Goods received note not found.');
    if (note.status !== 'POSTED')
      fail(409, 'GRN_NOT_POSTED', 'Only a posted note can be invoiced.');
    const [existing] = await tx
      .select()
      .from(schema.supplierInvoices)
      .where(eq(schema.supplierInvoices.goodsReceivedNoteId, grnId))
      .limit(1);
    if (existing) {
      if (existing.idempotencyKey !== idempotencyKey)
        fail(
          409,
          'GRN_ALREADY_INVOICED',
          `This note is already invoiced as ${existing.invoiceNumber}.`,
        );
      return { invoiceId: existing.id, replayed: true };
    }

    const subtotalCents = cents(note.inventoryValueKes);
    const totalCents = subtotalCents + taxCents;
    if (totalCents <= 0n) fail(400, 'INVALID_INPUT', 'An invoice must have a positive total.');

    /*
     * Two invoices from one supplier sharing a number is how a duplicate
     * payment starts. The unique index enforces it, but on its own it surfaces
     * as an opaque driver error, so the conflict is named here first. The
     * check is repeated after the insert race below through the index itself.
     */
    const [sameNumber] = await tx
      .select({ id: schema.supplierInvoices.id })
      .from(schema.supplierInvoices)
      .where(
        and(
          eq(schema.supplierInvoices.facilityId, scope.facilityId),
          eq(schema.supplierInvoices.supplierId, note.supplierId),
          eq(schema.supplierInvoices.invoiceNumber, invoiceNumber),
        ),
      )
      .limit(1);
    if (sameNumber)
      fail(
        409,
        'INVOICE_NUMBER_IN_USE',
        `This supplier already has an invoice numbered ${invoiceNumber}.`,
      );

    const idempotency = `supplier-invoice:${scope.facilityId}:${idempotencyKey}`;

    /*
     * On the perpetual basis the receipt already expensed nothing and debited
     * stock, so the invoice clears the receipt instead of charging the expense
     * a second time. On the default basis this returns null and the original
     * expense posting below runs unchanged.
     */
    const clearingJournalId = await postSupplierInvoiceClearing(client, accountingScope(scope), {
      grnId,
      invoiceNumber,
      entryDate,
      grnNumber: note.grnNumber,
      subtotalCents,
      taxCents,
      taxRecoverable: body.taxRecoverable === true,
      payableAccountId: apAccountId,
      fallbackExpenseAccountId: expenseAccountId,
    });

    let journal: { journal: { id: number } };
    if (clearingJournalId !== null) {
      journal = { journal: { id: clearingJournalId } };
    } else {
      const lines: JournalLine[] = [
        {
          accountId: expenseAccountId,
          debitCents: subtotalCents,
          creditCents: 0n,
          description: `Stock received on ${note.grnNumber}`,
          serviceLine: null,
        },
        {
          accountId: apAccountId,
          debitCents: 0n,
          creditCents: totalCents,
          description: `Supplier invoice ${invoiceNumber}`,
          serviceLine: null,
        },
      ];
      if (taxCents > 0n)
        lines.splice(1, 0, {
          accountId: expenseAccountId,
          debitCents: taxCents,
          creditCents: 0n,
          description: `Tax on ${invoiceNumber}`,
          serviceLine: null,
        });
      journal = await postInsideTransaction(client, accountingScope(scope), {
        entryDate,
        description: `Supplier invoice ${invoiceNumber}`,
        sourceType: 'PROCUREMENT',
        sourceId: `grn:${grnId}`,
        idempotencyKey: idempotency,
        totalCents,
        lines,
      });
    }

    const [invoice] = await tx
      .insert(schema.supplierInvoices)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        supplierId: note.supplierId,
        purchaseOrderId: note.purchaseOrderId,
        goodsReceivedNoteId: grnId,
        invoiceNumber,
        invoiceDate,
        dueDate,
        expenseAccountId,
        apAccountId,
        subtotalKes: money(subtotalCents),
        taxKes: money(taxCents),
        totalAmountKes: money(totalCents),
        paidAmountKes: '0.00',
        balanceKes: money(totalCents),
        status: 'POSTED',
        postedJournalId: journal.journal.id,
        idempotencyKey,
        notes: optionalOrderText(body.notes, 'Notes', 500),
        createdByUserId: scope.actorId,
      })
      .returning();

    await tx.insert(schema.auditLogs).values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      userId: String(scope.actorId),
      resource: 'SupplierInvoice',
      resourceId: String(invoice.id),
      action: 'POST',
      details: `Supplier invoice ${invoiceNumber} posted against goods received note ${note.grnNumber}.`,
    });

    /*
     * Compare the invoice with the order and the receipt in the same
     * transaction, so an invoice never exists without a verdict. A variance
     * does not block the posting — the supplier has billed, and the liability
     * is real — but it does block payment until someone accepts it.
     */
    const match = await matchSupplierInvoice(
      {
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        supplierInvoiceId: invoice.id,
        toleranceCents: Number.isFinite(Number(body.tolerance))
          ? Math.max(0, Math.round(Number(body.tolerance) * 100))
          : 0,
        checkedByUserId: scope.actorId,
      },
      client as unknown as {
        query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
      },
    );

    return {
      invoiceId: invoice.id,
      replayed: false,
      journalId: journal.journal.id,
      match: { status: match.status, findings: match.findings },
    };
  });

  return { ...created, invoice: await getSupplierInvoice(scope, created.invoiceId) };
}

export async function listSupplierInvoices(scope: ReceivingScope, status?: string) {
  const conditions = [
    eq(schema.supplierInvoices.tenantId, scope.tenantId),
    eq(schema.supplierInvoices.facilityId, scope.facilityId),
  ];
  if (status && ['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(status))
    conditions.push(eq(schema.supplierInvoices.status, status));
  const rows = await db
    .select({
      invoice: schema.supplierInvoices,
      supplierName: schema.suppliers.name,
    })
    .from(schema.supplierInvoices)
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.supplierInvoices.supplierId))
    .where(and(...conditions))
    .orderBy(desc(schema.supplierInvoices.id))
    .limit(200);
  const ids = rows.map((row) => row.invoice.id);
  const payments = ids.length
    ? await db
        .select()
        .from(schema.supplierPayments)
        .where(inArray(schema.supplierPayments.supplierInvoiceId, ids))
        .orderBy(desc(schema.supplierPayments.id))
    : [];
  return rows.map((row) => ({
    ...row.invoice,
    supplierName: row.supplierName,
    payments: payments.filter((payment) => payment.supplierInvoiceId === row.invoice.id),
  }));
}

export async function getSupplierInvoice(scope: ReceivingScope, id: number) {
  const [row] = await db
    .select({ invoice: schema.supplierInvoices, supplierName: schema.suppliers.name })
    .from(schema.supplierInvoices)
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.supplierInvoices.supplierId))
    .where(
      and(
        eq(schema.supplierInvoices.id, id),
        eq(schema.supplierInvoices.tenantId, scope.tenantId),
        eq(schema.supplierInvoices.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!row) fail(404, 'SUPPLIER_INVOICE_NOT_FOUND', 'Supplier invoice not found.');
  const payments = await db
    .select()
    .from(schema.supplierPayments)
    .where(eq(schema.supplierPayments.supplierInvoiceId, id))
    .orderBy(asc(schema.supplierPayments.id));
  return { ...row.invoice, supplierName: row.supplierName, payments };
}

/* ---------------------------------------------------------------- payments */

export async function paySupplierInvoice(
  scope: ReceivingScope,
  id: number,
  body: Record<string, unknown>,
) {
  const amountCents = BigInt(Math.round(positiveNumber(body.amount, 'Payment amount') * 100));
  const paymentDate = isoDate(body.paymentDate, 'Payment date');
  const bankAccountId = positiveInt(body.bankAccountId, 'Bank account');
  const idempotencyKey = optionalOrderText(body.idempotencyKey, 'Idempotency key', 120);
  if (!idempotencyKey) fail(400, 'INVALID_INPUT', 'An idempotency key is required.');
  const paymentMethod = (
    optionalOrderText(body.paymentMethod, 'Payment method', 32) || 'BANK'
  ).toUpperCase();
  if (!['BANK', 'CHEQUE', 'CASH', 'MPESA'].includes(paymentMethod))
    fail(400, 'INVALID_INPUT', 'Payment method must be BANK, CHEQUE, CASH or MPESA.');

  const result = await withTx(async (tx, client) => {
    const [invoice] = await tx
      .select()
      .from(schema.supplierInvoices)
      .where(
        and(
          eq(schema.supplierInvoices.id, id),
          eq(schema.supplierInvoices.tenantId, scope.tenantId),
          eq(schema.supplierInvoices.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!invoice) fail(404, 'SUPPLIER_INVOICE_NOT_FOUND', 'Supplier invoice not found.');

    const [prior] = await tx
      .select()
      .from(schema.supplierPayments)
      .where(
        and(
          eq(schema.supplierPayments.facilityId, scope.facilityId),
          eq(schema.supplierPayments.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (prior) {
      if (prior.supplierInvoiceId !== id)
        fail(409, 'IDEMPOTENCY_CONFLICT', 'This payment key was used for a different invoice.');
      return { paymentId: prior.id, replayed: true };
    }

    /*
     * The control this whole batch exists for. An invoice is payable only when
     * the order, the receipt and the invoice agreed — or when a named user
     * accepted the difference in writing. An unmatched invoice is not
     * "probably fine": it was never compared.
     */
    await assertPayable(
      client as unknown as {
        query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
      },
      { tenantId: scope.tenantId, facilityId: scope.facilityId },
      id,
    );

    const balance = cents(invoice.balanceKes);
    if (amountCents > balance)
      fail(
        409,
        'PAYMENT_EXCEEDS_BALANCE',
        `The invoice balance is KES ${money(balance)}; a larger payment cannot be posted.`,
      );

    const [bank] = await tx
      .select()
      .from(schema.bankAccounts)
      .where(
        and(
          eq(schema.bankAccounts.id, bankAccountId),
          eq(schema.bankAccounts.tenantId, scope.tenantId),
          eq(schema.bankAccounts.facilityId, scope.facilityId),
          eq(schema.bankAccounts.isActive, true),
        ),
      )
      .limit(1);
    if (!bank) fail(404, 'BANK_ACCOUNT_NOT_FOUND', 'Bank account not found for this facility.');

    const paymentNumber =
      `SP-${invoice.invoiceNumber}-${Date.now().toString(36).toUpperCase()}`.slice(0, 48);

    // Insert the payment first. The ledger allows exactly one journal per
    // (facility, source type, source id), so each payment must use its own id
    // as the source; reusing the invoice id would refuse every second payment.
    const [payment] = await tx
      .insert(schema.supplierPayments)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        supplierInvoiceId: id,
        supplierId: invoice.supplierId,
        paymentNumber,
        paymentDate,
        paymentMethod,
        bankAccountId,
        paymentReference: optionalOrderText(body.paymentReference, 'Payment reference', 120),
        amountKes: money(amountCents),
        idempotencyKey,
        recordedByUserId: scope.actorId,
      })
      .returning();

    const journal = await postInsideTransaction(client, accountingScope(scope), {
      entryDate: paymentDate,
      description: `Supplier payment ${paymentNumber} for ${invoice.invoiceNumber}`,
      sourceType: 'PROCUREMENT',
      sourceId: `supplier-payment:${payment.id}`,
      idempotencyKey: `supplier-payment:${scope.facilityId}:${idempotencyKey}`,
      totalCents: amountCents,
      lines: [
        {
          accountId: invoice.apAccountId,
          debitCents: amountCents,
          creditCents: 0n,
          description: `Payment ${paymentNumber}`,
          serviceLine: null,
        },
        {
          accountId: bank.glAccountId,
          debitCents: 0n,
          creditCents: amountCents,
          description: `Payment ${paymentNumber}`,
          serviceLine: null,
        },
      ],
    });

    await tx
      .update(schema.supplierPayments)
      .set({ postedJournalId: journal.journal.id })
      .where(eq(schema.supplierPayments.id, payment.id));

    const paidCents = cents(invoice.paidAmountKes) + amountCents;
    const newBalance = cents(invoice.totalAmountKes) - paidCents;
    await tx
      .update(schema.supplierInvoices)
      .set({
        paidAmountKes: money(paidCents),
        balanceKes: money(newBalance),
        status: newBalance === 0n ? 'PAID' : 'PARTIALLY_PAID',
      })
      .where(eq(schema.supplierInvoices.id, id));

    await tx.insert(schema.auditLogs).values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      userId: String(scope.actorId),
      resource: 'SupplierPayment',
      resourceId: String(payment.id),
      action: 'POST',
      details: `Payment ${paymentNumber} of KES ${money(amountCents)} for invoice ${invoice.invoiceNumber}.`,
    });

    return { paymentId: payment.id, replayed: false, journalId: journal.journal.id };
  });

  return { ...result, invoice: await getSupplierInvoice(scope, id) };
}
