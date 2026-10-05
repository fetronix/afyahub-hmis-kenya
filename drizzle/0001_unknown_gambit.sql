CREATE TABLE "facility_admin_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"designation" text DEFAULT 'Facility Administrator',
	"invitation_token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"accepted_user_id" integer,
	"invited_by" text NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "facility_admin_invitations_invitation_token_hash_unique" UNIQUE("invitation_token_hash")
);
--> statement-breakpoint
CREATE TABLE "facility_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"document_name" text NOT NULL,
	"document_url" text,
	"storage_key" text,
	"mime_type" text,
	"file_size" integer,
	"document_hash" text,
	"verification_status" text DEFAULT 'PENDING' NOT NULL,
	"uploaded_by" text,
	"verified_by" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"verified_at" timestamp,
	"rejection_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "facility_onboarding" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"status" text DEFAULT 'PROSPECT' NOT NULL,
	"submitted_by" text,
	"verified_by" text,
	"approved_by" text,
	"submitted_at" timestamp,
	"verified_at" timestamp,
	"approved_at" timestamp,
	"activated_at" timestamp,
	"suspended_at" timestamp,
	"deactivated_at" timestamp,
	"suspension_reason" text,
	"rejection_reason" text,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"username_or_email" text NOT NULL,
	"user_id" integer,
	"ip_address" text,
	"user_agent" text,
	"successful" boolean DEFAULT false NOT NULL,
	"failure_reason" text,
	"attempted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"requested_ip" text,
	"requested_user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_token_hash" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"revoke_reason" text,
	"security_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sessions_session_token_hash_unique" UNIQUE("session_token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"designation" text,
	"role_id" integer NOT NULL,
	"invitation_token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"accepted_user_id" integer,
	"invited_by" text NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_invitations_invitation_token_hash_unique" UNIQUE("invitation_token_hash")
);
--> statement-breakpoint
ALTER TABLE "admissions" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "timestamp" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_invoices" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_payments" ALTER COLUMN "payment_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "procedures" ALTER COLUMN "performed_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnoses" ALTER COLUMN "diagnosed_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "encounters" ALTER COLUMN "started_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ALTER COLUMN "mfl_code" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "facilities" ALTER COLUMN "enabled_modules" SET DEFAULT '["registration","reception","opd","inpatient","theatre","specialty","laboratory","radiology","pharmacy","inventory","procurement","finance","insurance","public_health","analytics","interoperability","configuration","audit"]'::jsonb;--> statement-breakpoint
ALTER TABLE "facilities" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_orders" ALTER COLUMN "ordered_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_results" ALTER COLUMN "verified_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "medications" ALTER COLUMN "prescribed_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "observations" ALTER COLUMN "recorded_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_identifiers" ALTER COLUMN "is_primary" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pharmacy_dispensations" ALTER COLUMN "dispensed_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "practitioners" ALTER COLUMN "is_active" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "public_health_reports" ALTER COLUMN "reported_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "queues" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "radiology_orders" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "is_system" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "theatre_cases" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "is_active" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "admissions" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "severity" text DEFAULT 'INFO';--> statement-breakpoint
ALTER TABLE "beds" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "beds" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_items" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "is_active" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_identifiers" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "permissions" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "practitioners" ADD COLUMN "profession" text;--> statement-breakpoint
ALTER TABLE "practitioners" ADD COLUMN "registration_body" text;--> statement-breakpoint
ALTER TABLE "practitioners" ADD COLUMN "registration_number" text;--> statement-breakpoint
ALTER TABLE "practitioners" ADD COLUMN "license_expiry_date" text;--> statement-breakpoint
ALTER TABLE "practitioners" ADD COLUMN "credential_verification_status" text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "practitioners" ADD COLUMN "credential_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "practitioners" ADD COLUMN "credential_verified_by" text;--> statement-breakpoint
ALTER TABLE "practitioners" ADD COLUMN "credential_verification_notes" text;--> statement-breakpoint
ALTER TABLE "practitioners" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "practitioners" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "practitioners" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "public_health_reports" ADD COLUMN "reported_by" text;--> statement-breakpoint
ALTER TABLE "public_health_reports" ADD COLUMN "status" text DEFAULT 'DRAFT';--> statement-breakpoint
ALTER TABLE "public_health_reports" ADD COLUMN "submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "public_health_reports" ADD COLUMN "submission_reference" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "radiology_orders" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "theatre_cases" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "assigned_by" text;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "assigned_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_status" text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_failed_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_ip" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_logout_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "security_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivation_reason" text;--> statement-breakpoint
ALTER TABLE "wards" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "facility_admin_invitations" ADD CONSTRAINT "facility_admin_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_admin_invitations" ADD CONSTRAINT "facility_admin_invitations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_admin_invitations" ADD CONSTRAINT "facility_admin_invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_documents" ADD CONSTRAINT "facility_documents_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_onboarding" ADD CONSTRAINT "facility_onboarding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_onboarding" ADD CONSTRAINT "facility_onboarding_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facility_admin_invitations_facility_idx" ON "facility_admin_invitations" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "facility_admin_invitations_email_idx" ON "facility_admin_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "facility_admin_invitations_expiry_idx" ON "facility_admin_invitations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "facility_documents_facility_idx" ON "facility_documents" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "facility_documents_verification_idx" ON "facility_documents" USING btree ("verification_status");--> statement-breakpoint
CREATE UNIQUE INDEX "facility_onboarding_facility_idx" ON "facility_onboarding" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "facility_onboarding_tenant_status_idx" ON "facility_onboarding" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "login_attempts_user_idx" ON "login_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip_address");--> statement-breakpoint
CREATE INDEX "login_attempts_time_idx" ON "login_attempts" USING btree ("attempted_at");--> statement-breakpoint
CREATE INDEX "password_resets_user_idx" ON "password_resets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_resets_expiry_idx" ON "password_resets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_active_idx" ON "sessions" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "user_invitations_facility_idx" ON "user_invitations" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "user_invitations_email_idx" ON "user_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "user_invitations_expiry_idx" ON "user_invitations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_idx" ON "audit_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_logs_facility_idx" ON "audit_logs" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "beds_ward_bed_number_idx" ON "beds" USING btree ("ward_id","bed_number");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_facility_code_idx" ON "departments" USING btree ("facility_id","code");--> statement-breakpoint
CREATE INDEX "encounters_patient_idx" ON "encounters" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "encounters_facility_idx" ON "encounters" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "encounters_practitioner_idx" ON "encounters" USING btree ("practitioner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_tenant_code_idx" ON "facilities" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_mfl_code_idx" ON "facilities" USING btree ("mfl_code");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_batches_item_batch_idx" ON "inventory_batches" USING btree ("item_id","batch_number");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_facility_code_idx" ON "inventory_items" USING btree ("facility_id","item_code");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_tests_facility_code_idx" ON "lab_tests" USING btree ("facility_id","code");--> statement-breakpoint
CREATE INDEX "patient_identifiers_patient_idx" ON "patient_identifiers" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patient_identifiers_type_value_idx" ON "patient_identifiers" USING btree ("id_type","id_value");--> statement-breakpoint
CREATE INDEX "patients_tenant_facility_idx" ON "patients" USING btree ("tenant_id","facility_id");--> statement-breakpoint
CREATE INDEX "patients_national_id_idx" ON "patients" USING btree ("national_id");--> statement-breakpoint
CREATE INDEX "patients_sha_idx" ON "patients" USING btree ("sha_number");--> statement-breakpoint
CREATE UNIQUE INDEX "practitioners_user_idx" ON "practitioners" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "practitioners_facility_license_idx" ON "practitioners" USING btree ("facility_id","license_number");--> statement-breakpoint
CREATE INDEX "practitioners_registration_idx" ON "practitioners" USING btree ("registration_body","registration_number");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_permission_idx" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_name_idx" ON "roles" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_idx" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_user_role_idx" ON "user_roles" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE INDEX "user_roles_user_idx" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "users_facility_idx" ON "users" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "users_account_status_idx" ON "users" USING btree ("account_status");--> statement-breakpoint
CREATE UNIQUE INDEX "wards_facility_code_idx" ON "wards" USING btree ("facility_id","code");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE("username");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");