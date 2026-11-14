-- 0083 — payroll statutory form profiles.
--
-- P9 and P10 are forms defined by the revenue authority, not by this product.
-- Their layout changes, and filing against a remembered layout is how wrong
-- figures reach a regulator. A profile records which published version of which
-- form a facility is producing, with the citation; the extract refuses to run
-- when no profile covers the tax year.

CREATE TABLE IF NOT EXISTS payroll_form_profiles (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  form_code text NOT NULL CHECK (form_code IN ('P9', 'P10')),
  form_version text NOT NULL,
  authority_reference text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_form_profiles_scope_idx
  ON payroll_form_profiles (facility_id, form_code, form_version, effective_from);

CREATE INDEX IF NOT EXISTS payroll_form_profiles_lookup_idx
  ON payroll_form_profiles (tenant_id, facility_id, form_code, is_active);
