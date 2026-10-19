# JaliCare Kenya HMIS — Project Handover

I am developing **JaliCare Kenya HMIS** for a Level 3B healthcare facility client, PUCHE.

## Repository and development environment

- **Local path:** `C:\Users\Admin\Downloads\afyahub-hmis-kenya`
- **GitHub repository:** `fetronix/afyahub-hmis-kenya`
- **Current working branch:** `restructure/phase-2-foundation`
- **Technology stack:** React, TypeScript, Express, PostgreSQL and Drizzle ORM.
- **Development preference:** Precise PowerShell commands, minimal-risk changes, objective-driven implementation and evidence-based verification.

## Completion roadmap

We are tracking 15 milestones. **Steps 1–5 are considered completed for the current development roadmap. Step 6 is now the active milestone.** Later testing and deployment milestones remain planned and must not be marked complete until their work has been performed and verified.

1. **Foundation and project structure — Completed**
2. **Authentication, permissions and onboarding — Completed**
3. **Multi-tenant and facility security — Completed**
4. **PUCHE facility overview — Completed**
5. **Patient registration and records — Completed**
6. **OPD, triage and consultations — In progress / Current step**
7. Inpatient, wards, beds and theatre
8. Maternity, MCH and preventive services
9. Laboratory and radiology
10. Pharmacy, inventory and procurement
11. Tariffs, billing, payments and insurance
12. Reports, analytics and public-health reporting
13. Interoperability and integrations
14. Security, regression and user acceptance testing
15. Production deployment and handover

**Status definitions:** Completed milestones reflect implementation progress and checks already reported. They are not a claim that the entire application has passed comprehensive production, security or user-acceptance testing. Update a milestone to Verified when the relevant implementation and evidence have been checked.

## Verified progress and existing implementation

- Phase 2 foundation changes have been made on the current working branch.
- The server entry point and application structure have been refactored.
- Environment and database configuration have been introduced.
- Authentication/session hydration was fixed so user roles and modules load after the first login without requiring a browser refresh.
- The analytics endpoint `GET /api/analytics/summary?facilityId=8` was implemented with facility-scoped queries and `reports.read` permission enforcement.
- The analytics endpoint returned all nine metrics, currently zero because the facility has no operational data yet:
  - `totalPatients`
  - `activeQueuesCount`
  - `currentAdmissions`
  - `bedOccupancyRate`
  - `scheduledSurgeries`
  - `pendingLabOrders`
  - `totalRevenueKes`
  - `outstandingBillsKes`
  - `lowStockAlerts`
- `npx tsc --noEmit` passed after the analytics changes.
- `npm run build` passed after the analytics changes.
- `git diff --check` passed apart from a normal Windows LF/CRLF warning.
- Patient registration was updated to support optional patient phone, national ID and personal SHA number; an unknown or untested blood group; DOB-based age calculation; and separate guardian details for minors.
- A database migration was generated and applied for nullable patient phone and the guardian fields.
- A database backup was created and verified before the patient schema migration.
- The patient creation helper validates facility access and assigns tenant/facility scope from the verified facility.
- Patient updates use a scoped query restricted to the patient's tenant and registration facility.
- After the patient registration changes, `npx tsc --noEmit` passed and `npm run build` succeeded.
- The current production build has a Vite warning for a JavaScript chunk larger than 500 kB. This is a performance optimization item, not a build failure.

### Backup files to preserve

- `src/app.ts.analytics-backup-20261019-111633`
- `src/app.ts.analytics-backup-20261019-112507`
- `backups/jalicaredb-before-patient-guardian-20261019.dump`
- `backups/jalicaredb-backup-verification.txt`
- The patient-registration, database-schema and type-definition backups created during the October 19 changes.

Do not delete these files without a specific reason. Do not commit database dumps or local backup artifacts unless explicitly intended.

## Current milestone: Step 6 — OPD, triage and consultations

**Resume development at Step 6. Do not restart the project or revisit Steps 1–5 unless a concrete defect or dependency is discovered.**

The objective is to implement and complete the OPD workflow for PUCHE using the existing application architecture and database.

### Step 6 objectives

1. **Patient arrival and OPD queue**
   - Confirm how newly registered and returning patients enter the OPD workflow.
   - Support queue registration, queue status, waiting order and appropriate facility scoping.
   - Avoid duplicate queue entries where the existing workflow already creates one.

2. **Triage**
   - Capture the relevant observations and vital signs supported by the existing schema and clinical requirements.
   - Record triage category or urgency, presenting complaint, timestamps and responsible staff where supported.
   - Ensure urgent cases can be identified and prioritised appropriately.
   - Do not invent clinical values or use arbitrary defaults for missing observations.

3. **Consultations**
   - Support consultation records linked to the correct patient, facility and encounter.
   - Inspect existing structures before implementing clinical history, complaints, examination findings, assessment, diagnosis, treatment plan and follow-up.
   - Reuse existing diagnosis, encounter, prescription, laboratory and referral structures where appropriate rather than duplicating them.

4. **Clinical workflow**
   - Inspect how a patient moves from registration or queue to triage, clinician consultation and the next appropriate service.
   - Confirm the status transitions and responsible staff.
   - Handle cancellation, completion and re-entry according to existing business rules.

5. **Permissions and data isolation**
   - Verify the relevant permissions for registration, triage, consultation and clinical-record access.
   - Enforce tenant and facility scope on reads and writes.
   - Do not expose sensitive patient or clinical data through unscoped endpoints or excessive logs.

6. **User interface**
   - Inspect the existing OPD, triage, queue and consultation modules before changing them.
   - Reuse the established application layout, components and API client.
   - Keep the workflow practical for healthcare workers and avoid unnecessary duplicate screens.

7. **Verification**
   - Run `npx tsc --noEmit` and `npm run build` after meaningful changes.
   - Perform focused functional checks for the implemented workflow.
   - Preserve existing records and migrations.
   - Record what is implemented, what has been tested and what remains outstanding.

## Critical development rules

- Preserve all existing patient data, database contents and migrations.
- Never reset, drop or truncate the database as a shortcut.
- Do not use `db:clean`, destructive schema operations or unreviewed database pushes.
- Inspect before editing; avoid replacing large files unnecessarily.
- Prefer exact PowerShell scripts for targeted changes and verify replacements before writing.
- Review the existing schema, routes, services, permissions and UI before adding new structures.
- Run `npx tsc --noEmit` and `npm run build` after meaningful changes.
- Test actual behaviour; a successful build alone does not prove a feature works.
- Verify tenant/facility scoping, authorisation and sensitive-data handling.
- Do not create fake patient or clinical records to make dashboards appear populated.
- Use zero for genuine zero counts and “Not configured” or “Not available” when a service or data source is unavailable.
- Do not claim Kenyan regulatory or DHA compliance without the relevant evidence and assessment.
- Track each milestone as **Not started, In progress, Blocked, Completed or Verified**, using “Verified” only when the relevant checks support that status.
- At the end of each session, provide an updated handover summary and the exact next action.

## Immediate next action

**Start Step 6 by inspecting the existing OPD, triage, queue and consultation implementation.**

Identify the existing pages/components, API endpoints, database tables, workflow transitions and permission checks. Compare them against the Step 6 objectives, report the real gaps, and then implement the smallest safe change that advances the workflow.

Do not repeat completed foundation or patient-registration work without evidence of a defect. Do not assume a module is missing until the repository has been inspected. Preserve all existing work and database contents while progressing through Step 6.