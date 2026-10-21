-- 0012 — DHA / AfyaConnect integration audit
--
-- Every outbound call to the national exchange is recorded so an
-- administrator can answer "what did this system send, when, and did it
-- work" without reading a log file.
--
-- Deliberately absent: request bodies, response bodies, access tokens,
-- patient identifiers and clinical payloads. Only the operation, the
-- templated path, the HTTP status and timing are stored.

CREATE TABLE IF NOT EXISTS "dha_api_calls" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer,
  "facility_id" integer,
  "user_id" integer,
  "mode" text NOT NULL,
  "operation" text NOT NULL,
  "method" text NOT NULL,
  "path" text NOT NULL,
  "status" integer,
  "duration_ms" integer NOT NULL DEFAULT 0,
  "outcome" text NOT NULL,
  "error_code" text,
  "request_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "dha_api_calls_facility_idx"
  ON "dha_api_calls" ("facility_id", "created_at");

CREATE INDEX IF NOT EXISTS "dha_api_calls_operation_idx"
  ON "dha_api_calls" ("operation", "created_at");

-- The Client Registry id SHA works in. Separate from sha_number, which is
-- the member number printed on a card; the CR id is what every eligibility
-- and claim call expects as patient_id.
ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "dha_client_registry_id" text;

-- Minimal, non-demographic cache of the last eligibility result so a
-- clinician does not have to re-check on every screen.
ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "dha_eligibility_status" text;

ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "dha_eligibility_checked_at" timestamp;

ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "dha_eligibility_schemes" jsonb;
