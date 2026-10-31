import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import type { BillingChargeAttemptList } from '../../types/index.ts';

/** Clinical care continues when a price is missing. Keep the existing
 * durable retry queue accessible without the retired catalogue/matching UI. */
export const FacilityBillingReview: React.FC<{ facilityId: number; canManage: boolean }> = ({
  facilityId,
  canManage,
}) => {
  const [rows, setRows] = useState<BillingChargeAttemptList | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<number | 'all' | null>(null);
  const load = useCallback(async () => {
    try {
      const result = await api.getChargeAttempts(facilityId, 'PENDING');
      setRows(result);
    } catch {
      setRows(null);
      setNotice('Charges awaiting billing could not be loaded. Do not assume there are none.');
    }
  }, [facilityId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function retry(id: number | 'all') {
    if (!canManage || busy !== null) return;
    setBusy(id);
    setNotice('');
    try {
      if (id === 'all') {
        const result = await api.retryChargeAttempts(facilityId);
        setNotice(
          `${result.tried} reviewed; ${result.billed} billed; ${result.duplicates} already billed; ${result.stillPending} still pending; ${result.skipped} skipped.`,
        );
      } else {
        const result = await api.retryChargeAttempt(id, facilityId);
        setNotice(
          result.status === 'BILLED'
            ? 'Charge added to the invoice.'
            : (result.result.message ?? `Charge status: ${result.status}.`),
        );
      }
      await load();
    } catch {
      setNotice(
        'The retry could not be confirmed. Review the invoice and retry status before trying again.',
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <section
      className="rounded border bg-white p-4"
      aria-label="Charges awaiting billing or pricing review"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold">Charges awaiting billing or pricing review</h3>
          <p className="text-slate-600">
            Review the clinical source and invoice before retrying. This list does not establish
            payment status.
          </p>
        </div>
        <button
          type="button"
          className="rounded bg-teal-700 px-3 py-2 text-white disabled:opacity-50"
          disabled={!canManage || busy !== null || !rows?.pending}
          onClick={() => void retry('all')}
        >
          Retry all
        </button>
      </div>
      {notice && (
        <p role="status" className="my-2 text-amber-800">
          {notice}
        </p>
      )}
      {rows && rows.attempts.length === 0 && (
        <p className="mt-2 text-slate-600">
          No pending charge attempts returned. This does not prove every clinical event was billed.
        </p>
      )}
      {rows &&
        rows.attempts.map((attempt) => (
          <div
            key={attempt.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t py-2"
          >
            <div>
              <b>{attempt.description ?? attempt.itemType}</b> · patient #{attempt.patientId} ·{' '}
              {attempt.sourceType} #{attempt.sourceId ?? 'unavailable'}
              <p>{attempt.detail ?? attempt.reason}</p>
            </div>
            <button
              type="button"
              disabled={!canManage || busy !== null}
              onClick={() => void retry(attempt.id)}
            >
              Retry
            </button>
          </div>
        ))}
    </section>
  );
};
