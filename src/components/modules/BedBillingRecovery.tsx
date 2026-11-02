import React, { useState } from 'react';
import { api } from '../../api/client.ts';
import type { BedOccupancyView } from '../../types/index.ts';

type Period = { wardId: string; bedId: string; startedAt: string; endedAt: string; dailyRate: string };
const emptyPeriod = (): Period => ({ wardId: '', bedId: '', startedAt: '', endedAt: '', dailyRate: '' });

/** Targeted recovery for one admission; does not expose or recreate the retired tariff review screen. */
export const BedBillingRecovery: React.FC<{ canReview: boolean; canRetry: boolean }> = ({ canReview, canRetry }) => {
  const [admissionId, setAdmissionId] = useState('');
  const [view, setView] = useState<BedOccupancyView | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [encounter, setEncounter] = useState('');
  const [linkReason, setLinkReason] = useState('');
  const [timezone, setTimezone] = useState('');
  const [cutoff, setCutoff] = useState('');
  const [grace, setGrace] = useState('');
  const [sameDay, setSameDay] = useState<'' | 'ONE' | 'ZERO'>('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [affirm, setAffirm] = useState(false);
  const [periods, setPeriods] = useState<Period[]>([emptyPeriod()]);
  async function load() {
    setBusy(true); setNotice(''); setView(null);
    try { setView(await api.getBedOccupancy(Number(admissionId))); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Admission evidence could not be loaded.'); }
    finally { setBusy(false); }
  }
  async function link(event: React.FormEvent) {
    event.preventDefault(); if (!view || !canReview) return;
    setBusy(true); setNotice('');
    try {
      await api.linkBedBillingEncounter(view.admissionId, Number(encounter), linkReason);
      setView(await api.getBedOccupancy(view.admissionId));
      setNotice('Verified encounter linked. Existing invoices were not moved. Retry bed billing separately.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'The encounter link could not be confirmed.'); }
    finally { setBusy(false); }
  }
  async function review(event: React.FormEvent) {
    event.preventDefault(); if (!view || !canReview || !sameDay || !cutoff || grace === '') return;
    setBusy(true); setNotice('');
    const [hours, minutes] = cutoff.split(':').map(Number);
    try {
      const result = await api.reviewBedHistory(view.admissionId, {
        timezone, cutoffMinutes: hours * 60 + minutes, graceMinutes: Number(grace), sameDayRule: sameDay,
        evidenceReference: reference, reason, affirmReviewedHistoryAndCharges: affirm,
        periods: periods.map((p) => ({ wardId: Number(p.wardId), bedId: Number(p.bedId), startedAt: p.startedAt, endedAt: p.endedAt, dailyRate: p.dailyRate })),
      });
      setView(await api.getBedOccupancy(view.admissionId));
      setNotice(`Review #${result.reviewId} recorded with ${result.nights} night(s). Billing has not yet been retried.`);
      setAffirm(false);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Bed history review could not be saved.'); }
    finally { setBusy(false); }
  }
  async function retry() {
    if (!view || !canRetry) return;
    setBusy(true); setNotice('');
    try {
      const result = await api.retryBedBilling(view.admissionId);
      const billed = result.charges.filter((c) => c.charged).length;
      const remaining = result.charges.filter((c) => !c.charged && c.reason !== 'DUPLICATE').length;
      setNotice(result.review?.message ?? `${billed} night(s) added; ${remaining} still need review. Previously billed lines are not added again.`);
      setView(await api.getBedOccupancy(view.admissionId));
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Billing status could not be confirmed.'); }
    finally { setBusy(false); }
  }
  return <details className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
    <summary className="cursor-pointer font-semibold">Recover bed billing for a discharged admission</summary>
    <p className="mt-2 text-slate-600">Load a specific admission. Billing issues do not change its discharge or cleaning status. Historical prices and policies must be verified against records; today’s bed rate is not evidence of an earlier rate.</p>
    <div className="mt-3 flex gap-2"><label>Admission ID <input aria-label="Recovery admission ID" type="number" min="1" value={admissionId} onChange={(e) => { setAdmissionId(e.target.value); setView(null); }} className="rounded border p-2" /></label><button disabled={busy || !admissionId} onClick={() => void load()} className="rounded border px-3">Load</button></div>
    {notice && <p role="status" className="mt-2 text-amber-800">{notice}</p>}
    {view && <div className="mt-3 space-y-3">
      <p>Admission #{view.admissionId} · patient #{view.admission.patientId} · {view.admission.status} · encounter {view.admission.encounterId ?? 'not linked'}</p>
      <p>Recorded clinical admission: {view.admission.admissionDate}; discharge: {view.admission.dischargeDate ?? 'not recorded'}.</p>
      {view.transfers.length > 0 && <ul className="list-disc pl-5">{view.transfers.map((t, i) => <li key={i}>Transfer {t.transferredAt}: ward {t.fromWardId ?? '?'} / bed {t.fromBedId ?? '?'} → ward {t.toWardId} / bed {t.toBedId}</li>)}</ul>}
      <p>{view.review ? view.review.message : `Recorded calculation: ${view.nights ?? 'unknown'} night(s), ${view.estimatedAmount === null ? 'amount unavailable' : `KES ${view.estimatedAmount}`}.`}</p>
      {canReview && view.admission.encounterId === null && <form onSubmit={link} className="rounded border p-3 space-y-2"><p className="font-semibold">Link the verified encounter</p><p>A different or existing encounter cannot be replaced; existing invoices will not be moved.</p><label>Encounter ID <input required type="number" min="1" value={encounter} onChange={(e) => setEncounter(e.target.value)} className="rounded border p-1" /></label>{' '}<label>Reason <input required minLength={3} maxLength={500} value={linkReason} onChange={(e) => setLinkReason(e.target.value)} className="rounded border p-1" /></label>{' '}<button disabled={busy} className="rounded bg-teal-700 px-2 py-1 text-white">Link encounter</button></form>}
      {canReview && view.admission.status === 'Discharged' && view.review && <form onSubmit={review} className="rounded border p-3 space-y-3">
        <p className="font-semibold">Evidence-based historical bed review</p>
        <p>Enter documented facts only. Times must include an offset, for example 2026-10-01T09:00:00+03:00. Recorded transfer identities and times must match. Do not include patient details in the evidence reference or reason. Existing billed or voided bed lines need separate financial reconciliation.</p>
        <div className="grid gap-2 sm:grid-cols-4"><label>Historical timezone <input required placeholder="Africa/Nairobi" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="block w-full rounded border p-1" /></label><label>Cutoff <input required type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} className="block w-full rounded border p-1" /></label><label>Grace minutes <input required type="number" min="0" max="1439" value={grace} onChange={(e) => setGrace(e.target.value)} className="block w-full rounded border p-1" /></label><label>Same-day rule <select required value={sameDay} onChange={(e) => setSameDay(e.target.value as '' | 'ONE' | 'ZERO')} className="block w-full rounded border p-1"><option value="">Choose</option><option value="ONE">One night</option><option value="ZERO">No night</option></select></label></div>
        {periods.map((p, i) => <fieldset key={i} className="grid gap-2 rounded border p-2 sm:grid-cols-5"><legend>Verified period {i + 1}</legend>{(['wardId', 'bedId', 'startedAt', 'endedAt', 'dailyRate'] as const).map((field) => <label key={field}>{({ wardId: 'Ward ID', bedId: 'Bed ID', startedAt: 'Start with offset', endedAt: 'End with offset', dailyRate: 'Daily rate KES' })[field]}<input required value={p[field]} onChange={(e) => setPeriods(periods.map((entry, index) => index === i ? { ...entry, [field]: e.target.value } : entry))} className="block w-full rounded border p-1" /></label>)}</fieldset>)}
        <div className="flex gap-2"><button type="button" onClick={() => setPeriods([...periods, emptyPeriod()])} className="rounded border px-2 py-1">Add period</button>{periods.length > 1 && <button type="button" onClick={() => setPeriods(periods.slice(0, -1))} className="rounded border px-2 py-1">Remove last period</button>}</div>
        <label className="block">Evidence reference <input required minLength={3} maxLength={500} value={reference} onChange={(e) => setReference(e.target.value)} className="w-full rounded border p-1" /></label><label className="block">Reason <input required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded border p-1" /></label>
        <label className="flex gap-2"><input required type="checkbox" checked={affirm} onChange={(e) => setAffirm(e.target.checked)} />I verified the periods, historical rates, policy and prior bed charges against the facility’s records.</label>
        <button disabled={busy} className="rounded bg-teal-700 px-3 py-2 text-white">Record reviewed evidence</button>
      </form>}
      {canRetry && view.admission.status === 'Discharged' && <button disabled={busy} onClick={() => void retry()} className="rounded border border-teal-700 px-3 py-2 font-semibold text-teal-800">Retry this admission’s bed billing</button>}
    </div>}
  </details>;
};
