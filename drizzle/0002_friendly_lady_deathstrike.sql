CREATE TABLE "health_record_exports" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"requested_by_user_id" integer NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"storage_key" text,
	"document_hash" text,
	"expires_at" timestamp,
	"downloaded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "health_record_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer,
	"target_tenant_id" integer NOT NULL,
	"target_facility_id" integer NOT NULL,
	"uploaded_by_user_id" integer NOT NULL,
	"source_facility_name" text,
	"source_facility_id" integer,
	"source_system" text,
	"source_record_id" text,
	"format" text NOT NULL,
	"status" text DEFAULT 'UPLOADED' NOT NULL,
	"storage_key" text,
	"document_hash" text,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"import_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"matched_patient_id" integer,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp,
	"imported_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"account_verified_at" timestamp,
	"activated_at" timestamp,
	"last_portal_login_at" timestamp,
	"last_portal_access_at" timestamp,
	"disabled_at" timestamp,
	"disabled_reason" text,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "patient_accounts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "patient_accounts_patient_id_unique" UNIQUE("patient_id")
);
--> statement-breakpoint
CREATE TABLE "patient_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"granted_by_user_id" integer,
	"recipient_facility_id" integer,
	"recipient_user_id" integer,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"revoked_by_user_id" integer,
	"consent_version" integer DEFAULT 1 NOT NULL,
	"consent_document_hash" text,
	"consent_method" text,
	"granted_through" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_facilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"relationship_type" text DEFAULT 'CARE' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_record_access_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"user_id" integer,
	"facility_id" integer,
	"tenant_id" integer,
	"action" text NOT NULL,
	"access_channel" text,
	"record_type" text,
	"record_id" integer,
	"purpose" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_access_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"referral_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"user_id" integer,
	"facility_id" integer,
	"action" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"referral_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"document_name" text NOT NULL,
	"storage_key" text,
	"document_url" text,
	"mime_type" text,
	"file_size" integer,
	"document_hash" text,
	"uploaded_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"referral_number" text NOT NULL,
	"patient_id" integer NOT NULL,
	"source_tenant_id" integer NOT NULL,
	"source_facility_id" integer NOT NULL,
	"destination_tenant_id" integer,
	"destination_facility_id" integer,
	"destination_department_id" integer,
	"external_destination_name" text,
	"external_destination_contact" text,
	"referring_practitioner_id" integer,
	"referred_by_user_id" integer,
	"receiving_practitioner_id" integer,
	"reason" text NOT NULL,
	"clinical_summary" text,
	"urgency" text DEFAULT 'ROUTINE' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"requested_at" timestamp,
	"sent_at" timestamp,
	"accepted_at" timestamp,
	"patient_seen_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"cancellation_reason" text,
	"receiving_clinical_summary" text,
	"receiving_notes" text,
	"response_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_referral_number_unique" UNIQUE("referral_number")
);
--> statement-breakpoint
ALTER TABLE "patients" DROP CONSTRAINT "patients_facility_id_facilities_id_fk";
--> statement-breakpoint
DROP INDEX "patients_tenant_facility_idx";--> statement-breakpoint
ALTER TABLE "encounters" ALTER COLUMN "encounter_type" SET DEFAULT 'OUTPATIENT';--> statement-breakpoint
ALTER TABLE "encounters" ALTER COLUMN "encounter_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "encounters" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';--> statement-breakpoint
ALTER TABLE "encounters" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "encounters" ALTER COLUMN "triage_category" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "encounters" ALTER COLUMN "follow_up_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "patient_identifiers" ALTER COLUMN "issuing_authority" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "date_of_birth" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "county" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "sub_county" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "allergies" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "chronic_conditions" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "payer_type" SET DEFAULT 'SELF_PAY';--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "payer_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "created_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "updated_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_identifiers" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_identifiers" ADD COLUMN "verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "patient_identifiers" ADD COLUMN "verified_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "patient_identifiers" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "registration_facility_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "deceased_at" timestamp;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "merged_into_patient_id" integer;--> statement-breakpoint
ALTER TABLE "health_record_exports" ADD CONSTRAINT "health_record_exports_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_record_exports" ADD CONSTRAINT "health_record_exports_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_record_imports" ADD CONSTRAINT "health_record_imports_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_record_imports" ADD CONSTRAINT "health_record_imports_target_tenant_id_tenants_id_fk" FOREIGN KEY ("target_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_record_imports" ADD CONSTRAINT "health_record_imports_target_facility_id_facilities_id_fk" FOREIGN KEY ("target_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_record_imports" ADD CONSTRAINT "health_record_imports_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_record_imports" ADD CONSTRAINT "health_record_imports_source_facility_id_facilities_id_fk" FOREIGN KEY ("source_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_record_imports" ADD CONSTRAINT "health_record_imports_matched_patient_id_patients_id_fk" FOREIGN KEY ("matched_patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_record_imports" ADD CONSTRAINT "health_record_imports_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_accounts" ADD CONSTRAINT "patient_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_accounts" ADD CONSTRAINT "patient_accounts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_recipient_facility_id_facilities_id_fk" FOREIGN KEY ("recipient_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_facilities" ADD CONSTRAINT "patient_facilities_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_facilities" ADD CONSTRAINT "patient_facilities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_facilities" ADD CONSTRAINT "patient_facilities_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_record_access_logs" ADD CONSTRAINT "patient_record_access_logs_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_record_access_logs" ADD CONSTRAINT "patient_record_access_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_record_access_logs" ADD CONSTRAINT "patient_record_access_logs_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_record_access_logs" ADD CONSTRAINT "patient_record_access_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_access_logs" ADD CONSTRAINT "referral_access_logs_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_access_logs" ADD CONSTRAINT "referral_access_logs_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_access_logs" ADD CONSTRAINT "referral_access_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_access_logs" ADD CONSTRAINT "referral_access_logs_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_documents" ADD CONSTRAINT "referral_documents_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_documents" ADD CONSTRAINT "referral_documents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_documents" ADD CONSTRAINT "referral_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_source_tenant_id_tenants_id_fk" FOREIGN KEY ("source_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_source_facility_id_facilities_id_fk" FOREIGN KEY ("source_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_destination_tenant_id_tenants_id_fk" FOREIGN KEY ("destination_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_destination_facility_id_facilities_id_fk" FOREIGN KEY ("destination_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_destination_department_id_departments_id_fk" FOREIGN KEY ("destination_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referring_practitioner_id_practitioners_id_fk" FOREIGN KEY ("referring_practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_by_user_id_users_id_fk" FOREIGN KEY ("referred_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_receiving_practitioner_id_practitioners_id_fk" FOREIGN KEY ("receiving_practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_record_exports_patient_idx" ON "health_record_exports" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "health_record_exports_requester_idx" ON "health_record_exports" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "health_record_exports_status_idx" ON "health_record_exports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "health_record_exports_expiry_idx" ON "health_record_exports" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "health_record_imports_target_facility_idx" ON "health_record_imports" USING btree ("target_facility_id");--> statement-breakpoint
CREATE INDEX "health_record_imports_patient_idx" ON "health_record_imports" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "health_record_imports_matched_patient_idx" ON "health_record_imports" USING btree ("matched_patient_id");--> statement-breakpoint
CREATE INDEX "health_record_imports_status_idx" ON "health_record_imports" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_accounts_user_idx" ON "patient_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_accounts_patient_idx" ON "patient_accounts" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patient_accounts_status_idx" ON "patient_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "patient_consents_patient_idx" ON "patient_consents" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patient_consents_recipient_facility_idx" ON "patient_consents" USING btree ("recipient_facility_id");--> statement-breakpoint
CREATE INDEX "patient_consents_recipient_user_idx" ON "patient_consents" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "patient_consents_status_idx" ON "patient_consents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "patient_consents_expiry_idx" ON "patient_consents" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "patient_facilities_patient_idx" ON "patient_facilities" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patient_facilities_facility_idx" ON "patient_facilities" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "patient_facilities_tenant_idx" ON "patient_facilities" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_facilities_unique_idx" ON "patient_facilities" USING btree ("patient_id","facility_id");--> statement-breakpoint
CREATE INDEX "patient_record_access_patient_idx" ON "patient_record_access_logs" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patient_record_access_user_idx" ON "patient_record_access_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "patient_record_access_facility_idx" ON "patient_record_access_logs" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "patient_record_access_created_idx" ON "patient_record_access_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "referral_access_logs_referral_idx" ON "referral_access_logs" USING btree ("referral_id");--> statement-breakpoint
CREATE INDEX "referral_access_logs_patient_idx" ON "referral_access_logs" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "referral_access_logs_user_idx" ON "referral_access_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "referral_documents_referral_idx" ON "referral_documents" USING btree ("referral_id");--> statement-breakpoint
CREATE INDEX "referral_documents_patient_idx" ON "referral_documents" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "referrals_patient_idx" ON "referrals" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "referrals_source_facility_idx" ON "referrals" USING btree ("source_facility_id");--> statement-breakpoint
CREATE INDEX "referrals_destination_facility_idx" ON "referrals" USING btree ("destination_facility_id");--> statement-breakpoint
CREATE INDEX "referrals_destination_department_idx" ON "referrals" USING btree ("destination_department_id");--> statement-breakpoint
CREATE INDEX "referrals_status_idx" ON "referrals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_number_idx" ON "referrals" USING btree ("referral_number");--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_identifiers" ADD CONSTRAINT "patient_identifiers_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_registration_facility_id_facilities_id_fk" FOREIGN KEY ("registration_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "encounters_tenant_idx" ON "encounters" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "encounters_department_idx" ON "encounters" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "encounters_status_idx" ON "encounters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "encounters_started_at_idx" ON "encounters" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "patient_identifiers_verified_idx" ON "patient_identifiers" USING btree ("verified");--> statement-breakpoint
CREATE INDEX "patients_tenant_idx" ON "patients" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "patients_registration_facility_idx" ON "patients" USING btree ("registration_facility_id");--> statement-breakpoint
CREATE INDEX "patients_phone_idx" ON "patients" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "patients_status_idx" ON "patients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "patients_merged_into_idx" ON "patients" USING btree ("merged_into_patient_id");--> statement-breakpoint
ALTER TABLE "patients" DROP COLUMN "facility_id";