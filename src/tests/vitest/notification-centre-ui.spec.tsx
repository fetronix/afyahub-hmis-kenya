// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../api/client.ts';
import { Header } from '../../components/Header.tsx';
import { ActiveAlertStrip } from '../../components/dashboard/ActiveAlertStrip.tsx';
import { InboxProvider } from '../../context/InboxContext.tsx';
import type {
  InboxItem,
  InboxResponse,
  NotificationSeverity,
} from '../../notifications/inbox.types.ts';

let context: any;
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => context }));
const original: InboxItem[] = [
  {
    key: 'alert:1:1',
    severity: 'CRITICAL',
    title: 'Expired stock',
    details:
      'Synthetic medicine · batch TEST · expiry 2026-10-30 · 4 tablets · Synthetic Facility · Expired 1 day ago.',
    source: 'Inventory batches',
    destination: 'inventory',
    at: '2026-10-31T08:00:00.000Z',
    timeKind: 'detected',
    isAlert: true,
    group: 'expired',
    read: false,
  },
  {
    key: 'alert:2:1',
    severity: 'WARNING',
    title: 'Low stock',
    details: 'Synthetic medicine: 2 tablets recorded.',
    source: 'Inventory',
    destination: 'inventory',
    at: '2026-10-31T08:00:00.000Z',
    timeKind: 'detected',
    isAlert: true,
    group: 'lowStock',
    read: false,
  },
  {
    key: 'event:receipt:3',
    severity: 'SUCCESS',
    title: 'Receipt recorded',
    details: 'Recorded receipt (not verified settlement) #3.',
    source: 'Billing',
    destination: 'finance',
    at: '2026-10-31T09:00:00',
    timeKind: 'recorded',
    isAlert: false,
    read: false,
  },
  {
    key: 'event:patient:4',
    severity: 'INFO',
    title: 'Patient registered',
    details: 'Patient record #4.',
    source: 'Registration',
    destination: 'registration',
    at: '2026-10-31T09:00:00',
    timeKind: 'recorded',
    isAlert: false,
    read: true,
  },
];
let items: InboxItem[];
function response(facilityId = 10, severity?: NotificationSeverity, offset = 0): InboxResponse {
  const filtered = severity ? items.filter((item) => item.severity === severity) : items;
  return {
    facilityId,
    timezone: 'Africa/Nairobi',
    checkedAt: '2026-10-31T08:00:00.000Z',
    eventWindowDays: 7,
    items: filtered.slice(offset, offset + 50),
    total: filtered.length,
    unreadCount: items.filter((item) => !item.read).length,
    unreadCritical: items.filter((item) => !item.read && item.severity === 'CRITICAL').length,
    offset,
    limit: 50,
    alertGroups: [
      { group: 'expired', severity: 'CRITICAL', count: 1, destination: 'inventory' },
      { group: 'lowStock', severity: 'WARNING', count: 1, destination: 'inventory' },
    ],
    availableSources: ['Inventory stock and batches', 'Billing', 'Registration'],
  };
}
const View = () => (
  <InboxProvider>
    <Header collapsed={false} onToggleCollapse={vi.fn()} />
    <ActiveAlertStrip />
  </InboxProvider>
);

describe('notification centre behavior', () => {
  beforeEach(() => {
    items = structuredClone(original);
    context = {
      isAuthenticated: true,
      refreshKey: 0,
      authenticatedUser: {
        id: 1,
        fullName: 'Synthetic Staff',
        roles: ['FACILITY_ADMIN'],
        permissions: ['inventory.read', 'billing.read', 'patients.read'],
      },
      currentFacility: {
        id: 10,
        name: 'Synthetic Facility',
        enabledModules: ['inventory', 'finance', 'registration'],
        hiddenModules: [],
      },
      currentTenant: { id: 1, timezone: 'Africa/Nairobi' },
      currentUser: { name: 'Synthetic Staff', role: 'Facility Admin' },
      setActiveModule: vi.fn(),
      setDirectorySearch: vi.fn(),
      facilities: [],
      tenants: [],
      setCurrentFacility: vi.fn(),
      setCurrentTenant: vi.fn(),
      isMobileMenuOpen: false,
      setIsMobileMenuOpen: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(api, 'getInbox').mockImplementation(async (facility, opts) =>
      response(facility, opts?.severity, opts?.offset),
    );
    vi.spyOn(api, 'markNotificationRead').mockImplementation(async (facility, key) => {
      items = items.map((item) => (item.key === key ? { ...item, read: true } : item));
      return response(facility);
    });
    vi.spyOn(api, 'markAllNotificationsRead').mockImplementation(async (facility) => {
      items = items.map((item) => ({ ...item, read: true }));
      return response(facility);
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows actual counts, severity filters, details, read actions and persistent active alert strip', async () => {
    const user = userEvent.setup();
    render(<View />);
    const bell = await screen.findByRole('button', {
      name: 'Notifications, 3 unread, critical alerts active',
    });
    expect(screen.getByRole('region', { name: 'Active operational alerts' })).toHaveTextContent(
      '1 expired batch',
    );
    await user.click(bell);
    const panel = screen.getByRole('region', { name: 'Notification centre' });
    expect(panel).toHaveFocus();
    expect(
      within(panel).getByText('3 unread · 1 critical unread · critical alert active'),
    ).toBeInTheDocument();
    expect(within(panel).getByText(/Synthetic medicine · batch TEST/)).toBeInTheDocument();
    expect(within(panel).getByText(/not verified settlement/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Critical' }));
    await waitFor(() => expect(within(panel).queryByText('Low stock')).not.toBeInTheDocument());
    expect(within(panel).getByText('Expired stock')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Mark Expired stock read' }));
    await screen.findByRole('button', { name: 'Notifications, 2 unread, critical alerts active' });
    expect(api.markNotificationRead).toHaveBeenCalledWith(10, 'alert:1:1');
    await user.click(within(panel).getByRole('button', { name: 'All' }));
    await user.click(within(panel).getByRole('button', { name: 'Mark all read' }));
    await screen.findByRole('button', { name: 'Notifications, 0 unread, critical alerts active' });
    expect(screen.getByRole('region', { name: 'Active operational alerts' })).toHaveTextContent(
      'expired batch',
    );
    expect(within(panel).getByText(/Marking read does not resolve an alert/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Notification centre' })).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });
  it('navigates only to a permitted enabled destination and closes the panel', async () => {
    const user = userEvent.setup();
    render(<View />);
    await user.click(
      await screen.findByRole('button', {
        name: 'Notifications, 3 unread, critical alerts active',
      }),
    );
    const panel = screen.getByRole('region', { name: 'Notification centre' });
    await user.click(within(panel).getAllByRole('button', { name: 'Open inventory' })[0]);
    expect(context.setActiveModule).toHaveBeenCalledWith('inventory');
    expect(screen.queryByRole('region', { name: 'Notification centre' })).not.toBeInTheDocument();
  });
  it('displays a failed request rather than a zero, and retries', async () => {
    vi.mocked(api.getInbox).mockRejectedValueOnce(new Error('Synthetic inbox unavailable'));
    const user = userEvent.setup();
    render(<View />);
    await screen.findByText(/Alerts unavailable/);
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic inbox unavailable');
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: 'Notifications, 3 unread, critical alerts active' });
  });
  it('pages through records and recovers if the last page becomes empty', async () => {
    items.push(
      ...Array.from({ length: 55 }, (_, index) => ({
        ...original[3],
        key: `event:patient:${100 + index}`,
        details: `Patient record #${100 + index}.`,
        read: false,
      })),
    );
    const user = userEvent.setup();
    render(<View />);
    await user.click(await screen.findByRole('button', { name: /Notifications, 58 unread/ }));
    const panel = screen.getByRole('region', { name: 'Notification centre' });
    expect(within(panel).getByText('Showing 1–50 of 59')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Next notifications' }));
    await within(panel).findByText('Showing 51–59 of 59');
    items = structuredClone(original);
    await user.click(within(panel).getByRole('button', { name: 'Refresh notifications' }));
    await waitFor(() => expect(within(panel).getByText('Expired stock')).toBeInTheDocument());
    expect(within(panel).queryByText(/Showing 51/)).not.toBeInTheDocument();
    expect(vi.mocked(api.getInbox).mock.calls.some(([, opts]) => opts?.offset === 0)).toBe(true);
  });
  it('explains when the account has no permitted notification source', async () => {
    context.authenticatedUser.permissions = ['audit.read'];
    const user = userEvent.setup();
    render(<View />);
    expect(screen.getByRole('region', { name: 'Active operational alerts' })).toHaveTextContent(
      'unavailable for this account',
    );
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByRole('alert')).toHaveTextContent('unavailable for this account or facility');
    expect(
      within(screen.getByRole('alert')).queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
    expect(api.getInbox).not.toHaveBeenCalled();
  });
  it('clears previous facility data immediately and ignores a late response', async () => {
    let finish: (value: InboxResponse) => void = () => {};
    vi.mocked(api.getInbox).mockImplementation((facility) =>
      facility === 10
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({
            ...response(11),
            items: [],
            total: 0,
            unreadCount: 0,
            unreadCritical: 0,
            alertGroups: [],
          }),
    );
    const { rerender } = render(<View />);
    context = {
      ...context,
      currentFacility: { ...context.currentFacility, id: 11, name: 'Other synthetic' },
    };
    rerender(<View />);
    await screen.findByRole('button', { name: 'Notifications, 0 unread' });
    finish(response(10));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notifications, 0 unread' })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/expired batches/)).not.toBeInTheDocument();
  });
});
