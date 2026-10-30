import React, { useState, useEffect, useRef } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api, ApiError } from '../../api/client.ts';
import type {
  Supplier,
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchaseOrderItem,
} from '../../types/index.ts';
import { calculateOrder } from '../../procurement/order-items.ts';
import { OrderDetails } from '../procurement/OrderDetails.tsx';
import { SupplierEditor } from '../procurement/SupplierEditor.tsx';
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
  const { currentFacility, currentUser, authenticatedUser, showToast, refreshKey, triggerRefresh } =
    useHmis();
  const can = (permission: string) =>
    Boolean(
      authenticatedUser &&
      !(authenticatedUser.isSuperAdmin && authenticatedUser.tenantId === null) &&
      authenticatedUser.permissions?.includes('procurement.read') &&
      authenticatedUser.permissions?.includes(permission),
    );
  const canRead = can('procurement.read');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const scopeRef = useRef<string | null>(null);
  const openPoButtonRef = useRef<HTMLButtonElement>(null);
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [editing, setEditing] = useState<PurchaseOrderDetail | null>(null);
  const editingRef = useRef(false);
  const [supplierEditor, setSupplierEditor] = useState<{ supplier: Supplier | null } | null>(null);
  const detailRequest = useRef(0);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const supplierTrigger = useRef<HTMLButtonElement | null>(null);
  const renderedScope = `${currentFacility?.tenantId ?? ''}:${currentFacility?.id ?? ''}`;

  // New PO Modal
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [poNumberConflict, setPoNumberConflict] = useState(false);
  const [poForm, setPoForm] = useState(() => ({
    supplierId: '',
    supplierName: '',
    poNumber: newPoNumber(),
    description: '',
    expectedDeliveryDate: '',
    deliveryAddress: '',
    paymentTerms: '',
    notes: '',
    taxAmount: '0.00',
    shippingAmount: '0.00',
    discountAmount: '0.00',
    items: [{ description: '', quantity: '1', unit: '', unitPrice: '' }] as PurchaseOrderItem[],
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
          ? {
              poNumber: newPoNumber(prev.poNumber),
              description: '',
              expectedDeliveryDate: '',
              deliveryAddress: '',
              paymentTerms: '',
              notes: '',
              taxAmount: '0.00',
              shippingAmount: '0.00',
              discountAmount: '0.00',
              items: [{ description: '', quantity: '1', unit: '', unitPrice: '' }],
            }
          : {}),
      }));
      setDuplicateWarning(false);
      setConfirmDuplicate(false);
      setPoNumberConflict(false);
      setDetail(null);
      if (hadPreviousScope && editingRef.current) setIsPoModalOpen(false);
      editingRef.current = false;
      setEditing(null);
      setSupplierEditor(null);
      detailRequest.current += 1;
    }

    async function loadProcurement() {
      if (!canRead) {
        setSuppliers([]);
        setPurchaseOrders([]);
        setDetail(null);
        detailRequest.current += 1;
        setSupplierEditor(null);
        setEditing(null);
        editingRef.current = false;
        setIsPoModalOpen(false);
        setPoForm((previous) => ({
          ...previous,
          supplierId: '',
          supplierName: '',
          poNumber: newPoNumber(previous.poNumber),
          description: '',
          expectedDeliveryDate: '',
          deliveryAddress: '',
          paymentTerms: '',
          notes: '',
          taxAmount: '0.00',
          shippingAmount: '0.00',
          discountAmount: '0.00',
          items: [{ description: '', quantity: '1', unit: '', unitPrice: '' }],
        }));
        setLoading(false);
        return;
      }
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
          // Do not silently substitute a different supplier in an existing draft
          // when a refresh finds that the selected supplier is now inactive.
          if (prev.supplierId) return prev;
          const firstActive = sup.find((s) => s.isActive);
          return { ...prev, supplierId: firstActive ? String(firstActive.id) : NEW_SUPPLIER };
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
  }, [currentFacility?.id, currentFacility?.tenantId, refreshKey, canRead]);

  const closePoModal = () => {
    if (savingRef.current) return;
    setIsPoModalOpen(false);
    if (editing) {
      setPoForm((previous) => ({
        ...previous,
        supplierId: suppliers.find((item) => item.isActive)?.id.toString() ?? NEW_SUPPLIER,
        supplierName: '',
        poNumber: newPoNumber(previous.poNumber),
        description: '',
        expectedDeliveryDate: '',
        deliveryAddress: '',
        paymentTerms: '',
        notes: '',
        taxAmount: '0.00',
        shippingAmount: '0.00',
        discountAmount: '0.00',
        items: [{ description: '', quantity: '1', unit: '', unitPrice: '' }],
      }));
      setDuplicateWarning(false);
      setConfirmDuplicate(false);
      setPoNumberConflict(false);
      detailTrigger.current?.focus();
    } else openPoButtonRef.current?.focus();
    setEditing(null);
    editingRef.current = false;
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

    let calculated: ReturnType<typeof calculateOrder>;
    try {
      calculated = calculateOrder(poForm.items, poForm);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Check the order lines.', { tone: 'warning' });
      return;
    }
    if (
      !isNewSupplier &&
      !suppliers.some((supplier) => supplier.isActive && String(supplier.id) === poForm.supplierId)
    ) {
      showToast('Select an active supplier before saving this order.', { tone: 'warning' });
      return;
    }
    const requestScope = `${currentFacility.tenantId}:${currentFacility.id}`;
    savingRef.current = true;
    setSaving(true);
    try {
      const orderFields = {
        facilityId: currentFacility.id,
        poNumber: poForm.poNumber,
        description: poForm.description,
        expectedDeliveryDate: poForm.expectedDeliveryDate,
        deliveryAddress: poForm.deliveryAddress,
        paymentTerms: poForm.paymentTerms,
        notes: poForm.notes,
        taxAmount: poForm.taxAmount,
        shippingAmount: poForm.shippingAmount,
        discountAmount: poForm.discountAmount,
        items: poForm.items,
      };
      const created = editing
        ? await api.updatePurchaseOrder(editing.id, {
            ...orderFields,
            supplierId: Number(poForm.supplierId),
            expectedRevision: editing.revision ?? 1,
          })
        : await api.createPurchaseOrder({
            ...orderFields,
            tenantId: currentFacility.tenantId,
            ...(isNewSupplier
              ? { supplierName, confirmDuplicateSupplier: confirmDuplicate }
              : { supplierId: Number(poForm.supplierId) }),
            totalAmount: calculated.total,
            status: 'Pending Approval',
            orderedBy: currentUser.name,
          });

      if (scopeRef.current !== requestScope) {
        showToast('Purchase order submitted for the facility selected when you started.');
        triggerRefresh();
        return;
      }
      showToast(
        editing
          ? 'Pending purchase order updated.'
          : 'Purchase Order submitted for administrative approval.',
      );
      setIsPoModalOpen(false);
      if (editing) detailTrigger.current?.focus();
      else openPoButtonRef.current?.focus();
      setEditing(null);
      editingRef.current = false;
      setPoForm((prev) => ({
        ...prev,
        supplierId: String(created.supplierId),
        supplierName: '',
        poNumber: newPoNumber(prev.poNumber),
        description: '',
        expectedDeliveryDate: '',
        deliveryAddress: '',
        paymentTerms: '',
        notes: '',
        taxAmount: '0.00',
        shippingAmount: '0.00',
        discountAmount: '0.00',
        items: [{ description: '', quantity: '1', unit: '', unitPrice: '' }],
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

  const supplierUnavailable =
    Boolean(poForm.supplierId) &&
    poForm.supplierId !== NEW_SUPPLIER &&
    !suppliers.some((supplier) => supplier.isActive && String(supplier.id) === poForm.supplierId);

  const showDetails = async (po: PurchaseOrder) => {
    if (!currentFacility) return;
    const requestScope = `${currentFacility.tenantId}:${currentFacility.id}`;
    const request = ++detailRequest.current;
    try {
      const result = await api.getPurchaseOrder(po.id, currentFacility.id);
      if (scopeRef.current === requestScope && detailRequest.current === request) setDetail(result);
    } catch (err) {
      if (scopeRef.current === requestScope && detailRequest.current === request)
        showToast(err instanceof Error ? err.message : 'Could not load order.', { tone: 'error' });
    }
  };
  const editDetails = (order: PurchaseOrderDetail) => {
    setDuplicateWarning(false);
    setConfirmDuplicate(false);
    setPoNumberConflict(false);
    setPoForm({
      supplierId: String(order.supplierId),
      supplierName: '',
      poNumber: order.poNumber,
      description: order.description ?? '',
      expectedDeliveryDate: order.expectedDeliveryDate ?? '',
      deliveryAddress: order.deliveryAddress ?? '',
      paymentTerms: order.paymentTerms ?? '',
      notes: order.notes ?? '',
      taxAmount: order.taxAmount ?? '0.00',
      shippingAmount: order.shippingAmount ?? '0.00',
      discountAmount: order.discountAmount ?? '0.00',
      items: order.items.length
        ? order.items.map(({ description, quantity, unit, unitPrice }) => ({
            description,
            quantity,
            unit,
            unitPrice,
          }))
        : [{ description: '', quantity: '1', unit: '', unitPrice: '' }],
    });
    setEditing(order);
    editingRef.current = true;
    setDetail(null);
    setIsPoModalOpen(true);
  };
  let totals: ReturnType<typeof calculateOrder> | null = null;
  try {
    totals = calculateOrder(poForm.items, poForm);
  } catch {
    /* Incomplete forms show no calculated total. */
  }
  const setLine = (index: number, field: keyof PurchaseOrderItem, value: string) =>
    setPoForm((previous) => ({
      ...previous,
      items: previous.items.map((line, i) => (i === index ? { ...line, [field]: value } : line)),
    }));

  if (!currentFacility) return <p>Select a facility to view procurement.</p>;
  if (!canRead)
    return <p>An authorized facility account with procurement read permission is required.</p>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-card border border-hair bg-surface p-5 shadow-card">
        <div>
          <h1 className="font-display text-[1.35rem] leading-tight tracking-tight text-ink">
            Hospital Procurement & Purchase Orders
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Supplier records and purchase orders with permission-controlled administrative review.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {can('procurement.create') && (
            <button
              type="button"
              onClick={(e) => {
                supplierTrigger.current = e.currentTarget;
                setSupplierEditor({ supplier: null });
              }}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300"
            >
              Add supplier
            </button>
          )}
          {can('procurement.create') && (
            <button
              ref={openPoButtonRef}
              onClick={() => setIsPoModalOpen(true)}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Generate Purchase Order</span>
            </button>
          )}
        </div>
      </div>

      {loading && (
        <p className="text-xs text-slate-500" role="status">
          Loading procurement records…
        </p>
      )}
      {loadError && (
        <p className="text-xs text-red-700">
          Could not load suppliers or purchase orders. Refresh the page and try again.
        </p>
      )}
      {!loading && !loadError && !suppliers.length && (
        <p className="text-xs text-slate-500">No supplier records yet.</p>
      )}
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
            {s.email && <div className="text-2xs text-slate-500">Email: {s.email}</div>}
            {s.address && <div className="text-2xs text-slate-400 truncate">{s.address}</div>}
            {!s.isActive && <p className="font-semibold text-amber-700">Inactive</p>}
            {(can('procurement.update') || can('procurement.delete')) && (
              <button
                type="button"
                className="mt-2 rounded border border-slate-300 px-2 py-1"
                onClick={(e) => {
                  supplierTrigger.current = e.currentTarget;
                  setSupplierEditor({ supplier: s });
                }}
              >
                Manage {supplierLabel(s)}
              </button>
            )}
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
          <span className="text-2xs text-slate-400">Administrative workflow</span>
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
                <th className="px-4 py-2.5 font-medium">Details</th>
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
                    {po.orderedBy || 'Not recorded'}
                  </td>
                  <td className="px-4 py-3 font-sans text-slate-600">
                    {po.approvedBy || 'Not recorded'}
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
                  <td className="px-4 py-3 font-sans">
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1"
                      onClick={(e) => {
                        detailTrigger.current = e.currentTarget;
                        void showDetails(po);
                      }}
                    >
                      View {po.poNumber}
                    </button>
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
                {editing ? 'Edit Pending Purchase Order' : 'Create Supplier Purchase Order'}
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
                    maxLength={100}
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
                    {supplierUnavailable && (
                      <option value={poForm.supplierId} disabled>
                        {getSupplierName(Number(poForm.supplierId))} (inactive or unavailable)
                      </option>
                    )}
                    {suppliers
                      .filter((s) => s.isActive)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {supplierLabel(s)}
                        </option>
                      ))}
                    {!editing && <option value={NEW_SUPPLIER}>Add a new supplier</option>}
                  </select>
                </div>
              </div>

              {supplierUnavailable && !loading && !loadError && (
                <p role="alert" className="text-amber-800">
                  The selected supplier is inactive or unavailable. Select an active supplier before
                  saving; the selection will not be changed automatically.
                </p>
              )}
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
                  maxLength={2000}
                  rows={2}
                  disabled={saving}
                  value={poForm.description}
                  onChange={(e) => setPoForm({ ...poForm, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
                <p className="mt-1 text-2xs text-slate-500">
                  The purpose, lines, quantities and quoted amounts are saved with this order.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block font-medium">
                  Expected delivery date
                  <input
                    type="date"
                    className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                    disabled={saving}
                    value={poForm.expectedDeliveryDate}
                    onChange={(e) => setPoForm({ ...poForm, expectedDeliveryDate: e.target.value })}
                  />
                </label>
                <label className="block font-medium">
                  Payment terms
                  <input
                    maxLength={500}
                    className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                    disabled={saving}
                    value={poForm.paymentTerms}
                    onChange={(e) => setPoForm({ ...poForm, paymentTerms: e.target.value })}
                  />
                </label>
                <label className="block font-medium sm:col-span-2">
                  Delivery address
                  <textarea
                    maxLength={1000}
                    className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                    disabled={saving}
                    value={poForm.deliveryAddress}
                    onChange={(e) => setPoForm({ ...poForm, deliveryAddress: e.target.value })}
                  />
                </label>
              </div>
              <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
                <legend className="font-semibold">Order lines *</legend>
                {poForm.items.map((line, index) => (
                  <div key={index} className="grid gap-2 rounded bg-slate-50 p-2 sm:grid-cols-2">
                    <label className="block">
                      Line {index + 1} description *
                      <input
                        required
                        maxLength={500}
                        className="mt-1 w-full rounded border border-slate-200 px-2 py-2"
                        disabled={saving}
                        value={line.description}
                        onChange={(e) => setLine(index, 'description', e.target.value)}
                      />
                    </label>
                    <label className="block">
                      Line {index + 1} quantity *
                      <input
                        required
                        inputMode="decimal"
                        className="mt-1 w-full rounded border border-slate-200 px-2 py-2"
                        disabled={saving}
                        value={line.quantity}
                        onChange={(e) => setLine(index, 'quantity', e.target.value)}
                      />
                    </label>
                    <label className="block">
                      Line {index + 1} unit *
                      <input
                        required
                        maxLength={50}
                        className="mt-1 w-full rounded border border-slate-200 px-2 py-2"
                        disabled={saving}
                        value={line.unit}
                        onChange={(e) => setLine(index, 'unit', e.target.value)}
                      />
                    </label>
                    <label className="block">
                      Line {index + 1} unit price (KES) *
                      <input
                        required
                        inputMode="decimal"
                        className="mt-1 w-full rounded border border-slate-200 px-2 py-2"
                        disabled={saving}
                        value={line.unitPrice}
                        onChange={(e) => setLine(index, 'unitPrice', e.target.value)}
                      />
                    </label>
                    <p className="text-slate-600">
                      Line total: {totals ? `KES ${totals.items[index].lineTotal}` : '—'}
                    </p>
                    {poForm.items.length > 1 && (
                      <button
                        type="button"
                        className="text-left text-red-700"
                        disabled={saving}
                        onClick={() =>
                          setPoForm({
                            ...poForm,
                            items: poForm.items.filter((_, i) => i !== index),
                          })
                        }
                      >
                        Remove line {index + 1}
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="rounded border border-slate-300 px-2 py-1"
                  disabled={saving || poForm.items.length >= 100}
                  onClick={() =>
                    setPoForm({
                      ...poForm,
                      items: [
                        ...poForm.items,
                        { description: '', quantity: '1', unit: '', unitPrice: '' },
                      ],
                    })
                  }
                >
                  Add line
                </button>
              </fieldset>
              <p className="text-2xs text-slate-500">
                Enter quoted unit prices and actual quoted adjustments; no tax rate, delivery fee or
                discount is calculated automatically. Quantities allow up to 3 decimal places and
                amounts up to 2.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(['taxAmount', 'shippingAmount', 'discountAmount'] as const).map((field) => (
                  <label key={field}>
                    {field === 'taxAmount'
                      ? 'Tax (KES)'
                      : field === 'shippingAmount'
                        ? 'Shipping (KES)'
                        : 'Discount (KES)'}
                    <input
                      required
                      inputMode="decimal"
                      className="mt-1 w-full rounded border border-slate-200 px-2 py-2"
                      disabled={saving}
                      value={poForm[field]}
                      onChange={(e) => setPoForm({ ...poForm, [field]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              <div className="rounded bg-slate-50 p-3 font-semibold">
                <p>Subtotal: {totals ? `KES ${totals.subtotal}` : '—'}</p>
                <p>Order total: {totals ? `KES ${totals.total}` : '—'}</p>
              </div>
              <label className="block font-medium">
                Additional notes
                <textarea
                  maxLength={2000}
                  className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                  disabled={saving}
                  value={poForm.notes}
                  onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })}
                />
              </label>

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
                  disabled={
                    saving || loading || loadError || poNumberConflict || supplierUnavailable
                  }
                  className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800 disabled:opacity-50"
                >
                  {saving ? 'Submitting…' : editing ? 'Save pending order' : 'Submit for Approval'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {detail && currentFacility && authenticatedUser && (
        <OrderDetails
          order={detail}
          supplierName={getSupplierName(detail.supplierId)}
          supplierActive={
            suppliers.find((supplier) => supplier.id === detail.supplierId)?.isActive === true
          }
          facilityId={currentFacility.id}
          userId={authenticatedUser.id}
          can={can}
          onClose={() => {
            setDetail(null);
            detailTrigger.current?.focus();
          }}
          onEdit={() => editDetails(detail)}
          onChanged={(message) => {
            if (scopeRef.current === renderedScope) {
              setDetail(null);
              detailTrigger.current?.focus();
              showToast(message);
            } else showToast(`Action completed for the previously selected facility. ${message}`);
            triggerRefresh();
          }}
        />
      )}
      {supplierEditor && currentFacility && (
        <SupplierEditor
          supplier={supplierEditor.supplier}
          suppliers={suppliers}
          facilityId={currentFacility.id}
          canUpdate={can('procurement.update')}
          canDelete={can('procurement.delete')}
          onClose={() => {
            setSupplierEditor(null);
            supplierTrigger.current?.focus();
          }}
          onChanged={(message) => {
            if (scopeRef.current === renderedScope) {
              setSupplierEditor(null);
              supplierTrigger.current?.focus();
              showToast(message);
            } else showToast(`Action completed for the previously selected facility. ${message}`);
            triggerRefresh();
          }}
        />
      )}
    </div>
  );
};
