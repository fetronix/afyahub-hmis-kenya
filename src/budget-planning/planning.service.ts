import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import {
  assert,
  PlanningError,
  id,
  text,
  fixed,
  decimal,
  inflation,
  adjusted,
  monthAmount,
  quantities,
  year,
  uniformCalculation,
  type UniformInput,
} from './calculations.ts';
import { parseWorkbook, previewWorkbook, type Mapping } from './workbook.ts';
import {
  resolveImportDestination,
  importReviewCounts,
  destinationPreviewHash,
  assertReviewedDestination,
  matchImportRow,
} from './import-destination.ts';
export type PlanningScope = { tenantId: number; facilityId: number; actorId: number };
export type Plan = {
  id: number;
  tenant_id: number;
  facility_id: number;
  name: string;
  plan_type: string;
  financial_year: number;
  currency: string;
  status: string;
  inflation_bp: number;
  version: number;
  created_by: number;
  updated_by: number;
  approved_by: number | null;
};
type Row = Record<string, any>;
type Change = {
  header?: Record<string, unknown>;
  previous?: unknown;
  updated?: unknown;
  entity?: string;
  entityId?: number;
};
export async function transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const value = await fn(c);
    await c.query('COMMIT');
    return value;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
export async function event(
  c: PoolClient,
  s: PlanningScope,
  action: string,
  planId: number | null,
  change: Change = {},
  importId: number | null = null,
) {
  await c.query(
    'INSERT INTO planning_events(tenant_id,facility_id,plan_id,import_id,actor_id,action,entity,entity_id,previous_values,updated_values) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [
      s.tenantId,
      s.facilityId,
      planId,
      importId,
      s.actorId,
      action,
      change.entity ?? 'plan',
      change.entityId ?? planId,
      JSON.stringify(change.previous ?? null),
      JSON.stringify(change.updated ?? null),
    ],
  );
  await c.query(
    'INSERT INTO audit_logs(tenant_id,facility_id,user_id,resource,resource_id,action,details) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      s.tenantId,
      s.facilityId,
      String(s.actorId),
      'budget_planning',
      String(planId ?? importId ?? ''),
      action,
      'Facility-scoped planning change; full previous/updated values retained in planning_events.',
    ],
  );
}
export async function scopedPlan(
  c: PoolClient,
  s: PlanningScope,
  planId: unknown,
  lock = false,
): Promise<Plan> {
  const r = await c.query<Plan>(
    `SELECT * FROM planning_plans WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 ${lock ? 'FOR UPDATE' : ''}`,
    [id(planId), s.tenantId, s.facilityId],
  );
  assert(r.rows[0], 'PLAN_NOT_FOUND', 'Plan not found in this facility.', 404);
  return r.rows[0];
}
async function bump(
  c: PoolClient,
  s: PlanningScope,
  p: Plan,
  header: Record<string, unknown> = {},
) {
  const allowed = [
    'name',
    'plan_type',
    'currency',
    'inflation_bp',
    'status',
    'approved_by',
    'approved_at',
  ];
  assert(
    Object.keys(header).every((k) => allowed.includes(k)),
    'INVALID_PATCH',
    'Invalid plan patch.',
  );
  const entries = Object.entries(header);
  return (
    await c.query<Plan>(
      `UPDATE planning_plans SET version=version+1,updated_at=now(),updated_by=$2${entries.map(([k], n) => `,${k}=$${n + 3}`).join('')} WHERE id=$1 RETURNING *`,
      [p.id, s.actorId, ...entries.map(([, v]) => v)],
    )
  ).rows[0];
}
async function mutate(
  s: PlanningScope,
  planId: unknown,
  version: unknown,
  action: string,
  fn: (c: PoolClient, p: Plan) => Promise<Change>,
  states = ['DRAFT'],
) {
  return transaction(async (c) => {
    const p = await scopedPlan(c, s, planId, true);
    assert(
      p.version === id(version),
      'VERSION_CONFLICT',
      'This plan changed. Refresh before saving.',
      409,
    );
    assert(
      states.includes(p.status),
      'PLAN_PROTECTED',
      'Only eligible draft records can change. Approved/reviewed plans are protected.',
      409,
    );
    const change = await fn(c, p);
    const next = await bump(c, s, p, change.header);
    await event(c, s, action, p.id, {
      ...change,
      previous: change.previous ?? p,
      updated: change.updated ?? next,
    });
    return { plan: next, changedId: change.entityId };
  });
}
function planInput(input: Row) {
  const type = String(input.planType);
  assert(
    ['ANNUAL', 'STATIONERY', 'BRANDING', 'MIXED'].includes(type),
    'INVALID_PLAN_TYPE',
    'Choose a supported plan type.',
  );
  const currency = String(input.currency);
  assert(
    ['KES', 'USD', 'EUR'].includes(currency),
    'INVALID_CURRENCY',
    'Choose KES, USD or EUR. No foreign-exchange conversion is performed.',
  );
  return {
    name: text(input.name, 'Plan name', 160),
    type,
    currency,
    year: year(input.financialYear),
    bp: inflation(input.inflationPercent),
  };
}
async function createInside(
  c: PoolClient,
  s: PlanningScope,
  input: Row,
  importId: number | null = null,
) {
  const v = planInput(input);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('planning-year', $1))", [
    s.facilityId,
  ]);
  const prior = await c.query(
    "SELECT id FROM planning_plans WHERE facility_id=$1 AND financial_year=$2 AND status<>'ARCHIVED'",
    [s.facilityId, v.year],
  );
  assert(
    !prior.rowCount || input.confirmAdditionalPlan === true,
    'YEAR_PLAN_EXISTS',
    'A plan already exists for this facility/year. Explicitly confirm an additional separate draft; nothing is replaced.',
    409,
  );
  return (
    await c.query<Plan>(
      'INSERT INTO planning_plans(tenant_id,facility_id,name,plan_type,financial_year,currency,inflation_bp,created_by,updated_by,source_import_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING *',
      [s.tenantId, s.facilityId, v.name, v.type, v.year, v.currency, v.bp, s.actorId, importId],
    )
  ).rows[0];
}
export async function createPlan(s: PlanningScope, input: Row) {
  return transaction(async (c) => {
    const p = await createInside(c, s, input);
    await event(c, s, 'CREATE_PLAN', p.id, { updated: p });
    return p;
  });
}
export async function listPlans(s: PlanningScope, q: Row) {
  const params: unknown[] = [s.tenantId, s.facilityId];
  const where = ['tenant_id=$1', 'facility_id=$2'];
  for (const [field, key] of [
    ['financial_year', 'year'],
    ['status', 'status'],
    ['plan_type', 'type'],
  ] as const)
    if (q[key]) {
      params.push(key === 'year' ? year(q[key]) : String(q[key]));
      where.push(`${field}=$${params.length}`);
    }
  const page = Math.max(1, Number(q.page) || 1),
    limit = 20;
  assert(Number.isSafeInteger(page) && page <= 100000, 'INVALID_PAGE', 'Choose a valid page.');
  const count = await pool.query(
    `SELECT count(*)::int AS total FROM planning_plans WHERE ${where.join(' AND ')}`,
    params,
  );
  params.push(limit, (page - 1) * limit);
  const rows = await pool.query(
    `SELECT * FROM planning_plans WHERE ${where.join(' AND ')} ORDER BY financial_year DESC,id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { plans: rows.rows, total: count.rows[0].total, page };
}
export async function updatePlan(s: PlanningScope, planId: unknown, input: Row) {
  return mutate(s, planId, input.version, 'UPDATE_PLAN', async (c, p) => {
    const header: Row = {
      name: text(input.name, 'Plan name', 160),
      inflation_bp: inflation(input.inflationPercent),
    };
    const items = (
      await c.query('SELECT * FROM planning_items WHERE plan_id=$1 AND is_active', [p.id])
    ).rows;
    const recalculated: Row[] = [];
    for (const item of items) {
      const price = adjusted(
        BigInt(item.base_price_cents),
        item.inflation_bp ?? header.inflation_bp,
      );
      await c.query(
        'UPDATE planning_items SET adjusted_price_cents=$2,updated_by=$3,updated_at=now() WHERE id=$1',
        [item.id, price.toString(), s.actorId],
      );
      const months = (await c.query('SELECT * FROM planning_months WHERE item_id=$1', [item.id]))
        .rows;
      item.months = months;
      recalculated.push({
        ...item,
        adjusted_price_cents: price.toString(),
        months: months.map((m) => ({
          ...m,
          unit_price_cents: price.toString(),
          amount_cents:
            monthAmount(price, m.quantity === null ? null : fixed(m.quantity, 3))?.toString() ??
            null,
        })),
      });
      for (const m of months)
        await c.query(
          'UPDATE planning_months SET unit_price_cents=$2,amount_cents=$3 WHERE id=$1',
          [
            m.id,
            price.toString(),
            monthAmount(price, m.quantity === null ? null : fixed(m.quantity, 3))?.toString() ??
              null,
          ],
        );
    }
    return {
      header,
      previous: { plan: p, items },
      updated: { plan: { ...p, ...header, version: p.version + 1 }, items: recalculated },
    };
  });
}
export async function transitionPlan(s: PlanningScope, planId: unknown, input: Row) {
  const status = String(input.status);
  return mutate(
    s,
    planId,
    input.version,
    'STATUS_' + status,
    async (c, p) => {
      assert(
        (
          {
            DRAFT: ['REVIEW', 'ARCHIVED'],
            REVIEW: ['DRAFT', 'APPROVED'],
            APPROVED: ['ARCHIVED'],
          } as Record<string, string[]>
        )[p.status]?.includes(status),
        'INVALID_TRANSITION',
        'Unsupported planning status transition.',
        409,
      );
      if (status === 'REVIEW' || status === 'APPROVED') {
        const rows = (
          await c.query(
            'SELECT count(*)::int n FROM planning_items WHERE plan_id=$1 AND is_active',
            [p.id],
          )
        ).rows[0];
        const uniforms = (
          await c.query(
            'SELECT count(*)::int n FROM planning_uniforms WHERE plan_id=$1 AND is_active',
            [p.id],
          )
        ).rows[0];
        assert(
          rows.n + uniforms.n > 0,
          'EMPTY_PLAN',
          'Add reviewed projections before submitting.',
        );
        const blanks = await c.query(
          'SELECT 1 FROM planning_months m JOIN planning_items i ON i.id=m.item_id WHERE i.plan_id=$1 AND i.is_active AND m.quantity IS NULL LIMIT 1',
          [p.id],
        );
        assert(
          !blanks.rowCount,
          'UNPLANNED_MONTHS',
          'Review every blank month before approval; enter explicit zero when no procurement is planned.',
          409,
        );
      }
      if (status === 'APPROVED')
        assert(
          s.actorId !== p.created_by && s.actorId !== p.updated_by,
          'INDEPENDENT_APPROVAL_REQUIRED',
          'Approval requires an authorized user other than the creator/last editor.',
          409,
        );
      return {
        header: {
          status,
          ...(status === 'APPROVED' ? { approved_by: s.actorId, approved_at: new Date() } : {}),
        },
      };
    },
    ['DRAFT', 'REVIEW', 'APPROVED'],
  );
}
async function category(c: PoolClient, p: Plan, categoryId: unknown) {
  const row = (
    await c.query('SELECT * FROM planning_categories WHERE id=$1 AND plan_id=$2 AND is_active', [
      id(categoryId),
      p.id,
    ])
  ).rows[0];
  assert(row, 'CATEGORY_NOT_FOUND', 'Choose an active category belonging to this plan.');
  return row;
}
export async function saveCategory(
  s: PlanningScope,
  planId: unknown,
  categoryId: unknown | null,
  input: Row,
) {
  return mutate(
    s,
    planId,
    input.version,
    categoryId ? 'UPDATE_CATEGORY' : 'CREATE_CATEGORY',
    async (c, p) => {
      const name = text(input.name, 'Category'),
        code = input.code ? text(input.code, 'Code', 60) : null;
      if (categoryId) {
        const prior = (
          await c.query('SELECT * FROM planning_categories WHERE id=$1 AND plan_id=$2', [
            id(categoryId),
            p.id,
          ])
        ).rows[0];
        assert(prior, 'CATEGORY_NOT_FOUND', 'Category not found.', 404);
        if (input.isActive === false) {
          const used = await c.query(
            'SELECT id FROM planning_items WHERE category_id=$1 AND is_active UNION ALL SELECT id FROM planning_uniforms WHERE category_id=$1 AND is_active',
            [prior.id],
          );
          assert(
            !used.rowCount,
            'CATEGORY_IN_USE',
            'Archive or move active items before deactivating this category.',
          );
        }
        const row = (
          await c.query(
            'UPDATE planning_categories SET name=$2,code=$3,is_active=$4 WHERE id=$1 RETURNING *',
            [prior.id, name, code, input.isActive !== false],
          )
        ).rows[0];
        return { entity: 'category', entityId: row.id, previous: prior, updated: row };
      }
      const row = (
        await c.query(
          'INSERT INTO planning_categories(plan_id,tenant_id,facility_id,name,code) VALUES($1,$2,$3,$4,$5) RETURNING *',
          [p.id, s.tenantId, s.facilityId, name, code],
        )
      ).rows[0];
      return { entity: 'category', entityId: row.id, updated: row };
    },
  );
}
async function writeItem(
  c: PoolClient,
  s: PlanningScope,
  p: Plan,
  itemId: unknown | null,
  input: Row,
  source?: { batchId: number; sheet: string; row: number; formula: string },
) {
  await category(c, p, input.categoryId);
  const description = text(input.description, 'Description'),
    unit = text(input.unit, 'Unit', 60),
    base = fixed(input.basePrice, 2, 'Base price'),
    bp =
      input.inflationPercent === null ||
      input.inflationPercent === '' ||
      input.inflationPercent === undefined
        ? null
        : inflation(input.inflationPercent),
    price = adjusted(base, bp ?? p.inflation_bp),
    q = quantities(input.quantities);
  let prior: Row | null = null,
    row: Row;
  if (itemId) {
    prior = (
      await c.query('SELECT * FROM planning_items WHERE id=$1 AND plan_id=$2 AND is_active', [
        id(itemId),
        p.id,
      ])
    ).rows[0];
    assert(prior, 'ITEM_NOT_FOUND', 'Active item not found.', 404);
    prior = {
      ...prior,
      months: (
        await c.query('SELECT * FROM planning_months WHERE item_id=$1 ORDER BY planned_month', [
          prior.id,
        ])
      ).rows,
    };
    row = (
      await c.query(
        'UPDATE planning_items SET category_id=$2,description=$3,unit=$4,base_price_cents=$5,inflation_bp=$6,adjusted_price_cents=$7,updated_by=$8,updated_at=now() WHERE id=$1 RETURNING *',
        [
          prior.id,
          input.categoryId,
          description,
          unit,
          base.toString(),
          bp,
          price.toString(),
          s.actorId,
        ],
      )
    ).rows[0];
  } else
    row = (
      await c.query(
        'INSERT INTO planning_items(plan_id,category_id,description,unit,base_price_cents,inflation_bp,adjusted_price_cents,created_by,updated_by,source_import_id,source_worksheet,source_row,source_formula) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12) RETURNING *',
        [
          p.id,
          input.categoryId,
          description,
          unit,
          base.toString(),
          bp,
          price.toString(),
          s.actorId,
          source?.batchId ?? null,
          source?.sheet ?? null,
          source?.row ?? null,
          source?.formula ?? null,
        ],
      )
    ).rows[0];
  for (let m = 0; m < 12; m++)
    await c.query(
      'INSERT INTO planning_months(item_id,planned_month,quantity,unit_price_cents,amount_cents) VALUES($1,$2,$3,$4,$5) ON CONFLICT(item_id,planned_month) DO UPDATE SET quantity=EXCLUDED.quantity,unit_price_cents=EXCLUDED.unit_price_cents,amount_cents=EXCLUDED.amount_cents',
      [
        row.id,
        `${p.financial_year}-${String(m + 1).padStart(2, '0')}-01`,
        q[m] === null ? null : decimal(q[m]!, 3),
        price.toString(),
        monthAmount(price, q[m])?.toString() ?? null,
      ],
    );
  if (source && itemId)
    row = (
      await c.query(
        'UPDATE planning_items SET source_import_id=$2,source_worksheet=$3,source_row=$4,source_formula=$5 WHERE id=$1 RETURNING *',
        [row.id, source.batchId, source.sheet, source.row, source.formula],
      )
    ).rows[0];
  return {
    entity: 'item',
    entityId: row.id,
    previous: prior,
    updated: { ...row, quantities: q.map((v) => (v === null ? null : decimal(v, 3))) },
  };
}
export async function saveItem(
  s: PlanningScope,
  planId: unknown,
  itemId: unknown | null,
  input: Row,
) {
  return mutate(s, planId, input.version, itemId ? 'UPDATE_ITEM' : 'CREATE_ITEM', (c, p) =>
    writeItem(c, s, p, itemId, input),
  );
}
async function writeUniform(
  c: PoolClient,
  s: PlanningScope,
  p: Plan,
  uniformId: unknown | null,
  input: Row,
  source?: { batchId: number; sheet: string; row: number; formula: string },
) {
  await category(c, p, input.categoryId);
  const description = text(input.description, 'Uniform type'),
    calc = uniformCalculation(input as UniformInput);
  let prior: Row | null = null;
  if (uniformId) {
    prior = (
      await c.query('SELECT * FROM planning_uniforms WHERE id=$1 AND plan_id=$2 AND is_active', [
        id(uniformId),
        p.id,
      ])
    ).rows[0];
    assert(prior, 'UNIFORM_NOT_FOUND', 'Uniform projection not found.', 404);
  }
  const values = [
    p.id,
    input.categoryId,
    description,
    calc.balance,
    text(input.balanceLabel, 'Balance reference period', 160),
    calc.buyingCostCents,
    calc.contributionBp,
    calc.staffCount,
    calc.quantityPerStaff,
    calc.balanceRule,
    calc.projectedQuantity,
    calc.purchaseQuantity,
    calc.grossCents,
    calc.contributionCents,
    calc.totalCents,
    s.actorId,
    source?.batchId ?? prior?.source_import_id ?? null,
    source?.sheet ?? prior?.source_worksheet ?? null,
    source?.row ?? prior?.source_row ?? null,
    source?.formula ?? prior?.source_formula ?? null,
  ];
  const columns = [
    'plan_id',
    'category_id',
    'description',
    'existing_balance',
    'balance_label',
    'buying_cost_cents',
    'contribution_bp',
    'staff_count',
    'quantity_per_staff',
    'balance_rule',
    'projected_quantity',
    'purchase_quantity',
    'gross_cents',
    'contribution_cents',
    'total_cents',
    'updated_by',
    'source_import_id',
    'source_worksheet',
    'source_row',
    'source_formula',
  ];
  const row = prior
    ? (
        await c.query(
          `UPDATE planning_uniforms SET ${columns.map((name, n) => `${name}=$${n + 1}`).join(',')},updated_at=now() WHERE id=$21 RETURNING *`,
          [...values, prior.id],
        )
      ).rows[0]
    : (
        await c.query(
          `INSERT INTO planning_uniforms(${columns.join(',')},created_by) VALUES(${values.map((_, n) => `$${n + 1}`).join(',')},$16) RETURNING *`,
          values,
        )
      ).rows[0];
  return { entity: 'uniform', entityId: row.id, previous: prior, updated: row };
}
export async function saveUniform(
  s: PlanningScope,
  planId: unknown,
  uniformId: unknown | null,
  input: Row,
) {
  return mutate(s, planId, input.version, uniformId ? 'UPDATE_UNIFORM' : 'CREATE_UNIFORM', (c, p) =>
    writeUniform(c, s, p, uniformId, input),
  );
}
export async function archiveRecord(
  s: PlanningScope,
  planId: unknown,
  kind: 'items' | 'uniforms',
  recordId: unknown,
  version: unknown,
) {
  return mutate(s, planId, version, 'ARCHIVE_RECORD', async (c, p) => {
    const table = kind === 'items' ? 'planning_items' : 'planning_uniforms';
    const prior = (
      await c.query(`SELECT * FROM ${table} WHERE id=$1 AND plan_id=$2 AND is_active`, [
        id(recordId),
        p.id,
      ])
    ).rows[0];
    assert(prior, 'RECORD_NOT_FOUND', 'Record not found.', 404);
    await c.query(
      `UPDATE ${table} SET is_active=false,updated_by=$2,updated_at=now() WHERE id=$1`,
      [prior.id, s.actorId],
    );
    return {
      entity: kind,
      entityId: prior.id,
      previous: prior,
      updated: { ...prior, is_active: false },
    };
  });
}
export async function auditHistory(s: PlanningScope, planId?: unknown, page = 1) {
  if (planId) await transaction((c) => scopedPlan(c, s, planId));
  assert(Number.isSafeInteger(page) && page > 0, 'INVALID_PAGE', 'Choose a valid page.');
  return (
    await pool.query(
      'SELECT * FROM planning_events WHERE tenant_id=$1 AND facility_id=$2 AND ($3::int IS NULL OR plan_id=$3) ORDER BY id DESC LIMIT 50 OFFSET $4',
      [s.tenantId, s.facilityId, planId ? id(planId) : null, (page - 1) * 50],
    )
  ).rows;
}
export async function importHistory(s: PlanningScope) {
  return (
    await pool.query(
      'SELECT id,filename,mime,sha256,byte_size,uploaded_by,created_at,status,result,validation FROM planning_import_batches WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id DESC LIMIT 100',
      [s.tenantId, s.facilityId],
    )
  ).rows;
}
export async function upload(s: PlanningScope, bytes: Buffer, filename: string, mime: string) {
  const book = await parseWorkbook(bytes, filename, mime);
  const hash = createHash('sha256').update(bytes).digest('hex');
  return transaction(async (c) => {
    const exists = (
      await c.query(
        'SELECT id,status FROM planning_import_batches WHERE tenant_id=$1 AND facility_id=$2 AND sha256=$3',
        [s.tenantId, s.facilityId, hash],
      )
    ).rows[0];
    assert(
      !exists,
      'DUPLICATE_UPLOAD',
      exists?.status === 'CANCELLED'
        ? `This exact file is retained as cancelled batch ${exists.id}. In Import history, inspect it or explicitly choose Retry review. Re-uploading the same bytes cannot create another batch; nothing has been reopened or imported.`
        : `This workbook was already uploaded (batch ${exists?.id}, ${exists?.status}); use its history entry.`,
      409,
    );
    const row = (
      await c.query(
        'INSERT INTO planning_import_batches(tenant_id,facility_id,filename,mime,sha256,byte_size,source_bytes,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,filename,sha256,byte_size,status',
        [
          s.tenantId,
          s.facilityId,
          text(filename, 'Filename', 240),
          mime,
          hash,
          bytes.length,
          bytes,
          s.actorId,
        ],
      )
    ).rows[0];
    await event(
      c,
      s,
      'UPLOAD_WORKBOOK',
      null,
      {
        updated: {
          ...row,
          sheets: book.sheets.map((sh) => ({ name: sh.name, rows: sh.rows.length })),
        },
      },
      row.id,
    );
    return {
      ...row,
      sheets: book.sheets.map((sh) => ({
        name: sh.name,
        rows: sh.rows.length,
        preview: sh.rows.slice(0, 40),
      })),
    };
  });
}
async function batch(c: PoolClient, s: PlanningScope, batchId: unknown, lock = false) {
  const row = (
    await c.query(
      `SELECT * FROM planning_import_batches WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 ${lock ? 'FOR UPDATE' : ''}`,
      [id(batchId), s.tenantId, s.facilityId],
    )
  ).rows[0];
  assert(row, 'IMPORT_NOT_FOUND', 'Import batch not found.', 404);
  return row;
}
export async function inspectBatch(s: PlanningScope, batchId: unknown) {
  const r = await transaction((c) => batch(c, s, batchId));
  const book = await parseWorkbook(r.source_bytes, r.filename, r.mime);
  return {
    id: r.id,
    status: r.status,
    sheets: book.sheets.map((sh) => ({
      name: sh.name,
      rows: sh.rows.length,
      preview: sh.rows.slice(0, 40),
    })),
  };
}
export async function previewImport(s: PlanningScope, batchId: unknown, input: Row) {
  const r = await transaction((c) => batch(c, s, batchId));
  assert(r.status === 'UPLOADED', 'IMPORT_CLOSED', 'Import is no longer open.', 409);
  const book = await parseWorkbook(r.source_bytes, r.filename, r.mime),
    preview = previewWorkbook(
      book,
      input.mappings as Mapping[],
      input.inflationPercent,
      input.policy as import('./workbook.ts').ImportPolicy | undefined,
    );
  return transaction(async (c) => {
    const locked = await batch(c, s, batchId, true);
    assert(locked.status === 'UPLOADED', 'IMPORT_CLOSED', 'Import is no longer open.', 409);
    const { destination } = await resolveImportDestination(c, s, input, true);
    const counts = await importReviewCounts(c, destination, preview);
    const previewHash = destinationPreviewHash(preview.previewHash, r.sha256, destination, counts);
    const reviewed = {
      ...preview,
      workbookPreviewHash: preview.previewHash,
      previewHash,
      destination,
      counts,
    };
    await c.query('UPDATE planning_import_batches SET validation=$2 WHERE id=$1', [
      r.id,
      JSON.stringify({
        rows: preview.rowCount,
        previewHash,
        workbookPreviewHash: preview.previewHash,
        destination,
        counts,
        errors: preview.errors,
        warnings: preview.warnings,
        policy: preview.policy,
        normalizations: preview.normalizations,
      }),
    ]);
    await event(
      c,
      s,
      'PREVIEW_IMPORT',
      null,
      {
        updated: {
          hash: previewHash,
          rows: preview.rowCount,
          errors: preview.errors,
          destination,
          counts,
        },
      },
      r.id,
    );
    return reviewed;
  });
}

export async function cancelImport(s: PlanningScope, batchId: unknown) {
  return transaction(async (c) => {
    const r = await batch(c, s, batchId, true);
    assert(r.status === 'UPLOADED', 'IMPORT_CLOSED', 'Only pending imports may be cancelled.', 409);
    await c.query("UPDATE planning_import_batches SET status='CANCELLED' WHERE id=$1", [r.id]);
    await event(c, s, 'CANCEL_IMPORT', null, {}, r.id);
    return { cancelled: true };
  });
}
/** Explicit retry of review only: retain the source batch identity and cancellation audit. */
export async function retryImportReview(s: PlanningScope, batchId: unknown, input: Row) {
  assert(
    input.confirmRetry === true,
    'RETRY_CONFIRM_REQUIRED',
    'Explicitly confirm retrying review of this cancelled batch.',
  );
  return transaction(async (c) => {
    const r = await batch(c, s, batchId, true);
    assert(
      r.status === 'CANCELLED',
      'IMPORT_NOT_CANCELLED',
      'Only a cancelled batch can be retried for review.',
      409,
    );
    const references = await c.query(
      `SELECT 1 FROM planning_plans WHERE source_import_id=$1
       UNION ALL SELECT 1 FROM planning_items WHERE source_import_id=$1
       UNION ALL SELECT 1 FROM planning_uniforms WHERE source_import_id=$1
       UNION ALL SELECT 1 FROM planning_events WHERE import_id=$1 AND action='CONFIRM_IMPORT' LIMIT 1`,
      [r.id],
    );
    assert(
      !r.result && !references.rowCount,
      'IMPORT_ALREADY_APPLIED',
      'This batch has import results or linked plan data. Retry is blocked; investigate its audit history.',
      409,
    );
    await c.query(
      "UPDATE planning_import_batches SET status='UPLOADED',validation=NULL WHERE id=$1",
      [r.id],
    );
    await event(
      c,
      s,
      'RETRY_IMPORT_REVIEW',
      null,
      {
        entity: 'import',
        entityId: r.id,
        previous: { status: r.status, validation: r.validation },
        updated: { status: 'UPLOADED', validation: null, sha256: r.sha256, confirmRetry: true },
      },
      r.id,
    );
    return { id: r.id, status: 'UPLOADED', requiresPreview: true };
  });
}
export async function confirmImport(s: PlanningScope, batchId: unknown, input: Row) {
  assert(input.confirm === true, 'CONFIRM_REQUIRED', 'Explicit import confirmation is required.');
  const source = await transaction((c) => batch(c, s, batchId));
  const book = await parseWorkbook(source.source_bytes, source.filename, source.mime),
    preview = previewWorkbook(
      book,
      input.mappings as Mapping[],
      input.inflationPercent,
      input.policy as import('./workbook.ts').ImportPolicy | undefined,
    );
  assertReviewedDestination(source.validation, input, preview.previewHash, source.sha256);
  if (source.status === 'IMPORTED') return source.result;
  assert(
    !preview.errors.length && preview.rowCount > 0,
    'INVALID_IMPORT',
    'Resolve every validation error before import.',
  );
  assert(
    ['NEW', 'SKIP', 'UPDATE'].includes(String(input.mode)),
    'IMPORT_MODE',
    'Choose NEW, SKIP existing, or UPDATE matching draft records.',
  );
  if (input.mode === 'UPDATE')
    assert(
      input.confirmUpdate === true,
      'CONFIRM_UPDATE',
      'Explicitly confirm updates to matching draft records.',
    );
  return transaction(async (c) => {
    const b = await batch(c, s, batchId, true);
    assertReviewedDestination(b.validation, input, preview.previewHash, b.sha256);
    if (b.status === 'IMPORTED') return b.result;
    assert(b.status === 'UPLOADED', 'IMPORT_CLOSED', 'Import was cancelled.', 409);
    const resolved = await resolveImportDestination(c, s, input, true);
    const counts = await importReviewCounts(c, resolved.destination, preview);
    assert(
      !counts.conflictingItems,
      'IMPORT_CONFLICTS',
      'Resolve the conflicting target rows before import.',
      409,
    );
    assert(
      destinationPreviewHash(preview.previewHash, b.sha256, resolved.destination, counts) ===
        input.previewHash,
      'PREVIEW_CHANGED',
      'The destination or matching records changed. Preview again.',
      409,
    );
    let p: Plan =
      resolved.plan ??
      (await createInside(
        c,
        s,
        { ...input, financialYear: resolved.destination.financialYear },
        b.id,
      ));
    let created = 0,
      updated = 0,
      skipped = 0;
    for (const [kind, rows] of [
      ['ITEM', preview.items],
      ['UNIFORM', preview.uniforms],
    ] as const)
      for (const raw of rows) {
        const item = raw as Row;
        let cat = (
          await c.query('SELECT * FROM planning_categories WHERE plan_id=$1 AND name=$2', [
            p.id,
            item.category,
          ])
        ).rows[0];
        if (!cat)
          cat = (
            await c.query(
              'INSERT INTO planning_categories(plan_id,tenant_id,facility_id,name) VALUES($1,$2,$3,$4) RETURNING *',
              [p.id, s.tenantId, s.facilityId, item.category],
            )
          ).rows[0];
        assert(
          cat.is_active,
          'CATEGORY_INACTIVE',
          'Reactivate or choose another category before merging.',
        );
        const candidates = await matchImportRow(c, p.id, cat.id, kind, item);
        assert(
          candidates.length <= 1,
          'AMBIGUOUS_SOURCE_ROW',
          'Multiple existing source rows match. Resolve the target draft before merging.',
          409,
        );
        const existing = candidates[0];
        if (existing && input.mode === 'SKIP') {
          skipped++;
          continue;
        }
        assert(
          !existing || input.mode === 'UPDATE',
          'DUPLICATE_ITEM',
          'A matching item exists. Choose explicit skip or update mode.',
          409,
        );
        const meta = {
            batchId: b.id,
            sheet: item.sourceWorksheet,
            row: item.sourceRow,
            formula: item.sourceFormula,
          },
          values = { ...item, categoryId: cat.id };
        const change =
          kind === 'ITEM'
            ? await writeItem(c, s, p, existing?.id ?? null, values, meta)
            : await writeUniform(c, s, p, existing?.id ?? null, values, meta);
        await event(c, s, existing ? 'IMPORT_UPDATE' : 'IMPORT_CREATE', p.id, change, b.id);
        if (existing) updated++;
        else created++;
      }
    p = await bump(c, s, p);
    const result = {
      planId: p.id,
      version: p.version,
      created,
      updated,
      skipped,
      sourceRows: preview.rowCount,
      validationErrors: 0,
      policy: preview.policy,
      defaultedCells: preview.normalizations.length,
    };
    await c.query("UPDATE planning_import_batches SET status='IMPORTED',result=$2 WHERE id=$1", [
      b.id,
      JSON.stringify(result),
    ]);
    await event(c, s, 'CONFIRM_IMPORT', p.id, { updated: result }, b.id);
    return result;
  });
}
export { PlanningError };
