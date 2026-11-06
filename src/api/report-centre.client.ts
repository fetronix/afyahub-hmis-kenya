import { fetchJson } from './clients/http.ts';
import type { ReportEngineId } from '../reporting/report-catalogue.ts';
import type {
  ReportExport,
  ReportFilters,
  ReportResult,
  ReportSelectionRequest,
  ReportSelectionPage,
} from '../reporting/report-centre.types.ts';

const path = (id: ReportEngineId | 'invoice-document') =>
  `/api/reporting/centre/${encodeURIComponent(id)}`;

export const reportCentreApi = {
  options: (
    id: ReportEngineId | 'invoice-document',
    request: ReportSelectionRequest,
    signal?: AbortSignal,
  ) =>
    fetchJson<ReportSelectionPage>(`${path(id)}/options`, {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
    }),
  generate: (id: ReportEngineId, filters: ReportFilters, intent: 'view' | 'print' = 'view') =>
    fetchJson<ReportResult>(`${path(id)}/generate`, {
      method: 'POST',
      body: JSON.stringify({ ...filters, intent }),
    }),
  export: (id: ReportEngineId, filters: ReportFilters, format: 'pdf' | 'xlsx' | 'csv') =>
    fetchJson<ReportExport>(`${path(id)}/export`, {
      method: 'POST',
      body: JSON.stringify({ ...filters, format }),
    }),
};
