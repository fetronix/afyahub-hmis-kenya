ALTER TABLE "facilities"
  ADD COLUMN IF NOT EXISTS "hidden_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "clinical_protocols" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "diagnoses"
  ALTER COLUMN "icd10_code" DROP NOT NULL,
  ALTER COLUMN "icd10_description" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "diagnoses"
  ADD COLUMN IF NOT EXISTS "coding_system" text DEFAULT 'ICD-10' NOT NULL,
  ADD COLUMN IF NOT EXISTS "diagnosis_code" text,
  ADD COLUMN IF NOT EXISTS "diagnosis_display" text,
  ADD COLUMN IF NOT EXISTS "icd11_code" text,
  ADD COLUMN IF NOT EXISTS "icd11_title" text,
  ADD COLUMN IF NOT EXISTS "icd11_release" text,
  ADD COLUMN IF NOT EXISTS "icd11_foundation_uri" text,
  ADD COLUMN IF NOT EXISTS "icd11_linearization_uri" text,
  ADD COLUMN IF NOT EXISTS "coding_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "icd11_catalogue_entries" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "chapter_code" text,
  "chapter_title" text,
  "class_kind" text DEFAULT 'category' NOT NULL,
  "foundation_uri" text,
  "linearization_uri" text,
  "release_id" text DEFAULT '2025-01' NOT NULL,
  "source_name" text DEFAULT 'WHO ICD-11 MMS Official Release' NOT NULL,
  "source_url" text,
  "keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "is_notifiable" boolean DEFAULT false NOT NULL,
  "cached_from_who_api" boolean DEFAULT false NOT NULL,
  "fetched_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "icd11_catalogue_code_release_idx"
  ON "icd11_catalogue_entries" ("code", "release_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "icd10_to_icd11_mappings" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "icd10_code" text NOT NULL,
  "icd10_title" text NOT NULL,
  "icd11_code" text,
  "icd11_title" text,
  "icd11_chapter" text,
  "foundation_uri" text,
  "linearization_uri" text,
  "release_id" text DEFAULT '2025-01' NOT NULL,
  "mapping_type" text DEFAULT 'ONE_TO_ONE' NOT NULL,
  "review_status" text DEFAULT 'REQUIRES_CLINICAL_REVIEW' NOT NULL,
  "mapping_source" text NOT NULL,
  "alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  "reviewed_by_user_id" integer REFERENCES "users"("id"),
  "reviewed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "icd10_to_icd11_code_release_idx"
  ON "icd10_to_icd11_mappings" ("facility_id", "icd10_code", "release_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_periods" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "period_code" text NOT NULL,
  "name" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "closed_by_user_id" integer REFERENCES "users"("id"),
  "closed_at" timestamp,
  "close_notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "financial_periods_status_chk" CHECK ("status" IN ('OPEN', 'CLOSED', 'LOCKED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_periods_facility_code_idx"
  ON "financial_periods" ("facility_id", "period_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chart_of_accounts" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "account_code" text NOT NULL,
  "account_name" text NOT NULL,
  "account_type" text NOT NULL,
  "sub_type" text NOT NULL,
  "normal_balance" text NOT NULL,
  "department_code" text,
  "parent_account_id" integer,
  "is_system_account" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "coa_account_type_chk" CHECK ("account_type" IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  CONSTRAINT "coa_normal_balance_chk" CHECK ("normal_balance" IN ('DEBIT', 'CREDIT'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "coa_facility_account_code_idx"
  ON "chart_of_accounts" ("facility_id", "account_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_entries" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "period_id" integer REFERENCES "financial_periods"("id"),
  "journal_number" text NOT NULL,
  "entry_date" date NOT NULL,
  "source_type" text DEFAULT 'MANUAL' NOT NULL,
  "source_id" text,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "description" text NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "total_debit_cents" bigint NOT NULL,
  "total_credit_cents" bigint NOT NULL,
  "reversal_of_journal_id" integer,
  "reversed_by_journal_id" integer,
  "reversal_reason" text,
  "posted_by_user_id" integer REFERENCES "users"("id"),
  "posted_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "journal_entries_status_chk" CHECK ("status" IN ('DRAFT', 'POSTED', 'REVERSED')),
  CONSTRAINT "journal_entries_balanced_chk" CHECK ("status" = 'DRAFT' OR ("total_debit_cents" > 0 AND "total_debit_cents" = "total_credit_cents"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_facility_number_idx"
  ON "journal_entries" ("facility_id", "journal_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_facility_idempotency_idx"
  ON "journal_entries" ("facility_id", "idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_lines" (
  "id" serial PRIMARY KEY NOT NULL,
  "journal_entry_id" integer NOT NULL REFERENCES "journal_entries"("id"),
  "account_id" integer NOT NULL REFERENCES "chart_of_accounts"("id"),
  "department_id" integer REFERENCES "departments"("id"),
  "service_line" text,
  "description" text,
  "debit_cents" bigint DEFAULT 0 NOT NULL,
  "credit_cents" bigint DEFAULT 0 NOT NULL,
  "patient_id" integer REFERENCES "patients"("id"),
  "supplier_id" integer REFERENCES "suppliers"("id"),
  "invoice_id" integer REFERENCES "billing_invoices"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "journal_lines_non_negative_chk" CHECK ("debit_cents" >= 0 AND "credit_cents" >= 0),
  CONSTRAINT "journal_lines_one_sided_chk" CHECK (NOT ("debit_cents" > 0 AND "credit_cents" > 0) AND ("debit_cents" > 0 OR "credit_cents" > 0))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_lines_entry_idx" ON "journal_lines" ("journal_entry_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_lines_account_idx" ON "journal_lines" ("account_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "request_number" text NOT NULL,
  "department_id" integer REFERENCES "departments"("id"),
  "service_line" text,
  "expense_account_id" integer NOT NULL REFERENCES "chart_of_accounts"("id"),
  "payment_account_id" integer REFERENCES "chart_of_accounts"("id"),
  "payee_name" text NOT NULL,
  "category" text NOT NULL,
  "amount_kes" numeric(14, 2) NOT NULL,
  "currency" text DEFAULT 'KES' NOT NULL,
  "description" text NOT NULL,
  "supporting_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'SUBMITTED' NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id"),
  "reviewed_by_user_id" integer REFERENCES "users"("id"),
  "reviewed_at" timestamp,
  "review_notes" text,
  "posted_journal_id" integer REFERENCES "journal_entries"("id"),
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "incurred_date" date NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "expense_requests_status_chk" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expense_requests_facility_number_idx"
  ON "expense_requests" ("facility_id", "request_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expense_requests_facility_idemp_idx"
  ON "expense_requests" ("facility_id", "idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fixed_assets" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "asset_code" text NOT NULL,
  "asset_name" text NOT NULL,
  "category" text NOT NULL,
  "department_id" integer REFERENCES "departments"("id"),
  "service_line" text,
  "serial_number" text,
  "acquisition_date" text NOT NULL,
  "acquisition_cost_kes" numeric(14, 2) NOT NULL,
  "salvage_value_kes" numeric(14, 2) DEFAULT '0.00' NOT NULL,
  "useful_life_months" integer NOT NULL,
  "depreciation_method" text DEFAULT 'STRAIGHT_LINE' NOT NULL,
  "accumulated_depreciation_kes" numeric(14, 2) DEFAULT '0.00' NOT NULL,
  "net_book_value_kes" numeric(14, 2) NOT NULL,
  "asset_account_id" integer NOT NULL REFERENCES "chart_of_accounts"("id"),
  "accum_dep_account_id" integer NOT NULL REFERENCES "chart_of_accounts"("id"),
  "dep_expense_account_id" integer NOT NULL REFERENCES "chart_of_accounts"("id"),
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "disposed_at" timestamp,
  "disposal_proceeds_kes" numeric(14, 2),
  "disposal_journal_id" integer REFERENCES "journal_entries"("id"),
  "disposal_notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "fixed_assets_useful_life_chk" CHECK ("useful_life_months" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fixed_assets_facility_code_idx"
  ON "fixed_assets" ("facility_id", "asset_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fixed_asset_movements" (
  "id" serial PRIMARY KEY NOT NULL,
  "asset_id" integer NOT NULL REFERENCES "fixed_assets"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "movement_type" text NOT NULL,
  "movement_date" text NOT NULL,
  "period_code" text NOT NULL,
  "amount_kes" numeric(14, 2) NOT NULL,
  "net_book_value_after_kes" numeric(14, 2) NOT NULL,
  "journal_entry_id" integer REFERENCES "journal_entries"("id"),
  "notes" text,
  "recorded_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fixed_asset_movements_dep_period_idx"
  ON "fixed_asset_movements" ("asset_id", "movement_type", "period_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_invoices" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "supplier_id" integer NOT NULL REFERENCES "suppliers"("id"),
  "purchase_order_id" integer REFERENCES "purchase_orders"("id"),
  "invoice_number" text NOT NULL,
  "invoice_date" text NOT NULL,
  "due_date" text,
  "expense_account_id" integer NOT NULL REFERENCES "chart_of_accounts"("id"),
  "ap_account_id" integer NOT NULL REFERENCES "chart_of_accounts"("id"),
  "service_line" text,
  "subtotal_kes" numeric(14, 2) NOT NULL,
  "tax_kes" numeric(14, 2) DEFAULT '0.00' NOT NULL,
  "total_amount_kes" numeric(14, 2) NOT NULL,
  "paid_amount_kes" numeric(14, 2) DEFAULT '0.00' NOT NULL,
  "balance_kes" numeric(14, 2) NOT NULL,
  "status" text DEFAULT 'POSTED' NOT NULL,
  "posted_journal_id" integer REFERENCES "journal_entries"("id"),
  "idempotency_key" text NOT NULL,
  "notes" text,
  "created_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_invoices_facility_sup_num_idx"
  ON "supplier_invoices" ("facility_id", "supplier_id", "invoice_number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_accounts" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "account_name" text NOT NULL,
  "bank_code" text NOT NULL,
  "bank_name" text NOT NULL,
  "branch_name" text,
  "account_number_masked" text,
  "currency" text DEFAULT 'KES' NOT NULL,
  "account_kind" text DEFAULT 'BANK' NOT NULL,
  "gl_account_id" integer NOT NULL REFERENCES "chart_of_accounts"("id"),
  "connector_mode" text DEFAULT 'STATEMENT_IMPORT_ONLY' NOT NULL,
  "connector_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "opening_balance_kes" numeric(14, 2) DEFAULT '0.00' NOT NULL,
  "book_balance_kes" numeric(14, 2) DEFAULT '0.00' NOT NULL,
  "last_statement_balance_kes" numeric(14, 2),
  "last_reconciled_at" timestamp,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_accounts_facility_name_idx"
  ON "bank_accounts" ("facility_id", "account_name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_payments" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "supplier_invoice_id" integer NOT NULL REFERENCES "supplier_invoices"("id"),
  "supplier_id" integer NOT NULL REFERENCES "suppliers"("id"),
  "payment_number" text NOT NULL,
  "payment_date" text NOT NULL,
  "payment_method" text NOT NULL,
  "bank_account_id" integer REFERENCES "bank_accounts"("id"),
  "payment_reference" text,
  "amount_kes" numeric(14, 2) NOT NULL,
  "posted_journal_id" integer REFERENCES "journal_entries"("id"),
  "idempotency_key" text NOT NULL,
  "recorded_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_payments_facility_idemp_idx"
  ON "supplier_payments" ("facility_id", "idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_statement_imports" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "bank_account_id" integer NOT NULL REFERENCES "bank_accounts"("id"),
  "import_reference" text NOT NULL,
  "source_type" text DEFAULT 'CSV_IMPORT' NOT NULL,
  "statement_start_date" text NOT NULL,
  "statement_end_date" text NOT NULL,
  "opening_balance_kes" numeric(14, 2),
  "closing_balance_kes" numeric(14, 2) NOT NULL,
  "line_count" integer DEFAULT 0 NOT NULL,
  "file_hash" text NOT NULL,
  "imported_by_user_id" integer REFERENCES "users"("id"),
  "imported_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_stmt_imports_account_hash_idx"
  ON "bank_statement_imports" ("bank_account_id", "file_hash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_transactions" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "bank_account_id" integer NOT NULL REFERENCES "bank_accounts"("id"),
  "statement_import_id" integer REFERENCES "bank_statement_imports"("id"),
  "transaction_date" text NOT NULL,
  "value_date" text,
  "reference_number" text,
  "description" text NOT NULL,
  "direction" text NOT NULL,
  "amount_kes" numeric(14, 2) NOT NULL,
  "running_balance_kes" numeric(14, 2),
  "origin_classification" text DEFAULT 'IMPORTED_STATEMENT' NOT NULL,
  "match_status" text DEFAULT 'UNMATCHED' NOT NULL,
  "dedupe_hash" text NOT NULL,
  "matched_journal_line_id" integer REFERENCES "journal_lines"("id"),
  "matched_journal_entry_id" integer REFERENCES "journal_entries"("id"),
  "matched_billing_payment_id" integer REFERENCES "billing_payments"("id"),
  "matched_supplier_payment_id" integer REFERENCES "supplier_payments"("id"),
  "matched_by_user_id" integer REFERENCES "users"("id"),
  "matched_at" timestamp,
  "external_tx_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "bank_tx_origin_chk" CHECK ("origin_classification" IN ('IMPORTED_STATEMENT', 'MANUALLY_RECORDED', 'BANK_CONFIRMED_FEED')),
  CONSTRAINT "bank_tx_direction_chk" CHECK ("direction" IN ('INFLOW', 'OUTFLOW'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_transactions_account_date_idx"
  ON "bank_transactions" ("bank_account_id", "transaction_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_reconciliations" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "bank_account_id" integer NOT NULL REFERENCES "bank_accounts"("id"),
  "statement_import_id" integer NOT NULL REFERENCES "bank_statement_imports"("id"),
  "idempotency_key" text NOT NULL,
  "period_code" text NOT NULL,
  "statement_ending_date" text NOT NULL,
  "statement_ending_balance_kes" numeric(14, 2) NOT NULL,
  "ledger_book_balance_kes" numeric(14, 2) NOT NULL,
  "unmatched_deposits_kes" numeric(14, 2) DEFAULT '0.00' NOT NULL,
  "unmatched_withdrawals_kes" numeric(14, 2) DEFAULT '0.00' NOT NULL,
  "adjusted_difference_kes" numeric(14, 2) DEFAULT '0.00' NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "reconciled_by_user_id" integer REFERENCES "users"("id"),
  "reconciled_at" timestamp,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dialysis_machines" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "machine_code" text NOT NULL,
  "manufacturer" text,
  "model" text,
  "serial_number" text,
  "bay_label" text NOT NULL,
  "isolation_zone" text DEFAULT 'UNSPECIFIED' NOT NULL,
  "status" text DEFAULT 'OUT_OF_SERVICE' NOT NULL,
  "last_disinfected_at" timestamp,
  "next_preventive_maintenance_date" text,
  "notes" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dialysis_machines_facility_code_idx"
  ON "dialysis_machines" ("facility_id", "machine_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dialysis_patient_assessments" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "encounter_id" integer REFERENCES "encounters"("id"),
  "primary_icd11_code" text,
  "primary_diagnosis_display" text,
  "renal_history_summary" text NOT NULL,
  "vascular_access_type" text NOT NULL,
  "vascular_access_site" text,
  "viral_serology_status" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "baseline_dry_weight_kg" numeric(5, 2),
  "allergies_and_precautions" text,
  "clinical_fitness_status" text DEFAULT 'REQUIRES_NEPHROLOGIST_REVIEW' NOT NULL,
  "custom_protocol_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "assessed_by_user_id" integer REFERENCES "users"("id"),
  "assessed_by_name" text NOT NULL,
  "assessed_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dialysis_treatment_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "assessment_id" integer REFERENCES "dialysis_patient_assessments"("id"),
  "plan_number" text NOT NULL,
  "modality" text NOT NULL,
  "sessions_per_week" integer,
  "prescribed_duration_minutes" integer,
  "target_dry_weight_kg" numeric(5, 2),
  "dialyzer_specification" text,
  "dialysate_composition" text,
  "anticoagulation_protocol" text,
  "target_blood_flow_ml_min" integer,
  "max_uf_rate_ml_kg_hr" numeric(5, 2),
  "protocol_parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "authorized_by_user_id" integer REFERENCES "users"("id"),
  "authorized_by_name" text,
  "authorized_at" timestamp,
  "change_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "dialysis_plans_status_chk" CHECK ("status" IN ('DRAFT', 'AUTHORIZED', 'SUPERSEDED', 'DISCONTINUED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dialysis_plans_facility_num_idx"
  ON "dialysis_treatment_plans" ("facility_id", "plan_number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dialysis_schedules" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "treatment_plan_id" integer REFERENCES "dialysis_treatment_plans"("id"),
  "appointment_id" integer REFERENCES "appointments"("id"),
  "machine_id" integer REFERENCES "dialysis_machines"("id"),
  "scheduled_date" date NOT NULL,
  "shift_code" text NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "status" text DEFAULT 'SCHEDULED' NOT NULL,
  "cancellation_reason" text,
  "booked_source" text DEFAULT 'FACILITY_STAFF' NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "dialysis_schedules_status_chk" CHECK ("status" IN ('SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'TERMINATED_EARLY', 'ABORTED'))
);
--> statement-breakpoint
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dialysis_schedule_idempotency_idx" ON "dialysis_schedules" ("facility_id", "idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dialysis_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "session_number" text NOT NULL,
  "schedule_id" integer REFERENCES "dialysis_schedules"("id"),
  "treatment_plan_id" integer NOT NULL REFERENCES "dialysis_treatment_plans"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "encounter_id" integer REFERENCES "encounters"("id"),
  "machine_id" integer NOT NULL REFERENCES "dialysis_machines"("id"),
  "status" text DEFAULT 'PRE_CHECK' NOT NULL,
  "started_at" timestamp,
  "ended_at" timestamp,
  "actual_duration_minutes" integer,
  "pre_weight_kg" numeric(5, 2),
  "post_weight_kg" numeric(5, 2),
  "target_uf_ml" integer,
  "actual_uf_ml" integer,
  "pre_bp_systolic" integer,
  "pre_bp_diastolic" integer,
  "post_bp_systolic" integer,
  "post_bp_diastolic" integer,
  "pre_pulse" integer,
  "post_pulse" integer,
  "pre_temp_c" numeric(4, 1),
  "vascular_access_assessment" text,
  "anticoagulation_administered" text,
  "intradialytic_observations" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "nursing_summary" text,
  "billing_invoice_id" integer REFERENCES "billing_invoices"("id"),
  "billed_charge_status" text DEFAULT 'UNBILLED' NOT NULL,
  "initiated_by_user_id" integer REFERENCES "users"("id"),
  "completed_by_user_id" integer REFERENCES "users"("id"),
  "revision_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "dialysis_sessions_status_chk" CHECK ("status" IN ('PRE_CHECK', 'IN_PROGRESS', 'COMPLETED', 'TERMINATED_EARLY', 'ABORTED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dialysis_sessions_facility_num_idx"
  ON "dialysis_sessions" ("facility_id", "session_number");
--> statement-breakpoint
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dialysis_sessions_schedule_once_idx" ON "dialysis_sessions" ("schedule_id") WHERE "schedule_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dialysis_sessions_active_machine_idx" ON "dialysis_sessions" ("machine_id") WHERE "status" IN ('PRE_CHECK', 'IN_PROGRESS');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dialysis_consumable_usages" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "session_id" integer NOT NULL REFERENCES "dialysis_sessions"("id"),
  "inventory_item_id" integer NOT NULL REFERENCES "inventory_items"("id"),
  "batch_number" text,
  "item_name" text NOT NULL,
  "quantity_used" integer NOT NULL,
  "unit_cost_kes" numeric(12, 2),
  "total_cost_kes" numeric(12, 2),
  "batch_allocations" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "deducted_from_stock" boolean DEFAULT true NOT NULL,
  "recorded_by_user_id" integer REFERENCES "users"("id"),
  "recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dialysis_consumable_idempotency_idx" ON "dialysis_consumable_usages" ("facility_id", "idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dialysis_adverse_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "session_id" integer NOT NULL REFERENCES "dialysis_sessions"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "event_type" text NOT NULL,
  "severity" text NOT NULL,
  "onset_at" timestamp DEFAULT now() NOT NULL,
  "clinical_description" text NOT NULL,
  "immediate_intervention" text NOT NULL,
  "session_outcome" text NOT NULL,
  "follow_up_status" text DEFAULT 'OPEN' NOT NULL,
  "follow_up_notes" text,
  "follow_up_by_user_id" integer REFERENCES "users"("id"),
  "follow_up_at" timestamp,
  "reported_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "website_booking_clients" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "client_name" text NOT NULL,
  "api_key_prefix" text NOT NULL,
  "api_key_hash" text NOT NULL,
  "allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "allowed_services" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "slot_duration_minutes" integer DEFAULT 0 NOT NULL,
  "daily_capacity_per_service" integer DEFAULT 0 NOT NULL,
  "operating_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "rate_limit_per_minute" integer DEFAULT 30 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_used_at" timestamp,
  "created_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "website_booking_clients_hash_idx"
  ON "website_booking_clients" ("api_key_hash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "website_booking_slots" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "service_code" text NOT NULL,
  "slot_date" date NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "capacity" integer NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "created_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "booking_slot_time_chk" CHECK ("start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "start_time" < "end_time"),
  CONSTRAINT "booking_slot_capacity_chk" CHECK ("capacity" BETWEEN 1 AND 100),
  CONSTRAINT "booking_slot_status_chk" CHECK ("status" IN ('OPEN','CLOSED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booking_slots_unique_idx" ON "website_booking_slots" ("facility_id", "service_code", "slot_date", "start_time", "end_time");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_bookings" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "booking_reference" text NOT NULL,
  "booking_client_id" integer NOT NULL REFERENCES "website_booking_clients"("id"),
  "slot_id" integer NOT NULL REFERENCES "website_booking_slots"("id"),
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "duplicate_hash" text NOT NULL,
  "service_code" text NOT NULL,
  "department_id" integer REFERENCES "departments"("id"),
  "requested_date" text NOT NULL,
  "slot_start_time" text NOT NULL,
  "slot_end_time" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "patient_id" integer REFERENCES "patients"("id"),
  "patient_full_name" text NOT NULL,
  "patient_phone_encrypted" text NOT NULL,
  "patient_phone_hash" text NOT NULL,
  "patient_email" text,
  "visit_reason" text,
  "linked_appointment_id" integer REFERENCES "appointments"("id"),
  "linked_dialysis_schedule_id" integer REFERENCES "dialysis_schedules"("id"),
  "cancellation_reason" text,
  "reschedule_count" integer DEFAULT 0 NOT NULL,
  "notification_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_channel" text DEFAULT 'WEBSITE_API' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "external_booking_status_chk" CHECK ("status" IN ('PENDING','CONFIRMED','CANCELLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_bookings_ref_idx"
  ON "external_bookings" ("booking_reference");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_bookings_facility_idemp_idx"
  ON "external_bookings" ("booking_client_id", "idempotency_key");
--> statement-breakpoint
ALTER TABLE "financial_periods"
  ADD CONSTRAINT "financial_periods_dates_chk" CHECK ("start_date" <= "end_date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_reversal_once_idx"
  ON "journal_entries" ("reversal_of_journal_id")
  WHERE "reversal_of_journal_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_source_once_idx"
  ON "journal_entries" ("facility_id", "source_type", "source_id")
  WHERE "source_id" IS NOT NULL AND "source_type" <> 'MANUAL';
--> statement-breakpoint
CREATE FUNCTION "jalicare_financial_period_guard"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(146907, NEW.facility_id);
  IF TG_OP = 'UPDATE' AND OLD.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Closed financial periods cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.facility_id <> NEW.facility_id OR OLD.tenant_id <> NEW.tenant_id
      OR OLD.start_date <> NEW.start_date OR OLD.end_date <> NEW.end_date OR OLD.period_code <> NEW.period_code) THEN
    RAISE EXCEPTION 'Financial period scope and dates are immutable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM financial_periods p
     WHERE p.facility_id = NEW.facility_id AND p.id <> NEW.id
       AND p.start_date <= NEW.end_date AND p.end_date >= NEW.start_date
  ) THEN
    RAISE EXCEPTION 'Financial periods may not overlap' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "financial_periods_guard" BEFORE INSERT OR UPDATE ON "financial_periods"
  FOR EACH ROW EXECUTE FUNCTION "jalicare_financial_period_guard"();
--> statement-breakpoint
CREATE FUNCTION "jalicare_journal_header_guard"() RETURNS trigger AS $$
DECLARE
  period_row financial_periods%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Posted journals cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Posted journals are immutable; create a reversal' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Journal must be created as draft before posting' USING ERRCODE = '23514';
  END IF;
  IF NEW.status NOT IN ('DRAFT', 'POSTED') THEN
    RAISE EXCEPTION 'Unsupported journal status' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'POSTED' THEN
    SELECT * INTO period_row FROM financial_periods WHERE id = NEW.period_id FOR UPDATE;
    IF NOT FOUND OR period_row.status <> 'OPEN'
       OR period_row.facility_id <> NEW.facility_id
       OR period_row.tenant_id <> NEW.tenant_id
       OR NEW.entry_date < period_row.start_date OR NEW.entry_date > period_row.end_date THEN
      RAISE EXCEPTION 'Journal must belong to an open financial period in the same facility' USING ERRCODE = '23514';
    END IF;
    IF NEW.reversal_of_journal_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM journal_entries o WHERE o.id = NEW.reversal_of_journal_id
        AND o.facility_id = NEW.facility_id AND o.tenant_id = NEW.tenant_id
        AND o.status = 'POSTED' AND o.reversal_of_journal_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Invalid original journal for reversal' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "journal_entries_guard" BEFORE INSERT OR UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION "jalicare_journal_header_guard"();
--> statement-breakpoint
CREATE FUNCTION "jalicare_journal_line_guard"() RETURNS trigger AS $$
DECLARE
  header_row journal_entries%ROWTYPE;
  account_row chart_of_accounts%ROWTYPE;
  entry_id integer;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.journal_entry_id <> NEW.journal_entry_id THEN
    RAISE EXCEPTION 'Journal lines cannot be moved between entries' USING ERRCODE = '23514';
  END IF;
  entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_entry_id ELSE NEW.journal_entry_id END;
  SELECT * INTO header_row FROM journal_entries WHERE id = entry_id FOR UPDATE;
  IF NOT FOUND OR header_row.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Posted journal lines are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO account_row FROM chart_of_accounts WHERE id = NEW.account_id;
  IF NOT FOUND OR NOT account_row.is_active OR account_row.facility_id <> header_row.facility_id
     OR account_row.tenant_id <> header_row.tenant_id THEN
    RAISE EXCEPTION 'Journal account must be active and in the journal facility' USING ERRCODE = '23514';
  END IF;
  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM departments d WHERE d.id = NEW.department_id AND d.facility_id = header_row.facility_id
  ) THEN
    RAISE EXCEPTION 'Journal department is outside facility scope' USING ERRCODE = '23514';
  END IF;
  IF NEW.invoice_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM billing_invoices i WHERE i.id = NEW.invoice_id
      AND i.facility_id = header_row.facility_id AND i.tenant_id = header_row.tenant_id
  ) THEN
    RAISE EXCEPTION 'Journal invoice is outside facility scope' USING ERRCODE = '23514';
  END IF;
  IF NEW.supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM suppliers s WHERE s.id = NEW.supplier_id AND s.tenant_id = header_row.tenant_id
  ) THEN
    RAISE EXCEPTION 'Journal supplier is outside tenant scope' USING ERRCODE = '23514';
  END IF;
  IF NEW.patient_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM patients p WHERE p.id = NEW.patient_id AND p.tenant_id = header_row.tenant_id
      AND (p.registration_facility_id = header_row.facility_id OR EXISTS (
        SELECT 1 FROM encounters e WHERE e.patient_id = p.id AND e.facility_id = header_row.facility_id
      ))
  ) THEN
    RAISE EXCEPTION 'Journal patient is outside facility scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "journal_lines_guard" BEFORE INSERT OR UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "jalicare_journal_line_guard"();
--> statement-breakpoint
CREATE FUNCTION "jalicare_journal_balanced_at_commit"() RETURNS trigger AS $$
DECLARE
  header_row journal_entries%ROWTYPE;
  actual_debit numeric;
  actual_credit numeric;
  line_count bigint;
BEGIN
  SELECT * INTO header_row FROM journal_entries WHERE id = NEW.id;
  IF NOT FOUND OR header_row.status <> 'POSTED' THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(debit_cents), 0), COALESCE(SUM(credit_cents), 0), COUNT(*)
    INTO actual_debit, actual_credit, line_count FROM journal_lines WHERE journal_entry_id = NEW.id;
  IF line_count < 2 OR actual_debit <= 0 OR actual_debit <> actual_credit
     OR actual_debit <> header_row.total_debit_cents OR actual_credit <> header_row.total_credit_cents THEN
    RAISE EXCEPTION 'Posted journal lines must balance and agree with header totals' USING ERRCODE = '23514';
  END IF;
  IF header_row.reversal_of_journal_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM
      (SELECT account_id, department_id, service_line, patient_id, supplier_id, invoice_id,
              SUM(debit_cents) AS debit, SUM(credit_cents) AS credit
         FROM journal_lines WHERE journal_entry_id = header_row.reversal_of_journal_id
         GROUP BY account_id, department_id, service_line, patient_id, supplier_id, invoice_id) o
      FULL JOIN
      (SELECT account_id, department_id, service_line, patient_id, supplier_id, invoice_id,
              SUM(debit_cents) AS debit, SUM(credit_cents) AS credit
         FROM journal_lines WHERE journal_entry_id = header_row.id
         GROUP BY account_id, department_id, service_line, patient_id, supplier_id, invoice_id) r
      ON o.account_id = r.account_id
         AND o.department_id IS NOT DISTINCT FROM r.department_id
         AND o.service_line IS NOT DISTINCT FROM r.service_line
         AND o.patient_id IS NOT DISTINCT FROM r.patient_id
         AND o.supplier_id IS NOT DISTINCT FROM r.supplier_id
         AND o.invoice_id IS NOT DISTINCT FROM r.invoice_id
     WHERE COALESCE(o.debit, 0) <> COALESCE(r.credit, 0)
        OR COALESCE(o.credit, 0) <> COALESCE(r.debit, 0)
  ) THEN
    RAISE EXCEPTION 'Reversal must exactly invert original journal lines' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "journal_entries_balanced_at_commit"
  AFTER INSERT OR UPDATE ON "journal_entries" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "jalicare_journal_balanced_at_commit"();
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "facilities_id_tenant_unique_idx" ON "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_period_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "account_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "dialysis_schedules" ADD CONSTRAINT "dialysis_schedule_time_chk"
  CHECK ("start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     AND "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "start_time" < "end_time");
--> statement-breakpoint
ALTER TABLE "dialysis_consumable_usages" ADD CONSTRAINT "dialysis_consumable_quantity_chk" CHECK ("quantity_used" > 0);
--> statement-breakpoint
CREATE FUNCTION "jalicare_dialysis_schedule_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW.machine_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(146908, NEW.machine_id);
  IF NOT EXISTS (SELECT 1 FROM dialysis_machines m WHERE m.id=NEW.machine_id
      AND m.facility_id=NEW.facility_id AND m.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION 'Dialysis machine is outside facility scope' USING ERRCODE = '23514';
  END IF;
  IF NEW.status NOT IN ('CANCELLED','NO_SHOW') AND EXISTS (
    SELECT 1 FROM dialysis_schedules s WHERE s.id <> NEW.id AND s.machine_id=NEW.machine_id
      AND s.scheduled_date=NEW.scheduled_date AND s.status NOT IN ('CANCELLED','NO_SHOW')
      AND NEW.start_time < s.end_time AND NEW.end_time > s.start_time
  ) THEN
    RAISE EXCEPTION 'Dialysis machine has a conflicting scheduled slot' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "dialysis_schedule_guard" BEFORE INSERT OR UPDATE ON "dialysis_schedules"
  FOR EACH ROW EXECUTE FUNCTION "jalicare_dialysis_schedule_guard"();
--> statement-breakpoint
ALTER TABLE "dialysis_machines" ADD CONSTRAINT "dialysis_machine_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "dialysis_patient_assessments" ADD CONSTRAINT "dialysis_assessment_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "dialysis_treatment_plans" ADD CONSTRAINT "dialysis_plan_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "dialysis_schedules" ADD CONSTRAINT "dialysis_schedule_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "dialysis_sessions" ADD CONSTRAINT "dialysis_session_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "dialysis_consumable_usages" ADD CONSTRAINT "dialysis_usage_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "dialysis_adverse_events" ADD CONSTRAINT "dialysis_event_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "icd10_to_icd11_mappings" ADD CONSTRAINT "icd_mapping_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_booking_active_duplicate_idx"
  ON "external_bookings" ("slot_id", "duplicate_hash") WHERE "status" <> 'CANCELLED';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "website_booking_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "booking_id" integer NOT NULL REFERENCES "external_bookings"("id"),
  "client_id" integer REFERENCES "website_booking_clients"("id"),
  "actor_user_id" integer REFERENCES "users"("id"),
  "action" text NOT NULL,
  "previous_slot_id" integer REFERENCES "website_booking_slots"("id"),
  "new_slot_id" integer REFERENCES "website_booking_slots"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "website_booking_mutations" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_id" integer NOT NULL REFERENCES "website_booking_clients"("id"),
  "booking_id" integer NOT NULL REFERENCES "external_bookings"("id"),
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "action" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "website_booking_mutation_idempotency_idx" ON "website_booking_mutations" ("client_id", "idempotency_key");
--> statement-breakpoint
CREATE FUNCTION "jalicare_booking_capacity_guard"() RETURNS trigger AS $$
DECLARE slot_row website_booking_slots%ROWTYPE;
BEGIN
  SELECT * INTO slot_row FROM website_booking_slots WHERE id=NEW.slot_id FOR UPDATE;
  IF NOT FOUND OR slot_row.facility_id <> NEW.facility_id OR slot_row.tenant_id <> NEW.tenant_id
     OR slot_row.service_code <> NEW.service_code THEN
    RAISE EXCEPTION 'Booking slot is outside facility or service scope' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM website_booking_clients c WHERE c.id=NEW.booking_client_id
      AND c.facility_id=NEW.facility_id AND c.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION 'Booking client is outside facility scope' USING ERRCODE='23514';
  END IF;
  IF NEW.status <> 'CANCELLED' AND (slot_row.status <> 'OPEN' OR (
      SELECT COUNT(*) FROM external_bookings b WHERE b.slot_id=NEW.slot_id
        AND b.id <> NEW.id AND b.status <> 'CANCELLED') >= slot_row.capacity) THEN
    RAISE EXCEPTION 'Booking slot is closed or full' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "website_booking_capacity_guard" BEFORE INSERT OR UPDATE OF "slot_id", "status", "facility_id", "tenant_id", "booking_client_id", "service_code" ON "external_bookings"
  FOR EACH ROW EXECUTE FUNCTION "jalicare_booking_capacity_guard"();
--> statement-breakpoint
ALTER TABLE "website_booking_clients" ADD CONSTRAINT "booking_client_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "website_booking_slots" ADD CONSTRAINT "booking_slot_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "external_bookings" ADD CONSTRAINT "external_booking_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "website_booking_reminders" (
  "id" serial PRIMARY KEY NOT NULL,
  "booking_id" integer NOT NULL REFERENCES "external_bookings"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "idempotency_key" text NOT NULL,
  "requested_by_user_id" integer REFERENCES "users"("id"),
  "status" text DEFAULT 'PENDING' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "website_booking_reminder_status_chk" CHECK ("status" IN ('PENDING','COMPLETED','UNKNOWN'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "website_booking_reminder_idempotency_idx" ON "website_booking_reminders" ("facility_id", "idempotency_key");
--> statement-breakpoint
CREATE FUNCTION "jalicare_account_immutable_after_posting"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id
             WHERE l.account_id=OLD.id AND j.status='POSTED') THEN
    RAISE EXCEPTION 'Accounts referenced by posted journals are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "chart_of_accounts_posted_guard" BEFORE UPDATE OR DELETE ON "chart_of_accounts"
  FOR EACH ROW EXECUTE FUNCTION "jalicare_account_immutable_after_posting"();
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_transaction_dedupe_idx" ON "bank_transactions" ("bank_account_id", "dedupe_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_transaction_journal_line_once_idx" ON "bank_transactions" ("matched_journal_line_id") WHERE "matched_journal_line_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_reconciliation_idempotency_idx" ON "bank_reconciliations" ("bank_account_id", "idempotency_key");
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_account_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_import_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_tx_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliation_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_accounts_facility_gl_unique_idx" ON "bank_accounts" ("facility_id", "gl_account_id");
--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_facility_tenant_fk"
  FOREIGN KEY ("facility_id", "tenant_id") REFERENCES "facilities" ("id", "tenant_id");
--> statement-breakpoint
CREATE FUNCTION "jalicare_expense_finalized_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('REJECTED','POSTED') THEN
    RAISE EXCEPTION 'Finalized expense requests cannot be changed' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Expense requests must retain history' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "expense_finalized_guard" BEFORE UPDATE OR DELETE ON "expense_requests"
  FOR EACH ROW EXECUTE FUNCTION "jalicare_expense_finalized_guard"();
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "private_insurance_preauth_number_seq";
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "private_insurance_remittance_number_seq";
