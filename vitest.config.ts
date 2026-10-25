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
 *   - database tests that need a real PostgreSQL, skipped when none is
 *     reachable so a laptop without one still gets a green run;
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
    include: ['src/tests/vitest/**/*.spec.ts', 'src/tests/vitest/**/*.spec.tsx'],
    exclude: ['node_modules', 'dist', 'build'],

    /*
     * Integration specs that need PostgreSQL are named *.db.spec.ts and
     * skip themselves when the server is unreachable. `dbAvailable()` in
     * src/tests/vitest/support/db.ts is the single place that decides,
     * so a local run and CI agree.
     */
    setupFiles: [
      'src/tests/vitest/support/setup.ts',
      'src/tests/vitest/support/setup-dom.ts',
    ],
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
         * GLOBAL is a ratchet: set just below the measured baseline
         * (2026-10-25, after the first execution-based specs:
         * 6.78% statements, 7.03% lines, 3.52% functions, 1.59% branches)
         * so the build cannot regress while the remaining suites migrate.
         * These numbers move up as tests are added and are never lowered to
         * make a build pass. It is deliberately not raised to a flattering figure:
         * 3,752 legacy assertions exist, but they assert on source text
         * and execute almost nothing, which is the gap this phase closes.
         *
         * PER-MODULE rows carry the real meaning today. These are the
         * pricing rules, held high because a regression here bills a
         * patient the wrong amount.
         */
        lines: 6.6,
        statements: 6.4,
        functions: 3.2,
        branches: 1.5,

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
