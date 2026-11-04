import { createRequire } from 'node:module';
import * as fontkit from 'fontkit';
import PDFDocument from 'pdfkit';
import writeXlsxFile, { type SheetData } from 'write-excel-file/node';
import { REPORT_ENGINES, type ReportExport, type ReportResult } from './report-centre.types.ts';
import { reportFilterSummary, reportValue } from './report-centre.format.ts';
import { ReportCentreError } from './report-centre.service.ts';

const require = createRequire(import.meta.url);
// Resolve lazily so a missing PDF dependency cannot prevent the rest of the application starting.
function reportFont() {
  // A generic open-licensed Unicode font, not a reference-product brand asset.
  const path = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
  const font = fontkit.openSync(path);
  if (!('hasGlyphForCodePoint' in font)) throw new Error('REPORT_FONT_INVALID');
  return { path, font };
}
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_CELL_LENGTH = 32_000;

type Format = 'pdf' | 'xlsx';

function content(result: ReportResult): {
  metadata: string[];
  headers: string[];
  rows: string[][];
} {
  const definition = REPORT_ENGINES[result.reportId];
  return {
    metadata: [
      'JaliCare HMIS — Reporting Centre',
      result.title,
      `Facility: ${result.facilityName}`,
      `Generated (UTC): ${result.generatedAt}`,
      `Records: ${result.total}`,
      ...reportFilterSummary(result.filters, definition.dateLabel),
      ...result.notes.map((note) => `Note: ${note}`),
    ],
    headers: result.columns.map((column) => column.label),
    rows: result.rows.map((row) =>
      result.columns.map((column) => reportValue(row[column.key], column, result.currency)),
    ),
  };
}

function validateText(strings: string[], format: Format): void {
  const font = format === 'pdf' ? reportFont().font : null;
  let bytes = 0;
  for (const value of strings) {
    bytes += Buffer.byteLength(value, 'utf8');
    if (value.length > MAX_CELL_LENGTH || bytes > MAX_TEXT_BYTES) {
      throw new ReportCentreError(
        'REPORT_EXPORT_TOO_LARGE',
        'The report contains too much text to export safely. Narrow the filters or review the source records.',
        413,
      );
    }
    for (const character of value) {
      const point = character.codePointAt(0);
      if (point === undefined) continue;
      // XML cannot represent these values. Do not silently strip source data.
      if (
        point <= 8 ||
        point === 11 ||
        point === 12 ||
        (point >= 14 && point <= 31) ||
        point === 0xfffe ||
        point === 0xffff
      ) {
        throw new ReportCentreError(
          'REPORT_EXPORT_UNSUPPORTED_TEXT',
          'A source record contains unsupported control characters. Review the source record before exporting.',
          422,
        );
      }
      if (
        format === 'pdf' &&
        ![9, 10, 13].includes(point) &&
        font &&
        !font.hasGlyphForCodePoint(point)
      ) {
        throw new ReportCentreError(
          'REPORT_PDF_UNSUPPORTED_TEXT',
          'A character in this report cannot be rendered reliably in PDF. Use Excel or print instead.',
          422,
        );
      }
    }
  }
}

async function pdf(result: ReportResult, data: ReturnType<typeof content>): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 42,
    info: { Title: result.title, Author: 'JaliCare HMIS' },
  });
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.font(reportFont().path).fillColor('#0f766e').fontSize(11).text(data.metadata[0]);
  doc.fillColor('#0f172a').fontSize(17).text(data.metadata[1]);
  doc.moveDown(0.4).fontSize(9);
  data.metadata.slice(2).forEach((line) => doc.text(line));
  doc.moveDown();
  if (data.rows.length === 0) doc.text('No records match the selected filters.');
  data.rows.forEach((row, index) => {
    doc
      .fillColor('#0f766e')
      .fontSize(10)
      .text(`Record ${index + 1}`);
    doc.fillColor('#0f172a').fontSize(9);
    row.forEach((value, columnIndex) => doc.text(`${data.headers[columnIndex]}: ${value}`));
    doc.moveDown(0.6);
  });
  doc.end();
  return output;
}

async function excel(data: ReturnType<typeof content>): Promise<Buffer> {
  // All source strings are cells of type String, never formulas (even if they start with '=','+' or '@').
  const sheet: SheetData = [
    ...data.metadata.map((line) => [line]),
    [],
    data.headers.map((label) => ({ value: label, fontWeight: 'bold' as const })),
    ...data.rows.map((row) => row.map((value) => ({ type: String, value }))),
  ];
  return writeXlsxFile(sheet, { sheet: 'Report' }).toBuffer();
}

/** Exports the full filtered set up to the service's enforced limit. */
export async function exportReport(result: ReportResult, format: Format): Promise<ReportExport> {
  const data = content(result);
  validateText([...data.metadata, ...data.headers, ...data.rows.flat()], format);
  const bytes = format === 'pdf' ? await pdf(result, data) : await excel(data);
  return {
    filename: `jalicare-${result.reportId}-${result.generatedAt.slice(0, 10)}.${format}`,
    contentType:
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: bytes.toString('base64'),
  };
}
