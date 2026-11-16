import { staticPdfPreview } from '../security/pdf-preview.ts';
import React, { useEffect, useRef, useState } from 'react';
import { useHmis } from '../context/HmisContext.tsx';
import {
  documentRequest,
  documentAction,
  type DocumentPageInfo,
  type PatientFile,
  type StaffDocumentPage,
} from '../api/patient-documents.client.ts';

const CONSENT_PATTERN = /consent|authoris|authoriz/i;
/** A display aid only: the server decides the category and enforces consent review. */
function isConsentDocument(doc: PatientFile) {
  if (doc.radiology_order_id) return doc.radiology_attachment_context !== 'POST_REPORTING_HISTORICAL';
  return CONSENT_PATTERN.test(`${doc.title} ${doc.category} ${doc.document_type}`);
}
function releaseStatus(doc: PatientFile) {
  if (doc.portal_release_status === 'RELEASED')
    return doc.portal_released_at
      ? `Released to patient portal on ${new Date(doc.portal_released_at).toLocaleString()}`
      : 'Released to patient portal';
  if (doc.portal_release_status === 'REVOKED')
    return doc.portal_revoked_at
      ? `Release revoked on ${new Date(doc.portal_revoked_at).toLocaleString()}`
      : 'Release revoked';
  return 'Not released to the patient portal';
}
export function PatientDocumentsPanel({ patientId }: { patientId: number }) {
  const {
    authenticatedUser,
    currentFacility,
    currentTenant,
    clinicalDocumentTarget,
    setClinicalDocumentTarget,
    setActiveModule,
    setIsJourneyModalOpen,
  } = useHmis();
  return (
    <DocumentWorkspace
      key={`${authenticatedUser?.id}:${currentFacility?.id}:${patientId}:${authenticatedUser?.permissions?.join(',')}`}
      patientId={patientId}
      permissions={authenticatedUser?.permissions ?? []}
      focusDocumentId={
        clinicalDocumentTarget?.kind === 'repository' &&
        clinicalDocumentTarget.patientId === patientId &&
        clinicalDocumentTarget.facilityId === currentFacility?.id &&
        clinicalDocumentTarget.tenantId === currentTenant?.id
          ? clinicalDocumentTarget.documentId
          : undefined
      }
      onOpenOrigin={
        authenticatedUser?.permissions?.some((p) =>
          ['clinical.read', 'laboratory.read'].includes(p),
        ) &&
        currentFacility?.enabledModules?.includes('radiology') &&
        !currentFacility.hiddenModules?.includes('radiology') &&
        currentTenant
          ? (doc) => {
              if (!doc.radiology_order_id) return;
              setClinicalDocumentTarget({
                kind: 'radiology',
                tenantId: currentTenant.id,
                facilityId: currentFacility.id,
                patientId,
                documentId: doc.id,
                orderId: doc.radiology_order_id,
              });
              setIsJourneyModalOpen(false);
              setActiveModule('radiology');
            }
          : undefined
      }
    />
  );
}
function DocumentWorkspace({
  patientId,
  permissions,
  focusDocumentId,
  onOpenOrigin,
}: {
  patientId: number;
  permissions: string[];
  focusDocumentId?: number;
  onOpenOrigin?: (doc: PatientFile) => void;
}) {
  const canRead = permissions.includes('patients.documents.read');
  const canUpload = permissions.includes('patients.documents.upload') && canRead;
  const canRelease = permissions.includes('patients.documents.release') && canRead;
  const base = `/patients/${patientId}`;
  const [details, setDetails] = useState<PatientFile | null>(null);
  const [documents, setDocuments] = useState<PatientFile[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [page, setPage] = useState<DocumentPageInfo | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState(''),
    [type, setType] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [history, setHistory] = useState<{
    versions: PatientFile[];
    events: Array<{
      id: number;
      action: string;
      reason: string;
      created_at: string;
      actor_id: number | null;
    }>;
  } | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    mime: string;
    title: string;
    derived?: boolean;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ title: '', notes: '', previousId: '' });
  const [release, setRelease] = useState<{
    docs: PatientFile[];
    released: boolean;
    reason: string;
    reviewed: boolean;
    previewId?: number;
  } | null>(null);
  const requestKey = JSON.stringify([base, search, type, from, to, revision, cursor]);
  useEffect(() => {
    let active = true;
    if (!canRead) return;
    setLoading(true);
    const query = new URLSearchParams({
      search,
      type,
      from,
      to,
      limit: '25',
      paginate: '1',
    });
    if (cursor) query.set('cursor', cursor);
    documentRequest<StaffDocumentPage>(`${base}?${query.toString()}`)
      .then((result) => {
        if (!active) return;
        setDocuments((current) =>
          cursor
            ? [...current, ...result.documents.filter((d) => !current.some((c) => c.id === d.id))]
            : result.documents,
        );
        setPage(result.page);
        setError('');
      })
      .catch((e: Error) => {
        if (!active) return;
        if (!cursor) setDocuments([]);
        setError(e.message);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setLoadingMore(false);
        }
      });
    return () => {
      active = false;
    };
    // `requestKey` covers every request input.
  }, [base, canRead, requestKey]);
  useEffect(() => {
    if (!loading && focusDocumentId)
      document
        .querySelector(`[data-patient-document="${focusDocumentId}"]`)
        ?.scrollIntoView?.({ block: 'center' });
  }, [loading, focusDocumentId]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const visibleDocuments = loading ? [] : documents;
  const consentSelection = release?.docs.filter(isConsentDocument) ?? [];
  async function run(fn: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Document operation failed.');
    } finally {
      setBusy(false);
    }
  }
  async function upload(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      if (!file) throw Error('Choose a PDF, JPG, JPEG or PNG.');
      const metadata = { ...form, uploadMode: 'SIMPLE', filename: file.name };
      await documentRequest<PatientFile>(base, {
        method: 'POST',
        headers: {
          'Content-Type': file.type,
          'X-Document-Metadata': encodeURIComponent(JSON.stringify(metadata)),
        },
        body: file,
      });
      setForm({ title: '', notes: '', previousId: '' });
      setFile(null);
      setPreview(null);
      if (fileInput.current) fileInput.current.value = '';
      setRevision((v) => v + 1);
    });
  }
  async function retrieve(doc: PatientFile, download: boolean) {
    await run(async () => {
      const blob = await documentRequest<Blob>(
        `${base}/${doc.id}/file${download ? '?download=1' : '?preview=1'}`,
        {},
      );
      if (download) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download =
          doc.filename ?? `${doc.title}.${doc.mime_type === 'application/pdf' ? 'pdf' : 'image'}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else
        setPreview({
          url: URL.createObjectURL(blob),
          mime: doc.mime_type,
          title: doc.title,
          derived: (blob as Blob & { derivedPreview?: boolean }).derivedPreview,
        });
    });
  }
  async function previewForRelease(doc: PatientFile) {
    await run(async () => {
      const blob = await documentRequest<Blob>(`${base}/${doc.id}/file?preview=1`);
      if (release?.previewId && release.previewId !== doc.id) URL.revokeObjectURL(preview?.url ?? '');
      setPreview({
        url: URL.createObjectURL(blob),
        mime: doc.mime_type,
        title: `Release review: ${doc.title}`,
        derived: (blob as Blob & { derivedPreview?: boolean }).derivedPreview,
      });
      setRelease((current) => (current ? { ...current, previewId: doc.id } : current));
    });
  }
  async function submitRelease(e: React.FormEvent) {
    e.preventDefault();
    if (!release) return;
    await run(async () => {
      const body = {
        released: release.released,
        reason: release.reason,
        reviewedOriginal: release.reviewed,
      };
      if (release.docs.length === 1)
        await documentAction(`${base}/${release.docs[0].id}/release`, body);
      else
        await documentAction(`${base}/releases`, {
          ...body,
          documentIds: release.docs.map((d) => d.id),
        });
      setRelease(null);
      setSelected([]);
      setPreview(null);
      setCursor(null);
      setRevision((v) => v + 1);
    });
  }
  function toggleSelected(id: number) {
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }
  const field = 'rounded border border-slate-300 p-2 text-sm w-full';
  const actionClass =
    'mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50';
  const uploadForm = canUpload && (
    <form
      onSubmit={(e) => void upload(e)}
      className="grid gap-3 rounded bg-slate-50 p-3 sm:grid-cols-2"
      aria-label="Upload document"
    >
      <h4 className="font-bold sm:col-span-2">
        {form.previousId
          ? `New version correcting document #${form.previousId}`
          : 'Upload document'}
      </h4>
      <label>
        Document title
        <input
          className={field}
          value={form.title}
          required
          maxLength={180}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </label>
      <label>
        Notes (optional)
        <textarea
          className={field}
          value={form.notes}
          maxLength={2000}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </label>
      <label>
        Original file (PDF/JPG/JPEG/PNG)
        <input
          ref={fileInput}
          aria-label="Signed document file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
          }}
          required
        />
      </label>
      {file && (
        <div className="sm:col-span-2 break-all">
          <p>Selected file: {file.name}</p>
          <button
            type="button"
            className={actionClass}
            onClick={() =>
              void run(async () => {
                const mime =
                  file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/jpeg');
                const output =
                  mime === 'application/pdf'
                    ? await staticPdfPreview(new Uint8Array(await file.arrayBuffer()))
                    : null;
                setPreview({
                  url: URL.createObjectURL(
                    output ? new Blob([new Uint8Array(output.bytes).buffer], { type: mime }) : file,
                  ),
                  mime,
                  title: `Selected file: ${file.name}`,
                  derived: output?.derived,
                });
              })
            }
          >
            Preview selected file
          </button>
          <button type="button" className={actionClass} onClick={() => fileInput.current?.click()}>
            Replace selected file
          </button>
        </div>
      )}
      <button
        className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        type="submit"
        disabled={busy}
      >
        {busy ? 'Uploading…' : 'Upload document'}
      </button>
      {form.previousId && (
        <button
          className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          type="button"
          onClick={() => {
            setForm({ title: '', notes: '', previousId: '' });
            setFile(null);
            setPreview(null);
            if (fileInput.current) fileInput.current.value = '';
          }}
        >
          Cancel correction
        </button>
      )}
    </form>
  );

  return (
    <section aria-label="Consent & Signed Documents" className="space-y-4 rounded border bg-white p-4">
      <h3 className="text-lg font-bold">Consent &amp; Signed Documents</h3>
      <p className="text-sm text-slate-600">
        Original files are preserved. Uploading a document does not automatically verify signatures
        or release it to the patient portal.
      </p>
      {!canRead ? (
        <p role="alert">A facility-scoped patient-document read permission is required.</p>
      ) : (
        <>
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          {canRead && !canRelease && (
            <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
              You can view and upload documents but not release them. Portal release needs the
              “Release patient documents to portal” permission; a facility administrator can grant it
              under System Configuration → Staff Roles.
            </p>
          )}
          {uploadForm}
          <div className="grid gap-2 sm:grid-cols-4">
            <label>
              Search title
              <input className={field} value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <label>
              Document type filter
              <input className={field} value={type} onChange={(e) => setType(e.target.value)} />
            </label>
            <label>
              Signing date from
              <input
                type="date"
                className={field}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              Signing date to
              <input type="date" className={field} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
              disabled={busy}
              onClick={() => setRevision((v) => v + 1)}
            >
              Refresh documents
            </button>
            {canRelease && selected.length > 0 && (
              <>
                <button
                  className="mr-2 my-1 rounded bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() =>
                    setRelease({
                      docs: documents.filter((d) => selected.includes(d.id)),
                      released: true,
                      reason: '',
                      reviewed: false,
                    })
                  }
                >
                  Release selected ({selected.length}) to patient portal
                </button>
                {documents.some(
                  (d) => selected.includes(d.id) && d.portal_release_status === 'RELEASED',
                ) && (
                  <button
                    className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
                    disabled={busy}
                    onClick={() =>
                      setRelease({
                        docs: documents.filter(
                          (d) => selected.includes(d.id) && d.portal_release_status === 'RELEASED',
                        ),
                        released: false,
                        reason: '',
                        reviewed: false,
                      })
                    }
                  >
                    Withdraw selected releases
                  </button>
                )}
              </>
            )}
            {canRelease && documents.length > 0 && (
              <button
                className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                onClick={() =>
                  setSelected(
                    selected.length === documents.length ? [] : documents.map((d) => d.id),
                  )
                }
              >
                {selected.length === documents.length ? 'Clear selection' : 'Select all visible'}
              </button>
            )}
          </div>
          {loading && <p role="status">Loading authorized document versions…</p>}
          <ul className="space-y-3">
            {visibleDocuments.map((doc) => (
              <li
                className={`rounded border p-3 break-words ${focusDocumentId === doc.id ? 'ring-2 ring-teal-700' : ''}`}
                key={doc.id}
                data-patient-document={doc.id}
              >
                {canRelease && (
                  <label className="mb-2 block text-sm">
                    <input
                      type="checkbox"
                      aria-label={`Select ${doc.title} #${doc.id}`}
                      checked={selected.includes(doc.id)}
                      onChange={() => toggleSelected(doc.id)}
                    />{' '}
                    Select for portal release
                  </label>
                )}
                <strong>{doc.title}</strong>
                <p>
                  Uploaded: {new Date(doc.uploaded_at).toLocaleString()} · Uploaded by:{' '}
                  {doc.uploader_name ?? 'Staff member (name unavailable)'}
                </p>
                <p>
                  Original filename: {doc.filename ?? 'Available on download'} · Version{' '}
                  {doc.version}
                  {doc.is_latest_version === false ? ' · Superseded' : ''}
                </p>
                <p
                  className={
                    doc.portal_release_status === 'RELEASED'
                      ? 'text-emerald-800'
                      : doc.portal_release_status === 'REVOKED'
                        ? 'text-rose-800'
                        : 'text-slate-600'
                  }
                >
                  Portal: {releaseStatus(doc)}
                </p>
                {doc.notes && <p>{doc.notes}</p>}
                <p>
                  Source/context:{' '}
                  {doc.radiology_order_id
                    ? 'Radiology document'
                    : /laboratory|lab report/i.test(`${doc.category} ${doc.document_type}`)
                      ? 'Laboratory document (no linked request recorded)'
                      : 'General patient document'}
                </p>
                {doc.radiology_order_id && (
                  <p>
                    Imaging request #{doc.radiology_order_id}: {doc.procedure_name}
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  <button
                    className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void retrieve(doc, false)}
                  >
                    Preview {doc.title}
                  </button>
                  <button
                    className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void retrieve(doc, true)}
                  >
                    Download {doc.title}
                  </button>
                  <button className={actionClass} disabled={busy} onClick={() => setDetails(doc)}>
                    View document details #{doc.id}
                  </button>
                  {doc.radiology_order_id && onOpenOrigin && (
                    <button className={actionClass} onClick={() => onOpenOrigin(doc)}>
                      Open imaging request #{doc.radiology_order_id}
                    </button>
                  )}
                  <button
                    className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        setHistory(await documentRequest(`${base}/${doc.id}/history`)),
                      )
                    }
                  >
                    Version & audit history #{doc.id}
                  </button>
                  {canUpload && (
                    <button
                      className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                      disabled={busy || doc.is_latest_version === false}
                      onClick={() => {
                        setForm({
                          title: doc.title,
                          notes: doc.notes ?? '',
                          previousId: String(doc.id),
                        });
                        setFile(null);
                        setPreview(null);
                        if (fileInput.current) fileInput.current.value = '';
                      }}
                    >
                      Create correction of #{doc.id}
                    </button>
                  )}
                  {canRelease && (
                    <button
                      className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                      disabled={busy}
                      onClick={() =>
                        setRelease({
                          docs: [doc],
                          released: doc.portal_release_status !== 'RELEASED',
                          reason: '',
                          reviewed: false,
                        })
                      }
                    >
                      {doc.portal_release_status === 'RELEASED'
                        ? 'Withdraw portal release'
                        : 'Release to patient portal'}{' '}
                      #{doc.id}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!loading && visibleDocuments.length === 0 && !error && (
            <p>
              {search || type || from || to
                ? 'No documents match these filters.'
                : 'No documents have been uploaded for this patient yet.'}
            </p>
          )}
          {page && page.total > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                Showing {documents.length} of {page.total} document versions.
              </p>
              <button
                className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                disabled={loadingMore || !page.has_more}
                onClick={() => {
                  if (!page.next_cursor) return;
                  setLoadingMore(true);
                  setCursor(page.next_cursor);
                }}
              >
                {page.has_more ? 'Load more documents' : 'All document versions loaded'}
              </button>
            </div>
          )}
          {details && (
            <div aria-label="Signed document details" className="rounded border p-3 break-words">
              <h4 className="font-semibold">
                {details.title} · document #{details.id}
              </h4>
              <p>
                Type: {details.document_type} · Version {details.version} · File: {details.filename}
              </p>
              <p>
                Signed: {details.signing_date?.slice(0, 10) ?? 'Not recorded'} · Uploaded:{' '}
                {new Date(details.uploaded_at).toLocaleString()}
              </p>
              <p>
                Responsible doctor: {details.doctor_name ?? 'Not recorded'} · Patient signature:{' '}
                {details.patient_signature} · Doctor signature: {details.doctor_signature}
              </p>
              <p>{releaseStatus(details)}</p>
              <p>
                {details.radiology_order_id
                  ? `Radiology request #${details.radiology_order_id}: ${details.procedure_name}`
                  : 'General patient document — no request link recorded'}
              </p>
              <p>{details.notes}</p>
              <button className={actionClass} onClick={() => setDetails(null)}>
                Close document details
              </button>
            </div>
          )}
          {history && (
            <div
              aria-label="Document version and audit history"
              className="max-h-80 overflow-auto rounded border p-3"
            >
              <button
                className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                onClick={() => setHistory(null)}
              >
                Close history
              </button>
              {history.versions.map((v) => (
                <p key={v.id}>
                  Version {v.version}: {v.title} · Original #{v.id} · Responsible doctor:{' '}
                  {v.doctor_name ??
                    (v.doctor_id
                      ? 'Previously assigned doctor (name unavailable)'
                      : 'Not recorded')}
                </p>
              ))}
              {history.events.map((e) => (
                <p key={e.id}>
                  {e.action} · actor {e.actor_id ?? 'Patient portal'} · {e.reason} ·{' '}
                  {String(e.created_at)}
                </p>
              ))}
            </div>
          )}
          {preview && (
            <section aria-label="Signed document preview">
              <h4>{preview.title}</h4>
              <button
                className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                onClick={() => setPreview(null)}
              >
                Close preview
              </button>
              {preview.mime === 'application/pdf' ? (
                <>
                  <p className="text-xs text-slate-600">
                    {preview.derived
                      ? 'Derived static preview: navigation actions have been removed. This copy is not the original signed document.'
                      : 'Preview of the unchanged uploaded original.'}{' '}
                    Neither preview proves signature authenticity. Use Download for the unchanged
                    original. PDF display uses your browser’s viewer.
                  </p>
                  <iframe
                    title="Signed document PDF preview"
                    src={preview.url}
                    className="h-96 w-full"
                    sandbox=""
                    referrerPolicy="no-referrer"
                  />
                </>
              ) : (
                <img
                  alt={preview.title}
                  src={preview.url}
                  className="max-h-96 max-w-full object-contain"
                />
              )}
            </section>
          )}
          {release && canRelease && (
            <form
              aria-label="Portal release decision"
              onSubmit={(e) => void submitRelease(e)}
              className="space-y-2 rounded border border-teal-700 p-3"
            >
              <h4 className="font-semibold">
                {release.released ? 'Release' : 'Withdraw'} {release.docs.length} document
                {release.docs.length === 1 ? '' : 's'} {release.released ? 'to' : 'from'} the patient
                portal
              </h4>
              <p className="text-sm text-slate-600">
                Releasing makes the original available to this patient only. It does not mark the
                document signed or verified.
              </p>
              <ul className="space-y-2">
                {release.docs.map((doc) => (
                  <li key={doc.id} className="rounded bg-slate-50 p-2 text-sm">
                    <p>
                      <strong>{doc.title}</strong> · {doc.document_type} · Version {doc.version}
                    </p>
                    <p>
                      Recorded signing date: {doc.signing_date ?? 'Not recorded'} · Recorded patient
                      signature: {doc.patient_signature} · Recorded doctor signature:{' '}
                      {doc.doctor_signature}
                    </p>
                    <button
                      type="button"
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                      disabled={busy}
                      onClick={() => void previewForRelease(doc)}
                    >
                      Review original #{doc.id}
                    </button>
                  </li>
                ))}
              </ul>
              {release.released && consentSelection.length > 0 && (
                <label className="block text-sm">
                  <input
                    type="checkbox"
                    required
                    aria-label="Reviewed original consent document"
                    checked={release.reviewed}
                    onChange={(e) =>
                      setRelease((current) =>
                        current ? { ...current, reviewed: e.target.checked } : current,
                      )
                    }
                  />{' '}
                  I reviewed the original consent document
                  {consentSelection.length === 1 ? '' : 's'} ({consentSelection.length}) before
                  releasing {consentSelection.length === 1 ? 'it' : 'them'}.
                </label>
              )}
              <label className="block text-sm">
                Portal release reason
                <textarea
                  className={field}
                  required
                  minLength={10}
                  maxLength={500}
                  value={release.reason}
                  onChange={(e) =>
                    setRelease((current) =>
                      current ? { ...current, reason: e.target.value } : current,
                    )
                  }
                />
              </label>
              <button className={actionClass} disabled={busy} type="submit">
                Confirm portal release decision
              </button>
              <button className={actionClass} type="button" onClick={() => setRelease(null)}>
                Cancel release decision
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
