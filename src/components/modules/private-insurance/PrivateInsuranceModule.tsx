import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Building2,
  ClipboardList,
  FileCheck2,
  FileSpreadsheet,
  Landmark,
  Layers,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  UserCheck,
  Users,
  Wrench,
} from 'lucide-react';
import { useHmis } from '../../../context/HmisContext.tsx';
import { api } from '../../../api/client.ts';
import type { BillingInvoice, Encounter, Patient, ServiceTariff } from '../../../types/index.ts';
import {
  privateInsuranceApi,
  type PrivateBenefitRule,
  type PrivateBenefitValidationResult,
  type PrivateClaimSummary,
  type PrivateEligibilityRecord,
  type PrivateInsuranceDashboardResponse,
  type PrivateMemberPolicy,
  type PrivatePayerConfig,
  type PrivatePreauthRecord,
  type PrivateServiceMapping,
} from '../../../api/private-insurance.client.ts';
import { PayerConfigurationSection } from './PayerConfigurationSection.tsx';
import { MembershipAndEligibilitySection } from './MembershipAndEligibilitySection.tsx';
import { BenefitsMappingsPreauthSection } from './BenefitsMappingsPreauthSection.tsx';
import { ClaimsAndReconciliationSection } from './ClaimsAndReconciliationSection.tsx';

export type PrivateInsuranceScreenId =
  | 'dashboard'
  | 'payers'
  | 'members'
  | 'eligibility'
  | 'benefits'
  | 'mappings'
  | 'preauthorizations'
  | 'claim_prepare'
  | 'claim_tracking'
  | 'claim_rejections'
  | 'remittances'
  | 'diagnostics';

const SCREENS: Array<{
  id: PrivateInsuranceScreenId;
  label: string;
  icon: React.ElementType;
}> = [
  { id: 'dashboard', label: '1. Dashboard', icon: LayoutDashboard },
  { id: 'payers', label: '2. Insurers', icon: Building2 },
  { id: 'members', label: '3. Members & Policies', icon: Users },
  { id: 'eligibility', label: '4. Eligibility', icon: UserCheck },
  { id: 'benefits', label: '5. Benefits & Limits', icon: ClipboardList },
  { id: 'mappings', label: '6. Service Mapping', icon: Layers },
  { id: 'preauthorizations', label: '7. Preauthorization', icon: FileCheck2 },
  { id: 'claim_prepare', label: '8. Claim Preparation', icon: FileSpreadsheet },
  { id: 'claim_tracking', label: '9. Submissions & Status', icon: Send },
  { id: 'claim_rejections', label: '10. Rejections & Fixes', icon: Wrench },
  { id: 'remittances', label: '11. Remittances', icon: Landmark },
  { id: 'diagnostics', label: '12. Diagnostics & Audit', icon: Activity },
];

export const PrivateInsuranceModule: React.FC = () => {
  const { currentFacility, currentTenant, authenticatedUser, showToast } = useHmis();

  const [activeScreen, setActiveScreen] = useState<PrivateInsuranceScreenId>('dashboard');
  const [selectedPayerFilter, setSelectedPayerFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState<boolean>(true);

  const [dashboard, setDashboard] = useState<PrivateInsuranceDashboardResponse | null>(null);
  const [payers, setPayers] = useState<PrivatePayerConfig[]>([]);
  const [members, setMembers] = useState<PrivateMemberPolicy[]>([]);
  const [verifications, setVerifications] = useState<PrivateEligibilityRecord[]>([]);
  const [rules, setRules] = useState<PrivateBenefitRule[]>([]);
  const [validations, setValidations] = useState<PrivateBenefitValidationResult[]>([]);
  const [mappings, setMappings] = useState<PrivateServiceMapping[]>([]);
  const [preauthorizations, setPreauthorizations] = useState<PrivatePreauthRecord[]>([]);
  const [claims, setClaims] = useState<PrivateClaimSummary[]>([]);
  const [remittances, setRemittances] = useState<Array<Record<string, unknown>>>([]);
  const [reconciliation, setReconciliation] = useState<{
    summary: {
      entriesCount: number;
      totalClaimedAmount: string;
      totalRemittedAmount: string;
      totalVarianceAmount: string;
    };
    entries: Array<Record<string, unknown>>;
  } | null>(null);
  const [diagnostics, setDiagnostics] = useState<{
    diagnostics: Array<Record<string, unknown>>;
    auditEvents: Array<Record<string, unknown>>;
  } | null>(null);

  const [patients, setPatients] = useState<Patient[]>([]);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [tariffs, setTariffs] = useState<ServiceTariff[]>([]);

  const permissionSet = new Set(authenticatedUser?.permissions ?? []);
  const isSuper = Boolean(
    authenticatedUser?.isSuperAdmin || authenticatedUser?.roles?.includes('SUPER_ADMIN'),
  );
  const can = (perm: string) => isSuper || permissionSet.has(perm);

  const loadAll = useCallback(async () => {
    if (!currentFacility?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const payerQuery = selectedPayerFilter !== 'ALL' ? selectedPayerFilter : undefined;

    try {
      const [
        dashRes,
        payersRes,
        membersRes,
        eligRes,
        benRes,
        mapRes,
        preauthRes,
        claimsRes,
        remitRes,
        reconRes,
        diagRes,
        patList,
        encList,
        invList,
        tariffList,
      ] = await Promise.all([
        privateInsuranceApi.getDashboard(currentFacility.id).catch(() => null),
        privateInsuranceApi.listPayers().catch(() => ({ payers: [] })),
        privateInsuranceApi.listMembers({ payerCode: payerQuery }).catch(() => ({ members: [] })),
        privateInsuranceApi.listEligibility(payerQuery).catch(() => ({ verifications: [] })),
        privateInsuranceApi.listBenefits(payerQuery).catch(() => ({ rules: [], validations: [] })),
        privateInsuranceApi.listMappings(payerQuery).catch(() => ({ mappings: [] })),
        privateInsuranceApi
          .listPreauthorizations(payerQuery)
          .catch(() => ({ preauthorizations: [] })),
        privateInsuranceApi.listClaims({ payerCode: payerQuery }).catch(() => ({ claims: [] })),
        privateInsuranceApi.listRemittances(payerQuery).catch(() => ({ remittances: [] })),
        privateInsuranceApi.getReconciliation(payerQuery).catch(() => null),
        privateInsuranceApi.getDiagnostics(payerQuery).catch(() => null),
        api.getPatients(currentTenant?.id, currentFacility.id).catch(() => [] as Patient[]),
        api.getEncounters(undefined, currentFacility.id).catch(() => [] as Encounter[]),
        api.getInvoices(currentFacility.id).catch(() => [] as BillingInvoice[]),
        api.getServiceTariffs(currentFacility.id).catch(() => [] as ServiceTariff[]),
      ]);

      setDashboard(dashRes);
      setPayers(payersRes.payers);
      setMembers(membersRes.members);
      setVerifications(eligRes.verifications);
      setRules(benRes.rules);
      setValidations(benRes.validations);
      setMappings(mapRes.mappings);
      setPreauthorizations(preauthRes.preauthorizations);
      setClaims(claimsRes.claims);
      setRemittances(remitRes.remittances);
      setReconciliation(reconRes);
      setDiagnostics(diagRes);
      setPatients(patList);
      setEncounters(encList);
      setInvoices(invList);
      setTariffs(tariffList);
    } finally {
      setLoading(false);
    }
  }, [currentFacility?.id, currentTenant?.id, selectedPayerFilter]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6 text-brand-600" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-slate-900">
                  Private Insurance &amp; Multi-Payer Claims Engine
                </h1>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-ember-50 text-ember-800 border border-ember-200">
                  Britam &amp; PACIS Priority
                </span>
              </div>
              <p className="text-sm text-slate-600 mt-0.5">
                Facility: <strong>{currentFacility?.name ?? 'Unselected'}</strong> · Independent
                insurer configurations, SmartLink-informed workflow stages, auditable manual &amp;
                adapter operations, and transactional invoice settlement.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-semibold text-slate-600">Insurer Scope:</label>
            <select
              value={selectedPayerFilter}
              onChange={(e) => setSelectedPayerFilter(e.target.value)}
              className="rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-1.5 text-xs font-bold text-brand-800"
            >
              <option value="ALL">All Private Insurers</option>
              {payers.map((py) => (
                <option key={py.payerCode} value={py.payerCode}>
                  {py.payerName} ({py.payerCode})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void loadAll()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* 12-Screen Navigation Tabs */}
        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-1.5">
          {SCREENS.map((scr) => {
            const Icon = scr.icon;
            const active = activeScreen === scr.id;
            return (
              <button
                key={scr.id}
                type="button"
                onClick={() => setActiveScreen(scr.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-slate-50 text-slate-700 hover:bg-brand-50 hover:text-brand-800 border border-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {scr.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading && payers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 flex items-center justify-center gap-2 text-slate-600 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-brand-600" />
          Loading Private Insurance multi-payer workspace...
        </div>
      ) : (
        <>
          {(activeScreen === 'dashboard' || activeScreen === 'payers') && (
            <PayerConfigurationSection
              activeScreen={activeScreen}
              dashboard={dashboard}
              payers={payers}
              canManagePayers={can('insurance.payers.manage')}
              onNavigateScreen={(s) => setActiveScreen(s as PrivateInsuranceScreenId)}
              onRefresh={loadAll}
              showToast={showToast}
            />
          )}

          {(activeScreen === 'members' || activeScreen === 'eligibility') && (
            <MembershipAndEligibilitySection
              activeScreen={activeScreen}
              selectedPayerFilter={selectedPayerFilter}
              payers={payers}
              patients={patients}
              encounters={encounters}
              members={members}
              verifications={verifications}
              canManageMembers={can('insurance.members.manage')}
              canCheckEligibility={can('insurance.eligibility.check')}
              onRefresh={loadAll}
              showToast={showToast}
            />
          )}

          {(activeScreen === 'benefits' ||
            activeScreen === 'mappings' ||
            activeScreen === 'preauthorizations') && (
            <BenefitsMappingsPreauthSection
              activeScreen={activeScreen}
              selectedPayerFilter={selectedPayerFilter}
              payers={payers}
              patients={patients}
              encounters={encounters}
              invoices={invoices}
              tariffs={tariffs}
              members={members}
              rules={rules}
              validations={validations}
              mappings={mappings}
              preauthorizations={preauthorizations}
              canManageMappings={can('insurance.mappings.manage')}
              canValidateBenefits={can('insurance.benefits.validate')}
              canManagePreauth={can('insurance.preauthorization.manage')}
              onRefresh={loadAll}
              showToast={showToast}
            />
          )}

          {(activeScreen === 'claim_prepare' ||
            activeScreen === 'claim_tracking' ||
            activeScreen === 'claim_rejections' ||
            activeScreen === 'remittances' ||
            activeScreen === 'diagnostics') && (
            <ClaimsAndReconciliationSection
              activeScreen={activeScreen}
              selectedPayerFilter={selectedPayerFilter}
              payers={payers}
              invoices={invoices}
              encounters={encounters}
              members={members}
              preauthorizations={preauthorizations}
              claims={claims}
              remittances={remittances}
              reconciliation={reconciliation}
              diagnostics={diagnostics}
              canPrepareClaims={can('insurance.private.claims.prepare')}
              canSubmitClaims={can('insurance.private.claims.submit')}
              canReconcileRemittances={can('insurance.private.remittance.reconcile')}
              onRefresh={loadAll}
              showToast={showToast}
            />
          )}
        </>
      )}
    </div>
  );
};
