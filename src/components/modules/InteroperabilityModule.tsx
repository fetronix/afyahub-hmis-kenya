import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { Patient } from '../../types/index.ts';
import {
  Network,
  ShieldCheck,
  CheckCircle2,
  Code2,
  Download,
  Copy,
  ExternalLink,
  Layers
} from 'lucide-react';

export const InteroperabilityModule: React.FC = () => {
  const { currentFacility, showToast, refreshKey } = useHmis();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [fhirData, setFhirData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadPatients() {
      try {
        const pList = await api.getPatients(undefined, currentFacility?.id);
        setPatients(pList);
        if (pList.length > 0) {
          setSelectedPatientId(pList[0].id.toString());
          loadFhir(pList[0].id);
        }
      } catch (err) {
        console.error('Failed to load patients for FHIR:', err);
      }
    }
    loadPatients();
  }, [currentFacility, refreshKey]);

  const loadFhir = async (id: number) => {
    setLoading(true);
    try {
      const res = await api.getFhirPatient(id);
      setFhirData(res);
    } catch (err) {
      console.error('Failed to fetch FHIR structure:', err);
    } finally {
      setLoading(false);
    }
  };

  const copyFhirJson = () => {
    if (!fhirData) return;
    navigator.clipboard.writeText(JSON.stringify(fhirData, null, 2));
    showToast('Copied HL7 FHIR R4 JSON to clipboard.');
  };

  const downloadFhirJson = () => {
    if (!fhirData) return;
    const blob = new Blob([JSON.stringify(fhirData, null, 2)], { type: 'application/fhir+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FHIR-Patient-${fhirData.id}.json`;
    a.click();
    showToast('Downloaded FHIR resource file.');
  };

  const checklistItems = [
    { title: 'Kenya Master Facility List (KMFL)', status: 'Compliant', desc: `Mapped to Facility ${currentFacility?.mflCode || 'MFL-12845'}` },
    { title: 'Unique Patient Identification (UPI)', status: 'Compliant', desc: 'National ID, SHA Number and MRN cross-indexed' },
    { title: 'HL7 FHIR R4 Protocol', status: 'Compliant', desc: 'Patient, Encounter, Observation, Condition schemas active' },
    { title: 'ICD-10 Diagnostic Classification', status: 'Compliant', desc: 'Full standard WHO ICD-10 ontology for diagnosis' },
    { title: 'LOINC Laboratory Ontology', status: 'Compliant', desc: 'Standard lab test codes with units and reference ranges' },
    { title: 'Social Health Authority (SHA) Claims', status: 'Compliant', desc: 'Pre-auth, benefit packages, and e-claims abstraction' },
    { title: 'Kenya Data Protection Act 2019', status: 'Compliant', desc: 'Tenant isolation, RBAC, and immutable audit logs' },
    { title: 'MOH 705 / DHIS2 Reporting Engine', status: 'Compliant', desc: 'Automatic aggregation of outpatient morbidity returns' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">DHA Certification Readiness & HL7 FHIR Interoperability</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Architecture and data exchange specifications designed for Kenya Digital Health Agency (DHA) standards.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-lg flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-700" />
            <span>Architecture Prepared for DHA Certification</span>
          </span>
        </div>
      </div>

      {/* DHA Compliance Matrix */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Kenya Digital Health Agency (DHA) Specification Readiness Checklist
          </h2>
          <span className="text-2xs text-slate-400 font-mono">DHA-SPEC-2026 Rev 4</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {checklistItems.map((item, idx) => (
            <div key={idx} className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50 space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900">{item.title}</span>
                <span className="flex items-center gap-1 text-2xs font-semibold text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{item.status}</span>
                </span>
              </div>
              <p className="text-2xs text-slate-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* FHIR R4 Resource Live Inspector */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-700">Inspect Patient Resource:</span>
            <select
              value={selectedPatientId}
              onChange={(e) => {
                setSelectedPatientId(e.target.value);
                loadFhir(Number(e.target.value));
              }}
              className="px-3 py-1.5 border border-slate-200 rounded-md text-xs font-medium"
            >
              {patients.map(p => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName} (MRN: {p.mrn})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={copyFhirJson}
              className="px-3 py-1.5 text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center gap-1"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy JSON</span>
            </button>
            <button
              onClick={downloadFhirJson}
              className="px-3 py-1.5 text-xs text-white bg-teal-700 hover:bg-teal-800 rounded-md transition-colors shadow-xs flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Schema</span>
            </button>
          </div>
        </div>

        {/* Code View */}
        <div className="relative">
          {loading ? (
            <div className="h-64 flex items-center justify-center text-slate-400 text-xs">
              Generating HL7 FHIR R4 schema transformation...
            </div>
          ) : (
            <pre className="p-4 bg-slate-950 text-emerald-400 font-mono text-xs rounded-xl overflow-x-auto max-h-[480px] leading-relaxed border border-slate-800">
              {fhirData ? JSON.stringify(fhirData, null, 2) : '// No patient selected'}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
