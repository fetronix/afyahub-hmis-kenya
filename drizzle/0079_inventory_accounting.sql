-- Phase 3 Batch B: inventory-to-accounting integration.
--
-- Adds the facility inventory accounting policy, the lot-cost allocation trail
-- that makes consumption and write-off costs recoverable, and the link that
-- ties a stock movement to the journal it produced.
--
-- Nothing here rewrites existing data. A facility with no ACTIVE policy row
-- behaves exactly as before: purchases are expensed on receipt of the supplier
-- invoice and no inventory journal is posted. PERPETUAL is opt-in.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS facility_inventory_accounting (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'DRAFT',
  basis text NOT NULL,

  -- Opening balance: an explicitly configured, accountant-approved counterpart.
  -- Never implied by the code, because only an accountant may choose whether
  -- opening stock is booked against retained earnings, a reserve, a loan or a
  -- suspense account.
  opening_balance_account_id integer REFERENCES chart_of_accounts(id),
  opening_journal_id integer REFERENCES journal_entries(id),
  -- What the shelf was worth when the policy was activated. Recorded even
  -- when it is zero, so "nothing to post" is distinguishable from "never
  -- captured" and an empty facility can still switch to perpetual accounting.
  opening_value_cents bigint NOT NULL DEFAULT 0,

  -- Perpetual posting accounts.
  stock_asset_account_id integer REFERENCES chart_of_accounts(id),
  clearing_account_id integer REFERENCES chart_of_accounts(id),
  consumption_account_id integer REFERENCES chart_of_accounts(id),
  adjustment_account_id integer REFERENCES chart_of_accounts(id),
  write_off_account_id integer REFERENCES chart_of_accounts(id),

  -- Recoverable input VAT is a receivable and never part of inventory cost;
  -- non-recoverable tax is an expense. They are separate accounts because
  -- merging them overstates the stock asset by the recoverable portion.
  input_vat_account_id integer REFERENCES chart_of_accounts(id),
  non_recoverable_tax_account_id integer REFERENCES chart_of_accounts(id),

  effective_from date,
  activated_at timestamptz,
  activated_by_user_id integer REFERENCES users(id),
  finance_approved_by_user_id integer REFERENCES users(id),
  approval_note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT facility_inventory_accounting_status_chk
    CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  CONSTRAINT facility_inventory_accounting_basis_chk
    CHECK (basis IN ('EXPENSE_ON_PURCHASE', 'PERPETUAL')),
  CONSTRAINT facility_inventory_accounting_version_key UNIQUE (facility_id, version),

  -- Completeness is required only of an ACTIVE perpetual row. A DRAFT row must
  -- be creatable before the opening journal exists, otherwise activation could
  -- never begin; an ACTIVE row must be complete, otherwise activation could
  -- commit half a policy.
  CONSTRAINT facility_inventory_accounting_active_complete CHECK (
    status <> 'ACTIVE'
    OR basis <> 'PERPETUAL'
    OR (
      stock_asset_account_id IS NOT NULL
      AND clearing_account_id IS NOT NULL
      AND consumption_account_id IS NOT NULL
      AND adjustment_account_id IS NOT NULL
      AND write_off_account_id IS NOT NULL
      AND opening_balance_account_id IS NOT NULL
      AND (opening_journal_id IS NOT NULL OR opening_value_cents = 0)
      AND effective_from IS NOT NULL
      AND activated_at IS NOT NULL
      AND finance_approved_by_user_id IS NOT NULL
    )
  ),

  -- An expense-basis row carries no capitalisation state.
  CONSTRAINT facility_inventory_accounting_expense_no_opening CHECK (
    basis <> 'EXPENSE_ON_PURCHASE' OR opening_journal_id IS NULL
  )
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS facility_inventory_accounting_active_once_idx
  ON facility_inventory_accounting (facility_id)
  WHERE status = 'ACTIVE';

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS facility_inventory_accounting_tenant_idx
  ON facility_inventory_accounting (tenant_id, facility_id);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS inventory_movement_allocations (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  movement_id integer NOT NULL REFERENCES inventory_movements(id),
  batch_id integer NOT NULL REFERENCES inventory_batches(id),
  quantity integer NOT NULL,
  unit_cost_cents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT inventory_movement_allocations_quantity_chk CHECK (quantity > 0),
  CONSTRAINT inventory_movement_allocations_cost_chk CHECK (unit_cost_cents >= 0),
  CONSTRAINT inventory_movement_allocations_once UNIQUE (movement_id, batch_id)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inventory_movement_allocations_batch_idx
  ON inventory_movement_allocations (batch_id);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS inventory_movement_journals (
  movement_id integer PRIMARY KEY REFERENCES inventory_movements(id),
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  journal_entry_id integer NOT NULL REFERENCES journal_entries(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inventory_movement_journals_journal_idx
  ON inventory_movement_journals (journal_entry_id);
