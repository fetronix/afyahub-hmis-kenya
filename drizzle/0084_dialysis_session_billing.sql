-- 0084 — dialysis sessions reach the ledger.
--
-- Dialysis sessions completed as UNBILLED and nothing ever billed them: there
-- was no billing family, no tariff link and no charge source. Revenue for every
-- completed session was silently lost while the clinical record looked fine.
--
-- The treatment plan names the facility service being delivered, so the charge
-- resolves through the ordinary facility tariff machinery rather than a new
-- pricing path.

ALTER TABLE dialysis_treatment_plans
  ADD COLUMN IF NOT EXISTS facility_service_id integer REFERENCES facility_services(id);

CREATE INDEX IF NOT EXISTS dialysis_treatment_plans_service_idx
  ON dialysis_treatment_plans (facility_service_id)
  WHERE facility_service_id IS NOT NULL;

-- A session can be billed at most once. The claim table already guarantees this
-- through its identity key; this makes the invariant explicit in the schema and
-- prevents two billing rows pointing at the same session.
CREATE UNIQUE INDEX IF NOT EXISTS billing_items_dialysis_session_once_idx
  ON billing_items (source_id)
  WHERE source_type = 'DIALYSIS';
