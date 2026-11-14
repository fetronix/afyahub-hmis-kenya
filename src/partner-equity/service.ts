import type { PoolClient } from 'pg';
import { transaction, type PlanningScope } from '../budget-planning/planning.service.ts';
import { PlanningError } from '../budget-planning/calculations.ts';
import {
  baselineEquity,
  baselinePartners,
  emptyInputs,
  inputKeys,
  type EquityModel,
  type Partner,
} from './model.ts';
import {
  calculateEquity,
  validDate,
  validateEquity,
  validatePartner,
  requireValue,
} from './calculations.ts';
export type Scope = PlanningScope;
export type Statement = {
  id: number;
  tenant_id: number;
  facility_id: number;
  financial_year: number;
  period_kind: 'ANNUAL' | 'OTHER';
  period_name: string;
  start_date: string;
  end_date: string;
  revision: number;
  parent_id: number | null;
  status: 'DRAFT' | 'UNDER_REVIEW' | 'APPROVED';
  version: number;
  model: EquityModel;
  review_acceptance: string | null;
  revision_reason: string | null;
  carry_source_id: number | null;
  prepared_by: number;
  prepared_at: string;
  updated_by: number;
  updated_at: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  approved_by: number | null;
  approved_at: string | null;
  facility_name?: string;
  prepared_name?: string;
  reviewed_name?: string;
  approved_name?: string;
};
function assert(ok: unknown, code: string, message: string, status = 400): asserts ok {
  if (!ok) throw new PlanningError(code, message, status);
}
function identifier(v: unknown) {
  const n = Number(v);
  assert(Number.isSafeInteger(n) && n > 0, 'INVALID_ID', 'A valid identifier is required.');
  return n;
}
function reason(v: unknown) {
  assert(
    typeof v === 'string' && v.trim().length >= 10 && v.trim().length <= 500,
    'REASON_REQUIRED',
    'An audit reason of 10–500 characters is required.',
  );
  return v.trim();
}
async function audit(
  c: PoolClient,
  s: Scope,
  statementId: number | null,
  action: string,
  previous: unknown,
  next: unknown,
  why: string,
) {
  await c.query(
    'INSERT INTO equity_events(tenant_id,facility_id,statement_id,action,actor_id,previous_values,new_values,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      s.tenantId,
      s.facilityId,
      statementId,
      action,
      s.actorId,
      JSON.stringify(previous),
      JSON.stringify(next),
      why,
    ],
  );
}
async function record(c: PoolClient, s: Scope, id: unknown, lock = false): Promise<Statement> {
  const r = (
    await c.query(
      `SELECT *,start_date::text,end_date::text FROM equity_statements WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 ${lock ? 'FOR UPDATE' : ''}`,
      [identifier(id), s.tenantId, s.facilityId],
    )
  ).rows[0];
  assert(r, 'STATEMENT_NOT_FOUND', 'Statement is not available in this facility.', 404);
  return r;
}
function version(row: { version: number }, v: unknown) {
  assert(
    row.version === Number(v),
    'VERSION_CONFLICT',
    'The record changed. Reload before saving.',
    409,
  );
}
export function register(s: Scope) {
  return transaction(async (c) => {
    const r = (
      await c.query(
        'SELECT version,partners FROM equity_partner_register WHERE tenant_id=$1 AND facility_id=$2',
        [s.tenantId, s.facilityId],
      )
    ).rows[0];
    return r ?? { version: 0, partners: baselinePartners() };
  });
}
export async function savePartner(s: Scope, input: Record<string, unknown>) {
  const why = reason(input.reason),
    p = validatePartner(input.partner);
  return transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1,$2)', [s.tenantId, s.facilityId]);
    const current = (
      await c.query(
        'SELECT version,partners FROM equity_partner_register WHERE tenant_id=$1 AND facility_id=$2 FOR UPDATE',
        [s.tenantId, s.facilityId],
      )
    ).rows[0] ?? { version: 0, partners: baselinePartners() };
    version(current, input.version);
    const partners: Partner[] = current.partners;
    const old = partners.find((x) => x.id === p.id);
    assert(old || !p.original, 'ORIGINAL_IDENTITY', 'Original partners cannot be recreated.');
    assert(old || !p.id.startsWith('original-'), 'ORIGINAL_IDENTITY', 'Invalid source partner.');
    assert(old || partners.length < 30, 'PARTNER_LIMIT', 'At most 30 partners.');
    const next = old ? partners.map((x) => (x.id === p.id ? p : x)) : [...partners, p];
    requireValue(new Set(next.map((x) => x.id)).size === next.length, 'Duplicate partner.');
    await c.query(
      'INSERT INTO equity_partner_register(tenant_id,facility_id,version,partners) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,facility_id) DO UPDATE SET version=EXCLUDED.version,partners=EXCLUDED.partners',
      [s.tenantId, s.facilityId, current.version + 1, JSON.stringify(next)],
    );
    await audit(
      c,
      s,
      null,
      old ? 'UPDATE_PARTNER' : 'ADD_PARTNER',
      current,
      { version: current.version + 1, partners: next },
      why,
    );
    return { version: current.version + 1, partners: next };
  });
}
export async function listStatements(s: Scope, year: unknown) {
  const y = Number(year);
  assert(
    Number.isInteger(y) && y >= 2000 && y <= 2200,
    'INVALID_YEAR',
    'Choose a financial year (2000–2200).',
  );
  return transaction(
    async (c) =>
      (
        await c.query(
          'SELECT id,financial_year,period_kind,period_name,start_date::text,end_date::text,revision,status,version FROM equity_statements WHERE tenant_id=$1 AND facility_id=$2 AND financial_year=$3 ORDER BY start_date,revision DESC',
          [s.tenantId, s.facilityId, y],
        )
      ).rows,
  );
}
export async function getStatement(s: Scope, id: unknown) {
  return transaction(async (c) => {
    const row = await record(c, s, id);
    const names = (
      await c.query('SELECT id,full_name FROM users WHERE tenant_id=$1 AND id=ANY($2::integer[])', [
        s.tenantId,
        [row.prepared_by, row.reviewed_by, row.approved_by].filter(Boolean),
      ])
    ).rows;
    const name = (id: number | null) => names.find((n) => n.id === id)?.full_name ?? null;
    return {
      ...row,
      facility_name: (
        await c.query('SELECT name FROM facilities WHERE id=$1 AND tenant_id=$2', [
          s.facilityId,
          s.tenantId,
        ])
      ).rows[0]?.name,
      prepared_name: name(row.prepared_by),
      reviewed_name: name(row.reviewed_by),
      approved_name: name(row.approved_by),
      calculation: calculateEquity(row.model),
    };
  });
}
export async function createStatement(s: Scope, input: Record<string, unknown>) {
  const why = reason(input.reason),
    year = Number(input.financialYear),
    start = String(input.startDate),
    end = String(input.endDate),
    name = String(input.periodName ?? '').trim(),
    kind = input.periodKind;
  assert(
    Number.isInteger(year) &&
      year >= 2000 &&
      year <= 2200 &&
      validDate(start) &&
      validDate(end) &&
      start <= end &&
      Number(end.slice(0, 4)) === year,
    'INVALID_PERIOD',
    'Choose valid dates and the financial year in which the period ends.',
  );
  assert(
    ['ANNUAL', 'OTHER'].includes(String(kind)) && name.length > 0 && name.length <= 100,
    'INVALID_PERIOD',
    'Name the annual or other reporting period.',
  );
  if (kind === 'ANNUAL')
    assert(
      [365, 366].includes((Date.parse(end) - Date.parse(start)) / 86400000 + 1),
      'INVALID_ANNUAL',
      'Annual periods must cover 365 or 366 days.',
    );
  const source = input.source === 'SYRONA_SCREENSHOT';
  assert(
    source || input.source === 'BLANK',
    'INVALID_SOURCE',
    'Choose screenshot baseline or blank inputs.',
  );
  if (source)
    assert(
      year === 2026 && start === '2025-07-01' && end === '2026-06-30',
      'SOURCE_PERIOD',
      'The screenshot baseline belongs only to July 2025–June 2026.',
    );
  return transaction(async (c) => {
    const directory = (
      await c.query(
        'SELECT partners FROM equity_partner_register WHERE tenant_id=$1 AND facility_id=$2',
        [s.tenantId, s.facilityId],
      )
    ).rows[0]?.partners as Partner[] | undefined;
    const model = source
      ? baselineEquity()
      : ({
          schemaVersion: 1 as const,
          netResult: '0.00',
          partners: (directory ?? baselinePartners()).filter(
            (p) =>
              p.original ||
              (p.admittedOn !== null &&
                p.admittedOn <= end &&
                (!p.departedOn || p.departedOn >= start)),
          ),
          inputs: {},
        } as EquityModel);
    if (!source) for (const p of model.partners) model.inputs[p.id] = emptyInputs();
    validateEquity(model);
    const row = (
      await c.query(
        'INSERT INTO equity_statements(tenant_id,facility_id,financial_year,period_kind,period_name,start_date,end_date,model,prepared_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id',
        [s.tenantId, s.facilityId, year, kind, name, start, end, JSON.stringify(model), s.actorId],
      )
    ).rows[0];
    await audit(
      c,
      s,
      row.id,
      'CREATE_STATEMENT',
      null,
      { model, period: { year, start, end, name, kind }, source: source ? 'SCREENSHOT' : 'BLANK' },
      why,
    );
    return row;
  });
}
export async function saveStatement(s: Scope, id: unknown, input: Record<string, unknown>) {
  const why = reason(input.reason),
    model = validateEquity(input.model);
  calculateEquity(model);
  return transaction(async (c) => {
    const old = await record(c, s, id, true);
    version(old, input.version);
    assert(old.status === 'DRAFT', 'STATEMENT_PROTECTED', 'Only draft inputs can change.', 409);
    assert(
      JSON.stringify(validateEquity(old.model).partners) === JSON.stringify(model.partners),
      'PARTNER_SNAPSHOT_PROTECTED',
      'Use explicit partner inclusion; historical snapshots cannot be rewritten.',
    );
    const next = (
      await c.query(
        'UPDATE equity_statements SET model=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id=$3 RETURNING *,start_date::text,end_date::text',
        [JSON.stringify(model), s.actorId, old.id],
      )
    ).rows[0];
    await audit(c, s, old.id, 'EDIT_STATEMENT', old, next, why);
    return next;
  });
}
export async function transition(s: Scope, id: unknown, input: Record<string, unknown>) {
  const why = reason(input.reason),
    action = String(input.action);
  return transaction(async (c) => {
    const old = await record(c, s, id, true);
    version(old, input.version);
    assert(
      old.status !== 'APPROVED',
      'STATEMENT_PROTECTED',
      'Approved statements require a controlled revision.',
      409,
    );
    let patch;
    if (action === 'submit') {
      assert(old.status === 'DRAFT', 'INVALID_TRANSITION', 'Submit a draft only.');
      assert(
        calculateEquity(old.model).issues.length === 0,
        'RECONCILIATION_REQUIRED',
        'Resolve calculation issues before review.',
      );
      patch = { status: 'UNDER_REVIEW', reviewed: null, acceptance: null, approved: null };
    } else if (action === 'return') {
      assert(
        old.status === 'UNDER_REVIEW',
        'INVALID_TRANSITION',
        'Only statements under review can be returned.',
      );
      patch = { status: 'DRAFT', reviewed: null, acceptance: null, approved: null };
    } else if (action === 'review') {
      assert(
        old.status === 'UNDER_REVIEW' && s.actorId !== old.updated_by,
        'INDEPENDENT_REVIEW_REQUIRED',
        'A reviewer other than the last editor must accept the provisional formula definitions.',
        409,
      );
      assert(
        input.acceptance === 'ACCEPT PROVISIONAL SCREENSHOT FORMULAS',
        'FORMULA_REVIEW_REQUIRED',
        'Type ACCEPT PROVISIONAL SCREENSHOT FORMULAS. This is not workbook verification.',
      );
      assert(
        calculateEquity(old.model).issues.length === 0,
        'RECONCILIATION_REQUIRED',
        'Calculation issues remain.',
      );
      patch = { status: 'UNDER_REVIEW', reviewed: s.actorId, acceptance: why, approved: null };
    } else {
      assert(
        action === 'approve' &&
          old.status === 'UNDER_REVIEW' &&
          old.reviewed_by &&
          old.review_acceptance &&
          s.actorId !== old.updated_by,
        'APPROVAL_RESTRICTED',
        'Approval requires independent review and a non-editor approver.',
        409,
      );
      assert(
        calculateEquity(old.model).issues.length === 0,
        'RECONCILIATION_REQUIRED',
        'Calculation issues remain.',
      );
      patch = {
        status: 'APPROVED',
        reviewed: old.reviewed_by,
        acceptance: old.review_acceptance,
        approved: s.actorId,
      };
    }
    const next = (
      await c.query(
        'UPDATE equity_statements SET status=$1,reviewed_by=$2,review_acceptance=$3,reviewed_at=CASE WHEN $2::integer IS NULL THEN NULL ELSE COALESCE(reviewed_at,now()) END,approved_by=$4,approved_at=CASE WHEN $4::integer IS NULL THEN NULL ELSE now() END,version=version+1,updated_at=now() WHERE id=$5 RETURNING *,start_date::text,end_date::text',
        [patch.status, patch.reviewed, patch.acceptance, patch.approved, old.id],
      )
    ).rows[0];
    await audit(c, s, old.id, action.toUpperCase(), old, next, why);
    return next;
  });
}
export async function revise(s: Scope, id: unknown, input: Record<string, unknown>) {
  const why = reason(input.reason);
  return transaction(async (c) => {
    const old = await record(c, s, id, true);
    version(old, input.version);
    assert(
      old.status === 'APPROVED',
      'REVISION_RESTRICTED',
      'Only approved statements require a controlled revision.',
      409,
    );
    const latest = (
      await c.query(
        'SELECT max(revision)::int revision FROM equity_statements WHERE tenant_id=$1 AND facility_id=$2 AND start_date=$3 AND end_date=$4',
        [s.tenantId, s.facilityId, old.start_date, old.end_date],
      )
    ).rows[0].revision;
    assert(
      latest === old.revision,
      'REVISION_EXISTS',
      'Open the latest revision before creating another.',
      409,
    );
    const row = (
      await c.query(
        'INSERT INTO equity_statements(tenant_id,facility_id,financial_year,period_kind,period_name,start_date,end_date,revision,parent_id,model,prepared_by,updated_by,revision_reason,carry_source_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13) RETURNING id',
        [
          s.tenantId,
          s.facilityId,
          old.financial_year,
          old.period_kind,
          old.period_name,
          old.start_date,
          old.end_date,
          old.revision + 1,
          old.id,
          JSON.stringify(old.model),
          s.actorId,
          why,
          old.carry_source_id,
        ],
      )
    ).rows[0];
    await audit(
      c,
      s,
      row.id,
      'REVISE_APPROVED',
      old,
      { id: row.id, parentId: old.id, revision: old.revision + 1 },
      why,
    );
    return row;
  });
}
export async function includePartner(s: Scope, id: unknown, input: Record<string, unknown>) {
  const why = reason(input.reason);
  return transaction(async (c) => {
    const old = await record(c, s, id, true);
    version(old, input.version);
    assert(
      old.status === 'DRAFT',
      'STATEMENT_PROTECTED',
      'Only a draft can include a newly admitted partner.',
      409,
    );
    const dir = (
      await c.query(
        'SELECT partners FROM equity_partner_register WHERE tenant_id=$1 AND facility_id=$2',
        [s.tenantId, s.facilityId],
      )
    ).rows[0];
    const p = (dir?.partners as Partner[] | undefined)?.find((p) => p.id === input.partnerId);
    assert(
      p &&
        p.admittedOn !== null &&
        p.admittedOn <= old.end_date &&
        (!p.departedOn || p.departedOn >= old.start_date),
      'PARTNER_PERIOD_MISMATCH',
      'Select a registered partner admitted during or before this period.',
    );
    assert(
      !old.model.partners.some((x) => x.id === p.id),
      'PARTNER_EXISTS',
      'Partner already included.',
    );
    const model = {
      ...old.model,
      partners: [...old.model.partners, p],
      inputs: { ...old.model.inputs, [p.id]: emptyInputs() },
    };
    validateEquity(model);
    const next = (
      await c.query(
        'UPDATE equity_statements SET model=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id=$3 RETURNING *,start_date::text,end_date::text',
        [JSON.stringify(model), s.actorId, old.id],
      )
    ).rows[0];
    await audit(c, s, old.id, 'INCLUDE_PARTNER', old, next, why);
    return next;
  });
}
async function carryData(c: PoolClient, s: Scope, targetId: unknown, sourceId: unknown) {
  const target = await record(c, s, targetId),
    source = await record(c, s, sourceId);
  assert(
    target.status === 'DRAFT' &&
      source.status === 'APPROVED' &&
      source.end_date < target.start_date,
    'CARRY_SOURCE_RESTRICTED',
    'Choose an earlier approved statement and a draft destination.',
    409,
  );
  const calc = calculateEquity(source.model);
  assert(!calc.issues.length, 'CARRY_RECONCILIATION', 'Source has calculation issues.');
  return {
    target,
    source,
    opening: source.model.partners.map((p) => ({ partner: p, amount: calc.cells.closing[p.id] })),
    total: calc.totals.closing,
    displayRoundingCents: calc.rounding.closingCents,
  };
}
export function carryPreview(s: Scope, id: unknown, source: unknown) {
  return transaction(async (c) => carryData(c, s, id, source));
}
export function carryForward(s: Scope, id: unknown, input: Record<string, unknown>) {
  const why = reason(input.reason);
  return transaction(async (c) => {
    const locked = await record(c, s, id, true);
    version(locked, input.version);
    const data = await carryData(c, s, id, input.sourceId);
    version(data.source, input.sourceVersion);
    assert(
      input.confirmation === 'CARRY REVIEWED OPENING BALANCES' &&
        input.roundingCents === data.displayRoundingCents,
      'CARRY_CONFIRMATION_REQUIRED',
      'Review the source and rounding difference, then type CARRY REVIEWED OPENING BALANCES.',
    );
    const model = structuredClone(locked.model);
    for (const item of data.opening) {
      if (!model.partners.some((p) => p.id === item.partner.id)) {
        model.partners.push(item.partner);
        model.inputs[item.partner.id] = emptyInputs();
      }
      model.inputs[item.partner.id].opening = item.amount;
    }
    validateEquity(model);
    const next = (
      await c.query(
        'UPDATE equity_statements SET model=$1,carry_source_id=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$4 RETURNING *,start_date::text,end_date::text',
        [JSON.stringify(model), data.source.id, s.actorId, locked.id],
      )
    ).rows[0];
    await audit(
      c,
      s,
      locked.id,
      'CARRY_FORWARD',
      locked,
      {
        ...next,
        carryReview: {
          sourceId: data.source.id,
          sourceVersion: data.source.version,
          total: data.total,
          displayRoundingCents: data.displayRoundingCents,
        },
      },
      why,
    );
    return next;
  });
}
export function history(s: Scope, id: unknown) {
  return transaction(async (c) => {
    await record(c, s, id);
    return (
      await c.query(
        'SELECT id,action,actor_id,created_at,reason,previous_values,new_values FROM equity_events WHERE tenant_id=$1 AND facility_id=$2 AND statement_id=$3 ORDER BY id DESC LIMIT 200',
        [s.tenantId, s.facilityId, identifier(id)],
      )
    ).rows;
  });
}
export function exportAudit(s: Scope, id: unknown, format: string, version: number) {
  return transaction(async (c) => {
    const current = await record(c, s, id);
    assert(
      current.version === version,
      'VERSION_CONFLICT',
      'Statement changed during export. Reload.',
      409,
    );
    await audit(
      c,
      s,
      current.id,
      'EXPORT_STATEMENT',
      null,
      { format, version },
      'Explicit authorized full statement export',
    );
  });
}
