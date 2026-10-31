import { DataTable, PageHeader } from '../ui/layout.tsx';
import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import {
  clearPendingDispense,
  readPendingDispense,
  savePendingDispense,
  type PendingDispense,
} from '../../clinical/pharmacy-retry-storage.ts';
import { Medication, InventoryItem, Patient, InventoryBatchRow } from '../../types/index.ts';
import {
  Pill,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Package,
  Layers,
  Search,
  ShoppingCart,
} from 'lucide-react';

export const PharmacyModule: React.FC = () => {
  const {
    currentTenant,
    currentFacility,
    currentUser,
    authenticatedUser,
    setSelectedPatient,
    setIsJourneyModalOpen,
    showToast,
    refreshKey,
    triggerRefresh,
  } = useHmis();
  const [prescriptions, setPrescriptions] = useState<Medication[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [filter, setFilter] = useState<'Pending' | 'Dispensed' | 'All'>('Pending');

  // Dispensing Target Modal
  const [dispenseTarget, setDispenseTarget] = useState<Medication | null>(null);
  const [selectedInventoryItem, setSelectedInventoryItem] = useState<InventoryItem | null>(null);
  const [batches, setBatches] = useState<InventoryBatchRow[]>([]);
  const [dispenseQty, setDispenseQty] = useState(1);
  const [dispenseNotes, setDispenseNotes] = useState('');
  const [dispenseKey, setDispenseKey] = useState('');
  const [isDispensing, setIsDispensing] = useState(false);
  const [batchesUnavailable, setBatchesUnavailable] = useState(false);
  const [pendingDispense, setPendingDispense] = useState<PendingDispense | null>(null);
  const [storageError, setStorageError] = useState('');
  const [checkingPending, setCheckingPending] = useState(false);
  const storageKey =
    authenticatedUser?.id && currentFacility?.id
      ? `jalicare:pharmacy:pending:${authenticatedUser.id}:${currentFacility.id}`
      : null;
  const activeScope =
    authenticatedUser?.id && currentTenant?.id && currentFacility?.id
      ? `${authenticatedUser.id}:${currentTenant.id}:${currentFacility.id}`
      : null;
  const dataReady = Boolean(activeScope && loadedScope === activeScope && !loading && !loadError);

  useEffect(() => {
    if (!storageKey) {
      setPendingDispense(null);
      setStorageError('A signed-in user and facility are required.');
      return;
    }
    const refreshPending = () => {
      try {
        setPendingDispense(readPendingDispense(window.localStorage, storageKey));
        setStorageError('');
      } catch {
        setStorageError(
          'The saved retry identity cannot be read. Review dispensing records before continuing.',
        );
      }
    };
    refreshPending();
    window.addEventListener('storage', refreshPending);
    return () => window.removeEventListener('storage', refreshPending);
  }, [storageKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadPharmacy() {
      // Never present data from a previous facility or a failed refresh as a
      // current, empty worklist. The scope check also hides it immediately,
      // before this effect runs after a facility change.
      setLoading(true);
      setLoadError('');
      setLoadedScope(null);
      setPrescriptions([]);
      setInventory([]);
      setPatients([]);
      setBatches([]);
      setBatchesUnavailable(false);
      setDispenseTarget(null);
      setSelectedInventoryItem(null);

      if (!activeScope || !currentTenant?.id || !currentFacility?.id) {
        setLoadError('A signed-in user and facility are required to load pharmacy data.');
        setLoading(false);
        return;
      }

      try {
        const [meds, inv, pList, batchResult] = await Promise.all([
          api.getMedications(),
          api.getInventory(currentFacility.id),
          api.getPatients(currentTenant.id, currentFacility.id),
          api
            .getInventoryBatches(currentFacility.id)
            .then((rows) => ({ rows, unavailable: false }))
            .catch(() => ({ rows: [] as InventoryBatchRow[], unavailable: true })),
        ]);
        // An earlier request may finish after the user changes facilities.
        if (cancelled) return;
        setPrescriptions(meds);
        setInventory(inv);
        setPatients(pList);
        setBatches(batchResult.rows);
        setBatchesUnavailable(batchResult.unavailable);
        setLoadedScope(activeScope);
      } catch {
        if (cancelled) return;
        setLoadError('Pharmacy data could not be loaded. Do not assume the worklist is empty.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadPharmacy();
    return () => {
      cancelled = true;
    };
  }, [activeScope, currentTenant?.id, currentFacility?.id, refreshKey, reloadVersion]);

  const openDispenseModal = (med: Medication) => {
    if (!dataReady) return;
    if (storageError || (pendingDispense && pendingDispense.prescriptionId !== med.id)) {
      showToast('Resolve the unconfirmed dispensing request before starting a different one.');
      return;
    }
    setDispenseTarget(med);
    setDispenseQty(Math.max(1, (med.quantity || 1) - (med.quantityDispensed || 0)));
    setDispenseKey(pendingDispense?.key ?? crypto.randomUUID());

    // The pharmacist must explicitly identify the actual product; a fuzzy
    // match or the first inventory item is not clinical verification.
    setSelectedInventoryItem(null);
    setDispenseNotes('');
  };

  const handleConfirmDispense = async () => {
    if (!dispenseTarget || !selectedInventoryItem || isDispensing) return;
    if (!storageKey || !currentFacility?.id || storageError) {
      showToast('A recoverable retry identity is required before dispensing.');
      return;
    }
    let key = dispenseKey;
    try {
      // Re-read immediately before submission in case another tab updated it.
      const saved = readPendingDispense(window.localStorage, storageKey);
      if (saved && saved.prescriptionId !== dispenseTarget.id) {
        setPendingDispense(saved);
        showToast('Resolve the unconfirmed dispensing request before starting a different one.');
        return;
      }
      key = saved?.key ?? key;
      const pending = { key, prescriptionId: dispenseTarget.id };
      if (!saved) savePendingDispense(window.localStorage, storageKey, pending);
      setPendingDispense(pending);
    } catch {
      setStorageError('The retry identity could not be saved. No dispensing request was sent.');
      return;
    }
    setIsDispensing(true);
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
        itemId: selectedInventoryItem.id,
        quantityDispensed: Number(dispenseQty),
        idempotencyKey: key,
        dispensedBy: currentUser.name,
        notes: dispenseNotes,
      });

      const billingNote = result?.billing?.charged
        ? `Billed KES ${result.billing.totalAmount} on ${result.billing.invoiceNumber}.`
        : result?.billing?.reason === 'DUPLICATE'
          ? 'A charge for this dispensing was already recorded.'
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

      let clearWarning = '';
      try {
        clearPendingDispense(window.localStorage, storageKey, key);
        setPendingDispense(readPendingDispense(window.localStorage, storageKey));
      } catch {
        clearWarning =
          ' The browser could not clear the retry identity; check the recorded result before continuing.';
        setStorageError('The recorded dispensing needs a browser retry-identity review.');
      }
      showToast(
        `${result?.replayed ? 'Previous dispensing retrieved.' : 'Medication dispensed.'} ${allocationNote} ${billingNote} ${result?.queueWarning || ''}${clearWarning}`,
      );
      setDispenseTarget(null);
      triggerRefresh();
    } catch (err: any) {
      showToast(
        `Dispensing could not be confirmed: ${err.message}. Retry this same request before starting another.`,
      );
    } finally {
      setIsDispensing(false);
    }
  };

  const checkPendingDispense = async () => {
    if (!pendingDispense || !storageKey || !currentFacility?.id || checkingPending) return;
    setCheckingPending(true);
    try {
      const outcome = await api.checkDispenseRequest({
        facilityId: currentFacility.id,
        idempotencyKey: pendingDispense.key,
      });
      if (outcome.status === 'NOT_FOUND') {
        showToast(
          'No committed record was found. Reopen this prescription and retry the same product, quantity and notes with the retained identity; do not start a second action.',
        );
        return;
      }
      if (outcome.prescriptionId !== pendingDispense.prescriptionId) {
        showToast(
          'The recorded result does not match the pending prescription. Manual review is required.',
        );
        return;
      }
      clearPendingDispense(window.localStorage, storageKey, pendingDispense.key);
      setPendingDispense(readPendingDispense(window.localStorage, storageKey));
      showToast(
        `A dispensing of ${outcome.quantity} unit(s) was recorded. Review the prescription and billing queue before another action.`,
      );
      triggerRefresh();
    } catch {
      showToast(
        'The dispensing status could not be confirmed. Keep the retry identity and review before continuing.',
      );
    } finally {
      setCheckingPending(false);
    }
  };

  const filteredMeds = prescriptions.filter((m) => {
    if (filter === 'All') return true;
    return filter === 'Pending'
      ? ['Prescribed', 'Partially Dispensed'].includes(m.status)
      : m.status === 'Dispensed';
  });

  const getPatient = (patientId: number) => {
    return patients.find((p) => p.id === patientId);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader>
        <div>
          <h1 className="ui-page-title">Outpatient Pharmacy & Drug Dispensing POS</h1>
          <p className="ui-page-description">
            Prescription verification, batch & expiry control, real-time stock deduction, and
            patient dosage instructions.
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
      </PageHeader>

      {(pendingDispense || storageError) && (
        <div
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 space-y-2"
        >
          <p className="font-semibold">Unconfirmed dispensing needs review</p>
          {storageError ? (
            <p>{storageError}</p>
          ) : (
            <>
              <p>
                Prescription #{pendingDispense?.prescriptionId} has a retained retry identity. Check
                whether it was recorded before starting another dispensing. Clinical notes are not
                stored in this browser.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={checkPendingDispense}
                  disabled={checkingPending}
                  className="rounded border border-amber-700 px-2 py-1 disabled:opacity-50"
                >
                  {checkingPending ? 'Checking...' : 'Check recorded result'}
                </button>
                <button
                  type="button"
                  disabled={!dataReady}
                  onClick={() => {
                    const medication = prescriptions.find(
                      (m) => m.id === pendingDispense?.prescriptionId,
                    );
                    if (medication) openDispenseModal(medication);
                    else showToast('Prescription is unavailable; review the dispensing records.');
                  }}
                  className="rounded border border-amber-700 px-2 py-1 disabled:opacity-50"
                >
                  Resume same request
                </button>
              </div>
              <p>
                For a retry, re-enter the same product, quantity and notes. If the browser data is
                cleared or another device is used, review the dispensing record manually.
              </p>
            </>
          )}
        </div>
      )}

      {/* Main Prescriptions Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase flex items-center gap-1.5">
            <Pill className="w-4 h-4 text-teal-700" />
            <span>Dispensing Worklist{dataReady ? ` (${filteredMeds.length})` : ''}</span>
          </h2>
          <span className="text-2xs text-slate-400 font-mono">Facility policy review required</span>
        </div>

        {!dataReady ? (
          <div className="p-5 text-xs">
            {loadError ? (
              <div role="alert" className="space-y-2 text-rose-800">
                <p>{loadError}</p>
                <button
                  type="button"
                  onClick={() => setReloadVersion((version) => version + 1)}
                  className="rounded border border-rose-700 px-3 py-1 font-semibold"
                >
                  Retry loading pharmacy data
                </button>
              </div>
            ) : (
              <p role="status" className="text-slate-600">
                Loading pharmacy data...
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <DataTable className="w-full text-xs text-left">
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
                    const canDispense = ['Prescribed', 'Partially Dispensed'].includes(m.status);

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
                          <span className="text-2xs text-slate-400 font-mono">
                            {patient?.mrn} · {patient?.payerType}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-sans font-semibold text-slate-900">
                          {m.drugName} {m.dosage}
                        </td>
                        <td className="px-4 py-3 font-sans text-slate-700">
                          {m.frequency} (prescribed: {m.quantity}; dispensed:{' '}
                          {m.quantityDispensed ?? 0})
                        </td>
                        <td className="px-4 py-3 font-sans text-slate-600">
                          {m.duration} ({m.route})
                        </td>
                        <td className="px-4 py-3 font-sans text-slate-600">
                          {m.prescribedBy || 'Physician'}
                        </td>
                        <td className="px-4 py-3 font-sans">
                          <span
                            className={`px-2 py-0.5 rounded text-2xs font-medium ${
                              isDispensed
                                ? 'bg-emerald-50 text-emerald-800'
                                : 'bg-amber-50 text-amber-800'
                            }`}
                          >
                            {m.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-sans">
                          {canDispense ? (
                            <button
                              onClick={() => openDispenseModal(m)}
                              className="px-3 py-1 text-2xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded transition-colors shadow-xs"
                            >
                              Dispense Item
                            </button>
                          ) : (
                            <span className="text-2xs text-slate-400 flex items-center justify-end gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>{m.status}</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </DataTable>
          </div>
        )}
      </div>

      {/* DISPENSING MODAL */}
      {dispenseTarget && dataReady && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                Pharmacy Dispensing & Inventory Deduction
              </h3>
              <p className="text-2xs text-slate-500">
                Prescription:{' '}
                <strong className="text-slate-800">
                  {dispenseTarget.drugName} {dispenseTarget.dosage}
                </strong>
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Select Inventory Stock Batch
                </label>
                <select
                  value={selectedInventoryItem?.id || ''}
                  onChange={(e) => {
                    const found = inventory.find((i) => i.id.toString() === e.target.value);
                    setSelectedInventoryItem(found ?? null);
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                >
                  <option value="">Select the verified stock item</option>
                  {inventory.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.currentStock ?? 'unknown'} in stock)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Quantity Dispensed</label>
                <input
                  type="number"
                  min={1}
                  max={Math.max(
                    0,
                    dispenseTarget.quantity - (dispenseTarget.quantityDispensed || 0),
                  )}
                  value={dispenseQty}
                  onChange={(e) => setDispenseQty(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-bold"
                />
              </div>

              {/* FEFO — the server picks the lot, not the pharmacist */}
              {(() => {
                if (!selectedInventoryItem) return null;
                if (batchesUnavailable)
                  return (
                    <div className="text-rose-700">
                      Batch information could not be loaded. The server will still validate stock
                      and expiry.
                    </div>
                  );

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
                      <strong className="text-slate-800">No tracked batches.</strong> Dispensing
                      deducts from the plain stock count. Receive a batch in Inventory to enable
                      FEFO and expiry control.
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
                <label className="block font-medium text-slate-700 mb-1">
                  Patient Instructions on Dispense Label
                </label>
                <input
                  type="text"
                  value={dispenseNotes}
                  onChange={(e) => setDispenseNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>

              <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg text-2xs text-teal-900 space-y-1">
                <div>
                  ✓ Deducts <strong>{dispenseQty}</strong> units from Pharmacy Store stock.
                </div>
                <div>Billing is attempted only when a facility tariff is configured.</div>
              </div>
            </div>

            <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDispenseTarget(null)}
                disabled={isDispensing}
                className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDispense}
                disabled={
                  !selectedInventoryItem ||
                  isDispensing ||
                  !Number.isInteger(dispenseQty) ||
                  dispenseQty <= 0 ||
                  dispenseQty > dispenseTarget.quantity - (dispenseTarget.quantityDispensed || 0)
                }
                className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800 disabled:opacity-50"
              >
                {isDispensing ? 'Recording...' : 'Authorize & Dispense'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
