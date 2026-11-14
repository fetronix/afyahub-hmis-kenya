// @vitest-environment jsdom
import React from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PlanningImport } from '../../components/modules/planning/PlanningImport.tsx';
const api = vi.hoisted(() => ({ get: vi.fn(), send: vi.fn(), upload: vi.fn() }));
vi.mock('../../api/clients/planning.client.ts', async (original) => ({
  ...(await original<typeof import('../../api/clients/planning.client.ts')>()),
  planningApi: api,
}));
const plan = {
  id: 41,
  name: 'Syrona Medical Center Annual Plan 2026',
  financial_year: 2026,
  plan_type: 'MIXED',
  currency: 'KES',
  inflation_bp: 500,
  status: 'DRAFT',
  version: 1,
};
const batch = { id: 88, status: 'UPLOADED', sheets: [{ name: 'CSV', rows: 2, preview: [] }] };
const review = {
  rowCount: 1,
  items: [],
  uniforms: [],
  errors: [],
  warnings: ['Review source assumptions'],
  normalizations: [{ sheet: 'CSV', row: 1, column: 'C', raw: '-', value: 0, reason: 'dash' }],
  previewHash: 'bound-review-hash',
  destination: {
    kind: 'EXISTING',
    mode: 'SKIP',
    name: plan.name,
    planId: 41,
    facilityId: 7,
    facilityName: 'Synthetic facility',
    financialYear: 2026,
    planType: 'MIXED',
    currency: 'KES',
    inflationBp: 500,
    version: 1,
  },
  counts: { newItems: 1, matchingItems: 2, skippedItems: 2, updates: 0, conflictingItems: 0 },
};
beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockImplementation(async (_f, path) =>
    path === '/plans' ? { plans: [plan], total: 1 } : [],
  );
  api.upload.mockResolvedValue(batch);
  api.send.mockResolvedValue(review);
});
afterEach(cleanup);
async function open() {
  render(<PlanningImport facilityId={7} plans={[]} onImported={() => {}} />);
  fireEvent.change(screen.getByLabelText('Planning workbook'), {
    target: { files: [new File(['test'], 'test.csv', { type: 'text/csv' })] },
  });
  await screen.findByText('Preview and field mappings — batch #88');
}
async function selectPlan() {
  await screen.findByRole('option', { name: /Syrona Medical Center Annual Plan 2026/ });
  fireEvent.change(screen.getByLabelText('Existing destination plan'), { target: { value: '41' } });
  await waitFor(() => expect(screen.getByLabelText('Existing destination plan')).toHaveValue('41'));
}
const mapping = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Add source/category mapping block' }));
async function preview() {
  mapping();
  fireEvent.click(screen.getByRole('button', { name: 'Validate and preview import' }));
  await screen.findByRole('region', { name: 'Validated import destination' });
}

describe('explicit destination workflow', () => {
  it('defaults to importing into an existing plan with no editable new-draft name', async () => {
    await open();
    expect(screen.getByLabelText('Import destination')).toHaveValue('EXISTING');
    expect(screen.queryByLabelText('Draft plan name')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Existing destination plan')).toBeInTheDocument();
    expect(api.send).not.toHaveBeenCalled();
  });
  it('loads all eligible authenticated-facility pages and displays full plan identity independently of parent navigation', async () => {
    api.get.mockImplementation(async (_f, path, q) =>
      path === '/plans'
        ? q.page === 1
          ? {
              plans: Array.from({ length: 20 }, (_, n) => ({
                ...plan,
                id: 100 + n,
                name: 'Other draft ' + n,
              })),
              total: 21,
            }
          : { plans: [plan], total: 21 }
        : [],
    );
    await open();
    await selectPlan();
    expect(api.get).toHaveBeenCalledWith(7, '/plans', { status: 'DRAFT', page: 2 });
    expect(
      screen.getByRole('option', {
        name: /Syrona Medical Center Annual Plan 2026 · 2026 · MIXED · KES · DRAFT · ID 41 · revision 1/,
      }),
    ).toBeInTheDocument();
  });
  it('automatically populates and locks the selected target assumptions', async () => {
    await open();
    await selectPlan();
    expect(screen.getByLabelText('Import financial year')).toHaveValue(2026);
    expect(screen.getByLabelText('Import financial year')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Import inflation percentage')).toHaveValue('5');
    expect(screen.getByLabelText('Plan type')).toHaveValue('MIXED');
    expect(screen.getByLabelText('Currency')).toHaveValue('KES');
    expect(screen.getByLabelText('Currency')).toBeDisabled();
  });
  it('sends selected destination ID, version and assumptions to server preview and shows bound review summary', async () => {
    await open();
    await selectPlan();
    await preview();
    expect(api.send).toHaveBeenCalledWith(
      7,
      '/imports/88/preview',
      expect.objectContaining({
        destination: 'EXISTING',
        mode: 'SKIP',
        planId: '41',
        version: 1,
        name: plan.name,
        financialYear: '2026',
        planType: 'MIXED',
        currency: 'KES',
        inflationPercent: '5',
      }),
    );
    expect(screen.getByRole('region', { name: 'Validated import destination' })).toHaveTextContent(
      'ID 41',
    );
    expect(screen.getByText(/1 new items · 2 matching items · 2 skipped/)).toBeInTheDocument();
    expect(screen.getByText('Review source assumptions')).toBeInTheDocument();
    expect(screen.getByText(/1 defaulted cells/)).toBeInTheDocument();
  });
  it('switches deliberately to new draft, reveals editable fields, warns about existing year plans and requires additional-plan authorization', async () => {
    await open();
    await selectPlan();
    fireEvent.change(screen.getByLabelText('Import destination'), { target: { value: 'NEW' } });
    expect(screen.getByLabelText('Draft plan name')).toBeInTheDocument();
    expect(screen.getByLabelText('Import financial year')).not.toHaveAttribute('readonly');
    expect(screen.queryByLabelText('Existing destination plan')).not.toBeInTheDocument();
    expect(screen.getByText(/A NEW, separate draft plan/)).toBeInTheDocument();
    await screen.findByLabelText(
      'I explicitly authorize an additional separate draft for this facility/year',
    );
    fireEvent.change(screen.getByLabelText('Draft plan name'), {
      target: { value: 'Intentionally separate projection' },
    });
    mapping();
    expect(screen.getByRole('button', { name: 'Validate and preview import' })).toBeDisabled();
    fireEvent.click(
      screen.getByLabelText(
        'I explicitly authorize an additional separate draft for this facility/year',
      ),
    );
    expect(screen.getByRole('button', { name: 'Validate and preview import' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Validate and preview import' }));
    await waitFor(() =>
      expect(api.send).toHaveBeenCalledWith(
        7,
        '/imports/88/preview',
        expect.objectContaining({
          destination: 'NEW',
          mode: 'NEW',
          planId: '',
          name: 'Intentionally separate projection',
          confirmAdditionalPlan: true,
        }),
      ),
    );
  });
  it('invalidates the preview when destination, merge behavior or new-plan assumptions change', async () => {
    await open();
    await selectPlan();
    await preview();
    fireEvent.change(screen.getByLabelText('Reviewed merge behavior'), {
      target: { value: 'UPDATE' },
    });
    expect(
      screen.queryByRole('region', { name: 'Validated import destination' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Validate and preview import' }));
    await screen.findByRole('region', { name: 'Validated import destination' });
    fireEvent.change(screen.getByLabelText('Import destination'), { target: { value: 'NEW' } });
    expect(
      screen.queryByRole('region', { name: 'Validated import destination' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
  });
  it('uses the exact preview request snapshot and hash for confirmation (mocked API only; no import executed)', async () => {
    await open();
    await selectPlan();
    await preview();
    const sent = api.send.mock.calls[0][2];
    fireEvent.click(screen.getByLabelText(/I reviewed categories/));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
    await waitFor(() =>
      expect(api.send).toHaveBeenCalledWith(7, '/imports/88/confirm', {
        ...sent,
        confirm: true,
        confirmUpdate: false,
        previewHash: 'bound-review-hash',
      }),
    );
  });
  it('fails closed when eligible-plan lookup fails instead of enabling a new-plan preview', async () => {
    api.get.mockImplementation(async (_f, path) => {
      if (path === '/plans') throw Error('Plan lookup failed');
      return [];
    });
    await open();
    fireEvent.change(screen.getByLabelText('Import destination'), { target: { value: 'NEW' } });
    fireEvent.change(screen.getByLabelText('Draft plan name'), {
      target: { value: 'Unsafe fallback' },
    });
    mapping();
    await screen.findByText('Plan lookup failed');
    expect(screen.getByRole('button', { name: 'Validate and preview import' })).toBeDisabled();
    expect(api.send).not.toHaveBeenCalled();
  });
});
