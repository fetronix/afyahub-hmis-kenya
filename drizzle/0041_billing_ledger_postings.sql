-- Additive, fail-closed reviewed source linkage. No historical journals or
-- financial transactions are modified or backfilled. Resolve existing source
-- duplicates before applying this migration to any non-synthetic database.
DO $$
BEGIN
  IF to_regclass('accounting_billing_postings') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname=current_schema() AND p.proname IN ('jcare_billing_posting_guard','jcare_guard_accounted_payment','jcare_guard_accounted_invoice_void','jcare_guard_billing_reversal')) THEN
    RAISE EXCEPTION 'Unexpected pre-existing billing ledger objects; review migration state';
  END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE source_type IN ('BILLING_INVOICE','BILLING_PAYMENT','BILLING_REFUND')
      AND source_id IS NOT NULL GROUP BY facility_id,source_type,source_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate source-linked billing journals require manual review';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS accounting_billing_postings (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  source_type text NOT NULL CHECK (source_type IN ('BILLING_INVOICE','BILLING_PAYMENT','BILLING_REFUND')),
  source_id integer NOT NULL CHECK (source_id > 0),
  invoice_id integer NOT NULL REFERENCES billing_invoices(id),
  payment_id integer REFERENCES billing_payments(id),
  journal_id integer NOT NULL UNIQUE REFERENCES journal_entries(id),
  party text CHECK (party IN ('PATIENT','INSURER')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  receivable_cents bigint NOT NULL CHECK (receivable_cents >= 0),
  liability_cents bigint NOT NULL CHECK (liability_cents >= 0),
  classification jsonb NOT NULL,
  request_hash text NOT NULL,
  actor_user_id integer NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT accounting_billing_posting_scope_fk FOREIGN KEY (facility_id,tenant_id) REFERENCES facilities(id,tenant_id),
  CONSTRAINT accounting_billing_posting_source_unique UNIQUE (facility_id,source_type,source_id),
  CONSTRAINT accounting_billing_posting_allocation_chk CHECK (
    (source_type='BILLING_INVOICE' AND party IS NULL AND payment_id IS NULL AND receivable_cents=amount_cents AND liability_cents=0)
    OR (source_type IN ('BILLING_PAYMENT','BILLING_REFUND') AND party IS NOT NULL AND payment_id IS NOT NULL AND receivable_cents+liability_cents=amount_cents)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS accounting_billing_postings_invoice_idx ON accounting_billing_postings (tenant_id,facility_id,invoice_id,id);
--> statement-breakpoint
CREATE FUNCTION jcare_billing_posting_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j journal_entries%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Source postings are immutable; use a controlled journal reversal' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM billing_invoices i WHERE i.id=NEW.invoice_id AND i.tenant_id=NEW.tenant_id AND i.facility_id=NEW.facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Billing posting invoice scope is invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO j FROM journal_entries WHERE id=NEW.journal_id;
  IF NOT FOUND OR j.tenant_id<>NEW.tenant_id OR j.facility_id<>NEW.facility_id OR j.status<>'POSTED'
     OR j.source_type IS DISTINCT FROM NEW.source_type OR j.source_id IS DISTINCT FROM NEW.source_id::text
     OR j.total_debit_cents<>NEW.amount_cents OR j.total_credit_cents<>NEW.amount_cents THEN
    RAISE EXCEPTION 'Billing posting journal scope or amount is invalid' USING ERRCODE='23514';
  END IF;
  IF NEW.source_type='BILLING_INVOICE' AND NOT EXISTS (
    SELECT 1 FROM billing_invoices i JOIN billing_invoice_finalizations f ON f.invoice_id=i.id
    WHERE i.id=NEW.source_id AND i.id=NEW.invoice_id AND i.tenant_id=NEW.tenant_id
      AND i.facility_id=NEW.facility_id AND i.voided_at IS NULL AND i.status <> 'Void'
      AND f.tenant_id=NEW.tenant_id AND f.facility_id=NEW.facility_id
      AND (f.patient_responsibility+f.insurer_responsibility)*100=NEW.amount_cents
  ) THEN
    RAISE EXCEPTION 'Finalized invoice source or amount does not match' USING ERRCODE='23514';
  ELSIF NEW.source_type='BILLING_PAYMENT' AND NOT EXISTS (
    SELECT 1 FROM billing_payments p JOIN billing_payment_attributions a ON a.payment_id=p.id
    WHERE p.id=NEW.source_id AND p.id=NEW.payment_id AND p.invoice_id=NEW.invoice_id
      AND a.tenant_id=NEW.tenant_id AND a.facility_id=NEW.facility_id AND a.party=NEW.party
      AND p.amount*100=NEW.amount_cents
  ) THEN
    RAISE EXCEPTION 'Payment source, amount or attribution does not match' USING ERRCODE='23514';
  ELSIF NEW.source_type='BILLING_REFUND' AND NOT EXISTS (
    SELECT 1 FROM billing_refunds r JOIN billing_payment_attributions a ON a.payment_id=r.payment_id
    WHERE r.id=NEW.source_id AND r.invoice_id=NEW.invoice_id AND r.payment_id=NEW.payment_id
      AND r.tenant_id=NEW.tenant_id AND r.facility_id=NEW.facility_id AND a.party=NEW.party
      AND r.amount*100=NEW.amount_cents
  ) THEN
    RAISE EXCEPTION 'Refund source, amount or attribution does not match' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_billing_postings_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting_billing_postings
FOR EACH ROW EXECUTE FUNCTION jcare_billing_posting_guard();
--> statement-breakpoint
CREATE FUNCTION jcare_guard_accounted_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A statement that began before a concurrent ledger posting cannot safely
  -- decide immutability from an old snapshot. All recorded receipts are
  -- therefore append-only, whether or not a journal already exists.
  RAISE EXCEPTION 'Recorded receipts are immutable; use a controlled compensating transaction' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_billing_payments_guard BEFORE UPDATE OR DELETE ON billing_payments
FOR EACH ROW EXECUTE FUNCTION jcare_guard_accounted_payment();
--> statement-breakpoint
CREATE FUNCTION jcare_guard_accounted_invoice_void() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.voided_at IS NOT NULL OR NEW.status='Void') AND (OLD.voided_at IS NULL AND OLD.status IS DISTINCT FROM 'Void')
    AND EXISTS (SELECT 1 FROM accounting_billing_postings p WHERE p.invoice_id=OLD.id
      AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_journal_id=p.journal_id AND r.status='POSTED')) THEN
    RAISE EXCEPTION 'Reverse active billing journals before voiding this invoice' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_billing_invoice_void_guard BEFORE UPDATE ON billing_invoices
FOR EACH ROW EXECUTE FUNCTION jcare_guard_accounted_invoice_void();
--> statement-breakpoint
CREATE FUNCTION jcare_guard_billing_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link accounting_billing_postings%ROWTYPE;
BEGIN
  IF NEW.status <> 'POSTED' OR NEW.reversal_of_journal_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO link FROM accounting_billing_postings WHERE journal_id=NEW.reversal_of_journal_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM 1 FROM billing_invoices WHERE id=link.invoice_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM accounting_billing_postings p
    WHERE p.tenant_id=link.tenant_id AND p.facility_id=link.facility_id AND p.invoice_id=link.invoice_id
      AND ((link.source_type='BILLING_INVOICE' AND p.source_type IN ('BILLING_PAYMENT','BILLING_REFUND'))
        OR (link.source_type='BILLING_PAYMENT' AND p.source_type='BILLING_REFUND' AND p.payment_id=link.payment_id))
      AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_journal_id=p.journal_id AND r.status='POSTED')) THEN
    RAISE EXCEPTION 'Reverse dependent billing journals first' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_billing_reversal_guard BEFORE UPDATE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION jcare_guard_billing_reversal();
