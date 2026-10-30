// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSuppliers: vi.fn(),
  getPurchaseOrders: vi.fn(),
  getPurchaseOrder: vi.fn(),
  createPurchaseOrder: vi.fn(),
  updatePurchaseOrder: vi.fn(),
  transitionPurchaseOrder: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  deactivateSupplier: vi.fn(),
  showToast: vi.fn(),
  triggerRefresh: vi.fn(),
  context: {
    currentFacility: { id: 21, tenantId: 17 },
    currentUser: { name: 'Synthetic reviewer' },
    authenticatedUser: {
      id: 7,
      tenantId: 17,
      isSuperAdmin: false,
      permissions: ['procurement.read'],
    },
    refreshKey: 0,
  },
}));
vi.mock('../../api/client.ts', async (original) => ({
  ...(await original<typeof import('../../api/client.ts')>()),
  api: {
    getSuppliers: mocks.getSuppliers,
    getPurchaseOrders: mocks.getPurchaseOrders,
    getPurchaseOrder: mocks.getPurchaseOrder,
    createPurchaseOrder: mocks.createPurchaseOrder,
    updatePurchaseOrder: mocks.updatePurchaseOrder,
    transitionPurchaseOrder: mocks.transitionPurchaseOrder,
    createSupplier: mocks.createSupplier,
    updateSupplier: mocks.updateSupplier,
    deactivateSupplier: mocks.deactivateSupplier,
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({
    ...mocks.context,
    showToast: mocks.showToast,
    triggerRefresh: mocks.triggerRefresh,
  }),
}));
import { ProcurementModule } from '../../components/modules/ProcurementModule.tsx';
import { ApiError } from '../../api/client.ts';

const supplier = { id: 4, tenantId: 17, name: 'Synthetic supplier', isActive: true, revision: 1 };
const order = {
  id: 44,
  tenantId: 17,
  facilityId: 21,
  supplierId: 4,
  poNumber: 'PO-UI',
  totalAmount: '15.00',
  status: 'Pending Approval',
  orderedBy: 'Requester',
  approvedBy: null,
  createdByUserId: 2,
  revision: 3,
  description: 'Purpose',
  expectedDeliveryDate: '2027-05-10',
  deliveryAddress: 'Synthetic ward',
  paymentTerms: 'Quoted terms',
  notes: 'Quoted note',
  subtotalAmount: '15.00',
  taxAmount: '0.00',
  shippingAmount: '0.00',
  discountAmount: '0.00',
  createdAt: '2027-01-01T00:00:00Z',
  items: [
    {
      id: 9,
      description: 'Boxes',
      quantity: '1.500',
      unit: 'box',
      unitPrice: '10.00',
      lineTotal: '15.00',
    },
  ],
  events: [
    {
      id: 1,
      eventType: 'CREATED',
      fromStatus: null,
      toStatus: 'Pending Approval',
      actorUserId: 2,
      note: null,
      details: null,
      createdAt: '2027-01-01T00:00:00Z',
    },
  ],
};
const viewOrder = async () => {
  await screen.findByRole('button', { name: 'View PO-UI' });
  fireEvent.click(screen.getByRole('button', { name: 'View PO-UI' }));
  return screen.findByRole('dialog', { name: 'Purchase order PO-UI' });
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  mocks.context.currentFacility = { id: 21, tenantId: 17 };
  mocks.context.authenticatedUser = {
    id: 7,
    tenantId: 17,
    isSuperAdmin: false,
    permissions: ['procurement.read'],
  };
  mocks.context.refreshKey = 0;
  mocks.getSuppliers.mockResolvedValue([supplier]);
  mocks.getPurchaseOrders.mockResolvedValue([order]);
  mocks.getPurchaseOrder.mockResolvedValue(order);
  mocks.createPurchaseOrder.mockResolvedValue({ ...order, supplierId: 4 });
  mocks.updatePurchaseOrder.mockResolvedValue(order);
  mocks.transitionPurchaseOrder.mockResolvedValue(order);
  mocks.createSupplier.mockResolvedValue(supplier);
  mocks.updateSupplier.mockResolvedValue(supplier);
  mocks.deactivateSupplier.mockResolvedValue(supplier);
});

describe('procurement permission-aware UI', () => {
  it('does not load procurement data without read permission or for a platform-only account', async () => {
    mocks.context.authenticatedUser.permissions = ['procurement.create'];
    const view = render(<ProcurementModule />);
    expect(
      screen.getByText(/authorized facility account with procurement read permission/i),
    ).toBeInTheDocument();
    expect(mocks.getSuppliers).not.toHaveBeenCalled();
    mocks.context.authenticatedUser = {
      id: 7,
      tenantId: null as unknown as number,
      isSuperAdmin: true,
      permissions: ['procurement.read', 'procurement.create'],
    };
    view.rerender(<ProcurementModule />);
    expect(
      screen.getByText(/authorized facility account with procurement read permission/i),
    ).toBeInTheDocument();
    expect(mocks.getSuppliers).not.toHaveBeenCalled();
  });

  it('shows details to a reader but no create, edit or lifecycle actions', async () => {
    render(<ProcurementModule />);
    const dialog = await viewOrder();
    expect(
      screen.queryByRole('button', { name: 'Generate Purchase Order' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add supplier' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Manage Synthetic supplier/ }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getAllByText('Purpose')).toHaveLength(2);
    expect(within(dialog).getByText('Boxes')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Edit pending order' }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByText(/do not record goods receipt/i)).toBeInTheDocument();
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Close' }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'View PO-UI' })).toHaveFocus();
  });

  it('submits a complete itemized form with calculated adjustments', async () => {
    mocks.context.authenticatedUser.permissions = ['procurement.read', 'procurement.create'];
    render(<ProcurementModule />);
    await screen.findByRole('button', { name: 'View PO-UI' });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Purchase Order' }));
    const set = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    set('Requisition Items Description', 'Synthetic requisition');
    set('Expected delivery date', '2027-04-10');
    set('Delivery address', 'Delivery address');
    set('Payment terms', '30 days');
    set('Additional notes', 'Note');
    set('Line 1 description *', 'Gauze');
    set('Line 1 quantity *', '1.5');
    set('Line 1 unit *', 'box');
    set('Line 1 unit price (KES) *', '10.01');
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
    set('Line 2 description *', 'Tape');
    set('Line 2 quantity *', '2');
    set('Line 2 unit *', 'roll');
    set('Line 2 unit price (KES) *', '2.25');
    set('Tax (KES)', '2');
    set('Shipping (KES)', '1.25');
    set('Discount (KES)', '0.50');
    expect(screen.getByText('Order total: KES 22.27')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));
    await waitFor(() => expect(mocks.createPurchaseOrder).toHaveBeenCalledTimes(1));
    expect(mocks.createPurchaseOrder.mock.calls[0][0]).toMatchObject({
      supplierId: 4,
      description: 'Synthetic requisition',
      expectedDeliveryDate: '2027-04-10',
      deliveryAddress: 'Delivery address',
      paymentTerms: '30 days',
      notes: 'Note',
      totalAmount: '22.27',
      taxAmount: '2',
      shippingAmount: '1.25',
      discountAmount: '0.50',
      items: [
        { description: 'Gauze', quantity: '1.5', unit: 'box', unitPrice: '10.01' },
        { description: 'Tape', quantity: '2', unit: 'roll', unitPrice: '2.25' },
      ],
    });
  });

  it('shows only granted actions and prevents self-approval', async () => {
    mocks.context.authenticatedUser.permissions = [
      'procurement.read',
      'procurement.approve',
      'procurement.reject',
    ];
    mocks.getPurchaseOrder.mockResolvedValue({ ...order, createdByUserId: 7 });
    render(<ProcurementModule />);
    const dialog = await viewOrder();
    expect(within(dialog).getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeEnabled();
    expect(within(dialog).queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    fireEvent.change(within(dialog).getByLabelText('Reason *'), {
      target: { value: 'Clarify quotation' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm reject' }));
    await waitFor(() =>
      expect(mocks.transitionPurchaseOrder).toHaveBeenCalledWith(44, 'reject', {
        facilityId: 21,
        expectedRevision: 3,
        note: 'Clarify quotation',
      }),
    );
  });

  it('requires an explicit administrative-only confirmation before completing', async () => {
    mocks.context.authenticatedUser.permissions = ['procurement.read', 'procurement.complete'];
    mocks.getPurchaseOrder.mockResolvedValue({ ...order, status: 'Approved' });
    render(<ProcurementModule />);
    const dialog = await viewOrder();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete' }));
    fireEvent.change(within(dialog).getByLabelText('Completion note *'), {
      target: { value: 'Close internally' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm complete' }));
    expect(mocks.transitionPurchaseOrder).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/administrative-only/);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm complete' }));
    await waitFor(() =>
      expect(mocks.transitionPurchaseOrder).toHaveBeenCalledWith(44, 'complete', {
        facilityId: 21,
        expectedRevision: 3,
        note: 'Close internally',
        confirmAdministrativeCompletion: true,
      }),
    );
  });

  it('edits existing lines using the reviewed revision', async () => {
    mocks.context.authenticatedUser.permissions = ['procurement.read', 'procurement.update'];
    render(<ProcurementModule />);
    const dialog = await viewOrder();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit pending order' }));
    expect(screen.getByLabelText('Line 1 description *')).toHaveValue('Boxes');
    fireEvent.change(screen.getByLabelText('Line 1 quantity *'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pending order' }));
    await waitFor(() =>
      expect(mocks.updatePurchaseOrder).toHaveBeenCalledWith(
        44,
        expect.objectContaining({
          facilityId: 21,
          supplierId: 4,
          expectedRevision: 3,
          items: [{ description: 'Boxes', quantity: '2', unit: 'box', unitPrice: '10.00' }],
        }),
      ),
    );
  });

  it('never silently switches the supplier when it becomes inactive during an edit', async () => {
    mocks.context.authenticatedUser.permissions = ['procurement.read', 'procurement.update'];
    const view = render(<ProcurementModule />);
    const dialog = await viewOrder();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit pending order' }));
    expect(screen.getByLabelText('Select Supplier *')).toHaveValue('4');
    mocks.getSuppliers.mockResolvedValue([
      { ...supplier, isActive: false },
      { ...supplier, id: 5, name: 'Other supplier', isActive: true },
    ]);
    mocks.context.refreshKey += 1;
    view.rerender(<ProcurementModule />);
    await screen.findByText(/selection will not be changed automatically/i);
    expect(screen.getByLabelText('Select Supplier *')).toHaveValue('4');
    expect(screen.getByRole('button', { name: 'Save pending order' })).toBeDisabled();
    expect(mocks.updatePurchaseOrder).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Select Supplier *'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pending order' }));
    await waitFor(() =>
      expect(mocks.updatePurchaseOrder).toHaveBeenCalledWith(
        44,
        expect.objectContaining({ supplierId: 5, expectedRevision: 3 }),
      ),
    );
  });

  it('clears a number conflict when abandoning an edit and restores focus to the order', async () => {
    mocks.context.authenticatedUser.permissions = [
      'procurement.read',
      'procurement.create',
      'procurement.update',
    ];
    mocks.updatePurchaseOrder.mockRejectedValueOnce(
      new ApiError('Number already in use.', 409, 'PURCHASE_ORDER_NUMBER_IN_USE'),
    );
    render(<ProcurementModule />);
    const dialog = await viewOrder();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit pending order' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save pending order' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/check your orders/i));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'View PO-UI' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Purchase Order' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for Approval' })).toBeEnabled();
  });

  it('does not carry a create-form number conflict into a different order edit', async () => {
    mocks.context.authenticatedUser.permissions = [
      'procurement.read',
      'procurement.create',
      'procurement.update',
    ];
    mocks.createPurchaseOrder.mockRejectedValueOnce(
      new ApiError('Number already in use.', 409, 'PURCHASE_ORDER_NUMBER_IN_USE'),
    );
    render(<ProcurementModule />);
    await screen.findByRole('button', { name: 'View PO-UI' });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Purchase Order' }));
    for (const [label, value] of [
      ['Line 1 description *', 'Box'],
      ['Line 1 unit *', 'unit'],
      ['Line 1 unit price (KES) *', '1'],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/check your orders/i));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await viewOrder();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit pending order' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save pending order' })).toBeEnabled();
  });

  it('permits explicit supplier details and soft deactivation for authorized users', async () => {
    mocks.context.authenticatedUser.permissions = [
      'procurement.read',
      'procurement.update',
      'procurement.delete',
    ];
    render(<ProcurementModule />);
    await screen.findByRole('button', { name: 'Manage Synthetic supplier' });
    fireEvent.click(screen.getByRole('button', { name: 'Manage Synthetic supplier' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit supplier' });
    expect(within(dialog).getByText(/all its facilities/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate supplier' }));
    fireEvent.change(within(dialog).getByLabelText('Reason *'), {
      target: { value: 'No longer used' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm deactivation' }));
    await waitFor(() =>
      expect(mocks.deactivateSupplier).toHaveBeenCalledWith(4, {
        facilityId: 21,
        expectedRevision: 1,
        note: 'No longer used',
      }),
    );
  });

  it('ignores a late detail response after switching facilities', async () => {
    let finish!: (value: typeof order) => void;
    mocks.getPurchaseOrder.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<ProcurementModule />);
    await screen.findByRole('button', { name: 'View PO-UI' });
    fireEvent.click(screen.getByRole('button', { name: 'View PO-UI' }));
    mocks.context.currentFacility = { id: 30, tenantId: 29 };
    view.rerender(<ProcurementModule />);
    await waitFor(() => expect(mocks.getSuppliers).toHaveBeenCalledWith(29, 30));
    await act(async () => finish(order));
    expect(screen.queryByRole('dialog', { name: 'Purchase order PO-UI' })).not.toBeInTheDocument();
  });
});
