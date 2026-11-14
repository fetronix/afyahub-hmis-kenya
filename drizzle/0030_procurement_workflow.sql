-- Additive only: existing amount-only orders and supplier references are preserved.
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "expected_delivery_date" date;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "delivery_address" text;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "payment_terms" text;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "subtotal_amount" numeric(12,2);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "tax_amount" numeric(12,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "shipping_amount" numeric(12,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "discount_amount" numeric(12,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "created_by_user_id" integer REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_order_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "purchase_order_id" integer NOT NULL REFERENCES "purchase_orders"("id"),
  "line_number" integer NOT NULL,
  "description" text NOT NULL,
  "quantity" numeric(12,3) NOT NULL,
  "unit" text NOT NULL,
  "unit_price" numeric(12,2) NOT NULL,
  "line_total" numeric(12,2) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "purchase_order_items_quantity_chk" CHECK ("quantity" > 0),
  CONSTRAINT "purchase_order_items_price_chk" CHECK ("unit_price" >= 0 AND "line_total" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_items_order_idx" ON "purchase_order_items" ("purchase_order_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_order_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "purchase_order_id" integer NOT NULL REFERENCES "purchase_orders"("id"),
  "event_type" text NOT NULL,
  "from_status" text,
  "to_status" text,
  "actor_user_id" integer REFERENCES "users"("id"),
  "note" text,
  "details" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_order_events_order_idx" ON "purchase_order_events" ("purchase_order_id");
