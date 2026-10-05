import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { LabTest, LabOrder, LabResult, Patient } from '../../types/index.ts';
import {
  FlaskConical,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileCheck2,
  UserCheck,
  Plus,
  Printer,
  Barcode
} from 'lucide-react';

export const LaboratoryModule: React.FC = () => {
  const { currentFacility, currentUser, setSelectedPatient, setIsJourneyModalOpen, showToast, refreshKey, triggerRefresh } = useHmis();
  const [labTests, setLabTests] = useState<LabTest[]>([]);
  const [labOrders, setLabOrders] = useState<LabOrder[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<LabOrder | null>(null);
  const [orderResults, setOrderResults] = useState<LabResult[]>([]);
  const [loading, setLoading] = useState(true);

  // Result Entry Form
  const [resultParam, setResultParam] = useState({
    parameterName: 'Haemoglobin (Hb)',
    measuredValue: '14.2',
    unit: 'g/dL',
    referenceRange: '13.0 - 17.5',
    flag: 'Normal',
    notes: 'Adequate red cell indices',
  });

  useEffect(() => {
    async function loadLabData() {
      setLoading(true);
      try {
        const [tests, orders, pList] = await Promise.all([
          api.getLabTests(currentFacility?.id),
          api.getLabOrders(currentFacility?.id),
          api.getPatients(undefined, currentFacility?.id),
        ]);
        setLabTests(tests);
        setLabOrders(orders);
        setPatients(pList);
        if (orders.length > 0 && !selectedOrder) {
          selectOrder(orders[0]);
        }
      } catch (err) {
        console.error('Failed to load lab data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadLabData();
  }, [currentFacility, refreshKey]);

  const selectOrder = async (order: LabOrder) => {
    setSelectedOrder(order);
    try {
      const results = await api.getLabResults(order.id);
      setOrderResults(results);
    } catch (err) {
      console.error('Failed to load lab results:', err);
    }
  };

  const handleUpdateOrderStatus = async (id: number, status: string) => {
    try {
      const accessionNum = `ACC-${Date.now().toString().slice(-6)}`;
      await api.updateLabOrderStatus(id, status, accessionNum);
      showToast(`Lab Order marked as ${status}${status === 'Sample Collected' ? ` (Accession: ${accessionNum})` : ''}`);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleAddResult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;

    try {
      const created = await api.addLabResult({
        orderId: selectedOrder.id,
        patientId: selectedOrder.patientId,
        parameterName: resultParam.parameterName,
        measuredValue: resultParam.measuredValue,
        unit: resultParam.unit,
        referenceRange: resultParam.referenceRange,
        flag: resultParam.flag,
        notes: resultParam.notes,
        verifiedBy: `${currentUser.name} (${currentUser.role})`,
      });

      setOrderResults(prev => [...prev, created]);
      showToast('Lab result parameter entered and validated against reference ranges.');
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const getPatient = (patientId: number) => {
    return patients.find(p => p.id === patientId);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Clinical Pathology & Diagnostic Laboratory</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Specimen accessioning, LOINC test catalog, reference ranges, critical flag validation, and report publishing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-teal-50 border border-teal-200/60 text-teal-800 text-xs font-semibold rounded-lg font-mono">
            {labOrders.filter(o => o.status !== 'Published').length} Samples In-Progress
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Orders Queue (1 col) */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase flex items-center gap-1.5">
              <FlaskConical className="w-4 h-4 text-teal-700" />
              <span>Specimen Queue ({labOrders.length})</span>
            </h2>
            <span className="text-2xs text-slate-400 font-mono">Barcoded Accession</span>
          </div>

          <div className="p-3 space-y-2 flex-1 overflow-y-auto max-h-[600px]">
            {labOrders.map((lo) => {
              const patient = getPatient(lo.patientId);
              const isSelected = selectedOrder?.id === lo.id;

              return (
                <div
                  key={lo.id}
                  onClick={() => selectOrder(lo)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    isSelected
                      ? 'border-teal-700 bg-teal-50/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 text-xs">{lo.testName}</span>
                    <span className={`px-2 py-0.5 rounded text-3xs font-medium ${
                      lo.status === 'Published'
                        ? 'bg-emerald-50 text-emerald-800'
                        : lo.status === 'Sample Collected'
                        ? 'bg-purple-50 text-purple-800'
                        : 'bg-slate-100 text-slate-700'
                    }`}>
                      {lo.status}
                    </span>
                  </div>

                  <div className="text-2xs text-slate-600 mt-1">
                    Patient: <strong>{patient ? `${patient.firstName} ${patient.lastName}` : `Patient #${lo.patientId}`}</strong> ({patient?.mrn})
                  </div>

                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100 text-3xs text-slate-400 font-mono">
                    <span className="flex items-center gap-1">
                      <Barcode className="w-3 h-3 text-slate-500" />
                      <span>{lo.sampleAccessionNumber || 'Accession Pending'}</span>
                    </span>
                    <span>{new Date(lo.orderedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  {lo.status === 'Ordered' && (
                    <div className="mt-2 pt-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateOrderStatus(lo.id, 'Sample Collected');
                        }}
                        className="w-full py-1 bg-teal-700 text-white text-2xs font-medium rounded hover:bg-teal-800 transition-colors"
                      >
                        Collect Sample & Accession Barcode
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Two Columns: Result Entry & Lab Report View (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {selectedOrder ? (
            <>
              {/* Order Overview Header Card */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs text-xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">{selectedOrder.testName}</h2>
                    <div className="text-2xs text-slate-500 mt-0.5">
                      Specimen Accession: <strong className="font-mono text-teal-800">{selectedOrder.sampleAccessionNumber || 'Unaccessioned'}</strong> · Ordered by: {selectedOrder.orderedBy || 'Doctor'}
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-bold text-slate-900 text-sm">
                      Status: {selectedOrder.status}
                    </span>
                    <div className="text-2xs text-slate-400 font-mono">
                      {new Date(selectedOrder.orderedAt).toLocaleString('en-KE')}
                    </div>
                  </div>
                </div>

                {/* Patient Summary */}
                {(() => {
                  const pat = getPatient(selectedOrder.patientId);
                  return (
                    <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg text-2xs">
                      <div>
                        Patient: <strong className="text-slate-800">{pat?.firstName} {pat?.lastName}</strong> ({pat?.gender} · {pat?.dateOfBirth})
                      </div>
                      <div>
                        MRN: <strong className="font-mono text-slate-800">{pat?.mrn}</strong> · Payer: <strong>{pat?.payerType}</strong>
                      </div>
                      <button
                        onClick={() => {
                          if (pat) {
                            setSelectedPatient(pat);
                            setIsJourneyModalOpen(true);
                          }
                        }}
                        className="text-teal-700 font-semibold hover:underline"
                      >
                        Patient Profile
                      </button>
                    </div>
                  );
                })()}

                {/* Existing Results Table */}
                <div>
                  <h3 className="text-2xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Verified Test Parameters & Measured Values
                  </h3>
                  <div className="border border-slate-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-xs text-left min-w-[560px]">
                      <thead className="bg-slate-50 border-b border-slate-200 text-2xs text-slate-500 uppercase">
                        <tr>
                          <th className="px-3 py-2 font-medium">Parameter</th>
                          <th className="px-3 py-2 font-medium">Measured Value</th>
                          <th className="px-3 py-2 font-medium">Unit</th>
                          <th className="px-3 py-2 font-medium">Reference Range</th>
                          <th className="px-3 py-2 font-medium">Flag</th>
                          <th className="px-3 py-2 font-medium">Verified By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {orderResults.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="text-center py-6 text-slate-400 font-sans">
                              No results entered yet for this investigation. Use form below to record results.
                            </td>
                          </tr>
                        ) : (
                          orderResults.map(r => (
                            <tr key={r.id} className="hover:bg-slate-50/70">
                              <td className="px-3 py-2 font-sans font-medium text-slate-900">{r.parameterName}</td>
                              <td className="px-3 py-2 font-bold text-slate-900">{r.measuredValue}</td>
                              <td className="px-3 py-2 text-slate-600">{r.unit || '—'}</td>
                              <td className="px-3 py-2 text-slate-600">{r.referenceRange || '—'}</td>
                              <td className="px-3 py-2 font-sans">
                                <span className={`px-2 py-0.5 rounded text-2xs font-medium ${
                                  r.flag === 'Critical'
                                    ? 'bg-rose-100 text-rose-800 font-bold'
                                    : r.flag === 'High'
                                    ? 'bg-amber-100 text-amber-800 font-semibold'
                                    : r.flag === 'Low'
                                    ? 'bg-amber-50 text-amber-700'
                                    : 'bg-emerald-50 text-emerald-800'
                                }`}>
                                  {r.flag}
                                </span>
                              </td>
                              <td className="px-3 py-2 font-sans text-2xs text-slate-500 truncate max-w-xs">{r.verifiedBy || 'Technologist'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Add Result Parameter Form */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs text-xs space-y-4">
                <div className="border-b border-slate-100 pb-2 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 uppercase">
                    Enter Parameter Result & Pathologist Verification
                  </h3>
                  <span className="text-2xs text-slate-400">Step 2 of Clinical Workflow</span>
                </div>

                <form onSubmit={handleAddResult} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Parameter Name *</label>
                      <input
                        type="text"
                        required
                        value={resultParam.parameterName}
                        onChange={(e) => setResultParam({ ...resultParam, parameterName: e.target.value })}
                        placeholder="e.g. Haemoglobin / Creatinine"
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-md font-medium"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Measured Value *</label>
                      <input
                        type="text"
                        required
                        value={resultParam.measuredValue}
                        onChange={(e) => setResultParam({ ...resultParam, measuredValue: e.target.value })}
                        placeholder="e.g. 14.2"
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-md font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Unit of Measurement</label>
                      <input
                        type="text"
                        value={resultParam.unit}
                        onChange={(e) => setResultParam({ ...resultParam, unit: e.target.value })}
                        placeholder="e.g. g/dL, mmol/L"
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-md font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Reference Range</label>
                      <input
                        type="text"
                        value={resultParam.referenceRange}
                        onChange={(e) => setResultParam({ ...resultParam, referenceRange: e.target.value })}
                        placeholder="e.g. 13.0 - 17.5"
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-md font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Clinical Flag</label>
                      <select
                        value={resultParam.flag}
                        onChange={(e) => setResultParam({ ...resultParam, flag: e.target.value })}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-md font-medium"
                      >
                        <option value="Normal">Normal</option>
                        <option value="High">High</option>
                        <option value="Low">Low</option>
                        <option value="Critical">Critical (Panic Value Alert)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Pathologist Interpretation Notes</label>
                    <input
                      type="text"
                      value={resultParam.notes}
                      onChange={(e) => setResultParam({ ...resultParam, notes: e.target.value })}
                      placeholder="e.g. Normocytic normochromic red cells observed"
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-md"
                    />
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      className="px-4 py-2 bg-teal-700 text-white rounded-lg font-semibold hover:bg-teal-800 transition-colors shadow-xs"
                    >
                      Publish Lab Result
                    </button>
                  </div>
                </form>
              </div>
            </>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-xs text-slate-400">
              Select an investigation order from the left queue to view and enter laboratory results.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
