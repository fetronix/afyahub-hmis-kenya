# Billing and financial management — baseline audit

**Baseline recorded before the ward-default/bed-override implementation requested
on 2026-11-03.** This is an engineering inventory, not hospital acceptance.

## Source and test state

- The required branch is `arena/e088f11d-afyahub-hmis-kenya`, based on merged
  `main` commit `63903c5ef2cd5dae6ea693a684993e7cd57a506c` (PR #34). Main
  was fetched and confirmed at that revision. The working tree already
  contains the preceding readiness/CI, security, lab safety and formatting work;
  it is not a pristine checkout. No production system or live records were used.
- The current journal ends at 0065. A newly created synthetic PostgreSQL 16
  database applied all 66 migrations; the complete suite with coverage passed
  **212 files and 1,964 tests, zero skipped**, with global statement/branch/
  function/line coverage 62.38%/57.96%/62.87%/63.55%. This run includes the
  preceding regression repairs, not the ward-default work that follows. The
  actual Docker bootstrap remains unverified because this sandbox has no Docker
  daemon. A different populated synthetic database was upgraded through the
  final guarded 0064 with its old rows checked; this is not a production rehearsal.

## Existing implementation and gaps

| Area | Evidence in repository | Baseline status / limitations |
| --- | --- | --- |
| Facility catalogue | `src/routes/facility-services.routes.ts`, `facility-charge-resolver.ts`, `facility-owned-billing.db.spec.ts` | Scoped CRUD, activation, tariff snapshots and positive/effective-price checks exist. Service creation currently requires `initialPrice`; a complete safe zero-price initialization of every supported catalogue is not established. No silent repricing is permitted. |
| OPD | `src/db/queries/encounters.ts`, `service-charges.ts`, facility-owned and clinical catalogue suites | Selected facility consultations charge on completed encounter with idempotent attempts. Manual service selection and existing historical review remain relevant; registration or an order alone is not evidence of care completion. |
| Laboratory | `src/db/queries/laboratory.ts`, `src/routes/laboratory.routes.ts`, `laboratory-facility-identity.db.spec.ts` | Scoped service identity, specimen/accession handling, verified results, explicit completion and facility pricing are implemented. Name/specimen inference is prohibited; missing prices remain unresolved. KES 456 was demonstrated only synthetically. Real facility workflow acceptance and historical conflict review remain open. |
| Radiology | `src/routes/radiology.routes.ts`, `src/db/queries/laboratory.ts` | Selected facility service and report-triggered charge have synthetic tests; independent clinical review/release and facility acceptance are not established. |
| Pharmacy | `src/inventory/inventory.service.ts`, `pharmacy-inventory-charge.ts`, `pharmacy-inventory-billing.db.spec.ts` | Actual dispensing, FEFO batch evidence, partial quantity, inventory selling-price snapshot and duplicate protection are tested. Integrated medicine returns/reversals and untracked-stock reconciliation remain incomplete; no clinical service tariff should price medicines. |
| Bed billing | `drizzle/0062*`, `0063*`, `0065*`, `src/inpatient/bed-*.ts`, `inpatient-bed-billing.db.spec.ts` | Configurable facility cutoff, occupancy snapshots, discharge work and idempotent bed-night invoices exist. **The selected price is presently only `beds.daily_charge`; ward fallback/override provenance is not implemented.** Existing ward `daily_rate` has a historical 1500 default and cannot be assumed to be an approved rate. Historical or missing evidence stays unresolved. Real policy, configured bed/ward price and discharge invoice remain unverified. |
| Payments | `src/billing/payments.service.ts`, `invoice-payment-acceptance.db.spec.ts`, payment hub | Cash/manual receipts, partial allocation, balance locking and idempotency exist. M-Pesa Daraja is sandbox-oriented and a callback is not verified settlement; there is no established live card adapter. No live payment or provider verification has been performed. |
| Refunds | `src/billing/refunds.service.ts`, `refund-receipt-acceptance.db.spec.ts` | Authorized manual refund receipts preserve history and are idempotent. They are not proof of an external transfer; a separate request/approval lifecycle and integrated accounting reversal are not established. |
| General ledger | `src/accounting/accounting.service.ts`, `billing-posting.service.ts`, `billing-ledger-diagnostics.service.ts` | Balanced journals, periods, controlled reversals, explicit reviewed billing postings and diagnostics exist. **Automatic posting, facility-approved account mapping, claims/remittance/supplier posting and bank reconciliation are not established.** Claim submission/acknowledgement is not payment. Do not invent accounts, recognition rules, payer splits or external settlement. |
| Reporting | `src/reporting/reporting.service.ts`, `src/accounting/accounting.service.ts`, billing analytics | Scoped operations reports and ledger-based trial balance, profit/loss and balance sheet exist. The requested complete report list, source reconciliation, all payer/card channels and stock valuation require individual evidence; an amount match alone does not prove accounting reconciliation. |
| Acceptance/security | `docs/audits/hospital-readiness-2026-11-03.md`, `docs/security/DATA-EXPOSURE.md` | No actual facility UAT, production deployment, backup recovery or TLS verification. Reachable public Git history contains sensitive dumps and credential material; authorized containment, rotation and history cleanup are open release blockers. |

## Safe migration strategy for ward default with bed override

`wards.daily_rate` already exists, but its historical schema default is
`1500.00` and existing values do not prove that a facility explicitly approved
that rate. Reusing those values automatically would invent prices. A safe
forward migration must preserve every existing rate and financial/clinical row,
mark legacy ward rates unconfirmed until an authorized facility user reviews them,
remove the inherited default for new records without rewriting existing values,
and record an auditable price revision and source. Do not copy a ward rate into
beds, change previous occupancy/night/invoice snapshots or backfill historical
admissions. A newly occupied bed may use an explicit, valid bed override;
otherwise it may use an explicitly confirmed, valid ward default. An unconfirmed
legacy bed default must remain review-required rather than silently falling
through to a ward rate. Missing, zero or invalid rates must remain unresolved.
A transfer snapshots the new occupancy's applicable rate and source while earlier
periods remain unchanged. Changes must be transactionally locked, scoped,
authorized, audited and regression-tested on fresh and populated synthetic
PostgreSQL before any production migration is considered.

Automatic accounting needs a separately approved facility chart of accounts,
account mappings, recognition/split and closed-period policy. Until those are
explicitly configured and authorized, retain reviewed postings and report the
unposted state rather than inventing entries or calling a claim/payment settled.
