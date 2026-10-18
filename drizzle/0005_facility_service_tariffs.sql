CREATE TABLE "facility_service_tariffs" (
    "id" serial PRIMARY KEY NOT NULL,
    "tenant_id" integer NOT NULL,
    "facility_id" integer NOT NULL,
    "code" text NOT NULL,
    "description" text NOT NULL,
    "department" text NOT NULL,
    "unit" text DEFAULT 'Service' NOT NULL,
    "fee" numeric(10, 2) NOT NULL,
    "sha_status" text DEFAULT 'Not Assessed' NOT NULL,
    "sha_notes" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facility_service_tariffs"
    ADD CONSTRAINT "facility_service_tariffs_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "facility_service_tariffs"
    ADD CONSTRAINT "facility_service_tariffs_facility_id_facilities_id_fk"
    FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id")
    ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_items" ADD COLUMN "tariff_id" integer;
--> statement-breakpoint
ALTER TABLE "billing_items" ADD COLUMN "tariff_code" text;
--> statement-breakpoint
ALTER TABLE "billing_items"
    ADD CONSTRAINT "billing_items_tariff_id_facility_service_tariffs_id_fk"
    FOREIGN KEY ("tariff_id") REFERENCES "public"."facility_service_tariffs"("id")
    ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "facility_service_tariffs_facility_code_unique"
    ON "facility_service_tariffs" USING btree ("facility_id", "code");
--> statement-breakpoint
CREATE INDEX "facility_service_tariffs_tenant_facility_idx"
    ON "facility_service_tariffs" USING btree ("tenant_id", "facility_id");
--> statement-breakpoint
CREATE INDEX "facility_service_tariffs_active_idx"
    ON "facility_service_tariffs" USING btree ("facility_id", "is_active");
