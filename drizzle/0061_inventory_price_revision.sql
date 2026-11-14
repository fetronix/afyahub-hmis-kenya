-- Revision is metadata only: existing inventory prices are not changed.
-- Price changes serialize independently of routine stock/updated_at writes.
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS price_revision integer NOT NULL DEFAULT 1 CHECK (price_revision > 0);
--> statement-breakpoint
CREATE FUNCTION jcare_guard_inventory_price_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.selling_price IS DISTINCT FROM OLD.selling_price THEN
    IF OLD.price_revision >= 2147483647 OR NEW.price_revision <> OLD.price_revision + 1 THEN
      RAISE EXCEPTION 'A selling-price change requires the next price revision' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.price_revision <> OLD.price_revision THEN
    RAISE EXCEPTION 'Price revision cannot change without a selling-price change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER jcare_inventory_price_revision_guard BEFORE UPDATE ON inventory_items
FOR EACH ROW EXECUTE FUNCTION jcare_guard_inventory_price_revision();
