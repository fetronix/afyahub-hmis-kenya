import React, { useState, useEffect } from 'react';
import { useHmis } from '../context/HmisContext.tsx';
import { api } from '../api/client.ts';
import { Patient, Encounter, Observation, Diagnosis, Medication, LabOrder, LabResult, BillingInvoice } from '../types/index.ts';
import { 
  X, 
  User, 
  Heart, 
  AlertTriangle, 
  Stethoscope, 
  Pill, 
  FlaskConical, 
  Receipt, 
  FileText,
  Clock,
  Shield,
  Download
} from 'lucide-react';

export const PatientJourneyModal: React.FC = () => {
  const { selectedPatient, isJourneyModalOpen, setIsJourneyModalOpen, showToast } = useHmis();
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [labOrders, setLabOrders] = useState<LabOrder[]>([]);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [activeTab, setActiveTab] = useState<'timeline' | 'vitals' | 'diagnoses' | 'meds' | 'labs' | 'billing' | 'fhir'>('timeline');
  const [fhirJson, setFhirJson] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedPatient || !isJourneyModalOpen) return;

    async function loadPatientDetails() {
      setLoading(true);
      try {
        const [encs, vitals, diags, meds, labs, invs, fhir] = await Promise.all([
          api.getEncounters(selectedPatient!.id),
          api.getObservations(undefined, selectedPatient!.id),
          api.getDiagnoses(undefined, selectedPatient!.id),
          api.getMedications(undefined, selectedPatient!.id),
          api.getLabOrders(undefined, selectedPatient!.id),
          api.getInvoices(undefined, selectedPatient!.id),
          api.getFhirPatient(selectedPatient!.id).catch(() => null),
        ]);

        setEncounters(encs);
        setObservations(vitals);
        setDiagnoses(diags);
        setMedications(meds);
        setLabOrders(labs);
        setInvoices(invs);
        if (fhir) {
          setFhirJson(JSON.stringify(fhir, null, 2));
        }
      } catch (err) {
        console.error('Failed to load patient longitudinal records:', err);
      } finally {
        setLoading(false);
      }
    }

    loadPatientDetails();
  }, [selectedPatient, isJourneyModalOpen]);

  if (!isJourneyModalOpen || !selectedPatient) return null;

  const downloadFhir = () => {
    const blob = new Blob([fhirJson], { type: 'application/fhir+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FHIR-Patient-${selectedPatient.mrn}.json`;
    a.click();
    showToast('Downloaded HL7 FHIR R4 Patient Resource');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-2 sm:p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-5xl h-[92vh] sm:h-[88vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-blue-700 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-xs border-2 border-orange-400">
              {selectedPatient.firstName[0]}{selectedPatient.lastName[0]}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h2 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                  {selectedPatient.firstName} {selectedPatient.middleName ? `${selectedPatient.middleName} ` : ''}{selectedPatient.lastName}
                </h2>
                <span className="font-mono text-2xs sm:text-xs px-2 py-0.5 bg-slate-200 text-slate-800 rounded font-semibold">
                  {selectedPatient.mrn}
                </span>
                <span className="text-2xs sm:text-xs px-2 py-0.5 bg-orange-50 text-orange-900 border border-orange-200 rounded font-semibold">
                  {selectedPatient.payerType} {selectedPatient.shaNumber ? `· ${selectedPatient.shaNumber}` : ''}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-2xs sm:text-xs text-slate-500 mt-1">
                <span>DOB: <strong className="text-slate-700">{selectedPatient.dateOfBirth}</strong></span>
                <span className="hidden sm:inline">·</span>
                <span>Gender: <strong className="text-slate-700">{selectedPatient.gender}</strong></span>
                <span className="hidden sm:inline">·</span>
                <span>Phone: <strong className="font-mono text-slate-700">{selectedPatient.phone}</strong></span>
                <span className="hidden sm:inline">·</span>
                <span>County: <strong className="text-slate-700">{selectedPatient.county}</strong></span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <button
              onClick={downloadFhir}
              className="px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-blue-700" />
              <span>Export FHIR</span>
            </button>
            <button
              onClick={() => setIsJourneyModalOpen(false)}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Clinical Alerts Strip */}
        <div className="px-4 sm:px-6 py-2 bg-orange-50/70 border-b border-orange-200/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 text-xs text-orange-950 shrink-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-orange-600 shrink-0" />
              <span>Allergies: <strong className="text-orange-900">{selectedPatient.allergies || 'None known'}</strong></span>
            </div>
            <span className="hidden sm:inline">·</span>
            <div>
              <span>Chronic Conditions: <strong className="text-orange-900">{selectedPatient.chronicConditions || 'None known'}</strong></span>
            </div>
          </div>
          <div className="flex items-center gap-1 text-2xs text-orange-800">
            <span>Next of Kin:</span>
            <strong>{selectedPatient.emergencyContactName || 'None'} ({selectedPatient.emergencyContactRelationship || 'N/A'}) - {selectedPatient.emergencyContactPhone || ''}</strong>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-4 sm:px-6 border-b border-slate-200 bg-white flex items-center gap-4 sm:gap-6 text-xs font-medium text-slate-600 shrink-0 overflow-x-auto">
          {[
            { id: 'timeline', label: 'Longitudinal Journey' },
            { id: 'vitals', label: `Vital Signs (${observations.length})` },
            { id: 'diagnoses', label: `ICD-10 Diagnoses (${diagnoses.length})` },
            { id: 'meds', label: `Prescriptions (${medications.length})` },
            { id: 'labs', label: `Lab Investigations (${labOrders.length})` },
            { id: 'billing', label: `Financial Invoices (${invoices.length})` },
            { id: 'fhir', label: 'HL7 FHIR R4 Schema' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-3 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'border-orange-500 text-blue-950 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Body */}
        <div className="flex-1 p-4 sm:p-6 overflow-y-auto bg-slate-50/50">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-slate-400 text-xs">
              Loading longitudinal patient history...
            </div>
          ) : (
            <>
              {/* TIMELINE TAB */}
              {activeTab === 'timeline' && (
                <div className="space-y-6">
                  {encounters.length === 0 ? (
                    <div className="text-center py-12 text-xs text-slate-500">
                      No clinical encounters recorded yet for this patient.
                    </div>
                  ) : (
                    encounters.map((enc) => (
                      <div key={enc.id} className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 text-sm">
                              {enc.encounterType} Encounter
                            </span>
                            <span className="px-2 py-0.5 text-2xs rounded bg-slate-100 text-slate-700">
                              {enc.triageCategory}
                            </span>
                            <span className="px-2 py-0.5 text-2xs rounded bg-blue-50 text-blue-800 font-medium">
                              {enc.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{new Date(enc.startedAt).toLocaleString('en-KE')}</span>
                          </div>
                        </div>

                        <div className="mt-3 space-y-2 text-xs">
                          {enc.chiefComplaint && (
                            <div>
                              <span className="text-slate-500 font-medium">Chief Complaint: </span>
                              <span className="text-slate-800">{enc.chiefComplaint}</span>
                            </div>
                          )}
                          {enc.historyOfPresentIllness && (
                            <div>
                              <span className="text-slate-500 font-medium">History of Present Illness: </span>
                              <p className="text-slate-700 mt-0.5 leading-relaxed">{enc.historyOfPresentIllness}</p>
                            </div>
                          )}
                          {enc.physicalExamination && (
                            <div>
                              <span className="text-slate-500 font-medium">Physical Examination: </span>
                              <p className="text-slate-700 mt-0.5 leading-relaxed">{enc.physicalExamination}</p>
                            </div>
                          )}
                          {enc.clinicalNotes && (
                            <div>
                              <span className="text-slate-500 font-medium">Clinical Notes & Assessment: </span>
                              <p className="text-slate-700 mt-0.5 leading-relaxed">{enc.clinicalNotes}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* VITALS TAB */}
              {activeTab === 'vitals' && (
                <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto shadow-xs">
                  <table className="w-full text-xs text-left min-w-[640px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-2xs">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Date & Time</th>
                        <th className="px-4 py-2.5 font-medium">Blood Pressure</th>
                        <th className="px-4 py-2.5 font-medium">Pulse (bpm)</th>
                        <th className="px-4 py-2.5 font-medium">Temp (°C)</th>
                        <th className="px-4 py-2.5 font-medium">Resp (cpm)</th>
                        <th className="px-4 py-2.5 font-medium">SpO2</th>
                        <th className="px-4 py-2.5 font-medium">Weight / BMI</th>
                        <th className="px-4 py-2.5 font-medium">Recorded By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {observations.map((obs) => (
                        <tr key={obs.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5 text-slate-600 font-sans">
                            {new Date(obs.recordedAt).toLocaleString('en-KE')}
                          </td>
                          <td className="px-4 py-2.5 font-semibold text-slate-900">
                            {obs.systolicBp}/{obs.diastolicBp} mmHg
                          </td>
                          <td className="px-4 py-2.5 text-slate-800">{obs.pulseRate || '—'}</td>
                          <td className="px-4 py-2.5 text-slate-800">{obs.temperatureC || '—'} °C</td>
                          <td className="px-4 py-2.5 text-slate-800">{obs.respiratoryRate || '—'}</td>
                          <td className="px-4 py-2.5 text-slate-800">{obs.spo2Percent ? `${obs.spo2Percent}%` : '—'}</td>
                          <td className="px-4 py-2.5 text-slate-800">
                            {obs.weightKg ? `${obs.weightKg} kg (BMI: ${obs.bmi || '—'})` : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 font-sans">{obs.recordedBy || 'Nurse'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* DIAGNOSES TAB */}
              {activeTab === 'diagnoses' && (
                <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto shadow-xs">
                  <table className="w-full text-xs text-left min-w-[600px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-2xs">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">ICD-10 Code</th>
                        <th className="px-4 py-2.5 font-medium">Description</th>
                        <th className="px-4 py-2.5 font-medium">Type</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Diagnosed By</th>
                        <th className="px-4 py-2.5 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {diagnoses.map((d) => (
                        <tr key={d.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5 font-mono font-bold text-teal-800">{d.icd10Code}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-900">{d.icd10Description}</td>
                          <td className="px-4 py-2.5 text-slate-600">{d.diagnosisType}</td>
                          <td className="px-4 py-2.5">
                            <span className="px-2 py-0.5 rounded text-2xs bg-emerald-50 text-emerald-700 font-medium">
                              {d.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{d.diagnosedBy || 'Physician'}</td>
                          <td className="px-4 py-2.5 text-slate-400 font-mono text-2xs">
                            {new Date(d.diagnosedAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* MEDS TAB */}
              {activeTab === 'meds' && (
                <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto shadow-xs">
                  <table className="w-full text-xs text-left min-w-[640px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-2xs">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Medication</th>
                        <th className="px-4 py-2.5 font-medium">Dosage & Frequency</th>
                        <th className="px-4 py-2.5 font-medium">Duration</th>
                        <th className="px-4 py-2.5 font-medium">Instructions</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Prescriber</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {medications.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5 font-semibold text-slate-900">{m.drugName}</td>
                          <td className="px-4 py-2.5 text-slate-700">{m.dosage} · {m.frequency}</td>
                          <td className="px-4 py-2.5 text-slate-600">{m.duration} ({m.route})</td>
                          <td className="px-4 py-2.5 text-slate-600">{m.instructions || 'As instructed'}</td>
                          <td className="px-4 py-2.5">
                            <span className={`px-2 py-0.5 rounded text-2xs font-medium ${
                              m.status === 'Dispensed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                            }`}>
                              {m.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{m.prescribedBy || 'Doctor'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* LABS TAB */}
              {activeTab === 'labs' && (
                <div className="space-y-4">
                  {labOrders.map((lo) => (
                    <div key={lo.id} className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <div>
                          <span className="font-semibold text-slate-900 text-sm">{lo.testName}</span>
                          <span className="ml-2 font-mono text-2xs text-slate-400">
                            {lo.sampleAccessionNumber || 'Accession Pending'}
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-2xs font-medium ${
                          lo.status === 'Published' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {lo.status}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-600 flex items-center justify-between">
                        <span>Ordered by: <strong>{lo.orderedBy || 'Clinician'}</strong></span>
                        <span className="font-mono text-slate-400 text-2xs">
                          {new Date(lo.orderedAt).toLocaleString('en-KE')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* BILLING TAB */}
              {activeTab === 'billing' && (
                <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto shadow-xs">
                  <table className="w-full text-xs text-left min-w-[620px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-2xs">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Invoice #</th>
                        <th className="px-4 py-2.5 font-medium">Payer Details</th>
                        <th className="px-4 py-2.5 font-medium text-right">Total Amount</th>
                        <th className="px-4 py-2.5 font-medium text-right">Paid</th>
                        <th className="px-4 py-2.5 font-medium text-right">Balance</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5 font-bold text-slate-900">{inv.invoiceNumber}</td>
                          <td className="px-4 py-2.5 text-slate-700 font-sans">
                            {inv.payerType} {inv.payerName ? `(${inv.payerName})` : ''}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-slate-900">
                            KES {Number(inv.totalAmount).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right text-emerald-700">
                            KES {Number(inv.paidAmount).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-rose-700">
                            KES {Number(inv.balanceAmount).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 font-sans">
                            <span className={`px-2 py-0.5 rounded text-2xs font-medium ${
                              inv.status === 'Paid' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                            }`}>
                              {inv.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* FHIR SCHEMA TAB */}
              {activeTab === 'fhir' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>HL7 FHIR R4 JSON Representation (Digital Health Agency Compatible)</span>
                    <button
                      onClick={downloadFhir}
                      className="px-2.5 py-1 bg-teal-700 text-white rounded text-2xs font-medium hover:bg-teal-800 transition-colors"
                    >
                      Download .json
                    </button>
                  </div>
                  <pre className="p-4 bg-slate-900 text-emerald-400 rounded-lg text-xs font-mono overflow-x-auto max-h-96">
                    {fhirJson || '// Generating FHIR Patient Structure...'}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
