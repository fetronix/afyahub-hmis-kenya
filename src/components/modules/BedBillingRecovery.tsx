import React, { useState } from 'react';
import { api } from '../../api/client.ts';
import type { BedBillingUnresolvedPage, BedOccupancyView } from '../../types/index.ts';

type Period = {
  wardId: string;
  bedId: string;
  startedAt: string;
  endedAt: string;
  dailyRate: string;
};
const emptyPeriod = (): Period => ({
  wardId: '',
  bedId: '',
  startedAt: '',
  endedAt: '',
  dailyRate: '',
});

/** Targeted recovery for one admission; does not expose or recreate the retired tariff review screen. */
export const BedBillingRecovery: React.FC<{
  facilityId?: number;
  canReview: boolean;
  canRetry: boolean;
}> = ({ facilityId, canReview, canRetry }) => {
  const [admissionId, setAdmissionId] = useState('');
  const [view, setView] = useState<BedOccupancyView | null>(null);
  const [page, setPage] = useState<BedBillingUnresolvedPage | null>(null);
  const [pageError, setPageError] = useState('');
  const [pageBusy, setPageBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [encounter, setEncounter] = useState('');
  const [affirmEncounter, setAffirmEncounter] = useState(false);
  const [linkReason, setLinkReason] = useState('');
  const [linkReference, setLinkReference] = useState('');
  const [timezone, setTimezone] = useState('');
  const [cutoff, setCutoff] = useState('');
  const [grace, setGrace] = useState('');
  const [sameDay, setSameDay] = useState<'' | 'ONE' | 'ZERO'>('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [affirm, setAffirm] = useState(false);
  const [periods, setPeriods] = useState<Period[]>([emptyPeriod()]);
  async function loadPage(offset = 0) {
    setPageBusy(true);
    setPageError('');
    try {
      setPage(await api.getUnresolvedBedBilling(facilityId, offset));
    } catch {
      setPage(null);
      setPageError(
        'Unresolved bed billing could not be loaded. Do not assume there are no pending charges.',
      );
    } finally {
      setPageBusy(false);
    }
  }
  async function load(target = admissionId) {
    const id = Number(target);
    if (!Number.isSafeInteger(id) || id <= 0) {
      setNotice('Enter a valid admission ID.');
      return;
    }
    setAdmissionId(String(id));
    setBusy(true);
    setNotice('');
    setView(null);
    setEncounter('');
    setLinkReason('');
    setLinkReference('');
    setAffirmEncounter(false);
    setTimezone('');
    setCutoff('');
    setGrace('');
    setSameDay('');
    setReference('');
    setReason('');
    setAffirm(false);
    setPeriods([emptyPeriod()]);
    try {
      setView(await api.getBedOccupancy(id, facilityId));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Admission evidence could not be loaded.');
    } finally {
      setBusy(false);
    }
  }
  async function showAfterAction(id: number, outcome: string) {
    try {
      setView(await api.getBedOccupancy(id, facilityId));
      setNotice(outcome);
    } catch {
      setView(null);
      setNotice(`${outcome} Evidence could not be refreshed; reload it before another action.`);
    }
  }
  async function link(event: React.FormEvent) {
    event.preventDefault();
    if (!view || !canReview || !affirmEncounter) return;
    setBusy(true);
    setNotice('');
    try {
      await api.linkBedBillingEncounter(
        view.admissionId,
        Number(encounter),
        linkReason,
        linkReference,
        affirmEncounter,
        facilityId,
      );
      setAffirmEncounter(false);
      await showAfterAction(
        view.admissionId,
        'Verified encounter linked. Existing invoices were not moved. Retry bed billing separately.',
      );
    } catch (error) {
      setNotice(
        `${error instanceof Error ? error.message : 'The encounter link could not be confirmed.'} Reload evidence before retrying.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function review(event: React.FormEvent) {
    event.preventDefault();
    if (!view || !canReview || !sameDay || !cutoff || grace === '') return;
    setBusy(true);
    setNotice('');
    const [hours, minutes] = cutoff.split(':').map(Number);
    try {
      const result = await api.reviewBedHistory(
        view.admissionId,
        {
          timezone,
          cutoffMinutes: hours * 60 + minutes,
          graceMinutes: Number(grace),
          sameDayRule: sameDay,
          evidenceReference: reference,
          reason,
          affirmReviewedHistoryAndCharges: affirm,
          periods: periods.map((p) => ({
            wardId: Number(p.wardId),
            bedId: Number(p.bedId),
            startedAt: p.startedAt,
            endedAt: p.endedAt,
            dailyRate: p.dailyRate,
          })),
        },
        facilityId,
      );
      await showAfterAction(
        view.admissionId,
        `Review #${result.reviewId} recorded with ${result.nights} night(s). Billing has not yet been retried.`,
      );
      setAffirm(false);
      await loadPage(page?.offset ?? 0);
    } catch (error) {
      setNotice(
        `${error instanceof Error ? error.message : 'Bed history review could not be confirmed.'} Reload evidence before retrying.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    if (!view || !canRetry) return;
    setBusy(true);
    setNotice('');
    try {
      const result = await api.retryBedBilling(view.admissionId, facilityId);
      const billed = result.charges.filter((c) => c.charged).length;
      const remaining = result.charges.filter((c) => !c.charged && c.reason !== 'DUPLICATE').length;
      await showAfterAction(
        view.admissionId,
        result.review?.message ??
          `${billed} night(s) added; ${remaining} still need review. Previously billed lines are not added again.`,
      );
      await loadPage(page?.offset ?? 0);
    } catch (error) {
      setView(null);
      setNotice(
        `${error instanceof Error ? error.message : 'Billing status could not be confirmed.'} Reload evidence and pending work before retrying.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="rounded-xl border border-slate-200 bg-white p-4 text-xs"
      onToggle={(event) => {
        if (event.currentTarget.open && !page && !pageBusy) void loadPage();
      }}
    >
      <summary className="cursor-pointer font-semibold">
        Recover bed billing for an admission
      </summary>
      <p className="mt-2 text-slate-600">
        Billing issues do not change a committed discharge or cleaning status. Historical prices and
        policies must be verified against records; today’s bed rate is not evidence of an earlier
        rate.
      </p>
      <div className="mt-3 rounded border p-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">Admissions with unresolved bed billing</p>
          <button
            type="button"
            disabled={pageBusy}
            onClick={() => void loadPage(page?.offset ?? 0)}
            className="rounded border px-2 py-1"
          >
            Refresh
          </button>
        </div>
        {pageError && (
          <p role="status" className="text-amber-800">
            {pageError}
          </p>
        )}
        {pageBusy && <p>Loading bed billing status…</p>}
        {page && !pageBusy && page.admissions.length === 0 && (
          <p>
            No unresolved bed billing work on this page. This does not prove every stay was billed.
          </p>
        )}
        {page &&
          page.admissions.map((entry) => (
            <div
              key={entry.admissionId}
              className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t pt-1"
            >
              <span>
                Admission #{entry.admissionId} · {entry.admissionStatus ?? 'status unavailable'}
                {entry.stagingPending ? ' · billing staging pending' : ''} · {entry.pendingAttempts}{' '}
                pending attempt(s)
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void load(String(entry.admissionId))}
                className="rounded border px-2 py-1"
              >
                Inspect evidence
              </button>
            </div>
          ))}
        {page && (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pageBusy || page.offset === 0}
              onClick={() => void loadPage(Math.max(0, page.offset - page.pageSize))}
              className="rounded border px-2 py-1 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={pageBusy || !page.hasMore}
              onClick={() => void loadPage(page.offset + page.pageSize)}
              className="rounded border px-2 py-1 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <label>
          Admission ID{' '}
          <input
            aria-label="Recovery admission ID"
            type="number"
            min="1"
            value={admissionId}
            onChange={(e) => {
              setAdmissionId(e.target.value);
              setView(null);
            }}
            className="rounded border p-2"
          />
        </label>
        <button
          disabled={busy || !admissionId}
          onClick={() => void load()}
          className="rounded border px-3"
        >
          Load
        </button>
      </div>
      {notice && (
        <p role="status" className="mt-2 text-amber-800">
          {notice}
        </p>
      )}
      {view && (
        <div className="mt-3 space-y-3">
          <p>
            Admission #{view.admissionId} · patient #{view.admission.patientId} ·{' '}
            {view.admission.status} · encounter {view.admission.encounterId ?? 'not linked'}
          </p>
          <p>
            Recorded clinical admission: {view.admission.admissionDate}; discharge:{' '}
            {view.admission.dischargeDate ?? 'not recorded'}.
          </p>
          {view.staySnapshot ? (
            <div className="rounded bg-slate-50 p-2">
              <p>
                Admission snapshot: timezone {view.staySnapshot.timezoneSnapshot ?? 'not captured'};
                cutoff{' '}
                {view.staySnapshot.cutoffMinutes == null
                  ? 'not captured'
                  : `${view.staySnapshot.cutoffMinutes} minutes after midnight`}
                ; grace{' '}
                {view.staySnapshot.graceMinutes == null
                  ? 'not captured'
                  : `${view.staySnapshot.graceMinutes} minutes`}
                ; same-day rule {view.staySnapshot.sameDayRule ?? 'not captured'}; policy{' '}
                {view.staySnapshot.policyId ?? 'not captured'}, revision{' '}
                {view.staySnapshot.policyRevision ?? 'not captured'}; applicability{' '}
                {view.staySnapshot.policyApplicability ?? 'not captured'}; effective dates{' '}
                {view.staySnapshot.policyEffectiveFrom ?? 'not captured'} to{' '}
                {view.staySnapshot.policyEffectiveUntil ?? 'no captured end'}.
              </p>
              <p>
                Client-supplied time flagged: admission{' '}
                {view.staySnapshot.manualAdmissionTime ? 'yes' : 'no'}, discharge{' '}
                {view.staySnapshot.manualDischargeTime ? 'yes' : 'no'}. A previous client could have
                supplied a time automatically; a flag alone does not establish its origin.
              </p>
            </div>
          ) : (
            <p>No admission policy/time snapshot was captured.</p>
          )}
          {view.periods.length > 0 && (
            <ul className="list-disc pl-5">
              {view.periods.map((p) => (
                <li key={p.id}>
                  Ward {p.wardId} / bed {p.bedId}: {p.startedAt} to {p.endedAt ?? 'open'}, captured
                  rate {p.dailyRateSnapshot == null ? 'not captured' : `KES ${p.dailyRateSnapshot}`}
                  ; source{' '}
                  {p.rateSourceSnapshot === 'BED_OVERRIDE'
                    ? 'bed override'
                    : p.rateSourceSnapshot === 'WARD_DEFAULT'
                      ? 'ward default'
                      : p.rateSourceSnapshot === 'REVIEWED'
                        ? 'reviewed evidence'
                        : 'not captured'}
                  ; price revision {p.priceRevisionSnapshot ?? 'not captured'}.
                </li>
              ))}
            </ul>
          )}
          {view.transfers.length > 0 && (
            <ul className="list-disc pl-5">
              {view.transfers.map((t, i) => (
                <li key={i}>
                  Transfer {t.transferredAt}: ward {t.fromWardId ?? '?'} / bed {t.fromBedId ?? '?'}{' '}
                  → ward {t.toWardId} / bed {t.toBedId}
                </li>
              ))}
            </ul>
          )}
          <p>
            {view.review
              ? view.review.message
              : `Recorded calculation: ${view.nights ?? 'unknown'} night(s), ${view.estimatedAmount === null ? 'amount unavailable' : `KES ${view.estimatedAmount}`}.`}
          </p>
          {view.unresolved === null ? (
            <p>Pending bed-attempt details are unavailable for your permissions.</p>
          ) : (
            <div>
              <p className="font-semibold">Pending bed attempts</p>
              {view.unresolved.stagingPending && (
                <p>
                  Bed billing staging has not completed; inspect the evidence and retry this
                  admission.
                </p>
              )}
              {view.unresolved.attempts.length === 0 ? (
                <p>
                  None returned for this admission; this does not establish payment or completed
                  staging.
                </p>
              ) : (
                <ul className="list-disc pl-5">
                  {view.unresolved.attempts.map((attempt) => (
                    <li key={attempt.id}>
                      Attempt #{attempt.id} · {attempt.idempotencySuffix ?? 'legacy undated'} ·{' '}
                      {attempt.reason} · {attempt.diagnosisCode ?? 'specific diagnosis unavailable'}
                      .
                    </li>
                  ))}
                </ul>
              )}
              {view.unresolved.hasMore && (
                <p>More than 100 attempts exist; this view shows the first 100.</p>
              )}
            </div>
          )}
          {canReview && view.admission.encounterId === null && (
            <form onSubmit={link} className="rounded border p-3 space-y-2">
              <p className="font-semibold">Link the verified encounter</p>
              <p>
                Only the patient's inpatient encounter at this facility with overlapping recorded
                dates is eligible. A different or existing encounter cannot be replaced; existing
                invoices will not be moved.
              </p>
              <label>
                Encounter ID{' '}
                <input
                  required
                  type="number"
                  min="1"
                  value={encounter}
                  onChange={(e) => setEncounter(e.target.value)}
                  className="rounded border p-1"
                />
              </label>{' '}
              <label>
                Reason{' '}
                <input
                  required
                  minLength={3}
                  maxLength={500}
                  value={linkReason}
                  onChange={(e) => setLinkReason(e.target.value)}
                  className="rounded border p-1"
                />
              </label>{' '}
              <label>
                Evidence reference{' '}
                <input
                  required
                  minLength={3}
                  maxLength={500}
                  value={linkReference}
                  onChange={(e) => setLinkReference(e.target.value)}
                  className="rounded border p-1"
                />
              </label>
              <p>
                Use a facility record reference without patient details. Dates are a calendar-day
                check, not proof of the encounter relationship.
              </p>
              <label className="flex gap-2">
                <input
                  required
                  type="checkbox"
                  checked={affirmEncounter}
                  onChange={(e) => setAffirmEncounter(e.target.checked)}
                />
                I verified the patient, facility, encounter type and dates against the admission
                record.
              </label>
              <button disabled={busy} className="rounded bg-teal-700 px-2 py-1 text-white">
                Link encounter
              </button>
            </form>
          )}
          {canReview && view.admission.status === 'Discharged' && view.review && (
            <form onSubmit={review} className="rounded border p-3 space-y-3">
              <p className="font-semibold">Evidence-based historical bed review</p>
              <p>
                Enter documented facts only. Times must include an offset, for example
                2026-10-01T09:00:00+03:00. Recorded transfer identities and times must match. Do not
                include patient details in the evidence reference or reason. Existing billed or
                voided bed lines need separate financial reconciliation.
              </p>
              <div className="grid gap-2 sm:grid-cols-4">
                <label>
                  Historical timezone{' '}
                  <input
                    required
                    placeholder="Africa/Nairobi"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="block w-full rounded border p-1"
                  />
                </label>
                <label>
                  Cutoff{' '}
                  <input
                    required
                    type="time"
                    value={cutoff}
                    onChange={(e) => setCutoff(e.target.value)}
                    className="block w-full rounded border p-1"
                  />
                </label>
                <label>
                  Grace minutes{' '}
                  <input
                    required
                    type="number"
                    min="0"
                    max="1439"
                    value={grace}
                    onChange={(e) => setGrace(e.target.value)}
                    className="block w-full rounded border p-1"
                  />
                </label>
                <label>
                  Same-day rule{' '}
                  <select
                    required
                    value={sameDay}
                    onChange={(e) => setSameDay(e.target.value as '' | 'ONE' | 'ZERO')}
                    className="block w-full rounded border p-1"
                  >
                    <option value="">Choose</option>
                    <option value="ONE">One night</option>
                    <option value="ZERO">No night</option>
                  </select>
                </label>
              </div>
              {periods.map((p, i) => (
                <fieldset key={i} className="grid gap-2 rounded border p-2 sm:grid-cols-5">
                  <legend>Verified period {i + 1}</legend>
                  {(['wardId', 'bedId', 'startedAt', 'endedAt', 'dailyRate'] as const).map(
                    (field) => (
                      <label key={field}>
                        {
                          {
                            wardId: 'Ward ID',
                            bedId: 'Bed ID',
                            startedAt: 'Start with offset',
                            endedAt: 'End with offset',
                            dailyRate: 'Daily rate KES',
                          }[field]
                        }
                        <input
                          required
                          value={p[field]}
                          onChange={(e) =>
                            setPeriods(
                              periods.map((entry, index) =>
                                index === i ? { ...entry, [field]: e.target.value } : entry,
                              ),
                            )
                          }
                          className="block w-full rounded border p-1"
                        />
                      </label>
                    ),
                  )}
                </fieldset>
              ))}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPeriods([...periods, emptyPeriod()])}
                  className="rounded border px-2 py-1"
                >
                  Add period
                </button>
                {periods.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setPeriods(periods.slice(0, -1))}
                    className="rounded border px-2 py-1"
                  >
                    Remove last period
                  </button>
                )}
              </div>
              <label className="block">
                Evidence reference{' '}
                <input
                  required
                  minLength={3}
                  maxLength={500}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full rounded border p-1"
                />
              </label>
              <label className="block">
                Reason{' '}
                <input
                  required
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded border p-1"
                />
              </label>
              <label className="flex gap-2">
                <input
                  required
                  type="checkbox"
                  checked={affirm}
                  onChange={(e) => setAffirm(e.target.checked)}
                />
                I verified the periods, historical rates, policy and prior bed charges against the
                facility’s records.
              </label>
              <button disabled={busy} className="rounded bg-teal-700 px-3 py-2 text-white">
                Record reviewed evidence
              </button>
            </form>
          )}
          {canRetry && view.admission.status === 'Discharged' && (
            <button
              disabled={busy}
              onClick={() => void retry()}
              className="rounded border border-teal-700 px-3 py-2 font-semibold text-teal-800"
            >
              Retry this admission’s bed billing
            </button>
          )}
        </div>
      )}
    </details>
  );
};
