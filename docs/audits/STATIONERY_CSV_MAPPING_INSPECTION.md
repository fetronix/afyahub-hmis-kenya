# Stationery CSV mapping inspection — before preview

## Verified source and scope

Inspected the actual supplied `Syrona_Stationery.csv` locally through the application's bounded literal CSV parser and `parseWorkbook` worker. Source: **39,236 bytes**, SHA256 **`244f9ba9bdd8f5a28793610cabfa8d931ecc76eff52b0fa553b11702e3f198e1`**. Original source bytes were not modified or committed.

**No live application preview, confirmation, upload, plan creation, migration or database mutation was executed.** No production or existing facility database was accessed. The destination supplied by the user (plan ID 1, Syrona Medical Center Annual Plan 2026, DRAFT / MIXED / KES / 5%) is left unchanged. Screenshots reproduce that destination with explicitly mocked API responses in an offline component harness; they are not screenshots of the user's live session.

## Exact mappings (inclusive, 1-based source record positions)

| Source category, spelling preserved | Heading row — exclude | First item row | Last item row |   Items | First / last description                                    |
| ----------------------------------- | --------------------: | -------------: | ------------: | ------: | ----------------------------------------------------------- |
| OPD CONSUMABLES                     |                     8 |          **9** |       **141** |     133 | Biotec SODIUM(Biochemistry Reagent) / Bin liner 30*36 (RED) |
| DENTAL CONSUABLES                   |                   144 |        **145** |       **184** |      40 | Upper posterior forcep / Bib Holder                         |
| CONSUMABLE ITEMS                    |                   185 |        **186** |       **244** |      59 | Toner - 217-A / Stapler big                                 |
| **Total**                           |                       |                |               | **232** |                                                             |

All three blocks use worksheet **CSV**, structure **Monthly item / ITEM**, description **B**, unit **C**, and **base price D**.

| Month     | Quantity column | Projected-cost column — excluded |
| --------- | --------------- | -------------------------------- |
| January   | F               | G                                |
| February  | H               | I                                |
| March     | J               | K                                |
| April     | L               | M                                |
| May       | N               | O                                |
| June      | P               | Q                                |
| July      | R               | S                                |
| August    | T               | U                                |
| September | V               | W                                |
| October   | X               | Y                                |
| November  | Z               | AA                               |
| December  | AB              | AC                               |

Column **E** is labelled **Price inclusive of 5% inflation** and is **not** the base-price input. It is excluded so the normal calculation pipeline does not apply inflation to an already-inflated price. Row 6 verifies Documents / Units / Price per item / inflation-adjusted price and Jan–Dec labels; row 7 verifies each alternating Units required / Projected cost pair. Projected-cost values are not trusted as quantity inputs (for example F186 is 1.00 while G186 is 5,000.00).

Do not map **1–8**, **142–144**, **185**, or **245–296** as items. This excludes titles, headers, category headings, separators, total and trailing empty records. Row **248** is TOTAL. Rows **142–143** have no item description or serial number but contain dash placeholders; they are not items and are not wholly empty CSV records.

## Why the parser says 296 rows

The application preserves every logical CSV record, including records whose cells are blank. `workbook-worker.mjs` maps the literal CSV records directly to the worksheet row array; it does not drop headers, blank rows or totals. Both the source-cell inspection table (`index + 1`) and later item source identity (`rows[n - 1]`, `sourceRow: n`) use those same positions.

For **this exact file**, there are **296 parsed records and 296 physical lines**; there are no quoted multiline cells causing an offset. Thus source row 145 means CSV record/line 145, not the first dental item serial number 1 from column A. There is **no parser-to-source-record numbering difference** here. Column A serials restart by category and include anomalies; they must not be used to calculate row ranges.

The 296 records consist of:

- **232 numbered item records**;
- **53 wholly blank records** (rows 4–5, 245–247, 249–296);
- **2 dash-only placeholder/separator records**, 142–143;
- **9 title/header/category/total records**, 1–3, 6–8, 144, 185, 248.

That is **64 excluded non-item records**, not 64 missing items. More generally, quoted newlines inside a CSV cell do not begin new logical source records, and a single terminal line ending does not add a phantom record. Tests cover that distinction. The CSV does not establish row numbering in any unavailable original Excel workbook; no such offset is inferred.

## Safe opt-in mapping implementation

A new pure helper recognizes **only the exact reviewed SHA256** and validates the parsed sheet name, 296-record shape, category positions, header pairs, total marker and numbered/described item spans. Unknown or changed files receive no automatic suggestion; matching a filename or category phrase alone is insufficient.

The existing authenticated upload/inspection responses can now include the verified suggestion. The existing batch inspection path recomputes the source byte hash rather than trusting a stale stored hash. It only reads the facility/tenant-scoped batch and parses its retained bytes; no audit or plan write is introduced by inspection.

The UI exposes **Use verified stationery mappings** as an explicit action. It fills the three local form blocks and clears any old local review state, without invoking preview or confirmation, changing destination assumptions, or making a write request. It does **not overwrite** an existing manual block. For the reported incomplete 1–1 block, remove that block first, then choose the verified mapping action. New or revised CSVs still require manual inspection unless separately verified.

Mapping is not source-value approval. The supplied file still has missing base prices on rows **90–94** and a missing unit on row **172**. This change does not fill or repair those cells; any future separately authorized preview must show the existing normalization/validation evidence. Dash/blank default policy and all import destination, permissions, review-hash, duplicate and audit protections remain unchanged.

**No schema migration is needed.** `verifiedMapping` is additive response metadata; no destination or source data is stored by the new mapping action.

## Tests and evidence

**39 tests passed across 6 files**, no skips in this run:

- `src/tests/stationery-mapping.spec.ts`: 13 passed, using the actual supplied source with explicit `SYRONA_SOURCE_DIR`; tests SHA256, bytes/records/physical lines, exact ranges and boundaries, all mapped/excluded columns, no source mutation, and fail-closed behavior for changed bytes, shifted rows, blank items, totals, headings, sheet or headers.
- `src/tests/stationery-mapping-api.spec.ts`: 1 passed; actual source parsing with mocked scoped SQL, only BEGIN / scoped SELECT / COMMIT permitted. No real database needed.
- `src/tests/vitest/stationery-mapping-ui.spec.tsx`: 3 passed; local-only fill, no overwriting existing mappings, no action for unverified source.
- Existing destination UI: 8 passed; history UI: 7 passed; planning sections UI: 7 passed. These are mocked UI regression tests, not live import operations.

```sh
SYRONA_SOURCE_DIR=/tmp/arena-coding-uploads npx vitest run \
  src/tests/stationery-mapping.spec.ts \
  src/tests/stationery-mapping-api.spec.ts \
  src/tests/vitest/stationery-mapping-ui.spec.tsx \
  src/tests/vitest/planning-import-destination-ui.spec.tsx \
  src/tests/vitest/planning-import-history-ui.spec.tsx \
  src/tests/vitest/planning-sections-ui.spec.tsx
```

Typecheck, frontend build and server build passed. Frontend build emitted the existing large-chunk advisory. Scoped ESLint and Prettier checks passed. This is not a claim that the full repository or live database mutation suite was executed.

Offline Chromium: **11 checks passed**, no browser runtime errors, no unexpected API/network requests and zero mutation calls, including zero preview calls. The verifier uses the real React component and parsed supplied source, while all plan/history responses are mocked; no login or database is needed. Its local server is closed on completion.

Evidence in `docs/audits/stationery-mapping-evidence/`:

- `01-incomplete-block-offline.png` — reproduces the incomplete block and verifies it cannot be silently overwritten.
- `02-verified-mappings-offline.png` — all three blocks filled, original category labels, expected columns and existing destination retained.
- `browser-results.json` — 11 checks and source/range provenance.
- `source-inspection.json` — exact parsed header cells, source hash, excluded/blank positions, boundary descriptions and missing-cell rows.
- `test-results.txt` — focused test output.

Browser reproduction: build the frontend, then run `SYRONA_SOURCE_DIR=... CHROME_EXECUTABLE_PATH=... npx tsx scripts/verify-stationery-mapping-browser.ts` with any environment-specific Chromium flags/libraries. The script refuses unrecognized source bytes and blocks all API requests and mutation methods.

## Exact changed files

Application:

1. `src/budget-planning/stationery-mapping.ts` (new)
2. `src/budget-planning/planning.service.ts`
3. `src/components/modules/planning/PlanningImport.tsx`

Tests/verifier:

4. `src/tests/stationery-mapping.spec.ts` (new)
5. `src/tests/stationery-mapping-api.spec.ts` (new)
6. `src/tests/vitest/stationery-mapping-ui.spec.tsx` (new)
7. `scripts/verify-stationery-mapping-browser.ts` (new)

Documentation: this report plus the five evidence files listed above. No original CSV, credentials, runtime packages or scratch database files are included.

## Git preservation

Current branch remains **`arena/e088f11d-afyahub-hmis-kenya`**. The initial checkout again had old local history (`0111b55`) despite its 1,446 working files exactly matching published tip `da3e43f`. Before editing, a SHA256 inventory was saved, all existing work was retained in a recovery stash, and this same branch was fast-forwarded to its published tip. Every baseline file was verified byte-identical after that operation. The recovery stash is retained; no reset, clean, branch switch, force-push or history rewrite was used.

Only the task files above are staged for the new commit. A final baseline comparison verifies that only the two intended existing application files changed; all other changes are task additions. Commit hash and push result are returned in the delivery message.
