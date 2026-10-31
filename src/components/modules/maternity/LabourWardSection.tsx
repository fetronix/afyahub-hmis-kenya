import { DataTable } from '../../ui/layout.tsx';
import React, { useState } from 'react';
import { Plus } from 'lucide-react';

import {
  api,
  type LabourRecord,
  type MaternityPregnancy,
  type PartographEntry,
} from '../../../api/client.ts';
import { PartographChart } from '../../maternity/PartographChart.tsx';
import {
  Field,
  fieldClass,
  num,
  patientName,
  statusClass,
  text,
  type RunMaternityAction,
} from './shared.tsx';

export interface LabourWardSectionProps {
  activePregnancies: MaternityPregnancy[];
  labours: LabourRecord[];
  selectedLabour: LabourRecord | null;
  busy: boolean;
  runAction: RunMaternityAction;
  loadAll: () => Promise<void>;
  refreshLabour: (labourRecordId: number) => Promise<void>;
  setNotice: (message: string | null) => void;
  onStartDeliveryFromLabour: (pregnancyId: number, labourRecordId: number) => void;
}

export const LabourWardSection: React.FC<LabourWardSectionProps> = ({
  activePregnancies,
  labours,
  selectedLabour,
  busy,
  runAction,
  loadAll,
  refreshLabour,
  setNotice,
  onStartDeliveryFromLabour,
}) => {
  const [labourOpen, setLabourOpen] = useState(false);
  const [labourForm, setLabourForm] = useState({
    pregnancyId: '',
    admittedAt: '',
    labourOnsetAt: '',
  });

  const [pg, setPg] = useState({
    recordedAt: '',
    cervicalDilatationCm: '',
    descentStation: '',
    contractionsPer10Min: '',
    contractionDurationSec: '',
    fetalHeartRateBpm: '',
    membranes: '',
    liquor: '',
    maternalPulseBpm: '',
    bpSystolic: '',
    bpDiastolic: '',
    temperatureC: '',
    notes: '',
  });

  const submitLabour = async (event: React.FormEvent) => {
    event.preventDefault();

    await runAction(async () => {
      const created = await api.startLabour({
        pregnancyId: num(labourForm.pregnancyId),
        admittedAt: labourForm.admittedAt || new Date().toISOString(),
        labourOnsetAt: text(labourForm.labourOnsetAt),
      });

      setNotice('Labour record opened.');
      setLabourOpen(false);
      setLabourForm({ pregnancyId: '', admittedAt: '', labourOnsetAt: '' });

      await loadAll();
      await refreshLabour(created.id);
    }, 'The labour record could not be opened.');
  };

  const submitPartograph = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selectedLabour) return;

    await runAction(async () => {
      await api.recordPartograph({
        labourRecordId: selectedLabour.id,
        recordedAt: pg.recordedAt || new Date().toISOString(),
        cervicalDilatationCm: num(pg.cervicalDilatationCm),
        descentStation: num(pg.descentStation),
        contractionsPer10Min: num(pg.contractionsPer10Min),
        contractionDurationSec: num(pg.contractionDurationSec),
        fetalHeartRateBpm: num(pg.fetalHeartRateBpm),
        membranes: text(pg.membranes),
        liquor: text(pg.liquor),
        maternalPulseBpm: num(pg.maternalPulseBpm),
        bpSystolic: num(pg.bpSystolic),
        bpDiastolic: num(pg.bpDiastolic),
        temperatureC: num(pg.temperatureC),
        notes: text(pg.notes),
      });

      setNotice('Partograph reading recorded.');
      setPg({
        recordedAt: '',
        cervicalDilatationCm: '',
        descentStation: '',
        contractionsPer10Min: '',
        contractionDurationSec: '',
        fetalHeartRateBpm: '',
        membranes: '',
        liquor: '',
        maternalPulseBpm: '',
        bpSystolic: '',
        bpDiastolic: '',
        temperatureC: '',
        notes: '',
      });

      await refreshLabour(selectedLabour.id);
      await loadAll();
    }, 'The partograph reading could not be recorded.');
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
      <section className="overflow-hidden rounded-xl border border-hair bg-surface">
        <div className="flex items-center justify-between border-b border-hair bg-canvas px-4 py-3">
          <h2 className="text-sm font-bold text-slate-800">Labour ward</h2>
          <button
            type="button"
            onClick={() => setLabourOpen((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
          >
            <Plus className="h-3.5 w-3.5" />
            Admit
          </button>
        </div>

        {labourOpen && (
          <form onSubmit={submitLabour} className="space-y-2 border-b border-hair p-4">
            <Field label="Pregnancy *">
              <select
                required
                value={labourForm.pregnancyId}
                onChange={(e) => setLabourForm({ ...labourForm, pregnancyId: e.target.value })}
                className={fieldClass}
              >
                <option value="">Select a booked pregnancy</option>
                {activePregnancies.map((pregnancy) => (
                  <option key={pregnancy.id} value={pregnancy.id}>
                    {pregnancy.patient ? patientName(pregnancy.patient) : `#${pregnancy.patientId}`}{' '}
                    · EDD {pregnancy.eddDate}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Admitted at">
              <input
                type="datetime-local"
                value={labourForm.admittedAt}
                onChange={(e) => setLabourForm({ ...labourForm, admittedAt: e.target.value })}
                className={fieldClass}
              />
            </Field>
            <Field label="Labour onset">
              <input
                type="datetime-local"
                value={labourForm.labourOnsetAt}
                onChange={(e) => setLabourForm({ ...labourForm, labourOnsetAt: e.target.value })}
                className={fieldClass}
              />
            </Field>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Open labour record'}
            </button>
          </form>
        )}

        <ul className="divide-y divide-slate-100">
          {labours.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-slate-500">Nobody is in labour.</li>
          )}
          {labours.map((labour) => (
            <li key={labour.id}>
              <button
                type="button"
                onClick={() =>
                  void runAction(
                    () => refreshLabour(labour.id),
                    'The labour record could not be opened.',
                  )
                }
                className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${
                  selectedLabour?.id === labour.id ? 'bg-teal-50' : ''
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900">
                    {labour.patient ? patientName(labour.patient) : `Patient #${labour.patientId}`}
                  </span>
                  <span className={statusClass(labour.status)}>{labour.status}</span>
                </div>
                <div className="mt-1 font-mono text-2xs text-slate-500">
                  Admitted {labour.admittedAt.replace('T', ' ').slice(0, 16)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-hair bg-surface p-4">
        {!selectedLabour ? (
          <p className="text-sm text-slate-500">
            Select a woman in labour to see and extend the partograph.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  {selectedLabour.patient
                    ? patientName(selectedLabour.patient)
                    : `Labour #${selectedLabour.id}`}
                </h2>
                <p className="mt-1 font-mono text-2xs text-slate-500">
                  Admitted {selectedLabour.admittedAt.replace('T', ' ').slice(0, 16)}
                  {selectedLabour.labourOnsetAt
                    ? ` · onset ${selectedLabour.labourOnsetAt.replace('T', ' ').slice(0, 16)}`
                    : ''}
                </p>
              </div>
              <span className={statusClass(selectedLabour.status)}>{selectedLabour.status}</span>
            </div>

            {selectedLabour.guidance && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  selectedLabour.guidance.zone === 'Right of the action line'
                    ? 'border-rose-200 bg-rose-50 text-rose-900'
                    : selectedLabour.guidance.zone === 'Between the alert and action lines'
                      ? 'border-amber-200 bg-amber-50 text-amber-900'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                <strong>{selectedLabour.guidance.zone}</strong>
                {selectedLabour.guidance.hoursBeyondAlert !== null &&
                  selectedLabour.guidance.hoursBeyondAlert > 0 && (
                    <span className="ml-2">
                      {selectedLabour.guidance.hoursBeyondAlert}h beyond the alert line
                    </span>
                  )}
                <p className="mt-1 text-2xs opacity-80">{selectedLabour.guidance.note}</p>
              </div>
            )}

            {selectedLabour.status === 'In Labour' && (
              <form
                onSubmit={submitPartograph}
                className="space-y-2 rounded-lg border border-slate-200 p-3"
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Field label="Reading time">
                    <input
                      type="datetime-local"
                      value={pg.recordedAt}
                      onChange={(e) => setPg({ ...pg, recordedAt: e.target.value })}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="Dilatation (cm)">
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      max={10}
                      value={pg.cervicalDilatationCm}
                      onChange={(e) => setPg({ ...pg, cervicalDilatationCm: e.target.value })}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="Descent (−3…+3)">
                    <input
                      type="number"
                      min={-3}
                      max={3}
                      value={pg.descentStation}
                      onChange={(e) => setPg({ ...pg, descentStation: e.target.value })}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="Contractions /10 min">
                    <input
                      type="number"
                      min={0}
                      max={7}
                      value={pg.contractionsPer10Min}
                      onChange={(e) => setPg({ ...pg, contractionsPer10Min: e.target.value })}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="Duration (s)">
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={pg.contractionDurationSec}
                      onChange={(e) => setPg({ ...pg, contractionDurationSec: e.target.value })}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="FHR">
                    <input
                      type="number"
                      value={pg.fetalHeartRateBpm}
                      onChange={(e) => setPg({ ...pg, fetalHeartRateBpm: e.target.value })}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="Membranes">
                    <select
                      value={pg.membranes}
                      onChange={(e) => setPg({ ...pg, membranes: e.target.value })}
                      className={fieldClass}
                    >
                      <option value="">Not recorded</option>
                      <option value="Intact">Intact</option>
                      <option value="Ruptured">Ruptured</option>
                    </select>
                  </Field>
                  <Field label="Liquor">
                    <select
                      value={pg.liquor}
                      onChange={(e) => setPg({ ...pg, liquor: e.target.value })}
                      className={fieldClass}
                    >
                      <option value="">Not recorded</option>
                      {[
                        'Clear',
                        'Meconium I',
                        'Meconium II',
                        'Meconium III',
                        'Bloody',
                        'Absent',
                      ].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Maternal pulse">
                    <input
                      type="number"
                      value={pg.maternalPulseBpm}
                      onChange={(e) => setPg({ ...pg, maternalPulseBpm: e.target.value })}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="BP systolic">
                    <input
                      type="number"
                      value={pg.bpSystolic}
                      onChange={(e) => setPg({ ...pg, bpSystolic: e.target.value })}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="BP diastolic">
                    <input
                      type="number"
                      value={pg.bpDiastolic}
                      onChange={(e) => setPg({ ...pg, bpDiastolic: e.target.value })}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="Temp (°C)">
                    <input
                      type="number"
                      step="0.1"
                      value={pg.temperatureC}
                      onChange={(e) => setPg({ ...pg, temperatureC: e.target.value })}
                      className={fieldClass}
                    />
                  </Field>
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Add partograph reading'}
                </button>
              </form>
            )}

            {selectedLabour.plot && <PartographChart plot={selectedLabour.plot} />}

            <div className="overflow-x-auto">
              <DataTable className="w-full text-left text-2xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-medium">Time</th>
                    <th className="px-2 py-2 font-medium">Dilat.</th>
                    <th className="px-2 py-2 font-medium">Descent</th>
                    <th className="px-2 py-2 font-medium">Contr.</th>
                    <th className="px-2 py-2 font-medium">FHR</th>
                    <th className="px-2 py-2 font-medium">Liquor</th>
                    <th className="px-2 py-2 font-medium">BP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {(selectedLabour.entries ?? []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-2 py-4 text-center font-sans text-slate-500">
                        No partograph readings yet.
                      </td>
                    </tr>
                  )}
                  {(selectedLabour.entries ?? []).map((entry: PartographEntry) => (
                    <tr key={entry.id}>
                      <td className="px-2 py-1.5">
                        {entry.recordedAt.replace('T', ' ').slice(5, 16)}
                      </td>
                      <td className="px-2 py-1.5">{entry.cervicalDilatationCm ?? '—'}</td>
                      <td className="px-2 py-1.5">{entry.descentStation ?? '—'}</td>
                      <td className="px-2 py-1.5">
                        {entry.contractionsPer10Min ?? '—'}
                        {entry.contractionDurationSec ? `/${entry.contractionDurationSec}s` : ''}
                      </td>
                      <td className="px-2 py-1.5">{entry.fetalHeartRateBpm ?? '—'}</td>
                      <td className="px-2 py-1.5">{entry.liquor ?? '—'}</td>
                      <td className="px-2 py-1.5">
                        {entry.bpSystolic && entry.bpDiastolic
                          ? `${entry.bpSystolic}/${entry.bpDiastolic}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>

            <button
              type="button"
              onClick={() =>
                onStartDeliveryFromLabour(selectedLabour.pregnancyId, selectedLabour.id)
              }
              className="w-full rounded-lg border border-teal-700 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-900 hover:bg-teal-100"
            >
              Record the delivery for this labour →
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
