// Babel config exists for one reason: ESLint.
//
// This project compiles with TypeScript 7, the native Go port, which ships
// no JavaScript API (`ts.createSourceFile` is undefined). typescript-eslint
// therefore cannot parse it, and pinning a second compiler just to lint
// would mean linting a different language version than the one that builds.
// @babel/eslint-parser has its own TypeScript parser and needs no
// `typescript` package, so ESLint keeps working without touching the build.
//
// Nothing here affects `vite build`, `tsx` or `tsc`: they never read it.

module.exports = {
  parserOpts: {
    plugins: ['typescript', 'jsx'],
  },
};
