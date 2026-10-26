import React, { useCallback, useEffect, useState } from 'react';
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

  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');

  const [readiness, setReadiness] = useState<DhaReadinessReport | null>(null);
  const [readinessError, setReadinessError] = useState('');
  const [readinessLoading, setReadinessLoading] = useState(false);

  const [calls, setCalls] = useState<DhaCallLog[]>([]);

  const [eligibility, setEligibility] = useState<DhaEligibilityResult | null>(null);
  const [eligibilityError, setEligibilityError] = useState('');
  const [eligibilityLoading, setEligibilityLoading] = useState(false);

  const [identificationType, setIdentificationType] = useState('');
  const [identificationNumber, setIdentificationNumber] = useState('');

  const [fhirData, setFhirData] = useState<any>(null);
  const [fhirLoading, setFhirLoading] = useState(false);

  const loadReadiness = useCallback(
    async (probe: boolean) => {
      /*
       * Both the connection report and the eligibility/FHIR calls are
       * facility scoped. A platform owner with no facility selected has
       * nothing to ask about yet, and asking would produce
       * FACILITY_REQUIRED dressed up as a failure.
       */
      if (!currentFacility?.id) {
        setReadiness(null);
        setReadinessError('');
        setReadinessLoading(false);
        return;
      }

      setReadinessLoading(true);
      setReadinessError('');

      try {
        const report = await api.getDhaReadiness(probe);
        setReadiness(report);
      } catch (err) {
        setReadinessError(err instanceof Error ? err.message : 'Failed to read DHA readiness.');
      } finally {
        setReadinessLoading(false);
      }
    },
    [currentFacility?.id],
  );

  useEffect(() => {
    void loadReadiness(false);
  }, [loadReadiness, currentFacility?.id]);

  useEffect(() => {
    async function loadPatients() {
      if (!currentFacility?.id) {
        setPatients([]);
        setSelectedPatientId('');
        return;
      }

      try {
        const pList = await api.getPatients(currentTenant?.id, currentFacility?.id);
        setPatients(pList);

        if (pList.length > 0) {
          setSelectedPatientId(pList[0].id.toString());
          void loadFhir(pList[0].id);
        }
      } catch (err) {
        console.error('Failed to load patients for FHIR:', err);
      }
    }

    void loadPatients();
  }, [currentTenant, currentFacility, refreshKey]);

  useEffect(() => {
    async function loadCalls() {
      if (!currentFacility?.id) {
        setCalls([]);
        return;
      }

      try {
        setCalls(await api.getDhaCalls(currentFacility?.id, 25));
      } catch {
        /* The call log is diagnostic; a failure here must not break the page. */
        setCalls([]);
      }
    }

    void loadCalls();
  }, [currentFacility?.id, refreshKey]);

  const loadFhir = async (id: number) => {
    setFhirLoading(true);

    try {
      setFhirData(await api.getFhirPatient(id));
    } catch (err) {
      console.error('Failed to fetch FHIR structure:', err);
    } finally {
      setFhirLoading(false);
    }
  };

  const runEligibilityCheck = async () => {
    if (!selectedPatientId) return;

    setEligibilityLoading(true);
    setEligibilityError('');
    setEligibility(null);

    try {
      const result = await api.checkDhaEligibility(Number(selectedPatientId), {
        identificationType: identificationType || undefined,
        identificationNumber: identificationNumber || undefined,
        facilityId: currentFacility?.id,
      });

      setEligibility(result);

      /* Never leave an identifier in the form after it has been used. */
      setIdentificationNumber('');
    } catch (err) {
      setEligibilityError(err instanceof Error ? err.message : 'The eligibility check failed.');
    } finally {
      setEligibilityLoading(false);
    }
  };

  const copyFhirJson = () => {
    if (!fhirData) return;

    navigator.clipboard.writeText(JSON.stringify(fhirData, null, 2));
    showToast('Copied HL7 FHIR R4 JSON to clipboard.');
  };

  const downloadFhirJson = () => {
    if (!fhirData) return;

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
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-card border border-hair bg-surface p-5 shadow-card">
      <div>
        <h1 className="font-display text-[1.35rem] leading-tight tracking-tight text-ink">
          DHA / AfyaConnect Integration
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-muted">
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
    </div>
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
              onChange={(event) => {
                setSelectedPatientId(event.target.value);
                setEligibility(null);
                setEligibilityError('');
              }}
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-xs"
            >
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

        {calls.length === 0 ? (
          <p className="text-2xs text-slate-500 py-2">No calls recorded for this facility yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-2xs">
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
            </table>
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
              onChange={(event) => {
                setSelectedPatientId(event.target.value);
                void loadFhir(Number(event.target.value));
              }}
              className="px-3 py-1.5 border border-slate-200 rounded-md text-xs font-medium"
            >
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
              <span>Download schema</span>
            </button>
          </div>
        </div>

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
