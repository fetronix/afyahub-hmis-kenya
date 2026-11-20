/*
 * Duty roster, shift assignment and clock-in/clock-out.
 *
 * WHY
 * ---
 * `hr_shifts` only held a name and two clock times, `hr_roster_entries` was
 * writable but had no screen, and `hr_attendance` had no clock instants at all,
 * so an employee could never be "clocked in" and a shift could never turn into
 * an assignment. This migration adds the missing columns and the three small
 * tables the workflow needs, without touching any existing row.
 *
 * SAFETY
 * ------
 * - Additive only: every ALTER is IF NOT EXISTS and every new column is either
 *   nullable or has a default, so existing shifts, rosters and attendance rows
 *   keep loading unchanged.
 * - The widened attendance status check is dropped and recreated inside a
 *   guard, so re-running is harmless.
 * - No row is written here.
 */
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "break_minutes" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "department_id" integer REFERENCES "hr_departments"("id");
--> statement-breakpoint
ALTER TABLE "hr_shifts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_shifts_facility_active_idx" ON "hr_shifts" USING btree ("facility_id","is_active");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_shifts_break_check') THEN
    ALTER TABLE "hr_shifts" ADD CONSTRAINT "hr_shifts_break_check" CHECK ("break_minutes" BETWEEN 0 AND 480);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_shifts_span_check') THEN
    ALTER TABLE "hr_shifts" ADD CONSTRAINT "hr_shifts_span_check" CHECK ("start_time" <> "end_time");
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "hr_roster_entries" ADD COLUMN IF NOT EXISTS "department_id" integer REFERENCES "hr_departments"("id");
--> statement-breakpoint
ALTER TABLE "hr_roster_entries" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'ASSIGNED';
--> statement-breakpoint
ALTER TABLE "hr_roster_entries" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;
--> statement-breakpoint
ALTER TABLE "hr_roster_entries" ADD COLUMN IF NOT EXISTS "cancelled_by" integer REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "hr_roster_entries" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "hr_roster_entries" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_roster_shift_date_idx" ON "hr_roster_entries" USING btree ("facility_id","shift_id","work_date");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_roster_status_check') THEN
    ALTER TABLE "hr_roster_entries" ADD CONSTRAINT "hr_roster_status_check" CHECK ("status" IN ('ASSIGNED','CANCELLED'));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD COLUMN IF NOT EXISTS "roster_entry_id" integer REFERENCES "hr_roster_entries"("id");
--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD COLUMN IF NOT EXISTS "shift_id" integer REFERENCES "hr_shifts"("id");
--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD COLUMN IF NOT EXISTS "clock_in_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD COLUMN IF NOT EXISTS "clock_out_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD COLUMN IF NOT EXISTS "scheduled_minutes" integer;
--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD COLUMN IF NOT EXISTS "late_minutes" integer;
--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD COLUMN IF NOT EXISTS "worked_minutes" integer;
--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD COLUMN IF NOT EXISTS "overtime_minutes" integer;
--> statement-breakpoint
ALTER TABLE "hr_attendance" ADD COLUMN IF NOT EXISTS "corrected_at" timestamp;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_attendance_status_check') THEN
    ALTER TABLE "hr_attendance" DROP CONSTRAINT "hr_attendance_status_check";
  END IF;
  ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_status_check"
    CHECK ("status" IN ('PRESENT','LATE','ABSENT','LEAVE','HOLIDAY','OFF_DUTY','TRAINING','INCOMPLETE'));
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_attendance_clock_check') THEN
    ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_clock_check"
      CHECK ("clock_out_at" IS NULL OR "clock_in_at" IS NULL OR "clock_out_at" >= "clock_in_at");
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hr_attendance_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "grace_minutes" integer NOT NULL DEFAULT 10,
  "absence_cutoff_minutes" integer NOT NULL DEFAULT 240,
  "time_zone" text NOT NULL DEFAULT 'Africa/Nairobi',
  "allow_roster_conflicts" boolean NOT NULL DEFAULT false,
  "updated_by" integer REFERENCES "users"("id"),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "hr_attendance_policies_grace_check" CHECK ("grace_minutes" BETWEEN 0 AND 240),
  CONSTRAINT "hr_attendance_policies_cutoff_check" CHECK ("absence_cutoff_minutes" BETWEEN 0 AND 1440)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hr_attendance_policies_facility_idx" ON "hr_attendance_policies" USING btree ("facility_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hr_holidays" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "holiday_date" date NOT NULL,
  "name" text NOT NULL,
  "created_by" integer REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hr_holidays_facility_date_idx" ON "hr_holidays" USING btree ("facility_id","holiday_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hr_attendance_corrections" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "attendance_id" integer NOT NULL REFERENCES "hr_attendance"("id"),
  "employee_id" integer NOT NULL REFERENCES "hr_employees"("id"),
  "reason" text NOT NULL,
  "previous_status" text,
  "new_status" text,
  "previous_clock_in_at" timestamp with time zone,
  "new_clock_in_at" timestamp with time zone,
  "previous_clock_out_at" timestamp with time zone,
  "new_clock_out_at" timestamp with time zone,
  "corrected_by" integer REFERENCES "users"("id"),
  "corrected_by_name" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "hr_attendance_corrections_reason_check" CHECK (length(trim("reason")) BETWEEN 5 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_attendance_corrections_attendance_idx" ON "hr_attendance_corrections" USING btree ("attendance_id");
