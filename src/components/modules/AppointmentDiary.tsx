import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { addCalendarDays, parseCalendarDate } from '../../dashboard/date-range.ts';
import type {
  Appointment,
  AppointmentCategory,
  AppointmentEvent,
  Patient,
} from '../../types/index.ts';
import { FormField, PrimaryButton, SecondaryButton } from '../ui/controls.tsx';
import { ErrorState } from '../ui/feedback.tsx';
import { Modal } from '../ui/overlays.tsx';

type Mode = 'day' | 'week' | 'month';
type Action = 'cancel' | 'reschedule' | 'check-in';
const pageSize = 50;
const active = new Set(['Scheduled', 'Confirmed', 'Checked-in']);

/** Use the configured facility/tenant timezone, never the browser's timezone. */
function dateInZone(zone: string | null): string {
  if (!zone) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return '';
  }
}
function rangeFor(date: string, mode: Mode): { from: string; to: string } | null {
  const value = parseCalendarDate(date);
  if (!value) return null;
  if (mode === 'day') return { from: date, to: date };
  if (mode === 'week') {
    const monday = (value.getUTCDay() + 6) % 7;
    const from = addCalendarDays(date, -monday);
    return { from, to: addCalendarDays(from, 6) };
  }
  const first = `${date.slice(0, 7)}-01`;
  const end = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
  return { from: first, to: end };
}

export function AppointmentDiary({
  facilityId,
  timezone,
  patients,
  categories,
  practitioners,
  refreshKey,
  triggerRefresh,
  permissions,
  isSuperAdmin = false,
  showToast,
}: {
  facilityId: number | undefined;
  timezone: string | null;
  patients: Patient[];
  categories: AppointmentCategory[];
  practitioners: Array<{ id: number; name: string }>;
  refreshKey: number;
  triggerRefresh: () => void;
  permissions: string[];
  isSuperAdmin?: boolean;
  showToast: (
    message: string,
    options?: { tone?: 'info' | 'success' | 'warning' | 'error' },
  ) => void;
}) {
  const [mode, setMode] = useState<Mode>('day');
  const [date, setDate] = useState(() => dateInZone(timezone));
  const [offset, setOffset] = useState(0);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [practitionerId, setPractitionerId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [historyFor, setHistoryFor] = useState<Appointment | null>(null);
  const [events, setEvents] = useState<AppointmentEvent[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [target, setTarget] = useState<{ appointment: Appointment; action: Action } | null>(null);
  const [reason, setReason] = useState('');
  const [newTime, setNewTime] = useState('');
  const [station, setStation] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const requestKey = useRef('');
  const range = useMemo(() => rangeFor(date, mode), [date, mode]);
  const can = (permission: string) => isSuperAdmin || permissions.includes(permission);

  useEffect(() => {
    let live = true;
    if (!facilityId || !range) {
      setRows([]);
      setLoading(false);
      setError('');
      return;
    }
    if (patientId && !/^[1-9]\d*$/.test(patientId)) {
      setRows([]);
      setLoading(false);
      setError('Enter a positive patient ID.');
      return;
    }
    setLoading(true);
    setError('');
    api
      .getAppointments(facilityId, {
        from: range.from,
        to: range.to,
        limit: pageSize,
        offset,
        ...(includeHistory ? {} : { active: true }),
        ...(categoryId ? { categoryId: Number(categoryId) } : {}),
        ...(practitionerId ? { practitionerId: Number(practitionerId) } : {}),
        ...(patientId ? { patientId: Number(patientId) } : {}),
        ...(status ? { status } : {}),
      })
      .then((data) => {
        if (live) setRows(data);
      })
      .catch((e: unknown) => {
        if (live) {
          setRows([]);
          setError(e instanceof Error ? e.message : 'Appointment diary unavailable.');
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [
    facilityId,
    range,
    offset,
    includeHistory,
    categoryId,
    practitionerId,
    patientId,
    status,
    refreshKey,
    retry,
  ]);
  useEffect(() => {
    let live = true;
    if (!historyFor || !facilityId) return;
    api
      .getAppointmentHistory(facilityId, historyFor.id)
      .then((data) => {
        if (live) setEvents(data);
      })
      .catch((e: unknown) => {
        if (live) setHistoryError(e instanceof Error ? e.message : 'History unavailable.');
      });
    return () => {
      live = false;
    };
  }, [facilityId, historyFor]);
  const displayName = (id: number) => {
    const p = patients.find((item) => item.id === id);
    return p ? `${p.firstName} ${p.lastName}` : `Patient #${id}`;
  };
  function openHistory(appointment: Appointment) {
    setEvents(null);
    setHistoryError('');
    setHistoryFor(appointment);
  }
  function startAction(appointment: Appointment, action: Action) {
    setTarget({ appointment, action });
    setReason('');
    setNewTime('');
    setStation('');
    setActionError('');
    requestKey.current = crypto.randomUUID();
  }
  async function submitAction(event: React.FormEvent) {
    event.preventDefault();
    if (!target || !facilityId || busy) return;
    setBusy(true);
    setActionError('');
    try {
      if (target.action === 'cancel')
        await api.cancelAppointment(target.appointment.id, facilityId, reason);
      if (target.action === 'reschedule')
        await api.rescheduleAppointment(
          target.appointment.id,
          facilityId,
          newTime,
          reason,
          requestKey.current,
        );
      if (target.action === 'check-in')
        await api.checkInAppointment(target.appointment.id, facilityId, station);
      showToast(
        target.action === 'check-in'
          ? 'Check-in recorded and queue token created; treatment is not recorded.'
          : 'Appointment updated. Payment and refunds were not assessed.',
        { tone: 'success' },
      );
      setTarget(null);
      triggerRefresh();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'The appointment could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col"
      aria-label="Appointment diary"
    >
      <div className="px-4 py-3 border-b border-slate-200">
        <h2 className="text-sm font-bold text-slate-900">Appointment diary</h2>
        <p className="text-xs text-slate-600">
          Facility-local times. Availability is not verified across all booking channels. Linked
          website and dialysis records require their own workflow; coordinated changes are not yet
          supported here.
        </p>
      </div>
      <div className="p-4 space-y-3 text-xs">
        <div className="flex gap-1" role="group" aria-label="Diary view">
          {(['day', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={mode === v}
              className={`px-2 py-1 rounded border ${mode === v ? 'bg-blue-700 text-white' : 'bg-white text-slate-700'}`}
              onClick={() => {
                setMode(v);
                setOffset(0);
              }}
            >
              {v === 'day' ? 'Day' : v === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
        <FormField
          label="Diary date"
          htmlFor="diary-date"
          hint={
            timezone
              ? `Dates in ${timezone}`
              : 'Facility timezone unavailable; select a date explicitly.'
          }
        >
          <input
            id="diary-date"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setOffset(0);
            }}
            className="w-full border rounded px-2 py-1"
          />
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <FormField label="Patient ID filter" htmlFor="diary-patient">
            <input
              id="diary-patient"
              inputMode="numeric"
              value={patientId}
              onChange={(e) => {
                setPatientId(e.target.value);
                setOffset(0);
              }}
              className="w-full border rounded px-2 py-1"
            />
          </FormField>
          <FormField label="Category filter" htmlFor="diary-category">
            <select
              id="diary-category"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setOffset(0);
              }}
              className="w-full border rounded px-2 py-1"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isActive ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Practitioner filter" htmlFor="diary-practitioner">
            <select
              id="diary-practitioner"
              value={practitionerId}
              onChange={(e) => {
                setPractitionerId(e.target.value);
                setOffset(0);
              }}
              className="w-full border rounded px-2 py-1"
            >
              <option value="">All practitioners</option>
              {practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Status filter" htmlFor="diary-status">
            <select
              id="diary-status"
              value={status}
              onChange={(e) => {
                const value = e.target.value;
                setStatus(value);
                if (value === 'Cancelled' || value === 'Rescheduled') setIncludeHistory(true);
                setOffset(0);
              }}
              className="w-full border rounded px-2 py-1"
            >
              <option value="">All shown statuses</option>
              {['Scheduled', 'Confirmed', 'Checked-in', 'Cancelled', 'Rescheduled'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </FormField>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeHistory}
            onChange={(e) => {
              setIncludeHistory(e.target.checked);
              setOffset(0);
            }}
          />{' '}
          Include cancelled, rescheduled and other history
        </label>
        {range && (
          <p className="text-slate-600">
            {range.from} to {range.to} ·{' '}
            {loading
              ? 'Loading…'
              : error
                ? 'Unavailable'
                : `${rows.length} records on this page (${rows.filter((r) => active.has(r.status)).length} active)`}
          </p>
        )}
        {!range && <p role="status">Choose a valid diary date.</p>}
        {error && <ErrorState message={error} onRetry={() => setRetry((v) => v + 1)} />}
        {loading ? (
          <p role="status">Loading appointments…</p>
        ) : !error && range && rows.length === 0 ? (
          <p>No appointments on this page.</p>
        ) : (
          !error &&
          rows.map((appt) => (
            <article key={appt.id} className="p-3 border rounded bg-slate-50 space-y-1.5">
              <div className="flex justify-between gap-2">
                <strong>{displayName(appt.patientId)}</strong>
                <span className="font-mono">{appt.scheduledTime}</span>
              </div>
              <p>
                {appt.appointmentType ?? 'Type not recorded'} ·{' '}
                {appt.durationMinutes ?? 'duration unavailable'} min ·{' '}
                {appt.status ?? 'status unavailable'}
              </p>
              <p>
                Reference: {appt.bookingReference ?? 'Not recorded for this legacy/source booking'}
              </p>
              <p>Payment: not linked or assessed in this diary.</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button className="text-blue-800 underline" onClick={() => openHistory(appt)}>
                  History
                </button>
                {['Scheduled', 'Confirmed'].includes(appt.status) &&
                  can('appointments.update') &&
                  can('appointments.create') && (
                    <>
                      <button
                        className="text-blue-800 underline"
                        onClick={() => startAction(appt, 'check-in')}
                      >
                        Check in
                      </button>
                      <button
                        className="text-blue-800 underline"
                        onClick={() => startAction(appt, 'reschedule')}
                      >
                        Reschedule
                      </button>
                    </>
                  )}
                {['Scheduled', 'Confirmed'].includes(appt.status) && can('appointments.cancel') && (
                  <button
                    className="text-rose-700 underline"
                    onClick={() => startAction(appt, 'cancel')}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </article>
          ))
        )}
        {range && !error && (
          <div className="flex gap-2">
            <SecondaryButton
              disabled={loading || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - pageSize))}
            >
              Previous
            </SecondaryButton>
            <SecondaryButton
              disabled={loading || rows.length < pageSize}
              onClick={() => setOffset(offset + pageSize)}
            >
              Next
            </SecondaryButton>
            <span>Page {Math.floor(offset / pageSize) + 1}</span>
          </div>
        )}
      </div>
      <Modal open={!!historyFor} title="Appointment history" onClose={() => setHistoryFor(null)}>
        <p className="text-xs mb-3">
          Earlier history may not have been recorded. Payment state is not assessed here.
        </p>
        {historyError ? (
          <p role="alert">{historyError}</p>
        ) : events === null ? (
          <p role="status">Loading history…</p>
        ) : events.length === 0 ? (
          <p>No recorded staff events for this appointment.</p>
        ) : (
          <ol className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="border rounded p-2 text-xs">
                <strong>{e.eventType}</strong> · {e.createdAt}
                <br />
                Staff user #{e.actorUserId} · {e.fromStatus ?? 'No prior status'} → {e.toStatus}
                {e.reason && <p>Reason: {e.reason}</p>}
                {e.scheduledTimeBefore && <p>Previous: {e.scheduledTimeBefore}</p>}
                {e.scheduledTimeAfter && <p>New: {e.scheduledTimeAfter}</p>}
                {e.relatedAppointmentId && <p>Related appointment #{e.relatedAppointmentId}</p>}
              </li>
            ))}
          </ol>
        )}
      </Modal>
      <Modal
        open={!!target}
        title={
          target?.action === 'cancel'
            ? 'Cancel appointment'
            : target?.action === 'reschedule'
              ? 'Reschedule appointment'
              : 'Check in appointment'
        }
        onClose={() => {
          if (!busy) setTarget(null);
        }}
        closeOnBackdrop={!busy}
        closeOnEscape={!busy}
        actions={
          <>
            <SecondaryButton disabled={busy} onClick={() => setTarget(null)}>
              Close
            </SecondaryButton>
            <PrimaryButton type="submit" form="appointment-action-form" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </PrimaryButton>
          </>
        }
      >
        <form id="appointment-action-form" onSubmit={submitAction} className="space-y-3">
          <p className="text-xs">
            {target?.appointment.bookingReference ?? `Appointment #${target?.appointment.id}`} ·{' '}
            {target?.appointment.scheduledTime}
          </p>
          {target?.action === 'check-in' ? (
            <>
              <p className="text-xs">
                This records arrival and a queue token, not treatment. Select the station
                explicitly.
              </p>
              <FormField label="Queue station *" htmlFor="checkin-station">
                <select
                  id="checkin-station"
                  required
                  value={station}
                  onChange={(e) => setStation(e.target.value)}
                  className="w-full border rounded p-2"
                >
                  <option value="">Select station</option>
                  {['Triage', 'Doctor', 'Laboratory', 'Radiology', 'Pharmacy', 'Billing'].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
              </FormField>
            </>
          ) : (
            <>
              <p className="text-xs">
                The existing record is retained. No payment or refund is processed.
              </p>
              {target?.action === 'reschedule' && (
                <FormField
                  label="New local date & time *"
                  htmlFor="reschedule-time"
                  hint="YYYY-MM-DD HH:MM"
                >
                  <input
                    id="reschedule-time"
                    required
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    placeholder="YYYY-MM-DD HH:MM"
                    className="w-full border rounded p-2"
                  />
                </FormField>
              )}
              <FormField label="Reason *" htmlFor="appointment-action-reason">
                <textarea
                  id="appointment-action-reason"
                  required
                  minLength={3}
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full border rounded p-2"
                />
              </FormField>
            </>
          )}
          {actionError && (
            <p role="alert" className="text-rose-700">
              {actionError}
            </p>
          )}
        </form>
      </Modal>
    </section>
  );
}
