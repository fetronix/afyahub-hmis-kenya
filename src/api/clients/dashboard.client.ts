import { API_BASE, fetchJson } from './http.ts';
import type { DashboardOverview, DashboardSearchResult } from '../../dashboard/dashboard.types.ts';
import type { DashboardRange } from '../../dashboard/date-range.ts';

export const dashboardClient = {
  getDashboardOverview: (facilityId: number, range: DashboardRange, signal?: AbortSignal) => {
    const query = new URLSearchParams({
      facilityId: String(facilityId),
      start: range.start,
      end: range.end,
    });
    return fetchJson<DashboardOverview>(`${API_BASE}/dashboard/overview?${query}`, { signal });
  },
  searchDashboard: (facilityId: number, term: string, signal?: AbortSignal) =>
    fetchJson<DashboardSearchResult>(`${API_BASE}/dashboard/search`, {
      method: 'POST',
      body: JSON.stringify({ facilityId, term }),
      signal,
    }),
};
