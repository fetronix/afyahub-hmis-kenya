-- Verified outgoing evidence for bank refunds; still no provider money movement.
ALTER TABLE billing_refunds ADD COLUMN IF NOT EXISTS bank_statement_transaction_id integer UNIQUE REFERENCES bank_transactions(id);
--> statement-breakpoint
CREATE FUNCTION jalicare_bank_refund_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original bank_payment_records%ROWTYPE;
BEGIN
  SELECT b.* INTO original FROM bank_payment_records b WHERE b.billing_payment_id=NEW.payment_id AND b.status='SETTLED';
  IF FOUND OR EXISTS(SELECT 1 FROM facility_bank_payment_policies p WHERE p.facility_id=NEW.facility_id AND p.tenant_id=NEW.tenant_id) THEN
    IF original.id IS NULL OR NEW.refund_method<>'BANK_TRANSFER' OR NEW.bank_statement_transaction_id IS NULL THEN
      RAISE EXCEPTION 'Bank refund evidence required' USING ERRCODE='23514';
    END IF;
    PERFORM 1 FROM bank_transactions t JOIN bank_statement_imports s ON s.id=t.statement_import_id
      WHERE t.id=NEW.bank_statement_transaction_id AND t.bank_account_id=original.bank_account_id
        AND t.tenant_id=NEW.tenant_id AND t.facility_id=NEW.facility_id
        AND s.tenant_id=NEW.tenant_id AND s.facility_id=NEW.facility_id AND s.bank_account_id=t.bank_account_id
        AND t.direction='OUTFLOW' AND t.amount_kes=NEW.amount AND t.matched_journal_line_id IS NULL
        AND upper(trim(t.reference_number))=upper(trim(NEW.external_reference))
        AND t.origin_classification='IMPORTED_STATEMENT' AND t.transaction_date::date<=current_date
        AND s.imported_by_user_id<>NEW.actor_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bank refund evidence mismatch' USING ERRCODE='23514'; END IF;
  ELSIF NEW.bank_statement_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Bank evidence requires an original verified bank receipt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_refund_evidence_guard BEFORE INSERT ON billing_refunds FOR EACH ROW EXECUTE FUNCTION jalicare_bank_refund_evidence_guard();
--> statement-breakpoint
CREATE FUNCTION jalicare_bank_policy_serialize() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bank-channel-policy',NEW.facility_id));
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'Bank-only policy changes require a separately approved channel rollout' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_policy_serialize BEFORE INSERT OR UPDATE OR DELETE ON facility_bank_payment_policies FOR EACH ROW EXECUTE FUNCTION jalicare_bank_policy_serialize();
--> statement-breakpoint
-- The receipt INSERT guard and policy activation share one lock. Preserve all evidence checks from 0091.
CREATE FUNCTION jalicare_bank_receipt_policy_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f integer;
BEGIN
  SELECT facility_id INTO f FROM billing_invoices WHERE id=NEW.invoice_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('bank-channel-policy',f));
  RETURN NEW;
END $$;
CREATE TRIGGER a_bank_receipt_policy_lock BEFORE INSERT ON billing_payments FOR EACH ROW EXECUTE FUNCTION jalicare_bank_receipt_policy_lock();
--> statement-breakpoint
CREATE FUNCTION jalicare_refund_statement_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM billing_refunds r WHERE r.bank_statement_transaction_id=OLD.id) THEN
    IF (NEW.bank_account_id,NEW.statement_import_id,NEW.tenant_id,NEW.facility_id,NEW.direction,NEW.amount_kes,NEW.reference_number,NEW.transaction_date,NEW.origin_classification)
      IS DISTINCT FROM (OLD.bank_account_id,OLD.statement_import_id,OLD.tenant_id,OLD.facility_id,OLD.direction,OLD.amount_kes,OLD.reference_number,OLD.transaction_date,OLD.origin_classification)
    THEN RAISE EXCEPTION 'Refund bank evidence is immutable' USING ERRCODE='23514'; END IF;
    IF NEW.matched_journal_line_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM billing_refunds r JOIN accounting_billing_postings p ON p.source_type='BILLING_REFUND' AND p.source_id=r.id
      JOIN journal_lines l ON l.journal_entry_id=p.journal_id WHERE r.bank_statement_transaction_id=OLD.id AND l.id=NEW.matched_journal_line_id
    ) THEN RAISE EXCEPTION 'Match refund evidence only to its source journal' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refund_statement_immutable BEFORE UPDATE ON bank_transactions FOR EACH ROW EXECUTE FUNCTION jalicare_refund_statement_immutable();
--> statement-breakpoint
CREATE FUNCTION jalicare_bank_receipt_committed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.bank_payment_record_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bank_payment_records b WHERE b.id=NEW.bank_payment_record_id
      AND b.status='SETTLED' AND b.billing_payment_id=NEW.id AND b.payment_date<=current_date
  ) THEN RAISE EXCEPTION 'Bank evidence and receipt must settle together' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bank_receipt_committed AFTER INSERT ON billing_payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION jalicare_bank_receipt_committed();

--> statement-breakpoint
-- Preserve every original refund guard. Extend eligibility ONLY for an evidenced, patient-attributed bank receipt.
CREATE OR REPLACE FUNCTION "jalicare_refund_guard"() RETURNS trigger AS $$
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
  IF NOT FOUND OR original_method IS NULL OR (original_method NOT IN ('cash','m-pesa','airtel money','card','cheque') AND NOT (
       original_method='bank_transfer' AND EXISTS (
         SELECT 1 FROM bank_payment_records b JOIN billing_payment_attributions a ON a.payment_id=b.billing_payment_id
          WHERE b.billing_payment_id=NEW.payment_id AND b.status='SETTLED' AND b.tenant_id=NEW.tenant_id AND b.facility_id=NEW.facility_id
            AND a.party='PATIENT' AND a.tenant_id=NEW.tenant_id AND a.facility_id=NEW.facility_id
       )
     ))
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
CREATE FUNCTION jalicare_bank_actor_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PENDING' OR NEW.statement_transaction_id IS NOT NULL OR NEW.verified_by_user_id IS NOT NULL OR NEW.approved_by_user_id IS NOT NULL OR NEW.billing_payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Bank transfer must begin pending and unverified' USING ERRCODE='23514';
    END IF;
    PERFORM 1 FROM users u WHERE u.id=NEW.submitted_by_user_id AND u.tenant_id=NEW.tenant_id AND u.facility_id=NEW.facility_id AND u.is_active AND u.account_status='ACTIVE';
    IF NOT FOUND THEN RAISE EXCEPTION 'Bank submitter is outside active facility scope' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.verified_by_user_id IS NOT NULL THEN
    PERFORM 1 FROM users u WHERE u.id=NEW.verified_by_user_id AND u.tenant_id=NEW.tenant_id AND u.facility_id=NEW.facility_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bank verifier scope mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.approved_by_user_id IS NOT NULL THEN
    PERFORM 1 FROM users u WHERE u.id=NEW.approved_by_user_id AND u.tenant_id=NEW.tenant_id AND u.facility_id=NEW.facility_id AND u.is_active AND u.account_status='ACTIVE';
    IF NOT FOUND THEN RAISE EXCEPTION 'Bank approver scope mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_actor_scope_guard BEFORE INSERT OR UPDATE ON bank_payment_records FOR EACH ROW EXECUTE FUNCTION jalicare_bank_actor_scope_guard();
