import { fetchJson } from './clients/http.ts';
import type { ReportEngineId } from '../reporting/report-catalogue.ts';
import type {
  ReportExport,
  ReportFilters,
  ReportResult,
} from '../reporting/report-centre.types.ts';

const path = (id: ReportEngineId) => `/api/reporting/centre/${encodeURIComponent(id)}`;

export const reportCentreApi = {
  generate: (id: ReportEngineId, filters: ReportFilters, intent: 'view' | 'print' = 'view') =>
    fetchJson<ReportResult>(`${path(id)}/generate`, {
      method: 'POST',
      body: JSON.stringify({ ...filters, intent }),
    }),
  export: (id: ReportEngineId, filters: ReportFilters, format: 'pdf' | 'xlsx') =>
    fetchJson<ReportExport>(`${path(id)}/export`, {
      method: 'POST',
      body: JSON.stringify({ ...filters, format }),
    }),
};
