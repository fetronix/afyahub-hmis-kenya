-- Phase 5 stock control: an append-only movement ledger, adjustments, physical
-- counts and store transfers. Additive only; every statement is guarded.
--
-- Why a ledger: `inventory_items.current_stock` is a running total that
-- receiving and dispensing both update. Without an append-only ledger nobody
-- can explain a variance, and a stock count cannot be reconciled. Every write
-- that changes stock through this module also appends a movement row.

CREATE TABLE IF NOT EXISTS inventory_movements (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  item_id integer NOT NULL REFERENCES inventory_items(id),
  batch_id integer REFERENCES inventory_batches(id),
  movement_type text NOT NULL,
  quantity_delta integer NOT NULL,
  stock_after integer NOT NULL,
  reason_code text,
  reference_type text,
  reference_id text,
  store_from text,
  store_to text,
  notes text,
  actor_user_id integer REFERENCES users(id),
  actor_name text NOT NULL,
  movement_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movements_nonzero_chk CHECK (quantity_delta <> 0),
  CONSTRAINT inventory_movements_type_chk
    CHECK (movement_type IN ('RECEIPT', 'DISPENSE', 'ADJUSTMENT', 'COUNT_VARIANCE', 'TRANSFER_OUT', 'TRANSFER_IN', 'WRITE_OFF')),
  CONSTRAINT inventory_movements_stock_after_chk CHECK (stock_after >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inventory_movements_facility_item_idx
  ON inventory_movements (facility_id, item_id, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inventory_movements_facility_date_idx
  ON inventory_movements (facility_id, movement_date);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_reference_once_idx
  ON inventory_movements (facility_id, reference_type, reference_id, movement_type)
  WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_stock_counts (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  count_number text NOT NULL,
  count_date date NOT NULL,
  store_location text,
  status text NOT NULL DEFAULT 'OPEN',
  notes text,
  counted_by_user_id integer REFERENCES users(id),
  counted_by_name text NOT NULL,
  posted_at timestamptz,
  posted_by_user_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_stock_counts_status_chk CHECK (status IN ('OPEN', 'POSTED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS inventory_stock_counts_facility_number_idx
  ON inventory_stock_counts (facility_id, count_number);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS inventory_stock_count_lines (
  id serial PRIMARY KEY,
  count_id integer NOT NULL REFERENCES inventory_stock_counts(id) ON DELETE CASCADE,
  item_id integer NOT NULL REFERENCES inventory_items(id),
  expected_quantity integer NOT NULL,
  counted_quantity integer,
  variance_quantity integer,
  notes text,
  CONSTRAINT inventory_stock_count_lines_expected_chk CHECK (expected_quantity >= 0),
  CONSTRAINT inventory_stock_count_lines_counted_chk CHECK (counted_quantity IS NULL OR counted_quantity >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS inventory_stock_count_lines_item_idx
  ON inventory_stock_count_lines (count_id, item_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS inventory_transfers (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  transfer_number text NOT NULL,
  transfer_date date NOT NULL,
  store_from text NOT NULL,
  store_to text NOT NULL,
  status text NOT NULL DEFAULT 'POSTED',
  notes text,
  actor_user_id integer REFERENCES users(id),
  actor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_transfers_stores_chk CHECK (store_from <> store_to),
  CONSTRAINT inventory_transfers_status_chk CHECK (status IN ('POSTED', 'REVERSED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS inventory_transfers_facility_number_idx
  ON inventory_transfers (facility_id, transfer_number);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS inventory_transfer_items (
  id serial PRIMARY KEY,
  transfer_id integer NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
  item_id integer NOT NULL REFERENCES inventory_items(id),
  batch_id integer REFERENCES inventory_batches(id),
  quantity integer NOT NULL,
  CONSTRAINT inventory_transfer_items_quantity_chk CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inventory_transfer_items_transfer_idx
  ON inventory_transfer_items (transfer_id);
