# Responsible doctor assignment — focused acceptance

## Decision and scope

**Implemented and verified in the built application against disposable synthetic PostgreSQL.** This is not a Syrona deployment or production preflight pass. The outstanding live-environment checks in [SYRONA_PRESENTATION_PREFLIGHT.md](SYRONA_PRESENTATION_PREFLIGHT.md) remain NOT VERIFIED.

Assessment date: 2026-10-27. Baseline: `5182ef6307c60f3ef53945e34e84305f172e6ca4`; branch: `arena/e088f11d-afyahub-hmis-kenya`. The sandbox clock records November 2026 in generated screenshots/audit timestamps; these are retained as actual synthetic-run timestamps, not production chronology.

## Root cause

`PatientDocumentsPanel.tsx` treated `doctorId` like an ordinary metadata text field: the generic input loop displayed **Responsible doctor user ID**, initialized it to an empty string and cleared it after upload. There was no eligible-doctor lookup or default from the authenticated session. The upload service accepted a client-supplied ID if it belonged to any account with `account_status='ACTIVE'` in the facility; it did not require an active Doctor role, check all lifecycle flags or separately authorize assigning someone else.

## Corrected behavior

- **Responsible doctor** is now a name/designation selector, never a manual numeric ID input. Authorized delegating staff have a **Search doctors** input filtering the dropdown by name/designation. Native keyboard-accessible controls are used; no duplicate staff directory or new UI library.
- On mount, the panel calls the authenticated options endpoint. The server derives `currentDoctor` from `req.authContext.userId`, not a browser-submitted user ID or role assertion. If eligible, that doctor is visibly selected before upload; otherwise no one is silently selected.
- Session/facility/patient changes remount the workspace through its existing identity key; pending lookup responses are ignored on cleanup. Lookup loading/failure is explicit and upload cannot proceed without a selected doctor. Successful upload clears signature assertions/date/notes as before and restores the logged-in eligible doctor's default (or an empty staff selection).
- Eligibility reuses `users`, `user_roles`, `roles`: same authenticated tenant/facility, active user, ACTIVE account, no deactivation, no current lock, active non-revoked assignment, active tenant-owned role named Doctor (case-insensitive canonical `DOCTOR`). Designation alone is not eligibility. Global/other-tenant role links are not accepted.
- The server repeats eligibility validation **inside the upload transaction**, with share locks on the selected user, role and assignment until commit. A forged or stale dropdown selection is not trusted. Missing assignment defaults to the session user **only if that user qualifies**; non-doctors must explicitly select an eligible doctor.
- Saved metadata retains the validated `doctor_id`. New UPLOAD/NEW_VERSION audit facts include responsible doctor ID, server-read name and SELF/DELEGATED assignment. Existing immutable originals/versions are not updated or backfilled.
- Staff list/history responses add `doctor_name` through a scoped lookup. Inactive historical doctors remain readable but are not selectable for new uploads. Legacy null IDs remain “Not recorded”; an unavailable scoped historical name is shown as such, never silently reassigned. Display names reflect the current scoped user record; new upload/version audit facts retain the name at assignment time. No historical-name snapshot column or migration is introduced.
- Signature statuses remain independent staff-observed assertions; assigning a doctor never implies either signature is present. File validation, immutable bytes, corrections, audit reasons, per-version portal release and portal confidentiality remain in their existing implementations.

## Existing RBAC used — no automatic grants

| Capability | Required existing authority |
| --- | --- |
| Read/upload and retrieve doctor options | Facility-scoped non-platform account with `patients.read`, `patients.documents.read`, `patients.documents.upload`; patient must belong to the same tenant/facility. |
| Assign own eligible Doctor identity | Above permissions; no additional delegation privilege required. |
| Browse/select another active facility doctor | Above permissions **plus `patients.update`**, the existing patient/consent-editing capability. This rule applies to doctors, reception, records, nursing and administrative staff alike; a role name alone does not grant it. |
| Upload-only doctor without `patients.update` | Own name is selected and selector is locked. A crafted override request returns403 `DOCTOR_ASSIGNMENT_FORBIDDEN`. |
| Upload-only non-doctor without `patients.update` | No default, no other-doctor directory/control, cannot submit. A crafted other-doctor assignment is denied. A facility administrator must review existing roles separately if delegation is intended. |

No permission codes, seed defaults or facility role grants were added/modified. `patients.documents.release` does not confer delegation authority and is unchanged. Doctor verification here concerns the existing staff role/account records, not professional licensing certification. The separate radiology consent verification/exception clinician controls are outside this upload-assignment change and were not redesigned.

## APIs and files changed

### Application

- `src/documents/patient-documents.routes.ts`: new **GET `/api/patient-documents/patients/:patientId/doctors?search=...`**. Returns `currentDoctor`, `canAssignOthers`, eligible `{id,name,designation}` options and `hasMore`. No email, session or general user-management data. Upload-only/self callers receive only their own eligible option; delegating callers receive same-facility results. Literal parameterized search, maximum80 characters, maximum50 returned options; refine search when `hasMore` is true.
- `src/documents/patient-documents.service.ts`: shared eligibility predicate, session default resolution, `patients.update` delegation gate, transactional validation/locks, audit facts, staff name projection. Existing **POST `/api/patient-documents/patients/:patientId`** retains the metadata/file wire format but now enforces responsible doctor assignment on every new version. Staff list and history GET responses add `doctor_name`; portal routes/projections are unchanged.
- `src/api/patient-documents.client.ts`: typed responsible-doctor options and optional staff `doctor_name`.
- `src/components/PatientDocumentsPanel.tsx`: searchable named selection, visible session default, locked self-only behavior, required staff selection and saved/history name display. Other metadata controls retain their existing meaning.

### Verification only

- `src/tests/integration/responsible-doctor.db.spec.ts`: new20-test real PostgreSQL/HTTP suite.
- `src/tests/integration/support/responsible-doctor.fixture.ts`: new additive isolated fixtures and independent cluster/data-directory attestation; no production seeding.
- `src/tests/vitest/patient-documents-ui.spec.tsx`: expanded11-test frontend suite.
- `src/tests/integration/patient-signed-documents.db.spec.ts`: existing fixture now actually assigns Doctor roles to its synthetic clinicians; signing test now expects authenticated-doctor default rather than requiring a typed ID. Uses a separate signing date so its existing null-date/filter assertions still test the intended documents. Other assertions/gates remain.
- `scripts/responsible-doctor-acceptance.ts`: targeted built-app browser journey and evidence capture.
- `scripts/clinical-documents-acceptance.ts`: retained broader harness compatibility only: its synthetic admin persona explicitly also holds the Doctor role, and the renamed selection control replaces the old field reference. That broader200-check journey was **not rerun or counted** for this task.

## Fresh verification

All DB work used newly initialized PostgreSQL16.12 on loopback55439, database `clinical_documents_synthetic_test`;101 existing migrations were applied only to that new disposable database. The fixture independently compares the actual connection/database/address/control-file cluster ID/data directory before fixture writes. No production environment configuration or patient data was loaded. No schema migration was changed.

| Check | Final result |
| --- | --- |
| New real PostgreSQL + mounted Express HTTP assignment suite | **20 passed,0 failed,0 skipped** |
| Existing signed-document/portal/radiology-consent regression suite | **42 passed,0 failed,0 skipped** |
| Frontend DOM suite | **11 passed,0 failed,0 skipped** |
| Combined focused Vitest run | **73 passed across3 files**; do not add overlapping earlier reruns |
| Real built Vite frontend + bundled Express + Chromium143.0.7499.0 | **37 checks passed**; normal staff and portal password login, no intercepted/mocked HTTP/SQL |
| Frontend production build / server build | Passed; existing large Vite chunk warning remains |
| Bounded TypeScript (`tsc --noEmit --singleThreaded`) / changed-file ESLint | Passed; bounded runtime changes resource use, not typechecking rules |
| Changed TypeScript Prettier / Git whitespace checks | Passed |

The browser fixtures have only explicit document/journey-read capabilities, with `patients.update` and portal release on the records persona. Read-only clinical/lab/pharmacy/billing capabilities and their modules are prerequisites of the **existing patient-record modal loader**, not new grants to real roles or new assignment requirements. That unrelated modal behavior was not changed.

### Requested scenarios

| # | Scenario | Result / evidence |
| --- | --- | --- |
| 1 | Doctor A opens upload form and is preselected | PASS: frontend tests, actual normal login and [Doctor A screenshot](responsible-doctor-evidence/01-doctor-a-default.png). |
| 2 | Doctor B defaults to Doctor B | PASS: backend/frontend and [Doctor B screenshot](responsible-doctor-evidence/02-doctor-b-default.png). |
| 3 | Authorized staff choose another same-facility doctor | PASS: name search, selection and saved correction through actual UI; [records selection](responsible-doctor-evidence/03-records-search-selection.png). |
| 4 | Unauthorized override blocked | PASS: locked own-doctor selection/empty non-doctor control; real API crafted overrides403. |
| 5 | Non-doctor cannot be responsible | PASS: no inferred default; explicit same-facility non-doctor rejected even with medical designation/forged role fields. |
| 6 | Inactive doctor excluded | PASS: inactive, suspended, deactivated, locked, revoked/inactive assignments and inactive roles rejected; no longer selectable. |
| 7 | Cross-facility/fabricated/deleted IDs rejected | PASS: API rejection; wrong-tenant Doctor role also rejected; scoped patient lookup and unauthenticated access negatives. |
| 8 | Correct name displayed after refresh | PASS: actual Refresh documents and staff list response. |
| 9 | Original/historical responsible doctor retained | PASS: [version history](responsible-doctor-evidence/04-refreshed-history.png), original Doctor A/correction Doctor B and identical original byte hashes; legacy-null original remains null in separate DB test. |
| 10 | Existing upload and portal access preserved | PASS:42-test regression covers file types/validation/portal own-other-unreleased/download policy/consent gates; actual browser upload, deliberate release and separate patient login show only released correction without staff assignment controls. [Portal screenshot](responsible-doctor-evidence/05-portal-release-regression.png). |

The focused browser includes37 assertions; no uncaught browser errors and no observed staff same-origin500 responses. Prior harness-only failures (mixed-case synthetic login name, Puppeteer key syntax, no-store inspector-body eviction and missing async history wait) were corrected in test setup/synchronization, not worked around by granting writes or weakening server assertions. Final evidence supersedes those incomplete runs; no failed-run artifact is presented as acceptance.

Evidence: [results.json](responsible-doctor-evidence/results.json), [verification-summary.json](responsible-doctor-evidence/verification-summary.json), screenshots and SHA256 manifest in `responsible-doctor-evidence/`. No passwords/tokens, database files or production documents are committed. Screenshot captures follow the existing scrolling modal layout and are not a claim of a new print layout.

## Reproduction and demo

Provision a **new disposable cluster only**, independently obtain its cluster identifier from that new cluster's control file and its absolute data directory, and apply the repository migrations only there. Set loopback `SQL_*`, `SYRONA_REQUIRE_DB=1`, `SYRONA_TEST_PG_SYSTEM_IDENTIFIER` and `CLINICAL_TEST_PG_DATA_DIRECTORY`. Do not copy a deployment `.env` or use an existing facility database.

```sh
npm ci
npm run build
npm run build:server
npx vitest run src/tests/integration/responsible-doctor.db.spec.ts \
  src/tests/integration/patient-signed-documents.db.spec.ts \
  src/tests/vitest/patient-documents-ui.spec.tsx --maxWorkers=1
# Also set CHROME_EXECUTABLE_PATH to your controlled local Chromium runtime.
RESPONSIBLE_DOCTOR_SYNTHETIC=YES \
  RESPONSIBLE_DOCTOR_EVIDENCE_DIR=.tmp-tools/doctor-rehearsal \
  node --import tsx scripts/responsible-doctor-acceptance.ts
```

Use a new evidence directory for a rerun. The browser harness starts/stops its own built server on4197; it is not a persistent deployment. Chromium native libraries must be available. For a manual isolated demo: log in as Doctor A/B → **Patient Management → View Patient Record → Consent & Signed Documents** → confirm their displayed default before upload; log in as an approved delegating staff member → **Search doctors** → **Responsible doctor** → upload → **Refresh documents → Version & audit history**. No numeric user ID entry is needed.

## Remaining limitations and publication

- No actual Syrona deployment, staff role configuration, licensing check or production data validation is claimed. Live presentation preflight remains separately required.
- Only active tenant-owned Doctor roles qualify. An active clinical officer, nurse, administrator or practitioner-directory entry alone is deliberately not treated as a Doctor.
- All new uploads/corrections now require an eligible responsible doctor, even when signatures are UNKNOWN/ABSENT. Historical records remain unchanged. External clients relying on optional/missing staff assignments must use the new lookup/selection or an eligible doctor's authenticated default.
- Delegation reuses `patients.update` plus document upload/read. There is no new narrow assignment permission. Facilities should review this existing combination according to their governance; this task does not grant it to anyone automatically.
- Name search returns at most50 matches and asks the user to refine; a database test verifies finding an entry beyond the initial50. Displayed history names follow scoped current user names; immutable IDs and new audit name snapshots preserve assignment provenance.
- No broad audit, full-system regression suite, new user-management system, duplicate doctors, permission bypass, migration edit or unrelated module redesign.

Only the application/test/harness files listed above and this task's documentation/evidence are eligible for commit. Existing master/readiness/preflight evidence remains intact. Final commit hash, same-branch push and upstream/working-tree verification are reported in the delivery response.
