-- ============================================================
-- 0026  SHA HIE v1 Workflows & Kenya eClaims FHIR R4 IG v0.1.0
-- ============================================================
--
-- Forward-only, additive schema strengthening SHA eClaims across
-- all 10 DHA HIE / AfyaConnect / AfyaLink / Kenya eClaims IG v0.1.0
-- workflows without mutating core JaliCare records or Private Insurance.
--
-- Adds:
--   1. HIE eligibility attributes (`is_alive`, biometrics/OTP flags,
--      structured `scheme_details` including POMSF* prefix metadata).
--   2. `sha_patient_authorizations`: HIE beneficiary consent & visit
--      authorizations (`POST /claims/authorize`, `POST /claims/visit`,
--      `AUTHORIZED` vs `AUTHORIZED_PENDING_VISIT` for elective preauths).
--   3. `sha_benefit_utilization_snapshots`: HIE benefits, sub-benefits,
--      intervention matrix flags, remaining individual/household balances,
--      and POMSF balances.
--   4. Preauthorization HIE fields (`consent_token`, `hie_preauth_guid`,
--      `is_elective`, practitioner regulatory body & doctor consent,
--      `interim_approved_amount`, `required_documents`).
--   5. eClaims HIE virtual-claim & FHIR dual-protocol fields
--      (`submission_protocol`, `consent_token`, `hie_virtual_claim_id`,
--      `discharge_reason`, practitioner regulator).
--   6. Remittance two-step HIE reconciliation keys (`bank_reference`,
--      `facility_id_type`).
--   7. `sha_callback_events`: Verified HIE push status callback ledger.

ALTER TABLE "insurance_eligibility_verifications"
  ADD COLUMN IF NOT EXISTS "is_alive" boolean,
  ADD COLUMN IF NOT EXISTS "facility_biometrics_enforced" boolean,
  ADD COLUMN IF NOT EXISTS "whitelisted_for_otp" boolean,
  ADD COLUMN IF NOT EXISTS "scheme_details" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sha_patient_authorizations" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "encounter_id" integer REFERENCES "encounters"("id") ON DELETE SET NULL,
  "payer_code" text NOT NULL DEFAULT 'SHA',
  "member_cr_number" text,
  "service_type" text NOT NULL DEFAULT 'OUTPATIENT',
  "consent_method" text NOT NULL DEFAULT 'OTP',
  "authorization_guid" text,
  "consent_token" text,
  "auth_code" text,
  "auth_status" text NOT NULL DEFAULT 'PENDING',
  "is_elective" boolean NOT NULL DEFAULT false,
  "interventions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "selected_pomsf_scheme" text,
  "virtual_claim_id" text,
  "practitioner_reg_number" text,
  "practitioner_regulator" text,
  "expires_at" timestamp,
  "source" text NOT NULL DEFAULT 'UNAVAILABLE',
  "is_simulated" boolean NOT NULL DEFAULT false,
  "correlation_id" text,
  "created_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sha_patient_auth_facility_patient_idx"
  ON "sha_patient_authorizations" ("facility_id", "patient_id", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sha_patient_auth_token_idx"
  ON "sha_patient_authorizations" ("facility_id", "consent_token");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sha_benefit_utilization_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "payer_code" text NOT NULL DEFAULT 'SHA',
  "member_cr_number" text,
  "intervention_code" text,
  "sub_benefit_code" text,
  "benefit_package" text,
  "limit_scope" text,
  "individual_max_limit" numeric(12, 2),
  "individual_utilised_limit" numeric(12, 2),
  "individual_remaining_limit" numeric(12, 2),
  "household_max_limit" numeric(12, 2),
  "household_utilised_limit" numeric(12, 2),
  "household_remaining_limit" numeric(12, 2),
  "pomsf_balance" numeric(12, 2),
  "overall_tariff" numeric(12, 2),
  "needs_preauth" boolean,
  "needs_manual_preauth_approval" boolean,
  "needs_doctor_authorization" boolean,
  "specialist_preauth_flags" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "utilization_days" integer,
  "next_availability" text,
  "source" text NOT NULL,
  "is_simulated" boolean NOT NULL DEFAULT false,
  "correlation_id" text,
  "checked_by_user_id" integer REFERENCES "users"("id"),
  "checked_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sha_util_snapshots_patient_idx"
  ON "sha_benefit_utilization_snapshots" ("facility_id", "patient_id", "checked_at");--> statement-breakpoint

ALTER TABLE "insurance_preauthorizations"
  ADD COLUMN IF NOT EXISTS "authorization_id" integer REFERENCES "sha_patient_authorizations"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "consent_token" text,
  ADD COLUMN IF NOT EXISTS "hie_preauth_guid" text,
  ADD COLUMN IF NOT EXISTS "is_elective" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "needs_doctor_authorization" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "doctor_approved" boolean,
  ADD COLUMN IF NOT EXISTS "practitioner_reg_number" text,
  ADD COLUMN IF NOT EXISTS "practitioner_regulator" text,
  ADD COLUMN IF NOT EXISTS "interim_approved_amount" numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "required_documents" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint

ALTER TABLE "sha_eclaims"
  ADD COLUMN IF NOT EXISTS "authorization_id" integer REFERENCES "sha_patient_authorizations"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "consent_token" text,
  ADD COLUMN IF NOT EXISTS "submission_protocol" text NOT NULL DEFAULT 'FHIR_BUNDLE',
  ADD COLUMN IF NOT EXISTS "hie_virtual_claim_id" text,
  ADD COLUMN IF NOT EXISTS "discharge_reason" text,
  ADD COLUMN IF NOT EXISTS "practitioner_reg_number" text,
  ADD COLUMN IF NOT EXISTS "practitioner_regulator" text;--> statement-breakpoint

ALTER TABLE "insurance_remittances"
  ADD COLUMN IF NOT EXISTS "bank_reference" text,
  ADD COLUMN IF NOT EXISTS "facility_id_type" text NOT NULL DEFAULT 'fr-code';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ins_remittances_bank_ref_idx"
  ON "insurance_remittances" ("facility_id", "bank_reference");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sha_callback_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer REFERENCES "tenants"("id") ON DELETE SET NULL,
  "facility_id" integer REFERENCES "facilities"("id") ON DELETE SET NULL,
  "facility_fr_code" text,
  "entity_type" text NOT NULL,
  "external_reference" text NOT NULL,
  "upstream_status" text NOT NULL,
  "mapped_local_status" text,
  "signature_verified" boolean NOT NULL DEFAULT false,
  "processing_outcome" text NOT NULL,
  "payload_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "correlation_id" text,
  "received_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sha_callback_events_ref_idx"
  ON "sha_callback_events" ("entity_type", "external_reference", "received_at");
