import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { Medication, InventoryItem, Patient } from '../../types/index.ts';
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
  const { currentFacility, currentUser, setSelectedPatient, setIsJourneyModalOpen, showToast, refreshKey, triggerRefresh } = useHmis();
  const [prescriptions, setPrescriptions] = useState<Medication[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'Pending' | 'Dispensed' | 'All'>('Pending');

  // Dispensing Target Modal
  const [dispenseTarget, setDispenseTarget] = useState<Medication | null>(null);
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<InventoryItem | null>(null);
  const [batchNumber, setBatchNumber] = useState('B-2026-08');
  const [dispenseQty, setDispenseQty] = useState(1);
  const [dispenseNotes, setDispenseNotes] = useState('Labelled: Take with plenty of water after food.');

  useEffect(() => {
    async function loadPharmacy() {
      setLoading(true);
      try {
        const [meds, inv, pList] = await Promise.all([
          api.getMedications(),
          api.getInventory(currentFacility?.id),
          api.getPatients(undefined, currentFacility?.id),
        ]);
        setPrescriptions(meds);
        setInventory(inv);
        setPatients(pList);
      } catch (err) {
        console.error('Failed to load pharmacy data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadPharmacy();
  }, [currentFacility, refreshKey]);

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
      setBatchNumber(`B-${match.itemCode}-01`);
    } else if (inventory.length > 0) {
      setSelectedInventoryItem(inventory[0]);
      setBatchNumber(`B-${inventory[0].itemCode}-01`);
    }
  };

  const handleConfirmDispense = async () => {
    if (!dispenseTarget) return;

    try {
      await api.dispenseMedication({
        tenantId: currentFacility?.tenantId || 1,
        facilityId: currentFacility?.id || 1,
        prescriptionId: dispenseTarget.id,
        patientId: dispenseTarget.patientId,
        itemId: selectedInventoryItem ? selectedInventoryItem.id : undefined,
        batchNumber,
        quantityDispensed: Number(dispenseQty),
        dispensedBy: currentUser.name,
        notes: dispenseNotes,
      });

      // Automatically create an invoice item for cashier if not yet paid
      const patient = patients.find(p => p.id === dispenseTarget.patientId);
      if (patient) {
        const totalCost = (Number(dispenseTarget.unitPrice || '15') * Number(dispenseQty)).toFixed(2);
        const invNum = `INV-${Date.now().toString().slice(-6)}`;
        await api.createInvoice(
          {
            tenantId: patient.tenantId,
            facilityId: patient.facilityId,
            patientId: patient.id,
            encounterId: dispenseTarget.encounterId,
            invoiceNumber: invNum,
            totalAmount: totalCost,
            paidAmount: '0.00',
            balanceAmount: totalCost,
            status: 'Pending',
            payerType: patient.payerType,
            payerName: patient.insuranceProvider || patient.payerType,
          },
          [
            {
              itemType: 'Pharmacy',
              description: `${dispenseTarget.drugName} ${dispenseTarget.dosage} (${dispenseQty} units)`,
              quantity: Number(dispenseQty),
              unitPrice: dispenseTarget.unitPrice || '15.00',
              totalAmount: totalCost,
            },
          ]
        );
      }

      showToast(`Medication dispensed! Stock deducted and invoice created for cashier.`);
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Outpatient Pharmacy & Drug Dispensing POS</h1>
          <p className="text-xs text-slate-500 mt-0.5">
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Batch Number</label>
                  <input
                    type="text"
                    value={batchNumber}
                    onChange={(e) => setBatchNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Quantity Dispensed</label>
                  <input
                    type="number"
                    value={dispenseQty}
                    onChange={(e) => setDispenseQty(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-bold"
                  />
                </div>
              </div>

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
