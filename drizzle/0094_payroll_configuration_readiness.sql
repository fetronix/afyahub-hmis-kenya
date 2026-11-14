-- No accounts, statutory figures, verification attestations or history are seeded/backfilled.
ALTER TABLE payroll_statutory_versions ADD COLUMN IF NOT EXISTS verified_on date;
ALTER TABLE payroll_statutory_versions ADD COLUMN IF NOT EXISTS verified_by integer REFERENCES users(id);
ALTER TABLE payroll_statutory_versions ADD COLUMN IF NOT EXISTS verified_at timestamp;
ALTER TABLE payroll_statutory_versions ADD COLUMN IF NOT EXISTS verification_reference text;
ALTER TABLE payroll_statutory_versions ADD COLUMN IF NOT EXISTS verification_purpose text;
--> statement-breakpoint
-- Permit a correctly verified replacement draft at the same effective date as a legacy version.
-- Active overlap is serialized and refused by the trigger below, not by an insufficient start-date key.
DROP INDEX IF EXISTS payroll_statutory_versions_facility_statute_from_idx;
CREATE INDEX IF NOT EXISTS payroll_statutory_versions_facility_statute_date_idx ON payroll_statutory_versions(facility_id,statute,effective_from);
--> statement-breakpoint
ALTER TABLE payroll_statutory_versions ADD CONSTRAINT payroll_verification_complete CHECK (
 (verified_on IS NULL AND verified_by IS NULL AND verified_at IS NULL AND verification_reference IS NULL AND verification_purpose IS NULL) OR
 (verified_on IS NOT NULL AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND length(trim(verification_reference)) BETWEEN 8 AND 1000 AND verification_purpose IN ('AUTHORITY_SOURCE','SYNTHETIC_TEST'))
);
--> statement-breakpoint
-- Existing payroll_rule_history_guard and payroll_band_history_guard triggers from 0093
-- remain attached to this replaced function; do not duplicate them.
CREATE OR REPLACE FUNCTION jcare_payroll_rule_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_status text;
BEGIN
 IF TG_TABLE_NAME='payroll_statutory_versions' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Statutory version history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(OLD)-ARRAY['status','verified_on','verified_by','verified_at','verification_reference','verification_purpose']) IS DISTINCT FROM
     (to_jsonb(NEW)-ARRAY['status','verified_on','verified_by','verified_at','verification_reference','verification_purpose']) THEN
    RAISE EXCEPTION 'Replace statutory calculation/source history instead of editing it' USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(OLD)-'status') IS DISTINCT FROM (to_jsonb(NEW)-'status') AND
    (OLD.status<>'DRAFT' OR NEW.status<>'DRAFT' OR OLD.verified_by IS NOT NULL) THEN
    RAISE EXCEPTION 'Only an unverified draft may receive its once-only source verification' USING ERRCODE='23514';
  END IF;
 ELSE
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Statutory bands are immutable; create a replacement version' USING ERRCODE='23514'; END IF;
  SELECT status INTO version_status FROM payroll_statutory_versions WHERE id=NEW.version_id FOR SHARE;
  IF version_status<>'DRAFT' OR EXISTS(SELECT 1 FROM payroll_statutory_versions WHERE id=NEW.version_id AND verified_by IS NOT NULL) THEN
    RAISE EXCEPTION 'Bands can only be added to an unverified draft' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION jcare_payroll_verification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.verified_on IS NOT NULL THEN
  IF NEW.verified_on>CURRENT_DATE OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.verified_by AND u.tenant_id=NEW.tenant_id AND u.facility_id=NEW.facility_id) THEN
    RAISE EXCEPTION 'Source verification requires a non-future date and scoped facility actor' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.status='ACTIVE' THEN
  IF NEW.verified_by IS NULL OR NEW.calculation_config IS NULL OR NOT EXISTS(SELECT 1 FROM payroll_statutory_bands b WHERE b.version_id=NEW.id) THEN
    RAISE EXCEPTION 'Activation requires source verification, explicit policy and bands' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll-statutory',NEW.facility_id));
  IF EXISTS(SELECT 1 FROM payroll_statutory_versions v WHERE v.id<>NEW.id AND v.facility_id=NEW.facility_id AND v.statute=NEW.statute
    AND (v.status='ACTIVE' OR (v.status='RETIRED' AND v.verified_by IS NOT NULL AND v.effective_to IS NOT NULL))
    AND v.effective_from<=coalesce(NEW.effective_to,'9999-12-31'::date) AND NEW.effective_from<=coalesce(v.effective_to,'9999-12-31'::date)) THEN
    RAISE EXCEPTION 'Statutory effective dates overlap an activated policy' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payroll_verification_guard BEFORE INSERT OR UPDATE ON payroll_statutory_versions FOR EACH ROW EXECUTE FUNCTION jcare_payroll_verification_guard();
