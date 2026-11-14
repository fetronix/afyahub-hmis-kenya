-- Delegated approval authority.
--
-- A facility may say "purchases above this value need a particular authority",
-- and the server refuses an approval that does not carry it. Each policy is a
-- threshold: it applies to amounts at or above `min_amount_cents`, and the
-- approved action needs `required_permission`. Evaluation takes the highest
-- matching threshold, so a larger purchase can never be approved on a weaker
-- rule than a smaller one.
--
-- A facility with no policies keeps the existing permission gate unchanged;
-- nothing here weakens an approval that already happened.

CREATE TABLE IF NOT EXISTS approval_policies (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  policy_scope text NOT NULL,
  policy_name text NOT NULL,
  min_amount_cents bigint NOT NULL,
  required_permission text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by_user_id integer REFERENCES users(id),
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_policies_scope_chk
    CHECK (policy_scope IN ('REQUISITION', 'PURCHASE_ORDER')),
  CONSTRAINT approval_policies_min_chk CHECK (min_amount_cents >= 0),
  CONSTRAINT approval_policies_dates_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS approval_policies_facility_scope_min_idx
  ON approval_policies (facility_id, policy_scope, min_amount_cents);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS approval_policies_facility_scope_idx
  ON approval_policies (facility_id, policy_scope, is_active);
