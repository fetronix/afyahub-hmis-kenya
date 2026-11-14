import { fetchJson, getSessionToken } from '../client.ts';
export const equityApi = {
  get<T>(path: string) {
    return fetchJson<T>('/api/partner-equity' + path);
  },
  send<T>(path: string, body: unknown, method = 'POST') {
    return fetchJson<T>('/api/partner-equity' + path, { method, body: JSON.stringify(body) });
  },
  async download(id: number, format: 'csv' | 'xlsx' | 'pdf') {
    const token = getSessionToken();
    const response = await fetch(`/api/partner-equity/statements/${id}/export?format=${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const e = await response.json().catch(() => null);
      throw new Error(e?.message ?? 'Export failed.');
    }
    const url = URL.createObjectURL(await response.blob()),
      a = document.createElement('a');
    a.href = url;
    a.download = `partner-equity-${id}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
};
