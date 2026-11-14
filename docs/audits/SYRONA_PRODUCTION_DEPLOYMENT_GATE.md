# Syrona production deployment gate

## Decision: HOLD — production readiness not established

This is a production-preparation report, **not evidence of a production deployment**. No production database connection was attempted, migration applied, facility/currency/letterhead configuration changed, file uploaded, preview confirmed, or production CRUD/report operation performed in this task.

The request calls for explicit migration authorization and reviewed import confirmation. Those must be attached to an identified production target and scope. An example environment, a CSV facility title, a previous synthetic fixture or an instruction embedded in a runbook is not an authenticated production facility context.

## Current observations

- Current working branch: `arena/e088f11d-afyahub-hmis-kenya`.
- The supplied official CSV files and `LETTER HEAD.pdf` are available locally.
- `SQL_HOST`, `SQL_PORT`, `SQL_DB_NAME`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`, `SQL_SSL` and `APP_BASE_URL` are **unset** in this execution environment. Only `.env.example` is present; no production configuration was discovered.
- No production tenant/facility identifier, deployment URL, authenticated operator/reviewer session, active letterhead version, operational currency, target plan/version, backup reference or maintenance window has been established.
- Existing unrelated working-tree changes remain untouched. No Git staging, commit, push, reset, cleanup or branch switch was performed for this task.

### Verified upload identities

| File | SHA256 |
|---|---|
| Syrona_Stationery.csv | `244f9ba9bdd8f5a28793610cabfa8d931ecc76eff52b0fa553b11702e3f198e1` |
| Syrona_Branding.csv | `75f810a0265ad0e6a08d9efc1e43a6705591ae81ae0aa6c109466a605881797e` |
| LETTER HEAD.pdf | `7650930b5229cd57f58bda9788162b2f56967ba9a72e0aa1cdfa0256adb00ce0` |

Possession of the PDF does not prove it is the real facility's authorized active uploaded letterhead. Verify ownership, version and activation through the existing authenticated branding workflow before using it.

## Migration governance review

### Historical 0095

`drizzle/0095_budget_procurement_planning.sql` creates the planning tables, original name-based unique indexes, scoped foreign keys, immutable audit/report triggers, draft-only child guards and immutable plan scope/year controls.

The earlier migration-integrity run reported a `Guarded Ddl` failure because this migration uses unguarded `CREATE TABLE` statements. That is a repository governance finding, **not evidence that production is missing these tables**. Do not rewrite an already-applied migration, add fake tracking rows, force replay, or blindly re-run it to clear a test.

Before deciding whether 0095 may run, compare the production migration tracking rows and file hashes with the actual tables, indexes, functions and triggers. A partial/untracked installation or hash drift requires an explicitly reviewed recovery plan, not automatic replay.

### Prepared 0096

`drizzle/0096_planning_source_row_identity.sql` replaces the old active name-based indexes with:

- Active **manual** records: prior case-insensitive category/name/unit uniqueness (name/category for uniforms).
- Active **imported** records: unique `(plan_id, source_import_id, source_worksheet, source_row)` separately for monthly items and uniforms.

This is an **active-row partial uniqueness rule**, not uniqueness across archived/inactive rows. The schema/index change affects the database's planning tables globally, not only Syrona's rows.

Pre-application checks must cover all active imported rows that the indexes cover:

1. No duplicate composite source keys.
2. No missing source worksheet/row metadata on imported rows; PostgreSQL unique indexes permit null-key gaps, so index existence alone is insufficient proof of complete provenance.
3. Source imports, plans, categories and facility/tenant references are consistent.
4. No pre-existing same-name index has an unexpected definition. `IF NOT EXISTS` can skip an incorrect existing object; verify `pg_get_indexdef`, uniqueness, validity and predicates after application.
5. Approved backup/restore reference, deployment revision, DB target identity, maintenance window and lock-impact acceptance are recorded. This migration uses ordinary index DDL, not concurrent index creation; writes can be blocked while it runs.

The migration runner applies the pending set, not a user-selected single migration. **Do not execute a general apply command until the entire pending list equals the explicitly approved scope.** Other pending historical migrations require separate review and authorization.

### Read-only preflight, after the authorized target is securely configured

```sh
npx tsx scripts/migration-status.ts
npx tsx scripts/migrate.ts --dry-run
```

These commands were **not run against production here** because there is no configured target. Run them only from an authorized environment; do not paste credentials into chat or commit `.env` files. Their output and schema inspection must be reviewed before any apply operation. No production apply command has been executed or approved by this report.

## Facility, currency and letterhead gate

Verify, without trusting browser-supplied facility IDs:

- Production URL and deployed revision.
- Authenticated operator's tenant, facility and planning/branding/export permissions.
- Syrona's exact tenant/facility ID or facility code, verified against server-side scope.
- Planning year **2026** and the correct operational currency. The CSVs do not state currency; previous test fixtures used KES as a test setting only.
- The real facility's current active uploaded letterhead ID/version and a visual check of the rendered identity and body margins.

Do not change a tenant-wide/default currency or activate a letterhead merely to make a test pass. Record which setting is being changed and obtain approval for that specific mutation.

## Import confirmation gate

Source counts from the previous verified work are 232 stationery items (133 OPD, 40 Dental, 59 Stationery), 5 monthly branding items and 4 uniforms. The ZERO_FILL implementation supports all 241 as reviewed draft rows; that does not verify originally missing financial data.

Before confirming a production preview:

1. Choose the approved plan strategy: separate drafts, one new 2026 mixed draft, or a named existing draft with its current version. Never silently replace/archive an existing plan.
2. Upload the two matching-hash sources through the authenticated production application. Inspect existing facility upload history first; exact same-file uploads remain SHA256-deduplicated.
3. Review field/category/quantity mappings, `ZERO_FILL`, 5% inflation, facility, year and currency. Exclude titles and total footers from item ranges.
4. Review original/raw versus defaulted values. Earlier source tests recorded 2,187 mapped defaults in stationery and 64 in branding/uniform inputs.
5. Explicitly accept or resolve the difference between stationery source numeric-cost sum **260,380.50** and server recalculation **263,046.00** (+2,665.50). Branding monthly numeric sum is **22,365.00**. These amounts are not a currency confirmation.
6. Decide uniform treatment. Source HALF PAY FOR STAFF entries are amounts, not percentages. The earlier tests used zero staff/per-staff/opening inputs, an explicitly selected test balance rule, and an omitted contribution mapping displayed as 0%. Do not silently treat that as the real operational half-pay formula. Either approve clearly labelled zero-staff placeholders or keep these rows pending until the rule is established.
7. Obtain the actual server-generated preview/hash and explicit approval before confirmation. Record import batch IDs, plan IDs/version, normalization counts and confirmation audit IDs. A prior test preview/hash is not reusable in production.

Production import confirmation has **not** occurred.

## Operational verification and review workflow

After the preceding gates pass:

- Verify 2026 selection and correct facility context in all planning views.
- Confirm item counts, category grouping, twelve-month children, duplicate source rows and authoritative totals.
- Verify a scoped individual item read returns all twelve months even when the table is month-filtered.
- With explicit operational permission, use a dedicated validation draft/temporary test item for create, inline price/quantity update, stale-version rejection and audited soft deletion. Do not alter official rows merely to demonstrate deletion.
- Confirm unauthorized/wrong-facility access fails and no review/approved record becomes editable.
- Verify audit previous/new values, default evidence and source-import references.
- Generate PDF/Excel via the real facility's active letterhead workflow; inspect identity, filters, totals, multipage layout, pagination and margins. Verify authorized downloads, access isolation and reproducible historical re-downloads.
- Keep the official plan in DRAFT until the designated operational reviewer accepts the assumptions. The author and independent approver must follow existing roles and transitions; do not auto-approve as part of deployment.

No production operational verification or report generation has been performed in this task.

## Evidence status

| Gate | Current status |
|---|---|
| Source files present and hashes verified locally | PASS |
| Local review of migration intent and safeguards | COMPLETE; production schema unknown |
| Production target/configuration | BLOCKED — not supplied/configured |
| Explicit target-bound migration scope authorization | PENDING |
| Backup/maintenance/lock approval | PENDING |
| Production migration state and index definitions | UNVERIFIED |
| Production facility, currency and active letterhead | UNVERIFIED |
| Production ZERO_FILL preview and confirmation | NOT PERFORMED |
| Production CRUD/audit/year-filter workflow | NOT PERFORMED |
| Production PDF/Excel generation | NOT PERFORMED |
| Production readiness sign-off | **HOLD** |

Previous implementation evidence remains at `docs/audits/SYRONA_ZERO_FILL_CRUD_IMPLEMENTATION.md` and `docs/audits/syrona-zero-fill-evidence/`: 64 targeted tests, 27 authenticated browser checks, builds/typecheck, 97 disposable migrations and test reports. Those are **previous isolated-environment results**, not new executions or production acceptance. The separately documented historical 0095 migration-integrity failure remains unresolved; no test or authorization guard was weakened.

## Required operator response

Provide the production URL and exact tenant/facility ID or code (no passwords), and securely configure access in the authorized execution environment or choose an operator-run VS Code preflight. Confirm operational currency, letterhead ID/version or authorization to upload/activate the supplied PDF, plan strategy, uniform treatment and acceptance of the recalculated preview figures. After the read-only pending migration/schema report and backup/window review, provide explicit authorization for the exact migration list on that target.

**No production success can be certified until these gates have actual target-specific evidence.**
