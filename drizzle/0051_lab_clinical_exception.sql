-- An explicitly unmatched clinical exception must never acquire a charge solely
-- through a name match or an unreviewed test_id. Existing rows are not recoded.
ALTER TABLE "lab_orders"
  ADD COLUMN IF NOT EXISTS "clinical_exception" boolean NOT NULL DEFAULT false;
