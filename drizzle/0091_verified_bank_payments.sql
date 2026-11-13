-- Additive, facility-opt-in controlled bank transfers. No provider capability is enabled.
CREATE TABLE IF NOT EXISTS facility_bank_payment_policies (
  facility_id integer PRIMARY KEY,
  tenant_id integer NOT NULL,
  bank_only boolean NOT NULL DEFAULT true CHECK (bank_only),
  enabled_by_user_id integer NOT NULL REFERENCES users(id),
  enabled_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (facility_id,tenant_id) REFERENCES facilities(id,tenant_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS bank_account_identifiers (
  bank_account_id integer PRIMARY KEY REFERENCES bank_accounts(id),
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  encrypted_identifier text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (bank_account_id,facility_id,tenant_id) REFERENCES bank_accounts(id,facility_id,tenant_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS bank_payment_records (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  bank_account_id integer NOT NULL,
  invoice_id integer NOT NULL REFERENCES billing_invoices(id),
  amount_kes numeric(10,2) NOT NULL CHECK (amount_kes > 0),
  currency text NOT NULL DEFAULT 'KES' CHECK (currency='KES'),
  bank_reference text NOT NULL CHECK (length(bank_reference) BETWEEN 1 AND 100),
  payment_date date NOT NULL,
  payer_party text NOT NULL CHECK (payer_party IN ('PATIENT','INSURER')),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','SETTLED','REJECTED')),
  submitted_by_user_id integer NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  statement_transaction_id integer UNIQUE REFERENCES bank_transactions(id),
  verified_by_user_id integer REFERENCES users(id),
  verified_at timestamptz,
  verification_notes text,
  approved_by_user_id integer REFERENCES users(id),
  approved_at timestamptz,
  billing_payment_id integer UNIQUE REFERENCES billing_payments(id),
  rejected_by_user_id integer REFERENCES users(id),
  rejection_reason text,
  UNIQUE (facility_id,idempotency_key),
  UNIQUE (id,facility_id,tenant_id),
  FOREIGN KEY (facility_id,tenant_id) REFERENCES facilities(id,tenant_id),
  FOREIGN KEY (bank_account_id,facility_id,tenant_id) REFERENCES bank_accounts(id,facility_id,tenant_id),
  CHECK (verified_by_user_id IS NULL OR verified_by_user_id<>submitted_by_user_id),
  CHECK (approved_by_user_id IS NULL OR (approved_by_user_id<>submitted_by_user_id AND approved_by_user_id<>verified_by_user_id)),
  CHECK ((status IN ('VERIFIED','SETTLED')) = (statement_transaction_id IS NOT NULL AND verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL AND verification_notes IS NOT NULL)),
  CHECK ((status='SETTLED') = (billing_payment_id IS NOT NULL)),
  CHECK ((approved_by_user_id IS NULL) = (approved_at IS NULL)),
  CHECK (status<>'SETTLED' OR approved_by_user_id IS NOT NULL),
  CHECK (status<>'REJECTED' OR (rejected_by_user_id IS NOT NULL AND rejection_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS bank_payment_records_scope_idx ON bank_payment_records(tenant_id,facility_id,id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS bank_payment_events (
  id serial PRIMARY KEY,
  bank_payment_id integer NOT NULL,
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  actor_user_id integer NOT NULL REFERENCES users(id),
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (bank_payment_id,facility_id,tenant_id) REFERENCES bank_payment_records(id,facility_id,tenant_id)
);
--> statement-breakpoint
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS bank_payment_record_id integer UNIQUE REFERENCES bank_payment_records(id);
--> statement-breakpoint
CREATE FUNCTION jalicare_bank_payment_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Bank payment history is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status IN ('SETTLED','REJECTED') OR
       (NEW.tenant_id,NEW.facility_id,NEW.bank_account_id,NEW.invoice_id,NEW.amount_kes,NEW.currency,NEW.bank_reference,NEW.payment_date,NEW.payer_party,NEW.idempotency_key,NEW.request_hash,NEW.submitted_by_user_id,NEW.submitted_at)
       IS DISTINCT FROM
       (OLD.tenant_id,OLD.facility_id,OLD.bank_account_id,OLD.invoice_id,OLD.amount_kes,OLD.currency,OLD.bank_reference,OLD.payment_date,OLD.payer_party,OLD.idempotency_key,OLD.request_hash,OLD.submitted_by_user_id,OLD.submitted_at)
    THEN RAISE EXCEPTION 'Bank payment facts are immutable' USING ERRCODE='23514'; END IF;
    IF NOT ((OLD.status='PENDING' AND NEW.status IN ('VERIFIED','REJECTED')) OR
            (OLD.status='VERIFIED' AND NEW.status IN ('VERIFIED','SETTLED'))) THEN
      RAISE EXCEPTION 'Invalid bank payment transition' USING ERRCODE='23514';
    END IF;
    IF OLD.status='VERIFIED' AND
       (NEW.statement_transaction_id,NEW.verified_by_user_id,NEW.verified_at,NEW.verification_notes)
       IS DISTINCT FROM (OLD.statement_transaction_id,OLD.verified_by_user_id,OLD.verified_at,OLD.verification_notes)
    THEN RAISE EXCEPTION 'Verified evidence is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  PERFORM 1 FROM billing_invoices i WHERE i.id=NEW.invoice_id AND i.tenant_id=NEW.tenant_id AND i.facility_id=NEW.facility_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bank invoice scope mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.status IN ('VERIFIED','SETTLED') THEN
    PERFORM 1 FROM bank_transactions t JOIN bank_statement_imports s ON s.id=t.statement_import_id
     WHERE t.id=NEW.statement_transaction_id AND t.bank_account_id=NEW.bank_account_id
       AND t.tenant_id=NEW.tenant_id AND t.facility_id=NEW.facility_id
       AND s.tenant_id=NEW.tenant_id AND s.facility_id=NEW.facility_id AND s.bank_account_id=NEW.bank_account_id
       AND t.direction='INFLOW' AND t.amount_kes=NEW.amount_kes
       AND upper(trim(t.reference_number))=NEW.bank_reference AND t.transaction_date::date=NEW.payment_date
       AND t.origin_classification='IMPORTED_STATEMENT';
    IF NOT FOUND THEN RAISE EXCEPTION 'Bank evidence mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.status='SETTLED' THEN
    PERFORM 1 FROM billing_payments p WHERE p.id=NEW.billing_payment_id AND p.bank_payment_record_id=NEW.id
      AND p.invoice_id=NEW.invoice_id AND p.amount=NEW.amount_kes;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bank receipt mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_payment_record_guard BEFORE INSERT OR UPDATE OR DELETE ON bank_payment_records FOR EACH ROW EXECUTE FUNCTION jalicare_bank_payment_record_guard();
--> statement-breakpoint
CREATE FUNCTION jalicare_verified_bank_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f integer; t integer;
BEGIN
  SELECT facility_id,tenant_id INTO f,t FROM billing_invoices WHERE id=NEW.invoice_id;
  IF NEW.bank_payment_record_id IS NOT NULL THEN
    PERFORM 1 FROM bank_payment_records b JOIN bank_accounts a ON a.id=b.bank_account_id
     WHERE b.id=NEW.bank_payment_record_id AND b.facility_id=f AND b.tenant_id=t
       AND b.invoice_id=NEW.invoice_id AND b.amount_kes=NEW.amount AND b.status='VERIFIED'
       AND b.approved_by_user_id IS NOT NULL AND a.is_active AND a.currency='KES'
       AND NEW.payment_method='BANK_TRANSFER' AND NEW.transaction_code=('BANK:'||b.id::text);
    IF NOT FOUND THEN RAISE EXCEPTION 'Verified authorized bank evidence is required' USING ERRCODE='23514'; END IF;
  ELSIF NEW.payment_method ~* '(bank|transfer|eft|rtgs|pesalink)' OR
        EXISTS (SELECT 1 FROM facility_bank_payment_policies WHERE facility_id=f AND tenant_id=t) THEN
    RAISE EXCEPTION 'Use verified bank settlement' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verified_bank_receipt_guard BEFORE INSERT ON billing_payments FOR EACH ROW EXECUTE FUNCTION jalicare_verified_bank_receipt_guard();
--> statement-breakpoint
CREATE FUNCTION jalicare_bank_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Bank payment events are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER bank_event_immutable BEFORE UPDATE OR DELETE ON bank_payment_events FOR EACH ROW EXECUTE FUNCTION jalicare_bank_event_immutable();
--> statement-breakpoint
-- Preserve historical rows for explicit review; all new/changed links must be in scope.
CREATE UNIQUE INDEX IF NOT EXISTS bank_import_parent_scope_idx ON bank_statement_imports(id,bank_account_id,facility_id,tenant_id);
ALTER TABLE bank_transactions ADD CONSTRAINT bank_transaction_import_parent_scope_fk FOREIGN KEY(statement_import_id,bank_account_id,facility_id,tenant_id) REFERENCES bank_statement_imports(id,bank_account_id,facility_id,tenant_id) NOT VALID;
ALTER TABLE bank_reconciliations ADD CONSTRAINT bank_reconciliation_import_parent_scope_fk FOREIGN KEY(statement_import_id,bank_account_id,facility_id,tenant_id) REFERENCES bank_statement_imports(id,bank_account_id,facility_id,tenant_id) NOT VALID;
ALTER TABLE bank_statement_imports ADD CONSTRAINT bank_import_account_parent_scope_fk FOREIGN KEY(bank_account_id,facility_id,tenant_id) REFERENCES bank_accounts(id,facility_id,tenant_id) NOT VALID;
ALTER TABLE bank_transactions ADD CONSTRAINT bank_transaction_account_parent_scope_fk FOREIGN KEY(bank_account_id,facility_id,tenant_id) REFERENCES bank_accounts(id,facility_id,tenant_id) NOT VALID;
--> statement-breakpoint
CREATE FUNCTION jalicare_verified_bank_statement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b bank_payment_records%ROWTYPE;
BEGIN
  SELECT * INTO b FROM bank_payment_records WHERE statement_transaction_id=OLD.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF (NEW.bank_account_id,NEW.statement_import_id,NEW.tenant_id,NEW.facility_id,NEW.direction,NEW.amount_kes,NEW.reference_number,NEW.transaction_date,NEW.origin_classification)
    IS DISTINCT FROM (OLD.bank_account_id,OLD.statement_import_id,OLD.tenant_id,OLD.facility_id,OLD.direction,OLD.amount_kes,OLD.reference_number,OLD.transaction_date,OLD.origin_classification)
  THEN RAISE EXCEPTION 'Verified bank evidence is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.matched_journal_line_id IS NOT NULL THEN
    PERFORM 1 FROM accounting_billing_postings p JOIN journal_lines l ON l.journal_entry_id=p.journal_id
      WHERE p.source_type='BILLING_PAYMENT' AND p.source_id=b.billing_payment_id
        AND p.tenant_id=b.tenant_id AND p.facility_id=b.facility_id AND l.id=NEW.matched_journal_line_id;
    IF b.status<>'SETTLED' OR NOT FOUND THEN RAISE EXCEPTION 'Verified credit requires its receipt journal' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verified_bank_statement_guard BEFORE UPDATE ON bank_transactions FOR EACH ROW EXECUTE FUNCTION jalicare_verified_bank_statement_guard();
