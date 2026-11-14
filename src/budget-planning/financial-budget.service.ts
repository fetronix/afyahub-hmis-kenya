import { transaction, scopedPlan, event, type PlanningScope } from './planning.service.ts';
import { assert, id, PlanningError } from './calculations.ts';
import { createFinancialBaseline, financialResetImpact } from './financial-budget.model.ts';
import { validateFinancialBudget } from './financial-budget.engine.ts';
export async function financialBudget(s: PlanningScope, planId: unknown) {
  return transaction(async (c) => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const plan = await scopedPlan(c, s, planId);
    const facility = (
      await c.query('SELECT id,name FROM facilities WHERE tenant_id=$1 AND id=$2', [
        s.tenantId,
        s.facilityId,
      ])
    ).rows[0];
    const saved = (
      await c.query(
        'SELECT model FROM planning_financial_budgets WHERE tenant_id=$1 AND facility_id=$2 AND plan_id=$3',
        [s.tenantId, s.facilityId, plan.id],
      )
    ).rows[0];
    return { plan, facility, model: saved?.model ?? null };
  });
}
export async function saveFinancialBudget(
  s: PlanningScope,
  planId: unknown,
  input: Record<string, unknown>,
  reset = false,
) {
  if (reset)
    assert(
      input.confirmation === 'RESET FINANCIAL BASELINE',
      'CONFIRMATION_REQUIRED',
      'Type RESET FINANCIAL BASELINE exactly.',
    );
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reset)
    assert(
      reason.length >= 10 && reason.length <= 500,
      'RESET_REASON_REQUIRED',
      'Provide an audit reason of 10–500 characters.',
    );
  let model;
  try {
    model = validateFinancialBudget(reset ? createFinancialBaseline() : input.model);
  } catch (e) {
    throw new PlanningError(
      'INVALID_FINANCIAL_BUDGET',
      e instanceof Error ? e.message : 'Invalid budget model.',
      400,
    );
  }
  return transaction(async (c) => {
    const plan = await scopedPlan(c, s, planId, true);
    assert(
      plan.status === 'DRAFT',
      'PLAN_PROTECTED',
      'Only draft financial budgets can change.',
      409,
    );
    assert(
      plan.financial_year === 2026 && plan.currency === 'KES',
      'BUDGET_SCOPE_MISMATCH',
      'The supplied financial scenario requires a 2026 KES annual plan.',
    );
    assert(
      plan.version === id(input.version),
      'VERSION_CONFLICT',
      'The plan changed. Reload before changing this budget.',
      409,
    );
    const previous =
      (
        await c.query(
          'SELECT model FROM planning_financial_budgets WHERE tenant_id=$1 AND facility_id=$2 AND plan_id=$3',
          [s.tenantId, s.facilityId, plan.id],
        )
      ).rows[0]?.model ?? null;
    await c.query(
      'INSERT INTO planning_financial_budgets(plan_id,tenant_id,facility_id,model,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(plan_id) DO UPDATE SET model=EXCLUDED.model,updated_by=EXCLUDED.updated_by,updated_at=now()',
      [plan.id, s.tenantId, s.facilityId, JSON.stringify(model), s.actorId],
    );
    const next = (
      await c.query(
        'UPDATE planning_plans SET version=version+1,updated_at=now(),updated_by=$4 WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 RETURNING *',
        [plan.id, s.tenantId, s.facilityId, s.actorId],
      )
    ).rows[0];
    const resetAudit = reset ? { reason, removed: financialResetImpact(previous) } : undefined;
    await event(
      c,
      s,
      reset
        ? 'RESET_FINANCIAL_BASELINE'
        : previous
          ? 'UPDATE_FINANCIAL_BUDGET'
          : 'CREATE_FINANCIAL_BUDGET',
      plan.id,
      {
        entity: 'financial_budget',
        entityId: plan.id,
        previous,
        updated: resetAudit ? { ...model, resetAudit } : model,
      },
    );
    return { plan: next, model, ...(resetAudit ? { resetAudit } : {}) };
  });
}
