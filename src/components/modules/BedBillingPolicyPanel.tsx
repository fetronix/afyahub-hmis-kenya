import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import type { BedBillingPolicy } from '../../types/index.ts';

const timeText = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Policy is an explicit facility financial decision, never a default. */
export const BedBillingPolicyPanel: React.FC<{ facilityId: number | undefined; canManage: boolean; refreshKey: number }> = ({ facilityId, canManage, refreshKey }) => {
  const [policy, setPolicy] = useState<BedBillingPolicy | null | undefined>(undefined);
  const [cutoff, setCutoff] = useState('');
  const [grace, setGrace] = useState('');
  const [sameDay, setSameDay] = useState<'' | 'ONE' | 'ZERO'>('');
  const [active, setActive] = useState<'' | 'true' | 'false'>('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveUntil, setEffectiveUntil] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    setPolicy(undefined); setError('');
    api.getBedBillingPolicy(facilityId).then((p) => {
      if (!live) return;
      setPolicy(p); setCutoff(p ? timeText(p.cutoffMinutes) : ''); setGrace(p ? String(p.graceMinutes) : ''); setSameDay(p?.sameDayRule ?? '');
      setActive(p?.isActive === true ? 'true' : p?.isActive === false ? 'false' : '');
      setEffectiveFrom(p?.effectiveFrom ?? ''); setEffectiveUntil(p?.effectiveUntil ?? '');
    }).catch(() => { if (live) { setPolicy(undefined); setError('Bed billing policy could not be loaded. Do not assume it is configured.'); } });
    return () => { live = false; };
  }, [facilityId, refreshKey]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !cutoff || grace === '' || !sameDay || !active || !effectiveFrom) return;
    const [hour, minute] = cutoff.split(':').map(Number);
    setSaving(true); setError('');
    try {
      const result = await api.setBedBillingPolicy({ facilityId, cutoffMinutes: hour * 60 + minute, graceMinutes: Number(grace), sameDayRule: sameDay, isActive: active === 'true', effectiveFrom, effectiveUntil: effectiveUntil || null, expectedRevision: policy?.revision ?? null, reason });
      setPolicy(result); setReason(''); setError('Bed policy saved for future admissions. Existing stays retain their recorded policy.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Policy could not be saved.'); }
    finally { setSaving(false); }
  }
  return <details className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
    <summary className="cursor-pointer font-semibold text-slate-800">Bed-night billing policy {policy === null ? '— not configured' : policy ? `— revision ${policy.revision}` : '— unavailable or loading'}</summary>
    <p className="mt-2 text-slate-600">A night is charged for each facility-local cutoff occupied. Discharge within the grace period suppresses that cutoff. The bed occupied at the cutoff supplies its recorded rate. A transfer at the cutoff belongs to the destination bed.</p>
    <p className="mt-1 text-slate-600">For a same-calendar-day stay, choose either one night (cutoff bed, otherwise the last bed) or no night. This policy applies facility-wide to all wards and beds; each bed supplies its own price. Existing stays do not adopt later policy changes.</p>
    <p className="mt-1 text-slate-600">Saving replaces the current facility policy for new admissions. A future start, expired end or inactive status leaves new admissions requiring billing review until an applicable policy is saved.</p>
    {policy?.applicability && <p className="mt-1 font-medium">Current applicability: {policy.applicability.message}</p>}
    {error && <p role="status" className="mt-2 text-amber-800">{error}</p>}
    {!canManage && <p className="mt-2 text-slate-500">Changing this policy requires ward management and facility finance permissions.</p>}
    {canManage && policy !== undefined && <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-4">
      <label>Facility-local cutoff <input aria-label="Facility-local cutoff" required type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} className="block w-full rounded border p-2" /></label>
      <label>Discharge grace (minutes) <input aria-label="Discharge grace minutes" required type="number" min="0" max="1439" step="1" value={grace} onChange={(e) => setGrace(e.target.value)} className="block w-full rounded border p-2" /></label>
      <label>Same-day stay <select aria-label="Same-day stay rule" required value={sameDay} onChange={(e) => setSameDay(e.target.value as '' | 'ONE' | 'ZERO')} className="block w-full rounded border p-2"><option value="">Choose a rule</option><option value="ONE">One night</option><option value="ZERO">No night</option></select></label>
      <label>Active status <select aria-label="Policy active status" required value={active} onChange={(e) => setActive(e.target.value as '' | 'true' | 'false')} className="block w-full rounded border p-2"><option value="">Choose status</option><option value="true">Active</option><option value="false">Inactive</option></select></label>
      <label>Effective from <input aria-label="Policy effective from" required type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="block w-full rounded border p-2" /></label>
      <label>Effective until (optional) <input aria-label="Policy effective until" type="date" min={effectiveFrom || undefined} value={effectiveUntil} onChange={(e) => setEffectiveUntil(e.target.value)} className="block w-full rounded border p-2" /></label>
      <label>Reason <input aria-label="Policy change reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className="block w-full rounded border p-2" /></label>
      <button disabled={saving} className="rounded bg-teal-700 px-3 py-2 font-semibold text-white disabled:opacity-50" type="submit">{saving ? 'Saving…' : 'Save policy'}</button>
    </form>}
  </details>;
};
