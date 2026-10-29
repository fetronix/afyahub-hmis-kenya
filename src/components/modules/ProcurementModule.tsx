import React, { useState, useEffect, useRef } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api, ApiError } from '../../api/client.ts';
import { Supplier, PurchaseOrder } from '../../types/index.ts';
import {
  ShoppingCart,
  CheckCircle2,
  Clock,
  Plus,
  Building2,
  FileCheck2,
  DollarSign,
} from 'lucide-react';

const NEW_SUPPLIER = 'new';
const newPoNumber = (previous?: string) => {
  const prefix = `PO-${new Date().getFullYear()}-`;
  let sequence = Math.floor(1000 + Math.random() * 9000);
  if (`${prefix}${sequence}` === previous) sequence = 1000 + ((sequence - 999) % 9000);
  return `${prefix}${sequence}`;
};

export const ProcurementModule: React.FC = () => {
  const { currentFacility, currentUser, showToast, refreshKey, triggerRefresh } = useHmis();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const scopeRef = useRef<string | null>(null);
  const openPoButtonRef = useRef<HTMLButtonElement>(null);

  // New PO Modal
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [poNumberConflict, setPoNumberConflict] = useState(false);
  const [poForm, setPoForm] = useState(() => ({
    supplierId: '',
    supplierName: '',
    poNumber: newPoNumber(),
    totalAmount: '',
    description: '',
  }));

  useEffect(() => {
    let cancelled = false;
    const facilityId = currentFacility?.id;
    const tenantId = currentFacility?.tenantId;
    const scope = `${tenantId ?? ''}:${facilityId ?? ''}`;

    if (scopeRef.current !== scope) {
      const hadPreviousScope = scopeRef.current !== null;
      scopeRef.current = scope;
      setSuppliers([]);
      setPurchaseOrders([]);
      setPoForm((prev) => ({
        ...prev,
        supplierId: '',
        supplierName: '',
        ...(hadPreviousScope
          ? { poNumber: newPoNumber(prev.poNumber), totalAmount: '', description: '' }
          : {}),
      }));
      setDuplicateWarning(false);
      setConfirmDuplicate(false);
      setPoNumberConflict(false);
    }

    async function loadProcurement() {
      if (!facilityId || !tenantId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(false);
      try {
        const [sup, po] = await Promise.all([
          api.getSuppliers(tenantId, facilityId),
          api.getPurchaseOrders(facilityId),
        ]);
        if (cancelled) return;
        setSuppliers(sup);
        setPurchaseOrders(po);
        setPoForm((prev) => {
          if (
            prev.supplierId === NEW_SUPPLIER ||
            sup.some((s) => String(s.id) === prev.supplierId)
          ) {
            return prev;
          }
          return { ...prev, supplierId: sup[0] ? String(sup[0].id) : NEW_SUPPLIER };
        });
      } catch (err) {
        if (cancelled) return;
        setLoadError(true);
        console.error('Failed to load procurement data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadProcurement();
    return () => {
      cancelled = true;
    };
  }, [currentFacility?.id, currentFacility?.tenantId, refreshKey]);

  const closePoModal = () => {
    if (savingRef.current) return;
    setIsPoModalOpen(false);
    openPoButtonRef.current?.focus();
  };

  const handlePoDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !savingRef.current) {
      event.preventDefault();
      closePoModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)',
      ),
    );
    if (controls.length === 0) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || !event.currentTarget.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current || loading || loadError || poNumberConflict) return;

    if (!currentFacility?.id) {
      showToast('Select a facility before saving this record.', { tone: 'warning' });
      return;
    }

    const supplierName = poForm.supplierName.trim();
    const isNewSupplier = poForm.supplierId === NEW_SUPPLIER;
    if (!poForm.supplierId || (isNewSupplier && !supplierName)) {
      showToast('Select a supplier or enter a new supplier name.', { tone: 'warning' });
      return;
    }
    if (
      isNewSupplier &&
      !confirmDuplicate &&
      suppliers.some(
        (supplier) => supplier.name.trim().toLowerCase() === supplierName.toLowerCase(),
      )
    ) {
      setDuplicateWarning(true);
      return;
    }

    const requestScope = `${currentFacility.tenantId}:${currentFacility.id}`;
    savingRef.current = true;
    setSaving(true);
    try {
      const created = await api.createPurchaseOrder({
        tenantId: currentFacility.tenantId,
        facilityId: currentFacility.id,
        ...(isNewSupplier
          ? { supplierName, confirmDuplicateSupplier: confirmDuplicate }
          : { supplierId: Number(poForm.supplierId) }),
        poNumber: poForm.poNumber,
        totalAmount: poForm.totalAmount,
        status: 'Pending Approval',
        orderedBy: currentUser.name,
      });

      if (scopeRef.current !== requestScope) {
        showToast('Purchase order submitted for the facility selected when you started.');
        triggerRefresh();
        return;
      }
      showToast('Purchase Order submitted for administrative approval.');
      setIsPoModalOpen(false);
      openPoButtonRef.current?.focus();
      setPoForm((prev) => ({
        ...prev,
        supplierId: String(created.supplierId),
        supplierName: '',
        poNumber: newPoNumber(prev.poNumber),
        totalAmount: '',
        description: '',
      }));
      setDuplicateWarning(false);
      setConfirmDuplicate(false);
      setPoNumberConflict(false);
      triggerRefresh();
    } catch (err: unknown) {
      if (scopeRef.current !== requestScope) {
        showToast('The purchase order for the previously selected facility could not be saved.', {
          tone: 'error',
        });
        return;
      }
      if (err instanceof ApiError && err.code === 'SUPPLIER_NAME_EXISTS') {
        setDuplicateWarning(true);
        // Another user may have added the name since this form was opened.
        try {
          const updated = await api.getSuppliers(currentFacility.tenantId, currentFacility.id);
          if (scopeRef.current === requestScope) setSuppliers(updated);
        } catch {
          // Keep the entered name and warning if refreshing the list fails.
        }
      } else if (err instanceof ApiError && err.code === 'PURCHASE_ORDER_NUMBER_IN_USE') {
        setPoNumberConflict(true);
        triggerRefresh();
      }
      if (scopeRef.current !== requestScope) {
        showToast('The purchase order for the previously selected facility could not be saved.', {
          tone: 'error',
        });
        return;
      }
      showToast(err instanceof Error ? err.message : 'Could not create the purchase order.', {
        tone: 'error',
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const supplierNameCounts = new Map<string, number>();
  for (const supplier of suppliers) {
    const key = supplier.name.trim().toLowerCase();
    supplierNameCounts.set(key, (supplierNameCounts.get(key) ?? 0) + 1);
  }
  const supplierLabel = (supplier: Supplier) =>
    (supplierNameCounts.get(supplier.name.trim().toLowerCase()) ?? 0) > 1
      ? `${supplier.name} (#${supplier.id})`
      : supplier.name;
  const getSupplierName = (id: number) => {
    const supplier = suppliers.find((item) => item.id === id);
    return supplier ? supplierLabel(supplier) : `Supplier #${id}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-card border border-hair bg-surface p-5 shadow-card">
        <div>
          <h1 className="font-display text-[1.35rem] leading-tight tracking-tight text-ink">
            Hospital Procurement & Purchase Orders
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Vendor management (KEMSA / MEDS), purchase requisitions, and multi-tier clinical
            approval workflows.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            ref={openPoButtonRef}
            onClick={() => setIsPoModalOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Generate Purchase Order</span>
          </button>
        </div>
      </div>

      {/* Suppliers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {suppliers.map((s) => (
          <div
            key={s.id}
            className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs space-y-1"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900">{supplierLabel(s)}</span>
              {s.kraPin && (
                <span className="font-mono text-3xs px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">
                  PIN: {s.kraPin}
                </span>
              )}
            </div>
            <div className="text-2xs text-slate-500">
              {s.contactPerson || s.phone
                ? `Contact: ${[s.contactPerson, s.phone].filter(Boolean).join(' · ')}`
                : 'Contact details not provided'}
            </div>
            {s.address && <div className="text-2xs text-slate-400 truncate">{s.address}</div>}
          </div>
        ))}
      </div>

      {/* Purchase Orders Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase flex items-center gap-1.5">
            <ShoppingCart className="w-4 h-4 text-teal-700" />
            <span>Purchase Orders & Requisitions ({purchaseOrders.length})</span>
          </h2>
          <span className="text-2xs text-slate-400 font-mono">ERP Integration Ready</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2.5 font-medium">PO Number</th>
                <th className="px-4 py-2.5 font-medium">Vendor / Supplier</th>
                <th className="px-4 py-2.5 font-medium text-right">PO Total Amount</th>
                <th className="px-4 py-2.5 font-medium">Ordered By</th>
                <th className="px-4 py-2.5 font-medium">Approved By</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {purchaseOrders.map((po) => (
                <tr key={po.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-bold text-teal-800">{po.poNumber}</td>
                  <td className="px-4 py-3 font-sans font-semibold text-slate-900">
                    {getSupplierName(po.supplierId)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">
                    KES {Number(po.totalAmount).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-sans text-slate-600">
                    {po.orderedBy || 'Storekeeper'}
                  </td>
                  <td className="px-4 py-3 font-sans text-slate-600">
                    {po.approvedBy || 'Pending'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(po.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right font-sans">
                    <span
                      className={`px-2 py-0.5 rounded text-2xs font-medium ${
                        po.status === 'Approved'
                          ? 'bg-emerald-50 text-emerald-800'
                          : 'bg-amber-50 text-amber-800'
                      }`}
                    >
                      {po.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE PO MODAL */}
      {isPoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-po-title"
            onKeyDown={handlePoDialogKeyDown}
            className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs"
          >
            <div className="border-b border-slate-200 pb-3">
              <h3 id="create-po-title" className="text-sm font-bold text-slate-900">
                Create Supplier Purchase Order
              </h3>
              <p className="text-2xs text-slate-500">
                Generate goods requisition order for pharmaceuticals and consumables.
              </p>
            </div>

            <form onSubmit={handleCreatePo} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="po-number" className="block font-medium text-slate-700 mb-1">
                    PO Tracking Number
                  </label>
                  <input
                    id="po-number"
                    type="text"
                    required
                    autoFocus
                    disabled={saving}
                    value={poForm.poNumber}
                    onChange={(e) => {
                      setPoForm({ ...poForm, poNumber: e.target.value });
                      setPoNumberConflict(false);
                    }}
                    aria-describedby={poNumberConflict ? 'po-number-conflict' : undefined}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                  {poNumberConflict && (
                    <p id="po-number-conflict" role="alert" className="mt-1 text-red-700">
                      This number is already in use. Check your orders before using a different
                      number.
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="po-supplier" className="block font-medium text-slate-700 mb-1">
                    Select Supplier *
                  </label>
                  <select
                    id="po-supplier"
                    required
                    disabled={saving || loading || loadError}
                    value={poForm.supplierId}
                    onChange={(e) => {
                      setPoForm({ ...poForm, supplierId: e.target.value });
                      setDuplicateWarning(false);
                      setConfirmDuplicate(false);
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  >
                    <option value="" disabled>
                      {loading ? 'Loading suppliers…' : 'Select a supplier'}
                    </option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {supplierLabel(s)}
                      </option>
                    ))}
                    <option value={NEW_SUPPLIER}>Add a new supplier</option>
                  </select>
                </div>
              </div>

              {loadError && (
                <p role="alert" className="text-red-700">
                  Could not load suppliers or purchase orders. Refresh the page and try again.
                </p>
              )}
              {poForm.supplierId === NEW_SUPPLIER && (
                <div>
                  <label
                    htmlFor="po-new-supplier"
                    className="block font-medium text-slate-700 mb-1"
                  >
                    New supplier name *
                  </label>
                  <input
                    id="po-new-supplier"
                    type="text"
                    required
                    maxLength={200}
                    disabled={saving}
                    value={poForm.supplierName}
                    onChange={(e) => {
                      setPoForm({ ...poForm, supplierName: e.target.value });
                      setDuplicateWarning(false);
                      setConfirmDuplicate(false);
                    }}
                    aria-describedby="po-new-supplier-help"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                    placeholder="Enter the supplier name"
                  />
                  <p id="po-new-supplier-help" className="mt-1 text-2xs text-slate-500">
                    The supplier will be saved for reuse in this organisation when the order is
                    submitted. Adding a name does not verify or approve the supplier.
                  </p>
                  {duplicateWarning && (
                    <div role="alert" className="mt-2 rounded-md bg-amber-50 p-2 text-amber-900">
                      <p>
                        A supplier with this name already exists. Select it if it is the same
                        supplier, or confirm below if this is a different supplier with the same
                        name.
                      </p>
                      <label className="mt-2 flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={confirmDuplicate}
                          disabled={saving}
                          onChange={(e) => setConfirmDuplicate(e.target.checked)}
                        />
                        Create a separate supplier with this name
                      </label>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="po-description" className="block font-medium text-slate-700 mb-1">
                  Requisition Items Description
                </label>
                <textarea
                  id="po-description"
                  rows={2}
                  disabled={saving}
                  value={poForm.description}
                  onChange={(e) => setPoForm({ ...poForm, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  aria-describedby="po-description-note"
                />
                <p id="po-description-note" className="mt-1 text-2xs text-slate-500">
                  Item descriptions are not currently saved with purchase orders.
                </p>
              </div>

              <div>
                <label htmlFor="po-amount" className="block font-medium text-slate-700 mb-1">
                  Estimated Total Order Amount (KES) *
                </label>
                <input
                  id="po-amount"
                  type="text"
                  required
                  disabled={saving}
                  value={poForm.totalAmount}
                  onChange={(e) => setPoForm({ ...poForm, totalAmount: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-bold"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={saving}
                  onClick={closePoModal}
                  className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || loading || loadError || poNumberConflict}
                  className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800 disabled:opacity-50"
                >
                  {saving ? 'Submitting…' : 'Submit for Approval'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
