import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.ts';
import { ReviewedLabSpecimens } from './ReviewedLabSpecimens.tsx';
import type { MasterTariffEdit, MasterTariffRow } from '../../api/clients/billing.client.ts';
import type { BillingChargeAttemptList, ServiceTariff } from '../../types/index.ts';

type Source = { id: number; code: string; name: string };
const field = 'rounded border border-slate-300 bg-white px-2 py-1 text-xs';
const button =
  'rounded border border-teal-700 px-3 py-1.5 text-xs font-semibold text-teal-800 disabled:opacity-40';
const headers = [
  'tariffId',
  'revision',
  'fee',
  'unit',
  'effectiveFrom',
  'effectiveTo',
  'isActive',
  'autoBill',
];
function csvCell(value: unknown): string {
  let text = String(value ?? '');
  // Spreadsheet-safe export; import reverses only this protective prefix.
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('The CSV contains an unterminated quoted field.');
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim()));
}
function decodeCell(value: string): string {
  return /^'[=+@-]/.test(value) ? value.slice(1) : value;
}
function editsFromCsv(text: string): MasterTariffEdit[] {
  const [columns, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''));
  if (!columns || columns.join(',') !== headers.join(',') || !rows.length || rows.length > 200)
    throw new Error('Use the exported CSV headings and provide 1–200 rows.');
  return rows.map((r, index) => {
    if (r.length !== headers.length)
      throw new Error(`Row ${index + 2} has the wrong number of fields.`);
    const [id, revision, fee, rawUnit, from, to, active, autoBill] = r.map(decodeCell);
    if (
      !/^[1-9]\d*$/.test(id) ||
      !/^[1-9]\d*$/.test(revision) ||
      !/^(true|false)$/.test(active) ||
      !/^(true|false)$/.test(autoBill)
    )
      throw new Error(`Row ${index + 2} has an invalid ID, revision or boolean.`);
    return {
      tariffId: Number(id),
      revision: Number(revision),
      fee,
      unit: rawUnit,
      effectiveFrom: from || null,
      effectiveTo: to || null,
      isActive: active === 'true',
      autoBill: autoBill === 'true',
    };
  });
}
function editOf(row: MasterTariffRow): MasterTariffEdit | null {
  const t = row.tariff;
  return t
    ? {
        tariffId: t.id,
        revision: t.revision,
        fee: String(t.fee),
        unit: t.unit,
        effectiveFrom: t.effectiveFrom,
        effectiveTo: t.effectiveTo,
        isActive: t.isActive,
        autoBill: t.autoBill,
      }
    : null;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation could not be confirmed.';
}

/** Facility-owned configuration; synchronization only adds inactive drafts. */
export const MasterTariffPriceList: React.FC<{ facilityId: number; canManage: boolean }> = ({
  facilityId,
  canManage,
}) => {
  const [rows, setRows] = useState<MasterTariffRow[]>([]);
  const [legacy, setLegacy] = useState<ServiceTariff[]>([]);
  const [sources, setSources] = useState<Record<string, Source[]>>({});
  const [drafts, setDrafts] = useState<Record<number, MasterTariffEdit>>({});
  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exam, setExam] = useState('');
  const [linkMaster, setLinkMaster] = useState('');
  const [linkTariff, setLinkTariff] = useState('');
  const [mappingMaster, setMappingMaster] = useState('');
  const [mappingSource, setMappingSource] = useState('');
  const [mappingReview, setMappingReview] = useState('');
  const [mappingInfo, setMappingInfo] = useState('');
  const [mappingAliases, setMappingAliases] = useState<
    Array<{ id: number; sourceType: string; alias: string; isActive: boolean }>
  >([]);
  const [history, setHistory] = useState('');
  const [importRows, setImportRows] = useState<MasterTariffEdit[] | null>(null);
  const [queue, setQueue] = useState<BillingChargeAttemptList | null>(null);
  const [queueError, setQueueError] = useState('');
  const [specimenPanelOpen, setSpecimenPanelOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setQueue(null);
    setQueueError('');
    try {
      const [catalogue, tariffs, sourceRows] = await Promise.all([
        api.getMasterTariffs(facilityId),
        api.getServiceTariffs(facilityId),
        api.getMasterSources(facilityId),
      ]);
      setRows(catalogue);
      setLegacy(tariffs.filter((t) => !t.masterServiceId));
      setSources(sourceRows);
      const next: Record<number, MasterTariffEdit> = {};
      for (const row of catalogue) {
        const edit = editOf(row);
        if (edit) next[edit.tariffId] = edit;
      }
      setDrafts(next);
      setSelected([]);
      setImportRows(null);
    } catch (e) {
      setRows([]);
      setError(message(e));
    } finally {
      setLoading(false);
    }
    try {
      setQueue(await api.getChargeAttempts(facilityId, 'PENDING'));
    } catch {
      setQueueError('The unresolved billing queue could not be loaded. Do not assume it is empty.');
    }
  }, [facilityId]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const departments = useMemo(
    () => [...new Set(rows.map((r) => r.master.department))].sort(),
    [rows],
  );
  const visible = rows.filter(({ master, tariff }) => {
    const search =
      `${master.code} ${master.description} ${tariff?.code ?? ''} ${master.billingFamily}`.toLowerCase();
    const state = !tariff
      ? 'UNMAPPED'
      : Number(tariff.fee) === 0
        ? 'UNCONFIGURED'
        : tariff.approvalStatus;
    return (
      search.includes(query.trim().toLowerCase()) &&
      (!department || department === master.department) &&
      (!status || status === state)
    );
  });
  const mappingRow = rows.find((r) => String(r.master.id) === mappingMaster);
  const kind =
    mappingRow?.master.billingFamily === 'LABORATORY'
      ? 'LAB_TEST'
      : mappingRow?.master.billingFamily === 'PHARMACY'
        ? 'PHARMACY'
        : mappingRow?.master.billingFamily === 'BED_DAY'
          ? 'BED_DAY'
          : '';
  const update = (id: number, patch: Partial<MasterTariffEdit>) =>
    setDrafts((old) => ({ ...old, [id]: { ...old[id], ...patch } }));
  const exportCsv = () => {
    const values = rows.map(editOf).filter((x): x is MasterTariffEdit => Boolean(x));
    const csv = [
      headers.map(csvCell).join(','),
      ...values.map((v) => headers.map((h) => csvCell(v[h as keyof MasterTariffEdit])).join(',')),
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `facility-${facilityId}-master-tariffs.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const loadCsv = async (file: File | undefined) => {
    setImportRows(null);
    setError('');
    if (!file) return;
    try {
      if (file.size > 100_000) throw new Error('The CSV exceeds 100 KB.');
      setImportRows(editsFromCsv(await file.text()));
    } catch (e) {
      setError(message(e));
    }
  };
  const showMappings = async (id: number) => {
    setMappingMaster(String(id));
    setMappingSource('');
    setMappingInfo('');
    setMappingAliases([]);
    try {
      const data = await api.getMasterMappings(facilityId, id);
      setMappingAliases(data.aliases);
      setMappingInfo(
        `Source mappings: ${data.sources.map((s) => `${s.sourceType} #${s.sourceId} (${s.isActive ? 'active' : 'inactive'})`).join(', ') || 'none'}. Approved aliases: ${data.aliases.map((a) => `${a.sourceType} ${a.alias} (${a.isActive ? 'active' : 'inactive'})`).join(', ') || 'none'}.`,
      );
    } catch (e) {
      setError(message(e));
    }
  };
  const showHistory = async (id: number) => {
    try {
      const data = await api.getMasterTariffHistory(facilityId, id);
      setHistory(
        data.length
          ? data
              .map((x) => `${x.createdAt} · ${x.action} · actor ${x.userId}\n${x.details}`)
              .join('\n\n')
          : 'No tariff audit entries found.',
      );
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <section className="mb-5 space-y-4 rounded-xl border border-slate-200 bg-white p-5 text-xs shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Master Tariff Price List</h2>
          <p className="mt-1 text-slate-600">
            Facility-specific prices for exact clinical services. KES 0.00 is unconfigured, not
            free. Changes require a new approval.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            disabled={busy || !canManage}
            onClick={() =>
              void run(
                () => api.syncMasterTariffs(facilityId),
                'Catalogue synchronised. Existing prices were not changed.',
              )
            }
          >
            Synchronise actual services
          </button>
          <button type="button" className={button} onClick={exportCsv} disabled={loading}>
            Export CSV
          </button>
        </div>
      </div>
      <p className="rounded bg-amber-50 p-3 text-amber-900">
        Existing prices are preserved as drafts until reviewed. Orders alone do not trigger charges.
        Legacy tariff codes must be explicitly linked; no specimen, modality or name is used to
        guess a price.
      </p>
      {error && (
        <p role="alert" className="rounded bg-rose-50 p-3 text-rose-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded bg-emerald-50 p-3 text-emerald-800">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <label>
          Search{' '}
          <input
            aria-label="Search master tariffs"
            className={field}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Code or service"
          />
        </label>
        <label>
          Department{' '}
          <select
            aria-label="Filter master tariffs by department"
            className={field}
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">All</option>
            {departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Status{' '}
          <select
            aria-label="Filter master tariffs by status"
            className={field}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All</option>
            <option>UNMAPPED</option>
            <option>UNCONFIGURED</option>
            <option>DRAFT</option>
            <option>APPROVED</option>
          </select>
        </label>
      </div>
      {loading ? (
        <p role="status">Loading master catalogue…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left">
            <thead className="bg-slate-50">
              <tr>
                {[
                  'Select',
                  'Master / source',
                  'Facility tariff',
                  'Price KES',
                  'Unit',
                  'Effective from / to',
                  'Enabled / auto',
                  'Approval',
                  'Actions',
                ].map((x) => (
                  <th key={x} className="p-2">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ master, tariff }) => {
                const d = tariff ? drafts[tariff.id] : null;
                return (
                  <tr key={master.id} className="border-t border-slate-100 align-top">
                    <td className="p-2">
                      {tariff && (
                        <input
                          aria-label={`Select ${master.code}`}
                          type="checkbox"
                          checked={selected.includes(tariff.id)}
                          onChange={(e) =>
                            setSelected((old) =>
                              e.target.checked
                                ? [...old, tariff.id]
                                : old.filter((x) => x !== tariff.id),
                            )
                          }
                        />
                      )}
                    </td>
                    <td className="p-2">
                      <strong>{master.description}</strong>
                      <div className="font-mono text-slate-500">{master.code}</div>
                      <div>
                        {master.department} · {master.billingFamily}
                      </div>
                    </td>
                    <td className="p-2 font-mono">{tariff?.code ?? 'Not mapped'}</td>
                    {tariff && d ? (
                      <>
                        <td className="p-2">
                          <input
                            aria-label={`Price ${master.code}`}
                            className={`${field} w-24`}
                            value={d.fee}
                            disabled={!canManage}
                            onChange={(e) => update(tariff.id, { fee: e.target.value })}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            aria-label={`Unit ${master.code}`}
                            className={`${field} w-24`}
                            value={d.unit}
                            disabled={!canManage}
                            onChange={(e) => update(tariff.id, { unit: e.target.value })}
                          />
                          <div>Master: {master.unit}</div>
                        </td>
                        <td className="p-2">
                          <input
                            aria-label={`Effective from ${master.code}`}
                            type="date"
                            className={field}
                            value={d.effectiveFrom ?? ''}
                            disabled={!canManage}
                            onChange={(e) =>
                              update(tariff.id, { effectiveFrom: e.target.value || null })
                            }
                          />
                          <br />
                          <input
                            aria-label={`Effective to ${master.code}`}
                            type="date"
                            className={field}
                            value={d.effectiveTo ?? ''}
                            disabled={!canManage}
                            onChange={(e) =>
                              update(tariff.id, { effectiveTo: e.target.value || null })
                            }
                          />
                        </td>
                        <td className="p-2">
                          <label>
                            <input
                              type="checkbox"
                              checked={d.isActive}
                              disabled={!canManage}
                              onChange={(e) => update(tariff.id, { isActive: e.target.checked })}
                            />{' '}
                            Enabled
                          </label>
                          <br />
                          <label>
                            <input
                              type="checkbox"
                              checked={d.autoBill}
                              disabled={!canManage}
                              onChange={(e) => update(tariff.id, { autoBill: e.target.checked })}
                            />{' '}
                            Auto bill
                          </label>
                        </td>
                        <td className="p-2">
                          {Number(tariff.fee) === 0 ? 'Unconfigured' : tariff.approvalStatus}
                          <div className="text-slate-500">rev {tariff.revision}</div>
                        </td>
                        <td className="p-2 space-y-1">
                          <button
                            type="button"
                            className={button}
                            disabled={!canManage || busy}
                            onClick={() =>
                              void run(
                                () => api.saveMasterTariffs(facilityId, [d]),
                                'Changes saved as draft; review and approve before billing.',
                              )
                            }
                          >
                            Save
                          </button>{' '}
                          <button
                            type="button"
                            className={button}
                            disabled={!canManage || busy || tariff.approvalStatus === 'APPROVED'}
                            onClick={() => {
                              const ref = window.prompt('Approval reference (3–200 characters):');
                              if (ref)
                                void run(
                                  () =>
                                    api.approveMasterTariff(
                                      facilityId,
                                      tariff.id,
                                      tariff.revision,
                                      ref,
                                    ),
                                  'Tariff approved.',
                                );
                            }}
                          >
                            Approve
                          </button>{' '}
                          <button
                            type="button"
                            className={button}
                            onClick={() => void showHistory(tariff.id)}
                          >
                            History
                          </button>{' '}
                          <button
                            type="button"
                            className={button}
                            onClick={() => void showMappings(master.id)}
                          >
                            Mappings
                          </button>
                        </td>
                      </>
                    ) : (
                      <td colSpan={6} className="p-2 text-amber-800">
                        Synchronise or link a reviewed existing tariff below.
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visible.length && <p className="p-4">No services match the filters.</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={button}
          disabled={!canManage || busy || !selected.length}
          onClick={() =>
            void run(
              () =>
                api.saveMasterTariffs(
                  facilityId,
                  selected.map((id) => drafts[id]),
                ),
              'Selected tariff changes saved as drafts.',
            )
          }
        >
          Save selected edits ({selected.length})
        </button>
        <label>
          Import exported CSV{' '}
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={!canManage || busy}
            onChange={(e) => void loadCsv(e.target.files?.[0])}
          />
        </label>
        {importRows && (
          <>
            <span>
              {importRows.length} rows ready for review; save invalidates approvals for changed
              values.
            </span>
            <button
              type="button"
              className={button}
              disabled={!canManage || busy}
              onClick={() =>
                void run(
                  () => api.saveMasterTariffs(facilityId, importRows),
                  'Imported tariff edits saved as drafts; approval is still required.',
                )
              }
            >
              Apply CSV atomically
            </button>
          </>
        )}
      </div>
      <details className="rounded border border-slate-200 p-3">
        <summary className="cursor-pointer font-semibold">
          Link an existing tariff without changing its price
        </summary>
        <p className="my-2">
          Review the exact service, unit and price before linking. The old tariff becomes a draft
          and must be approved separately.
        </p>
        <div className="flex flex-wrap gap-2">
          <select
            className={field}
            aria-label="Master service to link"
            value={linkMaster}
            onChange={(e) => setLinkMaster(e.target.value)}
          >
            <option value="">Select master service</option>
            {rows.map((r) => (
              <option value={r.master.id} key={r.master.id}>
                {r.master.code} — {r.master.description}
              </option>
            ))}
          </select>
          <select
            className={field}
            aria-label="Existing tariff to link"
            value={linkTariff}
            onChange={(e) => setLinkTariff(e.target.value)}
          >
            <option value="">Select unlinked tariff</option>
            {legacy.map((t) => (
              <option value={t.id} key={t.id}>
                {t.code} — {t.description} · KES {t.fee} / {t.unit}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={button}
            disabled={!canManage || busy || !linkMaster || !linkTariff}
            onClick={() => {
              const t = legacy.find((x) => String(x.id) === linkTariff);
              if (
                t?.revision &&
                window.confirm('Link this exact legacy price to the selected master service?')
              )
                void run(
                  () =>
                    api.linkLegacyMasterTariff(facilityId, Number(linkMaster), t.id, t.revision!),
                  'Legacy tariff linked without changing its price.',
                );
            }}
          >
            Link reviewed tariff
          </button>
        </div>
      </details>
      <details className="rounded border border-slate-200 p-3">
        <summary className="cursor-pointer font-semibold">
          Define a specific imaging examination
        </summary>
        <p className="my-2">
          Only add examinations this facility actually offers. A modality by itself is not a
          specific examination.
        </p>
        <input
          className={field}
          aria-label="Imaging examination description"
          value={exam}
          onChange={(e) => setExam(e.target.value)}
          placeholder="Specific examination description"
        />
        <button
          type="button"
          className={`${button} ml-2`}
          disabled={!canManage || busy || !exam.trim()}
          onClick={() =>
            void run(
              () => api.createImagingMaster(facilityId, exam),
              'Imaging examination created as an unconfigured draft.',
            )
          }
        >
          Add examination
        </button>
      </details>
      {mappingMaster && (
        <div className="rounded border border-slate-200 p-3 space-y-2">
          <h3 className="font-semibold">
            Reviewed clinical mappings — {mappingRow?.master.description}
          </h3>
          <p>{mappingInfo || 'Loading mappings…'}</p>
          {mappingAliases
            .filter((a) => a.isActive)
            .map((alias) => (
              <div key={alias.id} className="flex items-center gap-2">
                <span>
                  {alias.sourceType} {alias.alias}
                </span>
                <button
                  type="button"
                  className={button}
                  disabled={!canManage || busy || mappingReview.trim().length < 3}
                  onClick={() =>
                    void run(async () => {
                      await api.retireMasterAlias(facilityId, alias.id, mappingReview);
                      await showMappings(Number(mappingMaster));
                    }, 'Alias retired and audited; historical invoices were not changed.')
                  }
                >
                  Retire alias
                </button>
              </div>
            ))}
          {kind && (
            <>
              <select
                className={field}
                aria-label="Clinical source for mapping"
                value={mappingSource}
                onChange={(e) => setMappingSource(e.target.value)}
              >
                <option value="">Select exact {kind} source</option>
                {(sources[kind] ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name} (#{s.id})
                  </option>
                ))}
              </select>{' '}
              <input
                className={field}
                aria-label="Mapping review reference"
                placeholder="Review reference"
                value={mappingReview}
                onChange={(e) => setMappingReview(e.target.value)}
              />{' '}
              <button
                type="button"
                className={button}
                disabled={!canManage || busy || !mappingSource || mappingReview.trim().length < 3}
                onClick={() =>
                  void run(
                    () =>
                      api.setMasterSourceMapping(
                        facilityId,
                        Number(mappingMaster),
                        kind,
                        Number(mappingSource),
                        mappingReview,
                      ),
                    'Explicit source mapping saved and audited.',
                  )
                }
              >
                Map source ID
              </button>{' '}
              <button
                type="button"
                className={button}
                disabled={!canManage || busy || !mappingSource || mappingReview.trim().length < 3}
                onClick={() =>
                  void run(async () => {
                    await api.approveMasterAlias(
                      facilityId,
                      Number(mappingMaster),
                      kind,
                      Number(mappingSource),
                      mappingReview,
                    );
                    await showMappings(Number(mappingMaster));
                  }, 'Structured code alias approved and audited.')
                }
              >
                Approve code alias
              </button>
              <p>
                Explicit source mappings take precedence over approved structured-code aliases.
                Units must match.
              </p>
            </>
          )}
          <button type="button" className={button} onClick={() => setMappingMaster('')}>
            Close
          </button>
        </div>
      )}
      {history && (
        <div className="rounded border border-slate-200 p-3">
          <div className="flex justify-between">
            <h3 className="font-semibold">Tariff audit history</h3>
            <button type="button" className={button} onClick={() => setHistory('')}>
              Close
            </button>
          </div>
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap">{history}</pre>
        </div>
      )}
      <details
        className="rounded border border-slate-200 p-3"
        onToggle={(event) => setSpecimenPanelOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer font-semibold">
          Reviewed laboratory specimen choices
        </summary>
        {specimenPanelOpen && (
          <ReviewedLabSpecimens
            facilityId={facilityId}
            sources={sources.LAB_TEST ?? []}
            canManage={canManage}
          />
        )}
      </details>
      <details className="rounded border border-slate-200 p-3">
        <summary className="cursor-pointer font-semibold">
          Unresolved billing queue {queue ? `(${queue.pending})` : '(unavailable)'}
        </summary>
        {queueError && <p role="alert">{queueError}</p>}
        {queue?.attempts.map((a) => (
          <div key={a.id} className="border-t py-2">
            <strong>
              {a.itemType} · {a.sourceType} #{a.sourceId}
            </strong>{' '}
            · Patient #{a.patientId} · {a.status}
            <p>{a.detail ?? a.reason}</p>
            <button
              type="button"
              className={button}
              disabled={!canManage || busy}
              onClick={() =>
                void run(
                  () => api.retryChargeAttempt(a.id, facilityId),
                  'Retry completed; review the queue and invoice for the outcome.',
                )
              }
            >
              Retry after review
            </button>
          </div>
        ))}
        {queue && !queue.attempts.length && <p className="mt-2">No pending attempts returned.</p>}
      </details>
    </section>
  );
};
