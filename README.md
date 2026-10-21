# JaliCare Kenya HMIS — Updated Project Handover
**Last updated:** 21 October 2026  
**Client:** PUCHE — Level 3B healthcare facility  
**Current milestone:** Step 6 — OPD, triage and consultations  
**Overall status:** In progress

> **Bring the database up to date first.** Three migrations (0012, 0013, 0014) are
> not applied on the development database. Every command, and what to do when one
> fails, is in **[§10 Migrations and full sync](#10-migrations-and-full-sync)**.

## 1. Repository and development environment

- **Local path:** `C:\Users\Admin\Downloads\afyahub-hmis-kenya`
- **GitHub repository:** `fetronix/afyahub-hmis-kenya`
- **Working branch:** `restructure/phase-2-foundation`
- **Stack:** React, TypeScript, Express, PostgreSQL and Drizzle ORM.
- **Development approach:** Precise PowerShell changes, minimal-risk edits, preserve existing work, implement objectively and verify with evidence.

## 2. Roadmap status

Status reflects what is in the repository on 21 October 2026, checked against the
code rather than carried forward from the previous handover. "Covered by tests"
means contract or unit assertions run in CI (`npm test`); it does **not** mean the
screen was exercised, or that a clinician has accepted it.

1. **Foundation and project structure — Completed**
2. **Authentication, permissions and onboarding — Completed** (staff invitations, role catalogue, permission seed)
3. **Multi-tenant and facility security — In progress.** Most queries are scoped through `resolveFacilityScope` and `getFacilityByIdScoped`. Three clinical paths are still unscoped: `getObservations`, `getDiagnoses`, `recordDiagnosis`. This is the last known cross-facility read in the codebase.
4. **PUCHE facility overview — Completed**
5. **Patient registration and records — Completed**
6. **OPD, triage and consultations — In progress; current priority.** Queue and triage exist; the queue → triage → consultation → investigation → follow-up path has not been walked end to end.
7. **Inpatient, wards, beds and theatre — Implemented.** Admission board, transfers, discharge authorisation and theatre cases. Covered by 48 assertions in `test:inpatient`. No user acceptance.
8. **Maternity, MCH and preventive services — Not started.** No dedicated module; only incidental references inside `SpecialtyModule` and `ReceptionQueueModule`.
9. **Laboratory and radiology — Implemented.** Result entry and verification are separate: `addLabResult` writes `Pending Verification` with `verifiedBy`/`verifiedAt` null, and `POST /api/lab-results/:id/verify` is gated on `laboratory.results.verify`. The schema column is nullable since migration 0008.
10. **Pharmacy, inventory and procurement — In progress.** Batch tracking, expiry control and FEFO dispensing implemented (80 assertions). Procurement screens exist; no test coverage.
11. **Tariffs, billing, payments and insurance — Implemented.** Billing spine, mobile money settlement with overpayment handling, and the claims workflow (draft → submit → adjudicate → settle). 31 + 85 + 93 assertions.
12. **Reports, analytics and public-health reporting — Implemented.** Analytics summary and the reporting dashboard (216 assertions).
13. **Interoperability and integrations — Implemented to the published contract.** DHA/AfyaConnect client, readiness report, member eligibility, coverage and service-area mapping. Professional registration verification against the Health Worker Registry (§3.8). **No live credential exists, so nothing has been exercised against DHA.** 176 + 100 assertions.
14. **Security, regression and user acceptance testing — Not started.**
15. **Production deployment and handover — Not started.**

**Status definitions:** Completed means implementation progress has been reported. Verified requires relevant implementation and test evidence. Do not mark a milestone Verified solely because the TypeScript check and production build pass.

## 3. Work completed in the latest session

### 3.1 API action permissions added

Targeted permission middleware was added to the following routes in `src/app.ts`:

| Endpoint | Permission added |
|---|---|
| `GET /api/appointments` | `appointments.read` |
| `POST /api/appointments` | `appointments.create` |
| `GET /api/observations` | `clinical.read` |
| `POST /api/observations` | `clinical.create` |
| `GET /api/diagnoses` | `clinical.read` |
| `POST /api/diagnoses` | `clinical.create` |
| `GET /api/procedures` | `clinical.read` |
| `POST /api/procedures` | `clinical.create` |
| `GET /api/lab-tests` | `laboratory.read` |
| `GET /api/lab-orders` | `laboratory.read` |
| `POST /api/lab-orders` | `laboratory.orders.create` |
| `PUT /api/lab-orders/:id/status` | `laboratory.results.enter` |
| `GET /api/lab-results` | `laboratory.read` |
| `POST /api/lab-results` | `laboratory.results.enter` |

These are implemented middleware changes. Facility/tenant query isolation and end-to-end role tests for these endpoints have **not yet been verified**.

### 3.2 Doctor default permissions updated

In `src/auth/staff-role-catalogue.ts`, the default `DOCTOR` permissions now include:

- `laboratory.read`
- `laboratory.orders.create`

This supports clinicians viewing laboratory information and ordering investigations.

The doctor role was **not** granted `laboratory.results.enter` or `laboratory.results.verify`. The laboratory technician role retains its configured laboratory permissions.

**Important:** Updating the default role catalogue does not automatically prove that existing database role assignments or explicit facility permission overrides have changed. Verify effective permissions for existing users before claiming the change applies universally.

### 3.3 Validation completed

After these permission changes:

- `npx tsc --noEmit` — passed.
- `npm run build` — passed.
- `git diff --check` — no whitespace errors reported; normal Windows LF/CRLF warnings may appear.
- Production build output reported a JavaScript chunk of approximately 628.90 kB and a Vite warning about chunks larger than 500 kB. This is a performance optimisation item, not a build failure.

These checks establish successful compilation and bundling. They do not establish that the permissions work correctly at runtime or that facility/tenant isolation is secure.

### 3.4 Pharmacy stock batches, expiry control and FEFO dispensing

`inventory_batches` existed in the schema but nothing wrote to it, so every dispense deducted from `inventory_items.current_stock` with no idea which physical box left the shelf and no protection against handing out expired stock. That is now implemented.

**Database:** no migration was required. The existing `inventory_batches` table is used as-is. Receiving stock writes `batch_number`, `expiry_date` (text, ISO `YYYY-MM-DD`), `quantity_remaining` and `cost_per_unit`.

**Endpoints added** (all under the existing `inventory` facility module):

| Endpoint | Permission | Purpose |
|---|---|---|
| `GET /api/inventory/batches` | `inventory.read` | Batch ledger with expiry status; filter by item, status or horizon |
| `GET /api/inventory/expiry-summary` | `inventory.read` | Expired/expiring units and KES value at risk |
| `POST /api/inventory/:id/batches` | `inventory.manage` | Receive stock into a batch |

**Dispensing changed:** `POST /api/pharmacy/dispense` now runs inside a transaction that row-locks the candidate lots, selects usable lots ordered by `expiry_date ASC, id ASC`, and consumes the earliest expiry first. The response gained `stockTracking` (`FEFO` or `untracked`), `allocations` (batch, expiry and quantity per lot), `stockAfter` and `billing`. Dispensations record the batch numbers drawn.

**Rules enforced:**

- A batch expiring today is usable; it becomes `Expired` the following day.
- Only ISO `YYYY-MM-DD` dates are accepted. Impossible dates such as `2026-02-31` are rejected rather than silently rolled forward.
- Expired stock is never allocated. A shortfall reports requested, available and expired units separately so "we have none" is distinguishable from "ours are all out of date".
- An item with at least one batch row is dispensed by FEFO only; a partial fill is refused rather than silently substituting. An item with no batch rows falls back to the existing `current_stock` decrement and is labelled `untracked`, so pre-existing catalogue items keep working.
- Receiving stock that is already expired is refused. Receiving an existing batch number tops up that lot and never extends its recorded expiry; the response flags `expiryMismatch` when the supplied expiry differs.

**Screens:** Inventory has an Items/Batches tab split with expired and expiring counts, a status filter, and a Receive Batch form. The pharmacy dispense dialog no longer asks the pharmacist to type a batch number — it reports which lots the server drew and warns when expired stock is on the shelf. The dashboard summary gained `expiringStockAlerts`.

**Validation completed:**

- `npm run test:pharmacy-batches` — passed, 80 assertions covering date parsing, expiry boundaries, FEFO ordering and tie-breaking, expired-stock exclusion, shortfall reporting, cent-based valuation and route/UI wiring.
- `npm test` — passed: 48 inpatient, 31 billing, 80 nursing, 216 reporting, 80 pharmacy batches, 545 migration.
- `npm run build` — passed (`✓ built in 602ms`), with the same pre-existing chunk-size warning.
- `npm run lint` — reports only the pre-existing `src/lib/firebase.ts` missing-config error.
- `npx tsx` runtime-shape probe — 19/19 checks confirming the service orders and locks lots the way the pure planner assumes, and that a realistic three-lot shelf draws near-expiry stock first.

**Not verified:** no PostgreSQL instance was available in the working environment, so the endpoint-to-database path (transaction rollback, row locking under contention, live expiry SQL) has not been executed against a real database. No browser check of the two screens was performed. Confirm both on staging before treating this as Verified.

### 3.5 Mobile money payments, overpayment handling and a migration runner that reports failures

**Why the migration appeared to succeed and did nothing.** `drizzle-kit migrate` renders a spinner and calls `process.exit()` from inside its error handler, so the underlying Postgres error is never printed. Running it against an unreachable database reproduces this exactly: one spinner frame, no message, exit code 1. On Windows the spinner is not even visible, so the command looks like it worked while `__drizzle_migrations` still reports `0008` and `0009` as pending.

`npm run db:migrate` is now `scripts/migrate.ts` instead of `drizzle-kit migrate`. It applies the same journal entries and writes the same tracking rows, but:

- prints the plan first (`--dry-run` executes nothing);
- names the migration and statement that failed, with the Postgres code, detail and hint;
- rolls everything back on failure, so a half-applied migration cannot happen;
- strips a leading UTF-8 BOM and says so, because a BOM in `0008` once blocked both `0008` and `0009`;
- matches on the migration hash rather than on timestamps, so a tracking table that has drifted ahead of the journal cannot make it skip migrations silently.

The original command is still available as `npm run db:migrate:drizzle`.

**Mobile money.** The cashier records two things: the amount received and the code printed on the customer's M-Pesa or Airtel confirmation message. Everything else is arithmetic.

- **Codes are real or rejected.** An M-Pesa code is validated as two letters followed by eight letters or digits. The screen no longer fills in a plausible-looking `MPESA-XXXXXXX` reference of its own, and the "Simulate STK Push" button — which reported success without contacting Safaricom — has been removed. A code that was not generated by Safaricom cannot be reconciled against the statement, so it is worse than no code at all.
- **A code can only be receipted once.** A partial unique index on `lower(transaction_code)` means entering the same message at two counters produces one receipt, not two credits. The API returns `409 DUPLICATE_TRANSACTION_CODE`.
- **Receipt numbers come from a Postgres sequence**, so two tills cannot mint the same number.
- **Three outcomes, stated plainly.** Every payment is classified `FULLY_PAID`, `BALANCE_REMAINING` or `OVERPAID`, and the response carries the arithmetic behind the verdict. The cashier screen previews the outcome live using the same pure functions the server uses, so the screen and the receipt cannot disagree.

**Overpayment.** A patient who rounds up, or pays a deposit before the bill is final, is a real event at a Kenyan counter. The payment is accepted, but only after confirmation:

- without explicit confirmation the API returns `400 PAYMENT_EXCEEDS_BALANCE` with `{ outstandingCents, amountCents, excessCents }`, so a mistyped extra zero is caught;
- once confirmed, the invoice is marked `Overpaid` and the excess is written to `billing_invoices.credit_balance`;
- `balance_amount` never goes negative. A negative balance would quietly cancel out other patients' debts the moment the facility totalled what it was owed.

**Payment ledger.** `GET /api/billing/payments?facilityId=&invoiceId=&method=` returns receipts newest first with the transaction code and settlement outcome, for reconciling a shift against the M-Pesa statement. It requires `billing.payments.record` and is scoped to the caller's facility.

**SHA.** A SHA-covered balance is not a payment, and the cashier screen now says so. It is raised as a claim in the Insurance module and settled when SHA remits. **There is no live SHA integration.** No public SHA claims API with documented credentials was available to build against, and a facility cannot submit claims without SHA accreditation and their onboarding. Nothing in this system calls SHA, and no screen claims to have verified a member or submitted a claim.

**Migration:** `0010_mobile_money_settlement` adds `billing_invoices.credit_balance`, `billing_payments.transaction_code`, `billing_payments.settlement_status`, the partial unique index and the receipt sequence. Every statement is guarded with `IF NOT EXISTS`.

**Validation completed:**

- `npm run test:payments` — passed, 81 assertions covering cent-accurate parsing, all three settlement outcomes, one-shilling overpayment, code validation for both networks, rejected invented references, and the migration/index wiring. It also asserts that no `.sql` file in the journal starts with a BOM.
- **Live PostgreSQL 16 run** — the migration runner was exercised from a simulated pre-migration database (`0000`–`0007` recorded): it applied `0008`, `0009` and `0010`, `--expect-0009` returned READY, and a second run correctly reported nothing to apply.
- **Live payment service run** — 17 checks against the same database: partial payment leaves `700.00`, duplicate code (different case) refused, exact remainder marks Paid, overpayment refused without confirmation, confirmed overpayment stores `250.00` credit with a zero balance, invented code refused, receipt numbers unique.
- `npm test` — passed: 48 inpatient, 31 billing, 80 nursing, 216 reporting, 80 pharmacy batches, 81 payments, 552 migration.
- `npm run build` — passed (`✓ built in 559ms`); `npm run lint` reports only the pre-existing `src/lib/firebase.ts` error.

**Not verified:** no browser check of the cashier screen was performed.

### 3.6 Insurance claims: draft, adjudicate, settle

Claims were previously free-typed: the screen prefilled a random claim number, a made-up policy number (`SHA-KEN-2026-9921`), a made-up pre-authorisation code (`AUTH-SHA-782109`) and a fixed amount, then reported *"E-Claim submitted to SHA portal"* while contacting nothing. It also printed "API Integration Ready" and "DHA Electronic Remittance Ready". A status dropdown let anyone mark a claim `Settled` without any money moving, so the invoice balance stayed wrong.

**No live SHA connection exists, and this feature does not pretend otherwise.** There is no public SHA claims API with documented credentials to build against, and a facility cannot submit claims without SHA accreditation and onboarding. The screen now says so in a banner, and the module contains no external URL of any kind.

What it does:

- **Draft from real lines.** Pick an invoice, and the screen loads its actual charges with checkboxes. Everything is selected by default; the clerk can untick what the payer will not cover. The claim amount is computed from the selection and capped at what the patient still owes — a claim can never exceed the outstanding balance.
- **Lines are snapshotted.** `insurance_claim_items` stores the description and amount as they were at claim time, because invoices get edited afterwards and a claim must still say what it asked for.
- **One open claim per invoice** (`Draft`, `Submitted`, `Approved`), enforced under an invoice row lock so two clerks cannot both draft against the same balance. A partial unique index was deliberately *not* used: it would fail to apply on a database that already holds two open claims.
- **A real state machine.** `Draft → Submitted → Approved|Rejected → Settled`, enforced on the server. Only a submitted claim can be adjudicated; an approved amount cannot exceed the claimed amount.
- **Settlement moves money.** `Settled` is reachable only through `settleClaimScoped`, which writes a `billing_payments` row (method `SHA`, transaction code = claim number) and updates the invoice balance in the same transaction. If a payer approves more than is still owed, only the owed amount is posted and the remainder is reported — turning the difference into patient credit would be inventing money.
- **Claim numbers come from a sequence** (`CLM-YYYYMMDD-000123`), not from `Math.random()` in the browser.

**Permissions.** Mutations keep the gates that already existed: `insurance.claims.create` to draft and submit, `insurance.claims.manage` to adjudicate and settle. The read endpoints were deliberately left on the module gate alone. No role in `STAFF_ROLE_CATALOGUE` currently holds any `insurance.*` permission, so adding `insurance.read` to the claim list would have taken the screen away from clerks who can open it today. Tighten it once roles are granted the code.

**Migration:** `0011_insurance_claims_workflow` adds `insurance_claim_items`, `insurance_claims.settled_payment_id`, `settled_at`, `created_by_user_id`, an invoice/status index and `insurance_claim_number_seq`. Every statement is guarded.

**Validation completed:**

- `npm run test:claims` — passed, 87 assertions. Half of them are honesty checks: the fabricated policy number, pre-auth code, hardcoded amount, `Math.random()` claim numbers and every "integration ready" phrase must stay absent, and the screen must state that it does not transmit claims. It also asserts that exactly one place in the service writes `Settled`, and that a settlement is capped at the balance.
- **Live PostgreSQL 16 run** — 26 checks against the real service: three claimable lines, draft for one selected line, policy number inherited from the invoice, server-issued claim number, second open claim refused, adjudicating a draft refused, approval above the claim refused, approval recorded, settlement posting `1800.00` with the invoice moving to `3200.00` outstanding and `Partially Paid`, cannot settle twice, and the claim line snapshot preserved.
- `npm test` — passed: 48 inpatient, 31 billing, 80 nursing, 216 reporting, 80 pharmacy batches, 82 payments, 87 claims, 559 migration.
- `npm run build` — passed (`✓ built in 583ms`); `npm run lint` reports only the pre-existing `src/lib/firebase.ts` error.

**Not verified:** the claims screens were not opened in a browser. The legacy `PUT /api/claims/:id/status` endpoint was kept for compatibility and now delegates to the state machine, but it has not been exercised from an old client.

### 3.7 DHA / AfyaConnect: a document-verified client, an honest readiness report, and service-area mapping

**What was verified, and where.** Every endpoint, header, enum and query parameter in this build was read from the published reference rather than assumed:

- `https://hie-docs.dha.go.ke/auth/authentication` — OAuth 2.0 client credentials, `POST /tenants/token`, `{ client_id, client_secret }` in, `{ access_token, expires_in, token_type }` out.
- `https://hie-docs.dha.go.ke/eclaims/eligibility` — `GET /patients/eligibility`, `/patients/benefits`, `/patients/benefits/interventions`, `/patients/benefits/utilization`, `/patients/sub-benefits`, `/patients/pomsf-balances`, and the seven-value identification-type enum.
- `https://hie-docs.dha.go.ke/eclaims/authorizations` and `/eclaims/start-visit-consent` — consent and visit contracts, captured but **not** wired (see below).
- `https://hie-docs.dha.go.ke/docs/scenarios/overview` — the decision matrix: `accessPoint` (IP/OP), `paymentMechanism` (PER_DIEM/FEE_FOR_SERVICE), `fund` (SHIF/UHC/ECCIF), `needsPreauth`, and the ECCIF emergency window.

The documented UAT base is `https://ilm-dev.dha.go.ke/uat-middleware/api/v1`. DHA publishes **no** production base URL. Every business call sends `X-Facility-Id` (the Facility Registry code) and `X-Facility-Id-Type: fr-code`.

**Three modes, and production is off.**

| `DHA_MODE` | What happens | Credentials needed |
|---|---|---|
| `mock` (default) | Deterministic local fixtures. Nothing leaves the process. Every response is marked `simulated: true` and the screen prints `SIMULATED — not a SHIF decision`. | none |
| `sandbox` | Real HTTPS calls to the documented UAT gateway. | `DHA_CLIENT_ID`, `DHA_CLIENT_SECRET`, `DHA_FACILITY_CODE` |
| `production` | Refuses to run unless `DHA_ALLOW_PRODUCTION=true` **and** an `https` `DHA_BASE_URL` is supplied. Both are absent by default. | all of the above |

Mock fixtures are keyed on the identifier so a demo is reproducible: `11111111` returns a deceased beneficiary, `22222222` returns no schemes, anything else returns an eligible member with `POMSF-047` and `SHIF`. A ceremony is not a verification, and the label says which one you are looking at.

**Two rules from the documentation are enforced in code.**

- **POMSF is matched as a prefix.** Scheme names arrive suffixed (`POMSF-047`); exact equality would report a civil servant as uncovered. `TSC` and `USALAMA` are recognised the same way.
- **`isAlive: false` blocks everything.** The verdict is `deceased`, eligibility is false regardless of schemes, the patient row is marked `DECEASED`, and no downstream call is made.

**Identifiers never leave in clear.** The Client Registry id, national ID and every identification override are masked to their last four characters before they reach a log, an audit row, a response or the screen. `dha_api_calls` stores no request body and no patient identifier — only the operation, the path, the status, the duration and the outcome. No secret, token or payload is logged anywhere in the integration.

**Readiness is reported as fact, not aspiration.** `GET /api/integrations/dha/readiness` returns the mode, each configuration check with `READY`/`WARNING`/`BLOCKED`, the blockers in plain language, and every operation this build knows about — implemented or not. The screen renders that report directly; it no longer shows the previous hard-coded list of eight "Compliant" items, because nothing here is certified, approved or connected to production.

**Not implemented, and why:**

- `consent.authorize` — an OTP must reach the patient and biometrics need a registered device. This build has neither, so wiring the call would produce a screen that cannot work.
- `claim.startVisit` — consumes a consent token; without consent capture it cannot run end to end.
- Claim line items, diagnoses, preauthorisation and remittance — the contracts were not captured from the published reference. They are named as missing rather than invented.

**Service-area mapping, without inventing a single code.** DHA adjudicates claim lines against **intervention codes**, which belong to DHA and arrive per beneficiary. This HMIS bills against its own tariff catalogue. `dha.service-areas.ts` defines the eight areas (outpatient, inpatient, laboratory, pharmacy, imaging, theatre, maternity, emergency) and resolves each billable line from its provenance (`billing_items.source_type`) to an area, then to the documented attributes for that area. The intervention code itself is **configuration**: an administrator copies it from the DHA portal into `dha_service_mappings`, one row per facility per area. `GET /api/integrations/dha/invoices/:id/interventions` groups an invoice's lines by area and returns any line whose area has no code as `unmapped` — it refuses to fabricate, and it refuses to silently drop the line.

**Migration:** `0012_dha_integration_audit` adds `dha_api_calls` and four `patients` columns (`dha_client_registry_id`, `dha_eligibility_status`, `dha_eligibility_checked_at`, `dha_eligibility_schemes`). `0013_dha_service_mappings` adds the mapping table with a unique index on `(facility_id, service_area)` so a line can never resolve to two codes. Both are additive and guarded with `IF NOT EXISTS`; neither touches existing rows.

**Validation completed:**

- `npm run test:dha` — passed, 176 assertions. These are mostly honesty checks: the secret never appears in the readiness output or any log statement, production refuses without the opt-in, a disabled client never reaches the network, tokens are cached, the documented paths and identification enum are exact, a mock result is marked simulated, an operation without a fixture throws rather than inventing one, `statusDesc`/`POMSF` semantics hold, all eight service areas carry only documented enum values and no code field, and the four DHA routes are registered behind the module gate.
- `npm test` — passed, 1,379 assertions across nine suites (48 inpatient, 31 billing, 80 nursing, 216 reporting, 80 pharmacy batches, 84 payments, 91 claims, 176 DHA, 573 migrations).
- `npm run build` — passed (`✓ built in 545ms`); `npm run lint` reports only the pre-existing `src/lib/firebase.ts` `TS2307`.

**Not verified, and cannot be from here:** no call has been made to the real DHA gateway, because no credentials exist until the application is approved. The sandbox path is exercised only against a stubbed `fetch` that asserts the token exchange, the `Authorization` header, the facility headers and the URL construction. The DHA screen was not opened in a browser.

**Blocked on DHA approval:** client credentials, the Facility Registry code, the enabled API products, and the production base URL. Until those arrive the integration runs in `mock` only, and the readiness report says exactly that.

### 3.8 Professional verification before a staff invitation

**The rule.** A clinical invitation cannot be issued until the applicant's professional registration has been checked. Selecting `DOCTOR`, `CLINICAL_OFFICER`, `NURSE` or `PHARMACIST` in the invite form opens a verification panel; the "Create invitation link" button stays disabled until a usable result exists.

**What was verified against the documentation**

- `https://hie-docs.dha.go.ke/registries/health-worker-registry` — `GET /professionals`, with `identification_number` (required), `identification_type` (`registration_number` | `National ID` | `Alien ID` | `Refugee ID`) and `regulator` (`KMPDC` | `COC` | `NCK` | `PPB`). The 200 response is documented as `{ message: object }`.
- `https://hie-docs.dha.go.ke/docs/registries/process/professionalSearch` — workflow, identifier types and the three expected outcomes (found, not found, input error). This page also mentions a `license_number` identifier type that the endpoint enum does **not** list; the endpoint wins, so it is not offered.
- `https://hie-docs.dha.go.ke/docs/goLive` — production access: Development/Testing → UAT demo → DHA Certification → production credentials. Nothing here is certified, so nothing here points at production.
- `https://afyalink.dha.go.ke/practitioner-search-api-docs` — **unreachable** on 21 Oct 2026. No contract was taken from it, and nothing was invented to fill the gap.

**Regulators genuinely supported**

| Role | Regulator | Automated |
|---|---|---|
| `DOCTOR` | KMPDC | yes |
| `CLINICAL_OFFICER` | COC (Clinical Officers Council) | yes |
| `NURSE` | NCK (Nursing Council of Kenya) | yes |
| `PHARMACIST` | PPB (Pharmacy and Poisons Board) | yes |
| `LABORATORY_TECHNICIAN` | KMLTTB | **no** — not in the published enum; manual check only |

`CLINICAL_OFFICER` was added to `STAFF_ROLE_CATALOGUE`, so newly created tenants get it. Existing tenants need the role created before it can be selected.

**Registration is not a licence.** The two are separate columns and separate statuses:

- `REGISTRATION_VERIFIED` — the register contains this person and the registration is live.
- `LICENCE_CONFIRMED` — an explicit licence status said "active" and no expiry date contradicts it.
- `LICENCE_EXPIRED`, `REGISTRATION_INACTIVE` — the register said so; both block an invitation.
- `IDENTITY_MISMATCH` — the returned name shares no token with the name entered. Blocks, and requires human resolution.
- `RECORD_NOT_FOUND` — the registry returned nothing. Blocks, offers a manual check.
- `SERVICE_UNAVAILABLE` — the call failed. **This is not a failed credential check**, and it does not overwrite a credential that was verified earlier.
- `MANUAL_REVIEW_REQUIRED` — the response could not be interpreted. Blocks, requires human resolution.
- `MANUALLY_VERIFIED` — an administrator checked the regulator's own register; source and date are recorded.

**The response mapping is provisional, and says so.** The published reference renders the response body as `message: object` and DHA publishes no machine-readable OpenAPI document at a discoverable path. Rather than invent keys, `practitioner.normalise.ts` reads a declared, ordered list of candidate keys, records which ones matched, lists unrecognised keys (names only, never values) and sends anything it cannot interpret to `MANUAL_REVIEW_REQUIRED`. Every result carries `mapping: 'provisional'`, which the screen displays. Correct the key list once against the first real sandbox record; nothing else needs to change.

**Mock mode cannot appoint anyone.** Fixtures are deterministic and labelled `SIMULATED` in the result and on screen. A credential recorded in mock mode is refused at the invitation gate (`409 SIMULATED_VERIFICATION`), so a demo cannot become an employment decision.

**Data minimisation.** No national ID, date of birth or contact details are stored, and no response body is retained. The credential row keeps the registration number, the returned statuses, the licence expiry, the matched key names and the warnings. `professional_verification_events` is append-only and records every attempt, including the failures.

**Separation of concerns.** Credential status is independent of employment, role assignment and clinical privileges. A verified registration grants nothing; it only satisfies the pre-invitation check.

**Migration:** `0014_professional_verification` adds `staff_professional_credentials` and `professional_verification_events` with four indexes, all guarded. **Run `npm run db:migrate` before using the new invitation flow** — without it, a clinical invitation fails on a missing relation.

**Validation completed:**

- `npm run test:verification` — 100 assertions: regulator and role mapping, every status branch, `dd/mm/yyyy` parsing, nested envelopes, multiple-match handling, unrecognised shapes, mock determinism, the outage-preserves-status rule, the mock-cannot-invite rule, and that migration 0014 contains no `DROP`, `TRUNCATE` or `DELETE`.
- `npm test` — 1,489 assertions across ten suites. `npm run build` — passed (`✓ built in 621ms`). `npm run lint` — only the pre-existing `firebase.ts` error.

**Not verified:** no request has been made to the real Health Worker Registry (no credentials), and the screens were not opened in a browser. The response key mapping is unconfirmed until the first sandbox call.

## 4. Existing backups and modified files to preserve

### Backups created during the latest session

- `src/app.ts.backup-permissions-20261020-121641`
- `src/auth/staff-role-catalogue.ts.backup-permissions-20261020-121641`

### Earlier uncommitted changes and backups

- `src/components/PatientJourneyModal.tsx`
- `src/components/modules/OutpatientModule.tsx`
- `src/components/PatientJourneyModal.tsx.backup-lab-results-20261019-200101`
- `src/components/modules/OutpatientModule.tsx.backup-custom-diagnosis-20261019-195003`
- `src/components/modules/OutpatientModule.tsx.backup-eof-cleanup-20261019-200416`

Previously reported backups to preserve:

- `src/app.ts.analytics-backup-20261019-111633`
- `src/app.ts.analytics-backup-20261019-112507`
- `backups/jalicaredb-before-patient-guardian-20261019.dump`
- `backups/jalicaredb-backup-verification.txt`
- Patient-registration, database-schema and type-definition backups created during the October 19 changes.

Do not delete, reset or overwrite existing work to simplify the patch. Do not commit local backups or database dumps unless explicitly intended.

## 5. Important outstanding issue: tenant and facility scope

The latest inspection confirmed that `src/auth/auth.middleware.ts` defines `AuthRequest` with:

- `user?: AuthenticatedUser`
- `authContext?: AuthorizationContext`
- session information

`requireAuth` loads the authorization context and attaches the authenticated user. The inspected output did not include the remaining lines showing whether `req.authContext` is actually assigned, so this must be confirmed from the existing implementation before wiring scoped operations.

Existing scope helpers are available in `src/db/queries.ts`, including:

- `requirePatientInTenant`
- `getFacilityByIdScoped`
- `resolveFacilityScope`
- `getEncountersScoped`
- `createEncounterScoped`
- `updateEncounterScoped`

The clinical and laboratory query functions currently include generic operations that may trust client-supplied filters or IDs. Examples include:

- `getObservations`, `recordObservation`
- `getDiagnoses`, `recordDiagnosis`
- `getProcedures`, `recordProcedure`
- `getLabOrders`, `createLabOrder`
- `updateLabOrderStatus`
- `getLabResults`, `addLabResult`

Some of these functions can return records without a facility filter, and certain writes update by record ID alone. Do not assume the new route permissions solve these data-isolation problems.

**Required security rule:** Authorisation and data scope must both be enforced. Resolve the authenticated user's permitted tenant/facility scope from trusted server-side context, validate the actual database relationships, and reject cross-scope reads and writes. Never rely on a client-provided `facilityId` as proof of access.

For clinical observations, diagnoses and procedures, validate the encounter's tenant/facility and ensure the supplied patient ID matches that encounter. Do not incorrectly require a patient's registration facility to equal the facility where the patient is receiving care.

For laboratory results, validate access through the parent order and its patient, tenant and facility relationships.

## 6. Laboratory workflow concern

The current `addLabResult` implementation inserts a result and then immediately updates the corresponding laboratory order to `Published`. This does not safely separate result entry from result verification/publication.

The existing schema also has `labResults.verifiedAt` as a non-null field with a default timestamp. This makes it unsuitable for accurately representing an unverified result without revisiting the data model.

Required workflow:

1. Clinician orders an investigation.
2. Laboratory staff receive the order and collect/process the sample.
3. Authorised laboratory staff enter the result.
4. An authorised verifier reviews and verifies the result, where required by facility policy.
5. The result is published and made available to the clinician.
6. The clinician reviews the result and records the appropriate follow-up.

**Outstanding:** Inspect the existing lab-result schema and UI, then implement the smallest safe distinction between result entry and verification/publication. Determine whether a migration is needed. If required, create and review a minimal migration and take a verified backup first. Never reset the database or silently treat an entered result as verified.

The existing laboratory facility-module middleware must remain in place. Do not remove it to make the routes work.

## 7. Current milestone: Step 6 — OPD, triage and consultations

Continue Step 6 without restarting completed foundation or patient-registration work.

### Required implementation objectives

1. **Patient arrival and queue**
   - Confirm how registered and returning patients enter OPD.
   - Ensure queue entries are facility-scoped.
   - Review status transitions and duplicate-entry behaviour.

2. **Triage**
   - Capture supported observations, vital signs, presenting complaint, triage category, timestamp and responsible staff.
   - Identify and prioritise urgent cases using the existing clinical design.
   - Do not invent values or substitute arbitrary defaults for missing observations.

3. **Consultation**
   - Link consultation data to the correct encounter, patient and care facility.
   - Reuse existing diagnosis, procedure, medication, laboratory and referral structures.
   - Avoid creating duplicate data models or redundant screens.

4. **Workflow transitions**
   - Validate movement from queue to triage, consultation and subsequent services.
   - Preserve the existing business rules for cancellation, completion and re-entry.

5. **Permissions and scope**
   - Enforce action permissions on reads and writes.
   - Complete endpoint-level tenant/facility isolation for the clinical and laboratory paths already identified.
   - Test the effective permissions of doctors, triage/reception staff and laboratory staff, including existing facility overrides.

6. **User interface**
   - Preserve the established layout, components and API client.
   - Fix confirmed OPD workflow defects rather than performing repeated general inspections.

7. **Verification**
   - Run `npx tsc --noEmit`, `npm run build` and `git diff --check`.
   - Perform focused runtime checks for the changed workflow and permissions.
   - Record implementation evidence, runtime test results and remaining limitations separately.

## 8. Immediate next action

**Continue with one bounded implementation task: finish tenant/facility scoping for clinical records and laboratory orders/results.**

Use the existing scope helpers and the authenticated request context. Make targeted, assertion-checked PowerShell edits with timestamped backups. Keep the change focused on these clinical and laboratory paths; do not broaden the task into unrelated modules.

Then:

1. Validate cross-facility and cross-tenant access is rejected.
2. Verify a doctor can read and order laboratory investigations but cannot enter or verify results without the required permission.
3. Separate laboratory result entry from verification/publication.
4. Run TypeScript, build and whitespace checks.
5. Record the exact checks performed and their outcomes.
6. Return to the OPD/triage workflow and finish Step 6 before advancing to Step 7.

If a required source detail is missing, request only the smallest relevant code excerpt. Do not repeatedly request broad inspections, revisit already-completed milestones without a concrete defect, or report unimplemented security work as finished.

## 9. Critical development rules

- Preserve all patient data, database contents, migrations, current changes and backups.
- Never reset, drop or truncate the database as a shortcut.
- Do not use `db:clean`, destructive schema operations or unreviewed database pushes.
- Inspect only what is needed for the next implementation task.
- Use exact PowerShell scripts with precondition checks and safe backups.
- Test runtime behaviour, not only compilation.
- Never invent patient or clinical records to populate dashboards.
- Do not claim Kenyan regulatory or DHA compliance without evidence and assessment.
- At the end of each work session, provide a concise progress report, validation evidence, outstanding risks and the exact next action.
- **Be objective: finish a bounded task, validate it, and move forward instead of looping through repeated audits.**





We can make meaningful progress today, but we need to be disciplined: prioritize a reliable, demonstrable end-to-end hospital workflow first, then close the most important gaps, and present unfinished capabilities honestly. We should not attempt to rewrite the entire HMIS in one day.

For JaliCare, I recommend working in your existing branch, preserving the database and migrations, and using PowerShell for guarded edits. We will work in short cycles: inspect → patch → type-check → build → test the actual workflow.
Today's delivery plan

Phase 1 — Stabilize patient records and visits
First priority
Patient search and registration, existing history, explicit encounter creation, no fake vital signs, correct facility scope, and no duplicate patients.




Phase 2 — Complete the core clinical journey

Reception → triage → consultation → diagnosis → lab orders/results → prescriptions/dispensing → billing → follow-up or discharge.




Phase 3 — Verify security and data integrity

Role permissions, tenant/facility isolation, input validation, audit logs, error handling, and safe handling of clinical records.




Phase 4 — Prepare the presentation

Build verification, clean demo data, a rehearsed patient journey, a list of completed features, and a transparent list of remaining work.



The patient portal is part of the target architecture, but if it is not already implemented, we should not rush an insecure portal into production just to meet today's presentation. We can demonstrate the existing patient record and present the portal as a clearly scoped next deliverable.












# JaliCare Kenya HMIS — Project Status Update
**Date:** 20 October 2026  
**Client:** PUCHE — Level 3B healthcare facility  
**Repository:** `fetronix/afyahub-hmis-kenya`  
**Branch:** `restructure/phase-2-foundation`  
**Current milestone:** Step 6 — OPD, triage and consultations

> **Historical snapshot — 20 October 2026.**
> Everything below this line was written before the billing, inpatient, reporting,
> DHA and professional-verification work. Where it disagrees with §2, §3.7, §3.8
> or §10, those sections are current. Two claims here are now out of date and are
> corrected above: laboratory result entry/verification **is** separated, and
> `req.authContext` **is** assigned in `src/auth/auth.middleware.ts:144`.

## 1. Completed work

### Foundation and authentication
- Refactored the server entry point and application structure.
- Introduced environment and database configuration.
- Fixed initial-login session hydration so roles and modules load without requiring a browser refresh.
- Implemented the analytics summary endpoint with facility-scoped queries and `reports.read` permission enforcement.

### Patient registration and records
- Added support for optional patient phone, national ID and personal SHA number.
- Added DOB-based age calculation, unknown or untested blood group support, and separate guardian details for minors.
- Generated and applied the patient schema migration for nullable phone and guardian fields.
- Added facility-access validation and server-assigned tenant/facility scope to patient creation.
- Restricted patient updates using tenant and registration-facility scope.
- Created and verified a database backup before the patient migration.

### Latest permissions changes — 20 October
- Added action permission middleware to appointment, observation, diagnosis, procedure and laboratory API routes.
- Added `laboratory.read` and `laboratory.orders.create` to the default doctor role catalogue.
- Did not grant doctors laboratory result-entry or result-verification permissions.
- Preserved the existing laboratory facility-module middleware.

### Validation evidence
Following the latest permissions changes:
- `npx tsc --noEmit` — passed.
- `npm run build` — passed.
- `git diff --check` — no whitespace errors; Windows line-ending warnings may appear.

**Interpretation:** These checks confirm compilation and bundling. They do not establish that all permissions, workflows or tenant/facility boundaries have passed runtime testing.

## 2. Outstanding risks and unverified areas

### High priority — Tenant and facility isolation
- Some clinical and laboratory query functions still use generic reads or writes.
- Certain operations may rely on client-provided IDs or filters without validating the associated encounter, patient, tenant and facility.
- Route-level permission middleware alone does not prevent cross-facility data access.
- The authenticated request's `authContext` property is declared, but its assignment in the complete middleware flow still needs confirmation.

**Required outcome:** Every affected read and write must enforce the authenticated user's actual scope using trusted server-side context and database relationships.

### High priority — Laboratory result lifecycle
- `addLabResult` currently marks an order `Published` immediately after inserting a result.
- `verifiedAt` is non-null and defaults to the current timestamp, complicating the distinction between entered and verified results.
- A safe verification/publication workflow has not yet been implemented or verified.
- A minimal schema migration may be necessary; this must be decided after inspecting the current schema and UI.

### Permissions
- The doctor default role catalogue has been updated, but effective permissions for existing database role assignments and facility-specific overrides remain unverified.
- Runtime tests have not yet demonstrated that doctors can order tests while unauthorised users are prevented from entering or verifying results.
- Permission checks and data-scope checks must both pass.

### OPD and triage
- The overall Step 6 workflow remains in progress.
- End-to-end behaviour across queue, triage, consultation, diagnosis, laboratory orders and follow-up has not yet been fully verified.
- Do not assume that every workflow is missing; inspect only the specific path needed for the next implementation.

### Build performance
- Vite reports a JavaScript bundle larger than 500 kB.
- This is a performance optimisation concern, not a build failure.

### Production readiness
- Comprehensive security testing, regression testing, client acceptance and production deployment remain outstanding.
- No claim of full DHA or regulatory compliance has been established by these changes.

## 3. Work preservation

Preserve all existing uncommitted source changes and backups, including:

- `src/app.ts.backup-permissions-20261020-121641`
- `src/auth/staff-role-catalogue.ts.backup-permissions-20261020-121641`
- Existing analytics and patient-registration backups.
- Existing changes to `src/components/PatientJourneyModal.tsx` and `src/components/modules/OutpatientModule.tsx`, along with their backups.
- `backups/jalicaredb-before-patient-guardian-20261019.dump`
- `backups/jalicaredb-backup-verification.txt`

Do not reset the branch, delete backups, drop tables, truncate data or run destructive database-cleaning commands.

## 4. Next actions — in priority order

1. **Finish clinical and laboratory scope enforcement.** Validate authenticated context, resolve the permitted facility, and scope observations, diagnoses, procedures, laboratory orders, status updates and results.
2. **Separate laboratory result entry from verification and publication.** Implement the smallest safe change and migration, if required.
3. **Verify effective permissions.** Test doctor, triage/reception and laboratory staff access, including existing facility overrides.
4. **Finish Step 6.** Validate the queue → triage → consultation → investigation/follow-up workflow.
5. **Run focused checks.** Execute TypeScript, production build, whitespace checks and runtime tests for the changed paths.
6. **Update the tracker with evidence.** Mark individual tasks Verified only when their relevant checks pass, then advance to Step 7.

## 5. Current status summary

| Area | Status |
|---|---|
| Foundation implementation | Completed; prior checks reported |
| Authentication/session hydration | Fix implemented; previously reported working |
| Patient registration changes | Implemented; prior build and type checks passed |
| Analytics summary endpoint | Implemented; prior build and type checks passed |
| Latest API permission middleware | Implemented; type check and build passed |
| Tenant/facility scope for affected clinical and lab queries | Outstanding |
| Laboratory verification/publication workflow | Outstanding |
| End-to-end OPD/triage verification | In progress |
| Comprehensive security and regression testing | Not started |
| Production deployment and handover | Not started |

**Immediate focus:** Complete and validate tenant/facility scope enforcement for clinical and laboratory operations, then finish the OPD/triage workflow. Avoid reopening completed work unless a specific defect is demonstrated.

## 10. Migrations and full sync

This is the end-to-end procedure for bringing a checkout and its database to the
same state as the branch. It is written for the Windows/PowerShell development
machine described in §1, and the same commands work on Linux.

### 10.1 What is pending, and what each migration does

Migrations 0000–0011 are applied on the development database. Three are not:

| Migration | What it adds | Touches existing data |
|---|---|---|
| `0012_dha_integration_audit` | `dha_api_calls` table, plus four `patients` columns for DHA eligibility | No — additive columns only |
| `0013_dha_service_mappings` | `dha_service_mappings` table and its unique index | No |
| `0014_professional_verification` | `staff_professional_credentials`, `professional_verification_events`, four indexes | No |

Every statement in all three is guarded with `IF NOT EXISTS`. None contains
`DROP`, `TRUNCATE` or `DELETE`. Re-running them is harmless.

### 10.2 Take a backup first

`0012` adds columns to `patients`. The migration does not rewrite rows, but a dump
costs a minute and a mistake costs the clinic's records.

```powershell
New-Item -ItemType Directory -Force backups | Out-Null

& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" `
  -h localhost -p 5432 -U postgres -Fc `
  -f "backups\jalicaredb-before-0014-$(Get-Date -Format yyyyMMdd-HHmmss).dump" `
  jalicaredb
```

If `pg_dump` is not at that path, `Get-ChildItem "C:\Program Files\PostgreSQL" -Recurse -Filter pg_dump.exe` will find it.

### 10.3 The commands

```powershell
git pull
npm install

npm run db:status              # what the database still owes
npm run db:migrate -- --dry-run   # the plan, executes nothing
npm run db:migrate             # apply
npm run db:status:all          # verify every structure exists
```

`npm run db:migrate` runs `scripts/migrate.ts`, not `drizzle-kit`. That is
deliberate — see 10.5.

After a successful migration, grant the permissions that were added since the
last seed, then restart the server:

```powershell
npm run db:grant-inpatient-permissions
npm run dev
```

### 10.4 Reading the output

`db:status` prints each journal entry as applied (`✓`) or `PENDING`, then checks
that the tables, columns, indexes and the invoice-number sequence that 0009
creates actually exist. It exits `0` only when everything it checks is present, so
it can gate a deploy.

Expected result after migrating: **15 migrations recorded, 0 pending, every line
`✓`**, and `db:status:all` reporting `READY`.

### 10.5 Why not `drizzle-kit migrate`

`npm run db:migrate:drizzle` is plain `drizzle-kit migrate`. It renders a spinner
and calls `process.exit()` from inside its own error handler, so when a migration
fails the Postgres error is never printed. On Windows the spinner is often not
even visible: the command appears to do nothing and returns to the prompt, while
`db:status` still says `PENDING`. That is the exact symptom that produced
`scripts/migrate.ts`.

The alternative is safe to keep for reference but should not be the one you rely
on:

```powershell
npm run db:migrate:drizzle   # swallows errors — avoid
```

`scripts/migrate.ts` applies the same journal entries and writes the same
tracking rows, but prints the plan first, names the migration and statement that
failed with the Postgres code, detail and hint, and matches on the migration hash
so a tracking table that has drifted ahead of the journal cannot make it skip
work silently.

### 10.6 When it fails

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot reach the database (ECONNREFUSED)` | Postgres not running, or wrong port | Start the service; confirm `SQL_HOST`/`SQL_PORT` in `.env` |
| `password authentication failed` | Wrong `SQL_ADMIN_PASSWORD` | Correct `.env`; the value is never printed by the scripts |
| `Missing required environment variable: SQL_HOST` | No `.env`, or the file is not in the repo root | Copy `.env.example` to `.env` and fill it in |
| `relation "..." does not exist` during 0012–0014 | An earlier migration was recorded but not applied (a half-run from `drizzle-kit`) | Re-run `npm run db:migrate`; the runner matches on hash and re-applies |
| Command prints nothing and returns | You ran `db:migrate:drizzle` | Use `npm run db:migrate` |
| BOM warning | A `.sql` file starts with a UTF-8 BOM | The runner strips it and says so; no action needed |

Never run `npm run db:clean`. It exists for disposable databases only and will
remove data.

### 10.7 Verifying the application afterwards

```powershell
npm test                       # 1,489 assertions across ten suites
npm run build
npm run lint                   # one pre-existing Firebase TS2307 is expected
```

Then open the app and confirm three screens that depend on the new tables:
**Interoperability** (readiness report loads), **Configuration → Staff
Invitations** (selecting a clinical role offers *Verify registration*), and
**Billing** (invoices still list).

### 10.8 Full sync from a clean clone

```powershell
git clone https://github.com/fetronix/afyahub-hmis-kenya.git
cd afyahub-hmis-kenya
git checkout restructure/phase-2-foundation
npm install
Copy-Item .env.example .env      # then fill in the SQL_* values
npm run db:migrate
npm run db:seed                  # only on an empty database
npm run dev
```

`db:seed` refuses to run against a database that already has tenants; it never
truncates or overwrites. If you are restoring an existing clinic database, skip
it entirely and restore the dump instead.
