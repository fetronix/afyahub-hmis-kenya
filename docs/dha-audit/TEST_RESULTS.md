# Test Results

**Executed:** 21 October 2026
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
| Production build | `npm run build` (`vite build`) | **PASS** — 1,702 modules, **716 ms** |
| Test suite | `npm test` | **PASS** — 21 suites, **2,553 assertions** |
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
OPD JOURNEY TESTS PASSED (58 assertions)
BILLING TESTS PASSED (31 assertions)
NURSING TESTS PASSED (83 assertions)
REPORTING TESTS PASSED (216 assertions)
PHARMACY BATCH TESTS PASSED (80 assertions)
PAYMENT SETTLEMENT TESTS PASSED (87 assertions)
INSURANCE CLAIMS TESTS PASSED (97 assertions)
DHA INTEGRATION TESTS PASSED (176 assertions)
PROFESSIONAL VERIFICATION TESTS PASSED (100 assertions)
Staff role catalogue tests passed.
STAFF ROLES TESTS PASSED (135 assertions)
DESIGN TOKEN TESTS PASSED (33 assertions)
FACILITY MODULE TESTS PASSED (53 assertions)
NOTIFICATION TESTS PASSED (28 assertions)
DHA COMPLIANCE TESTS PASSED (222 assertions)
ROUTE SCOPE TESTS PASSED (66 assertions)
MATERNITY TESTS PASSED (131 assertions)
POSTNATAL & IMMUNISATION TESTS PASSED (151 assertions)
HTTP SECURITY TESTS PASSED (54 assertions)
MIGRATION TESTS PASSED (655 assertions)
```

2,553 counted assertions across 20 suites; the staff-role catalogue suite reports
ten named `PASS` lines instead of a count. **21 suites, no failures.**

---

## 3. New suites added by this audit

### 3.1 `test:compliance` — 222 assertions

`src/tests/dha-compliance.test.ts`

| Group | What it proves |
|---|---|
| Register integrity | 46 unique requirements across four categories; weights sum to exactly 1; every row has evidence, a verification method and a severity |
| Status honesty | Consent, allergy checking, ODPC and the DPIA cannot drift back to "done" without the test failing |
| Scoring | `VERIFIED + PARTIAL` on two requirements = 75%; NOT_APPLICABLE is excluded from the denominator; BLOCKED and MISSING earn zero |
| Critical gate | One critical MISSING row caps a 20-row assessment below the pass line and sets `readyForSubmission` false |
| Real assessment | The shipped register reports 42.5%, with the uncapped average beside it and 7 critical gaps |
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

---

## 4. Existing suites that had to change

| Suite | Change | Reason |
|---|---|---|
| `test:opd` | Route extraction made format-independent (58 assertions, unchanged) | The radiology route was reformatted when guards were added; the test sliced by exact string |
| `test:staff-roles` | Tab-reachability assertion updated (135) | A facility administrator can now reach the modules tab |
| `test:design` | Palette pins updated to sky blue and a CTA-contrast rule added (33) | Previous round |

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
