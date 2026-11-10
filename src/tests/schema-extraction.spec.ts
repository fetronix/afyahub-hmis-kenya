import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Relations } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema.ts';
import {
  contractWithReviewedAdditions,
  relationContract,
  tableContract,
} from './support/schema-contract.ts';

// Captured from the original barrel before extracting its inline definitions.
// These are Drizzle metadata, not rows or patient data; no database is required.
const baseline = JSON.parse(
  readFileSync(
    new URL('./fixtures/schema-contract-before-extraction.json', import.meta.url),
    'utf8',
  ),
) as { tables: Record<string, unknown>; relations: Record<string, unknown> };
const publicExports = JSON.parse(
  readFileSync(
    new URL('./fixtures/schema-exports-before-extraction.json', import.meta.url),
    'utf8',
  ),
) as string[];
const schemaExports = schema as Record<string, unknown>;

describe('schema barrel: pre-extraction contract', () => {
  it('preserves exactly the public exports used by the app and drizzle-kit', () => {
    // New domain tables are explicit additions; every original export remains required.
    expect(Object.keys(schema).sort()).toEqual(
      [
        ...publicExports,
        'appointmentCategories',
        'appointmentEvents',
        'appointmentRequests',
        'theatreRooms',
        'theatreBookings',
        'theatreScheduleEvents',
        'theatreLegacyReviewEvents',
        'pharmacyDispenseRequests',
        'pharmacyDispenseAllocations',
        'inventoryReceiptRequests',
        'medicationStatusEvents',
        'labSpecimens',
        'labSpecimenOrders',
        'billingRefunds',
        'billingRefundRequests',
        'billingInvoiceFinalizations',
        'billingPaymentAttributions',
        'billingPaymentRequests',
        'billingPaymentRequestCancellations',
        'insuranceClaimDispatchGuards',
        'accountingBillingPostings',
        'facilityTariffImportBatches',
        'notificationAlertStates',
        'notificationReadReceipts',
        'masterServices',
        'masterServiceSources',
        'masterServiceAliases',
        'labTestSpecimenOptions',
        'labOrderBatches',
        'radiologyOrderRequests',
        'encounterCreationRequests',
        'facilityServices',
        'inpatientBedBillingPolicies',
        'inpatientBedBillingWork',
        'inpatientBedStaySnapshots',
        'inpatientBedBillingReviews',
        'inpatientBedOccupancies',
        'inpatientBedNights',
        // Phase 5 domain modules: workforce, payroll, procurement receipts,
        // stock control and the fixed-asset register. Each arrived with its
        // own migration (0074-0077) and barrel export.
        'fixedAssetCategories',
        'fixedAssetMaintenance',
        'fixedAssetTransfers',
        'goodsReceivedNoteItems',
        'goodsReceivedNotes',
        'hrAttendance',
        'hrDepartments',
        'hrDesignations',
        'hrEmployeeDocuments',
        'hrEmployees',
        'hrLeaveRequests',
        'hrLeaveTypes',
        'hrRosterEntries',
        'hrShifts',
        'inventoryMovements',
        'inventoryStockCountLines',
        'inventoryStockCounts',
        'inventoryTransferItems',
        'inventoryTransfers',
        'payrollAccountSettings',
        'payrollEmployeeComponents',
        'payrollPayslipLines',
        'payrollPayslips',
        'payrollPeriods',
        'payrollRuns',
        'payrollStatutoryBands',
        'payrollStatutoryVersions',
        'procurementRequisitionEvents',
        'procurementRequisitionItems',
        'procurementRequisitions',
      ].sort(),
    );
  });

  it.each(Object.entries(baseline.tables))('%s keeps its table metadata', (name, expected) => {
    expect(tableContract(schemaExports[name] as PgTable)).toEqual(
      contractWithReviewedAdditions(name, expected),
    );
  });

  it.each(Object.entries(baseline.relations))('%s keeps its joins', (name, expected) => {
    expect(relationContract(schemaExports[name] as Relations)).toEqual(expected);
  });
});
