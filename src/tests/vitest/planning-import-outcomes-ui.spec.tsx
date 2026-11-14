// @vitest-environment jsdom
import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PlanningImport } from '../../components/modules/planning/PlanningImport.tsx';
import {
  ImportNotification,
  ImportOverview,
  ImportResultsPanel,
  noticeForBatch,
} from '../../components/modules/planning/ImportResults.tsx';
const api = vi.hoisted(() => ({
  get: vi.fn(),
  send: vi.fn(),
  upload: vi.fn(),
  importResultsFile: vi.fn(),
}));
vi.mock('../../api/clients/planning.client.ts', async (original) => ({
  ...(await original<typeof import('../../api/clients/planning.client.ts')>()),
  planningApi: api,
}));
const plan = {
  id: 41,
  name: 'Synthetic annual plan',
  financial_year: 2026,
  plan_type: 'MIXED',
  currency: 'KES',
  inflation_bp: 500,
  version: 1,
  status: 'DRAFT',
};
const destination = {
  kind: 'EXISTING',
  name: plan.name,
  planId: 41,
  facilityId: 7,
  facilityName: 'Synthetic facility',
  financialYear: 2026,
  planType: 'MIXED',
  currency: 'KES',
  inflationBp: 500,
  version: 1,
};
const batch = {
  id: 88,
  filename: 'synthetic.csv',
  sha256: 'original-hash',
  created_at: '2026-10-27T10:00:00Z',
  uploaded_by: 12,
  status: 'UPLOADED',
  sheets: [{ name: 'CSV', rows: 1, preview: [] }],
};
const preview = {
  destination,
  counts: { newItems: 9, matchingItems: 0, skippedItems: 0, updates: 0, conflictingItems: 0 },
  rowCount: 9,
  previewHash: 'bound-preview',
  errors: [],
  warnings: ['Review defaults'],
  normalizations: [],
  items: [],
  uniforms: [],
  policy: 'ZERO_FILL',
};
const committed = {
  planId: 41,
  created: 1,
  updated: 0,
  skipped: 0,
  failed: 0,
  processed: 1,
  sourceRows: 1,
  defaultedCells: 2,
  warningCount: 1,
  destination,
  policy: 'ZERO_FILL',
  recordedAt: '2026-10-27T10:01:00Z',
};
const row = (outcome: string, description: string, extras = {}) => ({
  sheet: 'CSV',
  row: 1,
  kind: 'ITEM',
  description,
  category: 'OPD CONSUMABLES',
  outcome,
  message: 'Exact ' + outcome + ' reason',
  correctiveAction: 'Corrective ' + outcome,
  values: [],
  ...extras,
});
const result = () => ({
  batch: { ...batch, status: 'IMPORTED', result: committed },
  state: 'Successfully imported',
  counts: { created: 1, updated: 0, skipped: 1, failed: 0 },
  destination,
  warningCount: 1,
  normalizations: [],
  warnings: ['ZERO_FILL means assumptions, not verified zeros'],
  rows: [
    row('CREATED', 'Created record', {
      duplicateName: true,
      values: [{ field: 'Month 1', column: 'D', raw: '', value: '0', origin: 'DEFAULTED' }],
    }),
    row('SKIPPED', 'Skipped record'),
    row('FAILED', 'Rejected record'),
  ],
  lifecycle: [
    {
      id: 1,
      action: 'CONFIRM_IMPORT',
      actorId: 12,
      actorName: 'Synthetic reviewer',
      recordedAt: committed.recordedAt,
    },
  ],
});
beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockImplementation(async (_facility, path) =>
    path === '/plans'
      ? { plans: [plan], total: 1 }
      : path === '/imports'
        ? []
        : path === '/imports/summary'
          ? {
              total: 1,
              successful: 0,
              warnings: 0,
              failed: 0,
              awaiting: 1,
              attention: 1,
              selectedPlanRecords: 0,
            }
          : result(),
  );
  api.upload.mockResolvedValue(batch);
  api.send.mockResolvedValue(preview);
});
afterEach(cleanup);
async function open(onImported: (id: number) => void = vi.fn()) {
  render(<PlanningImport facilityId={7} plans={[]} onImported={onImported} />);
  fireEvent.change(screen.getByLabelText('Planning workbook'), {
    target: { files: [new File(['synthetic'], 'synthetic.csv', { type: 'text/csv' })] },
  });
  await screen.findByText('Preview and field mappings — batch #88');
  await screen.findByRole('option', { name: /Synthetic annual plan/ });
  fireEvent.change(screen.getByLabelText('Existing destination plan'), { target: { value: '41' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add source/category mapping block' }));
  fireEvent.click(screen.getByRole('button', { name: 'Validate and preview import' }));
  await screen.findByRole('region', { name: 'Validated import destination' });
}
describe('persistent outcome notification and confirmation boundary', () => {
  it('preview notification has zero created/updated and says awaiting confirmation, never imported', async () => {
    await open();
    const notice = screen.getByRole('status', { name: 'Import outcome notification' });
    expect(notice).toHaveTextContent('Awaiting confirmation');
    expect(notice).toHaveTextContent('0 created');
    expect(notice).toHaveTextContent('No records have been saved');
    expect(api.send.mock.calls.every((c) => !c[1].endsWith('/confirm'))).toBe(true);
  });
  it('shows importing while waiting, then uses actual committed counts rather than preview estimates', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((r) => {
      resolve = r;
    });
    await open();
    api.send.mockReturnValueOnce(pending);
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed categories/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
    expect(screen.getByRole('status', { name: 'Import outcome notification' })).toHaveTextContent(
      'Importing',
    );
    expect(screen.getByRole('button', { name: 'Importing…' })).toBeDisabled();
    await act(async () => resolve(committed));
    const notice = screen.getByRole('status', { name: 'Import outcome notification' });
    expect(notice).toHaveTextContent('Successfully imported');
    expect(notice).toHaveTextContent('1 created');
    expect(notice).not.toHaveTextContent('9 created');
    expect(notice).toHaveTextContent('2 values were defaulted');
  });
  it('a failed confirmation never displays a successful import', async () => {
    await open();
    api.send.mockRejectedValueOnce(new Error('Transaction rolled back'));
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed categories/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
    const notice = await screen.findByRole('alert', { name: 'Import outcome notification' });
    expect(notice).toHaveTextContent('Transaction rolled back');
    expect(notice).toHaveTextContent('0 created');
    expect(notice).toHaveTextContent('Refresh the full result');
  });
  it('a refresh/callback failure after the committed receipt does not relabel it a failed import', async () => {
    await open(() => {
      throw Error('view refresh failed');
    });
    api.send.mockResolvedValueOnce(committed);
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed categories/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
    await screen.findByText(/The import was committed, but the workspace could not refresh/);
    expect(screen.getByRole('status', { name: 'Import outcome notification' })).toHaveTextContent(
      'Successfully imported',
    );
  });
  it('validation errors block confirmation and show a correction notice', async () => {
    api.send.mockResolvedValue({
      ...preview,
      errors: [{ sheet: 'CSV', row: 1, message: 'Exact invalid base price' }],
    });
    await open();
    expect(screen.getByRole('button', { name: 'Confirm import' })).toBeDisabled();
    expect(screen.getByRole('alert', { name: 'Import outcome notification' })).toHaveTextContent(
      'Preview needs correction',
    );
  });
  it('notifications have explicit dismissal and reopen actions, with no auto-dismiss timer', () => {
    vi.useFakeTimers();
    try {
      const onOpen = vi.fn(),
        onDismiss = vi.fn();
      render(
        <ImportNotification
          notice={noticeForBatch({ ...batch, status: 'IMPORTED', result: committed })}
          onOpen={onOpen}
          onDismiss={onDismiss}
        />,
      );
      act(() => vi.advanceTimersByTime(120000));
      expect(screen.getByRole('status')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Open full result for batch 88' }));
      expect(onOpen).toHaveBeenCalledWith(88);
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
      expect(onDismiss).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
describe('full results, filters, access and refresh', () => {
  it('filters successful, warnings, skipped and failed rows, with value origins and corrective actions', async () => {
    render(<ImportResultsPanel facilityId={7} batchId={88} canExport onClose={() => {}} />);
    const panel = await screen.findByRole('region', { name: 'Import full result' });
    await screen.findByText('Created record');
    fireEvent.click(within(panel).getByRole('button', { name: 'Successful' }));
    expect(screen.getByText('Created record')).toBeInTheDocument();
    expect(screen.queryByText('Skipped record')).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Warnings' }));
    expect(screen.getByText(/Duplicate name — distinct source row preserved/)).toBeInTheDocument();
    expect(screen.getByText(/DEFAULTED/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Skipped' }));
    expect(screen.getByText('Exact SKIPPED reason')).toBeInTheDocument();
    expect(screen.getByText('Corrective SKIPPED')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Failed' }));
    expect(screen.getByText('Exact FAILED reason')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export errors and warnings CSV' }));
    await waitFor(() => expect(api.importResultsFile).toHaveBeenCalledWith(7, 88, true));
  });
  it('reopens stored results after remount and hides export for a reader', async () => {
    const view = render(
      <ImportResultsPanel facilityId={7} batchId={88} canExport={false} onClose={() => {}} />,
    );
    await screen.findByText('Created record');
    view.unmount();
    render(<ImportResultsPanel facilityId={7} batchId={88} canExport={false} onClose={() => {}} />);
    await screen.findByText('Created record');
    expect(api.get.mock.calls.filter((c) => c[1] === '/imports/88/results')).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: 'Export full results CSV' }),
    ).not.toBeInTheDocument();
  });
  it('does not retain another facility result while a new facility is loading', async () => {
    const view = render(
      <ImportResultsPanel facilityId={7} batchId={88} canExport={false} onClose={() => {}} />,
    );
    await screen.findByText('Created record');
    api.get.mockReturnValue(new Promise(() => {}));
    view.rerender(
      <ImportResultsPanel facilityId={8} batchId={88} canExport={false} onClose={() => {}} />,
    );
    expect(screen.queryByText('Created record')).not.toBeInTheDocument();
    expect(screen.getByText('Loading recorded result…')).toBeInTheDocument();
  });
  it('a reader can open history results but cannot upload or review/confirm', async () => {
    api.get.mockImplementation(async (_facility, path) =>
      path === '/imports'
        ? [{ ...batch, status: 'IMPORTED', result: committed }]
        : path === '/imports/summary'
          ? {}
          : result(),
    );
    render(<PlanningImport facilityId={7} plans={[]} canImport={false} onImported={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View results for batch 88' }));
    await screen.findByText('Created record');
    expect(screen.queryByLabelText('Planning workbook')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
    expect(api.send).not.toHaveBeenCalled();
  });
  it('pages large row results without dropping access to later rows', async () => {
    api.get.mockResolvedValue({
      ...result(),
      rows: Array.from({ length: 101 }, (_, i) => row('CREATED', `Record ${i}`)),
    });
    render(<ImportResultsPanel facilityId={7} batchId={88} canExport={false} onClose={() => {}} />);
    await screen.findByText('Record 0');
    expect(screen.queryByText('Record 100')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next result rows' }));
    expect(screen.getByText('Record 100')).toBeInTheDocument();
    expect(screen.queryByText('Record 0')).not.toBeInTheDocument();
  });
  it('indicators use server values and explicitly label selected-plan active records', async () => {
    render(<ImportOverview facilityId={7} planId={41} />);
    await screen.findByText('Total batches');
    expect(api.get).toHaveBeenCalledWith(7, '/imports/summary', { planId: 41 });
    expect(screen.getByText('Active imported records in selected plan')).toBeInTheDocument();
  });
});
