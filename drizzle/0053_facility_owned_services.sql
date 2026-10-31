-- Facility-owned services are additive. Existing master, tariff, clinical,
-- invoice, payer and audit records are deliberately not rewritten or removed.
CREATE TABLE IF NOT EXISTS "facility_services" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL,
  "code" text NOT NULL CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._/-]{0,79}$'),
  "name" text NOT NULL CHECK (length(trim("name")) BETWEEN 1 AND 200),
  "description" text NOT NULL CHECK (length(trim("description")) BETWEEN 1 AND 500),
  "department" text NOT NULL CHECK (length(trim("department")) BETWEEN 1 AND 100),
  "category" text NOT NULL CHECK ("category" IN ('CONSULTATION','LABORATORY','RADIOLOGY','PHARMACY','PROCEDURE','ADMISSION','BED_DAY','DELIVERY','OTHER')),
  "unit" text NOT NULL CHECK (length(trim("unit")) BETWEEN 1 AND 50),
  "is_active" boolean NOT NULL DEFAULT true,
  "auto_bill" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "facility_services_scope_fk" FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id"),
  CONSTRAINT "facility_services_code_unique" UNIQUE ("facility_id", "code"),
  CONSTRAINT "facility_services_identity_scope_unique" UNIQUE ("id", "facility_id", "tenant_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "facility_services_scope_department_idx" ON "facility_services" ("tenant_id", "facility_id", "department", "is_active");
--> statement-breakpoint
ALTER TABLE "facility_service_tariffs" ADD COLUMN IF NOT EXISTS "facility_service_id" integer;
--> statement-breakpoint
ALTER TABLE "facility_service_tariffs" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
--> statement-breakpoint
ALTER TABLE "facility_service_tariffs" ADD COLUMN IF NOT EXISTS "archived_by_user_id" integer REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "facility_service_tariffs" ADD CONSTRAINT "facility_tariff_service_scope_fk"
  FOREIGN KEY ("facility_service_id", "facility_id", "tenant_id")
  REFERENCES "facility_services" ("id", "facility_id", "tenant_id");
--> statement-breakpoint
-- An active service has at most one active tariff. No row-order price guessing.
CREATE UNIQUE INDEX IF NOT EXISTS "facility_tariff_active_service_unique" ON "facility_service_tariffs" ("facility_id", "facility_service_id")
  WHERE "facility_service_id" IS NOT NULL AND "is_active" AND "archived_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN IF NOT EXISTS "consultation_facility_service_id" integer REFERENCES "facility_services"("id");
--> statement-breakpoint
ALTER TABLE "radiology_orders" ADD COLUMN IF NOT EXISTS "facility_service_id" integer REFERENCES "facility_services"("id");
--> statement-breakpoint
ALTER TABLE "billing_items" ADD COLUMN IF NOT EXISTS "facility_service_id" integer REFERENCES "facility_services"("id");
