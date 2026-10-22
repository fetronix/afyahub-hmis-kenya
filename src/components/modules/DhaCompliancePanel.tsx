import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

import { api } from '../../api/client.ts';

/*
 * DHA self-assessment
 * ===================
 *
 * The figure on this panel is computed on the server from
 * `src/compliance/dha-requirements.ts`. It is deliberately not a free
 * number:
 *
 *   - each requirement carries a status and an evidence string,
 *   - a critical gap caps the whole score below a pass,
 *   - NOT_APPLICABLE is excluded from the denominator,
 *   - and the response states `certification: false`.
 *
 * The panel shows the working, not just the total, because a total is
 * exactly what a compliance claim hides behind.
 */

type Status =
  | 'VERIFIED'
  | 'IMPLEMENTED_UNTESTED'
  | 'PARTIAL'
  | 'MISSING'
  | 'BLOCKED'
  | 'NOT_APPLICABLE';

interface Requirement {
  id: string;
  category: string;
  title: string;
  requirement: string;
  module: string;
  status: Status;
  severity: string;
  evidence: string;
  verification: string;
  externalDependency?: string;
  note?: string;
}

interface Report {
  generatedAt: string;
  categories: Array<{
    category: string;
    label: string;
    weight: number;
    assessed: number;
    verified: number;
    score: number;
    contribution: number;
  }>;
  weightedAverage: number;
  overallScore: number;
  criticalGateTriggered: boolean;
  criticalGaps: Array<{
    id: string;
    title: string;
    status: string;
    severity: string;
    dependency?: string;
  }>;
  readyForSubmission: boolean;
  counts: Record<Status, number>;
  totalRequirements: number;
  certification: false;
  disclaimer: string;
  requirements: Requirement[];
}

const STATUS_STYLE: Record<Status, { label: string; className: string }> = {
  VERIFIED: {
    label: 'Verified in repo',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  IMPLEMENTED_UNTESTED: {
    label: 'Built, untested',
    className: 'border-brand-200 bg-brand-50 text-brand-800',
  },
  PARTIAL: {
    label: 'Partial',
    className: 'border-amber-200 bg-amber-50 text-amber-900',
  },
  MISSING: {
    label: 'Missing',
    className: 'border-rose-200 bg-rose-50 text-rose-800',
  },
  BLOCKED: {
    label: 'Blocked externally',
    className: 'border-rose-300 bg-rose-100 text-rose-900',
  },
  NOT_APPLICABLE: {
    label: 'Not applicable',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
  },
};

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'text-rose-700 font-bold',
  high: 'text-amber-800 font-semibold',
  medium: 'text-slate-700',
  low: 'text-slate-500',
};

export const DhaCompliancePanel: React.FC = () => {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const result = await api.getDhaCompliance();
      setReport(result as Report);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'The self-assessment could not be read.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="panel flex items-center gap-2 px-5 py-4 text-xs text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Reading the requirements register…
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="panel px-5 py-4 text-xs">
        <p className="font-semibold text-ink">Self-assessment unavailable</p>
        <p className="mt-1 text-muted">{error}</p>
      </div>
    );
  }

  return (
    <section className="panel overflow-hidden">
      <div className="panel-header">
        <div>
          <p className="eyebrow">DHA readiness · technical self-assessment</p>
          <h2 className="mt-1 text-sm font-bold text-ink">
            {report.totalRequirements} requirements, scored from evidence
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`rounded-lg border px-2.5 py-1 text-2xs font-semibold ${
              report.criticalGateTriggered
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {report.criticalGateTriggered ? 'Critical gap present' : 'No critical gap'}
          </span>
        </div>
      </div>

      {/* The number, and what it is not */}
      <div className="grid grid-cols-1 gap-px bg-hair sm:grid-cols-3">
        <div className="bg-surface px-5 py-4">
          <p className="eyebrow">Reported score</p>
          <p className="stat-value mt-1">{report.overallScore}%</p>
          <p className="mt-1 text-2xs text-muted">
            Weighted average {report.weightedAverage}%
            {report.criticalGateTriggered
              ? ' — capped because a critical requirement is unmet'
              : ''}
          </p>
        </div>

        <div className="bg-surface px-5 py-4">
          <p className="eyebrow">Verified in this repository</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-ink">
            {report.counts.VERIFIED ?? 0}
            <span className="text-sm text-muted"> / {report.totalRequirements}</span>
          </p>
          <p className="mt-1 text-2xs text-muted">
            Missing {report.counts.MISSING ?? 0} · blocked{' '}
            {report.counts.BLOCKED ?? 0} · partial {report.counts.PARTIAL ?? 0}
          </p>
        </div>

        <div className="bg-surface px-5 py-4">
          <p className="eyebrow">Submission status</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
            {report.readyForSubmission ? (
              <>
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Ready to submit for review
              </>
            ) : (
              <>
                <ShieldAlert className="h-4 w-4 text-rose-600" />
                Not ready to submit
              </>
            )}
          </p>
          <p className="mt-1 text-2xs text-muted">
            Not certified. Only DHA can certify.
          </p>
        </div>
      </div>

      {/* Critical gaps */}
      {report.criticalGaps.length > 0 && (
        <div className="border-t border-hair bg-rose-50/60 px-5 py-4">
          <p className="flex items-center gap-1.5 text-xs font-bold text-rose-900">
            <AlertTriangle className="h-3.5 w-3.5" />
            {report.criticalGaps.length} critical requirement
            {report.criticalGaps.length === 1 ? '' : 's'} unmet
          </p>

          <ul className="mt-2 space-y-1.5">
            {report.criticalGaps.map((gap) => (
              <li key={gap.id} className="text-2xs text-rose-900">
                <span className="font-mono font-semibold">{gap.id}</span>{' '}
                {gap.title} — {gap.status.toLowerCase()}
                {gap.dependency ? (
                  <span className="block text-rose-700">{gap.dependency}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Category working */}
      <div className="divide-y divide-hair">
        {report.categories.map((category) => {
          const items = report.requirements.filter(
            (item) => item.category === category.category,
          );
          const open = openCategory === category.category;

          return (
            <div key={category.category}>
              <button
                type="button"
                onClick={() =>
                  setOpenCategory(open ? null : category.category)
                }
                aria-expanded={open}
                className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-brand-50/40"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {open ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted" />
                  )}
                  <span className="text-xs font-semibold text-ink">
                    {category.label}
                  </span>
                  <span className="chip font-mono">
                    weight {Math.round(category.weight * 100)}%
                  </span>
                </span>

                <span className="flex items-center gap-3 text-2xs">
                  <span className="text-muted">
                    {category.verified}/{category.assessed} verified
                  </span>
                  <span className="font-mono text-sm font-bold text-ink">
                    {category.score}%
                  </span>
                </span>
              </button>

              {open && (
                <div className="overflow-x-auto border-t border-hair">
                  <table className="table-quiet">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Requirement</th>
                        <th>Status</th>
                        <th>Severity</th>
                        <th>Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id}>
                          <td className="font-mono text-2xs text-muted">{item.id}</td>
                          <td>
                            <span className="font-semibold text-ink">{item.title}</span>
                            <span className="mt-0.5 block text-2xs text-muted">
                              {item.module}
                            </span>
                            {item.note && (
                              <span className="mt-0.5 block text-2xs text-amber-800">
                                {item.note}
                              </span>
                            )}
                          </td>
                          <td>
                            <span
                              className={`inline-block rounded border px-1.5 py-0.5 text-2xs font-semibold ${STATUS_STYLE[item.status].className}`}
                            >
                              {STATUS_STYLE[item.status].label}
                            </span>
                          </td>
                          <td className={`text-2xs ${SEVERITY_STYLE[item.severity] ?? ''}`}>
                            {item.severity}
                          </td>
                          <td className="max-w-md text-2xs text-muted">
                            {item.evidence}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-hair bg-canvas px-5 py-3">
        <p className="text-2xs leading-relaxed text-muted">{report.disclaimer}</p>
        <p className="mt-1 font-mono text-2xs text-slate-400">
          generated {new Date(report.generatedAt).toLocaleString('en-KE')}
        </p>
      </div>
    </section>
  );
};

export default DhaCompliancePanel;
