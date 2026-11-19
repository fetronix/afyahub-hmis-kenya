-- 0104_payroll_statutory_rulebook
--
-- Payroll statutory configuration — provenance, tiered contributions, employee
-- tax declarations, and reversal of posted runs.
--
-- Nothing here changes an existing figure. Every column is additive and
-- nullable or defaulted, so a facility that already recorded statutory
-- versions keeps them exactly as they were; the new fields are how a version
-- installed from the published rule catalogue describes its source, and how a
-- payslip explains a tiered NSSF charge or an employee relief.

/* ------------------------------------------------------------------
   1. Rule versions — the missing provenance fields.

   The original table recorded an authority and a free-text source
   reference. A rule that a facility relies on needs more than that: the
   instrument, where it was published, when, its own effective range and what
   calculation it describes. Who approved a version, and when, is kept in the
   audit log: a rule row itself may only move between statuses.
   ------------------------------------------------------------------ */

ALTER TABLE payroll_statutory_versions
  ADD COLUMN IF NOT EXISTS rule_name text,
  ADD COLUMN IF NOT EXISTS calculation_method text,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS source_title text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_published_on date;

-- A currency code is three letters; anything else is a typo, not a policy.
ALTER TABLE payroll_statutory_versions
  DROP CONSTRAINT IF EXISTS payroll_statutory_versions_currency_check;
ALTER TABLE payroll_statutory_versions
  ADD CONSTRAINT payroll_statutory_versions_currency_check
  CHECK (char_length(currency) = 3);

-- A URL, when present, must look like one; an empty string is not a source.
ALTER TABLE payroll_statutory_versions
  DROP CONSTRAINT IF EXISTS payroll_statutory_versions_source_url_check;
ALTER TABLE payroll_statutory_versions
  ADD CONSTRAINT payroll_statutory_versions_source_url_check
  CHECK (source_url IS NULL OR source_url ~ '^https?://');

/* ------------------------------------------------------------------
   2. Employees — tax residency and declared relief evidence.

   Personal relief is granted to residents, so the engine needs to know
   which side of that line an employee is on. Insurance relief depends on
   premiums the employee declares, and a declaration without a document
   reference is not evidence.
   ------------------------------------------------------------------ */

ALTER TABLE hr_employees
  ADD COLUMN IF NOT EXISTS tax_residency text NOT NULL DEFAULT 'RESIDENT',
  ADD COLUMN IF NOT EXISTS insurance_premium_monthly_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS insurance_relief_evidence_reference text;

ALTER TABLE hr_employees
  DROP CONSTRAINT IF EXISTS hr_employees_tax_residency_check;
ALTER TABLE hr_employees
  ADD CONSTRAINT hr_employees_tax_residency_check
  CHECK (tax_residency IN ('RESIDENT','NON_RESIDENT'));

ALTER TABLE hr_employees
  DROP CONSTRAINT IF EXISTS hr_employees_insurance_premium_check;
ALTER TABLE hr_employees
  ADD CONSTRAINT hr_employees_insurance_premium_check
  CHECK (insurance_premium_monthly_cents >= 0);

-- A declared premium with no evidence reference would silently earn relief.
ALTER TABLE hr_employees
  DROP CONSTRAINT IF EXISTS hr_employees_insurance_evidence_check;
ALTER TABLE hr_employees
  ADD CONSTRAINT hr_employees_insurance_evidence_check
  CHECK (
    insurance_premium_monthly_cents = 0
    OR (insurance_relief_evidence_reference IS NOT NULL
        AND length(trim(insurance_relief_evidence_reference)) >= 4)
  );

/* ------------------------------------------------------------------
   3. Pay components — qualifying pension contributions.

   A deduction either reduces taxable employment income or it does not.
   The engine must not infer that from a component's name.
   ------------------------------------------------------------------ */

ALTER TABLE payroll_employee_components
  ADD COLUMN IF NOT EXISTS tax_deductible boolean NOT NULL DEFAULT false;

/* ------------------------------------------------------------------
   4. Payroll runs — reversal instead of deletion.

   A posted run is an accounting fact. Correcting one means posting a
   contra journal and marking the run reversed, keeping the original
   journal and payslips in place for audit.
   ------------------------------------------------------------------ */

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS reversed_by integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reversed_at timestamp,
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id integer REFERENCES journal_entries(id),
  ADD COLUMN IF NOT EXISTS reversal_reason text;

ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_status_check;
ALTER TABLE payroll_runs
  ADD CONSTRAINT payroll_runs_status_check
  CHECK (status IN ('DRAFT','CALCULATED','APPROVED','POSTED','REVERSED'));

-- Approval is still required for a run that was posted before it was reversed.
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_approval_check;
ALTER TABLE payroll_runs
  ADD CONSTRAINT payroll_runs_approval_check
  CHECK (
    (status IN ('APPROVED','POSTED','REVERSED'))
    = (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  );

ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_reversal_check;
ALTER TABLE payroll_runs
  ADD CONSTRAINT payroll_runs_reversal_check
  CHECK (
    (status = 'REVERSED')
    = (reversed_by IS NOT NULL AND reversed_at IS NOT NULL
       AND reversal_journal_entry_id IS NOT NULL)
  );

/* ------------------------------------------------------------------
   5. One active version per statute per day is already enforced by the
   application. This index makes the common lookup (active versions for a
   date) cheap without changing the semantics.
   ------------------------------------------------------------------ */

CREATE INDEX IF NOT EXISTS payroll_statutory_versions_active_idx
  ON payroll_statutory_versions (facility_id, statute, effective_from, effective_to)
  WHERE status = 'ACTIVE';

/* ------------------------------------------------------------------
   6. Allow one correction path for a posted run — and only one.

   The 0093 guard made a posted run completely immutable, which is right
   for the figures but left no lawful way to correct a run. The reversal
   columns are useless unless the guard admits exactly one transition:
   POSTED → REVERSED, with the four reversal columns and nothing else
   changing. Payslips and lines of a reversed run stay immutable, because
   the statutory extracts are read from them long after the correction.
   ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION jcare_payroll_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  run_row payroll_runs%ROWTYPE;
  parent_id integer;
  target jsonb;
  finalize_columns text[] := ARRAY['status','posted_by','posted_at','journal_entry_id'];
  reversal_columns text[] := ARRAY['status','reversed_by','reversed_at','reversal_journal_entry_id','reversal_reason'];
BEGIN
  IF TG_TABLE_NAME='payroll_runs' THEN
    IF TG_OP<>'INSERT' AND OLD.status='REVERSED' THEN
      RAISE EXCEPTION 'Reversed payroll history is immutable' USING ERRCODE='23514';
    END IF;
    IF TG_OP<>'INSERT' AND OLD.status IN ('APPROVED','POSTED') THEN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Approved payroll history is immutable' USING ERRCODE='23514'; END IF;
      IF OLD.status='POSTED' THEN
        IF NEW.status<>'REVERSED'
          OR (to_jsonb(OLD)-reversal_columns) IS DISTINCT FROM (to_jsonb(NEW)-reversal_columns)
          OR NEW.reversed_by IS NULL
          OR NEW.reversed_at IS NULL
          OR NEW.reversal_journal_entry_id IS NULL THEN
          RAISE EXCEPTION 'Posted payroll may only be corrected by a recorded reversal' USING ERRCODE='23514';
        END IF;
      ELSIF NEW.status<>'POSTED'
        OR (to_jsonb(OLD)-finalize_columns) IS DISTINCT FROM (to_jsonb(NEW)-finalize_columns) THEN
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
    IF run_row.status IN ('APPROVED','POSTED','REVERSED') THEN
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

/* ------------------------------------------------------------------
   7. One live run per period, and reversed runs kept beside it.

   The original unique index allowed exactly one run per period forever,
   which made the reversal columns pointless: the corrected payroll could
   never be calculated. A reversed run is now history and no longer holds
   the period's single live slot; two live runs for one period remain
   impossible.
   ------------------------------------------------------------------ */

DROP INDEX IF EXISTS payroll_runs_period_idx;
CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_period_live_idx
  ON payroll_runs (period_id) WHERE status <> 'REVERSED';
