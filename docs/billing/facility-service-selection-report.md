# Facility service selection and automatic billing — implementation report

**Baseline:** `main` at `5e1734881904e26acc27766d95d5012781c7c652`. **Evidence date:** 31 October 2026. This report describes code and isolated synthetic tests, not facility, clinical, financial, regulatory or production acceptance. No real facility records, credentials, invoices or patients were accessed or changed, and no deployment was performed.

## 1. Pre-change audit and facility discrepancies

The pre-correction source audit is [`docs/audits/facility-service-selection-baseline.md`](../audits/facility-service-selection-baseline.md). It was written before these implementation changes. The broader department inventory and traces are in [`docs/audits/hospital-service-discovery/`](../audits/hospital-service-discovery/); the previous catalogue work and its evidence are in [`master-tariff-implementation-report.md`](master-tariff-implementation-report.md). The older discovery inventory is a baseline, not a statement that every listed service is now implemented or billable.

The reported facility 2 / tenant 2 values were **not verified**: `OPD-CONSULT` KES 100, `LAB-BLOOD` 800, `LAB-URINIALYSIS` 600, `LAB-SPUT` 289, `RAD-001` obstetric ultrasound 300, `RAD-002` CT 360, `RAD-003` X-ray 234 and `RAD-004` MRI 1,200. The reported lab naming collisions, inactive entries, possible department misclassification, zero entries and outstanding orders are leads for authorized investigation, not facts established here. There was no authorized facility export or live database in this workspace. No such price, code, classification, mapping or historical transaction was corrected.

The audit traced the master services, legacy facility tariffs, prices, approval/effective states, source links and aliases; OPD encounters, lab orders/results/specimens, radiology orders/reports, pharmacy dispenses, inpatient/ward events and maternity deliveries; invoice items, payments/refunds, unresolved attempts and facility/tenant ownership. It identified, among other issues, the prior OPD free-text lab form, the unverified legacy blood-specimen default, missing price previews, unselected consultations and billing sources not covered by the strict resolver.

## 2. Implemented scope and financial boundaries

This extends the existing catalogue, clinical records, invoice engine, unresolved queue and administration; it does not introduce another patient, stock, invoice, payment or accounting system.

| Workflow | Implemented behavior and trigger | Important boundary |
| --- | --- | --- |
| Consultation | OPD displays the facility's actual configured consultation identities and indicative prices; the selected master identity is stored on the encounter. The existing completion event, not visit creation, triggers charging. Creation requests can use an actor- and facility-scoped idempotency key. | Missing selections, including old encounters whose review flag is false, cannot auto-bill from encounter type; completed work remains unresolved until an authorized selection. An encounter with a consultation line or ambiguous unprovenanced invoice item is refused for financial review. Existing billed lines are not rewritten. |
| Laboratory | The OPD order form searches actual facility investigations, allows multiple **distinct** tests and requires a separately reviewed active specimen option for each. The facility's positive approved price or a clear unavailable reason is shown per test, with a cent-safe indicative total. Verified results and explicit completion, not ordering or collection, trigger one charge per order. | Multiple distinct tests are supported, quantity one per order; repeated quantities and panel completeness rules are not implemented. A test is not a specimen. The old `Whole Blood` default is not a clinical rule. |
| Legacy laboratory requests | Single orders and batches remain available for care. A single order can provide an explicit reviewed specimen option. Without one, it is marked for review, even when it has a real test ID. A legacy batch with only a shared specimen can request at most one investigation; it cannot copy that specimen across multiple tests. Free text never acquires an investigation ID merely by matching a name. | Unreviewed completed work is unbilled and queued. Historical orders without a persisted reviewed option also require review, even if their old exception flag is false. There is **no controlled identity/specimen review and correction workflow yet** for those rows; do not silently edit them or retry them as though reviewed. Previously billed history is not reclassified or amended. |
| Radiology | The particular examination identity and its indicative facility price are shown; an encounter-linked order records the selected examination. The first explicit report triggers billing and order request keys protect retries. | Neither modality nor free-text description supplies a tariff. An unselected clinical request can remain unpriced. |
| Add Service | A shared, permission-gated panel appears in OPD and eligible cashier encounter invoices. It creates encounter-linked laboratory or radiology **clinical orders**, using the same catalogue, specimen and indicative pricing rules. | It is not a universal manual charge or a declaration that a service was performed. Only lab and radiology are supported, with quantity one per order. Unconfirmed orders do not change an invoice. |
| Pharmacy | The existing completion path resolves the actual dispensed inventory product and actual quantity against its facility price; replays are protected. | Prescribed-product equivalence remains a clinical/workflow verification item; a prescribed product alone is not a dispense. |
| Inpatient / maternity | The existing admission, ward-specific bed-day and delivery source handlers continue using configured, approved tariffs and durable attempts. | Bed-day inclusive calendar-day/same-day and transfer policy must be reviewed by each facility. Procedure, theatre, dialysis and many other discovered services do not have demonstrated complete automatic billing; they remain unresolved or unsupported rather than receiving invented prices. |

The strict resolver requires the correct tenant and facility, a valid performed/completed clinical source, the applicable source identity, positive active approved automatic tariff, service date, matching department and unit, and applicable effective dates. For laboratory tests, dispensed products and wards it uses the actual source mapping or an explicitly approved structured alias; matching codes alone do **not** establish a crosswalk or resurrect a retired mapping. Selected consultations and imaging carry their own master ID. The existing admission and delivery paths use source-defined internal identities, not payer codes. A price preview is indicative: completion revalidates current configuration at the clinical service date, so it is not a guarantee of a later price.

Catalogue synchronization can create a one-to-one master identity from an actual facility-owned source ID and a linked inactive, draft, zero-price placeholder. It does not infer a crosswalk from similar names or overwrite an existing facility price. The administrator can explicitly link a legacy tariff without changing its price, edit/activate and approve a tariff with revision/history, manage reviewed source links and aliases, use import/export, and retry unresolved work subject to the resolver's checks. Zero means **unconfigured**, not free. Approved tariffs require an actor, timestamp and reference. Reviewed specimen options require an external clinical review reference and have audited creation/retirement; no options were seeded from the legacy default.

## 3. Encounter billing, history and access

The read-only OPD encounter view and existing cashier use the same invoice records and item snapshots. The view shows service description/code/department, quantity/unit, price/total, source, service date and recorded/void status where present; missing historical snapshots are labeled rather than invented. It shows item subtotal, recorded payments, recorded refunds, net receipts, outstanding balance and credit, with errors if receipt/header amounts cannot be reconciled. An unpaid invoice is not revenue, net receipts are not recognized revenue, and a manual refund is not proof of an external transfer.

**Item-level adjustments and controlled line reversals do not exist.** They are labeled unavailable, and the existing unpaid whole-invoice void is not a general correction facility. Historical invoices, posted journals and payments must not be silently edited or deleted. Authorized financial review and a separate controlled reversal process are prerequisites for correcting erroneous historic items.

Catalogue and clinical operations use existing permissions and facility/tenant scope; tariff administration additionally requires the existing facility-admin restriction. Encounter financial data is shown only to authorized non-platform users with `billing.read`; foreign-facility and foreign-tenant scenarios are tested. Scope-stamped UI state prevents a delayed response from being displayed for a different encounter. The previous unnecessary OPD `laboratory.read` request was removed. **Remaining access dependency:** the OPD patient list and triage queue still load together, and existing-visit observations, diagnoses and medications still load together; unavailable `appointments.read` or `pharmacy.read` can therefore block the desk rather than silently presenting an empty queue or medication list. This needs an independently reviewed UX/permissions design; no permissions were broadened here.

## 4. Synthetic configured values and observed journeys

The following values were deliberately created and approved **only inside disposable synthetic test databases**. They are not facility tariffs or payer codes.

| Synthetic example | Amount / evidence |
| --- | --- |
| Selected follow-up consultation | KES 150 in one facility, KES 333 for the same master in a second facility |
| Two distinct investigations | KES 80 and KES 45; independently reviewed synthetic blood and urine specimen options |
| Specific radiology examination | KES 300 |
| Combined encounter | One unpaid KES 575 invoice, four source lines, balance KES 575, paid KES 0; replay did not add lines |
| Earlier authenticated synthetic cross-module journey | Consultation KES 100 + lab 800 + radiology 300 + dispensed product 25 + admission 60 = KES 1,285, with source-linked items; these are test values only |
| Unconfigured cases | Draft, inactive, zero, future and expired prices, absent source mappings, missing/retired specimen options and unmatched investigations are refused or queued as applicable; no real unconfigured-service count is available. |

The actual Chromium journey authenticated with an ephemeral synthetic account, configured the synthetic catalogue and specimen reviews, selected a consultation and two investigations, ordered specific linked imaging, confirmed there were no order-time charges, collected/entered/verified/completed both tests, saved the imaging report, replayed completions, and inspected both OPD and cashier views. It verified the KES 575 unpaid invoice and that an additional unreported imaging order did not change it. This is browser evidence on synthetic data, not a real-facility user acceptance test. Additional real-HTTP PostgreSQL tests exercise consultation variants, reviewed old visits, ambiguous historical billing, separate facilities and tenants, explicit mappings and aliases, wrong or retired specimens, legacy requests, price approvals, exceptions, and duplicate protection.

## 5. Migrations and deployment prerequisites

This branch adds the following migrations after the earlier 0044–0046 catalogue work:

- `0047_clinical_service_selection`: encounter selection, reviewed specimen options and idempotent lab batches.
- `0048_consultation_review_state`: a review flag without rewriting historical selections.
- `0049_radiology_request_idempotency`: facility/actor request identity for imaging orders.
- `0050_encounter_request_idempotency`: facility/actor request identity for encounter creation.
- `0051_lab_clinical_exception`: an explicit non-billable exception marker without recoding older rows.
- `0052_lab_order_specimen_provenance`: nullable reference to the reviewed option actually selected; old rows remain null and are not inferred or backfilled.

A fresh isolated PostgreSQL 16 database successfully applied **all 53 migrations through 0052**. A second synthetic database applied 0052 incrementally. The full historical chain includes `0002`, which contains destructive operations; applying it was authorized only on new disposable synthetic databases. Never fake migration tracking, rerun the historical chain on an existing untracked database, or modify an already applied migration. On an authorized environment: take and verify a backup, inspect migration status and preflight, review 0044/0045 approval constraints and the proposed migration/rollback plan, apply only pending migrations during an approved window, and confirm status afterward. The safe rollback plan must preserve clinical and financial data and use a verified backup and approved operational procedures; it is not an instruction to drop new columns or rewrite invoices.

Facility go-live requires named clinical and finance review of the offered investigations, specimen choices, consultation/examination identities, mappings, activation, positive prices and effective dates; documented admission/bed-day/delivery policies; role and module access checks; review of unresolved and historical records without automatic recoding; appropriate financial reversal procedures; and actual facility user acceptance. No production access, data corrections, deployment, external payer or payment-provider test is implied by this branch or a merge.

## 6. Verification results

| Check | Result |
| --- | --- |
| Fresh disposable PostgreSQL migrations | 53/53 applied through 0052; no production database used |
| Full database-required `npm run test:coverage` | **197 files, 1,800 tests passed**; coverage thresholds passed; overall statements 61.53%, branches 56.16%, functions 62.21%, lines 62.69% |
| Focused clinical, legacy specimen, tariff and workflow regression | 84 tests passed across six files; includes actual HTTP and PostgreSQL |
| TypeScript, Prettier and ESLint | Passed; ESLint reports 79 warnings and no errors |
| Client and server production builds | Passed; client build reports a chunk larger than 500 kB |
| Chromium synthetic service-selection journey | Seven checks passed, including no order-time billing, KES 575 encounter and replay protection |
| `npm audit --audit-level=high` | Passed the high/critical gate; 10 moderate findings remain for dependency review |

One earlier full coverage attempt had a countdown test time out while several resource-intensive checks were running concurrently. That test passed independently and the subsequent full coverage run passed without competing checks; no test was skipped or timeout relaxed. GitHub pull-request checks are separate from these local results.

## 7. Files changed

- **Schema/migrations:** `drizzle/0047_*`–`0052_*`, `drizzle/meta/_journal.json`, `src/db/schema/{clinical,laboratory}.ts`.
- **Catalogue and billing:** `src/billing/{master-charge-resolver,clinical-catalogue.service,lab-specimen-config.service}.ts`.
- **Clinical persistence and APIs:** `src/db/queries/{encounters,laboratory,patients}.ts`, `src/routes/domains/encounters.routes.ts`, `src/routes/{laboratory,master-tariffs,radiology}.routes.ts`, and laboratory/radiology validation schemas. The patient query also fixes numeric/BigInt MRN-suffix overflow found by the synthetic regression suite; it does not change existing MRNs.
- **UI/contracts:** `OutpatientModule`, `RadiologyModule`, `BillingCashierModule`, `MasterTariffPriceList`, `InvoiceFinancialSummary`, `AddClinicalService`, `EncounterBillingView`, `ReviewedLabSpecimens`, the billing/clinical API clients and `src/types/index.ts`.
- **Evidence/tests:** `scripts/clinical-service-selection-browser-smoke.mjs`, new `clinical-catalogue-selection.db.spec.ts`, `patient-mrn-allocation.db.spec.ts`, `add-clinical-service.spec.tsx`, `encounter-billing-view.spec.tsx`, and updated workflow, resolver, safety, schema and finalized-invoice regressions.

## 8. Known open risks and next actions

1. Obtain an authorized facility-scoped read-only extract and verify the reported records, duplicate identities, actual approvals, prices, source mappings, completed orders and invoice provenance. No mapping or price is inferred from this report.
2. Design and authorize a controlled historical investigation/specimen identity review and an item-level financial reversal/amendment workflow. Until then, legacy unreviewed completed laboratory work remains unresolved, not automatically billed or silently changed.
3. Validate clinical specimen rules, result completeness, consultation and radiology completion triggers, drug equivalence, and inpatient bed-day policy with facility clinical and financial leads. The software does not establish clinical approval.
4. Extend department-specific clinical workflows and reviewed charge policies before claiming comprehensive service coverage. Add Service currently covers only lab and radiology; quantity handling is limited as above.
5. Decouple OPD queue/medication loading only through a safe design that preserves patient safety and authorization. Review catalogue-query performance for large facility catalogues and address the build-size and dependency warnings.
6. No real-provider connectivity, claims/payment settlement, production deployment, or real-facility browser acceptance was tested. Obtain the relevant official contracts, approvals, operational testing and security review separately.
