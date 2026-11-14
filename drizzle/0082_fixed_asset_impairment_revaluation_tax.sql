-- 0082 — fixed assets: impairment, revaluation, and configuration-driven tax allowance.
--
-- WHY A CARRYING BASIS COLUMN
-- ---------------------------
-- `acquisition_cost_kes` is historical cost and must stay as entered. Impairment
-- and revaluation both change the amount that remains to be depreciated, so that
-- amount is tracked separately. Depreciation spreads the *remaining* carrying
-- amount over the *remaining* life rather than rewriting history.

ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS carrying_basis_kes numeric(14,2),
  ADD COLUMN IF NOT EXISTS impairment_loss_kes numeric(14,2) NOT NULL DEFAULT '0.00',
  ADD COLUMN IF NOT EXISTS revaluation_reserve_kes numeric(14,2) NOT NULL DEFAULT '0.00',
  ADD COLUMN IF NOT EXISTS impairment_loss_account_id integer REFERENCES chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS revaluation_surplus_account_id integer REFERENCES chart_of_accounts(id);

-- Existing assets depreciate their historical cost; the basis starts equal to it.
UPDATE fixed_assets SET carrying_basis_kes = acquisition_cost_kes WHERE carrying_basis_kes IS NULL;

-- A negative carrying amount cannot be defended to an auditor, and a basis above
-- historical cost must be explained by a revaluation reserve.
ALTER TABLE fixed_assets
  ADD CONSTRAINT fixed_assets_carrying_basis_nonneg
    CHECK (carrying_basis_kes IS NULL OR carrying_basis_kes >= 0);

-- Tax depreciation is never computed from a rate embedded in code. A facility
-- records the rate it is entitled to use, together with the authority it came
-- from; without a row here the service refuses rather than guessing.
CREATE TABLE IF NOT EXISTS fixed_asset_tax_rates (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  category_id integer REFERENCES fixed_asset_categories(id),
  name text NOT NULL,
  method text NOT NULL CHECK (method IN ('REDUCING_BALANCE', 'STRAIGHT_LINE')),
  annual_rate_bps integer NOT NULL CHECK (annual_rate_bps > 0 AND annual_rate_bps <= 10000),
  authority_reference text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS fixed_asset_tax_rates_scope_idx
  ON fixed_asset_tax_rates (facility_id, coalesce(category_id, 0), name, effective_from);

CREATE INDEX IF NOT EXISTS fixed_asset_tax_rates_lookup_idx
  ON fixed_asset_tax_rates (tenant_id, facility_id, is_active, effective_from);
