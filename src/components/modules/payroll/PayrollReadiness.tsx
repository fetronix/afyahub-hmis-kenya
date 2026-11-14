import React, { useEffect, useState } from 'react';
import { fetchJson } from '../../../api/client.ts';
import type {
  PayrollReadiness,
  PayrollPeriod,
  PayrollStatutoryVersion,
} from '../../../api/clients/workforce.client.ts';
import { Modal } from '../../ui/overlays.tsx';
import { PrimaryButton, SecondaryButton } from '../../ui/controls.tsx';

export function PayrollReadinessPanel({
  facilityId,
  periods,
  periodId,
  onPeriodChange,
  refreshKey,
  onResult,
}: {
  facilityId: number;
  periods: PayrollPeriod[];
  periodId: number | null;
  onPeriodChange: (id: number | null) => void;
  refreshKey: string;
  onResult: (value: PayrollReadiness | null) => void;
}) {
  const [result, setResult] = useState<PayrollReadiness | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setResult(null);
    setError('');
    onResult(null);
    fetchJson<PayrollReadiness>(
      `/api/payroll/readiness?facilityId=${facilityId}${periodId ? `&periodId=${periodId}` : ''}`,
    )
      .then((value) => {
        if (!Array.isArray(value?.rules) || !value?.mapping)
          throw new Error('Invalid readiness response.');
        if (live) {
          setResult(value);
          onResult(value);
        }
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : 'Readiness could not be checked.');
      });
    return () => {
      live = false;
    };
  }, [facilityId, periodId, refreshKey, onResult]);
  return (
    <section
      aria-label="Payroll readiness"
      className="space-y-3 rounded-xl border border-hair bg-white p-4"
    >
      <h2 className="font-bold">Payroll configuration readiness</h2>
      <label className="ui-field">
        <span>Assess payroll period</span>
        <select
          className="ui-select"
          value={periodId ?? ''}
          onChange={(e) => onPeriodChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Today only — preview, not a payroll period</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.startDate} to {p.endDate} · pay {p.payDate}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p role="alert">
          Readiness unavailable: {error} Calculation remains subject to server validation.
        </p>
      ) : !result ? (
        <p role="status">Checking this facility's payroll configuration…</p>
      ) : (
        <>
          <p role="status">
            <strong>{result.status.replaceAll('_', ' ')}</strong> · {result.period.startDate} to{' '}
            {result.period.endDate} · pay date {result.period.payDate}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded border p-3">
              <h3>Chart of accounts</h3>
              <p>
                {result.chartOfAccounts.activeCount} active / {result.chartOfAccounts.totalCount}{' '}
                total
              </p>
              <strong>{result.chartOfAccounts.status.replaceAll('_', ' ')}</strong>
            </div>
            <div className="rounded border p-3">
              <h3>Payroll account mappings</h3>
              <strong>{result.mapping.ready ? 'COMPLETE' : 'BLOCKED'}</strong>
              <p>
                {result.mapping.mappings.filter((m) => m.status === 'READY').length} valid purposes
              </p>
            </div>
            {result.rules.map((r) => (
              <div key={r.statute} className="rounded border p-3">
                <h3>{r.statute} configuration</h3>
                <strong>{r.status.replaceAll('_', ' ')}</strong>
                {r.label && <p>{r.label}</p>}
                {r.verifiedOn && <p>Verified {r.verifiedOn}</p>}
              </div>
            ))}
            <div className="rounded border p-3">
              <h3>Accounting period</h3>
              <strong>{result.accountingPeriod.status}</strong>
              <p>Required for finalization</p>
            </div>
            <div className="rounded border p-3">
              <h3>Overall configuration</h3>
              <p>Calculate: {result.canCalculate ? 'configuration checks pass' : 'blocked'}</p>
              <p>Finalize: {result.canFinalize ? 'configuration checks pass' : 'blocked'}</p>
              <strong>Production sign-off not certified</strong>
            </div>
          </div>
          {!!result.nextActions.length && (
            <div>
              <h3 className="font-semibold">Configure next</h3>
              <ol className="list-decimal space-y-1 pl-5">
                {result.nextActions.map((action, i) => (
                  <li key={i}>{action}</li>
                ))}
              </ol>
            </div>
          )}
          <p className="text-sm text-muted">{result.notice}</p>
        </>
      )}
    </section>
  );
}

export function VerifyPayrollRule({
  version,
  saving,
  onClose,
  onSubmit,
}: {
  version: PayrollStatutoryVersion;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [verifiedOn, setDate] = useState(''),
    [reference, setReference] = useState(''),
    [purpose, setPurpose] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  return (
    <Modal open title={`Verify ${version.statute} source and values`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            verifiedOn,
            verificationReference: reference,
            verificationPurpose: purpose,
            confirmSourceReviewed: confirmed,
          });
        }}
      >
        <p>
          This records your source-review attestation, not an automatic legal certification. Do not
          verify guessed rates. Verification locks this version's values; corrections require a
          replacement draft.
        </p>
        <p>
          <strong>{version.label}</strong> · {version.effectiveFrom} →{' '}
          {version.effectiveTo ?? 'open'}
        </p>
        <p>Authority: {version.authority}</p>
        <p>Source: {version.sourceReference}</p>
        <details open>
          <summary>
            Rule values to compare with the cited publication (integer cents / basis points)
          </summary>
          <pre className="max-h-64 overflow-auto rounded bg-slate-50 p-2 text-xs">
            {JSON.stringify(
              { bands: version.bands, calculationConfig: version.calculationConfig },
              null,
              2,
            )}
          </pre>
        </details>
        <label className="ui-field">
          <span>Verification date</span>
          <input
            className="ui-input"
            type="date"
            required
            max={new Date().toISOString().slice(0, 10)}
            value={verifiedOn}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="ui-field">
          <span>Verification evidence / review reference</span>
          <textarea
            className="ui-input"
            required
            minLength={8}
            maxLength={1000}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <label className="ui-field">
          <span>Verification purpose</span>
          <select
            className="ui-select"
            required
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          >
            <option value="">Choose deliberately</option>
            <option value="AUTHORITY_SOURCE">Official authority source reviewed</option>
            <option value="SYNTHETIC_TEST">Synthetic test only — not operational rates</option>
          </select>
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I reviewed the cited source, effective dates and every rule value, deduction setting, cap
          and minimum.
        </label>
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={saving || !confirmed || !purpose}>
            Record verification
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
