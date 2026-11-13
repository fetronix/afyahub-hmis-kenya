// @vitest-environment jsdom
/**
 * Approval-policy settings screen.
 *
 * The backend spec proves the rules are enforced. This file proves the screen an
 * administrator actually reaches: that it is reachable from facility settings,
 * that it loads and shows what the server returned, that it refuses to save a
 * malformed threshold, that it asks before writing, that a server refusal lands
 * beside the field that caused it, and that an account without the managing
 * permission sees the rules but no way to change them.
 *
 * Every value below is synthetic. The API client is mocked, so nothing here
 * claims a live database — that is what `approval-policy.db.spec.ts` is for.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  api: {
    listApprovalPolicies: vi.fn(),
    createApprovalPolicy: vi.fn(),
    updateApprovalPolicy: vi.fn(),
    previewApprovalRequirement: vi.fn(),
    /* The configuration module renders sibling tabs that call other endpoints. */
    getFacilities: vi.fn(),
    getTenants: vi.fn(),
    getFacilityModules: vi.fn(),
    getRbacRoles: vi.fn(),
    getStaffInvitations: vi.fn(),
    getFacilityServices: vi.fn(),
    getFacilityTariffs: vi.fn(),
    getPaymentHubConfig: vi.fn(),
    getPayerHubConfig: vi.fn(),
  },
  context: {
    currentFacility: { id: 10, name: 'Synthetic Facility', enabledModules: [], hiddenModules: [] },
    currentTenant: { id: 1, name: 'Synthetic Tenant' },
    authenticatedUser: {
      roles: ['FACILITY_ADMIN'],
      permissions: ['facilities.modules.manage'],
      isSuperAdmin: false,
    },
    showToast: vi.fn(),
    triggerRefresh: vi.fn(),
    setCurrentFacility: vi.fn(),
    setActiveModule: vi.fn(),
  },
}));

vi.mock('../../api/client.ts', () => ({ api: mocks.api }));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));

import {
  ApprovalPoliciesPanel,
  formatCents,
  parseAmountToCents,
} from '../../components/modules/ApprovalPoliciesPanel.tsx';
import { ConfigurationModule } from '../../components/modules/ConfigurationModule.tsx';
import { ApiError } from '../../api/clients/http.ts';

const policy = {
  id: 41,
  policyScope: 'PURCHASE_ORDER' as const,
  policyName: 'Executive authority above 500',
  minAmountCents: 50_000,
  requiredPermission: 'facilities.update',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  isActive: true,
  notes: null,
  createdByUserId: 7,
  createdByName: 'Synthetic Admin',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  for (const fn of Object.values(mocks.api)) fn.mockReset();
  mocks.context.showToast.mockReset();
  mocks.api.listApprovalPolicies.mockResolvedValue({ policies: [policy], activeCount: 1 });
  mocks.api.getFacilityModules.mockResolvedValue({ modules: [] });
  mocks.api.getRbacRoles.mockResolvedValue({ roles: [] });
  mocks.api.getStaffInvitations.mockResolvedValue({ invitations: [] });
  mocks.api.getFacilityServices.mockResolvedValue({ services: [] });
  mocks.api.getFacilityTariffs.mockResolvedValue({ tariffs: [] });
});

afterEach(() => cleanup());

describe('amount handling', () => {
  it('converts shillings to integer cents exactly, without float drift', () => {
    expect(parseAmountToCents('1250.50')).toBe(125_050);
    expect(parseAmountToCents('0.1')).toBe(10);
    expect(parseAmountToCents('50000')).toBe(5_000_000);
    expect(parseAmountToCents('1,250.5')).toBe(125_050);
  });

  it('rejects input that is not a plain amount rather than guessing', () => {
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('12.345')).toBeNull();
    expect(parseAmountToCents('12abc')).toBeNull();
    expect(parseAmountToCents('-5')).toBeNull();
    expect(parseAmountToCents('1e5')).toBeNull();
  });

  it('renders cents back as shillings', () => {
    expect(formatCents(50_000)).toBe('500.00');
    expect(formatCents(125_050)).toBe('1,250.50');
  });
});

describe('approval policy settings screen', () => {
  it('is reachable from facility settings', async () => {
    const user = userEvent.setup();
    render(<ConfigurationModule />);

    const tab = await screen.findByRole('button', { name: /approval policies/i });
    await user.click(tab);

    expect(await screen.findByText('Executive authority above 500')).toBeTruthy();
    expect(mocks.api.listApprovalPolicies).toHaveBeenCalledWith(10);
  });

  it('lists what the server returned, including the threshold and required authority', async () => {
    render(<ApprovalPoliciesPanel facilityId={10} canManage />);

    const row = (await screen.findByText('Executive authority above 500')).closest('tr')!;
    expect(within(row).getByText('Purchase order')).toBeTruthy();
    expect(within(row).getByText('500.00')).toBeTruthy();
    expect(within(row).getByText('facilities.update')).toBeTruthy();
    expect(within(row).getByText('ACTIVE')).toBeTruthy();
  });

  it('shows the empty state when the facility has no rules', async () => {
    mocks.api.listApprovalPolicies.mockResolvedValue({ policies: [], activeCount: 0 });
    render(<ApprovalPoliciesPanel facilityId={10} canManage />);

    expect(await screen.findByText('No approval thresholds')).toBeTruthy();
  });

  it('shows a load failure and offers a retry that re-requests', async () => {
    const user = userEvent.setup();
    mocks.api.listApprovalPolicies.mockRejectedValueOnce(new Error('Network unavailable'));
    render(<ApprovalPoliciesPanel facilityId={10} canManage />);

    expect(await screen.findByText(/Network unavailable/)).toBeTruthy();
    mocks.api.listApprovalPolicies.mockResolvedValue({ policies: [policy], activeCount: 1 });
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Executive authority above 500')).toBeTruthy();
  });

  it('refuses to submit an unparseable threshold and says why', async () => {
    const user = userEvent.setup();
    render(<ApprovalPoliciesPanel facilityId={10} canManage />);

    await user.click(await screen.findByRole('button', { name: /new rule/i }));
    await user.type(screen.getByLabelText('Rule name'), 'Synthetic rule');
    await user.type(screen.getByLabelText('From amount (KES)'), '12.345');
    await user.type(screen.getByLabelText('Required permission'), 'facilities.update');
    await user.click(screen.getByRole('button', { name: /review and save/i }));

    expect(await screen.findByText(/Enter the threshold in shillings/i)).toBeTruthy();
    /* Nothing was sent, so nothing can have been saved. */
    expect(mocks.api.createApprovalPolicy).not.toHaveBeenCalled();
  });

  it('asks for confirmation, names the change, and only then saves', async () => {
    const user = userEvent.setup();
    mocks.api.createApprovalPolicy.mockResolvedValue({
      policy: { ...policy, id: 42, policyName: 'Synthetic rule' },
    });
    render(<ApprovalPoliciesPanel facilityId={10} canManage />);

    await user.click(await screen.findByRole('button', { name: /new rule/i }));
    await user.type(screen.getByLabelText('Rule name'), 'Synthetic rule');
    await user.type(screen.getByLabelText('From amount (KES)'), '75000');
    await user.type(screen.getByLabelText('Required permission'), 'procurement.approve');
    await user.click(screen.getByRole('button', { name: /review and save/i }));

    /* The confirmation states the exact rule before anything is written. */
    const dialog = await screen.findByRole('dialog', { name: /create this approval rule/i });
    expect(within(dialog).getByText(/75,000.00/)).toBeTruthy();
    expect(mocks.api.createApprovalPolicy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: /create rule/i }));

    await waitFor(() => expect(mocks.api.createApprovalPolicy).toHaveBeenCalledTimes(1));
    expect(mocks.api.createApprovalPolicy).toHaveBeenCalledWith(10, {
      policyScope: 'PURCHASE_ORDER',
      policyName: 'Synthetic rule',
      minAmountCents: 7_500_000,
      requiredPermission: 'procurement.approve',
      effectiveFrom: expect.any(String),
      effectiveTo: null,
      notes: null,
    });
    expect(await screen.findByText('Synthetic rule')).toBeTruthy();
  });

  it('places a server refusal beside the field that caused it', async () => {
    const user = userEvent.setup();
    mocks.api.createApprovalPolicy.mockRejectedValue(
      new ApiError('No such permission in the catalogue.', 400, 'UNKNOWN_PERMISSION'),
    );
    render(<ApprovalPoliciesPanel facilityId={10} canManage />);

    await user.click(await screen.findByRole('button', { name: /new rule/i }));
    await user.type(screen.getByLabelText('Rule name'), 'Synthetic rule');
    await user.type(screen.getByLabelText('From amount (KES)'), '75000');
    await user.type(screen.getByLabelText('Required permission'), 'not.a.real.permission');
    await user.click(screen.getByRole('button', { name: /review and save/i }));
    const dialog = await screen.findByRole('dialog', { name: /create this approval rule/i });
    await user.click(within(dialog).getByRole('button', { name: /create rule/i }));

    expect(await screen.findByText(/No such permission in the catalogue/)).toBeTruthy();
    /* The rule was not added to the list as though it had saved. */
    expect(screen.queryByText('Synthetic rule')).toBeNull();
  });

  it('previews what a proposed amount would require', async () => {
    const user = userEvent.setup();
    mocks.api.previewApprovalRequirement.mockResolvedValue({
      scope: 'PURCHASE_ORDER',
      amountCents: 9_000_000,
      onDate: '2026-10-27',
      rule: {
        policyId: 41,
        policyName: 'Executive authority above 500',
        requiredPermission: 'facilities.update',
        minAmountCents: 50_000,
      },
      satisfied: false,
      note: 'Amounts from 500.00 KES need facilities.update.',
    });
    render(<ApprovalPoliciesPanel facilityId={10} canManage />);

    await user.type(await screen.findByLabelText('Amount (KES)'), '90000');
    await user.click(screen.getByRole('button', { name: /check amount/i }));

    await waitFor(() =>
      expect(mocks.api.previewApprovalRequirement).toHaveBeenCalledWith(10, {
        scope: 'PURCHASE_ORDER',
        amountCents: 9_000_000,
      }),
    );
    expect(await screen.findByText(/need facilities.update/i)).toBeTruthy();
    expect(await screen.findByText(/does not hold facilities.update/i)).toBeTruthy();
  });

  it('hides every writing control but still shows the rules to a reader', async () => {
    render(<ApprovalPoliciesPanel facilityId={10} canManage={false} />);

    expect(await screen.findByText('Executive authority above 500')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /new rule/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull();
    /* Reading stays useful: the reader is told why they cannot change it. */
    expect(screen.getByText(/You can view these thresholds but not change them/i)).toBeTruthy();
  });

  it('edits a rule through confirmation without offering to rewrite its threshold', async () => {
    const user = userEvent.setup();
    mocks.api.updateApprovalPolicy.mockResolvedValue({ policy: { ...policy, isActive: false } });
    render(<ApprovalPoliciesPanel facilityId={10} canManage />);

    await user.click(await screen.findByRole('button', { name: /^edit$/i }));

    /* The immutable fields are stated, not editable. */
    expect(await screen.findByText(/cannot be changed/i)).toBeTruthy();
    expect(screen.queryByLabelText(/threshold/i)).toBeNull();

    const active = screen.getByRole('checkbox');
    await user.click(active);
    await user.click(screen.getByRole('button', { name: /review and save/i }));

    const dialog = await screen.findByRole('dialog', { name: /save these changes/i });
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mocks.api.updateApprovalPolicy).toHaveBeenCalledTimes(1));
    expect(mocks.api.updateApprovalPolicy).toHaveBeenCalledWith(10, 41, {
      policyName: 'Executive authority above 500',
      effectiveTo: null,
      isActive: false,
      notes: null,
    });
  });
});
