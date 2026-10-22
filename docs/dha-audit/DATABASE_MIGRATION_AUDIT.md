# Database and Migration Audit

**Audit date:** 21 October 2026
**Engine:** PostgreSQL (via `pg` 8.23.1) — **not SQLite**
**ORM:** Drizzle ORM 0.45.3, drizzle-kit 0.31.11

---

## 1. What could and could not be checked

| Check | Method | Result |
|---|---|---|
| Schema definition | Read `src/db/schema.ts` | 76 tables after 0017, 211 `.references()` |
| Migration SQL | Read all 18 files in `drizzle/` | 76 tables created, 212 `REFERENCES` |
| Journal consistency | JSON parse + comparison | 18 entries = 18 files |
| Schema ↔ migration table parity | Static name comparison | **75 = 75, no gaps** |
| Destructive statements | Text scan | 1 `DROP COLUMN`, 0 `DROP TABLE`, 0 `TRUNCATE`, 0 `DELETE FROM` |
| Live database | `npm run db:status` | **BLOCKED** — no `SQL_HOST` |
| Applied-migration state | — | **UNVERIFIED** |
| Seed idempotency | Code reading + existing test | Partial — see §5 |

**No database was contacted. No migration was executed.** Every statement about a
live database below is either marked UNVERIFIED or BLOCKED.

---

## 2. Schema and migration parity

```
schema tables           84   (0017 adds patient_allergies, 0018 adds six portal
                             tables, 0020 adds billing_charge_attempts, 0021
                             adds service_tariff_links)
tables created by SQL   84
missing from migrations 0
extra in migrations     0
journal entries         22
.sql files              22
```

The figures above were 75 / 17 at audit time, 76 / 18 after migration `0017` was
written, 82 / 19 after `0018` (patient portal), 82 / 20 after `0019` (tariff
billing links, which adds a column rather than a table), 83 / 21 after `0020`
(`billing_charge_attempts`, the queue of charges that could not be priced), and
84 / 22 after `0021` (`service_tariff_links`, plus validity dates and the
automatic-billing flag on tariffs). None of 0017–0021 has been executed against
any database; the parity check is static, and `npm run test:migrations` (741
assertions) passes against the files, not a server.

Three tables were initially reported missing by a naive scan —
`admission_transfers`, `dha_service_mappings`, `nursing_notes` — because they are
created with an unquoted `CREATE TABLE IF NOT EXISTS name (` form. Direct
inspection confirmed all three exist:

- `drizzle/0009_billing_provenance_and_inpatient.sql:96` — `admission_transfers`
- `drizzle/0013_dha_service_mappings.sql:17` — `dha_service_mappings`
- `drizzle/0009_billing_provenance_and_inpatient.sql:120` — `nursing_notes`

**No schema drift was found in the table set.**

### 2.1 Foreign keys

| Fact | Value |
|---|---|
| `.references()` declarations in schema | 211 |
| `REFERENCES` clauses in SQL | 212 |
| Unique constraints | 52 |

The one-clause difference is a column declared with two references or a
constraint written inline; it does not indicate a missing table. A live
`information_schema` comparison is required to confirm enforcement, which is
BLOCKED.

---

## 3. Migrations, in order

| # | File | Notable content |
|---|---|---|
| 0000 | `new_vertigo` | Base schema: patients, encounters, orders, billing, audit |
| 0001 | `unknown_gambit` | Sessions, invitations, login attempts, facility onboarding |
| 0002 | `friendly_lady_deathstrike` | Patient identity rework; **drops `patients.facility_id`** |
| 0003 | `facility_subscription_billing` | Subscription periods and access |
| 0004 | — | (journal entry present) |
| 0005 | `facility_service_tariffs` | Facility tariffs |
| 0006 | `patient_guardian_and_optional_phone` | Guardian fields |
| 0007 | — | |
| 0008 | `lab_result_verification_state` | Verification/publication |
| 0009 | `billing_provenance_and_inpatient` | Admissions, transfers, nursing notes |
| 0010 | — | |
| 0011 | `insurance_claims_workflow` | Claims |
| 0012 | `dha_integration_audit` | DHA audit trail |
| 0013 | `dha_service_mappings` | Service-area mapping |
| 0014 | `professional_verification` | Practitioner verification |
| 0015 | `maternity_mch` | Antenatal, labour, delivery |
| 0016 | `postnatal_immunisation` | Postnatal and immunisation |
| 0017 | `consent_allergy_audit_integrity` | Append-only audit triggers, `patient_allergies`, blind-index columns. **Added 2026-10-21 evening; not applied** |
| 0018 | `patient_portal` | Six tables: `patient_portal_accounts`, `patient_portal_invitations`, `patient_portal_invitation_events`, `patient_portal_sessions`, `patient_portal_settings`, `patient_record_sharing_grants`. Correction requests and portal access history reuse `audit_logs` and `patient_record_access_logs`, so no second audit or second record store was created. **Added 2026-10-22; not applied** |
| 0019 | `service_tariff_billing_key` | Adds `facility_service_tariffs.billing_key` and a partial unique index so one active tariff answers each automatic charge. **Added 2026-10-22; not applied** |
| 0020 | `billing_charge_attempts` | One table: the charges the engine could not price, holding the original request so they can be retried after the tariff is fixed. Partial unique index keeps one `PENDING` row per clinical source; nothing is deleted, a write-off sets `VOID`. **Added 2026-10-22; not applied** |
| 0021 | `service_tariff_links` | Links a catalogue service (by stable id — `lab_tests.id`) to an existing tariff, with a composite FK `(facility_id, tariff_id)` so a link cannot cross facilities. Adds `effective_from`, `effective_to` and `auto_bill` to `facility_service_tariffs`, all additive. **Added 2026-10-22; not applied** |

### 3.1 The one destructive statement

```sql
-- drizzle/0002_friendly_lady_deathstrike.sql:289
ALTER TABLE "patients" DROP COLUMN "facility_id";
```

This is a deliberate normalisation: the column is replaced by
`patients.registration_facility_id` and the `patient_facilities` join table.

**Risk:** on an existing installation, any value in `patients.facility_id` is lost
when 0002 applies unless it has been copied forward first. For a fresh database
this is harmless; for an upgrade it requires a verified backup and a pre-flight
query.

**Pre-flight check (read-only):**

```sql
SELECT count(*) AS rows_with_old_facility
FROM patients
WHERE facility_id IS NOT NULL;
```

If that count is greater than zero on a database that has not yet applied 0002,
stop and migrate the values into `registration_facility_id` first. (On databases
already at 0002 the column no longer exists and the query will error, which is
expected.)

### 3.2 Idempotency

The base migrations (`0000`–`0002`) use bare `CREATE TABLE`, which is normal for
drizzle-generated base migrations and correct for a fresh database. They are
**not** safe to re-run by hand. Later migrations use `IF NOT EXISTS` for tables and
indexes (39 of 153 index statements are explicitly idempotent).

Apply through the documented runner, never by pasting files into `psql` twice.

### 3.3 Migration 0017 — consent, allergies and audit integrity

Written on 2026-10-21 evening and **not executed anywhere**. It is idempotent
throughout (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`
before each `CREATE TRIGGER`), so a second run is a no-op rather than an error.

| Change | Effect |
|---|---|
| `jalicare_audit_is_append_only()` + row trigger + statement trigger on `audit_logs` | `UPDATE`, `DELETE` and `TRUNCATE` raise; `INSERT` is untouched |
| `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs` | Removes the privilege even if a future trigger is dropped |
| `patient_allergies` | Tenant, facility and patient foreign keys; `allergen_type`, `allergen`, `reaction`, `severity`, `status`, `recorded_by_user_id`, `resolved_at` |
| `patients.national_id_bidx`, `patients.sha_number_bidx` | Nullable text columns for the HMAC blind index |
| `patients_national_id_bidx_idx`, `patients_sha_number_bidx_idx` | Partial indexes (`WHERE ... IS NOT NULL`) so existing rows cost nothing |

**Order of operations when it is applied.** Take a verified backup; run 0017
through `npm run db:migrate`; then, and only then, set `FIELD_ENCRYPTION_KEY`. The
columns are nullable and the application passes plaintext through, so the reverse
order (key first, migration later) would make every insert fail on a missing column.
Backfilling existing identifiers is a separate, deliberate job: it rewrites patient
rows, and it must be run once, logged, and counted before and after.

**Privilege caveat.** `REVOKE ... FROM PUBLIC` does not stop the table owner or a
superuser. If the application connects as the owner — this repository's default —
the trigger is the control that matters, and it is the reason both exist.

---

## 4. Integrity risks observed in the schema

| Risk | Detail | Severity |
|---|---|---|
| Audit immutability | No trigger or privilege restriction on `audit_logs` | High |
| Consent table unused | `patient_consents` has no writer | Critical for privacy |
| Access-log table unused | `patient_record_access_logs` has no writer | High |
| Duplicate patients | No unique constraint on `(tenant_id, national_id)` where national id is present; dedupe is a UI warning | High |
| Soft-deleted patients | `merged_into_patient_id` exists; no merge routine found | Medium |
| Orphan records | Not measurable without a live database | BLOCKED |
| Clinical tables carry facility | Verified by inspection for encounters, orders, admissions, maternity, claims, audit | Good |

**Index coverage:** 153 index statements for 75 tables, including tenant, facility,
user, action and timestamp indexes on `audit_logs`. No missing index is asserted
without `EXPLAIN`, which requires the database.

---

## 5. Seeds

| Script | Command | Idempotency |
|---|---|---|
| Base demo data | `npm run db:seed` | **No.** Inserts tenants and facilities unconditionally; running twice duplicates them. |
| Permissions | `npm run db:seed:permissions` | **Yes.** Checks for an existing grant before inserting; adds new codes. |
| Inpatient permissions | `npm run db:grant-inpatient-permissions` | Checks before inserting |

**Consequence:** `db:seed` is a demo bootstrap, not a repeatable migration. It must
never be run against a database that holds real data. This is stated in the README
and repeated here because it is the most likely way to damage a live installation.

A new permission, `facilities.modules.manage`, was added to the permission seed in
this audit. It is granted by re-running `db:seed:permissions`, which is idempotent.

---

## 6. Required procedure before any migration

1. Take a backup and **verify the backup restores** in an isolated database.
2. Record `npm run db:status` output.
3. Apply to a **copy** first, never to production.
4. Re-run `npm run db:status` and confirm nothing is pending.
5. Only then apply to production, during a window, with the application stopped or
   draining.

Commands (execute these yourself; this audit ran none of them):

```bash
pg_dump --format=custom --file=jalicare-$(date +%F).dump "$DATABASE_URL"
pg_restore --list jalicare-$(date +%F).dump | head   # proves the file is readable

npm run db:status          # what is pending, per the journal
npm run db:migrate         # the project runner
npm run db:status          # must report nothing pending
```

**Do not** run `drizzle-kit migrate` directly without reading README §10.5: the
project runner exists for a reason.

---

## 7. Residual database risks

| Risk | Status |
|---|---|
| Live schema matches migrations | **UNVERIFIED** — requires a database |
| Foreign keys enforced at runtime | **UNVERIFIED** — engine-dependent, assumed on PostgreSQL |
| Orphaned rows | **UNVERIFIED** |
| Transactional integrity under concurrency | **PARTIAL** — billing and claims use transactions; stock paths untested |
| Backup and restore | **MISSING** — see `DEPLOYMENT_AND_RECOVERY.md` |
| Audit immutability | **PARTIAL** — migration 0017 written and statically tested; not applied |
| Portal tables exist in the database | **NO** — migration 0018 unapplied, so every portal query would fail on a fresh database |
