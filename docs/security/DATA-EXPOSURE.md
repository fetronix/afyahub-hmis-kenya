# Security — data exposure and secret handling

Status of a known exposure, what has been remediated, and what must still
happen outside this repository.

---

## 1. Committed database dumps (open)

### What

Four `pg_dump` files (~1.1 MB) were committed to this repository and remain
in its history:

| File | First added in |
|---|---|
| `backups/database/jalicaredb-pre-tariffs-20261018-004117.dump` | `f5abd3d` |
| `backups/jalicaredb-before-patient-guardian-20261019.dump` | `8380d3c` |
| `jalicaredb-before-tariff-migration-20261018-103020.dump` | `f5abd3d` |
| `local-backups/jalicaredb-before-subscription-migration-20261016-035706.dump` | `6e03e01` |

All four reference the `patients` and `patient_identifiers` tables.

### Why it matters

A dump is a complete copy of patient data with **none** of the database's
protections:

- column-level encryption does not protect the file — the ciphertext is in
  it, alongside the schema needed to interpret it;
- the audit trail does not record who reads it;
- it cannot be revoked. A file that has been pushed is disclosed.

For a Kenyan HMIS this is a Data Protection Act 2019 matter, not a
housekeeping one.

### Remediated

- Removed from tracking with `git rm --cached` (the local files are kept —
  they are somebody's backup).
- `.gitignore` now covers `*.dump`, `*.dump.*`, `*.sql.gz`, `backups/` and
  `local-backups/`, so the file cannot be re-added by accident.
- `.dockerignore` already excluded `*.dump` and `backups/`, so no container
  image contains them.

**This does not remove them from history.** They are still retrievable from
any clone, and from GitHub.

### Outstanding — requires the repository owner

Both steps need credentials and permissions this environment does not have.

#### 1a. Rotate the database credentials

Rotate the PostgreSQL user password **whether or not** the dumps are
believed to be harmless. Anyone who has cloned the repository has a full
copy of the database as of October 2026.

#### 1b. Purge the dumps from history

This rewrites every commit SHA after the first affected commit. Every
collaborator must re-clone afterwards; open pull requests will need to be
re-created.

```bash
# 1. Work from a mirror clone, never from a working copy.
git clone --mirror https://github.com/fetronix/afyahub-hmis-kenya.git jalicare-mirror.git
cd jalicare-mirror.git

# 2. Back up before rewriting. A rewrite is not reversible.
cp -a . ../jalicare-mirror.backup.git

# 3. Remove the dump paths from every commit.
pip install git-filter-repo
git filter-repo \
  --invert-paths \
  --path-glob '*.dump' \
  --path backups/ \
  --path local-backups/

# 4. Confirm nothing remains anywhere in history.
git log --all --oneline -- '*.dump' | wc -l    # must print 0

# 5. Push the rewritten history.
git push --force --all
git push --force --tags
```

Then, and only then:

- every collaborator re-clones (do not pull — the histories are unrelated);
- GitHub support is asked to garbage-collect unreachable objects, otherwise
  the old commits stay reachable by SHA;
- any open PR based on the old history is closed and re-opened.

#### 1c. Assess notification

If the dumps contained real patient records — and they reference
`patients`, so assume they did until proven otherwise — determine whether
the exposure requires notification under the Data Protection Act 2019.
This is a question for the data controller, not for a code change.

---

## 2. Secret handling rules

These are enforced by tooling where possible and by review otherwise.

### Never committed

`.gitignore` excludes `.env`, `.env.*` (with `!.env.example`), `dist/`,
`build/`, `coverage/`, `node_modules/`, `*.log`, `*.bak`, `*.dump` and
`backups/`.

### `.env.example`

Contains **placeholders only** — empty values for secrets, and harmless
defaults (`DHA_MODE=mock`, `PORT=3000`, `TRUST_PROXY=false`) for the rest.
It is kept in sync with the variables the code actually reads; every key in
it is read by `src/config/env.ts`, and no variable the code reads is missing.

Generate a real key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Tests

Test fixtures use values that are obviously fake and are generated at run
time, never committed as literals. A 32-byte base64 string in a repository
is indistinguishable from a live key to a scanner, and a permanent false
positive trains people to ignore the scanner.

CI generates a throwaway `FIELD_ENCRYPTION_KEY` per job into `$GITHUB_ENV`;
it exists only for the life of one job and in no file.

### Scanning

- **GitGuardian** runs as a GitHub App on every pull request. Its exceptions
  live in its dashboard, not in the repository — `.gitguardian.yaml` is a
  ggshield CLI config and is *not* read by the App, so adding one would be a
  file that promises an effect it does not have.
- **`npm audit --omit=dev --audit-level=high`** runs in CI and fails the
  build on high or critical advisories in production dependencies.

### Logging

Structured logging redacts credentials **and patient identity** — national
ID, phone, date of birth, name, email — at the logger, not at each call
site. A call site that forgets is a leak, so the default has to be safe.
Query strings are dropped from request logs for the same reason:
`?nationalId=...` is a national identity number in a log file.

Where correlation across events is genuinely needed, `patientRef()` returns
a keyed HMAC: stable per installation, reversible by nobody holding only the
log.

---

## 3. Reporting a new exposure

Do not open a public issue. Report it privately, rotate first, and document
it here with the same structure: what, where, why it matters, what was done,
what remains.
