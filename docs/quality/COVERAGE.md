# Coverage ratchet — 2026-10-30

These are V8 coverage measurements from clean committed checkouts on Node
22.22.3 and a newly created, migrated PostgreSQL 16.2 database containing only
synthetic test data. `JALICARE_REQUIRE_DB=1` prevented database suites from
silently skipping. No real patient, insurer, SHA, DHA or bank service was used.
The historical migration chain was applied only to new disposable test databases.

## Whole suite

| Metric     | Before (`bd59ab9`) | After (`1c336f8`) | Enforced minimum |
| ---------- | -----------------: | ----------------: | ---------------: |
| Lines      |             54.63% |            56.16% |              55% |
| Statements |             53.83% |            55.35% |              55% |
| Functions  |             58.16% |            58.74% |              58% |
| Branches   |             46.67% |            48.96% |              48% |

The baseline `npm run test:coverage` passed **145 files / 1,460 tests**. The
after run passed **154 files / 1,526 tests**. The global threshold was first
raised to 50/50/55/45 (lines/statements/functions/branches), then to the
minimums shown above. Existing per-file ratchets were not lowered; additional
ratchets protect the five modules below.

**55% branch coverage is not yet met or enforced.** At `1c336f8`, 9,494 of
19,390 branch outcomes were covered. With the denominator unchanged, another
1,171 outcomes are needed to reach 55%; production code changes can change the
denominator. Further targeted work is needed across more modules rather than
lowering the target or excluding code.

## Lowest-covered executable high-risk modules

These five were selected by **line coverage** in the baseline report, from
insurance and SHA integration code; type-only files with no executable lines
were excluded. Branch coverage is shown separately. For CIC the V8 report
shows 100% branches because the file has zero instrumented branches, not
because any branch outcome was exercised.

| Module                                     | Lines before → after | Branches before → after | New focused spec                      |
| ------------------------------------------ | -------------------: | ----------------------: | ------------------------------------- |
| `insurance/payers/cic.adapter.ts`          |        27.27% → 100% |          0 instrumented | `cic-adapter-boundary.spec.ts`        |
| `insurance/mappings/mappings.service.ts`   |        39.18% → 100% |         36.36% → 89.25% | `private-service-mappings.db.spec.ts` |
| `insurance/eclaims/eligibility.service.ts` |      39.66% → 93.38% |         37.90% → 82.25% | `sha-eligibility-scope.db.spec.ts`    |
| `insurance/hub/patient-scope.ts`           |        42.85% → 100% |              25% → 100% | `payer-patient-scope.db.spec.ts`      |
| `integrations/sha/sha.callbacks.ts`        |        43.33% → 100% |         41.02% → 92.45% | `sha-callback-registration.spec.ts`   |

The callback implementation also changed: missing/invalid operation IDs on a
successful HTTP response are now reported as unconfirmed, not registered. A
partial endpoint ID is retained for follow-up. Tests inject HTTP responses;
this is not a live callback registration or verification of DHA behavior.

Additional specs cover private claim validation, payer configuration, SHA
preauthorization guardrails, and payer policy middleware. They use local or
injected fixtures; a manual policy, simulated response, draft, connection probe
or HTTP 200 is not evidence of eligibility, payer approval, claim acceptance,
payment or a working external connection.

## Reproducing and continuing

Run `npm run test:docker` from a clean checkout, or use `npm run test:coverage`
(or the equivalent `npm test`) with an independently created disposable test
database, the required test environment, and `JALICARE_REQUIRE_DB=1`. See the
README's Testing section for the bootstrap and isolation requirements. Without
a database, DB specs can skip and the full-suite ratchet can fail.

For further gains, prioritize untested safety and error paths in claims,
benefits and remittance services and their authorization routes. Record new
measurements and keep thresholds below a stable, repeatable full-suite result;
coverage is not a substitute for security review, validated payer contracts or
real authorized sandbox testing.
