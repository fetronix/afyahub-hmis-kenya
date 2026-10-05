import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { Patient } from '../../types/index.ts';
import {
  Eye,
  Smile,
  Baby,
  Activity,
  CheckCircle2,
  Stethoscope,
  Sparkles,
  ClipboardCheck
} from 'lucide-react';

type SpecialtyType = 'Dental' | 'Optical' | 'ENT' | 'MCH' | 'Renal';

export const SpecialtyModule: React.FC = () => {
  const { currentFacility, currentUser, setSelectedPatient, setIsJourneyModalOpen, showToast, refreshKey } = useHmis();
  const [activeSpecialty, setActiveSpecialty] = useState<SpecialtyType>('Dental');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');

  // Dental Form State
  const [dentalForm, setDentalForm] = useState({
    quadrant: 'Upper Right (Q1)',
    toothNumber: '16 (First Molar)',
    condition: 'Dental Caries (Deep)',
    procedure: 'Composite Restoration + Scaling',
    anestheticUsed: 'Lidocaine 2% with Adrenaline',
    costKes: '3500',
  });

  // Optical Form State
  const [opticalForm, setOpticalForm] = useState({
    visualAcuityRight: '6/6',
    visualAcuityLeft: '6/9',
    intraocularPressure: '15 mmHg',
    fundusExam: 'Normal disc, cup-to-disc ratio 0.3, clear macula',
    prescribedLenses: 'OD: -0.50 DS / OS: -0.75 DS',
    costKes: '2000',
  });

  // MCH / Antenatal State
  const [mchForm, setMchForm] = useState({
    gravidaPara: 'G2 P1 + 0',
    gestationWeeks: '28 Weeks',
    fundalHeightCm: '28 cm',
    fetalHeartRateBpm: '142 bpm',
    presentation: 'Cephalic',
    tetanusToxoidDose: 'TT3 Administered',
    ironFolateDispensed: true,
  });

  // Renal / Dialysis State
  const [renalForm, setRenalForm] = useState({
    dryWeightKg: '68.5',
    preDialysisBp: '152/94',
    accessType: 'Left Radiocephalic AV Fistula',
    ultrafiltrationGoalL: '2.5 Liters',
    heparinLoadingUnits: '2000 IU',
    dialyzerType: 'High-Flux FX80',
    sessionDurationHours: '4 Hours',
  });

  useEffect(() => {
    async function loadPatients() {
      try {
        const pList = await api.getPatients(undefined, currentFacility?.id);
        setPatients(pList);
        if (pList.length > 0 && !selectedPatientId) {
          setSelectedPatientId(pList[0].id.toString());
        }
      } catch (err) {
        console.error('Failed to load patients for specialty clinic:', err);
      }
    }
    loadPatients();
  }, [currentFacility, refreshKey]);

  const handleSaveSpecialtyEncounter = () => {
    const pat = patients.find(p => p.id.toString() === selectedPatientId);
    showToast(`Logged ${activeSpecialty} clinical record for ${pat?.firstName} ${pat?.lastName}.`);
  };

  const currentPatient = patients.find(p => p.id.toString() === selectedPatientId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Specialized Clinical Framework</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Configurable clinical documentation suites for Dental, Optical, ENT, MCH / Antenatal, and Renal Dialysis.
          </p>
        </div>

        {currentPatient && (
          <button
            onClick={() => {
              setSelectedPatient(currentPatient);
              setIsJourneyModalOpen(true);
            }}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Patient Record: {currentPatient.firstName} ({currentPatient.mrn})
          </button>
        )}
      </div>

      {/* Specialty Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-2 shadow-xs flex flex-wrap items-center gap-2">
        {[
          { id: 'Dental', label: 'Dental & Oral Health', icon: Smile },
          { id: 'Optical', label: 'Ophthalmology & Optical', icon: Eye },
          { id: 'MCH', label: 'MCH / Antenatal Clinic (ANC)', icon: Baby },
          { id: 'Renal', label: 'Renal & Haemodialysis', icon: Activity },
          { id: 'ENT', label: 'Ear, Nose & Throat (ENT)', icon: Stethoscope },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSpecialty === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveSpecialty(tab.id as SpecialtyType)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-teal-700 text-white font-semibold shadow-xs'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Patient Selector */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <span className="font-semibold text-slate-700 shrink-0">Patient:</span>
          <select
            value={selectedPatientId}
            onChange={(e) => setSelectedPatientId(e.target.value)}
            className="w-full sm:w-auto px-3 py-1.5 border border-slate-200 rounded-md font-medium"
          >
            {patients.map(p => (
              <option key={p.id} value={p.id}>
                {p.firstName} {p.lastName} (MRN: {p.mrn} · Payer: {p.payerType})
              </option>
            ))}
          </select>
        </div>
        <span className="text-2xs text-slate-500 font-mono hidden sm:inline">Specialist Unit Active</span>
      </div>

      {/* DENTAL CLINIC VIEW */}
      {activeSpecialty === 'Dental' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-5 text-xs">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 uppercase">
              Dental Examination & Odontogram Chart
            </h2>
            <span className="text-2xs text-slate-500">KMPDC Dental Board Standard</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Dental Quadrant</label>
              <select
                value={dentalForm.quadrant}
                onChange={(e) => setDentalForm({ ...dentalForm, quadrant: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              >
                <option value="Upper Right (Q1)">Upper Right (Q1)</option>
                <option value="Upper Left (Q2)">Upper Left (Q2)</option>
                <option value="Lower Left (Q3)">Lower Left (Q3)</option>
                <option value="Lower Right (Q4)">Lower Right (Q4)</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Tooth Notation</label>
              <input
                type="text"
                value={dentalForm.toothNumber}
                onChange={(e) => setDentalForm({ ...dentalForm, toothNumber: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Dental Condition</label>
              <input
                type="text"
                value={dentalForm.condition}
                onChange={(e) => setDentalForm({ ...dentalForm, condition: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Procedure Performed</label>
              <input
                type="text"
                value={dentalForm.procedure}
                onChange={(e) => setDentalForm({ ...dentalForm, procedure: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Local Anaesthesia</label>
              <input
                type="text"
                value={dentalForm.anestheticUsed}
                onChange={(e) => setDentalForm({ ...dentalForm, anestheticUsed: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Procedure Tariff (KES)</label>
              <input
                type="text"
                value={dentalForm.costKes}
                onChange={(e) => setDentalForm({ ...dentalForm, costKes: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-semibold"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end">
            <button
              onClick={handleSaveSpecialtyEncounter}
              className="px-4 py-2 bg-teal-700 text-white rounded-lg font-semibold hover:bg-teal-800 transition-colors shadow-xs"
            >
              Save Dental Note & Add Billing Charge
            </button>
          </div>
        </div>
      )}

      {/* OPTICAL CLINIC VIEW */}
      {activeSpecialty === 'Optical' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-5 text-xs">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 uppercase">
              Ophthalmology & Visual Acuity Assessment
            </h2>
            <span className="text-2xs text-slate-500">Snellen Acuity & Slit Lamp Exam</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Visual Acuity Right Eye (OD)</label>
              <input
                type="text"
                value={opticalForm.visualAcuityRight}
                onChange={(e) => setOpticalForm({ ...opticalForm, visualAcuityRight: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Visual Acuity Left Eye (OS)</label>
              <input
                type="text"
                value={opticalForm.visualAcuityLeft}
                onChange={(e) => setOpticalForm({ ...opticalForm, visualAcuityLeft: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Intraocular Pressure (IOP)</label>
              <input
                type="text"
                value={opticalForm.intraocularPressure}
                onChange={(e) => setOpticalForm({ ...opticalForm, intraocularPressure: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Funduscopy & Retinal Examination</label>
              <input
                type="text"
                value={opticalForm.fundusExam}
                onChange={(e) => setOpticalForm({ ...opticalForm, fundusExam: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Spectacle Prescription</label>
              <input
                type="text"
                value={opticalForm.prescribedLenses}
                onChange={(e) => setOpticalForm({ ...opticalForm, prescribedLenses: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end">
            <button
              onClick={handleSaveSpecialtyEncounter}
              className="px-4 py-2 bg-teal-700 text-white rounded-lg font-semibold hover:bg-teal-800 transition-colors shadow-xs"
            >
              Save Optical Prescription
            </button>
          </div>
        </div>
      )}

      {/* MCH / ANC VIEW */}
      {activeSpecialty === 'MCH' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-5 text-xs">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 uppercase">
              Maternal & Child Health — Antenatal Care (ANC) Log
            </h2>
            <span className="text-2xs text-slate-500">Kenya MOH 405 ANC Card Standard</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Parity & Gravida</label>
              <input
                type="text"
                value={mchForm.gravidaPara}
                onChange={(e) => setMchForm({ ...mchForm, gravidaPara: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Gestation Age</label>
              <input
                type="text"
                value={mchForm.gestationWeeks}
                onChange={(e) => setMchForm({ ...mchForm, gestationWeeks: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Fundal Height (cm)</label>
              <input
                type="text"
                value={mchForm.fundalHeightCm}
                onChange={(e) => setMchForm({ ...mchForm, fundalHeightCm: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Fetal Heart Rate (bpm)</label>
              <input
                type="text"
                value={mchForm.fetalHeartRateBpm}
                onChange={(e) => setMchForm({ ...mchForm, fetalHeartRateBpm: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-semibold text-teal-800"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Fetal Presentation</label>
              <input
                type="text"
                value={mchForm.presentation}
                onChange={(e) => setMchForm({ ...mchForm, presentation: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Tetanus Toxoid (TT)</label>
              <input
                type="text"
                value={mchForm.tetanusToxoidDose}
                onChange={(e) => setMchForm({ ...mchForm, tetanusToxoidDose: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end">
            <button
              onClick={handleSaveSpecialtyEncounter}
              className="px-4 py-2 bg-teal-700 text-white rounded-lg font-semibold hover:bg-teal-800 transition-colors shadow-xs"
            >
              Save ANC Encounter & Issue IFAS Supplements
            </button>
          </div>
        </div>
      )}

      {/* RENAL / DIALYSIS VIEW */}
      {activeSpecialty === 'Renal' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-5 text-xs">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 uppercase">
              Renal Unit — Haemodialysis Treatment Sheet
            </h2>
            <span className="text-2xs text-slate-500">SHA Dialysis Benefit Protocol</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Target Dry Weight (kg)</label>
              <input
                type="text"
                value={renalForm.dryWeightKg}
                onChange={(e) => setRenalForm({ ...renalForm, dryWeightKg: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Pre-Dialysis Blood Pressure</label>
              <input
                type="text"
                value={renalForm.preDialysisBp}
                onChange={(e) => setRenalForm({ ...renalForm, preDialysisBp: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-semibold"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Vascular Access</label>
              <input
                type="text"
                value={renalForm.accessType}
                onChange={(e) => setRenalForm({ ...renalForm, accessType: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Ultrafiltration Target (Liters)</label>
              <input
                type="text"
                value={renalForm.ultrafiltrationGoalL}
                onChange={(e) => setRenalForm({ ...renalForm, ultrafiltrationGoalL: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Anticoagulation (Heparin)</label>
              <input
                type="text"
                value={renalForm.heparinLoadingUnits}
                onChange={(e) => setRenalForm({ ...renalForm, heparinLoadingUnits: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Session Duration</label>
              <input
                type="text"
                value={renalForm.sessionDurationHours}
                onChange={(e) => setRenalForm({ ...renalForm, sessionDurationHours: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end">
            <button
              onClick={handleSaveSpecialtyEncounter}
              className="px-4 py-2 bg-teal-700 text-white rounded-lg font-semibold hover:bg-teal-800 transition-colors shadow-xs"
            >
              Start Dialysis Session & Submit Pre-Auth
            </button>
          </div>
        </div>
      )}

      {/* ENT VIEW */}
      {activeSpecialty === 'ENT' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4 text-xs">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 uppercase">
              Ear, Nose & Throat (ENT) Specialist Consultation
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Otoscopy (Right & Left Tympanic Membrane)</label>
              <input
                type="text"
                defaultValue="Right TM intact, pearly grey with normal cone of light. Left TM hyperemic, mild retraction."
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Anterior Rhinoscopy & Turbinates</label>
              <input
                type="text"
                defaultValue="Nasal septum midline. Moderate hypertrophy of inferior turbinates, pale mucosa."
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
          </div>
          <div className="pt-3 border-t border-slate-100 flex justify-end">
            <button
              onClick={handleSaveSpecialtyEncounter}
              className="px-4 py-2 bg-teal-700 text-white rounded-lg font-semibold hover:bg-teal-800 transition-colors shadow-xs"
            >
              Save ENT Notes
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
