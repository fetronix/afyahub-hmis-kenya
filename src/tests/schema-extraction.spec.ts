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
        // Migrations 0091-0092: strictly additive bank evidence and account configuration.
        'facilityBankPaymentPolicies',
        'bankAccountIdentifiers',
        'bankPaymentRecords',
        'bankPaymentEvents',
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
        // Migration 0087: the permanent evidence record written when a human
        // reconciles a claim whose dispatch outcome was unknown.
        'insuranceClaimDispatchReconciliations',
        // Migration 0089: versioned facility letterhead, and the append-only
        // record of who activated or withdrew each version.
        'facilityLetterheads',
        'facilityLetterheadEvents',
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
        // Migration 0082: tax rates are facility configuration, not a table of
        // rates shipped with the product. No Kenyan rate is encoded anywhere.
        'fixedAssetTaxRates',
        // Migration 0083: which published statutory form version a facility
        // produces. The form layout itself is never encoded here.
        'payrollFormProfiles',
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
        'facilityInventoryAccounting',
        'inventoryMovementAllocations',
        'inventoryMovementJournals',
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
        // Batch E (migration 0080): the three-way match verdict per invoice,
        // supplier returns and their lines, and supplier credit notes.
        'approvalPolicies',
        'supplierInvoiceMatches',
        'supplierReturns',
        'supplierReturnItems',
        'supplierCreditNotes',
        'supplierCreditNoteItems',
        // Migration 0105: the monthly and annual statement archive. A saved
        // statement keeps the payload it was approved with, the presentation
        // overrides a facility configures, and an append-only export history.
        'financialStatementSettings',
        'financialStatementAccountGroups',
        'financialStatementRuns',
        'financialStatementExports',
        // Fixed-asset lifecycle (0103) and the planning domain, which were
        // extracted from the barrel without being listed here; the list is the
        // barrel contract and must name every export.
        'fixedAssetDepreciationBatchItems',
        'fixedAssetDepreciationBatches',
        'fixedAssetDocuments',
        'fixedAssetInspections',
        'fixedAssetLifecycleEvents',
        'fixedAssetMaintenanceSchedules',
        'fixedAssetSettings',
        'planningCategories',
        'planningEvents',
        'planningImportBatches',
        'planningItems',
        'planningMonths',
        'planningPlans',
        'planningReports',
        'planningUniforms',
        // A drizzle custom type re-exported by the barrel, not a table.
        'customBytea',
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
