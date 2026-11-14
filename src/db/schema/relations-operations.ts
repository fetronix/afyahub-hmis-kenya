/**
 * JaliCare HMIS — relations operations schema.
 * Definitions are re-exported by ../schema.ts for existing callers and drizzle-kit.
 */

import { relations } from 'drizzle-orm';
import { billingInvoices, billingItems, billingPayments, insuranceClaims } from './billing.ts';
import { encounters } from './clinical.ts';
import { medications } from './inpatient.ts';
import {
  inventoryBatches,
  inventoryItems,
  pharmacyDispensations,
  purchaseOrders,
  suppliers,
} from './inventory.ts';
import { patients } from './patients.ts';
import { publicHealthReports } from './public-health.ts';
import { facilities, tenants } from './tenancy.ts';

export const inventoryItemsRelations = relations(inventoryItems, ({ one, many }) => ({
  facility: one(facilities, {
    fields: [inventoryItems.facilityId],
    references: [facilities.id],
  }),

  batches: many(inventoryBatches),

  dispensations: many(pharmacyDispensations),
}));

export const inventoryBatchesRelations = relations(inventoryBatches, ({ one }) => ({
  item: one(inventoryItems, {
    fields: [inventoryBatches.itemId],
    references: [inventoryItems.id],
  }),
}));

export const pharmacyDispensationsRelations = relations(pharmacyDispensations, ({ one }) => ({
  tenant: one(tenants, {
    fields: [pharmacyDispensations.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [pharmacyDispensations.facilityId],
    references: [facilities.id],
  }),

  prescription: one(medications, {
    fields: [pharmacyDispensations.prescriptionId],
    references: [medications.id],
  }),

  patient: one(patients, {
    fields: [pharmacyDispensations.patientId],
    references: [patients.id],
  }),

  item: one(inventoryItems, {
    fields: [pharmacyDispensations.itemId],
    references: [inventoryItems.id],
  }),
}));

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [suppliers.tenantId],
    references: [tenants.id],
  }),

  purchaseOrders: many(purchaseOrders),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one }) => ({
  tenant: one(tenants, {
    fields: [purchaseOrders.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [purchaseOrders.facilityId],
    references: [facilities.id],
  }),

  supplier: one(suppliers, {
    fields: [purchaseOrders.supplierId],
    references: [suppliers.id],
  }),
}));

export const billingInvoicesRelations = relations(billingInvoices, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [billingInvoices.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [billingInvoices.facilityId],
    references: [facilities.id],
  }),

  patient: one(patients, {
    fields: [billingInvoices.patientId],
    references: [patients.id],
  }),

  encounter: one(encounters, {
    fields: [billingInvoices.encounterId],
    references: [encounters.id],
  }),

  items: many(billingItems),

  payments: many(billingPayments),

  claims: many(insuranceClaims),
}));

export const billingItemsRelations = relations(billingItems, ({ one }) => ({
  invoice: one(billingInvoices, {
    fields: [billingItems.invoiceId],
    references: [billingInvoices.id],
  }),
}));

export const billingPaymentsRelations = relations(billingPayments, ({ one }) => ({
  invoice: one(billingInvoices, {
    fields: [billingPayments.invoiceId],
    references: [billingInvoices.id],
  }),
}));

export const insuranceClaimsRelations = relations(insuranceClaims, ({ one }) => ({
  tenant: one(tenants, {
    fields: [insuranceClaims.tenantId],
    references: [tenants.id],
  }),

  facility: one(facilities, {
    fields: [insuranceClaims.facilityId],
    references: [facilities.id],
  }),

  patient: one(patients, {
    fields: [insuranceClaims.patientId],
    references: [patients.id],
  }),

  invoice: one(billingInvoices, {
    fields: [insuranceClaims.invoiceId],
    references: [billingInvoices.id],
  }),
}));

export const publicHealthReportsRelations = relations(publicHealthReports, ({ one }) => ({
  facility: one(facilities, {
    fields: [publicHealthReports.facilityId],
    references: [facilities.id],
  }),
}));
