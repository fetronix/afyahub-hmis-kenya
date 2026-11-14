-- Separate partner statements; no ledger, procurement or budget posting.
CREATE TABLE equity_partner_register (
 tenant_id integer NOT NULL REFERENCES tenants(id), facility_id integer NOT NULL REFERENCES facilities(id),
 version integer NOT NULL DEFAULT 1, partners jsonb NOT NULL CHECK(jsonb_typeof(partners)='array'),
 PRIMARY KEY(tenant_id,facility_id)
);
CREATE TABLE equity_statements (
 id serial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),facility_id integer NOT NULL REFERENCES facilities(id),
 financial_year integer NOT NULL CHECK(financial_year BETWEEN 2000 AND 2200),period_kind text NOT NULL CHECK(period_kind IN('ANNUAL','OTHER')),
 period_name text NOT NULL,start_date date NOT NULL,end_date date NOT NULL CHECK(end_date>=start_date),
 revision integer NOT NULL DEFAULT 1,parent_id integer REFERENCES equity_statements(id),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','UNDER_REVIEW','APPROVED')),version integer NOT NULL DEFAULT 1,
 model jsonb NOT NULL CHECK(jsonb_typeof(model)='object'),review_acceptance text,revision_reason text,carry_source_id integer REFERENCES equity_statements(id),
 prepared_by integer NOT NULL REFERENCES users(id),prepared_at timestamptz NOT NULL DEFAULT now(),updated_by integer NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by integer REFERENCES users(id),reviewed_at timestamptz,approved_by integer REFERENCES users(id),approved_at timestamptz,
 UNIQUE(tenant_id,facility_id,start_date,end_date,revision),UNIQUE(id,tenant_id,facility_id),
 FOREIGN KEY(parent_id,tenant_id,facility_id) REFERENCES equity_statements(id,tenant_id,facility_id),
 FOREIGN KEY(carry_source_id,tenant_id,facility_id) REFERENCES equity_statements(id,tenant_id,facility_id)
);
CREATE TABLE equity_events (
 id bigserial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),facility_id integer NOT NULL REFERENCES facilities(id),
 statement_id integer,action text NOT NULL,actor_id integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 previous_values jsonb,new_values jsonb,reason text NOT NULL,
 FOREIGN KEY(statement_id,tenant_id,facility_id) REFERENCES equity_statements(id,tenant_id,facility_id)
);
CREATE INDEX equity_statements_scope_year ON equity_statements(tenant_id,facility_id,financial_year,start_date);
--> statement-breakpoint
CREATE FUNCTION jcare_equity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Equity history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM facilities WHERE id=NEW.facility_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Equity facility must belong to tenant' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='equity_events' AND TG_OP='UPDATE' THEN RAISE EXCEPTION 'Equity audit is append-only' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.tenant_id<>OLD.tenant_id OR NEW.facility_id<>OLD.facility_id) THEN RAISE EXCEPTION 'Equity scope is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='equity_statements' AND TG_OP='UPDATE' THEN
  IF OLD.status='APPROVED' THEN RAISE EXCEPTION 'Approved statement is immutable; create revision' USING ERRCODE='23514'; END IF;
  IF NEW.financial_year<>OLD.financial_year OR NEW.start_date<>OLD.start_date OR NEW.end_date<>OLD.end_date OR NEW.revision<>OLD.revision OR NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN RAISE EXCEPTION 'Statement identity is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Statement version must advance' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'DRAFT' AND NEW.model IS DISTINCT FROM OLD.model THEN RAISE EXCEPTION 'Only draft inputs can change' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER equity_statement_guard BEFORE INSERT OR UPDATE OR DELETE ON equity_statements FOR EACH ROW EXECUTE FUNCTION jcare_equity_guard();
CREATE TRIGGER equity_register_guard BEFORE INSERT OR UPDATE OR DELETE ON equity_partner_register FOR EACH ROW EXECUTE FUNCTION jcare_equity_guard();
CREATE TRIGGER equity_event_guard BEFORE INSERT OR UPDATE OR DELETE ON equity_events FOR EACH ROW EXECUTE FUNCTION jcare_equity_guard();
