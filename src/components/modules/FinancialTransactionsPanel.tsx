import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { isFacilityFinancialPermission } from '../../auth/permission-boundaries.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { addCalendarDays } from '../../dashboard/date-range.ts';
import { calendarDateInZone, validTimezone } from '../../dashboard/timezone.ts';
import type { FinancialTransactionsReport } from '../../types/index.ts';

function kes(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return 'Unavailable';
  const grouped = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `KES ${match[1]}${grouped}.${(match[3] ?? '').padEnd(2, '0')}`;
}

/** Date-based recorded activity; never presents an internal row as external confirmation. */
export const FinancialTransactionsPanel: React.FC<{ days: number | null }> = ({ days }) => {
  const { currentFacility, currentTenant, authenticatedUser, refreshKey } = useHmis();
  const permissions = new Set(authenticatedUser?.permissions ?? []);
  const superAdmin =
    authenticatedUser?.isSuperAdmin === true ||
    (authenticatedUser?.roles ?? []).includes('SUPER_ADMIN');
  const canRead = ['reports.read', 'billing.read'].every(
    (permission) =>
      permissions.has(permission) && !(superAdmin && isFacilityFinancialPermission(permission)),
  );
  const zone = currentFacility?.timezone ?? currentTenant?.timezone;
  const today = validTimezone(zone) ? calendarDateInZone(zone) : null;
  const from = today && days !== null ? addCalendarDays(today, -Math.max(0, days - 1)) : null;
  const to = days !== null ? today : null;
  const [offset, setOffset] = useState(0);
  const [report, setReport] = useState<FinancialTransactionsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setReport(null);
    setError(null);
    if (!canRead || !currentFacility?.id || !from || !to) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    api.getFinancialTransactionsReport(currentFacility.id, { from, to }, offset).then(
      (value) => {
        if (active) {
          setReport(value);
          setLoading(false);
        }
      },
      (reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Financial report unavailable.');
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [canRead, currentFacility?.id, from, to, offset, refreshKey]);

  if (!canRead) return null;
  return (
    <section
      className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm"
      aria-label="Recorded financial activity"
    >
      <div>
        <h2 className="text-xs font-bold text-slate-900 uppercase">Recorded financial activity</h2>
        <p className="mt-1 text-xs text-slate-600">
          Receipts and manual refunds are selected by their own transaction dates, not invoice
          dates.
        </p>
      </div>
      {days === null ? (
        <p className="text-xs text-slate-600">
          Select a period of up to 90 days to view transaction activity.
        </p>
      ) : !today ? (
        <p role="alert" className="text-xs text-amber-800">
          A valid facility or tenant timezone is required; dates cannot be inferred.
        </p>
      ) : loading ? (
        <p className="text-xs text-slate-500">Loading recorded activity…</p>
      ) : error ? (
        <p role="alert" className="text-xs text-amber-800">
          Financial activity unavailable: {error}
        </p>
      ) : report ? (
        <>
          <p className="text-xs text-slate-600">
            {report.from} to {report.to} · {report.timezone}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <div className="text-2xs text-slate-500 uppercase">Gross recorded receipts</div>
              <strong>{kes(report.totals.grossReceipts)}</strong>
              <div className="text-2xs">{report.totals.receiptCount} receipts</div>
            </div>
            <div>
              <div className="text-2xs text-slate-500 uppercase">Manual refunds recorded</div>
              <strong>{kes(report.totals.manualRefunds)}</strong>
              <div className="text-2xs">{report.totals.refundCount} refunds</div>
            </div>
            <div>
              <div className="text-2xs text-slate-500 uppercase">Net recorded activity</div>
              <strong>{kes(report.totals.netRecorded)}</strong>
              <div className="text-2xs">Receipts less manual refunds</div>
            </div>
          </div>
          <div className="text-xs text-slate-600 space-y-1">
            <p>
              Receipt methods:{' '}
              {report.receipts.length
                ? report.receipts
                    .map((r) => `${r.method}: ${kes(r.amount)} (${r.count})`)
                    .join(' · ')
                : 'None recorded'}
            </p>
            <p>
              Refund methods:{' '}
              {report.refunds.length
                ? report.refunds
                    .map((r) => `${r.method}: ${kes(r.amount)} (${r.count})`)
                    .join(' · ')
                : 'None recorded'}
            </p>
            <p>
              Current outstanding for invoices created in this window:{' '}
              {kes(report.invoiceCohort.currentOutstanding)} (not an historical as-of balance).
            </p>
            <p>
              Linked, invoiced bed nights by rate source:{' '}
              {report.bedCharges.length
                ? report.bedCharges
                    .map((r) => `${r.source}: ${kes(r.amount)} (${r.count})`)
                    .join(' · ')
                : 'None recorded'}
            </p>
            <p>
              Billed lines by recorded department and source:{' '}
              {report.departments.length
                ? report.departments
                    .map((r) => `${r.department} / ${r.source}: ${kes(r.amount)} (${r.count})`)
                    .join(' · ')
                : 'None recorded'}
            </p>
          </div>
          {report.excludedScopeConflicts > 0 && (
            <p role="alert" className="text-xs text-rose-700">
              {report.excludedScopeConflicts} refund records have conflicting facility or tenant
              links and were excluded; investigate before reconciliation.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b text-slate-500">
                  <th className="py-2 pr-3">Local date</th>
                  <th className="pr-3">Record</th>
                  <th className="pr-3">Receipt / refund</th>
                  <th className="pr-3">Invoice</th>
                  <th className="pr-3">Method</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {report.transactions.rows.map((row) => (
                  <tr key={`${row.kind}-${row.id}`} className="border-b border-slate-100">
                    <td className="py-2 pr-3">{row.localDate}</td>
                    <td className="pr-3">{row.kind === 'RECEIPT' ? 'Receipt' : 'Manual refund'}</td>
                    <td className="pr-3">{row.reference}</td>
                    <td className="pr-3">{row.invoiceNumber}</td>
                    <td className="pr-3">{row.method || 'Unspecified'}</td>
                    <td>{kes(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.transactions.rows.length === 0 && (
              <p className="py-3 text-xs text-slate-500">
                No receipts or manual refunds recorded in this period.
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - report.transactions.pageSize))}
              className="underline disabled:opacity-40"
            >
              Previous
            </button>
            <span>
              Records {offset + (report.transactions.rows.length ? 1 : 0)}–
              {offset + report.transactions.rows.length}
            </span>
            <button
              type="button"
              disabled={!report.transactions.hasMore}
              onClick={() => setOffset(offset + report.transactions.pageSize)}
              className="underline disabled:opacity-40"
            >
              Next
            </button>
          </div>
          <ul className="list-disc pl-4 text-2xs text-slate-500">
            {report.limitations.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-xs text-slate-500">Financial activity unavailable.</p>
      )}
    </section>
  );
};
