// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanningReset } from '../../components/modules/planning/PlanningReset.tsx';
import { PlanningWorkspace } from '../../components/modules/planning/PlanningWorkspace.tsx';
import type { ResetCounts } from '../../budget-planning/reset-contract.ts';
const api = vi.hoisted(() => ({ get: vi.fn(), send: vi.fn() }));
vi.mock('../../api/clients/planning.client.ts', async (original) => ({
  ...(await original<typeof import('../../api/clients/planning.client.ts')>()),
  planningApi: api,
}));
const plan = {
  id: 41,
  name: 'Synthetic annual plan',
  financial_year: 2026,
  status: 'DRAFT',
  version: 9,
  plan_type: 'MIXED',
  currency: 'KES',
  inflation_bp: 0,
};
const inventory = {
  facility: { id: 7, name: 'Synthetic facility' },
  plans: [
    {
      ...plan,
      stationery: 1,
      branding: 1,
      uniforms: 1,
      months: 24,
      imported: 2,
      manual: 1,
      eligible: true,
      disposable: false,
      retentionReason: 'Audit history retained',
    },
    {
      ...plan,
      id: 42,
      name: 'Approved plan',
      eligible: false,
      status: 'APPROVED',
      retentionReason: 'Protected',
    },
  ],
  batches: [
    { id: 3, filename: 'Synthetic.csv', status: 'IMPORTED', created_at: '2026-10-27T12:00:00Z' },
  ],
};
const counts: ResetCounts = {
  stationery: 1,
  branding: 1,
  uniforms: 1,
  months: 24,
  categories: 0,
  plans: 0,
  imported: 2,
  manual: 1,
};
const preview = {
  facility: inventory.facility,
  selection: { planIds: [41] },
  reason: 'Clear synthetic planning exercise',
  counts,
  planIdsToDelete: [],
  retainedPlans: [{ id: 41, reason: 'Audit history retained' }],
  token: 'server-signed-preview',
  expiresAt: '2026-10-27T12:10:00Z',
};
async function review() {
  await screen.findByText('Authenticated facility: Synthetic facility (#7)');
  fireEvent.click(screen.getByLabelText('Select plan Synthetic annual plan'));
  fireEvent.click(screen.getByLabelText('Stationery & consumables records'));
  fireEvent.change(screen.getByLabelText('Reset reason'), {
    target: { value: 'Clear synthetic planning exercise' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview reset — no changes' }));
  return screen.findByRole('region', { name: 'Reset confirmation preview' });
}
describe('safe planning reset interface', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.send.mockReset();
    api.get.mockResolvedValue(inventory);
    api.send.mockResolvedValue(preview);
  });
  afterEach(cleanup);
  it('only reads inventory on load and selection; shows facility, statuses and protected plans', async () => {
    render(<PlanningReset facilityId={7} onReset={() => {}} />);
    await screen.findByText('Authenticated facility: Synthetic facility (#7)');
    expect(screen.getByLabelText('Select plan Approved plan')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Select plan Synthetic annual plan'));
    fireEvent.click(screen.getByLabelText('Stationery & consumables records'));
    expect(api.send).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledWith(7, '/reset');
    expect(screen.getByText(/Synthetic.csv/)).toHaveTextContent('IMPORTED');
  });
  it('requires explicit preview and exact typed confirmation before execution', async () => {
    render(<PlanningReset facilityId={7} onReset={() => {}} />);
    await review();
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(api.send.mock.calls[0][1]).toBe('/reset/preview');
    const confirm = screen.getByRole('button', { name: 'Confirm Reset Planning Data' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type RESET PLANNING DATA'), {
      target: { value: 'reset planning data' },
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type RESET PLANNING DATA'), {
      target: { value: 'RESET PLANNING DATA' },
    });
    expect(confirm).toBeEnabled();
    expect(api.send).toHaveBeenCalledTimes(1);
  });
  it('invalidates review on selection and reason changes and allows cancellation without mutation', async () => {
    render(<PlanningReset facilityId={7} onReset={() => {}} />);
    await review();
    fireEvent.click(screen.getByLabelText('Branding records'));
    expect(
      screen.queryByRole('region', { name: 'Reset confirmation preview' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview reset — no changes' }));
    await screen.findByLabelText('Type RESET PLANNING DATA');
    fireEvent.change(screen.getByLabelText('Reset reason'), {
      target: { value: 'A different reviewed reason' },
    });
    expect(screen.queryByLabelText('Type RESET PLANNING DATA')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview reset — no changes' }));
    await screen.findByLabelText('Type RESET PLANNING DATA');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reset preview' }));
    expect(api.send.mock.calls.every((c) => c[1] === '/reset/preview')).toBe(true);
  });
  it('uses only committed server counts, refreshes inventory and signals workspace refresh after execution', async () => {
    const onReset = vi.fn();
    render(<PlanningReset facilityId={7} onReset={onReset} />);
    await review();
    api.send.mockResolvedValueOnce({
      eventId: 100,
      facilityId: 7,
      actorId: 5,
      committedAt: '2026-10-27T12:01:00Z',
      counts: { ...counts, months: 12 },
    });
    fireEvent.change(screen.getByLabelText('Type RESET PLANNING DATA'), {
      target: { value: 'RESET PLANNING DATA' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reset Planning Data' }));
    const receipt = await screen.findByRole('status', { name: 'Committed reset receipt' });
    expect(receipt).toHaveTextContent('12');
    expect(receipt).toHaveTextContent('audit event #100');
    expect(api.send).toHaveBeenLastCalledWith(7, '/reset/execute', {
      token: preview.token,
      confirmation: 'RESET PLANNING DATA',
    });
    expect(onReset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });
  it('does not claim success or rollback from a network failure and removes reusable confirmation', async () => {
    const onReset = vi.fn();
    render(<PlanningReset facilityId={7} onReset={onReset} />);
    await review();
    api.send.mockRejectedValueOnce(new Error('Connection lost'));
    fireEvent.change(screen.getByLabelText('Type RESET PLANNING DATA'), {
      target: { value: 'RESET PLANNING DATA' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reset Planning Data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'check audit history before any retry',
    );
    expect(screen.queryByText('Planning reset committed')).not.toBeInTheDocument();
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Type RESET PLANNING DATA')).not.toBeInTheDocument();
  });
  it('keeps reset settings hidden without reset permission', async () => {
    api.get.mockResolvedValue({ plans: [], total: 0 });
    render(
      <PlanningWorkspace
        facilityId={7}
        view="planningPlans"
        permissions={['accounting.planning.read', 'accounting.planning.manage']}
        onNavigate={() => {}}
      />,
    );
    await screen.findByText(/No plan selected/);
    expect(screen.queryByRole('button', { name: 'Reset Planning Data' })).not.toBeInTheDocument();
    expect(api.get.mock.calls.every((c) => c[1] !== '/reset')).toBe(true);
    expect(api.send).not.toHaveBeenCalled();
  });
  for (const [view, label] of [
    ['planningItems', 'Add First Item — Stationery'],
    ['planningBranding', 'Add First Item — Branding'],
    ['planningUniforms', 'Add First Item — Uniform projection'],
  ] as const) {
    it(`shows empty ${view} with zero totals and manual creation without requiring imports`, async () => {
      const empty = {
        plan,
        categories: [
          { id: 1, name: 'OPD CONSUMABLES', is_active: true },
          { id: 2, name: 'BRANDING', is_active: true },
        ],
        items: [],
        uniforms: [],
        totalItems: 0,
        page: 1,
        summary: {},
        filters: { categoryId: null },
        facilityOverview: {},
      };
      api.get.mockImplementation((_f, path) =>
        Promise.resolve(path === '/plans' ? { plans: [plan], total: 1 } : empty),
      );
      render(
        <PlanningWorkspace
          facilityId={7}
          view={view}
          permissions={[
            'accounting.planning.read',
            'accounting.planning.manage',
            'accounting.planning.reset',
          ]}
          onNavigate={() => {}}
        />,
      );
      const first = await screen.findByRole('button', { name: label });
      expect(first).toBeEnabled();
      expect(screen.getByText(/0 matching records.*0.00/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'New annual plan' })).toBeEnabled();
      fireEvent.click(first);
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(api.send).not.toHaveBeenCalled();
      expect(api.get.mock.calls.every((c) => !c[1].includes('/imports'))).toBe(true);
    });
  }
});
