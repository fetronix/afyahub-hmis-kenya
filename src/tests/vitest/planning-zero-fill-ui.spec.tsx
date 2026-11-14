// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanningInlineItem } from '../../components/modules/planning/PlanningInlineItem.tsx';
import { PlanningImport } from '../../components/modules/planning/PlanningImport.tsx';
import type { Plan } from '../../api/clients/planning.client.ts';
const mocks = vi.hoisted(() => ({ get: vi.fn(), send: vi.fn(), upload: vi.fn() }));
vi.mock('../../api/clients/planning.client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/clients/planning.client.ts')>();
  return { ...actual, planningApi: mocks };
});
const plan = { id: 41, version: 3, status: 'DRAFT', inflation_bp: 500, currency: 'KES' } as Plan;
const fullItem = {
  id: 51,
  category_id: 61,
  description: 'Synthetic gloves',
  unit: 'Box',
  base_price_cents: '1000',
  inflation_bp: null,
  months: Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}-01`,
    quantity: i === 0 ? null : '1.000',
  })),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(fullItem);
  mocks.send.mockResolvedValue({});
});
afterEach(cleanup);

describe('inline planning edits', () => {
  it('loads all months, previews totals live and sends an audited versioned 12-month update', async () => {
    const saved = vi.fn();
    render(
      <PlanningInlineItem
        facilityId={7}
        plan={plan}
        itemId={51}
        onSaved={saved}
        onCancel={() => {}}
      />,
    );
    await screen.findByText(/Live annual preview: 115.50/);
    expect(mocks.get).toHaveBeenCalledWith(7, '/plans/41/items/51');
    fireEvent.change(screen.getByLabelText('Inline base price'), { target: { value: '20' } });
    await screen.findByText(/Live annual preview: 231.00/);
    fireEvent.change(screen.getByLabelText('Inline January quantity'), { target: { value: '2' } });
    await screen.findByText(/Live annual preview: 273.00/);
    fireEvent.click(screen.getByText('Save inline changes'));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(mocks.send).toHaveBeenCalledWith(
      7,
      '/plans/41/items/51',
      expect.objectContaining({
        version: 3,
        basePrice: '20',
        quantities: ['2', ...Array(11).fill('1.000')],
      }),
      'PATCH',
    );
  });
  it('does not zero-fill deliberate manual blanks or discard edits after a stale-version response', async () => {
    mocks.send.mockRejectedValue(new Error('This plan changed. Refresh before saving.'));
    const saved = vi.fn();
    render(
      <PlanningInlineItem
        facilityId={7}
        plan={plan}
        itemId={51}
        onSaved={saved}
        onCancel={() => {}}
      />,
    );
    await screen.findByText(/Live annual preview: 115.50/);
    fireEvent.click(screen.getByText('Save inline changes'));
    expect(await screen.findByRole('alert')).toHaveTextContent('This plan changed');
    expect(mocks.send.mock.calls[0][2].quantities).toEqual([null, ...Array(11).fill('1.000')]);
    expect(saved).not.toHaveBeenCalled();
  });
  it('blocks invalid numeric saves and approved-plan edits', async () => {
    const props = { facilityId: 7, plan, itemId: 51, onSaved: vi.fn(), onCancel: vi.fn() };
    const view = render(<PlanningInlineItem {...props} />);
    await screen.findByText(/Live annual preview: 115.50/);
    fireEvent.change(screen.getByLabelText('Inline base price'), { target: { value: '-1' } });
    expect(screen.getByText('Save inline changes')).toBeDisabled();
    expect(mocks.send).not.toHaveBeenCalled();
    view.rerender(<PlanningInlineItem {...props} plan={{ ...plan, status: 'APPROVED' }} />);
    expect(screen.getByLabelText('Inline base price')).toBeDisabled();
  });
});

describe('CSV upload and policy selection', () => {
  it('accepts CSV files and defaults to visible zero-fill with an optional strict policy', async () => {
    mocks.get.mockResolvedValue([]);
    mocks.upload.mockResolvedValue({
      id: 1,
      status: 'UPLOADED',
      sheets: [{ name: 'CSV', rows: 2, preview: [] }],
    });
    render(<PlanningImport facilityId={7} plans={[]} onImported={() => {}} />);
    const input = screen.getByLabelText('Planning workbook') as HTMLInputElement;
    expect(input.accept).toContain('.csv');
    const file = new File(['Item,,\n'], 'plan.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    const policy = await screen.findByLabelText('Missing-value policy');
    expect(policy).toHaveValue('ZERO_FILL');
    expect(mocks.upload).toHaveBeenCalledWith(7, file);
    fireEvent.change(policy, { target: { value: 'STRICT' } });
    expect(policy).toHaveValue('STRICT');
  });
});
