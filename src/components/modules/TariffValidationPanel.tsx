import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import type { FacilityTariffValidation } from '../../types/index.ts';

/** Read-only, facility-specific configuration assessment; not price approval. */
export function TariffValidationPanel({ facilityId }: { facilityId: number }) {
  const [report, setReport] = useState<FacilityTariffValidation | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState(0);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    setBusy(true);
    setError('');
    setReport(null);
    api
      .getFacilityTariffValidation(facilityId, offset)
      .then((result) => {
        if (!cancelled) setReport(result);
      })
      .catch(() => {
        if (!cancelled)
          setError('Tariff validation could not be loaded. No configuration result is available.');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [facilityId, offset, request, started]);
  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4 text-xs"
      aria-label="Tariff configuration validation"
    >
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-semibold text-sm">Tariff configuration validation</h3>
        <button
          type="button"
          className="rounded border px-3 py-1"
          disabled={busy}
          onClick={() => {
            setOffset(0);
            setStarted(true);
            setRequest((n) => n + 1);
          }}
        >
          {started ? 'Refresh validation' : 'Validate configured tariffs'}
        </button>
      </div>
      <p className="mt-2 text-slate-600">
        Checks the current facility's configured catalogue, links and tariff rows. A resolver match
        is not approval of a price or clinical service.
      </p>
      {busy && <p role="status">Checking configuration...</p>}
      {error && (
        <p role="alert" className="mt-2 text-rose-800">
          {error}{' '}
          <button type="button" className="underline" onClick={() => setRequest((n) => n + 1)}>
            Retry
          </button>
        </p>
      )}
      {report && report.facilityId === facilityId && (
        <div className="mt-3 space-y-2">
          <p>
            As of {report.asOfDate}: {report.summary.examined} checks, {report.summary.review} for
            review, {report.summary.invalid} invalid and {report.summary.manualOnly} manual-only.
          </p>
          <ul className="list-disc pl-4 text-slate-600">
            {report.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Service or tariff</th>
                  <th>Result</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {report.checks.map((check) => (
                  <tr key={check.key} className="border-t">
                    <td>{check.kind.replaceAll('_', ' ')}</td>
                    <td>
                      {check.name}
                      {check.code ? ` (${check.code})` : ''}
                    </td>
                    <td>{check.result}</td>
                    <td>
                      {check.tariffCode ? `Tariff ${check.tariffCode}. ` : ''}
                      {check.reasons.join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="underline disabled:opacity-50"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              Previous
            </button>
            <button
              type="button"
              className="underline disabled:opacity-50"
              disabled={report.nextOffset === null}
              onClick={() => setOffset(report.nextOffset!)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
