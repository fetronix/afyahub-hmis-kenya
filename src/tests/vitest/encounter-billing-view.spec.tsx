// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ getInvoices: vi.fn(), getInvoiceDetail: vi.fn() }));
vi.mock('../../api/client.ts', () => ({ api: mocks }));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => ({ refreshKey: 0 }) }));
import { EncounterBillingView } from '../../components/modules/EncounterBillingView.tsx';

const invoice = (id: number, patientId = 20, encounterId: number | null = 30) => ({
  id,
  facilityId: 10,
  patientId,
  encounterId,
  invoiceNumber: `SYN-${id}`,
  status: 'Pending',
  totalAmount: '80.00',
  paidAmount: '0.00',
  balanceAmount: '80.00',
  creditBalance: '0.00',
});
const detail = (id: number, patientId = 20, encounterId = 30) => ({
  invoice: invoice(id, patientId, encounterId),
  items: [
    {
      id: id + 100,
      invoiceId: id,
      description: `Synthetic test ${id}`,
      itemType: 'Lab',
      serviceCode: `SYN-LAB-${id}`,
      serviceDepartment: 'laboratory',
      serviceUnit: 'Test',
      quantity: 1,
      unitPrice: '80.00',
      totalAmount: '80.00',
      sourceType: 'LAB_TEST',
      sourceId: 5,
      serviceDate: '2026-01-01',
    },
  ],
  payments: [],
  refunds: [],
});
const props = { facilityId: 10, patientId: 20, encounterId: 30 };

describe('scoped encounter billing view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInvoices.mockResolvedValue([invoice(1), invoice(2, 20, 31), invoice(3, 99, 30)]);
    mocks.getInvoiceDetail.mockImplementation(async (id: number) => detail(id));
  });
  afterEach(cleanup);

  it('shows only the matching encounter with recorded item and receipt totals', async () => {
    const user = userEvent.setup();
    render(<EncounterBillingView {...props} />);
    await user.click(screen.getByText('Encounter billing and receipts'));
    expect(await screen.findByText('SYN-1 · Pending')).toBeInTheDocument();
    expect(screen.getByText(/Synthetic test 1/)).toBeInTheDocument();
    expect(screen.getByText(/SYN-LAB-1/)).toHaveTextContent('laboratory');
    expect(await screen.findByText('Item subtotal')).toBeInTheDocument();
    expect(screen.getByText('Item adjustments/reversals').nextElementSibling).toHaveTextContent(
      'Not available',
    );
    expect(screen.getByText('Outstanding balance').nextElementSibling).toHaveTextContent('80.00');
    expect(mocks.getInvoices).toHaveBeenCalledWith(10, 20);
    expect(mocks.getInvoiceDetail).not.toHaveBeenCalledWith(2);
    expect(mocks.getInvoiceDetail).not.toHaveBeenCalledWith(3);
  });

  it('does not turn an incomplete invoice list into an empty balance', async () => {
    mocks.getInvoices.mockResolvedValue([{ ...invoice(1), patientId: undefined }]);
    const user = userEvent.setup();
    render(<EncounterBillingView {...props} />);
    await user.click(screen.getByText('Encounter billing and receipts'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Do not assume there is no balance');
    expect(screen.queryByText(/No invoice linked/)).not.toBeInTheDocument();
  });

  it('rejects a detail that returns a different scope or foreign invoice line', async () => {
    mocks.getInvoices.mockResolvedValue([invoice(1)]);
    mocks.getInvoiceDetail.mockResolvedValue({
      ...detail(1),
      items: [{ ...detail(1).items[0], invoiceId: 2 }],
    });
    const user = userEvent.setup();
    render(<EncounterBillingView {...props} />);
    await user.click(screen.getByText('Encounter billing and receipts'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Encounter invoices are unavailable',
    );
    expect(screen.queryByText(/Synthetic test 1/)).not.toBeInTheDocument();
  });

  it('never renders stale invoice details after a patient or encounter change', async () => {
    let finishOld!: (value: unknown) => void;
    mocks.getInvoices.mockImplementation((_facility: number, patient: number) =>
      patient === 20
        ? new Promise((resolve) => {
            finishOld = resolve;
          })
        : Promise.resolve([invoice(4, 21, 31)]),
    );
    mocks.getInvoiceDetail.mockResolvedValue(detail(4, 21, 31));
    const user = userEvent.setup();
    const view = render(<EncounterBillingView {...props} />);
    await user.click(screen.getByText('Encounter billing and receipts'));
    view.rerender(<EncounterBillingView facilityId={10} patientId={21} encounterId={31} />);
    expect(await screen.findByText('SYN-4 · Pending')).toBeInTheDocument();
    finishOld([invoice(1)]);
    await waitFor(() => expect(screen.getByText(/Synthetic test 4/)).toBeInTheDocument());
    expect(screen.queryByText('SYN-1 · Pending')).not.toBeInTheDocument();
    expect(screen.queryByText(/Synthetic test 1/)).not.toBeInTheDocument();
  });
});
