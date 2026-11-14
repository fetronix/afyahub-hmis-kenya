-- Bank reconciliation: approval by a second person, and duplicate-match protection.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The reconciliation record already stored who *prepared* a reconciliation
-- (`reconciled_by_user_id`) but had no way to record a second person agreeing
-- with it. A reconciliation is the assertion "the ledger and the bank agree",
-- and an assertion nobody independent has checked is not a control. These
-- columns record that second signature, when it happened, and what they said.
--
-- Only approval columns are added. No existing column is dropped, retyped or
-- renamed, so every reconciliation written before this migration stays exactly
-- as it was and simply carries `approved_by_user_id IS NULL`.
--
-- The partial unique index prevents the same journal line being matched to two
-- different statement transactions on the same bank account. The service checks
-- this too and returns a readable error; the index exists because a check inside
-- a transaction is only as good as every writer remembering to make it, and a
-- double match is a double-count in the reconciliation.

ALTER TABLE bank_reconciliations
  ADD COLUMN IF NOT EXISTS approved_by_user_id integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamp,
  ADD COLUMN IF NOT EXISTS approval_notes text;

COMMENT ON COLUMN bank_reconciliations.approved_by_user_id IS
  'Second-person approval of the reconciliation. Must differ from reconciled_by_user_id.';
COMMENT ON COLUMN bank_reconciliations.approved_at IS
  'When the second person approved. NULL means the reconciliation is prepared but not approved.';
COMMENT ON COLUMN bank_reconciliations.approval_notes IS
  'The approver''s own words, kept separate from the preparer''s review notes.';

CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_journal_line_once_idx
  ON bank_transactions (bank_account_id, matched_journal_line_id)
  WHERE matched_journal_line_id IS NOT NULL;
