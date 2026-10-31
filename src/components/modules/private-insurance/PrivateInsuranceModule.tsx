import { PageHeader, FilterToolbar } from '../../ui/layout.tsx';
import { AlertBanner, ErrorState } from '../../ui/feedback.tsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

const SOURCE_LABELS = [
  'Dashboard',
  'Insurers',
  'Members',
  'Eligibility',
  'Benefits',
  'Service mappings',
  'Preauthorizations',
  'Claims',
  'Remittances',
  'Reconciliation',
  'Diagnostics',
  'Patients',
  'Encounters',
  'Invoices',
  'Tariffs',
] as const;
type SourceLabel = (typeof SOURCE_LABELS)[number];
const PRIMARY_SOURCES: Record<PrivateInsuranceScreenId, SourceLabel[]> = {
  dashboard: ['Dashboard'],
  payers: ['Insurers'],
  members: ['Members'],
  eligibility: ['Eligibility'],
  benefits: ['Benefits'],
  mappings: ['Service mappings'],
  preauthorizations: ['Preauthorizations'],
  claim_prepare: ['Claims'],
  claim_tracking: ['Claims'],
  claim_rejections: ['Claims'],
  remittances: ['Remittances', 'Reconciliation'],
  diagnostics: ['Diagnostics'],
};

export const PrivateInsuranceModule: React.FC = () => {
  const { currentFacility, currentTenant, authenticatedUser, showToast } = useHmis();
  const facilityId = currentFacility?.id;
  const tenantId = currentTenant?.id;

  const [activeScreen, setActiveScreen] = useState<PrivateInsuranceScreenId>('dashboard');
  const [selectedPayerFilter, setSelectedPayerFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState<boolean>(true);
  const [failedSources, setFailedSources] = useState<SourceLabel[]>([]);
  const requestGeneration = useRef(0);

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
    const generation = ++requestGeneration.current;
    if (!facilityId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const payerQuery = selectedPayerFilter !== 'ALL' ? selectedPayerFilter : undefined;
    const results = await Promise.allSettled([
      privateInsuranceApi.getDashboard(facilityId),
      privateInsuranceApi.listPayers(),
      privateInsuranceApi.listMembers({ payerCode: payerQuery }),
      privateInsuranceApi.listEligibility(payerQuery),
      privateInsuranceApi.listBenefits(payerQuery),
      privateInsuranceApi.listMappings(payerQuery),
      privateInsuranceApi.listPreauthorizations(payerQuery),
      privateInsuranceApi.listClaims({ payerCode: payerQuery }),
      privateInsuranceApi.listRemittances(payerQuery),
      privateInsuranceApi.getReconciliation(payerQuery),
      privateInsuranceApi.getDiagnostics(payerQuery),
      api.getPatients(tenantId, facilityId),
      api.getEncounters(undefined, facilityId),
      api.getInvoices(facilityId),
      api.getServiceTariffs(facilityId),
    ] as const);
    if (generation !== requestGeneration.current) return;
    const [
      dash,
      payer,
      member,
      eligibility,
      benefit,
      mapping,
      preauth,
      claim,
      remit,
      recon,
      diag,
      patient,
      encounter,
      invoice,
      tariff,
    ] = results;
    setFailedSources(SOURCE_LABELS.filter((_, index) => results[index].status === 'rejected'));
    setDashboard(dash.status === 'fulfilled' ? dash.value : null);
    setPayers(payer.status === 'fulfilled' ? payer.value.payers : []);
    setMembers(member.status === 'fulfilled' ? member.value.members : []);
    setVerifications(eligibility.status === 'fulfilled' ? eligibility.value.verifications : []);
    setRules(benefit.status === 'fulfilled' ? benefit.value.rules : []);
    setValidations(benefit.status === 'fulfilled' ? benefit.value.validations : []);
    setMappings(mapping.status === 'fulfilled' ? mapping.value.mappings : []);
    setPreauthorizations(preauth.status === 'fulfilled' ? preauth.value.preauthorizations : []);
    setClaims(claim.status === 'fulfilled' ? claim.value.claims : []);
    setRemittances(remit.status === 'fulfilled' ? remit.value.remittances : []);
    setReconciliation(recon.status === 'fulfilled' ? recon.value : null);
    setDiagnostics(diag.status === 'fulfilled' ? diag.value : null);
    setPatients(patient.status === 'fulfilled' ? patient.value : []);
    setEncounters(encounter.status === 'fulfilled' ? encounter.value : []);
    setInvoices(invoice.status === 'fulfilled' ? invoice.value : []);
    setTariffs(tariff.status === 'fulfilled' ? tariff.value : []);
    setLoading(false);
  }, [facilityId, tenantId, selectedPayerFilter]);

  useEffect(() => {
    void loadAll();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadAll]);

  const activeSourceUnavailable =
    !currentFacility?.id ||
    PRIMARY_SOURCES[activeScreen].some((source) => failedSources.includes(source));

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <PageHeader>
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-6 h-6 text-brand-600" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="ui-page-title">Private Insurance &amp; Multi-Payer Claims Engine</h1>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-ember-50 text-ember-800 border border-ember-200">
                Britam &amp; PACIS Priority
              </span>
            </div>
            <p className="ui-page-description">
              Facility: <strong>{currentFacility?.name ?? 'Unselected'}</strong> · Independent
              insurer configurations, SmartLink-informed workflow stages, auditable manual &amp;
              adapter operations, and transactional invoice settlement.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="private-insurer-scope" className="text-xs font-semibold text-slate-600">
            Insurer Scope:
          </label>
          <select
            id="private-insurer-scope"
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
      </PageHeader>

      {/* 12-Screen Navigation Tabs */}
      <FilterToolbar>
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
      </FilterToolbar>

      {!loading && failedSources.length > 0 && (
        <AlertBanner tone="warning">
          These data sources could not be loaded: {failedSources.join(', ')}. Failed sources are not
          empty records; some choices may be incomplete. Refresh to retry.
        </AlertBanner>
      )}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 flex items-center justify-center gap-2 text-slate-600 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-brand-600" />
          Loading Private Insurance multi-payer workspace...
        </div>
      ) : activeSourceUnavailable ? (
        <ErrorState
          message={
            currentFacility?.id
              ? `This view is unavailable because its data could not be loaded: ${PRIMARY_SOURCES[activeScreen].filter((source) => failedSources.includes(source)).join(', ')}.`
              : 'Select an authorized facility to load private insurance.'
          }
          onRetry={() => void loadAll()}
        />
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
              canPrepareClaims={
                can('insurance.private.claims.prepare') &&
                can('clinical.read') &&
                can('billing.read')
              }
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
