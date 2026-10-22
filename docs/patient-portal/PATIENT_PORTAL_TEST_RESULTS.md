# Patient Portal — Test Results

**Date:** 22 October 2026
**Environment:** Linux sandbox, Node.js 22.22.3, no PostgreSQL server, no browser automation.
**Branch:** `arena/14785aa5-afyahub-hmis-kenya`

Everything below is copied from commands that were actually run. Where a test could not be run, it
says so and is not counted.

---

## 1. Summary

| Check | Command | Result |
|---|---|---|
| Type-check | `npm run lint` (= `tsc --noEmit`) | **PASS** — no diagnostics |
| Production build | `npm run build` | **PASS** — 1,707 modules transformed, built in 577 ms |
| Full test suite | `npm test` | **PASS** — 26 scripts, **3,307 assertion statements** |
| New portal suite | `npm run test:patient-portal` | **PASS** — **197 assertions** |
| Migration suite | `npm run test:migrations` | **PASS** — 692 assertions (includes 0018 shape) |
| Migration applied to PostgreSQL | — | **NOT RUN** — no database available |
| Concurrent redemption | — | **NOT RUN** — needs a database |
| Browser end-to-end | — | **NOT RUN** — no headless browser |

---

## 2. Full suite output

```
INPATIENT TESTS PASSED (97 assertions)
OPD JOURNEY TESTS PASSED (58 assertions)
BILLING TESTS PASSED (31 assertions)
NURSING TESTS PASSED (83 assertions)
REPORTING TESTS PASSED (216 assertions)
PHARMACY BATCH TESTS PASSED (80 assertions)
PAYMENT SETTLEMENT TESTS PASSED (89 assertions)
INSURANCE CLAIMS TESTS PASSED (101 assertions)
DHA INTEGRATION TESTS PASSED (176 assertions)
PROFESSIONAL VERIFICATION TESTS PASSED (100 assertions)
STAFF ROLES TESTS PASSED (135 assertions)
Staff role catalogue tests passed.            (13 PASS: lines)
DESIGN TOKEN TESTS PASSED (33 assertions)
FACILITY MODULE TESTS PASSED (55 assertions)
NOTIFICATION TESTS PASSED (28 assertions)
DHA COMPLIANCE TESTS PASSED (230 assertions)
ROUTE SCOPE TESTS PASSED (66 assertions)
MATERNITY TESTS PASSED (131 assertions)
POSTNATAL & IMMUNISATION TESTS PASSED (151 assertions)
HTTP SECURITY TESTS PASSED (54 assertions)
MIGRATION TESTS PASSED (692 assertions)
Field encryption: 48 assertions passed.
Consent and allergy: 80 assertions passed.
Patient portal policy: 197 assertions passed.
```

Total: 3,294 numbered assertions + 13 catalogue `PASS:` lines = **3,307**, across 26 scripts. Exit
status 0.

Two suites changed in this round because the code changed, and both were updated for an honest
reason rather than to make a failure go away:

- `facility-modules.test.ts` — the catalogue now holds **20** modules (it gained `patient_portal`).
  The assertion said 19. A new assertion was added that `patient_portal` is provisionable rather
  than always-on.
- Nothing else was relaxed.

---

## 3. What the new suite covers — `src/tests/patient-portal.test.ts`

197 assertions in eleven groups.

### 3.1 Invitation tokens (14 assertions)

- 500 generated tokens are all distinct; length ≥ 40; URL-safe alphabet.
- Stored form is a 64-character SHA-256 hex digest; the digest does not contain the token; hashing is
  deterministic so lookup by hash works.
- Constant-time comparison: equal hashes match; different tokens do not; a one-character difference
  does not; different lengths do not.

### 3.2 Expiry and single use (12)

- `PENDING` inside its window reads `PENDING`; past its window reads `EXPIRED` **even though the
  stored status still says PENDING**.
- Expiring exactly now is expired.
- `ACTIVATED`, `REVOKED`, `SUPERSEDED` are terminal regardless of the expiry date.
- An unparseable expiry fails closed (`EXPIRED`).
- An ISO-string expiry is parsed, not treated as invalid.
- `isInvitationRedeemable` is true only for a live `PENDING` row.

### 3.3 Resend policy (11)

- Allowed below the cap, refused at and above it, refused when the facility allows zero.
- Never allowed for `ACTIVATED` (would be a second account), `REVOKED` or `SUPERSEDED`.
- An **expired activation** link is refused with a reason that says a new invitation is needed; an
  expired **recovery** link may be reissued in place — the deliberate difference is asserted.
- Every refusal carries a reason string.

> Note: `canResendInvitation()` reads the wall clock, so these cases are anchored to `Date.now()`.
> The pure expiry cases use a fixed date.

### 3.4 Contact normalisation and masking (14)

- `0712345678`, `+254712345678`, `254-712-345-678` and `254 712 345 678` normalise to one value,
  `254712345678`.
- Email trimmed and lower-cased.
- Phone preferred over email; email used when no usable phone; `null` returned when neither is
  usable rather than an invented contact; whitespace is not a contact.
- Masking: `2547***678` for a phone, `p******@example.com` for an email, `***` for values too short
  to mask, `***` for a malformed email, `null` for no contact. Masking always changes the value.

### 3.5 Passwords (10)

Missing, non-string, under 12, one repeated character, all spaces, over 200 → refused. Twelve
characters and a long passphrase → accepted.

### 3.6 Settings clamping (13)

- Missing values fall back to defaults.
- Below the floor is raised; above the ceiling is reduced; negative becomes the floor; non-numeric
  becomes the default.
- A string is **not** accepted as a boolean; a boolean is honoured; a number is not coerced to false
  (so a half-filled form cannot switch a section off by accident).
- The default policy is frozen.
- The policy has **exactly** the eleven documented keys, and no key matching
  `bypass|disable|skip|noverify|noauth`.

### 3.7 Sharing (12)

- Valid request kept and trimmed; durations inside bounds kept, above the maximum clamped, missing →
  24 hours; duplicate categories stored once.
- Null request, missing recipient, one-character purpose, empty categories, misspelt category, one
  invalid category among valid ones → each refused.
- The vocabulary is fixed and has no `everything` catch-all.

### 3.8 QR card (14)

- Prefix `JC-P`, two codes differ, generated code passes the shape check, alphabet is URL-safe with
  no separators.
- SHA-256 digest, not the code; deterministic.
- `null`, empty, foreign prefix, too-short, too-long and lower-case prefix are all implausible.
- Source-level: the only value passed to `QRCode.toString()` is the opaque code; the encode call
  contains no name, MRN or date of birth; the printed surround contains no diagnosis, prescription,
  result or national id; name and MRN are HTML-escaped; the card text states that scanning does not
  grant access.

### 3.9 Source-level route guarantees (33)

Portal routes:

- `req.portalSession` is the identity; no `req.body.patientId`, no `req.query.patientId`, no
  `body.patientId`.
- The activation token is read from the body and never from the query string.
- No `console.*token` in the auth service and no token passed to `logAuditEvent`.
- One generic `INVALID_INVITATION` code used at least three times in `activateInvitation`, and none
  of `TOKEN_EXPIRED|TOKEN_ALREADY_USED|TOKEN_REVOKED|TOKEN_NOT_FOUND` appears in it.

Record service:

- Laboratory results gated on `'Verified'`.
- `allowedFacilityIds` present; reads keyed on `session.patientId`.
- Facility filter present for encounters, appointments, lab orders, admissions, prescriptions
  (through `encounters`, twice) and allergies (twice).
- No `.update(schema.patients|diagnoses|encounters|labResults|medications)` anywhere.
- At least eight `logPortalRecordAccess(` calls.
- The patient route file does not import the staff admin client.

Admin routes:

- `router.use(requireAuth)` present; `requirePortalAuth` absent.
- `portal.accounts.manage`, `portal.audit.read` and `portal.settings.manage` each appear as a
  `requirePermission` guard.
- At least 15 `requirePermission(` calls.

### 3.10 Migration and schema shape (14)

- The six tables are created with `CREATE TABLE IF NOT EXISTS`.
- Unique constraints/indexes exist for `patient_id`, `login_identifier`, invitation `token_hash`, and
  a partial unique index on `qr_token_hash`.
- `qr_token_sealed` exists in both SQL and the Drizzle schema.
- No `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or `UPDATE patients` in 0018.
- The Drizzle `patientPortalAccounts` block declares the unique index on `patient_id` and the unique
  index on the login identifier.

### 3.11 Permissions and delegation (12)

- All five `portal.*` codes are seeded.
- The receptionist role has `portal.invite` and does not have the other four.
- All five are in the facility-administrator permission list.
- `portal.invite` is delegable to a custom role; the other four are not; a permission with the wrong
  module is not delegable.

---

## 4. Existing suites that were re-run and still pass

All 23 pre-existing scripts pass unchanged except the module-catalogue count described in §2. Of
particular relevance to the portal:

| Suite | Why it matters here |
|---|---|
| `migration.test.ts` (692) | Parses and checks every migration, including 0018's additive-only shape |
| `route-scope.test.ts` (66) | Scans API routes for permission and scope gaps |
| `http-security.test.ts` (54) | Helmet, CORS and rate-limiter configuration |
| `staff-roles.test.ts` (135) | Role and task-grant rules, including the new delegability entries |
| `field-encryption.test.ts` (48) | The crypto used for the sealed card code |
| `consent-allergy.test.ts` (80) | The clinical modules the portal reads from |
| `design-tokens.test.ts` (33) | Palette rules — the portal uses the same blue/orange tokens |

---

## 5. Tests that exist only as instructions, because they need a database

These are the acceptance tests a reviewer must run against a restored copy before trusting the
portal. They are written out here so they are not forgotten, and they are **not** counted as passed.

### 5.1 Invitation security

```
1. Issue an invitation as MANUAL. Redeem it. Expect 201, no session, account ACTIVE.
2. Redeem the same token again.                    Expect 400 INVALID_INVITATION.
3. Issue, then expire by UPDATE expires_at = now() - 1 hour.
   Redeem.                                          Expect 400 INVALID_INVITATION.
4. Issue, revoke, redeem.                           Expect 400 INVALID_INVITATION.
5. Issue twice for one patient; redeem the first.   Expect 400 (it was SUPERSEDED).
6. Redeem a random 43-character token.              Expect 400 INVALID_INVITATION.
```

### 5.2 Concurrent redemption

```
Open two transactions on the same token; redeem in both, commit in parallel.
Expected: exactly one 201, one 400, exactly one row in patient_portal_accounts
for that patient, one ACTIVATED invitation, one REDEEM_REJECTED event.
```

### 5.3 Delivery

```
Set channel SMS with no provider.  Expect delivery_status = NOT_CONFIGURED,
delivery_attempts = 1, no message sent, and a response that says nothing was sent.
Set channel MANUAL.                Expect an activation link in the response and
delivery_status PENDING until the desk marks handover.
```

### 5.4 Identity and privacy

```
- Patient with a phone already used by another account: activation returns
  202 requiresStaffVerification, no account is created for the second patient,
  and the patient is flagged.
- Patient with no phone and no email: account parked PENDING_VERIFICATION.
- Two patients, two accounts: patient A's session must never return B's rows —
  check /visits, /laboratory, /medications, /appointments, /discharge-summaries,
  /card, /access-history.
- Cross-facility: create an encounter at facility B for a patient registered at A
  and not served by B; it must not appear.
```

### 5.5 Permissions

```
As a receptionist: POST /api/portal/admin/accounts/1/suspend   -> 403
                   GET  /api/portal/admin/overview            -> 403
                   GET  /api/portal/admin/audit               -> 403
                   PUT  /api/portal/admin/settings            -> 403
                   POST /api/portal/admin/patients/1/invitations -> 201
As a facility administrator: the above four return 200/201.
```

### 5.6 Clinical release

```
lab_results.status = 'Pending Verification'  -> not returned by /laboratory
lab_results.status = 'Verified'              -> returned
discharge summary text on a non-discharged admission -> not returned
facility settings showLabResults = false     -> /laboratory returns 403 SECTION_DISABLED
```

### 5.7 Audit

```
Every portal read appears in patient_record_access_logs with channel PATIENT_PORTAL.
Every admin action appears in audit_logs with the staff user id.
Reading /api/portal/admin/audit writes a VIEW / PatientPortalAudit row.
UPDATE or DELETE on audit_logs is refused by the database (requires 0017).
```

---

## 6. What this document does not claim

- It does not claim the portal works against a real database.
- It does not claim any SMS or email was delivered.
- It does not claim a penetration test, a load test, an accessibility audit or a restore drill.
- It does not claim the UI was clicked in a browser.
- It does not claim legal compliance.

The next step that would raise confidence most is §5 against a restored copy of a real database.
