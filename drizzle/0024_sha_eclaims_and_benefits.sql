-- ============================================================
-- 0024  SHA eClaims, Eligibility, Benefits, Preauth & Remittance
-- ============================================================
--
-- Forward-only, additive schema for payer-independent insurance
-- processing and Kenya Social Health Authority (SHA / AfyaLink /
-- Kenya eClaims FHIR R4 IG v0.1.0) workflows.
--
-- Design guarantees:
--   1. Never stores OAuth client secrets, tokens or raw credentials.
--   2. Masks patient identity hints in verification history; full
--      identifiers stay sealed on `patients`.
--   3. Preserves original JaliCare `billing_invoices`, `billing_items`,
--      `facility_service_tariffs` and clinical records untouched.
--   4. Stores monetary figures as `numeric(12, 2)`.
--   5. Records `source` and `is_simulated` on every external decision
--      so sandbox/mock checks are never confused with authoritative
--      payer confirmations.

CREATE SEQUENCE IF NOT EXISTS "sha_preauth_number_seq";--> statement-breakpoint

CREATE SEQUENCE IF NOT EXISTS "sha_eclaim_number_seq";--> statement-breakpoint

CREATE SEQUENCE IF NOT EXISTS "sha_remittance_number_seq";--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "insurance_payer_configs" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "payer_code" text NOT NULL DEFAULT 'SHA',
  "payer_name" text NOT NULL DEFAULT 'Social Health Authority (SHA)',
  "payer_type" text NOT NULL DEFAULT 'PUBLIC_SCHEME',
  "facility_registry_code" text,
  "accreditation_level" text,
  "contracted_schemes" jsonb NOT NULL DEFAULT '["SHIF","ECCIF"]'::jsonb,
  "default_coding_system" text NOT NULL DEFAULT 'ICD-11',
  "require_verified_eligibility" boolean NOT NULL DEFAULT true,
  "eligibility_max_age_hours" integer NOT NULL DEFAULT 24,
  "is_active" boolean NOT NULL DEFAULT true,
  "notes" text,
  "updated_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "insurance_payer_configs_facility_payer_idx"
  ON "insurance_payer_configs" ("facility_id", "payer_code");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "insurance_payer_configs_tenant_idx"
  ON "insurance_payer_configs" ("tenant_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payer_service_code_mappings" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "payer_code" text NOT NULL DEFAULT 'SHA',
  "tariff_id" integer REFERENCES "facility_service_tariffs"("id") ON DELETE SET NULL,
  "local_code" text NOT NULL,
  "local_description" text NOT NULL,
  "service_area" text NOT NULL,
  "payer_service_code" text NOT NULL,
  "payer_service_name" text NOT NULL,
  "fund" text NOT NULL DEFAULT 'SHIF',
  "access_point" text NOT NULL DEFAULT 'OP',
  "payment_mechanism" text NOT NULL DEFAULT 'FEE_FOR_SERVICE',
  "reimbursement_tariff" numeric(12, 2),
  "is_phc_zero_tariff" boolean NOT NULL DEFAULT false,
  "requires_preauth" boolean NOT NULL DEFAULT false,
  "preauth_category" text,
  "requires_referral" boolean NOT NULL DEFAULT false,
  "requires_clinical_notes" boolean NOT NULL DEFAULT true,
  "effective_from" date,
  "effective_to" date,
  "is_active" boolean NOT NULL DEFAULT true,
  "notes" text,
  "created_by_user_id" integer REFERENCES "users"("id"),
  "updated_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "payer_service_mappings_facility_payer_code_idx"
  ON "payer_service_code_mappings" ("facility_id", "payer_code", "local_code");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payer_service_mappings_tariff_idx"
  ON "payer_service_code_mappings" ("facility_id", "tariff_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payer_service_mappings_tenant_idx"
  ON "payer_service_code_mappings" ("tenant_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payer_benefit_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "payer_code" text NOT NULL DEFAULT 'SHA',
  "rule_code" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "benefit_package" text NOT NULL,
  "service_category" text NOT NULL,
  "payer_service_code" text,
  "min_facility_level" text,
  "requires_preauth" boolean NOT NULL DEFAULT false,
  "requires_referral" boolean NOT NULL DEFAULT false,
  "required_evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "copay_type" text NOT NULL DEFAULT 'NONE',
  "copay_value" numeric(12, 2) NOT NULL DEFAULT '0.00',
  "annual_limit" numeric(12, 2),
  "per_visit_limit" numeric(12, 2),
  "exclusion_notes" text,
  "source_reference" text NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "effective_from" date NOT NULL,
  "effective_to" date,
  "created_by_user_id" integer REFERENCES "users"("id"),
  "approved_by_user_id" integer REFERENCES "users"("id"),
  "approved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "payer_benefit_rules_facility_code_ver_idx"
  ON "payer_benefit_rules" ("facility_id", "payer_code", "rule_code", "version");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payer_benefit_rules_lookup_idx"
  ON "payer_benefit_rules" ("facility_id", "payer_code", "status");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "insurance_eligibility_verifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "encounter_id" integer REFERENCES "encounters"("id") ON DELETE SET NULL,
  "payer_code" text NOT NULL DEFAULT 'SHA',
  "identification_type" text NOT NULL,
  "identification_hint" text NOT NULL,
  "intended_service_area" text,
  "outcome" text NOT NULL,
  "source" text NOT NULL,
  "is_simulated" boolean NOT NULL DEFAULT false,
  "payer_reference" text,
  "member_cr_number" text,
  "member_status" text,
  "schemes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "coverage_start_date" date,
  "coverage_end_date" date,
  "restrictions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "reason" text,
  "possible_solution" text,
  "response_classification" text NOT NULL,
  "correlation_id" text,
  "checked_by_user_id" integer REFERENCES "users"("id"),
  "checked_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ins_elig_verifications_patient_idx"
  ON "insurance_eligibility_verifications" ("facility_id", "patient_id", "checked_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ins_elig_verifications_tenant_idx"
  ON "insurance_eligibility_verifications" ("tenant_id", "checked_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "insurance_benefit_validations" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "encounter_id" integer REFERENCES "encounters"("id") ON DELETE SET NULL,
  "eligibility_verification_id" integer REFERENCES "insurance_eligibility_verifications"("id") ON DELETE SET NULL,
  "payer_code" text NOT NULL DEFAULT 'SHA',
  "tariff_id" integer REFERENCES "facility_service_tariffs"("id") ON DELETE SET NULL,
  "mapping_id" integer REFERENCES "payer_service_code_mappings"("id") ON DELETE SET NULL,
  "benefit_rule_id" integer REFERENCES "payer_benefit_rules"("id") ON DELETE SET NULL,
  "rule_version" integer,
  "service_description" text NOT NULL,
  "service_category" text NOT NULL,
  "payer_service_code" text,
  "benefit_package" text,
  "service_date" date NOT NULL,
  "quantity" integer NOT NULL DEFAULT 1,
  "facility_tariff_amount" numeric(12, 2) NOT NULL,
  "payer_tariff_amount" numeric(12, 2),
  "estimated_copay_amount" numeric(12, 2) NOT NULL DEFAULT '0.00',
  "estimated_covered_amount" numeric(12, 2),
  "decision" text NOT NULL,
  "verification_source" text NOT NULL,
  "is_simulated" boolean NOT NULL DEFAULT false,
  "requires_preauth" boolean NOT NULL DEFAULT false,
  "preauth_reference" text,
  "has_referral" boolean NOT NULL DEFAULT false,
  "has_clinical_notes" boolean NOT NULL DEFAULT false,
  "missing_requirements" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "reason" text NOT NULL,
  "validated_by_user_id" integer REFERENCES "users"("id"),
  "validated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ins_benefit_validations_patient_idx"
  ON "insurance_benefit_validations" ("facility_id", "patient_id", "validated_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "insurance_preauthorizations" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "encounter_id" integer REFERENCES "encounters"("id") ON DELETE SET NULL,
  "eligibility_verification_id" integer REFERENCES "insurance_eligibility_verifications"("id") ON DELETE SET NULL,
  "tariff_id" integer REFERENCES "facility_service_tariffs"("id") ON DELETE SET NULL,
  "payer_code" text NOT NULL DEFAULT 'SHA',
  "preauth_number" text NOT NULL UNIQUE,
  "external_bundle_id" text NOT NULL UNIQUE,
  "payer_auth_reference" text,
  "mediator_id" text,
  "category" text NOT NULL DEFAULT 'GENERAL',
  "status" text NOT NULL DEFAULT 'DRAFT',
  "source" text NOT NULL DEFAULT 'LOCAL_DRAFT',
  "is_simulated" boolean NOT NULL DEFAULT false,
  "clinical_indication" text NOT NULL,
  "primary_diagnosis_code" text NOT NULL,
  "primary_diagnosis_display" text NOT NULL,
  "coding_system" text NOT NULL DEFAULT 'ICD-11',
  "requested_service_code" text NOT NULL,
  "requested_service_name" text NOT NULL,
  "quantity" integer NOT NULL DEFAULT 1,
  "estimated_amount" numeric(12, 2) NOT NULL,
  "approved_amount" numeric(12, 2),
  "conditions" text,
  "valid_from" date,
  "valid_until" date,
  "supporting_notes" text,
  "rejection_reason" text,
  "fhir_bundle" jsonb,
  "amendment_count" integer NOT NULL DEFAULT 0,
  "last_amendment_reason" text,
  "created_by_user_id" integer REFERENCES "users"("id"),
  "submitted_by_user_id" integer REFERENCES "users"("id"),
  "decided_by_user_id" integer REFERENCES "users"("id"),
  "submitted_at" timestamp,
  "decided_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ins_preauth_facility_status_idx"
  ON "insurance_preauthorizations" ("facility_id", "status", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ins_preauth_patient_idx"
  ON "insurance_preauthorizations" ("facility_id", "patient_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sha_eclaims" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "encounter_id" integer REFERENCES "encounters"("id") ON DELETE SET NULL,
  "invoice_id" integer NOT NULL REFERENCES "billing_invoices"("id"),
  "eligibility_verification_id" integer REFERENCES "insurance_eligibility_verifications"("id") ON DELETE SET NULL,
  "preauthorization_id" integer REFERENCES "insurance_preauthorizations"("id") ON DELETE SET NULL,
  "payer_code" text NOT NULL DEFAULT 'SHA',
  "scheme_code" text NOT NULL DEFAULT 'SHIF',
  "claim_number" text NOT NULL UNIQUE,
  "claim_uuid" text NOT NULL UNIQUE,
  "claim_type" text NOT NULL DEFAULT 'institutional',
  "sub_type" text NOT NULL DEFAULT 'op',
  "status" text NOT NULL DEFAULT 'DRAFT',
  "environment_mode" text NOT NULL DEFAULT 'mock',
  "is_simulated" boolean NOT NULL DEFAULT false,
  "billable_start" date NOT NULL,
  "billable_end" date NOT NULL,
  "total_billed_amount" numeric(12, 2) NOT NULL,
  "total_claimed_amount" numeric(12, 2) NOT NULL,
  "total_approved_amount" numeric(12, 2) NOT NULL DEFAULT '0.00',
  "total_paid_amount" numeric(12, 2) NOT NULL DEFAULT '0.00',
  "patient_copay_amount" numeric(12, 2) NOT NULL DEFAULT '0.00',
  "is_phc_claim" boolean NOT NULL DEFAULT false,
  "diagnoses_snapshot" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "supporting_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "validation_issues" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "payer_claim_reference" text,
  "mediator_id" text,
  "rejection_reason" text,
  "adjudication_summary" jsonb,
  "submission_count" integer NOT NULL DEFAULT 0,
  "previous_submission_ref" text,
  "fhir_bundle" jsonb,
  "settled_payment_id" integer REFERENCES "billing_payments"("id") ON DELETE SET NULL,
  "created_by_user_id" integer REFERENCES "users"("id"),
  "submitted_by_user_id" integer REFERENCES "users"("id"),
  "submitted_at" timestamp,
  "acknowledged_at" timestamp,
  "adjudicated_at" timestamp,
  "paid_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sha_eclaims_facility_status_idx"
  ON "sha_eclaims" ("facility_id", "status", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sha_eclaims_invoice_idx"
  ON "sha_eclaims" ("invoice_id", "status");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sha_eclaims_patient_idx"
  ON "sha_eclaims" ("facility_id", "patient_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sha_eclaim_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "eclaim_id" integer NOT NULL REFERENCES "sha_eclaims"("id") ON DELETE CASCADE,
  "billing_item_id" integer REFERENCES "billing_items"("id") ON DELETE SET NULL,
  "tariff_id" integer REFERENCES "facility_service_tariffs"("id") ON DELETE SET NULL,
  "sequence" integer NOT NULL,
  "source_type" text,
  "source_id" integer,
  "local_code" text,
  "description" text NOT NULL,
  "service_area" text,
  "payer_service_code" text,
  "payer_service_name" text,
  "fund" text NOT NULL DEFAULT 'SHIF',
  "payment_mechanism" text NOT NULL DEFAULT 'FEE_FOR_SERVICE',
  "serviced_start" date NOT NULL,
  "serviced_end" date NOT NULL,
  "quantity" integer NOT NULL DEFAULT 1,
  "facility_unit_price" numeric(12, 2) NOT NULL,
  "claimed_unit_price" numeric(12, 2) NOT NULL,
  "claimed_net_amount" numeric(12, 2) NOT NULL,
  "approved_amount" numeric(12, 2),
  "rejection_reason" text,
  "preauth_reference" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sha_eclaim_items_claim_idx"
  ON "sha_eclaim_items" ("eclaim_id", "sequence");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sha_eclaim_submissions" (
  "id" serial PRIMARY KEY NOT NULL,
  "eclaim_id" integer NOT NULL REFERENCES "sha_eclaims"("id") ON DELETE CASCADE,
  "attempt_number" integer NOT NULL,
  "operation" text NOT NULL,
  "bundle_uuid" text NOT NULL,
  "environment_mode" text NOT NULL,
  "is_simulated" boolean NOT NULL DEFAULT false,
  "request_correlation_id" text NOT NULL,
  "http_status" integer,
  "outcome" text NOT NULL,
  "mediator_id" text,
  "payer_claim_id" text,
  "upstream_state" text,
  "rejection_reason" text,
  "errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "submitted_by_user_id" integer REFERENCES "users"("id"),
  "submitted_at" timestamp NOT NULL DEFAULT now(),
  "acknowledged_at" timestamp
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sha_eclaim_submissions_claim_idx"
  ON "sha_eclaim_submissions" ("eclaim_id", "attempt_number");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sha_eclaim_status_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "eclaim_id" integer NOT NULL REFERENCES "sha_eclaims"("id") ON DELETE CASCADE,
  "from_status" text,
  "to_status" text NOT NULL,
  "source" text NOT NULL,
  "actor_user_id" integer REFERENCES "users"("id"),
  "reason" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sha_eclaim_status_history_claim_idx"
  ON "sha_eclaim_status_history" ("eclaim_id", "created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "insurance_remittances" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "payer_code" text NOT NULL DEFAULT 'SHA',
  "remittance_number" text NOT NULL UNIQUE,
  "payer_remittance_ref" text NOT NULL,
  "payment_date" date NOT NULL,
  "payment_channel" text NOT NULL DEFAULT 'EFT',
  "total_remitted_amount" numeric(12, 2) NOT NULL,
  "allocated_amount" numeric(12, 2) NOT NULL DEFAULT '0.00',
  "unallocated_amount" numeric(12, 2) NOT NULL DEFAULT '0.00',
  "status" text NOT NULL DEFAULT 'RECEIVED',
  "source" text NOT NULL DEFAULT 'MANUAL_ADVICE',
  "is_simulated" boolean NOT NULL DEFAULT false,
  "fhir_payment_notice" jsonb,
  "notes" text,
  "received_by_user_id" integer REFERENCES "users"("id"),
  "reconciled_by_user_id" integer REFERENCES "users"("id"),
  "reconciled_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "insurance_remittances_facility_payer_ref_idx"
  ON "insurance_remittances" ("facility_id", "payer_code", "payer_remittance_ref");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "insurance_remittances_facility_status_idx"
  ON "insurance_remittances" ("facility_id", "status", "payment_date");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "insurance_reconciliation_entries" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "remittance_id" integer NOT NULL REFERENCES "insurance_remittances"("id") ON DELETE CASCADE,
  "eclaim_id" integer NOT NULL REFERENCES "sha_eclaims"("id"),
  "invoice_id" integer NOT NULL REFERENCES "billing_invoices"("id"),
  "claimed_amount" numeric(12, 2) NOT NULL,
  "approved_amount" numeric(12, 2) NOT NULL,
  "remitted_amount" numeric(12, 2) NOT NULL,
  "applied_to_invoice_amount" numeric(12, 2) NOT NULL DEFAULT '0.00',
  "variance_amount" numeric(12, 2) NOT NULL DEFAULT '0.00',
  "variance_reason" text,
  "reconciliation_status" text NOT NULL DEFAULT 'MATCHED',
  "posted_payment_id" integer REFERENCES "billing_payments"("id") ON DELETE SET NULL,
  "reconciled_by_user_id" integer REFERENCES "users"("id"),
  "reconciled_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ins_recon_entries_remittance_claim_idx"
  ON "insurance_reconciliation_entries" ("remittance_id", "eclaim_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ins_recon_entries_facility_idx"
  ON "insurance_reconciliation_entries" ("facility_id", "reconciled_at");
