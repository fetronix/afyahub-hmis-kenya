/**
 * Vitest configuration
 *
 * WHY BOTH VITEST AND THE EXISTING RUNNERS
 * ----------------------------------------
 * The repository ships 35 hand-written test files that run through
 * `tsx` and assert with a small local helper. They are not being deleted:
 * rewriting 3,700 assertions at once would destroy the only evidence the
 * system works. They keep running through their own scripts, unchanged.
 *
 * Vitest is added alongside them for what they cannot do:
 *
 *   - coverage, measured rather than asserted;
 *   - DOM tests for React components (jsdom + Testing Library);
 *   - database tests that need a real PostgreSQL (skipped without one unless
 *     JALICARE_REQUIRE_DB=1; the full coverage ratchet requires those tests);
 *   - a watch mode and a per-file runner for development.
 *
 * Migration is incremental: a suite moves here only once its assertions
 * have been carried across intact, and only then is it removed from the
 * `npm test` chain. See docs/quality/TESTING.md for the current inventory.
 *
 * Two projects, because the environments are genuinely different:
 *   node     — server, domain and integration tests
 *   jsdom    — React component tests
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    /*
     * Two locations, one runner. `src/tests/vitest/` holds the specs written
     * for vitest from the start. `src/tests/*.spec.ts` holds the suites that
     * were migrated off the hand-rolled `tsx` runner - they keep their old
     * path and their old relative imports, and change only their extension
     * and their assertions. A `.test.ts` beside them is a suite that has not
     * migrated yet and still runs through its own npm script.
     */
    include: [
      'src/tests/vitest/**/*.spec.ts',
      'src/tests/vitest/**/*.spec.tsx',
      'src/tests/integration/**/*.spec.ts',
      'src/tests/integration/**/*.db.spec.ts',
      'src/tests/*.spec.ts',
      'src/tests/*.db.spec.ts',
    ],
    exclude: ['node_modules', 'dist', 'build'],

    /*
     * Integration specs that need PostgreSQL are named *.db.spec.ts and
     * skip themselves when the server is unreachable. `dbAvailable()` in
     * src/tests/vitest/support/db.ts is the single place that decides,
     * so a local run and CI agree.
     */
    setupFiles: ['src/tests/vitest/support/setup.ts', 'src/tests/vitest/support/setup-dom.ts'],
    globalSetup: ['src/tests/vitest/support/global-setup.ts'],

    /**
     * A test that hangs is worse than one that fails: on CI it consumes
     * the job timeout and hides which file wedged.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,

    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}', 'server.ts', 'scripts/**/*.ts'],
      exclude: [
        'src/tests/**',
        'src/**/*.d.ts',
        'src/components/**', // DOM coverage tracks separately (see below)
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      /*
       * Thresholds are a ratchet, not an aspiration. They are set just
       * below the measured baseline so the build cannot regress, and are
       * raised as suites migrate. A threshold that nobody can meet is a
       * threshold everybody disables.
       *
       * Measured on 2026-10-25 with `npm run test:coverage`: see
       * docs/quality/TESTING.md for the numbers this was set from.
       */
      thresholds: {
        /*
         * Two levels, because one number cannot say both things.
         *
         * GLOBAL is a ratchet, set just below the measured baseline and
         * raised when the baseline rises. It went 11.4/11.2/8.7/7.3 ->
         * 19.0/19.1/19.3/16.6 when the last 34 suites moved off the `tsx`
         * runner and into vitest: no assertion changed, but the code they
         * exercise is now counted, where before an un-instrumented
         * subprocess ran it.
         *
         * Measured 2026-10-28 with `npm test` across 66 spec files:
         * 41.45% statements, 41.96% lines, 42.93% functions, 36.73% branches
         * (up from 19.35 / 19.22 / 19.58 / 16.88 after adding Zod route-level
         * validation, HTTP integration suites, and domain service specs).
         * After integrating the insurance, accounting and payment workflows,
         * full-suite coverage must run with the disposable PostgreSQL database.
         * A no-database run can execute unit tests but falls below this ratchet.
         */
        lines: 41.0,
        statements: 40.5,
        functions: 41.5,
        branches: 35.5,

        'src/validation/validate.ts': {
          lines: 90,
          statements: 90,
          functions: 100,
          branches: 75,
        },
        'src/routes/platform/tenants.routes.ts': {
          lines: 90,
          statements: 90,
          functions: 100,
          branches: 50,
        },
        'src/routes/platform/facilities.routes.ts': {
          lines: 74,
          statements: 74,
          functions: 100,
          branches: 50,
        },
        'src/routes/platform/validation.ts': {
          lines: 95,
          statements: 95,
          functions: 100,
          branches: 80,
        },
        'src/maternity/services/anc.service.ts': {
          lines: 88,
          statements: 85,
          functions: 100,
          branches: 80,
        },
        'src/maternity/services/delivery.service.ts': {
          lines: 80,
          statements: 78,
          functions: 90,
          branches: 55,
        },
        'src/auth/staff-roles/permissions.service.ts': {
          lines: 75,
          statements: 75,
          functions: 78,
          branches: 55,
        },
        'src/auth/staff-roles/status.service.ts': {
          lines: 72,
          statements: 72,
          functions: 100,
          branches: 58,
        },
        'src/insurance/claims.service.ts': {
          lines: 74,
          statements: 74,
          functions: 82,
          branches: 52,
        },
        'src/inventory/inventory.service.ts': {
          lines: 80,
          statements: 78,
          functions: 85,
          branches: 54,
        },
        'src/reporting/reporting.service.ts': {
          lines: 90,
          statements: 88,
          functions: 88,
          branches: 56,
        },
        'src/security/patient-identifiers.ts': {
          lines: 95,
          statements: 90,
          functions: 100,
          branches: 60,
        },

        'src/billing/tariff-codes.ts': {
          lines: 90,
          statements: 90,
          functions: 78,
          branches: 78,
        },
        'src/billing/tariff-words.ts': {
          lines: 95,
          statements: 80,
          functions: 95,
          branches: 45,
        },
        'src/billing/tariff-matching.ts': {
          lines: 40,
          statements: 40,
          functions: 35,
          branches: 30,
        },

        /*
         * Clinical date arithmetic drives the bed-day charge and the
         * length-of-stay report. A regression here mis-bills a patient, so
         * it is held at the measured figure rather than allowed to drift
         * down with the global ratchet.
         */
        'src/utils/dates.ts': {
          lines: 100,
          statements: 96,
          functions: 100,
          branches: 94,
        },

        /*
         * The only place a password becomes a hash. Held high because a
         * weakened cost factor or a silently swallowed verification error
         * would not show up in any other test.
         */
        'src/utils/password.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },

        /*
         * The gate every login, session check and password reset passes
         * through. Held high because a weakened length rule or a relaxed
         * token shape would not show up anywhere else.
         */
        'src/auth/auth.validation.ts': {
          lines: 95,
          statements: 95,
          functions: 100,
          branches: 95,
        },

        /*
         * Payment settlement. Every payment taken at a counter runs through
         * this module, and it is where an overpayment becomes patient credit
         * instead of a negative balance that would offset somebody else's
         * debt. A regression here moves money.
         */
        'src/billing/settlement.ts': {
          lines: 95,
          statements: 95,
          functions: 100,
          branches: 92,
        },

        /*
         * Tariff resolution. This is the module that answers "what does this
         * cost?", and its own header lists the six different problems that
         * used to produce one identical sentence. Held high because every
         * charge in the facility passes through it, and because the costly
         * regressions are silent: billing a general ward rate for an ICU
         * night, or substituting a different tariff when the linked one
         * lapsed, both produce a plausible invoice.
         */
        'src/billing/tariff-resolver.ts': {
          lines: 79,
          statements: 78,
          functions: 75,
          branches: 74,
        },

        /*
         * Tenant and facility enforcement - the boundary between hospitals.
         * Held at 100 on purpose, and it is the one row here expected to stay
         * there: an untested branch in this file is a cross-tenant read, not
         * a cosmetic gap. It is also small and entirely synchronous, so full
         * coverage is a fair thing to ask of it.
         */
        'src/auth/scope.service.ts': {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },

        /*
         * Field encryption. Everything a stolen table dump must not reveal
         * passes through here, and the failures that matter are silent ones:
         * a reused IV that makes equal identifiers detectable, or a caught
         * authentication error that returns a wrong identifier instead of
         * throwing. Held just below the measured 98.38/98.59/100/97.72; the
         * missing lines are the defensive branches around an unreachable
         * `Buffer.from(..., 'base64')` throw, not real behaviour.
         */
        'src/security/field-crypto.ts': {
          lines: 98,
          statements: 98,
          functions: 100,
          branches: 97,
        },

        /*
         * The guards mounted in front of the API. Held high because the
         * damaging failures here are fail-open: a guard that writes a 403 and
         * still calls next() shows the client a refusal while the handler has
         * already run. Held just below the measured 82.10/82.10/100/88.09.
         */
        'src/auth/authorization.middleware.ts': {
          lines: 81,
          statements: 81,
          functions: 100,
          branches: 87,
        },

        /*
         * DHA configuration decides whether live patient data can leave this
         * server. The regressions that matter are the permissive ones - a
         * default that is not mock, a production gate that can be skipped, a
         * redaction that returns the secret it was meant to hide - so the
         * whole configuration path is held near the measured 97.05/97.14/
         * 100/98.14 rather than left to the global ratchet.
         */
        'src/integrations/dha/dha.config.ts': {
          lines: 96,
          statements: 96,
          functions: 100,
          branches: 97,
        },
      },
    },

    /*
     * One project, two environments, chosen per file.
     *
     * The React spec declares `// @vitest-environment jsdom` at the top of
     * the file; everything else runs in node. Two `projects` were tried
     * first and both inherited the root `include`, so every node spec ran a
     * second time under jsdom - 72 tests from 36 declarations. A docblock is
     * one line, visible in the file it applies to, and cannot double-run.
     */
  },
});
