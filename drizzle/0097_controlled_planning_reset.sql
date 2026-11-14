-- Controlled DRAFT-only reset. Normal updates keep the existing guards unchanged.
-- No data is reset by this migration. Immutable events/reports remain immutable.
CREATE FUNCTION jcare_planning_reset_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid integer; p planning_plans%ROWTYPE; reset_evidence planning_events%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='planning_plans' THEN pid=OLD.id;
 ELSIF TG_TABLE_NAME='planning_months' THEN
  SELECT plan_id INTO pid FROM planning_items WHERE id=OLD.item_id;
 ELSE pid=OLD.plan_id; END IF;
 SELECT * INTO p FROM planning_plans WHERE id=pid FOR UPDATE;
 IF p.id IS NULL OR p.status<>'DRAFT' THEN
  RAISE EXCEPTION 'Only draft planning data can be reset' USING ERRCODE='23514';
 END IF;
 SELECT e.* INTO reset_evidence FROM planning_events e
 WHERE e.id=NULLIF(current_setting('jalicare.planning_reset_event',true),'')::integer
 AND e.action='PLANNING_RESET_AUTHORIZED' AND e.entity='planning_reset'
 AND e.tenant_id=p.tenant_id AND e.facility_id=p.facility_id AND e.plan_id IS NULL
 AND e.xmin::text=pg_current_xact_id()::text
 AND (e.updated_values->'selection'->'planIds') @> to_jsonb(ARRAY[pid]);
 IF reset_evidence.id IS NULL OR NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(reset_evidence.previous_values->TG_TABLE_NAME) evidence
  WHERE (evidence->>'id')::integer=OLD.id
 ) THEN
  RAISE EXCEPTION 'Planning deletion requires same-transaction scoped reset row evidence' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='planning_plans' AND (
  p.source_import_id IS NOT NULL OR
  EXISTS(SELECT 1 FROM planning_events WHERE plan_id=pid) OR
  EXISTS(SELECT 1 FROM planning_reports WHERE plan_id=pid)
 ) THEN
  RAISE EXCEPTION 'Retain plans with import, audit or report history' USING ERRCODE='23514';
 END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
DROP TRIGGER planning_category_guard ON planning_categories;
CREATE TRIGGER planning_category_guard BEFORE INSERT OR UPDATE ON planning_categories FOR EACH ROW EXECUTE FUNCTION jcare_planning_child_guard();
CREATE TRIGGER planning_category_reset_delete BEFORE DELETE ON planning_categories FOR EACH ROW EXECUTE FUNCTION jcare_planning_reset_delete_guard();
DROP TRIGGER planning_item_guard ON planning_items;
CREATE TRIGGER planning_item_guard BEFORE INSERT OR UPDATE ON planning_items FOR EACH ROW EXECUTE FUNCTION jcare_planning_child_guard();
CREATE TRIGGER planning_item_reset_delete BEFORE DELETE ON planning_items FOR EACH ROW EXECUTE FUNCTION jcare_planning_reset_delete_guard();
DROP TRIGGER planning_month_guard ON planning_months;
CREATE TRIGGER planning_month_guard BEFORE INSERT OR UPDATE ON planning_months FOR EACH ROW EXECUTE FUNCTION jcare_planning_child_guard();
CREATE TRIGGER planning_month_reset_delete BEFORE DELETE ON planning_months FOR EACH ROW EXECUTE FUNCTION jcare_planning_reset_delete_guard();
DROP TRIGGER planning_uniform_guard ON planning_uniforms;
CREATE TRIGGER planning_uniform_guard BEFORE INSERT OR UPDATE ON planning_uniforms FOR EACH ROW EXECUTE FUNCTION jcare_planning_child_guard();
CREATE TRIGGER planning_uniform_reset_delete BEFORE DELETE ON planning_uniforms FOR EACH ROW EXECUTE FUNCTION jcare_planning_reset_delete_guard();
DROP TRIGGER planning_plan_guard ON planning_plans;
CREATE TRIGGER planning_plan_guard BEFORE UPDATE ON planning_plans FOR EACH ROW EXECUTE FUNCTION jcare_planning_plan_guard();
CREATE TRIGGER planning_plan_reset_delete BEFORE DELETE ON planning_plans FOR EACH ROW EXECUTE FUNCTION jcare_planning_reset_delete_guard();
