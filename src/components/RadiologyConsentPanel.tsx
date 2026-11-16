import React, { useEffect, useRef, useState } from 'react';
import { useHmis } from '../context/HmisContext.tsx';
import {
  documentAction,
  documentRequest,
  type PatientFile,
} from '../api/patient-documents.client.ts';
import { staticPdfPreview } from '../security/pdf-preview.ts';

export interface RadiologyConsentState {
  status: string;
  policy: { required: boolean; allow_exception: boolean };
  request: {
    id: number;
    patientId: number;
    procedureName: string;
    status: string;
    reportedAt: string | null;
    completed: boolean;
  };
  currentDoctor: { id: number; name: string } | null;
  viewerIsDoctor: boolean;
  reviewDoctors: Array<{ id: number; name: string; designation: string | null }>;
  decision: {
    document_id: number | null;
    clinician_id: number;
    reason: string;
    decided_at: string;
    status: string;
  } | null;
  documents: PatientFile[];
}

const statusLabel: Record<string, string> = {
  CONSENT_REQUIRED: 'No document uploaded',
  AWAITING_VERIFICATION: 'Document uploaded — awaiting doctor review',
  VERIFIED: 'Consent verified',
  REJECTED: 'Consent rejected',
  EXCEPTION: 'Authorized consent exception',
  NOT_REQUIRED: 'No document uploaded — consent not required by facility policy',
  COMPLETED_UNVERIFIED: 'Request reported — no verified pre-procedure consent',
  PROCEDURE_CANCELLED: 'Request cancelled — uploads and decisions disabled',
  UNAVAILABLE: 'Consent status unavailable — do not assume verified',
};
const statusTone = (status: string) =>
  status === 'VERIFIED'
    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
    : status === 'REJECTED' || status === 'PROCEDURE_CANCELLED'
      ? 'border-red-300 bg-red-50 text-red-900'
      : status === 'AWAITING_VERIFICATION' || status === 'COMPLETED_UNVERIFIED'
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-slate-300 bg-slate-50 text-slate-800';

function when(value?: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}
function chosenFileIsSupported(file: File) {
  return /\.(pdf|jpe?g|png)$/i.test(file.name);
}

export function RadiologyConsentPanel(props: {
  orderId: number;
  patientId: number;
  procedureName: string;
  patientName: string;
  onOpenRepository: (doc: PatientFile) => void | Promise<void>;
}) {
  const { authenticatedUser, currentFacility } = useHmis();
  return (
    <RequestConsent
      key={`${authenticatedUser?.id}:${currentFacility?.id}:${props.orderId}:${authenticatedUser?.permissions?.join(',')}`}
      {...props}
    />
  );
}

function RequestConsent({
  orderId,
  patientId,
  procedureName,
  patientName,
  onOpenRepository,
}: {
  orderId: number;
  patientId: number;
  procedureName: string;
  patientName: string;
  onOpenRepository: (doc: PatientFile) => void | Promise<void>;
}) {
  const { authenticatedUser, currentUser } = useHmis();
  const permissions = authenticatedUser?.permissions ?? [];
  const canUpload = permissions.includes('patients.documents.upload');
  const canVerify = permissions.includes('radiology.consent.verify');
  const [state, setState] = useState<RadiologyConsentState | null>(null);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [loadedRevision, setLoadedRevision] = useState(-1);
  const loading = loadedRevision !== revision;
  const [mode, setMode] = useState<'CONSENT' | 'HISTORICAL' | null>(null);
  const [form, setForm] = useState({ title: '', notes: '', reason: '', previousId: '' });
  const [file, setFile] = useState<File | null>(null);
  const [chosenPreview, setChosenPreview] = useState<{
    url: string;
    mime: string;
    name: string;
    derived?: boolean;
  } | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    mime: string;
    title: string;
    derived?: boolean;
  } | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
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
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    documentRequest<RadiologyConsentState>(`/radiology/${orderId}/consent`)
      .then((data) => {
        if (!active) return;
        if (data.request.id !== orderId || data.request.patientId !== patientId)
          throw Error('Consent response does not match this request and patient.');
        setState(data);
        setError('');
        setLoadedRevision(revision);
        setSelectedId((value) =>
          data.documents.some((d) => String(d.id) === value)
            ? value
            : String(data.decision?.document_id ?? data.documents[0]?.id ?? ''),
        );
        setReviewerId((value) =>
          data.currentDoctor
            ? String(data.currentDoctor.id)
            : data.reviewDoctors.some((d) => String(d.id) === value)
              ? value
              : '',
        );
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : 'Consent status could not be loaded.');
          setState(null);
          setLoadedRevision(revision);
        }
      });
    return () => {
      active = false;
    };
  }, [orderId, patientId, revision]);

  useEffect(
    () => () => {
      if (chosenPreview) URL.revokeObjectURL(chosenPreview.url);
    },
    [chosenPreview],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  const selected = state?.documents.find((d) => String(d.id) === selectedId);
  const completed = Boolean(state?.request.completed);
  const cancelled = state?.status === 'PROCEDURE_CANCELLED';
  const reviewer =
    state?.currentDoctor ?? state?.reviewDoctors.find((d) => String(d.id) === reviewerId) ?? null;
  const requiredForVerification = Boolean(
    state?.viewerIsDoctor &&
    canVerify &&
    selected &&
    selected.reviewed_by_actor &&
    acknowledged &&
    !cancelled &&
    !completed,
  );

  async function run(fn: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Consent operation failed.');
    } finally {
      setBusy(false);
    }
  }
  function resetUpload() {
    setMode(null);
    setForm({ title: '', notes: '', reason: '', previousId: '' });
    setFile(null);
    setChosenPreview(null);
    if (fileInput.current) fileInput.current.value = '';
  }
  async function chooseFile(file: File) {
    if (!chosenFileIsSupported(file)) throw Error('Choose a PDF, JPG, JPEG or PNG.');
    setFile(file);
    const mime = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/jpeg');
    const output =
      mime === 'application/pdf'
        ? await staticPdfPreview(new Uint8Array(await file.arrayBuffer()))
        : null;
    setChosenPreview({
      url: URL.createObjectURL(
        output ? new Blob([new Uint8Array(output.bytes).buffer], { type: mime }) : file,
      ),
      mime,
      name: file.name,
      derived: output?.derived,
    });
  }
  async function upload(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      if (!file) throw Error('Choose a PDF, JPG, JPEG or PNG.');
      if (!chosenFileIsSupported(file)) throw Error('Choose a PDF, JPG, JPEG or PNG.');
      if (mode === 'HISTORICAL' && form.reason.trim().length < 10)
        throw Error(
          'Explain in at least 10 characters why this is being attached after reporting.',
        );
      const metadata: Record<string, unknown> = {
        title: form.title,
        notes: form.notes,
        filename: file.name,
        uploadMode: 'SIMPLE',
        radiologyOrderId: orderId,
      };
      if (form.previousId) metadata.previousId = form.previousId;
      if (mode === 'HISTORICAL') {
        metadata.radiologyAttachmentMode = 'HISTORICAL';
        metadata.reason = form.reason;
      }
      const saved = await documentRequest<PatientFile>(`/patients/${patientId}`, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Document-Metadata': encodeURIComponent(JSON.stringify(metadata)),
        },
        body: file,
      });
      setNotice(
        mode === 'HISTORICAL'
          ? 'Historical supporting document attached. It retains its actual upload time and cannot satisfy pre-procedure consent.'
          : 'Consent document uploaded. It is awaiting review by an active doctor; uploading did not verify consent.',
      );
      setSelectedId(String(saved.id));
      setAcknowledged(false);
      resetUpload();
      setRevision((v) => v + 1);
    });
  }
  async function retrieve(doc: PatientFile, download = false) {
    await run(async () => {
      const blob = await documentRequest<Blob>(
        `/patients/${patientId}/${doc.id}/file${download ? '?download=1' : '?preview=1'}`,
      );
      if (download) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download =
          doc.filename ?? `${doc.title}.${doc.mime_type === 'application/pdf' ? 'pdf' : 'img'}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        setPreview({
          url: URL.createObjectURL(blob),
          mime: doc.mime_type,
          title: doc.title,
          derived: (blob as Blob & { derivedPreview?: boolean }).derivedPreview,
        });
      }
      if (!download) setRevision((v) => v + 1);
    });
  }
  async function decision(status: 'VERIFIED' | 'REJECTED') {
    await run(async () => {
      if (!selected || !state?.currentDoctor) return;
      await documentAction(`/radiology/${orderId}/consent`, {
        status,
        documentId: selected.id,
        clinicianId: state.currentDoctor.id,
        ...(status === 'REJECTED' ? { reason: rejectionReason } : {}),
      });
      setNotice(
        status === 'VERIFIED'
          ? 'Consent verified by the signed-in doctor. The audit records the original reviewed.'
          : 'Consent recorded as not accepted. The procedure remains blocked until valid consent is verified.',
      );
      setAcknowledged(false);
      setRejectionReason('');
      setRevision((v) => v + 1);
    });
  }
  const button =
    'mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50';
  const field = 'mt-1 w-full rounded border border-slate-300 p-2 text-sm';
  const status = state?.status ?? 'UNAVAILABLE';

  return (
    <section
      aria-label="Procedure-specific radiology consent"
      className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-xs"
    >
      <header className="space-y-2 break-words">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Procedure-specific consent</h3>
            <p className="text-2xs text-slate-500">
              Imaging request #{orderId} · {state?.request.procedureName ?? procedureName}
            </p>
          </div>
          <span
            aria-label="Consent status"
            className={`rounded-full border px-2.5 py-1 text-2xs font-semibold ${statusTone(status)}`}
          >
            {loading ? 'Loading consent status…' : (statusLabel[status] ?? status)}
          </span>
        </div>
        <p>
          Patient: <strong>{patientName}</strong> · Facility request status:{' '}
          <strong>{state?.request.status ?? 'Unavailable'}</strong>
        </p>
        {state && (
          <p className="text-2xs text-slate-500">
            Facility policy: consent {state.policy.required ? 'required' : 'not required'} ·
            exceptions{' '}
            {state.policy.allow_exception ? 'permitted with authorization' : 'not permitted'}.
            Policy settings are managed under System Configuration.
          </p>
        )}
        {completed && !cancelled && (
          <p className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
            This request is already reported. New documents can only be attached as historical
            supporting documents. They keep their real upload time, are marked as attached after
            reporting, and do not count as pre-procedure consent.
          </p>
        )}
        {cancelled && (
          <p className="rounded border border-red-300 bg-red-50 p-2 text-red-900">
            This request is cancelled. Consent uploads and decisions are disabled.
          </p>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="break-words rounded border border-red-300 bg-red-50 p-2 text-red-900"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="break-words rounded border border-teal-300 bg-teal-50 p-2 text-teal-900"
        >
          {notice}
        </p>
      )}

      {!loading && !cancelled && canUpload && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
            disabled={busy || mode !== null}
            onClick={() => {
              setMode(completed ? 'HISTORICAL' : 'CONSENT');
              setNotice('');
            }}
          >
            {completed ? 'Attach historical supporting document' : 'Upload consent document'}
          </button>
          {completed && (
            <span className="self-center text-2xs text-slate-500">
              Historical only — not pre-procedure consent.
            </span>
          )}
        </div>
      )}
      {!canUpload && !cancelled && (
        <p className="text-2xs text-slate-500">
          Uploading a consent document requires the patient-document upload permission.
        </p>
      )}

      {mode && (
        <form
          aria-label={
            mode === 'HISTORICAL'
              ? 'Attach historical supporting document'
              : 'Upload radiology consent document'
          }
          className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2"
          onSubmit={(e) => void upload(e)}
        >
          <h4 className="font-bold sm:col-span-2">
            {mode === 'HISTORICAL'
              ? 'Attach historical supporting document'
              : 'Upload consent document'}
          </h4>
          <p className="text-2xs text-slate-600 sm:col-span-2">
            Only the title, optional notes and original file are required. The patient, exact
            request, procedure, facility and uploader are recorded from this request and your
            sign-in.
          </p>
          <label>
            Document title
            <input
              className={field}
              required
              maxLength={180}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label>
            Notes (optional)
            <textarea
              className={field}
              maxLength={2000}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          {mode === 'HISTORICAL' && (
            <label className="sm:col-span-2">
              Reason for attaching after reporting
              <textarea
                className={field}
                required
                minLength={10}
                maxLength={500}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </label>
          )}
          <label className="sm:col-span-2">
            Original file (PDF/JPG/JPEG/PNG)
            <input
              ref={fileInput}
              aria-label="Original consent file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              required
              onChange={(e) => {
                const next = e.target.files?.[0] ?? null;
                setFile(next);
                setChosenPreview(null);
                if (next)
                  void run(async () => {
                    await chooseFile(next);
                  });
              }}
            />
          </label>
          {file && (
            <div className="break-words sm:col-span-2">
              <p>Selected file: {file.name}</p>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await chooseFile(file);
                  })
                }
              >
                Preview selected file
              </button>
              <button type="button" className={button} onClick={() => fileInput.current?.click()}>
                Replace selected file
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center sm:col-span-2">
            <button
              type="submit"
              className="mr-2 my-1 rounded bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
              disabled={busy || !file || (mode === 'HISTORICAL' && form.reason.trim().length < 10)}
            >
              {busy
                ? 'Saving…'
                : mode === 'HISTORICAL'
                  ? 'Attach historical document'
                  : 'Upload document'}
            </button>
            <button type="button" className={button} disabled={busy} onClick={resetUpload}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div aria-label="Attached consent documents" className="space-y-2">
        <h4 className="font-semibold text-slate-900">Attached consent documents</h4>
        {loading && <p role="status">Loading authorized consent documents…</p>}
        {!loading && state?.documents.length === 0 && <p>No document uploaded.</p>}
        <ul className="space-y-2">
          {state?.documents.map((doc) => (
            <li
              key={doc.id}
              data-radiology-document={doc.id}
              className="rounded-lg border border-slate-200 p-3 break-words"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <strong>{doc.title}</strong>
                {doc.historical && (
                  <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-2xs font-semibold text-amber-900">
                    Attached after reporting — not pre-procedure consent
                  </span>
                )}
              </div>
              <p>
                Original filename: {doc.filename ?? 'Available on download'} · Version {doc.version}
                {doc.is_latest_version === false ? ' · Superseded' : ''}
              </p>
              <p>
                Uploaded: {when(doc.uploaded_at)} · Uploaded by:{' '}
                {doc.uploader_name ?? 'Staff member (name unavailable)'}
              </p>
              {doc.notes && <p>{doc.notes}</p>}
              <p>
                Review state:{' '}
                {doc.reviewed_by_actor
                  ? 'Original opened by you'
                  : 'Original not yet opened by you'}
              </p>
              <div className="flex flex-wrap">
                <button className={button} disabled={busy} onClick={() => void retrieve(doc)}>
                  Preview original #{doc.id}
                </button>
                <button className={button} disabled={busy} onClick={() => void retrieve(doc, true)}>
                  Download #{doc.id}
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      setHistory(await documentRequest(`/patients/${patientId}/${doc.id}/history`)),
                    )
                  }
                >
                  Version history #{doc.id}
                </button>
                {!completed && canUpload && doc.is_latest_version !== false && (
                  <button
                    className={button}
                    disabled={busy || mode !== null}
                    onClick={() => {
                      setMode('CONSENT');
                      setForm({
                        title: doc.title,
                        notes: doc.notes ?? '',
                        reason: '',
                        previousId: String(doc.id),
                      });
                      setFile(null);
                      setChosenPreview(null);
                      setNotice('');
                    }}
                  >
                    Upload corrected version #{doc.id}
                  </button>
                )}
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void run(async () => onOpenRepository(doc))}
                >
                  Open in Patient Management #{doc.id}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {history && (
        <div
          aria-label="Consent version and audit history"
          className="max-h-72 overflow-auto rounded border p-3"
        >
          <button className={button} onClick={() => setHistory(null)}>
            Close history
          </button>
          {history.versions.map((v) => (
            <p key={v.id}>
              Version {v.version}: {v.title} · Original #{v.id} · Uploaded {when(v.uploaded_at)}
            </p>
          ))}
          {history.events.map((e) => (
            <p key={e.id}>
              {e.action} · actor {e.actor_id ?? 'Patient portal'} · {e.reason} ·{' '}
              {when(e.created_at)}
            </p>
          ))}
        </div>
      )}

      {preview && (
        <section aria-label="Original consent preview" className="space-y-2">
          <h4>{preview.title}</h4>
          <button className={button} onClick={() => setPreview(null)}>
            Close preview
          </button>
          <p className="text-2xs text-slate-600">
            {preview.derived
              ? 'Derived static preview: navigation actions were removed. This is not the original signed document.'
              : 'Preview of the unchanged uploaded original.'}{' '}
            The preview does not prove signature authenticity.
          </p>
          {preview.mime === 'application/pdf' ? (
            <iframe
              title="Original consent PDF preview"
              src={preview.url}
              sandbox=""
              referrerPolicy="no-referrer"
              className="h-96 w-full"
            />
          ) : (
            <img
              alt={preview.title}
              src={preview.url}
              className="max-h-96 max-w-full object-contain"
            />
          )}
        </section>
      )}
      {chosenPreview && (
        <section aria-label="Selected consent file preview" className="space-y-2">
          <h4>Selected file: {chosenPreview.name}</h4>
          <button className={button} onClick={() => setChosenPreview(null)}>
            Close selected file preview
          </button>
          {chosenPreview.mime === 'application/pdf' ? (
            <iframe
              title="Selected consent PDF preview"
              src={chosenPreview.url}
              sandbox=""
              referrerPolicy="no-referrer"
              className="h-96 w-full"
            />
          ) : (
            <img alt={chosenPreview.name} src={chosenPreview.url} className="max-h-96 max-w-full" />
          )}
        </section>
      )}

      {!loading && !cancelled && (
        <div
          aria-label="Doctor consent verification"
          className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
        >
          <h4 className="font-semibold text-slate-900">Doctor verification</h4>
          {completed ? (
            <p>
              This request is already reported. Retrospective consent verification is not available.
              Historical attachments cannot be verified as pre-procedure consent.
            </p>
          ) : !state?.documents.length ? (
            <p>Upload a consent document before verification.</p>
          ) : (
            <>
              <p>
                Uploading is not verification. The doctor must open the saved original, confirm the
                recorded consent information and record the decision under their own sign-in.
              </p>
              <label className="block">
                Selected consent document
                <select
                  className={field}
                  value={selectedId}
                  disabled={busy}
                  onChange={(e) => {
                    setSelectedId(e.target.value);
                    setAcknowledged(false);
                  }}
                >
                  <option value="">Select an attached document</option>
                  {state.documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} · Version {d.version}
                      {d.historical
                        ? ' · historical, not consent'
                        : d.is_latest_version === false
                          ? ' · superseded'
                          : ''}
                    </option>
                  ))}
                </select>
              </label>
              {selected && (
                <div className="space-y-1">
                  <p>
                    Original filename: {selected.filename} · Uploaded: {when(selected.uploaded_at)}
                  </p>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => void retrieve(selected)}
                  >
                    Preview selected original
                  </button>
                  <p className="text-2xs text-slate-600">
                    {selected.reviewed_by_actor
                      ? 'You have opened this original in this session.'
                      : 'Open the original before confirming review.'}
                  </p>
                </div>
              )}
              {state.viewerIsDoctor && state.currentDoctor ? (
                <p>
                  Responsible clinician: <strong>{state.currentDoctor.name}</strong> (you, signed
                  in)
                </p>
              ) : (
                <div className="space-y-1">
                  <label className="block">
                    Responsible clinician for review
                    <select
                      className={field}
                      value={reviewerId}
                      disabled={busy}
                      onChange={(e) => setReviewerId(e.target.value)}
                    >
                      <option value="">Select an active doctor</option>
                      {state.reviewDoctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                          {d.designation ? ` · ${d.designation}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-2xs text-slate-600">
                    Signed in as {currentUser.role || 'a non-doctor account'}. Only an active doctor
                    can verify.{' '}
                    {reviewer
                      ? `${reviewer.name} must sign in and verify.`
                      : 'Select the doctor who will review.'}
                  </p>
                </div>
              )}
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={!state.viewerIsDoctor || busy}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                I have reviewed the original document and confirm the recorded consent information.
              </label>
              <button
                className="rounded bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
                disabled={busy || !requiredForVerification}
                onClick={() => void decision('VERIFIED')}
              >
                Verify consent
              </button>
              {!canVerify && (
                <p className="text-2xs text-slate-600">
                  The radiology consent verification permission is required.
                </p>
              )}
              {canVerify && !state.viewerIsDoctor && (
                <p className="text-2xs text-slate-600">
                  This account cannot record a doctor's verification.
                </p>
              )}
              {state.viewerIsDoctor && canVerify && selected && !selected.reviewed_by_actor && (
                <p className="text-2xs text-slate-600">
                  Preview or download the original to enable confirmation.
                </p>
              )}
              {state.viewerIsDoctor && canVerify && selected?.reviewed_by_actor && (
                <details className="rounded border border-slate-200 bg-white p-2">
                  <summary>Consent not accepted?</summary>
                  <label className="mt-2 block">
                    Reason for not accepting consent
                    <textarea
                      className={field}
                      maxLength={500}
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                    />
                  </label>
                  <button
                    className={button}
                    disabled={busy || rejectionReason.trim().length < 10}
                    onClick={() => void decision('REJECTED')}
                  >
                    Record consent rejection
                  </button>
                </details>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          className={button}
          disabled={busy}
          onClick={() => {
            setAcknowledged(false);
            setRevision((v) => v + 1);
          }}
        >
          Refresh consent status
        </button>
        {state?.decision && (
          <span className="text-2xs text-slate-500">
            Last decision: {statusLabel[state.decision.status] ?? state.decision.status} ·{' '}
            {when(state.decision.decided_at)}
          </span>
        )}
      </div>
    </section>
  );
}
