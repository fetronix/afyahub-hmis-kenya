-- Add explicit policy applicability and additional evidence for NEW admissions.
-- Historical settings, admissions, occupancies, prices and financial rows are
-- intentionally not populated, changed or deleted. A legacy policy whose new
-- applicability fields are NULL requires an authorized confirmation.
ALTER TABLE inpatient_bed_billing_policies
  ADD COLUMN IF NOT EXISTS is_active boolean,
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_until date;
--> statement-breakpoint
ALTER TABLE inpatient_bed_billing_policies
  ADD CONSTRAINT inpatient_bed_policy_effective_dates_check
  CHECK (effective_until IS NULL OR effective_from IS NOT NULL AND effective_until >= effective_from);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS inpatient_bed_policy_scope_uq ON inpatient_bed_billing_policies(id, tenant_id, facility_id);
--> statement-breakpoint
ALTER TABLE inpatient_bed_stay_snapshots
  ADD COLUMN IF NOT EXISTS policy_id integer,
  ADD COLUMN IF NOT EXISTS policy_applicability text,
  ADD COLUMN IF NOT EXISTS policy_effective_from date,
  ADD COLUMN IF NOT EXISTS policy_effective_until date;
--> statement-breakpoint
ALTER TABLE inpatient_bed_stay_snapshots
  ADD CONSTRAINT inpatient_bed_stay_policy_scope_fk FOREIGN KEY (policy_id, tenant_id, facility_id)
  REFERENCES inpatient_bed_billing_policies(id, tenant_id, facility_id);
--> statement-breakpoint
ALTER TABLE inpatient_bed_occupancies
  ADD COLUMN IF NOT EXISTS price_revision_snapshot integer CHECK (price_revision_snapshot IS NULL OR price_revision_snapshot > 0);
