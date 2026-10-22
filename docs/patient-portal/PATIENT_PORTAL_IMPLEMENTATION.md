# Patient Digital Health Record Portal — Implementation

**Date:** 22 October 2026
**Branch:** `arena/14785aa5-afyahub-hmis-kenya`
**Base commit:** `23a636d`
**Companion documents:** `PATIENT_PORTAL_SECURITY_AUDIT.md`, `PATIENT_PORTAL_TEST_RESULTS.md`,
`PATIENT_PORTAL_DATABASE_CHANGES.md`, `PATIENT_PORTAL_DEPLOYMENT_GUIDE.md`, `IMPLEMENTATION_PLAN.md`

---

## 1. Status in one page

| Area | State |
|---|---|
| Database migration | **Written, type-checked, not applied.** `drizzle/0018_patient_portal.sql`, six new tables, additive only |
| Portal identity and sessions | **Implemented.** Separate account table, separate session table, separate bearer token |
| Invitation lifecycle | **Implemented**, including supersede, expiry, revoke, resend caps, manual handover |
| Delivery through SMS / email | **Interface implemented, no provider configured.** Every attempt records `NOT_CONFIGURED`; nothing is ever reported as sent |
| QR digital card | **Implemented.** Opaque random code, SHA-256 for lookup, sealed copy for re-display, staff lookup rate-limited and audited |
| Patient record sharing | **Implemented** as a one-time, named, time-limited, revocable grant redeemed by staff — explicitly not an HIE integration |
| Patient UI (`/portal`, `/portal/activate`) | **Implemented**, mobile-first, separate from the staff bundle |
| Staff administration UI | **Implemented** as its own module, "Patient Portal Management" |
| Reception invitation panel | **Implemented** on registration success and on the patient directory / queue rows |
| Automated tests | **197 new assertions**, whole suite 2,990 assertion statements across 24 scripts, all passing |
| Runtime against PostgreSQL | **Not exercised.** No database in this environment; see §9 |

Nothing in this document is a claim about a running deployment. Section 9 lists, in plain
terms, what has and has not been executed.

---

## 2. Where the work lives

### Server

| File | Responsibility |
|---|---|
| `drizzle/0018_patient_portal.sql` | Six tables, indexes, constraints. Additive; no `DROP`, no `TRUNCATE`, no patient rewrite |
| `src/db/schema.ts` | Drizzle definitions for the same six tables (`qrTokenSealed` included) |
| `src/portal/portal-policy.ts` | Bounds, token generation and hashing, contact normalisation, state derivation, settings clamping, sharing validation, QR helpers, password rules |
| `src/portal/portal.service.ts` | Invitation creation, delivery recording, manual link reissue, handover, revocation, activation |
| `src/portal/portal-auth.service.ts` | Activation, sign-in, lockout, session resolution, password change, logout |
| `src/portal/portal-records.service.ts` | Read-only projections of the clinical record, access logging, download, correction requests |
| `src/portal/portal-admin.service.ts` | Facility overview statistics, account search and lifecycle, settings, risks, audit trail |
| `src/portal/portal-sharing.service.ts` | Sharing grants, redemption, access history |
| `src/portal/qr.service.ts` | Card issue, re-render, staff lookup |
| `src/portal/portal.middleware.ts` | `requirePortalAuth` — the only thing that turns a patient token into a session |
| `src/portal/portal.routes.ts` | Patient API, mounted at `/api/portal` |
| `src/portal/portal-admin.routes.ts` | Staff API, mounted at `/api/portal/admin` |
| `src/notifications/notification-provider.ts` | Provider interface, configuration detection, `NOT_CONFIGURED` outcome |

### Browser

| File | Responsibility |
|---|---|
| `src/api/portal-client.ts` | Patient token handling, patient API calls, staff portal-admin calls |
| `src/components/portal/PortalApp.tsx` | `/portal` and `/portal/activate` — activation, sign-in, dashboard, records, sharing, account |
| `src/components/portal/PortalInviteDialog.tsx` | Reception panel: status, invitation, link, handover, resend, revoke |
| `src/components/modules/PatientPortalModule.tsx` | Facility administration: overview, accounts, settings, audit, card lookup |
| `src/App.tsx` | Portal paths decided **before** `HmisProvider` mounts |
| `src/components/Sidebar.tsx`, `src/components/Header.tsx`, `src/config/facility-modules.ts`, `src/context/HmisContext.tsx`, `src/middleware/facility-module.middleware.ts` | The `patient_portal` module, its nav entry, its title and its server-side module id |

---

## 3. Reception: inviting a patient

### The rule

An account is created **by the patient**, from a single-use link, after a member of staff has
established who they are. The desk does not create an account from a name, a phone number or a
date of birth. There is no auto-link anywhere in the code: `issueInvitation()` refuses with
`409 PORTAL_ACCOUNT_EXISTS` when the patient already has an account, and no code path matches a
contact value to an existing account to attach it.

### The states a receptionist sees

The eight states in the brief are represented as **two independent facts**, because collapsing
them would let "the SMS went out" be read as "the patient is signed up":

| Fact | Values | Column |
|---|---|---|
| Activation state | `PENDING`, `ACTIVATED`, `EXPIRED`, `REVOKED`, `SUPERSEDED` | `patient_portal_invitations.status` |
| Delivery state | `PENDING`, `SENT`, `FAILED`, `NOT_CONFIGURED`, `HANDED_OVER` | `patient_portal_invitations.delivery_status` |

`deriveInvitationStatus()` re-evaluates a stored `PENDING` against `expires_at` on every read, so
an invitation that expired overnight reads as `EXPIRED` even if no sweep has run. The account
itself adds `PENDING_VERIFICATION`, `ACTIVE`, `SUSPENDED` and `REVOKED`, and the panel shows the
account line separately from the invitation line.

**"Verification required"** therefore has a platform meaning: an account parked in
`PENDING_VERIFICATION` because activation could not establish that the person holding the link is
the patient. That happens in two situations, both handled in `activateInvitation`:

- the phone or email is already the login identifier of a different patient's account — no account
  is created for the second patient, the patient is flagged, and activation returns
  `202 requiresStaffVerification`;
- the patient record has no usable phone or email — an account is parked as
  `PENDING_VERIFICATION` and the desk is told to verify in person.

Neither path issues a session.

### What the panel does

`PortalInviteDialog` (opened from a queue row in Reception and from the patient directory, and
automatically offered after a successful registration):

1. reads `GET /api/portal/admin/patients/:patientId/status` — account state, masked contact,
   latest invitation, facility policy, and whether SMS/email providers exist;
2. issues `POST …/invitations` with a channel (`MANUAL` by default); for `MANUAL`, the response
   contains the activation link exactly once;
3. shows the link with a copy button and the sentence "this link is shown once";
4. offers "Mark handed over", "New link" (when `canResend`), and "Revoke" (permission-gated);
5. never shows a result, a note or a diagnosis.

Only one invitation per patient can be live. Issuing a second marks the previous `PENDING` row
`SUPERSEDED` and writes an event for each, so a printed slip stops working the moment a newer one
exists. `buildActivationLink()` puts the token in the URL **fragment**
(`/portal/activate#<token>`), which browsers do not send to servers.

### What the receptionist cannot do

- Read clinical notes, results or history: the panel calls only the portal-status endpoint, and
  that endpoint returns no clinical fields.
- Impersonate a patient: there is no "sign in as" mechanism. Patient sessions are created only by
  `portalLogin()` after a password check.
- Change the owner of an account silently: no endpoint updates `patient_id` on an existing
  account.

---

## 4. Facility administration

A dedicated navigation entry, **Patient Portal Management**, above *Audit Trail & Security* in the
Administration group. It is not reachable from `/portal`, and the patient bundle never imports it.

| Tab | Endpoint(s) | Permission |
|---|---|---|
| Overview | `GET /api/portal/admin/overview` | `portal.accounts.manage` (+ `portal.audit.read` for the audit strip) |
| Accounts | `GET /accounts`, `GET /accounts/:id`, `POST …/suspend`, `…/reactivate`, `…/revoke`, `…/force-reset` | `portal.accounts.manage` |
| Settings | `GET/PUT /settings` | `portal.settings.manage` |
| Audit | `GET /audit` | `portal.audit.read` |
| Card lookup | `POST /card/lookup` | `patients.read` |

**Overview figures are queries, not constants.** Every number on the page comes from a `count()` or
a grouped query against this facility's rows: eligible patients, invited patients, accounts by
status, invitations by state, failed and not-configured deliveries. There is no target, benchmark
or industry average anywhere on the screen, because this build has no source for one.

**Audit is separate from account management.** The overview only includes the recent-audit strip
when the caller holds `portal.audit.read`; the Audit tab itself requires that permission and, by
design, **writing the audit read is part of reading it** — `listPortalAuditTrail()` calls
`logAuditEvent(… 'VIEW', 'PatientPortalAudit', …)` after the query. Nothing in the portal code has
an update or delete path to `audit_logs`; migration 0017's triggers remain the enforcement.

**Settings cannot disable security.** `clampPortalPolicy()` bounds expiry to 4–336 hours and resends
to 0–10, coerces every boolean strictly (`typeof value === 'boolean'`), and there is no key that
turns off single use, hashing, expiry, audit or the session table. A saved value is clamped again on
read, so a row edited directly in the database cannot widen the bounds either. A test asserts the
policy has exactly the documented eleven keys and none matching
`bypass|disable|skip|noverify|noauth`.

---

## 5. The patient surface

`/portal` and `/portal/activate` are decided in `App.tsx` **before** `HmisProvider` mounts, so a
patient's phone never loads the staff session, the staff module catalogue, the sidebar or the staff
notification queue.

### Activation

1. The page reads `window.location.hash`, keeps the token in component state, and immediately
   rewrites the address bar with `history.replaceState` so the token does not stay in history.
2. The password is validated client-side (length only) and again server-side; a mismatch or a weak
   password does not consume the link, because the token is used only after the password checks pass.
3. `POST /api/portal/auth/activate` runs one transaction: `SELECT … FOR UPDATE` on the token hash,
   state check, identity check, account creation, invitation `ACTIVATED`, event written.
4. **No session is issued on success.** The patient is told to sign in with the password they just
   chose. Opening an invitation link therefore cannot, by itself, produce an authenticated session.

### Dashboard and records

Everything is read from the existing clinical tables for the session's patient, restricted to the
facility set the account may read (registration facility + account facility):

| Screen | Source | Rule |
|---|---|---|
| Recent visits, diagnoses | `encounters`, `diagnoses` | Diagnosis released with the visit; ICD-10 code and description |
| Laboratory | `lab_orders`, `lab_results` | **Only `Verified` results.** An order with no verified result says so and explains why |
| Prescriptions | `medications` | Joined through `encounters` for facility scope |
| Appointments | `appointments` | Upcoming on the dashboard, all on the records tab |
| Discharge summaries | `admissions` (`status = 'Discharged'`) | Summary text, dates, disposition |
| Allergies | `patient_allergies` | Active only, facility-scoped |
| Vitals | not shown | The vitals table is written by triage; the portal does not currently project it (see §9) |
| Vaccination / maternal | not shown | No portal projection in this round; the modules exist for staff |

A section switched off in facility settings returns `403 SECTION_DISABLED` with a sentence the
patient can act on ("ask at the desk"), and the tab shows that sentence rather than an empty list
that would imply nothing was recorded.

### Corrections, downloads, card, sharing

- **Corrections** are requests. `POST /records/correction-request` writes an audit event and a
  correction record; there is no `UPDATE` to any clinical table in `portal-records.service.ts`, and
  a test asserts that.
- **Downloads** are generated per request and streamed with `Content-Disposition: attachment`.
  Nothing is stored, so there is no URL to forward. The browser fetches with the bearer token and
  revokes the object URL immediately after the click.
- **The card** carries `JC-P` plus 16 random bytes. The lookup path is
  `POST /api/portal/admin/card/lookup`, which requires a staff session, `patients.read`, the
  facility scope, a rate limit, and writes a `patient_record_access_logs` row. The code is stored as
  a SHA-256 hash (lookup) and an AES-256-GCM sealed copy (re-display to its owner only).
- **Sharing** creates a one-time code for a named recipient, with selected categories and a 1–720
  hour lifetime. Redemption requires a staff session with `patients.read` in the same tenant. The UI
  states, on the screen, that this is not a national health information exchange.

---

## 6. Permissions

Five codes, seeded in `src/seeds/permissions.ts`:

| Code | Granted to | Delegable by a facility to a custom role? |
|---|---|---|
| `portal.invite` | Receptionist (role catalogue) | **Yes** — front-desk work |
| `portal.invites.manage` | Facility administrator | No |
| `portal.accounts.manage` | Facility administrator | No |
| `portal.audit.read` | Facility administrator | No |
| `portal.settings.manage` | Facility administrator | No |

`src/auth/staff-role-policy.ts` gained the `portal` module in `DELEGABLE_PERMISSION_MODULES` and four
protected prefixes (`portal.accounts.`, `portal.audit.`, `portal.invites.`, `portal.settings.`), so a
facility can hand out the front-desk task without handing out the machinery. `portal.invite` is not
matched by any of the four prefixes. All five are in `FACILITY_ADMIN_PERMISSION_CODES` in
`src/routes/platform.routes.ts`.

Hiding a button is not a control: every one of the 19 staff endpoints calls `requirePermission(...)`
with one of these codes (or `patients.read` for card lookup and grant redemption), and a test
asserts at least 15 `requirePermission(` calls in the admin router.

---

## 7. Endpoints

### Patient — `/api/portal` (19)

| Method | Path | Auth |
|---|---|---|
| POST | `/auth/activate` | Public, rate-limited 10 / 15 min / IP |
| POST | `/auth/login` | Public, rate-limited 10 / 15 min / IP + 5-attempt account lock |
| POST | `/auth/logout` | Bearer (optional; revokes when present) |
| GET | `/me` | Patient session |
| GET | `/overview` | Patient session |
| GET | `/visits` | Patient session |
| GET | `/laboratory` | Patient session |
| GET | `/medications` | Patient session |
| GET | `/appointments` | Patient session |
| GET | `/discharge-summaries` | Patient session |
| GET | `/records/download` | Patient session |
| POST | `/records/correction-request` | Patient session |
| GET | `/sharing` | Patient session |
| POST | `/sharing` | Patient session |
| POST | `/sharing/:id/revoke` | Patient session |
| GET | `/access-history` | Patient session |
| GET | `/card` | Patient session |
| POST | `/card` | Patient session |
| POST | `/password` | Patient session |

### Staff — `/api/portal/admin` (19)

| Method | Path | Permission |
|---|---|---|
| GET | `/patients/:patientId/status` | `portal.invite` |
| POST | `/patients/:patientId/invitations` | `portal.invite` |
| POST | `/invitations/:id/link` | `portal.invite` |
| POST | `/invitations/:id/handed-over` | `portal.invite` |
| POST | `/invitations/:id/revoke` | `portal.invites.manage` |
| GET | `/overview` | `portal.accounts.manage` |
| GET | `/accounts` | `portal.accounts.manage` |
| GET | `/accounts/:id` | `portal.accounts.manage` |
| POST | `/accounts/:id/suspend` | `portal.accounts.manage` |
| POST | `/accounts/:id/reactivate` | `portal.accounts.manage` |
| POST | `/accounts/:id/revoke` | `portal.accounts.manage` |
| POST | `/accounts/:id/force-reset` | `portal.accounts.manage` |
| GET | `/accounts/:id/card` | `portal.accounts.manage` |
| GET | `/audit` | `portal.audit.read` |
| GET | `/risks` | `portal.accounts.manage` |
| GET | `/settings` | `portal.settings.manage` |
| PUT | `/settings` | `portal.settings.manage` |
| POST | `/card/lookup` | `patients.read` |
| POST | `/sharing/redeem` | `patients.read` |

The admin router calls `router.use(requireAuth)` before any handler and never
`requirePortalAuth`; the patient router calls `requirePortalAuth` after the public endpoints and
never `requireAuth`.

---

## 8. Deviations from the plan, and why

| Plan | Built | Reason |
|---|---|---|
| Portal administration as a tab inside `ConfigurationModule` | A dedicated `patient_portal` module | The brief asks for "a separate Patient Portal Management section", and the surface has five screens' worth of content. It is still a provisionable facility module, so a facility that does not run the portal can switch it off |
| Show a QR re-render on the staff account screen | Staff see only *whether* a card exists | Handing every administrator a scannable identifier is a wider disclosure than administration needs. The patient renders their own card |
| Restrict portal reads to the registration facility only | Registration facility **plus** the account's facility | A patient can be registered at one facility and served at another; excluding the serving facility would hide the visit the patient came to ask about |
| Dashboard includes vitals | Not included | The vitals projection needs its own column audit; shipping a guess would risk mislabelling a value. Listed in §9 |

---

## 9. What was verified, and what was not

### Verified in this environment

- `npx tsc --noEmit` — clean.
- `npm run build` — succeeded, 1,707 modules transformed.
- `npm test` — 24 scripts, 2,990 assertion statements, all passing, including 197 new portal assertions.
- The new tests exercise the real policy module (token entropy, hashing, expiry derivation, resend
  caps, masking, clamping, sharing validation, QR shape) and scan the real route and service sources
  for the properties that are easy to lose in a refactor (no patient id from the request, one generic
  invitation error, every list facility-scoped, no clinical writes, every read logged, permission on
  every admin route).

### Not verified — and this is the honest part

- **No PostgreSQL was available.** Migration 0018 has been type-checked and matched against the
  Drizzle schema, and the migration suite inspects it, but it has **not been applied to any
  database**, let alone production. No portal query has ever run against real rows.
- **No concurrent redemption test.** `SELECT … FOR UPDATE` plus the unique index is the mechanism;
  it has not been exercised under load.
- **No SMS or email provider.** The interface reports `NOT_CONFIGURED`; no message has ever been
  sent, and none is claimed to have been.
- **No browser end-to-end run.** There is no headless browser in this environment, so the screens
  are type-checked and built, not clicked.
- **No penetration test, no load test, no restore drill.**
- **Vitals, vaccination and maternal projections** are not shown in the portal yet.
- **Guardian access** is designed but not implemented (see `PATIENT_PORTAL_SECURITY_AUDIT.md` §8 for
  the legal questions that must be answered before it is).

Nothing here supports a statement that the system is production-ready. See
`PATIENT_PORTAL_DEPLOYMENT_GUIDE.md` §1 for the exact preconditions.
