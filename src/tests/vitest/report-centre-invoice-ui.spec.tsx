// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  api: {
    getInvoiceFinalization: vi.fn(),
    finalizeInvoice: vi.fn(),
    recordInvoicePrintAccess: vi.fn(),
    attributeInvoicePayment: vi.fn(),
  },
  context: {
    currentFacility: {
      id: 10,
      name: 'Synthetic Facility',
      enabledModules: ['analytics', 'finance'],
      hiddenModules: [],
    },
    authenticatedUser: {
      id: 2,
      isSuperAdmin: false,
      roles: ['FACILITY_ADMIN'],
      permissions: [
        'reports.read',
        'reports.export',
        'billing.read',
        'clinical.read',
        'patients.read',
      ],
    },
    refreshKey: 0,
    triggerRefresh: vi.fn(),
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/client.ts', () => ({ api: mocks.api, ApiError: class extends Error {} }));
vi.mock('../../api/payment-hub.client.ts', () => ({ paymentHubApi: { transactions: vi.fn() } }));
vi.mock('../../api/report-centre.client.ts', () => ({
  reportCentreApi: { options: mocks.options, generate: vi.fn(), export: vi.fn() },
}));
vi.mock('../../components/modules/ReportsModule.tsx', () => ({ ReportsModule: () => null }));
import { ReportCentre } from '../../components/modules/report-centre/ReportCentre.tsx';

const snapshot = {
  finalized: true,
  finalizedAt: '2026-10-01T00:00:00Z',
  finalizedByUserId: 2,
  voided: false,
  snapshot: {
    invoice: {
      id: 1,
      number: 'SYN-1',
      createdAt: '2026-10-01T00:00:00Z',
      payerName: null,
      payerType: 'Self-Pay',
      memberNumber: null,
    },
    facility: {
      name: 'Synthetic Hospital',
      internalCode: 'SYN',
      registryCode: '999',
      address: 'Synthetic road',
      county: 'Nyeri',
      phone: '000',
      email: null,
    },
    patient: { id: 1, name: 'Synthetic Patient', mrn: 'MRN-SYN' },
    encounter: {
      id: 1,
      department: 'OPD',
      attendingClinician: 'Synthetic clinician',
      diagnoses: [{ system: 'ICD-10', code: 'Z00', description: 'Synthetic', type: null }],
    },
    items: [
      {
        id: 1,
        code: 'SYN-ITEM',
        description: 'Synthetic line item',
        quantity: 3,
        unitPrice: '7.50',
        total: '22.50',
      },
    ],
    amounts: {
      itemizedTotal: '22.50',
      patientResponsibility: '22.50',
      insurerResponsibility: '0.00',
      copayment: '0.00',
      allocationBasis: 'Synthetic self-pay review',
    },
  },
  financial: {
    reconciled: true,
    netReceipts: '0.00',
    invoiceBalance: '22.50',
    patientBalance: '22.50',
    insurerBalance: '0.00',
    unattributedNetReceipts: '0.00',
    patientCredit: '0.00',
    insurerCredit: '0.00',
  },
  payments: [],
  refunds: [],
};

const secondSnapshot = {
  ...snapshot,
  snapshot: {
    ...snapshot.snapshot,
    invoice: { ...snapshot.snapshot.invoice, id: 2, number: 'SYN-2' },
    items: [{ ...snapshot.snapshot.items[0], id: 2, description: 'Second synthetic line' }],
  },
};

async function chooseAndOpenInvoice() {
  render(<ReportCentre />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), {
    target: { value: 'Invoices' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Invoices/ }));
  const radio = await screen.findByRole('radio', { name: /SYN-1 — Synthetic Patient/ });
  fireEvent.click(radio);
  fireEvent.click(screen.getByRole('button', { name: 'Open invoice' }));
  return radio;
}

describe('Reporting Centre invoice reopening', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.options.mockImplementation(async (_report: string, request: { offset: number }) => ({
      options: [
        { id: 1, label: 'SYN-1 — Synthetic Patient', detail: 'Balance: 22.50' },
        { id: 2, label: 'SYN-2 — Synthetic Patient', detail: 'Balance: 22.50' },
      ],
      offset: request.offset,
      limit: 20,
      hasMore: false,
    }));
    mocks.api.getInvoiceFinalization.mockImplementation(async (id: number) =>
      id === 2 ? secondSnapshot : snapshot,
    );
    mocks.api.recordInvoicePrintAccess.mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    document.body.classList.remove('print-finalized-invoice');
    vi.restoreAllMocks();
  });

  it('reloads the same selected invoice and audits print after finalization', async () => {
    mocks.api.getInvoiceFinalization.mockResolvedValueOnce({ finalized: false });
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const radio = await chooseAndOpenInvoice();
    expect(await screen.findByText(/This invoice is not finalized/)).toBeInTheDocument();
    expect(mocks.api.getInvoiceFinalization).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: 'Print finalized invoice' }),
    ).not.toBeInTheDocument();

    // Pressing the already selected radio leaves the selection unchanged.
    fireEvent.click(radio);
    expect(radio).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice' }));
    expect(await screen.findByText('Synthetic Hospital')).toBeInTheDocument();
    expect(screen.getByText('Synthetic line item')).toBeInTheDocument();
    expect(screen.queryByText(/This invoice is not finalized/)).not.toBeInTheDocument();
    expect(mocks.api.getInvoiceFinalization).toHaveBeenCalledTimes(2);
    expect(mocks.api.getInvoiceFinalization).toHaveBeenLastCalledWith(1, 10);
    expect(radio).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Print finalized invoice' }));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(mocks.api.recordInvoicePrintAccess).toHaveBeenCalledWith(1, 10);
    fireEvent(window, new Event('afterprint'));
  });

  it('does not replace a reopened finalized view with an older pending response', async () => {
    let resolveOld!: (value: { finalized: false }) => void;
    mocks.api.getInvoiceFinalization.mockImplementationOnce(
      () => new Promise((resolve) => (resolveOld = resolve)),
    );
    await chooseAndOpenInvoice();
    expect(screen.getByRole('status')).toHaveTextContent('Loading invoice finalization');
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice' }));
    expect(await screen.findByText('Synthetic Hospital')).toBeInTheDocument();
    expect(mocks.api.getInvoiceFinalization).toHaveBeenCalledTimes(2);
    await act(async () => resolveOld({ finalized: false }));
    expect(screen.getByText('Synthetic line item')).toBeInTheDocument();
    expect(screen.queryByText(/This invoice is not finalized/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print finalized invoice' })).toBeEnabled();
  });

  it('reloads the selected invoice after a read error without treating failure as unfinalized', async () => {
    mocks.api.getInvoiceFinalization.mockRejectedValueOnce(new Error('Synthetic read failed'));
    const radio = await chooseAndOpenInvoice();
    expect(await screen.findByRole('alert')).toHaveTextContent('Do not assume it is unfinalized');
    expect(screen.queryByText(/This invoice is not finalized/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Print finalized invoice' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice' }));
    expect(await screen.findByText('Synthetic Hospital')).toBeInTheDocument();
    expect(mocks.api.getInvoiceFinalization).toHaveBeenCalledTimes(2);
    expect(radio).toBeChecked();
  });

  it('opens and clears the invoice repeatedly without reusing a closed panel', async () => {
    const radio = await chooseAndOpenInvoice();
    expect(await screen.findByText('Synthetic line item')).toBeInTheDocument();
    for (let openCount = 1; openCount <= 2; openCount += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
      expect(screen.queryByRole('region', { name: 'Finalized invoice' })).not.toBeInTheDocument();
      expect(radio).not.toBeChecked();
      fireEvent.click(screen.getByRole('button', { name: 'Open invoice' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Select an invoice to open');
      expect(mocks.api.getInvoiceFinalization).toHaveBeenCalledTimes(openCount);
      fireEvent.click(radio);
      fireEvent.click(screen.getByRole('button', { name: 'Open invoice' }));
      expect(await screen.findByText('Synthetic line item')).toBeInTheDocument();
      expect(mocks.api.getInvoiceFinalization).toHaveBeenCalledTimes(openCount + 1);
    }
  });

  it('does not display an older response after selecting a different invoice', async () => {
    let resolveOld!: (value: { finalized: false }) => void;
    mocks.api.getInvoiceFinalization.mockImplementationOnce(
      () => new Promise((resolve) => (resolveOld = resolve)),
    );
    await chooseAndOpenInvoice();
    expect(screen.getByRole('status')).toHaveTextContent('Loading invoice finalization');
    fireEvent.click(screen.getByRole('radio', { name: /SYN-2 — Synthetic Patient/ }));
    expect(screen.queryByRole('region', { name: 'Finalized invoice' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice' }));
    expect(await screen.findByText('Second synthetic line')).toBeInTheDocument();
    expect(mocks.api.getInvoiceFinalization).toHaveBeenLastCalledWith(2, 10);
    await act(async () => resolveOld({ finalized: false }));
    expect(screen.getByText('Second synthetic line')).toBeInTheDocument();
    expect(screen.queryByText(/This invoice is not finalized/)).not.toBeInTheDocument();
  });

  it('does not use a print authorization after selecting another invoice', async () => {
    let resolvePrint!: () => void;
    mocks.api.recordInvoicePrintAccess.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolvePrint = resolve)),
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await chooseAndOpenInvoice();
    await screen.findByText('Synthetic line item');
    fireEvent.click(screen.getByRole('button', { name: 'Print finalized invoice' }));
    fireEvent.click(screen.getByRole('radio', { name: /SYN-2 — Synthetic Patient/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice' }));
    expect(await screen.findByText('Second synthetic line')).toBeInTheDocument();
    await act(async () => resolvePrint());
    expect(print).not.toHaveBeenCalled();
    expect(document.body).not.toHaveClass('print-finalized-invoice');
    expect(screen.getByText('Second synthetic line')).toBeInTheDocument();
  });

  it('does not use an earlier print authorization after reopening the same invoice', async () => {
    let resolvePrint!: () => void;
    mocks.api.recordInvoicePrintAccess.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolvePrint = resolve)),
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await chooseAndOpenInvoice();
    await screen.findByText('Synthetic Hospital');
    fireEvent.click(screen.getByRole('button', { name: 'Print finalized invoice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice' }));
    await waitFor(() => expect(mocks.api.getInvoiceFinalization).toHaveBeenCalledTimes(2));
    await act(async () => resolvePrint());
    expect(print).not.toHaveBeenCalled();
    expect(document.body).not.toHaveClass('print-finalized-invoice');
    expect(await screen.findByText('Synthetic Hospital')).toBeInTheDocument();
  });
});
