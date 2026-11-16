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
import { RadiologyConsentMetadata } from '../../components/RadiologyConsentMetadata.tsx';
import type { PatientFile } from '../../api/patient-documents.client.ts';
const record: PatientFile = {
  id: 1,
  patient_id: 7,
  root_id: null,
  version: 1,
  title: 'Synthetic document',
  category: 'Document',
  document_type: 'Patient document',
  signing_date: null,
  uploaded_at: '2026-01-01',
  patient_signature: 'UNKNOWN',
  doctor_signature: 'UNKNOWN',
  doctor_id: null,
  notes: 'PRIVATE STAFF NOTES',
  filename: 'synthetic.pdf',
  mime_type: 'application/pdf',
  radiology_order_id: null,
  procedure_name: null,
  uploader_name: 'Synthetic Records',
};
const canUpload = ['patients.documents.read', 'patients.documents.upload'];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.authenticatedUser.permissions = [];
  mocks.documents = [];
  mocks.request.mockImplementation((path: string, options?: RequestInit) => {
    if (path.includes('/doctors?'))
      return Promise.resolve({
        currentDoctor: { id: 8, name: 'Dr Synthetic' },
        canAssignOthers: false,
        doctors: [{ id: 8, name: 'Dr Synthetic' }],
        hasMore: false,
      });
    if (path.includes('/file'))
      return Promise.resolve(new Blob(['synthetic'], { type: 'application/pdf' }));
    if (options?.method === 'POST') return Promise.resolve({ ...record, id: 2 });
    if (path.endsWith('/history'))
      return Promise.resolve({ versions: mocks.documents, events: [] });
    return Promise.resolve(mocks.documents);
  });
});
afterEach(cleanup);
function chooseFile() {
  fireEvent.change(screen.getByLabelText('Signed document file'), {
    target: { files: [new File(['synthetic'], 'consent.pdf', { type: 'application/pdf' })] },
  });
}
describe('Simple patient document uploads and separate consent review', () => {
  it('does not fetch or offer uploading without scoped permission', () => {
    render(<PatientDocumentsPanel patientId={7} />);
    expect(screen.getByRole('alert')).toHaveTextContent('read permission');
    expect(mocks.request).not.toHaveBeenCalled();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it('requires only title and file, with optional textarea notes and no clinical or audit inputs', async () => {
    mocks.context.authenticatedUser.permissions = canUpload;
    render(<PatientDocumentsPanel patientId={7} />);
    const form = screen.getByRole('form', { name: 'Upload document' });
    expect(within(form).getAllByRole('textbox')).toHaveLength(2);
    expect(within(form).getByLabelText('Document title')).toBeRequired();
    expect(within(form).getByLabelText('Notes (optional)')).not.toBeRequired();
    expect(screen.getByLabelText('Signed document file')).toBeRequired();
    for (const name of [
      'Document category',
      'Consent/document type',
      'Signing date',
      'Document audit reason',
      'Responsible doctor',
      'Patient signature status',
      'Doctor signature status',
      'Search doctors',
    ])
      expect(within(form).queryByLabelText(name)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Original files are preserved. Uploading a document does not automatically verify signatures or release it to the patient portal.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(mocks.request.mock.calls.some((c) => c[0].includes('/doctors'))).toBe(false);
  });
  it('submits simple mode without clinical assertions, accepts blank notes, and clears selection', async () => {
    mocks.context.authenticatedUser.permissions = canUpload;
    render(<PatientDocumentsPanel patientId={7} />);
    fireEvent.change(screen.getByLabelText('Document title'), {
      target: { value: 'Synthetic simple upload' },
    });
    chooseFile();
    expect(screen.getByText('Selected file: consent.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace selected file' })).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('form', { name: 'Upload document' }));
    await waitFor(() => expect(screen.getByLabelText('Document title')).toHaveValue(''));
    const call = mocks.request.mock.calls.find((c) => c[1]?.method === 'POST')!;
    const metadata = JSON.parse(decodeURIComponent(call[1].headers['X-Document-Metadata']));
    expect(metadata).toMatchObject({
      title: 'Synthetic simple upload',
      notes: '',
      filename: 'consent.pdf',
      uploadMode: 'SIMPLE',
    });
    for (const key of [
      'doctorId',
      'signingDate',
      'patientSignature',
      'doctorSignature',
      'category',
      'documentType',
      'reason',
    ])
      expect(metadata).not.toHaveProperty(key);
  });
  it('uses the same three fields in exact-request mode before request-filtered attachments', async () => {
    mocks.context.authenticatedUser.permissions = canUpload;
    mocks.documents = [
      { ...record, radiology_order_id: 44, procedure_name: 'Synthetic CT' },
      { ...record, id: 3, title: 'Other request', radiology_order_id: 45 },
    ];
    const onUploaded = vi.fn(),
      onOpenRepository = vi.fn();
    render(
      <PatientDocumentsPanel
        patientId={7}
        radiologyOrderId={44}
        requestWorkflow={{
          procedureName: 'Synthetic CT',
          disabled: false,
          consentStatus: 'AWAITING_VERIFICATION',
          decisionDocumentId: null,
          onUploaded,
          onReviewed: vi.fn(),
          onOpenRepository,
        }}
      />,
    );
    await screen.findByText('Synthetic document');
    expect(screen.queryByText('Other request')).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Upload document' }));
    const form = screen.getByRole('form', { name: 'Upload document' });
    expect(screen.getAllByRole('button', { name: 'Upload document' })).toHaveLength(1);
    expect(form.querySelectorAll('input,textarea,select')).toHaveLength(3);
    expect(
      form.compareDocumentPosition(screen.getByText('Attached consent documents · request #44')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Document title'), {
      target: { value: 'Linked document' },
    });
    chooseFile();
    fireEvent.submit(form);
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    const call = mocks.request.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(decodeURIComponent(call[1].headers['X-Document-Metadata']))).toMatchObject({
      uploadMode: 'SIMPLE',
      radiologyOrderId: 44,
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.stringContaining('radiologyOrderId=44'),
      {},
      false,
    );
  });
  it('keeps cancellation disabling on the request upload control', () => {
    mocks.context.authenticatedUser.permissions = canUpload;
    render(
      <PatientDocumentsPanel
        patientId={7}
        radiologyOrderId={44}
        requestWorkflow={{
          procedureName: 'CT',
          disabled: true,
          consentStatus: 'PROCEDURE_CANCELLED',
          decisionDocumentId: null,
          onUploaded: vi.fn(),
          onReviewed: vi.fn(),
          onOpenRepository: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Upload document' })).toBeDisabled();
  });
  it('shows uploader and filename without putting clinical assertions on the normal card', async () => {
    mocks.context.authenticatedUser.permissions = ['patients.documents.read'];
    mocks.documents = [record];
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText('Synthetic document');
    expect(screen.getByText(/Uploaded by: Synthetic Records/)).toBeInTheDocument();
    expect(screen.getByText(/Original filename: synthetic.pdf/)).toBeInTheDocument();
    expect(screen.getByText(record.notes!)).toBeInTheDocument();
    expect(screen.queryByText(/Patient signature:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View document details #1' }));
    expect(screen.getByLabelText('Signed document details')).toHaveTextContent(
      'Patient signature: UNKNOWN',
    );
  });
  it('keeps search/type/date filters and version history', async () => {
    mocks.context.authenticatedUser.permissions = canUpload;
    mocks.documents = [record];
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText('Synthetic document');
    expect(screen.getByLabelText('Search title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Version & audit history #1' }));
    expect(await screen.findByLabelText('Document version and audit history')).toHaveTextContent(
      'Version 1',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create correction of #1' }));
    expect(screen.getByText('New version correcting document #1')).toBeInTheDocument();
    chooseFile();
    fireEvent.submit(screen.getByRole('form', { name: 'Upload document' }));
    await waitFor(() =>
      expect(mocks.request.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true),
    );
    const call = mocks.request.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(decodeURIComponent(call[1].headers['X-Document-Metadata']))).toMatchObject({
      previousId: '1',
      uploadMode: 'SIMPLE',
    });
  });
  it('keeps release reason and authorization separate from uploading', async () => {
    mocks.context.authenticatedUser.permissions = [...canUpload, 'patients.documents.release'];
    mocks.documents = [record];
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText('Synthetic document');
    expect(screen.queryByLabelText('Portal release reason')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Release to patient portal #1' }));
    fireEvent.change(screen.getByLabelText('Portal release reason'), {
      target: { value: 'Explicit synthetic release approval' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Portal release decision' }));
    await waitFor(() =>
      expect(mocks.action).toHaveBeenCalledWith('/patients/7/1/release', {
        released: true,
        reason: 'Explicit synthetic release approval',
      }),
    );
  });
  it('does not render staff notes, identities or audit controls on the portal', async () => {
    mocks.documents = [record];
    render(<PortalSignedDocuments />);
    await screen.findByText('Synthetic document');
    expect(screen.queryByText(record.notes!)).not.toBeInTheDocument();
    expect(screen.queryByText(/Uploaded by/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /audit history/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledWith('', {}, true);
  });
  it('distinguishes loading and request errors from an empty repository', async () => {
    mocks.context.authenticatedUser.permissions = ['patients.documents.read'];
    mocks.request.mockRejectedValue(Error('Synthetic access failure'));
    render(<PatientDocumentsPanel patientId={7} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic access failure');
    expect(screen.queryByText(/No authorized documents found/)).not.toBeInTheDocument();
  });
  it('keeps explicit signature review separate and defaults its signature assertions to Unknown', async () => {
    render(
      <RadiologyConsentMetadata
        patientId={7}
        doc={{ ...record, radiology_order_id: 44, reviewed_by_actor: true }}
        disabled={false}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Patient signature status')).toHaveValue('UNKNOWN');
    expect(screen.getByLabelText('Doctor signature status')).toHaveValue('UNKNOWN');
    expect(screen.getByLabelText('Signing date')).toHaveValue('');
    await waitFor(() => expect(screen.getByLabelText('Responsible doctor')).toHaveValue('8'));
    expect(screen.queryByLabelText('Signed document file')).not.toBeInTheDocument();
  });
  it('records reviewed metadata as a new immutable version through the existing endpoint', async () => {
    const onSaved = vi.fn();
    render(
      <RadiologyConsentMetadata
        patientId={7}
        doc={{ ...record, radiology_order_id: 44, reviewed_by_actor: true }}
        disabled={false}
        onSaved={onSaved}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Responsible doctor')).toHaveValue('8'));
    fireEvent.change(screen.getByLabelText('Signing date'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Patient signature status'), {
      target: { value: 'PRESENT' },
    });
    fireEvent.change(screen.getByLabelText('Doctor signature status'), {
      target: { value: 'PRESENT' },
    });
    fireEvent.change(screen.getByLabelText('Signature review reason'), {
      target: { value: 'Reviewed synthetic original signatures' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Record consent signature details' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const call = mocks.request.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(decodeURIComponent(call[1].headers['X-Document-Metadata']))).toMatchObject({
      previousId: 1,
      radiologyOrderId: 44,
      doctorId: '8',
      patientSignature: 'PRESENT',
      doctorSignature: 'PRESENT',
    });
    expect(mocks.action).not.toHaveBeenCalled();
  });
});
