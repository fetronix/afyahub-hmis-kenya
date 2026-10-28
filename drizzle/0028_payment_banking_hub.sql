-- Payment hub: global definitions are separate from facility-owned configuration.
-- No bank or mobile-money integration is assigned to a facility by migration.
CREATE TABLE IF NOT EXISTS payment_provider_definitions (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  adapter_key text NOT NULL,
  documentation_url text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  requestable boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_provider_environments (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES payment_provider_definitions(id),
  environment text NOT NULL CHECK (environment IN ('SANDBOX','PRODUCTION')),
  is_available boolean NOT NULL DEFAULT false,
  -- A reference is not a credential. Shared use is deliberately not wired
  -- to an adapter until provider-specific facility routing is verified.
  shared_secret_reference text,
  shared_contract_reference text,
  UNIQUE(provider_id, environment)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_provider_capability_policies (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES payment_provider_definitions(id),
  capability text NOT NULL,
  is_allowed boolean NOT NULL DEFAULT false,
  UNIQUE(provider_id, capability)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_provider_assignments (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES payment_provider_definitions(id),
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  is_allowed boolean NOT NULL DEFAULT false,
  shared_credentials_allowed boolean NOT NULL DEFAULT false,
  updated_by_user_id integer REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (facility_id, tenant_id) REFERENCES facilities(id, tenant_id),
  UNIQUE(provider_id, facility_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_provider_access_requests (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES payment_provider_definitions(id),
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','GRANTED','DECLINED')),
  requested_by_user_id integer NOT NULL REFERENCES users(id),
  requested_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (facility_id, tenant_id) REFERENCES facilities(id, tenant_id),
  UNIQUE(provider_id, facility_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS facility_payment_integrations (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES payment_provider_definitions(id),
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  environment text NOT NULL CHECK (environment IN ('SANDBOX','PRODUCTION')),
  enabled_capabilities text[] NOT NULL DEFAULT '{}',
  is_enabled boolean NOT NULL DEFAULT false,
  connection_status text NOT NULL DEFAULT 'NOT_TESTED' CHECK (connection_status IN ('NOT_TESTED','HEALTHY','UNAVAILABLE')),
  last_health_at timestamp,
  last_error_code text,
  production_approval text NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (production_approval IN ('NOT_REQUESTED','PENDING','APPROVED','REJECTED')),
  approval_reference text,
  production_requested_by_user_id integer REFERENCES users(id),
  approved_by_user_id integer REFERENCES users(id),
  approved_at timestamp,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (facility_id, tenant_id) REFERENCES facilities(id, tenant_id),
  FOREIGN KEY (provider_id, environment) REFERENCES payment_provider_environments(provider_id, environment),
  UNIQUE (provider_id, facility_id, environment),
  UNIQUE (id, facility_id, tenant_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS facility_payment_secrets (
  integration_id integer PRIMARY KEY,
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  encrypted_value text NOT NULL,
  credential_identity_hash text UNIQUE,
  updated_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (integration_id, facility_id, tenant_id) REFERENCES facility_payment_integrations(id, facility_id, tenant_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS facility_payment_accounts (
  id serial PRIMARY KEY,
  integration_id integer NOT NULL,
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  alias text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('BANK','MOBILE_MONEY','OTHER')),
  masked_identifier text NOT NULL,
  bank_account_id integer REFERENCES bank_accounts(id),
  authorization_state text NOT NULL DEFAULT 'PENDING' CHECK (authorization_state IN ('PENDING','AUTHORIZED','REVOKED')),
  created_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (integration_id, facility_id, tenant_id) REFERENCES facility_payment_integrations(id, facility_id, tenant_id),
  UNIQUE(integration_id, alias)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_hub_transactions (
  id serial PRIMARY KEY,
  integration_id integer NOT NULL,
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  invoice_id integer NOT NULL REFERENCES billing_invoices(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  provider_request_id text UNIQUE,
  status text NOT NULL DEFAULT 'INITIATING' CHECK (status IN ('INITIATING','PENDING','UNKNOWN','FAILED','PROVIDER_CONFIRMED','REVIEW_REQUIRED')),
  result_code text,
  last_query_at timestamp,
  initiated_by_user_id integer NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (integration_id, facility_id, tenant_id) REFERENCES facility_payment_integrations(id, facility_id, tenant_id),
  UNIQUE(facility_id, idempotency_key),
  UNIQUE(id, facility_id, tenant_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payment_hub_transactions_facility_idx ON payment_hub_transactions(tenant_id, facility_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_hub_webhook_events (
  id serial PRIMARY KEY,
  transaction_id integer NOT NULL,
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  event_hash text NOT NULL,
  result_code text,
  verification_state text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_state = 'UNVERIFIED'),
  received_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (transaction_id, facility_id, tenant_id) REFERENCES payment_hub_transactions(id, facility_id, tenant_id),
  UNIQUE(transaction_id, event_hash)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_hub_reconciliations (
  id serial PRIMARY KEY,
  transaction_id integer NOT NULL,
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  billing_payment_id integer NOT NULL REFERENCES billing_payments(id),
  status text NOT NULL DEFAULT 'MATCHED' CHECK (status IN ('MATCHED','VOIDED')),
  evidence_reference text NOT NULL,
  matched_by_user_id integer NOT NULL REFERENCES users(id),
  matched_at timestamp NOT NULL DEFAULT now(),
  voided_by_user_id integer REFERENCES users(id),
  voided_at timestamp,
  FOREIGN KEY (transaction_id, facility_id, tenant_id) REFERENCES payment_hub_transactions(id, facility_id, tenant_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS payment_hub_one_active_reconciliation_per_transaction ON payment_hub_reconciliations(transaction_id) WHERE status='MATCHED';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS payment_hub_one_active_reconciliation_per_receipt ON payment_hub_reconciliations(billing_payment_id) WHERE status='MATCHED';
--> statement-breakpoint
INSERT INTO payment_provider_definitions(code,display_name,adapter_key,documentation_url,description) VALUES
  ('KCB_BUNI','KCB Bank · BUNI','KCB_BUNI','https://buni.kcbgroup.com/','BUNI onboarding and sandbox; individual API permissions and contracts require KCB confirmation.'),
  ('NCBA','NCBA Bank','NCBA','https://ncbagroup.com/','Contact NCBA for approved business API documentation, credentials and sandbox availability.'),
  ('EQUITY','Equity Bank','EQUITY','https://equitygroupholdings.com/ke/pay-send-money/sme-small-business/payment-services/equity-online-for-business/','API banking and host-to-host connectivity require Equity onboarding and an approved contract.'),
  ('MPESA_DARAJA','Safaricom M-Pesa · Daraja','MPESA_DARAJA','https://developer.safaricom.co.ke/','Sandbox STK Push and query reference implementation; callbacks are unverified and production is blocked pending review.');
--> statement-breakpoint
INSERT INTO payment_provider_capability_policies(provider_id,capability,is_allowed)
SELECT id, capability, true FROM payment_provider_definitions
CROSS JOIN (VALUES ('PAYMENT_COLLECTION'),('PAYMENT_STATUS'),('NOTIFICATIONS'),('HEALTH')) AS supported(capability)
WHERE code='MPESA_DARAJA';
--> statement-breakpoint
INSERT INTO payment_provider_environments(provider_id,environment,is_available)
SELECT id, environment, environment='SANDBOX' FROM payment_provider_definitions CROSS JOIN (VALUES ('SANDBOX'),('PRODUCTION')) AS environments(environment);
--> statement-breakpoint
-- Enforce referenced resources in the same facility even if a future caller
-- bypasses the application service.
CREATE UNIQUE INDEX IF NOT EXISTS payment_hub_invoice_scope_idx ON billing_invoices(id,facility_id,tenant_id);
--> statement-breakpoint
ALTER TABLE payment_hub_transactions ADD CONSTRAINT payment_hub_invoice_scope_fk FOREIGN KEY (invoice_id,facility_id,tenant_id) REFERENCES billing_invoices(id,facility_id,tenant_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS payment_hub_bank_account_scope_idx ON bank_accounts(id,facility_id,tenant_id);
--> statement-breakpoint
ALTER TABLE facility_payment_accounts ADD CONSTRAINT payment_hub_bank_account_scope_fk FOREIGN KEY(bank_account_id,facility_id,tenant_id) REFERENCES bank_accounts(id,facility_id,tenant_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payment_hub_reconciliation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payment reconciliation history cannot be deleted'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'MATCHED' OR NEW.status <> 'VOIDED' OR
       (NEW.transaction_id,NEW.tenant_id,NEW.facility_id,NEW.billing_payment_id,NEW.evidence_reference,NEW.matched_by_user_id,NEW.matched_at)
         IS DISTINCT FROM (OLD.transaction_id,OLD.tenant_id,OLD.facility_id,OLD.billing_payment_id,OLD.evidence_reference,OLD.matched_by_user_id,OLD.matched_at)
       OR NEW.voided_by_user_id IS NULL OR NEW.voided_at IS NULL THEN
      RAISE EXCEPTION 'Only an audited reconciliation void is permitted';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM payment_hub_transactions t
    JOIN facility_payment_integrations i ON i.id=t.integration_id AND i.facility_id=t.facility_id AND i.tenant_id=t.tenant_id
    JOIN billing_payments p ON p.id=NEW.billing_payment_id AND p.invoice_id=t.invoice_id
    JOIN billing_invoices b ON b.id=p.invoice_id AND b.facility_id=t.facility_id AND b.tenant_id=t.tenant_id
    WHERE t.id=NEW.transaction_id AND t.facility_id=NEW.facility_id AND t.tenant_id=NEW.tenant_id
      AND t.status='PROVIDER_CONFIRMED' AND i.environment='PRODUCTION' AND p.amount*100=t.amount_cents
      AND p.transaction_code IS NOT NULL
  ) THEN RAISE EXCEPTION 'A confirmed production transaction and same-facility receipt are required'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_hub_reconciliation_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON payment_hub_reconciliations FOR EACH ROW EXECUTE FUNCTION payment_hub_reconciliation_guard();
