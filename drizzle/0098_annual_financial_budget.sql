-- Separate, planning-only scenario. No actual expenditure, ledger or inventory linkage.
CREATE TABLE IF NOT EXISTS planning_financial_budgets (
 plan_id integer PRIMARY KEY,
 tenant_id integer NOT NULL,
 facility_id integer NOT NULL,
 model jsonb NOT NULL CHECK(jsonb_typeof(model)='object'),
 updated_by integer NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(plan_id,tenant_id,facility_id) REFERENCES planning_plans(id,tenant_id,facility_id)
);
CREATE INDEX IF NOT EXISTS planning_financial_budget_scope_idx ON planning_financial_budgets(tenant_id,facility_id);
--> statement-breakpoint
CREATE FUNCTION jcare_financial_budget_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p planning_plans%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Financial budget history must be retained' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM planning_plans WHERE id=NEW.plan_id AND tenant_id=NEW.tenant_id AND facility_id=NEW.facility_id FOR UPDATE;
 IF p.id IS NULL OR p.status<>'DRAFT' OR p.financial_year<>2026 OR p.currency<>'KES' THEN
  RAISE EXCEPTION 'Financial budgets require a scoped 2026 KES draft' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (OLD.plan_id<>NEW.plan_id OR OLD.tenant_id<>NEW.tenant_id OR OLD.facility_id<>NEW.facility_id) THEN
  RAISE EXCEPTION 'Financial budget scope is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER planning_financial_budget_guard BEFORE INSERT OR UPDATE OR DELETE ON planning_financial_budgets FOR EACH ROW EXECUTE FUNCTION jcare_financial_budget_guard();
