// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  context: {
    authenticatedUser: {
      id: 2,
      isSuperAdmin: false,
      permissions: [
        'billing.read',
        'clinical.read',
        'insurance.sha.claims.prepare',
        'laboratory.read',
      ],
    },
    currentFacility: { id: 3 },
  },
}));
vi.mock('../../api/client.ts', () => ({ fetchJson: mocked.fetchJson }));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocked.context }));
import { ClaimEvidencePreview } from '../../components/modules/ClaimEvidencePreview.tsx';

describe('claim evidence preview UI', () => {
  beforeEach(() => {
    mocked.fetchJson.mockReset();
    mocked.context.currentFacility.id = 3;
  });
  afterEach(cleanup);

  it('locks selections while loading and discards an old invoice response after a scope change', async () => {
    let resolveOld!: (value: unknown) => void;
    mocked.fetchJson.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { rerender } = render(
      <ClaimEvidencePreview invoiceId={1} payerKind="SHA" payerCode="SHA" />,
    );
    fireEvent.click(screen.getByLabelText('Laboratory orders and verified results'));
    fireEvent.click(screen.getByRole('button', { name: 'Load evidence preview' }));
    expect(screen.getByLabelText('Laboratory orders and verified results')).toBeDisabled();
    expect(screen.getByLabelText('Optional referral ID')).toBeDisabled();
    rerender(<ClaimEvidencePreview invoiceId={2} payerKind="SHA" payerCode="SHA" />);
    expect(screen.getByRole('button', { name: 'Load evidence preview' })).toBeEnabled();
    expect(screen.getByLabelText('Laboratory orders and verified results')).not.toBeChecked();
    await act(async () => {
      resolveOld({ oldPatientSecret: 'must not render' });
    });
    expect(screen.queryByText('oldPatientSecret')).not.toBeInTheDocument();
    mocked.fetchJson.mockResolvedValueOnce({ currentInvoice: 'safe synthetic' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load evidence preview' }));
    });
    expect(screen.getByText('currentInvoice')).toBeInTheDocument();
    const request = mocked.fetchJson.mock.calls[1][1];
    expect(JSON.parse(request.body)).toMatchObject({ invoiceId: 2, categories: [] });
  });

  it('requires explicit referral review and hides categories without their permissions', () => {
    render(<ClaimEvidencePreview invoiceId={1} payerKind="SHA" payerCode="SHA" />);
    expect(screen.getByLabelText(/Prescriptions/)).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Optional referral ID'), { target: { value: '5' } });
    expect(screen.getByRole('button', { name: 'Load evidence preview' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I reviewed this referral/));
    expect(screen.getByRole('button', { name: 'Load evidence preview' })).toBeEnabled();
    expect(screen.getByText(/invoice snapshot includes recorded diagnoses/i)).toBeInTheDocument();
  });
});
