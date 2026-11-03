-- Reuse the existing ward rate, but do not treat any historical value as an
-- approved billing price. Older schemas defaulted it to 1500.00, so every
-- existing row requires an explicit, audited confirmation. No clinical,
-- occupancy, night, invoice, payment or ledger row is rewritten.
ALTER TABLE wards
  ADD COLUMN IF NOT EXISTS daily_rate_configured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_rate_revision integer NOT NULL DEFAULT 1 CHECK (daily_rate_revision > 0);
--> statement-breakpoint
ALTER TABLE wards ALTER COLUMN daily_rate DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE wards ADD CONSTRAINT wards_configured_daily_rate_positive
  CHECK (NOT daily_rate_configured OR (daily_rate IS NOT NULL AND daily_rate > 0));
--> statement-breakpoint
CREATE FUNCTION jcare_guard_ward_price_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.daily_rate IS DISTINCT FROM OLD.daily_rate
     OR NEW.daily_rate_configured IS DISTINCT FROM OLD.daily_rate_configured THEN
    IF OLD.daily_rate_revision >= 2147483647 OR NEW.daily_rate_revision <> OLD.daily_rate_revision + 1 THEN
      RAISE EXCEPTION 'A ward price change or confirmation requires the next price revision' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.daily_rate_revision <> OLD.daily_rate_revision THEN
    RAISE EXCEPTION 'Ward price revision cannot change alone' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_ward_price_revision_guard BEFORE UPDATE ON wards
FOR EACH ROW EXECUTE FUNCTION jcare_guard_ward_price_revision();
--> statement-breakpoint
-- NULL means legacy/unavailable provenance, not a guessed ward/bed source.
-- The existing immutable occupancy and night triggers protect these fields.
ALTER TABLE inpatient_bed_occupancies
  ADD COLUMN IF NOT EXISTS rate_source_snapshot text
    CHECK (rate_source_snapshot IN ('BED_OVERRIDE', 'WARD_DEFAULT', 'REVIEWED')),
  ADD CONSTRAINT inpatient_occupancy_source_has_rate
    CHECK (rate_source_snapshot IS NULL OR daily_rate_snapshot IS NOT NULL),
  ADD CONSTRAINT inpatient_occupancy_configured_source_revision
    CHECK (rate_source_snapshot NOT IN ('BED_OVERRIDE', 'WARD_DEFAULT') OR price_revision_snapshot IS NOT NULL);
--> statement-breakpoint
ALTER TABLE inpatient_bed_nights
  ADD COLUMN IF NOT EXISTS rate_source_snapshot text
    CHECK (rate_source_snapshot IN ('BED_OVERRIDE', 'WARD_DEFAULT', 'REVIEWED')),
  ADD COLUMN IF NOT EXISTS price_revision_snapshot integer
    CHECK (price_revision_snapshot IS NULL OR price_revision_snapshot > 0),
  ADD CONSTRAINT inpatient_night_source_has_rate
    CHECK (rate_source_snapshot IS NULL OR unit_price_snapshot IS NOT NULL),
  ADD CONSTRAINT inpatient_night_configured_source_revision
    CHECK (rate_source_snapshot NOT IN ('BED_OVERRIDE', 'WARD_DEFAULT') OR price_revision_snapshot IS NOT NULL);
