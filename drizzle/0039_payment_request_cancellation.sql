DO $$ BEGIN
  IF to_regclass('public.billing_payment_request_cancellations') IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected pre-existing cancellation schema; review migration state';
  END IF;
END $$;
--> statement-breakpoint
-- A durable tombstone serializes an operator's cancellation with a late
-- receipt request. It never cancels a provider transaction or transfers cash.
CREATE TABLE IF NOT EXISTS billing_payment_request_cancellations (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  invoice_id integer NOT NULL REFERENCES billing_invoices(id),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  actor_user_id integer NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(facility_id, idempotency_key)
);
--> statement-breakpoint
CREATE FUNCTION jcare_guard_payment_cancellation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM billing_invoices WHERE id=NEW.invoice_id AND tenant_id=NEW.tenant_id
    AND facility_id=NEW.facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment cancellation scope is invalid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_payment_cancellation_scope_guard BEFORE INSERT ON billing_payment_request_cancellations
FOR EACH ROW EXECUTE FUNCTION jcare_guard_payment_cancellation_scope();
--> statement-breakpoint
CREATE TRIGGER jcare_payment_cancellation_immutable BEFORE UPDATE OR DELETE ON billing_payment_request_cancellations
FOR EACH ROW EXECUTE FUNCTION jcare_reject_invoice_evidence_change();
