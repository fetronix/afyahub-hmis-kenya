/**
 * Branding & Documents — the facility's own letterhead, managed by the facility.
 *
 * WHAT AN ADMINISTRATOR CAN DO HERE
 * ---------------------------------
 * Upload a PDF letterhead, preview it before anyone sees it on a document,
 * activate it, replace it with a new version, withdraw the active version, look
 * at every earlier version, and see who uploaded and who activated each one.
 *
 * WHY IT IS SHAPED THIS WAY
 * -------------------------
 * - **Nothing activates on upload.** A letterhead becomes the background of
 *   every invoice and report, so it arrives as a DRAFT and stays one until
 *   somebody presses Activate. The preview shows the stored bytes, not the
 *   browser's rendering of the chosen file, so what is approved is what is
 *   stored.
 * - **History is not tidyable.** There is no delete. A replaced version is
 *   still what an already-issued document was printed on, and the list keeps it
 *   visible with its retirement reason.
 * - **The content area is shown, not guessed.** The server measures the
 *   printable rectangle from the artwork; the screen displays the numbers and
 *   lets an administrator correct them while the version is still a draft. Once
 *   activated they are frozen, because documents have already been laid out
 *   against them.
 * - **The file is fetched, never linked.** The download endpoint requires a
 *   session, so it is requested with the bearer token and shown from an object
 *   URL; an `<a href>` would return 401.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, History, RefreshCw, ShieldCheck, Upload } from 'lucide-react';

import { brandingClient, openBlob } from '../../api/clients/branding.client.ts';
import type { LetterheadEvent, LetterheadVersion } from '../../api/clients/branding.client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { AlertBanner, EmptyState, LoadingSkeleton, StatusBadge } from '../ui/feedback.tsx';
import { DataTable } from '../ui/layout.tsx';
import { PrimaryButton, SecondaryButton } from '../ui/controls.tsx';

const statusTone = (status: string) =>
  status === 'ACTIVE'
    ? ('success' as const)
    : status === 'DRAFT'
      ? ('info' as const)
      : status === 'SUPERSEDED'
        ? ('neutral' as const)
        : ('warning' as const);

function when(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function kb(bytes: number | null): string {
  if (!bytes) return '—';
  return `${Math.round(bytes / 1024)} KB`;
}

export function BrandingDocumentsPanel({
  facilityId,
  canManage,
}: {
  facilityId: number;
  canManage: boolean;
}) {
  const { showToast } = useHmis();
  const [versions, setVersions] = useState<LetterheadVersion[]>([]);
  const [events, setEvents] = useState<LetterheadEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [withdrawTarget, setWithdrawTarget] = useState<number | null>(null);
  const [layoutDraft, setLayoutDraft] = useState<Record<string, string>>({});
  const [layoutTarget, setLayoutTarget] = useState<number | null>(null);
  const previewUrl = useRef<string | null>(null);

  const active = useMemo(
    () => versions.find((version) => version.status === 'ACTIVE') ?? null,
    [versions],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const state = await brandingClient.list(facilityId);
      setVersions(state.versions ?? []);
      setEvents(state.events ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'The letterhead history could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void load();
    return () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, [load]);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const result = await brandingClient.upload(facilityId, file);
      showToast(
        `Uploaded as draft version ${result.letterhead.version}. Preview it, then activate it.`,
        { tone: 'success' },
      );
      setFile(null);
      await load();
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : 'The letterhead was not accepted.';
      setError(message);
      showToast(message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const activate = async (id: number) => {
    setBusy(true);
    setError('');
    try {
      await brandingClient.activate(facilityId, id, 'Activated in Facility Settings');
      showToast('Letterhead activated. New documents will use it.', { tone: 'success' });
      await load();
    } catch (activateError) {
      const message =
        activateError instanceof Error
          ? activateError.message
          : 'The letterhead was not activated.';
      setError(message);
      showToast(message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (withdrawTarget === null) return;
    setBusy(true);
    setError('');
    try {
      await brandingClient.withdraw(facilityId, withdrawTarget, withdrawReason);
      showToast(
        'Letterhead withdrawn. Documents fall back to plain A4 until another is activated.',
        {
          tone: 'warning',
        },
      );
      setWithdrawTarget(null);
      setWithdrawReason('');
      await load();
    } catch (withdrawError) {
      const message =
        withdrawError instanceof Error
          ? withdrawError.message
          : 'The letterhead was not withdrawn.';
      setError(message);
      showToast(message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const previewDocument = async (id: number) => {
    setError('');
    try {
      const blob = await brandingClient.previewDocument(facilityId, id);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = URL.createObjectURL(blob);
      window.open(previewUrl.current, '_blank', 'noopener,noreferrer');
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : 'The document preview could not be generated.',
      );
    }
  };

  const preview = async (id: number) => {
    setError('');
    try {
      const blob = await brandingClient.preview(facilityId, id);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = URL.createObjectURL(blob);
      window.open(previewUrl.current, '_blank', 'noopener,noreferrer');
    } catch (previewError) {
      setError(
        previewError instanceof Error ? previewError.message : 'The file could not be previewed.',
      );
    }
  };

  const saveLayout = async (id: number) => {
    setBusy(true);
    setError('');
    try {
      const patch: Record<string, number> = {};
      for (const key of ['bodyTopPt', 'bodyBottomPt', 'bodyLeftPt', 'bodyRightPt']) {
        const value = layoutDraft[key];
        if (value === undefined || value === '') continue;
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`${key} must be a non-negative number of points.`);
        }
        patch[key] = parsed;
      }
      await brandingClient.adjust(facilityId, id, patch);
      showToast('Content area updated for this draft.', { tone: 'success' });
      setLayoutTarget(null);
      setLayoutDraft({});
      await load();
    } catch (layoutError) {
      const message =
        layoutError instanceof Error ? layoutError.message : 'The content area was not saved.';
      setError(message);
      showToast(message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingSkeleton rows={4} />;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Facility letterhead</h2>
            <p className="text-xs text-slate-500 mt-1">
              Your own stationery is printed underneath invoices, receipts, credit notes, purchase
              orders, goods received notes, laboratory and imaging reports, and discharge summaries.
              Each facility has its own; nothing is shared between facilities.
            </p>
          </div>
          <div className="text-right">
            {active ? (
              <StatusBadge tone="success">Active: version {active.version}</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">No active letterhead</StatusBadge>
            )}
            {active && (
              <p className="text-[11px] text-slate-500 mt-1">
                Activated {when(active.activatedAt)}
              </p>
            )}
          </div>
        </div>

        {error && <AlertBanner tone="error">{error}</AlertBanner>}

        {canManage ? (
          <div className="border border-dashed border-slate-300 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <Upload className="w-4 h-4" /> Upload a new version
            </div>
            <p className="text-[11px] text-slate-500">
              A4 portrait PDF, up to 8&nbsp;MB. The file is stored exactly as uploaded and becomes
              an inactive draft — preview it, correct the content area if needed, then activate it.
              Versions are never deleted, because an already-printed document must always be
              reproducible.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                accept="application/pdf,.pdf"
                aria-label="Letterhead PDF"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="text-xs text-slate-700"
              />
              <PrimaryButton onClick={upload} disabled={!file || busy}>
                {busy ? 'Uploading…' : 'Upload draft'}
              </PrimaryButton>
            </div>
          </div>
        ) : (
          <AlertBanner tone="info">
            You can see which letterhead is active. Replacing stationery needs the facility-branding
            manage permission.
          </AlertBanner>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <FileText className="w-4 h-4" /> Versions
          </h2>
          <SecondaryButton onClick={() => void load()} disabled={busy}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </SecondaryButton>
        </div>

        {versions.length === 0 ? (
          <EmptyState
            title="No letterhead yet"
            description="Documents print on plain A4 until a letterhead is uploaded and activated."
          />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Uploaded</th>
                <th>Activated</th>
                <th>Content area (pt)</th>
                <th>File</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.id}>
                  <td className="font-medium">v{version.version}</td>
                  <td>
                    <StatusBadge tone={statusTone(version.status)}>{version.status}</StatusBadge>
                    {version.retireReason && (
                      <p className="text-[11px] text-slate-500 mt-1">{version.retireReason}</p>
                    )}
                  </td>
                  <td className="text-xs">
                    User #{version.uploadedByUserId}
                    <br />
                    <span className="text-slate-500">{when(version.uploadedAt)}</span>
                  </td>
                  <td className="text-xs">
                    {version.activatedByUserId ? `User #${version.activatedByUserId}` : '—'}
                    <br />
                    <span className="text-slate-500">{when(version.activatedAt)}</span>
                  </td>
                  <td className="text-xs">
                    {version.bodyTopPt === null
                      ? '—'
                      : `top ${version.bodyTopPt} · bottom ${version.bodyBottomPt} · left ${version.bodyLeftPt} · right ${version.bodyRightPt}`}
                    {version.layoutSource && (
                      <p className="text-[11px] text-slate-500 mt-1">{version.layoutSource}</p>
                    )}
                  </td>
                  <td className="text-xs">
                    {version.hasPdf
                      ? `${kb(version.sourcePdfBytes)} · ${version.sourcePdfPages}p`
                      : '—'}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {version.hasPdf && (
                        <SecondaryButton onClick={() => void preview(version.id)}>
                          Preview file
                        </SecondaryButton>
                      )}
                      {version.hasPdf && (
                        <SecondaryButton onClick={() => void previewDocument(version.id)}>
                          Preview on a document
                        </SecondaryButton>
                      )}
                      {canManage && version.status === 'DRAFT' && (
                        <>
                          <PrimaryButton onClick={() => void activate(version.id)} disabled={busy}>
                            Activate
                          </PrimaryButton>
                          <SecondaryButton
                            onClick={() => {
                              setLayoutTarget(version.id === layoutTarget ? null : version.id);
                              setLayoutDraft({
                                bodyTopPt: String(version.bodyTopPt ?? ''),
                                bodyBottomPt: String(version.bodyBottomPt ?? ''),
                                bodyLeftPt: String(version.bodyLeftPt ?? ''),
                                bodyRightPt: String(version.bodyRightPt ?? ''),
                              });
                            }}
                          >
                            Adjust area
                          </SecondaryButton>
                        </>
                      )}
                      {canManage && (version.status === 'DRAFT' || version.status === 'ACTIVE') && (
                        <SecondaryButton
                          onClick={() => {
                            setWithdrawTarget(version.id);
                            setWithdrawReason('');
                          }}
                        >
                          {version.status === 'ACTIVE' ? 'Deactivate' : 'Discard draft'}
                        </SecondaryButton>
                      )}
                    </div>

                    {layoutTarget === version.id && (
                      <div className="mt-2 grid grid-cols-2 gap-1.5">
                        {(['bodyTopPt', 'bodyBottomPt', 'bodyLeftPt', 'bodyRightPt'] as const).map(
                          (key) => (
                            <label key={key} className="text-[11px] text-slate-600">
                              {key}
                              <input
                                type="number"
                                min={0}
                                step="0.5"
                                value={layoutDraft[key] ?? ''}
                                onChange={(event) =>
                                  setLayoutDraft((draft) => ({
                                    ...draft,
                                    [key]: event.target.value,
                                  }))
                                }
                                className="mt-0.5 w-full border border-slate-300 rounded px-1.5 py-1 text-xs"
                              />
                            </label>
                          ),
                        )}
                        <div className="col-span-2">
                          <PrimaryButton
                            onClick={() => void saveLayout(version.id)}
                            disabled={busy}
                          >
                            Save content area
                          </PrimaryButton>
                        </div>
                      </div>
                    )}

                    {withdrawTarget === version.id && (
                      <div className="mt-2 space-y-1.5">
                        <input
                          type="text"
                          value={withdrawReason}
                          aria-label="Reason for withdrawing the letterhead"
                          placeholder="Reason (at least 3 characters)"
                          onChange={(event) => setWithdrawReason(event.target.value)}
                          className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                        />
                        <div className="flex gap-1.5">
                          <PrimaryButton onClick={() => void withdraw()} disabled={busy}>
                            Confirm
                          </PrimaryButton>
                          <SecondaryButton onClick={() => setWithdrawTarget(null)}>
                            Cancel
                          </SecondaryButton>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <History className="w-4 h-4" /> History
        </h2>
        {events.length === 0 ? (
          <p className="text-xs text-slate-500">No letterhead activity recorded yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {events.map((event) => (
              <li key={event.id} className="text-xs text-slate-700 flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-medium">{event.action}</span>
                <span>v{event.version}</span>
                <span className="text-slate-500">by user #{event.actorUserId}</span>
                <span className="text-slate-500">{when(event.createdAt)}</span>
                {event.reason && <span className="text-slate-500">· {event.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Re-exported for callers that only need the download helper. */
export { openBlob };
