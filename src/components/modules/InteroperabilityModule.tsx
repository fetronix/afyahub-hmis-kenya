import { DataTable, PageHeader } from '../ui/layout.tsx';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { Patient } from '../../types/index.ts';
import { DhaCompliancePanel } from './DhaCompliancePanel.tsx';
import type { DhaCallLog, DhaEligibilityResult, DhaReadinessReport } from '../../types/index.ts';
import {
  Network,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Download,
  Copy,
  Layers,
  RefreshCw,
  Activity,
  Lock,
} from 'lucide-react';

/**
 * DHA / AfyaConnect integration screen.
 *
 * Everything shown here is read from the server. Nothing is asserted in
 * the browser: if the report says an operation is not implemented, that
 * is because the server cannot call it. There is no "Compliant" badge,
 * because this installation is not certified, not approved and not
 * connected to production.
 *
 * Mock mode is labelled on every result. A simulated answer must never
 * be mistaken for a SHIF adjudication.
 */
export const InteroperabilityModule: React.FC = () => {
  const { currentTenant, currentFacility, showToast, refreshKey } = useHmis();

  const currentFacilityId = currentFacility?.id;
  const scopeKey = `${currentTenant?.id ?? 'none'}:${currentFacilityId ?? 'none'}`;
  const scopeRef = useRef(scopeKey);
  useLayoutEffect(() => {
    scopeRef.current = scopeKey;
  }, [scopeKey]);

  const [patientList, setPatientList] = useState<{ scope: string; rows: Patient[] } | null>(null);
  const [selection, setSelection] = useState<{ scope: string; id: string } | null>(null);
  const patients = patientList?.scope === scopeKey ? patientList.rows : [];
  const selectedPatientId = selection?.scope === scopeKey ? selection.id : '';
  const [patientsError, setPatientsError] = useState('');

  const [readinessState, setReadinessState] = useState<{
    scope: string;
    report: DhaReadinessReport;
  } | null>(null);
  const readiness = readinessState?.scope === scopeKey ? readinessState.report : null;
  const [readinessError, setReadinessError] = useState('');
  const [readinessLoading, setReadinessLoading] = useState(false);
  const readinessRequest = useRef(0);

  const [callState, setCallState] = useState<{
    scope: string;
    rows: DhaCallLog[];
    status: 'loading' | 'ready' | 'error';
  } | null>(null);
  const calls = callState?.scope === scopeKey ? callState.rows : [];

  const [eligibilityState, setEligibilityState] = useState<{
    scope: string;
    patientId: string;
    result: DhaEligibilityResult;
  } | null>(null);
  const eligibility =
    eligibilityState?.scope === scopeKey && eligibilityState.patientId === selectedPatientId
      ? eligibilityState.result
      : null;
  const [eligibilityError, setEligibilityError] = useState('');
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const eligibilityRequest = useRef(0);

  const [identificationType, setIdentificationType] = useState('');
  const [identificationNumber, setIdentificationNumber] = useState('');

  const [fhirState, setFhirState] = useState<{
    scope: string;
    patientId: string;
    data: any;
  } | null>(null);
  const fhirData =
    fhirState?.scope === scopeKey && fhirState.patientId === selectedPatientId
      ? fhirState.data
      : null;
  const [fhirLoading, setFhirLoading] = useState(false);
  const [fhirError, setFhirError] = useState('');
  const [fhirRetry, setFhirRetry] = useState(0);

  const loadReadiness = useCallback(
    async (probe: boolean) => {
      const request = ++readinessRequest.current;
      setReadinessState(null);
      setReadinessError('');
      if (!currentFacilityId) {
        setReadinessLoading(false);
        return;
      }

      setReadinessLoading(true);
      try {
        const report = await api.getDhaReadiness(probe, currentFacilityId);
        if (request === readinessRequest.current && scopeRef.current === scopeKey) {
          setReadinessState({ scope: scopeKey, report });
        }
      } catch (err) {
        if (request === readinessRequest.current && scopeRef.current === scopeKey) {
          setReadinessError(err instanceof Error ? err.message : 'Failed to read DHA readiness.');
        }
      } finally {
        if (request === readinessRequest.current && scopeRef.current === scopeKey) {
          setReadinessLoading(false);
        }
      }
    },
    [currentFacilityId, scopeKey],
  );

  useEffect(() => {
    void loadReadiness(false);
    return () => {
      readinessRequest.current += 1;
    };
  }, [loadReadiness]);

  useEffect(() => {
    let active = true;
    eligibilityRequest.current += 1;
    setPatientList(null);
    setSelection(null);
    setPatientsError('');
    setEligibilityState(null);
    setEligibilityError('');
    setEligibilityLoading(false);
    setIdentificationType('');
    setIdentificationNumber('');

    if (currentFacility?.id) {
      void api
        .getPatients(currentTenant?.id, currentFacility.id)
        .then((rows) => {
          if (!active || scopeRef.current !== scopeKey) return;
          setPatientList({ scope: scopeKey, rows });
          setSelection({ scope: scopeKey, id: rows[0]?.id.toString() ?? '' });
        })
        .catch(() => {
          if (active && scopeRef.current === scopeKey) {
            setPatientsError('Patients could not be loaded for this facility.');
          }
        });
    }
    return () => {
      active = false;
    };
  }, [scopeKey, currentTenant?.id, currentFacility?.id, refreshKey]);

  useEffect(() => {
    let active = true;
    setCallState({ scope: scopeKey, rows: [], status: 'loading' });
    if (currentFacility?.id) {
      void api
        .getDhaCalls(currentFacility.id, 25)
        .then((rows) => {
          if (active && scopeRef.current === scopeKey)
            setCallState({ scope: scopeKey, rows, status: 'ready' });
        })
        .catch(() => {
          if (active && scopeRef.current === scopeKey)
            setCallState({ scope: scopeKey, rows: [], status: 'error' });
        });
    }
    return () => {
      active = false;
    };
  }, [scopeKey, currentFacility?.id, refreshKey]);

  useEffect(() => {
    let active = true;
    setFhirState(null);
    setFhirError('');
    if (!selectedPatientId || !currentFacility?.id) {
      setFhirLoading(false);
      return () => {
        active = false;
      };
    }

    setFhirLoading(true);
    void api
      .getFhirPatient(Number(selectedPatientId), currentFacility.id)
      .then((data) => {
        if (!active || scopeRef.current !== scopeKey) return;
        if (data?.resourceType !== 'Patient' || data?.id !== `ke-hmis-${selectedPatientId}`) {
          throw new Error('Patient resource identity mismatch.');
        }
        setFhirState({ scope: scopeKey, patientId: selectedPatientId, data });
      })
      .catch(() => {
        if (active && scopeRef.current === scopeKey) {
          setFhirError('The selected patient resource could not be verified or loaded.');
        }
      })
      .finally(() => {
        if (active && scopeRef.current === scopeKey) setFhirLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scopeKey, selectedPatientId, currentFacility?.id, fhirRetry]);

  const selectPatient = (id: string) => {
    if (id && !patients.some((patient) => patient.id.toString() === id)) return;
    eligibilityRequest.current += 1;
    setEligibilityState(null);
    setEligibilityError('');
    setEligibilityLoading(false);
    setIdentificationType('');
    setIdentificationNumber('');
    setFhirState(null);
    setSelection({ scope: scopeKey, id });
  };

  const runEligibilityCheck = async () => {
    if (!selectedPatientId || !currentFacility?.id) return;

    const request = ++eligibilityRequest.current;
    const patientId = selectedPatientId;
    const identifier = identificationNumber;
    const identifierType = identificationType;
    setEligibilityLoading(true);
    setEligibilityError('');
    setEligibilityState(null);
    // An override entered for one patient must not linger across a switch.
    setIdentificationNumber('');

    try {
      const result = await api.checkDhaEligibility(Number(patientId), {
        identificationType: identifierType || undefined,
        identificationNumber: identifier || undefined,
        facilityId: currentFacility.id,
      });

      if (request === eligibilityRequest.current && scopeRef.current === scopeKey) {
        setEligibilityState({ scope: scopeKey, patientId, result });
      }
    } catch (err) {
      if (request === eligibilityRequest.current && scopeRef.current === scopeKey) {
        setEligibilityError(err instanceof Error ? err.message : 'The eligibility check failed.');
      }
    } finally {
      if (request === eligibilityRequest.current && scopeRef.current === scopeKey) {
        setEligibilityLoading(false);
      }
    }
  };

  const copyFhirJson = () => {
    if (!fhirData || fhirLoading) return;

    navigator.clipboard.writeText(JSON.stringify(fhirData, null, 2));
    showToast('Copied HL7 FHIR R4 JSON to clipboard.');
  };

  const downloadFhirJson = () => {
    if (!fhirData || fhirLoading) return;

    const blob = new Blob([JSON.stringify(fhirData, null, 2)], {
      type: 'application/fhir+json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = `FHIR-Patient-${fhirData.id}.json`;
    a.click();

    showToast('Downloaded FHIR resource file.');
  };

  const mode = readiness?.config.mode ?? 'unknown';

  const modeBadge =
    mode === 'production'
      ? {
          className: 'bg-red-50 border-red-200 text-red-800',
          label: 'PRODUCTION — live patient data leaves this system',
          icon: <AlertTriangle className="w-4 h-4" />,
        }
      : mode === 'sandbox'
        ? {
            className: 'bg-amber-50 border-amber-200 text-amber-800',
            label: 'SANDBOX — calls the DHA UAT environment',
            icon: <Activity className="w-4 h-4" />,
          }
        : {
            className: 'bg-slate-100 border-slate-300 text-slate-700',
            label: 'MOCK — local fixtures, no network calls, results are simulated',
            icon: <Lock className="w-4 h-4" />,
          };

  const statusStyle = (status: string) =>
    status === 'READY'
      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
      : status === 'WARNING'
        ? 'text-amber-700 bg-amber-50 border-amber-200'
        : 'text-red-700 bg-red-50 border-red-200';

  const header = (
    <PageHeader>
      <div>
        <h1 className="ui-page-title">DHA / AfyaConnect Integration</h1>
        <p className="ui-page-description">
          Eligibility, benefit coverage and the FHIR patient resource. Readiness is reported as it
          is, including what is not implemented.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={`px-3 py-1.5 border text-xs font-semibold rounded-lg flex items-center gap-1.5 ${modeBadge.className}`}
        >
          {modeBadge.icon}
          <span>{modeBadge.label}</span>
        </span>

        <button
          onClick={() => void loadReadiness(true)}
          disabled={readinessLoading}
          className="px-3 py-1.5 text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg flex items-center gap-1"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${readinessLoading ? 'animate-spin' : ''}`} />
          <span>Re-check</span>
        </button>
      </div>
    </PageHeader>
  );

  /*
   * No facility, no facility-scoped sections. The assessment below is
   * about the product, not about one facility, so it still renders —
   * which is exactly what a platform owner without a facility selected
   * needs to see.
   */
  if (!currentFacility?.id) {
    return (
      <div className="space-y-6">
        {header}

        <div className="rounded-card border border-brand-200 bg-brand-50 p-4 text-xs leading-relaxed text-navy-800">
          <p className="font-semibold">No facility is selected.</p>
          <p className="mt-1">
            The connection report, eligibility checks and the FHIR preview all describe one
            facility. Choose a facility in the header to see them. The self-assessment below is not
            facility specific and is shown in full.
          </p>
        </div>

        <DhaCompliancePanel />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {/*
        The self-assessment comes before the connection report: whether
        the system is ready to be reviewed is a different question from
        whether it can reach DHA today.
      */}
      <DhaCompliancePanel />

      {readinessError && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl p-4 flex items-start gap-2">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">The readiness report could not be read.</p>
            <p className="mt-0.5">{readinessError}</p>
            <p className="mt-1 text-red-700">
              If this says the module is disabled, an administrator must enable Interoperability for
              this facility under Configuration.
            </p>
          </div>
        </div>
      )}

      {/* Readiness checks */}
      {readiness && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Readiness report
            </h2>

            <div className="flex items-center gap-2">
              <span className="text-2xs text-slate-400 font-mono">
                {new Date(readiness.generatedAt).toLocaleString()}
              </span>

              <span
                className={`px-2 py-1 rounded-md border text-2xs font-semibold ${
                  readiness.ready ? statusStyle('READY') : statusStyle('BLOCKED')
                }`}
              >
                {readiness.ready
                  ? 'No blockers'
                  : `${readiness.blockers.length} blocker${
                      readiness.blockers.length === 1 ? '' : 's'
                    }`}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {readiness.checks.map((check) => (
              <div
                key={check.id}
                className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 space-y-1 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{check.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded border text-2xs font-semibold ${statusStyle(
                      check.status,
                    )}`}
                  >
                    {check.status}
                  </span>
                </div>
                <p className="text-2xs text-slate-600 leading-relaxed">{check.detail}</p>
              </div>
            ))}
          </div>

          {readiness.blockers.length > 0 && (
            <div className="bg-red-50/70 border border-red-200 rounded-lg p-3.5 space-y-1">
              <p className="text-xs font-semibold text-red-800">
                Outstanding before this facility can exchange data with DHA
              </p>
              <ul className="text-2xs text-red-700 space-y-1 list-disc pl-4">
                {readiness.blockers.map((blocker, index) => (
                  <li key={index}>{blocker}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-2xs">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-slate-500">Client id</p>
              <p className="font-semibold text-slate-800">
                {readiness.config.credentials.clientId}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-slate-500">Client secret</p>
              <p className="font-semibold text-slate-800">
                {readiness.config.credentials.clientSecret}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-slate-500">Facility (FR) code</p>
              <p className="font-semibold text-slate-800">
                {readiness.config.credentials.facilityCode}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-slate-500">Production opt-in</p>
              <p className="font-semibold text-slate-800">
                {readiness.config.productionOptIn ? 'true' : 'false'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Operation coverage */}
      {readiness && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Operation coverage
            </h2>
            <span className="text-2xs text-slate-400">
              {readiness.operations.filter((operation) => operation.implemented).length} of{' '}
              {readiness.operations.length} implemented
            </span>
          </div>

          <div className="space-y-2">
            {readiness.operations.map((operation) => (
              <div
                key={operation.operation}
                className="flex flex-col sm:flex-row sm:items-start gap-2 p-3 rounded-lg border border-slate-200 bg-white"
              >
                <div className="flex items-center gap-2 sm:w-72 shrink-0">
                  {operation.implemented ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <div>
                    <p className="text-xs font-semibold text-slate-900">{operation.operation}</p>
                    <p className="text-2xs font-mono text-slate-500">
                      {operation.method} {operation.path}
                    </p>
                  </div>
                </div>

                <div className="flex-1 text-2xs leading-relaxed">
                  {operation.implemented ? (
                    <span className="text-emerald-700">Implemented and callable.</span>
                  ) : (
                    <span className="text-slate-600">
                      <span className="font-semibold text-slate-700">Not implemented — </span>
                      {operation.blockedReason}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Eligibility */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Member eligibility
          </h2>
          <p className="text-2xs text-slate-500 mt-1">
            Uses the patient's Client Registry id, or their national ID when no CR id is recorded.
            Identifiers are masked in every response.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="flex-1">
            <label className="block text-2xs font-semibold text-slate-600 mb-1">Patient</label>
            <select
              value={selectedPatientId}
              onChange={(event) => selectPatient(event.target.value)}
              disabled={patients.length === 0}
              aria-label="Eligibility patient"
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-xs"
            >
              {patients.length === 0 && <option value="">No patient selected</option>}
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.firstName} {patient.lastName} (MRN: {patient.mrn})
                </option>
              ))}
            </select>
          </div>

          <div className="lg:w-56">
            <label className="block text-2xs font-semibold text-slate-600 mb-1">
              Identification type (optional)
            </label>
            <select
              value={identificationType}
              onChange={(event) => setIdentificationType(event.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-xs"
            >
              <option value="">Use recorded identifier</option>
              <option value="ClientRegistry ID">ClientRegistry ID</option>
              <option value="National ID">National ID</option>
              <option value="Birth Notification">Birth Notification</option>
              <option value="Birth Certificate">Birth Certificate</option>
              <option value="Alien ID">Alien ID</option>
              <option value="Refugee ID">Refugee ID</option>
              <option value="Mandate Number">Mandate Number</option>
            </select>
          </div>

          <div className="lg:w-56">
            <label className="block text-2xs font-semibold text-slate-600 mb-1">
              Identifier override (optional)
            </label>
            <input
              type="text"
              value={identificationNumber}
              onChange={(event) => setIdentificationNumber(event.target.value)}
              placeholder="Leave blank to use the record"
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-xs"
            />
          </div>

          <button
            onClick={() => void runEligibilityCheck()}
            disabled={eligibilityLoading || !selectedPatientId}
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-md flex items-center gap-1.5"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{eligibilityLoading ? 'Checking…' : 'Check eligibility'}</span>
          </button>
        </div>

        {patientsError && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg p-3"
          >
            {patientsError}
          </div>
        )}

        {eligibilityError && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg p-3 flex items-start gap-2">
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{eligibilityError}</span>
          </div>
        )}

        {eligibility && (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div
              className={`px-4 py-2.5 text-xs font-semibold flex flex-wrap items-center justify-between gap-2 ${
                eligibility.verdict.deceased
                  ? 'bg-red-50 text-red-800'
                  : eligibility.verdict.eligible
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-amber-50 text-amber-800'
              }`}
            >
              <span>
                {eligibility.verdict.deceased
                  ? 'Recorded as deceased — all activity must stop'
                  : eligibility.verdict.eligible
                    ? 'Eligible for the schemes listed below'
                    : 'Not eligible — no active scheme returned'}
              </span>

              {eligibility.simulated && (
                <span className="px-2 py-0.5 rounded bg-slate-800 text-white text-2xs font-semibold">
                  SIMULATED — not a SHIF decision
                </span>
              )}
            </div>

            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-2xs">
              <div>
                <p className="text-slate-500">Identification</p>
                <p className="font-mono font-semibold text-slate-800">
                  {eligibility.identificationHint}
                </p>
                <p className="text-slate-400">{eligibility.identificationType}</p>
              </div>

              <div>
                <p className="text-slate-500">POMSF cover</p>
                <p className="font-semibold text-slate-800">
                  {eligibility.verdict.pomsfEligible ? 'Yes' : 'No'}
                </p>
                <p className="text-slate-400">
                  {eligibility.verdict.matchedPrefixes.length > 0
                    ? eligibility.verdict.matchedPrefixes.join(', ')
                    : 'No POMSF/TSC/USALAMA scheme'}
                </p>
              </div>

              <div>
                <p className="text-slate-500">Consent</p>
                <p className="font-semibold text-slate-800">
                  {eligibility.verdict.biometricsEnforced
                    ? 'Biometrics required'
                    : eligibility.verdict.otpWhitelisted
                      ? 'OTP accepted'
                      : 'Not stated'}
                </p>
                <p className="text-slate-400">
                  {eligibility.verdict.statusDesc ?? eligibility.verdict.statusCode ?? '—'}
                </p>
              </div>

              <div>
                <p className="text-slate-500">Client Registry id</p>
                <p className="font-semibold text-slate-800">
                  {eligibility.memberCrNumberRecorded ? 'Recorded' : 'Not returned'}
                </p>
                <p className="text-slate-400">{eligibility.mode} mode</p>
              </div>
            </div>

            <div className="px-4 pb-4">
              <p className="text-2xs text-slate-500 mb-1.5">Schemes returned</p>
              <div className="flex flex-wrap gap-1.5">
                {eligibility.verdict.schemes.length === 0 ? (
                  <span className="text-2xs text-slate-400">None</span>
                ) : (
                  eligibility.verdict.schemes.map((scheme) => (
                    <span
                      key={scheme}
                      className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-2xs font-medium text-slate-700"
                    >
                      {scheme}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Call log */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
        <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Integration call log
          </h2>
          <span className="text-2xs text-slate-400">
            Identifiers are never stored in this table
          </span>
        </div>

        {!currentFacility?.id ? (
          <p className="text-2xs text-slate-500 py-2">
            Select a facility to view its call history.
          </p>
        ) : callState?.scope !== scopeKey || callState.status === 'loading' ? (
          <p className="text-2xs text-slate-500 py-2">Loading call history…</p>
        ) : callState.status === 'error' ? (
          <p role="alert" className="text-2xs text-red-800 py-2">
            Call history could not be loaded. Do not assume there were no calls.
          </p>
        ) : calls.length === 0 ? (
          <p className="text-2xs text-slate-500 py-2">No calls recorded for this facility yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <DataTable className="w-full text-2xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="py-1.5 pr-3 font-semibold">When</th>
                  <th className="py-1.5 pr-3 font-semibold">Operation</th>
                  <th className="py-1.5 pr-3 font-semibold">Status</th>
                  <th className="py-1.5 pr-3 font-semibold">HTTP</th>
                  <th className="py-1.5 pr-3 font-semibold">ms</th>
                  <th className="py-1.5 font-semibold">Mode</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => (
                  <tr key={call.id} className="border-b border-slate-50">
                    <td className="py-1.5 pr-3 text-slate-600">
                      {new Date(call.createdAt).toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-slate-800">{call.operation}</td>
                    <td className="py-1.5 pr-3">
                      <span
                        className={call.status === 'SUCCESS' ? 'text-emerald-700' : 'text-red-700'}
                      >
                        {call.status}
                        {call.errorCode ? ` (${call.errorCode})` : ''}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-slate-600">{call.httpStatus ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{call.durationMs ?? '—'}</td>
                    <td className="py-1.5 text-slate-600">
                      {call.mode}
                      {call.simulated ? ' · simulated' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
      </div>

      {/* FHIR R4 Resource Inspector */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-3">
            <Layers className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-semibold text-slate-700">Inspect patient resource:</span>
            <select
              value={selectedPatientId}
              onChange={(event) => selectPatient(event.target.value)}
              disabled={patients.length === 0}
              aria-label="FHIR patient"
              className="px-3 py-1.5 border border-slate-200 rounded-md text-xs font-medium"
            >
              {patients.length === 0 && <option value="">No patient selected</option>}
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.firstName} {patient.lastName} (MRN: {patient.mrn})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={copyFhirJson}
              disabled={!fhirData || fhirLoading}
              className="px-3 py-1.5 text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-md transition-colors flex items-center gap-1"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy JSON</span>
            </button>
            <button
              onClick={downloadFhirJson}
              disabled={!fhirData || fhirLoading}
              className="px-3 py-1.5 text-xs text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-md transition-colors shadow-xs flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download schema</span>
            </button>
          </div>
        </div>

        {fhirError && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg p-3"
          >
            {fhirError}{' '}
            <button
              type="button"
              onClick={() => setFhirRetry((value) => value + 1)}
              className="font-semibold underline"
            >
              Retry FHIR
            </button>
          </div>
        )}

        <div className="relative">
          {fhirLoading ? (
            <div className="h-64 flex items-center justify-center text-slate-400 text-xs">
              Generating HL7 FHIR R4 representation…
            </div>
          ) : (
            <pre className="p-4 bg-slate-950 text-emerald-400 font-mono text-xs rounded-xl overflow-x-auto max-h-[480px] leading-relaxed border border-slate-800">
              {fhirData ? JSON.stringify(fhirData, null, 2) : '// No patient selected'}
            </pre>
          )}
        </div>

        <p className="text-2xs text-slate-500 flex items-start gap-1.5">
          <Network className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            This resource is generated locally from the patient record. It has not been validated
            against the Shared Health Record and is not submitted anywhere.
          </span>
        </p>
      </div>
    </div>
  );
};
