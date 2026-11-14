import React, { useEffect, useState } from 'react';
import {
  planningApi,
  planMoney,
  type Plan,
  type Projection,
  type PlanningRow,
} from '../../../api/clients/planning.client.ts';
import { PlanningEditor, field, button, quiet, months } from './PlanningEditors.tsx';
import { PlanningImport } from './PlanningImport.tsx';
import { DataTable } from '../../ui/layout.tsx';
type PlanList = { plans: Plan[]; total: number };
export const planningViews = [
  ['planningDashboard', 'Planning Dashboard'],
  ['planningImport', 'Excel Import & History'],
  ['planningPlans', 'Annual Plans'],
  ['planningItems', 'Stationery & Consumables'],
  ['planningUniforms', 'Branding & Uniform Projections'],
  ['planningPeriods', 'Planning Periods'],
  ['planningReports', 'Reports'],
  ['planningAudit', 'Audit History'],
] as const;
export function PlanningWorkspace({
  facilityId,
  view,
  onNavigate,
  permissions,
}: {
  facilityId: number;
  view: string;
  onNavigate: (view: (typeof planningViews)[number][0]) => void;
  permissions: string[];
}) {
  const can = (p: string) => permissions.includes(`accounting.planning.${p}`);
  const auditAllowed = permissions.includes('accounting.planning.audit');
  const exportAllowed = permissions.includes('accounting.planning.export');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [total, setTotal] = useState(0);
  const [listPage, setListPage] = useState(1),
    [planId, setPlanId] = useState(''),
    [data, setData] = useState<Projection | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [audit, setAudit] = useState<PlanningRow[]>([]),
    [auditPage, setAuditPage] = useState(1),
    [history, setHistory] = useState<PlanningRow[]>([]);
  const [filters, setFilters] = useState({
    year: '',
    status: '',
    type: '',
    month: '',
    from: '',
    to: '',
    categoryId: '',
    search: '',
    unit: '',
    sort: 'description',
    direction: 'asc',
    page: 1,
  });
  const [editor, setEditor] = useState<{
      kind: 'plan' | 'item' | 'category' | 'uniform';
      initial?: PlanningRow;
      readOnly?: boolean;
    } | null>(null),
    [reportType, setReportType] = useState('ANNUAL'),
    [prior, setPrior] = useState('');
  const reload = () => setRefresh((n) => n + 1);
  useEffect(() => {
    let live = true;
    setError('');
    planningApi
      .get<PlanList>(facilityId, '/plans', {
        year: filters.year,
        status: filters.status,
        type: filters.type,
        page: listPage,
      })
      .then((r) => {
        if (live) {
          setPlans(r.plans);
          setTotal(r.total);
          setPlanId((previous) =>
            r.plans.some((p) => String(p.id) === previous)
              ? previous
              : r.plans[0]
                ? String(r.plans[0].id)
                : '',
          );
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [facilityId, filters.year, filters.status, filters.type, listPage, refresh]);
  useEffect(() => {
    let live = true;
    setData(null);
    if (planId)
      planningApi
        .get<Projection>(facilityId, `/plans/${planId}`, filters)
        .then((r) => {
          if (live) setData(r);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [facilityId, planId, filters, refresh]);
  useEffect(() => {
    let live = true;
    setAudit([]);
    setHistory([]);
    if (view === 'planningAudit' && auditAllowed)
      planningApi
        .get<PlanningRow[]>(facilityId, '/audit', { planId, page: auditPage })
        .then((r) => {
          if (live) setAudit(r);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    if (view === 'planningReports' && planId && exportAllowed)
      planningApi
        .get<PlanningRow[]>(facilityId, `/plans/${planId}/reports`)
        .then((r) => {
          if (live) setHistory(r);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [facilityId, planId, view, refresh, auditPage, auditAllowed, exportAllowed]);
  const run = async (fn: () => Promise<void>, refreshAfter = true) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      if (refreshAfter) reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };
  const edit = async (kind: 'item' | 'uniform', row: PlanningRow, readOnly = false) => {
    if (kind === 'item')
      await run(async () => {
        const full = await planningApi.get<PlanningRow>(
          facilityId,
          `/plans/${planId}/items/${row.id}`,
        );
        setEditor({ kind, initial: full, readOnly });
      }, false);
    else setEditor({ kind, initial: row, readOnly });
  };
  const remove = (kind: 'items' | 'uniforms', row: PlanningRow) => {
    if (
      window.confirm(
        `Remove “${row.description}” from this draft? This is an audited soft removal.`,
      )
    )
      void run(async () => {
        await planningApi.send(
          facilityId,
          `/plans/${planId}/${kind}/${row.id}`,
          { version: data!.plan.version },
          'DELETE',
        );
      });
  };
  const select = (label: string, key: keyof typeof filters, options: Array<[string, string]>) => (
    <label className="space-y-1 text-xs">
      <span>{label}</span>
      <select
        className={field}
        value={filters[key]}
        onChange={(e) => {
          setFilters({ ...filters, [key]: e.target.value, page: 1 });
          if (['year', 'status', 'type'].includes(key)) setListPage(1);
        }}
      >
        <option value="">All</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const draft = data?.plan.status === 'DRAFT' && can('manage');
  if (!can('read'))
    return <p role="alert">Planning access requires accounting.planning.read permission.</p>;
  return (
    <div className="space-y-4">
      <header>
        <h3 className="text-xl font-bold">Budget &amp; Procurement Planning</h3>
        <p className="text-sm text-muted">{planningViews.find(([id]) => id === view)?.[1]}</p>
      </header>
      <nav aria-label="Budget planning sections" className="flex flex-wrap gap-2">
        {planningViews.map(([id, label]) => (
          <button
            key={id}
            className={view === id ? button : quiet}
            aria-current={view === id ? 'page' : undefined}
            onClick={() => onNavigate(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
        Budget projections only — not inventory, purchase orders, goods received or actual
        expenditure. Amounts show known inputs; blank quantities are not zeros.
      </p>
      <section className="rounded-xl border border-hair bg-surface p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {select(
            'Financial year',
            'year',
            Array.from({ length: 31 }, (_, n) => String(2020 + n)).map((y) => [y, y]),
          )}
          {select(
            'Plan status',
            'status',
            ['DRAFT', 'REVIEW', 'APPROVED', 'ARCHIVED'].map((s) => [s, s]),
          )}
          {select(
            'Plan type',
            'type',
            ['ANNUAL', 'STATIONERY', 'BRANDING', 'MIXED'].map((s) => [s, s]),
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 text-xs">
            Active plan
            <select
              aria-label="Active planning plan"
              className={field}
              value={planId}
              onChange={(e) => {
                setPlanId(e.target.value);
                setFilters({ ...filters, page: 1, categoryId: '' });
              }}
            >
              <option value="">Select a plan…</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.financial_year} · {p.name} · {p.status}
                </option>
              ))}
            </select>
          </label>
          {can('manage') && (
            <button className={button} onClick={() => setEditor({ kind: 'plan' })}>
              New annual plan
            </button>
          )}
          <button className={quiet} onClick={reload}>
            Refresh
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button
            className={quiet}
            disabled={listPage === 1}
            onClick={() => setListPage((n) => n - 1)}
          >
            Previous plans
          </button>
          Page {listPage} · {total} plans
          <button
            className={quiet}
            disabled={listPage * 20 >= total}
            onClick={() => setListPage((n) => n + 1)}
          >
            Next plans
          </button>
        </div>
      </section>
      {error && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {view === 'planningImport' &&
        (can('import') && can('manage') ? (
          <PlanningImport
            facilityId={facilityId}
            plans={plans}
            onImported={(id) => {
              setPlanId(String(id));
              reload();
            }}
          />
        ) : (
          <p>Import requires planning import and manage permissions.</p>
        ))}
      {!data && view !== 'planningImport' && (
        <p className="p-4 text-sm">
          {planId ? 'Loading plan…' : 'No plan selected. Create a draft or adjust filters.'}
        </p>
      )}
      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold">{data.plan.name}</h3>
              <p className="text-xs text-muted">
                {data.plan.financial_year} · {data.plan.currency} · {data.plan.status} · revision{' '}
                {data.plan.version} · inflation {planMoney(data.plan.inflation_bp)}%
              </p>
            </div>
            {draft && (
              <button
                className={quiet}
                onClick={() => setEditor({ kind: 'plan', initial: data.plan })}
              >
                Edit plan assumptions
              </button>
            )}
          </div>
          {['planningItems', 'planningUniforms', 'planningDashboard', 'planningReports'].includes(
            view,
          ) && (
            <section className="grid gap-3 rounded-xl border border-hair bg-surface p-4 sm:grid-cols-3">
              {select(
                'Monthly date (first of month)',
                'month',
                months.map((m, n) => [String(n + 1), m]),
              )}
              {['from', 'to'].map((k) => (
                <label key={k} className="text-xs">
                  {k === 'from' ? 'From date' : 'Through date'}
                  <input
                    className={field}
                    type="date"
                    value={filters[k as 'from' | 'to']}
                    onChange={(e) => setFilters({ ...filters, [k]: e.target.value, page: 1 })}
                  />
                </label>
              ))}
              {select(
                'Category',
                'categoryId',
                data.categories.map((c) => [String(c.id), c.name]),
              )}
              {['search', 'unit'].map((k) => (
                <label key={k} className="text-xs">
                  {k === 'search' ? 'Search description' : 'Search unit'}
                  <input
                    className={field}
                    value={filters[k as 'search' | 'unit']}
                    onChange={(e) => setFilters({ ...filters, [k]: e.target.value, page: 1 })}
                  />
                </label>
              ))}
            </section>
          )}
          {view === 'planningDashboard' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ['Annual known budget', data.summary.annualCombinedCents],
                  ['Selected item budget', data.summary.selectedItemCents],
                  ['Annual branding / uniforms', data.summary.uniformAnnualCents],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-hair bg-surface p-4">
                    <p className="text-xs text-muted">{label}</p>
                    <p className="text-xl font-bold">
                      {data.plan.currency} {planMoney(value)}
                    </p>
                  </div>
                ))}
                <div className="rounded-xl border border-hair bg-surface p-4">
                  <p className="text-xs text-muted">Items / uniform types / unplanned months</p>
                  <p className="text-xl font-bold">
                    {data.totalItems} / {data.uniforms.length} / {data.summary.blankMonths}
                  </p>
                </div>
              </div>
              <p className="text-sm">
                Facility pending reviews: {data.facilityOverview.pendingReviews}. Imports:{' '}
                {data.facilityOverview.imports.pending} awaiting review/confirmation,{' '}
                {data.facilityOverview.imports.imported} confirmed,{' '}
                {data.facilityOverview.imports.cancelled} cancelled. Use Excel Import &amp; History
                for authorized source details.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {data.categoryTotals.map((c) => (
                  <div key={c.id} className="rounded border border-hair p-3">
                    <strong className="text-sm">{c.name}</strong>
                    <p className="text-xs">
                      Selected items {planMoney(c.itemCents)} · annual uniforms{' '}
                      {planMoney(c.uniformAnnualCents)}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
          {['planningPlans', 'planningPeriods'].includes(view) && (
            <section className="rounded-xl border border-hair bg-surface p-4 space-y-4">
              <h4 className="font-semibold">Controlled plan lifecycle</h4>
              <p className="text-sm">
                Planning period: 1 January – 31 December {data.plan.financial_year}. Monthly
                projections use each month’s first day; this does not open or close accounting
                posting periods. Only drafts can be edited. Review requires all item months
                explicitly planned, including zero quantities. Approval must be by an independent
                authorized user.
              </p>
              <div className="flex flex-wrap gap-2">
                {(data.plan.status === 'DRAFT'
                  ? ['REVIEW', 'ARCHIVED']
                  : data.plan.status === 'REVIEW'
                    ? ['DRAFT', 'APPROVED']
                    : data.plan.status === 'APPROVED'
                      ? ['ARCHIVED']
                      : []
                )
                  .filter((s) =>
                    s === 'APPROVED' || data.plan.status === 'APPROVED'
                      ? can('approve')
                      : can('manage'),
                  )
                  .map((status) => (
                    <button
                      key={status}
                      disabled={busy}
                      className={quiet}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Move plan to ${status}? This audited action uses revision ${data.plan.version}.`,
                          )
                        )
                          void run(async () => {
                            await planningApi.send(facilityId, `/plans/${planId}/status`, {
                              status,
                              version: data.plan.version,
                            });
                          });
                      }}
                    >
                      {status === 'REVIEW'
                        ? 'Submit for review'
                        : status === 'DRAFT'
                          ? 'Return to draft'
                          : status === 'APPROVED'
                            ? 'Independently approve'
                            : 'Archive plan'}
                    </button>
                  ))}
              </div>
              <h4 className="font-semibold">Plan categories</h4>
              {data.categories.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 border-b border-hair py-2 text-sm"
                >
                  <span>
                    {c.name} {c.is_active ? '' : '(inactive)'}
                  </span>
                  {draft && (
                    <button
                      className={quiet}
                      onClick={() => setEditor({ kind: 'category', initial: c })}
                    >
                      Edit category
                    </button>
                  )}
                </div>
              ))}
              {draft && (
                <button className={quiet} onClick={() => setEditor({ kind: 'category' })}>
                  Add category
                </button>
              )}
            </section>
          )}
          {view === 'planningItems' && (
            <section className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {draft && (
                  <button className={button} onClick={() => setEditor({ kind: 'item' })}>
                    Add item
                  </button>
                )}
                {select('Sort by', 'sort', [
                  ['description', 'Description'],
                  ['unit', 'Unit'],
                  ['price', 'Adjusted price'],
                  ['annual', 'Annual total'],
                ])}
                {select('Direction', 'direction', [
                  ['asc', 'Ascending'],
                  ['desc', 'Descending'],
                ])}
              </div>
              <div className="overflow-x-auto rounded-xl border border-hair">
                <DataTable className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      {[
                        'Item / category',
                        'Unit',
                        'Base price',
                        'Inflation %',
                        'Adjusted price',
                        'Monthly qty / cost',
                        'Annual total',
                        'Actions',
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((i) => (
                      <tr key={i.id}>
                        <td>
                          {i.description}
                          <br />
                          <span className="text-muted">{i.category_name}</span>
                        </td>
                        <td>{i.unit}</td>
                        <td>{planMoney(i.base_price_cents)}</td>
                        <td>{planMoney(i.inflation_bp ?? data.plan.inflation_bp)}</td>
                        <td>{planMoney(i.adjusted_price_cents)}</td>
                        <td>
                          <details>
                            <summary>
                              {i.months.length} months · selected{' '}
                              {planMoney(i.selected_total_cents)}
                            </summary>
                            {i.months.map((m: PlanningRow) => (
                              <p key={m.month}>
                                {m.month}: {m.quantity ?? 'Unplanned'} /{' '}
                                {m.amount_cents === null ? '—' : planMoney(m.amount_cents)}
                              </p>
                            ))}
                          </details>
                        </td>
                        <td>{planMoney(i.annual_total_cents)}</td>
                        <td>
                          <div className="flex gap-1">
                            <button className={quiet} onClick={() => void edit('item', i, !draft)}>
                              {draft ? 'Edit' : 'View'}
                            </button>
                            {draft && (
                              <button
                                className={quiet}
                                disabled={busy}
                                onClick={() => remove('items', i)}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                {!data.items.length && (
                  <p className="p-4 text-sm">
                    No matching items. Add a category first, then add an item or import a workbook.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 text-sm">
                <button
                  className={quiet}
                  disabled={filters.page === 1}
                  onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
                >
                  Previous items
                </button>
                Page {data.page} · {data.totalItems} matching items
                <button
                  className={quiet}
                  disabled={filters.page * 20 >= data.totalItems}
                  onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
                >
                  Next items
                </button>
              </div>
            </section>
          )}
          {view === 'planningUniforms' && (
            <section className="space-y-3">
              <p className="text-sm">
                Annual uniform budgets are separate from monthly consumables. No monthly allocation
                is invented.
              </p>
              {draft && (
                <button className={button} onClick={() => setEditor({ kind: 'uniform' })}>
                  Add uniform projection
                </button>
              )}
              <section className="space-y-2 rounded-lg border border-hair p-3">
                <h4 className="font-semibold">Monthly branding items</h4>
                <p className="text-xs">
                  For mixed plans, choose the source branding category above. Classification is
                  explicit, never guessed from descriptions. Uniforms below remain annual
                  projections.
                </p>
                {data.plan.plan_type === 'BRANDING' || filters.categoryId ? (
                  <>
                    <div className="overflow-x-auto">
                      <DataTable className="w-full text-left text-xs">
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>Category / unit</th>
                            <th>Adjusted price</th>
                            <th>Selected / annual cost</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.items.map((i) => (
                            <tr key={i.id}>
                              <td>{i.description}</td>
                              <td>
                                {i.category_name} / {i.unit}
                              </td>
                              <td>{planMoney(i.adjusted_price_cents)}</td>
                              <td>
                                {planMoney(i.selected_total_cents)} /{' '}
                                {planMoney(i.annual_total_cents)}
                              </td>
                              <td>
                                <button
                                  className={quiet}
                                  onClick={() => void edit('item', i, !draft)}
                                >
                                  {draft ? 'Edit' : 'View'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </DataTable>
                    </div>
                    <p className="text-xs">
                      First page: {data.items.length} of {data.totalItems} matching monthly items.
                      Use Stationery &amp; Consumables for full pagination and monthly quantities.
                    </p>
                  </>
                ) : (
                  <p className="text-xs">
                    Select a category or a dedicated BRANDING plan to display monthly branding rows.
                  </p>
                )}
                {draft && (
                  <button className={quiet} onClick={() => setEditor({ kind: 'item' })}>
                    Add monthly branding item
                  </button>
                )}
              </section>
              <div className="overflow-x-auto">
                <DataTable className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      {[
                        'Uniform',
                        'Opening balance / period',
                        'Buying cost',
                        'Staff × qty',
                        'Projected / purchase qty',
                        'Gross / contribution',
                        'Net annual budget',
                        'Actions',
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.uniforms.map((u) => (
                      <tr key={u.id}>
                        <td>
                          {u.description}
                          <br />
                          {u.category_name}
                        </td>
                        <td>
                          {u.existing_balance} / {u.balance_label}
                          <br />
                          {u.balance_rule}
                        </td>
                        <td>{planMoney(u.buying_cost_cents)}</td>
                        <td>
                          {u.staff_count} × {u.quantity_per_staff}
                        </td>
                        <td>
                          {u.projected_quantity} / {u.purchase_quantity}
                        </td>
                        <td>
                          {planMoney(u.gross_cents)} / {planMoney(u.contribution_cents)} (
                          {planMoney(u.contribution_bp)}%)
                        </td>
                        <td>{planMoney(u.total_cents)}</td>
                        <td>
                          <button className={quiet} onClick={() => void edit('uniform', u, !draft)}>
                            {draft ? 'Edit' : 'View'}
                          </button>
                          {draft && (
                            <button className={quiet} onClick={() => remove('uniforms', u)}>
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
            </section>
          )}
          {view === 'planningReports' &&
            (can('export') ? (
              <section className="space-y-4 rounded-xl border border-hair bg-surface p-4">
                <h4 className="font-semibold">Issue a filtered planning report</h4>
                <p className="text-sm">
                  Uses the active facility’s uploaded letterhead. Issued PDF bytes, filters and
                  branding version are retained for reprints. No verified actual-expenditure linkage
                  exists; budget versus actual is unavailable.
                </p>
                <select
                  aria-label="Planning report type"
                  className={field}
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                >
                  {['ANNUAL', 'MONTHLY', 'CATEGORY', 'ITEM', 'BRANDING', 'YOY'].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                {reportType === 'YOY' && (
                  <label className="block text-xs">
                    Prior-year plan ID (same facility, currency and type)
                    <input
                      className={field}
                      value={prior}
                      onChange={(e) => setPrior(e.target.value)}
                    />
                  </label>
                )}
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await planningApi.send(facilityId, `/plans/${planId}/reports`, {
                        ...filters,
                        reportType,
                        priorPlanId: prior,
                      });
                    })
                  }
                >
                  Generate PDF and Excel report
                </button>
                <h4 className="font-semibold">Issued report history (latest 100)</h4>
                {history.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 border-b border-hair py-2 text-xs"
                  >
                    <span>
                      #{r.id} · {r.report_type} · {String(r.created_at)} · letterhead v
                      {r.letterhead_id}
                    </span>
                    {(['pdf', 'xlsx'] as const).map((format) => (
                      <button
                        key={format}
                        className={quiet}
                        onClick={() => void run(() => planningApi.file(facilityId, r.id, format))}
                      >
                        {format.toUpperCase()}
                      </button>
                    ))}
                    <button
                      className={quiet}
                      onClick={() =>
                        void run(() => planningApi.file(facilityId, r.id, 'pdf', true))
                      }
                    >
                      Print / reprint
                    </button>
                  </div>
                ))}
              </section>
            ) : (
              <p>Report export permission is required.</p>
            ))}
        </>
      )}
      {view === 'planningAudit' &&
        (can('audit') ? (
          <section className="space-y-3">
            <h4 className="font-semibold">Immutable planning audit trail</h4>
            {audit.map((r) => (
              <details key={r.id} className="rounded border border-hair p-3 text-xs">
                <summary>
                  #{r.id} · {r.action} · actor {r.actor_id} · {String(r.created_at)}
                </summary>
                <pre className="overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(r, null, 2)}
                </pre>
              </details>
            ))}
            <button
              className={quiet}
              disabled={auditPage === 1}
              onClick={() => setAuditPage((n) => n - 1)}
            >
              Previous audit
            </button>
            <span className="px-3 text-xs">Page {auditPage}</span>
            <button
              className={quiet}
              disabled={audit.length < 50}
              onClick={() => setAuditPage((n) => n + 1)}
            >
              Next audit
            </button>
          </section>
        ) : (
          <p>Audit history permission is required.</p>
        ))}
      {editor && (editor.kind === 'plan' || data) && (
        <PlanningEditor
          key={`${editor.kind}-${editor.initial?.id ?? 'new'}`}
          {...editor}
          facilityId={facilityId}
          data={data}
          onClose={() => setEditor(null)}
          onSaved={(id) => {
            if (editor.kind === 'plan' && id) setPlanId(String(id));
            reload();
          }}
        />
      )}
    </div>
  );
}
