-- JaliCare HMIS
-- Fixed-asset register, depreciation workflow, maintenance and inspections
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Completes the asset register: description, manufacturer, model, barcode,
--    placed-into-service date, acquisition method, supplier and purchase
--    reference, currency, funding source, an explicit depreciation rate and
--    commencement convention, and the retirement columns the lifecycle needs.
-- 2. Adds the facility-level depreciation policy (fixed_asset_settings) so the
--    commencement convention, approval requirement and financial-year start are
--    configured rather than assumed.
-- 3. Adds the depreciation batch: a reviewed, approved and posted schedule with
--    a snapshot of every charge, so the ledger receives exactly what an
--    approver saw.
-- 4. Adds preventive maintenance schedules, inspection records, asset
--    documents and the lifecycle event log.
--
-- WHAT IT DOES NOT DO
-- -------------------
-- No data is deleted or rewritten. Existing assets keep their accumulated
-- depreciation and net book value; every new column is nullable or has a
-- default that preserves current behaviour. No journal is posted here.
--
-- Depreciation conventions are text values, not an enum type: a facility that
-- later adds a convention should not require a type rewrite, and the service
-- validates the value it accepts.

/* ------------------------------------------------------------------ *
 * 1. Register completion
 * ------------------------------------------------------------------ */

ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS description text;
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS manufacturer text;
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS model text;
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS barcode text;
--> statement-breakpoint
-- The date the asset entered service, which is what depreciation follows. When
-- it is empty the acquisition date is used, and the service says so.
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS placed_in_service_date text;
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS acquisition_method text NOT NULL DEFAULT 'PURCHASE';
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS supplier_id integer REFERENCES suppliers(id);
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS purchase_reference text;
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS goods_received_note_id integer REFERENCES goods_received_notes(id);
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KES';
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS funding_source text;
--> statement-breakpoint
-- Basis points keep the rate an integer: 1000 bps is the 10% annual default.
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS annual_rate_bps integer;
--> statement-breakpoint
-- NULL means "follow the facility policy", which is what an asset registered
-- before this migration should do.
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS depreciation_commencement text;
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS depreciation_start_date text;
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS retired_at timestamptz;
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS retirement_reason text;
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS approved_by_user_id integer REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS approved_at timestamptz;
--> statement-breakpoint
-- A barcode is optional, but two assets in one facility may not share one.
CREATE UNIQUE INDEX IF NOT EXISTS fixed_assets_facility_barcode_idx
  ON fixed_assets(facility_id, barcode) WHERE barcode IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS fixed_assets_facility_department_idx
  ON fixed_assets(facility_id, department_id, status);
--> statement-breakpoint
ALTER TABLE fixed_assets ADD CONSTRAINT fixed_assets_currency_check
  CHECK (char_length(currency) = 3) NOT VALID;
--> statement-breakpoint
ALTER TABLE fixed_assets ADD CONSTRAINT fixed_assets_rate_check
  CHECK (annual_rate_bps IS NULL OR (annual_rate_bps >= 0 AND annual_rate_bps <= 10000)) NOT VALID;
--> statement-breakpoint
ALTER TABLE fixed_assets ADD CONSTRAINT fixed_assets_commencement_check
  CHECK (
    depreciation_commencement IS NULL
    OR depreciation_commencement IN ('FULL_MONTH', 'FOLLOWING_MONTH', 'DAILY_PRORATA')
  ) NOT VALID;
--> statement-breakpoint
/* The 0075 constraint allowed only ACTIVE/DISPOSED. Maintenance and lifecycle
   states are real, so the narrow constraint is replaced rather than left in
   place to reject a legitimate transition. */
ALTER TABLE fixed_assets DROP CONSTRAINT IF EXISTS fixed_assets_status_chk;
--> statement-breakpoint
ALTER TABLE fixed_assets ADD CONSTRAINT fixed_assets_status_check
  CHECK (
    status IN (
      'REGISTERED', 'ACTIVE', 'UNDER_MAINTENANCE', 'TEMPORARILY_UNAVAILABLE',
      'IMPAIRED', 'RETIRED', 'DISPOSED'
    )
  ) NOT VALID;
--> statement-breakpoint

/* ------------------------------------------------------------------ *
 * 2. Facility depreciation policy
 * ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS fixed_asset_settings (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  default_useful_life_months integer NOT NULL DEFAULT 120,
  default_annual_rate_bps integer NOT NULL DEFAULT 1000,
  -- No default beyond the column value: the service records which convention
  -- was in force when a schedule was produced, and refuses to guess.
  depreciation_commencement text NOT NULL DEFAULT 'FULL_MONTH',
  depreciation_approval_required boolean NOT NULL DEFAULT true,
  financial_year_start_month integer NOT NULL DEFAULT 7,
  created_by_user_id integer REFERENCES users(id),
  updated_by_user_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_settings_facility_unique UNIQUE (facility_id),
  CONSTRAINT fixed_asset_settings_life_check CHECK (default_useful_life_months BETWEEN 1 AND 600),
  CONSTRAINT fixed_asset_settings_rate_check CHECK (default_annual_rate_bps BETWEEN 0 AND 10000),
  CONSTRAINT fixed_asset_settings_month_check CHECK (financial_year_start_month BETWEEN 1 AND 12),
  CONSTRAINT fixed_asset_settings_commencement_check CHECK (
    depreciation_commencement IN ('FULL_MONTH', 'FOLLOWING_MONTH', 'DAILY_PRORATA')
  )
);
--> statement-breakpoint

/* ------------------------------------------------------------------ *
 * 3. Depreciation batches
 * ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS fixed_asset_depreciation_batches (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  period_code text NOT NULL,
  entry_date text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  total_cents bigint NOT NULL DEFAULT 0,
  asset_count integer NOT NULL DEFAULT 0,
  prepared_by_user_id integer REFERENCES users(id),
  approved_by_user_id integer REFERENCES users(id),
  approved_at timestamptz,
  posted_at timestamptz,
  journal_entry_id integer REFERENCES journal_entries(id),
  reversed_at timestamptz,
  reversed_by_user_id integer REFERENCES users(id),
  reversal_journal_entry_id integer REFERENCES journal_entries(id),
  reversal_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_batches_period_check CHECK (period_code ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT fixed_asset_batches_entry_date_check CHECK (entry_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  CONSTRAINT fixed_asset_batches_status_check CHECK (
    status IN ('DRAFT', 'APPROVED', 'POSTED', 'REVERSED')
  )
);
--> statement-breakpoint
-- One live batch per facility and period. A reversed batch steps aside so the
-- period can be corrected and re-run, while the reversed row remains as history.
CREATE UNIQUE INDEX IF NOT EXISTS fixed_asset_batches_live_period_idx
  ON fixed_asset_depreciation_batches(facility_id, period_code)
  WHERE status <> 'REVERSED';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS fixed_asset_batches_facility_idx
  ON fixed_asset_depreciation_batches(facility_id, period_code DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS fixed_asset_depreciation_batch_items (
  id serial PRIMARY KEY,
  batch_id integer NOT NULL REFERENCES fixed_asset_depreciation_batches(id) ON DELETE CASCADE,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  asset_id integer NOT NULL REFERENCES fixed_assets(id),
  asset_code text NOT NULL,
  asset_name text NOT NULL,
  category text NOT NULL,
  department_id integer,
  -- The calculation basis is frozen with the charge: an approver signs the
  -- numbers they saw, not a rule that might change before posting.
  basis_cents bigint NOT NULL,
  salvage_cents bigint NOT NULL,
  useful_life_months integer NOT NULL,
  annual_rate_bps integer NOT NULL,
  commencement text NOT NULL,
  opening_accumulated_cents bigint NOT NULL,
  charge_cents bigint NOT NULL,
  closing_accumulated_cents bigint NOT NULL,
  opening_nbv_cents bigint NOT NULL,
  closing_nbv_cents bigint NOT NULL,
  days_in_service integer NOT NULL DEFAULT 0,
  period_days integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_batch_items_unique UNIQUE (batch_id, asset_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS fixed_asset_batch_items_asset_idx
  ON fixed_asset_depreciation_batch_items(asset_id, batch_id);
--> statement-breakpoint

/* ------------------------------------------------------------------ *
 * 4. Preventive maintenance schedules
 * ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS fixed_asset_maintenance_schedules (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  asset_id integer NOT NULL REFERENCES fixed_assets(id),
  name text NOT NULL,
  frequency text NOT NULL,
  interval_days integer,
  next_due_date text NOT NULL,
  last_completed_date text,
  instructions text,
  responsible_department_id integer REFERENCES departments(id),
  assigned_technician text,
  vendor text,
  estimated_cost_cents bigint NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_schedules_frequency_check CHECK (
    frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'CUSTOM')
  ),
  CONSTRAINT fixed_asset_schedules_interval_check CHECK (
    (frequency = 'CUSTOM' AND interval_days IS NOT NULL AND interval_days BETWEEN 1 AND 3650)
    OR (frequency <> 'CUSTOM' AND (interval_days IS NULL OR interval_days BETWEEN 1 AND 3650))
  ),
  CONSTRAINT fixed_asset_schedules_due_check CHECK (next_due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS fixed_asset_schedules_due_idx
  ON fixed_asset_maintenance_schedules(facility_id, is_active, next_due_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS fixed_asset_schedules_asset_idx
  ON fixed_asset_maintenance_schedules(asset_id, next_due_date);
--> statement-breakpoint

/* ------------------------------------------------------------------ *
 * 4b. Movement uniqueness
 *
 * 0027 made (asset, type, period) unique, which is right for capitalisation,
 * depreciation and disposal: each happens once per asset per period. It is
 * wrong for maintenance, impairment and revaluation, where two repairs or two
 * write-downs in one month are ordinary events. The constraint is narrowed to
 * the once-per-period types instead of deleted.
 * ------------------------------------------------------------------ */

DROP INDEX IF EXISTS fixed_asset_movements_dep_period_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS fixed_asset_movements_once_per_period_idx
  ON fixed_asset_movements (asset_id, movement_type, period_code)
  WHERE movement_type IN ('CAPITALISATION', 'DEPRECIATION', 'DISPOSAL');
--> statement-breakpoint

/* ------------------------------------------------------------------ *
 * 5. Maintenance job completion fields
 * ------------------------------------------------------------------ */

ALTER TABLE fixed_asset_maintenance ADD COLUMN IF NOT EXISTS schedule_id integer
  REFERENCES fixed_asset_maintenance_schedules(id);
--> statement-breakpoint
ALTER TABLE fixed_asset_maintenance ADD COLUMN IF NOT EXISTS priority text;
--> statement-breakpoint
ALTER TABLE fixed_asset_maintenance ADD COLUMN IF NOT EXISTS reported_date text;
--> statement-breakpoint
ALTER TABLE fixed_asset_maintenance ADD COLUMN IF NOT EXISTS problem_description text;
--> statement-breakpoint
ALTER TABLE fixed_asset_maintenance ADD COLUMN IF NOT EXISTS assigned_technician text;
--> statement-breakpoint
ALTER TABLE fixed_asset_maintenance ADD COLUMN IF NOT EXISTS repair_actions text;
--> statement-breakpoint
ALTER TABLE fixed_asset_maintenance ADD COLUMN IF NOT EXISTS parts_used text;
--> statement-breakpoint
ALTER TABLE fixed_asset_maintenance ADD COLUMN IF NOT EXISTS downtime_hours numeric(8, 2);
--> statement-breakpoint
ALTER TABLE fixed_asset_maintenance ADD COLUMN IF NOT EXISTS verified_at timestamptz;
--> statement-breakpoint
ALTER TABLE fixed_asset_maintenance ADD COLUMN IF NOT EXISTS verified_by_user_id integer REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE fixed_asset_maintenance ADD COLUMN IF NOT EXISTS verification_notes text;
--> statement-breakpoint
ALTER TABLE fixed_asset_maintenance ADD CONSTRAINT fixed_asset_maintenance_priority_check
  CHECK (priority IS NULL OR priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')) NOT VALID;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS fixed_asset_maintenance_due_idx
  ON fixed_asset_maintenance(facility_id, status, maintenance_date);
--> statement-breakpoint

/* ------------------------------------------------------------------ *
 * 6. Inspections
 * ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS fixed_asset_inspections (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  asset_id integer NOT NULL REFERENCES fixed_assets(id),
  schedule_id integer REFERENCES fixed_asset_maintenance_schedules(id),
  inspection_date text NOT NULL,
  inspector_name text,
  inspector_employee_id integer REFERENCES hr_employees(id),
  condition_assessment text,
  findings text,
  recommendations text,
  follow_up_actions text,
  next_inspection_date text,
  checklist jsonb,
  attachment_reference text,
  status text NOT NULL DEFAULT 'PLANNED',
  completed_at timestamptz,
  recorded_by_user_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_inspections_status_check CHECK (status IN ('PLANNED', 'COMPLETED')),
  CONSTRAINT fixed_asset_inspections_date_check CHECK (inspection_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS fixed_asset_inspections_facility_idx
  ON fixed_asset_inspections(facility_id, status, inspection_date DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS fixed_asset_inspections_asset_idx
  ON fixed_asset_inspections(asset_id, inspection_date DESC);
--> statement-breakpoint

/* ------------------------------------------------------------------ *
 * 7. Lifecycle events
 * ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS fixed_asset_lifecycle_events (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  asset_id integer NOT NULL REFERENCES fixed_assets(id),
  event_type text NOT NULL,
  effective_date text NOT NULL,
  from_status text,
  to_status text,
  reason text NOT NULL,
  details text,
  journal_entry_id integer REFERENCES journal_entries(id),
  approved_by_user_id integer REFERENCES users(id),
  recorded_by_user_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_lifecycle_event_check CHECK (
    event_type IN (
      'REGISTERED', 'REGISTRATION', 'ACTIVATED', 'ACTIVATION', 'STATUS_CHANGE',
      'TRANSFER', 'CUSTODIAN_CHANGE', 'LOCATION_CHANGE', 'MAINTENANCE_START',
      'MAINTENANCE_COMPLETE', 'INSPECTION', 'IMPAIRMENT', 'REVALUATION',
      'RETIREMENT', 'DISPOSAL', 'WRITE_OFF', 'DEPRECIATION_REVERSAL'
    )
  ),
  CONSTRAINT fixed_asset_lifecycle_date_check CHECK (effective_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS fixed_asset_lifecycle_asset_idx
  ON fixed_asset_lifecycle_events(asset_id, effective_date DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS fixed_asset_lifecycle_facility_idx
  ON fixed_asset_lifecycle_events(facility_id, event_type, effective_date DESC);
--> statement-breakpoint

/* ------------------------------------------------------------------ *
 * 8. Supporting documents
 * ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS fixed_asset_documents (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  asset_id integer NOT NULL REFERENCES fixed_assets(id),
  maintenance_id integer REFERENCES fixed_asset_maintenance(id),
  inspection_id integer REFERENCES fixed_asset_inspections(id),
  title text NOT NULL,
  document_type text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  content bytea NOT NULL,
  uploaded_by_user_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS fixed_asset_documents_asset_idx
  ON fixed_asset_documents(asset_id, created_at DESC);
--> statement-breakpoint
