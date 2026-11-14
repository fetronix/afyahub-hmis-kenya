-- Do not infer or rewrite historical laboratory identities. NOT VALID leaves
-- existing rows untouched while enforcing the tenant/facility relationship on
-- new or changed service references. Legacy violations require a separately
-- authorized, audited investigation before this constraint can be validated.
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_facility_service_scope_fk"
  FOREIGN KEY ("facility_service_id", "facility_id", "tenant_id")
  REFERENCES "facility_services" ("id", "facility_id", "tenant_id") NOT VALID;
