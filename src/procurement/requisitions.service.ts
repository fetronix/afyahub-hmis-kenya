/**
 * JaliCare HMIS — purchase requisitions.
 *
 * A requisition is the department's request; a purchase order is the
 * authorized commitment. They are separate records on purpose:
 *
 *  - only an approver can move a requisition to APPROVED, and the submitter
 *    can never approve their own request;
 *  - conversion creates a pending-approval purchase order with a number
 *    derived from the requisition, so a retried conversion adopts the order
 *    it already created instead of issuing a second one;
 *  - every state change writes an event row and an audit entry.
 *
 * Facility scoping comes from the authenticated request. The browser-supplied
 * facility id is only a hint and is resolved by the route first.
 */

import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { assertApprovalAuthority } from '../facility/approval-policy.service.ts';
import { calculateOrder, optionalOrderText } from './order-items.ts';
import { createPurchaseOrder } from '../db/queries/inventory.ts';
import { PurchaseOrderError } from '../db/queries/inventory.ts';

export type RequisitionScope = {
  tenantId: number;
  facilityId: number;
  actorId: number;
  actorName: string;
  permissions?: string[];
};

export class RequisitionError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RequisitionError';
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new RequisitionError(statusCode, code, message);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED'] as const;

function text(value: unknown, label: string, max: number, required = true): string {
  const parsed = optionalOrderText(value, label, max);
  if (!parsed && required) fail(400, 'INVALID_INPUT', `${label} is required.`);
  return parsed ?? '';
}
function isoDate(value: unknown, label: string, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) fail(400, 'INVALID_INPUT', `${label} is required.`);
    return null;
  }
  const raw = String(value).trim();
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
function money(value: unknown, label: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000_000)
    fail(400, 'INVALID_INPUT', `${label} must be a non-negative amount.`);
  return Math.round(parsed * 100) / 100;
}

type RequisitionLine = {
  inventoryItemId: number | null;
  description: string;
  quantity: string;
  unit: string;
  estimatedUnitPrice: string;
  lineTotal: string;
};

function parseLines(raw: unknown): RequisitionLine[] {
  if (!Array.isArray(raw) || raw.length === 0)
    fail(400, 'INVALID_INPUT', 'Add at least one line to the requisition.');
  if (raw.length > 50) fail(400, 'INVALID_INPUT', 'A requisition may have at most 50 lines.');
  return raw.map((entry, index) => {
    const line = (entry ?? {}) as Record<string, unknown>;
    const quantity = positiveInt(line.quantity, `Line ${index + 1} quantity`, 1_000_000);
    const unitPrice = money(line.estimatedUnitPrice, `Line ${index + 1} estimate`);
    const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
    return {
      inventoryItemId:
        line.inventoryItemId === undefined ||
        line.inventoryItemId === null ||
        line.inventoryItemId === ''
          ? null
          : positiveInt(line.inventoryItemId, `Line ${index + 1} stock item`),
      description: text(line.description, `Line ${index + 1} description`, 200),
      quantity: quantity.toFixed(3),
      unit: text(line.unit, `Line ${index + 1} unit`, 32),
      estimatedUnitPrice: unitPrice.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
    };
  });
}

function totalOf(lines: RequisitionLine[]): string {
  const cents = lines.reduce((sum, line) => sum + Math.round(Number(line.lineTotal) * 100), 0);
  return (cents / 100).toFixed(2);
}

async function lockRequisition(scope: RequisitionScope, id: number) {
  const [row] = await db
    .select()
    .from(schema.procurementRequisitions)
    .where(
      and(
        eq(schema.procurementRequisitions.id, id),
        eq(schema.procurementRequisitions.tenantId, scope.tenantId),
        eq(schema.procurementRequisitions.facilityId, scope.facilityId),
      ),
    )
    .limit(1)
    .for('update');
  if (!row) fail(404, 'REQUISITION_NOT_FOUND', 'Requisition not found.');
  return row;
}

async function recordEvent(
  tx: { insert: typeof db.insert },
  requisitionId: number,
  eventType: string,
  fromStatus: string | null,
  toStatus: string | null,
  actorId: number,
  note: string | null,
) {
  await tx.insert(schema.procurementRequisitionEvents).values({
    requisitionId,
    eventType,
    fromStatus,
    toStatus,
    actorUserId: actorId,
    note,
  });
}

async function audit(
  requisitionId: number,
  action: string,
  scope: RequisitionScope,
  details: string,
) {
  await db.insert(schema.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: String(scope.actorId),
    resource: 'ProcurementRequisition',
    resourceId: String(requisitionId),
    action,
    details,
  });
}

/* ------------------------------------------------------------------ reads */

export async function listRequisitions(
  scope: RequisitionScope,
  filters: { status?: string; search?: string; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, Number(filters.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize ?? 25) || 25));
  const conditions = [
    eq(schema.procurementRequisitions.tenantId, scope.tenantId),
    eq(schema.procurementRequisitions.facilityId, scope.facilityId),
  ];
  if (filters.status && (STATUSES as readonly string[]).includes(filters.status))
    conditions.push(eq(schema.procurementRequisitions.status, filters.status));
  const search = (filters.search ?? '').trim();
  if (search) {
    const like = `%${search}%`;
    conditions.push(
      sql`(${schema.procurementRequisitions.requisitionNumber} ILIKE ${like} OR ${schema.procurementRequisitions.justification} ILIKE ${like} OR COALESCE(${schema.procurementRequisitions.department}, '') ILIKE ${like})`,
    );
  }
  const where = and(...conditions);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.procurementRequisitions)
    .where(where);
  const rows = await db
    .select()
    .from(schema.procurementRequisitions)
    .where(where)
    .orderBy(
      desc(schema.procurementRequisitions.requestDate),
      desc(schema.procurementRequisitions.id),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const ids = rows.map((row) => row.id);
  const items = ids.length
    ? await db
        .select()
        .from(schema.procurementRequisitionItems)
        .where(inArray(schema.procurementRequisitionItems.requisitionId, ids))
        .orderBy(asc(schema.procurementRequisitionItems.lineNumber))
    : [];

  return {
    total: count,
    page,
    pageSize,
    rows: rows.map((row) => ({
      ...row,
      items: items.filter((item) => item.requisitionId === row.id),
    })),
  };
}

export async function getRequisition(scope: RequisitionScope, id: number) {
  const [row] = await db
    .select()
    .from(schema.procurementRequisitions)
    .where(
      and(
        eq(schema.procurementRequisitions.id, id),
        eq(schema.procurementRequisitions.tenantId, scope.tenantId),
        eq(schema.procurementRequisitions.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!row) fail(404, 'REQUISITION_NOT_FOUND', 'Requisition not found.');
  const [items, events] = await Promise.all([
    db
      .select()
      .from(schema.procurementRequisitionItems)
      .where(eq(schema.procurementRequisitionItems.requisitionId, id))
      .orderBy(asc(schema.procurementRequisitionItems.lineNumber)),
    db
      .select()
      .from(schema.procurementRequisitionEvents)
      .where(eq(schema.procurementRequisitionEvents.requisitionId, id))
      .orderBy(asc(schema.procurementRequisitionEvents.id)),
  ]);
  return { ...row, items, events };
}

/* ----------------------------------------------------------------- writes */

export async function createRequisition(scope: RequisitionScope, body: Record<string, unknown>) {
  const lines = parseLines(body.items);
  const number = text(body.requisitionNumber, 'Requisition number', 32);
  const justification = text(body.justification, 'Justification', 500);
  const requestDate = isoDate(body.requestDate, 'Request date', true)!;
  const neededBy = isoDate(body.neededBy, 'Needed-by date', false);

  const [row] = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: schema.procurementRequisitions.id })
      .from(schema.procurementRequisitions)
      .where(
        and(
          eq(schema.procurementRequisitions.facilityId, scope.facilityId),
          eq(schema.procurementRequisitions.requisitionNumber, number),
        ),
      )
      .limit(1);
    if (existing.length)
      fail(409, 'REQUISITION_NUMBER_IN_USE', 'This requisition number is already in use.');

    const [created] = await tx
      .insert(schema.procurementRequisitions)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        requisitionNumber: number,
        requestDate,
        neededBy,
        department: optionalOrderText(body.department, 'Department', 120),
        justification,
        status: 'DRAFT',
        estimatedTotalKes: totalOf(lines),
        requestedByUserId: scope.actorId,
        requestedByName: scope.actorName,
      })
      .returning();

    await tx
      .insert(schema.procurementRequisitionItems)
      .values(
        lines.map((line, index) => ({ requisitionId: created.id, lineNumber: index + 1, ...line })),
      );
    await recordEvent(tx, created.id, 'CREATED', null, 'DRAFT', scope.actorId, null);
    return [created];
  });

  await audit(row.id, 'CREATE', scope, 'Requisition created as a draft.');
  return getRequisition(scope, row.id);
}

export async function updateRequisition(
  scope: RequisitionScope,
  id: number,
  body: Record<string, unknown>,
) {
  const updated = await db.transaction(async (tx) => {
    const current = await lockRequisition(scope, id);
    if (current.status !== 'DRAFT' && current.status !== 'REJECTED')
      fail(
        409,
        'REQUISITION_LOCKED',
        'Only a draft or rejected requisition can be edited. Create a new one instead.',
      );
    const lines = parseLines(body.items);
    const justification = text(body.justification, 'Justification', 500);
    const requestDate = isoDate(body.requestDate, 'Request date', true)!;
    const neededBy = isoDate(body.neededBy, 'Needed-by date', false);

    const [row] = await tx
      .update(schema.procurementRequisitions)
      .set({
        justification,
        requestDate,
        neededBy,
        department: optionalOrderText(body.department, 'Department', 120),
        estimatedTotalKes: totalOf(lines),
        updatedAt: new Date(),
      })
      .where(eq(schema.procurementRequisitions.id, id))
      .returning();

    await tx
      .delete(schema.procurementRequisitionItems)
      .where(eq(schema.procurementRequisitionItems.requisitionId, id));
    await tx
      .insert(schema.procurementRequisitionItems)
      .values(lines.map((line, index) => ({ requisitionId: id, lineNumber: index + 1, ...line })));
    await recordEvent(tx, id, 'UPDATED', current.status, current.status, scope.actorId, null);
    return row;
  });
  await audit(id, 'UPDATE', scope, 'Requisition details updated.');
  return getRequisition(scope, updated.id);
}

export async function submitRequisition(scope: RequisitionScope, id: number) {
  const status = await db.transaction(async (tx) => {
    const current = await lockRequisition(scope, id);
    if (current.status !== 'DRAFT' && current.status !== 'REJECTED')
      fail(409, 'INVALID_TRANSITION', 'Only a draft or rejected requisition can be submitted.');
    const [row] = await tx
      .update(schema.procurementRequisitions)
      .set({ status: 'SUBMITTED', updatedAt: new Date() })
      .where(eq(schema.procurementRequisitions.id, id))
      .returning({ status: schema.procurementRequisitions.status });
    await recordEvent(tx, id, 'SUBMITTED', current.status, 'SUBMITTED', scope.actorId, null);
    return row.status;
  });
  await audit(id, 'SUBMIT', scope, 'Requisition submitted for approval.');
  return getRequisition(scope, id).then((row) => ({ ...row, status }));
}

export async function decideRequisition(
  scope: RequisitionScope,
  id: number,
  decision: 'approve' | 'reject',
  body: Record<string, unknown>,
) {
  let note = text(body.note, 'Decision note', 500, false) || null;
  const finalStatus = decision === 'approve' ? 'APPROVED' : 'REJECTED';

  await db.transaction(async (tx) => {
    const current = await lockRequisition(scope, id);
    if (current.status !== 'SUBMITTED')
      fail(409, 'INVALID_TRANSITION', 'Only a submitted requisition can be decided.');
    if (current.requestedByUserId === scope.actorId)
      fail(
        403,
        'REQUISITION_SELF_APPROVAL',
        'The person who raised a requisition cannot approve or reject it.',
      );
    if (decision === 'reject' && !note)
      fail(400, 'REJECTION_REASON_REQUIRED', 'A rejection needs a reason.');

    /*
     * A facility may require a stronger authority above a threshold. The
     * rule is read inside this transaction, so an approval cannot slip
     * through while the policy table changes underneath it, and the event
     * note records which rule applied.
     */
    if (decision === 'approve') {
      const amountCents = Math.round(Number(current.estimatedTotalKes) * 100);
      if (!Number.isSafeInteger(amountCents) || amountCents < 0)
        fail(409, 'REQUISITION_AMOUNT_INVALID', 'The requisition total cannot be evaluated.');
      const applied = await assertApprovalAuthority(
        scope.facilityId,
        'REQUISITION',
        amountCents,
        new Date().toISOString().slice(0, 10),
        scope.permissions ?? [],
        tx,
      );
      if (applied)
        note = [note, `Approval rule "${applied.policyName}" applied.`].filter(Boolean).join(' ');
    }

    await tx
      .update(schema.procurementRequisitions)
      .set({
        status: finalStatus,
        decidedByUserId: scope.actorId,
        decidedAt: new Date(),
        decisionNote: note,
        updatedAt: new Date(),
      })
      .where(eq(schema.procurementRequisitions.id, id));
    await recordEvent(
      tx,
      id,
      decision === 'approve' ? 'APPROVED' : 'REJECTED',
      'SUBMITTED',
      finalStatus,
      scope.actorId,
      note,
    );
  });

  await audit(
    id,
    decision === 'approve' ? 'APPROVE' : 'REJECT',
    scope,
    note ?? `Requisition ${decision}d.`,
  );
  return getRequisition(scope, id);
}

/**
 * Convert an approved requisition into a purchase order.
 *
 * The order number is derived from the requisition so the operation is
 * idempotent: if a previous attempt created the order but failed before the
 * requisition was updated, the retry adopts that order instead of creating a
 * duplicate commitment.
 */
export async function convertRequisition(
  scope: RequisitionScope,
  id: number,
  body: Record<string, unknown>,
) {
  const requisition = await getRequisition(scope, id);
  if (requisition.status === 'CONVERTED' && requisition.purchaseOrderId) {
    return { requisition, purchaseOrderId: requisition.purchaseOrderId, idempotentReplay: true };
  }
  if (requisition.status !== 'APPROVED')
    fail(409, 'INVALID_TRANSITION', 'Only an approved requisition can become a purchase order.');
  if (!requisition.items.length)
    fail(409, 'EMPTY_REQUISITION', 'A requisition without lines cannot become an order.');

  const supplierId = positiveInt(body.supplierId, 'Supplier');
  const poNumber = (optionalOrderText(body.poNumber, 'Purchase order number', 40) || '').trim()
    ? text(body.poNumber, 'Purchase order number', 40)
    : `PO-REQ-${requisition.requisitionNumber}`.slice(0, 40);

  const existingOrder = await db
    .select({ id: schema.purchaseOrders.id })
    .from(schema.purchaseOrders)
    .where(
      and(
        eq(schema.purchaseOrders.facilityId, scope.facilityId),
        eq(schema.purchaseOrders.poNumber, poNumber),
      ),
    )
    .limit(1);

  let purchaseOrderId: number;
  if (existingOrder.length) {
    purchaseOrderId = existingOrder[0].id;
  } else {
    const items = requisition.items.map((item) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unit: item.unit,
      unitPrice: Number(item.estimatedUnitPrice),
    }));
    const totals = calculateOrder(items, {
      taxAmount: body.taxAmount,
      shippingAmount: body.shippingAmount,
      discountAmount: body.discountAmount,
    });
    try {
      const order = await createPurchaseOrder(
        {
          facilityId: scope.facilityId,
          tenantId: scope.tenantId,
          supplierId,
          poNumber,
          totalAmount: totals.total,
          description: `Requisition ${requisition.requisitionNumber}`,
          notes: requisition.justification,
          items,
          status: 'Pending Approval',
          // The order belongs to the person who raised the requisition. If it
          // were attributed to the approver, that approver could never approve
          // the conversion because the order would be their own.
          orderedBy: requisition.requestedByName,
        } as Parameters<typeof createPurchaseOrder>[0],
        requisition.requestedByUserId ?? scope.actorId,
      );
      purchaseOrderId = order.id;
    } catch (error) {
      if (error instanceof PurchaseOrderError && error.code === 'PURCHASE_ORDER_NUMBER_IN_USE') {
        const [again] = await db
          .select({ id: schema.purchaseOrders.id })
          .from(schema.purchaseOrders)
          .where(
            and(
              eq(schema.purchaseOrders.facilityId, scope.facilityId),
              eq(schema.purchaseOrders.poNumber, poNumber),
            ),
          )
          .limit(1);
        if (!again) throw error;
        purchaseOrderId = again.id;
      } else throw error;
    }
  }

  await db.transaction(async (tx) => {
    const current = await lockRequisition(scope, id);
    if (current.status === 'CONVERTED') return;
    await tx
      .update(schema.procurementRequisitions)
      .set({
        status: 'CONVERTED',
        purchaseOrderId,
        decidedByUserId: current.decidedByUserId ?? scope.actorId,
        decidedAt: current.decidedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.procurementRequisitions.id, id));
    await recordEvent(
      tx,
      id,
      'CONVERTED',
      current.status,
      'CONVERTED',
      scope.actorId,
      `Purchase order ${poNumber}`,
    );
  });

  await audit(id, 'CONVERT', scope, `Converted to purchase order ${poNumber}.`);
  return {
    requisition: await getRequisition(scope, id),
    purchaseOrderId,
    idempotentReplay: false,
  };
}

/** ILIKE helper kept exported so the route can validate a search term. */
export const requisitionSearchPattern = ilike;
