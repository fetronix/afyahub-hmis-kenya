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

All four reference the `patients` and `patient_identifiers` tables. On
2026-11-03, repository metadata identified this repository as **public**,
and Git history metadata still showed these paths in reachable commits. This
follow-up did not extract the archives or inspect patient or credential values.
A public repository and reachable history constitute an active incident until
the data controller and security owner complete containment and assessment.

### Why it matters

A dump is a complete copy of patient data with **none** of the database's
protections:

- it can contain plaintext fields; encrypted fields remain ciphertext, but
  their protection depends on keys being separately protected and may not
  cover all exported fields;
- database access controls and database audit do not record who reads a copy;
- copies already obtained cannot be revoked by deleting the source.

For a Kenyan HMIS this is a Data Protection Act 2019 matter, not a
housekeeping one.

### What is in them — verified 2026-10-25

The contents were previously unexamined. They have now been inspected at the
structure level only: the dumps were extracted outside the repository, and
**no values were printed, copied into a report, or committed.** What follows
is counts, not data.

All four are PostgreSQL custom-format archives (`PGDMP`) containing 61
table-data sections each, including `patients`, `patient_identifiers`,
`users` and `sessions`. Decompressed content, counted by pattern:

| Dump | Argon2 hashes | `+254` phone numbers | email addresses | 64-hex tokens |
|---|---|---|---|---|
| `…before-patient-guardian-20261019` | 14 | 19 | 83 | 21 |
| `…pre-tariffs-20261018` | 6 | 6 | 54 | 11 |
| `…before-tariff-migration` | 6 | 6 | 56 | 11 |
| `…before-subscription-migration` | 6 | 6 | 42 | 6 |

**Conclusion: these contain real personal data and real credential
material. They are not synthetic fixtures.** Phone numbers, email addresses
and national-ID-like values are personal data under the Data Protection Act
2019; the Argon2id hashes are user login material.

Consequences:

1. A **breach assessment** is required, not optional.
2. Identify affected accounts through a controlled private review, force
   password resets, and invalidate potentially exposed sessions and recovery
   tokens using an approved operational plan. The pattern counts above are
   not a count of unique accounts or a complete exposure inventory.
3. Rotate the database credential and independently assess application,
   provider and administrator secrets. A normal `pg_dump` does not include
   PostgreSQL login passwords, but this does not prove that application data
   or configuration contains no other credential material.
4. Removing the files from the current tree does **not** remove them from
   history. See the purge procedure below.

### Remediated

- Removed from tracking with `git rm --cached` (the local files are kept —
  they are somebody's backup).
- `.gitignore` covers known dump extensions and backup directories, reducing
  accidental re-addition; ignored files can still be force-added.
- The current `.dockerignore` excludes known dump patterns. Previously built
  images and external registries have not been inventoried or verified.
- CI runs `npm run security:check-tracked-database-backups`, which checks
  current Git-index paths without opening archive contents. It fails closed if
  the index cannot be read, but it **does not scan or remove history**, caches,
  forks, external artifacts, or copies already obtained.

**This does not remove them from history.** They are still retrievable from
any clone, and from GitHub.

### Outstanding — requires the repository and data owners

**Not yet done or verified:** containment, account/session remediation,
credential rotation, repository-wide history cleanup, provider-side cache
removal, notification assessment and verification of external copies. This
working branch has no authority to change repository visibility, rotate live
credentials, force-push other refs or modify production accounts.

#### 1a. Contain and rotate

1. Privately notify the data controller, security lead and repository owner;
   assess whether to restrict repository access immediately and record the
   exposure window, affected systems and incident decisions.
2. Privately identify affected accounts, invalidate relevant sessions and
   recovery tokens, and force password resets through authorized operations.
   Do not paste credentials or patient records into issues, chat, logs or tests.
3. Rotate the database credential and assess application, administrator and
   provider credentials independently, using the owners' secret-management and
   change procedures. Verify dependent services afterwards.
4. Do **not** blindly replace `FIELD_ENCRYPTION_KEY`: doing so can make
   existing encrypted data unreadable. An approved key-versioning and
   re-encryption plan, retained recovery keys and tested backups are required.

#### 1b. Owner-approved history cleanup

History rewriting changes commit IDs and can disrupt collaborators, tags,
open PRs and audit/release references; it cannot erase copies already made.
The repository owner must approve the exact affected refs, coordinated freeze,
restricted incident backup and rollback/recovery plan **before** a rewrite.
Do not run global force-push commands from this working branch.

With that approval, designated administrators should work in an isolated,
access-controlled mirror, inventory all affected paths and refs without
printing records, remove the exact sensitive objects using an audited rewrite,
and verify *all* intended branches, tags and reachable objects. Coordinate
collaborators and PRs, request GitHub's sensitive-data removal/cache cleanup,
and separately address forks, release artifacts and other copies. GitHub
support and external owners must confirm their own steps; a local rewrite or
an empty current tree is not proof that the exposure is gone.

#### 1c. Breach and notification assessment

The data controller and privacy officer should assess the incident and any
notification obligations under applicable law with appropriate advice. No
notification, external cleanup or legal conclusion is asserted here.

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
