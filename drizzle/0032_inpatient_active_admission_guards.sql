-- Additive safety guards; never alter or deduplicate existing admission records.
-- Existing conflicts require manual clinical/operational review before this migration.
-- Abort on same-named unjournaled indexes rather than trusting their definitions.
DO $$
BEGIN
  IF to_regclass('admissions_active_bed_uq') IS NOT NULL
    OR to_regclass('admissions_active_facility_patient_uq') IS NOT NULL THEN
    RAISE EXCEPTION 'Inpatient admission guard indexes already exist without this journal entry; review their definitions';
  END IF;
  IF EXISTS (
    SELECT 1 FROM admissions WHERE status = 'Admitted'
    GROUP BY bed_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple active admissions occupy a bed; reconcile manually before applying inpatient safety guards';
  END IF;
  IF EXISTS (
    SELECT 1 FROM admissions WHERE status = 'Admitted'
    GROUP BY facility_id, patient_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A patient has multiple active admissions in a facility; reconcile manually before applying inpatient safety guards';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admissions_active_bed_uq"
  ON "admissions" ("bed_id") WHERE "status" = 'Admitted';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admissions_active_facility_patient_uq"
  ON "admissions" ("facility_id", "patient_id") WHERE "status" = 'Admitted';
