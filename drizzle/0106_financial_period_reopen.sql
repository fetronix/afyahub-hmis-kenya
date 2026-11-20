/*
 * Syrona Medical Center HMIS — authorised reopening of a closed financial period.
 *
 * 0027 made a closed period immutable: no UPDATE at all is permitted once the
 * status leaves OPEN. That is the right default — a period that is silently
 * edited after being closed destroys the meaning of every figure reported for
 * it. It also means the "reopen with a reason, audit it, then post an
 * adjustment" workflow required of an accounting module cannot exist at all,
 * because the transition CLOSED -> OPEN is itself an UPDATE.
 *
 * This migration keeps the lock and adds exactly one key to it. The guard now
 * permits the CLOSED -> OPEN transition only when the transaction has declared
 * the specific period it is reopening, through a transaction-local setting
 * (jcare.period_reopen = <period id>). Anything else — a different period, a
 * fresh session without the setting, a change to dates or scope, a second
 * concurrent reopen — still fails closed with the original error.
 *
 * Financial scope and dates remain immutable, periods may not overlap, and the
 * advisory lock on the facility is unchanged, so the concurrency guarantees of
 * 0027 are preserved.
 *
 * The application sets the key inside the same transaction that writes the
 * audit row, and the setting is local to that transaction (set_config with
 * is_local = true), so it cannot leak into a later statement.
 */

CREATE OR REPLACE FUNCTION "syrona_financial_period_guard"() RETURNS trigger AS $$
DECLARE
  reopening_period text := current_setting('jcare.period_reopen', true);
BEGIN
  PERFORM pg_advisory_xact_lock(146907, NEW.facility_id);

  IF TG_OP = 'UPDATE' AND OLD.status <> 'OPEN' THEN
    IF NOT (
      OLD.status = 'CLOSED'
      AND NEW.status = 'OPEN'
      AND reopening_period IS NOT NULL
      AND reopening_period = OLD.id::text
    ) THEN
      RAISE EXCEPTION 'Closed financial periods cannot be changed' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND (OLD.facility_id <> NEW.facility_id OR OLD.tenant_id <> NEW.tenant_id
      OR OLD.start_date <> NEW.start_date OR OLD.end_date <> NEW.end_date OR OLD.period_code <> NEW.period_code) THEN
    RAISE EXCEPTION 'Financial period scope and dates are immutable' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM financial_periods p
     WHERE p.facility_id = NEW.facility_id AND p.id <> NEW.id
       AND p.start_date <= NEW.end_date AND p.end_date >= NEW.start_date
  ) THEN
    RAISE EXCEPTION 'Financial periods may not overlap' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
