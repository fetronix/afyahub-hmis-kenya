import { API_BASE, fetchJson } from './http.ts';
import type { InboxResponse, NotificationSeverity } from '../../notifications/inbox.types.ts';

export const notificationsClient = {
  getInbox: (
    facilityId: number,
    options: { severity?: NotificationSeverity; offset?: number; signal?: AbortSignal } = {},
  ) => {
    const params = new URLSearchParams({
      facilityId: String(facilityId),
      offset: String(options.offset ?? 0),
    });
    if (options.severity) params.set('severity', options.severity);
    return fetchJson<InboxResponse>(`${API_BASE}/notifications?${params}`, {
      signal: options.signal,
    });
  },
  markNotificationRead: (facilityId: number, key: string) =>
    fetchJson<InboxResponse>(`${API_BASE}/notifications/read`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, key }),
    }),
  markAllNotificationsRead: (facilityId: number) =>
    fetchJson<InboxResponse>(`${API_BASE}/notifications/read-all`, {
      method: 'POST',
      body: JSON.stringify({ facilityId }),
    }),
};
