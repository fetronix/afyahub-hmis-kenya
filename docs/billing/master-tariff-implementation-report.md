# Master tariff catalogue and automatic invoicing — implementation and release review

**Status: partial implementation; not a production-readiness or clinical-acceptance claim.** This branch has not been deployed and has not inspected or changed any real facility's data. Facility-specific tariff approval, historical reconciliation, clinical policy and operational acceptance remain required.

## What is implemented

- The existing hospital-service discovery is in `docs/audits/hospital-service-discovery/`: 180 inventory rows, 46 department classifications and 21 workflow traces. Those rows distinguish implemented services, candidates, configuration and missing modules; they are not evidence that any facility offers or prices a service.
- `0044` introduces internal master identities, facility source mappings, approval metadata and line snapshots. Global identities are outpatient consultation, follow-up, emergency consultation, admission, and the six explicitly represented delivery modes (spontaneous vertex, assisted vaginal, breech, vacuum, forceps, Caesarean). These are internal JaliCare codes, not payer or government codes.
- Synchronisation creates source-backed identities for actual active laboratory test records, inventory items with a unit and wards, and inactive, zero-price, unapproved facility placeholders. It never updates existing tariff amounts. Missing units are reported rather than guessed. Specific radiology examinations can be created by an authorized facility administrator. The catalogue is not a substitute for facility clinical review.
- `0045` tightens scope and approval guards, provides reviewed structured-code aliases and adds explicit laboratory completion. `0046` adds service date/time snapshots without backfilling historic invoices.
- The master tariff administration view is mounted under **System Configuration → Service Pricing & Tariffs**. It offers scoped synchronisation, search/filter, batch edits, CSV import/export, approval and audit history, explicit source mappings, reviewed aliases and audited alias retirement, legacy-tariff attachment, specific imaging creation and an unresolved-charge queue. Price edits invalidate approval. Existing price rows are retained; linking an existing tariff requires explicit review.
- Automatic pricing uses the actual completed source and, in order where applicable, an explicit source mapping, a persisted selected master ID, an approved structured-code alias, then an exact unambiguous structured code. It never chooses by specimen, modality, family, vague description, inferred name or a client-supplied price. The scoped, active master and facility tariff must be compatible with the source, department and unit; the tariff must be active, auto-billable, approved, positive and effective on the service date. Zero is unconfigured, not free. Reviewed identity and tariff rows are protected during the invoice transaction. Manual selection of a tariff is also revalidated within the invoice transaction; explicitly priced manual lines remain a separate path.
- Encounter completion, verified laboratory investigation completion, first imaging report, actual stock dispensing, admission and delivery record durable billing work with the clinical transaction. A transfer or discharge records the calculated bed-day identities before commit; retries retain the original ward/date and check against recorded occupancy. Source identity and existing idempotency keys prevent duplicate lines. Unresolved work remains visible and can be retried or explicitly written off by authorized staff. Patient, encounter, tenant/facility, master/tariff, code, description, quantity, unit, price, source and occurrence snapshots are retained on new automatic lines.
- The cashier displays line provenance, code, department, unit, service/billing time and invoice status. Recorded payments and refunds are distinguished from net receipts and outstanding balance. Item-level adjustments are explicitly unavailable; recorded receipts are not recognized revenue or proof of an external transfer. Historic fields that were never captured are shown as unavailable.

### Workflow coverage and unresolved areas

| Source | Implemented automatic boundary | Remaining qualification |
| --- | --- | --- |
| OPD, follow-up, emergency | Explicit completed encounter; one source identity per encounter | Existing prices require mapping and approval; clinical services bundled into a visit need facility policy. |
| Laboratory | Explicit completion after all **recorded** results are verified; exact test ID | This does not prove that every expected panel component exists. Shared specimens/panels require clinical review. Free text and specimen never establish identity. |
| Radiology | First recorded report for an explicitly selected examination | Ordering alone does not charge. A report is the implemented boundary, not independent proof of a performed examination. |
| Pharmacy | Actual dispensation and inventory item/quantity | Matching the actual inventory product does not establish equivalence to the prescribed drug, strength or formulation; this requires further clinical safeguards. |
| Admission | Admission record, separate from bed-day work | Facility-specific admission charges and policy require review. |
| Bed days | Ward/date identity and persisted transfer history; pending work is recorded atomically at transfer/discharge | The existing engine uses **inclusive calendar-day** accrual (including same-day stays), not a verified facility-specific overnight rule. Same-day ward moves, date-only legacy records, historical transfer conflicts, the 400-day cap and timezone-less historical timestamps need policy/data review. Do not assume the word “night” establishes a completed overnight stay. |
| Maternity/delivery | Explicit delivery record, once per delivery rather than per baby | Mode-specific identity must be reviewed and priced. Do not infer individual procedures or bundle contents. |
| Procedures | Only an explicit completion attempts billing | No strict procedure-master mapping is implemented: attempts remain unresolved. |
| Theatre, dialysis and other specialty services | No demonstrated complete automatic master billing | They remain separately incomplete/unresolved. Do not invent offerings, protocols, completion events or prices. |

No item-level correction/reversal ledger is implemented. The existing authorized, audited **whole-invoice void** applies only to an unpaid invoice without active accounting postings; it is not a general reversal of individual lines. Paid invoices and posted journals require the existing controlled accounting/financial review and reversal workflow. Do not silently edit or delete historical financial records.

## Facility 2 / tenant 2 investigation

The reported values and symptoms are **user-supplied and unverified**: OPD-CONSULT KES 100, LAB-BLOOD 800, LAB-URINIALYSIS 600, LAB-SPUT 289, RAD-001 300, RAD-002 360, RAD-003 234 and RAD-004 1,200. No authorized real-data connection was available. No actual tariff, mapping, invoice, charge attempt, patient or report for that facility was queried or changed. In particular, no conclusion can be drawn about the reported sputum line with `testId null` or about whether a particular historic charge is erroneous.

With authorized access, a designated facility billing officer should inspect the relevant scoped source, historical line snapshots, original tariff/mapping/alias, queue attempts and audit entries, then follow approved clinical/financial correction procedures. Never infer blood, urine, sputum or an imaging examination from specimen/modality or correct a posted line in place. Real examples must not be exported into source, logs or fixtures.

## Migration and cutover precautions

All migration testing was performed on newly created isolated synthetic PostgreSQL databases only. **Do not execute the historical chain on an existing database without an authorized backup and migration plan:** it includes earlier destructive DDL. Before any deployment, verify the exact existing migration hashes and schema, take and test a secure backup, rehearse on an isolated copy, confirm maintenance and rollback procedures, and review the generated migration plan. Do not rewrite applied migration history, delete a database, or silently reconcile historical records.

The new migration files are `drizzle/0044_master_service_catalogue.sql`, `0045_catalogue_scope_and_completion.sql`, `0046_billing_service_occurrence.sql` and the corresponding journal entries. `0044` gives existing tariffs `DRAFT` approval without changing their configured prices. This is a consequential cutover: existing automatic charges will be unresolved until an authorized person explicitly maps, reviews and approves each applicable facility price. Prepare a staged mapping/review plan and monitor the unresolved queue before enabling the new workflow. The new database triggers also invalidate approval on subsequent changes to price, unit, code, dates, scope, activation or auto-billing.

Before `0044`, check for conflicting pre-existing object names, constraints and the ten seeded `JC-*` codes. After `0044` and before `0045`, check for approved rows with missing/blank approval references, missing actor/timestamp/master, nonpositive fees, tenant/facility/master scope conflicts or mismatched units. For example, a read-only check after `0044` is:

```sql
SELECT count(*) AS invalid_approvals
FROM facility_service_tariffs
WHERE approval_status = 'APPROVED'
  AND (master_service_id IS NULL OR approved_by_user_id IS NULL OR approved_at IS NULL
       OR approval_reference IS NULL OR length(trim(approval_reference)) NOT BETWEEN 3 AND 200
       OR fee <= 0 OR length(trim(unit)) = 0);
```

Investigate any results with an authorized administrator; do not automatically repair financial data. A count alone does not verify all scope, date, unit, identity or migration compatibility checks. `0045` intentionally fails on invalid existing approvals rather than rewriting them. Test downgrade/recovery and the impact on queued work in a staging environment; restoring a backup over newly posted clinical or financial transactions would lose data and is not an automatic rollback plan.

## Synthetic verification

- Fresh synthetic PostgreSQL: all **47 migrations** applied; a separate synthetic preservation check compared the pre/post fields of two pre-existing priced tariff rows. Synchronisation and explicit legacy linking were also tested without changing an existing synthetic KES 100 price. This is not proof about any live facility's prices.
- Full synthetic regression: **193 files / 1,776 tests passed** with the database required. The master workflow suite includes exact laboratory and imaging, actual dispensed item and quantity, duplicate prevention, zero/unapproved/future/expired blocks, facility-specific prices, source/alias precedence and retirement, refund-adjusted balance, reviewed void, durable transfer handoff and an authenticated HTTP journey for OPD, laboratory, imaging, pharmacy and admission.
- Typecheck and format check passed. Lint passed with **0 errors and 73 warnings**. Production client and server build passed; Vite reported a large client chunk warning.
- Synthetic Chromium smoke passed with the production build and secure synthetic bootstrap (login, registration, pharmacy lost-response recovery, laboratory verification, inpatient admission, payments/refunds and navigation). A separate `scripts/master-tariff-browser-smoke.mjs` run verified facility-admin login, the master price list, synchronisation, preservation of an existing synthetic price, and editing and approving a synthetic tariff through the browser. It does **not** verify every tariff operation or real facility data.

## Files and further review

Primary new/changed areas: the three migrations; `src/db/schema/{master-services,billing,laboratory}.ts`; `src/billing/{master-catalogue.service,master-charge-resolver,billing.service,charge-attempts,service-charges}.ts`; clinical queries and routes for encounters, laboratory/radiology, inpatient, maternity and pharmacy; `src/routes/master-tariffs.routes.ts` and invoice routes/queries; `src/components/modules/{MasterTariffPriceList,InvoiceFinancialSummary,BillingCashierModule,ConfigurationModule,LaboratoryModule,OutpatientModule,RadiologyModule}.tsx`; billing/diagnostic clients and types; and the synthetic integration and regression tests. The existing patient, invoice, inventory, payment, SHA/private-claims and accounting subsystems remain the systems of record.

Before release, complete facility 2's authorized investigation, verify facility-approved service mappings and clinical triggers, confirm bed-day policy, implement controlled item corrections/reversals and review missing modules, validate prescribed-product equivalence, exercise the tariff UI and full workflows with facility users, verify historic inconsistencies, and review reporting so invoiced amounts are never called collected revenue. Obtain clinical, financial, security and deployment approvals. External payer or payment-provider connectivity has not been tested by this work.
