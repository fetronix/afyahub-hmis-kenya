import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { api, type MaternityPregnancyDetail } from '../../../api/client.ts';
import {
  Field,
  Reading,
  fieldClass,
  formatGestation,
  num,
  patientName,
  text,
  todayIso,
  type RunMaternityAction,
} from './shared.tsx';

export interface AncVisitsPanelProps {
  selectedPregnancy: MaternityPregnancyDetail | null;
  busy: boolean;
  runAction: RunMaternityAction;
  loadAll: () => Promise<void>;
  refreshPregnancy: (pregnancyId: number) => Promise<void>;
  setNotice: (message: string | null) => void;
}

export const AncVisitsPanel: React.FC<AncVisitsPanelProps> = ({
  selectedPregnancy,
  busy,
  runAction,
  loadAll,
  refreshPregnancy,
  setNotice,
}) => {
  const [ancOpen, setAncOpen] = useState(false);
  const [anc, setAnc] = useState({
    visitDate: todayIso(),
    visitNumber: '',
    weightKg: '',
    bpSystolic: '',
    bpDiastolic: '',
    pulseBpm: '',
    fundalHeightCm: '',
    fetalHeartRateBpm: '',
    presentation: '',
    urineProtein: '',
    haemoglobinGdl: '',
    ttDose: '',
    dangerSigns: '',
    notes: '',
    nextVisitDate: '',
  });

  const submitAnc = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selectedPregnancy) return;

    await runAction(async () => {
      await api.recordAncVisit({
        pregnancyId: selectedPregnancy.id,
        visitDate: anc.visitDate,
        visitNumber: num(anc.visitNumber),
        weightKg: num(anc.weightKg),
        bpSystolic: num(anc.bpSystolic),
        bpDiastolic: num(anc.bpDiastolic),
        pulseBpm: num(anc.pulseBpm),
        fundalHeightCm: num(anc.fundalHeightCm),
        fetalHeartRateBpm: num(anc.fetalHeartRateBpm),
        presentation: text(anc.presentation),
        urineProtein: text(anc.urineProtein),
        haemoglobinGdl: num(anc.haemoglobinGdl),
        ttDose: num(anc.ttDose),
        dangerSigns: text(anc.dangerSigns),
        notes: text(anc.notes),
        nextVisitDate: text(anc.nextVisitDate),
      });

      setNotice('Antenatal visit recorded.');
      setAncOpen(false);
      setAnc({
        visitDate: todayIso(),
        visitNumber: '',
        weightKg: '',
        bpSystolic: '',
        bpDiastolic: '',
        pulseBpm: '',
        fundalHeightCm: '',
        fetalHeartRateBpm: '',
        presentation: '',
        urineProtein: '',
        haemoglobinGdl: '',
        ttDose: '',
        dangerSigns: '',
        notes: '',
        nextVisitDate: '',
      });

      await loadAll();
      await refreshPregnancy(selectedPregnancy.id);
    }, 'The antenatal visit could not be recorded.');
  };

  return (
    <section className="rounded-xl border border-hair bg-surface p-4">
      {!selectedPregnancy ? (
        <p className="text-sm text-slate-500">
          Select a pregnancy to see antenatal visits and record a new one.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">
              {patientName(
                selectedPregnancy.patient ?? {
                  firstName: `Patient #${selectedPregnancy.patientId}`,
                  lastName: '',
                },
              )}
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              EDD {selectedPregnancy.eddDate} · {formatGestation(selectedPregnancy.gestation)} ·{' '}
              {selectedPregnancy.status}
            </p>
            <p className="mt-1 text-2xs text-slate-500">
              G{selectedPregnancy.gravida ?? '—'} P{selectedPregnancy.para ?? '—'} ·{' '}
              {selectedPregnancy.ancVisits.length} visit
              {selectedPregnancy.ancVisits.length === 1 ? '' : 's'}
            </p>
            {selectedPregnancy.riskFactors && (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-2xs text-amber-900">
                Risk: {selectedPregnancy.riskFactors}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Antenatal visits
            </h3>
            {selectedPregnancy.status === 'Active' && (
              <button
                type="button"
                onClick={() => setAncOpen((open) => !open)}
                className="rounded-lg bg-teal-700 px-2.5 py-1 text-2xs font-semibold text-white hover:bg-teal-800"
              >
                {ancOpen ? 'Close form' : 'Record visit'}
              </button>
            )}
          </div>

          {ancOpen && (
            <form onSubmit={submitAnc} className="space-y-2 rounded-lg border border-slate-200 p-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Visit date *">
                  <input
                    type="date"
                    required
                    value={anc.visitDate}
                    onChange={(e) => setAnc({ ...anc, visitDate: e.target.value })}
                    className={fieldClass}
                  />
                </Field>
                <Field label="Visit no.">
                  <input
                    type="number"
                    min={1}
                    value={anc.visitNumber}
                    onChange={(e) => setAnc({ ...anc, visitNumber: e.target.value })}
                    className={fieldClass}
                  />
                </Field>
                <Field label="Weight (kg)">
                  <input
                    type="number"
                    step="0.1"
                    value={anc.weightKg}
                    onChange={(e) => setAnc({ ...anc, weightKg: e.target.value })}
                    className={fieldClass}
                  />
                </Field>
                <Field label="BP systolic">
                  <input
                    type="number"
                    value={anc.bpSystolic}
                    onChange={(e) => setAnc({ ...anc, bpSystolic: e.target.value })}
                    className={fieldClass}
                  />
                </Field>
                <Field label="BP diastolic">
                  <input
                    type="number"
                    value={anc.bpDiastolic}
                    onChange={(e) => setAnc({ ...anc, bpDiastolic: e.target.value })}
                    className={fieldClass}
                  />
                </Field>
                <Field label="Pulse">
                  <input
                    type="number"
                    value={anc.pulseBpm}
                    onChange={(e) => setAnc({ ...anc, pulseBpm: e.target.value })}
                    className={fieldClass}
                  />
                </Field>
                <Field label="Fundal height (cm)">
                  <input
                    type="number"
                    step="0.1"
                    value={anc.fundalHeightCm}
                    onChange={(e) => setAnc({ ...anc, fundalHeightCm: e.target.value })}
                    className={fieldClass}
                  />
                </Field>
                <Field label="Fetal heart rate">
                  <input
                    type="number"
                    value={anc.fetalHeartRateBpm}
                    onChange={(e) => setAnc({ ...anc, fetalHeartRateBpm: e.target.value })}
                    className={fieldClass}
                  />
                </Field>
                <Field label="Presentation">
                  <input
                    type="text"
                    value={anc.presentation}
                    onChange={(e) => setAnc({ ...anc, presentation: e.target.value })}
                    className={fieldClass}
                    placeholder="Cephalic"
                  />
                </Field>
                <Field label="Urine protein">
                  <select
                    value={anc.urineProtein}
                    onChange={(e) => setAnc({ ...anc, urineProtein: e.target.value })}
                    className={fieldClass}
                  >
                    <option value="">Not tested</option>
                    {['Negative', 'Trace', '+', '++', '+++'].map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Hb (g/dL)">
                  <input
                    type="number"
                    step="0.1"
                    value={anc.haemoglobinGdl}
                    onChange={(e) => setAnc({ ...anc, haemoglobinGdl: e.target.value })}
                    className={fieldClass}
                  />
                </Field>
                <Field label="TT dose">
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={anc.ttDose}
                    onChange={(e) => setAnc({ ...anc, ttDose: e.target.value })}
                    className={fieldClass}
                  />
                </Field>
                <Field label="Next visit">
                  <input
                    type="date"
                    value={anc.nextVisitDate}
                    onChange={(e) => setAnc({ ...anc, nextVisitDate: e.target.value })}
                    className={fieldClass}
                  />
                </Field>
              </div>

              <Field label="Danger signs">
                <textarea
                  rows={2}
                  value={anc.dangerSigns}
                  onChange={(e) => setAnc({ ...anc, dangerSigns: e.target.value })}
                  className={fieldClass}
                />
              </Field>

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save visit'}
              </button>
            </form>
          )}

          <ul className="space-y-2">
            {selectedPregnancy.ancVisits.length === 0 && (
              <li className="text-xs text-slate-500">No antenatal visits recorded yet.</li>
            )}
            {selectedPregnancy.ancVisits.map((visit) => (
              <li key={visit.id} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-xs font-semibold text-slate-800">
                    {visit.visitDate}
                  </span>
                  <span className="text-2xs text-slate-500">
                    {visit.visitNumber ? `Visit ${visit.visitNumber}` : ''}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-slate-600">
                  <Reading
                    label="Gest"
                    value={visit.gestationWeeks !== null ? `${visit.gestationWeeks}w` : null}
                  />
                  <Reading
                    label="BP"
                    value={
                      visit.bpSystolic && visit.bpDiastolic
                        ? `${visit.bpSystolic}/${visit.bpDiastolic}`
                        : null
                    }
                  />
                  <Reading label="Fundal" value={visit.fundalHeightCm} />
                  <Reading label="FHR" value={visit.fetalHeartRateBpm} />
                  <Reading label="Hb" value={visit.haemoglobinGdl} />
                  <Reading label="Urine" value={visit.urineProtein} />
                </div>
                {visit.dangerSigns && (
                  <p className="mt-1 flex items-center gap-1 text-2xs text-rose-700">
                    <AlertTriangle className="h-3 w-3" />
                    {visit.dangerSigns}
                  </p>
                )}
                {visit.nextVisitDate && (
                  <p className="mt-1 text-2xs text-slate-500">Next: {visit.nextVisitDate}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
