import { FormField, PrimaryButton, SecondaryButton } from '../ui/controls.tsx';
import { ErrorState, StatusBadge } from '../ui/feedback.tsx';
import { Modal } from '../ui/overlays.tsx';
import { DataTable, FilterToolbar, PageHeader } from '../ui/layout.tsx';
import React, { useState, useEffect, useRef } from 'react';
import { AppointmentDiary } from './AppointmentDiary.tsx';
import { AppointmentCategoryManager } from './AppointmentCategoryManager.tsx';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { PortalInviteDialog } from '../portal/PortalInviteDialog.tsx';
import type { QueueItem, AppointmentCategory, Patient } from '../../types/index.ts';
import {
  Users,
  Clock,
  CheckCircle2,
  AlertCircle,
  PhoneCall,
  ArrowRight,
  Filter,
  Plus,
  QrCode,
} from 'lucide-react';

export const ReceptionQueueModule: React.FC = () => {
  const { currentFacility, currentTenant } = useHmis();
  const key = `${currentTenant?.id ?? 'none'}:${currentFacility?.id ?? 'none'}:${currentFacility?.timezone ?? currentTenant?.timezone ?? 'none'}`;
  return <ReceptionQueueWorkspace key={key} />;
};

const ReceptionQueueWorkspace: React.FC = () => {
  const {
    currentTenant,
    currentFacility,
    authenticatedUser,
    setActiveModule,
    setSelectedPatient,
    setIsJourneyModalOpen,
    showToast,
    refreshKey,
    triggerRefresh,
  } = useHmis();
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loadedFacilityId, setLoadedFacilityId] = useState<number | undefined>();
  const [configFacilityId, setConfigFacilityId] = useState<number | undefined>();
  const [bookingPatients, setBookingPatients] = useState<Patient[]>([]);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientSearchError, setPatientSearchError] = useState('');
  const [categories, setCategories] = useState<AppointmentCategory[]>([]);
  const [resources, setResources] = useState<{
    departments: Array<{ id: number; name: string }>;
    practitioners: Array<{ id: number; name: string; departmentId: number | null }>;
  }>({ departments: [], practitioners: [] });
  const [configurationError, setConfigurationError] = useState('');
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [searchingPatients, setSearchingPatients] = useState(false);
  const bookingKey = useRef('');
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [selectedStation, setSelectedStation] = useState<string>('All');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadAttempt, setReloadAttempt] = useState(0);

  // New Appointment Form Modal
  const [isApptModalOpen, setIsApptModalOpen] = useState(false);

  /*
   * Portal invitation state lives next to the queue it is triggered from.
   * The dialog reads the patient's portal status from the server; nothing
   * about the patient's clinical record is loaded into it.
   */
  const [portalPatient, setPortalPatient] = useState<{ id: number; name: string } | null>(null);
  const [apptForm, setApptForm] = useState({
    patientId: '',
    scheduledTime: '',
    durationMinutes: 30,
    appointmentType: '',
    categoryId: '',
    departmentId: '',
    practitionerId: '',
    priority: '',
    reason: '',
    notes: '',
  });
  // Never render a previous facility's cached records while the new scope loads.
  const visiblePatients = loadedFacilityId === currentFacility?.id ? patients : [];
  const visibleQueues = loadedFacilityId === currentFacility?.id ? queues : [];
  const visibleCategories = configFacilityId === currentFacility?.id ? categories : [];
  const visibleResources =
    configFacilityId === currentFacility?.id ? resources : { departments: [], practitioners: [] };
  const isLoading =
    loading || (!!currentFacility?.id && loadedFacilityId !== currentFacility.id && !loadError);

  useEffect(() => {
    let active = true;
    async function loadData() {
      if (!currentFacility?.id || !currentTenant?.id) {
        setQueues([]);
        setPatients([]);
        setLoadError('Select an authorized facility to load reception.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError('');
      try {
        const [qList, pList] = await Promise.all([
          api.getQueues(currentFacility.id, selectedStation),
          api.getPatients(currentTenant.id, currentFacility.id),
        ]);
        if (!active) return;
        setQueues(qList);
        setPatients(pList);
        setLoadedFacilityId(currentFacility.id);
      } catch (err) {
        if (!active) return;
        setQueues([]);
        setPatients([]);
        setLoadError(err instanceof Error ? err.message : 'Unable to load reception records.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadData();
    return () => {
      active = false;
    };
  }, [currentTenant?.id, currentFacility?.id, selectedStation, refreshKey, reloadAttempt]);

  useEffect(() => {
    let active = true;
    if (!currentFacility?.id) {
      setCategories([]);
      setResources({ departments: [], practitioners: [] });
      setConfigFacilityId(undefined);
      return;
    }
    const selectedFacility = currentFacility.id;
    setConfigurationError('');
    Promise.all([
      api.getAppointmentCategories(selectedFacility),
      api.getAppointmentResources(selectedFacility),
    ])
      .then(([list, options]) => {
        if (active) {
          setCategories(list);
          setResources(options);
          setConfigFacilityId(selectedFacility);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setCategories([]);
          setResources({ departments: [], practitioners: [] });
          setConfigurationError(
            err instanceof Error ? err.message : 'Booking configuration unavailable.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [currentFacility?.id, refreshKey, reloadAttempt]);

  const openAppointmentModal = () => {
    bookingKey.current = crypto.randomUUID();
    setBookingPatients(visiblePatients);
    setPatientSearch('');
    setPatientSearchError('');
    setBookingError('');
    setIsApptModalOpen(true);
  };
  const searchPatients = async () => {
    if (!currentFacility?.id || !currentTenant?.id) return;
    const selectedFacility = currentFacility.id;
    setSearchingPatients(true);
    setPatientSearchError('');
    try {
      const found = await api.getPatients(currentTenant.id, selectedFacility, patientSearch);
      if (!mountedRef.current) return;
      setBookingPatients(found);
      setApptForm((old) => ({
        ...old,
        patientId: found.some((p) => String(p.id) === old.patientId) ? old.patientId : '',
      }));
    } catch (error: unknown) {
      if (mountedRef.current)
        setPatientSearchError(
          error instanceof Error ? error.message : 'Patient search unavailable.',
        );
    } finally {
      if (mountedRef.current) setSearchingPatients(false);
    }
  };

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

    if (!currentFacility?.id) {
      showToast('Select a facility before saving this record.', { tone: 'warning' });
      return;
    }

    if (savingAppointment) return;
    setSavingAppointment(true);
    setBookingError('');
    try {
      await api.createAppointment(
        {
          tenantId: currentFacility.tenantId,
          facilityId: currentFacility.id,
          patientId: Number(apptForm.patientId),
          scheduledTime: apptForm.scheduledTime,
          durationMinutes: Number(apptForm.durationMinutes),
          appointmentType: apptForm.appointmentType,
          ...(apptForm.categoryId ? { categoryId: Number(apptForm.categoryId) } : {}),
          ...(apptForm.departmentId ? { departmentId: Number(apptForm.departmentId) } : {}),
          ...(apptForm.practitionerId ? { practitionerId: Number(apptForm.practitionerId) } : {}),
          ...(apptForm.priority ? { priority: apptForm.priority } : {}),
          reason: apptForm.reason,
          notes: apptForm.notes,
          status: 'Scheduled',
        },
        bookingKey.current,
      );
      if (!mountedRef.current) return;
      showToast('Appointment saved. No payment or confirmation message was processed.', {
        tone: 'success',
      });
      setIsApptModalOpen(false);
      setApptForm({
        patientId: '',
        scheduledTime: '',
        durationMinutes: 30,
        appointmentType: '',
        categoryId: '',
        departmentId: '',
        practitionerId: '',
        priority: '',
        reason: '',
        notes: '',
      });
      triggerRefresh();
    } catch (err: unknown) {
      if (mountedRef.current) setBookingError(err instanceof Error ? err.message : 'Booking failed.');
    } finally {
      if (mountedRef.current) setSavingAppointment(false);
    }
  };

  const stations = ['All', 'Triage', 'Doctor', 'Laboratory', 'Radiology', 'Pharmacy', 'Billing'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader>
        <div>
          <h1 className="ui-page-title">Reception, Queues & Appointment Navigation</h1>
          <p className="ui-page-description">
            Real-time patient flow tracking, calling station tokens, and outpatient clinic booking
            desk.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <PrimaryButton onClick={openAppointmentModal}>
            <Plus className="w-3.5 h-3.5" />
            <span>Book Appointment</span>
          </PrimaryButton>
        </div>
      </PageHeader>

      {loadError && (
        <ErrorState
          message={loadError}
          onRetry={() => setReloadAttempt((attempt) => attempt + 1)}
        />
      )}

      {configurationError && (
        <ErrorState
          message={`Appointment configuration unavailable: ${configurationError}`}
          onRetry={() => setReloadAttempt((attempt) => attempt + 1)}
        />
      )}
      {currentFacility?.id &&
        configFacilityId === currentFacility.id &&
        !configurationError &&
        (authenticatedUser?.isSuperAdmin ||
          authenticatedUser?.permissions?.includes('appointments.categories.manage')) && (
          <AppointmentCategoryManager
            key={currentFacility.id}
            facilityId={currentFacility.id}
            categories={visibleCategories}
            refresh={triggerRefresh}
          />
        )}

      {/* Queue Filter Segmented Controls */}
      <FilterToolbar>
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
      </FilterToolbar>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Live Queue Tokens (2 cols) */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-700" />
              <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase">
                Active Queue Tokens (
                {isLoading ? 'Loading…' : loadError ? 'Unavailable' : visibleQueues.length})
              </h2>
            </div>
            <span className="text-2xs text-slate-400 font-mono">Live Calling Console</span>
          </div>

          <div className="divide-y divide-slate-100 overflow-x-auto">
            <DataTable className="w-full text-xs text-left">
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
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-400 font-sans">
                      Loading queue status...
                    </td>
                  </tr>
                ) : loadError ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-rose-700">
                      Queue data unavailable.
                    </td>
                  </tr>
                ) : visibleQueues.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-400 font-sans">
                      No waiting tokens currently in {selectedStation} queue.
                    </td>
                  </tr>
                ) : (
                  visibleQueues.map((q) => {
                    const patient = visiblePatients.find((p) => p.id === q.patientId);

                    return (
                      <tr key={q.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-bold text-slate-900 text-sm">
                          {q.tokenNumber}
                        </td>
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
                          <span
                            className={`px-2 py-0.5 rounded text-2xs font-semibold ${
                              q.priority === 'Emergency'
                                ? 'bg-rose-50 text-rose-700'
                                : q.priority === 'Priority'
                                  ? 'bg-orange-50 text-orange-800 border border-orange-200'
                                  : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {q.priority}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{q.waitingTimeMinutes} mins</td>
                        <td className="px-4 py-3 font-sans">
                          <StatusBadge
                            tone={
                              q.status === 'In-Progress'
                                ? 'info'
                                : q.status === 'Called'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {q.status}
                          </StatusBadge>
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
                            {patient ? (
                              <button
                                onClick={() =>
                                  setPortalPatient({
                                    id: patient.id,
                                    name: `${patient.firstName} ${patient.lastName}`,
                                  })
                                }
                                className="px-2.5 py-1 text-2xs font-semibold text-blue-900 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors flex items-center gap-1"
                                title="Activate patient portal / send invitation"
                              >
                                <QrCode className="w-3 h-3 text-blue-600" />
                                <span>Portal</span>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </DataTable>
          </div>
        </div>

        <AppointmentDiary
          key={currentFacility?.id ?? 'none'}
          facilityId={currentFacility?.id}
          timezone={currentFacility?.timezone ?? currentTenant?.timezone ?? null}
          patients={visiblePatients}
          categories={visibleCategories}
          practitioners={visibleResources.practitioners}
          refreshKey={refreshKey}
          triggerRefresh={triggerRefresh}
          permissions={authenticatedUser?.permissions ?? []}
          isSuperAdmin={authenticatedUser?.isSuperAdmin}
          showToast={showToast}
        />
      </div>

      {portalPatient ? (
        <PortalInviteDialog
          patientId={portalPatient.id}
          patientName={portalPatient.name}
          open
          onClose={() => setPortalPatient(null)}
          onChanged={() => triggerRefresh()}
        />
      ) : null}

      {/* Appointment Booking Modal */}
      <Modal
        open={isApptModalOpen}
        onClose={() => {
          if (!savingAppointment) setIsApptModalOpen(false);
        }}
        closeOnBackdrop={!savingAppointment}
        closeOnEscape={!savingAppointment}
        title="Schedule Patient Clinic Appointment"
        actions={
          <>
            <SecondaryButton disabled={savingAppointment} onClick={() => setIsApptModalOpen(false)}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" form="appointment-form" disabled={savingAppointment}>
              {savingAppointment ? 'Saving…' : 'Confirm Booking'}
            </PrimaryButton>
          </>
        }
      >
        <p className="mb-4 text-xs text-muted">
          This saves an appointment only. Verify availability separately; no treatment, charge,
          payment or message is recorded.
        </p>
        {configurationError && (
          <p role="alert" className="mb-3 text-xs text-rose-700">
            Booking categories and staff options unavailable: {configurationError}
          </p>
        )}
        <form id="appointment-form" onSubmit={handleCreateAppointment} className="space-y-4">
          <FormField
            label="Search registered patients"
            htmlFor="appointment-patient-search"
            hint="Search within this facility, then select the matching patient. Search returns up to 50 results."
          >
            <div className="flex gap-2">
              <input
                id="appointment-patient-search"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                className="w-full border rounded px-2 py-1"
              />
              <SecondaryButton
                type="button"
                disabled={searchingPatients}
                onClick={() => void searchPatients()}
              >
                {searchingPatients ? 'Searching…' : 'Search'}
              </SecondaryButton>
            </div>
          </FormField>
          {patientSearchError && (
            <p role="alert" className="text-rose-700">
              {patientSearchError}
            </p>
          )}
          <button
            type="button"
            className="text-xs text-blue-800 underline"
            onClick={() => {
              setIsApptModalOpen(false);
              setActiveModule('registration');
            }}
          >
            Register a new patient
          </button>
          <FormField label="Select patient *" htmlFor="appointment-patient">
            <select
              id="appointment-patient"
              required
              value={apptForm.patientId}
              onChange={(e) => setApptForm({ ...apptForm, patientId: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-600"
            >
              <option value="">Select a patient</option>
              {bookingPatients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName} ({p.mrn}
                  {p.phone ? ` · ${p.phone}` : ''})
                </option>
              ))}
            </select>
          </FormField>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              label="Date & time *"
              htmlFor="appointment-time"
              hint="Use YYYY-MM-DD HH:MM."
            >
              <input
                id="appointment-time"
                aria-describedby="appointment-time-hint"
                type="text"
                required
                value={apptForm.scheduledTime}
                onChange={(e) => setApptForm({ ...apptForm, scheduledTime: e.target.value })}
                placeholder="YYYY-MM-DD HH:MM"
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </FormField>
            <FormField label="Duration (minutes)" htmlFor="appointment-duration">
              <input
                id="appointment-duration"
                type="number"
                value={apptForm.durationMinutes}
                onChange={(e) =>
                  setApptForm({ ...apptForm, durationMinutes: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </FormField>
          </div>

          <FormField
            label="Facility category"
            htmlFor="appointment-category"
            hint="Optional; configured categories may reference an existing facility service, but booking does not charge it."
          >
            <select
              id="appointment-category"
              value={apptForm.categoryId}
              onChange={(e) => setApptForm({ ...apptForm, categoryId: e.target.value })}
              className="w-full px-3 py-2 border rounded"
            >
              <option value="">Use the appointment type below</option>
              {visibleCategories
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </FormField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Department" htmlFor="appointment-department">
              <select
                id="appointment-department"
                value={apptForm.departmentId}
                onChange={(e) => setApptForm({ ...apptForm, departmentId: e.target.value })}
                className="w-full border rounded p-2"
              >
                <option value="">Not assigned</option>
                {visibleResources.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              label="Practitioner"
              htmlFor="appointment-practitioner"
              hint="Active in the facility; verify credentials separately."
            >
              <select
                id="appointment-practitioner"
                value={apptForm.practitionerId}
                onChange={(e) => setApptForm({ ...apptForm, practitionerId: e.target.value })}
                className="w-full border rounded p-2"
              >
                <option value="">Not assigned</option>
                {visibleResources.practitioners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField label="Priority" htmlFor="appointment-priority">
            <select
              id="appointment-priority"
              value={apptForm.priority}
              onChange={(e) => setApptForm({ ...apptForm, priority: e.target.value })}
              className="w-full border rounded p-2"
            >
              <option value="">Not assigned</option>
              <option>Normal</option>
              <option>Priority</option>
              <option>Urgent</option>
            </select>
          </FormField>
          <FormField
            label="Appointment type"
            htmlFor="appointment-type"
            hint={
              apptForm.categoryId
                ? 'The selected facility category will be saved instead.'
                : 'Choose a type if no facility category is selected.'
            }
          >
            <select
              id="appointment-type"
              required={!apptForm.categoryId}
              value={apptForm.appointmentType}
              onChange={(e) => setApptForm({ ...apptForm, appointmentType: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-md"
            >
              <option value="">Select a type</option>
              <option value="Specialist Consultation">Specialist Consultation</option>
              <option value="OPD">OPD</option>
              <option value="Laboratory">Laboratory</option>
              <option value="Imaging">Imaging</option>
              <option value="Maternity / ANC">Maternity / ANC</option>
              <option value="Postnatal / MCH">Postnatal / MCH</option>
              <option value="Procedure">Procedure</option>
              <option value="Dialysis consultation">
                Dialysis consultation (does not reserve a machine)
              </option>
              <option value="Routine Chronic Follow-up">
                Routine Chronic Follow-up (Hypertension/Diabetes)
              </option>
              <option value="Antenatal Care (ANC)">Antenatal Care (ANC Clinic)</option>
              <option value="Post-Op Review">Post-Op Review</option>
              <option value="Dental Checkup">Dental Checkup</option>
              <option value="Eye Examination">Eye Examination</option>
            </select>
          </FormField>

          <FormField label="Clinical indication / reason" htmlFor="appointment-reason">
            <input
              id="appointment-reason"
              type="text"
              value={apptForm.reason}
              onChange={(e) => setApptForm({ ...apptForm, reason: e.target.value })}
              placeholder="Enter a reason if applicable"
              className="w-full px-3 py-2 border border-slate-200 rounded-md"
            />
          </FormField>
          <FormField label="Notes" htmlFor="appointment-notes">
            <textarea
              id="appointment-notes"
              maxLength={10000}
              value={apptForm.notes}
              onChange={(e) => setApptForm({ ...apptForm, notes: e.target.value })}
              className="w-full border rounded p-2"
            />
          </FormField>
          {bookingError && (
            <p role="alert" className="text-rose-700">
              {bookingError}
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
};
