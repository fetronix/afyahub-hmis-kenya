import React, { useEffect, useState } from 'react';
import { useHmis } from '../context/HmisContext.tsx';
import {
  documentAction,
  documentRequest,
  type PatientFile,
} from '../api/patient-documents.client.ts';
import { PatientDocumentsPanel } from './PatientDocumentsPanel.tsx';

export interface RadiologyConsentState {
  status: string;
  policy: { required: boolean; allow_exception: boolean };
  request: { id: number; patientId: number; procedureName: string; status: string };
  currentDoctor: { id: number; name: string } | null;
  decision: {
    document_id: number | null;
    clinician_id: number;
    reason: string;
    decided_at: string;
  } | null;
  documents: PatientFile[];
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
  const { authenticatedUser } = useHmis();
  const permissions = authenticatedUser?.permissions ?? [];
  const [state, setState] = useState<RadiologyConsentState | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [loadedRevision, setLoadedRevision] = useState(-1);
  const loading = loadedRevision !== revision;
  const [documentId, setDocumentId] = useState(''),
    [reason, setReason] = useState(''),
    [acknowledged, setAcknowledged] = useState(false);
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
        setDocumentId((value) =>
          data.documents.some((d) => String(d.id) === value)
            ? value
            : String(data.decision?.document_id ?? ''),
        );
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setState(null);
          setLoadedRevision(revision);
        }
      });
    return () => {
      active = false;
    };
  }, [orderId, patientId, revision]);
  const selected = state?.documents.find((d) => String(d.id) === documentId);
  const inactive =
    !state ||
    ['cancelled', 'canceled', 'reported', 'performed', 'completed'].includes(
      state.request.status.trim().toLowerCase(),
    );
  const latest = selected?.is_latest_version !== false;
  const complete =
    selected?.patient_signature === 'PRESENT' &&
    selected.doctor_signature === 'PRESENT' &&
    selected.signing_date &&
    selected.doctor_id &&
    selected.procedure_name === state?.request.procedureName;
  async function action(path: string, body: unknown) {
    setError('');
    setBusy(true);
    try {
      await documentAction(path, body);
      setAcknowledged(false);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Consent operation failed.');
    } finally {
      setBusy(false);
    }
  }
  const button =
    'mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50';
  return (
    <section
      aria-label="Procedure-specific radiology consent"
      className="min-w-0 space-y-4 rounded-lg border border-amber-300 bg-amber-50 p-3 sm:p-4"
    >
      <header className="space-y-2 break-words">
        <h3 className="font-bold">Procedure-specific radiology consent · request #{orderId}</h3>
        <p>
          Consent status:{' '}
          <strong>
            {loading
              ? 'Loading — do not assume verified'
              : (state?.status ?? 'Unavailable — do not assume verified')}
          </strong>
        </p>
        <p>
          Procedure: <strong>{state?.request.procedureName ?? procedureName}</strong> · Request #
          {orderId}
        </p>
        <p>
          Selected patient: <strong>{patientName}</strong>
        </p>
        {state && (
          <p>
            Facility policy: consent {state.policy.required ? 'required' : 'not required'};
            exceptions{' '}
            {state.policy.allow_exception
              ? 'permitted only with explicit authorization'
              : 'not permitted'}
            .
          </p>
        )}
        {inactive && state && (
          <p>
            This request is {state.request.status}. New consent uploads and decisions are disabled
            here.
          </p>
        )}
      </header>
      {error && (
        <p role="alert" className="break-words text-red-800">
          {error}
        </p>
      )}
      <PatientDocumentsPanel
        patientId={patientId}
        radiologyOrderId={orderId}
        requestWorkflow={{
          procedureName: state?.request.procedureName ?? procedureName,
          disabled: inactive || loading || busy,
          consentStatus: state?.status ?? 'UNAVAILABLE',
          decisionDocumentId: state?.decision?.document_id ?? null,
          onUploaded: (doc) => {
            setDocumentId(String(doc.id));
            setAcknowledged(false);
            setRevision((v) => v + 1);
          },
          onReviewed: (doc) => {
            setDocumentId(String(doc.id));
            setAcknowledged(false);
            setRevision((v) => v + 1);
          },
          onOpenRepository,
        }}
      />
      <div
        aria-label="Review and verify consent"
        className="space-y-3 rounded border border-amber-300 bg-white p-3"
      >
        <h4 className="font-semibold">Review and verify this procedure consent</h4>
        <p>
          Upload is not verification. Preview the saved original, check both signature assertions
          and the signing date, then record an authorized decision. Assignment is not proof of a
          signature.
        </p>
        <label className="block">
          Attached consent to verify
          <select
            className="mt-1 w-full min-w-0 rounded border p-2"
            value={documentId}
            disabled={busy || loading || inactive}
            onChange={(e) => {
              setDocumentId(e.target.value);
              setAcknowledged(false);
            }}
          >
            <option value="">Select an attached version</option>
            {state?.documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} · Version {d.version}
                {d.is_latest_version === false ? ' · superseded' : ''}
              </option>
            ))}
          </select>
        </label>
        <p>
          Responsible clinician:{' '}
          <strong>
            {selected?.doctor_name ?? 'Select the attached consent to see its responsible doctor'}
          </strong>
        </p>
        {selected && (
          <p>
            Signing date: {selected.signing_date?.slice(0, 10) ?? 'Not recorded'} · Patient
            signature: {selected.patient_signature} · Doctor signature: {selected.doctor_signature}{' '}
            ·{' '}
            {selected.reviewed_by_actor
              ? 'Original retrieved for review'
              : 'Preview the original before verifying'}
          </p>
        )}
        {selected && (!latest || !complete) && (
          <p role="status">
            This version is incomplete, superseded or belongs to an earlier procedure.
            Correct/upload the appropriate signed version; do not reuse unrelated consent.
          </p>
        )}
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={
              !selected?.reviewed_by_actor || !complete || !latest || inactive || busy || loading
            }
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          I reviewed the saved original and confirm the recorded patient and doctor signature
          assertions.
        </label>
        <label className="block">
          Consent decision / policy audit reason
          <textarea
            aria-label="Consent decision audit reason"
            className="mt-1 w-full rounded border p-2"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
        </label>
        {permissions.includes('radiology.consent.verify') && (
          <button
            className={button}
            disabled={
              busy ||
              loading ||
              inactive ||
              !selected?.reviewed_by_actor ||
              !complete ||
              !latest ||
              !acknowledged ||
              reason.trim().length < 10
            }
            onClick={() =>
              void action(`/radiology/${orderId}/consent`, {
                status: 'VERIFIED',
                documentId: selected?.id,
                clinicianId: selected?.doctor_id,
                reason,
              })
            }
          >
            Verify this procedure consent
          </button>
        )}
        {!permissions.includes('radiology.consent.verify') && (
          <p>Procedure consent verification permission is required to record a decision.</p>
        )}
        <button
          className={button}
          disabled={busy || loading}
          onClick={() => {
            setAcknowledged(false);
            setRevision((v) => v + 1);
          }}
        >
          Refresh consent status
        </button>
        {state?.decision && (
          <p>
            Recorded decision: {state.status} · {String(state.decision.decided_at)} ·{' '}
            {state.decision.reason}
          </p>
        )}
        {permissions.includes('radiology.consent.exception') && (
          <div className="rounded border p-2">
            <p>
              Exception authorizing doctor:{' '}
              {state?.currentDoctor?.name ?? 'No active authenticated Doctor identity'}. Policy
              permission, own clinician identity and an audit reason are required.
            </p>
            <button
              className={button}
              disabled={
                busy ||
                loading ||
                inactive ||
                !state?.policy.allow_exception ||
                !state.currentDoctor ||
                reason.trim().length < 10
              }
              onClick={() =>
                void action(`/radiology/${orderId}/consent`, {
                  status: 'EXCEPTION',
                  clinicianId: state?.currentDoctor?.id,
                  reason,
                })
              }
            >
              Record authorized consent exception
            </button>
          </div>
        )}
        {permissions.includes('radiology.consent.policy') && state && (
          <details className="rounded border p-2">
            <summary>Facility-wide radiology consent policy</summary>
            <p>
              Default is consent required, no exceptions. Changes affect the whole facility and
              require a recorded reason.
            </p>
            <button
              className={button}
              disabled={busy || reason.trim().length < 10}
              onClick={() => {
                if (
                  window.confirm(
                    'Require consent and permit explicitly authorized documented exceptions for this facility?',
                  )
                )
                  void action('/radiology-policy', {
                    required: true,
                    allowException: true,
                    reason,
                  });
              }}
            >
              Require consent; allow authorized exceptions
            </button>
            <button
              className={button}
              disabled={busy || reason.trim().length < 10}
              onClick={() =>
                void action('/radiology-policy', { required: true, allowException: false, reason })
              }
            >
              Require consent; disallow exceptions
            </button>
          </details>
        )}
      </div>
    </section>
  );
}
