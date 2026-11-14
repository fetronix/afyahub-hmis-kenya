import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { assert, id, text } from './calculations.ts';
import { transaction, event, type PlanningScope } from './planning.service.ts';
import { isBrandingCategory } from '../components/modules/planning/planning-sections.ts';
import type {
  ResetSelection,
  ResetCounts,
  ResetInventory,
  ResetPreview,
  ResetReceipt,
} from './reset-contract.ts';

// A shared deployment secret supports multiple workers. Without one, restart/worker
// changes invalidate outstanding previews (fail closed), never authorize a reset.
const configuredKey = process.env.PLANNING_RESET_SIGNING_KEY?.trim();
if (configuredKey && Buffer.byteLength(configuredKey) < 32)
  throw new Error('PLANNING_RESET_SIGNING_KEY must contain at least 32 bytes.');
const signingKey = configuredKey || randomBytes(32);
const ttl = 10 * 60 * 1000;
type Row = Record<string, any>;
function selectionOf(input: Row): ResetSelection {
  const value = input.selection;
  assert(
    value &&
      Array.isArray(value.planIds) &&
      value.planIds.length > 0 &&
      value.planIds.length <= 100,
    'RESET_SELECTION_REQUIRED',
    'Select between 1 and 100 draft plans.',
  );
  for (const flag of ['stationery', 'branding', 'uniforms', 'deleteEmptyPlans'])
    assert(
      typeof value[flag] === 'boolean',
      'INVALID_RESET_SELECTION',
      'Explicit reset choices are required.',
    );
  assert(
    ['ALL', 'IMPORTED', 'MANUAL'].includes(value.provenance),
    'INVALID_RESET_SELECTION',
    'Select a valid provenance filter.',
  );
  assert(
    value.stationery || value.branding || value.uniforms || value.deleteEmptyPlans,
    'EMPTY_RESET_SELECTION',
    'Choose data to clear.',
  );
  return {
    planIds: [...new Set<number>(value.planIds.map(id))].sort((a, b) => a - b),
    stationery: value.stationery,
    branding: value.branding,
    uniforms: value.uniforms,
    deleteEmptyPlans: value.deleteEmptyPlans,
    provenance: value.provenance,
  };
}
async function facility(c: PoolClient, s: PlanningScope) {
  const r = await c.query('SELECT id,name FROM facilities WHERE id=$1 AND tenant_id=$2', [
    s.facilityId,
    s.tenantId,
  ]);
  assert(r.rows[0], 'FACILITY_NOT_FOUND', 'Facility not found.', 404);
  return r.rows[0] as ResetInventory['facility'];
}
async function readPlans(c: PoolClient, s: PlanningScope, ids?: number[], lock = false) {
  return (
    await c.query(
      `SELECT p.*,
    (SELECT count(*)::int FROM planning_events e WHERE e.plan_id=p.id) AS events,
    (SELECT count(*)::int FROM planning_reports r WHERE r.plan_id=p.id) AS reports
    FROM planning_plans p WHERE p.tenant_id=$1 AND p.facility_id=$2 ${ids ? 'AND p.id=ANY($3::int[])' : ''}
    ORDER BY p.id ${lock ? 'FOR UPDATE OF p' : ''}`,
      ids ? [s.tenantId, s.facilityId, ids] : [s.tenantId, s.facilityId],
    )
  ).rows;
}
async function children(c: PoolClient, s: PlanningScope, ids: number[]) {
  const params = [s.tenantId, s.facilityId, ids];
  const items = (
    await c.query(
      'SELECT i.* FROM planning_items i JOIN planning_plans p ON p.id=i.plan_id WHERE p.tenant_id=$1 AND p.facility_id=$2 AND p.id=ANY($3::int[]) ORDER BY i.id',
      params,
    )
  ).rows;
  const uniforms = (
    await c.query(
      'SELECT u.* FROM planning_uniforms u JOIN planning_plans p ON p.id=u.plan_id WHERE p.tenant_id=$1 AND p.facility_id=$2 AND p.id=ANY($3::int[]) ORDER BY u.id',
      params,
    )
  ).rows;
  const categories = (
    await c.query(
      'SELECT c.* FROM planning_categories c JOIN planning_plans p ON p.id=c.plan_id WHERE p.tenant_id=$1 AND p.facility_id=$2 AND p.id=ANY($3::int[]) ORDER BY c.id',
      params,
    )
  ).rows;
  const months = (
    await c.query(
      'SELECT m.* FROM planning_months m JOIN planning_items i ON i.id=m.item_id JOIN planning_plans p ON p.id=i.plan_id WHERE p.tenant_id=$1 AND p.facility_id=$2 AND p.id=ANY($3::int[]) ORDER BY m.id',
      params,
    )
  ).rows;
  return { items, uniforms, categories, months };
}
const retention = (p: Row) =>
  p.status !== 'DRAFT'
    ? 'Only DRAFT plans are eligible.'
    : p.events || p.reports || p.source_import_id
      ? 'Plan has audit, issued report or import history; preserve the plan.'
      : '';
function branding(i: Row, data: Awaited<ReturnType<typeof children>>, plans: Row[]) {
  return isBrandingCategory(
    data.categories.find((c) => c.id === i.category_id)!,
    plans.find((p) => p.id === i.plan_id)!.plan_type,
  );
}
export async function resetInventory(s: PlanningScope): Promise<ResetInventory> {
  return transaction(async (c) => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const f = await facility(c, s),
      plans = await readPlans(c, s),
      data = await children(
        c,
        s,
        plans.map((p) => p.id),
      );
    const batches = (
      await c.query(
        'SELECT id,filename,status,created_at FROM planning_import_batches WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id DESC',
        [s.tenantId, s.facilityId],
      )
    ).rows;
    return {
      facility: f,
      batches,
      plans: plans.map((p) => {
        const items = data.items.filter((i) => i.plan_id === p.id),
          uniforms = data.uniforms.filter((u) => u.plan_id === p.id);
        const imported = [...items, ...uniforms].filter((r) => r.source_import_id !== null).length;
        return {
          id: p.id,
          name: p.name,
          financial_year: p.financial_year,
          status: p.status,
          version: p.version,
          stationery: items.filter((i) => !branding(i, data, plans)).length,
          branding: items.filter((i) => branding(i, data, plans)).length,
          uniforms: uniforms.length,
          months: data.months.filter((m) => items.some((i) => i.id === m.item_id)).length,
          imported,
          manual: items.length + uniforms.length - imported,
          eligible: p.status === 'DRAFT',
          disposable: !retention(p),
          retentionReason: retention(p),
        };
      }),
    };
  });
}
async function snapshot(c: PoolClient, s: PlanningScope, selection: ResetSelection, lock: boolean) {
  const plans = await readPlans(c, s, selection.planIds, lock);
  assert(
    plans.length === selection.planIds.length,
    'PLAN_NOT_FOUND',
    'A selected plan is outside this facility or no longer exists.',
    404,
  );
  assert(
    plans.every((p) => p.status === 'DRAFT'),
    'RESET_DRAFT_ONLY',
    'Only DRAFT plans can be reset. Protected plans are never changed.',
    409,
  );
  const all = await children(c, s, selection.planIds);
  const matches = (r: Row) =>
    selection.provenance === 'ALL' ||
    (selection.provenance === 'IMPORTED'
      ? r.source_import_id !== null
      : r.source_import_id === null);
  const items = all.items.filter(
    (i) => matches(i) && (branding(i, all, plans) ? selection.branding : selection.stationery),
  );
  const uniforms = all.uniforms.filter((u) => matches(u) && selection.uniforms);
  const months = all.months.filter((m) => items.some((i) => i.id === m.item_id));
  const removed = new Set([...items, ...uniforms]);
  const disposable = selection.deleteEmptyPlans
    ? plans.filter(
        (p) =>
          !retention(p) &&
          ![...all.items, ...all.uniforms].some((r) => r.plan_id === p.id && !removed.has(r)),
      )
    : [];
  const categories = all.categories.filter((r) => disposable.some((p) => p.id === r.plan_id));
  const imported = [...items, ...uniforms].filter((r) => r.source_import_id !== null).length;
  const counts: ResetCounts = {
    stationery: items.filter((i) => !branding(i, all, plans)).length,
    branding: items.filter((i) => branding(i, all, plans)).length,
    uniforms: uniforms.length,
    months: months.length,
    categories: categories.length,
    plans: disposable.length,
    imported,
    manual: items.length + uniforms.length - imported,
  };
  const retainedPlans = selection.deleteEmptyPlans
    ? plans
        .filter((p) => !disposable.includes(p))
        .map((p) => ({
          id: p.id,
          reason: retention(p) || 'Unselected records remain; preserve the plan.',
        }))
    : [];
  // Include versions, rows and reference counts, not just counts: equal-count edits invalidate preview.
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ plans, all, selection }))
    .digest('hex');
  return {
    plans,
    items,
    uniforms,
    months,
    categories,
    disposable,
    counts,
    retainedPlans,
    fingerprint,
  };
}
const sign = (body: string) => createHmac('sha256', signingKey).update(body).digest('base64url');
function verify(token: unknown) {
  assert(
    typeof token === 'string' && token.length < 12000,
    'RESET_PREVIEW_REQUIRED',
    'A fresh reset preview is required.',
    409,
  );
  const [body, signature, extra] = token.split('.');
  const expected = Buffer.from(sign(body ?? '')),
    actual = Buffer.from(signature ?? '');
  assert(
    !extra && actual.length === expected.length && timingSafeEqual(actual, expected),
    'INVALID_RESET_PREVIEW',
    'Reset preview is invalid. Preview again.',
    409,
  );
  const value = JSON.parse(Buffer.from(body, 'base64url').toString());
  assert(
    value.expires > Date.now(),
    'RESET_PREVIEW_EXPIRED',
    'Reset preview expired. Preview again.',
    409,
  );
  return value;
}
export async function previewReset(s: PlanningScope, input: Row): Promise<ResetPreview> {
  const selection = selectionOf(input),
    reason = text(input.reason, 'Reset reason', 1000);
  assert(
    reason.length >= 10,
    'RESET_REASON_REQUIRED',
    'Give a reset reason of at least 10 characters.',
  );
  return transaction(async (c) => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const f = await facility(c, s),
      snap = await snapshot(c, s, selection, false);
    assert(
      snap.counts.stationery + snap.counts.branding + snap.counts.uniforms + snap.counts.plans > 0,
      'RESET_NOTHING_TO_CLEAR',
      'No eligible records match these choices. Nothing needs clearing.',
    );
    const expires = Date.now() + ttl;
    const body = Buffer.from(
      JSON.stringify({ scope: s, selection, reason, fingerprint: snap.fingerprint, expires }),
    ).toString('base64url');
    return {
      facility: f,
      selection,
      reason,
      counts: snap.counts,
      planIdsToDelete: snap.disposable.map((p) => p.id),
      retainedPlans: snap.retainedPlans,
      token: `${body}.${sign(body)}`,
      expiresAt: new Date(expires).toISOString(),
    };
  });
}
export async function executeReset(s: PlanningScope, input: Row): Promise<ResetReceipt> {
  assert(
    input.confirmation === 'RESET PLANNING DATA',
    'RESET_CONFIRMATION_REQUIRED',
    'Type RESET PLANNING DATA exactly.',
  );
  const reviewed = verify(input.token);
  assert(
    reviewed.scope.tenantId === s.tenantId &&
      reviewed.scope.facilityId === s.facilityId &&
      reviewed.scope.actorId === s.actorId,
    'RESET_SCOPE_MISMATCH',
    'Preview belongs to another administrator or facility.',
    403,
  );
  const committed = await transaction(async (c) => {
    await facility(c, s);
    const snap = await snapshot(c, s, reviewed.selection, true);
    assert(
      reviewed.expires > Date.now(),
      'RESET_PREVIEW_EXPIRED',
      'Reset preview expired while waiting. Preview again.',
      409,
    );
    assert(
      snap.fingerprint === reviewed.fingerprint,
      'RESET_PREVIEW_CHANGED',
      'Planning data changed after preview. Nothing was reset; preview again.',
      409,
    );
    const previous = {
      planning_items: snap.items,
      planning_uniforms: snap.uniforms,
      planning_months: snap.months,
      planning_categories: snap.categories,
      planning_plans: snap.disposable,
    };
    await event(c, s, 'PLANNING_RESET_AUTHORIZED', null, {
      entity: 'planning_reset',
      previous,
      updated: {
        selection: reviewed.selection,
        reason: reviewed.reason,
        counts: snap.counts,
        fingerprint: snap.fingerprint,
      },
    });
    const authorization = (
      await c.query(
        "SELECT id FROM planning_events WHERE tenant_id=$1 AND facility_id=$2 AND actor_id=$3 AND id=currval(pg_get_serial_sequence('planning_events','id'))",
        [s.tenantId, s.facilityId, s.actorId],
      )
    ).rows[0].id;
    await c.query("SELECT set_config('jalicare.planning_reset_event', $1, true)", [
      String(authorization),
    ]);
    const deleted: Record<string, number> = {};
    // Child first, explicit scope joins on every deletion; no CASCADE or trigger disabling.
    deleted.months =
      (
        await c.query(
          'DELETE FROM planning_months m USING planning_items i,planning_plans p WHERE m.item_id=i.id AND i.plan_id=p.id AND p.tenant_id=$1 AND p.facility_id=$2 AND m.id=ANY($3::int[])',
          [s.tenantId, s.facilityId, snap.months.map((r) => r.id)],
        )
      ).rowCount ?? 0;
    for (const [table, rows, key] of [
      ['planning_items', snap.items, 'items'],
      ['planning_uniforms', snap.uniforms, 'uniforms'],
      ['planning_categories', snap.categories, 'categories'],
    ] as const)
      deleted[key] =
        (
          await c.query(
            `DELETE FROM ${table} r USING planning_plans p WHERE r.plan_id=p.id AND p.tenant_id=$1 AND p.facility_id=$2 AND r.id=ANY($3::int[])`,
            [s.tenantId, s.facilityId, rows.map((r) => r.id)],
          )
        ).rowCount ?? 0;
    deleted.plans =
      (
        await c.query(
          'DELETE FROM planning_plans WHERE tenant_id=$1 AND facility_id=$2 AND id=ANY($3::int[])',
          [s.tenantId, s.facilityId, snap.disposable.map((r) => r.id)],
        )
      ).rowCount ?? 0;
    assert(
      deleted.items === snap.items.length &&
        deleted.uniforms === snap.uniforms.length &&
        deleted.months === snap.months.length &&
        deleted.categories === snap.categories.length &&
        deleted.plans === snap.disposable.length,
      'RESET_COUNT_MISMATCH',
      'Deletion counts changed. The reset has been rolled back.',
      409,
    );
    await c.query(
      'UPDATE planning_plans SET version=version+1,updated_at=now(),updated_by=$3 WHERE tenant_id=$1 AND facility_id=$2 AND id=ANY($4::int[])',
      [
        s.tenantId,
        s.facilityId,
        s.actorId,
        snap.plans.filter((p) => !snap.disposable.some((d) => d.id === p.id)).map((p) => p.id),
      ],
    );
    await event(c, s, 'PLANNING_RESET_COMPLETED', null, {
      entity: 'planning_reset',
      updated: {
        authorizationEventId: authorization,
        reason: reviewed.reason,
        selection: reviewed.selection,
        counts: snap.counts,
        facilityId: s.facilityId,
        actorId: s.actorId,
      },
    });
    const receipt = (
      await c.query(
        "SELECT id,created_at FROM planning_events WHERE tenant_id=$1 AND facility_id=$2 AND actor_id=$3 AND id=currval(pg_get_serial_sequence('planning_events','id'))",
        [s.tenantId, s.facilityId, s.actorId],
      )
    ).rows[0];
    return {
      eventId: receipt.id,
      committedAt: receipt.created_at.toISOString(),
      facilityId: s.facilityId,
      actorId: s.actorId,
      counts: snap.counts,
    };
  });
  // Only reached after transaction() has acknowledged COMMIT.
  return { ...committed, committedAt: new Date().toISOString() };
}
