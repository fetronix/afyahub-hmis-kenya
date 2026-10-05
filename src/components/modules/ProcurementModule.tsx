import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { Supplier, PurchaseOrder } from '../../types/index.ts';
import {
  ShoppingCart,
  CheckCircle2,
  Clock,
  Plus,
  Building2,
  FileCheck2,
  DollarSign
} from 'lucide-react';

export const ProcurementModule: React.FC = () => {
  const { currentFacility, currentTenant, currentUser, showToast, refreshKey, triggerRefresh } = useHmis();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  // New PO Modal
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
  const [poForm, setPoForm] = useState({
    supplierId: '',
    poNumber: `PO-2026-${Math.floor(1000 + Math.random() * 9000)}`,
    totalAmount: '85000.00',
    description: 'Quarterly supply of essential IV fluids and antibiotics',
  });

  useEffect(() => {
    async function loadProcurement() {
      setLoading(true);
      try {
        const [sup, po] = await Promise.all([
          api.getSuppliers(currentTenant?.id),
          api.getPurchaseOrders(currentFacility?.id),
        ]);
        setSuppliers(sup);
        setPurchaseOrders(po);
        if (sup.length > 0 && !poForm.supplierId) {
          setPoForm(prev => ({ ...prev, supplierId: sup[0].id.toString() }));
        }
      } catch (err) {
        console.error('Failed to load procurement data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadProcurement();
  }, [currentFacility, currentTenant, refreshKey]);

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poForm.supplierId) return;

    try {
      await api.createPurchaseOrder({
        tenantId: currentTenant?.id || 1,
        facilityId: currentFacility?.id || 1,
        supplierId: Number(poForm.supplierId),
        poNumber: poForm.poNumber,
        totalAmount: poForm.totalAmount,
        status: 'Pending Approval',
        orderedBy: currentUser.name,
      });

      showToast('Purchase Order submitted for administrative approval.');
      setIsPoModalOpen(false);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const getSupplierName = (id: number) => {
    const s = suppliers.find(x => x.id === id);
    return s ? s.name : `Supplier #${id}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Hospital Procurement & Purchase Orders</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Vendor management (KEMSA / MEDS), purchase requisitions, and multi-tier clinical approval workflows.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPoModalOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Generate Purchase Order</span>
          </button>
        </div>
      </div>

      {/* Approved Suppliers Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {suppliers.map((s) => (
          <div key={s.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900">{s.name}</span>
              <span className="font-mono text-3xs px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">
                PIN: {s.kraPin || 'KRA'}
              </span>
            </div>
            <div className="text-2xs text-slate-500">Contact: {s.contactPerson} · {s.phone}</div>
            <div className="text-2xs text-slate-400 truncate">{s.address}</div>
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
                  <td className="px-4 py-3 font-sans text-slate-600">{po.orderedBy || 'Storekeeper'}</td>
                  <td className="px-4 py-3 font-sans text-slate-600">{po.approvedBy || 'Pending'}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(po.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right font-sans">
                    <span className={`px-2 py-0.5 rounded text-2xs font-medium ${
                      po.status === 'Approved'
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-amber-50 text-amber-800'
                    }`}>
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
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Create Supplier Purchase Order</h3>
              <p className="text-2xs text-slate-500">Generate goods requisition order for pharmaceuticals and consumables.</p>
            </div>

            <form onSubmit={handleCreatePo} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">PO Tracking Number</label>
                  <input
                    type="text"
                    required
                    value={poForm.poNumber}
                    onChange={(e) => setPoForm({ ...poForm, poNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Select Supplier *</label>
                  <select
                    value={poForm.supplierId}
                    onChange={(e) => setPoForm({ ...poForm, supplierId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  >
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Requisition Items Description</label>
                <textarea
                  rows={2}
                  value={poForm.description}
                  onChange={(e) => setPoForm({ ...poForm, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Estimated Total Order Amount (KES) *</label>
                <input
                  type="text"
                  required
                  value={poForm.totalAmount}
                  onChange={(e) => setPoForm({ ...poForm, totalAmount: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-bold"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsPoModalOpen(false)}
                  className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800"
                >
                  Submit for Approval
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
