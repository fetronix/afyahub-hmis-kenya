-- Platform policy is separate from existing facility payer configuration.
-- Existing rows and clinical/financial history are never rewritten. Previously
-- configured payers require explicit platform review before new operations.
CREATE TABLE IF NOT EXISTS insurance_payer_definitions (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  payer_type text NOT NULL CHECK (payer_type IN ('PUBLIC_SCHEME','PRIVATE_INSURER')),
  adapter_key text NOT NULL,
  information_url text NOT NULL,
  status text NOT NULL DEFAULT 'DISABLED' CHECK (status IN ('ACTIVE','DISABLED')),
  requestable boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS insurance_payer_capability_policies (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES insurance_payer_definitions(id),
  capability text NOT NULL,
  is_allowed boolean NOT NULL DEFAULT false,
  UNIQUE(provider_id, capability)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS insurance_payer_assignments (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES insurance_payer_definitions(id),
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  is_allowed boolean NOT NULL DEFAULT false,
  assignment_source text NOT NULL DEFAULT 'PLATFORM',
  sandbox_status text NOT NULL DEFAULT 'NOT_TESTED' CHECK (sandbox_status IN ('NOT_TESTED','VERIFIED')),
  production_approval text NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (production_approval IN ('NOT_REQUESTED','PENDING','APPROVED','REJECTED')),
  production_requested_by_user_id integer REFERENCES users(id),
  production_decided_by_user_id integer REFERENCES users(id),
  approval_reference text,
  updated_by_user_id integer REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (facility_id, tenant_id) REFERENCES facilities(id, tenant_id),
  UNIQUE(provider_id, facility_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS insurance_payer_environment_configs (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES insurance_payer_definitions(id),
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  environment text NOT NULL CHECK (environment IN ('SANDBOX','PRODUCTION')),
  secret_env_prefix text NOT NULL UNIQUE,
  provider_identifier text,
  updated_by_user_id integer REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (facility_id, tenant_id) REFERENCES facilities(id, tenant_id),
  UNIQUE(provider_id,facility_id,environment)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS insurance_payer_access_requests (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES insurance_payer_definitions(id),
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','GRANTED','DECLINED')),
  requested_by_user_id integer NOT NULL REFERENCES users(id),
  requested_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (facility_id, tenant_id) REFERENCES facilities(id, tenant_id),
  UNIQUE(provider_id, facility_id)
);
--> statement-breakpoint
INSERT INTO insurance_payer_definitions(code, display_name, payer_type, adapter_key, information_url, status) VALUES
  ('SHA','Social Health Authority (SHA)','PUBLIC_SCHEME','sha_afyalink','https://api-edi.provider.sha.go.ke/','ACTIVE'),
  ('BRITAM','Britam Insurance (Kenya)','PRIVATE_INSURER','britam_direct','https://ke.britam.com/help/file-a-claim/medical-insurance-claim','ACTIVE'),
  ('PACIS','PACIS Insurance Company Ltd','PRIVATE_INSURER','pacis_direct','https://www.pacisinsurance.com/','ACTIVE'),
  ('CIC','CIC Insurance Group','PRIVATE_INSURER','cic_direct','https://ke.cicinsurancegroup.com/','ACTIVE')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
-- These are local/manual workflow permissions, not claims of provider API support.
INSERT INTO insurance_payer_capability_policies(provider_id, capability, is_allowed)
SELECT p.id, c.capability, true FROM insurance_payer_definitions p
CROSS JOIN (VALUES ('CONFIGURE'),('MEMBERSHIP'),('ELIGIBILITY'),('BENEFITS'),('MAPPINGS'),
  ('PREAUTHORIZATION'),('CLAIM_PREPARE'),('CLAIM_SUBMIT'),('CLAIM_STATUS'),('RECONCILIATION')) AS c(capability)
ON CONFLICT (provider_id, capability) DO NOTHING;
--> statement-breakpoint
-- Legacy automatic defaults are not evidence of a platform assignment.
-- Keep the configs, with a disabled assignment visible for review.
INSERT INTO insurance_payer_assignments(provider_id,tenant_id,facility_id,is_allowed,assignment_source)
SELECT p.id,c.tenant_id,c.facility_id,false,'LEGACY_REVIEW_REQUIRED'
FROM insurance_payer_configs c
JOIN insurance_payer_definitions p ON p.code=upper(c.payer_code)
JOIN facilities f ON f.id=c.facility_id AND f.tenant_id=c.tenant_id
ON CONFLICT (provider_id,facility_id) DO NOTHING;
--> statement-breakpoint
-- The old invoice-linked manual ledger previously stored only free-text names.
-- Leave historical names untouched; new claims store the registry code.
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS payer_code text;
--> statement-breakpoint
ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS manual_submission_reference text;
