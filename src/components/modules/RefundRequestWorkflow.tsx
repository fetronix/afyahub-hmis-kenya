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
import type {
  BillingPayment,
  RefundMethod,
  RefundRequest,
  RefundRequestForReview,
  RefundRequestPage,
} from '../../types/index.ts';

const PATIENT_METHODS = new Set(['cash', 'm-pesa', 'airtel money', 'card', 'cheque']);
const METHODS = new Set(['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'CHEQUE']);
const STATES = new Set(['REQUESTED', 'APPROVED', 'REJECTED', 'REVOKED', 'SETTLED']);
const positive = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
function validRequest(q: RefundRequest, facilityId: number, invoiceId: number) {
  return Boolean(
    q &&
    positive(q.id) &&
    q.facilityId === facilityId &&
    q.invoiceId === invoiceId &&
    positive(q.paymentId) &&
    positive(q.requestedByUserId) &&
    typeof q.requestNumber === 'string' &&
    q.requestNumber &&
    typeof q.reason === 'string' &&
    q.reason.length >= 3 &&
    typeof q.idempotencyKey === 'string' &&
    /^[A-Za-z0-9._:-]{8,128}$/.test(q.idempotencyKey) &&
    METHODS.has(q.refundMethod) &&
    STATES.has(q.status) &&
    parseMoneyToCents(q.amount) !== null &&
    (parseMoneyToCents(q.amount) ?? 0) > 0,
  );
}
function validPage(page: RefundRequestPage, facilityId: number, invoiceId: number): boolean {
  if (
    !page ||
    !Array.isArray(page.requests) ||
    (page.nextAfterId !== null && !positive(page.nextAfterId))
  )
    return false;
  return page.requests.every((q) => {
    if (!validRequest(q, facilityId, invoiceId)) return false;
    if (q.status !== 'REQUESTED') {
      if (
        !positive(q.reviewedByUserId) ||
        q.reviewedByUserId === q.requestedByUserId ||
        typeof q.reviewNotes !== 'string' ||
        q.reviewNotes.trim().length < 3 ||
        !q.reviewedAt
      )
        return false;
      if (q.status === 'SETTLED' && !positive(q.settledRefundId)) return false;
      if (
        q.status === 'REVOKED' &&
        (!positive(q.revokedByUserId) || q.revokedByUserId === q.requestedByUserId)
      )
        return false;
      return q.reviewHash === null && q.evidence === null;
    }
    if (typeof q.reviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(q.reviewHash)) return false;
    if (q.issue !== null && typeof q.issue !== 'string') return false;
    if (q.issue === null && !q.evidence) return false;
    if (!q.evidence) return true;
    return (
      typeof q.evidence.receiptNumber === 'string' &&
      [
        'invoiceTotal',
        'invoicePaid',
        'invoiceBalance',
        'invoiceCredit',
        'receiptGross',
        'receiptRefunded',
        'receiptReserved',
        'invoiceReserved',
        'receiptAvailable',
        'invoiceAvailable',
      ].every(
        (key) => parseMoneyToCents(q.evidence?.[key as keyof typeof q.evidence] as string) !== null,
      )
    );
  });
}

/** Scoped request/review controls. Approval is not a transfer or accounting posting. */
export const RefundRequestWorkflow: React.FC<{
  facilityId: number;
  invoiceId: number;
  payments: BillingPayment[];
  bankOnly?: boolean;
  canRequest: boolean;
  canReview: boolean;
  userId: number;
  recordBlocked: boolean;
  onRecordApproved: (q: RefundRequest) => void;
}> = ({
  facilityId,
  invoiceId,
  payments,
  canRequest,
  canReview,
  userId,
  recordBlocked,
  onRecordApproved,
  bankOnly = false,
}) => {
  const { showToast, refreshKey } = useHmis();
  const scope = `${facilityId}:${invoiceId}`;
  const storageKey = canRequest ? `jalicare:refund-request:pending:${userId}:${facilityId}` : null;
  const [storageState, setStorageState] = useState<{
    key: string | null;
    pending: PendingRefund | null;
    error: string;
  }>({ key: null, pending: null, error: '' });
  const storageReady = !storageKey || storageState.key === storageKey;
  const pending = storageKey && storageState.key === storageKey ? storageState.pending : null;
  const storageError = storageKey && storageState.key === storageKey ? storageState.error : '';
  const setPending = (value: PendingRefund | null) =>
    setStorageState((previous) => ({
      key: storageKey,
      pending: value,
      error: previous.key === storageKey ? previous.error : '',
    }));
  const setStorageError = (value: string) =>
    setStorageState((previous) => ({
      key: storageKey,
      pending: previous.key === storageKey ? previous.pending : null,
      error: value,
    }));
  const [paymentId, setPaymentId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<RefundMethod>(bankOnly ? 'BANK_TRANSFER' : 'CASH');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<number[]>([]);
  const [reload, setReload] = useState(0);
  const [pageState, setPageState] = useState<{
    key: string;
    page: RefundRequestPage | null;
    error: string;
  } | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const currentCursor = cursor[cursor.length - 1];
  const loadKey = `${scope}:${currentCursor ?? 0}:${reload}:${refreshKey}`;

  useEffect(() => {
    if (!storageKey) return;
    const refresh = () => {
      try {
        setStorageState({
          key: storageKey,
          pending: readPendingRefund(window.localStorage, storageKey),
          error: '',
        });
      } catch {
        setStorageState({
          key: storageKey,
          pending: null,
          error: 'The saved request identity cannot be read. Review before continuing.',
        });
      }
    };
    refresh();
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [storageKey]);
  useEffect(() => {
    let cancelled = false;
    api
      .listRefundRequests({ facilityId, invoiceId, afterId: currentCursor, limit: 20 })
      .then((page) => {
        if (cancelled) return;
        if (!validPage(page, facilityId, invoiceId)) {
          setPageState({
            key: loadKey,
            page: null,
            error: 'Refund requests were not returned safely. Do not assume none exist.',
          });
          return;
        }
        setPageState({ key: loadKey, page, error: '' });
      })
      .catch(() => {
        if (!cancelled)
          setPageState({
            key: loadKey,
            page: null,
            error: 'Refund requests could not be loaded. Do not assume none exist.',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [facilityId, invoiceId, currentCursor, loadKey]);

  const eligible = payments.filter(
    (p) =>
      PATIENT_METHODS.has((p.paymentMethod ?? '').trim().toLowerCase()) || !!p.bankPaymentRecordId,
  );
  const refresh = () => setReload((n) => n + 1);
  const checkStatus = async () => {
    if (!pending || !storageKey || busy) return;
    setBusy(true);
    try {
      const result = await api.checkRefundRequestStatus({
        facilityId,
        idempotencyKey: pending.key,
      });
      if (result.status === 'NOT_FOUND') {
        showToast(
          'No request found yet. A delayed request may still arrive; retain the identity and retry the same details.',
        );
        return;
      }
      if (
        result.status !== 'FOUND' ||
        !validRequest(result.request, facilityId, pending.invoiceId) ||
        result.request.paymentId !== pending.paymentId ||
        result.request.idempotencyKey !== pending.key
      ) {
        showToast('Request status does not match the saved identity. Manual review is required.');
        return;
      }
      clearPendingRefund(window.localStorage, storageKey, pending.key);
      setPending(readPendingRefund(window.localStorage, storageKey));
      showToast(`Refund request ${result.request.requestNumber} found; no money was transferred.`);
      refresh();
    } catch {
      showToast('Request status could not be confirmed. Retain the retry identity.');
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!storageKey || !storageReady || storageError || busy) return;
    const pid = Number(paymentId),
      cents = parseMoneyToCents(amount);
    if (
      !eligible.some((p) => p.id === pid) ||
      cents === null ||
      cents <= 0 ||
      reason.trim().length < 3
    ) {
      showToast('Select a receipt and enter a positive amount and reason.');
      return;
    }
    let key = '';
    try {
      const saved = readPendingRefund(window.localStorage, storageKey);
      if (saved && (saved.invoiceId !== invoiceId || saved.paymentId !== pid)) {
        setPending(saved);
        showToast('Resolve the unconfirmed request before starting another.');
        return;
      }
      key = saved?.key ?? crypto.randomUUID();
      const next = { key, invoiceId, paymentId: pid };
      if (!saved) savePendingRefund(window.localStorage, storageKey, next);
      setPending(next);
    } catch {
      setStorageError('The request retry identity could not be saved. No request was sent.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.createRefundRequest({
        facilityId,
        invoiceId,
        paymentId: pid,
        amount,
        refundMethod: method,
        reason: reason.trim(),
        idempotencyKey: key,
      });
      if (
        !result ||
        !validRequest(result.request, facilityId, invoiceId) ||
        result.request.paymentId !== pid ||
        result.request.idempotencyKey !== key
      )
        throw new Error('Request result did not match.');
      clearPendingRefund(window.localStorage, storageKey, key);
      setPending(readPendingRefund(window.localStorage, storageKey));
      setAmount('');
      setReason('');
      setPaymentId('');
      showToast(
        `Refund request ${result.request.requestNumber} saved for independent review. No funds were sent.`,
      );
      refresh();
    } catch (error) {
      showToast(
        `Request could not be confirmed: ${error instanceof Error ? error.message : 'Request failed.'} Keep the identity and review before retrying.`,
      );
    } finally {
      setBusy(false);
    }
  };
  const decide = async (q: RefundRequestForReview, decision: 'APPROVE' | 'REJECT') => {
    const note = (notes[q.id] ?? '').trim();
    if (busy || !q.reviewHash || note.length < 3) return;
    setBusy(true);
    try {
      const result = await api.decideRefundRequest(q.id, {
        facilityId,
        decision,
        reviewHash: q.reviewHash,
        notes: note,
      });
      if (
        result.requestId !== q.id ||
        result.status !== (decision === 'APPROVE' ? 'APPROVED' : 'REJECTED')
      )
        throw new Error('Review result did not match.');
      showToast(
        `Refund request ${decision === 'APPROVE' ? 'approved' : 'rejected'}; no funds were sent.`,
      );
      setNotes({});
      refresh();
    } catch (error) {
      showToast(
        `Review could not be confirmed: ${error instanceof Error ? error.message : 'Request failed.'} Refresh before retrying.`,
      );
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (q: RefundRequestForReview) => {
    const note = (notes[q.id] ?? '').trim();
    if (busy || note.length < 3) return;
    setBusy(true);
    try {
      const result = await api.revokeRefundApproval(q.id, { facilityId, reason: note });
      if (result.requestId !== q.id || result.status !== 'REVOKED')
        throw new Error('Revocation result did not match.');
      showToast('Unused approval revoked; no funds were sent.');
      setNotes({});
      refresh();
    } catch (error) {
      showToast(
        `Revocation could not be confirmed: ${error instanceof Error ? error.message : 'Request failed.'}`,
      );
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const page = pageState?.key === loadKey ? pageState.page : null;
  const error = pageState?.key === loadKey ? pageState.error : '';
  return (
    <section
      aria-label="Refund requests and independent review"
      className="space-y-3 rounded border border-slate-300 p-3"
    >
      <div>
        <h4 className="font-bold">Refund requests &amp; independent review</h4>
        <p>
          Approval reserves the eligible amount; it does not send or verify money. Manual evidence
          and accounting posting are separate.
        </p>
      </div>
      {canRequest && (
        <div className="space-y-2 rounded bg-slate-50 p-3">
          <h5 className="font-bold">Request a refund</h5>
          {(pending || storageError) && (
            <div role="status" className="rounded border border-amber-300 bg-amber-50 p-2">
              <strong>Unconfirmed refund request needs review</strong>
              {storageError ? (
                <p>{storageError}</p>
              ) : (
                <>
                  <p>
                    Invoice #{pending?.invoiceId}, receipt #{pending?.paymentId}. The amount and
                    reason are not stored in this browser.
                  </p>
                  <button type="button" onClick={checkStatus} disabled={busy} className="underline">
                    Check refund request
                  </button>
                  <p>
                    If not found, a delayed request may still arrive. Retry only the same details
                    with the retained identity.
                  </p>
                </>
              )}
            </div>
          )}
          <label className="block">
            Receipt for refund request
            <select
              value={paymentId}
              onChange={(e) => setPaymentId(e.target.value)}
              className="block w-full rounded border p-2"
            >
              <option value="">Select a receipt</option>
              {eligible.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.receiptNumber} · KES {p.amount}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Requested amount (KES)
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="block w-full rounded border p-2"
            />
          </label>
          <label className="block">
            Requested method
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as RefundMethod)}
              className="block w-full rounded border p-2"
            >
              {!bankOnly && (
                <>
                  <option value="CASH">Cash</option>
                  <option value="MOBILE_MONEY">Mobile money</option>
                  <option value="CARD">Card</option>
                </>
              )}
              <option value="BANK_TRANSFER">Bank transfer</option>
              {!bankOnly && <option value="CHEQUE">Cheque</option>}
            </select>
          </label>
          <label className="block">
            Request reason
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className="block w-full rounded border p-2"
            />
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !storageReady || Boolean(storageError)}
            className="rounded bg-teal-700 px-3 py-1 text-white disabled:opacity-50"
          >
            Submit refund request
          </button>
        </div>
      )}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={refresh} className="underline">
            Retry refund requests
          </button>
        </div>
      ) : !page ? (
        <p role="status">Loading refund requests...</p>
      ) : (
        <>
          {page.requests.length === 0 ? (
            <p>No refund requests on this page.</p>
          ) : (
            <ul className="space-y-3">
              {page.requests.map((q) => (
                <li key={q.id} className="space-y-2 rounded border p-2">
                  <strong>
                    {q.requestNumber} · {q.status === 'SETTLED' ? 'MANUALLY RECORDED' : q.status}
                  </strong>
                  <p>
                    Receipt #{q.paymentId} · KES {q.amount} · {q.refundMethod} · {q.reason}
                  </p>
                  <p>
                    Requested by user #{q.requestedByUserId}
                    {q.reviewedByUserId ? ` · reviewed by user #${q.reviewedByUserId}` : ''}
                  </p>
                  {q.evidence && (
                    <p>
                      Receipt {q.evidence.receiptNumber}: gross KES {q.evidence.receiptGross},
                      refunded KES {q.evidence.receiptRefunded}, reserved KES{' '}
                      {q.evidence.receiptReserved}, available KES {q.evidence.receiptAvailable}.
                      Invoice paid KES {q.evidence.invoicePaid}, reserved KES{' '}
                      {q.evidence.invoiceReserved}, available KES {q.evidence.invoiceAvailable}.
                    </p>
                  )}
                  {q.issue && (
                    <p role="status">
                      Approval unavailable: {q.issue}. Reject or review the source.
                    </p>
                  )}
                  {q.status === 'REQUESTED' && canReview && q.requestedByUserId === userId && (
                    <p>A different authorized reviewer must decide this request.</p>
                  )}
                  {canReview &&
                    q.requestedByUserId !== userId &&
                    (q.status === 'REQUESTED' || q.status === 'APPROVED') && (
                      <>
                        <label className="block">
                          {q.status === 'APPROVED' ? 'Revocation reason' : 'Review notes'} for{' '}
                          {q.requestNumber}
                          <textarea
                            value={notes[q.id] ?? ''}
                            onChange={(e) => setNotes({ ...notes, [q.id]: e.target.value })}
                            maxLength={1000}
                            className="block w-full rounded border p-2"
                          />
                        </label>
                        {q.status === 'REQUESTED' ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => decide(q, 'APPROVE')}
                              disabled={
                                busy || Boolean(q.issue) || (notes[q.id] ?? '').trim().length < 3
                              }
                              className="rounded border px-2 py-1 disabled:opacity-50"
                            >
                              Approve {q.requestNumber}
                            </button>
                            <button
                              type="button"
                              onClick={() => decide(q, 'REJECT')}
                              disabled={busy || (notes[q.id] ?? '').trim().length < 3}
                              className="rounded border px-2 py-1 disabled:opacity-50"
                            >
                              Reject {q.requestNumber}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => revoke(q)}
                            disabled={busy || (notes[q.id] ?? '').trim().length < 3}
                            className="rounded border px-2 py-1 disabled:opacity-50"
                          >
                            Revoke {q.requestNumber}
                          </button>
                        )}
                      </>
                    )}
                  {canRequest && q.status === 'APPROVED' && (
                    <button
                      type="button"
                      onClick={() => onRecordApproved(q)}
                      disabled={busy || recordBlocked}
                      className="rounded border border-teal-700 px-2 py-1 disabled:opacity-50"
                    >
                      Record external refund for {q.requestNumber}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCursor((c) => c.slice(0, -1))}
              disabled={cursor.length === 0}
              className="rounded border px-2 py-1 disabled:opacity-50"
            >
              Previous requests
            </button>
            <button
              type="button"
              onClick={() => {
                if (page.nextAfterId) setCursor((c) => [...c, page.nextAfterId!]);
              }}
              disabled={page.nextAfterId === null}
              className="rounded border px-2 py-1 disabled:opacity-50"
            >
              Next requests
            </button>
            <button type="button" onClick={refresh} className="underline">
              Refresh requests
            </button>
          </div>
        </>
      )}
    </section>
  );
};
