import {
  ACCOUNTING_SECTIONS,
  AccountingNavigation,
  type AccountingSection,
  type AccountingView,
} from './accounting/AccountingNavigation.tsx';
import {
  AccountingDashboard,
  AccountingEntryPoints,
} from './accounting/AccountingWorkspacePanels.tsx';
import { PayrollReadinessPanel } from './payroll/PayrollReadiness.tsx';
import type { PayrollTabId } from './PayrollModule.tsx';
import { DataTable, PageHeader } from '../ui/layout.tsx';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BillingJournalPostingPanel } from './BillingJournalPostingPanel.tsx';
import { PaymentSettlementWork } from './PaymentSettlementWork.tsx';
import { ExpenseApprovalPanel } from './ExpenseApprovalPanel.tsx';
import { getSessionToken } from '../../api/client.ts';
import {
  sprintApi,
  type AccountingOverview,
  type BillingGlReconciliation,
  type BillingLedgerReview,
  type SourceLedgerCoverage,
} from '../../api/client-sprint.client.ts';
import { useHmis } from '../../context/HmisContext.tsx';

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const buttonClass =
  'rounded-lg bg-brand-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50';
const today = () => new Date().toISOString().slice(0, 10);

const ignoreReadiness = () => {};
export const AccountingModule: React.FC<{ onOpenPayroll?: (tab: PayrollTabId) => void }> = ({
  onOpenPayroll,
}) => {
  const { currentFacility, authenticatedUser, showToast, setActiveModule } = useHmis();
  const [section, setSection] = useState<AccountingSection>('dashboard');
  const [view, setView] = useState<AccountingView>('dashboard');
  const navigate = (next: AccountingSection, nextView?: AccountingView) => {
    setSection(next);
    setView(nextView ?? ACCOUNTING_SECTIONS.find((item) => item.id === next)!.views[0].id);
  };
  const activeSection = ACCOUNTING_SECTIONS.find((item) => item.id === section)!;
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
  const [glReport, setGlReport] = useState<BillingGlReconciliation | null>(null);
  const [glReportError, setGlReportError] = useState('');
  const [glErrorScope, setGlErrorScope] = useState('');
  const [glReportScope, setGlReportScope] = useState('');
  const visibleGlReport = glReportScope === currentScope ? glReport : null;
  const [coverage, setCoverage] = useState<SourceLedgerCoverage | null>(null);
  const [coverageError, setCoverageError] = useState('');
  const [coverageErrorScope, setCoverageErrorScope] = useState('');
  const [coverageScope, setCoverageScope] = useState('');
  const visibleCoverage = coverageScope === currentScope ? coverage : null;
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
    if (
      !facilityId ||
      !end ||
      !authenticatedUser?.permissions?.includes('accounting.read') ||
      authenticatedUser?.isSuperAdmin ||
      authenticatedUser?.roles?.includes('SUPER_ADMIN')
    )
      return;
    const requestedScope = `${facilityId}:${start}:${end}`;
    try {
      setError('');
      const overview = await sprintApi.accountingOverview(facilityId, start, end);
      if (scopeRef.current !== requestedScope) return;
      setData(overview);
      setDataScope(requestedScope);
    } catch (e: unknown) {
      if (scopeRef.current === requestedScope) {
        setData(null);
        setError(e instanceof Error ? e.message : 'Could not load accounting.');
      }
    }
  }, [facilityId, start, end, authenticatedUser]);
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
  const loadGlTieOut = async () => {
    if (!currentFacility) return;
    const requestedScope = `${currentFacility.id}:${start}:${end}`;
    try {
      setGlReportError('');
      setGlErrorScope(requestedScope);
      const report = await sprintApi.billingGlReconciliation(currentFacility.id, end);
      if (scopeRef.current === requestedScope) {
        setGlReport(report);
        setGlReportScope(requestedScope);
      }
    } catch (error: unknown) {
      if (scopeRef.current === requestedScope)
        setGlReportError(
          error instanceof Error ? error.message : 'Billing to ledger tie-out failed.',
        );
    }
  };
  const loadSourceCoverage = async () => {
    if (!currentFacility) return;
    const requestedScope = `${currentFacility.id}:${start}:${end}`;
    try {
      setCoverageError('');
      setCoverageErrorScope(requestedScope);
      const report = await sprintApi.sourceLedgerCoverage(currentFacility.id, start, end);
      if (scopeRef.current === requestedScope) {
        setCoverage(report);
        setCoverageScope(requestedScope);
      }
    } catch (error: unknown) {
      if (scopeRef.current === requestedScope)
        setCoverageError(
          error instanceof Error ? error.message : 'Source-to-ledger coverage review failed.',
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
  if (
    !can('accounting.read') ||
    authenticatedUser?.isSuperAdmin ||
    authenticatedUser?.roles?.includes('SUPER_ADMIN')
  )
    return (
      <p>Accounting requires an authorized facility account with accounting read permission.</p>
    );
  const payrollAllowed = Boolean(
    currentFacility.enabledModules?.includes('payroll') &&
    !currentFacility.hiddenModules?.includes('payroll') &&
    can('payroll.read'),
  );
  return (
    <div className="space-y-5">
      <PageHeader>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">
            Facility finance
          </p>
          <h1 className="ui-page-title">Accounting &amp; Finance</h1>
          <p className="ui-page-description">
            {currentFacility.name} · Posted journals, controlled workflows and transparent financial
            reporting.
          </p>
        </div>
      </PageHeader>
      <div className="grid items-start gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
        <AccountingNavigation
          section={section}
          onNavigate={navigate}
          billingAllowed={can('billing.read')}
        />
        <div className="min-w-0 space-y-4">
          <header>
            <h2 className="text-xl font-bold text-ink">{activeSection.title}</h2>
            <p className="mt-1 text-sm text-muted">{activeSection.description}</p>
          </header>
          {activeSection.views.length > 1 && (
            <nav aria-label={`${activeSection.title} views`} className="flex flex-wrap gap-2">
              {activeSection.views.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={view === item.id ? 'page' : undefined}
                  className={
                    view === item.id
                      ? buttonClass
                      : 'rounded-lg border border-hair bg-white px-3 py-2 text-xs font-medium text-ink hover:bg-slate-100'
                  }
                  onClick={() => setView(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          )}
          <section
            aria-label="Accounting reporting dates"
            className="rounded-xl border border-hair bg-surface p-4 space-y-3"
          >
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
              {view === 'trial' && can('accounting.reports.export') && (
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
            {!visibleData && !error && (
              <p role="status" className="text-sm">
                Loading posted accounting overview…
              </p>
            )}
          </section>

          {view === 'dashboard' && (
            <AccountingDashboard
              data={visibleData}
              coverage={visibleCoverage}
              journalReport={visibleJournalReport}
              billingReport={visibleBillingReport}
              onNavigate={navigate}
              billingAllowed={can('billing.read')}
            />
          )}
          {view === 'chart' && (
            <section className="space-y-3 rounded-xl border border-hair bg-surface p-4">
              <h3 className="font-semibold">Chart of Accounts</h3>
              <p className="text-xs text-muted">
                Existing facility chart. Account codes are facility-defined. Editing and
                activation/deactivation are not exposed by the current accounting API; request
                controlled Accounting administration rather than changing posted history.
              </p>
              {visibleData && (
                <>
                  <p className="text-sm">
                    {visibleData.accounts.length} account(s) returned by the ledger overview.
                  </p>
                  <div className="overflow-x-auto">
                    <DataTable className="w-full text-left text-xs">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Account name</th>
                          <th>Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleData.accounts.map((a) => (
                          <tr key={a.accountId}>
                            <td>{a.accountCode}</td>
                            <td>{a.accountName}</td>
                            <td>{a.accountType}</td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  </div>
                  {!visibleData.accounts.length && (
                    <p>
                      No accounts returned. Ask the facility Accounting administrator to review the
                      chart or create approved accounts below.
                    </p>
                  )}
                </>
              )}
              {!can('accounting.coa.manage') && (
                <p className="text-xs">Account creation requires accounting.coa.manage.</p>
              )}
            </section>
          )}
          {view === 'mapping' &&
            (payrollAllowed ? (
              <>
                <PayrollReadinessPanel
                  facilityId={currentFacility.id}
                  periods={[]}
                  periodId={null}
                  onPeriodChange={ignoreReadiness}
                  refreshKey={currentScope}
                  onResult={ignoreReadiness}
                />
                <p className="text-sm">
                  This is a today-only configuration preview. Open Payroll to choose a real payroll
                  period and save administrator-approved mappings.
                </p>
                <button
                  className={buttonClass}
                  onClick={() => onOpenPayroll?.('accounts')}
                  disabled={!onOpenPayroll}
                >
                  Open payroll account mappings
                </button>
              </>
            ) : (
              <p className="rounded-xl border border-hair bg-surface p-4">
                Payroll mapping checks require an enabled Payroll module and payroll.read permission
                for this facility.
              </p>
            ))}
          {['journals', 'reversal', 'billingPosting'].includes(view) &&
            !can('accounting.journals.post') && (
              <p className="rounded-lg border border-hair bg-surface p-3 text-sm">
                Journal posting and reversal controls require accounting.journals.post. Existing
                posted journals remain read-only.
              </p>
            )}
          {view === 'periods' && !can('accounting.coa.manage') && (
            <p className="text-sm">
              Opening a financial period requires accounting.coa.manage. Contact your facility
              Accounting administrator.
            </p>
          )}
          {view === 'configuration' && (
            <section className="space-y-3 rounded-xl border border-hair bg-surface p-4 text-sm">
              <h3 className="font-semibold">Accounting configuration</h3>
              <p>
                Configuration is managed through the existing chart, financial periods and payroll
                mapping controls. There is no separate general configuration editor.
              </p>
              <button className={buttonClass} onClick={() => navigate('setup', 'chart')}>
                Review chart accounts
              </button>
              <p>
                Manual journal posting requires an open accounting period and balanced entries.
                Existing authorization, audit history and duplicate prevention remain enforced by
                the server.
              </p>
              <p>
                No automatic billing posting, bank-provider verification or production payroll
                certification is implied.
              </p>
            </section>
          )}
          {['payroll', 'banking', 'payables'].includes(view) && (
            <AccountingEntryPoints
              view={view}
              payrollAllowed={payrollAllowed}
              bankAllowed={Boolean(
                !authenticatedUser?.roles?.includes('SUPER_ADMIN') &&
                currentFacility.enabledModules?.includes('finance') &&
                !currentFacility.hiddenModules?.includes('finance') &&
                can('bank_payments.read'),
              )}
              onOpenPayroll={onOpenPayroll}
              onOpenBank={() => setActiveModule('payment_transactions')}
              onNavigate={navigate}
            />
          )}
          {view === 'journals' && visibleData && (
            <section className="space-y-3 rounded-xl border border-hair bg-surface p-4">
              <h3 className="font-semibold">Posted journal entries</h3>
              <p className="text-xs text-muted">
                Most recent 100 posted journals in the selected date range. This is not an
                exhaustive journal register or a draft review queue.
              </p>
              {!visibleData.journals.length ? (
                <p>No posted journals returned for these dates.</p>
              ) : (
                <div className="overflow-x-auto">
                  <DataTable className="w-full text-left text-xs">
                    <thead>
                      <tr>
                        <th>Journal</th>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleData.journals.map((j) => (
                        <tr key={j.id}>
                          <td>
                            {j.journalNumber}
                            {j.reversalOfJournalId
                              ? ` · reversal of #${j.reversalOfJournalId}`
                              : ''}
                          </td>
                          <td>{j.entryDate}</td>
                          <td>{j.description}</td>
                          <td>{j.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                </div>
              )}
            </section>
          )}
          {view === 'postings' && (
            <p className="text-sm">
              Account-level posted debit/credit movements for the selected range. Individual
              journal-line drill-down is not available in this interface.
            </p>
          )}
          {['trial', 'income', 'balance'].includes(view) && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
              Posted journal entries only — unposted billing sources, unrecorded expenses and
              unverified allocations are not included. A balanced statement is not proof of
              reconciliation.
            </p>
          )}
          {view === 'exceptions' && can('accounting.read') && can('billing.read') && (
            <section className="rounded-xl border border-hair bg-surface p-4 space-y-2 text-xs">
              <h2 className="font-semibold">Billing and ledger exception review</h2>
              <p>
                Checks current invoice lines, receipts, refunds, voids and source-linked journals
                for invoices created in the selected date range. This is a partial exception review,
                not a full general-ledger, bank or payer reconciliation.
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
                    <DataTable className="w-full text-left">
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
                    </DataTable>
                  </div>
                  <h3 className="font-semibold">Source-linked journal checks</h3>
                  <p>
                    Examined {visibleBillingReport.ledgerPageSummary.examined} source events;{' '}
                    {visibleBillingReport.ledgerPageSummary.unposted} have no linked journal. An
                    amount match does not verify accounting classification.
                  </p>
                  <div className="overflow-x-auto">
                    <DataTable className="w-full text-left">
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
                              {event.issues.join(', ') ||
                                'Amount match only — account review required'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
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
          {view === 'coverage' && can('accounting.read') && can('billing.read') && (
            <section className="rounded-xl border border-hair bg-surface p-4 space-y-2 text-xs">
              <h2 className="font-semibold">Source-to-ledger coverage</h2>
              <p>
                Selects finalized invoices, receipts and refunds by their own activity date, then
                shows which of them has no active reviewed journal. A receipt taken today against an
                old invoice therefore appears in this period, not only in the period the invoice was
                created. Nothing is posted or corrected here, and a posted state does not prove cash
                movement or correct account classification.
              </p>
              <button className={buttonClass} onClick={() => void loadSourceCoverage()}>
                Check coverage
              </button>
              {coverageErrorScope === currentScope && coverageError && (
                <p role="alert" className="text-red-700">
                  {coverageError}
                </p>
              )}
              {visibleCoverage && (
                <>
                  <p>
                    {visibleCoverage.coverage === 'COMPLETE'
                      ? 'Every source in this range has an active reviewed journal.'
                      : `${visibleCoverage.openExceptionCount} source(s) are unposted or reversed and need finance review.`}
                  </p>
                  <div className="overflow-x-auto">
                    <DataTable className="w-full text-left">
                      <thead>
                        <tr>
                          <th>Source</th>
                          <th>Examined</th>
                          <th>Posted</th>
                          <th>Unposted</th>
                          <th>Reversed</th>
                          <th>Amount (KES)</th>
                          <th>Unposted (KES)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(['invoices', 'receipts', 'refunds'] as const).map((family) => {
                          const row = visibleCoverage.sources[family];
                          return (
                            <tr key={family}>
                              <td className="capitalize">{family}</td>
                              <td>{row.examined}</td>
                              <td>{row.posted}</td>
                              <td>{row.unposted}</td>
                              <td>{row.reversed}</td>
                              <td>{row.amount}</td>
                              <td>{row.unpostedAmount}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </DataTable>
                  </div>
                  {visibleCoverage.exceptions.length > 0 && (
                    <div className="overflow-x-auto">
                      <DataTable className="w-full text-left">
                        <thead>
                          <tr>
                            <th>Source</th>
                            <th>Reference</th>
                            <th>Date</th>
                            <th>Amount (KES)</th>
                            <th>Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleCoverage.exceptions.map((row) => (
                            <tr key={`${row.sourceType}:${row.sourceId}`}>
                              <td>{row.sourceType.replace('BILLING_', '')}</td>
                              <td>{row.reference}</td>
                              <td>{row.sourceDate}</td>
                              <td>{row.amount}</td>
                              <td>{row.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </DataTable>
                    </div>
                  )}
                  {visibleCoverage.exceptionsTruncated && (
                    <p>
                      Showing the first {visibleCoverage.exceptions.length} of{' '}
                      {visibleCoverage.openExceptionCount} exceptions.
                    </p>
                  )}
                  <p>{visibleCoverage.limitations.notice}</p>
                </>
              )}
            </section>
          )}
          {view === 'tieout' && can('accounting.read') && can('billing.read') && (
            <section className="rounded-xl border border-hair bg-surface p-4 space-y-2 text-xs">
              <h2 className="font-semibold">Billing subledger to general ledger tie-out</h2>
              <p>
                Compares posted journals with the reviewed billing bridge and with what patients and
                insurers actually owe as of the end date. Every difference is shown with amounts;
                none is netted away.
              </p>
              <button className={buttonClass} onClick={() => void loadGlTieOut()}>
                Tie out as of end date
              </button>
              {glErrorScope === currentScope && glReportError && (
                <p role="alert" className="text-red-700">
                  {glReportError}
                </p>
              )}
              {visibleGlReport && (
                <>
                  <p>
                    As of {visibleGlReport.asOf}: {visibleGlReport.summary.controlsTied} control(s)
                    tied, {visibleGlReport.summary.controlsWithBacklog} with explained posting
                    backlog, {visibleGlReport.summary.controlsUnexplained} unexplained.{' '}
                    {visibleGlReport.summary.reconciled
                      ? 'No unexplained difference was found.'
                      : 'Finance review is required before the statements are relied on.'}
                  </p>
                  <div className="overflow-x-auto">
                    <DataTable className="w-full text-left">
                      <thead>
                        <tr>
                          <th>Control</th>
                          <th>Ledger</th>
                          <th>Billing subledger</th>
                          <th>Difference</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleGlReport.tieOut.map((row) => (
                          <tr key={row.control}>
                            <td>{row.control.replace(/_/g, ' ')}</td>
                            <td>{row.ledgerKes}</td>
                            <td>{row.subledgerKes}</td>
                            <td>{row.subledgerDifferenceKes}</td>
                            <td>{row.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  </div>
                  <p>
                    Unposted invoices {visibleGlReport.exceptions.unpostedInvoiceKes}; unposted
                    receipts {visibleGlReport.exceptions.unpostedReceiptKes}; journals outside the
                    bridge {visibleGlReport.exceptions.unexplainedJournalCount}.
                  </p>
                  <p>{visibleGlReport.limitations.notice}</p>
                </>
              )}
            </section>
          )}
          {view === 'journalExceptions' && can('accounting.read') && can('billing.read') && (
            <section className="rounded-xl border border-hair bg-surface p-4 space-y-2 text-xs">
              <h2 className="font-semibold">Journal-side billing exceptions</h2>
              <p>
                Checks known source-linked journals by journal date, separately from the
                invoice-date review.
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
                      onClick={() =>
                        void loadJournalReport(visibleJournalReport.nextAfterJournalId!)
                      }
                    >
                      Next journal page
                    </button>
                  )}
                  <p>{visibleJournalReport.limitations}</p>
                </>
              )}
            </section>
          )}
          {view === 'expenses' &&
            authenticatedUser &&
            !authenticatedUser.isSuperAdmin &&
            can('accounting.read') && (
              <ExpenseApprovalPanel
                key={`${currentFacility.id}:${authenticatedUser.id}`}
                facilityId={currentFacility.id}
                userId={authenticatedUser.id}
                canApproveAndPost={
                  can('accounting.expenses.approve') && can('accounting.journals.post')
                }
                onPosted={() => void load()}
              />
            )}
          {view === 'settlements' &&
            authenticatedUser &&
            !authenticatedUser.isSuperAdmin &&
            can('accounting.read') &&
            can('billing.read') && (
              <PaymentSettlementWork
                key={`${currentFacility.id}:${authenticatedUser.id}`}
                facilityId={currentFacility.id}
                canPost={can('accounting.journals.post')}
                onPosted={() => void load()}
              />
            )}
          {view === 'billingPosting' &&
            authenticatedUser &&
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
          {visibleData && ['trial', 'income', 'balance', 'postings'].includes(view) && (
            <>
              <div className="grid gap-3 sm:grid-cols-3 text-xs">
                {view === 'trial' && (
                  <div className="rounded-lg bg-slate-50 p-3">
                    <strong>Trial balance</strong>
                    <p>
                      Debits KES {visibleData.trialBalance.debitKes} · Credits KES{' '}
                      {visibleData.trialBalance.creditKes}
                    </p>
                    <p>
                      {visibleData.trialBalance.balanced
                        ? 'Balanced'
                        : 'Difference requires review'}
                    </p>
                  </div>
                )}
                {view === 'income' && (
                  <div className="rounded-lg bg-slate-50 p-3">
                    <strong>Posted income statement</strong>
                    <p>Revenue KES {visibleData.profitAndLoss.postedRevenueKes}</p>
                    <p>Expenses KES {visibleData.profitAndLoss.postedExpensesKes}</p>
                    <p>Ledger result KES {visibleData.profitAndLoss.ledgerResultKes}</p>
                  </div>
                )}
                {view === 'balance' && (
                  <div className="rounded-lg bg-slate-50 p-3">
                    <strong>Balance sheet as of {visibleData.balanceSheet.asOf}</strong>
                    <p>Assets KES {visibleData.balanceSheet.assetsKes}</p>
                    <p>
                      Liabilities + equity KES {visibleData.balanceSheet.liabilitiesKes} +{' '}
                      {visibleData.balanceSheet.equityIncludingAccumulatedResultKes}
                    </p>
                    <p>
                      {visibleData.balanceSheet.balanced
                        ? 'Balanced'
                        : 'Difference requires review'}
                    </p>
                  </div>
                )}
              </div>
              <p className="text-xs text-amber-800">
                {visibleData.limitations.notice} Service-line profitability is unavailable until
                costs and allocations are verified.
              </p>
              {['trial', 'postings'].includes(view) && (
                <div className="overflow-x-auto">
                  <DataTable className="w-full text-left text-xs">
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
                  </DataTable>
                </div>
              )}
            </>
          )}

          {can('accounting.coa.manage') && (
            <div className="grid gap-4 lg:grid-cols-2">
              {view === 'chart' && (
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
              )}
              {view === 'periods' && (
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
              )}
            </div>
          )}
          {can('accounting.journals.post') && (
            <div className="grid gap-4 lg:grid-cols-2">
              {view === 'journals' && (
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
                                {
                                  accountId: Number(journal.debitAccount),
                                  debitKes: journal.amountKes,
                                },
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
              )}
              {view === 'reversal' && (
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
              )}
            </div>
          )}
          {view === 'periods' && visibleData && (
            <section className="rounded-xl border border-hair bg-surface p-4">
              <h2 className="font-semibold text-ink">Financial periods</h2>
              <p className="text-xs text-muted">
                {visibleData.periods.length} recorded period(s). Closing requires an authorized
                review note.
              </p>
              {!visibleData.periods.length && (
                <p>No financial periods recorded. Ask Accounting to open an approved period.</p>
              )}
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
      </div>
    </div>
  );
};
