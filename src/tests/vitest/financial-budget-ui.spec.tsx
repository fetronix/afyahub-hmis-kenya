// @vitest-environment jsdom
import React, { useState } from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import {
  FinancialBudgetGrid,
  AnnualFinancialBudget,
} from '../../components/modules/planning/AnnualFinancialBudget.tsx';
import {
  createFinancialBaseline,
  type FinancialBudget,
} from '../../budget-planning/financial-budget.model.ts';
const api = vi.hoisted(() => ({ get: vi.fn(), send: vi.fn(), financialBudgetFile: vi.fn() }));
vi.mock('../../api/clients/planning.client.ts', async (original) => ({
  ...(await original<typeof import('../../api/clients/planning.client.ts')>()),
  planningApi: api,
}));
const changed = vi.fn(),
  reset = vi.fn(),
  exported = vi.fn();
function Harness({
  editable = true,
  initial = createFinancialBaseline(),
}: {
  editable?: boolean;
  initial?: FinancialBudget;
}) {
  const [model, setModel] = useState(initial);
  return (
    <FinancialBudgetGrid
      model={model}
      editable={editable}
      canExport
      onChange={async (next) => {
        changed(next);
        setModel(next);
        return true;
      }}
      onReset={async (confirmation) => {
        reset(confirmation);
        setModel(createFinancialBaseline());
        return true;
      }}
      onExport={async (format, audit) => {
        exported(format, audit);
      }}
    />
  );
}
const clickMonth = () => fireEvent.click(screen.getByLabelText('INC-01 Jan 2026: KES 18,200.00'));
describe('Excel-like annual financial budget', () => {
  beforeEach(() => {
    changed.mockReset();
    reset.mockReset();
    exported.mockReset();
    api.get.mockReset();
    api.send.mockReset();
    api.financialBudgetFile.mockReset();
  });
  afterEach(cleanup);
  it('renders 16 columns, all required groups, five live KPIs and OGD', () => {
    render(<Harness />);
    const head = screen.getByRole('table').querySelector('thead')!;
    expect(within(head).getAllByRole('columnheader')).toHaveLength(16);
    expect(within(head).getByText('Dec 2026')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(5);
    expect(screen.getByText('OGD Colonoscopy')).toBeInTheDocument();
    expect(screen.getByText('Sub-Total Depreciation & Amortization')).toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
  });
  it('saves Enter once, recalculates chained cells immediately, and restores a manual override', async () => {
    render(<Harness />);
    clickMonth();
    const input = screen.getByLabelText('INC-01 Jan 2026');
    fireEvent.change(input, { target: { value: '20000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    await screen.findByLabelText('INC-01 Feb 2026: KES 30,000.00');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(
      screen.getByLabelText('INC-01 Jan 2026: KES 20,000.00 (manual override)'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Restore baseline INC-01 Jan 2026'));
    await screen.findByLabelText('INC-01 Jan 2026: KES 18,200.00');
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it('saves on blur, supports Escape cancellation and rejects invalid numeric input', async () => {
    render(<Harness />);
    clickMonth();
    let input = screen.getByLabelText('INC-01 Jan 2026');
    fireEvent.change(input, { target: { value: '1,000' } });
    fireEvent.blur(input);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'without currency symbols or commas',
    );
    expect(changed).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    clickMonth();
    input = screen.getByLabelText('INC-01 Jan 2026');
    fireEvent.change(input, { target: { value: '21000' } });
    fireEvent.blur(input);
    await screen.findByLabelText('INC-01 Jan 2026: KES 21,000.00 (manual override)');
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it('toggles formula audit, exports the selected view and collapses departments without changing totals', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Calculated Values View'));
    expect(screen.getAllByText('=PREV+18200').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    expect(exported).toHaveBeenCalledWith('csv', true);
    fireEvent.click(screen.getByRole('button', { name: /^Medical Consultation/ }));
    expect(screen.queryByLabelText('INC-01 Jan 2026: KES 18,200.00')).not.toBeInTheDocument();
    expect(screen.getByText('GRAND TOTAL PROJECTED INCOME')).toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
  });
  it('creates a formula-driven custom line with an auditable source reference', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add line item' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Line item name'), {
      target: { value: 'Custom service fee' },
    });
    fireEvent.change(within(dialog).getByLabelText('Input type'), {
      target: { value: 'Formula-Driven' },
    });
    fireEvent.change(within(dialog).getByLabelText('Formula'), {
      target: { value: '=[INC-01]*0.10' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save budget line' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Custom service fee')).toBeInTheDocument();
    expect(screen.getByLabelText('INC-X001 Feb 2026: KES 2,730.00')).toBeInTheDocument();
  });
  it('edits custom row metadata without losing monthly values or overrides', async () => {
    const initial = createFinancialBaseline();
    initial.rows.push({
      code: 'INC-X001',
      name: 'Old custom name',
      departmentId: 'consult',
      rule: 'Manual',
      cells: Array(12).fill('10'),
      overrides: { '0': '25' },
      custom: true,
    });
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByLabelText('Edit INC-X001'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Line item name'), {
      target: { value: 'Updated custom name' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save budget line' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Updated custom name')).toBeInTheDocument();
    expect(
      screen.getByLabelText('INC-X001 Jan 2026: KES 25.00 (manual override)'),
    ).toBeInTheDocument();
  });
  it('creates a department and permits deletion only for custom rows with explicit confirmation', async () => {
    const m = createFinancialBaseline();
    m.rows.push({
      code: 'INC-X001',
      name: 'Custom fee',
      departmentId: 'consult',
      rule: 'Manual',
      cells: Array(12).fill('10'),
      overrides: {},
      custom: true,
    });
    render(<Harness initial={m} />);
    expect(screen.queryByLabelText('Delete INC-01')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add department' }));
    let dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Department name'), {
      target: { value: 'New clinic department' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save department' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^New clinic department/ })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Delete INC-X001'));
    dialog = screen.getByRole('dialog');
    expect(screen.getByText('Custom fee')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete custom line' }));
    await waitFor(() => expect(screen.queryByText('Custom fee')).not.toBeInTheDocument());
  });
  it('requires the exact phrase for baseline reset and never resets on opening the dialog', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset baseline' }));
    expect(reset).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Confirm baseline reset' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type RESET FINANCIAL BASELINE'), {
      target: { value: 'RESET FINANCIAL BASELINE' },
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(reset).toHaveBeenCalledWith('RESET FINANCIAL BASELINE'));
  });
  it('toggles optional Apr–Dec professional dialysis fees and shows negative results in red', async () => {
    const m = createFinancialBaseline();
    m.rows.find((r) => r.name === 'Rent Expense')!.overrides['0'] = '1000000';
    render(<Harness initial={m} />);
    const checkbox = screen.getByLabelText('70% dialysis fees Apr–Dec');
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(changed.mock.calls[0][0].dialysisFeesAprDec).toBe(true);
    const netRow = screen
      .getAllByText('Net Profit / (Loss)')
      .find((node) => node.tagName === 'TH')!
      .closest('tr')!;
    expect(netRow.querySelector('td')?.className).toContain('text-red-300');
  });
  it('does not allow mutation on read-only budgets', () => {
    render(<Harness editable={false} />);
    expect(screen.getByRole('button', { name: 'Add line item' })).toBeDisabled();
    expect(screen.getByLabelText('INC-01 Jan 2026: KES 18,200.00')).toBeDisabled();
    expect(screen.getByLabelText('70% dialysis fees Apr–Dec')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset baseline' })).toBeDisabled();
  });
  it('loads a preview without writes and persists only after explicit baseline adoption', async () => {
    const plan = {
      id: 5,
      name: 'Synthetic 2026 plan',
      version: 1,
      status: 'DRAFT',
      financial_year: 2026,
      currency: 'KES',
    };
    api.get.mockResolvedValue({
      plan,
      facility: { id: 7, name: 'Synthetic facility' },
      model: null,
    });
    api.send.mockResolvedValue({ plan: { ...plan, version: 2 }, model: createFinancialBaseline() });
    const saved = vi.fn();
    render(<AnnualFinancialBudget facilityId={7} planId={5} canManage canExport onSaved={saved} />);
    const adopt = await screen.findByRole('button', { name: 'Use baseline in this draft' });
    expect(api.send).not.toHaveBeenCalled();
    fireEvent.click(adopt);
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(api.send).toHaveBeenCalledWith(
      7,
      '/plans/5/financial-budget',
      expect.objectContaining({ version: 1 }),
      'PUT',
    );
  });
  it('fails closed on persistence conflict without claiming local edits were saved', async () => {
    const plan = {
      id: 5,
      name: 'Synthetic 2026 plan',
      version: 1,
      status: 'DRAFT',
      financial_year: 2026,
      currency: 'KES',
    };
    api.get.mockResolvedValue({
      plan,
      facility: { id: 7, name: 'Synthetic facility' },
      model: createFinancialBaseline(),
    });
    api.send.mockRejectedValue(new Error('VERSION_CONFLICT'));
    render(
      <AnnualFinancialBudget facilityId={7} planId={5} canManage canExport onSaved={() => {}} />,
    );
    await screen.findByText('Synthetic facility — 2026 Annual Budget');
    clickMonth();
    fireEvent.change(screen.getByLabelText('INC-01 Jan 2026'), { target: { value: '10' } });
    fireEvent.keyDown(screen.getByLabelText('INC-01 Jan 2026'), { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('not a confirmed receipt');
    expect(screen.getByRole('button', { name: 'Add line item' })).toBeDisabled();
  });
});
