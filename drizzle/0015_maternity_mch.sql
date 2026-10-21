-- ============================================================
-- 0015  Maternity and MCH
-- ============================================================
--
-- Six tables, one story:
--
--   maternity_pregnancies  the booking, the dates, the obstetric history
--   anc_visits             one row per antenatal visit (MOH 405 card)
--   labour_records         one row per labour episode
--   partograph_entries     the partograph, as a time series of readings
--   deliveries             one row per delivery
--   delivery_babies        one row per baby born at that delivery
--
-- Why not fewer tables:
--
--   * ANC is recorded months before labour and must survive a labour that
--     never happens here — a referral, a caesarean booked elsewhere.
--     Folding it into the delivery row would lose it.
--   * The partograph is not a form, it is a series. Twelve readings in six
--     hours each need their own timestamp; a single row cannot hold them
--     and stay comparable.
--   * Twins are one delivery and two babies, so the baby is the row and the
--     delivery is the parent. `baby1_*` / `baby2_*` columns stop working at
--     the third baby and cannot be counted.
--
-- What is deliberately NOT here:
--
--   * no seeded clinical values. Every clinical column is either nullable
--     or supplied at insertion; nothing is defaulted to a plausible number.
--   * no billing. A delivery may later raise an invoice through the normal
--     billing path, but this migration does not create charges.
--   * no postnatal visits and no immunisation. Both are separate builds;
--     pretending they are covered here would be worse than leaving them out.
--
-- Additive and guarded. No existing table is read, altered or dropped.

-- ------------------------------------------------------------
-- Pregnancy
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "maternity_pregnancies" (
  "id"                 serial PRIMARY KEY,
  "tenant_id"          integer NOT NULL REFERENCES "tenants" ("id"),
  "facility_id"        integer NOT NULL REFERENCES "facilities" ("id"),
  "patient_id"         integer NOT NULL REFERENCES "patients" ("id"),

  "booked_at"          text    NOT NULL,
  "lmp_date"           text,
  "edd_date"           text    NOT NULL,
  "edd_basis"          text    NOT NULL DEFAULT 'LMP',

  "gravida"            integer,
  "para"               integer,
  "abortions"          integer,
  "living_children"    integer,

  "height_cm"          numeric(5, 1),
  "blood_group"        text,
  "rhesus"             text,
  "haemoglobin_gdl"    numeric(4, 1),

  "risk_factors"       text,

  "status"             text    NOT NULL DEFAULT 'Active',
  "closed_at"          text,
  "closed_reason"      text,

  "created_by"         integer,

  "created_at"         timestamp NOT NULL DEFAULT now(),
  "updated_at"         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "maternity_pregnancies_patient_idx"
  ON "maternity_pregnancies" ("tenant_id", "patient_id", "status");

CREATE INDEX IF NOT EXISTS "maternity_pregnancies_facility_idx"
  ON "maternity_pregnancies" ("facility_id", "status");

-- One active pregnancy per patient. Two would split the ANC history and
-- make the EDD ambiguous, so the database refuses the second.
CREATE UNIQUE INDEX IF NOT EXISTS "maternity_pregnancies_one_active_idx"
  ON "maternity_pregnancies" ("tenant_id", "patient_id")
  WHERE "status" = 'Active';

-- ------------------------------------------------------------
-- Antenatal visits
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "anc_visits" (
  "id"                     serial PRIMARY KEY,
  "tenant_id"              integer NOT NULL REFERENCES "tenants" ("id"),
  "facility_id"            integer NOT NULL REFERENCES "facilities" ("id"),
  "pregnancy_id"           integer NOT NULL REFERENCES "maternity_pregnancies" ("id"),
  "patient_id"             integer NOT NULL REFERENCES "patients" ("id"),

  "visit_date"             text    NOT NULL,
  "visit_number"           integer,

  "gestation_weeks"        integer,
  "gestation_days"         integer,

  "weight_kg"              numeric(5, 1),
  "bp_systolic"            integer,
  "bp_diastolic"           integer,
  "pulse_bpm"              integer,
  "temperature_c"          numeric(4, 1),

  "fundal_height_cm"       numeric(4, 1),
  "fetal_heart_rate_bpm"   integer,
  "presentation"           text,
  "fetal_movements"        text,

  "urine_protein"          text,
  "urine_glucose"          text,

  "haemoglobin_gdl"        numeric(4, 1),

  "tt_dose"                integer,
  "ifas_dispensed"         boolean NOT NULL DEFAULT false,

  "danger_signs"           text,
  "notes"                  text,
  "next_visit_date"        text,

  "recorded_by"            integer,

  "created_at"             timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "anc_visits_pregnancy_idx"
  ON "anc_visits" ("pregnancy_id", "visit_date");

CREATE INDEX IF NOT EXISTS "anc_visits_facility_idx"
  ON "anc_visits" ("facility_id", "visit_date");

-- ------------------------------------------------------------
-- Labour
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "labour_records" (
  "id"                             serial PRIMARY KEY,
  "tenant_id"                      integer NOT NULL REFERENCES "tenants" ("id"),
  "facility_id"                    integer NOT NULL REFERENCES "facilities" ("id"),
  "pregnancy_id"                   integer NOT NULL REFERENCES "maternity_pregnancies" ("id"),
  "patient_id"                     integer NOT NULL REFERENCES "patients" ("id"),
  "encounter_id"                   integer REFERENCES "encounters" ("id"),

  "admitted_at"                    text    NOT NULL,
  "labour_onset_at"                text,
  "membranes_ruptured_at"          text,

  "gestation_weeks_at_admission"   integer,

  "status"                         text    NOT NULL DEFAULT 'In Labour',
  "notes"                          text,

  "created_by"                     integer,

  "created_at"                     timestamp NOT NULL DEFAULT now(),
  "updated_at"                     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "labour_records_pregnancy_idx"
  ON "labour_records" ("pregnancy_id", "admitted_at");

CREATE INDEX IF NOT EXISTS "labour_records_facility_status_idx"
  ON "labour_records" ("facility_id", "status");

-- ------------------------------------------------------------
-- Partograph
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "partograph_entries" (
  "id"                        serial PRIMARY KEY,
  "tenant_id"                 integer NOT NULL REFERENCES "tenants" ("id"),
  "facility_id"               integer NOT NULL REFERENCES "facilities" ("id"),
  "labour_record_id"          integer NOT NULL REFERENCES "labour_records" ("id"),
  "patient_id"                integer NOT NULL REFERENCES "patients" ("id"),

  "recorded_at"               text    NOT NULL,

  "cervical_dilatation_cm"    numeric(4, 1),
  "descent_station"           integer,
  "contractions_per_10_min"   integer,
  "contraction_duration_sec"  integer,

  "fetal_heart_rate_bpm"      integer,

  "membranes"                 text,
  "liquor"                    text,

  "maternal_pulse_bpm"        integer,
  "bp_systolic"               integer,
  "bp_diastolic"              integer,
  "temperature_c"             numeric(4, 1),

  "oxytocin"                  text,
  "drugs_given"               text,
  "notes"                     text,

  "recorded_by"               integer,

  "created_at"                timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "partograph_entries_labour_idx"
  ON "partograph_entries" ("labour_record_id", "recorded_at");

-- Two readings at the same moment is a double entry, and on a partograph
-- it moves the plotted line. Refuse it at the database.
CREATE UNIQUE INDEX IF NOT EXISTS "partograph_entries_labour_time_idx"
  ON "partograph_entries" ("labour_record_id", "recorded_at");

-- ------------------------------------------------------------
-- Delivery
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "deliveries" (
  "id"                    serial PRIMARY KEY,
  "tenant_id"             integer NOT NULL REFERENCES "tenants" ("id"),
  "facility_id"           integer NOT NULL REFERENCES "facilities" ("id"),
  "pregnancy_id"          integer NOT NULL REFERENCES "maternity_pregnancies" ("id"),
  "labour_record_id"      integer REFERENCES "labour_records" ("id"),
  "patient_id"            integer NOT NULL REFERENCES "patients" ("id"),

  "delivered_at"          text    NOT NULL,
  "delivery_mode"         text    NOT NULL,

  "blood_loss_ml"         integer,
  "perineum"              text,

  "placenta_complete"     boolean,
  "placenta_delivered_at" text,
  "oxytocin_given"        boolean NOT NULL DEFAULT false,

  "complications"         text,
  "notes"                 text,

  "delivered_by"          integer,
  "conducted_by_cadre"    text,

  "created_at"            timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "deliveries_pregnancy_idx"
  ON "deliveries" ("pregnancy_id", "delivered_at");

CREATE INDEX IF NOT EXISTS "deliveries_facility_idx"
  ON "deliveries" ("facility_id", "delivered_at");

CREATE TABLE IF NOT EXISTS "delivery_babies" (
  "id"                 serial PRIMARY KEY,
  "tenant_id"          integer NOT NULL REFERENCES "tenants" ("id"),
  "facility_id"        integer NOT NULL REFERENCES "facilities" ("id"),
  "delivery_id"        integer NOT NULL REFERENCES "deliveries" ("id"),

  "baby_number"        integer NOT NULL,
  "sex"                text,
  "birth_weight_grams" integer,

  "apgar1"             integer,
  "apgar5"             integer,
  "apgar10"            integer,

  "outcome"            text    NOT NULL,
  "resuscitation"      text,
  "notes"              text,

  "created_at"         timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_babies_delivery_number_idx"
  ON "delivery_babies" ("delivery_id", "baby_number");
