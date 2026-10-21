import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import {
  OperationsReport,
  RevenueReport,
  OccupancyTrendResponse,
} from '../../types/index.ts';

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BedDouble,
  Clock,
  Coins,
  Loader2,
  RefreshCw,
  TrendingUp,
  Wallet,
} from 'lucide-react';

/* ============================================================
   PERIOD SELECTOR
   ============================================================ */

type PeriodId = 'today' | '7d' | '30d' | '90d' | 'all';

const PERIODS: ReadonlyArray<{ id: PeriodId; label: string; days: number | null }> = [
  { id: 'today', label: 'Today', days: 0 },
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
];

/**
 * Local calendar date as YYYY-MM-DD.
 *
 * toISOString() would be wrong here: in Nairobi (UTC+3) the local day
 * starts three hours before UTC midnight, so between 00:00 and 03:00
 * the UTC date is still yesterday and "Today" would return nothing.
 */
function localDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-');
}

function periodRange(period: PeriodId): { from?: string; to?: string } {
  const spec = PERIODS.find((candidate) => candidate.id === period);

  if (!spec || spec.days === null) return {};

  const today = new Date();
  const to = localDateKey(today);

  if (spec.days === 0) {
    return { from: to, to };
  }

  const from = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - (spec.days - 1),
  );

  return { from: localDateKey(from), to };
}

/* ============================================================
   FORMATTERS
   ============================================================ */

function formatKes(value: string | number | null | undefined): string {
  const number = Number(value ?? 0);

  if (!Number.isFinite(number)) return 'KES 0';

  return `KES ${number.toLocaleString('en-KE', {
    minimumFractionDigits: number % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';

  return `${value} ${value === 1 ? 'day' : 'days'}`;
}

function serviceLabel(itemType: string): string {
  return itemType
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function occupancyTone(rate: number): string {
  if (rate >= 90) return 'bg-rose-500';
  if (rate >= 75) return 'bg-amber-500';
  return 'bg-teal-500';
}

/* ============================================================
   SMALL PRESENTATIONAL PIECES
   ============================================================ */

const KpiCard: React.FC<{
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: 'default' | 'good' | 'warn';
}> = ({ label, value, hint, icon, tone = 'default' }) => (
  <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
    <div className="flex items-center justify-between text-slate-400">
      <span className="text-2xs font-semibold tracking-wider uppercase text-slate-500">
        {label}
      </span>
      {icon}
    </div>

    <div
      className={`mt-2 text-xl font-bold font-mono tabular-nums ${
        tone === 'warn'
          ? 'text-rose-700'
          : tone === 'good'
            ? 'text-emerald-700'
            : 'text-slate-900'
      }`}
    >
      {value}
    </div>

    {hint && <div className="mt-1 text-2xs text-slate-500">{hint}</div>}
  </div>
);

const SectionCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, action, children }) => (
  <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
    <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-gradient-to-r from-slate-50 to-white">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase">
          {title}
        </h2>
      </div>
      {action}
    </div>
    <div className="p-5">{children}</div>
  </div>
);

const EmptyRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="py-8 text-center text-xs text-slate-500">{children}</div>
);

/* ============================================================
   MODULE
   ============================================================ */

export const ReportsModule: React.FC = () => {
  const { currentFacility, showToast, refreshKey } = useHmis();

  const [period, setPeriod] = useState<PeriodId>('30d');

  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [operations, setOperations] = useState<OperationsReport | null>(null);
  const [trend, setTrend] = useState<OccupancyTrendResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => periodRange(period), [period]);

  const load = useCallback(async () => {
    if (!currentFacility?.id) {
      setRevenue(null);
      setOperations(null);
      setTrend(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const results = await Promise.allSettled([
      api.getRevenueReport(currentFacility.id, range),
      api.getOperationsReport(currentFacility.id),
      api.getOccupancyTrend(currentFacility.id, 14),
    ]);

    const [revenueResult, operationsResult, trendResult] = results;

    if (revenueResult.status === 'fulfilled') {
      setRevenue(revenueResult.value);
    } else {
      console.error('Revenue report failed:', revenueResult.reason);
      setRevenue(null);
    }

    if (operationsResult.status === 'fulfilled') {
      setOperations(operationsResult.value);
    } else {
      console.error('Operations report failed:', operationsResult.reason);
      setOperations(null);
    }

    if (trendResult.status === 'fulfilled') {
      setTrend(trendResult.value);
    } else {
      console.error('Occupancy trend failed:', trendResult.reason);
      setTrend(null);
    }

    const firstFailure = results.find((result) => result.status === 'rejected');

    if (firstFailure && firstFailure.status === 'rejected') {
      const reason = firstFailure.reason;

      setError(
        reason instanceof Error ? reason.message : 'Unable to load one or more reports.',
      );
    }

    setLoading(false);
  }, [currentFacility?.id, range]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const byService = revenue?.byService ?? [];

  const topRevenue = byService.reduce(
    (max, row) => Math.max(max, Number(row.revenue) || 0),
    0,
  );

  const serviceTotal = byService.reduce(
    (sum, row) => sum + (Number(row.revenue) || 0),
    0,
  );

  const trendMax = Math.max(
    1,
    ...(trend?.points.map((point) => point.occupiedBeds) ?? [1]),
  );

  if (!currentFacility) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
        <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto mb-2" />
        <p className="text-sm text-slate-700">
          Select a facility to view its reports.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-card border border-hair bg-surface p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-card">
        <div>
          <h1 className="font-display text-[1.35rem] leading-tight tracking-tight text-ink">
            Reports &amp; Analytics
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {currentFacility.name}
            <span className="mx-1.5 text-slate-300">·</span>
            <span className="font-mono">{currentFacility.mflCode || 'No MFL'}</span>
            <span className="mx-1.5 text-slate-300">·</span>
            Revenue period: {PERIODS.find((p) => p.id === period)?.label}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {PERIODS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPeriod(option.id)}
                className={`px-2.5 py-1 rounded-md text-2xs font-semibold transition-colors ${
                  period === option.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="px-3 py-1.5 border border-slate-200 rounded-md text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading && !revenue && !operations ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 flex items-center justify-center gap-3 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Building reports…</span>
        </div>
      ) : (
        <>
          {/* ============================ REVENUE ============================ */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                label="Invoiced"
                value={formatKes(revenue?.totals.invoiced)}
                hint={`${revenue?.totals.invoiceCount ?? 0} invoice${
                  (revenue?.totals.invoiceCount ?? 0) === 1 ? '' : 's'
                } in period`}
                icon={<Coins className="w-4 h-4 text-blue-700" />}
              />

              <KpiCard
                label="Collected"
                value={formatKes(revenue?.totals.collected)}
                hint="Paid against those invoices"
                tone="good"
                icon={<Wallet className="w-4 h-4 text-emerald-700" />}
              />

              <KpiCard
                label="Outstanding"
                value={formatKes(revenue?.totals.outstanding)}
                hint="Balance still owed by patients and payers"
                tone={(Number(revenue?.totals.outstanding ?? 0) > 0) ? 'warn' : 'default'}
                icon={<ArrowUpRight className="w-4 h-4 text-rose-600" />}
              />

              <KpiCard
                label="Voided"
                value={String(revenue?.totals.voidedCount ?? 0)}
                hint="Excluded from every figure above"
                icon={<RefreshCw className="w-4 h-4 text-slate-400" />}
              />
            </div>

            <SectionCard
              title="Revenue by Service"
              icon={<BarChart3 className="w-4 h-4 text-blue-700" />}
              action={
                <span className="text-2xs text-slate-500">
                  Total {formatKes(revenue?.totalRevenue)}
                </span>
              }
            >
              {byService.length === 0 ? (
                <EmptyRow>
                  No invoiced services in this period. Charges appear here as
                  soon as consultations, lab tests, medicines or bed-days are
                  billed.
                </EmptyRow>
              ) : (
                <div className="space-y-3">
                  {byService.map((row) => {
                    const amount = Number(row.revenue) || 0;
                    const share = serviceTotal > 0 ? (amount / serviceTotal) * 100 : 0;
                    const width = topRevenue > 0 ? (amount / topRevenue) * 100 : 0;

                    return (
                      <div key={`${row.itemType}-${row.sourceType ?? 'none'}`}>
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="font-medium text-slate-800">
                            {serviceLabel(row.itemType)}
                            {row.sourceType && (
                              <span className="ml-1.5 text-2xs text-slate-400 font-normal">
                                {serviceLabel(row.sourceType)}
                              </span>
                            )}
                          </span>
                          <span className="font-mono text-slate-900 tabular-nums">
                            {formatKes(amount)}
                            <span className="ml-2 text-2xs text-slate-500">
                              {share.toFixed(1)}%
                            </span>
                          </span>
                        </div>

                        <div className="mt-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-2 bg-blue-600 rounded-full"
                            style={{ width: `${Math.max(width, amount > 0 ? 1.5 : 0)}%` }}
                          />
                        </div>

                        <div className="mt-0.5 text-3xs text-slate-400">
                          {row.lineCount} line{row.lineCount === 1 ? '' : 's'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>

          {/* ======================= BED OCCUPANCY ======================= */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <KpiCard
                label="Occupancy"
                value={`${operations?.occupancy.occupancyRate ?? 0}%`}
                icon={<BedDouble className="w-4 h-4 text-teal-700" />}
                tone={(operations?.occupancy.occupancyRate ?? 0) >= 90 ? 'warn' : 'default'}
              />
              <KpiCard
                label="Beds"
                value={String(operations?.occupancy.bedCount ?? 0)}
                icon={<BedDouble className="w-4 h-4 text-slate-400" />}
              />
              <KpiCard
                label="Occupied"
                value={String(operations?.occupancy.occupiedBeds ?? 0)}
                icon={<Activity className="w-4 h-4 text-rose-600" />}
              />
              <KpiCard
                label="Available"
                value={String(operations?.occupancy.availableBeds ?? 0)}
                tone="good"
                icon={<BedDouble className="w-4 h-4 text-emerald-700" />}
              />
              <KpiCard
                label="Cleaning"
                value={String(operations?.occupancy.cleaningBeds ?? 0)}
                icon={<RefreshCw className="w-4 h-4 text-amber-600" />}
              />
              <KpiCard
                label="Out of service"
                value={String(operations?.occupancy.outOfServiceBeds ?? 0)}
                icon={<AlertTriangle className="w-4 h-4 text-slate-400" />}
              />
            </div>

            <SectionCard
              title="Occupied Bed-Days — Last 14 Days"
              icon={<TrendingUp className="w-4 h-4 text-teal-700" />}
              action={
                <span className="text-2xs text-slate-500">
                  Peak {trendMax} patient{trendMax === 1 ? '' : 's'}
                </span>
              }
            >
              {!trend || trend.points.length === 0 ? (
                <EmptyRow>No admission history to plot yet.</EmptyRow>
              ) : (
                <div className="h-32 flex items-end gap-1.5">
                  {trend.points.map((point) => {
                    const height = (point.occupiedBeds / trendMax) * 100;

                    return (
                      <div
                        key={point.date}
                        className="flex-1 flex flex-col items-center justify-end h-full gap-1 group"
                        title={`${point.date}: ${point.occupiedBeds} occupied`}
                      >
                        <span className="text-3xs text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
                          {point.occupiedBeds}
                        </span>
                        <div
                          className="w-full bg-teal-500/80 group-hover:bg-teal-600 rounded-t transition-colors"
                          style={{ height: `${Math.max(height, 2)}%` }}
                        />
                        <span className="text-3xs text-slate-400 font-mono">
                          {point.date.slice(8, 10)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Ward Occupancy"
              icon={<BedDouble className="w-4 h-4 text-teal-700" />}
            >
              {!operations || operations.wards.length === 0 ? (
                <EmptyRow>No wards configured for this facility.</EmptyRow>
              ) : (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-xs text-left">
                    <thead className="text-2xs text-slate-500 uppercase tracking-wider">
                      <tr>
                        <th className="py-2 font-medium">Ward</th>
                        <th className="py-2 font-medium text-right">Beds</th>
                        <th className="py-2 font-medium text-right">Occupied</th>
                        <th className="py-2 font-medium text-right">Free</th>
                        <th className="py-2 font-medium text-right">Avg stay</th>
                        <th className="py-2 font-medium w-40">Occupancy</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {operations.wards.map((ward) => (
                        <tr key={ward.wardId} className="hover:bg-slate-50/70">
                          <td className="py-2.5">
                            <div className="font-medium text-slate-900">{ward.wardName}</div>
                            <div className="text-2xs text-slate-400">
                              {ward.wardType ?? 'General'}
                              {ward.cleaningBeds > 0 &&
                                ` · ${ward.cleaningBeds} cleaning`}
                              {ward.outOfServiceBeds > 0 &&
                                ` · ${ward.outOfServiceBeds} out of service`}
                            </div>
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums">
                            {ward.totalBeds}
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums">
                            {ward.occupiedBeds}
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums text-emerald-700">
                            {ward.availableBeds}
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums">
                            {formatDays(ward.averageStayDays)}
                          </td>
                          <td className="py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-1.5 rounded-full ${occupancyTone(ward.occupancyRate)}`}
                                  style={{ width: `${Math.min(ward.occupancyRate, 100)}%` }}
                                />
                              </div>
                              <span className="text-2xs font-mono text-slate-600 tabular-nums w-10 text-right">
                                {ward.occupancyRate}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>

          {/* ====================== LENGTH OF STAY ====================== */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <KpiCard
                label="Inpatients now"
                value={String(operations?.lengthOfStay.activeAdmissions ?? 0)}
                icon={<BedDouble className="w-4 h-4 text-teal-700" />}
              />
              <KpiCard
                label="Average stay"
                value={formatDays(operations?.lengthOfStay.averageStayDays)}
                hint="Current inpatients"
                icon={<Clock className="w-4 h-4 text-blue-700" />}
              />
              <KpiCard
                label="Median stay"
                value={formatDays(operations?.lengthOfStay.medianStayDays)}
                hint="Current inpatients"
                icon={<Clock className="w-4 h-4 text-slate-400" />}
              />
              <KpiCard
                label="Longest stay"
                value={formatDays(operations?.lengthOfStay.longestStayDays)}
                icon={<Clock className="w-4 h-4 text-amber-600" />}
              />
              <KpiCard
                label="Over 7 days"
                value={String(operations?.lengthOfStay.overstayCount ?? 0)}
                hint="Discharge review"
                tone={(operations?.lengthOfStay.overstayCount ?? 0) > 0 ? 'warn' : 'default'}
                icon={<AlertTriangle className="w-4 h-4 text-amber-600" />}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SectionCard
                title="Length of Stay Distribution"
                icon={<BarChart3 className="w-4 h-4 text-blue-700" />}
                action={
                  <span className="text-2xs text-slate-500">
                    {operations?.lengthOfStay.activeAdmissions ?? 0} current
                  </span>
                }
              >
                {!operations || operations.lengthOfStay.activeAdmissions === 0 ? (
                  <EmptyRow>No patients are currently admitted.</EmptyRow>
                ) : (
                  <div className="space-y-2.5">
                    {operations.lengthOfStay.buckets.map((bucket) => {
                      const max = Math.max(
                        1,
                        ...operations.lengthOfStay.buckets.map((b) => b.count),
                      );
                      const width = (bucket.count / max) * 100;

                      return (
                        <div key={bucket.label} className="flex items-center gap-3">
                          <span className="w-24 text-2xs text-slate-600 flex-shrink-0">
                            {bucket.label}
                          </span>
                          <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden">
                            <div
                              className="h-4 bg-blue-500/80 rounded"
                              style={{ width: `${width}%` }}
                            />
                          </div>
                          <span className="w-6 text-right text-2xs font-mono text-slate-700 tabular-nums">
                            {bucket.count}
                          </span>
                        </div>
                      );
                    })}

                    {operations.lengthOfStay.unparseableCount > 0 && (
                      <p className="pt-2 text-2xs text-amber-700">
                        {operations.lengthOfStay.unparseableCount} admission
                        {operations.lengthOfStay.unparseableCount === 1 ? '' : 's'} have an
                        unreadable admission date and are excluded from these figures.
                      </p>
                    )}
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title={`Discharged — Last ${operations?.lengthOfStay.dischargedWindowDays ?? 30} Days`}
                icon={<Activity className="w-4 h-4 text-emerald-700" />}
                action={
                  <span className="text-2xs text-slate-500">
                    {operations?.lengthOfStay.dischargedInWindow ?? 0} discharge
                    {(operations?.lengthOfStay.dischargedInWindow ?? 0) === 1 ? '' : 's'}
                  </span>
                }
              >
                {(operations?.lengthOfStay.dischargedInWindow ?? 0) === 0 ? (
                  <EmptyRow>
                    No discharges recorded in this window, so there is no
                    completed-stay average to compare against.
                  </EmptyRow>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-2xs uppercase tracking-wider text-slate-500 font-semibold">
                        Average stay
                      </div>
                      <div className="mt-1 text-2xl font-bold font-mono text-slate-900 tabular-nums">
                        {formatDays(operations?.lengthOfStay.averageDischargedStayDays)}
                      </div>
                    </div>
                    <div>
                      <div className="text-2xs uppercase tracking-wider text-slate-500 font-semibold">
                        Median stay
                      </div>
                      <div className="mt-1 text-2xl font-bold font-mono text-slate-900 tabular-nums">
                        {formatDays(operations?.lengthOfStay.medianDischargedStayDays)}
                      </div>
                    </div>
                  </div>
                )}
              </SectionCard>
            </div>

            <SectionCard
              title="Longest Current Stays"
              icon={<Clock className="w-4 h-4 text-amber-600" />}
            >
              {!operations || operations.longestStays.length === 0 ? (
                <EmptyRow>No patients are currently admitted.</EmptyRow>
              ) : (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-xs text-left">
                    <thead className="text-2xs text-slate-500 uppercase tracking-wider">
                      <tr>
                        <th className="py-2 font-medium">Patient</th>
                        <th className="py-2 font-medium">Ward / Bed</th>
                        <th className="py-2 font-medium">Admitted</th>
                        <th className="py-2 font-medium text-right">Days</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {operations.longestStays.map((stay) => (
                        <tr key={stay.admissionId} className="hover:bg-slate-50/70">
                          <td className="py-2.5 font-medium text-slate-900">
                            {stay.patientName}
                          </td>
                          <td className="py-2.5 text-slate-600">
                            {stay.wardName}
                            {stay.bedNumber && (
                              <span className="ml-1 font-mono text-2xs text-teal-800">
                                #{stay.bedNumber}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 font-mono text-2xs text-slate-500">
                            {stay.admissionDate.slice(0, 10)}
                          </td>
                          <td className="py-2.5 text-right">
                            <span
                              className={`font-mono tabular-nums ${
                                stay.days >= 7
                                  ? 'text-amber-700 font-semibold'
                                  : 'text-slate-700'
                              }`}
                            >
                              {stay.days}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>

          <p className="text-2xs text-slate-400 px-1">
            Revenue is counted from invoice lines with voided invoices excluded.
            Bed occupancy is the current state of the bed board, not a historical
            snapshot. Length of stay is measured in whole days from the recorded
            admission date.
            {operations?.generatedAt && (
              <> Generated {new Date(operations.generatedAt).toLocaleString()}.</>
            )}
          </p>
        </>
      )}
    </div>
  );
};

export default ReportsModule;
