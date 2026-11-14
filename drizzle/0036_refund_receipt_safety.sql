-- Do not adopt an unjournaled table, sequence, trigger or function whose
-- definition has not been reviewed. No historical receipts are rewritten.
DO $$
BEGIN
  IF to_regclass('billing_refunds') IS NOT NULL
     OR to_regclass('billing_refund_receipt_seq') IS NOT NULL
     OR to_regclass('billing_refunds_facility_key_idx') IS NOT NULL
     OR to_regclass('billing_refunds_invoice_idx') IS NOT NULL
     OR to_regclass('billing_refunds_payment_idx') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname=current_schema() AND p.proname='jalicare_refund_guard') THEN
    RAISE EXCEPTION 'Refund workflow objects already exist without this journal entry; review their definitions';
  END IF;
END $$;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "billing_refund_receipt_seq";
--> statement-breakpoint
-- A refund is an additive, immutable reversal receipt. It is a manual record,
-- not a provider transfer or evidence that a bank or payment gateway paid.
CREATE TABLE IF NOT EXISTS "billing_refunds" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "invoice_id" integer NOT NULL REFERENCES "billing_invoices"("id"),
  "payment_id" integer NOT NULL REFERENCES "billing_payments"("id"),
  "refund_number" text NOT NULL UNIQUE,
  "amount" numeric(10,2) NOT NULL,
  "refund_method" text NOT NULL,
  "external_reference" text,
  "reason" text NOT NULL,
  "manual_confirmation" boolean NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "actor_user_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "billing_refund_amount_chk" CHECK ("amount" > 0 AND "amount"::text NOT IN ('NaN','Infinity','-Infinity')),
  CONSTRAINT "billing_refund_method_chk" CHECK ("refund_method" IN ('CASH','MOBILE_MONEY','CARD','BANK_TRANSFER','CHEQUE')),
  CONSTRAINT "billing_refund_reason_chk" CHECK (length(trim("reason")) BETWEEN 3 AND 500),
  CONSTRAINT "billing_refund_confirmation_chk" CHECK ("manual_confirmation"),
  CONSTRAINT "billing_refund_reference_chk" CHECK ("refund_method" = 'CASH' OR length(trim(COALESCE("external_reference",''))) BETWEEN 3 AND 100),
  CONSTRAINT "billing_refund_key_chk" CHECK ("idempotency_key" ~ '^[A-Za-z0-9._:-]{8,128}$'),
  CONSTRAINT "billing_refund_scope_fk" FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities"("id", "tenant_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_refunds_facility_key_idx" ON "billing_refunds" ("facility_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_refunds_invoice_idx" ON "billing_refunds" ("invoice_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_refunds_payment_idx" ON "billing_refunds" ("payment_id", "id");
--> statement-breakpoint
CREATE FUNCTION "jalicare_refund_guard"() RETURNS trigger AS $$
DECLARE
  original_amount numeric(10,2);
  original_method text;
  prior_amount numeric;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Refund receipts are immutable; use an authorized compensating transaction' USING ERRCODE='23514';
  END IF;
  -- The same order is used by billing, refund and void paths.
  PERFORM 1 FROM billing_invoices i WHERE i.id=NEW.invoice_id AND i.tenant_id=NEW.tenant_id
    AND i.facility_id=NEW.facility_id AND i.voided_at IS NULL AND i.status <> 'Void' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund invoice is unavailable or outside facility scope' USING ERRCODE='23514';
  END IF;
  SELECT p.amount, lower(trim(p.payment_method)) INTO original_amount, original_method
    FROM billing_payments p WHERE p.id=NEW.payment_id AND p.invoice_id=NEW.invoice_id FOR UPDATE;
  IF NOT FOUND OR original_method IS NULL OR original_method NOT IN ('cash','m-pesa','airtel money','card','cheque')
     OR original_amount IS NULL OR original_amount <= 0 OR original_amount::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Original patient receipt is unavailable or requires payer review' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id=NEW.actor_user_id AND u.tenant_id=NEW.tenant_id
      AND (u.facility_id IS NULL OR u.facility_id=NEW.facility_id) AND u.is_active AND u.account_status='ACTIVE') THEN
    RAISE EXCEPTION 'Refund actor is outside facility scope' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM insurance_claims c WHERE c.settled_payment_id=NEW.payment_id)
     OR EXISTS (SELECT 1 FROM insurance_reconciliation_entries e WHERE e.posted_payment_id=NEW.payment_id)
     OR EXISTS (SELECT 1 FROM private_insurance_remittance_allocations a WHERE a.posted_payment_id=NEW.payment_id)
     OR EXISTS (SELECT 1 FROM sha_eclaims c WHERE c.settled_payment_id=NEW.payment_id)
     OR EXISTS (SELECT 1 FROM private_insurance_claims c WHERE c.settled_payment_id=NEW.payment_id) THEN
    RAISE EXCEPTION 'A payer-linked receipt requires authorized payer reversal review' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(r.amount),0) INTO prior_amount FROM billing_refunds r WHERE r.payment_id=NEW.payment_id;
  IF prior_amount + NEW.amount > original_amount THEN
    RAISE EXCEPTION 'Refunds exceed the original receipt amount' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "billing_refunds_guard" BEFORE INSERT OR UPDATE OR DELETE ON "billing_refunds"
  FOR EACH ROW EXECUTE FUNCTION "jalicare_refund_guard"();
