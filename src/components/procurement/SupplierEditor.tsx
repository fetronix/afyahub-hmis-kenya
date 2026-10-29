import React, { useState, useRef } from 'react';
import { dialogKeyDown } from './dialog.ts';
import { api, ApiError } from '../../api/client.ts';
import type { Supplier } from '../../types/index.ts';

const field = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2';
const button = 'rounded-md border border-slate-300 px-3 py-2 font-semibold disabled:opacity-50';
export function SupplierEditor(props: {
  supplier: Supplier | null;
  suppliers: Supplier[];
  facilityId: number;
  canUpdate: boolean;
  canDelete: boolean;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { supplier } = props;
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    contactPerson: supplier?.contactPerson ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    kraPin: supplier?.kraPin ?? '',
    address: supplier?.address ?? '',
  });
  const [duplicate, setDuplicate] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reactivate, setReactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    const name = form.name.trim();
    if (!name) {
      setError('Enter a supplier name.');
      return;
    }
    const nameChanged = !supplier || supplier.name.trim().toLowerCase() !== name.toLowerCase();
    if (
      nameChanged &&
      !confirmed &&
      props.suppliers.some(
        (item) => item.id !== supplier?.id && item.name.trim().toLowerCase() === name.toLowerCase(),
      )
    ) {
      setDuplicate(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const data = {
        ...form,
        name,
        facilityId: props.facilityId,
        confirmDuplicateSupplier: confirmed,
      };
      if (supplier)
        await api.updateSupplier(supplier.id, {
          ...data,
          expectedRevision: supplier.revision ?? 1,
          ...(reactivate ? { isActive: true } : {}),
        });
      else await api.createSupplier(data);
      props.onChanged(
        supplier
          ? 'Supplier details saved for this organisation.'
          : 'Supplier saved. This does not verify or approve the supplier.',
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SUPPLIER_NAME_EXISTS') setDuplicate(true);
      const message = err instanceof Error ? err.message : 'Could not save supplier.';
      setError(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const deactivate = async () => {
    if (!supplier || busyRef.current) return;
    if (!reason.trim()) {
      setError('Enter a reason for deactivation.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await api.deactivateSupplier(supplier.id, {
        facilityId: props.facilityId,
        expectedRevision: supplier.revision ?? 1,
        note: reason.trim(),
      });
      props.onChanged('Supplier deactivated. Existing orders and references were retained.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not deactivate supplier.';
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
        aria-labelledby="supplier-editor-title"
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5 text-xs shadow-xl"
        onKeyDown={(e) =>
          dialogKeyDown(e, () => {
            if (!busyRef.current) props.onClose();
          })
        }
      >
        <h3 id="supplier-editor-title" className="text-base font-bold">
          {supplier ? 'Edit supplier' : 'Add supplier'}
        </h3>
        <p className="mt-2 text-slate-600">
          Suppliers are shared across this organisation. Changes affect all its facilities; creating
          a record does not verify or approve a supplier.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block font-semibold">
            Supplier name *
            <input
              autoFocus
              required
              maxLength={200}
              className={field}
              value={form.name}
              disabled={busy}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
                setDuplicate(false);
                setConfirmed(false);
              }}
            />
          </label>
          {duplicate && (
            <div role="alert" className="rounded bg-amber-50 p-2">
              <p>
                A supplier with this name already exists. Select it or confirm it is a separate
                supplier.
              </p>
              <label className="mt-2 flex gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Create or retain a separate supplier with this name
              </label>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              Contact person
              <input
                maxLength={200}
                className={field}
                value={form.contactPerson}
                disabled={busy}
                onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
              />
            </label>
            <label>
              Phone
              <input
                maxLength={60}
                className={field}
                value={form.phone}
                disabled={busy}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                maxLength={254}
                className={field}
                value={form.email}
                disabled={busy}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label>
              KRA PIN
              <input
                maxLength={60}
                className={field}
                value={form.kraPin}
                disabled={busy}
                onChange={(e) => setForm({ ...form, kraPin: e.target.value })}
              />
            </label>
          </div>
          <label className="block">
            Address
            <textarea
              maxLength={1000}
              className={field}
              value={form.address}
              disabled={busy}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </label>
          {supplier && !supplier.isActive && props.canUpdate && (
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={reactivate}
                onChange={(e) => setReactivate(e.target.checked)}
              />{' '}
              Reactivate this supplier for new orders
            </label>
          )}
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <button type="button" className={button} disabled={busy} onClick={props.onClose}>
              Close
            </button>
            {(!supplier || props.canUpdate) && (
              <button type="submit" className={`${button} bg-teal-700 text-white`} disabled={busy}>
                {busy ? 'Saving…' : 'Save supplier'}
              </button>
            )}
            {supplier?.isActive && props.canDelete && (
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => setDeactivating(true)}
              >
                Deactivate supplier
              </button>
            )}
          </div>
        </form>
        {deactivating && (
          <div className="mt-3 rounded bg-amber-50 p-3">
            <p>
              Deactivation affects all facilities in the organisation. Existing orders and invoices
              remain unchanged.
            </p>
            <label className="mt-2 block">
              Reason *
              <textarea
                required
                className={field}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
              />
            </label>
            <button
              type="button"
              className={`${button} mt-2`}
              disabled={busy}
              onClick={() => void deactivate()}
            >
              Confirm deactivation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
