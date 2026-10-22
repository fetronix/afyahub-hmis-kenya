CREATE TABLE "facility_subscription_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"access_status" text DEFAULT 'ACTIVE' NOT NULL,
	"suspended_at" timestamp,
	"suspended_by" text,
	"suspension_reason" text,
	"reactivated_at" timestamp,
	"reactivated_by" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_subscription_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"subscription_period_id" integer NOT NULL,
	"transaction_code" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_method" text DEFAULT 'MPESA' NOT NULL,
	"payment_date" timestamp DEFAULT now() NOT NULL,
	"verification_status" text DEFAULT 'PENDING' NOT NULL,
	"verified_by" text,
	"verified_at" timestamp,
	"verification_notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_subscription_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"subscription_name" text NOT NULL,
	"amount_due" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'KES' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"due_date" date NOT NULL,
	"grace_period_end" date,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_subscription_price_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"subscription_period_id" integer NOT NULL,
	"previous_amount" numeric(12, 2) NOT NULL,
	"new_amount" numeric(12, 2) NOT NULL,
	"effective_timing" text NOT NULL,
	"reason" text NOT NULL,
	"changed_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facility_subscription_access" ADD CONSTRAINT "facility_subscription_access_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_subscription_access" ADD CONSTRAINT "facility_subscription_access_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_subscription_payments" ADD CONSTRAINT "facility_subscription_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_subscription_payments" ADD CONSTRAINT "facility_subscription_payments_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_subscription_payments" ADD CONSTRAINT "facility_subscription_payments_subscription_period_id_facility_subscription_periods_id_fk" FOREIGN KEY ("subscription_period_id") REFERENCES "public"."facility_subscription_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_subscription_periods" ADD CONSTRAINT "facility_subscription_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_subscription_periods" ADD CONSTRAINT "facility_subscription_periods_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_subscription_price_changes" ADD CONSTRAINT "facility_subscription_price_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_subscription_price_changes" ADD CONSTRAINT "facility_subscription_price_changes_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_subscription_price_changes" ADD CONSTRAINT "facility_subscription_price_changes_subscription_period_id_facility_subscription_periods_id_fk" FOREIGN KEY ("subscription_period_id") REFERENCES "public"."facility_subscription_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "facility_subscription_access_facility_uidx" ON "facility_subscription_access" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "facility_subscription_access_tenant_idx" ON "facility_subscription_access" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "facility_subscription_access_status_idx" ON "facility_subscription_access" USING btree ("access_status");--> statement-breakpoint
CREATE UNIQUE INDEX "facility_subscription_payments_transaction_code_uidx" ON "facility_subscription_payments" USING btree ("transaction_code");--> statement-breakpoint
CREATE INDEX "facility_subscription_payments_period_idx" ON "facility_subscription_payments" USING btree ("subscription_period_id");--> statement-breakpoint
CREATE INDEX "facility_subscription_payments_facility_idx" ON "facility_subscription_payments" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "facility_subscription_payments_verification_idx" ON "facility_subscription_payments" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "facility_subscription_periods_facility_idx" ON "facility_subscription_periods" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "facility_subscription_periods_tenant_idx" ON "facility_subscription_periods" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "facility_subscription_periods_status_idx" ON "facility_subscription_periods" USING btree ("status");--> statement-breakpoint
CREATE INDEX "facility_subscription_periods_start_idx" ON "facility_subscription_periods" USING btree ("period_start");--> statement-breakpoint
CREATE INDEX "facility_subscription_price_changes_period_idx" ON "facility_subscription_price_changes" USING btree ("subscription_period_id");--> statement-breakpoint
CREATE INDEX "facility_subscription_price_changes_facility_idx" ON "facility_subscription_price_changes" USING btree ("facility_id");