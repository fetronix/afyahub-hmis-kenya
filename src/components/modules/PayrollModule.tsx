import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeDollarSign,
  CalendarPlus,
  CheckCircle2,
  FileText,
  Landmark,
  Printer,
  RefreshCw,
  Scale,
  Send,
  ShieldCheck,
  Plus,
  Trash2,
} from 'lucide-react';

import { api, ApiError, fetchJson, API_BASE } from '../../api/client.ts';
import type {
  PayrollAccountSettings,
  PayrollBand,
  PayrollPeriod,
  PayrollPayslipDetail,
  PayrollPayslipRow,
  PayrollRunDetail,
  PayrollStatutoryVersion,
} from '../../api/clients/workforce.client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { PrimaryButton, SecondaryButton, Tabs } from '../ui/controls.tsx';
import {
  AlertBanner,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatusBadge,
} from '../ui/feedback.tsx';
import { Modal } from '../ui/overlays.tsx';
import { DataTable, FilterToolbar, PageHeader, StatCard } from '../ui/layout.tsx';
import { formatCents } from '../../billing/settlement.ts';

const kes = (value: unknown): string => {
  const cents = Number(value ?? 0);
  return Number.isFinite(cents) ? formatCents(cents) : '0.00';
};

const today = () => new Date().toISOString().slice(0, 10);
const monthRange = () => {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    name: first.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    startDate: first.toISOString().slice(0, 10),
    endDate: last.toISOString().slice(0, 10),
    payDate: last.toISOString().slice(0, 10),
  };
};

type RunStatus = 'DRAFT' | 'CALCULATED' | 'APPROVED' | 'POSTED' | string;

function RunBadge({ status }: { status: RunStatus }) {
  const tone =
    status === 'POSTED'
      ? 'success'
      : status === 'APPROVED'
        ? 'info'
        : status === 'CALCULATED'
          ? 'warning'
          : 'neutral';
  return <StatusBadge tone={tone}>{status.replace(/_/g, ' ')}</StatusBadge>;
}

type Account = {
  id: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  normalBalance: string;
};

type TabId = 'runs' | 'rules' | 'accounts';

export const PayrollModule: React.FC = () => {
  const { authenticatedUser, currentFacility, showToast, refreshKey, triggerRefresh } = useHmis();
  const facilityId = currentFacility?.id ?? 0;
  const permissions = authenticatedUser?.permissions ?? [];
  const canManage = permissions.includes('payroll.manage');
  const canApprove = permissions.includes('payroll.approve');
  const canPost = permissions.includes('payroll.post');
  const canManageRules = permissions.includes('payroll.statutory.manage');

  const [tab, setTab] = useState<TabId>('runs');
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [versions, setVersions] = useState<PayrollStatutoryVersion[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<PayrollAccountSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const [periodModal, setPeriodModal] = useState(false);
  const [ruleModal, setRuleModal] = useState(false);
  const [runDetail, setRunDetail] = useState<PayrollRunDetail | null>(null);
  const [payslip, setPayslip] = useState<PayrollPayslipDetail | null>(null);
  const [calcResult, setCalcResult] = useState<{
    employeeCount: number;
    versions: Record<string, { label: string; effectiveFrom: string; authority: string }>;
  } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [periodRows, versionRows, accountRows, settingsRow] = await Promise.all([
        api.getPayrollPeriods(facilityId),
        api.getPayrollStatutoryVersions(facilityId),
        fetchJson<Account[]>(`${API_BASE}/payroll/accounts?facilityId=${facilityId}`),
        api.getPayrollAccountSettings(facilityId),
      ]);
      setPeriods(periodRows);
      setVersions(versionRows);
      setAccounts(accountRows);
      setSettings(settingsRow);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Payroll records could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const activeVersions = useMemo(
    () => versions.filter((version) => version.status === 'ACTIVE'),
    [versions],
  );
  const coverage = useMemo(() => {
    const statutes = ['PAYE', 'NSSF', 'SHIF', 'AHL'];
    return statutes.map((statute) => ({
      statute,
      version: activeVersions.find((version) => version.statute === statute) ?? null,
    }));
  }, [activeVersions]);
  const missingStatutes = coverage.filter((entry) => !entry.version);

  async function run(action: () => Promise<void>) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await action();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'The action could not be completed.', {
        tone: 'error',
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function openRun(runId: number) {
    try {
      setRunDetail(await api.getPayrollRun(facilityId, runId));
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Payroll run could not be loaded.', {
        tone: 'error',
      });
    }
  }

  async function openPayslip(payslipId: number) {
    try {
      setPayslip(await api.getPayrollPayslip(facilityId, payslipId));
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Payslip could not be loaded.', {
        tone: 'error',
      });
    }
  }

  if (loading) return <LoadingSkeleton />;
  if (error && periods.length === 0)
    return <ErrorState message={error} onRetry={() => void load()} />;

  const totalNet = periods
    .filter((period) => period.run && period.run.status !== 'DRAFT')
    .reduce((sum, period) => sum + Number(period.run?.netCents ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader>
        <div>
          <h1 className="text-xl font-semibold text-ink">Payroll</h1>
          <p className="mt-1 text-sm text-muted">
            Effective-dated statutory rules, payroll runs, approval and ledger posting for{' '}
            {currentFacility?.name ?? 'this facility'}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <PrimaryButton onClick={() => setPeriodModal(true)}>
              <CalendarPlus size={16} /> New period
            </PrimaryButton>
          )}
          <SecondaryButton onClick={() => void load()}>
            <RefreshCw size={16} /> Refresh
          </SecondaryButton>
        </div>
      </PageHeader>

      {error && <AlertBanner tone="warning">{error}</AlertBanner>}

      {missingStatutes.length > 0 && (
        <AlertBanner tone="warning">
          <strong>Payroll cannot be calculated yet.</strong> No active rule version covers{' '}
          {missingStatutes.map((entry) => entry.statute).join(', ')}. Record the authority&apos;s
          published figures with their effective dates and source in <em>Statutory rules</em>.
          JaliCare ships no Kenyan rates of its own and will refuse to guess.
        </AlertBanner>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Rule coverage"
          value={`${4 - missingStatutes.length}/4`}
          detail={
            missingStatutes.length
              ? 'Statutes without an active version'
              : 'All four statutes covered'
          }
          icon={<Scale size={18} />}
        />
        <StatCard
          label="Periods"
          value={periods.length}
          detail="Created payroll periods"
          icon={<FileText size={18} />}
        />
        <StatCard
          label="Runs awaiting approval"
          value={periods.filter((period) => period.run?.status === 'CALCULATED').length}
          detail="Calculated, not yet approved"
          icon={<ShieldCheck size={18} />}
        />
        <StatCard
          label="Net pay calculated"
          value={`KES ${formatCents(totalNet)}`}
          detail="Across calculated, approved and posted runs"
          icon={<BadgeDollarSign size={18} />}
        />
      </div>

      <Tabs
        label="Payroll sections"
        value={tab}
        onChange={(value) => setTab(value as TabId)}
        items={[
          { id: 'runs', label: 'Payroll runs' },
          { id: 'rules', label: 'Statutory rules' },
          { id: 'accounts', label: 'Ledger accounts' },
        ]}
      />

      {tab === 'runs' && (
        <section className="space-y-3">
          {periods.length === 0 ? (
            <EmptyState
              title="No payroll periods"
              description="Create a period, record the statutory rules, then calculate the run."
            />
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Pay date</th>
                  <th>Status</th>
                  <th className="text-right">Staff</th>
                  <th className="text-right">Gross</th>
                  <th className="text-right">Net</th>
                  <th>Run state</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.id}>
                    <td className="font-medium">{period.name}</td>
                    <td className="tabular-nums text-xs">{period.payDate}</td>
                    <td>
                      <StatusBadge tone={period.status === 'OPEN' ? 'info' : 'neutral'}>
                        {period.status}
                      </StatusBadge>
                    </td>
                    <td className="text-right tabular-nums">{period.run?.employeeCount ?? '—'}</td>
                    <td className="text-right tabular-nums">
                      {period.run ? `KES ${kes(period.run.grossCents)}` : '—'}
                    </td>
                    <td className="text-right tabular-nums">
                      {period.run ? `KES ${kes(period.run.netCents)}` : '—'}
                    </td>
                    <td>
                      {period.run ? (
                        <RunBadge status={period.run.status} />
                      ) : (
                        <span className="text-xs text-muted">Not calculated</span>
                      )}
                    </td>
                    <td className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {canManage && (!period.run || period.run.status === 'CALCULATED') && (
                          <SecondaryButton
                            disabled={saving}
                            onClick={() =>
                              void run(async () => {
                                const result = await api.calculatePayrollPeriod(
                                  facilityId,
                                  period.id,
                                );
                                setCalcResult({
                                  employeeCount: result.employeeCount,
                                  versions: result.versions,
                                });
                                showToast(`Calculated ${result.employeeCount} payslips.`, {
                                  tone: 'success',
                                });
                                await load();
                                triggerRefresh();
                                await openRun(result.runId);
                              })
                            }
                          >
                            {period.run ? 'Recalculate' : 'Calculate'}
                          </SecondaryButton>
                        )}
                        {period.run && (
                          <SecondaryButton onClick={() => void openRun(period.run!.id)}>
                            View
                          </SecondaryButton>
                        )}
                        {period.run?.status === 'CALCULATED' && canApprove && (
                          <PrimaryButton
                            disabled={saving}
                            onClick={() =>
                              void run(async () => {
                                await api.approvePayrollRun(facilityId, period.run!.id);
                                showToast('Payroll approved.', { tone: 'success' });
                                await load();
                                triggerRefresh();
                                await openRun(period.run!.id);
                              })
                            }
                          >
                            <CheckCircle2 size={14} /> Approve
                          </PrimaryButton>
                        )}
                        {period.run?.status === 'APPROVED' && canPost && (
                          <PrimaryButton
                            disabled={saving}
                            onClick={() =>
                              void run(async () => {
                                const posted = await api.postPayrollRun(facilityId, period.run!.id);
                                showToast(`Posted to journal ${posted.journalNumber}.`, {
                                  tone: 'success',
                                });
                                await load();
                                triggerRefresh();
                                await openRun(period.run!.id);
                              })
                            }
                          >
                            <Send size={14} /> Post to ledger
                          </PrimaryButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          {calcResult && (
            <AlertBanner tone="info">
              Last calculation used:{' '}
              {Object.entries(calcResult.versions)
                .map(
                  ([statute, version]) =>
                    `${statute} — ${version.label} (from ${version.effectiveFrom})`,
                )
                .join('; ')}
              .
            </AlertBanner>
          )}
        </section>
      )}

      {tab === 'rules' && (
        <section className="space-y-3">
          <FilterToolbar>
            <h2 className="text-sm font-semibold">Effective-dated statutory versions</h2>
            {canManageRules && (
              <PrimaryButton onClick={() => setRuleModal(true)}>
                <Plus size={15} /> Record version
              </PrimaryButton>
            )}
          </FilterToolbar>
          <p className="text-xs text-muted">
            A run resolves exactly one active version per statute on the pay date. Missing or
            overlapping versions stop the calculation instead of guessing a figure. Activation is an
            audited action.
          </p>
          {versions.length === 0 ? (
            <EmptyState
              title="No statutory rules recorded"
              description="Record PAYE, NSSF, SHIF and Affordable Housing Levy versions with their authority source."
            />
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>Statute</th>
                  <th>Label</th>
                  <th>Effective</th>
                  <th>Authority</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th className="text-right">Bands</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id}>
                    <td className="font-semibold">{version.statute}</td>
                    <td>{version.label}</td>
                    <td className="text-xs tabular-nums">
                      {version.effectiveFrom} → {version.effectiveTo ?? 'open'}
                    </td>
                    <td className="text-xs">{version.authority}</td>
                    <td
                      className="max-w-[16rem] truncate text-xs text-muted"
                      title={version.sourceReference}
                    >
                      {version.sourceReference}
                    </td>
                    <td>
                      <StatusBadge
                        tone={
                          version.status === 'ACTIVE'
                            ? 'success'
                            : version.status === 'DRAFT'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {version.status}
                      </StatusBadge>
                    </td>
                    <td className="text-right tabular-nums">{version.bands.length}</td>
                    <td className="text-right">
                      {canManageRules && version.status !== 'ACTIVE' && (
                        <SecondaryButton
                          disabled={saving}
                          onClick={() =>
                            void run(async () => {
                              await api.setPayrollStatutoryVersionStatus(
                                facilityId,
                                version.id,
                                'ACTIVE',
                              );
                              showToast('Version activated.', { tone: 'success' });
                              await load();
                            })
                          }
                        >
                          Activate
                        </SecondaryButton>
                      )}
                      {canManageRules && version.status === 'ACTIVE' && (
                        <SecondaryButton
                          disabled={saving}
                          onClick={() =>
                            void run(async () => {
                              await api.setPayrollStatutoryVersionStatus(
                                facilityId,
                                version.id,
                                'RETIRED',
                              );
                              showToast('Version retired.', { tone: 'success' });
                              await load();
                            })
                          }
                        >
                          Retire
                        </SecondaryButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>
      )}

      {tab === 'accounts' && (
        <AccountMapping
          accounts={accounts}
          settings={settings}
          canManage={canManage}
          saving={saving}
          onSave={(payload) =>
            run(async () => {
              await api.savePayrollAccountSettings(facilityId, payload);
              showToast('Payroll account mapping saved.', { tone: 'success' });
              await load();
            })
          }
        />
      )}

      {periodModal && (
        <PeriodDialog
          saving={saving}
          onClose={() => setPeriodModal(false)}
          onSubmit={(payload) =>
            run(async () => {
              await api.createPayrollPeriod(facilityId, payload);
              showToast('Payroll period created.', { tone: 'success' });
              setPeriodModal(false);
              await load();
            })
          }
        />
      )}

      {ruleModal && (
        <RuleDialog
          saving={saving}
          onClose={() => setRuleModal(false)}
          onSubmit={(payload) =>
            run(async () => {
              await api.createPayrollStatutoryVersion(facilityId, payload);
              showToast('Draft version recorded. Activate it when the figures are confirmed.', {
                tone: 'success',
              });
              setRuleModal(false);
              await load();
            })
          }
        />
      )}

      {runDetail && (
        <Modal
          open
          onClose={() => setRunDetail(null)}
          title={`Payroll run — ${runDetail.run.periodName}`}
        >
          <RunDetailView
            detail={runDetail}
            onPayslip={(id) => void openPayslip(id)}
            onClose={() => setRunDetail(null)}
          />
        </Modal>
      )}

      {payslip && (
        <Modal open onClose={() => setPayslip(null)} title="Payslip">
          <PayslipView payslip={payslip} onClose={() => setPayslip(null)} />
        </Modal>
      )}
    </div>
  );
};

/* ============================================================
   RUN DETAIL AND PAYSLIP
   ============================================================ */

function RunDetailView({
  detail,
  onPayslip,
  onClose,
}: {
  detail: PayrollRunDetail;
  onPayslip: (id: number) => void;
  onClose: () => void;
}) {
  const { run, payslips } = detail;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <RunBadge status={run.status} />
        <span className="text-muted">
          {run.periodStart} → {run.periodEnd} · pay date {run.payDate} · {run.employeeCount} staff
        </span>
        {run.journalEntryId && <span className="text-muted">· journal #{run.journalEntryId}</span>}
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        {[
          ['Gross', run.grossCents],
          ['Taxable', run.taxableCents],
          ['PAYE', run.payeCents],
          ['NSSF (employee)', run.nssfEmployeeCents],
          ['NSSF (employer)', run.nssfEmployerCents],
          ['SHIF', run.shifCents],
          ['Housing levy (employee)', run.ahlEmployeeCents],
          ['Housing levy (employer)', run.ahlEmployerCents],
          ['Other deductions', run.otherDeductionsCents],
          ['Net pay', run.netCents],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-hair px-2 py-1.5">
            <dt className="text-muted">{label}</dt>
            <dd className="tabular-nums font-medium">KES {kes(value)}</dd>
          </div>
        ))}
      </dl>

      <DataTable>
        <thead>
          <tr>
            <th>Employee</th>
            <th className="text-right">Gross</th>
            <th className="text-right">PAYE</th>
            <th className="text-right">NSSF</th>
            <th className="text-right">SHIF</th>
            <th className="text-right">Levy</th>
            <th className="text-right">Net</th>
            <th aria-label="Payslip" />
          </tr>
        </thead>
        <tbody>
          {payslips.map((slip: PayrollPayslipRow) => (
            <tr key={slip.id}>
              <td>
                {slip.firstName} {slip.lastName}
                <div className="text-xs text-muted">{slip.employeeNumber}</div>
              </td>
              <td className="text-right tabular-nums">{kes(slip.grossCents)}</td>
              <td className="text-right tabular-nums">{kes(slip.payeCents)}</td>
              <td className="text-right tabular-nums">{kes(slip.nssfEmployeeCents)}</td>
              <td className="text-right tabular-nums">{kes(slip.shifCents)}</td>
              <td className="text-right tabular-nums">{kes(slip.ahlEmployeeCents)}</td>
              <td className="text-right font-medium tabular-nums">{kes(slip.netCents)}</td>
              <td className="text-right">
                <SecondaryButton onClick={() => onPayslip(slip.id)}>
                  <FileText size={14} /> Payslip
                </SecondaryButton>
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      <div className="flex justify-end gap-2">
        <SecondaryButton onClick={() => window.print()}>
          <Printer size={15} /> Print summary
        </SecondaryButton>
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
      </div>
    </div>
  );
}

function PayslipView({ payslip, onClose }: { payslip: PayrollPayslipDetail; onClose: () => void }) {
  const lines = payslip.breakdown?.lines ?? [];
  const deducations = lines.filter((line) => line.kind === 'DEDUCTION');
  const employerLines = lines.filter((line) => line.kind === 'EMPLOYER');
  const earnings = lines.filter((line) => line.kind === 'EARNING' && line.code !== 'NET');
  return (
    <div className="space-y-4" id="payslip-print">
      <header className="border-b border-hair pb-2">
        <h2 className="text-lg font-semibold">{payslip.facilityName}</h2>
        <p className="text-xs text-muted">
          Payslip · {payslip.periodName} · pay date {payslip.payDate} · run {payslip.runStatus}
        </p>
      </header>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-muted">Employee</p>
          <p className="font-medium">
            {payslip.firstName} {payslip.lastName}
          </p>
          <p className="text-muted">{payslip.employeeNumber}</p>
        </div>
        <div>
          <p className="text-muted">Department / designation</p>
          <p>{payslip.departmentName ?? '—'}</p>
          <p className="text-muted">{payslip.designationTitle ?? '—'}</p>
        </div>
        <div>
          <p className="text-muted">KRA PIN</p>
          <p>{payslip.kraPin ?? '—'}</p>
        </div>
        <div>
          <p className="text-muted">NSSF / SHIF</p>
          <p>
            {payslip.nssfNumber ?? '—'} / {payslip.shifNumber ?? '—'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Earnings</h3>
          <ul className="mt-1 space-y-1 text-xs">
            {earnings.map((line) => (
              <li key={line.code} className="flex justify-between">
                <span>{line.name}</span>
                <span className="tabular-nums">{kes(line.amountCents)}</span>
              </li>
            ))}
            <li className="flex justify-between border-t border-hair pt-1 font-medium">
              <span>Gross</span>
              <span className="tabular-nums">{kes(payslip.grossCents)}</span>
            </li>
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Deductions</h3>
          <ul className="mt-1 space-y-1 text-xs">
            {deducations.map((line) => (
              <li key={line.code} className="flex justify-between">
                <span>{line.name}</span>
                <span className="tabular-nums">{kes(line.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-lg bg-[#f5f7fb] px-3 py-2">
        <div className="flex justify-between text-sm font-semibold">
          <span>Net pay</span>
          <span className="tabular-nums">KES {kes(payslip.netCents)}</span>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Employer contributions
        </h3>
        <ul className="mt-1 space-y-1 text-xs">
          {employerLines.map((line) => (
            <li key={line.code} className="flex justify-between">
              <span>{line.name}</span>
              <span className="tabular-nums">{kes(line.amountCents)}</span>
            </li>
          ))}
        </ul>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted">
          Statutory rules applied to this payslip
        </summary>
        <ul className="mt-1 space-y-1">
          {payslip.breakdown?.statutes?.map((statute) => (
            <li key={statute.statute} className="flex justify-between">
              <span>
                {statute.statute} — {statute.label} (version {statute.versionId})
              </span>
              <span className="tabular-nums">
                employee {kes(statute.employeeCents)} · employer {kes(statute.employerCents)}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <div className="flex justify-end gap-2">
        <SecondaryButton onClick={() => window.print()}>
          <Printer size={15} /> Print payslip
        </SecondaryButton>
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
      </div>
    </div>
  );
}

/* ============================================================
   DIALOGS
   ============================================================ */

function PeriodDialog({
  saving,
  onClose,
  onSubmit,
}: {
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const defaults = monthRange();
  const [form, setForm] = useState(defaults);
  return (
    <Modal open onClose={onClose} title="New payroll period">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(form);
        }}
      >
        <label className="ui-field">
          <span>Period name *</span>
          <input
            className="ui-input"
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          {(['startDate', 'endDate', 'payDate'] as const).map((key) => (
            <label className="ui-field" key={key}>
              <span>
                {key === 'startDate' ? 'Start' : key === 'endDate' ? 'End' : 'Pay date'} *
              </span>
              <input
                className="ui-input"
                type="date"
                required
                value={form[key]}
                onChange={(event) => setForm({ ...form, [key]: event.target.value })}
              />
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Create period'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

const emptyBand = (): {
  lower: string;
  upper: string;
  employeeRate: string;
  employerRate: string;
  cap: string;
  relief: string;
} => ({
  lower: '',
  upper: '',
  employeeRate: '',
  employerRate: '',
  cap: '',
  relief: '',
});

const STATUTE_NOTES: Record<string, string> = {
  PAYE: 'Progressive tax. Enter each band’s lower bound, exclusive upper bound (blank for the top band), the employee rate and any relief.',
  NSSF: 'Exactly one band. Enter the employee and employer rate and, where the statute sets one, the cap on the amount charged.',
  SHIF: 'Exactly one band. Enter the employee rate and any cap.',
  AHL: 'Exactly one band. Enter the employee and employer rate.',
};

function RuleDialog({
  saving,
  onClose,
  onSubmit,
}: {
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [statute, setStatute] = useState<'PAYE' | 'NSSF' | 'SHIF' | 'AHL'>('PAYE');
  const [label, setLabel] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [effectiveTo, setEffectiveTo] = useState('');
  const [authority, setAuthority] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [notes, setNotes] = useState('');
  const [bands, setBands] = useState([emptyBand()]);

  const rateToBp = (value: string) => {
    const percent = Number(value);
    return Number.isFinite(percent) && percent >= 0 ? Math.round(percent * 100) : null;
  };
  const cents = (value: string) => {
    if (value.trim() === '') return '0';
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? String(Math.round(amount * 100)) : null;
  };

  const building = bands.map((band, index) => {
    const lower = cents(band.lower);
    const upper = band.upper.trim() === '' ? null : cents(band.upper);
    const employeeRate = rateToBp(band.employeeRate);
    const employerRate = rateToBp(band.employerRate);
    const cap = band.cap.trim() === '' ? null : cents(band.cap);
    const relief = cents(band.relief);
    return {
      sequence: index + 1,
      lowerBoundCents: lower,
      upperBoundCents: upper,
      employeeRateBp: employeeRate,
      employerRateBp: employerRate,
      employeeFixedCents: '0',
      employerFixedCents: '0',
      employeeCapCents: cap,
      employerCapCents: cap,
      reliefCents: relief,
    };
  });
  const invalid = building.some(
    (band) =>
      band.lowerBoundCents === null ||
      band.employeeRateBp === null ||
      band.employerRateBp === null ||
      (band.upperBoundCents === null && bands[building.indexOf(band)]?.upper.trim() !== ''),
  );

  return (
    <Modal open onClose={onClose} title="Record statutory version">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            statute,
            label,
            effectiveFrom,
            effectiveTo: effectiveTo || null,
            authority,
            sourceReference,
            notes: notes || null,
            bands: building,
          });
        }}
      >
        <AlertBanner tone="info">{STATUTE_NOTES[statute]}</AlertBanner>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="ui-field">
            <span>Statute *</span>
            <select
              className="ui-select"
              value={statute}
              onChange={(event) => {
                const next = event.target.value as typeof statute;
                setStatute(next);
                setBands([emptyBand()]);
              }}
            >
              {['PAYE', 'NSSF', 'SHIF', 'AHL'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            <span>Version label *</span>
            <input
              className="ui-input"
              required
              placeholder="e.g. Finance Act 2025 rates"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label className="ui-field">
            <span>Effective from *</span>
            <input
              className="ui-input"
              type="date"
              required
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </label>
          <label className="ui-field">
            <span>Effective to</span>
            <input
              className="ui-input"
              type="date"
              value={effectiveTo}
              onChange={(event) => setEffectiveTo(event.target.value)}
            />
          </label>
          <label className="ui-field">
            <span>Authority *</span>
            <input
              className="ui-input"
              required
              placeholder="e.g. Kenya Revenue Authority"
              value={authority}
              onChange={(event) => setAuthority(event.target.value)}
            />
          </label>
          <label className="ui-field sm:col-span-1">
            <span>Source reference *</span>
            <input
              className="ui-input"
              required
              minLength={8}
              placeholder="Publication title, notice or gazette reference"
              value={sourceReference}
              onChange={(event) => setSourceReference(event.target.value)}
            />
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Bands</h3>
            {statute === 'PAYE' && (
              <SecondaryButton type="button" onClick={() => setBands([...bands, emptyBand()])}>
                <Plus size={14} /> Add band
              </SecondaryButton>
            )}
          </div>
          {bands.map((band, index) => (
            <div
              key={index}
              className="grid gap-2 rounded-lg border border-hair p-2 sm:grid-cols-6"
            >
              <label className="ui-field">
                <span className="text-[11px]">From (KES)</span>
                <input
                  className="ui-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={band.lower}
                  onChange={(event) =>
                    setBands(
                      bands.map((b, i) => (i === index ? { ...b, lower: event.target.value } : b)),
                    )
                  }
                />
              </label>
              <label className="ui-field">
                <span className="text-[11px]">To (KES)</span>
                <input
                  className="ui-input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="open"
                  value={band.upper}
                  onChange={(event) =>
                    setBands(
                      bands.map((b, i) => (i === index ? { ...b, upper: event.target.value } : b)),
                    )
                  }
                />
              </label>
              <label className="ui-field">
                <span className="text-[11px]">Employee %</span>
                <input
                  className="ui-input"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={band.employeeRate}
                  onChange={(event) =>
                    setBands(
                      bands.map((b, i) =>
                        i === index ? { ...b, employeeRate: event.target.value } : b,
                      ),
                    )
                  }
                />
              </label>
              <label className="ui-field">
                <span className="text-[11px]">Employer %</span>
                <input
                  className="ui-input"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={band.employerRate}
                  onChange={(event) =>
                    setBands(
                      bands.map((b, i) =>
                        i === index ? { ...b, employerRate: event.target.value } : b,
                      ),
                    )
                  }
                />
              </label>
              <label className="ui-field">
                <span className="text-[11px]">Cap (KES)</span>
                <input
                  className="ui-input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="none"
                  value={band.cap}
                  onChange={(event) =>
                    setBands(
                      bands.map((b, i) => (i === index ? { ...b, cap: event.target.value } : b)),
                    )
                  }
                />
              </label>
              <div className="flex items-end gap-1">
                <label className="ui-field flex-1">
                  <span className="text-[11px]">Relief (KES)</span>
                  <input
                    className="ui-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={band.relief}
                    onChange={(event) =>
                      setBands(
                        bands.map((b, i) =>
                          i === index ? { ...b, relief: event.target.value } : b,
                        ),
                      )
                    }
                  />
                </label>
                {bands.length > 1 && (
                  <SecondaryButton
                    type="button"
                    aria-label="Remove band"
                    onClick={() => setBands(bands.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={14} />
                  </SecondaryButton>
                )}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-muted">
            Amounts are entered in shillings and stored as integer cents. Rates are stored as basis
            points (1% = 100). Nothing is rounded to a floating-point currency value.
          </p>
        </div>

        <label className="ui-field">
          <span>Notes</span>
          <textarea
            className="ui-input"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>

        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={saving || invalid}>
            {saving ? 'Saving…' : 'Save draft version'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function AccountMapping({
  accounts,
  settings,
  canManage,
  saving,
  onSave,
}: {
  accounts: Account[];
  settings: PayrollAccountSettings | null;
  canManage: boolean;
  saving: boolean;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const fields = [
    ['salaryExpenseAccountId', 'Salary expense'],
    ['employerCostAccountId', 'Employer statutory cost'],
    ['netPayPayableAccountId', 'Net pay payable'],
    ['payePayableAccountId', 'PAYE payable'],
    ['nssfPayableAccountId', 'NSSF payable'],
    ['shifPayableAccountId', 'SHIF payable'],
    ['ahlPayableAccountId', 'Housing levy payable'],
    ['otherDeductionsPayableAccountId', 'Other deductions payable (optional)'],
  ] as const;

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(([key]) => [key, settings?.[key] ? String(settings[key]) : ''])),
  );

  return (
    <section className="space-y-3">
      <AlertBanner tone="info">
        Posting a payroll run debits salary expense and employer cost, then credits net pay and each
        statutory liability. The journal must balance exactly; if any account is missing or belongs
        to another facility, posting is refused.
      </AlertBanner>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label]) => (
          <label className="ui-field" key={key}>
            <span>{label}</span>
            <select
              className="ui-select"
              disabled={!canManage}
              value={values[key] ?? ''}
              onChange={(event) => setValues({ ...values, [key]: event.target.value })}
            >
              <option value="">Not mapped</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.accountCode} — {account.accountName} ({account.accountType})
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {accounts.length === 0 && (
        <AlertBanner tone="warning">
          This facility has no active chart of accounts. Create accounts in Accounting before
          mapping payroll.
        </AlertBanner>
      )}
      {canManage && (
        <div className="flex justify-end">
          <PrimaryButton
            disabled={saving || accounts.length === 0}
            onClick={() =>
              onSave(
                Object.fromEntries(
                  Object.entries(values)
                    .filter(([, value]) => value !== '')
                    .map(([key, value]) => [key, Number(value)]),
                ),
              )
            }
          >
            <Landmark size={15} /> Save mapping
          </PrimaryButton>
        </div>
      )}
    </section>
  );
}
