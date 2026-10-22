# Patient Portal — Implementation Plan

**Date:** 22 October 2026
**Branch:** `arena/14785aa5-afyahub-hmis-kenya`
**Base commit:** `23a636d`
**Status:** superseded as a plan by `PATIENT_PORTAL_IMPLEMENTATION.md`, which records what was
actually built. Kept as the design record. Three decisions changed during implementation — a
dedicated module instead of a Configuration tab, staff cannot re-render a patient's card, and the
record scope is the registration facility **plus** the account's facility. Each is explained, with
its reason, in `PATIENT_PORTAL_IMPLEMENTATION.md` §8.

---

## 1. What the existing system already gives us

| Concern | Existing implementation | Reused? |
|---|---|---|
| Database | PostgreSQL 16 via `pg` + Drizzle ORM, 18 migrations | Yes — additive migration 0018 only |
| Patient identity | `patients` (id, tenant_id, registration_facility_id, mrn, phone, email) | Yes — no second patient table |
| Password hashing | argon2id via `src/utils/password.ts` | Yes — same module |
| Session pattern | `sessions` table stores only a SHA-256 hash of a 48-byte token | Yes — mirrored in a separate patient table |
| RBAC | `permissions` catalogue + `requirePermission` middleware | Yes — five new permission codes |
| Facility admin UI | `ConfigurationModule` tabbed shell | Yes — new `portal` tab |
| Reception UI | `PatientRegistrationModule` directory + registration form | Yes — invitation panel on the patient row |
| Clinical data | encounters, diagnoses, medications, lab_orders/results, allergies, appointments, admissions | Yes — read-only projections |
| Access logging | `patient_record_access_logs` with `PATIENT_PORTAL` channel already in the enum | Yes |
| Audit | `audit_logs`, append-only since 0017 | Yes |
| Notifications | **None configured** — no SMS or email provider anywhere in the repository | New provider interface that reports `NOT_CONFIGURED` |

**Stack note:** the brief says "if Jalicare uses SQLite and Drizzle ORM, preserve that".
It does not. Jalicare is **PostgreSQL** + Drizzle. That architecture is preserved; no
SQLite is introduced.

---

## 2. Design decisions made before coding

1. **Patients are not staff users.** A portal account lives in
   `patient_portal_accounts`, never in `users`. A patient can therefore never hold a
   staff role, and a bug in portal authorisation cannot reach the staff RBAC tables.

2. **One account per patient, enforced by the database.** `patient_id` is `UNIQUE`.
   Concurrent activation is resolved by `SELECT … FOR UPDATE` inside a transaction plus
   that constraint — the second redemption fails, it does not create a second account.

3. **The login identifier is unique.** A phone number already in use produces
   `PORTAL_CONTACT_IN_USE` and a staff-assisted verification request. It is never used
   to infer that two people are the same person.

4. **Delivery status is separate from account status** (`delivery_status` vs `status`
   vs the account's own `status`), because "the SMS left the building" is not
   "the patient activated".

5. **No provider is configured.** Invitations support a `MANUAL` channel that is
   genuinely functional today — the receptionist receives a one-time activation link to
   hand or print — and `SMS`/`EMAIL` channels that return `NOT_CONFIGURED` with a
   written reason. Nothing reports "sent" that was not sent.

6. **The QR code carries a random opaque code**, not a patient id, and scanning it
   authenticates nobody. A staff-authenticated, permission-checked, rate-limited
   endpoint resolves it.

7. **Guardian access is designed but not built.** The legal questions (age of consent
   for adolescents, proof of guardianship, separated-parent access) are recorded in the
   security audit rather than guessed at in code.

---

## 3. Files to create

| File | Purpose |
|---|---|
| `drizzle/0018_patient_portal.sql` | 6 tables, indexes, constraints — additive only |
| `src/portal/portal-policy.ts` | Pure functions: contact normalisation, invitation status derivation, expiry, resend policy, policy bounds |
| `src/portal/portal.service.ts` | Invitations, activation, account lifecycle |
| `src/portal/portal-auth.service.ts` | Patient sessions, login, lockout, password change |
| `src/portal/portal-records.service.ts` | Read-only clinical projections scoped to the session patient |
| `src/portal/portal-admin.service.ts` | Facility overview statistics, account search and administration |
| `src/portal/portal-sharing.service.ts` | Time-limited, revocable record-sharing grants |
| `src/portal/qr.service.ts` | Server-side QR SVG for the digital patient card |
| `src/portal/portal.routes.ts` | Public activation/login + authenticated patient API |
| `src/portal/portal-admin.routes.ts` | Staff invitation and administration API |
| `src/notifications/notification-provider.ts` | Provider interface + `NOT_CONFIGURED` reporting |
| `src/components/PatientPortal.tsx` | Patient-facing application (`/portal`) |
| `src/components/PortalInvitationPanel.tsx` | Reception: invite / resend / revoke, embedded in the patient row |
| `src/components/modules/PatientPortalAdminPanel.tsx` | Facility Admin → Patient Portal Management |
| `src/tests/patient-portal.test.ts` | Policy, security wiring and migration assertions |
| `docs/patient-portal/*.md` | The five deliverables |

## 4. Files to modify

| File | Change |
|---|---|
| `src/db/schema.ts` | Six new tables + relations |
| `drizzle/meta/_journal.json` | Journal entry 18 |
| `src/app.ts` | Mount `/api/portal` and `/api/portal/admin`; QR lookup route |
| `src/seeds/permissions.ts` | `portal.invite`, `portal.invites.manage`, `portal.accounts.manage`, `portal.audit.read`, `portal.settings.manage` |
| `src/auth/staff-role-catalogue.ts` | Receptionist: `portal.invite` |
| `src/routes/platform.routes.ts` | Facility Admin permission list gains the portal codes |
| `src/components/modules/ConfigurationModule.tsx` | `portal` tab |
| `src/components/modules/PatientRegistrationModule.tsx` | Invitation action + status on each patient row |
| `src/App.tsx` | `/portal` and `/activate-portal` standalone routes |
| `src/api/client.ts` | Portal API surface + types |
| `package.json` | `test:patient-portal` |

## 5. Order of work

1. Migration + schema, `test:migrations` green.
2. Policy module + unit tests (pure, no database).
3. Notification provider (reports honestly).
4. Invitation + activation service, then routes.
5. Patient auth + records, then routes.
6. Admin overview + account management, then routes.
7. UI: reception → facility admin → patient portal.
8. Full test suite, lint, build.
9. Five documents.

Every phase ends with `npm run lint`, `npm run build` and `npm test`.
