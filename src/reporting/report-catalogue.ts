/**
 * Shared reporting navigation: the report library and its ten categories.
 *
 * The catalogue is a menu, not evidence. A report appears here whether or not it
 * can be produced yet; `engine` is the only statement that one can be, and
 * `dependency` says what the rest still need. Nothing is hidden to make the
 * coverage look better, and nothing is listed twice.
 *
 * `REPORT_LIBRARY` is the inventory (every requested report, once). The ten
 * categories are the redesign's navigation and reference those entries by id, so
 * re-grouping the menu cannot rename, duplicate or drop a report.
 */
export type ReportEngineId =
  | 'cashier-receipts'
  | 'ledger-trial-movements'
  | 'ledger-income'
  | 'ledger-balance-sheet'
  | 'invoice-balances'
  | 'recorded-refunds'
  | 'inventory-movements'
  | 'purchase-orders'
  | 'inventory-store'
  | 'inventory-category'
  | 'inventory-expiry'
  | 'outpatient-encounters'
  | 'outpatient-diagnoses'
  | 'current-inpatients'
  | 'inpatient-admissions'
  | 'inpatient-discharges'
  | 'laboratory-orders'
  | 'radiology-requests'
  | 'pharmacy-dispensations'
  | 'patient-registrations';

export type ReportCategoryId =
  | 'clinical'
  | 'diagnostics'
  | 'finance-accounting'
  | 'billing-revenue'
  | 'pharmacy'
  | 'inventory'
  | 'procurement'
  | 'workforce'
  | 'management-budget'
  | 'moh-regulatory';

export interface ReportEntry {
  id: string;
  name: string;
  group: string | null;
  /** One line describing what the report is for. Never a claim that it works. */
  summary: string;
  /** What is still needed before the full requested report can be delivered. */
  dependency: string;
  /** Implemented, scoped operational subset; null is an unavailable report. */
  engine: ReportEngineId | null;
  /** Reuse an existing document workflow rather than creating a second engine. */
  workflow: 'invoice' | 'laboratory' | 'radiology' | 'discharge' | null;
}

export interface ReportCategory {
  id: ReportCategoryId;
  name: string;
  description: string;
  reports: readonly ReportEntry[];
}

export const REPORT_LIBRARY: readonly ReportEntry[] = [
  {
    id: 'printables-sick-off-certificates',
    name: 'Sick-off certificates',
    group: null,
    summary: 'Certificates of sick leave issued to a patient.',
    dependency: 'Approved certificate, signatory and output.',
    engine: null,
    workflow: null,
  },
  {
    id: 'printables-medical-notes',
    name: 'Medical notes',
    group: null,
    summary: 'Clinical notes printed for referral or records.',
    dependency: 'Signed print template and referral workflow.',
    engine: null,
    workflow: null,
  },
  {
    id: 'printables-referral-letters',
    name: 'Referral letters',
    group: null,
    summary: 'Letters referring a patient to another facility.',
    dependency: 'Signed print template and referral workflow.',
    engine: null,
    workflow: null,
  },
  {
    id: 'printables-inpatient-statements',
    name: 'Inpatient statements',
    group: null,
    summary: 'Inpatient charges and payments for a stay.',
    dependency: 'Approved integrated printable output and clinical sign-off.',
    engine: null,
    workflow: null,
  },
  {
    id: 'printables-discharge-summaries',
    name: 'Discharge summaries',
    group: null,
    summary: 'Discharge summary for a completed admission.',
    dependency: 'Approved integrated printable output and clinical sign-off.',
    engine: null,
    workflow: 'discharge',
  },
  {
    id: 'printables-operation-notes',
    name: 'Operation notes',
    group: null,
    summary: 'Theatre operation notes for a completed procedure.',
    dependency: 'Structured authorized notes and approved printable output.',
    engine: null,
    workflow: null,
  },
  {
    id: 'printables-anaesthetist-notes',
    name: 'Anaesthetist notes',
    group: null,
    summary: 'Anaesthetic record for a theatre case.',
    dependency: 'Structured authorized notes and approved printable output.',
    engine: null,
    workflow: null,
  },
  {
    id: 'printables-bill-consent-forms',
    name: 'Bill consent forms',
    group: null,
    summary: 'Signed financial consent for treatment.',
    dependency: 'Financial-consent workflow, signatory and approved template.',
    engine: null,
    workflow: null,
  },
  {
    id: 'printables-radiology-reports',
    name: 'Radiology reports',
    group: null,
    summary: 'Radiology report for a completed imaging request.',
    dependency: 'Verified released result and approved print template.',
    engine: null,
    workflow: 'radiology',
  },
  {
    id: 'printables-laboratory-reports',
    name: 'Laboratory reports',
    group: null,
    summary: 'Laboratory report for a verified result.',
    dependency: 'Verified released result and approved print template.',
    engine: null,
    workflow: 'laboratory',
  },
  {
    id: 'printables-invoices',
    name: 'Invoices',
    group: null,
    summary: 'Finalized invoice document for a patient.',
    dependency: 'Real printable output and facility-approved template unverified.',
    engine: null,
    workflow: 'invoice',
  },
  {
    id: 'printables-receipts',
    name: 'Receipts',
    group: null,
    summary: 'Payment receipt issued at the cashier.',
    dependency: 'Standalone receipt print template.',
    engine: null,
    workflow: null,
  },
  {
    id: 'printables-purchase-requisitions',
    name: 'Purchase requisitions',
    group: null,
    summary: 'Requisition document raised by a department.',
    dependency: 'Requisition or receiving workflow and approved template.',
    engine: null,
    workflow: null,
  },
  {
    id: 'printables-local-purchase-orders',
    name: 'Local purchase orders',
    group: null,
    summary: 'Purchase order issued to a supplier.',
    dependency: 'Approved LPO output and print validation.',
    engine: null,
    workflow: null,
  },
  {
    id: 'printables-goods-received-notes',
    name: 'Goods received notes',
    group: null,
    summary: 'Goods received note for a delivery.',
    dependency: 'Requisition or receiving workflow and approved template.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-cashier-daily-summary',
    name: 'Cashier daily summary',
    group: null,
    summary: 'Receipts taken by one cashier on a day.',
    dependency:
      'Complete transaction-date data, cashier/department identity and verified reconciliation.',
    engine: 'cashier-receipts',
    workflow: null,
  },
  {
    id: 'financial-all-cashier-daily-summary',
    name: 'All-cashier daily summary',
    group: null,
    summary: 'Receipts taken by every cashier in the period.',
    dependency:
      'Complete transaction-date data, cashier/department identity and verified reconciliation.',
    engine: 'cashier-receipts',
    workflow: null,
  },
  {
    id: 'financial-department-receipt-summary',
    name: 'Department receipt summary',
    group: null,
    summary: 'Receipts summarised by department.',
    dependency:
      'Complete transaction-date data, cashier/department identity and verified reconciliation.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-department-receipt-breakdown',
    name: 'Department receipt breakdown',
    group: null,
    summary: 'Receipts broken down by department and method.',
    dependency:
      'Complete transaction-date data, cashier/department identity and verified reconciliation.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-managerial-daily-summary',
    name: 'Managerial daily summary',
    group: null,
    summary: 'Daily receipts and refunds for management.',
    dependency:
      'Complete transaction-date data, cashier/department identity and verified reconciliation.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-trial-balance',
    name: 'Trial balance',
    group: null,
    summary: 'Debit and credit balances by posted ledger account.',
    dependency:
      'Opening balances, posting completeness, mappings and source reconciliation; the available view is posted account movements only.',
    engine: 'ledger-trial-movements',
    workflow: null,
  },
  {
    id: 'financial-income-statement',
    name: 'Income statement',
    group: null,
    summary: 'Income and expenditure from posted journals.',
    dependency:
      'Posting completeness, recognized revenue/cost policies, account mappings and source reconciliation.',
    engine: 'ledger-income',
    workflow: null,
  },
  {
    id: 'financial-balance-sheet',
    name: 'Balance sheet',
    group: null,
    summary: 'Assets, liabilities and equity as posted.',
    dependency:
      'Posting completeness, opening balances, classification, account mappings and source reconciliation.',
    engine: 'ledger-balance-sheet',
    workflow: null,
  },
  {
    id: 'financial-monthly-profit-and-loss',
    name: 'Monthly profit and loss',
    group: null,
    summary: 'Monthly profit and loss from posted journals.',
    dependency:
      'Auto posting, mappings, costs and source reconciliation; current statements are not complete.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-cash-flow-statement',
    name: 'Cash flow statement',
    group: null,
    summary: 'Cash movements derived from posted journals.',
    dependency: 'Dedicated controlled workflow and reconciled classification.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-budget-management',
    name: 'Budget management',
    group: null,
    summary: 'Budget against actual expenditure.',
    dependency: 'Dedicated controlled workflow and reconciled classification.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-credit-notes',
    name: 'Credit notes',
    group: null,
    summary: 'Credit notes raised against invoices.',
    dependency: 'Dedicated controlled workflow and reconciled classification.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-waiver-reports',
    name: 'Waiver reports',
    group: null,
    summary: 'Charges waived and their recorded reasons.',
    dependency: 'Dedicated controlled workflow and reconciled classification.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-income-by-cashier',
    name: 'Income by cashier',
    group: null,
    summary: 'Income attributed to each cashier.',
    dependency:
      'Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-departmental-revenue',
    name: 'Departmental revenue',
    group: null,
    summary: 'Revenue recorded by department.',
    dependency:
      'Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-patient-outstanding-balances',
    name: 'Patient outstanding balances',
    group: null,
    summary: 'Invoices with a recorded outstanding balance.',
    dependency:
      'Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement.',
    engine: 'invoice-balances',
    workflow: null,
  },
  {
    id: 'financial-sha-receivables',
    name: 'SHA receivables',
    group: null,
    summary: 'Amounts owed by the Social Health Authority.',
    dependency:
      'Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-private-insurance-receivables',
    name: 'Private insurance receivables',
    group: null,
    summary: 'Amounts owed by private insurers.',
    dependency:
      'Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-m-pesa-reconciliation',
    name: 'M-Pesa reconciliation',
    group: null,
    summary: 'Mobile-money payments against recorded receipts.',
    dependency:
      'Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-card-payment-reconciliation',
    name: 'Card payment reconciliation',
    group: null,
    summary: 'Card payments against recorded receipts.',
    dependency:
      'Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement.',
    engine: null,
    workflow: null,
  },
  {
    id: 'financial-refund-reports',
    name: 'Refund reports',
    group: null,
    summary: 'Refunds paid and their authorisation.',
    dependency:
      'Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement.',
    engine: 'recorded-refunds',
    workflow: null,
  },
  {
    id: 'stock-goods-stock-usage',
    name: 'Stock usage',
    group: null,
    summary: 'Stock issued to departments in the period.',
    dependency: 'Complete movement/receipt/return ledger and report.',
    engine: null,
    workflow: null,
  },
  {
    id: 'stock-goods-stock-movements',
    name: 'Stock movements',
    group: null,
    summary: 'Every recorded movement of stock items.',
    dependency:
      'Recorded movement register only; historical opening/closing balances, cost valuation and completeness before movement capture are not established.',
    engine: 'inventory-movements',
    workflow: null,
  },
  {
    id: 'stock-goods-goods-received',
    name: 'Goods received',
    group: null,
    summary: 'Stock received into the stores.',
    dependency: 'Complete movement/receipt/return ledger and report.',
    engine: null,
    workflow: null,
  },
  {
    id: 'stock-goods-goods-returned',
    name: 'Goods returned',
    group: null,
    summary: 'Stock returned to the stores.',
    dependency: 'Complete movement/receipt/return ledger and report.',
    engine: null,
    workflow: null,
  },
  {
    id: 'stock-goods-lpo-summaries',
    name: 'LPO summaries',
    group: null,
    summary: 'Purchase orders and their suppliers.',
    dependency: 'Complete filtered/exportable report.',
    engine: 'purchase-orders',
    workflow: null,
  },
  {
    id: 'stock-goods-inward-invoices',
    name: 'Inward invoices',
    group: null,
    summary: 'Supplier invoices received against goods.',
    dependency: 'Stock-linked invoice classification and matching.',
    engine: null,
    workflow: null,
  },
  {
    id: 'stock-goods-outward-invoices',
    name: 'Outward invoices',
    group: null,
    summary: 'Issues invoiced out of the stores.',
    dependency: 'Stock-linked invoice classification and matching.',
    engine: null,
    workflow: null,
  },
  {
    id: 'stock-goods-bin-cards',
    name: 'Bin cards',
    group: null,
    summary: 'Bin-card history for an item.',
    dependency: 'Location-aware movement ledger, stocktake and transfers.',
    engine: null,
    workflow: null,
  },
  {
    id: 'stock-goods-inventory-by-store',
    name: 'Inventory by store',
    group: null,
    summary: 'Current balances by store location.',
    dependency: 'Complete safe grouping, historical/cost evidence, filters and export.',
    engine: 'inventory-store',
    workflow: null,
  },
  {
    id: 'stock-goods-inventory-by-category',
    name: 'Inventory by category',
    group: null,
    summary: 'Current balances by item category.',
    dependency: 'Complete safe grouping, historical/cost evidence, filters and export.',
    engine: 'inventory-category',
    workflow: null,
  },
  {
    id: 'stock-goods-expiry-reports',
    name: 'Expiry reports',
    group: null,
    summary: 'Batches approaching or past expiry.',
    dependency: 'Complete safe grouping, historical/cost evidence, filters and export.',
    engine: 'inventory-expiry',
    workflow: null,
  },
  {
    id: 'stock-goods-stock-variance',
    name: 'Stock variance',
    group: null,
    summary: 'Counting differences against recorded stock.',
    dependency: 'Location-aware movement ledger, stocktake and transfers.',
    engine: null,
    workflow: null,
  },
  {
    id: 'stock-goods-stock-transfers',
    name: 'Stock transfers',
    group: null,
    summary: 'Transfers between stores.',
    dependency: 'Location-aware movement ledger, stocktake and transfers.',
    engine: null,
    workflow: null,
  },
  {
    id: 'stock-goods-goods-price-lists',
    name: 'Goods price lists',
    group: null,
    summary: 'Recorded selling prices for items.',
    dependency: 'Complete safe grouping, historical/cost evidence, filters and export.',
    engine: null,
    workflow: null,
  },
  {
    id: 'stock-goods-supplier-reports',
    name: 'Supplier reports',
    group: null,
    summary: 'Supplier activity and recorded orders.',
    dependency: 'Complete safe grouping, historical/cost evidence, filters and export.',
    engine: null,
    workflow: null,
  },
  {
    id: 'stock-goods-stock-valuation',
    name: 'Stock valuation',
    group: null,
    summary: 'Stock value at recorded batch cost.',
    dependency: 'Complete safe grouping, historical/cost evidence, filters and export.',
    engine: null,
    workflow: null,
  },
  {
    id: 'stock-goods-asset-register',
    name: 'Asset register',
    group: null,
    summary: 'Fixed-asset register with recorded values.',
    dependency: 'Mounted asset, movement and maintenance workflows.',
    engine: null,
    workflow: null,
  },
  {
    id: 'stock-goods-asset-tracking',
    name: 'Asset tracking',
    group: null,
    summary: 'Movement of fixed assets between locations.',
    dependency: 'Mounted asset, movement and maintenance workflows.',
    engine: null,
    workflow: null,
  },
  {
    id: 'stock-goods-asset-maintenance',
    name: 'Asset maintenance',
    group: null,
    summary: 'Maintenance recorded against fixed assets.',
    dependency: 'Mounted asset, movement and maintenance workflows.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-opd-opd-attendance',
    name: 'OPD attendance',
    group: 'OPD',
    summary: 'Outpatient attendances recorded in the period.',
    dependency: 'Defined report events, referral lifecycle, clinician attribution and exports.',
    engine: 'outpatient-encounters',
    workflow: null,
  },
  {
    id: 'departmental-opd-consultation-reports',
    name: 'Consultation reports',
    group: 'OPD',
    summary: 'Consultations held in outpatient departments.',
    dependency: 'Defined report events, referral lifecycle, clinician attribution and exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-opd-diagnosis-reports',
    name: 'Diagnosis reports',
    group: 'OPD',
    summary: 'Diagnoses recorded during outpatient visits.',
    dependency:
      'Recorded encounter/diagnosis register only; deduplicated morbidity, verified MOH 705 definitions and facility acceptance remain outstanding.',
    engine: 'outpatient-diagnoses',
    workflow: null,
  },
  {
    id: 'departmental-opd-referral-reports',
    name: 'Referral reports',
    group: 'OPD',
    summary: 'Outpatient referrals made to other services.',
    dependency: 'Defined report events, referral lifecycle, clinician attribution and exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-opd-doctor-workload',
    name: 'Doctor workload',
    group: 'OPD',
    summary: 'Outpatient workload per clinician.',
    dependency: 'Defined report events, referral lifecycle, clinician attribution and exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-inpatient-current-inpatient-list',
    name: 'Current inpatient list',
    group: 'INPATIENT',
    summary: 'Patients currently admitted, with ward and bed.',
    dependency: 'Scoped detailed reports and reconciliation of billing; rate evidence and policy.',
    engine: 'current-inpatients',
    workflow: null,
  },
  {
    id: 'departmental-inpatient-admissions',
    name: 'Admissions',
    group: 'INPATIENT',
    summary: 'Admissions recorded in the period.',
    dependency: 'Scoped detailed reports and reconciliation of billing; rate evidence and policy.',
    engine: 'inpatient-admissions',
    workflow: null,
  },
  {
    id: 'departmental-inpatient-discharges',
    name: 'Discharges',
    group: 'INPATIENT',
    summary: 'Discharges recorded in the period.',
    dependency: 'Scoped detailed reports and reconciliation of billing; rate evidence and policy.',
    engine: 'inpatient-discharges',
    workflow: null,
  },
  {
    id: 'departmental-inpatient-ward-occupancy',
    name: 'Ward occupancy',
    group: 'INPATIENT',
    summary: 'Bed occupancy by ward.',
    dependency: 'Scoped detailed reports and reconciliation of billing; rate evidence and policy.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-inpatient-bed-billing',
    name: 'Bed billing',
    group: 'INPATIENT',
    summary: 'Bed charges accrued during admissions.',
    dependency: 'Scoped detailed reports and reconciliation of billing; rate evidence and policy.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-laboratory-test-reports',
    name: 'Test reports',
    group: 'LABORATORY',
    summary: 'Laboratory tests ordered and their status.',
    dependency: 'Precise result/release and timing rules, grouped reports and safe exports.',
    engine: 'laboratory-orders',
    workflow: null,
  },
  {
    id: 'departmental-laboratory-patient-reports',
    name: 'Patient reports',
    group: 'LABORATORY',
    summary: 'Laboratory activity grouped by patient.',
    dependency: 'Precise result/release and timing rules, grouped reports and safe exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-laboratory-specimen-reports',
    name: 'Specimen reports',
    group: 'LABORATORY',
    summary: 'Specimens received by the laboratory.',
    dependency: 'Precise result/release and timing rules, grouped reports and safe exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-laboratory-sample-reports',
    name: 'Sample reports',
    group: 'LABORATORY',
    summary: 'Samples logged by the laboratory.',
    dependency: 'Precise result/release and timing rules, grouped reports and safe exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-laboratory-section-reports',
    name: 'Section reports',
    group: 'LABORATORY',
    summary: 'Laboratory workload by section.',
    dependency: 'Precise result/release and timing rules, grouped reports and safe exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-laboratory-pending-results',
    name: 'Pending results',
    group: 'LABORATORY',
    summary: 'Orders awaiting a result or verification.',
    dependency: 'Precise result/release and timing rules, grouped reports and safe exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-laboratory-released-results',
    name: 'Released results',
    group: 'LABORATORY',
    summary: 'Results released to the patient or clinician.',
    dependency: 'Precise result/release and timing rules, grouped reports and safe exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-laboratory-turnaround-times',
    name: 'Turnaround times',
    group: 'LABORATORY',
    summary: 'Order-to-result turnaround times.',
    dependency: 'Precise result/release and timing rules, grouped reports and safe exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-radiology-imaging-requests',
    name: 'Imaging requests',
    group: 'RADIOLOGY',
    summary: 'Imaging requests and their status.',
    dependency: 'Completed procedure definition, report grouping; reconciled finance for revenue.',
    engine: 'radiology-requests',
    workflow: null,
  },
  {
    id: 'departmental-radiology-completed-procedures',
    name: 'Completed procedures',
    group: 'RADIOLOGY',
    summary: 'Completed imaging procedures.',
    dependency: 'Completed procedure definition, report grouping; reconciled finance for revenue.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-radiology-patient-reports',
    name: 'Patient reports',
    group: 'RADIOLOGY',
    summary: 'Radiology activity grouped by patient.',
    dependency: 'Completed procedure definition, report grouping; reconciled finance for revenue.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-radiology-radiology-revenue',
    name: 'Radiology revenue',
    group: 'RADIOLOGY',
    summary: 'Charges recorded for imaging.',
    dependency: 'Completed procedure definition, report grouping; reconciled finance for revenue.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-pharmacy-prescriptions',
    name: 'Prescriptions',
    group: 'PHARMACY',
    summary: 'Prescriptions written in the period.',
    dependency: 'Report filtering, full movement ledger and controlled returns.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-pharmacy-dispensing',
    name: 'Dispensing',
    group: 'PHARMACY',
    summary: 'Medicines dispensed from the pharmacy.',
    dependency: 'Report filtering, full movement ledger and controlled returns.',
    engine: 'pharmacy-dispensations',
    workflow: null,
  },
  {
    id: 'departmental-pharmacy-drug-movement',
    name: 'Drug movement',
    group: 'PHARMACY',
    summary: 'Pharmacy stock movement by medicine.',
    dependency: 'Report filtering, full movement ledger and controlled returns.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-pharmacy-returns',
    name: 'Returns',
    group: 'PHARMACY',
    summary: 'Medicines returned to the pharmacy.',
    dependency: 'Report filtering, full movement ledger and controlled returns.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-pharmacy-stock-and-expiry',
    name: 'Stock and expiry',
    group: 'PHARMACY',
    summary: 'Pharmacy stock levels and batch expiry.',
    dependency: 'Report filtering, full movement ledger and controlled returns.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-theatre-procedure-lists',
    name: 'Procedure lists',
    group: 'THEATRE',
    summary: 'Procedures performed in theatre.',
    dependency: 'Actual performed cases and utilization definitions.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-theatre-patient-procedure-reports',
    name: 'Patient procedure reports',
    group: 'THEATRE',
    summary: 'Theatre procedures grouped by patient.',
    dependency: 'Actual performed cases and utilization definitions.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-theatre-theatre-utilization',
    name: 'Theatre utilization',
    group: 'THEATRE',
    summary: 'Theatre utilisation and case counts.',
    dependency: 'Actual performed cases and utilization definitions.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-maternity-mch-anc',
    name: 'ANC',
    group: 'MATERNITY / MCH',
    summary: 'Antenatal care visits and registrations.',
    dependency: 'Validated grouped reports and privacy controls.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-maternity-mch-deliveries',
    name: 'Deliveries',
    group: 'MATERNITY / MCH',
    summary: 'Deliveries conducted at the facility.',
    dependency: 'Validated grouped reports and privacy controls.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-maternity-mch-postnatal',
    name: 'Postnatal',
    group: 'MATERNITY / MCH',
    summary: 'Postnatal care visits.',
    dependency: 'Validated grouped reports and privacy controls.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-maternity-mch-child-health',
    name: 'Child health',
    group: 'MATERNITY / MCH',
    summary: 'Child health and immunisation visits.',
    dependency: 'Validated grouped reports and privacy controls.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-dialysis-patient-sessions',
    name: 'Patient sessions',
    group: 'DIALYSIS',
    summary: 'Dialysis sessions by patient.',
    dependency: 'Clinician-verified session facts and reconciled billing; no inferred completion.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-dialysis-treatment-records',
    name: 'Treatment records',
    group: 'DIALYSIS',
    summary: 'Dialysis treatment records.',
    dependency: 'Clinician-verified session facts and reconciled billing; no inferred completion.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-dialysis-session-billing',
    name: 'Session billing',
    group: 'DIALYSIS',
    summary: 'Charges raised for dialysis sessions.',
    dependency: 'Clinician-verified session facts and reconciled billing; no inferred completion.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-social-work-waivers',
    name: 'Waivers',
    group: 'SOCIAL WORK',
    summary: 'Waivers approved through social work.',
    dependency: 'Approved, confidential case and waiver workflows.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-social-work-counselling',
    name: 'Counselling',
    group: 'SOCIAL WORK',
    summary: 'Counselling sessions recorded by social work.',
    dependency: 'Approved, confidential case and waiver workflows.',
    engine: null,
    workflow: null,
  },
  {
    id: 'departmental-social-work-patient-support-reports',
    name: 'Patient support reports',
    group: 'SOCIAL WORK',
    summary: 'Patient support recorded by social work.',
    dependency: 'Approved, confidential case and waiver workflows.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-birth-reports',
    name: 'Birth reports',
    group: null,
    summary: 'Births registered at the facility.',
    dependency:
      'Defined reporting data and relationships; cashier finance reconciliation where applicable.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-death-reports',
    name: 'Death reports',
    group: null,
    summary: 'Deaths recorded at the facility.',
    dependency:
      'Defined reporting data and relationships; cashier finance reconciliation where applicable.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-current-inpatient-lists',
    name: 'Current inpatient lists',
    group: null,
    summary: 'Inpatient register for the selected ward.',
    dependency:
      'Defined reporting data and relationships; cashier finance reconciliation where applicable.',
    engine: 'current-inpatients',
    workflow: null,
  },
  {
    id: 'records-patient-reports',
    name: 'Patient reports',
    group: null,
    summary: 'Patient register with recorded demographics.',
    dependency:
      'Complete longitudinal records and governed patient-report definitions; the available view covers facility registrations only.',
    engine: 'patient-registrations',
    workflow: null,
  },
  {
    id: 'records-patient-review-reports',
    name: 'Patient review reports',
    group: null,
    summary: 'Patients due or booked for review.',
    dependency:
      'Defined reporting data and relationships; cashier finance reconciliation where applicable.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-unregistered-patient-reports',
    name: 'Unregistered patient reports',
    group: null,
    summary: 'Patients without a completed registration.',
    dependency:
      'Defined reporting data and relationships; cashier finance reconciliation where applicable.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-referral-reports',
    name: 'Referral reports',
    group: null,
    summary: 'Referrals recorded in the period.',
    dependency:
      'Defined reporting data and relationships; cashier finance reconciliation where applicable.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-opd-diagnosis-reports',
    name: 'OPD diagnosis reports',
    group: null,
    summary: 'Outpatient diagnosis register.',
    dependency:
      'Recorded encounter/diagnosis register only; deduplicated morbidity, verified MOH 705 definitions and facility acceptance remain outstanding.',
    engine: 'outpatient-diagnoses',
    workflow: null,
  },
  {
    id: 'records-ipd-diagnosis-reports',
    name: 'IPD diagnosis reports',
    group: null,
    summary: 'Inpatient diagnosis register.',
    dependency:
      'Defined reporting data and relationships; cashier finance reconciliation where applicable.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-triage-analysis',
    name: 'Triage analysis',
    group: null,
    summary: 'Triage categories recorded at reception.',
    dependency:
      'Defined reporting data and relationships; cashier finance reconciliation where applicable.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-doctors-workload',
    name: "Doctors' workload",
    group: null,
    summary: 'Clinical workload per doctor.',
    dependency:
      'Defined reporting data and relationships; cashier finance reconciliation where applicable.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-nurses-workload',
    name: "Nurses' workload",
    group: null,
    summary: 'Clinical workload per nurse.',
    dependency:
      'Defined reporting data and relationships; cashier finance reconciliation where applicable.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-cashier-workload',
    name: 'Cashier workload',
    group: null,
    summary: 'Receipts and refunds handled per cashier.',
    dependency:
      'Defined reporting data and relationships; cashier finance reconciliation where applicable.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-inpatient-discharges',
    name: 'Inpatient discharges',
    group: null,
    summary: 'Inpatient discharge register.',
    dependency:
      'Defined reporting data and relationships; cashier finance reconciliation where applicable.',
    engine: 'inpatient-discharges',
    workflow: null,
  },
  {
    id: 'records-moh-505-idsr',
    name: 'MOH 505-IDSR',
    group: null,
    summary: 'MOH 505 integrated disease surveillance return.',
    dependency:
      'Current authoritative forms, indicator dictionaries, approved data mappings and submission process.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-moh-705a',
    name: 'MOH 705A',
    group: null,
    summary: 'MOH 705A outpatient summary return.',
    dependency:
      'Current authoritative forms, indicator dictionaries, approved data mappings and submission process.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-moh-705b',
    name: 'MOH 705B',
    group: null,
    summary: 'MOH 705B outpatient diagnosis return.',
    dependency:
      'Current authoritative forms, indicator dictionaries, approved data mappings and submission process.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-moh-717',
    name: 'MOH 717',
    group: null,
    summary: 'MOH 717 inpatient diagnosis return.',
    dependency:
      'Current authoritative forms, indicator dictionaries, approved data mappings and submission process.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-moh-301-ipd-admissions',
    name: 'MOH 301-IPD admissions',
    group: null,
    summary: 'MOH 301 inpatient admission register.',
    dependency:
      'Current authoritative forms, indicator dictionaries, approved data mappings and submission process.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-moh-204-opd-register',
    name: 'MOH 204-OPD register',
    group: null,
    summary: 'MOH 204 outpatient register.',
    dependency:
      'Current authoritative forms, indicator dictionaries, approved data mappings and submission process.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-moh-240-laboratory-and-radiology-reports',
    name: 'MOH 240 laboratory and radiology reports',
    group: null,
    summary: 'MOH 240 laboratory and radiology return.',
    dependency:
      'Current authoritative forms, indicator dictionaries, approved data mappings and submission process.',
    engine: null,
    workflow: null,
  },
  {
    id: 'records-moh-financial-reports',
    name: 'MOH financial reports',
    group: null,
    summary: 'Statutory financial returns.',
    dependency:
      'Current authoritative forms, indicator dictionaries, approved data mappings and submission process.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-employee-list',
    name: 'Employee list',
    group: null,
    summary: 'Staff establishment as recorded.',
    dependency: 'Employment register and HR-authorized report.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-employee-summaries',
    name: 'Employee summaries',
    group: null,
    summary: 'Staff grouped by department and role.',
    dependency: 'Employment register and HR-authorized report.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-salary-summaries',
    name: 'Salary summaries',
    group: null,
    summary: 'Payroll totals by period.',
    dependency: 'Payroll and approved current-year HR/KRA and secure payment policies.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-individual-payslips',
    name: 'Individual payslips',
    group: null,
    summary: 'Payslip for one employee.',
    dependency: 'Payroll and approved current-year HR/KRA and secure payment policies.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-all-payslips',
    name: 'All payslips',
    group: null,
    summary: 'Payslips for every employee in a period.',
    dependency: 'Payroll and approved current-year HR/KRA and secure payment policies.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-attendance',
    name: 'Attendance',
    group: null,
    summary: 'Recorded staff attendance.',
    dependency: 'Payroll and approved current-year HR/KRA and secure payment policies.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-overtime',
    name: 'Overtime',
    group: null,
    summary: 'Overtime recorded and paid.',
    dependency: 'Payroll and approved current-year HR/KRA and secure payment policies.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-leave-reports',
    name: 'Leave reports',
    group: null,
    summary: 'Leave taken and outstanding.',
    dependency: 'Payroll and approved current-year HR/KRA and secure payment policies.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-monthly-deductions',
    name: 'Monthly deductions',
    group: null,
    summary: 'Statutory and other monthly deductions.',
    dependency: 'Payroll and approved current-year HR/KRA and secure payment policies.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-monthly-bank-summaries',
    name: 'Monthly bank summaries',
    group: null,
    summary: 'Net pay by bank for a payroll period.',
    dependency: 'Payroll and approved current-year HR/KRA and secure payment policies.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-individual-bank-summaries',
    name: 'Individual bank summaries',
    group: null,
    summary: 'Net pay to one employee’s bank account.',
    dependency: 'Payroll and approved current-year HR/KRA and secure payment policies.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-p9a-reports',
    name: 'P9A reports',
    group: null,
    summary: 'P9A statutory payroll return.',
    dependency: 'Payroll and approved current-year HR/KRA and secure payment policies.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-p10-reports',
    name: 'P10 reports',
    group: null,
    summary: 'P10 statutory payroll return.',
    dependency: 'Payroll and approved current-year HR/KRA and secure payment policies.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-p10a-reports',
    name: 'P10A reports',
    group: null,
    summary: 'P10A statutory payroll return.',
    dependency: 'Payroll and approved current-year HR/KRA and secure payment policies.',
    engine: null,
    workflow: null,
  },
  {
    id: 'hr-locum-reports',
    name: 'Locum reports',
    group: null,
    summary: 'Locum engagements and payments.',
    dependency: 'Payroll and approved current-year HR/KRA and secure payment policies.',
    engine: null,
    workflow: null,
  },
  {
    id: 'activity-system-user-list',
    name: 'System user list',
    group: null,
    summary: 'Accounts with access to the system.',
    dependency:
      'Durable complete logs, server filtering/pagination, specific access policy and exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'activity-queue-reports',
    name: 'Queue reports',
    group: null,
    summary: 'Patient queues and waiting times.',
    dependency:
      'Durable complete logs, server filtering/pagination, specific access policy and exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'activity-complete-activity-logs',
    name: 'Complete activity logs',
    group: null,
    summary: 'Full system activity log.',
    dependency:
      'Durable complete logs, server filtering/pagination, specific access policy and exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'activity-activity-logs-by-user',
    name: 'Activity logs by user',
    group: null,
    summary: 'Activity log grouped by user.',
    dependency:
      'Durable complete logs, server filtering/pagination, specific access policy and exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'activity-failed-login-reports',
    name: 'Failed login reports',
    group: null,
    summary: 'Failed sign-in attempts.',
    dependency:
      'Durable complete logs, server filtering/pagination, specific access policy and exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'activity-patient-record-access-logs',
    name: 'Patient record access logs',
    group: null,
    summary: 'Who opened which patient record.',
    dependency:
      'Durable complete logs, server filtering/pagination, specific access policy and exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'activity-financial-approval-logs',
    name: 'Financial approval logs',
    group: null,
    summary: 'Approvals recorded for financial actions.',
    dependency:
      'Durable complete logs, server filtering/pagination, specific access policy and exports.',
    engine: null,
    workflow: null,
  },
  {
    id: 'activity-sms-reports',
    name: 'SMS reports',
    group: null,
    summary: 'SMS messages sent and their status.',
    dependency: 'Authorized provider and verified delivery events.',
    engine: null,
    workflow: null,
  },
  {
    id: 'activity-notification-delivery-reports',
    name: 'Notification delivery reports',
    group: null,
    summary: 'Notification delivery outcomes.',
    dependency: 'Authorized provider and verified delivery events.',
    engine: null,
    workflow: null,
  },
  {
    id: 'activity-messages-reports',
    name: 'Messages reports',
    group: null,
    summary: 'Messages exchanged with patients.',
    dependency: 'Message/delivery data and report definitions.',
    engine: null,
    workflow: null,
  },
  {
    id: 'activity-custom-administrative-reports',
    name: 'Custom administrative reports',
    group: null,
    summary: 'Administrative reports configured locally.',
    dependency: 'Governed report definitions or durable job-run failure records.',
    engine: null,
    workflow: null,
  },
  {
    id: 'activity-background-job-failures',
    name: 'Background job failures',
    group: null,
    summary: 'Background jobs that failed.',
    dependency: 'Governed report definitions or durable job-run failure records.',
    engine: null,
    workflow: null,
  },
];

const BY_ID = new Map(REPORT_LIBRARY.map((entry) => [entry.id, entry]));

/**
 * Category navigation, as explicit id lists so a report can never be silently
 * reclassified or lost: the integrity test asserts every entry is reachable
 * exactly once.
 */
const CATEGORY_ENTRIES: Record<ReportCategoryId, readonly string[]> = {
  clinical: [
    'printables-sick-off-certificates',
    'printables-medical-notes',
    'printables-referral-letters',
    'printables-inpatient-statements',
    'printables-discharge-summaries',
    'printables-operation-notes',
    'printables-anaesthetist-notes',
    'printables-bill-consent-forms',
    'departmental-opd-opd-attendance',
    'departmental-opd-consultation-reports',
    'departmental-opd-diagnosis-reports',
    'departmental-opd-referral-reports',
    'departmental-opd-doctor-workload',
    'departmental-inpatient-current-inpatient-list',
    'departmental-inpatient-admissions',
    'departmental-inpatient-discharges',
    'departmental-inpatient-ward-occupancy',
    'departmental-inpatient-bed-billing',
    'departmental-theatre-procedure-lists',
    'departmental-theatre-patient-procedure-reports',
    'departmental-theatre-theatre-utilization',
    'departmental-maternity-mch-anc',
    'departmental-maternity-mch-deliveries',
    'departmental-maternity-mch-postnatal',
    'departmental-maternity-mch-child-health',
    'departmental-dialysis-patient-sessions',
    'departmental-dialysis-treatment-records',
    'departmental-dialysis-session-billing',
    'departmental-social-work-counselling',
    'departmental-social-work-patient-support-reports',
    'records-birth-reports',
    'records-death-reports',
    'records-current-inpatient-lists',
    'records-patient-reports',
    'records-patient-review-reports',
    'records-unregistered-patient-reports',
    'records-referral-reports',
    'records-opd-diagnosis-reports',
    'records-ipd-diagnosis-reports',
    'records-triage-analysis',
    'records-inpatient-discharges',
  ],
  diagnostics: [
    'departmental-laboratory-test-reports',
    'departmental-laboratory-patient-reports',
    'departmental-laboratory-specimen-reports',
    'departmental-laboratory-sample-reports',
    'departmental-laboratory-section-reports',
    'departmental-laboratory-pending-results',
    'departmental-laboratory-released-results',
    'departmental-laboratory-turnaround-times',
    'departmental-radiology-imaging-requests',
    'departmental-radiology-completed-procedures',
    'departmental-radiology-patient-reports',
    'printables-radiology-reports',
    'printables-laboratory-reports',
  ],
  'finance-accounting': [
    'financial-trial-balance',
    'financial-income-statement',
    'financial-balance-sheet',
    'financial-monthly-profit-and-loss',
    'financial-cash-flow-statement',
    'stock-goods-asset-register',
    'stock-goods-asset-tracking',
    'stock-goods-asset-maintenance',
  ],
  'billing-revenue': [
    'financial-cashier-daily-summary',
    'financial-all-cashier-daily-summary',
    'financial-department-receipt-summary',
    'financial-department-receipt-breakdown',
    'financial-managerial-daily-summary',
    'financial-income-by-cashier',
    'financial-departmental-revenue',
    'financial-patient-outstanding-balances',
    'financial-sha-receivables',
    'financial-private-insurance-receivables',
    'financial-m-pesa-reconciliation',
    'financial-card-payment-reconciliation',
    'financial-credit-notes',
    'financial-waiver-reports',
    'financial-refund-reports',
    'departmental-radiology-radiology-revenue',
    'departmental-social-work-waivers',
    'records-cashier-workload',
    'printables-invoices',
    'printables-receipts',
  ],
  pharmacy: [
    'departmental-pharmacy-prescriptions',
    'departmental-pharmacy-dispensing',
    'departmental-pharmacy-drug-movement',
    'departmental-pharmacy-returns',
    'departmental-pharmacy-stock-and-expiry',
  ],
  inventory: [
    'stock-goods-inventory-by-store',
    'stock-goods-inventory-by-category',
    'stock-goods-stock-movements',
    'stock-goods-stock-usage',
    'stock-goods-goods-received',
    'stock-goods-goods-returned',
    'stock-goods-bin-cards',
    'stock-goods-stock-transfers',
    'stock-goods-stock-variance',
    'stock-goods-expiry-reports',
    'stock-goods-stock-valuation',
    'stock-goods-goods-price-lists',
    'stock-goods-inward-invoices',
    'stock-goods-outward-invoices',
  ],
  procurement: [
    'stock-goods-lpo-summaries',
    'stock-goods-supplier-reports',
    'printables-purchase-requisitions',
    'printables-local-purchase-orders',
    'printables-goods-received-notes',
  ],
  workforce: [
    'hr-employee-list',
    'hr-employee-summaries',
    'hr-salary-summaries',
    'hr-individual-payslips',
    'hr-all-payslips',
    'hr-attendance',
    'hr-overtime',
    'hr-leave-reports',
    'hr-monthly-deductions',
    'hr-monthly-bank-summaries',
    'hr-individual-bank-summaries',
    'hr-p9a-reports',
    'hr-p10-reports',
    'hr-p10a-reports',
    'hr-locum-reports',
    'records-doctors-workload',
    'records-nurses-workload',
  ],
  'management-budget': [
    'financial-budget-management',
    'activity-system-user-list',
    'activity-queue-reports',
    'activity-complete-activity-logs',
    'activity-activity-logs-by-user',
    'activity-failed-login-reports',
    'activity-patient-record-access-logs',
    'activity-financial-approval-logs',
    'activity-sms-reports',
    'activity-notification-delivery-reports',
    'activity-messages-reports',
    'activity-custom-administrative-reports',
    'activity-background-job-failures',
  ],
  'moh-regulatory': [
    'records-moh-204-opd-register',
    'records-moh-301-ipd-admissions',
    'records-moh-505-idsr',
    'records-moh-705a',
    'records-moh-705b',
    'records-moh-717',
    'records-moh-240-laboratory-and-radiology-reports',
    'records-moh-financial-reports',
  ],
};

const CATEGORY_META: ReadonlyArray<Omit<ReportCategory, 'reports'>> = [
  {
    id: 'clinical',
    name: 'Clinical & Patient',
    description:
      'Visits, admissions, theatre, maternity, dialysis and the clinical documents produced at this facility.',
  },
  {
    id: 'diagnostics',
    name: 'Laboratory & Radiology',
    description:
      'Laboratory and radiology workload, specimens, pending work, turnaround and released reports.',
  },
  {
    id: 'finance-accounting',
    name: 'Finance & Accounting',
    description:
      'Ledger statements and fixed assets, built from posted journals rather than invoice headers.',
  },
  {
    id: 'billing-revenue',
    name: 'Billing & Revenue',
    description:
      'Cashier receipts, invoice balances, receivables, waivers, refunds and reconciliation.',
  },
  {
    id: 'pharmacy',
    name: 'Pharmacy',
    description: 'Prescriptions, dispensing, medicine movement and pharmacy stock.',
  },
  {
    id: 'inventory',
    name: 'Inventory & Stock Management',
    description: 'Stock balances, movements, valuation and expiry across the stores.',
  },
  {
    id: 'procurement',
    name: 'Procurement & Supplier',
    description: 'Requisitions, purchase orders, goods received and supplier activity.',
  },
  {
    id: 'workforce',
    name: 'HR & Workforce',
    description: 'Staff establishment, clinical workload, payroll and statutory HR returns.',
  },
  {
    id: 'management-budget',
    name: 'Management & Budget',
    description: 'Budgets, administrative oversight, audit trails and operational queues.',
  },
  {
    id: 'moh-regulatory',
    name: 'MOH & Regulatory',
    description: 'Statutory Ministry of Health returns and regulatory registers.',
  },
];

function resolve(reportId: string, categoryId: ReportCategoryId): ReportEntry {
  const entry = BY_ID.get(reportId);
  if (!entry) throw new Error(`Report catalogue references an unknown report: ${reportId}`);
  const categories = Object.entries(CATEGORY_ENTRIES).filter(([, ids]) => ids.includes(reportId));
  if (categories.length !== 1)
    throw new Error(
      `Report ${reportId} must appear in exactly one category, found ${categories.length}`,
    );
  if (categories[0][0] !== categoryId)
    throw new Error(`Report ${reportId} is declared under two different categories`);
  return entry;
}

export const REPORT_CATEGORIES: readonly ReportCategory[] = CATEGORY_META.map((category) => ({
  ...category,
  reports: CATEGORY_ENTRIES[category.id].map((id) => resolve(id, category.id)),
}));

export const REPORT_ENTRY_BY_ID: ReadonlyMap<string, ReportEntry> = BY_ID;

/** Category metadata without resolving entries; used before the app renders. */
export const REPORT_CATEGORY_SUMMARIES = CATEGORY_META;

export type ReportImplementationStatus = 'available' | 'existing-document' | 'unavailable';

/**
 * What the catalogue can honestly say about one report. `available` means an
 * engine answers the request with a documented, scoped subset — not that the
 * full statutory report is finished.
 */
export function reportImplementation(entry: ReportEntry): {
  status: ReportImplementationStatus;
  label: string;
  detail: string;
} {
  if (entry.engine)
    return {
      status: 'available',
      label: 'Available',
      detail: 'Scoped operational report. Its limits are stated on the results.',
    };
  if (entry.workflow)
    return {
      status: 'existing-document',
      label: 'Existing document',
      detail: 'Opens the document workflow that already exists for this record.',
    };
  return {
    status: 'unavailable',
    label: 'Not implemented',
    detail: entry.dependency,
  };
}
