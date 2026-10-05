import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { TheatreCase, Patient } from '../../types/index.ts';
import {
  Scissors,
  CheckCircle2,
  AlertTriangle,
  Clock,
  UserCheck,
  Plus,
  ShieldCheck,
  FileCheck
} from 'lucide-react';

export const TheatreModule: React.FC = () => {
  const { currentFacility, currentUser, setSelectedPatient, setIsJourneyModalOpen, showToast, refreshKey, triggerRefresh } = useHmis();
  const [cases, setCases] = useState<TheatreCase[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);

  // New Case Modal
  const [isNewCaseModalOpen, setIsNewCaseModalOpen] = useState(false);
  const [caseForm, setCaseForm] = useState({
    patientId: '',
    procedureName: 'Emergency Caesarean Section (Lower Segment)',
    theatreRoom: 'Main Theatre 1',
    theatreType: 'Major Surgery',
    leadSurgeon: 'Dr. Angela Omwamba',
    anaesthetist: 'Dr. Kamau Njoroge',
    scrubNurse: 'Nurse Janet Chebet',
    scheduledStart: '2026-10-05 14:00',
    scheduledEnd: '2026-10-05 15:30',
  });

  // WHO Checklist Modal
  const [activeChecklistCase, setActiveChecklistCase] = useState<TheatreCase | null>(null);
  const [checklist, setChecklist] = useState({
    patientIdentityConfirmed: true,
    siteMarked: true,
    anaesthesiaMachineChecked: true,
    pulseOximeterOnPatient: true,
    allergyKnown: false,
    difficultAirwayRisk: false,
    bloodLossRiskCrossmatched: true,
    allTeamMembersIntroduced: true,
    spongeInstrumentCountCorrect: true,
    specimenLabelledCorrectly: true,
  });

  useEffect(() => {
    async function loadTheatre() {
      setLoading(true);
      try {
        const [cList, pList] = await Promise.all([
          api.getTheatreCases(currentFacility?.id),
          api.getPatients(undefined, currentFacility?.id),
        ]);
        setCases(cList);
        setPatients(pList);
        if (pList.length > 0 && !caseForm.patientId) {
          setCaseForm(prev => ({ ...prev, patientId: pList[0].id.toString() }));
        }
      } catch (err) {
        console.error('Failed to load theatre cases:', err);
      } finally {
        setLoading(false);
      }
    }
    loadTheatre();
  }, [currentFacility, refreshKey]);

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!caseForm.patientId) return;

    try {
      await api.createTheatreCase({
        tenantId: currentFacility?.tenantId || 1,
        facilityId: currentFacility?.id || 1,
        patientId: Number(caseForm.patientId),
        procedureName: caseForm.procedureName,
        theatreRoom: caseForm.theatreRoom,
        theatreType: caseForm.theatreType,
        leadSurgeon: caseForm.leadSurgeon,
        anaesthetist: caseForm.anaesthetist,
        scrubNurse: caseForm.scrubNurse,
        scheduledStart: caseForm.scheduledStart,
        scheduledEnd: caseForm.scheduledEnd,
        status: 'Scheduled',
      });

      showToast('Surgery scheduled on Operating Theatre master roster!');
      setIsNewCaseModalOpen(false);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleUpdateStatus = async (id: number, status: string) => {
    try {
      await api.updateTheatreCase(id, { status });
      showToast(`Surgical status updated to "${status}"`);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleSaveChecklist = async () => {
    if (!activeChecklistCase) return;
    try {
      await api.updateTheatreCase(activeChecklistCase.id, {
        preOpChecklist: checklist,
      });
      showToast('WHO Surgical Safety Checklist verified & logged.');
      setActiveChecklistCase(null);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
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
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Operating Theatre & Surgical Suite</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Surgical list booking, WHO safety checklist compliance, theatre team allocation, and intra-operative notes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsNewCaseModalOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Schedule Surgical Case</span>
          </button>
        </div>
      </div>

      {/* Theatre Rooms Status Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { name: 'Main Theatre 1 (Laparoscopy / General)', status: 'Active (Case Running)', surgeon: 'Dr. Angela Omwamba' },
          { name: 'Main Theatre 2 (Obstetrics & C-Sections)', status: 'Ready / Sanitized', surgeon: 'On-Call OBGYN' },
          { name: 'Minor Theatre & Day Surgery', status: 'Ready', surgeon: 'Day Care Surgeon' },
        ].map((th, idx) => (
          <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900">{th.name}</span>
              <span className={`px-2 py-0.5 rounded text-3xs font-medium ${
                th.status.includes('Active') ? 'bg-teal-50 text-teal-800' : 'bg-emerald-50 text-emerald-800'
              }`}>
                {th.status}
              </span>
            </div>
            <div className="text-2xs text-slate-500">Lead: <strong>{th.surgeon}</strong></div>
          </div>
        ))}
      </div>

      {/* Surgical Case List */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase">
            Scheduled Surgical Procedures ({cases.length})
          </h2>
          <span className="text-2xs text-slate-400 font-mono">WHO Checklist Verified</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2.5 font-medium">Patient Details</th>
                <th className="px-4 py-2.5 font-medium">Procedure Name</th>
                <th className="px-4 py-2.5 font-medium">Room & Type</th>
                <th className="px-4 py-2.5 font-medium">Surgical Team</th>
                <th className="px-4 py-2.5 font-medium">Scheduled Time</th>
                <th className="px-4 py-2.5 font-medium">WHO Checklist</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {cases.map((c) => {
                const patient = patients.find(p => p.id === c.patientId);

                return (
                  <tr key={c.id} className="hover:bg-slate-50/70">
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
                        <span>Patient #{c.patientId}</span>
                      )}
                      <span className="text-2xs text-slate-400 font-mono">{patient?.mrn}</span>
                    </td>
                    <td className="px-4 py-3 font-sans font-semibold text-slate-900">
                      {c.procedureName}
                    </td>
                    <td className="px-4 py-3 font-sans text-slate-700">
                      <div>{c.theatreRoom}</div>
                      <div className="text-2xs text-slate-400">{c.theatreType}</div>
                    </td>
                    <td className="px-4 py-3 font-sans text-slate-700">
                      <div>Surgeon: <strong>{c.leadSurgeon}</strong></div>
                      <div className="text-2xs text-slate-500">Anaesth: {c.anaesthetist || 'TBD'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.scheduledStart}</td>
                    <td className="px-4 py-3 font-sans">
                      <button
                        onClick={() => setActiveChecklistCase(c)}
                        className="px-2 py-1 text-2xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded transition-colors flex items-center gap-1"
                      >
                        <ShieldCheck className="w-3 h-3 text-teal-700" />
                        <span>WHO Checklist</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right font-sans">
                      <select
                        value={c.status}
                        onChange={(e) => handleUpdateStatus(c.id, e.target.value)}
                        className="px-2 py-1 text-2xs border border-slate-200 rounded font-medium"
                      >
                        <option value="Scheduled">Scheduled</option>
                        <option value="In-Theatre">In-Theatre</option>
                        <option value="Recovery">In Recovery (PACU)</option>
                        <option value="Completed">Completed</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SCHEDULE SURGERY MODAL */}
      {isNewCaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Schedule Operating Theatre Case</h3>
              <p className="text-2xs text-slate-500">Book surgical room and assign surgical and anaesthesia team.</p>
            </div>

            <form onSubmit={handleCreateCase} className="space-y-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Select Patient *</label>
                <select
                  required
                  value={caseForm.patientId}
                  onChange={(e) => setCaseForm({ ...caseForm, patientId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                >
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} ({p.mrn} · {p.payerType})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Procedure Name *</label>
                <input
                  type="text"
                  required
                  value={caseForm.procedureName}
                  onChange={(e) => setCaseForm({ ...caseForm, procedureName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Theatre Room</label>
                  <select
                    value={caseForm.theatreRoom}
                    onChange={(e) => setCaseForm({ ...caseForm, theatreRoom: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  >
                    <option value="Main Theatre 1">Main Theatre 1</option>
                    <option value="Main Theatre 2">Main Theatre 2</option>
                    <option value="Endoscopy Suite">Endoscopy Suite</option>
                    <option value="Minor Procedure Room">Minor Procedure Room</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Surgical Type</label>
                  <select
                    value={caseForm.theatreType}
                    onChange={(e) => setCaseForm({ ...caseForm, theatreType: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  >
                    <option value="Major Surgery">Major Surgery</option>
                    <option value="Emergency Caesarean">Emergency Caesarean</option>
                    <option value="Minor Day Surgery">Minor Day Surgery</option>
                    <option value="Laparoscopic">Laparoscopic</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Lead Surgeon</label>
                  <input
                    type="text"
                    value={caseForm.leadSurgeon}
                    onChange={(e) => setCaseForm({ ...caseForm, leadSurgeon: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Anaesthetist</label>
                  <input
                    type="text"
                    value={caseForm.anaesthetist}
                    onChange={(e) => setCaseForm({ ...caseForm, anaesthetist: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Scheduled Start</label>
                  <input
                    type="text"
                    value={caseForm.scheduledStart}
                    onChange={(e) => setCaseForm({ ...caseForm, scheduledStart: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Estimated End</label>
                  <input
                    type="text"
                    value={caseForm.scheduledEnd}
                    onChange={(e) => setCaseForm({ ...caseForm, scheduledEnd: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsNewCaseModalOpen(false)}
                  className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800"
                >
                  Confirm Theatre Booking
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WHO SURGICAL SAFETY CHECKLIST MODAL */}
      {activeChecklistCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">WHO Surgical Safety Checklist</h3>
              <p className="text-2xs text-slate-500">
                Case: {activeChecklistCase.procedureName} · Patient: {getPatientName(activeChecklistCase.patientId)}
              </p>
            </div>

            <div className="space-y-3">
              <div className="font-semibold text-slate-900 text-2xs uppercase tracking-wider text-teal-800">
                1. Sign In (Before Induction of Anaesthesia)
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checklist.patientIdentityConfirmed}
                  onChange={(e) => setChecklist({ ...checklist, patientIdentityConfirmed: e.target.checked })}
                  className="rounded text-teal-700"
                />
                <span>Has the patient confirmed their identity, site, procedure and consent?</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checklist.siteMarked}
                  onChange={(e) => setChecklist({ ...checklist, siteMarked: e.target.checked })}
                  className="rounded text-teal-700"
                />
                <span>Is the surgical site marked?</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checklist.anaesthesiaMachineChecked}
                  onChange={(e) => setChecklist({ ...checklist, anaesthesiaMachineChecked: e.target.checked })}
                  className="rounded text-teal-700"
                />
                <span>Anaesthesia machine and medication check complete?</span>
              </label>

              <div className="font-semibold text-slate-900 text-2xs uppercase tracking-wider text-teal-800 pt-2 border-t border-slate-100">
                2. Time Out (Before Skin Incision)
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checklist.allTeamMembersIntroduced}
                  onChange={(e) => setChecklist({ ...checklist, allTeamMembersIntroduced: e.target.checked })}
                  className="rounded text-teal-700"
                />
                <span>Confirm all team members have introduced themselves by name and role</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checklist.bloodLossRiskCrossmatched}
                  onChange={(e) => setChecklist({ ...checklist, bloodLossRiskCrossmatched: e.target.checked })}
                  className="rounded text-teal-700"
                />
                <span>Surgeon, Anaesthetist & Nurse verbally confirm anticipated blood loss and crossmatched units</span>
              </label>

              <div className="font-semibold text-slate-900 text-2xs uppercase tracking-wider text-teal-800 pt-2 border-t border-slate-100">
                3. Sign Out (Before Patient Leaves Operating Room)
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checklist.spongeInstrumentCountCorrect}
                  onChange={(e) => setChecklist({ ...checklist, spongeInstrumentCountCorrect: e.target.checked })}
                  className="rounded text-teal-700"
                />
                <span>Instrument, sponge and needle counts are correct</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checklist.specimenLabelledCorrectly}
                  onChange={(e) => setChecklist({ ...checklist, specimenLabelledCorrectly: e.target.checked })}
                  className="rounded text-teal-700"
                />
                <span>Specimen is correctly labelled with patient full name and MRN</span>
              </label>
            </div>

            <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setActiveChecklistCase(null)}
                className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveChecklist}
                className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800"
              >
                Log WHO Checklist Verification
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
