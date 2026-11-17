import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, LockKeyhole } from 'lucide-react';
import {
  REPORT_CATEGORIES,
  reportImplementation,
  type ReportCategory,
  type ReportEntry,
} from '../../../reporting/report-catalogue.ts';

export interface Availability {
  label: string;
  allowed: boolean;
  reason?: string;
}

const statusTone: Record<string, string> = {
  available: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'existing-document': 'border-sky-200 bg-sky-50 text-sky-800',
  unavailable: 'border-slate-200 bg-slate-50 text-slate-600',
};

/** Reports that can actually be opened are listed before the ones that cannot. */
function rank(entry: ReportEntry) {
  if (entry.engine) return 0;
  if (entry.workflow) return 1;
  return 2;
}

const PAGE_SIZE = 6;

function ReportRow({
  entry,
  availability,
  onOpen,
}: {
  entry: ReportEntry;
  availability: Availability;
  onOpen: () => void;
}) {
  const status = reportImplementation(entry);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-brand-50/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-semibold text-ink">{entry.name}</span>
            {!availability.allowed && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-2xs font-semibold text-amber-900">
                <LockKeyhole className="h-3 w-3" aria-hidden="true" />
                {availability.label}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-2xs leading-relaxed text-muted">{entry.summary}</span>
        </span>
        <span
          className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-2xs font-semibold ${statusTone[status.status]}`}
          title={status.detail}
        >
          {status.label}
        </span>
      </button>
    </li>
  );
}

/**
 * Browsing surface.
 *
 * Every category states how many reports it holds and how many of those can be
 * opened today, so the count is a fact about this build rather than a promise.
 * The full list is always reachable, including the reports that are not
 * implemented — hiding them would make the coverage look better than it is.
 */
export const ReportCataloguePanel: React.FC<{
  query: string;
  availability: (entry: ReportEntry) => Availability;
  onOpen: (category: ReportCategory, entry: ReportEntry) => void;
  highlightCategory?: string | null;
}> = ({ query, availability, onOpen, highlightCategory }) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const search = query.trim().toLocaleLowerCase();

  const categories = useMemo(
    () =>
      REPORT_CATEGORIES.map((category) => {
        const reports = category.reports
          .filter(
            (entry) =>
              !search ||
              `${category.name} ${category.description} ${entry.name} ${entry.summary} ${entry.group ?? ''}`
                .toLocaleLowerCase()
                .includes(search),
          )
          .slice()
          .sort((a, b) => rank(a) - rank(b));
        const available = category.reports.filter(
          (entry) => entry.engine !== null || entry.workflow !== null,
        ).length;
        return { category, reports, available };
      }),
    [search],
  );

  const matching = categories.reduce((total, item) => total + item.reports.length, 0);

  return (
    <section aria-label="Report catalogue" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold tracking-tight text-ink">Report categories</h2>
          <p className="mt-0.5 text-xs text-muted">
            {REPORT_CATEGORIES.length} categories · {matching} report
            {matching === 1 ? '' : 's'}
            {search ? ' match your search' : ' in this build'}. Available reports are listed first.
          </p>
        </div>
      </div>

      {matching === 0 ? (
        <div className="rounded-xl border border-dashed border-hair p-8 text-center">
          <p className="text-sm font-semibold text-ink">No reports match “{query.trim()}”</p>
          <p className="mt-1 text-xs text-muted">
            Search by report name, purpose or department. The categories are unaffected.
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {categories.map(({ category, reports, available }) => {
            if (reports.length === 0) return null;
            const open = Boolean(expanded[category.id]) || Boolean(search);
            const visible = open ? reports : reports.slice(0, PAGE_SIZE);
            const highlighted = highlightCategory === category.id;
            return (
              <article
                key={category.id}
                data-testid={`report-category-${category.id}`}
                className={`min-w-0 rounded-xl border bg-surface shadow-card ${
                  highlighted ? 'border-brand-300' : 'border-hair'
                }`}
              >
                <header className="border-b border-hair px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-xs font-bold tracking-tight text-ink">{category.name}</h3>
                    <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
                      {reports.length} report{reports.length === 1 ? '' : 's'} · {available}{' '}
                      available
                    </p>
                  </div>
                  <p className="mt-1 text-2xs leading-relaxed text-muted">{category.description}</p>
                </header>
                <ul className="divide-y divide-hair/70 p-1">
                  {visible.map((entry) => (
                    <ReportRow
                      key={entry.id}
                      entry={entry}
                      availability={availability(entry)}
                      onOpen={() => onOpen(category, entry)}
                    />
                  ))}
                </ul>
                {!search && reports.length > PAGE_SIZE && (
                  <div className="border-t border-hair px-3 py-2">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() =>
                        setExpanded((current) => ({
                          ...current,
                          [category.id]: !current[category.id],
                        }))
                      }
                      className="inline-flex items-center gap-1 text-2xs font-semibold text-brand-700 hover:underline"
                    >
                      {open ? (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {open ? 'Show fewer reports' : `Show all ${reports.length} reports`}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
