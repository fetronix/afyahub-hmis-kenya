-- Correct the nullable-reference CHECK from 0044 without rewriting tariffs.
ALTER TABLE facility_service_tariffs ADD CONSTRAINT facility_tariff_approval_reference_required CHECK (
  approval_status <> 'APPROVED' OR (approval_reference IS NOT NULL AND length(trim(approval_reference)) BETWEEN 3 AND 200)
);
--> statement-breakpoint
-- An approved price must use the exact master unit and the same tenant/facility.
CREATE OR REPLACE FUNCTION jcare_tariff_master_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m master_services%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM facilities f WHERE f.id=NEW.facility_id AND f.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION 'Tariff facility and tenant do not match' USING ERRCODE='23514';
  END IF;
  IF NEW.master_service_id IS NOT NULL THEN
    SELECT * INTO m FROM master_services WHERE id=NEW.master_service_id;
    IF NOT FOUND OR (m.tenant_id IS NOT NULL AND m.tenant_id <> NEW.tenant_id) OR (m.origin_facility_id IS NOT NULL AND m.origin_facility_id <> NEW.facility_id) THEN
      RAISE EXCEPTION 'Master service is outside the tariff facility' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.revision := OLD.revision + 1;
    IF OLD.master_service_id IS NOT NULL AND NEW.master_service_id = OLD.master_service_id AND NEW.code <> OLD.code THEN
      RAISE EXCEPTION 'A mapped tariff code cannot be changed' USING ERRCODE='23514';
    END IF;
    IF (NEW.master_service_id,NEW.code,NEW.description,NEW.department,NEW.unit,NEW.fee,NEW.effective_from,NEW.effective_to,NEW.auto_bill,NEW.is_active)
       IS DISTINCT FROM
       (OLD.master_service_id,OLD.code,OLD.description,OLD.department,OLD.unit,OLD.fee,OLD.effective_from,OLD.effective_to,OLD.auto_bill,OLD.is_active) THEN
      NEW.approval_status := 'DRAFT';
      NEW.approved_by_user_id := NULL;
      NEW.approved_at := NULL;
      NEW.approval_reference := NULL;
    END IF;
  END IF;
  IF NEW.approval_status='APPROVED' AND (NEW.master_service_id IS NULL OR lower(trim(NEW.unit)) <> lower(trim(m.unit))) THEN
    RAISE EXCEPTION 'Approved tariff unit must match its master service' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Only real, same-facility clinical identities can be bound to the matching family.
CREATE FUNCTION jcare_master_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m master_services%ROWTYPE; source_exists boolean;
BEGIN
  SELECT * INTO m FROM master_services WHERE id=NEW.master_service_id;
  IF NOT FOUND OR (m.tenant_id IS NOT NULL AND m.tenant_id <> NEW.tenant_id) OR (m.origin_facility_id IS NOT NULL AND m.origin_facility_id <> NEW.facility_id) THEN
    RAISE EXCEPTION 'Master source mapping is outside its facility' USING ERRCODE='23514';
  END IF;
  IF NEW.source_type='LAB_TEST' AND m.billing_family='LABORATORY' THEN
    SELECT EXISTS(SELECT 1 FROM lab_tests WHERE id=NEW.source_id AND facility_id=NEW.facility_id) INTO source_exists;
  ELSIF NEW.source_type='PHARMACY' AND m.billing_family='PHARMACY' THEN
    SELECT EXISTS(SELECT 1 FROM inventory_items WHERE id=NEW.source_id AND facility_id=NEW.facility_id) INTO source_exists;
  ELSIF NEW.source_type='BED_DAY' AND m.billing_family='BED_DAY' THEN
    SELECT EXISTS(SELECT 1 FROM wards WHERE id=NEW.source_id AND facility_id=NEW.facility_id) INTO source_exists;
  ELSE
    source_exists := false;
  END IF;
  IF NOT source_exists THEN RAISE EXCEPTION 'Invalid clinical source mapping' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER master_service_source_guard BEFORE INSERT OR UPDATE ON master_service_sources FOR EACH ROW EXECUTE FUNCTION jcare_master_source_guard();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS master_service_aliases (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('LAB_TEST','PHARMACY','BED_DAY')),
  alias text NOT NULL CHECK (length(trim(alias)) BETWEEN 1 AND 80),
  master_service_id integer NOT NULL REFERENCES master_services(id),
  approval_reference text NOT NULL CHECK (length(trim(approval_reference)) BETWEEN 3 AND 200),
  approved_by_user_id integer NOT NULL REFERENCES users(id),
  approved_at timestamp NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT master_alias_scope_fk FOREIGN KEY (facility_id,tenant_id) REFERENCES facilities(id,tenant_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS master_alias_active_unique ON master_service_aliases (facility_id,source_type,upper(trim(alias))) WHERE is_active;
--> statement-breakpoint
CREATE FUNCTION jcare_master_alias_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m master_services%ROWTYPE;
BEGIN
  SELECT * INTO m FROM master_services WHERE id=NEW.master_service_id;
  IF NOT FOUND OR (m.tenant_id IS NOT NULL AND m.tenant_id <> NEW.tenant_id) OR (m.origin_facility_id IS NOT NULL AND m.origin_facility_id <> NEW.facility_id) OR
     (NEW.source_type='LAB_TEST' AND m.billing_family<>'LABORATORY') OR
     (NEW.source_type='PHARMACY' AND m.billing_family<>'PHARMACY') OR
     (NEW.source_type='BED_DAY' AND m.billing_family<>'BED_DAY') OR
     NOT EXISTS(SELECT 1 FROM facility_service_tariffs t WHERE t.facility_id=NEW.facility_id AND t.tenant_id=NEW.tenant_id AND t.master_service_id=NEW.master_service_id) THEN
    RAISE EXCEPTION 'Invalid master service alias scope or family' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER master_service_alias_guard BEFORE INSERT OR UPDATE ON master_service_aliases FOR EACH ROW EXECUTE FUNCTION jcare_master_alias_guard();
--> statement-breakpoint
-- Verification is per-result, not evidence that a whole panel is complete.
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS completed_at timestamp;
--> statement-breakpoint
ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS completed_by_user_id integer REFERENCES users(id);
