import { DataTable } from '../../ui/layout.tsx';
import React, { useCallback, useEffect, useState } from 'react';
import { FileCheck, Lock, Plus, RefreshCw, Send } from 'lucide-react';
import type { Patient } from '../../../types/index.ts';
import {
  shaEclaimsApi,
  type ShaPreauthRecord,
  type ShaServiceMappingRecord,
} from '../../../api/sha-eclaims.client.ts';

interface Props {
  facilityId: number | null;
  patients: Patient[];
  canCreatePreauth: boolean;
  showToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

function statusPillClass(status: string): string {
  switch (status) {
    case 'APPROVED':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'PARTIALLY_APPROVED':
      return 'bg-brand-50 text-brand-700 border-brand-200';
    case 'PENDING':
      return 'bg-amber-50 text-amber-900 border-amber-200';
    case 'REJECTED':
    case 'EXPIRED':
      return 'bg-rose-50 text-rose-800 border-rose-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-300';
  }
}

export const PreauthorizationWorkspace: React.FC<Props> = ({
  facilityId,
  patients,
  canCreatePreauth,
  showToast,
}) => {
  const [preauths, setPreauths] = useState<ShaPreauthRecord[]>([]);
  const [mappings, setMappings] = useState<ShaServiceMappingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPreauth, setSelectedPreauth] = useState<ShaPreauthRecord | null>(null);

  // Create form
  const [patientId, setPatientId] = useState<number | ''>('');
  const [category, setCategory] = useState('SURGICAL');
  const [requestedServiceCode, setRequestedServiceCode] = useState('');
  const [requestedServiceName, setRequestedServiceName] = useState('');
  const [primaryDiagnosisCode, setPrimaryDiagnosisCode] = useState('');
  const [primaryDiagnosisDisplay, setPrimaryDiagnosisDisplay] = useState('');
  const [codingSystem, setCodingSystem] = useState<'ICD-10' | 'ICD-11' | ''>('');
  const [clinicalIndication, setClinicalIndication] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [estimatedAmount, setEstimatedAmount] = useState('');
  const [supportingNotes, setSupportingNotes] = useState('');
  const [isElective, setIsElective] = useState(false);
  const [practitionerRegNumber, setPractitionerRegNumber] = useState('');
  const [practitionerRegulator, setPractitionerRegulator] = useState('KMPDC');
  const [submittingForm, setSubmittingForm] = useState(false);

  // Decision / Amendment drawer state
  const [decisionStatus, setDecisionStatus] = useState('');
  const [payerAuthRef, setPayerAuthRef] = useState('');
  const [approvedAmount, setApprovedAmount] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [amendEstimatedAmount, setAmendEstimatedAmount] = useState('');
  const [amendmentReason, setAmendmentReason] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [paRes, mapRes] = await Promise.all([
        shaEclaimsApi.listPreauthorizations(facilityId),
        shaEclaimsApi.listServiceMappings(facilityId),
      ]);
      setPreauths(paRes.preauthorizations);
      setMappings(mapRes.mappings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load preauthorizations.');
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientId) {
      showToast('Select a patient first.', 'warning');
      return;
    }
    setSubmittingForm(true);
    try {
      const res = await shaEclaimsApi.createPreauthorization(facilityId, {
        patientId: Number(patientId),
        category,
        requestedServiceCode,
        requestedServiceName,
        primaryDiagnosisCode,
        primaryDiagnosisDisplay,
        codingSystem,
        clinicalIndication,
        quantity,
        estimatedAmount,
        isElective,
        practitionerRegNumber: practitionerRegNumber.trim() || undefined,
        practitionerRegulator: practitionerRegNumber.trim() ? practitionerRegulator : undefined,
        supportingNotes: supportingNotes.trim() || undefined,
      });
      showToast(`Created preauthorization ${res.preauthorization.preauthNumber}`, 'success');
      setClinicalIndication('');
      setSupportingNotes('');
      await loadData();
      setSelectedPreauth(res.preauthorization);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create preauthorization.', 'error');
    } finally {
      setSubmittingForm(false);
    }
  };

  const handleSubmitGateway = async (pa: ShaPreauthRecord) => {
    try {
      const res = await shaEclaimsApi.submitPreauthorization(pa.id, facilityId, {
        protocol: pa.hasConsentToken ? 'HIE_PREAUTH' : 'FHIR_BUNDLE',
      });
      showToast(
        `Submitted ${res.preauthorization.preauthNumber} (${
          res.gateway.isSimulated ? 'Sandbox Simulation' : res.gateway.mode
        })`,
        'info',
      );
      await loadData();
      setSelectedPreauth(res.preauthorization);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gateway submission failed.', 'error');
    }
  };

  const handleRecordDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPreauth) return;
    try {
      const res = await shaEclaimsApi.updatePreauthorization(selectedPreauth.id, facilityId, {
        status: decisionStatus,
        payerAuthReference: payerAuthRef.trim() || undefined,
        approvedAmount: approvedAmount.trim() || undefined,
        validFrom: validFrom || undefined,
        validUntil: validUntil || undefined,
        rejectionReason: rejectionReason.trim() || undefined,
      });
      showToast(
        `Updated ${res.preauthorization.preauthNumber} -> ${res.preauthorization.status}`,
        'success',
      );
      await loadData();
      setSelectedPreauth(res.preauthorization);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to record payer decision.', 'error');
    }
  };

  const handleAmendApprovedScope = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPreauth) return;
    try {
      const res = await shaEclaimsApi.updatePreauthorization(selectedPreauth.id, facilityId, {
        estimatedAmount: amendEstimatedAmount,
        amendmentReason,
      });
      showToast(
        `Scope amended (reset to DRAFT for re-submission, amendment #${res.preauthorization.amendmentCount}).`,
        'info',
      );
      setAmendmentReason('');
      await loadData();
      setSelectedPreauth(res.preauthorization);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Scope amendment failed.', 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left: Request Form */}
      <form onSubmit={handleCreate} className="lg:col-span-5 panel p-5 bg-white space-y-3.5">
        <div>
          <span className="eyebrow text-brand-700">Kenya eClaims FHIR T-02</span>
          <h3 className="text-base font-bold text-navy-900">New SHA Preauthorization Request</h3>
          <p className="text-xs text-slate-600 mt-0.5">
            Required for Surgical, CT/MRI Imaging, Oncology, Renal Dialysis, and Optical packages.
            Authorization numbers are never fabricated locally.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="field-label">Patient</label>
            <select
              value={patientId}
              onChange={(e) => setPatientId(e.target.value ? Number(e.target.value) : '')}
              className="field-input"
              required
            >
              <option value="">— Select Patient —</option>
              {patients.slice(0, 60).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName} ({p.mrn})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Preauth Profile Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="field-input"
            >
              <option value="SURGICAL">Surgical / Theatre</option>
              <option value="IMAGING">Advanced Imaging (CT / MRI)</option>
              <option value="ONCOLOGY">Oncology Care</option>
              <option value="RENAL">Renal / Dialysis</option>
              <option value="OPTICAL">Optical Care</option>
              <option value="GENERAL">General SHIF Preauth</option>
            </select>
          </div>
        </div>

        {mappings.length > 0 && (
          <div>
            <label className="field-label">Prefill from Mapped SHA Service (Optional)</label>
            <select
              onChange={(e) => {
                const m = mappings.find((row) => String(row.id) === e.target.value);
                if (m) {
                  setRequestedServiceCode(m.payerServiceCode);
                  setRequestedServiceName(m.payerServiceName);
                  if (m.reimbursementTariff) setEstimatedAmount(m.reimbursementTariff);
                  if (m.preauthCategory) setCategory(m.preauthCategory);
                }
              }}
              className="field-input"
              defaultValue=""
            >
              <option value="">— Choose mapped SHA service —</option>
              {mappings.map((m) => (
                <option key={m.id} value={m.id}>
                  [{m.payerServiceCode}] {m.payerServiceName}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="field-label">SHA Intervention Code</label>
            <input
              type="text"
              value={requestedServiceCode}
              onChange={(e) => setRequestedServiceCode(e.target.value)}
              placeholder="e.g. SHA-IMG-004"
              className="field-input"
              required
            />
          </div>
          <div>
            <label className="field-label">Requested Service Name</label>
            <input
              type="text"
              value={requestedServiceName}
              onChange={(e) => setRequestedServiceName(e.target.value)}
              placeholder="e.g. Brain MRI with Contrast"
              className="field-input"
              required
            />
          </div>
        </div>

        <label className="field-label">
          Recorded diagnosis system
          <select
            value={codingSystem}
            onChange={(e) => setCodingSystem(e.target.value as 'ICD-10' | 'ICD-11' | '')}
            className="field-input"
            required
          >
            <option value="">— Select recorded system —</option>
            <option value="ICD-10">ICD-10</option>
            <option value="ICD-11">ICD-11</option>
          </select>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="field-label">Primary diagnosis code</label>
            <input
              type="text"
              value={primaryDiagnosisCode}
              onChange={(e) => setPrimaryDiagnosisCode(e.target.value)}
              placeholder="e.g. 8B20"
              className="field-input"
              required
            />
          </div>
          <div>
            <label className="field-label">Diagnosis Description</label>
            <input
              type="text"
              value={primaryDiagnosisDisplay}
              onChange={(e) => setPrimaryDiagnosisDisplay(e.target.value)}
              placeholder="e.g. Acute ischaemic stroke"
              className="field-input"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Quantity</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              className="field-input"
              required
            />
          </div>
          <div>
            <label className="field-label">Estimated Amount (KES)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={estimatedAmount}
              onChange={(e) => setEstimatedAmount(e.target.value)}
              placeholder="0.00"
              className="field-input"
              required
            />
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs">
          <label className="inline-flex items-center gap-2 font-semibold text-navy-900">
            <input
              type="checkbox"
              checked={isElective}
              onChange={(e) => setIsElective(e.target.checked)}
            />{' '}
            Elective pre-visit request
          </label>
          <p>
            HIE consent capture and external submission are unavailable until authorized,
            facility-isolated transport is verified. Do not enter OTPs here.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={practitionerRegNumber}
              onChange={(e) => setPractitionerRegNumber(e.target.value)}
              placeholder="Practitioner registration number (optional)"
              className="field-input text-xs"
            />
            <select
              value={practitionerRegulator}
              onChange={(e) => setPractitionerRegulator(e.target.value)}
              className="field-input text-xs"
            >
              <option value="KMPDC">KMPDC (Medical/Dental)</option>
              <option value="COC">COC (Clinical Officers)</option>
              <option value="NCK">NCK (Nursing Council)</option>
              <option value="PPB">PPB (Pharmacy)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="field-label">Clinical Indication</label>
          <textarea
            rows={2}
            value={clinicalIndication}
            onChange={(e) => setClinicalIndication(e.target.value)}
            placeholder="Summarize objective clinical findings justifying preauthorization..."
            className="field-input"
            required
          />
        </div>

        <button
          type="submit"
          disabled={!canCreatePreauth || submittingForm}
          className="btn-accent w-full justify-center disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          {submittingForm ? 'Saving Draft...' : 'Create Preauthorization Request'}
        </button>
      </form>

      {/* Right: Preauthorizations Queue & Selected Detail */}
      <div className="lg:col-span-7 space-y-4">
        <div className="panel p-5 bg-white space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="eyebrow text-brand-700">Preauthorization Register</span>
              <h3 className="text-base font-bold text-navy-900">
                Active & Historical Requests ({preauths.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={() => void loadData()}
              className="btn-quiet text-xs flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
              {error}
            </div>
          )}

          <div className="overflow-x-auto">
            <DataTable className="table-quiet w-full text-xs text-left">
              <thead>
                <tr>
                  <th>Preauth #</th>
                  <th>Patient</th>
                  <th>Service</th>
                  <th>Est. / Approved</th>
                  <th>Status</th>
                  <th>Payer Auth Ref</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {preauths.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No SHA preauthorization requests recorded yet.
                    </td>
                  </tr>
                ) : (
                  preauths.map((pa) => (
                    <tr
                      key={pa.id}
                      onClick={() => {
                        setSelectedPreauth(pa);
                        setDecisionStatus('');
                        setPayerAuthRef('');
                        setApprovedAmount('');
                        setValidFrom('');
                        setValidUntil('');
                        setRejectionReason('');
                        setAmendEstimatedAmount(pa.estimatedAmount);
                      }}
                      className={`cursor-pointer ${
                        selectedPreauth?.id === pa.id ? 'bg-brand-50/60' : ''
                      }`}
                    >
                      <td className="font-mono font-semibold text-navy-900">{pa.preauthNumber}</td>
                      <td>{pa.patientName ?? `Patient #${pa.patientId}`}</td>
                      <td>
                        <div className="font-medium text-navy-900">{pa.requestedServiceName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {pa.requestedServiceCode} · {pa.category}
                        </div>
                      </td>
                      <td>
                        <div>Est: KES {Number(pa.estimatedAmount).toLocaleString()}</div>
                        <div className="text-[11px] text-brand-700 font-semibold">
                          Appr:{' '}
                          {pa.approvedAmount
                            ? `KES ${Number(pa.approvedAmount).toLocaleString()}`
                            : '—'}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusPillClass(
                            pa.status,
                          )}`}
                        >
                          {pa.status}
                        </span>
                        {pa.isSimulated && (
                          <div className="text-[10px] text-copper-700 font-semibold mt-0.5">
                            SANDBOX_SIM
                          </div>
                        )}
                      </td>
                      <td className="font-mono">{pa.payerAuthReference ?? '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {(pa.status === 'DRAFT' || pa.status === 'REJECTED') &&
                          canCreatePreauth && (
                            <button
                              type="button"
                              onClick={() => void handleSubmitGateway(pa)}
                              disabled
                              title="External SHA transport is unavailable"
                              className="inline-flex items-center gap-1 text-brand-700 hover:underline font-semibold"
                            >
                              <Send className="w-3 h-3" />
                              External submission unavailable
                            </button>
                          )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </DataTable>
          </div>
        </div>

        {selectedPreauth && canCreatePreauth && (
          <div className="panel p-5 bg-white space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <span className="eyebrow text-slate-500">Selected Request</span>
                <h4 className="text-sm font-bold text-navy-900">
                  {selectedPreauth.preauthNumber} · {selectedPreauth.requestedServiceName}
                </h4>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusPillClass(
                  selectedPreauth.status,
                )}`}
              >
                {selectedPreauth.status}
              </span>
            </div>

            {selectedPreauth.status === 'APPROVED' ||
            selectedPreauth.status === 'PARTIALLY_APPROVED' ? (
              <form onSubmit={handleAmendApprovedScope} className="space-y-3">
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                  <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Approved Scope Locked:</strong> Ref{' '}
                    <span className="font-mono">{selectedPreauth.payerAuthReference}</span> (Valid{' '}
                    {selectedPreauth.validFrom ?? '—'} to {selectedPreauth.validUntil ?? '—'}).
                    Modifying scope or amount requires an audited amendment reason and resets status
                    to DRAFT for fresh payer submission.
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="field-label">Amended Estimated Amount (KES)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={amendEstimatedAmount}
                      onChange={(e) => setAmendEstimatedAmount(e.target.value)}
                      className="field-input"
                      required
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="field-label">Mandatory Amendment Reason (Min 10 chars)</label>
                    <input
                      type="text"
                      value={amendmentReason}
                      onChange={(e) => setAmendmentReason(e.target.value)}
                      placeholder="Explain clinical change requiring scope amendment..."
                      className="field-input"
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="btn-quiet text-xs">
                  Record Audited Scope Amendment
                </button>
              </form>
            ) : (
              <form onSubmit={handleRecordDecision} className="space-y-3">
                <div className="text-xs font-semibold text-navy-900 flex items-center gap-1.5">
                  <FileCheck className="w-4 h-4 text-brand-600" />
                  Record Manual Payer Authorization Outcome
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="field-label">Payer Outcome</label>
                    <select
                      value={decisionStatus}
                      onChange={(e) => setDecisionStatus(e.target.value)}
                      className="field-input"
                      required
                    >
                      <option value="">— Select actual payer outcome —</option>
                      <option value="APPROVED">APPROVED</option>
                      <option value="PARTIALLY_APPROVED">PARTIALLY_APPROVED</option>
                      <option value="REJECTED">REJECTED</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Payer Auth Reference</label>
                    <input
                      type="text"
                      value={payerAuthRef}
                      onChange={(e) => setPayerAuthRef(e.target.value)}
                      placeholder="Required for approval"
                      className="field-input"
                    />
                  </div>
                  <div>
                    <label className="field-label">Approved Amount (KES)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={approvedAmount}
                      onChange={(e) => setApprovedAmount(e.target.value)}
                      className="field-input"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="field-label">Valid From</label>
                    <input
                      type="date"
                      value={validFrom}
                      onChange={(e) => setValidFrom(e.target.value)}
                      className="field-input"
                    />
                  </div>
                  <div>
                    <label className="field-label">Valid Until</label>
                    <input
                      type="date"
                      value={validUntil}
                      onChange={(e) => setValidUntil(e.target.value)}
                      className="field-input"
                    />
                  </div>
                  <div>
                    <label className="field-label">Rejection / Partial Note</label>
                    <input
                      type="text"
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="Reason if rejected/partial"
                      className="field-input"
                    />
                  </div>
                </div>
                <button type="submit" className="btn-primary text-xs">
                  Save Payer Authorization Decision
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
