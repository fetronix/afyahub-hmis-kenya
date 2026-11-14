# JaliCare HMIS — MedSmart checklist gap analysis

**Date:** 3 November 2026

**Audited repository and branch:** `fetronix/afyahub-hmis-kenya`, `arena/e088f11d-afyahub-hmis-kenya` at **`7f5a03e03ae06f8dae541a77d3900b1f8181cbc0`**.

**Comparison baseline:** GitHub `main` at `63903c5`; this audit includes WIP additions on the branch and must not be represented as a main-branch release.

**Scope:** analysis only; no feature implementation, production data access, data deletion or production migration. No MedSmart screenshots were attached or found; the supplied checklist is the reference. Visual layout, exact labels, filters, and parity with the reference screens remain unverified. Please supply the screenshots, preferably unredacted only if they contain no real patient or credential data.

## Executive findings

1. **The financial statements are not proven to reflect complete reconciled accounting.** Trial balance, profit and loss, and balance sheet aggregate posted journals, but the accounting service explicitly says billing/payment are not automatically posted or reconciled. A manual, explicit source-posting API exists and its synthetic database tests passed; that is not automatic source coverage or bank settlement. This is the principal prerequisite for accurate finance reports.
2. **Many report names have no complete report behind them.** A working transaction, saved data, visible worklist, schema table or dashboard tile is not a verified departmental, statutory or printable report. The matrix assesses the requested output, not just its underlying records.
3. **Some functionality should be preserved, not rebuilt.** Scoped patient search, clinical workflows, invoice finalization/payment, controlled journal primitives, pharmacy dispensing, theatre scheduling, supplier/PO workflows and notification read-state contain useful tested foundations. Their tests do not mean every requested feature is complete.
4. **MOH and payroll compliance are not established.** MOH 705 explicitly returns HTTP 501. Manual notifiable-disease records are not a verified MOH 505 form or submission. Payroll and statutory form generators were not found. Obtain current authoritative specifications before designing calculations.
5. **Production release is not currently validated by CI.** The latest WIP CI run passed build, typecheck/lint, dependency audit, formatting and its limited migration/database job, but failed coverage and fresh Docker bootstrap. Coverage annotations identify three synthetic-fixture guards; Docker's root cause is unknown because its log download failed. See [WIP CI run](https://github.com/fetronix/afyahub-hmis-kenya/actions/runs/41599352360).
6. **Security remediation remains open.** Previously identified sensitive dump paths are absent at HEAD but remain in public Git history; a tracked-path guard does not remove historical objects. Owner-led containment, credential rotation, history/copy remediation and incident assessment require separate authorization.

## Method and evidence limits

- Traced mounted UI/components, API routes and authorization, schema relationships, relevant service calculations, and existing tests. “No ... found” means no matching end-to-end implementation was found in the inspected branch; it is not proof that every possible dead or external code path was exhaustively examined.
- A **new isolated synthetic PostgreSQL 16 database** on loopback was created for this audit; **all 67 migrations** through `0066` applied successfully. No existing database was reset or deleted. Synthetic migration evidence does not establish production migration safety.
- Current-WIP Vitest: the focused run passed **24 files / 250 tests**, and the supplemental clinical/audit run passed **12 files / 58 tests**: **36 files / 308 passed, 0 failed, 0 skipped** combined. These are selected suites in the evidence key, not every checklist report; mocked UI tests are not end-to-end browser evidence. The prior full PostgreSQL run (212 files/1,964 passed) was **before the latest ward-pricing edits** and is not a full current-commit result.
- An audit-only HTTP/PostgreSQL check for the experimental transaction endpoint passed synthetic receipt/refund event dates, a Nairobi midnight boundary, invoice-cohort separation, cross-facility denial and invalid-date rejection. It did **not** test all sources, accounting reconciliation, the unmounted UI, print/export, or live settlement. The first harness invocation had a scratch TypeScript module-format error; a development-mode retry completed the assertions but hung on Vite HMR and was terminated; the production-mode rerun exited 0. No application change was made.
- Dashboard browser **B1** passed with synthetic data; its copied harness changed only screenshot destination and bind host so no tracked screenshot was overwritten. The script's console message still names the original screenshot directory, but actual output was outside the repository and was not a MedSmart reference.
- The repository inpatient browser script initially **failed** in the policy phase because it could not click the policy panel; timing during panel reload is a likely cause, but the failed run did not capture enough to prove it. Copied audit-only harnesses with an explicit load wait passed synthetic ward-default and bed-override admission, discharge, invoice, cash-attribution and receipt journeys (**B2**). The second used a ward default of KES 175 and a bed override of KES 100 to check override precedence. This is not a clean pass of the original script or proof of transfer/production journeys; both prices were synthetic fixtures, not approved facility prices.
- No external provider, live payer, real patient, real bank statement or production facility was used. An HTTP 200, local claim validation, manual refund or payment record is not proof of provider acknowledgement, bank settlement, funds transfer or payer payment.
- CI annotations and source/tests were inspected; some GitHub log downloads returned EOF. No full current-commit coverage run, actual local Docker bootstrap, approved document print output, official MOH form validation, production reconciliation or facility UAT was performed.

## Status and priority rules

Each row has **exactly one** of the five requested statuses, applied to the requested end-to-end output, not just underlying data:

- **COMPLETED AND TESTED:** the narrowly named behavior was traced UI→API→persisted synthetic data and exercised; it is not a claim of MedSmart visual parity or production UAT.
- **IMPLEMENTED BUT NOT VERIFIED:** a relevant full path appears implemented, but the requested output, accuracy, print, permissions, or end-to-end scenario lacks sufficient verification.
- **PARTIALLY IMPLEMENTED:** some relevant workflow, calculation or data exists, but requested functionality or safe completion is missing.
- **NOT IMPLEMENTED:** no meaningful requested report/workflow was found; underlying tables or separate operational workflows may still exist and are identified.
- **BLOCKED:** external authoritative specifications, policies, credentials, or approvals are required to define or validate the requested result; the gap cell states whether implementation is also missing. This is not a claim that code exists.

Priorities are proposed, not authorization: **P0** protect financial/patient integrity and security; **P1** clinical, operational or regulatory dependencies; **P2** important supporting capabilities; **P3** later enhancements. An em dash in the matrix means no relevant implementation/test was found for the requested output. Evidence ranges such as `D1–D3` include every code in that inclusive range. Tests suffixed “only” establish underlying behavior, not the requested report. Each code below resolves to concrete files, routes or relationships; a cited test is not automatically a pass for untested assertions.

**Matrix coverage:** 112 individually classified checklist items. Status counts: COMPLETED AND TESTED: 1; IMPLEMENTED BUT NOT VERIFIED: 1; PARTIALLY IMPLEMENTED: 63; NOT IMPLEMENTED: 35; BLOCKED: 12.

## Evidence key (resolves every matrix code)

### Frontend (`U`)

| Key | Existing frontend/component |
|---|---|
| U1 | `src/components/modules/HospitalDashboard.tsx`, `DashboardModule.tsx`; mounted via `src/App.tsx`. |
| U2 | `src/components/modules/ReportsModule.tsx` (fixed reporting views). |
| U3 | `src/components/modules/BillingCashierModule.tsx`, `FinalizedInvoicePanel.tsx`, `InvoiceFinancialSummary.tsx`. |
| U4 | `src/components/modules/AccountingModule.tsx`, `BillingJournalPostingPanel.tsx`. |
| U5 | `src/components/modules/InpatientModule.tsx`, `BedBillingPolicyPanel.tsx`, `BedBillingRecovery.tsx`. |
| U6 | `src/components/modules/OutpatientModule.tsx`, `NursingPanel.tsx` (clinical records, not a referral-document module). |
| U7 | `src/components/modules/RadiologyModule.tsx`. |
| U8 | `src/components/modules/LaboratoryModule.tsx`. |
| U9 | `src/components/modules/TheatreModule.tsx`. |
| U10 | `src/components/modules/InventoryModule.tsx`. |
| U11 | `src/components/modules/PharmacyModule.tsx`. |
| U12 | `src/components/modules/ProcurementModule.tsx`. |
| U13 | `src/components/modules/MaternityModule.tsx` and `maternity/`. |
| U14 | `src/components/modules/PatientRegistrationModule.tsx`. |
| U15 | `src/components/modules/PublicHealthModule.tsx`. |
| U16 | `src/components/modules/AuditLogModule.tsx`. |
| U17 | `src/components/modules/ReceptionQueueModule.tsx`. |
| U18 | `src/components/modules/StaffRolesPanel.tsx`, `StaffInvitationsPanel.tsx` (accounts/RBAC, not payroll). |
| U19 | `src/components/portal/PortalApp.tsx`. |
| U20 | `src/components/NotificationCentre.tsx`, `NotificationDialog.tsx`. |
| U21 | `src/components/modules/FinancialTransactionsPanel.tsx`: WIP component is **not mounted** in `src/App.tsx`. |

### Backend (`A`)

| Key | Existing API and service evidence |
|---|---|
| A1 | `src/routes/domains/invoices.routes.ts`, `billing-analytics.routes.ts`, `src/routes/billing.routes.ts`, `src/billing/billing.service.ts`; includes `/api/analytics/revenue` and invoice/receipt APIs. |
| A2 | `/api/accounting/*`: `src/routes/accounting.routes.ts`, `src/accounting/accounting.service.ts`, `billing-posting.service.ts`, `billing-ledger-diagnostics.service.ts`. Manual source posting is explicit; auto-posting is not established. |
| A3 | `src/routes/domains/encounters.routes.ts`, `src/routes/diagnoses.routes.ts`, `vitals.routes.ts`, `src/db/queries/encounters.ts`. |
| A4 | `src/routes/inpatient.routes.ts` provides `/api/wards`, `/api/beds`, `/api/admissions` and inpatient billing/policy endpoints; implementation in `src/inpatient/` and `src/billing/bed-occupancy-charge.ts`. |
| A5 | `src/routes/laboratory.routes.ts`, `src/db/queries/laboratory.ts`, specimen and facility-service validation. |
| A6 | `src/routes/radiology.routes.ts`, `src/db/queries/laboratory.ts` (radiology text/order methods). |
| A7 | `src/routes/theatre.routes.ts`, `theatre-scheduling.routes.ts`, `src/theatre/scheduling.service.ts`; `/api/theatre/reports/schedule` aggregates **scheduled** bookings. |
| A8 | `src/routes/pharmacy.routes.ts` including `/api/inventory`, `/api/inventory/batches`, `/api/inventory/expiry-summary`; `src/inventory/inventory.service.ts`. |
| A9 | `src/routes/procurement.routes.ts`: `/api/suppliers`, `/api/purchase-orders` and approve/reject/complete actions. |
| A10 | `src/routes/domains/patients.routes.ts`, `src/db/queries/patients.ts`: facility/tenant scoped patient listing/search. |
| A11 | `/api/public-health/reports`: `src/routes/domains/public-health.routes.ts`, `src/db/queries/public-health.ts`; explicit local notifiable-disease facts, not automatic transmission. |
| A12 | `/api/audit-logs`: `src/routes/domains/audit.routes.ts`, `src/db/queries/public-health.ts`; latest-50 limit; generic `logAuditEvent` in `src/db/queries/public-health.ts` catches write failures rather than guaranteeing durability. |
| A13 | `/api/dashboard/overview`, `POST /api/dashboard/search`: `src/dashboard/dashboard.routes.ts`, `dashboard.service.ts`. |
| A14 | `src/auth/auth.routes.ts`, `auth.service.ts`, `src/auth/staff-roles.routes.ts`, `staff-invitation.routes.ts` and related user/RBAC routes; failed attempts are not a dedicated report. |
| A15 | `/api/portal/discharge-summaries`, `/api/portal/records/download`: `src/portal/portal.routes.ts`, `portal-records.service.ts` (policy-gated; export JSON; export audit is asynchronous). |
| A16 | `src/routes/queues.routes.ts`: current station/status queue endpoints. |
| A17 | `src/routes/maternal-health.routes.ts`, `src/maternity/` and `src/db/schema/maternity.ts`. |
| A18 | `src/reporting/reporting.service.ts`, `src/routes/domains/billing-analytics.routes.ts` reporting endpoints; fixed aggregate methods, not an unrestricted report builder. |
| A19 | `/api/interop/dha/moh-705` in `src/routes/domains/interop.routes.ts`: explicitly HTTP 501 `MOH705_REPORT_NOT_IMPLEMENTED`. |
| A20 | `/api/reporting/financial-transactions` in `src/routes/domains/billing-analytics.routes.ts`, `src/reporting/financial-transactions.service.ts`; WIP transaction-date endpoint, requires `reports.read` and `billing.read`, no mounted panel. |
| A21 | `/api/notifications` and `/api/notifications/read`: `src/notifications/inbox.routes.ts`, `inbox.service.ts`; `notification-provider.ts` states SMS/email provider is not configured. |

### Database (`D`): source tables and relationships, not proof of workflows

| Key | Relevant tables and relationships (schema under `src/db/schema/`) |
|---|---|
| D1 | `tenants` → `facilities`; `patients` has tenant/registration-facility links, identifiers and facility membership (`patients.ts`). |
| D2 | `encounters` → patient/facility; `observations`, `diagnoses`, procedures and queues reference encounters/patients as applicable (`clinical.ts`). |
| D3 | `admissions` → patient/encounter/ward/bed; `inpatient_bed_occupancies`, `inpatient_bed_stay_snapshots`, `inpatient_bed_nights`, policies/reviews and transfers reference the admission/scope (`inpatient.ts`). |
| D4 | `billing_invoices` → patient/facility/encounter; `billing_items` and `billing_payments` → invoice; `billing_refunds` → invoice/payment; finalization, attributions and charge attempts retain source links (`billing.ts`). |
| D5 | Facility `chart_of_accounts`, `financial_periods`, `journal_entries` → `journal_lines` → accounts; bank transactions/reconciliations, `fixed_assets`/movements and supplier-invoice schema (`financial-ledger.ts`, `banking.ts`). A table is not a mounted workflow. |
| D6 | Facility `inventory_items` → `inventory_batches`; `pharmacy_dispensations` link medications/patients/quantities and batch-related evidence (`inventory.ts`). |
| D7 | `suppliers` and `purchase_orders` → tenant/facility/supplier; `purchase_order_items` and events → PO (`inventory.ts`). |
| D8 | `lab_orders` → patient/test/encounter; `lab_results` → orders, specimens via `lab_specimens`/`lab_specimen_orders`; `radiology_orders` → patient/encounter (`laboratory.ts`, `lab-specimens.ts`). |
| D9 | `theatre_cases`, `theatre_bookings` → facility/patient/admission/room as applicable; booking schedule events → booking (`inpatient.ts`, `theatre-scheduling.ts`). |
| D10 | `public_health_reports` and `audit_logs` carry facility/tenant scope; some audit resources/actors are stored as text rather than proven FKs (`public-health.ts`). |
| D11 | `users`, roles, permissions, user-role and role-permission links; `sessions`, `login_attempts` (`auth.ts`). These are not payroll tables. |
| D12 | `referrals`/`referral_documents`/access logs (`referrals.ts`); `patient_consents` and `patient_record_access_logs` link patient/facility as applicable (`patients.ts`). No inference of a usable referral/consent UI. |
| D13 | `maternity_pregnancies` → patient/facility; `deliveries` → pregnancy/patient; `delivery_babies` → delivery (`maternity.ts`). |
| D14 | `notification_alert_states` and `notification_read_receipts` store facility/user scoped notification state (`notifications.ts`); they are not an SMS-delivery log. |

### Tests and browser evidence (`T`, `B`)

The two selected Vitest runs passed the *focused* and *supplemental* files identified below. Tests address only their stated subset; passing underlying-workflow tests do not establish a requested report.

| Key | Existing test file / what it demonstrates |
|---|---|
| T1 | **Focused:** `src/tests/integration/finalized-invoices.db.spec.ts`, `src/tests/vitest/finalized-invoice-ui.spec.tsx`: finalization/persistence and mocked print UI, not physical output. |
| T2 | **Focused:** `src/tests/integration/invoice-payment-acceptance.db.spec.ts`, `refund-receipt-acceptance.db.spec.ts`: invoice payments, manual refunds/receipt safeguards. |
| T3 | **Focused:** `src/tests/vitest/client-accounting.db.spec.ts`, `src/tests/integration/billing-posting.db.spec.ts`: balanced ledger/manual source posting/reversal/guards, not automatic reconciliation. |
| T4 | **Focused:** `src/tests/integration/inpatient-bed-billing.db.spec.ts`, `ward-price-migration.db.spec.ts`, `src/tests/vitest/inpatient-admission-readiness.spec.tsx`: selected synthetic ward billing/policy/migration/UI behavior. |
| T5 | **Focused:** `src/tests/integration/pharmacy-inventory-billing.db.spec.ts`: facility inventory price, actual dispensing/batches and billing protections; not a stock report suite. |
| T6 | **Focused:** `src/tests/integration/laboratory-facility-identity.db.spec.ts`, `src/tests/vitest/laboratory-safety-ui.spec.tsx`: scoped test/service identity, specimen and UI protections; not aggregate lab/MOH reports. |
| T7 | **Focused and supplemental:** `src/tests/vitest/outpatient-safety-ui.spec.tsx`, `src/tests/integration/staff-inpatient-nursing.spec.ts`, `src/tests/integration/facility-owned-billing.db.spec.ts`; clinical/billing evidence, not printable or reporting tests. |
| T8 | **Focused:** `src/tests/integration/theatre-scheduling.db.spec.ts`, `src/tests/vitest/theatre-scheduling-ui.spec.tsx`: schedule and UI subsets, not a complete operation report. |
| T9 | **Supplemental:** `src/tests/integration/radiology-write-validation.spec.ts`; write validation, not a signed printable/result report test. |
| T10 | **Focused:** `src/tests/integration/procurement-workflow.db.spec.ts`, `procurement-suppliers.db.spec.ts`, `src/tests/vitest/procurement-workflow.spec.tsx`: supplier/PO lifecycle and mocked UI subset, not GRN or LPO printing. |
| T11 | **Focused:** `src/tests/integration/public-health-explicit-counts.db.spec.ts`: explicit locally entered facts/scope, not certified MOH outputs or submissions. |
| T12 | **Supplemental:** `src/tests/maternity.spec.ts`, `src/tests/vitest/maternity-module.spec.tsx`; unit/mocked workflow checks, not official birth/death report validation. |
| T13 | **Focused:** `src/tests/integration/dashboard.db.spec.ts`, `src/tests/vitest/hospital-dashboard-ui.spec.tsx`: scoped dashboard calculations and mocked UI; B1 supplies browser evidence. |
| T14 | T13 plus **supplemental** `src/tests/integration/patient-mrn-allocation.db.spec.ts`: dashboard patient search and patient identity foundations. |
| T15 | **Supplemental:** `src/tests/auth-service.db.spec.ts`, `src/tests/authentication.db.spec.ts`, `src/tests/authorization.spec.ts`; authentication/RBAC, not complete system-audit reporting tests. |
| T16 | **Supplemental:** `src/tests/integration/queue-write-validation.spec.ts`; write validation, not a historical queue-report test. |
| T17 | **Focused UI and supplemental database:** `src/tests/vitest/notification-centre-ui.spec.tsx`, `src/tests/integration/notification-inbox.db.spec.ts`. B1 verifies a synthetic browser read/audit path. |
| T18 | **Supplemental:** `src/tests/patient-portal.spec.ts`; policy/unit checks, not proof of a printable discharge template. |
| T19 | **Focused:** `src/tests/reporting.spec.ts`, `src/tests/round5.spec.ts`; fixed report calculations/mocked paths, not a custom report builder or MOH certification. |
| T20 | Audit-only `check-financial-report.mts` and `jalicare-medsmart-report-check-production.log` under `/home/user/jalicare-medsmart-audit-runtime/` and `/home/user/`; a narrow HTTP + synthetic PostgreSQL check, not a committed suite or complete reconciled report. |
| B1 | Copied `scripts/dashboard-browser-synthetic.mjs`: synthetic production Chromium login, dashboard, filters, persisted read/audit, search/open-directory and responsive navigation; adapted output location outside repo. Passed. |
| B2 | Copied `scripts/synthetic-inpatient-bed-browser.mjs` with explicit policy-load wait: ward-default and bed-override journeys passed after the original failed at policy loading. A second external variant configured a KES 175 synthetic ward default and KES 100 bed override, verifying that the saved `BED_OVERRIDE` snapshot and billed receipt used the bed price. Neither journey used real data or validated transfers. |


## A. Feature comparison matrix

### 1. Printables and documents

| Checklist item | Status | Frontend | Backend/API | Tables / relationships | Tests | Missing functionality | Dependencies | Priority |
|---|---|---|---|---|---|---|---|---|
| Sick-off certificate | **NOT IMPLEMENTED** | — | — | D1–D2 | — | No certificate generation, approval or print workflow found. | Clinical/legal template; authorized signatory | P1 |
| Clinical notes printable | **PARTIALLY IMPLEMENTED** | U6 | A3 | D1–D2 | T7 | Notes can be recorded; no dedicated approved printable note found. | Clinical template; print-access audit | P1 |
| Referral note printable | **PARTIALLY IMPLEMENTED** | U6 | — | D1–D2, D12 | T7 (notes only) | Legacy referral text and referral tables are not a usable referral document workflow. | Referral clinical fields; consent; secure exchange and approved template | P1 |
| Inpatient statement printable | **PARTIALLY IMPLEMENTED** | U3, U5 | A1, A4 | D3–D4 | T1, T4 | Invoice view exists; no admission-wide itemized statement template or verified aggregation. | Admission/invoice allocation and financial reconciliation | P1 |
| Discharge summary printable | **PARTIALLY IMPLEMENTED** | U5, U19 | A4, A15 | D3, D12 | T4, T18 (portal only) | Discharge text and policy-controlled portal listing exist; export is JSON, not an approved print template. | Clinical sign-off; template; access and export audit | P1 |
| Operation note printable | **PARTIALLY IMPLEMENTED** | U9 | A7 | D9 | T8 (scheduling) | Theatre records and scheduling exist; no approved structured operative note and print path found. | Clinical note fields; surgeon signature; template | P1 |
| Anaesthetist note printable | **PARTIALLY IMPLEMENTED** | U9 | A7 | D9 | T8 (scheduling) | Theatre records are not a structured signed anaesthesia note or printable record. | Anaesthesia documentation and sign-off rules | P1 |
| Billing consent printable | **NOT IMPLEMENTED** | — | — | D12 (consent records only) | — | No billing-specific consent capture, versioned signature or document output found. | Approved financial consent wording and authorization | P1 |
| Radiology result / report printable | **PARTIALLY IMPLEMENTED** | U7 | A6 | D8 | T9 (write validation) | Findings and impression can be saved; no verified signed printable imaging report found. | Radiologist approval; output template; document access audit | P1 |
| Receipt printable | **PARTIALLY IMPLEMENTED** | U3 | A1 | D4 | T1–T2 | Receipt records appear in finalized invoice history; no standalone receipt print path found. | Receipt template; refund and attribution rules | P1 |
| Invoice printable | **IMPLEMENTED BUT NOT VERIFIED** | U3 | A1 | D4 | T1, T2 | Finalized invoice print uses an audit request and window.print; real print layout and end-to-end output were not verified. | Approved template; print/browser and facility acceptance | P1 |
| Purchase requisition printable | **NOT IMPLEMENTED** | U12 (PO only) | A9 (PO only) | D7 | T10 (PO only) | No separate requisition request, approval or printable requisition found. | Purchasing authority and requisition workflow | P2 |
| Local purchase order (LPO) printable | **PARTIALLY IMPLEMENTED** | U12 | A9 | D7 | T10 | Purchase-order creation and approval exist; a verified LPO print/export template was not found. | Approved LPO layout; supplier details | P1 |
| Goods received note (GRN) printable | **NOT IMPLEMENTED** | U12 (PO only) | A9 (PO only) | D6–D7 | T10 (PO only) | No independently verified goods-receipt/inspection and printable GRN workflow found. | Receipt/inspection, batch and stock-ledger design | P1 |

### 2. Financial reporting

| Checklist item | Status | Frontend | Backend/API | Tables / relationships | Tests | Missing functionality | Dependencies | Priority |
|---|---|---|---|---|---|---|---|---|
| Cashier collection summary | **PARTIALLY IMPLEMENTED** | U2, U3; U21 unmounted | A1, A20 | D4 | T1–T2, T20 | Legacy revenue groups by invoice creation date; experimental transaction report is not mounted or a cashier summary. | Cashier identity; transaction dates; refunds; reconciliation | P0 |
| Department collection / revenue summary | **PARTIALLY IMPLEMENTED** | U2 | A1 | D4–D5 | T3 (ledger only) | Legacy invoice item groupings are not a reconciled departmental collection or revenue allocation. | Approved allocation and accounting policy | P0 |
| Manager financial summary | **PARTIALLY IMPLEMENTED** | U2, U4, U21 unmounted | A1–A2, A20 | D4–D5 | T3, T20 | Multiple partial views; no complete reconciled management statement. | Verified ledger completeness; bank and payer reconciliation | P0 |
| Trial balance | **PARTIALLY IMPLEMENTED** | U4 | A2 | D5 | T3 | Posted journal trial balance exists; missing billing/payment auto-posting and reconciliation can leave it incomplete. | Approved chart/mappings, closed periods and exception handling | P0 |
| Income statement | **PARTIALLY IMPLEMENTED** | U4 | A2 | D5 | T3 | Posted journal revenue and expense totals exist, not proof that all source transactions and costs are recorded. | Reconciled source posting and period/expense policies | P0 |
| Balance sheet | **PARTIALLY IMPLEMENTED** | U4 | A2 | D5 | T3 | Posted-journal balances and balance check exist; completeness and opening balances are not established. | Asset/liability/equity mappings and reconciled openings | P0 |
| Cash-flow statement | **NOT IMPLEMENTED** | U4 (journal view) | A2 (journal view) | D5 | T3 (ledger only) | No operating/investing/financing cash-flow statement calculation found. | Bank reconciliation and approved cash-flow classification | P1 |
| Monthly profit and loss | **PARTIALLY IMPLEMENTED** | U4 | A2 | D5 | T3 | Date-range ledger P&L can be selected; no verified monthly reconciled schedule or complete cost coverage. | Automatic posting, cost completeness and period policy | P0 |
| Budgets and budget-versus-actual | **NOT IMPLEMENTED** | — | — | D5 (actual ledger only) | — | No budget model, approval or variance calculation found. | Budget ownership and chart of accounts | P2 |
| Credit notes report | **NOT IMPLEMENTED** | U3 (refund only) | A1 (refund only) | D4 | T2 (manual refund only) | Refund records are not credit notes; no credit-note lifecycle/report found. | Credit policy, reversal and ledger linkage | P1 |
| Waivers report | **NOT IMPLEMENTED** | U3 (invoice only) | A1 (invoice only) | D4 | T1 (invoice only) | No dedicated waiver authorization, accounting or report found. | Waiver approval, reason and financial mappings | P1 |
| Income by cashier | **PARTIALLY IMPLEMENTED** | U2, U3; U21 unmounted | A1, A20 | D4 | T2, T20 | Payment has cashier-name text; no verified user-linked period/cashier report or settlement reconciliation. | Stable cashier identity and approval/reconciliation rules | P0 |

### 3. Stock, procurement and assets

| Checklist item | Status | Frontend | Backend/API | Tables / relationships | Tests | Missing functionality | Dependencies | Priority |
|---|---|---|---|---|---|---|---|---|
| Stock usage report | **PARTIALLY IMPLEMENTED** | U10–U11 | A8 | D6 | T5 | Dispensing and stock records exist; no comprehensive department usage report found. | Movement ledger, department attribution and units | P1 |
| Stock movement report | **PARTIALLY IMPLEMENTED** | U10–U11 | A8 | D6 | T5 | Batch and dispensation evidence exist; no complete movements ledger/report covering receipts, transfers and returns. | Signed movement ledger and historical reconciliation | P1 |
| Goods received report | **PARTIALLY IMPLEMENTED** | U12 | A9 | D6–D7 | T10 (orders only) | PO lifecycle exists; independent goods-receipt/inspection and stock posting are not established. | GRN and batch receipt workflow | P1 |
| Goods returned report | **NOT IMPLEMENTED** | U10–U12 (underlying workflows) | A8–A9 (underlying workflows) | D6–D7 | T5, T10 (underlying only) | No complete supplier/patient goods-return workflow or return report found. | Controlled stock and financial reversal rules | P1 |
| Purchase orders / LPO report | **PARTIALLY IMPLEMENTED** | U12 | A9 | D7 | T10 | Orders and approval history exist; MedSmart filters, LPO print and receiving linkage are unverified. | Approved procurement reporting and receiving rules | P1 |
| Supplier invoices | **PARTIALLY IMPLEMENTED** | U12 (suppliers/PO) | A9 (suppliers/PO) | D7, D5 | T10 (suppliers/PO only) | Supplier-invoice table exists but no mounted supplier-invoice capture/matching workflow found. | Invoice/PO/GRN matching and payable accounting | P1 |
| Stores and store-level balances | **PARTIALLY IMPLEMENTED** | U10 | A8 | D6 | T5 (dispensing only) | Inventory and batches exist; distinct stores and store-scoped stock balances not established. | Store master, locations and movement control | P1 |
| Inventory categories | **PARTIALLY IMPLEMENTED** | U10 | A8 | D6 | T5 (inventory only) | Item categories exist; category-managed reporting and MedSmart parity unverified. | Approved category taxonomy | P2 |
| Stock expiry report | **PARTIALLY IMPLEMENTED** | U10 | A8 | D6 | T5 | Batch expiry summary exists; complete reports, disposal and exception workflow are unverified. | Batch completeness, expiry policy and approved disposal | P1 |
| Stock variance / stocktake report | **NOT IMPLEMENTED** | U10 (inventory only) | A8 (inventory only) | D6 | T5 (dispensing only) | No complete count, approval, variance and audited adjustment report found. | Stocktake governance and movement ledger | P1 |
| Stock transfer report | **NOT IMPLEMENTED** | U10 (inventory only) | A8 (inventory only) | D6 | T5 (dispensing only) | No complete inter-store transfer and acceptance report found. | Store master and paired movement entries | P1 |
| Bin cards | **NOT IMPLEMENTED** | U10 (inventory only) | A8 (inventory only) | D6 | T5 (dispensing only) | No item/location running-balance bin-card output found. | Complete movement ledger and stores | P1 |
| Purchase price list | **PARTIALLY IMPLEMENTED** | U10, U12 | A8–A9 | D6–D7 | T10 (orders only) | Inventory and PO amounts exist; a controlled effective-dated purchase-price report was not established. | Supplier pricing, units and access policy | P2 |
| Selling price list | **PARTIALLY IMPLEMENTED** | U10–U11 | A8 | D6 | T5 | Facility inventory selling prices exist; complete approved price-list export/history not established. | Inventory price approval and effective-date policy | P1 |
| Fixed asset register | **PARTIALLY IMPLEMENTED** | — | — | D5 | — | Fixed-asset and asset-movement tables exist; no mounted register workflow found. | Ownership, classification, depreciation and approval policy | P2 |
| Asset maintenance report | **NOT IMPLEMENTED** | — | — | D5 (asset tables only) | — | No maintenance scheduling, work order or maintenance report found. | Asset register and maintenance roles | P2 |
| Supplier directory / report | **PARTIALLY IMPLEMENTED** | U12 | A9 | D7 | T10 | Supplier CRUD and tests exist; broader supplier statements/performance reporting is unverified. | Supplier data quality and report requirements | P2 |

### 4. Departmental reporting

| Checklist item | Status | Frontend | Backend/API | Tables / relationships | Tests | Missing functionality | Dependencies | Priority |
|---|---|---|---|---|---|---|---|---|
| Radiology departmental report | **PARTIALLY IMPLEMENTED** | U7 | A6 | D8 | T9 (write validation) | Order worklist and text results exist; no verified date/department/modality aggregate report. | Reporting definitions, sign-off and access policy | P1 |
| Laboratory report by patient | **PARTIALLY IMPLEMENTED** | U8 | A5 | D8 | T6 | Patient-scoped orders/results exist; no verified departmental reporting/export suite. | Patient scope, date definition and privacy rules | P1 |
| Laboratory report by sample / specimen | **PARTIALLY IMPLEMENTED** | U8 | A5 | D8 | T6 | Specimen/accession records exist; requested sample report and reconciliation not established. | Specimen states and approved aggregation | P1 |
| Laboratory report by source | **NOT IMPLEMENTED** | U8 (worklist) | A5 (orders) | D8 | T6 (orders only) | No verified referral-source grouped laboratory report found. | Explicit source capture and grouping rules | P2 |
| Laboratory report by section | **NOT IMPLEMENTED** | U8 (worklist) | A5 (orders) | D8 | T6 (orders only) | No verified lab-section grouped report found. | Laboratory section taxonomy and assignment | P2 |
| Laboratory report by test | **PARTIALLY IMPLEMENTED** | U8 | A5 | D8 | T6 | Test catalogue and orders exist; period/test workload reporting not established. | Workload definition; verified result states | P1 |
| MOH laboratory workload report | **BLOCKED** | U8, U15 | A5, A11 | D8, D10 | T6, T11 (not MOH output) | No form-compliant calculation found; current approved form/specification not supplied. | MOH 706/240 edition, indicators and KHIS submission contract | P1 |
| MOH imaging / radiology report | **BLOCKED** | U7, U15 | A6, A11 | D8, D10 | T9, T11 (not MOH output) | No verified official imaging form calculation or submission found. | Current authoritative imaging form and indicator definitions | P1 |
| Pharmacy / drugs report | **PARTIALLY IMPLEMENTED** | U10–U11 | A8 | D6 | T5 | Dispensing, quantities and batches exist; requested comprehensive grouped drug report not established. | Returns/reversals and stock reconciliation | P1 |
| Theatre departmental report | **PARTIALLY IMPLEMENTED** | U9 | A7 | D9 | T8 | A scoped planned-schedule aggregate exists; it is not a complete performed-operation report. | Completed-case definitions, procedure and time capture | P1 |
| Social work report | **NOT IMPLEMENTED** | — | — | D1–D2 (patient/encounter only) | — | No social-work case workflow or report found. | Clinical scope, privacy and case definitions | P2 |
| Counselling report | **NOT IMPLEMENTED** | — | — | D1–D2 (patient/encounter only) | — | No dedicated counselling encounter/report found. | Confidentiality, consent and outcome definitions | P2 |
| Departmental waivers report | **NOT IMPLEMENTED** | U3 (invoice only) | A1 (invoice only) | D4 | T1 (invoice only) | No approved department waiver records/report found. | Waiver authorization and department attribution | P1 |
| Department financial report | **PARTIALLY IMPLEMENTED** | U2, U4 | A1–A2 | D4–D5 | T3 (ledger only) | Partial invoice/ledger views are not reconciled department-level recognized revenue and costs. | Department attribution, allocation and reconciled ledger | P0 |

### 5. Medical records and MOH reports

| Checklist item | Status | Frontend | Backend/API | Tables / relationships | Tests | Missing functionality | Dependencies | Priority |
|---|---|---|---|---|---|---|---|---|
| Birth register / report | **PARTIALLY IMPLEMENTED** | U13 | A17 | D13 | T12 (maternity unit tests) | Delivery and baby outcome records exist; an official birth register/report was not verified. | Birth registration rules and approved data elements | P1 |
| Death register / report | **PARTIALLY IMPLEMENTED** | U5, U13 | A4, A17 | D3, D13 | T4, T12 (underlying only) | Admission dispositions and newborn outcomes exist, not a complete facility death register. | Death certification, cause coding and official form | P1 |
| Inpatient register | **PARTIALLY IMPLEMENTED** | U5 | A4 | D3 | T4 | Admissions/wards exist; complete period register and approved output not established. | Date, status, transfer and disposition definitions | P1 |
| Patient register | **PARTIALLY IMPLEMENTED** | U14 | A10 | D1 | T14 (search/registration) | Scoped directory exists; official longitudinal register/export not verified. | Unique patient identity, demographic completeness and access rules | P1 |
| Patient review report | **NOT IMPLEMENTED** | U6 (encounters) | A3 | D1–D2 | T7 (notes only) | No dedicated review/follow-up workload report found. | Review-event definition and clinician attribution | P2 |
| Referrals report | **PARTIALLY IMPLEMENTED** | U6 (legacy field) | — | D2, D12 | T7 (notes only) | Encounter referral text and referral tables do not constitute a referral lifecycle/report. | Referral acceptance, tracking, privacy and outcomes | P1 |
| Diagnosis report | **PARTIALLY IMPLEMENTED** | U6 | A3 | D2 | T7 (encounters only) | Encounter diagnoses are recorded; complete coded reporting and quality checks not established. | Current coding data and clinical review; no historical auto-recoding | P1 |
| Outpatient diagnosis report | **PARTIALLY IMPLEMENTED** | U6 | A3 | D2 | T7 (encounters only) | OPD encounter type and diagnoses exist; no verified outpatient diagnosis aggregate. | Age, encounter and primary-diagnosis definitions | P1 |
| Inpatient diagnosis report | **PARTIALLY IMPLEMENTED** | U5–U6 | A3–A4 | D2–D3 | T4, T7 (underlying only) | Admissions and diagnoses exist; discharge-based inpatient diagnosis aggregate not established. | Admission/encounter linkage and diagnosis rules | P1 |
| Triage report | **PARTIALLY IMPLEMENTED** | U6 | A3 | D2 | T7 (underlying only) | Triage fields and observations exist; period/cadre/category report not established. | Triage taxonomy, timestamps and quality rules | P1 |
| Clinical workload report | **PARTIALLY IMPLEMENTED** | U1–U2 | A13, A18 | D1–D3 | T13 (dashboard only) | Dashboard operational counts exist; not the complete defined clinical workload report. | Cadre/department attribution and workload definitions | P1 |
| Discharge report | **PARTIALLY IMPLEMENTED** | U5 | A4 | D3 | T4 | Discharge and dispositions persist; complete discharge-period register/output not verified. | Discharge categories, transfers and reporting period | P1 |
| MOH 505 weekly surveillance | **BLOCKED** | U15 | A11 | D10 | T11 (manual counts only) | Manual notifiable-disease entries are not the full current MOH 505 calculation or transmission. | Current approved 505 data dictionary and reporting agreement | P1 |
| MOH 705A | **NOT IMPLEMENTED** | U15 | A11, A19 | D2, D10 | T11 (not 705) | The 705 endpoint explicitly returns 501; no compliant 705A calculation found. | Current MOH form, age rules and verified clinical mappings | P1 |
| MOH 705B | **NOT IMPLEMENTED** | U15 | A11, A19 | D2, D10 | T11 (not 705) | The 705 endpoint explicitly returns 501; no compliant 705B calculation found. | Current MOH form, age rules and verified clinical mappings | P1 |
| MOH 717 workload | **BLOCKED** | U1, U15 | A11, A13 | D2–D3, D10 | T11, T13 (not 717) | No approved 717 workload calculation or official form output found. | Current 717 indicator dictionary and source mapping | P1 |
| MOH 301 inpatient | **BLOCKED** | U5, U15 | A4, A11 | D3, D10 | T4, T11 (not 301) | Admissions exist; no verified current MOH 301 report. | Current official 301 form and admission/bed-day rules | P1 |
| MOH 204 outpatient | **BLOCKED** | U6, U15 | A3, A11 | D2, D10 | T7, T11 (not 204) | OPD encounters exist; no verified current 204 register/output. | Official current 204 variant, fields and coding rules | P1 |
| MOH 240 laboratory | **BLOCKED** | U8, U15 | A5, A11 | D8, D10 | T6, T11 (not 240) | No official-form-conformant 240 laboratory output verified. | Confirm current 240 register specification and data dictionary | P1 |
| MOH 240 radiology (code to confirm) | **BLOCKED** | U7, U15 | A6, A11 | D8, D10 | T9, T11 (not official output) | No compliant radiology form found; user-supplied 240 label requires official verification. | Authoritative current imaging form code and specifications | P1 |
| MOH financial report | **BLOCKED** | U2, U4, U15 | A1–A2, A11 | D4–D5, D10 | T3, T11 (not MOH finance) | No verified MOH-specific finance return or reconciled calculation found. | Official form/definitions and fully reconciled ledger | P1 |

### 6. HR and payroll

| Checklist item | Status | Frontend | Backend/API | Tables / relationships | Tests | Missing functionality | Dependencies | Priority |
|---|---|---|---|---|---|---|---|---|
| Staff directory / reports | **PARTIALLY IMPLEMENTED** | U18 | A14 | D11 | T15 (authentication/RBAC) | Users, roles and invitations exist; they are not a full employee HR register/report. | Employment identity, roles and HR privacy policy | P2 |
| Salary processing / salary report | **NOT IMPLEMENTED** | U18 (users only) | A14 (users only) | D11 | T15 (auth only) | No payroll engine, salary history or salary report found. | Approved pay periods and compensation data | P1 |
| Payslips | **NOT IMPLEMENTED** | — | — | D11 (user identity only) | — | No payslip generation/distribution found. | Payroll, statutory deductions and secure delivery | P1 |
| Attendance report | **NOT IMPLEMENTED** | U18 (users only) | A14 (users only) | D11 | T15 (auth only) | Authentication logs are not attendance; no attendance workflow/report found. | Attendance source, roster and approved policy | P2 |
| Overtime report | **NOT IMPLEMENTED** | — | — | D11 (user identity only) | — | No approved overtime claims, time calculations or report found. | Attendance, contracts and authorization | P2 |
| Leave report | **NOT IMPLEMENTED** | — | — | D11 (user identity only) | — | No leave balances, approvals or report found. | Leave types, policy and roster | P2 |
| Payroll deductions report | **NOT IMPLEMENTED** | — | — | D11 (user identity only) | — | No payroll deduction engine or statutory deduction report found. | Current tax rules and effective-dated payroll | P1 |
| Salary bank / payment report | **NOT IMPLEMENTED** | — | — | D5 (facility banking only) | — | Facility bank tables do not establish employee bank data or payroll disbursement. | Employee payment consent, secure bank process and approvals | P1 |
| KRA P9A | **BLOCKED** | — | — | D11 (user identity only) | — | No payroll data or P9A generator found; current-year format not approved. | Current KRA rules/form and reconciled payroll | P1 |
| KRA P10 | **BLOCKED** | — | — | D11 (user identity only) | — | No P10 generator/submission found; current filing requirements not established. | Current KRA/iTax specifications and payroll | P1 |
| KRA P10A | **BLOCKED** | — | — | D11 (user identity only) | — | No P10A supporting report found; current filing requirements not established. | Current KRA/iTax specifications and payroll | P1 |
| Locum report | **NOT IMPLEMENTED** | U18 (users only) | A14 (users only) | D11 | T15 (auth only) | No locum contract, shift, compensation or report found. | Locum policy, scheduling and payroll | P2 |
| HR / payroll audit report | **NOT IMPLEMENTED** | U16 (generic audit) | A12 (generic audit) | D10–D11 | T15 (auth only) | Generic audit is not a reliable complete HR/payroll action trail. | HR/payroll workflows, sensitive-access and retention policy | P1 |

### 7. System reporting and audit

| Checklist item | Status | Frontend | Backend/API | Tables / relationships | Tests | Missing functionality | Dependencies | Priority |
|---|---|---|---|---|---|---|---|---|
| User report | **PARTIALLY IMPLEMENTED** | U18 | A14 | D11 | T15 | User and role management exists; full user-report filters/export and employment data not established. | Identity lifecycle and report permissions | P2 |
| Queue report | **PARTIALLY IMPLEMENTED** | U17 | A16 | D2 | T16 (queue write validation) | Current queue/station views exist; historical wait-time and queue report not established. | Queue transition timestamps and SLA definitions | P2 |
| SMS / message delivery report | **NOT IMPLEMENTED** | U20 (inbox only) | A21 (inbox only) | D14 | T17 (inbox only) | In-app notifications are not SMS delivery; no configured SMS provider or verified delivery report. | Approved provider, credentials, delivery callbacks and consent | P1 |
| Custom report builder | **NOT IMPLEMENTED** | U2 (fixed reports) | A18 (fixed reports) | D1–D10 | T19 (fixed reporting only) | No governed custom report designer, saved definitions or scheduler found. | Dataset governance, RBAC and privacy controls | P3 |
| Complete system activity report | **PARTIALLY IMPLEMENTED** | U16 | A12 | D10 | T15 (auth/audit only) | Audit query returns latest 50; generic audit writes may be caught rather than durable. | Durable audit, pagination, retention and server filters | P0 |
| User-specific activity report | **PARTIALLY IMPLEMENTED** | U16 | A12 | D10–D11 | T15 (auth/audit only) | Client searches only the loaded audit subset, not a complete server-filtered user history. | Indexed server-side actor filters and retention | P0 |
| Failed-login report | **PARTIALLY IMPLEMENTED** | U16 (generic audit) | A14 | D11 | T15 | Login attempts are stored, but dedicated facility-scoped failed-login reporting not established. | Security visibility, retention and access policy | P1 |
| Patient-record access log report | **PARTIALLY IMPLEMENTED** | U16 (generic audit) | A10, A12, A15 | D1, D12 | T13, T18 | Some directory/portal access is recorded; complete access coverage and dedicated report not established. | Consistent access instrumentation and durable audit | P0 |
| Financial-approval activity report | **PARTIALLY IMPLEMENTED** | U4, U16 | A2, A12 | D5, D10 | T3 (journal audit) | Some financial actions are audited; no complete dedicated approval trail/report established. | Approval identities, durable audit and linked ledger events | P0 |

### 8. Dashboard and operational shortcuts

| Checklist item | Status | Frontend | Backend/API | Tables / relationships | Tests | Missing functionality | Dependencies | Priority |
|---|---|---|---|---|---|---|---|---|
| Patient search and open directory (name/MRN) | **COMPLETED AND TESTED** | U1, U14 | A10, A13 | D1, D12 | T13, T14; B1 | Tested scoped name/MRN search and open-directory path; dashboard quick search returns at most 5 matches and does not search phone or identifiers. The directory has a 50-result cap. | Reference screenshots and production UAT for visual/operational parity | P1 |
| Inpatient payment | **PARTIALLY IMPLEMENTED** | U3, U5 | A1, A4 | D3–D4 | T1–T2, T4; B2 | Synthetic ward-default and bed-override admission-to-receipt passed; transfers, recovery, real policy and full cashier parity remain open. | Approved facility policy, rates, finance reconciliation and UAT | P0 |
| Prescriptions / dispensing | **PARTIALLY IMPLEMENTED** | U6, U11 | A3, A8 | D2, D6 | T5 | Prescription/dispensing exists; integrated returns/reversals and untracked stock reconciliation remain incomplete. | Actual quantities, batch controls and reversal policy | P1 |
| Laboratory reception / sample worklist | **PARTIALLY IMPLEMENTED** | U8 | A5 | D8 | T6 | Orders/specimens and result flow exist; requested reception dashboard and full sample reporting unverified. | Accession rules, specimen custody and screenshots | P1 |
| Inpatient clerking | **PARTIALLY IMPLEMENTED** | U5–U6 | A3–A4 | D2–D3 | T4, T7 | Admission notes and linked encounters exist; dedicated structured inpatient clerking workflow/parity not established. | Clinical clerking template and role permissions | P1 |
| Theatre list / schedule | **PARTIALLY IMPLEMENTED** | U1, U9 | A7, A13 | D9 | T8, T13 | Planned theatre list and scheduling exist; completed-case/report scope and MedSmart parity unverified. | Procedure completion and authorization definitions | P1 |
| Billable service / item lookup | **PARTIALLY IMPLEMENTED** | U1, U3 | A1, A13 | D4, D6 | T2, T6, T13 | Facility service and inventory lookups exist; unresolved/inactive tariffs must remain blocked and workflow parity unverified. | Approved facility tariff and inventory prices | P0 |
| Alerts and notifications | **PARTIALLY IMPLEMENTED** | U1, U20 | A13, A21 | D14 | T13, T17; B1 | Scoped inbox/read persistence is tested for synthetic alerts; requested alert types and external delivery are incomplete. | Facility-specific alert rules and provider approvals | P1 |
| Mortuary | **NOT IMPLEMENTED** | — | — | D3 (discharge status only) | — | No mortuary register, case lifecycle or dashboard found. | Mortuary policy, identity and authorization | P2 |
| Property management | **NOT IMPLEMENTED** | — | — | D5 (fixed assets only) | — | No patient/property management module found; fixed-asset tables are not that workflow. | Clarify patient property versus facility assets in screenshots | P2 |
| HR / payroll shortcut | **NOT IMPLEMENTED** | U18 (staff access only) | A14 (users only) | D11 | T15 (auth only) | No HR/payroll dashboard or underlying payroll found. | HR/payroll requirements and policy | P2 |
| Procurement shortcut | **PARTIALLY IMPLEMENTED** | U12 | A9 | D7 | T10 | Supplier and PO module works in tested subsets; GRN, inventory intake and complete MedSmart dashboard remain open. | Receiving workflow and reference screenshots | P1 |


## Financial reconciliation: what was actually checked

1. `src/accounting/accounting.service.ts` computes trial balance from `POSTED` journal lines by account, period P&L from revenue/expense account types, and an inception-to-date balance sheet. It returns `billingReconciliation: NOT_IMPLEMENTED` and expressly warns that billing and payments are not automatically posted or reconciled and unrecorded costs are excluded. A balanced trial balance alone only proves balance of included journal lines, not completeness or correct source classification.
2. `src/routes/accounting.routes.ts` exposes an **explicit** `POST /api/accounting/billing-postings/:sourceType/:sourceId` and `billing-posting.service.ts` implements controlled posting with scoped accounts and idempotency. The focused synthetic tests cover posted invoices, split receipts, refunds, ordered reversals, scope, closed periods, failures and concurrency. The billing/payment transaction paths were not found to invoke it automatically; no facility-approved account mappings or complete reconciliation were supplied.
3. `src/billing/billing.service.ts` legacy revenue analytics select by **invoice creation date**, then use the invoice's billed/paid/balance values and item breakdown. The route parses dates in server-local time, not a verified facility timezone, and requires `reports.read` rather than `billing.read`; review the intended financial-access policy. The mounted facility-module gate checks scoped facility ownership, so this is not a demonstrated cross-tenant leak. These figures cannot be treated as transaction-date cashier collections, cash flow or recognized revenue and do not establish bank, payer or receivable reconciliation.
4. The WIP financial transaction service groups recorded payments/refunds by their event timestamps, has a separate invoice-cohort section and assumes legacy naive timestamps are UTC. The narrow synthetic HTTP check described above passed one local-midnight, refund and scope example. Its panel is unmounted; its full correctness, historical timestamp assumption, approval/audit scope and actual bank/provider settlement are unverified. A manually confirmed refund records an assertion, not proof money moved.
5. Reliable future reports require approved chart/account mappings, source identities, effective dates, idempotent posting, exception queues, controlled reversals, opening balances and accounting-period policy, plus independently verified reconciliation of invoices, cash/bank, receivables, claims and actual provider outcomes. Do not invent mappings, zero-fill missing facts, reprice history, or silently change posted journals.

## Official form and calculation cautions

- Kenya NPHI's IDSR clinician handbook describes MOH 505 as a **weekly** aggregate, with an epidemiological week Monday–Sunday and priority notifiable conditions reported immediately within 24 hours [1](https://www.nphi.go.ke/sites/default/files/2024-02/IDSR%20Clinicians%20Handbook.pdf). This supports a gap finding, not certification against the current approved form or an instruction to bypass official reporting channels. Confirm current edition and data dictionary.
- The MOH indicator catalogue refers to 705A and 705B in age-segmented malaria indicators [1](http://dsl.health.go.ke/indicators?search=malaria); it is not the complete current form specification, and the exact age-boundary rule must be taken from the approved form, not guessed.
- A 2026 MOH LIMS addendum calls MOH 706 the monthly laboratory workload and outcome summary [1](https://health.go.ke/sites/default/files/2026-07/ADD%201%20LIMS.pdf). This does not settle the current MOH 240 or imaging form codes. The checklist's “240 radiology” label should be confirmed with the facility/MOH before implementation.
- The KRA 2025 P9 template includes salary, benefits, housing, retirement, AHL, SHIF, interest and relief fields [1](https://www.kra.go.ke/images/publications/P9-FORM-Template-2025.pdf). It is evidence of complexity, **not** the current-year rate schedule or permission to infer P10/P10A filing requirements. Obtain current-year rules and facility payroll policy.

## B. Genuinely missing modules / outputs

- **HR/payroll:** salary lifecycle, attendance, leave, overtime, deductions, payslips, locums, bank disbursement and statutory output are not present as a functioning payroll system. Staff accounts are not payroll.
- **Patient/property and mortuary:** no dedicated patient property lifecycle or mortuary module was found; fixed-asset schema is not a patient-property register.
- **Social work and counselling:** no dedicated confidential case-management/reporting workflow found.
- **Inventory control extensions:** goods receipt/inspection and returns, store-to-store transfers, stocktake/variance and bin cards lack complete verified workflows. PO/supplier and dispensing foundations exist and should be extended, not replaced.
- **Specific statutory/report/document outputs:** official MOH form generators and calculations, standalone receipts, GRNs, sick-off certificates, and controlled referral/consent documents are missing or blocked as detailed in A. Cash flow, budgets, credit notes and waiver workflows are not established.
- **External SMS delivery:** no configured production provider or verified delivery trail; in-app inbox is different.

## C. Incomplete / risky existing modules

- **Accounting and managerial reports:** posted-ledger statements are partial until automatic posting, opening balances, cost completeness and source/bank/payer reconciliation are independently verified. Legacy invoice-date analytics are not cash-flow or cashier reports.
- **Inpatient pricing and statements:** ward-default with bed override is the latest WIP design; immutable rate/source evidence, safe exception handling and transfer history are required. The audit's synthetic ward-default and bed-override browser paths passed only after adapting the test wait; rate changes, unpriced stays, same-day ZERO, transfers and historical evidence need further end-to-end proof. `BedBillingPolicyPanel.tsx` still says each bed supplies its own price, which is misleading for a ward default. Older inpatient documentation also contains obsolete bed-only language. Do not invent or retroactively apply a price; KES 100 above was test-only.
- **Pharmacy:** partial fills, inventory prices and batches are tested, but integrated returns/reversals and untracked-stock reconciliation remain open. A prescription alone must not charge or decrement stock.
- **Print and clinical documents:** an audited finalized-invoice print path exists; approved physical output and standalone receipts are unverified. Clinical/discharge/radiology/theatre documents need appropriate templates, signing and access controls, not copying of raw records.
- **Laboratory / radiology / theatre:** real clinical workflows and targeted tests exist; worklists and planned theatre booking aggregates are not complete departmental or MOH reports. A synthetic KES 456 laboratory facility-tariff scenario is tested, not a real-facility price or approval.
- **Audit:** latest-50 retrieval and client-side filtering are insufficient for complete or user-specific logs; generic audit write failure handling is not proof of durable mandatory recording. Patient-access and finance-approval coverage must be specified and tested.
- **Public health:** explicit-count local surveillance records exist, but approved MOH output and transmission are unverified. Do not represent local entry as KHIS/DHIS2 delivery.
- **Assets and supplier invoices:** tables alone are not an implemented asset register, maintenance service, or supplier-invoice match/posting workflow.

## D. Proposed prioritized roadmap — approval required

| Order | Focus | Deliverable / exit gate | Dependencies and safeguards |
|---|---|---|---|
| 0 | Contain security and restore trustworthy checks | Owner-authorized security assessment for historical dumps; investigate failed CI coverage fixture guards and real Docker bootstrap; require a green, reproducible current-commit pipeline. | No unauthorized history rewrite or rotation; preserve records and do not disable tests. |
| 1 | Finance and inpatient integrity | Approve chart/mappings, billing-period policy and ward/bed rates; design source-posting exception/reversal handling and reconciliation. Validate transaction dates, opening balances and cashier/department ownership. | No production migrations/access without backup, plan and authorization; no historical inference or silent repricing. |
| 2 | Clinical documents and operational reports | Co-design printable invoice/receipt, discharge, referral, notes, procurement docs and departmental reports from actual workflows; test permissions, signatures, accuracy, pagination and print. | Reference screenshots, official templates, clinical approvers, traceable data; preserve existing modules. |
| 3 | MOH reporting and stock controls | Map current official MOH indicators and output to explicit audited source data; add missing store/receipt/return/variance lifecycle before movement/bin reports. | Current signed-off form/specs and facility processes; no invented age boundaries, negative stock or false submission success. |
| 4 | HR/payroll and additional modules | Assess payroll, social work, mortuary, property, budgets and custom reports as separately scoped projects. | Applicable statutes/rules and privacy governance; no premature tax or transfer automation. |
| 5 | Acceptance and rollout | Synthetic end-to-end, security, permission, concurrency, reconciliation and regression tests; approved UAT and monitored phased rollout. | Written user approval, facility policy, authorized backup/recovery and external-provider UAT where applicable. |

## E. Existing functionality to preserve — do not rebuild blindly

- Authenticated, facility-scoped dashboard patient name/MRN search and open-directory journey (B1); preserve existing access/audit boundaries. The dashboard quick search caps matches at 5 and the separate patient directory caps them at 50.
- Existing OPD clinical notes, triage, patient registration and laboratory specimen/order/results workflow; do not impose a compulsory consultation modal or infer service identity from names/specimens. The synthetic KES 456 laboratory test proves only that fixture.
- Invoice finalization, scoped payments, manual refund records, attribution and durable ledger posting/reversal primitives demonstrated by focused tests. Extend with authorized reconciliation; do not delete/alter posted history or equate payment/claim states.
- Existing ward/bed/admission/cleaning and immutable billing-evidence work, with the stated open validation issues. Clinical discharge and bed cleaning must not be blocked by billing success.
- Pharmacy actual-dispensing quantity and facility inventory-price snapshots, batch tracking and partial fills. Complete safe returns rather than replacing the workflow or pricing medication through clinical tariffs.
- Theatre booking/schedule and planned-workload aggregate, procurement supplier/PO/approval, inventory batch/expiry, maternity and notification inbox/read-state foundations. Their current presence is not proof that requested reports or statutory outputs are complete.
- SHA/AfyaLink/DHA and private-insurance interfaces must retain their distinct states and authorization boundaries; do not claim provider submission or payment without verified external evidence.

## Decisions needed before implementation

1. Provide the MedSmart reference screenshots and any expected output samples, with patient/financial information redacted.
2. Confirm facility priorities, approval owners, approved clinical/financial templates and official current MOH/KRA form specifications.
3. Approve a phased scope and test/acceptance plan. This report proposes no code changes and implementation remains paused until approval.
