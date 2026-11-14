import React, { useEffect, useState } from 'react';
import {
  planningApi,
  type Mapping,
  type Plan,
  type PlanningRow,
} from '../../../api/clients/planning.client.ts';
import { field, button, quiet, months } from './PlanningEditors.tsx';
import { DataTable } from '../../ui/layout.tsx';
const letter = (n: number) => {
  let out = '';
  for (n++; n > 0; n = Math.floor((n - 1) / 26))
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
};
export function PlanningImport({
  facilityId,
  onImported,
}: {
  facilityId: number;
  plans: Plan[];
  onImported: (id: number) => void;
}) {
  const [history, setHistory] = useState<PlanningRow[]>([]),
    [batch, setBatch] = useState<PlanningRow | null>(null),
    [mappings, setMappings] = useState<Mapping[]>([]),
    [preview, setPreview] = useState<PlanningRow | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [summary, setSummary] = useState<PlanningRow | null>(null);
  const [settings, setSettings] = useState({
    name: '',
    financialYear: String(new Date().getUTCFullYear()),
    planType: 'MIXED',
    currency: 'KES',
    inflationPercent: '5',
    policy: 'ZERO_FILL',
    mode: 'NEW',
    planId: '',
    confirmAdditionalPlan: false,
    confirmUpdate: false,
    confirm: false,
  });
  const [loadedTargets, setLoadedTargets] = useState<{ key: string; plans: Plan[] } | null>(null);
  const targetYear = settings.financialYear;
  const loadTargets = batch?.status === 'UPLOADED' && settings.mode !== 'NEW';
  const targetKey = JSON.stringify([facilityId, batch?.id, targetYear, settings.mode]);
  const targetPlans = loadedTargets?.key === targetKey ? loadedTargets.plans : [];
  const targetsLoading = loadTargets && loadedTargets?.key !== targetKey;
  // Workspace plans are paginated/filtered for navigation; import targets need their own scoped list.
  useEffect(() => {
    let live = true;
    if (!loadTargets) return;
    void (async () => {
      const targets: Plan[] = [];
      let page = 1,
        total = 0;
      do {
        const response = await planningApi.get<{ plans: Plan[]; total: number }>(
          facilityId,
          '/plans',
          { status: 'DRAFT', year: targetYear, page },
        );
        targets.push(...response.plans);
        total = response.total;
        page++;
        if (!live) return;
        if (!response.plans.length) break;
      } while (targets.length < total);
      if (live) setLoadedTargets({ key: targetKey, plans: targets });
    })().catch((e) => {
      if (live) {
        setError(e.message);
        setLoadedTargets({ key: targetKey, plans: [] });
      }
    });
    return () => {
      live = false;
    };
  }, [facilityId, targetKey, targetYear, loadTargets]);
  const reload = async () =>
    setHistory(await planningApi.get<PlanningRow[]>(facilityId, '/imports'));
  useEffect(() => {
    let live = true;
    planningApi
      .get<PlanningRow[]>(facilityId, '/imports')
      .then((v) => {
        if (live) setHistory(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [facilityId]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };
  const open = async (id: number) => {
    const b = await planningApi.get<PlanningRow>(facilityId, `/imports/${id}`);
    setBatch(b);
    setMappings([]);
    setPreview(null);
    setSummary(null);
    setSettings((v) => ({ ...v, planId: '', confirm: false, confirmUpdate: false }));
  };
  const retryReview = (id: number) => {
    if (
      !window.confirm(
        `Retry review of cancelled batch #${id}? This explicitly reopens the SAME batch, retains its source file/hash and cancellation audit, and discards its old preview. It does not create a batch or import anything. You must preview again and separately confirm any later import.`,
      )
    )
      return;
    void run(async () => {
      await planningApi.send(facilityId, `/imports/${id}/retry-review`, { confirmRetry: true });
      await reload();
      await open(id);
    });
  };
  const change = (n: number, key: string, value: unknown) => {
    setMappings(mappings.map((m, i) => (i === n ? { ...m, [key]: value } : m)));
    setPreview(null);
    setSettings({ ...settings, confirm: false });
  };
  const bind = (label: string, key: keyof typeof settings, type = 'text') => (
    <label className="space-y-1 text-xs">
      <span>{label}</span>
      <input
        className={field}
        type={type}
        value={String(settings[key])}
        onChange={(e) => {
          setSettings({
            ...settings,
            [key]: e.target.value,
            ...(key === 'financialYear' ? { planId: '' } : {}),
            confirm: false,
          });
          setPreview(null);
        }}
      />
    </label>
  );
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-hair bg-surface p-4 space-y-3">
        <h3 className="font-semibold">Secure CSV / Excel import</h3>
        <p className="text-sm">
          Upload UTF-8 .csv, .xls or .xlsx (maximum 4 MiB). The server validates MIME/signature and
          parses in a bounded worker. No formulas are executed. Source costs are recalculated;
          formula-based input quantities must be replaced by reviewed inputs in a corrected workbook
          or explicitly excluded. Zero-fill is the default: missing/dash numeric inputs become 0,
          missing units become “unit”. Review the normalization evidence before confirming. Headers
          and totals must remain outside mapped item ranges.
        </p>
        <label className="block text-sm">
          Planning workbook
          <input
            aria-label="Planning workbook"
            className={field}
            disabled={busy}
            type="file"
            accept=".csv,.xls,.xlsx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // Allow the same file to be chosen again after an error.
              if (file)
                void run(async () => {
                  const b = await planningApi.upload(facilityId, file);
                  setBatch(b);
                  setMappings([]);
                  setPreview(null);
                  setSummary(null);
                  setSettings((v) => ({ ...v, planId: '', confirm: false, confirmUpdate: false }));
                  await reload();
                });
            }}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {summary && (
          <p role="status" className="rounded border border-green-300 p-3">
            Import complete: {summary.created} created, {summary.updated} updated, {summary.skipped}{' '}
            skipped; {summary.sourceRows} source rows, {summary.validationErrors} validation errors.
          </p>
        )}
      </section>
      {batch && batch.status === 'UPLOADED' && (
        <section className="rounded-xl border border-hair bg-surface p-4 space-y-4">
          <h3 className="font-semibold">Preview and field mappings — batch #{batch.id}</h3>
          <p className="text-xs">
            Worksheets:{' '}
            {batch.sheets.map((s: PlanningRow) => `${s.name} (${s.rows} rows)`).join(', ')}. Source
            row numbers below are 1-based. Map quantity columns, never the neighbouring
            projected-cost columns. Preserve the source category label in each row block.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {bind('Draft plan name', 'name')}
            {bind('Import financial year', 'financialYear', 'number')}
            {bind('Import inflation percentage', 'inflationPercent')}
            <label className="text-xs">
              Missing-value policy
              <select
                className={field}
                value={settings.policy}
                onChange={(e) => {
                  setSettings({ ...settings, policy: e.target.value, confirm: false });
                  setPreview(null);
                }}
              >
                <option value="ZERO_FILL">
                  Zero-fill missing/dash numbers; unit fallback: unit
                </option>
                <option value="STRICT">Strict source validation (preserve blanks)</option>
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs">
              Plan type
              <select
                className={field}
                value={settings.planType}
                onChange={(e) => setSettings({ ...settings, planType: e.target.value })}
              >
                {['ANNUAL', 'STATIONERY', 'BRANDING', 'MIXED'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Currency
              <select
                className={field}
                value={settings.currency}
                onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
              >
                {['KES', 'USD', 'EUR'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          {batch.sheets
            .filter((s: PlanningRow) => s.rows > 0)
            .map((sheet: PlanningRow) => (
              <details key={sheet.name}>
                <summary className="cursor-pointer text-sm font-semibold">
                  Inspect {sheet.name} source cells / header candidates (first 40 rows)
                </summary>
                <p className="text-xs">
                  Headers containing item, description, unit, price or month labels identify
                  candidates only; review your row ranges and mappings before confirming.
                </p>
                <div className="max-h-72 overflow-auto">
                  <DataTable className="w-full text-left text-xs">
                    <thead>
                      <tr>
                        <th>Source row</th>
                        {(sheet.preview[0] ?? []).map((_: unknown, n: number) => (
                          <th key={n}>{letter(n)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.preview.map((row: PlanningRow[], n: number) => (
                        <tr key={n}>
                          <td>{n + 1}</td>
                          {row.map((cell: PlanningRow | null, col: number) => (
                            <td
                              key={col}
                              className={
                                /item|description|unit|price|january|february/i.test(
                                  String(cell?.value ?? ''),
                                )
                                  ? 'font-semibold text-brand-800'
                                  : ''
                              }
                            >
                              {cell?.formula
                                ? `FORMULA: ${cell.formula}`
                                : String(cell?.value ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                </div>
              </details>
            ))}
          {mappings.map((mapping, n) => (
            <fieldset key={n} className="rounded-lg border border-hair p-3 space-y-3">
              <legend className="text-sm font-semibold">Source block {n + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs">
                  Worksheet
                  <select
                    className={field}
                    value={mapping.sheet}
                    onChange={(e) => change(n, 'sheet', e.target.value)}
                  >
                    {batch.sheets.map((sh: PlanningRow) => (
                      <option key={sh.name}>{sh.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  Structure
                  <select
                    className={field}
                    value={mapping.kind}
                    onChange={(e) => change(n, 'kind', e.target.value)}
                  >
                    <option value="ITEM">Monthly item</option>
                    <option value="UNIFORM">Uniform projection</option>
                  </select>
                </label>
                {[
                  ['Source category', 'category'],
                  ['First source row', 'startRow'],
                  ['Last source row', 'endRow'],
                  ['Description column', 'description'],
                  [mapping.kind === 'ITEM' ? 'Base price column' : 'Buying cost column', 'price'],
                ].map(([label, key]) => (
                  <label key={key} className="text-xs">
                    {label}
                    <input
                      className={field}
                      value={String((mapping as unknown as PlanningRow)[key] ?? '')}
                      onChange={(e) =>
                        change(
                          n,
                          key,
                          ['startRow', 'endRow'].includes(key)
                            ? Number(e.target.value)
                            : e.target.value,
                        )
                      }
                    />
                  </label>
                ))}
                <label className="text-xs">
                  Exclude source rows (comma separated)
                  <input
                    className={field}
                    value={(mapping.skipRows ?? []).join(',')}
                    onChange={(e) =>
                      change(n, 'skipRows', e.target.value.split(',').filter(Boolean).map(Number))
                    }
                  />
                </label>
              </div>
              {mapping.kind === 'ITEM' ? (
                <>
                  <label className="block text-xs">
                    Unit column
                    <input
                      className={field}
                      value={mapping.unit ?? ''}
                      onChange={(e) => change(n, 'unit', e.target.value)}
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {months.map((month, m) => (
                      <label key={month} className="text-xs">
                        {month} qty column
                        <input
                          className={field}
                          value={mapping.months?.[m] ?? ''}
                          onChange={(e) => {
                            const cols = [...(mapping.months ?? Array(12).fill(''))];
                            cols[m] = e.target.value;
                            change(n, 'months', cols);
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ['Opening balance column', 'existingBalance'],
                    ['Projected staff column', 'staff'],
                    ['Quantity per staff column', 'perStaff'],
                    ['Contribution percentage column (optional)', 'contributionPercent'],
                    ['Opening balance reference period', 'balanceLabel'],
                  ].map(([label, key]) => (
                    <label key={key} className="text-xs">
                      {label}
                      <input
                        className={field}
                        value={String((mapping as unknown as PlanningRow)[key] ?? '')}
                        onChange={(e) => change(n, key, e.target.value)}
                      />
                    </label>
                  ))}
                  <label className="text-xs">
                    Explicit balance calculation
                    <select
                      className={field}
                      value={mapping.balanceRule ?? ''}
                      onChange={(e) => change(n, 'balanceRule', e.target.value)}
                    >
                      <option value="">Review and choose…</option>
                      <option value="SUBTRACT">Subtract opening units from staff projection</option>
                      <option value="IGNORE">Keep opening units as context only</option>
                    </select>
                  </label>
                  <p className="text-xs">
                    An omitted contribution column means 0%. Under zero-fill a mapped blank also
                    defaults to 0%. A workbook half-pay currency amount is not a percentage column;
                    do not map it here. Review the displayed formula trace and transform to explicit
                    supported inputs in a corrected workbook if needed.
                  </p>
                </div>
              )}
              <button
                className={quiet}
                onClick={() => {
                  setMappings(mappings.filter((_, i) => i !== n));
                  setPreview(null);
                }}
              >
                Remove mapping block
              </button>
            </fieldset>
          ))}
          <button
            className={quiet}
            onClick={() => {
              setMappings([
                ...mappings,
                {
                  sheet:
                    batch.sheets.find((s: PlanningRow) => s.rows > 0)?.name ??
                    batch.sheets[0]?.name,
                  kind: 'ITEM',
                  startRow: 1,
                  endRow: 1,
                  category: '',
                  description: '',
                  unit: '',
                  price: '',
                  months: Array(12).fill(''),
                },
              ]);
              setPreview(null);
            }}
          >
            Add source/category mapping block
          </button>
          <p className="text-xs">
            Merge matching uses worksheet, source row, section, description and unit. Same-name rows
            at different source positions remain separate. Manual entries are not silently
            overwritten by imports.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs">
              Import action
              <select
                className={field}
                value={settings.mode}
                onChange={(e) => {
                  setSettings({
                    ...settings,
                    mode: e.target.value,
                    planId: '',
                    confirm: false,
                    confirmUpdate: false,
                  });
                  setPreview(null);
                }}
              >
                <option value="NEW">Create a separate new draft</option>
                <option value="SKIP">Merge into draft — skip matching source rows</option>
                <option value="UPDATE">
                  Merge into draft — explicitly update matching source rows
                </option>
              </select>
            </label>
            {settings.mode !== 'NEW' && (
              <label className="text-xs">
                Target draft
                <select
                  className={field}
                  value={settings.planId}
                  disabled={busy || targetsLoading}
                  onChange={(e) => {
                    setSettings({ ...settings, planId: e.target.value, confirm: false });
                    setPreview(null);
                  }}
                >
                  <option value="">Choose current draft…</option>
                  {targetPlans
                    .filter(
                      (p) =>
                        p.status === 'DRAFT' && p.financial_year === Number(settings.financialYear),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.financial_year} · {p.name} · revision {p.version} · {p.currency} ·{' '}
                        {p.inflation_bp / 100}% inflation
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
          {settings.mode !== 'NEW' && (
            <p role="status" className="text-xs">
              {targetsLoading
                ? 'Loading facility draft targets…'
                : `${targetPlans.length} draft target(s) for ${settings.financialYear}. Choose an existing draft to avoid creating a separate plan. Target year and inflation must match the preview.`}
            </p>
          )}
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.confirmAdditionalPlan}
              onChange={(e) =>
                setSettings({ ...settings, confirmAdditionalPlan: e.target.checked })
              }
            />
            Allow an additional separate draft for an existing facility/year
          </label>
          {settings.mode === 'UPDATE' && (
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.confirmUpdate}
                onChange={(e) =>
                  setSettings({ ...settings, confirmUpdate: e.target.checked, confirm: false })
                }
              />
              I explicitly authorize updates to matching draft records
            </label>
          )}
          <button
            className={button}
            disabled={busy || !mappings.length}
            onClick={() =>
              void run(async () => {
                const p = await planningApi.send<PlanningRow>(
                  facilityId,
                  `/imports/${batch.id}/preview`,
                  {
                    mappings,
                    inflationPercent: settings.inflationPercent,
                    policy: settings.policy,
                  },
                );
                setPreview(p);
                setSettings({ ...settings, confirm: false });
              })
            }
          >
            Validate and preview import
          </button>
          {preview && (
            <div className="space-y-3">
              <p className="font-semibold">
                Preview: {preview.rowCount} valid rows; {preview.errors.length} errors. No plan
                records have been imported.
              </p>
              {preview.errors.map((e: PlanningRow, n: number) => (
                <p key={n} className="text-sm text-red-700">
                  {e.sheet} row {e.row}: {e.message}
                </p>
              ))}
              {preview.warnings.map((w: string) => (
                <p key={w} className="text-xs text-amber-800">
                  {w}
                </p>
              ))}
              {preview.normalizations?.length > 0 && (
                <details>
                  <summary>
                    {preview.normalizations.length} defaulted cells — review original values (first
                    100)
                  </summary>
                  <ul className="text-xs">
                    {preview.normalizations.slice(0, 100).map((v: PlanningRow, n: number) => (
                      <li key={n}>
                        {v.sheet} row {v.row}, column {v.column}: {JSON.stringify(v.raw)} →{' '}
                        {v.value} ({v.reason})
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs">
                    All defaults and source bytes are retained in import history. These are
                    assumptions, not verified source zeros.
                  </p>
                </details>
              )}
              <div className="max-h-72 overflow-auto">
                <DataTable className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Description</th>
                      <th>Category</th>
                      <th>Values</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...preview.items, ...preview.uniforms].map((r: PlanningRow, n: number) => (
                      <tr key={n}>
                        <td>
                          {r.sourceWorksheet} row {r.sourceRow}
                        </td>
                        <td>{r.description}</td>
                        <td>{r.category}</td>
                        <td>
                          {r.unit
                            ? `${r.unit} · base ${r.basePrice} · quantities ${r.quantities.map((v: unknown) => (v === null ? 'blank' : v)).join(', ')}`
                            : `Staff ${r.staffCount} · per staff ${r.quantityPerStaff} · opening ${r.existingBalance} · contribution ${r.contributionPercent}% · ${r.balanceRule}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.confirm}
                  onChange={(e) => setSettings({ ...settings, confirm: e.target.checked })}
                />
                I reviewed categories, source rows, input values, blank quantities, inflation and
                uniform assumptions and confirm this import action
              </label>
              <button
                className={button}
                disabled={
                  busy ||
                  !settings.confirm ||
                  preview.errors.length > 0 ||
                  !preview.rowCount ||
                  (settings.mode === 'UPDATE' && !settings.confirmUpdate) ||
                  (settings.mode !== 'NEW' &&
                    (targetsLoading || !targetPlans.some((p) => p.id === Number(settings.planId))))
                }
                onClick={() =>
                  void run(async () => {
                    const target = targetPlans.find((p) => p.id === Number(settings.planId));
                    const result = await planningApi.send<PlanningRow>(
                      facilityId,
                      `/imports/${batch.id}/confirm`,
                      {
                        ...settings,
                        mappings,
                        previewHash: preview.previewHash,
                        planId: target?.id,
                        version: target?.version,
                      },
                    );
                    setSummary(result);
                    setBatch(null);
                    setPreview(null);
                    await reload();
                    onImported(result.planId);
                  })
                }
              >
                Confirm import
              </button>
            </div>
          )}
          <button
            className={quiet}
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  'Cancel this pending import? Source metadata and audit history will be retained.',
                )
              )
                void run(async () => {
                  await planningApi.send(facilityId, `/imports/${batch.id}/cancel`, {});
                  setBatch(null);
                  setPreview(null);
                  await reload();
                });
            }}
          >
            Cancel pending import
          </button>
        </section>
      )}
      {batch?.status === 'CANCELLED' && (
        <section
          aria-label="Cancelled batch inspection"
          className="rounded-xl border border-hair bg-surface p-4 space-y-3"
        >
          <h3 className="font-semibold">
            Cancelled batch #{batch.id} — read-only source inspection
          </h3>
          <p className="text-sm">
            Cancellation closes preview and import, not source inspection. No rows can be imported
            from this state. Retry review is an explicit, audited action on the same batch; it
            requires a fresh preview and separate import confirmation.
          </p>
          {batch.sheets.map((sheet: PlanningRow) => (
            <details key={sheet.name}>
              <summary>Inspect {sheet.name} retained source cells (first 40 rows)</summary>
              <div className="overflow-x-auto">
                <DataTable className="text-xs">
                  <tbody>
                    {sheet.preview.map((row: PlanningRow[], n: number) => (
                      <tr key={n}>
                        <th>{n + 1}</th>
                        {row.map((cell, col) => (
                          <td key={col}>
                            {cell?.formula ? `FORMULA: ${cell.formula}` : String(cell?.value ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
            </details>
          ))}
          <button className={quiet} disabled={busy} onClick={() => setBatch(null)}>
            Close inspection
          </button>
        </section>
      )}
      <section className="rounded-xl border border-hair bg-surface p-4 space-y-3">
        <h3 className="font-semibold">Import history (latest 100)</h3>
        {!history.length ? (
          <p className="text-sm">No uploaded planning workbooks found.</p>
        ) : (
          <div className="overflow-x-auto">
            <DataTable className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th>File / hash</th>
                  <th>Uploaded</th>
                  <th>Status</th>
                  <th>Counts</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.filename}
                      <br />
                      <span className="break-all">{r.sha256}</span>
                      <br />
                      {r.byte_size} bytes
                    </td>
                    <td>{String(r.created_at)}</td>
                    <td>{r.status}</td>
                    <td>
                      {r.result
                        ? `${r.result.created} created / ${r.result.updated} updated / ${r.result.skipped} skipped`
                        : r.validation
                          ? `${r.validation.rows} valid / ${r.validation.errors?.length ?? 0} errors`
                          : 'Not previewed'}
                    </td>
                    <td>
                      {r.status === 'UPLOADED' && (
                        <button
                          className={quiet}
                          disabled={busy}
                          onClick={() => void run(() => open(r.id))}
                        >
                          Review batch {r.id}
                        </button>
                      )}
                      {r.status === 'CANCELLED' && (
                        <div className="space-y-2">
                          <p>Cancelled — preview/import closed. Source and hash retained.</p>
                          <button
                            className={quiet}
                            disabled={busy}
                            onClick={() => void run(() => open(r.id))}
                          >
                            Inspect cancelled batch {r.id}
                          </button>
                          <button
                            className={quiet}
                            disabled={busy}
                            onClick={() => retryReview(r.id)}
                          >
                            Retry review of batch {r.id}
                          </button>
                        </div>
                      )}
                      {r.status === 'IMPORTED' && (
                        <p>Completed — re-import blocked; see recorded counts.</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
      </section>
    </div>
  );
}
