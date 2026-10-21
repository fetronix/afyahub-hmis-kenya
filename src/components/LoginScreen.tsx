import React, { useState } from 'react';

import {
  Eye,
  EyeOff,
  LockKeyhole,
  UserRound,
  ShieldCheck,
  HeartPulse,
  ArrowRight,
  Loader2,
} from 'lucide-react';

import { useHmis } from '../context/HmisContext.tsx';

/*
|--------------------------------------------------------------------------
| JaliCare Logo
|--------------------------------------------------------------------------
|
| Recommended:
|
| public/logo.jpg
|
|--------------------------------------------------------------------------
*/

const LOGO_PATH = '/logo.jpg';

/*
|--------------------------------------------------------------------------
| Login Screen
|--------------------------------------------------------------------------
*/

export const LoginScreen: React.FC = () => {
  const { login } = useHmis();

  const [identifier, setIdentifier] =
    useState('');

  const [password, setPassword] =
    useState('');

  const [showPassword, setShowPassword] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState('');

  const [infoMessage, setInfoMessage] =
    useState('');

  /*
   * The logo is a local file; in a fresh checkout it may be absent.
   * Track that once so the brand panel falls back to a typographic
   * wordmark instead of an empty gap.
   */
  const [logoFailed, setLogoFailed] =
    useState(false);

  /*
  |--------------------------------------------------------------------------
  | Submit
  |--------------------------------------------------------------------------
  */

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (loading) {
      return;
    }

    setError('');
    setInfoMessage('');

    const cleanIdentifier =
      identifier.trim();

    if (!cleanIdentifier) {
      setError(
        'Enter your username or email address.'
      );
      return;
    }

    if (!password) {
      setError(
        'Enter your password.'
      );
      return;
    }

    setLoading(true);

    try {
      const result = await login(
        cleanIdentifier,
        password
      );

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

  /*
  |--------------------------------------------------------------------------
  | Render
  |--------------------------------------------------------------------------
  */

  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas">
      {/* A warm wash, not a light show: two soft fields of colour. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-48 -top-48 h-[38rem] w-[38rem] rounded-full bg-pine-100/60 blur-3xl" />
        <div className="absolute -right-40 top-1/3 h-[30rem] w-[30rem] rounded-full bg-clay-100/50 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1240px] items-center justify-center px-4 py-6 sm:px-6 lg:py-10">
        <div className="grid w-full overflow-hidden rounded-[28px] border border-hair bg-surface shadow-lift lg:grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)]">
          {/*
            Brand panel. Deep pine, a faint set of rings, and the
            promise the product is making. No motion: a clinic at
            7 a.m. does not need a light show.
          */}
          <section className="relative hidden flex-col justify-between overflow-hidden bg-pine-900 p-10 text-white lg:flex xl:p-12">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full border border-white/10" />
              <div className="absolute -right-10 top-10 h-56 w-56 rounded-full border border-white/10" />
              <div className="absolute -bottom-32 -left-24 h-96 w-96 rounded-full border border-white/[0.07]" />
              <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-pine-950/60 to-transparent" />
            </div>

            <div className="relative z-10">
              {!logoFailed ? (
                <img
                  src={LOGO_PATH}
                  alt="JaliCare HMIS"
                  className="mb-8 h-auto max-h-[104px] w-auto max-w-[240px] object-contain"
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <div className="mb-8 flex items-center gap-2.5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 font-display text-lg">
                    J
                  </span>
                  <span className="font-display text-xl tracking-tight">
                    JaliCare
                  </span>
                </div>
              )}

              <p className="text-2xs font-semibold uppercase tracking-[0.22em] text-pine-200">
                Kenya Health Information System
              </p>

              <h1 className="mt-5 font-display text-[2.6rem] leading-[1.08] tracking-tight text-white">
                Care that stays
                <br />
                with the patient.
              </h1>

              <p className="mt-5 max-w-sm text-sm leading-relaxed text-pine-100/90">
                One clinical record from the reception desk to the ward:
                registration, triage, consultation, laboratory, pharmacy,
                billing and follow-up in a single secure system.
              </p>

              <div className="mt-8 h-px w-16 bg-clay-400/70" />

              <ul className="mt-6 space-y-3 text-xs text-pine-100/85">
                <li className="flex items-center gap-2.5">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-clay-300" />
                  Protected sessions, audited access
                </li>
                <li className="flex items-center gap-2.5">
                  <HeartPulse className="h-4 w-4 shrink-0 text-clay-300" />
                  Every stage billed against the same encounter
                </li>
                <li className="flex items-center gap-2.5">
                  <LockKeyhole className="h-4 w-4 shrink-0 text-clay-300" />
                  Tenant and facility isolation by design
                </li>
              </ul>
            </div>

            <div className="relative z-10 mt-10 flex items-center justify-between border-t border-white/10 pt-5 text-2xs text-pine-200/80">
              <span>JaliCare HMIS</span>
              <span className="flex items-center gap-1.5">
                DHA ready
                <span className="h-1 w-1 rounded-full bg-clay-400" />
                FHIR R4
              </span>
            </div>
          </section>

          {/* Sign-in panel */}
          <section className="flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-12 xl:px-16">
            <div className="mx-auto w-full max-w-[400px]">
              {/* Small screens lose the brand panel, not the brand. */}
              <div className="mb-8 flex items-center gap-2.5 lg:hidden">
                {!logoFailed ? (
                  <img
                    src={LOGO_PATH}
                    alt="JaliCare HMIS"
                    className="h-auto max-h-12 w-auto max-w-[180px] object-contain"
                    onError={() => setLogoFailed(true)}
                  />
                ) : (
                  <>
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pine-800 font-display text-base text-white">
                      J
                    </span>
                    <span className="font-display text-lg text-ink">JaliCare</span>
                  </>
                )}
              </div>

              <p className="eyebrow">Staff portal</p>
              <h2 className="mt-2 font-display text-[2rem] leading-tight tracking-tight text-ink">
                Welcome back.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Sign in with the credentials your administrator issued to you.
              </p>

              {error && (
                <div
                  role="alert"
                  className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-relaxed text-rose-800"
                >
                  {error}
                </div>
              )}

              {infoMessage && (
                <div
                  role="status"
                  className="mt-6 rounded-xl border border-pine-200 bg-pine-50 px-4 py-3 text-sm leading-relaxed text-pine-900"
                >
                  {infoMessage}
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate className="mt-7 space-y-5">
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
                  <label htmlFor="password" className="field-label">
                    Password
                  </label>
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
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition-colors hover:text-pine-700 disabled:opacity-50"
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
                  className="btn-primary group h-11 w-full"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-8 flex items-start gap-3 rounded-xl border border-hair bg-slate-50/70 px-4 py-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-pine-700" />
                <p className="text-xs leading-relaxed text-muted">
                  <span className="font-semibold text-ink-soft">
                    Authorized personnel only.
                  </span>{' '}
                  Access is recorded for security and audit purposes. Do not
                  share your password or leave a session unattended.
                </p>
              </div>

              <p className="mt-8 text-center text-2xs text-muted">
                © {new Date().getFullYear()} JaliCare HMIS
                <span className="mx-2 text-clay-500">·</span>
                Secure healthcare operations
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
};
