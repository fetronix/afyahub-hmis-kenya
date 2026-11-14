-- READ-ONLY investigation. Run only with authorized read access to the affected database.
-- Example (connection details supplied securely outside chat):
-- psql ... -v ON_ERROR_STOP=1 -v tenant_id=<actual tenant> -v facility_id=<actual facility> \
--   -f scripts/diagnose-planning-import-history.sql
-- Batch IDs 1 and 2 are from the incident report, not globally unique facility identifiers.
-- No source bytes, password hashes, session tokens or other credentials are returned.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SET LOCAL TIME ZONE 'UTC';

SELECT id, tenant_id, facility_id, filename, status, sha256, byte_size,
       octet_length(source_bytes) AS retained_source_bytes,
       encode(sha256(source_bytes), 'hex') = sha256 AS retained_source_hash_matches,
       uploaded_by, created_at AS uploaded_at, validation, result
FROM planning_import_batches
WHERE tenant_id = :'tenant_id'::int AND facility_id = :'facility_id'::int AND id IN (1, 2)
ORDER BY id;

-- Cancellation time/actor must come from these events, not the batch upload timestamp.
-- Legacy CANCEL_IMPORT records can have null entity_id and null previous/updated values;
-- import_id is the authoritative link. Do not filter by plan_id (these events have no plan).
SELECT e.id, e.import_id, e.plan_id, e.action, e.actor_id, u.username AS actor_username,
       e.entity, e.entity_id, e.created_at AS event_at, e.previous_values, e.updated_values
FROM planning_events e
LEFT JOIN users u ON u.id = e.actor_id AND u.tenant_id = e.tenant_id
WHERE e.tenant_id = :'tenant_id'::int AND e.facility_id = :'facility_id'::int
  AND e.import_id IN (1, 2)
ORDER BY e.created_at, e.id;

-- Legacy planning events do not populate request origin/reason; these context fields may be null.
-- audit_logs.timestamp is a legacy timestamp without timezone; retain it as stored.
SELECT id, user_id, resource, resource_id, action, timestamp AS event_at, details,
       ip_address, user_agent, request_id
FROM audit_logs
WHERE tenant_id = :'tenant_id'::int AND facility_id = :'facility_id'::int
  AND resource = 'budget_planning' AND resource_id IN ('1','2')
  AND action IN ('UPLOAD_WORKBOOK','PREVIEW_IMPORT','CANCEL_IMPORT','RETRY_IMPORT_REVIEW')
ORDER BY timestamp, id;

SELECT id, name, financial_year, plan_type, status, currency, version, inflation_bp,
       source_import_id, created_at, updated_at
FROM planning_plans
WHERE tenant_id = :'tenant_id'::int AND facility_id = :'facility_id'::int AND financial_year = 2026
ORDER BY id;

SELECT 'plan' AS record_kind, id, source_import_id FROM planning_plans
WHERE tenant_id = :'tenant_id'::int AND facility_id = :'facility_id'::int AND source_import_id IN (1, 2)
UNION ALL
SELECT 'item', i.id, i.source_import_id FROM planning_items i JOIN planning_plans p ON p.id=i.plan_id
WHERE p.tenant_id = :'tenant_id'::int AND p.facility_id = :'facility_id'::int AND i.source_import_id IN (1, 2)
UNION ALL
SELECT 'uniform', u.id, u.source_import_id FROM planning_uniforms u JOIN planning_plans p ON p.id=u.plan_id
WHERE p.tenant_id = :'tenant_id'::int AND p.facility_id = :'facility_id'::int AND u.source_import_id IN (1, 2)
ORDER BY record_kind, id;
ROLLBACK;
