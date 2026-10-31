DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
       AND table_name IN ('sha_eclaims','private_insurance_claims') AND column_name='dispatch_revision')
     OR to_regclass('public.insurance_claim_dispatch_guards') IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected pre-existing claim dispatch schema; review migration state';
  END IF;
END $$;
--> statement-breakpoint
-- Additive dispatch safety. An in-flight/ambiguous reservation must survive a
-- process crash; it is not evidence of provider acceptance or payment.
ALTER TABLE sha_eclaims ADD COLUMN IF NOT EXISTS dispatch_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE private_insurance_claims ADD COLUMN IF NOT EXISTS dispatch_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE FUNCTION jcare_increment_claim_dispatch_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.dispatch_revision := OLD.dispatch_revision + 1;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_sha_dispatch_revision BEFORE UPDATE ON sha_eclaims
FOR EACH ROW EXECUTE FUNCTION jcare_increment_claim_dispatch_revision();
--> statement-breakpoint
CREATE TRIGGER jcare_private_dispatch_revision BEFORE UPDATE ON private_insurance_claims
FOR EACH ROW EXECUTE FUNCTION jcare_increment_claim_dispatch_revision();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS insurance_claim_dispatch_guards (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  workflow text NOT NULL CHECK (workflow IN ('SHA','PRIVATE')),
  claim_id integer NOT NULL,
  claim_revision integer NOT NULL CHECK (claim_revision >= 0),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  correlation_id text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'IN_FLIGHT' CHECK (state IN ('IN_FLIGHT','UNCERTAIN')),
  actor_user_id integer NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(workflow, claim_id)
);
--> statement-breakpoint
CREATE FUNCTION jcare_guard_claim_dispatch_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workflow = 'SHA' THEN
    PERFORM 1 FROM sha_eclaims WHERE id=NEW.claim_id AND tenant_id=NEW.tenant_id AND facility_id=NEW.facility_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM private_insurance_claims WHERE id=NEW.claim_id AND tenant_id=NEW.tenant_id AND facility_id=NEW.facility_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim dispatch scope is invalid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_claim_dispatch_scope_guard BEFORE INSERT ON insurance_claim_dispatch_guards
FOR EACH ROW EXECUTE FUNCTION jcare_guard_claim_dispatch_scope();
