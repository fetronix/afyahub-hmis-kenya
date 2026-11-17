/**
 * Build the Reporting Centre completion inventory.
 *
 * The inventory is generated from the catalogue and engine registry rather
 * than typed by hand, so it cannot drift from what the application actually
 * offers. Every report in every category appears once, with what it reads,
 * what it can filter on, whether its PDF and Excel exports have been exercised
 * by an automated test, and whether its calculation and permission rules have
 * been verified against source records.
 *
 *   npx tsx scripts/build-reporting-centre-inventory.ts
 *
 * Outputs:
 *   docs/audits/REPORTING_CENTRE_COMPLETION_INVENTORY.json
 *   docs/audits/REPORTING_CENTRE_COMPLETION_INVENTORY.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { REPORT_CATEGORIES, reportImplementation, type ReportEntry } from '../src/reporting/report-catalogue.ts';
import { REPORT_ENGINES, type ReportEngineDefinition } from '../src/reporting/report-centre.types.ts';

const MATRIX = 'docs/audits/REPORTING_PROGRAMME_CURRENT_MATRIX.json';
const JSON_OUT = 'docs/audits/REPORTING_CENTRE_COMPLETION_INVENTORY.json';
const MD_OUT = 'docs/audits/REPORTING_CENTRE_COMPLETION_INVENTORY.md';

interface MatrixEntry {
  id: string;
  name: string;
  sourceModule: string;
  requiredDatabaseEntities: Array<{ entity: string; schema: string }>;
  requiredFilters: string[];
  functionalStatus: string;
  missingImplementation: string;
  dependenciesAndRisks: string;
}

/** Engines whose PDF and XLSX bytes are read back by an automated test. */
const SELECTOR_EXPORTED = new Set([
  'inventory-category',
  'inventory-store',
  'inventory-expiry',
  'purchase-orders',
  'current-inpatients',
  'patient-registrations',
  'outpatient-encounters',
  'inpatient-admissions',
  'inpatient-discharges',
  'laboratory-orders',
  'radiology-requests',
  'pharmacy-dispensations',
  'cashier-receipts',
  'recorded-refunds',
  'invoice-balances',
  'ledger-trial-movements',
  'ledger-income',
  'ledger-balance-sheet',
]);

/** Where each engine's rows are recomputed from source records. */
const CALCULATION_EVIDENCE: Record<string, string[]> = {
  'inventory-category': ['report-centre.db.spec.ts', 'report-centre-selectors.db.spec.ts'],
  'inventory-store': ['report-centre-selectors.db.spec.ts'],
  'inventory-expiry': ['report-centre-operational.db.spec.ts', 'report-centre-selectors.db.spec.ts'],
  'inventory-movements': ['report-centre-movements.db.spec.ts'],
  'purchase-orders': ['report-centre-selectors.db.spec.ts'],
  'current-inpatients': ['report-centre.db.spec.ts', 'report-centre-selectors.db.spec.ts'],
  'patient-registrations': [
    'report-centre-operational.db.spec.ts',
    'report-centre-selectors.db.spec.ts',
  ],
  'outpatient-encounters': [
    'report-centre-operational.db.spec.ts',
    'report-centre-selectors.db.spec.ts',
  ],
  'outpatient-diagnoses': ['report-centre-diagnoses.db.spec.ts'],
  'inpatient-admissions': [
    'report-centre-operational.db.spec.ts',
    'report-centre-selectors.db.spec.ts',
  ],
  'inpatient-discharges': [
    'report-centre-operational.db.spec.ts',
    'report-centre-selectors.db.spec.ts',
  ],
  'laboratory-orders': [
    'report-centre-operational.db.spec.ts',
    'report-centre-selectors.db.spec.ts',
  ],
  'radiology-requests': [
    'report-centre-operational.db.spec.ts',
    'report-centre-selectors.db.spec.ts',
  ],
  'pharmacy-dispensations': [
    'report-centre-operational.db.spec.ts',
    'report-centre-selectors.db.spec.ts',
  ],
  'cashier-receipts': [
    'report-centre-operational.db.spec.ts',
    'report-centre-selectors.db.spec.ts',
  ],
  'recorded-refunds': [
    'report-centre-operational.db.spec.ts',
    'report-centre-selectors.db.spec.ts',
  ],
  'invoice-balances': [
    'report-centre-operational.db.spec.ts',
    'report-centre-selectors.db.spec.ts',
  ],
  'ledger-trial-movements': ['report-centre-ledger.db.spec.ts', 'report-centre-selectors.db.spec.ts'],
  'ledger-income': ['report-centre-ledger.db.spec.ts', 'report-centre-selectors.db.spec.ts'],
  'ledger-balance-sheet': ['report-centre-ledger.db.spec.ts', 'report-centre-selectors.db.spec.ts'],
};

const PERMISSION_EVIDENCE = [
  'report-centre.db.spec.ts (session, reports.read, source-domain permission, facility scope, sibling/foreign denial)',
  'report-centre-selectors.db.spec.ts (selector scope, export grants, cross-facility denial)',
];

function filtersOf(definition: ReportEngineDefinition): string {
  const parts = ['facility (authorised only)'];
  if (definition.dateMode === 'asOf') parts.push('as-of date (required)');
  else if (definition.dateRangeRequired) parts.push('inclusive from/to (required)');
  else if (definition.dateLabel) parts.push(`inclusive period (${definition.dateLabel})`);
  if (definition.searchLabel) parts.push(`literal search (${definition.searchLabel})`);
  if (definition.statuses?.length)
    parts.push(`status (${definition.statuses.map((status) => status.label).join(' / ')})`);
  for (const [flag, label] of [
    ['patientFilter', 'patient'],
    ['wardFilter', 'ward'],
    ['departmentFilter', 'department'],
    ['staffFilter', 'staff'],
    ['bedFilter', 'bed'],
    ['inventoryItemFilter', 'item'],
    ['supplierFilter', 'supplier'],
    ['purchaseOrderFilter', 'purchase order'],
    ['labTestFilter', 'laboratory test'],
    ['serviceFilter', 'service'],
    ['invoiceFilter', 'invoice'],
    ['receiptFilter', 'receipt'],
    ['accountFilter', 'account'],
  ] as const)
    if (definition[flag]) parts.push(label);
  return parts.join('; ');
}

function dataSourceOf(entry: ReportEntry, matrix: MatrixEntry | undefined): string {
  if (entry.engine) {
    const definition = REPORT_ENGINES[entry.engine];
    const tables = matrix?.requiredDatabaseEntities?.map((entity) => entity.entity) ?? [];
    return [
      `${definition.module} module — ${definition.description}`,
      tables.length ? `Required source tables: ${tables.join(', ')}.` : '',
      definition.notes[0] ?? '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (entry.workflow)
    return {
      invoice:
        'Existing finalized-invoice document (billing_invoices, billing_invoice_finalizations, billing_items, facility_letterheads).',
      discharge: 'Existing discharge-summary document for a recorded admission.',
      laboratory: 'Existing laboratory report document for a recorded order.',
      radiology: 'Existing radiology report document for a recorded request.',
    }[entry.workflow];
  const tables = matrix?.requiredDatabaseEntities?.map((entity) => entity.entity) ?? [];
  return tables.length
    ? `${matrix?.sourceModule ?? 'unknown'} module — candidate source tables: ${tables.join(', ')} (requirements, not an implemented join).`
    : 'No integrated source.';
}

const matrixFile = JSON.parse(readFileSync(MATRIX, 'utf8')) as { entries: MatrixEntry[] };
const matrixById = new Map(matrixFile.entries.map((entry) => [entry.id, entry]));

const rows = REPORT_CATEGORIES.flatMap((category) =>
  category.reports.map((entry) => {
    const implementation = reportImplementation(entry);
    const definition = entry.engine ? REPORT_ENGINES[entry.engine] : null;
    const matrix = matrixById.get(entry.id);
    if (!matrix) throw new Error(`The baseline matrix has no entry for ${entry.id}`);
    const exports =
      entry.engine ?
        {
          pdf: SELECTOR_EXPORTED.has(entry.engine)
            ? 'Verified — the automated test reads %PDF- bytes from the export endpoint.'
            : 'Supported — same export endpoint; the automated evidence for this engine reads CSV only.',
          xlsx: SELECTOR_EXPORTED.has(entry.engine)
            ? 'Verified — the automated test unzips the .xlsx and reads cell values, and asserts no formulas.'
            : 'Supported — same export endpoint; the automated evidence for this engine reads CSV only.',
        }
      : entry.workflow ?
        {
          pdf:
            entry.workflow === 'invoice'
              ? 'Verified — finalized invoice PDF, scoped and audited, in report-centre.db.spec.ts and report-centre-invoice-ui.spec.tsx.'
              : 'Existing document renderer; the Reporting Centre reuses it and does not re-render the document.',
          xlsx: 'Not applicable — these are single documents, not tabular exports.',
        }
      : {
          pdf: 'Not implemented — there is no report to export.',
          xlsx: 'Not implemented — there is no report to export.',
        };
    return {
      id: entry.id,
      name: entry.name,
      category: category.name,
      categoryId: category.id,
      group: entry.group,
      purpose: entry.summary,
      implementation: implementation.status,
      implementationLabel: implementation.label,
      engine: entry.engine,
      workflow: entry.workflow,
      requiredModule: definition?.module ?? null,
      recordPermissions: definition?.permissions ?? null,
      exportPermissions: definition?.exportPermissions ?? null,
      dataSource: dataSourceOf(entry, matrix),
      filters: definition ? filtersOf(definition) : entry.workflow ? 'document reference (authorised records only)' : 'none — not implemented',
      pdfExport: exports.pdf,
      excelExport: exports.xlsx,
      calculationVerified:
        entry.engine && CALCULATION_EVIDENCE[entry.engine]
          ? `Verified against source rows — ${CALCULATION_EVIDENCE[entry.engine].join(', ')}.`
          : entry.engine
            ? 'Not yet verified against source rows.'
            : 'Not applicable — there is no calculation to verify.',
      permissionVerified:
        entry.engine
          ? `Verified server-side — ${PERMISSION_EVIDENCE.join(' ')}`
          : entry.workflow === 'invoice'
            ? 'Verified server-side — report-centre.db.spec.ts (scoped finalized invoice, print permission) and report-centre-invoice-ui.spec.tsx.'
            : entry.workflow
              ? 'Verified server-side — clinical-document-report-ui.spec.tsx plus the patient-document integration suites; the document service enforces tenant, facility, role and release rules.'
              : 'Not applicable — the server refuses the report before reading anything (404/403 gate).',
      stillNeeded: entry.dependency,
      risks: matrix.dependenciesAndRisks,
    };
  }),
);

function escapeCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const counts = {
  reports: rows.length,
  categories: REPORT_CATEGORIES.length,
  engineBacked: rows.filter((row) => row.engine).length,
  documentBacked: rows.filter((row) => row.workflow).length,
  notImplemented: rows.filter((row) => row.implementation === 'unavailable').length,
};

const json = {
  generatedAt: new Date().toISOString(),
  generatedBy: 'scripts/build-reporting-centre-inventory.ts',
  catalogue: 'src/reporting/report-catalogue.ts',
  engines: 'src/reporting/report-centre.types.ts',
  scope:
    'Every catalogue entry, including the reports that are not implemented. Implementation status describes what this build can produce, not what a report screen renders.',
  counts,
  categories: REPORT_CATEGORIES.map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description,
    reports: category.reports.length,
    runnable: category.reports.filter((entry) => entry.engine || entry.workflow).length,
  })),
  reports: rows,
};
writeFileSync(JSON_OUT, `${JSON.stringify(json, null, 2)}\n`);

const lines: string[] = [];
lines.push('# Reporting Centre — report completion inventory');
lines.push('');
lines.push(
  `Generated from ${json.catalogue} and ${json.engines} by \`${json.generatedBy}\` on ${json.generatedAt}.`,
);
lines.push('');
lines.push(
  'A report is listed as **available** only when a server-side engine answers the request with a documented, scoped subset of the requested report. **Existing document** means the Reporting Centre reuses a document workflow that already exists. **Not implemented** means the server refuses the request and the catalogue states what is missing. Rendering a page is not completion.',
);
lines.push('');
lines.push(
  `Totals: **${counts.reports} reports** in **${counts.categories} categories** — ${counts.engineBacked} engine-backed, ${counts.documentBacked} existing-document workflows, ${counts.notImplemented} not implemented.`,
);
lines.push('');
lines.push('## Verification performed for this inventory');
lines.push('');
lines.push(
  '- Calculation checks recompute each engine\'s rows and totals from the source transactions in a disposable synthetic PostgreSQL: `report-centre.db.spec.ts`, `report-centre-operational.db.spec.ts`, `report-centre-selectors.db.spec.ts`, `report-centre-diagnoses.db.spec.ts`, `report-centre-ledger.db.spec.ts`, `report-centre-movements.db.spec.ts`.',
);
lines.push(
  '- Permission and tenant/facility checks are exercised in the same suites: unauthenticated, missing `reports.read`, missing source-domain permission, missing export grant, sibling facility, foreign tenant and platform-account refusals.',
);
lines.push(
  '- PDF and Excel evidence means the test read the returned bytes: `%PDF-` header, a real `.xlsx` archive with the expected cell text and no formulas, and formula-safe CSV quoting.',
);
lines.push(
  '- The four headline figures are verified in `report-centre-overview.db.spec.ts` (totals recomputed from source rows, restricted/disabled/error states, cross-facility denial, empty period) and `reporting-kpis.spec.tsx` (only a verified figure carries a number).',
);
lines.push('');
lines.push('## Categories');
lines.push('');
lines.push('| # | Category | Reports | Runnable |');
lines.push('| --- | --- | --- | --- |');
json.categories.forEach((category, index) =>
  lines.push(
    `| ${index + 1} | ${escapeCell(category.name)} | ${category.reports} | ${category.runnable} |`,
  ),
);
lines.push('');

for (const category of REPORT_CATEGORIES) {
  const categoryRows = rows.filter((row) => row.categoryId === category.id);
  if (!categoryRows.length) continue;
  lines.push(`## ${category.name}`);
  lines.push('');
  lines.push(category.description);
  lines.push('');
  lines.push(
    `${categoryRows.length} reports · ${categoryRows.filter((row) => row.engine || row.workflow).length} runnable.`,
  );
  lines.push('');
  lines.push(
    '| Report | Implementation | Data source | Filters | PDF | Excel | Calculation verified | Permission verified |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of categoryRows) {
    lines.push(
      `| ${escapeCell(row.name)} (\`${row.id}\`) | ${row.implementationLabel} — ${escapeCell(row.purpose)} | ${escapeCell(row.dataSource)} | ${escapeCell(row.filters)} | ${escapeCell(row.pdfExport)} | ${escapeCell(row.excelExport)} | ${escapeCell(row.calculationVerified)} | ${escapeCell(row.permissionVerified)} |`,
    );
  }
  lines.push('');
  const unimplemented = categoryRows.filter((row) => !row.engine && !row.workflow);
  if (unimplemented.length) {
    lines.push('Still needed before the unimplemented reports in this category can be produced:');
    lines.push('');
    for (const row of unimplemented)
      lines.push(`- **${row.name}** — ${row.stillNeeded}`);
    lines.push('');
  }
}

lines.push('## What this inventory does not claim');
lines.push('');
lines.push(
  '- It does not claim that an engine-backed report is the complete statutory or management report. Each row states the subset it covers and what is still needed.',
);
lines.push(
  '- It does not claim a calculation is correct in every operational corner; it records which source-records check exists.',
);
lines.push(
  '- It does not claim any report is production-accepted. Synthetic data was used throughout.',
);
writeFileSync(MD_OUT, `${lines.join('\n')}\n`);

console.info(`Wrote ${JSON_OUT} and ${MD_OUT}`, counts);
