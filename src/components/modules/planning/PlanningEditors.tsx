import React, { useState } from 'react';
import { Modal } from '../../ui/overlays.tsx';
import {
  planningApi,
  planMoney,
  type Projection,
  type PlanningRow,
} from '../../../api/clients/planning.client.ts';
export const field = 'w-full rounded-lg border border-hair bg-white px-3 py-2 text-sm';
export const button =
  'rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50';
export const quiet =
  'rounded-lg border border-hair bg-white px-3 py-2 text-sm text-ink disabled:opacity-50';
export const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export function PlanningEditor({
  kind,
  facilityId,
  data,
  initial,
  readOnly = false,
  onClose,
  onSaved,
}: {
  kind: 'plan' | 'category' | 'item' | 'uniform';
  facilityId: number;
  data: Projection | null;
  initial?: PlanningRow;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (planId?: number) => void;
}) {
  const [form, setForm] = useState<PlanningRow>(() => {
    if (kind === 'plan')
      return {
        name: initial?.name ?? '',
        financialYear: initial?.financial_year ?? new Date().getUTCFullYear(),
        planType: initial?.plan_type ?? 'MIXED',
        currency: initial?.currency ?? 'KES',
        inflationPercent: initial ? planMoney(initial.inflation_bp) : '0',
        confirmAdditionalPlan: false,
      };
    if (kind === 'category')
      return {
        name: initial?.name ?? '',
        code: initial?.code ?? '',
        isActive: initial?.is_active ?? true,
      };
    if (kind === 'uniform')
      return {
        description: initial?.description ?? '',
        categoryId:
          initial?.category_id ??
          (data?.filters.categoryId || data?.categories.find((c) => c.is_active)?.id || ''),
        existingBalance: initial?.existing_balance ?? '0',
        balanceLabel: initial?.balance_label ?? '',
        buyingCost: initial ? planMoney(initial.buying_cost_cents) : '',
        staffCount: initial?.staff_count ?? '',
        quantityPerStaff: initial?.quantity_per_staff ?? '',
        contributionPercent: initial ? planMoney(initial.contribution_bp) : '0',
        balanceRule: initial?.balance_rule ?? '',
      };
    return {
      description: initial?.description ?? '',
      unit: initial?.unit ?? '',
      categoryId:
        initial?.category_id ??
        (data?.filters.categoryId || data?.categories.find((c) => c.is_active)?.id || ''),
      basePrice: initial ? planMoney(initial.base_price_cents) : '',
      inflationPercent:
        initial?.inflation_bp === null || !initial ? '' : planMoney(initial.inflation_bp),
      quantities: months.map((_, n) => {
        const m = initial?.months?.find((m: PlanningRow) => Number(m.month.slice(5, 7)) === n + 1);
        return m?.quantity ?? '';
      }),
    };
  });
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const input = (label: string, key: string, type = 'text', required = true) => (
    <label className="block space-y-1 text-xs">
      <span>{label}</span>
      <input
        className={field}
        type={type}
        value={form[key]}
        disabled={
          readOnly ||
          (kind === 'plan' && !!initial && ['financialYear', 'planType', 'currency'].includes(key))
        }
        required={required}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );
  const select = (label: string, key: string, options: Array<[string | number, string]>) => (
    <label className="block space-y-1 text-xs">
      <span>{label}</span>
      <select
        className={field}
        value={form[key]}
        disabled={readOnly || (kind === 'plan' && !!initial)}
        required
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      >
        <option value="">Choose…</option>
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || busy) return;
    setBusy(true);
    setError('');
    try {
      const value = {
        ...form,
        version: data?.plan.version,
        ...(kind === 'item'
          ? { quantities: form.quantities.map((v: string) => (v === '' ? null : v)) }
          : {}),
        ...(kind === 'uniform' ? { staffCount: Number(form.staffCount) } : {}),
      };
      const suffix = kind === 'category' ? 'categories' : kind === 'uniform' ? 'uniforms' : 'items';
      const result = await planningApi.send<PlanningRow>(
        facilityId,
        kind === 'plan'
          ? `/plans${initial ? '/' + initial.id : ''}`
          : `/plans/${data!.plan.id}/${suffix}${initial ? '/' + initial.id : ''}`,
        value,
        initial ? 'PATCH' : 'POST',
      );
      onSaved(result.id ?? result.plan?.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={`${readOnly ? 'View' : initial ? 'Edit' : 'Add'} ${kind}`}
    >
      <form className="space-y-4" onSubmit={save}>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {kind === 'plan' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {input('Plan name', 'name')}
              {input('Financial year', 'financialYear', 'number')}
              {select(
                'Plan type',
                'planType',
                ['ANNUAL', 'STATIONERY', 'BRANDING', 'MIXED'].map((v) => [v, v]),
              )}
              {select(
                'Currency',
                'currency',
                ['KES', 'USD', 'EUR'].map((v) => [v, v]),
              )}
              {input('Plan inflation percentage', 'inflationPercent')}
            </div>
            <p className="text-xs">
              Inflation is a configurable plan assumption, not a universal rule. Changing it
              recalculates draft items without their own override.
            </p>
            {!initial && (
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.confirmAdditionalPlan}
                  onChange={(e) => setForm({ ...form, confirmAdditionalPlan: e.target.checked })}
                />
                Explicitly allow an additional separate plan if this facility/year already has one.
                Nothing is replaced.
              </label>
            )}
          </>
        ) : kind === 'category' ? (
          <>
            {input('Category name', 'name')}
            {input('Category code (optional)', 'code', 'text', false)}
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                disabled={readOnly}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Active category
            </label>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {input(kind === 'uniform' ? 'Uniform type' : 'Item description', 'description')}
              {select(
                'Plan category',
                'categoryId',
                data!.categories
                  .filter((c) => c.is_active || c.id === initial?.category_id)
                  .map((c) => [c.id, c.name]),
              )}
              {kind === 'item' ? (
                <>
                  {input('Unit', 'unit')}
                  {input('Base unit price', 'basePrice')}
                  {input(
                    'Inflation override % (blank uses plan)',
                    'inflationPercent',
                    'text',
                    false,
                  )}
                </>
              ) : (
                <>
                  {input('Existing balance', 'existingBalance')}
                  {input('Balance reference period, e.g. December 2025', 'balanceLabel')}
                  {input('Buying cost per unit', 'buyingCost')}
                  {input('Projected staff count', 'staffCount', 'number')}
                  {input('Uniform quantity per staff', 'quantityPerStaff')}
                  {input(
                    'Staff contribution percentage of gross purchase cost',
                    'contributionPercent',
                  )}
                  {select('Opening balance treatment', 'balanceRule', [
                    ['SUBTRACT', 'Offset projected purchases with opening units'],
                    ['IGNORE', 'Keep opening balance as context only'],
                  ])}
                </>
              )}
            </div>
            {kind === 'item' && (
              <>
                <p className="text-xs">
                  Blank means unplanned; enter 0 explicitly for no planned purchase. Quantities
                  support three decimal places. Authoritative amounts are calculated on the server.
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {months.map((month, n) => (
                    <label key={month} className="space-y-1 text-xs">
                      <span>{month} quantity</span>
                      <input
                        className={field}
                        value={form.quantities[n]}
                        disabled={readOnly}
                        inputMode="decimal"
                        onChange={(e) => {
                          const q = [...form.quantities];
                          q[n] = e.target.value;
                          setForm({ ...form, quantities: q });
                        }}
                      />
                    </label>
                  ))}
                </div>
              </>
            )}
            {kind === 'item' && initial?.months && (
              <section className="space-y-2 text-xs" aria-label="Saved monthly calculations">
                <h4 className="font-semibold">Saved January–December calculations</h4>
                <p>
                  Adjusted unit price: {planMoney(initial.adjusted_price_cents)}{' '}
                  {data?.plan.currency}. Values below are saved server calculations; save edits to
                  recalculate.
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {initial.months.map((m: PlanningRow) => (
                    <p key={m.month}>
                      {months[Number(m.month.slice(5, 7)) - 1]}: {m.quantity ?? 'Unplanned'} ×{' '}
                      {planMoney(m.unit_price_cents)} ={' '}
                      {m.amount_cents === null ? 'Unplanned' : planMoney(m.amount_cents)}
                    </p>
                  ))}
                </div>
                <p>
                  Annual total: {planMoney(initial.annual_total_cents)} {data?.plan.currency}
                </p>
              </section>
            )}
            {kind === 'uniform' && (
              <p className="text-xs">
                Gross cost = required purchase units × buying cost. Staff contribution is the
                selected percentage of gross; net budget = gross − contribution. Review this
                explicit method against your source assumptions. Uniforms remain annual, not
                daily/monthly purchases.
              </p>
            )}
            {initial && (
              <p className="text-xs text-muted">
                Source: {initial.source_worksheet ?? 'Manual entry'}{' '}
                {initial.source_row ? `row ${initial.source_row}` : ''}. Formula trace:{' '}
                {initial.source_formula || 'None recorded'}.
              </p>
            )}
          </>
        )}
        <div className="flex gap-2">
          {!readOnly && (
            <button className={button} disabled={busy}>
              Save {kind}
            </button>
          )}
          <button type="button" className={quiet} disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}
