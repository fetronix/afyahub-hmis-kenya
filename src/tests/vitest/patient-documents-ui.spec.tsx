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
  page: { limit: 25, total: 0, returned: 0, has_more: false, next_cursor: null as string | null },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/patient-documents.client.ts', () => ({
  documentRequest: mocks.request,
  documentAction: mocks.action,
}));
import { PatientDocumentsPanel } from '../../components/PatientDocumentsPanel.tsx';
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
  portal_release_status: 'NOT_RELEASED',
  is_latest_version: true,
};
const canUpload = ['patients.documents.read', 'patients.documents.upload'];
const canRelease = [...canUpload, 'patients.documents.release'];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.authenticatedUser.permissions = [];
  mocks.documents = [];
  mocks.page = { limit: 25, total: 0, returned: 0, has_more: false, next_cursor: null };
  mocks.request.mockImplementation((path: string, options?: RequestInit) => {
    if (path.includes('/file'))
      return Promise.resolve(new Blob(['synthetic'], { type: 'application/pdf' }));
    if (options?.method === 'POST') return Promise.resolve({ ...record, id: 2 });
    if (path.endsWith('/history'))
      return Promise.resolve({ versions: mocks.documents, events: [] });
    return Promise.resolve({ documents: mocks.documents, page: mocks.page });
  });
  mocks.action.mockResolvedValue({ released: true });
});
afterEach(cleanup);
function chooseFile() {
  fireEvent.change(screen.getByLabelText('Signed document file'), {
    target: { files: [new File(['synthetic'], 'consent.pdf', { type: 'application/pdf' })] },
  });
}
describe('Staff patient documents and portal release workflow', () => {
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
  it('shows the explicit portal release state for each document version', async () => {
    mocks.context.authenticatedUser.permissions = ['patients.documents.read'];
    mocks.documents = [
      record,
      {
        ...record,
        id: 2,
        title: 'Released document',
        portal_release_status: 'RELEASED',
        portal_released_at: '2026-02-02T10:00:00.000Z',
      },
      {
        ...record,
        id: 3,
        title: 'Withdrawn document',
        portal_release_status: 'REVOKED',
        portal_revoked_at: '2026-03-03T10:00:00.000Z',
      },
    ];
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText('Synthetic document');
    expect(screen.getByText('Portal: Not released to the patient portal')).toBeInTheDocument();
    expect(screen.getByText(/Portal: Released to patient portal on/)).toBeInTheDocument();
    expect(screen.getByText(/Portal: Release revoked on/)).toBeInTheDocument();
    expect(screen.getAllByText(/Uploaded by: Synthetic Records/)).toHaveLength(3);
    expect(screen.getAllByText(record.notes!).length).toBeGreaterThan(0);
  });
  it('explains a missing release permission instead of silently hiding the action', async () => {
    mocks.context.authenticatedUser.permissions = canUpload;
    mocks.documents = [record];
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText('Synthetic document');
    expect(screen.getByText(/Portal release needs the/)).toHaveTextContent(
      'Release patient documents to portal',
    );
    expect(screen.queryByRole('button', { name: /Release to patient portal/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Select Synthetic document #1')).not.toBeInTheDocument();
  });
  it('requires a reason and a consent review before releasing a consent document', async () => {
    mocks.context.authenticatedUser.permissions = canRelease;
    mocks.documents = [{ ...record, title: 'Treatment consent form' }];
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText('Treatment consent form');
    fireEvent.click(screen.getByRole('button', { name: 'Release to patient portal #1' }));
    const dialog = screen.getByRole('form', { name: 'Portal release decision' });
    expect(within(dialog).getByText(/Recorded patient signature: UNKNOWN/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Review original #1' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Reviewed original consent document')).toBeRequired();
    fireEvent.change(within(dialog).getByLabelText('Portal release reason'), {
      target: { value: 'Explicit synthetic release approval' },
    });
    fireEvent.click(within(dialog).getByLabelText('Reviewed original consent document'));
    fireEvent.submit(dialog);
    await waitFor(() =>
      expect(mocks.action).toHaveBeenCalledWith('/patients/7/1/release', {
        released: true,
        reason: 'Explicit synthetic release approval',
        reviewedOriginal: true,
      }),
    );
  });
  it('releases a staff selection in one authorized decision', async () => {
    mocks.context.authenticatedUser.permissions = canRelease;
    mocks.documents = [record, { ...record, id: 2, title: 'Second letter' }];
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText('Synthetic document');
    fireEvent.click(screen.getByLabelText('Select Synthetic document #1'));
    fireEvent.click(screen.getByLabelText('Select Second letter #2'));
    fireEvent.click(screen.getByRole('button', { name: 'Release selected (2) to patient portal' }));
    const dialog = screen.getByRole('form', { name: 'Portal release decision' });
    fireEvent.change(within(dialog).getByLabelText('Portal release reason'), {
      target: { value: 'Synthetic batch release reason' },
    });
    fireEvent.submit(dialog);
    await waitFor(() =>
      expect(mocks.action).toHaveBeenCalledWith('/patients/7/releases', {
        documentIds: [1, 2],
        released: true,
        reason: 'Synthetic batch release reason',
        reviewedOriginal: false,
      }),
    );
  });
  it('explains a short or empty release reason instead of silently doing nothing', async () => {
    mocks.context.authenticatedUser.permissions = canRelease;
    mocks.documents = [record];
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText('Synthetic document');
    fireEvent.click(screen.getByRole('button', { name: 'Release to patient portal #1' }));
    const dialog = screen.getByRole('form', { name: 'Portal release decision' });
    fireEvent.change(within(dialog).getByLabelText('Portal release reason'), {
      target: { value: 'ok' },
    });
    fireEvent.submit(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('at least 10 characters');
    expect(mocks.action).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('Portal release reason')).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    fireEvent.change(within(dialog).getByLabelText('Portal release reason'), {
      target: { value: 'Explicit synthetic release approval' },
    });
    mocks.action.mockResolvedValueOnce({
      document_id: 1,
      released: true,
      portal_release_status: 'RELEASED',
      released_at: '2026-03-03T09:00:00.000Z',
      revoked_at: null,
      reviewed_original: false,
      consent_document: false,
      already_recorded: false,
    });
    fireEvent.submit(dialog);
    await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(1));
    expect(await screen.findByLabelText('Portal release result')).toHaveTextContent(
      'Released 1 document to the patient portal.',
    );
  });
  it('refuses a consent release without the explicit original review', async () => {
    mocks.context.authenticatedUser.permissions = canRelease;
    mocks.documents = [{ ...record, title: 'Treatment consent form' }];
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText('Treatment consent form');
    fireEvent.click(screen.getByRole('button', { name: 'Release to patient portal #1' }));
    const dialog = screen.getByRole('form', { name: 'Portal release decision' });
    fireEvent.change(within(dialog).getByLabelText('Portal release reason'), {
      target: { value: 'Explicit synthetic consent release' },
    });
    fireEvent.submit(dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'reviewed the original consent document',
    );
    expect(mocks.action).not.toHaveBeenCalled();
  });
  it('reports which documents in a bulk decision failed', async () => {
    mocks.context.authenticatedUser.permissions = canRelease;
    mocks.documents = [record, { ...record, id: 2, title: 'Second letter' }];
    mocks.action.mockResolvedValueOnce({
      released: true,
      partial: true,
      documents: [
        {
          document_id: 1,
          released: true,
          portal_release_status: 'RELEASED',
          released_at: '2026-03-03T09:00:00.000Z',
          revoked_at: null,
          reviewed_original: false,
          consent_document: false,
          already_recorded: false,
        },
      ],
      failures: [
        {
          document_id: 2,
          error: 'DOCUMENT_NOT_FOUND',
          message: 'Patient or document not found in this facility.',
        },
      ],
    });
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText('Synthetic document');
    fireEvent.click(screen.getByLabelText('Select Synthetic document #1'));
    fireEvent.click(screen.getByLabelText('Select Second letter #2'));
    fireEvent.click(screen.getByRole('button', { name: 'Release selected (2) to patient portal' }));
    const dialog = screen.getByRole('form', { name: 'Portal release decision' });
    fireEvent.change(within(dialog).getByLabelText('Portal release reason'), {
      target: { value: 'Synthetic partial release reason' },
    });
    fireEvent.submit(dialog);
    const result = await screen.findByLabelText('Portal release result');
    expect(result).toHaveTextContent(
      'Released 1 of 2 documents to the patient portal. 1 could not be released.',
    );
    expect(result).toHaveTextContent('Second letter (#2): Patient or document not found');
  });
  it('sends one decision when the confirmation is clicked twice', async () => {
    mocks.context.authenticatedUser.permissions = canRelease;
    mocks.documents = [record];
    let resolveAction: (value: unknown) => void = () => {};
    mocks.action.mockImplementationOnce(
      () => new Promise((resolve) => (resolveAction = resolve)),
    );
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText('Synthetic document');
    fireEvent.click(screen.getByRole('button', { name: 'Release to patient portal #1' }));
    const dialog = screen.getByRole('form', { name: 'Portal release decision' });
    fireEvent.change(within(dialog).getByLabelText('Portal release reason'), {
      target: { value: 'Explicit synthetic double click guard' },
    });
    fireEvent.submit(dialog);
    fireEvent.submit(dialog);
    expect(mocks.action).toHaveBeenCalledTimes(1);
    resolveAction({
      document_id: 1,
      released: true,
      portal_release_status: 'RELEASED',
      released_at: '2026-03-03T09:00:00.000Z',
      revoked_at: null,
      reviewed_original: false,
      consent_document: false,
      already_recorded: false,
    });
    await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(1));
  });
  it('keeps staff search, pagination, details and version history', async () => {
    mocks.context.authenticatedUser.permissions = canUpload;
    mocks.documents = [record];
    mocks.page = { limit: 25, total: 41, returned: 1, has_more: true, next_cursor: 'cursor-2' };
    render(<PatientDocumentsPanel patientId={7} />);
    await screen.findByText('Synthetic document');
    expect(screen.getByLabelText('Search title')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 41 document versions.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more documents' }));
    await waitFor(() =>
      expect(mocks.request.mock.calls.some((c) => String(c[0]).includes('cursor=cursor-2'))).toBe(
        true,
      ),
    );
    expect(String(mocks.request.mock.calls[0][0])).toContain('paginate=1');
    fireEvent.click(screen.getByRole('button', { name: 'View document details #1' }));
    expect(screen.getByLabelText('Signed document details')).toHaveTextContent(
      'Patient signature: UNKNOWN',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Version & audit history #1' }));
    expect(await screen.findByLabelText('Document version and audit history')).toHaveTextContent(
      'Version 1',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create correction of #1' }));
    expect(screen.getByText('New version correcting document #1')).toBeInTheDocument();
  });
  it('distinguishes loading and request errors from an empty repository', async () => {
    mocks.context.authenticatedUser.permissions = ['patients.documents.read'];
    mocks.request.mockRejectedValue(Error('Synthetic access failure'));
    render(<PatientDocumentsPanel patientId={7} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic access failure');
    expect(screen.queryByText(/No documents have been uploaded/)).not.toBeInTheDocument();
  });
  it('uses a filter-aware empty message', async () => {
    mocks.context.authenticatedUser.permissions = ['patients.documents.read'];
    render(<PatientDocumentsPanel patientId={7} />);
    expect(await screen.findByText('No documents have been uploaded for this patient yet.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search title'), { target: { value: 'absent' } });
    await waitFor(() =>
      expect(mocks.request.mock.calls.some((c) => String(c[0]).includes('search=absent'))).toBe(true),
    );
    expect(await screen.findByText('No documents match these filters.')).toBeInTheDocument();
  });
});
