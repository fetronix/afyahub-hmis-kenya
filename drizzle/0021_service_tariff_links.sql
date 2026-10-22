-- ============================================================
-- 0021  Service → tariff links, and tariff validity
-- ============================================================
--
-- Why this exists.
--
-- Billing still resolves a service to a tariff by *string*: the
-- engine tries a list of codes (`LAB-BLOOD`, `BLOOD`, `LAB-GENERAL`)
-- and falls back to reading descriptions. Strings are a guess, and a
-- guess cannot tell you why it failed:
--
--   * the facility's tariff is `LAB-001`, and the engine asks for
--     `LAB-BLOOD` — no row will ever match;
--   * the row exists but is inactive, or outside its effective dates;
--   * the row exists at a different facility;
--   * two rows both look plausible and the first one wins by accident.
--
-- All four present identically: "no active tariff matched". This
-- migration adds what was missing — a relationship between the
-- catalogue record a clinician ordered and the price that answers it,
-- by database id.
--
-- What it adds.
--
--   1. `service_tariff_links`: one active link per catalogue service
--      (or per whole service family) per facility. `service_id` is the
--      stable id of the catalogue row — `lab_tests.id` for a test —
--      not a code that can be renamed.
--
--   2. A composite foreign key `(facility_id, tariff_id)`. A link can
--      only point at a tariff of the *same* facility. Facility
--      isolation stops being a WHERE clause someone can forget and
--      becomes a constraint the database enforces.
--
--   3. `effective_from` / `effective_to` on tariffs, so "valid for the
--      current date" is a fact about the row rather than something
--      computed at the till. Both nullable: NULL means "always".
--
--   4. `auto_bill`, defaulting to true, so a tariff can be kept for
--      manual pricing while being excluded from automatic charging.
--
-- Nothing existing is rewritten. No row is deleted, no id changes, and
-- every column added is nullable or has a default that preserves
-- today's behaviour (`auto_bill = true`, open-ended validity).
--
-- The link table is additive: a facility that makes no links keeps
-- billing exactly as it does now (code, then approved alias, then
-- description). What it gains is the ability to stop guessing.
-- ============================================================

ALTER TABLE "facility_service_tariffs"
  ADD COLUMN IF NOT EXISTS "effective_from" date;--> statement-breakpoint

ALTER TABLE "facility_service_tariffs"
  ADD COLUMN IF NOT EXISTS "effective_to" date;--> statement-breakpoint

ALTER TABLE "facility_service_tariffs"
  ADD COLUMN IF NOT EXISTS "auto_bill" boolean NOT NULL DEFAULT true;--> statement-breakpoint

-- Supports the composite foreign key below. `id` is already unique;
-- the pair is what lets the database check facility isolation.
CREATE UNIQUE INDEX IF NOT EXISTS "facility_service_tariffs_facility_id_unique"
  ON "facility_service_tariffs" ("facility_id", "id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "service_tariff_links" (
  "id" serial PRIMARY KEY,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id"),
  "facility_id" integer NOT NULL REFERENCES "facilities"("id"),

  -- 'LAB_TEST' | 'CONSULTATION' | 'RADIOLOGY' | 'PROCEDURE'
  -- 'PHARMACY' | 'ADMISSION' | 'BED_DAY' | 'DELIVERY'
  "service_type" text NOT NULL,

  -- The catalogue row this link is for: `lab_tests.id` for a test.
  -- NULL means "every service of this type" — the family fallback.
  "service_id" integer,

  -- Snapshot of the catalogue code at link time, for diagnosis and for
  -- saying what a link was about after a catalogue row is renamed.
  "service_code" text,
  "service_name" text,

  "tariff_id" integer NOT NULL,

  -- A link can exist and still be excluded from automatic charging.
  "auto_bill" boolean NOT NULL DEFAULT true,

  "note" text,
  "created_by" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),

  CONSTRAINT "service_tariff_links_service_type_check"
    CHECK ("service_type" IN (
      'LAB_TEST', 'CONSULTATION', 'RADIOLOGY',
      'PROCEDURE', 'PHARMACY', 'ADMISSION', 'BED_DAY', 'DELIVERY'
    )),

  -- The price must belong to the same facility as the service.
  CONSTRAINT "service_tariff_links_tariff_facility_fk"
    FOREIGN KEY ("facility_id", "tariff_id")
    REFERENCES "facility_service_tariffs" ("facility_id", "id")
    ON DELETE RESTRICT
);--> statement-breakpoint

-- One active link per catalogue service; deactivating frees the slot.
CREATE UNIQUE INDEX IF NOT EXISTS "service_tariff_links_service_unique"
  ON "service_tariff_links" ("facility_id", "service_type", "service_id")
  WHERE "is_active" AND "service_id" IS NOT NULL;--> statement-breakpoint

-- One active family-wide link per service type.
CREATE UNIQUE INDEX IF NOT EXISTS "service_tariff_links_family_unique"
  ON "service_tariff_links" ("facility_id", "service_type")
  WHERE "is_active" AND "service_id" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "service_tariff_links_facility_idx"
  ON "service_tariff_links" ("tenant_id", "facility_id", "service_type");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "service_tariff_links_tariff_idx"
  ON "service_tariff_links" ("tariff_id");
