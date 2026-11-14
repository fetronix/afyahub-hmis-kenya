-- 0086 — a recorded surveillance count can be corrected, and the correction is
-- traceable.
--
-- public_health_reports could only ever be inserted. A count keyed in wrongly —
-- cholera cases entered as 40 instead of 4 — had no correction path at all.
-- The only way to "fix" it was to record a second report, which is exactly how
-- a weekly total silently doubles.
--
-- This adds a self-reference from a corrected report to the report it replaces.
-- The original row is kept with status 'SUPERSEDED'; nothing is deleted, so the
-- epi-week can be reconstructed from the table alone.
--
-- Deliberately no unique index on (facility, disease, epi_week, age_group):
-- existing deployments may already hold duplicates. The weekly summary reports
-- them explicitly instead of refusing to start or silently summing them.

ALTER TABLE public_health_reports
  ADD COLUMN IF NOT EXISTS supersedes_report_id integer
    REFERENCES public_health_reports(id);
--> statement-breakpoint
ALTER TABLE public_health_reports
  DROP CONSTRAINT IF EXISTS public_health_reports_not_self_superseding;
--> statement-breakpoint
ALTER TABLE public_health_reports
  ADD CONSTRAINT public_health_reports_not_self_superseding
  CHECK (supersedes_report_id IS NULL OR supersedes_report_id <> id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS public_health_reports_facility_week_idx
  ON public_health_reports (facility_id, epi_week, disease_code, age_group);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS public_health_reports_supersedes_idx
  ON public_health_reports (supersedes_report_id)
  WHERE supersedes_report_id IS NOT NULL;
