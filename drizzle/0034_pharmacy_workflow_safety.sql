-- Refuse unjournaled objects rather than trusting unknown table/index definitions.
DO $$
BEGIN
  IF to_regclass('pharmacy_dispense_requests') IS NOT NULL
    OR to_regclass('pharmacy_dispense_allocations') IS NOT NULL
    OR to_regclass('medication_status_events') IS NOT NULL
    OR to_regclass('pharmacy_dispense_requests_facility_key_idx') IS NOT NULL
    OR to_regclass('pharmacy_dispense_requests_dispensation_idx') IS NOT NULL
    OR to_regclass('pharmacy_dispense_allocations_batch_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'Pharmacy workflow objects already exist without this journal entry; review their definitions';
  END IF;
END $$;
--> statement-breakpoint
-- Add retry identities and batch allocations without fabricating history for
-- existing dispensations. Old records remain visible and are not rewritten.
CREATE TABLE IF NOT EXISTS "pharmacy_dispense_requests" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "dispensation_id" integer NOT NULL REFERENCES "pharmacy_dispensations"("id"),
  "stock_tracking" text NOT NULL CHECK ("stock_tracking" IN ('FEFO', 'untracked')),
  "stock_after" integer,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pharmacy_dispense_allocations" (
  "id" serial PRIMARY KEY,
  "dispensation_id" integer NOT NULL REFERENCES "pharmacy_dispensations"("id"),
  "batch_id" integer NOT NULL REFERENCES "inventory_batches"("id"),
  "batch_number" text NOT NULL,
  "expiry_date" date NOT NULL,
  "quantity" integer NOT NULL CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medication_status_events" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "medication_id" integer NOT NULL REFERENCES "medications"("id"),
  "from_status" text NOT NULL,
  "to_status" text NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pharmacy_dispense_requests_facility_key_idx" ON "pharmacy_dispense_requests" ("facility_id", "idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pharmacy_dispense_requests_dispensation_idx" ON "pharmacy_dispense_requests" ("dispensation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pharmacy_dispense_allocations_batch_idx" ON "pharmacy_dispense_allocations" ("dispensation_id", "batch_id");
