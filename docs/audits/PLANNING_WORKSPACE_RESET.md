# Controlled Planning Workspace Reset

## Safety statement

This implements an application workflow; **no live JaliCare database was inspected, queried, reset or migrated**. All database verification used a newly created, loopback-only disposable PostgreSQL 18.6 database named `planning_reset_synthetic_test`, guarded by explicit synthetic-test environment checks. No production reset or production migration was executed.

## How an administrator accesses it

After authorized deployment, migration and permission provisioning:

1. Sign in as a **facility-assigned `FACILITY_ADMIN`**. Global/super administrators and tenant-wide accounts are not permitted to run this operation.
2. Open **Accounting & Finance → Budget & Procurement Planning**.
3. Under **Planning settings**, click **Reset Planning Data**. The option is shown only with planning manage/reset permissions; the server independently checks role, permissions and authenticated facility scope.
4. Verify the **authenticated facility name and ID**. Review annual plans, their statuses and stationery/branding/uniform/monthly/imported/no-import-provenance counts. Expand **Preserved import batches** to inspect filenames/statuses.
5. Explicitly select up to 100 draft plans and the sections to clear. Optionally limit removal to imported records or records without import provenance. Nothing is selected for deletion by default.
6. Enter a 10–1000 character reason and click **Preview reset — no changes**. The server reads actual counts from the application's connected database. This is read-only; it does not clear planning rows or insert audit/reset events.
7. Review the exact counts, facility, selected plan IDs, reason, eligible plan deletions and retained-plan explanations. Type **`RESET PLANNING DATA`** exactly, then click **Confirm Reset Planning Data**.
8. Only a successful server COMMIT produces a committed receipt with administrator/facility, completion timestamp, audit event ID and actual removal counts. The workspace and inventory are refreshed. Changes to choices/reason invalidate the preview; expired/stale previews require a new review.

For audit readers, **Audit History → Show facility-wide audit (including planning resets)** displays the facility-level reset events. This scope is selected automatically after a successful reset. Records remain available after refresh, subject to existing audit permissions.

## What it clears

Only explicitly selected data belonging to selected **DRAFT** plans in the authenticated facility/tenant:

- Stationery/consumables items, using the existing section classification.
- Branding items, using the same classification as the existing Branding table.
- Uniform projections.
- All dependent monthly projection rows belonging to selected stationery/branding items. These are mandatory dependencies, not an independent checkbox that can leave an incomplete item. Uniforms do not gain artificial monthly allocations.
- Optional truly disposable empty draft plans and their categories, **only** when no unselected item/uniform remains and the plan has no import source, audit events or issued reports.

Counts include active and previously soft-removed rows. Imported/no-import-source counts are provenance subsets of item/uniform deletions, not additional deletion totals. A missing import source is labelled transparently; it is not proof of a legacy record's original source.

Most normally created plans already have immutable creation audit events. **Those plans are retained even when emptied**; the preview explains why. Existing lifecycle/archive functionality remains the way to retire such plans. The reset does not detach or rewrite historical foreign keys to make a plan deletable.

With all three sections selected in a draft plan, its tables become empty and its projection totals become zero. The views expose **Add First Item — Stationery**, **Add First Item — Branding**, and **Add First Item — Uniform projection**; category setup remains available where needed. **New annual plan** remains available. CSV/Excel import is optional, not a prerequisite. Selective resets intentionally preserve unselected data and its totals.

## What it always preserves

- Import batches, uploaded source bytes, source hashes and historical import receipts/statuses.
- Existing planning events, central audit logs and issued reports (including stored report bytes).
- Annual plans with history, plus every REVIEW/APPROVED/ARCHIVED plan and its projections.
- Categories on retained plans.
- Facility letterheads and facility settings.
- Users, clinical records, accounting postings, expenditure, procurement/POs, inventory, GRNs, payroll and all other non-planning data.

Reset does not silently reactivate an imported/cancelled batch or make an idempotent import replay recreate cleared projections. Historical import counts remain historical receipts; current projection/record totals reflect the reset. There is no automatic undo; an authorized backup/recovery process should be available before clearing data. Deleted row snapshots/provenance remain in immutable reset audit evidence.

## Server-side authorization and integrity

The reset routes inherit authenticated planning read access (`accounting.read` and `accounting.planning.read`) and additionally require:

- `accounting.planning.manage`;
- new explicit permission **`accounting.planning.reset`**;
- exact `FACILITY_ADMIN` role;
- a non-null tenant and assigned facility, with no super-admin context.

Scope is derived from `req.authContext.facilityId`, not from a request ID. A client facility hint must agree; the facility is reloaded through the existing scoped lookup and its tenant is checked. Plan IDs are resolved again under both tenant and facility. The destructive permission is restricted from ordinary staff-role delegation. It is defined in the permission catalogue but **not automatically granted to every facility administrator**; use the existing authorized RBAC provisioning process to grant the permission deliberately.

Preview tokens are HMAC-signed, actor/tenant/facility-bound and expire after 10 minutes. They bind the canonical selection, reason and a digest of actual plan versions, full rows and history reference counts. Counts alone are not used to detect changes. Execute locks selected plans in ID order, re-reads the data and rejects stale/expired reviews. Existing child writes also lock their parent plans, so concurrent edits cannot pass unnoticed through the normal planning mutation paths. Concurrent confirmation of the same review results in one success, not duplicate removal.

The transaction:

1. Validates and locks only scoped DRAFT plans.
2. Inserts immutable `PLANNING_RESET_AUTHORIZED` evidence containing the reason, selection, counts and previous selected rows (including monthly/provenance data), plus the normal central audit event.
3. Sets a transaction-local authorization-event reference.
4. Deletes explicitly scoped monthly rows first, then items/uniforms, then categories/plans only where disposable. Every DELETE includes tenant/facility scoping or a scoped plan join. There is no unscoped deletion, CASCADE, trigger disabling or history rewrite.
5. Verifies DELETE row counts against the reviewed selection. Mismatches throw and roll back.
6. Bumps retained plan versions to invalidate stale editors/import previews.
7. Inserts `PLANNING_RESET_COMPLETED` with administrator, facility, reason, selection and verified counts, plus central audit logging.
8. Returns a receipt only after COMMIT has succeeded. The receipt's completion time is observed after COMMIT; audit events also retain database-generated transaction timestamps.

An exception, including a deferred COMMIT error, rolls back deletions, version changes and new reset audit events together. Existing audit history remains unchanged. A network failure is treated as **unverified**, not evidence of rollback; the administrator must refresh and inspect facility-wide audit before retrying. A successful reset invalidates its preview through changed versions/data or removed plans.

## Endpoints

Under `/api/budget-planning`:

| Method/path           | Function                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /reset`          | Actual authenticated-facility plan counts, eligibility, facility name and preserved batch statuses        |
| `POST /reset/preview` | Read-only preview from explicit `selection` and `reason`; returns signed token/counts/retention decisions |
| `POST /reset/execute` | Requires the server token and exact confirmation phrase; returns committed receipt                        |

The application client may include its normal `facilityId` hint, but it cannot expand or replace session scope.

## Database/deployment changes (not applied to production)

- New migration: **`drizzle/0097_controlled_planning_reset.sql`**, registered as journal entry 97.
- No new tables and no data reset/backfill in the migration.
- Existing insert/update planning guards are retained. Dedicated BEFORE DELETE triggers allow only DRAFT rows whose identities were included in same-transaction, same-facility immutable reset evidence. Ordinary deletes remain blocked. Plan history/source checks are enforced again in the database.
- Immutable planning-event/report triggers remain untouched.
- `src/seeds/permissions.ts` defines the new reset permission. Normal reviewed permission seeding/provisioning is needed before granting it; no live seeding or role grant was performed here.
- `.env.example` documents optional **`PLANNING_RESET_SIGNING_KEY`**. For multiple workers/instances, configure an independent high-entropy secret of at least 32 bytes consistently through the deployment's secret management. Do not commit its real value. Without a configured key the server uses a process-local random key; restart/worker changes fail closed and require another preview. A configured key shorter than 32 bytes is rejected at startup.

Use the authorized deployment/migration process and backup policy to roll this out. The current feature has not been deployed to or validated against the user's live system.

## Exact task files

Existing files modified:

- `.env.example` — optional shared preview-signing configuration, no real secret.
- `drizzle/meta/_journal.json` — registers migration 0097.
- `src/auth/staff-role-policy.ts` — restricts destructive reset permission delegation.
- `src/seeds/permissions.ts` — explicit reset permission definition, no automatic facility-admin grant.
- `src/budget-planning/planning.routes.ts` — mounts reset router behind existing planning read checks.
- `src/components/modules/planning/PlanningWorkspace.tsx` — settings entry, refresh after success, empty-table manual actions and facility-wide reset audit visibility.

New files:

- `drizzle/0097_controlled_planning_reset.sql`.
- `src/budget-planning/reset-contract.ts` — shared selections/counts/inventory/preview/receipt types.
- `src/budget-planning/planning-reset.routes.ts` — administrator/permission/session scope boundary.
- `src/budget-planning/planning-reset.service.ts` — read-only preview, signed review, locking, transactional scoped deletes and audit.
- `src/components/modules/planning/PlanningReset.tsx` — explicit opt-in selection/preview/typed confirmation/receipt UI.
- `src/tests/planning-reset.db.spec.ts` — 15 synthetic PostgreSQL/HTTP workflow tests.
- `src/tests/planning-reset-contract.spec.ts` — 2 migration/permission-boundary tests.
- `src/tests/vitest/planning-reset-ui.spec.tsx` — 9 React UI tests.
- `docs/audits/PLANNING_WORKSPACE_RESET.md` — this report.
- `docs/audits/planning-reset-evidence/verification.json` — verification summary.

The task-start SHA256 inventory confirms no unrelated baseline files were altered or removed. Disposable runtime, local database files and scratch tooling stay under the ignored `.tmp-tools/planning-reset/` directory; dependencies/build outputs remain ignored.

## Verification

- Disposable PostgreSQL: **98 migrations successfully applied**, including 0097. Migration 0097 itself runs no reset.
- Focused regression: **163 tests passed across 13 suites**, no skips. Includes 15 reset DB tests, 9 reset UI tests and 2 reset contract tests; existing budget-planning database coverage passed all 29 tests with the source-fixture environment set.
- TypeScript: passed.
- Scoped ESLint: passed without warnings/errors.
- Scoped Prettier: passed.
- Frontend/server builds: passed; frontend retains the existing >500 kB chunk warning.

Database tests cover actual preview counts without writes; exact confirmation/signed token validation; actor/facility binding; authorized reset and committed counts; unauthenticated/read-only/non-admin/missing-permission/global/tenant-wide rejection; same-tenant and cross-tenant isolation; stale preview with unchanged counts; selected-section/provenance dependency deletion; later-delete rollback; deferred COMMIT rollback; concurrent confirmations; expiry; immutable audit/import preservation; byte-for-byte report/letterhead/facility/user preservation; protected statuses/ordinary delete guards; disposable-plan retention/deletion; empty totals and new manual item/uniform/plan creation.

UI tests cover read-only mount/selection, protected plan controls, explicit preview/exact phrase, invalidation/cancellation, use of server receipt counts, unverified network errors, permission-gated settings and all three empty sections with enabled manual-entry actions.

### Known preexisting broader-suite failure

A broader run including `src/tests/migrations.spec.ts` produced **167 passes and 1 failure**: `Guarded Ddl` rejects the unchanged `0095_budget_procurement_planning.sql` table creation statements for lacking `IF NOT EXISTS`. Both that migration and the failing test match the task-start inventory and published branch byte-for-byte. This task neither changed the applied 0095 migration nor weakened its test. The new migration has no CREATE TABLE/INDEX statements and has separate safety-contract coverage. This is an existing repository migration-integrity issue, not a production migration result or a claim that the entire repository test suite is green.

No authenticated live-browser or production-database verification is claimed. HTTP tests exercise the real authorization/scoping/reset routes with synthetic authenticated contexts; React tests mock API responses. Inventory currently reads complete facility planning metadata and reset previews load selected-plan row evidence (up to 100 plans); large deployments may need further server-side pagination/batching before broad use.
