/*
 * Departments and designations: a designation now carries an optional
 * description, and the dropdown that fills it is indexed for the
 * "active designations in this department" query the employee form runs.
 *
 * department_id stays nullable on purpose: rows written before departments were
 * required must keep loading. The API requires a department on every new or
 * edited designation, so nulls are legacy data only.
 */
ALTER TABLE "hr_designations" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_designations_facility_active_idx" ON "hr_designations" USING btree ("facility_id","department_id","is_active");
