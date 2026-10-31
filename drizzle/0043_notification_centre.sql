-- Additive only. Existing facilities inherit their tenant's configured zone when NULL.
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS timezone text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS notification_alert_states (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  source_key text NOT NULL,
  fingerprint text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  active boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_alert_states_scope_key UNIQUE (tenant_id, facility_id, source_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notification_alert_states_active_idx ON notification_alert_states(tenant_id, facility_id, active);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS notification_read_receipts (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  user_id integer NOT NULL REFERENCES users(id),
  notification_key text NOT NULL CHECK (length(notification_key) <= 200),
  read_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_read_receipts_user_key UNIQUE (tenant_id, facility_id, user_id, notification_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notification_read_receipts_lookup_idx ON notification_read_receipts(tenant_id, facility_id, user_id);
