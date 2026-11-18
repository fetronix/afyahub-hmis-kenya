/**
 * Fixed-asset workspace panels.
 *
 * These are the screens behind the tabs: the dashboard, the full registration
 * form, the depreciation policy and batch life cycle, preventive and corrective
 * maintenance, inspections, reports and configuration. They sit beside the
 * original register/categories panels rather than replacing them, so an
 * accountant who knows the old screen still finds it where it was.
 *
 * Every list is real data from the facility. Nothing here invents an amount: an
 * unconfigured depreciation policy is shown as unconfigured, and an empty report
 * says which filter produced no rows.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  CalendarClock,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileText,
  Gauge,
  Landmark,
  PlayCircle,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  TrendingDown,
  Wrench,
  XCircle,
} from 'lucide-react';

import { ApiError } from '../../../api/client.ts';
import {
  fixedAssetsClient,
  type AssetCategory,
  type AssetDocument,
  type AssetOperations,
  type AssetOptions,
  type AssetReportCatalogueEntry,
  type AssetReportResult,
  type AssetRow,
  type DepreciationBatch,
  type DepreciationSettings,
  type Inspection,
  type LifecycleEvent,
  type MaintenanceJob,
  type MaintenanceSchedule,
} from '../../../api/clients/fixed-assets.client.ts';
import { formatCents } from '../../../billing/settlement.ts';
import { PrimaryButton, SecondaryButton, Tabs } from '../../ui/controls.tsx';
import {
  AlertBanner,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatusBadge,
  type SemanticTone,
} from '../../ui/feedback.tsx';
import { DataTable, FilterToolbar, StatCard } from '../../ui/layout.tsx';

export type PanelProps = {
  facilityId: number;
  options: AssetOptions | null;
  categories: AssetCategory[];
  assets: AssetRow[];
  saving: boolean;
  can: (permission: string) => boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  notify: (message: string, tone?: 'success' | 'error') => void;
  refresh: () => Promise<void>;
  onOpenAsset: (id: number) => void;
};

const money = (cents: string | number | null | undefined) =>
  cents === null || cents === undefined ? '—' : formatCents(Number(cents));

const kesValue = (value: string | null | undefined) =>
  value === null || value === undefined ? '—' : formatCents(Math.round(Number(value) * 100));

const statusTone = (status: string | null | undefined): SemanticTone => {
  switch (status) {
    case 'ACTIVE':
    case 'POSTED':
    case 'COMPLETED':
    case 'RECONCILED':
      return 'success';
    case 'DRAFT':
    case 'PLANNED':
    case 'SCHEDULED':
    case 'REGISTERED':
      return 'info';
    case 'APPROVED':
    case 'DUE':
      return 'warning';
    case 'OVERDUE':
    case 'IMPAIRED':
    case 'UNDER_MAINTENANCE':
    case 'DIFFERENCE':
      return 'warning';
    case 'REVERSED':
    case 'DISPOSED':
    case 'RETIRED':
      return 'error';
    default:
      return 'neutral';
  }
};

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="ui-field">
      <span>{label}</span>
      {children}
      {hint && <span className="ui-field-hint">{hint}</span>}
    </label>
  );
}

function download(base64: string, filename: string, contentType: string) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/* ============================================================
   DASHBOARD
   ============================================================ */

export function AssetDashboardPanel({ facilityId, onOpenAsset }: PanelProps) {
  const [data, setData] = useState<Awaited<
    ReturnType<typeof fixedAssetsClient.getAssetDashboard>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!facilityId) return;
    setError(null);
    try {
      setData(await fixedAssetsClient.getAssetDashboard(facilityId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The asset dashboard could not be loaded.');
    }
  }, [facilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <LoadingSkeleton rows={4} />;

  const { counters, maintenance, latestBatches } = data;
  return (
    <div className="ui-module-stack">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Assets in register"
          value={counters.total}
          detail={`${counters.disposed} disposed · ${counters.retired} retired`}
          icon={<ClipboardList size={20} />}
        />
        <StatCard
          label="Cost"
          value={`KES ${money(counters.costCents)}`}
          detail="Historic cost, not valuation"
          icon={<CircleDollarSign size={20} />}
        />
        <StatCard
          label="Net book value"
          value={`KES ${money(counters.netBookCents)}`}
          detail={`${counters.underMaintenance} under maintenance · ${counters.impaired} impaired`}
          icon={<Landmark size={20} />}
        />
        <StatCard
          label="Maintenance attention"
          value={maintenance.overdue.length + maintenance.dueToday.length}
          detail={`${maintenance.openCorrective.length} open repair(s)`}
          icon={<Wrench size={20} />}
        />
      </div>

      <section aria-labelledby="asset-attention">
        <h2 id="asset-attention" className="text-sm font-semibold">
          Needs attention
        </h2>
        {maintenance.overdue.length === 0 &&
        maintenance.dueToday.length === 0 &&
        maintenance.openCorrective.length === 0 ? (
          <AlertBanner tone="success">
            Nothing is overdue. Preventive schedules and open repairs are clear.
          </AlertBanner>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold text-muted">Preventive maintenance due</h3>
              {[...maintenance.overdue, ...maintenance.dueToday].length === 0 ? (
                <p className="text-xs text-muted">No schedule is due.</p>
              ) : (
                <DataTable className="table-quiet">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Schedule</th>
                      <th>Due</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...maintenance.overdue, ...maintenance.dueToday].map((schedule) => (
                      <tr key={schedule.id}>
                        <td>
                          <button className="ui-link" onClick={() => onOpenAsset(schedule.assetId)}>
                            {schedule.assetCode}
                          </button>
                          <div className="text-xs text-muted">{schedule.assetName}</div>
                        </td>
                        <td>{schedule.name}</td>
                        <td>{schedule.nextDueDate}</td>
                        <td>
                          <StatusBadge tone={statusTone(schedule.status)}>
                            {schedule.status}
                          </StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
            </div>
            <div>
              <h3 className="text-xs font-semibold text-muted">Open corrective jobs</h3>
              {maintenance.openCorrective.length === 0 ? (
                <p className="text-xs text-muted">No open repair.</p>
              ) : (
                <DataTable className="table-quiet">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Reported</th>
                      <th>Priority</th>
                      <th>Technician</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maintenance.openCorrective.map((job) => (
                      <tr key={job.id}>
                        <td>
                          <button className="ui-link" onClick={() => onOpenAsset(job.assetId)}>
                            {job.assetCode}
                          </button>
                          <div className="text-xs text-muted">
                            {job.problemDescription ?? job.description}
                          </div>
                        </td>
                        <td>{job.reportedDate ?? job.maintenanceDate}</td>
                        <td>
                          <StatusBadge
                            tone={
                              job.priority === 'CRITICAL' || job.priority === 'HIGH'
                                ? 'error'
                                : job.priority === 'MEDIUM'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {job.priority ?? 'MEDIUM'}
                          </StatusBadge>
                        </td>
                        <td>{job.assignedTechnician ?? 'Unassigned'}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="asset-dashboard-batches">
        <h2 id="asset-dashboard-batches" className="text-sm font-semibold">
          Recent depreciation batches
        </h2>
        {latestBatches.length === 0 ? (
          <p className="text-xs text-muted">No depreciation has been prepared yet.</p>
        ) : (
          <DataTable className="table-quiet">
            <thead>
              <tr>
                <th>Period</th>
                <th>Status</th>
                <th className="text-right">Assets</th>
                <th className="text-right">Charge (KES)</th>
                <th>Posted</th>
              </tr>
            </thead>
            <tbody>
              {latestBatches.map((batch) => (
                <tr key={batch.id}>
                  <td>{batch.periodCode}</td>
                  <td>
                    <StatusBadge tone={statusTone(batch.status)}>{batch.status}</StatusBadge>
                  </td>
                  <td className="text-right tabular-nums">{batch.assetCount}</td>
                  <td className="text-right tabular-nums">{money(batch.totalCents)}</td>
                  <td>{batch.postedAt ? new Date(batch.postedAt).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
    </div>
  );
}

/* ============================================================
   REGISTRATION
   ============================================================ */

const today = () => new Date().toISOString().slice(0, 10);

export function AssetRegistrationPanel({
  facilityId,
  options,
  categories,
  saving,
  run,
  notify,
  refresh,
  onOpenAsset,
}: PanelProps) {
  const [form, setForm] = useState({
    assetCode: '',
    assetName: '',
    description: '',
    categoryId: '',
    departmentId: '',
    location: '',
    custodianEmployeeId: '',
    serialNumber: '',
    manufacturer: '',
    model: '',
    barcode: '',
    acquisitionDate: today(),
    placedInServiceDate: today(),
    acquisitionMethod: 'PURCHASE',
    supplierId: '',
    purchaseReference: '',
    goodsReceivedNoteId: '',
    fundingSource: '',
    acquisitionCostKes: '',
    salvageValueKes: '0',
    usefulLifeMonths: '120',
    annualRateBps: '1000',
    depreciationCommencement: '',
    acquisitionCreditAccountId: '',
    notes: '',
  });
  const [created, setCreated] = useState<{ id: number; journalNumber?: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const selectedCategory = categories.find((category) => String(category.id) === form.categoryId);
  const life = form.usefulLifeMonths || String(selectedCategory?.defaultUsefulLifeMonths ?? 120);

  const submit = () => {
    setFormError(null);
    void run(async () => {
      try {
        const result = await fixedAssetsClient.createAsset(facilityId, {
          ...form,
          categoryId: form.categoryId || undefined,
          departmentId: form.departmentId || undefined,
          custodianEmployeeId: form.custodianEmployeeId || undefined,
          supplierId: form.supplierId || undefined,
          goodsReceivedNoteId: form.goodsReceivedNoteId || undefined,
          depreciationCommencement: form.depreciationCommencement || undefined,
          usefulLifeMonths: Number(life),
          annualRateBps: Number(form.annualRateBps),
        });
        setCreated(result);
        notify(
          `Asset ${form.assetCode} capitalised under journal ${result.journalNumber}.`,
          'success',
        );
        setForm((current) => ({
          ...current,
          assetCode: '',
          assetName: '',
          description: '',
          serialNumber: '',
          barcode: '',
          acquisitionCostKes: '',
        }));
        await refresh();
      } catch (err) {
        setFormError(err instanceof ApiError ? err.message : 'The asset could not be registered.');
      }
    });
  };

  if (!options) return <LoadingSkeleton rows={4} />;

  return (
    <div className="ui-module-stack">
      {created && (
        <AlertBanner tone="success">
          Saved. The acquisition journal is {created.journalNumber ?? 'posted'}.
          <button className="ui-link ml-2" onClick={() => onOpenAsset(created.id)}>
            Open the asset
          </button>
        </AlertBanner>
      )}
      {formError && <AlertBanner tone="error">{formError}</AlertBanner>}

      <section aria-labelledby="registration-identification">
        <h2 id="registration-identification" className="text-sm font-semibold">
          Identification
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Asset code" hint="Unique within this facility.">
            <input
              className="ui-input"
              value={form.assetCode}
              onChange={set('assetCode')}
              required
            />
          </Field>
          <Field label="Asset name">
            <input
              className="ui-input"
              value={form.assetName}
              onChange={set('assetName')}
              required
            />
          </Field>
          <Field label="Category">
            <select className="ui-select" value={form.categoryId} onChange={set('categoryId')}>
              <option value="">Uncategorised</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Manufacturer">
            <input className="ui-input" value={form.manufacturer} onChange={set('manufacturer')} />
          </Field>
          <Field label="Model">
            <input className="ui-input" value={form.model} onChange={set('model')} />
          </Field>
          <Field label="Serial number">
            <input className="ui-input" value={form.serialNumber} onChange={set('serialNumber')} />
          </Field>
          <Field label="Barcode / QR payload" hint="Unique within this facility.">
            <input className="ui-input" value={form.barcode} onChange={set('barcode')} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <textarea
                className="ui-input"
                rows={2}
                value={form.description}
                onChange={set('description')}
              />
            </Field>
          </div>
        </div>
      </section>

      <section aria-labelledby="registration-ownership">
        <h2 id="registration-ownership" className="text-sm font-semibold">
          Ownership, location and custodian
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Department">
            <select className="ui-select" value={form.departmentId} onChange={set('departmentId')}>
              <option value="">Unassigned</option>
              {options.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Physical location">
            <input className="ui-input" value={form.location} onChange={set('location')} />
          </Field>
          <Field label="Custodian">
            <select
              className="ui-select"
              value={form.custodianEmployeeId}
              onChange={set('custodianEmployeeId')}
            >
              <option value="">Unassigned</option>
              {options.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.firstName} {employee.lastName} ({employee.employeeNumber})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Funding source">
            <input
              className="ui-input"
              value={form.fundingSource}
              onChange={set('fundingSource')}
            />
          </Field>
        </div>
      </section>

      <section aria-labelledby="registration-acquisition">
        <h2 id="registration-acquisition" className="text-sm font-semibold">
          Acquisition
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Acquisition date">
            <input
              className="ui-input"
              type="date"
              value={form.acquisitionDate}
              onChange={set('acquisitionDate')}
            />
          </Field>
          <Field
            label="Date placed in service"
            hint="Depreciation follows this date when recorded."
          >
            <input
              className="ui-input"
              type="date"
              value={form.placedInServiceDate}
              onChange={set('placedInServiceDate')}
            />
          </Field>
          <Field label="Acquisition method">
            <select
              className="ui-select"
              value={form.acquisitionMethod}
              onChange={set('acquisitionMethod')}
            >
              {['PURCHASE', 'DONATION', 'TRANSFER', 'LEASE', 'CONSTRUCTED'].map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Supplier">
            <select className="ui-select" value={form.supplierId} onChange={set('supplierId')}>
              <option value="">Not recorded</option>
              {/* Suppliers come from procurement; until that selector is added
                  the id is typed deliberately rather than guessed. */}
            </select>
          </Field>
          <Field label="Purchase reference / invoice">
            <input
              className="ui-input"
              value={form.purchaseReference}
              onChange={set('purchaseReference')}
            />
          </Field>
          <Field label="Goods received note id" hint="Optional; must belong to this facility.">
            <input
              className="ui-input"
              inputMode="numeric"
              value={form.goodsReceivedNoteId}
              onChange={set('goodsReceivedNoteId')}
            />
          </Field>
          <Field label="Cost (KES)">
            <input
              className="ui-input"
              inputMode="decimal"
              value={form.acquisitionCostKes}
              onChange={set('acquisitionCostKes')}
              required
            />
          </Field>
          <Field label="Residual value (KES)" hint="Recorded explicitly, never assumed.">
            <input
              className="ui-input"
              inputMode="decimal"
              value={form.salvageValueKes}
              onChange={set('salvageValueKes')}
            />
          </Field>
          <Field label="Funding / credit account">
            <select
              className="ui-select"
              value={form.acquisitionCreditAccountId}
              onChange={set('acquisitionCreditAccountId')}
            >
              <option value="">Select the facility account</option>
              {options.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section aria-labelledby="registration-depreciation">
        <h2 id="registration-depreciation" className="text-sm font-semibold">
          Depreciation
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Useful life (months)">
            <input
              className="ui-input"
              inputMode="numeric"
              value={life}
              onChange={set('usefulLifeMonths')}
            />
          </Field>
          <Field label="Annual rate (basis points)" hint="1000 bps = 10% a year.">
            <input
              className="ui-input"
              inputMode="numeric"
              value={form.annualRateBps}
              onChange={set('annualRateBps')}
            />
          </Field>
          <Field label="Commencement" hint="Blank follows the facility policy.">
            <select
              className="ui-select"
              value={form.depreciationCommencement}
              onChange={set('depreciationCommencement')}
            >
              <option value="">Facility policy</option>
              <option value="FULL_MONTH">Full month of service</option>
              <option value="FOLLOWING_MONTH">Following month</option>
              <option value="DAILY_PRORATA">Daily pro-rata</option>
            </select>
          </Field>
          <div className="text-xs text-muted">
            Method: straight line. With a life of {life} months the annual charge is the depreciable
            base divided by {Math.max(1, Math.round(Number(life) / 12))} year(s), posted monthly.
          </div>
        </div>
        <Field label="Notes">
          <textarea className="ui-input" rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
      </section>

      <div className="flex justify-end gap-2">
        <PrimaryButton onClick={submit} disabled={saving}>
          <Plus size={15} /> Register and capitalise
        </PrimaryButton>
      </div>
    </div>
  );
}

/* ============================================================
   DEPRECIATION POLICY AND BATCHES
   ============================================================ */

export function DepreciationPanel({ facilityId, saving, can, run, notify, refresh }: PanelProps) {
  const [settings, setSettings] = useState<DepreciationSettings | null>(null);
  const [batches, setBatches] = useState<DepreciationBatch[]>([]);
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof fixedAssetsClient.previewDepreciationBatch>
  > | null>(null);
  const [detail, setDetail] = useState<Awaited<
    ReturnType<typeof fixedAssetsClient.getDepreciationBatch>
  > | null>(null);
  const [reversalFor, setReversalFor] = useState<DepreciationBatch | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!facilityId) return;
    setError(null);
    try {
      const [policy, history] = await Promise.all([
        fixedAssetsClient.getDepreciationSettings(facilityId),
        fixedAssetsClient.getDepreciationBatches(facilityId),
      ]);
      setSettings(policy);
      setBatches(history);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Depreciation data could not be loaded.');
    }
  }, [facilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const previewPeriod = () =>
    run(async () => {
      setPreview(await fixedAssetsClient.previewDepreciationBatch(facilityId, period));
    });

  const prepare = () =>
    run(async () => {
      const batch = await fixedAssetsClient.prepareDepreciationBatch(facilityId, { period });
      notify(`Prepared ${period} depreciation for ${batch.assetCount} asset(s).`, 'success');
      setPreview(null);
      await load();
      await refresh();
    });

  const act = (batch: DepreciationBatch, action: 'approve' | 'post' | 'discard') =>
    run(async () => {
      if (action === 'approve') {
        await fixedAssetsClient.approveDepreciationBatch(facilityId, batch.id);
        notify(`Approved ${batch.periodCode}. Nothing has reached the ledger yet.`, 'success');
      } else if (action === 'post') {
        const posted = await fixedAssetsClient.postDepreciationBatch(facilityId, batch.id);
        notify(`Posted ${batch.periodCode} under journal ${posted.journalNumber}.`, 'success');
      } else {
        await fixedAssetsClient.discardDepreciationBatch(facilityId, batch.id);
        notify(`Discarded the unposted ${batch.periodCode} draft.`, 'success');
      }
      await load();
      await refresh();
    });

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!settings) return <LoadingSkeleton rows={4} />;

  const liveBatch = preview?.existingBatch ?? null;

  return (
    <div className="ui-module-stack">
      {!settings.configured && (
        <AlertBanner tone="warning">
          This facility has not saved a depreciation policy. Schedules currently use the documented
          default — straight line, {settings.defaultUsefulLifeMonths} months,{' '}
          {(settings.defaultAnnualRateBps / 100).toFixed(2)}% a year, full month of service. An
          authorised user should review and save it under Configuration.
        </AlertBanner>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Policy convention"
          value={settings.depreciationCommencement.replace('_', ' ').toLowerCase()}
          detail={`Financial year starts month ${settings.financialYearStartMonth}`}
          icon={<Gauge size={20} />}
        />
        <StatCard
          label="Default life and rate"
          value={`${settings.defaultUsefulLifeMonths} months`}
          detail={`${(settings.defaultAnnualRateBps / 100).toFixed(2)}% p.a. · ${(settings.monthlyRateBpsForDefaultLife / 100).toFixed(2)}% a month`}
          icon={<TrendingDown size={20} />}
        />
        <StatCard
          label="Approval"
          value={settings.depreciationApprovalRequired ? 'Required' : 'Preparer may post'}
          detail={`${settings.pendingBatchCount} batch(es) pending`}
          icon={<ShieldCheck size={20} />}
        />
        <StatCard
          label="Posted batches"
          value={settings.postedBatchCount}
          detail="Reversals stay on file"
          icon={<ClipboardCheck size={20} />}
        />
      </section>

      <section aria-labelledby="depreciation-run">
        <h2 id="depreciation-run" className="text-sm font-semibold">
          Prepare a monthly batch
        </h2>
        <FilterToolbar>
          <input
            className="ui-input"
            type="month"
            aria-label="Depreciation period"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
          <SecondaryButton onClick={() => void previewPeriod()} disabled={saving}>
            Preview
          </SecondaryButton>
          {can('assets.depreciate') && (
            <PrimaryButton onClick={prepare} disabled={saving}>
              <Plus size={15} /> Prepare batch
            </PrimaryButton>
          )}
          <span className="text-xs text-muted">
            Preparing does not touch the ledger. Approval and posting are separate acts.
          </span>
        </FilterToolbar>

        {liveBatch && (
          <AlertBanner tone="warning">
            A {liveBatch.status.toLowerCase()} batch already exists for {period} (
            {formatCents(Number(liveBatch.totalCents))} cents · {liveBatch.assetCount} assets). A
            new batch can only be prepared after the existing one is posted and reversed.
          </AlertBanner>
        )}

        {preview && (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <StatusBadge tone="info">{preview.convention}</StatusBadge>
              <span>
                {preview.rows.length} asset(s) · total KES {money(preview.totalCents)} · rows show
                the basis actually used for each asset.
              </span>
            </div>
            {preview.rows.length === 0 ? (
              <EmptyState
                title="No charge is due"
                description={`No asset has a depreciation charge for ${period} under ${preview.convention}.`}
              />
            ) : (
              <DataTable className="table-quiet">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">Residual</th>
                    <th className="text-right">Base</th>
                    <th className="text-right">Life</th>
                    <th>Convention</th>
                    <th className="text-right">Opening acc.</th>
                    <th className="text-right">Charge</th>
                    <th className="text-right">Closing acc.</th>
                    <th className="text-right">Closing book</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.assetId}>
                      <td>
                        <div className="font-medium">{row.assetCode}</div>
                        <div className="text-xs text-muted">{row.assetName}</div>
                      </td>
                      <td className="text-right tabular-nums">{money(row.costCents)}</td>
                      <td className="text-right tabular-nums">{money(row.salvageCents)}</td>
                      <td className="text-right tabular-nums">{money(row.basisCents)}</td>
                      <td className="text-right tabular-nums">{row.usefulLifeMonths}</td>
                      <td>
                        {row.convention}
                        {row.convention === 'DAILY_PRORATA' && (
                          <div className="text-xs text-muted">
                            {row.daysInService}/{row.periodDays} days
                          </div>
                        )}
                      </td>
                      <td className="text-right tabular-nums">
                        {money(row.openingAccumulatedCents)}
                      </td>
                      <td className="text-right tabular-nums font-medium">
                        {money(row.chargeCents)}
                      </td>
                      <td className="text-right tabular-nums">
                        {money(row.closingAccumulatedCents)}
                      </td>
                      <td className="text-right tabular-nums">
                        {money(row.closingBookValueCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="depreciation-batches">
        <h2 id="depreciation-batches" className="text-sm font-semibold">
          Batch history
        </h2>
        {batches.length === 0 ? (
          <p className="text-xs text-muted">No batch has been prepared.</p>
        ) : (
          <DataTable className="table-quiet">
            <thead>
              <tr>
                <th>Period</th>
                <th>Status</th>
                <th className="text-right">Assets</th>
                <th className="text-right">Charge (KES)</th>
                <th>Journal</th>
                <th>Reason / notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <td>{batch.periodCode}</td>
                  <td>
                    <StatusBadge tone={statusTone(batch.status)}>{batch.status}</StatusBadge>
                  </td>
                  <td className="text-right tabular-nums">{batch.assetCount}</td>
                  <td className="text-right tabular-nums">{money(batch.totalCents)}</td>
                  <td>{batch.journalEntryId ?? '—'}</td>
                  <td className="text-xs text-muted">
                    {batch.reversalReason ?? batch.notes ?? ''}
                  </td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-1">
                      <SecondaryButton
                        onClick={() =>
                          void run(async () =>
                            setDetail(
                              await fixedAssetsClient.getDepreciationBatch(facilityId, batch.id),
                            ),
                          )
                        }
                      >
                        View
                      </SecondaryButton>
                      {batch.status === 'DRAFT' && can('assets.depreciation.approve') && (
                        <PrimaryButton onClick={() => act(batch, 'approve')} disabled={saving}>
                          Approve
                        </PrimaryButton>
                      )}
                      {batch.status === 'APPROVED' && can('assets.depreciation.approve') && (
                        <PrimaryButton onClick={() => act(batch, 'post')} disabled={saving}>
                          <PlayCircle size={15} /> Post
                        </PrimaryButton>
                      )}
                      {batch.status === 'DRAFT' && can('assets.depreciate') && (
                        <SecondaryButton onClick={() => act(batch, 'discard')} disabled={saving}>
                          Discard
                        </SecondaryButton>
                      )}
                      {batch.status === 'POSTED' && can('assets.depreciation.approve') && (
                        <SecondaryButton onClick={() => setReversalFor(batch)}>
                          <RotateCcw size={15} /> Reverse
                        </SecondaryButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>

      {detail && (
        <section aria-labelledby="batch-detail">
          <h2 id="batch-detail" className="text-sm font-semibold">
            {detail.batch.periodCode} batch — frozen charges
          </h2>
          <DataTable className="table-quiet">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Convention</th>
                <th className="text-right">Opening</th>
                <th className="text-right">Charge</th>
                <th className="text-right">Closing</th>
                <th className="text-right">Closing book</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.assetCode}
                    <div className="text-xs text-muted">{item.assetName}</div>
                  </td>
                  <td>{item.commencement}</td>
                  <td className="text-right tabular-nums">{money(item.openingAccumulatedCents)}</td>
                  <td className="text-right tabular-nums">{money(item.chargeCents)}</td>
                  <td className="text-right tabular-nums">{money(item.closingAccumulatedCents)}</td>
                  <td className="text-right tabular-nums">{money(item.closingNbvCents)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <div className="mt-2 flex justify-end">
            <SecondaryButton onClick={() => setDetail(null)}>Close</SecondaryButton>
          </div>
        </section>
      )}

      {reversalFor && (
        <section aria-labelledby="batch-reversal">
          <h2 id="batch-reversal" className="text-sm font-semibold">
            Reverse {reversalFor.periodCode}
          </h2>
          <AlertBanner tone="warning">
            Reversal posts the opposite journal and restores each asset&apos;s accumulated
            depreciation. The original batch and its journal stay on file.
          </AlertBanner>
          <Field label="Reason">
            <input
              className="ui-input"
              value={reversalReason}
              onChange={(event) => setReversalReason(event.target.value)}
            />
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            <SecondaryButton onClick={() => setReversalFor(null)}>Cancel</SecondaryButton>
            <PrimaryButton
              disabled={saving || reversalReason.trim().length < 3}
              onClick={() =>
                void run(async () => {
                  const result = await fixedAssetsClient.reverseDepreciationBatch(
                    facilityId,
                    reversalFor.id,
                    reversalReason.trim(),
                  );
                  notify(`Reversed — journal ${result.reversalJournalNumber}.`, 'success');
                  setReversalFor(null);
                  setReversalReason('');
                  await load();
                  await refresh();
                })
              }
            >
              Reverse batch
            </PrimaryButton>
          </div>
        </section>
      )}
    </div>
  );
}

/* ============================================================
   MAINTENANCE
   ============================================================ */

export function MaintenancePanel({
  facilityId,
  assets,
  options,
  saving,
  can,
  run,
  notify,
  refresh,
}: PanelProps) {
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([]);
  const [jobs, setJobs] = useState<MaintenanceJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<AssetRow | null>(null);
  const [completeSchedule, setCompleteSchedule] = useState<MaintenanceSchedule | null>(null);
  const [faultFor, setFaultFor] = useState<AssetRow | null>(null);
  const [completeJob, setCompleteJob] = useState<MaintenanceJob | null>(null);
  const [verifyJob, setVerifyJob] = useState<MaintenanceJob | null>(null);

  const load = useCallback(async () => {
    if (!facilityId) return;
    setError(null);
    try {
      const [scheduleRows, jobRows] = await Promise.all([
        fixedAssetsClient.getMaintenanceSchedules(facilityId, { includeInactive: true }),
        fixedAssetsClient.getMaintenanceJobs(facilityId),
      ]);
      setSchedules(scheduleRows);
      setJobs(jobRows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Maintenance data could not be loaded.');
    }
  }, [facilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  const canManage = can('assets.maintenance.manage') || can('assets.manage');

  return (
    <div className="ui-module-stack">
      <section aria-labelledby="preventive-schedules">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="preventive-schedules" className="text-sm font-semibold">
            Preventive schedules
          </h2>
          {canManage && (
            <SecondaryButton
              onClick={() => setScheduleFor(assets[0] ?? null)}
              disabled={!assets.length}
            >
              <CalendarClock size={15} /> New schedule
            </SecondaryButton>
          )}
        </div>
        {schedules.length === 0 ? (
          <EmptyState
            title="No preventive schedule"
            description="Schedule servicing so the register can show what is due and what is overdue."
          />
        ) : (
          <DataTable className="table-quiet">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Schedule</th>
                <th>Frequency</th>
                <th>Next due</th>
                <th>Status</th>
                <th>Last done</th>
                <th className="text-right">Estimate</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schedules.map((schedule) => (
                <tr key={schedule.id}>
                  <td>
                    {schedule.assetCode}
                    <div className="text-xs text-muted">{schedule.assetName}</div>
                  </td>
                  <td>
                    {schedule.name}
                    <div className="text-xs text-muted">
                      {schedule.assignedTechnician ?? schedule.vendor ?? 'Unassigned'}
                    </div>
                  </td>
                  <td>{schedule.frequency}</td>
                  <td>{schedule.nextDueDate}</td>
                  <td>
                    <StatusBadge tone={statusTone(schedule.status)}>{schedule.status}</StatusBadge>
                  </td>
                  <td>{schedule.lastCompletedDate ?? '—'}</td>
                  <td className="text-right tabular-nums">{money(schedule.estimatedCostCents)}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {canManage && schedule.isActive && (
                        <PrimaryButton onClick={() => setCompleteSchedule(schedule)}>
                          Record service
                        </PrimaryButton>
                      )}
                      {canManage && schedule.isActive && (
                        <SecondaryButton
                          onClick={() =>
                            void run(async () => {
                              await fixedAssetsClient.retireMaintenanceSchedule(
                                facilityId,
                                schedule.id,
                                'Retired from the maintenance workspace',
                              );
                              notify('Schedule retired; its history remains.', 'success');
                              await load();
                            })
                          }
                        >
                          Retire
                        </SecondaryButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>

      <section aria-labelledby="maintenance-jobs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="maintenance-jobs" className="text-sm font-semibold">
            Maintenance jobs
          </h2>
          {canManage && (
            <SecondaryButton
              onClick={() => setFaultFor(assets[0] ?? null)}
              disabled={!assets.length}
            >
              <Wrench size={15} /> Report a fault
            </SecondaryButton>
          )}
        </div>
        {jobs.length === 0 ? (
          <p className="text-xs text-muted">No maintenance has been recorded.</p>
        ) : (
          <DataTable className="table-quiet">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Type</th>
                <th>Date</th>
                <th>Priority</th>
                <th>Work</th>
                <th className="text-right">Cost (KES)</th>
                <th>Status</th>
                <th>Verified</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    {job.assetCode}
                    <div className="text-xs text-muted">{job.assetName}</div>
                  </td>
                  <td>{job.maintenanceType}</td>
                  <td>{job.reportedDate ?? job.maintenanceDate}</td>
                  <td>{job.priority ?? '—'}</td>
                  <td>
                    {job.repairActions ?? job.problemDescription ?? job.description}
                    {job.partsUsed && (
                      <div className="text-xs text-muted">Parts: {job.partsUsed}</div>
                    )}
                  </td>
                  <td className="text-right tabular-nums">{kesValue(job.costKes)}</td>
                  <td>
                    <StatusBadge tone={statusTone(job.status)}>{job.status}</StatusBadge>
                  </td>
                  <td>{job.verifiedAt ? 'Verified' : '—'}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {canManage &&
                        job.status === 'PLANNED' &&
                        job.maintenanceType === 'CORRECTIVE' && (
                          <PrimaryButton onClick={() => setCompleteJob(job)}>
                            Complete
                          </PrimaryButton>
                        )}
                      {canManage && job.status === 'COMPLETED' && !job.verifiedAt && (
                        <SecondaryButton onClick={() => setVerifyJob(job)}>Verify</SecondaryButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>

      {scheduleFor && (
        <ScheduleForm
          assets={assets}
          initialAsset={scheduleFor}
          options={options}
          saving={saving}
          onClose={() => setScheduleFor(null)}
          onSubmit={(body) =>
            run(async () => {
              await fixedAssetsClient.createMaintenanceSchedule(facilityId, body);
              notify('Preventive schedule created.', 'success');
              setScheduleFor(null);
              await load();
              await refresh();
            })
          }
        />
      )}

      {completeSchedule && (
        <CompleteScheduleForm
          schedule={completeSchedule}
          options={options}
          saving={saving}
          onClose={() => setCompleteSchedule(null)}
          onSubmit={(body) =>
            run(async () => {
              const result = await fixedAssetsClient.completeMaintenanceSchedule(
                facilityId,
                completeSchedule.id,
                body,
              );
              notify(`Recorded. Next service is due ${result.nextDueDate}.`, 'success');
              setCompleteSchedule(null);
              await load();
              await refresh();
            })
          }
        />
      )}

      {faultFor && (
        <CorrectiveForm
          assets={assets}
          initialAsset={faultFor}
          saving={saving}
          onClose={() => setFaultFor(null)}
          onSubmit={(body) =>
            run(async () => {
              await fixedAssetsClient.createCorrectiveMaintenance(facilityId, body);
              notify('Fault reported and queued for repair.', 'success');
              setFaultFor(null);
              await load();
              await refresh();
            })
          }
        />
      )}

      {completeJob && (
        <CompleteCorrectiveForm
          job={completeJob}
          options={options}
          saving={saving}
          onClose={() => setCompleteJob(null)}
          onSubmit={(body) =>
            run(async () => {
              await fixedAssetsClient.completeCorrectiveMaintenance(
                facilityId,
                completeJob.id,
                body,
              );
              notify(
                Number(body.costKes) > 0
                  ? 'Repair completed and its cost posted to the ledger.'
                  : 'Repair completed.',
                'success',
              );
              setCompleteJob(null);
              await load();
              await refresh();
            })
          }
        />
      )}

      {verifyJob && (
        <VerifyForm
          job={verifyJob}
          saving={saving}
          onClose={() => setVerifyJob(null)}
          onSubmit={(notes) =>
            run(async () => {
              await fixedAssetsClient.verifyMaintenance(facilityId, verifyJob.id, notes);
              notify('Completion verified by a second officer.', 'success');
              setVerifyJob(null);
              await load();
            })
          }
        />
      )}
    </div>
  );
}

function ScheduleForm({
  assets,
  initialAsset,
  options,
  saving,
  onClose,
  onSubmit,
}: {
  assets: AssetRow[];
  initialAsset: AssetRow;
  options: AssetOptions | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    assetId: String(initialAsset.id),
    name: '',
    frequency: 'QUARTERLY',
    intervalDays: '',
    nextDueDate: today(),
    instructions: '',
    responsibleDepartmentId: '',
    assignedTechnician: '',
    vendor: '',
    estimatedCostKes: '0',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <InlineForm title="New preventive schedule" onClose={onClose} saving={saving}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Asset">
          <select className="ui-select" value={form.assetId} onChange={set('assetId')}>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.assetCode} — {asset.assetName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Schedule name">
          <input className="ui-input" value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Frequency">
          <select className="ui-select" value={form.frequency} onChange={set('frequency')}>
            {['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'CUSTOM'].map(
              (frequency) => (
                <option key={frequency} value={frequency}>
                  {frequency}
                </option>
              ),
            )}
          </select>
        </Field>
        {form.frequency === 'CUSTOM' && (
          <Field label="Interval (days)">
            <input
              className="ui-input"
              inputMode="numeric"
              value={form.intervalDays}
              onChange={set('intervalDays')}
            />
          </Field>
        )}
        <Field label="Next due date">
          <input
            className="ui-input"
            type="date"
            value={form.nextDueDate}
            onChange={set('nextDueDate')}
          />
        </Field>
        <Field label="Responsible department">
          <select
            className="ui-select"
            value={form.responsibleDepartmentId}
            onChange={set('responsibleDepartmentId')}
          >
            <option value="">Unassigned</option>
            {(options?.departments ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Technician">
          <input
            className="ui-input"
            value={form.assignedTechnician}
            onChange={set('assignedTechnician')}
          />
        </Field>
        <Field label="Vendor">
          <input className="ui-input" value={form.vendor} onChange={set('vendor')} />
        </Field>
        <Field label="Estimated cost (KES)">
          <input
            className="ui-input"
            inputMode="decimal"
            value={form.estimatedCostKes}
            onChange={set('estimatedCostKes')}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Instructions">
            <textarea
              className="ui-input"
              rows={2}
              value={form.instructions}
              onChange={set('instructions')}
            />
          </Field>
        </div>
      </div>
      <FormActions
        onClose={onClose}
        saving={saving}
        label="Create schedule"
        onSubmit={() => onSubmit(form)}
      />
    </InlineForm>
  );
}

function CompleteScheduleForm({
  schedule,
  options,
  saving,
  onClose,
  onSubmit,
}: {
  schedule: MaintenanceSchedule;
  options: AssetOptions | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    completedDate: today(),
    description: `${schedule.name} — scheduled preventive maintenance`,
    actionsTaken: '',
    partsUsed: '',
    downtimeHours: '',
    costKes: '0',
    expenseAccountId: '',
    creditAccountId: '',
    technician: schedule.assignedTechnician ?? '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <InlineForm title={`Record service — ${schedule.assetCode}`} onClose={onClose} saving={saving}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Completion date">
          <input
            className="ui-input"
            type="date"
            value={form.completedDate}
            onChange={set('completedDate')}
          />
        </Field>
        <Field label="Technician">
          <input className="ui-input" value={form.technician} onChange={set('technician')} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Work done">
            <textarea
              className="ui-input"
              rows={2}
              value={form.actionsTaken}
              onChange={set('actionsTaken')}
            />
          </Field>
        </div>
        <Field label="Parts used">
          <input className="ui-input" value={form.partsUsed} onChange={set('partsUsed')} />
        </Field>
        <Field label="Downtime (hours)">
          <input
            className="ui-input"
            inputMode="decimal"
            value={form.downtimeHours}
            onChange={set('downtimeHours')}
          />
        </Field>
        <Field label="Cost (KES)">
          <input
            className="ui-input"
            inputMode="decimal"
            value={form.costKes}
            onChange={set('costKes')}
          />
        </Field>
        {Number(form.costKes) > 0 && (
          <>
            <Field label="Expense account">
              <AccountSelect
                value={form.expenseAccountId}
                onChange={set('expenseAccountId')}
                options={options}
              />
            </Field>
            <Field label="Payment / credit account">
              <AccountSelect
                value={form.creditAccountId}
                onChange={set('creditAccountId')}
                options={options}
              />
            </Field>
          </>
        )}
      </div>
      <FormActions
        onClose={onClose}
        saving={saving}
        label="Record completion"
        onSubmit={() => onSubmit(form)}
      />
    </InlineForm>
  );
}

function CorrectiveForm({
  assets,
  initialAsset,
  saving,
  onClose,
  onSubmit,
}: {
  assets: AssetRow[];
  initialAsset: AssetRow;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    assetId: String(initialAsset.id),
    reportedDate: today(),
    priority: 'MEDIUM',
    problemDescription: '',
    assignedTechnician: '',
    vendor: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <InlineForm title="Report a fault" onClose={onClose} saving={saving}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Asset">
          <select className="ui-select" value={form.assetId} onChange={set('assetId')}>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.assetCode} — {asset.assetName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reported date">
          <input
            className="ui-input"
            type="date"
            value={form.reportedDate}
            onChange={set('reportedDate')}
          />
        </Field>
        <Field label="Priority">
          <select className="ui-select" value={form.priority} onChange={set('priority')}>
            {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Technician">
          <input
            className="ui-input"
            value={form.assignedTechnician}
            onChange={set('assignedTechnician')}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Fault description">
            <textarea
              className="ui-input"
              rows={3}
              value={form.problemDescription}
              onChange={set('problemDescription')}
            />
          </Field>
        </div>
      </div>
      <FormActions
        onClose={onClose}
        saving={saving}
        label="Report fault"
        onSubmit={() => onSubmit(form)}
      />
    </InlineForm>
  );
}

function CompleteCorrectiveForm({
  job,
  options,
  saving,
  onClose,
  onSubmit,
}: {
  job: MaintenanceJob;
  options: AssetOptions | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    completedDate: today(),
    repairActions: '',
    partsUsed: '',
    downtimeHours: '',
    costKes: '0',
    expenseAccountId: '',
    creditAccountId: '',
    assignedTechnician: job.assignedTechnician ?? '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <InlineForm title={`Complete repair — ${job.assetCode}`} onClose={onClose} saving={saving}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Completion date">
          <input
            className="ui-input"
            type="date"
            value={form.completedDate}
            onChange={set('completedDate')}
          />
        </Field>
        <Field label="Technician">
          <input
            className="ui-input"
            value={form.assignedTechnician}
            onChange={set('assignedTechnician')}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Repair actions">
            <textarea
              className="ui-input"
              rows={3}
              value={form.repairActions}
              onChange={set('repairActions')}
            />
          </Field>
        </div>
        <Field label="Parts used">
          <input className="ui-input" value={form.partsUsed} onChange={set('partsUsed')} />
        </Field>
        <Field label="Downtime (hours)">
          <input
            className="ui-input"
            inputMode="decimal"
            value={form.downtimeHours}
            onChange={set('downtimeHours')}
          />
        </Field>
        <Field label="Repair cost (KES)">
          <input
            className="ui-input"
            inputMode="decimal"
            value={form.costKes}
            onChange={set('costKes')}
          />
        </Field>
        {Number(form.costKes) > 0 && (
          <>
            <Field label="Expense account">
              <AccountSelect
                value={form.expenseAccountId}
                onChange={set('expenseAccountId')}
                options={options}
              />
            </Field>
            <Field label="Payment / credit account">
              <AccountSelect
                value={form.creditAccountId}
                onChange={set('creditAccountId')}
                options={options}
              />
            </Field>
          </>
        )}
      </div>
      <FormActions
        onClose={onClose}
        saving={saving}
        label="Complete repair"
        onSubmit={() => onSubmit(form)}
      />
    </InlineForm>
  );
}

function VerifyForm({
  job,
  saving,
  onClose,
  onSubmit,
}: {
  job: MaintenanceJob;
  saving: boolean;
  onClose: () => void;
  onSubmit: (notes: string) => void;
}) {
  const [notes, setNotes] = useState('');
  return (
    <InlineForm title={`Verify — ${job.assetCode}`} onClose={onClose} saving={saving}>
      <Field label="Verification notes">
        <textarea
          className="ui-input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <FormActions
        onClose={onClose}
        saving={saving}
        label="Verify completion"
        onSubmit={() => onSubmit(notes)}
      />
    </InlineForm>
  );
}

function AccountSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  options: AssetOptions | null;
}) {
  return (
    <select className="ui-select" value={value} onChange={onChange}>
      <option value="">Select account</option>
      {(options?.accounts ?? []).map((account) => (
        <option key={account.id} value={account.id}>
          {account.code} — {account.name}
        </option>
      ))}
    </select>
  );
}

function InlineForm({
  title,
  children,
  onClose,
  saving,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  saving: boolean;
}) {
  return (
    <section className="ui-summary-card" aria-label={title}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <SecondaryButton onClick={onClose} disabled={saving}>
          <XCircle size={15} /> Cancel
        </SecondaryButton>
      </div>
      {children}
    </section>
  );
}

function FormActions({
  onClose,
  saving,
  label,
  onSubmit,
}: {
  onClose: () => void;
  saving: boolean;
  label: string;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-3 flex justify-end gap-2">
      <SecondaryButton onClick={onClose} disabled={saving}>
        Cancel
      </SecondaryButton>
      <PrimaryButton onClick={onSubmit} disabled={saving}>
        <Save size={15} /> {label}
      </PrimaryButton>
    </div>
  );
}

/* ============================================================
   INSPECTIONS
   ============================================================ */

export function InspectionsPanel({
  facilityId,
  assets,
  saving,
  can,
  run,
  notify,
  refresh,
}: PanelProps) {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [completing, setCompleting] = useState<Inspection | null>(null);

  const load = useCallback(async () => {
    if (!facilityId) return;
    setError(null);
    try {
      setInspections(await fixedAssetsClient.getInspections(facilityId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Inspections could not be loaded.');
    }
  }, [facilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  const canInspect = can('assets.inspections.perform') || can('assets.manage');

  return (
    <div className="ui-module-stack">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Asset inspections</h2>
        {canInspect && (
          <SecondaryButton onClick={() => setScheduleOpen(true)} disabled={!assets.length}>
            <CalendarCheck size={15} /> Schedule inspection
          </SecondaryButton>
        )}
      </div>

      {inspections.length === 0 ? (
        <EmptyState
          title="No inspection recorded"
          description="Inspections record condition, findings, recommendations and the next inspection date."
        />
      ) : (
        <DataTable className="table-quiet">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Date</th>
              <th>Inspector</th>
              <th>Condition</th>
              <th>Findings</th>
              <th>Next</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {inspections.map((inspection) => (
              <tr key={inspection.id}>
                <td>
                  {inspection.assetCode}
                  <div className="text-xs text-muted">{inspection.assetName}</div>
                </td>
                <td>{inspection.inspectionDate}</td>
                <td>{inspection.inspectorName ?? '—'}</td>
                <td>{inspection.conditionAssessment ?? '—'}</td>
                <td className="max-w-xs truncate" title={inspection.findings ?? ''}>
                  {inspection.findings ?? '—'}
                </td>
                <td>{inspection.nextInspectionDate ?? '—'}</td>
                <td>
                  <StatusBadge tone={statusTone(inspection.status)}>
                    {inspection.status}
                  </StatusBadge>
                </td>
                <td>
                  {canInspect && inspection.status === 'PLANNED' && (
                    <PrimaryButton onClick={() => setCompleting(inspection)}>
                      Complete
                    </PrimaryButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {scheduleOpen && (
        <InspectionForm
          assets={assets}
          saving={saving}
          onClose={() => setScheduleOpen(false)}
          onSubmit={(body) =>
            run(async () => {
              await fixedAssetsClient.createInspection(facilityId, body);
              notify('Inspection scheduled.', 'success');
              setScheduleOpen(false);
              await load();
              await refresh();
            })
          }
        />
      )}

      {completing && (
        <CompleteInspectionForm
          inspection={completing}
          saving={saving}
          onClose={() => setCompleting(null)}
          onSubmit={(body) =>
            run(async () => {
              await fixedAssetsClient.completeInspection(facilityId, completing.id, body);
              notify('Inspection completed and history kept.', 'success');
              setCompleting(null);
              await load();
              await refresh();
            })
          }
        />
      )}
    </div>
  );
}

function InspectionForm({
  assets,
  saving,
  onClose,
  onSubmit,
}: {
  assets: AssetRow[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    assetId: String(assets[0]?.id ?? ''),
    inspectionDate: today(),
    inspectorName: '',
    status: 'PLANNED',
    checklist: 'Electrical safety|PENDING\nPhysical condition|PENDING',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const checklist = form.checklist
    .split('\n')
    .map((line) => line.split('|'))
    .filter(([item]) => item?.trim())
    .map(([item, result]) => ({ item: item.trim(), result: (result ?? 'PENDING').trim() }));

  return (
    <InlineForm title="Schedule inspection" onClose={onClose} saving={saving}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Asset">
          <select className="ui-select" value={form.assetId} onChange={set('assetId')}>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.assetCode} — {asset.assetName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Inspection date">
          <input
            className="ui-input"
            type="date"
            value={form.inspectionDate}
            onChange={set('inspectionDate')}
          />
        </Field>
        <Field label="Inspector">
          <input className="ui-input" value={form.inspectorName} onChange={set('inspectorName')} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Checklist" hint="One item per line as “item|result”.">
            <textarea
              className="ui-input"
              rows={4}
              value={form.checklist}
              onChange={set('checklist')}
            />
          </Field>
        </div>
      </div>
      <FormActions
        onClose={onClose}
        saving={saving}
        label="Schedule"
        onSubmit={() => onSubmit({ ...form, checklist })}
      />
    </InlineForm>
  );
}

function CompleteInspectionForm({
  inspection,
  saving,
  onClose,
  onSubmit,
}: {
  inspection: Inspection;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    inspectorName: inspection.inspectorName ?? '',
    conditionAssessment: 'GOOD',
    findings: '',
    recommendations: '',
    followUpActions: '',
    nextInspectionDate: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <InlineForm
      title={`Complete inspection — ${inspection.assetCode}`}
      onClose={onClose}
      saving={saving}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Inspector">
          <input className="ui-input" value={form.inspectorName} onChange={set('inspectorName')} />
        </Field>
        <Field label="Condition found">
          <select
            className="ui-select"
            value={form.conditionAssessment}
            onChange={set('conditionAssessment')}
          >
            {['GOOD', 'FAIR', 'POOR', 'UNDER_REPAIR'].map((condition) => (
              <option key={condition} value={condition}>
                {condition}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Findings">
            <textarea
              className="ui-input"
              rows={3}
              value={form.findings}
              onChange={set('findings')}
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Recommendations">
            <textarea
              className="ui-input"
              rows={2}
              value={form.recommendations}
              onChange={set('recommendations')}
            />
          </Field>
        </div>
        <Field label="Follow-up actions">
          <input
            className="ui-input"
            value={form.followUpActions}
            onChange={set('followUpActions')}
          />
        </Field>
        <Field label="Next inspection date">
          <input
            className="ui-input"
            type="date"
            value={form.nextInspectionDate}
            onChange={set('nextInspectionDate')}
          />
        </Field>
      </div>
      <FormActions
        onClose={onClose}
        saving={saving}
        label="Complete inspection"
        onSubmit={() => onSubmit(form)}
      />
    </InlineForm>
  );
}

/* ============================================================
   REPORTS
   ============================================================ */

export function AssetReportsPanel({
  facilityId,
  categories,
  options,
  assets,
  run,
  notify,
}: PanelProps) {
  const [catalogue, setCatalogue] = useState<AssetReportCatalogueEntry[]>([]);
  const [key, setKey] = useState('register');
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [report, setReport] = useState<AssetReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!facilityId) return;
    void (async () => {
      try {
        const response = await fixedAssetsClient.getAssetReports(facilityId);
        setCatalogue(response.reports);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'The report list could not be loaded.');
      }
    })();
  }, [facilityId]);

  const definition = useMemo(
    () => catalogue.find((entry) => entry.key === key) ?? null,
    [catalogue, key],
  );

  const filters = () => ({
    period: definition?.needsPeriod ? period : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    categoryId: categoryId ? Number(categoryId) : undefined,
    departmentId: departmentId ? Number(departmentId) : undefined,
    assetId: assetId ? Number(assetId) : undefined,
  });

  const generate = () =>
    run(async () => {
      try {
        setReport(await fixedAssetsClient.runAssetReport(facilityId, key, filters()));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'The report could not be generated.');
      }
    });

  const exportAs = (format: 'pdf' | 'xlsx') =>
    run(async () => {
      try {
        const output = await fixedAssetsClient.exportAssetReport(
          facilityId,
          key,
          format,
          filters(),
        );
        download(output.base64, output.filename, output.contentType);
        notify(
          `${format === 'pdf' ? 'PDF' : 'Excel'} export generated from the same rows.`,
          'success',
        );
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'The export could not be generated.');
      }
    });

  if (error) return <ErrorState message={error} onRetry={() => setError(null)} />;

  return (
    <div className="ui-module-stack">
      <FilterToolbar>
        <select
          className="ui-select"
          aria-label="Report"
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            setReport(null);
          }}
        >
          {catalogue.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.title}
            </option>
          ))}
        </select>
        {definition?.needsPeriod && (
          <input
            className="ui-input"
            type="month"
            aria-label="Report period"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        )}
        <input
          className="ui-input"
          type="date"
          aria-label="From date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
        />
        <input
          className="ui-input"
          type="date"
          aria-label="To date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
        />
        <select
          className="ui-select"
          aria-label="Filter by category"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <select
          className="ui-select"
          aria-label="Filter by department"
          value={departmentId}
          onChange={(event) => setDepartmentId(event.target.value)}
        >
          <option value="">All departments</option>
          {(options?.departments ?? []).map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
        <select
          className="ui-select"
          aria-label="Filter by asset"
          value={assetId}
          onChange={(event) => setAssetId(event.target.value)}
        >
          <option value="">All assets</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.assetCode} — {asset.assetName}
            </option>
          ))}
        </select>
        <PrimaryButton onClick={generate}>Run report</PrimaryButton>
        {report && (
          <>
            <SecondaryButton onClick={() => exportAs('pdf')}>
              <FileText size={15} /> PDF
            </SecondaryButton>
            <SecondaryButton onClick={() => exportAs('xlsx')}>
              <Download size={15} /> Excel
            </SecondaryButton>
          </>
        )}
      </FilterToolbar>

      {!definition ? (
        <LoadingSkeleton rows={3} />
      ) : (
        <p className="text-xs text-muted">{definition.description}</p>
      )}

      {!report ? (
        <EmptyState
          title="Choose a report"
          description="Set the filters and run the report. The PDF and Excel exports contain the same rows."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">
              {report.title} — {report.facilityName}
            </h2>
            <StatusBadge tone="neutral">{report.filterSummary}</StatusBadge>
            <span className="text-xs text-muted">{report.rows.length} row(s)</span>
          </div>
          {report.totals && (
            <div className="flex flex-wrap gap-3 text-xs">
              {Object.entries(report.totals).map(([key, value]) => (
                <span key={key} className="ui-status ui-tone-neutral">
                  {key.replace(/([A-Z])/g, ' $1').toLowerCase()}: {String(value)}
                </span>
              ))}
            </div>
          )}
          {report.rows.length === 0 ? (
            <EmptyState
              title="No rows"
              description={report.notes.join(' ') || 'No record matched.'}
            />
          ) : (
            <DataTable className="table-quiet">
              <thead>
                <tr>
                  {report.columns.map((column) => (
                    <th
                      key={column.key}
                      className={
                        column.kind === 'money' || column.kind === 'number' ? 'text-right' : ''
                      }
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, index) => (
                  <tr key={index}>
                    {report.columns.map((column) => {
                      const value = row[column.key];
                      return (
                        <td
                          key={column.key}
                          className={
                            column.kind === 'money' || column.kind === 'number'
                              ? 'text-right tabular-nums'
                              : ''
                          }
                        >
                          {column.kind === 'money' && value !== null && value !== undefined
                            ? kesValue(String(value))
                            : (value ?? '—')}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          {report.notes.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-muted">
              {report.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================
   CONFIGURATION
   ============================================================ */

export function AssetConfigurationPanel({
  facilityId,
  saving,
  can,
  run,
  notify,
  refresh,
}: PanelProps) {
  const [settings, setSettings] = useState<DepreciationSettings | null>(null);
  const [form, setForm] = useState({
    defaultUsefulLifeMonths: '120',
    defaultAnnualRateBps: '1000',
    depreciationCommencement: 'FULL_MONTH',
    depreciationApprovalRequired: 'true',
    financialYearStartMonth: '7',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!facilityId) return;
    void (async () => {
      try {
        const policy = await fixedAssetsClient.getDepreciationSettings(facilityId);
        setSettings(policy);
        setForm({
          defaultUsefulLifeMonths: String(policy.defaultUsefulLifeMonths),
          defaultAnnualRateBps: String(policy.defaultAnnualRateBps),
          depreciationCommencement: policy.depreciationCommencement,
          depreciationApprovalRequired: String(policy.depreciationApprovalRequired),
          financialYearStartMonth: String(policy.financialYearStartMonth),
        });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'The policy could not be loaded.');
      }
    })();
  }, [facilityId]);

  if (error) return <ErrorState message={error} onRetry={() => setError(null)} />;
  if (!settings) return <LoadingSkeleton rows={3} />;

  const rate = Number(form.defaultAnnualRateBps) / 100;
  return (
    <div className="ui-module-stack">
      <AlertBanner tone={settings.configured ? 'info' : 'warning'}>
        {settings.configured
          ? `Saved policy, last updated ${settings.updatedAt ? new Date(settings.updatedAt).toLocaleString() : 'unknown'}.`
          : 'Not yet saved. The screens default to the documented policy, but an authorised user must review and save it.'}
      </AlertBanner>

      <section aria-labelledby="policy-form">
        <h2 id="policy-form" className="text-sm font-semibold">
          Depreciation policy
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Default useful life (months)">
            <input
              className="ui-input"
              inputMode="numeric"
              value={form.defaultUsefulLifeMonths}
              onChange={(event) =>
                setForm((current) => ({ ...current, defaultUsefulLifeMonths: event.target.value }))
              }
            />
          </Field>
          <Field label="Annual rate (basis points)" hint={`${rate.toFixed(2)}% a year`}>
            <input
              className="ui-input"
              inputMode="numeric"
              value={form.defaultAnnualRateBps}
              onChange={(event) =>
                setForm((current) => ({ ...current, defaultAnnualRateBps: event.target.value }))
              }
            />
          </Field>
          <Field label="Commencement convention">
            <select
              className="ui-select"
              value={form.depreciationCommencement}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  depreciationCommencement: event.target.value,
                }))
              }
            >
              <option value="FULL_MONTH">Full month of service</option>
              <option value="FOLLOWING_MONTH">Following month</option>
              <option value="DAILY_PRORATA">Daily pro-rata</option>
            </select>
          </Field>
          <Field label="Approval before posting">
            <select
              className="ui-select"
              value={form.depreciationApprovalRequired}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  depreciationApprovalRequired: event.target.value,
                }))
              }
            >
              <option value="true">Required (recommended)</option>
              <option value="false">Preparer may post</option>
            </select>
          </Field>
          <Field label="Financial year starts (month)">
            <input
              className="ui-input"
              inputMode="numeric"
              value={form.financialYearStartMonth}
              onChange={(event) =>
                setForm((current) => ({ ...current, financialYearStartMonth: event.target.value }))
              }
            />
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <PrimaryButton
            disabled={saving || !can('assets.depreciation.configure')}
            onClick={() =>
              run(async () => {
                await fixedAssetsClient.updateDepreciationSettings(facilityId, {
                  defaultUsefulLifeMonths: Number(form.defaultUsefulLifeMonths),
                  defaultAnnualRateBps: Number(form.defaultAnnualRateBps),
                  depreciationCommencement: form.depreciationCommencement,
                  depreciationApprovalRequired: form.depreciationApprovalRequired === 'true',
                  financialYearStartMonth: Number(form.financialYearStartMonth),
                });
                notify('Depreciation policy saved.', 'success');
                setSettings(await fixedAssetsClient.getDepreciationSettings(facilityId));
                await refresh();
              })
            }
          >
            <Save size={15} /> Save policy
          </PrimaryButton>
        </div>
        {!can('assets.depreciation.configure') && (
          <p className="text-xs text-muted">
            You can read the policy but not change it. Ask for the “Configure Depreciation Policy”
            permission.
          </p>
        )}
      </section>

      <section aria-labelledby="policy-scope">
        <h2 id="policy-scope" className="text-sm font-semibold">
          What this policy does not cover
        </h2>
        <ul className="list-disc pl-5 text-xs text-muted">
          <li>
            The 6% employee and 6% employer contributions discussed for payroll are payroll items.
            They are not depreciation inputs and this module never applies them.
          </li>
          <li>
            Kenyan tax depreciation (capital allowances) is configured separately under tax rates
            and is not the book depreciation shown here.
          </li>
        </ul>
      </section>
    </div>
  );
}

/* ============================================================
   ASSET DETAIL OPERATIONS
   ============================================================ */

type DetailTab =
  | 'overview'
  | 'acquisition'
  | 'depreciation'
  | 'maintenance'
  | 'inspections'
  | 'accounting'
  | 'documents'
  | 'audit';

export type AssetMovementRow = {
  id: number;
  movementDate: string;
  movementType: string;
  amountKes: string;
  netBookValueAfterKes: string;
  journalEntryId: number | null;
  notes: string | null;
};

export function AssetOperationsPanel({
  facilityId,
  assetId,
  can,
  saving,
  run,
  notify,
  refresh,
  movements = [],
}: {
  facilityId: number;
  assetId: number;
  can: (permission: string) => boolean;
  saving: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  notify: (message: string, tone?: 'success' | 'error') => void;
  refresh: () => Promise<void>;
  movements?: AssetMovementRow[];
}) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [operations, setOperations] = useState<AssetOperations | null>(null);
  const [schedule, setSchedule] = useState<Awaited<
    ReturnType<typeof fixedAssetsClient.getAssetSchedule>
  > | null>(null);
  const [statusChange, setStatusChange] = useState({
    status: '',
    effectiveDate: today(),
    reason: '',
  });

  const load = useCallback(async () => {
    if (!facilityId || !assetId) return;
    setOperations(await fixedAssetsClient.getAssetOperations(facilityId, assetId));
  }, [facilityId, assetId]);

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch {
        // The register row is still usable if the operations call fails.
      }
    })();
  }, [load]);

  useEffect(() => {
    if (tab !== 'depreciation') return;
    void (async () => {
      try {
        setSchedule(await fixedAssetsClient.getAssetSchedule(facilityId, assetId, 24));
      } catch {
        setSchedule(null);
      }
    })();
  }, [tab, facilityId, assetId]);

  if (!operations) return <LoadingSkeleton rows={3} />;

  const canManage = can('assets.manage');

  return (
    <div className="mt-4">
      <Tabs
        items={[
          { id: 'overview', label: 'Overview' },
          { id: 'acquisition', label: 'Acquisition' },
          { id: 'depreciation', label: 'Depreciation' },
          { id: 'maintenance', label: 'Maintenance' },
          { id: 'inspections', label: 'Inspections' },
          { id: 'accounting', label: 'Accounting' },
          { id: 'documents', label: 'Documents' },
          { id: 'audit', label: 'Audit history' },
        ]}
        value={tab}
        onChange={(id) => setTab(id as DetailTab)}
        label="Asset detail sections"
        idPrefix={`asset-detail-${assetId}`}
      />

      {tab === 'overview' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Schedules"
            value={operations.summary.activeSchedules}
            detail={`${operations.summary.overdueSchedules} overdue`}
            icon={<CalendarClock size={18} />}
          />
          <StatCard
            label="Open repairs"
            value={operations.summary.openCorrectiveJobs}
            detail={`${operations.summary.completedMaintenance} completed`}
            icon={<Wrench size={18} />}
          />
          <StatCard
            label="Maintenance spend"
            value={`KES ${money(operations.summary.totalMaintenanceCostCents)}`}
            detail={`Last inspection ${operations.summary.lastInspectionDate ?? 'not recorded'}`}
            icon={<CircleDollarSign size={18} />}
          />
        </div>
      )}

      {tab === 'acquisition' && (
        <ul className="space-y-1 text-sm">
          {operations.lifecycle
            .filter((event) =>
              ['REGISTRATION', 'REGISTERED', 'ACTIVATION', 'ACTIVATED'].includes(event.eventType),
            )
            .map((event) => (
              <li key={event.id}>
                {event.effectiveDate} · {event.eventType} · {event.reason}
              </li>
            ))}
          {operations.lifecycle.filter((event) => event.eventType.startsWith('TRANSFER')).length ===
            0 && (
            <li className="text-xs text-muted">
              No acquisition event has been recorded beyond the register row.
            </li>
          )}
        </ul>
      )}

      {tab === 'depreciation' && (
        <div>
          {!schedule ? (
            <p className="text-xs text-muted">The schedule could not be loaded.</p>
          ) : (
            <>
              <p className="text-xs text-muted">
                {schedule.asset.method} · {schedule.asset.usefulLifeMonths} months ·{' '}
                {(Number(schedule.asset.annualRateBps) / 100).toFixed(2)}% p.a. ·{' '}
                {schedule.asset.convention} (
                {String(schedule.asset.conventionSource).toLowerCase().replace('_', ' ')})
              </p>
              <DataTable className="table-quiet">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th className="text-right">Opening accumulated</th>
                    <th className="text-right">Charge</th>
                    <th className="text-right">Closing accumulated</th>
                    <th className="text-right">Closing book value</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.rows.map((row) => (
                    <tr key={row.period}>
                      <td>{row.period}</td>
                      <td className="text-right tabular-nums">
                        {money(row.openingAccumulatedCents)}
                      </td>
                      <td className="text-right tabular-nums">{money(row.chargeCents)}</td>
                      <td className="text-right tabular-nums">
                        {money(row.closingAccumulatedCents)}
                      </td>
                      <td className="text-right tabular-nums">
                        {money(row.closingBookValueCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </>
          )}
        </div>
      )}

      {tab === 'maintenance' && (
        <div className="space-y-4">
          {operations.schedules.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                Preventive schedules
              </h3>
              <DataTable className="table-quiet">
                <thead>
                  <tr>
                    <th>Schedule</th>
                    <th>Frequency</th>
                    <th>Next due</th>
                    <th>Last completed</th>
                    <th>Technician</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.schedules.map((schedule) => (
                    <tr key={schedule.id}>
                      <td>{schedule.name}</td>
                      <td>
                        {schedule.frequency === 'CUSTOM'
                          ? `Every ${schedule.intervalDays} days`
                          : schedule.frequency}
                      </td>
                      <td>{schedule.nextDueDate}</td>
                      <td>{schedule.lastCompletedDate ?? '—'}</td>
                      <td>{schedule.assignedTechnician ?? schedule.vendor ?? '—'}</td>
                      <td>
                        <StatusBadge tone={schedule.status === 'OVERDUE' ? 'error' : 'neutral'}>
                          {schedule.status}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          )}
          <DataTable className="table-quiet">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Work</th>
                <th className="text-right">Cost (KES)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {operations.jobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-xs text-muted">
                    No maintenance recorded.
                  </td>
                </tr>
              ) : (
                operations.jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.maintenanceDate}</td>
                    <td>{job.maintenanceType}</td>
                    <td>{job.repairActions ?? job.problemDescription ?? job.description}</td>
                    <td className="text-right tabular-nums">{kesValue(job.costKes)}</td>
                    <td>
                      <StatusBadge tone={statusTone(job.status)}>{job.status}</StatusBadge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </div>
      )}

      {tab === 'inspections' && (
        <DataTable className="table-quiet">
          <thead>
            <tr>
              <th>Date</th>
              <th>Inspector</th>
              <th>Condition</th>
              <th>Findings</th>
              <th>Next</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {operations.inspections.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-xs text-muted">
                  No inspection recorded.
                </td>
              </tr>
            ) : (
              operations.inspections.map((inspection) => (
                <tr key={inspection.id}>
                  <td>{inspection.inspectionDate}</td>
                  <td>{inspection.inspectorName ?? '—'}</td>
                  <td>{inspection.conditionAssessment ?? '—'}</td>
                  <td className="max-w-xs truncate">{inspection.findings ?? '—'}</td>
                  <td>{inspection.nextInspectionDate ?? '—'}</td>
                  <td>
                    <StatusBadge tone={statusTone(inspection.status)}>
                      {inspection.status}
                    </StatusBadge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      )}

      {tab === 'accounting' && (
        <div className="space-y-4">
          <DataTable className="table-quiet">
            <thead>
              <tr>
                <th>Date</th>
                <th>Movement</th>
                <th className="text-right">Amount (KES)</th>
                <th className="text-right">Net book after</th>
                <th>Journal</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-xs text-muted">
                    No movement recorded for this asset.
                  </td>
                </tr>
              ) : (
                movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{movement.movementDate}</td>
                    <td>{movement.movementType}</td>
                    <td className="text-right tabular-nums">{kesValue(movement.amountKes)}</td>
                    <td className="text-right tabular-nums">
                      {kesValue(movement.netBookValueAfterKes)}
                    </td>
                    <td>{movement.journalEntryId ?? '—'}</td>
                    <td className="max-w-xs truncate">{movement.notes ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
          <ul className="space-y-1 text-sm">
            {operations.lifecycle
              .filter((event) => event.journalEntryId)
              .map((event) => (
                <li key={event.id}>
                  {event.effectiveDate} · {event.eventType} · journal {event.journalEntryId} ·{' '}
                  {event.reason}
                </li>
              ))}
            {operations.lifecycle.every((event) => !event.journalEntryId) && (
              <li className="text-xs text-muted">
                No lifecycle event carries a journal link. The movement table above lists every
                journal this asset has posted.
              </li>
            )}
          </ul>
        </div>
      )}

      {tab === 'documents' && (
        <AssetDocuments
          assetId={assetId}
          facilityId={facilityId}
          canManage={canManage}
          saving={saving}
          run={run}
          notify={notify}
          refresh={async () => {
            await load();
            await refresh();
          }}
        />
      )}

      {tab === 'audit' && (
        <DataTable className="table-quiet">
          <thead>
            <tr>
              <th>Date</th>
              <th>Event</th>
              <th>From</th>
              <th>To</th>
              <th>Reason</th>
              <th>Recorded</th>
            </tr>
          </thead>
          <tbody>
            {operations.lifecycle.map((event) => (
              <tr key={event.id}>
                <td>{event.effectiveDate}</td>
                <td>{event.eventType}</td>
                <td>{event.fromStatus ?? '—'}</td>
                <td>{event.toStatus ?? '—'}</td>
                <td>{event.reason}</td>
                <td>{new Date(event.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {canManage && tab === 'audit' && (
        <section className="mt-4" aria-labelledby={`status-change-${assetId}`}>
          <h3 id={`status-change-${assetId}`} className="text-sm font-semibold">
            Change status
          </h3>
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="New status">
              <select
                className="ui-select"
                value={statusChange.status}
                onChange={(event) =>
                  setStatusChange((current) => ({ ...current, status: event.target.value }))
                }
              >
                <option value="">Select</option>
                {[
                  'ACTIVE',
                  'UNDER_MAINTENANCE',
                  'TEMPORARILY_UNAVAILABLE',
                  'IMPAIRED',
                  'RETIRED',
                ].map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Effective date">
              <input
                className="ui-input"
                type="date"
                value={statusChange.effectiveDate}
                onChange={(event) =>
                  setStatusChange((current) => ({ ...current, effectiveDate: event.target.value }))
                }
              />
            </Field>
            <Field label="Reason">
              <input
                className="ui-input"
                value={statusChange.reason}
                onChange={(event) =>
                  setStatusChange((current) => ({ ...current, reason: event.target.value }))
                }
              />
            </Field>
            <div className="flex items-end">
              <PrimaryButton
                disabled={saving || !statusChange.status || statusChange.reason.trim().length < 3}
                onClick={() =>
                  run(async () => {
                    await fixedAssetsClient.changeAssetStatus(facilityId, assetId, statusChange);
                    notify('Status changed and recorded in the audit history.', 'success');
                    setStatusChange({ status: '', effectiveDate: today(), reason: '' });
                    await load();
                    await refresh();
                  })
                }
              >
                Record change
              </PrimaryButton>
            </div>
          </div>
          <p className="text-xs text-muted">
            Disposal is not a status edit: it posts the journal that removes cost and accumulated
            depreciation, so it stays in the disposal workflow.
          </p>
        </section>
      )}
    </div>
  );
}

function AssetDocuments({
  assetId,
  facilityId,
  canManage,
  saving,
  run,
  notify,
  refresh,
}: {
  assetId: number;
  facilityId: number;
  canManage: boolean;
  saving: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  notify: (message: string, tone?: 'success' | 'error') => void;
  refresh: () => Promise<void>;
}) {
  const [documents, setDocuments] = useState<AssetDocument[]>([]);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('CERTIFICATE');
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setDocuments(await fixedAssetsClient.getAssetDocuments(facilityId, assetId));
  }, [facilityId, assetId]);

  useEffect(() => {
    void load().catch(() => setDocuments([]));
  }, [load]);

  const upload = () => {
    if (!file) return;
    void run(async () => {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      await fixedAssetsClient.uploadAssetDocument(facilityId, assetId, {
        title: title || file.name,
        documentType: type,
        filename: file.name,
        mimeType: file.type || 'application/pdf',
        contentBase64: base64,
      });
      notify('Document stored with its checksum.', 'success');
      setTitle('');
      setFile(null);
      await refresh();
      await load();
    });
  };

  return (
    <div>
      {canManage && (
        <div className="mb-3 grid gap-2 sm:grid-cols-4">
          <Field label="Title">
            <input
              className="ui-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label="Type">
            <input
              className="ui-input"
              value={type}
              onChange={(event) => setType(event.target.value)}
            />
          </Field>
          <Field label="File" hint="PDF, PNG, JPEG or WebP up to 8 MB.">
            <input
              className="ui-input"
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="flex items-end">
            <PrimaryButton onClick={upload} disabled={saving || !file}>
              Upload
            </PrimaryButton>
          </div>
        </div>
      )}
      {documents.length === 0 ? (
        <p className="text-xs text-muted">No document attached.</p>
      ) : (
        <DataTable className="table-quiet">
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>File</th>
              <th className="text-right">Size</th>
              <th>Checksum</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.id}>
                <td>{document.title}</td>
                <td>{document.documentType}</td>
                <td>{document.filename}</td>
                <td className="text-right tabular-nums">{document.byteSize}</td>
                <td className="text-xs text-muted">{document.sha256.slice(0, 12)}…</td>
                <td>
                  <SecondaryButton
                    onClick={() =>
                      void run(async () => {
                        const stored = await fixedAssetsClient.getAssetDocument(
                          facilityId,
                          document.id,
                        );
                        download(stored.base64, stored.filename, stored.mimeType);
                      })
                    }
                  >
                    <Download size={15} /> Download
                  </SecondaryButton>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
