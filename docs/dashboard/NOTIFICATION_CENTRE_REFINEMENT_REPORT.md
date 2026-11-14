# Dashboard and notification centre — implementation report

**Status:** implemented as feature work; no production deployment performed.

**Verification date:** 31 October 2026.
**Evidence:** all database records and screenshots described below are synthetic. No production data, provider connection or clinical acceptance was tested.

## What changed

The existing JaliCare HMIS was refined in place; this is not a second application or a replacement patient, billing, inventory or clinical system. The dashboard now presents, in order:

1. A compact welcome using the authenticated name and role, the selected authorized facility and MFL code, and a greeting and date in the facility's configured timezone.
2. An active operational alert strip or an explicit unavailable/all-clear message for the accessible alert sources.
3. Four selected-date KPIs: registered patients, net recorded receipts, created invoices and admission records.
4. Receipts, billing-category and patient-flow charts, with accessible value tables and the existing date filter.
5. An operational snapshot: queue tickets, triage wait, occupied beds, overdue vitals, scheduled theatre cases, open laboratory orders, low/out-of-stock items and expiry alerts. A live average triage wait is **not tracked** by the source and is displayed as unavailable rather than zero.
6. A single list of unique, permission- and module-gated workspace actions.
7. Distinct arrival/queue, ward, theatre/laboratory/stores and surveillance sections. Theatre and laboratory show up to three authorized source records; the stores link leads to the notification centre and existing Inventory workspace.
8. One facility audit feed. Known resource types receive a derived module label; other rows say “Module not recorded”. References, actor names and stored timestamps are shown where present and permitted.
9. One billing summary with billed amounts, net recorded receipts, outstanding invoice balances and an explicit unverified reconciliation status. No cohort-invalid collection rate is calculated.

The old duplicate dashboard alert, activity, billing, inventory-expiry and operational KPI blocks were consolidated. The old ten-day expiry table was removed from the dashboard, not from Inventory: the consolidated 30-day warning still includes ten-day lots, and the Inventory workspace retains batch cost, the countdown and its ten-day view. Contextual links remain where they help open the appropriate existing module. No action in the dashboard claims to complete check-in, verify a result or perform clinical care.

### Key files

- Dashboard: `src/components/modules/HospitalDashboard.tsx`, `DashboardModule.tsx`, `src/components/dashboard/{ActiveAlertStrip,DateFilter,Charts}.tsx`, `src/dashboard/{dashboard.routes,dashboard.service,dashboard.types,date-range,money,timezone}.ts`.
- Inbox UI and state: `src/components/NotificationCentre.tsx`, `src/components/Header.tsx`, `src/context/InboxContext.tsx`, `src/App.tsx`.
- Inbox backend: `src/notifications/{inbox.routes,inbox.service,inbox.types,inventory-alerts}.ts`, `src/api/clients/notifications.client.ts`, `src/api/client.ts`, `src/routes/index.ts`.
- Configuration and persistence: `drizzle/0043_notification_centre.sql`, `drizzle/meta/_journal.json`, `src/db/schema/notifications.ts`, `src/db/schema/tenancy.ts`, facility validation/types and `PlatformAdministrationModule.tsx`.
- Authorization correction: `src/routes/queues.routes.ts` now validates and resolves facility scope before returning queues, and its optional active filter is applied before the existing row limit; `src/components/Sidebar.tsx` and the theatre dashboard panel now use the structured Theatre service's `theatre.read` permission instead of unrelated inpatient/clinical permissions.
- Tests and browser harness: `src/tests/integration/{notification-inbox,dashboard}.db.spec.ts`, `src/tests/vitest/{notification-centre-ui,hospital-dashboard-ui,facility-timezone,operational-dashboard-gating}.spec.ts[x]`, `src/tests/round5.spec.ts`, `src/tests/vitest/api-domain-clients.spec.ts`, and `scripts/dashboard-browser-synthetic.mjs`.

## Sources and semantics

| Area                        | Actual source and authorization                                                                                                  | Meaning / qualification                                                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registrations and flow      | `patients`, `encounters`; registration/clinical read permissions and enabled modules                                             | Selected calendar dates; returning patients are distinct patients with encounters, not all visits.                                                                                                                                                                                                                |
| Receipts and invoices       | `billing_payments`, recorded `billing_refunds`, non-void `billing_invoices` and `billing_items`; `billing.read` and Finance      | Net receipts are recorded payments less recorded refunds **in the selected period**. They are not recognized revenue, verified external settlement or bank reconciliation. Billed categories are invoice line amounts, not cash. Outstanding is the recorded balance for invoices created in the selected period. |
| Appointments, queues, wards | `appointments`, `queues`, `beds`, `wards`, `admissions` and the existing nursing board; relevant permissions and enabled modules | Queue and bed figures are current snapshots; overdue vitals use the existing eight-hour ward-board rule and adult reference flags. Missing observations are not described as normal. Appointment times are legacy text; unsupported/invalid displayed values do not become invented appointments.                 |
| Theatre and laboratory      | `theatre_cases`, `lab_orders`, `lab_results`; `theatre.read` or `laboratory.read` and the corresponding enabled module           | Counts and samples are facility-scoped. A recorded critical laboratory flag is only an alert while that result is pending verification. The feed does not diagnose, verify, deliver or escalate a result.                                                                                                         |
| Inventory                   | Active `inventory_items` and positive-quantity `inventory_batches`; `inventory.read` and Inventory enabled                       | Recorded current stock of zero is stock-out, positive stock at/below its reorder level is low, and missing/invalid stock or reorder values require review. Expiry uses the **actual batch expiry date**, quantity, item and facility. Zero-quantity batches do not create expiry alerts.                          |
| Audit                       | Facility-scoped `audit_logs` and the permitted actor lookup; `audit.read` and Audit enabled                                      | Unknown module/actor/reference values remain explicitly unavailable rather than invented. No patient payload or audit details are exposed by the dashboard feed.                                                                                                                                                  |

Expiry has separate states: **expired** (date before facility-local today), **expires today/within seven days** (critical operational priority) and **8–30 days** (warning). Invalid expiry dates generate a review warning rather than a fabricated countdown. These inventory severities are workflow priorities, not clinical risk classifications. No notification scan changes quantities, verifies a laboratory result, creates a payment, transfers stock or performs a clinical action.

## Notification centre

The top bell shows the actual unread count across accessible sources. A red indicator remains when a critical alert is active even after it is read. The panel offers inline detail, source and timestamp, Critical/Warning/Info/Success filters, paging, individual read, mark-all read, retry, and permission-gated links to existing modules. It supports keyboard focus, Escape/close and a scrollable small-screen layout. Module links do **not** yet deep-link to a particular record; the user opens the relevant workspace to find it.

Source events are based on existing records from the last seven facility calendar days: registrations, appointments, admissions, scheduled Theatre cases, laboratory orders and verified results, invoices and recorded receipts. Event descriptions use record references, not patient names. “Receipt recorded” explicitly does not establish external settlement; result verification is an existing recorded workflow status, not proof of delivery or escalation. This inbox is separate from outbound SMS/email provider infrastructure and transient UI toasts.

`notification_alert_states` stores a stable facility/source episode and revision. Repeated scans do not create duplicate episodes; a change of urgency/expiry date or an **observed** resolution followed by recurrence produces a new unread revision. `notification_read_receipts` stores read state per tenant, facility, user and notification key. Concurrent read requests are idempotent. Marking read does not resolve the underlying condition. Reads and actual alert-state changes are audit logged without storing patient descriptions in the audit details. The browser checks about every 60 seconds while an authorized session is active, on refresh and on relevant UI changes. The GET performs an idempotent alert-state synchronization and audit write when source states change; responses are private/no-store.

### Endpoints

- `GET /api/dashboard/overview?facilityId=…&start=…&end=…` — scoped dashboard panels and current operational snapshots.
- `POST /api/dashboard/search` — scoped search, with terms kept out of URLs and patient access audit records.
- `GET /api/notifications?facilityId=…&severity=…&offset=…&limit=…` — scoped inbox, overall unread counts, active alert groups and authorized sources.
- `POST /api/notifications/read` — mark one currently authorized notification key read.
- `POST /api/notifications/read-all` — mark all currently accessible notifications read, not only the visible page/filter.
- `GET /api/queues` — now enforces facility scope, validates the optional facility identifier and supports `active=true` before the row limit; existing callers retain their default behavior.

Requests require authentication and source permissions, verify the selected tenant/facility, and respect facility enabled/hidden modules. A platform SUPER_ADMIN account is not granted facility dashboard or inbox access merely by registration. A changed facility clears previous UI state and late responses are ignored. Access to Theatre scheduling requires `theatre.read`, including its dashboard sample and navigation.

## Timezone and migration

The additive migration creates the two inbox tables and a nullable facility timezone override. A blank override inherits the tenant timezone; an administrator can configure a valid IANA timezone in the existing platform facility editor. A missing/invalid effective timezone is an explicit error, not a silent server/browser default. Existing historical `timestamp without time zone` values remain stored wall-clock values: selected date filters and displayed source timestamps do not pretend an unknown original timezone is known. A facility should validate its historical storage convention and timezone before relying on historical comparisons.

The 44-migration chain, including `0043_notification_centre.sql`, was applied only to newly created disposable local synthetic PostgreSQL databases. The historical chain includes destructive statements in `0002`; **do not replay it on an existing database**. No production migration or deployment was performed. Before any real rollout, review migration status, take and verify a backup, review an environment-specific migration/rollback plan and obtain authorization; this report is not authorization to migrate.

## Verification performed

- Full DB-required `npm test`: **189 files, 1,735 tests passed** on isolated synthetic PostgreSQL (`JALICARE_REQUIRE_DB=1`); coverage was generated. This includes existing HMIS regression tests and new inbox/dashboard HTTP, permission, timezone, UI and persistence tests.
- Focused tests cover expiry boundaries including expired/today/7/8/10/30/31 days, malformed dates, zero-quantity batches, no stock mutation, two users, tenant/facility isolation, hidden modules, no-permission states, active critical indication, alert revisions/recurrence, concurrent/idempotent receipts, audit, paging/filtering, active queue filtering before the 100-row limit, focus, failed-request retry, facility switches and late responses. Theatre-only and inpatient-only permissions are tested independently. The prior obsolete ten-day dashboard source-string test was replaced by behavior assertions for the consolidated warning plus preservation of Inventory's cost, countdown and expiry policy.
- `npm run typecheck` and `npm run format:check`: passed.
- `npm run lint`: passed with **0 errors and 74 warnings**. Warnings remain in the broader repository and should be reviewed; they are not represented as a clean lint run.
- `npm run build:deploy`: passed. Vite warns that the minified client chunk exceeds 500 kB (approximately 1.49 MB before gzip); code splitting remains follow-up work.
- `npm run verify:deploy`: passed its zero-write dry-run checks and 11 deployment tests; this is not a live deployment test. `npm run db:status:all` reported all 44 migrations applied and 0009 intact on the synthetic database.
- Guarded production-build Chromium dashboard harness: passed synthetic login, real JSON API responses, facility welcome, expiry alert display, severity filter, read and mark-all, persistence after reload, audit, critical indicator after read, date filter, search, navigation and no horizontal overflow at desktop, tablet, 390 px and 320 px mobile widths. The 320 px panel is checked for viewport bounds and unclipped severity filters.
- Existing guarded synthetic Chromium smoke: passed login, patient/triage, laboratory, pharmacy FEFO and recovery, manual refund recovery, invoice/receipt, inpatient, accounting, staff and patient-portal navigation. It reported zero uncaught browser errors and one expected unauthenticated session-probe 401.

### Actual synthetic screenshots

These were captured from the production build against a local synthetic facility; figures, names and records are not real.

- [Desktop dashboard](screenshots/refinement-desktop-synthetic.png)
- [Desktop notifications](screenshots/refinement-desktop-notifications-synthetic.png)
- [Desktop operations and workspace](screenshots/refinement-desktop-operations-synthetic.png)
- [Tablet dashboard](screenshots/refinement-tablet-synthetic.png)
- [Mobile dashboard](screenshots/refinement-mobile-synthetic.png)
- [Mobile notifications](screenshots/refinement-mobile-notifications-synthetic.png)
- [Small mobile notifications, 320 px](screenshots/refinement-small-mobile-notifications-synthetic.png)
- [Mobile lower dashboard](screenshots/refinement-mobile-lower-synthetic.png)

## Remaining limitations and rollout checks

- Alerts are discovered by authorized inbox requests/polling, not an independent server scheduler. A facility with no active authorized session will not generate new episodes until the next scan; resolution and recurrence entirely between scans cannot be observed. No push/SMS/email delivery or escalation is implied.
- The inbox recomputes accessible current alerts and the seven-day event window on each scan and serializes synchronization per facility. Large facilities need representative load testing, indexing/retention review and possibly a background/incremental architecture before scale claims. A failed source currently fails the inbox visibly as a whole; partial-source availability is not implemented. Read receipts do not yet have a retention policy.
- Patient-specific record deep links, a measured live triage-wait average, verified reconciliation and a valid same-cohort collection rate are not implemented. Existing clinical thresholds and care pathways still require facility clinical approval; this UI is not a safety certification.
- Human visual/accessibility acceptance at the facility and broader device/browser testing remain outstanding. Chromium tests use synthetic local data only. Real provider credentials, sandbox/UAT, payment/bank/claims callbacks, deployment and external integrations were not tested here.
- Existing engineering risks from the previous completion report remain, including ledger chronology/corrected reposting, independent refund approval, reconciliation and uncertain claim-dispatch recovery. See `docs/audits/FINAL_ENGINEERING_COMPLETION_REPORT.md`; this dashboard work does not close them.
