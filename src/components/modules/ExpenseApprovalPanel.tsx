import React, { useEffect, useState } from 'react';
import { sprintApi, type ExpenseReviewPage } from '../../api/client-sprint.client.ts';

/** An independently reviewed payable journal, not an external or manual payment. */
export const ExpenseApprovalPanel: React.FC<{
  facilityId: number;
  userId: number;
  canApproveAndPost: boolean;
  onPosted: () => void;
}> = ({ facilityId, userId, canApproveAndPost, onPosted }) => {
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [afterId, setAfterId] = useState(0);
  const [result, setResult] = useState('');
  const [version, setVersion] = useState(0);
  const requestKey = JSON.stringify([facilityId, appliedSearch, afterId, version]);
  const [loaded, setLoaded] = useState<{
    key: string;
    page: ExpenseReviewPage | null;
    error: string;
  } | null>(null);
  // A response from another search, page, refresh or facility is not current.
  const current = loaded?.key === requestKey ? loaded : null;
  const page = current?.page ?? null;
  const loadError = current?.error ?? '';
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    sprintApi
      .expenseReviewPage(facilityId, appliedSearch, afterId)
      .then((data) => {
        if (
          !data ||
          !Array.isArray(data.expenses) ||
          typeof data.notice !== 'string' ||
          (data.nextAfterId !== null &&
            (!Number.isSafeInteger(data.nextAfterId) || data.nextAfterId <= 0))
        )
          throw new Error('Invalid expense review page');
        if (active) setLoaded({ key: requestKey, page: data, error: '' });
      })
      .catch(() => {
        if (active)
          setLoaded({
            key: requestKey,
            page: null,
            error: 'Expense review could not be loaded. Do not assume no requests exist.',
          });
      });
    return () => {
      active = false;
    };
  }, [facilityId, appliedSearch, afterId, requestKey]);

  const selected = page?.expenses.find((expense) => expense.id === selectedId) ?? null;
  const canSubmit = Boolean(
    selected &&
    selected.status === 'SUBMITTED' &&
    selected.accountingStatus === 'NOT_POSTED' &&
    selected.reviewHash &&
    selected.requestedByUserId !== null &&
    selected.requestedByUserId !== userId &&
    canApproveAndPost,
  );
  const submit = async () => {
    if (!selected || !selected.reviewHash || !canSubmit || !confirmed || !notes.trim() || busy)
      return;
    setBusy(true);
    setResult('');
    try {
      const response = await sprintApi.approveAndPostExpense(selected.id, {
        facilityId,
        reviewHash: selected.reviewHash,
        notes: notes.trim(),
      });
      if (
        response.expenseId !== selected.id ||
        response.status !== 'POSTED' ||
        !Number.isSafeInteger(response.journalId) ||
        response.journalId <= 0 ||
        typeof response.idempotentReplay !== 'boolean' ||
        response.paymentRecorded !== false
      )
        throw new Error('The approval response is inconsistent.');
      setResult(
        `${response.idempotentReplay ? 'Previous approval retrieved' : 'Expense approved and payable journal posted'}: journal #${response.journalId}. No payment was recorded.`,
      );
      setSelectedId(null);
      setNotes('');
      setConfirmed(false);
      setVersion((current) => current + 1);
      onPosted();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approval could not be confirmed.';
      setResult(
        `${message} If the response was lost, inspect the recorded expense and journal before retrying.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="rounded-xl border border-hair bg-surface p-4 space-y-3 text-sm"
      aria-label="Expense approval and posting"
    >
      <h2 className="font-semibold">Expense review &amp; payable posting</h2>
      <p className="text-xs text-slate-600">
        A different authorized reviewer may approve the displayed account choices and post the
        payable journal in one transaction. This does not record or initiate payment. Supporting
        documents are references only and are not verified by the system.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSelectedId(null);
          setAfterId(0);
          setAppliedSearch(search.trim());
          if (appliedSearch === search.trim() && afterId === 0)
            setVersion((current) => current + 1);
        }}
      >
        <label className="text-xs">
          Search expense number, ID or payee
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={80}
            className="block rounded border p-2"
          />
        </label>
        <button type="submit" className="rounded border px-3 py-2">
          Search
        </button>
        <button
          type="button"
          className="rounded border px-3 py-2"
          onClick={() => {
            setSelectedId(null);
            setVersion((current) => current + 1);
          }}
        >
          Refresh
        </button>
      </form>
      {result && <p role="status">{result}</p>}
      {loadError ? (
        <p role="alert">{loadError}</p>
      ) : !page ? (
        <p role="status">Loading expense review…</p>
      ) : (
        <>
          <p className="text-xs">{page.notice}</p>
          {page.expenses.length === 0 ? (
            <p>No expense requests found on this page.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Payee</th>
                    <th>Amount</th>
                    <th>Source</th>
                    <th>Accounting</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {page.expenses.map((expense) => (
                    <tr key={expense.id}>
                      <td>{expense.requestNumber}</td>
                      <td>{expense.payeeName}</td>
                      <td>
                        {expense.currency === 'KES'
                          ? `KES ${expense.amountKes}`
                          : `Currency ${expense.currency || 'unknown'}; KES amount field ${expense.amountKes}`}
                      </td>
                      <td>{expense.status}</td>
                      <td>
                        {expense.accountingStatus}
                        {expense.reversalJournalId
                          ? ` · reversal #${expense.reversalJournalId}`
                          : ''}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            setSelectedId(expense.id);
                            setNotes('');
                            setConfirmed(false);
                            setResult('');
                          }}
                        >
                          Review {expense.requestNumber}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-2">
            {afterId > 0 && (
              <button
                type="button"
                className="rounded border px-2 py-1"
                onClick={() => {
                  setSelectedId(null);
                  setAfterId(0);
                }}
              >
                First page
              </button>
            )}
            {page.nextAfterId !== null && (
              <button
                type="button"
                className="rounded border px-2 py-1"
                onClick={() => {
                  setSelectedId(null);
                  setAfterId(page.nextAfterId!);
                }}
              >
                Next page
              </button>
            )}
          </div>
        </>
      )}
      {selected && (
        <div
          className="space-y-2 rounded border border-slate-300 p-3"
          aria-label="Selected expense review"
        >
          <h3 className="font-semibold">Review {selected.requestNumber}</h3>
          <p>
            {selected.incurredDate} · {selected.payeeName} · {selected.category} · Currency:{' '}
            {selected.currency || 'unknown'} · KES amount field: {selected.amountKes}
          </p>
          <p>{selected.description}</p>
          {selected.serviceLine && <p>Service line: {selected.serviceLine}</p>}
          <p>
            Expense account: {selected.expenseAccount.code ?? 'Unknown'} —{' '}
            {selected.expenseAccount.name ?? 'Unknown'}
          </p>
          <p>
            Payable account: {selected.payableAccount.code ?? 'Unknown'} —{' '}
            {selected.payableAccount.name ?? 'Unknown'}
          </p>
          <p>
            Requesting user #{selected.requestedByUserId ?? 'unknown'}; accounting status:{' '}
            {selected.accountingStatus}.
          </p>
          <p>Document references (not verified):</p>
          {!Array.isArray(selected.supportingDocuments) ? (
            <p>Document references are unavailable or invalid; manual review is required.</p>
          ) : selected.supportingDocuments.length ? (
            <ul>
              {selected.supportingDocuments.map((doc, index) => (
                <li key={index}>
                  {doc && typeof doc.name === 'string' && typeof doc.storageReference === 'string'
                    ? `${doc.name} — ${doc.storageReference}`
                    : 'Document reference is invalid; manual review is required.'}
                </li>
              ))}
            </ul>
          ) : (
            <p>None recorded.</p>
          )}
          {selected.reviewIssue && (
            <p role="alert">
              Expense or account evidence needs financial review: {selected.reviewIssue}.
            </p>
          )}
          {selected.requestedByUserId === userId && <p>You cannot approve your own expense.</p>}
          {!canApproveAndPost && (
            <p>
              Both expense approval and journal posting permissions are required for this action.
            </p>
          )}
          {canSubmit && (
            <>
              <label className="block">
                Review notes
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  maxLength={1000}
                  className="block w-full rounded border p-2"
                />
              </label>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I reviewed this request and these facility account choices. Posting will create a
                payable, not a payment.
              </label>
              <button
                type="button"
                className="rounded bg-brand-700 px-3 py-2 text-white disabled:opacity-50"
                disabled={busy || !confirmed || !notes.trim()}
                onClick={() => void submit()}
              >
                {busy ? 'Approving…' : 'Approve and post payable'}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
};
