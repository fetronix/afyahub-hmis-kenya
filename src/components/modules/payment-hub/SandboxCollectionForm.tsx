import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  paymentHubApi,
  type CollectionIntegration,
  type CollectionInvoice,
  type CollectionRecovery,
} from '../../../api/payment-hub.client.ts';
import { useHmis } from '../../../context/HmisContext.tsx';
import {
  clearPendingCollection,
  readPendingCollection,
  savePendingCollection,
  type PendingCollection,
} from '../../../payment-hub/collection-retry-storage.ts';
import {
  collectionStatusLabel,
  collectionStatusNotice,
} from '../../../payment-hub/collection-status.ts';
import { parseMoneyToCents } from '../../../billing/settlement.ts';

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const button =
  'rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50';
const secondary =
  'rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50';

/** Sandbox request preparation only. It cannot record a receipt or pay an invoice. */
export function SandboxCollectionForm({
  selectedInvoice,
  onChanged,
}: {
  selectedInvoice?: {
    id: number;
    invoiceNumber: string;
    balanceAmount: string | null;
    status: string;
  };
  onChanged?: () => void | Promise<void>;
}) {
  const { currentFacility, authenticatedUser } = useHmis();
  const facilityId = currentFacility?.id;
  const userId = authenticatedUser?.id;
  const permissions = authenticatedUser?.permissions ?? [];
  const allowed = Boolean(
    facilityId &&
    userId &&
    !authenticatedUser?.isSuperAdmin &&
    !authenticatedUser?.roles?.includes('SUPER_ADMIN') &&
    permissions.includes('payment_hub.collection.initiate') &&
    permissions.includes('billing.read'),
  );
  const canVerify = permissions.includes('payment_hub.payments.verify');
  const storageName = allowed ? `jalicare:mpesa:pending:${userId}:${facilityId}` : null;
  const version = useRef(0);
  const [integrations, setIntegrations] = useState<CollectionIntegration[]>([]);
  const [integrationCursor, setIntegrationCursor] = useState<number | null>(null);
  const [invoices, setInvoices] = useState<CollectionInvoice[]>([]);
  const [invoiceCursor, setInvoiceCursor] = useState<number | null>(null);
  const [integrationId, setIntegrationId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [allowOverpayment, setAllowOverpayment] = useState(false);
  const [confirmSeparateRequest, setConfirmSeparateRequest] = useState(false);
  const [pending, setPending] = useState<PendingCollection | null>(null);
  const [recovery, setRecovery] = useState<(CollectionRecovery & { key: string }) | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [retryConfirmed, setRetryConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingIntegrations, setLoadingIntegrations] = useState(false);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const loading = loadingIntegrations || loadingInvoices;
  const [integrationError, setIntegrationError] = useState(false);
  const [invoiceError, setInvoiceError] = useState(false);
  const [integrationRetry, setIntegrationRetry] = useState(0);
  const [invoiceRetry, setInvoiceRetry] = useState(0);
  const [storageProblem, setStorageProblem] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fixedInvoice = Boolean(selectedInvoice);

  useLayoutEffect(() => {
    version.current += 1;
    setIntegrations([]);
    setInvoices([]);
    setIntegrationCursor(null);
    setInvoiceCursor(null);
    setIntegrationId('');
    setInvoiceId('');
    setAmount('');
    setPhone('');
    setSearch('');
    setAppliedSearch('');
    setAllowOverpayment(false);
    setConfirmSeparateRequest(false);
    setPending(null);
    setRecovery(null);
    setReviewed(false);
    setRetryConfirmed(false);
    setError('');
    setNotice('');
    setBusy(false);
    setLoadingIntegrations(false);
    setLoadingInvoices(false);
    setIntegrationError(false);
    setInvoiceError(false);
    setStorageProblem(false);
    return () => {
      version.current += 1;
    };
  }, [facilityId, userId, allowed]);

  const readRecoveryIdentity = useCallback(() => {
    if (!storageName) return;
    try {
      setPending(readPendingCollection(window.localStorage, storageName));
      setRecovery(null);
      setReviewed(false);
      setRetryConfirmed(false);
      setStorageProblem(false);
    } catch {
      setStorageProblem(true);
    }
  }, [storageName]);

  useEffect(() => {
    readRecoveryIdentity();
    const changed = (event: StorageEvent) => {
      if (!storageName || (event.key !== storageName && event.key !== null)) return;
      // Another tab may have changed the identity while a request was in flight.
      // Its stale result must never authorize clearing the new identity.
      version.current += 1;
      setBusy(false);
      setAmount('');
      setPhone('');
      setNotice('The saved request changed in another tab. Check it before continuing.');
      readRecoveryIdentity();
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [readRecoveryIdentity, storageName]);

  useEffect(() => {
    if (!allowed || !facilityId) return;
    let cancelled = false;
    setLoadingIntegrations(true);
    setIntegrationError(false);
    setIntegrations([]);
    setIntegrationId('');
    setIntegrationCursor(null);
    paymentHubApi
      .collectionIntegrations(facilityId)
      .then((page) => {
        if (cancelled) return;
        setIntegrations(page.integrations);
        setIntegrationCursor(page.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setIntegrationError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingIntegrations(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, facilityId, integrationRetry]);

  useEffect(() => {
    if (!allowed || !facilityId || fixedInvoice) {
      setLoadingInvoices(false);
      return;
    }
    let cancelled = false;
    setLoadingInvoices(true);
    setInvoiceError(false);
    setInvoices([]);
    setInvoiceCursor(null);
    paymentHubApi
      .collectionInvoices(facilityId, appliedSearch)
      .then((page) => {
        if (cancelled) return;
        setInvoices(page.invoices);
        setInvoiceCursor(page.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setInvoiceError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingInvoices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, facilityId, fixedInvoice, appliedSearch, invoiceRetry]);

  async function recover(saved: PendingCollection, activeVersion: number) {
    if (!facilityId) return;
    const result = await paymentHubApi.recoverCollection(facilityId, saved.key);
    if (activeVersion !== version.current) return;
    if (!storageName || readPendingCollection(window.localStorage, storageName)?.key !== saved.key)
      throw new Error('The saved request changed; check its identity before continuing.');
    if (
      result.transaction &&
      (result.transaction.invoiceId !== saved.invoiceId ||
        result.transaction.integrationId !== saved.integrationId)
    )
      throw new Error(
        'The retry identity does not match the saved invoice or integration; review it.',
      );
    setRecovery({ ...result, key: saved.key });
    setReviewed(false);
    setRetryConfirmed(false);
  }

  async function checkRecovery() {
    if (!pending || busy) return;
    const activeVersion = version.current;
    setBusy(true);
    setError('');
    try {
      await recover(pending, activeVersion);
    } catch (err) {
      if (activeVersion === version.current)
        setError(err instanceof Error ? err.message : 'Unable to check the earlier request.');
    } finally {
      if (activeVersion === version.current) setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!allowed || !facilityId || !storageName || busy || loading) return;
    const selectedId = selectedInvoice?.id ?? pending?.invoiceId ?? Number(invoiceId);
    const selectedIntegration = pending?.integrationId ?? Number(integrationId);
    if (
      !Number.isSafeInteger(selectedId) ||
      selectedId <= 0 ||
      !Number.isSafeInteger(selectedIntegration) ||
      selectedIntegration <= 0
    ) {
      setError('Select an available integration and invoice.');
      return;
    }
    if (
      pending &&
      (recovery?.key !== pending.key ||
        recovery.recovery !== 'NOT_FOUND' ||
        pending.invoiceId !== selectedId ||
        !retryConfirmed)
    ) {
      setError('Review and confirm the exact earlier request before retrying.');
      return;
    }
    const activeVersion = version.current;
    setBusy(true);
    setError('');
    setNotice('');
    let saved = pending;
    try {
      if (saved && readPendingCollection(window.localStorage, storageName)?.key !== saved.key)
        throw new Error('The saved request changed; check its identity before continuing.');
      if (!saved) {
        const existing = readPendingCollection(window.localStorage, storageName);
        if (existing) {
          setPending(existing);
          setRecovery(null);
          throw new Error('An earlier request needs review before another can start.');
        }
        saved = {
          key: crypto.randomUUID(),
          invoiceId: selectedId,
          integrationId: selectedIntegration,
          allowOverpayment,
          confirmSeparateRequest,
        };
        // Persist before network dispatch. Never store the phone number or amount.
        try {
          savePendingCollection(window.localStorage, storageName, saved);
          const stored = readPendingCollection(window.localStorage, storageName);
          if (
            !stored ||
            stored.key !== saved.key ||
            stored.invoiceId !== saved.invoiceId ||
            stored.integrationId !== saved.integrationId ||
            stored.allowOverpayment !== saved.allowOverpayment ||
            stored.confirmSeparateRequest !== saved.confirmSeparateRequest
          )
            throw new Error('Retry identity was not retained.');
        } catch {
          setStorageProblem(true);
          throw new Error('The retry identity could not be stored; no request was sent.');
        }
        setPending(saved);
      }
      const result = await paymentHubApi.collect(
        {
          facilityId,
          integrationId: saved.integrationId,
          invoiceId: saved.invoiceId,
          amountKes: amount,
          phone,
          allowOverpayment: saved.allowOverpayment,
          confirmSeparateRequest: saved.confirmSeparateRequest,
        },
        saved.key,
      );
      if (activeVersion !== version.current) return;
      setNotice(result.notice);
      await recover(saved, activeVersion);
      if (activeVersion === version.current) await onChanged?.();
    } catch (err) {
      if (activeVersion === version.current)
        setError(
          err instanceof Error
            ? err.message
            : 'Request outcome could not be established. Check the saved request before repeating.',
        );
    } finally {
      if (activeVersion === version.current) {
        setPhone('');
        setAmount('');
        setRetryConfirmed(false);
        setBusy(false);
      }
    }
  }

  async function querySavedStatus() {
    if (!facilityId || !pending || recovery?.key !== pending.key || !recovery.transaction || busy)
      return;
    const activeVersion = version.current;
    setBusy(true);
    setError('');
    try {
      const result = await paymentHubApi.query(recovery.transaction.id, facilityId);
      if (activeVersion !== version.current) return;
      setNotice(result.notice);
      await recover(pending, activeVersion);
      if (activeVersion === version.current) await onChanged?.();
    } catch (err) {
      if (activeVersion === version.current)
        setError(err instanceof Error ? err.message : 'Unable to query the provider.');
    } finally {
      if (activeVersion === version.current) setBusy(false);
    }
  }

  function startSeparate() {
    if (
      !pending ||
      !storageName ||
      !reviewed ||
      recovery?.key !== pending.key ||
      !['RECORDED', 'NOT_FOUND'].includes(recovery.recovery)
    )
      return;
    try {
      if (!clearPendingCollection(window.localStorage, storageName, pending.key))
        throw new Error('The saved retry identity changed; review transactions again.');
      setPending(null);
      setRecovery(null);
      setReviewed(false);
      setPhone('');
      setAmount('');
      setConfirmSeparateRequest(true);
      setNotice(
        'Review acknowledged. A new request uses a different retry identity; an earlier request may still arrive.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The earlier request could not be cleared.');
    }
  }

  async function moreIntegrations() {
    if (!facilityId || !integrationCursor || busy) return;
    const activeVersion = version.current;
    setBusy(true);
    try {
      const page = await paymentHubApi.collectionIntegrations(facilityId, integrationCursor);
      if (activeVersion === version.current) {
        setIntegrations((old) => [...old, ...page.integrations]);
        setIntegrationCursor(page.nextCursor);
      }
    } catch {
      if (activeVersion === version.current) setError('Could not load more integrations.');
    } finally {
      if (activeVersion === version.current) setBusy(false);
    }
  }
  async function moreInvoices() {
    if (!facilityId || !invoiceCursor || busy) return;
    const activeVersion = version.current;
    setBusy(true);
    try {
      const page = await paymentHubApi.collectionInvoices(facilityId, appliedSearch, invoiceCursor);
      if (activeVersion === version.current) {
        setInvoices((old) => [...old, ...page.invoices]);
        setInvoiceCursor(page.nextCursor);
      }
    } catch {
      if (activeVersion === version.current) setError('Could not load more invoices.');
    } finally {
      if (activeVersion === version.current) setBusy(false);
    }
  }

  if (!allowed || !facilityId) return null;
  const activeRecovery = pending && recovery?.key === pending.key ? recovery : null;
  const recorded = activeRecovery?.transaction ?? null;
  const otherInvoice = Boolean(
    pending && selectedInvoice && pending.invoiceId !== selectedInvoice.id,
  );
  const balance = selectedInvoice ? parseMoneyToCents(selectedInvoice.balanceAmount) : null;
  const invoiceEligible =
    !selectedInvoice || (selectedInvoice.status !== 'Void' && balance !== null && balance > 0);
  const canSubmit =
    invoiceEligible &&
    !storageProblem &&
    (Boolean(pending) || (!integrationError && (fixedInvoice || !invoiceError))) &&
    (!pending || (activeRecovery?.recovery === 'NOT_FOUND' && !otherInvoice));
  return (
    <details className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-semibold">Request M-Pesa sandbox prompt</summary>
      <p className="text-xs text-amber-900">
        Sandbox only: acceptance is not payment. Callbacks are disabled; this request cannot create
        a receipt, change an invoice balance or post a ledger entry. Use an isolated test facility.
      </p>
      {!invoiceEligible && (
        <p className="text-xs text-amber-900">
          This invoice has no known positive balance or is void; a new request cannot be sent.
        </p>
      )}
      {loading && <p role="status">Loading available records…</p>}
      {integrationError && (
        <div role="alert" className="text-xs text-rose-700">
          Sandbox integrations could not be loaded.{' '}
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => setIntegrationRetry((n) => n + 1)}
          >
            Retry integration options
          </button>
        </div>
      )}
      {!fixedInvoice && invoiceError && (
        <div role="alert" className="text-xs text-rose-700">
          Invoice options could not be loaded.{' '}
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => setInvoiceRetry((n) => n + 1)}
          >
            Retry invoice options
          </button>
        </div>
      )}
      {!loading && !integrationError && !pending && integrations.length === 0 && (
        <p className="text-xs text-amber-900">
          No enabled M-Pesa sandbox integration is available for this facility.
        </p>
      )}
      {storageProblem && (
        <p role="alert" className="text-sm text-rose-700">
          The sandbox retry identity cannot be stored or read. No new request can be sent; review
          transactions and browser storage before continuing.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-slate-700">
          {notice}
        </p>
      )}
      {pending && (
        <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs">
          <p>
            Saved request for invoice #{pending.invoiceId}. The retry identity is retained without
            the phone number or amount. Check it before sending another request.
          </p>
          {otherInvoice && <p>Select the original invoice to retry it with the same identity.</p>}
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => void checkRecovery()}
          >
            Check earlier request
          </button>
          {activeRecovery?.recovery === 'NOT_FOUND' && (
            <p>
              No saved server request found. It could still arrive; re-enter the exact original
              amount and phone below to retry using the same identity, not a new request.
            </p>
          )}
          {recorded && (
            <>
              <p>
                Request #{recorded.id}:{' '}
                {collectionStatusLabel(recorded.status, recorded.resultCode)}
              </p>
              <p>{collectionStatusNotice(recorded.status, recorded.resultCode)}</p>
              {canVerify && recorded.hasProviderReference && (
                <button
                  type="button"
                  className={secondary}
                  disabled={busy}
                  onClick={() => void querySavedStatus()}
                >
                  Query provider status
                </button>
              )}
            </>
          )}
          {activeRecovery && (
            <>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                {recorded
                  ? 'I reviewed this request and understand that a separate request may duplicate it.'
                  : 'I reviewed the transaction history with an authorized operator and understand this request may still arrive and be duplicated.'}
              </label>
              <button
                type="button"
                className={secondary}
                disabled={busy || !reviewed}
                onClick={startSeparate}
              >
                Start a separate request
              </button>
            </>
          )}
        </div>
      )}
      {canSubmit && (
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
          {!pending && (
            <label className="text-xs">
              Sandbox integration
              <select
                className={field}
                required
                value={integrationId}
                onChange={(e) => setIntegrationId(e.target.value)}
              >
                <option value="">Select an enabled integration</option>
                {integrations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.providerName} · sandbox #{item.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!pending && integrationCursor && (
            <button
              type="button"
              className={secondary}
              disabled={busy || loading}
              onClick={() => void moreIntegrations()}
            >
              Load more integrations
            </button>
          )}
          {!selectedInvoice && !pending && (
            <div className="space-y-1 text-xs">
              <label>
                Search invoice number (optional)
                <input
                  className={field}
                  value={search}
                  maxLength={80}
                  disabled={busy}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <button
                type="button"
                className={secondary}
                disabled={busy || loading}
                onClick={() => {
                  setInvoiceId('');
                  setAppliedSearch(search.trim());
                }}
              >
                Browse invoices
              </button>
              <label className="block">
                Invoice
                <select
                  className={field}
                  required
                  value={invoiceId}
                  onChange={(e) => setInvoiceId(e.target.value)}
                >
                  <option value="">Select an invoice</option>
                  {invoices.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.invoiceNumber} · KES {item.balanceAmount} due
                    </option>
                  ))}
                </select>
              </label>
              {invoiceCursor && (
                <button
                  type="button"
                  className={secondary}
                  disabled={busy || loading}
                  onClick={() => void moreInvoices()}
                >
                  Load more invoices
                </button>
              )}
            </div>
          )}
          {selectedInvoice && (
            <p className="text-xs">
              Selected invoice: {selectedInvoice.invoiceNumber} · KES{' '}
              {selectedInvoice.balanceAmount ?? 'unknown'} due
            </p>
          )}
          <label className="text-xs">
            Amount (whole KES)
            <input
              className={field}
              required
              inputMode="numeric"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setRetryConfirmed(false);
              }}
            />
          </label>
          <label className="text-xs">
            Payment phone (254 format)
            <input
              className={field}
              required
              autoComplete="off"
              inputMode="numeric"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setRetryConfirmed(false);
              }}
            />
          </label>
          {!pending && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={allowOverpayment}
                onChange={(e) => setAllowOverpayment(e.target.checked)}
              />
              Explicitly allow an amount above the invoice balance
            </label>
          )}
          {!pending && (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={confirmSeparateRequest}
                onChange={(e) => setConfirmSeparateRequest(e.target.checked)}
              />
              I reviewed earlier provider requests with an authorized operator and intend a separate
              request.
            </label>
          )}
          {pending && (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={retryConfirmed}
                onChange={(e) => setRetryConfirmed(e.target.checked)}
              />
              I re-entered the exact original amount and phone for this request.
            </label>
          )}
          <button
            className={button}
            disabled={busy || loading || Boolean(pending && !retryConfirmed)}
          >
            {pending ? 'Retry exact request with same identity' : 'Request sandbox STK'}
          </button>
        </form>
      )}
    </details>
  );
}
