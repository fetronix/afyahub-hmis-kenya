# Tariff-Driven Automatic Invoicing

**Status:** implemented, not yet runtime-verified against PostgreSQL
**Migration:** `drizzle/0009_billing_provenance_and_inpatient.sql`
**Engine:** `src/billing/billing.service.ts`

---

## 1. What changed

Before this work, the only automatic invoice in the system was created **in
the browser** by `PharmacyModule.tsx`, using a hardcoded unit price of
`KES 15` and a `Date.now()` invoice number. Nothing else in the system
produced a bill: consultations, laboratory orders, procedures, radiology
and inpatient stays were all free by default.

Billing is now raised **server-side** at the moment the clinical event
occurs, priced from the facility's own `facility_service_tariffs` table.

| Clinical event | Source type | Raised on |
|---|---|---|
| Encounter created (non-inpatient) | `CONSULTATION` | `POST /api/encounters` |
| Laboratory order | `LAB_ORDER` | `POST /api/lab-orders` |
| Procedure recorded | `PROCEDURE` | `POST /api/procedures` |
| Radiology order | `RADIOLOGY` | `POST /api/radiology-orders` |
| Medication dispensed | `PHARMACY` | `POST /api/pharmacy/dispense` |
| Patient admitted | `ADMISSION` | `POST /api/admissions` |
| Each night of the stay | `BED_DAY` | discharge, transfer, or on demand |

---

## 2. How a price is determined

### 2.1 Precedence

1. **Active facility tariff** matching one of the candidate codes — wins.
2. If no tariff matches:
   - Pharmacy uses the medication's own `unitPrice` as a fallback.
   - Every other service is **not billed**, and the response says so.
3. **No price is ever invented.** A zero-priced tariff is treated as
   "not configured", not as free care.

### 2.2 Candidate codes

Tariff codes are free text entered by a facility admin, so the engine
tries several plausible codes in order and the first configured one wins.

| Service | Candidate codes, in order |
|---|---|
| Consultation | `CONSULT-<ENCOUNTER_TYPE>`, `OPD-CONSULT`, `CONSULTATION`, `CONSULT` |
| Laboratory | `LAB-<TEST NAME>`, `<TEST NAME>`, `LAB-GENERAL`, `LABORATORY` |
| Procedure | `PROC-<NAME>`, `<NAME>`, `PROCEDURE`, `PROC-GENERAL` |
| Radiology | `RAD-<NAME>`, `<NAME>`, `RADIOLOGY`, `RAD-GENERAL`, `IMAGING` |
| Pharmacy | `DRUG-<NAME>`, `<NAME>`, `PHARMACY`, `MEDICATION` |
| Admission | `ADMIT-<WARD CODE>`, `ADMISSION`, `INPATIENT-ADMISSION` |
| Bed night | `BED-<WARD CODE>`, `WARD-<WARD CODE>`, `BED-DAY`, `INPATIENT-BED-DAY`, `WARD-DAY`, `BED` |

Names are normalised: uppercased, non-alphanumerics collapsed to `-`.
A test named `Full Haemogram` becomes `LAB-FULL-HAEMOGRAM`.

### 2.3 Ward-specific bed rates

`BED-ICU` will be used for a ward whose code is `ICU`; if that tariff does
not exist the engine falls back to `BED-DAY`. This allows an ICU night to
cost more than a general ward night without touching code.

---

## 3. Idempotency — the double-billing guard

Every engine-generated line carries an `idempotency_key`:

```
LAB_ORDER:42
BED_DAY:7:2026-10-21
```

Migration 0009 adds a **UNIQUE index** on that column, so a replayed
event cannot create a second charge even under concurrent requests.

It is intentionally *not* a partial index: PostgreSQL treats NULLs as
distinct in a UNIQUE index, so manually entered items stay unconstrained,
while `ON CONFLICT (idempotency_key)` can still infer the index. A
partial index would fail with "no unique or exclusion constraint matching
the ON CONFLICT specification". Re-dispensing, re-saving an order, re-running a discharge or
calling bed-day accrual repeatedly all bill exactly once.

Manual invoice items created by a cashier leave the key NULL and are
therefore unconstrained, exactly as before.

---

## 4. Invoice lifecycle

- Charges for the same encounter accumulate on **one open invoice**, so a
  patient leaves with a single bill.
- Totals are **derived** by summing line items (`recalculateInvoiceTotals`),
  never incremented, so they cannot drift from what the patient can see.
- Invoice numbers come from a database sequence (`billing_invoice_number_seq`),
  so concurrent cashiers cannot collide on `INV-000123`.
- `POST /api/invoices/:id/void` voids rather than deletes. A paid invoice
  must have its payment reversed first.
- `GET /api/invoices/:id` returns the header, the lines with their clinical
  provenance, and all payments.
- `GET /api/analytics/revenue` returns revenue by service category,
  excluding voided invoices.

---

## 5. Billing never blocks care

Every charge is wrapped in `chargeSafely()`. A missing tariff, a closed
invoice, a duplicate or a database fault is logged and returned to the
caller as `billing.message`. **The clinical action still succeeds.**

A patient is never refused admission because a tariff row is missing.

---

## 6. Applying the migration

Run this yourself, against the database your `.env` points at. Nothing in
the application applies migrations on boot.

### Windows / PowerShell

```powershell
# 0. What does this database still owe?
npm run db:status

# 1. Back up first.
#    PowerShell cannot use `set -a; . ./.env`, so load the keys directly:
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}

# pg_dump is usually not on PATH; find it in the PostgreSQL install:
$pgbin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Recurse -Filter pg_dump.exe `
           -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName

& $pgbin -Fc -h $env:SQL_HOST -p $env:SQL_PORT -U $env:SQL_ADMIN_USER `
         -d $env:SQL_DB_NAME -f "backup-before-0009-$(Get-Date -Format yyyyMMdd-HHmm).dump"

# 2. Apply
npm run db:migrate

# 3. Prove the structures exist (exits 1 if anything is missing)
npm run db:status:0009

# 4. Backfill inpatient permissions for EXISTING tenant roles.
npx tsx scripts/grant-inpatient-permissions.ts --dry-run
npx tsx scripts/grant-inpatient-permissions.ts
```

### Linux / macOS / cPanel SSH

```bash
npm run db:status

set -a; . ./.env; set +a
pg_dump -Fc -U "$SQL_ADMIN_USER" -h "$SQL_HOST" -p "$SQL_PORT" \
  "$SQL_DB_NAME" > "backup-before-0009-$(date +%Y%m%d-%H%M).dump"

npm run db:migrate
npm run db:status:0009
```

`npm run db:migrate` runs `scripts/migrate.ts`, which prints each statement
and names the exact one that fails. `npm run db:migrate:drizzle` runs the
stock `drizzle-kit migrate`.

### Why not just use `drizzle-kit migrate`?

It does work, but two failure modes cost real time:

1. **Errors are swallowed.** drizzle-kit renders the migration through a
   terminal spinner and calls `process.exit(1)` from the catch without
   waiting for the error to be written. In a non-interactive shell — any
   Windows PowerShell, most CI — you see the connection line, then the
   prompt, and no error at all. The migration has rolled back.
2. **A UTF-8 BOM kills the whole run.** Migration 0008 was saved with a
   BOM. PostgreSQL rejects the leading U+FEFF, the transaction rolls back,
   and 0009 never runs. That is why 0008 and 0009 showed as pending with
   every structure missing. The BOM is gone; `npm run test:migrations`
   now fails if any `.sql` file regains one.

`npm run db:migrate` strips a BOM with a warning and reports the failing
statement, so the same fault is visible instead of silent.

What to expect while it runs: every `ALTER TABLE ... ADD COLUMN` is
metadata-only (nullable, no default), so existing rows are not rewritten.
`CREATE UNIQUE INDEX billing_items_idempotency_key_unique` briefly blocks
writes to `billing_items`; the column is new, so it contains only NULLs and
the build cannot fail on duplicates. The final `UPDATE` stamps existing
manual lines as `'MANUAL'` and is the only statement that touches row data.

If `pg_dump` is not installed, back up with cPanel → phpPgAdmin → Export,
or skip step 1 only on a database you can afford to rebuild. Do not run the
migration on a production database without a dump.

### Known pre-existing issue
`drizzle/meta` has no snapshots for migrations `0004`, `0007` and `0008`.
`drizzle-kit migrate` reads `_journal.json` and the SQL files, so applying
is unaffected — but `drizzle-kit generate` will produce a spurious diff
until those snapshots are regenerated. Resolve that before generating any
future migration from the schema.

### Rollback
The migration is additive except for the `verified_at`-style column drops
it does not perform. To roll back:

```sql
DROP TABLE IF EXISTS nursing_notes;
DROP TABLE IF EXISTS admission_transfers;
DROP SEQUENCE IF EXISTS billing_invoice_number_seq;
ALTER TABLE billing_invoices DROP COLUMN IF EXISTS voided_at, DROP COLUMN IF EXISTS void_reason;
ALTER TABLE billing_items DROP COLUMN IF EXISTS idempotency_key, DROP COLUMN IF EXISTS source_id, DROP COLUMN IF EXISTS source_type;
ALTER TABLE admissions DROP COLUMN IF EXISTS discharged_by, DROP COLUMN IF EXISTS discharge_disposition;
```

---

## 7. Configuring tariffs for a real facility

The engine bills nothing until tariffs exist. Minimum viable set:

| Code | Department | Suggested fee |
|---|---|---|
| `OPD-CONSULT` | OPD | 500.00 |
| `LAB-GENERAL` | Laboratory | 800.00 |
| `RADIOLOGY` | Radiology | 1500.00 |
| `PROCEDURE` | OPD | 2000.00 |
| `ADMISSION` | Inpatient | 1000.00 |
| `BED-DAY` | Inpatient | 1500.00 |
| `BED-ICU` | Inpatient | 8000.00 |
| `PHARMACY` | Pharmacy | per-drug, or leave unset to use the drug price |

Enter these through **Configuration → Service Tariffs**, or `POST /api/service-tariffs`
with the `tariffs.manage` permission.

---

## 8. What was NOT implemented

| Item | Status |
|---|---|
| SHA / NHIF claim submission | Not implemented. `insurance_claims` captures claims; there is no submission, adjudication or remittance reconciliation. |
| Payer split (insurance vs self-pay per line) | Not implemented. The invoice carries a single `payerType`. |
| Cashier shift reconciliation | Not implemented. |
| Pre-authorisation | Not implemented. |
| Insurance coverage rules | Not implemented. |
| Credit notes / refunds | Void only. |
| Report exports (MOH 705/731) | Not implemented. |

These are honest gaps, not oversights to be discovered later.
