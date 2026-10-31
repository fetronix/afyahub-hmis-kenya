import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BillingJournalPostingPanel } from './BillingJournalPostingPanel.tsx';
import { getSessionToken } from '../../api/client.ts';
import {
  sprintApi,
  type AccountingOverview,
  type BillingLedgerReview,
} from '../../api/client-sprint.client.ts';
import { useHmis } from '../../context/HmisContext.tsx';

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const buttonClass =
  'rounded-lg bg-brand-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50';
const today = () => new Date().toISOString().slice(0, 10);

export const AccountingModule: React.FC = () => {
  const { currentFacility, authenticatedUser, showToast } = useHmis();
  const [start, setStart] = useState(`${today().slice(0, 4)}-01-01`),
    [end, setEnd] = useState(today());
  const [data, setData] = useState<AccountingOverview | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [dataScope, setDataScope] = useState('');
  const facilityId = currentFacility?.id;
  const currentScope = `${facilityId ?? ''}:${start}:${end}`;
  const scopeRef = useRef(currentScope);
  useLayoutEffect(() => {
    scopeRef.current = currentScope;
  }, [currentScope]);
  const visibleData = dataScope === currentScope ? data : null;
  const [billingReport, setBillingReport] = useState<BillingLedgerReview | null>(null);
  const [billingReportError, setBillingReportError] = useState('');
  const [billingErrorScope, setBillingErrorScope] = useState('');
  const [billingReportScope, setBillingReportScope] = useState('');
  const visibleBillingReport = billingReportScope === currentScope ? billingReport : null;
  const [journalReport, setJournalReport] = useState<Awaited<
    ReturnType<typeof sprintApi.billingJournalExceptions>
  > | null>(null);
  const [journalReportError, setJournalReportError] = useState('');
  const [journalErrorScope, setJournalErrorScope] = useState('');
  const [journalReportScope, setJournalReportScope] = useState('');
  const visibleJournalReport = journalReportScope === currentScope ? journalReport : null;
  const [account, setAccount] = useState({
    accountCode: '',
    accountName: '',
    accountType: 'ASSET',
    subType: '',
    normalBalance: 'DEBIT',
  });
  const [period, setPeriod] = useState({ periodCode: '', name: '', startDate: '', endDate: '' });
  const [journal, setJournal] = useState({
    entryDate: '',
    description: '',
    debitAccount: '',
    creditAccount: '',
    amountKes: '',
  });
  const [journalKey, setJournalKey] = useState(() => crypto.randomUUID());
  const [reversal, setReversal] = useState({ journalId: '', entryDate: '', reason: '' });
  const [reversalKey, setReversalKey] = useState(() => crypto.randomUUID());
  const [closeNotes, setCloseNotes] = useState('');
  const perms = new Set(authenticatedUser?.permissions ?? []);
  const can = (permission: string) =>
    Boolean(authenticatedUser?.isSuperAdmin || perms.has(permission));
  const load = useCallback(async () => {
    if (!facilityId || !end) return;
    const requestedScope = `${facilityId}:${start}:${end}`;
    try {
      setError('');
      const overview = await sprintApi.accountingOverview(facilityId, start, end);
      if (scopeRef.current !== requestedScope) return;
      setData(overview);
      setDataScope(requestedScope);
    } catch (e: unknown) {
      if (scopeRef.current === requestedScope)
        setError(e instanceof Error ? e.message : 'Could not load accounting.');
    }
  }, [facilityId, start, end]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      showToast(success, { tone: 'success' });
      await load();
      return true;
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Operation failed.', { tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const loadBillingReport = async (afterId = 0) => {
    if (!currentFacility) return;
    const requestedScope = `${currentFacility.id}:${start}:${end}`;
    try {
      setBillingReportError('');
      setBillingErrorScope(requestedScope);
      const report = await sprintApi.billingLedgerReview(currentFacility.id, start, end, afterId);
      if (scopeRef.current === requestedScope) {
        setBillingReport(report);
        setBillingReportScope(requestedScope);
      }
    } catch (error: unknown) {
      if (scopeRef.current === requestedScope)
        setBillingReportError(
          error instanceof Error ? error.message : 'Billing consistency review failed.',
        );
    }
  };
  const loadJournalReport = async (afterId = 0) => {
    if (!currentFacility) return;
    const requestedScope = `${currentFacility.id}:${start}:${end}`;
    try {
      setJournalReportError('');
      setJournalErrorScope(requestedScope);
      const report = await sprintApi.billingJournalExceptions(
        currentFacility.id,
        start,
        end,
        afterId,
      );
      if (scopeRef.current === requestedScope) {
        setJournalReport(report);
        setJournalReportScope(requestedScope);
      }
    } catch (error: unknown) {
      if (scopeRef.current === requestedScope)
        setJournalReportError(
          error instanceof Error ? error.message : 'Journal exception review failed.',
        );
    }
  };
  const exportCsv = async () => {
    if (!currentFacility) return;
    try {
      const q = new URLSearchParams({
        facilityId: String(currentFacility.id),
        startDate: start,
        endDate: end,
      });
      const token = getSessionToken();
      const response = await fetch(`/api/accounting/trial-balance.csv?${q}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error('Could not export the trial balance.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'trial-balance.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Export failed.', { tone: 'error' });
    }
  };
  if (!currentFacility) return <p>Select a facility to view accounting.</p>;
  return (
    <div className="space-y-5">
      <header className="rounded-xl border border-hair bg-surface p-5">
        <h1 className="font-display text-xl text-ink">Accounting &amp; general ledger</h1>
        <p className="mt-2 text-xs text-muted">
          Ledger postings only. Reviewed billing sources can be posted separately; automatic
          posting, full payer and bank reconciliation, and unrecorded costs are not included.
        </p>
      </header>
      {can('accounting.read') && can('billing.read') && (
        <section className="rounded-xl border border-hair bg-surface p-4 space-y-2 text-xs">
          <h2 className="font-semibold">Billing and ledger exception review</h2>
          <p>
            Checks current invoice lines, receipts, refunds, voids and source-linked journals for
            invoices created in the selected date range. This is a partial exception review, not a
            full general-ledger, bank or payer reconciliation.
          </p>
          <button className={buttonClass} onClick={() => void loadBillingReport()}>
            Review first page
          </button>
          {billingErrorScope === currentScope && billingReportError && (
            <p role="alert" className="text-red-700">
              {billingReportError}
            </p>
          )}
          {visibleBillingReport && (
            <>
              <p>
                Examined {visibleBillingReport.pageSummary.examined}; requiring review{' '}
                {visibleBillingReport.pageSummary.requiringReview} on this page.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Lines</th>
                      <th>Paid</th>
                      <th>Receipts</th>
                      <th>Findings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBillingReport.invoices.map((row) => (
                      <tr key={row.id}>
                        <td>{row.invoiceNumber}</td>
                        <td>{row.status ?? 'Unknown'}</td>
                        <td>{row.total ?? 'Missing'}</td>
                        <td>{row.lineTotal ?? 'Missing'}</td>
                        <td>{row.paid ?? 'Missing'}</td>
                        <td>{row.paymentTotal ?? 'Missing'}</td>
                        <td>{row.issues.join(', ') || 'No mismatch detected'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3 className="font-semibold">Source-linked journal checks</h3>
              <p>
                Examined {visibleBillingReport.ledgerPageSummary.examined} source events;{' '}
                {visibleBillingReport.ledgerPageSummary.unposted} have no linked journal. An amount
                match does not verify accounting classification.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr>
                      <th>Invoice ID</th>
                      <th>Source</th>
                      <th>Amount</th>
                      <th>Journal IDs</th>
                      <th>Findings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBillingReport.sourceEvents.map((event) => (
                      <tr key={`${event.sourceType}:${event.sourceId}`}>
                        <td>{event.invoiceId}</td>
                        <td>
                          {event.sourceType} #{event.sourceId}
                          {event.payerLinked ? ' (payer-linked receipt)' : ''}
                        </td>
                        <td>{event.amount ?? 'Missing'}</td>
                        <td>{event.journalIds.join(', ') || 'None'}</td>
                        <td>
                          {event.issues.join(', ') || 'Amount match only — account review required'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {visibleBillingReport.nextAfterId !== null && (
                <button
                  className={buttonClass}
                  onClick={() => void loadBillingReport(visibleBillingReport.nextAfterId!)}
                >
                  Next page
                </button>
              )}
              <p>{visibleBillingReport.limitations.notice}</p>
            </>
          )}
        </section>
      )}
      {can('accounting.read') && can('billing.read') && (
        <section className="rounded-xl border border-hair bg-surface p-4 space-y-2 text-xs">
          <h2 className="font-semibold">Journal-side billing exceptions</h2>
          <p>
            Checks known source-linked journals by journal date, separately from the invoice-date
            review.
          </p>
          <button className={buttonClass} onClick={() => void loadJournalReport()}>
            Review journal sources
          </button>
          {journalErrorScope === currentScope && journalReportError && (
            <p role="alert" className="text-red-700">
              {journalReportError}
            </p>
          )}
          {visibleJournalReport && (
            <>
              <p>
                Examined {visibleJournalReport.pageSummary.examined}; requiring review{' '}
                {visibleJournalReport.pageSummary.requiringReview} on this page.
              </p>
              <ul>
                {visibleJournalReport.journals
                  .filter((j) => j.issues.length)
                  .map((j) => (
                    <li key={j.id}>
                      Journal #{j.id} · {j.sourceType} #{j.sourceId ?? 'missing'}:{' '}
                      {j.issues.join(', ')}
                    </li>
                  ))}
              </ul>
              {visibleJournalReport.nextAfterJournalId !== null && (
                <button
                  className={buttonClass}
                  onClick={() => void loadJournalReport(visibleJournalReport.nextAfterJournalId!)}
                >
                  Next journal page
                </button>
              )}
              <p>{visibleJournalReport.limitations}</p>
            </>
          )}
        </section>
      )}
      {authenticatedUser &&
        !authenticatedUser.isSuperAdmin &&
        can('accounting.read') &&
        can('billing.read') &&
        can('accounting.journals.post') && (
          <BillingJournalPostingPanel
            key={`${currentFacility.id}:${authenticatedUser.id}`}
            facilityId={currentFacility.id}
            userId={authenticatedUser.id}
            accounts={visibleData?.accounts ?? []}
            onPosted={() => void load()}
          />
        )}
      <section className="rounded-xl border border-hair bg-surface p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            From
            <input
              className={inputClass}
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="text-xs">
            Through
            <input
              className={inputClass}
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <button className={buttonClass} onClick={() => void load()}>
            Refresh
          </button>
          {can('accounting.reports.export') && (
            <button className="btn-quiet" onClick={() => void exportCsv()}>
              Export trial balance
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        )}
        {visibleData && (
          <>
            <div className="grid gap-3 sm:grid-cols-3 text-xs">
              <div className="rounded-lg bg-slate-50 p-3">
                <strong>Trial balance</strong>
                <p>
                  Debits KES {visibleData.trialBalance.debitKes} · Credits KES{' '}
                  {visibleData.trialBalance.creditKes}
                </p>
                <p>
                  {visibleData.trialBalance.balanced ? 'Balanced' : 'Difference requires review'}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <strong>Posted income statement</strong>
                <p>Revenue KES {visibleData.profitAndLoss.postedRevenueKes}</p>
                <p>Expenses KES {visibleData.profitAndLoss.postedExpensesKes}</p>
                <p>Ledger result KES {visibleData.profitAndLoss.ledgerResultKes}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <strong>Balance sheet as of {visibleData.balanceSheet.asOf}</strong>
                <p>Assets KES {visibleData.balanceSheet.assetsKes}</p>
                <p>
                  Liabilities + equity KES {visibleData.balanceSheet.liabilitiesKes} +{' '}
                  {visibleData.balanceSheet.equityIncludingAccumulatedResultKes}
                </p>
                <p>
                  {visibleData.balanceSheet.balanced ? 'Balanced' : 'Difference requires review'}
                </p>
              </div>
            </div>
            <p className="text-xs text-amber-800">
              {visibleData.limitations.notice} Service-line profitability is unavailable until costs
              and allocations are verified.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Debits</th>
                    <th>Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleData.accounts.map((a) => (
                    <tr key={a.accountId} className="border-t border-hair">
                      <td className="py-2">
                        {a.accountCode} · {a.accountName}
                      </td>
                      <td>{a.accountType}</td>
                      <td>{a.debitKes}</td>
                      <td>{a.creditKes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      {can('accounting.coa.manage') && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form
            className="rounded-xl border border-hair bg-surface p-4 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => sprintApi.createAccount({ facilityId: currentFacility.id, ...account }),
                'Account created.',
              );
            }}
          >
            <h2 className="font-semibold text-ink">Add account</h2>
            <input
              className={inputClass}
              aria-label="Account code"
              placeholder="Account code"
              required
              value={account.accountCode}
              onChange={(e) => setAccount({ ...account, accountCode: e.target.value })}
            />
            <input
              className={inputClass}
              aria-label="Account name"
              placeholder="Account name"
              required
              value={account.accountName}
              onChange={(e) => setAccount({ ...account, accountName: e.target.value })}
            />
            <input
              className={inputClass}
              aria-label="Account subtype"
              placeholder="Account subtype"
              required
              value={account.subType}
              onChange={(e) => setAccount({ ...account, subType: e.target.value })}
            />
            <div className="flex gap-2">
              <select
                className={inputClass}
                aria-label="Account type"
                value={account.accountType}
                onChange={(e) => setAccount({ ...account, accountType: e.target.value })}
              >
                {['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
              <select
                className={inputClass}
                aria-label="Normal balance"
                value={account.normalBalance}
                onChange={(e) => setAccount({ ...account, normalBalance: e.target.value })}
              >
                <option>DEBIT</option>
                <option>CREDIT</option>
              </select>
            </div>
            <button className={buttonClass} disabled={busy}>
              Create account
            </button>
          </form>
          <form
            className="rounded-xl border border-hair bg-surface p-4 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => sprintApi.createPeriod({ facilityId: currentFacility.id, ...period }),
                'Financial period opened.',
              );
            }}
          >
            <h2 className="font-semibold text-ink">Open financial period</h2>
            <input
              className={inputClass}
              aria-label="Period code"
              placeholder="Period code"
              required
              value={period.periodCode}
              onChange={(e) => setPeriod({ ...period, periodCode: e.target.value })}
            />
            <input
              className={inputClass}
              aria-label="Period name"
              placeholder="Period name"
              required
              value={period.name}
              onChange={(e) => setPeriod({ ...period, name: e.target.value })}
            />
            <label className="text-xs">
              Start date
              <input
                className={inputClass}
                type="date"
                required
                value={period.startDate}
                onChange={(e) => setPeriod({ ...period, startDate: e.target.value })}
              />
            </label>
            <label className="text-xs">
              End date
              <input
                className={inputClass}
                type="date"
                required
                value={period.endDate}
                onChange={(e) => setPeriod({ ...period, endDate: e.target.value })}
              />
            </label>
            <button className={buttonClass} disabled={busy}>
              Open period
            </button>
          </form>
        </div>
      )}
      {can('accounting.journals.post') && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form
            className="rounded-xl border border-hair bg-surface p-4 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                const ok = await run(
                  () =>
                    sprintApi.postJournal(
                      {
                        facilityId: currentFacility.id,
                        entryDate: journal.entryDate,
                        description: journal.description,
                        lines: [
                          { accountId: Number(journal.debitAccount), debitKes: journal.amountKes },
                          {
                            accountId: Number(journal.creditAccount),
                            creditKes: journal.amountKes,
                          },
                        ],
                      },
                      journalKey,
                    ),
                  'Balanced journal posted.',
                );
                if (ok) {
                  setJournalKey(crypto.randomUUID());
                  setJournal({
                    entryDate: '',
                    description: '',
                    debitAccount: '',
                    creditAccount: '',
                    amountKes: '',
                  });
                }
              })();
            }}
          >
            <h2 className="font-semibold text-ink">Post two-line journal</h2>
            <label className="text-xs">
              Entry date
              <input
                className={inputClass}
                type="date"
                required
                value={journal.entryDate}
                onChange={(e) => setJournal({ ...journal, entryDate: e.target.value })}
              />
            </label>
            <input
              className={inputClass}
              aria-label="Journal description"
              placeholder="Description"
              required
              value={journal.description}
              onChange={(e) => setJournal({ ...journal, description: e.target.value })}
            />
            <select
              className={inputClass}
              aria-label="Debit account"
              required
              value={journal.debitAccount}
              onChange={(e) => setJournal({ ...journal, debitAccount: e.target.value })}
            >
              <option value="">Select debit account</option>
              {visibleData?.accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.accountCode} · {a.accountName}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              aria-label="Credit account"
              required
              value={journal.creditAccount}
              onChange={(e) => setJournal({ ...journal, creditAccount: e.target.value })}
            >
              <option value="">Select credit account</option>
              {visibleData?.accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.accountCode} · {a.accountName}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              aria-label="Amount in KES"
              placeholder="Amount in KES"
              required
              inputMode="decimal"
              value={journal.amountKes}
              onChange={(e) => setJournal({ ...journal, amountKes: e.target.value })}
            />
            <button className={buttonClass} disabled={busy}>
              Post journal
            </button>
            <p className="text-2xs text-muted">
              Retries use the same idempotency key until a successful response.
            </p>
          </form>
          <form
            className="rounded-xl border border-hair bg-surface p-4 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                const ok = await run(
                  () =>
                    sprintApi.reverseJournal(
                      Number(reversal.journalId),
                      {
                        facilityId: currentFacility.id,
                        entryDate: reversal.entryDate,
                        reason: reversal.reason,
                      },
                      reversalKey,
                    ),
                  'Reversal posted; the original journal remains unchanged.',
                );
                if (ok) {
                  setReversalKey(crypto.randomUUID());
                  setReversal({ journalId: '', entryDate: '', reason: '' });
                }
              })();
            }}
          >
            <h2 className="font-semibold text-ink">Controlled reversal</h2>
            <select
              className={inputClass}
              aria-label="Journal to reverse"
              required
              value={reversal.journalId}
              onChange={(e) => setReversal({ ...reversal, journalId: e.target.value })}
            >
              <option value="">Select posted journal</option>
              {visibleData?.journals
                .filter((j) => !j.reversalOfJournalId)
                .map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.journalNumber} · {j.entryDate}
                  </option>
                ))}
            </select>
            <label className="text-xs">
              Reversal date in an open period
              <input
                className={inputClass}
                type="date"
                required
                value={reversal.entryDate}
                onChange={(e) => setReversal({ ...reversal, entryDate: e.target.value })}
              />
            </label>
            <input
              className={inputClass}
              aria-label="Reversal reason"
              placeholder="Reason"
              required
              value={reversal.reason}
              onChange={(e) => setReversal({ ...reversal, reason: e.target.value })}
            />
            <button className={buttonClass} disabled={busy}>
              Post reversal
            </button>
          </form>
        </div>
      )}
      {visibleData && (
        <section className="rounded-xl border border-hair bg-surface p-4">
          <h2 className="font-semibold text-ink">Financial periods</h2>
          <ul className="mt-2 space-y-2 text-xs">
            {visibleData.periods.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3">
                <span>
                  {p.periodCode} · {p.startDate}–{p.endDate} · {p.status}
                </span>
                {p.status === 'OPEN' && can('accounting.periods.close') && (
                  <button
                    className="btn-quiet"
                    disabled={busy || !closeNotes.trim()}
                    onClick={() =>
                      void run(
                        () =>
                          sprintApi.closePeriod(p.id, {
                            facilityId: currentFacility.id,
                            notes: closeNotes,
                          }),
                        'Period closed.',
                      )
                    }
                  >
                    Close
                  </button>
                )}
              </li>
            ))}
          </ul>
          {can('accounting.periods.close') && (
            <input
              className={`${inputClass} mt-3`}
              aria-label="Closing note"
              placeholder="Closing review note (required)"
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
            />
          )}
        </section>
      )}
    </div>
  );
};
