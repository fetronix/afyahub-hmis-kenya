# Backup, Restore and Disaster Recovery — Runbook

**Scope:** the PostgreSQL database that holds all JaliCare HMIS data. Covers taking
a backup, proving it, restoring it, and what to do when the host is gone.

**Last verified:** 2026-10-27 — restore drill passed (230 tables, 84 rows, contents
identical). See `docs/project/completion-phases/MASTER-COMPLETION-REGISTER.md`.

---

## 1. The one rule

**A backup you have not restored is not a backup.** `npm run db:backup` writes a
file; `npm run db:restore:drill` is what turns that file into evidence. Run the
drill on a schedule — monthly at minimum, and after any change to the schema.

---

## 2. What protects a backup here

| Concern                 | How it is handled                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Confidentiality at rest | AES-256-GCM, key supplied by `BACKUP_ENCRYPTION_KEY` (base64, 32 bytes) or `BACKUP_ENCRYPTION_KEY_FILE`                 |
| Tampering               | GCM authentication tag — a modified archive fails to decrypt rather than restoring wrong data                           |
| Silent corruption       | SHA-256 recorded in the manifest and re-checked by `db:backup:verify`                                                   |
| Partial writes          | The archive is read back through the same decrypt path immediately after writing                                        |
| Disk growth             | Retention: newest 14 archives **and** anything younger than 30 days are kept; a file must fail both tests to be deleted |
| Accidental commit       | Archives default to `backups/`, which `.gitignore` and `scripts/check-tracked-database-backups.mjs` both reject         |

**Losing the key loses the backup.** Store `BACKUP_ENCRYPTION_KEY` somewhere other
than the machine that holds the archives — a password manager or the facility's
secrets store. If the key lives only on the database host, a host loss takes the
backups with it.

Generate a key once:

```bash
openssl rand -base64 32
```

---

## 3. Routine backup

```bash
export BACKUP_DIR=/srv/jalicare/backups
export BACKUP_ENCRYPTION_KEY_FILE=/etc/jalicare/backup.key
export SQL_HOST=127.0.0.1 SQL_PORT=5432 SQL_DB_NAME=jalicare \
       SQL_ADMIN_USER=jalicare_backup SQL_ADMIN_PASSWORD='…'

npm run db:backup
```

Output (`--json` for machine-readable):

```
backup OK  /srv/jalicare/backups/jalicare-20261027T021500.jcbak
  engine    pgdump (encrypted)
  database  jalicare
  size      18432112 bytes stored, 18431004 bytes payload
  sha256    9f2c…
  manifest  /srv/jalicare/backups/jalicare-20261027T021500.jcbak.manifest.json
```

Exit status is 0 only on success. A scheduler that checks only the exit code is
therefore correct.

### Two engines

| Engine    | Chosen when                                                                     | Restores                                                                               |
| --------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pgdump`  | `pg_dump` is on `PATH` or `PGBIN` (the default, and what production should use) | everything — self-contained                                                            |
| `logical` | no client tools available; selected explicitly with `--engine logical`          | data only, onto a schema built by `npm run db:migrate` at the recorded migration count |

The manifest records which engine made the archive and what a restore therefore
requires. `logical` exists so a host without client tools is not left with no
backup path at all; it is **not** a substitute for `pg_dump` on a large database,
and that is stated in every manifest it writes.

### Scheduled backups (cPanel / cron)

```cron
# 02:15 daily, log to the facility's log directory
15 2 * * * cd /home/<account>/jalicare && \
  /usr/bin/env BACKUP_DIR=/srv/jalicare/backups \
  BACKUP_ENCRYPTION_KEY_FILE=/etc/jalicare/backup.key \
  SQL_DB_NAME=jalicare SQL_ADMIN_USER=jalicare_backup SQL_ADMIN_PASSWORD="$(cat /etc/jalicare/db.pass)" \
  /usr/local/bin/node scripts/backup/db-backup.mjs >> /home/<account>/logs/backup.log 2>&1
```

Retention runs automatically at the end of every backup. Tie the cron entry to the
existing deployment pattern in `docs/deployment/truehost-cpanel.md`.

---

## 4. Verify an archive (cheap, daily)

```bash
npm run db:backup:verify                    # newest archive
node scripts/backup/db-verify.mjs <archive> # a specific one
```

Checks: manifest readable and same format version → SHA-256 matches the file →
decrypts and authenticates → archive contents agree with the manifest (table and
row counts for `logical`; `pg_restore --list` opens it for `pgdump`).

**This does not prove the archive restores.** It proves the file is intact.

---

## 5. Prove it restores (the drill)

```bash
npm run db:restore:drill
```

What it does, in order: takes a fresh backup of the live database → creates a
**separate** database → builds that database's schema from the repository
migrations → restores the archive into it → compares every table's row count and
a content hash of every row against the source → drops the drill database.

```
drill source   jalicare@127.0.0.1:5432/jalicare
drill target   jalicare_drill_20261027t021500z
engine         pgdump

drill PASSED
  tables compared  230
  rows (source)    84123
  rows (restored)  84123
  duration         41230ms
  drill database   dropped
```

`--keep` leaves the drill database in place for inspection; drop it yourself
afterwards. The drill never writes to the source database.

**What the comparison catches that an "it completed" check does not:** a restore
that silently truncated a table, dropped an hour of encounters, or landed rows in
the wrong table. Counts alone would miss the last one, so content hashes are
compared too.

---

## 6. Restore into a target database

```bash
# 1. create the empty database
createdb -h 127.0.0.1 -U postgres jalicare_restore_20261027

# 2. pgdump archives: restore directly
node scripts/backup/db-restore.mjs \
  --archive /srv/jalicare/backups/jalicare-20261027T021500.jcbak \
  --target jalicare_restore_20261027

# logical archives: build the schema first, at the recorded migration count
SQL_DB_NAME=jalicare_restore_20261027 npm run db:migrate
node scripts/backup/db-restore.mjs --archive … --target jalicare_restore_20261027
```

### Built-in refusals

| Refusal                                                          | Why                                                                     | Override  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- | --------- |
| Target name looks like production (`prod`, `production`, `live`) | a restore into production is a second outage wearing a recovery costume | **none**  |
| Target is the configured application database                    | same                                                                    | `--force` |
| Target name does not look like restore/drill/test/staging        | catches a typo at the moment it matters                                 | `--force` |
| Archive encrypted, no key configured                             | the key is not optional                                                 | none      |
| Target is not empty and cannot be cleared                        | see below                                                               | none      |

### Why an in-place restore can be refused

`audit_logs` carries a `BEFORE TRUNCATE` guard — an audit log that can be wiped in
place is not an audit log. The restore path therefore clears only tables that hold
data, and **fails with an explanation** rather than disabling the guard if the
target already has audit history.

The correct procedure is always: restore into a **new** database, verify it, then
promote it deliberately. Never wipe the live database to make a restore fit.

---

## 7. Disaster recovery

### Scenario A — the application host is lost, the database server survives

1. Rebuild the host per `docs/deployment/truehost-cpanel.md`.
2. Restore the code at the deployed commit; `npm ci`; `npm run build:deploy`.
3. Point `.env` at the surviving database.
4. `npm run db:status:all` — confirm every migration is applied.
5. `curl -fsS https://<host>/api/health` and `/api/ready`.

No database restore is needed. **Verify with the drill anyway** before assuming the
backups were fine.

### Scenario B — the database is lost

1. Provision PostgreSQL; create an empty database.
2. Restore the **most recent archive that passes `db:backup:verify`**. If the newest
   is corrupt, step back one — this is why retention keeps more than one.
3. `npm run db:status:all` and confirm the migration count matches the archive's
   manifest.
4. Start the application; check `/api/health` and `/api/ready`.
5. Spot-check: a recent patient encounter, the latest receipt, the trial balance.
6. Accept data loss back to the archive timestamp, and record it. **Do not describe
   this as "no data lost".**

### Scenario C — the archive host and the database host are the same machine

The facility has no backup. Fix this before it matters: push archives to storage
the database host cannot destroy (object storage, a second site, or an encrypted
disk an operator takes off-site weekly). The scripts write wherever `BACKUP_DIR`
points; keep it off the database host.

---

## 8. What is still missing

- **No automated off-host transfer.** Archives land in `BACKUP_DIR`; getting them
  off the machine is an operator responsibility today.
- **Verification is scheduled by the operator, not by the application.** There is
  no background job running `db:backup:verify` or the drill.
- **No restore-time re-encryption.** Restoring produces a plaintext database, as it
  must; protecting that database is the host's job (disk encryption, access control).
- **The `pgdump` path is unproven in this repository's sandbox**, because the
  sandbox has only the PostgreSQL server binaries, no client tools. The `logical`
  path is proven end-to-end; `pgdump` is exercised by preflight and by the same
  archive/manifest/retention code, but a drill on the real host is still required
  before anyone relies on it in an incident.
- **Point-in-time recovery (WAL archiving) is not configured.** The best recovery
  point is the last archive. For a hospital, discuss whether that is acceptable
  with the facility before go-live.
