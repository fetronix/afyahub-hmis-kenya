import React, { useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  Layers,
  Paperclip,
  Plus,
  Send,
  ShieldAlert,
} from 'lucide-react';
import type { BillingInvoice, Encounter, Patient, ServiceTariff } from '../../../types/index.ts';
import {
  privateInsuranceApi,
  type PrivateBenefitRule,
  type PrivateBenefitValidationResult,
  type PrivateMemberPolicy,
  type PrivatePayerConfig,
  type PrivatePreauthRecord,
  type PrivateServiceMapping,
} from '../../../api/private-insurance.client.ts';

interface Props {
  activeScreen: 'benefits' | 'mappings' | 'preauthorizations';
  selectedPayerFilter: string;
  payers: PrivatePayerConfig[];
  patients: Patient[];
  encounters: Encounter[];
  invoices: BillingInvoice[];
  tariffs: ServiceTariff[];
  members: PrivateMemberPolicy[];
  rules: PrivateBenefitRule[];
  validations: PrivateBenefitValidationResult[];
  mappings: PrivateServiceMapping[];
  preauthorizations: PrivatePreauthRecord[];
  canManageMappings: boolean;
  canValidateBenefits: boolean;
  canManagePreauth: boolean;
  onRefresh: () => Promise<void>;
  showToast: (msg: string, opts?: { tone?: 'info' | 'success' | 'warning' | 'error' }) => void;
}

const SERVICE_CATEGORIES = [
  'OPD_CONSULTATION',
  'LABORATORY',
  'PHARMACY',
  'IMAGING',
  'PROCEDURE',
  'INPATIENT_BED',
  'THEATRE_SPECIALIST',
];

export const BenefitsMappingsPreauthSection: React.FC<Props> = ({
  activeScreen,
  selectedPayerFilter,
  payers,
  patients,
  encounters,
  invoices,
  tariffs,
  members,
  rules,
  validations,
  mappings,
  preauthorizations,
  canManageMappings,
  canValidateBenefits,
  canManagePreauth,
  onRefresh,
  showToast,
}) => {
  const defaultPayer =
    selectedPayerFilter !== 'ALL' ? selectedPayerFilter : (payers[0]?.payerCode ?? '');

  const [busy, setBusy] = useState(false);

  /* Benefit Rule Form */
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    payerCode: defaultPayer,
    ruleCode: '',
    benefitPackage: '',
    serviceCategory: 'OPD_CONSULTATION',
    copayType: '',
    copayValue: '',
    deductibleAmount: '',
    coinsurancePercent: '',
    perVisitLimit: '',
    annualLimit: '',
    requiresPreauth: false,
    sourceReference: '',
    effectiveFrom: '',
    approveImmediately: false,
  });

  /* Benefit Validation Form */
  const [valForm, setValForm] = useState({
    patientId: '',
    payerCode: defaultPayer,
    tariffId: '',
    serviceCategory: 'OPD_CONSULTATION',
    quantity: '1',
    unitPrice: '',
  });

  /* Service Mapping Form */
  const [showMapForm, setShowMapForm] = useState(false);
  const [mapForm, setMapForm] = useState({
    payerCode: defaultPayer,
    tariffId: '',
    localCode: '',
    localDescription: '',
    serviceArea: 'OPD_CONSULTATION',
    payerServiceCode: '',
    payerServiceName: '',
    reimbursementTariff: '',
    requiresPreauth: false,
    effectiveFrom: '',
  });

  /* Preauth Form & Decision Modal */
  const [showPreauthForm, setShowPreauthForm] = useState(false);
  const [preauthForm, setPreauthForm] = useState({
    patientId: '',
    payerCode: defaultPayer,
    memberPolicyId: '',
    encounterId: '',
    invoiceId: '',
    category: 'PROCEDURE',
    clinicalIndication: '',
    primaryDiagnosisCode: '',
    primaryDiagnosisDisplay: '',
    requestedServiceCode: '',
    requestedServiceName: '',
    quantity: '1',
    unitPrice: '',
  });

  const [dispatchTarget, setDispatchTarget] = useState<PrivatePreauthRecord | null>(null);
  const [dispatchReference, setDispatchReference] = useState('');
  const [decisionTarget, setDecisionTarget] = useState<PrivatePreauthRecord | null>(null);
  const [decisionForm, setDecisionForm] = useState({
    status: '',
    payerAuthReference: '',
    approvedAmount: '',
    validUntil: '',
    conditions: '',
    rejectionReason: '',
  });

  const [attachmentTarget, setAttachmentTarget] = useState<PrivatePreauthRecord | null>(null);
  const [attachmentForm, setAttachmentForm] = useState({
    documentType: 'CLINICAL_NOTES',
    fileName: '',
    storageReference: '',
  });

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await privateInsuranceApi.createBenefitRule({
        ...ruleForm,
        perVisitLimit: ruleForm.perVisitLimit || null,
        annualLimit: ruleForm.annualLimit || null,
      });
      showToast('Insurer benefit rule saved.', { tone: 'success' });
      setShowRuleForm(false);
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save benefit rule.', {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleValidateBenefit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await privateInsuranceApi.validateBenefit({
        patientId: Number(valForm.patientId),
        payerCode: valForm.payerCode,
        tariffId: valForm.tariffId ? Number(valForm.tariffId) : undefined,
        serviceCategory: valForm.serviceCategory,
        quantity: Number(valForm.quantity || 1),
        unitPrice: valForm.unitPrice || undefined,
      });
      showToast(
        `Benefit check: ${res.decision} — Est. Covered KES ${res.estimatedCoveredAmount ?? 'N/A'}`,
        {
          tone: res.decision === 'COVERED' ? 'success' : 'info',
        },
      );
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Benefit validation failed.', {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await privateInsuranceApi.createMapping({
        payerCode: mapForm.payerCode,
        tariffId: mapForm.tariffId ? Number(mapForm.tariffId) : undefined,
        localCode: mapForm.localCode || undefined,
        localDescription: mapForm.localDescription || undefined,
        serviceArea: mapForm.serviceArea,
        payerServiceCode: mapForm.payerServiceCode,
        payerServiceName: mapForm.payerServiceName || undefined,
        reimbursementTariff: mapForm.reimbursementTariff || null,
        requiresPreauth: mapForm.requiresPreauth,
        effectiveFrom: mapForm.effectiveFrom || null,
      });
      showToast('Insurer service-code mapping saved.', { tone: 'success' });
      setShowMapForm(false);
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save mapping.', {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePreauth = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await privateInsuranceApi.createPreauthorization({
        patientId: Number(preauthForm.patientId),
        payerCode: preauthForm.payerCode,
        memberPolicyId: preauthForm.memberPolicyId ? Number(preauthForm.memberPolicyId) : undefined,
        encounterId: preauthForm.encounterId ? Number(preauthForm.encounterId) : undefined,
        invoiceId: preauthForm.invoiceId ? Number(preauthForm.invoiceId) : undefined,
        category: preauthForm.category,
        clinicalIndication: preauthForm.clinicalIndication,
        primaryDiagnosisCode: preauthForm.primaryDiagnosisCode,
        primaryDiagnosisDisplay: preauthForm.primaryDiagnosisDisplay,
        requestedItems: [
          {
            serviceCode: preauthForm.requestedServiceCode,
            serviceName: preauthForm.requestedServiceName,
            quantity: Number(preauthForm.quantity || 1),
            unitPrice: preauthForm.unitPrice,
          },
        ],
      });
      showToast('Draft preauthorization created.', { tone: 'success' });
      setShowPreauthForm(false);
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create preauthorization.', {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitPreauth = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dispatchTarget) return;
    setBusy(true);
    try {
      await privateInsuranceApi.submitPreauthorization(dispatchTarget.id, {
        submissionMode: 'MANUAL',
        manualDispatchReference: dispatchReference.trim(),
      });
      showToast('Manual preauthorization dispatch recorded. No API request was made.', {
        tone: 'success',
      });
      setDispatchTarget(null);
      setDispatchReference('');
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not record dispatch.', {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decisionTarget) return;
    setBusy(true);
    try {
      await privateInsuranceApi.updatePreauthorization(decisionTarget.id, {
        status: decisionForm.status,
        payerAuthReference: decisionForm.payerAuthReference || undefined,
        approvedAmount: decisionForm.approvedAmount || undefined,
        validUntil: decisionForm.validUntil || undefined,
        conditions: decisionForm.conditions || undefined,
        rejectionReason: decisionForm.rejectionReason || undefined,
      });
      showToast('Insurer preauthorization decision recorded.', { tone: 'success' });
      setDecisionTarget(null);
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to record decision.', {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAttachment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attachmentTarget) return;
    setBusy(true);
    try {
      await privateInsuranceApi.addPreauthAttachment(attachmentTarget.id, attachmentForm);
      showToast('Supporting document attached.', { tone: 'success' });
      setAttachmentTarget(null);
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Attachment failed.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  /* ============================================================
     SCREEN 5: BENEFITS & LIMITS
     ============================================================ */
  if (activeScreen === 'benefits') {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-brand-600" />
              Benefits, Copayments &amp; Scheme Limits
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Every insurer maintains independent effective-dated rules. Configured facility rules
              produce clearly labelled <strong>coverage estimates</strong>, never guaranteed
              reimbursement.
            </p>
          </div>
          {canManageMappings && (
            <button
              type="button"
              onClick={() => setShowRuleForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700"
            >
              <Plus className="w-4 h-4" />
              New Insurer Benefit Rule
            </button>
          )}
        </div>

        {showRuleForm && canManageMappings && (
          <form
            onSubmit={handleCreateRule}
            className="bg-white border border-brand-200 rounded-xl p-5 shadow-sm space-y-4"
          >
            <h3 className="text-sm font-bold text-slate-900">
              Create Effective-Dated Insurer Benefit Rule
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Insurer</label>
                <select
                  value={ruleForm.payerCode}
                  onChange={(e) => setRuleForm({ ...ruleForm, payerCode: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {payers.map((p) => (
                    <option key={p.payerCode} value={p.payerCode}>
                      {p.payerName} ({p.payerCode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Rule Code</label>
                <input
                  required
                  value={ruleForm.ruleCode}
                  onChange={(e) =>
                    setRuleForm({ ...ruleForm, ruleCode: e.target.value.toUpperCase() })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="BRITAM-OPD-STD-2026"
                />
              </div>
              <label className="text-xs font-semibold">
                Actual contracted benefit package
                <input
                  required
                  value={ruleForm.benefitPackage}
                  onChange={(e) => setRuleForm({ ...ruleForm, benefitPackage: e.target.value })}
                  className="field-input"
                />
              </label>
              <label className="text-xs font-semibold">
                Contract effective from
                <input
                  required
                  type="date"
                  value={ruleForm.effectiveFrom}
                  onChange={(e) => setRuleForm({ ...ruleForm, effectiveFrom: e.target.value })}
                  className="field-input"
                />
              </label>
              <label className="text-xs font-semibold">
                Contract deductible (0 only if none)
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={ruleForm.deductibleAmount}
                  onChange={(e) => setRuleForm({ ...ruleForm, deductibleAmount: e.target.value })}
                  className="field-input"
                />
              </label>
              <label className="text-xs font-semibold">
                Contract coinsurance % (0 only if none)
                <input
                  required
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={ruleForm.coinsurancePercent}
                  onChange={(e) => setRuleForm({ ...ruleForm, coinsurancePercent: e.target.value })}
                  className="field-input"
                />
              </label>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Service Category
                </label>
                <select
                  value={ruleForm.serviceCategory}
                  onChange={(e) => setRuleForm({ ...ruleForm, serviceCategory: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {SERVICE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Copayment Type
                </label>
                <select
                  value={ruleForm.copayType}
                  onChange={(e) => setRuleForm({ ...ruleForm, copayType: e.target.value })}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">— Select contract term —</option>
                  <option value="NONE">NONE</option>
                  <option value="FIXED">FIXED (KES)</option>
                  <option value="PERCENTAGE">PERCENTAGE (%)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Copayment Value
                </label>
                <input
                  required
                  value={ruleForm.copayValue}
                  onChange={(e) => setRuleForm({ ...ruleForm, copayValue: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Per-Visit Limit (KES, optional)
                </label>
                <input
                  value={ruleForm.perVisitLimit}
                  onChange={(e) => setRuleForm({ ...ruleForm, perVisitLimit: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="e.g. 15000.00"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Contract / Circular Source Reference (Required)
                </label>
                <input
                  required
                  value={ruleForm.sourceReference}
                  onChange={(e) => setRuleForm({ ...ruleForm, sourceReference: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="e.g. Britam Provider Schedule FY 2026 Clause 4.2"
                />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={ruleForm.requiresPreauth}
                    onChange={(e) =>
                      setRuleForm({ ...ruleForm, requiresPreauth: e.target.checked })
                    }
                  />
                  Requires Preauthorization
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRuleForm(false)}
                className="px-3 py-1.5 text-sm text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-ember-500 text-navy-950"
              >
                Save Benefit Rule
              </button>
            </div>
          </form>
        )}

        {/* Validate Service Benefit Card */}
        {canValidateBenefits && (
          <form
            onSubmit={handleValidateBenefit}
            className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4"
          >
            <h3 className="text-sm font-bold text-slate-900">
              Validate Service Coverage &amp; Copayment Estimate
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <select
                required
                value={valForm.patientId}
                onChange={(e) => setValForm({ ...valForm, patientId: e.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Patient...</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()}
                  </option>
                ))}
              </select>
              <select
                value={valForm.payerCode}
                onChange={(e) => setValForm({ ...valForm, payerCode: e.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {payers.map((py) => (
                  <option key={py.payerCode} value={py.payerCode}>
                    {py.payerCode}
                  </option>
                ))}
              </select>
              <select
                required
                value={valForm.tariffId}
                onChange={(e) => setValForm({ ...valForm, tariffId: e.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              >
                <option value="">Select JaliCare Service Tariff...</option>
                {tariffs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.description} (KES {t.fee})
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700"
              >
                Check Coverage
              </button>
            </div>
          </form>
        )}

        {/* Configured Rules Table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-slate-200 font-bold text-sm text-slate-900">
            Configured Insurer Benefit Rules ({rules.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Insurer</th>
                  <th className="px-4 py-2.5">Rule Code</th>
                  <th className="px-4 py-2.5">Category</th>
                  <th className="px-4 py-2.5">Copay / Limits</th>
                  <th className="px-4 py-2.5">Preauth</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 font-bold text-brand-700">{r.payerCode}</td>
                    <td className="px-4 py-2.5 font-mono">{r.ruleCode}</td>
                    <td className="px-4 py-2.5">{r.serviceCategory}</td>
                    <td className="px-4 py-2.5">
                      Copay: {r.copayType} ({r.copayValue}) · Visit Limit:{' '}
                      {r.perVisitLimit ?? 'Unlimited'}
                    </td>
                    <td className="px-4 py-2.5">{r.requiresPreauth ? 'Required' : 'No'}</td>
                    <td className="px-4 py-2.5 font-semibold">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Validations */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-slate-200 font-bold text-sm text-slate-900">
            Benefit Coverage Validation Log (Estimates — Not Guaranteed Reimbursement)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Insurer</th>
                  <th className="px-4 py-2.5">JaliCare Service</th>
                  <th className="px-4 py-2.5">Insurer Code</th>
                  <th className="px-4 py-2.5">Decision &amp; Evidence</th>
                  <th className="px-4 py-2.5">Est. Claimable</th>
                  <th className="px-4 py-2.5">Est. Copay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {validations.map((v) => (
                  <tr key={v.id}>
                    <td className="px-4 py-2.5 font-bold text-brand-700">{v.payerCode}</td>
                    <td className="px-4 py-2.5">{v.serviceDescription}</td>
                    <td className="px-4 py-2.5 font-mono">{v.payerServiceCode ?? 'UNMAPPED'}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-slate-900">{v.decision}</div>
                      <div className="text-slate-500">{v.verificationSource}</div>
                    </td>
                    <td className="px-4 py-2.5 font-semibold">
                      {v.estimatedCoveredAmount ? `KES ${v.estimatedCoveredAmount}` : '—'}
                    </td>
                    <td className="px-4 py-2.5">KES {v.estimatedCopayAmount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  /* ============================================================
     SCREEN 6: SERVICE-CODE MAPPING
     ============================================================ */
  if (activeScreen === 'mappings') {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-brand-600" />
              JaliCare-to-Insurer Service-Code Mapping
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Maps internal JaliCare tariffs across OPD, lab, pharmacy, imaging, procedures,
              inpatient beds, and theatre to Britam and PACIS service codes.
            </p>
          </div>
          {canManageMappings && (
            <button
              type="button"
              onClick={() => setShowMapForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700"
            >
              <Plus className="w-4 h-4" />
              Add Service Mapping
            </button>
          )}
        </div>

        {showMapForm && canManageMappings && (
          <form
            onSubmit={handleCreateMapping}
            className="bg-white border border-brand-200 rounded-xl p-5 shadow-sm space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Insurer</label>
                <select
                  value={mapForm.payerCode}
                  onChange={(e) => setMapForm({ ...mapForm, payerCode: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {payers.map((py) => (
                    <option key={py.payerCode} value={py.payerCode}>
                      {py.payerName} ({py.payerCode})
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  JaliCare Facility Service Tariff
                </label>
                <select
                  value={mapForm.tariffId}
                  onChange={(e) => {
                    const t = tariffs.find((item) => String(item.id) === e.target.value);
                    setMapForm({
                      ...mapForm,
                      tariffId: e.target.value,
                      localCode: t?.code ?? mapForm.localCode,
                      localDescription: t?.description ?? mapForm.localDescription,
                    });
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">
                    Select existing JaliCare tariff (or enter custom below)...
                  </option>
                  {tariffs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code} — {t.description} (KES {t.fee})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  JaliCare Local Code
                </label>
                <input
                  required
                  value={mapForm.localCode}
                  onChange={(e) => setMapForm({ ...mapForm, localCode: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Service Category
                </label>
                <select
                  value={mapForm.serviceArea}
                  onChange={(e) => setMapForm({ ...mapForm, serviceArea: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {SERVICE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Insurer Service Code (e.g. Britam/PACIS Code)
                </label>
                <input
                  required
                  value={mapForm.payerServiceCode}
                  onChange={(e) => setMapForm({ ...mapForm, payerServiceCode: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  placeholder="BRM-CONS-001"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Insurer Contracted Tariff (KES, optional)
                </label>
                <input
                  value={mapForm.reimbursementTariff}
                  onChange={(e) => setMapForm({ ...mapForm, reimbursementTariff: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="2500.00"
                />
              </div>
              <label className="text-xs font-semibold">
                Mapping effective from
                <input
                  required
                  type="date"
                  value={mapForm.effectiveFrom}
                  onChange={(e) => setMapForm({ ...mapForm, effectiveFrom: e.target.value })}
                  className="field-input"
                />
              </label>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={mapForm.requiresPreauth}
                    onChange={(e) => setMapForm({ ...mapForm, requiresPreauth: e.target.checked })}
                  />
                  Requires Preauthorization
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowMapForm(false)}
                className="px-3 py-1.5 text-sm text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-ember-500 text-navy-950"
              >
                Save Mapping
              </button>
            </div>
          </form>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Insurer</th>
                  <th className="px-4 py-3">JaliCare Code &amp; Service</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Insurer Code</th>
                  <th className="px-4 py-3">Contracted Tariff</th>
                  <th className="px-4 py-3">Preauth</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mappings.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No insurer service mappings configured yet.
                    </td>
                  </tr>
                ) : (
                  mappings.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-3 font-bold text-brand-700">{m.payerCode}</td>
                      <td className="px-4 py-3">
                        <div className="font-mono font-semibold text-slate-900">{m.localCode}</div>
                        <div className="text-slate-600">{m.localDescription}</div>
                      </td>
                      <td className="px-4 py-3">{m.serviceArea}</td>
                      <td className="px-4 py-3 font-mono font-semibold text-ember-700">
                        {m.payerServiceCode}
                      </td>
                      <td className="px-4 py-3">
                        {m.reimbursementTariff ? `KES ${m.reimbursementTariff}` : 'Invoice rate'}
                      </td>
                      <td className="px-4 py-3">{m.requiresPreauth ? 'Yes' : 'No'}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-800 border border-brand-200 font-semibold">
                          {m.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  /* ============================================================
     SCREEN 7: PREAUTHORIZATION MANAGEMENT
     ============================================================ */
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 text-brand-600" />
            Preauthorization Management
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Draft, submit, attach clinical evidence, and record authentic insurer authorization
            decisions. JaliCare never fabricates insurer approval numbers.
          </p>
        </div>
        {canManagePreauth && (
          <button
            type="button"
            onClick={() => setShowPreauthForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700"
          >
            <Plus className="w-4 h-4" />
            Draft Preauthorization
          </button>
        )}
      </div>

      {dispatchTarget && (
        <form
          onSubmit={handleSubmitPreauth}
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3"
          aria-label="Record manual preauthorization dispatch"
        >
          <h3 className="font-bold">Record manual dispatch — {dispatchTarget.preauthNumber}</h3>
          <p className="text-xs">
            Send through the insurer's approved manual channel first. Recording a reference does not
            imply approval.
          </p>
          <label className="block text-xs font-semibold">
            Actual portal, email or courier reference
            <input
              required
              minLength={3}
              value={dispatchReference}
              onChange={(e) => setDispatchReference(e.target.value)}
              className="field-input"
            />
          </label>
          <div className="flex gap-3">
            <button disabled={busy} className="btn-primary">
              Record dispatch
            </button>
            <button
              type="button"
              onClick={() => setDispatchTarget(null)}
              className="text-sm underline"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {showPreauthForm && canManagePreauth && (
        <form
          onSubmit={handleCreatePreauth}
          className="bg-white border border-brand-200 rounded-xl p-5 shadow-sm space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Patient</label>
              <select
                required
                value={preauthForm.patientId}
                onChange={(e) => setPreauthForm({ ...preauthForm, patientId: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select patient...</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Insurer</label>
              <select
                value={preauthForm.payerCode}
                onChange={(e) => setPreauthForm({ ...preauthForm, payerCode: e.target.value })}
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
                Member Policy (Optional)
              </label>
              <select
                value={preauthForm.memberPolicyId}
                onChange={(e) => setPreauthForm({ ...preauthForm, memberPolicyId: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Auto-match or select policy...</option>
                {members
                  .filter(
                    (m) =>
                      (!preauthForm.patientId || m.patientId === Number(preauthForm.patientId)) &&
                      m.payerCode === preauthForm.payerCode,
                  )
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.memberNumber} ({m.payerCode})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Linked Encounter (Optional)
              </label>
              <select
                value={preauthForm.encounterId}
                onChange={(e) => setPreauthForm({ ...preauthForm, encounterId: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">None</option>
                {encounters
                  .filter(
                    (enc) =>
                      !preauthForm.patientId ||
                      Number(enc.patientId) === Number(preauthForm.patientId),
                  )
                  .map((enc) => (
                    <option key={enc.id} value={enc.id}>
                      Encounter #{enc.id}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Linked Invoice (Optional)
              </label>
              <select
                value={preauthForm.invoiceId}
                onChange={(e) => setPreauthForm({ ...preauthForm, invoiceId: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">None</option>
                {invoices
                  .filter(
                    (inv) =>
                      !preauthForm.patientId ||
                      Number(inv.patientId) === Number(preauthForm.patientId),
                  )
                  .map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNumber} (KES {inv.totalAmount})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
              <select
                value={preauthForm.category}
                onChange={(e) => setPreauthForm({ ...preauthForm, category: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {SERVICE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <label className="text-xs font-semibold text-slate-700">
              Primary diagnosis code
              <input
                required
                value={preauthForm.primaryDiagnosisCode}
                onChange={(e) =>
                  setPreauthForm({ ...preauthForm, primaryDiagnosisCode: e.target.value })
                }
                className="field-input"
              />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Diagnosis description
              <input
                required
                value={preauthForm.primaryDiagnosisDisplay}
                onChange={(e) =>
                  setPreauthForm({ ...preauthForm, primaryDiagnosisDisplay: e.target.value })
                }
                className="field-input"
              />
            </label>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Requested Service Code
              </label>
              <input
                required
                value={preauthForm.requestedServiceCode}
                onChange={(e) =>
                  setPreauthForm({ ...preauthForm, requestedServiceCode: e.target.value })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="IMG-CT-01"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Requested Procedure / Service Name
              </label>
              <input
                required
                value={preauthForm.requestedServiceName}
                onChange={(e) =>
                  setPreauthForm({ ...preauthForm, requestedServiceName: e.target.value })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="CT Scan Chest with Contrast"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Estimated Unit Cost (KES)
              </label>
              <input
                required
                value={preauthForm.unitPrice}
                onChange={(e) => setPreauthForm({ ...preauthForm, unitPrice: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Clinical Indication &amp; Notes
              </label>
              <input
                required
                value={preauthForm.clinicalIndication}
                onChange={(e) =>
                  setPreauthForm({ ...preauthForm, clinicalIndication: e.target.value })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Persistent dyspnea and abnormal chest radiograph"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowPreauthForm(false)}
              className="px-3 py-1.5 text-sm text-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-ember-500 text-navy-950"
            >
              Create Draft Preauthorization
            </button>
          </div>
        </form>
      )}

      {decisionTarget && canManagePreauth && (
        <form
          onSubmit={handleSaveDecision}
          className="bg-white border-2 border-brand-300 rounded-xl p-5 shadow-sm space-y-4"
        >
          <h3 className="text-sm font-bold text-slate-900">
            Record Insurer Decision — {decisionTarget.preauthNumber} ({decisionTarget.payerCode})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Decision</label>
              <select
                value={decisionForm.status}
                onChange={(e) => setDecisionForm({ ...decisionForm, status: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              >
                <option value="">— Select actual decision —</option>
                <option value="APPROVED">APPROVED</option>
                <option value="PARTIALLY_APPROVED">PARTIALLY_APPROVED</option>
                <option value="REJECTED">REJECTED</option>
                <option value="PENDING">PENDING</option>
                <option value="EXPIRED">EXPIRED</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Insurer Authorization Reference
              </label>
              <input
                value={decisionForm.payerAuthReference}
                onChange={(e) =>
                  setDecisionForm({ ...decisionForm, payerAuthReference: e.target.value })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Reference from payer decision"
                required={
                  decisionForm.status === 'APPROVED' ||
                  decisionForm.status === 'PARTIALLY_APPROVED' ||
                  decisionForm.status === 'REJECTED'
                }
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Approved Amount (KES)
              </label>
              <input
                value={decisionForm.approvedAmount}
                onChange={(e) =>
                  setDecisionForm({ ...decisionForm, approvedAmount: e.target.value })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Enter actual payer-approved amount"
                required={
                  decisionForm.status === 'APPROVED' || decisionForm.status === 'PARTIALLY_APPROVED'
                }
              />
            </div>
          </div>
          {decisionForm.status === 'REJECTED' && (
            <label className="text-xs font-semibold">
              Actual rejection reason
              <input
                required
                value={decisionForm.rejectionReason}
                onChange={(e) =>
                  setDecisionForm({ ...decisionForm, rejectionReason: e.target.value })
                }
                className="field-input"
              />
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDecisionTarget(null)}
              className="px-3 py-1.5 text-sm text-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-brand-600 text-white"
            >
              Save Decision
            </button>
          </div>
        </form>
      )}

      {attachmentTarget && canManagePreauth && (
        <form
          onSubmit={handleSaveAttachment}
          className="bg-white border-2 border-ember-300 rounded-xl p-5 shadow-sm space-y-4"
        >
          <h3 className="text-sm font-bold text-slate-900">
            Attach Supporting Document — {attachmentTarget.preauthNumber}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <select
              value={attachmentForm.documentType}
              onChange={(e) =>
                setAttachmentForm({ ...attachmentForm, documentType: e.target.value })
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="CLINICAL_NOTES">Clinical Notes</option>
              <option value="LAB_REPORT">Diagnostic / Lab Report</option>
              <option value="RADIOLOGY_REQUEST">Radiology Request Form</option>
              <option value="COST_ESTIMATE">Hospital Cost Estimate</option>
            </select>
            <input
              required
              value={attachmentForm.fileName}
              onChange={(e) => setAttachmentForm({ ...attachmentForm, fileName: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="ct-chest-request.pdf"
            />
            <input
              required
              value={attachmentForm.storageReference}
              onChange={(e) =>
                setAttachmentForm({ ...attachmentForm, storageReference: e.target.value })
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="vault://preauth/ct-chest-request.pdf"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAttachmentTarget(null)}
              className="px-3 py-1.5 text-sm text-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-ember-500 text-navy-950"
            >
              Save Attachment
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Preauth #</th>
                <th className="px-4 py-3">Patient &amp; Insurer</th>
                <th className="px-4 py-3">Service &amp; Diagnosis</th>
                <th className="px-4 py-3">Estimated / Approved</th>
                <th className="px-4 py-3">Status &amp; Auth Ref</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {preauthorizations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No preauthorizations recorded yet.
                  </td>
                </tr>
              ) : (
                preauthorizations.map((pa) => (
                  <tr key={pa.id}>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                      {pa.preauthNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{pa.patientName}</div>
                      <span className="text-[11px] font-bold text-brand-700">{pa.payerCode}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{pa.requestedServiceName}</div>
                      <div className="text-slate-500">
                        {pa.primaryDiagnosisCode} — {pa.primaryDiagnosisDisplay}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>Est: KES {pa.estimatedAmount}</div>
                      {pa.approvedAmount && (
                        <div className="font-semibold text-brand-700">
                          Appr: KES {pa.approvedAmount}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-brand-200 bg-brand-50 text-brand-800 font-semibold">
                        {pa.status === 'APPROVED' ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <ShieldAlert className="w-3 h-3" />
                        )}
                        {pa.status}
                      </span>
                      <div className="font-mono text-slate-500 mt-0.5">
                        {pa.payerAuthReference ?? 'Awaiting Auth Ref'}
                      </div>
                    </td>
                    <td className="px-4 py-3 space-x-2">
                      {canManagePreauth && pa.status === 'DRAFT' && (
                        <button
                          type="button"
                          onClick={() => {
                            setDispatchTarget(pa);
                            setDispatchReference('');
                          }}
                          className="inline-flex items-center gap-1 text-brand-700 font-semibold hover:underline"
                        >
                          <Send className="w-3 h-3" /> Submit
                        </button>
                      )}
                      {canManagePreauth && (
                        <>
                          <button
                            type="button"
                            onClick={() => setAttachmentTarget(pa)}
                            className="inline-flex items-center gap-1 text-slate-600 font-semibold hover:underline"
                          >
                            <Paperclip className="w-3 h-3" /> Attach
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDecisionTarget(pa);
                              setDecisionForm({
                                status: '',
                                payerAuthReference: pa.payerAuthReference ?? '',
                                approvedAmount: '',
                                validUntil: '',
                                conditions: '',
                                rejectionReason: '',
                              });
                            }}
                            className="text-ember-700 font-semibold hover:underline"
                          >
                            Decision
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
    </div>
  );
};
