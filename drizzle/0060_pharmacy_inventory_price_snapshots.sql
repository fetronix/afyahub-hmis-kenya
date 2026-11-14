-- New dispensations snapshot the selected facility inventory product and its
-- positive selling price while the stock row is locked. NULL means unknown or
-- unconfigured, not a free medicine. Historical records are not repriced.
ALTER TABLE pharmacy_dispensations
  ADD COLUMN IF NOT EXISTS selling_price_snapshot numeric(10,2),
  ADD COLUMN IF NOT EXISTS item_code_snapshot text,
  ADD COLUMN IF NOT EXISTS item_name_snapshot text,
  ADD COLUMN IF NOT EXISTS item_unit_snapshot text,
  ADD COLUMN IF NOT EXISTS dispensing_date_snapshot date,
  ADD COLUMN IF NOT EXISTS dispensing_timezone_snapshot text;
--> statement-breakpoint
ALTER TABLE pharmacy_dispensations
  ADD CONSTRAINT pharmacy_dispensations_snapshot_price_check
    CHECK (selling_price_snapshot IS NULL OR selling_price_snapshot > 0);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_id_facility_scope_idx ON inventory_items (id, facility_id);
--> statement-breakpoint
-- Enforce scope for new or modified rows without claiming old rows are clean.
ALTER TABLE pharmacy_dispensations
  ADD CONSTRAINT pharmacy_dispensations_inventory_scope_fk
    FOREIGN KEY (item_id, facility_id) REFERENCES inventory_items (id, facility_id) NOT VALID,
  ADD CONSTRAINT pharmacy_dispensations_facility_scope_fk
    FOREIGN KEY (facility_id, tenant_id) REFERENCES facilities (id, tenant_id) NOT VALID;
--> statement-breakpoint
ALTER TABLE billing_items
  ADD COLUMN IF NOT EXISTS inventory_item_id integer REFERENCES inventory_items(id),
  ADD COLUMN IF NOT EXISTS prescription_id integer REFERENCES medications(id),
  ADD COLUMN IF NOT EXISTS pharmacy_stock_tracking text,
  ADD COLUMN IF NOT EXISTS pharmacy_batch_allocations jsonb;
--> statement-breakpoint
-- A change to an inventory item must never reprice or relabel a dispensation.
-- Legacy NULL snapshots are deliberately immutable too; correcting them needs
-- a separately authorized, evidence-based financial correction workflow.
CREATE FUNCTION jcare_guard_pharmacy_price_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
    OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
    OR NEW.prescription_id IS DISTINCT FROM OLD.prescription_id
    OR NEW.item_id IS DISTINCT FROM OLD.item_id
    OR NEW.quantity_dispensed IS DISTINCT FROM OLD.quantity_dispensed
    OR NEW.batch_number IS DISTINCT FROM OLD.batch_number
    OR NEW.dispensed_at IS DISTINCT FROM OLD.dispensed_at
    OR NEW.selling_price_snapshot IS DISTINCT FROM OLD.selling_price_snapshot
    OR NEW.item_code_snapshot IS DISTINCT FROM OLD.item_code_snapshot
    OR NEW.item_name_snapshot IS DISTINCT FROM OLD.item_name_snapshot
    OR NEW.item_unit_snapshot IS DISTINCT FROM OLD.item_unit_snapshot
    OR NEW.dispensing_date_snapshot IS DISTINCT FROM OLD.dispensing_date_snapshot
    OR NEW.dispensing_timezone_snapshot IS DISTINCT FROM OLD.dispensing_timezone_snapshot THEN
    RAISE EXCEPTION 'Dispensing price and product snapshots are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_pharmacy_price_snapshot_immutable
BEFORE UPDATE ON pharmacy_dispensations FOR EACH ROW EXECUTE FUNCTION jcare_guard_pharmacy_price_snapshot();
--> statement-breakpoint
-- Prevent the newly captured per-lot and retry evidence from being silently
-- rewritten after stock commits. Older rows remain untouched by migration.
CREATE FUNCTION jcare_guard_pharmacy_workflow_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pharmacy_dispensations d
             WHERE d.id=OLD.dispensation_id AND d.item_code_snapshot IS NOT NULL) THEN
    RAISE EXCEPTION 'Dispensing allocation and retry evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_pharmacy_allocations_immutable BEFORE UPDATE OR DELETE ON pharmacy_dispense_allocations
FOR EACH ROW EXECUTE FUNCTION jcare_guard_pharmacy_workflow_evidence();
--> statement-breakpoint
CREATE TRIGGER jcare_pharmacy_requests_immutable BEFORE UPDATE OR DELETE ON pharmacy_dispense_requests
FOR EACH ROW EXECUTE FUNCTION jcare_guard_pharmacy_workflow_evidence();
--> statement-breakpoint
-- A correction must be a separate controlled financial record, not an edit
-- or deletion of a medicine invoice line, including on an open invoice.
CREATE FUNCTION jcare_guard_inventory_billing_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source_type = 'PHARMACY' AND OLD.inventory_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'Inventory-priced medicine lines require an audited correction' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_inventory_billing_line_immutable BEFORE UPDATE OR DELETE ON billing_items
FOR EACH ROW EXECUTE FUNCTION jcare_guard_inventory_billing_line();
