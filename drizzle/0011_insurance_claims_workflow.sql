-- 0011 — Insurance claims workflow
--
-- A claim is a request to a payer for a specific set of charges. Until
-- now the claims table held a free-typed amount and a status the UI
-- could set to anything, which made "Settled" mean nothing: no money
-- moved and no record said which charges were claimed.
--
-- This adds:
--   * the line items a claim covers (with a snapshot of what they said
--     at the time, because invoices get edited)
--   * the payment that settled the claim
--   * a server-issued claim number
--
-- Nothing here contacts SHA or any payer. The claim is drafted and
-- adjudicated locally; submitting it to a payer portal remains a manual
-- step until a real integration exists.

ALTER TABLE "insurance_claims"
  ADD COLUMN IF NOT EXISTS "settled_payment_id" integer;

ALTER TABLE "insurance_claims"
  ADD COLUMN IF NOT EXISTS "settled_at" timestamp;

ALTER TABLE "insurance_claims"
  ADD COLUMN IF NOT EXISTS "created_by_user_id" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'insurance_claims_settled_payment_id_billing_payments_id_fk'
  ) THEN
    ALTER TABLE "insurance_claims"
      ADD CONSTRAINT "insurance_claims_settled_payment_id_billing_payments_id_fk"
      FOREIGN KEY ("settled_payment_id") REFERENCES "billing_payments"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "insurance_claim_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "claim_id" integer NOT NULL,
  "billing_item_id" integer,
  /*
   * Snapshot of the line as it was when claimed. An invoice line can be
   * edited or voided afterwards; the claim must still say what it asked
   * for, or the payer's remittance cannot be reconciled.
   */
  "description" text NOT NULL,
  "amount" numeric(10, 2) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'insurance_claim_items_claim_id_insurance_claims_id_fk'
  ) THEN
    ALTER TABLE "insurance_claim_items"
      ADD CONSTRAINT "insurance_claim_items_claim_id_insurance_claims_id_fk"
      FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'insurance_claim_items_billing_item_id_billing_items_id_fk'
  ) THEN
    ALTER TABLE "insurance_claim_items"
      ADD CONSTRAINT "insurance_claim_items_billing_item_id_billing_items_id_fk"
      FOREIGN KEY ("billing_item_id") REFERENCES "billing_items"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "insurance_claim_items_claim_idx"
  ON "insurance_claim_items" ("claim_id");

/*
 * One claim row per invoice is available at a time. This is enforced in
 * the service under an invoice row lock rather than by a partial unique
 * index, because a database that already holds two open claims on one
 * invoice must still be able to migrate.
 */
CREATE INDEX IF NOT EXISTS "insurance_claims_invoice_status_idx"
  ON "insurance_claims" ("invoice_id", "status");

CREATE SEQUENCE IF NOT EXISTS "insurance_claim_number_seq";
