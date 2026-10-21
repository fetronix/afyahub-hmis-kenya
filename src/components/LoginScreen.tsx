import React, { useState } from 'react';

import {
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
  HeartPulse,
  ArrowRight,
  Loader2,
  UserRound,
  LifeBuoy,
  ChevronDown,
  ServerCog,
} from 'lucide-react';

import { useHmis } from '../context/HmisContext.tsx';

/*
|--------------------------------------------------------------------------
| JaliCare Logo
|--------------------------------------------------------------------------
|
| Recommended: public/logo.jpg
|
| The file has a white background, so it is always placed on a white
| tile — never directly on the navy panel.
|
*/

const LOGO_PATH = '/logo.jpg';

/*
|--------------------------------------------------------------------------
| Login Screen
|--------------------------------------------------------------------------
*/

export const LoginScreen: React.FC = () => {
  const { login } = useHmis();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  /*
   * The logo is a local file; in a fresh checkout it may be absent.
   * Track that once so the panel falls back to a typographic wordmark.
   */
  const [logoFailed, setLogoFailed] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Submit
  |--------------------------------------------------------------------------
  */

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (loading) {
      return;
    }

    setError('');
    setInfoMessage('');

    const cleanIdentifier = identifier.trim();

    if (!cleanIdentifier) {
      setError('Enter your username or email address.');
      return;
    }

    if (!password) {
      setError('Enter your password.');
      return;
    }

    setLoading(true);

    try {
      const result = await login(cleanIdentifier, password);

      /*
      |--------------------------------------------------------------------------
      | MFA
      |--------------------------------------------------------------------------
      */

      if (result.requiresMfa) {
        setInfoMessage(
          'Additional security verification is required. MFA verification will be available in the next authentication step.'
        );

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | Password Change
      |--------------------------------------------------------------------------
      */

      if (result.requiresPasswordChange) {
        setInfoMessage(
          'Your account requires a password change before you can continue.'
        );

        return;
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to sign in. Please try again.';

      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const brandMark = (
    <div className="flex items-center gap-3">
      {!logoFailed ? (
        <img
          src={LOGO_PATH}
          alt="JaliCare"
          className="h-auto max-h-[54px] w-auto max-w-[190px] object-contain"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <>
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-700 text-base font-bold text-white">
            J
          </span>
          <span className="text-xl font-bold tracking-tight text-navy-900">
            Jali<span className="text-ember-600">Care</span>
          </span>
        </>
      )}
    </div>
  );

  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas">
      {/* Faint clinical grid; decoration only, nothing is measured here. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(35,132,201,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(35,132,201,0.06) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse at 30% 20%, black 45%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 30% 20%, black 45%, transparent 78%)',
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1180px] items-center justify-center px-4 py-6 sm:px-6 lg:py-10">
        <div className="grid w-full overflow-hidden rounded-2xl border border-hair bg-surface shadow-lift lg:grid-cols-[1.02fr_1fr]">
          {/* ---------------------------------------------------------
              Brand panel
          --------------------------------------------------------- */}
          <section className="relative hidden flex-col justify-between overflow-hidden bg-navy-900 p-10 text-white lg:flex xl:p-12">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <svg
                viewBox="0 0 400 400"
                className="absolute -right-24 -top-24 h-[30rem] w-[30rem] text-white/[0.06]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              >
                <circle cx="200" cy="200" r="196" />
                <circle cx="200" cy="200" r="150" />
                <circle cx="200" cy="200" r="104" />
              </svg>
              <svg
                viewBox="0 0 400 400"
                className="absolute -bottom-28 -left-32 h-[26rem] w-[26rem]"
                fill="none"
              >
                <path
                  d="M20 280 C 110 280, 120 120, 200 120 S 300 230, 380 150"
                  stroke="url(#emberArc)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient id="emberArc" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#f97316" stopOpacity="0" />
                    <stop offset="45%" stopColor="#fb923c" stopOpacity="0.75" />
                    <stop offset="100%" stopColor="#f97316" stopOpacity="0.1" />
                  </linearGradient>
                </defs>
              </svg>
            </div>

            <div className="relative z-10">
              <div className="inline-flex rounded-xl bg-white p-3 shadow-sm">
                {brandMark}
              </div>

              <p className="mt-9 text-2xs font-semibold uppercase tracking-[0.2em] text-brand-300">
                Kenya Health Information System
              </p>

              <h1 className="mt-4 max-w-sm text-[2.15rem] font-bold leading-[1.15] tracking-tight text-white">
                One record for every step of the visit.
              </h1>

              <p className="mt-4 max-w-sm text-sm leading-relaxed text-navy-100/80">
                Registration, triage, consultation, laboratory, pharmacy,
                billing and follow-up — held together by the same encounter,
                in one secure system for your facility.
              </p>

              <div className="mt-8 h-1 w-14 rounded-full bg-ember-500" />

              <ul className="mt-7 space-y-3.5 text-xs text-navy-100/85">
                <li className="flex items-start gap-2.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
                  <span>Protected sessions with an audited access trail</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <HeartPulse className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
                  <span>Every stage billed against the same encounter</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
                  <span>Tenant and facility isolation by design</span>
                </li>
              </ul>
            </div>

            <div className="relative z-10 mt-10 flex items-center justify-between border-t border-white/10 pt-5 text-2xs text-navy-200/80">
              <span>JaliCare HMIS</span>
              <span className="flex items-center gap-1.5">
                DHA ready
                <span className="h-1 w-1 rounded-full bg-ember-500" />
                FHIR R4
              </span>
            </div>
          </section>

          {/* ---------------------------------------------------------
              Sign-in panel
          --------------------------------------------------------- */}
          <section className="flex flex-col justify-center px-6 py-9 sm:px-10 lg:px-12 xl:px-14">
            <div className="mx-auto w-full max-w-[406px]">
              {/* Small screens lose the brand panel, not the brand. */}
              <div className="mb-7 flex items-center justify-between lg:hidden">
                {brandMark}
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-ember-500" />
                <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-brand-700">
                  Staff sign-in
                </p>
              </div>

              <h2 className="mt-2.5 text-[1.75rem] font-bold leading-tight tracking-tight text-navy-900">
                Welcome back
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                Sign in with the credentials your administrator issued to you.
              </p>

              {error && (
                <div
                  role="alert"
                  className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-relaxed text-rose-800"
                >
                  {error}
                </div>
              )}

              {infoMessage && (
                <div
                  role="status"
                  className="mt-5 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm leading-relaxed text-brand-900"
                >
                  {infoMessage}
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
                <div>
                  <label htmlFor="identifier" className="field-label">
                    Username or email
                  </label>
                  <div className="relative">
                    <UserRound
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      id="identifier"
                      name="identifier"
                      type="text"
                      autoComplete="username"
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      disabled={loading}
                      placeholder="e.g. jane.wanjiku"
                      className="field-input pl-10"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="password" className="field-label">
                      Password
                    </label>
                  </div>

                  <div className="relative">
                    <LockKeyhole
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={loading}
                      placeholder="Enter your password"
                      className="field-input pl-10 pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={loading}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-700 disabled:opacity-50"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-accent group h-11 w-full text-[15px]"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </form>

              {/* Honest help: there is no self-service reset in this build. */}
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => setHelpOpen((open) => !open)}
                  aria-expanded={helpOpen}
                  className="flex w-full items-center justify-between rounded-lg border border-hair bg-slate-50/70 px-3.5 py-2.5 text-left text-xs font-semibold text-ink-soft transition-colors hover:border-brand-200 hover:text-brand-800"
                >
                  <span className="flex items-center gap-2">
                    <LifeBuoy className="h-3.5 w-3.5 text-brand-600" />
                    Trouble signing in?
                  </span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-slate-400 transition-transform ${
                      helpOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {helpOpen && (
                  <div className="mt-2 space-y-2 rounded-lg border border-hair bg-white px-3.5 py-3 text-xs leading-relaxed text-muted">
                    <p>
                      Check that Caps Lock is off and that you are using the
                      username from your invitation, not your email, unless
                      your email is the username.
                    </p>
                    <p className="flex items-start gap-2">
                      <ServerCog className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span>
                        <span className="font-semibold text-ink-soft">
                          Password reset is not self-service in this build.
                        </span>{' '}
                        Ask your system administrator to reset the password on
                        your account.
                      </span>
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-hair bg-slate-50/60 px-3.5 py-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
                <p className="text-xs leading-relaxed text-muted">
                  <span className="font-semibold text-ink-soft">
                    Authorized personnel only.
                  </span>{' '}
                  Access is recorded for security and audit purposes. Do not
                  share your password or leave a session unattended.
                </p>
              </div>

              <p className="mt-7 text-center text-2xs text-muted">
                © {new Date().getFullYear()} JaliCare HMIS
                <span className="mx-2 text-slate-300">·</span>
                Healthcare. Empowered.
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
};
