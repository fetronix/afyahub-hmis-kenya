// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  action: vi.fn(),
  context: {
    authenticatedUser: { id: 8, permissions: [] as string[], roles: [] as string[] },
    currentUser: { role: 'Facility Administrator' },
    currentFacility: { id: 1 },
  },
}));
vi.mock('../../context/HmisContext.tsx', () => ({ useHmis: () => mocks.context }));
vi.mock('../../api/patient-documents.client.ts', () => ({
  documentRequest: mocks.request,
  documentAction: mocks.action,
}));
import { RadiologyConsentPanel } from '../../components/RadiologyConsentPanel.tsx';

const document = {
  id: 91,
  patient_id: 7,
  root_id: null,
  version: 1,
  title: 'Synthetic signed consent',
  category: 'Radiology',
  document_type: 'Radiology procedure document',
  signing_date: null,
  uploaded_at: '2026-10-20T09:00:00.000Z',
  patient_signature: 'UNKNOWN',
  doctor_signature: 'UNKNOWN',
  doctor_id: null,
  notes: null,
  filename: 'consent.pdf',
  mime_type: 'application/pdf',
  radiology_order_id: 44,
  procedure_name: 'Synthetic CT head',
  radiology_attachment_context: 'PRE_PROCEDURE' as const,
  historical: false,
  uploaded_by: 8,
  uploader_name: 'Synthetic Records',
  reviewed_by_actor: true,
  is_latest_version: true,
};
const pending = {
  status: 'AWAITING_VERIFICATION',
  policy: { required: true, allow_exception: false },
  request: {
    id: 44,
    patientId: 7,
    procedureName: 'Synthetic CT head',
    status: 'Requested',
    reportedAt: null,
    completed: false,
  },
  currentDoctor: null,
  viewerIsDoctor: false,
  reviewDoctors: [{ id: 9, name: 'Synthetic Doctor', designation: 'Medical officer' }],
  decision: null,
  documents: [document],
};
const doctor = { id: 9, name: 'Synthetic Doctor' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.authenticatedUser = {
    id: 8,
    permissions: ['patients.documents.read', 'patients.documents.upload'],
    roles: ['FACILITY_ADMIN'],
  };
  mocks.context.currentUser = { role: 'Facility Administrator' };
  mocks.request.mockImplementation((path: string) => {
    if (path === '/radiology/44/consent') return Promise.resolve(structuredClone(pending));
    if (path.endsWith('/file?preview=1'))
      return Promise.resolve(new Blob(['synthetic'], { type: 'application/pdf' }));
    if (path.endsWith('/history')) return Promise.resolve({ versions: [document], events: [] });
    return Promise.resolve({ ...document, id: 92 });
  });
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:synthetic'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(cleanup);

function renderPanel() {
  return render(
    <RadiologyConsentPanel
      orderId={44}
      patientId={7}
      procedureName="Synthetic CT head"
      patientName="Synthetic Patient"
      onOpenRepository={vi.fn()}
    />,
  );
}
function choosePng() {
  fireEvent.change(screen.getByLabelText('Original consent file'), {
    target: {
      files: [new File([new Uint8Array([1, 2, 3])], 'consent.png', { type: 'image/png' })],
    },
  });
}

describe('Simplified radiology consent upload and doctor verification', () => {
  it('shows the simple upload form with only title, optional notes and the original file', async () => {
    renderPanel();
    await screen.findByText('Document uploaded — awaiting doctor review');
    fireEvent.click(screen.getByRole('button', { name: 'Upload consent document' }));
    const form = screen.getByRole('form', { name: 'Upload radiology consent document' });
    expect(form.querySelectorAll('input,textarea,select')).toHaveLength(3);
    expect(screen.getByLabelText('Document title')).toBeRequired();
    expect(screen.getByLabelText('Notes (optional)')).not.toBeRequired();
    expect(screen.getByLabelText('Original consent file')).toBeRequired();
    for (const forbidden of [
      'Patient ID',
      'Imaging request ID',
      'Facility ID',
      'Doctor user ID',
      'Document category',
      'Consent type',
      'Signing date',
      'Audit reason',
      'Patient signature status',
      'Doctor signature status',
    ])
      expect(screen.queryByLabelText(forbidden)).not.toBeInTheDocument();
  });

  it('uploads title/notes/file and lets the server resolve patient, request and procedure', async () => {
    renderPanel();
    await screen.findByText('Document uploaded — awaiting doctor review');
    fireEvent.click(screen.getByRole('button', { name: 'Upload consent document' }));
    fireEvent.change(screen.getByLabelText('Document title'), {
      target: { value: 'Signed CT consent' },
    });
    fireEvent.change(screen.getByLabelText('Notes (optional)'), {
      target: { value: 'Synthetic optional notes' },
    });
    choosePng();
    expect(
      within(screen.getByRole('form', { name: 'Upload radiology consent document' })).getByText(
        'Selected file: consent.png',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace selected file' })).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('form', { name: 'Upload radiology consent document' }));
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('/patients/7', expect.anything()),
    );
    const call = mocks.request.mock.calls.find((c) => c[0] === '/patients/7')!;
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(decodeURIComponent(call[1].headers['X-Document-Metadata']))).toMatchObject({
      title: 'Signed CT consent',
      notes: 'Synthetic optional notes',
      filename: 'consent.png',
      uploadMode: 'SIMPLE',
      radiologyOrderId: 44,
    });
    const metadata = JSON.parse(decodeURIComponent(call[1].headers['X-Document-Metadata']));
    for (const forbidden of [
      'patientId',
      'facilityId',
      'doctorId',
      'category',
      'documentType',
      'signingDate',
      'patientSignature',
      'doctorSignature',
      'reason',
    ])
      expect(metadata).not.toHaveProperty(forbidden);
    expect(
      await screen.findByText(
        'Consent document uploaded. It is awaiting review by an active doctor; uploading did not verify consent.',
      ),
    ).toBeInTheDocument();
  });

  it('shows filename, upload date, uploader, preview, download and version history for attachments', async () => {
    renderPanel();
    await screen.findByText('Document uploaded — awaiting doctor review');
    const item = window.document.querySelector('[data-radiology-document="91"]') as HTMLElement;
    expect(within(item).getByText(/Original filename: consent\.pdf/)).toBeInTheDocument();
    expect(within(item).getByText(/Uploaded by: Synthetic Records/)).toBeInTheDocument();
    for (const button of [
      'Preview original #91',
      'Download #91',
      'Version history #91',
      'Open in Patient Management #91',
    ])
      expect(screen.getByRole('button', { name: button })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview original #91' }));
    await screen.findByTitle('Original consent PDF preview');
    fireEvent.click(screen.getByRole('button', { name: 'Version history #91' }));
    expect(await screen.findByLabelText('Consent version and audit history')).toBeInTheDocument();
  });

  it('does not let an administrator or non-doctor record doctor verification', async () => {
    mocks.context.authenticatedUser = {
      id: 8,
      permissions: [
        'patients.documents.read',
        'patients.documents.upload',
        'radiology.consent.verify',
      ],
      roles: ['FACILITY_ADMIN'],
    };
    mocks.context.currentUser = { role: 'Facility Administrator' };
    renderPanel();
    await screen.findByText('Document uploaded — awaiting doctor review');
    expect(screen.getByLabelText('Responsible clinician for review')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Responsible clinician for review'), {
      target: { value: '9' },
    });
    expect(screen.getByRole('button', { name: 'Verify consent' })).toBeDisabled();
    expect(screen.getByText(/Only an active doctor can verify/)).toBeInTheDocument();
    expect(
      screen.getByText(/This account cannot record a doctor's verification/),
    ).toBeInTheDocument();
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it('auto-identifies an authenticated doctor and records self verification after review', async () => {
    mocks.context.authenticatedUser = {
      id: 9,
      permissions: [
        'patients.documents.read',
        'patients.documents.upload',
        'radiology.consent.verify',
      ],
      roles: ['DOCTOR'],
    };
    mocks.context.currentUser = { role: 'Medical officer' };
    const state = {
      ...structuredClone(pending),
      currentDoctor: doctor,
      viewerIsDoctor: true,
      reviewDoctors: [],
    };
    mocks.request.mockImplementation((path: string) => {
      if (path === '/radiology/44/consent') return Promise.resolve(structuredClone(state));
      return Promise.resolve({ ...document, id: 92 });
    });
    renderPanel();
    await screen.findByText('Document uploaded — awaiting doctor review');
    expect(screen.getByText(/Responsible clinician:/)).toHaveTextContent(doctor.name);
    fireEvent.click(screen.getByText(/I have reviewed the original document/));
    const verify = screen.getByRole('button', { name: 'Verify consent' });
    await waitFor(() => expect(verify).toBeEnabled());
    fireEvent.click(verify);
    await waitFor(() => expect(mocks.action).toHaveBeenCalled());
    expect(mocks.action).toHaveBeenCalledWith('/radiology/44/consent', {
      status: 'VERIFIED',
      documentId: 91,
      clinicianId: doctor.id,
    });
  });

  it('shows reported requests as historical-only and disables retrospective verification', async () => {
    const historicalDocument = {
      ...structuredClone(document),
      radiology_attachment_context: 'POST_REPORTING_HISTORICAL' as const,
      historical: true,
      uploaded_at: '2026-10-27T10:00:00.000Z',
    };
    const state = {
      ...structuredClone(pending),
      status: 'COMPLETED_UNVERIFIED',
      request: {
        ...pending.request,
        status: 'Reported',
        reportedAt: '2026-10-25T08:00:00.000Z',
        completed: true,
      },
      documents: [historicalDocument],
    };
    mocks.request.mockImplementation((path: string) => {
      if (path === '/radiology/44/consent') return Promise.resolve(structuredClone(state));
      return Promise.resolve({ ...historicalDocument, id: 93 });
    });
    renderPanel();
    await screen.findByText('Request reported — no verified pre-procedure consent');
    expect(screen.getByText(/cannot be verified as pre-procedure consent/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Upload consent document' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify consent' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Attached after reporting — not pre-procedure consent/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Attach historical supporting document' }));
    const form = screen.getByRole('form', { name: 'Attach historical supporting document' });
    expect(form.querySelectorAll('input,textarea,select')).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Document title'), {
      target: { value: 'Late supporting document' },
    });
    fireEvent.change(screen.getByLabelText('Reason for attaching after reporting'), {
      target: { value: 'Found in the paper file after the report was issued' },
    });
    choosePng();
    fireEvent.submit(form);
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('/patients/7', expect.anything()),
    );
    const call = mocks.request.mock.calls.find((c) => c[0] === '/patients/7')!;
    expect(JSON.parse(decodeURIComponent(call[1].headers['X-Document-Metadata']))).toMatchObject({
      radiologyOrderId: 44,
      radiologyAttachmentMode: 'HISTORICAL',
      reason: 'Found in the paper file after the report was issued',
    });
    expect(await screen.findByText(/Historical supporting document attached/)).toBeInTheDocument();
  });
});
