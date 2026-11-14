-- A code snapshot describes what was selected at order time; the service ID
-- remains the authoritative identity for pricing. Existing orders are not
-- backfilled or reconciled from names, current codes, specimens, or tariffs.
ALTER TABLE "lab_orders" ADD COLUMN IF NOT EXISTS "service_code" text;
