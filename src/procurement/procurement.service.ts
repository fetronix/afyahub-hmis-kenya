import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { PurchaseOrderError } from '../db/queries/inventory.ts';
import {
  calculateOrder,
  hasControlCharacters,
  optionalOrderText,
  orderDate,
  OrderInputError,
} from './order-items.ts';

type Scope = { tenantId: number; facilityId: number; actorId: number; actorName: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function badInput(message: string): never {
  throw new PurchaseOrderError(400, 'INVALID_PURCHASE_ORDER', message);
}
function checked<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof OrderInputError) badInput(error.message);
    throw error;
  }
}
function positiveId(value: unknown, label: string): number {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) <= 0
  )
    badInput(`Invalid ${label}.`);
  return Number(value);
}
function revision(value: unknown): number {
  return positiveId(value, 'revision');
}
function requiredText(value: unknown, label: string, max: number): string {
  const text = checked(() => optionalOrderText(value, label, max));
  if (!text || hasControlCharacters(text))
    badInput(
      `${label} is required and must be at most ${max} characters without control characters.`,
    );
  return text;
}

async function lockOrder(tx: Tx, scope: Scope, id: number) {
  const [order] = await tx
    .select()
    .from(schema.purchaseOrders)
    .where(
      and(
        eq(schema.purchaseOrders.id, id),
        eq(schema.purchaseOrders.tenantId, scope.tenantId),
        eq(schema.purchaseOrders.facilityId, scope.facilityId),
      ),
    )
    .limit(1)
    .for('update');
  if (!order)
    throw new PurchaseOrderError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found.');
  return order;
}
function checkRevision(order: { revision: number }, expected: unknown) {
  if (revision(expected) !== order.revision) {
    throw new PurchaseOrderError(
      409,
      'STALE_PURCHASE_ORDER',
      'This order changed. Refresh it before trying again.',
    );
  }
}
async function ensureNotInvoiced(tx: Tx, orderId: number) {
  const [invoice] = await tx
    .select({ id: schema.supplierInvoices.id })
    .from(schema.supplierInvoices)
    .where(eq(schema.supplierInvoices.purchaseOrderId, orderId))
    .limit(1);
  if (invoice)
    throw new PurchaseOrderError(
      409,
      'PURCHASE_ORDER_LINKED',
      'This order is linked to a supplier invoice and cannot be changed, rejected or cancelled here.',
    );
}
async function audit(
  tx: Tx,
  scope: Scope,
  resource: string,
  id: number,
  action: string,
  details: string,
) {
  await tx.insert(schema.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: String(scope.actorId),
    resource,
    resourceId: String(id),
    action,
    details,
  });
}

export async function purchaseOrderDetails(scope: Scope, id: number) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(schema.purchaseOrders)
      .where(
        and(
          eq(schema.purchaseOrders.id, id),
          eq(schema.purchaseOrders.tenantId, scope.tenantId),
          eq(schema.purchaseOrders.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('share');
    if (!order)
      throw new PurchaseOrderError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found.');
    const items = await tx
      .select()
      .from(schema.purchaseOrderItems)
      .where(
        and(
          eq(schema.purchaseOrderItems.purchaseOrderId, id),
          eq(schema.purchaseOrderItems.isActive, true),
        ),
      )
      .orderBy(asc(schema.purchaseOrderItems.lineNumber));
    const events = await tx
      .select()
      .from(schema.purchaseOrderEvents)
      .where(eq(schema.purchaseOrderEvents.purchaseOrderId, id))
      .orderBy(asc(schema.purchaseOrderEvents.id));
    return { ...order, items, events };
  });
}

export async function updatePurchaseOrder(scope: Scope, id: number, body: Record<string, unknown>) {
  const expectedRevision = revision(body.expectedRevision);
  const poNumber = requiredText(body.poNumber, 'PO number', 100);
  const supplierId = positiveId(body.supplierId, 'supplier');
  const description = checked(() => optionalOrderText(body.description, 'Description', 2000));
  const notes = checked(() => optionalOrderText(body.notes, 'Notes', 2000));
  const deliveryAddress = checked(() =>
    optionalOrderText(body.deliveryAddress, 'Delivery address', 1000),
  );
  const paymentTerms = checked(() => optionalOrderText(body.paymentTerms, 'Payment terms', 500));
  const expectedDeliveryDate = checked(() => orderDate(body.expectedDeliveryDate));
  // Edits require itemization; old amount-only records remain unchanged until edited.
  const calculated = checked(() => calculateOrder(body.items, body));
  try {
    return await db.transaction(async (tx) => {
      const order = await lockOrder(tx, scope, id);
      checkRevision(order, expectedRevision);
      if (order.status !== 'Pending Approval')
        throw new PurchaseOrderError(
          409,
          'INVALID_ORDER_TRANSITION',
          'Only pending orders can be edited.',
        );
      await ensureNotInvoiced(tx, id);
      const [supplier] = await tx
        .select({ id: schema.suppliers.id })
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.id, supplierId),
            eq(schema.suppliers.tenantId, scope.tenantId),
            eq(schema.suppliers.isActive, true),
          ),
        )
        .limit(1)
        .for('update');
      if (!supplier)
        throw new PurchaseOrderError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found or inactive.');
      const oldItems = await tx
        .select()
        .from(schema.purchaseOrderItems)
        .where(
          and(
            eq(schema.purchaseOrderItems.purchaseOrderId, id),
            eq(schema.purchaseOrderItems.isActive, true),
          ),
        );
      await tx
        .update(schema.purchaseOrderItems)
        .set({ isActive: false })
        .where(
          and(
            eq(schema.purchaseOrderItems.purchaseOrderId, id),
            eq(schema.purchaseOrderItems.isActive, true),
          ),
        );
      await tx.insert(schema.purchaseOrderItems).values(
        calculated.items.map((item, index) => ({
          purchaseOrderId: id,
          lineNumber: index + 1,
          ...item,
        })),
      );
      const [updated] = await tx
        .update(schema.purchaseOrders)
        .set({
          poNumber,
          supplierId,
          description,
          notes,
          expectedDeliveryDate,
          deliveryAddress,
          paymentTerms,
          subtotalAmount: calculated.subtotal,
          taxAmount: calculated.taxAmount,
          shippingAmount: calculated.shippingAmount,
          discountAmount: calculated.discountAmount,
          totalAmount: calculated.total,
          revision: order.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(schema.purchaseOrders.id, id))
        .returning();
      await tx.insert(schema.purchaseOrderEvents).values({
        purchaseOrderId: id,
        eventType: 'UPDATED',
        fromStatus: order.status,
        toStatus: order.status,
        actorUserId: scope.actorId,
        details: {
          before: {
            poNumber: order.poNumber,
            supplierId: order.supplierId,
            description: order.description,
            notes: order.notes,
            expectedDeliveryDate: order.expectedDeliveryDate,
            deliveryAddress: order.deliveryAddress,
            paymentTerms: order.paymentTerms,
            subtotalAmount: order.subtotalAmount,
            taxAmount: order.taxAmount,
            shippingAmount: order.shippingAmount,
            discountAmount: order.discountAmount,
            totalAmount: order.totalAmount,
            items: oldItems,
          },
        },
      });
      await audit(
        tx,
        scope,
        'PurchaseOrder',
        id,
        'UPDATE',
        'Pending order updated; previous values retained in order history.',
      );
      return updated;
    });
  } catch (error) {
    let cause: unknown = error;
    for (let i = 0; i < 3 && cause && typeof cause === 'object'; i++) {
      const e = cause as { code?: string; constraint?: string; cause?: unknown };
      if (e.code === '23505' && e.constraint === 'purchase_orders_po_number_unique') {
        throw new PurchaseOrderError(
          409,
          'PURCHASE_ORDER_NUMBER_IN_USE',
          'This purchase order number is already in use.',
        );
      }
      cause = e.cause;
    }
    throw error;
  }
}

type Transition = 'approve' | 'reject' | 'complete' | 'cancel';
export async function transitionPurchaseOrder(
  scope: Scope,
  id: number,
  action: Transition,
  body: Record<string, unknown>,
) {
  const expected = revision(body.expectedRevision);
  const note = checked(() => optionalOrderText(body.note, 'Reason or note', 2000));
  if ((action === 'reject' || action === 'cancel' || action === 'complete') && !note)
    badInput('A reason or completion note is required.');
  if (action === 'complete' && body.confirmAdministrativeCompletion !== true)
    badInput('Confirm that this is administrative completion only.');
  const toStatus = {
    approve: 'Approved',
    reject: 'Rejected',
    complete: 'Completed',
    cancel: 'Cancelled',
  }[action];
  const fromStatus = action === 'complete' ? 'Approved' : 'Pending Approval';
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, scope, id);
    checkRevision(order, expected);
    if (order.status !== fromStatus)
      throw new PurchaseOrderError(
        409,
        'INVALID_ORDER_TRANSITION',
        `Only ${fromStatus} orders can be ${toStatus.toLowerCase()}.`,
      );
    if (action === 'approve') {
      // A user who created OR edited an order must not approve their own work.
      const [ownEdit] = await tx
        .select({ id: schema.purchaseOrderEvents.id })
        .from(schema.purchaseOrderEvents)
        .where(
          and(
            eq(schema.purchaseOrderEvents.purchaseOrderId, id),
            eq(schema.purchaseOrderEvents.eventType, 'UPDATED'),
            eq(schema.purchaseOrderEvents.actorUserId, scope.actorId),
          ),
        )
        .limit(1);
      if (order.createdByUserId === scope.actorId || ownEdit) {
        throw new PurchaseOrderError(
          403,
          'SELF_APPROVAL_FORBIDDEN',
          'A different user who did not create or edit this order must approve it.',
        );
      }
      const [line] = await tx
        .select({ id: schema.purchaseOrderItems.id })
        .from(schema.purchaseOrderItems)
        .where(
          and(
            eq(schema.purchaseOrderItems.purchaseOrderId, id),
            eq(schema.purchaseOrderItems.isActive, true),
          ),
        )
        .limit(1);
      if (!line)
        throw new PurchaseOrderError(
          409,
          'ORDER_ITEMIZATION_REQUIRED',
          'Add the actual order lines before approval.',
        );
      const [supplier] = await tx
        .select({ id: schema.suppliers.id })
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.id, order.supplierId),
            eq(schema.suppliers.tenantId, scope.tenantId),
            eq(schema.suppliers.isActive, true),
          ),
        )
        .limit(1)
        .for('share');
      if (!supplier)
        throw new PurchaseOrderError(
          409,
          'SUPPLIER_INACTIVE',
          'An inactive supplier cannot be used for a new approval.',
        );
    }
    if (action === 'reject' || action === 'cancel') await ensureNotInvoiced(tx, id);
    const [updated] = await tx
      .update(schema.purchaseOrders)
      .set({
        status: toStatus,
        ...(action === 'approve' ? { approvedBy: scope.actorName } : {}),
        revision: order.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.purchaseOrders.id, id))
      .returning();
    await tx.insert(schema.purchaseOrderEvents).values({
      purchaseOrderId: id,
      eventType: action.toUpperCase(),
      fromStatus,
      toStatus,
      actorUserId: scope.actorId,
      note,
    });
    await audit(
      tx,
      scope,
      'PurchaseOrder',
      id,
      action.toUpperCase(),
      `Status changed from ${fromStatus} to ${toStatus}.`,
    );
    return updated;
  });
}

type SupplierInput = {
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  kraPin: string | null;
  address: string | null;
};
function supplierInput(body: Record<string, unknown>): SupplierInput {
  return {
    name: requiredText(body.name, 'Supplier name', 200),
    contactPerson: checked(() => optionalOrderText(body.contactPerson, 'Contact person', 200)),
    phone: checked(() => optionalOrderText(body.phone, 'Phone', 60)),
    email: checked(() => optionalOrderText(body.email, 'Email', 254)),
    kraPin: checked(() => optionalOrderText(body.kraPin, 'KRA PIN', 60)),
    address: checked(() => optionalOrderText(body.address, 'Address', 1000)),
  };
}
async function checkSupplierName(
  tx: Tx,
  tenantId: number,
  name: string,
  exceptId: number | null,
  confirmed: unknown,
) {
  if (confirmed !== undefined && typeof confirmed !== 'boolean')
    badInput('Invalid duplicate supplier confirmation.');
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${tenantId}::integer, hashtext(lower(${name})))`,
  );
  const conditions = [
    eq(schema.suppliers.tenantId, tenantId),
    sql`lower(btrim(${schema.suppliers.name})) = lower(${name})`,
  ];
  if (exceptId !== null) conditions.push(ne(schema.suppliers.id, exceptId));
  const [match] = await tx
    .select({ id: schema.suppliers.id })
    .from(schema.suppliers)
    .where(and(...conditions))
    .limit(1);
  if (match && confirmed !== true)
    throw new PurchaseOrderError(
      409,
      'SUPPLIER_NAME_EXISTS',
      'A supplier with this name already exists. Select it or confirm that this is a separate supplier.',
    );
  return Boolean(match);
}
export async function createSupplier(scope: Scope, body: Record<string, unknown>) {
  const values = supplierInput(body);
  return db.transaction(async (tx) => {
    const duplicateConfirmed = await checkSupplierName(
      tx,
      scope.tenantId,
      values.name,
      null,
      body.confirmDuplicateSupplier,
    );
    const [supplier] = await tx
      .insert(schema.suppliers)
      .values({ tenantId: scope.tenantId, ...values })
      .returning();
    await audit(
      tx,
      scope,
      'Supplier',
      supplier.id,
      'CREATE',
      duplicateConfirmed
        ? 'Supplier record created with duplicate name explicitly confirmed; supplier verification is not implied.'
        : 'Supplier record created; supplier verification is not implied.',
    );
    return supplier;
  });
}
export async function updateSupplier(scope: Scope, id: number, body: Record<string, unknown>) {
  const expected = revision(body.expectedRevision);
  const values = supplierInput(body);
  if (body.isActive !== undefined && body.isActive !== true)
    badInput('Use the deactivate action to deactivate a supplier.');
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.suppliers)
      .where(and(eq(schema.suppliers.id, id), eq(schema.suppliers.tenantId, scope.tenantId)))
      .limit(1)
      .for('update');
    if (!current) throw new PurchaseOrderError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found.');
    if (current.revision !== expected)
      throw new PurchaseOrderError(
        409,
        'STALE_SUPPLIER',
        'This supplier changed. Refresh it before trying again.',
      );
    const duplicateConfirmed =
      current.name.trim().toLowerCase() !== values.name.toLowerCase()
        ? await checkSupplierName(
            tx,
            scope.tenantId,
            values.name,
            id,
            body.confirmDuplicateSupplier,
          )
        : false;
    const [supplier] = await tx
      .update(schema.suppliers)
      .set({
        ...values,
        ...(body.isActive === true ? { isActive: true } : {}),
        revision: current.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.suppliers.id, id))
      .returning();
    await audit(
      tx,
      scope,
      'Supplier',
      id,
      'UPDATE',
      JSON.stringify({
        before: {
          name: current.name,
          contactPerson: current.contactPerson,
          phone: current.phone,
          email: current.email,
          kraPin: current.kraPin,
          address: current.address,
          isActive: current.isActive,
        },
        after: { ...values, isActive: supplier.isActive },
        duplicateConfirmed,
      }),
    );
    return supplier;
  });
}
export async function deactivateSupplier(scope: Scope, id: number, body: Record<string, unknown>) {
  const expected = revision(body.expectedRevision);
  const note = checked(() => optionalOrderText(body.note, 'Reason', 1000));
  if (!note) badInput('A reason for deactivation is required.');
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.suppliers)
      .where(and(eq(schema.suppliers.id, id), eq(schema.suppliers.tenantId, scope.tenantId)))
      .limit(1)
      .for('update');
    if (!current) throw new PurchaseOrderError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found.');
    if (current.revision !== expected)
      throw new PurchaseOrderError(
        409,
        'STALE_SUPPLIER',
        'This supplier changed. Refresh it before trying again.',
      );
    if (!current.isActive)
      throw new PurchaseOrderError(
        409,
        'SUPPLIER_ALREADY_INACTIVE',
        'Supplier is already inactive.',
      );
    const [supplier] = await tx
      .update(schema.suppliers)
      .set({ isActive: false, revision: current.revision + 1, updatedAt: new Date() })
      .where(eq(schema.suppliers.id, id))
      .returning();
    await audit(
      tx,
      scope,
      'Supplier',
      id,
      'DEACTIVATE',
      `Supplier deactivated; existing orders and references retained. Reason: ${note}`,
    );
    return supplier;
  });
}
