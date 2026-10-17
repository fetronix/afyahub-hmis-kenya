CREATE TABLE IF NOT EXISTS "facility_role_permission_overrides" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "role_id" integer NOT NULL REFERENCES "roles"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "facility_role_permission_overrides_facility_role_idx"
  ON "facility_role_permission_overrides" ("facility_id", "role_id");

CREATE INDEX IF NOT EXISTS "facility_role_permission_overrides_tenant_facility_idx"
  ON "facility_role_permission_overrides" ("tenant_id", "facility_id");

CREATE TABLE IF NOT EXISTS "facility_role_permission_override_permissions" (
  "id" serial PRIMARY KEY NOT NULL,
  "override_id" integer NOT NULL
    REFERENCES "facility_role_permission_overrides"("id") ON DELETE CASCADE,
  "permission_id" integer NOT NULL REFERENCES "permissions"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "facility_role_permission_override_permissions_override_permission_idx"
  ON "facility_role_permission_override_permissions" ("override_id", "permission_id");