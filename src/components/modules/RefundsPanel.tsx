import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { parseMoneyToCents } from '../../billing/settlement.ts';
import {
  clearPendingRefund,
  readPendingRefund,
  savePendingRefund,
  type PendingRefund,
} from '../../billing/refund-retry-storage.ts';
import type { BillingPayment, BillingRefund } from '../../types/index.ts';

type RefundMethod = 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE';
const PATIENT_METHODS = new Set(['cash', 'm-pesa', 'airtel money', 'card', 'cheque']);

/** An additive manual record: this screen never sends money to a provider. */
export const RefundsPanel: React.FC<{ invoiceId: number }> = ({ invoiceId }) => {
  const { currentFacility, authenticatedUser, showToast, refreshKey, triggerRefresh } = useHmis();
  const facilityId = currentFacility?.id;
  const canRefund = Boolean(
    authenticatedUser &&
    !authenticatedUser.isSuperAdmin &&
    authenticatedUser.permissions?.includes('billing.read') &&
    authenticatedUser.permissions?.includes('billing.refunds.record'),
  );
  const storageKey =
    canRefund && facilityId && authenticatedUser?.id
      ? `jalicare:refund:pending:${authenticatedUser.id}:${facilityId}`
      : null;
  const scope = facilityId ? `${facilityId}:${invoiceId}` : null;
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [payments, setPayments] = useState<BillingPayment[]>([]);
  const [refunds, setRefunds] = useState<BillingRefund[]>([]);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<PendingRefund | null>(null);
  const [storageError, setStorageError] = useState('');
  const [target, setTarget] = useState<BillingPayment | null>(null);
  const [refundKey, setRefundKey] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<RefundMethod>('CASH');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!storageKey) {
      setPending(null);
      setStorageError('');
      return;
    }
    const refresh = () => {
      try {
        setPending(readPendingRefund(window.localStorage, storageKey));
        setStorageError('');
      } catch {
        setStorageError(
          'The saved refund identity cannot be read. Review receipts before continuing.',
        );
      }
    };
    refresh();
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [storageKey]);

  useEffect(() => {
    let cancelled = false;
    setLoadedScope(null);
    setLoadError('');
    setPayments([]);
    setRefunds([]);
    setTarget(null);
    if (!scope) {
      setLoadError('A facility is required to load receipt history.');
      return;
    }
    api
      .getInvoiceDetail(invoiceId)
      .then((detail) => {
        if (cancelled) return;
        if (
          detail.invoice.id !== invoiceId ||
          !Array.isArray(detail.payments) ||
          !Array.isArray(detail.refunds)
        ) {
          setLoadError('Receipt history was not returned safely. Do not assume no receipts exist.');
          return;
        }
        setPayments(detail.payments);
        setRefunds(detail.refunds);
        setLoadedScope(scope);
      })
      .catch(() => {
        if (!cancelled)
          setLoadError('Receipt history could not be loaded. Do not assume no receipts exist.');
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId, scope, refreshKey, reload]);

  const start = (payment: BillingPayment) => {
    if (
      !storageKey ||
      storageError ||
      (pending && (pending.invoiceId !== invoiceId || pending.paymentId !== payment.id))
    ) {
      showToast('Resolve the unconfirmed refund before starting another.');
      return;
    }
    setTarget(payment);
    setRefundKey(pending?.key ?? crypto.randomUUID());
    setAmount('');
    setMethod('CASH');
    setReference('');
    setReason('');
    setConfirmed(false);
  };
  const checkStatus = async () => {
    if (!pending || !storageKey || !facilityId || busy) return;
    setBusy(true);
    try {
      const result = await api.checkRefundStatus({ facilityId, idempotencyKey: pending.key });
      if (result.status === 'NOT_FOUND') {
        showToast(
          'No recorded refund was found. A delayed request may still arrive; review before retrying the same details.',
        );
        return;
      }
      if (
        result.refund.invoiceId !== pending.invoiceId ||
        result.refund.paymentId !== pending.paymentId
      ) {
        showToast(
          'The recorded refund does not match the pending receipt. Manual review is required.',
        );
        return;
      }
      clearPendingRefund(window.localStorage, storageKey, pending.key);
      setPending(readPendingRefund(window.localStorage, storageKey));
      setTarget(null);
      showToast(
        `Manual refund ${result.refund.refundNumber} was recorded. It did not initiate a transfer; accounting review is required.`,
      );
      triggerRefresh();
      setReload((n) => n + 1);
    } catch {
      showToast(
        'Refund status could not be confirmed. Retain the retry identity and review before continuing.',
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!target || !storageKey || !facilityId || busy || storageError) return;
    const cents = parseMoneyToCents(amount);
    if (
      cents === null ||
      cents <= 0 ||
      reason.trim().length < 3 ||
      !confirmed ||
      (method !== 'CASH' && reference.trim().length < 3)
    ) {
      showToast('Enter a positive amount, reason, reference where required, and confirmation.');
      return;
    }
    let key = refundKey;
    try {
      const saved = readPendingRefund(window.localStorage, storageKey);
      if (saved && (saved.invoiceId !== invoiceId || saved.paymentId !== target.id)) {
        setPending(saved);
        showToast('Resolve the unconfirmed refund before starting another.');
        return;
      }
      key = saved?.key ?? key;
      const next = { key, invoiceId, paymentId: target.id };
      if (!saved) savePendingRefund(window.localStorage, storageKey, next);
      setPending(next);
    } catch {
      setStorageError('The refund retry identity could not be saved. No request was sent.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.recordManualRefund({
        facilityId,
        invoiceId,
        paymentId: target.id,
        amount,
        refundMethod: method,
        externalReference: reference.trim() || undefined,
        reason: reason.trim(),
        manualConfirmation: true,
        idempotencyKey: key,
      });
      try {
        clearPendingRefund(window.localStorage, storageKey, key);
        setPending(readPendingRefund(window.localStorage, storageKey));
      } catch {
        setStorageError('The recorded refund needs a browser retry-identity review.');
      }
      setTarget(null);
      showToast(
        `${result.replayed ? 'Previous refund retrieved' : 'Manual refund recorded'}: ${result.refund.refundNumber}. No transfer was initiated; accounting review is required.`,
      );
      triggerRefresh();
      setReload((n) => n + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      showToast(
        `Refund could not be confirmed: ${message} Keep this retry identity and review the receipt.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="space-y-3 border-t border-slate-200 pt-4"
      aria-label="Receipt and refund history"
    >
      <div>
        <h3 className="text-xs font-bold uppercase text-slate-700">
          Receipt &amp; manual refund history
        </h3>
        <p className="text-2xs text-slate-500">
          Refund records do not initiate or verify external payments. Accounting posting requires
          review.
        </p>
      </div>
      {(pending || storageError) && (
        <div
          role="status"
          className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-amber-950"
        >
          <strong>Unconfirmed refund needs review</strong>
          {storageError ? (
            <p>{storageError}</p>
          ) : (
            <>
              <p>
                Invoice #{pending?.invoiceId}, receipt #{pending?.paymentId}. Check the recorded
                result before another refund. The amount, reason and reference are not stored in
                this browser.
              </p>
              <button
                type="button"
                onClick={checkStatus}
                disabled={busy}
                className="rounded border border-amber-700 px-2 py-1 disabled:opacity-50"
              >
                Check recorded refund
              </button>
              <p>
                If not found, a delayed request may still arrive. Re-enter the same details and use
                the same identity, or review manually.
              </p>
            </>
          )}
        </div>
      )}
      {loadedScope !== scope ? (
        loadError ? (
          <div role="alert" className="text-rose-800">
            <p>{loadError}</p>
            <button type="button" onClick={() => setReload((n) => n + 1)} className="underline">
              Retry receipt history
            </button>
          </div>
        ) : (
          <p role="status">Loading receipt history...</p>
        )
      ) : (
        <>
          {payments.length === 0 ? (
            <p className="text-slate-500">No receipts recorded for this invoice.</p>
          ) : (
            <ul className="space-y-2">
              {payments.map((payment) => {
                const original = parseMoneyToCents(payment.amount);
                const refundAmounts = refunds
                  .filter((r) => r.paymentId === payment.id)
                  .map((r) => parseMoneyToCents(r.amount));
                const valid = original !== null && refundAmounts.every((n) => n !== null);
                const remaining = valid
                  ? original - refundAmounts.reduce<number>((sum, n) => sum + (n ?? 0), 0)
                  : null;
                return (
                  <li
                    key={payment.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-2"
                  >
                    <span>
                      <strong>{payment.receiptNumber}</strong> · {payment.paymentMethod} · KES{' '}
                      {payment.amount} · unreversed{' '}
                      {remaining === null || remaining < 0
                        ? 'requires review'
                        : `KES ${(remaining / 100).toFixed(2)}`}
                    </span>
                    {canRefund &&
                      remaining !== null &&
                      remaining > 0 &&
                      PATIENT_METHODS.has((payment.paymentMethod ?? '').trim().toLowerCase()) && (
                        <button
                          type="button"
                          onClick={() => start(payment)}
                          disabled={
                            busy ||
                            Boolean(storageError) ||
                            Boolean(
                              pending &&
                              (pending.invoiceId !== invoiceId || pending.paymentId !== payment.id),
                            )
                          }
                          className="rounded border border-teal-700 px-2 py-1 text-teal-800 disabled:opacity-50"
                        >
                          {pending?.paymentId === payment.id && pending.invoiceId === invoiceId
                            ? 'Resume same refund'
                            : 'Record manual refund'}
                        </button>
                      )}
                  </li>
                );
              })}
            </ul>
          )}
          {refunds.length > 0 && (
            <ul className="space-y-1 text-slate-600">
              {refunds.map((r) => (
                <li key={r.id}>
                  {r.refundNumber} · reverses receipt #{r.paymentId} · KES {r.amount} ·{' '}
                  {r.refundMethod} · manually recorded
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {target && loadedScope === scope && (
        <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
          <h4 className="font-bold">Record refund against {target.receiptNumber}</h4>
          <p>This records a refund already performed outside the system. It does not send funds.</p>
          <label className="block">
            Amount (KES)
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="block w-full rounded border p-2"
            />
          </label>
          <label className="block">
            Refund method
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as RefundMethod)}
              className="block w-full rounded border p-2"
            >
              <option value="CASH">Cash</option>
              <option value="MOBILE_MONEY">Mobile money</option>
              <option value="CARD">Card</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="CHEQUE">Cheque</option>
            </select>
          </label>
          <label className="block">
            External reference {method !== 'CASH' ? '(required)' : '(optional)'}
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={100}
              className="block w-full rounded border p-2"
            />
          </label>
          <label className="block">
            Reason
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className="block w-full rounded border p-2"
            />
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              I confirm the refund was actually performed outside JaliCare and am authorized to
              record it.
            </span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTarget(null)}
              disabled={busy}
              className="rounded border px-3 py-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !confirmed}
              className="rounded bg-teal-700 px-3 py-1 text-white disabled:opacity-50"
            >
              {busy ? 'Recording...' : 'Record refund receipt'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
