import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarDays, ClipboardList, Plus, RefreshCw } from 'lucide-react';
import { api } from '../../api/client.ts';
import type {
  TheatreHistoryEvent,
  TheatrePractitioner,
  TheatreRoom,
  TheatreRoomState,
  TheatreScheduleReport,
  TheatreScheduledCase,
  TheatreUrgency,
} from '../../api/clients/theatre.client.ts';
import type { Patient } from '../../types/index.ts';
import { useHmis } from '../../context/HmisContext.tsx';

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-100';
const buttonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const emptyForm = () => ({
  patientId: '',
  procedureName: '',
  leadPractitionerId: '',
  urgency: '',
  roomId: '',
  startsAt: '',
  endsAt: '',
  encounterId: '',
  admissionId: '',
  requestKey: crypto.randomUUID(),
});
const localTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const displayTime = (value: string | null) => {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};
const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-semibold text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export const TheatreModule: React.FC = () => {
  const { currentFacility, authenticatedUser, refreshKey } = useHmis();
  const facilityId = currentFacility?.id;
  const scopeRef = useRef(facilityId);
  useLayoutEffect(() => {
    scopeRef.current = facilityId;
  }, [facilityId]);
  const canRead = Boolean(authenticatedUser?.permissions?.includes('theatre.read'));
  const canCreate = Boolean(authenticatedUser?.permissions?.includes('theatre.schedule.create'));
  const canManage = Boolean(authenticatedUser?.permissions?.includes('theatre.schedule.manage'));
  const canRooms = Boolean(authenticatedUser?.permissions?.includes('theatre.rooms.manage'));
  const canReconcile = Boolean(
    authenticatedUser?.permissions?.includes('theatre.schedule.reconcile'),
  );
  const canReports = Boolean(authenticatedUser?.permissions?.includes('theatre.reports.read'));
  const canPatients = Boolean(authenticatedUser?.permissions?.includes('patients.read'));
  const [rooms, setRooms] = useState<TheatreRoom[]>([]);
  const [practitioners, setPractitioners] = useState<TheatrePractitioner[]>([]);
  const [cases, setCases] = useState<TheatreScheduledCase[]>([]);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [version, setVersion] = useState(0);
  const [roomName, setRoomName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [searched, setSearched] = useState(false);
  const [editing, setEditing] = useState<{
    record: TheatreScheduledCase;
    roomId: string;
    startsAt: string;
    endsAt: string;
    reason: string;
  } | null>(null);
  const [history, setHistory] = useState<{ caseId: number; events: TheatreHistoryEvent[] } | null>(
    null,
  );
  const [legacyReview, setLegacyReview] = useState<{
    record: TheatreScheduledCase;
    action: 'NO_ACTIVE_RESERVATION' | 'REVOKED';
    reason: string;
    acknowledged: boolean;
  } | null>(null);
  const [report, setReport] = useState<TheatreScheduleReport | null>(null);
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const historyRequest = useRef(0);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'browser local time';

  useEffect(() => {
    let active = true;
    setRooms([]);
    setCases([]);
    setPractitioners([]);
    setLoadedFor(null);
    setLoadError('');
    setEditing(null);
    setLegacyReview(null);
    setHistory(null);
    setReport(null);
    historyRequest.current += 1;
    if (!facilityId || !canRead) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    Promise.all([
      api.getTheatreRooms(facilityId),
      api.getTheatreSchedule(facilityId),
      api.getTheatrePractitioners(facilityId),
    ])
      .then(([nextRooms, nextCases, nextPractitioners]) => {
        if (!active || scopeRef.current !== facilityId) return;
        setRooms(nextRooms);
        setCases(nextCases);
        setPractitioners(nextPractitioners);
        setLoadedFor(facilityId);
      })
      .catch((err: unknown) => {
        if (active && scopeRef.current === facilityId)
          setLoadError(messageOf(err, 'Unable to load the theatre schedule.'));
      })
      .finally(() => {
        if (active && scopeRef.current === facilityId) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [facilityId, canRead, version, refreshKey]);

  // Never carry a patient, reason, request key or open form into another facility.
  useEffect(() => {
    setShowCreate(false);
    setForm(emptyForm());
    setPatientResults([]);
    setPatientSearch('');
    setSearched(false);
    setRoomName('');
    setReportFrom('');
    setReportTo('');
    setError('');
    setNotice('');
  }, [facilityId]);

  const run = async (action: () => Promise<void>, success: string, reload = true) => {
    if (!facilityId || busyRef.current) return;
    const startedIn = facilityId;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (scopeRef.current !== startedIn) return;
      setNotice(success);
      if (reload) setVersion((n) => n + 1);
    } catch (err: unknown) {
      if (scopeRef.current === startedIn)
        setError(messageOf(err, 'The request could not be completed.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const searchPatients = () => {
    if (!facilityId || !patientSearch.trim() || !canPatients) return;
    const current = facilityId;
    void run(
      async () => {
        const found = await api.getPatients(
          currentFacility?.tenantId,
          current,
          patientSearch.trim(),
        );
        if (scopeRef.current === current) {
          setPatientResults(found);
          setSearched(true);
          setForm((old) => ({ ...old, patientId: '' }));
        }
      },
      'Patient search completed.',
      false,
    );
  };
  const saveBooking = (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !facilityId ||
      !form.patientId ||
      !form.leadPractitionerId ||
      !form.roomId ||
      !form.urgency ||
      !form.startsAt ||
      !form.endsAt
    )
      return;
    const current = facilityId;
    void run(async () => {
      const result = await api.scheduleTheatreCase({
        facilityId: current,
        patientId: Number(form.patientId),
        procedureName: form.procedureName,
        leadPractitionerId: Number(form.leadPractitionerId),
        urgency: form.urgency as TheatreUrgency,
        roomId: Number(form.roomId),
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        requestKey: form.requestKey,
        ...(form.encounterId ? { encounterId: Number(form.encounterId) } : {}),
        ...(form.admissionId ? { admissionId: Number(form.admissionId) } : {}),
      });
      if (scopeRef.current === current) {
        setForm(emptyForm());
        setShowCreate(false);
        setPatientResults([]);
        setPatientSearch('');
        setSearched(false);
      }
      if (result.replayed && scopeRef.current === current)
        setNotice('The existing booking was returned; no duplicate was created.');
    }, 'Booking saved. Clinical readiness has not been established.');
  };
  const createRoom = (event: React.FormEvent) => {
    event.preventDefault();
    if (!facilityId || !roomName.trim()) return;
    const current = facilityId;
    void run(async () => {
      await api.createTheatreRoom(current, roomName.trim());
      if (scopeRef.current === current) setRoomName('');
    }, 'Room created.');
  };
  const setRoomState = (id: number, state: TheatreRoomState) => {
    if (!facilityId) return;
    void run(
      () => api.setTheatreRoomState(facilityId, id, state).then(() => undefined),
      'Room state updated. Existing bookings were not moved.',
    );
  };
  const openEdit = (record: TheatreScheduledCase) => {
    if (!record.booking) return;
    setEditing({
      record,
      roomId: String(record.booking.roomId),
      startsAt: localTime(record.booking.startsAt),
      endsAt: localTime(record.booking.endsAt),
      reason: '',
    });
    setError('');
    setNotice('');
  };
  const reschedule = (event: React.FormEvent) => {
    event.preventDefault();
    if (!facilityId || !editing?.record.booking || !editing.reason.trim()) return;
    const current = facilityId,
      selected = editing;
    void run(async () => {
      await api.rescheduleTheatreCase(selected.record.id, {
        facilityId: current,
        expectedRevision: selected.record.booking!.revision,
        roomId: Number(selected.roomId),
        startsAt: new Date(selected.startsAt).toISOString(),
        endsAt: new Date(selected.endsAt).toISOString(),
        reason: selected.reason.trim(),
      });
      if (scopeRef.current === current) setEditing(null);
    }, 'Booking rescheduled; the change was recorded.');
  };
  const cancel = () => {
    if (!facilityId || !editing?.record.booking) return;
    if (!editing.reason.trim()) {
      setError('Enter a reason before cancelling.');
      return;
    }
    const current = facilityId,
      selected = editing;
    void run(async () => {
      await api.cancelTheatreCase(
        selected.record.id,
        current,
        selected.record.booking!.revision,
        selected.reason.trim(),
      );
      if (scopeRef.current === current) setEditing(null);
    }, 'Booking cancelled; no clinical or financial records were altered.');
  };
  const loadReport = (event: React.FormEvent) => {
    event.preventDefault();
    if (!facilityId || !reportFrom || !reportTo) return;
    const current = facilityId;
    setReport(null);
    void run(
      async () => {
        const data = await api.getTheatreScheduleReport(
          current,
          new Date(reportFrom).toISOString(),
          new Date(reportTo).toISOString(),
        );
        if (scopeRef.current === current) setReport(data);
      },
      'Schedule report loaded.',
      false,
    );
  };
  const saveLegacyReview = (event: React.FormEvent) => {
    event.preventDefault();
    if (!facilityId || !legacyReview || !legacyReview.reason.trim()) return;
    if (legacyReview.action === 'NO_ACTIVE_RESERVATION' && !legacyReview.acknowledged) {
      setError('Confirm that the historical reservation has been reviewed.');
      return;
    }
    const current = facilityId,
      selected = legacyReview;
    void run(
      async () => {
        await api.reviewLegacyTheatreReservation(
          current,
          selected.record.id,
          selected.action,
          selected.reason.trim(),
          selected.acknowledged,
        );
        if (scopeRef.current === current) setLegacyReview(null);
      },
      selected.action === 'REVOKED'
        ? 'Review revoked. Existing bookings were not changed; check them manually.'
        : 'Scheduling-only review recorded; no clinical status was changed.',
    );
  };
  const viewHistory = (id: number) => {
    if (!facilityId) return;
    const current = facilityId;
    const request = ++historyRequest.current;
    setHistory(null);
    setError('');
    void run(
      async () => {
        const selected = cases.find((item) => item.id === id);
        const events = selected?.booking
          ? await api.getTheatreSchedulingHistory(id, current)
          : (await api.getLegacyTheatreReviews(current, id)).map((entry) => ({
              ...entry,
              previousRoomId: null,
              previousStartsAt: null,
              previousEndsAt: null,
              newRoomId: null,
              newStartsAt: null,
              newEndsAt: null,
            }));
        if (scopeRef.current === current && request === historyRequest.current)
          setHistory({ caseId: id, events });
      },
      'Scheduling history loaded.',
      false,
    );
  };

  if (!facilityId)
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        Select a facility to view its theatre schedule.
      </div>
    );
  if (!canRead)
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        Theatre read permission is required. Ask your facility administrator to assign the
        appropriate permissions.
      </div>
    );
  const visible = loadedFor === currentFacility.id;
  const activeCases = visible
    ? cases.filter((item) => item.booking?.reserved && item.status === 'Scheduled')
    : [];
  const openRooms = visible ? rooms.filter((room) => room.state === 'OPEN') : [];
  const pendingLegacy = visible
    ? cases.filter((item) => !item.booking && item.legacyReview?.action !== 'NO_ACTIVE_RESERVATION')
        .length
    : 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
            {currentFacility.name}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Theatre scheduling</h1>
          <p className="mt-1 text-sm text-slate-600">
            Facility rooms, bookings and scheduling history
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={secondaryClass}
            onClick={() => setVersion((n) => n + 1)}
            disabled={loading || busy}
          >
            <RefreshCw size={15} /> Refresh
          </button>
          {canCreate && (
            <button
              className={buttonClass}
              onClick={() => {
                setShowCreate((v) => !v);
                setError('');
              }}
              disabled={!visible || busy}
            >
              <Plus size={16} /> New booking
            </button>
          )}
        </div>
      </header>
      <div
        role="note"
        className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
      >
        <AlertTriangle className="mt-0.5 shrink-0" size={19} />
        <div>
          <strong>Scheduling only — not clinical readiness.</strong> Consent, preoperative
          clearance, the three safety checklist stages, operative and recovery records, theatre
          stock and theatre billing are not available here. Do not use this screen as evidence that
          surgery may start or has been completed.
        </div>
      </div>
      {pendingLegacy > 0 && (
        <div
          role="note"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
        >
          {pendingLegacy} historical case(s) require a scheduling reservation review before creating
          or moving bookings. Historical status alone is not proof of availability.
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900"
        >
          {notice}
        </div>
      )}
      {loading && (
        <div
          role="status"
          className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600"
        >
          Loading theatre schedule…
        </div>
      )}
      {loadError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"
        >
          Could not load this facility’s schedule: {loadError}{' '}
          <button className="ml-2 underline" onClick={() => setVersion((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {visible && (
        <>
          <section
            aria-label="Scheduling summary"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            {[
              ['Scheduled bookings', activeCases.length],
              [
                'Urgent bookings',
                activeCases.filter((c) => c.booking?.urgency === 'URGENT').length,
              ],
              [
                'Emergency bookings',
                activeCases.filter((c) => c.booking?.urgency === 'EMERGENCY').length,
              ],
              ['Rooms open for booking', openRooms.length],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </section>
          <p className="text-xs text-slate-500">
            Counts are current saved records across all dates, not theatre occupancy or completed
            operations. Times below use {timezone}.
          </p>
          {showCreate && (
            <section className="rounded-xl border border-teal-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Schedule a case</h2>
                  <p className="text-xs text-slate-500">
                    Select real facility records. Booking does not verify practitioner privileges or
                    consent.
                  </p>
                </div>
                <button
                  type="button"
                  className="text-sm text-slate-600 underline"
                  onClick={() => setShowCreate(false)}
                >
                  Close
                </button>
              </div>
              <form onSubmit={saveBooking} className="space-y-4">
                <div className="rounded-lg bg-slate-50 p-3">
                  <Field label="Find a registered patient by name or MRN">
                    <div className="flex gap-2">
                      <input
                        className={inputClass}
                        value={patientSearch}
                        onChange={(e) => setPatientSearch(e.target.value)}
                        disabled={!canPatients || busy}
                      />
                      <button
                        type="button"
                        className={secondaryClass}
                        disabled={!canPatients || !patientSearch.trim() || busy}
                        onClick={searchPatients}
                      >
                        Search
                      </button>
                    </div>
                  </Field>
                  {!canPatients && (
                    <p className="mt-1 text-xs text-amber-800">
                      Patient read permission is required to search existing records.
                    </p>
                  )}
                  {searched && patientResults.length === 0 && (
                    <p className="mt-2 text-xs text-slate-600">
                      No matching registered patients in this facility.
                    </p>
                  )}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Patient">
                    <select
                      className={inputClass}
                      required
                      value={form.patientId}
                      onChange={(e) => setForm({ ...form, patientId: e.target.value })}
                    >
                      <option value="">Select a search result</option>
                      {patientResults.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.firstName} {p.lastName} · {p.mrn}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Procedure name">
                    <input
                      className={inputClass}
                      required
                      maxLength={200}
                      value={form.procedureName}
                      onChange={(e) => setForm({ ...form, procedureName: e.target.value })}
                    />
                  </Field>
                  <Field label="Lead practitioner">
                    <select
                      className={inputClass}
                      required
                      value={form.leadPractitionerId}
                      onChange={(e) => setForm({ ...form, leadPractitionerId: e.target.value })}
                    >
                      <option value="">Select a practitioner</option>
                      {practitioners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.fullName} · {p.credentialVerificationStatus}
                          {p.licenseExpiryDate ? ` · expiry ${p.licenseExpiryDate}` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Urgency">
                    <select
                      className={inputClass}
                      required
                      value={form.urgency}
                      onChange={(e) => setForm({ ...form, urgency: e.target.value })}
                    >
                      <option value="">Select urgency</option>
                      <option value="ELECTIVE">Elective</option>
                      <option value="URGENT">Urgent</option>
                      <option value="EMERGENCY">Emergency</option>
                    </select>
                  </Field>
                  <Field label="Room">
                    <select
                      className={inputClass}
                      required
                      value={form.roomId}
                      onChange={(e) => setForm({ ...form, roomId: e.target.value })}
                    >
                      <option value="">Select an open room</option>
                      {openRooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={`Start (${timezone})`}>
                    <input
                      className={inputClass}
                      type="datetime-local"
                      required
                      value={form.startsAt}
                      onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                    />
                  </Field>
                  <Field label={`End (${timezone})`}>
                    <input
                      className={inputClass}
                      type="datetime-local"
                      required
                      value={form.endsAt}
                      onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                    />
                  </Field>
                  <Field label="Encounter ID (optional)">
                    <input
                      className={inputClass}
                      type="number"
                      min="1"
                      value={form.encounterId}
                      onChange={(e) => setForm({ ...form, encounterId: e.target.value })}
                    />
                  </Field>
                  <Field label="Active admission ID (optional)">
                    <input
                      className={inputClass}
                      type="number"
                      min="1"
                      value={form.admissionId}
                      onChange={(e) => setForm({ ...form, admissionId: e.target.value })}
                    />
                  </Field>
                </div>
                <p className="text-xs text-slate-500">
                  The server verifies selected patients, practitioners, encounters and admissions in
                  this facility. Credential and privilege review remains a facility responsibility.
                </p>
                <button
                  className={buttonClass}
                  type="submit"
                  disabled={busy || !canPatients || !openRooms.length || !practitioners.length}
                >
                  <CalendarDays size={15} /> {busy ? 'Saving…' : 'Save booking'}
                </button>
              </form>
            </section>
          )}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <CalendarDays size={18} className="text-teal-700" />
              <h2 className="text-lg font-bold text-slate-900">Case list</h2>
            </div>
            <p className="mb-4 mt-1 text-xs text-slate-500">
              Legacy cases are read-only and are not considered verified clinical records.
            </p>
            {cases.length === 0 ? (
              <p className="py-4 text-sm text-slate-500">No saved cases in this facility.</p>
            ) : (
              <div className="space-y-3">
                {[...cases].reverse().map((record) => (
                  <article key={record.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">{record.procedureName}</h3>
                        <p className="text-sm text-slate-600">
                          {record.patient
                            ? `${record.patient.firstName} ${record.patient.lastName} · ${record.patient.mrn}`
                            : `Patient #${record.patientId} (details unavailable)`}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {record.roomName ?? record.theatreRoom ?? 'Room not recorded'} ·{' '}
                          {record.leadSurgeon} ·{' '}
                          {displayTime(record.booking?.startsAt ?? record.scheduledStart)} —{' '}
                          {displayTime(record.booking?.endsAt ?? record.scheduledEnd)}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                          {record.booking
                            ? `${record.status ?? 'Unknown'} · ${record.booking.urgency}`
                            : record.legacyReview?.action === 'NO_ACTIVE_RESERVATION'
                              ? 'Legacy · reservation reviewed'
                              : 'Legacy · review required'}
                        </span>
                        <div className="mt-3 flex gap-2">
                          <button
                            className={secondaryClass}
                            type="button"
                            disabled={busy}
                            onClick={() => viewHistory(record.id)}
                          >
                            <ClipboardList size={14} /> History
                          </button>
                          {!record.booking && canReconcile && (
                            <button
                              className={secondaryClass}
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setLegacyReview({
                                  record,
                                  action:
                                    record.legacyReview?.action === 'NO_ACTIVE_RESERVATION'
                                      ? 'REVOKED'
                                      : 'NO_ACTIVE_RESERVATION',
                                  reason: '',
                                  acknowledged: false,
                                });
                                setError('');
                              }}
                            >
                              {record.legacyReview?.action === 'NO_ACTIVE_RESERVATION'
                                ? 'Revoke review'
                                : 'Review reservation'}
                            </button>
                          )}
                          {canManage && (
                            <button
                              className={secondaryClass}
                              type="button"
                              disabled={
                                busy || !record.booking?.reserved || record.status !== 'Scheduled'
                              }
                              onClick={() => openEdit(record)}
                            >
                              Change
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          {editing?.record.booking && (
            <section className="rounded-xl border border-teal-200 bg-white p-5">
              <h2 className="text-lg font-bold text-slate-900">Change case #{editing.record.id}</h2>
              <p className="mb-4 text-xs text-slate-500">
                A reason is required. Changes are version-checked and kept in scheduling history.
              </p>
              <form onSubmit={reschedule} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Room">
                    <select
                      className={inputClass}
                      value={editing.roomId}
                      required
                      onChange={(e) => setEditing({ ...editing, roomId: e.target.value })}
                    >
                      {rooms
                        .filter((r) => r.state === 'OPEN')
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label={`Start (${timezone})`}>
                    <input
                      className={inputClass}
                      type="datetime-local"
                      required
                      value={editing.startsAt}
                      onChange={(e) => setEditing({ ...editing, startsAt: e.target.value })}
                    />
                  </Field>
                  <Field label={`End (${timezone})`}>
                    <input
                      className={inputClass}
                      type="datetime-local"
                      required
                      value={editing.endsAt}
                      onChange={(e) => setEditing({ ...editing, endsAt: e.target.value })}
                    />
                  </Field>
                  <Field label="Reason">
                    <input
                      className={inputClass}
                      required
                      maxLength={500}
                      value={editing.reason}
                      onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className={buttonClass} disabled={busy}>
                    Save reschedule
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-50"
                    disabled={busy}
                    onClick={cancel}
                  >
                    Cancel booking
                  </button>
                  <button
                    type="button"
                    className={secondaryClass}
                    disabled={busy}
                    onClick={() => setEditing(null)}
                  >
                    Close
                  </button>
                </div>
              </form>
            </section>
          )}
          {legacyReview && (
            <section className="rounded-xl border border-amber-300 bg-white p-5">
              <h2 className="text-lg font-bold">
                {legacyReview.action === 'REVOKED'
                  ? 'Revoke reservation review'
                  : 'Review historical reservation'}{' '}
                · case #{legacyReview.record.id}
              </h2>
              <p className="my-3 text-sm text-slate-700">
                {legacyReview.action === 'REVOKED'
                  ? 'This blocks new scheduling until reviewed again. Existing bookings are not changed; check them manually.'
                  : 'Only confirm after checking the original schedule and verifying there is no active room, patient or lead-practitioner reservation. This does not establish consent, clinical completion or readiness and does not alter the historical case.'}
              </p>
              <form onSubmit={saveLegacyReview} className="space-y-3">
                <Field label="Review reason">
                  <input
                    className={inputClass}
                    required
                    maxLength={500}
                    value={legacyReview.reason}
                    onChange={(e) => setLegacyReview({ ...legacyReview, reason: e.target.value })}
                  />
                </Field>
                {legacyReview.action === 'NO_ACTIVE_RESERVATION' && (
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={legacyReview.acknowledged}
                      onChange={(e) =>
                        setLegacyReview({ ...legacyReview, acknowledged: e.target.checked })
                      }
                    />{' '}
                    I have verified that no active reservation remains for this historical case.
                  </label>
                )}
                <div className="flex gap-2">
                  <button className={buttonClass} disabled={busy} type="submit">
                    {legacyReview.action === 'REVOKED' ? 'Confirm revoke' : 'Record review'}
                  </button>
                  <button
                    className={secondaryClass}
                    type="button"
                    onClick={() => setLegacyReview(null)}
                  >
                    Close
                  </button>
                </div>
              </form>
            </section>
          )}
          {history && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex justify-between">
                <h2 className="text-lg font-bold text-slate-900">
                  Scheduling history · case #{history.caseId}
                </h2>
                <button className="text-sm underline" onClick={() => setHistory(null)}>
                  Close
                </button>
              </div>
              {history.events.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No structured history.</p>
              ) : (
                <ol className="mt-3 space-y-3">
                  {history.events.map((event) => (
                    <li key={event.id} className="border-l-2 border-teal-300 pl-3 text-sm">
                      <strong>{event.action}</strong> · {displayTime(event.createdAt)} · staff #
                      {event.actorId}
                      {event.reason && <p className="text-slate-600">Reason: {event.reason}</p>}
                      {event.previousStartsAt && (
                        <p className="text-xs text-slate-500">
                          Previous: room #{event.previousRoomId},{' '}
                          {displayTime(event.previousStartsAt)} –{' '}
                          {displayTime(event.previousEndsAt)}
                        </p>
                      )}
                      {event.newStartsAt && (
                        <p className="text-xs text-slate-500">
                          New: room #{event.newRoomId}, {displayTime(event.newStartsAt)} –{' '}
                          {displayTime(event.newEndsAt)}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
          {canReports && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-bold text-slate-900">Scheduling report</h2>
              <p className="mt-1 text-xs text-slate-500">
                Current structured bookings whose current start is in the chosen interval; excludes
                legacy cases. Planned minutes include the full duration of reserved bookings, even
                when an end lies outside the interval. Not actual utilisation or completed surgery.
              </p>
              <form onSubmit={loadReport} className="mt-4 flex flex-wrap items-end gap-3">
                <Field label={`Report from (${timezone})`}>
                  <input
                    className={inputClass}
                    required
                    type="datetime-local"
                    value={reportFrom}
                    onChange={(e) => setReportFrom(e.target.value)}
                  />
                </Field>
                <Field label={`Report to, exclusive (${timezone})`}>
                  <input
                    className={inputClass}
                    required
                    type="datetime-local"
                    value={reportTo}
                    onChange={(e) => setReportTo(e.target.value)}
                  />
                </Field>
                <button className={secondaryClass} disabled={busy} type="submit">
                  Run report
                </button>
              </form>
              {report && (
                <div className="mt-4 space-y-2 text-sm">
                  <p>
                    <strong>{report.totals.bookings}</strong> bookings ·{' '}
                    <strong>{report.totals.reserved}</strong> reserved ·{' '}
                    <strong>{report.totals.cancelled}</strong> cancelled ·{' '}
                    <strong>{report.totals.otherUnreserved}</strong> other unreserved
                  </p>
                  <p>
                    <strong>{report.totals.reservedMinutes}</strong> planned reserved minutes
                  </p>
                  {report.rows.length === 0 ? (
                    <p className="text-slate-500">No structured bookings in this interval.</p>
                  ) : (
                    <ul className="space-y-1">
                      {report.rows.map((row) => (
                        <li
                          key={`${row.roomId}-${row.urgency}-${row.status}-${row.reserved}`}
                          className="rounded bg-slate-50 px-3 py-2"
                        >
                          {row.roomName} · {row.urgency} · {row.status ?? 'Unknown'} · {row.count}{' '}
                          booking(s) ·{' '}
                          {row.reserved
                            ? `${row.plannedMinutes} planned minutes reserved`
                            : 'not reserved'}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-bold text-slate-900">Rooms</h2>
            <p className="mb-3 text-xs text-slate-500">
              Room state is administrative, not real-time occupancy. Changing state does not move
              existing bookings.
            </p>
            {rooms.length === 0 ? (
              <p className="text-sm text-slate-500">No rooms configured for this facility.</p>
            ) : (
              <div className="space-y-2">
                {rooms.map((room) => (
                  <div
                    key={room.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
                  >
                    <span className="text-sm font-semibold text-slate-800">{room.name}</span>
                    {canRooms ? (
                      <label className="text-xs text-slate-600">
                        State{' '}
                        <select
                          aria-label={`State for ${room.name}`}
                          className="ml-2 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                          disabled={busy}
                          value={room.state}
                          onChange={(e) =>
                            setRoomState(room.id, e.target.value as TheatreRoomState)
                          }
                        >
                          <option value="OPEN">Open</option>
                          <option value="MAINTENANCE">Maintenance</option>
                          <option value="INACTIVE">Inactive</option>
                        </select>
                      </label>
                    ) : (
                      <span className="text-xs text-slate-600">{room.state}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canRooms && (
              <form onSubmit={createRoom} className="mt-4 flex max-w-xl items-end gap-2">
                <div className="flex-1">
                  <Field label="New room name">
                    <input
                      className={inputClass}
                      maxLength={120}
                      required
                      value={roomName}
                      onChange={(e) => setRoomName(e.target.value)}
                    />
                  </Field>
                </div>
                <button className={secondaryClass} disabled={busy} type="submit">
                  Add room
                </button>
              </form>
            )}
          </section>
        </>
      )}
    </div>
  );
};
