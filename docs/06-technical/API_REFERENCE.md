# API reference

> Generated from the registered routes of the running application by `scripts/docs/build-api-reference.ts`. Every path below was walked from the Express router tree of `createApp()` and matched back to the source registration that declares it; there are no handwritten endpoints. Regenerate after any route change.

Generated: 2026-11-19

**Intended audience:** integrators, frontend developers, QA engineers, security reviewers.

## Scope and method

| Measure | Value |
| --- | --- |
| Effective HTTP routes | 763 |
| Route registrations parsed from source | 786 |
| Routes matched to a source registration | 763 |
| Unauthenticated routes | 13 |
| Routes behind a permission or administrator guard | 678 |
| Path prefixes | 70 |

Permissions are read from the handler chain and from router-level guards: a `requirePermission` call on the router itself applies to every route registered on it and is reported here as if it were written on each route. Where no permission appears, authorisation is either absent by design (public routes) or decided inside the service that receives the request context; the last case is marked "checked in service".

## Authentication and authorisation

One process serves both the JSON API and the single-page application. `POST /api/auth/login`
returns a session token. Clients send it as `Authorization: Bearer <token>` on every request;
the server stores only the SHA-256 hash of the token in `sessions`, and the session expires eight
hours after issue. The browser SPA keeps the token in `localStorage` under
`jalicare_session_token`. The patient portal uses a separate token, a separate table
(`patient_portal_sessions`) and a separate middleware (`requirePortalAuth`), so a portal token
cannot call staff endpoints and vice versa.

The API is mounted in this order (from `src/app.ts`):

1. Unauthenticated probes and public endpoints: `/api/health`, `/api/ready`, `/api/auth` login and invitation acceptance, `/api/webhooks/sha`, `/api/payment-hub/webhooks`, `/api/booking/v1`, `/api/portal`.
2. The API rate limiter.
3. `app.use('/api', requireAuth)` — everything registered afterwards requires a staff session.
4. `app.use('/api', requireAuthorization)` — tenant, facility and module checks.
5. Module gates (`requireFacilityModule`) and domain routers.
6. A JSON 404 handler for unmatched `/api` paths, so an unknown endpoint never returns the SPA shell.

There are 13 unauthenticated routes. Most are login and invitation entry points, the public booking API used by the website, and liveness probes. The SHA eClaims webhook is authenticated by a shared secret and a signature check inside the handler rather than by a session.

## Request conventions

| Topic | Convention |
| --- | --- |
| Base path | Every endpoint is under `/api`. Paths in this reference are absolute. |
| Content type | JSON bodies (`application/json`), except document upload, which sends raw bytes with the `X-Document-Metadata` header; letterhead and document downloads return a file. |
| Validation | Zod schemas validate the body and query string before the handler runs; the schema that a route uses is named in the *Input* column. |
| Identifiers | Database identifiers are integers. Path parameters are validated and rejected with `400` when they are not positive integers. |
| Facility context | Handlers resolve the facility from the session. A `facilityId` in the body or query is accepted only when it agrees with the session; a mismatch is `403`. |
| Dates | Calendar dates are `YYYY-MM-DD`; timestamps are ISO 8601. The server runs in the timezone configured for the deployment (`TZ`). |
| Pagination | Applied per endpoint, not globally: list endpoints accept `page`/`pageSize` or a `paginate=1` flag that returns an envelope. Where an endpoint has no paging, the *Input* column shows no paging schema and the response is the full result set for the scope. |

## Response conventions

Successful responses return JSON. Most write endpoints return `{ "success": true, ... }`;
read endpoints return the record or list directly. File endpoints return the file bytes with a
`Content-Type` and `Content-Disposition` header.

Errors share a small number of shapes:

```json
{ "success": false, "error": "VALIDATION_ERROR", "code": "VALIDATION_ERROR",
  "message": "Request validation failed.", "issues": [{ "path": "amount", "message": "..." }] }
```

```json
{ "success": false, "error": "RATE_LIMITED", "message": "Too many requests. Slow down and try again shortly." }
```

```json
{ "success": false, "error": "NOT_FOUND", "message": "No API route matches GET /api/example." }
```

| Status | Meaning in this API |
| --- | --- |
| 400 | Validation failed, or a path/body value is not acceptable. |
| 401 | No session, an expired session, or unusable credentials. |
| 403 | The session is valid but the role, facility, module or scope does not allow the action. |
| 404 | The route does not exist (JSON, never the SPA shell) or the scoped record does not exist. |
| 409 | A state conflict, such as a duplicate identifier or a document already released. |
| 422 | A business rule rejected the request. |
| 429 | Rate limit exceeded. |
| 500 | An unhandled failure; the message is deliberately generic and the detail is logged. |

## Rate limits

| Limiter | Window | Limit | Behaviour |
| --- | --- | --- | --- |
| Login | 15 minutes | 10 failed attempts per IP | Successful sign-ins do not count. Exceeding it returns `429`. |
| API | 1 minute | 300 requests per IP | Applies to every `/api` request, authenticated or not. Returns `429`. |

Limits are configured in `src/middleware/http-security.middleware.ts` and are raised in the test environment.

## Endpoints by prefix

| Prefix | Routes | Share |
| --- | --- | --- |
| [`/api/insurance`](#apiinsurance) | 91 | 11.9% |
| [`/api/fixed-assets`](#apifixed-assets) | 56 | 7.3% |
| [`/api/portal`](#apiportal) | 42 | 5.5% |
| [`/api/accounting`](#apiaccounting) | 37 | 4.8% |
| [`/api/budget-planning`](#apibudget-planning) | 35 | 4.6% |
| [`/api/payroll`](#apipayroll) | 29 | 3.8% |
| [`/api/payment-hub`](#apipayment-hub) | 28 | 3.7% |
| [`/api/procurement`](#apiprocurement) | 25 | 3.3% |
| [`/api/inventory`](#apiinventory) | 25 | 3.3% |
| [`/api/hr`](#apihr) | 24 | 3.1% |
| [`/api/platform`](#apiplatform) | 21 | 2.8% |
| [`/api/maternity`](#apimaternity) | 18 | 2.4% |
| [`/api/dialysis`](#apidialysis) | 16 | 2.1% |
| [`/api/billing`](#apibilling) | 16 | 2.1% |
| [`/api/payer-hub`](#apipayer-hub) | 15 | 2.0% |
| [`/api/partner-equity`](#apipartner-equity) | 13 | 1.7% |
| [`/api/patients`](#apipatients) | 12 | 1.6% |
| [`/api/admissions`](#apiadmissions) | 12 | 1.6% |
| [`/api/theatre`](#apitheatre) | 12 | 1.6% |
| [`/api/patient-documents`](#apipatient-documents) | 11 | 1.4% |
| [`/api/booking`](#apibooking) | 11 | 1.4% |
| [`/api/invoices`](#apiinvoices) | 10 | 1.3% |
| [`/api/facility-services`](#apifacility-services) | 10 | 1.3% |
| [`/api/appointments`](#apiappointments) | 10 | 1.3% |
| [`/api/bank-payments`](#apibank-payments) | 9 | 1.2% |
| [`/api/staff-invitations`](#apistaff-invitations) | 9 | 1.2% |
| [`/api/facility-branding`](#apifacility-branding) | 8 | 1.0% |
| [`/api/documents`](#apidocuments) | 8 | 1.0% |
| [`/api/facility-tariffs`](#apifacility-tariffs) | 8 | 1.0% |
| [`/api/purchase-orders`](#apipurchase-orders) | 8 | 1.0% |
| [`/api/auth`](#apiauth) | 7 | 0.9% |
| [`/api/reporting`](#apireporting) | 7 | 0.9% |
| [`/api/integrations`](#apiintegrations) | 7 | 0.9% |
| [`/api/claims`](#apiclaims) | 7 | 0.9% |
| [`/api/staff-roles`](#apistaff-roles) | 6 | 0.8% |
| [`/api/medications`](#apimedications) | 6 | 0.8% |
| [`/api/beds`](#apibeds) | 6 | 0.8% |
| [`/api/immunisation`](#apiimmunisation) | 5 | 0.7% |
| [`/api/lab-orders`](#apilab-orders) | 5 | 0.7% |
| [`/api/facilities`](#apifacilities) | 4 | 0.5% |
| [`/api/icd11`](#apiicd11) | 4 | 0.5% |
| [`/api/inpatient`](#apiinpatient) | 4 | 0.5% |
| [`/api/wards`](#apiwards) | 4 | 0.5% |
| [`/api/suppliers`](#apisuppliers) | 4 | 0.5% |
| [`/api/approval-policies`](#apiapproval-policies) | 4 | 0.5% |
| [`/api/encounters`](#apiencounters) | 4 | 0.5% |
| [`/api/public-health`](#apipublic-health) | 4 | 0.5% |
| [`/api/notifications`](#apinotifications) | 3 | 0.4% |
| [`/api/nursing-notes`](#apinursing-notes) | 3 | 0.4% |
| [`/api/radiology-orders`](#apiradiology-orders) | 3 | 0.4% |
| [`/api/lab-results`](#apilab-results) | 3 | 0.4% |
| [`/api/theatre-cases`](#apitheatre-cases) | 3 | 0.4% |
| [`/api/queues`](#apiqueues) | 3 | 0.4% |
| [`/api/service-tariff-links`](#apiservice-tariff-links) | 3 | 0.4% |
| [`/api/dashboard`](#apidashboard) | 2 | 0.3% |
| [`/api/compliance`](#apicompliance) | 2 | 0.3% |
| [`/api/pharmacy`](#apipharmacy) | 2 | 0.3% |
| [`/api/diagnoses`](#apidiagnoses) | 2 | 0.3% |
| [`/api/procedures`](#apiprocedures) | 2 | 0.3% |
| [`/api/observations`](#apiobservations) | 2 | 0.3% |
| [`/api/tenants`](#apitenants) | 2 | 0.3% |
| [`/api/analytics`](#apianalytics) | 2 | 0.3% |
| [`/api/interop`](#apiinterop) | 2 | 0.3% |
| [`/api/health`](#apihealth) | 1 | 0.1% |
| [`/api/ready`](#apiready) | 1 | 0.1% |
| [`/api/webhooks`](#apiwebhooks) | 1 | 0.1% |
| [`/api/ops`](#apiops) | 1 | 0.1% |
| [`/api/lab-tests`](#apilab-tests) | 1 | 0.1% |
| [`/api/departments`](#apidepartments) | 1 | 0.1% |
| [`/api/audit-logs`](#apiaudit-logs) | 1 | 0.1% |

---

## /api/accounting

37 routes.

Facility module gate: `accounting`.

9 distinct permission codes are required across this prefix: `accounting.read`, `accounting.coa.manage`, `accounting.bank.manage`, `billing.read`, `accounting.journals.post`, `accounting.expenses.request`, `accounting.expenses.approve`, `accounting.periods.close`, `accounting.reports.export`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/accounting/accounts` | List accounts | Staff session | `accounting.read` | — | — | `listAccountsScoped()` | `src/routes/accounting.routes.ts:282` |
| POST | `/api/accounting/accounts` | Create an account | Staff session | `accounting.coa.manage` | body `createAccountBodySchema` | — | `createAccountScoped()` | `src/routes/accounting.routes.ts:318` |
| GET | `/api/accounting/bank` | List bank | Staff session | `accounting.read` | — | — | `listBankWorkspaceScoped()` | `src/routes/accounting.routes.ts:561` |
| POST | `/api/accounting/bank/accounts` | Create an account | Staff session | `accounting.bank.manage` | body `createBankAccountBodySchema` | — | `createBankAccountScoped()` | `src/routes/accounting.routes.ts:568` |
| GET | `/api/accounting/bank/accounts/:id/reconciliation-report` | Read a reconciliation report | Staff session | `accounting.read` | — | — | `bankReconciliationReportScoped()` | `src/routes/accounting.routes.ts:740` |
| POST | `/api/accounting/bank/accounts/:id/statements` | Statements: accounts statements | Staff session | `accounting.bank.manage` | — | — | `importStatementScoped()` | `src/routes/accounting.routes.ts:604` |
| GET | `/api/accounting/bank/accounts/:id/statements/:statementId/reconciliation` | Read a reconciliation | Staff session | `accounting.read` | — | — | `previewBankReconciliationScoped()` | `src/routes/accounting.routes.ts:638` |
| POST | `/api/accounting/bank/accounts/:id/statements/:statementId/reconciliation` | Create action on a reconciliation | Staff session | `accounting.bank.manage` | — | — | `saveBankReconciliationScoped()` | `src/routes/accounting.routes.ts:656` |
| POST | `/api/accounting/bank/accounts/:id/statements/preview` | Preview: statements preview | Staff session | `accounting.read`, `accounting.bank.manage` | — | — | `previewStatementImportScoped()` | `src/routes/accounting.routes.ts:586` |
| GET | `/api/accounting/bank/accounts/:id/unmatched` | Read an unmatched | Staff session | `accounting.read` | — | — | `investigateUnmatchedScoped()` | `src/routes/accounting.routes.ts:690` |
| POST | `/api/accounting/bank/reconciliations/:id/approve` | Approve: reconciliations approve | Staff session | `accounting.bank.manage` | — | — | `approveBankReconciliationScoped()` | `src/routes/accounting.routes.ts:722` |
| POST | `/api/accounting/bank/statements/:id/adjustments` | Create action on an adjustment | Staff session | `accounting.bank.manage` | — | — | `postBankStatementAdjustmentScoped()` | `src/routes/accounting.routes.ts:755` |
| POST | `/api/accounting/bank/transactions/:id/match` | Create action on a match | Staff session | `accounting.bank.manage` | — | — | `matchBankTransactionScoped()` | `src/routes/accounting.routes.ts:620` |
| GET | `/api/accounting/bank/transactions/:id/suggestions` | Read a suggestion | Staff session | `accounting.read` | — | — | `suggestMatchesForTransactionScoped()` | `src/routes/accounting.routes.ts:676` |
| POST | `/api/accounting/bank/transactions/:id/unmatch` | Create action on an unmatch | Staff session | `accounting.bank.manage` | — | — | `unmatchBankTransactionScoped()` | `src/routes/accounting.routes.ts:704` |
| GET | `/api/accounting/billing-consistency` | List billing consistency | Staff session | `accounting.read`, `billing.read` | — | — | `inspectBillingConsistencyScoped()` | `src/routes/accounting.routes.ts:127` |
| GET | `/api/accounting/billing-gl-reconciliation` | List billing gl reconciliation | Staff session | `accounting.read`, `billing.read` | — | — | `reconcileBillingLedgerScoped()` | `src/routes/accounting.routes.ts:146` |
| GET | `/api/accounting/billing-journal-exceptions` | List billing journal exceptions | Staff session | `accounting.read`, `billing.read` | — | — | `inspectBillingJournalExceptionsScoped()` | `src/routes/accounting.routes.ts:300` |
| GET | `/api/accounting/billing-ledger-review` | List billing ledger review | Staff session | `accounting.read`, `billing.read` | — | — | `inspectBillingLedgerScoped()` | `src/routes/accounting.routes.ts:205` |
| GET | `/api/accounting/billing-postings/:sourceType/:sourceId` | Read a billing posting | Staff session | `accounting.read`, `billing.read` | — | — | `getBillingSourcePostingScoped()` | `src/routes/accounting.routes.ts:387` |
| POST | `/api/accounting/billing-postings/:sourceType/:sourceId` | Create action on a billing posting | Staff session | `accounting.journals.post`, `billing.read` | body `postBillingSourceBodySchema` | — | `postBillingSourceScoped()` | `src/routes/accounting.routes.ts:406` |
| GET | `/api/accounting/expenses` | List expenses | Staff session | `accounting.read` | — | — | `listExpensesScoped()` | `src/routes/accounting.routes.ts:481` |
| POST | `/api/accounting/expenses` | Create an expense | Staff session | `accounting.expenses.request` | body `createExpenseRequestBodySchema` | — | `createExpenseRequestScoped()` | `src/routes/accounting.routes.ts:495` |
| POST | `/api/accounting/expenses/:id/approve-and-post` | Create action on an approve and post | Staff session | `accounting.expenses.approve`, `accounting.journals.post` | body `approveAndPostExpenseBodySchema` | — | `approveAndPostExpenseScoped()` | `src/routes/accounting.routes.ts:530` |
| POST | `/api/accounting/expenses/:id/decision` | Record a decision: expenses decision | Staff session | `accounting.expenses.approve` | body `decideExpenseRequestBodySchema` | — | `decideExpenseRequestScoped()` | `src/routes/accounting.routes.ts:511` |
| POST | `/api/accounting/expenses/:id/post` | Post: expenses post | Staff session | `accounting.journals.post` | body `facilityActionBodySchema` | — | `postApprovedExpenseScoped()` | `src/routes/accounting.routes.ts:547` |
| GET | `/api/accounting/invoices/:id/source-ledger-coverage` | Read a source ledger coverage | Staff session | `accounting.read`, `billing.read` | — | — | `inspectInvoiceLedgerCoverageScoped()` | `src/routes/accounting.routes.ts:188` |
| POST | `/api/accounting/journals` | Create a journal | Staff session | `accounting.journals.post` | body `postJournalBodySchema` | — | `postJournalScoped()` | `src/routes/accounting.routes.ts:370` |
| POST | `/api/accounting/journals/:id/reverse` | Reverse: journals reverse | Staff session | `accounting.journals.post` | body `reverseJournalBodySchema` | — | `reverseJournalScoped()` | `src/routes/accounting.routes.ts:428` |
| GET | `/api/accounting/overview` | Overview | Staff session | `accounting.read` | — | — | `scoped()` | `src/routes/accounting.routes.ts:290` |
| GET | `/api/accounting/payment-settlement-accounts` | List payment settlement accounts | Staff session | `accounting.read`, `billing.read` | — | — | `listSettlementAccountsScoped()` | `src/routes/accounting.routes.ts:244` |
| GET | `/api/accounting/payment-settlements` | List payment settlements | Staff session | `accounting.read`, `billing.read` | — | — | `listSettlementSourcesScoped()` | `src/routes/accounting.routes.ts:224` |
| POST | `/api/accounting/payment-settlements/:sourceType/:sourceId/retry` | Create action on a retry | Staff session | `accounting.journals.post`, `billing.read` | body `postBillingSourceBodySchema` | — | `retrySettlementSourceScoped()` | `src/routes/accounting.routes.ts:263` |
| POST | `/api/accounting/periods` | Create a period | Staff session | `accounting.coa.manage` | body `createFinancialPeriodBodySchema` | — | `createFinancialPeriodScoped()` | `src/routes/accounting.routes.ts:334` |
| POST | `/api/accounting/periods/:id/close` | Close: periods close | Staff session | `accounting.periods.close` | body `closeFinancialPeriodBodySchema` | — | `closeFinancialPeriodScoped()` | `src/routes/accounting.routes.ts:350` |
| GET | `/api/accounting/source-ledger-coverage` | Source-to-ledger coverage. The existing review endpoints select invoices by creation date; this one selects every source family by its own activity date, so a receipt taken today against an old invoice cannot fall outside the review window. | Staff session | `accounting.read`, `billing.read` | — | — | `inspectSourceLedgerCoverageScoped()` | `src/routes/accounting.routes.ts:170` |
| GET | `/api/accounting/trial-balance.csv` (file) | List trial balance.csv | Staff session | `accounting.reports.export` | — | — | `accounts.map` | `src/routes/accounting.routes.ts:453` |

## /api/admissions

12 routes.

Facility module gate: `inpatient`.

7 distinct permission codes are required across this prefix: `inpatient.read`, `inpatient.admit`, `billing.create`, `clinical.read`, `billing.update`, `inpatient.discharge`, `clinical.create`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/admissions` | List admissions | Staff session | `inpatient.read` | — | — | `queries.getAdmissionsScoped` | `src/routes/inpatient.routes.ts:612` |
| POST | `/api/admissions` | Create an admission | Staff session | `inpatient.admit` | — | — | `queries.createAdmissionScoped` | `src/routes/inpatient.routes.ts:640` |
| POST | `/api/admissions/:id/accrue-bed-days` | Accrue bed-day charges on demand. Active admissions return an estimate only. After discharge the saved occupancy evidence is staged and billed with idempotent night identities. | Staff session | `billing.create` | — | — | `queries.accrueBedDaysScoped` | `src/routes/inpatient.routes.ts:826` |
| POST | `/api/admissions/:id/bed-billing-encounter` | Create action on a bed billing encounter | Staff session | `inpatient.read`, `clinical.read`, `billing.update` | — | — | `bedBilling.linkBedBillingEncounter` | `src/routes/inpatient.routes.ts:183` |
| POST | `/api/admissions/:id/bed-billing-retry` | Create action on a bed billing retry | Staff session | `inpatient.read`, `billing.create` | — | — | `queries.accrueBedDaysScoped` | `src/routes/inpatient.routes.ts:234` |
| POST | `/api/admissions/:id/bed-history-review` | Create action on a bed history review | Staff session | `inpatient.read`, `clinical.read`, `billing.update` | — | — | `bedBilling.reviewBedHistory` | `src/routes/inpatient.routes.ts:209` |
| GET | `/api/admissions/:id/bed-occupancy` | Read a bed occupancy | Staff session | `inpatient.read` | — | — | `bedBilling.getBedBillingView` | `src/routes/inpatient.routes.ts:161` |
| POST | `/api/admissions/:id/discharge` | Create action on a discharge | Staff session | `inpatient.discharge` | — | — | `queries.dischargeAdmissionScoped` | `src/routes/inpatient.routes.ts:673` |
| POST | `/api/admissions/:id/transfer` | Create action on a transfer | Staff session | `inpatient.admit` | — | — | `queries.transferAdmissionScoped` | `src/routes/inpatient.routes.ts:732` |
| GET | `/api/admissions/:id/transfers` | Read a transfer | Staff session | `inpatient.read` | — | — | `queries.getAdmissionTransfersScoped` | `src/routes/inpatient.routes.ts:796` |
| GET | `/api/admissions/:id/vitals` | Vitals history for one admission, with abnormality flags derived from adult reference ranges. | Staff session | `inpatient.read` | — | — | `nursing.getVitalsForAdmissionScoped` | `src/routes/inpatient.routes.ts:889` |
| POST | `/api/admissions/:id/vitals` | Record ward vitals against an admission. Separate from POST /api/observations so that ward care does not depend on the OPD module being enabled for the facility. | Staff session | `clinical.create` | — | — | `nursing.recordVitalsScoped` | `src/routes/inpatient.routes.ts:928` |

## /api/analytics

2 routes.

Facility module gate: `analytics`.

7 distinct permission codes are required across this prefix: `reports.read`, `billing.read`, `patients.read`, `inpatient.read`, `inventory.read`, `laboratory.read`, `theatre.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/analytics/revenue` | List revenue | Staff session | `reports.read`, `billing.read` | — | facility | `value.trim` | `src/routes/domains/billing-analytics.routes.ts:211` |
| GET | `/api/analytics/summary` | Summary | Staff session | `reports.read`, `billing.read`, `patients.read`, `inpatient.read`, `inventory.read`, `laboratory.read`, `theatre.read` | — | — | `queries.getFacilityByIdScoped` | `src/routes/domains/billing-analytics.routes.ts:353` |

## /api/appointments

10 routes.

Facility module gate: `reception`.

5 distinct permission codes are required across this prefix: `appointments.read`, `appointments.create`, `appointments.cancel`, `appointments.update`, `appointments.categories.manage`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/appointments` | List appointments | Staff session | `appointments.read` | query `appointmentListQuerySchema` | — | `listAppointmentsScoped()` | `src/routes/appointments.routes.ts:153` |
| POST | `/api/appointments` | Create an appointment | Staff session | `appointments.create` | body `createAppointmentBodySchema` | — | `createAppointmentScoped()` | `src/routes/appointments.routes.ts:167` |
| POST | `/api/appointments/:id/cancel` | Cancel | Staff session | `appointments.cancel` | body `appointmentCancelSchema` | — | `cancelAppointmentScoped()` | `src/routes/appointments.routes.ts:209` |
| POST | `/api/appointments/:id/check-in` | Create action on a check in | Staff session | `appointments.update`, `appointments.create` | body `appointmentCheckInSchema` | — | `checkInAppointmentScoped()` | `src/routes/appointments.routes.ts:254` |
| GET | `/api/appointments/:id/history` | History | Staff session | `appointments.read` | — | — | `getAppointmentHistoryScoped()` | `src/routes/appointments.routes.ts:190` |
| POST | `/api/appointments/:id/reschedule` | Create action on a reschedule | Staff session | `appointments.update`, `appointments.create` | body `appointmentRescheduleSchema` | — | `rescheduleAppointmentScoped()` | `src/routes/appointments.routes.ts:229` |
| GET | `/api/appointments/categories` | List categories | Staff session | `appointments.read` | — | — | `listAppointmentCategoriesScoped()` | `src/routes/appointments.routes.ts:99` |
| POST | `/api/appointments/categories` | Create a category | Staff session | `appointments.categories.manage` | body `appointmentCategoryBodySchema` | — | `createAppointmentCategoryScoped()` | `src/routes/appointments.routes.ts:112` |
| PATCH | `/api/appointments/categories/:id` | Update a category | Staff session | `appointments.categories.manage` | body `appointmentCategoryUpdateSchema` | — | `updateAppointmentCategoryScoped()` | `src/routes/appointments.routes.ts:132` |
| GET | `/api/appointments/resources` | List resources | Staff session | `appointments.read` | — | — | `listAppointmentResourcesScoped()` | `src/routes/appointments.routes.ts:86` |

## /api/approval-policies

4 routes.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/approval-policies` | List approvalpolicies | Staff session | — | — | facility | `policies.listPolicies` | `src/routes/approval-policy.routes.ts:118` |
| POST | `/api/approval-policies` | Create an approval policy | Staff session | — | — | facility | `policies.createPolicy` | `src/routes/approval-policy.routes.ts:154` |
| PUT | `/api/approval-policies/:id` | Update an approval policy | Staff session | — | — | facility | `policies.updatePolicy` | `src/routes/approval-policy.routes.ts:169` |
| GET | `/api/approval-policies/preview` | Preview | Staff session | — | — | facility | `policies.previewRequirement` | `src/routes/approval-policy.routes.ts:133` |

## /api/audit-logs

1 routes.

Facility module gate: `audit`.

1 distinct permission codes are required across this prefix: `audit.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/audit-logs` | List auditlogs | Staff session | `audit.read` | query `auditLogsQuerySchema` | — | `queries.getAuditLogs` | `src/routes/domains/audit.routes.ts:28` |

## /api/auth

7 routes.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/auth/facility-admin-invitations/accept` | Accept: facility admin invitations accept | Public | — | body `acceptInvitationBodySchema` | — | `validateBody()` | `src/auth/auth.routes.ts:43` |
| GET | `/api/auth/facility-admin-invitations/validate` | Public facility administrator invitation endpoints. These must be accessible before the invited user logs in. | Public | — | query `invitationTokenQuerySchema` | — | `validateQuery()` | `src/auth/auth.routes.ts:37` |
| POST | `/api/auth/login` | Public authentication endpoints | Public | — | body `loginBodySchema` | — | — | `src/auth/auth.routes.ts:25` |
| POST | `/api/auth/logout` | Logout requires the current authentication session. | Staff session | — | — | — | — | `src/auth/auth.routes.ts:73` |
| GET | `/api/auth/session` | Session validation requires a valid session. | Staff session | — | — | — | — | `src/auth/auth.routes.ts:68` |
| POST | `/api/auth/staff-invitations/accept` | Accept: staff invitations accept | Public | — | body `acceptInvitationBodySchema` | — | `validateBody()` | `src/auth/auth.routes.ts:59` |
| GET | `/api/auth/staff-invitations/validate` | Public staff invitation endpoints. Keep these public so invited staff can validate and accept their link. | Public | — | query `invitationTokenQuerySchema` | — | `validateQuery()` | `src/auth/auth.routes.ts:53` |

## /api/bank-payments

9 routes.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/bank-payments` | List bankpayments | Staff session | checked in service | — | — | `bank.listBankPayments` | `src/bank-payments/routes.ts:84` |
| POST | `/api/bank-payments` | Create a bank payment | Staff session | checked in service | — | — | `bank.submitBankPayment` | `src/bank-payments/routes.ts:93` |
| POST | `/api/bank-payments/:id/approve-and-settle` | Create action on an approve and settle | Staff session | checked in service | — | — | `facilitySchema.parse` | `src/bank-payments/routes.ts:139` |
| POST | `/api/bank-payments/:id/reject` | Reject | Staff session | checked in service | — | — | `bank.rejectBankPayment` | `src/bank-payments/routes.ts:130` |
| POST | `/api/bank-payments/:id/verify` | Verify | Staff session | checked in service | — | — | `bank.verifyBankPayment` | `src/bank-payments/routes.ts:121` |
| POST | `/api/bank-payments/accounts` | Create an account | Staff session | checked in service | — | — | `bank.saveBankAccount` | `src/bank-payments/routes.ts:100` |
| PATCH | `/api/bank-payments/accounts/:id` | Update an account | Staff session | checked in service | — | — | `bank.saveBankAccount` | `src/bank-payments/routes.ts:108` |
| GET | `/api/bank-payments/policy` | List policy | Staff session | checked in service | — | — | `bank.bankPolicy` | `src/bank-payments/routes.ts:68` |
| POST | `/api/bank-payments/policy/enable` | Create an enable | Staff session | checked in service | — | — | `facilitySchema.parse` | `src/bank-payments/routes.ts:77` |

## /api/beds

6 routes.

Facility module gate: `inpatient`.

5 distinct permission codes are required across this prefix: `inpatient.read`, `inpatient.beds.create`, `inpatient.beds.delete`, `inpatient.beds.update`, `inpatient.admit`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/beds` | List beds | Staff session | `inpatient.read` | — | — | `queries.getBedsScoped` | `src/routes/inpatient.routes.ts:506` |
| POST | `/api/beds` | Bed set-up. Beds are created in a batch because a ward is set up in one sitting: a prefix, a first number and a count, or an explicit list of numbers. | Staff session | `inpatient.beds.create` | — | — | `wardBed.createBeds` | `src/routes/inpatient.routes.ts:391` |
| DELETE | `/api/beds/:id` | Delete a bed | Staff session | `inpatient.beds.delete` | — | — | `wardBed.deleteBed` | `src/routes/inpatient.routes.ts:468` |
| PUT | `/api/beds/:id` | Update a bed | Staff session | `inpatient.beds.update` | — | — | `wardBed.updateBed` | `src/routes/inpatient.routes.ts:429` |
| PUT | `/api/beds/:id/release` | Release a cleaned bed back into service (Cleaning -> Available). Without this, every discharge permanently removes a bed from the usable board because nothing else restores 'Available'. | Staff session | `inpatient.admit` | — | — | `queries.releaseBedScoped` | `src/routes/inpatient.routes.ts:584` |
| PUT | `/api/beds/:id/status` | Change a bed's housekeeping status. 'Occupied' is rejected by the query layer: occupancy must come from an admission. A bed holding a patient cannot be changed until that patient is discharged or transferred. | Staff session | `inpatient.admit` | — | — | `queries.setBedStatusScoped` | `src/routes/inpatient.routes.ts:540` |

## /api/billing

16 routes.

7 distinct permission codes are required across this prefix: `billing.read`, `tariffs.read`, `billing.update`, `tariffs.manage`, `billing.payments.record`, `billing.refunds.record`, `billing.refunds.approve`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/billing/charge-attempts` | List charge attempts | Staff session | `billing.read`, `tariffs.read` | — | facility | `rawFacilityId.trim` | `src/routes/domains/billing-charges.routes.ts:52` |
| POST | `/api/billing/charge-attempts/:id/retry` | Create action on a retry | Staff session | `billing.update`, `tariffs.manage` | — | facility | `chargeAttempts.retryChargeAttempt` | `src/routes/domains/billing-charges.routes.ts:105` |
| POST | `/api/billing/charge-attempts/:id/void` | Create action on a void | Staff session | `billing.update`, `tariffs.manage` | — | facility | `reason.trim` | `src/routes/domains/billing-charges.routes.ts:194` |
| POST | `/api/billing/charge-attempts/retry` | Create a retry | Staff session | `billing.update`, `tariffs.manage` | — | facility | `chargeAttempts.retryPendingChargeAttempts` | `src/routes/domains/billing-charges.routes.ts:162` |
| GET | `/api/billing/lab-service-diagnostics` | List lab service diagnostics | Staff session | `tariffs.read` | — | facility | `billing.resolveTariffForCharge` | `src/routes/domains/billing-charges.routes.ts:259` |
| GET | `/api/billing/payments` | List payments | Staff session | `billing.payments.record` | query `paymentLedgerQuerySchema` | — | `value.trim` | `src/routes/domains/invoices.routes.ts:666` |
| POST | `/api/billing/payments` | Create a payment | Staff session | `billing.payments.record` | body `recordPaymentBodySchema` | — | `billingPayments.recordSettledPayment` | `src/routes/domains/invoices.routes.ts:412` |
| POST | `/api/billing/payments/cancel-pending` | Create a cancel pending | Staff session | `billing.read`, `billing.payments.record` | — | — | `billingPayments.cancelPendingPaymentRequest` | `src/routes/domains/invoices.routes.ts:473` |
| POST | `/api/billing/payments/status` | Create a status | Staff session | `billing.read`, `billing.payments.record` | — | — | `billingPayments.checkPaymentRequestStatus` | `src/routes/domains/invoices.routes.ts:451` |
| GET | `/api/billing/refund-requests` | List refund requests | Staff session | `billing.read`, `billing.refunds.record`, `billing.refunds.approve` | query `refundRequestQuerySchema` | — | `listRefundRequests()` | `src/routes/domains/invoices.routes.ts:541` |
| POST | `/api/billing/refund-requests` | Manual accounting record only; no bank, card or mobile transfer is initiated. | Staff session | `billing.read`, `billing.refunds.record` | body `refundRequestBodySchema` | — | `createRefundRequest()` | `src/routes/domains/invoices.routes.ts:496` |
| POST | `/api/billing/refund-requests/:id/decision` | Record a decision: refund requests decision | Staff session | `billing.read`, `billing.refunds.approve` | body `refundDecisionBodySchema` | — | `decideRefundRequest()` | `src/routes/domains/invoices.routes.ts:563` |
| POST | `/api/billing/refund-requests/:id/revoke` | Revoke: refund requests revoke | Staff session | `billing.read`, `billing.refunds.approve` | body `refundRevocationBodySchema` | — | `revokeRefundApproval()` | `src/routes/domains/invoices.routes.ts:586` |
| POST | `/api/billing/refund-requests/status` | Create a status | Staff session | `billing.read`, `billing.refunds.record` | body `refundStatusBodySchema` | — | `checkRefundRequestStatus()` | `src/routes/domains/invoices.routes.ts:519` |
| POST | `/api/billing/refunds` | Create a refund | Staff session | `billing.read`, `billing.refunds.record` | body `refundBodySchema` | — | `recordManualRefund()` | `src/routes/domains/invoices.routes.ts:609` |
| POST | `/api/billing/refunds/status` | Create a status | Staff session | `billing.read`, `billing.refunds.record` | body `refundStatusBodySchema` | — | `checkRefundStatus()` | `src/routes/domains/invoices.routes.ts:639` |

## /api/booking

11 routes.

Facility module gate: `website_booking`.

3 distinct permission codes are required across this prefix: `booking.manage`, `booking.clients.manage`, `booking.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/booking/admin/bookings/:id/confirm` | Create action on a confirm | Staff session | `booking.manage` | — | — | `confirmBookingScoped()` | `src/booking/booking-admin.routes.ts:99` |
| POST | `/api/booking/admin/bookings/:id/reminders` | Create action on a reminder | Staff session | `booking.manage` | — | — | `sendBookingReminderScoped()` | `src/booking/booking-admin.routes.ts:121` |
| POST | `/api/booking/admin/clients` | Create a client | Staff session | `booking.clients.manage` | — | — | `createBookingClientScoped()` | `src/booking/booking-admin.routes.ts:61` |
| POST | `/api/booking/admin/clients/:id/revoke` | Revoke: clients revoke | Staff session | `booking.clients.manage` | — | — | `revokeBookingClientScoped()` | `src/booking/booking-admin.routes.ts:75` |
| POST | `/api/booking/admin/slots` | Create a slot | Staff session | `booking.manage` | — | — | `createBookingSlotScoped()` | `src/booking/booking-admin.routes.ts:89` |
| GET | `/api/booking/admin/workspace` | List admin workspace | Staff session | `booking.read` | — | — | `getBookingAdminWorkspace()` | `src/booking/booking-admin.routes.ts:54` |
| GET | `/api/booking/v1/availability` | List v1 availability | Public | — | — | — | `getBookingAvailability()` | `src/booking/website-booking.routes.ts:37` |
| POST | `/api/booking/v1/bookings` | Create a booking | Public | — | — | — | `createWebsiteBooking()` | `src/booking/website-booking.routes.ts:50` |
| GET | `/api/booking/v1/bookings/:reference` | Read a booking | Public | — | — | — | `getWebsiteBooking()` | `src/booking/website-booking.routes.ts:61` |
| POST | `/api/booking/v1/bookings/:reference/cancel` | Cancel: bookings cancel | Public | — | — | — | `mutateWebsiteBooking()` | `src/booking/website-booking.routes.ts:94` |
| POST | `/api/booking/v1/bookings/:reference/reschedule` | Create action on a reschedule | Public | — | — | — | `mutateWebsiteBooking()` | `src/booking/website-booking.routes.ts:75` |

## /api/budget-planning

35 routes.

Facility module gate: `accounting`.

5 distinct permission codes are required across this prefix: `accounting.planning.audit`, `accounting.read`, `accounting.planning.read`, `accounting.planning.manage`, `accounting.planning.reset`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/budget-planning/audit` | Audit trail | Staff session | `accounting.planning.audit`, `accounting.read`, `accounting.planning.read` | — | — | `planning.auditHistory` | `src/budget-planning/planning.routes.ts:333` |
| GET | `/api/budget-planning/imports` | List imports | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.importHistory` | `src/budget-planning/planning.routes.ts:251` |
| POST | `/api/budget-planning/imports` | Create an import | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `Buffer.isBuffer` | `src/budget-planning/planning.routes.ts:278` |
| GET | `/api/budget-planning/imports/:id` | Read an import | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.inspectBatch` | `src/budget-planning/planning.routes.ts:306` |
| POST | `/api/budget-planning/imports/:id/cancel` | Cancel: imports cancel | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.cancelImport` | `src/budget-planning/planning.routes.ts:328` |
| POST | `/api/budget-planning/imports/:id/confirm` | Create action on a confirm | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.confirmImport` | `src/budget-planning/planning.routes.ts:316` |
| POST | `/api/budget-planning/imports/:id/preview` | Preview: imports preview | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.previewImport` | `src/budget-planning/planning.routes.ts:311` |
| GET | `/api/budget-planning/imports/:id/results` | Read a result | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `outcomes.importResults` | `src/budget-planning/planning.routes.ts:261` |
| GET | `/api/budget-planning/imports/:id/results.csv` (file) | Read a results.csv | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `outcomes.importResults` | `src/budget-planning/planning.routes.ts:265` |
| POST | `/api/budget-planning/imports/:id/retry-review` | Create action on a retry review | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.retryImportReview` | `src/budget-planning/planning.routes.ts:321` |
| GET | `/api/budget-planning/imports/summary` | Summary: imports summary | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `outcomes.importSummary` | `src/budget-planning/planning.routes.ts:257` |
| GET | `/api/budget-planning/plans` | List plans | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.listPlans` | `src/budget-planning/planning.routes.ts:128` |
| POST | `/api/budget-planning/plans` | Create a plan | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.createPlan` | `src/budget-planning/planning.routes.ts:132` |
| GET | `/api/budget-planning/plans/:id` | Read a plan | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `reports.projection` | `src/budget-planning/planning.routes.ts:137` |
| PATCH | `/api/budget-planning/plans/:id` | Update a plan | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.updatePlan` | `src/budget-planning/planning.routes.ts:156` |
| POST | `/api/budget-planning/plans/:id/categories` | Create action on a category | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.saveCategory` | `src/budget-planning/planning.routes.ts:179` |
| PATCH | `/api/budget-planning/plans/:id/categories/:recordId` | Update a category | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.saveCategory` | `src/budget-planning/planning.routes.ts:186` |
| GET | `/api/budget-planning/plans/:id/financial-budget` | Read a financial budget | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `financial.financialBudget` | `src/budget-planning/planning.routes.ts:75` |
| PUT | `/api/budget-planning/plans/:id/financial-budget` | Update a financial budget | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `financial.saveFinancialBudget` | `src/budget-planning/planning.routes.ts:79` |
| GET | `/api/budget-planning/plans/:id/financial-budget/export` | Export: financial budget export | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `financial.financialBudget` | `src/budget-planning/planning.routes.ts:101` |
| POST | `/api/budget-planning/plans/:id/financial-budget/reset` | Reset: financial budget reset | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `roles.includes` | `src/budget-planning/planning.routes.ts:86` |
| POST | `/api/budget-planning/plans/:id/items` | Create action on an item | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.saveItem` | `src/budget-planning/planning.routes.ts:193` |
| DELETE | `/api/budget-planning/plans/:id/items/:recordId` | Delete an item | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.archiveRecord` | `src/budget-planning/planning.routes.ts:207` |
| GET | `/api/budget-planning/plans/:id/items/:recordId` | Read an item | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `reports.projection` | `src/budget-planning/planning.routes.ts:145` |
| PATCH | `/api/budget-planning/plans/:id/items/:recordId` | Update an item | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.saveItem` | `src/budget-planning/planning.routes.ts:200` |
| GET | `/api/budget-planning/plans/:id/reports` | Read a report | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `reports.reportHistory` | `src/budget-planning/planning.routes.ts:340` |
| POST | `/api/budget-planning/plans/:id/reports` | Create action on a report | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `reports.createReport` | `src/budget-planning/planning.routes.ts:345` |
| POST | `/api/budget-planning/plans/:id/status` | Create action on a status | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.transaction` | `src/budget-planning/planning.routes.ts:161` |
| POST | `/api/budget-planning/plans/:id/uniforms` | Create action on an uniform | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.saveUniform` | `src/budget-planning/planning.routes.ts:222` |
| DELETE | `/api/budget-planning/plans/:id/uniforms/:recordId` | Delete an uniform | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.archiveRecord` | `src/budget-planning/planning.routes.ts:236` |
| PATCH | `/api/budget-planning/plans/:id/uniforms/:recordId` | Update an uniform | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `planning.saveUniform` | `src/budget-planning/planning.routes.ts:229` |
| GET | `/api/budget-planning/reports/:id/:format` (file) | Read a report | Staff session | `accounting.read`, `accounting.planning.read` | — | — | `reports.reportFile` | `src/budget-planning/planning.routes.ts:352` |
| GET | `/api/budget-planning/reset` | Reset | Staff session | `accounting.planning.manage`, `accounting.planning.reset` | — | facility | `assert()` | `src/budget-planning/planning-reset.routes.ts:39` |
| POST | `/api/budget-planning/reset/execute` | Execute: reset execute | Staff session | `accounting.planning.manage`, `accounting.planning.reset` | — | facility | `assert()` | `src/budget-planning/planning-reset.routes.ts:99` |
| POST | `/api/budget-planning/reset/preview` | Preview: reset preview | Staff session | `accounting.planning.manage`, `accounting.planning.reset` | — | facility | `assert()` | `src/budget-planning/planning-reset.routes.ts:69` |

## /api/claims

7 routes.

Facility module gate: `insurance`.

4 distinct permission codes are required across this prefix: `insurance.read`, `billing.read`, `insurance.claims.create`, `insurance.claims.manage`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/claims` | List claims | Staff session | `insurance.read`, `billing.read` | — | — | `insuranceClaims.getClaimsScoped` | `src/routes/domains/claims.routes.ts:62` |
| POST | `/api/claims` | Create a claim | Staff session | `insurance.claims.create` | body `draftClaimBodySchema` | — | `insuranceClaims.draftClaimScoped` | `src/routes/domains/claims.routes.ts:167` |
| POST | `/api/claims/:id/adjudicate` | Create action on an adjudicate | Staff session | `insurance.claims.manage` | body `adjudicateClaimBodySchema` | — | `insuranceClaims.adjudicateClaimScoped` | `src/routes/domains/claims.routes.ts:233` |
| GET | `/api/claims/:id/items` | Read an item | Staff session | `insurance.read`, `billing.read` | — | — | `insuranceClaims.getClaimItemsScoped` | `src/routes/domains/claims.routes.ts:133` |
| POST | `/api/claims/:id/settle` | Settle | Staff session | `insurance.claims.manage` | body `claimOptionalFacilityBodySchema` | — | `insuranceClaims.settleClaimScoped` | `src/routes/domains/claims.routes.ts:272` |
| PUT | `/api/claims/:id/status` | Update a status | Staff session | `insurance.claims.manage` | — | — | `status.trim` | `src/routes/domains/claims.routes.ts:315` |
| POST | `/api/claims/:id/submit` | Submit | Staff session | `insurance.claims.create` | body `claimOptionalFacilityBodySchema` | — | `insuranceClaims.submitClaimScoped` | `src/routes/domains/claims.routes.ts:197` |

## /api/compliance

2 routes.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/compliance/dha` | List dha | Staff session | checked in service | — | — | `buildDhaScore()` | `src/compliance/compliance.routes.ts:43` |
| GET | `/api/compliance/dha/requirements/:id` | Read a requirement | Staff session | checked in service | — | — | `DHA_REQUIREMENTS.find` | `src/compliance/compliance.routes.ts:80` |

## /api/dashboard

2 routes.

3 distinct permission codes are required across this prefix: `patients.read`, `billing.read`, `tariffs.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/dashboard/overview` | Overview | Staff session | checked in service | — | — | `facilityId()` | `src/dashboard/dashboard.routes.ts:50` |
| POST | `/api/dashboard/search` | POST keeps search terms out of URLs, reverse-proxy access logs and browser history. | Staff session | `patients.read`, `billing.read`, `tariffs.read` | — | — | `term.trim` | `src/dashboard/dashboard.routes.ts:71` |

## /api/departments

1 routes.

1 distinct permission codes are required across this prefix: `patients.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/departments` | List departments | Staff session | `patients.read` | — | — | `queries.getDepartmentsScoped` | `src/routes/domains/tenancy.routes.ts:183` |

## /api/diagnoses

2 routes.

Facility module gate: `opd`.

2 distinct permission codes are required across this prefix: `clinical.read`, `clinical.create`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/diagnoses` | List diagnoses | Staff session | `clinical.read` | — | — | `queries.getDiagnosesScoped` | `src/routes/diagnoses.routes.ts:25` |
| POST | `/api/diagnoses` | Create a diagnose | Staff session | `clinical.create` | — | — | `queries.recordDiagnosisScoped` | `src/routes/diagnoses.routes.ts:59` |

## /api/dialysis

16 routes.

Facility module gate: `dialysis`.

11 distinct permission codes are required across this prefix: `dialysis.adverse_events.manage`, `dialysis.assessments.manage`, `dialysis.machines.manage`, `dialysis.protocols.manage`, `dialysis.schedule.manage`, `appointments.cancel`, `dialysis.sessions.record`, `billing.create`, `inventory.manage`, `dialysis.plans.authorize`, `dialysis.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/dialysis/adverse-events/:id/follow-up` | Create action on a follow up | Staff session | `dialysis.adverse_events.manage` | — | — | `followUpAdverseEventScoped()` | `src/routes/dialysis.routes.ts:307` |
| POST | `/api/dialysis/assessments` | Create an assessment | Staff session | `dialysis.assessments.manage` | — | — | `createAssessmentScoped()` | `src/routes/dialysis.routes.ts:126` |
| POST | `/api/dialysis/machines` | Create a machine | Staff session | `dialysis.machines.manage` | — | — | `createMachineScoped()` | `src/routes/dialysis.routes.ts:94` |
| PATCH | `/api/dialysis/machines/:id/status` | Update a status | Staff session | `dialysis.machines.manage` | — | — | `setMachineStatusScoped()` | `src/routes/dialysis.routes.ts:108` |
| POST | `/api/dialysis/protocols` | Create a protocol | Staff session | `dialysis.protocols.manage` | — | — | `approveProtocolScoped()` | `src/routes/dialysis.routes.ts:80` |
| POST | `/api/dialysis/schedules` | Create a schedule | Staff session | `dialysis.schedule.manage` | — | — | `scheduleDialysisScoped()` | `src/routes/dialysis.routes.ts:169` |
| POST | `/api/dialysis/schedules/:id/cancel` | Cancel: schedules cancel | Staff session | `dialysis.schedule.manage`, `appointments.cancel` | — | — | `cancelDialysisScheduleScoped()` | `src/routes/dialysis.routes.ts:184` |
| POST | `/api/dialysis/schedules/:id/start` | Create action on a start | Staff session | `dialysis.sessions.record` | body `facilityActionBodySchema` | — | `startDialysisSessionScoped()` | `src/routes/dialysis.routes.ts:202` |
| POST | `/api/dialysis/sessions/:id/adverse-events` | Create action on an adverse event | Staff session | `dialysis.adverse_events.manage` | — | — | `recordAdverseEventScoped()` | `src/routes/dialysis.routes.ts:289` |
| POST | `/api/dialysis/sessions/:id/bill` | Billing a session is a finance action, not a clinical one: the ward clerk who recorded the session should not also decide what it costs. It therefore needs the billing permission rather than the dialysis recording permission. | Staff session | `billing.create` | — | — | `billDialysisSessionScoped()` | `src/routes/dialysis.routes.ts:271` |
| POST | `/api/dialysis/sessions/:id/complete` | Complete: sessions complete | Staff session | `dialysis.sessions.record` | — | — | `completeDialysisSessionScoped()` | `src/routes/dialysis.routes.ts:248` |
| POST | `/api/dialysis/sessions/:id/consumables` | Create action on a consumable | Staff session | `dialysis.sessions.record`, `inventory.manage` | — | — | `recordConsumableScoped()` | `src/routes/dialysis.routes.ts:233` |
| POST | `/api/dialysis/sessions/:id/observations` | Create action on an observation | Staff session | `dialysis.sessions.record` | — | — | `addSessionObservationScoped()` | `src/routes/dialysis.routes.ts:215` |
| POST | `/api/dialysis/treatment-plans` | Create a treatment plan | Staff session | `dialysis.assessments.manage` | — | — | `createPlanScoped()` | `src/routes/dialysis.routes.ts:140` |
| POST | `/api/dialysis/treatment-plans/:id/authorize` | Create action on an authorize | Staff session | `dialysis.plans.authorize` | body `facilityActionBodySchema` | — | `authorizePlanScoped()` | `src/routes/dialysis.routes.ts:154` |
| GET | `/api/dialysis/workspace` | List workspace | Staff session | `dialysis.read` | — | — | `getDialysisWorkspaceScoped()` | `src/routes/dialysis.routes.ts:73` |

## /api/documents

8 routes.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/documents/admissions/:admissionId/discharge-summary.pdf` | Read a discharge summary.pdf | Staff session | — | — | — | `sendDocument()` | `src/documents/document.routes.ts:144` |
| GET | `/api/documents/credit-notes/:refundId/pdf` | Read a pdf | Staff session | — | — | — | `sendDocument()` | `src/documents/document.routes.ts:114` |
| GET | `/api/documents/goods-received-notes/:grnId/pdf` | Read a pdf | Staff session | — | — | — | `sendDocument()` | `src/documents/document.routes.ts:126` |
| GET | `/api/documents/invoices/:invoiceId/pdf` | Read a pdf | Staff session | — | — | — | `sendDocument()` | `src/documents/document.routes.ts:102` |
| GET | `/api/documents/laboratory-orders/:orderId/pdf` | Read a pdf | Staff session | — | — | — | `sendDocument()` | `src/documents/document.routes.ts:132` |
| GET | `/api/documents/purchase-orders/:purchaseOrderId/pdf` | Read a pdf | Staff session | — | — | — | `sendDocument()` | `src/documents/document.routes.ts:120` |
| GET | `/api/documents/radiology-orders/:orderId/pdf` | Read a pdf | Staff session | — | — | — | `sendDocument()` | `src/documents/document.routes.ts:138` |
| GET | `/api/documents/receipts/:paymentId/pdf` | Read a pdf | Staff session | — | — | — | `sendDocument()` | `src/documents/document.routes.ts:106` |

## /api/encounters

4 routes.

Facility module gate: `opd`.

3 distinct permission codes are required across this prefix: `clinical.read`, `clinical.create`, `clinical.update`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/encounters` | List encounters | Staff session | `clinical.read` | — | — | `queries.getEncountersScoped` | `src/routes/domains/encounters.routes.ts:42` |
| POST | `/api/encounters` | Create an encounter | Staff session | `clinical.create` | — | — | `status.trim` | `src/routes/domains/encounters.routes.ts:87` |
| PUT | `/api/encounters/:id` | Update an encounter | Staff session | `clinical.update` | — | — | `queries.updateEncounterScoped` | `src/routes/domains/encounters.routes.ts:161` |
| POST | `/api/encounters/:id/consultation-selection` | Create action on a consultation selection | Staff session | `clinical.update` | — | — | `queries.selectEncounterConsultation` | `src/routes/domains/encounters.routes.ts:134` |

## /api/facilities

4 routes.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/facilities` | List facilities | Staff session | checked in service | query `facilitiesListQuerySchema` | — | `queries.getFacilitiesScoped` | `src/routes/domains/tenancy.routes.ts:105` |
| GET | `/api/facilities/:id` | Read a facility | Staff session | checked in service | — | — | `queries.getFacilityByIdScoped` | `src/routes/domains/tenancy.routes.ts:141` |
| GET | `/api/facilities/:id/modules` | Read a module | Staff session | checked in service | — | — | `queries.getFacilityByIdScoped` | `src/config/facility-modules.routes.ts:98` |
| PATCH | `/api/facilities/:id/modules` | Update a module | Staff session | checked in service | — | — | `enabledModules.every` | `src/config/facility-modules.routes.ts:160` |

## /api/facility-branding

8 routes.

2 distinct permission codes are required across this prefix: `facility.branding.read`, `facility.branding.manage`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/facility-branding/facilities/:facilityId/letterheads` | Read a letterhead | Staff session | `facility.branding.read` | — | — | `listLetterheads()` | `src/branding/letterhead.routes.ts:127` |
| POST | `/api/facility-branding/facilities/:facilityId/letterheads` (file) | Create action on a letterhead | Staff session | `facility.branding.manage` | — | — | `Buffer.isBuffer` | `src/branding/letterhead.routes.ts:142` |
| GET | `/api/facility-branding/facilities/:facilityId/letterheads/:letterheadId` | Read a letterhead | Staff session | `facility.branding.read` | — | — | `loadScoped()` | `src/branding/letterhead.routes.ts:234` |
| PATCH | `/api/facility-branding/facilities/:facilityId/letterheads/:letterheadId` | Update a letterhead | Staff session | `facility.branding.manage` | — | — | `loadScoped()` | `src/branding/letterhead.routes.ts:381` |
| POST | `/api/facility-branding/facilities/:facilityId/letterheads/:letterheadId/activate` | Activate: letterheads activate | Staff session | `facility.branding.manage` | — | — | `loadScoped()` | `src/branding/letterhead.routes.ts:412` |
| GET | `/api/facility-branding/facilities/:facilityId/letterheads/:letterheadId/file` (file) | The stored PDF, for preview and for download. `?download=1` asks the browser to save it rather than display it; the preview uses the default. The response is never cacheable: it is tenant data behind a session, and a shared workstation must | Staff session | `facility.branding.read` | — | — | `loadScoped()` | `src/branding/letterhead.routes.ts:254` |
| GET | `/api/facility-branding/facilities/:facilityId/letterheads/:letterheadId/preview-document` (file) | Preview an ACTUAL document on a candidate letterhead, before activation. Showing the letterhead PDF on its own answers "what does the paper look like". It does not answer the question that decides whether to activate: "does my invoice still | Staff session | `facility.branding.read` | — | — | `loadScoped()` | `src/branding/letterhead.routes.ts:295` |
| POST | `/api/facility-branding/facilities/:facilityId/letterheads/:letterheadId/withdraw` | Create action on a withdraw | Staff session | `facility.branding.manage` | — | — | `loadScoped()` | `src/branding/letterhead.routes.ts:428` |

## /api/facility-services

10 routes.

9 distinct permission codes are required across this prefix: `tariffs.read`, `tariffs.manage`, `clinical.read`, `laboratory.read`, `radiology.read`, `pharmacy.read`, `inpatient.read`, `maternity.read`, `billing.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/facility-services` | List facilityservices | Staff session | `tariffs.read` | — | — | `resolveTariffFacility()` | `src/routes/facility-services.routes.ts:366` |
| POST | `/api/facility-services` | Create a facility service | Staff session | `tariffs.manage` | — | — | `createServiceInput.safeParse` | `src/routes/facility-services.routes.ts:391` |
| PUT | `/api/facility-services/:id` | Update a facility service | Staff session | `tariffs.manage` | — | — | `updateServiceInput.safeParse` | `src/routes/facility-services.routes.ts:416` |
| DELETE | `/api/facility-services/:id/permanent` | Delete a permanent | Staff session | `tariffs.manage` | — | — | `db.transaction` | `src/routes/facility-services.routes.ts:559` |
| PATCH | `/api/facility-services/:id/status` | Update a status | Staff session | `tariffs.manage` | — | — | `db.transaction` | `src/routes/facility-services.routes.ts:509` |
| GET | `/api/facility-services/available` | List available | Staff session | `clinical.read`, `laboratory.read`, `radiology.read`, `pharmacy.read`, `inpatient.read`, `maternity.read`, `billing.read`, `tariffs.read` | — | — | `category.toUpperCase` | `src/routes/facility-services.routes.ts:188` |
| GET | `/api/facility-services/export` | Export | Staff session | `tariffs.read` | — | — | `resolveTariffFacility()` | `src/routes/facility-services.routes.ts:350` |
| POST | `/api/facility-services/import` | Import | Staff session | `tariffs.manage` | — | — | `resolveTariffFacility()` | `src/routes/facility-services.routes.ts:310` |
| POST | `/api/facility-services/import/status` | Create a status | Staff session | `tariffs.manage` | — | — | `resolveTariffFacility()` | `src/routes/facility-services.routes.ts:326` |
| POST | `/api/facility-services/import/validate` | Validate: import validate | Staff session | `tariffs.manage` | — | — | `resolveTariffFacility()` | `src/routes/facility-services.routes.ts:295` |

## /api/facility-tariffs

8 routes.

8 distinct permission codes are required across this prefix: `tariffs.read`, `tariffs.manage`, `clinical.read`, `laboratory.read`, `radiology.read`, `pharmacy.read`, `inpatient.read`, `billing.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/facility-tariffs` | List facilitytariffs | Staff session | `tariffs.read` | — | — | `resolveTariffFacility()` | `src/routes/facility-services.routes.ts:651` |
| POST | `/api/facility-tariffs` | Create a facility tariff | Staff session | `tariffs.manage` | — | — | `tariffWrite()` | `src/routes/facility-services.routes.ts:977` |
| DELETE | `/api/facility-tariffs/:id` | Delete a facility tariff | Staff session | `tariffs.manage` | — | — | `db.transaction` | `src/routes/facility-services.routes.ts:1091` |
| PUT | `/api/facility-tariffs/:id` | Update a facility tariff | Staff session | `tariffs.manage` | — | — | `tariffWrite()` | `src/routes/facility-services.routes.ts:982` |
| GET | `/api/facility-tariffs/:id/history` | History | Staff session | `tariffs.read` | — | — | `db.transaction` | `src/routes/facility-services.routes.ts:679` |
| DELETE | `/api/facility-tariffs/:id/permanent` | Delete a permanent | Staff session | `tariffs.manage` | — | — | `db.transaction` | `src/routes/facility-services.routes.ts:1037` |
| PATCH | `/api/facility-tariffs/:id/status` | Update a status | Staff session | `tariffs.manage` | — | — | `db.transaction` | `src/routes/facility-services.routes.ts:987` |
| GET | `/api/facility-tariffs/by-service-code/:code` | Read a by service code | Staff session | `clinical.read`, `laboratory.read`, `radiology.read`, `pharmacy.read`, `inpatient.read`, `billing.read`, `tariffs.read` | — | — | `code.safeParse` | `src/routes/facility-services.routes.ts:777` |

## /api/fixed-assets

56 routes.

10 distinct permission codes are required across this prefix: `assets.read`, `assets.manage`, `assets.dispose`, `assets.transfer`, `assets.depreciate`, `assets.depreciation.approve`, `assets.inspections.perform`, `assets.maintenance.manage`, `assets.reports.financial`, `assets.depreciation.configure`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/fixed-assets` | List fixedassets | Staff session | `assets.read` | — | facility | `assets.listAssets` | `src/routes/fixed-assets.routes.ts:170` |
| POST | `/api/fixed-assets` | Create a fixed asset | Staff session | `assets.manage` | — | facility | `assets.createAsset` | `src/routes/fixed-assets.routes.ts:297` |
| GET | `/api/fixed-assets/:id` | Read a fixed asset | Staff session | `assets.read` | — | facility | `assets.assetDetail` | `src/routes/fixed-assets.routes.ts:1123` |
| PUT | `/api/fixed-assets/:id` | Update a fixed asset | Staff session | `assets.manage` | — | facility | `assets.updateAsset` | `src/routes/fixed-assets.routes.ts:308` |
| POST | `/api/fixed-assets/:id/dispose` | Create action on a dispose | Staff session | `assets.dispose` | — | facility | `assets.disposeAsset` | `src/routes/fixed-assets.routes.ts:338` |
| GET | `/api/fixed-assets/:id/documents` | Read a document | Staff session | `assets.read` | — | facility | `maintenance.listAssetDocuments` | `src/routes/fixed-assets.routes.ts:954` |
| POST | `/api/fixed-assets/:id/documents` | Create action on a document | Staff session | `assets.manage` | — | facility | `maintenance.uploadAssetDocument` | `src/routes/fixed-assets.routes.ts:970` |
| POST | `/api/fixed-assets/:id/impair` | Impairment and revaluation are accounting judgements that move money between the register and the ledger, so they are gated with `assets.dispose` — the write-off authority — not with register-edit rights. | Staff session | `assets.dispose` | — | facility | `assets.impairAsset` | `src/routes/fixed-assets.routes.ts:360` |
| GET | `/api/fixed-assets/:id/operations` | Read an operation | Staff session | `assets.read` | — | facility | `maintenance.assetOperations` | `src/routes/fixed-assets.routes.ts:938` |
| POST | `/api/fixed-assets/:id/revalue` | Create action on a revalue | Staff session | `assets.dispose` | — | facility | `assets.revalueAsset` | `src/routes/fixed-assets.routes.ts:377` |
| POST | `/api/fixed-assets/:id/status` | Create action on a status | Staff session | `assets.manage` | — | facility | `maintenance.changeAssetStatus` | `src/routes/fixed-assets.routes.ts:921` |
| POST | `/api/fixed-assets/:id/transfer` | Create action on a transfer | Staff session | `assets.transfer` | — | facility | `assets.transferAsset` | `src/routes/fixed-assets.routes.ts:321` |
| GET | `/api/fixed-assets/categories` | List categories | Staff session | `assets.read` | — | facility | `assets.listCategories` | `src/routes/fixed-assets.routes.ts:141` |
| POST | `/api/fixed-assets/categories` | Create a category | Staff session | `assets.manage` | — | facility | `assets.createCategory` | `src/routes/fixed-assets.routes.ts:155` |
| GET | `/api/fixed-assets/dashboard` | List dashboard | Staff session | `assets.read` | — | facility | `maintenance.assetCounters` | `src/routes/fixed-assets.routes.ts:1021` |
| GET | `/api/fixed-assets/depreciation/batches` | List depreciation batches | Staff session | `assets.read` | — | facility | `batches.listDepreciationBatches` | `src/routes/fixed-assets.routes.ts:470` |
| POST | `/api/fixed-assets/depreciation/batches` | Create a batche | Staff session | `assets.depreciate` | — | facility | `batches.prepareDepreciationBatch` | `src/routes/fixed-assets.routes.ts:525` |
| DELETE | `/api/fixed-assets/depreciation/batches/:batchId` | Delete a batche | Staff session | `assets.depreciate` | — | facility | `batches.discardDepreciationBatch` | `src/routes/fixed-assets.routes.ts:606` |
| GET | `/api/fixed-assets/depreciation/batches/:batchId` | Read a batche | Staff session | `assets.read` | — | facility | `batches.getDepreciationBatch` | `src/routes/fixed-assets.routes.ts:489` |
| POST | `/api/fixed-assets/depreciation/batches/:batchId/approve` | Approve: batches approve | Staff session | `assets.depreciation.approve` | — | facility | `batches.approveDepreciationBatch` | `src/routes/fixed-assets.routes.ts:540` |
| POST | `/api/fixed-assets/depreciation/batches/:batchId/post` | Post: batches post | Staff session | `assets.depreciation.approve` | — | facility | `batches.postDepreciationBatch` | `src/routes/fixed-assets.routes.ts:562` |
| POST | `/api/fixed-assets/depreciation/batches/:batchId/reverse` | Reverse: batches reverse | Staff session | `assets.depreciation.approve` | — | facility | `batches.reverseDepreciationBatch` | `src/routes/fixed-assets.routes.ts:584` |
| POST | `/api/fixed-assets/depreciation/batches/preview` | Preview: batches preview | Staff session | `assets.read` | — | facility | `batches.previewDepreciationBatch` | `src/routes/fixed-assets.routes.ts:510` |
| GET | `/api/fixed-assets/depreciation/preview` | Preview: depreciation preview | Staff session | `assets.read` | — | facility | `assets.depreciationPreview` | `src/routes/fixed-assets.routes.ts:198` |
| POST | `/api/fixed-assets/depreciation/run` | Create a run | Staff session | `assets.depreciate` | — | facility | `assets.runDepreciation` | `src/routes/fixed-assets.routes.ts:212` |
| GET | `/api/fixed-assets/depreciation/schedule/:assetId` | Read a schedule | Staff session | `assets.read` | — | facility | `batches.assetDepreciationSchedule` | `src/routes/fixed-assets.routes.ts:627` |
| GET | `/api/fixed-assets/documents/:documentId` | Read a document | Staff session | `assets.read` | — | facility | `maintenance.getAssetDocument` | `src/routes/fixed-assets.routes.ts:987` |
| GET | `/api/fixed-assets/inspections` | List inspections | Staff session | `assets.read` | — | facility | `maintenance.listInspections` | `src/routes/fixed-assets.routes.ts:845` |
| POST | `/api/fixed-assets/inspections` | Create an inspection | Staff session | `assets.inspections.perform` | — | facility | `maintenance.createInspection` | `src/routes/fixed-assets.routes.ts:866` |
| POST | `/api/fixed-assets/inspections/:id/complete` | Complete: inspections complete | Staff session | `assets.inspections.perform` | — | facility | `maintenance.completeInspection` | `src/routes/fixed-assets.routes.ts:881` |
| GET | `/api/fixed-assets/lifecycle` | List lifecycle | Staff session | `assets.read` | — | facility | `maintenance.listLifecycleEvents` | `src/routes/fixed-assets.routes.ts:902` |
| GET | `/api/fixed-assets/maintenance` | List maintenance | Staff session | `assets.read` | — | facility | `assets.listMaintenance` | `src/routes/fixed-assets.routes.ts:232` |
| POST | `/api/fixed-assets/maintenance` | Create a maintenance | Staff session | `assets.manage` | — | facility | `assets.createMaintenance` | `src/routes/fixed-assets.routes.ts:251` |
| POST | `/api/fixed-assets/maintenance/:id/complete` | Complete: maintenance complete | Staff session | `assets.manage` | — | facility | `assets.completeMaintenance` | `src/routes/fixed-assets.routes.ts:266` |
| POST | `/api/fixed-assets/maintenance/:id/complete-corrective` | Create action on a complete corrective | Staff session | `assets.maintenance.manage` | — | facility | `maintenance.completeCorrectiveMaintenance` | `src/routes/fixed-assets.routes.ts:807` |
| POST | `/api/fixed-assets/maintenance/:id/verify` | Verify: maintenance verify | Staff session | `assets.maintenance.manage` | — | facility | `maintenance.verifyMaintenance` | `src/routes/fixed-assets.routes.ts:824` |
| POST | `/api/fixed-assets/maintenance/corrective` | Create a corrective | Staff session | `assets.maintenance.manage` | — | facility | `maintenance.createCorrectiveMaintenance` | `src/routes/fixed-assets.routes.ts:792` |
| GET | `/api/fixed-assets/maintenance/dashboard` | List maintenance dashboard | Staff session | `assets.read` | — | facility | `maintenance.maintenanceDashboard` | `src/routes/fixed-assets.routes.ts:778` |
| GET | `/api/fixed-assets/maintenance/jobs` | List maintenance jobs | Staff session | `assets.read` | — | facility | `maintenance.listMaintenanceJobs` | `src/routes/fixed-assets.routes.ts:758` |
| GET | `/api/fixed-assets/maintenance/schedules` | List maintenance schedules | Staff session | `assets.read` | — | facility | `maintenance.listMaintenanceSchedules` | `src/routes/fixed-assets.routes.ts:657` |
| POST | `/api/fixed-assets/maintenance/schedules` | Create a schedule | Staff session | `assets.maintenance.manage` | — | facility | `maintenance.createMaintenanceSchedule` | `src/routes/fixed-assets.routes.ts:677` |
| PUT | `/api/fixed-assets/maintenance/schedules/:scheduleId` | Update a schedule | Staff session | `assets.maintenance.manage` | — | facility | `maintenance.updateMaintenanceSchedule` | `src/routes/fixed-assets.routes.ts:692` |
| POST | `/api/fixed-assets/maintenance/schedules/:scheduleId/complete` | Complete: schedules complete | Staff session | `assets.maintenance.manage` | — | facility | `maintenance.completeScheduledMaintenance` | `src/routes/fixed-assets.routes.ts:736` |
| POST | `/api/fixed-assets/maintenance/schedules/:scheduleId/retire` | Create action on a retire | Staff session | `assets.maintenance.manage` | — | facility | `maintenance.retireMaintenanceSchedule` | `src/routes/fixed-assets.routes.ts:714` |
| GET | `/api/fixed-assets/options` | Reference options | Staff session | `assets.read` | — | facility | `assets.assetOptions` | `src/routes/fixed-assets.routes.ts:127` |
| GET | `/api/fixed-assets/overview` | Overview | Staff session | `assets.read` | — | facility | `assets.assetOverview` | `src/routes/fixed-assets.routes.ts:113` |
| GET | `/api/fixed-assets/report` | List report | Staff session | `assets.read` | — | facility | `assets.assetRegisterReport` | `src/routes/fixed-assets.routes.ts:188` |
| GET | `/api/fixed-assets/reports` | List reports | Staff session | `assets.read` | — | — | `ASSET_REPORTS.map` | `src/routes/fixed-assets.routes.ts:1040` |
| POST | `/api/fixed-assets/reports/:key` | Create action on a report | Staff session | `assets.reports.financial` | — | facility | `reports.buildAssetReport` | `src/routes/fixed-assets.routes.ts:1069` |
| POST | `/api/fixed-assets/reports/:key/export` | Export: reports export | Staff session | `assets.reports.financial` | — | facility | `reports.buildAssetReport` | `src/routes/fixed-assets.routes.ts:1090` |
| GET | `/api/fixed-assets/settings` | List settings | Staff session | `assets.read` | — | facility | `batches.getDepreciationSettings` | `src/routes/fixed-assets.routes.ts:441` |
| PUT | `/api/fixed-assets/settings` | Update a setting | Staff session | `assets.depreciation.configure` | — | facility | `batches.updateDepreciationSettings` | `src/routes/fixed-assets.routes.ts:455` |
| GET | `/api/fixed-assets/tax/rates` | List tax rates | Staff session | `assets.read` | — | facility | `assets.listTaxRates` | `src/routes/fixed-assets.routes.ts:394` |
| POST | `/api/fixed-assets/tax/rates` | Create a rate | Staff session | `assets.manage` | — | facility | `assets.createTaxRate` | `src/routes/fixed-assets.routes.ts:408` |
| GET | `/api/fixed-assets/tax/schedule` | List tax schedule | Staff session | `assets.read` | — | facility | `assets.taxDepreciationSchedule` | `src/routes/fixed-assets.routes.ts:423` |
| GET | `/api/fixed-assets/transfers` | List transfers | Staff session | `assets.read` | — | facility | `assets.listTransfers` | `src/routes/fixed-assets.routes.ts:283` |

## /api/health

1 routes.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/health` | List health | Public | — | — | — | — | `src/routes/system.routes.ts:71` |

## /api/hr

24 routes.

3 distinct permission codes are required across this prefix: `hr.read`, `hr.manage`, `hr.approve`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/hr/attendance` | List attendance | Staff session | `hr.read` | — | facility | `workforce.attendanceForDate` | `src/routes/workforce.routes.ts:403` |
| POST | `/api/hr/attendance` | Create an attendance | Staff session | `hr.manage` | — | facility | `workforce.recordAttendance` | `src/routes/workforce.routes.ts:421` |
| GET | `/api/hr/departments` | List departments | Staff session | `hr.read` | — | facility | `workforce.listDepartments` | `src/routes/workforce.routes.ts:181` |
| POST | `/api/hr/departments` | Create a department | Staff session | `hr.manage` | — | facility | `workforce.createDepartment` | `src/routes/workforce.routes.ts:195` |
| PUT | `/api/hr/departments/:id` | Update a department | Staff session | `hr.manage` | — | facility | `workforce.updateDepartment` | `src/routes/workforce.routes.ts:209` |
| GET | `/api/hr/designations` | List designations | Staff session | `hr.read` | — | facility | `workforce.listDesignations` | `src/routes/workforce.routes.ts:225` |
| POST | `/api/hr/designations` | Create a designation | Staff session | `hr.manage` | — | facility | `workforce.createDesignation` | `src/routes/workforce.routes.ts:239` |
| GET | `/api/hr/employees` | List employees | Staff session | `hr.read` | — | facility | `workforce.listEmployees` | `src/routes/workforce.routes.ts:257` |
| POST | `/api/hr/employees` | Create an employee | Staff session | `hr.manage` | — | facility | `workforce.createEmployee` | `src/routes/workforce.routes.ts:298` |
| GET | `/api/hr/employees/:id` | Read an employee | Staff session | `hr.read` | — | facility | `workforce.employeeDetail` | `src/routes/workforce.routes.ts:282` |
| PUT | `/api/hr/employees/:id` | Update an employee | Staff session | `hr.manage` | — | facility | `workforce.employeeDetail` | `src/routes/workforce.routes.ts:313` |
| POST | `/api/hr/employees/:id/documents` | Create action on a document | Staff session | `hr.manage` | — | facility | `workforce.addEmployeeDocument` | `src/routes/workforce.routes.ts:355` |
| POST | `/api/hr/employees/:id/status` | Create action on a status | Staff session | `hr.manage` | — | facility | `workforce.changeEmployeeStatus` | `src/routes/workforce.routes.ts:339` |
| GET | `/api/hr/leave-balances` | List leave balances | Staff session | `hr.read` | — | facility | `workforce.leaveBalances` | `src/routes/workforce.routes.ts:517` |
| GET | `/api/hr/leave-requests` | List leave requests | Staff session | `hr.read` | — | facility | `workforce.listLeaveRequests` | `src/routes/workforce.routes.ts:498` |
| POST | `/api/hr/leave-requests` | Create a leave request | Staff session | `hr.manage` | — | facility | `workforce.createLeaveRequest` | `src/routes/workforce.routes.ts:531` |
| POST | `/api/hr/leave-requests/:id/decide` | Create action on a decide | Staff session | `hr.approve` | — | facility | `workforce.decideLeaveRequest` | `src/routes/workforce.routes.ts:545` |
| GET | `/api/hr/leave-types` | List leave types | Staff session | `hr.read` | — | facility | `workforce.listLeaveTypes` | `src/routes/workforce.routes.ts:470` |
| POST | `/api/hr/leave-types` | Create a leave type | Staff session | `hr.manage` | — | facility | `workforce.createLeaveType` | `src/routes/workforce.routes.ts:484` |
| GET | `/api/hr/overview` | Overview | Staff session | `hr.read` | — | facility | `workforce.workforceOverview` | `src/routes/workforce.routes.ts:167` |
| GET | `/api/hr/roster` | List roster | Staff session | `hr.read` | — | facility | `workforce.listRoster` | `src/routes/workforce.routes.ts:435` |
| POST | `/api/hr/roster` | Create a roster | Staff session | `hr.manage` | — | facility | `workforce.saveRosterEntry` | `src/routes/workforce.routes.ts:452` |
| GET | `/api/hr/shifts` | List shifts | Staff session | `hr.read` | — | facility | `workforce.listShifts` | `src/routes/workforce.routes.ts:375` |
| POST | `/api/hr/shifts` | Create a shift | Staff session | `hr.manage` | — | facility | `workforce.createShift` | `src/routes/workforce.routes.ts:389` |

## /api/icd11

4 routes.

3 distinct permission codes are required across this prefix: `clinical.read`, `clinical.icd11.read`, `clinical.icd11.manage`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/icd11/mappings/:code` | Mappings are facility-specific clinician reviews, never automatic conversions. | Staff session | `clinical.read`, `clinical.icd11.read` | — | — | `scopedFacility()` | `src/clinical/icd11/icd11.routes.ts:71` |
| POST | `/api/icd11/mappings/:code/review` | Create action on a review | Staff session | `clinical.icd11.manage` | — | — | `icd10Title.trim` | `src/clinical/icd11/icd11.routes.ts:105` |
| GET | `/api/icd11/search` | Search | Staff session | `clinical.read`, `clinical.icd11.read` | — | — | `searchIcd11Catalogue()` | `src/clinical/icd11/icd11.routes.ts:56` |
| GET | `/api/icd11/status` | List status | Staff session | `clinical.read`, `clinical.icd11.read` | — | — | `fail()` | `src/clinical/icd11/icd11.routes.ts:48` |

## /api/immunisation

5 routes.

Facility module gate: `maternity`.

2 distinct permission codes are required across this prefix: `maternity.read`, `maternity.create`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/immunisation/card` | List card | Staff session | `maternity.read` | — | — | `immunisation.immunisationCard` | `src/routes/maternal-health.routes.ts:562` |
| GET | `/api/immunisation/due` | List due | Staff session | `maternity.read` | — | — | `immunisation.immunisationDueList` | `src/routes/maternal-health.routes.ts:661` |
| GET | `/api/immunisation/records` | List records | Staff session | `maternity.read` | — | — | `immunisation.listImmunisationRecords` | `src/routes/maternal-health.routes.ts:599` |
| POST | `/api/immunisation/records` | Create a record | Staff session | `maternity.create` | — | — | `immunisation.recordImmunisation` | `src/routes/maternal-health.routes.ts:636` |
| GET | `/api/immunisation/schedule` | The reference schedule, straight from the module that computes against it. The screen reads its antigen list from here rather than carrying a second copy that would drift the first time a dose is added. | Staff session | `maternity.read` | — | — | — | `src/routes/maternal-health.routes.ts:547` |

## /api/inpatient

4 routes.

Facility module gate: `inpatient`.

5 distinct permission codes are required across this prefix: `inpatient.read`, `inpatient.wards.update`, `billing.update`, `billing.read`, `billing.create`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/inpatient/bed-billing-policy` | List bed billing policy | Staff session | `inpatient.read` | — | — | `bedBilling.getBedBillingPolicy` | `src/routes/inpatient.routes.ts:86` |
| PUT | `/api/inpatient/bed-billing-policy` | Update a bed billing policy | Staff session | `inpatient.wards.update`, `billing.update` | — | — | `bedBilling.setBedBillingPolicy` | `src/routes/inpatient.routes.ts:107` |
| GET | `/api/inpatient/bed-billing-unresolved` | List bed billing unresolved | Staff session | `inpatient.read`, `billing.read`, `billing.create`, `billing.update` | — | — | `queries.InpatientDomainError` | `src/routes/inpatient.routes.ts:128` |
| GET | `/api/inpatient/board` | Ward board: occupancy, per-admission vitals status and note counts. One scoped call so the ward screen and dashboard do not fan out. | Staff session | `inpatient.read` | — | — | `nursing.getInpatientBoardScoped` | `src/routes/inpatient.routes.ts:859` |

## /api/insurance

91 routes.

Facility module gate: `insurance`.

26 distinct permission codes are required across this prefix: `insurance.benefits.validate`, `insurance.payers.read`, `insurance.read`, `insurance.mappings.manage`, `insurance.private.claims.prepare`, `insurance.private.claims.submit`, `clinical.read`, `billing.read`, `audit.read`, `insurance.members.read`, `insurance.eligibility.check`, `insurance.sha.claims.prepare`, `insurance.members.manage`, `insurance.payers.manage`, `insurance.preauthorization.manage`, `insurance.private.remittance.reconcile`, `insurance.sha.read`, `insurance.sha.preauthorization.create`, `insurance.sha.benefits.validate`, `insurance.sha.configuration.manage`, `insurance.sha.claims.read`, `insurance.sha.reconciliation.manage`, `insurance.sha.claims.resubmit`, `insurance.sha.claims.submit`, `insurance.sha.eligibility.check`, `insurance.sha.remittance.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/insurance/benefits` | List benefits | Staff session | `insurance.benefits.validate`, `insurance.payers.read`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:523` |
| POST | `/api/insurance/benefits` | Create a benefit | Staff session | `insurance.mappings.manage` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:544` |
| PATCH | `/api/insurance/benefits/:ruleId` | Update a benefit | Staff session | `insurance.mappings.manage` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:561` |
| POST | `/api/insurance/benefits/validate` | Validate: benefits validate | Staff session | `insurance.benefits.validate` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:591` |
| GET | `/api/insurance/claims` | List claims | Staff session | `insurance.private.claims.prepare`, `insurance.private.claims.submit`, `insurance.read` | — | — | `db.insert` | `src/routes/private-insurance.routes.ts:879` |
| GET | `/api/insurance/claims/:claimId` | Read a claim | Staff session | `insurance.private.claims.prepare`, `insurance.private.claims.submit`, `insurance.read`, `clinical.read`, `billing.read` | — | — | `db.insert` | `src/routes/private-insurance.routes.ts:939` |
| PATCH | `/api/insurance/claims/:claimId` | Update a claim | Staff session | `insurance.private.claims.prepare`, `clinical.read`, `billing.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:975` |
| POST | `/api/insurance/claims/:claimId/decision` | Record a decision: claims decision | Staff session | `insurance.private.claims.submit`, `clinical.read`, `billing.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:1053` |
| POST | `/api/insurance/claims/:claimId/dispatch-review` | Create action on a dispatch review | Staff session | `insurance.private.claims.submit` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:846` |
| GET | `/api/insurance/claims/:claimId/dispatch-reviews` | Read a dispatch review | Staff session | `insurance.private.claims.prepare`, `clinical.read`, `billing.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:825` |
| POST | `/api/insurance/claims/:claimId/resubmit` | Create action on a resubmit | Staff session | `insurance.private.claims.submit`, `clinical.read`, `billing.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:1033` |
| GET | `/api/insurance/claims/:claimId/status` | Read a status | Staff session | `insurance.private.claims.prepare`, `insurance.private.claims.submit`, `insurance.read`, `clinical.read`, `billing.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:1072` |
| POST | `/api/insurance/claims/:claimId/submit` | Submit: claims submit | Staff session | `insurance.private.claims.submit`, `clinical.read`, `billing.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:1013` |
| POST | `/api/insurance/claims/:claimId/validate` | Validate: claims validate | Staff session | `insurance.private.claims.prepare`, `clinical.read`, `billing.read` | body `facilityActionBodySchema` | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:994` |
| GET | `/api/insurance/claims/dispatch-reviews` | Dispatch review queue (see sha-eclaims.routes.ts for the rationale). A reservation whose outcome is unknown blocks every later mutation of the claim. These routes let an authorised reviewer record what the insurer's own record shows, and ar | Staff session | `insurance.private.claims.submit` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:803` |
| POST | `/api/insurance/claims/prepare` | Create a prepare | Staff session | `insurance.private.claims.prepare`, `clinical.read`, `billing.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:922` |
| GET | `/api/insurance/dashboard` | List dashboard | Staff session | `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:199` |
| GET | `/api/insurance/diagnostics` | List diagnostics | Staff session | `insurance.payers.read`, `audit.read` | — | — | `payerCode.trim` | `src/routes/private-insurance.routes.ts:216` |
| GET | `/api/insurance/eligibility` | List eligibility | Staff session | `insurance.members.read`, `insurance.eligibility.check`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:440` |
| GET | `/api/insurance/eligibility/:verificationId` | Read an eligibility | Staff session | `insurance.members.read`, `insurance.eligibility.check`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:479` |
| POST | `/api/insurance/eligibility/check` | Create a check | Staff session | `insurance.eligibility.check` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:462` |
| POST | `/api/insurance/evidence/preview` | Preview: evidence preview | Staff session | `billing.read`, `clinical.read`, `insurance.sha.claims.prepare`, `insurance.private.claims.prepare` | — | — | `previewClaimEvidence()` | `src/insurance/claims/claim-evidence.routes.ts:8` |
| GET | `/api/insurance/mappings` | List mappings | Staff session | `insurance.payers.read`, `insurance.benefits.validate`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:608` |
| POST | `/api/insurance/mappings` | Create a mapping | Staff session | `insurance.mappings.manage` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:628` |
| PATCH | `/api/insurance/mappings/:mappingId` | Update a mapping | Staff session | `insurance.mappings.manage` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:645` |
| GET | `/api/insurance/members` | List members | Staff session | `insurance.members.read`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:361` |
| POST | `/api/insurance/members` | Create a member | Staff session | `insurance.members.manage` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:385` |
| GET | `/api/insurance/members/:memberId` | Read a member | Staff session | `insurance.members.read`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:402` |
| PATCH | `/api/insurance/members/:memberId` | Update a member | Staff session | `insurance.members.manage` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:421` |
| GET | `/api/insurance/patients/:patientId/eligibility-history` | Read an eligibility history | Staff session | `insurance.members.read`, `insurance.eligibility.check`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:498` |
| GET | `/api/insurance/payers` | List payers | Staff session | `insurance.payers.read`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:244` |
| POST | `/api/insurance/payers` | Create a payer | Staff session | `insurance.payers.manage` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:262` |
| GET | `/api/insurance/payers/:payerId` | Read a payer | Staff session | `insurance.payers.read`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:280` |
| PATCH | `/api/insurance/payers/:payerId` | Update a payer | Staff session | `insurance.payers.manage` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:299` |
| GET | `/api/insurance/payers/:payerId/capabilities` | Read a capability | Staff session | `insurance.payers.read`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:319` |
| GET | `/api/insurance/payers/:payerId/connection-status` | Read a connection status | Staff session | `insurance.payers.read`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:338` |
| GET | `/api/insurance/preauthorizations` | List preauthorizations | Staff session | `insurance.preauthorization.manage`, `insurance.payers.read`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:668` |
| POST | `/api/insurance/preauthorizations` | Create a preauthorization | Staff session | `insurance.preauthorization.manage` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:694` |
| GET | `/api/insurance/preauthorizations/:id` | Read a preauthorization | Staff session | `insurance.preauthorization.manage`, `insurance.payers.read`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:711` |
| PATCH | `/api/insurance/preauthorizations/:id` | Update a preauthorization | Staff session | `insurance.preauthorization.manage` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:734` |
| POST | `/api/insurance/preauthorizations/:id/attachments` | Create action on an attachment | Staff session | `insurance.preauthorization.manage` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:772` |
| POST | `/api/insurance/preauthorizations/:id/submit` | Submit: preauthorizations submit | Staff session | `insurance.preauthorization.manage` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:753` |
| GET | `/api/insurance/reconciliation` | List reconciliation | Staff session | `insurance.private.remittance.reconcile`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:1156` |
| GET | `/api/insurance/remittances` | List remittances | Staff session | `insurance.private.remittance.reconcile`, `insurance.read` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:1101` |
| POST | `/api/insurance/remittances/:id/reconcile` | Reconcile: remittances reconcile | Staff session | `insurance.private.remittance.reconcile` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:1137` |
| POST | `/api/insurance/remittances/import` | Import: remittances import | Staff session | `insurance.private.remittance.reconcile` | — | — | `resolveActor()` | `src/routes/private-insurance.routes.ts:1120` |
| GET | `/api/insurance/sha/authorizations` | List sha authorizations | Staff session | `insurance.sha.read`, `insurance.sha.preauthorization.create`, `insurance.sha.claims.prepare`, `clinical.read`, `billing.read` | — | — | `authorizations.map` | `src/routes/sha-eclaims.routes.ts:779` |
| POST | `/api/insurance/sha/authorizations/consent` | Create a consent | Staff session | `insurance.sha.preauthorization.create`, `clinical.read`, `billing.read` | — | — | `interventions.map` | `src/routes/sha-eclaims.routes.ts:805` |
| GET | `/api/insurance/sha/benefit-rules` | List sha benefit rules | Staff session | `insurance.sha.read`, `insurance.sha.benefits.validate`, `insurance.sha.configuration.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:485` |
| POST | `/api/insurance/sha/benefit-rules` | Create a benefit rule | Staff session | `insurance.sha.configuration.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:503` |
| POST | `/api/insurance/sha/benefit-rules/:ruleId/review` | Create action on a review | Staff session | `insurance.sha.configuration.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:540` |
| POST | `/api/insurance/sha/benefits/hie-lookup` | Create a hie lookup | Staff session | `insurance.sha.benefits.validate`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:747` |
| POST | `/api/insurance/sha/benefits/validate` | Validate: benefits validate | Staff session | `insurance.sha.benefits.validate`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:692` |
| GET | `/api/insurance/sha/callbacks` | List sha callbacks | Staff session | `insurance.sha.read`, `insurance.sha.configuration.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1667` |
| POST | `/api/insurance/sha/callbacks/register` | Create a register | Staff session | `insurance.sha.configuration.manage`, `clinical.read`, `billing.read` | — | — | `callbackUrl.startsWith` | `src/routes/sha-eclaims.routes.ts:1583` |
| GET | `/api/insurance/sha/claims` | List sha claims | Staff session | `insurance.sha.claims.read`, `insurance.sha.read`, `clinical.read`, `billing.read` | — | — | `db.insert` | `src/routes/sha-eclaims.routes.ts:1171` |
| GET | `/api/insurance/sha/claims/:claimId` | Read a claim | Staff session | `insurance.sha.claims.read`, `insurance.sha.read`, `clinical.read`, `billing.read` | — | — | `db.insert` | `src/routes/sha-eclaims.routes.ts:1270` |
| POST | `/api/insurance/sha/claims/:claimId/adjudicate` | Create action on an adjudicate | Staff session | `insurance.sha.reconciliation.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1400` |
| POST | `/api/insurance/sha/claims/:claimId/dispatch-review` | Create action on a dispatch review | Staff session | `insurance.sha.reconciliation.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1138` |
| GET | `/api/insurance/sha/claims/:claimId/dispatch-reviews` | Read a dispatch review | Staff session | `insurance.sha.claims.read`, `insurance.sha.read`, `insurance.sha.reconciliation.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1116` |
| POST | `/api/insurance/sha/claims/:claimId/resubmit` | Create action on a resubmit | Staff session | `insurance.sha.claims.resubmit`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1330` |
| GET | `/api/insurance/sha/claims/:claimId/status` | Read a status | Staff session | `insurance.sha.claims.read`, `insurance.sha.read`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1384` |
| POST | `/api/insurance/sha/claims/:claimId/submit` | Submit: claims submit | Staff session | `insurance.sha.claims.submit`, `clinical.read`, `billing.read` | body `facilityActionBodySchema` | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1314` |
| POST | `/api/insurance/sha/claims/:claimId/validate` | Validate: claims validate | Staff session | `insurance.sha.claims.prepare`, `clinical.read`, `billing.read` | body `facilityActionBodySchema` | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1298` |
| GET | `/api/insurance/sha/claims/dispatch-reviews` | Dispatch review queue. A lost provider response leaves a durable reservation that blocks every later action on the claim. These routes are the only sanctioned way to look at and resolve it. They never call a payer and never re-dispatch. | Staff session | `insurance.sha.claims.read`, `insurance.sha.read`, `insurance.sha.reconciliation.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1093` |
| POST | `/api/insurance/sha/claims/prepare` | Create a prepare | Staff session | `insurance.sha.claims.prepare`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1206` |
| GET | `/api/insurance/sha/configuration` | List sha configuration | Staff session | `insurance.sha.read`, `insurance.sha.configuration.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:334` |
| PUT | `/api/insurance/sha/configuration` | Update a configuration | Staff session | `insurance.sha.configuration.manage`, `clinical.read`, `billing.read` | — | — | `contractedSchemes.map` | `src/routes/sha-eclaims.routes.ts:366` |
| GET | `/api/insurance/sha/connection-status` | List sha connection status | Staff session | `insurance.sha.read`, `insurance.read`, `clinical.read`, `billing.read` | — | — | `defaultShaGatewayAdapter.getConnectionStatus` | `src/routes/sha-eclaims.routes.ts:291` |
| GET | `/api/insurance/sha/eligibility` | List sha eligibility | Staff session | `insurance.sha.read`, `insurance.sha.eligibility.check`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:604` |
| GET | `/api/insurance/sha/eligibility/:verificationId` | Read an eligibility | Staff session | `insurance.sha.read`, `insurance.sha.eligibility.check`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:658` |
| POST | `/api/insurance/sha/eligibility/check` | Create a check | Staff session | `insurance.sha.eligibility.check`, `clinical.read`, `billing.read` | — | — | `identificationType.trim` | `src/routes/sha-eclaims.routes.ts:618` |
| GET | `/api/insurance/sha/operational-report` | List sha operational report | Staff session | `insurance.sha.read`, `insurance.sha.claims.read`, `insurance.sha.remittance.read`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1681` |
| GET | `/api/insurance/sha/patients/:patientId/benefits` | Read a benefit | Staff session | `insurance.sha.read`, `insurance.sha.benefits.validate`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:732` |
| GET | `/api/insurance/sha/patients/:patientId/eligibility-history` | Read an eligibility history | Staff session | `insurance.sha.read`, `insurance.sha.eligibility.check`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:673` |
| GET | `/api/insurance/sha/preauthorizations` | List sha preauthorizations | Staff session | `insurance.sha.read`, `insurance.sha.preauthorization.create`, `insurance.sha.claims.read`, `clinical.read`, `billing.read` | — | — | `preauthorizations.map` | `src/routes/sha-eclaims.routes.ts:869` |
| POST | `/api/insurance/sha/preauthorizations` | Create a preauthorization | Staff session | `insurance.sha.preauthorization.create`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:897` |
| GET | `/api/insurance/sha/preauthorizations/:id` | Read a preauthorization | Staff session | `insurance.sha.read`, `insurance.sha.preauthorization.create`, `insurance.sha.claims.read`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:947` |
| PATCH | `/api/insurance/sha/preauthorizations/:id` | Update a preauthorization | Staff session | `insurance.sha.preauthorization.create`, `clinical.read`, `billing.read` | — | — | `status.toUpperCase` | `src/routes/sha-eclaims.routes.ts:970` |
| POST | `/api/insurance/sha/preauthorizations/:id/cancel` | Cancel: preauthorizations cancel | Staff session | `insurance.sha.preauthorization.create`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1062` |
| GET | `/api/insurance/sha/preauthorizations/:id/status` | Read a status | Staff session | `insurance.sha.read`, `insurance.sha.preauthorization.create`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1044` |
| POST | `/api/insurance/sha/preauthorizations/:id/submit` | Submit: preauthorizations submit | Staff session | `insurance.sha.preauthorization.create`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1016` |
| POST | `/api/insurance/sha/registry/patient-search` | Create a patient search | Staff session | `insurance.sha.eligibility.check`, `clinical.read`, `billing.read` | — | — | `identificationType.trim` | `src/routes/sha-eclaims.routes.ts:569` |
| GET | `/api/insurance/sha/remittances` | List sha remittances | Staff session | `insurance.sha.remittance.read`, `insurance.sha.reconciliation.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1443` |
| POST | `/api/insurance/sha/remittances` | Create a remittance | Staff session | `insurance.sha.reconciliation.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1457` |
| GET | `/api/insurance/sha/remittances/:id/claims` | Read a claim | Staff session | `insurance.sha.remittance.read`, `insurance.sha.reconciliation.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1564` |
| POST | `/api/insurance/sha/remittances/:id/entries/:entryId/match-receipt` | Create action on a match receipt | Staff session | `insurance.sha.reconciliation.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1524` |
| POST | `/api/insurance/sha/remittances/:id/reconcile` | Reconcile: remittances reconcile | Staff session | `insurance.sha.reconciliation.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1487` |
| POST | `/api/insurance/sha/remittances/sync` | Create a sync | Staff session | `insurance.sha.reconciliation.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:1541` |
| GET | `/api/insurance/sha/service-mappings` | List sha service mappings | Staff session | `insurance.sha.read`, `insurance.sha.claims.prepare`, `insurance.sha.configuration.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:423` |
| POST | `/api/insurance/sha/service-mappings` | Create a service mapping | Staff session | `insurance.sha.configuration.manage`, `clinical.read`, `billing.read` | — | — | `resolveActorScope()` | `src/routes/sha-eclaims.routes.ts:441` |

## /api/integrations

7 routes.

Facility module gate: `interoperability`.

9 distinct permission codes are required across this prefix: `audit.security.read`, `system.settings.manage`, `insurance.read`, `billing.read`, `patients.read`, `insurance.sha.benefits.validate`, `insurance.sha.eligibility.check`, `tariffs.read`, `tariffs.manage`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/integrations/dha/calls` | List dha calls | Staff session | `audit.security.read`, `system.settings.manage` | — | — | `dha.listRecentCallsScoped` | `src/routes/dha.routes.ts:177` |
| GET | `/api/integrations/dha/invoices/:id/interventions` | Read an intervention | Staff session | `insurance.read`, `billing.read` | — | — | `dha.resolveInvoiceInterventionsScoped` | `src/routes/dha.routes.ts:144` |
| GET | `/api/integrations/dha/patients/:id/coverage` | Read a coverage | Staff session | `patients.read`, `insurance.sha.benefits.validate` | — | — | `dha.getBenefitsScoped` | `src/routes/dha.routes.ts:245` |
| POST | `/api/integrations/dha/patients/:id/eligibility` | Create action on an eligibility | Staff session | `patients.read`, `insurance.sha.eligibility.check` | — | — | `dha.checkEligibilityScoped` | `src/routes/dha.routes.ts:210` |
| GET | `/api/integrations/dha/readiness` | Superadmin only, like the screen that reads it. The report names which DHA credentials are configured, which operations are missing and what this build cannot call — configuration state, not clinical data, but not something every facility r | Staff session | `requireSuperAdmin` | — | — | `buildReadinessReport()` | `src/routes/dha.routes.ts:41` |
| GET | `/api/integrations/dha/service-mappings` | List dha service mappings | Staff session | `tariffs.read`, `system.settings.manage` | — | — | `dha.listServiceMappingsScoped` | `src/routes/dha.routes.ts:71` |
| PUT | `/api/integrations/dha/service-mappings` | Update a service mapping | Staff session | `tariffs.manage`, `system.settings.manage` | — | — | `dha.saveServiceMappingScoped` | `src/routes/dha.routes.ts:103` |

## /api/interop

2 routes.

Facility module gate: `interoperability`.

2 distinct permission codes are required across this prefix: `reports.read`, `interop.fhir.patient.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/interop/dha/moh-705` | List dha moh 705 | Staff session | `reports.read` | — | — | — | `src/routes/domains/interop.routes.ts:190` |
| GET | `/api/interop/fhir/patient/:id` (file) | Read a patient | Staff session | `interop.fhir.patient.read` | — | facility | `queries.getPatientByIdScoped` | `src/routes/domains/interop.routes.ts:41` |

## /api/inventory

25 routes.

Facility module gate: `inventory`.

5 distinct permission codes are required across this prefix: `inventory.read`, `inventory.manage`, `billing.update`, `accounting.journals.post`, `accounting.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/inventory` | List inventory | Staff session | `inventory.read` | — | facility | `queries.getFacilityByIdScoped` | `src/routes/pharmacy.routes.ts:219` |
| POST | `/api/inventory` | Create an inventory | Staff session | `inventory.manage` | body `createInventoryItemBodySchema` | facility | `queries.getFacilityByIdScoped` | `src/routes/pharmacy.routes.ts:237` |
| POST | `/api/inventory/:id/batches` | Receive stock into a batch. Tops up an existing batch number instead of failing, so a second delivery of the same lot is not rejected by the unique index. | Staff session | `inventory.manage` | — | — | `inventory.receiveBatchScoped` | `src/routes/pharmacy.routes.ts:113` |
| PUT | `/api/inventory/:id/selling-price` | Update a selling price | Staff session | `inventory.manage`, `billing.update` | — | — | `inventory.updateInventorySellingPriceScoped` | `src/routes/pharmacy.routes.ts:269` |
| GET | `/api/inventory/accounting-policy` | List accounting policy | Staff session | `inventory.read` | — | facility | `accounting.readInventoryAccountingPolicy` | `src/routes/inventory-accounting.routes.ts:50` |
| POST | `/api/inventory/accounting-policy` | Create an accounting policy | Staff session | `inventory.manage` | — | facility | `accounting.saveInventoryAccountingPolicy` | `src/routes/inventory-accounting.routes.ts:68` |
| POST | `/api/inventory/accounting-policy/activate` | Activate: accounting policy activate | Staff session | `inventory.manage`, `accounting.journals.post` | — | facility | `accounting.activateInventoryAccountingPolicy` | `src/routes/inventory-accounting.routes.ts:83` |
| POST | `/api/inventory/adjustments` | Create an adjustment | Staff session | `inventory.manage` | — | facility | `stock.adjustStock` | `src/routes/inventory-control.routes.ts:102` |
| GET | `/api/inventory/batches` | Batches with their expiry status, ordered earliest expiry first. Everything reaches the facility through inventory_items, because inventory_batches has no facility column of its own. | Staff session | `inventory.read` | — | — | `inventory.getBatchesScoped` | `src/routes/pharmacy.routes.ts:35` |
| GET | `/api/inventory/expiry-summary` | Expired and near-expiry stock for the facility. | Staff session | `inventory.read` | — | — | `inventory.getExpirySummaryScoped` | `src/routes/pharmacy.routes.ts:78` |
| PUT | `/api/inventory/items/:id/reorder-level` | Update a reorder level | Staff session | `inventory.manage` | — | facility | `stock.updateReorderLevel` | `src/routes/inventory-control.routes.ts:261` |
| GET | `/api/inventory/movements` | List movements | Staff session | `inventory.read` | — | facility | `stock.listMovements` | `src/routes/inventory-control.routes.ts:81` |
| POST | `/api/inventory/receipt-retry-cancellation` | Close only the retry identity, never a recorded receipt or its stock. | Staff session | `inventory.manage` | — | — | `inventory.cancelReceiptRetryScoped` | `src/routes/pharmacy.routes.ts:191` |
| POST | `/api/inventory/receipt-status` | A status lookup never turns NOT_FOUND into permission to use a new identity. | Staff session | `inventory.manage` | — | — | `inventory.getReceiptRequestStatusScoped` | `src/routes/pharmacy.routes.ts:163` |
| GET | `/api/inventory/reconciliation` | List reconciliation | Staff session | `inventory.read`, `accounting.read` | — | facility | `accounting.readInventoryReconciliation` | `src/routes/inventory-accounting.routes.ts:111` |
| GET | `/api/inventory/reorder-alerts` | List reorder alerts | Staff session | `inventory.read` | — | facility | `stock.getReorderAlerts` | `src/routes/inventory-control.routes.ts:247` |
| GET | `/api/inventory/stock-counts` | List stock counts | Staff session | `inventory.read` | — | facility | `stock.listStockCounts` | `src/routes/inventory-control.routes.ts:119` |
| POST | `/api/inventory/stock-counts` | Create a stock count | Staff session | `inventory.manage` | — | facility | `stock.createStockCount` | `src/routes/inventory-control.routes.ts:133` |
| GET | `/api/inventory/stock-counts/:id` | Read a stock count | Staff session | `inventory.read` | — | facility | `stock.getStockCount` | `src/routes/inventory-control.routes.ts:148` |
| POST | `/api/inventory/stock-counts/:id/lines` | Create action on a line | Staff session | `inventory.manage` | — | facility | `stock.recordCountedQuantity` | `src/routes/inventory-control.routes.ts:164` |
| POST | `/api/inventory/stock-counts/:id/post` | Post: stock counts post | Staff session | `inventory.manage` | — | facility | `stock.postStockCount` | `src/routes/inventory-control.routes.ts:181` |
| GET | `/api/inventory/transfers` | List transfers | Staff session | `inventory.read` | — | facility | `stock.listTransfers` | `src/routes/inventory-control.routes.ts:200` |
| POST | `/api/inventory/transfers` | Create a transfer | Staff session | `inventory.manage` | — | facility | `stock.createTransfer` | `src/routes/inventory-control.routes.ts:214` |
| GET | `/api/inventory/transfers/:id` | Read a transfer | Staff session | `inventory.read` | — | facility | `stock.getTransfer` | `src/routes/inventory-control.routes.ts:229` |
| GET | `/api/inventory/valuation` | List valuation | Staff session | `inventory.read` | — | facility | `stock.getValuation` | `src/routes/inventory-control.routes.ts:280` |

## /api/invoices

10 routes.

6 distinct permission codes are required across this prefix: `billing.read`, `billing.create`, `insurance.read`, `clinical.read`, `billing.update`, `billing.payments.record`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/invoices` | List invoices | Staff session | `billing.read` | — | facility | `rawFacilityId.trim` | `src/routes/billing.routes.ts:29` |
| POST | `/api/invoices` | Create an invoice | Staff session | `billing.create` | body `createInvoiceBodySchema` | facility | `queries.getFacilityByIdScoped` | `src/routes/domains/invoices.routes.ts:72` |
| GET | `/api/invoices/:id` | Full invoice: header, line items with their clinical provenance and every payment already recorded. | Staff session | `billing.read` | — | — | `queries.getInvoiceDetailScoped` | `src/routes/billing.routes.ts:177` |
| GET | `/api/invoices/:id/claimable-lines` | Read a claimable line | Staff session | `insurance.read`, `billing.read` | — | — | `insuranceClaims.getClaimableLinesScoped` | `src/routes/domains/claims.routes.ts:99` |
| GET | `/api/invoices/:id/finalization` | Finalized statements contain diagnosis information, so billing and clinical read permission are both required. The service commits an access log before returning the statement. No provider request settles an invoice here. | Staff session | `billing.read`, `clinical.read` | — | — | `finalized.getFinalizedInvoice` | `src/routes/billing.routes.ts:213` |
| POST | `/api/invoices/:id/finalize` | Create action on a finalize | Staff session | `billing.read`, `billing.update`, `clinical.read` | — | — | `finalized.finalizeInvoice` | `src/routes/billing.routes.ts:244` |
| GET | `/api/invoices/:id/items` | Read an item | Staff session | `billing.read` | — | — | `queries.getFacilityByIdScoped` | `src/routes/billing.routes.ts:103` |
| POST | `/api/invoices/:id/payments/:paymentId/attribution` | Create action on an attribution | Staff session | `billing.read`, `billing.payments.record` | — | — | `finalized.attributeInvoicePayment` | `src/routes/billing.routes.ts:302` |
| POST | `/api/invoices/:id/print-access` | Create action on a print access | Staff session | `billing.read`, `clinical.read` | — | — | `finalized.recordInvoicePrintAccess` | `src/routes/billing.routes.ts:276` |
| POST | `/api/invoices/:id/void` | Void an invoice. Audit-preserving: the row and its lines remain, marked voided, so the record is never destroyed. | Staff session | `billing.update` | body `voidInvoiceBodySchema` | — | `queries.voidInvoiceScoped` | `src/routes/billing.routes.ts:338` |

## /api/lab-orders

5 routes.

Facility module gate: `laboratory`.

4 distinct permission codes are required across this prefix: `laboratory.read`, `laboratory.orders.create`, `laboratory.results.verify`, `laboratory.results.enter`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/lab-orders` | List laborders | Staff session | `laboratory.read` | — | — | `queries.getLabOrders` | `src/routes/laboratory.routes.ts:63` |
| POST | `/api/lab-orders` | Create a lab order | Staff session | `laboratory.orders.create` | body `createLabOrderBodySchema` | — | `queries.createLabOrder` | `src/routes/laboratory.routes.ts:126` |
| POST | `/api/lab-orders/:id/complete` | Complete | Staff session | `laboratory.results.verify` | — | — | `queries.completeLabInvestigation` | `src/routes/laboratory.routes.ts:248` |
| PUT | `/api/lab-orders/:id/status` | Update a status | Staff session | `laboratory.results.enter` | body `updateLabOrderStatusBodySchema` | — | `queries.updateLabOrderStatus` | `src/routes/laboratory.routes.ts:147` |
| POST | `/api/lab-orders/batch` | Create a batch | Staff session | `laboratory.orders.create` | body `createLabOrderBatchBodySchema` | — | `queries.createLabOrderBatch` | `src/routes/laboratory.routes.ts:83` |

## /api/lab-results

3 routes.

Facility module gate: `laboratory`.

3 distinct permission codes are required across this prefix: `laboratory.read`, `laboratory.results.enter`, `laboratory.results.verify`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/lab-results` | List labresults | Staff session | `laboratory.read` | — | — | `queries.getLabResults` | `src/routes/laboratory.routes.ts:176` |
| POST | `/api/lab-results` | Create a lab result | Staff session | `laboratory.results.enter` | body `createLabResultBodySchema` | — | `queries.addLabResult` | `src/routes/laboratory.routes.ts:201` |
| POST | `/api/lab-results/:id/verify` | Verify | Staff session | `laboratory.results.verify` | body `verifyLabResultBodySchema` | — | `queries.verifyLabResult` | `src/routes/laboratory.routes.ts:273` |

## /api/lab-tests

1 routes.

Facility module gate: `laboratory`.

1 distinct permission codes are required across this prefix: `laboratory.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/lab-tests` | List labtests | Staff session | `laboratory.read` | — | facility | `queries.getFacilityByIdScoped` | `src/routes/laboratory.routes.ts:42` |

## /api/maternity

18 routes.

Facility module gate: `maternity`.

3 distinct permission codes are required across this prefix: `maternity.create`, `maternity.read`, `maternity.update`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/maternity/anc-visits` | Create an anc visit | Staff session | `maternity.create` | — | — | `maternity.recordAncVisit` | `src/routes/maternal-health.routes.ts:206` |
| GET | `/api/maternity/deliveries` | List deliveries | Staff session | `maternity.read` | — | — | `maternity.listDeliveries` | `src/routes/maternal-health.routes.ts:361` |
| POST | `/api/maternity/deliveries` | Create a delivery | Staff session | `maternity.update` | — | — | `maternity.recordDelivery` | `src/routes/maternal-health.routes.ts:393` |
| GET | `/api/maternity/deliveries/:id` | Read a delivery | Staff session | `maternity.read` | — | — | `maternity.getDelivery` | `src/routes/maternal-health.routes.ts:424` |
| GET | `/api/maternity/labours` | List labours | Staff session | `maternity.read` | — | — | `maternity.listLabours` | `src/routes/maternal-health.routes.ts:231` |
| POST | `/api/maternity/labours` | Create a labour | Staff session | `maternity.create` | — | — | `maternity.startLabour` | `src/routes/maternal-health.routes.ts:261` |
| GET | `/api/maternity/labours/:id` | Read a labour | Staff session | `maternity.read` | — | — | `maternity.getLabour` | `src/routes/maternal-health.routes.ts:286` |
| PATCH | `/api/maternity/labours/:id` | Update a labour | Staff session | `maternity.update` | — | — | `maternity.updateLabour` | `src/routes/maternal-health.routes.ts:311` |
| POST | `/api/maternity/partograph` | Create a partograph | Staff session | `maternity.create` | — | — | `maternity.recordPartographEntry` | `src/routes/maternal-health.routes.ts:336` |
| GET | `/api/maternity/postnatal` | List postnatal | Staff session | `maternity.read` | — | — | `postnatal.listPostnatalVisitsForFacility` | `src/routes/maternal-health.routes.ts:456` |
| POST | `/api/maternity/postnatal` | Create a postnatal | Staff session | `maternity.create` | — | — | `postnatal.recordPostnatalVisit` | `src/routes/maternal-health.routes.ts:508` |
| GET | `/api/maternity/pregnancies` | List pregnancies | Staff session | `maternity.read` | — | — | `maternity.listPregnancies` | `src/routes/maternal-health.routes.ts:69` |
| POST | `/api/maternity/pregnancies` | Create a pregnancy | Staff session | `maternity.create` | — | — | `maternity.bookPregnancy` | `src/routes/maternal-health.routes.ts:102` |
| GET | `/api/maternity/pregnancies/:id` | Read a pregnancy | Staff session | `maternity.read` | — | — | `maternity.getPregnancy` | `src/routes/maternal-health.routes.ts:127` |
| PATCH | `/api/maternity/pregnancies/:id` | Update a pregnancy | Staff session | `maternity.update` | — | — | `maternity.updatePregnancy` | `src/routes/maternal-health.routes.ts:152` |
| GET | `/api/maternity/pregnancies/:id/anc-visits` | Read an anc visit | Staff session | `maternity.read` | — | — | `maternity.listAncVisits` | `src/routes/maternal-health.routes.ts:181` |
| GET | `/api/maternity/pregnancies/:id/postnatal` | Read a postnatal | Staff session | `maternity.read` | — | — | `postnatal.listPostnatalVisits` | `src/routes/maternal-health.routes.ts:483` |
| GET | `/api/maternity/summary` | Summary | Staff session | `maternity.read` | — | — | `maternity.maternitySummary` | `src/routes/maternal-health.routes.ts:42` |

## /api/medications

6 routes.

Facility module gate: `pharmacy`, `opd`.

3 distinct permission codes are required across this prefix: `pharmacy.read`, `clinical.create`, `clinical.update`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/medications` | List medications | Staff session | `pharmacy.read` | — | — | — | `src/routes/index.ts:174` |
| GET | `/api/medications` | List medications | Staff session | `pharmacy.read` | — | — | — | `src/routes/index.ts:174` |
| POST | `/api/medications` | Create a medication | Staff session | `clinical.create` | — | — | — | `src/routes/index.ts:175` |
| POST | `/api/medications` | Create a medication | Staff session | `clinical.create` | — | — | — | `src/routes/index.ts:175` |
| PUT | `/api/medications/:id/status` | Update a status | Staff session | `clinical.update` | — | — | — | `src/routes/index.ts:176` |
| PUT | `/api/medications/:id/status` | Update a status | Staff session | `clinical.update` | — | — | — | `src/routes/index.ts:176` |

## /api/notifications

3 routes.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/notifications` | List notifications | Staff session | checked in service | — | — | `id()` | `src/notifications/inbox.routes.ts:39` |
| POST | `/api/notifications/read` | Create a read | Staff session | checked in service | — | — | `id()` | `src/notifications/inbox.routes.ts:74` |
| POST | `/api/notifications/read-all` | Create a read all | Staff session | checked in service | — | — | `id()` | `src/notifications/inbox.routes.ts:95` |

## /api/nursing-notes

3 routes.

Facility module gate: `inpatient`.

2 distinct permission codes are required across this prefix: `inpatient.read`, `clinical.create`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/nursing-notes` | List nursingnotes | Staff session | `inpatient.read` | — | — | `queries.getNursingNotesScoped` | `src/routes/inpatient.routes.ts:1000` |
| POST | `/api/nursing-notes` | Create a nursing note | Staff session | `clinical.create` | — | — | `queries.createNursingNoteScoped` | `src/routes/inpatient.routes.ts:1031` |
| GET | `/api/nursing-notes/handover` | Shift handover: notes for a day grouped by shift. Defaults to today; pass ?date=YYYY-MM-DD&shift=Morning to narrow. | Staff session | `inpatient.read` | — | — | `nursing.getShiftHandoverScoped` | `src/routes/inpatient.routes.ts:973` |

## /api/observations

2 routes.

Facility module gate: `opd`.

2 distinct permission codes are required across this prefix: `clinical.read`, `clinical.create`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/observations` | List observations | Staff session | `clinical.read` | — | — | `nursing.getObservationsScoped` | `src/routes/vitals.routes.ts:22` |
| POST | `/api/observations` | Record ward or clinic vitals. Inpatient vitals are recorded against an admission, which guarantees the patient is actually in a bed at this facility. A bare patient payload is no longer accepted: observations carry no facility column, so un | Staff session | `clinical.create` | — | — | `nursing.recordVitalsScoped` | `src/routes/vitals.routes.ts:57` |

## /api/ops

1 routes.

1 distinct permission codes are required across this prefix: `audit.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/ops/status` | List status | Staff session | `audit.read` | — | facility | `raw.trim` | `src/routes/operations.routes.ts:33` |

## /api/partner-equity

13 routes.

Facility module gate: `accounting`.

2 distinct permission codes are required across this prefix: `accounting.read`, `accounting.equity.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/partner-equity/partners` | List partners | Staff session | `accounting.read`, `accounting.equity.read` | — | — | `svc.register` | `src/partner-equity/routes.ts:80` |
| PUT | `/api/partner-equity/partners` | Update a partner | Staff session | `accounting.read`, `accounting.equity.read` | — | — | `svc.savePartner` | `src/partner-equity/routes.ts:84` |
| GET | `/api/partner-equity/statements` | Statements | Staff session | `accounting.read`, `accounting.equity.read` | — | — | `svc.listStatements` | `src/partner-equity/routes.ts:89` |
| POST | `/api/partner-equity/statements` | Statements | Staff session | `accounting.read`, `accounting.equity.read` | — | — | `svc.createStatement` | `src/partner-equity/routes.ts:93` |
| GET | `/api/partner-equity/statements/:id` | Statements | Staff session | `accounting.read`, `accounting.equity.read` | — | — | `svc.getStatement` | `src/partner-equity/routes.ts:100` |
| PUT | `/api/partner-equity/statements/:id` | Statements | Staff session | `accounting.read`, `accounting.equity.read` | — | — | `svc.saveStatement` | `src/partner-equity/routes.ts:104` |
| GET | `/api/partner-equity/statements/:id/audit` | Audit trail: statements audit | Staff session | `accounting.read`, `accounting.equity.read` | — | — | `svc.history` | `src/partner-equity/routes.ts:163` |
| POST | `/api/partner-equity/statements/:id/carry` | Create action on a carry | Staff session | `accounting.read`, `accounting.equity.read` | — | — | `svc.carryForward` | `src/partner-equity/routes.ts:132` |
| GET | `/api/partner-equity/statements/:id/carry-preview` | Read a carry preview | Staff session | `accounting.read`, `accounting.equity.read` | — | — | `svc.carryPreview` | `src/partner-equity/routes.ts:125` |
| GET | `/api/partner-equity/statements/:id/export` (file) | Export: statements export | Staff session | `accounting.read`, `accounting.equity.read` | — | — | `svc.getStatement` | `src/partner-equity/routes.ts:168` |
| POST | `/api/partner-equity/statements/:id/include-partner` | Create action on an include partner | Staff session | `accounting.read`, `accounting.equity.read` | — | — | `svc.includePartner` | `src/partner-equity/routes.ts:118` |
| POST | `/api/partner-equity/statements/:id/revise` | Create action on a revise | Staff session | `accounting.read`, `accounting.equity.read` | — | — | `svc.revise` | `src/partner-equity/routes.ts:111` |
| POST | `/api/partner-equity/statements/:id/workflow` | Create action on a workflow | Staff session | `accounting.read`, `accounting.equity.read` | — | — | `svc.transition` | `src/partner-equity/routes.ts:139` |

## /api/patient-documents

11 routes.

1 distinct permission codes are required across this prefix: `patients.documents.upload`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/patient-documents/patients/:patientId` | Read a patient | Staff session | checked in service | — | — | `svc.idOf` | `src/documents/patient-documents.routes.ts:86` |
| POST | `/api/patient-documents/patients/:patientId` | Create action on a patient | Staff session | `patients.documents.upload` | — | — | `Buffer.isBuffer` | `src/documents/patient-documents.routes.ts:44` |
| GET | `/api/patient-documents/patients/:patientId/:id/file` | Read a file | Staff session | checked in service | — | — | `svc.readPatientDocument` | `src/documents/patient-documents.routes.ts:99` |
| GET | `/api/patient-documents/patients/:patientId/:id/history` | History: patients history | Staff session | checked in service | — | — | `svc.documentHistory` | `src/documents/patient-documents.routes.ts:116` |
| POST | `/api/patient-documents/patients/:patientId/:id/release` | Release: patients release | Staff session | checked in service | — | — | `svc.releasePatientDocument` | `src/documents/patient-documents.routes.ts:129` |
| GET | `/api/patient-documents/patients/:patientId/doctors` | Read a doctor | Staff session | checked in service | — | — | `svc.responsibleDoctorOptions` | `src/documents/patient-documents.routes.ts:73` |
| POST | `/api/patient-documents/patients/:patientId/releases` | Create action on a release | Staff session | checked in service | — | — | `svc.releasePatientDocuments` | `src/documents/patient-documents.routes.ts:149` |
| GET | `/api/patient-documents/radiology-policy` | List radiology policy | Staff session | checked in service | — | — | `svc.radiologyConsentPolicy` | `src/documents/patient-documents.routes.ts:189` |
| POST | `/api/patient-documents/radiology-policy` | Create a radiology policy | Staff session | checked in service | — | — | `svc.setRadiologyConsentPolicy` | `src/documents/patient-documents.routes.ts:196` |
| GET | `/api/patient-documents/radiology/:id/consent` | Read a consent | Staff session | checked in service | — | — | `svc.radiologyConsent` | `src/documents/patient-documents.routes.ts:169` |
| POST | `/api/patient-documents/radiology/:id/consent` | Create action on a consent | Staff session | checked in service | — | — | `svc.decideRadiologyConsent` | `src/documents/patient-documents.routes.ts:176` |

## /api/patients

12 routes.

Facility module gate: `registration`.

6 distinct permission codes are required across this prefix: `patients.read`, `patients.create`, `patients.update`, `clinical.read`, `clinical.create`, `clinical.update`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/patients` | List patients | Staff session | `patients.read` | query `scopedCollectionQuerySchema` | — | `queries.getPatientsScoped` | `src/routes/domains/patients.routes.ts:47` |
| POST | `/api/patients` | Create a patient | Staff session | `patients.create` | body `createPatientBodySchema` | — | `queries.createPatientScoped` | `src/routes/domains/patients.routes.ts:199` |
| GET | `/api/patients/:id` | Read a patient | Staff session | `patients.read` | — | — | `queries.getPatientByIdScoped` | `src/routes/domains/patients.routes.ts:134` |
| PUT | `/api/patients/:id` | Update a patient | Staff session | `patients.update` | body `updatePatientBodySchema` | — | `queries.updatePatientScoped` | `src/routes/domains/patients.routes.ts:262` |
| GET | `/api/patients/:id/allergies` | Read an allergy | Staff session | `clinical.read` | — | — | `listAllergies()` | `src/clinical/clinical-records.routes.ts:157` |
| POST | `/api/patients/:id/allergies` | Create action on an allergy | Staff session | `clinical.create` | — | — | `recordAllergy()` | `src/clinical/clinical-records.routes.ts:174` |
| PATCH | `/api/patients/:id/allergies/:allergyId` | Update an allergy | Staff session | `clinical.update` | — | — | `setAllergyStatus()` | `src/clinical/clinical-records.routes.ts:197` |
| POST | `/api/patients/:id/allergies/check` | Ask before prescribing. Read-only. It records nothing, so a prescriber can check a name without leaving a trace of a decision they have not made. | Staff session | `clinical.read` | — | — | `raw.every` | `src/clinical/clinical-records.routes.ts:231` |
| GET | `/api/patients/:id/consents` | Read a consent | Staff session | `patients.read` | — | — | `listConsents()` | `src/clinical/clinical-records.routes.ts:85` |
| POST | `/api/patients/:id/consents` | Create action on a consent | Staff session | `patients.update` | — | — | `grantConsent()` | `src/clinical/clinical-records.routes.ts:102` |
| POST | `/api/patients/:id/consents/:consentId/revoke` | Revoke: consents revoke | Staff session | `patients.update` | — | — | `revokeConsent()` | `src/clinical/clinical-records.routes.ts:125` |
| POST | `/api/patients/directory-page` | Search data stays in the request body rather than a URL. Each bounded page is facility-scoped and access entries must be durable before it is returned. | Staff session | `patients.read` | body `patientDirectoryPageBodySchema` | — | `queries.getPatientDirectoryPageScoped` | `src/routes/domains/patients.routes.ts:98` |

## /api/payer-hub

15 routes.

12 distinct permission codes are required across this prefix: `payer_hub.catalogue.read`, `insurance.read`, `insurance.private.claims.prepare`, `insurance.sha.claims.prepare`, `insurance.claims.create`, `payer_hub.facility.manage`, `payer_hub.credentials.manage`, `payer_hub.production.request`, `payer_hub.global.read`, `payer_hub.production.approve`, `payer_hub.assign`, `payer_hub.global.manage`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/payer-hub/facility/catalogue` | Catalogue: facility catalogue | Staff session | `payer_hub.catalogue.read`, `insurance.read`, `insurance.private.claims.prepare`, `insurance.sha.claims.prepare`, `insurance.claims.create` | — | facility | `hub.facilityCatalogue` | `src/insurance/hub/routes.ts:152` |
| GET | `/api/payer-hub/facility/configuration-audit` | List facility configuration audit | Staff session | `payer_hub.facility.manage` | — | facility | `listConfigurationAudit()` | `src/insurance/hub/routes.ts:165` |
| POST | `/api/payer-hub/facility/payers/:id/access-request` | Create action on an access request | Staff session | `payer_hub.facility.manage` | — | facility | `hub.requestAccess` | `src/insurance/hub/routes.ts:176` |
| PUT | `/api/payer-hub/facility/payers/:id/activation` | Update an activation | Staff session | `payer_hub.facility.manage` | — | facility | `hub.setActivation` | `src/insurance/hub/routes.ts:187` |
| POST | `/api/payer-hub/facility/payers/:id/connection-test` | Create action on a connection test | Staff session | `payer_hub.facility.manage` | — | facility | `hub.facilityCatalogue` | `src/insurance/hub/routes.ts:244` |
| PUT | `/api/payer-hub/facility/payers/:id/environments/:environment` | Update an environment | Staff session | `payer_hub.credentials.manage` | — | facility | `hub.configureEnvironment` | `src/insurance/hub/routes.ts:202` |
| POST | `/api/payer-hub/facility/payers/:id/environments/:environment/revoke` | Revoke: environments revoke | Staff session | `payer_hub.credentials.manage` | — | facility | `hub.revokeEnvironmentReference` | `src/insurance/hub/routes.ts:218` |
| POST | `/api/payer-hub/facility/payers/:id/production-request` | Create action on a production request | Staff session | `payer_hub.production.request` | — | facility | `hub.requestProduction` | `src/insurance/hub/routes.ts:233` |
| GET | `/api/payer-hub/platform` | List platform | Staff session | `payer_hub.global.read` | — | — | `hub.listPlatformPayers` | `src/insurance/hub/routes.ts:73` |
| POST | `/api/payer-hub/platform/assignments/:id/production-decision` | Create action on a production decision | Staff session | `payer_hub.production.approve` | — | — | `hub.decideProduction` | `src/insurance/hub/routes.ts:140` |
| GET | `/api/payer-hub/platform/facilities` | List platform facilities | Staff session | `payer_hub.assign` | — | — | `hub.listPlatformFacilities` | `src/insurance/hub/routes.ts:81` |
| POST | `/api/payer-hub/platform/payers` | Create a payer | Staff session | `payer_hub.global.manage` | — | — | `hub.registerPayer` | `src/insurance/hub/routes.ts:89` |
| PATCH | `/api/payer-hub/platform/payers/:id` | Update a payer | Staff session | `payer_hub.global.manage` | — | — | `hub.updatePayer` | `src/insurance/hub/routes.ts:97` |
| PUT | `/api/payer-hub/platform/payers/:id/facilities/:facilityId` | Update a facility | Staff session | `payer_hub.assign` | — | — | `hub.assignPayer` | `src/insurance/hub/routes.ts:124` |
| PUT | `/api/payer-hub/platform/payers/:id/workflows/:workflow` | Update a workflow | Staff session | `payer_hub.global.manage` | — | — | `hub.updateCapability` | `src/insurance/hub/routes.ts:108` |

## /api/payment-hub

28 routes.

13 distinct permission codes are required across this prefix: `payment_hub.catalogue.read`, `payment_hub.collection.initiate`, `billing.read`, `payment_hub.facility.manage`, `payment_hub.credentials.manage`, `payment_hub.production.request`, `payment_hub.reconciliation.manage`, `payment_hub.transactions.read`, `payment_hub.payments.verify`, `payment_hub.global.read`, `payment_hub.assign`, `payment_hub.production.approve`, `payment_hub.global.manage`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/payment-hub/facility/catalogue` | Catalogue: facility catalogue | Staff session | `payment_hub.catalogue.read` | — | facility | `hub.facilityCatalogue` | `src/payment-hub/routes.ts:176` |
| POST | `/api/payment-hub/facility/collections` | Create a collection | Staff session | `payment_hub.collection.initiate`, `billing.read` | — | facility | `hub.initiateCollection` | `src/payment-hub/routes.ts:352` |
| GET | `/api/payment-hub/facility/collections/integrations` | List collections integrations | Staff session | `payment_hub.collection.initiate`, `billing.read` | — | facility | `hub.listCollectionIntegrations` | `src/payment-hub/routes.ts:322` |
| GET | `/api/payment-hub/facility/collections/invoices` | List collections invoices | Staff session | `payment_hub.collection.initiate`, `billing.read` | — | facility | `hub.listCollectionInvoices` | `src/payment-hub/routes.ts:332` |
| POST | `/api/payment-hub/facility/collections/recovery` | Create a recovery | Staff session | `payment_hub.collection.initiate`, `billing.read` | — | facility | `hub.recoverCollection` | `src/payment-hub/routes.ts:342` |
| GET | `/api/payment-hub/facility/configuration-audit` | List facility configuration audit | Staff session | `payment_hub.facility.manage` | — | facility | `listConfigurationAudit()` | `src/payment-hub/routes.ts:194` |
| POST | `/api/payment-hub/facility/integrations/:id/accounts` | Create action on an account | Staff session | `payment_hub.facility.manage` | — | facility | `hub.addFacilityAccount` | `src/payment-hub/routes.ts:260` |
| PUT | `/api/payment-hub/facility/integrations/:id/credentials` | Update a credential | Staff session | `payment_hub.credentials.manage` | — | facility | `hub.saveCredentials` | `src/payment-hub/routes.ts:224` |
| POST | `/api/payment-hub/facility/integrations/:id/credentials/reencrypt` | Create action on a reencrypt | Staff session | `payment_hub.credentials.manage` | — | facility | `hub.reencryptCredentials` | `src/payment-hub/routes.ts:248` |
| POST | `/api/payment-hub/facility/integrations/:id/credentials/revoke` | Revoke: credentials revoke | Staff session | `payment_hub.credentials.manage` | — | facility | `hub.revokeCredentials` | `src/payment-hub/routes.ts:236` |
| PUT | `/api/payment-hub/facility/integrations/:id/enabled` | Update an enabled | Staff session | `payment_hub.facility.manage` | — | facility | `hub.setIntegrationEnabled` | `src/payment-hub/routes.ts:286` |
| POST | `/api/payment-hub/facility/integrations/:id/health` | Create action on a health | Staff session | `payment_hub.facility.manage` | — | facility | `hub.testConnection` | `src/payment-hub/routes.ts:275` |
| POST | `/api/payment-hub/facility/integrations/:id/production-request` | Create action on a production request | Staff session | `payment_hub.production.request` | — | facility | `hub.requestProduction` | `src/payment-hub/routes.ts:303` |
| POST | `/api/payment-hub/facility/providers/:id/access-request` | Create action on an access request | Staff session | `payment_hub.facility.manage` | — | facility | `hub.requestAccess` | `src/payment-hub/routes.ts:202` |
| POST | `/api/payment-hub/facility/providers/:id/integrations` | Create action on an integration | Staff session | `payment_hub.facility.manage` | — | facility | `hub.configureIntegration` | `src/payment-hub/routes.ts:213` |
| POST | `/api/payment-hub/facility/reconciliations/:id/void` | Create action on a void | Staff session | `payment_hub.reconciliation.manage` | — | facility | `hub.voidReconciliation` | `src/payment-hub/routes.ts:387` |
| GET | `/api/payment-hub/facility/transactions` | List facility transactions | Staff session | `payment_hub.transactions.read` | — | facility | `hub.listFacilityTransactions` | `src/payment-hub/routes.ts:315` |
| POST | `/api/payment-hub/facility/transactions/:id/query` | Create action on a query | Staff session | `payment_hub.payments.verify` | — | facility | `hub.queryTransaction` | `src/payment-hub/routes.ts:363` |
| POST | `/api/payment-hub/facility/transactions/:id/reconcile` | Reconcile: transactions reconcile | Staff session | `payment_hub.reconciliation.manage` | — | facility | `hub.reconcileReceipt` | `src/payment-hub/routes.ts:373` |
| GET | `/api/payment-hub/platform` | Super-admin pages are metadata/provisioning only, never facility finance. | Staff session | `payment_hub.global.read` | — | — | `hub.listPlatformHub` | `src/payment-hub/routes.ts:79` |
| GET | `/api/payment-hub/platform/facilities` | List platform facilities | Staff session | `payment_hub.assign` | — | — | `hub.listPlatformFacilities` | `src/payment-hub/routes.ts:87` |
| POST | `/api/payment-hub/platform/integrations/:id/production-decision` | Create action on a production decision | Staff session | `payment_hub.production.approve` | — | — | `hub.decideProduction` | `src/payment-hub/routes.ts:164` |
| POST | `/api/payment-hub/platform/providers` | Create a provider | Staff session | `payment_hub.global.manage` | — | — | `hub.registerProvider` | `src/payment-hub/routes.ts:95` |
| PATCH | `/api/payment-hub/platform/providers/:id` | Update a provider | Staff session | `payment_hub.global.manage` | — | — | `hub.updateProvider` | `src/payment-hub/routes.ts:105` |
| PUT | `/api/payment-hub/platform/providers/:id/capabilities/:capability` | Update a capability | Staff session | `payment_hub.global.manage` | — | — | `hub.updateProviderCapability` | `src/payment-hub/routes.ts:132` |
| PUT | `/api/payment-hub/platform/providers/:id/environments/:environment` | Update an environment | Staff session | `payment_hub.global.manage` | — | — | `hub.updateProviderEnvironment` | `src/payment-hub/routes.ts:116` |
| PUT | `/api/payment-hub/platform/providers/:id/facilities/:facilityId` | Update a facility | Staff session | `payment_hub.assign` | — | — | `hub.assignProvider` | `src/payment-hub/routes.ts:148` |
| POST | `/api/payment-hub/webhooks/mpesa` | The existing Daraja reference does not establish a facility-specific, provider-authenticated callback contract. A guessed signature or a shared bearer secret would falsely imply verification. Reject every delivery until a reviewed provider- | Staff session | — | — | — | — | `src/payment-hub/webhook.routes.ts:18` |

## /api/payroll

29 routes.

5 distinct permission codes are required across this prefix: `payroll.read`, `payroll.manage`, `payroll.approve`, `payroll.statutory.manage`, `payroll.post`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/payroll/account-settings` | List account settings | Staff session | `payroll.read` | — | facility | `workforce.getPayrollAccountSettings` | `src/routes/workforce.routes.ts:675` |
| PUT | `/api/payroll/account-settings` | Update an account setting | Staff session | `payroll.manage`, `payroll.approve` | — | facility | `workforce.savePayrollAccountSettings` | `src/routes/workforce.routes.ts:689` |
| GET | `/api/payroll/accounts` | List accounts | Staff session | `payroll.read` | — | facility | `workforce.listPayrollAccounts` | `src/routes/workforce.routes.ts:661` |
| POST | `/api/payroll/components` | Create a component | Staff session | `payroll.manage` | — | facility | `workforce.createPayComponent` | `src/routes/workforce.routes.ts:705` |
| DELETE | `/api/payroll/components/:id` | Delete a component | Staff session | `payroll.manage` | — | facility | `workforce.deactivatePayComponent` | `src/routes/workforce.routes.ts:719` |
| GET | `/api/payroll/employees` | List employees | Staff session | `payroll.read` | — | facility | `workforce.listEmployees` | `src/routes/workforce.routes.ts:918` |
| GET | `/api/payroll/employees/:id` | Read an employee | Staff session | `payroll.read` | — | facility | `workforce.employeeDetail` | `src/routes/workforce.routes.ts:931` |
| PUT | `/api/payroll/employees/:id/salary` | Update a salary | Staff session | `payroll.manage` | — | facility | `workforce.setEmployeeSalary` | `src/routes/workforce.routes.ts:954` |
| GET | `/api/payroll/form-profiles` | Statutory form profiles and extracts. Reading a P9/P10 extract is `payroll.read`; recording which published form version the facility produces is `payroll.statutory.manage`, the same privilege that lets someone record the statutory rates th | Staff session | `payroll.read` | — | facility | `workforce.listFormProfiles` | `src/routes/workforce.routes.ts:871` |
| POST | `/api/payroll/form-profiles` | Create a form profile | Staff session | `payroll.statutory.manage` | — | facility | `workforce.createFormProfile` | `src/routes/workforce.routes.ts:885` |
| GET | `/api/payroll/history` | History | Staff session | `payroll.read` | — | facility | `workforce.payrollHistory` | `src/routes/workforce.routes.ts:984` |
| GET | `/api/payroll/payslips/:id` | Read a payslip | Staff session | `payroll.read` | — | facility | `workforce.payslipDetail` | `src/routes/workforce.routes.ts:847` |
| GET | `/api/payroll/periods` | List periods | Staff session | `payroll.read` | — | facility | `workforce.listPeriods` | `src/routes/workforce.routes.ts:739` |
| POST | `/api/payroll/periods` | Create a period | Staff session | `payroll.manage` | — | facility | `workforce.createPeriod` | `src/routes/workforce.routes.ts:753` |
| POST | `/api/payroll/periods/:id/calculate` | Create action on a calculate | Staff session | `payroll.manage` | — | facility | `workforce.calculateRun` | `src/routes/workforce.routes.ts:767` |
| POST | `/api/payroll/preview` | Preview | Staff session | `payroll.read` | — | facility | `workforce.previewPayroll` | `src/routes/workforce.routes.ts:647` |
| GET | `/api/payroll/readiness` | List readiness | Staff session | `payroll.read` | — | facility | `workforce.payrollReadiness` | `src/routes/workforce.routes.ts:998` |
| GET | `/api/payroll/runs/:id` | Read a run | Staff session | `payroll.read` | — | facility | `workforce.runDetail` | `src/routes/workforce.routes.ts:783` |
| POST | `/api/payroll/runs/:id/approve` | Approve: runs approve | Staff session | `payroll.approve` | — | facility | `workforce.approveRun` | `src/routes/workforce.routes.ts:799` |
| POST | `/api/payroll/runs/:id/post` | Post: runs post | Staff session | `payroll.post` | — | facility | `workforce.postRun` | `src/routes/workforce.routes.ts:815` |
| GET | `/api/payroll/runs/:id/reports` | Read a report | Staff session | `payroll.read` | — | facility | `workforce.payrollRunReports` | `src/routes/workforce.routes.ts:969` |
| POST | `/api/payroll/runs/:id/reverse` | Reverse: runs reverse | Staff session | `payroll.post` | — | facility | `workforce.reversePayrollRun` | `src/routes/workforce.routes.ts:831` |
| GET | `/api/payroll/statutory-extract` | List statutory extract | Staff session | `payroll.read` | — | facility | `workforce.statutoryFormExtract` | `src/routes/workforce.routes.ts:899` |
| GET | `/api/payroll/statutory-rulebook` | List statutory rulebook | Staff session | `payroll.read` | — | facility | `workforce.statutoryRulebook` | `src/routes/workforce.routes.ts:612` |
| POST | `/api/payroll/statutory-rulebook/install` | Create an install | Staff session | `payroll.statutory.manage` | — | facility | `workforce.installStatutoryRulebook` | `src/routes/workforce.routes.ts:631` |
| GET | `/api/payroll/statutory-versions` | List statutory versions | Staff session | `payroll.read` | — | facility | `workforce.listStatutoryVersions` | `src/routes/workforce.routes.ts:565` |
| POST | `/api/payroll/statutory-versions` | Create a statutory version | Staff session | `payroll.statutory.manage` | — | facility | `workforce.createStatutoryVersion` | `src/routes/workforce.routes.ts:579` |
| POST | `/api/payroll/statutory-versions/:id/status` | Create action on a status | Staff session | `payroll.statutory.manage` | — | facility | `workforce.setStatutoryVersionStatus` | `src/routes/workforce.routes.ts:593` |
| POST | `/api/payroll/statutory-versions/:id/verify` | Verify: statutory versions verify | Staff session | `payroll.statutory.manage` | — | facility | `workforce.verifyStatutoryVersion` | `src/routes/workforce.routes.ts:1018` |

## /api/pharmacy

2 routes.

Facility module gate: `pharmacy`.

1 distinct permission codes are required across this prefix: `pharmacy.dispense`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/pharmacy/dispense` | Create a dispense | Staff session | `pharmacy.dispense` | — | — | `inventory.dispenseFefoScoped` | `src/routes/pharmacy.routes.ts:321` |
| POST | `/api/pharmacy/dispense/status` | The retry identity is in the request body, not the URL/access log. | Staff session | `pharmacy.dispense` | — | — | `inventory.getDispenseRequestStatusScoped` | `src/routes/pharmacy.routes.ts:298` |

## /api/platform

21 routes.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/platform/facilities` | POST /api/platform/facilities Create a facility and its initial onboarding record atomically. | Staff session | `requireSuperAdmin` | body `createFacilitySchema` | — | `db.transaction` | `src/routes/platform/facilities.routes.ts:40` |
| PATCH | `/api/platform/facilities/:id` | PATCH /api/platform/facilities/:id Update facility configuration without permitting tenant reassignment. | Staff session | `requireSuperAdmin` | body `updateFacilitySchema` | — | `db.transaction` | `src/routes/platform/facilities.routes.ts:208` |
| GET | `/api/platform/facilities/:id/onboarding` | GET /api/platform/facilities/:id/onboarding Retrieve the existing onboarding record for a facility. | Staff session | `requireSuperAdmin` | — | — | `eq()` | `src/routes/platform/facilities.routes.ts:152` |
| POST | `/api/platform/facilities/:id/onboarding` | POST /api/platform/facilities/:id/onboarding Create onboarding only when no record exists. | Staff session | `requireSuperAdmin` | — | — | `db.transaction` | `src/routes/platform/facilities.routes.ts:279` |
| GET | `/api/platform/facility-admin-invitations` | GET /api/platform/facility-admin-invitations List invitation metadata without exposing token hashes. | Staff session | `requireSuperAdmin` | — | — | `rows.map` | `src/routes/platform/invitations.routes.ts:201` |
| POST | `/api/platform/facility-admin-invitations` | POST /api/platform/facility-admin-invitations Create a secure invitation for a facility administrator (Platform Super Admin only). | Staff session | `requireSuperAdmin` | body `createFacilityAdminInvitationSchema` | — | `now.getTime` | `src/routes/platform/invitations.routes.ts:28` |
| POST | `/api/platform/facility-admin-invitations/:id/reissue` | POST /api/platform/facility-admin-invitations/:id/reissue Replace the old token and extend the invitation by 48 hours. | Staff session | `requireSuperAdmin` | — | — | `now.getTime` | `src/routes/platform/invitations.routes.ts:309` |
| POST | `/api/platform/facility-admin-invitations/:id/revoke` | POST /api/platform/facility-admin-invitations/:id/revoke Revoke an invitation that has not already been accepted or revoked. | Staff session | `requireSuperAdmin` | — | — | `queries.logAuditEvent` | `src/routes/platform/invitations.routes.ts:253` |
| POST | `/api/platform/rbac/catalogue/apply` | POST /api/platform/rbac/catalogue/apply Create the catalogue roles this tenant does not have yet (additive only). | Staff session | — | body `applyRbacCatalogueSchema` | — | `STAFF_ROLE_CATALOGUE.map` | `src/routes/platform/rbac.routes.ts:262` |
| GET | `/api/platform/rbac/roles` | GET /api/platform/rbac/roles Return real database roles, their current permission assignments, and the permission catalogue. | Staff session | — | query `rbacRolesQuerySchema` | — | `roleRows.map` | `src/routes/platform/rbac.routes.ts:39` |
| PUT | `/api/platform/rbac/roles/:id/permissions` | PUT /api/platform/rbac/roles/:id/permissions Save a facility-specific permission override without changing shared defaults. | Staff session | — | body `updateRolePermissionsBodySchema` | — | `message.includes` | `src/routes/platform/rbac.routes.ts:471` |
| POST | `/api/platform/subscription-payments/:paymentId/verify` | Verify: subscription payments verify | Staff session | `requireSuperAdmin` | — | — | `db.transaction` | `src/routes/platform/subscriptions.routes.ts:335` |
| GET | `/api/platform/subscription-periods` | List subscription periods | Staff session | `requireSuperAdmin` | — | — | `and()` | `src/routes/platform/subscriptions.routes.ts:41` |
| POST | `/api/platform/subscription-periods` | Create a subscription period | Staff session | `requireSuperAdmin` | — | — | `db.transaction` | `src/routes/platform/subscriptions.routes.ts:99` |
| GET | `/api/platform/subscription-periods/:id/payments` | Read a payment | Staff session | `requireSuperAdmin` | — | — | `parseId()` | `src/routes/platform/subscriptions.routes.ts:214` |
| POST | `/api/platform/subscription-periods/:id/payments` | Create action on a payment | Staff session | `requireSuperAdmin` | — | — | `paymentDate.getTime` | `src/routes/platform/subscriptions.routes.ts:247` |
| POST | `/api/platform/subscription-periods/:id/price-changes` | Create action on a price change | Staff session | `requireSuperAdmin` | — | — | `date.setUTCDate` | `src/routes/platform/subscriptions.routes.ts:819` |
| POST | `/api/platform/subscription-periods/:id/reactivate` | Reactivate: subscription periods reactivate | Staff session | `requireSuperAdmin` | — | — | `db.transaction` | `src/routes/platform/subscriptions.routes.ts:634` |
| POST | `/api/platform/subscription-periods/:id/suspend` | Suspend: subscription periods suspend | Staff session | `requireSuperAdmin` | — | — | `db.transaction` | `src/routes/platform/subscriptions.routes.ts:464` |
| POST | `/api/platform/tenants` | POST /api/platform/tenants Create a tenant and provision its tenant-scoped FACILITY_ADMIN and staff roles. | Staff session | `requireSuperAdmin` | body `createTenantSchema` | — | `db.transaction` | `src/routes/platform/tenants.routes.ts:114` |
| PATCH | `/api/platform/tenants/:id` | PATCH /api/platform/tenants/:id Update tenant configuration. | Staff session | `requireSuperAdmin` | body `updateTenantSchema` | — | `queries.logAuditEvent` | `src/routes/platform/tenants.routes.ts:253` |

## /api/portal

42 routes.

6 distinct permission codes are required across this prefix: `portal.accounts.manage`, `portal.audit.read`, `patients.read`, `portal.invite`, `portal.invites.manage`, `portal.settings.manage`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/portal/access-history` | List access history | Patient portal | — | — | — | `listPortalRecordAccessHistory()` | `src/portal/portal.routes.ts:422` |
| GET | `/api/portal/admin/accounts` | List admin accounts | Staff session | `portal.accounts.manage` | — | — | `searchPortalAccounts()` | `src/portal/portal-admin.routes.ts:261` |
| GET | `/api/portal/admin/accounts/:accountId` | Read an account | Staff session | `portal.accounts.manage` | — | — | `getPortalAccountDetail()` | `src/portal/portal-admin.routes.ts:287` |
| GET | `/api/portal/admin/accounts/:accountId/card` | A staff member viewing a patient's card SVG is an auditable read. | Staff session | `portal.accounts.manage` | — | — | `getPortalAccountDetail()` | `src/portal/portal-admin.routes.ts:522` |
| POST | `/api/portal/admin/accounts/:accountId/force-reset` | Create action on a force reset | Staff session | `portal.accounts.manage` | — | — | `forcePortalPasswordReset()` | `src/portal/portal-admin.routes.ts:384` |
| POST | `/api/portal/admin/accounts/:accountId/reactivate` | Reactivate: accounts reactivate | Staff session | `portal.accounts.manage` | — | — | `reactivatePortalAccount()` | `src/portal/portal-admin.routes.ts:332` |
| POST | `/api/portal/admin/accounts/:accountId/revoke` | Revoke: accounts revoke | Staff session | `portal.accounts.manage` | — | — | `revokePortalAccount()` | `src/portal/portal-admin.routes.ts:358` |
| POST | `/api/portal/admin/accounts/:accountId/suspend` | Suspend: accounts suspend | Staff session | `portal.accounts.manage` | — | — | `suspendPortalAccount()` | `src/portal/portal-admin.routes.ts:306` |
| GET | `/api/portal/admin/audit` | Audit trail: admin audit | Staff session | `portal.audit.read` | — | — | `listPortalAuditTrail()` | `src/portal/portal-admin.routes.ts:406` |
| POST | `/api/portal/admin/card/lookup` | Resolve a scanned card. Scanning is a lookup under the staff member's own session — it is not an authentication event. The response says so, so nobody mistakes a successful scan for "the patient is verified". | Staff session | `patients.read` | — | — | `resolveDigitalCard()` | `src/portal/portal-admin.routes.ts:498` |
| POST | `/api/portal/admin/invitations/:invitationId/handed-over` | Create action on a handed over | Staff session | `portal.invite` | — | — | `markHandedOver()` | `src/portal/portal-admin.routes.ts:192` |
| POST | `/api/portal/admin/invitations/:invitationId/link` | Re-issue a manual link. Returns a *new* token: the previous slip stops working the moment this succeeds. That is the correct behaviour for a lost card, and it is also why the raw token is never stored for display. | Staff session | `portal.invite` | — | — | `reissueManualLink()` | `src/portal/portal-admin.routes.ts:167` |
| POST | `/api/portal/admin/invitations/:invitationId/revoke` | Revoke: invitations revoke | Staff session | `portal.invites.manage` | — | — | `revokeInvitation()` | `src/portal/portal-admin.routes.ts:214` |
| GET | `/api/portal/admin/overview` | Overview: admin overview | Staff session | `portal.accounts.manage` | — | — | `getPortalOverviewStats()` | `src/portal/portal-admin.routes.ts:242` |
| POST | `/api/portal/admin/patients/:patientId/invitations` | Create action on an invitation | Staff session | `portal.invite` | — | — | `issueInvitation()` | `src/portal/portal-admin.routes.ts:122` |
| GET | `/api/portal/admin/patients/:patientId/status` | Read a status | Staff session | `portal.invite` | — | — | `getPatientPortalStatus()` | `src/portal/portal-admin.routes.ts:103` |
| GET | `/api/portal/admin/risks` | List admin risks | Staff session | `portal.accounts.manage` | — | — | `findPortalAccountRisks()` | `src/portal/portal-admin.routes.ts:427` |
| GET | `/api/portal/admin/settings` | List admin settings | Staff session | `portal.settings.manage` | — | — | `getPortalSettings()` | `src/portal/portal-admin.routes.ts:446` |
| PUT | `/api/portal/admin/settings` | Update a setting | Staff session | `portal.settings.manage` | — | — | `savePortalSettings()` | `src/portal/portal-admin.routes.ts:465` |
| POST | `/api/portal/admin/sharing/redeem` | Create a redeem | Staff session | `patients.read` | — | — | `redeemSharingGrant()` | `src/portal/portal-admin.routes.ts:571` |
| GET | `/api/portal/appointments` | List appointments | Patient portal | — | — | — | `listPortalAppointments()` | `src/portal/portal.routes.ts:282` |
| POST | `/api/portal/auth/activate` | Activate an account. The token arrives in the request **body**, never the URL. The browser reads it from the URL fragment (which servers never see) and posts it here, so it does not land in an access log or a Referer header. | Patient portal | — | — | — | `activateInvitation()` | `src/portal/portal.routes.ts:120` |
| POST | `/api/portal/auth/login` | Create a login | Patient portal | — | — | — | `portalLogin()` | `src/portal/portal.routes.ts:186` |
| POST | `/api/portal/auth/logout` | Create a logout | Patient portal | — | — | — | `bearerOf()` | `src/portal/portal.routes.ts:216` |
| GET | `/api/portal/card` | List card | Patient portal | — | — | — | `getDigitalCard()` | `src/portal/portal.routes.ts:433` |
| POST | `/api/portal/card` | Create a card | Patient portal | — | — | — | `issueDigitalCard()` | `src/portal/portal.routes.ts:442` |
| GET | `/api/portal/discharge-summaries` | List discharge summaries | Patient portal | — | — | — | `listPortalDischargeSummaries()` | `src/portal/portal.routes.ts:291` |
| GET | `/api/portal/documents` | List documents | Patient portal | — | — | — | `svc.portalDocumentPage` | `src/documents/patient-documents.routes.ts:217` |
| GET | `/api/portal/documents/:id` | Read a document | Patient portal | — | — | — | `svc.portalDocumentDetail` | `src/documents/patient-documents.routes.ts:235` |
| GET | `/api/portal/documents/:id/file` | Read a file | Patient portal | — | — | — | `svc.portalPatientDocuments` | `src/documents/patient-documents.routes.ts:242` |
| GET | `/api/portal/documents/:id/history` | History: documents history | Patient portal | — | — | — | `svc.portalDocumentHistory` | `src/documents/patient-documents.routes.ts:226` |
| GET | `/api/portal/laboratory` | List laboratory | Patient portal | — | — | — | `listPortalLabResults()` | `src/portal/portal.routes.ts:264` |
| GET | `/api/portal/me` | List me | Patient portal | — | — | — | `getPortalAccountSummary()` | `src/portal/portal.routes.ts:232` |
| GET | `/api/portal/medications` | List medications | Patient portal | — | — | — | `listPortalMedications()` | `src/portal/portal.routes.ts:273` |
| GET | `/api/portal/overview` | Overview | Patient portal | — | — | — | `getPortalOverview()` | `src/portal/portal.routes.ts:241` |
| POST | `/api/portal/password` | Create a password | Patient portal | — | — | — | `changePortalPassword()` | `src/portal/portal.routes.ts:465` |
| POST | `/api/portal/records/correction-request` | Create a correction request | Patient portal | — | — | — | `requestRecordCorrection()` | `src/portal/portal.routes.ts:365` |
| GET | `/api/portal/records/download` (file) | Download. Generated on the fly and streamed with `Content-Disposition: attachment`. There is no stored file and no public URL, so a link forwarded to the wrong person resolves to 401 unless they also hold a live portal session. | Patient portal | — | — | — | `buildPortalMedicalRecord()` | `src/portal/portal.routes.ts:308` |
| GET | `/api/portal/sharing` | List sharing | Patient portal | — | — | — | `listSharingGrants()` | `src/portal/portal.routes.ts:388` |
| POST | `/api/portal/sharing` | Create a sharing | Patient portal | — | — | — | `createSharingGrant()` | `src/portal/portal.routes.ts:397` |
| POST | `/api/portal/sharing/:id/revoke` | Revoke: sharing revoke | Patient portal | — | — | — | `revokeSharingGrant()` | `src/portal/portal.routes.ts:413` |
| GET | `/api/portal/visits` | List visits | Patient portal | — | — | — | `listPortalVisits()` | `src/portal/portal.routes.ts:255` |

## /api/procedures

2 routes.

Facility module gate: `opd`.

2 distinct permission codes are required across this prefix: `clinical.read`, `clinical.create`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/procedures` | List procedures | Staff session | `clinical.read` | — | — | `queries.getProceduresScoped` | `src/routes/diagnoses.routes.ts:92` |
| POST | `/api/procedures` | Create a procedure | Staff session | `clinical.create` | — | — | `queries.recordProcedureScoped` | `src/routes/diagnoses.routes.ts:122` |

## /api/procurement

25 routes.

Facility module gate: `procurement`.

4 distinct permission codes are required across this prefix: `procurement.read`, `procurement.complete`, `procurement.create`, `procurement.approve`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/procurement/goods-received` | List goods received | Staff session | `procurement.read` | — | facility | `receiving.listGoodsReceivedNotes` | `src/routes/procurement-workflow.routes.ts:234` |
| POST | `/api/procurement/goods-received` | Create a goods received | Staff session | `procurement.read`, `procurement.complete` | — | facility | `receiving.postGoodsReceivedNote` | `src/routes/procurement-workflow.routes.ts:265` |
| GET | `/api/procurement/goods-received/:id` | Read a goods received | Staff session | `procurement.read` | — | facility | `receiving.getGoodsReceivedNote` | `src/routes/procurement-workflow.routes.ts:280` |
| GET | `/api/procurement/purchase-orders/:id/outstanding` | Read an outstanding | Staff session | `procurement.read` | — | facility | `receiving.outstandingOrderLines` | `src/routes/procurement-workflow.routes.ts:249` |
| GET | `/api/procurement/requisitions` | List requisitions | Staff session | `procurement.read` | — | facility | `requisitions.listRequisitions` | `src/routes/procurement-workflow.routes.ts:92` |
| POST | `/api/procurement/requisitions` | Create a requisition | Staff session | `procurement.read`, `procurement.create` | — | facility | `requisitions.createRequisition` | `src/routes/procurement-workflow.routes.ts:129` |
| GET | `/api/procurement/requisitions/:id` | Read a requisition | Staff session | `procurement.read` | — | facility | `requisitions.getRequisition` | `src/routes/procurement-workflow.routes.ts:113` |
| PUT | `/api/procurement/requisitions/:id` | Update a requisition | Staff session | `procurement.read`, `procurement.create` | — | facility | `requisitions.updateRequisition` | `src/routes/procurement-workflow.routes.ts:144` |
| POST | `/api/procurement/requisitions/:id/approve` | Approve: requisitions approve | Staff session | `procurement.read`, `procurement.approve` | — | facility | `requisitions.decideRequisition` | `src/routes/procurement-workflow.routes.ts:179` |
| POST | `/api/procurement/requisitions/:id/convert` | Create action on a convert | Staff session | `procurement.read`, `procurement.create` | — | facility | `requisitions.convertRequisition` | `src/routes/procurement-workflow.routes.ts:215` |
| POST | `/api/procurement/requisitions/:id/reject` | Reject: requisitions reject | Staff session | `procurement.read`, `procurement.approve` | — | facility | `requisitions.decideRequisition` | `src/routes/procurement-workflow.routes.ts:197` |
| POST | `/api/procurement/requisitions/:id/submit` | Submit: requisitions submit | Staff session | `procurement.read`, `procurement.create` | — | facility | `requisitions.submitRequisition` | `src/routes/procurement-workflow.routes.ts:161` |
| GET | `/api/procurement/supplier-credit-notes` | List supplier credit notes | Staff session | `procurement.read` | — | facility | `returns.listSupplierCreditNotes` | `src/routes/procurement-workflow.routes.ts:485` |
| POST | `/api/procurement/supplier-credit-notes` | Create a supplier credit note | Staff session | `procurement.read`, `procurement.complete` | — | facility | `returns.createSupplierCreditNote` | `src/routes/procurement-workflow.routes.ts:529` |
| GET | `/api/procurement/supplier-credit-notes/:id` | Read a supplier credit note | Staff session | `procurement.read` | — | facility | `returns.getSupplierCreditNote` | `src/routes/procurement-workflow.routes.ts:513` |
| GET | `/api/procurement/supplier-invoices` | List supplier invoices | Staff session | `procurement.read` | — | facility | `receiving.listSupplierInvoices` | `src/routes/procurement-workflow.routes.ts:298` |
| POST | `/api/procurement/supplier-invoices` | Create a supplier invoice | Staff session | `procurement.read`, `procurement.complete` | — | facility | `receiving.createSupplierInvoice` | `src/routes/procurement-workflow.routes.ts:333` |
| GET | `/api/procurement/supplier-invoices/:id` | Read a supplier invoice | Staff session | `procurement.read` | — | facility | `receiving.getSupplierInvoice` | `src/routes/procurement-workflow.routes.ts:317` |
| GET | `/api/procurement/supplier-invoices/:id/match` | Read a match | Staff session | `procurement.read` | — | facility | `matching.readMatch` | `src/routes/procurement-workflow.routes.ts:367` |
| POST | `/api/procurement/supplier-invoices/:id/match` | Create action on a match | Staff session | `procurement.read`, `procurement.complete` | — | facility | `matching.matchSupplierInvoice` | `src/routes/procurement-workflow.routes.ts:384` |
| POST | `/api/procurement/supplier-invoices/:id/match-override` | Create action on a match override | Staff session | `procurement.read`, `procurement.complete` | — | facility | `matching.overrideMatch` | `src/routes/procurement-workflow.routes.ts:410` |
| POST | `/api/procurement/supplier-invoices/:id/payments` | Create action on a payment | Staff session | `procurement.read`, `procurement.complete` | — | facility | `receiving.paySupplierInvoice` | `src/routes/procurement-workflow.routes.ts:348` |
| GET | `/api/procurement/supplier-returns` | List supplier returns | Staff session | `procurement.read` | — | facility | `returns.listSupplierReturns` | `src/routes/procurement-workflow.routes.ts:430` |
| POST | `/api/procurement/supplier-returns` | Create a supplier return | Staff session | `procurement.read`, `procurement.complete` | — | facility | `returns.postSupplierReturn` | `src/routes/procurement-workflow.routes.ts:468` |
| GET | `/api/procurement/supplier-returns/:id` | Read a supplier return | Staff session | `procurement.read` | — | facility | `returns.getSupplierReturn` | `src/routes/procurement-workflow.routes.ts:452` |

## /api/public-health

4 routes.

Facility module gate: `public_health`.

2 distinct permission codes are required across this prefix: `reports.read`, `public_health.reports.create`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/public-health/reports` | List reports | Staff session | `reports.read` | — | facility | `queries.getFacilityByIdScoped` | `src/routes/domains/public-health.routes.ts:45` |
| POST | `/api/public-health/reports` | Create a report | Staff session | `public_health.reports.create` | — | — | `resolveSurveillanceScope()` | `src/routes/domains/public-health.routes.ts:197` |
| POST | `/api/public-health/reports/:id/correction` | Create action on a correction | Staff session | `public_health.reports.create` | — | — | `resolveSurveillanceScope()` | `src/routes/domains/public-health.routes.ts:171` |
| GET | `/api/public-health/reports/summary` | Summary: reports summary | Staff session | `reports.read` | — | — | `resolveSurveillanceScope()` | `src/routes/domains/public-health.routes.ts:149` |

## /api/purchase-orders

8 routes.

Facility module gate: `procurement`.

4 distinct permission codes are required across this prefix: `procurement.read`, `procurement.create`, `procurement.delete`, `procurement.update`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/purchase-orders` | List purchaseorders | Staff session | `procurement.read` | — | facility | `queries.getPurchaseOrders` | `src/routes/procurement.routes.ts:150` |
| POST | `/api/purchase-orders` | Create a purchase order | Staff session | `procurement.create` | — | facility | `queries.createPurchaseOrder` | `src/routes/procurement.routes.ts:178` |
| DELETE | `/api/purchase-orders/:id` | Delete a purchase order | Staff session | `procurement.read`, `procurement.delete` | — | facility | `procurement.transitionPurchaseOrder` | `src/routes/procurement.routes.ts:292` |
| GET | `/api/purchase-orders/:id` | Read a purchase order | Staff session | `procurement.read` | — | facility | `procurement.purchaseOrderDetails` | `src/routes/procurement.routes.ts:163` |
| PUT | `/api/purchase-orders/:id` | Update a purchase order | Staff session | `procurement.read`, `procurement.update` | — | facility | `procurement.updatePurchaseOrder` | `src/routes/procurement.routes.ts:222` |
| POST | `/api/purchase-orders/:id/approve` | Approve | Staff session | `procurement.read` | — | facility | `procurement.transitionPurchaseOrder` | `src/routes/procurement.routes.ts:239` |
| POST | `/api/purchase-orders/:id/complete` | Complete | Staff session | `procurement.read` | — | facility | `procurement.transitionPurchaseOrder` | `src/routes/procurement.routes.ts:275` |
| POST | `/api/purchase-orders/:id/reject` | Reject | Staff session | `procurement.read` | — | facility | `procurement.transitionPurchaseOrder` | `src/routes/procurement.routes.ts:257` |

## /api/queues

3 routes.

Facility module gate: `reception`.

3 distinct permission codes are required across this prefix: `appointments.read`, `appointments.create`, `appointments.update`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/queues` | List queues | Staff session | `appointments.read` | — | facility | `queries.getFacilityByIdScoped` | `src/routes/queues.routes.ts:27` |
| POST | `/api/queues` | Create a queue | Staff session | `appointments.create` | body `createQueueEntryBodySchema` | — | `queries.createQueueEntry` | `src/routes/queues.routes.ts:62` |
| PUT | `/api/queues/:id/status` | Update a status | Staff session | `appointments.update` | body `updateQueueStatusBodySchema` | — | `queries.updateQueueStatusScoped` | `src/routes/queues.routes.ts:82` |

## /api/radiology-orders

3 routes.

Facility module gate: `radiology`.

5 distinct permission codes are required across this prefix: `clinical.read`, `laboratory.read`, `clinical.create`, `clinical.update`, `laboratory.results.enter`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/radiology-orders` | List radiologyorders | Staff session | `clinical.read`, `laboratory.read` | — | facility | `queries.getRadiologyOrders` | `src/routes/radiology.routes.ts:32` |
| POST | `/api/radiology-orders` | Create a radiology order | Staff session | `clinical.create` | body `createRadiologyOrderBodySchema` | facility | `queries.requirePatientInTenant` | `src/routes/radiology.routes.ts:52` |
| PUT | `/api/radiology-orders/:id/report` | Update a report | Staff session | `clinical.update`, `laboratory.results.enter` | body `radiologyReportBodySchema` | facility | `queries.getRadiologyOrderScoped` | `src/routes/radiology.routes.ts:121` |

## /api/ready

1 routes.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/ready` | List ready | Public | — | — | — | `db.execute` | `src/routes/system.routes.ts:82` |

## /api/reporting

7 routes.

Facility module gate: `analytics`.

4 distinct permission codes are required across this prefix: `reports.read`, `billing.read`, `inpatient.read`, `patients.read`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/reporting/centre/:reportId/export` | Export: centre export | Staff session | `reports.read` | — | — | `generateReport()` | `src/routes/domains/report-centre.routes.ts:92` |
| POST | `/api/reporting/centre/:reportId/generate` | Create action on a generate | Staff session | `reports.read` | — | — | `generateReport()` | `src/routes/domains/report-centre.routes.ts:68` |
| POST | `/api/reporting/centre/:reportId/options` | Search terms are sent in the authenticated body, not a URL that proxies may log. | Staff session | `reports.read` | — | — | `listReportOptions()` | `src/routes/domains/report-centre.routes.ts:54` |
| POST | `/api/reporting/centre/overview` | The landing page's headline figures. They are aggregates, so there is no patient identity to log; each figure applies its own permission and module gate and reports why it is missing rather than returning a zero. | Staff session | `reports.read` | — | — | `getReportingOverview()` | `src/routes/domains/report-centre.routes.ts:43` |
| GET | `/api/reporting/financial-transactions` | List financial transactions | Staff session | `reports.read`, `billing.read` | — | — | `parseOptionalPositiveId()` | `src/routes/domains/billing-analytics.routes.ts:57` |
| GET | `/api/reporting/occupancy-trend` | List occupancy trend | Staff session | `reports.read`, `inpatient.read` | — | facility | `reporting.getOccupancyTrendScoped` | `src/routes/domains/billing-analytics.routes.ts:165` |
| GET | `/api/reporting/operations` | List operations | Staff session | `reports.read`, `inpatient.read`, `patients.read` | — | facility | `reporting.getOperationsReportScoped` | `src/routes/domains/billing-analytics.routes.ts:93` |

## /api/service-tariff-links

3 routes.

2 distinct permission codes are required across this prefix: `tariffs.read`, `tariffs.manage`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/service-tariff-links` | List servicetarifflinks | Staff session | `tariffs.read` | — | — | `resolveTariffFacility()` | `src/routes/domains/service-tariff-links.routes.ts:56` |
| POST | `/api/service-tariff-links` | Create a service tariff link | Staff session | `tariffs.manage` | — | — | `serviceType.trim` | `src/routes/domains/service-tariff-links.routes.ts:120` |
| PATCH | `/api/service-tariff-links/:id/deactivate` | Deactivate | Staff session | `tariffs.manage` | — | — | `queries.logAuditEvent` | `src/routes/domains/service-tariff-links.routes.ts:315` |

## /api/staff-invitations

9 routes.

4 distinct permission codes are required across this prefix: `users.invitations.read`, `users.invite`, `users.invitations.reissue`, `users.invitations.revoke`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/staff-invitations` | List staffinvitations | Staff session | `users.invitations.read` | — | — | `getScope()` | `src/auth/staff-invitation.routes.ts:288` |
| POST | `/api/staff-invitations` | Create a staff invitation | Staff session | `users.invite` | body `createStaffInvitationBodySchema` | — | `getScope()` | `src/auth/staff-invitation.routes.ts:225` |
| POST | `/api/staff-invitations/:id/reissue` | Reissue | Staff session | `users.invitations.reissue` | — | — | `getScope()` | `src/auth/staff-invitation.routes.ts:303` |
| POST | `/api/staff-invitations/:id/revoke` | Revoke | Staff session | `users.invitations.revoke` | — | — | `getScope()` | `src/auth/staff-invitation.routes.ts:345` |
| POST | `/api/staff-invitations/manual-verification` | Manual verification. For regulators without an authorised API, and for any case where the automated check cannot decide. The source and date are recorded, and the result is never labelled as automated. | Staff session | `users.invite` | — | — | `getScope()` | `src/auth/staff-invitation.routes.ts:155` |
| GET | `/api/staff-invitations/regulators` | Regulator catalogue for the invitation popup. Read-only and static; it tells the client which regulators exist, which staff roles they cover, and which of them can be checked automatically. | Staff session | `users.invite` | — | — | `REGULATORS.map` | `src/auth/staff-invitation.routes.ts:85` |
| GET | `/api/staff-invitations/roles` | List roles | Staff session | `users.invite` | — | — | `getScope()` | `src/auth/staff-invitation.routes.ts:216` |
| GET | `/api/staff-invitations/verification-dashboard` | List verification dashboard | Staff session | `users.invitations.read` | — | — | `getScope()` | `src/auth/staff-invitation.routes.ts:193` |
| POST | `/api/staff-invitations/verify-practitioner` | Pre-invitation check. Runs the registry lookup and stores the result, returning a `credentialId` that the invitation endpoint will require for a clinical role. A simulated answer is returned as simulated and is not invitable. | Staff session | `users.invite` | — | — | `getScope()` | `src/auth/staff-invitation.routes.ts:107` |

## /api/staff-roles

6 routes.

1 distinct permission codes are required across this prefix: `users.invite`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/staff-roles` | List staffroles | Staff session | `users.invite` | — | — | `search.slice` | `src/auth/staff-roles.routes.ts:102` |
| PUT | `/api/staff-roles/:userId/roles` | Replace the assignable roles on one staff account. | Staff session | `users.invite` | body `staffRoleIdsBodySchema` | — | `getScope()` | `src/auth/staff-roles.routes.ts:137` |
| PUT | `/api/staff-roles/:userId/status` | Activate or deactivate one staff account. | Staff session | `users.invite` | body `staffAccountStatusBodySchema` | — | `getScope()` | `src/auth/staff-roles.routes.ts:233` |
| GET | `/api/staff-roles/roles` | List roles | Staff session | `users.invite` | — | — | `getScope()` | `src/auth/staff-roles.routes.ts:123` |
| GET | `/api/staff-roles/roles/:roleId/permissions` | The tasks one staff role may perform, beside the tasks this facility is allowed to grant it. | Staff session | `users.invite` | — | — | `getScope()` | `src/auth/staff-roles.routes.ts:173` |
| PUT | `/api/staff-roles/roles/:roleId/permissions` | Replace the task list of one staff role. | Staff session | `users.invite` | body `staffRolePermissionsBodySchema` | — | `getScope()` | `src/auth/staff-roles.routes.ts:198` |

## /api/suppliers

4 routes.

Facility module gate: `procurement`.

4 distinct permission codes are required across this prefix: `procurement.read`, `procurement.create`, `procurement.delete`, `procurement.update`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/suppliers` | List suppliers | Staff session | `procurement.read` | — | facility | `queries.getSuppliers` | `src/routes/procurement.routes.ts:74` |
| POST | `/api/suppliers` | Create a supplier | Staff session | `procurement.create` | — | facility | `procurement.createSupplier` | `src/routes/procurement.routes.ts:103` |
| DELETE | `/api/suppliers/:id` | Delete a supplier | Staff session | `procurement.read`, `procurement.delete` | — | facility | `procurement.deactivateSupplier` | `src/routes/procurement.routes.ts:133` |
| PUT | `/api/suppliers/:id` | Update a supplier | Staff session | `procurement.read`, `procurement.update` | — | facility | `procurement.updateSupplier` | `src/routes/procurement.routes.ts:117` |

## /api/tenants

2 routes.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/tenants` | List tenants | Staff session | checked in service | — | — | `queries.getTenantsScoped` | `src/routes/domains/tenancy.routes.ts:41` |
| GET | `/api/tenants/:id` | Read a tenant | Staff session | checked in service | — | — | `queries.getTenantByIdScoped` | `src/routes/domains/tenancy.routes.ts:63` |

## /api/theatre

12 routes.

Facility module gate: `theatre`.

6 distinct permission codes are required across this prefix: `theatre.read`, `theatre.schedule.create`, `theatre.schedule.manage`, `theatre.schedule.reconcile`, `theatre.reports.read`, `theatre.rooms.manage`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/theatre/cases` | List cases | Staff session | `theatre.read` | — | facility | `theatre.listCases` | `src/routes/theatre-scheduling.routes.ts:138` |
| POST | `/api/theatre/cases` | Create a case | Staff session | `theatre.schedule.create` | body `theatreBookingCreateSchema` | facility | `theatre.createBooking` | `src/routes/theatre-scheduling.routes.ts:151` |
| POST | `/api/theatre/cases/:id/cancel` | Cancel: cases cancel | Staff session | `theatre.schedule.manage` | body `theatreCancelSchema` | facility | `theatre.cancelBooking` | `src/routes/theatre-scheduling.routes.ts:184` |
| GET | `/api/theatre/cases/:id/history` | History: cases history | Staff session | `theatre.read` | — | facility | `theatre.schedulingHistory` | `src/routes/theatre-scheduling.routes.ts:233` |
| POST | `/api/theatre/cases/:id/legacy-review` | Create action on a legacy review | Staff session | `theatre.schedule.reconcile` | body `theatreLegacyReviewSchema` | facility | `theatre.reviewLegacyReservation` | `src/routes/theatre-scheduling.routes.ts:201` |
| GET | `/api/theatre/cases/:id/legacy-reviews` | Read a legacy review | Staff session | `theatre.read` | — | facility | `theatre.legacyReviewHistory` | `src/routes/theatre-scheduling.routes.ts:218` |
| POST | `/api/theatre/cases/:id/reschedule` | Create action on a reschedule | Staff session | `theatre.schedule.manage` | body `theatreRescheduleSchema` | facility | `theatre.rescheduleBooking` | `src/routes/theatre-scheduling.routes.ts:167` |
| GET | `/api/theatre/practitioners` | List practitioners | Staff session | `theatre.read` | — | facility | `theatre.listPractitioners` | `src/routes/theatre-scheduling.routes.ts:125` |
| GET | `/api/theatre/reports/schedule` | List reports schedule | Staff session | `theatre.reports.read` | query `theatreReportQuerySchema` | facility | `theatre.scheduleReport` | `src/routes/theatre-scheduling.routes.ts:64` |
| GET | `/api/theatre/rooms` | List rooms | Staff session | `theatre.read` | — | facility | `theatre.listRooms` | `src/routes/theatre-scheduling.routes.ts:80` |
| POST | `/api/theatre/rooms` | Create a room | Staff session | `theatre.rooms.manage` | body `theatreRoomCreateSchema` | facility | `theatre.createRoom` | `src/routes/theatre-scheduling.routes.ts:93` |
| PATCH | `/api/theatre/rooms/:id` | Update a room | Staff session | `theatre.rooms.manage` | body `theatreRoomStateSchema` | facility | `theatre.setRoomState` | `src/routes/theatre-scheduling.routes.ts:108` |

## /api/theatre-cases

3 routes.

Facility module gate: `theatre`.

4 distinct permission codes are required across this prefix: `theatre.read`, `clinical.read`, `theatre.schedule.create`, `theatre.schedule.manage`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/theatre-cases` | List theatrecases | Staff session | `theatre.read`, `clinical.read` | — | facility | `queries.getTheatreCases` | `src/routes/theatre.routes.ts:16` |
| POST | `/api/theatre-cases` | The old free-text path had neither patient scope nor conflict protection. Keep validation and the URL, but refuse all writes instead of silently migrating legacy or signed records into an unaudited workflow. | Staff session | `theatre.schedule.create` | body `createTheatreCaseBodySchema` | facility | — | `src/routes/theatre.routes.ts:34` |
| PUT | `/api/theatre-cases/:id` | Update a theatre case | Staff session | `theatre.schedule.manage` | body `updateTheatreCaseBodySchema` | facility | `queries.getTheatreCaseScoped` | `src/routes/theatre.routes.ts:50` |

## /api/wards

4 routes.

Facility module gate: `inpatient`.

4 distinct permission codes are required across this prefix: `inpatient.read`, `inpatient.wards.create`, `inpatient.wards.delete`, `inpatient.wards.update`.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/wards` | List wards | Staff session | `inpatient.read` | — | — | `queries.getWardsScoped` | `src/routes/inpatient.routes.ts:257` |
| POST | `/api/wards` | Ward set-up. The board was read-only before this: wards could only exist if the demo seed had been run, so a real facility had an empty dropdown and nowhere to fill it from. These are the write paths, each with its own permission so a facil | Staff session | `inpatient.wards.create` | — | — | `wardBed.createWard` | `src/routes/inpatient.routes.ts:292` |
| DELETE | `/api/wards/:id` | Delete a ward | Staff session | `inpatient.wards.delete` | — | — | `wardBed.deleteWard` | `src/routes/inpatient.routes.ts:348` |
| PUT | `/api/wards/:id` | Update a ward | Staff session | `inpatient.wards.update` | — | — | `wardBed.updateWard` | `src/routes/inpatient.routes.ts:319` |

## /api/webhooks

1 routes.

| Method | Route | Purpose | Auth | Permission | Input | Scope | Handler | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/webhooks/sha/status` | Create a status | Public | — | — | — | — | `src/routes/sha-eclaims.routes.ts:1707` |

## Appendix: unauthenticated endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/auth/facility-admin-invitations/accept` | Accept: facility admin invitations accept |
| GET | `/api/auth/facility-admin-invitations/validate` | Public facility administrator invitation endpoints. These must be accessible before the invited user logs in. |
| POST | `/api/auth/login` | Public authentication endpoints |
| POST | `/api/auth/staff-invitations/accept` | Accept: staff invitations accept |
| GET | `/api/auth/staff-invitations/validate` | Public staff invitation endpoints. Keep these public so invited staff can validate and accept their link. |
| GET | `/api/booking/v1/availability` | List v1 availability |
| POST | `/api/booking/v1/bookings` | Create a booking |
| GET | `/api/booking/v1/bookings/:reference` | Read a booking |
| POST | `/api/booking/v1/bookings/:reference/cancel` | Cancel: bookings cancel |
| POST | `/api/booking/v1/bookings/:reference/reschedule` | Create action on a reschedule |
| GET | `/api/health` | List health |
| GET | `/api/ready` | List ready |
| POST | `/api/webhooks/sha/status` | Create a status |

## Appendix: patient portal endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/portal/access-history` | List access history |
| GET | `/api/portal/appointments` | List appointments |
| POST | `/api/portal/auth/activate` | Activate an account. The token arrives in the request **body**, never the URL. The browser reads it from the URL fragment (which servers never see) and posts it here, so it does not land in an access log or a Referer header. |
| POST | `/api/portal/auth/login` | Create a login |
| POST | `/api/portal/auth/logout` | Create a logout |
| GET | `/api/portal/card` | List card |
| POST | `/api/portal/card` | Create a card |
| GET | `/api/portal/discharge-summaries` | List discharge summaries |
| GET | `/api/portal/documents` | List documents |
| GET | `/api/portal/documents/:id` | Read a document |
| GET | `/api/portal/documents/:id/file` | Read a file |
| GET | `/api/portal/documents/:id/history` | History: documents history |
| GET | `/api/portal/laboratory` | List laboratory |
| GET | `/api/portal/me` | List me |
| GET | `/api/portal/medications` | List medications |
| GET | `/api/portal/overview` | Overview |
| POST | `/api/portal/password` | Create a password |
| POST | `/api/portal/records/correction-request` | Create a correction request |
| GET | `/api/portal/records/download` | Download. Generated on the fly and streamed with `Content-Disposition: attachment`. There is no stored file and no public URL, so a link forwarded to the wrong person resolves to 401 unless they also hold a live portal session. |
| GET | `/api/portal/sharing` | List sharing |
| POST | `/api/portal/sharing` | Create a sharing |
| POST | `/api/portal/sharing/:id/revoke` | Revoke: sharing revoke |
| GET | `/api/portal/visits` | List visits |

## Limitations

- Response bodies are described by convention, not generated per endpoint: the reference names the validated input schema and the service function, and the module manuals describe the payloads that matter.
- Purpose labels are derived from the registered path and the source comment. They are reliable enough to navigate, not a substitute for the handler.
- The reference describes the routes that exist. It does not certify them as complete, tested or exposed in the navigation; use the [traceability matrix](../DOCUMENTATION_TRACEABILITY_MATRIX.md) and the module manuals for status.
- Webhook contracts (SHA, payment hub) are described in [the integrations area](../07-integrations/README.md), because their callers are external systems rather than this UI.

## Related documents

- [System architecture](SYSTEM_ARCHITECTURE.md)
- [Authentication and authorisation](AUTHENTICATION_AND_AUTHORISATION.md)
- [Multitenancy architecture](MULTITENANCY_ARCHITECTURE.md)
- [Permissions matrix](../05-administration/PERMISSIONS_MATRIX.md)
- [Database data dictionary](DATABASE_DATA_DICTIONARY.md)

