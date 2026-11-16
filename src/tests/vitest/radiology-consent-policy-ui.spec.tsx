// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  action: vi.fn(),
  context: { currentFacility: { id: 1, name: 'Synthetic facility' } },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/patient-documents.client.ts', () => ({
  documentRequest: mocks.request,
  documentAction: mocks.action,
}));
import { RadiologyConsentPolicyPanel } from '../../components/modules/RadiologyConsentPolicyPanel.tsx';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.request.mockResolvedValue({ required: true, allowException: false });
  mocks.action.mockResolvedValue({ required: true, allowException: true });
});
afterEach(cleanup);

describe('Facility-wide radiology consent policy', () => {
  it('loads the stored policy instead of assuming a default', async () => {
    mocks.request.mockResolvedValue({ required: false, allowException: true });
    render(<RadiologyConsentPolicyPanel canManage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/Require procedure-specific consent/)).not.toBeChecked(),
    );
    expect(screen.getByLabelText(/Permit a documented exception/)).toBeChecked();
    expect(mocks.request).toHaveBeenCalledWith('/radiology-policy');
  });

  it('requires an audited reason before saving and posts the explicit policy', async () => {
    render(<RadiologyConsentPolicyPanel canManage />);
    await screen.findByLabelText(/Require procedure-specific consent/);
    const save = screen.getByRole('button', { name: 'Save consent policy' });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Permit a documented exception/));
    fireEvent.change(screen.getByLabelText('Reason for this policy change'), {
      target: { value: 'Facility board approved documented exceptions' },
    });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.submit(screen.getByRole('form', { name: 'Save radiology consent policy' }));
    await waitFor(() => expect(mocks.action).toHaveBeenCalled());
    expect(mocks.action).toHaveBeenCalledWith('/radiology-policy', {
      required: true,
      allowException: true,
      reason: 'Facility board approved documented exceptions',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('saved with an audit record');
  });

  it('shows the policy read-only without the management permission', async () => {
    render(<RadiologyConsentPolicyPanel canManage={false} />);
    await screen.findByLabelText(/Require procedure-specific consent/);
    expect(screen.getByLabelText(/Require procedure-specific consent/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save consent policy' })).not.toBeInTheDocument();
    expect(screen.getByText(/policy permission is required/)).toBeInTheDocument();
    expect(mocks.action).not.toHaveBeenCalled();
  });
});
