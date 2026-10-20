ALTER TABLE lab_results
  ALTER COLUMN verified_at DROP NOT NULL;

ALTER TABLE lab_results
  ADD COLUMN status text NOT NULL DEFAULT 'Pending Verification';

UPDATE lab_results
SET status = CASE
  WHEN verified_by IS NOT NULL AND btrim(verified_by) <> ''
    THEN 'Verified'
  ELSE 'Pending Verification'
END;

UPDATE lab_results
SET verified_at = NULL
WHERE verified_by IS NULL OR btrim(verified_by) = '';

ALTER TABLE lab_results
  ALTER COLUMN verified_at DROP DEFAULT;
