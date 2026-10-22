# Patient Portal — Security Audit

**Date:** 22 October 2026
**Scope:** everything in `src/portal/`, `src/notifications/notification-provider.ts`,
`src/api/portal-client.ts`, `src/components/portal/`, `src/components/modules/PatientPortalModule.tsx`,
`drizzle/0018_patient_portal.sql`, and the permission and role-policy changes that support them.
**Method:** source review, contract tests, type-check, build. **No live database, no penetration
test, no browser automation.**

> **This is not a certificate.** It says what the code does and does not do. It does not say the
> deployment is compliant with the Kenya Data Protection Act, 2019, the Digital Health Act, 2023 or
> any facility policy. Those depend on contracts, notices, retention decisions, staff training and
> breach handling that no amount of code can supply. Section 8 lists them as open.

---

## 1. Threat model and what stops it

| # | Threat | Control | Where | Verified by |
|---|---|---|---|---|
| T1 | Attacker with a stolen phone guesses a password | 5 failed attempts → 15-minute lock, counted per account, then the generic error until the lock expires | `portal-auth.service.ts` `portalLogin` | Policy constants test; lock logic reviewed |
| T2 | Attacker enumerates which phone numbers belong to patients | One generic `INVALID_CREDENTIALS` for unknown identifier, wrong password, malformed identifier and empty input. Account state (suspended/revoked/unverified) is disclosed **only after** the password verifies | `portalLogin` — status checks moved after `verifyPassword` | Test asserts the generic path; source order reviewed |
| T3 | Someone opens an invitation link and gets a session | Activation verifies the token, consumes it in one transaction, and returns **no session**. Sign-in is a separate, password-checked step | `activateInvitation`, `portal.routes.ts` | Source test: activation route returns 201/202 with no token |
| T4 | Two tabs redeem the same link | `SELECT … FOR UPDATE` on the row, state re-checked inside the transaction; second attempt sees a non-PENDING row | `activateInvitation` | **Not executed** — needs PostgreSQL |
| T5 | An old link is revived | `deriveInvitationStatus` never returns `PENDING` for an expired row; `canResendInvitation` refuses to resend an expired activation (a new invitation must be issued); reuse, revocation and supersession are all terminal | `portal-policy.ts` | 20+ assertions on the state machine |
| T6 | Token leaks through logs, URLs, audit rows or Referer | Invitation token lives in the URL **fragment**, posted in a request body; sessions use a Bearer header; audit and event writers accept no free text; only SHA-256 hashes and sealed copies are stored | `buildActivationLink`, `writeEvent`, `logAuditEvent`, `portal.middleware.ts` | Test asserts no `req.query.token`, no token in `logAuditEvent`/`console`, and generic error codes |
| T7 | A patient token reaches a staff route | Different table (`patient_portal_sessions`), different middleware (`requirePortalAuth`), different router (`/api/portal`), different client key | `portal.middleware.ts`, `app.ts`, `portal-client.ts` | Test asserts the admin router never uses `requirePortalAuth` |
| T8 | A staff token reaches the patient portal | `requirePortalAuth` reads only `patient_portal_sessions`; a staff token hash is not there | same | same |
| T9 | Browser supplies someone else's patient id | No patient route accepts a patient identifier at all; the id comes from `req.portalSession` | `portal.routes.ts`, all of `portal-records.service.ts` | Test asserts no `req.body.patientId` / `req.query.patientId` |
| T10 | Cross-facility read | Every record query is filtered to `allowedFacilityIds(session)` = patient's registration facility ∪ account facility. Empty set is refused, not silently widened | `portal-records.service.ts` | Test asserts each `inArray(...facilityId, facilities)`; source reviewed line by line |
| T11 | Cross-tenant read | Portal account carries `tenant_id`; record queries key on session `patientId` whose row is tenant-checked in `allowedFacilityIds`; staff administration scopes by `tenantId + facilityId` | `portal-records.service.ts`, `portal-admin.service.ts` | Reviewed |
| T12 | Unreleased clinical data shown | Laboratory results only where `lab_results.status = 'Verified'`; a test asserts the filter; the empty state explains that an unsigned result is not a missing test | `listPortalLabResults` | Test asserts the `'Verified'` gate |
| T13 | Patient edits the record | No `UPDATE`/`DELETE` to a clinical table exists in the portal modules; corrections create a request | `portal-records.service.ts` | Test asserts no `.update(schema.<clinical>)` |
| T14 | QR code scanned grants access | Lookup requires a staff session **and** `patients.read` **and** facility scope **and** the rate limit; it returns demographics for a person already authorised to see them, and writes an access log | `qr.service.ts`, `portal-admin.routes.ts` | Test asserts the route permission; card payload test |
| T15 | QR code contains PHI or credentials | Payload is `JC-P` + 16 random bytes. No MRN, name, diagnosis, national id, password or session token. The printed surround carries name and MRN, which the card's owner already knows | `renderCard` | Test asserts only `code` reaches `QRCode.toString` |
| T16 | Public link to a medical record | Downloads are generated per request and streamed as an attachment with the bearer token; no stored file, no public path | `GET /records/download` | Reviewed; no static route exists |
| T17 | Administrator silently edits or erases history | No update or delete path to `audit_logs` in portal code; 0017 triggers + REVOKE remain the enforcement; admin actions all call `logAuditEvent`; reading the audit trail is itself logged | `portal-admin.service.ts` | Test asserts no clinical writes; audit call reviewed |
| T18 | Facility switches security off in settings | 11 keys only; strict boolean coercion; clamped on write **and** read; no bypass key | `clampPortalPolicy` | Test asserts exact key set and no `/bypass|disable|skip|noverify|noauth/` |
| T19 | Receptionist reads clinical history | The panel calls one endpoint returning portal status only; the endpoint returns no clinical fields | `getPatientPortalStatus` | Reviewed |
| T20 | Receptionist administers accounts | `portal.accounts.manage` is not in the receptionist role; the sidebar entry is gated; the API refuses | role catalogue, `Sidebar.tsx`, admin router | Test asserts the receptionist has `portal.invite` and not the other four; delegation test |
| T21 | Brute force on public endpoints | `express-rate-limit` 10 requests / 15 min / IP on activation and login, plus the per-account lock | `portal.routes.ts` | Reviewed; the security test suite covers the limiter shape elsewhere |
| T22 | Shared response caches a patient record | `Cache-Control: no-store, no-cache, must-revalidate, private` and `Pragma: no-cache` set by `requirePortalAuth` on every patient response | `portal.middleware.ts` | Reviewed |
| T23 | PII in the browser after sign-out | Token removed from `localStorage`; session revoked server-side on logout; `401` clears the local token | `portal-client.ts`, `/auth/logout` | Reviewed |
| T24 | A second account for the same person | `UNIQUE (patient_id)` and `UNIQUE (login_identifier)`; activation refuses when the contact is already owned by another account and flags the patient for staff verification instead of merging | 0018 SQL, `activateInvitation` | Test asserts the constraints exist in SQL and schema |
| T25 | Sharing code forwarded to the wrong person | Single use, named recipient, expiry, revocable, redeemed only inside an authenticated staff session in the same tenant, and logged | `portal-sharing.service.ts` | Source reviewed; redemption order (revoked → expired → used) tested by reading |

---

## 2. Identity and session design

- A portal account is **not** a `users` row. `patient_portal_accounts` has no `role_id`, no
  `is_super_admin`, and no path into staff RBAC.
- Passwords use the existing argon2id helper (`src/utils/password.ts`) with the same minimum length
  policy (12), and `checkPortalPassword()` additionally refuses all-space and single-character-repeat
  values. The activation flow checks the password **before** consuming the token.
- Sessions: 48 random bytes, base64url, stored only as SHA-256, 2-hour lifetime, revoked on password
  change, on suspension, on revocation and on "force reset". `security_version` exists for future
  invalidation and is incremented on forced reset; the current check is `status = 'ACTIVE'` plus
  `expires_at` plus `revoked_at`.
- The patient token key in `localStorage` is different from the staff key
  (`jalicare_portal_token` vs `jalicare_session_token`), and the staff client and the portal client
  are separate modules with separate `fetch` wrappers.

### Known session limitation

There is no CSRF concern because authentication is a Bearer header, not a cookie. There is also no
"confirm this device" step and no device list for the patient; the account tab shows the account's
sessions only to an administrator. Adding patient-visible session management is a follow-up, not a
defect being hidden.

---

## 3. Token handling, in detail

| Token | Generation | Storage | Transport | Lifetime |
|---|---|---|---|---|
| Invitation | 32 random bytes, base64url | SHA-256 only (`token_hash`, unique) | URL fragment → posted in body | 4–336 h, default 72 |
| Session | 48 random bytes, base64url | SHA-256 only (`session_token_hash`, unique) | `Authorization: Bearer` | 2 h |
| Sharing code | 32 random bytes (`hashInvitationToken` reuse) | SHA-256 only (`code_hash`, unique) | Typed into a staff screen | 1–720 h, default 24 |
| Card code | `JC-P` + 16 random bytes | SHA-256 for lookup + AES-256-GCM sealed copy | Printed/shown to staff to scan | Until re-issued |

The raw invitation token exists in exactly two places: the API response that created it (shown once
to the receptionist) and the patient's browser. There is no endpoint that can return it again;
"re-send" issues a **new** token and supersedes the old row, which is also why a lost printed slip
cannot be recovered, only replaced.

**What is deliberately not done:** the token is not written to any log, audit row, analytics event
or error message. `describeEvent()` returns a fixed string per event type and accepts no free text.
The one place free text is accepted is a staff "reason" field, which is length-capped and concerns
the action, not the credential.

---

## 4. Facility and tenant isolation

`allowedFacilityIds()` reads the patient's `registration_facility_id` under the session's
`tenant_id`, unions the account's `facility_id`, and refuses an empty set with
`403 FACILITY_NOT_LINKED`. Every record query in `portal-records.service.ts` carries that filter:

- encounters (visits) — direct `facility_id`
- appointments — direct `facility_id`
- laboratory orders — direct `facility_id`
- admissions (discharge summaries) — direct `facility_id`
- allergies — direct `facility_id` (dashboard and download)
- prescriptions — through `INNER JOIN encounters` on `encounter_id`, because `medications` has no
  facility column of its own

Staff administration scopes on `tenant_id` **and** `facility_id`; another facility's account is
reported as `404 ACCOUNT_NOT_FOUND`, not `403`, so the response cannot be used to confirm that an
account exists elsewhere.

---

## 5. Error handling and disclosure

| Endpoint group | Behaviour |
|---|---|
| Activation | One message/code (`INVALID_INVITATION`) for unknown, expired, revoked, superseded and already-used tokens. A rejected redemption still writes a `REDEEM_REJECTED` event for the facility |
| Login | One message (`INVALID_CREDENTIALS`) until the password verifies; then account state may be disclosed |
| Staff endpoints | Specific messages, because the caller is authenticated and authorised for that patient |
| Unexpected errors | Logged server-side, answered with a code and no stack, no SQL, no identifiers |
| Card lookup | "No patient matches that card" for both a wrong code and another facility's code |

The generic-error rule is enforced *by the shape of the code*, not by discipline: the activation
service constructs the same `PortalError` in all five branches, and a test asserts none of
`TOKEN_EXPIRED|TOKEN_ALREADY_USED|TOKEN_REVOKED|TOKEN_NOT_FOUND` appears in it.

---

## 6. Audit and access logging

Every patient read writes `patient_record_access_logs` with `accessChannel = 'PATIENT_PORTAL'`, a
purpose from a fixed list, and no clinical payload. Reads covered: dashboard, visits, laboratory,
medications, appointments, discharge summaries, download, sharing redemption, card lookup.

Staff portal actions write `audit_logs`: invitation issued, invitation revoked, account suspended,
reactivated, revoked, password reset forced, settings changed, card issued, card look-up, sharing
grant redeemed, and **portal audit trail read**.

Immutability is not re-implemented here. Migration 0017 installed
`jalicare_audit_is_append_only()` with row and statement triggers and `REVOKE UPDATE, DELETE,
TRUNCATE`. The portal adds no bypass. (0017 itself has still not been applied — see the deployment
guide.)

---

## 7. Data protection review (technical findings only)

| Obligation (DPA 2019 / Digital Health Act 2023 themes) | What the code supports | What it does not |
|---|---|---|
| Lawful basis and notice | Consent capture exists for clinical purposes (`consent.service.ts`); the portal shows a plain-language footer about what the portal is | There is no portal-specific privacy notice, and no evidence that one has been given to the patient before the first sign-in |
| Purpose limitation | Access logs carry a purpose; sharing grants require a stated purpose | Nothing enforces that a facility reads only for the stated purpose — that is policy and training |
| Data minimisation | Reception sees masked contact and portal status only; lists mask identifiers; results release only when verified; the card carries no PHI | The download contains the patient's full record by design — that is the point of a download, and it is the patient's own data |
| Storage limitation | Invitations expire; sessions expire; sharing grants expire; account revocation is terminal | **No retention schedule has been decided or implemented.** Old invitations, events, sessions and access logs accumulate. This is a policy decision that must be made before production |
| Integrity and confidentiality | TLS expected at the edge; `no-store` on patient responses; hashed tokens; AES-256-GCM for sealed identifiers **when `FIELD_ENCRYPTION_KEY` is set** | Without the key, sealed values are stored in plaintext (they are opaque random identifiers, but the key is still the stronger position). Database volume and backups are not encrypted by this application |
| Patient rights (access, correction) | Download and correction-request flows | No erasure flow (deliberately: a health record is not erasable on request in the same way as marketing data — the facility needs its own legal position). No export format beyond a text summary |
| Breach handling | Access logs and audit trail make an investigation possible | There is no notification workflow, no breach register, no on-call process |
| Cross-border / processor agreements | No third-party processor is integrated — there is no SMS or email provider configured | When a provider is added, a data-processing agreement and a decision on message content (never include clinical detail) are required |

---

## 8. Open risks and unanswered questions

1. **Nothing has run against PostgreSQL.** Concurrency, constraint enforcement and query correctness
   are unproven at runtime. This is the largest open risk in this round.
2. **No penetration test.** The table above is a design review, not an adversarial test.
3. **No guardian access.** The brief asks for it to be *designed*. A guardian must have their own
   identity and a verified legal authority (birth certificate, court order, written authority for a
   minor over 12 under Kenyan practice). The account model supports a separate account and a link
   table; the **legal** questions — at what age a minor may hold their own account, what a guardian
   may see once the minor turns 18, who arbitrates a family dispute — are not answered here and must
   not be invented.
4. **Deceased patients.** No flow exists. An account for a deceased patient must not remain usable
   indefinitely; this needs a facility policy and, ideally, a status value.
5. **Retention.** Undecided (see §7).
6. **Provider integration.** SMS and email are interfaces with no implementation. Until one exists,
   "delivery failed / not configured" is the truthful state.
7. **Analytics.** The portal emits no client-side analytics and includes no third-party script. If
   one is ever added, it must be excluded from `/portal` and from anything carrying an identifier.
8. **Rate limiting behind a proxy.** `req.ip` depends on `trust proxy` being configured correctly at
   the edge. If it is wrong, every patient shares one bucket, or the limiter is trivially bypassed
   with a header. This is an infrastructure setting that must be verified at deployment.
9. **Legal compliance.** Not declared. Technical safeguards are necessary and insufficient.

---

## 9. What a reviewer should re-check first

1. Apply 0017 and 0018 to a restored copy of production, then run the concurrency test in
   `PATIENT_PORTAL_TEST_RESULTS.md` §5.
2. Confirm `trust proxy` and the real client IP at the edge.
3. Confirm `FIELD_ENCRYPTION_KEY` is set, and check that a database dump does not contain a
   scannable card code or a readable national ID.
4. Attempt, as a receptionist, to call every `/api/portal/admin` endpoint that the UI hides.
5. Attempt, as a patient signed in at facility A, to reach a record created at facility B in the
   same tenant.
6. Read `audit_logs` as a facility administrator and confirm the portal actions are present, in the
   right order, with the right actor.
