import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { Medication, InventoryItem, Patient, InventoryBatchRow } from '../../types/index.ts';
import {
  Pill,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Package,
  Layers,
  Search,
  ShoppingCart
} from 'lucide-react';

export const PharmacyModule: React.FC = () => {
  const { currentTenant, currentFacility, currentUser, setSelectedPatient, setIsJourneyModalOpen, showToast, refreshKey, triggerRefresh } = useHmis();
  const [prescriptions, setPrescriptions] = useState<Medication[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'Pending' | 'Dispensed' | 'All'>('Pending');

  // Dispensing Target Modal
  const [dispenseTarget, setDispenseTarget] = useState<Medication | null>(null);
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<InventoryItem | null>(null);
  const [batches, setBatches] = useState<InventoryBatchRow[]>([]);
  const [dispenseQty, setDispenseQty] = useState(1);
  const [dispenseNotes, setDispenseNotes] = useState('Labelled: Take with plenty of water after food.');

  useEffect(() => {
    async function loadPharmacy() {
      setLoading(true);
      try {
        const [meds, inv, pList, batchList] = await Promise.all([
          api.getMedications(),
          api.getInventory(currentFacility?.id),
          api.getPatients(currentTenant?.id, currentFacility?.id),
          api.getInventoryBatches(currentFacility?.id).catch((err) => {
            console.error('Failed to load stock batches:', err);
            return [] as InventoryBatchRow[];
          }),
        ]);
        setPrescriptions(meds);
        setInventory(inv);
        setPatients(pList);
        setBatches(batchList);
      } catch (err) {
        console.error('Failed to load pharmacy data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadPharmacy();
  }, [currentTenant, currentFacility, refreshKey]);

  const openDispenseModal = (med: Medication) => {
    setDispenseTarget(med);
    setDispenseQty(med.quantity || 1);

    // Try to match inventory item by drug name
    const match = inventory.find(i =>
      i.name.toLowerCase().includes(med.drugName.toLowerCase()) ||
      (i.genericName && i.genericName.toLowerCase().includes(med.drugName.toLowerCase()))
    );

    if (match) {
      setSelectedInventoryItem(match);
    } else if (inventory.length > 0) {
      setSelectedInventoryItem(inventory[0]);
    }
  };

  const handleConfirmDispense = async () => {
    if (!dispenseTarget) return;

    try {
      /*
       * Billing is now raised server-side from the facility's service
       * tariffs. Creating the invoice here (with a hardcoded unit price)
       * would double-charge the patient alongside the server charge.
       */
      const result = await api.dispenseMedication({
        facilityId: currentFacility?.id,
        prescriptionId: dispenseTarget.id,
        patientId: dispenseTarget.patientId,
        itemId: selectedInventoryItem ? selectedInventoryItem.id : undefined,
        quantityDispensed: Number(dispenseQty),
        dispensedBy: currentUser.name,
        notes: dispenseNotes,
        drugName: dispenseTarget.drugName,
        encounterId: dispenseTarget.encounterId,
        unitPrice: dispenseTarget.unitPrice,
      });

      const billingNote =
        result?.billing?.charged
          ? `Billed KES ${result.billing.totalAmount} on ${result.billing.invoiceNumber}.`
          : result?.billing?.message
            ? `Not billed: ${result.billing.message}`
            : 'Not billed.';

      const allocationNote =
        result?.allocations && result.allocations.length > 0
          ? `Drawn FEFO from ${result.allocations
              .map((a) => `${a.batchNumber} (exp ${a.expiryDate}) x${a.quantity}`)
              .join(', ')}.`
          : result?.stockTracking === 'untracked'
            ? 'Item has no tracked batches; stock deducted from the plain count.'
            : 'Stock deducted.';

      showToast(`Medication dispensed. ${allocationNote} ${billingNote}`);
      setDispenseTarget(null);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Dispensing failed: ${err.message}`);
    }
  };

  const filteredMeds = prescriptions.filter(m => {
    if (filter === 'All') return true;
    return filter === 'Pending' ? m.status === 'Prescribed' : m.status === 'Dispensed';
  });

  const getPatient = (patientId: number) => {
    return patients.find(p => p.id === patientId);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-card border border-hair bg-surface p-5 shadow-card">
        <div>
          <h1 className="font-display text-[1.35rem] leading-tight tracking-tight text-ink">Outpatient Pharmacy & Drug Dispensing POS</h1>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Prescription verification, batch & expiry control, real-time stock deduction, and patient dosage instructions.
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-lg text-xs font-medium">
          {(['Pending', 'Dispensed', 'All'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                filter === f
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {f} Prescriptions
            </button>
          ))}
        </div>
      </div>

      {/* Main Prescriptions Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase flex items-center gap-1.5">
            <Pill className="w-4 h-4 text-teal-700" />
            <span>Dispensing Worklist ({filteredMeds.length})</span>
          </h2>
          <span className="text-2xs text-slate-400 font-mono">Kenya Pharmacy & Poisons Board Rules</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2.5 font-medium">Patient Full Name</th>
                <th className="px-4 py-2.5 font-medium">Drug Name & Strength</th>
                <th className="px-4 py-2.5 font-medium">Dosage & Frequency</th>
                <th className="px-4 py-2.5 font-medium">Duration & Route</th>
                <th className="px-4 py-2.5 font-medium">Prescriber</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {filteredMeds.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-400 font-sans">
                    No prescriptions in "{filter}" state.
                  </td>
                </tr>
              ) : (
                filteredMeds.map((m) => {
                  const patient = getPatient(m.patientId);
                  const isDispensed = m.status === 'Dispensed';

                  return (
                    <tr key={m.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-sans">
                        {patient ? (
                          <button
                            onClick={() => {
                              setSelectedPatient(patient);
                              setIsJourneyModalOpen(true);
                            }}
                            className="font-semibold text-slate-900 hover:text-teal-700 text-left block"
                          >
                            {patient.firstName} {patient.lastName}
                          </button>
                        ) : (
                          <span>Patient #{m.patientId}</span>
                        )}
                        <span className="text-2xs text-slate-400 font-mono">{patient?.mrn} · {patient?.payerType}</span>
                      </td>
                      <td className="px-4 py-3 font-sans font-semibold text-slate-900">
                        {m.drugName} {m.dosage}
                      </td>
                      <td className="px-4 py-3 font-sans text-slate-700">
                        {m.frequency} (Qty: {m.quantity})
                      </td>
                      <td className="px-4 py-3 font-sans text-slate-600">
                        {m.duration} ({m.route})
                      </td>
                      <td className="px-4 py-3 font-sans text-slate-600">
                        {m.prescribedBy || 'Physician'}
                      </td>
                      <td className="px-4 py-3 font-sans">
                        <span className={`px-2 py-0.5 rounded text-2xs font-medium ${
                          isDispensed ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                        }`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-sans">
                        {!isDispensed ? (
                          <button
                            onClick={() => openDispenseModal(m)}
                            className="px-3 py-1 text-2xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded transition-colors shadow-xs"
                          >
                            Dispense Item
                          </button>
                        ) : (
                          <span className="text-2xs text-slate-400 flex items-center justify-end gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Dispensed</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DISPENSING MODAL */}
      {dispenseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Pharmacy Dispensing & Inventory Deduction</h3>
              <p className="text-2xs text-slate-500">
                Prescription: <strong className="text-slate-800">{dispenseTarget.drugName} {dispenseTarget.dosage}</strong>
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Select Inventory Stock Batch</label>
                <select
                  value={selectedInventoryItem?.id || ''}
                  onChange={(e) => {
                    const found = inventory.find(i => i.id.toString() === e.target.value);
                    if (found) setSelectedInventoryItem(found);
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                >
                  {inventory.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.currentStock} in stock · KES {Number(item.sellingPrice).toLocaleString()}/unit)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Quantity Dispensed</label>
                <input
                  type="number"
                  min={1}
                  value={dispenseQty}
                  onChange={(e) => setDispenseQty(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-bold"
                />
              </div>

              {/* FEFO — the server picks the lot, not the pharmacist */}
              {(() => {
                if (!selectedInventoryItem) return null;

                const lots = batches.filter((b) => b.itemId === selectedInventoryItem.id);
                const usable = lots
                  .filter((b) => b.status !== 'Expired')
                  .reduce((sum, b) => sum + b.quantityRemaining, 0);
                const expired = lots
                  .filter((b) => b.status === 'Expired')
                  .reduce((sum, b) => sum + b.quantityRemaining, 0);
                const next = lots.find((b) => b.status !== 'Expired');

                if (lots.length === 0) {
                  return (
                    <div className="text-2xs bg-slate-50 border border-slate-200 rounded-md p-2.5 text-slate-600">
                      <strong className="text-slate-800">No tracked batches.</strong> Dispensing deducts
                      from the plain stock count. Receive a batch in Inventory to enable FEFO and expiry control.
                    </div>
                  );
                }

                return (
                  <div className="text-2xs bg-teal-50 border border-teal-200 rounded-md p-2.5 text-teal-900 space-y-0.5">
                    <div className="font-semibold flex items-center gap-1">
                      <Layers className="w-3 h-3" />
                      FEFO — {lots.length} lot{lots.length === 1 ? '' : 's'} tracked
                    </div>
                    <div>
                      {usable} usable unit{usable === 1 ? '' : 's'}
                      {next ? ` · next to expire ${next.batchNumber} on ${next.expiryDate}` : ''}
                    </div>
                    {expired > 0 && (
                      <div className="text-rose-700 font-semibold flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {expired} expired unit{expired === 1 ? '' : 's'} excluded from dispensing
                      </div>
                    )}
                    <div className="text-teal-700">
                      The lot is chosen automatically; expired stock is never dispensed.
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block font-medium text-slate-700 mb-1">Patient Instructions on Dispense Label</label>
                <input
                  type="text"
                  value={dispenseNotes}
                  onChange={(e) => setDispenseNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>

              <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg text-2xs text-teal-900 space-y-1">
                <div>✓ Deducts <strong>{dispenseQty}</strong> units from Pharmacy Store stock.</div>
                <div>✓ Creates pending patient invoice item for cashier collection.</div>
              </div>
            </div>

            <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDispenseTarget(null)}
                className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDispense}
                className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800"
              >
                Authorize & Dispense
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
