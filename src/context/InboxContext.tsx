import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { InboxResponse, NotificationSeverity } from '../notifications/inbox.types.ts';
import { useHmis } from './HmisContext.tsx';

interface InboxContextValue {
  available: boolean;
  data: InboxResponse | null;
  loading: boolean;
  error: string | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  severity: NotificationSeverity | undefined;
  setSeverity: (severity: NotificationSeverity | undefined) => void;
  setPage: (offset: number) => void;
  refresh: () => void;
  mark: (key: string | 'all') => Promise<void>;
  busy: boolean;
}
const empty: InboxContextValue = {
  available: false,
  data: null,
  loading: false,
  error: 'Notification centre is unavailable.',
  open: false,
  setOpen: () => {},
  severity: undefined,
  setSeverity: () => {},
  setPage: () => {},
  refresh: () => {},
  mark: async () => {},
  busy: false,
};
const InboxContext = createContext<InboxContextValue>(empty);
export const useInbox = () => useContext(InboxContext);

export const InboxProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { authenticatedUser, currentFacility, refreshKey, isAuthenticated } = useHmis();
  const scope = `${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const facilityId = currentFacility?.id;
  const allowed = Boolean(
    isAuthenticated &&
    facilityId &&
    authenticatedUser &&
    !authenticatedUser.isSuperAdmin &&
    !authenticatedUser.roles?.includes('SUPER_ADMIN') &&
    authenticatedUser.permissions?.some((p) =>
      [
        'inventory.read',
        'laboratory.read',
        'patients.read',
        'appointments.read',
        'inpatient.read',
        'theatre.read',
        'billing.read',
      ].includes(p),
    ),
  );
  const [open, setOpen] = useState(false);
  const [severity, setSeverityState] = useState<NotificationSeverity | undefined>();
  const [offset, setOffset] = useState(0);
  const [sequence, setSequence] = useState(0);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{
    scope: string;
    data?: InboxResponse;
    error?: string;
    loading?: boolean;
  } | null>(null);
  const visible = state?.scope === scope ? state : null;

  useEffect(() => {
    setOpen(false);
    setSeverityState(undefined);
    setOffset(0);
  }, [scope]);
  useEffect(() => {
    if (!allowed || !facilityId) return;
    const controller = new AbortController();
    setState((previous) =>
      previous?.scope === scope
        ? { ...previous, error: undefined, loading: true }
        : { scope, loading: true },
    );
    api
      .getInbox(facilityId, { severity, offset, signal: controller.signal })
      .then((data) => {
        if (
          !controller.signal.aborted &&
          scopeRef.current === scope &&
          data.facilityId === facilityId
        ) {
          // Conditions/events can disappear while a user is on a later page.
          // Return to the last valid page rather than displaying an inverted range.
          if (data.offset > 0 && data.offset >= data.total) {
            setOffset(Math.max(0, Math.floor((data.total - 1) / data.limit) * data.limit));
          } else {
            setState({ scope, data });
          }
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && scopeRef.current === scope)
          setState({
            scope,
            error: error instanceof Error ? error.message : 'Notifications could not be loaded.',
          });
      });
    return () => controller.abort();
  }, [scope, facilityId, allowed, severity, offset, sequence, refreshKey]);
  useEffect(() => {
    if (!allowed) return;
    const timer = window.setInterval(() => setSequence((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [allowed]);
  const refresh = useCallback(() => setSequence((n) => n + 1), []);
  const setSeverity = useCallback((next: NotificationSeverity | undefined) => {
    setOffset(0);
    setSeverityState(next);
  }, []);
  const mark = useCallback(
    async (key: string | 'all') => {
      if (!facilityId || !allowed || busy) return;
      setBusy(true);
      try {
        if (key === 'all') await api.markAllNotificationsRead(facilityId);
        else await api.markNotificationRead(facilityId, key);
        if (scopeRef.current === scope) setSequence((n) => n + 1);
      } catch (error) {
        if (scopeRef.current === scope)
          setState((previous) => ({
            scope,
            data: previous?.scope === scope ? previous.data : undefined,
            error: error instanceof Error ? error.message : 'Could not mark notifications read.',
          }));
      } finally {
        if (scopeRef.current === scope) setBusy(false);
      }
    },
    [facilityId, allowed, busy, scope],
  );
  useEffect(() => {
    setBusy(false);
  }, [scope]);
  const error = !allowed
    ? 'Notifications are unavailable for this account or facility.'
    : (visible?.error ?? null);
  return (
    <InboxContext.Provider
      value={{
        available: allowed,
        data: allowed ? (visible?.data ?? null) : null,
        loading: allowed && (!visible || Boolean(visible.loading)),
        error,
        open,
        setOpen,
        severity,
        setSeverity,
        setPage: setOffset,
        refresh,
        mark,
        busy,
      }}
    >
      {children}
    </InboxContext.Provider>
  );
};
