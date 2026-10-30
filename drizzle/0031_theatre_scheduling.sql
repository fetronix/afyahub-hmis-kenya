-- Additive Theatre scheduling tables. No legacy cases are backfilled or certified.
-- Refuse pre-existing objects instead of accepting a same-named table or index
-- with missing clinical-scheduling constraints. The journal makes normal reruns a no-op.
DO $$
BEGIN
  IF to_regclass('theatre_rooms') IS NOT NULL
    OR to_regclass('theatre_bookings') IS NOT NULL
    OR to_regclass('theatre_schedule_events') IS NOT NULL
    OR to_regclass('theatre_legacy_review_events') IS NOT NULL
    OR to_regclass('theatre_rooms_facility_name_uq') IS NOT NULL
    OR to_regclass('theatre_cases_id_patient_uq') IS NOT NULL
    OR to_regclass('theatre_bookings_facility_request_uq') IS NOT NULL
    OR to_regclass('theatre_bookings_facility_start_idx') IS NOT NULL
    OR to_regclass('theatre_schedule_events_case_idx') IS NOT NULL
    OR to_regclass('theatre_legacy_review_events_case_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'Theatre scheduling objects already exist without this journal entry; review their definitions before applying this migration';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "theatre_rooms" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "name" text NOT NULL CHECK (length(btrim("name")) BETWEEN 1 AND 120),
  "state" text NOT NULL DEFAULT 'OPEN' CHECK ("state" IN ('OPEN', 'MAINTENANCE', 'INACTIVE')),
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "theatre_rooms_facility_name_uq" ON "theatre_rooms" ("facility_id", lower("name"));
--> statement-breakpoint
-- Supports the composite FK below: a booking cannot name a different patient
-- from its existing case. The standalone case primary key remains unchanged.
CREATE UNIQUE INDEX IF NOT EXISTS "theatre_cases_id_patient_uq" ON "theatre_cases" ("id", "patient_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "theatre_bookings" (
  "case_id" integer PRIMARY KEY REFERENCES "theatre_cases"("id"),
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "room_id" integer NOT NULL REFERENCES "theatre_rooms"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "lead_practitioner_id" integer NOT NULL REFERENCES "practitioners"("id"),
  "encounter_id" integer REFERENCES "encounters"("id"),
  "admission_id" integer REFERENCES "admissions"("id"),
  "urgency" text NOT NULL CHECK ("urgency" IN ('ELECTIVE', 'URGENT', 'EMERGENCY')),
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "reserved" boolean NOT NULL DEFAULT true,
  "request_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "revision" integer NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "theatre_booking_case_patient_fk" FOREIGN KEY ("case_id", "patient_id") REFERENCES "theatre_cases"("id", "patient_id"),
  CONSTRAINT "theatre_booking_time_order" CHECK ("starts_at" < "ends_at"),
  -- Built-in range GiST operators avoid requiring btree_gist or superuser privileges.
  -- [start,end) permits consecutive cases; canceled bookings stop reserving a slot.
  CONSTRAINT "theatre_booking_no_room_overlap" EXCLUDE USING gist (
    int8range("room_id"::bigint, "room_id"::bigint + 1, '[)') WITH &&,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("reserved"),
  CONSTRAINT "theatre_booking_no_patient_overlap" EXCLUDE USING gist (
    int8range("patient_id"::bigint, "patient_id"::bigint + 1, '[)') WITH &&,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("reserved"),
  CONSTRAINT "theatre_booking_no_practitioner_overlap" EXCLUDE USING gist (
    int8range("lead_practitioner_id"::bigint, "lead_practitioner_id"::bigint + 1, '[)') WITH &&,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("reserved")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "theatre_bookings_facility_request_uq" ON "theatre_bookings" ("facility_id", "request_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "theatre_bookings_facility_start_idx" ON "theatre_bookings" ("facility_id", "starts_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "theatre_schedule_events" (
  "id" serial PRIMARY KEY,
  "case_id" integer NOT NULL REFERENCES "theatre_cases"("id"),
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "action" text NOT NULL CHECK ("action" IN ('SCHEDULED', 'RESCHEDULED', 'CANCELLED')),
  "reason" text,
  "previous_room_id" integer REFERENCES "theatre_rooms"("id"),
  "previous_starts_at" timestamptz,
  "previous_ends_at" timestamptz,
  "new_room_id" integer REFERENCES "theatre_rooms"("id"),
  "new_starts_at" timestamptz,
  "new_ends_at" timestamptz,
  "actor_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "theatre_schedule_events_case_idx" ON "theatre_schedule_events" ("case_id", "id");
--> statement-breakpoint
-- An explicit scheduling attestation never changes the historical clinical case.
CREATE TABLE IF NOT EXISTS "theatre_legacy_review_events" (
  "id" serial PRIMARY KEY,
  "case_id" integer NOT NULL REFERENCES "theatre_cases"("id"),
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "action" text NOT NULL CHECK ("action" IN ('NO_ACTIVE_RESERVATION', 'REVOKED')),
  "reason" text NOT NULL CHECK (length(btrim("reason")) BETWEEN 1 AND 500),
  "actor_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "theatre_legacy_review_events_case_idx" ON "theatre_legacy_review_events" ("case_id", "id");
