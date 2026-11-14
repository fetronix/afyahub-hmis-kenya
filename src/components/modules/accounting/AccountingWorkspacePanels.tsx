import React from 'react';
import type {
  AccountingOverview,
  SourceLedgerCoverage,
  BillingLedgerReview,
  sprintApi,
} from '../../../api/client-sprint.client.ts';
import type { PayrollTabId } from '../PayrollModule.tsx';
import type { AccountingSection, AccountingView } from './AccountingNavigation.tsx';

type Navigate = (section: AccountingSection, view?: AccountingView) => void;
const card = 'rounded-xl border border-hair bg-surface p-4';
const button =
  'rounded-lg border border-brand-200 bg-white px-3 py-2 text-left text-sm font-semibold text-brand-800 hover:bg-brand-50 disabled:opacity-50';
export function AccountingDashboard({
  data,
  coverage,
  journalReport,
  billingReport,
  onNavigate,
  billingAllowed,
}: {
  data: AccountingOverview | null;
  coverage: SourceLedgerCoverage | null;
  journalReport: Awaited<ReturnType<typeof sprintApi.billingJournalExceptions>> | null;
  billingReport: BillingLedgerReview | null;
  onNavigate: Navigate;
  billingAllowed: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {[
          [
            'Posted revenue',
            data ? `KES ${data.profitAndLoss.postedRevenueKes}` : 'Unavailable',
            'Selected reporting dates',
          ],
          [
            'Posted expenses',
            data ? `KES ${data.profitAndLoss.postedExpensesKes}` : 'Unavailable',
            'Recorded journals only',
          ],
          [
            'Trial balance',
            data ? (data.trialBalance.balanced ? 'Balanced' : 'Review difference') : 'Unavailable',
            data
              ? `Debit ${data.trialBalance.debitKes} · Credit ${data.trialBalance.creditKes}`
              : 'Load the overview to assess',
          ],
          [
            'Accounting periods',
            data ? `${data.periods.filter((p) => p.status === 'OPEN').length} open` : 'Unavailable',
            'All recorded facility periods',
          ],
        ].map(([label, value, detail]) => (
          <section key={label} className={card}>
            <h3 className="text-xs font-semibold text-muted">{label}</h3>
            <p className="mt-2 break-words text-xl font-bold text-ink">{value}</p>
            <p className="mt-2 text-xs text-muted">{detail}</p>
          </section>
        ))}
      </div>
      <section className={card}>
        <h3 className="font-semibold">Configuration & review priorities</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {!data ? (
            <li>
              Configuration could not yet be assessed. Load the accounting overview; missing data is
              not a zero balance.
            </li>
          ) : (
            <>
              {!data.accounts.length && (
                <li>No chart accounts returned. Review the facility chart before posting.</li>
              )}
              {!data.periods.some(
                (p) =>
                  p.status === 'OPEN' &&
                  p.startDate <= data.balanceSheet.asOf &&
                  p.endDate >= data.balanceSheet.asOf,
              ) && (
                <li>
                  No open accounting period covers the report end date. Review periods before
                  posting on that date.
                </li>
              )}
              {!data.trialBalance.balanced && (
                <li>Trial balance difference requires Accounting review.</li>
              )}
              <li>
                Payroll mapping and statutory readiness must be checked for the actual payroll
                period; this dashboard does not certify payroll readiness.
              </li>
            </>
          )}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={button} onClick={() => onNavigate('setup', 'chart')}>
            Review Chart of Accounts
          </button>
          <button className={button} onClick={() => onNavigate('setup', 'periods')}>
            Review Financial Periods
          </button>
          <button className={button} onClick={() => onNavigate('setup', 'mapping')}>
            Check payroll mappings
          </button>
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h3 className="font-semibold">Billing & ledger exceptions</h3>
          {billingAllowed ? (
            <>
              <dl className="my-3 space-y-2 text-sm">
                <div>
                  <dt>Source coverage</dt>
                  <dd>
                    {coverage
                      ? `${coverage.openExceptionCount} open exception(s) in the checked range`
                      : 'Not checked for these dates'}
                  </dd>
                </div>
                <div>
                  <dt>Billing exception review</dt>
                  <dd>
                    {billingReport
                      ? `${billingReport.pageSummary.requiringReview} requiring review on last examined page`
                      : 'Not checked for these dates'}
                  </dd>
                </div>
                <div>
                  <dt>Journal-side exceptions</dt>
                  <dd>
                    {journalReport
                      ? `${journalReport.pageSummary.requiringReview} requiring review on last examined page`
                      : 'Not checked for these dates'}
                  </dd>
                </div>
              </dl>
              <button className={button} onClick={() => onNavigate('billing')}>
                Open billing reconciliation
              </button>
            </>
          ) : (
            <p className="mt-3 text-sm">
              Billing review requires billing.read in addition to accounting.read.
            </p>
          )}
          <p className="mt-3 text-xs text-muted">
            Checks are run explicitly in Billing & Revenue Accounting. Page results are not a
            facility-wide exception count.
          </p>
        </section>
        <section className={card}>
          <h3 className="font-semibold">Outstanding payables</h3>
          <p className="my-3 text-sm">
            A verified unpaid-payables aggregate is not available. Expense payable posting does not
            record payment, and journal totals alone do not establish amounts still owed.
          </p>
          <button className={button} onClick={() => onNavigate('expenses')}>
            Review expenses & payables
          </button>
        </section>
      </div>
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
        {data?.limitations.notice ??
          'Figures are unavailable until the scoped accounting overview loads.'}{' '}
        Statements reflect posted journal entries only. Recorded receipts are not proof of bank or
        provider settlement.
      </p>
    </div>
  );
}

export function AccountingEntryPoints({
  view,
  payrollAllowed,
  bankAllowed,
  onOpenPayroll,
  onOpenBank,
  onNavigate,
}: {
  view: AccountingView;
  payrollAllowed: boolean;
  bankAllowed: boolean;
  onOpenPayroll?: (tab: PayrollTabId) => void;
  onOpenBank: () => void;
  onNavigate: Navigate;
}) {
  if (view === 'payables')
    return (
      <section className={`${card} space-y-3 text-sm`}>
        <h3 className="font-semibold">Outstanding payables — limitation</h3>
        <p>
          The existing expense workflow records approval and payable posting, not a verified unpaid
          balance, due-date ageing or payment processing. No outstanding amount is inferred from
          posted expenses.
        </p>
        <button className={button} onClick={() => onNavigate('expenses', 'expenses')}>
          Open expense review & approval
        </button>
        <p>
          Supporting documents are recorded references only; document upload and verification are
          not provided by this workflow.
        </p>
      </section>
    );
  if (view === 'banking')
    return (
      <section className={`${card} space-y-3 text-sm`}>
        <h3 className="font-semibold">Existing bank payments workspace</h3>
        <p>
          Facility receiving accounts, controlled manual-transfer evidence, statement import, match
          review and reconciliation worksheets are implemented in Bank Payments & Reconciliation.
          Reuse that workspace rather than creating a second transaction register.
        </p>
        <p className="rounded-lg bg-amber-50 p-3">
          No live bank collection, transfer or notification API is enabled. Sandbox authentication
          is not a live integration. Recorded receipts are not proof of bank or provider settlement.
        </p>
        <button className={button} disabled={!bankAllowed} onClick={onOpenBank}>
          Open Bank Payments & Reconciliation
        </button>
        {!bankAllowed && (
          <p>Requires an enabled Finance module and bank_payments.read for a facility account.</p>
        )}
      </section>
    );
  return (
    <section className={`${card} space-y-4`}>
      <h3 className="font-semibold">Payroll workspace entry points</h3>
      <p className="text-sm">
        These links open the existing Payroll module, not a second payroll implementation. Its
        chart, statutory policy, period, approval and posting gates remain enforced. Payroll posting
        records a liability journal, not salary payment.
      </p>
      {!payrollAllowed && (
        <p role="status">Requires an enabled Payroll module and payroll.read for this facility.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ['Employee payroll', 'staff', 'Review employee earnings and deductions.'],
          [
            'Payroll periods',
            'runs',
            'Review or create payroll periods with the appropriate permission.',
          ],
          ['Statutory rules', 'rules', 'Review effective-dated PAYE, NSSF, SHIF and AHL policies.'],
          [
            'Payroll account mappings',
            'accounts',
            'Select approved facility expense and liability accounts.',
          ],
          ['Payroll calculations', 'runs', 'Calculate only after readiness checks pass.'],
          ['Payslips', 'runs', 'Open a calculated run to review individual payslips.'],
          [
            'Payroll accounting postings',
            'runs',
            'Review approved/posted runs and their journal references.',
          ],
        ].map(([label, tab, description]) => (
          <button
            key={label}
            className={`${button} space-y-1 p-4`}
            disabled={!payrollAllowed || !onOpenPayroll}
            onClick={() => onOpenPayroll?.(tab as PayrollTabId)}
          >
            <span className="block">{label}</span>
            <span className="block text-xs font-normal text-muted">{description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
