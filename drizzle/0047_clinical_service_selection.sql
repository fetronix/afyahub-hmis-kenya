-- Additive only. Existing encounters, lab tests, orders, prices and invoices are untouched.
ALTER TABLE "encounters" ADD COLUMN IF NOT EXISTS "consultation_master_service_id" integer REFERENCES "master_services"("id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lab_test_specimen_options" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "test_id" integer NOT NULL REFERENCES "lab_tests"("id"),
  "specimen_type" text NOT NULL CHECK (length(trim("specimen_type")) BETWEEN 1 AND 120),
  "review_reference" text NOT NULL CHECK (length(trim("review_reference")) BETWEEN 3 AND 500),
  "created_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "retired_by_user_id" integer REFERENCES "users"("id"),
  "retired_at" timestamp,
  "retirement_reference" text,
  CHECK (("retired_at" IS NULL AND "retired_by_user_id" IS NULL AND "retirement_reference" IS NULL) OR
         ("retired_at" IS NOT NULL AND "retired_by_user_id" IS NOT NULL AND length(trim("retirement_reference")) >= 3))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lab_test_specimen_options_active_unique" ON "lab_test_specimen_options" ("tenant_id", "facility_id", "test_id", lower(trim("specimen_type"))) WHERE "retired_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lab_order_batches" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "encounter_id" integer REFERENCES "encounters"("id"),
  "idempotency_key" text NOT NULL CHECK (length("idempotency_key") BETWEEN 16 AND 128),
  "payload_hash" text NOT NULL,
  "queue_id" integer REFERENCES "queues"("id"),
  "created_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "facility_id", "idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "lab_orders" ADD COLUMN IF NOT EXISTS "batch_id" integer REFERENCES "lab_order_batches"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lab_orders_batch_idx" ON "lab_orders"("batch_id");
