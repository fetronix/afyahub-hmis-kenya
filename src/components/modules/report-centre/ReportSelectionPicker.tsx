import React, { useEffect, useId, useState } from 'react';
import { reportCentreApi } from '../../../api/report-centre.client.ts';
import type { ReportEngineId } from '../../../reporting/report-catalogue.ts';
import type {
  ReportSelectionKind,
  ReportSelectionOption,
  ReportSelectionPage,
} from '../../../reporting/report-centre.types.ts';

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800';
const button =
  'rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40';

/** Native radios/checkboxes provide keyboard access; the first bounded page is visible immediately. */
export function ReportSelectionPicker({
  reportId,
  facilityId,
  kind,
  label,
  value,
  onChange,
  multiple = false,
  required = false,
  wardId,
  departmentId,
  supplierId,
  patientId,
  help,
}: {
  reportId: ReportEngineId | 'invoice-document';
  facilityId: number;
  kind: ReportSelectionKind;
  label: string;
  value: ReportSelectionOption[];
  onChange: (next: ReportSelectionOption[]) => void;
  multiple?: boolean;
  required?: boolean;
  wardId?: number;
  departmentId?: number;
  supplierId?: number;
  patientId?: number;
  help?: string;
}) {
  const radioName = useId();
  const searchId = useId();
  const [search, setSearch] = useState('');
  const [settledSearch, setSettledSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [invoiceStatus, setInvoiceStatus] = useState<'all' | 'outstanding'>(
    reportId === 'invoice-balances' ? 'outstanding' : 'all',
  );
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([
    reportId,
    facilityId,
    kind,
    wardId,
    departmentId,
    supplierId,
    patientId,
    invoiceStatus,
    settledSearch,
    offset,
    retry,
  ]);
  const [state, setState] = useState<{ key: string; page?: ReportSelectionPage; error?: string }>({
    key: '',
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void reportCentreApi
      .options(
        reportId,
        {
          facilityId,
          kind,
          offset,
          limit: 20,
          ...(settledSearch ? { search: settledSearch } : {}),
          ...(wardId ? { wardId } : {}),
          ...(departmentId ? { departmentId } : {}),
          ...(supplierId ? { supplierId } : {}),
          ...(patientId ? { patientId } : {}),
          ...(kind === 'invoice' ? { invoiceStatus } : {}),
        },
        controller.signal,
      )
      .then((page) => {
        if (live) setState({ key, page });
      })
      .catch((reason: unknown) => {
        if (live && !(reason instanceof Error && reason.name === 'AbortError')) {
          setState({
            key,
            error: reason instanceof Error ? reason.message : 'Options could not be loaded.',
          });
        }
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [
    key,
    reportId,
    facilityId,
    kind,
    offset,
    settledSearch,
    wardId,
    departmentId,
    supplierId,
    patientId,
    invoiceStatus,
  ]);

  const waitingForSearch = search.trim() !== settledSearch;
  const active = state.key === key && !waitingForSearch ? state : { key };
  const selectedIds = new Set(value.map((option) => option.id));
  const choose = (option: ReportSelectionOption) => {
    if (!multiple) return onChange([option]);
    if (selectedIds.has(option.id)) return onChange(value.filter((item) => item.id !== option.id));
    if (value.length < 20) onChange([...value, option]);
  };

  return (
    <fieldset className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/40 p-3">
      <legend className="px-1 text-xs font-bold text-slate-700">
        {label}
        {required ? ' (required)' : ' (optional)'}
      </legend>
      {help && <p className="mb-2 text-xs leading-relaxed text-slate-500">{help}</p>}
      {kind === 'invoice' && (
        <label className="mb-2 block text-xs font-semibold text-slate-600">
          Invoice options
          <select
            className={`${field} mt-1`}
            value={invoiceStatus}
            onChange={(event) => {
              setInvoiceStatus(event.target.value as 'all' | 'outstanding');
              setOffset(0);
            }}
          >
            <option value="outstanding">Outstanding or amount needing review</option>
            <option value="all">All invoice statuses</option>
          </select>
        </label>
      )}
      <label className="block text-xs font-semibold text-slate-600" htmlFor={searchId}>
        Search {label.toLowerCase()} (optional)
      </label>
      <input
        id={searchId}
        type="search"
        className={`${field} mt-1`}
        value={search}
        maxLength={80}
        placeholder="Search by name or reference"
        onChange={(event) => {
          setOffset(0);
          setSearch(event.target.value);
        }}
      />
      {value.length > 0 && (
        <div className="mt-2 text-xs text-slate-700" aria-live="polite">
          <span className="font-semibold">Selected: </span>
          {value.map((option, index) => (
            <span key={option.id}>
              {index ? ', ' : ''}
              {option.label}
            </span>
          ))}
          <button type="button" className="ml-2 underline" onClick={() => onChange([])}>
            Clear selection
          </button>
        </div>
      )}
      {multiple && <p className="mt-2 text-xs text-slate-500">Choose up to 20; clear for all.</p>}
      <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
        {!required && !multiple && (
          <label className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-sm hover:bg-slate-50">
            <input
              type="radio"
              className="mt-1"
              name={radioName}
              checked={value.length === 0}
              onChange={() => onChange([])}
            />
            <span>All {label.toLowerCase()}</span>
          </label>
        )}
        {active.page?.options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-sm hover:bg-slate-50"
          >
            <input
              type={multiple ? 'checkbox' : 'radio'}
              name={multiple ? undefined : radioName}
              className="mt-1"
              checked={selectedIds.has(option.id)}
              disabled={multiple && value.length >= 20 && !selectedIds.has(option.id)}
              onChange={() => choose(option)}
            />
            <span className="min-w-0 break-words">
              <span className="font-medium text-slate-800">{option.label}</span>
              {option.detail && (
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                  {option.detail}
                </span>
              )}
            </span>
          </label>
        ))}
        {!active.page && !active.error && (
          <p role="status" className="p-2 text-xs text-slate-500">
            Loading {label.toLowerCase()}…
          </p>
        )}
        {active.page?.options.length === 0 && (
          <p role="status" className="p-2 text-xs text-slate-500">
            No matching options in this facility.
          </p>
        )}
        {active.error && (
          <div role="alert" className="p-2 text-xs text-rose-700">
            {active.error}{' '}
            <button type="button" className="underline" onClick={() => setRetry((v) => v + 1)}>
              Retry
            </button>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <button
          type="button"
          className={button}
          disabled={offset === 0 || !active.page}
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          Previous
        </button>
        <span>
          {active.page
            ? `Options ${active.page.options.length ? offset + 1 : offset}–${offset + active.page.options.length}`
            : 'Loading options'}
        </span>
        <button
          type="button"
          className={button}
          disabled={!active.page?.hasMore}
          onClick={() => setOffset(offset + 20)}
        >
          Next
        </button>
      </div>
    </fieldset>
  );
}
