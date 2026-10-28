import React, { useState } from 'react';
import { Plus } from 'lucide-react';

import {
  api,
  type MaternityPregnancy,
  type MaternityPregnancyDetail,
} from '../../../api/client.ts';
import type { Patient } from '../../../types/index.ts';
import { AncVisitsPanel } from './AncVisitsPanel.tsx';
import {
  fieldClass,
  formatGestation,
  labelClass,
  num,
  patientName,
  statusClass,
  text,
  todayIso,
  type RunMaternityAction,
} from './shared.tsx';

export interface AncRegisterSectionProps {
  facilityId: number | undefined;
  patients: Patient[];
  pregnancies: MaternityPregnancy[];
  selectedPregnancy: MaternityPregnancyDetail | null;
  busy: boolean;
  runAction: RunMaternityAction;
  loadAll: () => Promise<void>;
  refreshPregnancy: (pregnancyId: number) => Promise<void>;
  setNotice: (message: string | null) => void;
  showToast: (message: string) => void;
}

export const AncRegisterSection: React.FC<AncRegisterSectionProps> = ({
  facilityId,
  patients,
  pregnancies,
  selectedPregnancy,
  busy,
  runAction,
  loadAll,
  refreshPregnancy,
  setNotice,
  showToast,
}) => {
  const [bookingOpen, setBookingOpen] = useState(false);
  const [booking, setBooking] = useState({
    patientId: '',
    bookedAt: todayIso(),
    lmpDate: '',
    eddDate: '',
    eddBasis: 'LMP',
    gravida: '',
    para: '',
    abortions: '',
    riskFactors: '',
  });

  const submitBooking = async (event: React.FormEvent) => {
    event.preventDefault();

    await runAction(async () => {
      const created = await api.bookPregnancy({
        patientId: num(booking.patientId),
        facilityId,
        bookedAt: booking.bookedAt,
        lmpDate: text(booking.lmpDate),
        eddDate: text(booking.eddDate),
        eddBasis: booking.eddBasis,
        gravida: num(booking.gravida),
        para: num(booking.para),
        abortions: num(booking.abortions),
        riskFactors: text(booking.riskFactors),
      });

      setNotice(
        `Booked ${patientName(patients.find((p) => p.id === created.patientId) ?? { firstName: 'patient', lastName: '' })}. EDD ${created.eddDate}.`,
      );

      setBookingOpen(false);
      setBooking({
        patientId: '',
        bookedAt: todayIso(),
        lmpDate: '',
        eddDate: '',
        eddBasis: 'LMP',
        gravida: '',
        para: '',
        abortions: '',
        riskFactors: '',
      });

      await loadAll();
      await refreshPregnancy(created.id);
      showToast('Pregnancy booked.');
    }, 'The pregnancy could not be booked.');
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="overflow-hidden rounded-xl border border-hair bg-surface">
        <div className="flex items-center justify-between border-b border-hair bg-canvas px-4 py-3">
          <h2 className="text-sm font-bold text-slate-800">Booked pregnancies</h2>
          <button
            type="button"
            onClick={() => setBookingOpen((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ember-500 px-3 py-1.5 text-xs font-bold text-navy-950 shadow-sm hover:bg-ember-400"
          >
            <Plus className="h-3.5 w-3.5" />
            Book pregnancy
          </button>
        </div>

        {bookingOpen && (
          <form onSubmit={submitBooking} className="border-b border-hair p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelClass}>Patient *</label>
                <select
                  required
                  value={booking.patientId}
                  onChange={(event) => setBooking({ ...booking, patientId: event.target.value })}
                  className={fieldClass}
                >
                  <option value="">Select a registered patient</option>
                  {patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patientName(patient)} · {patient.mrn}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>Booked on *</label>
                <input
                  type="date"
                  required
                  value={booking.bookedAt}
                  onChange={(event) => setBooking({ ...booking, bookedAt: event.target.value })}
                  className={fieldClass}
                />
              </div>

              <div>
                <label className={labelClass}>Last menstrual period</label>
                <input
                  type="date"
                  value={booking.lmpDate}
                  onChange={(event) => setBooking({ ...booking, lmpDate: event.target.value })}
                  className={fieldClass}
                />
              </div>

              <div>
                <label className={labelClass}>EDD</label>
                <input
                  type="date"
                  value={booking.eddDate}
                  onChange={(event) => setBooking({ ...booking, eddDate: event.target.value })}
                  className={fieldClass}
                />
                <p className="mt-1 text-2xs text-slate-500">
                  Leave blank with an LMP to derive it (LMP + 280 days).
                </p>
              </div>

              <div>
                <label className={labelClass}>EDD basis</label>
                <select
                  value={booking.eddBasis}
                  onChange={(event) => setBooking({ ...booking, eddBasis: event.target.value })}
                  className={fieldClass}
                >
                  <option value="LMP">LMP</option>
                  <option value="Ultrasound">Ultrasound</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {(['gravida', 'para', 'abortions'] as const).map((field) => (
                <div key={field}>
                  <label className={`${labelClass} capitalize`}>{field}</label>
                  <input
                    type="number"
                    min={0}
                    value={booking[field]}
                    onChange={(event) => setBooking({ ...booking, [field]: event.target.value })}
                    className={fieldClass}
                  />
                </div>
              ))}

              <div className="sm:col-span-2">
                <label className={labelClass}>Risk factors</label>
                <textarea
                  rows={2}
                  value={booking.riskFactors}
                  onChange={(event) => setBooking({ ...booking, riskFactors: event.target.value })}
                  className={fieldClass}
                  placeholder="Free text. Left blank if none were recorded."
                />
              </div>
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBookingOpen(false)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Book pregnancy'}
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 text-2xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Patient</th>
                <th className="px-4 py-2.5 font-medium">Booked</th>
                <th className="px-4 py-2.5 font-medium">EDD</th>
                <th className="px-4 py-2.5 font-medium">Gestation</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pregnancies.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No pregnancies booked yet.
                  </td>
                </tr>
              )}
              {pregnancies.map((pregnancy) => (
                <tr key={pregnancy.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-slate-900">
                      {pregnancy.patient
                        ? patientName(pregnancy.patient)
                        : `Patient #${pregnancy.patientId}`}
                    </div>
                    <div className="font-mono text-2xs text-slate-500">
                      {pregnancy.patient?.mrn ?? ''}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-600">{pregnancy.bookedAt}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-700">
                    {pregnancy.eddDate}
                    <span className="ml-1 text-2xs text-slate-400">{pregnancy.eddBasis}</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono">{formatGestation(pregnancy.gestation)}</td>
                  <td className="px-4 py-2.5">
                    <span className={statusClass(pregnancy.status)}>{pregnancy.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(
                          () => refreshPregnancy(pregnancy.id),
                          'The pregnancy record could not be opened.',
                        )
                      }
                      className="rounded bg-teal-50 px-2 py-1 text-2xs font-semibold text-teal-800 hover:bg-teal-100"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <AncVisitsPanel
        selectedPregnancy={selectedPregnancy}
        busy={busy}
        runAction={runAction}
        loadAll={loadAll}
        refreshPregnancy={refreshPregnancy}
        setNotice={setNotice}
      />
    </div>
  );
};
