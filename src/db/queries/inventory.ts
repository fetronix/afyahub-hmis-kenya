/**
 * JaliCare HMIS
 * Queries: Inventory, dispensing, suppliers, and purchase orders
 *
 * Extracted from `../queries.ts`, which re-exports every function here so that
 * `import * as queries from '../queries.ts'` keeps working. The SQL, the scope
 * checks and the transaction boundaries are moved verbatim; nothing was rewritten.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../index.ts';
import * as schema from '../schema.ts';

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

export async function getPurchaseOrders(facilityId?: number) {
  try {
    if (facilityId) {
      return await db
        .select()
        .from(schema.purchaseOrders)
        .where(eq(schema.purchaseOrders.facilityId, facilityId))
        .orderBy(desc(schema.purchaseOrders.createdAt));
    }
    return await db
      .select()
      .from(schema.purchaseOrders)
      .orderBy(desc(schema.purchaseOrders.createdAt));
  } catch (error) {
    log.error({ err: error }, 'purchase_orders.fetch_failed');
    throw new Error('Failed to fetch purchase orders', { cause: error });
  }
}

export async function createPurchaseOrder(data: typeof schema.purchaseOrders.$inferInsert) {
  try {
    const res = await db.insert(schema.purchaseOrders).values(data).returning();
    return res[0];
  } catch (error) {
    log.error({ err: error }, 'purchase_order.create_failed');
    throw new Error('Failed to create purchase order', { cause: error });
  }
}
