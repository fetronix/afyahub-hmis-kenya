# Deployment and Recovery

**Status of this document:** a verified *template*. The repository contains no
deployment automation, no backup job and no restore runbook. Nothing here was
executed, because no database or hosting environment was available to this audit.

Treat every command below as a procedure to be performed and recorded by
operations — not as evidence that it has been.

---

## 1. What the application actually needs

| Component | Requirement | Source |
|---|---|---|
| Node.js | 20+ (ESM, `tsx` in development) | `package.json`, `server.ts` |
| PostgreSQL | 14+ recommended; JSONB, partial indexes, `gen_random_uuid` not required | `src/db/schema.ts` |
| Environment | See §2 | `src/config/env.ts`, `.env.example` |
| Build artefact | `dist/` from `vite build` | `npm run build` |
| Process | One Node process serving the API and static build | `server.ts` |
| TLS | **Must be terminated in front of the app**; the app serves no TLS | absence verified |

### Platform support, stated honestly

| Platform | Support |
|---|---|
| Web browser (desktop) | **Yes** — the product is a responsive web application |
| Web browser (mobile) | Responsive layout; not tested on a device in this audit |
| Windows / Linux / macOS | The *server* runs on any of them under Node |
| Native iOS / Android app | **No** — no mobile project exists |
| Desktop application | **No** — no Electron/Tauri project exists |

The DHA classification "hybrid" can describe a browser front end plus a
self-hosted server. It must not be described as native mobile or desktop software.

---

## 2. Configuration

Required:

```
SQL_HOST  SQL_PORT  SQL_DB_NAME  SQL_ADMIN_USER  SQL_ADMIN_PASSWORD
```

Strongly recommended in any deployment that is not a single local machine:

```
NODE_ENV=production
SQL_SSL=true
SQL_SSL_REJECT_UNAUTHORIZED=true
TRUST_PROXY=true
CORS_ALLOWED_ORIGINS=https://<your-host>
APP_BASE_URL=https://<your-host>
```

DHA integration (leave in mock until credentials are issued):

```
DHA_MODE=mock
DHA_CLIENT_ID=
DHA_CLIENT_SECRET=
DHA_FACILITY_CODE=
DHA_ALLOW_PRODUCTION=false
```

**Never** commit `.env`. It is git-ignored; `.env.example` holds names only.

### 2.1 The `SQL_SSL` change

Before this audit the database connection hard-coded `ssl: false`. It now reads
`SQL_SSL`, defaulting to false so existing local installations keep working.
Certificate verification is on unless `SQL_SSL_REJECT_UNAUTHORIZED=false` is set
explicitly — a TLS connection that accepts any certificate does not authenticate
the server.

---

## 3. First deployment

```bash
npm ci
npm run build
npm run db:status        # confirm which migrations are pending
npm run db:migrate       # only after reading README §10
npm run db:seed:permissions
npm start
```

`npm run db:seed` seeds **demo** tenants, facilities and patients. Never run it
against a database that holds real records; it inserts unconditionally and will
duplicate them.

---

## 4. TLS

The application does not terminate TLS. A reverse proxy must:

- present a certificate from a public CA (or the organisation's internal CA),
- negotiate TLS 1.2 minimum, prefer 1.3,
- redirect HTTP to HTTPS,
- forward `X-Forwarded-Proto` and set `TRUST_PROXY=true` so the app sees HTTPS.

`helmet` is already applied and sets HSTS **only when the request is secure**; if
TLS is missing, that header is silently absent. Check it with:

```bash
curl -sI https://<host> | grep -i strict-transport-security
```

No TLS version or cipher claim is made in this document because none could be
observed.

---

## 5. Backup

There is **no backup mechanism in the repository**. The following is the minimum
acceptable procedure; operations must schedule it and record each run.

```bash
# Nightly, to storage that is encrypted at rest and access-controlled
pg_dump --format=custom \
        --file=/backups/jalicare-$(date +%F).dump \
        "$DATABASE_URL"

# Prove the file is readable before trusting it
pg_restore --list /backups/jalicare-$(date +%F).dump > /dev/null
```

Retention and access:

| Item | Minimum |
|---|---|
| Frequency | Nightly, plus before every migration |
| Retention | 30 daily, 12 monthly (adjust to the facility's policy) |
| Encryption | At rest, on the storage volume; encrypted in transit if remote |
| Access | Backup operators only; no application role can read the backup store |
| Off-site | At least one copy outside the primary host |
| Verification | Weekly `pg_restore --list`; restore drill quarterly |

Backups contain personal health data. They are in scope for the DPIA and for the
ODPC registration. They must not be copied to a developer laptop.

---

## 6. Restore drill

Run in an **isolated** environment. Never restore over production to "test".

```bash
createdb jalicare_restore_test
pg_restore --dbname=jalicare_restore_test --no-owner --clean /backups/jalicare-YYYY-MM-DD.dump

psql jalicare_restore_test -c "select count(*) from patients;"
psql jalicare_restore_test -c "select count(*) from encounters;"
psql jalicare_restore_test -c "select count(*) from audit_logs;"
psql jalicare_restore_test -c "select max(created_at) from audit_logs;"

# Then point a non-production instance at it and sign in.
```

Record: date, backup file, row counts, time to restore, and who performed it.

### Recovery objectives

**None are defined in the repository.** The organisation must set them, because
they are a clinical and contractual decision, not a technical default:

| Objective | Value | Owner |
|---|---|---|
| RPO (acceptable data loss) | *to be set* | Facility + operations |
| RTO (acceptable downtime) | *to be set* | Facility + operations |

A hospital running a maternity unit and a cashier should not accept a 24-hour RPO
by default. This audit will not invent one.

---

## 7. Monitoring that should exist

| Signal | Why |
|---|---|
| Process up | The app is the front door |
| 5xx rate | Reveals a broken query or integration |
| Login failures per account | Lockout is implemented; repeated failures are an attack signal |
| `FACILITY_MODULE_DISABLED` rate | A module switched off by accident looks like an outage |
| DHA call failures | The readiness endpoint already reports them; alert on BLOCKED |
| Backup success | An untested backup is a rumour |
| Disk space on the database volume | PostgreSQL stops accepting writes when full |

None of these are configured in the repository.

---

## 8. Upgrading an existing installation

1. Read `docs/dha-audit/DATABASE_MIGRATION_AUDIT.md` §3.1 — migration `0002`
   drops `patients.facility_id`.
2. Back up and verify.
3. `git pull && npm ci && npm run build`.
4. `npm run db:status`; apply migrations through `npm run db:migrate`.
5. `npm run db:seed:permissions` (adds `facilities.modules.manage`).
6. Restart; sign in; confirm the navigation shows the modules the facility expects.
7. Confirm `GET /api/compliance/dha` returns a score and that the critical gaps
   are listed.

---

## 9. What this document is not

It is not evidence that backups exist, that TLS is configured, that a restore has
been performed, or that RPO/RTO have been agreed. Those are the gaps it describes.
