-- Additive payroll controls: never recalculate or backfill published payroll history.
ALTER TABLE payroll_statutory_versions ADD COLUMN IF NOT EXISTS calculation_config jsonb;
ALTER TABLE payroll_employee_components ADD COLUMN IF NOT EXISTS statutory_exclusions jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION jcare_payroll_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_row payroll_runs%ROWTYPE; parent_id integer; target jsonb;
BEGIN
  IF TG_TABLE_NAME='payroll_runs' THEN
    IF TG_OP<>'INSERT' AND OLD.status IN ('APPROVED','POSTED') THEN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Approved payroll history is immutable' USING ERRCODE='23514'; END IF;
      IF OLD.status='POSTED' OR NEW.status<>'POSTED' OR
        (to_jsonb(OLD)-ARRAY['status','posted_by','posted_at','journal_entry_id']) IS DISTINCT FROM
        (to_jsonb(NEW)-ARRAY['status','posted_by','posted_at','journal_entry_id']) THEN
        RAISE EXCEPTION 'Approved payroll may only be finalized once' USING ERRCODE='23514';
      END IF;
    END IF;
    IF TG_OP<>'DELETE' AND NOT EXISTS(SELECT 1 FROM payroll_periods p WHERE p.id=NEW.period_id AND p.tenant_id=NEW.tenant_id AND p.facility_id=NEW.facility_id) THEN
      RAISE EXCEPTION 'Payroll period scope mismatch' USING ERRCODE='23514';
    END IF;
  ELSE
    IF TG_OP='DELETE' THEN target=to_jsonb(OLD); ELSE target=to_jsonb(NEW); END IF;
    IF TG_TABLE_NAME='payroll_payslip_lines' THEN
      SELECT p.run_id INTO parent_id FROM payroll_payslips p WHERE p.id=(target->>'payslip_id')::integer;
    ELSE parent_id=(target->>'run_id')::integer; END IF;
    SELECT * INTO run_row FROM payroll_runs WHERE id=parent_id FOR SHARE;
    IF run_row.status IN ('APPROVED','POSTED') THEN
      RAISE EXCEPTION 'Approved payslip history is immutable' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND ((TG_TABLE_NAME='payroll_payslips' AND (to_jsonb(OLD)->>'run_id') IS DISTINCT FROM (target->>'run_id')) OR
      (TG_TABLE_NAME='payroll_payslip_lines' AND (to_jsonb(OLD)->>'payslip_id') IS DISTINCT FROM (target->>'payslip_id'))) THEN
      RAISE EXCEPTION 'Payslip parent cannot change' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME='payroll_payslips' AND (run_row.id IS NULL OR run_row.tenant_id<>(target->>'tenant_id')::integer OR run_row.facility_id<>(target->>'facility_id')::integer) THEN
      RAISE EXCEPTION 'Payslip run scope mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payroll_run_history_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_runs FOR EACH ROW EXECUTE FUNCTION jcare_payroll_history_guard();
CREATE TRIGGER payroll_slip_history_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_payslips FOR EACH ROW EXECUTE FUNCTION jcare_payroll_history_guard();
CREATE TRIGGER payroll_line_history_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_payslip_lines FOR EACH ROW EXECUTE FUNCTION jcare_payroll_history_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION jcare_payroll_posted_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_total bigint; journal journal_entries%ROWTYPE;
BEGIN
 IF NEW.status='POSTED' THEN
  SELECT * INTO journal FROM journal_entries WHERE id=NEW.journal_entry_id;
  expected_total=NEW.gross_cents+NEW.nssf_employer_cents+NEW.ahl_employer_cents;
  IF journal.id IS NULL OR journal.status<>'POSTED' OR journal.source_type<>'PAYROLL' OR journal.source_id<>NEW.id::text OR journal.facility_id<>NEW.facility_id OR journal.tenant_id<>NEW.tenant_id OR journal.total_debit_cents<>expected_total OR journal.total_credit_cents<>expected_total OR NEW.posted_by IS NULL OR NEW.posted_at IS NULL THEN
   RAISE EXCEPTION 'Finalized payroll requires its scoped balanced source journal' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payroll_posted_evidence_guard AFTER INSERT OR UPDATE ON payroll_runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION jcare_payroll_posted_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION jcare_payroll_rule_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_status text; version_key integer;
BEGIN
 IF TG_TABLE_NAME='payroll_statutory_versions' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Statutory version history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(OLD)-'status') IS DISTINCT FROM (to_jsonb(NEW)-'status') THEN
   RAISE EXCEPTION 'Replace a statutory version rather than changing its calculation history' USING ERRCODE='23514';
  END IF;
 ELSE
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Statutory bands are immutable; create a replacement version' USING ERRCODE='23514'; END IF;
  SELECT status INTO version_status FROM payroll_statutory_versions WHERE id=NEW.version_id FOR SHARE;
  IF version_status<>'DRAFT' THEN RAISE EXCEPTION 'Bands can only be added to a draft version' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payroll_rule_history_guard BEFORE UPDATE OR DELETE ON payroll_statutory_versions FOR EACH ROW EXECUTE FUNCTION jcare_payroll_rule_history_guard();
CREATE TRIGGER payroll_band_history_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_statutory_bands FOR EACH ROW EXECUTE FUNCTION jcare_payroll_rule_history_guard();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION jcare_payroll_period_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM payroll_runs WHERE period_id=OLD.id AND status IN ('APPROVED','POSTED')) THEN
  RAISE EXCEPTION 'Approved payroll period history is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payroll_period_history_guard BEFORE UPDATE OR DELETE ON payroll_periods FOR EACH ROW EXECUTE FUNCTION jcare_payroll_period_history_guard();
