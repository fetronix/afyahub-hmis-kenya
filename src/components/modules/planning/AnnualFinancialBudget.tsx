import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Download,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  LockKeyhole,
  Pencil,
  Trash2,
  X,
  Calculator,
  FileSpreadsheet,
} from 'lucide-react';
import { planningApi, type Plan } from '../../../api/clients/planning.client.ts';
import {
  createFinancialBaseline,
  financialResetImpact,
  budgetMonths,
  type FinancialBudget,
  type BudgetLine,
  type BudgetDepartment,
} from '../../../budget-planning/financial-budget.model.ts';
import {
  calculateFinancialBudget,
  validateFinancialBudget,
  inputCents,
  replaceBudgetLine,
  type BudgetCell,
  type BudgetSeries,
} from '../../../budget-planning/financial-budget.engine.ts';
const control =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40';
const primary =
  'rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-40';
const field = 'mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900';
const money = (c: BudgetCell) =>
  c.error ??
  (c.cents === null
    ? 'Unavailable'
    : `KES ${(c.cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const percent = (c: BudgetCell) => c.error ?? `${((c.cents ?? 0) / 100).toFixed(2)}%`;
const stickyCode =
  'sm:sticky left-0 z-10 min-w-[104px] w-[104px] border-r border-slate-100 bg-white px-3 py-2 text-left font-mono text-[11px] text-slate-500';
const stickyName =
  'sm:sticky left-[104px] z-10 min-w-[292px] w-[292px] border-r border-slate-200 bg-white px-3 py-2 text-left';
const annual =
  'sm:sticky right-0 z-10 min-w-[174px] bg-slate-100 px-3 py-2 text-right font-semibold shadow-[-3px_0_5px_-4px_#334155]';

function EditableCell({
  cell,
  audit,
  editable,
  label,
  onCommit,
  onRestore,
}: {
  cell: BudgetCell;
  audit: boolean;
  editable: boolean;
  label: string;
  onCommit: (value: string) => void;
  onRestore: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(''),
    [error, setError] = useState('');
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    try {
      inputCents(draft.trim());
      finished.current = true;
      setEditing(false);
      setError('');
      onCommit(draft.trim());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (editing)
    return (
      <td className="relative min-w-[155px] bg-emerald-50 p-1 text-right">
        <input
          autoFocus
          aria-label={label}
          aria-invalid={!!error}
          inputMode="decimal"
          className="w-full rounded border-2 border-emerald-600 bg-white px-2 py-1 text-right text-xs outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              finish();
            }
            if (e.key === 'Escape') {
              finished.current = true;
              setEditing(false);
            }
          }}
        />
        {error && (
          <span role="alert" className="block text-xs text-red-700">
            {error}
          </span>
        )}
      </td>
    );
  return (
    <td
      className={`relative min-w-[155px] border-b border-slate-100 px-1 py-1 text-right ${cell.overridden ? 'bg-amber-50' : ''}`}
    >
      <button
        type="button"
        aria-label={`${label}: ${money(cell)}${cell.overridden ? ' (manual override)' : ''}`}
        disabled={!editable}
        title={`${cell.overridden ? 'Manual override. Baseline: ' : ''}${cell.formula}\nClick or double-click to edit; Enter/blur saves; Escape cancels.`}
        className={`w-full rounded px-2 py-2 text-right text-[11px] tabular-nums hover:bg-emerald-50 focus:ring-2 focus:ring-emerald-500 disabled:hover:bg-transparent ${cell.cents !== null && cell.cents < 0 ? 'text-red-700' : cell.error ? 'text-red-700' : 'text-slate-700'} ${audit && cell.formula.startsWith('=') ? 'font-mono' : ''}`}
        onClick={() => {
          finished.current = false;
          setDraft(((cell.cents ?? 0) / 100).toFixed(2));
          setEditing(true);
        }}
      >
        {audit && cell.formula.startsWith('=')
          ? cell.overridden
            ? `Override ${money(cell)} · ${cell.formula}`
            : cell.formula
          : money(cell)}
        {cell.overridden && (
          <span aria-hidden="true" className="ml-1 text-amber-700">
            ●
          </span>
        )}
      </button>
      {cell.overridden && editable && (
        <button
          className="text-[10px] text-amber-800 underline"
          aria-label={`Restore baseline ${label}`}
          onClick={onRestore}
        >
          Restore rule/value
        </button>
      )}
    </td>
  );
}
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const target =
      dialog.current?.querySelector<HTMLElement>('input, select, textarea') ??
      dialog.current?.querySelector<HTMLElement>('button');
    target?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4">
      <section
        ref={dialog}
        role="dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
          if (e.key !== 'Tab') return;
          const nodes = [
            ...(dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
            ) ?? []),
          ];
          const first = nodes[0],
            last = nodes.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <header className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button aria-label="Close budget dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function LineEditor({
  model,
  line,
  onSave,
  onClose,
}: {
  model: FinancialBudget;
  line?: BudgetLine;
  onSave: (line: BudgetLine) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(line?.name ?? ''),
    [departmentId, setDepartmentId] = useState(line?.departmentId ?? model.departments[0].id);
  const [mode, setMode] = useState(
    line?.cells.some((c) => c.startsWith('=')) ? 'Formula-Driven' : 'Manual Input',
  );
  const [seed, setSeed] = useState(line && !line.cells[0].startsWith('=') ? line.cells[0] : '0'),
    [formula, setFormula] = useState(
      line?.cells.find((c) => c.startsWith('=')) ?? '=[INC-01]*0.10',
    );
  const [firstManual, setFirstManual] = useState(line ? !line.cells[0].startsWith('=') : true),
    [margin, setMargin] = useState(line?.marginDepartmentId ?? '');
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const kind = model.departments.find((d) => d.id === departmentId)!.kind;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      inputCents(seed);
      const prefix = kind === 'INCOME' ? 'INC' : 'EXP';
      let n = 1;
      while (model.rows.some((r) => r.code === `${prefix}-X${String(n).padStart(3, '0')}`)) n++;
      const code = line?.code ?? `${prefix}-X${String(n).padStart(3, '0')}`;
      const cells =
        mode === 'Manual Input'
          ? line?.rule === 'Manual'
            ? line.cells
            : Array(12).fill(seed)
          : Array.from({ length: 12 }, (_, m) =>
              m === 0 && firstManual ? seed : formula.startsWith('=') ? formula : '=' + formula,
            );
      const unchanged = line && JSON.stringify(cells) === JSON.stringify(line.cells);
      const next: BudgetLine = {
        code,
        name: name.trim(),
        departmentId,
        rule: mode === 'Manual Input' ? 'Manual' : 'Volume-Linked',
        cells,
        overrides: unchanged ? line.overrides : {},
        custom: true,
        ...(kind === 'COGS' && margin ? { marginDepartmentId: margin } : {}),
      };
      const updated = {
        ...model,
        rows: line
          ? model.rows.map((r) => (r.code === line.code ? next : r))
          : [...model.rows, next],
      };
      validateFinancialBudget(updated);
      setSaving(true);
      if (await onSave(next)) onClose();
      else
        setError(
          'The line was not confirmed saved. Check the workspace error and reload the saved budget if required.',
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog title={line ? 'Edit custom budget line' : 'Add budget line'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <label className="block text-sm">
          Line item name
          <input
            autoFocus
            required
            maxLength={160}
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Department
          <select
            className={field}
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            {model.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.kind}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Input type
          <select className={field} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option>Manual Input</option>
            <option>Formula-Driven</option>
          </select>
        </label>
        {(!line || mode === 'Formula-Driven') && (
          <label className="block text-sm">
            {mode === 'Manual Input'
              ? 'Starting amount for all months (KES)'
              : 'January starting amount (KES)'}
            <input className={field} value={seed} onChange={(e) => setSeed(e.target.value)} />
          </label>
        )}
        {mode === 'Formula-Driven' && (
          <>
            <label className="block text-sm">
              Formula
              <input
                className={field + ' font-mono'}
                maxLength={500}
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
              />
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={firstManual}
                onChange={(e) => setFirstManual(e.target.checked)}
              />
              Use January starting amount; apply rule February–December
            </label>
            <p className="text-xs text-slate-600">
              Use [INC-01] for the same month, [INC-01@-1] for the previous month, PREV for this
              row's previous month, and + − * / ( ). Example: =[INC-01]*0.10. No executable code.
              Cycles, missing references and division by zero are rejected.
            </p>
            <p className="text-xs text-amber-800">
              Changing a rule rebuilds this custom row and clears its manual overrides. Annual
              percentages are weighted, never summed.
            </p>
          </>
        )}
        {kind === 'COGS' && (
          <label className="block text-sm">
            Departmental margin cost attribution
            <select className={field} value={margin} onChange={(e) => setMargin(e.target.value)}>
              <option value="">Unallocated (included in total COGS only)</option>
              {model.departments
                .filter((d) => d.kind === 'INCOME')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {line && mode === 'Manual Input' && (
          <p className="text-xs">Existing monthly inputs are retained. Edit them in the grid.</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button disabled={saving} className={primary}>
          {saving ? 'Saving…' : 'Save budget line'}
        </button>
      </form>
    </Dialog>
  );
}
function DepartmentEditor({
  onSave,
  onClose,
}: {
  onSave: (d: BudgetDepartment) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(''),
    [kind, setKind] = useState<BudgetDepartment['kind']>('INCOME'),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  return (
    <Dialog title="Add department" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSaving(true);
          void onSave({
            id: 'custom-' + crypto.randomUUID().slice(0, 8),
            name: name.trim(),
            kind,
            custom: true,
          })
            .then((ok) => {
              if (ok) onClose();
              else setError('Department could not be saved. Check the workspace message.');
            })
            .finally(() => setSaving(false));
        }}
      >
        <label className="block text-sm">
          Department name
          <input
            autoFocus
            required
            maxLength={100}
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Financial grouping
          <select
            className={field}
            value={kind}
            onChange={(e) => setKind(e.target.value as BudgetDepartment['kind'])}
          >
            <option value="INCOME">Income</option>
            <option value="COGS">Expenditure · COGS</option>
            <option value="OPEX">Expenditure · Operating expense</option>
          </select>
        </label>
        {error && <p role="alert">{error}</p>}
        <button disabled={saving} className={primary}>
          Save department
        </button>
      </form>
    </Dialog>
  );
}
export function FinancialBudgetGrid({
  model,
  facilityName = 'Syrona Medical Center',
  editable = true,
  canExport = false,
  busy = false,
  onChange,
  onReset,
  onExport,
  status,
}: {
  model: FinancialBudget;
  facilityName?: string;
  editable?: boolean;
  canExport?: boolean;
  busy?: boolean;
  onChange: (next: FinancialBudget) => Promise<boolean>;
  onReset: (confirmation: string, reason: string) => Promise<boolean>;
  onExport: (format: 'csv' | 'xlsx', audit: boolean) => Promise<void>;
  status?: string;
}) {
  const result = useMemo(() => calculateFinancialBudget(model), [model]);
  const [audit, setAudit] = useState(false),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [search, setSearch] = useState('');
  const [modal, setModal] = useState<'line' | 'department' | 'reset' | null>(null),
    [line, setLine] = useState<BudgetLine | undefined>(),
    [confirmation, setConfirmation] = useState(''),
    [resetReason, setResetReason] = useState('');
  const [pendingDelete, setPendingDelete] = useState<BudgetLine | null>(null),
    [error, setError] = useState('');
  const enabled = editable && !busy;
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const apply = async (next: FinancialBudget) => {
    setError('');
    try {
      validateFinancialBudget(next);
      return await onChange(next);
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const display = (c: BudgetCell, pct = false) =>
    audit && c.formula.startsWith('=') ? c.formula : pct ? percent(c) : money(c);
  const totalRow = (
    label: string,
    series: BudgetSeries,
    pct = false,
    strong = false,
    key = label,
  ) => (
    <tr
      key={key}
      className={
        strong ? 'bg-slate-900 font-bold text-white' : 'bg-slate-50 font-semibold text-slate-800'
      }
    >
      <th
        colSpan={3}
        className={`sm:sticky left-0 z-20 px-3 py-3 text-left text-xs ${strong ? 'bg-slate-900' : 'bg-slate-50'}`}
      >
        {label}
      </th>
      {series.months.map((c, m) => (
        <td
          key={m}
          title={c.formula}
          className={`min-w-[155px] px-3 py-3 text-right text-[11px] tabular-nums ${c.cents !== null && c.cents < 0 ? (strong ? 'text-red-300' : 'text-red-700') : ''} ${audit ? 'font-mono' : ''}`}
        >
          {display(c, pct)}
        </td>
      ))}
      <td
        className={`${annual} ${strong ? '!bg-slate-800 !text-white' : ''}`}
        title={series.annual.formula}
      >
        {display(series.annual, pct)}
      </td>
    </tr>
  );
  return (
    <section
      aria-label="Annual financial budget"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 bg-slate-900 px-6 py-6 text-white">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-emerald-300">
            <FileSpreadsheet size={16} /> Financial planning · FY 2026
          </div>
          <h2 className="text-2xl font-bold tracking-tight">{facilityName} — 2026 Annual Budget</h2>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-300">
            Supplied Syrona scenario • KES • Planning projections only, not posted revenue,
            expenditure or payroll. Zero statutory rows are editable assumptions, not verified
            rates.
          </p>
        </div>
        <span className="rounded-full border border-slate-600 px-3 py-1 text-xs">
          {editable ? 'Draft · editable' : 'Read-only'}
        </span>
      </header>
      <div className="grid gap-3 bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          ['Projected Income', result.income, undefined],
          ['Total COGS', result.cogs, undefined],
          ['Gross Profit', result.gross, result.grossMargin],
          ['Operational Expenses', result.expenses, undefined],
          ['Net Profit / (Loss)', result.net, result.netMargin],
        ].map(([label, series, margin]) => {
          const s = series as BudgetSeries,
            m = margin as BudgetSeries | undefined;
          return (
            <article
              key={label as string}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {label as string}
              </p>
              <p
                className={`mt-2 text-lg font-bold tabular-nums ${s.annual.cents !== null && s.annual.cents < 0 ? 'text-red-700' : 'text-slate-900'}`}
              >
                {money(s.annual)}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {m
                  ? `${percent(m.annual)} annual margin`
                  : label === 'Operational Expenses'
                    ? 'Includes COGS & depreciation'
                    : 'January–December 2026'}
              </p>
            </article>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-200 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={!enabled}
            className={primary}
            onClick={() => {
              setLine(undefined);
              setModal('line');
            }}
          >
            <Plus size={14} className="mr-1 inline" />
            Add line item
          </button>
          <button disabled={!enabled} className={control} onClick={() => setModal('department')}>
            Add department
          </button>
          <input
            aria-label="Search budget lines"
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
            placeholder="Find a line or row code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800">
            <Calculator size={14} />
            <input type="checkbox" checked={audit} onChange={(e) => setAudit(e.target.checked)} />
            {audit ? 'Formula Audit View' : 'Calculated Values View'}
          </label>
          {canExport &&
            (['csv', 'xlsx'] as const).map((f) => (
              <button
                disabled={busy}
                key={f}
                className={control}
                onClick={() => void onExport(f, audit).catch((e) => setError(e.message))}
              >
                <Download size={13} className="mr-1 inline" />
                {f === 'csv' ? 'CSV' : 'Excel'}
              </button>
            ))}
          <button
            disabled={!enabled}
            className={control}
            onClick={() => {
              setConfirmation('');
              setResetReason('');
              setModal('reset');
            }}
          >
            <RotateCcw size={13} className="mr-1 inline" />
            Reset baseline
          </button>
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-2 px-4 py-2 text-[11px] text-slate-500">
        <span>
          Click a month to edit · Enter/blur saves · Esc cancels · Swipe the grid on mobile ·{' '}
          <span className="text-amber-700">● manual override</span> · Totals include hidden rows.
        </span>
        <span role="status">
          {busy ? 'Saving to facility plan…' : (status ?? 'Live calculations')}
          {!editable && ' · Protected / read-only'}
        </span>
      </div>
      {error && (
        <p role="alert" className="mx-4 mb-3 rounded bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      <div
        role="region"
        aria-label="Scrollable 12-month budget grid"
        tabIndex={0}
        className="max-h-[72vh] overflow-auto border-t border-slate-200"
      >
        <table className="w-full border-separate border-spacing-0 text-xs">
          <caption className="sr-only">
            2026 annual financial budget, 16 columns. First two columns and annual totals are
            sticky. Percentage annual totals are weighted ratios.
          </caption>
          <thead className="sticky top-0 z-40">
            <tr>
              <th className={stickyCode + ' !z-50 !bg-slate-100 py-4'}>Row ref</th>
              <th className={stickyName + ' !z-50 !bg-slate-100 py-4'}>Department / Line Item</th>
              <th className="min-w-[135px] bg-slate-100 px-3 text-left">Rule / Formula Type</th>
              {budgetMonths.map((m) => (
                <th
                  key={m}
                  className="min-w-[155px] bg-slate-100 px-3 py-4 text-right font-semibold text-slate-600"
                >
                  {m} 2026
                </th>
              ))}
              <th className={annual + ' !z-50 !bg-slate-200 py-4'}>Annual Total</th>
            </tr>
          </thead>
          <tbody>
            {(['INCOME', 'EXPENDITURE'] as const).map((side) => (
              <React.Fragment key={side}>
                <tr className="bg-emerald-900 text-white">
                  <th colSpan={16} className="px-3 py-3 text-left">
                    <button
                      className="sm:sticky left-3 flex items-center gap-2"
                      aria-expanded={!collapsed.has(side)}
                      onClick={() => toggle(side)}
                    >
                      {collapsed.has(side) ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      PART{' '}
                      {side === 'INCOME' ? 'A · PROJECTED INCOME' : 'B · PROJECTED EXPENDITURE'}
                    </button>
                  </th>
                </tr>
                {!collapsed.has(side) &&
                  model.departments
                    .filter((d) => (side === 'INCOME' ? d.kind === 'INCOME' : d.kind !== 'INCOME'))
                    .map((d) => {
                      const lines = model.rows.filter(
                        (r) =>
                          r.departmentId === d.id &&
                          (!search ||
                            `${r.code} ${r.name} ${d.name}`
                              .toLowerCase()
                              .includes(search.toLowerCase())),
                      );
                      return (
                        <React.Fragment key={d.id}>
                          <tr className="bg-slate-100">
                            <th colSpan={16} className="px-3 py-3 text-left">
                              <div className="sm:sticky left-3 inline-flex items-center gap-3">
                                <button
                                  className="flex items-center gap-2 font-semibold text-slate-800"
                                  aria-expanded={!collapsed.has('d:' + d.id)}
                                  onClick={() => toggle('d:' + d.id)}
                                >
                                  {collapsed.has('d:' + d.id) ? (
                                    <ChevronRight size={14} />
                                  ) : (
                                    <ChevronDown size={14} />
                                  )}{' '}
                                  {d.name}
                                  <span className="rounded bg-white px-2 py-0.5 text-[10px] font-normal text-slate-500">
                                    {lines.length} lines
                                  </span>
                                </button>
                                {enabled &&
                                  d.custom &&
                                  !model.rows.some((r) => r.departmentId === d.id) && (
                                    <button
                                      className="text-xs text-red-700 underline"
                                      onClick={() =>
                                        void apply({
                                          ...model,
                                          departments: model.departments.filter(
                                            (v) => v.id !== d.id,
                                          ),
                                        })
                                      }
                                    >
                                      Delete empty department
                                    </button>
                                  )}
                              </div>
                            </th>
                          </tr>
                          {!collapsed.has('d:' + d.id) &&
                            lines.map((row) => (
                              <tr key={row.code} className="group">
                                <th className={stickyCode}>{row.code}</th>
                                <th
                                  className={stickyName + ' text-[11px] font-medium text-slate-800'}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span>{row.name}</span>
                                    {row.custom && enabled && (
                                      <span className="flex gap-1">
                                        <button
                                          aria-label={`Edit ${row.code}`}
                                          className="p-1 text-slate-500"
                                          onClick={() => {
                                            setLine(row);
                                            setModal('line');
                                          }}
                                        >
                                          <Pencil size={13} />
                                        </button>
                                        <button
                                          aria-label={`Delete ${row.code}`}
                                          className="p-1 text-red-600"
                                          onClick={() => setPendingDelete(row)}
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      </span>
                                    )}
                                  </div>
                                  {row.code === 'EXP-38' && (
                                    <label className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
                                      <input
                                        type="checkbox"
                                        checked={model.dialysisFeesAprDec}
                                        disabled={!enabled}
                                        onChange={(e) =>
                                          void apply({
                                            ...model,
                                            dialysisFeesAprDec: e.target.checked,
                                          })
                                        }
                                      />
                                      70% dialysis fees Apr–Dec
                                    </label>
                                  )}
                                </th>
                                <td className="border-b border-slate-100 px-3">
                                  <span
                                    className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-medium ${row.rule === 'Manual' ? 'bg-slate-100 text-slate-600' : row.rule === 'Revenue %' ? 'bg-violet-50 text-violet-800' : 'bg-blue-50 text-blue-800'}`}
                                  >
                                    {row.rule}
                                  </span>
                                </td>
                                {result.rows[row.code].months.map((c, m) => (
                                  <EditableCell
                                    key={m}
                                    cell={c}
                                    label={`${row.code} ${budgetMonths[m]} 2026`}
                                    audit={audit}
                                    editable={enabled}
                                    onCommit={(value) =>
                                      void apply(
                                        replaceBudgetLine(model, {
                                          ...row,
                                          overrides: { ...row.overrides, [m]: value },
                                        }),
                                      )
                                    }
                                    onRestore={() => {
                                      const overrides = { ...row.overrides };
                                      delete overrides[m];
                                      void apply(replaceBudgetLine(model, { ...row, overrides }));
                                    }}
                                  />
                                ))}
                                <td className={annual} title="=SUM(Jan:Dec)">
                                  {display(result.rows[row.code].annual)}
                                </td>
                              </tr>
                            ))}
                          {totalRow(
                            'Sub-Total ' + d.name,
                            result.departments[d.id],
                            false,
                            false,
                            d.id + 'total',
                          )}
                        </React.Fragment>
                      );
                    })}
                {totalRow(
                  side === 'INCOME'
                    ? 'GRAND TOTAL PROJECTED INCOME'
                    : 'TOTAL OPERATIONAL EXPENSES (including COGS & depreciation)',
                  side === 'INCOME' ? result.income : result.expenses,
                  false,
                  true,
                )}
              </React.Fragment>
            ))}
            <tr>
              <th colSpan={16} className="bg-indigo-100 px-3 py-4 text-left text-indigo-950">
                <span className="sm:sticky left-3">PART C · PROFITABILITY & KPI SUMMARY</span>
              </th>
            </tr>
            {totalRow('Gross Profit', result.gross)}
            {totalRow('Net Profit / (Loss)', result.net, false, true)}
            {totalRow('Gross Profit Margin (%)', result.grossMargin, true)}
            {totalRow('Net Profit Margin (%)', result.netMargin, true)}
            {totalRow('Operating Expense Ratio (%)', result.expenseRatio, true)}
            {totalRow('COGS Ratio (%)', result.cogsRatio, true)}
            {model.departments
              .filter((d) => d.kind === 'INCOME')
              .map((d) => totalRow(d.name + ' Margin (%)', result.departmentalMargins[d.id], true))}
          </tbody>
        </table>
      </div>
      <footer className="flex items-start gap-2 bg-slate-50 p-4 text-[11px] leading-5 text-slate-500">
        <LockKeyhole size={16} className="mt-1 shrink-0" />
        <p>
          Baseline rules preserve the supplied assumptions, including the Haematology denominator
          change to 1,000 from June and the prescription formula's April/May step. These are not
          silently reconciled. The professional-fee dialysis toggle is off by default for Apr–Dec.
          Annual margin percentages use annual numerators/denominators, with a 0% fallback when
          revenue is not positive. None of these projections creates a ledger entry, purchase order,
          stock movement or payroll charge.
        </p>
      </footer>
      {modal === 'line' && (
        <LineEditor
          model={model}
          line={line}
          onSave={(row) =>
            apply({
              ...model,
              rows: line
                ? model.rows.map((r) => (r.code === line.code ? row : r))
                : [...model.rows, row],
            })
          }
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'department' && (
        <DepartmentEditor
          onSave={(d) => apply({ ...model, departments: [...model.departments, d] })}
          onClose={() => setModal(null)}
        />
      )}
      {pendingDelete && (
        <Dialog title="Delete custom budget line" onClose={() => setPendingDelete(null)}>
          <p className="text-sm">
            Remove {pendingDelete.code} — {pendingDelete.name}, including all 12 months? Rows with
            dependent formulas cannot be removed until those formulas are changed. The previous
            model is retained in audit history.
          </p>
          <div className="mt-5 flex gap-2">
            <button className={control} onClick={() => setPendingDelete(null)}>
              Cancel
            </button>
            <button
              disabled={busy}
              className={primary}
              onClick={() =>
                void apply({
                  ...model,
                  rows: model.rows.filter((r) => r.code !== pendingDelete.code),
                }).then((ok) => {
                  if (ok) setPendingDelete(null);
                })
              }
            >
              Delete custom line
            </button>
          </div>
        </Dialog>
      )}
      {modal === 'reset' && (
        <Dialog title="Reset financial baseline" onClose={() => setModal(null)}>
          <p className="text-sm">
            Replace only this plan's financial scenario with the supplied Syrona 2026 baseline. All
            custom financial rows/departments and manual overrides will be removed.
            Stationery/uniform procurement records, import history, audit, letterheads and actual
            accounting are untouched.
          </p>
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
            Reset preview: {financialResetImpact(model).customRows} custom rows,{' '}
            {financialResetImpact(model).customDepartments} custom departments and{' '}
            {financialResetImpact(model).monthlyOverrides} monthly overrides will be removed.
            {model.dialysisFeesAprDec &&
              ' The optional April–December dialysis fees will be turned off.'}
          </p>
          <label className="mt-4 block text-sm">
            Audit reason (10–500 characters)
            <textarea
              className={field}
              minLength={10}
              maxLength={500}
              value={resetReason}
              onChange={(e) => setResetReason(e.target.value)}
            />
          </label>
          <label className="mt-4 block text-sm">
            Type RESET FINANCIAL BASELINE
            <input
              className={field}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <button
            disabled={
              !enabled ||
              confirmation !== 'RESET FINANCIAL BASELINE' ||
              resetReason.trim().length < 10 ||
              resetReason.trim().length > 500
            }
            className={primary + ' mt-4'}
            onClick={() =>
              void onReset(confirmation, resetReason.trim()).then((ok) => {
                if (ok) setModal(null);
              })
            }
          >
            Confirm baseline reset
          </button>
        </Dialog>
      )}
    </section>
  );
}
type Loaded = { plan: Plan; facility: { id: number; name: string }; model: FinancialBudget | null };
type AnnualFinancialBudgetProps = {
  facilityId: number;
  planId: number;
  canManage: boolean;
  canExport: boolean;
  onSaved: () => void;
};
/** A changed destination must never reuse the previous plan's loaded model/version. */
export function AnnualFinancialBudget(props: AnnualFinancialBudgetProps) {
  return <FinancialBudgetSession key={`${props.facilityId}:${props.planId}`} {...props} />;
}
function FinancialBudgetSession({
  facilityId,
  planId,
  canManage,
  canExport,
  onSaved,
}: AnnualFinancialBudgetProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null),
    [model, setModel] = useState<FinancialBudget>(() => createFinancialBaseline()),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [status, setStatus] = useState(''),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    planningApi
      .get<Loaded>(facilityId, `/plans/${planId}/financial-budget`)
      .then((r) => {
        if (live) {
          setLoaded(r);
          setModel(r.model ?? createFinancialBaseline());
          setBlocked(false);
          setError('');
          setStatus(
            r.model
              ? 'Saved facility scenario · revision ' + r.plan.version
              : 'Unsaved baseline preview — no financial records created',
          );
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [facilityId, planId, refresh]);
  const save = async (next: FinancialBudget, confirmation?: string, reason?: string) => {
    if (!loaded || busy || blocked) return false;
    setBusy(true);
    setError('');
    try {
      validateFinancialBudget(next);
      setModel(next);
      const saved = await planningApi.send<{ plan: Plan; model: FinancialBudget }>(
        facilityId,
        `/plans/${planId}/financial-budget${confirmation ? '/reset' : ''}`,
        confirmation
          ? { version: loaded.plan.version, confirmation, reason }
          : { version: loaded.plan.version, model: next },
        confirmation ? 'POST' : 'PUT',
      );
      setLoaded({ ...loaded, ...saved });
      setModel(saved.model);
      setStatus('Saved facility scenario · revision ' + saved.plan.version);
      onSaved();
      return true;
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : 'Save could not be verified.'} Reload the saved budget before further edits. Your visible changes are not a confirmed receipt.`,
      );
      setBlocked(true);
      setStatus('Unsaved / unverified changes — reload required');
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!loaded)
    return (
      <div role={error ? 'alert' : 'status'} className="rounded border p-4">
        {error || 'Loading annual financial scenario…'}
      </div>
    );
  const eligible =
    loaded.plan.status === 'DRAFT' &&
    loaded.plan.financial_year === 2026 &&
    loaded.plan.currency === 'KES';
  return (
    <div className="space-y-3">
      {error && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs">
        <p>
          Destination: <strong>{loaded.facility.name}</strong> · {loaded.plan.name} ·{' '}
          {loaded.plan.financial_year} · {loaded.plan.currency} · {loaded.plan.status}.{' '}
          {!eligible && 'Select a 2026 KES draft to edit this supplied scenario.'}
        </p>
        <button
          className={control}
          disabled={busy}
          onClick={() => {
            setLoaded(null);
            setRefresh((n) => n + 1);
          }}
        >
          Reload saved budget
        </button>
      </div>
      {!loaded.model && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <p>
            This is the supplied baseline preview, not an existing facility budget. Loading the page
            makes no writes.
          </p>
          <button
            disabled={!canManage || !eligible || busy || blocked}
            className={primary}
            onClick={() => void save(createFinancialBaseline())}
          >
            Use baseline in this draft
          </button>
        </div>
      )}
      <FinancialBudgetGrid
        model={model}
        facilityName={loaded.facility.name}
        editable={canManage && eligible && !!loaded.model && !blocked}
        canExport={canExport && !!loaded.model && !blocked}
        busy={busy}
        onChange={save}
        onReset={(confirmation, reason) => save(createFinancialBaseline(), confirmation, reason)}
        onExport={(format, audit) =>
          planningApi.financialBudgetFile(facilityId, planId, format, audit)
        }
        status={status}
      />
    </div>
  );
}
