import React, { useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { privateInsuranceApi } from '../../../api/private-insurance.client.ts';
import { shaEclaimsApi } from '../../../api/sha-eclaims.client.ts';
import type {
  DispatchReconciliationOutcome,
  DispatchReviewQueueItem,
  DispatchReviewSummary,
} from '../../../api/dispatch-review.types.ts';

interface Props {
  workflow: 'SHA' | 'PRIVATE';
  facilityId?: number | null;
  claimId: number;
  review: DispatchReviewSummary | null | undefined;
  /** Recording a review is a reconciliation authority, not a billing one. */
  canReconcile: boolean;
  notify: (message: string, tone: 'success' | 'error' | 'info' | 'warning') => void;
  onReconciled: () => void | Promise<void>;
}

const OUTCOMES: Array<{ value: DispatchReconciliationOutcome; label: string; hint: string }> = [
  {
    value: 'PAYER_CONFIRMED_RECEIVED',
    label: 'Payer record shows the claim was received',
    hint: 'Requires the payer-side reference. The claim is then marked ACKNOWLEDGED; this is not an adjudication or a payment.',
  },
  {
    value: 'PAYER_CONFIRMED_NOT_RECEIVED',
    label: 'Payer record shows no claim was received',
    hint: 'The claim is released so a human can dispatch it again. Nothing is re-sent automatically.',
  },
  {
    value: 'STILL_UNRESOLVED',
    label: 'Checked, still unresolved',
    hint: 'The check is recorded but the claim stays blocked. Do not guess.',
  },
];

/**
 * Dispatch review form.
 *
 * A claim that hit an ambiguous transport failure is blocked until someone with
 * reconciliation authority records what the payer's own record shows. This form
 * never contacts a payer and never retries a dispatch; it records evidence and,
 * when that evidence is conclusive, releases the claim.
 */
export const DispatchReviewPanel: React.FC<Props> = ({
  workflow,
  facilityId,
  claimId,
  review,
  canReconcile,
  notify,
  onReconciled,
}) => {
  const [outcome, setOutcome] = useState<DispatchReconciliationOutcome | ''>('');
  const [payerReference, setPayerReference] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (!review) return null;

  const noteTooShort = evidenceNote.trim().length < 10;
  const referenceMissing =
    outcome === 'PAYER_CONFIRMED_RECEIVED' && payerReference.trim().length < 3;
  const canSubmit = Boolean(outcome) && !noteTooShort && !referenceMissing && !busy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!outcome || !canSubmit) return;
    setBusy(true);
    try {
      const payload = {
        outcome,
        payerReference: payerReference.trim() || null,
        evidenceNote: evidenceNote.trim(),
        ...(review.id ? { guardId: review.id } : {}),
      };
      const result =
        workflow === 'SHA'
          ? await shaEclaimsApi.recordClaimDispatchReconciliation(
              claimId,
              payload,
              facilityId ?? null,
            )
          : await privateInsuranceApi.recordClaimDispatchReconciliation(claimId, payload);
      notify(
        result.guardReleased
          ? `Dispatch review recorded. Claim status is now ${result.claimStatus}.`
          : 'Dispatch review recorded. The claim remains blocked pending a conclusive payer check.',
        result.guardReleased ? 'success' : 'warning',
      );
      setOutcome('');
      setPayerReference('');
      setEvidenceNote('');
      await onReconciled();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to record the dispatch review.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="alert"
      aria-label="Claim dispatch review"
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-3 text-xs text-amber-950"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <div className="font-bold">
            Dispatch outcome unresolved (attempt {review.attemptNumber ?? '—'})
          </div>
          <p>
            A dispatch reservation has no confirmed result. Local state is{' '}
            <span className="font-mono">{review.state}</span>. All further changes to this claim are
            blocked until a review is recorded. This is a local reservation record — not payer
            acceptance, adjudication or payment.
          </p>
          {review.correlationId && (
            <p className="font-mono text-[10px] break-all">Correlation: {review.correlationId}</p>
          )}
        </div>
      </div>

      {!canReconcile ? (
        <p className="flex items-start gap-1.5 text-amber-900">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />A user with claim reconciliation
          authority must check the payer&apos;s own record and record the outcome here. Do not
          re-dispatch this claim.
        </p>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          <fieldset className="space-y-2">
            <legend className="font-semibold">What does the payer&apos;s own record show?</legend>
            {OUTCOMES.map((option) => (
              <label key={option.value} className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`dispatch-outcome-${claimId}`}
                  value={option.value}
                  checked={outcome === option.value}
                  onChange={() => setOutcome(option.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-semibold">{option.label}</span>
                  <span className="block text-[11px] text-amber-900">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {outcome === 'PAYER_CONFIRMED_RECEIVED' && (
            <label className="block font-semibold">
              Payer-side reference
              <input
                value={payerReference}
                onChange={(event) => setPayerReference(event.target.value)}
                placeholder="Reference from the payer's record"
                className="field-input mt-1"
                required
                minLength={3}
              />
            </label>
          )}

          <label className="block font-semibold">
            What was checked?
            <textarea
              value={evidenceNote}
              onChange={(event) => setEvidenceNote(event.target.value)}
              placeholder="e.g. payer portal batch report, call reference, date and time"
              className="field-input mt-1 min-h-[64px]"
              required
              minLength={10}
            />
            <span className="block text-[11px] font-normal text-amber-900">
              At least 10 characters. This is stored permanently as evidence.
            </span>
          </label>

          <div className="flex items-center justify-between gap-2">
            {noteTooShort && evidenceNote.length > 0 && (
              <span className="text-[11px] text-amber-900">
                Add a little more detail before recording.
              </span>
            )}
            <button
              type="submit"
              disabled={!canSubmit}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 text-white disabled:opacity-50"
            >
              {busy ? 'Recording…' : 'Record dispatch review'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

interface QueueProps {
  workflow: 'SHA' | 'PRIVATE';
  facilityId?: number | null;
  canReconcile: boolean;
  onSelect: (claimId: number) => void | Promise<void>;
}

/**
 * Claims currently held by a dispatch reservation in this facility.
 *
 * This is a local work queue: a reservation is not evidence that the payer has
 * or has not received anything. It exists so an administrator can find blocked
 * claims without hunting for them one by one.
 */
export const DispatchReviewQueue: React.FC<QueueProps> = ({
  workflow,
  facilityId,
  canReconcile,
  onSelect,
}) => {
  const [items, setItems] = React.useState<DispatchReviewQueueItem[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const fetchReviews = React.useCallback(
    () =>
      workflow === 'SHA'
        ? shaEclaimsApi.getDispatchReviews(facilityId ?? null)
        : privateInsuranceApi.getDispatchReviews(),
    [workflow, facilityId],
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchReviews();
      setItems(res.reviews ?? []);
      setNotice(res.limitations?.notice ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dispatch reviews.');
    } finally {
      setLoading(false);
    }
  }, [fetchReviews]);

  // The first load resolves asynchronously; manual refreshes reuse `load`.
  React.useEffect(() => {
    let active = true;
    fetchReviews()
      .then((res) => {
        if (!active) return;
        setItems(res.reviews ?? []);
        setNotice(res.limitations?.notice ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load dispatch reviews.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchReviews]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">Dispatch reviews</h3>
        <button type="button" onClick={() => void load()} className="btn-quiet text-xs">
          Refresh queue
        </button>
      </div>
      {notice && <p className="text-[11px] text-slate-500">{notice}</p>}
      {error && <p className="text-xs text-rose-700">{error}</p>}
      {loading ? (
        <p className="text-xs text-slate-500">Loading blocked dispatches…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-500">
          No claim dispatch is awaiting review in this facility.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 text-xs">
          {items.map((item) => (
            <li
              key={`${item.workflow}-${item.claimId}`}
              className="py-2 flex flex-wrap items-center gap-2"
            >
              <span className="font-mono font-semibold text-navy-900">{item.claimNumber}</span>
              <span className="text-slate-600">{item.patientName ?? 'Unknown patient'}</span>
              <span className="text-slate-500">{item.claimStatus}</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200 text-[10px] font-semibold">
                {item.state} · attempt {item.attemptNumber}
              </span>
              <span className="text-slate-500">
                {item.ageMinutes < 60
                  ? `${item.ageMinutes} min`
                  : `${Math.round(item.ageMinutes / 60)} h`}{' '}
                since last update
              </span>
              {item.lastReconciliation && (
                <span className="text-slate-500">
                  Last check: {item.lastReconciliation.outcome.replaceAll('_', ' ').toLowerCase()}
                </span>
              )}
              {canReconcile && (
                <button
                  type="button"
                  onClick={() => void onSelect(item.claimId)}
                  className="ml-auto px-2 py-1 rounded border border-amber-300 text-[11px] font-semibold text-amber-900"
                >
                  Review
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
