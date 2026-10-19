import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { Patient, Encounter, Observation, Diagnosis, Procedure, Medication, LabTest } from '../../types/index.ts';
import {
  Stethoscope,
  Activity,
  Heart,
  Thermometer,
  Pill,
  FlaskConical,
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  BedDouble,
  Receipt,
  Plus,
  Clock
} from 'lucide-react';

const commonIcd10List = [
  { code: 'B50.9', desc: 'Plasmodium falciparum malaria, unspecified' },
  { code: 'I10', desc: 'Essential (primary) hypertension' },
  { code: 'E11.9', desc: 'Type 2 diabetes mellitus without complications' },
  { code: 'J06.9', desc: 'Acute upper respiratory infection, unspecified' },
  { code: 'K29.7', desc: 'Gastritis, unspecified' },
  { code: 'A09', desc: 'Infectious gastroenteritis and colitis, unspecified' },
  { code: 'N39.0', desc: 'Urinary tract infection, site not specified' },
  { code: 'J45.9', desc: 'Asthma, unspecified' },
  { code: 'M54.5', desc: 'Low back pain' },
  { code: 'A00.9', desc: 'Cholera, unspecified (Notifiable)' },
];

export const OutpatientModule: React.FC = () => {
  const { currentTenant, currentFacility, currentUser, setSelectedPatient, setIsJourneyModalOpen, showToast, refreshKey, triggerRefresh } = useHmis();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [activePatient, setActivePatient] = useState<Patient | null>(null);
  const [activeEncounter, setActiveEncounter] = useState<Encounter | null>(null);
  const [loading, setLoading] = useState(true);

  // Vitals State
  const [vitals, setVitals] = useState({
    systolicBp: '120',
    diastolicBp: '80',
    pulseRate: '72',
    temperatureC: '36.6',
    respiratoryRate: '16',
    spo2Percent: '98',
    weightKg: '70',
    heightCm: '172',
    bloodGlucoseMmol: '5.2',
  });

  // Clinical Notes State
  const [notes, setNotes] = useState({
    triageCategory: 'Category 3 - Urgent',
    chiefComplaint: '',
    historyOfPresentIllness: '',
    physicalExamination: '',
    clinicalNotes: '',
    referralFacility: '',
  });

  // Diagnosis State
  const [selectedIcd, setSelectedIcd] = useState(commonIcd10List[0]);
  const [diagnosisType, setDiagnosisType] = useState('Primary');
  const [diagnosisList, setDiagnosisList] = useState<Diagnosis[]>([]);

  // Prescription Form
  const [newMed, setNewMed] = useState({
    drugName: 'Paracetamol',
    dosage: '1000mg',
    frequency: 'TDS (3x daily)',
    duration: '5 days',
    route: 'Oral',
    instructions: 'Take with or after food',
    quantity: 15,
    unitPrice: '5.00',
  });
  const [prescriptions, setPrescriptions] = useState<Medication[]>([]);

  // Lab Tests Catalogue
  const [labTests, setLabTests] = useState<LabTest[]>([]);
  const [selectedLabTestId, setSelectedLabTestId] = useState<string>('');

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [pList, tests] = await Promise.all([
          api.getPatients(currentTenant?.id, currentFacility?.id),
          api.getLabTests(currentFacility?.id),
        ]);
        setPatients(pList);
        setLabTests(tests);
        if (tests.length > 0) setSelectedLabTestId(tests[0].id.toString());
        if (pList.length > 0 && !activePatient) {
          selectPatient(pList[0]);
        }
      } catch (err) {
        console.error('Failed to load OPD data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [currentTenant, currentFacility, refreshKey]);

  const selectPatient = async (p: Patient) => {
    setActivePatient(p);
    try {
      const encs = await api.getEncounters(p.id, currentFacility?.id);
      if (encs.length > 0) {
        setActiveEncounter(encs[0]);
        setNotes({
          triageCategory: encs[0].triageCategory || 'Category 3 - Urgent',
          chiefComplaint: encs[0].chiefComplaint || '',
          historyOfPresentIllness: encs[0].historyOfPresentIllness || '',
          physicalExamination: encs[0].physicalExamination || '',
          clinicalNotes: encs[0].clinicalNotes || '',
          referralFacility: encs[0].referralFacility || '',
        });

        // Load existing vitals, diagnoses, meds
        const [vList, dList, mList] = await Promise.all([
          api.getObservations(encs[0].id),
          api.getDiagnoses(encs[0].id),
          api.getMedications(encs[0].id),
        ]);

        if (vList.length > 0) {
          const v = vList[0];
          setVitals({
            systolicBp: v.systolicBp?.toString() || '120',
            diastolicBp: v.diastolicBp?.toString() || '80',
            pulseRate: v.pulseRate?.toString() || '72',
            temperatureC: v.temperatureC || '36.6',
            respiratoryRate: v.respiratoryRate?.toString() || '16',
            spo2Percent: v.spo2Percent?.toString() || '98',
            weightKg: v.weightKg || '70',
            heightCm: v.heightCm || '172',
            bloodGlucoseMmol: v.bloodGlucoseMmol || '5.2',
          });
        }
        setDiagnosisList(dList);
        setPrescriptions(mList);
      } else {
        // create new active encounter
        const newEnc = await api.createEncounter({
          tenantId: p.tenantId,
          facilityId: p.facilityId,
          patientId: p.id,
          encounterType: 'Outpatient',
          status: 'Active',
          triageCategory: 'Category 3 - Urgent',
        });
        setActiveEncounter(newEnc);
        setDiagnosisList([]);
        setPrescriptions([]);
      }
    } catch (err) {
      console.error('Failed to select patient for encounter:', err);
    }
  };

  // BMI Calculation
  const weight = parseFloat(vitals.weightKg) || 0;
  const heightM = (parseFloat(vitals.heightCm) || 0) / 100;
  const bmi = heightM > 0 ? (weight / (heightM * heightM)).toFixed(1) : '—';

  // BP Evaluation
  const sys = parseInt(vitals.systolicBp, 10);
  const dia = parseInt(vitals.diastolicBp, 10);
  let bpCategory = 'Normal';
  let bpColor = 'text-emerald-700 bg-emerald-50';
  if (sys >= 180 || dia >= 120) {
    bpCategory = 'Hypertensive Crisis!';
    bpColor = 'text-rose-800 bg-rose-100 font-bold';
  } else if (sys >= 140 || dia >= 90) {
    bpCategory = 'Stage 2 Hypertension';
    bpColor = 'text-rose-700 bg-rose-50';
  } else if (sys >= 130 || dia >= 80) {
    bpCategory = 'Stage 1 Hypertension';
    bpColor = 'text-amber-700 bg-amber-50';
  } else if (sys >= 120 && dia < 80) {
    bpCategory = 'Elevated BP';
    bpColor = 'text-amber-600 bg-amber-50';
  }

  const handleSaveVitals = async () => {
    if (!activeEncounter || !activePatient) return;
    try {
      await api.recordObservation({
        encounterId: activeEncounter.id,
        patientId: activePatient.id,
        systolicBp: parseInt(vitals.systolicBp, 10),
        diastolicBp: parseInt(vitals.diastolicBp, 10),
        pulseRate: parseInt(vitals.pulseRate, 10),
        temperatureC: vitals.temperatureC,
        respiratoryRate: parseInt(vitals.respiratoryRate, 10),
        spo2Percent: parseInt(vitals.spo2Percent, 10),
        weightKg: vitals.weightKg,
        heightCm: vitals.heightCm,
        bmi: bmi !== '—' ? bmi : undefined,
        bloodGlucoseMmol: vitals.bloodGlucoseMmol,
        recordedBy: currentUser.name,
      });
      showToast('Vital signs recorded successfully.');
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleSaveNotes = async () => {
    if (!activeEncounter) return;
    try {
      await api.updateEncounter(activeEncounter.id, {
        triageCategory: notes.triageCategory,
        chiefComplaint: notes.chiefComplaint,
        historyOfPresentIllness: notes.historyOfPresentIllness,
        physicalExamination: notes.physicalExamination,
        clinicalNotes: notes.clinicalNotes,
        referralFacility: notes.referralFacility,
      });
      showToast('Consultation notes saved.');
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleAddDiagnosis = async () => {
    if (!activeEncounter || !activePatient) return;
    try {
      const diag = await api.recordDiagnosis({
        encounterId: activeEncounter.id,
        patientId: activePatient.id,
        icd10Code: selectedIcd.code,
        icd10Description: selectedIcd.desc,
        diagnosisType,
        status: 'Confirmed',
        diagnosedBy: currentUser.name,
      });
      setDiagnosisList(prev => [...prev, diag]);
      showToast(`Diagnosis ${selectedIcd.code} added.`);
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handlePrescribe = async () => {
    if (!activeEncounter || !activePatient) return;
    try {
      const med = await api.prescribeMedication({
        encounterId: activeEncounter.id,
        patientId: activePatient.id,
        drugName: newMed.drugName,
        dosage: newMed.dosage,
        frequency: newMed.frequency,
        duration: newMed.duration,
        route: newMed.route,
        instructions: newMed.instructions,
        quantity: Number(newMed.quantity),
        unitPrice: newMed.unitPrice,
        status: 'Prescribed',
        prescribedBy: currentUser.name,
      });
      setPrescriptions(prev => [...prev, med]);

      // Also route patient to Pharmacy Queue
      await api.createQueueItem({
        tenantId: activePatient.tenantId,
        facilityId: activePatient.facilityId,
        patientId: activePatient.id,
        encounterId: activeEncounter.id,
        queueType: 'Pharmacy',
        tokenNumber: `PHARM-${Math.floor(100 + Math.random() * 900)}`,
        priority: 'Normal',
        status: 'Waiting',
        waitingTimeMinutes: 0,
      });

      showToast(`Prescription saved and patient routed to Pharmacy queue.`);
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleOrderLab = async () => {
    if (!activeEncounter || !activePatient || !selectedLabTestId) return;
    const test = labTests.find(t => t.id.toString() === selectedLabTestId);
    if (!test) return;

    try {
      await api.createLabOrder({
        tenantId: activePatient.tenantId,
        facilityId: activePatient.facilityId,
        patientId: activePatient.id,
        encounterId: activeEncounter.id,
        testId: test.id,
        testName: test.name,
        status: 'Ordered',
        orderedBy: currentUser.name,
      });

      // Route to Lab Queue
      await api.createQueueItem({
        tenantId: activePatient.tenantId,
        facilityId: activePatient.facilityId,
        patientId: activePatient.id,
        encounterId: activeEncounter.id,
        queueType: 'Laboratory',
        tokenNumber: `LAB-${Math.floor(100 + Math.random() * 900)}`,
        priority: 'Normal',
        status: 'Waiting',
        waitingTimeMinutes: 0,
      });

      showToast(`Ordered ${test.name} and routed patient to Laboratory queue.`);
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Patient Picker Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h1 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-teal-700" />
              <span>Outpatient Triage & Clinical Consultation Desk</span>
            </h1>
            <p className="text-2xs text-slate-500">
              Examining Clinician: <strong className="text-slate-800">{currentUser.name}</strong> ({currentUser.role})
            </p>
          </div>

          {activePatient && (
            <button
              onClick={() => {
                setSelectedPatient(activePatient);
                setIsJourneyModalOpen(true);
              }}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium transition-colors"
            >
              Full Longitudinal Record
            </button>
          )}
        </div>

        {/* Patient Selection Carousel */}
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
          <span className="text-2xs font-semibold text-slate-400 uppercase tracking-wider shrink-0">
            Select Patient:
          </span>
          {patients.map((p) => (
            <button
              key={p.id}
              onClick={() => selectPatient(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
                activePatient?.id === p.id
                  ? 'bg-teal-700 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <span>{p.firstName} {p.lastName}</span>
              <span className={`text-2xs font-mono px-1 rounded ${activePatient?.id === p.id ? 'bg-teal-800 text-teal-100' : 'bg-slate-200 text-slate-600'}`}>
                {p.mrn}
              </span>
            </button>
          ))}
        </div>
      </div>

      {activePatient ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Triage Vital Signs & Clinical Alerts (1 col) */}
          <div className="space-y-6">
            {/* Clinical Alerts Card */}
            <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-4 shadow-xs text-xs space-y-2">
              <div className="flex items-center gap-1.5 text-amber-900 font-bold uppercase text-2xs tracking-wider">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                <span>Patient Safety & Allergies Alert</span>
              </div>
              <div className="text-amber-950 font-medium">
                Allergies: <span className="font-bold text-rose-700">{activePatient.allergies || 'None known'}</span>
              </div>
              <div className="text-amber-900">
                Known Chronic: <strong>{activePatient.chronicConditions || 'None'}</strong>
              </div>
              <div className="text-amber-800 text-2xs pt-1 border-t border-amber-200/60 font-mono">
                Payer: {activePatient.payerType} · {activePatient.shaNumber || 'Self-Pay'}
              </div>
            </div>

            {/* Vital Signs Form */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs text-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-xs uppercase">
                  <Activity className="w-4 h-4 text-teal-700" />
                  <span>Triage Vital Signs</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-2xs ${bpColor}`}>
                  {bpCategory}
                </span>
              </div>

              {/* BP Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Systolic BP (mmHg)</label>
                  <input
                    type="number"
                    value={vitals.systolicBp}
                    onChange={(e) => setVitals({ ...vitals, systolicBp: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-md font-mono font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Diastolic BP (mmHg)</label>
                  <input
                    type="number"
                    value={vitals.diastolicBp}
                    onChange={(e) => setVitals({ ...vitals, diastolicBp: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-md font-mono font-semibold"
                  />
                </div>
              </div>

              {/* Pulse & Temp */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Pulse (bpm)</label>
                  <input
                    type="number"
                    value={vitals.pulseRate}
                    onChange={(e) => setVitals({ ...vitals, pulseRate: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Temperature (°C)</label>
                  <input
                    type="text"
                    value={vitals.temperatureC}
                    onChange={(e) => setVitals({ ...vitals, temperatureC: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-md font-mono"
                  />
                </div>
              </div>

              {/* Resp & SpO2 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Resp Rate (cpm)</label>
                  <input
                    type="number"
                    value={vitals.respiratoryRate}
                    onChange={(e) => setVitals({ ...vitals, respiratoryRate: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">SpO2 Oxygen (%)</label>
                  <input
                    type="number"
                    value={vitals.spo2Percent}
                    onChange={(e) => setVitals({ ...vitals, spo2Percent: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-md font-mono"
                  />
                </div>
              </div>

              {/* Weight & Height & BMI */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Weight (kg)</label>
                  <input
                    type="text"
                    value={vitals.weightKg}
                    onChange={(e) => setVitals({ ...vitals, weightKg: e.target.value })}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded-md font-mono text-center"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Height (cm)</label>
                  <input
                    type="text"
                    value={vitals.heightCm}
                    onChange={(e) => setVitals({ ...vitals, heightCm: e.target.value })}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded-md font-mono text-center"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Calculated BMI</label>
                  <div className="px-2 py-1.5 bg-slate-100 text-slate-800 rounded-md font-mono text-center font-bold">
                    {bmi}
                  </div>
                </div>
              </div>

              {/* Blood Glucose */}
              <div>
                <label className="block text-slate-600 font-medium mb-1">Random Blood Sugar (mmol/L)</label>
                <input
                  type="text"
                  value={vitals.bloodGlucoseMmol}
                  onChange={(e) => setVitals({ ...vitals, bloodGlucoseMmol: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-md font-mono"
                />
              </div>

              <button
                onClick={handleSaveVitals}
                className="w-full py-2 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 transition-colors shadow-xs"
              >
                Save Triage Observations
              </button>
            </div>
          </div>

          {/* Right Two Columns: Clinical Examination, Diagnoses & Orders (2 cols) */}
          <div className="lg:col-span-2 space-y-6">
            {/* Consultation Notes Form */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs text-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2 font-bold text-slate-900 uppercase">
                  <ClipboardList className="w-4 h-4 text-teal-700" />
                  <span>Clinical History & Physical Examination</span>
                </div>
                <select
                  value={notes.triageCategory}
                  onChange={(e) => setNotes({ ...notes, triageCategory: e.target.value })}
                  className="px-2.5 py-1 border border-slate-200 rounded text-2xs font-medium"
                >
                  <option value="Category 1 - Resuscitation">Category 1 - Resuscitation (Immediate)</option>
                  <option value="Category 2 - Emergent">Category 2 - Emergent (Within 10m)</option>
                  <option value="Category 3 - Urgent">Category 3 - Urgent (Within 30m)</option>
                  <option value="Category 4 - Less Urgent">Category 4 - Less Urgent (Within 60m)</option>
                  <option value="Category 5 - Non-Urgent">Category 5 - Non-Urgent</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Chief Complaint *</label>
                <input
                  type="text"
                  value={notes.chiefComplaint}
                  onChange={(e) => setNotes({ ...notes, chiefComplaint: e.target.value })}
                  placeholder="e.g. Throbbing headache, high fever, chills, dizziness for 3 days"
                  className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">History of Present Illness (HPI)</label>
                <textarea
                  rows={2}
                  value={notes.historyOfPresentIllness}
                  onChange={(e) => setNotes({ ...notes, historyOfPresentIllness: e.target.value })}
                  placeholder="Onset, character, aggravating/relieving factors, previous episodes..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Physical Examination (CVS, Resp, Abdomen, CNS)</label>
                <textarea
                  rows={2}
                  value={notes.physicalExamination}
                  onChange={(e) => setNotes({ ...notes, physicalExamination: e.target.value })}
                  placeholder="Systemic examination findings..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Clinical Assessment & Management Plan</label>
                <textarea
                  rows={2}
                  value={notes.clinicalNotes}
                  onChange={(e) => setNotes({ ...notes, clinicalNotes: e.target.value })}
                  placeholder="Impression, clinical advice, lifestyle counseling..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                />
              </div>

              <div className="flex items-center justify-end">
                <button
                  onClick={handleSaveNotes}
                  className="px-4 py-2 bg-teal-700 text-white font-medium rounded-lg hover:bg-teal-800 transition-colors shadow-xs"
                >
                  Save Consultation Notes
                </button>
              </div>
            </div>

            {/* ICD-10 Coding & Diagnoses */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs text-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="font-bold text-slate-900 uppercase">
                  ICD-10 Diagnostic Coding ({diagnosisList.length})
                </div>
                <span className="text-2xs text-slate-400 font-mono">Kenya MOH & SHA Standard</span>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-2">
                <select
                  value={selectedIcd.code}
                  onChange={(e) => {
                    const match = commonIcd10List.find(x => x.code === e.target.value);
                    if (match) setSelectedIcd(match);
                  }}
                  className="w-full sm:flex-1 px-3 py-2 border border-slate-200 rounded-md"
                >
                  {commonIcd10List.map(item => (
                    <option key={item.code} value={item.code}>
                      {item.code} — {item.desc}
                    </option>
                  ))}
                </select>

                <select
                  value={diagnosisType}
                  onChange={(e) => setDiagnosisType(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-md"
                >
                  <option value="Primary">Primary</option>
                  <option value="Secondary">Secondary</option>
                  <option value="Provisional">Provisional</option>
                </select>

                <button
                  onClick={handleAddDiagnosis}
                  className="px-3 py-2 bg-slate-900 text-white rounded-md font-medium hover:bg-slate-800 transition-colors flex items-center gap-1 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Diagnosis</span>
                </button>
              </div>

              {/* List of active diagnoses */}
              {diagnosisList.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-100">
                  {diagnosisList.map(d => (
                    <div key={d.id} className="p-2 rounded bg-slate-50 border border-slate-200 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-teal-800">{d.icd10Code}</span>
                        <span className="text-slate-800">{d.icd10Description}</span>
                        <span className="text-2xs text-slate-400 font-sans">({d.diagnosisType})</span>
                      </div>
                      <span className="text-2xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-medium">
                        {d.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Diagnostics & Pharmacy Orders Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Order Lab Investigations */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs space-y-3">
                <div className="font-bold text-slate-900 uppercase flex items-center gap-1.5">
                  <FlaskConical className="w-3.5 h-3.5 text-teal-700" />
                  <span>Order Lab Investigation</span>
                </div>
                <select
                  value={selectedLabTestId}
                  onChange={(e) => setSelectedLabTestId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                >
                  {labTests.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} (KES {Number(t.price).toLocaleString()})
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleOrderLab}
                  className="w-full py-1.5 bg-teal-700 text-white rounded-md font-medium hover:bg-teal-800 transition-colors"
                >
                  Send Order to Laboratory
                </button>
              </div>

              {/* Prescribe Medication */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs space-y-3">
                <div className="font-bold text-slate-900 uppercase flex items-center gap-1.5">
                  <Pill className="w-3.5 h-3.5 text-teal-700" />
                  <span>Prescribe Medication</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Drug Name"
                    value={newMed.drugName}
                    onChange={(e) => setNewMed({ ...newMed, drugName: e.target.value })}
                    className="px-2 py-1.5 border border-slate-200 rounded"
                  />
                  <input
                    type="text"
                    placeholder="Dosage (e.g. 500mg)"
                    value={newMed.dosage}
                    onChange={(e) => setNewMed({ ...newMed, dosage: e.target.value })}
                    className="px-2 py-1.5 border border-slate-200 rounded"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Frequency (TDS / BD)"
                    value={newMed.frequency}
                    onChange={(e) => setNewMed({ ...newMed, frequency: e.target.value })}
                    className="px-2 py-1.5 border border-slate-200 rounded"
                  />
                  <input
                    type="text"
                    placeholder="Duration (5 days)"
                    value={newMed.duration}
                    onChange={(e) => setNewMed({ ...newMed, duration: e.target.value })}
                    className="px-2 py-1.5 border border-slate-200 rounded"
                  />
                </div>
                <button
                  onClick={handlePrescribe}
                  className="w-full py-1.5 bg-slate-900 text-white rounded-md font-medium hover:bg-slate-800 transition-colors"
                >
                  Prescribe & Route to Pharmacy
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-xs text-slate-400">
          Please select a patient above to start consultation and triage observation.
        </div>
      )}
    </div>
  );
};
