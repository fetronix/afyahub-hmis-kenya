// @vitest-environment jsdom
/**
 * The matching, returns and credit-note screen.
 *
 * These tests are about what an operator can see and do, not about the
 * arithmetic — the accounting itself is proven against PostgreSQL in
 * `procurement-matching-returns.db.spec.ts`. What matters here is that a
 * difference is legible, that accepting one cannot be done without a written
 * reason, and that a return or credit aimed at a facility with no data says
 * so instead of failing silently.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listSupplierInvoices: vi.fn(),
  getInvoiceMatch: vi.fn(),
  runInvoiceMatch: vi.fn(),
  overrideInvoiceMatch: vi.fn(),
  listSupplierReturns: vi.fn(),
  getSupplierReturn: vi.fn(),
  postSupplierReturn: vi.fn(),
  listSupplierCreditNotes: vi.fn(),
  getSupplierCreditNote: vi.fn(),
  createSupplierCreditNote: vi.fn(),
  listGoodsReceivedNotes: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../api/clients/procurement-workflow.client.ts', () => ({
  procurementWorkflowClient: {
    listSupplierInvoices: mocks.listSupplierInvoices,
    getInvoiceMatch: mocks.getInvoiceMatch,
    runInvoiceMatch: mocks.runInvoiceMatch,
    overrideInvoiceMatch: mocks.overrideInvoiceMatch,
    listSupplierReturns: mocks.listSupplierReturns,
    getSupplierReturn: mocks.getSupplierReturn,
    postSupplierReturn: mocks.postSupplierReturn,
    listSupplierCreditNotes: mocks.listSupplierCreditNotes,
    getSupplierCreditNote: mocks.getSupplierCreditNote,
    createSupplierCreditNote: mocks.createSupplierCreditNote,
    listGoodsReceivedNotes: mocks.listGoodsReceivedNotes,
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({ showToast: mocks.showToast }),
}));

import { MatchingReturnsPanel } from '../../components/procurement/MatchingReturnsPanel.tsx';

const invoice = {
  id: 301,
  supplierId: 12,
  supplierName: 'Synthetic supplier',
  purchaseOrderId: 77,
  goodsReceivedNoteId: 88,
  invoiceNumber: 'INV-UI-1',
  invoiceDate: '2026-04-10',
  dueDate: null,
  subtotalKes: '100.00',
  taxKes: '0.00',
  totalAmountKes: '100.00',
  paidAmountKes: '0.00',
  balanceKes: '100.00',
  status: 'POSTED',
  postedJournalId: 9,
};

const varianceMatch = {
  status: 'VARIANCE' as const,
  orderedCents: 10000,
  receivedCents: 12000,
  invoicedCents: 12000,
  priceVarianceCents: 2000,
  amountVarianceCents: 0,
  toleranceCents: 0,
  findings: [
    {
      code: 'PRICE_VARIANCE' as const,
      detail: 'Order line 1 was ordered at 10.00 and received at 12.00.',
      amountCents: '2000',
    },
  ],
};

const note = {
  id: 88,
  grnNumber: 'GRN-UI-1',
  purchaseOrderId: 77,
  supplierId: 12,
  receivedDate: '2026-04-10',
  receivedByName: 'Synthetic receiver',
  status: 'POSTED' as const,
  inventoryValueKes: '120.00',
  notes: null,
  items: [
    {
      id: 501,
      purchaseOrderItemId: 1,
      inventoryItemId: 9,
      description: 'Synthetic gloves',
      quantityReceived: '10.00',
      unitCost: '12.00',
      lineTotal: '120.00',
      batchNumber: 'LOT-UI',
      expiryDate: '2028-01-31',
    },
  ],
  invoice: { id: 301, invoiceNumber: 'INV-UI-1', status: 'POSTED' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSupplierInvoices.mockResolvedValue([invoice]);
  mocks.getInvoiceMatch.mockResolvedValue({ success: true, match: varianceMatch });
  mocks.listSupplierReturns.mockResolvedValue({ success: true, returns: [] });
  mocks.listSupplierCreditNotes.mockResolvedValue({ success: true, creditNotes: [] });
  mocks.listGoodsReceivedNotes.mockResolvedValue([note]);
});

describe('MatchingReturnsPanel', () => {
  it('shows the verdict and names each difference in plain language', async () => {
    render(<MatchingReturnsPanel facilityId={21} canDecide />);

    /* The number appears twice on purpose: once as the payables row and once
       as the receipt's invoice badge. */
    expect((await screen.findAllByText('INV-UI-1')).length).toBeGreaterThan(0);
    expect(screen.getByText('VARIANCE')).toBeTruthy();
    expect(screen.getByText('Price differs from the order')).toBeTruthy();
    expect(screen.getByText(/KES 20.00/)).toBeTruthy();
  });

  it('offers payment-blocking work only to someone allowed to decide', async () => {
    const { rerender } = render(<MatchingReturnsPanel facilityId={21} canDecide={false} />);
    await screen.findAllByText('INV-UI-1');
    expect(screen.queryByText('Accept')).toBeNull();
    expect(screen.queryByText('Re-check')).toBeNull();

    rerender(<MatchingReturnsPanel facilityId={21} canDecide />);
    expect(await screen.findByText('Accept')).toBeTruthy();
  });

  it('refuses to accept a difference with a one-word reason', async () => {
    render(<MatchingReturnsPanel facilityId={21} canDecide />);
    fireEvent.click(await screen.findByText('Accept'));

    const reason = await screen.findByPlaceholderText(/post-delivery increase/i);
    fireEvent.change(reason, { target: { value: 'ok' } });
    fireEvent.click(screen.getByText('Accept and record'));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.stringContaining('at least 10 characters'),
        expect.objectContaining({ tone: 'warning' }),
      ),
    );
    expect(mocks.overrideInvoiceMatch).not.toHaveBeenCalled();
  });

  it('sends the written reason when a real one is given', async () => {
    mocks.overrideInvoiceMatch.mockResolvedValue({
      success: true,
      match: { ...varianceMatch, status: 'OVERRIDDEN', overrideReason: 'Agreed uplift.' },
    });
    render(<MatchingReturnsPanel facilityId={21} canDecide />);
    fireEvent.click(await screen.findByText('Accept'));

    fireEvent.change(await screen.findByPlaceholderText(/post-delivery increase/i), {
      target: { value: 'Supplier invoiced the agreed post-delivery increase.' },
    });
    fireEvent.click(screen.getByText('Accept and record'));

    await waitFor(() =>
      expect(mocks.overrideInvoiceMatch).toHaveBeenCalledWith(
        21,
        301,
        'Supplier invoiced the agreed post-delivery increase.',
      ),
    );
  });

  it('will not post a return without a quantity', async () => {
    render(<MatchingReturnsPanel facilityId={21} canDecide />);
    fireEvent.click(await screen.findByText('Return goods'));
    fireEvent.click(screen.getByText('Post return'));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.stringContaining('quantity'),
        expect.objectContaining({ tone: 'warning' }),
      ),
    );
    expect(mocks.postSupplierReturn).not.toHaveBeenCalled();
  });

  it('names the reason codes so the ledger entry is understandable later', async () => {
    render(<MatchingReturnsPanel facilityId={21} canDecide />);
    fireEvent.click(await screen.findByText('Return goods'));

    expect(await screen.findByText('Rejected — quality')).toBeTruthy();
    expect(screen.getByText('Damaged in transit')).toBeTruthy();
  });

  it('says there is nothing to show rather than rendering an empty table', async () => {
    mocks.listSupplierInvoices.mockResolvedValue([]);
    mocks.listGoodsReceivedNotes.mockResolvedValue([]);
    render(<MatchingReturnsPanel facilityId={21} canDecide />);

    expect(await screen.findByText('No supplier invoices')).toBeTruthy();
    expect(screen.getByText('No credit notes')).toBeTruthy();
    expect(screen.getByText('No receipts to return against')).toBeTruthy();
  });
});
