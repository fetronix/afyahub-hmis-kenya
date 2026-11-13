// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const state = vi.hoisted(() => ({
  context: {
    activeModule: 'payroll',
    setActiveModule: vi.fn(),
    currentFacility: {
      id: 7,
      name: 'Synthetic facility',
      enabledModules: ['hr', 'payroll'],
      hiddenModules: [] as string[],
    },
    isMobileMenuOpen: false,
    setIsMobileMenuOpen: vi.fn(),
    authenticatedUser: {
      id: 4,
      isSuperAdmin: false,
      roles: ['FACILITY_ADMIN'],
      permissions: ['hr.read', 'hr.manage', 'payroll.read', 'payroll.manage'],
    },
    showToast: vi.fn(),
    refreshKey: 0,
    triggerRefresh: vi.fn(),
  },
  api: {
    getHealth: vi.fn(),
    getPayrollPeriods: vi.fn(),
    getPayrollStatutoryVersions: vi.fn(),
    getPayrollAccountSettings: vi.fn(),
  },
  fetchJson: vi.fn(),
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => state.context }));
vi.mock('../../api/client.ts', () => ({
  api: state.api,
  fetchJson: state.fetchJson,
  API_BASE: '/api',
  ApiError: class extends Error {},
}));
import { Sidebar } from '../../components/Sidebar.tsx';
import { PayrollModule } from '../../components/modules/PayrollModule.tsx';
import { PayrollRunOutputs } from '../../components/modules/payroll/PayrollTools.tsx';
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.context.currentFacility = {
    id: 7,
    name: 'Synthetic facility',
    enabledModules: ['hr', 'payroll'],
    hiddenModules: [],
  };
  state.context.authenticatedUser = {
    id: 4,
    isSuperAdmin: false,
    roles: ['FACILITY_ADMIN'],
    permissions: ['hr.read', 'hr.manage', 'payroll.read', 'payroll.manage'],
  };
  state.api.getHealth.mockResolvedValue({ status: 'healthy' });
  state.api.getPayrollPeriods.mockResolvedValue([]);
  state.api.getPayrollStatutoryVersions.mockResolvedValue([]);
  state.api.getPayrollAccountSettings.mockResolvedValue(null);
  state.fetchJson.mockResolvedValue([]);
});
describe('existing payroll UI and navigation', () => {
  it('exposes HR and Payroll for a provisioned authorized facility and navigates to the existing module', async () => {
    render(<Sidebar collapsed={false} onToggleCollapse={() => {}} />);
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Human Resources' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Payroll' }));
    expect(state.context.setActiveModule).toHaveBeenCalledWith('payroll');
  });
  it('keeps payroll hidden without its module, read grant or when facility explicitly hides it', () => {
    state.context.currentFacility.enabledModules = ['hr'];
    const view = render(<Sidebar collapsed={false} onToggleCollapse={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Payroll' })).not.toBeInTheDocument();
    state.context.currentFacility.enabledModules = ['hr', 'payroll'];
    state.context.authenticatedUser.permissions = ['hr.read'];
    view.rerender(<Sidebar collapsed={false} onToggleCollapse={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Payroll' })).not.toBeInTheDocument();
    state.context.authenticatedUser.permissions.push('payroll.read');
    state.context.currentFacility.hiddenModules = ['payroll'];
    view.rerender(<Sidebar collapsed={false} onToggleCollapse={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Payroll' })).not.toBeInTheDocument();
  });
  it('does not expose facility salary navigation to a global platform account', () => {
    state.context.authenticatedUser.isSuperAdmin = true;
    render(<Sidebar collapsed={false} onToggleCollapse={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Payroll' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Human Resources' })).not.toBeInTheDocument();
  });
  it('offers staff pay and history without granting a preparer approval or posting controls', async () => {
    render(<PayrollModule />);
    await screen.findByText('No payroll periods');
    expect(screen.getByRole('tab', { name: 'Staff pay' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History & annual reports' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Post to ledger/ })).not.toBeInTheDocument();
  });
  it('exposes salary/component management only with payroll preparation authority', async () => {
    state.context.authenticatedUser.permissions = ['payroll.read'];
    state.fetchJson.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/employees/')
          ? {
              id: 3,
              firstName: 'Synthetic',
              lastName: 'Employee',
              employeeNumber: 'SYN',
              baseSalaryCents: '5000000',
              components: [],
            }
          : url.includes('/employees')
            ? [
                {
                  id: 3,
                  firstName: 'Synthetic',
                  lastName: 'Employee',
                  employeeNumber: 'SYN',
                  baseSalaryCents: '5000000',
                },
              ]
            : [],
      ),
    );
    const user = userEvent.setup();
    render(<PayrollModule />);
    await screen.findByText('No payroll periods');
    await user.click(screen.getByRole('tab', { name: 'Staff pay' }));
    await screen.findByRole('option', { name: 'SYN — Synthetic Employee' });
    await user.selectOptions(screen.getByLabelText('Salary employee'), '3');
    await screen.findByText('Current basic salary: KES 50000.00');
    expect(screen.queryByRole('button', { name: 'Save basic salary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add pay component' })).not.toBeInTheDocument();
  });
  it('refuses to fabricate empty results after a payroll load error', async () => {
    state.api.getPayrollPeriods.mockRejectedValueOnce(new Error('Synthetic failure'));
    render(<PayrollModule />);
    await screen.findByText('Payroll records could not be loaded.');
    expect(screen.queryByText('No payroll periods')).not.toBeInTheDocument();
  });
  it('does not request payroll records without payroll read authority', async () => {
    state.context.authenticatedUser.permissions = ['hr.read'];
    render(<PayrollModule />);
    await screen.findByText('Facility payroll read permission is required.');
    expect(state.api.getPayrollPeriods).not.toHaveBeenCalled();
  });
  it('gates schedules on finalization and labels generated output as unfiled/unpaid, not a payment', async () => {
    const view = render(
      <PayrollRunOutputs facilityId={7} runId={8} status="APPROVED" renderPayslip={() => null} />,
    );
    expect(screen.queryByRole('button', { name: /Generate finalized/ })).not.toBeInTheDocument();
    state.fetchJson.mockResolvedValue({
      run: { id: 8, periodName: 'Synthetic period' },
      notice: 'Internal schedules only',
      payslips: [],
      bankSchedule: [
        {
          employeeNumber: 'SYN',
          employeeName: 'Synthetic Employee',
          netCents: '10000',
          bankName: null,
          bankAccountMasked: null,
          paymentStatus: 'NOT_EVIDENCED',
        },
      ],
      remittances: [
        { statute: 'SHIF', employeeCents: '100', employerCents: '0', totalCents: '100' },
      ],
      statutoryRows: [],
    });
    view.rerender(
      <PayrollRunOutputs facilityId={7} runId={8} status="POSTED" renderPayslip={() => null} />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /Generate finalized/ }));
    await waitFor(() =>
      expect(screen.getByText(/NOT FILED · PAYMENT NOT EVIDENCED/)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'View bulk payslips' })).toBeInTheDocument();
  });
  it('preserves an inactive mapped account visibly and prevents saving an invalid purpose mapping', async () => {
    state.api.getPayrollAccountSettings.mockResolvedValue({
      id: 1,
      salaryExpenseAccountId: 1,
      employerCostAccountId: 1,
      netPayPayableAccountId: 2,
      payePayableAccountId: 2,
      nssfPayableAccountId: 2,
      shifPayableAccountId: 2,
      ahlPayableAccountId: 2,
      otherDeductionsPayableAccountId: null,
    });
    state.fetchJson.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/payroll/accounts?')
          ? [
              {
                id: 1,
                accountCode: 'FAC-EXP',
                accountName: 'Approved facility expense',
                accountType: 'EXPENSE',
                normalBalance: 'DEBIT',
                isActive: true,
              },
              {
                id: 2,
                accountCode: 'FAC-NET',
                accountName: 'Inactive facility liability',
                accountType: 'LIABILITY',
                normalBalance: 'CREDIT',
                isActive: false,
              },
            ]
          : [],
      ),
    );
    render(<PayrollModule />);
    await screen.findByText('No payroll periods');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Ledger accounts' }));
    const net = screen.getByRole('combobox', { name: /Net salary payable/ });
    expect(net).toHaveValue('2');
    expect(
      screen
        .getAllByRole('option', { name: /FAC-NET.*INACTIVE/ })
        .every((option) => (option as HTMLOptionElement).disabled),
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Save mapping' })).toBeDisabled();
    expect(screen.queryByText(/This facility has no active chart/)).not.toBeInTheDocument();
  });
});
