import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSignature,
  Loader2,
  Plus,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  Syringe,
} from 'lucide-react';

import { api, type PatientAllergy, type PatientConsent } from '../api/client.ts';

/**
 * Consent and allergy record for one patient.
 *
 * Both capabilities live behind this panel because both are things a
 * clinician must be able to see and act on at the point of care: a
 * consent that cannot be found is treated as absent, and an allergy
 * that is only in a free-text box is not checked against a
 * prescription.
 *
 * Nothing here asserts a state the server did not return. If the
 * request fails, the panel shows the failure rather than an empty
 * "none recorded" — the difference matters clinically.
 */

const CONSENT_PURPOSES = [
  { value: 'TREATMENT', label: 'Treatment' },
  { value: 'SHARING_WITH_FACILITY', label: 'Sharing with another facility' },
  { value: 'SHARING_WITH_INSURER', label: 'Sharing with insurer / SHA' },
  { value: 'RESEARCH', label: 'Research' },
  { value: 'TEACHING', label: 'Teaching' },
] as const;

const CONSENT_METHODS = [
  { value: 'WRITTEN', label: 'Written, signed form' },
  { value: 'VERBAL_WITNESSED', label: 'Verbal, witnessed' },
  { value: 'ELECTRONIC', label: 'Electronic (portal / SMS)' },
] as const;

/* Must match CONSENT_SCOPES in src/clinical/consent.service.ts. */
const CONSENT_SCOPES = [
  { value: 'patientProfile', label: 'Demographics' },
  { value: 'encounters', label: 'Encounters' },
  { value: 'diagnoses', label: 'Diagnoses' },
  { value: 'medications', label: 'Medications' },
  { value: 'laboratory', label: 'Laboratory results' },
  { value: 'radiology', label: 'Radiology' },
  { value: 'maternity', label: 'Maternity records' },
  { value: 'billing', label: 'Billing' },
] as const;

const ALLERGEN_TYPES = [
  { value: 'DRUG', label: 'Drug' },
  { value: 'FOOD', label: 'Food' },
  { value: 'ENVIRONMENTAL', label: 'Environmental' },
  { value: 'OTHER', label: 'Other' },
] as const;

const SEVERITIES = [
  { value: 'MILD', label: 'Mild' },
  { value: 'MODERATE', label: 'Moderate' },
  { value: 'SEVERE', label: 'Severe' },
  { value: 'LIFE_THREATENING', label: 'Life-threatening' },
] as const;

const severityTone: Record<string, string> = {
  MILD: 'bg-slate-100 text-slate-700 border-slate-200',
  MODERATE: 'bg-amber-50 text-amber-900 border-amber-200',
  SEVERE: 'bg-orange-50 text-orange-900 border-orange-200',
  LIFE_THREATENING: 'bg-rose-50 text-rose-900 border-rose-300',
};

const statusTone: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  REVOKED: 'bg-rose-50 text-rose-800 border-rose-200',
  EXPIRED: 'bg-slate-100 text-slate-600 border-slate-200',
  RESOLVED: 'bg-slate-100 text-slate-600 border-slate-200',
  ENTERED_IN_ERROR: 'bg-rose-50 text-rose-800 border-rose-200',
};

function formatDate(value: string | null): string {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

interface Props {
  patientId: number;
  patientName?: string;
}

export const PatientConsentAllergyPanel: React.FC<Props> = ({ patientId }) => {
  const [consents, setConsents] = useState<PatientConsent[]>([]);
  const [allergies, setAllergies] = useState<PatientAllergy[]>([]);
  const [disclaimer, setDisclaimer] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [showConsentForm, setShowConsentForm] = useState(false);
  const [showAllergyForm, setShowAllergyForm] = useState(false);

  const [consentForm, setConsentForm] = useState({
    purpose: 'TREATMENT',
    method: 'WRITTEN',
    expiresAt: '',
    scopes: ['patientProfile', 'encounters'] as string[],
  });

  const [allergyForm, setAllergyForm] = useState({
    allergenType: 'DRUG',
    allergen: '',
    reaction: '',
    severity: 'MODERATE',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const [consentResponse, allergyResponse] = await Promise.all([
        api.getPatientConsents(patientId),
        api.getPatientAllergies(patientId),
      ]);

      setConsents(consentResponse.consents ?? []);
      setAllergies(allergyResponse.allergies ?? []);
      setDisclaimer(allergyResponse.disclaimer ?? '');
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'The consent and allergy record could not be read.',
      );
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleScope = (scope: string) => {
    setConsentForm((current) => ({
      ...current,
      scopes: current.scopes.includes(scope)
        ? current.scopes.filter((entry) => entry !== scope)
        : [...current.scopes, scope],
    }));
  };

  const submitConsent = async () => {
    setBusy(true);
    setActionError(null);
    setActionMessage(null);

    try {
      await api.grantPatientConsent(patientId, {
        purpose: consentForm.purpose,
        method: consentForm.method,
        scope: Object.fromEntries(
          CONSENT_SCOPES.map((scope) => [scope.value, consentForm.scopes.includes(scope.value)]),
        ),
        expiresAt: consentForm.expiresAt || null,
      });

      setShowConsentForm(false);
      setActionMessage('Consent recorded.');
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The consent could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (consent: PatientConsent) => {
    const reason = window.prompt(
      'Why is this consent being revoked? The reason is recorded in the audit trail.',
      '',
    );

    if (reason === null) return;

    setBusy(true);
    setActionError(null);
    setActionMessage(null);

    try {
      await api.revokePatientConsent(patientId, consent.id, reason || undefined);
      setActionMessage('Consent revoked. It no longer authorises sharing.');
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The consent could not be revoked.');
    } finally {
      setBusy(false);
    }
  };

  const submitAllergy = async () => {
    if (allergyForm.allergen.trim() === '') {
      setActionError('Name the allergen before saving.');
      return;
    }

    setBusy(true);
    setActionError(null);
    setActionMessage(null);

    try {
      await api.recordPatientAllergy(patientId, {
        allergenType: allergyForm.allergenType,
        allergen: allergyForm.allergen.trim(),
        reaction: allergyForm.reaction.trim() || null,
        severity: allergyForm.severity,
        notes: allergyForm.notes.trim() || null,
      });

      setAllergyForm({
        allergenType: 'DRUG',
        allergen: '',
        reaction: '',
        severity: 'MODERATE',
        notes: '',
      });
      setShowAllergyForm(false);
      setActionMessage('Allergy recorded. Prescriptions will warn against it.');
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The allergy could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const changeAllergyStatus = async (allergy: PatientAllergy, status: string) => {
    setBusy(true);
    setActionError(null);
    setActionMessage(null);

    try {
      await api.setPatientAllergyStatus(patientId, allergy.id, status);
      setActionMessage(`Allergy marked ${status.toLowerCase().replace(/_/g, ' ')}.`);
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The allergy could not be updated.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 h-40 text-xs text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Reading consent and allergy records...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldOff className="w-4 h-4" />
          Consent and allergy records could not be read
        </div>
        <p className="mt-1 text-rose-800">{loadError}</p>
        <p className="mt-2 text-2xs text-rose-700">
          This is not the same as "nothing recorded". Do not treat the patient on the assumption
          that no consent or allergy exists.
        </p>
        <button
          onClick={() => void load()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-2xs font-semibold text-rose-900 border border-rose-200 hover:bg-rose-100"
        >
          <RotateCcw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  const activeAllergies = allergies.filter((entry) => entry.status === 'ACTIVE');
  const activeTreatmentConsent = consents.find(
    (entry) => entry.purpose === 'TREATMENT' && entry.status === 'ACTIVE',
  );

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {actionMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <CheckCircle2 className="mt-0.5 w-4 h-4 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* ---------------- Consent ---------------- */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <FileSignature className="w-4 h-4 text-blue-700" />
            <h3 className="text-sm font-semibold text-slate-900">Consent record</h3>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-2xs font-medium text-slate-600">
              Data Protection Act 2019
            </span>
          </div>

          <button
            onClick={() => setShowConsentForm((value) => !value)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-2xs font-semibold text-blue-900 hover:bg-blue-100 disabled:opacity-50"
          >
            <Plus className="w-3 h-3" /> Record consent
          </button>
        </header>

        <div className="px-4 py-3">
          {activeTreatmentConsent ? (
            <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <ShieldCheck className="mt-0.5 w-4 h-4 shrink-0" />
              <span>
                Active treatment consent on file, granted{' '}
                <strong>{formatDate(activeTreatmentConsent.grantedAt)}</strong> by{' '}
                <strong>{activeTreatmentConsent.method.replace(/_/g, ' ').toLowerCase()}</strong>.
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0" />
              <span>
                No active treatment consent is recorded at this facility. Record it before care
                proceeds unless the situation is an emergency.
              </span>
            </div>
          )}

          {showConsentForm && (
            <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-2">
              <label className="text-2xs font-medium text-slate-700">
                Purpose
                <select
                  value={consentForm.purpose}
                  onChange={(event) =>
                    setConsentForm({ ...consentForm, purpose: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                >
                  {CONSENT_PURPOSES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-2xs font-medium text-slate-700">
                How it was taken
                <select
                  value={consentForm.method}
                  onChange={(event) =>
                    setConsentForm({ ...consentForm, method: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                >
                  {CONSENT_METHODS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-2xs font-medium text-slate-700">
                Expires (optional)
                <input
                  type="date"
                  value={consentForm.expiresAt}
                  onChange={(event) =>
                    setConsentForm({ ...consentForm, expiresAt: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                />
              </label>

              <div className="sm:col-span-2">
                <p className="text-2xs font-medium text-slate-700">What the consent covers</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {CONSENT_SCOPES.map((scope) => {
                    const checked = consentForm.scopes.includes(scope.value);

                    return (
                      <button
                        key={scope.value}
                        type="button"
                        onClick={() => toggleScope(scope.value)}
                        aria-pressed={checked}
                        className={`rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors ${
                          checked
                            ? 'border-blue-300 bg-blue-100 text-blue-900'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {scope.label}
                      </button>
                    );
                  })}
                </div>
                {consentForm.scopes.length === 0 && (
                  <p className="mt-1 text-2xs text-rose-700">
                    A consent that covers nothing will be refused by the server.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 sm:col-span-2">
                <button
                  onClick={() => void submitConsent()}
                  disabled={busy || consentForm.scopes.length === 0}
                  className="rounded-md bg-blue-700 px-3 py-1.5 text-2xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {busy ? 'Saving...' : 'Save consent'}
                </button>
                <button
                  onClick={() => setShowConsentForm(false)}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-2xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {consents.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">
              No consent has been recorded for this patient.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {consents.map((consent) => {
                const scopes = Object.entries(consent.scope ?? {})
                  .filter(([, enabled]) => enabled)
                  .map(([key]) => key.replace(/_/g, ' ').toLowerCase());

                return (
                  <li
                    key={consent.id}
                    className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-900">
                          {consent.purpose.replace(/_/g, ' ')}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-2xs font-semibold ${
                            statusTone[consent.status] ?? statusTone.ACTIVE
                          }`}
                        >
                          {consent.status}
                        </span>
                      </div>
                      <p className="mt-0.5 text-2xs text-slate-500">
                        {consent.method.replace(/_/g, ' ').toLowerCase()} · granted{' '}
                        {formatDate(consent.grantedAt)}
                        {consent.expiresAt ? ` · expires ${formatDate(consent.expiresAt)}` : ''}
                      </p>
                      {scopes.length > 0 && (
                        <p className="mt-0.5 text-2xs text-slate-500">
                          Covers: {scopes.join(', ')}
                        </p>
                      )}
                    </div>

                    {consent.status === 'ACTIVE' && (
                      <button
                        onClick={() => void revoke(consent)}
                        disabled={busy}
                        className="self-start rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-2xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50 sm:self-auto"
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ---------------- Allergies ---------------- */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Syringe className="w-4 h-4 text-orange-700" />
            <h3 className="text-sm font-semibold text-slate-900">Allergy registry</h3>
            <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-2xs font-medium text-orange-900">
              {activeAllergies.length} active
            </span>
          </div>

          <button
            onClick={() => setShowAllergyForm((value) => !value)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-2.5 py-1 text-2xs font-semibold text-orange-900 hover:bg-orange-100 disabled:opacity-50"
          >
            <Plus className="w-3 h-3" /> Record allergy
          </button>
        </header>

        <div className="px-4 py-3">
          {showAllergyForm && (
            <div className="mb-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-2">
              <label className="text-2xs font-medium text-slate-700">
                Type
                <select
                  value={allergyForm.allergenType}
                  onChange={(event) =>
                    setAllergyForm({ ...allergyForm, allergenType: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                >
                  {ALLERGEN_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-2xs font-medium text-slate-700">
                Allergen
                <input
                  value={allergyForm.allergen}
                  onChange={(event) =>
                    setAllergyForm({ ...allergyForm, allergen: event.target.value })
                  }
                  placeholder="e.g. Penicillin"
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                />
              </label>

              <label className="text-2xs font-medium text-slate-700">
                Reaction
                <input
                  value={allergyForm.reaction}
                  onChange={(event) =>
                    setAllergyForm({ ...allergyForm, reaction: event.target.value })
                  }
                  placeholder="e.g. Rash and swelling"
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                />
              </label>

              <label className="text-2xs font-medium text-slate-700">
                Severity
                <select
                  value={allergyForm.severity}
                  onChange={(event) =>
                    setAllergyForm({ ...allergyForm, severity: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                >
                  {SEVERITIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-2xs font-medium text-slate-700 sm:col-span-2">
                Notes (optional)
                <input
                  value={allergyForm.notes}
                  onChange={(event) =>
                    setAllergyForm({ ...allergyForm, notes: event.target.value })
                  }
                  placeholder="Circumstances, source of the history, anything the next clinician needs"
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                />
              </label>

              <div className="flex items-center gap-2 sm:col-span-2">
                <button
                  onClick={() => void submitAllergy()}
                  disabled={busy}
                  className="rounded-md bg-orange-600 px-3 py-1.5 text-2xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  {busy ? 'Saving...' : 'Save allergy'}
                </button>
                <button
                  onClick={() => setShowAllergyForm(false)}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-2xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {allergies.length === 0 ? (
            <p className="text-xs text-slate-500">No allergy has been recorded for this patient.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {allergies.map((allergy) => (
                <li
                  key={allergy.id}
                  className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-900">
                        {allergy.allergen}
                      </span>
                      <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-2xs font-medium text-slate-600">
                        {allergy.allergenType}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-2xs font-semibold ${
                          severityTone[allergy.severity] ?? severityTone.MILD
                        }`}
                      >
                        {allergy.severity.replace(/_/g, ' ')}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-2xs font-semibold ${
                          statusTone[allergy.status] ?? statusTone.ACTIVE
                        }`}
                      >
                        {allergy.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="mt-0.5 text-2xs text-slate-500">
                      {allergy.reaction ? `Reaction: ${allergy.reaction} · ` : ''}
                      Recorded {formatDate(allergy.recordedAt)}
                    </p>
                    {allergy.notes && (
                      <p className="mt-0.5 text-2xs text-slate-500">{allergy.notes}</p>
                    )}
                  </div>

                  {allergy.status === 'ACTIVE' ? (
                    <div className="flex items-center gap-1.5 self-start sm:self-auto">
                      <button
                        onClick={() => void changeAllergyStatus(allergy, 'RESOLVED')}
                        disabled={busy}
                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-2xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        title="The allergy no longer applies (for example, a childhood reaction that has been excluded)"
                      >
                        Mark resolved
                      </button>
                      <button
                        onClick={() => void changeAllergyStatus(allergy, 'ENTERED_IN_ERROR')}
                        disabled={busy}
                        className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-2xs font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                        title="This entry was a mistake. It is kept for the audit trail, not deleted."
                      >
                        Entered in error
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => void changeAllergyStatus(allergy, 'ACTIVE')}
                      disabled={busy}
                      className="self-start rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-2xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 sm:self-auto"
                    >
                      Reactivate
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {disclaimer && (
            <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-2xs leading-relaxed text-slate-600">
              {disclaimer}
            </p>
          )}
        </div>
      </section>
    </div>
  );
};

export default PatientConsentAllergyPanel;
