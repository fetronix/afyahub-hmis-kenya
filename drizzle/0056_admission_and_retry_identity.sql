-- Preserve retry semantics across future service changes without rewriting
-- historical encounter request hashes or inferring past admission services.
ALTER TABLE "encounter_creation_requests" ADD COLUMN IF NOT EXISTS "payload_version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "admissions" ADD COLUMN IF NOT EXISTS "facility_service_id" integer REFERENCES "facility_services"("id");
