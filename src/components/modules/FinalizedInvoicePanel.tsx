import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client.ts';
import { paymentHubApi, type HubTransaction } from '../../api/payment-hub.client.ts';
import type { FinalizedInvoiceView, PaymentParty } from '../../billing/finalized-invoice.types.ts';
import { useHmis } from '../../context/HmisContext.tsx';

const field = 'w-full rounded border border-slate-300 px-2 py-1.5';
const button = 'rounded bg-teal-700 px-3 py-2 text-white font-semibold disabled:opacity-50';
const money = (amount: string | null) =>
  amount === null ? 'Unknown — review receipts' : `KES ${amount}`;

/** Snapshot and audited print of the existing invoice; does not submit a claim. */
export const FinalizedInvoicePanel: React.FC<{ invoiceId: number }> = ({ invoiceId }) => {
  const { currentFacility, authenticatedUser, refreshKey, triggerRefresh } = useHmis();
  const permissions = new Set(authenticatedUser?.permissions ?? []);
  const canRead =
    !authenticatedUser?.isSuperAdmin &&
    permissions.has('billing.read') &&
    permissions.has('clinical.read');
  const canFinalize = canRead && permissions.has('billing.update');
  const canAttribute = permissions.has('billing.payments.record');
  const canViewHub = permissions.has('payment_hub.transactions.read');
  const [view, setView] = useState<FinalizedInvoiceView | { finalized: false } | null>(null);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [insurer, setInsurer] = useState('');
  const [copay, setCopay] = useState('');
  const [basis, setBasis] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [paymentId, setPaymentId] = useState<number | null>(null);
  const [party, setParty] = useState<PaymentParty>('PATIENT');
  const [reason, setReason] = useState('');
  const [hubTransactions, setHubTransactions] = useState<HubTransaction[] | null>(null);
  const [hubError, setHubError] = useState('');
  const facilityId = currentFacility?.id;
  const scopeVersion = useRef(0);
  useLayoutEffect(() => {
    scopeVersion.current += 1;
    setBusy(false);
    setView(null);
    setHubTransactions(null);
    return () => {
      scopeVersion.current += 1;
    };
  }, [invoiceId, facilityId, authenticatedUser?.id, canRead, canAttribute]);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    setError('');
    setIssues([]);
    setPaymentId(null);
    setInsurer('');
    setCopay('');
    setBasis('');
    setConfirmed(false);
    if (canRead)
      api
        .getInvoiceFinalization(invoiceId)
        .then((data) => {
          if (!cancelled) setView(data);
        })
        .catch(() => {
          if (!cancelled)
            setError('The finalized invoice could not be loaded. Do not assume it is unfinalized.');
        });
    return () => {
      cancelled = true;
      document.body.classList.remove('print-finalized-invoice');
    };
  }, [invoiceId, facilityId, authenticatedUser?.id, canRead, refreshKey, reload]);

  useEffect(() => {
    let cancelled = false;
    setHubTransactions(null);
    setHubError('');
    if (facilityId && canViewHub)
      paymentHubApi
        .transactions(facilityId)
        .then((result) => {
          if (!cancelled)
            setHubTransactions(result.transactions.filter((t) => t.invoiceId === invoiceId));
        })
        .catch(() => {
          if (!cancelled) setHubError('M-Pesa request history could not be loaded.');
        });
    return () => {
      cancelled = true;
    };
  }, [facilityId, invoiceId, canViewHub, refreshKey, reload]);

  async function finalize() {
    if (!confirmed || busy) return;
    const version = scopeVersion.current;
    setBusy(true);
    setError('');
    setIssues([]);
    try {
      await api.finalizeInvoice(invoiceId, {
        insurerResponsibility: insurer,
        copayment: copay,
        allocationBasis: basis,
      });
      if (version !== scopeVersion.current) return;
      triggerRefresh();
      setReload((n) => n + 1);
    } catch (err) {
      if (version !== scopeVersion.current) return;
      setError(err instanceof Error ? err.message : 'Finalization failed.');
      if (err instanceof ApiError && Array.isArray(err.detail?.issues))
        setIssues(err.detail.issues.filter((v): v is string => typeof v === 'string'));
    } finally {
      if (version === scopeVersion.current) setBusy(false);
    }
  }

  async function attribute() {
    if (!paymentId || busy) return;
    const version = scopeVersion.current;
    setBusy(true);
    setError('');
    try {
      await api.attributeInvoicePayment(invoiceId, paymentId, { party, reason });
      if (version !== scopeVersion.current) return;
      setPaymentId(null);
      setReason('');
      setReload((n) => n + 1);
      triggerRefresh();
    } catch (err) {
      if (version === scopeVersion.current)
        setError(err instanceof Error ? err.message : 'Attribution failed.');
    } finally {
      if (version === scopeVersion.current) setBusy(false);
    }
  }

  async function print() {
    const version = scopeVersion.current;
    setBusy(true);
    setError('');
    try {
      await api.recordInvoicePrintAccess(invoiceId);
      if (version !== scopeVersion.current) return;
      document.body.classList.add('print-finalized-invoice');
      window.addEventListener(
        'afterprint',
        () => document.body.classList.remove('print-finalized-invoice'),
        { once: true },
      );
      window.print();
    } catch {
      if (version === scopeVersion.current)
        setError('Printing could not be authorized and audited.');
    } finally {
      if (version === scopeVersion.current) setBusy(false);
    }
  }

  if (!canRead)
    return (
      <section className="border-t border-slate-200 pt-4 text-slate-600">
        A finalized clinical invoice requires billing and clinical read permissions.
      </section>
    );
  return (
    <section aria-label="Finalized invoice" className="space-y-3 border-t border-slate-200 pt-4">
      <style>{`@media print {
      body.print-finalized-invoice * { visibility: hidden !important; }
      body.print-finalized-invoice .invoice-print-area,
      body.print-finalized-invoice .invoice-print-area * { visibility: visible !important; }
      body.print-finalized-invoice .invoice-print-area { position: absolute; top: 0; left: 0; width: 100%; padding: 10mm; color: #000; background: #fff; }
      body.print-finalized-invoice .invoice-print-hide { display: none !important; }
    }`}</style>
      <h3 className="font-bold text-slate-800">Finalized invoice &amp; responsibility</h3>
      {error && (
        <div role="alert" className="rounded bg-rose-50 p-3 text-rose-800">
          {error}
          {issues.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!view && !error && <p role="status">Loading invoice finalization…</p>}
      {error && !view && (
        <button type="button" className="underline" onClick={() => setReload((n) => n + 1)}>
          Retry invoice finalization
        </button>
      )}
      {view && !view.finalized && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p>
            This invoice is not finalized. Finalization requires recorded facility identity,
            matching encounter, clinician, diagnosis and coded facility tariffs. Later charges open
            a new invoice.
          </p>
          <p>
            The allocation is an explicit billing estimate, not insurer eligibility,
            preauthorization, approval or payment. Discounts and adjustments are not separately
            recorded by this invoice system.
          </p>
          {canFinalize && (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <label>
                  Insurer responsibility (KES; enter 0 for self-pay)
                  <input
                    className={field}
                    inputMode="decimal"
                    value={insurer}
                    onChange={(e) => setInsurer(e.target.value)}
                  />
                </label>
                <label>
                  Copayment within patient responsibility (KES)
                  <input
                    className={field}
                    inputMode="decimal"
                    value={copay}
                    onChange={(e) => setCopay(e.target.value)}
                  />
                </label>
              </div>
              <label className="block">
                Allocation basis or evidence reference
                <input
                  className={field}
                  value={basis}
                  maxLength={500}
                  onChange={(e) => setBasis(e.target.value)}
                />
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I reviewed the recorded allocation and understand the snapshot and attribution
                cannot be silently edited.
              </label>
              <button
                type="button"
                className={button}
                disabled={busy || !confirmed}
                onClick={() => void finalize()}
              >
                Finalize invoice
              </button>
            </>
          )}
        </div>
      )}
      {view?.finalized && (
        <>
          <div className="flex justify-end">
            <button type="button" className={button} disabled={busy} onClick={() => void print()}>
              Print finalized invoice
            </button>
          </div>
          <div className="invoice-print-area space-y-4 rounded-lg border border-slate-300 bg-white p-4">
            <header className="border-b border-slate-300 pb-3">
              <h4 className="text-lg font-bold">{view.snapshot.facility.name}</h4>
              <p>
                Facility code {view.snapshot.facility.internalCode} · MFL{' '}
                {view.snapshot.facility.registryCode}
              </p>
              <p>
                {view.snapshot.facility.address} · {view.snapshot.facility.county} County
              </p>
              <p>
                {[view.snapshot.facility.phone, view.snapshot.facility.email]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="mt-2 font-semibold">
                Invoice {view.snapshot.invoice.number} {view.voided ? '— VOID' : ''}
              </p>
              <p>
                Invoice date: {new Date(view.snapshot.invoice.createdAt).toLocaleString()} ·
                Finalized: {new Date(view.finalizedAt).toLocaleString()}
              </p>
            </header>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <strong>Patient</strong>
                <p>
                  {view.snapshot.patient.name} · MRN {view.snapshot.patient.mrn}
                </p>
                <p>
                  Payer:{' '}
                  {view.snapshot.invoice.payerName ??
                    view.snapshot.invoice.payerType ??
                    'Not recorded'}
                </p>
                <p>Membership: {view.snapshot.invoice.memberNumber ?? 'Not recorded'}</p>
              </div>
              <div>
                <strong>Encounter #{view.snapshot.encounter.id}</strong>
                <p>{view.snapshot.encounter.department}</p>
                <p>Attending: {view.snapshot.encounter.attendingClinician}</p>
              </div>
            </div>
            <div>
              <strong>Recorded diagnoses</strong>
              <ul>
                {view.snapshot.encounter.diagnoses.map((d, i) => (
                  <li key={`${d.system}:${d.code}:${i}`}>
                    {d.system} {d.code} — {d.description}
                    {d.type ? ` (${d.type})` : ''}
                  </li>
                ))}
              </ul>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b">
                  <th>Code</th>
                  <th>Service</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {view.snapshot.items.map((line) => (
                  <tr key={line.id} className="border-b border-slate-100">
                    <td>{line.code}</td>
                    <td>{line.description}</td>
                    <td>{line.quantity}</td>
                    <td>{money(line.unitPrice)}</td>
                    <td>{money(line.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid gap-1 sm:grid-cols-2">
              <p>
                Itemized total: <strong>{money(view.snapshot.amounts.itemizedTotal)}</strong>
              </p>
              <p>Discounts / adjustments: not separately recorded</p>
              <p>Patient responsibility: {money(view.snapshot.amounts.patientResponsibility)}</p>
              <p>Insurer responsibility: {money(view.snapshot.amounts.insurerResponsibility)}</p>
              <p>
                Copayment (included in patient responsibility):{' '}
                {money(view.snapshot.amounts.copayment)}
              </p>
              <p>Allocation basis: {view.snapshot.amounts.allocationBasis}</p>
              <p>Net recorded receipts: {money(view.financial.netReceipts)}</p>
              <p>Invoice balance: {money(view.financial.invoiceBalance)}</p>
              <p>Patient balance: {money(view.financial.patientBalance)}</p>
              <p>Insurer balance: {money(view.financial.insurerBalance)}</p>
              <p>Unattributed receipts: {money(view.financial.unattributedNetReceipts)}</p>
              <p>
                Party credits — patient: {money(view.financial.patientCredit)}; insurer:{' '}
                {money(view.financial.insurerCredit)}
              </p>
            </div>
            <p className="text-slate-600">
              Responsibility is a recorded allocation, not confirmation of coverage, adjudication or
              payment. Financial balances are based on recorded receipts and manual refund entries,
              not automatic GL posting.
            </p>
            {!view.financial.reconciled && (
              <p className="font-semibold text-rose-700">
                Invoice and receipt ledger disagree. Financial review is required.
              </p>
            )}
            <div>
              <strong>Receipt history</strong>
              {view.payments.length === 0 ? (
                <p>No receipts recorded.</p>
              ) : (
                <ul>
                  {view.payments.map((p) => (
                    <li key={p.id} className="mt-1">
                      {p.receiptNumber} · {p.paymentMethod ?? 'Method not recorded'} ·{' '}
                      {money(p.amount)} · {p.party ?? 'UNATTRIBUTED'} ·{' '}
                      {new Date(p.paymentDate).toLocaleString()}
                      {p.transactionCode ? ` · ${p.transactionCode}` : ''}
                      {canAttribute && !p.party && (
                        <button
                          className="invoice-print-hide ml-2 underline"
                          type="button"
                          onClick={() => {
                            setPaymentId(p.id);
                            setReason('');
                          }}
                        >
                          Attribute receipt
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <strong>Manual refund history</strong>
              {view.refunds.length === 0 ? (
                <p>No manual refunds recorded.</p>
              ) : (
                <ul>
                  {view.refunds.map((r) => (
                    <li key={r.id}>
                      {r.refundNumber} · {money(r.amount)} · {r.refundMethod} ·{' '}
                      {new Date(r.createdAt).toLocaleString()}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {paymentId && (
            <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
              <p>
                Attribute receipt #{paymentId}. This does not change the receipt or prove payer
                settlement; corrections require controlled review.
              </p>
              <label>
                Party{' '}
                <select
                  className={field}
                  value={party}
                  onChange={(e) => setParty(e.target.value as PaymentParty)}
                >
                  <option value="PATIENT">Patient</option>
                  <option value="INSURER">Insurer</option>
                </select>
              </label>
              <label className="block">
                Reason / evidence reference{' '}
                <input
                  className={field}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                type="button"
                className={button}
                disabled={busy || reason.trim().length < 3}
                onClick={() => void attribute()}
              >
                Record attribution
              </button>{' '}
              <button type="button" className="underline" onClick={() => setPaymentId(null)}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}
      {canViewHub && (
        <div className="space-y-1 rounded border border-slate-200 p-3">
          <strong>M-Pesa request history</strong>
          <p>
            Most recent 100 facility requests only. Sandbox requests and unverified callbacks do not
            pay an invoice or create a receipt.
          </p>
          {hubError ? (
            <p role="alert">{hubError}</p>
          ) : hubTransactions === null ? (
            <p>Loading request history…</p>
          ) : hubTransactions.length === 0 ? (
            <p>No requests for this invoice in the recent history.</p>
          ) : (
            <ul>
              {hubTransactions.map((t) => (
                <li key={t.id}>
                  Request #{t.id} · {t.environment} · {t.status} · {t.unverifiedNotifications}{' '}
                  unverified notification(s)
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};
