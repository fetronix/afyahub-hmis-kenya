/**
 * Three-way matching, supplier returns and supplier credit notes.
 *
 * The screen exists because a payable is a claim, not a fact. Before finance
 * pays an invoice this panel shows whether the order, the receipt and the
 * invoice agree. Where they do not, the difference is named line by line, and
 * accepting it requires a written reason from a named user.
 *
 * Returns and credit notes live here too: both are ways a payable comes down
 * after it was raised, and putting them beside the match keeps the three
 * stages — check, give back, credit — in one place instead of scattering them
 * across receiving and accounts.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, FileMinus2, RotateCcw, ShieldAlert } from 'lucide-react';

import {
  procurementWorkflowClient as procurement,
  type GoodsReceivedNoteRow,
  type InvoiceMatch,
  type SupplierCreditNoteRow,
  type SupplierInvoiceRow,
  type SupplierReturnRow,
} from '../../api/clients/procurement-workflow.client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { PrimaryButton, SecondaryButton } from '../ui/controls.tsx';
import { AlertBanner, EmptyState, LoadingSkeleton, StatusBadge } from '../ui/feedback.tsx';
import { DataTable, StatCard } from '../ui/layout.tsx';
import { Modal } from '../ui/overlays.tsx';

const today = () => new Date().toISOString().slice(0, 10);

const RETURN_REASONS = [
  ['REJECTED_QUALITY', 'Rejected — quality'],
  ['DAMAGED_IN_TRANSIT', 'Damaged in transit'],
  ['WRONG_ITEM', 'Wrong item supplied'],
  ['OVER_DELIVERY', 'Over-delivery'],
  ['ORDER_CANCELLED', 'Order cancelled'],
  ['EXPIRED_STOCK', 'Expired stock'],
] as const;

const FINDING_LABELS: Record<string, string> = {
  PRICE_VARIANCE: 'Price differs from the order',
  AMOUNT_VARIANCE: 'Invoice total differs from the receipt',
  DUPLICATE_INVOICE_NUMBER: 'Supplier has billed this number before',
  INVOICE_BEFORE_RECEIPT: 'Invoice dated before the goods arrived',
  NO_RECEIPT_LINES: 'No receipt lines to compare against',
  OVER_RECEIPT: 'Invoiced quantity exceeds what was received',
};

const money = (cents: number | string) => (Number(cents) / 100).toFixed(2);

type MatchRow = { invoice: SupplierInvoiceRow; match: InvoiceMatch | null; matchError?: string };

export function MatchingReturnsPanel({
  facilityId,
  canDecide,
}: {
  facilityId: number;
  /** Accepting a variance, returning goods and crediting an invoice all move money. */
  canDecide: boolean;
}) {
  const { showToast } = useHmis();
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [returns, setReturns] = useState<SupplierReturnRow[]>([]);
  const [credits, setCredits] = useState<SupplierCreditNoteRow[]>([]);
  const [notes, setNotes] = useState<GoodsReceivedNoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [overrideFor, setOverrideFor] = useState<MatchRow | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  const [returnFor, setReturnFor] = useState<GoodsReceivedNoteRow | null>(null);
  const [returnNumber, setReturnNumber] = useState('');
  const [returnDate, setReturnDate] = useState(today());
  const [returnReason, setReturnReason] = useState<string>('REJECTED_QUALITY');
  const [returnQtys, setReturnQtys] = useState<Record<string, string>>({});

  const [creditFor, setCreditFor] = useState<SupplierInvoiceRow | null>(null);
  const [creditNumber, setCreditNumber] = useState('');
  const [creditDate, setCreditDate] = useState(today());
  const [creditSubtotal, setCreditSubtotal] = useState('');
  const [creditTax, setCreditTax] = useState('');
  const [creditRecoverable, setCreditRecoverable] = useState(true);

  const load = useCallback(async () => {
    if (!facilityId) return;
    setLoading(true);
    setError(null);
    try {
      const [invoices, returnRows, creditRows, noteRows] = await Promise.all([
        procurement.listSupplierInvoices(facilityId),
        procurement.listSupplierReturns(facilityId).then((response) => response.returns),
        procurement.listSupplierCreditNotes(facilityId).then((response) => response.creditNotes),
        procurement.listGoodsReceivedNotes(facilityId),
      ]);

      /*
       * One request per invoice, and the failure of one must not blank the
       * screen: an invoice with no verdict yet is a normal state that the
       * panel shows as "not checked" rather than an error.
       */
      const withMatches = await Promise.all(
        invoices.map(async (invoice): Promise<MatchRow> => {
          try {
            const response = await procurement.getInvoiceMatch(facilityId, invoice.id);
            return { invoice, match: response.match };
          } catch {
            return { invoice, match: null, matchError: 'Verdict could not be read.' };
          }
        }),
      );

      setRows(withMatches);
      setReturns(returnRows);
      setCredits(creditRows);
      setNotes(noteRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Matching records could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    /* Loading on mount is the intended behaviour here: the panel has no parent
       to hand it data, so the effect is the only trigger. */
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  const summary = useMemo(() => {
    const unmatched = rows.filter((row) => !row.match).length;
    const variance = rows.filter((row) => row.match?.status === 'VARIANCE').length;
    const cleared = rows.filter(
      (row) => row.match?.status === 'MATCHED' || row.match?.status === 'OVERRIDDEN',
    ).length;
    return { unmatched, variance, cleared };
  }, [rows]);

  async function runMatch(row: MatchRow) {
    setBusy(true);
    try {
      const response = await procurement.runInvoiceMatch(facilityId, row.invoice.id);
      setRows((current) =>
        current.map((entry) =>
          entry.invoice.id === row.invoice.id ? { ...entry, match: response.match } : entry,
        ),
      );
      showToast(
        response.match.status === 'MATCHED'
          ? `${row.invoice.invoiceNumber} matches its order and receipt.`
          : `${row.invoice.invoiceNumber} does not match. Review the differences below.`,
        { tone: response.match.status === 'MATCHED' ? 'success' : 'warning' },
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'The match could not be run.', {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitOverride() {
    if (!overrideFor) return;
    if (overrideReason.trim().length < 10) {
      showToast('Record at least 10 characters explaining why the difference is accepted.', {
        tone: 'warning',
      });
      return;
    }
    setBusy(true);
    try {
      const response = await procurement.overrideInvoiceMatch(
        facilityId,
        overrideFor.invoice.id,
        overrideReason.trim(),
      );
      setRows((current) =>
        current.map((entry) =>
          entry.invoice.id === overrideFor.invoice.id ? { ...entry, match: response.match } : entry,
        ),
      );
      showToast('Difference accepted and recorded against your name.', { tone: 'success' });
      setOverrideFor(null);
      setOverrideReason('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'The difference could not be accepted.', {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  function openReturn(note: GoodsReceivedNoteRow) {
    setReturnFor(note);
    setReturnNumber(`RET-${note.grnNumber}`);
    setReturnDate(today());
    setReturnReason('REJECTED_QUALITY');
    setReturnQtys({});
  }

  async function submitReturn() {
    if (!returnFor) return;
    const lines = Object.entries(returnQtys)
      .map(([itemId, raw]) => ({
        goodsReceivedNoteItemId: Number(itemId),
        quantity: Number(raw),
      }))
      .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);

    if (lines.length === 0) {
      showToast('Enter a quantity to return on at least one line.', { tone: 'warning' });
      return;
    }
    setBusy(true);
    try {
      const response = await procurement.postSupplierReturn(facilityId, {
        goodsReceivedNoteId: returnFor.id,
        returnNumber: returnNumber.trim(),
        returnDate,
        reasonCode: returnReason,
        idempotencyKey: `return-${returnFor.id}-${returnNumber.trim()}`,
        lines,
      });
      showToast(
        `Return ${response.return.returnNumber} posted; stock and ${
          response.return.counterpart === 'PAYABLE' ? 'the payable' : 'the accrual'
        } were reduced.`,
        { tone: 'success' },
      );
      setReturnFor(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'The return could not be posted.', {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  function openCredit(invoice: SupplierInvoiceRow) {
    setCreditFor(invoice);
    setCreditNumber(`CN-${invoice.invoiceNumber}`);
    setCreditDate(today());
    setCreditSubtotal('');
    setCreditTax('');
    setCreditRecoverable(true);
  }

  async function submitCredit() {
    if (!creditFor) return;
    if (!(Number(creditSubtotal) > 0)) {
      showToast('Enter the credit subtotal before posting.', { tone: 'warning' });
      return;
    }
    setBusy(true);
    try {
      const response = await procurement.createSupplierCreditNote(facilityId, {
        supplierId: creditFor.supplierId,
        supplierInvoiceId: creditFor.id,
        creditNoteNumber: creditNumber.trim(),
        creditNoteDate: creditDate,
        subtotal: creditSubtotal,
        tax: creditTax || '0',
        taxRecoverable: creditRecoverable,
        idempotencyKey: `credit-${creditFor.id}-${creditNumber.trim()}`,
      });
      showToast(
        `Credit note ${response.creditNote.creditNoteNumber} applied to ${creditFor.invoiceNumber}.`,
        { tone: 'success' },
      );
      setCreditFor(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'The credit note could not be recorded.', {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingSkeleton rows={6} />;

  return (
    <div className="space-y-6">
      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Not yet checked"
          value={String(summary.unmatched)}
          detail="Invoices with no three-way verdict; these cannot be paid."
        />
        <StatCard
          label="Differences open"
          value={String(summary.variance)}
          detail="Invoices whose order, receipt and invoice disagree."
        />
        <StatCard
          label="Cleared to pay"
          value={String(summary.cleared)}
          detail="Matched, or differences accepted in writing."
        />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-ink">Invoice matching</h2>
        <p className="text-xs text-muted">
          An invoice is payable only when it agrees with the order and the receipt, or when a named
          user has accepted the difference in writing. Payment is refused otherwise, in the service,
          not only on this screen.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No supplier invoices"
          description="Book an invoice against a goods received note to start matching."
        />
      ) : (
        <DataTable className="table-quiet">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Supplier</th>
              <th className="text-right">Total</th>
              <th>Verdict</th>
              <th>Differences</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.invoice.id}>
                <td>
                  <div className="font-medium">{row.invoice.invoiceNumber}</div>
                  <div className="text-xs text-muted">{row.invoice.invoiceDate}</div>
                </td>
                <td>{row.invoice.supplierName ?? '—'}</td>
                <td className="text-right tabular-nums">{row.invoice.totalAmountKes}</td>
                <td>
                  {row.match ? (
                    <StatusBadge
                      tone={
                        row.match.status === 'MATCHED'
                          ? 'success'
                          : row.match.status === 'OVERRIDDEN'
                            ? 'info'
                            : 'warning'
                      }
                    >
                      {row.match.status}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">NOT CHECKED</StatusBadge>
                  )}
                </td>
                <td className="text-xs">
                  {row.matchError ? (
                    <span className="text-red-700">{row.matchError}</span>
                  ) : row.match && row.match.findings.length > 0 ? (
                    <ul className="space-y-1">
                      {row.match.findings.map((finding) => (
                        <li key={finding.code}>
                          <span className="font-medium">
                            {FINDING_LABELS[finding.code] ?? finding.code}
                          </span>
                          {finding.amountCents !== undefined && (
                            <span className="text-muted"> · KES {money(finding.amountCents)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : row.match?.overrideReason ? (
                    <span className="text-muted">Accepted: {row.match.overrideReason}</span>
                  ) : (
                    <span className="text-muted">None</span>
                  )}
                </td>
                <td className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {canDecide && (
                      <SecondaryButton onClick={() => void runMatch(row)} disabled={busy}>
                        <BadgeCheck size={14} /> {row.match ? 'Re-check' : 'Check'}
                      </SecondaryButton>
                    )}
                    {canDecide && row.match?.status === 'VARIANCE' && (
                      <SecondaryButton onClick={() => setOverrideFor(row)} disabled={busy}>
                        <ShieldAlert size={14} /> Accept
                      </SecondaryButton>
                    )}
                    {canDecide && Number(row.invoice.balanceKes) > 0 && (
                      <SecondaryButton onClick={() => openCredit(row.invoice)} disabled={busy}>
                        <FileMinus2 size={14} /> Credit
                      </SecondaryButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <div>
        <h2 className="text-sm font-semibold text-ink">Returns to supplier</h2>
        <p className="text-xs text-muted">
          A return takes the goods out of the lot they arrived in, at that lot&apos;s cost. Before
          the invoice is booked it reduces the accrual; after, it reduces the payable.
        </p>
      </div>

      {notes.length === 0 ? (
        <EmptyState
          title="No receipts to return against"
          description="Record a goods received note first."
        />
      ) : (
        <DataTable className="table-quiet">
          <thead>
            <tr>
              <th>Receipt</th>
              <th>Received</th>
              <th className="text-right">Value (KES)</th>
              <th>Invoice</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {notes.map((note) => (
              <tr key={note.id}>
                <td className="font-medium">{note.grnNumber}</td>
                <td>{note.receivedDate}</td>
                <td className="text-right tabular-nums">{note.inventoryValueKes}</td>
                <td>
                  {note.invoice ? (
                    <StatusBadge tone="info">{note.invoice.invoiceNumber}</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">NOT INVOICED</StatusBadge>
                  )}
                </td>
                <td className="text-right">
                  {canDecide && note.status === 'POSTED' && (
                    <SecondaryButton onClick={() => openReturn(note)} disabled={busy}>
                      <RotateCcw size={14} /> Return goods
                    </SecondaryButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {returns.length > 0 && (
        <DataTable className="table-quiet">
          <thead>
            <tr>
              <th>Return</th>
              <th>Date</th>
              <th>Reason</th>
              <th className="text-right">Value</th>
              <th>Applied to</th>
            </tr>
          </thead>
          <tbody>
            {returns.map((row) => (
              <tr key={row.id}>
                <td className="font-medium">{row.returnNumber}</td>
                <td>{row.returnDate}</td>
                <td>
                  {RETURN_REASONS.find(([code]) => code === row.reasonCode)?.[1] ?? row.reasonCode}
                </td>
                <td className="text-right tabular-nums">{money(row.totalCents)}</td>
                <td>{row.counterpart === 'PAYABLE' ? 'Payable' : 'Accrual (not yet invoiced)'}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <div>
        <h2 className="text-sm font-semibold text-ink">Supplier credit notes</h2>
        <p className="text-xs text-muted">
          A credit note reduces the payable and reverses recoverable tax out of input VAT. It can
          never take an invoice balance below zero.
        </p>
      </div>

      {credits.length === 0 ? (
        <EmptyState
          title="No credit notes"
          description="Credit an invoice when the supplier agrees a reduction."
        />
      ) : (
        <DataTable className="table-quiet">
          <thead>
            <tr>
              <th>Credit note</th>
              <th>Date</th>
              <th className="text-right">Total</th>
              <th className="text-right">Applied</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {credits.map((row) => (
              <tr key={row.id}>
                <td className="font-medium">{row.creditNoteNumber}</td>
                <td>{row.creditNoteDate}</td>
                <td className="text-right tabular-nums">{money(row.totalCents)}</td>
                <td className="text-right tabular-nums">{money(row.appliedCents)}</td>
                <td>
                  <StatusBadge tone={row.status === 'APPLIED' ? 'success' : 'warning'}>
                    {row.status}
                  </StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {overrideFor && (
        <Modal
          open
          title={`Accept difference on ${overrideFor.invoice.invoiceNumber}`}
          onClose={() => setOverrideFor(null)}
        >
          <div className="space-y-3 text-xs">
            <p className="text-muted">
              This allows the invoice to be paid despite the differences listed. Your name, the time
              and the reason are recorded in the audit trail.
            </p>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-slate-600">Why is the difference accepted?</span>
              <textarea
                className="ui-input"
                rows={3}
                value={overrideReason}
                placeholder="For example: supplier invoiced the agreed post-delivery increase."
                onChange={(event) => setOverrideReason(event.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => setOverrideFor(null)}>Cancel</SecondaryButton>
              <PrimaryButton onClick={() => void submitOverride()} disabled={busy}>
                Accept and record
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}

      {returnFor && (
        <Modal
          open
          title={`Return goods — ${returnFor.grnNumber}`}
          onClose={() => setReturnFor(null)}
        >
          <div className="space-y-3 text-xs">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="font-medium text-slate-600">Return number</span>
                <input
                  className="ui-input"
                  value={returnNumber}
                  onChange={(event) => setReturnNumber(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium text-slate-600">Return date</span>
                <input
                  type="date"
                  className="ui-input"
                  value={returnDate}
                  onChange={(event) => setReturnDate(event.target.value)}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-slate-600">Reason</span>
              <select
                className="ui-input"
                value={returnReason}
                onChange={(event) => setReturnReason(event.target.value)}
              >
                {RETURN_REASONS.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="space-y-2">
              <p className="text-xs font-medium text-ink">Quantity to return</p>
              {returnFor.items.map((item) => (
                <div key={item.id} className="flex items-center gap-2">
                  <div className="flex-1 text-xs">
                    <div className="font-medium">{item.description}</div>
                    <div className="text-muted">
                      Received {item.quantityReceived} · unit cost {item.unitCost}
                    </div>
                  </div>
                  <input
                    aria-label={`Quantity to return for ${item.description}`}
                    className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    inputMode="numeric"
                    value={returnQtys[String(item.id)] ?? ''}
                    onChange={(event) =>
                      setReturnQtys((current) => ({
                        ...current,
                        [String(item.id)]: event.target.value,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => setReturnFor(null)}>Cancel</SecondaryButton>
              <PrimaryButton onClick={() => void submitReturn()} disabled={busy}>
                Post return
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}

      {creditFor && (
        <Modal
          open
          title={`Credit note against ${creditFor.invoiceNumber}`}
          onClose={() => setCreditFor(null)}
        >
          <div className="space-y-3 text-xs">
            <p className="text-muted">
              Invoice balance is KES {creditFor.balanceKes}. A credit larger than the balance is
              refused.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="font-medium text-slate-600">Credit note number</span>
                <input
                  className="ui-input"
                  value={creditNumber}
                  onChange={(event) => setCreditNumber(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium text-slate-600">Credit note date</span>
                <input
                  type="date"
                  className="ui-input"
                  value={creditDate}
                  onChange={(event) => setCreditDate(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium text-slate-600">Subtotal (KES)</span>
                <input
                  className="ui-input"
                  inputMode="decimal"
                  value={creditSubtotal}
                  onChange={(event) => setCreditSubtotal(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium text-slate-600">Tax (KES)</span>
                <input
                  className="ui-input"
                  inputMode="decimal"
                  value={creditTax}
                  onChange={(event) => setCreditTax(event.target.value)}
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={creditRecoverable}
                onChange={(event) => setCreditRecoverable(event.target.checked)}
              />
              Tax is recoverable, so reverse it out of input VAT
            </label>
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => setCreditFor(null)}>Cancel</SecondaryButton>
              <PrimaryButton onClick={() => void submitCredit()} disabled={busy}>
                Apply credit
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
