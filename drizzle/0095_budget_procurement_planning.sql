-- Projections only: no links imply inventory, purchase orders, receipts or actual expenditure.
CREATE TABLE planning_import_batches (
 id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id), facility_id integer NOT NULL REFERENCES facilities(id),
 filename text NOT NULL, mime text NOT NULL, sha256 text NOT NULL, byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 4194304), source_bytes bytea NOT NULL,
 uploaded_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'UPLOADED' CHECK(status IN('UPLOADED','IMPORTED','CANCELLED')), result jsonb, validation jsonb,
 UNIQUE(facility_id,sha256)
);
CREATE TABLE planning_plans (
 id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id), facility_id integer NOT NULL REFERENCES facilities(id),
 name text NOT NULL, plan_type text NOT NULL CHECK(plan_type IN('ANNUAL','STATIONERY','BRANDING','MIXED')), financial_year integer NOT NULL CHECK(financial_year BETWEEN 2000 AND 2200),
 currency text NOT NULL CHECK(currency IN('KES','USD','EUR')), status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','REVIEW','APPROVED','ARCHIVED')),
 inflation_bp integer NOT NULL DEFAULT 0 CHECK(inflation_bp BETWEEN 0 AND 100000), version integer NOT NULL DEFAULT 1,
 source_import_id integer REFERENCES planning_import_batches(id), created_by integer NOT NULL REFERENCES users(id), updated_by integer NOT NULL REFERENCES users(id), approved_by integer REFERENCES users(id), approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(facility_id,financial_year,name)
);
CREATE INDEX planning_plans_scope_idx ON planning_plans(tenant_id,facility_id,financial_year,status);
CREATE TABLE planning_categories (
 id serial PRIMARY KEY, plan_id integer NOT NULL REFERENCES planning_plans(id), tenant_id integer NOT NULL REFERENCES tenants(id), facility_id integer NOT NULL REFERENCES facilities(id),
 name text NOT NULL, code text, is_active boolean NOT NULL DEFAULT true, UNIQUE(plan_id,name)
);
CREATE TABLE planning_items (
 id serial PRIMARY KEY, plan_id integer NOT NULL REFERENCES planning_plans(id), category_id integer NOT NULL REFERENCES planning_categories(id),
 description text NOT NULL, unit text NOT NULL, base_price_cents bigint NOT NULL CHECK(base_price_cents>=0), inflation_bp integer CHECK(inflation_bp BETWEEN 0 AND 100000), adjusted_price_cents bigint NOT NULL CHECK(adjusted_price_cents>=0),
 source_import_id integer REFERENCES planning_import_batches(id), source_worksheet text, source_row integer, source_formula text,
 is_active boolean NOT NULL DEFAULT true, created_by integer NOT NULL REFERENCES users(id), updated_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX planning_items_plan_idx ON planning_items(plan_id,category_id,is_active);
CREATE UNIQUE INDEX planning_items_match_idx ON planning_items(plan_id,category_id,lower(trim(description)),lower(trim(unit))) WHERE is_active;
CREATE TABLE planning_months (
 id serial PRIMARY KEY, item_id integer NOT NULL REFERENCES planning_items(id), planned_month date NOT NULL CHECK(extract(day FROM planned_month)=1),
 quantity numeric(16,3) CHECK(quantity>=0), unit_price_cents bigint NOT NULL CHECK(unit_price_cents>=0), amount_cents bigint CHECK(amount_cents>=0), status text NOT NULL DEFAULT 'PLANNED' CHECK(status='PLANNED'),
 CHECK((quantity IS NULL)=(amount_cents IS NULL)), UNIQUE(item_id,planned_month)
);
CREATE TABLE planning_uniforms (
 id serial PRIMARY KEY, plan_id integer NOT NULL REFERENCES planning_plans(id), category_id integer NOT NULL REFERENCES planning_categories(id), description text NOT NULL,
 existing_balance numeric(16,3) NOT NULL CHECK(existing_balance>=0), balance_label text NOT NULL DEFAULT 'Opening balance (source period recorded in notes)', buying_cost_cents bigint NOT NULL CHECK(buying_cost_cents>=0),
 contribution_bp integer NOT NULL CHECK(contribution_bp BETWEEN 0 AND 10000), staff_count integer NOT NULL CHECK(staff_count>=0), quantity_per_staff numeric(16,3) NOT NULL CHECK(quantity_per_staff>=0),
 balance_rule text NOT NULL CHECK(balance_rule IN('SUBTRACT','IGNORE')), projected_quantity numeric(16,3) NOT NULL, purchase_quantity numeric(16,3) NOT NULL,
 gross_cents bigint NOT NULL, contribution_cents bigint NOT NULL, total_cents bigint NOT NULL,
 source_import_id integer REFERENCES planning_import_batches(id), source_worksheet text, source_row integer, source_formula text,
 is_active boolean NOT NULL DEFAULT true, created_by integer NOT NULL REFERENCES users(id), updated_by integer NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX planning_uniforms_match_idx ON planning_uniforms(plan_id,category_id,lower(trim(description))) WHERE is_active;
CREATE TABLE planning_events (
 id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id), facility_id integer NOT NULL REFERENCES facilities(id), plan_id integer REFERENCES planning_plans(id), import_id integer REFERENCES planning_import_batches(id),
 actor_id integer NOT NULL REFERENCES users(id), action text NOT NULL, entity text NOT NULL, entity_id integer, previous_values jsonb, updated_values jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE planning_reports (
 id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id), facility_id integer NOT NULL REFERENCES facilities(id), plan_id integer NOT NULL REFERENCES planning_plans(id),
 report_type text NOT NULL, filters jsonb NOT NULL, model jsonb NOT NULL, export_data jsonb NOT NULL, letterhead_id integer REFERENCES facility_letterheads(id), pdf_bytes bytea NOT NULL,
 generated_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
-- Composite scope references prevent internally inconsistent tenant/facility links.
ALTER TABLE planning_import_batches ADD CONSTRAINT planning_import_scope_unique UNIQUE(id,tenant_id,facility_id), ADD CONSTRAINT planning_import_facility_scope_fk FOREIGN KEY(facility_id,tenant_id) REFERENCES facilities(id,tenant_id);
ALTER TABLE planning_plans ADD CONSTRAINT planning_plan_scope_unique UNIQUE(id,tenant_id,facility_id), ADD CONSTRAINT planning_plan_facility_scope_fk FOREIGN KEY(facility_id,tenant_id) REFERENCES facilities(id,tenant_id), ADD CONSTRAINT planning_plan_import_scope_fk FOREIGN KEY(source_import_id,tenant_id,facility_id) REFERENCES planning_import_batches(id,tenant_id,facility_id);
ALTER TABLE planning_categories ADD CONSTRAINT planning_category_scope_fk FOREIGN KEY(plan_id,tenant_id,facility_id) REFERENCES planning_plans(id,tenant_id,facility_id);
ALTER TABLE planning_events ADD CONSTRAINT planning_event_facility_scope_fk FOREIGN KEY(facility_id,tenant_id) REFERENCES facilities(id,tenant_id), ADD CONSTRAINT planning_event_plan_scope_fk FOREIGN KEY(plan_id,tenant_id,facility_id) REFERENCES planning_plans(id,tenant_id,facility_id), ADD CONSTRAINT planning_event_import_scope_fk FOREIGN KEY(import_id,tenant_id,facility_id) REFERENCES planning_import_batches(id,tenant_id,facility_id);
ALTER TABLE planning_reports ADD CONSTRAINT planning_report_plan_scope_fk FOREIGN KEY(plan_id,tenant_id,facility_id) REFERENCES planning_plans(id,tenant_id,facility_id);
CREATE INDEX planning_events_scope_idx ON planning_events(tenant_id,facility_id,plan_id,id DESC);
CREATE INDEX planning_reports_scope_idx ON planning_reports(tenant_id,facility_id,plan_id,id DESC);
CREATE INDEX planning_import_scope_idx ON planning_import_batches(tenant_id,facility_id,id DESC);
--> statement-breakpoint
CREATE FUNCTION jcare_planning_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Planning audit and issued reports are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER planning_events_immutable BEFORE UPDATE OR DELETE ON planning_events FOR EACH ROW EXECUTE FUNCTION jcare_planning_immutable();
CREATE TRIGGER planning_reports_immutable BEFORE UPDATE OR DELETE ON planning_reports FOR EACH ROW EXECUTE FUNCTION jcare_planning_immutable();
CREATE FUNCTION jcare_planning_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid integer; state text; y integer; category_plan integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Archive planning records; do not delete history' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='planning_months' THEN
  SELECT i.plan_id INTO pid FROM planning_items i WHERE i.id=NEW.item_id;
 ELSE pid=NEW.plan_id; END IF;
 SELECT status,financial_year INTO state,y FROM planning_plans WHERE id=pid FOR UPDATE;
 IF state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Only draft planning records can change' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='planning_months' THEN
   IF OLD.item_id<>NEW.item_id THEN RAISE EXCEPTION 'Item scope is immutable'; END IF;
  ELSE
   IF OLD.plan_id<>NEW.plan_id THEN RAISE EXCEPTION 'Plan scope is immutable'; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='planning_months' THEN IF extract(year FROM NEW.planned_month)<>y THEN RAISE EXCEPTION 'Month must belong to planning year' USING ERRCODE='23514'; END IF; END IF;
 IF TG_TABLE_NAME IN('planning_items','planning_uniforms') THEN
  SELECT plan_id INTO category_plan FROM planning_categories WHERE id=NEW.category_id;
  IF category_plan IS DISTINCT FROM pid THEN RAISE EXCEPTION 'Category must belong to this plan' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='planning_categories' THEN IF NOT EXISTS(SELECT 1 FROM planning_plans p WHERE p.id=pid AND p.tenant_id=NEW.tenant_id AND p.facility_id=NEW.facility_id) THEN RAISE EXCEPTION 'Category facility scope mismatch' USING ERRCODE='23514'; END IF; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER planning_category_guard BEFORE INSERT OR UPDATE OR DELETE ON planning_categories FOR EACH ROW EXECUTE FUNCTION jcare_planning_child_guard();
CREATE TRIGGER planning_item_guard BEFORE INSERT OR UPDATE OR DELETE ON planning_items FOR EACH ROW EXECUTE FUNCTION jcare_planning_child_guard();
CREATE TRIGGER planning_month_guard BEFORE INSERT OR UPDATE OR DELETE ON planning_months FOR EACH ROW EXECUTE FUNCTION jcare_planning_child_guard();
CREATE TRIGGER planning_uniform_guard BEFORE INSERT OR UPDATE OR DELETE ON planning_uniforms FOR EACH ROW EXECUTE FUNCTION jcare_planning_child_guard();
CREATE FUNCTION jcare_planning_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Archive plans; do not delete history' USING ERRCODE='23514'; END IF;
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.facility_id<>OLD.facility_id OR NEW.financial_year<>OLD.financial_year OR NEW.created_by<>OLD.created_by THEN RAISE EXCEPTION 'Plan scope/year/creator is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Planning version conflict' USING ERRCODE='23514'; END IF;
 IF OLD.status IN('APPROVED','ARCHIVED') AND (NEW.status<>'ARCHIVED' OR (to_jsonb(NEW)-ARRAY['status','version','updated_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updated_by','updated_at'])) THEN RAISE EXCEPTION 'Approved/archived plans are protected' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER planning_plan_guard BEFORE UPDATE OR DELETE ON planning_plans FOR EACH ROW EXECUTE FUNCTION jcare_planning_plan_guard();
