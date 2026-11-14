import React, { useEffect, useState } from 'react';
import {
  planningApi,
  planMoney,
  type Plan,
  type PlanningRow,
} from '../../../api/clients/planning.client.ts';
import { adjusted, decimal, fixed, monthAmount } from '../../../budget-planning/calculations.ts';
import { button, field, months, quiet } from './PlanningEditors.tsx';

/** Fetch the unfiltered item before editing: month filters must never erase other months. */
export function PlanningInlineItem({
  facilityId,
  plan,
  itemId,
  onSaved,
  onCancel,
}: {
  facilityId: number;
  plan: Plan;
  itemId: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [item, setItem] = useState<PlanningRow | null>(null);
  const [base, setBase] = useState('0');
  const [quantities, setQuantities] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    planningApi
      .get<PlanningRow>(facilityId, `/plans/${plan.id}/items/${itemId}`)
      .then((v) => {
        if (!live) return;
        const byMonth = new Map(
          v.months.map((m: PlanningRow) => [Number(m.month.slice(5, 7)), m.quantity]),
        );
        setItem(v);
        setBase(planMoney(v.base_price_cents));
        setQuantities(Array.from({ length: 12 }, (_, i) => String(byMonth.get(i + 1) ?? '')));
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [facilityId, plan.id, itemId]);
  let preview: string | null = null;
  try {
    const price = adjusted(fixed(base), Number(item?.inflation_bp ?? plan.inflation_bp));
    preview = decimal(
      quantities.reduce(
        (n, q) => n + (q.trim() === '' ? 0n : monthAmount(price, fixed(q, 3))!),
        0n,
      ),
    );
  } catch {
    /* Invalid local input is not sent until explicitly saved and server-validated. */
  }
  return (
    <form
      aria-label="Inline item editor"
      className="space-y-3 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!item || busy || preview === null || plan.status !== 'DRAFT') return;
        setBusy(true);
        setError('');
        try {
          await planningApi.send(
            facilityId,
            `/plans/${plan.id}/items/${itemId}`,
            {
              version: plan.version,
              categoryId: item.category_id,
              description: item.description,
              unit: item.unit,
              basePrice: base,
              inflationPercent:
                item.inflation_bp === null ? null : decimal(BigInt(item.inflation_bp)),
              quantities: quantities.map((q) => (q.trim() === '' ? null : q)),
            },
            'PATCH',
          );
          onSaved();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Update failed.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-xs">
        Edit {item?.description ?? 'item'} · blank quantities remain unplanned during manual
        editing. Save is audited and checks the current draft version.
      </p>
      <fieldset disabled={!item || busy || plan.status !== 'DRAFT'}>
        <label className="text-xs">
          Inline base price
          <input className={field} value={base} onChange={(e) => setBase(e.target.value)} />
        </label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {months.map((month, i) => (
            <label className="text-xs" key={month}>
              {month} quantity
              <input
                className={field}
                aria-label={`Inline ${month} quantity`}
                value={quantities[i] ?? ''}
                onChange={(e) =>
                  setQuantities((q) => q.map((v, n) => (n === i ? e.target.value : v)))
                }
              />
            </label>
          ))}
        </div>
        <p role="status">
          Live annual preview: {preview ?? 'Invalid input'} {plan.currency}
          {quantities.some((q) => q.trim() === '') ? ' (partial: unplanned months)' : ''}
        </p>
        <button className={button} disabled={preview === null || !item || busy} type="submit">
          Save inline changes
        </button>
      </fieldset>
      <button type="button" className={quiet} disabled={busy} onClick={onCancel}>
        Cancel inline edit
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
