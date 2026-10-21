import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { AnalyticsSummary, PublicHealthReport, QueueItem, InpatientBoard } from '../../types/index.ts';
import {
  Users,
  BedDouble,
  Activity,
  Wallet,
  AlertTriangle,
  ArrowUpRight,
  Clock,
  HeartPulse,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  ChevronRight,
} from 'lucide-react';

/*
|--------------------------------------------------------------------------
| The dashboard is a walk through the day
|--------------------------------------------------------------------------
|
| The panels are not a grid of unrelated numbers: they follow the
| patient. Arrival and queues, then the ward round, then the public
| health return the facility owes the county. Each section is numbered
| so the eye can move straight down the clinical path.
|
| Two rules hold for every figure here:
|
|   * a figure the server did not report is an em dash, never a zero;
|   * a panel the session may not read is not rendered at all.
|
*/

type SectionProps = {
  step: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
};

const SectionHeading: React.FC<SectionProps> = ({
  step,
  title,
  subtitle,
  icon: Icon,
  action,
}) => (
  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-pine-100 bg-pine-50 font-mono text-2xs font-semibold text-pine-700">
        {step}
      </span>
      <div>
        <h2 className="flex items-center gap-1.5 font-display text-lg leading-tight tracking-tight text-ink">
          <Icon className="h-4 w-4 text-pine-600" />
          {title}
        </h2>
        <p className="mt-0.5 text-2xs text-muted">{subtitle}</p>
      </div>
    </div>

    {action}
  </div>
);

type KpiCellProps = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: React.ReactNode;
  unit?: React.ReactNode;
  footer: React.ReactNode;
};

/**
 * One figure, one honest footer. The footer carries the caveat, so a
 * card can never look more certain than the data behind it.
 */
const KpiCell: React.FC<KpiCellProps> = ({ label, icon: Icon, value, unit, footer }) => (
  <div className="px-5 py-4">
    <div className="flex items-start justify-between gap-3">
      <span className="eyebrow">{label}</span>
      <Icon className="h-4 w-4 shrink-0 text-pine-500" />
    </div>

    <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-ink">
        {value}
      </span>
      {unit && <span className="text-2xs text-muted">{unit}</span>}
    </div>

    <div className="mt-3 border-t border-hair pt-2 text-2xs text-muted">{footer}</div>
  </div>
);

/*
 * Queue stations are named, not numbered. "Triage Counter" reads like a
 * till; the desk the patient actually walks to is the triage desk.
 */
const queueStationLabel = (queueType: string): string => {
  const known: Record<string, string> = {
    triage: 'Triage desk',
    doctor: 'Clinician consultation',
    consultation: 'Clinician consultation',
    laboratory: 'Laboratory bench',
    lab: 'Laboratory bench',
    pharmacy: 'Pharmacy counter',
  };

  return known[queueType.trim().toLowerCase()] ?? `${queueType} queue`;
};

export const DashboardModule: React.FC = () => {
  const {
    currentFacility,
    setActiveModule,
    setSelectedPatient,
    setIsJourneyModalOpen,
    refreshKey,
    authenticatedUser,
  } = useHmis();

  const permissions = new Set(authenticatedUser?.permissions ?? []);
  const isSuperAdmin = Boolean(
    authenticatedUser?.isSuperAdmin ||
    authenticatedUser?.roles?.includes('SUPER_ADMIN')
  );
  const can = (permission: string) =>
    isSuperAdmin || permissions.has(permission);
  const canAny = (...required: string[]) =>
    isSuperAdmin || required.some((permission) => permissions.has(permission));

  const canReadReports = can('reports.read');
  const canReadQueues = can('appointments.read');
  const canReadInpatient = can('inpatient.read');

  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [surveillance, setSurveillance] = useState<PublicHealthReport[]>([]);
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [inpatientBoard, setInpatientBoard] = useState<InpatientBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /*
   * A figure the server has not reported is unknown, not zero. Rendering
   * "0" when the request failed would be an assertion nobody made.
   */
  const metric = (value: number | null | undefined): string =>
    summary ? String(value ?? 0) : '\u2014';

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      setLoading(true);
      setLoadError(null);

      const tasks: Promise<void>[] = [];

      if (canReadReports) {
        tasks.push(
          api.getAnalyticsSummary(currentFacility?.id)
            .then((value) => { if (active) setSummary(value); })
            .catch((err) => {
              console.error('Failed to load analytics summary:', err);
              if (active) {
                setSummary(null);
                setLoadError('Some figures could not be loaded.');
              }
            })
        );

        tasks.push(
          api.getPublicHealthReports(currentFacility?.id)
            .then((value) => { if (active) setSurveillance(value); })
            .catch((err) => {
              console.error('Failed to load surveillance reports:', err);
              if (active) setSurveillance([]);
            })
        );
      } else {
        setSummary(null);
        setSurveillance([]);
      }

      if (canReadQueues) {
        tasks.push(
          api.getQueues(currentFacility?.id)
            .then((value) => { if (active) setQueues(value); })
            .catch((err) => {
              console.error('Failed to load queues:', err);
              if (active) {
                setQueues([]);
                setLoadError('The patient queue could not be loaded.');
              }
            })
        );
      } else {
        setQueues([]);
      }

      if (canReadInpatient) {
        tasks.push(
          api.getInpatientBoard(currentFacility?.id)
            .then((value) => { if (active) setInpatientBoard(value); })
            .catch((err) => {
              console.error('Failed to load inpatient board:', err);
              if (active) {
                setInpatientBoard(null);
                setLoadError('The ward board could not be loaded.');
              }
            })
        );
      } else {
        setInpatientBoard(null);
      }

      try {
        await Promise.all(tasks);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadDashboard();

    return () => { active = false; };
  }, [currentFacility, refreshKey, canReadReports, canReadQueues, canReadInpatient]);

  const hasAnyKpi =
    can('appointments.read') ||
    can('inpatient.read') ||
    can('billing.read') ||
    canAny('clinical.read', 'inpatient.read', 'laboratory.read', 'pharmacy.read');

  return (
    <div className="space-y-8">
      {/* ---------------------------------------------------------------
          Where you are, who you are serving
      --------------------------------------------------------------- */}

      <section className="relative overflow-hidden rounded-card border border-hair bg-gradient-to-br from-white via-white to-pine-50/70 p-6 shadow-card sm:p-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full border border-pine-100/70"
        />

        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="eyebrow">Today at the facility</p>

            <div className="mt-2 flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-[1.7rem] leading-tight tracking-tight text-ink">
                {currentFacility?.name || 'JaliCare Kenya Facility'}
              </h1>

              <span className="chip font-mono">
                MFL {currentFacility?.mflCode || 'not configured'}
              </span>

              {loading && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-pine-200 bg-white px-2.5 py-1 text-2xs font-medium text-pine-800">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Refreshing
                </span>
              )}
            </div>

            <p className="mt-1.5 text-xs text-muted">
              {currentFacility?.level || 'Level not configured'}
              {currentFacility?.county ? ` · ${currentFacility.county} County` : ''}
            </p>
          </div>

          <button
            onClick={() => setActiveModule('interoperability')}
            className="btn-quiet self-start md:self-auto"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-pine-600" />
            DHA readiness
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
          </button>
        </div>
      </section>

      {loadError && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
        >
          {loadError} Figures shown as an em dash are unknown, not zero. Reload
          the page to try again.
        </div>
      )}

      {/* ---------------------------------------------------------------
          The shift in four numbers
      --------------------------------------------------------------- */}

      {hasAnyKpi && (
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-hair px-5 py-3">
            <span className="eyebrow">The shift in four numbers</span>
            <span className="text-2xs text-slate-400">Live from this facility only</span>
          </div>

          <div className="grid grid-cols-1 divide-y divide-hair sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
            {can('appointments.read') && (
              <KpiCell
                label="Waiting in queues"
                icon={Users}
                value={metric(summary?.activeQueuesCount)}
                unit="tickets open"
                footer={
                  <span className="flex items-center justify-between gap-2">
                    <span>Average triage wait</span>
                    <strong className="font-mono font-semibold text-slate-600">
                      not tracked
                    </strong>
                  </span>
                }
              />
            )}

            {can('inpatient.read') && (
              <KpiCell
                label="Beds occupied"
                icon={BedDouble}
                value={summary ? `${summary.bedOccupancyRate ?? 0}%` : '\u2014'}
                unit={summary ? `${summary.currentAdmissions ?? 0} admitted` : undefined}
                footer={
                  <div className="space-y-1.5">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-1.5 rounded-full bg-pine-600"
                        style={{
                          width: `${Math.min(100, summary?.bedOccupancyRate ?? 0)}%`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>Vitals overdue</span>
                      <strong
                        className={`font-mono font-semibold ${
                          (inpatientBoard?.vitalsOverdueCount ?? 0) > 0
                            ? 'text-clay-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {inpatientBoard ? inpatientBoard.vitalsOverdueCount : '\u2014'}
                      </strong>
                    </div>
                  </div>
                }
              />
            )}

            {can('billing.read') && (
              <KpiCell
                label="Paid to date"
                icon={Wallet}
                value={
                  summary
                    ? `KES ${Number(summary.totalRevenueKes).toLocaleString()}`
                    : '\u2014'
                }
                footer={
                  <span className="flex items-center justify-between gap-2">
                    <span>Outstanding</span>
                    <strong className="font-mono font-semibold text-clay-700">
                      {summary
                        ? `KES ${Number(summary.outstandingBillsKes).toLocaleString()}`
                        : '\u2014'}
                    </strong>
                  </span>
                }
              />
            )}

            {canAny('clinical.read', 'inpatient.read', 'laboratory.read', 'pharmacy.read') && (
              <KpiCell
                label="Theatre, lab & stores"
                icon={Activity}
                value={
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span>
                      {metric(summary?.scheduledSurgeries)}
                      <span className="ml-1 font-sans text-2xs font-medium text-muted">
                        surgeries
                      </span>
                    </span>
                    <span>
                      {metric(summary?.pendingLabOrders)}
                      <span className="ml-1 font-sans text-2xs font-medium text-muted">
                        labs pending
                      </span>
                    </span>
                  </span>
                }
                footer={
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span>
                      Low stock{' '}
                      <strong className="font-mono font-semibold text-rose-600">
                        {metric(summary?.lowStockAlerts)}
                      </strong>
                    </span>
                    <span>
                      Expiring ≤30d{' '}
                      <strong
                        className={`font-mono font-semibold ${
                          (summary?.expiringStockAlerts ?? 0) > 0
                            ? 'text-amber-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {metric(summary?.expiringStockAlerts)}
                      </strong>
                    </span>
                  </div>
                }
              />
            )}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------
          01 — Arrival and queues
      --------------------------------------------------------------- */}

      {canReadQueues && (
        <section>
          <SectionHeading
            step="01"
            title="Arrival & queues"
            subtitle="The front door: who is waiting, at which desk, and for how long."
            icon={Clock}
            action={
              <button
                onClick={() => setActiveModule('reception')}
                className="btn-quiet self-start"
              >
                Manage all queues
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            }
          />

          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-quiet">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Desk</th>
                    <th>Priority</th>
                    <th>Waiting</th>
                    <th>Status</th>
                    <th className="text-right">Patient</th>
                  </tr>
                </thead>
                <tbody>
                  {queues.slice(0, 5).map((q) => (
                    <tr key={q.id}>
                      <td className="font-mono font-semibold text-ink">{q.tokenNumber}</td>
                      <td className="text-ink-soft">{queueStationLabel(q.queueType)}</td>
                      <td>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-2xs font-semibold ${
                            q.priority === 'Emergency'
                              ? 'bg-rose-50 text-rose-700'
                              : q.priority === 'Priority'
                              ? 'border border-clay-200 bg-clay-50 text-clay-700'
                              : 'bg-slate-100 text-ink-soft'
                          }`}
                        >
                          {q.priority}
                        </span>
                      </td>
                      <td className="font-mono text-ink-soft">
                        {q.waitingTimeMinutes} min
                      </td>
                      <td>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-2xs font-medium ${
                            q.status === 'In-Progress'
                              ? 'bg-pine-50 text-pine-800'
                              : 'bg-slate-100 text-ink-soft'
                          }`}
                        >
                          {q.status}
                        </span>
                      </td>
                      <td className="text-right">
                        {can('patients.read') && (
                          <button
                            onClick={() => {
                              api.getPatient(q.patientId).then((p) => {
                                setSelectedPatient(p);
                                setIsJourneyModalOpen(true);
                              });
                            }}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-2xs font-semibold text-pine-700 transition-colors hover:bg-pine-50"
                          >
                            Patient journey
                            <ArrowUpRight className="h-3 w-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}

                  {queues.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                        No queue records to display. If activity is expected,
                        verify queue data access.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {queues.length > 5 && (
              <div className="flex items-center justify-between border-t border-hair bg-slate-50/60 px-5 py-2.5 text-2xs text-muted">
                <span>Showing the first 5 of {queues.length} open tickets</span>
                <button
                  onClick={() => setActiveModule('reception')}
                  className="font-semibold text-pine-700 hover:text-pine-900"
                >
                  See the whole queue
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------
          02 — The ward round
      --------------------------------------------------------------- */}

      {canReadInpatient && (
        <section>
          <SectionHeading
            step="02"
            title="Ward round"
            subtitle="Observations, documentation and escalation for every admitted patient."
            icon={HeartPulse}
            action={
              <button
                onClick={() => setActiveModule('inpatient')}
                className="btn-quiet self-start"
              >
                Open ward board
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            }
          />

          {inpatientBoard ? (
            <div className="panel overflow-hidden">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-hair px-5 py-3 text-2xs text-muted">
                <span className="chip">{(inpatientBoard.shift || 'Current') + ' shift'}</span>
                <span>
                  <strong className="font-mono text-sm text-ink">
                    {inpatientBoard.admissionCount}
                  </strong>{' '}
                  admitted
                </span>
                <span>
                  <strong className="font-mono text-sm text-ink">
                    {inpatientBoard.occupancyRate}%
                  </strong>{' '}
                  occupancy
                </span>
                <span
                  className={
                    inpatientBoard.vitalsOverdueCount > 0
                      ? 'font-semibold text-clay-700'
                      : 'font-semibold text-emerald-700'
                  }
                >
                  <strong className="font-mono">{inpatientBoard.vitalsOverdueCount}</strong>{' '}
                  vitals overdue
                </span>
                {inpatientBoard.criticalVitalsCount > 0 && (
                  <span className="flex items-center gap-1 font-semibold text-rose-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {inpatientBoard.criticalVitalsCount} critical
                  </span>
                )}
              </div>

              {inpatientBoard.rows.length === 0 ? (
                <div className="px-5 py-8 text-xs text-slate-500">
                  No patients are currently admitted at this facility.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-quiet">
                    <thead>
                      <tr>
                        <th>Patient</th>
                        <th>Ward / bed</th>
                        <th>Admitted</th>
                        <th>Last vitals</th>
                        <th>Flags</th>
                        <th className="text-right">Notes today</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inpatientBoard.rows.map((row) => (
                        <tr key={row.admissionId}>
                          <td>
                            <div className="font-semibold text-ink">{row.patientName}</div>
                            {row.patientMrn && (
                              <div className="font-mono text-3xs text-muted">
                                {row.patientMrn}
                              </div>
                            )}
                          </td>
                          <td className="text-ink-soft">
                            {row.wardName}
                            <span className="ml-1 font-mono text-2xs text-pine-700">
                              #{row.bedNumber}
                            </span>
                          </td>
                          <td className="font-mono text-2xs text-muted">
                            {row.admissionDate}
                          </td>
                          <td>
                            {row.lastVitalsAt ? (
                              <span
                                className={
                                  row.vitalsOverdue
                                    ? 'font-semibold text-clay-700'
                                    : 'text-ink-soft'
                                }
                              >
                                {row.hoursSinceVitals}h ago
                              </span>
                            ) : (
                              <span className="font-semibold text-clay-700">
                                Never recorded
                              </span>
                            )}
                          </td>
                          <td>
                            {row.lastVitalsFlags.length === 0 ? (
                              <span className="text-2xs text-emerald-700">Normal</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {row.lastVitalsFlags.slice(0, 3).map((flag) => (
                                  <span
                                    key={`${row.admissionId}-${flag.field}`}
                                    className={`rounded px-1.5 py-0.5 text-3xs font-semibold ${
                                      flag.severity === 'critical'
                                        ? 'bg-rose-600 text-white'
                                        : 'bg-amber-200 text-amber-900'
                                    }`}
                                  >
                                    {flag.label} {flag.value}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="text-right font-mono">
                            <span
                              className={
                                row.notesToday === 0
                                  ? 'font-semibold text-clay-700'
                                  : 'text-ink'
                              }
                            >
                              {row.notesToday}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {inpatientBoard.vitalsOverdueCount > 0 && (
                <div className="flex items-center gap-2 border-t border-clay-200 bg-clay-50 px-5 py-2.5 text-2xs text-clay-800">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {inpatientBoard.vitalsOverdueCount} admitted patient
                    {inpatientBoard.vitalsOverdueCount === 1 ? '' : 's'} have no
                    observation in the last 8 hours. Record vitals from the ward
                    screen.
                  </span>
                </div>
              )}
            </div>
          ) : (
            !loading && (
              <div className="panel flex items-center gap-3 px-5 py-6 text-xs text-muted">
                <BedDouble className="h-4 w-4 text-slate-400" />
                The ward board is not available for this session.
              </div>
            )
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------
          03 — What the county is owed
      --------------------------------------------------------------- */}

      {canReadReports && (
        <section>
          <SectionHeading
            step="03"
            title="Surveillance & reporting"
            subtitle="Notifiable disease counts this facility reports to the county."
            icon={AlertTriangle}
            action={
              <button
                onClick={() => setActiveModule('public_health')}
                className="btn-quiet self-start"
              >
                Open MOH 705
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            }
          />

          <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hair px-5 py-3">
              <span className="text-2xs text-muted">
                Reports loaded:{' '}
                <strong className="font-mono text-ink">{surveillance.length}</strong>
              </span>
              <span className="text-2xs font-medium text-clay-700">Not assessed</span>
            </div>

            {surveillance.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-slate-500">
                No surveillance reports are available for this facility.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-px bg-hair sm:grid-cols-2 xl:grid-cols-3">
                {surveillance.slice(0, 6).map((rep) => (
                  <div key={rep.id} className="bg-surface px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-ink">
                          {rep.diseaseName}
                        </div>
                        <div className="mt-0.5 font-mono text-3xs text-muted">
                          ICD-10 {rep.diseaseCode} · {rep.ageGroup}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-lg font-semibold tabular-nums text-ink">
                          {rep.casesCount}
                        </div>
                        <div className="text-3xs uppercase tracking-wide text-muted">
                          cases
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Scope note. No call to action: the rail already does that. */}
      <p className="pt-1 text-center text-3xs leading-relaxed text-slate-400">
        Figures cover {currentFacility?.name || 'this facility'} only and are
        read when this page loads. A queue ticket is a place in line, not a
        diagnosis; open the encounter for the clinical record.
      </p>

    </div>
  );
};
