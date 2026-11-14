-- 0075_fixed_assets: a working fixed-asset register.
--
-- The original 0027 tables created `fixed_assets` and `fixed_asset_movements`
-- with accounts and disposal columns but no way to reach them from the
-- application. This migration adds the operational data a facility needs to
-- run a register: category defaults, location/custodian, maintenance and
-- transfer history, and the acquisition/disposal journal accounts.
--
-- Nothing here rewrites existing rows. Legacy assets keep their current
-- category text, accounts and net book value.

CREATE TABLE IF NOT EXISTS "fixed_asset_categories" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "code" text NOT NULL,
  "name" text NOT NULL,
  "default_useful_life_months" integer NOT NULL CHECK ("default_useful_life_months" BETWEEN 1 AND 600),
  "asset_account_id" integer NOT NULL REFERENCES "chart_of_accounts"("id"),
  "accum_dep_account_id" integer NOT NULL REFERENCES "chart_of_accounts"("id"),
  "dep_expense_account_id" integer NOT NULL REFERENCES "chart_of_accounts"("id"),
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "fixed_asset_categories_facility_code_idx"
  ON "fixed_asset_categories" ("facility_id", "code");

ALTER TABLE "fixed_assets"
  ADD COLUMN IF NOT EXISTS "category_id" integer REFERENCES "fixed_asset_categories"("id"),
  ADD COLUMN IF NOT EXISTS "location" text,
  ADD COLUMN IF NOT EXISTS "custodian_employee_id" integer REFERENCES "hr_employees"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "condition" text NOT NULL DEFAULT 'GOOD',
  ADD COLUMN IF NOT EXISTS "acquisition_credit_account_id" integer REFERENCES "chart_of_accounts"("id"),
  ADD COLUMN IF NOT EXISTS "disposal_proceeds_account_id" integer REFERENCES "chart_of_accounts"("id"),
  ADD COLUMN IF NOT EXISTS "disposal_gain_loss_account_id" integer REFERENCES "chart_of_accounts"("id"),
  ADD COLUMN IF NOT EXISTS "supplier_invoice_id" integer REFERENCES "supplier_invoices"("id"),
  ADD COLUMN IF NOT EXISTS "purchase_order_id" integer REFERENCES "purchase_orders"("id"),
  ADD COLUMN IF NOT EXISTS "created_by_user_id" integer REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "notes" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_condition_chk'
  ) THEN
    ALTER TABLE "fixed_assets"
      ADD CONSTRAINT "fixed_assets_condition_chk"
      CHECK ("condition" IN ('GOOD', 'FAIR', 'POOR', 'UNDER_REPAIR'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_status_chk'
  ) THEN
    ALTER TABLE "fixed_assets"
      ADD CONSTRAINT "fixed_assets_status_chk"
      CHECK ("status" IN ('ACTIVE', 'DISPOSED'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "fixed_assets_facility_status_idx"
  ON "fixed_assets" ("facility_id", "status");
CREATE INDEX IF NOT EXISTS "fixed_assets_facility_category_idx"
  ON "fixed_assets" ("facility_id", "category");

CREATE TABLE IF NOT EXISTS "fixed_asset_maintenance" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "asset_id" integer NOT NULL REFERENCES "fixed_assets"("id"),
  "maintenance_date" text NOT NULL,
  "maintenance_type" text NOT NULL CHECK ("maintenance_type" IN ('PREVENTIVE', 'CORRECTIVE', 'INSPECTION')),
  "vendor" text,
  "description" text NOT NULL,
  "cost_kes" numeric(14, 2) NOT NULL DEFAULT '0.00',
  "status" text NOT NULL DEFAULT 'PLANNED' CHECK ("status" IN ('PLANNED', 'COMPLETED', 'CANCELLED')),
  "completed_date" text,
  "expense_account_id" integer REFERENCES "chart_of_accounts"("id"),
  "journal_entry_id" integer REFERENCES "journal_entries"("id"),
  "recorded_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "fixed_asset_maintenance_facility_idx"
  ON "fixed_asset_maintenance" ("facility_id", "status", "maintenance_date");
CREATE INDEX IF NOT EXISTS "fixed_asset_maintenance_asset_idx"
  ON "fixed_asset_maintenance" ("asset_id", "maintenance_date");

CREATE TABLE IF NOT EXISTS "fixed_asset_transfers" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "asset_id" integer NOT NULL REFERENCES "fixed_assets"("id"),
  "transfer_date" text NOT NULL,
  "from_department_id" integer REFERENCES "departments"("id"),
  "to_department_id" integer REFERENCES "departments"("id"),
  "from_employee_id" integer REFERENCES "hr_employees"("id") ON DELETE SET NULL,
  "to_employee_id" integer REFERENCES "hr_employees"("id") ON DELETE SET NULL,
  "from_location" text,
  "to_location" text,
  "reason" text NOT NULL,
  "recorded_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "fixed_asset_transfers_asset_idx"
  ON "fixed_asset_transfers" ("asset_id", "transfer_date");
CREATE INDEX IF NOT EXISTS "fixed_asset_transfers_facility_idx"
  ON "fixed_asset_transfers" ("facility_id", "transfer_date");
