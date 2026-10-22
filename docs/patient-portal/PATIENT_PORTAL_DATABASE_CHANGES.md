# Patient Portal — Database Changes

**Date:** 22 October 2026
**Migration:** `drizzle/0018_patient_portal.sql`
**Journal entry:** index 18, tag `0018_patient_portal`
**Applied?** **No.** Written, type-checked and contract-tested. Never executed against PostgreSQL in
this environment. Applying it is a decision for the deployment owner — see
`PATIENT_PORTAL_DEPLOYMENT_GUIDE.md`.

---

## 1. Principles applied

1. **Reuse, do not duplicate.** There is no second patient table. Accounts point at `patients.id`.
   Clinical data is read from `encounters`, `diagnoses`, `lab_orders`, `lab_results`, `medications`,
   `appointments`, `admissions` and `patient_allergies` — none of these were altered.
2. **Additive only.** The migration contains `CREATE TABLE IF NOT EXISTS` and
   `CREATE [UNIQUE] INDEX IF NOT EXISTS`. There is **no** `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`,
   `ALTER COLUMN`, or `UPDATE` against an existing table. A test asserts each of these absences.
3. **Constraints carry the invariants** that the application also checks, so a bug in a route cannot
   produce two accounts for one patient or two accounts answering to one phone number.
4. **One live invitation per patient** is enforced by the application (supersede-on-issue) rather
   than a partial unique index, because the historical rows must be kept and queried. The unique
   index is on `token_hash` only.
5. **No PHI in new columns.** The portal stores an opaque card code, masked contact hints and
   referring ids. It does not copy a diagnosis, a result or a note.

---

## 2. Tables

### 2.1 `patient_portal_accounts`

One row per patient who has been through activation.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `tenant_id` | integer NOT NULL → `tenants(id)` | |
| `facility_id` | integer → `facilities(id)` | Nullable: an account can outlive a facility merge; `allowedFacilityIds()` handles it |
| `patient_id` | integer NOT NULL → `patients(id)` | **UNIQUE** |
| `login_identifier` | text NOT NULL | **UNIQUE** — normalised phone digits or lower-cased email |
| `login_type` | text NOT NULL DEFAULT `'PHONE'` | `PHONE` \| `EMAIL` |
| `password_hash` | text NOT NULL | argon2id |
| `status` | text NOT NULL DEFAULT `'ACTIVE'` | `PENDING_VERIFICATION` \| `ACTIVE` \| `SUSPENDED` \| `REVOKED` |
| `must_change_password` | boolean NOT NULL DEFAULT false | set by "force reset" |
| `failed_login_attempts` | integer NOT NULL DEFAULT 0 | |
| `locked_until` | timestamp | 15-minute lock after 5 failures |
| `activated_at`, `last_login_at` | timestamp | |
| `suspended_at`, `suspended_by_user_id`, `suspended_reason` | | |
| `revoked_at`, `revoked_by_user_id`, `revoked_reason` | | terminal |
| `qr_token_hash` | text | SHA-256 of the card code; partial UNIQUE index |
| `qr_token_sealed` | text | the code itself, AES-256-GCM when `FIELD_ENCRYPTION_KEY` is set — lets the owner re-open their own card |
| `qr_issued_at` | timestamp | |
| `security_version` | integer NOT NULL DEFAULT 1 | incremented on forced reset |
| `created_at`, `updated_at` | timestamp NOT NULL DEFAULT now() | |

Indexes:

```sql
CREATE UNIQUE INDEX patient_portal_accounts_patient_idx   ON patient_portal_accounts (patient_id);
CREATE UNIQUE INDEX patient_portal_accounts_login_idx     ON patient_portal_accounts (login_identifier);
CREATE UNIQUE INDEX patient_portal_accounts_qr_idx        ON patient_portal_accounts (qr_token_hash)
                                                          WHERE qr_token_hash IS NOT NULL;
CREATE INDEX        patient_portal_accounts_scope_idx     ON patient_portal_accounts (tenant_id, facility_id, status);
```

The partial unique index matters: most accounts have no card yet, and `NULL` values are not
compared by a plain unique index, but the partial form documents the intent and keeps the index
small.

### 2.2 `patient_portal_invitations`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `tenant_id` | integer NOT NULL → `tenants(id)` | |
| `facility_id` | integer NOT NULL → `facilities(id)` | |
| `patient_id` | integer NOT NULL → `patients(id)` | |
| `token_hash` | text NOT NULL | **UNIQUE**; the raw token is never stored |
| `delivery_channel` | text NOT NULL DEFAULT `'MANUAL'` | `MANUAL` \| `SMS` \| `EMAIL` |
| `delivery_status` | text NOT NULL DEFAULT `'PENDING'` | `PENDING` \| `SENT` \| `FAILED` \| `NOT_CONFIGURED` \| `HANDED_OVER` |
| `status` | text NOT NULL DEFAULT `'PENDING'` | `PENDING` \| `ACTIVATED` \| `EXPIRED` \| `REVOKED` \| `SUPERSEDED` |
| `purpose` | text NOT NULL DEFAULT `'ACTIVATION'` | `ACTIVATION` \| `RECOVERY` \| `REVERIFICATION` |
| `contact_hint` | text | masked only, e.g. `2547***678` |
| `delivery_attempts` | integer NOT NULL DEFAULT 0 | compared against the facility resend limit |
| `last_delivery_error` | text | provider message, truncated |
| `expires_at` | timestamp NOT NULL | 4–336 h from issue |
| `created_by_user_id` | integer → `users(id)` | |
| `created_at` | timestamp NOT NULL DEFAULT now() | |
| `sent_at`, `handed_over_at`, `activated_at` | timestamp | |
| `revoked_at`, `revoked_by_user_id`, `revoked_reason` | | |
| `superseded_by` | integer → `patient_portal_invitations(id)` | self-reference to the newer row |

Indexes:

```sql
CREATE UNIQUE INDEX patient_portal_invitations_token_idx   ON patient_portal_invitations (token_hash);
CREATE INDEX        patient_portal_invitations_patient_idx ON patient_portal_invitations (patient_id, created_at DESC);
CREATE INDEX        patient_portal_invitations_scope_idx   ON patient_portal_invitations (tenant_id, facility_id, status);
```

`delivery_status` and `status` are separate columns on purpose. A row can be `delivery_status =
SENT` and `status = PENDING` for its whole life: the provider accepted the message, the patient
never activated. No query in the codebase reads `SENT` as activation.

### 2.3 `patient_portal_invitation_events`

Append-only history of what happened to an invitation.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `invitation_id` | integer NOT NULL → `patient_portal_invitations(id)` | |
| `event_type` | text NOT NULL | `CREATED`, `DELIVERY_ATTEMPTED`, `DELIVERY_SENT`, `DELIVERY_FAILED`, `DELIVERY_NOT_CONFIGURED`, `HANDED_OVER`, `REDEEMED`, `REDEEM_REJECTED`, `REVOKED`, `SUPERSEDED` |
| `detail` | text | fixed description from `describeEvent()`; never free text, never a token |
| `actor_user_id` | integer → `users(id)` | null when the patient acted |
| `ip_address` | text | |
| `created_at` | timestamp NOT NULL DEFAULT now() | |

`CREATE INDEX patient_portal_events_invitation_idx ON patient_portal_invitation_events (invitation_id);`

### 2.4 `patient_portal_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `account_id` | integer NOT NULL → `patient_portal_accounts(id)` | |
| `session_token_hash` | text NOT NULL | **UNIQUE**; 48-byte token, stored as SHA-256 |
| `ip_address`, `user_agent` | text | |
| `created_at` | timestamp NOT NULL DEFAULT now() | |
| `last_activity_at` | timestamp NOT NULL DEFAULT now() | |
| `expires_at` | timestamp NOT NULL | 2 hours |
| `revoked_at`, `revoke_reason` | | set on logout, password change, suspend, revoke |

Indexes:

```sql
CREATE UNIQUE INDEX patient_portal_sessions_token_idx   ON patient_portal_sessions (session_token_hash);
CREATE INDEX        patient_portal_sessions_account_idx ON patient_portal_sessions (account_id, expires_at DESC);
```

### 2.5 `patient_portal_settings`

One row per facility; absence means "defaults".

| Column | Type | Default | Bounds enforced in code |
|---|---|---|---|
| `facility_id` | integer NOT NULL → `facilities(id)` | — | **UNIQUE** |
| `tenant_id` | integer NOT NULL → `tenants(id)` | — | |
| `invitation_expiry_hours` | integer NOT NULL | 72 | 4–336 |
| `max_resends` | integer NOT NULL | 3 | 0–10 |
| `allow_manual_delivery` | boolean NOT NULL | true | |
| `allow_sms` | boolean NOT NULL | false | still needs a provider |
| `allow_email` | boolean NOT NULL | false | still needs a provider |
| `show_lab_results` | boolean NOT NULL | true | |
| `show_appointments` | boolean NOT NULL | true | |
| `show_prescriptions` | boolean NOT NULL | true | |
| `show_allergies` | boolean NOT NULL | true | |
| `show_discharge_summaries` | boolean NOT NULL | true | |
| `allow_downloads` | boolean NOT NULL | true | |
| `updated_by_user_id` | integer → `users(id)` | | |
| `updated_at` | timestamp NOT NULL DEFAULT now() | | |

`CREATE UNIQUE INDEX patient_portal_settings_facility_idx ON patient_portal_settings (facility_id);`

There is no column that can disable single use, expiry, hashing, audit or the session table. A test
asserts the policy object has exactly eleven keys and none named like a bypass.

### 2.6 `patient_record_sharing_grants`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `tenant_id` | integer NOT NULL → `tenants(id)` | |
| `patient_id` | integer NOT NULL → `patients(id)` | |
| `created_by_account_id` | integer NOT NULL → `patient_portal_accounts(id)` | |
| `code_hash` | text NOT NULL | **UNIQUE**; SHA-256 of the one-time code |
| `recipient_name` | text NOT NULL | 2–160 characters, validated |
| `purpose` | text NOT NULL | 3–300 characters, validated |
| `categories` | jsonb NOT NULL DEFAULT `'[]'` | drawn from eight fixed categories |
| `expires_at` | timestamp NOT NULL | 1–720 hours |
| `revoked_at` | timestamp | |
| `redeemed_at` | timestamp | single use |
| `redeemed_by_user_id` | integer → `users(id)` | |
| `created_at` | timestamp NOT NULL DEFAULT now() | |

Indexes:

```sql
CREATE UNIQUE INDEX patient_record_sharing_grants_code_idx    ON patient_record_sharing_grants (code_hash);
CREATE INDEX        patient_record_sharing_grants_patient_idx ON patient_record_sharing_grants (patient_id, created_at DESC);
```

---

## 3. Drizzle schema

`src/db/schema.ts` gained the same six definitions at the end of the file (tables 77–82 of 82).
`npm run lint` passes, so the TypeScript and SQL agree on column names and nullability where the
compiler can see it. The migration suite additionally inspects the SQL for the constraints listed
above.

`qr_token_sealed` was added to both the SQL and the schema after the initial draft, when it became
clear that storing only a hash made the patient's own card impossible to re-render. The sealed
column is the fix; the hash remains the lookup key. This is why the migration suite was re-run after
the edit.

---

## 4. What was **not** done to the database

- No existing table was altered. No column was renamed or retyped.
- No patient row was rewritten; no identifier was migrated.
- No data was seeded. There are no portal accounts, invitations or settings rows in any environment.
- No `db:clean`, no reset, no truncate, no drop. The repository's rule — preserve all records — was
  followed.
- **The migration was not applied.** `npm run db:migrate` exists and has not been run against any
  database in this environment.

---

## 5. Applying it — commands for the deployment owner (not executed here)

```bash
# 1. Back up first. Never proceed without a verified backup.
pg_dump --format=custom --file=jalicare-before-0018.dump "$DATABASE_URL"
pg_restore --list jalicare-before-0018.dump | head     # prove the dump is readable

# 2. Apply to a scratch database that was restored from that dump.
createdb jalicare_pre_0018
pg_restore --dbname=jalicare_pre_0018 jalicare-before-0018.dump
DATABASE_URL="postgresql://…/jalicare_pre_0018" npm run db:migrate
DATABASE_URL="postgresql://…/jalicare_pre_0018" npm run db:status

# 3. Check the six tables and the five unique indexes exist.
psql "postgresql://…/jalicare_pre_0018" -c "\d patient_portal_accounts"
psql "postgresql://…/jalicare_pre_0018" -c "\di patient_portal_*"

# 4. Only then repeat against the target, in a maintenance window.
```

If 0017 has not been applied either, apply it **before** 0018 — the portal's audit guarantees assume
the append-only triggers exist. `npm run db:status:all` reports which migrations the database has.

---

## 6. Rollback

There is no down migration, and this document does not invent one. The tables are new and nothing
references them from existing tables, so the safe rollback is:

1. Stop the server (or unmount `/api/portal`).
2. Restore the pre-migration dump.

Dropping the six tables would also work, and would destroy every invitation, account, session and
sharing grant recorded since deployment. That is a data-loss decision, not a technical one, and it
must be made by the facility — not by an agent running SQL.

---

## 7. Size and performance expectations

No measurements were taken, because there was no database. What can be said from the schema:

- Every portal lookup is on a unique index (`patient_id`, `login_identifier`, `token_hash`,
  `session_token_hash`, `code_hash`, `facility_id` for settings).
- The account list is scoped by `(tenant_id, facility_id, status)` and ordered by `created_at`; at
  a few thousand accounts per facility this is a trivial sort on an indexed subset. It is limited to
  50 rows per request.
- Invitation events grow linearly with invitations; the admin screen reads at most 100.
- Sessions are never deleted by this code. A housekeeping job (delete where `expires_at < now() -
  interval '90 days'`) is recommended and **not** implemented; it is part of the retention decision
  in the security audit §8.
