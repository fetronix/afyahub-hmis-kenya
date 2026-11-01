// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocked = vi.hoisted(() => ({
  context: {
    currentFacility: { id: 10 },
    authenticatedUser: { id: 7, permissions: ['inventory.manage', 'billing.update'], isSuperAdmin: false },
    showToast: vi.fn(), refreshKey: 0, triggerRefresh: vi.fn(),
  },
  api: {
    getInventory: vi.fn(), getInventoryBatches: vi.fn(), getExpirySummary: vi.fn(),
    updateInventorySellingPrice: vi.fn(), createInventoryItem: vi.fn(), receiveBatch: vi.fn(),
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocked.context }));
vi.mock('../../api/client.ts', () => ({ api: mocked.api }));
import { InventoryModule } from '../../components/modules/InventoryModule.tsx';

describe('Facility inventory selling-price controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.context.authenticatedUser = { id: 7, permissions: ['inventory.manage', 'billing.update'], isSuperAdmin: false };
    mocked.api.getInventory.mockResolvedValue([{
      id: 55, facilityId: 10, itemCode: 'SYN-MED', name: 'Synthetic medicine',
      genericName: '', category: 'Pharmaceuticals', unit: 'Tablet', currentStock: 5, reorderLevel: 1,
      unitCost: '3.00', sellingPrice: '7.50', storeLocation: 'Synthetic shelf',
      isActive: true, priceRevision: 1, updatedAt: '2026-11-01T12:00:00.000Z',
    }]);
    mocked.api.getInventoryBatches.mockResolvedValue([]);
    mocked.api.getExpirySummary.mockResolvedValue({ expiredBatches: 0, expiringBatches: 0, expiredUnits: 0, expiringUnits: 0, affectedItems: 0, horizonDays: 30 });
    mocked.api.updateInventorySellingPrice.mockResolvedValue({ id: 55 });
  });
  afterEach(cleanup);

  it('submits an audited price change with the loaded revision, never a dispensing price', async () => {
    const user = userEvent.setup();
    render(<InventoryModule />);
    await user.click(await screen.findByRole('button', { name: 'Change price for Synthetic medicine' }));
    const dialog = screen.getByRole('dialog', { name: 'Change inventory selling price' });
    expect(dialog).toHaveTextContent('Existing dispensed medicine lines retain their original prices');
    await user.clear(within(dialog).getByLabelText('Selling price'));
    await user.type(within(dialog).getByLabelText('Selling price'), '12.50');
    await user.type(within(dialog).getByLabelText('Reason for price change'), 'Synthetic reviewed update');
    await user.click(within(dialog).getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(mocked.api.updateInventorySellingPrice).toHaveBeenCalledWith(55, {
      facilityId: 10, sellingPrice: '12.50', expectedPriceRevision: 1, reason: 'Synthetic reviewed update',
    }));
    expect(mocked.context.triggerRefresh).toHaveBeenCalled();
  });

  it('shows a stale-write error and does not report a successful change', async () => {
    mocked.api.updateInventorySellingPrice.mockRejectedValueOnce(new Error('Inventory changed; reload before saving.'));
    const user = userEvent.setup();
    render(<InventoryModule />);
    await user.click(await screen.findByRole('button', { name: 'Change price for Synthetic medicine' }));
    const dialog = screen.getByRole('dialog', { name: 'Change inventory selling price' });
    await user.type(within(dialog).getByLabelText('Reason for price change'), 'Synthetic review');
    await user.click(within(dialog).getByRole('button', { name: 'Save price' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Inventory changed');
    expect(mocked.context.triggerRefresh).not.toHaveBeenCalled();
  });

  it('does not offer price changes without both inventory and facility finance permission', async () => {
    mocked.context.authenticatedUser.permissions = ['inventory.manage'];
    const user = userEvent.setup();
    render(<InventoryModule />);
    expect(await screen.findByText('Synthetic medicine')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change price for Synthetic medicine' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Stock Item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Inventory Stock Item' });
    expect(within(dialog).getByLabelText('Selling Price (KES)')).toBeDisabled();
    expect(mocked.api.updateInventorySellingPrice).not.toHaveBeenCalled();
  });
});
