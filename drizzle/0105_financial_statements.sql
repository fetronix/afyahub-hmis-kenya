-- 0105_financial_statements
--
-- Periodic financial statements: facility financial-year policy, the
-- presentation classification of each account, the immutable archive of
-- generated statements, and the export ledger.
--
-- Nothing here touches the ledger. Statements are derived from
-- `journal_entries` and `journal_lines`; this migration only adds the
-- configuration those derivations need and the archive that keeps an approved
-- statement exactly as it was signed.

/* ------------------------------------------------------------------
   1. Financial-year and closing policy, per facility.

   The financial year does not have to start in January, and the equity
   account that absorbs a year-end close is a facility decision. Both are
   configured, never assumed: `retained_earnings_account_id` is nullable and
   a year-end close refuses to run without it.
   ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS financial_statement_settings (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  financial_year_start_month integer NOT NULL DEFAULT 7,
  retained_earnings_account_id integer REFERENCES chart_of_accounts(id),
  prepared_by_name text,
  updated_by_user_id integer REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_statement_settings_month_check
    CHECK (financial_year_start_month BETWEEN 1 AND 12)
);

CREATE UNIQUE INDEX IF NOT EXISTS financial_statement_settings_facility_idx
  ON financial_statement_settings (facility_id);

/* ------------------------------------------------------------------
   2. Where each account is presented.

   Account `sub_type` is free text written by whoever created the account.
   Guessing from it alone would let an unfamiliar subtype land in the wrong
   line of a balance sheet, so every account resolves to a presentation group
   through a documented default and may be overridden here. An account whose
   subtype cannot be resolved is shown as UNCLASSIFIED and blocks approval
   rather than being silently grouped.
   ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS financial_statement_account_groups (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  account_id integer NOT NULL REFERENCES chart_of_accounts(id),
  presentation_group text NOT NULL,
  updated_by_user_id integer REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS financial_statement_account_groups_facility_account_idx
  ON financial_statement_account_groups (facility_id, account_id);

/* ------------------------------------------------------------------
   3. The statement archive.

   A statement is stored whole: the computed payload, the validation checks
   and the ledger watermark it was built from. Approval freezes all of it.
   A later correction is a new `version` that points at the statement it
   supersedes, so history is append-only and the previous figures remain
   retrievable.
   ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS financial_statement_runs (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  frequency text NOT NULL,
  financial_year text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  comparative_start date,
  comparative_end date,
  comparative_mode text NOT NULL DEFAULT 'PRIOR_PERIOD',
  accounting_basis text NOT NULL DEFAULT 'ACCRUAL',
  version integer NOT NULL DEFAULT 1,
  supersedes_id integer REFERENCES financial_statement_runs(id),
  status text NOT NULL DEFAULT 'DRAFT',
  generated_by integer REFERENCES users(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by integer REFERENCES users(id),
  reviewed_at timestamptz,
  approved_by integer REFERENCES users(id),
  approved_at timestamptz,
  source_period_ids integer[] NOT NULL DEFAULT '{}',
  -- The ledger watermark is a fingerprint of journal_entries.posted_at, which
  -- is a timestamp without time zone. Storing it as text keeps the comparison
  -- exact: an equality re-check must not depend on the session time zone or on
  -- how a timestamptz happens to round-trip.
  ledger_through text,
  journal_count integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_statement_runs_status_check
    CHECK (status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'SUPERSEDED')),
  CONSTRAINT financial_statement_runs_frequency_check
    CHECK (frequency IN ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM')),
  CONSTRAINT financial_statement_runs_basis_check
    CHECK (accounting_basis IN ('ACCRUAL')),
  CONSTRAINT financial_statement_runs_range_check
    CHECK (period_end >= period_start),
  CONSTRAINT financial_statement_runs_version_check CHECK (version >= 1),
  -- A reviewer and an approver are events with a person and a time.
  CONSTRAINT financial_statement_runs_review_check
    CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CONSTRAINT financial_statement_runs_approval_check
    CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CONSTRAINT financial_statement_runs_approval_requires_status_check
    CHECK (approved_by IS NULL OR status IN ('APPROVED', 'SUPERSEDED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS financial_statement_runs_version_idx
  ON financial_statement_runs (facility_id, frequency, financial_year, period_start, period_end, version);

-- One approved statement per facility and period. A reviewed revision may sit
-- beside the approved version it supersedes: it is still provisional, and the
-- approved figures stay authoritative until the revision is approved in turn.
CREATE UNIQUE INDEX IF NOT EXISTS financial_statement_runs_current_idx
  ON financial_statement_runs (facility_id, period_start, period_end)
  WHERE status = 'APPROVED';

CREATE INDEX IF NOT EXISTS financial_statement_runs_archive_idx
  ON financial_statement_runs (facility_id, financial_year, period_end DESC);

/* ------------------------------------------------------------------
   4. Export history.

   Every download is recorded against the statement it came from. An export
   row is evidence, so it is append-only.
   ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS financial_statement_exports (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  run_id integer NOT NULL REFERENCES financial_statement_runs(id),
  format text NOT NULL,
  statement text NOT NULL DEFAULT 'ALL',
  filename text NOT NULL,
  byte_size integer NOT NULL,
  content_hash text NOT NULL,
  exported_by integer REFERENCES users(id),
  exported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_statement_exports_format_check
    CHECK (format IN ('PDF', 'XLSX', 'CSV'))
);

CREATE INDEX IF NOT EXISTS financial_statement_exports_run_idx
  ON financial_statement_exports (run_id, exported_at DESC);

/* ------------------------------------------------------------------
   5. Approved statements are frozen.

   The only permitted change to an approved row is its status moving to
   SUPERSEDED when a later version is approved. Everything that a reader
   relies on — the period, the figures, the checks and the hash — is
   immutable from the moment of approval, and no approved row may be
   removed.
   ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION jcare_financial_statement_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('APPROVED', 'SUPERSEDED') THEN
      RAISE EXCEPTION 'An approved financial statement cannot be removed' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('APPROVED', 'SUPERSEDED') THEN
    IF NEW.status <> OLD.status
       AND NOT (OLD.status = 'APPROVED' AND NEW.status = 'SUPERSEDED') THEN
      RAISE EXCEPTION 'An approved financial statement may only become superseded' USING ERRCODE='23514';
    END IF;
    IF (to_jsonb(OLD) - ARRAY['status']) IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status']) THEN
      RAISE EXCEPTION 'An approved financial statement is immutable; create a new version' USING ERRCODE='23514';
    END IF;
  END IF;
  IF OLD.status IN ('REVIEWED', 'APPROVED') AND NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION 'A reviewed statement cannot return to draft; create a new version' USING ERRCODE='23514';
  END IF;
  IF NEW.status = 'SUPERSEDED' AND NEW.supersedes_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM financial_statement_runs r
    WHERE r.supersedes_id = OLD.id AND r.id <> OLD.id
  ) THEN
    RAISE EXCEPTION 'A statement can only be superseded by a later version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER financial_statement_runs_immutable
  BEFORE UPDATE OR DELETE ON financial_statement_runs
  FOR EACH ROW EXECUTE FUNCTION jcare_financial_statement_immutable();

CREATE OR REPLACE FUNCTION jcare_financial_statement_export_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Financial statement export history is append-only' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER financial_statement_exports_append_only
  BEFORE UPDATE OR DELETE ON financial_statement_exports
  FOR EACH ROW EXECUTE FUNCTION jcare_financial_statement_export_guard();
