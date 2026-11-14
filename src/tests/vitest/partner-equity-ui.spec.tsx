// @vitest-environment jsdom
import React from 'react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { PartnerEquityWorkspace } from '../../components/modules/accounting/PartnerEquityWorkspace.tsx';
import { baselineEquity, baselinePartners } from '../../partner-equity/model.ts';
const api = vi.hoisted(() => ({ get: vi.fn(), send: vi.fn(), download: vi.fn() }));
vi.mock('../../api/clients/equity.client.ts', () => ({ equityApi: api }));
const hmis = vi.hoisted(() => ({
  currentFacility: {
    id: 7,
    name: 'Synthetic facility',
    enabledModules: ['accounting'],
    hiddenModules: [],
  },
  authenticatedUser: {
    id: 1,
    isSuperAdmin: false,
    roles: ['FACILITY_ADMIN'],
    permissions: [] as string[],
  },
  showToast: vi.fn(),
  setActiveModule: vi.fn(),
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => hmis }));
vi.mock('../../api/client.ts', () => ({ getSessionToken: () => null }));
vi.mock('../../api/client-sprint.client.ts', () => ({
  sprintApi: {
    accountingOverview: async () => ({
      accounts: [],
      periods: [],
      journals: [],
      trialBalance: { balanced: true, debitKes: '0', creditKes: '0' },
      profitAndLoss: { postedRevenueKes: '0', postedExpensesKes: '0' },
      balanceSheet: { asOf: '2026-10-27' },
      limitations: { notice: 'Synthetic' },
    }),
  },
}));
import { AccountingModule } from '../../components/modules/AccountingModule.tsx';
let current: any;
const perms = ['read', 'manage', 'partners', 'review', 'approve', 'audit', 'export'].map(
  (p) => 'accounting.equity.' + p,
);
const show = (permissions = perms) =>
  render(
    <PartnerEquityWorkspace
      facilityId={7}
      facilityName="Synthetic facility"
      permissions={permissions}
    />,
  );
beforeEach(() => {
  vi.clearAllMocks();
  current = {
    id: 41,
    version: 2,
    revision: 1,
    model: baselineEquity(),
    financial_year: 2026,
    period_kind: 'ANNUAL',
    period_name: 'Original annual period',
    start_date: '2025-07-01',
    end_date: '2026-06-30',
    status: 'DRAFT',
    prepared_by: 1,
    prepared_name: 'Synthetic preparer',
    prepared_at: '2026-10-27',
    review_acceptance: null,
  };
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/statements?')) return path.includes('2027') ? [] : [current];
    if (path === '/partners') return { version: 0, partners: baselinePartners() };
    if (path === '/statements/41/audit') return [{ action: 'EDIT_STATEMENT', actor_id: 1 }];
    if (path.includes('/carry-preview'))
      return {
        source: { ...current, id: 10, status: 'APPROVED' },
        target: current,
        opening: [{ partner: baselinePartners()[0], amount: '1016394.15' }],
        total: '2604695.52',
        displayRoundingCents: '-1',
      };
    return current;
  });
  api.send.mockImplementation(async (_path: string, body: any) => {
    current = { ...current, version: current.version + 1, model: body.model ?? current.model };
    return current;
  });
  api.download.mockResolvedValue(undefined);
});
afterEach(cleanup);
const loaded = () => screen.findByLabelText('Lucy Wanjiku opening');
const reason = () =>
  fireEvent.change(screen.getByLabelText('Equity audit reason'), {
    target: { value: 'Reviewed synthetic draft input changes' },
  });
it('retrieves the saved period without writes; preserves all original names/rows and six KPIs', async () => {
  show();
  await loaded();
  const table = screen.getByRole('table', { name: 'Partner equity statement' });
  expect(within(table).getAllByRole('columnheader')).toHaveLength(7);
  expect(table.querySelectorAll('tbody tr')).toHaveLength(14);
  expect(screen.getAllByRole('article')).toHaveLength(6);
  expect(screen.getByLabelText('Statement net result')).toHaveValue('-2353704.47');
  expect(screen.getByText(/displayed closing values minus total: -1 cents/)).toBeInTheDocument();
  expect(api.send).not.toHaveBeenCalled();
});
it('recalculates all chart/table values immediately and saves to the existing statement revision only on explicit save', async () => {
  show();
  await loaded();
  fireEvent.change(screen.getByLabelText('Statement net result'), { target: { value: '100.00' } });
  expect(screen.getAllByText('KES 4,958,499.99').length).toBeGreaterThan(0);
  expect(
    screen.getByRole('img', { name: 'Partner profit/loss allocation' }).querySelector('title')
      ?.textContent,
  ).toContain('38.52');
  expect(api.send).not.toHaveBeenCalled();
  reason();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft inputs' }));
  await waitFor(() =>
    expect(api.send).toHaveBeenCalledWith(
      '/statements/41',
      expect.objectContaining({
        version: 2,
        model: expect.objectContaining({ netResult: '100.00' }),
      }),
      'PUT',
    ),
  );
});
it('edits all permitted input rows, preserves null dashes and supports negative typing without executing formulas', async () => {
  show();
  await loaded();
  for (const key of [
    'opening',
    'capital',
    'interest',
    'salary',
    'drawings',
    'tax',
    'revaluation',
    'adjustments',
  ])
    fireEvent.change(screen.getByLabelText('Lucy Wanjiku ' + key), { target: { value: '-10.00' } });
  expect(screen.getByLabelText('Lucy Wanjiku drawings')).toHaveValue('-10.00');
  fireEvent.change(screen.getByLabelText('Lucy Wanjiku tax'), { target: { value: '=BAD()' } });
  expect(screen.getByLabelText('Lucy Wanjiku tax')).toHaveAttribute('aria-invalid', 'true');
  reason();
  expect(screen.getByRole('button', { name: 'Save draft inputs' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Lucy Wanjiku tax'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'Save draft inputs' })).not.toBeDisabled();
});
it('shows/hides five charts and presents the unchanged statement without editing controls', async () => {
  show();
  await loaded();
  expect(screen.getAllByRole('img')).toHaveLength(5);
  fireEvent.click(screen.getByLabelText('Show charts'));
  expect(screen.queryByRole('img')).toBeNull();
  fireEvent.click(screen.getByLabelText('Show charts'));
  fireEvent.click(screen.getByRole('button', { name: 'Executive presentation' }));
  expect(screen.queryByLabelText('Lucy Wanjiku opening')).toBeNull();
  expect(screen.getByRole('table', { name: 'Partner equity statement' })).toBeInTheDocument();
  expect(screen.getAllByRole('img')).toHaveLength(5);
});
it('keeps read-only, export and approved-statement restrictions', async () => {
  current.status = 'APPROVED';
  show(['accounting.equity.read']);
  await screen.findByText(/Version 2/);
  expect(screen.queryByLabelText('Lucy Wanjiku opening')).toBeNull();
  expect(screen.queryByRole('button', { name: 'CSV export' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Partner register' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create controlled revision' })).toBeNull();
});
it('does not request or expose statement data without equity-read permission', () => {
  show(['accounting.read']);
  expect(screen.getByRole('alert')).toHaveTextContent('accounting.equity.read');
  expect(api.get).not.toHaveBeenCalled();
});
it('exports all three saved formats and disables exports for unsaved edits', async () => {
  show();
  await loaded();
  for (const format of ['CSV', 'XLSX', 'PDF']) {
    fireEvent.click(screen.getByRole('button', { name: format + ' export' }));
    await waitFor(() => expect(api.download).toHaveBeenCalledWith(41, format.toLowerCase()));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: format + ' export' })).not.toBeDisabled(),
    );
  }
  fireEvent.change(screen.getByLabelText('Lucy Wanjiku capital'), { target: { value: '1.00' } });
  expect(screen.getByRole('button', { name: 'CSV export' })).toBeDisabled();
});
it('requires explicit partner saving and never exposes permanent deletion', async () => {
  show();
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Partner register' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add partner' }));
  const name = screen.getByLabelText(/Partner name partner-/);
  fireEvent.change(name, { target: { value: 'Synthetic new partner' } });
  const form = name.closest('form')!;
  reason();
  fireEvent.submit(form);
  await waitFor(() =>
    expect(api.send).toHaveBeenCalledWith(
      '/partners',
      expect.objectContaining({
        version: 0,
        partner: expect.objectContaining({ name: 'Synthetic new partner', original: false }),
      }),
      'PUT',
    ),
  );
  expect(screen.queryByRole('button', { name: /delete partner/i })).toBeNull();
});
it('loads year-specific lists without writing or merging statement data', async () => {
  show();
  await loaded();
  fireEvent.change(screen.getByLabelText('Statement financial year'), {
    target: { value: '2027' },
  });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/statements?year=2027'));
  expect(screen.queryByRole('table', { name: 'Partner equity statement' })).toBeNull();
  expect(api.send).not.toHaveBeenCalled();
});
it('previews carry-forward and requires confirmation before any write', async () => {
  show();
  await loaded();
  fireEvent.change(screen.getByLabelText('Carry source statement ID'), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview opening balances' }));
  await screen.findByText(/Source #10/);
  expect(api.send).not.toHaveBeenCalled();
  reason();
  const confirm = screen.getByRole('button', { name: 'Confirm opening-balance carry-forward' });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Type CARRY REVIEWED OPENING BALANCES'), {
    target: { value: 'CARRY REVIEWED OPENING BALANCES' },
  });
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(api.send).toHaveBeenCalledWith(
      '/statements/41/carry',
      expect.objectContaining({ sourceId: 10, roundingCents: '-1', sourceVersion: 2 }),
    ),
  );
});
it('fails closed on a stale save without claiming changes were saved', async () => {
  show();
  await loaded();
  api.send.mockRejectedValue(new Error('VERSION_CONFLICT'));
  fireEvent.change(screen.getByLabelText('Lucy Wanjiku opening'), { target: { value: '1.00' } });
  reason();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft inputs' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No successful receipt');
  expect(screen.getByRole('button', { name: 'Save draft inputs' })).toBeDisabled();
});

it('opens the separate statement module from Financial Reports only for authorized equity readers', async () => {
  hmis.authenticatedUser.permissions = ['accounting.read', ...perms];
  const view = render(<AccountingModule />);
  fireEvent.click(screen.getByRole('button', { name: 'Financial Reports' }));
  fireEvent.click(screen.getByRole('button', { name: 'Partners’ Equity Statement' }));
  await loaded();
  expect(
    screen.getByRole('heading', { name: 'Statement of Changes in Partners’ Equity' }),
  ).toBeInTheDocument();
  view.unmount();
  hmis.authenticatedUser.permissions = ['accounting.read'];
  render(<AccountingModule />);
  fireEvent.click(screen.getByRole('button', { name: 'Financial Reports' }));
  expect(screen.queryByRole('button', { name: 'Partners’ Equity Statement' })).toBeNull();
});
