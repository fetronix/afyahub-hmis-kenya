# JaliCare enterprise UI/UX implementation

**Date:** 31 October 2026

**Branch:** `arena/06ab90a3-afyahub-hmis-kenya`

**Status:** implemented incrementally in the existing application. The earlier dashboard and notification-centre refinement is preserved. This is engineering evidence, not a production deployment, provider certification, clinical approval or facility acceptance.

## What changed

- The authenticated staff application uses one existing JaliCare shell: dark navy navigation, shared header, authorized identity and facility/tenant context, scoped global search, notification centre, responsive navigation drawer and breadcrumbs. Platform administrators use the same shell with their own navigation; the separately authenticated patient portal intentionally remains a separate surface.
- `src/index.css` centralizes the approved hospital-blue, navy, neutral and semantic colours, typography, control/surface radii, shadows, table and responsive workspace styles. The brand ramp and primary-button contrast are checked by `src/tests/design-tokens.spec.ts`.
- `src/components/ui/` provides or consolidates `PageHeader`, `PageBreadcrumbs`, `StatCard`, `SummaryCard`, `DataTable`, `SearchBar`, `FilterToolbar`, `PrimaryButton`, `SecondaryButton`, `IconButton`, `StatusBadge`, `AlertBanner`, `EmptyState`, `LoadingSkeleton`, `ErrorState`, `ConfirmationDialog`, `Modal`, `Drawer`, `DropdownMenu`, `Pagination`, `Tabs` and `FormField`. `DateRangePicker` reuses the existing dashboard date filter; `NotificationPanel` reuses the notification centre. The primitives do not own authorization or clinical/business state.
- Shared tables keep native table semantics and a keyboard-focusable horizontal scroll region. Tabs support arrow navigation; shared dialogs constrain height, keep their actions visible on small screens, trap and restore focus, and support Escape. Dropdowns have keyboard focus and navigation. `FormField` associates labels, hints and errors with native controls.
- Shared headers are used in 25 module files and shared tables in 32 module/section files. These counts are file counts, not a claim that every control in those files has been migrated.

## Module coverage

| Area                                                             | Implemented in this pass                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard and notification centre                                | Retained the approved dashboard, real scoped data and inbox; integrated the shared shell, breadcrumbs, cards, date control and notification pagination. See the [earlier refinement report](../dashboard/NOTIFICATION_CENTRE_REFINEMENT_REPORT.md) for data definitions and notification limitations.                                                                                                                                                                        |
| Patient management, reception and appointments                   | Shared headers and tables; reception uses a labelled shared appointment dialog with explicit patient/time and no prefilled clinical reason. Loading failures are visible and retryable. Registration and OPD retain their specialized workflows.                                                                                                                                                                                                                             |
| OPD, inpatient, maternity/MCH, theatre and dialysis              | Common workspace styling and headings; shared table wrappers where applicable. Existing patient, bed, maternity, theatre and dialysis workflows and their service/permission boundaries remain in place.                                                                                                                                                                                                                                                                     |
| Specialty clinics                                                | Removed dental, optical and ENT example forms whose buttons only displayed a success toast and never saved a note, prescription or charge. The specialty screen now states the limitation, opens the existing patient record, and links authorized users to existing outpatient/dialysis workspaces. Specialty-specific documentation remains unimplemented.                                                                                                                 |
| Laboratory and radiology                                         | Shared headings/tables; radiology has a labelled, bounded request dialog with no preselected patient or fabricated indication. It retrieves an authorized selected patient's details when they are outside the current directory page. A former simulated PACS connection, study ID and slice count were replaced by an explicit unverified-connection notice. Reporting still uses the existing API and the actual authenticated user's name.                               |
| Pharmacy, inventory and procurement                              | Common headings and tables. Inventory additionally uses shared tabs, search, cards and dialogs; failures are separated from empty results, stock quantities and reorder thresholds require explicit entry, and missing/ambiguous costs are not displayed as a certain valuation. Existing dispensing, lot and purchase-order services remain.                                                                                                                                |
| Billing, payments, GL and payers                                 | Common headings and table containers for billing, transactions, accounting, SHA eClaims and private-insurance workspaces. Private-insurance source failures are identified, failed primary views are unavailable rather than presented as empty, independent views remain available, and retry is provided. Claim/payment states and provider boundaries were not replaced by mock success.                                                                                  |
| Reports, MOH 705, users, facility management, settings and audit | Shared headings/tables across reporting, configuration, platform administration, patient-portal administration and audit. Surveillance explicitly labels locally recorded reports and the unavailable MOH 705 aggregate. Its UI requires a condition, counts, age group and week. The existing public-health POST now also rejects omitted counts or age group rather than inventing them; an explicit zero deaths is accepted. Existing API callers must send these fields. |

The public-health route change is a deliberate validation-contract change; it does not alter historical rows or transmit reports. Existing database column defaults still exist for other direct database writers, so they must not be interpreted as proof of observed counts. The patient directory and other existing APIs retain their server-side permissions and facility scoping.

## Screenshots from actual Chromium

All records, facility names and identities shown are synthetic. These are screenshots of the running production build, not design mockups.

| View                      | Desktop                                                                | Tablet / small mobile                                                                                 |
| ------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Patient registration      | [Desktop](screenshots/registration-desktop-synthetic.png)              | [320 px](screenshots/registration-small-mobile-synthetic.png)                                         |
| Reception and appointment | [Desktop](screenshots/reception-desktop-synthetic.png)                 | [320 px dialog](screenshots/appointment-modal-small-mobile-synthetic.png)                             |
| Inventory and batches     | [Desktop](screenshots/inventory-desktop-synthetic.png)                 | [320 px dialog](screenshots/inventory-modal-small-mobile-synthetic.png)                               |
| Radiology                 | [Desktop](screenshots/radiology-desktop-synthetic.png)                 | [320 px dialog](screenshots/radiology-modal-small-mobile-synthetic.png)                               |
| Laboratory                | [Desktop](screenshots/laboratory-desktop-synthetic.png)                | [768 px](screenshots/laboratory-tablet-synthetic.png)                                                 |
| SHA eClaims               | [Desktop](screenshots/sha-eclaims-desktop-synthetic.png)               | [320 px](screenshots/sha-eclaims-small-mobile-synthetic.png)                                          |
| Private insurance         | [Desktop](screenshots/private-insurance-desktop-synthetic.png)         | [768 px](screenshots/private-insurance-tablet-synthetic.png)                                          |
| Platform administration   | [Desktop](screenshots/platform-administration-desktop-synthetic.png)   | [320 px](screenshots/platform-administration-small-mobile-synthetic.png)                              |
| Specialty care limitation | [Desktop](screenshots/specialty-desktop-synthetic.png)                 | —                                                                                                     |
| Dashboard / notifications | [Dashboard](../dashboard/screenshots/refinement-desktop-synthetic.png) | [Notifications, 320 px](../dashboard/screenshots/refinement-small-mobile-notifications-synthetic.png) |

The private-insurance screenshot deliberately shows a tariff-source warning: the synthetic custom role is not the facility-administrator role required by the tariff endpoint. The warning is not a provider-connectivity test. Additional synthetic captures are in `docs/ui/screenshots/`.

## Verification performed

| Check                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full `npm test` with `JALICARE_REQUIRE_DB=1` | **192 files, 1,761 tests passed** against isolated local synthetic PostgreSQL with all 44 migrations already applied. Includes existing tests, 23 design-system/workflow UI tests, and three real HTTP/database public-health validation and isolation tests.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run typecheck`                          | Passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run format:check`                       | Passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run lint`                               | Passed with **0 errors and 70 warnings**; React-hooks and other warnings remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `git diff --check`                           | Passed for tracked changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run build:deploy`                       | Passed client and server builds. Vite warns that the main minified client chunk is **1,480.79 kB** (337.73 kB gzip), above its 500 kB warning threshold.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run verify:deploy`                      | Zero-write dry-run checks and **11 deployment tests passed** using the isolated synthetic configuration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run db:status:all`                      | Synthetic database reported all 44 migrations applied and migration 0009 intact. No migration was applied to a production or existing real-data database.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Guarded enterprise Chromium smoke            | Passed **23 facility modules** at 1568×882, 768×1024, 390×844 and 320×568: one shell/header/navigation, breadcrumbs and no document/main horizontal overflow. Tested keyboard scrolling of a narrow patient table; appointment, imaging and inventory dialogs at 320 px for bounded size, visible actions, blank required fields and Escape/focus where applicable. It also verified the specialty limitation and authorized dialysis link, plus separate platform-admin shell/layout at desktop, tablet and 320 px and a **403** for a platform account requesting facility invoices. The harness waits between rapid passes rather than disabling the production rate limiter. |
| Broader guarded Chromium smoke               | Passed synthetic login, pharmacy failure/retry and dispensing recovery, registration/triage, lab collection/result/verification, manual refund recovery, invoice finalization and audited print invocation, split-payment recovery, outpatient observation, inpatient admission, reviewed accounting journals, staff portal, sign-out and separate patient portal. **0 uncaught browser errors**; one expected unauthenticated `GET /api/auth/session` returned 401 before login.                                                                                                                                                                                                |

The enterprise scan checks the initially opened screens and selected representative dialogs; it does **not** exercise every nested tab, populated table, chart, or clinical action. Some source-specific 403/501 responses are expected and shown as unavailable. The broader workflow smoke is not a comprehensive end-to-end clinical validation. Tests use clearly synthetic fixtures, random bootstrap credentials and an isolated loopback database. The guarded harnesses do not contact live providers or reset a database; Chromium's sandbox was disabled only in this disposable isolated test environment.

## Remaining work and risks

1. Migration is not yet uniform at the individual-control level. Existing fixed-overlay dialogs remain in `BillingCashierModule.tsx`, `InpatientModule.tsx`, `InsuranceClaimsModule.tsx`, `PharmacyModule.tsx`, `ProcurementModule.tsx`, `StaffRolesPanel.tsx` and `StaffVerificationModal.tsx`. Many forms and actions in maternity, theatre, dialysis, payer/payment administration and staff permissions still use legacy styling; `ConfirmationDialog`, `Drawer` and `DropdownMenu` are available and tested but are not yet adopted throughout those workflows. OPD and the approved dashboard retain their specialized layouts. The finalized-invoice print table and an older dashboard table remain native intentionally.
2. The inventory batch service currently normalizes absent batch costs to zero and cannot distinguish an old unpriced lot from a confirmed zero. The UI labels these values “Zero or unpriced” and their valuations “Unconfirmed”; historical cost data needs a reviewed correction/backfill strategy, not silent reconciliation. Older default reorder thresholds may also need facility review.
3. Specialty-specific dental, optical and ENT documentation/prescribing/billing is not implemented. The dedicated dialysis workflow still requires the facility's authorized and clinically approved protocol; no clinical completion is inferred by the UI.
4. MOH 705 aggregation is unavailable in this build and local surveillance recording is not a KHIS/DHIS2 submission. Existing public-health database defaults remain a risk to direct writers outside the validated HTTP route.
5. The UI does not establish real PACS, SHA, private-insurer, bank, payment or notification-provider connectivity, acceptance or settlement. Existing clinical, claims recovery, accounting chronology/reconciliation, refund approval and provider risks described in the prior engineering and dashboard reports still apply.
6. Human accessibility, clinical and facility acceptance, broader populated-data responsive testing, performance/code splitting, approved tariffs, real authorized provider verification and a reviewed backup/migration/rollback plan remain necessary before rollout. No real production data, claims or external transfers were used.

## Reproducing the browser checks

Use the existing guarded process in [SYNTHETIC_BROWSER_SMOKE.md](../testing/SYNTHETIC_BROWSER_SMOKE.md). A loopback-only, independently verified disposable synthetic test database and local Chromium are required; the harnesses create additive synthetic fixtures and random test identities, not migrations. Build first with `npm run build:deploy`, then run `npm run test:browser:synthetic` and `ENTERPRISE_UI_SMOKE=YES node scripts/dashboard-browser-synthetic.mjs` with the documented `BROWSER_SMOKE_SYNTHETIC`, SQL and Chromium environment settings. Do not put credentials into source, screenshots or logs. The historical migration chain includes destructive statements in `0002`; never replay it against an existing or production database without a separately approved plan and verified backup.

## Changed-file manifest

This implementation-time worktree manifest includes the previously completed notification refinement as well as this enterprise UI pass. `M` means modified and `??` means newly added relative to the feature branch base; generated `build/`, `dist/` and coverage output are ignored.

```text
 M drizzle/meta/_journal.json
 M scripts/dashboard-browser-synthetic.mjs
 M scripts/synthetic-browser-smoke.mjs
 M src/App.tsx
 M src/api/client.ts
 M src/api/clients/patients-clinical.client.ts
 M src/components/Header.tsx
 M src/components/Sidebar.tsx
 M src/components/dashboard/DateFilter.tsx
 M src/components/modules/AccountingModule.tsx
 M src/components/modules/AuditLogModule.tsx
 M src/components/modules/BillingCashierModule.tsx
 M src/components/modules/ConfigurationModule.tsx
 M src/components/modules/DashboardModule.tsx
 M src/components/modules/DhaCompliancePanel.tsx
 M src/components/modules/DialysisModule.tsx
 M src/components/modules/FacilityServiceTariffsPanel.tsx
 M src/components/modules/HospitalDashboard.tsx
 M src/components/modules/InpatientModule.tsx
 M src/components/modules/InsuranceClaimsModule.tsx
 M src/components/modules/InteroperabilityModule.tsx
 M src/components/modules/InventoryModule.tsx
 M src/components/modules/LaboratoryModule.tsx
 M src/components/modules/MaternityModule.tsx
 M src/components/modules/OutpatientModule.tsx
 M src/components/modules/PatientPortalModule.tsx
 M src/components/modules/PatientRegistrationModule.tsx
 M src/components/modules/PharmacyModule.tsx
 M src/components/modules/PlatformAdministrationModule.tsx
 M src/components/modules/ProcurementModule.tsx
 M src/components/modules/PublicHealthModule.tsx
 M src/components/modules/RadiologyModule.tsx
 M src/components/modules/ReceptionQueueModule.tsx
 M src/components/modules/ReportsModule.tsx
 M src/components/modules/SpecialtyModule.tsx
 M src/components/modules/SuperAdminDashboardModule.tsx
 M src/components/modules/TariffValidationPanel.tsx
 M src/components/modules/TheatreModule.tsx
 M src/components/modules/eclaims/ClaimsLifecycleWorkspace.tsx
 M src/components/modules/eclaims/EligibilityAndBenefitsWorkspace.tsx
 M src/components/modules/eclaims/PreauthorizationWorkspace.tsx
 M src/components/modules/eclaims/RemittanceAndAdminWorkspace.tsx
 M src/components/modules/maternity/AncRegisterSection.tsx
 M src/components/modules/maternity/DeliveryRegisterSection.tsx
 M src/components/modules/maternity/ImmunisationSection.tsx
 M src/components/modules/maternity/LabourWardSection.tsx
 M src/components/modules/maternity/PostnatalCareSection.tsx
 M src/components/modules/payment-hub/PaymentTransactions.tsx
 M src/components/modules/private-insurance/BenefitsMappingsPreauthSection.tsx
 M src/components/modules/private-insurance/ClaimsAndReconciliationSection.tsx
 M src/components/modules/private-insurance/MembershipAndEligibilitySection.tsx
 M src/components/modules/private-insurance/PayerConfigurationSection.tsx
 M src/components/modules/private-insurance/PrivateInsuranceModule.tsx
 M src/dashboard/dashboard.routes.ts
 M src/dashboard/dashboard.service.ts
 M src/dashboard/dashboard.types.ts
 M src/db/queries/queues.ts
 M src/db/schema.ts
 M src/db/schema/tenancy.ts
 M src/index.css
 M src/routes/domains/public-health.routes.ts
 M src/routes/index.ts
 M src/routes/queues.routes.ts
 M src/tests/design-tokens.spec.ts
 M src/tests/integration/dashboard.db.spec.ts
 M src/tests/round5.spec.ts
 M src/tests/schema-extraction.spec.ts
 M src/tests/support/schema-contract.ts
 M src/tests/vitest/api-domain-clients.spec.ts
 M src/tests/vitest/hospital-dashboard-ui.spec.tsx
 M src/types/index.ts
 M src/validation/schemas/facility.schema.ts
?? docs/dashboard/NOTIFICATION_CENTRE_REFINEMENT_REPORT.md
?? docs/dashboard/screenshots/refinement-desktop-notifications-synthetic.png
?? docs/dashboard/screenshots/refinement-desktop-operations-synthetic.png
?? docs/dashboard/screenshots/refinement-desktop-synthetic.png
?? docs/dashboard/screenshots/refinement-mobile-lower-synthetic.png
?? docs/dashboard/screenshots/refinement-mobile-notifications-synthetic.png
?? docs/dashboard/screenshots/refinement-mobile-synthetic.png
?? docs/dashboard/screenshots/refinement-small-mobile-notifications-synthetic.png
?? docs/dashboard/screenshots/refinement-tablet-synthetic.png
?? docs/ui/ENTERPRISE_UI_IMPLEMENTATION_REPORT.md
?? docs/ui/screenshots/appointment-modal-small-mobile-synthetic.png
?? docs/ui/screenshots/audit-desktop-synthetic.png
?? docs/ui/screenshots/billing-desktop-synthetic.png
?? docs/ui/screenshots/billing-small-mobile-synthetic.png
?? docs/ui/screenshots/inventory-desktop-synthetic.png
?? docs/ui/screenshots/inventory-modal-small-mobile-synthetic.png
?? docs/ui/screenshots/inventory-small-mobile-synthetic.png
?? docs/ui/screenshots/laboratory-desktop-synthetic.png
?? docs/ui/screenshots/laboratory-tablet-synthetic.png
?? docs/ui/screenshots/maternity-desktop-synthetic.png
?? docs/ui/screenshots/platform-administration-desktop-synthetic.png
?? docs/ui/screenshots/platform-administration-small-mobile-synthetic.png
?? docs/ui/screenshots/private-insurance-desktop-synthetic.png
?? docs/ui/screenshots/private-insurance-tablet-synthetic.png
?? docs/ui/screenshots/radiology-desktop-synthetic.png
?? docs/ui/screenshots/radiology-modal-small-mobile-synthetic.png
?? docs/ui/screenshots/radiology-small-mobile-synthetic.png
?? docs/ui/screenshots/reception-desktop-synthetic.png
?? docs/ui/screenshots/reception-small-mobile-synthetic.png
?? docs/ui/screenshots/registration-desktop-synthetic.png
?? docs/ui/screenshots/registration-small-mobile-synthetic.png
?? docs/ui/screenshots/settings-desktop-synthetic.png
?? docs/ui/screenshots/settings-small-mobile-synthetic.png
?? docs/ui/screenshots/sha-eclaims-desktop-synthetic.png
?? docs/ui/screenshots/sha-eclaims-small-mobile-synthetic.png
?? docs/ui/screenshots/specialty-desktop-synthetic.png
?? drizzle/0043_notification_centre.sql
?? src/api/clients/notifications.client.ts
?? src/components/NotificationCentre.tsx
?? src/components/dashboard/ActiveAlertStrip.tsx
?? src/components/ui/controls.tsx
?? src/components/ui/feedback.tsx
?? src/components/ui/index.ts
?? src/components/ui/layout.tsx
?? src/components/ui/overlays.tsx
?? src/context/InboxContext.tsx
?? src/dashboard/timezone.ts
?? src/db/schema/notifications.ts
?? src/notifications/inbox.routes.ts
?? src/notifications/inbox.service.ts
?? src/notifications/inbox.types.ts
?? src/notifications/inventory-alerts.ts
?? src/tests/integration/notification-inbox.db.spec.ts
?? src/tests/integration/public-health-explicit-counts.db.spec.ts
?? src/tests/vitest/facility-timezone.spec.ts
?? src/tests/vitest/notification-centre-ui.spec.tsx
?? src/tests/vitest/ui-design-system.spec.tsx
?? src/tests/vitest/ui-workflow-regressions.spec.tsx
```
