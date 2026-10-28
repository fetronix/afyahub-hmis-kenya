CREATE SEQUENCE IF NOT EXISTS "private_insurance_claim_seq" START WITH 1 INCREMENT BY 1;
--> statement-breakpoint
ALTER TABLE "insurance_payer_configs"
  ADD COLUMN IF NOT EXISTS "integration_type" text DEFAULT 'MANUAL' NOT NULL,
  ADD COLUMN IF NOT EXISTS "adapter_key" text DEFAULT 'manual' NOT NULL,
  ADD COLUMN IF NOT EXISTS "gateway_provider" text,
  ADD COLUMN IF NOT EXISTS "environment" text DEFAULT 'UNCONFIGURED' NOT NULL,
  ADD COLUMN IF NOT EXISTS "connection_status" text DEFAULT 'NOT_CONFIGURED' NOT NULL,
  ADD COLUMN IF NOT EXISTS "api_base_url" text,
  ADD COLUMN IF NOT EXISTS "auth_method" text DEFAULT 'NONE' NOT NULL,
  ADD COLUMN IF NOT EXISTS "secret_env_prefix" text,
  ADD COLUMN IF NOT EXISTS "provider_identifier" text,
  ADD COLUMN IF NOT EXISTS "supported_operations" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "claim_requirements" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "preauth_requirements" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "missing_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "last_connection_check_at" timestamp,
  ADD COLUMN IF NOT EXISTS "last_connection_summary" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insurance_member_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "payer_code" text NOT NULL,
  "member_number" text NOT NULL,
  "policy_number" text,
  "scheme_name" text,
  "plan_name" text,
  "member_role" text DEFAULT 'PRINCIPAL' NOT NULL,
  "principal_member_name" text,
  "principal_member_number" text,
  "relationship_to_principal" text,
  "external_member_id" text,
  "valid_from" date,
  "valid_to" date,
  "facility_restrictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "scheme_restrictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "evidence_source" text DEFAULT 'UNVERIFIED_ENTRY' NOT NULL,
  "verification_status" text DEFAULT 'UNVERIFIED_LOCAL' NOT NULL,
  "manual_review_status" text DEFAULT 'PENDING_REVIEW' NOT NULL,
  "manual_review_notes" text,
  "last_verified_at" timestamp,
  "verified_by_user_id" integer REFERENCES "users"("id"),
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "correction_count" integer DEFAULT 0 NOT NULL,
  "last_correction_reason" text,
  "created_by_user_id" integer REFERENCES "users"("id"),
  "updated_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ins_member_policies_facility_payer_member_idx"
  ON "insurance_member_policies" ("facility_id", "payer_code", "patient_id", "member_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ins_member_policies_patient_idx"
  ON "insurance_member_policies" ("facility_id", "patient_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ins_member_policies_tenant_idx"
  ON "insurance_member_policies" ("tenant_id", "payer_code");
--> statement-breakpoint
ALTER TABLE "payer_benefit_rules"
  ADD COLUMN IF NOT EXISTS "deductible_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  ADD COLUMN IF NOT EXISTS "coinsurance_percent" numeric(5, 2) DEFAULT '0.00' NOT NULL,
  ADD COLUMN IF NOT EXISTS "waiting_period_days" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "panel_restriction_notes" text;
--> statement-breakpoint
ALTER TABLE "insurance_eligibility_verifications"
  ADD COLUMN IF NOT EXISTS "member_policy_id" integer REFERENCES "insurance_member_policies"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "manual_reference" text,
  ADD COLUMN IF NOT EXISTS "evidence_document_ref" text,
  ADD COLUMN IF NOT EXISTS "visit_session_ref" text;
--> statement-breakpoint
ALTER TABLE "insurance_benefit_validations"
  ADD COLUMN IF NOT EXISTS "member_policy_id" integer REFERENCES "insurance_member_policies"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "deductible_estimate" numeric(12, 2) DEFAULT '0.00' NOT NULL;
--> statement-breakpoint
ALTER TABLE "insurance_preauthorizations"
  ADD COLUMN IF NOT EXISTS "member_policy_id" integer REFERENCES "insurance_member_policies"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "invoice_id" integer REFERENCES "billing_invoices"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "requested_items" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insurance_preauthorization_attachments" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "preauthorization_id" integer NOT NULL REFERENCES "insurance_preauthorizations"("id") ON DELETE CASCADE,
  "document_type" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text DEFAULT 'application/pdf' NOT NULL,
  "file_size_bytes" integer DEFAULT 0 NOT NULL,
  "storage_reference" text NOT NULL,
  "checksum_sha256" text,
  "notes" text,
  "uploaded_by_user_id" integer REFERENCES "users"("id"),
  "uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ins_preauth_attachments_preauth_idx"
  ON "insurance_preauthorization_attachments" ("preauthorization_id", "uploaded_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "private_insurance_claims" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "member_policy_id" integer NOT NULL REFERENCES "insurance_member_policies"("id"),
  "encounter_id" integer REFERENCES "encounters"("id") ON DELETE SET NULL,
  "admission_id" integer REFERENCES "admissions"("id") ON DELETE SET NULL,
  "invoice_id" integer NOT NULL REFERENCES "billing_invoices"("id"),
  "eligibility_verification_id" integer REFERENCES "insurance_eligibility_verifications"("id") ON DELETE SET NULL,
  "preauthorization_id" integer REFERENCES "insurance_preauthorizations"("id") ON DELETE SET NULL,
  "payer_code" text NOT NULL,
  "adapter_key" text DEFAULT 'manual' NOT NULL,
  "integration_type" text DEFAULT 'MANUAL' NOT NULL,
  "claim_number" text NOT NULL UNIQUE,
  "idempotency_key" text NOT NULL UNIQUE,
  "encounter_type" text DEFAULT 'OPD' NOT NULL,
  "currency" text DEFAULT 'KES' NOT NULL,
  "service_date_start" date NOT NULL,
  "service_date_end" date NOT NULL,
  "gross_invoice_amount" numeric(12, 2) NOT NULL,
  "discount_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "confirmed_copay_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "patient_paid_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "proposed_claim_amount" numeric(12, 2) NOT NULL,
  "approved_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "paid_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "submission_channel" text DEFAULT 'NONE' NOT NULL,
  "diagnoses_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "clinical_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "attachments_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "validation_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "external_claim_reference" text,
  "visit_session_ref" text,
  "rejection_code" text,
  "rejection_reason" text,
  "adjudication_notes" text,
  "submission_count" integer DEFAULT 0 NOT NULL,
  "revision_number" integer DEFAULT 1 NOT NULL,
  "settled_payment_id" integer REFERENCES "billing_payments"("id") ON DELETE SET NULL,
  "created_by_user_id" integer REFERENCES "users"("id"),
  "submitted_by_user_id" integer REFERENCES "users"("id"),
  "submitted_at" timestamp,
  "acknowledged_at" timestamp,
  "adjudicated_at" timestamp,
  "paid_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "priv_ins_claims_facility_status_idx"
  ON "private_insurance_claims" ("facility_id", "payer_code", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "priv_ins_claims_invoice_idx"
  ON "private_insurance_claims" ("invoice_id", "payer_code", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "priv_ins_claims_patient_idx"
  ON "private_insurance_claims" ("facility_id", "patient_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "private_insurance_claim_lines" (
  "id" serial PRIMARY KEY NOT NULL,
  "claim_id" integer NOT NULL REFERENCES "private_insurance_claims"("id") ON DELETE CASCADE,
  "billing_item_id" integer REFERENCES "billing_items"("id") ON DELETE SET NULL,
  "tariff_id" integer REFERENCES "facility_service_tariffs"("id") ON DELETE SET NULL,
  "mapping_id" integer REFERENCES "payer_service_code_mappings"("id") ON DELETE SET NULL,
  "line_number" integer NOT NULL,
  "service_category" text NOT NULL,
  "item_code" text,
  "item_description" text NOT NULL,
  "payer_service_code" text,
  "payer_service_name" text,
  "mapping_status" text DEFAULT 'UNMAPPED' NOT NULL,
  "service_date" date NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "unit_price" numeric(12, 2) NOT NULL,
  "gross_amount" numeric(12, 2) NOT NULL,
  "discount_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "copay_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "proposed_claim_amount" numeric(12, 2) NOT NULL,
  "approved_amount" numeric(12, 2),
  "rejection_reason" text,
  "preauth_reference" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "priv_ins_claim_lines_claim_idx"
  ON "private_insurance_claim_lines" ("claim_id", "line_number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "private_insurance_claim_submissions" (
  "id" serial PRIMARY KEY NOT NULL,
  "claim_id" integer NOT NULL REFERENCES "private_insurance_claims"("id") ON DELETE CASCADE,
  "attempt_number" integer NOT NULL,
  "adapter_key" text NOT NULL,
  "submission_channel" text NOT NULL,
  "operation" text NOT NULL,
  "correlation_id" text NOT NULL,
  "http_status" integer,
  "outcome" text NOT NULL,
  "external_reference" text,
  "error_code" text,
  "response_summary" text,
  "submitted_by_user_id" integer REFERENCES "users"("id"),
  "submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "priv_ins_claim_submissions_claim_idx"
  ON "private_insurance_claim_submissions" ("claim_id", "attempt_number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "private_insurance_claim_status_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "claim_id" integer NOT NULL REFERENCES "private_insurance_claims"("id") ON DELETE CASCADE,
  "from_status" text,
  "to_status" text NOT NULL,
  "source" text NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id"),
  "reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "priv_ins_claim_history_claim_idx"
  ON "private_insurance_claim_status_history" ("claim_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "private_insurance_remittance_allocations" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "remittance_id" integer NOT NULL REFERENCES "insurance_remittances"("id") ON DELETE CASCADE,
  "claim_id" integer NOT NULL REFERENCES "private_insurance_claims"("id"),
  "invoice_id" integer NOT NULL REFERENCES "billing_invoices"("id"),
  "payer_code" text NOT NULL,
  "claimed_amount" numeric(12, 2) NOT NULL,
  "approved_amount" numeric(12, 2) NOT NULL,
  "remitted_amount" numeric(12, 2) NOT NULL,
  "applied_to_invoice_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "variance_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "variance_reason" text,
  "reconciliation_status" text DEFAULT 'MATCHED' NOT NULL,
  "posted_payment_id" integer REFERENCES "billing_payments"("id") ON DELETE SET NULL,
  "reconciled_by_user_id" integer REFERENCES "users"("id"),
  "reconciled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "priv_ins_remit_alloc_remittance_claim_idx"
  ON "private_insurance_remittance_allocations" ("remittance_id", "claim_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "priv_ins_remit_alloc_facility_idx"
  ON "private_insurance_remittance_allocations" ("facility_id", "payer_code", "reconciled_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insurance_integration_diagnostics" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "payer_code" text NOT NULL,
  "adapter_key" text NOT NULL,
  "environment" text NOT NULL,
  "operation" text NOT NULL,
  "direction" text DEFAULT 'OUTBOUND' NOT NULL,
  "outcome" text NOT NULL,
  "http_status" integer,
  "duration_ms" integer DEFAULT 0 NOT NULL,
  "correlation_id" text NOT NULL,
  "error_code" text,
  "summary" text NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ins_integration_diag_facility_idx"
  ON "insurance_integration_diagnostics" ("facility_id", "payer_code", "created_at");
