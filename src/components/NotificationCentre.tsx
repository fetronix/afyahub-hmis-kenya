import React, { useEffect, useRef } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Info,
  RefreshCw,
  X,
} from 'lucide-react';
import { useHmis } from '../context/HmisContext.tsx';
import { useInbox } from '../context/InboxContext.tsx';
import type { InboxItem, NotificationSeverity } from '../notifications/inbox.types.ts';
import { Pagination } from './ui/controls.tsx';

export const NotificationPanel = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<'section'>
>(function NotificationPanel({ children, className = '', ...props }, ref) {
  return (
    <section
      ref={ref}
      {...props}
      className={`fixed left-2 right-2 top-[68px] z-50 flex max-h-[calc(100dvh-76px)] flex-col overflow-hidden rounded-2xl border border-[#dfe6ef] bg-white shadow-[0_18px_52px_rgba(15,34,68,.23)] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[430px] ${className}`}
    >
      {children}
    </section>
  );
});

const styles: Record<
  NotificationSeverity,
  { label: string; icon: typeof Info; pill: string; tile: string }
> = {
  CRITICAL: {
    label: 'Critical',
    icon: AlertCircle,
    pill: 'bg-rose-50 text-rose-700',
    tile: 'bg-rose-100 text-rose-700',
  },
  WARNING: {
    label: 'Warning',
    icon: AlertTriangle,
    pill: 'bg-orange-50 text-orange-700',
    tile: 'bg-orange-100 text-orange-700',
  },
  INFO: {
    label: 'Info',
    icon: Info,
    pill: 'bg-blue-50 text-blue-700',
    tile: 'bg-blue-100 text-blue-700',
  },
  SUCCESS: {
    label: 'Success',
    icon: CheckCircle2,
    pill: 'bg-emerald-50 text-emerald-700',
    tile: 'bg-emerald-100 text-emerald-700',
  },
};

function displayTime(item: InboxItem, timezone: string): string {
  if (item.timeKind === 'detected') {
    const date = new Date(item.at);
    if (Number.isNaN(date.getTime())) return 'Detection time unavailable';
    return `Detected ${new Intl.DateTimeFormat('en-KE', { timeZone: timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)}`;
  }
  // Existing source timestamps are timestamp-without-zone: show their written components, not an invented offset.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(item.at);
  if (!match) return 'Recorded time unavailable';
  return `Recorded ${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]} (stored time)`;
}

export const NotificationBell: React.FC = () => {
  const inbox = useInbox();
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (inbox.open) {
      panelRef.current?.focus();
      wasOpen.current = true;
    } else if (wasOpen.current) {
      bellRef.current?.focus();
      wasOpen.current = false;
    }
  }, [inbox.open]);
  const { authenticatedUser, currentFacility, setActiveModule } = useHmis();
  const unread = inbox.error ? null : inbox.data?.unreadCount;
  const criticalActive =
    !inbox.error && Boolean(inbox.data?.alertGroups.some((group) => group.severity === 'CRITICAL'));
  const canNavigate = (item: InboxItem) => {
    const permission: Record<InboxItem['destination'], string> = {
      registration: 'patients.read',
      reception: 'appointments.read',
      inpatient: 'inpatient.read',
      theatre: 'theatre.read',
      laboratory: 'laboratory.read',
      inventory: 'inventory.read',
      finance: 'billing.read',
    };
    return (
      !authenticatedUser?.isSuperAdmin &&
      !authenticatedUser?.roles?.includes('SUPER_ADMIN') &&
      Boolean(authenticatedUser?.permissions?.includes(permission[item.destination])) &&
      Boolean(currentFacility?.enabledModules?.includes(item.destination)) &&
      !currentFacility?.hiddenModules?.includes(item.destination)
    );
  };
  return (
    <>
      <button
        ref={bellRef}
        type="button"
        onClick={() => inbox.setOpen(!inbox.open)}
        aria-expanded={inbox.open}
        aria-controls="notification-centre"
        aria-label={
          unread === undefined || unread === null
            ? 'Notifications'
            : `Notifications, ${unread} unread${criticalActive ? ', critical alerts active' : ''}`
        }
        className="relative flex h-10 w-10 items-center justify-center rounded-lg text-[#183053] hover:bg-[#f2f5fa] focus-visible:outline-2 focus-visible:outline-blue-600"
      >
        <Bell className="h-[19px] w-[19px]" />
        {typeof unread === 'number' && unread > 0 && (
          <span
            aria-hidden="true"
            className={`absolute right-0 top-0 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-white ${criticalActive ? 'bg-rose-600' : 'bg-blue-600'}`}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
        {criticalActive && !(typeof unread === 'number' && unread > 0) && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-rose-600"
          />
        )}
        {inbox.error && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500"
          />
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {typeof unread === 'number'
          ? `${unread} unread notifications${criticalActive ? ', critical alerts active' : ''}`
          : ''}
      </span>
      {inbox.open && (
        <NotificationPanel
          ref={panelRef}
          tabIndex={-1}
          id="notification-centre"
          role="region"
          aria-label="Notification centre"
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
            <div>
              <h2 className="text-[15px] font-bold text-[#102443]">Notification centre</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {inbox.data && !inbox.error
                  ? `${inbox.data.unreadCount} unread · ${inbox.data.unreadCritical} critical unread${criticalActive ? ' · critical alert active' : ''}`
                  : 'Facility-scoped updates'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={inbox.refresh}
                aria-label="Refresh notifications"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <RefreshCw className={`h-4 w-4 ${inbox.loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => inbox.setOpen(false)}
                aria-label="Close notification centre"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Filter by severity
            </span>
            <button
              type="button"
              disabled={!inbox.data?.unreadCount || inbox.busy || Boolean(inbox.error)}
              onClick={() => void inbox.mark('all')}
              className="text-[11px] font-bold text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400"
            >
              Mark all read
            </button>
          </div>
          <div
            className="flex shrink-0 gap-1 overflow-x-auto px-4 pb-3"
            aria-label="Notification severity filters"
          >
            {([undefined, 'CRITICAL', 'WARNING', 'INFO', 'SUCCESS'] as const).map((level) => (
              <button
                key={level ?? 'all'}
                type="button"
                aria-pressed={inbox.severity === level}
                onClick={() => inbox.setSeverity(level)}
                className={`shrink-0 rounded-full px-2.5 py-1.5 text-[10px] font-semibold ${inbox.severity === level ? 'bg-[#18345e] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {level ? styles[level].label : 'All'}
              </button>
            ))}
          </div>
          {inbox.error ? (
            <div
              role="alert"
              className="mx-4 mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900"
            >
              {inbox.error}{' '}
              {inbox.available && (
                <button type="button" onClick={inbox.refresh} className="font-bold underline">
                  Retry
                </button>
              )}
            </div>
          ) : !inbox.data ? (
            <p role="status" className="px-5 py-10 text-center text-xs text-slate-500">
              Loading notifications…
            </p>
          ) : (
            <>
              <div className="min-h-0 max-h-[min(54vh,480px)] flex-1 overflow-y-auto border-t border-slate-100">
                {inbox.data.items.length === 0 ? (
                  <div className="px-5 py-10 text-center">
                    <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-500" />
                    <p className="mt-2 text-sm font-semibold text-slate-700">
                      No notifications in this view
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {inbox.data.availableSources.length
                        ? 'Events cover the last seven facility calendar days.'
                        : 'No supported sources are available for this account.'}
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {inbox.data.items.map((item) => {
                      const tone = styles[item.severity],
                        Icon = tone.icon;
                      return (
                        <li
                          key={item.key}
                          className={`px-4 py-3.5 ${item.read ? 'bg-white' : 'bg-blue-50/30'}`}
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone.tile}`}
                            >
                              <Icon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="text-[12px] font-bold text-[#18304e]">{item.title}</p>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${tone.pill}`}
                                >
                                  {tone.label}
                                </span>
                                {!item.read && (
                                  <span
                                    className="h-1.5 w-1.5 rounded-full bg-blue-600"
                                    aria-label="Unread"
                                  />
                                )}
                              </div>
                              <p className="mt-1 break-words text-[11px] leading-relaxed text-slate-600">
                                {item.details}
                              </p>
                              <p className="mt-1.5 text-[10px] text-slate-500">
                                {item.source} · {displayTime(item, inbox.data!.timezone)}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-3">
                                {canNavigate(item) && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveModule(item.destination);
                                      inbox.setOpen(false);
                                    }}
                                    className="text-[11px] font-bold text-blue-700 hover:underline"
                                  >
                                    Open{' '}
                                    {item.destination === 'finance' ? 'billing' : item.destination}
                                  </button>
                                )}
                                {!item.read && (
                                  <button
                                    type="button"
                                    disabled={inbox.busy}
                                    onClick={() => void inbox.mark(item.key)}
                                    aria-label={`Mark ${item.title} read`}
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-blue-700 disabled:opacity-50"
                                  >
                                    <Check className="h-3 w-3" /> Mark read
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="shrink-0 border-t border-slate-100 px-4 py-3">
                {(inbox.data.total > inbox.data.limit || inbox.data.offset > 0) && (
                  <div className="mb-2">
                    <Pagination
                      label="notifications"
                      offset={inbox.data.offset}
                      limit={inbox.data.limit}
                      total={inbox.data.total}
                      onPageChange={inbox.setPage}
                    />
                  </div>
                )}
                <p className="text-[10px] leading-relaxed text-slate-500">
                  Events: last {inbox.data.eventWindowDays} facility calendar days. Marking read
                  does not resolve an alert or perform a clinical action.
                </p>
              </div>
            </>
          )}
        </NotificationPanel>
      )}
    </>
  );
};
