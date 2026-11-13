-- Additive only: no receipt, refund, journal, invoice or provider event is
-- changed or backfilled. Receipts/refunds are the durable work items; their
-- accounting state is derived from the immutable source and journal evidence.
-- Existing installations should assess lock duration and take a tested backup
-- before applying any migration. This does not enable provider callbacks.
-- Do not adopt an unexpected object merely because an index name exists.
DO $$
BEGIN
  IF to_regclass('billing_payments_invoice_source_idx') IS NOT NULL
     OR to_regclass('accounting_payment_settlement_status') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname=current_schema() AND p.proname IN
                  ('jcare_payment_integration_identity_immutable','jcare_payment_hub_lifecycle_guard')) THEN
    RAISE EXCEPTION 'Unexpected settlement recovery objects; review migration state';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS billing_payments_invoice_source_idx ON billing_payments(invoice_id,id);
--> statement-breakpoint
CREATE VIEW accounting_payment_settlement_status AS
WITH sources AS (
  SELECT i.tenant_id, i.facility_id, p.invoice_id, 'BILLING_PAYMENT'::text AS source_type,
         p.id AS source_id, p.id AS payment_id, p.amount,
         p.receipt_number AS record_number, p.payment_method AS method, p.created_at
  FROM billing_payments p
  JOIN billing_invoices i ON i.id=p.invoice_id
  UNION ALL
  SELECT r.tenant_id, r.facility_id, r.invoice_id, 'BILLING_REFUND'::text,
         r.id, r.payment_id, r.amount, r.refund_number, r.refund_method, r.created_at
  FROM billing_refunds r
), evidence AS (
  SELECT s.*, a.party, p.journal_id, original.journal_number,
         reversal.id AS reversal_journal_id,
         f.invoice_id AS finalized_invoice_id,
         ip.journal_id AS invoice_journal_id,
         invoice_reversal.id AS invoice_reversal_id,
         pp.journal_id AS receipt_journal_id,
         receipt_reversal.id AS receipt_reversal_id,
         EXISTS (
           SELECT 1 FROM journal_entries j
           WHERE j.tenant_id=s.tenant_id AND j.facility_id=s.facility_id
             AND j.source_type=s.source_type AND j.source_id=s.source_id::text
         ) AS any_source_journal,
         COALESCE(refunds.total,0) AS refunded_amount,
         COALESCE(refunds.unposted,0) AS unresolved_refunds
  FROM sources s
  LEFT JOIN billing_payment_attributions a ON a.payment_id=s.payment_id
    AND a.invoice_id=s.invoice_id AND a.tenant_id=s.tenant_id AND a.facility_id=s.facility_id
  LEFT JOIN billing_invoice_finalizations f ON f.invoice_id=s.invoice_id
    AND f.tenant_id=s.tenant_id AND f.facility_id=s.facility_id
  LEFT JOIN accounting_billing_postings p ON p.tenant_id=s.tenant_id
    AND p.facility_id=s.facility_id AND p.source_type=s.source_type AND p.source_id=s.source_id
  LEFT JOIN journal_entries original ON original.id=p.journal_id AND original.status='POSTED'
  LEFT JOIN journal_entries reversal ON reversal.reversal_of_journal_id=p.journal_id AND reversal.status='POSTED'
  LEFT JOIN accounting_billing_postings ip ON ip.tenant_id=s.tenant_id AND ip.facility_id=s.facility_id
    AND ip.source_type='BILLING_INVOICE' AND ip.source_id=s.invoice_id
  LEFT JOIN journal_entries invoice_reversal ON invoice_reversal.reversal_of_journal_id=ip.journal_id AND invoice_reversal.status='POSTED'
  LEFT JOIN accounting_billing_postings pp ON pp.tenant_id=s.tenant_id AND pp.facility_id=s.facility_id
    AND pp.source_type='BILLING_PAYMENT' AND pp.source_id=s.payment_id
  LEFT JOIN journal_entries receipt_reversal ON receipt_reversal.reversal_of_journal_id=pp.journal_id AND receipt_reversal.status='POSTED'
  LEFT JOIN LATERAL (
    SELECT sum(r.amount) AS total,
           count(*) FILTER (WHERE rp.journal_id IS NULL OR rr.id IS NOT NULL) AS unposted
    FROM billing_refunds r
    LEFT JOIN accounting_billing_postings rp ON rp.tenant_id=r.tenant_id AND rp.facility_id=r.facility_id
      AND rp.source_type='BILLING_REFUND' AND rp.source_id=r.id
    LEFT JOIN journal_entries rr ON rr.reversal_of_journal_id=rp.journal_id AND rr.status='POSTED'
    WHERE s.source_type='BILLING_PAYMENT' AND r.payment_id=s.payment_id
      AND r.invoice_id=s.invoice_id AND r.tenant_id=s.tenant_id AND r.facility_id=s.facility_id
  ) refunds ON true
), assessed AS (
  SELECT e.*,
    CASE
      WHEN e.amount <= 0 OR e.amount::text IN ('NaN','Infinity','-Infinity') THEN 'INVALID_SOURCE_AMOUNT'
      WHEN e.reversal_journal_id IS NOT NULL THEN 'JOURNAL_REVERSED'
      WHEN e.journal_id IS NOT NULL AND e.journal_number IS NULL THEN 'POSTING_JOURNAL_REVIEW_REQUIRED'
      WHEN e.party IS NULL THEN 'PAYMENT_ATTRIBUTION_REQUIRED'
      WHEN e.finalized_invoice_id IS NULL THEN 'FINALIZED_INVOICE_REQUIRED'
      WHEN e.invoice_journal_id IS NULL OR e.invoice_reversal_id IS NOT NULL THEN 'ACTIVE_INVOICE_POSTING_REQUIRED'
      WHEN e.source_type='BILLING_REFUND' AND (e.receipt_journal_id IS NULL OR e.receipt_reversal_id IS NOT NULL)
        THEN 'ACTIVE_RECEIPT_POSTING_REQUIRED'
      WHEN e.journal_id IS NULL AND e.any_source_journal THEN 'UNTRACKED_SOURCE_JOURNAL'
      WHEN e.source_type='BILLING_PAYMENT' AND e.refunded_amount > e.amount THEN 'REFUND_AMOUNT_REVIEW_REQUIRED'
      WHEN e.source_type='BILLING_PAYMENT' AND e.unresolved_refunds > 0 AND e.journal_id IS NOT NULL
        THEN 'REFUND_POSTING_REVIEW_REQUIRED'
      ELSE NULL
    END AS review_code
  FROM evidence e
)
SELECT tenant_id, facility_id, invoice_id, source_type, source_id, payment_id,
       amount, record_number, method, created_at, party, journal_id, journal_number,
       reversal_journal_id, review_code,
       CASE
         WHEN review_code='JOURNAL_REVERSED' THEN 'REVERSED'
         WHEN review_code IS NOT NULL THEN 'RECONCILIATION_REQUIRED'
         WHEN journal_id IS NULL THEN 'SUCCESS_AWAITING_SETTLEMENT'
         WHEN source_type='BILLING_PAYMENT' AND refunded_amount=amount THEN 'REFUNDED'
         WHEN source_type='BILLING_PAYMENT' AND refunded_amount>0 THEN 'PARTIALLY_REFUNDED'
         ELSE 'SETTLED'
       END AS status
FROM assessed;
--> statement-breakpoint
-- Environment and provider ownership must not be changed underneath a request
-- or an existing production reconciliation. Configuration remains editable.
CREATE FUNCTION jcare_payment_integration_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.provider_id,NEW.tenant_id,NEW.facility_id,NEW.environment)
       IS DISTINCT FROM (OLD.provider_id,OLD.tenant_id,OLD.facility_id,OLD.environment) THEN
    RAISE EXCEPTION 'Payment integration environment and ownership are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_payment_integration_identity_immutable_trigger
BEFORE UPDATE ON facility_payment_integrations FOR EACH ROW
EXECUTE FUNCTION jcare_payment_integration_identity_immutable();
--> statement-breakpoint
-- These are *request/query* states, not authenticated-provider settlement.
-- A query-reported success stays PROVIDER_CONFIRMED and cannot create a receipt.
CREATE FUNCTION jcare_payment_hub_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Payment request history cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'INITIATING' OR NEW.provider_request_id IS NOT NULL OR NEW.result_code IS NOT NULL THEN
      RAISE EXCEPTION 'Payment requests must begin in INITIATING' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.integration_id,NEW.tenant_id,NEW.facility_id,NEW.invoice_id,NEW.amount_cents,
      NEW.idempotency_key,NEW.request_hash,NEW.initiated_by_user_id,NEW.created_at)
       IS DISTINCT FROM
     (OLD.integration_id,OLD.tenant_id,OLD.facility_id,OLD.invoice_id,OLD.amount_cents,
      OLD.idempotency_key,OLD.request_hash,OLD.initiated_by_user_id,OLD.created_at) THEN
    RAISE EXCEPTION 'Payment request identity and scope are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.provider_request_id IS NOT NULL AND NEW.provider_request_id IS DISTINCT FROM OLD.provider_request_id THEN
    RAISE EXCEPTION 'Provider request reference is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.provider_request_id IS NULL AND NEW.provider_request_id IS NOT NULL
     AND NOT (OLD.status='INITIATING' AND NEW.status='PENDING') THEN
    RAISE EXCEPTION 'Provider reference may only be attached on initial acceptance' USING ERRCODE='23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status='INITIATING' AND NEW.status IN ('PENDING','UNKNOWN'))
    OR (OLD.status IN ('PENDING','UNKNOWN') AND NEW.status IN ('PROVIDER_CONFIRMED','FAILED','REVIEW_REQUIRED'))
    OR (OLD.status IN ('PROVIDER_CONFIRMED','FAILED') AND NEW.status='REVIEW_REQUIRED')
  ) THEN
    RAISE EXCEPTION 'Invalid payment request state transition' USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('PENDING','PROVIDER_CONFIRMED')
     AND (NEW.provider_request_id IS NULL OR length(trim(NEW.provider_request_id))=0) THEN
    RAISE EXCEPTION 'A provider request reference is required' USING ERRCODE='23514';
  END IF;
  IF NEW.status='PROVIDER_CONFIRMED' AND NEW.result_code IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'Reported success requires a successful query result' USING ERRCODE='23514';
  END IF;
  IF NEW.status='FAILED' AND (NEW.result_code IS NULL OR NEW.result_code='0') THEN
    RAISE EXCEPTION 'Failure or cancellation requires a non-success query result' USING ERRCODE='23514';
  END IF;
  IF OLD.status='FAILED' AND NEW.status='FAILED' AND NEW.result_code IS DISTINCT FROM OLD.result_code THEN
    RAISE EXCEPTION 'Recorded failure or cancellation evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_payment_hub_lifecycle_guard_trigger
BEFORE INSERT OR UPDATE OR DELETE ON payment_hub_transactions FOR EACH ROW
EXECUTE FUNCTION jcare_payment_hub_lifecycle_guard();
