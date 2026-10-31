-- Append-only identities for authorized tariff batches. Existing tariffs,
-- prices, invoices and historical audit rows are not changed or backfilled.
DO $$
BEGIN
  IF to_regclass('facility_tariff_import_batches') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname=current_schema() AND p.proname='jcare_tariff_import_guard') THEN
    RAISE EXCEPTION 'Unexpected pre-existing tariff import objects; review migration state';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS facility_tariff_import_batches (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash text NOT NULL,
  approval_reference text NOT NULL CHECK (length(trim(approval_reference)) BETWEEN 3 AND 200),
  result jsonb NOT NULL,
  row_count integer NOT NULL CHECK (row_count BETWEEN 1 AND 200),
  actor_user_id integer NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT facility_tariff_import_scope_fk FOREIGN KEY (facility_id,tenant_id) REFERENCES facilities(id,tenant_id),
  CONSTRAINT facility_tariff_import_facility_key_unique UNIQUE (facility_id,idempotency_key),
  CONSTRAINT facility_tariff_import_result_check CHECK (jsonb_typeof(result)='array' AND jsonb_array_length(result)=row_count)
);
--> statement-breakpoint
CREATE FUNCTION jcare_tariff_import_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Tariff import batches are immutable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id=NEW.actor_user_id AND u.tenant_id=NEW.tenant_id
    AND (u.facility_id IS NULL OR u.facility_id=NEW.facility_id) AND u.is_active AND u.account_status='ACTIVE') THEN
    RAISE EXCEPTION 'Tariff import actor is outside facility scope' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER facility_tariff_import_batches_guard BEFORE INSERT OR UPDATE OR DELETE ON facility_tariff_import_batches
FOR EACH ROW EXECUTE FUNCTION jcare_tariff_import_guard();
