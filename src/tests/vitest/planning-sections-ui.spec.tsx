// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  PlanningWorkspace,
  planningViews,
} from '../../components/modules/planning/PlanningWorkspace.tsx';
import {
  sectionItems,
  consumableGroup,
  isBrandingCategory,
} from '../../components/modules/planning/planning-sections.ts';
const mocks = vi.hoisted(() => ({ get: vi.fn(), send: vi.fn(), upload: vi.fn() }));
vi.mock('../../api/clients/planning.client.ts', async (original) => ({
  ...(await original<typeof import('../../api/clients/planning.client.ts')>()),
  planningApi: mocks,
}));
const categories = [
  { id: 1, name: 'OPD CONSUMABLES', is_active: true },
  { id: 2, name: 'DENTAL CONSUABLES', is_active: true },
  { id: 3, name: 'CONSUMABLE ITEMS', is_active: true },
  { id: 4, name: 'BRANDING', is_active: true },
  { id: 5, name: 'Staff Uniforms', is_active: true },
];
const plan = {
  id: 41,
  name: 'Section test plan',
  plan_type: 'MIXED',
  financial_year: 2026,
  status: 'DRAFT',
  currency: 'KES',
  version: 1,
  inflation_bp: 500,
};
const items = Array.from({ length: 47 }, (_, i) => ({
  id: i + 1,
  category_id: i < 22 ? 1 : 4,
  category_name: i < 22 ? 'OPD CONSUMABLES' : 'BRANDING',
  description: `${i < 22 ? 'OPD' : 'Branding'} row ${i + 1}`,
  unit: 'Box',
  base_price_cents: '10000',
  adjusted_price_cents: '10500',
  inflation_bp: null,
  annual_total_cents: '126000',
  selected_total_cents: '126000',
  source_worksheet: 'CSV',
  source_row: i + 8,
  months: Array.from({ length: 12 }, (_, m) => ({
    month: `2026-${String(m + 1).padStart(2, '0')}-01`,
    quantity: '1.000',
    unit_price_cents: '10500',
    amount_cents: '10500',
  })),
}));
const uniforms = [
  {
    id: 81,
    description: 'Imported polo projection',
    category_id: 5,
    category_name: 'Staff Uniforms',
    existing_balance: '0.000',
    balance_label: 'Dec 2025',
    balance_rule: 'SUBTRACT',
    buying_cost_cents: '90000',
    staff_count: 0,
    quantity_per_staff: '0.000',
    projected_quantity: '0.000',
    purchase_quantity: '0.000',
    gross_cents: '0',
    contribution_cents: '0',
    contribution_bp: 0,
    total_cents: '0',
  },
];
const data = {
  plan,
  categories,
  items,
  uniforms,
  totalItems: 47,
  page: 1,
  filters: { categoryId: null },
  summary: {},
  facilityOverview: {},
};
function Harness({
  initial = 'planningBranding',
  manage = true,
}: {
  initial?: (typeof planningViews)[number][0];
  manage?: boolean;
}) {
  const [view, setView] = useState(initial);
  return (
    <PlanningWorkspace
      facilityId={7}
      view={view}
      onNavigate={setView}
      permissions={['accounting.planning.read', ...(manage ? ['accounting.planning.manage'] : [])]}
    />
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockImplementation(async (_facility, path, query = {}) =>
    path === '/plans'
      ? { plans: [plan], total: 1 }
      : { ...data, items: query.all ? items : items.slice(0, 20) },
  );
});
afterEach(cleanup);

describe('explicit source category grouping', () => {
  it('recognizes OPD, original misspelled dental and other consumables without changing source labels', () => {
    expect(categories.slice(0, 3).map(consumableGroup)).toEqual(['OPD', 'DENTAL', 'OTHER']);
    expect(consumableGroup({ id: 9, name: 'DENTAL CONSUMABLES' })).toBe('DENTAL');
    expect(categories[1].name).toBe('DENTAL CONSUABLES');
  });
  it('keeps same-name and description-misleading records; classification uses category metadata only', () => {
    const rows = [
      { category_id: 1, name: 'Branding needles' },
      { category_id: 4, name: 'Cotton' },
      { category_id: 4, name: 'Cotton' },
    ];
    expect(sectionItems(rows, categories, 'MIXED', 'branding')).toHaveLength(2);
    expect(sectionItems(rows, categories, 'MIXED', 'stationery')).toEqual([rows[0]]);
    expect(sectionItems(rows, categories, 'MIXED', 'stationery', 'DENTAL')).toEqual([]);
  });
  it('supports explicit category code BRANDING and dedicated BRANDING plans', () => {
    expect(isBrandingCategory({ id: 9, name: 'Custom signage', code: 'branding' }, 'MIXED')).toBe(
      true,
    );
    expect(sectionItems(items, categories, 'BRANDING', 'branding')).toHaveLength(47);
    expect(sectionItems(items, categories, 'BRANDING', 'stationery')).toHaveLength(0);
  });
});

describe('dedicated planning viewing/editing sections', () => {
  it('shows Branding directly in a mixed plan and paginates after partitioning the full scoped result', async () => {
    render(<Harness />);
    await screen.findByText(/25 matching records/);
    const table = screen.getByRole('table', { name: 'Branding table' });
    expect(within(table).getByText('Branding row 23')).toBeInTheDocument();
    expect(within(table).queryByText('OPD row 1')).not.toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(21);
    expect(mocks.get).toHaveBeenCalledWith(7, '/plans/41', expect.objectContaining({ all: true }));
    fireEvent.click(screen.getByText('Next items'));
    await screen.findByText('Branding row 47');
    expect(
      within(screen.getByRole('table', { name: 'Branding table' })).getAllByRole('row'),
    ).toHaveLength(6);
  });
  it('has distinct Stationery, Branding and Uniform navigation and clears incompatible unit/search filters', async () => {
    render(<Harness initial="planningItems" />);
    await screen.findByText(/22 matching records/);
    expect(screen.getByRole('group', { name: 'Consumable sections' })).toHaveTextContent(
      'OPD consumables (22)',
    );
    fireEvent.change(screen.getByLabelText('Search unit'), { target: { value: 'Box' } });
    fireEvent.change(await screen.findByLabelText('Search description'), {
      target: { value: 'not a uniform' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Staff Uniform Projections' }));
    const table = await screen.findByRole('table', { name: 'Staff Uniform Projections table' });
    expect(await within(table).findByText(/Imported polo projection/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Search unit')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search description')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Branding' })).toBeInTheDocument();
  });
  it('exposes independent View, Edit and Delete on draft monthly records and a true read-only detail form', async () => {
    mocks.get.mockImplementation(async (_facility, path, query = {}) =>
      path === '/plans'
        ? { plans: [plan], total: 1 }
        : path.includes('/items/')
          ? items[22]
          : { ...data, items: query.all ? items : items.slice(0, 20) },
    );
    render(<Harness />);
    const table = await screen.findByRole('table', { name: 'Branding table' });
    expect(within(table).getAllByRole('button', { name: 'Edit' })).toHaveLength(20);
    expect(within(table).getAllByRole('button', { name: 'Delete' })).toHaveLength(20);
    fireEvent.click(within(table).getAllByRole('button', { name: 'View' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('January quantity')).toBeDisabled();
    expect(within(dialog).getByLabelText('December quantity')).toBeDisabled();
    expect(within(dialog).getByText('Saved January–December calculations')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Save item' })).not.toBeInTheDocument();
  });
  it('does not expose mutation actions to a read-only user in any of the three sections', async () => {
    render(<Harness manage={false} />);
    for (const [section, tableName] of [
      ['Branding', 'Branding table'],
      ['Stationery & Consumables', 'Stationery & Consumables table'],
      ['Staff Uniform Projections', 'Staff Uniform Projections table'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: section }));
      const table = await screen.findByRole('table', { name: tableName });
      expect(within(table).getAllByRole('button', { name: 'View' }).length).toBeGreaterThan(0);
      expect(within(table).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      expect(within(table).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    }
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
