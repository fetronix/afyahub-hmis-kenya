# Syrona 2026 — official CSV reconciliation

Date: 2026-10-27  
Decision: **BLOCKED — NOT IMPORTED. Not production acceptance.**

## Scope and safety

Audited the two supplied official CSV exports against the existing budget-planning arithmetic and workbook preview validator. No existing plan was queried, replaced, archived or edited. No import was confirmed, database migration applied, or synthetic record created. There is no configured authenticated facility/database session in this workspace. Currency is not stated in either CSV and has **not** been assumed to be KES.

The React/TypeScript/Express/PostgreSQL architecture, routing, UI components, PDF/Excel services, authorization gates and existing migrations remain unchanged. A new **read-only audit script** and regression tests were added; this is not a production CSV import endpoint. The existing parser accepts XLS/XLSX, not direct CSV. Its validation was exercised via an in-memory CSV-to-XLSX derivative retaining literal blank/dash/zero states and original row positions, normalizing numeric separators only. That derivative is not the original workbook and was not saved or imported.

CSV exports cannot establish original formulas, cached-formula provenance, formatting or uniform formula semantics. No formulas were executed; no formula-like cells beginning `=`, `+` or `@` were found in these uploads. Calculations below use server fixed-point arithmetic at 5%, not trusted spreadsheet formulas. Full production acceptance, CRUD/audit checks and authenticated report/browser validation remain outstanding.

## Source identity and counts

| File                  |  Bytes | CSV dimensions | SHA256                                                             |
| --------------------- | -----: | -------------- | ------------------------------------------------------------------ |
| Syrona_Stationery.csv | 39,236 | 296 × 32       | `244f9ba9bdd8f5a28793610cabfa8d931ecc76eff52b0fa553b11702e3f198e1` |
| Syrona_Branding.csv   |  2,425 | 36 × 29        | `75f810a0265ad0e6a08d9efc1e43a6705591ae81ae0aa6c109466a605881797e` |

Both tables explicitly label January–December 2026. Source rows below are **one-based CSV rows**, not item serial numbers.

| Requested grouping       | Preserved source label         | Items |
| ------------------------ | ------------------------------ | ----: |
| OPD Consumables          | OPD CONSUMABLES                |   133 |
| Dental                   | DENTAL CONSUABLES              |    40 |
| Stationery               | CONSUMABLE ITEMS               |    59 |
| Branding monthly items   | BRANDING                       |     5 |
| Uniforms, separate table | Original descriptions retained |     4 |

The requested 232 stationery-file items are present. Monthly-item total across both files is 237; four uniforms are **not** monthly-item rows. The audit retains source labels, spelling, raw descriptions, units, row references and raw numeric cells rather than silently renaming official data. The user-requested Stationery mapping is recorded above; no category mutation was performed.

## Arithmetic and annual figures

All **227 populated stationery base/adjusted price pairs plus 5 branding pairs** agree with a 5% increase. Five stationery base prices are absent. Server logic rounds adjusted unit prices to two decimals and monthly quantity products to two decimals; quantities allow three decimal places. These arithmetic checks do not establish missing quantity semantics.

Amounts below are **currency-unconfirmed numeric sums**, not verified annual budgets. The known-input calculation excludes unknown quantities/prices; omitted unknowns have not been declared zero.

| File                   | Source numeric-cost sum | Server known-input-only sum | Difference |
| ---------------------- | ----------------------: | --------------------------: | ---------: |
| Stationery             |              260,380.50 |                  263,046.00 |  +2,665.50 |
| Branding monthly items |               22,365.00 |                   22,365.00 |       0.00 |

### Stationery monthly reconciliation

| Month | Source numeric costs |  Server known inputs | Difference |
| ----- | -------------------: | -------------------: | ---------: |
| Jan   |            14,507.75 |            17,382.75 |  +2,875.00 |
| Feb   |            17,385.90 |            17,385.90 |       0.00 |
| Mar   |            20,102.25 |            20,102.25 |       0.00 |
| Apr   |             8,961.75 |             8,751.75 |    −210.00 |
| May   |            13,356.00 |            13,356.00 |       0.00 |
| Jun   |            83,716.50 |            83,716.50 |       0.00 |
| Jul   |            12,726.00 |            12,726.00 |       0.00 |
| Aug   |            51,828.00 |            51,828.00 |       0.00 |
| Sep   |             3,737.50 |             3,738.00 |      +0.50 |
| Oct   |             2,808.75 |             2,808.75 |       0.00 |
| Nov   |     0.00 numeric sum | 0.00 known-input sum |       0.00 |
| Dec   |            31,250.10 |            31,250.10 |       0.00 |

Every numeric source footer matches the corresponding sum of numeric source costs. **November's stationery footer is a dash, not an explicit zero.** Branding numeric monthly costs are Jan 9,345.00; Feb 6,195.00; Mar 6,825.00; later months have no numeric costs. All eight populated branding costs reconcile, but this does not authorize filling unplanned months with zeros.

## Blocking source issues requiring owner decisions

### Missing base prices — Syrona_Stationery.csv

| CSV row | Exact trimmed description                  |
| ------: | ------------------------------------------ |
|      90 | FINECARE CRP Rapid Test (1950)Finecare CRP |
|      91 | Finecare TSH                               |
|      92 | FINECARE T3 Rapid Test (1977) FINECARE T4  |
|      93 | Finecare D-Dimer                           |
|      94 | Finecare HBA1C                             |

Provide verified base prices, or an explicit supported treatment as unpriced/unplanned records. They were not defaulted to zero.

### Missing unit

Row **172**, `Steranious 2% 5litres`, has no unit. A unit cannot be inferred from its description without confirmation.

### Conflicting duplicate import identities

The current importer keys identity by category, case-insensitive description and unit. These pairs collide but have different base prices:

| Later CSV row | Earlier row | Description               | Earlier/later base prices |
| ------------: | ----------: | ------------------------- | ------------------------: |
|           120 |          43 | Cotton Wool 400g          |           325.00 / 300.00 |
|           125 |          46 | EUROJET Needles G23 100's |           170.00 / 150.00 |
|           126 |          29 | Examination Couch(Local)  |     10,000.00 / 10,500.00 |

No row was deleted, merged or renamed. Confirm whether these are distinct lines requiring a source-line identity model, or source corrections. The separate audit detects these even though earlier per-row validation errors prevent the existing preview from reaching all duplicate checks.

### Quantity/cost inconsistencies

| CSV row | Item              | Month | Source                      | Server calculation                  |
| ------: | ----------------- | ----- | --------------------------- | ----------------------------------- |
|     119 | ALCOHOL SWAB PACK | Apr   | Cost 210.00, quantity blank | Cannot calculate without a quantity |
|     166 | MEDICAINE         | Sep   | Cost 2,992.00, quantity 1   | 2,850.00 × 1.05 × 1 = 2,992.50      |
|     186 | Toner - 217-A     | Jan   | Cost 5,000.00, quantity 1   | 7,500.00 × 1.05 × 1 = 7,875.00      |

The differences were not silently corrected. Supply authorized corrections or explain a documented override rule; the current server recalculates from price and quantity.

### Blank/dash semantics

Across 2,844 monthly quantity cells: **1,190 literal dashes; 1,043 blanks; 427 explicit zeros; 184 other numeric quantities.** Stationery alone: 1,190 / 991 / 427 / 176 respectively. Branding adds 52 blanks and 8 numeric quantities.

Blank, dash and explicit zero remain separate states. Confirm whether a dash means unknown, not applicable, unplanned or zero. The importer currently rejects dashes in quantity cells. Blanks can represent unplanned quantities and must not be silently zero-filled.

### Uniforms — Syrona_Branding.csv rows 22–25

| Item                | Buying cost | Source HALF PAY FOR STAFF |
| ------------------- | ----------: | ------------------------: |
| POLO T SHIRTS       |      900.00 |                    450.00 |
| SHIRTS              |    1,392.00 |                    696.00 |
| BLOUSES             |    1,500.00 |                    750.00 |
| ROUND NECK T SHIRTS |      600.00 |                    300.00 |

The half-pay entries numerically equal half of buying cost, but are **amounts**, not source percentages. Opening balances (labelled December 2025), staff counts and quantities per staff are blank. Source projected quantities are explicit zero; total costs are dashes. Those zeros do not justify inventing the missing inputs.

Current uniform logic requires an explicitly selected percentage of gross purchase cost and a `SUBTRACT` or `IGNORE` opening-balance rule. It has **not** been established that this models the source's per-staff half-pay, contribution recipient, purchase quantities or inflation treatment correctly. Uniforms were omitted from the derivative preview, explicitly flagged, not omitted from the evidence. Obtain verified inputs and a written formula/rule before adapting or importing them.

## Existing importer preview result

- 237 monthly-item source rows evaluated; **66 valid, 171 rejected**.
- Accepted by row validation only: 2 Dental, 59 Stationery and 5 Branding. This is not approval of source costs, currency or completeness.
- First error per rejected row: 165 invalid monthly quantities (literal dashes), 5 missing prices, 1 missing unit.
- Uniforms: 4 evidence rows, not previewed as importable projections for the reasons above.
- Preview error count is not an exhaustive count of source defects; separate audit findings include collisions and source cost mismatches.
- **No partial import was confirmed.**

## Verification performed in this turn

| Check                                                                   | Result / limitation                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Read-only official CSV audit                                            | PASS as discrepancy detection; acceptance BLOCKED                                      |
| New CSV primitives and official-source regression                       | 5 passed; official source test executed with `SYRONA_SOURCE_DIR`                       |
| Existing budget arithmetic/workbook unit tests                          | 20 passed                                                                              |
| Existing database workflow tests                                        | **23 skipped**: PostgreSQL unavailable at local test endpoint                          |
| TypeScript `npm run typecheck`                                          | PASS                                                                                   |
| Client `npm run build`                                                  | PASS; existing large-chunk warning (>500 kB)                                           |
| Server `npm run build:server`                                           | PASS; 8 Node 22 bundles                                                                |
| `npm run lint`                                                          | PASS exit code; **0 errors, 106 warnings**                                             |
| Authenticated browser checks on reconciled records                      | **NOT RUN**: no accepted import, configured database or authenticated facility session |
| Creation/edit/deletion/approval/concurrency/audit on reconciled records | **NOT VERIFIED**: no reconciled records persisted; DB tests skipped                    |
| Actual-source PDF/Excel, active facility letterhead, multipage geometry | **NOT VERIFIED**: no accepted persisted plan/authenticated facility context            |
| Historical reproducibility of production reports                        | **NOT VERIFIED**; read-only evidence can be regenerated from matching source hashes    |
| Existing-work preservation                                              | 1,348 inventoried pre-existing files SHA256-unchanged after checks                     |

The supplied `LETTER HEAD.pdf` was not assigned to an arbitrary facility or hardcoded into reports. A verified active facility context is needed to use the existing secure upload/activation/report flow. Historical synthetic test results in the earlier implementation report are **not reused as current-source acceptance evidence**. No test, authorization gate or DB-required guard was weakened to obtain a passing status.

## Evidence and reproduction

New utility: `scripts/reconcile-syrona-plan.ts`. It has no database dependency, opens no database connection and exposes no confirm/import operation. It writes only the explicitly requested output directory. Monetary arithmetic reuses existing server functions.

```sh
npx tsx scripts/reconcile-syrona-plan.ts /path/to/official-csvs /path/to/audit-output
SYRONA_SOURCE_DIR=/path/to/official-csvs npx vitest run \
  src/tests/syrona-reconciliation.spec.ts \
  src/tests/budget-planning.spec.ts src/tests/budget-planning.db.spec.ts
npm run typecheck
npm run build
npm run build:server
npm run lint
```

The official-source test asserts the supplied hashes and findings; it intentionally requires updating reviewed expectations for corrected sources. Without `SYRONA_SOURCE_DIR` that test is skipped, not replaced with fabricated data. Four primitive tests remain runnable without uploads. The generated audit always reports BLOCKED_NOT_IMPORTED; this utility is not a mechanism for approving future corrected sources.

Evidence directory: [`syrona-source-acceptance-evidence/`](syrona-source-acceptance-evidence/)

- `source-reconciliation.json`: source hashes, original month labels, raw cell states, all row/month calculations, footer comparisons, source problems, uniform inputs and existing-validator preview/errors.
- `row-month-reconciliation.csv`: 2,844 source-linked row/month observations plus a header; not a financial-system import file.
- `tests.log`, `typecheck.log`, `build.log`, `build-server.log`, `lint.log`: current execution logs.
- `preservation-check.json`: baseline-file preservation result.

## Required next decisions / acceptance gate

1. Provide the five missing base prices and the unit at row 172; resolve the three duplicate pairs without silently dropping source lines.
2. Resolve the April/September/January discrepancies at rows 119/166/186 and define dash versus blank treatment.
3. Provide uniform balances, staff counts, per-staff quantities and the actual half-pay/opening-balance/inflation formula. Original XLS would help establish formulas, but CSV plus an explicit verified rule can resolve the blocker.
4. Confirm currency via authenticated facility settings or explicit instruction. Identify the authorized facility and existing synthetic plan/batch IDs to replace, with a reviewed non-destructive lifecycle decision; no facility IDs were inferred from a browser request or hardcoded here.
5. After corrected-source preview approval, use an authorized isolated environment for current-source CRUD/audit/RBAC/concurrency/browser/report tests, including active uploaded letterhead, multipage PDF/Excel and historical output checks. Do not apply production migrations without explicit authorization.

**No replacement is safe to confirm on the current evidence.**
