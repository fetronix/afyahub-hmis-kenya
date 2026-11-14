// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  api: {
    getInvoiceFinalization: vi.fn(),
    finalizeInvoice: vi.fn(),
    recordInvoicePrintAccess: vi.fn(),
    attributeInvoicePayment: vi.fn(),
  },
  context: {
    currentFacility: { id: 1 },
    authenticatedUser: {
      id: 2,
      isSuperAdmin: false,
      permissions: ['billing.read', 'billing.update', 'clinical.read', 'billing.payments.record'],
    },
    refreshKey: 0,
    triggerRefresh: vi.fn(),
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocked.context }));
vi.mock('../../api/client.ts', () => ({ api: mocked.api, ApiError: class extends Error {} }));
vi.mock('../../api/payment-hub.client.ts', () => ({ paymentHubApi: { transactions: vi.fn() } }));
import { FinalizedInvoicePanel } from '../../components/modules/FinalizedInvoicePanel.tsx';

const snapshot = (id: number) => ({
  finalized: true,
  finalizedAt: '2026-10-01T00:00:00Z',
  finalizedByUserId: 2,
  voided: false,
  snapshot: {
    invoice: {
      id,
      number: `SYN-${id}`,
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
    patient: { id, name: `Synthetic Patient ${id}`, mrn: `MRN-${id}` },
    encounter: {
      id,
      department: 'OPD',
      attendingClinician: 'Synthetic clinician',
      diagnoses: [{ system: 'ICD-10', code: 'Z00', description: 'Synthetic', type: null }],
    },
    items: [
      {
        id,
        code: 'TEST',
        description: 'Synthetic service',
        quantity: 1,
        unitPrice: '100.00',
        total: '100.00',
      },
    ],
    amounts: {
      itemizedTotal: '100.00',
      patientResponsibility: '40.00',
      insurerResponsibility: '60.00',
      copayment: '10.00',
      allocationBasis: 'Synthetic review',
    },
  },
  financial: {
    reconciled: true,
    netReceipts: '0.00',
    invoiceBalance: '100.00',
    patientBalance: '40.00',
    insurerBalance: '60.00',
    unattributedNetReceipts: '0.00',
    patientCredit: '0.00',
    insurerCredit: '0.00',
  },
  payments: [],
  refunds: [],
});

describe('finalized invoice UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.context.currentFacility.id = 1;
    mocked.api.getInvoiceFinalization.mockImplementation(async (id: number) => snapshot(id));
  });
  afterEach(() => {
    cleanup();
    document.body.classList.remove('print-finalized-invoice');
  });

  it('shows recorded identity and split balances without inventing discounts', async () => {
    render(<FinalizedInvoicePanel invoiceId={1} />);
    expect(await screen.findByText('Synthetic Hospital')).toBeInTheDocument();
    expect(screen.getByText(/Patient balance: KES 40.00/)).toBeInTheDocument();
    expect(screen.getByText(/Insurer balance: KES 60.00/)).toBeInTheDocument();
    expect(
      screen.getByText(/Discounts \/ adjustments: not separately recorded/),
    ).toBeInTheDocument();
  });

  it('never prints a newly selected invoice using a stale print authorization', async () => {
    let resolvePrint!: () => void;
    mocked.api.recordInvoicePrintAccess.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePrint = resolve;
        }),
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { rerender } = render(<FinalizedInvoicePanel invoiceId={1} />);
    await screen.findByText('Synthetic Hospital');
    fireEvent.click(screen.getByRole('button', { name: 'Print finalized invoice' }));
    rerender(<FinalizedInvoicePanel invoiceId={2} />);
    expect(await screen.findByText(/Invoice SYN-2/)).toBeInTheDocument();
    await act(async () => {
      resolvePrint();
    });
    expect(print).not.toHaveBeenCalled();
    expect(document.body).not.toHaveClass('print-finalized-invoice');
    print.mockRestore();
  });
});
