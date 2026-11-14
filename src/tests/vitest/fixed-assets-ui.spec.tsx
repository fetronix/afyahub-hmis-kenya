// @vitest-environment jsdom
/**
 * Fixed-asset register: impairment, revaluation and tax configuration screens.
 *
 * The backend specs prove the postings are correct. This file proves the path an
 * accountant actually takes — that the write-off buttons exist only for someone
 * with the authority to use them, that the dialogs assemble the payload the API
 * expects, and that the tax panel reports an unconfigured asset as unconfigured
 * rather than showing a number nobody can justify.
 *
 * The API client is mocked; all values are synthetic.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  client: {
    getAssetOverview: vi.fn(),
    getAssetCategories: vi.fn(),
    getAssets: vi.fn(),
    getMaintenance: vi.fn(),
    getAssetOptions: vi.fn(),
    getAssetRegisterReport: vi.fn(),
    getTaxRates: vi.fn(),
    getTaxSchedule: vi.fn(),
    createTaxRate: vi.fn(),
    getAssetDetail: vi.fn(),
    impairAsset: vi.fn(),
    revalueAsset: vi.fn(),
    disposeAsset: vi.fn(),
  },
  context: {
    authenticatedUser: { permissions: ['assets.read', 'assets.dispose'] },
    currentFacility: { id: 12, name: 'Synthetic Facility' },
    showToast: vi.fn(),
    refreshKey: 0,
    triggerRefresh: vi.fn(),
  },
}));

vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/clients/fixed-assets.client.ts', () => ({
  fixedAssetsClient: mocks.client,
}));

import { FixedAssetsModule } from '../../components/modules/FixedAssetsModule.tsx';

const asset = {
  id: 501,
  assetCode: 'AST-1',
  assetName: 'Synthetic scanner',
  category: 'Medical equipment',
  categoryId: 3,
  departmentId: null,
  departmentName: null,
  location: 'Imaging',
  custodianEmployeeId: null,
  custodianName: null,
  serialNumber: null,
  acquisitionDate: '2026-01-10',
  acquisitionCostKes: '240000.00',
  accumulatedDepreciationKes: '20000.00',
  netBookValueKes: '220000.00',
  usefulLifeMonths: 24,
  status: 'ACTIVE' as const,
  condition: 'GOOD',
};

const accounts = [
  { id: 7, code: 'FA-5600', name: 'Impairment loss', accountType: 'EXPENSE' },
  { id: 8, code: 'FA-3100', name: 'Revaluation surplus', accountType: 'EQUITY' },
];

beforeEach(() => {
  mocks.client.getAssetOverview.mockResolvedValue({
    assetCount: 1,
    activeCount: 1,
    disposedCount: 0,
    costCents: '24000000',
    accumulatedCents: '2000000',
    netBookCents: '22000000',
    impairmentCents: '0',
    revaluationReserveCents: '0',
    plannedMaintenance: 0,
    categories: [],
  });
  mocks.client.getAssetCategories.mockResolvedValue([]);
  mocks.client.getAssets.mockResolvedValue({ rows: [asset], page: 1, pageSize: 25, total: 1 });
  mocks.client.getMaintenance.mockResolvedValue([]);
  mocks.client.getAssetOptions.mockResolvedValue({ accounts, departments: [], employees: [] });
  mocks.client.getAssetRegisterReport.mockResolvedValue([
    {
      category: 'Medical equipment',
      assetCount: 1,
      costCents: '24000000',
      accumulatedCents: '2000000',
      netBookCents: '22000000',
      impairmentCents: '0',
      revaluationReserveCents: '0',
    },
  ]);
  mocks.client.getTaxRates.mockResolvedValue([]);
  mocks.client.getAssetDetail.mockResolvedValue({
    asset,
    movements: [],
    maintenance: [],
    transfers: [],
  });
  mocks.client.impairAsset.mockResolvedValue({
    journalNumber: 'JE-900',
    impairmentCents: '4000000',
    netBookValueAfterCents: '18000000',
  });
  mocks.client.revalueAsset.mockResolvedValue({
    journalNumber: 'JE-901',
    direction: 'UP',
    movementCents: '2000000',
    revaluationReserveCents: '2000000',
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openAsset() {
  const user = userEvent.setup();
  render(<FixedAssetsModule />);
  await waitFor(() => expect(mocks.client.getAssets).toHaveBeenCalled());
  /* The register row opens the drawer through its View button, not by clicking
     the name — matching what a user actually does. */
  await screen.findByText('Synthetic scanner');
  await user.click(screen.getByRole('button', { name: /^view$/i }));
  await screen.findByRole('dialog');
  return user;
}

describe('fixed assets — impairment and revaluation', () => {
  it('impairs an asset and sends the amount, loss account and reason', async () => {
    const user = await openAsset();
    await user.click(await screen.findByRole('button', { name: /impair/i }));

    /* The detail drawer stays open behind the adjustment dialog. */
    const dialogs = await screen.findAllByRole('dialog');
    const dialog = dialogs[dialogs.length - 1];
    await user.type(within(dialog).getByLabelText(/impairment \(KES\)/i), '40000');
    await user.selectOptions(
      within(dialog).getByLabelText(/impairment loss account/i),
      String(accounts[0].id),
    );
    await user.type(within(dialog).getByLabelText(/reason/i), 'Tube degraded');

    await user.click(within(dialog).getByRole('button', { name: /post impairment/i }));

    await waitFor(() => expect(mocks.client.impairAsset).toHaveBeenCalledTimes(1));
    const [facilityId, assetId, body] = mocks.client.impairAsset.mock.calls[0];
    expect(facilityId).toBe(12);
    expect(assetId).toBe(501);
    expect(body).toMatchObject({
      amountKes: '40000',
      lossAccountId: accounts[0].id,
      reason: 'Tube degraded',
    });
  });

  it('revalues an asset and reports the direction from the server', async () => {
    const user = await openAsset();
    await user.click(await screen.findByRole('button', { name: /revalue/i }));

    /* The detail drawer stays open behind the adjustment dialog. */
    const dialogs = await screen.findAllByRole('dialog');
    const dialog = dialogs[dialogs.length - 1];
    await user.type(within(dialog).getByLabelText(/revalued carrying amount/i), '250000');
    await user.selectOptions(
      within(dialog).getByLabelText(/revaluation surplus account/i),
      String(accounts[1].id),
    );
    await user.type(within(dialog).getByLabelText(/reason/i), 'Independent valuation');

    await user.click(within(dialog).getByRole('button', { name: /post revaluation/i }));

    await waitFor(() => expect(mocks.client.revalueAsset).toHaveBeenCalledTimes(1));
    const [, , body] = mocks.client.revalueAsset.mock.calls[0];
    expect(body).toMatchObject({
      revaluedAmountKes: '250000',
      surplusAccountId: accounts[1].id,
    });
    await waitFor(() =>
      expect(mocks.context.showToast).toHaveBeenCalledWith(
        expect.stringContaining('JE-901'),
        expect.objectContaining({ tone: 'success' }),
      ),
    );
  });

  it('will not post an impairment without an account or a reason', async () => {
    const user = await openAsset();
    await user.click(await screen.findByRole('button', { name: /impair/i }));
    /* The detail drawer stays open behind the adjustment dialog. */
    const dialogs = await screen.findAllByRole('dialog');
    const dialog = dialogs[dialogs.length - 1];
    await user.type(within(dialog).getByLabelText(/impairment \(KES\)/i), '40000');
    /* No account, no reason — the submit stays disabled rather than posting a
       write-down with no explanation attached to it. */
    expect(within(dialog).getByRole('button', { name: /post impairment/i })).toBeDisabled();
  });

  it('hides both buttons from a user who may read but not write down assets', async () => {
    mocks.context.authenticatedUser.permissions = ['assets.read'];
    const user = userEvent.setup();
    render(<FixedAssetsModule />);
    await waitFor(() => expect(mocks.client.getAssets).toHaveBeenCalled());
    await screen.findByText('Synthetic scanner');
    await user.click(screen.getByRole('button', { name: /^view$/i }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: /^impair$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^revalue$/i })).toBeNull();
    mocks.context.authenticatedUser.permissions = ['assets.read', 'assets.dispose'];
  });
});

describe('fixed assets — tax allowance', () => {
  it('shows an unconfigured asset as unconfigured instead of a number', async () => {
    mocks.client.getTaxSchedule.mockResolvedValue([
      {
        assetId: 501,
        assetCode: 'AST-1',
        assetName: 'Synthetic scanner',
        status: 'NO_CONFIGURED_RATE',
        annualAllowanceCents: null,
        note: 'No tax rate is configured for this asset.',
      },
    ]);
    const user = userEvent.setup();
    render(<FixedAssetsModule />);
    await waitFor(() => expect(mocks.client.getAssets).toHaveBeenCalled());

    await user.click(screen.getByRole('tab', { name: /depreciation & values/i }));
    await user.click(await screen.findByRole('button', { name: /compute for/i }));

    await waitFor(() => expect(mocks.client.getTaxSchedule).toHaveBeenCalled());
    const table = await screen.findByText('Synthetic scanner');
    expect(table).toBeTruthy();
    expect(await screen.findByText('NO_CONFIGURED_RATE')).toBeTruthy();
    expect(await screen.findByText(/not configured — no rate applied/i)).toBeTruthy();
  });

  it('requires an authority citation before a rate can be saved', async () => {
    mocks.context.authenticatedUser.permissions = ['assets.read', 'assets.manage'];
    const user = userEvent.setup();
    render(<FixedAssetsModule />);
    await waitFor(() => expect(mocks.client.getAssets).toHaveBeenCalled());

    await user.click(screen.getByRole('tab', { name: /depreciation & values/i }));
    await user.click(await screen.findByRole('button', { name: /record rate/i }));

    /* The detail drawer stays open behind the adjustment dialog. */
    const dialogs = await screen.findAllByRole('dialog');
    const dialog = dialogs[dialogs.length - 1];
    await user.type(within(dialog).getByLabelText(/rate name/i), 'Synthetic rate');
    await user.type(within(dialog).getByLabelText(/annual rate/i), '12.5');
    /* No authority reference yet. */
    expect(within(dialog).getByRole('button', { name: /save rate/i })).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/authority reference/i), 'Synthetic TN-2026-01');
    const save = within(dialog).getByRole('button', { name: /save rate/i });
    expect(save).not.toBeDisabled();
    await user.click(save);

    await waitFor(() => expect(mocks.client.createTaxRate).toHaveBeenCalledTimes(1));
    const [, body] = mocks.client.createTaxRate.mock.calls[0];
    expect(body).toMatchObject({
      name: 'Synthetic rate',
      annualRateBps: 1250,
      authorityReference: 'Synthetic TN-2026-01',
    });
  });
});
