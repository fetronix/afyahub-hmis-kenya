import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FilePlus2,
  RefreshCw,
  RotateCcw,
  Send,
} from 'lucide-react';
import type { BillingInvoice, Patient } from '../../../types/index.ts';
import { ClaimEvidencePreview } from '../ClaimEvidencePreview.tsx';
import {
  shaEclaimsApi,
  type ShaEclaimRecord,
  type ShaEclaimSummary,
  type ShaPreauthRecord,
} from '../../../api/sha-eclaims.client.ts';

interface Props {
  facilityId: number | null;
  invoices: BillingInvoice[];
  patients: Patient[];
  canPrepare: boolean;
  canSubmit: boolean;
  canResubmit: boolean;
  canAdjudicate: boolean;
  showToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

function claimStatusBadge(status: string): string {
  switch (status) {
    case 'READY_FOR_SUBMISSION':
    case 'ADJUDICATED':
    case 'PAID':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'ACKNOWLEDGED':
    case 'SUBMITTED':
    case 'PARTIALLY_ADJUDICATED':
      return 'bg-brand-50 text-brand-700 border-brand-200';
    case 'VALIDATION_FAILED':
    case 'REJECTED':
    case 'DISPUTED':
      return 'bg-rose-50 text-rose-800 border-rose-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-300';
  }
}

export const ClaimsLifecycleWorkspace: React.FC<Props> = ({
  facilityId,
  invoices,
  patients,
  canPrepare,
  canSubmit,
  canResubmit,
  canAdjudicate,
  showToast,
}) => {
  const [subTab, setSubTab] = useState<'prepare' | 'tracking' | 'rejected'>('tracking');
  const [claims, setClaims] = useState<ShaEclaimSummary[]>([]);
  const [preauths, setPreauths] = useState<ShaPreauthRecord[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<ShaEclaimRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prepare form
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | ''>('');
  const [schemeCode, setSchemeCode] = useState('');
  const [subType, setSubType] = useState<'op' | 'ip'>('op');
  const [submissionProtocol, setSubmissionProtocol] = useState<'FHIR_BUNDLE' | 'HIE_VIRTUAL_CLAIM'>(
    'FHIR_BUNDLE',
  );
  const [dischargeReason, setDischargeReason] = useState<
    '' | 'RECOVERED' | 'REFERRED' | 'ABSCONDED' | 'DECEASED' | 'OTHER'
  >('');
  const [practitionerRegNumber, setPractitionerRegNumber] = useState('');
  const [practitionerRegulator, setPractitionerRegulator] = useState('KMPDC');
  const [preauthId, setPreauthId] = useState<number | ''>('');
  const [diagCode, setDiagCode] = useState('');
  const [diagDisplay, setDiagDisplay] = useState('');
  const [diagSystem, setDiagSystem] = useState<'ICD-10' | 'ICD-11' | ''>('');
  const [preparing, setPreparing] = useState(false);

  // Adjudication recording form
  const [adjStatus, setAdjStatus] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');

  // Rejected claim correction form
  const [correctionNotes, setCorrectionNotes] = useState('');
  const [corrDiagCode, setCorrDiagCode] = useState('');
  const [corrDiagDisplay, setCorrDiagDisplay] = useState('');
  const [corrDiagSystem, setCorrDiagSystem] = useState<'ICD-10' | 'ICD-11' | ''>('');
  const [itemCodeEdits, setItemCodeEdits] = useState<Record<number, string>>({});
  const [itemNameEdits, setItemNameEdits] = useState<Record<number, string>>({});
  const [itemPreauthEdits, setItemPreauthEdits] = useState<Record<number, string>>({});
  const [resubmitting, setResubmitting] = useState(false);

  const loadClaims = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [clmRes, paRes] = await Promise.all([
        shaEclaimsApi.listClaims(facilityId),
        shaEclaimsApi.listPreauthorizations(facilityId),
      ]);
      setClaims(clmRes.claims);
      setPreauths(paRes.preauthorizations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load SHA eClaims.');
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void loadClaims();
  }, [loadClaims]);

  const openClaimDetail = async (id: number) => {
    try {
      const res = await shaEclaimsApi.getClaimDetail(id, facilityId);
      setSelectedClaim(res.claim);
      setAdjAmount(res.claim.totalClaimedAmount);
      const principal = res.claim.diagnosesSnapshot.find((d) => d.type === 'principal');
      setCorrDiagCode(principal?.code ?? '');
      setCorrDiagDisplay(principal?.display ?? '');
      setCorrDiagSystem(
        principal?.system === 'ICD-10' || principal?.system === 'ICD-11' ? principal.system : '',
      );
      const codeMap: Record<number, string> = {};
      const nameMap: Record<number, string> = {};
      const paMap: Record<number, string> = {};
      for (const it of res.claim.items ?? []) {
        codeMap[it.id] = it.payerServiceCode ?? '';
        nameMap[it.id] = it.payerServiceName ?? it.description;
        paMap[it.id] = it.preauthReference ?? '';
      }
      setItemCodeEdits(codeMap);
      setItemNameEdits(nameMap);
      setItemPreauthEdits(paMap);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load claim detail.', 'error');
    }
  };

  const rejectedClaims = useMemo(
    () => claims.filter((c) => c.status === 'REJECTED' || c.status === 'VALIDATION_FAILED'),
    [claims],
  );

  const handlePrepare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoiceId) {
      showToast('Select a JaliCare invoice first.', 'warning');
      return;
    }
    if (
      (diagCode.trim() || diagDisplay.trim() || diagSystem) &&
      (!diagCode.trim() || !diagDisplay.trim() || !diagSystem)
    ) {
      showToast('Enter the code, description and recorded coding system together.', 'warning');
      return;
    }
    setPreparing(true);
    try {
      const res = await shaEclaimsApi.prepareClaim(facilityId, {
        invoiceId: Number(selectedInvoiceId),
        schemeCode,
        subType,
        submissionProtocol,
        dischargeReason: dischargeReason || null,
        practitionerRegNumber: practitionerRegNumber.trim() || null,
        practitionerRegulator: practitionerRegNumber.trim() ? practitionerRegulator : null,
        isPhcClaim: schemeCode === 'PHC',
        preauthorizationId: preauthId ? Number(preauthId) : null,
        diagnosesOverride:
          diagCode.trim() && diagDisplay.trim()
            ? [
                {
                  code: diagCode.trim(),
                  display: diagDisplay.trim(),
                  system: diagSystem,
                  type: 'principal',
                },
              ]
            : undefined,
      });
      showToast(
        `Prepared ${res.claim.claimNumber} (${res.claim.status}). Original invoice untouched.`,
        'success',
      );
      await loadClaims();
      setSelectedClaim(res.claim);
      setSubTab('tracking');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Claim preparation failed.', 'error');
    } finally {
      setPreparing(false);
    }
  };

  const handleValidate = async (claimId: number) => {
    try {
      const res = await shaEclaimsApi.validateClaim(claimId, facilityId);
      setSelectedClaim(res.claim);
      showToast(`Validation completed: ${res.claim.status}`, 'info');
      await loadClaims();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Validation failed.', 'error');
    }
  };

  const handleSubmit = async (claimId: number) => {
    try {
      const res = await shaEclaimsApi.submitClaim(claimId, facilityId);
      setSelectedClaim(res.claim);
      showToast(
        `Dispatched ${res.claim.claimNumber} -> ${res.claim.status} (${
          res.claim.isSimulated ? 'Sandbox Simulation' : res.claim.environmentMode
        })`,
        'success',
      );
      await loadClaims();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Submission failed.', 'error');
    }
  };

  const handleRefreshStatus = async (claimId: number) => {
    try {
      const res = await shaEclaimsApi.refreshClaimStatus(claimId, facilityId);
      setSelectedClaim(res.claim);
      showToast(
        res.gatewayStatus.errorMessage ??
          `Upstream state: ${res.gatewayStatus.upstreamState ?? res.claim.status}`,
        'info',
      );
      await loadClaims();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Status query failed.', 'error');
    }
  };

  const handleRecordAdjudication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClaim) return;
    try {
      const res = await shaEclaimsApi.adjudicateClaim(selectedClaim.id, facilityId, {
        targetStatus: adjStatus,
        approvedAmount: adjAmount,
        reason: adjReason,
      });
      setSelectedClaim(res.claim);
      setAdjStatus('');
      setAdjAmount('');
      setAdjReason('');
      showToast(`Recorded adjudication: ${res.claim.status}`, 'success');
      await loadClaims();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to record adjudication.', 'error');
    }
  };

  const handleResubmitRejected = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClaim) return;
    if (
      (corrDiagCode.trim() || corrDiagDisplay.trim() || corrDiagSystem) &&
      (!corrDiagCode.trim() || !corrDiagDisplay.trim() || !corrDiagSystem)
    ) {
      showToast(
        'Enter the correction code, description and recorded coding system together.',
        'warning',
      );
      return;
    }
    setResubmitting(true);
    try {
      const itemCorrections = (selectedClaim.items ?? []).map((it) => ({
        itemId: it.id,
        payerServiceCode: itemCodeEdits[it.id],
        payerServiceName: itemNameEdits[it.id],
        preauthReference: itemPreauthEdits[it.id] || null,
      }));

      let diagnosesSnapshot: typeof selectedClaim.diagnosesSnapshot | undefined;
      if (corrDiagCode.trim() && corrDiagDisplay.trim() && corrDiagSystem) {
        diagnosesSnapshot = [...selectedClaim.diagnosesSnapshot];
        const index = diagnosesSnapshot.findIndex((d) => d.type === 'principal');
        const corrected = {
          code: corrDiagCode.trim(),
          display: corrDiagDisplay.trim(),
          system: corrDiagSystem,
          type: 'principal',
        };
        if (index < 0) diagnosesSnapshot.push(corrected);
        else diagnosesSnapshot[index] = corrected;
      }
      const res = await shaEclaimsApi.resubmitClaim(selectedClaim.id, facilityId, {
        correctionNotes,
        diagnosesSnapshot,
        itemCorrections,
      });
      setSelectedClaim(res.claim);
      setCorrectionNotes('');
      showToast(
        `Corrected & resubmitted ${res.claim.claimNumber} -> ${res.claim.status}`,
        'success',
      );
      await loadClaims();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Resubmission failed.', 'error');
    } finally {
      setResubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation across Screens 6, 7 & 8 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setSubTab('prepare')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 ${
            subTab === 'prepare'
              ? 'bg-brand-600 text-white'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <FilePlus2 className="w-3.5 h-3.5" />
          1. Prepare & Validate Claim
        </button>
        <button
          type="button"
          onClick={() => setSubTab('tracking')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 ${
            subTab === 'tracking'
              ? 'bg-brand-600 text-white'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <ClipboardCheck className="w-3.5 h-3.5" />
          2. Submission & Status Tracking ({claims.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('rejected')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 ${
            subTab === 'rejected'
              ? 'bg-ember-500 text-navy-950 font-bold'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          3. Rejected & Validation Exceptions ({rejectedClaims.length})
        </button>
      </div>

      {/* SCREEN 6: CLAIM PREPARATION */}
      {subTab === 'prepare' && (
        <form onSubmit={handlePrepare} className="panel p-5 bg-white max-w-3xl space-y-4">
          <div>
            <span className="eyebrow text-brand-700">Kenya eClaims FHIR T-01 / T-04 / T-05</span>
            <h3 className="text-base font-bold text-navy-900">
              Assemble SHA eClaim Package from JaliCare Clinical & Billing Records
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Pulls invoice lines, OPD/IPD encounters, lab, radiology, pharmacy dispensations, and
              approved service mappings into an audited eClaim snapshot without altering the
              underlying JaliCare invoice.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="field-label">JaliCare Invoice</label>
              <select
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value ? Number(e.target.value) : '')}
                className="field-input"
                required
              >
                <option value="">— Select JaliCare Invoice —</option>
                {invoices.map((inv) => {
                  const pat = patients.find((p) => p.id === inv.patientId);
                  const patLabel = pat
                    ? `${pat.firstName} ${pat.lastName}`
                    : `Patient #${inv.patientId}`;
                  return (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNumber} · {patLabel} · KES{' '}
                      {Number(inv.totalAmount).toLocaleString()}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="field-label">SHA Benefit Scheme</label>
              <select
                value={schemeCode}
                onChange={(e) => setSchemeCode(e.target.value)}
                className="field-input"
                required
              >
                <option value="">— Select the actual scheme —</option>
                <option value="SHIF">SHIF (Social Health Insurance Fund)</option>
                <option value="PHC">PHC (Primary Healthcare — KES 0.00 Bundle)</option>
                <option value="ECCIF">ECCIF (Emergency, Chronic & Critical Illness)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="field-label">Care Setting (Claim SubType)</label>
              <select
                value={subType}
                onChange={(e) => setSubType(e.target.value as 'op' | 'ip')}
                className="field-input"
              >
                <option value="op">Outpatient / Ambulatory (op)</option>
                <option value="ip">Inpatient Admission Episode (ip)</option>
              </select>
            </div>
            <div>
              <label className="field-label">Link Approved Preauthorization (Optional)</label>
              <select
                value={preauthId}
                onChange={(e) => setPreauthId(e.target.value ? Number(e.target.value) : '')}
                className="field-input"
              >
                <option value="">— None —</option>
                {preauths
                  .filter((p) => p.status === 'APPROVED' || p.status === 'PARTIALLY_APPROVED')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.preauthNumber} ({p.payerAuthReference}) · {p.requestedServiceName}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label className="field-label">Submission Protocol</label>
              <select
                value={submissionProtocol}
                onChange={(e) =>
                  setSubmissionProtocol(e.target.value as 'FHIR_BUNDLE' | 'HIE_VIRTUAL_CLAIM')
                }
                className="field-input"
              >
                <option value="FHIR_BUNDLE">FHIR R4 Bundle (Kenya eClaims IG v0.1.0 Draft)</option>
                <option value="HIE_VIRTUAL_CLAIM">DHA HIE v1 Virtual Claim REST</option>
              </select>
            </div>
            <div>
              <label className="field-label">Discharge / Exit Outcome</label>
              <select
                value={dischargeReason}
                onChange={(e) =>
                  setDischargeReason(
                    e.target.value as
                      '' | 'RECOVERED' | 'REFERRED' | 'ABSCONDED' | 'DECEASED' | 'OTHER',
                  )
                }
                className="field-input"
              >
                <option value="">— Not recorded —</option>
                <option value="RECOVERED">RECOVERED</option>
                <option value="REFERRED">REFERRED</option>
                <option value="ABSCONDED">ABSCONDED</option>
                {subType === 'ip' && <option value="DECEASED">DECEASED (IPD Discharge)</option>}
                <option value="OTHER">OTHER</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="field-label">Attending Clinician Reg # (HWR Optional)</label>
              <input
                type="text"
                value={practitionerRegNumber}
                onChange={(e) => setPractitionerRegNumber(e.target.value)}
                placeholder="e.g. A12345"
                className="field-input font-mono text-xs"
              />
            </div>
            <div>
              <label className="field-label">Health Worker Regulator</label>
              <select
                value={practitionerRegulator}
                onChange={(e) => setPractitionerRegulator(e.target.value)}
                className="field-input"
              >
                <option value="KMPDC">KMPDC (Medical Practitioners & Dentists)</option>
                <option value="COC">COC (Clinical Officers Council)</option>
                <option value="NCK">NCK (Nursing Council of Kenya)</option>
                <option value="PPB">PPB (Pharmacy and Poisons Board)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="field-label">
                Principal diagnosis code (optional if already coded on encounter)
              </label>
              <input
                type="text"
                value={diagCode}
                onChange={(e) => setDiagCode(e.target.value)}
                placeholder="e.g. CA40.0"
                className="field-input"
              />
            </div>
            <div>
              <label className="field-label">Principal Diagnosis Description</label>
              <input
                type="text"
                value={diagDisplay}
                onChange={(e) => setDiagDisplay(e.target.value)}
                placeholder="e.g. Community-acquired pneumonia"
                className="field-input"
              />
            </div>
          </div>

          <label className="field-label">
            Recorded diagnosis system (required for an override)
            <select
              value={diagSystem}
              onChange={(e) => setDiagSystem(e.target.value as 'ICD-10' | 'ICD-11' | '')}
              className="field-input"
            >
              <option value="">— Select recorded system —</option>
              <option value="ICD-10">ICD-10</option>
              <option value="ICD-11">ICD-11</option>
            </select>
          </label>
          {selectedInvoiceId && canPrepare && (
            <ClaimEvidencePreview
              invoiceId={Number(selectedInvoiceId)}
              payerKind="SHA"
              payerCode="SHA"
            />
          )}
          <button
            type="submit"
            disabled={!canPrepare || preparing || !selectedInvoiceId}
            className="btn-accent justify-center disabled:opacity-50"
          >
            <FilePlus2 className="w-4 h-4" />
            {preparing ? 'Assembling & Validating...' : 'Prepare & Run Pre-Submission Validation'}
          </button>
        </form>
      )}

      {/* SCREENS 7 & 8: TRACKING & REJECTED / CORRECTION WORKBENCH */}
      {(subTab === 'tracking' || subTab === 'rejected') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-6 panel p-5 bg-white space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="eyebrow text-brand-700">
                  {subTab === 'rejected'
                    ? 'Exception & Rejection Queue'
                    : 'Facility eClaims Ledger'}
                </span>
                <h3 className="text-base font-bold text-navy-900">
                  {subTab === 'rejected'
                    ? `Claims Requiring Correction (${rejectedClaims.length})`
                    : `SHA eClaims Packages (${claims.length})`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => void loadClaims()}
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
              <table className="table-quiet w-full text-xs text-left">
                <thead>
                  <tr>
                    <th>Claim #</th>
                    <th>Patient / Invoice</th>
                    <th>Claimed</th>
                    <th>Status</th>
                    <th>Attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {(subTab === 'rejected' ? rejectedClaims : claims).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        {subTab === 'rejected'
                          ? 'No rejected or validation-failed SHA claims.'
                          : 'No SHA eClaims prepared yet.'}
                      </td>
                    </tr>
                  ) : (
                    (subTab === 'rejected' ? rejectedClaims : claims).map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => void openClaimDetail(c.id)}
                        className={`cursor-pointer ${
                          selectedClaim?.id === c.id ? 'bg-brand-50/60' : ''
                        }`}
                      >
                        <td className="font-mono font-semibold text-navy-900">
                          {c.claimNumber}
                          <div className="text-[10px] text-slate-500">
                            {c.schemeCode} · {c.subType.toUpperCase()}
                          </div>
                        </td>
                        <td>
                          <div className="font-medium text-navy-900">
                            {c.patientName ?? `Patient #${c.patientId}`}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {c.invoiceNumber ?? `INV #${c.invoiceId}`}
                          </div>
                        </td>
                        <td className="font-semibold text-navy-900">
                          KES {Number(c.totalClaimedAmount).toLocaleString()}
                        </td>
                        <td>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${claimStatusBadge(
                              c.status,
                            )}`}
                          >
                            {c.status}
                          </span>
                          {c.isSimulated && (
                            <div className="text-[10px] text-copper-700 font-semibold mt-0.5">
                              SANDBOX_SIM
                            </div>
                          )}
                        </td>
                        <td className="font-mono">{c.submissionCount}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: Claim Inspector, Validation Issues, Submission, Status & Correction */}
          <div className="lg:col-span-6 panel p-5 bg-white space-y-4">
            {!selectedClaim ? (
              <div className="py-12 text-center text-slate-500 text-sm">
                Select an eClaim row on the left to inspect pre-submission validation rules, FHIR
                line mappings, status history, or resubmit a rejected claim.
              </div>
            ) : (
              <>
                {selectedClaim.dispatchReview && (
                  <p role="alert" className="rounded bg-amber-50 p-3 text-xs text-amber-900">
                    A prior dispatch is in progress or uncertain. Review the payer record and
                    contact an authorized administrator; do not re-dispatch. This flag does not
                    establish acceptance or payment.
                  </p>
                )}
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-base text-navy-900">
                        {selectedClaim.claimNumber}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${claimStatusBadge(
                          selectedClaim.status,
                        )}`}
                      >
                        {selectedClaim.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Patient: <strong>{selectedClaim.patientName}</strong> · Invoice:{' '}
                      <span className="font-mono">{selectedClaim.invoiceNumber}</span> · Payer Ref:{' '}
                      <span className="font-mono">{selectedClaim.payerClaimReference ?? '—'}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Protocol:{' '}
                      <span className="font-mono font-semibold text-navy-900">
                        {selectedClaim.submissionProtocol ?? 'FHIR_BUNDLE'}
                      </span>
                      {selectedClaim.dischargeReason
                        ? ` · Outcome: ${selectedClaim.dischargeReason}`
                        : ''}
                      {selectedClaim.hasConsentToken ? ' · Consent Token Attached' : ''}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {canPrepare &&
                      (selectedClaim.status === 'DRAFT' ||
                        selectedClaim.status === 'VALIDATION_FAILED' ||
                        selectedClaim.status === 'READY_FOR_SUBMISSION') && (
                        <button
                          type="button"
                          onClick={() => void handleValidate(selectedClaim.id)}
                          disabled={Boolean(selectedClaim.dispatchReview)}
                          className="btn-quiet text-xs"
                        >
                          Re-Validate
                        </button>
                      )}
                    {canSubmit && selectedClaim.status === 'READY_FOR_SUBMISSION' && (
                      <button
                        type="button"
                        onClick={() => void handleSubmit(selectedClaim.id)}
                        disabled
                        title="External SHA transport is unavailable"
                        className="btn-accent text-xs flex items-center gap-1.5"
                      >
                        <Send className="w-3.5 h-3.5" />
                        External submission unavailable
                      </button>
                    )}
                    {selectedClaim.submissionCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleRefreshStatus(selectedClaim.id)}
                        disabled
                        title="External SHA transport is unavailable"
                        className="btn-quiet text-xs flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Poll Status
                      </button>
                    )}
                  </div>
                </div>

                {/* Totals summary */}
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="p-2 rounded bg-slate-50 border border-slate-100">
                    <div className="text-slate-500">Facility Billed</div>
                    <div className="font-bold text-navy-900">
                      KES {Number(selectedClaim.totalBilledAmount).toLocaleString()}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-50 border border-slate-100">
                    <div className="text-slate-500">SHA Claimed</div>
                    <div className="font-bold text-brand-700">
                      KES {Number(selectedClaim.totalClaimedAmount).toLocaleString()}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-50 border border-slate-100">
                    <div className="text-slate-500">Approved</div>
                    <div className="font-bold text-navy-900">
                      KES {Number(selectedClaim.totalApprovedAmount).toLocaleString()}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-50 border border-slate-100">
                    <div className="text-slate-500">Remitted Paid</div>
                    <div className="font-bold text-emerald-700">
                      KES {Number(selectedClaim.totalPaidAmount).toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Validation issues */}
                {selectedClaim.validationIssues.length > 0 && (
                  <div className="p-3 rounded-lg bg-rose-50/70 border border-rose-200 space-y-1.5">
                    <div className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" />
                      Pre-Submission Validation Findings ({selectedClaim.validationIssues.length})
                    </div>
                    <ul className="text-xs space-y-1 text-rose-900">
                      {selectedClaim.validationIssues.map((iss, idx) => (
                        <li key={idx}>
                          <span className="font-mono font-semibold">[{iss.severity}]</span>{' '}
                          {iss.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedClaim.validationIssues.length === 0 &&
                  selectedClaim.status === 'READY_FOR_SUBMISSION' && (
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      Local validation checks passed. External submission is unavailable and FHIR
                      certification has not been established.
                    </div>
                  )}

                {selectedClaim.rejectionReason && (
                  <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900">
                    <strong>Payer Rejection Reason:</strong> {selectedClaim.rejectionReason}
                    {selectedClaim.previousSubmissionRef && (
                      <span className="ml-2 font-mono">
                        (Prior Ref: {selectedClaim.previousSubmissionRef})
                      </span>
                    )}
                  </div>
                )}

                {/* Claim Items */}
                <div>
                  <h4 className="text-xs font-bold text-navy-900 mb-1.5">
                    Claim Line Items ({selectedClaim.items?.length ?? 0})
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="table-quiet w-full text-xs text-left">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Service</th>
                          <th>SHA Code</th>
                          <th>Qty</th>
                          <th>Net (KES)</th>
                          <th>Preauth</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedClaim.items ?? []).map((it) => (
                          <tr key={it.id}>
                            <td>{it.sequence}</td>
                            <td>{it.description}</td>
                            <td className="font-mono">
                              {it.payerServiceCode ?? (
                                <span className="text-rose-700 font-semibold">UNMAPPED</span>
                              )}
                            </td>
                            <td>{it.quantity}</td>
                            <td>{Number(it.claimedNetAmount).toLocaleString()}</td>
                            <td className="font-mono">{it.preauthReference ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* SCREEN 8: REJECTED CLAIM CORRECTION & RESUBMISSION */}
                {selectedClaim.status === 'REJECTED' && canResubmit && (
                  <form
                    onSubmit={handleResubmitRejected}
                    className="p-4 rounded-xl bg-ember-50/50 border border-ember-200 space-y-3"
                  >
                    <div className="text-xs font-bold text-navy-900 flex items-center gap-1.5">
                      <RotateCcw className="w-4 h-4 text-copper-700" />
                      Correct & Resubmit Rejected Claim (Preserves Prior Submission Audit Trail)
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="field-label">Principal diagnosis code</label>
                        <input
                          type="text"
                          value={corrDiagCode}
                          onChange={(e) => setCorrDiagCode(e.target.value)}
                          className="field-input"
                        />
                      </div>
                      <div>
                        <label className="field-label">Diagnosis Display</label>
                        <input
                          type="text"
                          value={corrDiagDisplay}
                          onChange={(e) => setCorrDiagDisplay(e.target.value)}
                          className="field-input"
                        />
                      </div>
                    </div>

                    <label className="field-label">
                      Recorded diagnosis system
                      <select
                        value={corrDiagSystem}
                        onChange={(e) =>
                          setCorrDiagSystem(e.target.value as 'ICD-10' | 'ICD-11' | '')
                        }
                        className="field-input"
                      >
                        <option value="">— Select recorded system —</option>
                        <option value="ICD-10">ICD-10</option>
                        <option value="ICD-11">ICD-11</option>
                      </select>
                    </label>
                    {(selectedClaim.items ?? []).map((it) => (
                      <div key={it.id} className="grid grid-cols-3 gap-2 text-xs">
                        <input
                          type="text"
                          value={itemCodeEdits[it.id] ?? ''}
                          onChange={(e) =>
                            setItemCodeEdits((prev) => ({ ...prev, [it.id]: e.target.value }))
                          }
                          placeholder="SHA Code"
                          className="field-input"
                        />
                        <input
                          type="text"
                          value={itemNameEdits[it.id] ?? ''}
                          onChange={(e) =>
                            setItemNameEdits((prev) => ({ ...prev, [it.id]: e.target.value }))
                          }
                          placeholder="SHA Intervention Name"
                          className="field-input"
                        />
                        <input
                          type="text"
                          value={itemPreauthEdits[it.id] ?? ''}
                          onChange={(e) =>
                            setItemPreauthEdits((prev) => ({ ...prev, [it.id]: e.target.value }))
                          }
                          placeholder="Preauth Ref (optional)"
                          className="field-input"
                        />
                      </div>
                    ))}

                    <div>
                      <label className="field-label">Mandatory Correction Notes</label>
                      <input
                        type="text"
                        value={correctionNotes}
                        onChange={(e) => setCorrectionNotes(e.target.value)}
                        placeholder="Describe coding/preauth correction made before resubmission..."
                        className="field-input"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled
                      title="External SHA transport is unavailable"
                      className="btn-accent text-xs w-full justify-center"
                    >
                      {resubmitting ? 'Resubmitting...' : 'Validate Corrections & Resubmit to SHA'}
                    </button>
                  </form>
                )}

                {/* Record Authoritative Adjudication Outcome */}
                {canAdjudicate &&
                  (selectedClaim.status === 'ACKNOWLEDGED' ||
                    selectedClaim.status === 'PARTIALLY_ADJUDICATED') && (
                    <form
                      onSubmit={handleRecordAdjudication}
                      className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5"
                    >
                      <div className="text-xs font-bold text-navy-900">
                        Record Manual Payer Adjudication Outcome
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <select
                          value={adjStatus}
                          onChange={(e) => setAdjStatus(e.target.value)}
                          className="field-input text-xs"
                          required
                        >
                          <option value="">— Select actual outcome —</option>
                          <option value="ADJUDICATED">ADJUDICATED</option>
                          <option value="PARTIALLY_ADJUDICATED">PARTIALLY_ADJUDICATED</option>
                          <option value="REJECTED">REJECTED</option>
                          <option value="DISPUTED">DISPUTED</option>
                        </select>
                        <input
                          type="number"
                          step="0.01"
                          value={adjAmount}
                          onChange={(e) => setAdjAmount(e.target.value)}
                          placeholder="Approved KES"
                          className="field-input text-xs"
                        />
                        <input
                          type="text"
                          value={adjReason}
                          onChange={(e) => setAdjReason(e.target.value)}
                          placeholder="Adjudication note / reason"
                          className="field-input text-xs"
                          required
                        />
                      </div>
                      <button type="submit" className="btn-primary text-xs">
                        Save Adjudication Outcome
                      </button>
                    </form>
                  )}

                {/* Status History Timeline */}
                {(selectedClaim.statusHistory?.length ?? 0) > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-navy-900 mb-1.5">
                      Immutable Status History
                    </h4>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {(selectedClaim.statusHistory ?? []).map((h) => (
                        <div
                          key={h.id}
                          className="text-[11px] p-2 rounded bg-slate-50 border border-slate-100 flex items-center justify-between gap-2"
                        >
                          <div>
                            <span className="font-mono font-semibold text-navy-900">
                              {h.fromStatus ? `${h.fromStatus} → ${h.toStatus}` : h.toStatus}
                            </span>{' '}
                            <span className="text-slate-600">— {h.reason}</span>
                          </div>
                          <span className="text-slate-400 whitespace-nowrap">
                            {new Date(h.createdAt).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
