-- Additive only: preserve existing environment references and all historical
-- payment/insurance records. NULL means the legacy source/expiry is unknown.
ALTER TABLE facility_payment_secrets
  ADD COLUMN IF NOT EXISTS credential_source text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
--> statement-breakpoint
-- Jubilee is requestable marketplace metadata, not an insurer API contract or
-- a facility assignment. Never modify an existing definition or its policies.
WITH inserted AS (
  INSERT INTO insurance_payer_definitions(code,display_name,payer_type,adapter_key,information_url,status)
  VALUES ('JUBILEE','Jubilee Health Insurance (Kenya)','PRIVATE_INSURER','manual',
          'https://jubileeinsurance.com/ke/medical-provider/','ACTIVE')
  ON CONFLICT (code) DO NOTHING
  RETURNING id
)
INSERT INTO insurance_payer_capability_policies(provider_id,capability,is_allowed)
SELECT inserted.id, workflows.capability, true FROM inserted
CROSS JOIN (VALUES ('CONFIGURE'),('MEMBERSHIP'),('ELIGIBILITY'),('BENEFITS'),('MAPPINGS'),
  ('PREAUTHORIZATION'),('CLAIM_PREPARE'),('CLAIM_SUBMIT'),('CLAIM_STATUS'),('RECONCILIATION'))
  AS workflows(capability)
ON CONFLICT (provider_id,capability) DO NOTHING;
