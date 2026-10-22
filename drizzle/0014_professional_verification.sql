-- ============================================================
-- 0014  Professional credential verification (Health Worker Registry)
-- ============================================================
--
-- Retains the minimum needed to answer, months later, who was checked,
-- against which regulator, what the answer was, and who accepted it.
--
-- Deliberate omissions:
--   * no national ID, no date of birth, no contact details. The registry
--     lookup may use a national ID, but only the registration number and
--     the returned record reference are kept.
--   * no full response body. Only the fields the workflow reasoned about
--     are stored, plus the names of any unrecognised keys.
--
-- Registration status and licence status are separate columns because
-- they are separate facts. A live registration is not a licence.
--
-- Additive and guarded. No existing row is read, updated or removed.

CREATE TABLE IF NOT EXISTS "staff_professional_credentials" (
  "id"                    serial PRIMARY KEY,
  "tenant_id"             integer NOT NULL,
  "facility_id"           integer NOT NULL,
  "user_id"               integer,
  "invitation_id"         integer,
  "regulator"             text    NOT NULL,
  "registration_number"   text    NOT NULL,
  "licence_number"        text,
  "professional_category" text,
  "specialty"             text,
  "status"                text    NOT NULL DEFAULT 'NOT_VERIFIED',
  "registration_status"   text,
  "licence_status"        text,
  "licence_expiry"        date,
  "last_verified_at"      timestamp,
  "verification_source"   text,
  "external_reference"    text,
  "response_reference"    text,
  "mode"                  text,
  "verified_by"           integer,
  "manual_review_reason"  text,
  "manual_source"         text,
  "manual_checked_at"     timestamp,
  "warnings"              jsonb,
  "matched_fields"        jsonb,
  "created_at"            timestamp NOT NULL DEFAULT now(),
  "updated_at"            timestamp NOT NULL DEFAULT now()
);

-- One credential per regulator registration per facility. Two staff rows
-- cannot both claim the same registration number at the same facility.
CREATE UNIQUE INDEX IF NOT EXISTS "staff_professional_credentials_facility_registration_idx"
  ON "staff_professional_credentials" ("facility_id", "regulator", "registration_number");

CREATE INDEX IF NOT EXISTS "staff_professional_credentials_facility_status_idx"
  ON "staff_professional_credentials" ("facility_id", "status");

CREATE INDEX IF NOT EXISTS "staff_professional_credentials_user_idx"
  ON "staff_professional_credentials" ("user_id");

CREATE INDEX IF NOT EXISTS "staff_professional_credentials_expiry_idx"
  ON "staff_professional_credentials" ("licence_expiry");

CREATE TABLE IF NOT EXISTS "professional_verification_events" (
  "id"            serial PRIMARY KEY,
  "tenant_id"     integer NOT NULL,
  "facility_id"   integer NOT NULL,
  "credential_id" integer,
  "user_id"       integer,
  "invitation_id" integer,
  "action"        text    NOT NULL,
  "status_before" text,
  "status_after"  text,
  "source"        text,
  "mode"          text,
  "http_status"   integer,
  "error_code"    text,
  "performed_by"  integer,
  "notes"         text,
  "created_at"    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "professional_verification_events_credential_idx"
  ON "professional_verification_events" ("credential_id");

CREATE INDEX IF NOT EXISTS "professional_verification_events_facility_idx"
  ON "professional_verification_events" ("facility_id", "created_at");

COMMENT ON TABLE "staff_professional_credentials" IS
  'Professional registration as verified against a regulator source. Credential status is independent of employment status and assigned roles.';

COMMENT ON COLUMN "staff_professional_credentials"."status" IS
  'One of the verification statuses in practitioner.contracts.ts. REGISTRATION_VERIFIED does not imply a current licence.';

COMMENT ON COLUMN "staff_professional_credentials"."mode" IS
  'mock | sandbox | production | manual. mock means simulated and must never be presented as a real check.';
