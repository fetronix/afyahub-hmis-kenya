-- Request identity only; existing orders, reports and invoices are not changed.
CREATE TABLE IF NOT EXISTS "radiology_order_requests" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "idempotency_key" text NOT NULL CHECK (length("idempotency_key") BETWEEN 16 AND 128),
  "payload_hash" text NOT NULL,
  "order_id" integer REFERENCES "radiology_orders"("id"),
  "created_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "facility_id", "idempotency_key")
);
