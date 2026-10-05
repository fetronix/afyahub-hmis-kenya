import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { Ward, Bed, Admission, Patient } from '../../types/index.ts';
import {
  BedDouble,
  UserCheck,
  Plus,
  CheckCircle2,
  Clock,
  LogOut,
  AlertCircle,
  FileText
} from 'lucide-react';

export const InpatientModule: React.FC = () => {
  const { currentFacility, currentUser, setSelectedPatient, setIsJourneyModalOpen, showToast, refreshKey, triggerRefresh } = useHmis();
  const [wards, setWards] = useState<Ward[]>([]);
  const [selectedWard, setSelectedWard] = useState<Ward | null>(null);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);

  // New Admission Modal
  const [isAdmitModalOpen, setIsAdmitModalOpen] = useState(false);
  const [admitForm, setAdmitForm] = useState({
    patientId: '',
    wardId: '',
    bedId: '',
    admissionDate: new Date().toISOString().slice(0, 16).replace('T', ' '),
    admissionType: 'Emergency',
    provisionalDiagnosis: 'Severe community acquired pneumonia with respiratory compromise',
    nursingNotes: 'Oxygen therapy via nasal prongs at 3L/min. Strict fluid balance chart.',
  });

  // Discharge Modal
  const [dischargeTarget, setDischargeTarget] = useState<Admission | null>(null);
  const [dischargeSummary, setDischargeSummary] = useState('');
  const [dischargeType, setDischargeType] = useState('Routine Discharge');

  useEffect(() => {
    async function loadInpatient() {
      setLoading(true);
      try {
        const [wList, aList, pList] = await Promise.all([
          api.getWards(currentFacility?.id),
          api.getAdmissions(currentFacility?.id, 'Admitted'),
          api.getPatients(undefined, currentFacility?.id),
        ]);
        setWards(wList);
        setAdmissions(aList);
        setPatients(pList);
        if (wList.length > 0 && !selectedWard) {
          setSelectedWard(wList[0]);
          const bList = await api.getBeds(wList[0].id);
          setBeds(bList);
        }
      } catch (err) {
        console.error('Failed to load inpatient data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadInpatient();
  }, [currentFacility, refreshKey]);

  const handleSelectWard = async (ward: Ward) => {
    setSelectedWard(ward);
    try {
      const bList = await api.getBeds(ward.id);
      setBeds(bList);
    } catch (err) {
      console.error('Failed to load beds for ward:', err);
    }
  };

  const handleCreateAdmission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!admitForm.patientId || !admitForm.bedId || !admitForm.wardId) {
      showToast('Please select patient, ward, and bed');
      return;
    }

    try {
      await api.createAdmission({
        tenantId: currentFacility?.tenantId || 1,
        facilityId: currentFacility?.id || 1,
        patientId: Number(admitForm.patientId),
        wardId: Number(admitForm.wardId),
        bedId: Number(admitForm.bedId),
        admissionDate: admitForm.admissionDate,
        admissionType: admitForm.admissionType,
        admittingDoctor: currentUser.name,
        provisionalDiagnosis: admitForm.provisionalDiagnosis,
        nursingNotes: admitForm.nursingNotes,
        status: 'Admitted',
      });

      showToast('Patient admitted successfully and bed marked Occupied!');
      setIsAdmitModalOpen(false);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Admission error: ${err.message}`);
    }
  };

  const handleDischarge = async () => {
    if (!dischargeTarget) return;

    try {
      await api.dischargePatient(dischargeTarget.id, {
        bedId: dischargeTarget.bedId,
        dischargeDate: new Date().toISOString().slice(0, 16).replace('T', ' '),
        dischargeType,
        dischargeSummary,
      });

      showToast('Patient discharged and bed sent for terminal cleaning.');
      setDischargeTarget(null);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Discharge error: ${err.message}`);
    }
  };

  const getPatientName = (patientId: number) => {
    const p = patients.find(x => x.id === patientId);
    return p ? `${p.firstName} ${p.lastName}` : `Patient #${patientId}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Inpatient Care, Wards & Bed Board</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Monitor bed occupancy rates, admitting doctor reviews, nursing care, and discharge clearance.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (wards.length > 0) {
                setAdmitForm(prev => ({
                  ...prev,
                  wardId: wards[0].id.toString(),
                  patientId: patients[0]?.id.toString() || '',
                }));
              }
              setIsAdmitModalOpen(true);
            }}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Admit Patient to Ward</span>
          </button>
        </div>
      </div>

      {/* Ward Selection Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-600 px-2 flex items-center gap-1.5">
          <BedDouble className="w-4 h-4 text-teal-700" />
          <span>Hospital Wards:</span>
        </span>
        {wards.map((w) => (
          <button
            key={w.id}
            onClick={() => handleSelectWard(w)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              selectedWard?.id === w.id
                ? 'bg-teal-700 text-white shadow-xs font-semibold'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <span>{w.name}</span>
            <span className="ml-1 text-2xs font-mono opacity-80">({w.totalBeds} beds)</span>
          </button>
        ))}
      </div>

      {/* Visual Bed Grid */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              {selectedWard?.name} — Live Bed Board
            </h2>
            <span className="text-2xs text-slate-500">
              Type: {selectedWard?.wardType} · Daily Rate: KES {Number(selectedWard?.dailyRate || 0).toLocaleString()} / day
            </span>
          </div>

          {/* Status Legend */}
          <div className="flex items-center gap-3 text-2xs text-slate-600">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Available
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-teal-700 inline-block" /> Occupied
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Cleaning
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
          {beds.map((b) => {
            const isOccupied = b.status === 'Occupied';
            const isCleaning = b.status === 'Cleaning';
            const occupant = b.currentPatientId ? patients.find(p => p.id === b.currentPatientId) : null;

            return (
              <div
                key={b.id}
                className={`p-3 rounded-xl border text-center transition-all flex flex-col justify-between ${
                  isOccupied
                    ? 'border-teal-700 bg-teal-50/40 text-teal-950'
                    : isCleaning
                    ? 'border-amber-400 bg-amber-50/50 text-amber-900'
                    : 'border-slate-200 bg-white hover:border-emerald-500 text-slate-700'
                }`}
              >
                <div>
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <BedDouble className={`w-4 h-4 ${isOccupied ? 'text-teal-700' : isCleaning ? 'text-amber-600' : 'text-emerald-600'}`} />
                  </div>
                  <div className="font-mono font-bold text-xs">{b.bedNumber}</div>
                  <div className="text-3xs text-slate-400 truncate">{b.bedType}</div>
                </div>

                <div className="mt-2 pt-1 border-t border-slate-100">
                  {occupant ? (
                    <button
                      onClick={() => {
                        setSelectedPatient(occupant);
                        setIsJourneyModalOpen(true);
                      }}
                      className="text-2xs font-semibold text-teal-900 hover:underline block truncate w-full"
                    >
                      {occupant.firstName} {occupant.lastName[0]}.
                    </button>
                  ) : (
                    <span className={`text-3xs font-medium uppercase tracking-wider ${
                      isCleaning ? 'text-amber-700' : 'text-emerald-700'
                    }`}>
                      {b.status}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Currently Admitted Patients Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase">
            Active Hospital Inpatient Roster ({admissions.length})
          </h2>
          <span className="text-2xs text-slate-400 font-mono">Daily Inpatient Chargeable Ledger</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2.5 font-medium">Patient Details</th>
                <th className="px-4 py-2.5 font-medium">Ward & Bed #</th>
                <th className="px-4 py-2.5 font-medium">Admission Date</th>
                <th className="px-4 py-2.5 font-medium">Admitting Doctor</th>
                <th className="px-4 py-2.5 font-medium">Provisional Diagnosis</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium text-right">Discharge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {admissions.map((adm) => {
                const patient = patients.find(p => p.id === adm.patientId);
                const ward = wards.find(w => w.id === adm.wardId);
                const bed = beds.find(b => b.id === adm.bedId);

                return (
                  <tr key={adm.id} className="hover:bg-slate-50/70">
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
                        <span>Patient #{adm.patientId}</span>
                      )}
                      <span className="text-2xs text-slate-400 font-mono">{patient?.mrn}</span>
                    </td>
                    <td className="px-4 py-3 font-sans text-slate-700">
                      <div>{ward?.name || 'Medical Ward'}</div>
                      <div className="font-mono font-semibold text-teal-800 text-2xs">
                        Bed #{bed?.bedNumber || adm.bedId}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{adm.admissionDate}</td>
                    <td className="px-4 py-3 font-sans text-slate-700">{adm.admittingDoctor || 'Consultant'}</td>
                    <td className="px-4 py-3 font-sans text-slate-700 max-w-xs truncate">
                      {adm.provisionalDiagnosis}
                    </td>
                    <td className="px-4 py-3 font-sans">
                      <span className="px-2 py-0.5 rounded text-2xs bg-slate-100 text-slate-700">
                        {adm.admissionType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-sans">
                      <button
                        onClick={() => {
                          setDischargeTarget(adm);
                          setDischargeSummary(`Patient condition stabilized on medical management. Vitals normal. Discharge medications dispensed.`);
                        }}
                        className="px-2.5 py-1 text-2xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded transition-colors flex items-center gap-1 ml-auto"
                      >
                        <LogOut className="w-3 h-3" />
                        <span>Discharge</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADMISSION MODAL */}
      {isAdmitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Inpatient Admission Workflow</h3>
              <p className="text-2xs text-slate-500">Allocate patient to ward, allocate bed, and commence bed charges.</p>
            </div>

            <form onSubmit={handleCreateAdmission} className="space-y-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Select Patient *</label>
                <select
                  required
                  value={admitForm.patientId}
                  onChange={(e) => setAdmitForm({ ...admitForm, patientId: e.target.value })}
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
                  <label className="block font-medium text-slate-700 mb-1">Select Ward *</label>
                  <select
                    required
                    value={admitForm.wardId}
                    onChange={(e) => {
                      const wid = e.target.value;
                      setAdmitForm({ ...admitForm, wardId: wid });
                      api.getBeds(Number(wid)).then(b => {
                        setBeds(b);
                        const avail = b.find(x => x.status === 'Available');
                        if (avail) setAdmitForm(prev => ({ ...prev, bedId: avail.id.toString() }));
                      });
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  >
                    {wards.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Select Bed *</label>
                  <select
                    required
                    value={admitForm.bedId}
                    onChange={(e) => setAdmitForm({ ...admitForm, bedId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  >
                    {beds.filter(b => b.status === 'Available').map(b => (
                      <option key={b.id} value={b.id}>
                        {b.bedNumber} ({b.bedType} - KES {Number(b.dailyCharge).toLocaleString()}/d)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Admission Date & Time</label>
                  <input
                    type="text"
                    value={admitForm.admissionDate}
                    onChange={(e) => setAdmitForm({ ...admitForm, admissionDate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Admission Type</label>
                  <select
                    value={admitForm.admissionType}
                    onChange={(e) => setAdmitForm({ ...admitForm, admissionType: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  >
                    <option value="Emergency">Emergency Admission</option>
                    <option value="Elective">Elective / Planned</option>
                    <option value="Transfer">Inter-Facility Transfer</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Provisional Diagnosis *</label>
                <input
                  type="text"
                  required
                  value={admitForm.provisionalDiagnosis}
                  onChange={(e) => setAdmitForm({ ...admitForm, provisionalDiagnosis: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Nursing Care & Treatment Instructions</label>
                <textarea
                  rows={2}
                  value={admitForm.nursingNotes}
                  onChange={(e) => setAdmitForm({ ...admitForm, nursingNotes: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAdmitModalOpen(false)}
                  className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800"
                >
                  Confirm Admission
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DISCHARGE MODAL */}
      {dischargeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Inpatient Clinical Discharge & Clearance</h3>
              <p className="text-2xs text-slate-500">
                Patient: <strong className="text-slate-800">{getPatientName(dischargeTarget.patientId)}</strong>
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Discharge Disposition</label>
                <select
                  value={dischargeType}
                  onChange={(e) => setDischargeType(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                >
                  <option value="Routine Discharge (Recovered / Improved)">Routine Discharge (Recovered / Improved)</option>
                  <option value="Discharge on Request / Against Medical Advice (DAMA)">Discharge on Request / DAMA</option>
                  <option value="Transferred to Higher Level Facility">Transferred to Level 5/6 Facility</option>
                  <option value="Deceased">Deceased</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Discharge Summary & Medication Instructions *</label>
                <textarea
                  rows={3}
                  value={dischargeSummary}
                  onChange={(e) => setDischargeSummary(e.target.value)}
                  placeholder="Clinical course during stay, discharge medications, follow-up dates..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>

              <div className="p-3 rounded-lg bg-teal-50 border border-teal-200 text-2xs text-teal-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
                <span>Bed will automatically be freed and scheduled for housekeeping terminal cleaning.</span>
              </div>
            </div>

            <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDischargeTarget(null)}
                className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDischarge}
                className="px-4 py-1.5 bg-rose-700 text-white rounded-md font-semibold hover:bg-rose-800"
              >
                Authorize Discharge & Free Bed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
