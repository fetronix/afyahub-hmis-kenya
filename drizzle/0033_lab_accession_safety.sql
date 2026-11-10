-- A laboratory accession identifies one order within a facility. This is an
-- additive guard only: do not rewrite or deduplicate existing clinical history.
-- Facilities with shared or duplicate historical accession numbers must have
-- an authorized laboratory-led reconciliation and policy review first.
DO $$
BEGIN
  IF to_regclass('lab_orders_facility_accession_uq') IS NOT NULL THEN
    RAISE EXCEPTION 'Laboratory accession index already exists without this journal entry; review its definition';
  END IF;
  IF EXISTS (
    SELECT 1 FROM lab_orders
    WHERE sample_accession_number IS NOT NULL AND btrim(sample_accession_number) <> ''
    GROUP BY facility_id, lower(btrim(sample_accession_number)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate laboratory accessions require authorized reconciliation before applying the accession guard';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lab_orders_facility_accession_uq"
  ON "lab_orders" ("facility_id", lower(btrim("sample_accession_number")))
  WHERE "sample_accession_number" IS NOT NULL AND btrim("sample_accession_number") <> '';
