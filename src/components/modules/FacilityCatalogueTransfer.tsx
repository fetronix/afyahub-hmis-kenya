import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import type {
  FacilityCatalogueImportRow,
  FacilityCataloguePreview,
} from '../../api/clients/billing.client.ts';

type Pending = {
  facilityId: number;
  rows: FacilityCatalogueImportRow[];
  idempotencyKey: string;
  approvalReference: string;
  confirmed: true;
};
type Completed = { batchId: number; rowCount: number; replay: boolean };

const field =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-teal-600 focus:outline-2 focus:outline-teal-100 disabled:bg-slate-100';
const button =
  'rounded-lg border border-teal-700 bg-white px-3 py-2 font-semibold text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50';
const primary =
  'rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50';
const template = `[
  {
    "code": "",
    "name": "",
    "description": "",
    "department": "",
    "category": "",
    "unit": "",
    "isActive": false,
    "autoBill": false,
    "initialPrice": "0.00",
    "effectiveFrom": null,
    "effectiveTo": null
  }
]`;

function retryIdentity() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure retry identity is unavailable.');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `facility-catalogue-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function checkedApproval(value: string) {
  const reference = value.trim();
  if (
    reference.length < 3 ||
    reference.length > 200 ||
    [...reference].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error(
      'Enter a documented approval reference of 3–200 characters without control characters.',
    );
  return reference;
}

function saveCsv(base64: string, contentType: string, filename: string) {
  const raw = atob(base64);
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const issueLabels: Record<string, string> = {
  INVALID_SERVICE_OR_TARIFF: 'Check the required fields, price, dates and allowed field names.',
  INVALID_PRICE: 'Enter a valid non-negative KES price.',
  DEPARTMENT_UNAVAILABLE: 'The department is not enabled for this facility.',
  CATEGORY_DEPARTMENT_MISMATCH: 'The category does not match the department.',
  DUPLICATE_SERVICE_CODE_IN_BATCH: 'Service code is repeated in this batch.',
  DUPLICATE_TARIFF_CODE_IN_BATCH: 'Tariff code is repeated in this batch.',
  SERVICE_CODE_ALREADY_EXISTS: 'Service code already exists in this facility.',
  TARIFF_CODE_ALREADY_EXISTS: 'Tariff code already exists, including a historical tariff.',
};

/** Create-only, explicitly reviewed batch import and an audited catalogue export. */
export const FacilityCatalogueTransfer: React.FC<{
  facilityId: number;
  canManage: boolean;
  onImported: () => void;
  onClose: () => void;
}> = ({ facilityId, canManage, onImported, onClose }) => {
  const [text, setText] = useState('');
  const [review, setReview] = useState<FacilityCataloguePreview | null>(null);
  const [approval, setApproval] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [sent, setSent] = useState(false);
  const [retained, setRetained] = useState(false);
  const [completed, setCompleted] = useState<Completed | null>(null);
  const [lookup, setLookup] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const locked = Boolean(pending && !completed);
  async function run(action: (isCurrent: () => boolean) => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    const current = generation.current;
    const isCurrent = () => current === generation.current;
    setWorking(true);
    setError('');
    setMessage('');
    try {
      await action(isCurrent);
    } catch (reason) {
      if (isCurrent())
        setError(
          reason instanceof Error ? reason.message : 'The operation could not be completed.',
        );
    } finally {
      busy.current = false;
      if (isCurrent()) setWorking(false);
    }
  }
  async function readFile(file: File | undefined) {
    if (!file) return;
    await run(async (isCurrent) => {
      if (file.size > 512_000) throw new Error('Choose a JSON file no larger than 512 KB.');
      let contents: string;
      try {
        contents = await file.text();
      } catch {
        throw new Error('The selected file could not be read.');
      }
      if (isCurrent()) {
        setText(contents);
        setReview(null);
        setConfirmed(false);
      }
    });
  }
  async function validate() {
    if (busy.current) return;
    setReview(null);
    setConfirmed(false);
    await run(async (isCurrent) => {
      if (new Blob([text]).size > 512_000)
        throw new Error('The JSON must be no larger than 512 KB.');
      let rows: unknown;
      try {
        rows = JSON.parse(text);
      } catch {
        throw new Error('Enter a valid JSON array.');
      }
      if (!Array.isArray(rows) || rows.length < 1 || rows.length > 200)
        throw new Error('Provide between 1 and 200 JSON rows.');
      const key = recoveryKey.trim();
      if (key) {
        if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key))
          throw new Error('Enter the original retained retry identity.');
        const status = await api.getFacilityCatalogueImportStatus(facilityId, key, {
          rows,
          approvalReference: checkedApproval(approval),
        });
        if (!isCurrent()) return;
        if (status.status === 'KEY_IN_USE')
          throw new Error(
            'That identity belongs to a different request or older import. Stop and investigate.',
          );
        if (status.status === 'RECORDED') {
          if (
            !status.requestMatched ||
            !Number.isSafeInteger(status.batchId) ||
            status.batchId <= 0 ||
            status.rowCount !== rows.length
          )
            throw new Error(
              'The recorded batch could not be matched to this request. Stop and investigate.',
            );
          setCompleted({ batchId: status.batchId, rowCount: status.rowCount, replay: true });
          setMessage(
            'The retained request matches a recorded import. Current records may have changed since that import.',
          );
          onImported();
          return;
        }
      }
      const result = await api.previewFacilityCatalogueImport(facilityId, rows);
      if (
        !Array.isArray(result.rows) ||
        !Array.isArray(result.issues) ||
        result.rowCount !== rows.length
      )
        throw new Error('The validation response was incomplete. No import was started.');
      if (isCurrent()) {
        setReview(result);
        setConfirmed(false);
        setMessage(
          key
            ? 'No matching batch was found at this moment. A delayed request may still commit; use only this original identity and exact request. Review the results below.'
            : result.valid
              ? 'Review every normalized row before confirming.'
              : 'Correct the listed rows and validate again.',
        );
      }
    });
  }
  async function sendImport(request: Pending, isCurrent: () => boolean) {
    setSent(true);
    try {
      const result = await api.importFacilityCatalogue(request);
      if (!isCurrent()) return;
      if (
        !Number.isSafeInteger(result.batchId) ||
        result.batchId <= 0 ||
        result.rowCount !== request.rows.length ||
        !Array.isArray(result.services) ||
        result.services.length !== request.rows.length ||
        typeof result.idempotentReplay !== 'boolean' ||
        result.services.some(
          (service, index) =>
            !Number.isSafeInteger(service.serviceId) ||
            service.serviceId <= 0 ||
            !Number.isSafeInteger(service.tariffId) ||
            service.tariffId <= 0 ||
            service.serviceCode !== request.rows[index].code ||
            service.tariffCode !== request.rows[index].initialTariffCode,
        )
      )
        throw new Error(
          'The server response was incomplete. Check the batch status using the same retry identity.',
        );
      setCompleted({
        batchId: result.batchId,
        rowCount: result.rowCount,
        replay: result.idempotentReplay,
      });
      setMessage('The import was recorded. Existing prices and invoices were not overwritten.');
      onImported();
    } catch (reason) {
      if (isCurrent())
        setError(
          `${reason instanceof Error ? reason.message : 'The import response was not received.'} The outcome may be unknown: check status or retry the same request and identity. Do not start a second batch.`,
        );
    }
  }
  async function confirmImport() {
    if (!canManage || !review?.valid || review.rows.length !== review.rowCount || !confirmed)
      return;
    await run(async (isCurrent) => {
      const reference = checkedApproval(approval);
      const key = recoveryKey.trim();
      if (key && !/^[A-Za-z0-9._:-]{8,128}$/.test(key))
        throw new Error('Enter the original retained retry identity.');
      const request: Pending = {
        facilityId,
        rows: review.rows,
        idempotencyKey: key || retryIdentity(),
        approvalReference: reference,
        confirmed: true,
      };
      if (isCurrent()) {
        setPending(request);
        setSent(false);
        setRetained(false);
        setMessage(
          key
            ? 'No retry has been sent from this screen. The original request may still commit; retain the identity.'
            : 'No import has been sent yet. Retain the identity before sending.',
        );
      }
    });
  }
  async function checkStatus(identity: string) {
    await run(async (isCurrent) => {
      const key = identity.trim();
      if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key))
        throw new Error('Enter the original retry identity.');
      const expected =
        pending?.idempotencyKey === key
          ? { rows: pending.rows, approvalReference: pending.approvalReference }
          : undefined;
      const result = await api.getFacilityCatalogueImportStatus(facilityId, key, expected);
      if (!isCurrent()) return;
      if (result.status === 'RECORDED') {
        if (
          !Number.isSafeInteger(result.batchId) ||
          result.batchId <= 0 ||
          !Number.isSafeInteger(result.rowCount)
        )
          throw new Error('The status response was incomplete. Retain the original request.');
        setMessage(
          `Batch #${result.batchId} was recorded with ${result.rowCount} services. Records may have changed since the import.${result.requestMatched ? ' The retained request matches.' : ' The original request contents were not checked.'}`,
        );
        if (
          pending?.idempotencyKey === key &&
          result.requestMatched &&
          result.rowCount === pending.rows.length
        ) {
          setCompleted({ batchId: result.batchId, rowCount: result.rowCount, replay: true });
          onImported();
        }
      } else if (result.status === 'KEY_IN_USE') {
        setError(
          'This identity belongs to a different or older kind of import. Stop and investigate; do not use a replacement identity.',
        );
      } else {
        setMessage(
          'No batch was found at this moment. A delayed request could still commit; retain the original identity and do not create a replacement batch.',
        );
      }
    });
  }
  async function exportCsv() {
    await run(async (isCurrent) => {
      const file = await api.exportFacilityCatalogue(facilityId);
      if (!isCurrent()) return;
      saveCsv(file.base64, file.contentType, file.filename);
      setMessage(
        `Exported ${file.rowCount} catalogue rows. The file is a review snapshot, not an import template.`,
      );
    });
  }

  return (
    <section
      aria-label="Catalogue import and export"
      className="space-y-4 rounded-xl border border-teal-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900">Catalogue import &amp; export</h3>
          <p className="mt-1 text-slate-600">
            Only facility-owned services are imported. Batches create new services and linked
            tariffs; they never update existing prices or invoices.
          </p>
        </div>
        <button
          type="button"
          className={button}
          disabled={working || (locked && sent)}
          onClick={onClose}
        >
          Close transfer
        </button>
      </div>
      {message && (
        <p
          role="status"
          className="rounded border border-emerald-300 bg-emerald-50 p-3 text-emerald-800"
        >
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded border border-rose-300 bg-rose-50 p-3 text-rose-800">
          {error}
        </p>
      )}
      <div className="rounded-lg bg-slate-50 p-3">
        <p>
          Download a point-in-time CSV of this facility’s services and their linked tariffs,
          including inactive and archived linked tariffs. Unlinked historical tariffs are not
          included. Spreadsheet-formula text is escaped.
        </p>
        <button
          type="button"
          className={`${button} mt-2`}
          disabled={working}
          onClick={() => void exportCsv()}
        >
          Export catalogue CSV
        </button>
      </div>
      {canManage && (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <p>
            Import 1–200 reviewed JSON rows. No approval is inferred or independently verified.
            Omitted prices default to KES 0.00 (unconfigured, not free); automatic billing still
            requires a valid, positive price and applicable date. Pharmacy dispensing remains
            inventory-priced. Do not include patient information, passwords or provider credentials
            in the rows or approval reference.
          </p>
          <details className="rounded-lg bg-slate-50 p-3">
            <summary className="cursor-pointer font-semibold">View blank JSON format</summary>
            <p className="mt-2 text-xs text-slate-600">
              Fill in facility-approved values. The tariff code defaults to the service code; add
              <code> initialTariffCode </code> only if a different code is approved. Dates may be
              null. This blank example is not an approved price list; exported CSV is not a
              round-trip import file.
            </p>
            <pre className="mt-2 overflow-x-auto text-xs">{template}</pre>
          </details>
          {!completed && (
            <>
              <label className="block">
                Choose a reviewed JSON file
                <input
                  type="file"
                  accept="application/json,.json"
                  className={`${field} file:mr-3`}
                  disabled={working || locked}
                  onChange={(event) => void readFile(event.target.files?.[0])}
                />
              </label>
              <label className="block">
                Or paste JSON rows
                <textarea
                  className={`${field} min-h-36 font-mono text-xs`}
                  value={text}
                  disabled={working || locked}
                  onChange={(event) => {
                    setText(event.target.value);
                    setReview(null);
                    setConfirmed(false);
                  }}
                />
              </label>
              <label className="block">
                Documented facility approval reference
                <input
                  className={field}
                  maxLength={200}
                  value={approval}
                  disabled={working || locked}
                  onChange={(event) => {
                    setApproval(event.target.value);
                    if (recoveryKey.trim()) {
                      setReview(null);
                      setConfirmed(false);
                    }
                  }}
                />
              </label>
              <label className="block">
                Original retry identity (only when recovering an interrupted batch)
                <input
                  className={field}
                  maxLength={128}
                  value={recoveryKey}
                  disabled={working || locked}
                  onChange={(event) => {
                    setRecoveryKey(event.target.value);
                    setReview(null);
                    setConfirmed(false);
                  }}
                />
              </label>
              <p className="text-xs text-slate-600">
                To recover after leaving this screen, enter the exact original JSON, approval
                reference and retained identity. Never generate a replacement identity for an
                uncertain request.
              </p>
              <button
                type="button"
                className={button}
                disabled={working || locked || !text.trim()}
                onClick={() => void validate()}
              >
                Validate batch
              </button>
              {review && !review.valid && (
                <div
                  aria-label="Import validation issues"
                  className="rounded border border-amber-300 bg-amber-50 p-3"
                >
                  <p className="font-semibold">This validation did not import anything.</p>
                  <ul className="mt-2 list-inside list-disc">
                    {review.issues.map((issue) => (
                      <li key={issue.row}>
                        Row {issue.row}:{' '}
                        {issue.reasons.map((reason) => issueLabels[reason] ?? reason).join(' ')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {review?.valid && (
                <div aria-label="Reviewed import rows" className="space-y-3">
                  <p className="font-semibold">Review {review.rowCount} normalized rows</p>
                  <div
                    role="region"
                    aria-label="Scrollable import review"
                    tabIndex={0}
                    className="overflow-x-auto rounded border border-slate-200"
                  >
                    <table
                      className="w-full min-w-[1200px] text-left text-xs"
                      aria-label="Import review"
                    >
                      <thead className="bg-slate-50">
                        <tr>
                          {[
                            'Service code',
                            'Name / description',
                            'Department / category',
                            'Unit',
                            'Tariff code',
                            'Price (KES)',
                            'Effective from',
                            'Effective to',
                            'Service active',
                            'Auto-bill',
                          ].map((heading) => (
                            <th key={heading} scope="col" className="p-2">
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {review.rows.map((row, index) => (
                          <tr key={`${row.code}-${index}`} className="border-t border-slate-200">
                            <td className="p-2">{row.code}</td>
                            <td className="p-2">
                              <strong>{row.name}</strong>
                              <br />
                              {row.description}
                            </td>
                            <td className="p-2">
                              {row.department} / {row.category}
                            </td>
                            <td className="p-2">{row.unit}</td>
                            <td className="p-2">{row.initialTariffCode}</td>
                            <td className="p-2">{row.initialPrice}</td>
                            <td className="p-2">{row.effectiveFrom ?? 'No start date'}</td>
                            <td className="p-2">{row.effectiveTo ?? 'No end date'}</td>
                            <td className="p-2">{row.isActive ? 'Yes' : 'No'}</td>
                            <td className="p-2">{row.autoBill ? 'On' : 'Off'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-slate-600">
                    The initial tariff is active; the auto-bill choice applies to both service and
                    tariff. Validation is a snapshot and will be checked again at import.
                  </p>
                  <label className="block">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={working || locked}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />{' '}
                    I reviewed all rows and confirm that the facility has approved them.
                  </label>
                  {!pending && (
                    <button
                      type="button"
                      className={primary}
                      disabled={working || !confirmed}
                      onClick={() => void confirmImport()}
                    >
                      Prepare approved batch
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {pending && (
            <div
              aria-label="Import retry details"
              className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3"
            >
              <p className="font-semibold">Retain this retry identity securely</p>
              <p className="break-all font-mono text-xs" aria-label="Retry identity">
                {pending.idempotencyKey}
              </p>
              <p>
                After an interrupted response, use the exact same reviewed request and identity. A
                missing status is not proof that a delayed request cannot commit. The request
                contents are kept only in this open screen; retain them securely for recovery.
              </p>
              {!sent && !completed && (
                <>
                  <p>
                    {recoveryKey.trim()
                      ? 'No retry has been sent from this screen; the original may still be in flight.'
                      : 'No request has been sent yet.'}
                  </p>
                  <label className="block">
                    <input
                      type="checkbox"
                      checked={retained}
                      disabled={working}
                      onChange={(event) => setRetained(event.target.checked)}
                    />{' '}
                    I have securely retained the identity and reviewed request.
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={primary}
                      disabled={working || !retained}
                      onClick={() => void run((isCurrent) => sendImport(pending, isCurrent))}
                    >
                      Send approved batch
                    </button>
                    <button
                      type="button"
                      className={button}
                      disabled={working}
                      onClick={() => {
                        setPending(null);
                        setRetained(false);
                        setMessage(
                          recoveryKey.trim()
                            ? 'Prepared retry discarded locally; the original request may still commit.'
                            : 'Prepared batch discarded; nothing was sent.',
                        );
                      }}
                    >
                      Discard prepared batch
                    </button>
                  </div>
                </>
              )}
              {sent && !completed && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={button}
                    disabled={working}
                    onClick={() => void checkStatus(pending.idempotencyKey)}
                  >
                    Check current batch status
                  </button>
                  <button
                    type="button"
                    className={primary}
                    disabled={working}
                    onClick={() => void run((isCurrent) => sendImport(pending, isCurrent))}
                  >
                    Retry same batch
                  </button>
                </div>
              )}
            </div>
          )}
          {completed && (
            <div className="space-y-2 rounded border border-emerald-300 bg-emerald-50 p-3">
              <p>
                Batch #{completed.batchId}: {completed.rowCount} services recorded
                {completed.replay ? ' (existing result)' : ''}.
              </p>
              <button
                type="button"
                className={button}
                disabled={working}
                onClick={() => {
                  setPending(null);
                  setSent(false);
                  setRetained(false);
                  setCompleted(null);
                  setText('');
                  setReview(null);
                  setApproval('');
                  setRecoveryKey('');
                  setConfirmed(false);
                  setMessage('');
                  setError('');
                }}
              >
                Start a new batch
              </button>
            </div>
          )}
          {!locked && (
            <details className="rounded-lg bg-slate-50 p-3">
              <summary className="cursor-pointer font-semibold">
                Check a previously retained identity
              </summary>
              <label className="block mt-2">
                Retry identity
                <input
                  className={field}
                  value={lookup}
                  maxLength={128}
                  disabled={working}
                  onChange={(event) => setLookup(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={`${button} mt-2`}
                disabled={working || !lookup.trim()}
                onClick={() => void checkStatus(lookup)}
              >
                Check retained batch status
              </button>
            </details>
          )}
        </div>
      )}
    </section>
  );
};
