import React, { useLayoutEffect, useRef, useState } from 'react';
import { fetchJson } from '../../api/client.ts';
import { useHmis } from '../../context/HmisContext.tsx';

const categories = [
  ['summary', 'Encounter summary'],
  ['diagnoses', 'Diagnoses'],
  ['laboratory', 'Laboratory orders and verified results'],
  ['radiology', 'Radiology'],
  ['prescriptions', 'Prescriptions'],
  ['procedures', 'Procedures'],
  ['admission', 'Admission / discharge'],
] as const;

/** An internal, explicitly selected preview; it does not attach or transmit documents. */
export const ClaimEvidencePreview: React.FC<{
  invoiceId: number;
  payerKind: 'SHA' | 'PRIVATE';
  payerCode: string;
}> = ({ invoiceId, payerKind, payerCode }) => {
  const { authenticatedUser, currentFacility } = useHmis();
  const permissions = new Set(authenticatedUser?.permissions ?? []);
  const allowed =
    !authenticatedUser?.isSuperAdmin &&
    permissions.has('billing.read') &&
    permissions.has('clinical.read') &&
    permissions.has(
      payerKind === 'SHA' ? 'insurance.sha.claims.prepare' : 'insurance.private.claims.prepare',
    );
  const [selected, setSelected] = useState<string[]>([]);
  const [referralId, setReferralId] = useState('');
  const [referralConfirmed, setReferralConfirmed] = useState(false);
  const [preauthId, setPreauthId] = useState('');
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const permissionKey = [...permissions].sort().join(',');
  useLayoutEffect(() => {
    version.current += 1;
    setBusy(false);
    setPreview(null);
    setError('');
    setSelected([]);
    setReferralId('');
    setPreauthId('');
    setReferralConfirmed(false);
    return () => {
      version.current += 1;
    };
  }, [invoiceId, payerKind, payerCode, currentFacility?.id, authenticatedUser?.id, permissionKey]);

  const run = async () => {
    if (!allowed || busy) return;
    const request = ++version.current;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const result = await fetchJson<Record<string, unknown>>('/api/insurance/evidence/preview', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId,
          payerKind,
          payerCode,
          categories: selected,
          referralId: referralId || undefined,
          referralRelevanceConfirmed: referralConfirmed,
          preauthorizationId: preauthId || undefined,
        }),
      });
      if (request === version.current) setPreview(result);
    } catch (err) {
      if (request === version.current)
        setError(err instanceof Error ? err.message : 'Evidence preview failed.');
    } finally {
      if (request === version.current) setBusy(false);
    }
  };
  if (!allowed)
    return (
      <p className="text-xs text-slate-600">
        Clinical evidence preview requires billing, clinical and payer claim-preparation
        permissions.
      </p>
    );
  return (
    <details className="rounded border border-slate-200 p-3 text-xs">
      <summary className="cursor-pointer font-semibold">Preview selected clinical evidence</summary>
      <p className="mt-2">
        A finalized invoice is required. This internal preview does not attach documents, transmit a
        claim, or establish consent or payer approval. The invoice snapshot includes recorded
        diagnoses even when the diagnoses category is not selected.
      </p>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        {categories.map(([key, label]) => {
          const needed =
            key === 'laboratory'
              ? 'laboratory.read'
              : key === 'prescriptions'
                ? 'pharmacy.read'
                : key === 'admission'
                  ? 'inpatient.read'
                  : null;
          const disabled = needed !== null && !permissions.has(needed);
          return (
            <label key={key}>
              <input
                type="checkbox"
                disabled={busy || disabled}
                checked={selected.includes(key)}
                onChange={(e) => {
                  setSelected((s) => (e.target.checked ? [...s, key] : s.filter((v) => v !== key)));
                  setPreview(null);
                }}
              />{' '}
              {label}
              {disabled ? ` (requires ${needed})` : ''}
            </label>
          );
        })}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label>
          Optional referral ID{' '}
          <input
            type="number"
            disabled={busy}
            min="1"
            className="field-input"
            value={referralId}
            onChange={(e) => {
              setReferralId(e.target.value);
              setReferralConfirmed(false);
              setPreview(null);
            }}
          />
        </label>
        <label>
          Optional payer preauthorization ID{' '}
          <input
            type="number"
            disabled={busy}
            min="1"
            className="field-input"
            value={preauthId}
            onChange={(e) => {
              setPreauthId(e.target.value);
              setPreview(null);
            }}
          />
        </label>
      </div>
      {referralId && (
        <label className="mt-2 block">
          <input
            type="checkbox"
            disabled={busy}
            checked={referralConfirmed}
            onChange={(e) => setReferralConfirmed(e.target.checked)}
          />{' '}
          I reviewed this referral and confirmed its relevance to this encounter.
        </label>
      )}
      <button
        type="button"
        className="mt-3 rounded bg-teal-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
        disabled={busy || Boolean(referralId && !referralConfirmed)}
        onClick={() => void run()}
      >
        {busy ? 'Loading preview…' : 'Load evidence preview'}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-rose-700">
          {error}
        </p>
      )}
      {preview && (
        <div className="mt-3 space-y-2">
          <p className="font-semibold">
            Internal preview — review relevance and disclosure authority before any separate
            submission.
          </p>
          {Object.entries(preview)
            .filter(([key]) => !['notice', 'payerKind', 'payerCode'].includes(key))
            .map(([key, value]) => (
              <details key={key} className="rounded bg-slate-50 p-2">
                <summary className="cursor-pointer font-semibold">{key}</summary>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(value, null, 2)}
                </pre>
              </details>
            ))}
        </div>
      )}
    </details>
  );
};
