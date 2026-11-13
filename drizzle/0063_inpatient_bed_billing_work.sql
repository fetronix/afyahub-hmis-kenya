-- A clinical discharge records durable work without depending on a successful
-- bed-night/charge queue write. Existing admissions are not backfilled.
CREATE TABLE IF NOT EXISTS inpatient_bed_billing_work (
  admission_id integer PRIMARY KEY,
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  patient_id integer NOT NULL,
  recorded_by_user_id integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  staged_at timestamptz,
  CHECK (staged_at IS NULL OR staged_at >= created_at),
  FOREIGN KEY (admission_id, tenant_id, facility_id, patient_id)
    REFERENCES admissions(id, tenant_id, facility_id, patient_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inpatient_bed_billing_work_pending_idx
  ON inpatient_bed_billing_work(tenant_id, facility_id, created_at)
  WHERE staged_at IS NULL;
--> statement-breakpoint
-- The work marker is retained as evidence; it can only transition once from
-- pending to staged, in the same transaction as the staged charge identities.
CREATE FUNCTION jcare_guard_inpatient_bed_billing_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bed billing work cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF OLD.staged_at IS NOT NULL OR NEW.staged_at IS NULL
     OR (to_jsonb(NEW) - 'staged_at') IS DISTINCT FROM (to_jsonb(OLD) - 'staged_at') THEN
    RAISE EXCEPTION 'Bed billing work may only be staged once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_inpatient_bed_billing_work_guard BEFORE UPDATE OR DELETE ON inpatient_bed_billing_work
FOR EACH ROW EXECUTE FUNCTION jcare_guard_inpatient_bed_billing_work();
