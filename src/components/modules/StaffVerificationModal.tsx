import React, { useEffect, useMemo, useState } from "react";
import { getSessionToken } from "../../api/client.ts";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  FileSearch,
  Loader2,
  ShieldAlert,
  XCircle,
} from "lucide-react";

/**
 * Professional registration check, shown before an invitation is issued.
 *
 * The modal does three things and refuses to blur them together:
 *
 *   - runs the regulator lookup and shows exactly what came back
 *   - states whether the result is a registration, a licence, or neither
 *   - offers a manual check, labelled as manual, when the automated one
 *     cannot decide
 *
 * It never upgrades a partial answer. If the registry returns a name and
 * nothing else, the screen says so.
 */

type Regulator = {
  code: string;
  name: string;
  shortName: string;
  professions: string[];
  apiSupported: boolean;
  website: string;
  staffRoles: string[];
};

type Verification = {
  credentialId: number | null;
  status: string;
  regulator: string;
  registrationNumber: string;
  record: {
    fullName: string | null;
    registrationNumber: string | null;
    licenceNumber: string | null;
    profession: string | null;
    specialty: string | null;
    registrationStatus: string | null;
    licenceStatus: string | null;
    licenceExpiry: string | null;
  };
  warnings: string[];
  mapping: "provisional" | "confirmed";
  mode: string;
  simulated: boolean;
  serviceError: { code: string; message: string } | null;
  invitable: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  REGISTRATION_VERIFIED: "Registration verified",
  LICENCE_CONFIRMED: "Current licence confirmed",
  LICENCE_EXPIRED: "Licence expired",
  REGISTRATION_INACTIVE: "Registration inactive or withdrawn",
  IDENTITY_MISMATCH: "Identity mismatch",
  RECORD_NOT_FOUND: "Record not found",
  SERVICE_UNAVAILABLE: "Verification service unavailable",
  MANUAL_REVIEW_REQUIRED: "Manual review required",
  MANUALLY_VERIFIED: "Manually verified against the regulator record",
  NOT_VERIFIED: "Not verified",
  PENDING: "Verification pending",
};

function statusTone(status: string): string {
  if (status === "LICENCE_CONFIRMED" || status === "REGISTRATION_VERIFIED" || status === "MANUALLY_VERIFIED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "LICENCE_EXPIRED" || status === "REGISTRATION_INACTIVE" || status === "IDENTITY_MISMATCH") {
    return "border-red-200 bg-red-50 text-red-800";
  }

  if (status === "SERVICE_UNAVAILABLE") {
    return "border-slate-300 bg-slate-50 text-slate-700";
  }

  return "border-amber-200 bg-amber-50 text-amber-800";
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getSessionToken();

  return {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.message || `Request failed (${response.status}).`);
  }

  return payload as T;
}

export const StaffVerificationModal: React.FC<{
  roleName: string;
  fullName: string;
  /**
   * Set when the check is made for an existing staff account. The
   * server records the credential against that account, so a clinical
   * role can later be assigned to it without re-checking the person.
   */
  subjectUserId?: number | null;
  onClose: () => void;
  onVerified: (credentialId: number, summary: string) => void;
}> = ({ roleName, fullName, subjectUserId = null, onClose, onVerified }) => {
  const [regulators, setRegulators] = useState<Regulator[]>([]);
  const [regulator, setRegulator] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState("");
  const [manualSource, setManualSource] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [savingManual, setSavingManual] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const suggested = useMemo(
    () => regulators.find((item) => item.staffRoles.includes(roleName.toUpperCase())) ?? null,
    [regulators, roleName],
  );

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/staff-invitations/regulators", {
          credentials: "same-origin",
          headers: authHeaders(),
        });
        const payload = await readJson<{ regulators: Regulator[] }>(response);
        setRegulators(payload.regulators ?? []);
        const match = (payload.regulators ?? []).find((item) =>
          item.staffRoles.includes(roleName.toUpperCase()),
        );
        setRegulator(match?.code ?? payload.regulators?.[0]?.code ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load the regulator list.");
      }
    }

    void load();
  }, [roleName]);

  const runCheck = async () => {
    setChecking(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/staff-invitations/verify-practitioner", {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          regulator,
          registrationNumber: registrationNumber.trim(),
          fullName: fullName.trim() || null,
          userId: subjectUserId,
        }),
      });

      const payload = await readJson<{ verification: Verification }>(response);
      setResult(payload.verification);

      if (payload.verification.invitable && payload.verification.credentialId) {
        setManualOpen(false);
      } else if (
        payload.verification.status === "MANUAL_REVIEW_REQUIRED" ||
        payload.verification.status === "RECORD_NOT_FOUND" ||
        payload.verification.status === "IDENTITY_MISMATCH" ||
        payload.verification.status === "SERVICE_UNAVAILABLE"
      ) {
        setManualOpen(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The verification request failed.");
    } finally {
      setChecking(false);
    }
  };

  const saveManual = async () => {
    setSavingManual(true);
    setError("");

    try {
      const response = await fetch("/api/staff-invitations/manual-verification", {
        method: "POST",
        credentials: "same-origin",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          credentialId: result?.credentialId ?? null,
          regulator,
          registrationNumber: registrationNumber.trim(),
          fullName: fullName.trim() || null,
          source: manualSource.trim(),
          notes: manualNotes.trim() || null,
          userId: subjectUserId,
        }),
      });

      const payload = await readJson<{
        verification: { credentialId: number | null; status: string };
      }>(response);

      if (!payload.verification.credentialId) {
        throw new Error("The manual check was recorded without a credential reference.");
      }

      onVerified(
        payload.verification.credentialId,
        `Manually verified (${regulator}) on ${new Date().toLocaleDateString()}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the manual check.");
    } finally {
      setSavingManual(false);
    }
  };

  const tone = result ? statusTone(result.status) : "";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div className="my-8 w-full max-w-2xl space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <BadgeCheck className="h-4 w-4 text-teal-700" />
              Verify professional registration
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {roleName} is a regulated clinical role. Check the applicant&apos;s registration
              before an invitation is issued.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100"
          >
            Close
          </button>
        </header>

        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="verify-regulator" className="mb-1 block text-xs font-medium text-slate-700">
              Regulator *
            </label>
            <select
              id="verify-regulator"
              value={regulator}
              onChange={(event) => setRegulator(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              {regulators.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.shortName} — {item.professions[0]}
                </option>
              ))}
            </select>
            {suggested && suggested.code === regulator && (
              <p className="mt-1 text-[11px] text-slate-500">{suggested.name}</p>
            )}
          </div>

          <div>
            <label htmlFor="verify-number" className="mb-1 block text-xs font-medium text-slate-700">
              Registration number *
            </label>
            <input
              id="verify-number"
              value={registrationNumber}
              onChange={(event) => setRegistrationNumber(event.target.value.toUpperCase())}
              placeholder="e.g. MED12345"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              The number on the practitioner&apos;s registration certificate, not the licence number.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runCheck()}
            disabled={checking || !regulator || registrationNumber.trim().length < 3}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
            {checking ? "Checking registry…" : "Check registration"}
          </button>

          <button
            type="button"
            onClick={() => setManualOpen((open) => !open)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Building2 className="h-4 w-4" />
            Record a manual check instead
          </button>
        </div>

        {result && (
          <section className={`space-y-3 rounded-lg border p-3 ${tone}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold">{STATUS_LABEL[result.status] ?? result.status}</span>
              {result.simulated && (
                <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">
                  SIMULATED — test fixture, not a regulator
                </span>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] sm:grid-cols-3">
              <div>
                <dt className="text-slate-500">Registered name</dt>
                <dd className="font-semibold text-slate-900">{result.record.fullName ?? "Not returned"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Registration</dt>
                <dd className="font-mono text-slate-900">{result.record.registrationNumber ?? "Not returned"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Registration status</dt>
                <dd className="text-slate-900">{result.record.registrationStatus ?? "Not returned"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Licence</dt>
                <dd className="text-slate-900">{result.record.licenceStatus ?? "Not returned"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Licence expiry</dt>
                <dd className="text-slate-900">{result.record.licenceExpiry ?? "Not returned"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Profession</dt>
                <dd className="text-slate-900">{result.record.profession ?? "Not returned"}</dd>
              </div>
            </dl>

            {result.warnings.length > 0 && (
              <ul className="space-y-1 border-t border-black/5 pt-2 text-[11px]">
                {result.warnings.map((warning, index) => (
                  <li key={index} className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-[10px] text-slate-600">
              Response mapping is {result.mapping}; only fields the registry actually returned are
              shown. Source: Health Worker Registry, {result.regulator}.
            </p>

            {result.invitable && result.credentialId ? (
              <button
                type="button"
                onClick={() =>
                  onVerified(
                    result.credentialId as number,
                    `${STATUS_LABEL[result.status] ?? result.status} — ${result.regulator} ${result.registrationNumber}`,
                  )
                }
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800"
              >
                <CheckCircle2 className="h-4 w-4" />
                Use this verification and continue
              </button>
            ) : (
              <p className="flex items-start gap-1.5 text-[11px] font-semibold">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  This result cannot be used to issue an invitation. Resolve it below, or record a
                  manual check against the regulator&apos;s own record.
                </span>
              </p>
            )}
          </section>
        )}

        {manualOpen && (
          <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div>
              <h4 className="text-xs font-bold text-slate-900">Manual verification</h4>
              <p className="mt-1 text-[11px] text-slate-600">
                Use the regulator&apos;s own register or written confirmation. This is recorded as a
                manual check by you, with today&apos;s date — it is never described as an automated
                API verification.
              </p>
            </div>

            <div>
              <label htmlFor="manual-source" className="mb-1 block text-[11px] font-medium text-slate-700">
                Where the check was made *
              </label>
              <input
                id="manual-source"
                value={manualSource}
                onChange={(event) => setManualSource(event.target.value)}
                placeholder="e.g. KMPDC online register search, 21 Oct 2026"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label htmlFor="manual-notes" className="mb-1 block text-[11px] font-medium text-slate-700">
                Notes (optional)
              </label>
              <input
                id="manual-notes"
                value={manualNotes}
                onChange={(event) => setManualNotes(event.target.value)}
                placeholder="Reference number, letter date, or what you confirmed"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              />
            </div>

            <button
              type="button"
              onClick={() => void saveManual()}
              disabled={savingManual || manualSource.trim().length < 5 || registrationNumber.trim().length < 3}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white hover:bg-slate-900 disabled:opacity-50"
            >
              {savingManual ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              {savingManual ? "Recording…" : "Record manual verification"}
            </button>
          </section>
        )}
      </div>
    </div>
  );
};
