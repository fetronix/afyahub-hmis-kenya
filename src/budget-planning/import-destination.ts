import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { assert, id, text, year, inflation } from './calculations.ts';
import type { PlanningScope, Plan } from './planning.service.ts';
type Row = Record<string, any>;
export type ImportDestination = {
  kind: 'EXISTING' | 'NEW';
  mode: 'NEW' | 'SKIP' | 'UPDATE';
  facilityId: number;
  facilityName: string;
  planId: number | null;
  name: string;
  financialYear: number;
  planType: string;
  currency: string;
  inflationBp: number;
  version: number | null;
  confirmAdditionalPlan: boolean;
  existingPlans: Array<{ id: number; name: string; status: string }>;
};
export async function resolveImportDestination(
  c: PoolClient,
  s: PlanningScope,
  input: Row,
  lock = false,
): Promise<{ destination: ImportDestination; plan: Plan | null }> {
  assert(
    ['EXISTING', 'NEW'].includes(input.destination),
    'DESTINATION_REQUIRED',
    'Choose an existing plan or explicitly create a new draft.',
  );
  const existing = input.destination === 'EXISTING';
  assert(
    existing ? ['SKIP', 'UPDATE'].includes(input.mode) : input.mode === 'NEW',
    'IMPORT_MODE',
    'Choose a merge behavior for an existing plan, or NEW for a new draft.',
  );
  const financialYear = year(input.financialYear),
    inflationBp = inflation(input.inflationPercent);
  const planType = String(input.planType),
    currency = String(input.currency);
  assert(
    ['ANNUAL', 'MIXED', 'STATIONERY', 'BRANDING'].includes(planType),
    'INVALID_PLAN_TYPE',
    'Choose a supported plan type.',
  );
  assert(
    ['KES', 'USD', 'EUR'].includes(currency),
    'INVALID_CURRENCY',
    'Choose KES, USD or EUR. No foreign-exchange conversion is performed.',
  );
  const facility = (
    await c.query('SELECT id,name FROM facilities WHERE id=$1 AND tenant_id=$2', [
      s.facilityId,
      s.tenantId,
    ])
  ).rows[0];
  assert(facility, 'FACILITY_NOT_FOUND', 'Facility is not in the authenticated tenant.', 404);
  let plan: Plan | null = null;
  let name = '',
    version: number | null = null;
  let existingPlans: ImportDestination['existingPlans'] = [];
  if (existing) {
    plan =
      (
        await c.query(
          `SELECT * FROM planning_plans WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 ${lock ? 'FOR UPDATE' : ''}`,
          [id(input.planId), s.tenantId, s.facilityId],
        )
      ).rows[0] ?? null;
    assert(plan, 'PLAN_NOT_FOUND', 'Plan not found in this facility.', 404);
    assert(
      plan.status === 'DRAFT',
      'PLAN_PROTECTED',
      'Only an eligible DRAFT plan can receive an import.',
      409,
    );
    assert(
      plan.version === id(input.version),
      'PLAN_VERSION_CONFLICT',
      'The target draft changed. Reload its assumptions and preview again.',
      409,
    );
    assert(
      plan.financial_year === financialYear,
      'YEAR_MISMATCH',
      'Import year must match the destination plan.',
    );
    assert(
      plan.plan_type === planType,
      'PLAN_TYPE_MISMATCH',
      'Declared plan type must match the destination plan type.',
    );
    assert(
      plan.currency === currency,
      'CURRENCY_MISMATCH',
      'Import currency must match the destination plan; no conversion is performed.',
    );
    assert(
      plan.inflation_bp === inflationBp,
      'ASSUMPTION_MISMATCH',
      'Import inflation must match the destination plan assumption.',
    );
    name = plan.name;
    version = plan.version;
  } else {
    assert(
      !input.planId,
      'DESTINATION_CONFLICT',
      'A new-draft request must not also specify an existing plan ID.',
    );
    name = text(input.name, 'Plan name', 160);
    if (lock)
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('planning-year', $1))", [
        s.facilityId,
      ]);
    existingPlans = (
      await c.query(
        "SELECT id,name,status FROM planning_plans WHERE tenant_id=$1 AND facility_id=$2 AND financial_year=$3 AND status<>'ARCHIVED' ORDER BY id",
        [s.tenantId, s.facilityId, financialYear],
      )
    ).rows;
    assert(
      !existingPlans.some((p) => p.name === name),
      'PLAN_NAME_EXISTS',
      'That plan name already exists for this facility/year. Select the existing plan or choose a distinct reviewed name.',
      409,
    );
    assert(
      !existingPlans.length || input.confirmAdditionalPlan === true,
      'YEAR_PLAN_EXISTS',
      'A plan already exists for this facility/year. Select it, or explicitly authorize an additional separate draft before preview.',
      409,
    );
  }
  return {
    plan,
    destination: {
      kind: input.destination,
      mode: input.mode,
      facilityId: s.facilityId,
      facilityName: facility.name,
      planId: plan?.id ?? null,
      name,
      financialYear,
      planType,
      currency,
      inflationBp,
      version,
      confirmAdditionalPlan: !existing && input.confirmAdditionalPlan === true,
      existingPlans,
    },
  };
}

/** The same match predicate is used by preview counts and the existing import writer. */
export async function matchImportRow(
  c: PoolClient,
  planId: number,
  categoryId: number,
  kind: 'ITEM' | 'UNIFORM',
  item: Row,
) {
  const table = kind === 'ITEM' ? 'planning_items' : 'planning_uniforms';
  return (
    await c.query(
      `SELECT id FROM ${table} WHERE plan_id=$1 AND category_id=$2 AND lower(trim(description))=lower(trim($3)) AND is_active ${kind === 'ITEM' ? 'AND lower(trim(unit))=lower(trim($4))' : ''} AND source_import_id IS NOT NULL AND source_worksheet=$${kind === 'ITEM' ? 5 : 4} AND source_row=$${kind === 'ITEM' ? 6 : 5}`,
      [
        planId,
        categoryId,
        item.description,
        ...(kind === 'ITEM' ? [item.unit] : []),
        item.sourceWorksheet,
        item.sourceRow,
      ],
    )
  ).rows;
}
export async function importReviewCounts(
  c: PoolClient,
  destination: ImportDestination,
  preview: { items: Row[]; uniforms: Row[] },
  assess?: (item: Row, kind: string, operation: string, reason: string) => void,
) {
  const counts = {
    newItems: 0,
    matchingItems: 0,
    skippedItems: 0,
    conflictingItems: 0,
    updates: 0,
  };
  const categories = destination.planId
    ? (
        await c.query('SELECT id,name,is_active FROM planning_categories WHERE plan_id=$1', [
          destination.planId,
        ])
      ).rows
    : [];
  for (const [kind, rows] of [
    ['ITEM', preview.items],
    ['UNIFORM', preview.uniforms],
  ] as const)
    for (const item of rows) {
      const category = categories.find((c) => c.name === item.category);
      if (category && !category.is_active) {
        counts.conflictingItems++;
        assess?.(
          item,
          kind,
          'CONFLICT',
          'Destination category is inactive. Reactivate it or choose an eligible category and preview again.',
        );
        continue;
      }
      const matches = category
        ? await matchImportRow(c, destination.planId!, category.id, kind, item)
        : [];
      if (matches.length > 1) {
        assess?.(
          item,
          kind,
          'CONFLICT',
          'Multiple imported source rows match. Resolve the ambiguous destination rows and preview again.',
        );
        counts.conflictingItems++;
        continue;
      }
      if (matches.length) {
        counts.matchingItems++;
        if (destination.mode === 'SKIP') {
          counts.skippedItems++;
          assess?.(
            item,
            kind,
            'SKIP',
            'Matching imported source row will be preserved; no overwrite.',
          );
        } else {
          counts.updates++;
          assess?.(
            item,
            kind,
            'UPDATE',
            'Matching imported source row requires explicit update authorization.',
          );
        }
      } else {
        counts.newItems++;
        assess?.(item, kind, 'CREATE', 'New source row; creation requires explicit confirmation.');
      }
    }
  return counts;
}
export function destinationPreviewHash(
  workbookHash: string,
  sourceHash: string,
  destination: ImportDestination,
  counts: Row,
) {
  return (
    createHash('sha256')
      // PostgreSQL JSONB reorders object keys. Bind content, not incidental serialization order.
      .update(
        JSON.stringify({ workbookHash, sourceHash, destination, counts }, (_key, value) =>
          value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(
                Object.keys(value)
                  .sort()
                  .map((key) => [key, value[key]]),
              )
            : value,
        ),
      )
      .digest('hex')
  );
}
/** Validate the caller's destination against the durable preview BEFORE any plan mutation. */
export function assertReviewedDestination(
  validation: Row | null,
  input: Row,
  workbookHash: string,
  sourceHash: string,
) {
  const d = validation?.destination as ImportDestination | undefined;
  assert(
    d && validation?.counts,
    'DESTINATION_PREVIEW_REQUIRED',
    'Preview this batch again with an explicit destination before confirmation.',
    409,
  );
  const same =
    input.destination === d.kind &&
    input.mode === d.mode &&
    (d.kind === 'EXISTING'
      ? id(input.planId) === d.planId && id(input.version) === d.version
      : !input.planId &&
        text(input.name, 'Plan name', 160) === d.name &&
        (input.confirmAdditionalPlan === true) === d.confirmAdditionalPlan) &&
    year(input.financialYear) === d.financialYear &&
    input.planType === d.planType &&
    input.currency === d.currency &&
    inflation(input.inflationPercent) === d.inflationBp;
  assert(
    same,
    'DESTINATION_CHANGED',
    'Destination or merge behavior changed. Preview again before confirmation.',
    409,
  );
  assert(
    validation?.previewHash === input.previewHash &&
      destinationPreviewHash(workbookHash, sourceHash, d, validation.counts) === input.previewHash,
    'PREVIEW_CHANGED',
    'Source, mappings or reviewed values changed. Preview again before confirmation.',
    409,
  );
}
