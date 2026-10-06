import React, { useState } from 'react';

import {
  Eye,
  EyeOff,
  LockKeyhole,
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
    <main
      className="
        min-h-screen
        bg-slate-100
        flex
        items-center
        justify-center
        p-4
        sm:p-6
        relative
        overflow-hidden
      "
    >

      {/* ================================================================
          PAGE BACKGROUND ACCENTS
      ================================================================= */}

      <div
        className="
          absolute
          -top-40
          -left-40
          w-96
          h-96
          rounded-full
          bg-blue-100
          blur-3xl
          opacity-60
          pointer-events-none
        "
      />

      <div
        className="
          absolute
          -bottom-40
          -right-40
          w-96
          h-96
          rounded-full
          bg-orange-100
          blur-3xl
          opacity-50
          pointer-events-none
        "
      />

      {/* ================================================================
          MAIN CARD
      ================================================================= */}

      <div
        className="
          relative
          z-10
          w-full
          max-w-6xl
          min-h-[650px]
          bg-white
          rounded-2xl
          shadow-2xl
          border
          border-slate-200
          overflow-hidden
          flex
          flex-col
          md:flex-row
        "
      >

        {/* ================================================================
            BRANDING PANEL
        ================================================================= */}

        <section
          className="
            relative
            md:w-[48%]
            bg-blue-900
            text-white
            overflow-hidden
            flex
            flex-col
            justify-between
            p-7
            sm:p-10
            md:p-12
            lg:p-14
          "
        >

          {/* ==============================================================
              BACKGROUND DECORATIONS
          ============================================================== */}

          <div
            className="
              absolute
              -top-32
              -right-32
              w-96
              h-96
              rounded-full
              bg-blue-800
              opacity-70
              animate-[float_8s_ease-in-out_infinite]
            "
          />

          <div
            className="
              absolute
              -bottom-40
              -left-32
              w-[28rem]
              h-[28rem]
              rounded-full
              bg-blue-950
              opacity-80
              animate-[floatReverse_10s_ease-in-out_infinite]
            "
          />

          <div
            className="
              absolute
              top-1/2
              right-[-110px]
              w-64
              h-64
              rounded-full
              border
              border-blue-700
              opacity-40
              animate-[spin_30s_linear_infinite]
            "
          />

          {/* Orange accent line */}

          <div
            className="
              absolute
              left-0
              top-0
              bottom-0
              w-1
              bg-orange-600
            "
          />

          {/* ==============================================================
              BRAND
          ============================================================== */}

          <div className="relative z-10">

            {/* ============================================================
                LOGO — NO CONTAINER
            ============================================================= */}

            <div
              className="
                relative
                inline-block
                animate-[logoFloat_4s_ease-in-out_infinite]
              "
            >

              {/* Soft logo glow */}

              <div
                className="
                  absolute
                  inset-0
                  bg-white/20
                  blur-2xl
                  rounded-full
                  scale-75
                  animate-pulse
                "
              />

              {/* Shine */}

              <div
                className="
                  absolute
                  top-0
                  bottom-0
                  -left-1/2
                  w-1/3
                  skew-x-[-20deg]
                  bg-gradient-to-r
                  from-transparent
                  via-white/50
                  to-transparent
                  animate-[logoShine_5s_ease-in-out_infinite]
                  z-20
                  pointer-events-none
                "
              />

              <img
                src={LOGO_PATH}
                alt="JaliCare HMIS"
                className="
                  relative
                  z-10
                  block
                  w-auto
                  h-auto
                  max-w-[320px]
                  max-h-[140px]
                  object-contain
                  drop-shadow-[0_8px_20px_rgba(0,0,0,0.25)]
                  transition-transform
                  duration-500
                  hover:scale-105
                "
                onError={(event) => {
                  event.currentTarget.style.display =
                    'none';
                }}
              />

            </div>

            {/* ============================================================
                BRAND BADGE
            ============================================================= */}

            <div className="mt-8">

              <div
                className="
                  inline-flex
                  items-center
                  gap-2
                  px-3
                  py-1.5
                  rounded-full
                  bg-blue-800
                  border
                  border-blue-700
                  text-blue-100
                  text-xs
                  font-medium
                "
              >

                <HeartPulse
                  className="
                    w-3.5
                    h-3.5
                    text-orange-400
                  "
                />

                Kenya Healthcare
                Information System

              </div>

              <h1
                className="
                  mt-6
                  text-3xl
                  sm:text-4xl
                  font-bold
                  tracking-tight
                  leading-tight
                "
              >
                Healthcare
                <br />
                managed
                <br />

                <span className="text-orange-400">
                  intelligently.
                </span>

              </h1>

              <p
                className="
                  mt-5
                  text-sm
                  sm:text-base
                  text-blue-100
                  leading-relaxed
                  max-w-md
                "
              >
                JaliCare brings clinical care,
                patient management, pharmacy,
                laboratory, finance,
                interoperability and
                administration into one
                secure healthcare platform.
              </p>

            </div>

          </div>

          {/* ==============================================================
              SECURITY INDICATORS
          ============================================================== */}

          <div
            className="
              relative
              z-10
              mt-10
              grid
              grid-cols-1
              sm:grid-cols-2
              md:grid-cols-1
              gap-3
            "
          >

            {/* Secure Access */}

            <div
              className="
                flex
                items-center
                gap-3
                rounded-xl
                bg-blue-800/60
                border
                border-blue-700
                px-4
                py-3
                transition-all
                duration-300
                hover:bg-blue-800
                hover:border-orange-500/50
                hover:-translate-y-0.5
              "
            >

              <div
                className="
                  w-9
                  h-9
                  rounded-lg
                  bg-orange-600
                  flex
                  items-center
                  justify-center
                  shrink-0
                  shadow-lg
                "
              >
                <ShieldCheck className="w-5 h-5" />
              </div>

              <div>

                <div
                  className="
                    text-sm
                    font-semibold
                  "
                >
                  Secure Access
                </div>

                <div
                  className="
                    text-xs
                    text-blue-200
                  "
                >
                  Protected healthcare environment
                </div>

              </div>

            </div>

            {/* Protected Sessions */}

            <div
              className="
                flex
                items-center
                gap-3
                rounded-xl
                bg-blue-800/60
                border
                border-blue-700
                px-4
                py-3
                transition-all
                duration-300
                hover:bg-blue-800
                hover:border-orange-500/50
                hover:-translate-y-0.5
              "
            >

              <div
                className="
                  w-9
                  h-9
                  rounded-lg
                  bg-orange-600
                  flex
                  items-center
                  justify-center
                  shrink-0
                  shadow-lg
                "
              >
                <LockKeyhole className="w-5 h-5" />
              </div>

              <div>

                <div
                  className="
                    text-sm
                    font-semibold
                  "
                >
                  Protected Sessions
                </div>

                <div
                  className="
                    text-xs
                    text-blue-200
                  "
                >
                  Authenticated staff access
                </div>

              </div>

            </div>

          </div>

          {/* ==============================================================
              FOOTER
          ============================================================== */}

          <div
            className="
              relative
              z-10
              mt-8
              pt-5
              border-t
              border-blue-800
              text-xs
              text-blue-300
            "
          >

            JaliCare HMIS

            <span className="mx-2">
              ·
            </span>

            <span className="text-orange-400">
              Secure Healthcare Operations
            </span>

          </div>

        </section>

        {/* ================================================================
            LOGIN PANEL
        ================================================================= */}

        <section
          className="
            relative
            flex-1
            flex
            items-center
            justify-center
            bg-white
            px-6
            py-10
            sm:px-10
            md:px-12
            lg:px-16
            overflow-hidden
          "
        >

          {/* ==============================================================
              FORM SIDE DECORATION
          ============================================================== */}

          <div
            className="
              absolute
              top-0
              left-0
              right-0
              h-1
              bg-gradient-to-r
              from-blue-700
              via-blue-600
              to-orange-600
            "
          />

          <div
            className="
              absolute
              bottom-0
              left-0
              w-32
              h-32
              border-l-4
              border-b-4
              border-orange-500/20
              rounded-bl-3xl
              pointer-events-none
            "
          />

          <div
            className="
              absolute
              top-0
              right-0
              w-32
              h-32
              border-r-4
              border-t-4
              border-blue-600/20
              rounded-tr-3xl
              pointer-events-none
            "
          />

          <div className="relative z-10 w-full max-w-md">

            {/* ============================================================
                MOBILE LOGO
            ============================================================= */}

            <div
              className="
                flex
                justify-center
                mb-8
                md:hidden
              "
            >

              <img
                src={LOGO_PATH}
                alt="JaliCare HMIS"
                className="
                  max-w-[260px]
                  max-h-[100px]
                  object-contain
                  animate-[logoFloat_4s_ease-in-out_infinite]
                  drop-shadow-md
                "
              />

            </div>

            {/* ============================================================
                HEADING
            ============================================================= */}

            <div className="mb-8">

              <div
                className="
                  flex
                  items-center
                  gap-2
                  mb-3
                "
              >

                <div
                  className="
                    w-8
                    h-1
                    rounded-full
                    bg-orange-600
                  "
                />

                <p
                  className="
                    text-xs
                    uppercase
                    tracking-[0.16em]
                    text-blue-700
                    font-bold
                  "
                >
                  Staff Portal
                </p>

              </div>

              <h2
                className="
                  text-2xl
                  sm:text-3xl
                  font-bold
                  text-slate-900
                  tracking-tight
                "
              >
                Welcome back
              </h2>

              <p
                className="
                  mt-2
                  text-sm
                  text-slate-500
                  leading-relaxed
                "
              >
                Sign in to access your JaliCare
                healthcare workspace.
              </p>

            </div>

            {/* ============================================================
                ERROR
            ============================================================= */}

            {error && (
              <div
                role="alert"
                className="
                  mb-5
                  rounded-xl
                  border
                  border-red-200
                  bg-red-50
                  px-4
                  py-3
                  text-sm
                  text-red-700
                  leading-relaxed
                "
              >
                {error}
              </div>
            )}

            {/* ============================================================
                INFO
            ============================================================= */}

            {infoMessage && (
              <div
                role="status"
                className="
                  mb-5
                  rounded-xl
                  border
                  border-blue-200
                  bg-blue-50
                  px-4
                  py-3
                  text-sm
                  text-blue-800
                  leading-relaxed
                "
              >
                {infoMessage}
              </div>
            )}

            {/* ============================================================
                FORM
            ============================================================= */}

            <form
              onSubmit={handleSubmit}
              noValidate
              className="space-y-5"
            >

              {/* ==========================================================
                  IDENTIFIER
              =========================================================== */}

              <div>

                <label
                  htmlFor="identifier"
                  className="
                    block
                    text-sm
                    font-semibold
                    text-slate-700
                    mb-2
                  "
                >
                  Username or email
                </label>

                <div className="relative">

                  {/* Blue accent */}

                  <div
                    className="
                      absolute
                      left-0
                      top-0
                      bottom-0
                      w-1
                      rounded-l-lg
                      bg-blue-600
                    "
                  />

                  <input
                    id="identifier"
                    name="identifier"
                    type="text"
                    autoComplete="username"
                    value={identifier}
                    onChange={(event) =>
                      setIdentifier(
                        event.target.value
                      )
                    }
                    disabled={loading}
                    placeholder="Enter username or email"
                    className="
                      w-full
                      h-12
                      rounded-lg
                      border
                      border-slate-300
                      bg-white
                      pl-5
                      pr-4
                      text-sm
                      text-slate-900
                      outline-none
                      transition-all
                      placeholder:text-slate-400
                      focus:border-blue-600
                      focus:ring-4
                      focus:ring-blue-100
                      disabled:bg-slate-50
                      disabled:text-slate-500
                    "
                  />

                </div>

              </div>

              {/* ==========================================================
                  PASSWORD
              =========================================================== */}

              <div>

                <label
                  htmlFor="password"
                  className="
                    block
                    text-sm
                    font-semibold
                    text-slate-700
                    mb-2
                  "
                >
                  Password
                </label>

                <div className="relative">

                  {/* Orange accent */}

                  <div
                    className="
                      absolute
                      left-0
                      top-0
                      bottom-0
                      w-1
                      rounded-l-lg
                      bg-orange-600
                      z-10
                    "
                  />

                  <input
                    id="password"
                    name="password"
                    type={
                      showPassword
                        ? 'text'
                        : 'password'
                    }
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) =>
                      setPassword(
                        event.target.value
                      )
                    }
                    disabled={loading}
                    placeholder="Enter your password"
                    className="
                      w-full
                      h-12
                      rounded-lg
                      border
                      border-slate-300
                      bg-white
                      pl-5
                      pr-12
                      text-sm
                      text-slate-900
                      outline-none
                      transition-all
                      placeholder:text-slate-400
                      focus:border-orange-600
                      focus:ring-4
                      focus:ring-orange-100
                      disabled:bg-slate-50
                      disabled:text-slate-500
                    "
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setShowPassword(
                        !showPassword
                      )
                    }
                    disabled={loading}
                    className="
                      absolute
                      right-3
                      top-1/2
                      -translate-y-1/2
                      p-1.5
                      text-slate-400
                      hover:text-blue-700
                      rounded-md
                      transition-colors
                      disabled:opacity-50
                    "
                    aria-label={
                      showPassword
                        ? 'Hide password'
                        : 'Show password'
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>

                </div>

              </div>

              {/* ==========================================================
                  SIGN IN BUTTON
              =========================================================== */}

              <button
                type="submit"
                disabled={loading}
                className="
                  group
                  relative
                  w-full
                  h-12
                  rounded-lg
                  overflow-hidden
                  bg-blue-700
                  text-white
                  font-semibold
                  text-sm
                  flex
                  items-center
                  justify-center
                  gap-2
                  shadow-md
                  hover:shadow-lg
                  transition-all
                  duration-300
                  disabled:opacity-60
                  disabled:cursor-not-allowed
                "
              >

                {/* Animated orange accent */}

                <span
                  className="
                    absolute
                    inset-y-0
                    left-0
                    w-1
                    bg-orange-500
                    transition-all
                    duration-300
                    group-hover:w-full
                    group-hover:bg-blue-800
                  "
                />

                <span
                  className="
                    relative
                    z-10
                    flex
                    items-center
                    justify-center
                    gap-2
                  "
                >

                  {loading ? (
                    <>
                      <Loader2
                        className="
                          w-4
                          h-4
                          animate-spin
                        "
                      />

                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign in

                      <ArrowRight
                        className="
                          w-4
                          h-4
                          transition-transform
                          duration-300
                          group-hover:translate-x-1
                        "
                      />
                    </>
                  )}

                </span>

              </button>

            </form>

            {/* ============================================================
                SECURITY NOTICE
            ============================================================= */}

            <div
              className="
                mt-8
                pt-6
                border-t
                border-slate-100
              "
            >

              <div
                className="
                  flex
                  items-start
                  gap-3
                "
              >

                <div
                  className="
                    w-9
                    h-9
                    rounded-lg
                    bg-blue-50
                    flex
                    items-center
                    justify-center
                    shrink-0
                    border
                    border-blue-100
                  "
                >

                  <ShieldCheck
                    className="
                      w-4
                      h-4
                      text-blue-700
                    "
                  />

                </div>

                <div>

                  <p
                    className="
                      text-xs
                      font-semibold
                      text-slate-700
                    "
                  >
                    Authorized access only
                  </p>

                  <p
                    className="
                      mt-1
                      text-xs
                      text-slate-500
                      leading-relaxed
                    "
                  >
                    This system is intended for
                    authorized healthcare personnel.
                    Your activity may be recorded
                    for security and audit purposes.
                  </p>

                </div>

              </div>

            </div>

            {/* ============================================================
                COPYRIGHT
            ============================================================= */}

            <div
              className="
                mt-8
                text-center
                text-xs
                text-slate-400
              "
            >

              © {new Date().getFullYear()} JaliCare HMIS

              <span className="mx-2 text-orange-500">
                •
              </span>

              Secure Healthcare Platform

            </div>

          </div>

        </section>

      </div>

      {/* ================================================================
          ANIMATIONS
      ================================================================= */}

      <style>
        {`

          @keyframes logoFloat {
            0%,
            100% {
              transform: translateY(0px);
            }

            50% {
              transform: translateY(-7px);
            }
          }

          @keyframes logoShine {
            0% {
              transform: translateX(-150%);
              opacity: 0;
            }

            15% {
              opacity: 1;
            }

            40% {
              transform: translateX(400%);
              opacity: 0;
            }

            100% {
              transform: translateX(400%);
              opacity: 0;
            }
          }

          @keyframes float {
            0%,
            100% {
              transform: translateY(0px);
            }

            50% {
              transform: translateY(-20px);
            }
          }

          @keyframes floatReverse {
            0%,
            100% {
              transform: translateY(0px);
            }

            50% {
              transform: translateY(20px);
            }
          }

          @media (prefers-reduced-motion: reduce) {
            *,
            *::before,
            *::after {
              animation-duration: 0.01ms !important;
              animation-iteration-count: 1 !important;
              transition-duration: 0.01ms !important;
              scroll-behavior: auto !important;
            }
          }

        `}
      </style>

    </main>
  );
};

export default LoginScreen;