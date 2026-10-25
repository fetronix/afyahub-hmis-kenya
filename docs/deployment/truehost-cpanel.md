# JaliCare HMIS — Truehost cPanel deployment

Practical guide for `https://jalicare.co.ke`, cPanel **Setup Node.js App**,
application root `/home/gjwldxza/jalicare`, Node 24.

Nothing in this document contains a secret. Passwords live only in
cPanel's environment panel.

---

## 0. What was wrong, in one page

| Symptom on the host | Cause | Fixed by |
|---|---|---|
| `npm start` did nothing / "Application is not responding" | `start` was `node server.ts`; cPanel runs plain `node`, which cannot execute TypeScript | `npm start` is now `node build/server.js` |
| `pthread_create: Resource temporarily unavailable`, exit 134 on `npm run db:status` | every maintenance command started `tsx`, which boots an esbuild service beside Node | commands run a pre-built `.js` bundle through `node scripts/run-script.mjs` when one exists |
| production process used far more memory than the app needs | `src/app.ts` imported `vite` at the top of the file, so every production process loaded Vite and its whole tree | Vite is now `await import('vite')` **inside** the development branch |
| `No __drizzle_migrations table found` after a `--dry-run` | the runner created the `drizzle` schema and tracking table **before** checking `--dry-run` | dry run exits before any write |
| status said PENDING while the runner skipped the migration | status matched on timestamp only; the runner matched on hash **or** timestamp | both call one classifier (`scripts/migration-journal.ts`) |
| blank page in production, API fine | static path was resolved relative to the process working directory, and a missing build was not reported | absolute `STATIC_DIR`, explicit "No client build found" error, SPA fallback that excludes `/api` |

The `pthread_create` failure is **not** something this code can override.
A Node process on a shared account is limited by the account's RLIMIT_NPROC
and memory ceiling, and starting extra processes (a TypeScript loader, a
compiler service, a build) counts against it. The application changes below
reduce how many processes and threads a command needs; if the host still
refuses, only the hosting provider can raise the limit.

---

## 1. Build locally (Windows)

Requirements on the build machine: Node 22 or 24, npm 10+.

```bat
cd C:\dev\afyahub-hmis-kenya
npm ci
npm run lint
npm test
npm run build:deploy
```

`npm run build:deploy` does three things:

1. `clean` — removes `dist/` and `build/` so a failed build cannot leave a
   stale artifact behind.
2. `build` — `vite build` → `dist/` (the browser application).
3. `build:server` — `node scripts/build-server.mjs` → the Node bundles:

```
build/server.js                       the Express server + static site
build/scripts/migration-status.js     read-only status
build/scripts/migrate.js              migration runner
build/scripts/preflight.js            read-only database preflight
build/scripts/seed-permissions.js     permission seed
build/scripts/clean-database.js       demo-data cleanup (not for production)
```

Nothing is built on the server. That is deliberate: a `vite build` on a
shared account is the most expensive thing this project can do, and it is
also how the thread limit gets hit.

---

## 2. What to upload

Upload these paths, keeping the structure:

```
build/            (whole directory)
dist/             (whole directory)
drizzle/          (whole directory: *.sql + meta/_journal.json)
scripts/          (only run-script.mjs and clean.mjs are needed at runtime;
                   upload the directory, it is small)
package.json
package-lock.json
server.ts         (not executed; kept so the repo matches the host)
src/              (not executed; keep it so a future bundle can be built on-host)
```

Do **not** upload `node_modules` from Windows. `argon2` is a native module:
a Windows binary does not load on Linux.

Do **not** upload `.env`, and never commit one. It is created in cPanel (§5)
and lives only in the account's environment panel.

Recommended: zip locally and use cPanel → File Manager → Upload → Extract.
Uploading 30,000 `node_modules` files through FTP is slower and can trip the
account's inode limit.

---

## 3. Dependencies on Truehost

cPanel → **Setup Node.js App** → your application → **Run NPM Install**.
That runs `npm install --production` in the application root.

`esbuild` is a **devDependency**, so it is not installed in production mode.
That is correct: the bundles were already built locally. `npm start` needs
only the runtime dependencies (`express`, `pg`, `drizzle-orm`, `argon2`,
`helmet`, `dotenv`, …), all of which are in `dependencies`.

If cPanel reports that `argon2` failed to compile, the account is missing a
build toolchain. Ask Truehost support to enable the `node-gyp` prerequisites
(Python 3, `make`, `g++`) or to install from a prebuilt binary. This is a
hosting limitation, not an application change.

---

## 4. cPanel application settings

**Setup Node.js App → Edit**

| Field | Value |
|---|---|
| Node.js version | `24` (or the highest offered) |
| Application mode | `production` |
| Application root | `jalicare` |
| Application URL | `jalicare.co.ke` |
| Application startup file | `build/server.js` |

The startup file is `build/server.js`, **not** `server.ts` and not
`server.js` at the root. cPanel starts it with `node`, so it must be
JavaScript.

`NODE_ENV=production` is set by the application mode. If you set it by hand,
make sure it is exactly `production`: the cookie, CSP and HSTS behaviour all
key off it.

---

## 5. Environment variables

Set these in cPanel → Setup Node.js App → **Environment variables**. Never
put them in a file that is committed.

| Variable | Value / note |
|---|---|
| `SQL_HOST` | `localhost` |
| `SQL_PORT` | `5432` |
| `SQL_DB_NAME` | the database from cPanel → PostgreSQL Databases |
| `SQL_ADMIN_USER` | the database user, including the `gjwldxza_` prefix |
| `SQL_ADMIN_PASSWORD` | the password you set in cPanel |
| `SQL_SSL` | `false` for a database on the same host |
| `SQL_SSL_REJECT_UNAUTHORIZED` | `true` |
| `APP_BASE_URL` | `https://jalicare.co.ke` |
| `DEFAULT_TIMEZONE` | `Africa/Nairobi` |
| `TZ` | `Africa/Nairobi` |
| `TRUST_PROXY` | `true` — the app sits behind cPanel's proxy |
| `DHA_MODE` | `mock` until DHA approval; `sandbox` needs credentials |
| `PORT` | **do not set.** cPanel injects it. |
| `STATIC_DIR` | only if `dist/` is not beside `build/` |

Setting `TRUST_PROXY=false` behind cPanel makes every request look like it
came from the proxy, and one busy client rate-limits the whole facility.

`PORT`: if you hard-code it, the app ignores the port the proxy is waiting
on and the site shows "Application is not responding" while the log says it
started.

---

## 6. Restart

cPanel → Setup Node.js App → **Restart**.

Then check **stderr/stdout logs** in the same panel. A healthy start prints:

```
JaliCare HMIS listening on http://0.0.0.0:<port>
```

A wrong startup file, a missing dependency or a bad `.env` fails here and
nowhere else. Do not restart repeatedly to "see if it helps": each restart
is a new process against the same limit.

---

## 7. Verify the deployment

Run these from any machine (they need no database access):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://jalicare.co.ke/
curl -s https://jalicare.co.ke/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://jalicare.co.ke/dashboard
```

Expected:

| Request | Expected |
|---|---|
| `/` | `200`, `text/html` |
| `/api/health` | `200`, JSON with `"status":"healthy"` |
| `/dashboard` (a client route) | `200`, `text/html` — the SPA fallback |
| an asset from the HTML, e.g. `/assets/index-*.js` | `200`, `application/javascript`, `cache-control: public, max-age=31536000, immutable` |
| `/api/does-not-exist` | JSON, not HTML |

In a browser: open the site, sign in, hard-refresh once (Ctrl+F5) so the old
service worker or cached bundle is dropped.

If `/` is a blank page but `/api/health` is 200, the client build is missing:
the log says `No client build found.` and prints the path it looked in.
Upload `dist/` or set `STATIC_DIR`.

---

## 8. Migration status, dry run, apply

All three are **read-only** until the last one.

```bash
cd /home/gjwldxza/jalicare
npm run db:status      # read-only: what does this database still owe?
npm run db:preflight   # read-only: which database is this, what is in it?
npm run db:migrate:dry # read-only: the exact plan, statement counts, destructive SQL
```

On the host these run `build/scripts/*.js` through `node`, so they need no
TypeScript loader. The dispatcher prints which one it used:

```
[run-script] migration-status: build/scripts/migration-status.js (node)
```

If it prints `(tsx, development)`, the bundle is missing — upload `build/`.

`--dry-run` writes nothing at all: no `drizzle` schema, no tracking table.
A first run on a fresh database therefore still says
`No __drizzle_migrations table found`, and that is correct.

### Reading the preflight verdict

| Verdict | Meaning |
|---|---|
| `READY` | No blocking issue. A migration is appropriate. |
| `READY WITH WARNINGS` | Read every warning: destructive SQL, drift, no backup. |
| `NOT READY` | Do not migrate. Usually: **unmanaged database** (tables but no history) or **no verified backup**. |

### History that does not match this journal

The runner also refuses when `drizzle.__drizzle_migrations` **has rows** but not
one of them corresponds to a file in `drizzle/meta/_journal.json` — a journal
from a different branch or checkout, or hashes written by a different tool.

Without that check the classification is "nothing applied, everything pending",
which replays 0002 over live patient data. The output prints the first recorded
hashes and timestamps so they can be compared with the journal. Do not delete
the tracking table to silence it.

### The unmanaged database

If the database already has application tables but no
`drizzle.__drizzle_migrations`, a naive migration replays everything from
0000 — including migration 0002, which runs
`ALTER TABLE "patients" DROP COLUMN "facility_id"`.

The runner **refuses** in that state. The correct recovery is not to
recreate tables and not to mark migrations applied in bulk:

1. `npm run db:preflight` — read the table list.
2. For each pending migration, verify whether its effects already exist
   (tables present, columns present, indexes present). `npm run db:status`
   checks the structures 0009–0013 create.
3. Record **only** verified migrations, one row each:

```sql
-- hashes are in drizzle/meta/_journal.json and in the file; compute with:
--   sha256sum drizzle/0000_new_vertigo.sql
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('<sha256 of the file>', <journal "when" value>);
```

4. Re-run `npm run db:status` and confirm only genuinely-unapplied
   migrations are pending.

This requires approval before it is done. It is a manual database action,
not something a script may guess.

---

## 9. Backup and restore

### Dump (SSH)

```bash
cd /home/gjwldxza/jalicare
pg_dump -Fc -f jalicare-$(date +%F-%H%M).dump "$SQL_DB_NAME"
ls -lh jalicare-*.dump        # a 0-byte file is not a backup
```

`pg_dump -Fc` is a custom-format archive: it restores selectively and is not
truncated by a text-mode transfer.

### Dump (no SSH)

cPanel → **phpPgAdmin** → your database → **Export** → format *Custom*.
Download the result. Still check the size.

### Restore

```bash
pg_restore --clean --if-exists -d "$SQL_DB_NAME" jalicare-2026-10-22-1200.dump
```

`--clean --if-exists` drops the objects the dump contains before recreating
them. On the live database this destroys current data: restore only to fix a
known-bad migration, and keep the pre-restore dump.

### Verify a backup before migrating

```bash
npm run db:preflight -- --backup=jalicare-2026-10-22-1200.dump
```

A missing or empty file is blocking, and the preflight will not call the
target ready.

---

## 10. Applying a migration

Only after the preflight says ready and the backup exists:

```bash
npm run db:migrate -- --yes
npm run db:status
```

`--yes` is required for any database that is not `localhost`. The runner
opens one transaction, applies the pending migrations in journal order,
writes one tracking row per migration, and commits. A failure rolls the whole
transaction back and prints the failing statement with the Postgres code,
detail and hint.

Migrations never run at application startup, and `npm start` does not touch
schema. That is on purpose: a restart must never change patient data.

---

## 11. Permission seeding

```bash
npm run db:seed:permissions -- --dry-run    # print every planned write
npm run db:seed:permissions -- --yes        # write
```

What it does: inserts missing permission codes, refreshes the
name/module/description of existing ones, and grants the seeded codes to
`SUPER_ADMIN` and to each tenant `FACILITY_ADMIN` role where the grant is
missing.

What it never does: no `DELETE`, `TRUNCATE` or `DROP`; no role assignment is
removed; facility-level role overrides and custom roles are untouched. A
facility that narrowed a role keeps its narrowing.

Run it after migrations, once. Do not add it to a startup script.

---

## 12. When `pthread_create` still happens

`node: pthread_create: Resource temporarily unavailable` (exit 134) means the
host could not create a thread for this process. On a shared account that is
an account-level limit — `RLIMIT_NPROC`, a cgroup pids limit, or memory.

What this repository now does to reduce it:

* maintenance commands run a pre-built `.js` bundle with plain `node`
  (no TypeScript loader, no esbuild service);
* production never imports Vite;
* the server binds once and starts no worker threads;
* nothing is compiled on the host.

What it cannot do: raise the account's limits.

If `npm run db:status` still fails after uploading `build/`, escalate to
Truehost support (**ticket 9707039**) and ask specifically:

1. What are `ulimit -u` (max user processes) and `ulimit -v` / the cgroup
   memory limit for this account?
2. What is the maximum number of threads a single Node process may create?
3. Is Node.js 24 fully supported for **CLI** jobs on this plan, not only for
   the application process?
4. Can the process/thread limit for `gjwldxza` be raised, or can the account
   be moved to a plan that permits it?

Attach the exact command, the exit code, and the output — that is what makes
the ticket actionable.

Workaround while the ticket is open: run every maintenance command from a
machine that can reach the database, with a local `.env` pointing at it, or
ask support to run the command for you. The application itself does not need
those commands to serve traffic.

---

## 13. Pre-deploy checklist

- [ ] `npm ci && npm run lint && npm test` pass locally
- [ ] `npm run build:deploy` produced `dist/` **and** `build/server.js`
- [ ] `build/server.js` starts locally: `NODE_ENV=production PORT=4600 node build/server.js`
- [ ] `build/`, `dist/`, `drizzle/`, `package.json`, `package-lock.json` uploaded
- [ ] cPanel startup file is `build/server.js`
- [ ] environment variables set in cPanel, `PORT` **not** set
- [ ] `npm install` run from the cPanel panel (production mode)
- [ ] application restarted, log shows `listening on http://0.0.0.0:<port>`
- [ ] `/`, `/api/health`, a client route and one asset all return 200
- [ ] `npm run db:preflight` says READY (or every warning is understood)
- [ ] a verified backup exists and has a non-zero size
- [ ] migration applied with approval, then `npm run db:status` is clean

---

## 14. Rolling back

```bash
# 1. previous bundle
mv build build.failed
mv build.previous build
# cPanel -> Restart

# 2. database, from the dump taken before the migration
pg_restore --clean --if-exists -d "$SQL_DB_NAME" jalicare-<timestamp>.dump
```

Keep the previous `build/` and `dist/` on the server before each deploy
(`mv build build.previous && mv dist dist.previous`). They cost a few MB and
turn a rollback into a file move.
