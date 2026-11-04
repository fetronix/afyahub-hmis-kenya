// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REPORT_CATEGORIES } from '../../reporting/report-catalogue.ts';
import {
  REPORT_ENGINES,
  type ReportFilters,
  type ReportResult,
} from '../../reporting/report-centre.types.ts';

const mocks = vi.hoisted(() => ({
  context: {} as any,
  generate: vi.fn(),
  exportReport: vi.fn(),
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/report-centre.client.ts', () => ({
  reportCentreApi: { generate: mocks.generate, export: mocks.exportReport },
}));
vi.mock('../../components/modules/ReportsModule.tsx', () => ({
  ReportsModule: () => <div>Legacy overview content</div>,
}));
vi.mock('../../components/modules/FinalizedInvoicePanel.tsx', () => ({
  FinalizedInvoicePanel: (props: any) => (
    <div>
      Finalized invoice {props.invoiceId} {props.reportCentre ? 'report-only' : ''}
    </div>
  ),
}));
import { ReportCentre } from '../../components/modules/report-centre/ReportCentre.tsx';

const permissions = [
  'reports.read',
  'reports.export',
  'inventory.read',
  'procurement.read',
  'inpatient.read',
  'patients.read',
  'billing.read',
  'clinical.read',
];
const modules = ['analytics', 'inventory', 'procurement', 'inpatient', 'finance'];
function result(
  id: keyof typeof REPORT_ENGINES,
  filters: ReportFilters,
  rows = [
    {
      code: 'SYN-1',
      item: 'Synthetic Item',
      category: 'Supplies',
      store: 'Main',
      unit: 'Pieces',
      quantity: 7,
      reorderLevel: null,
      status: 'Active',
    },
  ],
  total = rows.length,
): ReportResult {
  return {
    reportId: id,
    title: REPORT_ENGINES[id].title,
    facilityId: filters.facilityId,
    facilityName: 'Synthetic Facility A',
    currency: 'KES',
    generatedAt: '2026-11-04T08:00:00.000Z',
    filters: { ...filters, offset: filters.offset ?? 0, limit: filters.limit ?? 25 },
    columns: REPORT_ENGINES[id].columns,
    rows,
    total,
    offset: filters.offset ?? 0,
    limit: filters.limit ?? 25,
    notes: [...REPORT_ENGINES[id].notes],
  };
}
function setup() {
  mocks.context = {
    authenticatedUser: {
      id: 1,
      isSuperAdmin: false,
      roles: ['FACILITY_ADMIN'],
      permissions: [...permissions],
    },
    currentFacility: {
      id: 10,
      name: 'Synthetic Facility A',
      enabledModules: [...modules],
      hiddenModules: [],
    },
  };
  mocks.generate.mockReset();
  mocks.exportReport.mockReset();
  mocks.generate.mockImplementation(async (id, filters) => result(id, filters));
  mocks.exportReport.mockResolvedValue({
    filename: 'synthetic.xlsx',
    contentType: 'application/octet-stream',
    base64: btoa('synthetic'),
  });
}
function openInventory() {
  fireEvent.click(screen.getByRole('button', { name: /STOCK \/ GOODS/i }));
  fireEvent.click(screen.getByRole('button', { name: /Inventory by category/i }));
}

describe('Reporting Centre navigation and report workbench', () => {
  beforeEach(setup);

  it('shows exactly seven categories in the requested order and expands nested departments', () => {
    render(<ReportCentre />);
    const ids = REPORT_CATEGORIES.map((category) => category.id);
    expect(screen.getByRole('heading', { name: 'Reporting Centre' })).toBeInTheDocument();
    const categoryElements = screen.getAllByTestId(/^report-category-/);
    expect(
      categoryElements.map((element) =>
        element.getAttribute('data-testid')?.replace('report-category-', ''),
      ),
    ).toEqual(ids);
    expect(REPORT_CATEGORIES.map((category) => category.name)).toEqual([
      'PRINTABLES',
      'FINANCIAL',
      'STOCK / GOODS',
      'DEPARTMENTAL',
      'RECORDS',
      'HR',
      'ACTIVITY',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /DEPARTMENTAL/ }));
    const inpatient = screen.getByRole('button', { name: 'INPATIENT' });
    expect(inpatient).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(inpatient);
    expect(inpatient).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Current inpatient list/ })).toBeInTheDocument();
    fireEvent.click(inpatient);
    expect(
      screen.queryByRole('button', { name: /Current inpatient list/ }),
    ).not.toBeInTheDocument();
  });

  it('searches report names and groups, provides useful empty states and never presents an unavailable report as generated', () => {
    render(<ReportCentre />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), {
      target: { value: 'payslip' },
    });
    expect(screen.getByText('2 matching entries')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Individual payslips/i }));
    const pane = screen.getByRole('main', { name: 'Selected report' });
    expect(within(pane).getByText('Unavailable')).toBeInTheDocument();
    expect(within(pane).getByText(/cannot generate a report yet/i)).toBeInTheDocument();
    expect(within(pane).queryByRole('button', { name: 'Generate report' })).not.toBeInTheDocument();
    expect(mocks.generate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), {
      target: { value: 'no-matching-synthetic-name' },
    });
    expect(screen.getByText(/No reports match/)).toBeInTheDocument();
    expect(screen.getAllByTestId(/^report-category-/)).toHaveLength(7);
  });

  it('generates scoped data, paginates, audits print separately and downloads the server export', async () => {
    mocks.generate.mockImplementation(async (id, filters) =>
      result(
        id,
        filters,
        [
          {
            code: `PAGE-${filters.offset ?? 0}`,
            item: 'Synthetic Item',
            category: 'Supplies',
            store: 'Main',
            unit: 'Pieces',
            quantity: 7,
            reorderLevel: null,
            status: 'Active',
          },
        ],
        30,
      ),
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const create = vi.fn(() => 'blob:synthetic');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<ReportCentre />);
    openInventory();
    fireEvent.change(screen.getByLabelText('Search item, code, category or location'), {
      target: { value: 'Synthetic' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(await screen.findByText('PAGE-0')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Not recorded')).toBeInTheDocument();
    expect(mocks.generate).toHaveBeenCalledWith(
      'inventory-category',
      expect.objectContaining({ facilityId: 10, search: 'Synthetic', offset: 0, limit: 25 }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText('PAGE-25')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Print page/ }));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(mocks.generate).toHaveBeenLastCalledWith(
      'inventory-category',
      expect.objectContaining({ facilityId: 10, offset: 25 }),
      'print',
    );
    expect(document.body.classList.contains('print-report-centre')).toBe(true);
    fireEvent(window, new Event('afterprint'));
    expect(document.body.classList.contains('print-report-centre')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() =>
      expect(mocks.exportReport).toHaveBeenCalledWith(
        'inventory-category',
        expect.objectContaining({ facilityId: 10, offset: 25 }),
        'xlsx',
      ),
    );
    expect(create).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    print.mockRestore();
    click.mockRestore();
  });

  it('applies purchase date and status filters and shows an honest empty result', async () => {
    mocks.generate.mockImplementation(async (id, filters) => result(id, filters, [], 0));
    render(<ReportCentre />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), {
      target: { value: 'LPO summaries' },
    });
    fireEvent.click(screen.getByRole('button', { name: /LPO summaries/i }));
    fireEvent.change(screen.getByLabelText('Expected delivery date from'), {
      target: { value: '2026-04-01' },
    });
    fireEvent.change(screen.getByLabelText('Expected delivery date to'), {
      target: { value: '2026-04-30' },
    });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Approved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(await screen.findByText('No records match the selected filters.')).toBeInTheDocument();
    expect(mocks.generate).toHaveBeenCalledWith(
      'purchase-orders',
      expect.objectContaining({
        from: '2026-04-01',
        to: '2026-04-30',
        status: 'Approved',
        facilityId: 10,
      }),
    );
  });

  it('disables source-restricted reports and export controls, and blocks platform accounts', async () => {
    mocks.context.authenticatedUser.permissions = ['reports.read', 'inventory.read'];
    render(<ReportCentre />);
    openInventory();
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(await screen.findByText('Synthetic Item')).toBeInTheDocument();
    expect(screen.getByText(/Export and print require/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excel' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), {
      target: { value: 'current inpatient list' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Current inpatient list/i })[0]);
    expect(
      within(screen.getByRole('main', { name: 'Selected report' })).getByText(
        'Permission required',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate report' })).not.toBeInTheDocument();
  });

  it('blocks platform accounts and hidden source modules', () => {
    mocks.context.authenticatedUser.isSuperAdmin = true;
    const view = render(<ReportCentre />);
    expect(screen.getByText(/signed-in facility account/)).toBeInTheDocument();
    mocks.context.authenticatedUser.isSuperAdmin = false;
    mocks.context.currentFacility.hiddenModules = ['inventory'];
    view.rerender(<ReportCentre />);
    openInventory();
    expect(
      within(screen.getByRole('main', { name: 'Selected report' })).getByText('Module unavailable'),
    ).toBeInTheDocument();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('drops a pending response when the selected facility changes', async () => {
    let resolve: (value: ReportResult) => void = () => {};
    mocks.generate.mockImplementation(
      () =>
        new Promise<ReportResult>((done) => {
          resolve = done;
        }),
    );
    const view = render(<ReportCentre />);
    openInventory();
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    mocks.context.currentFacility = {
      id: 11,
      name: 'Synthetic Facility B',
      enabledModules: [...modules],
      hiddenModules: [],
    };
    view.rerender(<ReportCentre />);
    await act(async () => resolve(result('inventory-category', { facilityId: 10 })));
    expect(screen.getByText(/Synthetic Facility B/)).toBeInTheDocument();
    expect(screen.queryByText('Synthetic Item')).not.toBeInTheDocument();
  });

  it('reuses the scoped finalized-invoice panel and labels the legacy overview as unreconciled', () => {
    render(<ReportCentre />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), {
      target: { value: 'Invoices' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Invoices/ }));
    fireEvent.change(screen.getByLabelText('Invoice ID'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice' }));
    expect(screen.getByText('Finalized invoice 123 report-only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Existing analytics overview' }));
    expect(screen.getByText(/Unreconciled legacy analytics/)).toBeInTheDocument();
    expect(screen.getByText('Legacy overview content')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to report catalogue' }));
    expect(screen.getByRole('searchbox', { name: 'Search reports' })).toBeInTheDocument();
  });
});
