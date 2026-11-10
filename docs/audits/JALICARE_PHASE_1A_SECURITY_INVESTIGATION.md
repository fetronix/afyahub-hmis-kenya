# JaliCare HMIS — Phase 1A Security Investigation and Risk Assessment

**Investigation date:** 7 November 2026, Africa/Nairobi

**Application baseline:** revision `db412a6`, audited on 6 November 2026

**Scope:** read-only investigation; no remediation, database changes, migrations, credential rotation, history rewriting, commits or pushes. This report is the only intended new file.

**Handling:** This document contains security-sensitive paths and weaknesses, but no credential values or patient records. Review its distribution with the incident owner before any publication.

## 1. Executive summary

**Overall assessment: production blocker remains.** A public repository's reachable history contains database archives and a historical root environment file. The previous incident document reports that the archives contain sensitive patient and credential-related material; this investigation independently verified the historical paths and public-repository accessibility, but did not open the archives. No evidence establishes whether anyone downloaded them, whether any credential is still valid, or whether any patient was harmed. Treat possible exposure as an active owner-led incident, not as proof of exploitation.

The source trace also establishes several important control failures without requiring live data:

- A portal administrator's **force-reset** action revokes existing sessions but does not prevent a new login with the existing password. The associated flag is never enforced in the inspected portal login or session middleware. A `RECOVERY` invitation is not an established recovery path for an existing account.
- A portal account's 15-minute lock can be cleared early by a further wrong-password attempt: the failed-login branch resets `lockedUntil` to null before the lock check. The separate per-IP rate limiter remains a partial defense.
- The portal overview's verified-laboratory query filters by patient but not the allowed facilities. A prior synthetic fake-pool diagnostic observed the resulting same-patient, outside-allowed-facility behavior; it was not a PostgreSQL or production disclosure test.
- Portal visits and downloaded summaries include the raw `clinicalNotes` field, even though the normal visit card does not render it. There is no inspected per-note release classification. Whether any real note is clinician-only or should be released is a clinical/legal policy question.
- The interoperability screen can associate a selected patient with stale FHIR data; the prior audit reproduced this with mocked synthetic patients. Eligibility results and facility changes have related, source-indicated race/context risks, not separately reproduced here.
- Staff `mustChangePassword` is surfaced as a flag but a full session is created and the inspected backend middleware does not restrict it. MFA-required staff login fails closed without issuing a full session, but a complete MFA challenge is not implemented in the inspected flow.

Additional conditional risks include session-invalidation races, same-tenant facility-association ambiguity, historical mismatched laboratory rows, sharing-grant redemption races, and incomplete encryption or audit redaction. Their prerequisites and evidence limits are described below; they are not claims of actual unauthorized access.

**This phase executed no tests and connected to no database.** No fresh pass/fail/skip counts exist for Phase 1A. Historical synthetic, mocked and CI results are distinguished in section 8. Proposed changes are recommendations only. **Stop after this report and wait for explicit review and acceptance before Phase 1B.**

### Priority and evidence register

Severity describes potential impact and urgency, not proof that exploitation occurred. `Source-confirmed` means the inspected code implements the stated behavior; it is not a runtime or production verification. `Conditional` means the harmful outcome requires an unverified prerequisite or policy decision.

| ID | Priority | Finding | Evidence level |
| --- | --- | --- | --- |
| IR-01 | Critical | Public Git history contains sensitive database archives and a historical environment file | Public history and paths verified; archive content relies on earlier incident inspection; external access/compromise unknown |
| PA-01 | High | Portal force-reset flag does not restrict login; existing-account recovery is incomplete | Source-confirmed; no live login attempted |
| PA-02 | High | Another bad password clears a portal lock before its intended expiry | Source-confirmed state transition; no runtime test |
| PA-03 | High | Portal password/security changes and session revocation are not atomic or version-checked | Source-confirmed design; failure/race consequences conditional |
| PR-01 | High | Portal overview laboratory query lacks the allowed-facility filter | Source-confirmed; prior fake-pool synthetic observation only |
| PR-02 | High | Portal visit API/export include raw clinical notes without per-note release classification | Source-confirmed field exposure; actual clinician-only content unknown |
| PR-03 | High | One account-facility policy governs records from two allowed facilities | Source-confirmed behavior; violation depends on approved release policy |
| PR-04 | High | Dedicated portal lab results do not recheck result-patient against the scoped order | Conditional on mismatched historical/direct-write rows; no such row verified |
| PR-05 | Medium | Sharing code is not recipient-bound; single-use/revocation updates can race | Source-confirmed recipient limitation; concurrency outcome not reproduced |
| CX-01 | High | Stale FHIR/eligibility and facility context may be displayed, copied or downloaded for the wrong selection | FHIR mismatch reproduced previously with mocks; other race paths source-indicated |
| CX-02 | High | Patient selectors are capped at 50; some OPD queue entries cannot be opened from the worklist | Source-confirmed availability/safety limitation; no fresh browser test |
| CX-03 | High | Clinical creation checks a patient belongs to the tenant but not necessarily to the facility | Source-confirmed policy inconsistency; unauthorized use depends on intended care/referral policy |
| AU-01 | High | Staff password-change requirement is not enforced by the inspected server gate | Source-confirmed; depends on an account carrying the flag |
| AU-02 | High | Complete MFA and verified recovery workflows are not established | Source-confirmed incomplete application flow; external controls unknown |
| EN-01 | High | Selected field encryption falls back to plaintext without its key; deployment coverage is unknown | Source-confirmed fallback; deployed key/data status unknown |
| AU-03 | Medium | Staff login exposes some account states before password verification; recorded IP can depend on a forwarded header | Source-confirmed responses; proxy and observed abuse unknown |
| AU-04 | Medium | Audit/redaction and error-handling coverage is incomplete; some audit writes are non-atomic | Source-confirmed code paths; actual sensitive logging or failures unknown |
| AU-05 | Medium | FHIR route prefix does not match the inspected interoperability module gates | Source-confirmed gate mismatch; authentication, permission and patient scope still apply |
| AU-06 | Medium | Portal bearer is stored in browser local storage | Source-confirmed exposure to script/shared-browser risk; no XSS found |
| AU-07 | Low | Empty `requirePermission` argument list is a latent permissive footgun | Unit-test-documented behavior; no literal empty production call found |

## 2. Workspace, baseline and recovery

The checks below describe the workspace **before creation of this report**:

- Current branch: `arena/e088f11d-afyahub-hmis-kenya`. Local HEAD: `0111b5502e1a8d8a21faf53845360122275727df`.
- Git status relative to that older local index: **129 modified tracked files, one deleted tracked file, 643 untracked files, and zero staged files**. The deleted path is `src/tests/auth-api.test.ts`. There is no visible stash. These counts do not by themselves mean that 773 files contain new interrupted work.
- The published branch points to `ec55ae0f5b2af6fde24a77297f7530a7de2a7f73`; that commit object was not present in the local object database. A read-only GitHub API recursive-tree comparison recomputed Git blob SHA-1 and executable mode for **all 1,001 published files** against the working files: every one matched, with no changed, missing or extra visible nonignored file relative to that published tree. This comparison inspected the actual contents, not just the old-index status.
- GitHub commit metadata shows that the changes from audited application revision `db412a6` through `9b4c7c5` and `ec55ae0` affected only `docs/audits/JALICARE_COMPLETE_SYSTEM_AUDIT.md`. The matching working application files are therefore the audited baseline.
- The interrupted `OutpatientModule.tsx` change described earlier as +97/-25, and any other post-publication remediation, are **not visible as differences from the published tree**. Local reflog/stash inspection and `git fsck --no-reflogs --unreachable` revealed no recoverable stash or unreachable commit in this checkout. Ignored locations, other environments, provider snapshots or external copies were not exhaustively searched; recovery elsewhere cannot be ruled out. No Git fetch, checkout, reset, stash, clean, staging, history rewrite or overwrite of existing work was performed as part of the investigation.
- No PostgreSQL process or listening PostgreSQL port was observed, no `PG_VERSION` marker was found within the limited searched locations, and PostgreSQL executables and `node_modules` were not available on the inspected PATH/workspace. Earlier temporary test logs/cluster were not found in the limited search. **This does not prove that no other local or remote test database exists.** No database was connected to, started, reset, queried or changed.

After this new report is created, it is an additional untracked file relative to the earlier status. Preserve all existing workspace contents. The local older HEAD and the published matching worktree require explicit owner review before any future Git operation.

## 3. Historical exposure and secret-scanning effectiveness

### IR-01 — Critical: reachable public history

The repository was confirmed public through GitHub metadata. The following archive paths were verified in reachable historical tree listings; their introduction commits are GitHub commit metadata, not a fresh archive-content inspection:

| Historical archive path | Introduction commit |
| --- | --- |
| `backups/database/jalicaredb-pre-tariffs-20261018-004117.dump` | `f5abd3d2f16624c4620274c3abec076d7edc78f9` |
| `backups/database/jalicaredb-before-tariff-migration-20261018-103020.dump` | `f5abd3d2f16624c4620274c3abec076d7edc78f9` |
| `backups/jalicaredb-before-patient-guardian-20261019.dump` | `8380d3ca7087c25e55a58eb00dba03d9a681144a` |
| `local-backups/jalicaredb-before-subscription-migration-20261016-035706.dump` | `6e03e0180e567a5e224102befa3f7105fdd367f3` |

The archives are absent from the published current tree, but reachable historical objects remain accessible. `docs/security/DATA-EXPOSURE.md:8-26,43-93` records a prior controlled inspection of patient-related tables, Argon2 password hashes and token-like material. This Phase 1A did not extract, open, download or copy the archives and does not reproduce any data or credential values. The earlier document is evidence of an earlier inspection, not an independent fresh content check here.

The historical root `.env` was introduced in `a4e8793bbc25f335cffa046c659ff4dc7176da34` and removed from the current tree in `c6aa12326bb13f2a80f2fe2caee011d89fd8ed17`. A read-only GitHub API retrieval into volatile memory confirmed that the historical file had nonempty fields named `SQL_ADMIN_PASSWORD` and `ADMIN_PASSWORD`; no values were printed or saved. Their validity, whether they were production credentials or placeholders, reuse, lifetime and any external access remain unknown. The historical retrieval itself confirms the old file remains retrievable; removing it from the current tree did not remove history.

**Owner-led response, not performed here:**

1. Privately appoint an incident owner, security lead and data-protection/legal lead. Preserve the relevant history, access/audit evidence, configuration inventory and timestamps in restricted evidence storage; do not copy patient records or secrets into this report, public issues or chat. Assess public visibility, forks, clones, caches and provider-side copies, and establish what access evidence is actually available. Consider temporary access restriction only through the authorized repository owner, with a continuity plan; it cannot recall prior copies.
2. Privately identify affected database/admin, staff and patient accounts, session/recovery material, provider credentials and integration secrets. Assume exposed material is suspect until owners establish scope. Under an approved plan, rotate or disable affected credentials, invalidate relevant sessions/recovery artifacts, and verify access and service continuity. **Do not rely on the current portal force-reset flag alone** (PA-01/PA-03). Prior hashes are not plaintext passwords, but account owners must assess the risk and appropriate resets.
3. Involve the applicable data controller and qualified counsel in breach, notification and regulatory obligations; neither legal noncompliance nor a notification duty is determined by this report. Record decisions and evidence without publishing sensitive contents.
4. Any Git history cleanup, provider cache/fork coordination or repository visibility change requires a separately approved incident-response and repository-maintenance plan. Preserve evidence first; changing a branch tip alone does not eliminate clones or caches.
5. **Never blindly replace encryption keys.** If an encryption/vault key is suspected, inventory ciphertext and key versions, preserve and test authorized backups and recovery access, and approve an orderly re-encryption/rotation and rollback plan before changing it. A lost key can make historical data unrecoverable.

### Current-tree and configuration scan: bounded evidence only

- `scripts/check-tracked-database-backups.mjs:4,12-21,32-51` is a path-based guard using the current Git index. Its pure path predicate was checked read-only against all four historical archive names and recognized them **when supplied as paths**. `src/tests/security-database-guard.spec.ts:8-46` covers representative names and expressly says history is not checked. The guard does not search prior commits, `.env` contents, credentials, external copies or remote caches. Because this checkout's index is older than the published tree, its ordinary index result would not independently describe that tree; the separate 1,001-file published comparison was used instead.
- `.github/workflows/ci.yml:80-83` invokes that backup guard. The incident document at `docs/security/DATA-EXPOSURE.md:177-181` states that GitGuardian is a GitHub App, but this investigation did not verify installation, coverage, historical scans, exceptions or alerts. No `gitleaks`, `trufflehog` or `ggshield` executable was found locally. No generic historical secret scan was run.
- A narrow, in-memory heuristic inspected 951 current text files. Five higher-entropy candidates were traced by redacted context to test fixtures or UI translation keys; no live credential was verified. This is not an exhaustive secret scan and does not establish that other tracked/configuration, binary, ignored, historical or externally stored secrets are absent. Configuration names and `.env.example` do not establish safe deployed values.

**Proposed remediation:** after incident approval, use an access-controlled, history-aware secret/PII scanning process with independently reviewed canary tests, safe reporting, appropriate false-positive handling and CI/pre-commit prevention. Do not print matches, commit real secrets as fixtures, treat a clean scan as proof of no exposure, or rewrite history without the owner-approved plan.

## 4. Patient portal authentication, ownership and release

### Trace and positive controls

1. `src/app.ts:243-260` mounts the patient and admin portal separately before the general staff gate. The admin router applies `requireAuth` (`src/portal/portal-admin.routes.ts:51-59`) and action-specific permissions such as `portal.accounts.manage`; patient activation and login are public, and `router.use(requirePortalAuth)` protects the later patient routes (`src/portal/portal.routes.ts:118-128,184-199,223-227`). Public mounting alone is not an authentication bypass.
2. An invitation is issued for a scoped patient (`src/portal/portal.service.ts:160-207,351-357`); activation uses a hashed random invitation token, an expiry/status check and a transaction with row lock (`src/portal/portal-policy.ts:80-82,104-117`; `src/portal/portal.service.ts:942-965`). A supplied date of birth is checked, but it is not mandatory when omitted (`portal.service.ts:1000-1011`); delivery and identity-proofing adequacy require owner review. An existing-account/contact conflict is not automatically merged (`portal.service.ts:1014-1025,1084-1121`).
3. Portal login creates a random bearer, stores its hash and sets an absolute two-hour expiry (`src/portal/portal-auth.service.ts:190-199`; `src/portal/portal-policy.ts:88-93`). `resolvePortalSession` joins the account, rejects revoked/expired sessions and non-active accounts, and derives patient, tenant and facility from that account (`portal-auth.service.ts:236-265,272-279`). `src/portal/portal.middleware.ts:32-71` rejects missing/invalid portal sessions and adds no-store headers. These are source controls, not proof that every deployed endpoint is isolated.
4. `allowedFacilityIds` derives the registration facility and portal-account facility from the session's own patient, not request-supplied patient/facility IDs (`src/portal/portal-records.service.ts:75-118`). Dedicated visits, lab orders, medications, appointments and discharges use patient/allowed-facility predicates in their inspected queries. Lab values are returned only for `Verified` results on the dedicated list (`portal-records.service.ts:358-445`); discharged admissions are required for summaries (`:564-611`). See the exceptions below.
5. `/api/portal/overview`, `/visits`, `/laboratory`, `/medications`, `/appointments`, `/discharge-summaries` and `/records/download` use that patient session (`src/portal/portal.routes.ts:238-295,305-327`). The radiology label at `src/components/portal/PortalApp.tsx:895-903` is a **sharing category**, not evidence of a patient radiology-results endpoint or a tested radiology-release policy; no dedicated patient radiology-results route was found in the inspected router.

### PA-01 — High: forced reset is not enforced; existing-account recovery is incomplete

**Source-confirmed behavior.** `POST /api/portal/admin/accounts/:accountId/force-reset` requires `portal.accounts.manage` (`src/portal/portal-admin.routes.ts:384-401`). Its service sets `mustChangePassword` and increments `securityVersion`, then revokes existing sessions (`src/portal/portal-admin.service.ts:602-629`). It does not change the password hash. `portalLogin` verifies the existing password and checks account/lock state, but does not check that flag before creating a new full session (`src/portal/portal-auth.service.ts:96-174,190-199`). `resolvePortalSession` and `requirePortalAuth` also do not check it (`portal-auth.service.ts:241-265`; `portal.middleware.ts:32-71`). The flag is cleared on a voluntary password change, but no portal read/enforcement of it was found.

Thus, if someone knows the still-valid old password, successful revocation of existing sessions alone does not prevent a new login or access to protected portal routes. This is a control failure in the code, not evidence that a particular account was accessed. `RECOVERY` is accepted as an invitation purpose (`portal-admin.routes.ts:122-145`), yet `issueInvitation` rejects any patient with an existing account before considering purpose (`portal.service.ts:359-381`), and activation rejects an existing account (`:1014-1025`). The current-password change route cannot help someone who has forgotten that password. A revoked account also cannot simply be assumed re-invitable while an account row remains. No complete existing-account recovery was verified.

**Recommendation:** after approval, define a verified-identity recovery flow that cannot be satisfied solely by possession of a compromised old password; enforce a restricted, server-side reset state on every protected route, use atomic/versioned session invalidation, and test old-password login, allowed recovery actions, revocation and audit failure. Preserve account/patient history. Owners should choose any interim access restriction and continuity procedure; no account was suspended here.

### PA-02 — High: portal account lock is cleared by the next bad password

**Source-confirmed state transition, not runtime-tested.** The intended limit is five failures and a 15-minute lock (`src/portal/portal-policy.ts:91-93`). On a threshold failure, `portalLogin` resets `failedLoginAttempts` to zero and sets `lockedUntil`. On a subsequent incorrect password, the same branch computes an attempt count below the threshold and writes `lockedUntil: null`; the active-lock check appears only **after** that branch (`src/portal/portal-auth.service.ts:118-147`). Consequently an additional wrong attempt can clear an existing lock, after which a correct password can be accepted before the original expiry. Concurrent increments are also read/modify/write rather than visibly atomic.

`src/portal/portal.routes.ts:55-74,184` adds a separate ten-per-address/15-minute limiter; it reduces some abuse but does not repair the per-account logic or establish distributed enforcement. **Recommendation:** retain an unexpired lock on all failure paths, use atomic/serialized counters, preserve non-enumerating responses, verify rate-limit/proxy behavior, and add isolated synthetic tests for lock threshold, additional wrong/correct attempts, expiry and concurrent/distributed attempts.

### PA-03 — High: session invalidation can fail or race

**Source-confirmed design; harmful outcomes conditional.** `changePortalPassword` updates the password and account security version, then separately calls `revokeAllPortalSessions` (`src/portal/portal-auth.service.ts:328-381`). Admin suspension, reactivation and forced reset likewise update the account and separately revoke where applicable (`src/portal/portal-admin.service.ts:462-474,525-537,602-617`). Portal session rows have no security-version column (`src/db/schema/platform.ts:348-377`), and resolution does not compare one (`portal-auth.service.ts:241-265`).

If revocation fails after the password update, an unexpired previously issued active session can remain valid. A concurrent login that verified the old password before a change but inserts a session after bulk revocation is another possible race. A failed suspension revocation followed by reactivation before expiry could similarly revive an unrevoked session. These are code-path risks; no database failure or race was injected and no live session was examined.

**Recommendation:** make password/status/security-version changes and revocation atomic, and validate a session's captured account security version or equivalent on every resolution. Serialize against concurrent login and recovery, fail closed on errors, and test rollback, race, suspension/reactivation, expiry and every-device invalidation with synthetic data. Ensure audit records and user messages reflect what actually committed.

### PR-01 — High: overview laboratory facility boundary is missing

`getPortalOverview` obtains allowed facility IDs and account policy (`src/portal/portal-records.service.ts:125-132`), but its recent-results query selects `labResults` by `session.patientId` and `Verified` status without joining `labOrders` or checking the allowed facilities (`:206-225`). It is returned as `recentVerifiedResults` (`:255-256`) and rendered by the portal UI (`src/components/portal/PortalApp.tsx:537-553`). In contrast, the dedicated laboratory list scopes orders to allowed facilities (`portal-records.service.ts:390-425`).

The 6 November audit's fake-pool synthetic probe observed an outside-allowed-facility labelled result for the **same patient**. This is not a real PostgreSQL execution, a cross-patient demonstration, proof that a real result exists, or evidence of actual disclosure. It does show that the overview query lacks the boundary that the service describes as conservative.

**Recommendation:** join each result to its order and enforce patient, tenant, allowed facility, result/order consistency, verification and the approved source-facility release policy for every overview, list and export path. Add two-patient/three-facility synthetic PostgreSQL HTTP tests, including policy-on/off and pending/verified cases; do not alter historical rows without review.

### PR-02 and PR-03 — High: notes and facility release semantics

`listPortalVisits` selects `encounters.clinicalNotes` for the patient's scoped encounters and returns the row (`src/portal/portal-records.service.ts:273-305,339-342`); `/visits` returns it directly (`src/portal/portal.routes.ts:252-258`) and the downloadable summary includes visits (`portal-records.service.ts:626-695`). The visit card does not display `clinicalNotes` (`src/components/portal/PortalApp.tsx:584-630`), but omission from the UI is not omission from the API or downloaded JSON. The source has no inspected per-note clinician-only classification or release decision. **Whether any real note contains clinician-only material or whether patient access is mandated is unknown.**

The allowed set can include two facilities (`portal-records.service.ts:83-103`), while the overview, lab and discharge services load a single account-facility policy (`:129-132,362-364,570-572`). A previous fake-pool probe observed a synthetic admission from the other allowed facility; whether the origin facility's policy was disabled was hypothetical. If each originating facility must control release, this is a policy-enforcement gap; if an agreed shared policy governs both, that decision needs evidence. The default policy enables several sections (`src/portal/portal-policy.ts:428-439`), which is not proof of a clinically approved release decision.

**Recommendation:** clinical, data-protection and facility owners should approve which notes, diagnoses, verified results and discharge content are patient-visible, including cross-facility and historical records. Enforce explicit patient/facility/record-level release in the server and all exports; do not silently hide legally required patient access or infer that notes are private. Test mixed-release facilities, active visits, unpublished notes, export and disabled policies.

### PR-04 — High conditional: legacy mismatched result/order patient

The dedicated list first selects allowed orders for the session patient, but then selects results by `orderId` alone (`src/portal/portal-records.service.ts:390-425`) and releases verified rows (`:430-443`). The schema defines separate order and patient foreign keys on results (`src/db/schema/laboratory.ts:206-215`), rather than the inspected declaration enforcing their combined identity. Current scoped result creation and verification explicitly compare order and patient (`src/db/queries/laboratory.ts:543-561,622-661`).

If an older, imported or direct-write verified result has an order belonging to patient A but a result patient B, the dedicated list can attach that result to A's order. **No such row was searched for or found in this phase; this is not proof of cross-patient disclosure.** The overview's patient-only query has the converse integrity concern. Similar associations deserve review for encounter-linked diagnoses and other historical records.

**Recommendation:** enforce both result-patient and order-patient equality at read and write time, include tenant/facility checks, and plan a privacy-preserving, read-only integrity assessment with a data owner. Quarantine/review discrepancies under an approved plan; do not guess identities, silently reconcile or delete records.

### PR-05 — Medium: sharing recipient and single-use claims

`src/portal/portal.routes.ts:366-375` tells the patient that the sharing code works once and only for the named recipient. `redeemSharingGrant` requires staff authentication and `patients.read` (`src/portal/portal-admin.routes.ts:571-585`) plus a valid hashed code and the same tenant, but does not bind `recipientName` to the authenticated staff identity (`src/portal/portal-sharing.service.ts:190-210`). A code-holding, permitted staff user in that tenant can therefore redeem it even if not the named recipient. The inspected function returns grant metadata including patient ID and categories, **not a full clinical record or a demonstrated persistent authorization grant** (`:255-263`).

The read of `redeemedAt`/`revokedAt` and the later update by ID are separate (`:216-231`), so concurrent redemptions or revocation/redeem races could violate single-use expectations; this was not runtime-tested. **Recommendation:** either bind the intended recipient to a verifiable staff identity and facility under an approved sharing model, or accurately describe bearer-code semantics; make redeem/revoke an atomic conditional transition and test concurrency, expiry, cross-tenant and cross-facility cases. Do not claim category selection itself proves the corresponding records are shared safely.

## 5. OPD, clinical associations and interoperability

### Existing safeguards and trace

- OPD loads facility-scoped patient/triage data and reports load failure rather than silently displaying an empty queue (`src/components/modules/OutpatientModule.tsx:188-226`). On patient selection it clears encounter-specific drafts and uses a selection version to ignore delayed encounter/observation/diagnosis/medication responses (`:285-386`). The normal app mounts OPD with a user/facility key, causing a remount on facility change (`src/App.tsx:179-183`); do **not** infer an OPD cross-facility stale-state defect merely from an effect that only clears the lab draft. Lab submission also checks current tenant, facility, patient, encounter and selections (`OutpatientModule.tsx:938-955`). Mocked UI tests cover several delayed-selection/draft cases (`src/tests/vitest/outpatient-safety-ui.spec.tsx:140-168,196-223,362-390`). These safeguards do not establish safety of every asynchronous write or all user journeys.
- Encounter creation derives the authorized facility, checks the patient in its tenant and has idempotency handling (`src/db/queries/encounters.ts:79-108,205-220,247-275`). Encounter updates scope by facility and refuse changing the patient (`:519-551`). OPD observations, diagnoses and medications are linked to a scoped encounter and check or derive the same patient (`src/routes/vitals.routes.ts:57-98`; `src/nursing/nursing.service.ts:313-354,403-407`; `src/db/queries/clinical.ts:139-149,348-361`). Lab/queue scope checks encounter, patient, tenant and facility (`src/db/queries/shared.ts:130-203`; `src/db/queries/laboratory.ts:1170-1172`). Radiology orders check the facility and, when supplied, patient/encounter/facility/tenant consistency (`src/routes/radiology.routes.ts:52-98`). Automatic billing validates patient, facility and an optional encounter together before charging (`src/billing/billing.service.ts:968-1005`). These are important source controls, not a fresh end-to-end verification.

### CX-01 — High: stale interoperability patient context

The interoperability screen shares one `selectedPatientId` between the eligibility and FHIR selectors. Changing the eligibility selector updates the selected ID but does not refresh or clear the existing FHIR resource (`src/components/modules/InteroperabilityModule.tsx:448-460`); the prior synthetic mocked audit reproduced the resulting selected-patient/displayed-resource mismatch. FHIR copying and downloading use `fhirData` directly (`:169-187,689-702`). `loadFhir` does not bind its completion to the current selection or clear stale data on failure (`:132-140`), so rapid switches/out-of-order responses are another source-indicated risk.

Conversely, the FHIR selector changes the shared patient without clearing eligibility (`:673-678`), and `runEligibilityCheck` sets its result after an asynchronous request without a current-patient/facility check (`:144-158`). Patient loading has no cancellation guard and does not fully clear prior results on an empty/new facility (`:90-112`); the interoperability component is not keyed by facility in `src/App.tsx:283-295`. These latter cases are **potential**, not separately reproduced in Phase 1A. The UI checks `isSuperAdmin` or the `SUPER_ADMIN` role (`src/App.tsx:283-295`), and the FHIR API separately requires a permission and scoped patient lookup (`src/routes/domains/interop.routes.ts:40-61`); this finding is about wrong context and possible mistaken disclosure, not proof of an anonymous API bypass.

**Recommendation:** bind all displayed/transferable data and asynchronous completions to explicit patient, tenant and facility identity; clear/disable stale content and copy/download on any change, failure or pending request. Add mock and browser-to-synthetic-PostgreSQL tests for both selectors, delayed/out-of-order requests, failed loads, empty lists and facility switches. Do not fabricate eligibility or provider outcomes.

### CX-02 — High: capped patient worklist

`getPatientsScoped` returns at most 50 newest matching records (`src/db/queries/patients.ts:285-369`). OPD calls the patient list without search/pagination (`OutpatientModule.tsx:193-203`) and renders it as a carousel (`:1071-1095`). A triage queue entry whose patient is outside that list is displayed as an ID, but its click handler only acts when the patient was found (`:1109-1125`). Interoperability uses the same capped list (`InteroperabilityModule.tsx:90-104`). This is a source-confirmed availability and wrong-selection risk, not evidence of a patient receiving wrong care.

**Recommendation:** use authorized browse-first server-side search and pagination and a scoped direct resolution of real queue patients, with clear loading/error/identity context. Test more than 50 synthetic patients, inaccessible patients, facility switch and missing records. Do not load the whole database, create fake patients or guess identity.

### CX-03 — High conditional: tenant membership versus facility relationship

The scoped single-patient read checks the registration-facility boundary (`src/db/queries/patients.ts:260-275`), while `requirePatientInTenant` only validates the patient and tenant (`src/db/queries/encounters.ts:79-108`). Encounter creation and radiology creation use the latter (`encounters.ts:205-220`; `src/routes/radiology.routes.ts:60-73`); radiology permits no encounter. Thus a permitted facility clinician who knows another same-tenant patient ID can reach creation logic without a separate registered/seen/referred-at-this-facility check. The authorized target facility is still checked and different-tenant patients are rejected.

This **may be legitimate** for shared-tenant cross-facility care; the approved identity/referral policy is not evidenced here. It is a source-confirmed inconsistency, not proof of unauthorized use or a reason to block valid referrals blindly. A wrong or guessed patient selection can propagate to an encounter, downstream clinical order and invoice even when internal references are mutually consistent.

**Recommendation:** owners should define the lawful patient-to-facility relationship, identity confirmation and referral/emergency exceptions; enforce the approved policy consistently server-side without guessing or silently moving historical records. Test same-tenant unrelated patient IDs, valid referrals, cross-tenant IDs, missing IDs, encounter mismatch, orders, prescriptions and invoice provenance, preserving clinical continuity and historical pricing.

## 6. Authentication, authorization, encryption and audit controls

### Control classification

The classifications below are deliberately narrow. **Implemented and verified** refers only to the stated source/unit-level observation or historical synthetic test, never an unobserved deployment. Configuration or code presence alone is not production verification.

| Control | Classification | Evidence and limitation |
| --- | --- | --- |
| Tracked-backup path predicate for the four names | **Implemented and verified — narrow** | Pure predicate was exercised read-only with those paths; `scripts/check-tracked-database-backups.mjs:12-21`. It does not inspect history or content. |
| AES-GCM primitive round-trip/tamper handling | **Implemented and verified — historical unit scope** | `src/security/field-crypto.ts:135-153,170-208`; prior no-DB suite included `src/tests/vitest/field-crypto.spec.ts`. Not re-run now; no deployed key, storage coverage or recovery was verified. |
| Staff/patient password hashing | **Implemented but inadequately tested** | Argon2id and minimum length in `src/utils/password.ts:1-28`; portal password policy in `src/portal/portal-policy.ts:97-98`. Historical tests do not establish current account states, policy enforcement or secret compromise. |
| Staff session expiry/revocation | **Implemented but inadequately tested** | Random bearer hash, eight-hour expiry, account status and security-version check in `src/auth/session.service.ts:11,17-18,25-55,67-135`; historical HTTP/DB tests exist. Live session and revocation were not checked. |
| Portal session expiry/revocation | **Partially implemented** | Hashed two-hour sessions and status checks exist, but PA-01/PA-03 leave reset/failure/race gaps. |
| Forced password-change enforcement | **Missing** | Admin/identity flags exist, but inspected patient and staff server gates do not restrict full sessions on those flags (PA-01, AU-01). |
| Existing-account patient recovery | **Partially implemented** | Recovery purpose and force-reset flag exist, but an existing account is rejected by the inspected invitation/activation path and force reset does not change the password (PA-01). |
| MFA | **Partially implemented** | Staff requiring/enabling MFA do not receive a normal session, but no complete challenge/verification flow was found; patient MFA not established (AU-02). |
| Patient ownership, facility and release | **Partially implemented** | Session-derived patient and several scoped queries exist; overview, per-source policy, notes and legacy association issues remain (PR-01–PR-04). |
| RBAC and facility scope | **Implemented but inadequately tested** | Permission/context and facility checks at `src/auth/authorization.middleware.ts:68-113`, `src/auth/authorization.service.ts:169-203,273-320`; many routes and deployment grants were not exhaustively verified. Super-admin financial permission is explicitly constrained in the inspected service. |
| Generic/history-aware secret scanning in repository CI | **Missing in inspected workflow; external status unknown** | CI invokes the current-index backup-path guard; GitGuardian is documented but not independently verified. |
| Field coverage, key custody, backup recovery and rotation | **Externally/admin dependent; partially implemented in code** | Selected fields and vault use cryptography, but missing-key fallback, historical plaintext, actual key custody, full PHI coverage, backups and recovery are unverified (EN-01). |
| TLS, reverse proxy, logging and audit operations | **Externally/admin dependent; partially implemented in code** | TLS and headers are configurable, and redaction/audit helpers exist; deployed TLS, proxy trust, log access and complete redaction are unverified (AU-03/AU-04). |

### AU-01 — High: staff must-change-password flag does not restrict access

For non-MFA staff, `src/auth/auth.service.ts:480-488,508-523` creates and returns a normal session even when `mustChangePassword` is true. The staff middleware attaches that flag to `req.user` but continues (`src/auth/auth.middleware.ts:66-78,120-145`) rather than restricting protected routes. In the frontend, `HmisContext` loads a session and marks the user authenticated before returning the flag (`src/context/HmisContext.tsx:920-980`); `LoginScreen` then only displays an informational message (`src/components/LoginScreen.tsx:724-732`). No server-side enforcement was found in the inspected flow.

This matters when a staff account carries the flag; no such deployed account or real misuse was verified. **Recommendation:** use a server-enforced limited recovery/change state with explicit permitted endpoints and security-version invalidation, and test direct API access as well as the UI. Preserve MFA and fail-closed behavior.

### AU-02 — High: MFA and recovery not end-to-end

Staff `mfaRequired || mfaEnabled` prevents a normal session from being created (`src/auth/auth.service.ts:379-443`); the controller states that a verification endpoint remains future work and returns no full session (`src/auth/auth.controller.ts:78-91`). This is a **fail-closed incomplete feature**, not evidence of an MFA bypass. When MFA is not required, the inspected application supports password-only login; no patient MFA or complete staff recovery endpoint was established. The staff login UI directs users to administrator/ICT assistance (`src/components/LoginScreen.tsx:161-167`), but operational identity verification and a secure recovery procedure were not observed.

**Recommendation:** after approval, design and verify enrollment, challenge, replay resistance, recovery, device loss, rate limits, session binding, audit and administrator policy, including safe loss-of-access procedures. Do not mark MFA or recovery complete based on flags, a screen or an external policy statement alone.

### EN-01 — High: encryption is conditional and incomplete in scope

`encryptField` returns plaintext if `FIELD_ENCRYPTION_KEY` is absent and accepts legacy plaintext when reading (`src/security/field-crypto.ts:58-61,135-145,170-181`). The inspected patient-identifier wrapper applies it to selected identifiers, not all clinical fields (`src/security/patient-identifiers.ts:35-47`); booking and QR code paths also use this helper. Blind indexes are HMAC-based, but their mere existence does not prove that all stored rows are encrypted. No deployed environment, key, row population or backup was inspected.

The payment-hub vault uses AES-256-GCM, versioned keys and associated data containing tenant, facility and integration identity (`src/payment-hub/secrets.ts:10,31-57,76-108`); environment separation and live re-encryption/recovery require configuration and operational proof. Database TLS is configurable and defaults off in source, with certificate verification configurable (`src/config/env.ts:66-78`). HTTPS, database transport, backup encryption, actual key custody and restoration are external/admin-dependent, not established by source settings.

**Recommendation:** inventory all PHI and secrets, deployed encryption coverage, TLS and backup/key ownership; establish audited key generation, access, versioning, restore and rotation. Plan an approved legacy-data migration and recoverability test before enforcing key presence or re-encrypting. Do not silently rotate or lose the old keys.

### AU-03 — Medium: staff account-state enumeration and proxy-derived audit IP

Unknown staff identifiers receive a generic credentials failure (`src/auth/auth.service.ts:166-193`), but a locked or unavailable existing account is distinguished before password verification (`:196-233`); the controller returns different statuses (`src/auth/auth.controller.ts:59-73`). This reveals some account states to an unauthenticated caller who supplies an identifier; it does not establish enumeration of every active user or observed abuse. Rate limits remain relevant.

`getClientIp` directly reads the first forwarded-for header for staff login evidence (`auth.controller.ts:21-32`), independently of the application's configured trusted-proxy setting (`src/app.ts:74-79`). If an edge does not strip/replace untrusted headers, the recorded IP may be spoofed; actual proxy configuration is unknown. **Recommendation:** use uniform unauthenticated responses/timing as appropriate, retain useful internal audit events, and derive client IP only through an explicitly trusted proxy chain; validate the actual deployment and concurrent lockout behavior.

### AU-04 — Medium: redaction and audit completeness

The structured logger has explicit sensitive-key, header and database-error redaction (`src/logging/logger.ts:66-74,131-183,211-234`) and historical unit tests (`src/tests/vitest/logger.spec.ts:77-269`). This does not cover every arbitrary free-text value or every `console.error` path. Private-insurance audit metadata sanitizes named keys (`src/insurance/audit/diagnostics.service.ts:14-28,72-98`), while the SHA audit writer serializes a caller-supplied summary (`src/insurance/eclaims/contracts.ts:267-285`); free text under an innocuous key may contain sensitive content. No actual secret/PHI log entry was inspected.

Portal `DOWNLOAD` logging is awaited (`src/portal/portal-records.service.ts:682-686`), but the route's separate `EXPORT` event is best-effort (`src/portal/portal.routes.ts:305-316`). OPD observation creation is followed by a separate audit insert (`src/routes/vitals.routes.ts:79-114`); an audit failure after the observation commits could return an error despite a saved observation and encourage a duplicate retry. These failure effects are conditional, not reproduced. The staff IP limitation is AU-03. `patientRef` also has a documented fixed development-salt fallback when no configured key exists (`src/logging/logger.ts:290-309`), so deployment configuration matters.

**Recommendation:** adopt allowlisted structured audit fields and safe error codes, avoid raw provider/clinical/free-text payloads, verify all log paths with synthetic canaries, secure retention/access, and make security-critical state and audit transitions atomic or durably retryable. Preserve immutable historical records; do not silently erase audit evidence.

### AU-05, AU-06 and AU-07 — Medium/Low: API gate and browser/permission defense in depth

- **AU-05, Medium:** `src/routes/index.ts:164,169` gates `/integrations` and `/interoperability`, while the inspected FHIR handler is `/api/interop/fhir/patient/:id` (`src/routes/domains/interop.routes.ts:40-42`) and domain routers are mounted afterward (`src/app.ts:266-281`). The named module gates therefore do not match that prefix. Staff authentication, `interop.fhir.patient.read` and scoped lookup still apply; an open unauthenticated endpoint is **not** established. Align or explicitly document the intended module boundary and test disabled-module access with appropriate roles.
- **AU-06, Medium:** the portal bearer is persisted in `localStorage` (`src/api/portal-client.ts:17-31`). Script execution in the same origin or a shared/unattended browser could expose a live token; no XSS was found or tested. Review session storage design, XSS protections, device logout and a carefully designed HttpOnly-cookie/CSRF alternative where appropriate; do not treat storage changes as a substitute for server expiry/revocation.
- **AU-07, Low:** `requirePermission` uses an all-permissions check (`src/auth/authorization.middleware.ts:68-101`); `src/tests/vitest/authorization-middleware.spec.ts:226` documents that an empty list allows an authenticated caller through. No literal `requirePermission()` production call was found in the limited source search. Fail closed for empty/dynamically constructed permission lists and add a guard test; this is a latent footgun, not a demonstrated privilege escalation.

## 7. Existing tests and specific gaps

No test suites, migrations, dedicated secret-scanning tools or database commands were executed during Phase 1A. The bounded in-memory text heuristic and backup-path predicate described in section 3 were performed read-only. The following describes inspected tests and **proposed future synthetic tests**, not completed fixes:

| Area | Existing evidence inspected | Gap and proposed acceptance test after approval |
| --- | --- | --- |
| Portal patient/tenant/facility ownership | `src/tests/patient-portal.spec.ts:631-742` checks source patterns; `src/tests/integration/scoped-queries-and-mch.spec.ts:1-24,353-392` uses a mocked Drizzle executor for QR, grant and session helper paths. | Real synthetic PostgreSQL + HTTP: missing/foreign/staff bearer, two patients, two tenants and three facilities; test overview, list and export independently. The source regex asserting that *some* lab order query contains a facility filter does not establish that overview results are scoped. |
| Notes, lab and radiology release | Portal policy tests and dedicated verified-result filter exist; no dedicated patient radiology result route was found. | Test unpublished/clinician-only notes only after policy definition; verified versus pending labs; source-facility policies on/off; legacy mismatched order/result patient; exports; any future radiology release. Avoid real patient data. |
| Portal login, lockout and recovery | Token/password helper tests exist; admin force reset and revocation code exists. | Test five failures, another wrong password, correct password during lock, expiry, concurrent increments, force reset then old-password login, existing-account recovery, suspension/reactivation and session revocation failure/races. Require restricted/full-session behavior to match approved policy. |
| Sharing | Mocked grant creation/list and policy helper tests. | Same-tenant wrong recipient, other tenant/facility, expiry, revocation and simultaneous redemption/revocation with a real synthetic DB; assert only intended metadata/records are accessible. |
| Wrong/missing patient and stale UI | `src/tests/vitest/outpatient-safety-ui.spec.tsx` covers delayed selection, drafts and facility lab context; `src/tests/integration/laboratory-facility-identity.db.spec.ts:521-580,1138` covers selected cross-facility/tenant associations. | Test all OPD and FHIR selectors, more than 50 patients, missing patient/encounter, rapid switches, failed and delayed requests, patient/encounter/facility mismatch through orders, prescriptions and invoices. The old synthetic FHIR diagnostic reproduced risk; it is not a passing safety regression. |
| Staff authorization/privilege | `src/tests/vitest/authorization-middleware.spec.ts`, `scope.service.spec.ts`, and `src/tests/integration/tenancy-billing-rbac-http.spec.ts` exercise selected boundaries; `src/auth/authorization.service.ts:185-203` restricts platform financial permissions. | Test every sensitive route without authentication, with missing permissions, wrong tenant/facility, changed role, forced-password state, disabled module and financial privilege escalation. Do not assume one route or role test covers the entire API. |
| Expiry/revocation and MFA | `src/tests/integration/auth-and-session-http.spec.ts:122,244` names staff authentication/session scenarios; staff database session tests exist. | Separately exercise patient and staff token expiry, logout, bulk revocation, account status/version changes, failure injection and MFA-required/no-session behavior; add challenge/recovery tests only when implemented and approved. |
| Secrets, encryption and audit | Backup path guard, `src/tests/vitest/field-crypto.spec.ts` and `src/tests/vitest/logger.spec.ts` cover specific pure-code cases. | Add harmless synthetic canaries for current tree **and history**, free-text/error redaction, no-secret output, key absence, field coverage, restore/re-encryption and audit transaction failures. Do not commit or emit actual credentials. |
| Clinical workflow evidence | Historical `src/tests/integration/clinical-workflows-acceptance.db.spec.ts:1214` exercises a synthetic API path; prior lab identity and browser evidence is recorded in `docs/audits/laboratory-facility-identity.md`. | Extend to browser → API → isolated synthetic PostgreSQL, wrong-context and permission failures, preserving no-order-time charge, selected service identity and financial history. Do not claim real facility or payment-provider acceptance. |

`src/tests/vitest/support/global-setup.ts:40-47` and `src/tests/vitest/support/db.ts:18-20,64-72` distinguish missing PostgreSQL skips from `JALICARE_REQUIRE_DB=1` failures. Any future DB tests require a newly created, independently attested **synthetic** database and explicit approval; do not reuse/reset an unknown database or run migrations in this phase.

## 8. Prior results versus this investigation

| Evidence | Result | Scope and limitation |
| --- | --- | --- |
| **Phase 1A, 7 November** | **No tests run; no fresh passes, failures or skipped tests.** | Source, Git metadata, historical CI metadata and bounded in-memory heuristics only; no database connection, browser, provider or production check. |
| 6 November audit, no database | 172 passed / 56 skipped files; 1,664 passed / 458 skipped tests; zero assertion failures. | Skipped database tests are not passes. `docs/audits/JALICARE_COMPLETE_SYSTEM_AUDIT.md:236-255`. |
| 6 November no-DB coverage | Original audit: exit 1, 32.69% statements / 26.66% branches / 37.18% functions / 33.02% lines. Independent follow-up: exit 1, 32.71% / 26.66% / 37.18% / 33.04%. | Separate no-DB runs failed coverage thresholds; they are not DB-enabled regression results (`JALICARE_COMPLETE_SYSTEM_AUDIT.md:244-246,269-270`). |
| Earlier same-application synthetic PostgreSQL work | 228 files / 2,122 tests passed; separately reported coverage 64.06% / 60.12% / 64.51% / 65.19%; 71/71 migrations on a new synthetic DB. | Historical synthetic evidence, not re-run in Phase 1A and not proof of production state (`JALICARE_COMPLETE_SYSTEM_AUDIT.md:255-261`). |
| Published CI | GitHub run [42289930299](https://github.com/fetronix/afyahub-hmis-kenya/actions/runs/42289930299), head `ec55ae0`, reports success for all seven jobs: formatting, PostgreSQL migrations/specs, typecheck/lint, PostgreSQL coverage, dependency audit, fresh-checkout Docker bootstrap and production build. | Read-only job metadata checked in this phase; job success does not prove untested portal edge cases, provider behavior or deployed settings. |
| Prior audit diagnostics | Mocked patient-switch FHIR mismatch; fake-pool lab-scope, multi-facility policy and note observations. | Synthetic mocks/fake SQL only; not a real database, production disclosure or proof of actual clinician-only content. |
| Prior audit static/build/dependency checks | Typecheck, configured formatting, lint, backup guard, builds and mock dry-run passed; lint had 91 warnings. Production npm dependency audit reported zero vulnerabilities; full dependency audit reported four moderate advisories. | Historical snapshot only; not re-run here, not a penetration test, and project `format:check` does not include `docs/`. |

Prior KES 456 laboratory evidence is a **synthetic** browser-to-PostgreSQL scenario documented in `docs/audits/laboratory-facility-identity.md`, not a fresh Phase 1A reproduction, real facility price, payment or proof of all clinical pathways. Historical mocked-provider browser flows do not establish real provider authorization, settlement, facility UAT or production readiness.

## 9. Proposed implementation order — approval required

1. **Immediate owner decision, IR-01:** privately preserve evidence, assess repository exposure and clinical continuity, decide authorized containment, inventory/rotate affected credentials and sessions under a verified plan, and involve the data controller/legal lead. Do not rely on the broken portal force reset or blindly change encryption keys.
2. **After report acceptance and explicit authorization:** define the safe synthetic test environment and reproduce PA-01/PA-02/PA-03 with negative, concurrency and failure-injection tests. Implement server-enforced recovery, durable lockout and atomic/versioned session invalidation. Do not run against an existing unknown database.
3. Agree patient ownership, source-facility release and note visibility with clinical/data-protection owners. Correct PR-01–PR-05, validate patient/order/encounter identity throughout reads and writes, and plan a non-destructive historical integrity assessment. Preserve legitimate referrals and patient access rights.
4. Address CX-01–CX-03: bind UI results to patient/facility identities, add scoped searchable/paginated selectors, and align clinical creation with approved facility relationship rules. Preserve OPD, triage, lab, pharmacy, billing and historical records; do not invent clinical decisions or prices.
5. Complete staff forced-change and MFA/recovery design; align API module/permission gates; harden audit/redaction, proxy trust, browser sessions, secret scanning, encryption and key/backup recovery under approved operational plans.
6. Run the agreed unit, HTTP, concurrency and browser-to-new-synthetic-PostgreSQL suites with DB-required CI, record exact passes/failures/skips and independently review security and clinical safety. Real provider sandbox, facility owner approval, deployed TLS/key verification and UAT remain separate prerequisites.

**Decision requested:** review and accept or amend this investigation and its priorities. No Phase 1B remediation, tests, migration, credential change, Git operation or deployment is authorized by this report itself.
