import { column, type Mapping, type Workbook } from './workbook.ts';
import type { ImportRow } from './import-outcome.ts';
type Row = Record<string, any>;
/** Reporting only: reads the parser's evidence; never changes inputs, mappings or calculations. */
export function importReviewRows(book: Workbook, mappings: Mapping[], preview: Row): ImportRow[] {
  const records = [
    ...preview.items.map((r: Row) => ({ ...r, kind: 'ITEM' })),
    ...preview.uniforms.map((r: Row) => ({ ...r, kind: 'UNIFORM' })),
  ];
  const names = new Map<string, number>();
  for (const r of records)
    names.set(
      r.description.trim().toLowerCase(),
      (names.get(r.description.trim().toLowerCase()) ?? 0) + 1,
    );
  return [
    ...records.map((r): ImportRow => {
      const mapping = mappings.find(
        (m) =>
          m.sheet === r.sourceWorksheet &&
          r.sourceRow >= m.startRow &&
          r.sourceRow <= m.endRow &&
          !m.skipRows?.includes(r.sourceRow),
      )!;
      const cells =
        book.sheets.find((s) => s.name === r.sourceWorksheet)?.rows[r.sourceRow - 1] ?? [];
      const fields: Array<[string, string | undefined, unknown]> = [
        ['Description', mapping.description, r.description],
        ['Base/buying price', mapping.price, r.basePrice ?? r.buyingCost],
        ...((r.kind === 'ITEM'
          ? [
              ['Unit', mapping.unit, r.unit],
              ...mapping.months!.map((col, n) => [`Month ${n + 1} quantity`, col, r.quantities[n]]),
            ]
          : [
              ['Staff count', mapping.staff, r.staffCount],
              ['Per staff', mapping.perStaff, r.quantityPerStaff],
              ['Opening balance', mapping.existingBalance, r.existingBalance],
              ['Contribution percentage', mapping.contributionPercent, r.contributionPercent],
            ]) as Array<[string, string | undefined, unknown]>),
      ];
      return {
        sheet: r.sourceWorksheet,
        row: r.sourceRow,
        kind: r.kind,
        description: r.description,
        category: r.category,
        outcome: 'VALID',
        message: 'Valid preview only — not imported.',
        correctiveAction:
          'Review the destination, source values and warnings; explicitly confirm to import.',
        duplicateName: (names.get(r.description.trim().toLowerCase()) ?? 0) > 1,
        values: fields.map(([field, col, value]) => {
          const raw = col ? (cells[column(col)]?.value ?? null) : null;
          const normalization = preview.normalizations.find(
            (n: Row) => n.sheet === r.sourceWorksheet && n.row === r.sourceRow && n.column === col,
          );
          return {
            field,
            column: col,
            raw,
            value,
            origin:
              normalization || !col
                ? 'DEFAULTED'
                : String(raw ?? '') === String(value ?? '')
                  ? 'SUPPLIED'
                  : 'NORMALIZED',
            reason:
              normalization?.reason ??
              (!col ? 'NO_SOURCE_COLUMN — existing parser default' : undefined),
          };
        }),
      };
    }),
    ...preview.errors.map((e: Row): ImportRow => ({
      sheet: e.sheet,
      row: e.row,
      kind: 'ROW',
      description: '',
      category: '',
      outcome: 'FAILED',
      message: e.message,
      correctiveAction:
        'Correct the source or explicitly exclude this source row, then preview again. No rows are imported while validation errors remain.',
      values: [],
    })),
    ...mappings.flatMap((m) =>
      (m.skipRows ?? [])
        .filter((n) => n >= m.startRow && n <= m.endRow)
        .map((n): ImportRow => ({
          sheet: m.sheet,
          row: n,
          kind: m.kind,
          description: '',
          category: m.category,
          outcome: 'EXCLUDED',
          message:
            'Explicitly excluded in the reviewed mapping; not processed by the import writer.',
          correctiveAction:
            'Remove the exclusion only after reviewing this row and previewing again.',
          values: [],
        })),
    ),
  ];
}
