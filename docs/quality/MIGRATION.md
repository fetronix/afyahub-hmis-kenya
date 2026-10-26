# Test runner migration — from 34 `tsx` scripts to one vitest suite

**State: complete.** Every suite in `src/tests` runs under `npm test`, which
is now `vitest run --coverage`. The 34 per-suite `test:*` npm scripts are
gone.

This file records what changed, how each batch was checked, and the three
converter defects that the checks caught — because the next person to move a
test suite should know what went wrong the first time.

---

## Why

The suites were written as scripts:

```ts
let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;
  if (!condition) throw new Error(`FAILED: ${label}`);
}

function testMoney(): void {
  /* ... */
}

function run(): void {
  testMoney();
  console.log('  ✓ Money arithmetic passed');
}

try {
  run();
  console.log(`BILLING TESTS PASSED (${checks} assertions)`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
```

`npm test` chained 31 of them with `&&`. Three problems:

1. **Coverage could not see them.** Each ran in its own `tsx` subprocess, so
   `vitest --coverage` measured the 22 vitest specs and nothing else. The
   3,700 legacy assertions were the reason the system was trusted, and they
   contributed 0% to the number that was supposed to represent coverage.
2. **A chain stops at the first failure.** `a && b && c` means one red suite
   hides whether the other 30 pass.
3. **Reporting was `console.log`.** No per-assertion failure, no duration, no
   machine-readable output, no watch mode.

## The transformation

Applied uniformly, per file:

| Before                           | After                                                              |
| -------------------------------- | ------------------------------------------------------------------ |
| `assert(condition, label)`       | `expect(condition, label).toBe(true)`                              |
| `assertEqual(actual, exp, l)`    | `expect(actual, l).toBe(exp)`                                      |
| `assertEqual` (JSON variant)     | `expect(JSON.stringify(actual), l).toBe(JSON.stringify(expected))` |
| `assertThrows(fn, label)`        | `expect(fn, label).toThrow()`                                      |
| `function testThing(): void`     | one `it('...', async () => { ... })`                               |
| `run()` / `try { run() }`        | `describe(...)` — removed                                          |
| `console.log('✓ ...')`, `checks` | removed; the runner reports                                        |

Everything else was moved verbatim: paths, imports, helper functions,
comments, and the labels that name what each assertion means.

Each section body became one `it()` with its **original body**, so statement
order and shared locals are untouched. Sections are never re-run, reordered
or split.

### Files were renamed, not moved

`src/tests/foo.test.ts` → `src/tests/foo.spec.ts`, at the same path. Moving
them into `src/tests/vitest/` would have changed the depth of every import
(`../billing/...`) and every `import.meta.dirname`; keeping the path made the
rename a no-op for the module graph.

`vitest.config.ts` collects `src/tests/*.spec.ts` and `src/tests/*.db.spec.ts`
beside the existing `src/tests/vitest/`. Because the extension decides, a
suite is in the runner **if and only if** it has been migrated — so no commit
in the sequence ran anything twice or nothing at all.

## How each batch was checked

Three gates, every batch, before the commit:

1. **Assertion parity, by AST.** Count `assert`/`assertEqual`/`assertThrows`
   call expressions inside the original section bodies (excluding the harness
   definitions themselves), count `expect` calls in the result, require them
   to be equal. This is what caught all three defects below.
2. `npm run typecheck`.
3. The migrated specs run green, and the full `npm test` (the remaining
   chain) is still green.

Final totals: **34 suites, 2,269 assertions, 806 tests passing and 13
skipped** (the 13 are database specs, skipped without PostgreSQL).

## The three defects

Worth recording, because each one was a silent way to lose an assertion.

### 1. `assertEqual` means two different things

Most suites compare with `===`. Five compare with
`JSON.stringify(a) === JSON.stringify(b)`:

```
deployment, round5, tariff-matching, tariff-resolver, ward-billing
```

That is a different assertion for an object or an array. Converting on the
assumption that every `assertEqual` was strict turned a round5 assertion into
a reference comparison of two array literals, which failed. The converter now
reads the variant off the harness body and emits the `JSON.stringify` form
for those files.

### 2. `await testThing();` is not a call expression

`dha.test.ts` runs its sections as:

```ts
testSchemeMatching();
console.log('  1. POMSF is matched by prefix');
// ...
await testMockCallIsMarkedSimulated();
```

A statement-level `await` wraps the call in an `AwaitExpression`. Read
literally, the runner was not "a list of calls", so the whole file collapsed
into **one** test instead of fourteen. It still passed — nothing was lost,
only the granularity — which is exactly why the parity check counts
assertions rather than tests. Unwrapping `await` fixed it.

### 3. An assertion in the runner belongs to no section

`nursing-contracts.test.ts` ends its runner with:

```ts
testUiWiring();
console.log('  7. Ward screen and dashboard are wired to the board');

/* Reference table must stay consistent with the boundaries above. */
assertEqual(VITALS_REFERENCE.spo2Percent.min, 94, 'SpO2 reference minimum');
```

Turning the runner into a list of sections drops everything that is not a
section call — including that assertion. 64 → 63 was the only signal. Such
statements are now collected into a final `it('cross-section checks')`.

## What changed beyond the suites

- **`package.json`** — `test` is `vitest run --coverage`; `test:all` was
  redundant and is now an alias. All 34 per-suite scripts removed, plus
  `test:auth-db`.
- **`.github/workflows/ci.yml`** — the `legacy` job ran `npm test` and the
  `unit` job ran `test:coverage`. They are the same command now, so the
  `legacy` job is gone and `unit` is the whole suite. The `database` job runs
  the two auth DB specs by path instead of through a removed script.
- **`deployment.spec.ts`** — asserted that `npm test` contains the string
  `test:deploy`. That contract was about the chain being dismantled, and
  would have kept passing after the script was deleted. It now asserts that
  the deployment contracts are a file the runner collects.
- **Thresholds** — the global ratchet moved 11.4/11.2/8.7/7.3 →
  19.0/19.1/19.3/16.6, because the migrated assertions now execute code that
  coverage can see. Per-module rows were already met and are unchanged.

## What this did not do

Most of these suites assert on **source text** — `file.includes('requireScopedFacility')` —
so they execute almost nothing. That is why coverage after the migration is
19% and not 80%. The migration made them _measurable_; it did not make them
_behavioural_. Converting source-text assertions into real requests is a
separate piece of work, and it is the one that would move the number.

`src/tests/auth-api.test.ts` is still there: 0 bytes, referenced by no
script, and documented in `docs/testing/KNOWN-GAPS.md` as a decision for the
owner. It is the only `.test.ts` left under `src/tests`.
