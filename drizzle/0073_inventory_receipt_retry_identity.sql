-- New, facility-scoped retry identities only. Historical batches and audit rows
-- are not changed or backfilled. A cancelled key is a permanent tombstone so a
-- delayed original request cannot post after an operator closes an uncertain
-- attempt. Review backup/restore, permissions and locking before production use.
DO $$
BEGIN
  IF to_regclass('inventory_receipt_requests') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname=current_schema() AND p.proname='jcare_inventory_receipt_request_guard') THEN
    RAISE EXCEPTION 'Unexpected inventory receipt identity objects; review migration state';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE inventory_receipt_requests (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  idempotency_key text NOT NULL CONSTRAINT inventory_receipt_requests_key_check
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  state text NOT NULL CONSTRAINT inventory_receipt_requests_state_values_check
    CHECK (state IN ('RECORDED','CANCELLED')),
  request_hash text,
  item_id integer REFERENCES inventory_items(id),
  batch_id integer REFERENCES inventory_batches(id),
  received_quantity integer,
  cost_per_unit numeric(10,2),
  response_snapshot jsonb,
  cancellation_reason text,
  actor_user_id integer NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT inventory_receipt_requests_state_check CHECK (
    (state='RECORDED' AND request_hash IS NOT NULL AND request_hash ~ '^[0-9a-f]{64}$'
     AND item_id IS NOT NULL AND batch_id IS NOT NULL AND received_quantity IS NOT NULL
     AND received_quantity BETWEEN 1 AND 1000000 AND cost_per_unit IS NOT NULL
     AND cost_per_unit >= 0 AND cost_per_unit::text NOT IN ('NaN','Infinity','-Infinity')
     AND response_snapshot IS NOT NULL AND jsonb_typeof(response_snapshot)='object'
     AND cancellation_reason IS NULL)
    OR
    (state='CANCELLED' AND request_hash IS NULL AND item_id IS NULL AND batch_id IS NULL
     AND received_quantity IS NULL AND cost_per_unit IS NULL AND response_snapshot IS NULL
     AND cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) BETWEEN 3 AND 500)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX inventory_receipt_requests_facility_key_idx
  ON inventory_receipt_requests(facility_id,idempotency_key);
--> statement-breakpoint
CREATE FUNCTION jcare_inventory_receipt_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Inventory receipt identities are immutable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM facilities f JOIN users u ON u.id=NEW.actor_user_id
    WHERE f.id=NEW.facility_id AND f.tenant_id=NEW.tenant_id
      AND u.tenant_id=NEW.tenant_id AND (u.facility_id IS NULL OR u.facility_id=NEW.facility_id)
  ) THEN
    RAISE EXCEPTION 'Inventory receipt actor or facility scope mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.state='RECORDED' AND NOT EXISTS (
    SELECT 1 FROM inventory_items i JOIN inventory_batches b ON b.item_id=i.id
    WHERE i.id=NEW.item_id AND i.facility_id=NEW.facility_id AND b.id=NEW.batch_id
  ) THEN
    RAISE EXCEPTION 'Inventory receipt item or batch scope mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_receipt_request_guard
BEFORE INSERT OR UPDATE OR DELETE ON inventory_receipt_requests
FOR EACH ROW EXECUTE FUNCTION jcare_inventory_receipt_request_guard();
