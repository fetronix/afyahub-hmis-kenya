import React, { useEffect, useRef, useState } from 'react';
import { sprintApi, type AccountingOverview } from '../../api/client-sprint.client.ts';

type SourceType = 'BILLING_INVOICE' | 'BILLING_PAYMENT' | 'BILLING_REFUND';
type Pending = { key: string; sourceType: SourceType; sourceId: number };
const types: SourceType[] = ['BILLING_INVOICE', 'BILLING_PAYMENT', 'BILLING_REFUND'];
const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const buttonClass =
  'rounded-lg bg-brand-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50';

function readPending(storageKey: string): Pending | null {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid retry identity');
  const p = value as Partial<Pending>;
  if (
    typeof p.key !== 'string' ||
    p.key.length < 8 ||
    p.key.length > 128 ||
    !types.includes(p.sourceType as SourceType) ||
    !Number.isSafeInteger(p.sourceId) ||
    Number(p.sourceId) <= 0
  )
    throw new Error('Invalid retry identity');
  return p as Pending;
}

/** Reviewed postings only; no account, tariff or external settlement is assumed. */
export const BillingJournalPostingPanel: React.FC<{
  facilityId: number;
  userId: number;
  accounts: AccountingOverview['accounts'];
  onPosted: () => void;
}> = ({ facilityId, userId, accounts, onPosted }) => {
  const storageKey = `jalicare:billing-journal:pending:${userId}:${facilityId}`;
  const active = useRef(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [sourceType, setSourceType] = useState<SourceType>('BILLING_INVOICE');
  const [sourceId, setSourceId] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [description, setDescription] = useState('');
  const [patientAr, setPatientAr] = useState('');
  const [insurerAr, setInsurerAr] = useState('');
  const [revenue, setRevenue] = useState('');
  const [settlement, setSettlement] = useState('');
  const [liability, setLiability] = useState('');
  const [refundAr, setRefundAr] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    active.current = true;
    const refresh = () => {
      try {
        const p = readPending(storageKey);
        setPending(p);
        if (p) {
          setSourceType(p.sourceType);
          setSourceId(String(p.sourceId));
        }
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    };
    refresh();
    window.addEventListener('storage', refresh);
    return () => {
      active.current = false;
      window.removeEventListener('storage', refresh);
    };
  }, [storageKey]);

  const clear = (key: string) => {
    const saved = readPending(storageKey);
    if (saved?.key === key) window.localStorage.removeItem(storageKey);
    setPending(readPending(storageKey));
  };
  const check = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const result = await sprintApi.billingSourceStatus(
        facilityId,
        pending.sourceType,
        pending.sourceId,
      );
      if (!active.current) return;
      if (result.status === 'NOT_FOUND') {
        setMessage(
          'No source posting is recorded yet. A delayed request may still arrive; keep the identity and retry the exact same details or seek review.',
        );
      } else {
        clear(pending.key);
        setMessage(
          `Journal ${result.journalNumber} was recorded${result.reversed ? ' and later reversed' : ''}. Review the allocation before proceeding.`,
        );
        onPosted();
      }
    } catch {
      if (active.current)
        setMessage('Could not safely confirm the source posting. Keep the retry identity.');
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || storageError) return;
    const id = Number(sourceId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      setMessage('Enter a valid source ID.');
      return;
    }
    let identity: Pending;
    try {
      const saved = readPending(storageKey);
      if (saved && (saved.sourceType !== sourceType || saved.sourceId !== id)) {
        setPending(saved);
        setMessage('Resolve the earlier unconfirmed posting first.');
        return;
      }
      identity = saved ?? { key: crypto.randomUUID(), sourceType, sourceId: id };
      if (!saved) window.localStorage.setItem(storageKey, JSON.stringify(identity));
      setPending(identity);
    } catch {
      setStorageError(true);
      setMessage('Could not save a retry identity. No request was sent.');
      return;
    }
    const optional = (value: string) => (value ? Number(value) : undefined);
    const body = {
      facilityId,
      entryDate,
      description,
      ...(sourceType === 'BILLING_INVOICE'
        ? {
            patientReceivableAccountId: optional(patientAr),
            insurerReceivableAccountId: optional(insurerAr),
            revenueAccountId: optional(revenue),
          }
        : {
            settlementAccountId: optional(settlement),
            ...(sourceType === 'BILLING_PAYMENT'
              ? { liabilityAccountId: optional(liability) }
              : { receivableRefundKes: refundAr }),
          }),
    };
    setBusy(true);
    try {
      const result = await sprintApi.postBillingSource(sourceType, id, body, identity.key);
      if (!active.current) return;
      try {
        clear(identity.key);
      } catch {
        setStorageError(true);
      }
      setMessage(
        `Journal ${result.journal.journalNumber} ${result.idempotentReplay ? 'retrieved' : 'posted'}${result.reversed ? ' (subsequently reversed)' : ''}. Receivable KES ${result.allocation.receivableKes}; credit liability KES ${result.allocation.liabilityKes}.`,
      );
      onPosted();
    } catch (error) {
      if (active.current)
        setMessage(
          `Posting was not confirmed: ${error instanceof Error ? error.message : 'Request failed.'} Retain the retry identity and review before changing details.`,
        );
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const selectAccount = (
    label: string,
    type: string,
    value: string,
    change: (value: string) => void,
    required = false,
  ) => (
    <label className="block text-xs">
      {label}
      <select
        className={inputClass}
        aria-label={label}
        value={value}
        onChange={(e) => change(e.target.value)}
        required={required}
      >
        <option value="">Select an approved {type.toLowerCase()} account</option>
        {accounts
          .filter((account) => account.accountType === type)
          .map((account) => (
            <option key={account.accountId} value={account.accountId}>
              {account.accountCode} · {account.accountName}
            </option>
          ))}
      </select>
    </label>
  );
  return (
    <form
      className="rounded-xl border border-hair bg-surface p-4 space-y-3"
      onSubmit={(event) => void submit(event)}
    >
      <h2 className="font-semibold text-ink">Reviewed billing journal</h2>
      <p className="text-xs text-muted">
        An accountant must select the facility-approved accounts. This is a separate posting, not
        automatic billing or proof of a transfer or claim payment. Post the finalized invoice first,
        then receipts and refunds in recorded order.
      </p>
      {storageError && (
        <p role="alert" className="text-xs text-red-700">
          The saved posting identity cannot be read or updated. Stop and seek review.
        </p>
      )}
      {pending && (
        <div role="status" className="rounded border border-amber-300 p-2 text-xs space-y-2">
          <p>
            Unconfirmed {pending.sourceType} #{pending.sourceId}. No amounts or account selections
            are stored in this browser.
          </p>
          <button
            className={buttonClass}
            type="button"
            disabled={busy || storageError}
            onClick={() => void check()}
          >
            Check recorded journal
          </button>
        </div>
      )}
      <label className="block text-xs">
        Source
        <select
          className={inputClass}
          aria-label="Billing source type"
          value={sourceType}
          disabled={!!pending || busy}
          onChange={(event) => setSourceType(event.target.value as SourceType)}
        >
          <option value="BILLING_INVOICE">Finalized invoice</option>
          <option value="BILLING_PAYMENT">Attributed receipt</option>
          <option value="BILLING_REFUND">Manual refund</option>
        </select>
      </label>
      <label className="block text-xs">
        Source ID
        <input
          className={inputClass}
          aria-label="Billing source ID"
          type="number"
          min="1"
          required
          disabled={!!pending || busy}
          value={sourceId}
          onChange={(event) => setSourceId(event.target.value)}
        />
      </label>
      <label className="block text-xs">
        Entry date
        <input
          className={inputClass}
          aria-label="Billing journal date"
          type="date"
          required
          value={entryDate}
          onChange={(event) => setEntryDate(event.target.value)}
        />
      </label>
      <label className="block text-xs">
        Review description
        <input
          className={inputClass}
          aria-label="Billing journal description"
          maxLength={500}
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      {sourceType === 'BILLING_INVOICE' ? (
        <>
          {selectAccount('Patient receivable (if applicable)', 'ASSET', patientAr, setPatientAr)}
          {selectAccount('Insurer receivable (if applicable)', 'ASSET', insurerAr, setInsurerAr)}
          {selectAccount('Revenue account', 'REVENUE', revenue, setRevenue, true)}
        </>
      ) : (
        <>
          {selectAccount(
            'Settlement or clearing account',
            'ASSET',
            settlement,
            setSettlement,
            true,
          )}
          {sourceType === 'BILLING_PAYMENT' ? (
            selectAccount(
              'Credit liability (required if overpaid)',
              'LIABILITY',
              liability,
              setLiability,
            )
          ) : (
            <label className="block text-xs">
              Refund amount restoring receivable (KES; enter 0 if none)
              <input
                className={inputClass}
                aria-label="Refund receivable amount"
                inputMode="decimal"
                required
                value={refundAr}
                onChange={(event) => setRefundAr(event.target.value)}
              />
            </label>
          )}
        </>
      )}
      <button className={buttonClass} disabled={busy || storageError}>
        Post reviewed source
      </button>
      {message && (
        <p role="status" className="text-xs text-slate-700">
          {message}
        </p>
      )}
    </form>
  );
};
