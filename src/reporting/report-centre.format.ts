import type { ReportColumn, ReportFilters, ReportValue } from './report-centre.types.ts';

/** Shared by the screen, print, PDF and Excel so missing values stay visibly missing. */
export function reportValue(
  value: ReportValue | undefined,
  column: ReportColumn,
  currency: string | null,
): string {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return 'Not recorded';
  }
  const text = String(value);
  return column.kind === 'money' ? `${currency ?? 'Currency not recorded'} ${text}` : text;
}

export function reportFilterSummary(filters: ReportFilters, dateLabel?: string): string[] {
  const applied: string[] = [];
  if (filters.search) applied.push(`Search: ${filters.search}`);
  if (filters.status)
    applied.push(`Status: ${filters.status === '__unknown__' ? 'Not recorded' : filters.status}`);
  if (filters.from && filters.to)
    applied.push(`${dateLabel ?? 'Date'}: ${filters.from} to ${filters.to} (inclusive)`);
  else if (filters.to) applied.push(`${dateLabel ?? 'As-of date'}: ${filters.to} (inclusive)`);
  if (filters.patientId) applied.push(`Patient ID: ${filters.patientId}`);
  if (filters.wardId) applied.push(`Ward ID: ${filters.wardId}`);
  if (filters.departmentId) applied.push(`Department ID: ${filters.departmentId}`);
  if (filters.staffId) applied.push(`Staff user ID: ${filters.staffId}`);
  return applied.length ? applied : ['No additional filters'];
}
