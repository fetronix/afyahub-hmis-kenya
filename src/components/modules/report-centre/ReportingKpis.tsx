import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, Loader2, ShieldAlert } from 'lucide-react';
import { reportCentreApi } from '../../../api/report-centre.client.ts';
import type { ReportingKpi, ReportingOverview } from '../../../reporting/report-centre.overview.ts';

const statusTone: Record<string, string> = {
  restricted: 'border-amber-200 bg-amber-50 text-amber-900',
  disabled: 'border-slate-200 bg-slate-50 text-slate-600',
  error: 'border-rose-200 bg-rose-50 text-rose-800',
};

function money(amount: string, currency: string | null) {
  return `${currency ?? 'Currency not recorded'} ${amount}`;
}

/**
 * A bar chart of a real daily series.
 *
 * No smoothing, no interpolation and no invented points: a day with no recorded
 * activity is a zero-height bar because the server sent that day with a zero.
 */
function Sparkline({ kpi }: { kpi: ReportingKpi }) {
  const series = kpi.series ?? [];
  const values = series.map((point) => point.value);
  if (!series.length || values.some((value) => value < 0)) return null;
  const peak = Math.max(...values);
  if (peak <= 0) return null;
  const busiest = series[values.indexOf(peak)]?.day ?? '';
  return (
    <div className="mt-3">
      <svg
        viewBox={`0 0 ${Math.max(series.length, 2) * 4} 24`}
        className="h-8 w-full"
        role="img"
        aria-label={`${kpi.label} by day. Highest on ${busiest}.`}
        preserveAspectRatio="none"
      >
        {series.map((point, index) => {
          const height = peak === 0 ? 0 : Math.round((point.value / peak) * 22);
          return (
            <rect
              key={point.day}
              x={index * 4}
              y={24 - height}
              width={3}
              height={Math.max(height, point.value > 0 ? 1 : 0)}
              className="fill-brand-500"
              rx={0.6}
            />
          );
        })}
      </svg>
      <p className="mt-1 text-2xs text-muted">
        By day · highest {busiest} ({peak.toLocaleString()})
      </p>
    </div>
  );
}

function Card({ kpi }: { kpi: ReportingKpi }) {
  const unavailable = kpi.status !== 'ok';
  return (
    <article
      data-kpi={kpi.id}
      data-kpi-status={kpi.status}
      className="flex min-w-0 flex-col rounded-xl border border-hair bg-surface p-4 shadow-card"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs font-semibold text-ink-soft">{kpi.label}</h3>
        {unavailable && (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold ${statusTone[kpi.status]}`}
          >
            {kpi.status === 'restricted' ? (
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
            ) : kpi.status === 'disabled' ? (
              <Ban className="h-3 w-3" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            )}
            {kpi.status === 'restricted'
              ? 'Restricted'
              : kpi.status === 'disabled'
                ? 'Not enabled'
                : 'Unavailable'}
          </span>
        )}
      </div>

      {kpi.status === 'ok' ? (
        <>
          <p className="mt-2 text-2xl font-bold leading-none tracking-tight text-ink">
            {kpi.id === 'revenue' || kpi.id === 'outstanding-balances'
              ? money(kpi.amount ?? '0.00', kpi.currency ?? null)
              : (kpi.value ?? 0).toLocaleString()}
          </p>
          {kpi.id === 'outstanding-balances' && kpi.asOf && (
            <p className="mt-1 text-2xs text-muted">
              {(kpi.value ?? 0).toLocaleString()} invoice{(kpi.value ?? 0) === 1 ? '' : 's'} with a
              balance · snapshot as at {kpi.asOf}
            </p>
          )}
          {kpi.id === 'pharmacy-stock-alerts' && kpi.asOf && (
            <p className="mt-1 text-2xs text-muted">Snapshot as at {kpi.asOf}</p>
          )}
          <Sparkline kpi={kpi} />
        </>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          {kpi.message ?? 'This figure is not available.'}
        </p>
      )}

      <p className="mt-3 border-t border-hair pt-2 text-2xs leading-relaxed text-muted">
        {kpi.definition}
      </p>
    </article>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="h-32 animate-pulse rounded-xl border border-hair bg-surface" />
      ))}
    </div>
  );
}

/**
 * The four headline figures.
 *
 * They are loaded from the server for the selected facility and period. A card
 * without a number is a refusal with a reason, never a zero: see
 * `report-centre.overview.ts` for why that distinction is enforced there.
 */
export const ReportingKpis: React.FC<{
  facilityId: number;
  from: string;
  to: string;
  /** Changes when the facility or period changes, so a stale response is dropped. */
  requestKey: string;
}> = ({ facilityId, from, to, requestKey }) => {
  /*
   * The response is stored with the key it answers. Only a response for the
   * key on screen can render, so a slow request for the previous facility can
   * never overwrite the figures of the one the user is looking at — and no
   * state is written while the effect is starting.
   */
  const [state, setState] = useState<{
    key: string;
    overview: ReportingOverview | null;
    error: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    reportCentreApi
      .overview(facilityId, from, to)
      .then((result) => {
        if (!cancelled) setState({ key: requestKey, overview: result, error: '' });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setState({
          key: requestKey,
          overview: null,
          error:
            reason instanceof Error ? reason.message : 'The headline figures could not be loaded.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, facilityId, from, to]);

  const current = state?.key === requestKey ? state : null;
  const overview = current?.overview ?? null;
  const error = current?.error ?? '';
  const kpis = useMemo(() => overview?.kpis ?? [], [overview]);

  if (!current) return <Skeleton />;

  if (error)
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs leading-relaxed text-rose-800"
      >
        <p className="font-semibold">Headline figures could not be loaded</p>
        <p className="mt-1">{error}</p>
        <p className="mt-1">
          The reports below are unaffected. No figure is shown rather than an unverified one.
        </p>
      </div>
    );

  return (
    <section aria-label="Reporting summary" className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.id} kpi={kpi} />
        ))}
      </div>
      <p className="text-2xs leading-relaxed text-muted">
        {overview?.from} to {overview?.to} · {overview?.facilityName}. A figure appears only when
        its source data could be read; everything else states why it is missing.
      </p>
    </section>
  );
};
