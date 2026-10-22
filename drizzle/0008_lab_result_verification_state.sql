-- ============================================================
-- 0008  Laboratory result verification state
-- ============================================================
--
-- Adds a verification state to `lab_results` and makes `verified_at`
-- nullable, so that a result can exist before anyone has verified it.
--
-- WHY EVERY STATEMENT BELOW IS GUARDED
--
-- This migration shipped unguarded, and on a database whose schema had
-- been pushed with `drizzle-kit push` (which writes the schema but not
-- the migration log) it failed with:
--
--     Postgres : 42701 — column "status" of relation "lab_results"
--                already exists
--
-- The run rolled back as a unit, so nothing was half-applied — but the
-- database could never move past 0008 either. The column is now added
-- with IF NOT EXISTS, the default and NOT NULL are set separately, and
-- the backfill is written so that running it twice changes nothing.
--
-- On a database that already has the column, the backfill still does the
-- one thing that matters: a row with a verifier recorded but a status of
-- 'Pending Verification' is promoted to 'Verified'.
--
-- Additive. No data is deleted and no other table is touched.

ALTER TABLE "lab_results"
  ALTER COLUMN "verified_at" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "lab_results"
  ADD COLUMN IF NOT EXISTS "status" text;--> statement-breakpoint

-- Fill the state from the verifier that is already recorded, and promote
-- any row that a schema push left behind as 'Pending Verification' while
-- a verifier was in fact recorded. Idempotent: the second run matches
-- nothing.
UPDATE "lab_results"
SET "status" = CASE
  WHEN "verified_by" IS NOT NULL AND btrim("verified_by") <> ''
    THEN 'Verified'
  ELSE 'Pending Verification'
END
WHERE "status" IS NULL
   OR (
     "status" = 'Pending Verification'
     AND "verified_by" IS NOT NULL
     AND btrim("verified_by") <> ''
   );--> statement-breakpoint

ALTER TABLE "lab_results"
  ALTER COLUMN "status" SET DEFAULT 'Pending Verification';--> statement-breakpoint

-- Every row has a value by now; this is the constraint, not the backfill.
ALTER TABLE "lab_results"
  ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint

-- A result with no verifier is not verified, and must not carry a
-- verification time.
UPDATE "lab_results"
SET "verified_at" = NULL
WHERE ("verified_by" IS NULL OR btrim("verified_by") = '')
  AND "verified_at" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "lab_results"
  ALTER COLUMN "verified_at" DROP DEFAULT;
