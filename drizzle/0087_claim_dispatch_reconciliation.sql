-- 0087 — a claim whose dispatch outcome is unknown can be reconciled against
-- the payer record, by an authorised human, with evidence.
--
-- Before this migration a single lost HTTP response permanently blocked a
-- claim: insurance_claim_dispatch_guards kept a row whose state became
-- 'UNCERTAIN', and every submit/resubmit/refresh/adjudicate path threw
-- CLAIM_DISPATCH_REVIEW_REQUIRED forever. There was no route, permission or
-- service that could read or clear that row, and the error told the user to
-- "review the payer record" with nothing to review it with.
--
-- This adds a permanent, append-only record of each reconciliation check. The
-- guard row is deleted only inside the same transaction that writes this record
-- (and only when a human has stated what the payer's record shows), so the
-- history of the ambiguous dispatch survives the guard. Nothing here calls a
-- payer; the outcome is recorded evidence, not a provider response.
--
-- outcome is constrained to the three honest answers a reviewer can give:
--   PAYER_CONFIRMED_RECEIVED     — the payer has the claim (reference required)
--   PAYER_CONFIRMED_NOT_RECEIVED — the payer has no record; a new attempt is allowed
--   STILL_UNRESOLVED             — checked, still unknown; the block remains
--
-- A 'STILL_UNRESOLVED' row does not release the guard. That is deliberate: an
-- unresolved check must not become a back door to a blind retry.

CREATE TABLE IF NOT EXISTS insurance_claim_dispatch_reconciliations (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  workflow text NOT NULL,
  claim_id integer NOT NULL,
  guard_id integer NOT NULL,
  correlation_id text NOT NULL,
  attempt_number integer NOT NULL,
  guard_state_at_check text NOT NULL,
  outcome text NOT NULL,
  payer_reference text,
  evidence_note text NOT NULL,
  reconciled_by_user_id integer REFERENCES users(id),
  created_at timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE insurance_claim_dispatch_reconciliations
  DROP CONSTRAINT IF EXISTS insurance_claim_dispatch_reconciliations_outcome_check;
--> statement-breakpoint
ALTER TABLE insurance_claim_dispatch_reconciliations
  ADD CONSTRAINT insurance_claim_dispatch_reconciliations_outcome_check
  CHECK (outcome IN ('PAYER_CONFIRMED_RECEIVED', 'PAYER_CONFIRMED_NOT_RECEIVED', 'STILL_UNRESOLVED'));
--> statement-breakpoint
ALTER TABLE insurance_claim_dispatch_reconciliations
  DROP CONSTRAINT IF EXISTS insurance_claim_dispatch_reconciliations_received_reference_check;
--> statement-breakpoint
ALTER TABLE insurance_claim_dispatch_reconciliations
  ADD CONSTRAINT insurance_claim_dispatch_reconciliations_received_reference_check
  CHECK (
    outcome <> 'PAYER_CONFIRMED_RECEIVED'
    OR (payer_reference IS NOT NULL AND length(btrim(payer_reference)) >= 3)
  );
--> statement-breakpoint
ALTER TABLE insurance_claim_dispatch_reconciliations
  DROP CONSTRAINT IF EXISTS insurance_claim_dispatch_reconciliations_note_check;
--> statement-breakpoint
ALTER TABLE insurance_claim_dispatch_reconciliations
  ADD CONSTRAINT insurance_claim_dispatch_reconciliations_note_check
  CHECK (length(btrim(evidence_note)) >= 10);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS insurance_claim_dispatch_reconciliations_claim_idx
  ON insurance_claim_dispatch_reconciliations (tenant_id, facility_id, workflow, claim_id);
--> statement-breakpoint
-- The review queue filters by facility and state; without this it is a sequential
-- scan of every guard in the deployment.
CREATE INDEX IF NOT EXISTS insurance_claim_dispatch_guards_facility_state_idx
  ON insurance_claim_dispatch_guards (tenant_id, facility_id, workflow, state);
