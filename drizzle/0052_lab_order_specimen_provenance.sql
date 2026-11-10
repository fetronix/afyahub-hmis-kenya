-- Preserve the explicit reviewed option chosen on new orders. Historical orders
-- are intentionally left NULL; no specimen identity is inferred or backfilled.
ALTER TABLE "lab_orders"
  ADD COLUMN IF NOT EXISTS "reviewed_specimen_option_id" integer REFERENCES "lab_test_specimen_options"("id");
