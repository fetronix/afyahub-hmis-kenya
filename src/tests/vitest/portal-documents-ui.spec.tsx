// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  page: {} as Record<string, any>,
}));
vi.mock('../../api/patient-documents.client.ts', () => ({ documentRequest: mocks.request }));
import { PortalDocuments } from '../../components/portal/PortalDocuments.tsx';
const portalDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Treatment consent form',
  group: 'CONSENT',
  group_label: 'Consent forms',
  kind: 'Treatment consent',
  document_type: 'Patient document',
  category: 'Document',
  signing_date: null,
  uploaded_at: '2026-01-05T09:00:00.000Z',
  version: 1,
  is_superseded: false,
  has_versions: false,
  mime_type: 'application/pdf',
  source: 'Patient records',
  procedure_name: null,
  ...overrides,
});
function pagePayload(overrides: Record<string, unknown> = {}) {
  return {
    documents: [portalDoc()],
    page: { limit: 25, total: 1, returned: 1, has_more: false, next_cursor: null },
    groups: { ALL: 1, CONSENT: 1, CLINICAL: 0, OTHER: 0 },
    empty_state: null,
    filters: { search: '', group: 'ALL', from: null, to: null },
    downloads_enabled: true,
    ...overrides,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.page = pagePayload();
  mocks.request.mockImplementation((path: string) => {
    if (path.includes('/file')) return Promise.resolve(new Blob(['x'], { type: 'application/pdf' }));
    if (path.includes('/history'))
      return Promise.resolve({
        versions: [
          {
            id: 1,
            version: 1,
            title: 'Treatment consent form',
            uploaded_at: '2026-01-05T09:00:00.000Z',
            signing_date: null,
          },
          {
            id: 2,
            version: 2,
            title: 'Treatment consent form',
            uploaded_at: '2026-02-05T09:00:00.000Z',
            signing_date: null,
            current: true,
          },
        ],
      });
    return Promise.resolve(mocks.page);
  });
});
afterEach(cleanup);
describe('Portal documents and signed consents', () => {
  it('groups consent, clinical and other documents with the recorded context', async () => {
    mocks.page = pagePayload({
      documents: [
        portalDoc(),
        portalDoc({
          id: 2,
          title: 'Radiology consent form',
          kind: 'Radiology / procedure consent',
          source: 'Radiology & Imaging',
          procedure_name: 'Chest X-Ray PA View',
        }),
        portalDoc({
          id: 3,
          title: 'Laboratory report',
          group: 'CLINICAL',
          group_label: 'Clinical documents',
          kind: 'Laboratory document',
          source: 'Laboratory & Pathology',
        }),
        portalDoc({
          id: 4,
          title: 'General outpatient letter',
          group: 'OTHER',
          group_label: 'Other documents',
          kind: 'General patient document',
        }),
      ],
      page: { limit: 25, total: 4, returned: 4, has_more: false, next_cursor: null },
      groups: { ALL: 4, CONSENT: 2, CLINICAL: 1, OTHER: 1 },
    });
    render(<PortalDocuments />);
    await screen.findByText('Treatment consent form');
    const consent = screen.getByRole('region', { name: 'Consent forms' });
    expect(within(consent).getByText('Radiology consent form')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Clinical documents' })).getByText(
        'Laboratory report',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Other documents' })).getByText(
        'General outpatient letter',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Imaging procedure: Chest X-Ray PA View/)).toBeInTheDocument();
    expect(
      within(consent).getAllByText(/Document type: Patient document · Version 1/).length,
    ).toBeGreaterThan(0);
    expect(within(consent).getAllByText(/Signing date: Not recorded/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Source: Radiology & Imaging/)).toBeInTheDocument();
  });
  it('never shows staff notes, identities, audit history or release reasons', async () => {
    mocks.page = pagePayload({
      documents: [portalDoc({ notes: 'PRIVATE STAFF NOTE', uploader_name: 'Synthetic Records' })],
    });
    render(<PortalDocuments />);
    await screen.findByText('Treatment consent form');
    expect(screen.queryByText(/PRIVATE STAFF NOTE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Uploaded by/)).not.toBeInTheDocument();
    expect(screen.queryByText(/audit history/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/release reason/i)).not.toBeInTheDocument();
    expect(mocks.request.mock.calls[0][2]).toBe(true);
  });
  it('explains each empty state instead of one generic message', async () => {
    mocks.page = pagePayload({
      documents: [],
      page: { limit: 25, total: 0, returned: 0, has_more: false, next_cursor: null },
      groups: { ALL: 0, CONSENT: 0, CLINICAL: 0, OTHER: 0 },
      empty_state: 'NONE_RELEASED',
    });
    render(<PortalDocuments />);
    expect(
      await screen.findByText('No documents have been released to your portal yet.'),
    ).toBeInTheDocument();
    cleanup();
    mocks.page = pagePayload({
      documents: [],
      page: { limit: 25, total: 0, returned: 0, has_more: false, next_cursor: null },
      groups: { ALL: 0, CONSENT: 0, CLINICAL: 0, OTHER: 0 },
      empty_state: 'AWAITING_RELEASE',
    });
    render(<PortalDocuments />);
    expect(
      await screen.findByText('Your facility has documents awaiting release.'),
    ).toBeInTheDocument();
    cleanup();
    mocks.page = pagePayload({
      documents: [],
      page: { limit: 25, total: 0, returned: 0, has_more: false, next_cursor: null },
      groups: { ALL: 0, CONSENT: 0, CLINICAL: 0, OTHER: 0 },
      empty_state: 'NO_MATCHES',
    });
    render(<PortalDocuments />);
    expect(await screen.findByText('No documents match your current filters.')).toBeInTheDocument();
  });
  it('loads older released documents with a server cursor', async () => {
    mocks.page = pagePayload({
      page: { limit: 25, total: 30, returned: 1, has_more: true, next_cursor: 'next-page' },
    });
    render(<PortalDocuments />);
    await screen.findByText('Treatment consent form');
    expect(screen.getByText('Showing 1 of 30 released document versions.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more documents' }));
    await waitFor(() =>
      expect(String(mocks.request.mock.calls.at(-1)![0])).toContain('cursor=next-page'),
    );
  });
  it('searches and filters on the server', async () => {
    render(<PortalDocuments />);
    await screen.findByText('Treatment consent form');
    fireEvent.change(screen.getByLabelText('Search my documents'), {
      target: { value: 'consent' },
    });
    fireEvent.change(screen.getByLabelText('Document category'), { target: { value: 'OTHER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search documents' }));
    await waitFor(() => {
      const last = String(mocks.request.mock.calls.at(-1)![0]);
      expect(last).toContain('search=consent');
      expect(last).toContain('group=OTHER');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(String(mocks.request.mock.calls.at(-1)![0])).toContain('group=ALL'));
  });
  it('opens the released original, downloads it and lists released versions', async () => {
    mocks.page = pagePayload({ documents: [portalDoc({ has_versions: true })] });
    render(<PortalDocuments />);
    await screen.findByText('Treatment consent form');
    fireEvent.click(screen.getByRole('button', { name: 'View document 1' }));
    expect(await screen.findByLabelText('Document preview')).toBeInTheDocument();
    expect(screen.getByTitle('Released document preview')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Version history 1' }));
    expect(await screen.findByLabelText('Document version history')).toHaveTextContent('Version 2');
    fireEvent.click(screen.getByRole('button', { name: 'Download original 1' }));
    await waitFor(() =>
      expect(
        mocks.request.mock.calls.some((c) => String(c[0]).includes('/file?download=1')),
      ).toBe(true),
    );
  });
  it('disables downloading when the facility policy turns it off', async () => {
    mocks.page = pagePayload({ documents: [portalDoc()], downloads_enabled: false });
    render(<PortalDocuments />);
    await screen.findByText('Treatment consent form');
    expect(screen.getByText(/turned off downloads/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download original 1' })).toBeDisabled();
  });
  it('surfaces an API error instead of pretending the list is empty', async () => {
    mocks.request.mockRejectedValue(Error('Portal document request failed'));
    render(<PortalDocuments />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Portal document request failed');
  });
});
