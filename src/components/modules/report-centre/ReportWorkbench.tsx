import React, { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  Printer,
  Search,
} from 'lucide-react';
import { reportCentreApi } from '../../../api/report-centre.client.ts';
import { ReportSelectionPicker } from './ReportSelectionPicker.tsx';
import type { ReportEngineId } from '../../../reporting/report-catalogue.ts';
import { reportFilterSummary, reportValue } from '../../../reporting/report-centre.format.ts';
import {
  REPORT_ENGINES,
  type ReportFilters,
  type ReportResult,
  type ReportSelectionOption,
} from '../../../reporting/report-centre.types.ts';

const input =
  'mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-500';
const button =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const primary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50';

function saveDownload(base64: string, contentType: string, filename: string) {
  const raw = atob(base64);
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const ReportWorkbench: React.FC<{
  id: ReportEngineId;
  facilityId: number;
  canExport: boolean;
}> = ({ id, facilityId, canExport }) => {
  const definition = REPORT_ENGINES[id];
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [patient, setPatient] = useState<ReportSelectionOption[]>([]);
  const [ward, setWard] = useState<ReportSelectionOption[]>([]);
  const [bed, setBed] = useState<ReportSelectionOption[]>([]);
  const [department, setDepartment] = useState<ReportSelectionOption[]>([]);
  const [staff, setStaff] = useState<ReportSelectionOption[]>([]);
  const [items, setItems] = useState<ReportSelectionOption[]>([]);
  const [supplier, setSupplier] = useState<ReportSelectionOption[]>([]);
  const [purchaseOrder, setPurchaseOrder] = useState<ReportSelectionOption[]>([]);
  const [labTest, setLabTest] = useState<ReportSelectionOption[]>([]);
  const [services, setServices] = useState<ReportSelectionOption[]>([]);
  const [invoice, setInvoice] = useState<ReportSelectionOption[]>([]);
  const [receipt, setReceipt] = useState<ReportSelectionOption[]>([]);
  const [accounts, setAccounts] = useState<ReportSelectionOption[]>([]);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const version = useRef(0);
  useLayoutEffect(() => {
    version.current += 1;
    return () => {
      version.current += 1;
      document.body.classList.remove('print-report-centre');
    };
  }, []);

  function draft(): ReportFilters {
    return {
      facilityId,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(status ? { status } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(patient[0] ? { patientId: patient[0].id } : {}),
      ...(ward[0] ? { wardId: ward[0].id } : {}),
      ...(bed[0] ? { bedId: bed[0].id } : {}),
      ...(department[0] ? { departmentId: department[0].id } : {}),
      ...(staff[0] ? { staffId: staff[0].id } : {}),
      ...(items.length ? { itemIds: items.map((item) => item.id) } : {}),
      ...(supplier[0] ? { supplierId: supplier[0].id } : {}),
      ...(purchaseOrder[0] ? { purchaseOrderId: purchaseOrder[0].id } : {}),
      ...(labTest[0] ? { labTestId: labTest[0].id } : {}),
      ...(services.length ? { serviceIds: services.map((service) => service.id) } : {}),
      ...(invoice[0] ? { invoiceId: invoice[0].id } : {}),
      ...(receipt[0] ? { receiptId: receipt[0].id } : {}),
      ...(accounts.length ? { accountIds: accounts.map((account) => account.id) } : {}),
      offset: 0,
      limit: 25,
    };
  }

  async function generate(filters: ReportFilters) {
    const requestVersion = version.current;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const next = await reportCentreApi.generate(id, filters);
      if (requestVersion === version.current) setResult(next);
    } catch (reason) {
      if (requestVersion === version.current)
        setError(reason instanceof Error ? reason.message : 'The report could not be generated.');
    } finally {
      if (requestVersion === version.current) setBusy(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      void generate(draft());
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : 'Check the filters.');
    }
  }

  async function printPage() {
    if (!result || busy || !canExport) return;
    const requestVersion = version.current;
    setBusy(true);
    setError('');
    try {
      const next = await reportCentreApi.generate(id, result.filters, 'print');
      if (requestVersion !== version.current) return;
      // Render the newly audited page synchronously before opening the print dialog.
      flushSync(() => setResult(next));
      document.body.classList.add('print-report-centre');
      window.addEventListener(
        'afterprint',
        () => document.body.classList.remove('print-report-centre'),
        { once: true },
      );
      window.print();
    } catch (reason) {
      document.body.classList.remove('print-report-centre');
      if (requestVersion === version.current)
        setError(reason instanceof Error ? reason.message : 'The report could not be printed.');
    } finally {
      if (requestVersion === version.current) setBusy(false);
    }
  }

  async function download(format: 'pdf' | 'xlsx' | 'csv') {
    if (!result || busy || !canExport) return;
    const requestVersion = version.current;
    setBusy(true);
    setError('');
    try {
      const file = await reportCentreApi.export(id, result.filters, format);
      if (requestVersion === version.current)
        saveDownload(file.base64, file.contentType, file.filename);
    } catch (reason) {
      if (requestVersion === version.current)
        setError(reason instanceof Error ? reason.message : 'The report could not be exported.');
    } finally {
      if (requestVersion === version.current) setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-4 text-sm text-teal-950">
        <p className="font-semibold">Operational subset</p>
        <p className="mt-1 leading-relaxed text-teal-800">{definition.description}</p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-teal-800">
          {definition.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>

      <form onSubmit={submit} className="space-y-4" aria-label="Report filters">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
            {definition.searchLabel}
            <input
              className={input}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={80}
              placeholder="Enter a search term"
            />
          </label>
          {definition.statuses && (
            <label className="text-xs font-semibold text-slate-600">
              Status
              <select
                className={input}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">All statuses</option>
                {definition.statuses.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {definition.dateLabel && definition.dateMode === 'asOf' ? (
            <>
              <label className="text-xs font-semibold text-slate-600">
                {definition.dateLabel} (required)
                <input
                  className={input}
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
              <p className="text-xs text-slate-500 sm:col-span-2">
                Includes posted entries through this date.
              </p>
            </>
          ) : definition.dateLabel ? (
            <>
              <label className="text-xs font-semibold text-slate-600">
                {definition.dateLabel} from
                <input
                  className={input}
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                {definition.dateLabel} to
                <input
                  className={input}
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
              <p className="text-xs text-slate-500 sm:col-span-2">
                Optional inclusive range, maximum 366 days. Both dates are required.
              </p>
            </>
          ) : null}
          {definition.patientFilter && (
            <ReportSelectionPicker
              reportId={id}
              facilityId={facilityId}
              kind="patient"
              label="Patient"
              value={patient}
              onChange={(next) => {
                setPatient(next);
                setInvoice([]);
              }}
              help="Browse patients registered at this facility. Cross-facility registration needs a separate access policy."
            />
          )}
          {definition.wardFilter && (
            <ReportSelectionPicker
              reportId={id}
              facilityId={facilityId}
              kind="ward"
              label="Ward"
              value={ward}
              onChange={(next) => {
                setWard(next);
                setBed([]);
              }}
            />
          )}
          {definition.bedFilter && (
            <ReportSelectionPicker
              key={`bed:${ward[0]?.id ?? 'all'}`}
              reportId={id}
              facilityId={facilityId}
              kind="bed"
              label="Bed"
              value={bed}
              onChange={setBed}
              wardId={ward[0]?.id}
              help="Bed choices refresh when the ward changes; status is the currently recorded status."
            />
          )}
          {definition.departmentFilter && (
            <ReportSelectionPicker
              reportId={id}
              facilityId={facilityId}
              kind="department"
              label="Department"
              value={department}
              onChange={(next) => {
                setDepartment(next);
                setStaff([]);
              }}
            />
          )}
          {definition.staffFilter && (
            <ReportSelectionPicker
              key={`staff:${department[0]?.id ?? 'all'}`}
              reportId={id}
              facilityId={facilityId}
              kind="staff"
              label="Staff"
              value={staff}
              onChange={setStaff}
              departmentId={department[0]?.id}
              help="Staff selection requires user-read permission; recorded free-text cashier names are not matched to staff."
            />
          )}
          {definition.inventoryItemFilter && (
            <ReportSelectionPicker
              reportId={id}
              facilityId={facilityId}
              kind="item"
              label="Item"
              value={items}
              onChange={setItems}
              multiple
              help="Current inventory quantities are snapshots. Historical events are filtered by recorded item ID only."
            />
          )}
          {definition.supplierFilter && (
            <ReportSelectionPicker
              reportId={id}
              facilityId={facilityId}
              kind="supplier"
              label="Supplier"
              value={supplier}
              onChange={(next) => {
                setSupplier(next);
                setPurchaseOrder([]);
              }}
            />
          )}
          {definition.purchaseOrderFilter && (
            <ReportSelectionPicker
              key={`order:${supplier[0]?.id ?? 'all'}`}
              reportId={id}
              facilityId={facilityId}
              kind="purchaseOrder"
              label="Purchase order"
              value={purchaseOrder}
              onChange={setPurchaseOrder}
              supplierId={supplier[0]?.id}
            />
          )}
          {definition.labTestFilter && (
            <ReportSelectionPicker
              reportId={id}
              facilityId={facilityId}
              kind="labTest"
              label="Laboratory test"
              value={labTest}
              onChange={setLabTest}
              help="Matches the recorded laboratory test ID. Specimens shown are explicitly reviewed choices, not inferred defaults."
            />
          )}
          {definition.serviceFilter && (
            <ReportSelectionPicker
              reportId={id}
              facilityId={facilityId}
              kind="service"
              label={id === 'laboratory-orders' ? 'Laboratory service' : 'Radiology service'}
              value={services}
              onChange={setServices}
              multiple
              help="Matches recorded facility-service IDs; unlinked free-text history is not inferred."
            />
          )}
          {definition.receiptFilter && (
            <ReportSelectionPicker
              reportId={id}
              facilityId={facilityId}
              kind="receipt"
              label="Receipt"
              value={receipt}
              onChange={setReceipt}
              help="Requires patient-read permission. Selecting a receipt narrows the grouped payment totals."
            />
          )}
          {definition.accountFilter && (
            <ReportSelectionPicker
              reportId={id}
              facilityId={facilityId}
              kind="account"
              label="Account"
              value={accounts}
              onChange={setAccounts}
              multiple
              help="Filtering accounts narrows posted-ledger summaries; it does not produce a complete statement."
            />
          )}
          {definition.invoiceFilter && (
            <ReportSelectionPicker
              key={`invoice:${patient[0]?.id ?? 'all'}`}
              reportId={id}
              facilityId={facilityId}
              kind="invoice"
              label="Invoice"
              value={invoice}
              onChange={setInvoice}
              patientId={patient[0]?.id}
              help="The report itself is a current non-voided, nonzero or invalid balance snapshot."
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className={primary} type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Generate report
          </button>
          <span className="text-xs text-slate-500">
            The report uses the selected facility only.
          </span>
        </div>
      </form>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
        >
          {error}
        </div>
      )}
      {!result && !busy && !error && (
        <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
          Choose applicable filters and generate a report to see recorded data.
        </div>
      )}
      {result && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 report-no-print">
            <p className="text-xs text-slate-500">
              Showing the last generated filters. Generate again after changing filters.
            </p>
            {canExport ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => void printPage()}
                >
                  <Printer className="h-4 w-4" /> Print page
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => void download('pdf')}
                >
                  <Download className="h-4 w-4" /> PDF
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => void download('xlsx')}
                >
                  <FileSpreadsheet className="h-4 w-4" /> Excel
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => void download('csv')}
                >
                  <Download className="h-4 w-4" /> CSV
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Export and print require report and any applicable source-domain export permissions.
              </p>
            )}
          </div>
          {canExport && (
            <p className="text-xs text-slate-500 report-no-print">
              PDF, Excel and CSV include all matching records, up to 1,000; print contains the
              current page.
            </p>
          )}
          <section
            id="report-centre-print"
            className="overflow-hidden rounded-xl border border-slate-200 bg-white"
          >
            <div className="border-b border-slate-100 bg-slate-50/70 p-4">
              <p className="text-2xs font-bold uppercase tracking-widest text-teal-700">
                JaliCare HMIS · Reporting Centre
              </p>
              <h3 className="mt-1 text-base font-bold text-slate-900">{result.title}</h3>
              <p className="mt-1 text-xs text-slate-600">
                {result.facilityName} · Generated {result.generatedAt} (UTC)
              </p>
              <p className="mt-2 text-xs text-slate-600">
                {reportFilterSummary(
                  result.filters,
                  definition.dateLabel,
                  result.filterLabels,
                ).join(' · ')}
              </p>
              <p className="mt-2 text-xs font-semibold text-slate-700">
                {result.total} matching record{result.total === 1 ? '' : 's'}
              </p>
              {(result.summaries ?? []).map((summary) => (
                <p key={summary.label} className="mt-1 text-xs font-semibold text-slate-700">
                  {summary.label}:{' '}
                  {reportValue(
                    summary.value,
                    { key: 'summary', label: summary.label, kind: summary.kind },
                    result.currency,
                  )}
                </p>
              ))}
              <ul className="mt-2 space-y-1 text-xs text-amber-800">
                {result.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
            {result.rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                {result.total === 0
                  ? 'No records match the selected filters.'
                  : 'No records on this page. Results may have changed; use Previous or generate again.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      {result.columns.map((column) => (
                        <th key={column.key} className="px-3 py-3 font-semibold">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.rows.map((row, index) => (
                      <tr key={result.offset + index} className="align-top">
                        {result.columns.map((column) => (
                          <td key={column.key} className="px-3 py-3 text-slate-700">
                            {reportValue(row[column.key], column, result.currency)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
              <span>
                {result.total === 0
                  ? 'No matching records'
                  : `Showing ${result.offset + 1}–${result.offset + result.rows.length} of ${result.total}`}
              </span>
              <div className="flex gap-2 report-no-print">
                <button
                  type="button"
                  className={button}
                  disabled={busy || result.offset === 0}
                  onClick={() =>
                    void generate({
                      ...result.filters,
                      offset: Math.max(0, result.offset - result.limit),
                    })
                  }
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy || result.offset + result.rows.length >= result.total}
                  onClick={() =>
                    void generate({ ...result.filters, offset: result.offset + result.limit })
                  }
                >
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
