import { describe, expect, it } from 'vitest';
import { exportReport } from '../../reporting/report-centre.export.ts';
import type { ReportResult } from '../../reporting/report-centre.types.ts';

function report(values: string[]): ReportResult {
  return {
    reportId: 'inventory-category',
    title: 'Synthetic inventory',
    facilityId: 1,
    facilityName: 'Synthetic facility',
    currency: 'KES',
    generatedAt: '2026-11-06T00:00:00.000Z',
    filters: { facilityId: 1 },
    columns: [{ key: 'value', label: 'Value' }],
    rows: values.map((value) => ({ value })),
    total: values.length,
    offset: 0,
    limit: 25,
    notes: [],
  };
}

describe('Reporting Centre CSV safety', () => {
  it('quotes cells and neutralizes formula leaders after whitespace without altering ordinary text', async () => {
    const output = await exportReport(
      report([' =SUM(1,2)', '\t@cmd', '+1', '-1', 'normal, "quoted"']),
      'csv',
    );
    const csv = Buffer.from(output.base64, 'base64').toString('utf8');
    expect(csv).toContain('"\' =SUM(1,2)"');
    expect(csv).toContain('"\'\t@cmd"');
    expect(csv).toContain('"\'+1"');
    expect(csv).toContain('"\'-1"');
    expect(csv).toContain('"normal, ""quoted"""');
  });

  it('rejects unsupported control characters rather than masking or stripping data', async () => {
    await expect(exportReport(report(['\u0001=cmd']), 'csv')).rejects.toMatchObject({
      code: 'REPORT_EXPORT_UNSUPPORTED_TEXT',
      status: 422,
    });
  });
});
