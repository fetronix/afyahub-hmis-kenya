import React, { useEffect, useState } from 'react';
import { useHmis } from '../context/HmisContext.tsx';
import {
  documentAction,
  documentRequest,
  type PatientFile,
} from '../api/patient-documents.client.ts';
import { PatientDocumentsPanel } from './PatientDocumentsPanel.tsx';
export function RadiologyConsentPanel({
  orderId,
  patientId,
}: {
  orderId: number;
  patientId: number;
}) {
  const { authenticatedUser } = useHmis();
  const permissions = authenticatedUser?.permissions ?? [];
  const [state, setState] = useState<{
    status: string;
    policy: { required: boolean; allow_exception: boolean };
    decision: { clinician_id: number; reason: string; decided_at: string } | null;
    documents: PatientFile[];
  } | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [documentId, setDocumentId] = useState(''),
    [clinicianId, setClinicianId] = useState(''),
    [reason, setReason] = useState('');
  useEffect(() => {
    let active = true;
    documentRequest<typeof state>(`/radiology/${orderId}/consent`)
      .then((data) => {
        if (active) {
          setState(data);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [orderId, revision]);
  async function action(path: string, body: unknown) {
    setError('');
    setBusy(true);
    try {
      await documentAction(path, body);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Consent operation failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Procedure-specific radiology consent"
      className="space-y-3 rounded border border-amber-300 bg-amber-50 p-3"
    >
      <h3 className="font-bold">Procedure-specific radiology consent · request #{orderId}</h3>
      <p>
        Consent status: <strong>{state?.status ?? 'Not loaded — do not assume verified'}</strong>
      </p>
      {state && (
        <p>
          Facility policy: consent {state.policy.required ? 'required' : 'not required'}; exceptions{' '}
          {state.policy.allow_exception ? 'permitted with authorization' : 'not permitted'}.
        </p>
      )}
      {state?.decision && (
        <p>
          Responsible clinician #{state.decision.clinician_id} · {String(state.decision.decided_at)}{' '}
          · {state.decision.reason}
        </p>
      )}
      <p>
        A generic treatment consent is not procedure-specific consent. Reporting/performance is
        checked by the server. Uploaded signatures are staff-observed, not cryptographically
        authenticated.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        disabled={busy}
        onClick={() => setRevision((v) => v + 1)}
      >
        Refresh consent status
      </button>
      <div className="grid gap-2 sm:grid-cols-2">
        <label>
          Radiology consent document ID
          <input
            aria-label="Radiology consent document ID"
            className="w-full rounded border p-2"
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value)}
          />
        </label>
        <label>
          Consent responsible clinician user ID
          <input
            aria-label="Consent responsible clinician user ID"
            className="w-full rounded border p-2"
            value={clinicianId}
            onChange={(e) => setClinicianId(e.target.value)}
          />
        </label>
        <label className="sm:col-span-2">
          Consent decision / policy audit reason
          <input
            aria-label="Consent decision audit reason"
            className="w-full rounded border p-2"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
        </label>
      </div>
      {permissions.includes('radiology.consent.verify') && (
        <button
          className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          disabled={busy}
          onClick={() =>
            void action(`/radiology/${orderId}/consent`, {
              status: 'VERIFIED',
              documentId,
              clinicianId,
              reason,
            })
          }
        >
          Verify this procedure consent
        </button>
      )}
      {permissions.includes('radiology.consent.exception') && (
        <button
          className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          disabled={busy || !state?.policy.allow_exception}
          onClick={() =>
            void action(`/radiology/${orderId}/consent`, {
              status: 'EXCEPTION',
              clinicianId,
              reason,
            })
          }
        >
          Record authorized consent exception
        </button>
      )}
      {permissions.includes('radiology.consent.policy') && state && (
        <fieldset className="rounded border p-2">
          <legend>Facility-wide radiology policy (applies to future completion checks)</legend>
          <p>
            Default is consent required, no exceptions. Policy changes are audited; no unrecorded
            bypass.
          </p>
          <button
            className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  'Change the active facility policy to require consent and permit documented authorized exceptions?',
                )
              )
                void action('/radiology-policy', { required: true, allowException: true, reason });
            }}
          >
            Require consent; allow authorized exceptions
          </button>
          <button
            className="mr-2 my-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            disabled={busy}
            onClick={() =>
              void action('/radiology-policy', { required: true, allowException: false, reason })
            }
          >
            Require consent; disallow exceptions
          </button>
        </fieldset>
      )}
      <PatientDocumentsPanel
        key={`${orderId}:${revision}`}
        patientId={patientId}
        radiologyOrderId={orderId}
      />
    </section>
  );
}
