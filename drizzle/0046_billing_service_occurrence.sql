-- New billing lines retain the service occurrence separately from the time
-- an invoice line was created. Historical invoices are not backfilled.
ALTER TABLE billing_items ADD COLUMN IF NOT EXISTS service_date date;
--> statement-breakpoint
ALTER TABLE billing_items ADD COLUMN IF NOT EXISTS service_performed_at timestamp;
