-- Additive refund requests and reviews. Historical refund receipts are not
-- changed or retroactively treated as independently approved.
DO $$
BEGIN
  IF to_regclass('billing_refund_requests') IS NOT NULL
     OR to_regclass('refund_requests_facility_key_idx') IS NOT NULL
     OR to_regclass('refund_requests_invoice_idx') IS NOT NULL
     OR to_regclass('refund_requests_payment_status_idx') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname=current_schema() AND p.proname IN
                  ('jalicare_refund_request_guard','jalicare_refund_approval_guard','jalicare_refund_link_guard')) THEN
    RAISE EXCEPTION 'Refund review objects already exist without this journal entry; review before migration';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_refund_requests" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "invoice_id" integer NOT NULL REFERENCES "billing_invoices"("id"),
  "payment_id" integer NOT NULL REFERENCES "billing_payments"("id"),
  "request_number" text NOT NULL UNIQUE,
  "amount" numeric(10,2) NOT NULL,
  "refund_method" text NOT NULL,
  "reason" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'REQUESTED',
  "requested_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "reviewed_by_user_id" integer REFERENCES "users"("id"),
  "review_notes" text,
  "review_hash" text,
  "reviewed_at" timestamp,
  "revoked_by_user_id" integer REFERENCES "users"("id"),
  "revocation_reason" text,
  "revoked_at" timestamp,
  "settled_refund_id" integer UNIQUE REFERENCES "billing_refunds"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "refund_request_facility_tenant_fk" FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities"("id", "tenant_id"),
  CONSTRAINT "refund_request_amount_chk" CHECK ("amount" > 0 AND "amount"::text NOT IN ('NaN','Infinity','-Infinity')),
  CONSTRAINT "refund_request_method_chk" CHECK ("refund_method" IN ('CASH','MOBILE_MONEY','CARD','BANK_TRANSFER','CHEQUE')),
  CONSTRAINT "refund_request_reason_chk" CHECK (length(trim("reason")) BETWEEN 3 AND 500),
  CONSTRAINT "refund_request_key_chk" CHECK ("idempotency_key" ~ '^[A-Za-z0-9._:-]{8,128}$'),
  CONSTRAINT "refund_request_hash_chk" CHECK ("request_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "refund_request_status_chk" CHECK ("status" IN ('REQUESTED','APPROVED','REJECTED','REVOKED','SETTLED')),
  CONSTRAINT "refund_request_independent_chk" CHECK ("reviewed_by_user_id" IS NULL OR "reviewed_by_user_id" <> "requested_by_user_id"),
  CONSTRAINT "refund_request_state_chk" CHECK (
    ("status"='REQUESTED' AND "reviewed_by_user_id" IS NULL AND "review_notes" IS NULL AND "review_hash" IS NULL AND "reviewed_at" IS NULL AND "settled_refund_id" IS NULL AND "revoked_by_user_id" IS NULL AND "revocation_reason" IS NULL AND "revoked_at" IS NULL)
    OR ("status" IN ('APPROVED','REJECTED') AND "reviewed_by_user_id" IS NOT NULL AND "review_notes" IS NOT NULL AND "review_hash" IS NOT NULL AND length(trim("review_notes")) BETWEEN 3 AND 1000 AND "review_hash" ~ '^[a-f0-9]{64}$' AND "reviewed_at" IS NOT NULL AND "settled_refund_id" IS NULL AND "revoked_by_user_id" IS NULL AND "revocation_reason" IS NULL AND "revoked_at" IS NULL)
    OR ("status"='SETTLED' AND "reviewed_by_user_id" IS NOT NULL AND "review_notes" IS NOT NULL AND "review_hash" IS NOT NULL AND length(trim("review_notes")) BETWEEN 3 AND 1000 AND "review_hash" ~ '^[a-f0-9]{64}$' AND "reviewed_at" IS NOT NULL AND "settled_refund_id" IS NOT NULL AND "revoked_by_user_id" IS NULL AND "revocation_reason" IS NULL AND "revoked_at" IS NULL)
    OR ("status"='REVOKED' AND "reviewed_by_user_id" IS NOT NULL AND "review_notes" IS NOT NULL AND "review_hash" IS NOT NULL AND length(trim("review_notes")) BETWEEN 3 AND 1000 AND "review_hash" ~ '^[a-f0-9]{64}$' AND "reviewed_at" IS NOT NULL AND "settled_refund_id" IS NULL AND "revoked_by_user_id" IS NOT NULL AND "revoked_by_user_id" <> "requested_by_user_id" AND "revocation_reason" IS NOT NULL AND length(trim("revocation_reason")) BETWEEN 3 AND 1000 AND "revoked_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refund_requests_facility_key_idx" ON "billing_refund_requests" ("facility_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refund_requests_invoice_idx" ON "billing_refund_requests" ("tenant_id", "facility_id", "invoice_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refund_requests_payment_status_idx" ON "billing_refund_requests" ("payment_id", "status");
--> statement-breakpoint
CREATE FUNCTION "jalicare_refund_request_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Refund requests are retained; use an authorized decision' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'REQUESTED' OR NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id=NEW.requested_by_user_id AND u.tenant_id=NEW.tenant_id
        AND (u.facility_id IS NULL OR u.facility_id=NEW.facility_id) AND u.is_active AND u.account_status='ACTIVE'
    ) OR NOT EXISTS (
      SELECT 1 FROM billing_invoices i JOIN billing_payments p ON p.invoice_id=i.id
      WHERE i.id=NEW.invoice_id AND p.id=NEW.payment_id AND i.tenant_id=NEW.tenant_id AND i.facility_id=NEW.facility_id
    ) THEN
      RAISE EXCEPTION 'Refund request scope or initial state is invalid' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.tenant_id,NEW.facility_id,NEW.invoice_id,NEW.payment_id,NEW.request_number,NEW.amount,
         NEW.refund_method,NEW.reason,NEW.idempotency_key,NEW.request_hash,NEW.requested_by_user_id,NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id,OLD.facility_id,OLD.invoice_id,OLD.payment_id,OLD.request_number,OLD.amount,
         OLD.refund_method,OLD.reason,OLD.idempotency_key,OLD.request_hash,OLD.requested_by_user_id,OLD.created_at) THEN
    RAISE EXCEPTION 'Refund request source evidence is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='REQUESTED' AND NEW.status IN ('APPROVED','REJECTED') THEN
    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id=NEW.reviewed_by_user_id AND u.tenant_id=NEW.tenant_id
      AND (u.facility_id IS NULL OR u.facility_id=NEW.facility_id) AND u.is_active AND u.account_status='ACTIVE') THEN
      RAISE EXCEPTION 'Refund reviewer is outside facility scope' USING ERRCODE='23514';
    END IF;
  ELSIF OLD.status='APPROVED' AND NEW.status IN ('SETTLED','REVOKED') THEN
    IF ROW(NEW.reviewed_by_user_id,NEW.review_notes,NEW.review_hash,NEW.reviewed_at)
       IS DISTINCT FROM ROW(OLD.reviewed_by_user_id,OLD.review_notes,OLD.review_hash,OLD.reviewed_at) THEN
      RAISE EXCEPTION 'Refund approval evidence is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.status='REVOKED' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=NEW.revoked_by_user_id AND u.tenant_id=NEW.tenant_id
      AND (u.facility_id IS NULL OR u.facility_id=NEW.facility_id) AND u.is_active AND u.account_status='ACTIVE') THEN
      RAISE EXCEPTION 'Refund revoker is outside facility scope' USING ERRCODE='23514';
    END IF;
    IF NEW.status='SETTLED' AND NOT EXISTS (
      SELECT 1 FROM billing_refunds r WHERE r.id=NEW.settled_refund_id AND r.tenant_id=NEW.tenant_id
        AND r.facility_id=NEW.facility_id AND r.invoice_id=NEW.invoice_id AND r.payment_id=NEW.payment_id
        AND r.amount=NEW.amount AND r.refund_method=NEW.refund_method AND r.reason=NEW.reason AND r.idempotency_key=NEW.idempotency_key
    ) THEN
      RAISE EXCEPTION 'Manual refund does not match its approved request' USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Refund request transition is not permitted' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "refund_requests_immutable_guard" BEFORE INSERT OR UPDATE OR DELETE ON "billing_refund_requests"
  FOR EACH ROW EXECUTE FUNCTION "jalicare_refund_request_guard"();
--> statement-breakpoint
-- Named after the existing invoice/payment guard so the lock order stays
-- invoice -> receipt -> request. Existing refund rows are never inspected.
CREATE FUNCTION "jalicare_refund_approval_guard"() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM billing_refund_requests q WHERE q.tenant_id=NEW.tenant_id AND q.facility_id=NEW.facility_id
    AND q.invoice_id=NEW.invoice_id AND q.payment_id=NEW.payment_id AND q.amount=NEW.amount
    AND q.refund_method=NEW.refund_method AND q.reason=NEW.reason AND q.idempotency_key=NEW.idempotency_key
    AND q.status='APPROVED' AND q.reviewed_by_user_id<>q.requested_by_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A matching independent refund approval is required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "billing_refunds_z_approval_guard" BEFORE INSERT ON "billing_refunds"
  FOR EACH ROW EXECUTE FUNCTION "jalicare_refund_approval_guard"();
--> statement-breakpoint
CREATE FUNCTION "jalicare_refund_link_guard"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM billing_refund_requests q WHERE q.tenant_id=NEW.tenant_id AND q.facility_id=NEW.facility_id
    AND q.idempotency_key=NEW.idempotency_key AND q.status='SETTLED' AND q.settled_refund_id=NEW.id) THEN
    RAISE EXCEPTION 'Manual refund must be atomically linked to its approved request' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "billing_refunds_request_link_guard" AFTER INSERT ON "billing_refunds"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "jalicare_refund_link_guard"();
