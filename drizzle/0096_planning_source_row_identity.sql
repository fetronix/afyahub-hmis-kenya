-- Preparation only. Requires explicit authorization before production application.
-- Keep imported source rows distinct even when their names, units and prices coincide.
DROP INDEX IF EXISTS planning_items_match_idx;
DROP INDEX IF EXISTS planning_uniforms_match_idx;
CREATE UNIQUE INDEX IF NOT EXISTS planning_items_match_idx ON planning_items
 (plan_id,category_id,lower(trim(description)),lower(trim(unit)))
 WHERE is_active AND source_import_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS planning_uniforms_match_idx ON planning_uniforms
 (plan_id,category_id,lower(trim(description)))
 WHERE is_active AND source_import_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS planning_items_source_row_idx ON planning_items
 (plan_id,source_import_id,source_worksheet,source_row)
 WHERE is_active AND source_import_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS planning_uniforms_source_row_idx ON planning_uniforms
 (plan_id,source_import_id,source_worksheet,source_row)
 WHERE is_active AND source_import_id IS NOT NULL;
