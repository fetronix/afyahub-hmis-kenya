/**
 * Purchase requisitions — the department's request before an order exists.
 *
 * The panel is deliberately explicit about who may act: a requester can draft
 * and submit, an approver decides, and the person who raised the request never
 * sees an approve button on their own record.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, FileText, Plus, Send, X } from 'lucide-react';

import { ApiError } from '../../api/client.ts';
import { api } from '../../api/client.ts';
import type {
  RequisitionDetail,
  RequisitionRow,
} from '../../api/clients/procurement-workflow.client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { Modal } from '../ui/overlays.tsx';
import { PrimaryButton, SecondaryButton, SearchBar } from '../ui/controls.tsx';
import { AlertBanner, EmptyState, LoadingSkeleton, StatusBadge } from '../ui/feedback.tsx';
import { DataTable } from '../ui/layout.tsx';

type SupplierOption = { id: number; name: string };

type LineForm = { description: string; quantity: string; unit: string; estimatedUnitPrice: string };

const emptyLine = (): LineForm => ({
  description: '',
  quantity: '1',
  unit: 'unit',
  estimatedUnitPrice: '',
});

const statusTone = (status: RequisitionRow['status']) =>
  status === 'APPROVED' || status === 'CONVERTED'
    ? 'success'
    : status === 'REJECTED' || status === 'CANCELLED'
      ? 'error'
      : status === 'SUBMITTED'
        ? 'warning'
        : 'neutral';

const numberFor = (existing: string[]) => {
  const year = new Date().getFullYear();
  for (let sequence = 1; sequence <= 9999; sequence += 1) {
    const candidate = `REQ-${year}-${String(sequence).padStart(4, '0')}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `REQ-${year}-${Date.now().toString(36).toUpperCase()}`;
};

export function RequisitionsPanel({
  facilityId,
  canCreate,
  canApprove,
  suppliers,
  onChanged,
}: {
  facilityId: number;
  canCreate: boolean;
  canApprove: boolean;
  suppliers: SupplierOption[];
  onChanged?: () => void;
}) {
  const { authenticatedUser, showToast } = useHmis();
  const [rows, setRows] = useState<RequisitionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [convertFor, setConvertFor] = useState<RequisitionDetail | null>(null);
  const [convertSupplier, setConvertSupplier] = useState('');

  const load = useCallback(async () => {
    if (!facilityId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.listRequisitions(facilityId, {
        status: status || undefined,
        search,
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Requisitions could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [facilityId, status, search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(id: number) {
    try {
      setDetail(await api.getRequisition(facilityId, id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Requisition could not be loaded.', {
        tone: 'error',
      });
    }
  }

  async function act(work: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      showToast(message);
      setDetail(null);
      await load();
      onChanged?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'The requisition could not be updated.', {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Purchase requisitions</h2>
          <p className="text-xs text-muted">
            {total} record{total === 1 ? '' : 's'} · draft → submitted → approved → purchase order
          </p>
        </div>
        {canCreate && (
          <PrimaryButton onClick={() => setCreating(true)}>
            <Plus size={15} /> New requisition
          </PrimaryButton>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBar
          aria-label="Search requisitions"
          placeholder="Search number, department or justification"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Filter requisitions by status"
          className="ui-input w-auto"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All statuses</option>
          {['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED'].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      {error && <AlertBanner tone="error">{error}</AlertBanner>}
      {loading ? (
        <LoadingSkeleton label="Loading requisitions" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No requisitions match"
          description={
            canCreate
              ? 'Raise the first department request to start the procurement chain.'
              : 'Ask a requester to raise a request, or clear the filters.'
          }
        />
      ) : (
        <DataTable className="table-quiet">
          <thead>
            <tr>
              <th>Requisition</th>
              <th>Department</th>
              <th>Requested by</th>
              <th className="text-right">Estimate (KES)</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <div className="font-medium">{row.requisitionNumber}</div>
                  <div className="text-xs text-muted">
                    {row.requestDate}
                    {row.neededBy ? ` · needed by ${row.neededBy}` : ''}
                  </div>
                </td>
                <td>{row.department ?? '—'}</td>
                <td>{row.requestedByName}</td>
                <td className="text-right tabular-nums">{row.estimatedTotalKes}</td>
                <td>
                  <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge>
                </td>
                <td className="text-right">
                  <SecondaryButton onClick={() => void openDetail(row.id)}>
                    <FileText size={14} /> Open
                  </SecondaryButton>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {creating && (
        <RequisitionForm
          facilityId={facilityId}
          existing={rows.map((row) => row.requisitionNumber)}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}

      {detail && (
        <Modal
          open
          onClose={() => setDetail(null)}
          title={`Requisition ${detail.requisitionNumber}`}
        >
          <div className="space-y-4">
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <Detail
                label="Status"
                value={<StatusBadge tone={statusTone(detail.status)}>{detail.status}</StatusBadge>}
              />
              <Detail label="Requested by" value={detail.requestedByName} />
              <Detail label="Department" value={detail.department ?? '—'} />
              <Detail label="Request date" value={detail.requestDate} />
              <Detail label="Needed by" value={detail.neededBy ?? '—'} />
              <Detail label="Estimate (KES)" value={detail.estimatedTotalKes} />
              <Detail label="Justification" value={detail.justification} />
              {detail.decisionNote && <Detail label="Decision note" value={detail.decisionNote} />}
            </div>

            <DataTable className="table-quiet">
              <thead>
                <tr>
                  <th>Line</th>
                  <th className="text-right">Qty</th>
                  <th>Unit</th>
                  <th className="text-right">Unit estimate</th>
                  <th className="text-right">Line total</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((item) => (
                  <tr key={item.id ?? item.lineNumber}>
                    <td>{item.description}</td>
                    <td className="text-right tabular-nums">{item.quantity}</td>
                    <td>{item.unit}</td>
                    <td className="text-right tabular-nums">{item.estimatedUnitPrice}</td>
                    <td className="text-right tabular-nums">{item.lineTotal}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>

            <div className="space-y-1 text-xs">
              <p className="font-semibold text-ink">History</p>
              {detail.events.map((event) => (
                <p key={event.id} className="text-muted">
                  {event.eventType} · {new Date(event.createdAt).toLocaleString()}
                  {event.note ? ` · ${event.note}` : ''}
                </p>
              ))}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              {canCreate && detail.status === 'DRAFT' && (
                <PrimaryButton
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => api.submitRequisition(facilityId, detail.id),
                      'Requisition submitted for approval.',
                    )
                  }
                >
                  <Send size={14} /> Submit
                </PrimaryButton>
              )}
              {canApprove &&
                detail.status === 'SUBMITTED' &&
                detail.requestedByUserId !== authenticatedUser?.id && (
                  <>
                    <PrimaryButton
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => api.decideRequisition(facilityId, detail.id, 'approve'),
                          'Requisition approved.',
                        )
                      }
                    >
                      <Check size={14} /> Approve
                    </PrimaryButton>
                    <SecondaryButton
                      disabled={busy}
                      onClick={() => {
                        const note = window.prompt('Reason for rejection');
                        if (!note) return;
                        void act(
                          () => api.decideRequisition(facilityId, detail.id, 'reject', note),
                          'Requisition rejected.',
                        );
                      }}
                    >
                      <X size={14} /> Reject
                    </SecondaryButton>
                  </>
                )}
              {canCreate && detail.status === 'APPROVED' && (
                <PrimaryButton
                  onClick={() => {
                    setConvertSupplier(String(suppliers[0]?.id ?? ''));
                    setConvertFor(detail);
                  }}
                >
                  <FileText size={14} /> Convert to purchase order
                </PrimaryButton>
              )}
              <SecondaryButton onClick={() => setDetail(null)}>Close</SecondaryButton>
            </div>
          </div>
        </Modal>
      )}

      {convertFor && (
        <Modal open onClose={() => setConvertFor(null)} title="Convert to purchase order">
          <div className="space-y-3 text-xs">
            <p className="text-muted">
              The order number is derived from the requisition, so a retried conversion reuses the
              order it already created rather than committing twice.
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Supplier</span>
              <select
                className="ui-input"
                value={convertSupplier}
                onChange={(event) => setConvertSupplier(event.target.value)}
              >
                <option value="">Select a supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => setConvertFor(null)}>Cancel</SecondaryButton>
              <PrimaryButton
                disabled={busy || !convertSupplier}
                onClick={() =>
                  void act(async () => {
                    if (!convertFor) return;
                    const result = await api.convertRequisition(
                      facilityId,
                      convertFor.id,
                      Number(convertSupplier),
                    );
                    setConvertFor(null);
                    showToast(
                      result.idempotentReplay
                        ? 'The purchase order already existed and was re-used.'
                        : `Purchase order ${result.purchaseOrderId} raised for approval.`,
                    );
                  }, 'Requisition converted.')
                }
              >
                Create purchase order
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="text-ink-soft">{value}</div>
    </div>
  );
}

function RequisitionForm({
  facilityId,
  existing,
  onClose,
  onSaved,
}: {
  facilityId: number;
  existing: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { showToast } = useHmis();
  const number = useMemo(() => numberFor(existing), [existing]);
  const [requestDate, setRequestDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [neededBy, setNeededBy] = useState('');
  const [department, setDepartment] = useState('');
  const [justification, setJustification] = useState('');
  const [lines, setLines] = useState<LineForm[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce(
    (sum, line) => sum + Number(line.quantity || 0) * Number(line.estimatedUnitPrice || 0),
    0,
  );

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.createRequisition(facilityId, {
        requisitionNumber: number,
        requestDate,
        neededBy: neededBy || null,
        department: department || null,
        justification,
        items: lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          estimatedUnitPrice: line.estimatedUnitPrice,
        })),
      });
      showToast(`Requisition ${number} saved as a draft.`);
      await onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'The requisition could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`New requisition ${number}`}>
      <div className="space-y-3 text-xs">
        {error && <AlertBanner tone="error">{error}</AlertBanner>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Request date</span>
            <input
              type="date"
              className="ui-input"
              value={requestDate}
              onChange={(event) => setRequestDate(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Needed by</span>
            <input
              type="date"
              className="ui-input"
              value={neededBy}
              onChange={(event) => setNeededBy(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Department</span>
            <input
              className="ui-input"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              placeholder="e.g. Imaging"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Estimated total (KES)</span>
            <input
              className="ui-input"
              readOnly
              value={total.toFixed(2)}
              aria-label="Estimated total"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-slate-600">Justification</span>
          <textarea
            className="ui-input min-h-20"
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
            placeholder="Why is this needed, and what happens if it is not bought?"
          />
        </label>

        <div className="space-y-2">
          <p className="font-semibold text-ink">Lines</p>
          {lines.map((line, index) => (
            <div
              key={index}
              className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_6rem_5rem_7rem_auto]"
            >
              <input
                className="ui-input"
                aria-label={`Line ${index + 1} description`}
                placeholder="Description"
                value={line.description}
                onChange={(event) =>
                  setLines((prev) =>
                    prev.map((item, i) =>
                      i === index ? { ...item, description: event.target.value } : item,
                    ),
                  )
                }
              />
              <input
                className="ui-input"
                aria-label={`Line ${index + 1} quantity`}
                value={line.quantity}
                onChange={(event) =>
                  setLines((prev) =>
                    prev.map((item, i) =>
                      i === index ? { ...item, quantity: event.target.value } : item,
                    ),
                  )
                }
              />
              <input
                className="ui-input"
                aria-label={`Line ${index + 1} unit`}
                value={line.unit}
                onChange={(event) =>
                  setLines((prev) =>
                    prev.map((item, i) =>
                      i === index ? { ...item, unit: event.target.value } : item,
                    ),
                  )
                }
              />
              <input
                className="ui-input"
                aria-label={`Line ${index + 1} unit estimate`}
                placeholder="Unit KES"
                value={line.estimatedUnitPrice}
                onChange={(event) =>
                  setLines((prev) =>
                    prev.map((item, i) =>
                      i === index ? { ...item, estimatedUnitPrice: event.target.value } : item,
                    ),
                  )
                }
              />
              <SecondaryButton
                aria-label={`Remove line ${index + 1}`}
                disabled={lines.length === 1}
                onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
              >
                <X size={14} />
              </SecondaryButton>
            </div>
          ))}
          <SecondaryButton onClick={() => setLines((prev) => [...prev, emptyLine()])}>
            <Plus size={14} /> Add line
          </SecondaryButton>
        </div>

        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton
            disabled={
              saving || !justification.trim() || lines.some((line) => !line.description.trim())
            }
            onClick={() => void submit()}
          >
            {saving ? 'Saving…' : 'Save draft'}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
