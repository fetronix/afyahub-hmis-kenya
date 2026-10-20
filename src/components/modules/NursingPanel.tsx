import React, { useCallback, useEffect, useState } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import {
  Admission,
  InpatientBoard,
  NursingNote,
  Patient,
  ShiftHandover,
  VitalObservation,
} from '../../types/index.ts';
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Clock,
  HeartPulse,
  Plus,
  Stethoscope,
  Users,
} from 'lucide-react';

type NursingTab = 'vitals' | 'notes' | 'handover';

const SHIFTS = ['Morning', 'Afternoon', 'Night'] as const;

const NOTE_TYPES = [
  'Progress',
  'Observation',
  'Handover',
  'Medication',
  'Incident',
] as const;

const EMPTY_VITALS = {
  systolicBp: '',
  diastolicBp: '',
  pulseRate: '',
  temperatureC: '',
  respiratoryRate: '',
  spo2Percent: '',
  weightKg: '',
  heightCm: '',
  bloodGlucoseMmol: '',
};

function currentShiftName(): string {
  const hour = new Date().getHours();

  if (hour >= 7 && hour < 15) return 'Morning';
  if (hour >= 15 && hour < 20) return 'Afternoon';

  return 'Night';
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';

  const then = new Date(iso).getTime();

  if (Number.isNaN(then)) return 'unknown';

  const minutes = Math.floor((Date.now() - then) / 60000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Compact vitals summary used in the history list. */
function vitalsSummary(observation: VitalObservation): string {
  const parts: string[] = [];

  if (observation.systolicBp && observation.diastolicBp) {
    parts.push(`BP ${observation.systolicBp}/${observation.diastolicBp}`);
  }
  if (observation.pulseRate) parts.push(`P ${observation.pulseRate}`);
  if (observation.temperatureC) parts.push(`T ${observation.temperatureC}°C`);
  if (observation.respiratoryRate) parts.push(`RR ${observation.respiratoryRate}`);
  if (observation.spo2Percent) parts.push(`SpO2 ${observation.spo2Percent}%`);
  if (observation.bloodGlucoseMmol) {
    parts.push(`Glu ${observation.bloodGlucoseMmol}`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'No measured values';
}

export interface NursingPanelProps {
  admissions: Admission[];
  patients: Patient[];
  board: InpatientBoard | null;
  onRefresh: () => void;
}

/**
 * Nursing & bedside care.
 *
 * Covers ward vitals, append-only nursing notes and the shift handover
 * view. All reads and writes are facility-scoped server-side.
 */
export const NursingPanel: React.FC<NursingPanelProps> = ({
  admissions,
  patients,
  board,
  onRefresh,
}) => {
  const { showToast, currentUser } = useHmis();

  const [tab, setTab] = useState<NursingTab>('vitals');
  const [admissionId, setAdmissionId] = useState<number | null>(null);

  const [vitals, setVitals] = useState({ ...EMPTY_VITALS });
  const [vitalsHistory, setVitalsHistory] = useState<VitalObservation[]>([]);
  const [vitalsLoading, setVitalsLoading] = useState(false);
  const [savingVitals, setSavingVitals] = useState(false);

  const [notes, setNotes] = useState<NursingNote[]>([]);
  const [noteText, setNoteText] = useState('');
  const [noteType, setNoteType] = useState<string>('Progress');
  const [noteShift, setNoteShift] = useState<string>(currentShiftName());
  const [savingNote, setSavingNote] = useState(false);

  const [handover, setHandover] = useState<ShiftHandover | null>(null);
  const [handoverDate, setHandoverDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [handoverLoading, setHandoverLoading] = useState(false);

  /* Default to the first active admission. */
  useEffect(() => {
    if (admissionId === null && admissions.length > 0) {
      setAdmissionId(admissions[0].id);
    }

    if (
      admissionId !== null &&
      !admissions.some((admission) => admission.id === admissionId)
    ) {
      setAdmissionId(admissions.length > 0 ? admissions[0].id : null);
    }
  }, [admissions, admissionId]);

  const patientName = useCallback(
    (patientId: number) => {
      const patient = patients.find((entry) => entry.id === patientId);

      return patient
        ? `${patient.firstName} ${patient.lastName}`
        : `Patient #${patientId}`;
    },
    [patients],
  );

  const loadVitals = useCallback(async () => {
    if (admissionId === null) {
      setVitalsHistory([]);
      return;
    }

    setVitalsLoading(true);

    try {
      setVitalsHistory(await api.getAdmissionVitals(admissionId));
    } catch (error: any) {
      showToast(`Could not load vitals: ${error.message}`);
      setVitalsHistory([]);
    } finally {
      setVitalsLoading(false);
    }
  }, [admissionId, showToast]);

  const loadNotes = useCallback(async () => {
    if (admissionId === null) {
      setNotes([]);
      return;
    }

    try {
      setNotes(await api.getNursingNotes({ admissionId }));
    } catch (error: any) {
      showToast(`Could not load nursing notes: ${error.message}`);
      setNotes([]);
    }
  }, [admissionId, showToast]);

  const loadHandover = useCallback(async () => {
    setHandoverLoading(true);

    try {
      setHandover(await api.getShiftHandover(handoverDate));
    } catch (error: any) {
      showToast(`Could not load handover: ${error.message}`);
      setHandover(null);
    } finally {
      setHandoverLoading(false);
    }
  }, [handoverDate, showToast]);

  useEffect(() => {
    if (tab === 'vitals') void loadVitals();
    if (tab === 'notes') void loadNotes();
    if (tab === 'handover') void loadHandover();
  }, [tab, loadVitals, loadNotes, loadHandover]);

  const selectedAdmission = admissions.find(
    (admission) => admission.id === admissionId,
  );

  const handleSaveVitals = async (event: React.FormEvent) => {
    event.preventDefault();

    if (admissionId === null) {
      showToast('Select an admitted patient first.');
      return;
    }

    const payload: Record<string, unknown> = {};

    for (const [key, raw] of Object.entries(vitals)) {
      if (String(raw).trim() !== '') {
        payload[key] = String(raw).trim();
      }
    }

    if (Object.keys(payload).length === 0) {
      showToast('Enter at least one measured value before saving.');
      return;
    }

    setSavingVitals(true);

    try {
      const saved = await api.recordWardVitals(admissionId, {
        ...(payload as any),
        recordedBy: currentUser?.name,
      });

      const critical = (saved.flags ?? []).filter(
        (flag) => flag.severity === 'critical',
      );

      if (critical.length > 0) {
        showToast(
          `Vitals saved — CRITICAL: ${critical
            .map((flag) => `${flag.label} ${flag.value}`)
            .join(', ')}`,
        );
      } else if ((saved.flags ?? []).length > 0) {
        showToast(
          `Vitals saved with ${saved.flags?.length} flagged value(s).`,
        );
      } else {
        showToast('Vitals saved.');
      }

      setVitals({ ...EMPTY_VITALS });
      await loadVitals();
      onRefresh();
    } catch (error: any) {
      showToast(`Could not save vitals: ${error.message}`);
    } finally {
      setSavingVitals(false);
    }
  };

  const handleSaveNote = async (event: React.FormEvent) => {
    event.preventDefault();

    if (admissionId === null) {
      showToast('Select an admitted patient first.');
      return;
    }

    if (!noteText.trim()) {
      showToast('Write the nursing note before saving.');
      return;
    }

    setSavingNote(true);

    try {
      await api.createNursingNote({
        admissionId,
        patientId: selectedAdmission?.patientId ?? 0,
        noteType,
        shift: noteShift,
        note: noteText.trim(),
        recordedBy: currentUser?.name,
      });

      showToast('Nursing note recorded.');
      setNoteText('');
      await loadNotes();
      onRefresh();
    } catch (error: any) {
      showToast(`Could not save note: ${error.message}`);
    } finally {
      setSavingNote(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 border border-slate-200 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-600';

  const tabButton = (id: NursingTab, label: string, Icon: typeof Activity) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
        tab === id
          ? 'bg-teal-700 text-white shadow-xs'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );

  const boardRow = board?.rows.find((row) => row.admissionId === admissionId);

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
            <HeartPulse className="w-4 h-4 text-teal-700" />
            Nursing &amp; Bedside Care
          </h2>
          <p className="text-2xs text-slate-500 mt-0.5">
            Vitals, nursing notes and shift handover for admitted patients.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tabButton('vitals', 'Vitals', Activity)}
          {tabButton('notes', 'Notes', ClipboardList)}
          {tabButton('handover', 'Handover', Users)}
        </div>
      </div>

      {/* Admission selector */}
      {tab !== 'handover' && (
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3 bg-white">
          <label className="text-2xs font-semibold text-slate-600 uppercase tracking-wider">
            Patient
          </label>
          <select
            value={admissionId ?? ''}
            onChange={(event) => setAdmissionId(Number(event.target.value))}
            className="flex-1 px-3 py-2 border border-slate-200 rounded-md text-xs"
          >
            {admissions.length === 0 && (
              <option value="">No active admissions</option>
            )}
            {admissions.map((admission) => (
              <option key={admission.id} value={admission.id}>
                {patientName(admission.patientId)} — Bed {admission.bedId} ·{' '}
                {admission.admissionDate}
              </option>
            ))}
          </select>

          {boardRow && (
            <div className="flex items-center gap-2 text-2xs">
              <span
                className={`px-2 py-1 rounded font-semibold ${
                  boardRow.vitalsOverdue
                    ? 'bg-orange-100 text-orange-900'
                    : 'bg-emerald-100 text-emerald-900'
                }`}
              >
                <Clock className="w-3 h-3 inline mr-1" />
                Vitals {timeAgo(boardRow.lastVitalsAt)}
              </span>
              {boardRow.notesToday > 0 && (
                <span className="px-2 py-1 rounded bg-slate-100 text-slate-700 font-semibold">
                  {boardRow.notesToday} note{boardRow.notesToday === 1 ? '' : 's'} today
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------------- VITALS ---------------- */}
      {tab === 'vitals' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
          <form onSubmit={handleSaveVitals} className="p-5 space-y-3">
            <h3 className="text-2xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              Record observation
            </h3>

            <div className="grid grid-cols-2 gap-3">
              {[
                ['systolicBp', 'Systolic BP', 'mmHg'],
                ['diastolicBp', 'Diastolic BP', 'mmHg'],
                ['pulseRate', 'Pulse', 'bpm'],
                ['temperatureC', 'Temperature', '°C'],
                ['respiratoryRate', 'Respiratory rate', '/min'],
                ['spo2Percent', 'SpO2', '%'],
                ['weightKg', 'Weight', 'kg'],
                ['heightCm', 'Height', 'cm'],
                ['bloodGlucoseMmol', 'Blood glucose', 'mmol/L'],
              ].map(([key, label, unit]) => (
                <div key={key}>
                  <label className="block text-2xs font-medium text-slate-600 mb-1">
                    {label} <span className="text-slate-400">({unit})</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={(vitals as Record<string, string>)[key]}
                    onChange={(event) =>
                      setVitals((prev) => ({
                        ...prev,
                        [key]: event.target.value,
                      }))
                    }
                    placeholder="—"
                    className={inputClass}
                  />
                </div>
              ))}
            </div>

            <p className="text-3xs text-slate-500 leading-relaxed">
              Leave a field blank if it was not measured — blank values are
              never replaced with defaults. BMI is calculated when weight and
              height are both supplied.
            </p>

            <button
              type="submit"
              disabled={savingVitals || admissionId === null}
              className="w-full px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <Activity className="w-3.5 h-3.5" />
              {savingVitals ? 'Saving…' : 'Save vitals'}
            </button>
          </form>

          <div className="p-5">
            <h3 className="text-2xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 mb-3">
              <Clock className="w-3.5 h-3.5" />
              Observation history
            </h3>

            {vitalsLoading ? (
              <p className="text-2xs text-slate-500">Loading…</p>
            ) : vitalsHistory.length === 0 ? (
              <p className="text-2xs text-slate-500">
                No observations recorded for this patient yet.
              </p>
            ) : (
              <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {vitalsHistory.map((observation) => {
                  const flags = observation.flags ?? [];
                  const critical = flags.some(
                    (flag) => flag.severity === 'critical',
                  );

                  return (
                    <li
                      key={observation.id}
                      className={`p-2.5 rounded-lg border text-2xs ${
                        critical
                          ? 'border-rose-300 bg-rose-50'
                          : flags.length > 0
                            ? 'border-amber-300 bg-amber-50'
                            : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-slate-900">
                          {vitalsSummary(observation)}
                        </span>
                        <span className="text-3xs text-slate-500 whitespace-nowrap">
                          {formatTime(observation.recordedAt)}
                        </span>
                      </div>

                      {observation.bmi && (
                        <div className="text-3xs text-slate-500 mt-0.5">
                          BMI {observation.bmi}
                        </div>
                      )}

                      {flags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {flags.map((flag) => (
                            <span
                              key={`${observation.id}-${flag.field}`}
                              className={`px-1.5 py-0.5 rounded text-3xs font-semibold ${
                                flag.severity === 'critical'
                                  ? 'bg-rose-600 text-white'
                                  : 'bg-amber-200 text-amber-900'
                              }`}
                            >
                              {flag.label} {flag.direction === 'high' ? '↑' : '↓'}{' '}
                              {flag.value}
                            </span>
                          ))}
                        </div>
                      )}

                      {observation.recordedBy && (
                        <div className="text-3xs text-slate-400 mt-1">
                          {observation.recordedBy}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ---------------- NOTES ---------------- */}
      {tab === 'notes' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
          <form onSubmit={handleSaveNote} className="p-5 space-y-3">
            <h3 className="text-2xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5" />
              New nursing note
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-2xs font-medium text-slate-600 mb-1">
                  Note type
                </label>
                <select
                  value={noteType}
                  onChange={(event) => setNoteType(event.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md text-xs"
                >
                  {NOTE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-2xs font-medium text-slate-600 mb-1">
                  Shift
                </label>
                <select
                  value={noteShift}
                  onChange={(event) => setNoteShift(event.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md text-xs"
                >
                  {SHIFTS.map((shift) => (
                    <option key={shift} value={shift}>
                      {shift}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-2xs font-medium text-slate-600 mb-1">
                Note
              </label>
              <textarea
                rows={6}
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                placeholder="Patient observations, care given, response to treatment…"
                className="w-full px-3 py-2 border border-slate-200 rounded-md text-xs resize-y focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-600"
              />
            </div>

            <p className="text-3xs text-slate-500">
              Notes are append-only: saved notes cannot be edited or deleted, so
              the care record stays auditable.
            </p>

            <button
              type="submit"
              disabled={savingNote || admissionId === null}
              className="w-full px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <Stethoscope className="w-3.5 h-3.5" />
              {savingNote ? 'Saving…' : 'Save note'}
            </button>
          </form>

          <div className="p-5">
            <h3 className="text-2xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 mb-3">
              <Clock className="w-3.5 h-3.5" />
              Recent notes ({notes.length})
            </h3>

            {notes.length === 0 ? (
              <p className="text-2xs text-slate-500">
                No nursing notes recorded for this admission.
              </p>
            ) : (
              <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {notes.map((note) => (
                  <li
                    key={note.id}
                    className="p-2.5 rounded-lg border border-slate-200 bg-white text-2xs"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold text-3xs">
                        {note.noteType}
                      </span>
                      <span className="text-3xs text-slate-500">
                        {note.shift ? `${note.shift} · ` : ''}
                        {formatTime(note.recordedAt)}
                      </span>
                    </div>
                    <p className="text-slate-800 whitespace-pre-wrap">{note.note}</p>
                    <div className="text-3xs text-slate-400 mt-1">
                      {note.recordedBy}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ---------------- HANDOVER ---------------- */}
      {tab === 'handover' && (
        <div className="p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="text-2xs font-semibold text-slate-600 uppercase tracking-wider">
              Handover date
            </label>
            <input
              type="date"
              value={handoverDate}
              onChange={(event) => setHandoverDate(event.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-md text-xs font-mono"
            />
            <button
              onClick={() => void loadHandover()}
              className="px-3 py-2 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors"
            >
              Refresh
            </button>
            {handover && (
              <span className="text-2xs text-slate-500">
                {handover.total} note{handover.total === 1 ? '' : 's'} on{' '}
                {handover.date}
              </span>
            )}
          </div>

          {handoverLoading ? (
            <p className="text-2xs text-slate-500">Loading handover…</p>
          ) : !handover || handover.total === 0 ? (
            <p className="text-2xs text-slate-500">
              No nursing notes were recorded on {handoverDate}.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {handover.groups.map((group) => (
                <div
                  key={group.shift}
                  className={`rounded-xl border p-3 ${
                    group.shift === currentShiftName()
                      ? 'border-teal-300 bg-teal-50/40'
                      : 'border-slate-200 bg-slate-50/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-2xs font-bold text-slate-800 uppercase tracking-wider">
                      {group.shift}
                    </h4>
                    <span className="text-3xs font-mono px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                      {group.noteCount}
                    </span>
                  </div>

                  {group.notes.length === 0 ? (
                    <p className="text-3xs text-slate-400">No notes.</p>
                  ) : (
                    <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {group.notes.map((note) => (
                        <li
                          key={note.id}
                          className="p-2 rounded-lg bg-white border border-slate-200 text-2xs"
                        >
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="font-semibold text-slate-800 truncate">
                              {patientName(note.patientId)}
                            </span>
                            <span className="text-3xs text-slate-400 whitespace-nowrap">
                              {formatTime(note.recordedAt)}
                            </span>
                          </div>
                          <span className="text-3xs text-slate-500">
                            {note.noteType}
                          </span>
                          <p className="text-slate-700 whitespace-pre-wrap mt-0.5">
                            {note.note}
                          </p>
                          <div className="text-3xs text-slate-400 mt-1">
                            {note.recordedBy}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Overdue banner */}
      {tab !== 'handover' &&
        board &&
        board.vitalsOverdueCount > 0 && (
          <div className="px-5 py-2.5 border-t border-orange-200 bg-orange-50 flex items-center gap-2 text-2xs text-orange-900">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>
              <strong>{board.vitalsOverdueCount}</strong> admitted patient
              {board.vitalsOverdueCount === 1 ? '' : 's'} have no vitals recorded
              in the last 8 hours
              {board.criticalVitalsCount > 0 && (
                <>
                  {' '}
                  · <strong>{board.criticalVitalsCount}</strong> with critical
                  observations
                </>
              )}
              .
            </span>
          </div>
        )}
    </div>
  );
};
