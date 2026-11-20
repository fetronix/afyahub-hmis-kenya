import React, { useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, Search } from 'lucide-react';
import { useHmis } from '../../../context/HmisContext.tsx';
import {
  REPORT_CATEGORIES,
  REPORT_ENTRY_BY_ID,
  type ReportCategory,
  type ReportEntry,
} from '../../../reporting/report-catalogue.ts';
import { REPORT_ENGINES } from '../../../reporting/report-centre.types.ts';
import { PageHeader } from '../../ui/layout.tsx';
import { ReportsModule } from '../ReportsModule.tsx';
import { ReportCataloguePanel, type Availability } from './ReportCataloguePanel.tsx';
import { ReportWorkspace } from './ReportWorkspace.tsx';
import { ReportingKpis } from './ReportingKpis.tsx';

/** Category lookup by report id, so opening a report does not scan the catalogue. */
const CATEGORY_BY_REPORT = new Map(
  REPORT_CATEGORIES.flatMap((category) =>
    category.reports.map((entry) => [entry.id, category] as const),
  ),
);

/** Local calendar day, not the UTC one: in Nairobi the two differ after midnight. */
function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function defaultPeriod(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: localDay(from), to: localDay(to) };
}

function periodProblem(from: string, to: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return 'Choose both an inclusive start and end date.';
  if (from > to) return 'The start date must not be after the end date.';
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > 366) return 'Choose a period of 366 days or less.';
  return null;
}

export const ReportCentre: React.FC = () => {
  const { currentFacility, authenticatedUser, facilities } = useHmis();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [period] = useState(defaultPeriod);
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [showOverview, setShowLegacy] = useState(false);
  const [highlightCategory, setHighlightCategory] = useState<string | null>(null);
  const permissions = useMemo(
    () => new Set(authenticatedUser?.permissions ?? []),
    [authenticatedUser?.permissions],
  );

  /*
   * Only facilities the account may reach. The context already receives that
   * list from the server; this filter additionally drops anything from another
   * tenant, so a stale context cannot offer a facility the API would refuse.
   */
  const authorisedFacilities = useMemo(() => {
    const list = (facilities ?? []).filter(
      (facility) => !currentFacility || facility.tenantId === currentFacility.tenantId,
    );
    if (currentFacility && !list.some((facility) => facility.id === currentFacility.id))
      return [currentFacility, ...list];
    return list.length ? list : currentFacility ? [currentFacility] : [];
  }, [facilities, currentFacility]);

  const activeFacility =
    authorisedFacilities.find((facility) => facility.id === facilityId) ?? currentFacility ?? null;

  const modules = activeFacility?.enabledModules ?? [];
  const hidden = activeFacility?.hiddenModules ?? [];
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

  const scopeKey = `${authenticatedUser?.id}:${activeFacility?.id}:${[...permissions].sort().join(',')}:${modules.join(',')}:${hidden.join(',')}`;

  function availability(report: ReportEntry): Availability {
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
    if (report.workflow) {
      const module = report.workflow === 'discharge' ? 'inpatient' : report.workflow;
      const allowed =
        moduleEnabled(module) &&
        has('reports.read', 'reports.export', 'patients.read', `${module}.read`);
      return {
        label: allowed ? 'Existing document' : 'Access required',
        allowed,
        reason: allowed
          ? undefined
          : 'Report read/export, patient read and the enabled source-domain read permission are required.',
      };
    }
    return { label: 'Not implemented', allowed: false, reason: report.dependency };
  }

  const selectedEntry = selectedId ? (REPORT_ENTRY_BY_ID.get(selectedId) ?? null) : null;
  const selectedCategory = selectedEntry
    ? (CATEGORY_BY_REPORT.get(selectedEntry.id) ?? null)
    : null;
  const selected =
    selectedEntry && selectedCategory ? { entry: selectedEntry, category: selectedCategory } : null;

  const invalidPeriod = periodProblem(from, to);

  if (
    !authenticatedUser ||
    authenticatedUser.isSuperAdmin ||
    authenticatedUser.roles?.includes('SUPER_ADMIN')
  ) {
    return (
      <div className="rounded-xl border border-hair bg-surface p-8 text-sm text-slate-600">
        A signed-in facility account with report permissions is required to use the Reporting
        Centre.
      </div>
    );
  }
  if (!currentFacility || !activeFacility) {
    return (
      <div className="rounded-xl border border-hair bg-surface p-8 text-sm text-slate-600">
        Select a facility to use the Reporting Centre.
      </div>
    );
  }
  if (!has('reports.read') || !moduleEnabled('analytics')) {
    return (
      <div className="rounded-xl border border-hair bg-surface p-8 text-sm text-slate-600">
        Reports are disabled, hidden or not permitted for this facility account.
      </div>
    );
  }

  const openCategory = (category: ReportCategory) => {
    setSelectedId(null);
    setShowLegacy(false);
    setHighlightCategory(category.id);
    window.setTimeout(() => {
      document
        .querySelector(`[data-testid="report-category-${category.id}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 0);
  };

  return (
    <div className="space-y-4">
      <PageHeader>
        <div className="min-w-0">
          <p className="text-2xs font-bold uppercase tracking-[0.18em] text-brand-700">
            Syrona Medical Center · Facility intelligence
          </p>
          <h1 className="ui-page-title mt-1">Reporting Centre</h1>
          <p className="ui-page-description">
            Operative reports for {activeFacility.name}, drawn from the records this facility
            already holds. Every report states what it covers and what it does not.
          </p>
        </div>

        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <label className="ui-form-field text-2xs font-semibold text-ink-soft">
            Facility
            <select
              className="mt-1 block w-full min-w-44 rounded-lg border border-hair bg-surface px-3 py-2 text-xs text-ink focus:border-brand-500"
              value={activeFacility.id}
              onChange={(event) => {
                setFacilityId(Number(event.target.value));
                setSelectedId(null);
                setShowLegacy(false);
              }}
              aria-describedby="reporting-facility-hint"
            >
              {authorisedFacilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-form-field text-2xs font-semibold text-ink-soft">
            From
            <input
              type="date"
              className="mt-1 block w-full rounded-lg border border-hair bg-surface px-3 py-2 text-xs text-ink focus:border-brand-500"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="ui-form-field text-2xs font-semibold text-ink-soft">
            To
            <input
              type="date"
              className="mt-1 block w-full rounded-lg border border-hair bg-surface px-3 py-2 text-xs text-ink focus:border-brand-500"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <label className="ui-form-field min-w-52 flex-1 text-2xs font-semibold text-ink-soft">
            <span className="sr-only">Search reports</span>
            <span className="ui-search mt-0.5">
              <Search className="h-4 w-4" aria-hidden="true" />
              <input
                type="search"
                aria-label="Search reports"
                placeholder="Search reports or departments"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  // Searching is browsing: leave an open report so the matches are visible.
                  if (event.target.value) {
                    setSelectedId(null);
                    setShowLegacy(false);
                    setHighlightCategory(null);
                  }
                }}
              />
            </span>
          </label>
        </div>
      </PageHeader>

      <p id="reporting-facility-hint" className="text-2xs leading-relaxed text-muted">
        Only facilities your account is authorised to reach are listed. Reports read this facility
        and no other; the server checks the choice again on every request.
      </p>

      {!selected &&
        !showOverview &&
        (invalidPeriod ? (
          <div
            role="alert"
            className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
          >
            {invalidPeriod} The headline figures wait for a valid period; the catalogue is
            unaffected.
          </div>
        ) : (
          <ReportingKpis
            key={`${activeFacility.id}:${from}:${to}`}
            facilityId={activeFacility.id}
            from={from}
            to={to}
            requestKey={`${activeFacility.id}:${from}:${to}`}
          />
        ))}

      {selected ? (
        <ReportWorkspace
          key={`${scopeKey}:${selected.entry.id}`}
          category={selected.category}
          entry={selected.entry}
          facilityId={activeFacility.id}
          facilityName={activeFacility.name}
          canExport={
            selected.entry.engine
              ? has(
                  'reports.export',
                  ...(REPORT_ENGINES[selected.entry.engine].exportPermissions ?? []),
                )
              : has('reports.export')
          }
          availability={availability(selected.entry)}
          onBack={() => setSelectedId(null)}
          onBackToCategory={() => openCategory(selected.category)}
        />
      ) : showOverview && canOverview ? (
        <section className="space-y-3" aria-label="Legacy analytics">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold tracking-tight text-ink">Legacy analytics overview</h2>
            <button
              type="button"
              onClick={() => setShowLegacy(false)}
              className="ui-button ui-button-secondary"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to report catalogue
            </button>
          </div>
          <div
            role="note"
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <strong>Unreconciled legacy analytics.</strong> Invoice-cohort figures are not
            transaction-date collections, recognized revenue, settled cash or an approved financial
            statement. Historical admission times also need review; do not use this overview as a
            reconciled or statutory report.
          </div>
          <div className="space-y-4" key={scopeKey}>
            <ReportsModule />
          </div>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {REPORT_CATEGORIES.length} categories · every requested report, including the ones
              still to be built.
            </p>
            <button
              type="button"
              disabled={!canOverview}
              onClick={() => setShowLegacy(true)}
              title={
                canOverview
                  ? 'Open the existing operational analytics'
                  : 'Requires billing, inpatient and patient permissions and enabled source modules.'
              }
              className="ui-button ui-button-secondary"
            >
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              Existing analytics overview
            </button>
          </div>
          <ReportCataloguePanel
            query={query}
            availability={availability}
            highlightCategory={highlightCategory}
            onOpen={(_category, entry) => {
              setHighlightCategory(null);
              setSelectedId(entry.id);
            }}
          />
          <p className="text-2xs leading-relaxed text-muted">
            Selecting any report opens its own workspace with its period, facility and filters.
            Reports without an engine explain what they still need rather than showing an empty
            result.
          </p>
        </>
      )}
    </div>
  );
};
