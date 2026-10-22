-- ============================================================
-- 0017  Consent, allergies, and an append-only audit log
-- ============================================================
--
-- Three gaps closed here, in order of seriousness:
--
--   1. AUDIT INTEGRITY. `audit_logs` had no database-level
--      protection. No application route updates or deletes it, but a
--      database user could. A trigger now refuses UPDATE, DELETE and
--      TRUNCATE, and the privileges are revoked. An audit trail that
--      can be rewritten is not an audit trail.
--
--   2. ALLERGIES. `patients.allergies` was a free-text field nobody
--      wrote to. A prescribing system that cannot say "this patient
--      reacted to penicillin" cannot warn anyone. `patient_allergies`
--      records the allergen, the reaction, the severity, who recorded
--      it, and keeps resolved entries rather than deleting them.
--
--   3. ENCRYPTED IDENTIFIERS. Two blind-index columns make
--      `national_id` and `sha_number` searchable by exact value while
--      their content is sealed with AES-256-GCM.
--
-- Nothing here deletes data. The trigger is additive; the new table is
-- additive; the new columns are nullable.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Append-only audit log
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION jalicare_audit_is_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;--> statement-breakpoint

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION jalicare_audit_is_append_only();--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;--> statement-breakpoint

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION jalicare_audit_is_append_only();--> statement-breakpoint

-- A table trigger does not stop TRUNCATE, which is why the statement
-- trigger above exists as well. Revoking the privileges is belt and
-- braces for the roles that do not own the table.

REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;--> statement-breakpoint

-- ------------------------------------------------------------
-- 2. Patient allergy registry
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS patient_allergies (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  patient_id integer NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  allergen_type text NOT NULL DEFAULT 'DRUG',
  allergen text NOT NULL,
  reaction text,
  severity text NOT NULL DEFAULT 'MODERATE',
  status text NOT NULL DEFAULT 'ACTIVE',
  notes text,
  recorded_by_user_id integer REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_allergies_patient_idx
  ON patient_allergies (patient_id, status);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_allergies_tenant_idx
  ON patient_allergies (tenant_id);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patient_allergies_facility_idx
  ON patient_allergies (facility_id);--> statement-breakpoint

-- ------------------------------------------------------------
-- 3. Blind indexes for sealed identifiers
-- ------------------------------------------------------------

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS national_id_bidx text;--> statement-breakpoint

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS sha_number_bidx text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patients_national_id_bidx_idx
  ON patients (national_id_bidx)
  WHERE national_id_bidx IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patients_sha_number_bidx_idx
  ON patients (sha_number_bidx)
  WHERE sha_number_bidx IS NOT NULL;--> statement-breakpoint
