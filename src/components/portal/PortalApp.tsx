/**
 * JaliCare HMIS
 * Patient digital health record portal
 *
 * A separate surface from the staff application: its own layout, its own
 * session token, its own routes (`/portal`, `/portal/activate`). It is
 * rendered before the staff authentication gate in `App.tsx`, so it never
 * inherits a staff session — a staff token in `localStorage` does nothing
 * here, because every request carries the patient token from a different
 * key and the server validates it against `patient_portal_sessions`.
 *
 * Mobile-first by design: the people who use this are holding a phone,
 * often on a metered connection. One column, large tap targets, no
 * hover-dependent interactions.
 *
 * What this screen will not do:
 *   - link an account by guessing a phone number or date of birth;
 *   - show a result that a laboratory professional has not verified;
 *   - edit a clinical record;
 *   - claim a message was delivered when no provider is configured.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  FlaskConical,
  HeartPulse,
  Home,
  KeyRound,
  Lock,
  LogOut,
  Pill,
  QrCode,
  RefreshCw,
  Share2,
  ShieldCheck,
  Stethoscope,
  UserRound,
} from 'lucide-react';

import {
  clearPortalToken,
  getPortalToken,
  loginPortal,
  logoutPortal,
  portalApi,
  PortalApiError,
  activatePortalAccount,
  type PortalAppointment,
  type PortalLabOrder,
  type PortalMe,
  type PortalMedication,
  type PortalOverview,
  type PortalSharingGrant,
  type PortalVisit,
  type PortalAccessEvent,
} from '../../api/portal-client.ts';

/* ============================================================
   Small building blocks
   ============================================================ */

const PASSWORD_MIN = 12;

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '—';

  return withTime
    ? date.toLocaleString('en-KE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : date.toLocaleDateString('en-KE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
}

function Panel({
  title,
  subtitle,
  icon,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-header flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {icon ? (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              {icon}
            </span>
          ) : null}

          <div>
            <h2 className="text-sm font-semibold text-ink">{title}</h2>

            {subtitle ? (
              <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{subtitle}</p>
            ) : null}
          </div>
        </div>

        {action}
      </header>

      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs leading-relaxed text-ink-soft">
      {children}
    </p>
  );
}

function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'ok';
  children: React.ReactNode;
}) {
  const tones = {
    info: 'border-brand-200 bg-brand-50 text-brand-900',
    warn: 'border-ember-200 bg-ember-50 text-ember-900',
    danger: 'border-rose-200 bg-rose-50 text-rose-900',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  } as const;

  return (
    <div className={cx('rounded-xl border px-3 py-2.5 text-xs leading-relaxed', tones[tone])}>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-2xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-xs text-ink-soft">
      <RefreshCw className="h-4 w-4 animate-spin text-brand-600" />
      {label}
    </div>
  );
}

/* ============================================================
   Activation
   ============================================================ */

function PortalActivation({ onDone }: { onDone: () => void }) {
  /*
   * The token arrives in the URL *fragment* (`/portal/activate#token`).
   * A fragment is never sent to the server, so it does not appear in an
   * access log, a proxy log or a `Referer` header. It is read once and
   * the address bar is rewritten so the token does not remain in the
   * history the patient scrolls back through.
   */
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    requiresStaffVerification: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';

    if (raw) {
      setToken(decodeURIComponent(raw));
    }

    if (window.location.hash) {
      window.history.replaceState(null, '', '/portal/activate');
    }
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (token.trim() === '') {
      setError('This page needs the link from your invitation. Ask at the reception desk.');
      return;
    }

    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }

    if (password.length < PASSWORD_MIN) {
      setError(`Use at least ${PASSWORD_MIN} characters.`);
      return;
    }

    setBusy(true);

    try {
      const response = await activatePortalAccount({
        token: token.trim(),
        password,
        confirmPassword,
        dateOfBirth: dateOfBirth || undefined,
      });

      setResult({
        requiresStaffVerification: Boolean(response.requiresStaffVerification),
        message: response.message,
      });
    } catch (caught) {
      /*
       * The server returns one message for an unknown, expired, revoked
       * or already-used link. It is shown as given: guessing which case
       * it was would be a disclosure the server deliberately withheld.
       */
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : 'The account could not be activated. Ask at the reception desk.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4">
        <Panel
          title={result.requiresStaffVerification ? 'One more step at the desk' : 'Your account is ready'}
          icon={<ShieldCheck className="h-5 w-5" />}
        >
          <div className="space-y-4">
            <Notice tone={result.requiresStaffVerification ? 'warn' : 'ok'}>
              {result.message}
            </Notice>

            {result.requiresStaffVerification ? (
              <p className="text-xs leading-relaxed text-ink-soft">
                Do not share your password with anyone, including staff. A member of staff will check
                your identity documents; they do not need your password to do that.
              </p>
            ) : (
              <button type="button" className="btn-primary w-full" onClick={onDone}>
                <Lock className="h-4 w-4" />
                Sign in
              </button>
            )}
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <Panel
        title="Activate your health record"
        subtitle="This link came from your clinic. It works once."
        icon={<KeyRound className="h-5 w-5" />}
      >
        <form className="space-y-4" onSubmit={submit}>
          {error ? <Notice tone="danger">{error}</Notice> : null}

          <Field label="Choose a password" hint={`At least ${PASSWORD_MIN} characters.`}>
            <input
              className="field-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>

          <Field label="Repeat the password">
            <input
              className="field-input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </Field>

          <Field
            label="Date of birth (optional)"
            hint="Only used to double-check that this record is yours. It is not a login detail."
          >
            <input
              className="field-input"
              type="date"
              value={dateOfBirth}
              onChange={(event) => setDateOfBirth(event.target.value)}
            />
          </Field>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {busy ? 'Activating…' : 'Activate account'}
          </button>

          <p className="text-2xs leading-relaxed text-slate-500">
            A successful activation does not sign you in automatically. You will sign in with your
            phone number or email and the password you just chose.
          </p>
        </form>
      </Panel>
    </div>
  );
}

/* ============================================================
   Sign in
   ============================================================ */

function PortalLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await loginPortal({ identifier, password });
      onSignedIn();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : 'Sign-in could not be completed. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <Panel
        title="Sign in to your record"
        subtitle="Use the phone number or email your clinic has for you."
        icon={<UserRound className="h-5 w-5" />}
      >
        <form className="space-y-4" onSubmit={submit}>
          {error ? <Notice tone="danger">{error}</Notice> : null}

          <Field label="Phone number or email">
            <input
              className="field-input"
              type="text"
              inputMode="tel"
              autoComplete="username"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              required
            />
          </Field>

          <Field label="Password">
            <input
              className="field-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </Panel>

      <div className="rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-xs leading-relaxed text-brand-900">
        <p className="font-semibold">Do not have an account?</p>
        <p className="mt-1">
          Ask at the reception desk of the facility where you are registered. Staff will confirm your
          identity in person before they issue an invitation — they cannot do it by phone.
        </p>
      </div>
    </div>
  );
}

/* ============================================================
   Home
   ============================================================ */

function PortalHome({ overview, onOpen }: { overview: PortalOverview; onOpen: (tab: TabId) => void }) {
  const nextAppointment = overview.upcomingAppointments[0];

  return (
    <div className="space-y-4">
      {overview.activeAllergies.length > 0 ? (
        <Notice tone="warn">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Allergies on your record:</strong>{' '}
              {overview.activeAllergies
                .map((allergy) => `${allergy.allergen} (${allergy.severity.toLowerCase()})`)
                .join(', ')}
              . Tell any clinician who treats you.
            </span>
          </span>
        </Notice>
      ) : null}

      <Panel
        title="Your next appointment"
        icon={<CalendarDays className="h-5 w-5" />}
        action={
          <button type="button" className="btn-quiet" onClick={() => onOpen('records')}>
            All appointments
          </button>
        }
      >
        {nextAppointment ? (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-brand-50 px-3 py-3">
            <div>
              <p className="text-sm font-semibold text-ink">
                {formatDate(nextAppointment.scheduledTime, true)}
              </p>
              <p className="text-xs text-ink-soft">
                {nextAppointment.appointmentType ?? 'Appointment'}
                {nextAppointment.reason ? ` · ${nextAppointment.reason}` : ''}
              </p>
            </div>
            <CheckCircle2 className="h-5 w-5 text-brand-600" />
          </div>
        ) : (
          <Empty>
            No upcoming appointment is booked at this facility. Appointments appear here once the desk
            books one.
          </Empty>
        )}
      </Panel>

      <Panel
        title="Recent visits"
        icon={<Stethoscope className="h-5 w-5" />}
        action={
          <button type="button" className="btn-quiet" onClick={() => onOpen('records')}>
            Open records
          </button>
        }
      >
        {overview.visits.length === 0 ? (
          <Empty>No visits have been recorded at this facility yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {overview.visits.map((visit) => (
              <li key={visit.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-xs font-semibold text-ink">{visit.encounterType}</p>
                  <p className="text-2xs text-slate-500">{formatDate(visit.startedAt, true)}</p>
                </div>
                <span className="chip">{visit.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title="Latest verified results" icon={<FlaskConical className="h-5 w-5" />}>
          {overview.recentVerifiedResults.length === 0 ? (
            <Empty>
              No verified laboratory result is available. A result appears only after a laboratory
              professional has signed it off.
            </Empty>
          ) : (
            <ul className="space-y-2">
              {overview.recentVerifiedResults.slice(0, 4).map((result) => (
                <li key={result.id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold text-ink">{result.parameterName}</p>
                  <p className="text-2xs text-ink-soft">
                    {result.measuredValue} {result.unit ?? ''}
                    {result.referenceRange ? ` · ref ${result.referenceRange}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Current medicines" icon={<Pill className="h-5 w-5" />}>
          {overview.recentMedications.length === 0 ? (
            <Empty>No prescription is recorded at this facility.</Empty>
          ) : (
            <ul className="space-y-2">
              {overview.recentMedications.slice(0, 4).map((medicine) => (
                <li key={medicine.id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold text-ink">{medicine.drugName}</p>
                  <p className="text-2xs text-ink-soft">
                    {medicine.dosage} · {medicine.frequency} · {medicine.duration}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ============================================================
   Records
   ============================================================ */

function VisitCard({ visit }: { visit: PortalVisit }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-surface px-3 py-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-ink">{visit.encounterType}</p>
          <p className="text-2xs text-slate-500">
            {formatDate(visit.startedAt, true)}
            {visit.facilityName ? ` · ${visit.facilityName}` : ''}
          </p>
        </div>
        <span className="chip">{visit.status}</span>
      </header>

      {visit.chiefComplaint ? (
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">
          <span className="font-semibold text-ink">Reason for visit: </span>
          {visit.chiefComplaint}
        </p>
      ) : null}

      {visit.diagnoses.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {visit.diagnoses.map((diagnosis, index) => (
            <li key={`${visit.id}-${index}`} className="text-xs text-ink-soft">
              <span className="font-mono text-2xs text-slate-500">{diagnosis.icd10Code}</span>{' '}
              {diagnosis.icd10Description}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-2xs text-slate-500">No diagnosis has been released for this visit.</p>
      )}

      {visit.followUpDate ? (
        <p className="mt-2 text-2xs font-semibold text-brand-800">
          Follow-up: {formatDate(visit.followUpDate)}
        </p>
      ) : null}
    </article>
  );
}

function LabOrder({ order }: { order: PortalLabOrder }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-surface px-3 py-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-ink">{order.testName}</p>
          <p className="text-2xs text-slate-500">Ordered {formatDate(order.orderedAt, true)}</p>
        </div>
        <span className="chip">{order.status}</span>
      </header>

      {order.released && order.results.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {order.results.map((result, index) => (
            <li key={`${order.id}-${index}`} className="text-xs text-ink-soft">
              <span className="font-semibold text-ink">{result.parameterName}:</span>{' '}
              {result.measuredValue} {result.unit ?? ''}
              {result.referenceRange ? ` (ref ${result.referenceRange})` : ''}
              {result.flag ? ` · ${result.flag}` : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-2xs text-slate-500">
          No verified result yet. A result appears only after a laboratory professional signs it
          off — this is not an indication that the test was not done.
        </p>
      )}
    </article>
  );
}

function PortalRecords({ overview }: { overview: PortalOverview | null }) {
  const [visits, setVisits] = useState<PortalVisit[] | null>(null);
  const [labOrders, setLabOrders] = useState<PortalLabOrder[] | null>(null);
  const [labNote, setLabNote] = useState<string | null>(null);
  const [medications, setMedications] = useState<PortalMedication[] | null>(null);
  const [appointments, setAppointments] = useState<PortalAppointment[] | null>(null);
  const [summaries, setSummaries] = useState<
    Array<{
      id: number;
      admissionDate: string | null;
      dischargeDate: string | null;
      dischargeType: string | null;
      dischargeSummary: string | null;
      dischargeDisposition: string | null;
      dischargedBy: string | null;
    }>
  >([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const nextErrors: Record<string, string> = {};

      const [visitResult, labResult, medicationResult, appointmentResult, summaryResult] =
        await Promise.allSettled([
          portalApi.visits(),
          portalApi.laboratory(),
          portalApi.medications(),
          portalApi.appointments(),
          portalApi.dischargeSummaries(),
        ]);

      if (cancelled) return;

      if (visitResult.status === 'fulfilled') setVisits(visitResult.value);
      else nextErrors.visits = messageOf(visitResult.reason);

      if (labResult.status === 'fulfilled') {
        setLabOrders(labResult.value.orders);
        setLabNote(labResult.value.note);
      } else {
        nextErrors.laboratory = messageOf(labResult.reason);
      }

      if (medicationResult.status === 'fulfilled') setMedications(medicationResult.value);
      else nextErrors.medications = messageOf(medicationResult.reason);

      if (appointmentResult.status === 'fulfilled') setAppointments(appointmentResult.value);
      else nextErrors.appointments = messageOf(appointmentResult.reason);

      if (summaryResult.status === 'fulfilled') setSummaries(summaryResult.value);
      else nextErrors.summaries = messageOf(summaryResult.reason);

      setErrors(nextErrors);
      setLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Spinner label="Reading your record…" />;

  return (
    <div className="space-y-4">
      <Panel title="Visits and diagnoses" icon={<Stethoscope className="h-5 w-5" />}>
        {errors.visits ? (
          <Notice tone="danger">{errors.visits}</Notice>
        ) : visits && visits.length > 0 ? (
          <div className="space-y-2">
            {visits.map((visit) => (
              <VisitCard key={visit.id} visit={visit} />
            ))}
          </div>
        ) : (
          <Empty>No visit has been recorded for you at this facility.</Empty>
        )}
      </Panel>

      <Panel title="Laboratory" icon={<FlaskConical className="h-5 w-5" />}>
        {errors.laboratory ? (
          <Notice tone="warn">{errors.laboratory}</Notice>
        ) : labOrders && labOrders.length > 0 ? (
          <div className="space-y-2">
            {labNote ? <p className="text-2xs text-slate-500">{labNote}</p> : null}
            {labOrders.map((order) => (
              <LabOrder key={order.id} order={order} />
            ))}
          </div>
        ) : (
          <Empty>No laboratory test has been ordered for you at this facility.</Empty>
        )}
      </Panel>

      <Panel title="Prescriptions" icon={<Pill className="h-5 w-5" />}>
        {errors.medications ? (
          <Notice tone="warn">{errors.medications}</Notice>
        ) : medications && medications.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {medications.map((medicine) => (
              <li key={medicine.id} className="py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-ink">{medicine.drugName}</p>
                  {medicine.status ? <span className="chip">{medicine.status}</span> : null}
                </div>
                <p className="text-2xs text-ink-soft">
                  {medicine.dosage} · {medicine.frequency} · {medicine.duration}
                  {medicine.route ? ` · ${medicine.route}` : ''}
                </p>
                {medicine.instructions ? (
                  <p className="mt-1 text-2xs text-slate-500">{medicine.instructions}</p>
                ) : null}
                <p className="mt-1 text-2xs text-slate-500">
                  Prescribed {formatDate(medicine.prescribedAt)}
                  {medicine.prescribedBy ? ` by ${medicine.prescribedBy}` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No prescription is recorded for you at this facility.</Empty>
        )}
      </Panel>

      <Panel title="Appointments" icon={<CalendarDays className="h-5 w-5" />}>
        {errors.appointments ? (
          <Notice tone="warn">{errors.appointments}</Notice>
        ) : appointments && appointments.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {appointments.map((appointment) => (
              <li key={appointment.id} className="flex items-start justify-between gap-2 py-2.5">
                <div>
                  <p className="text-xs font-semibold text-ink">
                    {formatDate(appointment.scheduledTime, true)}
                  </p>
                  <p className="text-2xs text-ink-soft">
                    {appointment.appointmentType ?? 'Appointment'}
                    {appointment.reason ? ` · ${appointment.reason}` : ''}
                  </p>
                </div>
                {appointment.status ? <span className="chip">{appointment.status}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No appointment is recorded for you at this facility.</Empty>
        )}
      </Panel>

      <Panel title="Discharge summaries" icon={<FileText className="h-5 w-5" />}>
        {errors.summaries ? (
          <Notice tone="warn">{errors.summaries}</Notice>
        ) : summaries.length > 0 ? (
          <div className="space-y-2">
            {summaries.map((summary) => (
              <article key={summary.id} className="rounded-xl border border-slate-200 px-3 py-3">
                <p className="text-xs font-semibold text-ink">
                  {formatDate(summary.admissionDate)} → {formatDate(summary.dischargeDate)}
                </p>
                <p className="text-2xs text-slate-500">
                  {summary.dischargeType ?? 'Discharge'}
                  {summary.dischargeDisposition ? ` · ${summary.dischargeDisposition}` : ''}
                </p>
                {summary.dischargeSummary ? (
                  <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-ink-soft">
                    {summary.dischargeSummary}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <Empty>No discharge summary has been released for you.</Empty>
        )}
      </Panel>

      {overview ? (
        <Panel title="Allergies" icon={<HeartPulse className="h-5 w-5" />}>
          {overview.activeAllergies.length > 0 ? (
            <ul className="space-y-1">
              {overview.activeAllergies.map((allergy) => (
                <li key={allergy.id} className="text-xs text-ink-soft">
                  <span className="font-semibold text-ink">{allergy.allergen}</span> ·{' '}
                  {allergy.allergenType.toLowerCase()} · {allergy.severity.toLowerCase()}
                  {allergy.reaction ? ` · ${allergy.reaction}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No allergy is recorded for you.</Empty>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

function messageOf(reason: unknown): string {
  if (reason instanceof PortalApiError) return reason.message;

  if (reason instanceof Error) return reason.message;

  return 'This section could not be loaded.';
}

/* ============================================================
   Sharing
   ============================================================ */

function PortalSharing() {
  const [grants, setGrants] = useState<PortalSharingGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    recipientName: '',
    purpose: '',
    hours: '24',
    categories: [] as string[],
  });
  const [created, setCreated] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const categories = [
    { id: 'demographics', label: 'Registration details' },
    { id: 'encounters', label: 'Visits' },
    { id: 'diagnoses', label: 'Diagnoses' },
    { id: 'medications', label: 'Prescriptions' },
    { id: 'laboratory', label: 'Laboratory' },
    { id: 'radiology', label: 'Radiology' },
    { id: 'maternity', label: 'Maternity' },
    { id: 'billing', label: 'Billing' },
  ];

  const load = useCallback(async () => {
    setLoading(true);

    try {
      setGrants(await portalApi.sharing());
      setError(null);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);

    try {
      const result = await portalApi.createSharing({
        recipientName: form.recipientName,
        purpose: form.purpose,
        categories: form.categories,
        hours: Number(form.hours),
      });

      setCreated({ code: result.code, expiresAt: result.expiresAt });
      setForm({ recipientName: '', purpose: '', hours: '24', categories: [] });
      await load();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: number) => {
    try {
      await portalApi.revokeSharing(id);
      await load();
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Share your record for a limited time"
        subtitle="Create a one-time code for a named clinician. You choose what is shared and for how long."
        icon={<Share2 className="h-5 w-5" />}
      >
        <form className="space-y-3" onSubmit={create}>
          {error ? <Notice tone="danger">{error}</Notice> : null}

          {created ? (
            <Notice tone="ok">
              <p className="font-semibold">Share this code with the recipient:</p>
              <p className="mt-1 break-all font-mono text-sm tracking-wide">{created.code}</p>
              <p className="mt-1">
                It works once, for that person only, and stops working at {formatDate(created.expiresAt, true)}.
              </p>
            </Notice>
          ) : null}

          <Field label="Who are you sharing with?">
            <input
              className="field-input"
              value={form.recipientName}
              onChange={(event) => setForm({ ...form, recipientName: event.target.value })}
              placeholder="Dr A. Mwangi"
              required
            />
          </Field>

          <Field label="Why?">
            <input
              className="field-input"
              value={form.purpose}
              onChange={(event) => setForm({ ...form, purpose: event.target.value })}
              placeholder="Second opinion on my referral"
              required
            />
          </Field>

          <fieldset>
            <legend className="field-label">What may they see?</legend>

            <div className="grid grid-cols-2 gap-1.5">
              {categories.map((category) => (
                <label
                  key={category.id}
                  className={cx(
                    'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-2xs font-semibold',
                    form.categories.includes(category.id)
                      ? 'border-brand-300 bg-brand-50 text-brand-900'
                      : 'border-slate-200 text-ink-soft',
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-brand-600"
                    checked={form.categories.includes(category.id)}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        categories: event.target.checked
                          ? [...form.categories, category.id]
                          : form.categories.filter((value) => value !== category.id),
                      })
                    }
                  />
                  {category.label}
                </label>
              ))}
            </div>
          </fieldset>

          <Field label="For how long?">
            <select
              className="field-input"
              value={form.hours}
              onChange={(event) => setForm({ ...form, hours: event.target.value })}
            >
              <option value="1">1 hour</option>
              <option value="8">8 hours</option>
              <option value="24">24 hours</option>
              <option value="72">3 days</option>
              <option value="168">7 days</option>
              <option value="720">30 days</option>
            </select>
          </Field>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            {busy ? 'Creating…' : 'Create sharing code'}
          </button>

          <p className="text-2xs leading-relaxed text-slate-500">
            This is a share between you and a named person at this facility. It is not a national
            health information exchange, and nothing here is sent to any external registry.
          </p>
        </form>
      </Panel>

      <Panel title="Shares you have created" icon={<ClipboardList className="h-5 w-5" />}>
        {loading ? (
          <Spinner label="Reading your shares…" />
        ) : grants.length === 0 ? (
          <Empty>You have not shared your record.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {grants.map((grant) => (
              <li key={grant.id} className="py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-ink">{grant.recipientName}</p>
                    <p className="text-2xs text-ink-soft">{grant.purpose}</p>
                    <p className="mt-1 text-2xs text-slate-500">
                      Expires {formatDate(grant.expiresAt, true)}
                      {grant.redeemedAt ? ` · opened ${formatDate(grant.redeemedAt, true)}` : ''}
                    </p>
                  </div>
                  <span className="chip">{grant.state}</span>
                </div>

                {grant.state === 'OPEN' ? (
                  <button
                    type="button"
                    className="btn-quiet mt-2"
                    onClick={() => revoke(grant.id)}
                  >
                    Stop sharing
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ============================================================
   Account
   ============================================================ */

function PortalAccount({
  me,
  onSignedOut,
}: {
  me: PortalMe;
  onSignedOut: () => void;
}) {
  const [card, setCard] = useState<{ svg: string; issuedAt: string | null } | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const [history, setHistory] = useState<PortalAccessEvent[]>([]);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [correction, setCorrection] = useState({ recordType: 'Registration details', detail: '' });
  const [password, setPassword] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [cardResult, historyResult] = await Promise.allSettled([
          portalApi.card(),
          portalApi.accessHistory(),
        ]);

        if (cancelled) return;

        if (cardResult.status === 'fulfilled') setCard(cardResult.value);
        else setCardError(messageOf(cardResult.reason));

        if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
      } catch {
        /* Each block reports its own failure above. */
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const issueCard = async () => {
    setCardBusy(true);
    setCardError(null);

    try {
      const result = await portalApi.issueCard();
      setCard({ svg: result.svg, issuedAt: result.issuedAt });
      setNotice({ tone: 'ok', text: result.message });
    } catch (caught) {
      setCardError(messageOf(caught));
    } finally {
      setCardBusy(false);
    }
  };

  const download = async () => {
    setDownloadBusy(true);
    setNotice(null);

    try {
      const blob = await portalApi.downloadRecord();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = `my-health-record-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      /*
       * The object URL is revoked immediately: it must not survive as a
       * shareable link, and it is scoped to this document anyway.
       */
      URL.revokeObjectURL(url);

      setNotice({ tone: 'ok', text: 'Your record was downloaded to this device.' });
    } catch (caught) {
      setNotice({ tone: 'danger', text: messageOf(caught) });
    } finally {
      setDownloadBusy(false);
    }
  };

  const submitCorrection = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);

    try {
      const result = await portalApi.requestCorrection(correction);
      setNotice({ tone: 'ok', text: result.message });
      setCorrection({ recordType: correction.recordType, detail: '' });
    } catch (caught) {
      setNotice({ tone: 'danger', text: messageOf(caught) });
    }
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);

    if (password.newPassword !== password.confirmPassword) {
      setNotice({ tone: 'danger', text: 'The two new passwords do not match.' });
      return;
    }

    try {
      const result = await portalApi.changePassword(password);
      setNotice({ tone: 'ok', text: result.message });
      setPassword({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (caught) {
      setNotice({ tone: 'danger', text: messageOf(caught) });
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="Your details" icon={<UserRound className="h-5 w-5" />}>
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-2xs uppercase tracking-wide text-slate-500">Name</dt>
            <dd className="font-semibold text-ink">
              {me.patient
                ? [me.patient.firstName, me.patient.middleName, me.patient.lastName]
                    .filter(Boolean)
                    .join(' ')
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-slate-500">Record number</dt>
            <dd className="font-mono text-xs text-ink">{me.patient?.mrn ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-slate-500">Date of birth</dt>
            <dd className="text-ink">{formatDate(me.patient?.dateOfBirth)}</dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-slate-500">Registered at</dt>
            <dd className="text-ink">{me.facilityName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-slate-500">Sign-in detail</dt>
            <dd className="text-ink">{me.account?.loginIdentifier ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-slate-500">Last sign-in</dt>
            <dd className="text-ink">{formatDate(me.account?.lastLoginAt, true)}</dd>
          </div>
        </dl>

        <p className="mt-3 text-2xs leading-relaxed text-slate-500">
          If something here is wrong, ask for a correction below. This portal cannot edit your
          record — a clinician makes corrections under their own name, so the history stays honest.
        </p>
      </Panel>

      <Panel
        title="Digital patient card"
        subtitle="Show this at the desk. Scanning it helps staff find your record; it does not open it."
        icon={<QrCode className="h-5 w-5" />}
        action={
          <button type="button" className="btn-quiet" onClick={issueCard} disabled={cardBusy}>
            {card ? 'Re-issue' : 'Create'}
          </button>
        }
      >
        {cardError ? <Notice tone="warn">{cardError}</Notice> : null}

        {card ? (
          <div
            className="mx-auto max-w-[280px]"
            /*
             * The SVG is produced by the server from the card code and
             * contains no user-supplied text; the surround is generated
             * server-side and escaped there.
             */
            dangerouslySetInnerHTML={{ __html: card.svg }}
          />
        ) : !cardError ? (
          <Empty>No card has been created yet.</Empty>
        ) : null}

        {card?.issuedAt ? (
          <p className="mt-2 text-center text-2xs text-slate-500">
            Issued {formatDate(card.issuedAt, true)}
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Download your record"
        subtitle="A text copy, generated now for you. There is no permanent link to share."
        icon={<Download className="h-5 w-5" />}
      >
        <button type="button" className="btn-primary w-full" onClick={download} disabled={downloadBusy}>
          {downloadBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {downloadBusy ? 'Preparing…' : 'Download'}
        </button>
      </Panel>

      <Panel
        title="Ask for a correction"
        subtitle="The record is reviewed by a clinician; the portal cannot change it directly."
        icon={<FileText className="h-5 w-5" />}
      >
        <form className="space-y-3" onSubmit={submitCorrection}>
          <Field label="Which part of the record?">
            <select
              className="field-input"
              value={correction.recordType}
              onChange={(event) => setCorrection({ ...correction, recordType: event.target.value })}
            >
              <option>Registration details</option>
              <option>A visit</option>
              <option>A diagnosis</option>
              <option>A laboratory result</option>
              <option>A prescription</option>
              <option>An appointment</option>
            </select>
          </Field>

          <Field label="What should be corrected?">
            <textarea
              className="field-input h-24 py-2"
              value={correction.detail}
              onChange={(event) => setCorrection({ ...correction, detail: event.target.value })}
              placeholder="My date of birth is recorded as 1990; it should be 1991."
              required
            />
          </Field>

          <button type="submit" className="btn-primary w-full">
            Send request
          </button>
        </form>
      </Panel>

      <Panel title="Who has opened your record" icon={<ShieldCheck className="h-5 w-5" />}>
        {history.length === 0 ? (
          <Empty>No access has been recorded yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.slice(0, 12).map((event, index) => (
              <li key={`${event.createdAt}-${index}`} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-xs font-semibold text-ink">{event.action}</p>
                  <p className="text-2xs text-slate-500">{event.recordType ?? 'Record'}</p>
                </div>
                <span className="text-2xs text-slate-500">{formatDate(event.createdAt, true)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Change your password" icon={<KeyRound className="h-5 w-5" />}>
        <form className="space-y-3" onSubmit={submitPassword}>
          <Field label="Current password">
            <input
              className="field-input"
              type="password"
              autoComplete="current-password"
              value={password.currentPassword}
              onChange={(event) => setPassword({ ...password, currentPassword: event.target.value })}
              required
            />
          </Field>

          <Field label="New password" hint={`At least ${PASSWORD_MIN} characters.`}>
            <input
              className="field-input"
              type="password"
              autoComplete="new-password"
              value={password.newPassword}
              onChange={(event) => setPassword({ ...password, newPassword: event.target.value })}
              required
            />
          </Field>

          <Field label="Repeat the new password">
            <input
              className="field-input"
              type="password"
              autoComplete="new-password"
              value={password.confirmPassword}
              onChange={(event) => setPassword({ ...password, confirmPassword: event.target.value })}
              required
            />
          </Field>

          {notice ? <Notice tone={notice.tone === 'ok' ? 'ok' : 'danger'}>{notice.text}</Notice> : null}

          <button type="submit" className="btn-primary w-full">
            Change password
          </button>

          <p className="text-2xs text-slate-500">
            Changing your password signs out every other device.
          </p>
        </form>
      </Panel>

      <button
        type="button"
        className="btn-quiet w-full"
        onClick={async () => {
          await logoutPortal();
          clearPortalToken();
          onSignedOut();
        }}
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  );
}

/* ============================================================
   Shell
   ============================================================ */

type TabId = 'home' | 'records' | 'share' | 'account';

const TABS: Array<{ id: TabId; label: string; icon: React.ElementType }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'records', label: 'Records', icon: ClipboardList },
  { id: 'share', label: 'Share', icon: Share2 },
  { id: 'account', label: 'Account', icon: UserRound },
];

function PortalDashboard({ onSignedOut }: { onSignedOut: () => void }) {
  const [me, setMe] = useState<PortalMe | null>(null);
  const [overview, setOverview] = useState<PortalOverview | null>(null);
  const [tab, setTab] = useState<TabId>('home');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const profile = await portalApi.me();

        if (cancelled) return;

        setMe(profile);

        const summary = await portalApi.overview();

        if (cancelled) return;

        setOverview(summary);
      } catch (caught) {
        if (cancelled) return;

        if (caught instanceof PortalApiError && caught.status === 401) {
          clearPortalToken();
          onSignedOut();
          return;
        }

        setError(messageOf(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [onSignedOut]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();

    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';

    return 'Good evening';
  }, []);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Spinner label="Opening your record…" />
      </div>
    );
  }

  if (error || !me) {
    return (
      <div className="mx-auto w-full max-w-md">
        <Notice tone="danger">{error ?? 'Your session could not be read.'}</Notice>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <header className="rounded-2xl bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600 px-4 py-4 text-white shadow-card">
        <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-brand-100">
          {greeting}
        </p>
        <h1 className="mt-1 font-display text-xl font-semibold">
          {me.patient ? `${me.patient.firstName} ${me.patient.lastName}` : 'Your health record'}
        </h1>
        <p className="mt-1 text-xs text-brand-100">
          {me.facilityName ?? 'Facility'} · {me.patient?.mrn ?? ''}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-2xs font-semibold">
            {me.account?.status === 'ACTIVE' ? 'Account active' : me.account?.status ?? '—'}
          </span>

          <button
            type="button"
            className="rounded-full bg-ember-500 px-2.5 py-1 text-2xs font-bold text-navy-950"
            onClick={() => setTab('account')}
          >
            Digital card
            <ChevronRight className="ml-1 inline h-3 w-3" />
          </button>
        </div>
      </header>

      {/*
        Navigation is a bottom bar on a phone and a row of tabs above on a
        larger screen. Both operate the same `tab` state; there is no
        route change, because the portal is one authenticated page.
      */}
      <nav className="hidden gap-1 rounded-xl border border-slate-200 bg-surface p-1 sm:flex">
        {TABS.map((entry) => {
          const Icon = entry.icon;

          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cx(
                'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
                tab === entry.id
                  ? 'bg-brand-700 text-white'
                  : 'text-ink-soft hover:bg-brand-50 hover:text-brand-800',
              )}
            >
              <Icon className="h-4 w-4" />
              {entry.label}
            </button>
          );
        })}
      </nav>

      <div className="pb-20 sm:pb-0">
        {tab === 'home' && overview ? (
          <PortalHome overview={overview} onOpen={setTab} />
        ) : tab === 'home' ? (
          <Empty>Your dashboard could not be loaded.</Empty>
        ) : null}

        {tab === 'records' ? <PortalRecords overview={overview} /> : null}
        {tab === 'share' ? <PortalSharing /> : null}
        {tab === 'account' ? <PortalAccount me={me} onSignedOut={onSignedOut} /> : null}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-surface/95 backdrop-blur sm:hidden">
        {TABS.map((entry) => {
          const Icon = entry.icon;

          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cx(
                'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-2xs font-semibold',
                tab === entry.id ? 'text-brand-800' : 'text-slate-500',
              )}
            >
              <Icon className="h-5 w-5" />
              {entry.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/* ============================================================
   Entry point
   ============================================================ */

export const PatientPortalApp: React.FC = () => {
  const path = window.location.pathname;
  const [hasSession, setHasSession] = useState(() => Boolean(getPortalToken()));

  if (path === '/portal/activate') {
    return (
      <PortalFrame>
        <PortalActivation
          onDone={() => {
            window.location.replace('/portal');
          }}
        />
      </PortalFrame>
    );
  }

  return (
    <PortalFrame>
      {hasSession ? (
        <PortalDashboard onSignedOut={() => setHasSession(false)} />
      ) : (
        <PortalLogin onSignedIn={() => setHasSession(true)} />
      )}
    </PortalFrame>
  );
};

function PortalFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-canvas font-sans text-ink antialiased">
      <header className="border-b border-slate-200 bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.jpg"
              alt="JaliCare"
              className="h-9 w-9 rounded-lg object-cover ring-1 ring-slate-200"
            />
            <div>
              <p className="text-xs font-semibold leading-tight text-ink">JaliCare</p>
              <p className="text-2xs uppercase tracking-[0.16em] text-slate-500">
                Patient health record
              </p>
            </div>
          </div>

          <div className="h-1.5 w-10 rounded-full bg-ember-500" aria-hidden="true" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-4 sm:py-6">{children}</main>

      <footer className="mx-auto w-full max-w-3xl px-4 pb-8 pt-2">
        <p className="text-center text-2xs leading-relaxed text-slate-500">
          This portal shows the record held by your facility. It is not a national health information
          exchange, and it does not replace a clinical consultation.
        </p>
      </footer>
    </div>
  );
}
