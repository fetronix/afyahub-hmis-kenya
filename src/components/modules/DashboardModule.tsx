import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { AnalyticsSummary, PublicHealthReport, QueueItem, InpatientBoard } from '../../types/index.ts';
import {
  Users,
  BedDouble,
  Activity,
  DollarSign,
  FlaskConical,
  Scissors,
  AlertTriangle,
  ArrowUpRight,
  Clock,
  Calendar,
  Building2,
  ShieldCheck,
  TrendingUp,
  HeartPulse,
  Stethoscope,
  RefreshCw,
} from 'lucide-react';

type KpiCardProps = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClassName?: string;
  value: React.ReactNode;
  unit?: React.ReactNode;
  footer?: React.ReactNode;
};

/**
 * One figure per card, one footer per card, footers pinned to the bottom.
 *
 * The previous cards each carried a different number of rows, so their
 * baselines drifted apart once two of them wrapped differently. A fixed
 * label / value / footer structure keeps a grid of them aligned whatever
 * text ends up inside.
 */
const KpiCard: React.FC<KpiCardProps> = ({
  label,
  icon: Icon,
  iconClassName = 'text-slate-400',
  value,
  unit,
  footer,
}) => (
  <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md">
    <div>
      <div className="flex items-start justify-between gap-3">
        <span className="text-2xs font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        <Icon className={`h-4 w-4 flex-shrink-0 ${iconClassName}`} />
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="font-mono text-2xl font-bold tabular-nums text-slate-900">
          {value}
        </span>
        {unit && <span className="text-2xs text-slate-500">{unit}</span>}
      </div>
    </div>

    <div className="mt-3 border-t border-slate-100 pt-2 text-2xs text-slate-500">
      {footer}
    </div>
  </div>
);

export const DashboardModule: React.FC = () => {
  const {
    currentFacility, setActiveModule, setSelectedPatient,
    setIsJourneyModalOpen, refreshKey, showToast, authenticatedUser
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

  return (
    <div className="space-y-6">
      {/* Top Banner with Facility & Compliance Status */}
      <div className="relative overflow-hidden bg-gradient-to-br from-white via-white to-slate-50 border border-slate-200/80 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              {currentFacility?.name || 'JaliCare Kenya Facility'}
            </h1>
            <span className="font-mono text-xs px-2 py-0.5 bg-blue-50 text-blue-900 rounded font-bold border border-blue-200/80">
              {currentFacility?.mflCode || 'Not configured'}
            </span>
            {loading && (
              <span className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-0.5 text-2xs font-medium text-slate-600">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Refreshing
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {currentFacility?.level} · {currentFacility?.county} County
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-stretch md:self-auto">
          <button
            onClick={() => setActiveModule('interoperability')}
            className="px-3.5 py-2 text-xs font-semibold text-blue-900 bg-blue-50/70 border border-blue-200 hover:bg-blue-100/70 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-blue-700" />
            <span>DHA Spec</span>
          </button>
        </div>
      </div>

      {loadError && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
        >
          {loadError} Figures shown as an em dash are unknown, not zero. Use
          Refresh to try again.
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {can('appointments.read') && (
          <KpiCard
            label="Active queues"
            icon={Users}
            iconClassName="text-blue-700"
            value={metric(summary?.activeQueuesCount)}
            unit="waiting"
            footer={
              <span className="flex items-center justify-between gap-2">
                <span>Average triage wait</span>
                <strong className="font-mono text-slate-600">not tracked</strong>
              </span>
            }
          />
        )}

        {can('inpatient.read') && (
          <KpiCard
            label="Bed occupancy"
            icon={BedDouble}
            iconClassName="text-orange-600"
            value={
              summary ? `${summary.bedOccupancyRate ?? 0}%` : '\u2014'
            }
            unit={summary ? `${summary.currentAdmissions ?? 0} admitted` : undefined}
            footer={
              <div className="space-y-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-1.5 rounded-full bg-orange-500"
                    style={{
                      width: `${Math.min(100, summary?.bedOccupancyRate ?? 0)}%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>Vitals overdue</span>
                  <strong
                    className={`font-mono ${
                      (inpatientBoard?.vitalsOverdueCount ?? 0) > 0
                        ? 'text-orange-700'
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
          <KpiCard
            label="Recorded paid amount"
            icon={DollarSign}
            iconClassName="text-blue-700"
            value={summary ? `KES ${Number(summary.totalRevenueKes).toLocaleString()}` : '\u2014'}
            unit={summary ? undefined : 'KES'}
            footer={
              <span className="flex items-center justify-between gap-2">
                <span>Outstanding</span>
                <strong className="font-mono text-orange-800">
                  {summary
                    ? `KES ${Number(summary.outstandingBillsKes).toLocaleString()}`
                    : '\u2014'}
                </strong>
              </span>
            }
          />
        )}

        {canAny('clinical.read', 'inpatient.read', 'laboratory.read', 'pharmacy.read') && (
          <KpiCard
            label="Theatre & lab"
            icon={Activity}
            iconClassName="text-blue-700"
            value={
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span>
                  {metric(summary?.scheduledSurgeries)}
                  <span className="ml-1 font-sans text-2xs font-medium text-slate-500">
                    surgeries
                  </span>
                </span>
                <span>
                  {metric(summary?.pendingLabOrders)}
                  <span className="ml-1 font-sans text-2xs font-medium text-slate-500">
                    pending labs
                  </span>
                </span>
              </span>
            }
            footer={
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span>
                  Low stock{' '}
                  <strong className="font-mono text-rose-600">
                    {metric(summary?.lowStockAlerts)}
                  </strong>
                </span>
                <span>
                  Expiring ≤30d{' '}
                  <strong
                    className={`font-mono ${
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

      {/* Ward Nursing Status — vitals and documentation by bed */}
      {canReadInpatient && inpatientBoard && (
        <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-gradient-to-r from-slate-50 to-white">
            <div className="flex items-center gap-2">
              <HeartPulse className="w-4 h-4 text-teal-700" />
              <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase">
                Ward Nursing Status
              </h2>
              <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-900 border border-teal-200 text-3xs font-semibold">
                {inpatientBoard.shift} shift
              </span>
            </div>

            <div className="flex items-center gap-3 text-2xs">
              <span className="text-slate-600">
                <strong className="font-mono text-slate-900">{inpatientBoard.admissionCount}</strong> admitted
              </span>
              <span className="text-slate-600">
                <strong className="font-mono text-slate-900">{inpatientBoard.occupancyRate}%</strong> occupancy
              </span>
              <span
                className={
                  inpatientBoard.vitalsOverdueCount > 0
                    ? 'text-orange-700 font-semibold'
                    : 'text-emerald-700 font-semibold'
                }
              >
                <strong className="font-mono">{inpatientBoard.vitalsOverdueCount}</strong> vitals overdue
              </span>
              {inpatientBoard.criticalVitalsCount > 0 && (
                <span className="text-rose-700 font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {inpatientBoard.criticalVitalsCount} critical
                </span>
              )}
              <button
                onClick={() => setActiveModule('inpatient')}
                className="text-blue-700 font-semibold hover:text-blue-900 flex items-center gap-1"
              >
                <span>Open Ward</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {inpatientBoard.rows.length === 0 ? (
            <div className="px-5 py-6 text-xs text-slate-500">
              No patients are currently admitted at this facility.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Patient</th>
                    <th className="px-4 py-2.5 font-medium">Ward / Bed</th>
                    <th className="px-4 py-2.5 font-medium">Admitted</th>
                    <th className="px-4 py-2.5 font-medium">Last Vitals</th>
                    <th className="px-4 py-2.5 font-medium">Flags</th>
                    <th className="px-4 py-2.5 font-medium text-right">Notes Today</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inpatientBoard.rows.map((row) => {
                    const critical = row.lastVitalsFlags.some(
                      (flag) => flag.severity === 'critical',
                    );

                    return (
                      <tr key={row.admissionId} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-900">
                            {row.patientName}
                          </div>
                          {row.patientMrn && (
                            <div className="font-mono text-3xs text-slate-500">
                              {row.patientMrn}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          {row.wardName}
                          <span className="ml-1 font-mono text-2xs text-teal-800">
                            #{row.bedNumber}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 font-mono text-2xs">
                          {row.admissionDate}
                        </td>
                        <td className="px-4 py-2.5">
                          {row.lastVitalsAt ? (
                            <span
                              className={
                                row.vitalsOverdue
                                  ? 'text-orange-700 font-semibold'
                                  : 'text-slate-700'
                              }
                            >
                              {row.hoursSinceVitals}h ago
                            </span>
                          ) : (
                            <span className="text-orange-700 font-semibold">
                              Never recorded
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {row.lastVitalsFlags.length === 0 ? (
                            <span className="text-2xs text-emerald-700">Normal</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {row.lastVitalsFlags.slice(0, 3).map((flag) => (
                                <span
                                  key={`${row.admissionId}-${flag.field}`}
                                  className={`px-1.5 py-0.5 rounded text-3xs font-semibold ${
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
                        <td className="px-4 py-2.5 text-right font-mono">
                          <span
                            className={
                              row.notesToday === 0
                                ? 'text-orange-700 font-semibold'
                                : 'text-slate-900'
                            }
                          >
                            {row.notesToday}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {inpatientBoard.vitalsOverdueCount > 0 && (
            <div className="px-5 py-2.5 border-t border-orange-200 bg-orange-50 flex items-center gap-2 text-2xs text-orange-900">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                {inpatientBoard.vitalsOverdueCount} admitted patient
                {inpatientBoard.vitalsOverdueCount === 1 ? '' : 's'} have no
                observation in the last 8 hours. Record vitals from the ward
                screen.
              </span>
            </div>
          )}
        </div>
      )}

      {/*
        * Two panels, one of them twice as wide. When either is missing the
        * grid drops to a single column, so the remaining panel does not sit
        * in a third of the width with two thirds of empty space beside it.
        */}
      <div
        className={`grid grid-cols-1 items-start gap-5 lg:gap-6 ${
          canReadQueues && canReadReports ? 'lg:grid-cols-3' : 'lg:grid-cols-1'
        }`}
      >
{can('appointments.read') && (
        <>
        {/* Real-time OPD Queue Station (2 cols) */}
        <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm lg:col-span-2">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-700" />
              <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase">
                Active Hospital Patient Queues
              </h2>
            </div>
            <button
              onClick={() => setActiveModule('reception')}
              className="text-xs text-blue-700 font-semibold hover:text-blue-900 flex items-center gap-1"
            >
              <span>Manage All Queues</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Token #</th>
                  <th className="px-4 py-2.5 font-medium">Queue Station</th>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 font-medium">Wait Time</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {queues.slice(0, 5).map((q) => (
                  <tr key={q.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-bold text-slate-900">{q.tokenNumber}</td>
                    <td className="px-4 py-3 font-sans text-slate-700">
                      <span className="font-medium">{q.queueType} Counter</span>
                    </td>
                    <td className="px-4 py-3 font-sans">
                      <span className={`px-2 py-0.5 rounded text-2xs font-semibold ${
                        q.priority === 'Emergency'
                          ? 'bg-rose-50 text-rose-700'
                          : q.priority === 'Priority'
                          ? 'bg-orange-50 text-orange-800 border border-orange-200'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {q.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{q.waitingTimeMinutes} mins</td>
                    <td className="px-4 py-3 font-sans">
                      <span className={`px-2 py-0.5 rounded text-2xs font-medium ${
                        q.status === 'In-Progress' ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {q.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-sans">
                      {can('patients.read') && (
                      <button
                        onClick={() => {
                          api.getPatient(q.patientId).then(p => {
                            setSelectedPatient(p);
                            setIsJourneyModalOpen(true);
                          });
                        }}
                        className="px-2.5 py-1 text-2xs font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
                      >
                        Patient Journey
                      </button>
                      )}
                    </td>
                  </tr>
                ))}
                {queues.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center font-sans text-slate-500">
                      No queue records to display. If activity is expected, verify queue data access.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>


        </>
        )}

        {/* Public Health & Kenya Surveillance Card (1 col) */}
        {can('reports.read') && (
        <>
        <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase">
                MOH 705 Surveillance
              </h2>
            </div>
            <button
              onClick={() => setActiveModule('public_health')}
              className="text-xs text-blue-700 font-semibold hover:text-blue-900"
            >
              Full Report
            </button>
          </div>

          <div className="p-4 space-y-3 flex-1">
            <div className="text-2xs text-slate-500 font-medium">
              Reports loaded: <strong className="text-slate-800 font-mono">{surveillance.length}</strong> · Surveillance reporting
            </div>

            <div className="space-y-2">
              {surveillance.length === 0 && (
                <p className="text-xs text-slate-500 py-3">
                  No surveillance reports are available for this facility.
                </p>
              )}
              {surveillance.map((rep) => (
                <div key={rep.id} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/60 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-slate-900">{rep.diseaseName}</div>
                    <div className="text-2xs text-slate-500 font-mono">
                      ICD-10: {rep.diseaseCode} · Age: {rep.ageGroup}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-base font-bold font-mono text-slate-900 tabular-nums">
                      {rep.casesCount}
                    </span>
                    <span className="text-2xs text-slate-400 block">cases</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200 text-2xs text-slate-500 flex items-center justify-between">
              <span>Notifiable Disease Sentinel</span>
              <span className="text-emerald-700 font-medium flex items-center gap-1">
                Not assessed
              </span>
            </div>
          </div>
        </div>
        </>
        )}
      </div>


    </div>
  );
};

