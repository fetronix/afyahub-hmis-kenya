import React, { useEffect, useMemo, useState } from 'react';
import { equityApi } from '../../../api/clients/equity.client.ts';
import {
  baselineEquity,
  baselinePartners,
  emptyInputs,
  equityRows,
  equityTitle,
  formulaDefinitions,
  formulaNotice,
  inputKeys,
  type EquityModel,
  type InputKey,
  type Partner,
} from '../../../partner-equity/model.ts';
import { calculateEquity, cents } from '../../../partner-equity/calculations.ts';
import type { Statement } from '../../../partner-equity/service.ts';
import { PartnerEquityCharts } from './PartnerEquityCharts.tsx';
const field = 'rounded border border-slate-300 bg-white p-2 text-sm text-slate-900';
const button =
  'rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40';
const primary =
  'rounded bg-emerald-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40';
const money = (v: string | null, pct = false) =>
  v === null
    ? '—'
    : pct
      ? `${Number(v).toFixed(2)}%`
      : `KES ${Number(v).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type Register = { version: number; partners: Partner[] };
type Carry = {
  source: Statement;
  target: Statement;
  opening: { partner: Partner; amount: string | null }[];
  total: string;
  displayRoundingCents: string;
};
function AmountInput({
  value,
  nullable = false,
  label,
  disabled,
  onValue,
  onValidity,
}: {
  value: string | null;
  nullable?: boolean;
  label: string;
  disabled: boolean;
  onValue: (v: string | null) => void;
  onValidity: (valid: boolean) => void;
}) {
  const [text, setText] = useState(value ?? '');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(value ?? '');
    setInvalid(false);
  }, [value]);
  return (
    <input
      aria-label={label}
      aria-invalid={invalid}
      disabled={disabled}
      className={field + ' w-[160px] text-right ' + (text.startsWith('-') ? 'text-red-700' : '')}
      value={text}
      placeholder="— unspecified"
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        try {
          if (!(nullable && v === '')) cents(v);
          onValue(nullable && v === '' ? null : v);
          setInvalid(false);
          onValidity(true);
        } catch {
          setInvalid(true);
          onValidity(false);
        }
      }}
    />
  );
}
function PartnerForm({
  partner,
  onSave,
}: {
  partner: Partner;
  onSave: (p: Partner) => Promise<void>;
}) {
  const [p, setP] = useState(partner);
  return (
    <form
      className="grid gap-2 rounded border p-3 md:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(p);
      }}
    >
      <label>
        Name
        <input
          aria-label={`Partner name ${p.id}`}
          className={field + ' w-full'}
          value={p.name}
          disabled={p.original}
          onChange={(e) => setP({ ...p, name: e.target.value })}
          required
          maxLength={150}
        />
      </label>
      <label>
        Admission
        <input
          className={field + ' w-full'}
          type="date"
          value={p.admittedOn ?? ''}
          onChange={(e) => setP({ ...p, admittedOn: e.target.value || null })}
          required={!p.original}
        />
      </label>
      <label>
        Departure
        <input
          className={field + ' w-full'}
          type="date"
          value={p.departedOn ?? ''}
          onChange={(e) => setP({ ...p, departedOn: e.target.value || null })}
        />
      </label>
      <label>
        Display order
        <input
          className={field + ' w-full'}
          type="number"
          min={0}
          max={999}
          value={p.order}
          onChange={(e) => setP({ ...p, order: Number(e.target.value) })}
        />
      </label>
      <div className="space-y-2">
        <label>
          <input
            type="checkbox"
            checked={p.active}
            onChange={(e) => setP({ ...p, active: e.target.checked })}
          />{' '}
          Active
        </label>
        <button className={button}>Save partner details</button>
      </div>
    </form>
  );
}
export function PartnerEquityWorkspace({
  facilityId,
  facilityName,
  permissions,
}: {
  facilityId: number;
  facilityName: string;
  permissions: string[];
}) {
  if (!permissions.includes('accounting.equity.read'))
    return <p role="alert">Partner equity access requires accounting.equity.read permission.</p>;
  return (
    <EquitySession
      key={facilityId}
      facilityId={facilityId}
      facilityName={facilityName}
      permissions={permissions}
    />
  );
}
function EquitySession({
  facilityId,
  facilityName,
  permissions,
}: {
  facilityId: number;
  facilityName: string;
  permissions: string[];
}) {
  const can = (p: string) => permissions.includes('accounting.equity.' + p);
  const readAllowed = permissions.includes('accounting.equity.read');
  const [year, setYear] = useState(2026),
    [list, setList] = useState<Statement[]>([]),
    [id, setId] = useState(''),
    [saved, setSaved] = useState<Statement | null>(null),
    [model, setModel] = useState<EquityModel | null>(null),
    [directory, setDirectory] = useState<Register>({ version: 0, partners: baselinePartners() }),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [refresh, setRefresh] = useState(0),
    [charts, setCharts] = useState(true),
    [presentation, setPresentation] = useState(false),
    [audit, setAudit] = useState<unknown[]>([]),
    [creating, setCreating] = useState(false),
    [partnersOpen, setPartnersOpen] = useState(false),
    [newPartner, setNewPartner] = useState<Partner | null>(null),
    [sourceId, setSourceId] = useState(''),
    [carry, setCarry] = useState<Carry | null>(null),
    [confirmation, setConfirmation] = useState(''),
    [acceptance, setAcceptance] = useState(''),
    [includeId, setIncludeId] = useState(''),
    [invalidInputs, setInvalidInputs] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState({
    financialYear: 2026,
    periodKind: 'ANNUAL',
    periodName: 'July 2025 – June 2026',
    startDate: '2025-07-01',
    endDate: '2026-06-30',
    source: 'SYRONA_SCREENSHOT',
  });
  useEffect(() => {
    if (!readAllowed) return;
    let live = true;
    equityApi
      .get<Statement[]>(`/statements?year=${year}`)
      .then((r) => {
        if (live) {
          setList(r);
          setId((old) => (r.some((s) => String(s.id) === old) ? old : r[0] ? String(r[0].id) : ''));
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    equityApi
      .get<Register>('/partners')
      .then((r) => {
        if (live) setDirectory(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [year, refresh, readAllowed]);
  useEffect(() => {
    setSaved(null);
    setModel(null);
    setCarry(null);
    setAudit([]);
    setBlocked(false);
    setInvalidInputs(new Set());
    if (!id) return;
    let live = true;
    equityApi
      .get<Statement>('/statements/' + id)
      .then((s) => {
        if (live) {
          setSaved(s);
          setModel(s.model);
          setError('');
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, refresh]);
  const result = useMemo(() => {
    try {
      return model ? calculateEquity(model) : null;
    } catch {
      return null;
    }
  }, [model]);
  const validity = (key: string, valid: boolean) =>
    setInvalidInputs((current) => {
      const next = new Set(current);
      if (valid) next.delete(key);
      else next.add(key);
      return next;
    });
  const dirty =
    !!saved && (JSON.stringify(model) !== JSON.stringify(saved.model) || invalidInputs.size > 0);
  const editable = can('manage') && saved?.status === 'DRAFT' && !busy && !blocked;
  const run = async (fn: () => Promise<unknown>, reload = true) => {
    if (busy || blocked) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      if (reload) setRefresh((x) => x + 1);
    } catch (e) {
      setError(
        (e as Error).message +
          ' No successful receipt was confirmed. Reload saved statement before further writes.',
      );
      setBlocked(true);
    } finally {
      setBusy(false);
    }
  };
  const action = async (path: string, extra: Record<string, unknown> = {}) =>
    run(async () => {
      if (!saved || dirty || invalidInputs.size > 0)
        throw Error('Save or reload draft inputs before workflow actions.');
      await equityApi.send(`/statements/${saved.id}/${path}`, {
        version: saved.version,
        reason,
        ...extra,
      });
    });
  if (!can('read'))
    return <p role="alert">Partner statements require accounting.equity.read permission.</p>;
  const safeId = saved && String(saved.id) === id ? saved : null;
  return (
    <section id="equity-presentation" className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">
          Partner financial statements · independent of posted accounting
        </p>
        <h2 className="text-2xl font-bold">{equityTitle}</h2>
        <p>{safeId?.facility_name ?? facilityName} · KES</p>
        <p className="text-xs text-slate-600">
          Authenticated facility #{facilityId}. Statement currency: KES.
          {safeId?.facility_currency && (
            <> Facility currency (tenant setting): {safeId.facility_currency}.</>
          )}
        </p>
        {safeId?.facility_currency && safeId.facility_currency !== 'KES' && (
          <p role="alert" className="text-amber-800">
            This source statement is in KES; the configured facility currency differs. No currency
            conversion has been performed.
          </p>
        )}
        <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          {formulaNotice}
        </p>
      </header>
      {!presentation && (
        <section
          className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4"
          aria-label="Statement period controls"
        >
          <label>
            Financial year
            <input
              className={field + ' block'}
              aria-label="Statement financial year"
              type="number"
              min={2000}
              max={2200}
              value={year}
              onChange={(e) => {
                if (dirty && !window.confirm('Discard unsaved local changes?')) return;
                setSaved(null);
                setModel(null);
                setId('');
                setYear(Number(e.target.value));
              }}
            />
          </label>
          <label className="min-w-0 max-w-full">
            Reporting period / revision
            <select
              className={field + ' block max-w-full'}
              value={id}
              onChange={(e) => {
                if (dirty && !window.confirm('Discard unsaved local changes?')) return;
                setSaved(null);
                setModel(null);
                setId(e.target.value);
              }}
            >
              <option value="">Select a saved statement…</option>
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.period_name} · {s.start_date} to {s.end_date} · R{s.revision} · {s.status}
                </option>
              ))}
            </select>
          </label>
          <button
            className={button}
            disabled={busy}
            onClick={() => {
              if (!dirty || window.confirm('Discard unsaved local changes?')) {
                setSaved(null);
                setModel(null);
                setBlocked(false);
                setRefresh((x) => x + 1);
              }
            }}
          >
            Reload saved statement
          </button>
          {can('manage') && (
            <button className={primary} onClick={() => setCreating(!creating)}>
              Create statement / period
            </button>
          )}
          {can('partners') && (
            <button className={button} onClick={() => setPartnersOpen(!partnersOpen)}>
              Partner register
            </button>
          )}
        </section>
      )}
      {!presentation && (
        <label className="block text-sm">
          Audit reason (10–500 characters)
          <input
            aria-label="Equity audit reason"
            placeholder="e.g. Correct capital contribution from reviewed bank advice"
            className={field + ' ml-2 min-w-[280px]'}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <span className="block text-xs text-slate-600">
            Describe what changed and why. Your identity is recorded separately; do not use a
            username as the reason.
          </span>
        </label>
      )}
      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {blocked && (
        <p className="font-semibold text-red-800">Unsaved / unverified — reload required.</p>
      )}
      {creating && !presentation && (
        <form
          aria-label="Create financial statement"
          className="grid gap-3 rounded border bg-white p-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await equityApi.send<{ id: number }>('/statements', { ...period, reason });
              setYear(period.financialYear);
              setId(String(r.id));
              setCreating(false);
            });
          }}
        >
          <label>
            Ending financial year
            <input
              className={field + ' block'}
              type="number"
              value={period.financialYear}
              onChange={(e) => setPeriod({ ...period, financialYear: Number(e.target.value) })}
            />
          </label>
          <label>
            Period type
            <select
              className={field + ' block'}
              value={period.periodKind}
              onChange={(e) => setPeriod({ ...period, periodKind: e.target.value })}
            >
              <option value="ANNUAL">Annual</option>
              <option value="OTHER">Other reporting period</option>
            </select>
          </label>
          <label>
            Period name
            <input
              className={field + ' block'}
              value={period.periodName}
              onChange={(e) => setPeriod({ ...period, periodName: e.target.value })}
            />
          </label>
          <label>
            Start date
            <input
              className={field + ' block'}
              type="date"
              value={period.startDate}
              onChange={(e) => setPeriod({ ...period, startDate: e.target.value })}
            />
          </label>
          <label>
            End date
            <input
              className={field + ' block'}
              type="date"
              value={period.endDate}
              onChange={(e) => setPeriod({ ...period, endDate: e.target.value })}
            />
          </label>
          <label>
            Initial data
            <select
              className={field + ' block'}
              value={period.source}
              onChange={(e) => setPeriod({ ...period, source: e.target.value })}
            >
              <option value="SYRONA_SCREENSHOT">Supplied July 2025–June 2026 screenshot</option>
              <option value="BLANK">Blank — no automatic carry-forward</option>
            </select>
          </label>
          <button className={primary} disabled={busy || blocked || reason.trim().length < 10}>
            Create saved draft
          </button>
        </form>
      )}
      {partnersOpen && !presentation && (
        <section aria-label="Partner register" className="space-y-3 rounded border bg-white p-4">
          <h3 className="font-bold">Effective-dated partner register</h3>
          <p className="text-sm">
            No permanent deletion. Changes apply to future statements; existing statement snapshots
            are retained. Original source names cannot be overwritten. Explicit inclusion adds a
            newly admitted partner to a draft without changing existing partners’ historical inputs.
          </p>
          {directory.partners.map((p) => (
            <PartnerForm
              key={p.id + '-' + directory.version}
              partner={p}
              onSave={async (partner) =>
                run(async () => {
                  await equityApi.send(
                    '/partners',
                    { version: directory.version, partner, reason },
                    'PUT',
                  );
                })
              }
            />
          ))}
          <button
            className={button}
            disabled={busy || blocked}
            onClick={() =>
              setNewPartner({
                id: 'partner-' + crypto.randomUUID(),
                name: '',
                admittedOn: new Date().toISOString().slice(0, 10),
                departedOn: null,
                active: true,
                original: false,
                order: directory.partners.length,
              })
            }
          >
            Add partner
          </button>
          {newPartner && (
            <PartnerForm
              partner={newPartner}
              onSave={async (partner) =>
                run(async () => {
                  await equityApi.send(
                    '/partners',
                    { version: directory.version, partner, reason },
                    'PUT',
                  );
                  setNewPartner(null);
                })
              }
            />
          )}
        </section>
      )}
      {!safeId && !creating && (
        <p>
          {id
            ? 'Loading selected statement…'
            : 'No saved statement in this financial year. Create an explicit draft; page loading makes no writes.'}
        </p>
      )}
      {safeId && model && result && (
        <>
          <div className="rounded border bg-white p-3">
            <strong>
              {safeId.period_name} · {safeId.start_date} to {safeId.end_date}
            </strong>
            <p>
              Financial year {safeId.financial_year} · {safeId.status} · Revision {safeId.revision}{' '}
              · Version {safeId.version} · {dirty ? 'Unsaved draft changes' : 'Saved statement'}
            </p>
            <p className="text-xs">
              Prepared by {safeId.prepared_name ?? safeId.prepared_by} ·{' '}
              {String(safeId.prepared_at)} | Reviewed by {safeId.reviewed_name ?? 'Pending'} ·{' '}
              {safeId.reviewed_at ? String(safeId.reviewed_at) : 'Not reviewed'} | Approved by{' '}
              {safeId.approved_name ?? 'Pending'} ·{' '}
              {safeId.approved_at ? String(safeId.approved_at) : 'Not approved'}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[
              ['Total opening equity', 'opening'],
              ['Additional capital contributions', 'capital'],
              ['Partner salaries', 'salary'],
              ['Allocated profit/loss', 'allocation'],
              ['Drawings', 'drawings'],
              ['Closing equity', 'closing'],
            ].map(([label, key]) => (
              <article key={key} className="rounded-xl border bg-white p-4">
                <h3 className="text-xs uppercase text-slate-500">{label}</h3>
                <p
                  className={
                    'mt-2 text-xl font-bold ' +
                    (Number(result.totals[key as 'opening']) < 0 ? 'text-red-700' : '')
                  }
                >
                  {money(result.totals[key as 'opening'])}
                </p>
              </article>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label>
              <input
                type="checkbox"
                checked={charts}
                onChange={(e) => setCharts(e.target.checked)}
              />{' '}
              Show charts
            </label>
            <button className={button} onClick={() => setPresentation(!presentation)}>
              {presentation ? 'Exit presentation' : 'Executive presentation'}
            </button>
            {can('export') &&
              (['csv', 'xlsx', 'pdf'] as const).map((f) => (
                <button
                  key={f}
                  className={button}
                  disabled={busy || blocked || dirty || invalidInputs.size > 0}
                  onClick={() => void run(() => equityApi.download(safeId.id, f), false)}
                >
                  {f.toUpperCase()} export
                </button>
              ))}
          </div>
          {charts && <PartnerEquityCharts model={model} result={result} />}
          {!presentation && (
            <div className="flex flex-wrap items-center gap-3">
              <label>
                Statement net profit / (loss)
                <AmountInput
                  label="Statement net result"
                  value={model.netResult}
                  disabled={!editable}
                  onValidity={(valid) => validity('netResult', valid)}
                  onValue={(value) => {
                    const next = { ...model, netResult: value! };
                    calculateEquity(next);
                    setModel(next);
                  }}
                />
              </label>
              <button
                className={primary}
                disabled={
                  !editable || !dirty || reason.trim().length < 10 || invalidInputs.size > 0
                }
                onClick={() =>
                  void run(async () => {
                    const next = await equityApi.send<Statement>(
                      '/statements/' + safeId.id,
                      { version: safeId.version, model, reason },
                      'PUT',
                    );
                    setSaved(next);
                    setModel(next.model);
                  })
                }
              >
                Save draft inputs
              </button>
            </div>
          )}
          <div
            aria-label="Scrollable partner equity statement"
            className="max-h-[75vh] overflow-auto rounded border bg-white"
          >
            <table
              aria-label="Partner equity statement"
              className="min-w-[1150px] w-full border-collapse text-sm"
            >
              <thead className="sticky top-0 z-30 bg-slate-900 text-white">
                <tr>
                  <th className="sm:sticky left-0 z-20 min-w-[290px] bg-slate-900 p-3 text-left">
                    Description
                  </th>
                  {[...model.partners]
                    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
                    .map((p) => (
                      <th className="min-w-[160px] p-3" key={p.id}>
                        {p.name}
                        {!p.active && <span className="block text-xs">Historical / inactive</span>}
                      </th>
                    ))}
                  <th className="sm:sticky right-0 z-20 min-w-[180px] bg-slate-900 p-3">Total</th>
                </tr>
              </thead>
              <tbody>
                {equityRows.map((row) => {
                  const input = inputKeys.includes(row.id as InputKey),
                    pct = row.id === 'sharing' || row.id === 'ownership',
                    bold = ['before', 'after', 'closing', 'ownership'].includes(row.id);
                  return (
                    <tr className={bold ? 'bg-emerald-50 font-semibold' : 'bg-white'} key={row.id}>
                      <th
                        scope="row"
                        title={
                          formulaDefinitions[row.id as keyof typeof formulaDefinitions] ??
                          'Editable supplied input. A dash means unspecified, not confirmed zero.'
                        }
                        className={
                          'sm:sticky left-0 z-10 border-b p-3 text-left ' +
                          (bold ? 'bg-emerald-50' : 'bg-white')
                        }
                      >
                        {row.label}
                        {!input && (
                          <span className="block text-[10px] font-normal text-amber-800">
                            Calculated · provisional
                          </span>
                        )}
                      </th>
                      {[...model.partners]
                        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
                        .map((p) => (
                          <td
                            className={
                              'border-b p-2 text-right ' +
                              (Number(result.cells[row.id][p.id]) < 0 ? 'text-red-700' : '')
                            }
                            key={p.id}
                          >
                            {input && editable && !presentation ? (
                              <AmountInput
                                label={`${p.name} ${row.id}`}
                                value={model.inputs[p.id][row.id as InputKey]}
                                nullable
                                disabled={!editable}
                                onValidity={(valid) => validity(p.id + row.id, valid)}
                                onValue={(value) => {
                                  const next = structuredClone(model);
                                  next.inputs[p.id][row.id as InputKey] = value;
                                  calculateEquity(next);
                                  setModel(next);
                                }}
                              />
                            ) : (
                              money(result.cells[row.id][p.id], pct)
                            )}
                          </td>
                        ))}
                      <td
                        className={
                          'sm:sticky right-0 z-10 border-b bg-slate-100 p-3 text-right font-bold ' +
                          (Number(result.totals[row.id]) < 0 ? 'text-red-700' : '')
                        }
                      >
                        {money(result.totals[row.id], pct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Swipe horizontally on mobile. Blue input cells are editable only in an authorized draft.
            Dashes remain unspecified. Source has twelve monetary rows plus two percentage rows.
          </p>
          <section
            aria-label="Equity reconciliation"
            className="rounded border border-amber-200 bg-amber-50 p-4"
          >
            <h3 className="font-bold">Reconciliation and review</h3>
            <p>
              Exact allocation difference: {result.exactAllocationDifference}. Exact equity movement
              difference: {result.exactClosingDifference}.
            </p>
            <p>
              Displayed partner allocations minus total: {result.rounding.allocationCents} cents;
              displayed closing values minus total: {result.rounding.closingCents} cents; sharing
              display rounding: {result.rounding.sharingBasisPoints} basis points; ownership display
              rounding: {result.rounding.ownershipBasisPoints} basis points.
            </p>
            <p>
              Totals use full-precision rational values, not rounded partner cells. No partner is
              silently assigned a rounding cent. {result.unspecified} inputs remain unspecified;
              review their provisional no-amount treatment.
            </p>
            {result.issues.map((x) => (
              <p className="font-semibold text-red-700" key={x}>
                {x}
              </p>
            ))}
          </section>
          <details>
            <summary className="font-bold">Formula Audit — requires workbook review</summary>
            <p>{formulaNotice}</p>
            <dl>
              {Object.entries(formulaDefinitions).map(([k, v]) => (
                <div className="mt-2" key={k}>
                  <dt className="font-semibold">{k}</dt>
                  <dd className="font-mono text-sm">{v}</dd>
                </div>
              ))}
            </dl>
            <p>
              Review acceptance: {safeId.review_acceptance ?? 'Pending'}. Acceptance approves the
              documented provisional interpretation, not a claim that original Excel formulas were
              verified.
            </p>
          </details>
          {!presentation && (
            <section
              aria-label="Statement approval workflow"
              className="space-y-3 rounded border bg-white p-4"
            >
              <h3 className="font-bold">Review and approval</h3>
              {can('manage') && safeId.status === 'DRAFT' && (
                <button
                  className={button}
                  disabled={
                    dirty || busy || blocked || reason.trim().length < 10 || !!result.issues.length
                  }
                  onClick={() => void action('workflow', { action: 'submit' })}
                >
                  Submit for review
                </button>
              )}
              {can('review') && safeId.status === 'UNDER_REVIEW' && (
                <>
                  <label className="block">
                    Formula acceptance phrase
                    <input
                      className={field + ' ml-2'}
                      value={acceptance}
                      onChange={(e) => setAcceptance(e.target.value)}
                      placeholder="ACCEPT PROVISIONAL SCREENSHOT FORMULAS"
                    />
                  </label>
                  <button
                    className={button}
                    disabled={
                      busy ||
                      blocked ||
                      reason.trim().length < 10 ||
                      acceptance !== 'ACCEPT PROVISIONAL SCREENSHOT FORMULAS'
                    }
                    onClick={() => void action('workflow', { action: 'review', acceptance })}
                  >
                    Accept provisional definitions
                  </button>
                  <button
                    className={button}
                    disabled={busy || blocked || reason.trim().length < 10}
                    onClick={() => void action('workflow', { action: 'return' })}
                  >
                    Return to draft
                  </button>
                </>
              )}
              {can('approve') && safeId.status === 'UNDER_REVIEW' && (
                <button
                  className={primary}
                  disabled={busy || blocked || !safeId.reviewed_by || reason.trim().length < 10}
                  onClick={() => void action('workflow', { action: 'approve' })}
                >
                  Approve reviewed statement
                </button>
              )}
              {can('manage') && safeId.status === 'APPROVED' && (
                <button
                  className={button}
                  disabled={busy || blocked || reason.trim().length < 10}
                  onClick={() =>
                    void run(async () => {
                      const r = await equityApi.send<{ id: number }>(
                        `/statements/${safeId.id}/revise`,
                        { version: safeId.version, reason },
                      );
                      setId(String(r.id));
                    })
                  }
                >
                  Create controlled revision
                </button>
              )}
              {editable && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label="Newly admitted partner"
                      className={field}
                      value={includeId}
                      onChange={(e) => setIncludeId(e.target.value)}
                    >
                      <option value="">Select registered partner…</option>
                      {directory.partners
                        .filter((p) => !model.partners.some((x) => x.id === p.id))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                    <button
                      className={button}
                      disabled={!includeId || dirty || reason.trim().length < 10}
                      onClick={() => void action('include-partner', { partnerId: includeId })}
                    >
                      Include partner in this draft
                    </button>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-semibold">Reviewed opening-balance carry-forward</h4>
                    <p className="text-xs">
                      Enter an earlier approved statement ID (switch year above to retrieve prior
                      statements). No automatic carry-forward.
                    </p>
                    <input
                      aria-label="Carry source statement ID"
                      className={field}
                      value={sourceId}
                      onChange={(e) => {
                        setSourceId(e.target.value);
                        setCarry(null);
                      }}
                    />
                    <button
                      className={button}
                      disabled={!sourceId || dirty || busy}
                      onClick={() =>
                        void run(async () => {
                          setCarry(
                            await equityApi.get<Carry>(
                              `/statements/${safeId.id}/carry-preview?sourceId=${encodeURIComponent(sourceId)}`,
                            ),
                          );
                        }, false)
                      }
                    >
                      Preview opening balances
                    </button>
                    {carry && (
                      <div className="rounded border p-3">
                        <p>
                          Source #{carry.source.id}, approved revision {carry.source.revision};
                          period {carry.source.start_date} to {carry.source.end_date}; total closing{' '}
                          {money(carry.total)}. Displayed partner sum differs by{' '}
                          {carry.displayRoundingCents} cents. Review per-partner amounts below; no
                          balancing cent will be assigned.
                        </p>
                        <ul>
                          {carry.opening.map((x) => (
                            <li key={x.partner.id}>
                              {x.partner.name}: {money(x.amount)}
                            </li>
                          ))}
                        </ul>
                        <label>
                          Type CARRY REVIEWED OPENING BALANCES
                          <input
                            className={field + ' block'}
                            value={confirmation}
                            onChange={(e) => setConfirmation(e.target.value)}
                          />
                        </label>
                        <button
                          className={primary}
                          disabled={
                            confirmation !== 'CARRY REVIEWED OPENING BALANCES' ||
                            reason.trim().length < 10 ||
                            busy ||
                            blocked
                          }
                          onClick={() =>
                            void action('carry', {
                              sourceId: carry.source.id,
                              sourceVersion: carry.source.version,
                              roundingCents: carry.displayRoundingCents,
                              confirmation,
                            })
                          }
                        >
                          Confirm opening-balance carry-forward
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              {can('audit') && (
                <>
                  <button
                    className={button}
                    onClick={() =>
                      void run(
                        async () =>
                          setAudit(
                            await equityApi.get<unknown[]>(`/statements/${safeId.id}/audit`),
                          ),
                        false,
                      )
                    }
                  >
                    Retrieve financial audit history
                  </button>
                  {audit.length > 0 && (
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">
                      {JSON.stringify(audit, null, 2)}
                    </pre>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
