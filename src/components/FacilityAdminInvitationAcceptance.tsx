import React, { useEffect, useState } from "react";
import { CheckCircle2, HeartPulse, Loader2 } from "lucide-react";

interface Invitation {
  fullName: string;
  email: string;
  designation?: string | null;
  facilityName?: string | null;
  expiresAt?: string | null;
}

interface ApiResponse {
  success?: boolean;
  invitation?: Invitation;
  message?: string;
  error?: string;
}

export default function FacilityAdminInvitationAcceptance() {
  const [token] = useState(
    () => new URLSearchParams(window.location.search).get("token") ?? ""
  );
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function validate() {
      if (!token) {
        setError("The invitation link has no token. Please request a new invitation.");
        setChecking(false);
        return;
      }

      try {
        const response = await fetch(
          `/api/auth/facility-admin-invitations/validate?token=${encodeURIComponent(token)}`,
          { headers: { Accept: "application/json" } }
        );
        const data = (await response.json().catch(() => ({}))) as ApiResponse;

        if (!response.ok || !data.success || !data.invitation) {
          throw new Error(
            data.message || data.error || "This invitation is invalid, expired, or already used."
          );
        }
        if (active) setInvitation(data.invitation);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Unable to validate the invitation.");
        }
      } finally {
        if (active) setChecking(false);
      }
    }

    void validate();
    return () => { active = false; };
  }, [token]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(normalizedUsername)) {
      setError("Use 3–50 characters: lowercase letters, numbers, dots, underscores, or hyphens.");
      return;
    }
    if (password.length < 12 || password.length > 256) {
      setError("Your password must be at least 12 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/facility-admin-invitations/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          token,
          username: normalizedUsername,
          password,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Account creation failed. Check the invitation or contact your platform administrator."
        );
      }

      setSuccess(true);
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account creation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 flex items-center justify-center">
      <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <header className="bg-blue-950 px-6 py-7 text-white sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-600">
              <HeartPulse className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold">JaliCare HMIS</h1>
              <p className="text-sm text-blue-200">Facility administrator setup</p>
            </div>
          </div>
          <h2 className="mt-6 text-2xl font-bold">
            {success ? "Account created" : "Accept your invitation"}
          </h2>
          <p className="mt-2 text-sm text-blue-100">
            {success
              ? "Your facility administrator account has been created."
              : "Choose your own username and password to get started."}
          </p>
        </header>

        <div className="p-6 sm:p-8">
          {checking ? (
            <div className="flex items-center justify-center gap-3 py-10 text-slate-600">
              <Loader2 className="h-5 w-5 animate-spin" /> Checking invitation…
            </div>
          ) : success ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-green-600" />
              <h3 className="mt-4 text-lg font-bold">You're ready to sign in</h3>
              <p className="mt-2 text-sm text-slate-600">
                Return to JaliCare and sign in using your new username and password.
              </p>
              <button
                type="button"
                onClick={() => window.location.assign("/")}
                className="mt-6 w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white hover:bg-blue-800"
              >
                Go to sign in
              </button>
            </div>
          ) : invitation ? (
            <>
              <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
                <p className="font-semibold text-blue-950">{invitation.fullName}</p>
                <p className="mt-1 break-all text-sm text-slate-600">{invitation.email}</p>
                {invitation.facilityName && (
                  <p className="mt-3 text-sm text-slate-700">Facility: {invitation.facilityName}</p>
                )}
                {invitation.designation && (
                  <p className="mt-1 text-sm text-slate-700">Role: {invitation.designation}</p>
                )}
                {invitation.expiresAt && (
                  <p className="mt-2 text-xs text-slate-500">
                    Expires: {new Date(invitation.expiresAt).toLocaleString()}
                  </p>
                )}
              </div>

              {error && (
                <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="facility-admin-username" className="mb-2 block text-sm font-semibold">
                    Choose a username
                  </label>
                  <input id="facility-admin-username" autoComplete="username"
                    value={username} onChange={(e) => setUsername(e.target.value)}
                    minLength={3} maxLength={50} required disabled={submitting}
                    className="h-12 w-full rounded-lg border border-slate-300 px-4 text-sm"
                    placeholder="e.g. jane.mwangi" />
                </div>
                <div>
                  <label htmlFor="facility-admin-password" className="mb-2 block text-sm font-semibold">
                    Create password
                  </label>
                  <input id="facility-admin-password" type="password" autoComplete="new-password"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    minLength={12} maxLength={256} required disabled={submitting}
                    className="h-12 w-full rounded-lg border border-slate-300 px-4 text-sm"
                    placeholder="At least 12 characters" />
                </div>
                <div>
                  <label htmlFor="facility-admin-confirm-password" className="mb-2 block text-sm font-semibold">
                    Confirm password
                  </label>
                  <input id="facility-admin-confirm-password" type="password" autoComplete="new-password"
                    value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={12} maxLength={256} required disabled={submitting}
                    className="h-12 w-full rounded-lg border border-slate-300 px-4 text-sm" />
                </div>
                <button type="submit" disabled={submitting}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submitting ? "Creating account…" : "Create administrator account"}
                </button>
              </form>
            </>
          ) : (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {error || "This invitation cannot be used."}
              <p className="mt-2">Contact your platform administrator to request a new invitation.</p>
              <button type="button" onClick={() => window.location.assign("/")}
                className="mt-4 rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white">
                Return to sign in
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
