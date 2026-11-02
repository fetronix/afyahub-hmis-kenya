// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocked = vi.hoisted(() => ({
  api: {
    getBedBillingPolicy: vi.fn(), setBedBillingPolicy: vi.fn(),
    getUnresolvedBedBilling: vi.fn(), getBedOccupancy: vi.fn(),
    linkBedBillingEncounter: vi.fn(), reviewBedHistory: vi.fn(), retryBedBilling: vi.fn(),
  },
}));
vi.mock('../../api/client.ts', () => ({ api: mocked.api }));
import { BedBillingPolicyPanel } from '../../components/modules/BedBillingPolicyPanel.tsx';
import { BedBillingRecovery } from '../../components/modules/BedBillingRecovery.tsx';

const view = {
  admissionId: 42,
  admission: { patientId: 12, encounterId: 19, admissionDate: 'synthetic client time', dischargeDate: 'synthetic discharge time', status: 'Discharged', wardId: 5, bedId: 6 },
  transfers: [], asOf: '2026-10-02T09:00:00.000Z', policy: null,
  staySnapshot: { timezoneSnapshot: 'Africa/Nairobi', cutoffMinutes: null, graceMinutes: null, sameDayRule: null, policyRevision: null, manualAdmissionTime: true, manualDischargeTime: false, capturedAt: '2026-10-01T09:00:00.000Z' },
  periods: [{ id: 8, wardId: 5, bedId: 6, startedAt: '2026-10-01T09:00:00.000Z', endedAt: '2026-10-02T09:00:00.000Z', dailyRateSnapshot: '100.00', bedNumberSnapshot: 'SYN-6', wardNameSnapshot: 'Synthetic ward' }],
  durationSeconds: 86400, nights: null, estimatedAmount: null,
  review: { code: 'BED_MANUAL_TIME_REVIEW_REQUIRED', message: 'A client-supplied clinical time needs an evidence-based bed billing review.' },
  unresolved: { attempts: [{ id: 77, idempotencySuffix: 'REVIEW', reason: 'BED_OCCUPANCY_REVIEW', diagnosisCode: 'BED_MANUAL_TIME_REVIEW_REQUIRED', attempts: 1, lastAttemptAt: '2026-10-02T09:00:00.000Z' }], hasMore: false, stagingPending: false },
};

describe('Inpatient bed policy and recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.api.getBedBillingPolicy.mockResolvedValue(null);
    mocked.api.setBedBillingPolicy.mockResolvedValue({ id: 1, facilityId: 2, tenantId: 1, cutoffMinutes: 360, graceMinutes: 30, sameDayRule: 'ONE', revision: 1 });
    mocked.api.getUnresolvedBedBilling.mockResolvedValue({ admissions: [{ admissionId: 42, admissionStatus: 'Discharged', pendingAttempts: 1, stagingPending: false }], hasMore: false, offset: 0, pageSize: 50 });
    mocked.api.getBedOccupancy.mockResolvedValue(view);
    mocked.api.retryBedBilling.mockResolvedValue({ nights: null, charges: [], review: view.review });
  });
  afterEach(cleanup);

  it('shows literal null as unconfigured and saves only an explicit facility policy', async () => {
    const user = userEvent.setup();
    render(<BedBillingPolicyPanel facilityId={2} canManage refreshKey={0} />);
    expect(await screen.findByText(/Bed-night billing policy — not configured/)).toBeInTheDocument();
    expect(mocked.api.getBedBillingPolicy).toHaveBeenCalledWith(2);
    await user.click(screen.getByText(/Bed-night billing policy — not configured/));
    await user.type(screen.getByLabelText('Facility-local cutoff'), '06:00');
    await user.type(screen.getByLabelText('Discharge grace minutes'), '30');
    await user.selectOptions(screen.getByLabelText('Same-day stay rule'), 'ONE');
    await user.type(screen.getByLabelText('Policy change reason'), 'Synthetic approved policy');
    await user.click(screen.getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(mocked.api.setBedBillingPolicy).toHaveBeenCalledWith({ facilityId: 2, cutoffMinutes: 360, graceMinutes: 30, sameDayRule: 'ONE', expectedRevision: null, reason: 'Synthetic approved policy' }));
    expect(await screen.findByText(/Existing stays retain their recorded policy/)).toBeInTheDocument();
  });

  it('does not mistake a failed policy read for an unconfigured policy', async () => {
    mocked.api.getBedBillingPolicy.mockRejectedValue(new Error('Synthetic unavailable'));
    render(<BedBillingPolicyPanel facilityId={2} canManage refreshKey={0} />);
    expect(await screen.findByText(/policy could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/unavailable or loading/)).toBeInTheDocument();
    expect(screen.queryByText(/— not configured/)).not.toBeInTheDocument();
  });

  it('discovers scoped unresolved bed work and shows captured evidence without inventing a tariff', async () => {
    const user = userEvent.setup();
    render(<BedBillingRecovery facilityId={2} canReview={false} canRetry />);
    await user.click(screen.getByText('Recover bed billing for an admission'));
    expect(await screen.findByText(/Admission #42 · Discharged · 1 pending/)).toBeInTheDocument();
    expect(mocked.api.getUnresolvedBedBilling).toHaveBeenCalledWith(2, 0);
    await user.click(screen.getByRole('button', { name: 'Inspect evidence' }));
    expect(await screen.findByText(/cutoff not captured/)).toBeInTheDocument();
    expect(screen.getByText(/admission yes, discharge no/i)).toBeInTheDocument();
    expect(screen.getByText(/captured rate KES 100.00/)).toBeInTheDocument();
    expect(screen.getByText(/BED_MANUAL_TIME_REVIEW_REQUIRED/)).toBeInTheDocument();
    expect(screen.queryByText(/configure the ward.s tariff/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Evidence-based historical bed review')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry this admission’s bed billing' }));
    await waitFor(() => expect(mocked.api.retryBedBilling).toHaveBeenCalledWith(42, 2));
    expect(await screen.findByRole('status')).toHaveTextContent('client-supplied clinical time');
    expect(mocked.api.reviewBedHistory).not.toHaveBeenCalled();
  });

  it('keeps the confirmed retry result visible if refreshing its evidence fails', async () => {
    mocked.api.getBedOccupancy.mockResolvedValueOnce(view).mockRejectedValueOnce(new Error('Synthetic refresh failure'));
    mocked.api.retryBedBilling.mockResolvedValue({ nights: 1, charges: [{ charged: true }], review: null });
    const user = userEvent.setup();
    render(<BedBillingRecovery facilityId={2} canReview={false} canRetry />);
    await user.click(screen.getByText('Recover bed billing for an admission'));
    await screen.findByText(/Admission #42/);
    await user.click(screen.getByRole('button', { name: 'Inspect evidence' }));
    await screen.findByRole('button', { name: 'Retry this admission’s bed billing' });
    await user.click(screen.getByRole('button', { name: 'Retry this admission’s bed billing' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 night(s) added');
    expect(screen.getByRole('status')).toHaveTextContent('Evidence could not be refreshed');
    expect(screen.queryByRole('button', { name: 'Retry this admission’s bed billing' })).not.toBeInTheDocument();
  });

  it('distinguishes an unstaged discharge from zero pending attempts', async () => {
    mocked.api.getUnresolvedBedBilling.mockResolvedValue({ admissions: [{ admissionId: 42, admissionStatus: 'Discharged', pendingAttempts: 0, stagingPending: true }], hasMore: false, offset: 0, pageSize: 50 });
    mocked.api.getBedOccupancy.mockResolvedValue({ ...view, unresolved: { attempts: [], hasMore: false, stagingPending: true } });
    const user = userEvent.setup();
    render(<BedBillingRecovery facilityId={2} canReview={false} canRetry />);
    await user.click(screen.getByText('Recover bed billing for an admission'));
    expect(await screen.findByText(/billing staging pending · 0 pending attempt/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Inspect evidence' }));
    expect(await screen.findByText(/Bed billing staging has not completed/)).toBeInTheDocument();
    expect(screen.getByText(/does not establish payment or completed staging/)).toBeInTheDocument();
  });

  it('reports a failed unresolved-work read instead of showing an empty result', async () => {
    mocked.api.getUnresolvedBedBilling.mockRejectedValue(new Error('Synthetic unavailable'));
    const user = userEvent.setup();
    render(<BedBillingRecovery facilityId={2} canReview={false} canRetry={false} />);
    await user.click(screen.getByText('Recover bed billing for an admission'));
    expect(await screen.findByRole('status')).toHaveTextContent('could not be loaded');
    expect(screen.queryByText(/No unresolved bed billing work on this page/)).not.toBeInTheDocument();
  });

  it('uses the scoped next and previous pages', async () => {
    mocked.api.getUnresolvedBedBilling.mockImplementation(async (_facilityId: number, offset: number) => offset === 0
      ? { admissions: [{ admissionId: 42, admissionStatus: 'Discharged', pendingAttempts: 1, stagingPending: false }], hasMore: true, offset: 0, pageSize: 50 }
      : { admissions: [{ admissionId: 43, admissionStatus: 'Discharged', pendingAttempts: 2, stagingPending: false }], hasMore: false, offset: 50, pageSize: 50 });
    const user = userEvent.setup();
    render(<BedBillingRecovery facilityId={2} canReview={false} canRetry={false} />);
    await user.click(screen.getByText('Recover bed billing for an admission'));
    await screen.findByText(/Admission #42 · Discharged/);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const item = await screen.findByText(/Admission #43 · Discharged/);
    expect(within(item.parentElement!).getByRole('button', { name: 'Inspect evidence' })).toBeInTheDocument();
    expect(mocked.api.getUnresolvedBedBilling).toHaveBeenLastCalledWith(2, 50);
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText(/Admission #42 · Discharged/)).toBeInTheDocument();
    expect(mocked.api.getUnresolvedBedBilling).toHaveBeenLastCalledWith(2, 0);
  });
});
