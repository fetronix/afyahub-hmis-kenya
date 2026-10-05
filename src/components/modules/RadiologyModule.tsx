import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { RadiologyOrder, Patient } from '../../types/index.ts';
import {
  Scan,
  CheckCircle2,
  Clock,
  UserCheck,
  Plus,
  FileText,
  Image as ImageIcon
} from 'lucide-react';

export const RadiologyModule: React.FC = () => {
  const { currentFacility, currentUser, setSelectedPatient, setIsJourneyModalOpen, showToast, refreshKey, triggerRefresh } = useHmis();
  const [orders, setOrders] = useState<RadiologyOrder[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<RadiologyOrder | null>(null);
  const [loading, setLoading] = useState(true);

  // New Request Form Modal
  const [isNewReqModalOpen, setIsNewReqModalOpen] = useState(false);
  const [reqForm, setReqForm] = useState({
    patientId: '',
    modality: 'X-Ray',
    procedureName: 'Chest X-Ray PA View',
    clinicalIndication: 'Chronic productive cough, weight loss, r/o pulmonary tuberculosis',
  });

  // Report Editor State
  const [reportFindings, setReportFindings] = useState('');
  const [reportImpression, setReportImpression] = useState('');

  useEffect(() => {
    async function loadRadiology() {
      setLoading(true);
      try {
        const [rList, pList] = await Promise.all([
          api.getRadiologyOrders(currentFacility?.id),
          api.getPatients(undefined, currentFacility?.id),
        ]);
        setOrders(rList);
        setPatients(pList);
        if (pList.length > 0 && !reqForm.patientId) {
          setReqForm(prev => ({ ...prev, patientId: pList[0].id.toString() }));
        }
        if (rList.length > 0 && !selectedOrder) {
          selectOrder(rList[0]);
        }
      } catch (err) {
        console.error('Failed to load radiology orders:', err);
      } finally {
        setLoading(false);
      }
    }
    loadRadiology();
  }, [currentFacility, refreshKey]);

  const selectOrder = (order: RadiologyOrder) => {
    setSelectedOrder(order);
    setReportFindings(order.radiologistFindings || '');
    setReportImpression(order.impression || '');
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqForm.patientId) return;

    try {
      await api.createRadiologyOrder({
        tenantId: currentFacility?.tenantId || 1,
        facilityId: currentFacility?.id || 1,
        patientId: Number(reqForm.patientId),
        modality: reqForm.modality,
        procedureName: reqForm.procedureName,
        clinicalIndication: reqForm.clinicalIndication,
        status: 'Requested',
        orderedBy: currentUser.name,
      });

      showToast('Radiology imaging request created!');
      setIsNewReqModalOpen(false);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleSaveReport = async () => {
    if (!selectedOrder) return;
    try {
      await api.updateRadiologyReport(selectedOrder.id, {
        findings: reportFindings,
        impression: reportImpression,
        reportedBy: `${currentUser.name} (Radiologist)`,
      });

      showToast('Radiology report published to patient longitudinal record.');
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
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Diagnostic Radiology & Medical Imaging</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            X-Ray, Ultrasound, CT Scan, and MRI requests with PACS simulation and official radiologist reporting.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsNewReqModalOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Imaging Request</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Imaging Orders Queue (1 col) */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase flex items-center gap-1.5">
              <Scan className="w-4 h-4 text-teal-700" />
              <span>Imaging Requests ({orders.length})</span>
            </h2>
            <span className="text-2xs text-slate-400 font-mono">Modality Worklist</span>
          </div>

          <div className="p-3 space-y-2 flex-1 overflow-y-auto max-h-[600px]">
            {orders.map((ord) => {
              const patient = getPatient(ord.patientId);
              const isSelected = selectedOrder?.id === ord.id;

              return (
                <div
                  key={ord.id}
                  onClick={() => selectOrder(ord)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    isSelected
                      ? 'border-teal-700 bg-teal-50/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 text-xs">{ord.procedureName}</span>
                    <span className={`px-2 py-0.5 rounded text-3xs font-medium ${
                      ord.status === 'Reported' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {ord.status}
                    </span>
                  </div>

                  <div className="text-2xs text-slate-600 mt-1">
                    Patient: <strong>{patient ? `${patient.firstName} ${patient.lastName}` : `Patient #${ord.patientId}`}</strong> ({patient?.mrn})
                  </div>

                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100 text-3xs text-slate-400 font-mono">
                    <span className="px-1.5 py-0.2 bg-slate-100 rounded text-slate-700 font-semibold">{ord.modality}</span>
                    <span>{new Date(ord.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Two Columns: Radiologist Report Editor (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {selectedOrder ? (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs text-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">{selectedOrder.procedureName}</h2>
                  <div className="text-2xs text-slate-500 mt-0.5">
                    Modality: <strong>{selectedOrder.modality}</strong> · Ordered by: <strong>{selectedOrder.orderedBy || 'Clinician'}</strong>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded text-2xs font-semibold ${
                  selectedOrder.status === 'Reported' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                }`}>
                  {selectedOrder.status}
                </span>
              </div>

              {/* Patient info */}
              {(() => {
                const pat = getPatient(selectedOrder.patientId);
                return (
                  <div className="bg-slate-50 p-3 rounded-lg flex items-center justify-between text-2xs">
                    <div>
                      Patient: <strong className="text-slate-800">{pat?.firstName} {pat?.lastName}</strong> ({pat?.gender} · {pat?.dateOfBirth})
                    </div>
                    <div>
                      Clinical Indication: <strong className="text-slate-700">{selectedOrder.clinicalIndication || 'Routine imaging'}</strong>
                    </div>
                  </div>
                );
              })()}

              {/* PACS DICOM Simulation Preview Banner */}
              <div className="p-4 bg-slate-950 text-slate-300 rounded-xl border border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-teal-400">
                    <ImageIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="font-semibold text-white text-xs">PACS DICOM Study #DCM-{selectedOrder.id}982</div>
                    <div className="text-2xs text-slate-400 font-mono">Modality: {selectedOrder.modality} · 128 Slices · Window: Mediastinum/Bone</div>
                  </div>
                </div>
                <span className="px-3 py-1 bg-slate-800 text-teal-300 text-2xs font-mono rounded border border-slate-700">
                  DICOM 3.0 Connected
                </span>
              </div>

              {/* Radiologist Report Editor */}
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Radiological Findings</label>
                  <textarea
                    rows={4}
                    value={reportFindings}
                    onChange={(e) => setReportFindings(e.target.value)}
                    placeholder="Detailed anatomical observations, bones, soft tissues, lung fields, cardiac silhouette..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Impression / Radiologist Conclusion</label>
                  <textarea
                    rows={2}
                    value={reportImpression}
                    onChange={(e) => setReportImpression(e.target.value)}
                    placeholder="Definitive radiological diagnosis..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700 font-semibold"
                  />
                </div>

                <div className="pt-2 flex items-center justify-between border-t border-slate-100">
                  <span className="text-2xs text-slate-400">
                    Sign-off: <strong>{currentUser.name}</strong> ({currentUser.role})
                  </span>
                  <button
                    onClick={handleSaveReport}
                    className="px-5 py-2 bg-teal-700 text-white rounded-lg font-semibold hover:bg-teal-800 transition-colors shadow-xs"
                  >
                    Publish Official Radiology Report
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-xs text-slate-400">
              Select an imaging order from the worklist to review and transcribe report.
            </div>
          )}
        </div>
      </div>

      {/* NEW REQUEST MODAL */}
      {isNewReqModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Request Diagnostic Medical Imaging</h3>
              <p className="text-2xs text-slate-500">Order X-Ray, Ultrasound, CT Scan or MRI with clinical indication.</p>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Select Patient *</label>
                <select
                  required
                  value={reqForm.patientId}
                  onChange={(e) => setReqForm({ ...reqForm, patientId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                >
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} ({p.mrn} · {p.payerType})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Imaging Modality</label>
                  <select
                    value={reqForm.modality}
                    onChange={(e) => setReqForm({ ...reqForm, modality: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  >
                    <option value="X-Ray">X-Ray (Plain Radiography)</option>
                    <option value="Ultrasound">Ultrasound (Sonography)</option>
                    <option value="CT Scan">CT Scan (Computed Tomography)</option>
                    <option value="MRI">MRI (Magnetic Resonance)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Procedure Title</label>
                  <input
                    type="text"
                    required
                    value={reqForm.procedureName}
                    onChange={(e) => setReqForm({ ...reqForm, procedureName: e.target.value })}
                    placeholder="e.g. Chest X-Ray PA View"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Clinical Indication & History *</label>
                <textarea
                  rows={3}
                  required
                  value={reqForm.clinicalIndication}
                  onChange={(e) => setReqForm({ ...reqForm, clinicalIndication: e.target.value })}
                  placeholder="Clinical reason, suspected pathology, relevant prior exams..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsNewReqModalOpen(false)}
                  className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800"
                >
                  Send Imaging Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
