// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PlanningImport } from '../../components/modules/planning/PlanningImport.tsx';
import type { Plan } from '../../api/clients/planning.client.ts';
const api = vi.hoisted(() => ({ get: vi.fn(), send: vi.fn(), upload: vi.fn() }));
vi.mock('../../api/clients/planning.client.ts', async (original) => ({
  ...(await original<typeof import('../../api/clients/planning.client.ts')>()),
  planningApi: api,
}));
const rows = [
  {
    id: 2,
    filename: 'Syrona_Stationery.csv',
    status: 'CANCELLED',
    sha256: 'stationery-retained-hash',
    byte_size: 39236,
    created_at: '2026-10-01T10:00:00Z',
    validation: null,
    result: null,
  },
  {
    id: 1,
    filename: 'Syrona_Branding.csv',
    status: 'CANCELLED',
    sha256: 'branding-retained-hash',
    byte_size: 2425,
    validation: null,
    result: null,
  },
];
const source = {
  id: 2,
  status: 'CANCELLED',
  sheets: [
    {
      name: 'CSV',
      rows: 2,
      preview: [[{ value: 'Retained source description' }, { formula: '1+1', value: 2 }]],
    },
  ],
};
const target = {
  id: 41,
  name: 'Syrona Medical Center Annual Plan',
  status: 'DRAFT',
  financial_year: 2026,
  currency: 'KES',
  version: 1,
  inflation_bp: 500,
} as Plan;
const renderImport = () =>
  render(<PlanningImport facilityId={7} plans={[]} onImported={() => {}} />);
beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockImplementation(async (_facility, path) =>
    path === '/imports' ? rows : path === '/plans' ? { plans: [target], total: 1 } : source,
  );
  api.send.mockResolvedValue({ id: 2, status: 'UPLOADED', requiresPreview: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('cancelled planning import history', () => {
  it('offers read-only inspection and explicit retry for both incident rows without any automatic mutation', async () => {
    renderImport();
    await screen.findByText(/Syrona_Stationery.csv/);
    for (const id of [1, 2]) {
      expect(
        screen.getByRole('button', { name: `Inspect cancelled batch ${id}` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: `Retry review of batch ${id}` }),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByText('Not previewed')).toHaveLength(2);
    expect(api.send).not.toHaveBeenCalled();
    expect(api.upload).not.toHaveBeenCalled();
  });
  it('inspects retained source cells without enabling mapping, preview or import', async () => {
    renderImport();
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect cancelled batch 2' }));
    const view = await screen.findByRole('region', { name: 'Cancelled batch inspection' });
    expect(within(view).getByText('Retained source description')).toBeInTheDocument();
    expect(within(view).getByText('FORMULA: 1+1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Draft plan name')).not.toBeInTheDocument();
    expect(api.send).not.toHaveBeenCalled();
  });
  it('does not retry when the user rejects the explicit confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderImport();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry review of batch 2' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('SAME batch'));
    expect(api.send).not.toHaveBeenCalled();
  });
  it('retries only the explicitly chosen batch then opens fresh review without previewing or confirming import', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.get.mockImplementation(async (_facility, path) =>
      path === '/imports' ? rows : { ...source, status: 'UPLOADED' },
    );
    renderImport();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry review of batch 2' }));
    await screen.findByText('Preview and field mappings — batch #2');
    expect(api.send).toHaveBeenCalledExactlyOnceWith(7, '/imports/2/retry-review', {
      confirmRetry: true,
    });
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
    expect(api.upload).not.toHaveBeenCalled();
  });
  it('does not auto-retry a duplicate upload and lets the identical file be selected again', async () => {
    api.upload.mockRejectedValue(
      new Error(
        'This exact file is retained as cancelled batch 2. In Import history, inspect it or explicitly choose Retry review.',
      ),
    );
    renderImport();
    const input = screen.getByLabelText('Planning workbook') as HTMLInputElement;
    const file = new File(['source'], 'Syrona_Stationery.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByRole('alert');
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2));
    expect(api.send).not.toHaveBeenCalled();
  });
  it('keeps retry errors visible without pretending the batch was reopened', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.send.mockRejectedValue(new Error('Only a cancelled batch can be retried for review.'));
    renderImport();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry review of batch 2' }));
    await screen.findByText('Only a cancelled batch can be retried for review.');
    expect(screen.queryByText('Preview and field mappings — batch #2')).not.toBeInTheDocument();
  });
  it('loads all facility/year draft target pages independently of the filtered parent navigation list', async () => {
    const firstPage = Array.from({ length: 20 }, (_, n) => ({
      ...target,
      id: 100 + n,
      name: `Other draft ${n}`,
    }));
    api.get.mockImplementation(async (_facility, path, query) =>
      path === '/imports'
        ? rows.map((r) => ({ ...r, status: 'UPLOADED' }))
        : path === '/plans'
          ? query.page === 1
            ? { plans: firstPage, total: 21 }
            : { plans: [target], total: 21 }
          : { ...source, status: 'UPLOADED' },
    );
    renderImport();
    fireEvent.click(await screen.findByRole('button', { name: 'Review batch 2' }));
    await screen.findByText('Preview and field mappings — batch #2');
    fireEvent.change(screen.getByLabelText('Import financial year'), { target: { value: '2026' } });
    fireEvent.change(screen.getByLabelText('Import action'), { target: { value: 'SKIP' } });
    const option = await screen.findByRole('option', {
      name: '2026 · Syrona Medical Center Annual Plan · revision 1 · KES · 5% inflation',
    });
    await waitFor(() => expect(screen.getByLabelText('Target draft')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Target draft'), {
      target: { value: option.getAttribute('value') },
    });
    expect(screen.getByLabelText('Target draft')).toHaveValue('41');
    expect(api.get).toHaveBeenCalledWith(7, '/plans', { status: 'DRAFT', year: '2026', page: 2 });
    expect(api.send).not.toHaveBeenCalled();
  });
});
