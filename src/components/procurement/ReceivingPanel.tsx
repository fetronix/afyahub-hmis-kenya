/**
 * Goods receiving and accounts payable.
 *
 * Two steps on purpose: the person who receives the goods records what
 * physically arrived; finance then books the supplier invoice against that
 * note and pays it. Neither step can invent stock or a payable that the other
 * did not evidence.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { PackageCheck, ReceiptText, Wallet } from 'lucide-react';

import { api } from '../../api/client.ts';
import { documentClient, openBlob } from '../../api/clients/branding.client.ts';
import {
  listFacilityBankAccounts,
  listPostingAccounts,
  type GoodsReceivedNoteRow,
  type OutstandingOrderLine,
  type PostingAccount,
  type SupplierInvoiceRow,
} from '../../api/clients/procurement-workflow.client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { SecondaryButton, PrimaryButton } from '../ui/controls.tsx';
import { AlertBanner, EmptyState, LoadingSkeleton, StatusBadge } from '../ui/feedback.tsx';
import { DataTable, StatCard } from '../ui/layout.tsx';
import { Modal } from '../ui/overlays.tsx';

type OrderOption = { id: number; poNumber: string; supplierId: number; status: string | null };

const today = () => new Date().toISOString().slice(0, 10);

export function ReceivingPanel({
  facilityId,
  orders,
  canReceive,
}: {
  facilityId: number;
  orders: OrderOption[];
  canReceive: boolean;
}) {
  const { showToast } = useHmis();
  const [notes, setNotes] = useState<GoodsReceivedNoteRow[]>([]);
  const [invoices, setInvoices] = useState<SupplierInvoiceRow[]>([]);
  const [accounts, setAccounts] = useState<PostingAccount[]>([]);
  const [banks, setBanks] = useState<Array<{ id: number; accountName: string; bankName: string }>>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [printingGrn, setPrintingGrn] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiveFor, setReceiveFor] = useState<OrderOption | null>(null);
  const [receiveOrderId, setReceiveOrderId] = useState('');
  const [invoiceFor, setInvoiceFor] = useState<GoodsReceivedNoteRow | null>(null);
  const [payFor, setPayFor] = useState<SupplierInvoiceRow | null>(null);

  const load = useCallback(async () => {
    if (!facilityId) return;
    setLoading(true);
    setError(null);
    try {
      const [noteRows, invoiceRows, accountRows, bankRows] = await Promise.all([
        api.listGoodsReceivedNotes(facilityId),
        api.listSupplierInvoices(facilityId),
        listPostingAccounts(facilityId).catch(() => []),
        listFacilityBankAccounts(facilityId).catch(() => []),
      ]);
      setNotes(noteRows);
      setInvoices(invoiceRows);
      setAccounts(accountRows);
      setBanks(bankRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Receiving records could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  /** The note as posted: the delivery evidence, not a recomputed quantity. */
  const printGrn = async (id: number, grnNumber: string) => {
    setPrintingGrn(id);
    try {
      const blob = await documentClient.goodsReceivedNote(id);
      openBlob(blob, `${grnNumber}.pdf`);
    } catch (err) {
      showToast(
        err instanceof Error
          ? `The goods received note could not be generated: ${err.message}`
          : 'The goods received note could not be generated.',
      );
    } finally {
      setPrintingGrn(null);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const payableTotal = invoices.reduce(
    (sum, invoice) => sum + Math.round(Number(invoice.balanceKes) * 100),
    0,
  );
  const receivedThisMonth = notes.filter(
    (note) => note.receivedDate.slice(0, 7) === today().slice(0, 7),
  );
  const receivable = orders.filter((order) =>
    ['Approved', 'Partially Received', 'Ordered', 'In Transit'].includes(order.status ?? ''),
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Goods received notes" value={String(notes.length)} detail="Posted notes" />
        <StatCard
          label="Received this month"
          value={String(receivedThisMonth.length)}
          detail="Notes dated in the current month"
        />
        <StatCard
          label="Payables outstanding (KES)"
          value={(payableTotal / 100).toFixed(2)}
          detail="Open supplier invoice balances"
        />
      </div>

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Goods received notes</h2>
          <p className="text-xs text-muted">
            A note can only receive what the approved order still has outstanding, and it updates
            the stock batch in the same transaction.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canReceive && (
            <>
              <select
                aria-label="Purchase order to receive"
                className="ui-input w-auto"
                value={receiveOrderId}
                onChange={(event) => setReceiveOrderId(event.target.value)}
              >
                <option value="">
                  {receivable.length ? 'Select an approved order' : 'No order awaiting delivery'}
                </option>
                {receivable.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.poNumber} · {order.status}
                  </option>
                ))}
              </select>
              <PrimaryButton
                disabled={!receiveOrderId}
                onClick={() =>
                  setReceiveFor(
                    receivable.find((order) => order.id === Number(receiveOrderId)) ?? null,
                  )
                }
              >
                <PackageCheck size={15} /> Receive goods
              </PrimaryButton>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton label="Loading receiving records" />
      ) : notes.length === 0 ? (
        <EmptyState
          title="No goods received yet"
          description={
            receivable.length
              ? 'Record the delivery against an approved purchase order.'
              : 'Approve a purchase order first; goods can only be received against an approved order.'
          }
        />
      ) : (
        <DataTable className="table-quiet">
          <thead>
            <tr>
              <th>GRN</th>
              <th>Received</th>
              <th className="text-right">Value (KES)</th>
              <th>Invoice</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {notes.map((note) => (
              <tr key={note.id}>
                <td>
                  <div className="font-medium">{note.grnNumber}</div>
                  <div className="text-xs text-muted">
                    Order #{note.purchaseOrderId} · {note.items.length} line(s)
                  </div>
                </td>
                <td>
                  <div>{note.receivedDate}</div>
                  <div className="text-xs text-muted">{note.receivedByName}</div>
                </td>
                <td className="text-right tabular-nums">{note.inventoryValueKes}</td>
                <td>
                  {note.invoice ? (
                    <StatusBadge tone="success">{note.invoice.invoiceNumber}</StatusBadge>
                  ) : (
                    <StatusBadge tone="warning">NOT INVOICED</StatusBadge>
                  )}
                </td>
                <td className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <SecondaryButton
                      disabled={printingGrn === note.id}
                      onClick={() => void printGrn(note.id, note.grnNumber)}
                    >
                      <PackageCheck size={14} />
                      {printingGrn === note.id ? 'Generating…' : 'GRN PDF'}
                    </SecondaryButton>
                    {canReceive && !note.invoice && (
                      <SecondaryButton onClick={() => setInvoiceFor(note)}>
                        <ReceiptText size={14} /> Book invoice
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
        <h2 className="text-sm font-semibold text-ink">Accounts payable</h2>
        <p className="text-xs text-muted">
          Invoices post expense against accounts payable; payments clear the payable against a bank
          account. Both post balanced journals in the same transaction as the record.
        </p>
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          title="No supplier invoices"
          description="Book an invoice against a goods received note to open the payable."
        />
      ) : (
        <DataTable className="table-quiet">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Supplier</th>
              <th className="text-right">Total</th>
              <th className="text-right">Paid</th>
              <th className="text-right">Balance</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>
                  <div className="font-medium">{invoice.invoiceNumber}</div>
                  <div className="text-xs text-muted">
                    {invoice.invoiceDate}
                    {invoice.dueDate ? ` · due ${invoice.dueDate}` : ''}
                  </div>
                </td>
                <td>{invoice.supplierName ?? '—'}</td>
                <td className="text-right tabular-nums">{invoice.totalAmountKes}</td>
                <td className="text-right tabular-nums">{invoice.paidAmountKes}</td>
                <td className="text-right tabular-nums">{invoice.balanceKes}</td>
                <td>
                  <StatusBadge tone={invoice.status === 'PAID' ? 'success' : 'warning'}>
                    {invoice.status}
                  </StatusBadge>
                </td>
                <td className="text-right">
                  {canReceive && Number(invoice.balanceKes) > 0 && (
                    <SecondaryButton onClick={() => setPayFor(invoice)}>
                      <Wallet size={14} /> Pay
                    </SecondaryButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {receiveFor && (
        <ReceiveDialog
          facilityId={facilityId}
          order={receiveFor}
          onClose={() => setReceiveFor(null)}
          onPosted={async () => {
            setReceiveFor(null);
            await load();
          }}
        />
      )}

      {invoiceFor && (
        <InvoiceDialog
          facilityId={facilityId}
          note={invoiceFor}
          accounts={accounts}
          onClose={() => setInvoiceFor(null)}
          onPosted={async () => {
            setInvoiceFor(null);
            await load();
          }}
        />
      )}

      {payFor && (
        <PaymentDialog
          facilityId={facilityId}
          invoice={payFor}
          banks={banks}
          onClose={() => setPayFor(null)}
          onPosted={async () => {
            setPayFor(null);
            await load();
          }}
        />
      )}

      {!canReceive && (
        <p className="text-xs text-muted">
          Your role can read procurement records but not receive goods, book invoices or pay them.
        </p>
      )}
    </div>
  );
}

function ReceiveDialog({
  facilityId,
  order,
  onClose,
  onPosted,
}: {
  facilityId: number;
  order: OrderOption;
  onClose: () => void;
  onPosted: () => Promise<void>;
}) {
  const { showToast } = useHmis();
  const [lines, setLines] = useState<OutstandingOrderLine[]>([]);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [grnNumber, setGrnNumber] = useState(`GRN-${Date.now().toString(36).toUpperCase()}`);
  const [receivedDate, setReceivedDate] = useState(today());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.outstandingOrderLines(facilityId, order.id);
        if (cancelled) return;
        setLines(result.lines);
        setQuantities(
          Object.fromEntries(
            result.lines.map((line) => [line.id, String(line.outstandingQuantity)]),
          ),
        );
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Order lines could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [facilityId, order.id]);

  async function post() {
    const payload = lines
      .map((line) => ({
        purchaseOrderItemId: line.id,
        quantityReceived: quantities[line.id] ?? '0',
        unitCost: line.unitPrice,
      }))
      .filter((line) => Number(line.quantityReceived) > 0);
    if (!payload.length) {
      setError('Enter a received quantity for at least one line.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.postGoodsReceived(facilityId, {
        purchaseOrderId: order.id,
        grnNumber,
        receivedDate,
        idempotencyKey: `grn:${order.id}:${grnNumber}`,
        lines: payload,
      });
      showToast(`Goods received note ${grnNumber} posted.`);
      await onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The note could not be posted.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Receive goods · ${order.poNumber}`}>
      <div className="space-y-3 text-xs">
        {error && <AlertBanner tone="error">{error}</AlertBanner>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">GRN number</span>
            <input
              className="ui-input"
              value={grnNumber}
              onChange={(e) => setGrnNumber(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Received date</span>
            <input
              type="date"
              className="ui-input"
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
            />
          </label>
        </div>
        {loading ? (
          <LoadingSkeleton label="Loading order lines" />
        ) : (
          <DataTable className="table-quiet">
            <thead>
              <tr>
                <th>Line</th>
                <th className="text-right">Outstanding</th>
                <th className="text-right">Receiving</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <div className="font-medium">{line.description}</div>
                    <div className="text-xs text-muted">
                      ordered {line.quantity} {line.unit} · unit KES {line.unitPrice}
                    </div>
                  </td>
                  <td className="text-right tabular-nums">{line.outstandingQuantity}</td>
                  <td className="text-right">
                    <input
                      className="ui-input w-24 text-right"
                      aria-label={`Received quantity for ${line.description}`}
                      value={quantities[line.id] ?? ''}
                      onChange={(event) =>
                        setQuantities((prev) => ({ ...prev, [line.id]: event.target.value }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        <p className="text-muted">
          Lines that track stock also need a batch number and expiry; add them from the stock module
          immediately after receipt so recall evidence stays complete.
        </p>
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton disabled={saving || loading} onClick={() => void post()}>
            {saving ? 'Posting…' : 'Post goods received'}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function InvoiceDialog({
  facilityId,
  note,
  accounts,
  onClose,
  onPosted,
}: {
  facilityId: number;
  note: GoodsReceivedNoteRow;
  accounts: PostingAccount[];
  onClose: () => void;
  onPosted: () => Promise<void>;
}) {
  const { showToast } = useHmis();
  const expenseAccounts = accounts.filter((account) => account.accountType === 'EXPENSE');
  const payableAccounts = accounts.filter((account) => account.accountType === 'LIABILITY');
  const [invoiceNumber, setInvoiceNumber] = useState(`INV-${note.grnNumber.slice(-6)}`);
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [tax, setTax] = useState('0.00');
  const [expenseAccountId, setExpenseAccountId] = useState(String(expenseAccounts[0]?.id ?? ''));
  const [apAccountId, setApAccountId] = useState(String(payableAccounts[0]?.id ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    setSaving(true);
    setError(null);
    try {
      await api.createSupplierInvoice(facilityId, {
        goodsReceivedNoteId: note.id,
        invoiceNumber,
        invoiceDate,
        dueDate: dueDate || null,
        expenseAccountId: Number(expenseAccountId),
        apAccountId: Number(apAccountId),
        taxAmount: tax,
        idempotencyKey: `invoice:${note.id}`,
      });
      showToast(`Invoice ${invoiceNumber} posted to accounts payable.`);
      await onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The invoice could not be posted.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Book supplier invoice · ${note.grnNumber}`}>
      <div className="space-y-3 text-xs">
        {error && <AlertBanner tone="error">{error}</AlertBanner>}
        <AlertBanner tone="info">
          Goods value on the note is KES {note.inventoryValueKes}. The invoice posts that amount
          plus tax: expense debited, accounts payable credited.
        </AlertBanner>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Invoice number</span>
            <input
              className="ui-input"
              value={invoiceNumber}
              onChange={(event) => setInvoiceNumber(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Invoice date</span>
            <input
              type="date"
              className="ui-input"
              value={invoiceDate}
              onChange={(event) => setInvoiceDate(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Due date</span>
            <input
              type="date"
              className="ui-input"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Tax (KES)</span>
            <input
              className="ui-input"
              value={tax}
              onChange={(event) => setTax(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Expense account</span>
            <select
              className="ui-input"
              value={expenseAccountId}
              onChange={(event) => setExpenseAccountId(event.target.value)}
            >
              {expenseAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.accountCode} · {account.accountName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Accounts payable account</span>
            <select
              className="ui-input"
              value={apAccountId}
              onChange={(event) => setApAccountId(event.target.value)}
            >
              {payableAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.accountCode} · {account.accountName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton
            disabled={saving || !expenseAccountId || !apAccountId}
            onClick={() => void post()}
          >
            {saving ? 'Posting…' : 'Post invoice'}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function PaymentDialog({
  facilityId,
  invoice,
  banks,
  onClose,
  onPosted,
}: {
  facilityId: number;
  invoice: SupplierInvoiceRow;
  banks: Array<{ id: number; accountName: string; bankName: string }>;
  onClose: () => void;
  onPosted: () => Promise<void>;
}) {
  const { showToast } = useHmis();
  const [amount, setAmount] = useState(invoice.balanceKes);
  const [paymentDate, setPaymentDate] = useState(today());
  const [bankAccountId, setBankAccountId] = useState(String(banks[0]?.id ?? ''));
  const [method, setMethod] = useState('BANK');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    setSaving(true);
    setError(null);
    try {
      await api.paySupplierInvoice(facilityId, invoice.id, {
        amount,
        paymentDate,
        bankAccountId: Number(bankAccountId),
        paymentMethod: method,
        paymentReference: reference || undefined,
        idempotencyKey: `pay:${invoice.id}:${amount}:${paymentDate}`,
      });
      showToast('Supplier payment posted.');
      await onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The payment could not be posted.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Pay supplier invoice ${invoice.invoiceNumber}`}>
      <div className="space-y-3 text-xs">
        {error && <AlertBanner tone="error">{error}</AlertBanner>}
        {banks.length === 0 && (
          <AlertBanner tone="warning">
            No bank or cash account is registered for this facility. Add one in accounting bank
            settings before paying a supplier.
          </AlertBanner>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Amount (KES)</span>
            <input
              className="ui-input"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Payment date</span>
            <input
              type="date"
              className="ui-input"
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Bank / cash account</span>
            <select
              className="ui-input"
              value={bankAccountId}
              onChange={(event) => setBankAccountId(event.target.value)}
            >
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.accountName} · {bank.bankName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-slate-600">Method</span>
            <select
              className="ui-input"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              {['BANK', 'CHEQUE', 'CASH', 'MPESA'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="font-medium text-slate-600">Reference</span>
            <input
              className="ui-input"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Bank slip or cheque number"
            />
          </label>
        </div>
        <p className="text-muted">
          Balance on this invoice is KES {invoice.balanceKes}. A payment above the balance is
          refused by the server.
        </p>
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton disabled={saving || !banks.length || !amount} onClick={() => void post()}>
            {saving ? 'Posting…' : 'Post payment'}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
