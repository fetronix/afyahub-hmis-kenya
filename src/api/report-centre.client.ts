import { fetchJson } from './clients/http.ts';
import type { ReportEngineId } from '../reporting/report-catalogue.ts';
import type { ReportingOverview } from '../reporting/report-centre.overview.ts';
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
  /** Landing-page figures. A card without a number is a refusal, not a zero. */
  overview: (facilityId: number, from: string, to: string) =>
    fetchJson<ReportingOverview>('/api/reporting/centre/overview', {
      method: 'POST',
      body: JSON.stringify({ facilityId, from, to }),
    }),
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
