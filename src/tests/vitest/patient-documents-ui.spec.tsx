// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  action: vi.fn(),
  context: { currentFacility: { id: 1 }, authenticatedUser: { permissions: [] as string[] } },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/patient-documents.client.ts', () => ({
  documentRequest: mocks.request,
  documentAction: mocks.action,
}));
import {
  PatientDocumentsPanel,
  PortalSignedDocuments,
} from '../../components/PatientDocumentsPanel.tsx';
const record = {
  id: 1,
  patient_id: 7,
  version: 1,
  title: 'Synthetic consent',
  category: 'Consent',
  document_type: 'Treatment',
  signing_date: null,
  uploaded_at: '2026-01-01',
  patient_signature: 'UNKNOWN',
  doctor_signature: 'UNKNOWN',
  doctor_id: null,
  notes: 'INTERNAL NOTE MUST NOT REACH PORTAL VIEW',
  filename: 'synthetic.pdf',
  mime_type: 'application/pdf',
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.authenticatedUser.permissions = [];
  mocks.request.mockResolvedValue([]);
});
afterEach(cleanup);
describe('Patient document confidentiality and explicit metadata', () => {
  it('does not fetch or offer uploading without a scoped document permission', () => {
    render(<PatientDocumentsPanel patientId={7} />);
    expect(screen.getByRole('alert')).toHaveTextContent('read permission');
    expect(mocks.request).not.toHaveBeenCalled();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it('distinguishes loading and request failure from an empty document list', async () => {
    mocks.context.authenticatedUser.permissions = ['patients.documents.read'];
    mocks.request.mockRejectedValue(new Error('Synthetic access failure'));
    render(<PatientDocumentsPanel patientId={7} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByText(/No authorized documents found/)).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic access failure');
    expect(screen.queryByText(/No authorized documents found/)).not.toBeInTheDocument();
  });
  it('starts both signature fields unknown, not signed or inferred from staff identity', async () => {
    mocks.context.authenticatedUser.permissions = [
      'patients.documents.read',
      'patients.documents.upload',
    ];
    render(<PatientDocumentsPanel patientId={7} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Patient signature status')).toHaveValue('UNKNOWN');
    expect(screen.getByLabelText('Doctor signature status')).toHaveValue('UNKNOWN');
    expect(screen.getByLabelText('Responsible doctor user ID')).toHaveValue(null);
    expect(mocks.request).toHaveBeenCalledWith(
      expect.stringMatching(/^\/patients\/7\?/),
      {},
      false,
    );
  });
  it('does not carry signature assertions or doctor identity into the next uploaded original', async () => {
    mocks.context.authenticatedUser.permissions = [
      'patients.documents.read',
      'patients.documents.upload',
    ];
    render(<PatientDocumentsPanel patientId={7} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Patient signature status'), {
      target: { value: 'PRESENT' },
    });
    fireEvent.change(screen.getByLabelText('Doctor signature status'), {
      target: { value: 'PRESENT' },
    });
    fireEvent.change(screen.getByLabelText('Responsible doctor user ID'), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByLabelText('Signing date'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('Signed document file'), {
      target: { files: [new File(['synthetic'], 'consent.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Upload signed document' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Doctor signature status')).toHaveValue('UNKNOWN'),
    );
    expect(screen.getByLabelText('Patient signature status')).toHaveValue('UNKNOWN');
    expect(screen.getByLabelText('Responsible doctor user ID')).toHaveValue(null);
    expect(screen.getByLabelText('Signing date')).toHaveValue('');
  });
  it('never renders internal notes, staff signature metadata or audit controls on the portal', async () => {
    mocks.request.mockResolvedValue([record]);
    render(<PortalSignedDocuments />);
    expect(await screen.findByText('Synthetic consent')).toBeInTheDocument();
    expect(screen.queryByText(record.notes)).not.toBeInTheDocument();
    expect(screen.queryByText(/doctor ID/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /audit history/ })).not.toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledWith('', {}, true);
  });
  it('requests a new immutable correction version instead of changing an existing file', async () => {
    mocks.context.authenticatedUser.permissions = [
      'patients.documents.read',
      'patients.documents.upload',
    ];
    mocks.request.mockResolvedValue([record]);
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText('Synthetic consent');
    fireEvent.click(screen.getByRole('button', { name: 'Create correction of #1' }));
    expect(screen.getByText('New version correcting document #1')).toBeInTheDocument();
    expect(screen.getByLabelText('Document title')).toHaveValue(record.title);
    expect(screen.getByLabelText('Document audit reason')).toHaveValue('');
    expect(screen.queryByRole('button', { name: /delete|overwrite/i })).not.toBeInTheDocument();
  });
});
