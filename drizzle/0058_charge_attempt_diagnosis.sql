-- Keep the existing high-level reason and historical queue rows unchanged.
-- New evaluations may record the specific resolver diagnosis separately.
ALTER TABLE "billing_charge_attempts" ADD COLUMN IF NOT EXISTS "diagnosis_code" text;
