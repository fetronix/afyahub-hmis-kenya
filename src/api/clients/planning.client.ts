import { fetchJson, getSessionToken } from '../client.ts';
import type { Projection } from '../../budget-planning/reports.service.ts';
import type { Plan } from '../../budget-planning/planning.service.ts';
import type { Mapping, Workbook } from '../../budget-planning/workbook.ts';
export type { Projection, Plan, Mapping, Workbook };
export type PlanningRow = Record<string, any>;
export const planningApi = {
  get<T>(facilityId: number, path: string, query: Record<string, unknown> = {}) {
    return fetchJson<T>(
      `/api/budget-planning${path}?${new URLSearchParams({
        facilityId: String(facilityId),
        ...Object.fromEntries(
          Object.entries(query)
            .filter(([, v]) => v !== '' && v !== undefined && v !== null)
            .map(([k, v]) => [k, String(v)]),
        ),
      })}`,
    );
  },
  send<T>(facilityId: number, path: string, body: unknown, method = 'POST') {
    return fetchJson<T>(`/api/budget-planning${path}?facilityId=${facilityId}`, {
      method,
      body: JSON.stringify(body),
    });
  },
  async upload(facilityId: number, file: File) {
    const extension = file.name.toLowerCase().split('.').pop();
    return fetchJson<PlanningRow>(`/api/budget-planning/imports?facilityId=${facilityId}`, {
      method: 'POST',
      headers: {
        'Content-Type':
          extension === 'csv'
            ? 'text/csv'
            : extension === 'xlsx'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : 'application/vnd.ms-excel',
        'X-Filename': encodeURIComponent(file.name),
      },
      body: file,
    });
  },
  async file(facilityId: number, reportId: number, format: 'pdf' | 'xlsx', print = false) {
    const popup = print ? window.open('about:blank', '_blank') : null;
    try {
      const token = getSessionToken();
      const r = await fetch(
        `/api/budget-planning/reports/${reportId}/${format}?facilityId=${facilityId}${print ? '&print=1' : ''}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!r.ok) throw new Error('Report could not be downloaded; check export permission.');
      const url = URL.createObjectURL(await r.blob());
      if (print && popup) popup.location.replace(url);
      else {
        const link = document.createElement('a');
        link.href = url;
        link.download = `planning-report-${reportId}.${format}`;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      popup?.close();
      throw e;
    }
  },
};
export const planMoney = (value: unknown) => {
  const cents = BigInt(String(value ?? 0));
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
};
