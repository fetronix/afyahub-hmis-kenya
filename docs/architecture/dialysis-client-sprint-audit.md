# Dialysis facility sprint: repository audit and implementation risks

Audit of the existing JaliCare checkout, 2026-10-28. This is not a clinical, accounting or integration certification. The prospective facility's identity, approved clinical protocols, accounting policies, bank and website details have not been provided.

## Existing building blocks

| Area | Existing implementation | Reuse and gap |
| --- | --- | --- |
| Architecture and security | Express in `src/app.ts` / `src/routes`, PostgreSQL/Drizzle in `src/db`, React/Vite, authenticated authorization contexts, facility module guards and `audit_logs` | Extend existing services and scope every resource. An enabled navigation item is not itself authorization. |
| Patients and clinical records | `patients`, `patient_facilities`, `encounters`, `diagnoses`; scoped helpers in `src/db/queries.ts`; OPD, inpatient and maternity services | A patient's `registration_facility_id` is not their only facility; encounters and associations determine access. Existing diagnoses are ICD-10-shaped and must not be silently recoded. |
| Diagnosis catalogue and claims | OPD's small `commonIcd10List`; existing diagnosis columns `icd10_code`/`icd10_description`; SHA and private-insurance diagnosis snapshots | No complete WHO ICD-11 catalogue or verified mapping set was established. Payer-specific coding requirements require confirmation; do not infer coding system from the code's first character. |
| Billing and reporting | `src/billing`, `billing_invoices`, `billing_items`, `billing_payments`, charge attempts and facility tariffs; operational/revenue reports | Invoice charges, actual payments and insurer claims are distinct. No general ledger/revenue recognition reconciliation exists in the prior system. |
| Inventory and pharmacy | `src/inventory/inventory.service.ts`, `inventory_items`, `inventory_batches`, stock adjustments and dispensing | Reuse transactional, facility-scoped batch handling; do not deduct a summary field independently of batches. Missing/zero unit costs cannot establish profitability. |
| Procurement | `suppliers`, `purchase_orders`, `src/routes/procurement.routes.ts` | Purchase order exists, but a full supplier-invoice, payment and accounts-payable ledger workflow is not established. |
| Dialysis | The renal tab of `SpecialtyModule.tsx` contains hard-coded example settings and a toast-only save handler | This is not persistent dialysis documentation and must not be presented as a completed clinical record. A real module needs facility-approved protocols, permissions, scoped persistence, scheduling conflicts and append-only history. |
| Appointments and notifications | `appointments`; patient portal notification provider interface in `src/notifications/notification-provider.ts` | There is no verified WordPress integration or live SMS/email provider. A website API requires separate service authentication, scoped access, atomic capacity and idempotency, and truthful delivery status. |
| Facility configuration | `FACILITY_MODULES`, `facilities.enabled_modules`, scoped provisioning routes and role overrides | Disabling should protect APIs as well as navigation, preserve history and not break shared services. Client-specific provisioning requires the actual target facility and approval. |
| External payers / banks | SHA and private-insurance implementations in `src/insurance` and `src/integrations/sha` | Preserve these implementations. No official bank connector, authorized bank feed or transfer has been established. Statement imports and matching must not be labelled bank-confirmed. |
| Deployment | `scripts/migrate.ts`, migration journal, `.env.example`, `npm` scripts, `/api/health` and `/api/ready` | New migrations must be additive and tested against PostgreSQL. Live integrations require credentials and separate UAT/production configuration. |

## Dependencies and risks

- **Ledger and bank integrity:** balance and immutable posted lines must be protected in the database as well as the service; journal headers, lines, idempotency, period locking and audit need a single transaction. Bank imports and matching require duplicate checks and transaction boundaries. Financial statements need a defined cut-off and reconciliation with billing; incomplete expense/cost allocations must not be presented as profit.
- **Clinical safety:** do not default treatments, completion outcomes, prescriptions, weights, session durations, viral results or event outcomes. Clinical permissions and a facility-approved protocol are required. Machine scheduling, start and stock use need concurrency controls. Never mark a scheduled appointment complete without an actual authorized session.
- **Patient isolation:** patients have a tenant and registration facility, not a `patients.facility_id` column. Resources referring to a patient, encounter, equipment, account, supplier or appointment must be checked in the authorized facility/tenant.
- **ICD-11 provenance:** a handpicked transition-table subset is not the full official WHO catalogue and third-party repackaging is not proof of an authorized source. Use a server-side WHO API or an authorized full download with source/release metadata, and label cached results accurately. Mappings require explicit review; old diagnoses retain their original coding. Payer acceptance is a separate verified policy.
- **Booking:** do not expose a client API key in WordPress browser JavaScript. Availability must take account of both staff and online appointments and hold capacity atomically. Notifications can fail independently of booking creation and must not report a delivery without provider evidence.
- **Existing route wiring:** some legacy domain routers register `/api/...` paths while mounted under `/api`. Route-inventory tests inspect route declarations, not full authenticated paths. Any clinical integration should verify real HTTP reachability, not just source text.
- **Platform configuration:** facility administrators currently have module-provisioning capabilities; granting additional accounting and treatment-plan authorization automatically would be a privilege expansion requiring deliberate review. No client facility configuration can be applied without identifying the facility.

## Validation baseline observed during the sprint

Before the new sprint, the preceding invitation fix was checked with the project's format, typecheck, lint, coverage test and deployment-build scripts. At the sprint's intermediate review, typecheck failed for in-progress accounting, dialysis and booking code; formatting also failed, while ESLint reported 0 errors and 58 warnings. These results are not evidence that the new workflows work.

A disposable **PostgreSQL 16.14** instance was started locally, containing no real patient records. The actual `npm run db:migrate -- --yes` runner successfully applied migrations `0000` through `0026`. The new, uncommitted `0027` initially failed at its bank transaction foreign key (`payments` does not exist; the existing table is `billing_payments`) and was rolled back for that migration. This is precisely why a dry-run or file-integrity check alone is insufficient.

Full, current verification results and remaining limitations are recorded in the sprint delivery report, not inferred from this preliminary audit.
