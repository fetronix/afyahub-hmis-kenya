import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { parseMoneyToCents } from '../../billing/settlement.ts';
import type { ClinicalCatalogueService } from '../../types/index.ts';

type Props = {
  facilityId: number;
  patientId: number;
  encounterId: number;
  orderedBy: string;
  canOrderLab: boolean;
  canOrderImaging: boolean;
  onCreated: () => void;
};

/** Adds real clinical orders, not manual invoice items or claims of performance. */
export const AddClinicalService: React.FC<Props> = ({
  facilityId,
  patientId,
  encounterId,
  orderedBy,
  canOrderLab,
  canOrderImaging,
  onCreated,
}) => {
  const [open, setOpen] = useState(false);
  const [family, setFamily] = useState<'LABORATORY' | 'RADIOLOGY'>(
    canOrderLab ? 'LABORATORY' : 'RADIOLOGY',
  );
  const [rows, setRows] = useState<ClinicalCatalogueService[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [labs, setLabs] = useState<Record<number, string>>({});
  const [exam, setExam] = useState('');
  const [modality, setModality] = useState('');
  const [priority, setPriority] = useState('');
  const [indication, setIndication] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const scopeVersion = useRef(0);

  useEffect(() => {
    scopeVersion.current += 1;
    setOpen(false);
    setRows([]);
    setLabs({});
    setExam('');
    setModality('');
    setPriority('');
    setIndication('');
    setSearch('');
    setError('');
    setNotice('');
    requestRef.current = null;
    return () => {
      scopeVersion.current += 1;
    };
  }, [facilityId, patientId, encounterId]);
  useEffect(() => {
    if (!open || (family === 'LABORATORY' ? !canOrderLab : !canOrderImaging)) return;
    let active = true;
    setLoading(true);
    setError('');
    setRows([]);
    api
      .getClinicalCatalogue(facilityId, family)
      .then((data) => {
        if (!active) return;
        if (!Array.isArray(data)) throw new Error('Invalid catalogue response.');
        // Direct Add Service shows only billable current prices; the OPD clinical
        // exception flow remains available for urgent unpriced care.
        setRows(data.filter((row) => row.priceStatus === 'AVAILABLE' && row.unitPrice !== null));
      })
      .catch(() => {
        if (active) setError('The facility service catalogue could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, family, facilityId, canOrderLab, canOrderImaging]);
  if (!canOrderLab && !canOrderImaging) return null;

  const selected = rows.filter((row) => Object.hasOwn(labs, row.id));
  let total: number | null = 0;
  const priced = family === 'LABORATORY' ? selected : rows.filter((row) => String(row.id) === exam);
  for (const row of priced) {
    const cents = parseMoneyToCents(row.unitPrice);
    if (cents === null || cents <= 0 || !Number.isSafeInteger(total + cents)) {
      total = null;
      break;
    }
    total += cents;
  }
  const eligible =
    family === 'LABORATORY'
      ? selected.length > 0 && selected.every((row) => Boolean(labs[row.id])) && Boolean(priority)
      : Boolean(exam && modality);
  const submit = async () => {
    if (busyRef.current || !eligible || indication.trim().length < 1) return;
    const version = scopeVersion.current;
    const payload =
      family === 'LABORATORY'
        ? {
            encounterId,
            patientId,
            testSelections: selected.map((row) => ({
              testId: row.testId ?? row.id,
              specimenOptionId: Number(labs[row.id]),
            })),
            clinicalIndication: indication.trim(),
            priority,
            orderedBy,
          }
        : {
            facilityId,
            patientId,
            encounterId,
            masterServiceId: Number(exam),
            modality,
            procedureName: rows.find((row) => String(row.id) === exam)?.description ?? '',
            clinicalIndication: indication.trim(),
            status: 'Requested',
            orderedBy,
          };
    const fingerprint = JSON.stringify({ family, payload });
    if (requestRef.current?.fingerprint !== fingerprint)
      requestRef.current = { fingerprint, key: crypto.randomUUID() };
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (family === 'LABORATORY')
        await api.createLabOrderBatch({
          ...(payload as Parameters<typeof api.createLabOrderBatch>[0]),
          idempotencyKey: requestRef.current.key,
        });
      else await api.createRadiologyOrder({ ...payload, idempotencyKey: requestRef.current.key });
      if (scopeVersion.current !== version) return;
      requestRef.current = null;
      setLabs({});
      setExam('');
      setModality('');
      setPriority('');
      setIndication('');
      setNotice(
        'Clinical order recorded. No charge is created until the applicable clinical completion.',
      );
      onCreated();
    } catch (err) {
      if (scopeVersion.current === version)
        setError(
          err instanceof Error
            ? err.message
            : 'The order could not be confirmed; review before retrying.',
        );
    } finally {
      busyRef.current = false;
      if (scopeVersion.current === version) setBusy(false);
    }
  };
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-xl border border-teal-200 bg-teal-50/40 p-3 text-xs"
    >
      <summary className="cursor-pointer font-semibold text-teal-900">
        Add Service — clinical orders
      </summary>
      {open && (
        <div className="mt-3 space-y-3">
          <p>
            Patient #{patientId} · encounter #{encounterId}. Review the current approved price. This
            creates an order, not a charge; laboratory completion or an imaging report is required
            for billing.
          </p>
          <label className="block">
            Department{' '}
            <select
              aria-label="Add service department"
              value={family}
              onChange={(event) => {
                setFamily(event.target.value as typeof family);
                setLabs({});
                setExam('');
                setSearch('');
              }}
              className="ml-2 rounded border p-1"
            >
              {canOrderLab && <option value="LABORATORY">Laboratory</option>}
              {canOrderImaging && <option value="RADIOLOGY">Radiology</option>}
            </select>
          </label>
          <input
            aria-label="Search services to add"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search service name or code"
            className="w-full rounded border p-2"
          />
          {loading && <p role="status">Loading approved services…</p>}
          {error && (
            <p role="alert" className="text-rose-700">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-emerald-800">
              {notice}
            </p>
          )}
          <div className="max-h-56 space-y-2 overflow-auto">
            {rows
              .filter((row) =>
                `${row.code} ${row.description}`.toLowerCase().includes(search.toLowerCase()),
              )
              .map((row) => (
                <div key={row.id} className="rounded border border-slate-200 bg-white p-2">
                  <label className="flex gap-2">
                    <input
                      type={family === 'LABORATORY' ? 'checkbox' : 'radio'}
                      name={family === 'RADIOLOGY' ? `exam-${encounterId}` : undefined}
                      disabled={family === 'LABORATORY' && !row.specimenOptions?.length}
                      checked={
                        family === 'LABORATORY'
                          ? Object.hasOwn(labs, row.id)
                          : exam === String(row.id)
                      }
                      onChange={(event) => {
                        if (family === 'RADIOLOGY') setExam(String(row.id));
                        else
                          setLabs((prior) => {
                            const next = { ...prior };
                            if (event.target.checked) next[row.id] = '';
                            else delete next[row.id];
                            return next;
                          });
                      }}
                    />
                    <span>
                      {row.description} · {row.code} · KES {row.unitPrice} / {row.unit}
                    </span>
                  </label>
                  {family === 'LABORATORY' && !row.specimenOptions?.length && (
                    <p className="ml-5 text-amber-800">
                      A clinically reviewed specimen option is required.
                    </p>
                  )}
                  {family === 'LABORATORY' && Object.hasOwn(labs, row.id) && (
                    <select
                      aria-label={`Add service specimen for ${row.description}`}
                      value={labs[row.id]}
                      onChange={(event) =>
                        setLabs((prior) => ({ ...prior, [row.id]: event.target.value }))
                      }
                      className="ml-5 mt-1 rounded border p-1"
                    >
                      <option value="">Choose specimen</option>
                      {row.specimenOptions?.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.specimenType}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            {!loading && !error && !rows.length && (
              <p>No currently approved, active prices are available for this department.</p>
            )}
          </div>
          {family === 'LABORATORY' && (
            <label className="block">
              Priority{' '}
              <select
                aria-label="Add service laboratory priority"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                className="ml-2 rounded border p-1"
              >
                <option value="">Choose priority</option>
                <option>Routine</option>
                <option>Urgent</option>
                <option>STAT</option>
              </select>
            </label>
          )}
          {family === 'RADIOLOGY' && (
            <label className="block">
              Modality{' '}
              <select
                aria-label="Add service imaging modality"
                value={modality}
                onChange={(event) => setModality(event.target.value)}
                className="ml-2 rounded border p-1"
              >
                <option value="">Choose modality</option>
                <option>X-Ray</option>
                <option>Ultrasound</option>
                <option>CT Scan</option>
                <option>MRI</option>
                <option>Other</option>
              </select>
            </label>
          )}
          <label className="block">
            Clinical indication{' '}
            <input
              aria-label="Add service clinical indication"
              value={indication}
              onChange={(event) => setIndication(event.target.value)}
              maxLength={2000}
              className="ml-2 rounded border p-1"
            />
          </label>
          <p>
            {priced.length
              ? `Quantity: 1 per service · Indicative total ${total === null ? 'unavailable' : `KES ${(total / 100).toFixed(2)}`}`
              : 'Select a service to review its total.'}{' '}
            Prices are rechecked on completion.
          </p>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !eligible || !indication.trim()}
            className="rounded bg-teal-700 px-3 py-2 font-semibold text-white disabled:opacity-40"
          >
            {busy ? 'Submitting…' : 'Create clinical order'}
          </button>
        </div>
      )}
    </details>
  );
};
