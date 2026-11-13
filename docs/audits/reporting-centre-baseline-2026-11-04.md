# Reporting centre baseline — 4 November 2026

**Baseline audited:** branch `arena/e088f11d-afyahub-hmis-kenya`, source commit `c403ccc9081c5b66b6fb3c5ebbbdc2f8b8fbf1b4`; taken **before** reporting-centre implementation. The earlier detailed evidence matrix is [`jalicare-medsmart-gap-analysis-2026-11-03.md`](jalicare-medsmart-gap-analysis-2026-11-03.md). No MedSmart screenshots were present in the workspace; the user-provided seven categories and report names are the information-architecture reference, not proof of visual parity.

The current `ReportsModule.tsx` has revenue, operations and occupancy views. `/api/analytics/revenue` uses invoice-creation cohorts, not reconciled transaction-date revenue. `/api/reporting/operations`, `/api/reporting/occupancy-trend` and the WIP `/api/reporting/financial-transactions` are present; the latter has an unmounted panel and limited synthetic coverage. Accounting trial/P&L/balance-sheet calculations are posted-journal-only, while the service explicitly states billing/payment reconciliation is not implemented. `reports.read` alone must not grant unrelated clinical/finance data. Scoped reports must additionally enforce domain permissions, facility identity, and module enablement on the server.

**Conventions:** status assesses the requested report/document, not a data table or menu. **PARTIALLY IMPLEMENTED** means relevant data, an operational workflow or an incomplete report exists; **IMPLEMENTED BUT NOT VERIFIED** means a plausible full path exists but the output has not been verified; **NOT IMPLEMENTED** means the requested workflow/output was not found; **BLOCKED** identifies missing authoritative inputs or reconciled data needed for safe delivery. Actual absence is also stated in the final column. This is a baseline, not a post-implementation claim.

| Category | Submenu | Requested report | Baseline status | Existing implementation / data | Missing capability / dependency |
|---|---|---|---|---|---|
| PRINTABLES | — | Sick-off certificates | **NOT IMPLEMENTED** | Clinical encounter fields only | Approved certificate, signatory and output. |
| PRINTABLES | — | Medical notes | **PARTIALLY IMPLEMENTED** | OPD encounter notes and referral schema | Signed print template and referral workflow. |
| PRINTABLES | — | Referral letters | **PARTIALLY IMPLEMENTED** | OPD encounter notes and referral schema | Signed print template and referral workflow. |
| PRINTABLES | — | Inpatient statements | **PARTIALLY IMPLEMENTED** | Admissions, billing and portal discharge data | Approved integrated printable output and clinical sign-off. |
| PRINTABLES | — | Discharge summaries | **PARTIALLY IMPLEMENTED** | Admissions, billing and portal discharge data | Approved integrated printable output and clinical sign-off. |
| PRINTABLES | — | Operation notes | **PARTIALLY IMPLEMENTED** | Theatre cases / scheduling | Structured authorized notes and approved printable output. |
| PRINTABLES | — | Anaesthetist notes | **PARTIALLY IMPLEMENTED** | Theatre cases / scheduling | Structured authorized notes and approved printable output. |
| PRINTABLES | — | Bill consent forms | **NOT IMPLEMENTED** | General consent schema only | Financial-consent workflow, signatory and approved template. |
| PRINTABLES | — | Radiology reports | **PARTIALLY IMPLEMENTED** | Radiology text and lab orders/results | Verified released result and approved print template. |
| PRINTABLES | — | Laboratory reports | **PARTIALLY IMPLEMENTED** | Radiology text and lab orders/results | Verified released result and approved print template. |
| PRINTABLES | — | Invoices | **IMPLEMENTED BUT NOT VERIFIED** | FinalizedInvoicePanel and invoice finalization/print audit | Real printable output and facility-approved template unverified. |
| PRINTABLES | — | Receipts | **PARTIALLY IMPLEMENTED** | Payment receipt history in finalized invoice | Standalone receipt print template. |
| PRINTABLES | — | Purchase requisitions | **NOT IMPLEMENTED** | PO / inventory only | Requisition or receiving workflow and approved template. |
| PRINTABLES | — | Goods received notes | **NOT IMPLEMENTED** | PO / inventory only | Requisition or receiving workflow and approved template. |
| PRINTABLES | — | Local purchase orders | **PARTIALLY IMPLEMENTED** | Procurement PO create/approve | Approved LPO output and print validation. |
| FINANCIAL | — | Cashier daily summary | **BLOCKED** | Legacy invoice-cohort analytics; WIP transaction endpoint unmounted | Complete transaction-date data, cashier/department identity and verified reconciliation. |
| FINANCIAL | — | All-cashier daily summary | **BLOCKED** | Legacy invoice-cohort analytics; WIP transaction endpoint unmounted | Complete transaction-date data, cashier/department identity and verified reconciliation. |
| FINANCIAL | — | Department receipt summary | **BLOCKED** | Legacy invoice-cohort analytics; WIP transaction endpoint unmounted | Complete transaction-date data, cashier/department identity and verified reconciliation. |
| FINANCIAL | — | Department receipt breakdown | **BLOCKED** | Legacy invoice-cohort analytics; WIP transaction endpoint unmounted | Complete transaction-date data, cashier/department identity and verified reconciliation. |
| FINANCIAL | — | Managerial daily summary | **BLOCKED** | Legacy invoice-cohort analytics; WIP transaction endpoint unmounted | Complete transaction-date data, cashier/department identity and verified reconciliation. |
| FINANCIAL | — | Trial balance | **PARTIALLY IMPLEMENTED** | AccountingModule and posted-journal ledger statements | Auto posting, mappings, costs and source reconciliation; current statements are not complete. |
| FINANCIAL | — | Income statement | **PARTIALLY IMPLEMENTED** | AccountingModule and posted-journal ledger statements | Auto posting, mappings, costs and source reconciliation; current statements are not complete. |
| FINANCIAL | — | Balance sheet | **PARTIALLY IMPLEMENTED** | AccountingModule and posted-journal ledger statements | Auto posting, mappings, costs and source reconciliation; current statements are not complete. |
| FINANCIAL | — | Monthly profit and loss | **PARTIALLY IMPLEMENTED** | AccountingModule and posted-journal ledger statements | Auto posting, mappings, costs and source reconciliation; current statements are not complete. |
| FINANCIAL | — | Cash flow statement | **NOT IMPLEMENTED** | Journals / billing records only | Dedicated controlled workflow and reconciled classification. |
| FINANCIAL | — | Budget management | **NOT IMPLEMENTED** | Journals / billing records only | Dedicated controlled workflow and reconciled classification. |
| FINANCIAL | — | Credit notes | **NOT IMPLEMENTED** | Journals / billing records only | Dedicated controlled workflow and reconciled classification. |
| FINANCIAL | — | Waiver reports | **NOT IMPLEMENTED** | Journals / billing records only | Dedicated controlled workflow and reconciled classification. |
| FINANCIAL | — | Income by cashier | **BLOCKED** | Invoices, payer claims, payment/refund records | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| FINANCIAL | — | Departmental revenue | **BLOCKED** | Invoices, payer claims, payment/refund records | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| FINANCIAL | — | Patient outstanding balances | **BLOCKED** | Invoices, payer claims, payment/refund records | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| FINANCIAL | — | SHA receivables | **BLOCKED** | Invoices, payer claims, payment/refund records | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| FINANCIAL | — | Private insurance receivables | **BLOCKED** | Invoices, payer claims, payment/refund records | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| FINANCIAL | — | M-Pesa reconciliation | **BLOCKED** | Invoices, payer claims, payment/refund records | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| FINANCIAL | — | Card payment reconciliation | **BLOCKED** | Invoices, payer claims, payment/refund records | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| FINANCIAL | — | Refund reports | **BLOCKED** | Invoices, payer claims, payment/refund records | Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. |
| STOCK / GOODS | — | Stock usage | **PARTIALLY IMPLEMENTED** | Inventory batches and pharmacy dispensing | Complete movement/receipt/return ledger and report. |
| STOCK / GOODS | — | Stock movements | **PARTIALLY IMPLEMENTED** | Inventory batches and pharmacy dispensing | Complete movement/receipt/return ledger and report. |
| STOCK / GOODS | — | Goods received | **PARTIALLY IMPLEMENTED** | Inventory batches and pharmacy dispensing | Complete movement/receipt/return ledger and report. |
| STOCK / GOODS | — | Goods returned | **PARTIALLY IMPLEMENTED** | Inventory batches and pharmacy dispensing | Complete movement/receipt/return ledger and report. |
| STOCK / GOODS | — | LPO summaries | **PARTIALLY IMPLEMENTED** | Procurement purchase orders and events | Complete filtered/exportable report. |
| STOCK / GOODS | — | Inward invoices | **NOT IMPLEMENTED** | Supplier-invoice schema; patient invoice workflow | Stock-linked invoice classification and matching. |
| STOCK / GOODS | — | Outward invoices | **NOT IMPLEMENTED** | Supplier-invoice schema; patient invoice workflow | Stock-linked invoice classification and matching. |
| STOCK / GOODS | — | Bin cards | **NOT IMPLEMENTED** | Inventory items/batches only | Location-aware movement ledger, stocktake and transfers. |
| STOCK / GOODS | — | Stock variance | **NOT IMPLEMENTED** | Inventory items/batches only | Location-aware movement ledger, stocktake and transfers. |
| STOCK / GOODS | — | Stock transfers | **NOT IMPLEMENTED** | Inventory items/batches only | Location-aware movement ledger, stocktake and transfers. |
| STOCK / GOODS | — | Inventory by store | **PARTIALLY IMPLEMENTED** | Inventory items, batches, expiry summary and suppliers | Complete safe grouping, historical/cost evidence, filters and export. |
| STOCK / GOODS | — | Inventory by category | **PARTIALLY IMPLEMENTED** | Inventory items, batches, expiry summary and suppliers | Complete safe grouping, historical/cost evidence, filters and export. |
| STOCK / GOODS | — | Expiry reports | **PARTIALLY IMPLEMENTED** | Inventory items, batches, expiry summary and suppliers | Complete safe grouping, historical/cost evidence, filters and export. |
| STOCK / GOODS | — | Goods price lists | **PARTIALLY IMPLEMENTED** | Inventory items, batches, expiry summary and suppliers | Complete safe grouping, historical/cost evidence, filters and export. |
| STOCK / GOODS | — | Supplier reports | **PARTIALLY IMPLEMENTED** | Inventory items, batches, expiry summary and suppliers | Complete safe grouping, historical/cost evidence, filters and export. |
| STOCK / GOODS | — | Stock valuation | **PARTIALLY IMPLEMENTED** | Inventory items, batches, expiry summary and suppliers | Complete safe grouping, historical/cost evidence, filters and export. |
| STOCK / GOODS | — | Asset register | **NOT IMPLEMENTED** | Fixed asset tables only | Mounted asset, movement and maintenance workflows. |
| STOCK / GOODS | — | Asset tracking | **NOT IMPLEMENTED** | Fixed asset tables only | Mounted asset, movement and maintenance workflows. |
| STOCK / GOODS | — | Asset maintenance | **NOT IMPLEMENTED** | Fixed asset tables only | Mounted asset, movement and maintenance workflows. |
| DEPARTMENTAL | OPD | OPD attendance | **PARTIALLY IMPLEMENTED** | Encounters, diagnoses and notes | Defined report events, referral lifecycle, clinician attribution and exports. |
| DEPARTMENTAL | OPD | Consultation reports | **PARTIALLY IMPLEMENTED** | Encounters, diagnoses and notes | Defined report events, referral lifecycle, clinician attribution and exports. |
| DEPARTMENTAL | OPD | Diagnosis reports | **PARTIALLY IMPLEMENTED** | Encounters, diagnoses and notes | Defined report events, referral lifecycle, clinician attribution and exports. |
| DEPARTMENTAL | OPD | Referral reports | **PARTIALLY IMPLEMENTED** | Encounters, diagnoses and notes | Defined report events, referral lifecycle, clinician attribution and exports. |
| DEPARTMENTAL | OPD | Doctor workload | **PARTIALLY IMPLEMENTED** | Encounters, diagnoses and notes | Defined report events, referral lifecycle, clinician attribution and exports. |
| DEPARTMENTAL | INPATIENT | Current inpatient list | **PARTIALLY IMPLEMENTED** | Admissions, wards, beds, bed billing; operations report | Scoped detailed reports and reconciliation of billing; rate evidence and policy. |
| DEPARTMENTAL | INPATIENT | Admissions | **PARTIALLY IMPLEMENTED** | Admissions, wards, beds, bed billing; operations report | Scoped detailed reports and reconciliation of billing; rate evidence and policy. |
| DEPARTMENTAL | INPATIENT | Discharges | **PARTIALLY IMPLEMENTED** | Admissions, wards, beds, bed billing; operations report | Scoped detailed reports and reconciliation of billing; rate evidence and policy. |
| DEPARTMENTAL | INPATIENT | Ward occupancy | **PARTIALLY IMPLEMENTED** | Admissions, wards, beds, bed billing; operations report | Scoped detailed reports and reconciliation of billing; rate evidence and policy. |
| DEPARTMENTAL | INPATIENT | Bed billing | **PARTIALLY IMPLEMENTED** | Admissions, wards, beds, bed billing; operations report | Scoped detailed reports and reconciliation of billing; rate evidence and policy. |
| DEPARTMENTAL | LABORATORY | Test reports | **PARTIALLY IMPLEMENTED** | Lab worklists, specimens, orders and results | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL | LABORATORY | Patient reports | **PARTIALLY IMPLEMENTED** | Lab worklists, specimens, orders and results | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL | LABORATORY | Specimen reports | **PARTIALLY IMPLEMENTED** | Lab worklists, specimens, orders and results | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL | LABORATORY | Sample reports | **PARTIALLY IMPLEMENTED** | Lab worklists, specimens, orders and results | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL | LABORATORY | Section reports | **PARTIALLY IMPLEMENTED** | Lab worklists, specimens, orders and results | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL | LABORATORY | Pending results | **PARTIALLY IMPLEMENTED** | Lab worklists, specimens, orders and results | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL | LABORATORY | Released results | **PARTIALLY IMPLEMENTED** | Lab worklists, specimens, orders and results | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL | LABORATORY | Turnaround times | **PARTIALLY IMPLEMENTED** | Lab worklists, specimens, orders and results | Precise result/release and timing rules, grouped reports and safe exports. |
| DEPARTMENTAL | RADIOLOGY | Imaging requests | **PARTIALLY IMPLEMENTED** | Radiology orders and text results | Completed procedure definition, report grouping; reconciled finance for revenue. |
| DEPARTMENTAL | RADIOLOGY | Completed procedures | **PARTIALLY IMPLEMENTED** | Radiology orders and text results | Completed procedure definition, report grouping; reconciled finance for revenue. |
| DEPARTMENTAL | RADIOLOGY | Patient reports | **PARTIALLY IMPLEMENTED** | Radiology orders and text results | Completed procedure definition, report grouping; reconciled finance for revenue. |
| DEPARTMENTAL | RADIOLOGY | Radiology revenue | **PARTIALLY IMPLEMENTED** | Radiology orders and text results | Completed procedure definition, report grouping; reconciled finance for revenue. |
| DEPARTMENTAL | PHARMACY | Prescriptions | **PARTIALLY IMPLEMENTED** | Medications, dispensation, inventory and batch expiry | Report filtering, full movement ledger and controlled returns. |
| DEPARTMENTAL | PHARMACY | Dispensing | **PARTIALLY IMPLEMENTED** | Medications, dispensation, inventory and batch expiry | Report filtering, full movement ledger and controlled returns. |
| DEPARTMENTAL | PHARMACY | Drug movement | **PARTIALLY IMPLEMENTED** | Medications, dispensation, inventory and batch expiry | Report filtering, full movement ledger and controlled returns. |
| DEPARTMENTAL | PHARMACY | Returns | **PARTIALLY IMPLEMENTED** | Medications, dispensation, inventory and batch expiry | Report filtering, full movement ledger and controlled returns. |
| DEPARTMENTAL | PHARMACY | Stock and expiry | **PARTIALLY IMPLEMENTED** | Medications, dispensation, inventory and batch expiry | Report filtering, full movement ledger and controlled returns. |
| DEPARTMENTAL | THEATRE | Procedure lists | **PARTIALLY IMPLEMENTED** | Theatre cases and planned schedule aggregate | Actual performed cases and utilization definitions. |
| DEPARTMENTAL | THEATRE | Patient procedure reports | **PARTIALLY IMPLEMENTED** | Theatre cases and planned schedule aggregate | Actual performed cases and utilization definitions. |
| DEPARTMENTAL | THEATRE | Theatre utilization | **PARTIALLY IMPLEMENTED** | Theatre cases and planned schedule aggregate | Actual performed cases and utilization definitions. |
| DEPARTMENTAL | MATERNITY / MCH | ANC | **PARTIALLY IMPLEMENTED** | Maternity and immunisation records | Validated grouped reports and privacy controls. |
| DEPARTMENTAL | MATERNITY / MCH | Deliveries | **PARTIALLY IMPLEMENTED** | Maternity and immunisation records | Validated grouped reports and privacy controls. |
| DEPARTMENTAL | MATERNITY / MCH | Postnatal | **PARTIALLY IMPLEMENTED** | Maternity and immunisation records | Validated grouped reports and privacy controls. |
| DEPARTMENTAL | MATERNITY / MCH | Child health | **PARTIALLY IMPLEMENTED** | Maternity and immunisation records | Validated grouped reports and privacy controls. |
| DEPARTMENTAL | DIALYSIS | Patient sessions | **PARTIALLY IMPLEMENTED** | Dialysis module/session schema and billing references | Clinician-verified session facts and reconciled billing; no inferred completion. |
| DEPARTMENTAL | DIALYSIS | Treatment records | **PARTIALLY IMPLEMENTED** | Dialysis module/session schema and billing references | Clinician-verified session facts and reconciled billing; no inferred completion. |
| DEPARTMENTAL | DIALYSIS | Session billing | **PARTIALLY IMPLEMENTED** | Dialysis module/session schema and billing references | Clinician-verified session facts and reconciled billing; no inferred completion. |
| DEPARTMENTAL | SOCIAL WORK | Waivers | **NOT IMPLEMENTED** | No dedicated social work/counselling workflow found | Approved, confidential case and waiver workflows. |
| DEPARTMENTAL | SOCIAL WORK | Counselling | **NOT IMPLEMENTED** | No dedicated social work/counselling workflow found | Approved, confidential case and waiver workflows. |
| DEPARTMENTAL | SOCIAL WORK | Patient support reports | **NOT IMPLEMENTED** | No dedicated social work/counselling workflow found | Approved, confidential case and waiver workflows. |
| RECORDS | — | Birth reports | **PARTIALLY IMPLEMENTED** | Patient, encounter, maternity and inpatient records | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | — | Death reports | **PARTIALLY IMPLEMENTED** | Patient, encounter, maternity and inpatient records | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | — | Current inpatient lists | **PARTIALLY IMPLEMENTED** | Patient, encounter, maternity and inpatient records | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | — | Patient reports | **PARTIALLY IMPLEMENTED** | Patient, encounter, maternity and inpatient records | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | — | Patient review reports | **PARTIALLY IMPLEMENTED** | Patient, encounter, maternity and inpatient records | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | — | Unregistered patient reports | **PARTIALLY IMPLEMENTED** | Patient, encounter, maternity and inpatient records | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | — | Referral reports | **PARTIALLY IMPLEMENTED** | Patient, encounter, maternity and inpatient records | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | — | OPD diagnosis reports | **PARTIALLY IMPLEMENTED** | Patient, encounter, maternity and inpatient records | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | — | IPD diagnosis reports | **PARTIALLY IMPLEMENTED** | Patient, encounter, maternity and inpatient records | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | — | Triage analysis | **PARTIALLY IMPLEMENTED** | Patient, encounter, maternity and inpatient records | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | — | Doctors' workload | **PARTIALLY IMPLEMENTED** | Patient, encounter, maternity and inpatient records | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | — | Nurses' workload | **PARTIALLY IMPLEMENTED** | Patient, encounter, maternity and inpatient records | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | — | Cashier workload | **PARTIALLY IMPLEMENTED** | Patient, encounter, maternity and inpatient records | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | — | Inpatient discharges | **PARTIALLY IMPLEMENTED** | Patient, encounter, maternity and inpatient records | Defined reporting data and relationships; cashier finance reconciliation where applicable. |
| RECORDS | — | MOH 505-IDSR | **BLOCKED** | Manual notifiable disease entries; MOH 705 endpoint explicitly 501 | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| RECORDS | — | MOH 705A | **BLOCKED** | Manual notifiable disease entries; MOH 705 endpoint explicitly 501 | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| RECORDS | — | MOH 705B | **BLOCKED** | Manual notifiable disease entries; MOH 705 endpoint explicitly 501 | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| RECORDS | — | MOH 717 | **BLOCKED** | Manual notifiable disease entries; MOH 705 endpoint explicitly 501 | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| RECORDS | — | MOH 301-IPD admissions | **BLOCKED** | Manual notifiable disease entries; MOH 705 endpoint explicitly 501 | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| RECORDS | — | MOH 204-OPD register | **BLOCKED** | Manual notifiable disease entries; MOH 705 endpoint explicitly 501 | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| RECORDS | — | MOH 240 laboratory and radiology reports | **BLOCKED** | Manual notifiable disease entries; MOH 705 endpoint explicitly 501 | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| RECORDS | — | MOH financial reports | **BLOCKED** | Manual notifiable disease entries; MOH 705 endpoint explicitly 501 | Current authoritative forms, indicator dictionaries, approved data mappings and submission process. |
| HR | — | Employee list | **PARTIALLY IMPLEMENTED** | Staff user/role directory | Employment register and HR-authorized report. |
| HR | — | Employee summaries | **PARTIALLY IMPLEMENTED** | Staff user/role directory | Employment register and HR-authorized report. |
| HR | — | Salary summaries | **BLOCKED** | No payroll/attendance/leave engine found | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | — | Individual payslips | **BLOCKED** | No payroll/attendance/leave engine found | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | — | All payslips | **BLOCKED** | No payroll/attendance/leave engine found | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | — | Attendance | **BLOCKED** | No payroll/attendance/leave engine found | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | — | Overtime | **BLOCKED** | No payroll/attendance/leave engine found | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | — | Leave reports | **BLOCKED** | No payroll/attendance/leave engine found | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | — | Monthly deductions | **BLOCKED** | No payroll/attendance/leave engine found | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | — | Monthly bank summaries | **BLOCKED** | No payroll/attendance/leave engine found | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | — | Individual bank summaries | **BLOCKED** | No payroll/attendance/leave engine found | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | — | P9A reports | **BLOCKED** | No payroll/attendance/leave engine found | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | — | P10 reports | **BLOCKED** | No payroll/attendance/leave engine found | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | — | P10A reports | **BLOCKED** | No payroll/attendance/leave engine found | Payroll and approved current-year HR/KRA and secure payment policies. |
| HR | — | Locum reports | **BLOCKED** | No payroll/attendance/leave engine found | Payroll and approved current-year HR/KRA and secure payment policies. |
| ACTIVITY | — | System user list | **PARTIALLY IMPLEMENTED** | Staff directory, current queues, audit logs and login/access records | Durable complete logs, server filtering/pagination, specific access policy and exports. |
| ACTIVITY | — | Queue reports | **PARTIALLY IMPLEMENTED** | Staff directory, current queues, audit logs and login/access records | Durable complete logs, server filtering/pagination, specific access policy and exports. |
| ACTIVITY | — | Complete activity logs | **PARTIALLY IMPLEMENTED** | Staff directory, current queues, audit logs and login/access records | Durable complete logs, server filtering/pagination, specific access policy and exports. |
| ACTIVITY | — | Activity logs by user | **PARTIALLY IMPLEMENTED** | Staff directory, current queues, audit logs and login/access records | Durable complete logs, server filtering/pagination, specific access policy and exports. |
| ACTIVITY | — | Failed login reports | **PARTIALLY IMPLEMENTED** | Staff directory, current queues, audit logs and login/access records | Durable complete logs, server filtering/pagination, specific access policy and exports. |
| ACTIVITY | — | Patient record access logs | **PARTIALLY IMPLEMENTED** | Staff directory, current queues, audit logs and login/access records | Durable complete logs, server filtering/pagination, specific access policy and exports. |
| ACTIVITY | — | Financial approval logs | **PARTIALLY IMPLEMENTED** | Staff directory, current queues, audit logs and login/access records | Durable complete logs, server filtering/pagination, specific access policy and exports. |
| ACTIVITY | — | SMS reports | **BLOCKED** | In-app notification inbox; no configured SMS provider | Authorized provider and verified delivery events. |
| ACTIVITY | — | Notification delivery reports | **BLOCKED** | In-app notification inbox; no configured SMS provider | Authorized provider and verified delivery events. |
| ACTIVITY | — | Messages reports | **PARTIALLY IMPLEMENTED** | In-app notification inbox | Message/delivery data and report definitions. |
| ACTIVITY | — | Custom administrative reports | **NOT IMPLEMENTED** | No corresponding generic reporting engine found | Governed report definitions or durable job-run failure records. |
| ACTIVITY | — | Background job failures | **NOT IMPLEMENTED** | No corresponding generic reporting engine found | Governed report definitions or durable job-run failure records. |

## Evidence and safeguards

- Frontend: `src/components/modules/ReportsModule.tsx`, `AccountingModule.tsx`, `FinalizedInvoicePanel.tsx`, `InpatientModule.tsx`, `LaboratoryModule.tsx`, `RadiologyModule.tsx`, `InventoryModule.tsx`, `ProcurementModule.tsx`, `AuditLogModule.tsx`; mounted via `src/App.tsx` and `Sidebar.tsx`.
- APIs: `src/routes/domains/billing-analytics.routes.ts`, `src/routes/accounting.routes.ts`, `src/routes/inpatient.routes.ts`, `src/routes/laboratory.routes.ts`, `src/routes/pharmacy.routes.ts`, `src/routes/procurement.routes.ts`, `src/routes/domains/interop.routes.ts`.
- Data: `src/db/schema/{billing,financial-ledger,banking,clinical,inpatient,laboratory,lab-specimens,inventory,patients,maternity,auth,public-health}.ts` and `drizzle/meta/_journal.json` through 0066. A table alone is not an implemented report.
- Utilities: `src/reporting/reporting.service.ts`, `reporting-contracts.ts`, `financial-transactions.service.ts`, `src/dashboard/date-range.ts`, `timezone.ts`, existing scoped authorization and notification/audit helpers.
- Tests: `src/tests/reporting.spec.ts`, `src/tests/integration/dashboard.db.spec.ts`, `billing-posting.db.spec.ts`, `inpatient-bed-billing.db.spec.ts`, `pharmacy-inventory-billing.db.spec.ts`, `laboratory-facility-identity.db.spec.ts` and prior focused run. Their scope is limited; no report is complete merely because an underlying workflow is tested.
- Approved financial mappings, reconciled ledger/bank/payer/provider outcomes, statutory MOH/KRA forms, payroll data and approved clinical document templates were not supplied. Do not fabricate these, silently infer missing data, alter historical clinical/financial records, or mark a placeholder complete.
- `reports.export` exists in the permission seed and must supplement report/domain read permission for sensitive print/export. Facility and patient scopes are enforced server-side; no super-administrator finance bypass. Database tests use only new synthetic PostgreSQL, with no destructive operation on existing data.
