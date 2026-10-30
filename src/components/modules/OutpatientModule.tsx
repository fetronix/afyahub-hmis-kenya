import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api, ApiError } from '../../api/client.ts';
import type { ServiceCharge } from '../../api/client.ts';
import {
  Patient,
  Encounter,
  Observation,
  Diagnosis,
  Procedure,
  Medication,
  LabTest,
  QueueItem,
} from '../../types/index.ts';
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
  Clock,
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
  const {
    currentTenant,
    currentFacility,
    currentUser,
    setSelectedPatient,
    setIsJourneyModalOpen,
    showToast,
    refreshKey,
    triggerRefresh,
  } = useHmis();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [activePatient, setActivePatient] = useState<Patient | null>(null);
  const [activeEncounter, setActiveEncounter] = useState<Encounter | null>(null);
  const [triageQueue, setTriageQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Vitals State
  const emptyVitals = {
    systolicBp: '',
    diastolicBp: '',
    pulseRate: '',
    temperatureC: '',
    respiratoryRate: '',
    spo2Percent: '',
    weightKg: '',
    heightCm: '',
    bloodGlucoseMmol: '',
  };

  const [vitals, setVitals] = useState({ ...emptyVitals });

  // Clinical Notes State
  const [notes, setNotes] = useState({
    triageCategory: '',
    chiefComplaint: '',
    historyOfPresentIllness: '',
    physicalExamination: '',
    clinicalNotes: '',
    referralFacility: '',
  });

  // Diagnosis State
  const [selectedIcd, setSelectedIcd] = useState<(typeof commonIcd10List)[number] | null>(null);
  const [diagnosisType, setDiagnosisType] = useState('Primary');
  const [diagnosisList, setDiagnosisList] = useState<Diagnosis[]>([]);
  const [customDiagnosisMode, setCustomDiagnosisMode] = useState(false);
  const [customDiagnosisDescription, setCustomDiagnosisDescription] = useState('');
  const [customDiagnosisNotes, setCustomDiagnosisNotes] = useState('');
  const [whoMode, setWhoMode] = useState(false);
  const [whoQuery, setWhoQuery] = useState('');
  const [whoResults, setWhoResults] = useState<
    Array<{ code: string; title: string; releaseId: string }>
  >([]);
  const [selectedWho, setSelectedWho] = useState<{
    code: string;
    title: string;
    releaseId: string;
  } | null>(null);
  const [whoNotice, setWhoNotice] = useState('');
  const [whoSearching, setWhoSearching] = useState(false);

  // Prescription Form
  const [newMed, setNewMed] = useState({
    drugName: '',
    dosage: '',
    frequency: '',
    duration: '',
    route: '',
    instructions: '',
    quantity: '',
    unitPrice: '',
  });
  const [prescriptions, setPrescriptions] = useState<Medication[]>([]);
  const [medicationChange, setMedicationChange] = useState<{
    id: number;
    action: string;
    reason: string;
  } | null>(null);
  const [changingMedication, setChangingMedication] = useState(false);

  // Laboratory batch-order form
  const [labTests, setLabTests] = useState<LabTest[]>([]);
  const [selectedLabTestIds, setSelectedLabTestIds] = useState<string[]>([]);
  const [labInvestigations, setLabInvestigations] = useState('');
  const [labSearch, setLabSearch] = useState('');
  const [labCategory, setLabCategory] = useState('All');
  const [labIndication, setLabIndication] = useState('');
  const [labSpecimenType, setLabSpecimenType] = useState('Blood');
  const [labPriority, setLabPriority] = useState<'Routine' | 'Urgent' | 'STAT'>('Routine');
  const [labClinicalNotes, setLabClinicalNotes] = useState('');
  const [submittingLabOrder, setSubmittingLabOrder] = useState(false);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [pList, tests, queue] = await Promise.all([
          api.getPatients(currentTenant?.id, currentFacility?.id),
          api.getLabTests(currentFacility?.id),
          // The desk works from the queue the receptionist filled.
          api.getQueues(currentFacility?.id, 'Triage').catch(() => []),
        ]);
        setPatients(pList);
        setLabTests(tests);
        setTriageQueue(queue);
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
    setActiveEncounter(null);
    setVitals({ ...emptyVitals });
    setNotes({
      triageCategory: '',
      chiefComplaint: '',
      historyOfPresentIllness: '',
      physicalExamination: '',
      clinicalNotes: '',
      referralFacility: '',
    });
    setDiagnosisList([]);
    setPrescriptions([]);
    setSelectedLabTestIds([]);
    setLabInvestigations('');
    setLabSearch('');
    setLabIndication('');
    setLabSpecimenType('Blood');
    setLabPriority('Routine');
    setLabClinicalNotes('');

    try {
      const encs = await api.getEncounters(p.id, currentFacility?.id);
      const openEncounter = encs.find((encounter) =>
        ['active', 'in progress'].includes((encounter.status || '').trim().toLowerCase()),
      );

      if (!openEncounter) {
        return;
      }

      setActiveEncounter(openEncounter);
      setNotes({
        triageCategory: openEncounter.triageCategory || '',
        chiefComplaint: openEncounter.chiefComplaint || '',
        historyOfPresentIllness: openEncounter.historyOfPresentIllness || '',
        physicalExamination: openEncounter.physicalExamination || '',
        clinicalNotes: openEncounter.clinicalNotes || '',
        referralFacility: openEncounter.referralFacility || '',
      });

      const [vList, dList, mList] = await Promise.all([
        api.getObservations(openEncounter.id),
        api.getDiagnoses(openEncounter.id),
        api.getMedications(openEncounter.id),
      ]);

      if (vList.length > 0) {
        const v = vList[0];
        setVitals({
          systolicBp: v.systolicBp?.toString() || '',
          diastolicBp: v.diastolicBp?.toString() || '',
          pulseRate: v.pulseRate?.toString() || '',
          temperatureC: v.temperatureC || '',
          respiratoryRate: v.respiratoryRate?.toString() || '',
          spo2Percent: v.spo2Percent?.toString() || '',
          weightKg: v.weightKg || '',
          heightCm: v.heightCm || '',
          bloodGlucoseMmol: v.bloodGlucoseMmol || '',
        });
      }

      setDiagnosisList(dList);
      setPrescriptions(mList);
    } catch (err) {
      console.error('Failed to select patient for encounter:', err);
      showToast('Could not load this patient’s visit. Please try again.');
    }
  };

  const startVisit = async () => {
    if (!activePatient || !currentFacility) {
      showToast('Select a patient and facility before starting a visit.');
      return;
    }

    try {
      const newEncounter = await api.createEncounter({
        tenantId: activePatient.tenantId,
        facilityId: currentFacility.id,
        patientId: activePatient.id,
        encounterType: 'Outpatient',
        status: 'Active',
        triageCategory: '',
      });

      setActiveEncounter(newEncounter);
      setVitals({ ...emptyVitals });

      /*
       * The receptionist's token moves to In-Progress as the clinician
       * opens the visit, so the waiting room can see who is being seen.
       */
      const waitingToken = triageQueue.find(
        (token) =>
          token.patientId === activePatient.id &&
          (token.status === 'Waiting' || token.status === 'Called'),
      );

      if (waitingToken) {
        await api.updateQueueStatus(waitingToken.id, 'In-Progress').catch((error: unknown) => {
          console.error('Could not move the triage token:', error);
        });
      }
      setNotes({
        triageCategory: '',
        chiefComplaint: '',
        historyOfPresentIllness: '',
        physicalExamination: '',
        clinicalNotes: '',
        referralFacility: '',
      });
      setDiagnosisList([]);
      setPrescriptions([]);
      /*
       * Say what the invoice says. The consultation is charged by the
       * server; if the facility has not priced OPD-CONSULT the screen
       * must not imply a fee was raised.
       */
      const consultBilling = (newEncounter as { billing?: ServiceCharge | null }).billing;

      if (consultBilling?.charged) {
        /*
         * The unit is what the facility priced against — "Per visit"
         * rather than a day rate is a different promise, and it comes
         * from the tariff row, not from this screen.
         */
        showToast(
          `Visit started. Consultation billed KES ${consultBilling.totalAmount}${
            consultBilling.unit ? ` (${consultBilling.unit})` : ''
          } on ${consultBilling.invoiceNumber}.`,
        );
      } else if (consultBilling?.reason === 'DUPLICATE') {
        showToast(
          'Visit started. A consultation charge record already exists; review its invoice.',
        );
      } else {
        // A missing result or queue-write failure is not proof of a queued charge.
        showToast(
          `Visit started, but this consultation charge was not confirmed: ${
            consultBilling?.message ??
            'the server returned no billing result; manual reconciliation is required'
          }`,
        );
      }
    } catch (err: any) {
      console.error('Failed to start outpatient visit:', err);
      showToast(`Could not start visit: ${err.message}`);
    }
  };

  // BMI Calculation
  const weight = parseFloat(vitals.weightKg) || 0;
  const heightM = (parseFloat(vitals.heightCm) || 0) / 100;
  const bmi = heightM > 0 ? (weight / (heightM * heightM)).toFixed(1) : '—';

  // BP Evaluation
  const sys = Number(vitals.systolicBp);
  const dia = Number(vitals.diastolicBp);
  const hasBloodPressure =
    vitals.systolicBp.trim() !== '' &&
    vitals.diastolicBp.trim() !== '' &&
    Number.isFinite(sys) &&
    Number.isFinite(dia);

  let bpCategory = 'Not recorded';
  let bpColor = 'text-slate-600 bg-slate-100';

  if (hasBloodPressure) {
    bpCategory = 'Normal';
    bpColor = 'text-emerald-700 bg-emerald-50';
  }

  if (hasBloodPressure && (sys >= 180 || dia >= 120)) {
    bpCategory = 'Hypertensive Crisis!';
    bpColor = 'text-rose-800 bg-rose-100 font-bold';
  } else if (hasBloodPressure && (sys >= 140 || dia >= 90)) {
    bpCategory = 'Stage 2 Hypertension';
    bpColor = 'text-rose-700 bg-rose-50';
  } else if (hasBloodPressure && (sys >= 130 || dia >= 80)) {
    bpCategory = 'Stage 1 Hypertension';
    bpColor = 'text-amber-700 bg-amber-50';
  } else if (hasBloodPressure && sys >= 120 && dia < 80) {
    bpCategory = 'Elevated BP';
    bpColor = 'text-amber-600 bg-amber-50';
  }

  const handleSaveVitals = async () => {
    if (!activeEncounter || !activePatient) {
      showToast('Select a patient with an active visit first.');
      return;
    }

    const supplied = [
      ['Systolic blood pressure', vitals.systolicBp, 40, 300],
      ['Diastolic blood pressure', vitals.diastolicBp, 20, 200],
      ['Pulse rate', vitals.pulseRate, 1, 300],
      ['Temperature', vitals.temperatureC, 25, 45],
      ['Respiratory rate', vitals.respiratoryRate, 1, 100],
      ['SpO2', vitals.spo2Percent, 1, 100],
      ['Weight', vitals.weightKg, 0.1, 500],
      ['Height', vitals.heightCm, 20, 250],
      ['Blood glucose', vitals.bloodGlucoseMmol, 0.1, 100],
    ] as const;

    for (const [label, raw, min, max] of supplied) {
      if (raw.trim() === '') continue;

      const value = Number(raw);
      if (!Number.isFinite(value) || value < min || value > max) {
        showToast(`${label} must be a valid value between ${min} and ${max}.`);
        return;
      }
    }

    const hasSystolic = vitals.systolicBp.trim() !== '';
    const hasDiastolic = vitals.diastolicBp.trim() !== '';

    if (hasSystolic !== hasDiastolic) {
      showToast('Enter both systolic and diastolic blood pressure, or leave both blank.');
      return;
    }

    if (!supplied.some(([, raw]) => raw.trim() !== '')) {
      showToast('Enter at least one measured vital sign before saving.');
      return;
    }

    try {
      const observation: Partial<Observation> = {
        encounterId: activeEncounter.id,
        patientId: activePatient.id,
        recordedBy: currentUser.name,
      };

      if (hasSystolic && hasDiastolic) {
        observation.systolicBp = Number(vitals.systolicBp);
        observation.diastolicBp = Number(vitals.diastolicBp);
      }
      if (vitals.pulseRate.trim() !== '') observation.pulseRate = Number(vitals.pulseRate);
      if (vitals.temperatureC.trim() !== '') observation.temperatureC = vitals.temperatureC;
      if (vitals.respiratoryRate.trim() !== '')
        observation.respiratoryRate = Number(vitals.respiratoryRate);
      if (vitals.spo2Percent.trim() !== '') observation.spo2Percent = Number(vitals.spo2Percent);
      if (vitals.weightKg.trim() !== '') observation.weightKg = vitals.weightKg;
      if (vitals.heightCm.trim() !== '') observation.heightCm = vitals.heightCm;
      if (bmi !== '—' && vitals.weightKg.trim() !== '' && vitals.heightCm.trim() !== '') {
        observation.bmi = bmi;
      }
      if (vitals.bloodGlucoseMmol.trim() !== '')
        observation.bloodGlucoseMmol = vitals.bloodGlucoseMmol;

      await api.recordObservation(observation);
      showToast('Recorded vital signs saved successfully.');
    } catch (err: any) {
      console.error('Failed to save vital signs:', err);
      showToast(`Could not save vital signs: ${err.message}`);
    }
  };

  /**
   * End the visit.
   *
   * Without this the encounter stayed Active forever, the next visit
   * reused it, and the consultation on the second visit was refused as
   * a duplicate of the first — a returning patient was seen but never
   * billed.
   */
  const handleCompleteVisit = async () => {
    if (!activeEncounter) return;

    if (
      !window.confirm(
        "Complete this visit? The clinical record stays, and any unpaid balance stays on the patient's invoice at the cashier.",
      )
    ) {
      return;
    }

    try {
      await api.updateEncounter(activeEncounter.id, { status: 'Completed' });

      const openToken = triageQueue.find(
        (token) => token.patientId === activeEncounter.patientId && token.status === 'In-Progress',
      );

      if (openToken) {
        await api.updateQueueStatus(openToken.id, 'Completed').catch((error: unknown) => {
          console.error('Could not close the triage token:', error);
        });
      }

      showToast('Visit completed. The patient can be seen again as a new visit.');
      setActiveEncounter(null);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Could not complete the visit: ${err.message}`);
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

  const handleWhoSearch = async () => {
    if (whoQuery.trim().length < 2) {
      setWhoNotice('Enter at least two characters to search WHO ICD-11.');
      return;
    }
    setWhoSearching(true);
    setSelectedWho(null);
    try {
      const response = await api.searchIcd11(whoQuery.trim());
      setWhoResults(response.items);
      setWhoNotice(
        response.warning ||
          `WHO ICD-11 MMS ${response.releaseId}. Results are not a complete offline catalogue.`,
      );
    } catch (error: unknown) {
      setWhoResults([]);
      setWhoNotice(error instanceof Error ? error.message : 'WHO search is unavailable.');
    } finally {
      setWhoSearching(false);
    }
  };

  const handleAddDiagnosis = async () => {
    if (!activeEncounter || !activePatient) {
      showToast('Select a patient and start an outpatient visit first.');
      return;
    }

    const description = whoMode
      ? selectedWho?.title || ''
      : customDiagnosisMode
        ? customDiagnosisDescription.trim()
        : selectedIcd?.desc || '';
    const code = whoMode
      ? selectedWho?.code || ''
      : customDiagnosisMode
        ? 'UNCODED'
        : selectedIcd?.code || '';

    if (!description) {
      showToast(
        customDiagnosisMode
          ? 'Enter the clinical diagnosis description first.'
          : 'Select a diagnosis before adding it.',
      );
      return;
    }

    if (!code) {
      showToast('Select or enter a diagnosis before adding it.');
      return;
    }

    try {
      const diag = await api.recordDiagnosis({
        encounterId: activeEncounter.id,
        patientId: activePatient.id,
        codingSystem: whoMode ? 'ICD-11' : 'ICD-10',
        icd10Code: whoMode ? null : code,
        icd10Description: whoMode ? null : description,
        icd11Code: whoMode ? code : null,
        icd11Release: whoMode ? selectedWho?.releaseId : null,
        diagnosisType,
        status: customDiagnosisMode ? 'Provisional' : 'Confirmed',
        notes: customDiagnosisMode
          ? ['Uncoded diagnosis; requires coding review.', customDiagnosisNotes.trim()]
              .filter(Boolean)
              .join(' ')
          : undefined,
        diagnosedBy: currentUser.name,
      });
      setDiagnosisList((prev) => [...prev, diag]);
      showToast(
        customDiagnosisMode
          ? 'Uncoded provisional diagnosis recorded for later coding review.'
          : `Diagnosis ${code} added.`,
      );
      setSelectedIcd(null);
      setSelectedWho(null);
      setCustomDiagnosisDescription('');
      setCustomDiagnosisNotes('');
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handlePrescribe = async () => {
    if (!activeEncounter || !activePatient) {
      showToast('Select a patient and start an outpatient visit first.');
      return;
    }

    if (
      !newMed.drugName.trim() ||
      !newMed.dosage.trim() ||
      !newMed.frequency.trim() ||
      !newMed.duration.trim() ||
      !newMed.route.trim()
    ) {
      showToast('Enter the drug, dosage, frequency, duration, and route.');
      return;
    }

    const quantity = Number(newMed.quantity);
    const unitPrice = Number(newMed.unitPrice);

    if (!newMed.quantity.trim() || !Number.isInteger(quantity) || quantity <= 0) {
      showToast('Enter a valid positive whole-number quantity.');
      return;
    }

    if (!newMed.unitPrice.trim() || !Number.isFinite(unitPrice) || unitPrice < 0) {
      showToast('Enter a valid unit price of zero or more.');
      return;
    }

    /*
     * The server refuses a prescription that matches a recorded
     * allergy until the prescriber acknowledges it. That is a
     * deliberate two-step: the warning cannot be skipped by not
     * looking, but a documented tolerance is not blocked. The
     * acknowledgement is audited server-side.
     */
    const submit = async (allergyAcknowledged: boolean) => {
      const med = await api.prescribeMedication({
        encounterId: activeEncounter.id,
        patientId: activePatient.id,
        drugName: newMed.drugName,
        dosage: newMed.dosage,
        frequency: newMed.frequency,
        duration: newMed.duration,
        route: newMed.route,
        instructions: newMed.instructions,
        quantity,
        unitPrice: unitPrice.toFixed(2),
        status: 'Prescribed',
        prescribedBy: currentUser.name,
        ...(allergyAcknowledged ? { allergyAcknowledged: true } : {}),
      });

      setPrescriptions((prev) => [...prev, med]);

      // Also route patient to Pharmacy Queue. The token is allocated
      // by the server so two prescriptions cannot share one.
      const pharmacyEntry = await api.createQueueItem({
        tenantId: activeEncounter.tenantId,
        facilityId: activeEncounter.facilityId,
        patientId: activePatient.id,
        encounterId: activeEncounter.id,
        queueType: 'Pharmacy',
        priority: 'Normal',
        status: 'Waiting',
        waitingTimeMinutes: 0,
      });

      showToast(
        `Prescription saved and patient routed to Pharmacy — token ${pharmacyEntry.tokenNumber}.`,
      );
    };

    try {
      await submit(false);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'ALLERGY_CONFLICT') {
        const warnings = Array.isArray(err.detail?.warnings)
          ? (err.detail!.warnings as Array<Record<string, unknown>>)
          : [];

        const lines = warnings.map(
          (warning) =>
            `• ${String(warning.allergen)} (${String(warning.severity)
              .replace(/_/g, ' ')
              .toLowerCase()}${warning.reaction ? ` — ${String(warning.reaction)}` : ''})`,
        );

        const confirmed = window.confirm(
          [
            `ALLERGY WARNING for ${activePatient.firstName} ${activePatient.lastName}`,
            '',
            ...lines,
            '',
            String(err.detail?.disclaimer ?? ''),
            '',
            'Prescribe anyway? The override is recorded against your name.',
          ].join('\n'),
        );

        if (!confirmed) {
          showToast('Prescription cancelled. Nothing was saved.');
          return;
        }

        try {
          await submit(true);
        } catch (retryError: any) {
          showToast(`Error: ${retryError.message}`);
        }

        return;
      }

      showToast(`Error: ${err.message}`);
    }
  };

  const handleMedicationChange = async () => {
    if (!medicationChange || !medicationChange.reason.trim() || changingMedication) return;
    setChangingMedication(true);
    try {
      const updated = await api.updateMedicationStatus(
        medicationChange.id,
        medicationChange.action,
        medicationChange.reason,
      );
      setPrescriptions((rows) =>
        rows.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)),
      );
      setMedicationChange(null);
      triggerRefresh();
      showToast(`Prescription status updated to ${updated.status}.`);
    } catch (error: any) {
      showToast(`Prescription status was not changed: ${error.message}`);
    } finally {
      setChangingMedication(false);
    }
  };

  const handleOrderLab = async () => {
    if (submittingLabOrder) return;
    if (!activeEncounter || !activePatient) {
      showToast('Select a patient with an active encounter first.');
      return;
    }

    const seen = new Set<string>();
    const investigations = labInvestigations
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter((name) => {
        if (!name) return false;
        const key = name.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    if (investigations.length === 0) {
      showToast('Enter at least one laboratory investigation.');
      return;
    }
    if (investigations.length > 100 || investigations.some((name) => name.length > 200)) {
      showToast('Enter no more than 100 investigations, with each name up to 200 characters.');
      return;
    }
    if (!labIndication.trim() || !labSpecimenType.trim()) {
      showToast('Enter the clinical indication and specimen type.');
      return;
    }

    setSubmittingLabOrder(true);
    try {
      const result = await api.createLabOrderBatch({
        encounterId: activeEncounter.id,
        patientId: activePatient.id,
        investigations,
        clinicalIndication: labIndication.trim(),
        specimenType: labSpecimenType.trim(),
        priority: labPriority,
        clinicalNotes: labClinicalNotes.trim() || undefined,
        orderedBy: currentUser.name,
      });

      const charges = result.billing ?? [];
      const billedTotal = charges
        .filter((entry) => entry.billing?.charged)
        .reduce((sum, entry) => sum + Number(entry.billing?.totalAmount ?? 0), 0);
      const unbilled = charges.filter((entry) => !entry.billing?.charged);

      if (unbilled.length === 0 && billedTotal > 0) {
        showToast(
          `Created ${result.orders.length} lab order(s) and billed KES ${billedTotal.toFixed(2)} — routed to the Laboratory queue.`,
        );
      } else {
        showToast(
          `Created ${result.orders.length} lab order(s) and routed them to the Laboratory queue. Not billed: ${
            unbilled[0]?.billing?.message ?? 'no laboratory tariff matched'
          }`,
        );
      }
      setSelectedLabTestIds([]);
      setLabInvestigations('');
      setLabSearch('');
      setLabIndication('');
      setLabClinicalNotes('');
      triggerRefresh();
    } catch (err: any) {
      showToast(`Laboratory order failed: ${err.message}`);
    } finally {
      setSubmittingLabOrder(false);
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
              Examining Clinician: <strong className="text-slate-800">{currentUser.name}</strong> (
              {currentUser.role})
            </p>
          </div>

          {activePatient && (
            <div className="flex items-center gap-2">
              {activeEncounter && (
                <button
                  onClick={handleCompleteVisit}
                  className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-md text-xs font-semibold transition-colors"
                >
                  Complete visit
                </button>
              )}
              <button
                onClick={() => {
                  setSelectedPatient(activePatient);
                  setIsJourneyModalOpen(true);
                }}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium transition-colors"
              >
                Full Longitudinal Record
              </button>
            </div>
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
              <span>
                {p.firstName} {p.lastName}
              </span>
              <span
                className={`text-2xs font-mono px-1 rounded ${activePatient?.id === p.id ? 'bg-teal-800 text-teal-100' : 'bg-slate-200 text-slate-600'}`}
              >
                {p.mrn}
              </span>
            </button>
          ))}
        </div>

        {/*
          Who the reception desk has actually sent. Selecting from here
          is the same as selecting from the carousel, but it tells the
          clinician they have someone waiting.
        */}
        {triageQueue.filter((token) => token.status !== 'Completed' && token.status !== 'Cancelled')
          .length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <span className="text-2xs font-semibold text-slate-400 uppercase tracking-wider">
              Waiting in Triage:
            </span>
            {triageQueue
              .filter((token) => token.status !== 'Completed' && token.status !== 'Cancelled')
              .map((token) => {
                const queuedPatient = patients.find((p) => p.id === token.patientId);

                return (
                  <button
                    key={token.id}
                    onClick={() => queuedPatient && selectPatient(queuedPatient)}
                    className="px-2.5 py-1 rounded-md border border-amber-200 bg-amber-50 text-amber-900 text-2xs font-medium hover:bg-amber-100 transition-colors flex items-center gap-1.5"
                  >
                    <Clock className="w-3 h-3" />
                    <span className="font-mono font-bold">{token.tokenNumber}</span>
                    <span>
                      {queuedPatient
                        ? `${queuedPatient.firstName} ${queuedPatient.lastName}`
                        : `Patient #${token.patientId}`}
                    </span>
                    <span className="opacity-70">({token.status})</span>
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {activePatient && activeEncounter ? (
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
                Allergies:{' '}
                <span className="font-bold text-rose-700">
                  {activePatient.allergies || 'None known'}
                </span>
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
                <span className={`px-2 py-0.5 rounded text-2xs ${bpColor}`}>{bpCategory}</span>
              </div>

              {/* BP Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">
                    Systolic BP (mmHg)
                  </label>
                  <input
                    type="number"
                    value={vitals.systolicBp}
                    onChange={(e) => setVitals({ ...vitals, systolicBp: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-md font-mono font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">
                    Diastolic BP (mmHg)
                  </label>
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
                    {bmi || '\u2014'}
                  </div>
                </div>
              </div>

              {/* Blood Glucose */}
              <div>
                <label className="block text-slate-600 font-medium mb-1">
                  Random Blood Sugar (mmol/L)
                </label>
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
                  <option value="Category 1 - Resuscitation">
                    Category 1 - Resuscitation (Immediate)
                  </option>
                  <option value="Category 2 - Emergent">Category 2 - Emergent (Within 10m)</option>
                  <option value="Category 3 - Urgent">Category 3 - Urgent (Within 30m)</option>
                  <option value="Category 4 - Less Urgent">
                    Category 4 - Less Urgent (Within 60m)
                  </option>
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
                <label className="block font-medium text-slate-700 mb-1">
                  History of Present Illness (HPI)
                </label>
                <textarea
                  rows={2}
                  value={notes.historyOfPresentIllness}
                  onChange={(e) => setNotes({ ...notes, historyOfPresentIllness: e.target.value })}
                  placeholder="Onset, character, aggravating/relieving factors, previous episodes..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Physical Examination (CVS, Resp, Abdomen, CNS)
                </label>
                <textarea
                  rows={2}
                  value={notes.physicalExamination}
                  onChange={(e) => setNotes({ ...notes, physicalExamination: e.target.value })}
                  placeholder="Systemic examination findings..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Clinical Assessment & Management Plan
                </label>
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

            {/* Existing diagnoses plus WHO ICD-11 search; historical ICD-10 remains unchanged. */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs text-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="font-bold text-slate-900 uppercase">
                  Diagnostic Coding ({diagnosisList.length})
                </div>
                <span className="text-2xs text-slate-400 font-mono">ICD-10 / WHO ICD-11</span>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-2">
                <select
                  value={
                    whoMode
                      ? '__who__'
                      : customDiagnosisMode
                        ? '__custom__'
                        : selectedIcd?.code || ''
                  }
                  onChange={(e) => {
                    if (e.target.value === '__who__') {
                      setWhoMode(true);
                      setCustomDiagnosisMode(false);
                      setSelectedIcd(null);
                    } else if (e.target.value === '__custom__') {
                      setWhoMode(false);
                      setCustomDiagnosisMode(true);
                      setSelectedIcd(null);
                    } else {
                      setWhoMode(false);
                      setCustomDiagnosisMode(false);
                      setCustomDiagnosisDescription('');
                      setCustomDiagnosisNotes('');
                      const match = commonIcd10List.find((x) => x.code === e.target.value);
                      setSelectedIcd(match || null);
                    }
                  }}
                  className="w-full sm:flex-1 px-3 py-2 border border-slate-200 rounded-md"
                >
                  <option value="">Select a diagnosis...</option>
                  {commonIcd10List.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.code} — {item.desc}
                    </option>
                  ))}
                  <option value="__who__">Search WHO ICD-11</option>
                  <option value="__custom__">Diagnosis not listed — enter manually</option>
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

              {whoMode && (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <label className="block font-semibold text-slate-700" htmlFor="who-icd11-search">
                    WHO ICD-11 code, description or keyword
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="who-icd11-search"
                      value={whoQuery}
                      maxLength={100}
                      onChange={(event) => setWhoQuery(event.target.value)}
                      className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-3 py-2"
                      placeholder="Search terminology (do not enter patient details)"
                    />
                    <button
                      type="button"
                      onClick={handleWhoSearch}
                      disabled={whoSearching}
                      className="rounded bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-50"
                    >
                      {whoSearching ? 'Searching…' : 'Search'}
                    </button>
                  </div>
                  {whoNotice && (
                    <p className="text-slate-600" role="status">
                      {whoNotice}
                    </p>
                  )}
                  {whoResults.length > 0 && (
                    <select
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2"
                      aria-label="Select a WHO ICD-11 result"
                      value={selectedWho?.code ?? ''}
                      onChange={(event) =>
                        setSelectedWho(
                          whoResults.find((item) => item.code === event.target.value) ?? null,
                        )
                      }
                    >
                      <option value="">Select a WHO result…</option>
                      {whoResults.map((item) => (
                        <option key={`${item.releaseId}-${item.code}`} value={item.code}>
                          {item.code} — {item.title} ({item.releaseId})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {customDiagnosisMode && (
                <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="font-semibold text-amber-900">Uncoded diagnosis</div>
                  <p className="text-amber-800">
                    Enter the clinician's diagnosis description. Do not invent an ICD-10 code. This
                    entry will be marked provisional and require coding review.
                  </p>
                  <div>
                    <label className="mb-1 block font-medium text-slate-700">
                      Clinical diagnosis description *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={500}
                      value={customDiagnosisDescription}
                      onChange={(e) => setCustomDiagnosisDescription(e.target.value)}
                      placeholder="Enter the diagnosis as documented by the clinician"
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-medium text-slate-700">
                      Clinical notes (optional)
                    </label>
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={customDiagnosisNotes}
                      onChange={(e) => setCustomDiagnosisNotes(e.target.value)}
                      placeholder="Add relevant clinical context or coding information"
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2"
                    />
                  </div>
                  <div className="text-amber-900">
                    Code: <strong>UNCODED</strong> · Status: <strong>Provisional</strong>
                  </div>
                </div>
              )}
              {/* List of active diagnoses */}
              {diagnosisList.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-100">
                  {diagnosisList.map((d) => (
                    <div
                      key={d.id}
                      className="p-2 rounded bg-slate-50 border border-slate-200 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-teal-800">
                          {d.codingSystem === 'ICD-11' ? d.icd11Code : d.icd10Code}
                        </span>
                        <span className="text-slate-800">
                          {d.codingSystem === 'ICD-11' ? d.icd11Title : d.icd10Description}
                        </span>
                        <span className="text-2xs text-slate-500">
                          {d.codingSystem ?? 'ICD-10'}
                          {d.icd11Release ? ` · ${d.icd11Release}` : ''}
                        </span>
                        <span className="text-2xs text-slate-400 font-sans">
                          ({d.diagnosisType})
                        </span>
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
              {/* Batch Laboratory Order Form */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs space-y-3">
                <div className="font-bold text-slate-900 uppercase flex items-center gap-1.5">
                  <FlaskConical className="w-3.5 h-3.5 text-teal-700" />
                  <span>Order Laboratory Investigations</span>
                </div>

                <div className="rounded-md bg-slate-50 border border-slate-200 p-3 space-y-1">
                  <div>
                    <span className="font-semibold">Patient ID:</span>{' '}
                    {activePatient?.id ?? 'Select patient'}
                  </div>
                  <div>
                    <span className="font-semibold">Encounter ID:</span>{' '}
                    {activeEncounter?.id ?? 'No active encounter'}
                  </div>
                  <div>
                    <span className="font-semibold">Facility:</span>{' '}
                    {currentFacility?.name ?? 'Current facility'}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="block font-semibold text-slate-700">
                    Investigations required * (one per line)
                  </label>
                  <textarea
                    value={labInvestigations}
                    onChange={(e) => setLabInvestigations(e.target.value)}
                    maxLength={20099}
                    rows={5}
                    placeholder={
                      'Complete blood count (CBC)\nMalaria rapid diagnostic test\nUrinalysis'
                    }
                    aria-label="Laboratory investigations, one per line"
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  />
                  <p className="text-slate-500">
                    Type the investigation names directly. Blank lines and duplicate names are
                    ignored. Maximum 100 investigations; each name may contain up to 200 characters.
                  </p>
                </div>
                <label className="block font-semibold text-slate-700">
                  Clinical indication / reason *
                </label>
                <textarea
                  value={labIndication}
                  onChange={(e) => setLabIndication(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  placeholder="Why are these investigations required?"
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />

                <label className="block font-semibold text-slate-700">Specimen type *</label>
                <input
                  value={labSpecimenType}
                  onChange={(e) => setLabSpecimenType(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Blood, Urine"
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />

                <label className="block font-semibold text-slate-700">Priority</label>
                <select
                  value={labPriority}
                  onChange={(e) => setLabPriority(e.target.value as 'Routine' | 'Urgent' | 'STAT')}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                >
                  <option value="Routine">Routine</option>
                  <option value="Urgent">Urgent</option>
                  <option value="STAT">STAT</option>
                </select>

                <label className="block font-semibold text-slate-700">
                  Additional clinical notes (optional)
                </label>
                <textarea
                  value={labClinicalNotes}
                  onChange={(e) => setLabClinicalNotes(e.target.value)}
                  maxLength={5000}
                  rows={2}
                  placeholder="Additional instructions for the laboratory"
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />

                <div className="text-slate-600">
                  {labInvestigations.split(/\r?\n/).filter((name) => name.trim()).length} line(s)
                  entered
                </div>
                <button
                  onClick={handleOrderLab}
                  disabled={
                    submittingLabOrder ||
                    !activePatient ||
                    !activeEncounter ||
                    !labInvestigations.split(/\r?\n/).some((name) => name.trim())
                  }
                  className="w-full py-2 bg-teal-700 text-white rounded-md font-medium hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {submittingLabOrder ? 'Submitting orders...' : 'Submit Orders to Laboratory'}
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
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Route (e.g. Oral)"
                    value={newMed.route}
                    onChange={(e) => setNewMed({ ...newMed, route: e.target.value })}
                    className="px-2 py-1.5 border border-slate-200 rounded"
                  />
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Quantity"
                    value={newMed.quantity}
                    onChange={(e) => setNewMed({ ...newMed, quantity: e.target.value })}
                    className="px-2 py-1.5 border border-slate-200 rounded"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Unit price (KES)"
                    value={newMed.unitPrice}
                    onChange={(e) => setNewMed({ ...newMed, unitPrice: e.target.value })}
                    className="px-2 py-1.5 border border-slate-200 rounded"
                  />
                  <input
                    type="text"
                    placeholder="Instructions (optional)"
                    value={newMed.instructions}
                    onChange={(e) => setNewMed({ ...newMed, instructions: e.target.value })}
                    className="px-2 py-1.5 border border-slate-200 rounded"
                  />
                </div>
                <button
                  onClick={handlePrescribe}
                  className="w-full py-1.5 bg-slate-900 text-white rounded-md font-medium hover:bg-slate-800 transition-colors"
                >
                  Prescribe & Route to Pharmacy
                </button>
                {prescriptions.length > 0 && (
                  <div className="border-t border-slate-200 pt-3 space-y-2">
                    <div className="font-semibold">Prescriptions in this visit</div>
                    {prescriptions.map((med) => (
                      <div key={med.id} className="rounded border border-slate-200 p-2 space-y-1">
                        <div>
                          <strong>{med.drugName}</strong> · {med.status} · prescribed {med.quantity}
                          , dispensed {med.quantityDispensed ?? 0}
                        </div>
                        {['Prescribed', 'Partially Dispensed', 'On Hold'].includes(med.status) && (
                          <select
                            aria-label={`Change status for ${med.drugName}`}
                            value={medicationChange?.id === med.id ? medicationChange.action : ''}
                            onChange={(event) =>
                              setMedicationChange(
                                event.target.value
                                  ? { id: med.id, action: event.target.value, reason: '' }
                                  : null,
                              )
                            }
                            className="w-full border border-slate-200 rounded p-1"
                          >
                            <option value="">Select a clinical status change</option>
                            {med.status !== 'On Hold' && (
                              <option value="On Hold">Put on hold</option>
                            )}
                            {med.status === 'On Hold' && <option value="Resume">Resume</option>}
                            {(med.quantityDispensed ?? 0) === 0 && (
                              <option value="Cancelled">Cancel</option>
                            )}
                            <option value="Discontinued">Discontinue</option>
                          </select>
                        )}
                        {medicationChange?.id === med.id && (
                          <div className="space-y-1">
                            <label className="block" htmlFor={`med-reason-${med.id}`}>
                              Reason for this change
                            </label>
                            <input
                              id={`med-reason-${med.id}`}
                              value={medicationChange.reason}
                              maxLength={1000}
                              onChange={(event) =>
                                setMedicationChange({
                                  ...medicationChange,
                                  reason: event.target.value,
                                })
                              }
                              className="w-full border border-slate-200 rounded p-1"
                            />
                            <button
                              type="button"
                              onClick={handleMedicationChange}
                              disabled={changingMedication || !medicationChange.reason.trim()}
                              className="rounded bg-slate-800 text-white px-2 py-1 disabled:opacity-50"
                            >
                              {changingMedication ? 'Saving...' : 'Record status change'}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : activePatient ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
          <h3 className="text-sm font-bold text-slate-900">No active outpatient visit</h3>
          <p className="text-xs text-slate-500">
            {activePatient.firstName} {activePatient.lastName} · {activePatient.mrn}
          </p>
          <p className="text-xs text-slate-500">
            Start a visit to record triage, observations, consultation notes, and orders.
          </p>
          <button
            type="button"
            onClick={startVisit}
            className="px-4 py-2 bg-teal-700 text-white rounded-lg text-xs font-semibold hover:bg-teal-800"
          >
            Start outpatient visit
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-xs text-slate-400">
          Please select a patient above to view an active visit or start a new one.
        </div>
      )}
    </div>
  );
};
