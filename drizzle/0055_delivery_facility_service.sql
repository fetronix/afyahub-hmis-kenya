-- An optional explicit facility-owned delivery identity. Existing deliveries
-- and financial records are preserved and deliberately not backfilled.
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "facility_service_id" integer REFERENCES "facility_services"("id");
