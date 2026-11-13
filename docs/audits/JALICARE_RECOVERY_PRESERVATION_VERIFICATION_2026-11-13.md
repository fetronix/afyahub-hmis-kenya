# JaliCare HMIS — Recovery, Preservation and Verification Baseline

**Date:** 2026-11-13 (captured 08:07:12Z, finished 08:25Z)
**Branch:** `arena/e088f11d-afyahub-hmis-kenya`
**Scope:** preservation, reconciliation and verification only.

**Nothing was committed, pushed, reverted, cleaned or overwritten.** No application file was
modified. `package.json` and `package-lock.json` are byte-identical to capture time (verified by
SHA-256 before and after the dependency installs). The only new file inside the repository is this
report.

---

## 1. Preservation verification and hashes

### 1.1 What was preserved, and where

`/home/user/jalicare-preservation-2026-11-13/` — outside the repository, inside the workspace.

| Artifact | Contents | Size | SHA-256 |
| --- | --- | --- | --- |
| `tree.tar.gz` | Complete working tree, `.git` excluded — **1,225 files** | 15 MB | `57c2623761a2705127cb10c15ac4ce1bd2cc1765804c7cc1c46d3e2c0065da73` |
| `git/repo-all-refs.bundle` | Every ref this clone holds (`HEAD`, `main`, `origin/main`, `origin/arena/…`) | 20 MB | `git bundle verify` → *"The bundle records a complete history."* |
| `git/tracked-working-tree.patch` | `git diff --binary HEAD` — 149 modifications **and** the 1 deletion (150 `diff --git` headers) | 2.5 MB | — |
| `git/status-porcelain.txt` | `git status --porcelain=v1 -uall` | 47 KB | — |
| `git/index-ls-files-s.txt` | Index state: 359 tracked paths + blob IDs | 30 KB | — |
| `manifests/source-tree-sha256.txt` | Per-file SHA-256 of all 1,225 source files at capture | 130 KB | — |
| `manifests/tar-extracted-sha256.txt` | Per-file SHA-256 **recomputed from a fresh extraction** | 130 KB | — |
| `manifests/differing-11.sha256`, `local-only-8.sha256` | The exact divergences | — | — |

The expanded copy directory was used for the first verification pass and then removed to keep the
workspace within its artifact budget; `tree.tar.gz` plus the per-file manifests is the canonical
copy, and it was re-verified **after** that deletion.

### 1.2 Verification actually performed (four independent passes)

| # | Check | Result |
| --- | --- | --- |
| 1 | `sha256sum` manifest of the source tree (1,225 files, `.git` excluded) | written |
| 2 | Same manifest over the extracted copy directory | **1,225/1,225 identical** |
| 3 | `tree.tar.gz` extracted to `/tmp` and re-hashed | **1,225/1,225 identical** |
| 4 | Extraction repeated **after deleting** the expanded copy | **1,225/1,225 identical** |
| 5 | `sha256sum -c manifests/tree.tar.gz.sha256` | **OK** |
| 6 | `git bundle verify` | complete history, all 4 refs listed |

### 1.3 Why the copy rather than a stash

A stash would have been insufficient for four concrete reasons found during inspection:

1. **867 untracked files** (494 untracked entries) carry most of the product in this clone.
   `git stash` without `-u` ignores them; with `-u` it still stores them inside `.git`, which is
   exactly what a sandbox reset discards.
2. **10 of the 11 published-path divergences are untracked files** — they are not in the index at
   all, so no git-native operation treats them as content to protect.
3. The deleted path is a **0-byte file** whose content (`e69de29`) carries no information; only the
   *fact* of the deletion matters, and that is recorded in the patch and in the status capture.
4. Local object storage does not contain the 50 published commits until they are fetched — a bundle
   is what makes the metadata recoverable.

### 1.4 Preservation of the specific unpublished work

The eight files that exist **only on disk** (`manifests/local-only-8.sha256`):

```
c2033ca17e545406f071ac9bb51263cb0302d4cdd3c7e09d4342284dfdde93e2  docs/PHASE_A3_CHECKPOINT.md
a4dcf5edfe7a21ce68fdfe81fbfbb75bdfb5236fa0e1c41ffeee54285ea5603b  docs/audits/SYRONA_REQUIREMENTS_GAP_ASSESSMENT_2026-11-13.md
4aef93071645f50417a930a094f58b8e70aab3130acb425a5b6a00ef25975d6f  drizzle/0088_claim_invoice_finalization.sql
0f9adfe47c0293500aeb88cb8c5eccca6f3bf287bd4ff382deabdee4bbe1e60d  drizzle/0089_facility_letterheads.sql
9531aa5e603aa8bed4169386a4b1b9edb7a190ecf5d31e4eae727833a56bfe83  src/accounting/source-ledger-coverage.service.ts
d8d78ed9c135e584ec757ff873973ff1da0c72b273aa04a02e4c13125f037373  src/db/schema/facility-branding.ts
cacc6377007a6c7bb84c1a4d92389537ac87a509cd91c03eae63fd2792aaee8a  src/insurance/core/claim-invoice-gate.ts
cca305cce1f5ded19774d223bf1c33f23378685e7c2e0a6a088a44fb577c813a  src/tests/vitest/source-ledger-coverage-ui.spec.tsx
```

---

## 2. Current Git state

| Item | Value |
| --- | --- |
| Branch | `arena/e088f11d-afyahub-hmis-kenya` |
| Local `HEAD` | `0111b55` — *docs: record what shipped after the engineering report was written* (2026-10-26 20:37:53 +0000) |
| Published remote head | `4cdbc93` — *merge: publish the verified tree over the branch's earlier commits* (2026-11-13 06:27:01 +0000) |
| Relationship | **`HEAD` is an ancestor of the remote.** 0 commits ahead, 50 behind. Merge-base = `0111b55`. |
| Reflog | 2 entries: `clone` → `63903c5`; `checkout` `main` → this branch. |

**There is no divergence in history — only distance.** This is the single most important structural
fact in this report: the local branch is an old point on the same line, not a fork. Reconciliation is
therefore *forward-only*; nothing needs to be merged or rebased.

### 2.1 Working-tree status (exact)

| Category | Count |
| --- | --- |
| Modified tracked files (` M`) | **149** |
| Deleted tracked file (` D`) | **1** — `src/tests/auth-api.test.ts` |
| Untracked entries (`??`, directories collapsed) | **494** |
| Untracked **files** (`-uall`) | **867** |
| Staged changes | **0** |
| Ignored files present | 0 at capture |

Full lists: `git/modified.txt` (149), `git/deleted.txt` (1), `git/untracked.txt` (867),
`git/status-porcelain.txt`.

### 2.2 The deleted file is not a loss

`src/tests/auth-api.test.ts` is the **empty blob** `e69de29` (0 bytes) in `HEAD`. The published
branch deleted it in `28def7a` (*test: cover the new workflows with HTTP, database and contract
specs*), and it is absent from the published tree. The local deletion therefore **matches the
published branch**. It is an artefact of a stale index, not deleted work.

### 2.3 What the 149 "modifications" really are

Because `HEAD` is 50 commits behind, most tracked files in `HEAD` are older than the published ones,
and the tree on disk already holds the published content. Measured per file:

| Classification | Count |
| --- | --- |
| Modified vs `HEAD` **but byte-identical to the published blob** | **148** |
| Modified vs `HEAD` **and different from the published blob** | **1** — `drizzle/meta/_journal.json` |

So among tracked files, **exactly one** carries local divergence: the journal.

### 2.4 Why `git diff` against the remote looks catastrophic

`git diff origin/… -- .` reports `860 files changed, 14 insertions(+), 265,312 deletions(-)`.
That is an artefact, not evidence of loss: `git diff` compares the **index**, and 849 published
files are untracked in this clone. They are present and correct on disk; git simply cannot see them.
The blob audit in §3 is the truthful comparison.

---

## 3. Exact reconciliation findings

### 3.1 Whole-tree reconciliation against the published tree `4cdbc93`

| Category | Count | Meaning |
| --- | --- | --- |
| Blobs in the published tree | **1,217** | total files published |
| Present and **byte-identical** | **1,206** | 357 tracked + 849 untracked-on-disk |
| Present but **differing** | **11** | §3.2 |
| **Absent from disk** | **0** | nothing published is missing locally |
| **Local-only** (on disk, not published) | **8** | §1.4 |
| Total files on disk | 1,225 | 1,217 + 8 ✓ |

Cross-check of the untracked set: 867 = 849 identical + 10 differing + 8 local-only. ✓

**Conclusion: no published file is missing, and no published file has been overwritten with older
content except in the two specs analysed in §3.3 — where the local copy is a deliberate, coherent
rewrite, not a stale revert.**

### 3.2 The eleven differing files

Direction was established per file by three tests: line-diff against the published blob, presence of
the local blob in the published history, and the nature of the changed hunks. `+/-` counts are lines
added / removed relative to the published version.

| # | File | Git state | Local vs published | Verdict | Proposed resolution |
| --- | --- | --- | --- | --- | --- |
| 1 | `drizzle/meta/_journal.json` | tracked ` M` | 622 → 636 lines, **+14 / −0** | Local is a strict superset: appends journal entries idx 88 (`0088_claim_invoice_finalization`) and idx 89 (`0089_facility_letterheads`) | Keep. Publish together with migrations 0088/0089. |
| 2 | `src/api/client-sprint.client.ts` | untracked | 388 → 422, **+34 / −0** | Superset: adds `SourceLedgerCoverage` interface + `sourceLedgerCoverage(...)` client (A4) | Keep. |
| 3 | `src/components/modules/AccountingModule.tsx` | untracked | 856 → 973, **+117 / −0** | Superset: source-ledger coverage panel (A4) | Keep. |
| 4 | `src/db/schema/private-insurance.ts` | untracked | 280 → 283, **+3 / −0** | Superset: `invoiceFinalizedAt`, `invoiceSnapshot` + comment (0088) | Keep. |
| 5 | `src/db/schema/sha-claims.ts` | untracked | 248 → 256, **+8 / −0** | Superset: same two columns + rationale comment | Keep. |
| 6 | `src/insurance/claims/private-claims.service.ts` | untracked | 2189 → 2219, **+30 / −0** | Superset: imports the gate, records the frozen invoice basis | Keep. |
| 7 | `src/insurance/eclaims/claims-workflow.service.ts` | untracked | 2099 → 2130, **+31 / −0** | Superset: same, SHA path | Keep. |
| 8 | `src/routes/accounting.routes.ts` | untracked | 702 → 747, **+45 / −0** | Superset: `GET …/source-ledger-coverage` route | Keep. |
| 9 | `src/tests/integration/billing-posting.db.spec.ts` | untracked | 1806 → 2085, **+279 / −0** | Superset: additional coverage | Keep. |
| 10 | `src/tests/vitest/private-insurance.db.spec.ts` | untracked | 1179 → 1338, **+168 / −9** | **Both sides changed** — see §3.3 | Keep; the removals are replaced assertions. |
| 11 | `src/tests/vitest/sha-eclaims.db.spec.ts` | untracked | 1448 → 1672, **+250 / −26** | **Both sides changed** — see §3.3 | Keep; same reasoning. |

Nine of eleven are pure additions. No file in the published tree is newer than its local
counterpart, and no local file reverts a published improvement.

### 3.3 The only two files where content was removed — and why it is not loss

Both are tests whose *assertions were deliberately inverted* by the unpublished A3 claim gate. The
removed lines assert behaviour that the new gate makes impossible.

**`private-insurance.db.spec.ts`** removes the "invoice changed under a pending claim" probe:

```diff
- await lockClient.query(
-   `UPDATE billing_items SET description='Synthetic changed consultation' WHERE invoice_id=$1`,
-   [splitInvoice.id]);
- expect(await pending).toMatchObject({ code: 'INVOICE_CHANGED' });
+ const tamperError = await lockClient.query(`UPDATE billing_items SET …`).then(()=>null, e=>e);
+ expect(tamperError?.message).toMatch(/finalized invoice/i);
+ expect(await pending).toBeNull();
```

The comment left by the author states the reasoning: finalized lines are immutable, so the write is
*refused outright* — "stronger than the old `INVOICE_CHANGED` detection, which fired only after the
invoice had already moved."

**`sha-eclaims.db.spec.ts`** removes three probes that corrupted `unit_price`/`quantity` and then
expected `FINANCIAL_REVIEW_REQUIRED` from claim preparation, replacing them with assertions that the
database itself refuses the writes and that the line is unchanged afterwards.

These rewrites are consistent with the implementation and **pass on PostgreSQL 16** (§6.4). They are
local-ahead, not stale.

### 3.4 Unfinished changes (this is where the risk is)

| Item | State | Why it is unfinished |
| --- | --- | --- |
| `drizzle/0089_facility_letterheads.sql` | Complete and **behaviourally verified** on PG16 (§4.3) | No service, no route, no UI, no test |
| `src/db/schema/facility-branding.ts` | Written | **Orphan**: not exported from `src/db/schema.ts` and imported by nothing. `billing_invoice_finalizations.letterhead_id` (added by 0089) is missing from `src/db/schema/billing.ts` |
| Schema-contract baseline | Not updated | 4 tests fail (§5) |
| `operations-status.db.spec.ts` | Not updated | Hardcodes 88 migrations; journal now has 90 (§6.4) |
| 2 published claim-prep specs | Not updated | Now fail on the A3 gate (§6.4) |

### 3.5 Files that conflict with a *newer published implementation*

**None.** The direction is uniformly the other way: the local tree is ahead of the published tree at
every path. The conflicts that do exist run the opposite way — the local work makes **three
published tests** fail (§6.4). Those are reconciliation obligations, not stale-local reverts, and
they are listed with proposed resolutions in §6.5.

---

## 4. Migration consistency findings

### 4.1 Journal ↔ files ↔ schema

| Check | Result |
| --- | --- |
| `.sql` files in `drizzle/` | **90** |
| Journal entries in `drizzle/meta/_journal.json` | **90** |
| Entries with idx contiguous `0…89` | **yes** |
| Journal tags missing a `.sql` file | **0** |
| `.sql` files missing a journal entry | **0** |
| Published tree for comparison | 88 entries / 88 files — 0088 and 0089 are **unpublished** |
| Meta snapshots present | only `0000`–`0003`, `0005`, `0006` → migrations are **hand-written**, not produced by `drizzle-kit generate` |

The last row matters: because snapshots stopped at 0006, no generator will reconcile the TypeScript
schema with the SQL. Any TS↔SQL drift below is permanent documentation drift unless fixed by hand.

### 4.2 Migration 0088 — consistent, verified

| Aspect | SQL | TypeScript | Verdict |
| --- | --- | --- | --- |
| `sha_eclaims.invoice_finalized_at` | `timestamp`, nullable | `timestamp('invoice_finalized_at')` nullable | ✅ match |
| `sha_eclaims.invoice_snapshot` | `jsonb`, nullable | `jsonb('invoice_snapshot').$type<Record<string, unknown>>()` | ✅ match |
| `private_insurance_claims.*` | same two columns | same | ✅ match |
| Both-or-neither CHECK | `sha_eclaims_invoice_basis_complete`, `private_insurance_claims_invoice_basis_complete` | **not declared** | ⚠ drift (harmless to the tests; the constraint lives only in SQL) |
| Backfill | none, deliberately (historical rows stay NULL as "unverifiable basis") | — | ✅ documented |

Verified behaviourally on PostgreSQL 16.15 (§4.3): both consistent combinations are accepted, both
inconsistent combinations are refused, on both tables.

### 4.3 Migration 0089 — SQL sound, TypeScript incomplete and unwired

Applied cleanly and **proven to enforce**, not merely to exist. Behavioural tests on a disposable
database inside savepoints:

| Expectation | Result |
| --- | --- |
| Edit `header_text` after upload | **REFUSED** — *Uploaded letterhead content is immutable* |
| Delete a letterhead version | **REFUSED** — *Letterhead versions are retained for reprint fidelity* |
| `DRAFT` carrying `activated_at` | **REFUSED** — `facility_letterhead_status_chk` |
| No logo, no text, no colour | **REFUSED** — `facility_letterhead_content_chk` |
| Accent colour not `#rrggbb` | **REFUSED** — `facility_letterhead_accent_chk` |
| GIF logo | **REFUSED** — `facility_letterhead_logo_pair_chk` |
| `UPDATE` / `DELETE` a letterhead event | **REFUSED** — *Letterhead activation history is append-only* |
| `INSERT` a letterhead event | allowed (correct) |
| Activate → supersede → create next ACTIVE | allowed (correct lifecycle) |
| Second `ACTIVE` for the same facility | **REFUSED** — unique index `facility_letterheads_active_unique` |

Schema drift between `0089` and `src/db/schema/facility-branding.ts`:

| # | Database (0089) | TypeScript | Impact |
| --- | --- | --- | --- |
| 1 | `id serial` (`nextval('facility_letterheads_id_seq')`, `is_identity = NO`) | `generatedAlwaysAsIdentity()` | **Mismatch.** The TS claims identity where the database has a sequence. Explicit-id inserts would behave differently from what the TS declares. |
| 2 | Constraint `facility_letterhead_version_unique` (singular **letterhead**) | `uniqueIndex('facility_letterheads_version_unique')` (plural **letterheads**) | **Name mismatch** — two different names for one intent; a generated migration would create a duplicate index. |
| 3 | 7 CHECK constraints on `facility_letterheads` (5 named + 2 auto-named inline) | **none declared** | Drift; the invariants exist only in SQL |
| 4 | Composite FKs `(facility_id, tenant_id) → facilities(id, tenant_id)` on both tables | single-column FKs only | Drift |
| 5 | `billing_invoice_finalizations.letterhead_id integer` + guard trigger | **absent from `src/db/schema/billing.ts`** | TS cannot read or write the column |
| 6 | Module not exported from the barrel | `src/db/schema/facility-branding.ts` is an orphan | Nothing can import it from `schema.ts` |

**Verdict: 0088 is consistent and shippable. 0089 is sound at the database layer but unfinished above
it** — schema not exported, `letterhead_id` unmodelled, no service/route/UI/test. Publishing 0089 now
would add a verified table plus an unreadable column and a dead module.

Requirement-level note: `FOREIGN KEY (facility_id, tenant_id) REFERENCES facilities(id, tenant_id)`
depends on `facilities_id_tenant_unique_idx`, created in `0027`. Confirmed present, so 0089 resolves.

---

## 5. The four schema-contract failures explained

### 5.1 What fails

| File | Test |
| --- | --- |
| `src/tests/schema-extraction.spec.ts` | `shaEclaims keeps its table metadata` |
| `src/tests/schema-extraction.spec.ts` | `privateInsuranceClaims keeps its table metadata` |
| `src/tests/schema-sha-claims.spec.ts` | `shaEclaims retains its pre-extraction metadata` |
| `src/tests/schema-private-insurance.spec.ts` | `privateInsuranceClaims retains its pre-extraction metadata` |

### 5.2 Why

The harness (`src/tests/support/schema-module-contract.ts`) compares each table's live Drizzle
metadata against a frozen fixture, `src/tests/fixtures/schema-contract-before-extraction.json`,
after passing it through `contractWithReviewedAdditions(name, original)` in
`src/tests/support/schema-contract.ts`.

`contractWithReviewedAdditions` is the mechanism the project uses for **reviewed additive
migrations**: the fixture stays frozen, and each intentional change is declared, with a comment,
next to the migration it belongs to. It already declares additions for `dialysisTreatmentPlans`,
`facilities`, `fixedAssets`, `insuranceBenefitValidations`, `insurancePayerEnvironmentConfigs`,
`facilityPaymentSecrets`, `supplierInvoices`, and — for these two tables — migration 0087's
`dispatch_revision`.

Measured by diffing the actual contract against `contractWithReviewedAdditions`:

| Table | Columns (actual vs reviewed) | Difference |
| --- | --- | --- |
| `shaEclaims` | 54 vs 52 | exactly `invoice_finalized_at`, `invoice_snapshot` |
| `privateInsuranceClaims` | 51 vs 49 | exactly the same two |

Column-level comparison of all shared columns, index lists, foreign keys, checks and unique
constraints: **zero differences**. The failure is precisely the two columns added by migration 0088,
and nothing else.

### 5.3 The correct baseline update (proposed — not applied)

**Do not edit `schema-contract-before-extraction.json`.** The fixture is deliberately a
"before extraction" record; editing it would destroy the regression this suite exists to provide,
and it would silently bless any future schema change.

Instead, extend the existing branch at the end of `contractWithReviewedAdditions`
(`src/tests/support/schema-contract.ts`, the block beginning
`if (name !== 'shaEclaims' && name !== 'privateInsuranceClaims') return original;`) so that, in
addition to splicing `dispatch_revision` after `status`, it splices the 0088 pair after `invoice_id`:

```ts
/* Migration 0088: a claim records the frozen invoice it was prepared from.
   Both columns are nullable by design — historical claims stay NULL and are
   reported as an unverifiable basis rather than backfilled. */
const invoiceIndex = expected.columns.findIndex((c) => c.name === 'invoice_id');
if (invoiceIndex < 0) throw new Error('Expected historical invoice_id column not found');
expected.columns.splice(invoiceIndex + 1, 0,
  { name: 'invoice_finalized_at', type: 'timestamp', notNull: false, primary: false,
    hasDefault: false, default: null, unique: false, uniqueName: null },
  { name: 'invoice_snapshot', type: 'jsonb', notNull: false, primary: false,
    hasDefault: false, default: null, unique: false, uniqueName: null });
```

Two cautions for whoever applies it:

1. **Compute both insertion indices before mutating the array** (or insert the higher index first).
   `dispatch_revision` is spliced after `status`, so splicing it first shifts every later index and
   `invoice_id` must be located on the already-mutated array.
2. The expected column types are `timestamp` and `jsonb` (Drizzle's `getSQLType()` output), **not**
   `timestamp without time zone` (the `information_schema` spelling). `notNull: false`,
   `hasDefault: false`, `default: null`, `unique: false`, `uniqueName: null`.

Acceptance: the four tests pass, and no other test changes state.

**Why not simply regenerate the fixture?** Because it is named *before-extraction* and is the only
record of the pre-extraction shape; `contractWithReviewedAdditions` exists precisely so that this
file never needs to move. The project has used this pattern for nine tables already.

---

## 6. PostgreSQL test readiness and results

### 6.1 The limitation from the previous assessment is now removed

No PostgreSQL and no Docker existed at assessment time. Docker is still absent, but **PostgreSQL 16
can be provisioned safely**, and was:

| Step | Detail |
| --- | --- |
| Source of binaries | `embedded-postgres@16.15.0-beta.19` from the npm registry (`@embedded-postgres/linux-x64`) — installed into **`/home/user/pgtool`**, a throwaway prefix, so the repository's dependency tree stayed exactly as locked |
| Version | `postgres (PostgreSQL) 16.15` — matches the `postgres:16` service used by CI |
| Cluster | `initdb -U jalicare_test --auth=trust`, data dir `/home/user/pgtest16` — **outside the repository** |
| Network | `listen_addresses=127.0.0.1`, port **55432**, unix socket `/tmp` — loopback only, no external exposure |
| Databases | `jalicare_migrate_test`, `jalicare_synthetic_test`, `jalicare_test2` — all disposable, all created for this task |
| Safety | `fsync=off`, `full_page_writes=off` (throwaway cluster). **No production database was touched**; none exists or was contacted. |
| Dependency discipline | `package.json` / `package-lock.json` SHA-256 verified identical before and after (\`861f96ba…\`, \`bfd2371e…\`). A first attempt with `npm install --no-save` re-resolved 95 packages; it was reverted with `npm ci` so the tree matches the lock exactly (drizzle-kit 0.31.11, drizzle-orm 0.45.3, vitest 5.0.5, pg 8.23.1). |

### 6.2 Migrations applied to a disposable database

```
SQL_DB_NAME=jalicare_migrate_test npx drizzle-kit migrate
→ [✓] migrations applied successfully!

journal rows applied ........... 90
public tables .................. 235
```

Verified in the resulting schema:

- `sha_eclaims` / `private_insurance_claims`: `invoice_finalized_at` (`timestamp`), `invoice_snapshot`
  (`jsonb`), both nullable — plus both `*_invoice_basis_complete` CHECK constraints.
- `facility_letterheads` (21 columns), `facility_letterhead_events`, both composite FKs,
  `facility_letterheads_active_unique` partial unique index, and all three guard triggers.
- `billing_invoice_finalizations.letterhead_id` (`integer`, nullable).

### 6.3 Migration ordering is safe from the published state

0088 and 0089 are strictly additive:

- `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` before
  `ADD CONSTRAINT`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`.
- No `ALTER … DROP COLUMN`, no data rewrite, no backfill.
- Re-running `drizzle-kit migrate` on an already-migrated database is a no-op (journal is keyed by
  hash and timestamp; 90 rows applied once).

A facility database at the published 88 migrations will therefore receive 0088 and 0089 and nothing
else. The one thing that is *not* automatically safe is the published test that pins the count at 88
(§6.4).

### 6.4 Test results with PostgreSQL available

Full suite, `JALICARE_REQUIRE_DB=1`, one disposable database, 7 min 16 s:

```
Test Files  6 failed | 199 passed | 13 skipped (works out to 728 suites)
     Tests  7 failed | 2653 passed | 13 skipped (2673)
```

The 13 "skipped" were one file, `report-centre-diagnoses.db.spec.ts`, which refuses to run without
an independently attested cluster identifier. Supplying it
(`JALICARE_TEST_PG_SYSTEM_IDENTIFIER=7707565714601635529`, read from `pg_control_system()`) makes
that file **13/13 pass**. So the effective totals are **2,666 passed / 7 failed / 0 skipped**.

**The 7 failures, all explained:**

| # | Test | Cause | Nature |
| --- | --- | --- | --- |
| 1–4 | the four schema-contract tests | 0088 adds two columns the reviewed-additions baseline does not declare | Test drift — fix in §5.3 |
| 5 | `operations-status.db.spec.ts` → *compares the applied migrations with the packaged journal* | asserts `expectedMigrations`/`appliedMigrations === 88` (`:321–322`); the journal now has 90 | Published test pinned to a count |
| 6 | `inpatient-bed-billing.db.spec.ts` → *does not infer SHA or private payer codes…* | `PrivateInsuranceError: Invoice INV-000010 is not finalized…` from `claim-invoice-gate.ts:69` | Unpublished A3 gate vs published spec |
| 7 | `pharmacy-inventory-billing.db.spec.ts` → *keeps SHA and private payer lines unmapped…* | same error, invoice INV-000063 | Unpublished A3 gate vs published spec |

Failures 5–7 are **not regressions in behaviour** — they are published tests that the unpublished
work has overtaken. All three spec files are byte-identical to the published tree (verified by blob
hash). On the published branch they pass; with this working tree they do not.

### 6.5 The unpublished work itself passes on real PostgreSQL 16

| Spec (unpublished or newly diverged) | Result |
| --- | --- |
| `src/tests/vitest/sha-eclaims.db.spec.ts` | **2 / 2 passed** |
| `src/tests/vitest/private-insurance.db.spec.ts` | **1 / 1 passed** |
| `src/tests/vitest/source-ledger-coverage-ui.spec.tsx` | **4 / 4 passed** |
| `src/tests/integration/billing-posting.db.spec.ts` | **16 / 16 passed** |
| `src/tests/integration/finalized-invoices.db.spec.ts` | **10 / 10 passed** |
| `src/tests/integration/claim-dispatch-reconciliation.db.spec.ts` | **11 / 11 passed** |
| `src/tests/vitest/migrations.db.spec.ts` | **6 / 6 passed** |
| `src/tests/integration/backup-restore.db.spec.ts` | **5 / 5 passed** |
| `src/tests/vitest/route-inventory.spec.ts` | **27 / 27 passed** |

This converts the previous assessment's "not executed here" into executed evidence: the A3
claim-invoice gate, migration 0088, the A4 source-ledger coverage work and the rewritten claim specs
all work against a real PG16 database at 90 migrations.

### 6.6 Proposed resolutions for the three published tests (not applied)

| # | File | Proposed change | Rationale |
| --- | --- | --- | --- |
| 5 | `src/tests/integration/operations-status.db.spec.ts:321-322` | Replace the literals `88` with the packaged journal length, read from `drizzle/meta/_journal.json` (the endpoint already exposes `expectedMigrations`; the test should compare the two rather than pin a number) | A hardcoded migration count fails on every future migration. Compare `appliedMigrations === expectedMigrations` and assert `upToDate === true`; that is what the test name claims to check. |
| 6 | `src/tests/integration/inpatient-bed-billing.db.spec.ts` (the *does not infer…* case) | Finalize the invoice through the supported path before preparing the claim — the same adjustment the author already made in `sha-eclaims.db.spec.ts` and `private-insurance.db.spec.ts` | The A3 rule is that claims cite a finalized invoice; a spec preparing a claim from a draft is now testing an impossible path. The *mapping* assertion it exists for (no payer code inferred from a bed number) is unaffected once finalization is added. |
| 7 | `src/tests/integration/pharmacy-inventory-billing.db.spec.ts` (the *keeps … unmapped* case) | Same: finalize first, then assert the line stays unmapped | Same reasoning |

None of these were applied. Each is a test-only change; none alters application behaviour.

---

## 7. Remaining risks

Ordered by consequence.

1. **The only copy problem is solved, but the only *published* copy is 50 commits behind the disk.**
   Eight files exist solely on this machine. Until they are committed and pushed, a sandbox reset
   loses the claim gate, the source-ledger coverage work and the letterhead schema entirely. The
   preservation archive mitigates this; it does not replace publishing.

2. **0089 is half-built and would be published as dead weight.** The table, triggers and constraints
   are verified, but the module is not exported, `billing_invoice_finalizations.letterhead_id` is
   unmodelled in TypeScript, and there is no service, route, UI or test. Publishing it now is safe
   for the database but leaves an unreachable capability and six documentation drifts.

3. **Three published tests are currently red because of unpublished work.** Anyone who reads CI on
   this branch sees red for reasons that are not obvious. The three fixes are small and test-only,
   but they must land in the same change as the work that caused them, or the tree stays dishonest.

4. **`drizzle/meta` snapshots stopped at 0006 but there are 90 migrations.** The TypeScript schema is
   hand-maintained and nothing reconciles it against the SQL. Drift such as the `serial` vs
   *identity* mismatch in 0089 will not be caught automatically.

5. **The 4 schema-contract failures will silently bless future changes if "fixed" wrongly.** Editing
   the fixture is the tempting one-line fix and it would disable the guard permanently.

6. **Test coverage of the *published* branch itself is now known to depend on PostgreSQL.** 771 tests
   were skipped in the previous assessment; they are not decorative — 3 of them fail. Any future
   assessment that skips the database will again under-report.

7. **The preservation copy is unverified as a *build*.** It proves content identity, not that the
   code compiles from it or that a restored checkout runs. `tsc`/`eslint`/vitest were run against the
   live tree, not the archive.

8. **Workspace budget.** The PG data directory grew to 188 MB and was removed at the end of the task
   (§9). Re-creating it takes about 30 seconds; the commands are recorded.

---

## 8. Recommended next implementation task

**Reconcile the unpublished work into a green, publishable state — no new features.**

This is the natural continuation and it is explicitly *not* letterhead, receipts, invoices or any
other feature. Three steps, in order:

| Step | Work | Done when |
| --- | --- | --- |
| 1 | Extend `contractWithReviewedAdditions` for the 0088 columns (§5.3) | the 4 schema-contract tests pass; the fixture is untouched |
| 2 | Make the three published tests consistent with the unpublished work (§6.6): journal-length comparison, and finalize-before-claim in the two published specs | full suite green with `JALICARE_REQUIRE_DB=1` |
| 3 | Decide 0089's fate before publishing: either finish the wiring (export from `schema.ts`, add `letterheadId` to `billing.ts`, align `serial`/identity and the index name) or split the migration out of the commit | the journal, the schema modules and `billing.ts` agree |

Then, and only then, the P0 document work from the requirements assessment (letterhead → receipt →
invoice PDF → LPO/GRN) starts from a clean baseline rather than a red one.

Two things should happen alongside step 1–3, because they cost nothing now and prevent the next
recovery exercise: commit the 8 local-only files, and push. The branch is behind by 50 commits with a
clean ancestry; the push is fast-forward, not a merge.

---

## 9. Reconciliation applied (2026-11-13)

The three steps of §8 were executed the same day on the same branch, against a freshly provisioned
PostgreSQL 16.15 (`/home/user/pgtest16`, port 55432, `system_identifier` `7707573350905521548`,
90/90 migrations). No feature work, no production migration, no rewrite of published history.

### 9.1 What changed

| # | File | Change |
| --- | --- | --- |
| 1 | `src/tests/support/schema-contract.ts` | `contractWithReviewedAdditions` splices `invoice_finalized_at` (`timestamp`) and `invoice_snapshot` (`jsonb`) into `billing_invoice_finalizations`, both nullable with no default; both insertion indices are computed before either mutation |
| 2 | `src/tests/integration/operations-status.db.spec.ts` | asserts `readJournal().length` (read at run time) instead of the literal `88` |
| 3 | `src/tests/integration/inpatient-bed-billing.db.spec.ts` | the claim-preparation test now records facility MFL / address / county / contact, a ward department and an attending clinician, then finalizes the invoice before `preparePrivateInsuranceClaim` |
| 4 | `src/tests/integration/pharmacy-inventory-billing.db.spec.ts` | same ordering fix on the SHA path: finalize, then prepare the claim |
| 5 | `src/db/schema/facility-branding.ts` | `serial('id').primaryKey()` on both tables (matching the other 227 serial primary keys, of which identity was the outlier); version index renamed to `facility_letterhead_version_unique` |
| 6 | `src/db/schema/billing.ts` | `letterheadId` → `facility_letterheads.id` added to `billing_invoice_finalizations` |
| 7 | `src/db/schema.ts` | exports the facility-branding module |
| 8 | `src/tests/schema-extraction.spec.ts` | `facilityLetterheads` and `facilityLetterheadEvents` added to the required-export list |

The fixture `src/tests/fixtures/schema-contract-before-extraction.json` is byte-identical to the
published blob (sha256 `ce90a9c327dac943178b2500b7b70b797e754e1e4ea8b0d8fcafe9a19d476f70`), as §8
required.

Two further files — `src/insurance/claims/private-claims.service.ts` and
`src/insurance/eclaims/claims-workflow.service.ts` — were reformatted by Prettier (a wrapped import
collapsed onto one line). Both remain strict supersets of their published blobs (+27 / −0 and
+28 / −0), so the `format` CI job is not left red by work that predates this pass.

### 9.2 Verification

| Check | Result |
| --- | --- |
| Schema specs (`schema-extraction` + `schema-contract`) | **119 / 119 pass** |
| `operations-status.db.spec.ts` | **7 / 7 pass** |
| `inpatient-bed-billing.db.spec.ts` | **36 / 36 pass** |
| `pharmacy-inventory-billing.db.spec.ts` | **19 / 19 pass** |
| Full suite, `JALICARE_REQUIRE_DB=1` | **2,673 passed of 2,673, 287 files, 469 s, exit 0** |
| `npm run typecheck` | exit 0, no output |
| `npm run lint` | 0 errors, 102 warnings (unchanged baseline) |
| `npm run format:check` | clean |
| TS ↔ DB contract comparator | `facility_letterheads` 21/21 columns, `facility_letterhead_events` 9/9, `billing_invoice_finalizations` 11/11 — types, nullability and FK names all equal |

The comparator normalises `serial` to `integer` and `numeric(p,s)` to `numeric`, because
`information_schema` reports the unparameterised type. Without that, the first run "found" drift in
all three tables that did not exist.

### 9.3 Effect on the seven failures in §6

All seven are resolved by §9.1, and none needed a weakened gate. Four were the baseline helper's
staleness (§5.3), one was the journal-length literal (§6.6), and two were claim preparation being
attempted from an unfinalised invoice — refused by `claim-invoice-gate.ts`, exactly as designed.

---

## Appendix A — Inspection record (Task A)

- **Branch / HEAD / remote:** §2. Captured in `git/state.txt`, `git/refs.txt`, `git/remotes.txt`.
- **Modified (149) / deleted (1) / untracked (867 files):** `git/modified.txt`, `git/deleted.txt`,
  `git/untracked.txt`, `git/status-porcelain.txt`, `git/status-human.txt`, `git/index-ls-files-s.txt`.
- **The 11 differing files:** §3.2, plus `manifests/differing-11.sha256` (SHA-256 per file) and
  `git/diff-HEAD.patch` for the tracked delta.
- **Uncommitted migrations and their schema changes:**

  | Migration | Journal | Schema changes |
  | --- | --- | --- |
  | `drizzle/0088_claim_invoice_finalization.sql` (52 lines) | idx 88, `when` 1795228800000 | `sha-claims.ts` (+8), `private-insurance.ts` (+3); CHECK constraints exist only in SQL |
  | `drizzle/0089_facility_letterheads.sql` (197 lines) | idx 89, `when` 1795315200000 | `facility-branding.ts` (new, orphan); `billing_invoice_finalizations.letterhead_id` **not** in `billing.ts` |

- **Existing checkpoints and backups found in the repo:**

  | Path | What it is |
  | --- | --- |
  | `docs/PHASE_A3_CHECKPOINT.md` | The A3 checkpoint (unpublished). Records that embedded PG 16 was used on 127.0.0.1:55432 and that DBs were at 89 migrations — the direct precedent for §6 |
  | `docs/project/operations/BACKUP-RESTORE-RUNBOOK.md` | Operational backup/restore documentation |
  | `docs/project/recovery/PHASE-5-CHECKPOINT-LOSS.md` | A prior checkpoint-loss post-mortem |
  | `scripts/backup/*.mjs` (5 files) | `db:backup`, `db:verify`, `db:restore`, `db:restore:drill` |
  | `server.ts.phase2-backup` (42 KB) | Stray source backup at repo root |
  | `src/app.ts.patient-routes-backup` (42 KB) | Stray source backup inside `src/` |
  | `src/App.tsx.20261015-185445.fix-backup`, `src/components/Header.tsx.20261015-185445.fix-backup` | Stray UI backups |
  | `src/db/schema.ts.tariff-backup` (103 KB) | Stray schema backup |

  All of these are **inside** the repository and therefore inside the preservation archive. Note the
  four stray `*-backup` files inside `src/`: they are not `.ts`/`.tsx`, so they do not compile, but
  they are also not tracked and not referenced. They are cruft, not protection.

## Appendix B — Reproduction of the verification environment

```bash
# 1. PostgreSQL 16.15, isolated (outside the repo)
npm install --prefix /home/user/pgtool embedded-postgres@16.15.0-beta.19
PGBIN=/home/user/pgtool/node_modules/@embedded-postgres/linux-x64/native/bin
"$PGBIN/initdb" -D /home/user/pgtest16 -U jalicare_test --auth=trust -E UTF8 --locale=C
"$PGBIN/pg_ctl" -D /home/user/pgtest16 -l /tmp/pg16.log \
  -o "-p 55432 -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c fsync=off" -w start
node -e "…CREATE DATABASE jalicare_synthetic_test…"     # no psql is shipped by the npm package

# 2. Exact dependencies (manifest hashes must not change)
npm ci

# 3. Migrate a disposable database
SQL_HOST=127.0.0.1 SQL_PORT=55432 SQL_DB_NAME=jalicare_synthetic_test \
SQL_ADMIN_USER=jalicare_test SQL_ADMIN_PASSWORD=jalicare_test \
npx drizzle-kit migrate

# 4. Run the suite as CI does
SQL_HOST=127.0.0.1 SQL_PORT=55432 SQL_DB_NAME=jalicare_synthetic_test \
SQL_ADMIN_USER=jalicare_test SQL_ADMIN_PASSWORD=jalicare_test \
JALICARE_REQUIRE_DB=1 JALICARE_TEST_PG_SYSTEM_IDENTIFIER=<from pg_control_system()> \
npx vitest run
```

`pgtool` is a throwaway prefix: nothing in it is a project dependency, and the repository's lock file
was verified unchanged afterwards.

---

*This report was written as an assessment: at the time of writing, no commit, no push and no branch
change had been made, and the preservation archive was the only durable copy of the eight
unpublished files. **§9 records what happened next** — the reconciliation required by §8, executed
and published the same day.*
