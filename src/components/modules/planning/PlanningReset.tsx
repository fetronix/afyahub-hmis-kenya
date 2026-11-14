import React, { useEffect, useState } from 'react';
import { planningApi } from '../../../api/clients/planning.client.ts';
import type {
  ResetInventory,
  ResetSelection,
  ResetPreview,
  ResetReceipt,
  ResetCounts,
} from '../../../budget-planning/reset-contract.ts';
import { button, quiet, field } from './PlanningEditors.tsx';

function Counts({ counts }: { counts: ResetCounts }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-3">
      {Object.entries(counts).map(([name, value]) => (
        <div key={name}>
          <dt className="capitalize">
            {name === 'months'
              ? 'Associated monthly projections'
              : name === 'manual'
                ? 'No import provenance (manual)'
                : name}
          </dt>
          <dd className="font-bold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function PlanningReset({
  facilityId,
  onReset,
}: {
  facilityId: number;
  onReset: () => void;
}) {
  const [inventory, setInventory] = useState<ResetInventory | null>(null);
  const [selection, setSelection] = useState<ResetSelection>({
    planIds: [],
    stationery: false,
    branding: false,
    uniforms: false,
    deleteEmptyPlans: false,
    provenance: 'ALL',
  });
  const [reason, setReason] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const [preview, setPreview] = useState<ResetPreview | null>(null),
    [receipt, setReceipt] = useState<ResetReceipt | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    planningApi
      .get<ResetInventory>(facilityId, '/reset')
      .then((r) => {
        if (live) setInventory(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [facilityId, refresh]);
  const invalidate = () => {
    setPreview(null);
    setConfirmation('');
    setReceipt(null);
    setError('');
  };
  const change = (next: ResetSelection) => {
    invalidate();
    setSelection(next);
  };
  const requestPreview = async () => {
    setBusy(true);
    invalidate();
    try {
      setPreview(
        await planningApi.send<ResetPreview>(facilityId, '/reset/preview', { selection, reason }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed.');
    } finally {
      setBusy(false);
    }
  };
  const execute = async () => {
    if (!preview || confirmation !== 'RESET PLANNING DATA' || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await planningApi.send<ResetReceipt>(facilityId, '/reset/execute', {
        token: preview.token,
        confirmation,
      });
      setReceipt(result);
      setPreview(null);
      setConfirmation('');
      setSelection({ ...selection, planIds: [] });
      setInventory(null);
      setRefresh((n) => n + 1);
      onReset();
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : 'Reset outcome is unverified.'} Refresh and check audit history before any retry.`,
      );
      setPreview(null);
      setConfirmation('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Reset Planning Data"
      className="space-y-4 rounded-xl border border-red-300 bg-surface p-4"
    >
      <h4 className="text-lg font-semibold">Reset Planning Data</h4>
      <p className="text-sm">
        Destructive, draft-only operation for an authorized facility administrator. There is no
        automatic undo; retain an authorized backup before clearing data. Nothing is reset on page
        load or selection. Importing a file is optional; manual entry remains available.
      </p>
      <p className="text-sm">
        Always preserved: import batches and source files, audit logs, issued reports, letterheads,
        facility settings, approved/reviewed/archived plans and all non-planning data.
      </p>
      {error && <p role="alert">{error}</p>}
      {receipt && (
        <section
          role="status"
          aria-label="Committed reset receipt"
          className="space-y-2 border p-3"
        >
          <h5 className="font-bold">Planning reset committed</h5>
          <p>
            Facility #{receipt.facilityId} · administrator #{receipt.actorId} ·{' '}
            {receipt.committedAt} · audit event #{receipt.eventId}
          </p>
          <p>
            Actual committed removal counts (imported/manual counts are provenance subsets, not
            additional deletions):
          </p>
          <Counts counts={receipt.counts} />
          <p>
            Only the selected data was cleared. Open Stationery, Branding or Staff Uniform
            Projections to see refreshed tables and totals. Use Add First Item to start manually, or
            New annual plan if needed.
          </p>
        </section>
      )}
      {!inventory ? (
        error ? (
          <p>Current counts are unavailable. Refresh before reviewing any reset.</p>
        ) : (
          <p role="status">Loading current facility planning counts…</p>
        )
      ) : (
        <>
          <p className="font-semibold">
            Authenticated facility: {inventory.facility.name} (#{inventory.facility.id})
          </p>
          <p className="text-xs">
            Counts include active and previously soft-removed rows. Imported = recorded import
            provenance; manual = no import provenance recorded (not proof of original source for
            legacy rows).
          </p>
          <fieldset disabled={busy} className="space-y-3">
            <legend className="font-semibold">Select draft annual plans</legend>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-left text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_th]:py-2">
                <thead>
                  <tr>
                    {[
                      'Select / plan',
                      'Status',
                      'Stationery',
                      'Branding',
                      'Uniforms',
                      'Monthly',
                      'Imported / no import source',
                      'Plan retention',
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inventory.plans.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`Select plan ${p.name}`}
                            disabled={!p.eligible}
                            checked={selection.planIds.includes(p.id)}
                            onChange={(e) =>
                              change({
                                ...selection,
                                planIds: e.target.checked
                                  ? [...selection.planIds, p.id]
                                  : selection.planIds.filter((id) => id !== p.id),
                              })
                            }
                          />{' '}
                          {p.financial_year} · {p.name} (#{p.id})
                        </label>
                      </td>
                      <td>
                        {p.status}
                        {!p.eligible && ' — protected'}
                      </td>
                      <td>{p.stationery}</td>
                      <td>{p.branding}</td>
                      <td>{p.uniforms}</td>
                      <td>{p.months}</td>
                      <td>
                        {p.imported} / {p.manual}
                      </td>
                      <td>
                        {p.retentionReason || 'Disposable only when no unselected rows remain.'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!inventory.plans.length && (
              <p>No annual plans. Close settings and choose New annual plan to begin manually.</p>
            )}
            <h5 className="font-semibold">Choose exactly what to clear</h5>
            {(
              [
                ['stationery', 'Stationery & consumables records'],
                ['branding', 'Branding records'],
                ['uniforms', 'Uniform projections'],
                [
                  'deleteEmptyPlans',
                  'Delete disposable empty draft plans only (no audit, import or report history)',
                ],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-sm">
                <input
                  type="checkbox"
                  checked={selection[key]}
                  onChange={(e) => change({ ...selection, [key]: e.target.checked })}
                />{' '}
                {label}
              </label>
            ))}
            <p className="text-sm">
              Associated monthly projections are always removed with selected stationery/branding
              items to avoid orphan or incomplete records. Uniforms have no invented monthly
              allocations. Unselected categories/plans remain.
            </p>
            <label className="block text-sm">
              Record provenance
              <select
                aria-label="Record provenance"
                className={field}
                value={selection.provenance}
                onChange={(e) =>
                  change({
                    ...selection,
                    provenance: e.target.value as ResetSelection['provenance'],
                  })
                }
              >
                <option value="ALL">All selected records</option>
                <option value="IMPORTED">Imported records only</option>
                <option value="MANUAL">No import provenance (manual)</option>
              </select>
            </label>
            <label className="block text-sm">
              Reset reason (10–1000 characters)
              <textarea
                aria-label="Reset reason"
                className={field}
                maxLength={1000}
                value={reason}
                onChange={(e) => {
                  invalidate();
                  setReason(e.target.value);
                }}
              />
            </label>
            <button
              className={quiet}
              disabled={
                !selection.planIds.length ||
                reason.trim().length < 10 ||
                !(
                  selection.stationery ||
                  selection.branding ||
                  selection.uniforms ||
                  selection.deleteEmptyPlans
                )
              }
              onClick={() => void requestPreview()}
            >
              Preview reset — no changes
            </button>
          </fieldset>
          <details>
            <summary>Preserved import batches ({inventory.batches.length})</summary>
            <ul className="max-h-64 overflow-auto text-xs">
              {inventory.batches.map((b) => (
                <li key={b.id}>
                  #{b.id} · {b.filename} · {b.status} · {String(b.created_at)}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      {preview && (
        <section
          aria-label="Reset confirmation preview"
          className="space-y-3 rounded border border-red-400 p-3"
        >
          <h5 className="font-bold">Review exact removal counts before confirming</h5>
          <p>
            {preview.facility.name} (#{preview.facility.id}) · Selected plans:{' '}
            {preview.selection.planIds.join(', ')} · Reason: {preview.reason}
          </p>
          <Counts counts={preview.counts} />
          <p className="text-xs">
            Imported and manual counts are subsets of selected item/uniform records, not extra
            deletions.
          </p>
          <p>
            Plans eligible for deletion: {preview.planIdsToDelete.join(', ') || 'None'}. All other
            plans are preserved.
          </p>
          {preview.retainedPlans.map((p) => (
            <p key={p.id}>
              Preserve plan #{p.id}: {p.reason}
            </p>
          ))}
          <p>
            Preview expires at {preview.expiresAt}. Any intervening planning change requires a new
            preview. Import history and audit remain; previous imports are not silently reactivated
            by reset.
          </p>
          <label className="block">
            Type RESET PLANNING DATA
            <input
              aria-label="Type RESET PLANNING DATA"
              className={field}
              disabled={busy}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            className={button}
            disabled={busy || confirmation !== 'RESET PLANNING DATA'}
            onClick={() => void execute()}
          >
            {busy ? 'Resetting — wait for committed result…' : 'Confirm Reset Planning Data'}
          </button>
          <button className={quiet} disabled={busy} onClick={invalidate}>
            Cancel reset preview
          </button>
        </section>
      )}
      <button
        className={quiet}
        disabled={busy}
        onClick={() => {
          invalidate();
          setInventory(null);
          setRefresh((n) => n + 1);
        }}
      >
        Refresh reset counts
      </button>
    </section>
  );
}
