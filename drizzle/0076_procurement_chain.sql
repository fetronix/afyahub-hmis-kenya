-- Phase 5 procurement chain: requisitions, goods received notes and the
-- invoice/AP link. Additive only; every statement is guarded so a re-run or a
-- partially migrated database is safe.

CREATE TABLE IF NOT EXISTS procurement_requisitions (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  requisition_number text NOT NULL,
  request_date date NOT NULL,
  needed_by date,
  department text,
  justification text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  estimated_total_kes numeric(14, 2) NOT NULL DEFAULT '0.00',
  requested_by_user_id integer REFERENCES users(id),
  requested_by_name text NOT NULL,
  decided_by_user_id integer REFERENCES users(id),
  decided_at timestamptz,
  decision_note text,
  purchase_order_id integer REFERENCES purchase_orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT procurement_requisitions_status_chk
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS procurement_requisitions_facility_number_idx
  ON procurement_requisitions (facility_id, requisition_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS procurement_requisitions_facility_status_idx
  ON procurement_requisitions (facility_id, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS procurement_requisition_items (
  id serial PRIMARY KEY,
  requisition_id integer NOT NULL REFERENCES procurement_requisitions(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  inventory_item_id integer REFERENCES inventory_items(id),
  description text NOT NULL,
  quantity numeric(12, 3) NOT NULL,
  unit text NOT NULL,
  estimated_unit_price numeric(12, 2) NOT NULL,
  line_total numeric(14, 2) NOT NULL,
  CONSTRAINT procurement_requisition_items_quantity_chk CHECK (quantity > 0),
  CONSTRAINT procurement_requisition_items_price_chk
    CHECK (estimated_unit_price >= 0 AND line_total >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS procurement_requisition_items_requisition_idx
  ON procurement_requisition_items (requisition_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS procurement_requisition_events (
  id serial PRIMARY KEY,
  requisition_id integer NOT NULL REFERENCES procurement_requisitions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  actor_user_id integer REFERENCES users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS procurement_requisition_events_requisition_idx
  ON procurement_requisition_events (requisition_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS goods_received_notes (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  grn_number text NOT NULL,
  purchase_order_id integer NOT NULL REFERENCES purchase_orders(id),
  supplier_id integer NOT NULL REFERENCES suppliers(id),
  received_date date NOT NULL,
  received_by_user_id integer REFERENCES users(id),
  received_by_name text NOT NULL,
  status text NOT NULL DEFAULT 'POSTED',
  inventory_value_kes numeric(14, 2) NOT NULL DEFAULT '0.00',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goods_received_notes_status_chk CHECK (status IN ('POSTED', 'REVERSED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS goods_received_notes_facility_number_idx
  ON goods_received_notes (facility_id, grn_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS goods_received_notes_order_idx
  ON goods_received_notes (purchase_order_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS goods_received_note_items (
  id serial PRIMARY KEY,
  goods_received_note_id integer NOT NULL REFERENCES goods_received_notes(id) ON DELETE CASCADE,
  purchase_order_item_id integer NOT NULL REFERENCES purchase_order_items(id),
  inventory_item_id integer REFERENCES inventory_items(id),
  description text NOT NULL,
  quantity_received numeric(12, 3) NOT NULL,
  unit_cost numeric(12, 2) NOT NULL,
  line_total numeric(14, 2) NOT NULL,
  batch_number text,
  expiry_date date,
  inventory_batch_id integer REFERENCES inventory_batches(id),
  CONSTRAINT goods_received_note_items_quantity_chk CHECK (quantity_received > 0),
  CONSTRAINT goods_received_note_items_price_chk CHECK (unit_cost >= 0 AND line_total >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS goods_received_note_items_note_idx
  ON goods_received_note_items (goods_received_note_id);
--> statement-breakpoint
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS inventory_item_id integer REFERENCES inventory_items(id);
--> statement-breakpoint
ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS goods_received_note_id integer REFERENCES goods_received_notes(id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoices_grn_idx
  ON supplier_invoices (goods_received_note_id);
