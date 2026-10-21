# JaliCare Kenya HMIS — Updated Project Handover
**Last updated:** 21 October 2026  
**Client:** PUCHE — Level 3B healthcare facility  
**Current milestone:** Step 6 — OPD, triage and consultations  
**Overall status:** In progress

> **Bring the database up to date first.** Run `npm run db:status` — it prints what
> is recorded and what is pending against the database in `.env`. If anything is
> pending, every command, and what to do when one fails, is in
> **[§10 Migrations and full sync](#10-migrations-and-full-sync)**.

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
3. **Multi-tenant and facility security — In progress.** Most queries are scoped through `resolveFacilityScope` and `getFacilityByIdScoped`. The clinical paths named in §5 — observations, diagnoses and procedures — now resolve the encounter before reading or writing and refuse a request that names neither an encounter nor a patient; the laboratory routes pass `authContext` into `resolveFacilityScope`. The unscoped functions still exist in `queries.ts`, but no route calls them and `test:security` fails if one starts to. This is not a clean bill of health: the remaining query functions have not been audited one by one.
4. **PUCHE facility overview — Completed**
5. **Patient registration and records — Completed**
6. **OPD, triage and consultations — In progress; current priority.** Queue and triage exist; the queue → triage → consultation → investigation → follow-up path has not been walked end to end.
7. **Inpatient, wards, beds and theatre — Implemented.** Ward and bed set-up (create, rename, retire, delete), admission board with an empty state that leads to the first ward, transfers, discharge authorisation and theatre cases. Covered by 97 assertions in `test:inpatient`. No user acceptance.
8. **Maternity, MCH and preventive services — Implemented.** Antenatal booking and visits, labour with a partograph, delivery with one row per baby, postnatal contacts and the childhood immunisation register, on eight tables (§3.11 and §3.12). The partograph is drawn as a chart from the stored readings, with the alert and action lines computed by the same function the table uses. A delivery raises an invoice line only through a real `facility_service_tariffs` price; with none configured the screen says **recorded, not billed** rather than inventing a figure. 131 + 151 assertions. No user acceptance.
9. **Laboratory and radiology — Implemented.** Result entry and verification are separate: `addLabResult` writes `Pending Verification` with `verifiedBy`/`verifiedAt` null, and `POST /api/lab-results/:id/verify` is gated on `laboratory.results.verify`. The schema column is nullable since migration 0008.
10. **Pharmacy, inventory and procurement — In progress.** Batch tracking, expiry control and FEFO dispensing implemented (80 assertions). Procurement screens exist; no test coverage.
11. **Tariffs, billing, payments and insurance — Implemented.** Billing spine, mobile money settlement with overpayment handling, and the claims workflow (draft → submit → adjudicate → settle). 31 + 85 + 93 assertions.
12. **Reports, analytics and public-health reporting — Implemented.** Analytics summary and the reporting dashboard (216 assertions).
13. **Interoperability and integrations — Implemented to the published contract.** DHA/AfyaConnect client, readiness report, member eligibility, coverage and service-area mapping. Professional registration verification against the Health Worker Registry (§3.8). **No live credential exists, so nothing has been exercised against DHA.** 176 + 100 assertions.
14. **Security, regression and user acceptance testing — In progress.** HTTP hardening is implemented and was exercised against a running server (§3.9): security headers, an origin allowlist, and per-IP rate limits on sign-in and the API. Still absent: independent review or penetration testing, a load test, a restore drill, monitoring and alerting, and any user acceptance.
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

### 3.9 HTTP hardening, and the clinical paths closed in §5

**Why now.** The API sent no security headers, had no CORS policy at all, and placed no limit on sign-in attempts. None of that requires a database migration or a design decision, and all three are things a reviewer would flag on the first afternoon.

**What is mounted, and in what order.** In `src/app.ts`, before the body is parsed:

1. `app.disable('x-powered-by')` — the framework is not advertised.
2. `helmet()` — `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin`, COOP/CORP, and, **in production only**, a content security policy (`frame-ancestors 'none'`, no inline script) and HSTS (`max-age=15552000; includeSubDomains`). The CSP is off in development because Vite's HMR injects inline scripts; a policy loose enough for HMR is not worth shipping.
3. `cors()` — an allowlist built from `APP_BASE_URL` plus any `CORS_ALLOWED_ORIGINS`, with the localhost dev origins added only when `NODE_ENV` is not `production`. A refused origin is answered **without** CORS headers rather than with an error, so the browser blocks the response and the server says nothing about which routes exist. There is no wildcard and no origin reflection.
4. `express-rate-limit` on `/api/auth` — 10 **failed** attempts per IP per 15 minutes. `skipSuccessfulRequests` is on: a busy reception desk that signs in correctly all day must not be locked out by its own success. Answers `429 RATE_LIMITED` with a plain message.
5. `express-rate-limit` on `/api` — 300 requests per minute per IP.
6. `express.json({ limit: '1mb' })` — the largest body this application receives is a claim or an invoice.

**Configuration.** `TRUST_PROXY=true` behind a reverse proxy (nginx, cPanel, Cloudflare); without it every request appears to come from the proxy and one client can exhaust the facility's budget. `CORS_ALLOWED_ORIGINS` takes a comma-separated list. Both are documented in `.env.example`.

**Exercised against a running server** (production mode, `APP_BASE_URL=https://hmis.example.co.ke`):

- Response headers included `Content-Security-Policy` with `frame-ancestors 'none'`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin`, and `RateLimit: limit=300, remaining=299, reset=60`. `X-Powered-By` was absent.
- `Origin: https://hmis.example.co.ke` → `Access-Control-Allow-Origin: https://hmis.example.co.ke`.
- `Origin: https://evil.example` → no `Access-Control-Allow-Origin` header at all.
- Twelve wrong-password sign-ins → `401` ten times, then `429` with `{"success":false,"error":"RATE_LIMITED", ...}`.

**What this does not do.** The limiter keeps its counters in process memory: they reset on restart and are not shared between processes, so a multi-process deployment needs a shared store. There is no CSRF token — the API authenticates with a bearer token rather than a cookie, and the origin allowlist is the control in place; that reasoning stops holding the day a cookie is introduced. There is still no penetration test, no load test and no monitoring.

**The clinical paths.** `GET/POST /api/diagnoses` and `GET/POST /api/procedures` were the three unscoped reads and writes listed in §5. They now call `getDiagnosesScoped`, `recordDiagnosisScoped`, `getProceduresScoped` and `recordProcedureScoped`, which:

- resolve the encounter once, through `loadEncounterInScope`, and reject an encounter that belongs to another tenant or facility with `ENCOUNTER_NOT_FOUND` — the same answer as an encounter that does not exist, so the response does not confirm that a record exists elsewhere;
- refuse a read that supplies neither `encounterId` nor `patientId` (`SCOPE_FILTER_REQUIRED`) instead of returning the table;
- reject a body whose patient does not match the encounter patient (`PATIENT_ENCOUNTER_MISMATCH`);
- for a patient-only read, accept a patient who is registered at the caller's facility **or** has been seen there. A patient's registration facility is not the facility where they are receiving care, and requiring the two to match would hide a genuine record.

The legacy `getDiagnoses`, `recordDiagnosis`, `getProcedures` and `recordProcedure` remain in `queries.ts` — other code may still reference them — but no route calls them.

**Validation completed:**

- `npm run test:security` — 54 assertions: the allowlist (exact match, scheme, look-alike domain, malformed config, localhost only outside production), the limits and their windows, `skipSuccessfulRequests`, the absence of any wildcard or reflection, mount order, the production-only CSP and HSTS, the four routes' use of the scoped functions, and the refusal of an unfiltered read.
- `npm test` — **1,543 assertions across eleven suites**, all passing.
- `npm run build` — passed (`✓ built in 595ms`; the bundle-size warning is pre-existing).
- `npm run lint` — only the pre-existing `src/lib/firebase.ts` missing-config error.

**Not verified:** no penetration test, no load test, and the screens were not walked in a browser after the change.

### 3.10 Role catalogue coverage, and a dashboard that says what it knows

**The hole.** `STAFF_ROLE_CATALOGUE` gained `CLINICAL_OFFICER` in 3.8, but roles are *tenant-scoped*: a tenant created before that change has no such role, the invitation form offers it, and nobody can be granted it. The same is true of `inpatient.admit` and `inpatient.discharge` added to `DOCTOR` and `NURSE` — the permission exists, the role predates it, and the new ward routes answer 403. A CLI script (`scripts/repair-tenant-staff-roles.ts`) covered tenants 7 and 8 and nothing else, and the editor showed only roles that already existed, so the gap was invisible from the screen.

**What the editor shows now.** `GET /api/platform/rbac/roles` returns a `catalogue` block alongside the roles: for each of the eight catalogue roles, whether the tenant has it, and which catalogue permissions it lacks. The panel at the top of *Super Admin → Facilities → Facility Role Permissions* then reads one of three ways:

- **All present** — a green line and nothing to do.
- **Missing roles** — an amber list of the roles this tenant does not have, with their descriptions and permission counts, and one button to create them.
- **Drift** — a separate list of existing roles that sit below the catalogue, naming the exact permission codes. Granting those is a second, explicit button.

**Why drift is not automatic.** A permission may have been removed from a role deliberately, and a provisioning step that tops up every role on every visit would keep undoing that decision. Creation is safe to do in bulk; re-granting is not.

**What the apply endpoint does.** `POST /api/platform/rbac/catalogue/apply` creates missing roles for the facility's tenant with their catalogue permissions and writes one audit entry. It is additive only: no delete, no update of an existing role, no touch of any facility override. If a catalogue permission code is not seeded in the database it refuses with `409 CATALOGUE_PERMISSIONS_MISSING` and names the codes, rather than creating a role that holds permissions no route checks. Roles belong to the tenant, so creating one from any facility makes it available in all of them.

**Bulk backfill.** `scripts/repair-tenant-staff-roles.ts` now takes `--tenant 12,15` or `--all` instead of the two hardcoded IDs, and is still a dry run unless `--apply` is passed:

```
npx tsx scripts/repair-tenant-staff-roles.ts --all          # report only
npx tsx scripts/repair-tenant-staff-roles.ts --all --apply  # write
```

It applies the same additive rule as the endpoint. Use the screen for one tenant you can see, the script for every tenant at once.

**Dashboard.** Two defects, one cosmetic and one not:

- `text-2xs` and `text-3xs` were used **359 times across 23 files** and had never been defined, so Tailwind emitted nothing and every one of those labels inherited its parent's size. They are now defined once in `src/index.css` under `@theme`.
- The KPI cards were four hand-written blocks with different numbers of rows, so their baselines drifted; hidden cards also left holes in a fixed four-column grid. They are now one `KpiCard` with a fixed label / value / footer shape, rendered from a filtered list, so the grid closes up when a permission hides a card. The second row drops to a single column when only one of its two panels is visible, instead of leaving two thirds empty.

**The figure that is not zero.** When a dashboard request fails, the cards now show an em dash and a warning banner, not `0`. A zero is a measurement; a failed request is the absence of one. `loading` also stopped being a dead variable — it drives a *Refreshing* chip in the header.

**Validation completed:**

- `npm run test:roles` — 13 assertions, now part of `npm test`: the catalogue has the eight expected roles, every permission code is well formed, and the provisioning route never deletes, never updates an existing role and tops up only on request.
- `npm test` — **1,556 assertions across twelve suites**, all passing.
- `npm run build` — passed (`✓ built in 620ms`).
- `npm run lint` — only the pre-existing `src/lib/firebase.ts` missing-config error.

**Not verified:** no browser walkthrough of the panel or the dashboard, and the provisioning endpoint has not been exercised against a database. The `staff-role-catalogue` test was stale — it still expected seven roles and was not wired into `npm test` — and is fixed here.

### 3.11 Maternity and MCH

**The clinical order is the data model.** One pregnancy, many antenatal visits; if she labours here, one labour record carrying the partograph readings; then one delivery carrying one row per baby.

| Table | Holds |
|---|---|
| `maternity_pregnancies` | booking, LMP, EDD and its basis, obstetric history, risk factors, status |
| `anc_visits` | one row per antenatal visit: gestation, weight, BP, fundal height, FHR, presentation, urine, Hb, TT dose, IFAS, danger signs, next visit |
| `labour_records` | admission, labour onset, membrane rupture, gestation at admission, status |
| `partograph_entries` | the time series: dilatation, descent, contractions and their duration, FHR, membranes, liquor, maternal pulse, BP, temperature |
| `deliveries` | mode, blood loss, perineum, placenta, oxytocin, complications |
| `delivery_babies` | one row per baby: sex, weight, Apgar at 1/5/10, outcome, resuscitation |

**Three decisions worth knowing about.**

1. **ANC is not folded into the delivery.** Most antenatal care does not end in a delivery at this facility — referrals, caesareans booked elsewhere, women who move. Storing ANC on the delivery record would delete it in all those cases.
2. **The partograph is a series, not a form.** Twelve readings in six hours each need their own timestamp. The database refuses two readings at the same timestamp (`partograph_entries_labour_time_idx`), because on a partograph a double entry moves the plotted line.
3. **Twins are one delivery and two babies.** `baby1_*` / `baby2_*` columns stop working at the third baby and cannot be counted; the baby is the row.

**What the code refuses to do.**

- **No invented measurements.** Every clinical column is nullable and carries no default: an absent blood pressure is stored as NULL, not as a plausible number. `test:maternity` asserts this column by column.
- **No EDD that contradicts its own arithmetic.** With an LMP and a basis of `LMP`, the EDD must be LMP + 280 days. A scan may re-date, which is why `edd_basis` is stored and `Ultrasound` / `Other` are allowed to disagree.
- **No hidden defaults in the ward forms.** Empty inputs are sent as absent, so the server stores NULL.
- **No obstetric advice.** The partograph reports where the latest reading sits against the alert and action lines — a geometric fact about the plot — and says so in the payload: *"A plotting aid only. It does not recommend an intervention."*

**Scoping.** Every table carries tenant and facility. A record belonging to another facility answers **404**, not 403, so the response cannot be used to confirm which IDs exist. The facility lookup converts `getFacilityByIdScoped`'s denial into "not found" for exactly that reason.

**Permissions.** `maternity.read`, `maternity.create`, `maternity.update`. `DOCTOR`, `CLINICAL_OFFICER` and `NURSE` hold all three (nurse-midwives conduct deliveries in Kenya); `RECEPTIONIST` holds `maternity.read` only. New codes need two commands after pulling:

```
npm run db:seed:permissions                                   # insert the codes
npx tsx scripts/repair-tenant-staff-roles.ts --all --apply     # grant them to roles
```

Without the second, existing roles hold no maternity permission and the module answers 403 to everyone except a superadmin. The role catalogue panel in §3.10 reports the drift if this is skipped.

**The module gate is new.** `maternity` is a facility module like `theatre` or `radiology`. Existing facilities do not have it in `enabled_modules`, so it must be switched on in **Configuration → Modules** (or Super Admin → Facility → Modules) after deploying. Until then the API answers `403 FACILITY_MODULE_DISABLED`.

**Validation completed:**

- `npm run test:maternity` — 130 assertions: date arithmetic (including 30 February and leap years), Naegele's rule, gestation from the EDD, absent-is-not-zero, every partograph zone, the migration's additive guarantees, no default on any clinical measurement, route permissions, and that the screen ships no sample patient.
- **Live against PostgreSQL 16** — the scratch database was built by applying all sixteen migrations, then the service was exercised end to end: 24 checks covering EDD derivation, the one-active-pregnancy rule, ANC gestation computation, values stored versus left NULL, labour admission, three partograph readings, the duplicate-timestamp refusal, the dilatation range, the delivery with its baby, the pregnancy and labour closing to `Delivered`, refusal of a second delivery, refusal of a reading after delivery, the summary counts, and cross-facility isolation. Two defects were found this way and fixed: Drizzle wraps driver errors so the SQLSTATE sits on `cause` (every unique violation was returning 500), and a facility denial was surfacing as 403 instead of 404.
- `npm test` — **1,696 assertions across thirteen suites** at the time of that round (the current total is in §3.13).
- `npm run build` — passed. `npm run lint` — only the pre-existing `firebase.ts` error.

**Not verified:** the screens were not walked in a browser, and no clinician has reviewed the field set against the MOH 405 card. Postnatal care, immunisation and the plotted chart were still outstanding at the end of that round; they are in §3.12.

### 3.12 Postnatal care, immunisation, a plotted partograph and delivery billing

**What was missing.** The MCH pathway stopped at the delivery. There was no way to record the six weeks that follow, no childhood immunisation register, the partograph was a table of numbers with no chart, and a delivery raised no invoice at all — the largest single billable event in a maternity facility.

**Postnatal contacts** (`postnatal_visits`). One row per contact. The mother is the subject and the baby's weight sits on the same row, because at this stage the two are seen together and a separate baby record would be empty for most visits. The contact hangs off the **pregnancy**, not the delivery, so a woman who delivered elsewhere still has a record. `day_postpartum` is counted from the recorded delivery date and stored, not recomputed on read — a contact recorded on day 3 stays day 3.

**Immunisation** (`immunisation_records`). The schedule lives in `src/immunisation/immunisation-contracts.ts` — 19 KEPI reference doses — and not in a table, for the same reason the partograph alert line is computed: a schedule changes, a record of what was given must not. `immunisation_records_dose_idx` is a unique index on (tenant, patient, antigen, dose), so the same dose administered twice is refused **by the database**, which is the one guarantee a paper card cannot give. Four further refusals sit in code: an unknown antigen, a future date, a date before the child was born, and a dose number outside 1–4.

**"Due" is not a diagnosis.** A dose is **Due** from its scheduled week and **Overdue** only four weeks later — a child seen a fortnight late is late, not overdue, and a list that shouts at every late attendance stops being read. The card carries the caveat in the payload: *confirm the ages against the current KEPI chart*.

**The partograph is now a chart.** `buildPartographPlot` turns stored readings into geometry: hours since admission on the x axis, centimetres on the y axis, the alert line beginning at the first reading that reaches 4 cm and climbing 1 cm/h to 10 cm, the action line four hours to its right. The axis is extended to the end of the action line, because a chart that crops its own action line makes the line look as if it stopped. The same function feeds the table's zone, so the two cannot disagree. It is rendered as inline SVG (`src/components/maternity/PartographChart.tsx`): no canvas, no charting library, no network fetch — the facility laptop may have no internet. The table remains, because a clinician reading six hours of observations wants the numbers.

**A delivery now bills — or says it cannot.** `POST /api/maternity/deliveries` calls `chargeForService` with candidate codes `DELIVERY`, `MATERNITY-DELIVERY` and the mode, `sourceType: 'MATERNITY'`, and `sourceId` set to the delivery. **No fallback price is passed**, so a facility with no delivery tariff gets `TARIFF_NOT_CONFIGURED` and the screen prints *"Recorded, not billed"* with the next step. One charge per delivery, not per baby: twins are one delivery. The new source type is mapped to the DHA `maternity` service area.

**Reachable on the screen.** Two new tabs — *Postnatal care* and *Immunisation* — plus the chart in the labour pane and a billing banner on the delivery screen. The immunisation antigen picker is served from the same array the due-date logic uses (`GET /api/immunisation/schedule`); a second copy in the UI would be a second schedule, and the second one is always the wrong one.

**Permissions.** No new codes. Postnatal and immunisation ride on `maternity.read` / `maternity.create`, and `/api/immunisation` is gated on the `maternity` module, because in Kenya the doses are given in the MCH clinic on the same visit as the mother's check. A second switch would let a facility open the child register while the mother's record stayed closed.

**Validation completed**

- `npm run test:postnatal` — 151 assertions: the schedule's uniqueness and ages, `Due`/`Overdue` boundaries at 0/4 weeks, an early dose still recorded, the plot's geometry including a late 4 cm start and the axis covering the action line, the additive migration and its guards, the service refusals, the delivery charge carrying no fallback price and no money literal, and that every capability is on the screen.
- `npm test` — **1,906 assertions** across thirteen counting suites, plus the staff-role-catalogue suite (which reports pass/fail without a count). All green.
- **Live against PostgreSQL 16.** All 17 migrations applied to a scratch database, then 40 checks: plot geometry from real rows (alert at hour 2, action at hour 6, axis 13 h), chart and table agreeing on the zone, no tariff → `TARIFF_NOT_CONFIGURED`, a 12,000 tariff → billed with invoice `INV-000001`, a repeat → `DUPLICATE`, exactly one invoice line, day postpartum 3 from the delivery date, an unmeasured temperature stored NULL, cross-facility 404, duplicate dose refused, future/before-birth/unknown-antigen refusals, a 19-antigen card, and the facility due list.
- `npm run build` — passed. `npm run lint` — only the pre-existing `firebase.ts` error.

**Three migration defects found and fixed.** A database could not be brought up to date on 21 October 2026, and each attempt exposed a different fault.

1. **`0002` blocked every fresh install.** Two `ALTER COLUMN … SET DATA TYPE date` statements had no `USING` clause, so PostgreSQL raised `42804` and the whole run rolled back. The cast is harmless on an empty table and required on a populated one.

2. **`0008` blocked a database that had been built with `drizzle-kit push`.** Push writes the schema but not the migration log, so `lab_results.status` already existed while the migration row did not. `ADD COLUMN status` failed with `42701 — column "status" … already exists`, the run rolled back as a unit, and the database could not move past `0008`. The file is now guarded and re-runnable: `ADD COLUMN IF NOT EXISTS`, the default and `NOT NULL` set separately, and a backfill written so a second run changes nothing. On a drifted database the backfill still does the thing that matters — a row with a verifier recorded but a status of `Pending Verification` is promoted to `Verified`, and a row with no verifier loses a verification time it should never have carried.

3. **The runner hung on failure.** It printed the failing statement and then waited, because it called `pool.end()` while still holding the failed client. It now releases the client first and exits 1. Measured: the run that previously sat until killed at 300 s now exits in **1 s**, with one transaction rolled back and 0 tables created.

Editing `0002` alone would have been unsafe, because the runner decided what was applied from the file's SHA-256 only: a changed file would look pending and be re-applied on the one database that must not see it run again. The runner now treats a migration as applied when **either** its hash **or** its journal timestamp is recorded — the rule `db:status` already used, so the two no longer disagree. An applied file that has changed on disk is named in a warning and skipped.

Verified against PostgreSQL 16:

| Scenario | Result |
|---|---|
| Fresh database | all 17 migrations apply, exit 0 |
| `0000`–`0007` applied, then `lab_results.status` added by hand (the pushed-schema state) | `0008`–`0016` apply; the verified row becomes `Verified`; the unverified row's `verified_at` is cleared; `db:status:all` says READY |
| `0002` edited after being applied | `Pending: 0`, warning, exit 0, no SQL run |
| Deliberately broken `0002` | fails in 1 s with exit 1, database unchanged |

`test:migrations` now enforces the class rather than the instance (655 assertions): from `0007` onward no migration may add a column, table, index or sequence without `IF NOT EXISTS`, none may be destructive, no column type change may omit `USING`, and the runner must keep both the timestamp skip and the client release. Reverting `0008`'s guard fails the suite by name.

**Not verified:** the screens were still not walked in a browser — no browser was available in this environment, so the tabs, the chart and the billing banner have been type-checked and built but not clicked. No clinician has reviewed the field set against the MOH 405 card, and no one has confirmed the KEPI ages against the current chart.

### 3.13 Ward and bed set-up — the empty dropdowns

**What was missing.** The inpatient screen could be read and never filled. `GET /api/wards`, `GET /api/beds`, `PUT /api/beds/:id/status` and `PUT /api/beds/:id/release` were the only ward or bed routes in `src/app.ts` — there was no POST, no edit and no delete for either. Wards and beds existed only if `src/db/seed.ts` had been run, and that seed also creates demo patients and a demo admission. A real facility therefore opened **Admit patient** to two empty dropdowns with no screen anywhere to fill them. This was not a bug in the dropdowns; it was the absence of a write path.

**The write path** (`src/inpatient/ward-bed.service.ts`) adds six operations, each behind its own permission:

| Endpoint | Permission |
|---|---|
| `POST /api/wards` | `inpatient.wards.create` |
| `PUT /api/wards/:id` | `inpatient.wards.update` |
| `DELETE /api/wards/:id` | `inpatient.wards.delete` |
| `POST /api/beds` | `inpatient.beds.create` |
| `PUT /api/beds/:id` | `inpatient.beds.update` |
| `DELETE /api/beds/:id` | `inpatient.beds.delete` |

Reading stays on `inpatient.read`. All six mutate paths are audited, and every one resolves the facility through `resolveFacilityScope` — the facility is taken from the session, never from the request body. Another facility's ward or bed answers **404**, not 403, as everywhere else.

**Beds are created in a batch.** A ward is set up in one sitting, so `POST /api/beds` takes either `{ wardId, prefix, startNumber, count, bedType, dailyCharge? }` — which produces `FMW-BED-01 … FMW-BED-04` — or an explicit `{ wardId, bedNumbers: [...] }`. At most 60 at a time. If any number already exists the whole batch is refused (`BED_NUMBER_EXISTS`, naming the numbers) and nothing is inserted, so a failed attempt cannot leave half a ward behind.

**No invented numbers.**

- A rate or charge left blank is stored **NULL**. The columns carry historical defaults of 1500.00 and 1800.00; a bed billed at a price nobody entered is a bill waiting to happen, so the service never falls back to them and the screen says *not priced*.
- A ward's `total_beds` is **counted**, not typed. It is written as 0 on creation and recounted after every bed change, because the old default of 20 made a six-bed ward advertise twenty.
- A new bed is `Available`; `Occupied` is only ever set by admitting a patient. An edit cannot set it.
- A ward with a patient in it cannot be retired (`WARD_OCCUPIED`); a retired ward accepts no new beds (`WARD_RETIRED`).

**History is not deleted.** A ward or bed with admission rows cannot be deleted — the admission would lose the place it happened in. `deleteWard`/`deleteBed` refuse with `WARD_HAS_HISTORY` / `BED_HAS_HISTORY` and name the alternative: retire the ward, or set the bed to Maintenance. A bed with a patient currently in it is refused sooner and more bluntly (`BED_OCCUPIED`). Only a ward with no admissions and no occupied beds may be deleted, and its unused beds go with it in one transaction.

**Reachable on the screen** (`src/components/modules/InpatientModule.tsx`). The page header carries *Add Ward* and *Add Beds to <code>* when the signed-in user holds the matching permission; the bed board header carries *Add beds*, *Edit ward*, *Retire*/*Reactivate* and *Delete ward*. A facility with no wards at all is shown a first-run card — *"Create the first ward"* — rather than an empty grey panel, and a ward with no beds says so with a button to add them. Bed tiles carry edit and delete icons. Three modals cover the ward form, the batch bed form and the bed edit. The admit modal offers only active wards and beds that are `Available`, and disables submit when either is empty. Users without a permission see the count and the reason (`Adding beds needs inpatient.beds.create`) instead of a button that would fail.

**One vocabulary.** The ward-type and bed-type suggestions and the gender-allocation list live in `src/db/inpatient-contracts.ts`, the module the server validates against, and the screen imports them from there. A second copy in the component would be a second vocabulary, and the second one is always the wrong one.

**Where the permissions are granted.** All six codes carry `module: 'inpatient'`, so they appear in **Administration → Platform Administration → Facilities → Facility Role Permissions** (the panel headed *Facility Role Permissions*, below the facility's module settings) under the existing *inpatient* heading alongside `inpatient.read`, `.admit` and `.discharge`. No role receives them by default — a facility decides who configures the ward versus who admits into it. The seeder is idempotent: it inserts what is missing and updates the label and description of what exists.

**Validation completed**

- `npm test` — **1,955 assertions** across thirteen counting suites; `test:inpatient` is now **97** (was 48). The new assertions cover the six permission codes being seeded and the six routes being guarded, no money literal standing in for a blank rate, capacity starting at zero, the batch contract, the history refusals, the scope rules, and the screen wiring.
- `npm run build` — passed (553 ms). `npm run lint` — only the pre-existing `firebase.ts` error.
- **Live against PostgreSQL 16**, all 17 migrations applied to a scratch database: 33 checks. A new facility starts with **0** wards; the first ward is created from nothing; a blank rate is stored `NULL`; capacity is 0 until beds exist; four beds are generated and the dropdown is no longer empty; a duplicate ward code and a colliding bed number are both refused by name; a refused batch adds nothing; a patient is admitted into a generated bed and that bed becomes `Occupied`; retiring and deleting are refused while the patient is there; after discharge the bed's history still blocks deletion; a retired ward leaves the admit list and accepts no new beds; another facility sees a 404 and an empty board; an entered rate is normalised to two decimals; a ward with no patients deletes with its beds.

**Not verified:** the screen was not walked in a browser — none is available in this environment, so the buttons, empty state and modals are type-checked and built but not clicked. No facility user has set up a real ward yet.

## 4. Existing backups and modified files to preserve

### Backups created during the latest session

- `src/app.ts.backup-permissions-20261020-121641`
- `src/auth/staff-role-catalogue.ts.backup-permissions-20261020-121641`
- `schema.ts.before-postnatal.bak` (in `src/db/`)
- `src/app.ts.before-postnatal-20261021.bak`
- `src/api/client.ts.before-postnatal-20261021.bak`
- `src/components/modules/MaternityModule.tsx.before-postnatal-20261021.bak`
- `scripts/migrate.ts.before-timestamp-skip-20261021.bak`
- `drizzle/0002_friendly_lady_deathstrike.sql.before-using-cast-20261021.bak`
- `README.md.before-postnatal-20261021.bak`
- `src/app.ts.before-ward-setup-20261021.bak`
- `src/api/client.ts.before-ward-setup-20261021.bak`
- `src/components/modules/InpatientModule.tsx.before-ward-setup-20261021.bak`
- `src/db/inpatient-contracts.ts.before-ward-setup-20261021.bak`
- `src/types/index.ts.before-ward-setup-20261021.bak`

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

`requireAuth` loads the authorization context and attaches it to the request (`src/auth/auth.middleware.ts:144`). Routes read it through `requireAuthContext`, which answers `401 AUTHORIZATION_CONTEXT_MISSING` rather than continuing with an undefined context.

**Status of this section, 21 October 2026.** The clinical paths are closed. `GET/POST /api/diagnoses` and `GET/POST /api/procedures` call `getDiagnosesScoped`, `recordDiagnosisScoped`, `getProceduresScoped` and `recordProcedureScoped`; observations already went through `nursing.getObservationsScoped`; the laboratory functions take `authContext` and apply `resolveFacilityScope`. Details and the tests are in §3.9. The generic functions below are still in `queries.ts`, unreferenced by any route. The rule that follows is not retrospective — it is the rule any new route must satisfy.

Existing scope helpers are available in `src/db/queries.ts`, including:

- `requirePatientInTenant`
- `getFacilityByIdScoped`
- `resolveFacilityScope`
- `getEncountersScoped`
- `createEncounterScoped`
- `updateEncounterScoped`

These generic functions accept filters or record IDs and, on their own, do not establish scope:

| Function | Who calls it now |
|---|---|
| `getObservations`, `recordObservation` | superseded by `nursing.getObservationsScoped` for reads; **no route** |
| `getDiagnoses`, `recordDiagnosis` | **no route** — replaced by the `*Scoped` variants |
| `getProcedures`, `recordProcedure` | **no route** — replaced by the `*Scoped` variants |
| `getLabOrders`, `createLabOrder`, `updateLabOrderStatus`, `getLabResults`, `addLabResult` | the routes, passing `authContext`; reads scope through `resolveFacilityScope`, writes go through the parent order |

Some of these functions can still return records without a facility filter if called directly, and some writes update by record ID alone. Do not assume the new route permissions solve these data-isolation problems.

**Required security rule:** Authorisation and data scope must both be enforced. Resolve the authenticated user's permitted tenant/facility scope from trusted server-side context, validate the actual database relationships, and reject cross-scope reads and writes. Never rely on a client-provided `facilityId` as proof of access.

For clinical observations, diagnoses and procedures, validate the encounter's tenant/facility and ensure the supplied patient ID matches that encounter. Do not incorrectly require a patient's registration facility to equal the facility where the patient is receiving care.

For laboratory results, validate access through the parent order and its patient, tenant and facility relationships.

## 6. Laboratory workflow concern — resolved

**This concern is closed.** Migration `0008` made `lab_results.verified_by` and `verified_at` nullable, `addLabResult` now writes `Pending Verification` with both columns null, and `POST /api/lab-results/:id/verify` publishes a result only when the caller holds `laboratory.results.verify`. See milestone 9 in §2. The text below is kept as the record of the problem and the workflow it had to satisfy; read it in the past tense.

**What was wrong at the time.** `addLabResult` inserted a result and immediately moved the laboratory order to `Published`, so an entered result was indistinguishable from a verified one. `labResults.verifiedAt` was non-null with a default timestamp, which could not represent an unverified result at all.

**The workflow the implementation had to satisfy** (all six steps are now possible):

1. Clinician orders an investigation.
2. Laboratory staff receive the order and collect/process the sample.
3. Authorised laboratory staff enter the result.
4. An authorised verifier reviews and verifies the result.
5. The result is published and made available to the clinician.
6. The clinician reviews the result and records the follow-up.

The rule that produced this split still holds: never reset the database and never silently treat an entered result as verified.

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

### Tenant and facility isolation — clinical paths closed, audit incomplete
- **Closed 21 October 2026:** the diagnoses and procedures routes resolve the encounter through `loadEncounterInScope` and refuse a read with no encounter or patient filter; observations went through `nursing.getObservationsScoped` earlier; the laboratory routes pass `authContext` into `resolveFacilityScope`. `req.authContext` is assigned at `src/auth/auth.middleware.ts:144` — this was confirmed, not assumed. Covered by `test:security` (54 assertions). Details in §3.9.
- **Still open:** the generic functions remain in `queries.ts` and would still return an unfiltered set if a future route called them; the remaining query functions have not been audited one by one; route-level permission middleware alone does not prevent cross-facility access.

**Standing rule:** every read and write must enforce the authenticated user's actual scope using trusted server-side context and database relationships.

### Laboratory result lifecycle — resolved
- `addLabResult` writes `Pending Verification` with `verified_by`/`verified_at` null; publication is a separate, permission-gated step (`laboratory.results.verify`).
- Migration `0008` made both columns nullable, so an unverified result is representable.
- Covered by assertions in `test:nursing` and `test:migrations`. §6 keeps the original problem statement.


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
- HTTP hardening is in place: security headers, an origin allowlist and per-IP rate limits (§3.9). This is configuration, not a security review.
- Independent security testing, a load test, a restore drill, monitoring, regression testing with users, client acceptance and production deployment all remain outstanding.
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

1. **Walk the screens in a browser.** Booking → ANC → labour → the chart → delivery → the billing banner → postnatal → immunisation. The services and the HTTP layer have been exercised; nobody has clicked through the screens, and no browser was available in the working environment.
2. **Bring the database up to date.** `npm run db:status` first, then `npm run db:migrate` for whatever is pending, then `npm run db:status:all`. Additive only, `IF NOT EXISTS`, no destructive statements. Commands and failure guidance are in §10.3 and §10.6.
3. **Audit the remaining query functions** for the pattern closed in §3.9: a route that passes a client-supplied `facilityId` or a bare record ID where a scope check belongs.
4. **Verify effective permissions.** Test doctor, triage/reception and laboratory access, including facility overrides.
5. **Have a clinician check the MCH field sets** against the MOH 405 card, and the immunisation ages against the current KEPI chart. Both are recorded as reference data, not validated clinical policy.
6. **Update the tracker with evidence.** Mark a task Verified only when its own checks pass; "the test suite passes" is not evidence that a screen works.

## 5. Current status summary

| Area | Status |
|---|---|
| Foundation implementation | Completed; prior checks reported |
| Authentication/session hydration | Fix implemented; previously reported working |
| Patient registration changes | Implemented; prior build and type checks passed |
| Analytics summary endpoint | Implemented; prior build and type checks passed |
| Latest API permission middleware | Implemented; type check and build passed |
| Tenant/facility scope for clinical and lab queries | Clinical paths closed and tested; remaining queries not audited |
| Laboratory verification/publication workflow | Resolved (migration 0008) |
| HTTP hardening (headers, CORS, rate limits) | Implemented and probed against a running server |
| Maternity, postnatal care and immunisation | Implemented; 131 + 151 assertions and 40 live checks; not walked in a browser, no clinical review |
| End-to-end OPD/triage verification | In progress — no browser walkthrough yet |
| Independent security testing, load test, restore drill | Not started |
| Comprehensive regression testing and user acceptance | Not started |
| Production deployment and handover | Not started |

**Immediate focus:** finish the OPD/triage workflow in a browser, then start maternity/MCH. Avoid reopening completed work unless a specific defect is demonstrated.

## 10. Migrations and full sync

This is the end-to-end procedure for bringing a checkout and its database to the
same state as the branch. It is written for the Windows/PowerShell development
machine described in §1, and the same commands work on Linux.

### 10.1 What is pending, and what each migration does

What is pending depends on the database in front of you, not on this document.
`npm run db:status` is the authority: it matches the journal against
`drizzle.__drizzle_migrations` and prints `PENDING` beside anything not yet
recorded. Migrations `0000`–`0007` form the base schema and are applied on every
live database. The tail beyond that, and what each one adds:

| Migration | What it adds | Touches existing data |
|---|---|---|
| `0008_lab_result_verification_state` | `lab_results.status`, and `verified_at` becomes nullable | Backfills `status` from `verified_by`; clears a verification time where there is no verifier |
| `0009_billing_provenance_and_inpatient` | `admission_transfers`, `nursing_notes`, invoice numbering sequence, billing provenance columns, admission discharge columns | Adds columns only |
| `0010_mobile_money_settlement` | Settlement state on `billing_payments` and the receipt sequence | Adds columns only |
| `0011_insurance_claims_workflow` | Claim lines, adjudication and settlement columns | Adds columns only |
| `0012_dha_integration_audit` | `dha_api_calls`, plus four `patients` columns for DHA eligibility | Adds columns only |
| `0013_dha_service_mappings` | `dha_service_mappings` and its unique index | No |
| `0014_professional_verification` | `staff_professional_credentials`, `professional_verification_events`, four indexes | No |
| `0015_maternity_mch` | Six maternity tables and their indexes | No |
| `0016_postnatal_immunisation` | `postnatal_visits`, `immunisation_records`, the unique dose index | No |

From `0007` onward every `CREATE TABLE`, `CREATE INDEX`, `CREATE SEQUENCE` and
`ADD COLUMN` is written with `IF NOT EXISTS`, none contains `DROP`, `TRUNCATE` or
`DELETE`, and `npm run test:migrations` fails if one stops being guarded. That
matters because a database whose schema was built with `drizzle-kit push` has the
objects but not the migration rows: re-running a guarded migration is a no-op,
re-running an unguarded one fails. Re-running any of the above is harmless.

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
| `column "..." already exists` (`42701`) | The schema was built with `drizzle-kit push`, which writes objects but not migration rows | Fixed in `0008` on 21 October 2026 — re-run `npm run db:migrate`. Any future migration that hits this is a missing `IF NOT EXISTS`; report it rather than editing the table by hand |
| `relation "..." does not exist` | An earlier migration was recorded but not applied (a half-run from `drizzle-kit`) | Re-run `npm run db:migrate`; the runner matches on hash **or** journal timestamp and re-applies |
| `! N applied migration(s) have changed on disk` | A migration file was edited after this database applied it | No action. It keeps its recorded timestamp and does not run again; the change reaches only databases that have not applied it |
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
