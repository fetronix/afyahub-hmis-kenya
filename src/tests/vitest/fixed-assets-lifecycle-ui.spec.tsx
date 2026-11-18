// @vitest-environment jsdom
/**
 * Fixed-asset lifecycle screens.
 *
 * Proves the behaviour an accountant relies on before trusting the screen:
 * an unsaved policy is announced rather than implied, a prepared batch cannot
 * be approved or posted by someone without the approval permission, a reversal
 * needs a reason, and a report export is generated from the rows on screen.
 *
 * The API client is mocked; all values are synthetic.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  client: {
    getAssetDashboard: vi.fn(),
    getDepreciationSettings: vi.fn(),
    getDepreciationBatches: vi.fn(),
    getDepreciationBatch: vi.fn(),
    previewDepreciationBatch: vi.fn(),
    prepareDepreciationBatch: vi.fn(),
    approveDepreciationBatch: vi.fn(),
    postDepreciationBatch: vi.fn(),
    reverseDepreciationBatch: vi.fn(),
    discardDepreciationBatch: vi.fn(),
    getAssetReports: vi.fn(),
    runAssetReport: vi.fn(),
    exportAssetReport: vi.fn(),
  },
  context: {
    authenticatedUser: { permissions: ['assets.read'] },
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

import {
  AssetDashboardPanel,
  DepreciationPanel,
  AssetReportsPanel,
} from '../../components/modules/fixed-assets/FixedAssetsPanels.tsx';

const props = {
  facilityId: 12,
  options: { accounts: [], departments: [], employees: [] },
  categories: [],
  assets: [],
  saving: false,
  can: (permission: string) => mocks.context.authenticatedUser.permissions.includes(permission),
  run: async (action: () => Promise<void>) => {
    await action();
  },
  notify: vi.fn(),
  refresh: async () => undefined,
  onOpenAsset: vi.fn(),
};

const batch = {
  id: 90,
  periodCode: '2026-11',
  entryDate: '2026-11-30',
  status: 'DRAFT' as const,
  totalCents: '1000000',
  assetCount: 1,
  preparedByUserId: 3,
  approvedByUserId: null,
  approvedAt: null,
  postedAt: null,
  journalEntryId: null,
  reversalJournalEntryId: null,
  reversalReason: null,
  notes: null,
  createdAt: '2026-11-30T00:00:00.000Z',
};

beforeEach(() => {
  mocks.client.getDepreciationSettings.mockResolvedValue({
    defaultUsefulLifeMonths: 120,
    defaultAnnualRateBps: 1000,
    depreciationCommencement: 'FULL_MONTH',
    depreciationApprovalRequired: true,
    financialYearStartMonth: 7,
    configured: false,
    updatedAt: null,
    postedBatchCount: 0,
    pendingBatchCount: 1,
    annualRateBpsForDefaultLife: 1000,
    monthlyRateBpsForDefaultLife: 83,
  });
  mocks.client.getDepreciationBatches.mockResolvedValue([batch]);
  mocks.client.getAssetReports.mockResolvedValue({
    reports: [
      {
        key: 'register',
        title: 'Fixed Asset Register',
        description: 'Every registered asset with cost and net book value.',
        needsPeriod: false,
        needsRange: true,
        columns: [
          { key: 'assetCode', label: 'Asset code' },
          { key: 'costCents', label: 'Cost', kind: 'money' },
        ],
      },
    ],
  });
  mocks.client.runAssetReport.mockResolvedValue({
    key: 'register',
    title: 'Fixed Asset Register',
    description: 'Every registered asset.',
    facilityName: 'Synthetic Facility',
    generatedAt: '2026-11-30T09:00:00.000Z',
    filterSummary: 'All recorded assets',
    columns: [
      { key: 'assetCode', label: 'Asset code' },
      { key: 'costCents', label: 'Cost', kind: 'money' },
    ],
    rows: [{ assetCode: 'AST-1', costCents: '1200000.00' }],
    totals: { assetCount: 1 },
    notes: [],
  });
  mocks.client.reverseDepreciationBatch.mockResolvedValue({
    ...batch,
    status: 'REVERSED',
    reversalJournalNumber: 'J-REV-1',
  });
  mocks.client.exportAssetReport.mockResolvedValue({
    filename: 'register.pdf',
    contentType: 'application/pdf',
    base64: btoa('%PDF-1.4 synthetic'),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('depreciation policy and batches', () => {
  it('announces an unsaved depreciation policy instead of implying one was approved', async () => {
    render(<DepreciationPanel {...props} />);
    expect(await screen.findByText(/has not saved a depreciation policy/i)).toBeTruthy();
    expect(screen.getAllByText(/full month/i).length).toBeGreaterThan(0);
  });

  it('shows the prepared batch but no approval action for a user without the permission', async () => {
    render(<DepreciationPanel {...props} />);
    expect(await screen.findByText('2026-11')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /post/i })).toBeNull();
  });

  it('offers approval to a user who holds the approval permission', async () => {
    mocks.context.authenticatedUser.permissions = [
      'assets.read',
      'assets.depreciate',
      'assets.depreciation.approve',
    ];
    render(<DepreciationPanel {...props} />);
    const approve = await screen.findByRole('button', { name: /approve/i });
    expect(approve).toBeTruthy();
  });

  it('requires a reason before reversing a posted batch', async () => {
    mocks.context.authenticatedUser.permissions = [
      'assets.read',
      'assets.depreciate',
      'assets.depreciation.approve',
    ];
    mocks.client.getDepreciationBatches.mockResolvedValue([
      { ...batch, status: 'POSTED', journalEntryId: 41 },
    ]);
    const user = userEvent.setup();
    render(<DepreciationPanel {...props} />);
    await user.click(await screen.findByRole('button', { name: /reverse/i }));
    const confirm = screen.getByRole('button', { name: /reverse batch/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText(/reason/i), 'Wrong period');
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    await user.click(confirm);
    await waitFor(() =>
      expect(mocks.client.reverseDepreciationBatch).toHaveBeenCalledWith(12, 90, 'Wrong period'),
    );
  });
});

describe('asset dashboard', () => {
  it('renders real counters and the overdue list', async () => {
    mocks.client.getAssetDashboard.mockResolvedValue({
      counters: {
        total: 4,
        inService: 3,
        underMaintenance: 1,
        impaired: 0,
        retired: 0,
        disposed: 1,
        costCents: '480000000',
        netBookCents: '300000000',
      },
      maintenance: {
        dueToday: [],
        overdue: [
          {
            id: 7,
            assetId: 501,
            assetCode: 'AST-1',
            assetName: 'Synthetic scanner',
            name: 'Quarterly service',
            frequency: 'QUARTERLY',
            intervalDays: null,
            nextDueDate: '2026-11-01',
            lastCompletedDate: null,
            instructions: null,
            responsibleDepartmentId: null,
            departmentName: null,
            assignedTechnician: null,
            vendor: null,
            estimatedCostCents: '0',
            isActive: true,
            status: 'OVERDUE' as const,
            daysUntilDue: -29,
          },
        ],
        upcoming: [],
        openCorrective: [],
        openPreventive: [],
        plannedInspections: [],
      },
      latestBatches: [],
    });
    render(<AssetDashboardPanel {...props} />);
    expect(await screen.findByText('4')).toBeTruthy();
    expect(screen.getByText(/quarterly service/i)).toBeTruthy();
    expect(screen.getAllByText(/overdue/i).length).toBeGreaterThan(0);
  });
});

describe('reports', () => {
  it('runs a report and exports exactly the rows shown', async () => {
    const user = userEvent.setup();
    render(<AssetReportsPanel {...props} />);
    await user.click(await screen.findByRole('button', { name: /run report/i }));
    expect(await screen.findByText('AST-1')).toBeTruthy();
    expect(mocks.client.runAssetReport).toHaveBeenCalledWith(12, 'register', {
      period: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      categoryId: undefined,
      departmentId: undefined,
      assetId: undefined,
    });
    await user.click(screen.getByRole('button', { name: /excel/i }));
    await waitFor(() =>
      expect(mocks.client.exportAssetReport).toHaveBeenCalledWith(12, 'register', 'xlsx', {
        period: undefined,
        dateFrom: undefined,
        dateTo: undefined,
        categoryId: undefined,
        departmentId: undefined,
        assetId: undefined,
      }),
    );
  });
});
