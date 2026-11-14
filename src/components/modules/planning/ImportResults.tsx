import React, { useEffect, useState } from 'react';
import { planningApi, type PlanningRow } from '../../../api/clients/planning.client.ts';
import {
  importState,
  committedCounts,
  outcomeWarnings,
  type ImportBatchView,
  type ImportRow,
} from '../../../budget-planning/import-outcome.ts';
import { quiet } from './PlanningEditors.tsx';
import { DataTable } from '../../ui/layout.tsx';

export type ImportNotice = {
  batchId?: number;
  filename: string;
  destination?: string;
  year?: string | number;
  state: string;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  warnings: number;
  recordedAt: string;
  message: string;
  tone: 'success' | 'warning' | 'error' | 'info';
};
export function ImportNotification({
  notice,
  onOpen,
  onDismiss,
}: {
  notice: ImportNotice;
  onOpen: (id: number) => void;
  onDismiss: () => void;
}) {
  const colors = {
    success: 'border-green-300 bg-green-50',
    warning: 'border-amber-300 bg-amber-50',
    error: 'border-red-300 bg-red-50',
    info: 'border-blue-300 bg-blue-50',
  };
  return (
    <section
      role={notice.tone === 'error' ? 'alert' : 'status'}
      aria-label="Import outcome notification"
      className={`rounded-xl border p-4 space-y-2 text-sm ${colors[notice.tone]}`}
    >
      <h3 className="font-semibold">
        {notice.filename} — {notice.state}
      </h3>
      <p>
        Destination: {notice.destination || 'Not selected'} · Financial year:{' '}
        {notice.year || 'Not selected'}
      </p>
      <p>{notice.message}</p>
      {notice.tone === 'error' && (
        <p>
          No successful import outcome has been verified by this request. Refresh the full result
          before retrying.
        </p>
      )}
      <p>
        {notice.processed} processed · {notice.created} created · {notice.updated} updated ·{' '}
        {notice.skipped} skipped · {notice.failed} rejected/failed · {notice.warnings} warnings
      </p>
      <p>{new Date(notice.recordedAt).toLocaleString()}</p>
      {notice.batchId && (
        <button className={quiet} onClick={() => onOpen(notice.batchId!)}>
          Open full result for batch {notice.batchId}
        </button>
      )}{' '}
      <button className={quiet} onClick={onDismiss}>
        Dismiss notification
      </button>
    </section>
  );
}
export function noticeForBatch(
  b: ImportBatchView & { id?: number; filename?: string },
  state?: string,
  message?: string,
): ImportNotice {
  const counts = committedCounts(b),
    v = b.validation,
    r = b.result;
  const d = b.status === 'IMPORTED' ? (r?.destination ?? v?.destination) : v?.destination;
  const current = state ?? importState(b);
  return {
    batchId: b.id,
    filename: b.filename ?? 'Planning workbook',
    destination: d?.name,
    year: d?.financialYear,
    state: current,
    processed:
      b.status === 'IMPORTED'
        ? Number(r?.processed ?? r?.sourceRows ?? 0)
        : Number(v?.rows ?? 0) + Number(v?.errors?.length ?? 0),
    ...counts,
    failed: b.status === 'IMPORTED' ? counts.failed : Number(v?.errors?.length ?? 0),
    warnings: outcomeWarnings(b),
    recordedAt: r?.recordedAt ?? v?.recordedAt ?? b.created_at ?? new Date().toISOString(),
    message:
      message ??
      (b.status === 'IMPORTED'
        ? 'These are server-recorded operations from the committed import transaction. Skipped records were not written.'
        : 'No annual plan records have been imported. Preview and uploaded counts are not successful imports.'),
    tone:
      current === 'Failed' || current === 'Preview needs correction'
        ? 'error'
        : current === 'Partially imported' || outcomeWarnings(b) > 0 || current === 'Cancelled'
          ? 'warning'
          : b.status === 'IMPORTED' && r
            ? 'success'
            : 'info',
  };
}
export function ImportOverview({
  facilityId,
  planId,
  refresh = 0,
}: {
  facilityId: number;
  planId?: number;
  refresh?: number;
}) {
  const [loaded, setLoaded] = useState<{ key: string; data: PlanningRow } | null>(null),
    [error, setError] = useState('');
  const key = `${facilityId}:${planId ?? ''}:${refresh}`;
  useEffect(() => {
    let live = true;
    planningApi
      .get<PlanningRow>(facilityId, '/imports/summary', { planId })
      .then((data) => {
        if (live) {
          setLoaded({ key, data });
          setError('');
        }
      })
      .catch(() => {
        if (live) setError('Import indicators could not be loaded. No counts have been assumed.');
      });
    return () => {
      live = false;
    };
  }, [facilityId, planId, key]);
  const data = loaded?.key === key ? loaded.data : null;
  return (
    <section
      aria-label="Import indicators"
      className="rounded-xl border border-hair bg-surface p-4 space-y-3"
    >
      <h3 className="font-semibold">Imports needing attention</h3>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p>Loading import indicators…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['Total batches', data.total],
              ['Successful imports', data.successful],
              ['Committed imports with warnings', data.warnings],
              ['Failed / partial imports', data.failed],
              ['Awaiting confirmation', data.awaiting],
              ['Batches needing attention', data.attention],
              [
                'Active imported records in selected plan',
                data.selectedPlanRecords ?? 'Select a plan',
              ],
            ].map(([label, count]) => (
              <div key={String(label)}>
                <p className="text-xs text-muted">{label}</p>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
          <p className="text-xs">
            Facility-wide batch indicators. Selected-plan records count actual active imported
            records, not previews, skipped rows or manual entries. Counts are refreshed from the
            server.
          </p>
        </>
      )}
    </section>
  );
}
export function ImportResultsPanel({
  facilityId,
  batchId,
  canExport,
  onClose,
}: {
  facilityId: number;
  batchId: number;
  canExport: boolean;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<{ key: string; data: PlanningRow } | null>(null),
    [error, setError] = useState(''),
    [filter, setFilter] = useState('All'),
    [rowPage, setRowPage] = useState(1),
    [defaultPage, setDefaultPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const key = `${facilityId}:${batchId}`;
  useEffect(() => {
    let live = true;
    planningApi
      .get<PlanningRow>(facilityId, `/imports/${batchId}/results`)
      .then((data) => {
        if (live) {
          setLoaded({ key, data });
          setRowPage(1);
          setDefaultPage(1);
          setError('');
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [facilityId, batchId, key, refresh]);
  const result = loaded?.key === key ? loaded.data : null;
  const exportCsv = async (errorsOnly: boolean) => {
    try {
      await planningApi.importResultsFile(facilityId, batchId, errorsOnly);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export could not be downloaded.');
    }
  };
  const rows: ImportRow[] = result?.rows ?? [];
  const warning = (r: ImportRow) =>
    r.duplicateName || r.values.some((v) => v.origin === 'DEFAULTED');
  const filtered = rows.filter(
    (r) =>
      filter === 'All' ||
      (filter === 'Successful' && ['CREATED', 'UPDATED'].includes(r.outcome)) ||
      (filter === 'Warnings' && warning(r)) ||
      (filter === 'Skipped' &&
        (['SKIPPED', 'EXCLUDED'].includes(r.outcome) || r.plannedOperation === 'SKIP')) ||
      (filter === 'Failed' && ['FAILED', 'ROLLED_BACK'].includes(r.outcome)),
  );
  return (
    <section
      aria-label="Import full result"
      className="rounded-xl border border-hair bg-surface p-4 space-y-4"
    >
      <div className="flex flex-wrap gap-2">
        <h3 className="font-semibold">Full result — batch {batchId}</h3>
        <button className={quiet} onClick={() => setRefresh((n) => n + 1)}>
          Refresh result
        </button>
        <button className={quiet} onClick={onClose}>
          Close result
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!result ? (
        <p>Loading recorded result…</p>
      ) : (
        <>
          <p className="font-semibold">
            {result.batch.filename} — {result.state}
          </p>
          <p className="break-all text-xs">Original SHA256: {result.batch.sha256}</p>
          <p>
            Facility {result.destination?.facilityName ?? facilityId} ·{' '}
            {result.destination?.name ?? 'Destination not recorded'} · Plan ID{' '}
            {result.destination?.planId ?? 'Not created/selected'} · FY{' '}
            {result.destination?.financialYear ?? 'Not selected'}
          </p>
          <p>
            {result.counts.created} committed creates · {result.counts.updated} committed updates ·{' '}
            {result.counts.skipped} skipped · {result.counts.failed} failed in committed result ·{' '}
            {result.warningCountKnown === false
              ? 'Warning count not retained'
              : `${result.warningCount} warnings`}
          </p>
          <p>
            {result.notImported ?? 0} mapped records not imported (including explicit exclusions) ·{' '}
            {result.failedAttempts ?? 0} recorded failed attempts. Rejected preview rows:{' '}
            {result.batch.validation?.errors?.length ?? 0}.
          </p>
          {result.batch.status !== 'IMPORTED' && (
            <p className="font-semibold text-amber-800">
              Preview is not an import. No successful plan writes are recorded for this batch.
            </p>
          )}
          <p className="text-sm">
            {result.batch.status === 'IMPORTED' ? 'Committed' : 'Preview'} policy:{' '}
            {(result.batch.status === 'IMPORTED'
              ? result.batch.result?.policy
              : result.batch.validation?.policy) ?? 'Not recorded'}
            . ZERO_FILL turns missing/dash numeric inputs into assumed zero and missing units into
            “unit”; it does not verify the original source. Blank, dash and explicit zero remain
            distinguishable in the raw evidence.
          </p>
          <p>
            Server-recorded defaulted values:{' '}
            {result.batch.result?.defaultedCells ?? result.normalizations.length}. Retained default
            details may be incomplete for legacy batches.
          </p>
          {result.legacyDetails && (
            <p role="note">
              Legacy batch: some row-level skipped reasons or field origins were not recorded.
              Available audit evidence is shown; missing detail is not invented.
            </p>
          )}
          {result.lastFailure && (
            <p role="alert">
              {result.lastFailure.phase}: {result.lastFailure.message} ({result.lastFailure.code}).
              Refresh the outcome, correct the issue and preview again before retrying.
            </p>
          )}
          {canExport && (
            <div className="flex gap-2">
              <button className={quiet} onClick={() => void exportCsv(false)}>
                Export full results CSV
              </button>
              <button className={quiet} onClick={() => void exportCsv(true)}>
                Export errors and warnings CSV
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-2" aria-label="Result filters">
            {['All', 'Successful', 'Warnings', 'Skipped', 'Failed'].map((f) => (
              <button
                className={quiet}
                key={f}
                aria-pressed={filter === f}
                onClick={() => {
                  setFilter(f);
                  setRowPage(1);
                }}
              >
                {f}
              </button>
            ))}
          </div>
          {(filter === 'All' || filter === 'Warnings') && (
            <ul className="text-sm">
              {result.warnings.map((w: string, i: number) => (
                <li key={i}>{w} Recommended action: review the retained source and defaults.</li>
              ))}
            </ul>
          )}
          {(filter === 'All' || filter === 'Failed') &&
            (result.batch.validation?.errors ?? []).map((e: PlanningRow, i: number) => (
              <p key={i}>
                {e.sheet} row {e.row}: {e.message}. Correct the source or explicitly exclude the
                row, then preview again.
              </p>
            ))}
          <p>
            {filtered.length} of {rows.length} recorded row results. Successful filter includes only
            committed creates and updates.
          </p>
          <div className="flex gap-2 text-xs">
            <button
              className={quiet}
              disabled={rowPage === 1}
              onClick={() => setRowPage((p) => p - 1)}
            >
              Previous result rows
            </button>
            <span>
              Result page {rowPage} of {Math.max(1, Math.ceil(filtered.length / 100))}
            </span>
            <button
              className={quiet}
              disabled={rowPage * 100 >= filtered.length}
              onClick={() => setRowPage((p) => p + 1)}
            >
              Next result rows
            </button>
          </div>
          <div className="max-h-[36rem] overflow-auto">
            <DataTable className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th>Source / record</th>
                  <th>Operation</th>
                  <th>Details and corrective action</th>
                  <th>Value provenance</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice((rowPage - 1) * 100, rowPage * 100).map((r, i) => (
                  <tr key={`${r.sheet}:${r.row}:${i}`}>
                    <td>
                      {r.sheet} row {r.row}
                      <br />
                      {r.kind} · {r.recordId ? `record ${r.recordId}` : 'No committed record ID'}
                      <br />
                      <p>{r.description}</p>
                      <p>{r.category}</p>
                    </td>
                    <td>
                      {r.outcome}
                      {r.plannedOperation && <p>Planned only: {r.plannedOperation}</p>}
                    </td>
                    <td>
                      {r.message}
                      <p>{r.correctiveAction}</p>
                      {r.duplicateName && (
                        <strong>Duplicate name — distinct source row preserved.</strong>
                      )}
                    </td>
                    <td>
                      {r.outcome === 'SKIPPED' && (
                        <p>
                          Reviewed source values were not written; the matching record was
                          preserved.
                        </p>
                      )}
                      <details>
                        <summary>{r.values.length} field values</summary>
                        {r.values.map((v, n) => (
                          <p key={n}>
                            {v.field} {v.column ? `(${v.column})` : ''}: raw {JSON.stringify(v.raw)}{' '}
                            → {JSON.stringify(v.value)} · {v.origin} {v.reason}
                          </p>
                        ))}
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
          <details>
            <summary>
              {result.normalizations.length} retained default entries — original evidence
            </summary>
            <div className="flex gap-2 text-xs">
              <button
                className={quiet}
                disabled={defaultPage === 1}
                onClick={() => setDefaultPage((p) => p - 1)}
              >
                Previous default entries
              </button>
              <span>
                Defaults page {defaultPage} of{' '}
                {Math.max(1, Math.ceil(result.normalizations.length / 100))}
              </span>
              <button
                className={quiet}
                disabled={defaultPage * 100 >= result.normalizations.length}
                onClick={() => setDefaultPage((p) => p + 1)}
              >
                Next default entries
              </button>
            </div>
            <ul className="text-xs">
              {result.normalizations
                .slice((defaultPage - 1) * 100, defaultPage * 100)
                .map((v: PlanningRow, n: number) => (
                  <li key={n}>
                    {v.sheet} row {v.row}, {v.column}: {JSON.stringify(v.raw)} → {v.value} (
                    {v.reason}
                    ). Review this assumption against source evidence.
                  </li>
                ))}
            </ul>
          </details>
          <h4 className="font-semibold">
            Lifecycle: upload → preview → confirmation → import result
          </h4>
          <p className="text-xs">
            Events are retained as recorded, including cancellation and failed attempts. Missing
            stages are not inferred. Confirmation/result are in the same atomic transaction.
          </p>
          <ol className="text-sm">
            <li>
              Uploaded: {new Date(result.batch.created_at).toLocaleString()} · user ID{' '}
              {result.batch.uploaded_by}
            </li>
            {result.lifecycle.map((e: PlanningRow) => (
              <li key={e.id}>
                {e.action} · {new Date(e.recordedAt).toLocaleString()} · {e.actorName ?? 'User'} (ID{' '}
                {e.actorId}) {e.detail?.message}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
