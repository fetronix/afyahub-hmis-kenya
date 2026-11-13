-- 0088 — a claim records the frozen invoice it was built from.
--
-- Before this migration an insurance claim could be prepared from any invoice
-- the facility owned: a draft whose lines were still being added, or one that
-- had since been voided. Nothing on the claim said which version of the invoice
-- the payer had been asked to adjudicate, so a later edit or credit note could
-- change the story underneath a submitted claim.
--
-- Invoice finalization already freezes the invoice and writes a snapshot. These
-- columns copy that snapshot onto the claim at preparation time:
--
--   invoice_finalized_at — when the invoice basis was frozen
--   invoice_snapshot     — the snapshot itself, verbatim
--
-- Both are nullable on purpose. Historical claim rows (if any) predate this
-- record and cannot be given one retrospectively without inventing data, so they
-- stay NULL and are reported as "unverifiable basis" rather than backfilled.
-- New claims are written by claim preparation, which refuses to run without a
-- finalization record.

ALTER TABLE sha_eclaims
  ADD COLUMN IF NOT EXISTS invoice_finalized_at timestamp,
  ADD COLUMN IF NOT EXISTS invoice_snapshot jsonb;

ALTER TABLE private_insurance_claims
  ADD COLUMN IF NOT EXISTS invoice_finalized_at timestamp,
  ADD COLUMN IF NOT EXISTS invoice_snapshot jsonb;

COMMENT ON COLUMN sha_eclaims.invoice_snapshot IS
  'Invoice snapshot copied from billing_invoice_finalizations at claim preparation. NULL on rows created before migration 0088.';
COMMENT ON COLUMN private_insurance_claims.invoice_snapshot IS
  'Invoice snapshot copied from billing_invoice_finalizations at claim preparation. NULL on rows created before migration 0088.';

-- A claim that records a frozen basis must record it completely; a half-written
-- pair would let a report claim "has a snapshot" without one.
ALTER TABLE sha_eclaims
  DROP CONSTRAINT IF EXISTS sha_eclaims_invoice_basis_complete;
ALTER TABLE sha_eclaims
  ADD CONSTRAINT sha_eclaims_invoice_basis_complete
  CHECK (
    (invoice_finalized_at IS NULL AND invoice_snapshot IS NULL)
    OR (invoice_finalized_at IS NOT NULL AND invoice_snapshot IS NOT NULL)
  );

ALTER TABLE private_insurance_claims
  DROP CONSTRAINT IF EXISTS private_insurance_claims_invoice_basis_complete;
ALTER TABLE private_insurance_claims
  ADD CONSTRAINT private_insurance_claims_invoice_basis_complete
  CHECK (
    (invoice_finalized_at IS NULL AND invoice_snapshot IS NULL)
    OR (invoice_finalized_at IS NOT NULL AND invoice_snapshot IS NOT NULL)
  );
