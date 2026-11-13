DO $$ BEGIN
  IF to_regclass('public.billing_payment_requests') IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected pre-existing receipt request schema; review migration state';
  END IF;
END $$;
--> statement-breakpoint
-- Retry identity and attribution evidence are separate from the posted receipt;
-- no existing receipt is rewritten or assigned to a party.
CREATE TABLE IF NOT EXISTS billing_payment_requests (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  invoice_id integer NOT NULL REFERENCES billing_invoices(id),
  payment_id integer NOT NULL UNIQUE REFERENCES billing_payments(id),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  request_hash text NOT NULL,
  actor_user_id integer NOT NULL REFERENCES users(id),
  result_snapshot jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (facility_id, idempotency_key)
);
--> statement-breakpoint
CREATE FUNCTION jcare_guard_payment_request_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM billing_invoices i JOIN billing_payments p ON p.invoice_id=i.id
    WHERE i.id=NEW.invoice_id AND i.tenant_id=NEW.tenant_id
      AND i.facility_id=NEW.facility_id AND p.id=NEW.payment_id FOR UPDATE OF i;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment request scope is invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_payment_request_scope_guard BEFORE INSERT ON billing_payment_requests
FOR EACH ROW EXECUTE FUNCTION jcare_guard_payment_request_scope();
--> statement-breakpoint
CREATE TRIGGER jcare_payment_request_immutable BEFORE UPDATE OR DELETE ON billing_payment_requests
FOR EACH ROW EXECUTE FUNCTION jcare_reject_invoice_evidence_change();
--> statement-breakpoint
-- An insurer-attributed receipt needs payer review, even when its channel says
-- cash or mobile money. Attribution and refunds serialize on the invoice row.
CREATE FUNCTION jcare_guard_insurer_refund() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM billing_invoices WHERE id=NEW.invoice_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM billing_payment_attributions a
             WHERE a.payment_id=NEW.payment_id AND a.party='INSURER') THEN
    RAISE EXCEPTION 'Insurer receipt requires payer reversal review' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_insurer_refund_guard BEFORE INSERT ON billing_refunds
FOR EACH ROW EXECUTE FUNCTION jcare_guard_insurer_refund();
--> statement-breakpoint
CREATE FUNCTION jcare_guard_refunded_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM billing_invoices WHERE id=NEW.invoice_id FOR UPDATE;
  IF NEW.party='INSURER' AND EXISTS (SELECT 1 FROM billing_refunds r WHERE r.payment_id=NEW.payment_id) THEN
    RAISE EXCEPTION 'A refunded receipt requires payer reversal review' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_refunded_attribution_guard BEFORE INSERT ON billing_payment_attributions
FOR EACH ROW EXECUTE FUNCTION jcare_guard_refunded_attribution();
