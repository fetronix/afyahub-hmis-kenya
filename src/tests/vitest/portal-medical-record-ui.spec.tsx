// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  getPortalToken: vi.fn(),
  clearPortalToken: vi.fn(),
  loginPortal: vi.fn(),
  logoutPortal: vi.fn(),
  activatePortalAccount: vi.fn(),
  api: {
    me: vi.fn(),
    overview: vi.fn(),
    card: vi.fn(),
    accessHistory: vi.fn(),
    downloadRecord: vi.fn(),
    changePassword: vi.fn(),
    requestCorrection: vi.fn(),
    issueCard: vi.fn(),
  },
}));

vi.mock('../../api/portal-client.ts', () => ({
  getPortalToken: mocks.getPortalToken,
  clearPortalToken: mocks.clearPortalToken,
  loginPortal: mocks.loginPortal,
  logoutPortal: mocks.logoutPortal,
  activatePortalAccount: mocks.activatePortalAccount,
  portalApi: mocks.api,
  PortalApiError: class extends Error {
    status: number;
    code?: string;
    constructor(message: string, status = 500, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

import { PatientPortalApp } from '../../components/portal/PortalApp.tsx';

function openAccount() {
  return screen.getAllByRole('button', { name: 'Account' })[0]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, '', '/portal');
  mocks.getPortalToken.mockReturnValue('synthetic-session');
  mocks.api.me.mockResolvedValue({
    account: { status: 'ACTIVE' },
    patient: { firstName: 'Synthetic', lastName: 'Patient', mrn: 'SYNTHETIC' },
    facilityName: 'Synthetic facility',
  });
  mocks.api.overview.mockResolvedValue({
    visits: [],
    upcomingAppointments: [],
    activeAllergies: [],
    recentVerifiedResults: [],
    recentMedications: [],
    releasedSections: {},
  });
  mocks.api.card.mockResolvedValue({ svg: '', issuedAt: null });
  mocks.api.accessHistory.mockResolvedValue([]);
  mocks.api.downloadRecord.mockResolvedValue({
    blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
    filename: 'medical-record-SYNTHETIC-2026-10-27.pdf',
  });

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:synthetic-record'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(cleanup);

it('presents the medical record section with its professional download control', async () => {
  mocks.api.accessHistory.mockResolvedValue([
    {
      action: 'DOWNLOAD',
      accessChannel: 'PATIENT_PORTAL',
      recordType: 'MedicalRecord',
      createdAt: '2026-10-20T08:00:00.000Z',
    },
  ]);

  const user = userEvent.setup();
  render(<PatientPortalApp />);
  await screen.findByRole('heading', { name: 'Synthetic Patient' });
  await user.click(openAccount());

  expect(await screen.findByRole('heading', { name: 'My Medical Record' })).toBeInTheDocument();
  expect(
    screen.getByText(
      'Download a professionally organised copy of your available medical history and healthcare records.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download Medical Record (PDF)' })).toBeEnabled();

  /* The date comes from the patient's own access history. */
  expect(await screen.findByText(/Last generated/)).toHaveTextContent('Last generated');

  /* Nothing from the old text export survives. */
  expect(screen.queryByText(/A text copy/)).not.toBeInTheDocument();
});

it('shows a clear loading state and only reports success after the PDF arrives', async () => {
  let resolveDownload: (value: { blob: Blob; filename: string }) => void = () => undefined;
  mocks.api.downloadRecord.mockReturnValue(
    new Promise((resolve) => {
      resolveDownload = resolve;
    }),
  );

  const user = userEvent.setup();
  render(<PatientPortalApp />);
  await screen.findByRole('heading', { name: 'Synthetic Patient' });
  await user.click(openAccount());

  await user.click(await screen.findByRole('button', { name: 'Download Medical Record (PDF)' }));

  expect(await screen.findByText(/Generating your PDF/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Preparing your record/ })).toBeDisabled();
  expect(screen.queryByText(/downloaded to this device/)).not.toBeInTheDocument();

  resolveDownload({
    blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
    filename: 'medical-record-SYNTHETIC-2026-10-27.pdf',
  });

  expect(
    await screen.findByText('Your medical record PDF was downloaded to this device.'),
  ).toBeInTheDocument();
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-record');
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  expect(screen.queryByText(/Generating your PDF/)).not.toBeInTheDocument();
});

it('reports a meaningful failure instead of claiming a download', async () => {
  const { PortalApiError } = await import('../../api/portal-client.ts');
  mocks.api.downloadRecord.mockRejectedValue(
    new PortalApiError(
      'Your medical record could not be generated just now. Please try again in a few minutes, or ask at the desk for a printed copy.',
      500,
      'RECORD_PDF_FAILED',
    ),
  );

  const user = userEvent.setup();
  render(<PatientPortalApp />);
  await screen.findByRole('heading', { name: 'Synthetic Patient' });
  await user.click(openAccount());
  await user.click(await screen.findByRole('button', { name: 'Download Medical Record (PDF)' }));

  expect(
    await screen.findByText(/Your medical record could not be generated just now/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/downloaded to this device/)).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Download Medical Record (PDF)' })).toBeEnabled(),
  );
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
