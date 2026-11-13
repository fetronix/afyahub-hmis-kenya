// @vitest-environment jsdom
/**
 * Dispatch review panel — the user-facing half of the UNCERTAIN-claim fix.
 *
 * Every value here is synthetic. The API clients are mocked; what is asserted is
 * that the panel cannot record a conclusion without evidence, cannot confirm
 * receipt without a payer reference, and never presents a local review as payer
 * acceptance.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  recordPrivate: vi.fn(),
  recordSha: vi.fn(),
  queuePrivate: vi.fn(),
  queueSha: vi.fn(),
}));

vi.mock('../../api/private-insurance.client.ts', () => ({
  privateInsuranceApi: {
    recordClaimDispatchReconciliation: mocks.recordPrivate,
    getDispatchReviews: mocks.queuePrivate,
  },
}));
vi.mock('../../api/sha-eclaims.client.ts', () => ({
  shaEclaimsApi: {
    recordClaimDispatchReconciliation: mocks.recordSha,
    getDispatchReviews: mocks.queueSha,
  },
}));

import {
  DispatchReviewPanel,
  DispatchReviewQueue,
} from '../../components/modules/insurance/DispatchReviewPanel.tsx';

const review = {
  id: 77,
  state: 'UNCERTAIN',
  attemptNumber: 2,
  correlationId: 'synthetic-correlation-0001',
  createdAt: '2026-10-27T08:00:00.000Z',
};

const renderPanel = (overrides: Partial<React.ComponentProps<typeof DispatchReviewPanel>> = {}) => {
  const notify = vi.fn();
  const onReconciled = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <DispatchReviewPanel
      workflow="SHA"
      facilityId={12}
      claimId={501}
      review={review}
      canReconcile
      notify={notify}
      onReconciled={onReconciled}
      {...overrides}
    />,
  );
  return { ...utils, notify, onReconciled };
};

beforeEach(() => {
  mocks.recordPrivate.mockReset();
  mocks.recordSha.mockReset();
  mocks.queuePrivate.mockReset();
  mocks.queueSha.mockReset();
});

afterEach(() => cleanup());

describe('DispatchReviewPanel', () => {
  it('renders nothing when there is no dispatch reservation', () => {
    const { container } = renderPanel({ review: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('states that the reservation is local and not payer acceptance', () => {
    renderPanel();
    const alert = screen.getByRole('alert', { name: 'Claim dispatch review' });
    expect(alert.textContent).toContain('attempt 2');
    expect(alert.textContent).toContain('UNCERTAIN');
    expect(alert.textContent).toContain('not payer acceptance, adjudication or payment');
    expect(alert.textContent).toContain('synthetic-correlation-0001');
  });

  it('gives a reviewer without reconciliation authority no way to clear the block', () => {
    renderPanel({ canReconcile: false });
    expect(screen.queryByRole('button', { name: /record dispatch review/i })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /user with claim reconciliation authority must check/i,
    );
  });

  it('requires an outcome and an evidence note before recording', async () => {
    const user = userEvent.setup();
    const { notify } = renderPanel();
    const submit = screen.getByRole('button', { name: /record dispatch review/i });
    expect(submit).toBeDisabled();

    await user.click(screen.getByLabelText(/checked, still unresolved/i));
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/what was checked/i), 'short');
    expect(submit).toBeDisabled();

    await user.type(
      screen.getByLabelText(/what was checked/i),
      ' for the SHA batch report of 2026-10-27',
    );
    expect(submit).toBeEnabled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('requires the payer-side reference to confirm receipt', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByLabelText(/payer record shows the claim was received/i));
    await user.type(
      screen.getByLabelText(/what was checked/i),
      'SHA portal batch report for 2026-10-27 lists this claim.',
    );
    const submit = screen.getByRole('button', { name: /record dispatch review/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/^payer-side reference$/i), 'SHA-BATCH-991');
    expect(submit).toBeEnabled();
  });

  it('records an unresolved check and says the claim stays blocked', async () => {
    const user = userEvent.setup();
    mocks.recordSha.mockResolvedValue({
      claimId: 501,
      workflow: 'SHA',
      outcome: 'STILL_UNRESOLVED',
      claimStatus: 'READY_FOR_SUBMISSION',
      guardReleased: false,
      payerReference: null,
      reconciledAt: '2026-10-27T09:00:00.000Z',
    });
    const { notify, onReconciled } = renderPanel();

    await user.click(screen.getByLabelText(/checked, still unresolved/i));
    await user.type(
      screen.getByLabelText(/what was checked/i),
      'Payer portal unreachable; batch report not published yet.',
    );
    await user.click(screen.getByRole('button', { name: /record dispatch review/i }));

    await waitFor(() => expect(mocks.recordSha).toHaveBeenCalledTimes(1));
    expect(mocks.recordSha).toHaveBeenCalledWith(
      501,
      expect.objectContaining({
        outcome: 'STILL_UNRESOLVED',
        evidenceNote: 'Payer portal unreachable; batch report not published yet.',
        guardId: 77,
      }),
      12,
    );
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/remains blocked/i), 'warning');
    expect(onReconciled).toHaveBeenCalled();
  });

  it('records a confirmed receipt with the payer reference and refreshes the claim', async () => {
    const user = userEvent.setup();
    mocks.recordPrivate.mockResolvedValue({
      claimId: 501,
      workflow: 'PRIVATE',
      outcome: 'PAYER_CONFIRMED_RECEIVED',
      claimStatus: 'ACKNOWLEDGED',
      guardReleased: true,
      payerReference: 'BRITAM-ACK-22',
      reconciledAt: '2026-10-27T09:00:00.000Z',
    });
    const { notify, onReconciled } = renderPanel({ workflow: 'PRIVATE', facilityId: null });

    await user.click(screen.getByLabelText(/payer record shows the claim was received/i));
    await user.type(screen.getByLabelText(/^payer-side reference$/i), 'BRITAM-ACK-22');
    await user.type(
      screen.getByLabelText(/what was checked/i),
      'Britam portal claim search shows the batch received.',
    );
    await user.click(screen.getByRole('button', { name: /record dispatch review/i }));

    await waitFor(() => expect(mocks.recordPrivate).toHaveBeenCalledTimes(1));
    expect(mocks.recordPrivate).toHaveBeenCalledWith(
      501,
      expect.objectContaining({
        outcome: 'PAYER_CONFIRMED_RECEIVED',
        payerReference: 'BRITAM-ACK-22',
        guardId: 77,
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.stringMatching(/Claim status is now ACKNOWLEDGED/i),
      'success',
    );
    expect(onReconciled).toHaveBeenCalled();
  });

  it('surfaces a rejected review without pretending it succeeded', async () => {
    const user = userEvent.setup();
    mocks.recordSha.mockRejectedValue(new Error('Payer reference is required.'));
    const { notify, onReconciled } = renderPanel();

    await user.click(screen.getByLabelText(/checked, still unresolved/i));
    await user.type(
      screen.getByLabelText(/what was checked/i),
      'Checked the payer portal; no definitive answer yet.',
    );
    await user.click(screen.getByRole('button', { name: /record dispatch review/i }));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('Payer reference is required.', 'error'),
    );
    expect(onReconciled).not.toHaveBeenCalled();
  });
});

describe('DispatchReviewQueue', () => {
  const item = {
    guardId: 91,
    workflow: 'SHA' as const,
    claimId: 501,
    claimNumber: 'SHA-CLM-501',
    patientName: 'Synthetic Patient',
    payerCode: 'SHA',
    claimStatus: 'READY_FOR_SUBMISSION',
    amount: '1000.00',
    state: 'UNCERTAIN',
    attemptNumber: 2,
    correlationId: 'synthetic-correlation-0001',
    reservedAt: '2026-10-27T08:00:00.000Z',
    updatedAt: '2026-10-27T08:00:00.000Z',
    ageMinutes: 90,
    lastReconciliation: null,
  };

  it('lists blocked claims and opens one for review', async () => {
    const user = userEvent.setup();
    mocks.queueSha.mockResolvedValue({
      success: true,
      reviews: [item],
      limitations: {
        source: 'LOCAL_RESERVATION_ONLY',
        notice: 'Local reservations only; this is not payer data.',
      },
    });
    const onSelect = vi.fn();
    render(<DispatchReviewQueue workflow="SHA" facilityId={12} canReconcile onSelect={onSelect} />);

    await screen.findByText('SHA-CLM-501');
    expect(screen.getByText(/local reservations only; this is not payer data/i)).toBeTruthy();
    expect(mocks.queueSha).toHaveBeenCalledWith(12);

    await user.click(screen.getByRole('button', { name: /^review$/i }));
    expect(onSelect).toHaveBeenCalledWith(501);
  });

  it('says plainly when nothing is blocked and offers no action', async () => {
    mocks.queuePrivate.mockResolvedValue({ reviews: [] });
    render(
      <DispatchReviewQueue workflow="PRIVATE" canReconcile={false} onSelect={() => undefined} />,
    );

    await screen.findByText(/no claim dispatch is awaiting review/i);
    expect(screen.queryByRole('button', { name: /^review$/i })).toBeNull();
  });
});
