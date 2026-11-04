import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  FileText,
  FolderHeart,
  LockKeyhole,
  Search,
  Stethoscope,
  Users,
} from 'lucide-react';
import { useHmis } from '../../../context/HmisContext.tsx';
import {
  REPORT_CATEGORIES,
  type ReportCategory,
  type ReportEntry,
} from '../../../reporting/report-catalogue.ts';
import { REPORT_ENGINES } from '../../../reporting/report-centre.types.ts';
import { FinalizedInvoicePanel } from '../FinalizedInvoicePanel.tsx';
import { ReportsModule } from '../ReportsModule.tsx';
import { ReportWorkbench } from './ReportWorkbench.tsx';

const icons: Record<string, React.ElementType> = {
  printables: FileText,
  financial: CircleDollarSign,
  'stock-goods': Boxes,
  departmental: Stethoscope,
  records: FolderHeart,
  hr: Users,
  activity: Activity,
};

function InvoiceDocument() {
  const [value, setValue] = useState('');
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [error, setError] = useState('');
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-4 text-sm text-teal-950">
        <p className="font-semibold">Existing finalized-invoice workflow</p>
        <p className="mt-1 text-xs leading-relaxed text-teal-800">
          Open an invoice from the selected facility by its internal ID. The existing statement and
          audited print are reused; template approval and a full document catalogue remain
          outstanding.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const number = Number(value);
          if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number)) {
            setInvoiceId(null);
            setError('Enter a valid invoice ID.');
            return;
          }
          setError('');
          setInvoiceId(number);
        }}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <label className="flex-1 text-xs font-semibold text-slate-600">
          Invoice ID
          <input
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-teal-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-teal-800"
        >
          Open invoice
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {invoiceId !== null && (
        <FinalizedInvoicePanel key={invoiceId} invoiceId={invoiceId} reportCentre />
      )}
    </div>
  );
}

export const ReportCentre: React.FC = () => {
  const { currentFacility, authenticatedUser } = useHmis();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOverview, setShowOverview] = useState(false);
  const permissions = useMemo(
    () => new Set(authenticatedUser?.permissions ?? []),
    [authenticatedUser?.permissions],
  );
  const searching = query.trim().length > 0;
  const search = query.trim().toLocaleLowerCase();
  const selected = REPORT_CATEGORIES.flatMap((category) =>
    category.reports.map((report) => ({ category, report })),
  ).find(({ report }) => report.id === selectedId);
  const matches = (category: ReportCategory, report: ReportEntry) =>
    !search ||
    `${category.name} ${report.group ?? ''} ${report.name}`.toLocaleLowerCase().includes(search);
  const matchingCount = REPORT_CATEGORIES.reduce(
    (total, category) =>
      total + category.reports.filter((report) => matches(category, report)).length,
    0,
  );
  const modules = currentFacility?.enabledModules ?? [];
  const hidden = currentFacility?.hiddenModules ?? [];
  const moduleEnabled = (module: string) => modules.includes(module) && !hidden.includes(module);
  const has = (...required: readonly string[]) =>
    required.every((permission) => permissions.has(permission));
  const canOverview =
    has('reports.read', 'billing.read', 'inpatient.read', 'patients.read') &&
    moduleEnabled('finance') &&
    moduleEnabled('inpatient');
  const canInvoice =
    has('reports.read', 'reports.export', 'billing.read', 'clinical.read', 'patients.read') &&
    moduleEnabled('finance');
  const scopeKey = `${authenticatedUser?.id}:${currentFacility?.id}:${[...permissions].sort().join(',')}:${modules.join(',')}:${hidden.join(',')}`;

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) {
    setter((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function availability(report: ReportEntry): { label: string; allowed: boolean; reason?: string } {
    if (report.engine) {
      const definition = REPORT_ENGINES[report.engine];
      if (!moduleEnabled(definition.module))
        return {
          label: 'Module unavailable',
          allowed: false,
          reason: `The ${definition.module} module is disabled or hidden for this facility.`,
        };
      if (!has(...definition.permissions))
        return {
          label: 'Permission required',
          allowed: false,
          reason: 'Your account needs the report and source-domain permissions for this view.',
        };
      return { label: 'Limited view', allowed: true };
    }
    if (report.workflow === 'invoice') {
      if (!canInvoice)
        return {
          label: 'Access required',
          allowed: false,
          reason:
            'This document requires the finance module plus reports read/export, billing, clinical and patient read permissions.',
        };
      return { label: 'Existing document', allowed: true };
    }
    return { label: 'Unavailable', allowed: false, reason: report.dependency };
  }
  const reportButton = (report: ReportEntry) => {
    const state = availability(report);
    return (
      <button
        key={report.id}
        type="button"
        onClick={() => {
          setSelectedId(report.id);
          setShowOverview(false);
        }}
        aria-current={selectedId === report.id && !showOverview ? 'true' : undefined}
        className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition ${selectedId === report.id && !showOverview ? 'bg-teal-50 text-teal-900' : 'text-slate-700 hover:bg-slate-50'}`}
      >
        <span className="text-xs font-semibold leading-5">{report.name}</span>
        <span
          className={`mt-0.5 shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${state.allowed ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-500'}`}
        >
          {state.label}
        </span>
      </button>
    );
  };

  if (
    !authenticatedUser ||
    authenticatedUser.isSuperAdmin ||
    authenticatedUser.roles?.includes('SUPER_ADMIN')
  ) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">
        A signed-in facility account with report permissions is required to use the Reporting
        Centre.
      </div>
    );
  }
  if (!currentFacility) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">
        Select a facility to use the Reporting Centre.
      </div>
    );
  }
  if (!has('reports.read') || !moduleEnabled('analytics')) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">
        Reports are disabled, hidden or not permitted for this facility account.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-2xs font-bold uppercase tracking-[0.18em] text-teal-700">
            JaliCare · Facility intelligence
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Reporting Centre
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {currentFacility.name} <span className="mx-1 text-slate-300">·</span> Reports are scoped
            to your selected facility.
          </p>
        </div>
        <button
          type="button"
          disabled={!canOverview}
          onClick={() => setShowOverview((shown) => !shown)}
          title={
            canOverview
              ? 'Open the existing operational analytics'
              : 'Requires billing, inpatient and patient permissions and enabled source modules.'
          }
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {showOverview ? <ArrowLeft className="h-4 w-4" /> : <BarChart3 className="h-4 w-4" />}
          {showOverview ? 'Back to report catalogue' : 'Existing analytics overview'}
        </button>
      </header>
      {showOverview && canOverview ? (
        <div className="space-y-4" key={scopeKey}>
          <div
            role="note"
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <strong>Unreconciled legacy analytics.</strong> Invoice-cohort figures are not
            transaction-date collections, recognized revenue, settled cash or an approved financial
            statement. Historical admission times also need review; do not use this overview as a
            reconciled or statutory report.
          </div>
          <ReportsModule />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-gradient-to-r from-teal-50 to-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-teal-950">All reports, one place</p>
              <p className="mt-1 text-xs leading-relaxed text-teal-800">
                Browse seven categories. Unavailable reports explain their dependencies; limited
                views are clearly labelled.
              </p>
            </div>
            <span className="self-start whitespace-nowrap rounded-full border border-teal-200 bg-white px-3 py-1.5 text-2xs font-bold uppercase tracking-wide text-teal-700">
              {REPORT_CATEGORIES.length} categories · 144 entries
            </span>
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.3fr)]">
            <aside
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              aria-label="Report categories"
            >
              <div className="border-b border-slate-100 p-4">
                <label className="relative block">
                  <span className="sr-only">Search reports</span>
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search reports or departments"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-800"
                  />
                </label>
                <p className="mt-2 text-2xs text-slate-400">
                  {searching
                    ? `${matchingCount} matching entries`
                    : 'Expand a category to browse reports'}
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {REPORT_CATEGORIES.map((category) => {
                  const Icon = icons[category.id] ?? ClipboardList;
                  const reports = category.reports.filter((report) => matches(category, report));
                  const open = searching
                    ? reports.length > 0 && !expanded.has(`search:${category.id}`)
                    : expanded.has(category.id);
                  const ungrouped = reports.filter((report) => !report.group);
                  const groups = [
                    ...new Set(reports.flatMap((report) => (report.group ? [report.group] : []))),
                  ];
                  return (
                    <div key={category.id} data-testid={`report-category-${category.id}`}>
                      <button
                        type="button"
                        aria-expanded={open}
                        disabled={searching && reports.length === 0}
                        onClick={() =>
                          toggle(setExpanded, searching ? `search:${category.id}` : category.id)
                        }
                        className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50 disabled:cursor-default"
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-bold tracking-wide text-slate-900">
                            {category.name}
                          </span>
                          <span className="mt-0.5 block text-2xs text-slate-400">
                            {reports.length} report{reports.length === 1 ? '' : 's'}
                          </span>
                        </span>
                        {open ? (
                          <ChevronDown className="h-4 w-4 text-slate-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-slate-400" />
                        )}
                      </button>
                      {open && (
                        <div className="space-y-1 px-3 pb-3">
                          {ungrouped.map(reportButton)}
                          {groups.map((group) => {
                            const groupKey = `${category.id}:${group}`;
                            const groupOpen = searching
                              ? !expandedGroups.has(`search:${groupKey}`)
                              : expandedGroups.has(groupKey);
                            return (
                              <div key={groupKey} className="rounded-lg border border-slate-100">
                                <button
                                  type="button"
                                  aria-expanded={groupOpen}
                                  onClick={() =>
                                    toggle(
                                      setExpandedGroups,
                                      searching ? `search:${groupKey}` : groupKey,
                                    )
                                  }
                                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-2xs font-bold tracking-wide text-slate-600 hover:bg-slate-50"
                                >
                                  {groupOpen ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  )}
                                  {group}
                                </button>
                                {groupOpen && (
                                  <div className="border-t border-slate-100 p-1">
                                    {reports
                                      .filter((report) => report.group === group)
                                      .map(reportButton)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {searching && matchingCount === 0 && (
                <p className="px-4 py-5 text-center text-xs text-slate-500">
                  No reports match “{query}”.
                </p>
              )}
            </aside>
            <main
              className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
              aria-label="Selected report"
            >
              {!selected ? (
                <div className="flex min-h-72 flex-col items-center justify-center text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
                    <ClipboardList className="h-6 w-6" />
                  </span>
                  <h2 className="mt-4 text-lg font-bold text-slate-900">Select a report</h2>
                  <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
                    Search or expand a category to see its purpose, availability and source
                    dependencies.
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="border-b border-slate-100 pb-4">
                    <p className="text-2xs font-bold uppercase tracking-widest text-teal-700">
                      {selected.category.name}
                      {selected.report.group ? ` / ${selected.report.group}` : ''}
                    </p>
                    <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900">
                      {selected.report.name}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">{selected.category.description}</p>
                  </div>
                  {availability(selected.report).allowed && selected.report.engine ? (
                    <ReportWorkbench
                      key={`${scopeKey}:${selected.report.id}`}
                      id={selected.report.engine}
                      facilityId={currentFacility.id}
                      canExport={has('reports.export')}
                    />
                  ) : availability(selected.report).allowed &&
                    selected.report.workflow === 'invoice' ? (
                    <InvoiceDocument key={scopeKey} />
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      <div className="flex items-center gap-2 font-semibold">
                        <LockKeyhole className="h-4 w-4" /> {availability(selected.report).label}
                      </div>
                      <p className="mt-2 leading-relaxed">{availability(selected.report).reason}</p>
                      {!selected.report.engine && !selected.report.workflow && (
                        <p className="mt-2 text-xs">
                          This entry cannot generate a report yet. No results are inferred or
                          fabricated.
                        </p>
                      )}
                    </div>
                  )}
                  {(selected.report.engine || selected.report.workflow) && (
                    <p className="text-xs text-slate-400">
                      Full requested report still needs: {selected.report.dependency}
                    </p>
                  )}
                </div>
              )}
            </main>
          </div>
        </>
      )}
    </div>
  );
};
