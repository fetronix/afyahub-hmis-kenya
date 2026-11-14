import React, { useEffect, useState } from 'react';
import {
  planningApi,
  planMoney,
  type Plan,
  type Projection,
  type PlanningRow,
} from '../../../api/clients/planning.client.ts';
import { PlanningEditor, field, button, quiet, months } from './PlanningEditors.tsx';
import { PlanningInlineItem } from './PlanningInlineItem.tsx';
import { PlanningImport } from './PlanningImport.tsx';
import { ImportOverview } from './ImportResults.tsx';
import {
  sectionItems,
  isBrandingCategory,
  consumableGroup,
  consumableLabels,
} from './planning-sections.ts';
import { DataTable } from '../../ui/layout.tsx';
type PlanList = { plans: Plan[]; total: number };
export const planningViews = [
  ['planningDashboard', 'Planning Dashboard'],
  ['planningImport', 'CSV / Excel Import & History'],
  ['planningPlans', 'Annual Plans'],
  ['planningItems', 'Stationery & Consumables'],
  ['planningBranding', 'Branding'],
  ['planningUniforms', 'Staff Uniform Projections'],
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
  const [inlineId, setInlineId] = useState<number | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [total, setTotal] = useState(0);
  const [listPage, setListPage] = useState(1),
    [planId, setPlanId] = useState(''),
    [loaded, setLoaded] = useState<{ facilityId: number; planId: string; data: Projection } | null>(
      null,
    ),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [audit, setAudit] = useState<PlanningRow[]>([]),
    [auditPage, setAuditPage] = useState(1),
    [history, setHistory] = useState<PlanningRow[]>([]);
  const [filters, setFilters] = useState({
    year: '2026',
    status: '',
    type: '',
    month: '',
    from: '',
    to: '',
    categoryId: '',
    consumableGroup: '',
    search: '',
    unit: '',
    sort: 'category',
    direction: 'asc',
    page: 1,
  });
  const data =
    loaded?.facilityId === facilityId &&
    loaded.planId === planId &&
    (!filters.year || loaded.data.plan.financial_year === Number(filters.year))
      ? loaded.data
      : null;
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
    const selectedPlan = plans.find((p) => String(p.id) === planId);
    if (
      !planId ||
      (filters.year && selectedPlan?.financial_year !== Number(filters.year)) ||
      (filters.status && selectedPlan?.status !== filters.status)
    ) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      setError('');
      planningApi
        .get<Projection>(facilityId, `/plans/${planId}`, {
          ...filters,
          all: ['planningItems', 'planningBranding', 'planningUniforms'].includes(view),
        })
        .then((r) => {
          if (live) setLoaded({ facilityId, planId, data: r });
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      live = false;
    };
  }, [facilityId, planId, filters, refresh, view, plans]);
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
        const remaining = Math.max(
          0,
          (kind === 'uniforms' ? data!.uniforms.length : matchingItems.length) - 1,
        );
        setFilters((v) => ({
          ...v,
          page: Math.min(v.page, Math.max(1, Math.ceil(remaining / 20))),
        }));
      });
  };
  const select = (label: string, key: keyof typeof filters, options: Array<[string, string]>) => (
    <label className="space-y-1 text-xs">
      <span>{label}</span>
      <select
        className={field}
        value={filters[key]}
        onChange={(e) => {
          setFilters({
            ...filters,
            [key]: e.target.value,
            page: 1,
            ...(key === 'consumableGroup'
              ? { categoryId: '' }
              : key === 'categoryId'
                ? { consumableGroup: '' }
                : {}),
          });
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
  const monthlySection = view === 'planningItems' || view === 'planningBranding';
  const sectionTitle = view === 'planningBranding' ? 'Branding' : 'Stationery & Consumables';
  const itemCategories =
    data?.categories.filter((c) =>
      view === 'planningBranding'
        ? isBrandingCategory(c, data.plan.plan_type)
        : !isBrandingCategory(c, data.plan.plan_type),
    ) ?? [];
  const matchingItems = data
    ? sectionItems(
        data.items,
        data.categories,
        data.plan.plan_type,
        view === 'planningBranding' ? 'branding' : 'stationery',
        view === 'planningItems' ? filters.consumableGroup : '',
      )
    : [];
  const itemRows = matchingItems.slice((filters.page - 1) * 20, filters.page * 20);
  const uniformRows = data?.uniforms.slice((filters.page - 1) * 20, filters.page * 20) ?? [];
  const sectionTotal = (key: 'annual_total_cents' | 'selected_total_cents') =>
    matchingItems.reduce((sum, item) => sum + BigInt(item[key]), 0n).toString();
  const navigateSection = (id: (typeof planningViews)[number][0]) => {
    setInlineId(null);
    setEditor(null);
    setFilters((v) => ({
      ...v,
      categoryId: '',
      consumableGroup: '',
      search: '',
      unit: '',
      month: '',
      from: '',
      to: '',
      page: 1,
    }));
    onNavigate(id);
  };
  const draft = data?.plan.status === 'DRAFT' && can('manage') && !loading;
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
            onClick={() => navigateSection(id)}
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
                setFilters({
                  ...filters,
                  page: 1,
                  categoryId: '',
                  consumableGroup: '',
                  search: '',
                  unit: '',
                });
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
      {view === 'planningDashboard' && (
        <ImportOverview
          key={facilityId}
          facilityId={facilityId}
          planId={planId ? Number(planId) : undefined}
          refresh={refresh}
        />
      )}
      {view === 'planningImport' && (
        <PlanningImport
          key={facilityId}
          facilityId={facilityId}
          plans={plans}
          canImport={can('import') && can('manage')}
          canExport={exportAllowed}
          selectedPlanId={planId ? Number(planId) : undefined}
          onImported={(id) => {
            setPlanId(String(id));
            reload();
          }}
        />
      )}
      {loading && data && (
        <p role="status" className="text-xs text-muted">
          Updating planning records…
        </p>
      )}
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
          {[
            'planningItems',
            'planningBranding',
            'planningUniforms',
            'planningDashboard',
            'planningReports',
          ].includes(view) && (
            <section className="grid gap-3 rounded-xl border border-hair bg-surface p-4 sm:grid-cols-3">
              {view !== 'planningUniforms' && (
                <>
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
                </>
              )}
              {select(
                'Category',
                'categoryId',
                (monthlySection ? itemCategories : data.categories).map((c) => [
                  String(c.id),
                  c.name,
                ]),
              )}
              {(view === 'planningUniforms' ? ['search'] : ['search', 'unit']).map((k) => (
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
          {monthlySection && (
            <section className="space-y-3" aria-label={`${sectionTitle} records`}>
              <h4 className="font-semibold text-lg">{sectionTitle}</h4>
              <p className="text-sm">
                {view === 'planningBranding'
                  ? 'Monthly branding items with January–December quantities, unit prices and calculated costs. Categories use source label Branding or category code BRANDING (or an explicit BRANDING plan).'
                  : 'OPD, dental and other consumables retain their original source category labels.'}
              </p>
              <p role="status" className="text-sm">
                {matchingItems.length} matching records · Selected total {data.plan.currency}{' '}
                {planMoney(sectionTotal('selected_total_cents'))} · Annual total{' '}
                {data.plan.currency} {planMoney(sectionTotal('annual_total_cents'))}
              </p>
              {view === 'planningItems' &&
                select('Consumable group', 'consumableGroup', Object.entries(consumableLabels))}
              {view === 'planningItems' && (
                <div role="group" aria-label="Consumable sections" className="flex flex-wrap gap-2">
                  {Object.entries(consumableLabels).map(([group, label]) => (
                    <button
                      key={group}
                      aria-pressed={filters.consumableGroup === group}
                      className={filters.consumableGroup === group ? button : quiet}
                      onClick={() =>
                        setFilters({ ...filters, consumableGroup: group, categoryId: '', page: 1 })
                      }
                    >
                      {label} (
                      {
                        sectionItems(
                          data.items,
                          data.categories,
                          data.plan.plan_type,
                          'stationery',
                          group,
                        ).length
                      }
                      )
                    </button>
                  ))}
                </div>
              )}

              {draft && !itemCategories.some((c) => c.is_active) && (
                <p className="text-xs text-muted">
                  Set up an active{' '}
                  {view === 'planningBranding'
                    ? 'BRANDING-named or BRANDING-coded'
                    : 'non-branding'}{' '}
                  category in Annual Plans before adding records to this section.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {draft && (
                  <button
                    className={button}
                    disabled={!itemCategories.some((c) => c.is_active)}
                    onClick={() => setEditor({ kind: 'item' })}
                  >
                    {view === 'planningBranding' ? 'Add branding item' : 'Add item'}
                  </button>
                )}
                {draft && (
                  <button className={quiet} onClick={() => setEditor({ kind: 'category' })}>
                    Add section category
                  </button>
                )}
                {select('Sort by', 'sort', [
                  ['category', 'Section / category'],
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
                <DataTable
                  aria-label={`${sectionTitle} table`}
                  className="w-full text-left text-xs"
                >
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
                    {itemRows.map((i) => (
                      <React.Fragment key={i.id}>
                        <tr>
                          <td>
                            {i.description}
                            <br />
                            <span className="text-muted">{i.category_name}</span>
                            {view === 'planningItems' && (
                              <span className="block text-xs font-semibold">
                                {
                                  consumableLabels[
                                    consumableGroup(
                                      data.categories.find((c) => c.id === i.category_id),
                                    )
                                  ]
                                }
                              </span>
                            )}
                            <span className="block text-xs text-muted">
                              {i.source_worksheet
                                ? `${i.source_worksheet} row ${i.source_row}`
                                : 'Manual entry'}
                            </span>
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
                                  {months[Number(m.month.slice(5, 7)) - 1]}:{' '}
                                  {m.quantity ?? 'Unplanned'} × {planMoney(m.unit_price_cents)} ={' '}
                                  {m.amount_cents === null ? '—' : planMoney(m.amount_cents)}
                                </p>
                              ))}
                            </details>
                          </td>
                          <td>{planMoney(i.annual_total_cents)}</td>
                          <td>
                            <div className="flex gap-1">
                              <button className={quiet} onClick={() => void edit('item', i, true)}>
                                View
                              </button>
                              {draft && (
                                <button
                                  className={quiet}
                                  disabled={busy}
                                  onClick={() => void edit('item', i)}
                                >
                                  Edit
                                </button>
                              )}
                              {draft && (
                                <button
                                  className={quiet}
                                  disabled={busy}
                                  onClick={() => setInlineId(i.id)}
                                >
                                  Inline edit
                                </button>
                              )}
                              {draft && (
                                <button
                                  className={quiet}
                                  disabled={busy}
                                  onClick={() => remove('items', i)}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {draft && inlineId === i.id && (
                          <tr>
                            <td colSpan={8}>
                              <PlanningInlineItem
                                key={`${facilityId}:${planId}:${i.id}:${data.plan.version}`}
                                facilityId={facilityId}
                                plan={data.plan}
                                itemId={i.id}
                                onSaved={() => {
                                  setInlineId(null);
                                  reload();
                                }}
                                onCancel={() => setInlineId(null)}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </DataTable>
                {!itemRows.length && (
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
                Page {filters.page} · {matchingItems.length} matching items
                <button
                  className={quiet}
                  disabled={filters.page * 20 >= matchingItems.length}
                  onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
                >
                  Next items
                </button>
              </div>
            </section>
          )}
          {view === 'planningUniforms' && (
            <section className="space-y-3" aria-label="Staff Uniform Projections records">
              <h4 className="font-semibold text-lg">Staff Uniform Projections</h4>
              <p role="status" className="text-sm">
                {data.uniforms.length} matching records · Net annual total {data.plan.currency}{' '}
                {planMoney(
                  data.uniforms.reduce((sum, u) => sum + BigInt(u.total_cents), 0n).toString(),
                )}
              </p>
              <p className="text-sm">
                Annual uniform budgets are separate from monthly consumables. No monthly allocation
                is invented.
              </p>
              {draft && (
                <button className={button} onClick={() => setEditor({ kind: 'uniform' })}>
                  Add uniform projection
                </button>
              )}
              <div className="overflow-x-auto">
                <DataTable
                  aria-label="Staff Uniform Projections table"
                  className="w-full text-left text-xs"
                >
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
                    {uniformRows.map((u) => (
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
                          <button className={quiet} onClick={() => void edit('uniform', u, true)}>
                            View
                          </button>
                          {draft && (
                            <button
                              className={quiet}
                              disabled={busy}
                              onClick={() => void edit('uniform', u)}
                            >
                              Edit
                            </button>
                          )}
                          {draft && (
                            <button
                              className={quiet}
                              disabled={busy}
                              onClick={() => remove('uniforms', u)}
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
              {!uniformRows.length && (
                <p className="text-sm">
                  No matching uniform projections. Adjust filters or add a draft projection.
                </p>
              )}
              <div className="flex items-center gap-3 text-sm">
                <button
                  className={quiet}
                  disabled={filters.page === 1}
                  onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
                >
                  Previous uniforms
                </button>
                Page {filters.page} · {data.uniforms.length} matching uniforms
                <button
                  className={quiet}
                  disabled={filters.page * 20 >= data.uniforms.length}
                  onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
                >
                  Next uniforms
                </button>
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
          data={
            data && editor.kind === 'item' && monthlySection
              ? { ...data, categories: itemCategories }
              : data
          }
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
