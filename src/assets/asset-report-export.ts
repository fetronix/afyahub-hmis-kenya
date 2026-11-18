/**
 * PDF and spreadsheet output for fixed-asset reports.
 *
 * Both formats are rendered from the same `AssetReportResult` the screen shows:
 * the columns, row order and totals are not rebuilt per format, which is the
 * only way "the export agrees with the screen" can be a property rather than a
 * hope.
 */

import writeXlsxFile, { type SheetData } from 'write-excel-file/node';

import { renderDocument, type LetterheadForRender } from '../documents/render.ts';
import type { AssetReportResult } from './asset-reports.service.ts';

export interface AssetReportExport {
  filename: string;
  contentType: string;
  base64: string;
}

function cellValue(row: AssetReportResult['rows'][number], key: string): string {
  const value = row[key];
  if (value === null || value === undefined) return '';
  return String(value);
}

function metadata(report: AssetReportResult): string[] {
  return [
    `Facility: ${report.facilityName}`,
    `Generated (UTC): ${report.generatedAt}`,
    `Filters: ${report.filterSummary}`,
    `Records: ${report.rows.length}`,
    ...(report.totals
      ? Object.entries(report.totals).map(([key, value]) => `${key}: ${value}`)
      : []),
  ];
}

/** Equal widths that sum to exactly one, so the renderer's invariant holds. */
function widths(count: number): number[] {
  if (count === 0) return [];
  const each = Math.floor(10_000 / count) / 10_000;
  const result = Array.from({ length: count }, () => each);
  result[count - 1] = 1 - each * (count - 1);
  return result;
}

async function pdf(
  report: AssetReportResult,
  letterhead: LetterheadForRender | null,
): Promise<Buffer> {
  const rendered = await renderDocument(
    {
      kind: 'REPORTING_CENTRE',
      title: report.title,
      subtitle: report.description,
      documentNumber: `ASSET-${report.key.toUpperCase()}`,
      issuedAt: report.generatedAt,
      facility: {
        name: report.facilityName,
        code: String(report.facilityId),
        registryCode: null,
        address: null,
        county: null,
        phone: null,
        email: null,
      },
      leftFields: [],
      rightFields: [],
      table: {
        columns: report.columns.map((column, index) => ({
          label: column.label,
          width: widths(report.columns.length)[index],
          align: column.kind === 'money' || column.kind === 'number' ? 'right' : 'left',
        })),
        rows: report.rows.map((row) => report.columns.map((column) => cellValue(row, column.key))),
        repeatHeader: true,
      },
      sections: report.notes.map((note, index) => ({
        heading: `Note ${index + 1}`,
        body: note,
      })),
      brandingNote: letterhead?.label ?? 'No active facility letterhead configured — plain report',
    },
    letterhead,
  );
  return rendered.bytes;
}

async function excel(report: AssetReportResult): Promise<Buffer> {
  const sheet: SheetData = [
    ...metadata(report).map((line) => [line]),
    [],
    report.columns.map((column) => ({ value: column.label, fontWeight: 'bold' as const })),
    ...report.rows.map((row) =>
      report.columns.map((column) => ({
        // Always text: a value beginning with '=' must never become a formula.
        type: String,
        value: cellValue(row, column.key),
      })),
    ),
    [],
    ...(report.totals
      ? [
          report.columns.map((column) => ({
            value:
              report.totals?.[column.key] === undefined || report.totals?.[column.key] === null
                ? column.label === report.columns[0].key
                  ? 'Total'
                  : ''
                : String(report.totals[column.key]),
            fontWeight: 'bold' as const,
          })),
        ]
      : []),
  ];
  return writeXlsxFile(sheet, { sheet: 'Fixed assets' }).toBuffer();
}

export async function exportAssetReport(
  report: AssetReportResult,
  format: 'pdf' | 'xlsx',
  letterhead: LetterheadForRender | null = null,
): Promise<AssetReportExport> {
  const bytes = format === 'pdf' ? await pdf(report, letterhead) : await excel(report);
  return {
    filename: `jalicare-fixed-assets-${report.key}-${report.generatedAt.slice(0, 10)}.${format}`,
    contentType:
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: bytes.toString('base64'),
  };
}
