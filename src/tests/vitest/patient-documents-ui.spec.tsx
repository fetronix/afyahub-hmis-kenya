// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  action: vi.fn(),
  context: {
    currentFacility: { id: 1 },
    authenticatedUser: { id: 8, permissions: [] as string[] },
  },
  documents: [] as unknown[],
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
  mocks.context.authenticatedUser.id = 8;
  mocks.documents = [];
  mocks.request.mockImplementation((path: string) => {
    if (path.includes('/doctors?')) {
      const doctors = [
        { id: 8, name: 'Dr Synthetic A', designation: 'Medical officer' },
        { id: 9, name: 'Dr Synthetic B', designation: 'Consultant' },
      ];
      const currentDoctor =
        doctors.find((d) => d.id === mocks.context.authenticatedUser.id) ?? null;
      const canAssignOthers =
        mocks.context.authenticatedUser.permissions.includes('patients.update');
      const query = new URLSearchParams(path.split('?')[1]).get('search') ?? '';
      return Promise.resolve({
        currentDoctor,
        canAssignOthers,
        doctors: (canAssignOthers ? doctors : currentDoctor ? [currentDoctor] : []).filter((d) =>
          d.name.includes(query),
        ),
        hasMore: false,
      });
    }
    return Promise.resolve(mocks.documents);
  });
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
    expect(screen.getByLabelText('Responsible doctor')).toHaveValue('8');
    expect(mocks.request).toHaveBeenCalledWith(
      expect.stringMatching(/^\/patients\/7\?/),
      {},
      false,
    );
  });
  it('clears signature assertions and restores the session doctor after an uploaded original', async () => {
    mocks.context.authenticatedUser.permissions = [
      'patients.documents.read',
      'patients.documents.upload',
    ];
    mocks.context.authenticatedUser.permissions.push('patients.update');
    render(<PatientDocumentsPanel patientId={7} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Patient signature status'), {
      target: { value: 'PRESENT' },
    });
    fireEvent.change(screen.getByLabelText('Doctor signature status'), {
      target: { value: 'PRESENT' },
    });
    fireEvent.change(screen.getByLabelText('Responsible doctor'), {
      target: { value: '9' },
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
    expect(screen.getByLabelText('Responsible doctor')).toHaveValue('8');
    expect(screen.getByLabelText('Signing date')).toHaveValue('');
    const call = mocks.request.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(JSON.parse(decodeURIComponent(call![1].headers['X-Document-Metadata']))).toMatchObject({
      doctorId: '9',
    });
  });
  it('never renders internal notes, staff signature metadata or audit controls on the portal', async () => {
    mocks.documents = [record];
    render(<PortalSignedDocuments />);
    expect(await screen.findByText('Synthetic consent')).toBeInTheDocument();
    expect(screen.queryByText(record.notes)).not.toBeInTheDocument();
    expect(screen.queryByText(/responsible doctor/i)).not.toBeInTheDocument();
    expect(mocks.request).not.toHaveBeenCalledWith(
      expect.stringContaining('/doctors'),
      expect.anything(),
    );
    expect(screen.queryByRole('button', { name: /audit history/ })).not.toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledWith('', {}, true);
  });
  it('requests a new immutable correction version instead of changing an existing file', async () => {
    mocks.context.authenticatedUser.permissions = [
      'patients.documents.read',
      'patients.documents.upload',
    ];
    mocks.documents = [record];
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText('Synthetic consent');
    fireEvent.click(screen.getByRole('button', { name: 'Create correction of #1' }));
    expect(screen.getByText('New version correcting document #1')).toBeInTheDocument();
    expect(screen.getByLabelText('Document title')).toHaveValue(record.title);
    expect(screen.getByLabelText('Document audit reason')).toHaveValue('');
    expect(screen.queryByRole('button', { name: /delete|overwrite/i })).not.toBeInTheDocument();
  });
  it.each([8, 9])(
    'defaults to the authenticated active doctor %s by name before upload',
    async (id) => {
      mocks.context.authenticatedUser.id = id;
      mocks.context.authenticatedUser.permissions = [
        'patients.documents.read',
        'patients.documents.upload',
      ];
      render(<PatientDocumentsPanel patientId={7} />);
      const select = screen.getByLabelText('Responsible doctor');
      await waitFor(() => expect(select).toHaveValue(String(id)));
      expect(select).toBeDisabled();
      expect(
        within(screen.getByLabelText('Responsible doctor')).getByRole('option', { selected: true }),
      ).toHaveTextContent(id === 8 ? 'Dr Synthetic A' : 'Dr Synthetic B');
      expect(screen.queryByLabelText('Responsible doctor user ID')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Search doctors')).not.toBeInTheDocument();
    },
  );
  it('requires authorized non-doctor staff to search and select without typing an ID', async () => {
    mocks.context.authenticatedUser.id = 12;
    mocks.context.authenticatedUser.permissions = [
      'patients.documents.read',
      'patients.documents.upload',
      'patients.update',
    ];
    render(<PatientDocumentsPanel patientId={7} />);
    await waitFor(() => expect(screen.getByLabelText('Responsible doctor')).not.toBeDisabled());
    expect(screen.getByLabelText('Responsible doctor')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Upload document version' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Search doctors'), { target: { value: 'Synthetic B' } });
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('/patients/7/doctors?search=Synthetic+B'),
    );
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Dr Synthetic A/ })).not.toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText('Responsible doctor'), { target: { value: '9' } });
    expect(
      within(screen.getByLabelText('Responsible doctor')).getByRole('option', { selected: true }),
    ).toHaveTextContent('Dr Synthetic B');
  });
  it('fails closed when the server doctor lookup fails', async () => {
    mocks.context.authenticatedUser.permissions = [
      'patients.documents.read',
      'patients.documents.upload',
    ];
    mocks.request.mockImplementation((path: string) =>
      path.includes('/doctors?')
        ? Promise.reject(Error('Doctor access refused'))
        : Promise.resolve([]),
    );
    render(<PatientDocumentsPanel patientId={7} />);
    expect(await screen.findByText('Doctor access refused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload document version' })).toBeDisabled();
  });
  it('shows saved and historical responsible doctor names after refresh without raw IDs', async () => {
    mocks.context.authenticatedUser.permissions = ['patients.documents.read'];
    mocks.documents = [{ ...record, doctor_id: 8, doctor_name: 'Dr Synthetic A' }];
    mocks.request.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('/history') ? { versions: mocks.documents, events: [] } : mocks.documents,
      ),
    );
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText(/responsible doctor: Dr Synthetic A/i);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh documents' }));
    await screen.findByText(/responsible doctor: Dr Synthetic A/i);
    fireEvent.click(screen.getByRole('button', { name: 'Version & audit history #1' }));
    expect(await screen.findByLabelText('Document version and audit history')).toHaveTextContent(
      'Responsible doctor: Dr Synthetic A',
    );
  });
});
