/** Source-derived catalogue, enriched only with saved synthetic acceptance evidence. No SQL execution. */
import { readFileSync, writeFileSync } from 'node:fs';
import { REPORT_CATEGORIES } from '../src/reporting/report-catalogue.ts';
import { REPORT_ENGINES } from '../src/reporting/report-centre.types.ts';
import { queryPlan } from '../src/reporting/report-centre.service.ts';
const evidence = 'docs/audits/clinical-documents-evidence/';
const results = JSON.parse(readFileSync(evidence + 'report-results.json', 'utf8')) as Array<{
  id: string;
  records: number;
  filters: unknown;
}>;
const documentPaths = {
  invoice: '/api/documents/invoices/:id/pdf',
  radiology: '/api/documents/radiology-orders/:id/pdf',
  laboratory: '/api/documents/laboratory-orders/:id/pdf',
  discharge: '/api/documents/admissions/:id/discharge-summary.pdf',
};
const rows = REPORT_CATEGORIES.flatMap((category) =>
  category.reports.map((entry) => {
    const d = entry.engine ? REPORT_ENGINES[entry.engine] : null;
    const plan = entry.engine ? queryPlan(entry.engine, 1, { facilityId: 2 }) : null;
    const tables = plan
      ? [
          ...new Set(
            Array.from(
              ('FROM ' + plan.from).matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z_0-9]*)/gi),
              (m) => m[1],
            ),
          ),
        ]
      : [];
    const filters = d
      ? [
          'search',
          ...(d.statuses ? ['status'] : []),
          ...(d.dateLabel
            ? [d.dateMode === 'asOf' ? 'as-of date' : 'inclusive from/to dates']
            : []),
          ...Object.keys(d).filter((k) => k.endsWith('Filter') && d[k as keyof typeof d]),
        ]
      : [];
    return {
      category: category.name,
      name: entry.name,
      id: entry.id,
      module: d?.module ?? entry.workflow ?? 'Unavailable',
      endpoint: entry.engine
        ? `POST /api/reporting/centre/${entry.engine}/{generate,options,export}`
        : entry.workflow
          ? `GET ${documentPaths[entry.workflow]}`
          : 'NONE',
      dataSource: tables.length
        ? tables.join(', ')
        : entry.workflow
          ? 'Existing persisted scoped document builder'
          : 'No integrated workflow',
      filters: filters.length
        ? filters.join(', ')
        : entry.workflow
          ? 'Saved source document reference; not a tabular report'
          : 'NONE',
      formats: entry.engine ? 'PDF, XLSX, CSV' : entry.workflow ? 'PDF' : 'NONE',
      letterhead: entry.engine
        ? 'Common active facility renderer; Print PDF uses same path'
        : entry.workflow
          ? 'Existing historical/pinned facility renderer'
          : 'Unavailable',
      status: entry.engine
        ? 'PARTIALLY FUNCTIONAL — tested implemented subset'
        : entry.workflow
          ? 'PARTIALLY FUNCTIONAL — existing document workflow'
          : 'MISSING BACKEND / INTEGRATED WORKFLOW',
      runtimeEvidence: entry.engine
        ? (results.find((r) => r.id === entry.engine) ?? 'NOT RUN')
        : entry.workflow === 'radiology'
          ? 'Actual authenticated browser and HTTP; integration tests'
          : entry.workflow
            ? 'Existing real PostgreSQL/HTTP integration tests; no new reference-picker browser acceptance'
            : 'NOT RUN / unavailable',
      limitation:
        entry.dependency +
        (entry.workflow && entry.workflow !== 'invoice'
          ? ' Enter source request/admission ID; no browsing, Excel or CSV.'
          : ''),
    };
  }),
);
writeFileSync(evidence + 'report-catalogue.json', JSON.stringify(rows, null, 2) + '\n');
const clean = (v: unknown) => String(v).replaceAll('|', '/').replaceAll('\n', ' ');
const columns = [
  'name',
  'module',
  'endpoint',
  'dataSource',
  'filters',
  'formats',
  'letterhead',
  'status',
  'limitation',
] as const;
writeFileSync(
  'docs/audits/CLINICAL_DOCUMENTS_REPORT_CATALOGUE.md',
  '# Reporting Centre — every exposed catalogue entry\n\nSource-derived inventory enriched with actual synthetic acceptance evidence. A tested subset is not the complete requested report. Unavailable entries are not presentation-ready. See `clinical-documents-evidence/report-catalogue.json` for per-entry runtime details.\n\n| Report | Source module | API endpoint | Data source | Filters | Exports | Letterhead | Functional status | Remaining limitation |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    rows.map((row) => '| ' + columns.map((c) => clean(row[c])).join(' | ') + ' |').join('\n') +
    '\n',
);
console.log('Inventoried', rows.length, 'entries');
