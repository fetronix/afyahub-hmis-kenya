import React, { useState, useRef } from 'react';
import { dialogKeyDown } from './dialog.ts';
import { api } from '../../api/client.ts';
import type { PurchaseOrderDetail } from '../../types/index.ts';

type Action = 'approve' | 'reject' | 'complete' | 'cancel';
const labels: Record<Action, string> = {
  approve: 'Approve',
  reject: 'Reject',
  complete: 'Complete',
  cancel: 'Cancel order',
};
const button =
  'rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50';

export function OrderDetails(props: {
  order: PurchaseOrderDetail;
  supplierName: string;
  supplierActive: boolean;
  facilityId: number;
  userId: number;
  can: (permission: string) => boolean;
  onClose: () => void;
  onEdit: () => void;
  onChanged: (message: string) => void;
}) {
  const { order, can } = props;
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const selfApproval =
    order.createdByUserId === props.userId ||
    order.events.some(
      (event) => event.eventType === 'UPDATED' && event.actorUserId === props.userId,
    );
  const pending = order.status === 'Pending Approval';
  const chooseAction = (next: Action) => {
    setAction(next);
    setNote('');
    setConfirmed(false);
    setError('');
  };
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!action || busyRef.current) return;
    if ((action === 'reject' || action === 'cancel' || action === 'complete') && !note.trim()) {
      setError('A reason or completion note is required.');
      return;
    }
    if (action === 'complete' && !confirmed) {
      setError('Please confirm the administrative-only completion.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await api.transitionPurchaseOrder(order.id, action, {
        facilityId: props.facilityId,
        expectedRevision: order.revision ?? 1,
        note: note.trim(),
        ...(action === 'complete' ? { confirmAdministrativeCompletion: confirmed } : {}),
      });
      props.onChanged(
        action === 'complete'
          ? 'Order administratively completed. No receipt, inventory movement or payment was recorded.'
          : `Purchase order ${{ approve: 'approved', reject: 'rejected', cancel: 'cancelled' }[action]}.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update the purchase order.';
      setError(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="po-detail-title"
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 text-sm shadow-xl"
        onKeyDown={(e) =>
          dialogKeyDown(e, () => {
            if (!busyRef.current) props.onClose();
          })
        }
      >
        <div className="flex items-start justify-between gap-3 border-b pb-3">
          <div>
            <h3 id="po-detail-title" className="text-lg font-bold">
              Purchase order {order.poNumber}
            </h3>
            <p className="text-xs text-slate-600">
              {props.supplierName} · {order.status} · Revision {order.revision ?? 1}
            </p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={props.onClose}
            disabled={busy}
            className={button}
          >
            Close
          </button>
        </div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="font-semibold">Requested by</dt>
            <dd>{order.orderedBy || 'Not recorded'}</dd>
          </div>
          <div>
            <dt className="font-semibold">Approved by</dt>
            <dd>{order.approvedBy || 'Not recorded'}</dd>
          </div>
          <div>
            <dt className="font-semibold">Purpose</dt>
            <dd>{order.description || 'Not provided'}</dd>
          </div>
          <div>
            <dt className="font-semibold">Expected delivery</dt>
            <dd>{order.expectedDeliveryDate || 'Not provided'}</dd>
          </div>
          <div>
            <dt className="font-semibold">Delivery address</dt>
            <dd className="whitespace-pre-wrap">{order.deliveryAddress || 'Not provided'}</dd>
          </div>
          <div>
            <dt className="font-semibold">Payment terms</dt>
            <dd>{order.paymentTerms || 'Not provided'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-semibold">Notes</dt>
            <dd className="whitespace-pre-wrap">{order.notes || 'Not provided'}</dd>
          </div>
        </dl>
        <h4 className="mt-5 font-semibold">Order lines</h4>
        {order.items.length ? (
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-left text-xs">
              <thead>
                <tr className="border-b">
                  <th className="py-2">Item</th>
                  <th>Quantity</th>
                  <th>Unit</th>
                  <th>Unit price (KES)</th>
                  <th>Line total (KES)</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item, index) => (
                  <tr key={item.id ?? index} className="border-b">
                    <td className="py-2">{item.description}</td>
                    <td>{item.quantity}</td>
                    <td>{item.unit}</td>
                    <td>{item.unitPrice}</td>
                    <td>{item.lineTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 rounded bg-amber-50 p-3 text-xs text-amber-900">
            Legacy amount-only order: item details were not recorded. Do not assume what was
            ordered.
          </p>
        )}
        <div className="ml-auto mt-3 max-w-xs space-y-1 text-xs">
          {order.subtotalAmount != null && (
            <>
              <p>Subtotal: KES {order.subtotalAmount}</p>
              <p>Tax entered: KES {order.taxAmount}</p>
              <p>Shipping entered: KES {order.shippingAmount}</p>
              <p>Discount entered: KES {order.discountAmount}</p>
            </>
          )}
          <p className="font-bold">Order total: KES {order.totalAmount}</p>
        </div>
        <p className="mt-4 rounded bg-blue-50 p-3 text-xs text-blue-900">
          Approval and completion are internal administrative statuses only. They do not record
          goods receipt, stock movements, supplier invoices, payment or supplier verification.
        </p>
        {pending && !props.supplierActive && can('procurement.approve') && (
          <p className="mt-2 text-xs text-amber-800">
            This supplier is inactive or unavailable. An active supplier is required before
            approval.
          </p>
        )}
        {pending && !order.items.length && can('procurement.approve') && (
          <p className="mt-2 text-xs text-amber-800">
            Enter the actual order lines before approval; legacy amount-only orders cannot be
            approved without itemization.
          </p>
        )}
        {pending && order.createdByUserId == null && can('procurement.approve') && (
          <p className="mt-2 text-xs text-amber-800">
            The creator of this legacy order was not recorded. Check separation of duties manually
            before approval.
          </p>
        )}
        {pending && selfApproval && can('procurement.approve') && (
          <p className="mt-2 text-xs text-amber-800">
            A different user who did not create or edit this order must approve it.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {pending && can('procurement.update') && (
            <button className={button} type="button" onClick={props.onEdit} disabled={busy}>
              Edit pending order
            </button>
          )}
          {pending && can('procurement.approve') && (
            <button
              className={button}
              type="button"
              onClick={() => chooseAction('approve')}
              disabled={busy || selfApproval || !order.items.length || !props.supplierActive}
            >
              Approve
            </button>
          )}
          {pending && can('procurement.reject') && (
            <button
              className={button}
              type="button"
              onClick={() => chooseAction('reject')}
              disabled={busy}
            >
              Reject
            </button>
          )}
          {pending && can('procurement.delete') && (
            <button
              className={button}
              type="button"
              onClick={() => chooseAction('cancel')}
              disabled={busy}
            >
              Cancel order
            </button>
          )}
          {order.status === 'Approved' && can('procurement.complete') && (
            <button
              className={button}
              type="button"
              onClick={() => chooseAction('complete')}
              disabled={busy}
            >
              Complete
            </button>
          )}
        </div>
        {action && (
          <form onSubmit={run} className="mt-4 space-y-3 rounded-lg border border-slate-200 p-3">
            <h4 className="font-semibold">{labels[action]} purchase order</h4>
            <label className="block text-xs font-medium">
              {action === 'approve'
                ? 'Approval note (optional)'
                : action === 'complete'
                  ? 'Completion note *'
                  : 'Reason *'}
              <textarea
                className="mt-1 w-full rounded border border-slate-300 p-2"
                maxLength={2000}
                required={action !== 'approve'}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
              />
            </label>
            {action === 'complete' && (
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  disabled={busy}
                />{' '}
                I understand this records administrative completion only, not receipt, stock
                movement or payment.
              </label>
            )}
            {error && (
              <p role="alert" className="text-xs text-red-700">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => {
                  setAction(null);
                  setError('');
                  setNote('');
                  setConfirmed(false);
                }}
              >
                Back
              </button>
              <button type="submit" className={`${button} bg-teal-700 text-white`} disabled={busy}>
                {busy ? 'Saving…' : `Confirm ${labels[action].toLowerCase()}`}
              </button>
            </div>
          </form>
        )}
        <h4 className="mt-5 font-semibold">Order history</h4>
        {order.events.length ? (
          <ol className="mt-2 space-y-2 text-xs">
            {order.events.map((event) => (
              <li key={event.id} className="rounded bg-slate-50 p-2">
                <span className="font-semibold">{event.eventType}</span> ·{' '}
                {new Date(event.createdAt).toLocaleString()} · User #
                {event.actorUserId ?? 'unknown'}
                {event.note && <p className="mt-1 whitespace-pre-wrap">{event.note}</p>}
                {event.details?.before != null && (
                  <details className="mt-1">
                    <summary>Previous values</summary>
                    <pre className="overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(event.details.before, null, 2)}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-xs text-slate-500">
            No workflow history was recorded before this feature was installed.
          </p>
        )}
      </div>
    </div>
  );
}
