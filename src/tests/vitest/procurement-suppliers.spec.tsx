// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSuppliers: vi.fn(),
  getPurchaseOrders: vi.fn(),
  createPurchaseOrder: vi.fn(),
  showToast: vi.fn(),
  triggerRefresh: vi.fn(),
  context: {
    currentFacility: { id: 21, tenantId: 17 } as { id: number; tenantId: number } | null,
    currentUser: { name: 'Synthetic staff' },
    refreshKey: 0,
  },
}));

vi.mock('../../api/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client.ts')>();
  return {
    ...actual,
    api: {
      getSuppliers: mocks.getSuppliers,
      getPurchaseOrders: mocks.getPurchaseOrders,
      createPurchaseOrder: mocks.createPurchaseOrder,
    },
  };
});
vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({
    ...mocks.context,
    showToast: mocks.showToast,
    triggerRefresh: mocks.triggerRefresh,
  }),
}));

import { ApiError } from '../../api/client.ts';
import { ProcurementModule } from '../../components/modules/ProcurementModule.tsx';

const existing = { id: 12, tenantId: 17, name: 'Existing Supplier', isActive: true };
const another = { id: 13, tenantId: 17, name: 'Another Supplier', isActive: true };
const openModal = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Generate Purchase Order' }));
  await waitFor(() => expect(screen.getByLabelText('Select Supplier *')).toBeEnabled());
  const amount = screen.getByLabelText('Estimated Total Order Amount (KES) *');
  expect(amount).toHaveValue('');
  fireEvent.change(amount, { target: { value: '123.45' } });
};
const selectNew = () =>
  fireEvent.change(screen.getByLabelText('Select Supplier *'), { target: { value: 'new' } });
const enterName = (name: string) =>
  fireEvent.change(screen.getByLabelText('New supplier name *'), { target: { value: name } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  mocks.context.currentFacility = { id: 21, tenantId: 17 };
  mocks.context.refreshKey = 0;
  mocks.getSuppliers.mockResolvedValue([]);
  mocks.getPurchaseOrders.mockResolvedValue([]);
  mocks.createPurchaseOrder.mockResolvedValue({ supplierId: 55 });
});

describe('create supplier purchase order', () => {
  it('makes a name field obvious with no saved suppliers and submits the trimmed name', async () => {
    render(<ProcurementModule />);
    await openModal();
    expect(mocks.getSuppliers).toHaveBeenCalledWith(17, 21);
    expect(
      screen.getByRole('dialog', { name: 'Create Supplier Purchase Order' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Select Supplier *')).toHaveValue('new');
    expect(
      screen.getByText(/supplier will be saved for reuse in this organisation/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not verify or approve/i)).toBeInTheDocument();
    expect(screen.getByText(/item descriptions are not currently saved/i)).toBeInTheDocument();
    enterName('  New Medical Supplies  ');
    submit();
    await waitFor(() => expect(mocks.createPurchaseOrder).toHaveBeenCalledTimes(1));
    const payload = mocks.createPurchaseOrder.mock.calls[0][0];
    expect(payload).toMatchObject({
      tenantId: 17,
      facilityId: 21,
      supplierName: 'New Medical Supplies',
      confirmDuplicateSupplier: false,
      totalAmount: '123.45',
      status: 'Pending Approval',
      orderedBy: 'Synthetic staff',
    });
    expect(payload).not.toHaveProperty('supplierId');
    expect(payload).not.toHaveProperty('phone');
    expect(payload).not.toHaveProperty('kraPin');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.triggerRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows the newly saved supplier and its linked order after refreshing', async () => {
    const savedSupplier = { id: 55, tenantId: 17, name: 'Fresh Supplier', isActive: true };
    mocks.getSuppliers.mockResolvedValueOnce([]).mockResolvedValue([savedSupplier]);
    mocks.getPurchaseOrders.mockResolvedValueOnce([]).mockResolvedValue([
      {
        id: 88,
        tenantId: 17,
        facilityId: 21,
        supplierId: 55,
        poNumber: 'PO-TEST',
        totalAmount: '123.45',
        status: 'Pending Approval',
        createdAt: '2026-10-29T00:00:00.000Z',
      },
    ]);
    mocks.triggerRefresh.mockImplementation(() => {
      mocks.context.refreshKey += 1;
    });
    const view = render(<ProcurementModule />);
    await openModal();
    enterName('Fresh Supplier');
    submit();
    await waitFor(() => expect(mocks.triggerRefresh).toHaveBeenCalledTimes(1));
    view.rerender(<ProcurementModule />);
    await waitFor(() => expect(screen.getByText('PO-TEST')).toBeInTheDocument());
    expect(within(screen.getByRole('table')).getByText('Fresh Supplier')).toBeInTheDocument();
    expect(screen.getByText('Contact details not provided')).toBeInTheDocument();
    expect(screen.queryByText('PIN: KRA')).not.toBeInTheDocument();
  });

  it('keeps selection of existing suppliers and sends their ID without a new name', async () => {
    mocks.getSuppliers.mockResolvedValue([existing, another]);
    mocks.createPurchaseOrder.mockResolvedValue({ supplierId: another.id });
    render(<ProcurementModule />);
    await openModal();
    expect(screen.getByLabelText('Select Supplier *')).toHaveValue(String(existing.id));
    expect(screen.queryByLabelText('New supplier name *')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Select Supplier *'), {
      target: { value: String(another.id) },
    });
    submit();
    await waitFor(() => expect(mocks.createPurchaseOrder).toHaveBeenCalledTimes(1));
    const payload = mocks.createPurchaseOrder.mock.calls[0][0];
    expect(payload.supplierId).toBe(another.id);
    expect(payload).not.toHaveProperty('supplierName');
    expect(payload).not.toHaveProperty('confirmDuplicateSupplier');
    expect(screen.queryByText('PIN: KRA')).not.toBeInTheDocument();
    expect(screen.getAllByText('Contact details not provided')).toHaveLength(2);
  });

  it('requires a user-entered amount instead of using a sample estimate', async () => {
    render(<ProcurementModule />);
    await openModal();
    fireEvent.change(screen.getByLabelText('Estimated Total Order Amount (KES) *'), {
      target: { value: '' },
    });
    enterName('New supplier');
    submit();
    expect(mocks.createPurchaseOrder).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Estimated Total Order Amount (KES) *')).toBeInvalid();
  });

  it('offers a new name when suppliers exist and rejects a whitespace-only name', async () => {
    mocks.getSuppliers.mockResolvedValue([existing]);
    render(<ProcurementModule />);
    await openModal();
    selectNew();
    expect(screen.getByLabelText('New supplier name *')).toHaveAttribute('maxlength', '200');
    enterName('   ');
    submit();
    expect(mocks.createPurchaseOrder).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith(
      'Select a supplier or enter a new supplier name.',
      { tone: 'warning' },
    );
    enterName('Different Supplier');
    submit();
    await waitFor(() => expect(mocks.createPurchaseOrder).toHaveBeenCalledTimes(1));
    expect(mocks.createPurchaseOrder.mock.calls[0][0].supplierName).toBe('Different Supplier');
  });

  it('does not silently merge matching names and requires confirmation for a separate record', async () => {
    mocks.getSuppliers.mockResolvedValue([existing]);
    render(<ProcurementModule />);
    await openModal();
    selectNew();
    enterName('  existing SUPPLIER  ');
    submit();
    expect(mocks.createPurchaseOrder).not.toHaveBeenCalled();
    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent(/a supplier with this name already exists/i);
    fireEvent.click(within(warning).getByLabelText('Create a separate supplier with this name'));
    submit();
    await waitFor(() => expect(mocks.createPurchaseOrder).toHaveBeenCalledTimes(1));
    expect(mocks.createPurchaseOrder.mock.calls[0][0]).toMatchObject({
      supplierName: 'existing SUPPLIER',
      confirmDuplicateSupplier: true,
    });
  });

  it('distinguishes separate records with the same name in choices and orders', async () => {
    mocks.getSuppliers.mockResolvedValue([existing, { ...another, name: 'existing supplier' }]);
    mocks.getPurchaseOrders.mockResolvedValue([
      {
        id: 88,
        tenantId: 17,
        facilityId: 21,
        supplierId: another.id,
        poNumber: 'PO-SAME-NAME',
        totalAmount: '123.45',
        status: 'Pending Approval',
        createdAt: '2026-10-29T00:00:00.000Z',
      },
    ]);
    render(<ProcurementModule />);
    await openModal();
    expect(screen.getByRole('option', { name: 'Existing Supplier (#12)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'existing supplier (#13)' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('table')).getByText('existing supplier (#13)'),
    ).toBeInTheDocument();
  });

  it('refreshes a stale supplier list on a server duplicate warning without losing the name', async () => {
    mocks.getSuppliers.mockResolvedValueOnce([existing]).mockResolvedValueOnce([existing, another]);
    mocks.createPurchaseOrder
      .mockRejectedValueOnce(
        new ApiError('A supplier with this name already exists.', 409, 'SUPPLIER_NAME_EXISTS'),
      )
      .mockResolvedValueOnce({ supplierId: another.id });
    render(<ProcurementModule />);
    await openModal();
    selectNew();
    enterName('Another Supplier');
    submit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i));
    expect(screen.getByLabelText('New supplier name *')).toHaveValue('Another Supplier');
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Another Supplier' })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText('Select Supplier *'), {
      target: { value: String(another.id) },
    });
    expect(screen.queryByLabelText('New supplier name *')).not.toBeInTheDocument();
    submit();
    await waitFor(() => expect(mocks.createPurchaseOrder).toHaveBeenCalledTimes(2));
    expect(mocks.createPurchaseOrder.mock.calls[1][0]).toMatchObject({ supplierId: another.id });
    expect(mocks.createPurchaseOrder.mock.calls[1][0]).not.toHaveProperty('supplierName');
  });

  it('keeps the form and name available on failure', async () => {
    mocks.createPurchaseOrder.mockRejectedValue(new Error('Could not save.'));
    render(<ProcurementModule />);
    await openModal();
    enterName('Keep this name');
    submit();
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith('Could not save.', { tone: 'error' }),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('New supplier name *')).toHaveValue('Keep this name');
    expect(screen.getByRole('button', { name: 'Submit for Approval' })).toBeEnabled();
    expect(mocks.triggerRefresh).not.toHaveBeenCalled();
  });

  it('warns about a used PO number and asks the user to check orders before retrying', async () => {
    mocks.createPurchaseOrder.mockRejectedValueOnce(
      new ApiError(
        'This purchase order number is already in use.',
        409,
        'PURCHASE_ORDER_NUMBER_IN_USE',
      ),
    );
    render(<ProcurementModule />);
    await openModal();
    enterName('Possibly saved supplier');
    submit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/check your orders/i));
    expect(screen.getByRole('button', { name: 'Submit for Approval' })).toBeDisabled();
    expect(screen.getByLabelText('New supplier name *')).toHaveValue('Possibly saved supplier');
    expect(mocks.triggerRefresh).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('PO Tracking Number'), {
      target: { value: 'PO-NEW-NUMBER' },
    });
    expect(screen.getByRole('button', { name: 'Submit for Approval' })).toBeEnabled();
  });

  it('supports keyboard navigation and restores focus when the dialog is dismissed', async () => {
    render(<ProcurementModule />);
    await openModal();
    const number = screen.getByLabelText('PO Tracking Number');
    const submitButton = screen.getByRole('button', { name: 'Submit for Approval' });
    expect(number).toHaveFocus();
    fireEvent.keyDown(number, { key: 'Tab', shiftKey: true });
    expect(submitButton).toHaveFocus();
    fireEvent.keyDown(submitButton, { key: 'Tab' });
    expect(number).toHaveFocus();
    fireEvent.keyDown(number, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Purchase Order' })).toHaveFocus();
  });

  it('prevents duplicate clicks while a submission is in progress', async () => {
    let finish!: (value: { supplierId: number }) => void;
    mocks.createPurchaseOrder.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<ProcurementModule />);
    await openModal();
    enterName('Only once');
    submit();
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Submitting…' }).closest('form')!);
    expect(mocks.createPurchaseOrder).toHaveBeenCalledTimes(1);
    await act(async () => finish({ supplierId: 55 }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('generates a new tracking number after a successful order', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    mocks.getSuppliers.mockResolvedValue([existing]);
    mocks.createPurchaseOrder.mockResolvedValue({ supplierId: existing.id });
    render(<ProcurementModule />);
    await openModal();
    const first = (screen.getByLabelText('PO Tracking Number') as HTMLInputElement).value;
    submit();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await openModal();
    expect(screen.getByLabelText('PO Tracking Number')).not.toHaveValue(first);
  });

  it('blocks submission when the supplier list cannot be loaded', async () => {
    mocks.getSuppliers.mockRejectedValue(new Error('Unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ProcurementModule />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Purchase Order' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/could not load suppliers/i),
    );
    expect(screen.getByRole('button', { name: 'Submit for Approval' })).toBeDisabled();
    expect(mocks.createPurchaseOrder).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('does not carry a pending order or its supplier across a facility switch', async () => {
    let finish!: (value: { supplierId: number }) => void;
    mocks.getSuppliers
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([{ ...another, tenantId: 29 }]);
    mocks.createPurchaseOrder.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<ProcurementModule />);
    await openModal();
    selectNew();
    enterName('Supplier for the old facility');
    submit();
    mocks.context.currentFacility = { id: 30, tenantId: 29 };
    view.rerender(<ProcurementModule />);
    await waitFor(() => expect(mocks.getSuppliers).toHaveBeenCalledWith(29, 30));
    await act(async () => finish({ supplierId: 55 }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Supplier *')).toHaveValue(String(another.id));
    expect(screen.queryByLabelText('New supplier name *')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Estimated Total Order Amount (KES) *')).toHaveValue('');
    expect(mocks.showToast).toHaveBeenCalledWith(
      'Purchase order submitted for the facility selected when you started.',
    );
  });

  it('does not replace the new facility supplier list with a delayed duplicate refresh', async () => {
    let finishRefresh!: (value: (typeof existing)[]) => void;
    mocks.getSuppliers
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
      )
      .mockResolvedValueOnce([{ ...another, tenantId: 29 }]);
    mocks.createPurchaseOrder.mockRejectedValueOnce(
      new ApiError('A supplier with this name already exists.', 409, 'SUPPLIER_NAME_EXISTS'),
    );
    const view = render(<ProcurementModule />);
    await openModal();
    enterName('Late conflict');
    submit();
    await waitFor(() => expect(mocks.getSuppliers).toHaveBeenCalledTimes(2));
    mocks.context.currentFacility = { id: 30, tenantId: 29 };
    view.rerender(<ProcurementModule />);
    await waitFor(() => expect(mocks.getSuppliers).toHaveBeenCalledWith(29, 30));
    await act(async () => finishRefresh([existing]));
    expect(screen.getByRole('option', { name: 'Another Supplier' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Existing Supplier' })).not.toBeInTheDocument();
    expect(mocks.showToast).toHaveBeenCalledWith(
      'The purchase order for the previously selected facility could not be saved.',
      { tone: 'error' },
    );
  });

  it('ignores late responses from a previously selected facility', async () => {
    let finishOld!: (value: (typeof existing)[]) => void;
    mocks.getSuppliers
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = resolve;
        }),
      )
      .mockResolvedValueOnce([{ ...another, tenantId: 29 }]);
    const view = render(<ProcurementModule />);
    await waitFor(() => expect(mocks.getSuppliers).toHaveBeenCalledWith(17, 21));
    mocks.context.currentFacility = { id: 30, tenantId: 29 };
    view.rerender(<ProcurementModule />);
    await waitFor(() => expect(mocks.getSuppliers).toHaveBeenCalledWith(29, 30));
    await act(async () => finishOld([existing]));
    await openModal();
    expect(screen.getByRole('option', { name: 'Another Supplier' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Existing Supplier' })).not.toBeInTheDocument();
  });
});
