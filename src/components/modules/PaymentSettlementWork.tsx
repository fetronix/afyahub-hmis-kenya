import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  sprintApi,
  type PaymentSettlementPage,
  type PaymentSettlementSource,
  type SettlementAccount,
} from '../../api/client-sprint.client.ts';

const button =
  'rounded-lg bg-brand-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50';
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';

/** Finance review of real, facility-scoped sources; no provider success is inferred. */
export const PaymentSettlementWork: React.FC<{
  facilityId: number;
  canPost: boolean;
  onPosted: () => void;
}> = ({ facilityId, canPost, onPosted }) => {
  const [filter, setFilter] = useState<'UNRESOLVED' | 'ALL'>('UNRESOLVED');
  const [page, setPage] = useState<PaymentSettlementPage | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<PaymentSettlementSource | null>(null);
  const [accounts, setAccounts] = useState<SettlementAccount[]>([]);
  const [accountCursor, setAccountCursor] = useState<number | null>(null);
  const [accountSearch, setAccountSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [description, setDescription] = useState('');
  const [settlement, setSettlement] = useState('');
  const [liability, setLiability] = useState('');
  const [refundReceivable, setRefundReceivable] = useState('');
  const active = useRef(true);
  const pageVersion = useRef(0);
  const accountsVersion = useRef(0);
  const load = useCallback(
    (cursor?: PaymentSettlementPage['next']) => {
      const version = ++pageVersion.current;
      return sprintApi.paymentSettlements(facilityId, filter, cursor).then(
        (result) => {
          if (active.current && version === pageVersion.current) {
            setError('');
            setPage(result);
          }
        },
        (e: unknown) => {
          if (active.current && version === pageVersion.current)
            setError(e instanceof Error ? e.message : 'Unable to load settlement work.');
        },
      );
    },
    [facilityId, filter],
  );
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      pageVersion.current += 1;
      accountsVersion.current += 1;
    };
  }, [load]);

  const browseAccounts = async (search: string, afterId = 0, append = false) => {
    const version = ++accountsVersion.current;
    try {
      const result = await sprintApi.settlementAccounts(facilityId, search, afterId);
      if (!active.current || version !== accountsVersion.current) return;
      setAccounts((current) => {
        // Preserve currently selected accounts when a new search replaces a page.
        const retained = append
          ? current
          : current.filter((a) => String(a.id) === settlement || String(a.id) === liability);
        return [...new Map([...retained, ...result.accounts].map((a) => [a.id, a])).values()];
      });
      setAccountCursor(result.nextAfterId);
      setActiveSearch(search);
    } catch (e) {
      if (active.current && version === accountsVersion.current)
        setError(e instanceof Error ? e.message : 'Unable to browse facility accounts.');
    }
  };
  const openReview = (source: PaymentSettlementSource) => {
    setSelected(source);
    setMessage('');
    setEntryDate('');
    setDescription('');
    setSettlement('');
    setLiability('');
    setRefundReceivable('');
    setAccountSearch('');
    setAccounts([]);
    setAccountCursor(null);
    void browseAccounts('');
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await sprintApi.retryPaymentSettlement(
        selected.sourceType,
        selected.sourceId,
        {
          facilityId,
          entryDate,
          description,
          settlementAccountId: settlement ? Number(settlement) : undefined,
          ...(selected.sourceType === 'BILLING_PAYMENT'
            ? { liabilityAccountId: liability ? Number(liability) : undefined }
            : { receivableRefundKes: refundReceivable }),
        },
      );
      if (!active.current) return;
      setMessage(
        `Journal ${result.journal.journalNumber} ${result.idempotentReplay ? 'retrieved' : 'posted'}${result.reversed ? ' and subsequently reversed' : ''}.`,
      );
      setSelected(null);
      await load();
      onPosted();
    } catch (e) {
      if (active.current)
        setError(
          `Posting was not confirmed: ${e instanceof Error ? e.message : 'Request failed.'} Refresh the source status before changing details; retry the same details if the outcome is unknown.`,
        );
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const accountSelect = (
    label: string,
    type: SettlementAccount['accountType'],
    value: string,
    change: (value: string) => void,
    required: boolean,
  ) => (
    <label className="block text-xs">
      {label}
      <select
        className={field}
        aria-label={label}
        value={value}
        onChange={(e) => change(e.target.value)}
        required={required}
      >
        <option value="">Select a facility-approved {type.toLowerCase()} account</option>
        {accounts
          .filter((a) => a.accountType === type)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.accountCode} · {a.accountName}
            </option>
          ))}
      </select>
    </label>
  );
  return (
    <section
      aria-label="Payment settlement work"
      className="rounded-xl border border-hair bg-surface p-4 space-y-3 text-xs"
    >
      <h2 className="font-semibold">Receipt and refund settlement work</h2>
      <p>
        Recorded receipts and refunds remain here until their reviewed journals exist. This is not
        provider verification. Post the finalized invoice first. A journal reversal does not erase a
        receipt or prove a refund transfer.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label>
          Show sources
          <select
            className={field}
            aria-label="Settlement source filter"
            disabled={busy}
            value={filter}
            onChange={(e) => {
              setSelected(null);
              setPage(null);
              setFilter(e.target.value as typeof filter);
            }}
          >
            <option value="UNRESOLVED">Unresolved work</option>
            <option value="ALL">All receipt and refund sources</option>
          </select>
        </label>
        <button type="button" className={button} onClick={() => void load()} disabled={busy}>
          Refresh settlement work
        </button>
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-emerald-700">
          {message}
        </p>
      )}
      {!page && !error && <p>Loading settlement work…</p>}
      {page && page.sources.length === 0 && <p>No sources on this page.</p>}
      {page && page.sources.length > 0 && (
        <ul className="space-y-2">
          {page.sources.map((source) => (
            <li
              key={`${source.sourceType}:${source.sourceId}`}
              className="rounded border border-hair p-2 space-y-1"
            >
              <p>
                {source.sourceType === 'BILLING_PAYMENT' ? 'Receipt' : 'Manual refund'} #
                {source.sourceId} · {source.recordNumber} · invoice #{source.invoiceId} · KES{' '}
                {source.amountKes}
              </p>
              <p>
                Status: {source.status.replaceAll('_', ' ')}
                {source.reviewCode ? ` · ${source.reviewCode.replaceAll('_', ' ')}` : ''}
                {source.journalId ? ` · journal #${source.journalId}` : ''}
                {source.reversalJournalId ? ` · reversal #${source.reversalJournalId}` : ''}
              </p>
              {canPost && !source.journalId && source.reviewCode !== 'UNTRACKED_SOURCE_JOURNAL' && (
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => openReview(source)}
                  aria-label={`Review posting ${source.sourceType} ${source.sourceId}`}
                >
                  Review posting
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {page?.next && (
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => void load(page.next)}
        >
          Next settlement page
        </button>
      )}
      {page && <p>{page.notice}</p>}
      {selected && canPost && (
        <form onSubmit={(e) => void submit(e)} className="rounded border border-amber-300 p-3">
          <fieldset disabled={busy} className="space-y-3">
            <h3 className="font-semibold">
              Review {selected.sourceType === 'BILLING_PAYMENT' ? 'receipt' : 'manual refund'} #
              {selected.sourceId}
            </h3>
            <p>
              Select only facility-approved accounts. Reusing this source cannot create another
              source journal. Do not enter secrets or patient details in the description.
            </p>
            <div className="flex gap-2 items-end">
              <label className="flex-1">
                Search active facility accounts
                <input
                  className={field}
                  aria-label="Search settlement accounts"
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  maxLength={80}
                />
              </label>
              <button
                type="button"
                className={button}
                onClick={() => void browseAccounts(accountSearch)}
              >
                Search accounts
              </button>
            </div>
            {accountCursor !== null && (
              <button
                type="button"
                className={button}
                onClick={() => void browseAccounts(activeSearch, accountCursor, true)}
              >
                Load more accounts
              </button>
            )}
            {accountSelect('Settlement asset account', 'ASSET', settlement, setSettlement, true)}
            {selected.sourceType === 'BILLING_PAYMENT' ? (
              accountSelect(
                'Credit liability account, if applicable',
                'LIABILITY',
                liability,
                setLiability,
                false,
              )
            ) : (
              <label className="block">
                Refund amount to restore to receivable (KES)
                <input
                  className={field}
                  aria-label="Refund receivable amount"
                  type="text"
                  inputMode="decimal"
                  value={refundReceivable}
                  onChange={(e) => setRefundReceivable(e.target.value)}
                  required
                />
              </label>
            )}
            <label className="block">
              Journal entry date
              <input
                className={field}
                aria-label="Settlement entry date"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                required
              />
            </label>
            <label className="block">
              Reviewed description
              <input
                className={field}
                aria-label="Settlement description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                required
              />
            </label>
            <div className="flex gap-2">
              <button className={button} disabled={busy} type="submit">
                Post reviewed settlement journal
              </button>
              <button
                className={button}
                disabled={busy}
                type="button"
                onClick={() => setSelected(null)}
              >
                Cancel review
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
};
