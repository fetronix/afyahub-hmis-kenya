import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Landmark,
  Network,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import {
  shaEclaimsApi,
  type ShaBenefitRuleRecord,
  type ShaConnectionStatusResponse,
  type ShaEclaimSummary,
  type ShaRemittanceRecord,
  type ShaServiceMappingRecord,
} from '../../../api/sha-eclaims.client.ts';

interface Props {
  facilityId: number | null;
  section: 'connection' | 'remittance' | 'admin';
  canReconcile: boolean;
  canManageConfig: boolean;
  showToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export const RemittanceAndAdminWorkspace: React.FC<Props> = ({
  facilityId,
  section,
  canReconcile,
  canManageConfig,
  showToast,
}) => {
  const [connData, setConnData] = useState<ShaConnectionStatusResponse | null>(null);
  const [remittances, setRemittances] = useState<ShaRemittanceRecord[]>([]);
  const [eligibleClaims, setEligibleClaims] = useState<ShaEclaimSummary[]>([]);
  const [mappings, setMappings] = useState<ShaServiceMappingRecord[]>([]);
  const [facilityTariffs, setFacilityTariffs] = useState<
    Array<{ id: number; code: string; description: string; department: string; fee: string }>
  >([]);
  const [rules, setRules] = useState<ShaBenefitRuleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncingRemittances, setSyncingRemittances] = useState(false);
  const [paidClaimsBreakdown, setPaidClaimsBreakdown] = useState<
    Array<{
      payerClaimReference: string;
      claimNumber: string | null;
      paidAmountKes: string;
      matchedLocalClaimNumber: string | null;
    }>
  >([]);
  const [opReportMetrics, setOpReportMetrics] = useState<{
    eligibilityChecksTotal: number;
    deceasedBlockedCount: number;
    visitAuthorizationsTotal: number;
    claimsTotal: number;
    totalClaimed: string;
    totalPaid: string;
  } | null>(null);

  // Remittance create form
  const [payerRemittanceRef, setPayerRemittanceRef] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentChannel, setPaymentChannel] = useState('');
  const [totalRemittedAmount, setTotalRemittedAmount] = useState('');
  const [remNotes, setRemNotes] = useState('');

  // Reconciliation form
  const [selectedRemId, setSelectedRemId] = useState<number | ''>('');
  const [selectedEclaimId, setSelectedEclaimId] = useState<number | ''>('');
  const [allocAmount, setAllocAmount] = useState('');
  const [varianceReason, setVarianceReason] = useState('');
  const [billingPaymentId, setBillingPaymentId] = useState('');

  // Admin: Facility payer config
  const [facilityRegCode, setFacilityRegCode] = useState('');
  const [accreditationLevel, setAccreditationLevel] = useState('');
  const [contractedSchemesText, setContractedSchemesText] = useState('');

  // Admin: Service mapping form
  const [mapTariffId, setMapTariffId] = useState<number | ''>('');
  const [localCode, setLocalCode] = useState('');
  const [localDescription, setLocalDescription] = useState('');
  const [serviceArea, setServiceArea] = useState('OPD');
  const [payerServiceCode, setPayerServiceCode] = useState('');
  const [payerServiceName, setPayerServiceName] = useState('');
  const [fund, setFund] = useState('');
  const [accessPoint, setAccessPoint] = useState('');
  const [paymentMechanism, setPaymentMechanism] = useState('');
  const [reimbursementTariff, setReimbursementTariff] = useState('');
  const [isPhcZeroTariff, setIsPhcZeroTariff] = useState(false);
  const [mapRequiresPreauth, setMapRequiresPreauth] = useState(false);

  // Admin: Benefit rule form
  const [ruleCode, setRuleCode] = useState('');
  const [rulePackage, setRulePackage] = useState('');
  const [ruleCategory, setRuleCategory] = useState('OPD');
  const [rulePayerCode, setRulePayerCode] = useState('');
  const [ruleMinLevel, setRuleMinLevel] = useState('');
  const [ruleRequiresPreauth, setRuleRequiresPreauth] = useState(false);
  const [ruleRequiresReferral, setRuleRequiresReferral] = useState(false);
  const [ruleCopayType, setRuleCopayType] = useState('');
  const [ruleCopayValue, setRuleCopayValue] = useState('');
  const [ruleSourceRef, setRuleSourceRef] = useState('');
  const [ruleEffectiveFrom, setRuleEffectiveFrom] = useState('');

  const loadSectionData = useCallback(async () => {
    setLoading(true);
    try {
      if (section === 'connection') {
        const [res, repRes] = await Promise.all([
          shaEclaimsApi.getConnectionStatus(facilityId),
          shaEclaimsApi.getOperationalReport(facilityId).catch(() => null),
        ]);
        setConnData(res);
        setFacilityRegCode(res.facilityConfig.facilityRegistryCode ?? '');
        setAccreditationLevel(res.facilityConfig.facilityLevel ?? '');
        setContractedSchemesText(res.facilityConfig.contractedSchemes.join(', '));
        if (repRes?.report?.metrics) {
          setOpReportMetrics({
            eligibilityChecksTotal: repRes.report.metrics.eligibilityChecksTotal,
            deceasedBlockedCount: repRes.report.metrics.deceasedBlockedCount,
            visitAuthorizationsTotal: repRes.report.metrics.visitAuthorizationsTotal,
            claimsTotal: repRes.report.metrics.claimsTotal,
            totalClaimed: repRes.report.metrics.financialsKes.totalClaimed,
            totalPaid: repRes.report.metrics.financialsKes.totalPaid,
          });
        }
      } else if (section === 'remittance') {
        const [remRes, clmRes] = await Promise.all([
          shaEclaimsApi.listRemittances(facilityId),
          shaEclaimsApi.listClaims(facilityId),
        ]);
        setRemittances(remRes.remittances);
        setEligibleClaims(
          clmRes.claims.filter(
            (c) =>
              c.status === 'ACKNOWLEDGED' ||
              c.status === 'ADJUDICATED' ||
              c.status === 'PARTIALLY_ADJUDICATED' ||
              c.status === 'DISPUTED',
          ),
        );
      } else if (section === 'admin') {
        const [connRes, mapRes, ruleRes] = await Promise.all([
          shaEclaimsApi.getConnectionStatus(facilityId),
          shaEclaimsApi.listServiceMappings(facilityId),
          shaEclaimsApi.listBenefitRules(facilityId),
        ]);
        setConnData(connRes);
        setFacilityRegCode(connRes.facilityConfig.facilityRegistryCode ?? '');
        setAccreditationLevel(connRes.facilityConfig.facilityLevel ?? '');
        setContractedSchemesText(connRes.facilityConfig.contractedSchemes.join(', '));
        setMappings(mapRes.mappings);
        setFacilityTariffs(mapRes.facilityTariffs);
        setRules(ruleRes.rules);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load SHA section data.', 'error');
    } finally {
      setLoading(false);
    }
  }, [facilityId, section, showToast]);

  useEffect(() => {
    void loadSectionData();
  }, [loadSectionData]);

  const handleSyncHieRemittances = async () => {
    setSyncingRemittances(true);
    try {
      const res = await shaEclaimsApi.syncRemittances(facilityId, {
        facilityIdType: 'fr-code',
      });
      showToast(
        `Synced ${res.imported.length} new SHA remittance(s) (${res.isSimulated ? 'Sandbox Simulation' : 'Live HIE'})`,
        'info',
      );
      await loadSectionData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'HIE remittance sync failed.', 'error');
    } finally {
      setSyncingRemittances(false);
    }
  };

  const handleLoadRemittanceClaims = async (remId: number) => {
    try {
      const res = await shaEclaimsApi.getRemittanceClaims(remId, facilityId);
      setPaidClaimsBreakdown(res.claims);
      showToast(
        `Loaded ${res.claims.length} paid claim line(s) for bank_reference ${res.bankReference}`,
        'info',
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to fetch remittance claim breakdown.',
        'error',
      );
    }
  };

  const handleRecordRemittance = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await shaEclaimsApi.recordRemittance(facilityId, {
        payerRemittanceRef,
        paymentDate,
        paymentChannel,
        totalRemittedAmount,
        notes: remNotes.trim() || undefined,
      });
      showToast(`Recorded remittance ${res.remittance.remittanceNumber}`, 'success');
      setPayerRemittanceRef('');
      setTotalRemittedAmount('');
      setRemNotes('');
      await loadSectionData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to record remittance.', 'error');
    }
  };

  const handleReconcile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRemId || !selectedEclaimId) {
      showToast('Select both a remittance advice and an eligible SHA eClaim.', 'warning');
      return;
    }
    try {
      await shaEclaimsApi.reconcileRemittance(Number(selectedRemId), facilityId, {
        allocations: [
          {
            eclaimId: Number(selectedEclaimId),
            remittedAmount: allocAmount,
            varianceReason: varianceReason.trim() || undefined,
            postToInvoice: false,
            ...(billingPaymentId ? { billingPaymentId: Number(billingPaymentId) } : {}),
          },
        ],
      });
      showToast('Remittance advice allocated. No payment or invoice was changed.', 'success');
      setAllocAmount('');
      setVarianceReason('');
      await loadSectionData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Reconciliation failed.', 'error');
    }
  };

  const handleSaveFacilityConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await shaEclaimsApi.updateConfiguration(facilityId, {
        facilityRegistryCode: facilityRegCode,
        accreditationLevel,
        contractedSchemes: contractedSchemesText
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      });
      showToast('Updated facility SHA payer configuration.', 'success');
      await loadSectionData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save configuration.', 'error');
    }
  };

  const handleSaveMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await shaEclaimsApi.upsertServiceMapping(facilityId, {
        tariffId: mapTariffId ? Number(mapTariffId) : null,
        localCode,
        localDescription,
        serviceArea,
        payerServiceCode,
        payerServiceName,
        fund,
        accessPoint,
        paymentMechanism,
        reimbursementTariff: reimbursementTariff.trim() || null,
        isPhcZeroTariff,
        requiresPreauth: mapRequiresPreauth,
      });
      showToast('Saved SHA service code mapping (JaliCare tariff preserved intact).', 'success');
      setLocalCode('');
      setLocalDescription('');
      setPayerServiceCode('');
      setPayerServiceName('');
      setReimbursementTariff('');
      await loadSectionData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save mapping.', 'error');
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await shaEclaimsApi.createBenefitRule(facilityId, {
        ruleCode,
        benefitPackage: rulePackage,
        serviceCategory: ruleCategory,
        payerServiceCode: rulePayerCode.trim() || null,
        minFacilityLevel: ruleMinLevel || null,
        requiresPreauth: ruleRequiresPreauth,
        requiresReferral: ruleRequiresReferral,
        copayType: ruleCopayType,
        copayValue: ruleCopayValue,
        sourceReference: ruleSourceRef,
        effectiveFrom: ruleEffectiveFrom,
      });
      showToast(
        `Created rule ${res.rule.ruleCode} v${res.rule.version} in DRAFT (requires approval to activate).`,
        'info',
      );
      setRuleCode('');
      setRuleSourceRef('');
      await loadSectionData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create benefit rule.', 'error');
    }
  };

  const handleReviewRule = async (ruleId: number, action: 'APPROVE' | 'RETIRE') => {
    try {
      const res = await shaEclaimsApi.reviewBenefitRule(ruleId, facilityId, action);
      showToast(`Rule ${res.rule.ruleCode} v${res.rule.version} -> ${res.rule.status}`, 'success');
      await loadSectionData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Rule status review failed.', 'error');
    }
  };

  /* SCREEN 1: CONNECTION & READINESS STATUS */
  if (section === 'connection') {
    return (
      <div className="space-y-5">
        <div className="panel p-5 bg-white space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="eyebrow text-brand-700">Gateway & FHIR IG v0.1.0 Diagnostics</span>
              <h3 className="text-base font-bold text-navy-900 flex items-center gap-2">
                <Network className="w-4 h-4 text-brand-600" />
                SHA / DHA AfyaLink Connection & Readiness Status
              </h3>
            </div>
            <button
              type="button"
              onClick={() => void loadSectionData()}
              className="btn-quiet text-xs flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Re-check Readiness
            </button>
          </div>

          {!connData ? (
            <div className="py-8 text-center text-slate-500 text-sm">
              Loading SHA gateway connection status...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Environment Mode</div>
                  <div className="font-bold text-navy-900 mt-0.5 uppercase">
                    {connData.connection.mode}{' '}
                    {connData.connection.isSimulated && (
                      <span className="text-copper-700">(SIMULATED)</span>
                    )}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Facility Registry Code</div>
                  <div className="font-bold text-navy-900 mt-0.5 font-mono">
                    {connData.facilityConfig.facilityRegistryCode ?? 'NOT CONFIGURED'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">KEPH Accreditation</div>
                  <div className="font-bold text-navy-900 mt-0.5">
                    {connData.facilityConfig.facilityLevel ?? '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Credentials Present</div>
                  <div className="font-bold text-navy-900 mt-0.5">
                    {connData.connection.hasClientId && connData.connection.hasClientSecret
                      ? 'Configured (Server-only)'
                      : 'Not Configured'}
                  </div>
                </div>
              </div>

              {connData.connection.disabledReason && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <strong>Gateway Configuration Notice:</strong>{' '}
                  {connData.connection.disabledReason}
                </div>
              )}

              {connData.connection.fhirIgDraftNotice && (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                  <strong className="text-navy-900">Kenya eClaims FHIR R4 IG Notice:</strong>{' '}
                  {connData.connection.fhirIgDraftNotice}
                </div>
              )}

              {opReportMetrics && (
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500">Eligibility Checks</div>
                    <div className="font-bold text-navy-900">
                      {opReportMetrics.eligibilityChecksTotal}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500">Deceased Blocked</div>
                    <div className="font-bold text-rose-800">
                      {opReportMetrics.deceasedBlockedCount}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500">Visit Consents</div>
                    <div className="font-bold text-navy-900">
                      {opReportMetrics.visitAuthorizationsTotal}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500">SHA eClaims</div>
                    <div className="font-bold text-navy-900">{opReportMetrics.claimsTotal}</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500">Total Claimed</div>
                    <div className="font-bold text-navy-900">
                      KES {opReportMetrics.totalClaimed}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-slate-500">Total Reconciled</div>
                    <div className="font-bold text-emerald-800">
                      KES {opReportMetrics.totalPaid}
                    </div>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="table-quiet w-full text-xs text-left">
                  <thead>
                    <tr>
                      <th>Operation</th>
                      <th>Protocol / IG Transaction</th>
                      <th>Documented Endpoint</th>
                      <th>Status</th>
                      <th>Implementation Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connData.connection.capabilities.map((cap) => (
                      <tr key={cap.operation}>
                        <td className="font-mono font-semibold text-navy-900">{cap.operation}</td>
                        <td>{cap.protocol}</td>
                        <td className="font-mono text-slate-600">{cap.documentedPath}</td>
                        <td>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                              cap.status === 'READY'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : cap.status === 'SIMULATED'
                                  ? 'bg-ember-50 text-copper-700 border-ember-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-300'
                            }`}
                          >
                            {cap.status}
                          </span>
                        </td>
                        <td className="text-slate-600 max-w-md">{cap.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  /* SCREEN 9: REMITTANCE & FINANCIAL RECONCILIATION */
  if (section === 'remittance') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 space-y-4">
          {canReconcile && (
            <form onSubmit={handleRecordRemittance} className="panel p-5 bg-white space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="eyebrow text-brand-700">
                    Kenya eClaims T-06 / HIE Remittances
                  </span>
                  <h3 className="text-base font-bold text-navy-900 flex items-center gap-2">
                    <Landmark className="w-4 h-4 text-brand-600" />
                    Record or Sync SHA Remittance Advice
                  </h3>
                </div>
                <button
                  type="button"
                  disabled
                  title="External SHA transport is unavailable"
                  onClick={() => void handleSyncHieRemittances()}
                  className="btn-quiet text-xs"
                >
                  {syncingRemittances ? 'Syncing...' : 'Sync HIE Remittances'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Payer Remittance Ref</label>
                  <input
                    type="text"
                    value={payerRemittanceRef}
                    onChange={(e) => setPayerRemittanceRef(e.target.value)}
                    placeholder="e.g. EFT-SHA-2026-089"
                    className="field-input"
                    required
                  />
                </div>
                <div>
                  <label className="field-label">Payment Date</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="field-input"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Channel</label>
                  <select
                    value={paymentChannel}
                    onChange={(e) => setPaymentChannel(e.target.value)}
                    className="field-input"
                    required
                  >
                    <option value="">— Select actual channel —</option>
                    <option value="EFT">EFT Bank Transfer</option>
                    <option value="RTGS">RTGS</option>
                    <option value="CHEQUE">Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">Total Remitted (KES)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={totalRemittedAmount}
                    onChange={(e) => setTotalRemittedAmount(e.target.value)}
                    placeholder="0.00"
                    className="field-input"
                    required
                  />
                </div>
              </div>
              <input
                type="text"
                value={remNotes}
                onChange={(e) => setRemNotes(e.target.value)}
                placeholder="Optional bank statement / advice note"
                className="field-input"
              />
              <button type="submit" className="btn-primary w-full justify-center">
                Record Remittance Advice
              </button>
            </form>
          )}

          {canReconcile && (
            <form onSubmit={handleReconcile} className="panel p-5 bg-white space-y-3">
              <div>
                <span className="eyebrow text-copper-700">Invoice & Claim Settlement</span>
                <h3 className="text-base font-bold text-navy-900">
                  Allocate Remittance to SHA eClaim
                </h3>
                <p className="text-xs text-slate-600">
                  Allocates advice only. Optionally match an existing billing receipt; this does not
                  create a payment or change an invoice.
                </p>
              </div>
              <div>
                <label className="field-label">Open Remittance Advice</label>
                <select
                  value={selectedRemId}
                  onChange={(e) => {
                    const nextId = e.target.value ? Number(e.target.value) : '';
                    setSelectedRemId(nextId);
                    setPaidClaimsBreakdown([]);
                  }}
                  className="field-input"
                  required
                >
                  <option value="">— Select Remittance —</option>
                  {remittances
                    .filter((r) => r.status !== 'RECONCILED')
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.remittanceNumber} ({r.payerRemittanceRef}) · Unallocated KES{' '}
                        {Number(r.unallocatedAmount).toLocaleString()}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="field-label">Eligible SHA eClaim</label>
                <select
                  value={selectedEclaimId}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : '';
                    setSelectedEclaimId(id);
                    const clm = eligibleClaims.find((c) => c.id === Number(id));
                    if (clm) {
                      setAllocAmount(
                        Number(clm.totalApprovedAmount) > 0
                          ? clm.totalApprovedAmount
                          : clm.totalClaimedAmount,
                      );
                    }
                  }}
                  className="field-input"
                  required
                >
                  <option value="">— Select eClaim —</option>
                  {eligibleClaims.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.claimNumber} · {c.patientName} · Claimed KES{' '}
                      {Number(c.totalClaimedAmount).toLocaleString()} ({c.status})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Remitted Amount (KES)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={allocAmount}
                    onChange={(e) => setAllocAmount(e.target.value)}
                    className="field-input"
                    required
                  />
                </div>
                <div>
                  <label className="field-label">Variance Reason (If Shortfall)</label>
                  <input
                    type="text"
                    value={varianceReason}
                    onChange={(e) => setVarianceReason(e.target.value)}
                    placeholder="e.g. Tariff cap deduction"
                    className="field-input"
                  />
                </div>
              </div>
              <label className="field-label">
                Existing billing receipt ID (required)
                <input
                  required
                  type="number"
                  min="1"
                  value={billingPaymentId}
                  onChange={(e) => setBillingPaymentId(e.target.value)}
                  className="field-input"
                />
              </label>
              <button type="submit" className="btn-accent w-full justify-center">
                Allocate Advice
              </button>
              <button
                type="button"
                disabled
                title="External SHA transport is unavailable"
                onClick={() =>
                  selectedRemId && void handleLoadRemittanceClaims(Number(selectedRemId))
                }
                className="btn-quiet text-xs"
              >
                Remote claim breakdown unavailable
              </button>
              {paidClaimsBreakdown.length > 0 && (
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
                  <div className="font-semibold text-navy-900">
                    Claims Paid by Remittance (Step 2 via bank_reference):
                  </div>
                  {paidClaimsBreakdown.map((clm) => (
                    <div
                      key={clm.payerClaimReference}
                      className="flex items-center justify-between text-slate-700 font-mono text-[11px]"
                    >
                      <span>
                        {clm.payerClaimReference}
                        {clm.matchedLocalClaimNumber ? ` → ${clm.matchedLocalClaimNumber}` : ''}
                      </span>
                      <span>KES {clm.paidAmountKes}</span>
                    </div>
                  ))}
                </div>
              )}
            </form>
          )}
        </div>

        <div className="lg:col-span-7 panel p-5 bg-white space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="eyebrow text-brand-700">Reconciliation Register</span>
              <h3 className="text-base font-bold text-navy-900">
                SHA Remittances & Variance Ledger ({remittances.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={() => void loadSectionData()}
              className="btn-quiet text-xs flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {remittances.length === 0 ? (
            <div className="py-10 text-center text-slate-500 text-sm">
              No SHA remittance advices recorded yet.
            </div>
          ) : (
            <div className="space-y-4">
              {remittances.map((rem) => (
                <div
                  key={rem.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-mono font-bold text-navy-900">
                        {rem.remittanceNumber}
                      </span>{' '}
                      <span className="text-xs text-slate-600">
                        · Ref <span className="font-mono">{rem.payerRemittanceRef}</span> ·{' '}
                        {rem.paymentDate}
                      </span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200">
                      {rem.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      Total: <strong>KES {Number(rem.totalRemittedAmount).toLocaleString()}</strong>
                    </div>
                    <div>
                      Allocated:{' '}
                      <strong className="text-emerald-700">
                        KES {Number(rem.allocatedAmount).toLocaleString()}
                      </strong>
                    </div>
                    <div>
                      Unallocated:{' '}
                      <strong className="text-copper-700">
                        KES {Number(rem.unallocatedAmount).toLocaleString()}
                      </strong>
                    </div>
                  </div>
                  {rem.entries.length > 0 && (
                    <table className="table-quiet w-full text-xs text-left bg-white rounded-lg">
                      <thead>
                        <tr>
                          <th>eClaim</th>
                          <th>Invoice</th>
                          <th>Claimed</th>
                          <th>Remitted</th>
                          <th>Variance</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rem.entries.map((en) => (
                          <tr key={en.id}>
                            <td className="font-mono">{en.claimNumber}</td>
                            <td className="font-mono">{en.invoiceNumber}</td>
                            <td>KES {Number(en.claimedAmount).toLocaleString()}</td>
                            <td className="font-semibold text-emerald-700">
                              KES {Number(en.remittedAmount).toLocaleString()}
                            </td>
                            <td className="font-mono">
                              KES {Number(en.varianceAmount).toLocaleString()}
                            </td>
                            <td>{en.reconciliationStatus}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* SCREEN 10: ADMIN PAYER SERVICE-CODE MAPPING & BENEFIT RULES */
  return (
    <div className="space-y-6">
      <div className="panel p-5 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <span className="eyebrow text-brand-700">Facility SHA Accreditation</span>
            <h3 className="text-base font-bold text-navy-900 flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-brand-600" />
              Facility Registry Code & KEPH Level Configuration
            </h3>
          </div>
        </div>
        <form
          onSubmit={handleSaveFacilityConfig}
          className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
        >
          <div>
            <label className="field-label">SHA / DHA Facility Registry Code (FID / MFL)</label>
            <input
              type="text"
              value={facilityRegCode}
              onChange={(e) => setFacilityRegCode(e.target.value)}
              placeholder="e.g. FID-47-109823-4"
              className="field-input"
              disabled={!canManageConfig}
            />
          </div>
          <div>
            <label className="field-label">KEPH Facility Accreditation Level</label>
            <select
              value={accreditationLevel}
              onChange={(e) => setAccreditationLevel(e.target.value)}
              className="field-input"
              disabled={!canManageConfig}
            >
              <option value="Level 2">Level 2 — Dispensary / Clinic</option>
              <option value="Level 3">Level 3 — Health Centre</option>
              <option value="Level 4">Level 4 — Primary Referral Hospital</option>
              <option value="Level 5">Level 5 — Secondary Referral Hospital</option>
              <option value="Level 6">Level 6 — National Referral Hospital</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="field-label">
              Contracted schemes (comma-separated; enter only those confirmed)
            </label>
            <input
              value={contractedSchemesText}
              onChange={(e) => setContractedSchemesText(e.target.value)}
              className="field-input"
              disabled={!canManageConfig}
            />
          </div>
          {canManageConfig && (
            <button type="submit" className="btn-primary justify-center">
              Save Facility SHA Config
            </button>
          )}
        </form>
      </div>

      {/* Service Code Mappings */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {canManageConfig && (
          <form onSubmit={handleSaveMapping} className="lg:col-span-5 panel p-5 bg-white space-y-3">
            <div>
              <span className="eyebrow text-brand-700">Tariff Crosswalk</span>
              <h4 className="text-sm font-bold text-navy-900">
                Map JaliCare Service Tariff → SHA Intervention Code
              </h4>
              <p className="text-xs text-slate-600">
                Maps local price-list items to SHA codes and reimbursement schedules without
                modifying JaliCare&apos;s cash/private tariff.
              </p>
            </div>
            <div>
              <label className="field-label">Link JaliCare Facility Tariff</label>
              <select
                value={mapTariffId}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : '';
                  setMapTariffId(id);
                  const t = facilityTariffs.find((row) => row.id === Number(id));
                  if (t) {
                    setLocalCode(t.code);
                    setLocalDescription(t.description);
                    setServiceArea(t.department.toUpperCase());
                  }
                }}
                className="field-input"
              >
                <option value="">— Select JaliCare Tariff —</option>
                {facilityTariffs.map((t) => (
                  <option key={t.id} value={t.id}>
                    [{t.code}] {t.description} (Cash: KES {t.fee})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="field-label">Local Code</label>
                <input
                  type="text"
                  value={localCode}
                  onChange={(e) => setLocalCode(e.target.value)}
                  className="field-input"
                  required
                />
              </div>
              <div>
                <label className="field-label">Service Area</label>
                <input
                  type="text"
                  value={serviceArea}
                  onChange={(e) => setServiceArea(e.target.value)}
                  className="field-input"
                  required
                />
              </div>
            </div>
            <div>
              <label className="field-label">Local Description</label>
              <input
                type="text"
                value={localDescription}
                onChange={(e) => setLocalDescription(e.target.value)}
                className="field-input"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="field-label">SHA Intervention Code</label>
                <input
                  type="text"
                  value={payerServiceCode}
                  onChange={(e) => setPayerServiceCode(e.target.value)}
                  placeholder="e.g. SHA-OP-001"
                  className="field-input"
                  required
                />
              </div>
              <div>
                <label className="field-label">SHA Fund</label>
                <select
                  value={fund}
                  onChange={(e) => setFund(e.target.value)}
                  className="field-input"
                  required
                >
                  <option value="">— Select the actual fund —</option>
                  <option value="SHIF">SHIF</option>
                  <option value="PHC">PHC</option>
                  <option value="ECCIF">ECCIF</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="field-label">
                Contracted access point
                <select
                  required
                  value={accessPoint}
                  onChange={(e) => setAccessPoint(e.target.value)}
                  className="field-input"
                >
                  <option value="">— Select —</option>
                  <option value="OP">Outpatient</option>
                  <option value="IP">Inpatient</option>
                  <option value="BOTH">Both</option>
                </select>
              </label>
              <label className="field-label">
                Contracted payment mechanism
                <input
                  required
                  value={paymentMechanism}
                  onChange={(e) => setPaymentMechanism(e.target.value)}
                  className="field-input"
                  placeholder="Enter as documented"
                />
              </label>
            </div>
            <div>
              <label className="field-label">Official SHA Intervention Name</label>
              <input
                type="text"
                value={payerServiceName}
                onChange={(e) => setPayerServiceName(e.target.value)}
                placeholder="e.g. Outpatient General Consultation"
                className="field-input"
                required
              />
            </div>
            <div>
              <label className="field-label">SHA Reimbursement Tariff (KES)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={reimbursementTariff}
                onChange={(e) => setReimbursementTariff(e.target.value)}
                placeholder="0.00"
                className="field-input"
              />
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-slate-700">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={mapRequiresPreauth}
                  onChange={(e) => setMapRequiresPreauth(e.target.checked)}
                />
                Requires Preauthorization
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={isPhcZeroTariff}
                  onChange={(e) => setIsPhcZeroTariff(e.target.checked)}
                />
                PHC Zero-Tariff Item
              </label>
            </div>
            <button type="submit" className="btn-accent w-full justify-center text-xs">
              <Plus className="w-3.5 h-3.5" />
              Save SHA Service Mapping
            </button>
          </form>
        )}

        <div
          className={`${canManageConfig ? 'lg:col-span-7' : 'lg:col-span-12'} panel p-5 bg-white`}
        >
          <h4 className="text-sm font-bold text-navy-900 mb-3">
            Configured SHA Service-Code Mappings ({mappings.length})
          </h4>
          <div className="overflow-x-auto">
            <table className="table-quiet w-full text-xs text-left">
              <thead>
                <tr>
                  <th>Local Code</th>
                  <th>SHA Code & Name</th>
                  <th>Fund</th>
                  <th>SHA Tariff</th>
                  <th>Preauth</th>
                </tr>
              </thead>
              <tbody>
                {mappings.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">
                      No SHA service code mappings configured yet.
                    </td>
                  </tr>
                ) : (
                  mappings.map((m) => (
                    <tr key={m.id}>
                      <td className="font-mono font-semibold text-navy-900">{m.localCode}</td>
                      <td>
                        <span className="font-mono text-brand-700">{m.payerServiceCode}</span> ·{' '}
                        {m.payerServiceName}
                      </td>
                      <td>{m.fund}</td>
                      <td>
                        {m.isPhcZeroTariff
                          ? 'KES 0.00 (PHC)'
                          : m.reimbursementTariff
                            ? `KES ${Number(m.reimbursementTariff).toLocaleString()}`
                            : '—'}
                      </td>
                      <td>{m.requiresPreauth ? 'Required' : 'No'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Benefit Rules Governance */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {canManageConfig && (
          <form onSubmit={handleCreateRule} className="lg:col-span-5 panel p-5 bg-white space-y-3">
            <div>
              <span className="eyebrow text-copper-700">Rule Governance</span>
              <h4 className="text-sm font-bold text-navy-900">Draft Versioned SHA Benefit Rule</h4>
              <p className="text-xs text-slate-600">
                New rules start in <strong>DRAFT (Unverified)</strong> and are never applied until
                explicitly approved by an authorized administrator.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="field-label">Rule Code</label>
                <input
                  type="text"
                  value={ruleCode}
                  onChange={(e) => setRuleCode(e.target.value)}
                  placeholder="e.g. SHIF-OPD-GEN"
                  className="field-input"
                  required
                />
              </div>
              <div>
                <label className="field-label">Benefit Package</label>
                <select
                  value={rulePackage}
                  onChange={(e) => setRulePackage(e.target.value)}
                  className="field-input"
                  required
                >
                  <option value="">— Select the actual fund —</option>
                  <option value="SHIF">SHIF</option>
                  <option value="PHC">PHC</option>
                  <option value="ECCIF">ECCIF</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="field-label">Service Category</label>
                <input
                  type="text"
                  value={ruleCategory}
                  onChange={(e) => setRuleCategory(e.target.value)}
                  className="field-input"
                  required
                />
              </div>
              <div>
                <label className="field-label">Specific SHA Code (Opt)</label>
                <input
                  type="text"
                  value={rulePayerCode}
                  onChange={(e) => setRulePayerCode(e.target.value)}
                  placeholder="Category-wide if blank"
                  className="field-input"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="field-label">Min Level</label>
                <select
                  value={ruleMinLevel}
                  onChange={(e) => setRuleMinLevel(e.target.value)}
                  className="field-input"
                >
                  <option value="">— Not specified —</option>
                  <option value="Level 2">Level 2</option>
                  <option value="Level 3">Level 3</option>
                  <option value="Level 4">Level 4</option>
                  <option value="Level 5">Level 5</option>
                </select>
              </div>
              <div>
                <label className="field-label">Copay Type</label>
                <select
                  value={ruleCopayType}
                  onChange={(e) => setRuleCopayType(e.target.value)}
                  className="field-input"
                  required
                >
                  <option value="">— Select actual copay rule —</option>
                  <option value="NONE">NONE</option>
                  <option value="FIXED">FIXED</option>
                  <option value="PERCENTAGE">PERCENTAGE</option>
                </select>
              </div>
              <div>
                <label className="field-label">Copay Value</label>
                <input
                  type="number"
                  step="0.01"
                  value={ruleCopayValue}
                  onChange={(e) => setRuleCopayValue(e.target.value)}
                  className="field-input"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="field-label">Official Gazette / Tariff Source Ref</label>
                <input
                  type="text"
                  value={ruleSourceRef}
                  onChange={(e) => setRuleSourceRef(e.target.value)}
                  placeholder="e.g. SHA Gazette Notice 2024"
                  className="field-input"
                  required
                />
              </div>
              <div>
                <label className="field-label">Effective From</label>
                <input
                  type="date"
                  value={ruleEffectiveFrom}
                  onChange={(e) => setRuleEffectiveFrom(e.target.value)}
                  className="field-input"
                  required
                />
              </div>
            </div>
            <div className="flex gap-4 text-xs text-slate-700">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={ruleRequiresPreauth}
                  onChange={(e) => setRuleRequiresPreauth(e.target.checked)}
                />
                Requires Preauth
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={ruleRequiresReferral}
                  onChange={(e) => setRuleRequiresReferral(e.target.checked)}
                />
                Requires Referral
              </label>
            </div>
            <button type="submit" className="btn-primary w-full justify-center text-xs">
              Save Draft Benefit Rule
            </button>
          </form>
        )}

        <div
          className={`${canManageConfig ? 'lg:col-span-7' : 'lg:col-span-12'} panel p-5 bg-white`}
        >
          <h4 className="text-sm font-bold text-navy-900 mb-3">
            Versioned SHA Benefit Rules ({rules.length})
          </h4>
          <div className="overflow-x-auto">
            <table className="table-quiet w-full text-xs text-left">
              <thead>
                <tr>
                  <th>Rule & Version</th>
                  <th>Package / Area</th>
                  <th>Source Reference</th>
                  <th>Status</th>
                  <th>Governance Action</th>
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">
                      No SHA benefit rules configured yet.
                    </td>
                  </tr>
                ) : (
                  rules.map((r) => (
                    <tr key={r.id}>
                      <td className="font-mono font-semibold text-navy-900">
                        {r.ruleCode} <span className="text-slate-500">v{r.version}</span>
                      </td>
                      <td>
                        {r.benefitPackage} · {r.serviceCategory}
                        {r.payerServiceCode ? ` (${r.payerServiceCode})` : ''}
                      </td>
                      <td>{r.sourceReference}</td>
                      <td>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                            r.status === 'APPROVED'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : r.status === 'DRAFT'
                                ? 'bg-amber-50 text-amber-900 border-amber-200'
                                : 'bg-slate-100 text-slate-600 border-slate-300'
                          }`}
                        >
                          {r.status === 'DRAFT' ? 'DRAFT (UNVERIFIED)' : r.status}
                        </span>
                      </td>
                      <td>
                        {canManageConfig && r.status === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={() => void handleReviewRule(r.id, 'APPROVE')}
                            className="inline-flex items-center gap-1 text-emerald-700 hover:underline font-semibold mr-3"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Approve
                          </button>
                        )}
                        {canManageConfig && r.status === 'APPROVED' && (
                          <button
                            type="button"
                            onClick={() => void handleReviewRule(r.id, 'RETIRE')}
                            className="inline-flex items-center gap-1 text-rose-700 hover:underline font-semibold"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Retire
                          </button>
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
    </div>
  );
};
