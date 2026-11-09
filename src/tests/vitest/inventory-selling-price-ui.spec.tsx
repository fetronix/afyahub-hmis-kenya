// @vitest-environment jsdom
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocked = vi.hoisted(() => ({
  context: {
    currentFacility: { id: 10 },
    authenticatedUser: {
      id: 7,
      permissions: ['inventory.manage', 'billing.update'],
      isSuperAdmin: false,
    },
    showToast: vi.fn(),
    refreshKey: 0,
    triggerRefresh: vi.fn(),
  },
  api: {
    getInventory: vi.fn(),
    getInventoryBatches: vi.fn(),
    getExpirySummary: vi.fn(),
    updateInventorySellingPrice: vi.fn(),
    createInventoryItem: vi.fn(),
    receiveBatch: vi.fn(),
    checkInventoryReceiptRequest: vi.fn(),
    cancelInventoryReceiptRetry: vi.fn(),
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocked.context }));
vi.mock('../../api/client.ts', () => ({ api: mocked.api }));
import { InventoryModule } from '../../components/modules/InventoryModule.tsx';

describe('Facility inventory selling-price controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('crypto', webcrypto);
    window.localStorage.clear();
    mocked.api.receiveBatch.mockReset();
    mocked.api.checkInventoryReceiptRequest.mockReset();
    mocked.api.cancelInventoryReceiptRetry.mockReset();
    mocked.context.authenticatedUser = {
      id: 7,
      permissions: ['inventory.manage', 'billing.update'],
      isSuperAdmin: false,
    };
    mocked.api.getInventory.mockResolvedValue([
      {
        id: 55,
        facilityId: 10,
        itemCode: 'SYN-MED',
        name: 'Synthetic medicine',
        genericName: '',
        category: 'Pharmaceuticals',
        unit: 'Tablet',
        currentStock: 5,
        reorderLevel: 1,
        unitCost: '3.00',
        sellingPrice: '7.50',
        storeLocation: 'Synthetic shelf',
        isActive: true,
        priceRevision: 1,
        updatedAt: '2026-11-01T12:00:00.000Z',
      },
    ]);
    mocked.api.getInventoryBatches.mockResolvedValue([]);
    mocked.api.getExpirySummary.mockResolvedValue({
      expiredBatches: 0,
      expiringBatches: 0,
      expiredUnits: 0,
      expiringUnits: 0,
      affectedItems: 0,
      horizonDays: 30,
    });
    mocked.api.updateInventorySellingPrice.mockResolvedValue({ id: 55 });
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('submits an audited price change with the loaded revision, never a dispensing price', async () => {
    const user = userEvent.setup();
    render(<InventoryModule />);
    await user.click(
      await screen.findByRole('button', { name: 'Change price for Synthetic medicine' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Change inventory selling price' });
    expect(dialog).toHaveTextContent(
      'Existing dispensed medicine lines retain their original prices',
    );
    await user.clear(within(dialog).getByLabelText('Selling price'));
    await user.type(within(dialog).getByLabelText('Selling price'), '12.50');
    await user.type(
      within(dialog).getByLabelText('Reason for price change'),
      'Synthetic reviewed update',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save price' }));
    await waitFor(() =>
      expect(mocked.api.updateInventorySellingPrice).toHaveBeenCalledWith(55, {
        facilityId: 10,
        sellingPrice: '12.50',
        expectedPriceRevision: 1,
        reason: 'Synthetic reviewed update',
      }),
    );
    expect(mocked.context.triggerRefresh).toHaveBeenCalled();
  });

  it('shows a stale-write error and does not report a successful change', async () => {
    mocked.api.updateInventorySellingPrice.mockRejectedValueOnce(
      new Error('Inventory changed; reload before saving.'),
    );
    const user = userEvent.setup();
    render(<InventoryModule />);
    await user.click(
      await screen.findByRole('button', { name: 'Change price for Synthetic medicine' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Change inventory selling price' });
    await user.type(within(dialog).getByLabelText('Reason for price change'), 'Synthetic review');
    await user.click(within(dialog).getByRole('button', { name: 'Save price' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Inventory changed');
    expect(mocked.context.triggerRefresh).not.toHaveBeenCalled();
  });

  it('shows unknown and zero-cost lots as unconfirmed and calculates known values in cents', async () => {
    mocked.api.getInventoryBatches.mockResolvedValue(
      [
        { id: 1, batchNumber: 'UNKNOWN-LOT', costPerUnit: null },
        { id: 2, batchNumber: 'ZERO-LOT', costPerUnit: '0.00' },
        { id: 3, batchNumber: 'KNOWN-LOT', costPerUnit: '0.29' },
      ].map((batch) => ({
        ...batch,
        itemId: 55,
        itemCode: 'SYN-MED',
        itemName: 'Synthetic medicine',
        unit: 'Tablet',
        expiryDate: '2099-12-31',
        quantityRemaining: 3,
        daysToExpiry: 999,
        status: 'OK',
      })),
    );
    const user = userEvent.setup();
    render(<InventoryModule />);
    await user.click(await screen.findByRole('tab', { name: /Batches & Expiry/ }));
    await screen.findByText('UNKNOWN-LOT');
    const rowFor = (name: string) => {
      const row = screen.getByText(name).closest('tr');
      if (!row) throw new Error('Synthetic batch row not found');
      return within(row);
    };
    expect(rowFor('UNKNOWN-LOT').getByText('Unknown')).toBeInTheDocument();
    expect(rowFor('UNKNOWN-LOT').getByText('Unconfirmed')).toBeInTheDocument();
    expect(rowFor('ZERO-LOT').getByText('Zero or unpriced')).toBeInTheDocument();
    expect(rowFor('ZERO-LOT').getByText('Unconfirmed')).toBeInTheDocument();
    expect(rowFor('KNOWN-LOT').getByText('KES 0.29')).toBeInTheDocument();
    expect(rowFor('KNOWN-LOT').getByText('KES 0.87')).toBeInTheDocument();
  });

  it('blocks simultaneous submissions in this tab and warns that an uncertain result needs review', async () => {
    let rejectRequest: (reason?: unknown) => void = () => {};
    mocked.api.receiveBatch.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    const user = userEvent.setup();
    render(<InventoryModule />);
    await screen.findByText('Synthetic medicine');
    await user.click(await screen.findByRole('button', { name: 'Receive Batch' }));
    const dialog = screen.getByRole('dialog', { name: 'Receive Stock into a Batch' });
    expect(dialog).toHaveTextContent('different identities are not automatically deduplicated');
    expect(dialog).toHaveTextContent('Independent receipt approval is not yet available');
    await user.selectOptions(within(dialog).getByLabelText('Stock Item'), '55');
    await user.type(within(dialog).getByLabelText('Batch Number'), 'SYN-LOT');
    await user.type(within(dialog).getByLabelText('Expiry Date'), '2099-12-31');
    await user.type(within(dialog).getByLabelText('Quantity'), '3');
    await user.type(within(dialog).getByLabelText('Cost per Unit (KES)'), '7.50');
    await user.click(within(dialog).getByRole('button', { name: 'Receive Stock' }));
    expect(within(dialog).getByRole('button', { name: 'Recording…' })).toBeDisabled();
    const form = dialog.querySelector('#inventory-receive-form');
    if (!form) throw new Error('Receipt form missing');
    fireEvent.submit(form);
    expect(mocked.api.receiveBatch).toHaveBeenCalledTimes(1);
    rejectRequest(new Error('Synthetic network failure'));
    await waitFor(() =>
      expect(mocked.context.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Review the batch and audit records before trying again.'),
        { tone: 'warning' },
      ),
    );
    expect(mocked.context.triggerRefresh).not.toHaveBeenCalled();
    const firstKey = mocked.api.receiveBatch.mock.calls[0][1].idempotencyKey as string;
    const retained = window.localStorage.getItem('jalicare:inventory:receipt:7:10');
    expect(retained).toContain(firstKey);
    expect(retained).not.toContain('SYN-LOT');
    expect(retained).not.toContain('7.50');
    mocked.api.receiveBatch.mockResolvedValueOnce({
      received: 3,
      batch: { batchNumber: 'SYN-LOT', expiryDate: '2099-12-31' },
      expiryMismatch: null,
      receiptId: 11,
      replayed: true,
    });
    await user.click(within(dialog).getByRole('button', { name: 'Receive Stock' }));
    await waitFor(() => expect(mocked.api.receiveBatch).toHaveBeenCalledTimes(2));
    expect(mocked.api.receiveBatch.mock.calls[1][1].idempotencyKey).toBe(firstKey);
    await waitFor(() =>
      expect(window.localStorage.getItem('jalicare:inventory:receipt:7:10')).toBeNull(),
    );
    expect(mocked.context.showToast).toHaveBeenCalledWith(
      expect.stringContaining('Previous receipt retrieved:'),
    );
  });

  it('reports an uncertain opening receipt without suggesting a second receipt', async () => {
    mocked.api.createInventoryItem.mockResolvedValueOnce({ id: 99 });
    mocked.api.receiveBatch.mockRejectedValueOnce(new Error('Synthetic response lost'));
    const user = userEvent.setup();
    render(<InventoryModule />);
    await screen.findByText('Synthetic medicine');
    await user.click(screen.getByRole('button', { name: 'Add Stock Item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Inventory Stock Item' });
    await user.type(within(dialog).getByLabelText(/Item Code/), 'SYN-OPEN');
    await user.type(within(dialog).getByLabelText(/Trade \/ Brand Name/), 'Synthetic opening item');
    await user.type(within(dialog).getByLabelText('Initial Stock Quantity'), '3');
    await user.type(within(dialog).getByLabelText('Reorder Level Alert'), '1');
    await user.type(within(dialog).getByLabelText('Batch Number'), 'SYN-OPEN-LOT');
    await user.type(within(dialog).getByLabelText('Expiry Date'), '2099-12-31');
    await user.type(within(dialog).getByLabelText('Unit Cost (KES)'), '7.50');
    await user.click(within(dialog).getByRole('button', { name: 'Save Stock Item' }));
    await waitFor(() =>
      expect(mocked.context.showToast).toHaveBeenCalledWith(
        expect.stringMatching(
          /item was created.*result could not be confirmed.*Review batch and audit records/,
        ),
        { tone: 'warning' },
      ),
    );
    expect(mocked.api.createInventoryItem).toHaveBeenCalledWith(
      expect.objectContaining({ facilityId: 10, currentStock: 0, unitCost: '7.50' }),
    );
    expect(mocked.api.receiveBatch).toHaveBeenCalledTimes(1);
    expect(mocked.api.receiveBatch).toHaveBeenCalledWith(99, {
      facilityId: 10,
      batchNumber: 'SYN-OPEN-LOT',
      expiryDate: '2099-12-31',
      quantity: 3,
      costPerUnit: '7.50',
      idempotencyKey: expect.any(String),
    });
    expect(mocked.context.triggerRefresh).toHaveBeenCalled();
    expect(
      screen.queryByRole('dialog', { name: 'Add Inventory Stock Item' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a not-found retry until an audited cancellation fences delayed receipt requests', async () => {
    window.localStorage.setItem(
      'jalicare:inventory:receipt:7:10',
      JSON.stringify({
        key: 'synthetic-pending-receipt',
        itemId: 55,
        fingerprint: 'a'.repeat(64),
      }),
    );
    mocked.api.checkInventoryReceiptRequest.mockResolvedValueOnce({ status: 'NOT_FOUND' });
    mocked.api.cancelInventoryReceiptRetry.mockResolvedValueOnce({
      status: 'CANCELLED',
      receiptId: 42,
    });
    const user = userEvent.setup();
    render(<InventoryModule />);
    await user.click(await screen.findByRole('button', { name: 'Check receipt status' }));
    await waitFor(() =>
      expect(mocked.context.showToast).toHaveBeenCalledWith(
        expect.stringContaining('A delayed request may still arrive'),
        { tone: 'warning' },
      ),
    );
    expect(window.localStorage.getItem('jalicare:inventory:receipt:7:10')).not.toBeNull();
    await user.type(
      screen.getByLabelText('Reason to close an unrecorded retry'),
      'Synthetic review',
    );
    await user.click(screen.getByRole('button', { name: 'Close retry identity' }));
    await waitFor(() =>
      expect(mocked.api.cancelInventoryReceiptRetry).toHaveBeenCalledWith({
        facilityId: 10,
        idempotencyKey: 'synthetic-pending-receipt',
        reason: 'Synthetic review',
      }),
    );
    await waitFor(() =>
      expect(window.localStorage.getItem('jalicare:inventory:receipt:7:10')).toBeNull(),
    );
    expect(mocked.api.receiveBatch).not.toHaveBeenCalled();
    expect(mocked.context.showToast).toHaveBeenCalledWith(
      expect.stringContaining('no recorded stock was reversed'),
    );
  });

  it('refuses a recorded receipt status that does not match the pending item', async () => {
    window.localStorage.setItem(
      'jalicare:inventory:receipt:7:10',
      JSON.stringify({
        key: 'synthetic-pending-receipt',
        itemId: 55,
        fingerprint: 'b'.repeat(64),
      }),
    );
    mocked.api.checkInventoryReceiptRequest.mockResolvedValueOnce({
      status: 'RECORDED',
      receiptId: 99,
      itemId: 56,
      quantity: 3,
    });
    const user = userEvent.setup();
    render(<InventoryModule />);
    await user.click(await screen.findByRole('button', { name: 'Check receipt status' }));
    await waitFor(() =>
      expect(mocked.context.showToast).toHaveBeenCalledWith(
        expect.stringContaining('does not match the pending item'),
        { tone: 'warning' },
      ),
    );
    expect(window.localStorage.getItem('jalicare:inventory:receipt:7:10')).not.toBeNull();
    expect(mocked.context.triggerRefresh).not.toHaveBeenCalled();
  });

  it('does not offer price changes without both inventory and facility finance permission', async () => {
    mocked.context.authenticatedUser.permissions = ['inventory.manage'];
    const user = userEvent.setup();
    render(<InventoryModule />);
    expect(await screen.findByText('Synthetic medicine')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Change price for Synthetic medicine' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Stock Item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Inventory Stock Item' });
    expect(within(dialog).getByLabelText('Selling Price (KES)')).toBeDisabled();
    expect(mocked.api.updateInventorySellingPrice).not.toHaveBeenCalled();
  });
});
