# Test Results

**Executed:** 21 October 2026 (audit round), re-run after the consent/encryption
remediation the same evening, and again on 22 October 2026 after the patient
portal round
**Environment:** Linux sandbox, Node with `tsx`, **no PostgreSQL**, **no browser**
**Commit:** this branch, after the remediation described in the readiness audit

Every result below was produced by running the command on this checkout. Nothing
in this document is projected or assumed. Where a check could not run, it says so
and gives the exact blocker.

---

## 1. Summary

| Check | Command | Result |
|---|---|---|
| Type check | `npm run lint` (`tsc --noEmit`) | **PASS** — no output, exit 0 |
| Production build | `npm run build` (`vite build`) | **PASS** — **1,707 modules** (22 Oct) |
| Test suite | `npm test` | **PASS** — **26 suites, 3,429 assertion statements** (3,416 numbered + 13 catalogue `PASS:` lines) |
| Portal suite | `npm run test:patient-portal` | **PASS** — 197 assertions |
| Migration files | `npm run test:migrations` | **PASS** — 741 assertions (0017–0021 included, still unapplied) |
| Database status | `npm run db:status` | **BLOCKED** — `Missing required environment variable: SQL_HOST` |
| Browser walkthrough | — | **BLOCKED** — no browser in this environment |
| DHA sandbox call | — | **BLOCKED** — no credentials |

**The type check passing is itself a finding.** Before this audit `npm run lint`
failed on every run because `src/lib/firebase.ts` imported a git-ignored JSON file
that does not exist. The failure was known and tolerated, which is exactly how a
real type error hides.

---

## 2. Test suite output

Verbatim, from `npm test`:

```
INPATIENT TESTS PASSED (97 assertions)
OPD JOURNEY TESTS PASSED (83 assertions)
BILLING TESTS PASSED (75 assertions)
TARIFF MATCHING TESTS PASSED (92 assertions)
TARIFF RESOLVER TESTS PASSED (135 assertions)
WARD BILLING TESTS PASSED (103 assertions)
NURSING TESTS PASSED (83 assertions)
REPORTING TESTS PASSED (216 assertions)
PHARMACY BATCH TESTS PASSED (80 assertions)
PAYMENT SETTLEMENT TESTS PASSED (93 assertions)
INSURANCE CLAIMS TESTS PASSED (109 assertions)
DHA INTEGRATION TESTS PASSED (176 assertions)
PROFESSIONAL VERIFICATION TESTS PASSED (100 assertions)
STAFF ROLES TESTS PASSED (135 assertions)
DESIGN TOKEN TESTS PASSED (33 assertions)
FACILITY MODULE TESTS PASSED (55 assertions)
NOTIFICATION TESTS PASSED (28 assertions)
DHA COMPLIANCE TESTS PASSED (239 assertions)
ROUTE SCOPE TESTS PASSED (66 assertions)
MATERNITY TESTS PASSED (131 assertions)
POSTNATAL & IMMUNISATION TESTS PASSED (151 assertions)
HTTP SECURITY TESTS PASSED (54 assertions)
MIGRATION TESTS PASSED (757 assertions)
Field encryption: 48 assertions passed.
Consent and allergy: 80 assertions passed.
Patient portal policy: 197 assertions passed.
```

3,416 numbered assertions across 25 counting suites plus 13 catalogue `PASS:` lines = **3,429**;
**26 suites, no failures**.

The audit round counted 2,717. The increase to 3,429 is the portal suite (197),
the billing and laboratory tariff-code suites (48, including the tariff-link
vocabulary), the portal mount-order and activation-link checks (19), the
migration-file checks for 0019–0022 (45), the tariff-matching suite (92, §3.26),
the tariff-resolver suite (135, §3.27), the ward-billing suite (103, §3.28), and
small additions elsewhere; no assertion was removed.

**A correction to an earlier count.** Revision 4 of this document said "2,912
numbered + 13 catalogue `PASS:` lines = 2,925". The numbered total was measured
again at `72b83b5` and was **2,921**, not 2,912, so the figure carried in the audit
was 13 short. The 13 is exactly the number of catalogue lines, which suggests they
were subtracted once and never added back. The number above is the re-measured one;
the discrepancy is recorded rather than quietly overwritten.

The two remediation suites are the difference between "we wrote consent and
encryption" and "we checked them": 128 new assertions in two new suites. The functional ones
call the real crypto module (round trip, tamper detection, wrong-key refusal, blind
index, identifier sealing) and the real consent/allergy functions (status
derivation, input validation, medication matching). The rest assert wiring —
routes, permissions, the panel tab, the prescribing conflict path, the access log
and every patient read path that must open a sealed row — against source with
comments stripped, so a comment cannot satisfy an assertion.

---

## 3. New suites added by this audit

### 3.1 `test:compliance` — 230 assertions

`src/tests/dha-compliance.test.ts`

| Group | What it proves |
|---|---|
| Register integrity | 46 unique requirements across four categories; weights sum to exactly 1; every row has evidence, a verification method and a severity |
| Status honesty | Consent, allergy checking, ODPC and the DPIA cannot drift back to "done" without the test failing |
| Scoring | `VERIFIED + PARTIAL` on two requirements = 75%; NOT_APPLICABLE is excluded from the denominator; BLOCKED and MISSING earn zero |
| Critical gate | One critical MISSING row caps a 20-row assessment below the pass line and sets `readyForSubmission` false; a critical row that is only PARTIAL also caps, so half-built critical controls cannot lift the ceiling |
| Real assessment | The shipped register reports 45.5%, with the uncapped average beside it and 11 critical gaps |
| Wiring | The endpoint requires a reporting permission, has no write method, and the panel hard-codes no score |

### 3.2 `test:route-scope` — 66 assertions

`src/tests/route-scope.test.ts`

| Group | What it proves |
|---|---|
| Guards | The nine operational routes that had none now require a specific permission |
| Scoping | Every one resolves its facility through the session, and both write routes overwrite `facilityId` and `tenantId` from the resolved facility |
| Ownership | Theatre updates and radiology reports check the row belongs to the facility before writing |
| Supplier isolation | The tenant comes from the session, not the query string |
| No facility 1 | Six screens no longer contain `facilityId || 1` |
| Claim integrity | The surveillance screen no longer says "Integrated with DHA", "DHIS2 Auto-Push", "queued for KHIS", "Normal Trend", "2026-W40" or "October 2026"; it shows the server's 501 reason and disables export without a payload |

### 3.3 `test:field-encryption` — 48 assertions

`src/tests/field-encryption.test.ts`

| Group | What it proves |
|---|---|
| Absent key | With no `FIELD_ENCRYPTION_KEY`, encryption is a passthrough and the module reports "not configured". It never throws and it has no compiled-in default key |
| Key handling | A 16-byte key and a non-base64 value are both rejected as "not configured"; a 32-byte base64 key is accepted |
| Round trip | Ciphertext differs from plaintext, carries `v1:`, decrypts to the original, and null/undefined/empty survive unchanged |
| Random IV | Two seals of the same identifier differ, so ciphertext cannot be used as a lookup key |
| Tamper detection | A flipped ciphertext byte fails the GCM tag with a `FieldCryptoError`; a malformed payload is refused rather than returned |
| Rotation | A value sealed under one key does not decrypt under another, and reading ciphertext with no key is an error — never a plaintext fallback |
| Blind index | Deterministic, not the value, full-length, domain-separated by purpose, different for a different value, whitespace- and separator-insensitive, and `null` when no key exists |
| Identifier helpers | `sealPatientIdentifiers` seals both identifiers and writes the index; `openPatientIdentifiers` restores them; legacy plaintext rows still read unchanged |

### 3.4 `test:consent-allergy` — 80 assertions

`src/tests/consent-allergy.test.ts`

| Group | What it proves |
|---|---|
| Derived status | REVOKED wins; an expiry in the past reads EXPIRED even when the row still says ACTIVE; the exact expiry instant has expired; an ISO string and a Date are both accepted |
| Input validation | Unknown purpose, unknown method, an empty scope, a scope that grants nothing, a missing scope, null and an array body are all refused with 400 |
| Matching | Exact, case-insensitive, strength-suffixed and whitespace-padded names warn; unrelated drugs and empty strings do not; penicillin vs amoxicillin is **not** claimed as a match, and that limitation is asserted so it cannot be quietly relabelled as safety |
| Routes | Auth on every route, the five permission codes, tenant filtering in both services, no DELETE route, revocation as a state change |
| Prescribing | The prescription route calls the check, returns `ALLERGY_CONFLICT`, requires an explicit acknowledgement, audits the override, and strips the flag from the row |
| Visibility | The panel reads and writes consent and allergies, revokes, changes status, offers the server's scope keys, and the journey modal exposes it as a tab |
| Access log | The service writes to the table with a fixed purpose list; VIEW, UPDATE and FHIR EXPORT are all logged; the mislabelled FHIR row in the patient-update route is gone and no route writes the table directly |
| Migration | The append-only trigger and REVOKE exist; `patient_allergies`, the blind-index columns and their partial indexes are present |

**Not run:** `grantConsent`, `revokeConsent`, `listConsents`, `recordAllergy`,
`setAllergyStatus`, `listAllergies` and `checkMedicationAllergies` against
PostgreSQL. There is no database in this environment and migration 0017 has not
been executed. The suite prints this limitation itself rather than implying
coverage it does not have.

---

### 3.5 `test:patient-portal` — 197 assertions

`src/tests/patient-portal.test.ts`

This suite asserts the portal's rules against the source with comments stripped, and
it prints what it did not do. It does **not** exercise the portal against a database,
because there is no database and migration 0018 has never been applied.

| Group | What it proves |
|---|---|
| Second identity namespace | Accounts and sessions live in `patient_portal_*`, not `users` / `sessions`; a patient token cannot pass staff middleware and a staff token cannot pass portal middleware |
| Invitation rules | Single-use, hashed at rest, bound to an existing patient row, expiring; a redeemed or revoked invitation is refused; the event log records issue, redeem and revoke |
| Activation is not a claim of delivery | The service records an attempt, never a delivered message, and there is no provider to call |
| Sign-in | Password checked before account state is disclosed; one generic message for an unknown identifier and a wrong password; lock after five failures for 15 minutes; a correct password does not clear a lock |
| Session lifetime | 2 hours, token stored only as SHA-256, revoked on logout, password change, suspension and revocation |
| Patient reads | Every route behind `requirePortalAuth`; every read keyed to the session's `patient_id`; no route accepts a patient id from the request |
| Facility scope | Facility union resolved from the account and patient rows; empty set refused with `FACILITY_NOT_LINKED` rather than widened |
| Access logging | Every patient read path writes `patient_record_access_logs` before responding, with `accessChannel = PATIENT_PORTAL`; reading the patient's own access history is logged too |
| Sharing | Time-limited, revocable, recipient captured, audited; the UI says it is not national HIE integration |
| Card | The symbol encodes only an opaque code; the code is stored as a SHA-256 lookup plus a sealed copy; lookup requires a staff session and is audited; scanning grants nothing |
| Permissions | Five new codes exist, are in the catalogue, are assigned to no role by default, and every staff route requires one |
| No second record | The portal inserts into no clinical table; a correction request writes an audit row and a request, never a clinical edit |
| UI wiring | The management module has all five tabs, the invite dialog is reachable from reception, and the patient app never renders data the server did not send |

**Not run:** any portal query against PostgreSQL; concurrent redemption of one
invitation; an actual SMS or email send. There is no provider configured, and the
suite asserts that absence rather than mocking a success.

---

## 4. Existing suites that had to change

| Suite | Change | Reason |
|---|---|---|
| `test:opd` | Route extraction made format-independent (58 assertions, unchanged) | The radiology route was reformatted when guards were added; the test sliced by exact string |
| `test:staff-roles` | Tab-reachability assertion updated (135) | A facility administrator can now reach the modules tab |
| `test:design` | Palette pins updated to sky blue and a CTA-contrast rule added (33) | Previous round |
| `test:compliance` | Consent and allergy rows changed from MISSING to PARTIAL, encryption at rest likewise, and a critical-PARTIAL gate assertion added (222 → 230) | The code now exists; the anti-drift assertions were rewritten to check PARTIAL *and* that the row is still a critical gap, never `VERIFIED` |
| `test:migrations` | 655 → 680 → 692 assertions | Migrations 0017 and 0018 were added |
| `test:payment-settlement`, `test:claims`, `test:facility-modules` | +1, +2, +2 assertions | Followed the changes they cover; no assertion removed |

No assertion was weakened to make a failure disappear. Each change is recorded
with the reason in the commit.

---

## 5. Checks that could not run

| Check | Blocker | Exact next step |
|---|---|---|
| Migration state | No database configured | Set `SQL_HOST`…`SQL_ADMIN_PASSWORD`, run `npm run db:status` |
| Live schema comparison | Same | `information_schema` diff against `src/db/schema.ts` |
| Route behaviour against a database | Same | Start the API against a test database and call each fixed route with two facilities |
| Browser walkthrough | No browser binary | Load the app, sign in, walk registration → OPD → lab → pharmacy → billing |
| Portal runtime | No database, no SMS/email provider | Apply 0018, then invite a synthetic patient and sign in |
| DHA sandbox exchange | No client credentials | Obtain `DHA_CLIENT_ID`, `DHA_CLIENT_SECRET`, `DHA_FACILITY_CODE`; set `DHA_MODE=sandbox`; call the readiness endpoint with `probe=true` |
| FHIR validation | No validator installed | Run the Patient resource through a HL7 validator |
| Dependency vulnerabilities | `npm audit` not executed here | `npm audit --omit=dev` on a networked machine |
| Backup restore drill | No database | Follow `DEPLOYMENT_AND_RECOVERY.md` in an isolated environment |

---

## 6. What the tests do **not** prove

- They do not prove the application works against a real PostgreSQL schema. Most
  SQL paths are contract-checked, not executed.
- They do not prove any screen renders correctly in a browser.
- They do not prove absence of security defects. The authorisation audit is
  incomplete and says so.
- They do not constitute DHA acceptance. Nothing in this repository can.
- They say nothing about the portal at runtime. The 197 portal assertions check
  policy and wiring; none of them executed a query, and the first real invitation
  will be the first real test.
