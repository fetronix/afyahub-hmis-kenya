import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { Ward, Bed, Admission, Patient, InpatientBoard } from '../../types/index.ts';
import { NursingPanel } from './NursingPanel.tsx';
import {
  BedDouble,
  UserCheck,
  Plus,
  CheckCircle2,
  Clock,
  LogOut,
  AlertCircle,
  FileText,
  Pencil,
  Trash2,
  Archive,
  ArchiveRestore,
  Building2,
} from 'lucide-react';

/*
 * Common Kenyan ward and bed labels, offered so they are one click away
 * rather than retyped. The server accepts any short label.
 */
const WARD_TYPE_OPTIONS = [
  'General',
  'Medical',
  'Surgical',
  'Maternity',
  'Paediatric',
  'ICU/HDU',
  'Isolation',
  'Recovery',
];

const BED_TYPE_OPTIONS = [
  'Standard',
  'Fowler Electric Bed',
  'ICU Ventilated Unit',
  'Cot',
  'Isolation Bed',
];

const EMPTY_WARD_FORM = {
  id: null as number | null,
  name: '',
  code: '',
  wardType: 'General',
  genderAllocation: 'Mixed',
  dailyRate: '',
};

const EMPTY_BEDS_FORM = {
  prefix: '',
  startNumber: '1',
  count: '1',
  bedType: 'Standard',
  dailyCharge: '',
};

export const InpatientModule: React.FC = () => {
  const { currentTenant, currentFacility, currentUser, authenticatedUser, setSelectedPatient, setIsJourneyModalOpen, showToast, refreshKey, triggerRefresh } = useHmis();

  /*
   * Buttons are hidden from users who cannot use them. This is courtesy,
   * not security: every one of these calls is checked again on the
   * server against the same permission code.
   */
  const permissions = new Set(authenticatedUser?.permissions ?? []);
  const isSuperAdmin =
    authenticatedUser?.isSuperAdmin === true ||
    (authenticatedUser?.roles ?? []).includes('SUPER_ADMIN');

  const can = (permission: string) =>
    isSuperAdmin || permissions.has(permission);

  const canCreateWard = can('inpatient.wards.create');
  const canUpdateWard = can('inpatient.wards.update');
  const canDeleteWard = can('inpatient.wards.delete');
  const canCreateBeds = can('inpatient.beds.create');
  const canUpdateBed = can('inpatient.beds.update');
  const canDeleteBed = can('inpatient.beds.delete');
  const canAdmit = can('inpatient.admit');
  const [wards, setWards] = useState<Ward[]>([]);
  const [selectedWard, setSelectedWard] = useState<Ward | null>(null);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [board, setBoard] = useState<InpatientBoard | null>(null);
  const [loading, setLoading] = useState(true);

  // New Admission Modal
  const [isAdmitModalOpen, setIsAdmitModalOpen] = useState(false);
  const [admitForm, setAdmitForm] = useState({
    patientId: '',
    wardId: '',
    bedId: '',
    admissionDate: new Date().toISOString().slice(0, 16).replace('T', ' '),
    admissionType: 'Emergency',
    /*
     * Empty on purpose. These were pre-filled with a diagnosis and a
     * treatment plan that no clinician had entered, so an admission
     * could be saved asserting a condition the patient did not have.
     */
    provisionalDiagnosis: '',
    nursingNotes: '',
  });

  /* ---------------- ward and bed set-up ---------------- */
  const [wardFormOpen, setWardFormOpen] = useState(false);
  const [wardForm, setWardForm] = useState(EMPTY_WARD_FORM);
  const [bedsFormOpen, setBedsFormOpen] = useState(false);
  const [bedsForm, setBedsForm] = useState(EMPTY_BEDS_FORM);
  const [bedEditTarget, setBedEditTarget] = useState<Bed | null>(null);
  const [bedEdit, setBedEdit] = useState({
    bedNumber: '',
    bedType: 'Standard',
    dailyCharge: '',
    status: 'Available',
  });
  const [setupBusy, setSetupBusy] = useState(false);

  // Discharge Modal
  const [dischargeTarget, setDischargeTarget] = useState<Admission | null>(null);
  const [dischargeSummary, setDischargeSummary] = useState('');
  const [dischargeType, setDischargeType] = useState('Routine Discharge');

  useEffect(() => {
    async function loadInpatient() {
      setLoading(true);
      try {
        // One facility-scoped bed set drives the board, the roster and
        // the admit modal. Scope is enforced server-side.
        const [wList, aList, pList, bList, boardData] = await Promise.all([
          api.getWards(currentFacility?.id),
          api.getAdmissions(currentFacility?.id, 'Admitted'),
          api.getPatients(currentTenant?.id, currentFacility?.id),
          api.getBeds(),
          // Board is optional: a failure must not hide the ward itself.
          api.getInpatientBoard(currentFacility?.id).catch(() => null),
        ]);
        setWards(wList);
        setAdmissions(aList);
        setPatients(pList);
        setBeds(bList);
        setBoard(boardData);

        /*
         * Keep the selected ward pointing at the freshly loaded row, so
         * its capacity and rate are not a stale copy after a bed change.
         */
        setSelectedWard((previous) => {
          if (previous) {
            return wList.find((ward) => ward.id === previous.id) ?? wList[0] ?? null;
          }

          return wList[0] ?? null;
        });
      } catch (err) {
        console.error('Failed to load inpatient data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadInpatient();
  }, [currentTenant, currentFacility, refreshKey]);

  const handleSelectWard = (ward: Ward) => {
    setSelectedWard(ward);
  };

  /**
   * Return a terminal-cleaned bed to service.
   */
  const handleReleaseBed = async (bed: Bed) => {
    try {
      await api.releaseBed(bed.id);
      showToast(`Bed ${bed.bedNumber} released to Available.`);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Bed release error: ${err.message}`);
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
        // Tenant and facility scope are assigned server-side from the
        // authenticated session; facilityId is only a request hint.
        facilityId: currentFacility?.id,
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

  /* ============================================================
     WARD AND BED SET-UP
     ============================================================ */

  const numberText = (value: string) => {
    const trimmed = value.trim();

    return trimmed === '' ? undefined : Number(trimmed);
  };

  const openWardForm = (ward?: Ward) => {
    setWardForm(
      ward
        ? {
            id: ward.id,
            name: ward.name,
            code: ward.code,
            wardType: ward.wardType,
            genderAllocation: ward.genderAllocation,
            dailyRate: ward.dailyRate === null ? '' : String(ward.dailyRate),
          }
        : EMPTY_WARD_FORM,
    );

    setWardFormOpen(true);
  };

  const handleSubmitWard = async (event: React.FormEvent) => {
    event.preventDefault();
    setSetupBusy(true);

    try {
      if (wardForm.id === null) {
        const created = await api.createWard({
          facilityId: currentFacility?.id,
          name: wardForm.name.trim(),
          code: wardForm.code.trim().toUpperCase(),
          wardType: wardForm.wardType.trim(),
          genderAllocation: wardForm.genderAllocation,
          // Blank means "not priced", which the server stores as NULL.
          dailyRate: wardForm.dailyRate.trim() === '' ? null : wardForm.dailyRate.trim(),
        });

        showToast(`Ward ${created.code} created. Add its beds next.`);
        setSelectedWard(created);
      } else {
        const updated = await api.updateWard(wardForm.id, {
          name: wardForm.name.trim(),
          wardType: wardForm.wardType.trim(),
          genderAllocation: wardForm.genderAllocation,
          dailyRate: wardForm.dailyRate.trim() === '' ? null : wardForm.dailyRate.trim(),
        });

        showToast(`Ward ${updated.code} updated.`);

        if (selectedWard?.id === updated.id) setSelectedWard(updated);
      }

      setWardFormOpen(false);
      setWardForm(EMPTY_WARD_FORM);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Ward: ${err.message}`);
    } finally {
      setSetupBusy(false);
    }
  };

  const handleToggleWardActive = async (ward: Ward) => {
    setSetupBusy(true);

    try {
      const updated = await api.updateWard(ward.id, {
        isActive: ward.isActive === false,
      });

      showToast(
        updated.isActive === false
          ? `Ward ${updated.code} retired. It stays in the history and no longer accepts admissions.`
          : `Ward ${updated.code} reactivated.`,
      );

      if (selectedWard?.id === updated.id) setSelectedWard(updated);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Ward: ${err.message}`);
    } finally {
      setSetupBusy(false);
    }
  };

  const handleDeleteWard = async (ward: Ward) => {
    if (
      !window.confirm(
        `Delete ward ${ward.code} — ${ward.name}? This is only allowed if the ward has never held a patient.`,
      )
    ) {
      return;
    }

    setSetupBusy(true);

    try {
      await api.deleteWard(ward.id);
      showToast(`Ward ${ward.code} deleted.`);
      setSelectedWard(null);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Ward: ${err.message}`);
    } finally {
      setSetupBusy(false);
    }
  };

  const handleSubmitBeds = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selectedWard) {
      showToast('Select a ward first.');
      return;
    }

    setSetupBusy(true);

    try {
      const result = await api.createBeds({
        wardId: selectedWard.id,
        prefix: bedsForm.prefix.trim().toUpperCase(),
        startNumber: numberText(bedsForm.startNumber),
        count: numberText(bedsForm.count),
        bedType: bedsForm.bedType.trim(),
        dailyCharge:
          bedsForm.dailyCharge.trim() === '' ? null : bedsForm.dailyCharge.trim(),
      });

      showToast(`Added ${result.created.length} bed(s) to ${selectedWard.name}.`);
      setBedsFormOpen(false);
      setBedsForm(EMPTY_BEDS_FORM);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Beds: ${err.message}`);
    } finally {
      setSetupBusy(false);
    }
  };

  const openBedEdit = (bed: Bed) => {
    setBedEditTarget(bed);
    setBedEdit({
      bedNumber: bed.bedNumber,
      bedType: bed.bedType,
      dailyCharge: bed.dailyCharge === null ? '' : String(bed.dailyCharge),
      status: bed.status,
    });
  };

  const handleSubmitBedEdit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!bedEditTarget) return;

    setSetupBusy(true);

    try {
      await api.updateBed(bedEditTarget.id, {
        bedNumber: bedEdit.bedNumber.trim(),
        bedType: bedEdit.bedType.trim(),
        dailyCharge:
          bedEdit.dailyCharge.trim() === '' ? null : bedEdit.dailyCharge.trim(),
        // Occupancy is set by admitting, never by this form.
        ...(bedEditTarget.status !== 'Occupied' ? { status: bedEdit.status } : {}),
      });

      showToast(`Bed ${bedEdit.bedNumber} updated.`);
      setBedEditTarget(null);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Bed: ${err.message}`);
    } finally {
      setSetupBusy(false);
    }
  };

  const handleDeleteBed = async (bed: Bed) => {
    if (
      !window.confirm(
        `Delete bed ${bed.bedNumber}? This is only allowed if the bed has never held a patient.`,
      )
    ) {
      return;
    }

    setSetupBusy(true);

    try {
      await api.deleteBed(bed.id);
      showToast(`Bed ${bed.bedNumber} deleted.`);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Bed: ${err.message}`);
    } finally {
      setSetupBusy(false);
    }
  };

  const handleDischarge = async () => {
    if (!dischargeTarget) return;

    try {
      // The bed is released server-side from the admission record, so a
      // client-supplied bedId is neither needed nor trusted.
      await api.dischargePatient(dischargeTarget.id, {
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

  /*
   * A retired ward accepts no new admissions, and a bed that is not
   * 'Available' cannot take one either — the server enforces both, so
   * offering them here only produced a refusal after the form was filled.
   */
  const activeWards = wards.filter((w) => w.isActive !== false);

  const availableBedsForForm = beds.filter(
    (b) => b.wardId === Number(admitForm.wardId) && b.status === 'Available',
  );

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

        <div className="flex flex-wrap items-center gap-2">
          {canCreateWard && (
            <button
              onClick={() => openWardForm()}
              className="px-3.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Add Ward</span>
            </button>
          )}

          {canCreateBeds && selectedWard && (
            <button
              onClick={() => setBedsFormOpen(true)}
              className="px-3.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
            >
              <BedDouble className="w-3.5 h-3.5" />
              <span>Add Beds to {selectedWard.code}</span>
            </button>
          )}

          <button
            onClick={() => {
              const activeWards = wards.filter(w => w.isActive !== false);

              if (activeWards.length > 0) {
                const firstWardBeds = beds.filter(b => b.wardId === activeWards[0].id);
                const firstAvailable = firstWardBeds.find(b => b.status === 'Available');

                setAdmitForm(prev => ({
                  ...prev,
                  wardId: activeWards[0].id.toString(),
                  patientId: patients[0]?.id.toString() || '',
                  bedId: firstAvailable ? firstAvailable.id.toString() : '',
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
        {wards.length === 0 && (
          <span className="text-xs text-slate-500">
            No wards have been set up for this facility yet.
          </span>
        )}

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
            {w.isActive === false && (
              <span className="ml-1.5 text-3xs uppercase tracking-wider opacity-70">retired</span>
            )}
          </button>
        ))}
      </div>

      {/*
        The state that brought the user here: a facility with no wards has
        an empty dropdown and no obvious way out of it.
      */}
      {!loading && wards.length === 0 && (
        <div className="bg-white border border-dashed border-teal-300 rounded-xl p-6 text-center space-y-2">
          <Building2 className="w-6 h-6 text-teal-700 mx-auto" />
          <h2 className="text-sm font-bold text-slate-900">No wards yet</h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            A patient cannot be admitted until at least one ward exists, and a
            ward cannot take patients until it has beds. Create the ward first,
            then add its beds.
          </p>
          {canCreateWard ? (
            <button
              onClick={() => openWardForm()}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create the first ward</span>
            </button>
          ) : (
            <p className="text-2xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block">
              You do not have the <span className="font-mono">inpatient.wards.create</span>{' '}
              permission. Ask a facility administrator to grant it under
              Administration → Roles, or to create the ward for you.
            </p>
          )}
        </div>
      )}

      {/* Visual Bed Grid */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col gap-2 border-b border-slate-100 pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              {selectedWard ? `${selectedWard.name} — Live Bed Board` : 'Live Bed Board'}
            </h2>
            <span className="text-2xs text-slate-500">
              {selectedWard ? (
                <>
                  Type: {selectedWard.wardType} · Allocation: {selectedWard.genderAllocation} · Daily rate:{' '}
                  {selectedWard.dailyRate === null
                    ? 'not set'
                    : `KES ${Number(selectedWard.dailyRate).toLocaleString()} / day`}
                  {selectedWard.isActive === false && ' · retired'}
                </>
              ) : (
                'Select a ward above.'
              )}
            </span>
          </div>

          {selectedWard && (
            <div className="flex flex-wrap items-center gap-1.5">
              {canCreateBeds && (
                <button
                  onClick={() => setBedsFormOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-2xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="w-3 h-3" /> Add beds
                </button>
              )}

              {canUpdateWard && (
                <button
                  onClick={() => openWardForm(selectedWard)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-2xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Pencil className="w-3 h-3" /> Edit ward
                </button>
              )}

              {canUpdateWard && (
                <button
                  onClick={() => void handleToggleWardActive(selectedWard)}
                  disabled={setupBusy}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-2xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  {selectedWard.isActive === false ? (
                    <>
                      <ArchiveRestore className="w-3 h-3" /> Reactivate
                    </>
                  ) : (
                    <>
                      <Archive className="w-3 h-3" /> Retire
                    </>
                  )}
                </button>
              )}

              {canDeleteWard && (
                <button
                  onClick={() => void handleDeleteWard(selectedWard)}
                  disabled={setupBusy}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-2xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" /> Delete ward
                </button>
              )}
            </div>
          )}

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
          {selectedWard &&
            beds.filter((b) => b.wardId === selectedWard.id).length === 0 && (
              <div className="col-span-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center">
                <p className="text-xs text-slate-600">
                  This ward has no beds yet, so nobody can be admitted here.
                </p>
                {canCreateBeds ? (
                  <button
                    onClick={() => setBedsFormOpen(true)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-2xs font-semibold text-white hover:bg-teal-800"
                  >
                    <Plus className="w-3 h-3" /> Add the first beds
                  </button>
                ) : (
                  <p className="mt-2 text-2xs text-amber-800">
                    Adding beds needs <span className="font-mono">inpatient.beds.create</span>.
                  </p>
                )}
              </div>
            )}

          {beds.filter((b) => b.wardId === selectedWard?.id).map((b) => {
            const isOccupied = b.status === 'Occupied';
            const isCleaning = b.status === 'Cleaning';
            const occupant = b.currentPatientId ? patients.find(p => p.id === b.currentPatientId) : null;

            // Vitals status for this bed, from the facility board.
            const bedBoard = board?.rows.find((row) => row.bedId === b.id);
            const hasCritical = (bedBoard?.lastVitalsFlags ?? []).some(
              (flag) => flag.severity === 'critical',
            );
            const vitalsOverdue = Boolean(bedBoard?.vitalsOverdue);

            return (
              <div
                key={b.id}
                className={`relative p-3 rounded-xl border text-center transition-all flex flex-col justify-between ${
                  isOccupied
                    ? 'border-teal-700 bg-teal-50/40 text-teal-950'
                    : isCleaning
                    ? 'border-amber-400 bg-amber-50/50 text-amber-900'
                    : 'border-slate-200 bg-white hover:border-emerald-500 text-slate-700'
                }`}
              >
                {(canUpdateBed || (canDeleteBed && !isOccupied)) && (
                  <div className="absolute right-1 top-1 flex items-center gap-0.5">
                    {canUpdateBed && (
                      <button
                        onClick={() => openBedEdit(b)}
                        title={`Edit bed ${b.bedNumber}`}
                        className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    {canDeleteBed && !isOccupied && (
                      <button
                        onClick={() => void handleDeleteBed(b)}
                        title={`Delete bed ${b.bedNumber}`}
                        className="rounded p-1 text-slate-400 hover:bg-white hover:text-rose-700"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <BedDouble className={`w-4 h-4 ${isOccupied ? 'text-teal-700' : isCleaning ? 'text-amber-600' : 'text-emerald-600'}`} />
                  </div>
                  <div className="font-mono font-bold text-xs">{b.bedNumber}</div>
                  <div className="text-3xs text-slate-400 truncate">{b.bedType}</div>
                </div>

                {bedBoard && (
                  <div className="mt-1">
                    <span
                      className={`text-3xs font-semibold px-1 py-0.5 rounded ${
                        hasCritical
                          ? 'bg-rose-600 text-white'
                          : vitalsOverdue
                            ? 'bg-orange-100 text-orange-900'
                            : 'bg-emerald-50 text-emerald-800'
                      }`}
                      title={
                        bedBoard.lastVitalsAt
                          ? `Last vitals ${new Date(bedBoard.lastVitalsAt).toLocaleString()}`
                          : 'No vitals recorded'
                      }
                    >
                      {hasCritical
                        ? '⚠ CRITICAL'
                        : vitalsOverdue
                          ? 'Vitals due'
                          : 'Vitals ok'}
                    </span>
                  </div>
                )}

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
                  ) : isCleaning ? (
                    <button
                      onClick={() => handleReleaseBed(b)}
                      title="Terminal cleaning complete — return bed to service"
                      className="w-full text-3xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded px-1.5 py-1 transition-colors truncate"
                    >
                      Mark Clean → Available
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

            {activeWards.length === 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-2xs text-amber-900">
                This facility has no active ward, so there is nowhere to admit a
                patient. {canCreateWard
                  ? 'Close this dialog and use “Add Ward” on the board.'
                  : 'Ask a facility administrator to create a ward.'}
              </div>
            )}

            {activeWards.length > 0 && availableBedsForForm.length === 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-2xs text-amber-900">
                The selected ward has no available bed. Add beds to it, or choose
                another ward.
              </div>
            )}

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
                      const wardBeds = beds.filter(b => b.wardId === Number(wid));
                      const avail = wardBeds.find(x => x.status === 'Available');
                      setAdmitForm(prev => ({
                        ...prev,
                        wardId: wid,
                        bedId: avail ? avail.id.toString() : '',
                      }));
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  >
                    {activeWards.length === 0 && (
                      <option value="">No wards available</option>
                    )}
                    {activeWards.map(w => (
                      <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
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
                    {availableBedsForForm.length === 0 && (
                      <option value="">No available bed</option>
                    )}
                    {availableBedsForForm.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.bedNumber} ({b.bedType}
                        {b.dailyCharge === null
                          ? ' · rate not set'
                          : ` - KES ${Number(b.dailyCharge).toLocaleString()}/d`})
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
                  placeholder="Enter the working diagnosis"
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Nursing Care & Treatment Instructions</label>
                <textarea
                  rows={2}
                  value={admitForm.nursingNotes}
                  onChange={(e) => setAdmitForm({ ...admitForm, nursingNotes: e.target.value })}
                  placeholder="Optional. Left blank, nothing is recorded."
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
                  disabled={activeWards.length === 0 || availableBedsForForm.length === 0}
                  className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800 disabled:opacity-40 disabled:cursor-not-allowed"
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
      {/* WARD FORM (create / edit) */}
      {wardFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {wardForm.id === null ? 'Create a ward' : `Edit ward ${wardForm.code}`}
              </h3>
              <p className="text-2xs text-slate-500">
                {currentFacility?.name ?? 'This facility'} · a ward's capacity is
                counted from the beds you add to it.
              </p>
            </div>

            <form onSubmit={handleSubmitWard} className="space-y-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Ward name *</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={wardForm.name}
                  onChange={(e) => setWardForm({ ...wardForm, name: e.target.value })}
                  placeholder="e.g. Female Medical Ward"
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Ward code *</label>
                  <input
                    type="text"
                    required
                    maxLength={20}
                    disabled={wardForm.id !== null}
                    value={wardForm.code}
                    onChange={(e) => setWardForm({ ...wardForm, code: e.target.value })}
                    placeholder="e.g. FMW"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono uppercase disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  <p className="mt-1 text-3xs text-slate-500">
                    {wardForm.id === null
                      ? 'Used to match admission tariffs. Letters, digits and dashes.'
                      : 'The code is fixed after creation because tariffs match on it.'}
                  </p>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Ward type *</label>
                  <input
                    type="text"
                    required
                    list="ward-type-options"
                    maxLength={60}
                    value={wardForm.wardType}
                    onChange={(e) => setWardForm({ ...wardForm, wardType: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  />
                  <datalist id="ward-type-options">
                    {WARD_TYPE_OPTIONS.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Allocation *</label>
                  <select
                    value={wardForm.genderAllocation}
                    onChange={(e) => setWardForm({ ...wardForm, genderAllocation: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  >
                    <option value="Mixed">Mixed</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Daily rate (KES)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={wardForm.dailyRate}
                    onChange={(e) => setWardForm({ ...wardForm, dailyRate: e.target.value })}
                    placeholder="Leave blank if not set"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                  <p className="mt-1 text-3xs text-slate-500">
                    Shown on the board only. Inpatient billing prices from
                    Finance → Service tariffs.
                  </p>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setWardFormOpen(false);
                    setWardForm(EMPTY_WARD_FORM);
                  }}
                  className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={setupBusy}
                  className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800 disabled:opacity-50"
                >
                  {setupBusy
                    ? 'Saving…'
                    : wardForm.id === null
                      ? 'Create ward'
                      : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BEDS FORM (batch create) */}
      {bedsFormOpen && selectedWard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                Add beds to {selectedWard.name}
              </h3>
              <p className="text-2xs text-slate-500">
                Beds are numbered from the prefix and the first number, so a
                twenty-bed ward is one form, not twenty.
              </p>
            </div>

            <form onSubmit={handleSubmitBeds} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Prefix *</label>
                  <input
                    type="text"
                    required
                    maxLength={12}
                    value={bedsForm.prefix}
                    onChange={(e) => setBedsForm({ ...bedsForm, prefix: e.target.value })}
                    placeholder="FMW-BED"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">First number</label>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={bedsForm.startNumber}
                    onChange={(e) => setBedsForm({ ...bedsForm, startNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">How many</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={bedsForm.count}
                    onChange={(e) => setBedsForm({ ...bedsForm, count: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
              </div>

              <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 font-mono text-2xs text-slate-600">
                {bedsForm.prefix.trim() === ''
                  ? 'Enter a prefix to preview the bed numbers.'
                  : (() => {
                      const start = Number(bedsForm.startNumber || 1);
                      const total = Number(bedsForm.count || 0);

                      if (!Number.isFinite(start) || !Number.isFinite(total) || total < 1) {
                        return 'Enter how many beds to preview the numbers.';
                      }

                      const preview = Array.from({ length: Math.min(total, 5) }, (_, i) =>
                        `${bedsForm.prefix.trim().toUpperCase()}-${String(start + i).padStart(2, '0')}`);

                      return total > 5
                        ? `Will create ${preview.join(', ')}, … ${bedsForm.prefix.trim().toUpperCase()}-${String(start + total - 1).padStart(2, '0')} (${total} beds)`
                        : `Will create ${preview.join(', ')}`;
                    })()}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Bed type *</label>
                  <input
                    type="text"
                    required
                    list="bed-type-options"
                    maxLength={60}
                    value={bedsForm.bedType}
                    onChange={(e) => setBedsForm({ ...bedsForm, bedType: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  />
                  <datalist id="bed-type-options">
                    {BED_TYPE_OPTIONS.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Daily charge (KES)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={bedsForm.dailyCharge}
                    onChange={(e) => setBedsForm({ ...bedsForm, dailyCharge: e.target.value })}
                    placeholder="Leave blank if not set"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setBedsFormOpen(false);
                    setBedsForm(EMPTY_BEDS_FORM);
                  }}
                  className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={setupBusy}
                  className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800 disabled:opacity-50"
                >
                  {setupBusy ? 'Adding…' : 'Add beds'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BED EDIT */}
      {bedEditTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                Edit bed {bedEditTarget.bedNumber}
              </h3>
              <p className="text-2xs text-slate-500">
                Occupancy is never set here — only admitting a patient marks a
                bed occupied.
              </p>
            </div>

            <form onSubmit={handleSubmitBedEdit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Bed number *</label>
                  <input
                    type="text"
                    required
                    maxLength={20}
                    value={bedEdit.bedNumber}
                    onChange={(e) => setBedEdit({ ...bedEdit, bedNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Bed type *</label>
                  <input
                    type="text"
                    required
                    list="bed-type-options"
                    maxLength={60}
                    value={bedEdit.bedType}
                    onChange={(e) => setBedEdit({ ...bedEdit, bedType: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Daily charge (KES)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={bedEdit.dailyCharge}
                    onChange={(e) => setBedEdit({ ...bedEdit, dailyCharge: e.target.value })}
                    placeholder="Leave blank if not set"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={bedEdit.status}
                    disabled={bedEditTarget.status === 'Occupied'}
                    onChange={(e) => setBedEdit({ ...bedEdit, status: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md disabled:bg-slate-100"
                  >
                    <option value="Available">Available</option>
                    <option value="Cleaning">Cleaning</option>
                    <option value="Maintenance">Maintenance</option>
                    <option value="Reserved">Reserved</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setBedEditTarget(null)}
                  className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={setupBusy}
                  className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800 disabled:opacity-50"
                >
                  {setupBusy ? 'Saving…' : 'Save bed'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Nursing & Bedside Care */}
      <NursingPanel
        admissions={admissions}
        patients={patients}
        board={board}
        onRefresh={triggerRefresh}
      />

    </div>
  );
};
