# Inpatient & Ward Management — Pre-Implementation Audit

**Date:** 21 October 2026
**Repo:** `fetronix/afyahub-hmis-kenya`
**Branch audited:** `arena/14785aa5-afyahub-hmis-kenya` @ `0b67faa` (fast-forwarded to include the laboratory verification work)
**Scope:** Wards, beds, admissions, discharge, transfers, occupancy, permissions, scoping
**Method:** Read-only inspection of schema, queries, routes, seed catalogue, API client and UI. No source files modified by this audit.

---

## 1. Verification baseline (measured, not assumed)

| Check | Result |
|---|---|
| `npm ci` | Passed — 418 packages, 11s |
| `npx tsc --noEmit` | **1 error** — `src/lib/firebase.ts(3,28): error TS2307: Cannot find module '../../firebase-applet-config.json'` |
| `npm run build` | Passed — `dist/assets/index-DOj0AqRF.js` 632.36 kB (gzip 145.20 kB) |
| Test runner | None configured in `package.json` |
| Inpatient tests | None exist |

**Note on the TypeScript baseline:** the single error occurs because `firebase-applet-config.json` is gitignored and absent from a clean clone. `tsc` therefore does **not** pass on a fresh checkout, contrary to the README's validation record. `src/lib/firebase.ts` is not imported by any other file and is dead code.

---

## 2. What already works (preserve)

1. **Relational chain is sound.** `wards → beds → admissions` with correct FKs and unique indexes on `(facility_id, code)` for wards and `(ward_id, bed_number)` for beds.
2. **Happy-path admission works end to end.** `createAdmission` inserts the admission row and marks the bed `Occupied` with `currentPatientId`. The UI flow (select patient → ward → bed → admit) completes and refreshes.
3. **Discharge closes the admission.** Status is set to `Discharged` with date, type and summary recorded.
4. **Bed board UI is functional.** Live status colouring, occupant name resolution, ward selector showing `totalBeds`, currently-admitted table filtered to `Admitted`.
5. **Module entitlement enforced.** `app.use('/api/wards' | '/api/beds' | '/api/admissions', requireFacilityModule('inpatient'))` — a facility without the inpatient module cannot reach these routes.
6. **Permission codes already exist** in `src/seeds/permissions.ts`: `inpatient.read` (line 454), `inpatient.admit` (462), `inpatient.discharge` (470).
7. **Admission rows are retained**, so discharged admissions remain queryable — a usable foundation for admission history.

---

## 3. Critical findings (P0 — security)

### 3.1 No scope enforcement anywhere in the inpatient module
All six inpatient handlers ignore `req.authContext`. The query functions take no context parameter:

```ts
getWards(facilityId?)        // returns all wards when no filter
getBeds(wardId?)             // returns all beds when no filter
getAdmissions(facilityId?, status?)  // returns all admissions when no filter
```

There is **no `*Scoped` variant** for any inpatient query, unlike patients/encounters/laboratory. Calling `GET /api/admissions` with no query string returns **every tenant's** admissions — including patient IDs, provisional diagnoses and nursing notes.

### 3.2 Tenancy is client-supplied and written verbatim
`POST /api/admissions` passes `req.body` straight to the insert. The UI sends:

```ts
tenantId: currentFacility?.tenantId || 1,
facilityId: currentFacility?.id || 1,
```

Any authenticated user can create an admission in **any tenant or facility** by editing the payload. The `|| 1` fallback means a user with no resolved facility silently writes into tenant 1.

### 3.3 Bed status endpoint allows arbitrary patient/bed association
```ts
PUT /api/beds/:id/status  body: { status, currentPatientId }
```
Any authenticated user can mark any bed as `Occupied` by any patient ID, or clear an occupied bed. This bypasses admission entirely and can falsify ward capacity.

### 3.4 The `inpatient.*` permissions are never enforced
`grep -c "inpatient\." src/app.ts` → **0**. The codes are seeded and the sidebar gates on them, but the API does not. Any authenticated user with the inpatient module enabled can admit, discharge and reassign beds regardless of role. Doctors, nurses, ward staff and administrators are indistinguishable to the server.

### 3.5 No audit trail
Zero `logAuditEvent` calls across all inpatient routes. There is no record of who admitted or discharged a patient, or who changed a bed's status.

---

## 4. High findings (P1 — data integrity and workflow)

### 4.1 Admission is not transactional
`createAdmission` inserts the admission, then separately updates the bed. A failure between the two leaves an admission pointing at an unoccupied bed.

### 4.2 No availability or duplicate checks
- No partial unique index on active admissions by `bed_id` → **two admissions can occupy the same bed**.
- No check for an existing active admission per patient → **the same patient can be admitted twice**.
- Bed `status` is never consulted before assignment.

### 4.3 Discharge frees a client-specified bed
```ts
dischargeAdmission(id, bedId, dischargeDate, dischargeType, dischargeSummary)
```
`bedId` comes from the request body. Discharging admission A while naming bed B frees **another patient's bed**. The admission row already holds the correct `bedId`; trusting the client here is a silent-corruption bug.

### 4.4 No discharge guard
An already-discharged admission can be discharged again, re-freeing a bed and overwriting the original discharge summary and date.

### 4.5 Bed lifecycle dead-ends after every discharge
Discharge sets the bed to `Cleaning`. **Nothing in the codebase ever returns a bed to `Available`.** `updateBedStatus` exists in `src/api/client.ts` but **no UI component calls it**. `src/db/seed.ts:447` even ships a bed permanently stuck in `Cleaning`. Every discharge permanently removes a bed from the usable board.

### 4.6 Occupancy state is duplicated with no invariant
`beds.status` + `beds.currentPatientId` mirror `admissions`, but two independent write paths (admission/discharge and the status endpoint) bypass each other. Nothing reconciles them.

### 4.7 No transfers — the capability does not exist
- No transfer table, no endpoint, no history, no UI action.
- `InpatientModule.tsx:427` offers "Inter-Facility Transfer" as a **discharge type**, which terminates the admission rather than transferring it.

### 4.8 No bed-occupancy history
`admissions.bedId` is a single mutable column. Adding transfers by updating it would erase where the patient actually stayed each night — and therefore the basis for bed-day billing.

### 4.9 Ward and bed management is not possible in-app
No `POST`/`PUT`/`DELETE` for wards or beds, and no client mutators (`createWard`/`createBed` → 0 matches). Wards and beds can only be created by seed script or manual SQL. `wards.totalBeds` is a stored integer that can silently disagree with the actual bed rows.

### 4.10 Dates are `text`, not timestamps
`admissions.admissionDate` and `dischargeDate` are `text`. No timezone safety, no reliable length-of-stay, format-dependent (the UI sends `YYYY-MM-DD HH:mm`). This blocks occupancy reporting, bed-day billing and discharge analytics.

### 4.11 Admission is not linked to a clinical encounter
`admissions.encounterId` is nullable and the UI never populates it. Inpatient care is therefore disconnected from OPD diagnoses, observations and laboratory orders — the continuity the module is supposed to provide.

### 4.12 Admitting doctor is a display-name string
`admittingDoctor: currentUser.name` stores a free-text name, not a user or practitioner FK. It cannot be joined, audited, or attributed reliably.

### 4.13 Nursing notes cannot support Phase 2
`admissions.nursingNotes` is a single text column overwritten in place — no author, no timestamp, no shift, no append-only history.

### 4.14 Phase 4 has no storage
No `dischargedBy`, `dischargeDisposition`, final diagnoses, discharge medications, or follow-up instructions.

---

## 5. Medium findings (P2 — consistency)

1. **Loose status vocabulary.** `Admitted` / `Discharged` and `Available` / `Occupied` / `Cleaning` are free-text columns with no enum or CHECK constraint. No state for `Transferred`, `Deceased` or `Absconded`.
2. **Every inpatient route returns HTTP 500** with raw `err.message`, so validation failures surface as server errors and leak internals.
3. **No pagination** on admissions or beds.
4. **Bed board name resolution is scoped.** `api.getPatients()` is facility-scoped, so an occupant from another facility renders as `Patient #id` — a cosmetic symptom of the scoping gap in 3.1.
5. **Duplicate pricing fields.** `wards.dailyRate` and `beds.dailyCharge` both exist; neither is used. No charge is posted on admission or discharge.

---

## 6. Contract mismatches (frontend ↔ API ↔ database)

| Element | DB | API | UI |
|---|---|---|---|
| Admission status | `text` default `Admitted` | accepts any string | sends `Admitted`, filters `Admitted` |
| Bed status | `text` default `Available` | accepts any string + `currentPatientId` | reads `Available`/`Occupied`/`Cleaning` |
| `tenantId`/`facilityId` | NOT NULL, FK | trusted from body | sent from `currentFacility` with `\|\| 1` fallback |
| `admissionDate` | `text` | trusted from body | `YYYY-MM-DD` |
| `dischargeDate` | `text` | trusted from body | `YYYY-MM-DD HH:mm` (different format) |
| `bedId` on discharge | authoritative on admission row | taken from body | sent from row (correct today, unverified) |
| `encounterId` | nullable FK | passes through | never sent |
| Transfer | not modelled | no endpoint | offered as a discharge type |

---

## 7. Proposed implementation plan

Sequenced so that patient-safety and tenancy defects close before new capability is added. Each step is independently verifiable and reversible.

### Step 1A — Safety hardening (no migration)
- Add `getWardsScoped`, `getBedsScoped`, `getAdmissionsScoped`, `getAdmissionByIdScoped`.
- Enforce `inpatient.read` / `inpatient.admit` / `inpatient.discharge`.
- Derive `tenantId`/`facilityId` from `authContext`; reject body-supplied tenancy.
- Restrict `PUT /api/beds/:id/status` to an allowlist and verify via active admission.
- Make `createAdmission` transactional; reject occupied beds and duplicate active admissions (409).
- Derive `bedId` from the admission row on discharge; guard already-discharged admissions.
- Add `PUT /api/beds/:id/release` (`Cleaning → Available`) and a UI control.
- Audit-log admit, discharge and bed status changes; map errors to 400/403/404/409.

### Step 1B — Migration 0009: transfers, history and real timestamps
- New `admission_transfers` table (from/to ward and bed, reason, actor, timestamp) with backfill.
- Convert `admissionDate`/`dischargeDate` to `timestamp with time zone` behind a guarded cast.
- Partial unique indexes: one active admission per bed, one per patient.
- Add `dischargedBy`, `dischargeDisposition`.
- Transfer endpoint and UI action.

### Step 1C — Ward and bed administration
- `POST`/`PUT` wards, `POST`/`PUT`/`DELETE` beds, bulk bed generation.
- Derive `totalBeds` from actual bed rows.
- Ward and bed management screen.

### Later phases (each requires its own migration)
- **Phase 2 — Nursing:** `nursing_notes`, `vital_signs` linkage, care plans, intake/output, shift handover.
- **Phase 3 — Orders:** doctor's orders, MAR, procedure linkage to laboratory and pharmacy.
- **Phase 4 — Discharge:** discharge summaries, final diagnoses, discharge medications, follow-up.

---

## 8. Risks and constraints

- **Migration 0009 touches live clinical data.** Per project rules it requires a verified backup and human review before execution. The `0004`/`0007`/`0008` snapshot gap must be reconciled before `drizzle-kit generate` is used.
- **The audit environment has no PostgreSQL.** All findings are static-analysis and contract-level. Cross-tenant rejection must be proven at runtime on staging before any step is marked Verified.
- **Preserve all existing behaviour and backups.** The 199 tracked `.bak` files are not touched.
