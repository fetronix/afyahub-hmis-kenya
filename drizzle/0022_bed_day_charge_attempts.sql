-- ============================================================
-- 0022  Bed-night identity on a skipped charge
-- ============================================================
--
-- Why this exists.
--
-- A ward stay is billed one night at a time. Each night is a separate
-- charge against the same clinical source: the admission.
--
-- `billing_charge_attempts` kept one open row per
-- (facility, source, item type). For a five-night stay with no bed
-- tariff, that meant five skipped night charges collapsed into a single
-- queue row, and the row did not say which night it was. An
-- administrator could fix the price list and reprocess exactly one
-- night; the rest were invisible.
--
-- The three columns added here are the missing identity:
--
--   idempotency_suffix  the night date, `2026-10-20`, exactly what the
--                       ordinary key (`BED_DAY:12:2026-10-20`) used.
--                       Replay therefore produces the *same* key as the
--                       original skip: a night that was billed in the
--                       meantime comes back DUPLICATE, not a second
--                       invoice line.
--   ward_type           the bed category at accrual time (`General`,
--                       `ICU`). Replay prices the same bed, and a
--                       general rate can never be applied to an ICU
--                       night because the queue forgot what it was.
--   ward_name           the ward, kept for the screen and the audit
--                       trail. Never used to price by itself.
--
-- The unique index is rebuilt so the identity includes the suffix.
-- `coalesce(..., '')` keeps the old one-open-row-per-source rule for
-- every other charge type, whose suffix is null: without it, Postgres
-- treats each null as distinct and would allow duplicate open rows.
--
-- Nullable throughout: rows written before this migration keep working,
-- and a database that runs 0020 and 0021 but not this file still bills
-- (it just stores one row per stay instead of one per night).
-- ============================================================

ALTER TABLE "billing_charge_attempts"
  ADD COLUMN IF NOT EXISTS "idempotency_suffix" text;--> statement-breakpoint

ALTER TABLE "billing_charge_attempts"
  ADD COLUMN IF NOT EXISTS "ward_type" text;--> statement-breakpoint

ALTER TABLE "billing_charge_attempts"
  ADD COLUMN IF NOT EXISTS "ward_name" text;--> statement-breakpoint

DROP INDEX IF EXISTS "billing_charge_attempts_pending_unique";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "billing_charge_attempts_pending_unique"
  ON "billing_charge_attempts" (
    "facility_id",
    "source_type",
    "source_id",
    "item_type",
    coalesce("idempotency_suffix", '')
  )
  WHERE "status" = 'PENDING' AND "source_id" IS NOT NULL;
