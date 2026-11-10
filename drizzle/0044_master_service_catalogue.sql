-- Additive catalogue and approval metadata. No existing price, link, invoice,
-- source record or financial transaction is rewritten or inferred as approved.
CREATE TABLE IF NOT EXISTS master_services (
  id serial PRIMARY KEY,
  tenant_id integer REFERENCES tenants(id),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,79}$'),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 500),
  department text NOT NULL,
  billing_family text NOT NULL CHECK (billing_family IN ('CONSULTATION','LABORATORY','RADIOLOGY','PROCEDURE','ADMISSION','BED_DAY','DELIVERY','PHARMACY')),
  unit text NOT NULL CHECK (length(trim(unit)) BETWEEN 1 AND 50),
  clinical_source text NOT NULL,
  origin_facility_id integer REFERENCES facilities(id),
  origin_source_id integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT master_service_origin_scope CHECK (
    (origin_facility_id IS NULL AND origin_source_id IS NULL) OR
    (tenant_id IS NOT NULL AND origin_facility_id IS NOT NULL AND origin_source_id > 0)
  ),
  CONSTRAINT master_service_origin_facility_fk FOREIGN KEY (origin_facility_id, tenant_id) REFERENCES facilities(id, tenant_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS master_services_origin_unique ON master_services (origin_facility_id, clinical_source, origin_source_id) WHERE origin_source_id IS NOT NULL;
--> statement-breakpoint
-- These codes are JaliCare's internal identifiers, not payer or government codes.
-- Each corresponds to a source-defined encounter/admission/delivery mode.
INSERT INTO master_services (code, description, department, billing_family, unit, clinical_source) VALUES
('JC-OPD-CONSULT','Outpatient consultation','opd','CONSULTATION','Visit','ENCOUNTER:OUTPATIENT'),
('JC-OPD-FOLLOWUP','Follow-up consultation','opd','CONSULTATION','Visit','ENCOUNTER:FOLLOW_UP'),
('JC-EMERGENCY-CONSULT','Emergency consultation','opd','CONSULTATION','Visit','ENCOUNTER:EMERGENCY'),
('JC-ADMISSION','Inpatient admission','inpatient','ADMISSION','Admission','ADMISSION'),
('JC-DELIVERY-VERTEX','Spontaneous vertex delivery','inpatient','DELIVERY','Delivery','DELIVERY:Spontaneous Vertex'),
('JC-DELIVERY-ASSISTED','Assisted vaginal delivery','inpatient','DELIVERY','Delivery','DELIVERY:Assisted Vaginal'),
('JC-DELIVERY-BREECH','Breech delivery','inpatient','DELIVERY','Delivery','DELIVERY:Breech'),
('JC-DELIVERY-VACUUM','Vacuum delivery','inpatient','DELIVERY','Delivery','DELIVERY:Vacuum'),
('JC-DELIVERY-FORCEPS','Forceps delivery','inpatient','DELIVERY','Delivery','DELIVERY:Forceps'),
('JC-DELIVERY-CAESAREAN','Caesarean delivery','inpatient','DELIVERY','Delivery','DELIVERY:Caesarean Section');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS master_service_sources (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('LAB_TEST','PHARMACY','BED_DAY')),
  source_id integer NOT NULL CHECK (source_id > 0),
  master_service_id integer NOT NULL REFERENCES master_services(id),
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT master_service_sources_scope_fk FOREIGN KEY (facility_id, tenant_id) REFERENCES facilities(id, tenant_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS master_service_sources_active_unique ON master_service_sources (facility_id, source_type, source_id) WHERE is_active;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS master_service_sources_scope_idx ON master_service_sources (tenant_id, facility_id);
--> statement-breakpoint
ALTER TABLE facility_service_tariffs ADD COLUMN IF NOT EXISTS master_service_id integer REFERENCES master_services(id);
--> statement-breakpoint
ALTER TABLE facility_service_tariffs ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'DRAFT' CHECK (approval_status IN ('DRAFT','APPROVED'));
--> statement-breakpoint
ALTER TABLE facility_service_tariffs ADD COLUMN IF NOT EXISTS approved_by_user_id integer REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE facility_service_tariffs ADD COLUMN IF NOT EXISTS approved_at timestamp;
--> statement-breakpoint
ALTER TABLE facility_service_tariffs ADD COLUMN IF NOT EXISTS approval_reference text;
--> statement-breakpoint
ALTER TABLE facility_service_tariffs ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS facility_tariff_master_unique ON facility_service_tariffs (facility_id, master_service_id) WHERE master_service_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE facility_service_tariffs ADD CONSTRAINT facility_tariff_approval_complete CHECK (
  approval_status <> 'APPROVED' OR
  (master_service_id IS NOT NULL AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL
   AND length(trim(approval_reference)) BETWEEN 3 AND 200 AND fee > 0 AND length(trim(unit)) > 0)
);
--> statement-breakpoint
-- Changing price, scope, code, unit, dates or activation invalidates approval.
-- Existing audit logs and invoice snapshots are retained; approval is explicit.
CREATE FUNCTION jcare_tariff_master_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m master_services%ROWTYPE;
BEGIN
  IF NEW.master_service_id IS NOT NULL THEN
    SELECT * INTO m FROM master_services WHERE id=NEW.master_service_id;
    IF NOT FOUND OR (m.tenant_id IS NOT NULL AND m.tenant_id <> NEW.tenant_id) THEN
      RAISE EXCEPTION 'Master service is outside the tariff tenant' USING ERRCODE='23514';
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
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER facility_tariff_master_guard BEFORE INSERT OR UPDATE ON facility_service_tariffs FOR EACH ROW EXECUTE FUNCTION jcare_tariff_master_guard();
--> statement-breakpoint
-- Canonical codes and identity cannot be renamed after creation.
CREATE FUNCTION jcare_master_service_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.code, NEW.tenant_id, NEW.billing_family, NEW.clinical_source, NEW.origin_facility_id, NEW.origin_source_id)
     IS DISTINCT FROM (OLD.code, OLD.tenant_id, OLD.billing_family, OLD.clinical_source, OLD.origin_facility_id, OLD.origin_source_id) THEN
    RAISE EXCEPTION 'Master service identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER master_service_identity_guard BEFORE UPDATE ON master_services FOR EACH ROW EXECUTE FUNCTION jcare_master_service_identity_guard();
--> statement-breakpoint
ALTER TABLE billing_items ADD COLUMN IF NOT EXISTS master_service_id integer REFERENCES master_services(id);
--> statement-breakpoint
ALTER TABLE billing_items ADD COLUMN IF NOT EXISTS service_code text;
--> statement-breakpoint
ALTER TABLE billing_items ADD COLUMN IF NOT EXISTS service_department text;
--> statement-breakpoint
ALTER TABLE billing_items ADD COLUMN IF NOT EXISTS service_unit text;
--> statement-breakpoint
ALTER TABLE billing_charge_attempts ADD COLUMN IF NOT EXISTS service_ref_type text;
--> statement-breakpoint
ALTER TABLE billing_charge_attempts ADD COLUMN IF NOT EXISTS service_ref_id integer;
--> statement-breakpoint
ALTER TABLE billing_charge_attempts ADD COLUMN IF NOT EXISTS service_ref_code text;
--> statement-breakpoint
ALTER TABLE billing_charge_attempts ADD COLUMN IF NOT EXISTS service_date date;
--> statement-breakpoint
ALTER TABLE radiology_orders ADD COLUMN IF NOT EXISTS master_service_id integer REFERENCES master_services(id);
