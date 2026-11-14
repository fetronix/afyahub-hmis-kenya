-- Additive only. Existing encrypted credentials and all historical transactions
-- remain unchanged. NULL means that no revocation has been recorded.
ALTER TABLE facility_payment_secrets
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
--> statement-breakpoint
-- Payer environment entries are references only; no live payer transport is
-- implemented. Versioning prevents an old reference silently becoming active.
ALTER TABLE insurance_payer_environment_configs
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS credential_generation integer NOT NULL DEFAULT 1;
