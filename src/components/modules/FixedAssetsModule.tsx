import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes,
  Building2,
  Coins,
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  Landmark,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Send,
  Scale,
  Trash2,
  TrendingDown,
  UserRound,
  Wrench,
} from 'lucide-react';

import { ApiError } from '../../api/client.ts';
import {
  fixedAssetsClient,
  type AssetCategory,
  type AssetDetail,
  type AssetMaintenanceRow,
  type AssetOptions,
  type AssetOverview,
  type AssetRegisterRow,
  type AssetRow,
  type DepreciationPreviewRow,
  type TaxRate,
  type TaxScheduleRow,
} from '../../api/clients/fixed-assets.client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { formatCents } from '../../billing/settlement.ts';
import { totalPendingChargeCents } from '../../assets/depreciation.ts';
import { PrimaryButton, SearchBar, SecondaryButton, Tabs } from '../ui/controls.tsx';
import {
  AlertBanner,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatusBadge,
} from '../ui/feedback.tsx';
import { Modal } from '../ui/overlays.tsx';
import { DataTable, FilterToolbar, PageHeader, StatCard } from '../ui/layout.tsx';

type TabId = 'register' | 'categories' | 'maintenance' | 'depreciation';

const toCents = (kes: string) => Math.round(Number(kes) * 100);

export const FixedAssetsModule: React.FC = () => {
  const { authenticatedUser, currentFacility, showToast, refreshKey, triggerRefresh } = useHmis();
  const facilityId = currentFacility?.id ?? 0;
  const permissions = authenticatedUser?.permissions ?? [];
  const canManage = permissions.includes('assets.manage');
  const canDepreciate = permissions.includes('assets.depreciate');
  const canDispose = permissions.includes('assets.dispose');

  const [tab, setTab] = useState<TabId>('register');
  const [overview, setOverview] = useState<AssetOverview | null>(null);
  const [options, setOptions] = useState<AssetOptions | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [maintenance, setMaintenance] = useState<AssetMaintenanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [completeJob, setCompleteJob] = useState<AssetMaintenanceRow | null>(null);
  const [transferFor, setTransferFor] = useState<AssetRow | null>(null);
  const [disposeFor, setDisposeFor] = useState<AssetRow | null>(null);
  const [adjustFor, setAdjustFor] = useState<{
    asset: AssetRow;
    mode: 'IMPAIR' | 'REVALUE';
  } | null>(null);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [taxSchedule, setTaxSchedule] = useState<TaxScheduleRow[]>([]);
  const [taxOpen, setTaxOpen] = useState(false);
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [preview, setPreview] = useState<DepreciationPreviewRow[] | null>(null);
  const [report, setReport] = useState<AssetRegisterRow[]>([]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
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
    },
    [showToast],
  );

  const load = useCallback(async () => {
    if (!facilityId) return;
    setLoading(true);
    setError(null);
    try {
      const [summary, categoryRows, list, jobs, opts] = await Promise.all([
        fixedAssetsClient.getAssetOverview(facilityId),
        fixedAssetsClient.getAssetCategories(facilityId),
        fixedAssetsClient.getAssets(facilityId, {
          search: search || undefined,
          status: status || undefined,
          categoryId: categoryFilter ? Number(categoryFilter) : undefined,
          page,
        }),
        fixedAssetsClient.getMaintenance(facilityId),
        fixedAssetsClient.getAssetOptions(facilityId),
      ]);
      setOverview(summary);
      setCategories(categoryRows);
      setAssets(list.rows);
      setTotal(list.total);
      setMaintenance(jobs);
      setOptions(opts);
      setReport(await fixedAssetsClient.getAssetRegisterReport(facilityId));
      setTaxRates(await fixedAssetsClient.getTaxRates(facilityId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Fixed assets could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [facilityId, search, status, categoryFilter, page]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // `chargeCents` already arrives as integer cents, so it must never round-trip through KES.
  const previewCharge = useMemo(() => totalPendingChargeCents(preview ?? []), [preview]);

  async function openDetail(id: number) {
    await run(async () => {
      setDetail(await fixedAssetsClient.getAssetDetail(facilityId, id));
    });
  }

  return (
    <div className="ui-module-stack">
      <PageHeader>
        <div>
          <p className="ui-eyebrow">Finance &amp; assets</p>
          <h1 className="text-xl font-semibold text-ink">Fixed Assets</h1>
          <p className="text-sm text-muted">
            Asset register, custodianship, maintenance, depreciation and disposal for{' '}
            {currentFacility?.name ?? 'this facility'}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <PrimaryButton onClick={() => setRegisterOpen(true)} disabled={!options || saving}>
              <Plus size={15} /> Register asset
            </PrimaryButton>
          )}
          <SecondaryButton onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </SecondaryButton>
        </div>
      </PageHeader>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {overview && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Active assets"
            value={overview.activeCount}
            detail={`${overview.assetCount} in the register`}
            icon={<Boxes size={20} />}
          />
          <StatCard
            label="Acquisition cost"
            value={`KES ${formatCents(Number(overview.costCents))}`}
            detail="Capitalised cost of all assets"
            icon={<CircleDollarSign size={20} />}
          />
          <StatCard
            label="Accumulated depreciation"
            value={`KES ${formatCents(Number(overview.accumulatedCents))}`}
            detail="Posted to the general ledger"
            icon={<TrendingDown size={20} />}
          />
          <StatCard
            label="Net book value"
            value={`KES ${formatCents(Number(overview.netBookCents))}`}
            detail={`${overview.plannedMaintenance} maintenance job(s) planned`}
            icon={<Landmark size={20} />}
          />
        </div>
      )}

      <Tabs
        items={[
          { id: 'register', label: 'Asset register' },
          { id: 'categories', label: 'Categories & accounts' },
          { id: 'maintenance', label: 'Maintenance' },
          { id: 'depreciation', label: 'Depreciation & values' },
        ]}
        value={tab}
        onChange={(id) => setTab(id as TabId)}
        label="Fixed asset sections"
        idPrefix="fixed-assets"
      />

      {loading && !overview ? (
        <LoadingSkeleton rows={5} />
      ) : tab === 'register' ? (
        <section aria-labelledby="fixed-assets-register">
          <h2 id="fixed-assets-register" className="text-sm font-semibold">
            Asset register
          </h2>
          <FilterToolbar>
            <SearchBar
              aria-label="Search assets"
              placeholder="Search code, name or serial"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
            <select
              className="ui-select"
              aria-label="Filter by status"
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value);
              }}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="DISPOSED">Disposed</option>
            </select>
            <select
              className="ui-select"
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(event) => {
                setPage(1);
                setCategoryFilter(event.target.value);
              }}
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">
              {assets.length} of {total} shown · amounts in KES
            </span>
          </FilterToolbar>

          {assets.length === 0 ? (
            <EmptyState
              title="No assets match"
              description={
                canManage
                  ? 'Register the first asset to start the facility register.'
                  : 'Ask a facility administrator to register assets or change the filters.'
              }
            />
          ) : (
            <DataTable className="table-quiet">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Category</th>
                  <th>Location / custodian</th>
                  <th className="text-right">Cost</th>
                  <th className="text-right">Accum. dep.</th>
                  <th className="text-right">Net book</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      <div className="font-medium">{asset.assetName}</div>
                      <div className="text-xs text-muted">
                        {asset.assetCode}
                        {asset.serialNumber ? ` · ${asset.serialNumber}` : ''}
                      </div>
                    </td>
                    <td>{asset.category}</td>
                    <td>
                      <div>{asset.location || '—'}</div>
                      <div className="text-xs text-muted">
                        {asset.custodianName || 'Unassigned'}
                      </div>
                    </td>
                    <td className="text-right tabular-nums">
                      {formatCents(toCents(asset.acquisitionCostKes))}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatCents(toCents(asset.accumulatedDepreciationKes))}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatCents(toCents(asset.netBookValueKes))}
                    </td>
                    <td>
                      <StatusBadge tone={asset.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {asset.status}
                      </StatusBadge>
                    </td>
                    <td className="text-right">
                      <SecondaryButton onClick={() => void openDetail(asset.id)}>
                        View
                      </SecondaryButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}

          <div className="mt-3 flex items-center justify-between">
            <SecondaryButton disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              Previous
            </SecondaryButton>
            <span className="text-xs text-muted">Page {page}</span>
            <SecondaryButton
              disabled={page * 25 >= total}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </SecondaryButton>
          </div>
        </section>
      ) : tab === 'categories' ? (
        <section aria-labelledby="fixed-assets-categories">
          <div className="flex items-center justify-between">
            <h2 id="fixed-assets-categories" className="text-sm font-semibold">
              Categories and default accounts
            </h2>
            {canManage && (
              <PrimaryButton onClick={() => setCategoryOpen(true)} disabled={!options || saving}>
                <Plus size={15} /> New category
              </PrimaryButton>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">
            Each category supplies the asset, accumulated-depreciation and depreciation-expense
            accounts. Registering an asset against a category keeps its postings consistent.
          </p>
          {categories.length === 0 ? (
            <EmptyState
              title="No categories yet"
              description="Create a category with its ledger accounts before registering assets."
            />
          ) : (
            <DataTable className="table-quiet">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Useful life</th>
                  <th className="text-right">Assets</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td>
                      <div className="font-medium">{category.name}</div>
                      <div className="text-xs text-muted">{category.code}</div>
                    </td>
                    <td>{category.defaultUsefulLifeMonths} months</td>
                    <td className="text-right tabular-nums">{category.assetCount}</td>
                    <td>
                      <StatusBadge tone={category.isActive ? 'success' : 'neutral'}>
                        {category.isActive ? 'ACTIVE' : 'INACTIVE'}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>
      ) : tab === 'maintenance' ? (
        <section aria-labelledby="fixed-assets-maintenance">
          <div className="flex items-center justify-between">
            <h2 id="fixed-assets-maintenance" className="text-sm font-semibold">
              Maintenance history
            </h2>
            {canManage && (
              <PrimaryButton onClick={() => setMaintenanceOpen(true)} disabled={!options || saving}>
                <Wrench size={15} /> Plan maintenance
              </PrimaryButton>
            )}
          </div>
          {maintenance.length === 0 ? (
            <EmptyState
              title="No maintenance recorded"
              description="Plan preventive or corrective maintenance to keep the register complete."
            />
          ) : (
            <DataTable className="table-quiet">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Asset</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th className="text-right">Cost (KES)</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {maintenance.map((job) => (
                  <tr key={job.id}>
                    <td>{job.maintenanceDate}</td>
                    <td>
                      <div className="font-medium">{job.assetName}</div>
                      <div className="text-xs text-muted">{job.assetCode}</div>
                    </td>
                    <td>{job.maintenanceType}</td>
                    <td>
                      <div>{job.description}</div>
                      {job.vendor && <div className="text-xs text-muted">{job.vendor}</div>}
                    </td>
                    <td className="text-right tabular-nums">{formatCents(toCents(job.costKes))}</td>
                    <td>
                      <StatusBadge tone={job.status === 'COMPLETED' ? 'success' : 'warning'}>
                        {job.status}
                      </StatusBadge>
                    </td>
                    <td className="text-right">
                      {job.status === 'PLANNED' && canManage && (
                        <SecondaryButton onClick={() => setCompleteJob(job)}>
                          Complete
                        </SecondaryButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>
      ) : (
        <section aria-labelledby="fixed-assets-depreciation">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="fixed-assets-depreciation" className="text-sm font-semibold">
                Monthly depreciation
              </h2>
              <p className="text-xs text-muted">
                Straight-line over each asset&apos;s useful life. Charges stop at salvage value and
                post one balanced journal per period.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Accounting period</span>
                <input
                  className="ui-input"
                  aria-label="Depreciation accounting period"
                  style={{ minWidth: '11rem' }}
                  type="month"
                  value={period}
                  onChange={(event) => {
                    setPeriod(event.target.value);
                    setPreview(null);
                  }}
                />
              </label>
              <SecondaryButton
                disabled={saving || !period}
                onClick={() =>
                  void run(async () => {
                    setPreview(await fixedAssetsClient.previewDepreciation(facilityId, period));
                  })
                }
              >
                <ClipboardList size={15} /> Preview
              </SecondaryButton>
              {canDepreciate ? (
                <PrimaryButton
                  disabled={saving || !period}
                  onClick={() =>
                    void run(async () => {
                      const result = await fixedAssetsClient.runDepreciation(facilityId, {
                        period,
                        entryDate: `${period}-28`,
                      });
                      showToast(
                        result.assetsCharged
                          ? `Posted ${formatCents(Number(result.chargedCents))} KES across ${result.assetsCharged} asset(s)${
                              result.journalNumber ? ` — journal ${result.journalNumber}` : ''
                            }.`
                          : 'No depreciation to post for this period; it was already posted or no asset is eligible.',
                        { tone: result.assetsCharged ? 'success' : 'info' },
                      );
                      setPreview(await fixedAssetsClient.previewDepreciation(facilityId, period));
                      await load();
                      triggerRefresh();
                    })
                  }
                >
                  <Send size={15} /> Post period
                </PrimaryButton>
              ) : (
                <span className="text-xs text-muted">
                  Posting depreciation needs the assets.depreciate permission.
                </span>
              )}
            </div>
          </div>

          {preview && (
            <>
              <AlertBanner tone={previewCharge > 0 ? 'info' : 'neutral'}>
                {previewCharge > 0
                  ? `${preview.filter((row) => !row.alreadyPosted && Number(row.chargeCents) > 0).length} asset(s) will be charged, total KES ${formatCents(previewCharge)}.`
                  : 'Nothing is outstanding for this period.'}
              </AlertBanner>
              {preview.length === 0 ? (
                <EmptyState
                  title="No eligible assets"
                  description="Assets acquired after this period are not depreciated in it."
                />
              ) : (
                <DataTable className="table-quiet">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Category</th>
                      <th className="text-right">Charge (KES)</th>
                      <th className="text-right">Net book after (KES)</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={row.assetId}>
                        <td>
                          <div className="font-medium">{row.assetName}</div>
                          <div className="text-xs text-muted">{row.assetCode}</div>
                        </td>
                        <td>{row.category}</td>
                        <td className="text-right tabular-nums">
                          {formatCents(Number(row.chargeCents))}
                        </td>
                        <td className="text-right tabular-nums">
                          {formatCents(Number(row.netBookValueAfterCents))}
                        </td>
                        <td>
                          {row.alreadyPosted ? (
                            <StatusBadge tone="success">POSTED</StatusBadge>
                          ) : Number(row.chargeCents) === 0 ? (
                            <StatusBadge tone="neutral">FULLY DEPRECIATED</StatusBadge>
                          ) : (
                            <StatusBadge tone="warning">PENDING</StatusBadge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
            </>
          )}

          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Register valuation report</h3>
              <SecondaryButton onClick={() => window.print()}>
                <Printer size={15} /> Print
              </SecondaryButton>
            </div>
            <DataTable className="table-quiet">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="text-right">Assets</th>
                  <th className="text-right">Cost (KES)</th>
                  <th className="text-right">Accumulated (KES)</th>
                  <th className="text-right">Impairment (KES)</th>
                  <th className="text-right">Revaluation reserve (KES)</th>
                  <th className="text-right">Net book (KES)</th>
                </tr>
              </thead>
              <tbody>
                {report.map((row) => (
                  <tr key={row.category}>
                    <td>{row.category}</td>
                    <td className="text-right tabular-nums">{row.assetCount}</td>
                    <td className="text-right tabular-nums">
                      {formatCents(Number(row.costCents))}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatCents(Number(row.accumulatedCents))}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatCents(Number(row.impairmentCents ?? 0))}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatCents(Number(row.revaluationReserveCents ?? 0))}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatCents(Number(row.netBookCents))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th className="text-right tabular-nums">
                    {report.reduce((sum, row) => sum + row.assetCount, 0)}
                  </th>
                  <th className="text-right tabular-nums">
                    {formatCents(report.reduce((sum, row) => sum + Number(row.costCents), 0))}
                  </th>
                  <th className="text-right tabular-nums">
                    {formatCents(
                      report.reduce((sum, row) => sum + Number(row.accumulatedCents), 0),
                    )}
                  </th>
                  <th className="text-right tabular-nums">
                    {formatCents(report.reduce((sum, row) => sum + Number(row.impairmentCents), 0))}
                  </th>
                  <th className="text-right tabular-nums">
                    {formatCents(
                      report.reduce((sum, row) => sum + Number(row.revaluationReserveCents), 0),
                    )}
                  </th>
                  <th className="text-right tabular-nums">
                    {formatCents(report.reduce((sum, row) => sum + Number(row.netBookCents), 0))}
                  </th>
                </tr>
              </tfoot>
            </DataTable>
            <p className="mt-2 text-xs text-muted">
              Active assets only. Cost and accumulated depreciation come from each asset&apos;s
              register balance, updated by the posted depreciation movements. Impairment and
              revaluation change the basis being depreciated; they never rewrite the recorded cost.
            </p>
          </div>

          <div className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Tax allowance schedule</h3>
                <p className="text-xs text-muted">
                  Computed only from rates this facility has recorded against an authority. No rate
                  ships with the product, so an unconfigured category is reported as such.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <SecondaryButton
                  disabled={saving || !period}
                  onClick={() =>
                    void run(async () => {
                      setTaxSchedule(await fixedAssetsClient.getTaxSchedule(facilityId, period));
                    })
                  }
                >
                  <Coins size={15} /> Compute for {period || 'period'}
                </SecondaryButton>
                {canManage && (
                  <SecondaryButton onClick={() => setTaxOpen(true)}>
                    <Plus size={15} /> Record rate
                  </SecondaryButton>
                )}
              </div>
            </div>
            {taxSchedule.length > 0 && (
              <DataTable className="table-quiet">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="text-right">Annual allowance (KES)</th>
                    <th>Basis</th>
                    <th>Authority</th>
                  </tr>
                </thead>
                <tbody>
                  {taxSchedule.map((row) => (
                    <tr key={row.assetId}>
                      <td>
                        <div className="font-medium">{row.assetName}</div>
                        <div className="text-xs text-muted">{row.assetCode}</div>
                      </td>
                      <td className="text-right tabular-nums">
                        {row.annualAllowanceCents === null
                          ? '—'
                          : formatCents(Number(row.annualAllowanceCents))}
                      </td>
                      <td>{row.status === 'CONFIGURED' ? row.method : row.status}</td>
                      <td className="text-xs">
                        {row.authorityReference ?? 'Not configured — no rate applied.'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
            {taxRates.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                {taxRates.length} configured rate(s). {taxRates[0].authorityReference}
              </p>
            )}
          </div>
        </section>
      )}

      {detail && (
        <AssetDetailDrawer
          detail={detail}
          onClose={() => setDetail(null)}
          canManage={canManage}
          canDispose={canDispose}
          onTransfer={() => setTransferFor(detail.asset as unknown as AssetRow)}
          onDispose={() => setDisposeFor(detail.asset as unknown as AssetRow)}
          onAdjust={(mode) => setAdjustFor({ asset: detail.asset as unknown as AssetRow, mode })}
        />
      )}

      {registerOpen && options && (
        <RegisterAssetModal
          options={options}
          categories={categories}
          saving={saving}
          onClose={() => setRegisterOpen(false)}
          onSubmit={(body) =>
            run(async () => {
              const created = await fixedAssetsClient.createAsset(facilityId, body);
              showToast(`Asset capitalised — journal ${created.journalNumber}.`, {
                tone: 'success',
              });
              setRegisterOpen(false);
              await load();
              triggerRefresh();
            })
          }
        />
      )}

      {categoryOpen && options && (
        <CategoryModal
          options={options}
          saving={saving}
          onClose={() => setCategoryOpen(false)}
          onSubmit={(body) =>
            run(async () => {
              await fixedAssetsClient.createAssetCategory(facilityId, body);
              showToast('Category created.', { tone: 'success' });
              setCategoryOpen(false);
              await load();
            })
          }
        />
      )}

      {maintenanceOpen && options && (
        <MaintenanceModal
          assets={assets.filter((asset) => asset.status === 'ACTIVE')}
          options={options}
          saving={saving}
          onClose={() => setMaintenanceOpen(false)}
          onSubmit={(body) =>
            run(async () => {
              await fixedAssetsClient.createMaintenance(facilityId, body);
              showToast('Maintenance planned.', { tone: 'success' });
              setMaintenanceOpen(false);
              await load();
            })
          }
        />
      )}

      {completeJob && options && (
        <CompleteMaintenanceModal
          job={completeJob}
          options={options}
          saving={saving}
          onClose={() => setCompleteJob(null)}
          onSubmit={(body) =>
            run(async () => {
              await fixedAssetsClient.completeMaintenance(facilityId, completeJob.id, body);
              showToast('Maintenance completed.', { tone: 'success' });
              setCompleteJob(null);
              await load();
              triggerRefresh();
            })
          }
        />
      )}

      {transferFor && options && (
        <TransferModal
          asset={transferFor}
          options={options}
          saving={saving}
          onClose={() => setTransferFor(null)}
          onSubmit={(body) =>
            run(async () => {
              await fixedAssetsClient.transferAsset(facilityId, transferFor.id, body);
              showToast('Asset transferred.', { tone: 'success' });
              setTransferFor(null);
              await load();
            })
          }
        />
      )}

      {disposeFor && options && (
        <DisposeModal
          asset={disposeFor}
          options={options}
          saving={saving}
          onClose={() => setDisposeFor(null)}
          onSubmit={(body) =>
            run(async () => {
              const result = await fixedAssetsClient.disposeAsset(facilityId, disposeFor.id, body);
              showToast(`Disposed — journal ${result.journalNumber}.`, { tone: 'success' });
              setDisposeFor(null);
              setDetail(null);
              await load();
              triggerRefresh();
            })
          }
        />
      )}

      {adjustFor && options && (
        <AssetAdjustmentModal
          asset={adjustFor.asset}
          mode={adjustFor.mode}
          options={options}
          saving={saving}
          onClose={() => setAdjustFor(null)}
          onSubmit={(body) =>
            run(async () => {
              const result =
                adjustFor.mode === 'IMPAIR'
                  ? await fixedAssetsClient.impairAsset(facilityId, adjustFor.asset.id, body)
                  : await fixedAssetsClient.revalueAsset(facilityId, adjustFor.asset.id, body);
              showToast(
                adjustFor.mode === 'IMPAIR'
                  ? `Impaired — journal ${result.journalNumber}.`
                  : `Revalued ${(result as { direction?: string }).direction ?? ''} — journal ${
                      result.journalNumber
                    }.`,
                { tone: 'success' },
              );
              setAdjustFor(null);
              setDetail(null);
              await load();
              triggerRefresh();
            })
          }
        />
      )}

      {taxOpen && (
        <TaxRateModal
          rates={taxRates}
          categories={categories}
          saving={saving}
          onClose={() => setTaxOpen(false)}
          onSubmit={(body) =>
            run(async () => {
              await fixedAssetsClient.createTaxRate(facilityId, body);
              showToast('Tax rate recorded against its authority.', { tone: 'success' });
              setTaxOpen(false);
              await load();
            })
          }
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

function AssetDetailDrawer({
  detail,
  onClose,
  canManage,
  canDispose,
  onTransfer,
  onDispose,
  onAdjust,
}: {
  detail: AssetDetail;
  onClose: () => void;
  canManage: boolean;
  canDispose: boolean;
  onTransfer: () => void;
  onDispose: () => void;
  onAdjust: (mode: 'IMPAIR' | 'REVALUE') => void;
}) {
  const asset = detail.asset;
  return (
    <Modal open onClose={onClose} title={`${asset.assetCode} — ${asset.assetName}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Detail label="Category" value={asset.category} />
        <Detail label="Status" value={asset.status} />
        <Detail label="Acquisition date" value={asset.acquisitionDate} />
        <Detail label="Cost" value={`KES ${formatCents(toCents(asset.acquisitionCostKes))}`} />
        <Detail
          label="Accumulated depreciation"
          value={`KES ${formatCents(toCents(asset.accumulatedDepreciationKes))}`}
        />
        <Detail
          label="Net book value"
          value={`KES ${formatCents(toCents(asset.netBookValueKes))}`}
        />
        <Detail label="Location" value={asset.location || '—'} />
        <Detail label="Custodian" value={asset.custodianName || 'Unassigned'} />
        <Detail label="Condition" value={asset.condition} />
        <Detail label="Serial number" value={asset.serialNumber || '—'} />
      </div>

      <h3 className="mt-5 text-sm font-semibold">Movements</h3>
      {detail.movements.length === 0 ? (
        <p className="text-xs text-muted">No movements recorded.</p>
      ) : (
        <DataTable className="table-quiet">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th className="text-right">Amount (KES)</th>
              <th className="text-right">Net book after</th>
              <th>Journal</th>
            </tr>
          </thead>
          <tbody>
            {detail.movements.map((movement) => (
              <tr key={movement.id}>
                <td>{movement.movementDate}</td>
                <td>{movement.movementType}</td>
                <td className="text-right tabular-nums">
                  {formatCents(toCents(movement.amountKes))}
                </td>
                <td className="text-right tabular-nums">
                  {formatCents(toCents(movement.netBookValueAfterKes))}
                </td>
                <td>{movement.journalEntryId ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {detail.maintenance.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold">Maintenance</h3>
          <ul className="space-y-1 text-sm">
            {detail.maintenance.map((job) => (
              <li key={job.id}>
                {job.maintenanceDate} · {job.maintenanceType} · {job.description} ·{' '}
                {formatCents(toCents(job.costKes))} KES · {job.status}
              </li>
            ))}
          </ul>
        </>
      )}

      {detail.transfers.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold">Transfers</h3>
          <ul className="space-y-1 text-sm">
            {detail.transfers.map((transfer) => (
              <li key={transfer.id}>
                {transfer.transferDate} · {transfer.fromLocation || '—'} →{' '}
                {transfer.toLocation || '—'} · {transfer.reason}
              </li>
            ))}
          </ul>
        </>
      )}

      {detail.disposalJournal && (
        <AlertBanner tone="neutral">
          Disposed under journal {detail.disposalJournal.journalNumber} on{' '}
          {detail.disposalJournal.entryDate}.
        </AlertBanner>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {asset.status === 'ACTIVE' && canManage && (
          <SecondaryButton onClick={onTransfer}>
            <UserRound size={15} /> Transfer
          </SecondaryButton>
        )}
        {asset.status === 'ACTIVE' && canDispose && (
          <>
            <SecondaryButton onClick={() => onAdjust('IMPAIR')}>
              <Scale size={15} /> Impair
            </SecondaryButton>
            <SecondaryButton onClick={() => onAdjust('REVALUE')}>
              <Coins size={15} /> Revalue
            </SecondaryButton>
          </>
        )}
        {asset.status === 'ACTIVE' && canDispose && (
          <SecondaryButton onClick={onDispose}>
            <Trash2 size={15} /> Dispose
          </SecondaryButton>
        )}
        <PrimaryButton onClick={onClose}>Close</PrimaryButton>
      </div>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Forms                                                               */
/* ------------------------------------------------------------------ */

function FormInput({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="ui-field">
      <span>
        {label}
        {props.required ? ' *' : ''}
      </span>
      <input className="ui-input" {...props} />
    </label>
  );
}

function RegisterAssetModal({
  options,
  categories,
  saving,
  onClose,
  onSubmit,
}: {
  options: AssetOptions;
  categories: AssetCategory[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    assetCode: '',
    assetName: '',
    categoryId: '',
    acquisitionDate: new Date().toISOString().slice(0, 10),
    acquisitionCostKes: '',
    salvageValueKes: '0',
    usefulLifeMonths: '',
    acquisitionCreditAccountId: '',
    location: '',
    custodianEmployeeId: '',
    departmentId: '',
    serialNumber: '',
    notes: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const selectedCategory = categories.find((category) => String(category.id) === form.categoryId);
  const life = form.usefulLifeMonths || String(selectedCategory?.defaultUsefulLifeMonths ?? '');

  return (
    <Modal
      open
      onClose={onClose}
      title="Register asset"
      actions={
        <>
          <SecondaryButton onClick={onClose} disabled={saving}>
            Cancel
          </SecondaryButton>
          <PrimaryButton
            disabled={saving}
            onClick={() =>
              onSubmit({
                ...form,
                categoryId: form.categoryId || undefined,
                usefulLifeMonths: life || undefined,
                salvageValueKes: form.salvageValueKes || '0',
                custodianEmployeeId: form.custodianEmployeeId || undefined,
                departmentId: form.departmentId || undefined,
              })
            }
          >
            <Building2 size={15} /> Capitalise asset
          </PrimaryButton>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormInput label="Asset code" required value={form.assetCode} onChange={set('assetCode')} />
        <FormInput label="Asset name" required value={form.assetName} onChange={set('assetName')} />
        <label className="ui-field">
          <span>Category *</span>
          <select
            className="ui-select"
            value={form.categoryId}
            onChange={set('categoryId')}
            required
          >
            <option value="">Select category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({category.defaultUsefulLifeMonths} months)
              </option>
            ))}
          </select>
        </label>
        <FormInput
          label="Acquisition date"
          type="date"
          required
          value={form.acquisitionDate}
          onChange={set('acquisitionDate')}
        />
        <FormInput
          label="Acquisition cost (KES)"
          type="number"
          step="0.01"
          min="0.01"
          required
          value={form.acquisitionCostKes}
          onChange={set('acquisitionCostKes')}
        />
        <FormInput
          label="Salvage value (KES)"
          type="number"
          step="0.01"
          min="0"
          value={form.salvageValueKes}
          onChange={set('salvageValueKes')}
        />
        <FormInput
          label="Useful life (months)"
          type="number"
          min="1"
          max="600"
          required
          value={life}
          onChange={set('usefulLifeMonths')}
          readOnly={Boolean(selectedCategory)}
        />
        <label className="ui-field">
          <span>Funding / credit account *</span>
          <select
            className="ui-select"
            value={form.acquisitionCreditAccountId}
            onChange={set('acquisitionCreditAccountId')}
            required
          >
            <option value="">Select account</option>
            {options.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>
        </label>
        <FormInput label="Location" value={form.location} onChange={set('location')} />
        <label className="ui-field">
          <span>Custodian</span>
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
        </label>
        <label className="ui-field">
          <span>Department</span>
          <select className="ui-select" value={form.departmentId} onChange={set('departmentId')}>
            <option value="">Unassigned</option>
            {options.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <FormInput label="Serial number" value={form.serialNumber} onChange={set('serialNumber')} />
      </div>
      <label className="ui-field mt-3">
        <span>Notes</span>
        <textarea className="ui-input" rows={2} value={form.notes} onChange={set('notes')} />
      </label>
      <p className="mt-3 text-xs text-muted">
        Capitalising posts Dr asset account / Cr funding account for{' '}
        {form.acquisitionCostKes ? `KES ${form.acquisitionCostKes}` : 'the acquisition cost'} in the
        same transaction. The asset cannot be saved without its journal.
      </p>
    </Modal>
  );
}

function CategoryModal({
  options,
  saving,
  onClose,
  onSubmit,
}: {
  options: AssetOptions;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    code: '',
    name: '',
    defaultUsefulLifeMonths: '60',
    assetAccountId: '',
    accumDepAccountId: '',
    depExpenseAccountId: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const selects: Array<[keyof typeof form, string]> = [
    ['assetAccountId', 'Asset account *'],
    ['accumDepAccountId', 'Accumulated depreciation account *'],
    ['depExpenseAccountId', 'Depreciation expense account *'],
  ];
  return (
    <Modal
      open
      onClose={onClose}
      title="New asset category"
      actions={
        <>
          <SecondaryButton onClick={onClose} disabled={saving}>
            Cancel
          </SecondaryButton>
          <PrimaryButton disabled={saving} onClick={() => onSubmit(form)}>
            Create category
          </PrimaryButton>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormInput label="Code" required value={form.code} onChange={set('code')} />
        <FormInput label="Name" required value={form.name} onChange={set('name')} />
        <FormInput
          label="Default useful life (months)"
          type="number"
          min="1"
          max="600"
          required
          value={form.defaultUsefulLifeMonths}
          onChange={set('defaultUsefulLifeMonths')}
        />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {selects.map(([key, label]) => (
          <label className="ui-field" key={key}>
            <span>{label}</span>
            <select className="ui-select" value={form[key]} onChange={set(key)} required>
              <option value="">Select account</option>
              {options.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </Modal>
  );
}

function MaintenanceModal({
  assets,
  options,
  saving,
  onClose,
  onSubmit,
}: {
  assets: AssetRow[];
  options: AssetOptions;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    assetId: '',
    maintenanceDate: new Date().toISOString().slice(0, 10),
    maintenanceType: 'PREVENTIVE',
    vendor: '',
    description: '',
    costKes: '0',
    expenseAccountId: '',
    creditAccountId: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const costed = Number(form.costKes) > 0;
  return (
    <Modal
      open
      onClose={onClose}
      title="Plan maintenance"
      actions={
        <>
          <SecondaryButton onClick={onClose} disabled={saving}>
            Cancel
          </SecondaryButton>
          <PrimaryButton disabled={saving} onClick={() => onSubmit(form)}>
            Save plan
          </PrimaryButton>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="ui-field">
          <span>Asset *</span>
          <select className="ui-select" value={form.assetId} onChange={set('assetId')} required>
            <option value="">Select asset</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.assetCode} — {asset.assetName}
              </option>
            ))}
          </select>
        </label>
        <FormInput
          label="Date"
          type="date"
          required
          value={form.maintenanceDate}
          onChange={set('maintenanceDate')}
        />
        <label className="ui-field">
          <span>Type</span>
          <select
            className="ui-select"
            value={form.maintenanceType}
            onChange={set('maintenanceType')}
          >
            {['PREVENTIVE', 'CORRECTIVE', 'INSPECTION'].map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <FormInput label="Vendor" value={form.vendor} onChange={set('vendor')} />
        <FormInput
          label="Cost (KES)"
          type="number"
          step="0.01"
          min="0"
          value={form.costKes}
          onChange={set('costKes')}
        />
      </div>
      <label className="ui-field mt-3">
        <span>Description *</span>
        <textarea
          className="ui-input"
          rows={2}
          required
          value={form.description}
          onChange={set('description')}
        />
      </label>
      {costed && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="ui-field">
            <span>Expense account *</span>
            <select
              className="ui-select"
              value={form.expenseAccountId}
              onChange={set('expenseAccountId')}
            >
              <option value="">Select account</option>
              {options.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            <span>Credit account *</span>
            <select
              className="ui-select"
              value={form.creditAccountId}
              onChange={set('creditAccountId')}
            >
              <option value="">Select account</option>
              {options.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        A costed job posts its expense when it is marked complete, not when it is planned.
      </p>
    </Modal>
  );
}

function CompleteMaintenanceModal({
  job,
  options,
  saving,
  onClose,
  onSubmit,
}: {
  job: AssetMaintenanceRow;
  options: AssetOptions;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [completedDate, setCompletedDate] = useState(new Date().toISOString().slice(0, 10));
  const [creditAccountId, setCreditAccountId] = useState('');
  const costed = toCents(job.costKes) > 0;
  return (
    <Modal
      open
      onClose={onClose}
      title="Complete maintenance"
      actions={
        <>
          <SecondaryButton onClick={onClose} disabled={saving}>
            Cancel
          </SecondaryButton>
          <PrimaryButton
            disabled={saving || (costed && !creditAccountId)}
            onClick={() =>
              onSubmit({ completedDate, creditAccountId: creditAccountId || undefined })
            }
          >
            Complete
          </PrimaryButton>
        </>
      }
    >
      <p className="text-sm">
        {job.assetCode} — {job.description}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <FormInput
          label="Completion date"
          type="date"
          required
          value={completedDate}
          onChange={(event) => setCompletedDate(event.target.value)}
        />
        {costed && (
          <label className="ui-field">
            <span>Payment / credit account *</span>
            <select
              className="ui-select"
              value={creditAccountId}
              onChange={(event) => setCreditAccountId(event.target.value)}
            >
              <option value="">Select account</option>
              {options.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {costed && (
        <p className="mt-3 text-xs text-muted">
          Completing posts Dr expense / Cr the selected account for KES {job.costKes}.
        </p>
      )}
    </Modal>
  );
}

function TransferModal({
  asset,
  options,
  saving,
  onClose,
  onSubmit,
}: {
  asset: AssetRow;
  options: AssetOptions;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    transferDate: new Date().toISOString().slice(0, 10),
    toDepartmentId: '',
    toEmployeeId: '',
    toLocation: '',
    reason: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <Modal
      open
      onClose={onClose}
      title={`Transfer ${asset.assetCode}`}
      actions={
        <>
          <SecondaryButton onClick={onClose} disabled={saving}>
            Cancel
          </SecondaryButton>
          <PrimaryButton disabled={saving} onClick={() => onSubmit(form)}>
            Record transfer
          </PrimaryButton>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormInput
          label="Transfer date"
          type="date"
          required
          value={form.transferDate}
          onChange={set('transferDate')}
        />
        <label className="ui-field">
          <span>Destination department</span>
          <select
            className="ui-select"
            value={form.toDepartmentId}
            onChange={set('toDepartmentId')}
          >
            <option value="">Unchanged</option>
            {options.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ui-field">
          <span>New custodian</span>
          <select className="ui-select" value={form.toEmployeeId} onChange={set('toEmployeeId')}>
            <option value="">Unchanged</option>
            {options.employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.firstName} {employee.lastName} ({employee.employeeNumber})
              </option>
            ))}
          </select>
        </label>
        <FormInput label="New location" value={form.toLocation} onChange={set('toLocation')} />
      </div>
      <label className="ui-field mt-3">
        <span>Reason *</span>
        <textarea
          className="ui-input"
          rows={2}
          required
          value={form.reason}
          onChange={set('reason')}
        />
      </label>
      <p className="mt-2 text-xs text-muted">
        Current: {asset.location || 'no location'} · {asset.custodianName || 'no custodian'}
      </p>
    </Modal>
  );
}

function DisposeModal({
  asset,
  options,
  saving,
  onClose,
  onSubmit,
}: {
  asset: AssetRow;
  options: AssetOptions;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    disposalDate: new Date().toISOString().slice(0, 10),
    proceedsKes: '0',
    proceedsAccountId: '',
    gainLossAccountId: '',
    reason: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const netBook = toCents(asset.netBookValueKes);
  const proceeds = Math.round(Number(form.proceedsKes || '0') * 100);
  const gainLoss = proceeds - netBook;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Dispose ${asset.assetCode}`}
      actions={
        <>
          <SecondaryButton onClick={onClose} disabled={saving}>
            Cancel
          </SecondaryButton>
          <PrimaryButton disabled={saving} onClick={() => onSubmit(form)}>
            <Trash2 size={15} /> Post disposal
          </PrimaryButton>
        </>
      }
    >
      <AlertBanner tone="warning">
        Disposal is irreversible in the register. It removes cost{' '}
        {formatCents(toCents(asset.acquisitionCostKes))} KES and accumulated depreciation{' '}
        {formatCents(toCents(asset.accumulatedDepreciationKes))} KES, and posts a{' '}
        {gainLoss >= 0 ? 'gain' : 'loss'} of {formatCents(Math.abs(gainLoss))} KES.
      </AlertBanner>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <FormInput
          label="Disposal date"
          type="date"
          required
          value={form.disposalDate}
          onChange={set('disposalDate')}
        />
        <FormInput
          label="Proceeds (KES)"
          type="number"
          step="0.01"
          min="0"
          value={form.proceedsKes}
          onChange={set('proceedsKes')}
        />
        {Number(form.proceedsKes) > 0 && (
          <label className="ui-field">
            <span>Proceeds account *</span>
            <select
              className="ui-select"
              value={form.proceedsAccountId}
              onChange={set('proceedsAccountId')}
            >
              <option value="">Select account</option>
              {options.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="ui-field">
          <span>Gain / loss account *</span>
          <select
            className="ui-select"
            value={form.gainLossAccountId}
            onChange={set('gainLossAccountId')}
            required
          >
            <option value="">Select account</option>
            {options.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="ui-field mt-3">
        <span>Reason *</span>
        <textarea
          className="ui-input"
          rows={2}
          required
          value={form.reason}
          onChange={set('reason')}
        />
      </label>
    </Modal>
  );
}

/**
 * Impair (write down to recoverable amount) or revalue an asset.
 *
 * One modal for two judgements because they ask the same two questions — how
 * much, and why — but the wording and the required accounts differ. Impairment
 * always books a loss. A revaluation books a surplus unless the fall exceeds
 * the surplus already held for that asset, so the loss account is only demanded
 * in that case.
 */
function AssetAdjustmentModal({
  asset,
  mode,
  options,
  saving,
  onClose,
  onSubmit,
}: {
  asset: AssetRow;
  mode: 'IMPAIR' | 'REVALUE';
  options: AssetOptions;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const impairing = mode === 'IMPAIR';
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amountKes: '',
    lossAccountId: '',
    surplusAccountId: '',
    reason: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const netBookCents = toCents(asset.netBookValueKes);
  const typedCents = Math.round(Number(form.amountKes || '0') * 100);
  const resultingCents = impairing ? netBookCents - typedCents : typedCents;

  const body: Record<string, unknown> = impairing
    ? {
        date: form.date,
        amountKes: form.amountKes,
        lossAccountId: form.lossAccountId ? Number(form.lossAccountId) : undefined,
        reason: form.reason,
      }
    : {
        date: form.date,
        revaluedAmountKes: form.amountKes,
        surplusAccountId: form.surplusAccountId ? Number(form.surplusAccountId) : undefined,
        lossAccountId: form.lossAccountId ? Number(form.lossAccountId) : undefined,
        reason: form.reason,
      };

  const disableSubmit =
    saving ||
    !form.reason.trim() ||
    typedCents <= 0 ||
    (impairing && !form.lossAccountId) ||
    (!impairing && !form.surplusAccountId);

  return (
    <Modal
      open
      onClose={onClose}
      title={`${impairing ? 'Impair' : 'Revalue'} ${asset.assetCode}`}
      actions={
        <>
          <SecondaryButton onClick={onClose} disabled={saving}>
            Cancel
          </SecondaryButton>
          <PrimaryButton disabled={disableSubmit} onClick={() => onSubmit(body)}>
            {impairing ? <Scale size={15} /> : <Coins size={15} />}
            {impairing ? ' Post impairment' : ' Post revaluation'}
          </PrimaryButton>
        </>
      }
    >
      <AlertBanner tone="warning">
        {impairing
          ? `This writes the asset down and posts a loss. Historical cost stays at ${asset.acquisitionCostKes} KES; depreciation afterwards is charged on the reduced basis.`
          : `This restates the carrying amount. Historical cost stays at ${asset.acquisitionCostKes} KES. An increase goes to the revaluation surplus, never to revenue.`}
      </AlertBanner>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <FormInput
          label={impairing ? 'Impairment date' : 'Revaluation date'}
          type="date"
          required
          value={form.date}
          onChange={set('date')}
        />
        <FormInput
          label={impairing ? 'Impairment (KES)' : 'Revalued carrying amount (KES)'}
          type="number"
          step="0.01"
          min="0"
          required
          value={form.amountKes}
          onChange={set('amountKes')}
        />
        <label className="ui-field">
          <span>{impairing ? 'Impairment loss account *' : 'Revaluation surplus account *'}</span>
          <select
            className="ui-select"
            value={impairing ? form.lossAccountId : form.surplusAccountId}
            onChange={impairing ? set('lossAccountId') : set('surplusAccountId')}
          >
            <option value="">Select account</option>
            {options.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>
        </label>
        {!impairing && (
          <label className="ui-field">
            <span>Loss account (only if the fall exceeds the surplus)</span>
            <select
              className="ui-select"
              value={form.lossAccountId}
              onChange={set('lossAccountId')}
            >
              <option value="">Not required</option>
              {options.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="sm:col-span-2">
          <FormInput
            label="Reason (recorded in the audit trail)"
            required
            value={form.reason}
            onChange={set('reason')}
          />
        </div>
      </div>
      {typedCents > 0 && (
        <p className="mt-3 text-xs text-muted">
          Carrying amount {formatCents(netBookCents)} KES → {formatCents(resultingCents)} KES.
        </p>
      )}
    </Modal>
  );
}

/**
 * Record a tax rate with the authority that permits it.
 *
 * The authority reference is required and stored, because a rate without a
 * citable source is indistinguishable from a guess once the person who entered
 * it has left.
 */
function TaxRateModal({
  rates,
  categories,
  saving,
  onClose,
  onSubmit,
}: {
  rates: TaxRate[];
  categories: AssetCategory[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    method: 'REDUCING_BALANCE',
    ratePercent: '',
    authorityReference: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    categoryId: '',
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const rateBps = Math.round(Number(form.ratePercent || '0') * 100);
  const disableSubmit =
    saving || !form.name.trim() || !form.authorityReference.trim() || rateBps <= 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="Record a tax depreciation rate"
      actions={
        <>
          <SecondaryButton onClick={onClose} disabled={saving}>
            Cancel
          </SecondaryButton>
          <PrimaryButton
            disabled={disableSubmit}
            onClick={() =>
              onSubmit({
                name: form.name,
                method: form.method,
                annualRateBps: rateBps,
                authorityReference: form.authorityReference,
                effectiveFrom: form.effectiveFrom,
                categoryId: form.categoryId ? Number(form.categoryId) : undefined,
              })
            }
          >
            <Plus size={15} /> Save rate
          </PrimaryButton>
        </>
      }
    >
      <AlertBanner tone="info">
        This system ships no tax rates. Enter the rate your facility is entitled to use and cite the
        notice or practice note it comes from — the citation is stored with the rate and shown on
        every schedule computed from it.
      </AlertBanner>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <FormInput label="Rate name *" required value={form.name} onChange={set('name')} />
        <label className="ui-field">
          <span>Method *</span>
          <select className="ui-select" value={form.method} onChange={set('method')}>
            <option value="REDUCING_BALANCE">Reducing balance</option>
            <option value="STRAIGHT_LINE">Straight line</option>
          </select>
        </label>
        <FormInput
          label="Annual rate (%) *"
          type="number"
          step="0.01"
          min="0.01"
          max="100"
          required
          value={form.ratePercent}
          onChange={set('ratePercent')}
        />
        <FormInput
          label="Effective from *"
          type="date"
          required
          value={form.effectiveFrom}
          onChange={set('effectiveFrom')}
        />
        <label className="ui-field">
          <span>Category (blank applies to all)</span>
          <select className="ui-select" value={form.categoryId} onChange={set('categoryId')}>
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2">
          <FormInput
            label="Authority reference *"
            required
            placeholder="Notice or practice note the rate comes from"
            value={form.authorityReference}
            onChange={set('authorityReference')}
          />
        </div>
      </div>
      {rates.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted">
          {rates.map((rate) => (
            <li key={rate.id}>
              {rate.name} · {(rate.annualRateBps / 100).toFixed(2)}% · {rate.method} · from{' '}
              {rate.effectiveFrom} · {rate.authorityReference}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
