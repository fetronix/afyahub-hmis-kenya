# JaliCare HMIS: system achievements, gaps and next steps

**Repository review: 28 October 2026.** This report describes the checked-out source and the tests listed below. It is not a clinical safety certification, DHA/SHA approval, financial audit, live-deployment report, or proof that a third-party integration is connected. A screen, an adapter interface or a passing mock test is not proof that a real institution, insurer, bank or patient has used a workflow.

## 1. Executive assessment

JaliCare is a multi-tenant Kenyan hospital management application, not a collection of disconnected demos. The repository has an Express/TypeScript API and React/Vite interface on PostgreSQL with shared patients, encounters, tariffs, invoices, roles and facility scopes. It includes substantial workflows for registration, outpatient and inpatient care, diagnostics, maternity, pharmacy and inventory, billing, insurance, accounting, dialysis, booking and a patient portal. These vary in maturity: code and tests exist for many workflows, while external onboarding, integrated accounting, complete terminology and parts of client-specific clinical and booking workflows remain incomplete.

The most important achievement in the current change is a two-level payer registry: platform administrators control payer definitions, assignments and internal workflow policy; facility staff configure and activate only their assigned payers. SHA, Britam, PACIS and CIC are registered without claiming real connectivity. New claims use the same JaliCare patient and invoice records. The change also prevents an insurer approval or remittance advice from silently creating an invoice payment; reconciliation instead links a separately recorded, matching receipt.

**No payer sandbox, production payer connection, bank transfer, verified bank callback, clinical protocol acceptance, WHO terminology licence/download or WordPress installation has been established by this work.** Rollout requires a separate migration, permission provisioning, configuration, security review, clinical/financial review and facility/provider acceptance.

## 2. Architecture and security

| Area                     | What exists                                                                                                                                                 | Remaining work / caveat                                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Core stack               | `server.ts`, `src/app.ts`, `src/routes`, `src/db`, React components and API clients; PostgreSQL/Drizzle migrations                                          | Independent deployment, backups, monitoring, recovery rehearsal and performance testing are still required.                                                                                                  |
| Tenancy                  | Tenants, facilities, role/permission contexts, scoped query helpers and module guards; tests cover selected real HTTP and DB isolation paths                | Scope checks are a continuing security obligation, not a guarantee that every legacy route has been independently audited. Clinical access is not granted by payer or payment platform administration alone. |
| Authentication and audit | Staff sessions, invitation and role management, protected permissions, audit records, patient-identifier encryption support and secure-configuration checks | Deploy with appropriate keys and HTTPS; review operational policies, access logs, retention, backup recovery and data-protection obligations.                                                                |
| Platform administration  | Tenant/facility/module administration, payer registry and payment-provider registry                                                                         | Platform metadata access must remain separate from a facility's clinical and financial data. Registrations and assignments are not provider authorizations.                                                  |

## 3. Functional inventory

### Patients, care and diagnostics

- **Patient registration and front desk:** directory, MRNs and identifiers, reception, appointments, queues, patient associations and scoped patient access are represented in `src/db/queries`, `src/routes/domains/patients.routes.ts`, `src/routes/appointments.routes.ts` and the registration/reception components. Strong identity matching and inter-facility information sharing remain governance and privacy matters.
- **Outpatient and inpatient:** encounter/triage, observations, diagnoses, ward/admission, bed and nursing flows exist under `src/routes`, `src/inpatient`, and `src/nursing`. Theatre, laboratory and radiology have order/workflow components and route/service code. A navigation entry is not proof that every clinical step is complete or clinically approved.
- **Maternity and child health:** antenatal, labour/delivery, postnatal and immunisation modules and tests exist in `src/maternity`, `src/immunisation`, and the corresponding routes/components. Clinical validation, site-specific workflows and data quality require users and clinical owners.
- **Pharmacy and stores:** prescriptions, dispensing, inventory batches, expiry/stock handling, suppliers and purchase orders have existing workflows. Complete purchasing-to-payables accounting and reliable service-line cost attribution are not established.
- **Dialysis:** the newer `src/dialysis` implementation and migration add scoped machines, schedules, authorized plans, sessions, consumables and adverse-event structures. Do not infer treatment settings, outcomes or completion from scheduling. Facility-approved clinical protocols, comprehensive user acceptance, scheduling/consumable integration and controlled automated billing remain work to do. Earlier specialty-screen examples are not clinical records.
- **ICD:** historical ICD-10 diagnoses remain intact. `src/clinical/icd11` provides a WHO API boundary/reference metadata and guarded search when legitimately configured. There is no verified complete offline WHO catalogue, automatic ICD-10 recoding or demonstrated payer acceptance of every code. Licensed source, release metadata, availability and local terminology governance are required.

### Finance, claims and payments

- **Billing:** `src/billing`, invoice lines, facility tariffs, payments and receipt numbers support invoice and payment workflows. Invoice charges, outstanding receivables, recorded cash and insurer claims are different quantities. Posting a receipt requires an authorized billing action and does not itself establish an external bank confirmation.
- **Payer hub (current change):** `drizzle/0029_payer_integration_hub.sql`, `src/insurance/hub`, platform/facility views and granular permissions implement global registration/policy, per-facility requests, assignment, activation, distinct environment references and blocked production approval. Existing payer records require explicit platform review. Enabled payer selection is used for new legacy claims; provider disablement retains scoped history.
- **SHA eClaims:** existing FHIR/HIE boundaries and local preparation, validation, authorization/preauthorization, claim, rejection and remittance records are preserved. All operational SHA/DHA external calls and the unverified webhook are blocked; test mocks are not accessible as real payer operations. Some local SHA preauthorization/status steps have no complete manual alternative yet. No electronic conformance or live eligibility has been verified.
- **Private insurance:** Britam, PACIS and CIC remain separate adapters. Membership, documented manual eligibility, benefit estimates, mappings, preauthorization tracking, claims and rejection handling reuse core records. Public materials examined do not establish provider API contracts; no insurer API results are claimed. A manual dispatch or locally recorded decision is labelled as such.
- **Claim settlement:** neither preparing/submitting a claim nor importing advice proves payment. Legacy, private and SHA reconciliation link an independently recorded receipt with the same invoice, insurer, amount and remittance reference; locks and cross-workflow duplicate checks guard reuse. A receipt is a billing record, not independently verified bank funds. Simulated SHA claims/advice cannot be linked to real receipts. UI allocation requires the receipt; API-only advice allocations without one cannot currently be linked later.
- **Payment/banking hub:** `src/payment-hub` implements two-level provider governance and a Daraja sandbox adapter boundary with mocked tests. KCB, NCBA and Equity remain documented boundaries without implemented network operations. Provider sandbox, verified callbacks, production collection, transfers and disbursements remain unverified or disabled. No banking passwords, OTP collection, screen scraping or simulated transfer confirmations substitute for an API.
- **Accounting:** `src/accounting` has chart-of-accounts, journals, periods, controlled posting/reversal and bank-statement import/reconciliation foundations. Balanced, idempotent journals and closed-period checks are essential. Complete billing-to-ledger automation, supplier invoices/payments, fixed assets, full receivable reconciliation, verified service-line cost allocation and reliable profit reporting are not complete. Do not equate claims, invoiced revenue, cash or a local estimate with profit.

### Booking, patient portal and reporting

- **Website booking:** separate service authentication and scoped booking/appointment structures exist under `src/booking`. Availability across all staff and online diaries, operational deployment, real WordPress integration and provider notifications are not established. Never report a notification delivered without provider evidence.
- **Patient portal:** patient account, portal routes/components and notification interfaces exist. Public access, consent, identity proofing, actual messaging providers, observability and privacy review must be evaluated for deployment.
- **Analytics and reporting:** operational dashboards, billing/revenue reports, public-health records and audit screens are implemented. Completeness depends on source records and facility policy; they should not be interpreted as audited financial statements or externally submitted statutory reports without further evidence.

## 4. Provider status and onboarding

| Integration                  | Code / manual operations                                                          | Mock tests                       | Real sandbox                | Production            |
| ---------------------------- | --------------------------------------------------------------------------------- | -------------------------------- | --------------------------- | --------------------- |
| SHA / DHA / AfyaLink         | Local preparation/history and manual advice; external transport/callbacks blocked | Yes, isolated synthetic fixtures | Not verified                | Not approved; blocked |
| Britam / PACIS               | Manual eligibility and claim workflows, independent adapters                      | Yes, synthetic                   | Not verified                | Not approved; blocked |
| CIC / other registered payer | Manual boundary; CIC adapter deliberately unsupported for external operations     | Boundary and policy tests        | Not verified                | Not approved; blocked |
| Daraja                       | Sandbox transport boundary; no verified callback authenticity                     | Yes                              | Not tested by this delivery | Blocked               |
| KCB / NCBA / Equity          | Registry and separate adapter boundaries; no network operations                   | Policy tests                     | Not verified                | Blocked               |

Public documentation is not an agreement. Obtain each facility's signed contract, provider identifiers, current official API/portal contract and coding/tariff rules, scoped secret provisioning, callback authentication specification, sandbox access and explicit authorization before running a synthetic external test. See `docs/integrations/payer-integration-hub.md` and `docs/integrations/payment-banking-hub.md`.

## 5. Schema, migration and compatibility

Migration `0029` is additive: registry definitions, workflow policies, facility assignments/requests and per-environment references are added, and nullable payer/reference fields are added to the old claim ledger. Historic records and migrations `0000`–`0025` are not rewritten by this change. Legacy configurations are marked for assignment review rather than silently activated. Applying the migration and permission seed is a deployment operation; neither is performed automatically in production.

Older clients that submit manual claims must now supply a registered `payerCode` and the real external dispatch reference. Settlement now requires the ID of an independently recorded matching receipt and a real remittance reference. This is an intentional safety/compatibility change. API clients must handle disabled, unassigned and unsupported outcomes rather than treating them as insurer rejection or payment.

## 6. Verification and evidence

The pre-change baseline on a disposable PostgreSQL instance applied migrations `0000`–`0028` and passed 93 test files / 1,016 tests. This baseline is not evidence that the new payer hub works. The new `0029` migration was reapplied on a freshly recreated disposable `jalicare_test` database and the focused authenticated HTTP/DB suites exercise policy, patient/facility isolation, manual dispatch, rejection paths, advice versus receipt and concurrent receipt allocation. Test data and provider responses are synthetic.

**Final validation on the disposable database:** fresh migrations `0000`–`0029` and `db:status:all` passed; `format:check`, `typecheck`, `lint`, the full database-backed `npm test`, `build:deploy` (frontend and backend), `verify:dry-run`, and `git diff --check` passed. The full suite ran **1,022 tests in 95 files** with coverage of **50.31% statements, 45.12% branches, 46.00% functions and 51.13% lines**. Lint reported 67 non-blocking warnings (65 existing and two in the new payer-hub views). The frontend build reported a 1.33 MB minified bundle warning. These synthetic tests and passing builds do not constitute provider, FHIR conformance or clinical approval; no authorized provider sandbox test was performed.

## 7. Prioritized remaining work

1. **Safety and rollout:** independently review payer/clinical/finance authorization and audit paths, backup and rehearse migration/rollback strategy, seed permissions, and test with facility staff using synthetic data. Review retained legacy settings rather than silently assuming contracted benefits or codes.
2. **Payer onboarding:** obtain signed contracts and technical specifications; isolate secrets by facility/environment; implement documented transports only; add verified callbacks, replay controls and explicit production approvals; run only authorized sandbox tests. Provide a complete manual SHA preauthorization/decision pathway if needed.
3. **Reconciliation:** add a safe later receipt-link action for previously allocated advice, formal bank evidence, finance approval workflows and an end-to-end accounting reconciliation. Do not auto-create payments from payer responses.
4. **Clinical and terminology:** approve local dialysis workflows and protocols; complete scheduling and consumable checks; integrate authoritative, properly licensed ICD-11 release data and payer-specific coding policies without changing historical diagnoses.
5. **Accounting and procurement:** integrate billing with balanced, idempotent journals and controlled reversals; complete receivables, supplier invoices/payment and fixed assets; prove cost allocation before reporting profit.
6. **Booking, portal and notifications:** unify staff and web availability, harden external authentication and rate limits, perform real site/provider integration testing only with permission, and audit consent, delivery receipts and privacy.
7. **Quality:** expand behavioural and concurrency tests, accessibility and small-screen checks, load tests, data-retention controls, monitoring and independent security/clinical review. Passing mocked tests is necessary but insufficient.

## 8. Source pointers

- Setup and runtime: `README.md`, `docs/architecture/OVERVIEW.md`, `src/app.ts`, `src/db/schema.ts`.
- Payer implementation and onboarding: `docs/integrations/payer-integration-hub.md`, `src/insurance/hub`, `src/integrations/sha`, `src/insurance/payers`.
- Payment and banks: `docs/integrations/payment-banking-hub.md`, `src/payment-hub`, `src/billing/payments.service.ts`.
- Dialysis, accounting, booking and terminology baseline: `docs/architecture/dialysis-client-sprint-audit.md`, `src/dialysis`, `src/accounting`, `src/booking`, `src/clinical/icd11`.
- Quality: `src/tests/vitest`, `src/tests/integration`, `docs/testing/KNOWN-GAPS.md`, `.github/workflows`.
