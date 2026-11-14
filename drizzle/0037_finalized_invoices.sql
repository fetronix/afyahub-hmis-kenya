DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_invoices' AND column_name='finalized_at')
     OR to_regclass('public.billing_invoice_finalizations') IS NOT NULL
     OR to_regclass('public.billing_payment_attributions') IS NOT NULL
     OR to_regclass('public.billing_payment_attributions_invoice_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected pre-existing finalized invoice schema; review migration state';
  END IF;
END $$;
--> statement-breakpoint
-- Additive only. Existing invoices, payments and insurance records are not
-- altered or backfilled: their attribution and finalization are unknown.
ALTER TABLE "billing_invoices" ADD COLUMN IF NOT EXISTS "finalized_at" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_invoice_finalizations" (
  "invoice_id" integer PRIMARY KEY REFERENCES "billing_invoices"("id"),
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "finalized_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "finalized_at" timestamp NOT NULL DEFAULT now(),
  "patient_responsibility" numeric(10,2) NOT NULL CHECK ("patient_responsibility" >= 0),
  "insurer_responsibility" numeric(10,2) NOT NULL CHECK ("insurer_responsibility" >= 0),
  "copayment" numeric(10,2) NOT NULL CHECK ("copayment" >= 0 AND "copayment" <= "patient_responsibility"),
  "allocation_basis" text NOT NULL CHECK (length(trim("allocation_basis")) BETWEEN 3 AND 500),
  "snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_payment_attributions" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "invoice_id" integer NOT NULL REFERENCES "billing_invoices"("id"),
  "payment_id" integer NOT NULL UNIQUE REFERENCES "billing_payments"("id"),
  "party" text NOT NULL CHECK ("party" IN ('PATIENT', 'INSURER')),
  "reason" text NOT NULL CHECK (length(trim("reason")) BETWEEN 3 AND 500),
  "actor_user_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_payment_attributions_invoice_idx" ON "billing_payment_attributions" ("tenant_id", "facility_id", "invoice_id");
--> statement-breakpoint
CREATE FUNCTION jcare_guard_finalized_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.finalized_at IS NOT NULL THEN
      RAISE EXCEPTION 'A finalized invoice cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM billing_invoice_finalizations f
    WHERE f.invoice_id=NEW.id AND f.finalized_at=NEW.finalized_at
  ) THEN
    RAISE EXCEPTION 'A matching invoice snapshot is required' USING ERRCODE = '23514';
  END IF;
  IF OLD.finalized_at IS NOT NULL AND (
      NEW.finalized_at IS DISTINCT FROM OLD.finalized_at OR
      NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
      NEW.facility_id IS DISTINCT FROM OLD.facility_id OR
      NEW.patient_id IS DISTINCT FROM OLD.patient_id OR
      NEW.encounter_id IS DISTINCT FROM OLD.encounter_id OR
      NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR
      NEW.total_amount IS DISTINCT FROM OLD.total_amount OR
      NEW.payer_type IS DISTINCT FROM OLD.payer_type OR
      NEW.payer_name IS DISTINCT FROM OLD.payer_name OR
      NEW.member_number IS DISTINCT FROM OLD.member_number OR
      NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Finalized invoice identity and charges are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_finalized_invoice_guard BEFORE UPDATE OR DELETE ON billing_invoices
FOR EACH ROW EXECUTE FUNCTION jcare_guard_finalized_invoice();
--> statement-breakpoint
CREATE FUNCTION jcare_guard_finalized_invoice_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  -- Lock both headers in stable order. This also serializes direct SQL writes
  -- with finalization, not just writes through the application charge engine.
  FOR r IN
    SELECT id, finalized_at FROM billing_invoices
    WHERE id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.invoice_id END,
                 CASE WHEN TG_OP <> 'DELETE' THEN NEW.invoice_id END)
    ORDER BY id FOR UPDATE
  LOOP
    IF r.finalized_at IS NOT NULL THEN
      RAISE EXCEPTION 'Lines of a finalized invoice are immutable' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_finalized_invoice_items_guard BEFORE INSERT OR UPDATE OR DELETE ON billing_items
FOR EACH ROW EXECUTE FUNCTION jcare_guard_finalized_invoice_items();
--> statement-breakpoint
CREATE FUNCTION jcare_guard_invoice_finalization_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i billing_invoices%ROWTYPE;
BEGIN
  SELECT * INTO i FROM billing_invoices WHERE id=NEW.invoice_id FOR UPDATE;
  IF NOT FOUND OR i.tenant_id <> NEW.tenant_id OR i.facility_id <> NEW.facility_id
     OR i.finalized_at IS NOT NULL OR i.voided_at IS NOT NULL OR i.status = 'Void'
     OR i.total_amount IS NULL
     OR NEW.patient_responsibility + NEW.insurer_responsibility <> i.total_amount THEN
    RAISE EXCEPTION 'Invoice finalization scope or amounts are invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_finalization_scope_guard BEFORE INSERT ON billing_invoice_finalizations
FOR EACH ROW EXECUTE FUNCTION jcare_guard_invoice_finalization_scope();
--> statement-breakpoint
CREATE FUNCTION jcare_check_finalization_committed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM billing_invoices i WHERE i.id=NEW.invoice_id
      AND i.finalized_at=NEW.finalized_at) THEN
    RAISE EXCEPTION 'Invoice and finalization must commit together' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER jcare_finalization_committed
AFTER INSERT ON billing_invoice_finalizations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION jcare_check_finalization_committed();
--> statement-breakpoint
CREATE FUNCTION jcare_guard_payment_attribution_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM billing_invoices i JOIN billing_payments p ON p.invoice_id=i.id
    WHERE i.id=NEW.invoice_id AND i.tenant_id=NEW.tenant_id
      AND i.facility_id=NEW.facility_id AND p.id=NEW.payment_id FOR UPDATE OF i;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment attribution scope is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_payment_attribution_scope_guard BEFORE INSERT ON billing_payment_attributions
FOR EACH ROW EXECUTE FUNCTION jcare_guard_payment_attribution_scope();
--> statement-breakpoint
CREATE FUNCTION jcare_reject_invoice_evidence_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Finalization and attribution evidence is immutable' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_finalization_immutable BEFORE UPDATE OR DELETE ON billing_invoice_finalizations
FOR EACH ROW EXECUTE FUNCTION jcare_reject_invoice_evidence_change();
--> statement-breakpoint
CREATE TRIGGER jcare_payment_attribution_immutable BEFORE UPDATE OR DELETE ON billing_payment_attributions
FOR EACH ROW EXECUTE FUNCTION jcare_reject_invoice_evidence_change();
