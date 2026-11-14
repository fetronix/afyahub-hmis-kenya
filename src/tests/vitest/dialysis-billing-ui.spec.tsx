// @vitest-environment jsdom
/**
 * Dialysis screen: recording an outcome is not the same act as billing.
 *
 * The backend proves a completed session can be charged exactly once. This file
 * proves the screen keeps the two acts apart: the billing form only appears for
 * someone holding the billing permission, and submitting it calls the billing
 * endpoint rather than the completion endpoint.
 *
 * The API client and context are mocked; every value is synthetic.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  sprint: {
    billDialysis: vi.fn(),
    completeDialysis: vi.fn(),
    startDialysis: vi.fn(),
    addObservation: vi.fn(),
  },
  context: {
    currentFacility: { id: 21, name: 'Synthetic renal unit' },
    authenticatedUser: { permissions: [] as string[] },
    showToast: vi.fn(),
  },
}));

vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/client-sprint.client.ts', () => ({ sprintApi: mocks.sprint }));

import { DialysisModule } from '../../components/modules/DialysisModule.tsx';

beforeEach(() => {
  mocks.context.authenticatedUser.permissions = ['dialysis.sessions.record'];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('dialysis billing', () => {
  it('does not offer billing to a clinician who may only record sessions', async () => {
    render(<DialysisModule />);
    await screen.findByText(/record session outcome/i);
    expect(screen.queryByRole('button', { name: /bill session/i })).toBeNull();
  });

  it('bills a completed session through the billing endpoint, not the completion one', async () => {
    mocks.context.authenticatedUser.permissions = ['dialysis.sessions.record', 'billing.create'];
    mocks.sprint.billDialysis.mockResolvedValue({ charged: true });
    const user = userEvent.setup();

    render(<DialysisModule />);
    const heading = await screen.findByText(/bill a completed session/i);
    expect(heading).toBeTruthy();

    const form = heading.closest('form') as HTMLFormElement;
    await user.type(form.querySelector('input') as HTMLInputElement, '90210');
    await user.click(screen.getByRole('button', { name: /bill session/i }));

    await waitFor(() => expect(mocks.sprint.billDialysis).toHaveBeenCalledTimes(1));
    const [sessionId, body] = mocks.sprint.billDialysis.mock.calls[0];
    expect(sessionId).toBe(90210);
    expect(body).toMatchObject({ facilityId: 21 });
    /* Completion is a clinical fact and must not be re-posted by a billing run. */
    expect(mocks.sprint.completeDialysis).not.toHaveBeenCalled();
  });

  it('warns on the screen that recording an outcome raises no charge', async () => {
    mocks.context.authenticatedUser.permissions = ['dialysis.sessions.record', 'billing.create'];
    render(<DialysisModule />);
    expect(await screen.findByText(/recording an outcome does not raise a charge/i)).toBeTruthy();
  });
});
