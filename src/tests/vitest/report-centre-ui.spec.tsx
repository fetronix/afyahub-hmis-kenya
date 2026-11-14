// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REPORT_CATEGORIES } from '../../reporting/report-catalogue.ts';
import {
  REPORT_ENGINES,
  type ReportFilters,
  type ReportResult,
  type ReportRow,
} from '../../reporting/report-centre.types.ts';

const mocks = vi.hoisted(() => ({
  context: {} as any,
  generate: vi.fn(),
  exportReport: vi.fn(),
  options: vi.fn(),
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/report-centre.client.ts', () => ({
  reportCentreApi: { generate: mocks.generate, export: mocks.exportReport, options: mocks.options },
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
  'users.read',
];
const modules = ['analytics', 'inventory', 'procurement', 'inpatient', 'finance'];
function result(
  id: keyof typeof REPORT_ENGINES,
  filters: ReportFilters,
  rows: ReportRow[] = [
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
  mocks.options.mockReset();
  mocks.options.mockImplementation(async (_id: string, request: any) => {
    const values: Record<string, Array<{ id: number; label: string; detail: string | null }>> = {
      patient: [{ id: 123, label: 'MRN-SYN — Synthetic Patient', detail: 'Registered 2026-04-01' }],
      department: [{ id: 45, label: 'OPD — Synthetic OPD', detail: 'Active' }],
      staff: [{ id: 67, label: 'Synthetic Staff', detail: 'Clinician · Active' }],
      invoice: [{ id: 123, label: 'INV-SYN — Synthetic Patient', detail: 'Balance: 100.00' }],
      item: [{ id: 8, label: 'IT-SYN — Synthetic Stock', detail: 'Stock: 7' }],
    };
    return {
      options: values[request.kind] ?? [],
      offset: request.offset,
      limit: 20,
      hasMore: false,
    };
  });
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
    fireEvent.click(
      within(document.querySelector('#report-centre-print') as HTMLElement).getByRole('button', {
        name: /Next/,
      }),
    );
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

  it('passes department, staff, status and patient filters to the outpatient report', async () => {
    mocks.context.currentFacility.enabledModules.push('opd');
    mocks.generate.mockImplementation(async (id, filters) => result(id, filters, [], 0));
    render(<ReportCentre />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), {
      target: { value: 'OPD attendance' },
    });
    fireEvent.click(screen.getByRole('button', { name: /OPD attendance/i }));
    fireEvent.change(screen.getByLabelText('Recorded encounter start date from'), {
      target: { value: '2026-04-01' },
    });
    fireEvent.change(screen.getByLabelText('Recorded encounter start date to'), {
      target: { value: '2026-04-30' },
    });
    fireEvent.click(await screen.findByRole('radio', { name: /MRN-SYN — Synthetic Patient/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /OPD — Synthetic OPD/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /Synthetic Staff/ }));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'COMPLETED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(await screen.findByText('No records match the selected filters.')).toBeInTheDocument();
    expect(mocks.generate).toHaveBeenCalledWith(
      'outpatient-encounters',
      expect.objectContaining({
        facilityId: 10,
        from: '2026-04-01',
        to: '2026-04-30',
        patientId: 123,
        departmentId: 45,
        staffId: 67,
        status: 'COMPLETED',
      }),
    );
  });

  it('shows the full filtered financial subtotal and an unreconciled warning', async () => {
    mocks.generate.mockImplementation(async (id, filters) => ({
      ...result(id, filters, [], 2),
      summaries: [
        { label: 'Known recorded receipts (refunds not deducted)', value: '210.00', kind: 'money' },
      ],
    }));
    render(<ReportCentre />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), {
      target: { value: 'All-cashier daily summary' },
    });
    fireEvent.click(screen.getByRole('button', { name: /All-cashier daily summary/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(
      await screen.findByText(/Known recorded receipts \(refunds not deducted\): KES 210.00/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/not reconciled bank\/provider settlements/).length).toBeGreaterThan(
      0,
    );
  });

  it('requires the accounting export grant and sends one as-of date for ledger balances', async () => {
    mocks.context.currentFacility.enabledModules.push('accounting');
    mocks.context.authenticatedUser.permissions.push('accounting.read');
    mocks.generate.mockImplementation(async (id, filters) => result(id, filters, [], 0));
    render(<ReportCentre />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), {
      target: { value: 'Balance sheet' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Balance sheet/ }));
    fireEvent.change(screen.getByLabelText('As-of date (required)'), {
      target: { value: '2026-04-30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(
      await screen.findByText(
        /Export and print require report and any applicable source-domain export permissions/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument();
    expect(mocks.generate).toHaveBeenCalledWith(
      'ledger-balance-sheet',
      expect.objectContaining({ facilityId: 10, to: '2026-04-30' }),
    );
    expect(mocks.generate.mock.calls[0][1].from).toBeUndefined();
  });

  it('reuses the scoped finalized-invoice panel and labels the legacy overview as unreconciled', async () => {
    render(<ReportCentre />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), {
      target: { value: 'Invoices' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Invoices/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Select an invoice');
    fireEvent.click(await screen.findByRole('radio', { name: /INV-SYN — Synthetic Patient/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice' }));
    expect(screen.getByText('Finalized invoice 123 report-only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Existing analytics overview' }));
    expect(screen.getByText(/Unreconciled legacy analytics/)).toBeInTheDocument();
    expect(screen.getByText('Legacy overview content')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to report catalogue' }));
    expect(screen.getByRole('searchbox', { name: 'Search reports' })).toBeInTheDocument();
  });

  it('browses immediately, retains multi-selections across pages, searches and clears to all', async () => {
    mocks.options.mockImplementation(async (_id: string, request: any) => {
      if (request.kind !== 'item')
        return { options: [], offset: request.offset, limit: 20, hasMore: false };
      if (request.search)
        return {
          options: [{ id: 9, label: 'SYN-9 — Search match', detail: 'Stock: 3' }],
          offset: 0,
          limit: 20,
          hasMore: false,
        };
      return request.offset === 0
        ? {
            options: [{ id: 8, label: 'SYN-8 — Page one', detail: 'Stock: 7' }],
            offset: 0,
            limit: 20,
            hasMore: true,
          }
        : {
            options: [{ id: 9, label: 'SYN-9 — Page two', detail: 'Stock: 3' }],
            offset: 20,
            limit: 20,
            hasMore: false,
          };
    });
    render(<ReportCentre />);
    openInventory();
    const picker = screen.getByRole('group', { name: 'Item (optional)' });
    fireEvent.click(await within(picker).findByRole('checkbox', { name: /SYN-8 — Page one/ }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Next' }));
    fireEvent.click(await within(picker).findByRole('checkbox', { name: /SYN-9 — Page two/ }));
    expect(within(picker).getByText('Selected:').parentElement).toHaveTextContent(
      'SYN-8 — Page one, SYN-9 — Page two',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    await screen.findByText('Synthetic Item');
    expect(mocks.generate).toHaveBeenLastCalledWith(
      'inventory-category',
      expect.objectContaining({ itemIds: [8, 9] }),
    );
    fireEvent.change(within(picker).getByRole('searchbox', { name: 'Search item (optional)' }), {
      target: { value: 'match' },
    });
    expect(await within(picker).findByRole('checkbox', { name: /Search match/ })).toBeChecked();
    expect(mocks.options).toHaveBeenCalledWith(
      'inventory-category',
      expect.objectContaining({ kind: 'item', search: 'match', offset: 0 }),
      expect.any(AbortSignal),
    );
    fireEvent.click(within(picker).getByRole('button', { name: 'Clear selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    await waitFor(() =>
      expect(mocks.generate).toHaveBeenLastCalledWith(
        'inventory-category',
        expect.not.objectContaining({ itemIds: expect.anything() }),
      ),
    );
  });

  it('refreshes dependent beds, clears a stale bed and submits labels instead of typed IDs', async () => {
    mocks.options.mockImplementation(async (_id: string, request: any) => {
      const opts =
        request.kind === 'ward'
          ? [
              { id: 1, label: 'Ward A', detail: null },
              { id: 2, label: 'Ward B', detail: null },
            ]
          : request.kind === 'bed'
            ? request.wardId === 1
              ? [{ id: 11, label: 'Ward A — Bed A1', detail: 'Occupied' }]
              : request.wardId === 2
                ? [{ id: 22, label: 'Ward B — Bed B1', detail: 'Reserved' }]
                : []
            : [];
      return { options: opts, offset: 0, limit: 20, hasMore: false };
    });
    render(<ReportCentre />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), {
      target: { value: 'Current inpatient list' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Current inpatient list/ })[0]);
    fireEvent.click(await screen.findByRole('radio', { name: 'Ward A' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Ward A — Bed A1/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Ward B' }));
    expect(await screen.findByRole('radio', { name: /Ward B — Bed B1/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    await waitFor(() =>
      expect(mocks.generate).toHaveBeenLastCalledWith(
        'current-inpatients',
        expect.not.objectContaining({ bedId: expect.anything() }),
      ),
    );
    fireEvent.click(screen.getByRole('radio', { name: /Ward B — Bed B1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    await waitFor(() =>
      expect(mocks.generate).toHaveBeenLastCalledWith(
        'current-inpatients',
        expect.objectContaining({ wardId: 2, bedId: 22 }),
      ),
    );
    expect(screen.queryByLabelText('Ward ID (optional)')).not.toBeInTheDocument();
  });

  it('shows selector errors and retries without pretending that a failed lookup is empty', async () => {
    mocks.options
      .mockRejectedValueOnce(new Error('Synthetic lookup unavailable'))
      .mockResolvedValue({ options: [], offset: 0, limit: 20, hasMore: false });
    render(<ReportCentre />);
    openInventory();
    const picker = screen.getByRole('group', { name: 'Item (optional)' });
    expect(await within(picker).findByRole('alert')).toHaveTextContent(
      'Synthetic lookup unavailable',
    );
    fireEvent.click(within(picker).getByRole('button', { name: 'Retry' }));
    expect(
      await within(picker).findByText('No matching options in this facility.'),
    ).toBeInTheDocument();
  });

  it('opens the scoped diagnosis register and preserves explicit unknown-status/date filters for export', async () => {
    mocks.context.currentFacility.enabledModules.push('opd');
    const linked = REPORT_CATEGORIES.flatMap((category) => category.reports).filter(
      (report) => report.engine === 'outpatient-diagnoses',
    );
    expect(linked.map((entry) => entry.id)).toEqual([
      'departmental-opd-diagnosis-reports',
      'records-opd-diagnosis-reports',
    ]);
    mocks.generate.mockImplementation(async (id, filters) =>
      result(id, filters, [
        {
          encounterId: 42,
          patient: 'Synthetic Patient',
          encounterProgress: 'Unknown',
          encounterStatus: 'UNRECOGNISED',
          diagnosisQuality: 'No diagnosis recorded',
          diagnosisCode: null,
        },
      ]),
    );
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:dx'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<ReportCentre />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), {
      target: { value: 'OPD diagnosis reports' },
    });
    fireEvent.click(screen.getByRole('button', { name: /OPD diagnosis reports/i }));
    expect(screen.getByText(/not an MOH 705/i)).toBeInTheDocument();
    expect(screen.getByText(/outpatient encounter at this facility/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'UNKNOWN' } });
    fireEvent.change(screen.getByLabelText('Recorded encounter start date from'), {
      target: { value: '2026-04-01' },
    });
    fireEvent.change(screen.getByLabelText('Recorded encounter start date to'), {
      target: { value: '2026-04-30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(await screen.findByText('UNRECOGNISED')).toBeInTheDocument();
    expect(
      within(screen.getByRole('table')).getByText('No diagnosis recorded'),
    ).toBeInTheDocument();
    const expected = expect.objectContaining({
      facilityId: 10,
      status: 'UNKNOWN',
      from: '2026-04-01',
      to: '2026-04-30',
    });
    expect(mocks.generate).toHaveBeenCalledWith('outpatient-diagnoses', expected);
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    await waitFor(() =>
      expect(mocks.exportReport).toHaveBeenCalledWith('outpatient-diagnoses', expected, 'csv'),
    );
    click.mockRestore();
  });

  it('never displays late selector data from a previously selected facility', async () => {
    let resolveOld: (value: any) => void = () => {};
    mocks.options.mockImplementation((_id: string, request: any) =>
      request.facilityId === 10
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve({
            options: [{ id: 77, label: 'Facility B item', detail: null }],
            offset: 0,
            limit: 20,
            hasMore: false,
          }),
    );
    const view = render(<ReportCentre />);
    openInventory();
    mocks.context.currentFacility = {
      id: 11,
      name: 'Synthetic Facility B',
      enabledModules: [...modules],
      hiddenModules: [],
    };
    view.rerender(<ReportCentre />);
    expect(await screen.findByRole('checkbox', { name: 'Facility B item' })).toBeInTheDocument();
    await act(async () =>
      resolveOld({
        options: [{ id: 88, label: 'Facility A private item', detail: null }],
        offset: 0,
        limit: 20,
        hasMore: false,
      }),
    );
    expect(screen.queryByText('Facility A private item')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Facility B item' })).toBeInTheDocument();
  });
});
