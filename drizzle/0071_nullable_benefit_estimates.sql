-- Preserve every existing validation unchanged.  Unknown estimates must no
-- longer be manufactured as zero by the schema or application.  This metadata
-- change requires an ACCESS EXCLUSIVE table lock; review lock/maintenance and
-- take a verified backup before any authorized non-synthetic upgrade.
ALTER TABLE "insurance_benefit_validations"
  ALTER COLUMN "deductible_estimate" DROP NOT NULL,
  ALTER COLUMN "deductible_estimate" DROP DEFAULT,
  ALTER COLUMN "estimated_copay_amount" DROP NOT NULL,
  ALTER COLUMN "estimated_copay_amount" DROP DEFAULT;

-- Rollback is intentionally not automatic: SET NOT NULL must be refused while
-- nulls exist. An authorized reviewer must first resolve each such record from
-- evidence without inventing zero or overwriting historical financial data.
