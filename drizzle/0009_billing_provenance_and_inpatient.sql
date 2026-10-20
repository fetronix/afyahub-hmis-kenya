-- ============================================================
-- 0009 — Billing provenance, inpatient transfers and nursing notes
-- ============================================================
--
-- WHY
-- ---
-- 1. Automatic tariff-driven invoicing needs two things the current
--    billing_items table lacks:
--      * provenance  (which clinical event produced this line)
--      * idempotency (so re-saving a lab order cannot double-charge)
--
-- 2. Inpatient transfers were not modelled at all: admissions.bed_id is
--    a single mutable column, so moving a patient would erase where they
--    actually stayed (and the bed-day billing basis).
--
-- 3. Nursing care had nowhere to live: admissions.nursing_notes is one
--    overwritten text column with no author, shift or timestamp.
--
-- All statements are additive and safe to re-run against a database that
-- has already been migrated, except where noted.
-- ============================================================

--> statement-breakpoint
/* ---------- 1. Billing item provenance ---------- */

ALTER TABLE billing_items ADD COLUMN IF NOT EXISTS source_type text;

--> statement-breakpoint
ALTER TABLE billing_items ADD COLUMN IF NOT EXISTS source_id integer;

--> statement-breakpoint
ALTER TABLE billing_items ADD COLUMN IF NOT EXISTS idempotency_key text;

--> statement-breakpoint
/*
 * One line per billable event.
 *
 * The partial index means rows with a NULL key (manually added items) are
 * not constrained, while every engine-generated charge is protected
 * against duplicates even under concurrent requests.
 */
CREATE UNIQUE INDEX IF NOT EXISTS billing_items_idempotency_key_unique
  ON billing_items (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS billing_items_source_idx
  ON billing_items (source_type, source_id);

--> statement-breakpoint
/* ---------- 2. Invoice lifecycle ---------- */

ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS voided_at timestamp;

--> statement-breakpoint
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS void_reason text;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS billing_invoices_facility_status_idx
  ON billing_invoices (facility_id, status);

--> statement-breakpoint
/* ---------- 2b. Concurrency-safe invoice numbering ---------- */

/*
 * Random or timestamp-based invoice numbers collide under concurrent
 * requests, and invoiceNumber is UNIQUE. A sequence gives every new
 * invoice a collision-free number even when several cashiers and
 * clinical workstations create invoices at the same moment.
 */
CREATE SEQUENCE IF NOT EXISTS billing_invoice_number_seq;

--> statement-breakpoint
/* ---------- 3. Admission discharge metadata ---------- */

ALTER TABLE admissions ADD COLUMN IF NOT EXISTS discharged_by text;

--> statement-breakpoint
/*
 * Discharge disposition: Recovered, Improved, Referred, Absconded,
 * Deceased, Against Medical Advice.
 *
 * Free text rather than an enum so facilities can record local
 * terminology without a migration.
 */
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS discharge_disposition text;

--> statement-breakpoint
/* ---------- 4. Inpatient transfers ---------- */

CREATE TABLE IF NOT EXISTS admission_transfers (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  admission_id integer NOT NULL REFERENCES admissions(id),
  patient_id integer NOT NULL REFERENCES patients(id),
  from_ward_id integer REFERENCES wards(id),
  from_bed_id integer REFERENCES beds(id),
  to_ward_id integer NOT NULL REFERENCES wards(id),
  to_bed_id integer NOT NULL REFERENCES beds(id),
  reason text,
  transferred_by text NOT NULL,
  transferred_by_user_id integer REFERENCES users(id),
  transferred_at timestamp DEFAULT now() NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS admission_transfers_admission_idx
  ON admission_transfers (admission_id, transferred_at);

--> statement-breakpoint
/* ---------- 5. Nursing notes ---------- */

CREATE TABLE IF NOT EXISTS nursing_notes (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  patient_id integer NOT NULL REFERENCES patients(id),
  admission_id integer REFERENCES admissions(id),
  encounter_id integer REFERENCES encounters(id),
  note_type text DEFAULT 'Progress' NOT NULL,
  shift text,
  note text NOT NULL,
  recorded_by text NOT NULL,
  recorded_by_user_id integer REFERENCES users(id),
  recorded_at timestamp DEFAULT now() NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS nursing_notes_admission_idx
  ON nursing_notes (admission_id, recorded_at);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS nursing_notes_patient_idx
  ON nursing_notes (patient_id, recorded_at);

--> statement-breakpoint
/* ---------- 6. Backfill existing invoice items ---------- */

/*
 * Existing manually created items keep a NULL source_type and a NULL
 * idempotency_key, so they behave exactly as before: no deduplication,
 * and they are excluded from the source-based revenue reporting until
 * they are reclassified.
 */
UPDATE billing_items
SET source_type = 'MANUAL'
WHERE source_type IS NULL;

--> statement-breakpoint
-- ============================================================
-- END OF MIGRATION 0009
-- ============================================================
