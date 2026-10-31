import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BedDouble,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  ClipboardList,
  FileText,
  RefreshCw,
  Users,
  WalletCards,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import {
  kenyaToday,
  rangeForPreset,
  type DashboardRange,
  type DatePreset,
} from '../../dashboard/date-range.ts';
import type { DashboardOverview, DashboardPanel } from '../../dashboard/dashboard.types.ts';
import {
  CategoriesChart,
  FlowChart,
  ReceiptsChart,
  Sparkline,
  formatMoney,
  percentChange,
} from '../dashboard/Charts.tsx';
import { DateFilter, formatShortDate } from '../dashboard/DateFilter.tsx';
import { DashboardModule } from './DashboardModule.tsx';

type Icon = typeof Users;

function PanelMessage({ panel }: { panel: DashboardPanel<unknown> | undefined }) {
  if (!panel)
    return (
      <p className="dashboard-empty" role="status">
        Loading information…
      </p>
    );
  if (panel.status === 'ok') return null;
  return (
    <p className="dashboard-empty" role={panel.status === 'error' ? 'alert' : undefined}>
      {panel.message}
    </p>
  );
}

function Kpi({
  label,
  value,
  change,
  note,
  icon: Icon,
  color,
  spark,
}: {
  label: string;
  value: string;
  change: string | null;
  note: string;
  icon: Icon;
  color: string;
  spark?: number[];
}) {
  return (
    <article
      className={`metric-card metric-${color} relative min-h-[122px] overflow-hidden rounded-[10px] px-4 py-4 text-white`}
    >
      <div className="relative z-10 flex gap-4">
        <div className="metric-icon flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-[19px]">
          <Icon className="h-7 w-7" strokeWidth={2.3} />
        </div>
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium leading-tight text-white/95">{label}</h2>
          <p className="mt-1.5 break-words text-[23px] font-bold leading-none tracking-[-.025em]">
            {value}
          </p>
          <div className="mt-3 flex items-center gap-1 text-[10px] font-medium text-white/90">
            {change ? (
              <>
                <span className="flex items-center gap-0.5 font-bold text-white">
                  {change.startsWith('−') ? (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  )}
                  {change}
                </span>
                <span className="hidden xl:inline">vs previous period</span>
              </>
            ) : (
              <span>{note}</span>
            )}
          </div>
        </div>
      </div>
      {spark && (
        <div className="absolute bottom-2 right-2 opacity-80">
          <Sparkline values={spark} />
        </div>
      )}
    </article>
  );
}

function Card({
  title,
  icon: Icon,
  action,
  children,
  className = '',
}: {
  title: string;
  icon: Icon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`dashboard-card min-w-0 rounded-[10px] border border-[#dfe6f0] bg-white px-4 py-4 shadow-[0_2px_7px_rgba(24,48,89,.05)] ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-bold tracking-[-.025em] text-[#112344]">
          <Icon className="h-[17px] w-[17px] shrink-0 text-[#0757c9]" strokeWidth={2.5} />
          <span>{title}</span>
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const ActionLink: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-[#075cf1] hover:underline"
  >
    {children}
    <ArrowRight className="h-3 w-3" />
  </button>
);

function formatActivityTime(value: string): string {
  // Audit timestamps are stored without a timezone. Format their wall-clock
  // components as stored rather than silently inventing an offset.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return 'Time unavailable';
  const [, y, m, d, h, minute] = match.map(Number);
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(Date.UTC(y, m - 1, d, h, minute)));
}

function formatTime(value: string): string {
  const match = /[ T](\d{2}):(\d{2})/.exec(value);
  if (!match) return 'Time unavailable';
  const hour = Number(match[1]);
  if (hour > 23 || Number(match[2]) > 59) return 'Time unavailable';
  return `${String(hour % 12 || 12).padStart(2, '0')}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export const HospitalDashboard: React.FC = () => {
  const { currentFacility, authenticatedUser, setActiveModule, refreshKey } = useHmis();
  const [range, setRange] = useState<DashboardRange>(() => rangeForPreset('month'));
  const [preset, setPreset] = useState<DatePreset>('month');
  const [reload, setReload] = useState(0);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [state, setState] = useState<{
    key: string;
    data?: DashboardOverview;
    error?: string;
    loading?: boolean;
  } | null>(null);
  const key = `${currentFacility?.id ?? 'none'}:${range.start}:${range.end}:${refreshKey}:${reload}`;
  const current = state?.key === key ? state : null;
  const data = current?.data;
  const failedPanel = current?.error
    ? {
        status: 'error' as const,
        message: 'Dashboard request failed. Retry to load this information.',
      }
    : undefined;
  const perms = new Set(authenticatedUser?.permissions ?? []);
  const modules = new Set(currentFacility?.enabledModules ?? []);
  const hidden = new Set(currentFacility?.hiddenModules ?? []);
  const canOpen = (permission: string, module: string) =>
    perms.has(permission) && modules.has(module) && !hidden.has(module);

  useEffect(() => {
    if (!currentFacility?.id) return;
    const controller = new AbortController();
    const facilityId = currentFacility.id;
    setState({ key, loading: true });
    api
      .getDashboardOverview(facilityId, range, controller.signal)
      .then((overview) => {
        if (!controller.signal.aborted && overview.facilityId === facilityId)
          setState({ key, data: overview });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key,
            error:
              error instanceof Error ? error.message : 'Dashboard information could not be loaded.',
          });
      });
    return () => controller.abort();
  }, [key]);

  const registrations = data?.registrations.status === 'ok' ? data.registrations.data : null;
  const receipts = data?.receipts.status === 'ok' ? data.receipts.data : null;
  const invoices = data?.invoices.status === 'ok' ? data.invoices.data : null;
  const admissions = data?.admissions.status === 'ok' ? data.admissions.data : null;
  const activity = data?.activity.status === 'ok' ? data.activity.data : null;
  const appointments = data?.appointments.status === 'ok' ? data.appointments.data : null;
  const value = (item: number | null | undefined) =>
    item === null || item === undefined ? '—' : item.toLocaleString('en-KE');
  const caption = (panel: DashboardPanel<unknown> | undefined) =>
    !panel
      ? current?.error
        ? 'Unavailable'
        : 'Loading…'
      : panel.status === 'ok'
        ? 'No prior baseline'
        : panel.status === 'disabled'
          ? 'Module not enabled'
          : panel.status === 'restricted'
            ? 'Access restricted'
            : 'Unavailable';

  return (
    <div className="hospital-dashboard space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-0.5">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-[-.035em] text-[#102143] sm:text-[30px]">
            Hospital Dashboard
          </h1>
          <p className="mt-1 text-[13px] font-medium text-[#657894]">
            {currentFacility?.name || 'Select an authorized facility'}
            {currentFacility?.mflCode && <span> · MFL {currentFacility.mflCode}</span>}
          </p>
        </div>
        <DateFilter
          value={range}
          preset={preset}
          onChange={(next, selected) => {
            setRange(next);
            setPreset(selected);
          }}
        />
      </div>
      {!currentFacility && (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
        >
          An authorized facility is required before dashboard data can be loaded.
        </div>
      )}
      {current?.error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
        >
          <span>{current.error}</span>
          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            className="flex items-center gap-1 font-bold"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Patients registered"
          value={value(registrations?.current)}
          change={
            registrations ? percentChange(registrations.current, registrations.previous) : null
          }
          note={caption(data?.registrations)}
          icon={Users}
          color="blue"
          spark={registrations?.trend.map((p) => p.value)}
        />
        <Kpi
          label="Net recorded receipts"
          value={receipts ? formatMoney(receipts.net) : '—'}
          change={receipts ? percentChange(receipts.net, receipts.previousNet) : null}
          note={caption(data?.receipts)}
          icon={WalletCards}
          color="green"
          spark={receipts?.trend.map((p) => Number(p.net))}
        />
        <Kpi
          label="Invoices created"
          value={value(invoices?.current)}
          change={invoices ? percentChange(invoices.current, invoices.previous) : null}
          note={caption(data?.invoices)}
          icon={FileText}
          color="purple"
        />
        <Kpi
          label="Admission records"
          value={value(admissions?.current)}
          change={admissions ? percentChange(admissions.current, admissions.previous) : null}
          note={caption(data?.admissions)}
          icon={BedDouble}
          color="orange"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <Card
          title="Receipts Overview"
          icon={BarChart3}
          action={
            <span className="rounded-md border border-[#e4eaf2] px-2 py-1 text-[10px] text-[#617591]">
              Selected period
            </span>
          }
        >
          {receipts ? (
            <>
              <p className="mt-4 text-[25px] font-bold leading-none tracking-[-.035em] text-[#102143]">
                {formatMoney(receipts.net)}
              </p>
              <p className="mt-1.5 text-[11px] text-[#647793]">
                {percentChange(receipts.net, receipts.previousNet) ??
                  'No comparable prior baseline'}{' '}
                <span className="text-[#8998ad]">· recorded receipts less recorded refunds</span>
              </p>
              <ReceiptsChart points={receipts.trend} />
              <p className="mt-1 text-[10px] leading-snug text-[#8190a5]">
                Not recognized revenue or verified bank settlement.
              </p>
            </>
          ) : (
            <PanelMessage panel={data?.receipts ?? failedPanel} />
          )}
        </Card>
        <Card title="Billing by Service Category" icon={CircleDollarSign}>
          {invoices ? (
            <>
              <CategoriesChart categories={invoices.categories} />
              <p className="mt-2 text-[10px] leading-snug text-[#8190a5]">
                Line creation dates; non-void invoices. Billed amounts are not payments.
              </p>
            </>
          ) : (
            <PanelMessage panel={data?.invoices ?? failedPanel} />
          )}
        </Card>
        <Card
          title="Patient Flow"
          icon={BarChart3}
          action={
            <span className="rounded-md border border-[#e4eaf2] px-2 py-1 text-[10px] text-[#617591]">
              Selected period
            </span>
          }
        >
          {data?.flow.status === 'ok' ? (
            <>
              <FlowChart points={data.flow.data} />
              <p className="mt-1 text-[10px] leading-snug text-[#8190a5]">
                Registrations and distinct returning patients with encounters per interval.
              </p>
            </>
          ) : (
            <PanelMessage panel={data?.flow ?? failedPanel} />
          )}
        </Card>
        <Card
          title="Recent Activities"
          icon={ClipboardList}
          action={
            canOpen('audit.read', 'audit') ? (
              <ActionLink onClick={() => setActiveModule('audit')}>View all</ActionLink>
            ) : null
          }
        >
          {activity ? (
            activity.length ? (
              <ul className="mt-3 space-y-2.5">
                {activity.map((item) => (
                  <li key={item.id} className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#eaf2ff] text-[#075cf1]">
                      <Activity className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold text-[#172b48]">
                        {item.action.replace(/[_:]/g, ' ')}
                      </p>
                      <p className="truncate text-[10px] text-[#7789a2]">
                        {item.resource.replace(/[_:]/g, ' ')}
                      </p>
                    </div>
                    <time dateTime={item.at} className="shrink-0 text-[10px] text-[#71839d]">
                      {formatActivityTime(item.at)}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dashboard-empty">No audit activity in the selected period.</p>
            )
          ) : (
            <PanelMessage panel={data?.activity ?? failedPanel} />
          )}
        </Card>
        <Card
          title="Billing Status"
          icon={CircleDollarSign}
          action={
            canOpen('billing.read', 'finance') ? (
              <ActionLink onClick={() => setActiveModule('finance')}>View details</ActionLink>
            ) : null
          }
        >
          {invoices && receipts ? (
            <>
              <div className="mt-3 flex items-center gap-4">
                <div className="relative flex h-[100px] w-[100px] shrink-0 items-center justify-center rounded-full border-[9px] border-[#e8edf4]">
                  <div className="text-center">
                    <strong className="block text-[20px] leading-none text-[#152a49]">—</strong>
                    <span className="mt-1 block text-[9px] leading-tight text-[#6d809a]">
                      Collection rate
                      <br />
                      unavailable
                    </span>
                  </div>
                </div>
                <dl className="min-w-0 space-y-2 text-[10px]">
                  <div>
                    <dt className="text-[#7c8da4]">Billed · non-void invoices</dt>
                    <dd className="font-bold text-[#152a49]">{formatMoney(invoices.billed)}</dd>
                  </div>
                  <div>
                    <dt className="text-[#7c8da4]">Net recorded receipts</dt>
                    <dd className="font-bold text-[#152a49]">{formatMoney(receipts.net)}</dd>
                  </div>
                  <div>
                    <dt className="text-[#7c8da4]">Recorded invoice balance</dt>
                    <dd className="font-bold text-[#e77a0a]">
                      {formatMoney(invoices.recordedBalance)}
                    </dd>
                  </div>
                </dl>
              </div>
              <p className="mt-3 rounded-md bg-[#f2f6fc] px-2 py-2 text-[10px] leading-snug text-[#697d98]">
                Invoice balances are unreconciled. Receipt and invoice date cohorts differ; a
                collection rate cannot be inferred.
              </p>
            </>
          ) : (
            <PanelMessage panel={(invoices ? data?.receipts : data?.invoices) ?? failedPanel} />
          )}
        </Card>
        <Card
          title="Upcoming Appointments"
          icon={CalendarClock}
          action={
            canOpen('appointments.read', 'reception') ? (
              <ActionLink onClick={() => setActiveModule('reception')}>View all</ActionLink>
            ) : null
          }
        >
          {appointments ? (
            appointments.length ? (
              <ul className="mt-3 divide-y divide-[#eef1f6]">
                {appointments.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 py-2">
                    <time
                      dateTime={item.scheduledTime.replace(' ', 'T')}
                      className="w-[66px] shrink-0 rounded-md bg-[#f2f5fa] px-1 py-1.5 text-center text-[10px] font-semibold text-[#314965]"
                    >
                      {formatTime(item.scheduledTime)}
                      {item.scheduledTime.slice(0, 10) !== kenyaToday() && (
                        <span className="block text-[9px] font-medium text-[#6e809a]">
                          {formatShortDate(
                            item.scheduledTime.slice(0, 10),
                            item.scheduledTime.slice(0, 4) !== kenyaToday().slice(0, 4),
                          )}
                        </span>
                      )}
                    </time>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-semibold text-[#172b48]">
                        {item.patientName}
                      </span>
                      <span className="block truncate text-[10px] text-[#74859c]">
                        {item.appointmentType || 'Appointment'}
                        {item.practitionerName ? ` · ${item.practitionerName}` : ''}
                      </span>
                    </span>
                    {canOpen('appointments.read', 'reception') && (
                      <button
                        type="button"
                        onClick={() => setActiveModule('reception')}
                        className="rounded-md bg-[#075cf1] px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-[#064bd0]"
                      >
                        Reception
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dashboard-empty">
                No upcoming scheduled appointments with supported times in the selected dates.
              </p>
            )
          ) : (
            <PanelMessage panel={data?.appointments ?? failedPanel} />
          )}
          <p className="mt-2 text-[10px] leading-snug text-[#8190a5]">
            ISO-style scheduled times only. Review other formats and check-in in reception; this
            dashboard does not check a patient in.
          </p>
        </Card>
      </div>
      <p className="text-[10px] text-[#8190a5]">
        Date filters use recorded database calendar dates. Confirm the facility’s server timezone
        for historical timestamps.
      </p>
      <div className="rounded-[10px] border border-[#dfe6f0] bg-white">
        <button
          type="button"
          onClick={() => setLegacyOpen(!legacyOpen)}
          aria-expanded={legacyOpen}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-xs font-semibold text-[#304865]"
        >
          <span>Operational dashboard &amp; quick actions</span>
          {legacyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {legacyOpen && (
          <div className="border-t border-[#e8edf5] p-4">
            <DashboardModule />
          </div>
        )}
      </div>
    </div>
  );
};
