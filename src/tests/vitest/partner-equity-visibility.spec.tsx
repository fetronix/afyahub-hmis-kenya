// @vitest-environment jsdom
import React from 'react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
const fixture = vi.hoisted(() => ({
  currentFacility: {
    id: 7,
    name: 'Visibility test facility',
    enabledModules: ['accounting'],
    hiddenModules: [],
  },
  authenticatedUser: {
    id: 1,
    isSuperAdmin: false,
    roles: ['FINANCE_READER'],
    permissions: ['accounting.read'],
  },
  showToast: vi.fn(),
  setActiveModule: vi.fn(),
}));
const equity = vi.hoisted(() => ({ get: vi.fn(), send: vi.fn(), download: vi.fn() }));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => fixture }));
vi.mock('../../api/client.ts', () => ({ getSessionToken: () => null }));
vi.mock('../../api/clients/equity.client.ts', () => ({ equityApi: equity }));
vi.mock('../../api/client-sprint.client.ts', () => ({
  sprintApi: {
    accountingOverview: async () => ({
      accounts: [],
      periods: [],
      journals: [],
      trialBalance: { balanced: true, debitKes: '0', creditKes: '0' },
      profitAndLoss: { postedRevenueKes: '0', postedExpensesKes: '0' },
      balanceSheet: { asOf: '2026-10-27' },
      limitations: { notice: 'Test overview' },
    }),
  },
}));
import { AccountingModule } from '../../components/modules/AccountingModule.tsx';
beforeEach(() => {
  vi.clearAllMocks();
  history.replaceState(null, '', '/');
  fixture.authenticatedUser.permissions = ['accounting.read'];
  fixture.authenticatedUser.isSuperAdmin = false;
  equity.get.mockImplementation(async (path: string) =>
    path === '/partners' ? { version: 0, partners: [] } : [],
  );
});
afterEach(cleanup);
it('explains a missing equity entitlement without mounting the workspace or requesting financial data', () => {
  render(<AccountingModule />);
  fireEvent.click(screen.getByRole('button', { name: 'Financial Reports' }));
  expect(
    screen.getByRole('region', { name: 'Partners’ Equity Statement access' }),
  ).toHaveTextContent('accounting.equity.read');
  expect(
    screen.getByRole('region', { name: 'Partners’ Equity Statement access' }),
  ).toHaveTextContent('no access has been granted automatically');
  expect(screen.queryByRole('button', { name: 'Partners’ Equity Statement' })).toBeNull();
  expect(equity.get).not.toHaveBeenCalled();
  expect(equity.send).not.toHaveBeenCalled();
});
it('keeps the diagnostic in Financial Reports rather than every accounting view', () => {
  render(<AccountingModule />);
  expect(screen.queryByRole('region', { name: 'Partners’ Equity Statement access' })).toBeNull();
});
it('retains the authorized real workspace dispatch with read-only access', async () => {
  fixture.authenticatedUser.permissions.push('accounting.equity.read');
  render(<AccountingModule />);
  fireEvent.click(screen.getByRole('button', { name: 'Financial Reports' }));
  expect(screen.queryByRole('region', { name: 'Partners’ Equity Statement access' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Partners’ Equity Statement' }));
  expect(
    screen.getByRole('heading', { name: 'Statement of Changes in Partners’ Equity' }),
  ).toBeInTheDocument();
  await waitFor(() => expect(equity.get).toHaveBeenCalledWith('/statements?year=2026'));
  expect(screen.queryByRole('button', { name: 'Create statement / period' })).toBeNull();
});
it('does not turn the access diagnostic into a super-admin facility-data bypass', () => {
  fixture.authenticatedUser.isSuperAdmin = true;
  render(<AccountingModule />);
  expect(
    screen.getByText(/Accounting requires an authorized facility account/),
  ).toBeInTheDocument();
  expect(equity.get).not.toHaveBeenCalled();
});
