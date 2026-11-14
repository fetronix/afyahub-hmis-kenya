-- A clinician can select a facility-owned investigation directly. Existing
-- laboratory orders and historical specimen references are not backfilled.
ALTER TABLE "lab_orders" ADD COLUMN IF NOT EXISTS "facility_service_id" integer REFERENCES "facility_services"("id");
