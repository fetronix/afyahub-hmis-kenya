-- Additive scope integrity only: no journal, account or financial history is
-- rewritten. Existing posted scope mismatches must be investigated, never
-- silently adopted or repaired by a migration. Application traffic should be
-- quiesced for a reviewed production upgrade; these locks block ledger writes.
LOCK TABLE chart_of_accounts, journal_entries, journal_lines IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname IN
      ('jcare_account_scope_immutable','jcare_journal_scope_immutable','jcare_journal_post_scope_guard')
  ) OR EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND NOT t.tgisinternal AND t.tgname IN
      ('jcare_account_scope_immutable','jcare_journal_scope_immutable','jcare_journal_post_scope_guard')
  ) THEN
    RAISE EXCEPTION 'Unexpected journal scope guard objects; review migration state';
  END IF;
  IF EXISTS (
    SELECT 1 FROM journal_entries j
    JOIN journal_lines l ON l.journal_entry_id=j.id
    JOIN chart_of_accounts a ON a.id=l.account_id
    WHERE j.status='POSTED'
      AND (j.tenant_id,j.facility_id) IS DISTINCT FROM (a.tenant_id,a.facility_id)
  ) THEN
    RAISE EXCEPTION 'Posted journal account scope mismatch; finance review required before migration';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION jcare_account_scope_immutable() RETURNS trigger AS $$
BEGIN
  IF (NEW.tenant_id,NEW.facility_id) IS DISTINCT FROM (OLD.tenant_id,OLD.facility_id) THEN
    RAISE EXCEPTION 'An account cannot be moved between tenants or facilities' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER jcare_account_scope_immutable BEFORE UPDATE OF tenant_id,facility_id ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION jcare_account_scope_immutable();
--> statement-breakpoint
CREATE FUNCTION jcare_journal_scope_immutable() RETURNS trigger AS $$
BEGIN
  IF (NEW.tenant_id,NEW.facility_id) IS DISTINCT FROM (OLD.tenant_id,OLD.facility_id) THEN
    RAISE EXCEPTION 'A journal cannot be moved between tenants or facilities' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER jcare_journal_scope_immutable BEFORE UPDATE OF tenant_id,facility_id ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION jcare_journal_scope_immutable();
--> statement-breakpoint
CREATE FUNCTION jcare_journal_post_scope_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status='POSTED' AND OLD.status IS DISTINCT FROM 'POSTED' THEN
    -- Serialize account changes with the final validation; the service also
    -- locks its accounts before creating a draft and posting in one transaction.
    PERFORM a.id FROM chart_of_accounts a JOIN journal_lines l ON l.account_id=a.id
      WHERE l.journal_entry_id=NEW.id ORDER BY a.id FOR SHARE OF a;
    IF EXISTS (
      SELECT 1 FROM journal_lines l LEFT JOIN chart_of_accounts a ON a.id=l.account_id
      WHERE l.journal_entry_id=NEW.id AND
        (a.id IS NULL OR NOT a.is_active OR
         (a.tenant_id,a.facility_id) IS DISTINCT FROM (NEW.tenant_id,NEW.facility_id))
    ) THEN
      RAISE EXCEPTION 'Posted journal accounts must be active and in the journal facility' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER jcare_journal_post_scope_guard BEFORE UPDATE OF status ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION jcare_journal_post_scope_guard();
