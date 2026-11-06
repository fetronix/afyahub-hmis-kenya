import type {
  ReportColumn,
  ReportFilters,
  ReportSelectionKind,
  ReportValue,
} from './report-centre.types.ts';

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

export function reportFilterSummary(
  filters: ReportFilters,
  dateLabel?: string,
  labels: Partial<Record<ReportSelectionKind, string>> = {},
): string[] {
  const applied: string[] = [];
  if (filters.search) applied.push(`Search: ${filters.search}`);
  if (filters.status)
    applied.push(`Status: ${filters.status === '__unknown__' ? 'Not recorded' : filters.status}`);
  if (filters.from && filters.to)
    applied.push(`${dateLabel ?? 'Date'}: ${filters.from} to ${filters.to} (inclusive)`);
  else if (filters.to) applied.push(`${dateLabel ?? 'As-of date'}: ${filters.to} (inclusive)`);
  // Labels are resolved and ownership-checked by the server, never client supplied.
  if (filters.patientId) applied.push(`Patient: ${labels.patient ?? 'Selected'}`);
  if (filters.wardId) applied.push(`Ward: ${labels.ward ?? 'Selected'}`);
  if (filters.bedId) applied.push(`Bed: ${labels.bed ?? 'Selected'}`);
  if (filters.departmentId) applied.push(`Department: ${labels.department ?? 'Selected'}`);
  if (filters.staffId) applied.push(`Staff: ${labels.staff ?? 'Selected'}`);
  if (filters.itemIds?.length) applied.push(`Items: ${labels.item ?? 'Selected'}`);
  if (filters.supplierId) applied.push(`Supplier: ${labels.supplier ?? 'Selected'}`);
  if (filters.purchaseOrderId)
    applied.push(`Purchase order: ${labels.purchaseOrder ?? 'Selected'}`);
  if (filters.labTestId) applied.push(`Laboratory test: ${labels.labTest ?? 'Selected'}`);
  if (filters.serviceIds?.length) applied.push(`Services: ${labels.service ?? 'Selected'}`);
  if (filters.invoiceId) applied.push(`Invoice: ${labels.invoice ?? 'Selected'}`);
  if (filters.receiptId) applied.push(`Receipt: ${labels.receipt ?? 'Selected'}`);
  if (filters.accountIds?.length) applied.push(`Accounts: ${labels.account ?? 'Selected'}`);
  return applied.length ? applied : ['No additional filters'];
}
