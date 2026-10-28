import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileSearch,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import type { Encounter, Patient, ServiceTariff } from '../../../types/index.ts';
import {
  shaEclaimsApi,
  type ShaBenefitValidationRecord,
  type ShaEligibilityRecord,
} from '../../../api/sha-eclaims.client.ts';

interface Props {
  facilityId: number | null;
  patients: Patient[];
  encounters: Encounter[];
  tariffs: ServiceTariff[];
  canCheckEligibility: boolean;
  canValidateBenefits: boolean;
  showToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

function outcomeBadgeClass(outcome: string): string {
  switch (outcome) {
    case 'Eligible':
    case 'COVERED':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'Ineligible':
    case 'NOT_COVERED':
      return 'bg-rose-50 text-rose-800 border-rose-200';
    case 'Pending':
    case 'AUTHORIZATION_REQUIRED':
    case 'INCOMPLETE_INFORMATION':
      return 'bg-amber-50 text-amber-900 border-amber-200';
    case 'Manual review required':
      return 'bg-ember-50 text-copper-700 border-ember-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-300';
  }
}

function formatMoneyOrDash(val: string | null | undefined): string {
  if (val === null || val === undefined || val === '') return '—';
  const parsed = Number(val);
  if (!Number.isFinite(parsed)) return '—';
  return `KES ${parsed.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const EligibilityAndBenefitsWorkspace: React.FC<Props> = ({
  facilityId,
  patients,
  encounters,
  tariffs,
  canCheckEligibility,
  canValidateBenefits,
  showToast,
}) => {
  const [subView, setSubView] = useState<'eligibility' | 'history' | 'benefits'>('eligibility');
  const [patientQuery, setPatientQuery] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<number | ''>('');
  const [selectedEncounterId, setSelectedEncounterId] = useState<number | ''>('');

  // Eligibility form state
  const [identificationType, setIdentificationType] = useState('CLIENT_REGISTRY_ID');
  const [identificationValue, setIdentificationValue] = useState('');
  const [intendedServiceArea, setIntendedServiceArea] = useState('OPD');
  const [checkingElig, setCheckingElig] = useState(false);
  const [resolvingCr, setResolvingCr] = useState(false);
  const [crSearchResult, setCrSearchResult] = useState<{
    found: boolean;
    crId: string | null;
    fullName: string | null;
    isAlive: boolean | null;
    isSimulated: boolean;
  } | null>(null);
  const [latestResult, setLatestResult] = useState<ShaEligibilityRecord | null>(null);
  const [hieLookupCode, setHieLookupCode] = useState('');
  const [loadingHieLookup, setLoadingHieLookup] = useState(false);
  const [hieLookupData, setHieLookupData] = useState<{
    isSimulated: boolean;
    interventions: Array<{
      code: string;
      name: string;
      fund: string;
      overallTariff: string | null;
      needsPreauth: boolean;
      needsManualPreauthApproval: boolean;
      needsDoctorAuthorization: boolean;
    }>;
    utilization: Array<{
      code: string;
      limitScope: string;
      individualRemainingLimitKes: string | null;
      householdRemainingLimitKes: string | null;
      nextAvailability: string | null;
    }>;
    pomsfBalances: Array<{
      schemeCode: string;
      policyYear: string;
      remainingBalanceKes: string;
    }>;
  } | null>(null);

  // History state
  const [recentChecks, setRecentChecks] = useState<ShaEligibilityRecord[]>([]);
  const [patientHistory, setPatientHistory] = useState<ShaEligibilityRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Benefits validation state
  const [selectedTariffId, setSelectedTariffId] = useState<number | ''>('');
  const [benefitPackage, setBenefitPackage] = useState('SHIF');
  const [serviceCategory, setServiceCategory] = useState('OPD');
  const [serviceDescription, setServiceDescription] = useState('');
  const [serviceDate, setServiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState(1);
  const [preauthReference, setPreauthReference] = useState('');
  const [hasReferral, setHasReferral] = useState(false);
  const [hasClinicalNotes, setHasClinicalNotes] = useState(false);
  const [validatingBenefit, setValidatingBenefit] = useState(false);
  const [benefitResult, setBenefitResult] = useState<ShaBenefitValidationRecord | null>(null);
  const [benefitDisclaimer, setBenefitDisclaimer] = useState<string | null>(null);
  const [patientBenefitsList, setPatientBenefitsList] = useState<ShaBenefitValidationRecord[]>([]);

  const filteredPatients = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    if (!q) return patients.slice(0, 50);
    return patients
      .filter((p) =>
        `${p.firstName ?? ''} ${p.lastName ?? ''} ${p.mrn ?? ''} ${p.nationalId ?? ''} ${p.shaNumber ?? ''}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 50);
  }, [patients, patientQuery]);

  const patientEncounters = useMemo(() => {
    if (!selectedPatientId) return [];
    return encounters.filter((e) => Number(e.patientId) === Number(selectedPatientId));
  }, [encounters, selectedPatientId]);

  const loadRecentEligibility = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await shaEclaimsApi.listRecentEligibility(facilityId);
      setRecentChecks(res.verifications);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Unable to load eligibility records.');
    } finally {
      setLoadingHistory(false);
    }
  }, [facilityId]);

  const loadPatientSpecificHistory = useCallback(
    async (pid: number) => {
      try {
        const [eligRes, benRes] = await Promise.all([
          shaEclaimsApi.getPatientEligibilityHistory(pid, facilityId),
          shaEclaimsApi.getPatientBenefits(pid, facilityId),
        ]);
        setPatientHistory(eligRes.history);
        setPatientBenefitsList(benRes.recentValidations);
      } catch {
        // Non-blocking secondary load
      }
    },
    [facilityId],
  );

  useEffect(() => {
    void loadRecentEligibility();
  }, [loadRecentEligibility]);

  useEffect(() => {
    if (selectedPatientId !== '') {
      void loadPatientSpecificHistory(Number(selectedPatientId));
    } else {
      setPatientHistory([]);
      setPatientBenefitsList([]);
    }
  }, [selectedPatientId, loadPatientSpecificHistory]);

  const handleResolveClientRegistry = async () => {
    if (!selectedPatientId) {
      showToast('Select an existing JaliCare patient first.', 'warning');
      return;
    }
    setResolvingCr(true);
    try {
      const res = await shaEclaimsApi.searchClientRegistryPatient(facilityId, {
        patientId: Number(selectedPatientId),
        identificationType,
        identificationValue: identificationValue.trim() || undefined,
      });
      setCrSearchResult({
        found: res.registry.found,
        crId: res.registry.crId,
        fullName: res.registry.fullName,
        isAlive: res.registry.isAlive,
        isSimulated: res.registry.isSimulated,
      });
      showToast(
        res.registry.found
          ? `Client Registry CR ID resolved: ${res.registry.crId}`
          : (res.registry.errorMessage ?? 'Patient not found in DHA Client Registry.'),
        res.registry.found ? 'info' : 'warning',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Client Registry search failed.', 'error');
    } finally {
      setResolvingCr(false);
    }
  };

  const handleLookupHieUtilization = async () => {
    if (!selectedPatientId) {
      showToast('Select an existing JaliCare patient first.', 'warning');
      return;
    }
    setLoadingHieLookup(true);
    try {
      const res = await shaEclaimsApi.lookupHieBenefitsAndUtilization(facilityId, {
        patientId: Number(selectedPatientId),
        interventionCode: hieLookupCode.trim() || undefined,
        includePomsfBalances: true,
        includeBedOccupancy: true,
      });
      setHieLookupData({
        isSimulated: Boolean(res.coverage?.isSimulated || res.utilization?.isSimulated),
        interventions: res.coverage?.interventions ?? [],
        utilization: res.utilization?.utilization ?? [],
        pomsfBalances: res.utilization?.pomsfBalances ?? [],
      });
      showToast('Queried DHA HIE intervention matrix & utilization balances.', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'HIE benefits lookup failed.', 'error');
    } finally {
      setLoadingHieLookup(false);
    }
  };

  const handleRunEligibilityCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId) {
      showToast('Select an existing JaliCare patient first.', 'warning');
      return;
    }
    setCheckingElig(true);
    try {
      const res = await shaEclaimsApi.checkEligibility(facilityId, {
        patientId: Number(selectedPatientId),
        encounterId: selectedEncounterId ? Number(selectedEncounterId) : null,
        identificationType,
        identificationValue: identificationValue.trim() || undefined,
        intendedServiceArea,
      });
      setLatestResult(res.verification);
      showToast(`SHA Eligibility check completed: ${res.verification.outcome}`, 'info');
      await Promise.all([
        loadRecentEligibility(),
        loadPatientSpecificHistory(Number(selectedPatientId)),
      ]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Eligibility verification failed.', 'error');
    } finally {
      setCheckingElig(false);
    }
  };

  const handleRecheckFromHistory = async (row: ShaEligibilityRecord) => {
    setCheckingElig(true);
    try {
      const res = await shaEclaimsApi.checkEligibility(facilityId, {
        patientId: row.patientId,
        encounterId: row.encounterId,
        identificationType: row.identificationType,
        intendedServiceArea: row.intendedServiceArea,
      });
      setLatestResult(res.verification);
      setSelectedPatientId(row.patientId);
      setSubView('eligibility');
      showToast(`Rechecked SHA eligibility: ${res.verification.outcome}`, 'info');
      await loadRecentEligibility();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Recheck failed.', 'error');
    } finally {
      setCheckingElig(false);
    }
  };

  const handleValidateBenefit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId) {
      showToast('Select an existing JaliCare patient first.', 'warning');
      return;
    }
    setValidatingBenefit(true);
    try {
      const res = await shaEclaimsApi.validateBenefits(facilityId, {
        patientId: Number(selectedPatientId),
        encounterId: selectedEncounterId ? Number(selectedEncounterId) : null,
        tariffId: selectedTariffId ? Number(selectedTariffId) : null,
        benefitPackage,
        serviceCategory,
        serviceDescription: serviceDescription.trim() || undefined,
        serviceDate,
        quantity,
        preauthReference: preauthReference.trim() || undefined,
        hasReferral,
        hasClinicalNotes,
      });
      setBenefitResult(res.validation);
      setBenefitDisclaimer(res.advisoryDisclaimer);
      showToast(`Benefit decision: ${res.validation.decision}`, 'info');
      await loadPatientSpecificHistory(Number(selectedPatientId));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Benefits validation failed.', 'error');
    } finally {
      setValidatingBenefit(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation between Screen 2 (Eligibility Check), Screen 3 (Eligibility History), Screen 4 (Benefits Validation) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setSubView('eligibility')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 ${
            subView === 'eligibility'
              ? 'bg-brand-600 text-white shadow-xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          1. Patient Eligibility Check
        </button>
        <button
          type="button"
          onClick={() => setSubView('history')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 ${
            subView === 'history'
              ? 'bg-brand-600 text-white shadow-xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          2. Eligibility History ({recentChecks.length})
        </button>
        <button
          type="button"
          onClick={() => setSubView('benefits')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 ${
            subView === 'benefits'
              ? 'bg-brand-600 text-white shadow-xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <FileSearch className="w-3.5 h-3.5" />
          3. Benefits & Service Coverage
        </button>
      </div>

      {/* Shared JaliCare Patient & Encounter Context Bar (prevents duplicate registration) */}
      <div className="panel p-4 bg-white">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="field-label">Search Existing JaliCare Patient</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
                placeholder="Filter by name, MRN, National ID, or SHA #..."
                className="field-input pl-9"
              />
            </div>
          </div>
          <div>
            <label className="field-label">Selected Patient (No Duplicate Registration)</label>
            <select
              value={selectedPatientId}
              onChange={(e) => {
                setSelectedPatientId(e.target.value ? Number(e.target.value) : '');
                setSelectedEncounterId('');
              }}
              className="field-input"
            >
              <option value="">— Select registered JaliCare patient —</option>
              {filteredPatients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName} ({p.mrn})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Active Encounter / Visit Context (Optional)</label>
            <select
              value={selectedEncounterId}
              onChange={(e) => setSelectedEncounterId(e.target.value ? Number(e.target.value) : '')}
              className="field-input"
              disabled={!selectedPatientId}
            >
              <option value="">— Standalone / Pre-visit Verification —</option>
              {patientEncounters.map((enc) => (
                <option key={enc.id} value={enc.id}>
                  Encounter #{enc.id} · {enc.encounterType ?? 'OPD'} ({enc.status})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* SCREEN 2: PATIENT ELIGIBILITY CHECK */}
      {subView === 'eligibility' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <form
            onSubmit={handleRunEligibilityCheck}
            className="lg:col-span-5 panel p-5 bg-white space-y-4"
          >
            <div>
              <span className="eyebrow text-brand-700">SHA Member Verification</span>
              <h3 className="text-base font-bold text-navy-900 mt-0.5">
                Verify SHA Beneficiary Status
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                External SHA and Client Registry verification are unavailable until approved
                transport is verified. Existing verification history remains available.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Identifier Type</label>
                <select
                  value={identificationType}
                  onChange={(e) => setIdentificationType(e.target.value)}
                  className="field-input"
                >
                  <option value="CLIENT_REGISTRY_ID">Client Registry ID (CR ID — Preferred)</option>
                  <option value="SHA_NUMBER">SHA Member Number</option>
                  <option value="NATIONAL_ID">Kenya National ID</option>
                  <option value="BIRTH_NOTIFICATION">Birth Notification (Infant)</option>
                  <option value="BIRTH_CERTIFICATE">Birth Certificate (Dependant)</option>
                  <option value="ALIEN_ID">Alien ID</option>
                  <option value="REFUGEE_ID">Refugee ID</option>
                  <option value="MANDATE_NUMBER">Mandate Number</option>
                  <option value="PASSPORT">Passport</option>
                </select>
              </div>
              <div>
                <label className="field-label">Intended Service Area</label>
                <select
                  value={intendedServiceArea}
                  onChange={(e) => setIntendedServiceArea(e.target.value)}
                  className="field-input"
                >
                  <option value="OPD">Outpatient (OPD / PHC)</option>
                  <option value="IPD">Inpatient Admission (SHIF)</option>
                  <option value="MATERNITY">Maternity & Delivery</option>
                  <option value="LABORATORY">Diagnostics / Laboratory</option>
                  <option value="RADIOLOGY">Radiology & Imaging</option>
                  <option value="PHARMACY">Pharmacy Dispensation</option>
                  <option value="SURGICAL">Surgical / Theatre</option>
                </select>
              </div>
            </div>

            <div>
              <label className="field-label">
                Identifier Override (Optional — uses patient record on file if blank)
              </label>
              <input
                type="text"
                value={identificationValue}
                onChange={(e) => setIdentificationValue(e.target.value)}
                placeholder="Leave blank to use unsealed identifier on patient profile"
                className="field-input"
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => void handleResolveClientRegistry()}
                disabled
                className="btn-quiet justify-center flex-1 disabled:opacity-50"
              >
                <Search className="w-3.5 h-3.5" />
                {resolvingCr ? 'Searching CR...' : 'Resolve CR ID'}
              </button>
              <button
                type="submit"
                disabled
                className="btn-accent justify-center flex-1 disabled:opacity-50"
              >
                {checkingElig ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    Verify SHA Eligibility
                  </>
                )}
              </button>
            </div>
            {crSearchResult && (
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                <div className="font-semibold text-navy-900">
                  Client Registry Lookup {crSearchResult.isSimulated ? '(Simulated)' : '(Live HIE)'}
                </div>
                <div>
                  CR ID: <span className="font-mono">{crSearchResult.crId ?? 'Not Found'}</span>
                  {crSearchResult.isAlive === false && (
                    <span className="ml-2 font-bold text-rose-700">· DECEASED (isAlive=false)</span>
                  )}
                </div>
              </div>
            )}
          </form>

          <div className="lg:col-span-7 panel p-5 bg-white">
            <span className="eyebrow text-slate-500">Verification Result</span>
            {!latestResult ? (
              <div className="py-10 text-center text-slate-500 text-sm">
                Select a patient and run <strong>Verify SHA Eligibility</strong> to inspect live or
                sandbox-simulated membership status, scheme packages, and coverage dates.
              </div>
            ) : (
              <div className="mt-3 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold border ${outcomeBadgeClass(
                        latestResult.outcome,
                      )}`}
                    >
                      {latestResult.outcome}
                    </span>
                    {latestResult.isSimulated ? (
                      <span className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-ember-50 text-copper-700 border border-ember-200">
                        SANDBOX SIMULATION (NOT LIVE SHA)
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-brand-50 text-brand-700 border border-brand-200">
                        {latestResult.source}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500 font-mono">
                    Ref: {latestResult.payerReference ?? '—'}
                  </span>
                </div>

                {latestResult.isAlive === false && (
                  <div className="p-3 rounded-lg bg-rose-50 border border-rose-300 text-xs text-rose-900 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 shrink-0 text-rose-700" />
                    <div>
                      <strong>DECEASED BENEFICIARY BLOCK (isAlive=false):</strong> DHA Client
                      Registry reports this beneficiary as deceased. Admission, consent
                      authorization, and SHA claim billing are strictly blocked.
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 text-[11px]">
                  {latestResult.facilityBiometricsEnforced && (
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-navy-800 border border-slate-300 font-semibold">
                      Biometrics Enforced at Facility
                    </span>
                  )}
                  {latestResult.whitelistedForOtp && (
                    <span className="px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200 font-semibold">
                      OTP Consent Whitelisted
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="text-slate-500">Identifier Checked</div>
                    <div className="font-semibold text-navy-900 mt-0.5 font-mono">
                      {latestResult.identificationType}: {latestResult.identificationHint}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="text-slate-500">Client Registry ID</div>
                    <div className="font-semibold text-navy-900 mt-0.5 font-mono">
                      {latestResult.memberCrNumber ?? '—'}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="text-slate-500">Active Schemes</div>
                    <div className="font-semibold text-navy-900 mt-0.5">
                      {latestResult.schemes.length > 0 ? latestResult.schemes.join(', ') : '—'}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="text-slate-500">Coverage Window</div>
                    <div className="font-semibold text-navy-900 mt-0.5">
                      {latestResult.coverageStartDate || latestResult.coverageEndDate
                        ? `${latestResult.coverageStartDate ?? '—'} → ${latestResult.coverageEndDate ?? '—'}`
                        : '—'}
                    </div>
                  </div>
                </div>

                {latestResult.reason && (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                    <strong className="text-navy-900">Payer Detail:</strong> {latestResult.reason}
                    {latestResult.possibleSolution && (
                      <div className="mt-1 text-brand-700 font-medium">
                        Recommended Action: {latestResult.possibleSolution}
                      </div>
                    )}
                  </div>
                )}

                {latestResult.restrictions.length > 0 && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                    <strong>Restrictions / Flags:</strong> {latestResult.restrictions.join(' · ')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SCREEN 3: ELIGIBILITY HISTORY */}
      {subView === 'history' && (
        <div className="panel p-5 bg-white space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="eyebrow text-brand-700">Verification Audit Trail</span>
              <h3 className="text-base font-bold text-navy-900">
                {selectedPatientId
                  ? `Selected Patient Eligibility History (${patientHistory.length})`
                  : `Recent Facility SHA Eligibility Checks (${recentChecks.length})`}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => void loadRecentEligibility()}
              className="btn-quiet text-xs flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {historyError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{historyError}</span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="table-quiet w-full text-left text-xs">
              <thead>
                <tr>
                  <th>Checked At</th>
                  <th>Patient</th>
                  <th>Identifier</th>
                  <th>Service Area</th>
                  <th>Outcome</th>
                  <th>Source</th>
                  <th>Payer Ref</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(selectedPatientId ? patientHistory : recentChecks).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      No SHA eligibility verifications recorded yet for this selection.
                    </td>
                  </tr>
                ) : (
                  (selectedPatientId ? patientHistory : recentChecks).map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap text-slate-600">
                        {new Date(row.checkedAt).toLocaleString()}
                      </td>
                      <td className="font-medium text-navy-900">
                        {row.patientName
                          ? `${row.patientName} (${row.patientMrn})`
                          : `Patient #${row.patientId}`}
                      </td>
                      <td className="font-mono">
                        {row.identificationType}: {row.identificationHint}
                      </td>
                      <td>{row.intendedServiceArea ?? '—'}</td>
                      <td>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${outcomeBadgeClass(
                            row.outcome,
                          )}`}
                        >
                          {row.outcome}
                        </span>
                      </td>
                      <td>
                        {row.isSimulated ? (
                          <span className="text-copper-700 font-medium">SANDBOX_SIM</span>
                        ) : (
                          row.source
                        )}
                      </td>
                      <td className="font-mono text-slate-600">{row.payerReference ?? '—'}</td>
                      <td>
                        {canCheckEligibility && (
                          <button
                            type="button"
                            onClick={() => void handleRecheckFromHistory(row)}
                            disabled
                            title="External SHA transport is unavailable"
                            className="text-brand-700 hover:underline font-semibold"
                          >
                            Recheck
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
      )}

      {/* SCREEN 4: BENEFITS & SERVICE COVERAGE VALIDATION */}
      {subView === 'benefits' && (
        <div className="space-y-5">
          <div className="panel p-4 bg-white space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="eyebrow text-brand-700">
                  DHA HIE v1 Coverage & Utilization Matrix
                </span>
                <h4 className="text-sm font-bold text-navy-900">
                  Query HIE Interventions, Remaining Utilization & POMSF Balances
                </h4>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={hieLookupCode}
                  onChange={(e) => setHieLookupCode(e.target.value)}
                  placeholder="SHA code e.g. SHA-19-152"
                  className="field-input text-xs w-44"
                />
                <button
                  type="button"
                  disabled
                  onClick={() => void handleLookupHieUtilization()}
                  className="btn-quiet text-xs disabled:opacity-50"
                >
                  {loadingHieLookup ? 'Querying HIE...' : 'Query HIE Matrix & Balances'}
                </button>
              </div>
            </div>
            {hieLookupData && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-2 border-t border-slate-100">
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="font-semibold text-navy-900">
                    Intervention Flags {hieLookupData.isSimulated ? '(Simulated)' : '(Live HIE)'}
                  </div>
                  {hieLookupData.interventions[0] ? (
                    <div className="mt-1 space-y-0.5 text-slate-700">
                      <div className="font-mono font-bold">
                        {hieLookupData.interventions[0].code} ·{' '}
                        {hieLookupData.interventions[0].fund}
                      </div>
                      <div>
                        Tariff: {formatMoneyOrDash(hieLookupData.interventions[0].overallTariff)}
                      </div>
                      <div>
                        Preauth: {hieLookupData.interventions[0].needsPreauth ? 'Yes' : 'No'} ·
                        Elective Manual:{' '}
                        {hieLookupData.interventions[0].needsManualPreauthApproval ? 'Yes' : 'No'} ·
                        Doctor Auth:{' '}
                        {hieLookupData.interventions[0].needsDoctorAuthorization ? 'Yes' : 'No'}
                      </div>
                    </div>
                  ) : (
                    <div className="text-slate-500 mt-1">No matching intervention returned.</div>
                  )}
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="font-semibold text-navy-900">Utilization Remaining Limits</div>
                  {hieLookupData.utilization[0] ? (
                    <div className="mt-1 space-y-0.5 text-slate-700">
                      <div>Scope: {hieLookupData.utilization[0].limitScope}</div>
                      <div>
                        Individual Rem:{' '}
                        {formatMoneyOrDash(
                          hieLookupData.utilization[0].individualRemainingLimitKes,
                        )}
                      </div>
                      <div>
                        Household Rem:{' '}
                        {formatMoneyOrDash(hieLookupData.utilization[0].householdRemainingLimitKes)}
                      </div>
                    </div>
                  ) : (
                    <div className="text-slate-500 mt-1">No utilization cap returned.</div>
                  )}
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="font-semibold text-navy-900">POMSF Scheme Balances</div>
                  {hieLookupData.pomsfBalances.length > 0 ? (
                    hieLookupData.pomsfBalances.map((b) => (
                      <div key={b.schemeCode} className="mt-1 text-slate-700">
                        {b.schemeCode} ({b.policyYear}): {formatMoneyOrDash(b.remainingBalanceKes)}
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-500 mt-1">No POMSF scheme balance active.</div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <form
              onSubmit={handleValidateBenefit}
              className="lg:col-span-5 panel p-5 bg-white space-y-3.5"
            >
              <div>
                <span className="eyebrow text-brand-700">Service-Level Coverage</span>
                <h3 className="text-base font-bold text-navy-900">
                  Validate SHA Benefit & Tariff Coverage
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Validates a specific JaliCare service against approved effective-dated SHA rules,
                  facility KEPH level, referral notes, and preauthorization requirements.
                </p>
              </div>

              <div>
                <label className="field-label">JaliCare Facility Service Tariff</label>
                <select
                  value={selectedTariffId}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : '';
                    setSelectedTariffId(id);
                    const found = tariffs.find((t) => Number(t.id) === Number(id));
                    if (found) {
                      setServiceDescription(found.description);
                      setServiceCategory(found.department.toUpperCase());
                    }
                  }}
                  className="field-input"
                >
                  <option value="">— Select facility tariff item —</option>
                  {tariffs.map((t) => (
                    <option key={t.id} value={t.id}>
                      [{t.code}] {t.description} — KES {t.fee}
                    </option>
                  ))}
                </select>
              </div>

              {!selectedTariffId && (
                <div>
                  <label className="field-label">Or Service Description</label>
                  <input
                    type="text"
                    value={serviceDescription}
                    onChange={(e) => setServiceDescription(e.target.value)}
                    placeholder="e.g. CT Scan Brain with Contrast"
                    className="field-input"
                  />
                </div>
              )}

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="field-label">SHA Fund</label>
                  <select
                    value={benefitPackage}
                    onChange={(e) => setBenefitPackage(e.target.value)}
                    className="field-input"
                  >
                    <option value="SHIF">SHIF</option>
                    <option value="PHC">PHC</option>
                    <option value="ECCIF">ECCIF</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">Service Date</label>
                  <input
                    type="date"
                    value={serviceDate}
                    onChange={(e) => setServiceDate(e.target.value)}
                    className="field-input"
                  />
                </div>
                <div>
                  <label className="field-label">Quantity</label>
                  <input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                    className="field-input"
                  />
                </div>
              </div>

              <div>
                <label className="field-label">Preauthorization Reference (If Issued)</label>
                <input
                  type="text"
                  value={preauthReference}
                  onChange={(e) => setPreauthReference(e.target.value)}
                  placeholder="e.g. PA-SHA-000001 or payer auth code"
                  className="field-input"
                />
              </div>

              <div className="flex flex-wrap gap-4 pt-1 text-xs text-slate-700">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasClinicalNotes}
                    onChange={(e) => setHasClinicalNotes(e.target.checked)}
                  />
                  Clinical indication / notes recorded
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasReferral}
                    onChange={(e) => setHasReferral(e.target.checked)}
                  />
                  Referral documentation on file
                </label>
              </div>

              <button
                type="submit"
                disabled={!canValidateBenefits || validatingBenefit || !selectedPatientId}
                className="btn-primary w-full justify-center disabled:opacity-50"
              >
                {validatingBenefit ? 'Evaluating SHA Rules...' : 'Validate Service Coverage'}
              </button>
            </form>

            <div className="lg:col-span-7 space-y-4">
              <div className="panel p-5 bg-white">
                <span className="eyebrow text-slate-500">Coverage Decision</span>
                {!benefitResult ? (
                  <div className="py-8 text-center text-slate-500 text-sm">
                    Select a patient and service tariff to evaluate SHA coverage, preauthorization
                    requirements, and copayment rules.
                  </div>
                ) : (
                  <div className="mt-3 space-y-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold border inline-flex items-center gap-1.5 ${outcomeBadgeClass(
                          benefitResult.decision,
                        )}`}
                      >
                        {benefitResult.decision === 'COVERED' ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <ShieldAlert className="w-3.5 h-3.5" />
                        )}
                        {benefitResult.decision}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">
                        Source: {benefitResult.verificationSource}
                        {benefitResult.ruleVersion ? ` (v${benefitResult.ruleVersion})` : ''}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                      <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                        <div className="text-slate-500">JaliCare Facility Tariff</div>
                        <div className="font-semibold text-navy-900 mt-0.5">
                          {formatMoneyOrDash(benefitResult.facilityTariffAmount)}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                        <div className="text-slate-500">Mapped SHA Tariff</div>
                        <div className="font-semibold text-navy-900 mt-0.5">
                          {formatMoneyOrDash(benefitResult.payerTariffAmount)}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                        <div className="text-slate-500">Est. Patient Copay</div>
                        <div className="font-semibold text-copper-700 mt-0.5">
                          {benefitResult.payerTariffAmount !== null
                            ? formatMoneyOrDash(benefitResult.estimatedCopayAmount)
                            : '—'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                        <div className="text-slate-500">Est. SHA Covered</div>
                        <div className="font-semibold text-brand-700 mt-0.5">
                          {formatMoneyOrDash(benefitResult.estimatedCoveredAmount)}
                        </div>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                      {benefitResult.reason}
                    </div>

                    {benefitResult.missingRequirements.length > 0 && (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                        <strong>Action Required:</strong>
                        <ul className="list-disc pl-5 mt-1 space-y-0.5">
                          {benefitResult.missingRequirements.map((req, idx) => (
                            <li key={idx}>{req}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {benefitDisclaimer && (
                      <p className="text-[11px] text-slate-500 italic">{benefitDisclaimer}</p>
                    )}
                  </div>
                )}
              </div>

              {patientBenefitsList.length > 0 && (
                <div className="panel p-4 bg-white">
                  <h4 className="text-xs font-bold text-navy-900 mb-2">
                    Recent Coverage Checks for Selected Patient
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="table-quiet w-full text-xs text-left">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Service</th>
                          <th>SHA Code</th>
                          <th>Decision</th>
                          <th>Est. Covered</th>
                        </tr>
                      </thead>
                      <tbody>
                        {patientBenefitsList.slice(0, 6).map((b) => (
                          <tr key={b.id}>
                            <td>{b.serviceDate}</td>
                            <td className="font-medium text-navy-900">{b.serviceDescription}</td>
                            <td className="font-mono">{b.payerServiceCode ?? '—'}</td>
                            <td>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${outcomeBadgeClass(
                                  b.decision,
                                )}`}
                              >
                                {b.decision}
                              </span>
                            </td>
                            <td>{formatMoneyOrDash(b.estimatedCoveredAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
