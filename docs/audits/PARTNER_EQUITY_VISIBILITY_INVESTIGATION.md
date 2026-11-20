# Partners’ Equity Statement — frontend visibility investigation

## Finding and root-cause boundary

The implementation was committed and pushed as **`f2555fbc525a46854287f25a193a1b04b2ac2cb7`**, on **`arena/e088f11d-afyahub-hmis-kenya`**, before this investigation. The working source matched all **1,536 published files**. No source files were missing from that commit.

**Confirmed code-level reason the entry disappears:** `AccountingModule` filters out the equity navigation button unless the authenticated account has **`accounting.equity.read`**. The previous implementation catalogued that permission but deliberately did not grant it to existing facility roles. Existing `accounting.read`, `accounting.reports.export`, billing permissions, or the name `FACILITY_ADMIN` do not substitute for equity permissions. A platform `SUPER_ADMIN` is intentionally excluded from facility accounting/equity data.

**Confirmed UX defect fixed:** an accounting reader without the new entitlement saw no equity button and no explanation. Financial Reports now shows a non-sensitive “Partners’ Equity Statement — access required” notice explaining the precise permission, facility-role review, and re-login. The financial-data button remains hidden and the workspace does not mount or request equity data. No permission or security gate was relaxed. The Financial Reports description also no longer incorrectly implies the independently prepared equity statement comes from posted journals.

**Not established:** the exact deployed version, database migration state, effective permissions, facility module settings or cached session in the user's running installation. There is no configured production connection, deployed URL or authenticated production session here. Missing entitlement is a reproduced cause, **not an assertion that the user's live account was inspected**. An older frontend build, disabled/hidden Accounting module, or platform-admin login can also explain the absence.

## Integration trace

| Layer                     | Verified wiring / gate                                                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main sidebar              | `Sidebar.tsx`: Accounting & Finance requires `accounting.read`, a resolved facility, enabled `accounting`, and no `accounting` hidden-module setting. Platform super-admins do not get this operational entry. |
| App dispatch              | `App.tsx`, `case 'accounting'`: renders the real `AccountingModule`, keyed by user/facility.                                                                                                                   |
| Section/view registration | `AccountingNavigation.tsx`: section `reports`, title Financial Reports, view **`partnerEquity`**, label **Partners’ Equity Statement**.                                                                        |
| Workspace dispatch        | `AccountingModule.tsx`: imports and renders the real `PartnerEquityWorkspace` for `view === 'partnerEquity'`.                                                                                                  |
| Workspace read guard      | `PartnerEquityWorkspace.tsx`: refuses mounting the data-bearing session without `accounting.equity.read`.                                                                                                      |
| HTTP client               | Relative `/api/partner-equity` URLs; normal session authentication, no browser-facing localhost API address.                                                                                                   |
| Backend mount             | `src/routes/index.ts`: accounting-module-gated partner-equity router.                                                                                                                                          |
| API authorization         | Existing `accounting.read` **and** `accounting.equity.read`, plus authenticated tenant/facility account; individual actions require their additional permission.                                               |

No additional equity feature flag or unregistered React route was found. This is an internal accounting view, not a standalone `/partners-equity` URL. Navigate through the workspace after login; an arbitrary equity hash/path is not a registered deep link. Reload may return to the default workspace, after which the same navigation retrieves the saved statement.

### Exact user path

**Sign in as an authorized facility user → Accounting & Finance → Financial Reports → Partners’ Equity Statement.**

On narrow screens select **Financial Reports** from the **Accounting workspace** dropdown, then choose the equity button. Select ending financial year **2026** to retrieve the July 2025–June 2026 source period. An empty saved-period list is not a missing screen: a preparer must explicitly create a draft. Nothing is seeded by opening the page.

## Permissions and recommended role assignment

Every equity user needs **`accounting.read` + `accounting.equity.read`**. `accounting.reports.export` is **not** the equity export permission.

| Designated facility responsibility                                | Additional equity permissions                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Finance reader / authorized partner / financial-governance reader | None beyond the two read permissions                                        |
| Accountant / statement preparer                                   | `accounting.equity.manage`                                                  |
| Partner-register custodian                                        | `accounting.equity.partners`                                                |
| Independent financial reviewer                                    | `accounting.equity.review`; optionally `accounting.equity.audit`            |
| Authorized approver / finance lead                                | `accounting.equity.approve`; review must already have occurred              |
| Authorized report exporter                                        | `accounting.equity.export`                                                  |
| Financial auditor                                                 | `accounting.equity.audit`, normally read-only without manage/review/approve |

These are responsibilities, **not claims that those exact role names already exist in the database**. The built-in staff catalogue has `BILLING_CLERK` and clinical/operational roles, but no built-in accountant/finance-manager role with equity permissions. Do not add equity read to every billing clerk, clinical role, or all facility administrators. A designated existing tenant finance role should receive read access after approval; an existing `FACILITY_ADMIN` should receive it only if that person has a financial-governance responsibility. Provision a narrowly scoped finance role through authorized administration if none exists. Platform super-admins can administer facility permissions but cannot use their platform account to read equity statements.

Keep preparer and independent reviewer/approver accounts separate. The server refuses the last financial editor reviewing or approving their own inputs. Review also requires the explicit provisional-formula acceptance phrase. A suitably authorized non-editor reviewer may also approve; the existing control is not a compulsory three-person workflow.

### Safe facility-only assignment procedure — no automatic grants performed

1. Obtain authorization naming the **tenant, facility, role, affected staff and exact equity tasks**. Check current role membership, including other users who share the role at that facility.
2. Confirm the intended facility has Accounting enabled and not hidden. Do not enable all modules as a shortcut.
3. Ensure the permission catalogue includes the seven `accounting.equity.*` codes. Permission synchronization is a separately approved database operation, not a frontend fix. Seeding the catalogue does not grant facility equity read by itself.
4. Use the authorized **Platform Administration → Facilities → select the intended facility → Facility Role Permissions** editor (`FacilityRbacEditor`), not a shared tenant-default edit. The editor explicitly says it saves a facility override. The existing server also permits an authorized facility administrator to use the corresponding scoped API.
5. Select the intended role. Retain its existing permissions, add only the authorized codes above, inspect the complete selection, then save the **facility override**. Do not select all permissions, grant a platform role, or update shared `role_permissions` directly.
6. Where an API-based procedure is required, obtain the actual facility/role/permission IDs from authorized **GET `/api/platform/rbac/roles?facilityId=<selected facility ID>`**. Preserve that role's effective existing `permissionIds`; add the approved IDs from that returned catalogue. Use **PUT `/api/platform/rbac/roles/<returned role ID>/permissions`** with `{ "facilityId": <selected facility ID>, "permissionIds": <complete reviewed ID list> }`. These are explanatory metavariables, not IDs to send verbatim. This endpoint writes the target facility override, validates tenant/facility scope, and audits the operation. Never invent IDs or edit raw JWT/local storage to gain access.
7. Assign the chosen role only to approved staff through the normal scoped staff role-assignment workflow. Sign out/in to refresh frontend session permissions, and confirm `/api/auth/session` contains the intended effective codes.
8. Verify authorized reader visibility, unauthorized denial, read-only controls, and that another facility did not gain access. Retain the role-change audit record.

**Important existing-path distinction:** `Staff & Roles → Edit tasks` / `PUT /api/staff-roles/roles/:roleId/permissions` can update tenant role defaults as well as synchronize a pre-existing facility override. It is **not the recommended facility-only grant path** for this rollout. This investigation did not change that unrelated service.

## Database readiness

- `drizzle/0099_partner_equity_statements.sql` exists in the published commit and in `drizzle/meta/_journal.json` at index 99.
- Required tables: `equity_partner_register`, `equity_statements`, `equity_events`.
- Required application protections include the `equity_register_guard`, `equity_statement_guard`, `equity_event_guard` triggers and `equity_statements_scope_year` index, created by that migration.
- **User's deployed application DB: not inspected; status unknown.** No production migration, seed, role assignment, query or deployment was performed.
- **Disposable local test DB:** all 100 journal migrations applied successfully, including 0099. `npm run db:status:all` returned READY. The real-browser test separately verified all three equity tables and read/wrote only this disposable database.

For an authorized operator, `npm run db:status:all` is read-only, using the configured SQL target. Verify the target before running any tool. Independently check the equity objects with these read-only SQL statements:

```sql
SELECT to_regclass('public.equity_partner_register') AS partner_register,
       to_regclass('public.equity_statements') AS statements,
       to_regclass('public.equity_events') AS events;

SELECT tgname
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgrelid IN (to_regclass('public.equity_partner_register'),
                  to_regclass('public.equity_statements'),
                  to_regclass('public.equity_events'))
ORDER BY tgname;

SELECT code FROM permissions
WHERE code LIKE 'accounting.equity.%'
ORDER BY code;
```

A missing migration cannot explain a navigation button being filtered out: that filter is client-side permission-based. Missing schema can cause HTTP failures **after opening an entitled screen**. Do not confuse these causes. Only run production migrations or permission synchronization after explicit rollout authorization, backup and review of the full pending migration plan.

## Actual authenticated frontend verification

Unlike the earlier in-memory component demonstration, this investigation ran the **built Syrona Medical Center SPA served by the actual production Express entry point**, with normal login, real sessions, real authorization and PostgreSQL. Test records/accounts were disposable and explicitly synthetic; the frontend and APIs were **not mocked, intercepted or replaced**.

**14 checks passed** in `scripts/partner-equity-visibility-smoke.mjs`:

- Database equity schema and secure bootstrap in the disposable DB; actual Express readiness.
- Normal unentitled login: Accounting → Financial Reports displays the access explanation, no equity button and no equity data requests.
- Normal preparer login: actual navigation mounts the actual workspace; scoped list/register HTTP calls return 200.
- Opening the screen creates no statement. Explicit browser creation returns 201 and persists the original net loss in PostgreSQL.
- Actual 14-row grid is rendered; screenshots include the real Syrona Medical Center sidebar, report navigation and grid.
- A separate normal reader login sees the persisted statement, no editable equity cells, no enabled preparation action and no equity export action.
- Page reload and renavigation retrieve the saved record.
- No uncaught frontend runtime errors; every equity HTTP request succeeded.

Fresh contexts initially return the expected unauthenticated `/api/auth/session` 401. The intentionally accounting-only accounts receive 403 from the unrelated default dashboard overview; these do not prevent accounting/equity navigation. They are retained in the API evidence rather than hidden or described as all application APIs passing.

Evidence: `partner-equity-visibility-evidence/browser-results.json`, real authenticated screenshots and verification logs. **This proves local actual-application visibility with correctly assigned permissions; it does not prove visibility or readiness in the user's deployed installation.** No production facility account or live financial data was used.

Additional focused regression tests: **37 passed / 4 suites**, including four new visibility tests and unchanged equity/accounting/budget-navigation suites. Typecheck, client build, server build and formatting pass. Scoped ESLint: zero errors, one existing AccountingModule React-effect warning. Client build retains the existing bundle-size warning. The full repository suite was not rerun or represented as passed.

## Exact local start and acceptance steps

Use the current branch in an existing clean/local checkout; preserve any local edits before pulling. No branch switch is needed here.

```bash
git branch --show-current
# Expected: arena/e088f11d-afyahub-hmis-kenya
git pull --ff-only origin arena/e088f11d-afyahub-hmis-kenya
npm ci
[ -f .env ] || cp .env.example .env
```

Configure `.env` for a **dedicated local developer PostgreSQL database**, with `SQL_HOST`, `SQL_PORT`, `SQL_DB_NAME`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`, and local TLS settings. Keep secrets out of Git/chat. Never copy production credentials here. The environment in this sandbox originally had no `.env` or configured SQL/session environment, so it could not authenticate to an existing facility installation.

For an explicitly disposable local target only:

```bash
npm run db:migrate:dry
# Inspect the target and complete pending plan before applying locally:
npm run db:migrate
npm run db:status:all
npm run db:seed:permissions:dry
# Only after reviewing the local permission synchronization plan:
npm run db:seed:permissions
```

Use the existing authorized local onboarding/facility setup; assign a designated finance role through the facility-only procedure above. Do not run the general database seed or reset against an existing facility simply to reveal this screen.

Start the actual combined Express/Vite developer application:

```bash
NODE_ENV=development HOST=0.0.0.0 PORT=3000 npm run dev
```

Open `http://localhost:3000` on your own machine (or the hosted preview URL). APIs use relative URLs on the same origin. Sign in normally, select the intended facility, follow the exact navigation path, and choose a saved financial year/period. Authorized preparers can explicitly create the July 2025–June 2026 screenshot draft; read-only staff cannot. Verify the original net loss and all 14 rows. Sign out and repeat with an unentitled account.

To test production artifacts locally, rather than stale `dist/`:

```bash
npm run build
npm run build:server
NODE_ENV=production HOST=0.0.0.0 PORT=3000 npm start
```

A Git push does not rebuild/restart cPanel/Passenger. Deploying a fresh server bundle without rebuilding/deploying `dist/` can leave the old navigation in the browser. A production rollout must deploy matching client/server artifacts, restart the managed application and refresh the browser/session after authorization.

### Reproduce the automated actual-application check

After preparing the exact disposable DB **`equity_visibility_synthetic_test`** and building both artifacts:

```bash
export EQUITY_VISIBILITY_SYNTHETIC=YES
export SQL_HOST=127.0.0.1
export SQL_PORT=5432  # use your disposable PostgreSQL port
export SQL_DB_NAME=equity_visibility_synthetic_test
# Set SQL_ADMIN_USER and SQL_ADMIN_PASSWORD securely for this local DB.
export CHROME_EXECUTABLE_PATH=/path/to/your/chromium
node scripts/partner-equity-visibility-smoke.mjs
```

The script refuses non-loopback hosts, other database names and missing opt-in. Separate negative checks confirmed unsafe host/name configurations are refused before connecting or writing fixtures. It inserts only test records, uses random temporary passwords, starts/stops the real built server itself and writes browser evidence. It does not migrate, truncate or clean a DB. Sandbox execution used embedded PostgreSQL on 55443, Chromium plus its runtime libraries, and `BROWSER_NO_SANDBOX=1` only because of sandbox container restrictions. Do not disable the browser sandbox on a normal workstation. Test accounts remain in that disposable DB until its owner disposes of it.

## Files changed and operational boundary

- `src/components/modules/AccountingModule.tsx`: permission explanation only; existing filters and workspace authorization retained.
- `src/components/modules/accounting/AccountingNavigation.tsx`: correct reports-section description; existing view identifier/entry preserved.
- `src/tests/vitest/partner-equity-visibility.spec.tsx`: four focused access/discovery/dispatch tests.
- `scripts/partner-equity-visibility-smoke.mjs`: reproducible real login/SPA/Express/PostgreSQL browser test with strict disposable DB guard.
- This report and `partner-equity-visibility-evidence/`: screenshots, HTTP results and verification logs.

No equity calculation, statement persistence/workflow, source baseline, existing tests, authentication policy or production configuration was rebuilt or weakened. No role grants were made outside disposable local test fixtures. Published history was preserved on the same branch; the sandbox's stale local reference/index was aligned to the byte-verified published snapshot without changing working files, branch switching, reset, clean or force-push.

**Still requires authorized production rollout:** determine the running commit/client build, inspect read-only migration status, approve/apply pending migrations and catalogue sync if necessary, enable/unhide only Accounting for the intended facility, assign least-privilege facility overrides, deploy matching artifacts/restart, refresh sessions and verify with actual authorized facility users. Original workbook formulas remain provisional and retain their existing explicit review requirement.
