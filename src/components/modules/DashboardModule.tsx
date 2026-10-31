import React, { useEffect, useMemo, useState } from 'react';
import { useHmis, type ModuleId } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { InpatientBoard, PublicHealthReport, QueueItem } from '../../types/index.ts';
import { useInbox } from '../../context/InboxContext.tsx';
import type { DashboardOverview } from '../../dashboard/dashboard.types.ts';
import {
  Users,
  BedDouble,
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Clock,
  HeartPulse,
  UserPlus,
  Stethoscope,
  FlaskConical,
  Pill,
  Package,
  Receipt,
  FileCheck2,
  BarChart3,
  Baby,
  Scissors,
  Eye,
  Building2,
  type LucideIcon,
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

/* ----------------------------------------------------------------
   Small building blocks
   ---------------------------------------------------------------- */

type SectionProps = {
  step: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  action?: React.ReactNode;
};

const SectionHeading: React.FC<SectionProps> = ({ step, title, subtitle, icon: Icon, action }) => (
  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-100 bg-brand-50 font-mono text-2xs font-semibold text-brand-700">
        {step}
      </span>
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold leading-tight tracking-tight text-navy-900">
          <Icon className="h-4 w-4 text-brand-600" />
          {title}
        </h2>
        <p className="mt-0.5 text-2xs text-muted">{subtitle}</p>
      </div>
    </div>

    {action}
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

/* ----------------------------------------------------------------
   Quick actions — one entry per real module, gated twice
   ---------------------------------------------------------------- */

type QuickAction = {
  module: ModuleId;
  label: string;
  hint: string;
  icon: LucideIcon;
  permissions: string[];
};

/*
 * Ordered by the visit, not alphabetically. `permissions` mirrors the
 * sidebar's map; the module must also be enabled for the facility.
 */
const QUICK_ACTIONS: QuickAction[] = [
  {
    module: 'registration',
    label: 'Open patient directory',
    hint: 'Patient directory',
    icon: UserPlus,
    permissions: ['patients.read'],
  },
  {
    module: 'reception',
    label: 'Work the queue',
    hint: 'Reception & appointments',
    icon: Users,
    permissions: ['appointments.read'],
  },
  {
    module: 'opd',
    label: 'Open outpatient care',
    hint: 'Outpatient & triage',
    icon: Stethoscope,
    permissions: ['clinical.read'],
  },
  {
    module: 'laboratory',
    label: 'Review laboratory work',
    hint: 'Orders, results, verification',
    icon: FlaskConical,
    permissions: ['laboratory.read'],
  },
  {
    module: 'pharmacy',
    label: 'Open pharmacy',
    hint: 'Pharmacy & stock',
    icon: Pill,
    permissions: ['pharmacy.read'],
  },
  {
    module: 'inventory',
    label: 'Check stock levels',
    hint: 'Inventory & batches',
    icon: Package,
    permissions: ['inventory.read'],
  },
  {
    module: 'inpatient',
    label: 'Open the ward board',
    hint: 'Admissions & beds',
    icon: BedDouble,
    permissions: ['inpatient.read'],
  },
  {
    module: 'maternity',
    label: 'Maternity & MCH',
    hint: 'ANC, labour, postnatal',
    icon: Baby,
    permissions: ['maternity.read'],
  },
  {
    module: 'theatre',
    label: 'Theatre list',
    hint: 'Surgical cases',
    icon: Scissors,
    permissions: ['theatre.read'],
  },
  {
    module: 'specialty',
    label: 'Specialty clinics',
    hint: 'Dental, eye, ENT, renal',
    icon: Eye,
    permissions: ['clinical.read'],
  },
  {
    module: 'finance',
    label: 'Open billing',
    hint: 'Billing & cashier',
    icon: Receipt,
    permissions: ['billing.read'],
  },
  {
    module: 'claims',
    label: 'Work the claim queue',
    hint: 'SHA e-claims',
    icon: FileCheck2,
    permissions: ['insurance.read'],
  },
  {
    module: 'analytics',
    label: 'Open reports',
    hint: 'Revenue & utilisation',
    icon: BarChart3,
    permissions: ['reports.read'],
  },
  {
    module: 'configuration',
    label: 'Manage staff',
    hint: 'Staff, roles and settings',
    icon: Building2,
    permissions: ['users.invite', 'users.roles.manage'],
  },
];

/* ----------------------------------------------------------------
   Dashboard
   ---------------------------------------------------------------- */

export const DashboardModule: React.FC<{
  overview?: DashboardOverview;
  appointments?: React.ReactNode;
}> = ({ overview, appointments }) => {
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
    authenticatedUser?.isSuperAdmin || authenticatedUser?.roles?.includes('SUPER_ADMIN'),
  );
  const can = (permission: string) => !isSuperAdmin && permissions.has(permission);
  const canAny = (...required: string[]) =>
    !isSuperAdmin && required.some((permission) => permissions.has(permission));

  const facilityModules = useMemo(() => {
    const hidden = new Set(currentFacility?.hiddenModules ?? []);
    return new Set((currentFacility?.enabledModules ?? []).filter((module) => !hidden.has(module)));
  }, [currentFacility]);
  const canReadSurveillance = can('reports.read') && facilityModules.has('public_health');
  const canReadQueues = can('appointments.read') && facilityModules.has('reception');
  const canReadInpatient = can('inpatient.read') && facilityModules.has('inpatient');
  const canReadInventory = can('inventory.read') && facilityModules.has('inventory');
  const canReadTheatre = can('theatre.read') && facilityModules.has('theatre');
  const canReadLaboratory = can('laboratory.read') && facilityModules.has('laboratory');

  /* The same enablement rule the sidebar uses, for the same reason. */
  const moduleEnabled = (id: ModuleId): boolean => {
    if (id === 'platform_administration') return true;
    if (isSuperAdmin) return false;
    if (!currentFacility) return false;
    if (id === 'claims') {
      return facilityModules.has('insurance') || facilityModules.has('claims');
    }
    return facilityModules.has(id);
  };

  const [surveillance, setSurveillance] = useState<PublicHealthReport[] | null>(null);
  const [queues, setQueues] = useState<QueueItem[] | null>(null);
  const [inpatientBoard, setInpatientBoard] = useState<InpatientBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const inbox = useInbox();

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      setLoading(true);
      setLoadError(null);

      const tasks: Promise<void>[] = [];

      if (canReadSurveillance) {
        tasks.push(
          api
            .getPublicHealthReports(currentFacility?.id)
            .then((value) => {
              if (active) setSurveillance(value);
            })
            .catch((err) => {
              console.error('Failed to load surveillance reports:', err);
              if (active) {
                setSurveillance(null);
                setLoadError((previous) =>
                  [previous, 'Surveillance reports could not be loaded.'].filter(Boolean).join(' '),
                );
              }
            }),
        );
      } else {
        setSurveillance(null);
      }

      if (canReadQueues) {
        tasks.push(
          api
            .getQueues(currentFacility?.id, undefined, true)
            .then((value) => {
              if (active) setQueues(value);
            })
            .catch((err) => {
              console.error('Failed to load queues:', err);
              if (active) {
                setQueues(null);
                setLoadError((previous) =>
                  [previous, 'The patient queue could not be loaded.'].filter(Boolean).join(' '),
                );
              }
            }),
        );
      } else {
        setQueues(null);
      }

      if (canReadInpatient) {
        tasks.push(
          api
            .getInpatientBoard(currentFacility?.id)
            .then((value) => {
              if (active) setInpatientBoard(value);
            })
            .catch((err) => {
              console.error('Failed to load inpatient board:', err);
              if (active) {
                setInpatientBoard(null);
                setLoadError((previous) =>
                  [previous, 'The ward board could not be loaded.'].filter(Boolean).join(' '),
                );
              }
            }),
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

    return () => {
      active = false;
    };
  }, [
    currentFacility,
    refreshKey,
    canReadSurveillance,
    canReadQueues,
    canReadInpatient,
    facilityModules,
  ]);

  const quickActions = QUICK_ACTIONS.filter(
    (action) => moduleEnabled(action.module) && canAny(...action.permissions),
  ).slice(0, 6);
  const activeQueues = queues?.filter((queue) =>
    ['waiting', 'called', 'in-progress', 'in progress', 'serving'].includes(
      (queue.status ?? '').toLowerCase(),
    ),
  );
  const op = overview?.operations;
  const number = (value: number | undefined) =>
    value === undefined ? '—' : value.toLocaleString('en-KE');
  const stockGroupCount = (...groups: string[]) =>
    inbox.data && !inbox.error
      ? inbox.data.alertGroups
          .filter((group) => groups.includes(group.group))
          .reduce((total, group) => total + group.count, 0)
      : undefined;
  const cells: Array<{ label: string; value: string; note: string }> = [];
  if (canReadQueues) {
    cells.push({
      label: 'Queue tickets',
      value: number(op?.queues.status === 'ok' ? op.queues.data.active : undefined),
      note: 'Waiting or in progress',
    });
    cells.push({ label: 'Triage wait', value: '—', note: 'Live average not tracked' });
  }
  if (canReadInpatient) {
    cells.push({
      label: 'Occupied beds',
      value: number(op?.beds.status === 'ok' ? op.beds.data.occupied : undefined),
      note:
        op?.beds.status === 'ok' ? `${op.beds.data.total} beds recorded` : 'Bed board unavailable',
    });
    cells.push({
      label: 'Vitals overdue',
      value: number(inpatientBoard?.vitalsOverdueCount),
      note: 'Existing ward-board rule',
    });
  }
  if (canReadTheatre)
    cells.push({
      label: 'Theatre scheduled',
      value: number(op?.theatre.status === 'ok' ? op.theatre.data.scheduled : undefined),
      note: 'Scheduled case records',
    });
  if (canReadLaboratory)
    cells.push({
      label: 'Lab pending',
      value: number(op?.laboratory.status === 'ok' ? op.laboratory.data.pending : undefined),
      note: 'Open order records',
    });
  if (canReadInventory) {
    cells.push({
      label: 'Low stock / out',
      value: number(stockGroupCount('lowStock', 'stockout')),
      note: 'Active inventory items',
    });
    cells.push({
      label: 'Expiry alerts',
      value: number(stockGroupCount('expired', 'expiry7', 'expiry30')),
      note: 'Expired or within 30 days',
    });
  }

  return (
    <div className="space-y-5">
      {loadError && (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
        >
          {loadError} Unavailable figures are shown as a dash.
        </div>
      )}
      {cells.length > 0 && (
        <section
          className="overflow-hidden rounded-[10px] border border-[#dfe6f0] bg-white"
          aria-label="Operational overview"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#edf1f6] px-4 py-3">
            <h2 className="text-[15px] font-bold text-[#112344]">Operational overview</h2>
            <span className="text-[10px] text-slate-500">
              Current facility snapshot · not date filtered
            </span>
          </div>
          <div className="grid grid-cols-2 gap-px bg-[#eaf0f6] md:grid-cols-4 xl:grid-cols-8">
            {cells.map((cell) => (
              <div key={cell.label} className="min-w-0 bg-white px-3 py-3">
                <p className="text-[10px] font-semibold text-slate-500">{cell.label}</p>
                <p className="mt-1 text-lg font-bold text-[#152a49]">{cell.value}</p>
                <p className="mt-1 text-[10px] leading-snug text-slate-400">{cell.note}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------
          Your workspace — only modules this session can actually open
      --------------------------------------------------------------- */}

      {quickActions.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-navy-900">
                Your workspace
              </h2>
              <p className="mt-0.5 text-2xs text-muted">
                The tasks that match your role. Everything here is already permitted to this
                account.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.module}
                  onClick={() => setActiveModule(action.module)}
                  className="group flex items-center gap-3 rounded-card border border-hair bg-surface px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 transition-colors group-hover:bg-brand-600 group-hover:text-white">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-navy-900">
                      {action.label}
                    </span>
                    <span className="block truncate text-2xs text-muted">{action.hint}</span>
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-brand-600" />
                </button>
              );
            })}
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
              <button onClick={() => setActiveModule('reception')} className="btn-quiet self-start">
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
                    <th>Recorded wait</th>
                    <th>Status</th>
                    <th className="text-right">Patient</th>
                  </tr>
                </thead>
                <tbody>
                  {activeQueues?.slice(0, 5).map((q) => (
                    <tr key={q.id}>
                      <td className="font-mono font-semibold text-navy-900">{q.tokenNumber}</td>
                      <td className="text-ink-soft">{queueStationLabel(q.queueType)}</td>
                      <td>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-2xs font-semibold ${
                            q.priority === 'Emergency'
                              ? 'bg-rose-50 text-rose-700'
                              : q.priority === 'Priority'
                                ? 'border border-ember-200 bg-ember-50 text-ember-700'
                                : 'bg-slate-100 text-ink-soft'
                          }`}
                        >
                          {q.priority}
                        </span>
                      </td>
                      <td className="font-mono text-ink-soft">
                        {q.waitingTimeMinutes > 0
                          ? `${q.waitingTimeMinutes} min recorded`
                          : 'Not tracked'}
                      </td>
                      <td>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-2xs font-medium ${
                            q.status === 'In-Progress'
                              ? 'bg-brand-50 text-brand-800'
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
                              api
                                .getPatient(q.patientId)
                                .then((p) => {
                                  setSelectedPatient(p);
                                  setIsJourneyModalOpen(true);
                                })
                                .catch((err) => {
                                  console.error('Failed to load patient journey:', err);
                                  setLoadError((previous) =>
                                    [previous, 'Patient journey could not be loaded.']
                                      .filter(Boolean)
                                      .join(' '),
                                  );
                                });
                            }}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-2xs font-semibold text-brand-700 transition-colors hover:bg-brand-50"
                          >
                            Patient journey
                            <ArrowUpRight className="h-3 w-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}

                  {!queues && !loading && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                        Queue records are unavailable.
                      </td>
                    </tr>
                  )}
                  {activeQueues?.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                        No queue records to display. If activity is expected, verify queue data
                        access.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {activeQueues && activeQueues.length > 5 && (
              <div className="flex items-center justify-between border-t border-hair bg-slate-50/60 px-5 py-2.5 text-2xs text-muted">
                <span>Showing up to 5 recent open tickets</span>
                <button
                  onClick={() => setActiveModule('reception')}
                  className="font-semibold text-brand-700 hover:text-brand-900"
                >
                  See the whole queue
                </button>
              </div>
            )}
          </div>
          {appointments && <div className="mt-3">{appointments}</div>}
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
              <button onClick={() => setActiveModule('inpatient')} className="btn-quiet self-start">
                Open ward board
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            }
          />

          {inpatientBoard ? (
            <div className="panel overflow-hidden">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-hair px-5 py-3 text-2xs text-muted">
                <span className="chip">{(inpatientBoard.shift || 'Current') + ' shift'}</span>
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
                            <div className="font-semibold text-navy-900">{row.patientName}</div>
                            {row.patientMrn && (
                              <div className="font-mono text-3xs text-muted">{row.patientMrn}</div>
                            )}
                          </td>
                          <td className="text-ink-soft">
                            {row.wardName}
                            <span className="ml-1 font-mono text-2xs text-brand-700">
                              #{row.bedNumber}
                            </span>
                          </td>
                          <td className="font-mono text-2xs text-muted">{row.admissionDate}</td>
                          <td>
                            {row.lastVitalsAt ? (
                              <span
                                className={
                                  row.vitalsOverdue
                                    ? 'font-semibold text-ember-700'
                                    : 'text-ink-soft'
                                }
                              >
                                {row.hoursSinceVitals}h ago
                              </span>
                            ) : (
                              <span className="font-semibold text-ember-700">Never recorded</span>
                            )}
                          </td>
                          <td>
                            {!row.lastVitalsAt ? (
                              <span className="text-2xs text-muted">No observations</span>
                            ) : row.lastVitalsFlags.length === 0 ? (
                              <span className="text-2xs text-muted">No flags recorded</span>
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
                                  ? 'font-semibold text-ember-700'
                                  : 'text-navy-900'
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

              <p className="border-t border-hair px-5 py-2.5 text-2xs text-muted">
                The existing board uses an eight-hour overdue rule and adult reference flags. These
                are not a diagnosis; apply approved facility protocols and clinical judgment.
              </p>
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

      {(canReadTheatre || canReadLaboratory || canReadInventory) && (
        <section>
          <SectionHeading
            step="03"
            title="Theatre, laboratory & stores"
            subtitle="Review the underlying records in their authorized workspaces."
            icon={Activity}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            {canReadTheatre && (
              <div className="rounded-lg border border-hair bg-white p-4">
                <p className="text-xs font-bold text-navy-900">Theatre · scheduled cases</p>
                {op?.theatre.status === 'ok' ? (
                  op.theatre.data.samples.length ? (
                    <ul className="mt-2 space-y-1 text-2xs text-ink-soft">
                      {op.theatre.data.samples.map((item) => (
                        <li key={item.id}>
                          {item.procedure} · {item.start}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-2xs text-muted">No scheduled case records.</p>
                  )
                ) : (
                  <p className="mt-2 text-2xs text-muted">Case summary unavailable.</p>
                )}
                <p className="mt-2 text-2xs text-muted">
                  Readiness, consent and checklists require clinical review.
                </p>
              </div>
            )}
            {canReadLaboratory && (
              <div className="rounded-lg border border-hair bg-white p-4">
                <p className="text-xs font-bold text-navy-900">Laboratory · recent open orders</p>
                {op?.laboratory.status === 'ok' ? (
                  op.laboratory.data.samples.length ? (
                    <ul className="mt-2 space-y-1 text-2xs text-ink-soft">
                      {op.laboratory.data.samples.map((item) => (
                        <li key={item.id}>
                          {item.test} · {item.status || 'Status not recorded'}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-2xs text-muted">No open order records.</p>
                  )
                ) : (
                  <p className="mt-2 text-2xs text-muted">Order summary unavailable.</p>
                )}
                <p className="mt-2 text-2xs text-muted">
                  Critical flags require the facility escalation workflow.
                </p>
              </div>
            )}
            {canReadInventory && (
              <div className="rounded-lg border border-hair bg-white p-4">
                <p className="text-xs font-bold text-navy-900">Stores</p>
                <p className="mt-1 text-2xs text-muted">
                  Batch and stock details are available in the notification centre and inventory.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------
          03 — What the county is owed
      --------------------------------------------------------------- */}

      {canReadSurveillance && (
        <section>
          <SectionHeading
            step="04"
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
                <strong className="font-mono text-navy-900">
                  {surveillance ? surveillance.length : '—'}
                </strong>
              </span>
              <span className="text-2xs font-medium text-ember-700">Not assessed</span>
            </div>

            {!surveillance ? (
              <p className="px-5 py-8 text-center text-xs text-slate-500">
                Surveillance reports are unavailable.
              </p>
            ) : surveillance.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-slate-500">
                No surveillance reports are available for this facility.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-px bg-hair sm:grid-cols-2 xl:grid-cols-3">
                {surveillance.slice(0, 6).map((rep) => (
                  <div key={rep.id} className="bg-surface px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-navy-900">
                          {rep.diseaseName}
                        </div>
                        <div className="mt-0.5 font-mono text-3xs text-muted">
                          ICD-10 {rep.diseaseCode} · {rep.ageGroup}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-lg font-semibold tabular-nums text-navy-900">
                          {rep.casesCount}
                        </div>
                        <div className="text-3xs uppercase tracking-wide text-muted">cases</div>
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
        Figures cover {currentFacility?.name || 'this facility'} only and are read when this page
        loads. A queue ticket is a place in line, not a diagnosis; open the encounter for the
        clinical record.
      </p>
    </div>
  );
};
