import React, { useMemo, useState } from 'react';
import { Syringe } from 'lucide-react';

import {
  api,
  type ImmunisationAntigen,
  type ImmunisationCard,
  type ImmunisationDueRow,
} from '../../../api/client.ts';
import type { Patient } from '../../../types/index.ts';
import {
  Field,
  doseStatusClass,
  fieldClass,
  isUnderFive,
  num,
  patientName,
  text,
  todayIso,
  type RunMaternityAction,
} from './shared.tsx';

export interface ImmunisationSectionProps {
  patients: Patient[];
  immunisationSchedule: ImmunisationAntigen[];
  immunisationDue: ImmunisationDueRow[];
  immunisationAsOf: string | null;
  immunisationNote: string | null;
  immunisationCard: ImmunisationCard | null;
  loadImmunisationCard: (patientId: number) => Promise<void>;
  refreshImmunisationDue: () => Promise<void>;
  busy: boolean;
  runAction: RunMaternityAction;
  setNotice: (message: string | null) => void;
}

export const ImmunisationSection: React.FC<ImmunisationSectionProps> = ({
  patients,
  immunisationSchedule,
  immunisationDue,
  immunisationAsOf,
  immunisationNote,
  immunisationCard,
  loadImmunisationCard,
  refreshImmunisationDue,
  busy,
  runAction,
  setNotice,
}) => {
  const [immunisationOpen, setImmunisationOpen] = useState(false);
  const [imm, setImm] = useState({
    antigenCode: '',
    doseNumber: '1',
    administeredOn: todayIso(),
    batchNumber: '',
    site: '',
    notes: '',
  });

  const underFivePatients = useMemo(
    () => patients.filter((patient) => isUnderFive(patient)),
    [patients],
  );

  const submitImmunisation = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!immunisationCard) return;

    const patientId = immunisationCard.patient.id;
    const antigen = immunisationSchedule.find((candidate) => candidate.code === imm.antigenCode);

    await runAction(async () => {
      const created = await api.recordImmunisation({
        patientId,
        antigenCode: imm.antigenCode,
        doseNumber: num(imm.doseNumber),
        administeredOn: imm.administeredOn,
        batchNumber: text(imm.batchNumber),
        site: text(imm.site),
        route: antigen?.route,
        notes: text(imm.notes),
      });

      setNotice(
        `${created.antigenCode} dose ${created.doseNumber} recorded on ${created.administeredOn}.`,
      );

      setImmunisationOpen(false);
      setImm({
        antigenCode: '',
        doseNumber: '1',
        administeredOn: todayIso(),
        batchNumber: '',
        site: '',
        notes: '',
      });

      await loadImmunisationCard(patientId);
      await refreshImmunisationDue();
    }, 'The dose could not be recorded.');
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
      <section className="overflow-hidden rounded-xl border border-hair bg-surface">
        <div className="flex items-center justify-between border-b border-hair bg-canvas px-4 py-3">
          <h2 className="text-sm font-bold text-slate-800">Doses outstanding</h2>
          <span className="text-2xs text-slate-500">
            {immunisationAsOf ? `as of ${immunisationAsOf}` : '—'}
          </span>
        </div>

        <div className="border-b border-hair p-4">
          <Field label="Open a child's card">
            <select
              value={immunisationCard?.patient.id ?? ''}
              onChange={(e) =>
                void runAction(
                  () => loadImmunisationCard(Number(e.target.value)),
                  'The immunisation card could not be opened.',
                )
              }
              className={fieldClass}
            >
              <option value="">Select a child under five</option>
              {underFivePatients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patientName(patient)} · {patient.mrn} · {patient.dateOfBirth}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <ul className="divide-y divide-slate-100">
          {immunisationDue.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-slate-500">
              No child at this facility has a dose due.
            </li>
          )}

          {immunisationDue.map((child) => (
            <li key={child.id}>
              <button
                type="button"
                onClick={() =>
                  void runAction(
                    () => loadImmunisationCard(child.id),
                    'The immunisation card could not be opened.',
                  )
                }
                className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${
                  immunisationCard?.patient.id === child.id ? 'bg-teal-50' : ''
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900">{patientName(child)}</span>
                  {child.overdueCount > 0 ? (
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-2xs font-semibold text-rose-800">
                      {child.overdueCount} overdue
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-2xs font-semibold text-amber-900">
                      {child.outstandingCount} due
                    </span>
                  )}
                </div>
                <div className="mt-1 font-mono text-2xs text-slate-500">
                  {child.mrn} · born {child.dateOfBirth}
                  {child.nextDue ? ` · next ${child.nextDue.name}` : ''}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-hair bg-surface p-4">
        {!immunisationCard ? (
          <p className="text-sm text-slate-500">
            Select a child on the left to see the doses given and what the reference schedule says
            is outstanding.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  {patientName(immunisationCard.patient)}
                </h2>
                <p className="mt-1 font-mono text-2xs text-slate-500">
                  {immunisationCard.patient.mrn} · born{' '}
                  {immunisationCard.dateOfBirth ?? 'not recorded'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setImmunisationOpen((open) => !open)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
              >
                <Syringe className="h-3.5 w-3.5" />
                Record dose
              </button>
            </div>

            {immunisationCard.dateOfBirth === null && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {immunisationCard.note}
              </div>
            )}

            {immunisationOpen && (
              <form
                onSubmit={submitImmunisation}
                className="space-y-2 rounded-lg border border-slate-200 p-3"
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Field label="Antigen *">
                    <select
                      required
                      value={imm.antigenCode}
                      onChange={(e) => setImm({ ...imm, antigenCode: e.target.value })}
                      className={fieldClass}
                    >
                      <option value="">Select an antigen</option>
                      {immunisationSchedule.map((antigen) => (
                        <option key={antigen.code} value={antigen.code}>
                          {antigen.name} · {antigen.weeks}w · {antigen.route}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Dose number">
                    <select
                      value={imm.doseNumber}
                      onChange={(e) => setImm({ ...imm, doseNumber: e.target.value })}
                      className={fieldClass}
                    >
                      {[1, 2, 3, 4].map((dose) => (
                        <option key={dose} value={dose}>
                          {dose}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Date given *">
                    <input
                      required
                      type="date"
                      value={imm.administeredOn}
                      onChange={(e) => setImm({ ...imm, administeredOn: e.target.value })}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="Batch">
                    <input
                      type="text"
                      value={imm.batchNumber}
                      onChange={(e) => setImm({ ...imm, batchNumber: e.target.value })}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="Site">
                    <input
                      type="text"
                      value={imm.site}
                      onChange={(e) => setImm({ ...imm, site: e.target.value })}
                      className={fieldClass}
                      placeholder="e.g. Left thigh"
                    />
                  </Field>
                  <Field label="Notes">
                    <input
                      type="text"
                      value={imm.notes}
                      onChange={(e) => setImm({ ...imm, notes: e.target.value })}
                      className={fieldClass}
                    />
                  </Field>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Record dose'}
                </button>

                <p className="text-2xs text-slate-500">
                  The database refuses a second dose of the same antigen at the same dose number.
                </p>
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-2xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Antigen</th>
                    <th className="px-3 py-2 font-medium">Scheduled</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Given on</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {immunisationCard.statuses.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                        Due dates need a date of birth. Doses can still be recorded below.
                      </td>
                    </tr>
                  )}

                  {immunisationCard.statuses.map((dose) => (
                    <tr key={dose.antigenCode} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2">
                        <span className="font-semibold text-slate-800">{dose.name}</span>
                        {dose.note && (
                          <span className="ml-1.5 text-2xs text-slate-500">{dose.note}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-2xs text-slate-600">
                        week {dose.scheduledWeeks}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${doseStatusClass(dose.status)}`}
                        >
                          {dose.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-2xs text-slate-600">
                        {dose.givenOn ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-2xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Given</th>
                    <th className="px-3 py-2 font-medium">Antigen</th>
                    <th className="px-3 py-2 font-medium">Dose</th>
                    <th className="px-3 py-2 font-medium">Batch</th>
                    <th className="px-3 py-2 font-medium">Site</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {immunisationCard.records.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                        No doses recorded for this child yet.
                      </td>
                    </tr>
                  )}

                  {immunisationCard.records.map((record) => (
                    <tr key={record.id} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2 font-mono text-slate-700">
                        {record.administeredOn}
                      </td>
                      <td className="px-3 py-2 font-semibold text-slate-800">
                        {record.antigenCode}
                      </td>
                      <td className="px-3 py-2 font-mono">{record.doseNumber}</td>
                      <td className="px-3 py-2 font-mono text-2xs text-slate-600">
                        {record.batchNumber ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-2xs text-slate-600">{record.site ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-2xs leading-relaxed text-slate-500">{immunisationNote}</p>
          </div>
        )}
      </section>
    </div>
  );
};
