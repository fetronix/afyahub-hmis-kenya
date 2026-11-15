import React, { useEffect, useRef, useState } from 'react';
import { useHmis } from '../context/HmisContext.tsx';
import {
  documentRequest,
  documentAction,
  type PatientFile,
  type ResponsibleDoctor,
  type ResponsibleDoctorOptions,
} from '../api/patient-documents.client.ts';

export function PatientDocumentsPanel({
  patientId,
  radiologyOrderId,
}: {
  patientId: number;
  radiologyOrderId?: number;
}) {
  const { authenticatedUser, currentFacility } = useHmis();
  return (
    <DocumentWorkspace
      key={`${authenticatedUser?.id}:${currentFacility?.id}:${patientId}:${radiologyOrderId ?? ''}:${authenticatedUser?.permissions?.join(',')}`}
      patientId={patientId}
      radiologyOrderId={radiologyOrderId}
      permissions={authenticatedUser?.permissions ?? []}
    />
  );
}
export function PortalSignedDocuments() {
  return <DocumentWorkspace portal permissions={[]} />;
}
function DocumentWorkspace({
  patientId,
  radiologyOrderId,
  permissions,
  portal = false,
}: {
  patientId?: number;
  radiologyOrderId?: number;
  permissions: string[];
  portal?: boolean;
}) {
  const canRead = portal || permissions.includes('patients.documents.read');
  const canUpload = !portal && permissions.includes('patients.documents.upload') && canRead;
  const base = portal ? '' : `/patients/${patientId}`;
  const [documents, setDocuments] = useState<PatientFile[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
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
  const [preview, setPreview] = useState<{ url: string; mime: string; title: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    title: '',
    category: 'Consent',
    documentType: radiologyOrderId ? 'Radiology procedure consent' : 'Treatment consent',
    signingDate: '',
    patientSignature: 'UNKNOWN',
    doctorSignature: 'UNKNOWN',
    doctorId: '',
    notes: '',
    reason: '',
    previousId: '',
  });
  const [doctorOptions, setDoctorOptions] = useState<ResponsibleDoctorOptions | null>(null);
  const [doctorSearch, setDoctorSearch] = useState('');
  const [selectedDoctor, setSelectedDoctor] = useState<ResponsibleDoctor | null>(null);
  const [doctorError, setDoctorError] = useState('');
  const [doctorsLoading, setDoctorsLoading] = useState(true);
  const doctorInitialized = useRef(false);
  useEffect(() => {
    if (!canUpload) return;
    let active = true;
    const timer = setTimeout(
      () => {
        setDoctorsLoading(true);
        setDoctorError('');
        documentRequest<ResponsibleDoctorOptions>(
          `${base}/doctors?${new URLSearchParams({ search: doctorSearch })}`,
        )
          .then((options) => {
            if (!active) return;
            setDoctorOptions(options);
            if (!doctorInitialized.current) {
              doctorInitialized.current = true;
              setSelectedDoctor(options.currentDoctor);
              setForm((previous) => ({
                ...previous,
                doctorId: String(options.currentDoctor?.id ?? ''),
              }));
            }
            setDoctorsLoading(false);
          })
          .catch((e) => {
            if (!active) return;
            setDoctorError(
              e instanceof Error ? e.message : 'Responsible doctors could not be loaded.',
            );
            setDoctorsLoading(false);
          });
      },
      doctorInitialized.current ? 250 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [base, canUpload, doctorSearch]);
  const requestKey = JSON.stringify([base, portal, search, type, from, to, revision]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;
  const visibleDocuments = loading ? [] : documents;
  useEffect(() => {
    let active = true;
    if (!canRead) return;
    documentRequest<PatientFile[]>(
      `${base}${portal ? '' : `?${new URLSearchParams({ search, type, from, to })}`}`,
      {},
      portal,
    )
      .then((rows) => {
        if (active) {
          setDocuments(rows);
          setLoadedKey(requestKey);
          setError('');
        }
      })
      .catch((e) => {
        if (active) {
          setDocuments([]);
          setLoadedKey(requestKey);
          setError(e.message);
        }
      });
    return () => {
      active = false;
    };
  }, [base, canRead, portal, search, type, from, to, requestKey]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
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
      if (!doctorOptions || doctorError || !form.doctorId)
        throw Error('Select an active responsible doctor before uploading.');
      const metadata = {
        ...form,
        filename: file.name,
        ...(radiologyOrderId ? { radiologyOrderId } : {}),
      };
      await documentRequest(base, {
        method: 'POST',
        headers: {
          'Content-Type': file.type,
          'X-Document-Metadata': encodeURIComponent(JSON.stringify(metadata)),
        },
        body: file,
      });
      setForm({
        ...form,
        title: '',
        reason: '',
        previousId: '',
        signingDate: '',
        patientSignature: 'UNKNOWN',
        doctorSignature: 'UNKNOWN',
        doctorId: String(doctorOptions.currentDoctor?.id ?? ''),
        notes: '',
      });
      setSelectedDoctor(doctorOptions.currentDoctor);
      setDoctorSearch('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      setRevision((v) => v + 1);
    });
  }
  async function retrieve(doc: PatientFile, download: boolean) {
    await run(async () => {
      const blob = await documentRequest<Blob>(
        `${base}/${doc.id}/file${download ? '?download=1' : ''}`,
        {},
        portal,
      );
      if (download) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download =
          doc.filename ?? `${doc.title}.${doc.mime_type === 'application/pdf' ? 'pdf' : 'image'}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else setPreview({ url: URL.createObjectURL(blob), mime: doc.mime_type, title: doc.title });
    });
  }
  const field = 'rounded border border-slate-300 p-2 text-sm w-full';
  return (
    <section
      aria-label={portal ? 'My Documents & Signed Consents' : 'Consent & Signed Documents'}
      className="space-y-4 rounded border bg-white p-4"
    >
      <h3 className="text-lg font-bold">
        {portal ? 'My Documents & Signed Consents' : 'Consent & Signed Documents'}
      </h3>
      <p className="text-sm text-slate-600">
        Original files are preserved. Signature status is recorded by staff; scans are not
        cryptographically authenticated.{' '}
        {portal
          ? 'Only explicitly released documents appear here.'
          : 'Uploading does not imply either signature is present or release a file to the patient portal.'}
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
          {!portal && (
            <div className="grid gap-2 sm:grid-cols-4">
              <label>
                Search title
                <input
                  className={field}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
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
                <input
                  type="date"
                  className={field}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>
          )}
          <button
            className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            disabled={busy}
            onClick={() => setRevision((v) => v + 1)}
          >
            Refresh documents
          </button>
          {loading && <p role="status">Loading authorized document versions…</p>}
          <ul className="space-y-3">
            {visibleDocuments
              .filter((d) => !radiologyOrderId || d.radiology_order_id === radiologyOrderId)
              .map((doc) => (
                <li className="rounded border p-3" key={doc.id}>
                  <strong>{doc.title}</strong> · {doc.category} · {doc.document_type} · Version{' '}
                  {doc.version}
                  <p>
                    Signed: {doc.signing_date?.slice(0, 10) ?? 'Not recorded'} · Uploaded:{' '}
                    {new Date(doc.uploaded_at).toLocaleString()}
                  </p>
                  {!portal && (
                    <>
                      <p>
                        Patient signature: {doc.patient_signature}; doctor signature:{' '}
                        {doc.doctor_signature}; responsible doctor:{' '}
                        {doc.doctor_name ??
                          (doc.doctor_id
                            ? 'Previously assigned doctor (name unavailable)'
                            : 'Not recorded')}
                      </p>
                      {doc.radiology_order_id && (
                        <p>
                          Radiology request #{doc.radiology_order_id}: {doc.procedure_name}
                        </p>
                      )}
                      <p>{doc.notes}</p>
                    </>
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
                    {!portal && (
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
                    )}
                    {canUpload && (
                      <button
                        className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => {
                          setForm({
                            ...form,
                            title: doc.title,
                            previousId: String(doc.id),
                            reason: '',
                          });
                        }}
                      >
                        Create correction of #{doc.id}
                      </button>
                    )}
                    {!portal && permissions.includes('patients.documents.release') && (
                      <button
                        className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            if (form.reason.trim().length < 10)
                              throw Error(
                                'Enter a meaningful audit reason below before release or withdrawal.',
                              );
                            await documentAction(`${base}/${doc.id}/release`, {
                              released: !doc.portal_released,
                              reason: form.reason,
                            });
                            setRevision((v) => v + 1);
                          })
                        }
                      >
                        {doc.portal_released
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
              No authorized documents found. The list is limited to 200 versions; narrow signing
              dates for larger histories.
            </p>
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
                    PDF preview uses your browser’s viewer. If it is unavailable, use Download to
                    open the unchanged original in a trusted PDF viewer.
                  </p>
                  <iframe
                    title="Signed document PDF preview"
                    src={preview.url}
                    className="h-96 w-full"
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
          {!canUpload && !portal && permissions.includes('patients.documents.release') && (
            <label>
              Document audit reason
              <input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </label>
          )}
          {canUpload && (
            <form
              onSubmit={(e) => void upload(e)}
              className="grid gap-3 rounded bg-slate-50 p-3 sm:grid-cols-2"
              aria-label="Upload signed document"
            >
              <h4 className="font-bold sm:col-span-2">
                {form.previousId
                  ? `New version correcting document #${form.previousId}`
                  : 'Upload original document'}
              </h4>
              {(
                ['title', 'category', 'documentType', 'signingDate', 'notes', 'reason'] as const
              ).map((key) => (
                <label key={key}>
                  {
                    {
                      title: 'Document title',
                      category: 'Document category',
                      documentType: 'Consent/document type',
                      signingDate: 'Signing date',
                      notes: 'Internal notes',
                      reason: 'Document audit reason',
                    }[key]
                  }
                  <input
                    type={key === 'signingDate' ? 'date' : 'text'}
                    className={field}
                    value={form[key]}
                    required={['title', 'category', 'documentType', 'reason'].includes(key)}
                    maxLength={key === 'notes' ? 2000 : key === 'reason' ? 500 : 180}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                </label>
              ))}
              <div className="space-y-2">
                {doctorOptions?.canAssignOthers && (
                  <label>
                    Search doctors
                    <input
                      className={field}
                      value={doctorSearch}
                      maxLength={80}
                      placeholder="Search by name or designation"
                      onChange={(e) => setDoctorSearch(e.target.value)}
                    />
                  </label>
                )}
                <label>
                  Responsible doctor
                  <select
                    className={field}
                    required
                    value={form.doctorId}
                    disabled={busy || doctorsLoading || !doctorOptions?.canAssignOthers}
                    onChange={(e) => {
                      const value = e.target.value;
                      const doctor =
                        doctorOptions?.doctors.find((d) => String(d.id) === value) ??
                        (String(selectedDoctor?.id) === value ? selectedDoctor : null);
                      setSelectedDoctor(doctor);
                      setForm({ ...form, doctorId: value });
                    }}
                  >
                    <option value="">Select an active doctor</option>
                    {selectedDoctor &&
                      !doctorOptions?.doctors.some((d) => d.id === selectedDoctor.id) && (
                        <option value={selectedDoctor.id}>
                          {selectedDoctor.name}
                          {selectedDoctor.designation ? ` — ${selectedDoctor.designation}` : ''}
                        </option>
                      )}
                    {doctorOptions?.doctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.name}
                        {doctor.designation ? ` — ${doctor.designation}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {doctorsLoading && <p role="status">Loading responsible doctors…</p>}
                {doctorError && <p role="alert">{doctorError}</p>}
                {doctorOptions && !doctorOptions.canAssignOthers && (
                  <p>
                    Only your own active Doctor identity can be assigned. Selecting another doctor
                    requires patient update permission.
                  </p>
                )}
                {doctorOptions?.canAssignOthers && !selectedDoctor && (
                  <p>Select an active doctor in this facility before uploading.</p>
                )}
                {doctorOptions?.hasMore && (
                  <p>More doctors are available. Refine the search by name or designation.</p>
                )}
              </div>
              {(['patientSignature', 'doctorSignature'] as const).map((key) => (
                <label key={key}>
                  {key === 'patientSignature'
                    ? 'Patient signature status'
                    : 'Doctor signature status'}
                  <select
                    className={field}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  >
                    <option value="UNKNOWN">Unknown / not checked</option>
                    <option value="ABSENT">Absent</option>
                    <option value="PRESENT">Present (staff-observed)</option>
                  </select>
                </label>
              ))}
              <label>
                Original file (PDF/JPG/JPEG/PNG)
                <input
                  ref={fileInput}
                  aria-label="Signed document file"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  required
                />
              </label>
              <p>
                DOCX is not supported: no safe existing preview pipeline. Server enforces configured
                size and decoded content checks.
              </p>
              <button
                className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                type="submit"
                disabled={busy || doctorsLoading || !!doctorError || !form.doctorId}
              >
                {busy ? 'Saving…' : 'Upload document version'}
              </button>
              {form.previousId && (
                <button
                  className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                  type="button"
                  onClick={() => setForm({ ...form, previousId: '' })}
                >
                  Cancel correction
                </button>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
}
