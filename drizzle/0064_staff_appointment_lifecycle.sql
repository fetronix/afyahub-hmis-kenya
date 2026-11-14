-- Additive staff-booking foundation. No legacy appointment, dialysis, website,
-- financial or patient rows are backfilled, altered or deleted. Legacy writers
-- may continue to omit these new nullable fields.
-- Refuse pre-existing objects rather than silently treating an incompatible or
-- partially installed schema as this migration. The guarded DDL below is a
-- second defense; it is not a substitute for a reviewed upgrade and backup.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'appointments'
      AND column_name IN ('booking_reference', 'category_id', 'facility_service_id',
                          'priority', 'created_by_user_id', 'replacement_of_id', 'checkin_queue_id')
  ) OR EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname IN (
      'appointment_categories', 'appointment_events', 'appointment_requests',
      'appointment_categories_active_idx', 'appointments_identity_scope_uidx',
      'appointments_booking_reference_uidx', 'appointments_checkin_queue_uidx',
      'appointments_replacement_uidx', 'appointments_diary_date_idx', 'appointment_events_scope_idx'
    )
  ) THEN
    RAISE EXCEPTION 'Appointment lifecycle objects already exist; review schema before migration';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS appointment_categories (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  code text NOT NULL,
  name text NOT NULL,
  facility_service_id integer,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id integer NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  CHECK (length(trim(name)) BETWEEN 1 AND 120),
  CONSTRAINT appointment_categories_scope_code_idx UNIQUE (facility_id, code),
  UNIQUE (id, tenant_id, facility_id),
  FOREIGN KEY (facility_service_id, facility_id, tenant_id)
    REFERENCES facility_services(id, facility_id, tenant_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS appointment_categories_active_idx ON appointment_categories(tenant_id, facility_id, is_active, name);
--> statement-breakpoint
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS booking_reference text,
  ADD COLUMN IF NOT EXISTS category_id integer,
  ADD COLUMN IF NOT EXISTS facility_service_id integer,
  ADD COLUMN IF NOT EXISTS priority text,
  ADD COLUMN IF NOT EXISTS created_by_user_id integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS replacement_of_id integer,
  ADD COLUMN IF NOT EXISTS checkin_queue_id integer REFERENCES queues(id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS appointments_identity_scope_uidx ON appointments(id, tenant_id, facility_id);
--> statement-breakpoint
ALTER TABLE appointments
  ADD CONSTRAINT appointments_category_scope_fk FOREIGN KEY (category_id, tenant_id, facility_id)
    REFERENCES appointment_categories(id, tenant_id, facility_id),
  ADD CONSTRAINT appointments_service_scope_fk FOREIGN KEY (facility_service_id, facility_id, tenant_id)
    REFERENCES facility_services(id, facility_id, tenant_id),
  ADD CONSTRAINT appointments_replacement_scope_fk FOREIGN KEY (replacement_of_id, tenant_id, facility_id)
    REFERENCES appointments(id, tenant_id, facility_id),
  ADD CONSTRAINT appointments_priority_check CHECK (priority IS NULL OR priority IN ('Normal','Priority','Urgent'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS appointments_booking_reference_uidx ON appointments(tenant_id, facility_id, booking_reference) WHERE booking_reference IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS appointments_checkin_queue_uidx ON appointments(checkin_queue_id) WHERE checkin_queue_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS appointments_replacement_uidx ON appointments(replacement_of_id) WHERE replacement_of_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS appointments_diary_date_idx ON appointments(tenant_id, facility_id, left(scheduled_time, 10));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS appointment_events (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  appointment_id integer NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('CREATED','CHECKED_IN','CANCELLED','RESCHEDULED_FROM','RESCHEDULED_TO')),
  actor_type text NOT NULL CHECK (actor_type = 'STAFF'),
  actor_user_id integer NOT NULL REFERENCES users(id),
  from_status text,
  to_status text NOT NULL,
  reason text,
  scheduled_time_before text,
  scheduled_time_after text,
  related_appointment_id integer,
  queue_id integer REFERENCES queues(id),
  payment_state text NOT NULL DEFAULT 'NOT_ASSESSED' CHECK (payment_state = 'NOT_ASSESSED'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (appointment_id, tenant_id, facility_id) REFERENCES appointments(id, tenant_id, facility_id),
  FOREIGN KEY (related_appointment_id, tenant_id, facility_id) REFERENCES appointments(id, tenant_id, facility_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS appointment_events_scope_idx ON appointment_events(tenant_id, facility_id, appointment_id, id);
--> statement-breakpoint
CREATE FUNCTION jcare_guard_appointment_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Appointment history is append-only' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_appointment_events_guard BEFORE UPDATE OR DELETE ON appointment_events
FOR EACH ROW EXECUTE FUNCTION jcare_guard_appointment_events();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS appointment_requests (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  actor_user_id integer NOT NULL REFERENCES users(id),
  operation text NOT NULL CHECK (operation IN ('CREATE','RESCHEDULE')),
  request_key text NOT NULL,
  request_hash text NOT NULL,
  result_appointment_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(request_key) BETWEEN 8 AND 128),
  CONSTRAINT appointment_requests_scope_key_idx UNIQUE (tenant_id, facility_id, actor_user_id, operation, request_key),
  FOREIGN KEY (result_appointment_id, tenant_id, facility_id) REFERENCES appointments(id, tenant_id, facility_id)
);
