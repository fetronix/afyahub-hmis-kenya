ALTER TABLE "patients" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardian_name" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardian_relationship" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardian_phone" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "guardian_sha_number" text;