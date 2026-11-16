import React, { useEffect, useState } from 'react';
import { documentAction, documentRequest } from '../../api/patient-documents.client.ts';
import { useHmis } from '../../context/HmisContext.tsx';

interface Policy {
  required: boolean;
  allowException: boolean;
}

/** Facility-wide policy belongs in configuration, not in the everyday consent form. */
export function RadiologyConsentPolicyPanel({ canManage }: { canManage: boolean }) {
  const { currentFacility } = useHmis();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy>({ required: true, allowException: false });
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    documentRequest<Policy>('/radiology-policy')
      .then((value) => {
        if (!active) return;
        setPolicy(value);
        setDraft({ required: value.required, allowException: value.allowException });
        setError('');
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Policy could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [currentFacility?.id]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const saved = await documentAction<Policy>('/radiology-policy', {
        required: draft.required,
        allowException: draft.allowException,
        reason,
      });
      setPolicy(saved);
      setDraft({ required: saved.required, allowException: saved.allowException });
      setReason('');
      setMessage('Radiology consent policy saved with an audit record.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Policy could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Radiology consent policy"
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 text-xs shadow-xs"
    >
      <header>
        <p className="eyebrow">Facility configuration</p>
        <h2 className="text-sm font-bold text-ink">Radiology consent policy</h2>
        <p className="text-slate-600">
          This setting affects every imaging request in {currentFacility?.name ?? 'this facility'}.
          It is separate from uploading or verifying an individual consent document.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-red-900">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded border border-teal-300 bg-teal-50 p-2 text-teal-900">
          {message}
        </p>
      )}
      {policy === null && !error ? (
        <p role="status">Loading facility radiology consent policy…</p>
      ) : (
        <form
          aria-label="Save radiology consent policy"
          onSubmit={(e) => void save(e)}
          className="space-y-3"
        >
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={draft.required}
              disabled={!canManage || busy}
              onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
            />
            Require procedure-specific consent before an imaging request can be reported or
            completed.
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={draft.allowException}
              disabled={!canManage || busy}
              onChange={(e) => setDraft({ ...draft, allowException: e.target.checked })}
            />
            Permit a documented exception, recorded only by the signed-in authorized doctor under
            this policy.
          </label>
          <label className="block">
            Reason for this policy change
            <textarea
              className="mt-1 w-full rounded border border-slate-300 p-2 text-sm"
              required
              minLength={10}
              maxLength={500}
              value={reason}
              disabled={!canManage || busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {canManage ? (
            <button
              type="submit"
              disabled={busy || reason.trim().length < 10}
              className="rounded bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save consent policy'}
            </button>
          ) : (
            <p className="text-slate-600">
              The radiology consent policy permission is required to change this setting.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
