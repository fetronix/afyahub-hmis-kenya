import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import type {
  FacilityTariffHistoryPage,
  FacilityTariffHistorySnapshot,
} from '../../api/clients/billing.client.ts';

function snapshotText(snapshot: FacilityTariffHistorySnapshot | null): string {
  if (!snapshot) return 'Not recorded';
  const parts: string[] = [];
  if (snapshot.fee !== undefined) parts.push(`KES ${snapshot.fee}`);
  if ('effectiveFrom' in snapshot) parts.push(`from ${snapshot.effectiveFrom ?? 'not set'}`);
  if ('effectiveTo' in snapshot) parts.push(`to ${snapshot.effectiveTo ?? 'not set'}`);
  if (snapshot.isActive !== undefined) parts.push(snapshot.isActive ? 'active' : 'inactive');
  if (snapshot.autoBill !== undefined)
    parts.push(snapshot.autoBill ? 'auto-billing on' : 'auto-billing off');
  if (snapshot.revision !== undefined) parts.push(`revision ${snapshot.revision}`);
  return parts.length ? parts.join(' · ') : 'Price and dates not recorded';
}

/** Read-only facility tariff audit events; no master catalogue or repricing. */
export const FacilityTariffHistory: React.FC<{
  facilityId: number;
  tariffId: number;
  tariffCode: string;
  onClose: () => void;
}> = ({ facilityId, tariffId, tariffCode, onClose }) => {
  const [cursors, setCursors] = useState<Array<number | undefined>>([undefined]);
  const [index, setIndex] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    key: string;
    page?: FacilityTariffHistoryPage;
    error?: boolean;
  } | null>(null);
  const beforeId = cursors[index];
  const key = JSON.stringify([facilityId, tariffId, beforeId ?? null, retry]);
  const current = state?.key === key ? state : null;
  useEffect(() => {
    let active = true;
    api
      .getFacilityTariffHistory(facilityId, tariffId, beforeId)
      .then((page) => {
        if (!active) return;
        if (
          !Array.isArray(page.events) ||
          (page.nextCursor !== null &&
            (!Number.isSafeInteger(page.nextCursor) || page.nextCursor <= 0))
        ) {
          setState({ key, error: true });
          return;
        }
        setState({ key, page });
      })
      .catch(() => {
        if (active) setState({ key, error: true });
      });
    return () => {
      active = false;
    };
  }, [facilityId, tariffId, beforeId, key]);
  const page = current?.page;
  return (
    <section
      aria-label={`Price history for ${tariffCode}`}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold text-slate-900">Facility tariff audit: {tariffCode}</h3>
        <button type="button" onClick={onClose} className="rounded border px-3 py-1 text-xs">
          Close history
        </button>
      </div>
      <p className="text-xs text-slate-600">
        Only recorded audit events are shown; missing history is not proof of no changes. Times are
        recorded database wall times with no timezone. Existing invoice prices are not changed.
      </p>
      {!current ? (
        <p role="status">Loading tariff history…</p>
      ) : current.error ? (
        <div role="alert" className="text-rose-700">
          Tariff history could not be loaded.{' '}
          <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>
            Retry history
          </button>
        </div>
      ) : page?.events.length === 0 ? (
        <p>No recorded events were found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table
            aria-label="Recorded facility tariff events"
            className="w-full min-w-[700px] text-left text-xs"
          >
            <thead>
              <tr>
                <th scope="col">Recorded time</th>
                <th scope="col">Action</th>
                <th scope="col">Staff ID</th>
                <th scope="col">Before</th>
                <th scope="col">After</th>
              </tr>
            </thead>
            <tbody>
              {page?.events.map((event) => (
                <tr key={event.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-2">{event.recordedTime}</td>
                  <td className="pr-2">{event.action}</td>
                  <td className="pr-2">
                    {event.actorKind === 'SYSTEM'
                      ? 'System'
                      : (event.actorUserId ?? 'Not recorded')}
                  </td>
                  <td className="pr-2">{snapshotText(event.before)}</td>
                  <td>{snapshotText(event.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav
        aria-label="Tariff history pages"
        className="flex items-center justify-between gap-3 text-xs"
      >
        <button
          type="button"
          disabled={!page || index === 0}
          onClick={() => setIndex((n) => n - 1)}
          className="rounded border px-3 py-1 disabled:opacity-50"
        >
          Previous history page
        </button>
        <span>Page {index + 1}</span>
        <button
          type="button"
          disabled={!page || page.nextCursor === null}
          onClick={() => {
            if (!page || page.nextCursor === null) return;
            setCursors([...cursors.slice(0, index + 1), page.nextCursor]);
            setIndex(index + 1);
          }}
          className="rounded border px-3 py-1 disabled:opacity-50"
        >
          Next history page
        </button>
      </nav>
    </section>
  );
};
