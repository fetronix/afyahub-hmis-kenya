// ESLint flat configuration.
//
// WHY NOT typescript-eslint
// -------------------------
// The project compiles with TypeScript 7.0.2, the native Go port. That
// package exposes no JavaScript API at all — `require('typescript')
// .createSourceFile` is `undefined` — and every published typescript-eslint
// version peers on `typescript >=4.8.4 <6.1.0`. Installing it anyway would
// either fail to parse or lint against a compiler the build never uses.
//
// Pinning TypeScript 5 to make the linter happy would change the compiler
// that produces `dist/` and `build/server.js`, which is exactly the kind of
// "make CI green" trade this repository must not make. So ESLint runs on
// @babel/eslint-parser, which has its own TypeScript parser.
//
// The consequence is honest and deliberate: rules that need type information
// (`@typescript-eslint/no-floating-promises` and friends) are unavailable.
// `npm run typecheck` remains the type-level gate, and it runs in CI.
// Everything below is a syntax/AST rule that works without a type checker.
//
// See docs/quality/LINTING.md.

import js from '@eslint/js';
import babelParser from '@babel/eslint-parser';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const sharedGlobals = {
  ...globals.node,
  ...globals.browser,
  ...globals.es2022,
};

export default [
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      'coverage/**',
      '**/*.bak',
      '**/*.backup-*',
      'drizzle/**',
    ],
  },

  js.configs.recommended,

  /* ------------------------------------------------------------
     TypeScript and TSX source
     ------------------------------------------------------------ */
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: true,
        babelOptions: {
          presets: ['@babel/preset-typescript'],
          /*
           * JSX must be enabled on the parser that actually reads the
           * file. `ecmaFeatures.jsx` above is an ESLint hint and is not
           * enough on its own: without this, every .tsx file fails with
           * "Unexpected token, expected ,".
           */
          parserOpts: { plugins: ['jsx'] },
        },
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: sharedGlobals,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      /*
       * React rules: the two that catch defects, not the advisory set.
       *
       * eslint-plugin-react-hooks v6 added React-Compiler-oriented rules
       * (`set-state-in-effect`, `immutability`, `static-components`). In
       * this codebase they fire on patterns written years before those
       * rules existed — setting a selection inside an effect, mutating a
       * ref-held object. Rewriting them to satisfy a linter is a
       * behavioural change to clinical screens, which this work is not
       * allowed to make. They are warnings: visible, not blocking.
       *
       * `rules-of-hooks` is a genuine crash (conditional hook order), and
       * stays an error. `exhaustive-deps` stays the conventional warning.
       */
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/unsupported-syntax': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'react-hooks/config': 'warn',
      'react-hooks/gating': 'warn',

      /*
       * Correctness. These are errors because each one has caused, or
       * would cause, a real defect in this codebase.
       */
      'no-undef': 'off', // TypeScript already rejects unknown identifiers.
      'no-unused-vars': 'off', // Superseded: the AST-only variant below.
      'no-redeclare': 'warn',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-fallthrough': 'error',
      'no-template-curly-in-string': 'warn',
      'require-atomic-updates': 'off',

      /*
       * Style that hides bugs. Deliberately narrow: this is not a
       * reformatter, Prettier owns layout.
       */
      eqeqeq: ['warn', 'smart'],
      'no-var': 'warn',
      'prefer-const': ['warn', { destructuring: 'all' }],
      'no-throw-literal': 'error',
      'no-return-assign': ['error', 'except-parens'],
      'no-prototype-builtins': 'warn',

      /*
       * Test and script files legitimately log and use process.
       */
      'no-console': 'off',
    },
  },

  /* ------------------------------------------------------------
     Server-side entry points: CommonJS `require` is not available
     ------------------------------------------------------------ */
  {
    files: ['server.ts', 'scripts/**/*.{ts,mjs,js}', 'src/config/**/*.ts'],
    languageOptions: {
      globals: { ...sharedGlobals, ...globals.node },
    },
  },

  /* ------------------------------------------------------------
     Build and tooling scripts (plain .mjs, no TypeScript)
     ------------------------------------------------------------ */
  {
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: sharedGlobals,
    },
    rules: {
      'no-console': 'off',
    },
  },

  /* Tests may assert on anything, including unreachable-looking branches. */
  {
    files: ['src/tests/**/*.ts'],
    rules: {
      'no-constant-condition': 'off',
      'no-unused-vars': 'off',
      /*
       * Tests assert that a source file contains a literal template
       * placeholder — `dashboard.includes('expiring within ${X} days')`.
       * The `${...}` is the thing under test, not a mistake. Scoped to
       * tests; application code still enforces the rule.
       */
      'no-template-curly-in-string': 'off',
    },
  },
];
