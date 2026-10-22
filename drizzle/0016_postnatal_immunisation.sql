-- ============================================================
-- 0016  Postnatal care and immunisation
-- ============================================================
--
-- Two tables that finish the MCH pathway started in 0015:
--
--   postnatal_visits       the mother's contacts after delivery, with the
--                          baby's weight noted on the same row
--   immunisation_records   one row per dose actually administered
--
-- Design notes:
--
--   * Postnatal visits hang off the pregnancy, not the delivery, because
--     a woman who delivered elsewhere still attends here for her
--     six-week check. `delivery_id` is set only when that delivery is
--     recorded in this system.
--
--   * The immunisation schedule is NOT stored here. The table records
--     what was given and when; the schedule (which antigen is due at
--     which age) lives in `src/immunisation/immunisation-contracts.ts`
--     so that revising the schedule does not rewrite clinical history.
--
--   * `immunisation_records_dose_idx` is the safety property that a paper
--     card cannot provide: the same antigen at the same dose number
--     cannot be recorded twice for the same child.
--
-- Additive and guarded. No existing table is read, altered or dropped.

-- ------------------------------------------------------------
-- Postnatal care
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "postnatal_visits" (
  "id"               serial PRIMARY KEY,
  "tenant_id"        integer NOT NULL REFERENCES "tenants" ("id"),
  "facility_id"      integer NOT NULL REFERENCES "facilities" ("id"),
  "patient_id"       integer NOT NULL REFERENCES "patients" ("id"),
  "pregnancy_id"     integer NOT NULL REFERENCES "maternity_pregnancies" ("id"),
  "delivery_id"      integer REFERENCES "deliveries" ("id"),

  "visit_date"       text    NOT NULL,
  "visit_number"     integer,
  "day_postpartum"   integer,

  "bp_systolic"      integer,
  "bp_diastolic"     integer,
  "pulse_bpm"        integer,
  "temperature_c"    numeric(4, 1),

  "fundal_height_cm" numeric(4, 1),
  "involution"       text,
  "lochia"           text,
  "perineum"         text,
  "breasts"          text,
  "breastfeeding"    text,
  "mood_screening"   text,

  "haemoglobin_gdl"  numeric(4, 1),

  "danger_signs"     text,
  "notes"            text,
  "next_visit_date"  text,

  "baby_weight_grams" integer,
  "baby_notes"        text,

  "recorded_by"      integer,

  "created_at"       timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "postnatal_visits_pregnancy_idx"
  ON "postnatal_visits" ("pregnancy_id", "visit_date");

CREATE INDEX IF NOT EXISTS "postnatal_visits_facility_idx"
  ON "postnatal_visits" ("facility_id", "visit_date");

-- ------------------------------------------------------------
-- Immunisation
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "immunisation_records" (
  "id"               serial PRIMARY KEY,
  "tenant_id"        integer NOT NULL REFERENCES "tenants" ("id"),
  "facility_id"      integer NOT NULL REFERENCES "facilities" ("id"),
  "patient_id"       integer NOT NULL REFERENCES "patients" ("id"),
  "delivery_id"      integer REFERENCES "deliveries" ("id"),
  "delivery_baby_id" integer REFERENCES "delivery_babies" ("id"),
  "pregnancy_id"     integer REFERENCES "maternity_pregnancies" ("id"),

  "antigen_code"     text    NOT NULL,
  "dose_number"      integer NOT NULL DEFAULT 1,

  "administered_on"  text    NOT NULL,

  "batch_number"     text,
  "site"             text,
  "route"            text,

  "administered_by"  integer,
  "notes"            text,

  "created_at"       timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "immunisation_records_patient_idx"
  ON "immunisation_records" ("tenant_id", "patient_id", "administered_on");

CREATE INDEX IF NOT EXISTS "immunisation_records_facility_idx"
  ON "immunisation_records" ("facility_id", "administered_on");

-- The same antigen at the same dose number, twice, is a double
-- administration. Refuse it at the database.
CREATE UNIQUE INDEX IF NOT EXISTS "immunisation_records_dose_idx"
  ON "immunisation_records" ("tenant_id", "patient_id", "antigen_code", "dose_number");
