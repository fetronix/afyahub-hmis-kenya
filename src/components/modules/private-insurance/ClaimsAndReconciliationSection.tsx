import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Landmark,
  RefreshCw,
  Send,
  Wrench,
} from 'lucide-react';
import type { BillingInvoice, Encounter } from '../../../types/index.ts';
import {
  privateInsuranceApi,
  type PrivateClaimDetail,
  type PrivateClaimSummary,
  type PrivateMemberPolicy,
  type PrivatePayerConfig,
  type PrivatePreauthRecord,
} from '../../../api/private-insurance.client.ts';

interface Props {
  activeScreen:
    'claim_prepare' | 'claim_tracking' | 'claim_rejections' | 'remittances' | 'diagnostics';
  selectedPayerFilter: string;
  payers: PrivatePayerConfig[];
  invoices: BillingInvoice[];
  encounters: Encounter[];
  members: PrivateMemberPolicy[];
  preauthorizations: PrivatePreauthRecord[];
  claims: PrivateClaimSummary[];
  remittances: Array<Record<string, unknown>>;
  reconciliation: {
    summary: {
      entriesCount: number;
      totalClaimedAmount: string;
      totalRemittedAmount: string;
      totalVarianceAmount: string;
    };
    entries: Array<Record<string, unknown>>;
  } | null;
  diagnostics: {
    diagnostics: Array<Record<string, unknown>>;
    auditEvents: Array<Record<string, unknown>>;
  } | null;
  canPrepareClaims: boolean;
  canSubmitClaims: boolean;
  canReconcileRemittances: boolean;
  onRefresh: () => Promise<void>;
  showToast: (msg: string, opts?: { tone?: 'info' | 'success' | 'warning' | 'error' }) => void;
}

export const ClaimsAndReconciliationSection: React.FC<Props> = ({
  activeScreen,
  selectedPayerFilter,
  payers,
  invoices,
  encounters,
  members,
  preauthorizations,
  claims,
  remittances,
  reconciliation,
  diagnostics,
  canPrepareClaims,
  canSubmitClaims,
  canReconcileRemittances,
  onRefresh,
  showToast,
}) => {
  const defaultPayer =
    selectedPayerFilter !== 'ALL' ? selectedPayerFilter : (payers[0]?.payerCode ?? '');

  const [busy, setBusy] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<PrivateClaimDetail | null>(null);
  const [dispatchTarget, setDispatchTarget] = useState<{
    claim: PrivateClaimSummary;
    resubmit: boolean;
  } | null>(null);
  const [dispatchReference, setDispatchReference] = useState('');
  const [dispatchReason, setDispatchReason] = useState('');
  const [decisionTarget, setDecisionTarget] = useState<{
    claim: PrivateClaimSummary;
    status: 'ADJUDICATED' | 'REJECTED';
  } | null>(null);
  const [decisionReference, setDecisionReference] = useState('');
  const [decisionAmount, setDecisionAmount] = useState('');
  const [decisionReason, setDecisionReason] = useState('');

  /* Claim Preparation Form */
  const [prepForm, setPrepForm] = useState({
    invoiceId: '',
    payerCode: defaultPayer,
    memberPolicyId: '',
    encounterId: '',
    preauthId: '',
    diagnosisCode: '',
    diagnosisDisplay: '',
    attachmentFile: '',
    attachmentStorageReference: '',
    invoiceFileName: '',
    invoiceStorageReference: '',
  });

  /* Correction Form */
  const [correctionForm, setCorrectionForm] = useState({
    diagnosisCode: '',
    diagnosisDisplay: '',
    attachmentFile: '',
    attachmentStorageReference: '',
    correctionReason: '',
  });

  /* Remittance Form */
  const [remitForm, setRemitForm] = useState({
    payerCode: defaultPayer,
    adviceReference: '',
    existingRemittanceId: '',
    paymentChannel: '',
    paymentDate: '',
    totalRemittedAmount: '',
    claimId: '',
    allocatedAmount: '',
    billingPaymentId: '',
  });

  const selectedInvoice = useMemo(
    () => invoices.find((inv) => String(inv.id) === prepForm.invoiceId),
    [invoices, prepForm.invoiceId],
  );

  const matchingMembers = useMemo(() => {
    if (!selectedInvoice) return members.filter((m) => m.payerCode === prepForm.payerCode);
    return members.filter(
      (m) =>
        m.patientId === Number(selectedInvoice.patientId) && m.payerCode === prepForm.payerCode,
    );
  }, [members, selectedInvoice, prepForm.payerCode]);

  const inspectClaim = async (claimId: number) => {
    try {
      const detail = await privateInsuranceApi.getClaim(claimId);
      setSelectedClaim(detail);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load claim detail.', {
        tone: 'error',
      });
    }
  };

  const handlePrepareClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const detail = await privateInsuranceApi.prepareClaim({
        invoiceId: Number(prepForm.invoiceId),
        payerCode: prepForm.payerCode,
        memberPolicyId: Number(prepForm.memberPolicyId),
        encounterId: prepForm.encounterId ? Number(prepForm.encounterId) : undefined,
        preauthorizationId: prepForm.preauthId ? Number(prepForm.preauthId) : undefined,
        diagnoses: [
          {
            code: prepForm.diagnosisCode,
            display: prepForm.diagnosisDisplay,
            system: 'ICD-10',
            type: 'PRIMARY',
          },
        ],
        attachmentsManifest: [
          ...(prepForm.invoiceFileName && prepForm.invoiceStorageReference
            ? [
                {
                  documentType: 'ITEMIZED_INVOICE',
                  fileName: prepForm.invoiceFileName,
                  storageReference: prepForm.invoiceStorageReference,
                },
              ]
            : []),
          ...(prepForm.attachmentFile && prepForm.attachmentStorageReference
            ? [
                {
                  documentType: 'SIGNED_CLAIM_FORM',
                  fileName: prepForm.attachmentFile,
                  storageReference: prepForm.attachmentStorageReference,
                },
              ]
            : []),
        ],
      });
      setSelectedClaim(detail);
      showToast(
        `Prepared ${detail.claimNumber} (${detail.status}). Original JaliCare invoice #${detail.invoiceNumber} remains ${detail.originalInvoice.status}.`,
        { tone: detail.status === 'READY' ? 'success' : 'warning' },
      );
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to prepare claim.', {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleValidateClaim = async (claimId: number) => {
    setBusy(true);
    try {
      const updated = await privateInsuranceApi.validateClaim(claimId);
      setSelectedClaim(updated);
      showToast(`Validation status: ${updated.status}`, {
        tone: updated.status === 'READY' ? 'success' : 'warning',
      });
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Validation failed.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const openManualDispatch = (claim: PrivateClaimSummary, resubmit: boolean) => {
    setDispatchTarget({ claim, resubmit });
    setDispatchReference('');
    setDispatchReason('');
  };
  const handleSubmitClaim = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dispatchTarget) return;
    setBusy(true);
    try {
      const payload = {
        submissionMode: 'MANUAL',
        dispatchReference: dispatchReference.trim(),
        ...(dispatchTarget.resubmit ? { correctionReason: dispatchReason.trim() } : {}),
      };
      const updated = dispatchTarget.resubmit
        ? await privateInsuranceApi.resubmitClaim(dispatchTarget.claim.id, payload)
        : await privateInsuranceApi.submitClaim(dispatchTarget.claim.id, payload);
      setSelectedClaim(updated);
      setDispatchTarget(null);
      showToast(`${updated.claimNumber}: manual dispatch recorded. No API request was made.`, {
        tone: 'success',
      });
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not record dispatch.', {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };
  const dispatchDialog = dispatchTarget && (
    <form
      onSubmit={handleSubmitClaim}
      className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3"
      aria-label="Record manual claim dispatch"
    >
      <h3 className="font-bold">Record manual dispatch — {dispatchTarget.claim.claimNumber}</h3>
      <p className="text-xs">
        Send the claim through the insurer's approved manual channel first. This form does not send
        it or verify acceptance.
      </p>
      <label className="block text-xs font-semibold">
        Actual insurer portal, email or courier reference
        <input
          required
          minLength={3}
          value={dispatchReference}
          onChange={(e) => setDispatchReference(e.target.value)}
          className="field-input"
        />
      </label>
      {dispatchTarget.resubmit && (
        <label className="block text-xs font-semibold">
          Correction reason
          <input
            required
            minLength={5}
            value={dispatchReason}
            onChange={(e) => setDispatchReason(e.target.value)}
            className="field-input"
          />
        </label>
      )}
      <div className="flex gap-3">
        <button disabled={busy} className="btn-primary">
          Record dispatch
        </button>
        <button type="button" onClick={() => setDispatchTarget(null)} className="text-sm underline">
          Cancel
        </button>
      </div>
    </form>
  );

  const openDecision = (claim: PrivateClaimSummary, status: 'ADJUDICATED' | 'REJECTED') => {
    setDecisionTarget({ claim, status });
    setDecisionReference('');
    setDecisionAmount('');
    setDecisionReason('');
  };
  const handleRecordDecision = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!decisionTarget) return;
    setBusy(true);
    try {
      const updated = await privateInsuranceApi.recordClaimDecision(decisionTarget.claim.id, {
        status: decisionTarget.status,
        externalClaimReference: decisionReference.trim(),
        ...(decisionTarget.status === 'ADJUDICATED'
          ? { approvedAmount: decisionAmount }
          : { rejectionReason: decisionReason.trim() }),
      });
      setSelectedClaim(updated);
      setDecisionTarget(null);
      showToast(`Manual insurer decision recorded: ${updated.status}. No payment was created.`, {
        tone: 'success',
      });
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Decision update failed.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const decisionDialog = decisionTarget && (
    <form
      onSubmit={handleRecordDecision}
      className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3"
      aria-label="Record manual insurer decision"
    >
      <h3 className="font-bold">
        Record {decisionTarget.status.toLowerCase()} decision — {decisionTarget.claim.claimNumber}
      </h3>
      <p className="text-xs">
        Enter the actual insurer decision; a claim amount is not an approval and a decision is not a
        payment.
      </p>
      <label className="block text-xs font-semibold">
        Insurer decision reference
        <input
          required
          minLength={3}
          value={decisionReference}
          onChange={(e) => setDecisionReference(e.target.value)}
          className="field-input"
        />
      </label>
      {decisionTarget.status === 'ADJUDICATED' ? (
        <label className="block text-xs font-semibold">
          Actual approved amount (KES)
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={decisionAmount}
            onChange={(e) => setDecisionAmount(e.target.value)}
            className="field-input"
          />
        </label>
      ) : (
        <label className="block text-xs font-semibold">
          Actual rejection reason
          <input
            required
            value={decisionReason}
            onChange={(e) => setDecisionReason(e.target.value)}
            className="field-input"
          />
        </label>
      )}
      <div className="flex gap-3">
        <button disabled={busy} className="btn-primary">
          Record decision
        </button>
        <button type="button" onClick={() => setDecisionTarget(null)} className="text-sm underline">
          Cancel
        </button>
      </div>
    </form>
  );

  const handleSaveCorrectionAndRevalidate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClaim) return;
    setBusy(true);
    try {
      const updated = await privateInsuranceApi.updateClaim(selectedClaim.id, {
        correctionReason: correctionForm.correctionReason,
        diagnoses: [
          {
            code: correctionForm.diagnosisCode,
            display: correctionForm.diagnosisDisplay,
            system: 'ICD-10',
            type: 'PRIMARY',
          },
        ],
        ...(correctionForm.attachmentFile && correctionForm.attachmentStorageReference
          ? {
              attachmentsManifest: [
                ...selectedClaim.attachmentsManifest,
                {
                  documentType: 'SIGNED_CLAIM_FORM',
                  fileName: correctionForm.attachmentFile,
                  storageReference: correctionForm.attachmentStorageReference,
                },
              ],
            }
          : {}),
      });
      const validated = await privateInsuranceApi.validateClaim(updated.id);
      setSelectedClaim(validated);
      showToast(
        `Revision #${validated.revisionNumber} saved and re-validated (${validated.status}).`,
        {
          tone: validated.status === 'READY' ? 'success' : 'info',
        },
      );
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Correction failed.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleImportAndReconcile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    let recordedAdviceId: number | null = null;
    try {
      if (
        remitForm.existingRemittanceId &&
        (!remitForm.claimId || !remitForm.allocatedAmount || !remitForm.billingPaymentId)
      )
        throw new Error('Select the claim, actual allocation amount and matching receipt.');
      const imported = remitForm.existingRemittanceId
        ? { id: Number(remitForm.existingRemittanceId) }
        : await privateInsuranceApi.importRemittance({
            payerCode: remitForm.payerCode,
            payerRemittanceRef: remitForm.adviceReference,
            paymentChannel: remitForm.paymentChannel,
            paymentDate: remitForm.paymentDate,
            totalRemittedAmount: remitForm.totalRemittedAmount,
          });
      if (!remitForm.existingRemittanceId) recordedAdviceId = Number(imported.id);
      if (remitForm.claimId && remitForm.allocatedAmount) {
        await privateInsuranceApi.reconcileRemittance(Number(imported.id), {
          allocations: [
            {
              claimId: Number(remitForm.claimId),
              remittedAmount: remitForm.allocatedAmount,
              ...(remitForm.billingPaymentId
                ? { billingPaymentId: Number(remitForm.billingPaymentId) }
                : {}),
            },
          ],
        });
        showToast(
          'Remittance advice allocated; no payment was created and the invoice was not changed.',
          {
            tone: 'success',
          },
        );
      } else {
        showToast('Remittance advice imported.', { tone: 'success' });
      }
      setRemitForm({
        ...remitForm,
        adviceReference: '',
        existingRemittanceId: '',
        paymentChannel: '',
        paymentDate: '',
        totalRemittedAmount: '',
        claimId: '',
        allocatedAmount: '',
        billingPaymentId: '',
      });
      await onRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Remittance operation failed.';
      if (recordedAdviceId) {
        setRemitForm({ ...remitForm, existingRemittanceId: String(recordedAdviceId) });
        await onRefresh();
        showToast(
          `Advice was recorded but matching failed. Select the saved advice to retry: ${message}`,
          { tone: 'error' },
        );
      } else showToast(message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  /* ============================================================
     SCREEN 8: CLAIM PREPARATION
     ============================================================ */
  if (activeScreen === 'claim_prepare') {
    return (
      <div className="space-y-6">
        {dispatchDialog}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-brand-600" />
            Claim Preparation from JaliCare Invoices &amp; Clinical Encounters
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Generates insurer-specific claim drafts directly from existing JaliCare invoices,
            tariffs, encounters, diagnoses, labs, pharmacy orders, and preauthorizations without
            altering the original hospital invoice or marking it paid.
          </p>

          {canPrepareClaims && (
            <form onSubmit={handlePrepareClaim} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    1. JaliCare Billing Invoice
                  </label>
                  <select
                    required
                    value={prepForm.invoiceId}
                    onChange={(e) =>
                      setPrepForm({ ...prepForm, invoiceId: e.target.value, memberPolicyId: '' })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select finalized/open JaliCare invoice...</option>
                    {invoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoiceNumber} — KES {inv.totalAmount} ({inv.status})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    2. Target Insurer
                  </label>
                  <select
                    value={prepForm.payerCode}
                    onChange={(e) =>
                      setPrepForm({ ...prepForm, payerCode: e.target.value, memberPolicyId: '' })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {payers.map((py) => (
                      <option key={py.payerCode} value={py.payerCode}>
                        {py.payerName} ({py.payerCode})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    3. Patient Member Policy
                  </label>
                  <select
                    required
                    value={prepForm.memberPolicyId}
                    onChange={(e) => setPrepForm({ ...prepForm, memberPolicyId: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select linked policy...</option>
                    {matchingMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.memberNumber} — {m.patientName} ({m.verificationStatus})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    4. Encounter (Optional)
                  </label>
                  <select
                    value={prepForm.encounterId}
                    onChange={(e) => setPrepForm({ ...prepForm, encounterId: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Auto-detect from invoice</option>
                    {encounters.map((enc) => (
                      <option key={enc.id} value={enc.id}>
                        Encounter #{enc.id}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    5. Approved Preauth (Optional)
                  </label>
                  <select
                    value={prepForm.preauthId}
                    onChange={(e) => setPrepForm({ ...prepForm, preauthId: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">None</option>
                    {preauthorizations
                      .filter((pa) => pa.payerCode === prepForm.payerCode)
                      .map((pa) => (
                        <option key={pa.id} value={pa.id}>
                          {pa.preauthNumber} ({pa.status})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    6. Primary ICD-10 Code
                  </label>
                  <input
                    required
                    value={prepForm.diagnosisCode}
                    onChange={(e) => setPrepForm({ ...prepForm, diagnosisCode: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="text-xs font-semibold text-slate-700">
                  Diagnosis description
                  <input
                    required
                    value={prepForm.diagnosisDisplay}
                    onChange={(e) => setPrepForm({ ...prepForm, diagnosisDisplay: e.target.value })}
                    className="field-input"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Existing signed claim form file name (optional)
                  <input
                    value={prepForm.attachmentFile}
                    onChange={(e) => setPrepForm({ ...prepForm, attachmentFile: e.target.value })}
                    className="field-input"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Existing secure storage reference
                  <input
                    value={prepForm.attachmentStorageReference}
                    onChange={(e) =>
                      setPrepForm({ ...prepForm, attachmentStorageReference: e.target.value })
                    }
                    className="field-input"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-xs font-semibold">
                  Existing itemized invoice document name
                  <input
                    value={prepForm.invoiceFileName}
                    onChange={(e) => setPrepForm({ ...prepForm, invoiceFileName: e.target.value })}
                    className="field-input"
                  />
                </label>
                <label className="text-xs font-semibold">
                  Existing invoice document storage reference
                  <input
                    value={prepForm.invoiceStorageReference}
                    onChange={(e) =>
                      setPrepForm({ ...prepForm, invoiceStorageReference: e.target.value })
                    }
                    className="field-input"
                  />
                </label>
              </div>
              <p className="text-xs text-slate-600">
                Document references must point to existing securely stored evidence; this form does
                not upload files.
              </p>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-ember-500 text-navy-950 hover:bg-ember-600"
                >
                  {busy ? 'Preparing Claim...' : 'Prepare & Validate Insurer Claim'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Selected Prepared Claim Inspector */}
        {selectedClaim && (
          <div className="bg-white border-2 border-brand-200 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {selectedClaim.claimNumber} — {selectedClaim.patientName} (
                  {selectedClaim.payerCode})
                </h3>
                <p className="text-xs text-slate-600">
                  Source Invoice: <strong>{selectedClaim.originalInvoice.invoiceNumber}</strong>{' '}
                  (Original Status: <strong>{selectedClaim.originalInvoice.status}</strong>,
                  Balance: KES {selectedClaim.originalInvoice.balanceAmount})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-brand-50 text-brand-800 border border-brand-200">
                  {selectedClaim.status}
                </span>
                <button
                  type="button"
                  onClick={() => handleValidateClaim(selectedClaim.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-brand-200 text-brand-700"
                >
                  Re-Validate
                </button>
                {canSubmitClaims && selectedClaim.status === 'READY' && (
                  <button
                    type="button"
                    onClick={() => openManualDispatch(selectedClaim, false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white"
                  >
                    Submit Claim
                  </button>
                )}
              </div>
            </div>

            {selectedClaim.validationIssues.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1 text-xs">
                <div className="font-bold text-amber-900">Pre-Submission Validation Checks:</div>
                {selectedClaim.validationIssues.map((issue, i) => (
                  <div key={i} className="text-amber-900">
                    [{issue.severity}] <strong>{issue.code}:</strong> {issue.message}
                  </div>
                ))}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Line</th>
                    <th className="px-3 py-2">JaliCare Item</th>
                    <th className="px-3 py-2">Insurer Code</th>
                    <th className="px-3 py-2">Gross</th>
                    <th className="px-3 py-2">Copay</th>
                    <th className="px-3 py-2">Proposed Claim</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedClaim.lines.map((ln) => (
                    <tr key={ln.id}>
                      <td className="px-3 py-2">#{ln.lineNumber}</td>
                      <td className="px-3 py-2">{ln.itemDescription}</td>
                      <td className="px-3 py-2 font-mono">
                        {ln.payerServiceCode ?? ln.mappingStatus}
                      </td>
                      <td className="px-3 py-2">KES {ln.grossAmount}</td>
                      <td className="px-3 py-2">KES {ln.copayAmount}</td>
                      <td className="px-3 py-2 font-bold text-brand-700">
                        KES {ln.proposedClaimAmount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ============================================================
     SCREEN 9: CLAIM SUBMISSIONS & STATUS TRACKING
     ============================================================ */
  if (activeScreen === 'claim_tracking') {
    return (
      <div className="space-y-6">
        {dispatchDialog}
        {decisionDialog}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Send className="w-5 h-5 text-brand-600" />
            Claim Submissions &amp; Status Tracking
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Tracks every claim lifecycle state, submission attempt, correlation ID, external
            reference, and insurer adjudication decision while preserving the original invoice.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Claim #</th>
                  <th className="px-4 py-3">Insurer &amp; Patient</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Proposed / Approved / Paid</th>
                  <th className="px-4 py-3">State &amp; Ref</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {claims.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      No private insurance claims prepared yet.
                    </td>
                  </tr>
                ) : (
                  claims.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                        {c.claimNumber}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{c.patientName}</div>
                        <div className="text-brand-700 font-bold">{c.payerCode}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono">{c.invoiceNumber}</div>
                        <div className="text-slate-500">Inv: {c.originalInvoiceStatus}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>Claimed: KES {c.proposedClaimAmount}</div>
                        <div className="text-slate-500">
                          Appr: KES {c.approvedAmount} · Paid: KES {c.paidAmount}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-800 border border-brand-200 font-semibold">
                          {c.status}
                        </span>
                        <div className="font-mono text-slate-500 mt-0.5">
                          {c.externalClaimReference ?? `Attempts: ${c.submissionCount}`}
                        </div>
                      </td>
                      <td className="px-4 py-3 space-x-2">
                        <button
                          type="button"
                          onClick={() => inspectClaim(c.id)}
                          className="text-brand-700 font-semibold hover:underline"
                        >
                          Inspect
                        </button>
                        {canSubmitClaims && c.status === 'READY' && (
                          <button
                            type="button"
                            onClick={() => openManualDispatch(c, false)}
                            className="text-ember-700 font-semibold hover:underline"
                          >
                            Submit
                          </button>
                        )}
                        {canSubmitClaims && c.status === 'SUBMITTED' && (
                          <>
                            <button
                              type="button"
                              onClick={() => openDecision(c, 'ADJUDICATED')}
                              className="text-brand-700 font-semibold hover:underline"
                            >
                              Mark Adjudicated
                            </button>
                            <button
                              type="button"
                              onClick={() => openDecision(c, 'REJECTED')}
                              className="text-rose-700 font-semibold hover:underline"
                            >
                              Mark Rejected
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selectedClaim && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Submission Attempts &amp; Status History — {selectedClaim.claimNumber}
              </h3>
              <button
                type="button"
                onClick={async () => {
                  const res = await privateInsuranceApi.queryClaimStatus(selectedClaim.id);
                  showToast(res.message, { tone: 'info' });
                  setSelectedClaim(res.claim);
                }}
                className="inline-flex items-center gap-1 text-brand-700 font-semibold"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Poll Adapter Status
              </button>
            </div>
            <div className="space-y-1">
              {selectedClaim.submissions.map((sub) => (
                <div
                  key={sub.id}
                  className="bg-slate-50 border border-slate-200 rounded p-2 flex justify-between"
                >
                  <span>
                    Attempt #{sub.attemptNumber} via <strong>{sub.adapterKey}</strong> (
                    {sub.submissionChannel}) — {sub.outcome}
                  </span>
                  <span className="font-mono text-slate-500">
                    Ref: {sub.externalReference ?? sub.correlationId}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ============================================================
     SCREEN 10: REJECTED CLAIMS & CORRECTIONS
     ============================================================ */
  if (activeScreen === 'claim_rejections') {
    const actionableClaims = claims.filter(
      (c) => c.status === 'REJECTED' || c.status === 'VALIDATION_FAILED',
    );
    return (
      <div className="space-y-6">
        {dispatchDialog}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-ember-600" />
            Rejected Claims &amp; Validation Corrections
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Correct diagnoses, supporting attachments, or preauthorization references with full
            revision audit history, re-validate, and resubmit cleanly.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Claim #</th>
                <th className="px-4 py-3">Insurer &amp; Patient</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Rejection / Validation Issue</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {actionableClaims.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No rejected or validation-blocked claims require correction right now.
                  </td>
                </tr>
              ) : (
                actionableClaims.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-mono font-semibold">{c.claimNumber}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{c.patientName}</div>
                      <div className="text-brand-700 font-bold">{c.payerCode}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200 font-semibold">
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {c.rejectionReason ??
                        c.validationIssues.map((v) => v.message).join('; ') ??
                        'Requires review'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => inspectClaim(c.id)}
                        className="px-3 py-1 rounded bg-ember-500 text-navy-950 font-semibold"
                      >
                        Correct &amp; Re-Validate
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {selectedClaim && (
          <form
            onSubmit={handleSaveCorrectionAndRevalidate}
            className="bg-white border-2 border-ember-300 rounded-xl p-5 shadow-sm space-y-4"
          >
            <h3 className="text-sm font-bold text-slate-900">
              Correct Claim {selectedClaim.claimNumber} (Current Revision #
              {selectedClaim.revisionNumber})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Updated Primary ICD-10 Code
                </label>
                <input
                  required
                  value={correctionForm.diagnosisCode}
                  onChange={(e) =>
                    setCorrectionForm({ ...correctionForm, diagnosisCode: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <label className="text-xs font-semibold text-slate-700">
                Diagnosis description
                <input
                  required
                  value={correctionForm.diagnosisDisplay}
                  onChange={(e) =>
                    setCorrectionForm({ ...correctionForm, diagnosisDisplay: e.target.value })
                  }
                  className="field-input"
                />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                Existing secure document reference
                <input
                  value={correctionForm.attachmentStorageReference}
                  onChange={(e) =>
                    setCorrectionForm({
                      ...correctionForm,
                      attachmentStorageReference: e.target.value,
                    })
                  }
                  className="field-input"
                />
              </label>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supporting Document File Name
                </label>
                <input
                  value={correctionForm.attachmentFile}
                  onChange={(e) =>
                    setCorrectionForm({ ...correctionForm, attachmentFile: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mandatory Correction Reason
                </label>
                <input
                  required
                  value={correctionForm.correctionReason}
                  onChange={(e) =>
                    setCorrectionForm({ ...correctionForm, correctionReason: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Attached signed PACIS/Britam claim form and clinical notes"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {canSubmitClaims && selectedClaim.status === 'READY' && (
                <button
                  type="button"
                  onClick={() => openManualDispatch(selectedClaim, true)}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-brand-600 text-white"
                >
                  Resubmit Corrected Claim
                </button>
              )}
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-ember-500 text-navy-950"
              >
                Save Correction &amp; Re-Validate
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  /* ============================================================
     SCREEN 11: REMITTANCE & RECONCILIATION
     ============================================================ */
  if (activeScreen === 'remittances') {
    const reconcilableClaims = claims.filter((c) =>
      ['SUBMITTED', 'ACKNOWLEDGED', 'ADJUDICATED', 'PARTIALLY_ADJUDICATED'].includes(c.status),
    );
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Landmark className="w-5 h-5 text-brand-600" />
            Insurer Remittance Advice &amp; Additive Invoice Reconciliation
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Record insurer advice and match an independently recorded receipt. This does not create
            payments, alter invoices or verify a bank transfer.
          </p>

          {canReconcileRemittances && (
            <form onSubmit={handleImportAndReconcile} className="mt-4 space-y-4">
              <label className="block text-xs font-semibold text-slate-700">
                Existing unallocated advice (optional)
                <select
                  value={remitForm.existingRemittanceId}
                  onChange={(e) => {
                    const selected = remittances.find((r) => String(r.id) === e.target.value);
                    setRemitForm({
                      ...remitForm,
                      existingRemittanceId: e.target.value,
                      payerCode: selected ? String(selected.payerCode ?? '') : remitForm.payerCode,
                      claimId: '',
                      allocatedAmount: '',
                      billingPaymentId: '',
                    });
                  }}
                  className="field-input"
                >
                  <option value="">Record new advice</option>
                  {remittances
                    .filter((r) => r.status !== 'RECONCILED')
                    .map((r) => (
                      <option key={String(r.id)} value={String(r.id)}>
                        {String(r.remittanceNumber)} · {String(r.payerCode)} ·{' '}
                        {String(r.payerRemittanceRef)}
                      </option>
                    ))}
                </select>
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Insurer</label>
                  <select
                    value={remitForm.payerCode}
                    onChange={(e) => setRemitForm({ ...remitForm, payerCode: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {payers.map((py) => (
                      <option key={py.payerCode} value={py.payerCode}>
                        {py.payerName} ({py.payerCode})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    EFT / Remittance Advice Reference
                  </label>
                  <input
                    required={!remitForm.existingRemittanceId}
                    disabled={Boolean(remitForm.existingRemittanceId)}
                    value={remitForm.adviceReference}
                    onChange={(e) =>
                      setRemitForm({ ...remitForm, adviceReference: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="EFT-BRITAM-20261028-01"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Total Remitted Batch Amount (KES)
                  </label>
                  <input
                    required={!remitForm.existingRemittanceId}
                    disabled={Boolean(remitForm.existingRemittanceId)}
                    value={remitForm.totalRemittedAmount}
                    onChange={(e) =>
                      setRemitForm({ ...remitForm, totalRemittedAmount: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="2500.00"
                  />
                </div>
                <label className="text-xs font-semibold">
                  Actual advice payment date
                  <input
                    type="date"
                    required={!remitForm.existingRemittanceId}
                    disabled={Boolean(remitForm.existingRemittanceId)}
                    value={remitForm.paymentDate}
                    onChange={(e) => setRemitForm({ ...remitForm, paymentDate: e.target.value })}
                    className="field-input"
                  />
                </label>
                <label className="text-xs font-semibold">
                  Actual payment channel
                  <select
                    required={!remitForm.existingRemittanceId}
                    disabled={Boolean(remitForm.existingRemittanceId)}
                    value={remitForm.paymentChannel}
                    onChange={(e) => setRemitForm({ ...remitForm, paymentChannel: e.target.value })}
                    className="field-input"
                  >
                    <option value="">— Select —</option>
                    <option value="EFT">EFT</option>
                    <option value="RTGS">RTGS</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="UNKNOWN">Not stated on advice</option>
                  </select>
                </label>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Allocate Immediately to Submitted/Adjudicated Claim (Optional)
                  </label>
                  <select
                    value={remitForm.claimId}
                    onChange={(e) =>
                      setRemitForm({
                        ...remitForm,
                        claimId: e.target.value,
                        allocatedAmount: '',
                        billingPaymentId: '',
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Import batch only (allocate later)...</option>
                    {reconcilableClaims
                      .filter((c) => c.payerCode === remitForm.payerCode)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.claimNumber} — {c.patientName} (Claimed KES {c.proposedClaimAmount})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Advice Allocation (KES)
                  </label>
                  <input
                    required={Boolean(remitForm.claimId)}
                    value={remitForm.allocatedAmount}
                    onChange={(e) =>
                      setRemitForm({ ...remitForm, allocatedAmount: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="2500.00"
                  />
                </div>
              </div>
              <label className="block text-xs font-semibold text-slate-700">
                Existing billing receipt ID (required when allocating; must match payer, invoice,
                amount and advice reference)
                <input
                  required={Boolean(remitForm.claimId)}
                  type="number"
                  min="1"
                  value={remitForm.billingPaymentId}
                  onChange={(e) => setRemitForm({ ...remitForm, billingPaymentId: e.target.value })}
                  className="field-input"
                />
              </label>
              <p className="text-xs text-slate-600">
                Advice alone is not payment. Record receipts independently in billing. This form
                never posts money.
              </p>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-brand-600 text-white"
                >
                  Import &amp; Reconcile Remittance
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Reconciliation Summary */}
        {reconciliation && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-brand-100 rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase">Total Claimed</div>
              <div className="text-xl font-bold text-slate-900 mt-1">
                KES {reconciliation.summary.totalClaimedAmount}
              </div>
            </div>
            <div className="bg-white border border-brand-100 rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase">Total Remitted</div>
              <div className="text-xl font-bold text-brand-700 mt-1">
                KES {reconciliation.summary.totalRemittedAmount}
              </div>
            </div>
            <div className="bg-white border border-ember-100 rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase">
                Shortfall / Variance
              </div>
              <div className="text-xl font-bold text-ember-700 mt-1">
                KES {reconciliation.summary.totalVarianceAmount}
              </div>
            </div>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-slate-200 font-bold text-sm">
            Remittance Batches ({remittances.length})
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Batch #</th>
                <th className="px-4 py-2.5">Insurer</th>
                <th className="px-4 py-2.5">Advice Ref</th>
                <th className="px-4 py-2.5">Total Remitted</th>
                <th className="px-4 py-2.5">Reconciled</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {remittances.map((r, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-2.5 font-mono">{String(r.remittanceNumber ?? '')}</td>
                  <td className="px-4 py-2.5 font-bold text-brand-700">
                    {String(r.payerCode ?? '')}
                  </td>
                  <td className="px-4 py-2.5 font-mono">{String(r.payerRemittanceRef ?? '')}</td>
                  <td className="px-4 py-2.5">KES {String(r.totalRemittedAmount ?? '0.00')}</td>
                  <td className="px-4 py-2.5">KES {String(r.allocatedAmount ?? '0.00')}</td>
                  <td className="px-4 py-2.5 font-semibold">{String(r.status ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* ============================================================
     SCREEN 12: INTEGRATION DIAGNOSTICS & AUDIT HISTORY
     ============================================================ */
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <Activity className="w-5 h-5 text-brand-600" />
          Integration Diagnostics &amp; Append-Only Audit History
        </h2>
        <p className="text-sm text-slate-600 mt-0.5">
          Secret-redacted operational telemetry across Britam, PACIS, SmartLink gateway, and manual
          workflows alongside immutable JaliCare <code>audit_logs</code> entries.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-slate-200 font-bold text-sm text-slate-900">
          Adapter Diagnostics Log ({diagnostics?.diagnostics.length ?? 0})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Time</th>
                <th className="px-4 py-2.5">Insurer &amp; Adapter</th>
                <th className="px-4 py-2.5">Operation</th>
                <th className="px-4 py-2.5">Outcome</th>
                <th className="px-4 py-2.5">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(diagnostics?.diagnostics ?? []).map((d, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-2.5 text-slate-500">
                    {d.createdAt ? new Date(String(d.createdAt)).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-bold text-brand-700">{String(d.payerCode ?? '')}</span> ·{' '}
                    <span className="font-mono">{String(d.adapterKey ?? '')}</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono">{String(d.operation ?? '')}</td>
                  <td className="px-4 py-2.5 font-semibold">
                    {String(d.outcome ?? '') === 'SUCCESS' ? (
                      <span className="inline-flex items-center gap-1 text-brand-700">
                        <CheckCircle2 className="w-3 h-3" /> {String(d.outcome)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-800">
                        <AlertTriangle className="w-3 h-3" /> {String(d.outcome ?? '')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{String(d.safeSummary ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-slate-200 font-bold text-sm text-slate-900">
          Immutable Private Insurance Audit Events ({diagnostics?.auditEvents.length ?? 0})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Timestamp</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5">Entity</th>
                <th className="px-4 py-2.5">Actor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(diagnostics?.auditEvents ?? []).map((ev, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-2.5 text-slate-500">
                    {ev.timestamp ? new Date(String(ev.timestamp)).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">
                    {String(ev.action ?? '')}
                  </td>
                  <td className="px-4 py-2.5 font-mono">
                    {String(ev.resource ?? '')}:{String(ev.resourceId ?? '')}
                  </td>
                  <td className="px-4 py-2.5">{String(ev.userId ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
