-- ============================================================
-- 0019  Tariff billing links
-- ============================================================
--
-- Why this exists.
--
-- Automatic billing finds a price by matching a code the engine looks
-- for (`OPD-CONSULT`, `LAB-CBC`) against the codes a facility typed.
-- Facilities number their tariffs instead: `OPD-001`, `LAB-006`,
-- `RAD-002`. Nothing matched, so a visit was recorded and billed
-- nothing while the facility's own price list plainly contained a
-- consultation.
--
-- Guessing would be worse than failing: `OPD-001` is 150 and `OPD-002`
-- is 300, and picking one by description would put a price on a patient
-- invoice that nobody chose.
--
-- So this column lets the facility say, once, which automatic charge a
-- tariff answers:
--
--   CONSULTATION      any outpatient consultation
--   LABORATORY        any laboratory test
--   LABORATORY:<code> one test, by catalogue code
--   RADIOLOGY         any imaging study
--   RADIOLOGY:<name>  one study, by the name it is ordered under
--   PROCEDURE         any procedure
--   PROCEDURE:<name>  one procedure
--   ADMISSION         inpatient admission
--   BED_DAY           one night in a bed
--   DELIVERY          maternity delivery
--   PHARMACY          dispensing a prescription
--
-- NULL means "not linked": the tariff still prices anything reached by
-- code, exactly as before. This migration changes no existing row.
--
-- The unique index is partial so that only *active* links compete: a
-- facility cannot have two live prices for the same automatic charge
-- (which would make the amount billed depend on row order), and
-- deactivating a tariff releases its link for another to take.
-- ============================================================

ALTER TABLE "facility_service_tariffs"
  ADD COLUMN IF NOT EXISTS "billing_key" text;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "facility_service_tariffs_billing_key_unique"
  ON "facility_service_tariffs" ("facility_id", "billing_key")
  WHERE "billing_key" IS NOT NULL AND "is_active";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "facility_service_tariffs_billing_key_idx"
  ON "facility_service_tariffs" ("facility_id", "billing_key");
