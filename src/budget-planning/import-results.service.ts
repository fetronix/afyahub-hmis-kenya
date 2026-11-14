import { transaction, scopedPlan, type PlanningScope } from './planning.service.ts';
import { assert, id } from './calculations.ts';
import {
  committedCounts,
  importIndicators,
  importResultsCsv,
  importState,
  outcomeWarnings,
  type ImportRow,
} from './import-outcome.ts';

export async function importResults(s: PlanningScope, batchId: unknown) {
  return transaction(async (c) => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const b = (
      await c.query(
        'SELECT id,filename,sha256,byte_size,status,created_at,uploaded_by,validation,result FROM planning_import_batches WHERE id=$1 AND tenant_id=$2 AND facility_id=$3',
        [id(batchId), s.tenantId, s.facilityId],
      )
    ).rows[0];
    assert(b, 'IMPORT_NOT_FOUND', 'Import batch not found in this facility.', 404);
    const events = (
      await c.query(
        'SELECT e.id,e.action,e.actor_id,e.created_at,e.entity,e.entity_id,e.updated_values,u.full_name AS actor_name FROM planning_events e LEFT JOIN users u ON u.id=e.actor_id AND u.tenant_id=e.tenant_id WHERE e.import_id=$1 AND e.tenant_id=$2 AND e.facility_id=$3 ORDER BY e.id',
        [b.id, s.tenantId, s.facilityId],
      )
    ).rows;
    const counts = committedCounts(b);
    const snapshot = b.status === 'IMPORTED' ? b.result : b.validation;
    let rows: ImportRow[] =
      b.status === 'IMPORTED' ? (b.result?.rows ?? []) : (b.validation?.rowsDetail ?? []);
    const legacyDetails =
      b.status === 'IMPORTED'
        ? !b.result?.rows
        : !!b.validation?.previewHash && !b.validation?.rowsDetail;
    if (legacyDetails && b.status === 'IMPORTED')
      rows = events
        .filter((e) => ['IMPORT_CREATE', 'IMPORT_UPDATE'].includes(e.action))
        .map((e): ImportRow => ({
          sheet: e.updated_values?.source_worksheet ?? '',
          row: e.updated_values?.source_row ?? 0,
          kind: e.entity,
          description: e.updated_values?.description ?? '',
          category: 'Not retained in legacy row audit',
          outcome: e.action === 'IMPORT_CREATE' ? 'CREATED' : 'UPDATED',
          recordId: e.entity_id,
          message: 'Committed operation retained in the original audit.',
          correctiveAction:
            'Historical raw/defaulted field attribution is unavailable for this row; consult retained source and validation evidence.',
          values: [
            {
              field: 'Stored record from audit',
              raw: null,
              value: e.updated_values,
              origin: 'UNAVAILABLE',
              reason:
                'Original inputs and derived values share a legacy audit object; individual origins are not available.',
            },
          ],
        }));
    if (legacyDetails && b.status !== 'IMPORTED')
      rows = (b.validation?.errors ?? []).map(
        (e: { sheet: string; row: number; message: string }): ImportRow => ({
          sheet: e.sheet,
          row: e.row,
          kind: 'ROW',
          description: '',
          category: '',
          outcome: 'FAILED',
          message: e.message,
          correctiveAction:
            'Correct this source row and preview again. Historical field-level detail is unavailable.',
          values: [],
        }),
      );
    if (b.status === 'UPLOADED' && b.validation?.lastFailure?.phase === 'CONFIRMATION')
      rows = rows.map((row) =>
        row.outcome === 'VALID'
          ? {
              ...row,
              outcome: 'ROLLED_BACK',
              message:
                'Not imported: the confirmation attempt failed and no write committed for this source row. ' +
                b.validation.lastFailure.message,
              correctiveAction:
                'Refresh the current batch result, resolve the failed attempt, then review and confirm again. Do not re-upload the same file.',
            }
          : row,
      );
    // Do not reconstruct successful counts from a preview or from current mutable plan contents.
    return {
      batch: b,
      state: importState(b),
      counts,
      notImported:
        (b.status === 'IMPORTED'
          ? counts.skipped + counts.failed
          : Number(b.validation?.rows ?? 0) + Number(b.validation?.errors?.length ?? 0)) +
        rows.filter((r) => r.outcome === 'EXCLUDED').length,
      failedAttempts: events.filter((e) =>
        ['PREVIEW_FAILED', 'CONFIRMATION_FAILED'].includes(e.action),
      ).length,
      rows,
      legacyDetails,
      warnings: snapshot?.warnings ?? [],
      warningCount: outcomeWarnings(b),
      warningCountKnown:
        typeof snapshot?.warningCount === 'number' || Array.isArray(snapshot?.warnings),
      normalizations: snapshot?.normalizations ?? [],
      destination:
        b.status === 'IMPORTED'
          ? (b.result?.destination ?? b.validation?.destination)
          : b.validation?.destination,
      lastFailure: b.status === 'UPLOADED' ? (b.validation?.lastFailure ?? null) : null,
      lifecycle: events.map((e) => ({
        id: e.id,
        action: e.action,
        actorId: e.actor_id,
        actorName: e.actor_name,
        recordedAt: e.created_at,
        detail: ['PREVIEW_FAILED', 'CONFIRMATION_FAILED'].includes(e.action)
          ? e.updated_values
          : undefined,
      })),
      recordedAt: b.result?.recordedAt ?? b.validation?.recordedAt ?? b.created_at,
    };
  });
}
export async function importSummary(s: PlanningScope, planId?: unknown) {
  return transaction(async (c) => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (planId) await scopedPlan(c, s, planId);
    const batches = (
      await c.query(
        "SELECT id,status,result - 'rows' - 'normalizations' AS result,validation - 'rowsDetail' - 'normalizations' AS validation FROM planning_import_batches WHERE tenant_id=$1 AND facility_id=$2",
        [s.tenantId, s.facilityId],
      )
    ).rows;
    const count = planId
      ? (
          await c.query(
            'SELECT count(*)::int AS count FROM (SELECT i.id FROM planning_items i JOIN planning_plans p ON p.id=i.plan_id WHERE p.tenant_id=$1 AND p.facility_id=$2 AND p.id=$3 AND i.source_import_id IS NOT NULL AND i.is_active UNION ALL SELECT u.id FROM planning_uniforms u JOIN planning_plans p ON p.id=u.plan_id WHERE p.tenant_id=$1 AND p.facility_id=$2 AND p.id=$3 AND u.source_import_id IS NOT NULL AND u.is_active) records',
            [s.tenantId, s.facilityId, id(planId)],
          )
        ).rows[0].count
      : null;
    return {
      ...importIndicators(batches),
      selectedPlanRecords: count,
      selectedPlanId: planId ? id(planId) : null,
    };
  });
}
export function resultsCsv(result: Awaited<ReturnType<typeof importResults>>, errorsOnly = false) {
  const rows: unknown[][] = [];
  const prefix = [
    result.batch.id,
    result.batch.filename,
    result.batch.sha256,
    result.state,
    result.destination?.facilityId,
    result.destination?.planId,
    result.destination?.name,
    result.destination?.financialYear,
    result.recordedAt,
    result.batch.result?.recordedBy ??
      result.batch.validation?.recordedBy ??
      result.batch.uploaded_by,
  ];
  for (const row of result.rows) {
    const warning = row.duplicateName || row.values.some((v) => v.origin === 'DEFAULTED');
    if (
      errorsOnly &&
      !['FAILED', 'ROLLED_BACK', 'SKIPPED', 'EXCLUDED'].includes(row.outcome) &&
      row.plannedOperation !== 'SKIP' &&
      !warning
    )
      continue;
    for (const value of row.values.length ? row.values : [null])
      rows.push([
        ...prefix,
        row.sheet,
        row.row,
        row.kind,
        row.recordId,
        row.outcome,
        row.description,
        row.category,
        row.duplicateName ? 'Duplicate name; distinct source identity preserved' : '',
        row.message,
        row.correctiveAction,
        value?.field,
        value?.column,
        value?.raw,
        value?.value,
        value?.origin,
        value?.reason,
      ]);
  }
  for (const warning of result.warnings)
    rows.push([
      ...prefix,
      '',
      '',
      '',
      '',
      'WARNING',
      '',
      '',
      '',
      warning,
      'Review the source and normalization evidence before relying on projections.',
    ]);
  if (result.lastFailure)
    rows.push([
      ...prefix,
      '',
      '',
      '',
      '',
      'FAILED_ATTEMPT',
      '',
      '',
      '',
      result.lastFailure.message,
      'Refresh the current batch result, correct the issue and preview again before retrying.',
    ]);
  return importResultsCsv(
    [
      'Batch',
      'File',
      'SHA256',
      'Batch status',
      'Facility ID',
      'Plan ID',
      'Plan',
      'Financial year',
      'Result recorded at',
      'Actor ID',
      'Worksheet',
      'Source row',
      'Kind',
      'Record ID',
      'Row outcome',
      'Description',
      'Category',
      'Duplicate name',
      'Message',
      'Corrective action',
      'Field',
      'Column',
      'Raw source value',
      'Reviewed/stored value',
      'Origin',
      'Reason',
    ],
    rows,
  );
}
