-- ============================================================
-- 0020  Billing charge attempts
-- ============================================================
--
-- Why this exists.
--
-- When a tariff cannot be found, the charge is skipped. The clinical
-- action still succeeds (a visit is recorded, a test is ordered), but
-- the invoice line does not exist. Today that skip is returned to the
-- caller, shown once, and then forgotten: nothing records that money
-- is owed and was not billed, and nothing can bill it after the
-- facility fixes its price list.
--
-- This table is that record. One row per charge the engine could not
-- price, holding exactly enough of the original request to replay it
-- once a tariff exists:
--
--   * the codes the engine tried, so the screen can say what to add
--   * the link keys the facility would set ("CONSULTATION")
--   * the service and encounter type, for the description rule
--   * the clinical source (encounter, lab order, admission) so the
--     invoice line stays attached to the thing that caused it
--
-- Replay runs through the ordinary charge path, so the ordinary
-- idempotency key still applies: a charge that was retried twice
-- cannot produce two invoice lines, and a charge that succeeded before
-- the retry is recorded as DUPLICATE rather than billed again.
--
-- Status
--   PENDING    still owed, waiting for the facility to configure it
--   BILLED     a later attempt produced an invoice line
--   DUPLICATE  an invoice line already existed; nothing new needed
--   VOID       deliberately written off by the facility
--
-- The partial unique index keeps one open attempt per clinical source
-- per charge type. A second failed attempt on the same encounter does
-- not add a second row to chase; it bumps `attempts` so the screen can
-- show how often the visit tried to bill.
-- ============================================================

CREATE TABLE IF NOT EXISTS "billing_charge_attempts" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),
  "patient_id" integer NOT NULL REFERENCES "patients"("id"),
  "encounter_id" integer,
  "source_type" text NOT NULL,
  "source_id" integer,
  "item_type" text NOT NULL,
  "description" text,
  "codes" text[] NOT NULL DEFAULT '{}',
  "service_keys" text[] NOT NULL DEFAULT '{}',
  "family" text,
  "service_name" text,
  "encounter_type" text,
  "aliases" text[] NOT NULL DEFAULT '{}',
  "quantity" integer NOT NULL DEFAULT 1,
  "fallback_unit_price" numeric(10, 2),
  "reason" text NOT NULL,
  "detail" text,
  "codes_tried" text[] NOT NULL DEFAULT '{}',
  "status" text NOT NULL DEFAULT 'PENDING',
  "attempts" integer NOT NULL DEFAULT 1,
  "last_attempt_at" timestamp NOT NULL DEFAULT now(),
  "resolved_item_id" integer,
  "resolved_invoice_id" integer,
  "resolved_tariff_code" text,
  "resolved_unit_price" numeric(10, 2),
  "resolved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "billing_charge_attempts_pending_unique"
  ON "billing_charge_attempts" ("facility_id", "source_type", "source_id", "item_type")
  WHERE "status" = 'PENDING' AND "source_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "billing_charge_attempts_facility_status_idx"
  ON "billing_charge_attempts" ("tenant_id", "facility_id", "status");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "billing_charge_attempts_patient_idx"
  ON "billing_charge_attempts" ("patient_id");
