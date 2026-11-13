-- Additive bed-billing evidence. No admission, transfer, invoice, payment or
-- historical price is rewritten. Existing stays have no captured occupancy
-- or policy and must be explicitly reviewed before they can be repriced.
ALTER TABLE beds
  ADD COLUMN IF NOT EXISTS price_revision integer NOT NULL DEFAULT 1 CHECK (price_revision > 0),
  ADD COLUMN IF NOT EXISTS daily_charge_review_required boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- 1500.00 was the old database default, so it may not have been configured.
-- Flag it for confirmation without changing the amount. New rows have no default.
UPDATE beds SET daily_charge_review_required = true WHERE daily_charge = 1500.00;
--> statement-breakpoint
ALTER TABLE beds ALTER COLUMN daily_charge DROP DEFAULT;
--> statement-breakpoint
CREATE FUNCTION jcare_guard_bed_price_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.daily_charge IS DISTINCT FROM OLD.daily_charge
     OR NEW.daily_charge_review_required IS DISTINCT FROM OLD.daily_charge_review_required THEN
    IF OLD.price_revision >= 2147483647 OR NEW.price_revision <> OLD.price_revision + 1 THEN
      RAISE EXCEPTION 'A bed price change or confirmation requires the next price revision' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.price_revision <> OLD.price_revision THEN
    RAISE EXCEPTION 'Bed price revision cannot change alone' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_bed_price_revision_guard BEFORE UPDATE ON beds
FOR EACH ROW EXECUTE FUNCTION jcare_guard_bed_price_revision();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS inpatient_bed_billing_policies (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL UNIQUE REFERENCES facilities(id),
  cutoff_minutes integer NOT NULL CHECK (cutoff_minutes BETWEEN 0 AND 1439),
  grace_minutes integer NOT NULL CHECK (grace_minutes BETWEEN 0 AND 1439),
  same_day_rule text NOT NULL CHECK (same_day_rule IN ('ONE', 'ZERO')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by_user_id integer NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (facility_id, tenant_id) REFERENCES facilities(id, tenant_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS admissions_bed_scope_uq ON admissions(id, tenant_id, facility_id, patient_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS wards_bed_scope_uq ON wards(id, facility_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS beds_ward_scope_uq ON beds(id, ward_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS inpatient_bed_stay_snapshots (
  id serial PRIMARY KEY,
  admission_id integer NOT NULL UNIQUE,
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  patient_id integer NOT NULL,
  timezone_snapshot text,
  cutoff_minutes integer CHECK (cutoff_minutes BETWEEN 0 AND 1439),
  grace_minutes integer CHECK (grace_minutes BETWEEN 0 AND 1439),
  same_day_rule text CHECK (same_day_rule IN ('ONE', 'ZERO')),
  policy_revision integer,
  manual_admission_time boolean NOT NULL DEFAULT false,
  manual_discharge_time boolean NOT NULL DEFAULT false,
  captured_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (admission_id, tenant_id, facility_id, patient_id)
    REFERENCES admissions(id, tenant_id, facility_id, patient_id)
);
--> statement-breakpoint
-- Explicit, attested review never edits the original clinical or financial rows.
CREATE TABLE IF NOT EXISTS inpatient_bed_billing_reviews (
  id serial PRIMARY KEY,
  admission_id integer NOT NULL UNIQUE,
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  patient_id integer NOT NULL,
  timezone_snapshot text NOT NULL,
  cutoff_minutes integer NOT NULL CHECK (cutoff_minutes BETWEEN 0 AND 1439),
  grace_minutes integer NOT NULL CHECK (grace_minutes BETWEEN 0 AND 1439),
  same_day_rule text NOT NULL CHECK (same_day_rule IN ('ONE', 'ZERO')),
  evidence_reference text NOT NULL,
  reason text NOT NULL,
  reviewed_by_user_id integer NOT NULL REFERENCES users(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (admission_id, tenant_id, facility_id, patient_id)
    REFERENCES admissions(id, tenant_id, facility_id, patient_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS inpatient_bed_occupancies (
  id serial PRIMARY KEY,
  admission_id integer NOT NULL,
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  patient_id integer NOT NULL,
  ward_id integer NOT NULL,
  bed_id integer NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  daily_rate_snapshot numeric(10,2) CHECK (daily_rate_snapshot IS NULL OR daily_rate_snapshot > 0),
  bed_number_snapshot text NOT NULL,
  bed_type_snapshot text,
  ward_name_snapshot text NOT NULL,
  review_id integer REFERENCES inpatient_bed_billing_reviews(id),
  recorded_by_user_id integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  FOREIGN KEY (admission_id, tenant_id, facility_id, patient_id)
    REFERENCES admissions(id, tenant_id, facility_id, patient_id),
  FOREIGN KEY (ward_id, facility_id) REFERENCES wards(id, facility_id),
  FOREIGN KEY (bed_id, ward_id) REFERENCES beds(id, ward_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS inpatient_bed_occupancies_open_admission_uq
  ON inpatient_bed_occupancies(admission_id) WHERE ended_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS inpatient_bed_occupancies_open_bed_uq
  ON inpatient_bed_occupancies(bed_id) WHERE ended_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inpatient_bed_occupancies_history_idx
  ON inpatient_bed_occupancies(admission_id, started_at, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS inpatient_bed_occupancies_scope_uq
  ON inpatient_bed_occupancies(id, admission_id, tenant_id, facility_id, patient_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS inpatient_bed_nights (
  id serial PRIMARY KEY,
  admission_id integer NOT NULL,
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  patient_id integer NOT NULL,
  occupancy_id integer NOT NULL,
  billing_date date NOT NULL,
  cutoff_at timestamptz,
  unit_price_snapshot numeric(10,2) CHECK (unit_price_snapshot IS NULL OR unit_price_snapshot > 0),
  total_snapshot numeric(10,2) CHECK (total_snapshot IS NULL OR total_snapshot > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(admission_id, billing_date),
  CHECK ((unit_price_snapshot IS NULL AND total_snapshot IS NULL) OR unit_price_snapshot = total_snapshot),
  FOREIGN KEY (occupancy_id, admission_id, tenant_id, facility_id, patient_id)
    REFERENCES inpatient_bed_occupancies(id, admission_id, tenant_id, facility_id, patient_id)
);
--> statement-breakpoint
ALTER TABLE billing_items
  ADD COLUMN IF NOT EXISTS bed_occupancy_id integer REFERENCES inpatient_bed_occupancies(id),
  ADD COLUMN IF NOT EXISTS bed_night_id integer REFERENCES inpatient_bed_nights(id);
--> statement-breakpoint
CREATE FUNCTION jcare_guard_inpatient_bed_occupancy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bed occupancy evidence cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL OR NEW.ended_at < OLD.started_at
     OR (to_jsonb(NEW) - 'ended_at') IS DISTINCT FROM (to_jsonb(OLD) - 'ended_at') THEN
    RAISE EXCEPTION 'Bed occupancy evidence may only be closed once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_inpatient_bed_occupancy_guard BEFORE UPDATE OR DELETE ON inpatient_bed_occupancies
FOR EACH ROW EXECUTE FUNCTION jcare_guard_inpatient_bed_occupancy();
--> statement-breakpoint
CREATE FUNCTION jcare_guard_inpatient_bed_stay() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bed stay evidence cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF OLD.manual_discharge_time OR NOT NEW.manual_discharge_time
     OR (to_jsonb(NEW) - 'manual_discharge_time') IS DISTINCT FROM (to_jsonb(OLD) - 'manual_discharge_time') THEN
    RAISE EXCEPTION 'Bed stay policy snapshots are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_inpatient_bed_stay_guard BEFORE UPDATE OR DELETE ON inpatient_bed_stay_snapshots
FOR EACH ROW EXECUTE FUNCTION jcare_guard_inpatient_bed_stay();
--> statement-breakpoint
CREATE FUNCTION jcare_guard_inpatient_bed_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Bed billing evidence is immutable; use a controlled correction' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_inpatient_bed_review_guard BEFORE UPDATE OR DELETE ON inpatient_bed_billing_reviews
FOR EACH ROW EXECUTE FUNCTION jcare_guard_inpatient_bed_evidence();
--> statement-breakpoint
CREATE TRIGGER jcare_inpatient_bed_night_guard BEFORE UPDATE OR DELETE ON inpatient_bed_nights
FOR EACH ROW EXECUTE FUNCTION jcare_guard_inpatient_bed_evidence();
--> statement-breakpoint
CREATE FUNCTION jcare_guard_inpatient_bed_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source_type = 'BED_DAY' AND OLD.bed_night_id IS NOT NULL THEN
    RAISE EXCEPTION 'Bed-occupancy invoice lines require an audited correction' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_inpatient_bed_line_guard BEFORE UPDATE OR DELETE ON billing_items
FOR EACH ROW EXECUTE FUNCTION jcare_guard_inpatient_bed_line();
