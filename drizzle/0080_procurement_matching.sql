-- Batch E — Phase 5: three-way matching, supplier returns and credit notes.
--
-- WHY THIS EXISTS
-- ---------------
-- Batch B made goods receipts credit "received not invoiced" and supplier
-- invoices clear it. Two things were missing, and both leave money wrong:
--
--   1. Nothing compared the order, the receipt and the invoice. An invoice for
--      goods received at a price nobody ordered was posted and payable.
--   2. Goods could not go back. A return is the only way the clearing balance
--      and the payable come down when stock is rejected, and a credit note is
--      the only way a supplier's adjustment reaches the ledger.
--
-- WHAT THIS MIGRATION ADDS
-- ------------------------
--   * supplier_invoice_matches — the recorded outcome of the comparison, so a
--     payment can be refused while an invoice is unmatched.
--   * supplier_returns / supplier_return_items — stock leaving at lot cost,
--     traced back to the receipt line and the lot it came from.
--   * supplier_credit_notes / supplier_credit_note_items — the supplier's
--     credit, posted against the payable and applied to the invoice balance.
--   * RETURN_OUT as a movement type, so a return is a first-class stock event
--     rather than being disguised as a write-off (which would misreport
--     wastage to every stock report).
--
-- Nothing here changes an existing row's meaning. Every new column is nullable
-- or defaulted, and the movement-type check is widened, never narrowed.

-- A return is not wastage. Recording it as WRITE_OFF would have told the
-- facility it had destroyed stock it actually sent back.
ALTER TABLE inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_type_chk;
--> statement-breakpoint

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_type_chk
  CHECK (movement_type IN (
    'RECEIPT', 'DISPENSE', 'ADJUSTMENT', 'COUNT_VARIANCE',
    'TRANSFER_OUT', 'TRANSFER_IN', 'WRITE_OFF', 'RETURN_OUT'
  ));
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS supplier_invoice_matches (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  supplier_invoice_id integer NOT NULL REFERENCES supplier_invoices(id),
  goods_received_note_id integer NOT NULL REFERENCES goods_received_notes(id),
  purchase_order_id integer REFERENCES purchase_orders(id),

  -- MATCHED agrees within tolerance, VARIANCE is a real difference the
  -- facility has not accepted, OVERRIDDEN is a difference a named user
  -- accepted in writing. Only MATCHED and OVERRIDDEN may be paid.
  status text NOT NULL,
  ordered_cents bigint NOT NULL DEFAULT 0,
  received_cents bigint NOT NULL DEFAULT 0,
  invoiced_cents bigint NOT NULL DEFAULT 0,
  price_variance_cents bigint NOT NULL DEFAULT 0,
  amount_variance_cents bigint NOT NULL DEFAULT 0,
  tolerance_cents bigint NOT NULL DEFAULT 0,

  -- One row per finding, so the reason is readable without recomputing.
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,

  checked_at timestamptz NOT NULL DEFAULT now(),
  checked_by_user_id integer REFERENCES users(id),
  override_reason text,
  overridden_by_user_id integer REFERENCES users(id),
  overridden_at timestamptz,

  CONSTRAINT supplier_invoice_matches_status_chk
    CHECK (status IN ('MATCHED', 'VARIANCE', 'OVERRIDDEN')),
  CONSTRAINT supplier_invoice_matches_override_chk
    CHECK (status <> 'OVERRIDDEN' OR (override_reason IS NOT NULL AND overridden_by_user_id IS NOT NULL)),
  CONSTRAINT supplier_invoice_matches_variance_chk
    CHECK (status = 'MATCHED' OR price_variance_cents <> 0 OR amount_variance_cents <> 0 OR jsonb_array_length(findings) > 0)
);
--> statement-breakpoint

-- One verdict per invoice: a second match would let a re-check quietly erase
-- the evidence a payment decision was made on.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_matches_invoice_once_idx
  ON supplier_invoice_matches (supplier_invoice_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS supplier_invoice_matches_facility_idx
  ON supplier_invoice_matches (facility_id, status);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS supplier_returns (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  supplier_id integer NOT NULL REFERENCES suppliers(id),
  goods_received_note_id integer NOT NULL REFERENCES goods_received_notes(id),
  return_number text NOT NULL,
  return_date date NOT NULL,
  status text NOT NULL DEFAULT 'POSTED',
  reason_code text NOT NULL,
  total_cents bigint NOT NULL,
  -- The counterpart is decided by whether the note was already invoiced:
  -- before invoicing the supplier will simply not bill those units, so the
  -- receipt accrual comes down; after invoicing the payable comes down.
  counterpart text NOT NULL,
  journal_entry_id integer REFERENCES journal_entries(id),
  idempotency_key text NOT NULL,
  notes text,
  recorded_by_user_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT supplier_returns_status_chk CHECK (status IN ('POSTED', 'REVERSED')),
  CONSTRAINT supplier_returns_counterpart_chk
    CHECK (counterpart IN ('CLEARING', 'PAYABLE', 'NONE')),
  CONSTRAINT supplier_returns_total_chk CHECK (total_cents >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS supplier_returns_number_once_idx
  ON supplier_returns (facility_id, return_number);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS supplier_returns_idempotency_once_idx
  ON supplier_returns (facility_id, idempotency_key);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS supplier_return_items (
  id serial PRIMARY KEY,
  return_id integer NOT NULL REFERENCES supplier_returns(id),
  goods_received_note_item_id integer NOT NULL REFERENCES goods_received_note_items(id),
  inventory_item_id integer NOT NULL REFERENCES inventory_items(id),
  inventory_batch_id integer REFERENCES inventory_batches(id),
  quantity integer NOT NULL,
  unit_cost_cents bigint NOT NULL,
  line_total_cents bigint NOT NULL,
  inventory_movement_id integer REFERENCES inventory_movements(id),

  CONSTRAINT supplier_return_items_quantity_chk CHECK (quantity > 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS supplier_return_items_line_once_idx
  ON supplier_return_items (return_id, goods_received_note_item_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS supplier_credit_notes (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  supplier_id integer NOT NULL REFERENCES suppliers(id),
  supplier_invoice_id integer REFERENCES supplier_invoices(id),
  supplier_return_id integer REFERENCES supplier_returns(id),
  credit_note_number text NOT NULL,
  credit_note_date date NOT NULL,
  subtotal_cents bigint NOT NULL,
  tax_cents bigint NOT NULL DEFAULT 0,
  total_cents bigint NOT NULL,
  applied_cents bigint NOT NULL DEFAULT 0,
  -- OPEN means the credit has not yet been consumed; APPLIED means it has all
  -- gone against the invoice or the payable.
  status text NOT NULL DEFAULT 'OPEN',
  journal_entry_id integer REFERENCES journal_entries(id),
  idempotency_key text NOT NULL,
  notes text,
  recorded_by_user_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT supplier_credit_notes_status_chk CHECK (status IN ('OPEN', 'APPLIED')),
  CONSTRAINT supplier_credit_notes_total_chk CHECK (total_cents > 0),
  CONSTRAINT supplier_credit_notes_applied_chk
    CHECK (applied_cents >= 0 AND applied_cents <= total_cents)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS supplier_credit_notes_number_once_idx
  ON supplier_credit_notes (facility_id, credit_note_number);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS supplier_credit_notes_idempotency_once_idx
  ON supplier_credit_notes (facility_id, idempotency_key);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS supplier_credit_note_items (
  id serial PRIMARY KEY,
  credit_note_id integer NOT NULL REFERENCES supplier_credit_notes(id),
  description text NOT NULL,
  quantity integer,
  unit_cost_cents bigint,
  line_total_cents bigint NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS supplier_credit_note_items_note_idx
  ON supplier_credit_note_items (credit_note_id);
