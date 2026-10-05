import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { QueueItem, Appointment, Patient } from '../../types/index.ts';
import {
  Users,
  Clock,
  CheckCircle2,
  Calendar,
  AlertCircle,
  PhoneCall,
  ArrowRight,
  Filter,
  Plus
} from 'lucide-react';

export const ReceptionQueueModule: React.FC = () => {
  const { currentFacility, setSelectedPatient, setIsJourneyModalOpen, showToast, refreshKey, triggerRefresh } = useHmis();
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedStation, setSelectedStation] = useState<string>('All');
  const [loading, setLoading] = useState(true);

  // New Appointment Form Modal
  const [isApptModalOpen, setIsApptModalOpen] = useState(false);
  const [apptForm, setApptForm] = useState({
    patientId: '',
    scheduledTime: '2026-10-06 10:00',
    durationMinutes: 30,
    appointmentType: 'Specialist Consultation',
    reason: 'Follow-up on hypertension management',
    notes: 'Bring previous lab slips and medications',
  });

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [qList, aList, pList] = await Promise.all([
          api.getQueues(currentFacility?.id, selectedStation),
          api.getAppointments(currentFacility?.id),
          api.getPatients(undefined, currentFacility?.id),
        ]);
        setQueues(qList);
        setAppointments(aList);
        setPatients(pList);
        if (pList.length > 0 && !apptForm.patientId) {
          setApptForm(prev => ({ ...prev, patientId: pList[0].id.toString() }));
        }
      } catch (err) {
        console.error('Failed to load reception queues:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [currentFacility, selectedStation, refreshKey]);

  const updateStatus = async (id: number, status: string) => {
    try {
      await api.updateQueueStatus(id, status);
      showToast(`Token status updated to "${status}"`);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Failed: ${err.message}`);
    }
  };

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apptForm.patientId) return;

    try {
      await api.createAppointment({
        tenantId: currentFacility?.tenantId || 1,
        facilityId: currentFacility?.id || 1,
        patientId: Number(apptForm.patientId),
        scheduledTime: apptForm.scheduledTime,
        durationMinutes: Number(apptForm.durationMinutes),
        appointmentType: apptForm.appointmentType,
        reason: apptForm.reason,
        notes: apptForm.notes,
        status: 'Scheduled',
      });
      showToast('Appointment booked successfully!');
      setIsApptModalOpen(false);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Booking failed: ${err.message}`);
    }
  };

  const getPatientName = (patientId: number) => {
    const p = patients.find(x => x.id === patientId);
    return p ? `${p.firstName} ${p.lastName}` : `Patient #${patientId}`;
  };

  const stations = ['All', 'Triage', 'Doctor', 'Laboratory', 'Radiology', 'Pharmacy', 'Billing'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Reception, Queues & Appointment Navigation</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time patient flow tracking, calling station tokens, and outpatient clinic booking desk.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsApptModalOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-700 active:bg-orange-800 rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Book Appointment</span>
          </button>
        </div>
      </div>

      {/* Queue Filter Segmented Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-600 px-2 flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span>Station Filter:</span>
        </span>
        {stations.map((st) => (
          <button
            key={st}
            onClick={() => setSelectedStation(st)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              selectedStation === st
                ? 'bg-blue-700 text-white shadow-xs font-semibold'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {st}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Live Queue Tokens (2 cols) */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-700" />
              <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase">
                Active Queue Tokens ({queues.length})
              </h2>
            </div>
            <span className="text-2xs text-slate-400 font-mono">Live Calling Console</span>
          </div>

          <div className="divide-y divide-slate-100 overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Token #</th>
                  <th className="px-4 py-2.5 font-medium">Patient Details</th>
                  <th className="px-4 py-2.5 font-medium">Station</th>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 font-medium">Wait</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Workflow Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-400 font-sans">
                      Loading queue status...
                    </td>
                  </tr>
                ) : queues.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-400 font-sans">
                      No waiting tokens currently in {selectedStation} queue.
                    </td>
                  </tr>
                ) : (
                  queues.map((q) => {
                    const patient = patients.find(p => p.id === q.patientId);

                    return (
                      <tr key={q.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-bold text-slate-900 text-sm">{q.tokenNumber}</td>
                        <td className="px-4 py-3 font-sans">
                          {patient ? (
                            <button
                              onClick={() => {
                                setSelectedPatient(patient);
                                setIsJourneyModalOpen(true);
                              }}
                              className="font-semibold text-slate-900 hover:text-blue-700 text-left block"
                            >
                              {patient.firstName} {patient.lastName}
                            </button>
                          ) : (
                            <span className="text-slate-500">Patient #{q.patientId}</span>
                          )}
                          <span className="text-2xs text-slate-400 font-mono">{patient?.mrn}</span>
                        </td>
                        <td className="px-4 py-3 font-sans font-medium text-slate-700">
                          {q.queueType} Desk
                        </td>
                        <td className="px-4 py-3 font-sans">
                          <span className={`px-2 py-0.5 rounded text-2xs font-semibold ${
                            q.priority === 'Emergency'
                              ? 'bg-rose-50 text-rose-700'
                              : q.priority === 'Priority'
                              ? 'bg-orange-50 text-orange-800 border border-orange-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}>
                            {q.priority}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{q.waitingTimeMinutes} mins</td>
                        <td className="px-4 py-3 font-sans">
                          <span className={`px-2 py-0.5 rounded text-2xs font-medium ${
                            q.status === 'In-Progress'
                              ? 'bg-blue-50 text-blue-900 border border-blue-200'
                              : q.status === 'Called'
                              ? 'bg-orange-50 text-orange-900 border border-orange-200 font-semibold'
                              : 'bg-slate-100 text-slate-700'
                          }`}>
                            {q.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-sans">
                          <div className="flex items-center justify-end gap-1.5">
                            {q.status === 'Waiting' && (
                              <button
                                onClick={() => updateStatus(q.id, 'Called')}
                                className="px-2.5 py-1 text-2xs font-semibold text-orange-900 bg-orange-50 border border-orange-200 rounded hover:bg-orange-100 transition-colors flex items-center gap-1 shadow-2xs"
                              >
                                <PhoneCall className="w-3 h-3 text-orange-600" />
                                <span>Call</span>
                              </button>
                            )}
                            {q.status === 'Called' && (
                              <button
                                onClick={() => updateStatus(q.id, 'In-Progress')}
                                className="px-2.5 py-1 text-2xs font-semibold text-blue-900 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                              >
                                Start
                              </button>
                            )}
                            {q.status === 'In-Progress' && (
                              <button
                                onClick={() => updateStatus(q.id, 'Completed')}
                                className="px-2.5 py-1 text-2xs font-semibold text-emerald-800 bg-emerald-50 rounded hover:bg-emerald-100 transition-colors flex items-center gap-1"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Done</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Scheduled Appointments (1 col) */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-orange-600" />
              <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase">
                Upcoming Appointments ({appointments.length})
              </h2>
            </div>
            <button
              onClick={() => setIsApptModalOpen(true)}
              className="text-2xs text-blue-700 font-semibold hover:text-blue-900"
            >
              + New
            </button>
          </div>

          <div className="p-4 space-y-3 flex-1 overflow-y-auto">
            {appointments.length === 0 ? (
              <div className="text-center py-10 text-xs text-slate-400">
                No scheduled clinic appointments.
              </div>
            ) : (
              appointments.map((appt) => (
                <div key={appt.id} className="p-3 border border-slate-200 rounded-lg bg-slate-50/50 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{getPatientName(appt.patientId)}</span>
                    <span className="font-mono text-2xs text-blue-900 font-bold bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                      {appt.scheduledTime}
                    </span>
                  </div>
                  <div className="text-2xs text-slate-600">
                    Type: <strong className="text-slate-800">{appt.appointmentType}</strong> ({appt.durationMinutes} mins)
                  </div>
                  {appt.reason && (
                    <div className="text-2xs text-slate-500 italic">
                      "{appt.reason}"
                    </div>
                  )}
                  <div className="pt-2 flex items-center justify-between border-t border-slate-200/60">
                    <span className="text-2xs text-slate-400">Status: {appt.status}</span>
                    <button
                      onClick={() => {
                        const pat = patients.find(p => p.id === appt.patientId);
                        if (pat) {
                          api.createQueueItem({
                            tenantId: pat.tenantId,
                            facilityId: pat.facilityId,
                            patientId: pat.id,
                            queueType: 'Doctor',
                            tokenNumber: `APPT-${Math.floor(100 + Math.random() * 900)}`,
                            priority: 'Priority',
                            status: 'Waiting',
                            waitingTimeMinutes: 0,
                          }).then(() => {
                            showToast(`Patient checked in and queued for doctor!`);
                            triggerRefresh();
                          });
                        }
                      }}
                      className="px-2 py-0.5 text-2xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                    >
                      Check-In Patient
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Appointment Booking Modal */}
      {isApptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Schedule Patient Clinic Appointment</h3>
              <p className="text-2xs text-slate-500">Book clinic slots for follow-up or specialty consultations.</p>
            </div>

            <form onSubmit={handleCreateAppointment} className="space-y-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Select Patient *</label>
                <select
                  required
                  value={apptForm.patientId}
                  onChange={(e) => setApptForm({ ...apptForm, patientId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-600"
                >
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} ({p.mrn} · {p.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Date & Time *</label>
                  <input
                    type="text"
                    required
                    value={apptForm.scheduledTime}
                    onChange={(e) => setApptForm({ ...apptForm, scheduledTime: e.target.value })}
                    placeholder="YYYY-MM-DD HH:MM"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Duration (Mins)</label>
                  <input
                    type="number"
                    value={apptForm.durationMinutes}
                    onChange={(e) => setApptForm({ ...apptForm, durationMinutes: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Appointment Type</label>
                <select
                  value={apptForm.appointmentType}
                  onChange={(e) => setApptForm({ ...apptForm, appointmentType: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                >
                  <option value="Specialist Consultation">Specialist Consultation</option>
                  <option value="Routine Chronic Follow-up">Routine Chronic Follow-up (Hypertension/Diabetes)</option>
                  <option value="Antenatal Care (ANC)">Antenatal Care (ANC Clinic)</option>
                  <option value="Post-Op Review">Post-Op Review</option>
                  <option value="Dental Checkup">Dental Checkup</option>
                  <option value="Eye Examination">Eye Examination</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Clinical Indication / Reason</label>
                <input
                  type="text"
                  value={apptForm.reason}
                  onChange={(e) => setApptForm({ ...apptForm, reason: e.target.value })}
                  placeholder="e.g. 3-month HbA1c review"
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsApptModalOpen(false)}
                  className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-700 text-white rounded-md font-semibold hover:bg-blue-800"
                >
                  Confirm Booking
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
