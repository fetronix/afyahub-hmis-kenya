-- 0010 — Mobile money settlement
--
-- Payments need to record the code printed on the customer's M-Pesa or
-- Airtel confirmation message, and to say what the payment did to the
-- invoice (cleared it, left a balance, or overpaid).
--
-- Overpayment is stored as its own credit_balance column rather than a
-- negative balance_amount. A negative balance would quietly cancel out
-- other patients' debts whenever the facility totals what it is owed.

ALTER TABLE "billing_invoices"
  ADD COLUMN IF NOT EXISTS "credit_balance" numeric(10, 2) DEFAULT '0';

ALTER TABLE "billing_payments"
  ADD COLUMN IF NOT EXISTS "transaction_code" text;

ALTER TABLE "billing_payments"
  ADD COLUMN IF NOT EXISTS "settlement_status" text;

/*
 * One mobile money receipt may only be posted once. Without this, the
 * same M-Pesa message gets entered at two counters and the patient is
 * credited twice.
 *
 * Partial index, so cash and card payments — which have no code — are
 * unaffected.
 */
CREATE UNIQUE INDEX IF NOT EXISTS "billing_payments_transaction_code_unique"
  ON "billing_payments" (lower("transaction_code"))
  WHERE "transaction_code" IS NOT NULL;

/*
 * Receipt numbers are issued by the server so two tills punching at the
 * same millisecond cannot collide.
 */
CREATE SEQUENCE IF NOT EXISTS "billing_receipt_seq";
