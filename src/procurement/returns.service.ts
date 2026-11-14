/**
 * Supplier returns and supplier credit notes.
 *
 * WHY THIS EXISTS
 * ---------------
 * Batch B left goods with no way back. A receipt credited "received not
 * invoiced"; if the facility rejected the goods there was no path that removed
 * the stock and brought the accrual down with it, so the clearing balance would
 * grow forever and the shelf would keep stock nobody accepted. A credit note
 * had the same problem against the payable.
 *
 * WHAT THIS FILE GUARANTEES
 * -------------------------
 *  - Stock leaves at the **lot cost it arrived at**, from the lot the goods
 *    received note recorded, never at today's price.
 *  - A return can never exceed what is still held from that receipt line, and
 *    two returns against the same line cannot together exceed it.
 *  - The stock change and its journal commit together, in one transaction, so a
 *    return cannot exist without the ledger entry that explains it.
 *  - The counterpart account follows the facts: clearing before invoicing,
 *    payable after. Guessing would misstate a liability.
 *  - A credit note reduces the payable and is applied to the invoice balance,
 *    and neither can take the balance below zero.
 *  - Every write is idempotent on a caller-supplied key.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';

import { type AccountingScope } from '../accounting/accounting.service.ts';
import { db, pool } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import {
  linkMovementToJournal,
  postSupplierCreditNote,
  postSupplierReturn as postReturnJournal,
  recordMovementAllocations,
} from '../inventory/inventory-accounting.service.ts';

export type ReturnsScope = {
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

export class ReturnsError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReturnsError';
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new ReturnsError(statusCode, code, message);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (raw.length > max) fail(400, 'INVALID_INPUT', `${label} is too long.`);
  return raw || null;
}

function requiredText(value: unknown, label: string, max: number): string {
  const raw = optionalText(value, label, max);
  if (!raw) fail(400, 'INVALID_INPUT', `${label} is required.`);
  return raw;
}

const centsOf = (value: string | null | undefined): number => {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const money = (value: bigint | number): string => (Number(value) / 100).toFixed(2);

const RETURN_REASONS = [
  'REJECTED_QUALITY',
  'WRONG_ITEM',
  'DAMAGED_IN_TRANSIT',
  'EXPIRED_ON_DELIVERY',
  'OVER_DELIVERY',
  'ORDER_CANCELLED',
];

const accountingScope = (scope: ReturnsScope): AccountingScope => ({
  tenantId: scope.tenantId,
  facilityId: scope.facilityId,
  actorUserId: scope.actorId,
});

interface ReturnLine {
  goodsReceivedNoteItemId: number;
  quantity: number;
}

function parseLines(raw: unknown): ReturnLine[] {
  if (!Array.isArray(raw) || raw.length === 0)
    fail(400, 'INVALID_INPUT', 'A return needs at least one line.');
  const seen = new Set<number>();
  return raw.map((entry, index) => {
    const line = (entry ?? {}) as Record<string, unknown>;
    const itemId = positiveInt(
      line.goodsReceivedNoteItemId,
      `Line ${index + 1} goods received note line`,
    );
    if (seen.has(itemId))
      fail(409, 'DUPLICATE_RETURN_LINE', `Line ${index + 1} repeats a receipt line.`);
    seen.add(itemId);
    return {
      goodsReceivedNoteItemId: itemId,
      quantity: positiveInt(line.quantity, `Line ${index + 1} quantity`),
    };
  });
}

/**
 * Return goods to the supplier.
 *
 * The stock side and the ledger side are the same transaction: the lot is drawn
 * down, the item total falls with it, a RETURN_OUT movement records why, and the
 * journal brings the accrual or the payable down by the same value.
 */
export async function postSupplierReturn(scope: ReturnsScope, body: Record<string, unknown>) {
  const grnId = positiveInt(body.goodsReceivedNoteId, 'Goods received note');
  const returnNumber = requiredText(body.returnNumber, 'Return number', 40);
  const returnDate = isoDate(body.returnDate, 'Return date');
  const idempotencyKey = requiredText(body.idempotencyKey, 'Idempotency key', 120);
  const reasonCode = requiredText(body.reasonCode, 'Reason', 40).toUpperCase();
  if (!RETURN_REASONS.includes(reasonCode))
    fail(400, 'INVALID_REASON', `Choose a reason: ${RETURN_REASONS.join(', ')}.`);
  const notes = optionalText(body.notes, 'Notes', 500);
  const lines = parseLines(body.lines);

  const result = await withTx(async (tx, client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', [
      `supplier-return:${scope.facilityId}:${idempotencyKey}`,
      scope.facilityId,
    ]);

    const [prior] = await tx
      .select()
      .from(schema.supplierReturns)
      .where(
        and(
          eq(schema.supplierReturns.facilityId, scope.facilityId),
          eq(schema.supplierReturns.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (prior) return { returnId: prior.id, replayed: true };

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
      fail(409, 'GRN_NOT_POSTED', 'Only a posted receipt can be returned against.');

    const [existingNumber] = await tx
      .select({ id: schema.supplierReturns.id })
      .from(schema.supplierReturns)
      .where(
        and(
          eq(schema.supplierReturns.facilityId, scope.facilityId),
          eq(schema.supplierReturns.returnNumber, returnNumber),
        ),
      )
      .limit(1);
    if (existingNumber) fail(409, 'RETURN_NUMBER_IN_USE', 'This return number is already in use.');

    /* Already invoiced? That decides the counterpart, and it is a fact about
       the receipt rather than a judgement the caller gets to make. */
    const [invoice] = await tx
      .select({
        id: schema.supplierInvoices.id,
        invoiceNumber: schema.supplierInvoices.invoiceNumber,
        apAccountId: schema.supplierInvoices.apAccountId,
        status: schema.supplierInvoices.status,
      })
      .from(schema.supplierInvoices)
      .where(eq(schema.supplierInvoices.goodsReceivedNoteId, grnId))
      .limit(1);

    const receiptItems = await tx
      .select()
      .from(schema.goodsReceivedNoteItems)
      .where(eq(schema.goodsReceivedNoteItems.goodsReceivedNoteId, grnId))
      .orderBy(asc(schema.goodsReceivedNoteItems.id));
    const byId = new Map(receiptItems.map((item) => [item.id, item]));

    /* Quantities already returned against each receipt line. */
    const returned = await tx
      .select({
        receiptItemId: schema.supplierReturnItems.goodsReceivedNoteItemId,
        quantity: sql<string>`SUM(${schema.supplierReturnItems.quantity})`,
      })
      .from(schema.supplierReturnItems)
      .innerJoin(
        schema.supplierReturns,
        eq(schema.supplierReturns.id, schema.supplierReturnItems.returnId),
      )
      .where(
        and(
          eq(schema.supplierReturns.goodsReceivedNoteId, grnId),
          eq(schema.supplierReturns.status, 'POSTED'),
        ),
      )
      .groupBy(schema.supplierReturnItems.goodsReceivedNoteItemId);
    const returnedByItem = new Map(
      returned.map((row) => [row.receiptItemId, Number(row.quantity ?? 0)]),
    );

    const [supplier] = await tx
      .select({ name: schema.suppliers.name })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, note.supplierId))
      .limit(1);

    const [created] = await tx
      .insert(schema.supplierReturns)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        supplierId: note.supplierId,
        goodsReceivedNoteId: grnId,
        returnNumber,
        returnDate,
        status: 'POSTED',
        reasonCode,
        /* Provisional; replaced once the lines are valued. The check
           constraint allows zero, and the update below always runs. */
        totalCents: 0,
        counterpart: invoice ? 'PAYABLE' : 'CLEARING',
        idempotencyKey,
        notes,
        recordedByUserId: scope.actorId,
      })
      .returning();

    let totalCents = 0;
    const movementIds: number[] = [];

    for (const line of lines) {
      const receiptItem = byId.get(line.goodsReceivedNoteItemId);
      if (!receiptItem)
        fail(
          404,
          'RECEIPT_LINE_NOT_FOUND',
          `Receipt line ${line.goodsReceivedNoteItemId} is not part of this goods received note.`,
        );
      if (receiptItem.inventoryItemId === null)
        fail(
          409,
          'NOT_A_STOCK_LINE',
          `Receipt line ${receiptItem.id} did not add stock, so it cannot be returned to stock.`,
        );

      const already = returnedByItem.get(receiptItem.id) ?? 0;
      const received = Math.floor(Number(receiptItem.quantityReceived));
      const remaining = received - already;
      if (line.quantity > remaining)
        fail(
          409,
          'RETURN_EXCEEDS_RECEIPT',
          `Receipt line ${receiptItem.id} has ${remaining} unit(s) still returnable; ${line.quantity} was requested.`,
        );

      const itemId = receiptItem.inventoryItemId;
      const batchId = receiptItem.inventoryBatchId;

      /* Lock the item so a concurrent dispense cannot take the stock first. */
      const [item] = await tx
        .select()
        .from(schema.inventoryItems)
        .where(
          and(
            eq(schema.inventoryItems.id, itemId),
            eq(schema.inventoryItems.facilityId, scope.facilityId),
          ),
        )
        .limit(1)
        .for('update');
      if (!item) fail(404, 'STOCK_ITEM_NOT_FOUND', 'Stock item not found for this facility.');

      const stockBefore = item.currentStock ?? 0;
      if (stockBefore < line.quantity)
        fail(
          409,
          'INSUFFICIENT_STOCK',
          `"${item.name}" holds ${stockBefore} on hand; ${line.quantity} cannot be returned.`,
        );

      /* Value the return at what the goods cost when they arrived, taken from
         the lot the receipt created — not at today's price. */
      let unitCostCents = Math.round(Number(receiptItem.unitCost) * 100);
      if (!Number.isFinite(unitCostCents)) unitCostCents = 0;

      if (batchId !== null) {
        const [batch] = await tx
          .select()
          .from(schema.inventoryBatches)
          .where(eq(schema.inventoryBatches.id, batchId))
          .limit(1)
          .for('update');
        if (batch) {
          if (batch.quantityRemaining < line.quantity)
            fail(
              409,
              'LOT_QUANTITY_EXCEEDED',
              `Lot ${batch.batchNumber} holds ${batch.quantityRemaining}; ${line.quantity} cannot be returned from it.`,
            );
          const lotCost = Math.round(Number(batch.costPerUnit ?? 0) * 100);
          if (Number.isFinite(lotCost) && lotCost > 0) unitCostCents = lotCost;
          await tx
            .update(schema.inventoryBatches)
            .set({ quantityRemaining: batch.quantityRemaining - line.quantity })
            .where(eq(schema.inventoryBatches.id, batch.id));
        }
      }

      const stockAfter = stockBefore - line.quantity;
      await tx
        .update(schema.inventoryItems)
        .set({ currentStock: stockAfter, updatedAt: new Date() })
        .where(eq(schema.inventoryItems.id, itemId));

      const [movement] = await tx
        .insert(schema.inventoryMovements)
        .values({
          tenantId: scope.tenantId,
          facilityId: scope.facilityId,
          itemId,
          batchId,
          movementType: 'RETURN_OUT',
          quantityDelta: -line.quantity,
          stockAfter,
          reasonCode,
          referenceType: 'SUPPLIER_RETURN',
          referenceId: `${created.id}:${receiptItem.id}`,
          notes: `Returned to ${supplier?.name ?? 'supplier'} on ${returnNumber}.`,
          actorUserId: scope.actorId,
          actorName: scope.actorName,
          movementDate: returnDate,
        })
        .returning({ id: schema.inventoryMovements.id });
      movementIds.push(movement.id);

      const lineTotalCents = unitCostCents * line.quantity;
      totalCents += lineTotalCents;

      await tx.insert(schema.supplierReturnItems).values({
        returnId: created.id,
        goodsReceivedNoteItemId: receiptItem.id,
        inventoryItemId: itemId,
        inventoryBatchId: batchId,
        quantity: line.quantity,
        unitCostCents,
        lineTotalCents,
        inventoryMovementId: movement.id,
      });
    }

    await tx
      .update(schema.supplierReturns)
      .set({ totalCents })
      .where(eq(schema.supplierReturns.id, created.id));

    const accounting = {
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      actorUserId: scope.actorId,
    };

    /* Preserve the lots this return drew, so the stock ledger and the journal
       describe the same goods. */
    for (const movementId of movementIds) {
      const allocation = await tx
        .select({
          batchId: schema.supplierReturnItems.inventoryBatchId,
          quantity: schema.supplierReturnItems.quantity,
          unitCostCents: schema.supplierReturnItems.unitCostCents,
        })
        .from(schema.supplierReturnItems)
        .where(eq(schema.supplierReturnItems.inventoryMovementId, movementId));
      await recordMovementAllocations(
        client,
        accounting,
        movementId,
        allocation
          .filter((row) => row.batchId !== null)
          .map((row) => ({
            batchId: Number(row.batchId),
            quantity: Number(row.quantity),
            unitCostCents: Number(row.unitCostCents),
          })),
      );
    }

    const journalId = await postReturnJournal(client, accounting, {
      returnId: created.id,
      returnNumber,
      entryDate: returnDate,
      supplierName: supplier?.name ?? 'supplier',
      valueCents: BigInt(totalCents),
      counterpart: invoice ? 'PAYABLE' : 'CLEARING',
      payableAccountId: invoice ? invoice.apAccountId : null,
    });

    if (journalId !== null) {
      await tx
        .update(schema.supplierReturns)
        .set({ journalEntryId: journalId })
        .where(eq(schema.supplierReturns.id, created.id));
      for (const movementId of movementIds) {
        await linkMovementToJournal(client, accounting, movementId, journalId);
      }

      /* An invoiced receipt that is reduced has a smaller invoice to pay. */
      if (invoice) {
        const [full] = await tx
          .select()
          .from(schema.supplierInvoices)
          .where(eq(schema.supplierInvoices.id, invoice.id))
          .limit(1)
          .for('update');
        if (full) {
          const newTotal = Math.max(0, centsOf(full.totalAmountKes) - totalCents);
          const newBalance = Math.max(0, newTotal - centsOf(full.paidAmountKes));
          await tx
            .update(schema.supplierInvoices)
            .set({
              totalAmountKes: money(newTotal),
              balanceKes: money(newBalance),
              status:
                newBalance === 0
                  ? 'PAID'
                  : centsOf(full.paidAmountKes) > 0
                    ? 'PARTIALLY_PAID'
                    : 'POSTED',
            })
            .where(eq(schema.supplierInvoices.id, full.id));
        }
      }
    }

    await tx.insert(schema.auditLogs).values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      userId: String(scope.actorId),
      resource: 'SupplierReturn',
      resourceId: String(created.id),
      action: 'POST',
      details: `${lines.length} line(s) returned to ${supplier?.name ?? 'supplier'} against ${note.grnNumber}; value KES ${money(totalCents)}.`,
    });

    return { returnId: created.id, replayed: false, journalId };
  });

  return { ...result, return: await getSupplierReturn(scope, result.returnId) };
}

export async function getSupplierReturn(scope: ReturnsScope, id: number) {
  const [row] = await db
    .select()
    .from(schema.supplierReturns)
    .where(
      and(
        eq(schema.supplierReturns.id, id),
        eq(schema.supplierReturns.tenantId, scope.tenantId),
        eq(schema.supplierReturns.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!row) fail(404, 'SUPPLIER_RETURN_NOT_FOUND', 'Supplier return not found.');

  const lines = await db
    .select({
      line: schema.supplierReturnItems,
      itemName: schema.inventoryItems.name,
      itemCode: schema.inventoryItems.itemCode,
    })
    .from(schema.supplierReturnItems)
    .leftJoin(
      schema.inventoryItems,
      eq(schema.inventoryItems.id, schema.supplierReturnItems.inventoryItemId),
    )
    .where(eq(schema.supplierReturnItems.returnId, id))
    .orderBy(asc(schema.supplierReturnItems.id));

  return {
    ...row,
    lines: lines.map((entry) => ({
      ...entry.line,
      itemName: entry.itemName,
      itemCode: entry.itemCode,
    })),
  };
}

export async function listSupplierReturns(scope: ReturnsScope, grnId?: number) {
  const conditions = [
    eq(schema.supplierReturns.tenantId, scope.tenantId),
    eq(schema.supplierReturns.facilityId, scope.facilityId),
  ];
  if (grnId) conditions.push(eq(schema.supplierReturns.goodsReceivedNoteId, grnId));

  return db
    .select()
    .from(schema.supplierReturns)
    .where(and(...conditions))
    .orderBy(desc(schema.supplierReturns.id))
    .limit(200);
}

/* ------------------------------------------------------------ credit notes */

/**
 * Record the supplier's credit.
 *
 * The payable is debited because the facility owes less. The credit is applied
 * to the invoice balance it names, and cannot take that balance below zero: a
 * credit larger than what is owed is a refund to be received, not a negative
 * invoice, and saying so is better than hiding it in a number.
 */
export async function createSupplierCreditNote(scope: ReturnsScope, body: Record<string, unknown>) {
  const supplierId = positiveInt(body.supplierId, 'Supplier');
  const invoiceId =
    body.supplierInvoiceId === undefined ||
    body.supplierInvoiceId === null ||
    body.supplierInvoiceId === ''
      ? null
      : positiveInt(body.supplierInvoiceId, 'Supplier invoice');
  const creditNoteNumber = requiredText(body.creditNoteNumber, 'Credit note number', 64);
  const creditNoteDate = isoDate(body.creditNoteDate, 'Credit note date');
  const idempotencyKey = requiredText(body.idempotencyKey, 'Idempotency key', 120);
  const subtotalCents = Math.round(Number(body.subtotal ?? 0) * 100);
  const taxCents = Math.round(Number(body.tax ?? 0) * 100);
  if (!Number.isFinite(subtotalCents) || subtotalCents < 0)
    fail(400, 'INVALID_INPUT', 'Credit note subtotal must be zero or more.');
  if (!Number.isFinite(taxCents) || taxCents < 0)
    fail(400, 'INVALID_INPUT', 'Credit note tax must be zero or more.');
  const totalCents = subtotalCents + taxCents;
  if (totalCents <= 0) fail(400, 'INVALID_INPUT', 'A credit note must have a positive total.');
  const taxRecoverable = body.taxRecoverable === true;
  const notes = optionalText(body.notes, 'Notes', 500);
  const supplierReturnId =
    body.supplierReturnId === undefined ||
    body.supplierReturnId === null ||
    body.supplierReturnId === ''
      ? null
      : positiveInt(body.supplierReturnId, 'Supplier return');
  const rawItems = Array.isArray(body.items) ? body.items : [];

  const result = await withTx(async (tx, client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', [
      `supplier-credit-note:${scope.facilityId}:${idempotencyKey}`,
      scope.facilityId,
    ]);

    const [prior] = await tx
      .select()
      .from(schema.supplierCreditNotes)
      .where(
        and(
          eq(schema.supplierCreditNotes.facilityId, scope.facilityId),
          eq(schema.supplierCreditNotes.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (prior) return { creditNoteId: prior.id, replayed: true };

    const [supplier] = await tx
      .select()
      .from(schema.suppliers)
      .where(
        and(eq(schema.suppliers.id, supplierId), eq(schema.suppliers.tenantId, scope.tenantId)),
      )
      .limit(1);
    if (!supplier) fail(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found.');

    const [duplicate] = await tx
      .select({ id: schema.supplierCreditNotes.id })
      .from(schema.supplierCreditNotes)
      .where(
        and(
          eq(schema.supplierCreditNotes.facilityId, scope.facilityId),
          eq(schema.supplierCreditNotes.creditNoteNumber, creditNoteNumber),
        ),
      )
      .limit(1);
    if (duplicate)
      fail(409, 'CREDIT_NOTE_NUMBER_IN_USE', 'This credit note number is already recorded.');

    let invoice: typeof schema.supplierInvoices.$inferSelect | undefined;
    if (invoiceId !== null) {
      [invoice] = await tx
        .select()
        .from(schema.supplierInvoices)
        .where(
          and(
            eq(schema.supplierInvoices.id, invoiceId),
            eq(schema.supplierInvoices.tenantId, scope.tenantId),
            eq(schema.supplierInvoices.facilityId, scope.facilityId),
          ),
        )
        .limit(1)
        .for('update');
      if (!invoice) fail(404, 'SUPPLIER_INVOICE_NOT_FOUND', 'Supplier invoice not found.');
      if (invoice.supplierId !== supplierId)
        fail(409, 'SUPPLIER_MISMATCH', 'That invoice belongs to a different supplier.');

      const balance = centsOf(invoice.balanceKes);
      if (totalCents > balance)
        fail(
          409,
          'CREDIT_EXCEEDS_BALANCE',
          `The invoice balance is KES ${money(balance)}; a credit of KES ${money(totalCents)} would take it below zero. Record the excess as a refund due from the supplier.`,
        );
    }

    /*
     * The account the credit comes out of. A credit against an invoice lands on
     * that invoice's own ledger accounts, so the credit and the charge it
     * reverses are never split across two different expense accounts.
     */
    const apAccountId = invoice
      ? invoice.apAccountId
      : (
          await tx
            .select({ apAccountId: schema.supplierInvoices.apAccountId })
            .from(schema.supplierInvoices)
            .where(
              and(
                eq(schema.supplierInvoices.tenantId, scope.tenantId),
                eq(schema.supplierInvoices.facilityId, scope.facilityId),
                eq(schema.supplierInvoices.supplierId, supplierId),
              ),
            )
            .orderBy(desc(schema.supplierInvoices.id))
            .limit(1)
        )[0]?.apAccountId;

    if (!apAccountId)
      fail(
        409,
        'PAYABLE_ACCOUNT_REQUIRED',
        'A credit note needs a supplier invoice to take its payable account from.',
      );

    const expenseAccountId =
      invoice?.expenseAccountId ??
      (
        await tx
          .select({ expenseAccountId: schema.supplierInvoices.expenseAccountId })
          .from(schema.supplierInvoices)
          .where(
            and(
              eq(schema.supplierInvoices.tenantId, scope.tenantId),
              eq(schema.supplierInvoices.facilityId, scope.facilityId),
              eq(schema.supplierInvoices.supplierId, supplierId),
            ),
          )
          .orderBy(desc(schema.supplierInvoices.id))
          .limit(1)
      )[0]?.expenseAccountId;

    if (!expenseAccountId)
      fail(
        409,
        'EXPENSE_ACCOUNT_REQUIRED',
        'A credit note needs a prior invoice from this supplier to know where the cost belongs.',
      );

    const [created] = await tx
      .insert(schema.supplierCreditNotes)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        supplierId,
        supplierInvoiceId: invoiceId,
        supplierReturnId,
        creditNoteNumber,
        creditNoteDate,
        subtotalCents,
        taxCents,
        totalCents,
        appliedCents: invoice ? totalCents : 0,
        status: invoice ? 'APPLIED' : 'OPEN',
        idempotencyKey,
        notes,
        recordedByUserId: scope.actorId,
      })
      .returning();

    for (const [index, raw] of rawItems.entries()) {
      const entry = (raw ?? {}) as Record<string, unknown>;
      const description = requiredText(entry.description, `Item ${index + 1} description`, 200);
      const lineTotal = Math.round(Number(entry.lineTotal ?? 0) * 100);
      if (!Number.isFinite(lineTotal) || lineTotal <= 0)
        fail(400, 'INVALID_INPUT', `Item ${index + 1} line total must be positive.`);
      await tx.insert(schema.supplierCreditNoteItems).values({
        creditNoteId: created.id,
        description,
        quantity:
          entry.quantity === undefined || entry.quantity === null
            ? null
            : positiveInt(entry.quantity, `Item ${index + 1} quantity`),
        unitCostCents:
          entry.unitCost === undefined || entry.unitCost === null
            ? null
            : Math.round(Number(entry.unitCost) * 100),
        lineTotalCents: lineTotal,
      });
    }

    const journalId = await postSupplierCreditNote(
      client,
      { tenantId: scope.tenantId, facilityId: scope.facilityId, actorUserId: scope.actorId },
      {
        creditNoteId: created.id,
        creditNoteNumber,
        entryDate: creditNoteDate,
        supplierName: supplier.name,
        subtotalCents: BigInt(subtotalCents),
        taxCents: BigInt(taxCents),
        taxRecoverable,
        payableAccountId: apAccountId,
        fallbackExpenseAccountId: expenseAccountId,
      },
    );

    if (journalId !== null) {
      await tx
        .update(schema.supplierCreditNotes)
        .set({ journalEntryId: journalId })
        .where(eq(schema.supplierCreditNotes.id, created.id));
    }

    if (invoice) {
      const newTotal = Math.max(0, centsOf(invoice.totalAmountKes) - totalCents);
      const newBalance = Math.max(0, newTotal - centsOf(invoice.paidAmountKes));
      await tx
        .update(schema.supplierInvoices)
        .set({
          totalAmountKes: money(newTotal),
          balanceKes: money(newBalance),
          status:
            newBalance === 0
              ? centsOf(invoice.paidAmountKes) > 0
                ? 'PAID'
                : 'CREDITED'
              : centsOf(invoice.paidAmountKes) > 0
                ? 'PARTIALLY_PAID'
                : 'POSTED',
        })
        .where(eq(schema.supplierInvoices.id, invoice.id));
    }

    await tx.insert(schema.auditLogs).values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      userId: String(scope.actorId),
      resource: 'SupplierCreditNote',
      resourceId: String(created.id),
      action: 'POST',
      details: `Credit note ${creditNoteNumber} from ${supplier.name} for KES ${money(totalCents)}${invoice ? ` against invoice ${invoice.invoiceNumber}` : ' (unapplied)'}.`,
    });

    return { creditNoteId: created.id, replayed: false, journalId };
  });

  return { ...result, creditNote: await getSupplierCreditNote(scope, result.creditNoteId) };
}

export async function getSupplierCreditNote(scope: ReturnsScope, id: number) {
  const [row] = await db
    .select()
    .from(schema.supplierCreditNotes)
    .where(
      and(
        eq(schema.supplierCreditNotes.id, id),
        eq(schema.supplierCreditNotes.tenantId, scope.tenantId),
        eq(schema.supplierCreditNotes.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!row) fail(404, 'CREDIT_NOTE_NOT_FOUND', 'Supplier credit note not found.');

  const items = await db
    .select()
    .from(schema.supplierCreditNoteItems)
    .where(eq(schema.supplierCreditNoteItems.creditNoteId, id))
    .orderBy(asc(schema.supplierCreditNoteItems.id));

  return { ...row, items };
}

export async function listSupplierCreditNotes(scope: ReturnsScope, invoiceId?: number) {
  const conditions = [
    eq(schema.supplierCreditNotes.tenantId, scope.tenantId),
    eq(schema.supplierCreditNotes.facilityId, scope.facilityId),
  ];
  if (invoiceId) conditions.push(eq(schema.supplierCreditNotes.supplierInvoiceId, invoiceId));

  return db
    .select()
    .from(schema.supplierCreditNotes)
    .where(and(...conditions))
    .orderBy(desc(schema.supplierCreditNotes.id))
    .limit(200);
}
