import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  HeartPulse,
  Loader2,
  ShieldCheck,
} from "lucide-react";

interface Invitation {
  fullName: string;
  email: string;
  facilityName?: string;
  roleName?: string;
  designation?: string | null;
  expiresAt?: string;
}

type ApiResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  code?: string;
  invitation?: Invitation;
};

export const StaffInvitationAcceptance: React.FC = () => {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let active = true;

    const validate = async () => {
      if (!token) {
        setError("This invitation link is missing its token. Ask your facility administrator for a new invitation.");
        setChecking(false);
        return;
      }

      try {
        const response = await fetch(
          `/api/auth/staff-invitations/validate?token=${encodeURIComponent(token)}`,
          { headers: { Accept: "application/json" } },
        );

        const data = (await response.json().catch(() => ({}))) as ApiResponse;

        if (!response.ok || !data.success || !data.invitation) {
          throw new Error(data.message || data.error || "This invitation is invalid, expired, revoked, or already used.");
        }

        if (active) {
          setInvitation(data.invitation);
          const namePart = data.invitation.fullName
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ".")
            .replace(/^\.+|\.+$/g, "")
            .slice(0, 30);

          setUsername(namePart.length >= 3 ? namePart : "");
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Unable to validate this invitation.");
        }
      } finally {
        if (active) setChecking(false);
      }
    };

    void validate();

    return () => {
      active = false;
    };
  }, [token]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const normalizedUsername = username.trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(normalizedUsername)) {
      setError("Use 3–40 characters for the username: lowercase letters, numbers, dots, underscores, or hyphens.");
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
      const response = await fetch("/api/auth/staff-invitations/accept", {
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
        throw new Error(data.message || data.error || "Your account could not be created. Check the invitation or contact your administrator.");
      }

      setSuccess(true);
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account creation failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-canvas px-4 py-10 sm:px-6 flex items-center justify-center">
      <section className="w-full max-w-lg overflow-hidden rounded-card border border-hair bg-surface shadow-lift">
        <div className="bg-navy-900 px-6 py-7 text-white sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ember-500">
              <HeartPulse className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-display text-xl">JaliCare HMIS</h1>
              <p className="text-sm text-navy-200">Secure staff account setup</p>
            </div>
          </div>
          <h2 className="mt-7 font-display text-2xl">
            {success ? "Account created" : "Accept your invitation"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-navy-100">
            {success
              ? "Your staff account has been created successfully."
              : "Set up your username and password to access your healthcare workspace."}
          </p>
        </div>

        <div className="p-6 sm:p-8">
          {checking ? (
            <div className="flex items-center justify-center gap-3 py-12 text-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
              Checking your invitation…
            </div>
          ) : success ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
              <h3 className="mt-4 font-display text-xl text-ink">You're ready to sign in</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Return to the JaliCare staff portal and sign in with your new username and password.
              </p>
              <button
                type="button"
                onClick={() => window.location.assign("/")}
                className="btn-primary mt-6 h-12 w-full"
              >
                Go to sign in
              </button>
            </div>
          ) : invitation ? (
            <>
              <div className="mb-6 rounded-xl border border-brand-100 bg-brand-50 p-4">
                <div className="text-sm font-semibold text-brand-900">{invitation.fullName}</div>
                <div className="mt-1 break-all text-sm text-muted">{invitation.email}</div>
                {(invitation.facilityName || invitation.roleName || invitation.designation) && (
                  <div className="mt-3 space-y-1 text-xs text-muted">
                    {invitation.facilityName && <p>Facility: {invitation.facilityName}</p>}
                    {invitation.roleName && <p>Role: {invitation.roleName}</p>}
                    {invitation.designation && <p>Designation: {invitation.designation}</p>}
                  </div>
                )}
              </div>

              {error && (
                <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-relaxed text-rose-800">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="staff-username" className="field-label">
                    Choose a username
                  </label>
                  <input
                    id="staff-username"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                    minLength={3}
                    maxLength={40}
                    disabled={submitting}
                    className="field-input h-12"
                    placeholder="e.g. jane.mwangi"
                  />
                </div>

                <div>
                  <label htmlFor="staff-password" className="field-label">
                    Create password
                  </label>
                  <div className="relative">
                    <input
                      id="staff-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      minLength={12}
                      maxLength={256}
                      disabled={submitting}
                      className="field-input h-12 pr-12"
                      placeholder="At least 12 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-blue-700"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="staff-confirm-password" className="field-label">
                    Confirm password
                  </label>
                  <input
                    id="staff-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                    minLength={12}
                    maxLength={256}
                    disabled={submitting}
                    className="field-input h-12"
                    placeholder="Enter the same password again"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary h-12 w-full"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating account…
                    </>
                  ) : (
                    "Create staff account"
                  )}
                </button>
              </form>

              <div className="mt-6 flex items-start gap-3 border-t border-hair pt-5">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
                <p className="text-xs leading-relaxed text-slate-500">
                  Your invitation is intended for you alone. Choose a strong password and keep your sign-in details private.
                </p>
              </div>
            </>
          ) : (
            <div>
              <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-relaxed text-rose-800">
                {error || "This invitation could not be verified."}
              </div>
              <button
                type="button"
                onClick={() => window.location.assign("/")}
                className="btn-quiet mt-5 w-full py-3 text-sm"
              >
                <ArrowLeft className="h-4 w-4" />
                Return to sign in
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
};

export default StaffInvitationAcceptance;
