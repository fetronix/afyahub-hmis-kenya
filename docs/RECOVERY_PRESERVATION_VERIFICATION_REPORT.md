# JaliCare HMIS — Recovery, Preservation and Verification Baseline

**Single-file consolidated report. Assessment only: no features implemented, nothing staged, committed or pushed.**

| Field | Value |
| --- | --- |
| Report created | **2026-11-13**, 09:21–10:10 UTC |
| Repository | `fetronix/afyahub-hmis-kenya` (`https://github.com/fetronix/afyahub-hmis-kenya.git`) |
| Working directory / repo root | `/home/user/afyahub-hmis-kenya` (`git rev-parse --show-toplevel` agrees) |
| Current branch | `arena/e088f11d-afyahub-hmis-kenya` |
| Local HEAD | `0111b5502e1a8d8a21faf53845360122275727df` — *docs: record what shipped after the engineering report was written* |
| Published remote branch | `origin/arena/e088f11d-afyahub-hmis-kenya` |
| Published remote HEAD | `34b00d1126bd8a0e79ad892bf2ce4ce44b2afa7f` — *docs: record the reconciliation outcome in the recovery report* |
| Divergence | **0 ahead / 52 behind**; local HEAD is an ancestor of the remote tip, so the relation is behind-only (fast-forward possible) |
| Report file | `docs/RECOVERY_PRESERVATION_VERIFICATION_REPORT.md` — did **not** exist before this task (checked first; nothing was overwritten) |

### Status vocabulary

| Tag | Meaning |
| --- | --- |
| **VERIFIED** | Directly observed in this session, with the command and its output recorded below. |
| **PARTIAL** | Some evidence obtained; the check is incomplete or was run against a different state than the one being asserted. |
| **NOT VERIFIED** | Not checked, or checked by a method that cannot support the claim. |
| **BLOCKED** | Cannot be checked in this environment; the missing prerequisite is named. |
| **RECOMMENDED** | A judgement, not an observation. Never evidence. |

### Headline finding

The workspace has moved on since the task brief was written. The brief describes HEAD `0111b55`, remote `4cdbc93`, ~50 commits behind, 11 differing files and 4 failing schema-contract tests. What this session actually found is:

* remote is `34b00d1`, **52** commits ahead of local HEAD, not `4cdbc93`;
* the working tree is **byte-identical to the current remote tip** (`34b00d1`): 1,226 of 1,226 files match, 0 differ;
* the reconciliation that the brief asks to be *investigated* (the four schema-contract failures) is **already published** in `ea4dfca` and is green;
* the preservation archive the brief expects to find (`/home/user/jalicare-preservation-2026-11-13/`) **was gone** — the workspace rolled back between sessions — and has been rebuilt.

Everything below is measured against the *current* state, with the historical figures re-derived where they could be reproduced.

---

## Section A — Git workspace status

### A.1 State

| # | Item | Value | Status |
| --- | --- | --- | --- |
| 1 | Working directory / repo root | `/home/user/afyahub-hmis-kenya` (identical) | **VERIFIED** |
| 2 | Current branch | `arena/e088f11d-afyahub-hmis-kenya` | **VERIFIED** |
| 3 | Local HEAD | `0111b55` — *docs: record what shipped after the engineering report was written* | **VERIFIED** |
| 4 | Published remote branch | `origin/arena/e088f11d-afyahub-hmis-kenya` at `34b00d1` — *docs: record the reconciliation outcome in the recovery report* | **VERIFIED** |
| 5 | Ahead / behind | `0 / 52` — behind only, no local commits missing from the remote | **VERIFIED** |
| 6 | `git status --short` | 645 entries (directories collapsed); 1,018 entries with `-uall` | **VERIFIED** |
| 7 | Modified tracked files | **149** | **VERIFIED** |
| 8 | Deleted tracked files | **1** (`src/tests/auth-api.test.ts`) | **VERIFIED** |
| 9 | Untracked files | **868** (files, not directories) | **VERIFIED** |
| 10 | Uncommitted changes present? | **Yes** — but see A.3: 991 of the 1,018 entries are index staleness, not uncommitted work | **VERIFIED** |

```
$ git rev-list --left-right --count HEAD...origin/arena/e088f11d-afyahub-hmis-kenya
0	52

$ git merge-base --is-ancestor HEAD origin/arena/e088f11d-afyahub-hmis-kenya && echo ancestor
ancestor

$ git status --porcelain | awk '{print substr($0,1,2)}' | sort | uniq -c
      1  D
    149  M
    868 ??
```

### A.2 The local clone is shallow

```
$ cat .git/shallow
0111b5502e1a8d8a21faf53845360122275727df
63903c5ef2cd5dae6ea693a684993e7cd57a506c

$ git rev-list --count --all
53
```

The clone was created with a depth limit: only **53 commits** are reachable locally, against **334** in the remote. This is not a defect in the project, but it has one practical consequence that bit the preservation step (§B.3): **a `git bundle` produced from this clone verifies but cannot be cloned from**, because the parent chain is missing.

### A.3 Why "149 modified / 868 untracked" overstates the uncommitted work

The local index is pinned at `0111b55`, which contains only **359 files**. The working tree contains **1,226 files**, because the tree was populated from the much newer published tree. Comparing every worktree file's hash with the published blob at `4cdbc93` (the "historical remote HEAD" in the brief) gives:

| Group | Count | Detail |
| --- | --- | --- |
| Untracked files identical to a published blob | **843** | index staleness only |
| Untracked files differing from the published blob | **16** | real divergence |
| Untracked files absent from the published tree | **9** | local-only (the eight unpublished files + this report's predecessor) |
| Modified files identical to a published blob | **147** | index staleness only |
| Modified files differing from the published blob | **2** | `drizzle/meta/_journal.json`, `src/db/schema.ts` |
| Deleted tracked file | **1** | `src/tests/auth-api.test.ts` — a **0-byte** blob (`e69de29`) that the published tree already deleted |

**18 + 9 = 27 files are real divergence from `4cdbc93`.** The other 991 status entries describe the age of the index, not uncommitted work.

Against the *current* remote tip `34b00d1`, that divergence is **zero**: see §D.

### A.4 Are the local metadata and the worktree synchronised?

**VERIFIED — no, and deliberately so.** The index and HEAD sit at an old commit while the worktree holds the newer published content. This is exactly the condition the earlier report described, and it is *not* evidence of lost or interrupted work: the content on disk is newer than the index, not older than the remote. Re-pointing the index at the published tip would make `git status` honest again — but that is a write operation and was not performed (see §H, blocker G-2, and §I step 1).

---

## Section B — Preservation and backup verification

### B.1 What existed at the start of this session

| Path | Expected | Found |
| --- | --- | --- |
| `/home/user/jalicare-preservation-2026-11-13/` (38 MB, `tree.tar.gz` sha256 `57c26237…`) | preservation archive from the previous pass | **ABSENT** |
| `/home/user/recon-delta-2026-11-13/` (27-file delta, sha256 `c3b8bfb7…`) | delta copy from the reconciliation pass | **ABSENT** |

Both were verified as *not present* — the calls returned `No such file or directory`. The workspace snapshot had rolled back between sessions: `node_modules`, the throwaway PostgreSQL prefix and the cluster were also gone, and local HEAD had reverted from `34b00d1` to `0111b55`. **The project files themselves survived intact** (§D); only the out-of-repo auxiliary directories and the local commit pointer were lost.

Consequence: every hash quoted in the previous report is now stale, and a fresh preservation copy was required.

### B.2 Preservation copy created

Location: **`/home/user/jalicare-preservation-2026-11-13-r2/`** — outside the repository, untracked by Git, separate from the working tree.

| Path | Size | SHA-256 |
| --- | --- | --- |
| `tree.tar.gz` | 15,761,056 B | `b419e1432df26b8b3d454288e4fe9d714d77221b8ec075f16aa821258d7ec71f` |
| `manifests/tree.sha256` | 135,520 B (1,227 lines) | `65ac415516158832a78590e2157585dfbe661a7cbf549410343eea892b0cd8b5` |
| `git/all-refs-complete.bundle` | 23,408,038 B | `ea842f4ce092d6e3babc5dae3eade2b8f106693393a2c9b98da40938a3ee295e` |
| `git/refs.txt`, `git/HEAD.txt`, `git/status-porcelain.txt`, `git/ls-remote.txt`, `git/config.redacted.txt` | 713 / 41 / 47,805 / 5,244 / 467 B | — |
| `README.md` | 2,468 B | — |

Total 38 MB.

**Contents:** every file in the working tree with its original path (`tar`, excluding `.git/`, `node_modules/`, `coverage/`), a SHA-256 manifest of all of them, a complete Git bundle of all refs, and the Git metadata captures.

The archive was captured twice: once when the preservation work began (1,226 files) and once after this report was written, so that the archive is not missing the very document that describes it. The hashes above are the **final** capture — 1,227 files, including this report.

**Does it contain modified, deleted and untracked files?** **VERIFIED yes.** The archive is a whole-tree snapshot, and `git/status-porcelain.txt` records all 1,019 status entries (`-uall`), including the one deleted path. The deleted file's *absence* is recorded; its content was a 0-byte blob and carries no information.

**Is it separate from the active working tree?** **VERIFIED yes** — a sibling directory under `/home/user`, not inside the repository, not on any Git path.

### B.3 Verification performed

| Check | Command | Result |
| --- | --- | --- |
| Manifest against extracted archive | `tar -xzf tree.tar.gz -C /tmp/verify_r2b && sha256sum -c manifests/tree.sha256` | **VERIFIED** — exit 0, no failures, **1,227/1,227 OK** |
| Archive completeness | `find /tmp/verify_r2b -type f \| wc -l` vs manifest lines | **VERIFIED** — 1,227 = 1,227 |
| Bundle integrity | `git bundle verify git/all-refs-complete.bundle` | **VERIFIED** — "The bundle records a complete history" |
| Bundle restorability | `git clone git/all-refs-complete.bundle /tmp/restore_test` | **VERIFIED** — succeeds; 334 commits; `34b00d1`, `ea4dfca` and `4cdbc93` all present |

**Integrity failure found and corrected during this task.** The first bundle was taken from the working clone (`git bundle create … --all`). It passed `git bundle verify` — and was still **not restorable**:

```
$ git clone /…-r2/git/all-refs.bundle /tmp/bundle_clone
error: Could not read 13814abc4c5ab87fa629398b52aeebb192d20c36
fatal: Failed to traverse parents of commit 63903c5ef2cd5dae6ea693a684993e7cd57a506c
fatal: remote did not send all necessary objects
```

Cause: the shallow clone (§A.2). The defective bundle was **replaced** (not merely supplemented) with one produced from a fresh full clone of `origin` into `/tmp/fullclone.git`, and the replacement was proven restorable above. `git bundle verify` alone is therefore **not** sufficient evidence of a usable backup — record this for the next recovery exercise.

### B.4 Secrets

No credential, token or password value appears in this report, the manifest or the `git/` captures. `git/config.redacted.txt` is `.git/config` with URL userinfo stripped; the remote is HTTPS with no embedded credential, and `git/ls-remote.txt` contains only ref names and hashes.

**Verdict: VERIFIED — all current work is preserved outside the repository and integrity-checked.**

---

## Section C — Uncommitted work inventory

### C.1 Shape of the 868 untracked files

| Top-level | Files |
| --- | --- |
| `src/` | 606 (of which `src/tests/` 237 — 227 are `*.spec.ts(x)`) |
| `docs/` | 153 |
| `drizzle/` | 66 (migrations `0024`–`0089`) |
| `scripts/` | 38 |
| `public/` | 3 |
| `docker-compose.test.yml` | 1 |
| `reportfidelis.md` | 1 |

Of the 66 untracked migrations, 64 are simply newer than the local index; only `0088` and `0089` were unpublished at `4cdbc93` (§C.2).

### C.2 The files the brief names, plus the deleted one

| Path | Git status | Purpose | Dependencies | Verification | Risk if replaced | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| `src/insurance/core/claim-invoice-gate.ts` | untracked (168 lines) | The single gate every insurance claim passes: `assertInvoiceClaimable`, `loadClaimInvoiceFacts`, `assertClaimInvoiceStillValid`. Refuses draft, voided and unfinalised invoices; copies the finalisation snapshot onto the claim; re-checks at dispatch. 166 lines of implementation + header rationale | Imports `db`, `schema`, `finalized-invoice.types.ts`. **Consumed by** `insurance/claims/private-claims.service.ts` and `insurance/eclaims/claims-workflow.service.ts` | **VERIFIED** — exercised by `sha-eclaims.db.spec.ts`, `private-insurance.db.spec.ts`, `finalized-invoices.db.spec.ts`; both consuming specs pass on PostgreSQL 16 in the full run | Losing it breaks claim preparation and submission at compile time (two importers); reverting to the old behaviour re-opens claiming from unfinalised invoices | **Preserve** (already published; keep) |
| `drizzle/0088_claim_invoice_finalization.sql` | untracked (52 lines) | Adds `invoice_finalized_at` / `invoice_snapshot` to `sha_eclaims` and `private_insurance_claims`, with paired both-or-neither CHECK constraints and no backfill | Journal idx 88; schema modules `sha-claims.ts`, `private-insurance.ts` | **VERIFIED** — applied from an empty database in this session; both columns and both CHECKs present (§E) | Dropping it leaves the schema modules declaring columns the database lacks → every claim write fails at runtime | **Preserve** (published at `ea4dfca`) |
| `src/accounting/source-ledger-coverage.service.ts` | untracked (332 lines) | Read-only report: for invoices finalized, receipts taken and refunds recorded in a window, is there an active reviewed ledger posting? Selects each source family by its **own** activity date; reports `REVERSED` as not-covered. Never posts or infers an account | Imported by `routes/accounting.routes.ts`; exercised by `billing-posting.db.spec.ts` and the UI spec | **VERIFIED** — `billing-posting.db.spec.ts` passes in the DB run | Losing it breaks the accounting route at compile time | **Preserve** (published at `ea4dfca`) |
| `src/tests/vitest/source-ledger-coverage-ui.spec.tsx` | untracked (204 lines) | jsdom spec for the coverage panel in `AccountingModule` | `AccountingModule.tsx`, `client-sprint.client.ts`, server route | **VERIFIED** — passes in the full run (287/287 files green) | Losing it removes UI coverage only; nothing breaks | **Preserve** (published) |
| `drizzle/0089_facility_letterheads.sql` | untracked (197 lines) | Creates versioned, immutable facility letterheads (`facility_letterheads`, `facility_letterhead_events`), a partial unique index enforcing at most one `ACTIVE` version per facility, and adds `billing_invoice_finalizations.letterhead_id` | Journal idx 89; `src/db/schema/facility-branding.ts`; `billing.ts` | **VERIFIED applied** — 21 and 9 columns, both unique indexes, FK `billing_invoice_finalizations_letterhead_id_fkey` present on a migrated database | Dropping it removes the letterhead foundation and the historical-branding link | **Preserve** — but see the WIP warning below |
| `src/db/schema/facility-branding.ts` | untracked (89 lines) | Drizzle mirror of the two letterhead tables; `serial` primary keys, bytea escape hatch for the logo | Exported from `src/db/schema.ts`; referenced by `billing.ts` | **PARTIAL** — the `schema` contract specs pass and the TS↔DB comparison matches; there is **no service, route, UI or spec for letterheads** (§C.3) | Losing it breaks `schema.ts` and `billing.ts` at compile time | **Preserve, then finish** (Phase B is infrastructure-only today) |
| `docs/PHASE_A3_CHECKPOINT.md` | untracked (35 lines) | Checkpoint record for Phase A3: what the gate does, the migration, the environment, and the DB-spec command | Narrative | **VERIFIED** — descriptive only | Losing it loses the provenance of the A3 work | **Preserve** (published) |
| `src/tests/auth-api.test.ts` | **deleted** (` D`) | **Nothing** — the blob in local HEAD is `e69de29bb2d1` = 0 bytes | None; no file, script or config references it | **VERIFIED** — `docs/quality/BASELINE.md` already lists it as "empty file (0 lines)"; the published tree does not contain it either | None: the path is referenced by no runner and contains no content | **Accept the deletion** — it matches the published tree; no action |

### C.3 Genuinely unfinished or partially implemented work

| Area | Evidence | Assessment |
| --- | --- | --- |
| **Facility letterhead (Phase B)** | `facility_letterheads` / `facility_letterhead_events` exist in schema and migration; `billing_invoice_finalizations.letterhead_id` exists; **`grep -rln "letterhead" src` returns only `db/schema/billing.ts`, `db/schema/facility-branding.ts` and `tests/schema-extraction.spec.ts`** — no service, no route, no UI, no dedicated spec | **Schema-only WIP.** Infrastructure is sound and migrated; the feature is not started. |
| **Claim-invoice gate (Phase A3)** | Gate + migration + wiring + specs; specs pass | **Complete and verified** |
| **Source-ledger coverage (Phase A4)** | Service + route + client + UI panel + two specs; all pass | **Complete and verified** |
| Everything else (237 untracked test files, 66 migrations) | Byte-identical to the published tree | Not WIP — index staleness |

---

## Section D — Local vs published remote differences

### D.1 The numbers in the brief, re-derived

The brief's figures (1,217 blobs compared, 1,206 identical, 11 differing, 0 absent) were computed against `4cdbc93` on the *pre-reconciliation* tree. Re-running the same comparison now, against the same commit, on the current tree:

| Category | Brief | Measured now | Why it moved |
| --- | --- | --- | --- |
| Blobs in `4cdbc93` | 1,217 | **1,217** | unchanged |
| Present and byte-identical | 1,206 | **1,199** | −7: the seven reconciliation edits to already-published files |
| Present but differing | 11 | **18** | +7: the same seven files |
| Absent from disk | 0 | **0** | unchanged |
| Local-only | 8 | **9** | +1: this report's predecessor, `docs/audits/JALICARE_RECOVERY_PRESERVATION_VERIFICATION_2026-11-13.md` |
| Files on disk | 1,225 | **1,226** | same +1 |

Arithmetic closes exactly: 1,199 + 18 = 1,217; 1,217 + 9 = 1,226. **VERIFIED.**

### D.2 Against the current published tip

```
$ git diff-tree -r --name-only 34b00d1 <worktree tree d96de69>
(no output)
```

| Category vs `34b00d1` | Count |
| --- | --- |
| Blobs in the published tree | **1,226** |
| Identical on disk | **1,226** |
| Differing | **0** |
| Absent from disk | **0** |
| Local-only | **0** |

**VERIFIED: the working tree is byte-identical to the current remote tip.** There is no local/published discrepancy left to reconcile. The 18 differences vs `4cdbc93` exist only because `4cdbc93` is an ancestor; every one of them is already published in `ea4dfca`.

> **Scope note.** Every count in §A and §D is a measurement taken **before this report was written**. Creating this file adds exactly one local-only path (`docs/RECOVERY_PRESERVATION_VERIFICATION_REPORT.md`) and moves the status entry count from 645 to 646, with `-uall` 1,018 → 1,019 and files on disk 1,226 → 1,227. Nothing else changed; re-running the comparison against `34b00d1` after the write reports **1 differing path: this report**.

### D.3 The 18 files (vs `4cdbc93`) and the 9 local-only files

`+/-` = lines added / removed relative to the `4cdbc93` blob.

| # | Path | Local | Remote `4cdbc93` | Nature of the difference | Important WIP in local? | Newer change in remote? | Safely reconcilable? | Recommended step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `drizzle/meta/_journal.json` | +14 / −0 | older | Strict superset: appends idx 88, 89 | Yes (two migrations) | — | Yes | None — already published identically at `ea4dfca` |
| 2 | `src/db/schema.ts` | +1 / −0 | older | Barrel export for `facility-branding` | Yes | — | Yes | None — published |
| 3 | `src/db/schema/billing.ts` | +4 / −0 | older | `letterheadId` FK column | Yes | — | Yes | None — published |
| 4 | `src/db/schema/private-insurance.ts` | +3 / −0 | older | Two 0088 columns | Yes | — | Yes | None — published |
| 5 | `src/db/schema/sha-claims.ts` | +8 / −0 | older | Two 0088 columns + rationale | Yes | — | Yes | None — published |
| 6 | `src/insurance/claims/private-claims.service.ts` | +27 / −0 | older | Imports the gate, records the frozen basis | Yes | — | Yes | None — published |
| 7 | `src/insurance/eclaims/claims-workflow.service.ts` | +28 / −0 | older | Same, SHA path | Yes | — | Yes | None — published |
| 8 | `src/routes/accounting.routes.ts` | +45 / −0 | older | `GET /source-ledger-coverage` | Yes | — | Yes | None — published |
| 9 | `src/api/client-sprint.client.ts` | +34 / −0 | older | Client method + type | Yes | — | Yes | None — published |
| 10 | `src/components/modules/AccountingModule.tsx` | +117 / −0 | older | Coverage panel | Yes | — | Yes | None — published |
| 11 | `src/tests/integration/billing-posting.db.spec.ts` | +279 / −0 | older | Additional coverage | Yes | — | Yes | None — published |
| 12 | `src/tests/integration/inpatient-bed-billing.db.spec.ts` | +54 / −0 | older | Finalise-before-claim setup | Yes | — | Yes | None — published |
| 13 | `src/tests/integration/pharmacy-inventory-billing.db.spec.ts` | +12 / −0 | older | Finalise-before-claim | Yes | — | Yes | None — published |
| 14 | `src/tests/integration/operations-status.db.spec.ts` | +12 / −2 | older | Journal length read at run time instead of the literal 88 | Yes | — | Yes | None — published |
| 15 | `src/tests/schema-extraction.spec.ts` | +4 / −0 | older | Two letterhead exports required | Yes | — | Yes | None — published |
| 16 | `src/tests/support/schema-contract.ts` | +33 / −0 | older | 0088 splices in the baseline helper | Yes | — | Yes | None — published |
| 17 | `src/tests/vitest/private-insurance.db.spec.ts` | +168 / −9 | older | **Both sides changed**: three probes replaced by assertions that the DB refuses the write | Yes | — | Yes (already resolved) | None — published |
| 18 | `src/tests/vitest/sha-eclaims.db.spec.ts` | +250 / −26 | older | **Both sides changed**: corrupting probes replaced by refusal assertions | Yes | — | Yes (already resolved) | None — published |

Local-only files (9): `docs/PHASE_A3_CHECKPOINT.md` (+35), `docs/audits/JALICARE_RECOVERY_PRESERVATION_VERIFICATION_2026-11-13.md` (+674), `docs/audits/SYRONA_REQUIREMENTS_GAP_ASSESSMENT_2026-11-13.md` (+567), `drizzle/0088_claim_invoice_finalization.sql` (+52), `drizzle/0089_facility_letterheads.sql` (+197), `src/accounting/source-ledger-coverage.service.ts` (+330), `src/db/schema/facility-branding.ts` (+89), `src/insurance/core/claim-invoice-gate.ts` (+166), `src/tests/vitest/source-ledger-coverage-ui.spec.tsx` (+204).

**On items 17 and 18 (the only two where the local version removes lines):** the removals are not loss. They delete assertions that a pending claim could *detect* an invoice changing underneath it, and replace them with assertions that the database now *refuses* the change outright. The removed behaviour is strictly weaker than the behaviour that replaced it, and the replacement is enforced by migration 0037's immutability triggers, not by test convenience. **VERIFIED** by the two specs passing on PostgreSQL 16.

**No automatic choice between local and remote was made, and neither side was overwritten.**

---

## Section E — Database and migration readiness

### E.1 Environment

| Item | Value | Status |
| --- | --- | --- |
| PostgreSQL | **16.15**, embedded (`embedded-postgres@16.15.0-beta.19`), throwaway prefix `/home/user/pgtool`, cluster `/home/user/pgtest16` | **VERIFIED** |
| Listening address | `127.0.0.1:55432`, trust auth, `unix_socket_directories=/tmp`, `fsync=off` | **VERIFIED** |
| `system_identifier` | **`7707584137819502262`** — newly initialised this session | **VERIFIED** |
| Docker | **not installed**, daemon unreachable | **BLOCKED** (only affects `npm run test:docker`; the vitest suite does not need it) |
| Node / npm | v22.22.3 / 10.9.8 | **VERIFIED** |
| Test database configuration | `src/tests/vitest/support/db.ts` reads `SQL_HOST`/`SQL_PORT`/`SQL_DB_NAME`/`SQL_ADMIN_USER`/`SQL_ADMIN_PASSWORD`; availability decided once in `global-setup.ts` via `JALICARE_DB_AVAILABLE`; `JALICARE_REQUIRE_DB=1` turns a skip into a failure | **VERIFIED** |
| Production access | **none attempted** — the cluster is a disposable directory created by this task | **VERIFIED** |

### E.2 Migration inventory

| Item | Value |
| --- | --- |
| Journal file | `drizzle/meta/_journal.json` |
| Entries | **90** (idx 0–89), no duplicate idx or tag |
| Latest index and name | **idx 89 — `0089_facility_letterheads`**, `when` 1795315200000 |
| Previous | idx 88 — `0088_claim_invoice_finalization`, `when` 1795228800000 |
| `drizzle/*.sql` on disk | **90** |
| Drizzle snapshots in `drizzle/meta/` | **7** — there is **no snapshot for 0088 or 0089**; both are hand-written |

**Schema export consistency — VERIFIED:**

```
src/db/schema.ts:53   export * from './schema/facility-branding.ts';
src/db/schema/billing.ts:482  letterheadId: integer('letterhead_id').references(() => facilityLetterheads.id),
```

The barrel exports the module, `billing.ts` references it, `schema-extraction.spec.ts` requires `facilityLetterheads` and `facilityLetterheadEvents` in the export list, and `facility-branding.ts` declares both tables. Arrow of dependency is complete; no orphan.

### E.3 Migrations applied from an empty disposable database

Database `jalicare_synthetic_test` created fresh (0 tables), then:

```
$ SQL_HOST=127.0.0.1 SQL_PORT=55432 SQL_DB_NAME=jalicare_synthetic_test \
  SQL_ADMIN_USER=<redacted> SQL_ADMIN_PASSWORD=<redacted> npx drizzle-kit migrate
[✓] migrations applied successfully!
```

| Check | Observed | Status |
| --- | --- | --- |
| First migration failure | **none** — 90/90 applied in one pass | **VERIFIED** |
| Rows in `drizzle.__drizzle_migrations` | **90**, last `created_at` 1795315200000 (= idx 89) | **VERIFIED** |
| Tables in `public` | **236** | **VERIFIED** |
| `facility_letterheads` | 21 columns | **VERIFIED** |
| `facility_letterhead_events` | 9 columns | **VERIFIED** |
| Indexes | `facility_letterheads_pkey`, `facility_letterheads_active_unique`, `facility_letterhead_version_unique`, `facility_letterhead_events_pkey`, `facility_letterhead_events_letterhead_idx` | **VERIFIED** |
| `billing_invoice_finalizations` | 11 columns incl. `letterhead_id integer` | **VERIFIED** |
| FK on `billing_invoice_finalizations` | `…_invoice_id_fkey`, `…_tenant_id_fkey`, `…_facility_id_fkey`, `…_finalized_by_user_id_fkey`, **`…_letterhead_id_fkey`** | **VERIFIED** |
| 0088 columns on `sha_eclaims` | `invoice_finalized_at` (timestamp, nullable), `invoice_snapshot` (jsonb, nullable) | **VERIFIED** |
| 0088 columns on `private_insurance_claims` | same | **VERIFIED** |
| 0088 CHECK constraints | `sha_eclaims_invoice_basis_complete`, `private_insurance_claims_invoice_basis_complete`, both `((finalized_at IS NULL AND snapshot IS NULL) OR (both NOT NULL))` | **VERIFIED** |

**One design observation worth recording.** The schema modules declare the two 0088 columns immediately after `invoice_id` (source lines 57–58 and 58–59), but PostgreSQL appends them where `ALTER TABLE` puts them: ordinal **53/54** on `sha_eclaims` and **50/51** on `private_insurance_claims`. This is harmless — the physical order does not affect behaviour and the contract fixture follows the *declaration* order — but a future `drizzle-kit generate` diff against the database would report the columns as "moved".

**Cleanup:** the disposable database and cluster were created by this task only. Nothing else was touched.

---

## Section F — Test and typecheck baseline

### F.1 Results measured in this session

| Check | Command | Result | Status |
| --- | --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | **exit 0**, zero output | **VERIFIED** |
| ESLint | `npx eslint .` | **exit 0**, **0 errors, 102 warnings** | **VERIFIED** |
| Prettier | `npm run format:check` (read-only check; no `--write`) | **clean**, "All matched files use Prettier code style!" | **VERIFIED** |
| Full suite **with** PostgreSQL | `JALICARE_REQUIRE_DB=1 JALICARE_TEST_PG_SYSTEM_IDENTIFIER=<new sysid> npx vitest run` | **287/287 files, 2,673/2,673 tests passed, 0 failed, 0 skipped, 460.84 s, exit 0** | **VERIFIED** |
| Full suite **without** PostgreSQL | `env -u SQL_* -u JALICARE_REQUIRE_DB npx vitest run` | **202 files passed / 85 skipped; 1,902 tests passed / 771 skipped; 0 failed; exit 0** | **VERIFIED** |
| Schema specs alone | `npx vitest run schema-extraction schema-sha-claims schema-private-insurance` | **3 files, 119/119 tests passed** | **VERIFIED** |
| Coverage | `npm run test:coverage` | Measured **66.84 % lines / 61.55 % branches** earlier in the same working session, before the workspace rollback; **not re-run after the rollback** | **PARTIAL** |
| Docker bootstrap | `npm run test:docker` | Docker absent | **BLOCKED** |
| External services | — | No suite requires a live payer, payment provider or SHA endpoint; adapter boundaries are stubbed and the provider calls that are "simulated" are labelled as such in the code | **VERIFIED** (no network dependency observed in the runs) |

### F.2 The historical figures, reconciled

| Figure in the brief | Reproduced? | Explanation |
| --- | --- | --- |
| 2,673 tests across 287 files | **VERIFIED exactly** | 2,673 / 287 in both runs |
| 771 skipped | **VERIFIED exactly** | 771 skipped in the no-database run |
| 1,898 passed + 4 failed = 1,902 | **VERIFIED as 1,902 passed / 0 failed** | the four failures are fixed; the total is unchanged, which is the strongest evidence that nothing was dropped to make it green |
| 0 TypeScript errors | **VERIFIED** | |
| 0 ESLint errors, 102 warnings | **VERIFIED exactly** | |
| "141 database-dependent test files self-skip" | **NOT VERIFIED** | Measured now: **85 files / 771 tests** skip; **88 files** call `describeDb(`. Neither measure gives 141. The figure should be treated as unsupported rather than corrected silently. |

**Conclusion: the suite is green in both configurations, and the historical baseline is reproduced except for the four failures, which are fixed rather than suppressed.**

---

## Section G — Investigation of the four schema-contract failures

### G.1 Premise check first

The brief asks for an investigation because four schema-contract tests were failing. **In the current tree they pass** (§F.1: 119/119). The fix was applied and published as `ea4dfca` *before this task began*; nothing was changed by this task. To make the investigation evidence-based rather than a description of history, the failing condition was **reconstructed in a throwaway directory** (`/tmp/g_repro`): the current tree, with **one** file reverted to its `4cdbc93` version — `src/tests/support/schema-contract.ts`. The repository, its index and its WIP were not touched.

Reconstruction result: **4 failed / 115 passed** — an exact reproduction.

### G.2 The four failures

| # | Test file | Test name |
| --- | --- | --- |
| 1 | `src/tests/schema-extraction.spec.ts` | *schema barrel: pre-extraction contract › shaEclaims keeps its table metadata* |
| 2 | `src/tests/schema-extraction.spec.ts` | *schema barrel: pre-extraction contract › privateInsuranceClaims keeps its table metadata* |
| 3 | `src/tests/schema-sha-claims.spec.ts` | *sha-claims schema module › shaEclaims retains its pre-extraction metadata* |
| 4 | `src/tests/schema-private-insurance.spec.ts` | *private-insurance schema module › privateInsuranceClaims retains its pre-extraction metadata* |

Two tables × two entry points (the public barrel, and each module's own contract) — which is why the count is four and not two.

### G.3 The exact assertion

```ts
// src/tests/schema-extraction.spec.ts
it.each(Object.entries(baseline.tables))('%s keeps its table metadata', (name, expected) => {
  expect(tableContract(schemaExports[name] as PgTable)).toEqual(
    contractWithReviewedAdditions(name, expected),
  );
});

// src/tests/support/schema-module-contract.ts — same assertion, per module
expect(actual).toEqual(
  kind === 'tables' ? contractWithReviewedAdditions(key, baseline[kind][key]) : baseline[kind][key],
);
```

Observed failure:

```
AssertionError: expected { name: 'sha_eclaims', …(8) } to deeply equal { name: 'sha_eclaims', …(8) }

- Expected
+ Received
@@ after the "invoice_id" column @@
       { "default": null, "hasDefault": false,
+        "name": "invoice_finalized_at", "notNull": false, "primary": false,
+        "type": "timestamp", "unique": false, "uniqueName": null },
+      { "default": null, "hasDefault": false,
+        "name": "invoice_snapshot", "notNull": false, "primary": false,
+        "type": "jsonb", "unique": false, "uniqueName": null },
       { "name": "eligibility_verification_id", "notNull": false, … }
```

(The same diff also shows `"opClass": undefined` on index columns. That is display noise: `toEqual` ignores undefined properties and the fixture is JSON-parsed. It is **not** a second failure mode — confirmed by the same assertion passing once the two columns are added.)

### G.4 Expected contract vs actual schema

| | Expected (fixture + helper) | Actual (schema module) |
| --- | --- | --- |
| Source | `src/tests/fixtures/schema-contract-before-extraction.json` — a frozen capture of the pre-extraction barrel, **51 columns** on `shaEclaims`, **48** on `privateInsuranceClaims` | `src/db/schema/sha-claims.ts` (51 + 2), `src/db/schema/private-insurance.ts` (48 + 2) |
| `invoice_finalized_at` | absent | `timestamp('invoice_finalized_at')`, nullable, no default, not unique |
| `invoice_snapshot` | absent | `jsonb('invoice_snapshot').$type<Record<string, unknown>>()`, nullable, no default, not unique |
| Position | — | immediately after `invoice_id` (declaration order) |
| Fixture changed? | **No** — sha256 `ce90a9c3…` is byte-identical to the `4cdbc93` blob | — |

### G.5 Root cause

**The columns were introduced correctly and the fixture was correctly left alone; the *helper* was not updated.** The published design freezes `schema-contract-before-extraction.json` as an immutable historical baseline and expresses every later schema change as an explicit, reviewed delta inside `contractWithReviewedAdditions()`. `dispatch_revision` (migration 0087) had already been added this way. Migration 0088 added two more columns to the two claim tables, and the schema modules received them — but the corresponding splice was never written, so the helper still returned the 0087-era contract.

**The test was right and the code was right; the reviewed-additions ledger was incomplete.** This is the failure mode the helper exists to make visible, and the correct response is to extend the ledger — not the fixture, and not the assertion.

### G.6 Correct fix

Add to `contractWithReviewedAdditions()`, in the branch for `shaEclaims` and `privateInsuranceClaims`, immediately after the existing `dispatch_revision` block:

1. locate `invoice_id`, throw if absent (a silently missing anchor must not pass);
2. splice `invoice_finalized_at` (`type: 'timestamp'`) and `invoice_snapshot` (`type: 'jsonb'`), both `notNull: false`, `hasDefault: false`, `default: null`, `unique: false`, `uniqueName: null`;
3. compute the `status` index **before** either mutation, so inserting `dispatch_revision` does not shift the anchor used by the second splice.

Prohibited and unnecessary: editing the fixture, weakening `toEqual` to a subset match, deleting the `it.each` rows, or skipping the specs.

**This exact fix is what `ea4dfca` contains** (33 added lines, 0 removed). It was applied before this task and is published; this task did not re-apply or alter it.

### G.7 Regression tests needed

| Gap | Why it matters | Suggested guard |
| --- | --- | --- |
| The helper's splices are never asserted directly | A future migration that adds a column to `sha_eclaims` will fail as four red tests with no hint that the helper needs an entry | A test that asserts `contractWithReviewedAdditions(name, fixture)` differs from the fixture by exactly the documented reviewed additions, with the reason string naming the migration |
| `invoice_finalized_at` / `invoice_snapshot` have no *DB-level* contract test | The TS metadata and the physical columns are now checked only by an ad-hoc comparator (§E.3), not by the suite | Add a `*.db.spec.ts` assertion on `information_schema.columns` for the two tables, and on the two `…_invoice_basis_complete` CHECK constraints |
| The both-or-neither CHECK has no negative test | The constraint is the only thing preventing a half-written basis | A spec that attempts `(finalized_at, NULL)` and expects SQLSTATE `23514` |

---

## Section H — Risks and blockers

| ID | Category | Severity | Evidence | Consequence if ignored | Safest next action |
| --- | --- | --- | --- | --- | --- |
| G-1 | Git / workspace | **Critical** (mitigated) | The workspace rolled back between sessions: HEAD reverted `34b00d1` → `0111b55`, and both out-of-repo preservation directories vanished | Any uncommitted work in this environment can be lost without warning; only what is pushed survives | **Nothing is at risk now** — the tree is byte-identical to `34b00d1` and preserved in `…-r2`. Keep pushing before ending a session. |
| G-2 | Git / workspace | **High** | Index at `0111b55` (359 files) while the worktree holds 1,226; 991 of 1,018 status entries are staleness (§A.3) | Every future `git status`, `git stash`, `git checkout` and code review is misleading; a careless `git add -A` would "re-add" 991 unchanged files | Fast-forward the local branch to `34b00d1` (`git merge --ff-only`), which re-points index and HEAD without touching content. **Requires owner authorisation** — it is a write operation this task was forbidden. |
| G-3 | Git / workspace | **Medium** | `.git/shallow` limits the clone to 53 of 334 commits (§A.2) | History tools, `git log --follow`, blame across the boundary and bundles all misbehave; a bundle looks valid and is not restorable (§B.3) | `git fetch --unshallow origin` once, then re-verify the bundle. |
| P-1 | Preservation | **High** (resolved) | No preservation copy existed at session start (§B.1) | A second rollback would have destroyed the only record of the A3/A4 work | **Done** — `…-r2` verified 1,227/1,227 + cloneable bundle. Re-verify after any further change. |
| P-2 | Preservation | **Medium** | `git bundle verify` passed on an unrestorable bundle | A future "verified" backup fails at restore time, when it matters most | Always prove a backup by restoring it to a throwaway location (§B.3), not by `verify` alone. |
| D-1 | Database readiness | **Low** | No Docker in the sandbox; `npm run test:docker` cannot run | The `bootstrap` CI job is unverifiable locally | Accept: CI runs it (7/7 green on `34b00d1`). |
| M-1 | Migration integrity | **Medium** | No drizzle snapshots for 0088/0089; both hand-written (§E.2) | `drizzle-kit generate` in future may try to "re-create" columns that already exist, or miss the CHECK constraints | Record 0088/0089 in `drizzle/meta/` before the next `generate`; add the DB-level contract tests from §G.7. |
| M-2 | Migration integrity | **Low** | 0088 columns are physically at ordinal 53/54 rather than after `invoice_id` | A future schema diff shows spurious column moves | Accept (order is not semantic), or note it in the migration comments. |
| T-1 | Test reliability | **Low** | Full suite needs a real PostgreSQL and a matching `JALICARE_TEST_PG_SYSTEM_IDENTIFIER`; a re-initialised cluster rotates the identifier | A stale identifier makes `report-centre` fail at suite level with an unrelated-looking error | Always re-read `pg_control_system()` after provisioning, as this session did. |
| T-2 | Test reliability | **Medium** | The suite's DB gate depends on an env var set by `global-setup.ts`; a no-DB run is green by skipping 771 tests | A green run on a laptop can mean "Tested nothing" | Always report both numbers: with-DB 2,673 passed, and no-DB 1,902 passed / 771 skipped. |
| C-1 | Claim-invoice finalization WIP | **Low** | Gate, migration, wiring and specs all present and green | — | None. This work is complete and published. |
| C-2 | Facility letterhead WIP | **High** | Schema + migration + FK exist; **no service, route, UI or spec** (§C.3) | The database carries two empty tables and a nullable FK that nothing writes. A "letterhead feature" would be reported as present on the strength of a table and a button-less schema | Do not describe Phase B as delivered. Finish it as a unit (§I step 4) or leave it clearly marked as infrastructure. |
| C-3 | Other endangered work | **Medium** | 4 stray `*-backup` files inside `src/` and `server.ts.phase2-backup` at the repo root (listed in the previous report's Appendix A) are untracked cruft, not protection | They will never be restored, and they inflate the tree by ~190 KB | Leave in place (deleting is out of scope), but stop treating them as backups. |

**No blocker requires stopping.** The one critical item — an unprotected working tree — is resolved by §B.

---

## Section I — Recommended implementation order

Recommended, not started. The order is driven by what the evidence supports, not by what would look impressive.

| # | Step | Why this position | Done when |
| --- | --- | --- | --- |
| 1 | **Fast-forward the local branch to `34b00d1`, and `--unshallow` the clone** | Makes the workspace legible before anything else. Content does not change; only the index, HEAD and history completeness do. Without it, every later review is read through a false 149/868 diff | `git status` reports 0 changes; `git rev-list --count --all` = 334 |
| 2 | **Close the schema-contract regression gaps** (§G.7) | The four failures are fixed, but nothing yet *tests the ledger*. The next migration will fail the same way | New assertions fail if a column is added to `sha_eclaims` without a helper entry; DB-level contract + CHECK-negative specs pass |
| 3 | **Make migrations 0087–0089 reproducible with drizzle snapshots** | Hand-written migrations are invisible to `drizzle-kit generate`; this is the mechanism that produced the 0088/0089 drift in the first place | `drizzle-kit generate` on a clean checkout produces no diff against the migrated database |
| 4 | **Finish facility letterhead as one unit** (service → route → UI → spec), then stop | Currently schema-only; it is the only half-built thing in the tree, and P0 documents depend on it | Upload → version → activate → supersede works end to end behind a permission check, with the one-active-per-facility invariant proven by a DB test |
| 5 | Server-rendered invoice and receipt documents | Depends on 4 for branding; depends on finalized-invoice snapshots, which already exist | A reprinted invoice renders from its snapshot with the letterhead version recorded at finalization |
| 6 | Printable LPOs and GRNs | Depends on 5's rendering path; procurement data already exists | A GRN prints from stored data with no re-derived figures |
| 7 | Remaining operational workflows | Breadth work; best done from a green baseline | Named per workflow, with a DB spec each |
| 8 | Client-workbook-based financial reports | **Blocked on the client's workbooks** — do not invent formulas | Only when the client supplies the template and the mapping is agreed |
| 9 | External integrations | **Blocked on official specifications and credentials** — nothing in the repository establishes production connectivity with KCB BUNI, Jenga, DHA eClaims or Safaricom M-PESA | Only when a provider sandbox is available, and always behind the existing adapter boundary |
| 10 | Production acceptance testing | Last by definition | Written external UAT evidence, not internal sign-off |

Steps 2 and 3 are deliberately ahead of any feature work: they are the mechanisms that keep the schema honest, and both were implicated in the drift this report investigates.

---

## Section J — Final executive summary

### A. Current project state

**The workspace is safe to continue developing, with one caveat about how it will look.**

The working tree is byte-identical to the published branch tip `34b00d1` — 1,226 of 1,226 files match. No work is uncommitted in substance, nothing was lost, and CI on that commit is green (7/7 jobs: typecheck and lint, coverage with PostgreSQL 16, migrations and database specs, production build, Docker bootstrap, formatting, dependency audit).

The caveat: the local **index** is 52 commits behind the **tree**, so `git status` reports 149 modified, 1 deleted and 868 untracked files where the truth is 0. This is a readability problem, not a data problem, and it is fixed by a fast-forward that changes no content.

### B. Preservation status

**Yes — all current work is backed up and verified.**

`/home/user/jalicare-preservation-2026-11-13-r2/` holds a whole-tree archive (1,227 files, verified 1,227/1,227 against a SHA-256 manifest), a complete and *restorable* Git bundle of all refs (334 commits, proven by cloning it back), and the Git metadata captures. The previous archive and the earlier delta copy had both disappeared with the workspace rollback; this one replaces them.

One methodological finding is worth carrying forward: **`git bundle verify` passing does not mean a bundle can be restored.** The first attempt, taken from this shallow clone, verified cleanly and then failed to clone.

### C. Verification status

| Check | Result |
| --- | --- |
| Passed | `tsc --noEmit` (0 errors); `eslint .` (0 errors, 102 warnings); `prettier --check` (clean); full suite **with** PostgreSQL 16 (2,673/2,673, 287 files, exit 0); full suite **without** PostgreSQL (1,902 passed / 771 skipped, exit 0); schema specs (119/119); migrations 90/90 from an empty database; preservation manifest (1,227/1,227); bundle restore |
| Failed | none |
| Skipped | `npm run test:docker` (Docker not installed); coverage re-run (measured earlier in this session at 66.84 % lines / 61.55 % branches, not repeated after the rollback) |
| Could not run | anything requiring a live payer/payment provider/SHA endpoint — by design, those are stubbed adapters |
| Not verified | the historical claim of "141 database-dependent test files"; measured 85 skipped files / 88 files calling `describeDb` |

### D. Critical blockers

1. **The local index is 52 commits behind the tree** (High). Every Git reading of this workspace is wrong until it is fast-forwarded. Content is unaffected.
2. **The clone is shallow — 53 of 334 commits** (Medium). It already produced an unrestorable "verified" backup.
3. **Migrations 0088 and 0089 have no drizzle snapshots** (Medium). The next `drizzle-kit generate` will not know they exist.
4. **Facility letterhead is schema-only** (High, for planning honesty). Two tables and an FK exist with no service, route, UI or spec. It must not be reported as delivered.
5. **Nothing tests the reviewed-additions ledger itself** (Medium). The four failures were fixed; the mechanism that missed them was not strengthened.

### E. Next authorized task

**Fast-forward the local branch to `34b00d1` and unshallow the clone — a synchronisation task, not a feature task.**

```bash
git fetch --unshallow origin
git merge --ff-only origin/arena/e088f11d-afyahub-hmis-kenya
git status --short          # expected: empty
```

This is the single smallest action that removes the largest source of misreading in the workspace. It rewrites no history (`--ff-only` cannot), changes no file content, and is reversible by re-pointing the branch.

### F. Acceptance criteria

The task is complete when all of the following are observed, not asserted:

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | `git rev-parse HEAD` = `34b00d1126bd8a0e79ad892bf2ce4ce44b2afa7f` | command output |
| 2 | `git status --porcelain` returns **no lines** | command output |
| 3 | `git rev-list --left-right --count HEAD...origin/arena/e088f11d-afyahub-hmis-kenya` = `0 0` | command output |
| 4 | `git rev-list --count --all` = **334** and `.git/shallow` no longer exists | command output |
| 5 | The worktree tree hash is unchanged: `git write-tree`-equivalent of the tree is still `d96de69030311547d3b2811fecce2de621ce18ae` | command output |
| 6 | `git reflog` shows the move and `git fsck --no-progress` reports no missing objects | command output |
| 7 | No file under `docs/`, `src/`, `drizzle/` or `scripts/` changed mtime as a result | `git diff` empty; preserved archive still verifies 1,227/1,227 |

### G. Decisions required from the project owner

Only these cannot be settled from repository evidence:

1. **Authorise the fast-forward.** It is a write to `.git` (index and branch pointer). This task was explicitly forbidden from performing it. Confirm you want step E performed rather than reviewing the 52 unpublished commits first.
2. **Authorise `git fetch --unshallow`**, which downloads roughly 20 MB of history from `origin`.
3. **Is the branch `arena/e088f11d-afyahub-hmis-kenya` — not `main` — the intended integration target?** `main` is at `63903c5` and does not contain any of the last 52 commits, including the claim gate, the coverage report and the letterhead migration.
4. **Is facility letterhead still a P0 requirement?** If it has been deferred, the two tables and the nullable FK should be explicitly marked as infrastructure-only so no later reader mistakes them for a delivered feature. If it is still P0, it is the next feature after the two schema-hygiene steps.
5. **Does the client's financial workbook exist in a form that may be transcribed?** Step 8 remains blocked until the template and the mapping are supplied; no formula will be invented.

---

## Appendix — Command record

All commands were run from `/home/user/afyahub-hmis-kenya` unless stated otherwise. Passwords are shown as `<redacted>`; the cluster is a disposable local instance that no other system uses.

```bash
# --- A. Git state (read-only) ---
pwd; git rev-parse --show-toplevel
git log --oneline -3
git fetch origin
git for-each-ref --format='%(refname) %(objectname:short) %(subject)' refs/heads refs/remotes
git rev-list --left-right --count HEAD...origin/arena/e088f11d-afyahub-hmis-kenya   # 0  52
git merge-base --is-ancestor HEAD origin/arena/e088f11d-afyahub-hmis-kenya          # ancestor
git status --porcelain | awk '{print substr($0,1,2)}' | sort | uniq -c               # 1 D, 149 M, 868 ??
git status --porcelain -uall | wc -l                                                  # 1018
cat .git/shallow; git rev-list --count --all                                          # 53

# --- B. Preservation (outside the repository) ---
git bundle create /home/user/jalicare-preservation-2026-11-13-r2/git/all-refs.bundle --all
tar --exclude=./.git --exclude=./node_modules --exclude=./coverage -czf \
    /home/user/jalicare-preservation-2026-11-13-r2/tree.tar.gz .
find . -path ./.git -prune -o -path ./node_modules -prune -o -type f -print0 | sort -z \
  | xargs -0 sha256sum > /home/user/jalicare-preservation-2026-11-13-r2/manifests/tree.sha256
tar -xzf …/tree.tar.gz -C /tmp/verify_r2 && cd /tmp/verify_r2 \
  && sha256sum -c …/manifests/tree.sha256                                              # 1226/1226 OK
git clone …/git/all-refs.bundle /tmp/bundle_clone                                     # FAILED (shallow clone)
git clone --bare https://github.com/fetronix/afyahub-hmis-kenya.git /tmp/fullclone.git
git --git-dir=/tmp/fullclone.git bundle create …/git/all-refs-complete.bundle --all
git bundle verify …/git/all-refs-complete.bundle                                      # complete history
git clone …/git/all-refs-complete.bundle /tmp/restore_test                            # OK, 334 commits

# --- C/D. Reconciliation arithmetic (temporary index in /tmp; .git/index untouched) ---
GIT_INDEX_FILE=/tmp/idx_now git read-tree HEAD && GIT_INDEX_FILE=/tmp/idx_now git add -A -- .
GIT_INDEX_FILE=/tmp/idx_now git write-tree          # d96de69030311547d3b2811fecce2de621ce18ae
git diff-tree -r --name-only 34b00d1 d96de69… | wc -l    # 0
git diff-tree -r --name-only 4cdbc93 d96de69… | wc -l    # 27
git diff --cached --name-only | wc -l                    # 0 — nothing staged

# --- E. Disposable PostgreSQL 16.15 ---
npm install --prefix /home/user/pgtool embedded-postgres@16.15.0-beta.19
PGBIN=/home/user/pgtool/node_modules/@embedded-postgres/linux-x64/native/bin
"$PGBIN/initdb" -D /home/user/pgtest16 -U jalicare_test --auth=trust -E UTF8 --locale=C
"$PGBIN/pg_ctl" -D /home/user/pgtest16 -l /tmp/pg16.log \
  -o "-p 55432 -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c fsync=off" -w start
# CREATE DATABASE jalicare_synthetic_test via node-postgres (no psql in the npm package)
SQL_HOST=127.0.0.1 SQL_PORT=55432 SQL_DB_NAME=jalicare_synthetic_test \
SQL_ADMIN_USER=<redacted> SQL_ADMIN_PASSWORD=<redacted> npx drizzle-kit migrate   # 90/90, exit 0

# --- F. Verification ---
npx tsc --noEmit                                                                  # exit 0
npx eslint .                                                                      # 0 errors, 102 warnings
npm run format:check                                                              # clean (check only)
SQL_HOST=… JALICARE_REQUIRE_DB=1 JALICARE_TEST_PG_SYSTEM_IDENTIFIER=7707584137819502262 \
  npx vitest run                                                                  # 2673 passed / 287 files
env -u SQL_HOST -u SQL_PORT -u SQL_DB_NAME -u JALICARE_REQUIRE_DB npx vitest run   # 1902 passed / 771 skipped
npx vitest run src/tests/schema-extraction.spec.ts src/tests/schema-sha-claims.spec.ts \
  src/tests/schema-private-insurance.spec.ts                                      # 119 passed

# --- G. Historical failure reconstruction (throwaway directory only) ---
cp -a /tmp/verify_r2 /tmp/g_repro
git show 4cdbc93:src/tests/support/schema-contract.ts > /tmp/g_repro/src/tests/support/schema-contract.ts
cd /tmp/g_repro && npx vitest run src/tests/schema-extraction.spec.ts \
  src/tests/schema-sha-claims.spec.ts src/tests/schema-private-insurance.spec.ts   # 4 failed / 115 passed
```

### What this task did not do

No `git reset --hard`, no `git clean`, no `git checkout .`, no branch switch, no rebase, no amend, no force-push, no stage, no commit, no push. No formatter was run in write mode. No existing file was modified, renamed or deleted. No migration was applied anywhere except the disposable cluster created for this task. `.git/index` and HEAD are exactly as found: `git diff --cached` is empty and `git status --porcelain` returns the same 1,018 entries it returned at the start, **plus this one report** (645 → 646 collapsed, 1,018 → 1,019 with `-uall`, 1,226 → 1,227 files on disk). The only file created inside the repository is this report.

---

*End of report.*
