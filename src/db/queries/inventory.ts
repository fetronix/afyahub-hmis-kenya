/**
 * JaliCare HMIS
 * Queries: Inventory, dispensing, suppliers, and purchase orders
 *
 * Re-exported by `../queries.ts` so existing imports keep working. Purchase
 * order creation also supports adding a supplier atomically with the order.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../index.ts';
import * as schema from '../schema.ts';
import {
  calculateOrder,
  calculateOrderItems,
  hasControlCharacters,
  OrderInputError,
  optionalOrderText,
  orderDate,
  validateAmount,
} from '../../procurement/order-items.ts';

import { moduleLogger } from '../../logging/logger.ts';

const log = moduleLogger('db.inventory');

// Pharmacy & Inventory
export async function getInventoryItems(facilityId?: number) {
  try {
    if (facilityId) {
      return await db
        .select()
        .from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.facilityId, facilityId))
        .orderBy(schema.inventoryItems.name);
    }
    return await db.select().from(schema.inventoryItems).orderBy(schema.inventoryItems.name);
  } catch (error) {
    log.error({ err: error }, 'inventory_items.fetch_failed');
    throw new Error('Failed to fetch pharmacy inventory', { cause: error });
  }
}

export async function createInventoryItem(data: typeof schema.inventoryItems.$inferInsert) {
  try {
    const res = await db.insert(schema.inventoryItems).values(data).returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'inventory_item.create_failed');
    throw new Error('Failed to create inventory item', { cause: error });
  }
}

export async function dispenseMedication(data: typeof schema.pharmacyDispensations.$inferInsert) {
  try {
    const res = await db.insert(schema.pharmacyDispensations).values(data).returning();
    // deduct from inventory if item specified
    if (data.itemId) {
      await db
        .update(schema.inventoryItems)
        .set({
          currentStock: sql`${schema.inventoryItems.currentStock} - ${data.quantityDispensed}`,
        })
        .where(eq(schema.inventoryItems.id, data.itemId));
    }
    // update prescription status if linked
    if (data.prescriptionId) {
      await db
        .update(schema.medications)
        .set({ status: 'Dispensed' })
        .where(eq(schema.medications.id, data.prescriptionId));
    }
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'medication.dispense_failed');
    throw new Error('Failed to complete pharmacy dispensing', { cause: error });
  }
}

// Procurement
export async function getSuppliers(tenantId?: number) {
  try {
    if (tenantId) {
      return await db
        .select()
        .from(schema.suppliers)
        .where(eq(schema.suppliers.tenantId, tenantId));
    }
    return await db.select().from(schema.suppliers);
  } catch (error) {
    log.error({ err: error }, 'suppliers.fetch_failed');
    throw new Error('Failed to fetch suppliers', { cause: error });
  }
}

export async function getPurchaseOrders(facilityId: number, tenantId: number) {
  try {
    // Check both dimensions even if legacy data contains inconsistent references.
    return await db
      .select()
      .from(schema.purchaseOrders)
      .where(
        and(
          eq(schema.purchaseOrders.facilityId, facilityId),
          eq(schema.purchaseOrders.tenantId, tenantId),
        ),
      )
      .orderBy(desc(schema.purchaseOrders.createdAt));
  } catch (error) {
    log.error({ err: error }, 'purchase_orders.fetch_failed');
    throw new Error('Failed to fetch purchase orders', { cause: error });
  }
}

/** A supplier may be selected by ID or entered by name, but never both. */
export type PurchaseOrderCreate = Omit<typeof schema.purchaseOrders.$inferInsert, 'supplierId'> & {
  supplierId?: number | null;
  supplierName?: string | null;
  confirmDuplicateSupplier?: boolean;
  items?: unknown;
};

export class PurchaseOrderError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PurchaseOrderError';
  }
}

function isPurchaseOrderNumberConflict(error: unknown): boolean {
  // Drizzle wraps the PostgreSQL error as its cause. Do not confuse another
  // constraint violation with a duplicate PO number.
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth++) {
    const details = current as { code?: string; constraint?: string; cause?: unknown };
    if (details.code === '23505' && details.constraint === 'purchase_orders_po_number_unique') {
      return true;
    }
    current = details.cause;
  }
  return false;
}

export async function createPurchaseOrder(data: PurchaseOrderCreate, actorUserId?: number) {
  const { supplierId, supplierName, confirmDuplicateSupplier, items: rawItems, ...order } = data;
  let items: ReturnType<typeof calculateOrderItems>['items'] = [];
  try {
    // Legacy clients may still send an amount-only order. The new UI always sends lines.
    const calculated = rawItems === undefined ? null : calculateOrder(rawItems, order);
    items = calculated?.items ?? [];
    order.totalAmount = calculated?.total ?? validateAmount(order.totalAmount);
    order.subtotalAmount = calculated?.subtotal ?? null;
    if (calculated) {
      order.taxAmount = calculated.taxAmount;
      order.shippingAmount = calculated.shippingAmount;
      order.discountAmount = calculated.discountAmount;
    } else if (
      order.taxAmount !== undefined ||
      order.shippingAmount !== undefined ||
      order.discountAmount !== undefined
    ) {
      throw new OrderInputError('Adjustments require itemized order lines.');
    }
    order.deliveryAddress = optionalOrderText(order.deliveryAddress, 'Delivery address', 1000);
    order.paymentTerms = optionalOrderText(order.paymentTerms, 'Payment terms', 500);
    order.description = optionalOrderText(order.description, 'Description', 2000);
    order.notes = optionalOrderText(order.notes, 'Notes', 2000);
    order.expectedDeliveryDate = orderDate(order.expectedDeliveryDate);
    order.createdByUserId = actorUserId ?? null;
  } catch (error) {
    if (error instanceof OrderInputError)
      throw new PurchaseOrderError(400, 'INVALID_PURCHASE_ORDER', error.message);
    throw error;
  }
  const hasId = supplierId !== undefined && supplierId !== null;
  const hasName = supplierName !== undefined && supplierName !== null;

  if (hasId === hasName) {
    throw new PurchaseOrderError(
      400,
      'INVALID_SUPPLIER',
      'Select an existing supplier or enter a new supplier name.',
    );
  }

  if (confirmDuplicateSupplier !== undefined && typeof confirmDuplicateSupplier !== 'boolean') {
    throw new PurchaseOrderError(
      400,
      'INVALID_SUPPLIER',
      'Invalid duplicate supplier confirmation.',
    );
  }
  if (
    typeof order.poNumber !== 'string' ||
    !order.poNumber.trim() ||
    order.poNumber.trim().length > 100 ||
    hasControlCharacters(order.poNumber)
  ) {
    throw new PurchaseOrderError(
      400,
      'INVALID_PURCHASE_ORDER',
      'A purchase order number is required.',
    );
  }

  order.poNumber = order.poNumber.trim();
  let existingId: number | undefined;
  let newName: string | undefined;
  if (hasId) {
    if (
      (typeof supplierId !== 'number' && typeof supplierId !== 'string') ||
      !Number.isSafeInteger(Number(supplierId)) ||
      Number(supplierId) <= 0
    ) {
      throw new PurchaseOrderError(400, 'INVALID_SUPPLIER', 'Select a valid supplier.');
    }
    existingId = Number(supplierId);
  } else {
    if (typeof supplierName !== 'string') {
      throw new PurchaseOrderError(400, 'INVALID_SUPPLIER', 'Enter a valid supplier name.');
    }
    newName = supplierName.trim();
    const containsControlCharacter = [...newName].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
    if (!newName || newName.length > 200 || containsControlCharacter) {
      throw new PurchaseOrderError(
        400,
        'INVALID_SUPPLIER',
        'Enter a supplier name of 1 to 200 characters without control characters.',
      );
    }
  }

  try {
    return await db.transaction(async (tx) => {
      let chosenSupplierId: number;
      let newSupplierId: number | undefined;
      let duplicateConfirmed = false;

      if (newName !== undefined) {
        // Serialize concurrent additions of the same name within a tenant.
        // The lock uses the same database case-folding as the duplicate check.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(${order.tenantId}::integer, hashtext(lower(${newName})))`,
        );
      }

      // A lost response may lead to a retry. Do not create a second supplier or
      // imply that the retry succeeded; tell the user to check the existing PO.
      const [existingOrder] = await tx
        .select({ id: schema.purchaseOrders.id })
        .from(schema.purchaseOrders)
        .where(eq(schema.purchaseOrders.poNumber, order.poNumber))
        .limit(1);
      if (existingOrder) {
        throw new PurchaseOrderError(
          409,
          'PURCHASE_ORDER_NUMBER_IN_USE',
          'This purchase order number is already in use. Check your orders before trying again.',
        );
      }

      if (newName !== undefined) {
        const [match] = await tx
          .select({ id: schema.suppliers.id })
          .from(schema.suppliers)
          .where(
            and(
              eq(schema.suppliers.tenantId, order.tenantId),
              sql`lower(btrim(${schema.suppliers.name})) = lower(${newName})`,
            ),
          )
          .limit(1);

        if (match && !confirmDuplicateSupplier) {
          throw new PurchaseOrderError(
            409,
            'SUPPLIER_NAME_EXISTS',
            'A supplier with this name already exists. Select it if it is the same supplier, or confirm that this is a different supplier.',
          );
        }
        duplicateConfirmed = Boolean(match && confirmDuplicateSupplier);

        // No contact details, tax PIN, or verification/approval are inferred.
        const [created] = await tx
          .insert(schema.suppliers)
          .values({ tenantId: order.tenantId, name: newName })
          .returning({ id: schema.suppliers.id });
        chosenSupplierId = created.id;
        newSupplierId = created.id;
      } else {
        const [supplier] = await tx
          .select({ id: schema.suppliers.id })
          .from(schema.suppliers)
          .where(
            and(
              eq(schema.suppliers.id, existingId!),
              eq(schema.suppliers.tenantId, order.tenantId),
              eq(schema.suppliers.isActive, true),
            ),
          )
          .limit(1)
          .for('update');
        if (!supplier) {
          // Do not disclose whether an ID exists outside the tenant.
          throw new PurchaseOrderError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found.');
        }
        chosenSupplierId = supplier.id;
      }

      const [po] = await tx
        .insert(schema.purchaseOrders)
        .values({ ...order, supplierId: chosenSupplierId })
        .returning();

      if (items.length) {
        await tx.insert(schema.purchaseOrderItems).values(
          items.map((item, index) => ({
            purchaseOrderId: po.id,
            lineNumber: index + 1,
            ...item,
          })),
        );
      }
      await tx.insert(schema.purchaseOrderEvents).values({
        purchaseOrderId: po.id,
        eventType: 'CREATED',
        toStatus: 'Pending Approval',
        actorUserId: actorUserId ?? null,
        details: { itemized: items.length > 0 },
      });
      await tx.insert(schema.auditLogs).values({
        tenantId: order.tenantId,
        facilityId: order.facilityId,
        userId: actorUserId === undefined ? null : String(actorUserId),
        action: 'CREATE',
        resource: 'PurchaseOrder',
        resourceId: String(po.id),
        details: 'Purchase order created pending approval.',
      });

      if (newSupplierId !== undefined) {
        await tx.insert(schema.auditLogs).values({
          tenantId: order.tenantId,
          facilityId: order.facilityId,
          userId: actorUserId === undefined ? null : String(actorUserId),
          action: 'CREATE',
          resource: 'Supplier',
          resourceId: String(newSupplierId),
          details: duplicateConfirmed
            ? 'Supplier created with a purchase order; duplicate name explicitly confirmed.'
            : 'Supplier created with a purchase order.',
        });
      }

      return po;
    });
  } catch (error) {
    if (error instanceof PurchaseOrderError) throw error;
    if (isPurchaseOrderNumberConflict(error)) {
      throw new PurchaseOrderError(
        409,
        'PURCHASE_ORDER_NUMBER_IN_USE',
        'This purchase order number is already in use. Check your orders before trying again.',
      );
    }
    log.error({ err: error }, 'purchase_order.create_failed');
    throw new Error('Failed to create purchase order', { cause: error });
  }
}
