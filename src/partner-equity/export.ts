import * as XLSX from '@e965/xlsx';
import {
  equityRows,
  equityTitle,
  formulaDefinitions,
  formulaNotice,
  sourceNotes,
} from './model.ts';
import { calculateEquity, cents } from './calculations.ts';
import type { Statement } from './service.ts';
import type { DocumentFacility, DocumentModel } from '../documents/document-model.ts';
export function statementRows(s: Statement): (string | number)[][] {
  const r = calculateEquity(s.model),
    partners = [...s.model.partners].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return [
    ['Description', ...partners.map((p) => p.name), 'Total'],
    ...equityRows.map((row) =>
      [row.label, ...partners.map((p) => r.cells[row.id][p.id]), r.totals[row.id]].map((v, i) =>
        i === 0 ? String(v) : v === null ? '—' : Number(v),
      ),
    ),
  ];
}
const protectedText = (s: unknown) => {
  const text = String(s ?? '');
  return /^[\s]*[=+\-@\t\r]/.test(text) ? "'" + text : text;
};
export function statementCsv(s: Statement) {
  const calc = calculateEquity(s.model);
  return [
    ...statementRows(s),
    ['Statement', equityTitle],
    ['Facility', s.facility_name ?? 'Facility-scoped statement'],
    ['Statement currency', 'KES'],
    ['Facility currency (tenant setting)', s.facility_currency ?? 'Not supplied'],
    ['Financial year', s.financial_year],
    ['Reporting period', s.start_date + ' to ' + s.end_date],
    ['Status', s.status],
    ['Revision', s.revision],
    ['Prepared by', s.prepared_name ?? s.prepared_by],
    ['Prepared date', String(s.prepared_at)],
    ['Reviewed by', s.reviewed_name ?? 'Pending'],
    ['Review date', s.reviewed_at ? String(s.reviewed_at) : 'Pending'],
    ['Approved by', s.approved_name ?? 'Pending'],
    ['Approval date', s.approved_at ? String(s.approved_at) : 'Pending'],
    ['Formula status', formulaNotice],
    ['Review acceptance', s.review_acceptance ?? 'Pending'],
    ['Displayed allocation rounding cents', calc.rounding.allocationCents],
    ['Displayed closing rounding cents', calc.rounding.closingCents],
    ['Displayed sharing rounding basis points', calc.rounding.sharingBasisPoints],
    ['Displayed ownership rounding basis points', calc.rounding.ownershipBasisPoints],
    ['Unspecified inputs', calc.unspecified],
    ...Object.entries(formulaDefinitions),
  ]
    .map((row) =>
      row
        .map(
          (v) =>
            `"${(typeof v === 'number' ? v.toFixed(2) : protectedText(v)).replaceAll('"', '""')}"`,
        )
        .join(','),
    )
    .join('\r\n');
}
export function statementXlsx(s: Statement) {
  const rows = statementRows(s),
    ws = XLSX.utils.aoa_to_sheet(rows);
  for (let r = 1; r < rows.length; r++)
    for (let c = 1; c < rows[r].length; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell?.t === 'n') {
        const pct = equityRows[r - 1].id === 'sharing' || equityRows[r - 1].id === 'ownership';
        if (pct) cell.v = Number(cents(String(cell.v))) / 10000;
        cell.z = pct ? '0.00%' : '"KES "#,##0.00;[Red]("KES "#,##0.00)';
      }
    }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Partners equity');
  const calc = calculateEquity(s.model);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Title', equityTitle],
      ['Facility', s.facility_name ?? 'Facility-scoped statement'],
      ['Statement currency', 'KES'],
      ['Facility currency (tenant setting)', s.facility_currency ?? 'Not supplied'],
      ['Financial year', s.financial_year],
      ['Period', `${s.start_date} to ${s.end_date}`],
      ['Status', s.status],
      ['Revision', s.revision],
      ['Net result', Number(s.model.netResult)],
      ['Prepared by', s.prepared_name ?? s.prepared_by],
      ['Prepared at', String(s.prepared_at)],
      ['Reviewed by', s.reviewed_name ?? s.reviewed_by ?? 'Not reviewed'],
      ['Review date', s.reviewed_at ? String(s.reviewed_at) : 'Not reviewed'],
      ['Approved by', s.approved_name ?? s.approved_by ?? 'Not approved'],
      ['Approval date', s.approved_at ? String(s.approved_at) : 'Not approved'],
      ['Formula status', formulaNotice],
      ...Object.entries(formulaDefinitions),
      ['Displayed allocation rounding cents', calc.rounding.allocationCents],
      ['Displayed closing rounding cents', calc.rounding.closingCents],
      ['Displayed sharing rounding basis points', calc.rounding.sharingBasisPoints],
      ['Displayed ownership rounding basis points', calc.rounding.ownershipBasisPoints],
      ['Unspecified inputs', calc.unspecified],
      ['Review acceptance', s.review_acceptance ?? 'Pending'],
      ...sourceNotes.map((n) => ['Source note', n]),
    ]),
    'Formula audit',
  );
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
export function equityDocument(s: Statement, facility: DocumentFacility): DocumentModel {
  const r = calculateEquity(s.model),
    partners = [...s.model.partners].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const fmt = (v: string | null, pct = false) =>
    v === null
      ? '—'
      : pct
        ? `${v}%`
        : `KES ${Number(v).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const document: DocumentModel = {
    kind: 'PARTNER_EQUITY',
    title: equityTitle,
    subtitle: `${s.period_name} · ${s.start_date} to ${s.end_date}`,
    documentNumber: `EQ-${s.id}-R${s.revision}`,
    issuedAt: new Date().toISOString(),
    facility,
    leftFields: [
      { label: 'Financial year', value: String(s.financial_year) },
      { label: 'Status', value: s.status },
      { label: 'Prepared by', value: s.prepared_name ?? String(s.prepared_by) },
      { label: 'Prepared date', value: String(s.prepared_at) },
    ],
    rightFields: [
      { label: 'Reviewed by', value: s.reviewed_name ?? 'Pending' },
      { label: 'Review date', value: s.reviewed_at ? String(s.reviewed_at) : 'Pending' },
      { label: 'Approved by', value: s.approved_name ?? 'Pending' },
      { label: 'Approval date', value: s.approved_at ? String(s.approved_at) : 'Pending' },
    ],
    table: {
      // Portrait facility letterheads cannot fit five or more numeric columns legibly.
      // Print the complete total ledger here and every partner's 14 rows below.
      columns: [
        { label: 'Description', width: 0.65 },
        { label: 'Total', width: 0.35, align: 'right' },
      ],
      rows: equityRows.map((row) => [
        row.label,
        fmt(r.totals[row.id], row.id === 'sharing' || row.id === 'ownership'),
      ]),
      repeatHeader: true,
    },
    sections: [
      {
        heading: 'Formula Audit — provisional source',
        body:
          formulaNotice +
          '\n' +
          Object.entries(formulaDefinitions)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n'),
      },
      ...partners.map((p) => ({
        heading: p.name,
        body: equityRows
          .map(
            (row) =>
              `${row.label}: ${fmt(r.cells[row.id][p.id], row.id === 'sharing' || row.id === 'ownership')}`,
          )
          .join('\n'),
      })),
      {
        heading: 'Reconciliation',
        body: `Exact allocation difference: ${r.exactAllocationDifference}; exact equity movement difference: ${r.exactClosingDifference}. Displayed partner allocations differ from total by ${r.rounding.allocationCents} cents and closing equity by ${r.rounding.closingCents} cents because total values use unrounded rational calculations. Displayed sharing rounding: ${r.rounding.sharingBasisPoints} basis points; displayed ownership rounding: ${r.rounding.ownershipBasisPoints} basis points. Unspecified cells: ${r.unspecified}. ${r.issues.join(' ')}`,
      },
      {
        heading: 'Review acceptance',
        body: s.review_acceptance ?? 'Pending independent formula review.',
      },
    ],
    notes: [
      ...sourceNotes,
      'Print layout: complete totals ledger followed by all 14 rows for every partner. No partner or financial row is omitted; the XLSX provides the full side-by-side grid.',
    ],
  };
  return document;
}
