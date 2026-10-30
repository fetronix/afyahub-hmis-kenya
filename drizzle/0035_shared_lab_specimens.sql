-- Refuse unjournaled objects rather than trusting unknown table/index/guard definitions.
DO $$
BEGIN
  IF to_regclass('lab_specimens') IS NOT NULL
    OR to_regclass('lab_specimen_orders') IS NOT NULL
    OR to_regclass('lab_specimens_facility_accession_uq') IS NOT NULL
    OR to_regclass('lab_specimen_orders_order_uq') IS NOT NULL
    OR to_regprocedure('guard_lab_order_accession_identity()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'lab_orders'::regclass
               AND tgname = 'lab_order_accession_identity_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Laboratory specimen objects already exist without this journal entry; review their definitions';
  END IF;
END $$;
--> statement-breakpoint
-- Explicit specimen identity permits a collected specimen to serve multiple
-- orders for the same patient. Historical orders are not inferred or rewritten.
CREATE TABLE IF NOT EXISTS "lab_specimens" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "accession_number" text NOT NULL,
  "collected_at" timestamp NOT NULL,
  "collected_by_user_id" integer NOT NULL REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lab_specimens_facility_accession_uq"
  ON "lab_specimens" ("facility_id", lower(btrim("accession_number")));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lab_specimen_orders" (
  "id" serial PRIMARY KEY,
  "specimen_id" integer NOT NULL REFERENCES "lab_specimens"("id"),
  "order_id" integer NOT NULL REFERENCES "lab_orders"("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lab_specimen_orders_order_uq" ON "lab_specimen_orders" ("order_id");
--> statement-breakpoint
-- The previous guard was created by migration 0033. The trigger below replaces
-- it while protecting the same legacy rows and allowing explicit shared links.
DROP INDEX "lab_orders_facility_accession_uq";
--> statement-breakpoint
CREATE FUNCTION "guard_lab_order_accession_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sample_accession_number IS NULL OR btrim(NEW.sample_accession_number) = '' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lab:' || NEW.facility_id::text || ':' || lower(btrim(NEW.sample_accession_number)), 0));
  IF EXISTS (
    SELECT 1 FROM lab_orders existing_order
    WHERE existing_order.facility_id = NEW.facility_id AND existing_order.id <> NEW.id
      AND lower(btrim(existing_order.sample_accession_number)) = lower(btrim(NEW.sample_accession_number))
      AND NOT (
        existing_order.patient_id = NEW.patient_id AND existing_order.tenant_id = NEW.tenant_id AND EXISTS (
          SELECT 1 FROM lab_specimen_orders new_link
          JOIN lab_specimen_orders old_link ON old_link.specimen_id = new_link.specimen_id
          WHERE new_link.order_id = NEW.id AND old_link.order_id = existing_order.id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Laboratory accession belongs to a different specimen' USING ERRCODE = '23505', CONSTRAINT = 'lab_orders_accession_identity_guard';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "lab_order_accession_identity_guard" BEFORE INSERT OR UPDATE OF "sample_accession_number", "facility_id", "patient_id", "tenant_id"
  ON "lab_orders" FOR EACH ROW EXECUTE FUNCTION "guard_lab_order_accession_identity"();
