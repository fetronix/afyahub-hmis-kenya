/** Shared presentation rules. A preview is NEVER evidence of a committed import. */
export type ImportRow = {
  sheet: string;
  row: number;
  kind: string;
  description: string;
  category: string;
  outcome: 'VALID' | 'CREATED' | 'UPDATED' | 'SKIPPED' | 'FAILED' | 'EXCLUDED' | 'ROLLED_BACK';
  plannedOperation?: string;
  message: string;
  correctiveAction: string;
  duplicateName?: boolean;
  recordId?: number;
  values: Array<{
    field: string;
    column?: string;
    raw: unknown;
    value: unknown;
    origin: 'SUPPLIED' | 'DEFAULTED' | 'NORMALIZED' | 'RECALCULATED' | 'UNAVAILABLE';
    reason?: string;
  }>;
};
export type ImportBatchView = {
  id?: number;
  status: string;
  filename?: string;
  created_at?: string;
  result?: Record<string, any> | null;
  validation?: Record<string, any> | null;
};
export function committedCounts(b: ImportBatchView) {
  if (b.status !== 'IMPORTED' || !b.result)
    return { created: 0, updated: 0, skipped: 0, failed: 0, imported: 0 };
  const number = (v: unknown) =>
    Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : 0;
  const created = number(b.result.created),
    updated = number(b.result.updated);
  return {
    created,
    updated,
    skipped: number(b.result.skipped),
    failed: number(b.result.failed ?? b.result.validationErrors),
    imported: created + updated,
  };
}
export function importState(b: ImportBatchView) {
  if (b.status === 'CANCELLED') return 'Cancelled';
  if (b.status === 'IMPORTED') {
    if (!b.result) return 'Outcome unavailable';
    const counts = committedCounts(b);
    return counts.failed > 0
      ? counts.imported > 0
        ? 'Partially imported'
        : 'Failed'
      : 'Successfully imported';
  }
  if (b.validation?.lastFailure) return 'Failed';
  if (b.validation?.previewHash) {
    if (b.validation.errors?.length || b.validation.counts?.conflictingItems)
      return 'Preview needs correction';
    return Number(b.validation.rows) > 0 ? 'Awaiting confirmation' : 'Previewed — no valid records';
  }
  return 'Uploaded';
}
export function outcomeWarnings(b: ImportBatchView) {
  const snapshot = b.status === 'IMPORTED' ? b.result : b.validation;
  return Number(snapshot?.warningCount ?? snapshot?.warnings?.length ?? 0);
}
export function importIndicators(batches: ImportBatchView[]) {
  return {
    total: batches.length,
    successful: batches.filter((b) => importState(b) === 'Successfully imported').length,
    warnings: batches.filter(
      (b) =>
        b.status === 'IMPORTED' && (outcomeWarnings(b) > 0 || Number(b.result?.defaultedCells) > 0),
    ).length,
    failed: batches.filter(
      (b) => importState(b) === 'Failed' || importState(b) === 'Partially imported',
    ).length,
    awaiting: batches.filter((b) => importState(b) === 'Awaiting confirmation').length,
    attention: batches.filter((b) =>
      [
        'Uploaded',
        'Failed',
        'Partially imported',
        'Preview needs correction',
        'Awaiting confirmation',
        'Outcome unavailable',
        'Previewed — no valid records',
      ].includes(importState(b)),
    ).length,
  };
}
/** Escape every cell and neutralize spreadsheet formula prefixes, including leading whitespace. */
export function importResultsCsv(headers: string[], rows: unknown[][]) {
  const cell = (v: unknown) => {
    let text = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return (
    '\uFEFF' +
    [headers, ...rows.map((row) => headers.map((_, n) => row[n]))]
      .map((row) => row.map(cell).join(','))
      .join('\r\n') +
    '\r\n'
  );
}
