# JaliCare Kenya HMIS — Updated Project Handover
**Last updated:** 20 October 2026  
**Client:** PUCHE — Level 3B healthcare facility  
**Current milestone:** Step 6 — OPD, triage and consultations  
**Overall status:** In progress

## 1. Repository and development environment

- **Local path:** `C:\Users\Admin\Downloads\afyahub-hmis-kenya`
- **GitHub repository:** `fetronix/afyahub-hmis-kenya`
- **Working branch:** `restructure/phase-2-foundation`
- **Stack:** React, TypeScript, Express, PostgreSQL and Drizzle ORM.
- **Development approach:** Precise PowerShell changes, minimal-risk edits, preserve existing work, implement objectively and verify with evidence.

## 2. Roadmap status

The existing roadmap remains unchanged. Status reflects the reported implementation progress, not comprehensive production certification.

1. **Foundation and project structure — Completed**
2. **Authentication, permissions and onboarding — Completed**
3. **Multi-tenant and facility security — Completed for the current roadmap; further endpoint-level scope hardening remains outstanding**
4. **PUCHE facility overview — Completed**
5. **Patient registration and records — Completed**
6. **OPD, triage and consultations — In progress; current priority**
7. Inpatient, wards, beds and theatre — Not started
8. Maternity, MCH and preventive services — Not started
9. Laboratory and radiology — Not started as a milestone; laboratory permissions have begun to be wired in Step 6
10. Pharmacy, inventory and procurement — Not started
11. Tariffs, billing, payments and insurance — Not started
12. Reports, analytics and public-health reporting — Not started as a milestone; the analytics summary endpoint has already been implemented
13. Interoperability and integrations — Not started
14. Security, regression and user acceptance testing — Not started
15. Production deployment and handover — Not started

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