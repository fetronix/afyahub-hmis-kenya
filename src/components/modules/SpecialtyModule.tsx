import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import type { Patient } from '../../types/index.ts';
import { PrimaryButton, SecondaryButton, Tabs } from '../ui/controls.tsx';
import { AlertBanner, ErrorState } from '../ui/feedback.tsx';
import { PageHeader, SummaryCard } from '../ui/layout.tsx';

type Specialty = 'Dental' | 'Optical' | 'ENT' | 'Renal';
const specialties: Array<{ id: Specialty; label: string; title: string }> = [
  { id: 'Dental', label: 'Dental & oral health', title: 'Dental care' },
  { id: 'Optical', label: 'Ophthalmology & optical', title: 'Ophthalmology and optical care' },
  { id: 'ENT', label: 'Ear, nose & throat', title: 'Ear, nose and throat care' },
  { id: 'Renal', label: 'Renal & haemodialysis', title: 'Renal and dialysis care' },
];

/**
 * The old dental/optical/ENT forms were local examples: their save buttons only
 * displayed a toast and never created a note, prescription or charge. Keep the
 * real patient-record access and specialty navigation, but do not imply those
 * examples are clinical documentation. The existing outpatient and dialysis
 * workspaces remain the supported routes to their own persisted workflows.
 */
export const SpecialtyModule: React.FC = () => {
  const {
    currentTenant,
    currentFacility,
    authenticatedUser,
    setActiveModule,
    setSelectedPatient,
    setIsJourneyModalOpen,
    refreshKey,
  } = useHmis();
  const [activeSpecialty, setActiveSpecialty] = useState<Specialty>('Dental');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    async function loadPatients() {
      if (!currentTenant?.id || !currentFacility?.id) {
        setPatients([]);
        setError('Select an authorized facility to load the patient directory.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const list = await api.getPatients(currentTenant.id, currentFacility.id);
        if (!active) return;
        setPatients(list);
        setSelectedPatientId((id) => (list.some((patient) => String(patient.id) === id) ? id : ''));
      } catch (cause) {
        if (!active) return;
        setPatients([]);
        setSelectedPatientId('');
        setError(cause instanceof Error ? cause.message : 'Patient directory unavailable.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadPatients();
    return () => {
      active = false;
    };
  }, [currentTenant?.id, currentFacility?.id, refreshKey, retry]);

  const currentPatient = patients.find((patient) => String(patient.id) === selectedPatientId);
  const canOpen = (module: 'opd' | 'dialysis', permission: string) =>
    Boolean(
      currentFacility?.enabledModules?.includes(module) &&
      !currentFacility?.hiddenModules?.includes(module) &&
      authenticatedUser?.permissions?.includes(permission),
    );

  return (
    <div className="space-y-6">
      <PageHeader>
        <div>
          <h1 className="ui-page-title">Specialized Clinical Framework</h1>
          <p className="ui-page-description">
            Navigate specialty care and the existing patient record without inventing clinical data.
          </p>
        </div>
        {currentPatient && (
          <SecondaryButton
            onClick={() => {
              setSelectedPatient(currentPatient);
              setIsJourneyModalOpen(true);
            }}
          >
            Patient record: {currentPatient.firstName} ({currentPatient.mrn})
          </SecondaryButton>
        )}
      </PageHeader>

      <AlertBanner tone="warning">
        Specialty-specific notes, prescriptions and charges cannot be saved from this screen. The
        former example forms did not persist records or create billing charges. Use an authorized
        clinical workflow; nothing here records that a procedure was performed.
      </AlertBanner>

      <Tabs
        label="Specialty care"
        idPrefix="specialty"
        value={activeSpecialty}
        onChange={(value) => setActiveSpecialty(value as Specialty)}
        items={specialties.map(({ id, label }) => ({ id, label }))}
      />

      {error && <ErrorState message={error} onRetry={() => setRetry((value) => value + 1)} />}
      <SummaryCard>
        <label className="field-label" htmlFor="specialty-patient">
          Patient record
        </label>
        <select
          id="specialty-patient"
          value={selectedPatientId}
          onChange={(event) => setSelectedPatientId(event.target.value)}
          className="field-input max-w-xl"
          disabled={loading || Boolean(error)}
        >
          <option value="">{loading ? 'Loading patients…' : 'Select a patient'}</option>
          {patients.map((patient) => (
            <option key={patient.id} value={patient.id}>
              {patient.firstName} {patient.lastName} (MRN: {patient.mrn})
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-muted">
          Select a patient only to open the existing record. Patient selection does not carry to
          another workspace; select and verify the patient there again.
        </p>
      </SummaryCard>

      {specialties.map((specialty) => (
        <SummaryCard
          key={specialty.id}
          role="tabpanel"
          id={`specialty-panel-${specialty.id}`}
          aria-labelledby={`specialty-tab-${specialty.id}`}
          hidden={specialty.id !== activeSpecialty}
        >
          {specialty.id === activeSpecialty && (
            <>
              <h2 className="text-base font-bold text-ink">{specialty.title}</h2>
              <p className="mt-2 text-sm text-ink-soft">
                {activeSpecialty === 'Renal'
                  ? 'Use the dedicated dialysis workflow only when it is enabled, authorized and clinically approved for this facility.'
                  : 'Specialty-specific documentation is not implemented here. The existing outpatient workspace can record its supported encounter notes; use facility-approved procedures for specialty care.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {activeSpecialty === 'Renal' && canOpen('dialysis', 'dialysis.read') && (
                  <PrimaryButton onClick={() => setActiveModule('dialysis')}>
                    Open dialysis
                  </PrimaryButton>
                )}
                {canOpen('opd', 'clinical.read') && (
                  <SecondaryButton onClick={() => setActiveModule('opd')}>
                    Open outpatient
                  </SecondaryButton>
                )}
              </div>
            </>
          )}
        </SummaryCard>
      ))}
    </div>
  );
};
