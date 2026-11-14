# Planning import outcomes, notifications and audit visibility

## Scope and safety

Implemented on `arena/e088f11d-afyahub-hmis-kenya`. This change is limited to planning import visibility and review. No production connection, production migration/import, staging, commit, push, reset or branch switch was performed. The task-start SHA256 inventory confirms only the six existing files listed below were modified; unrelated preexisting work was preserved.

**No schema changes or new migrations.** Evidence is stored in existing import-batch validation/result JSON and planning audit records. The existing 97 migrations were applied only to a disposable synthetic PostgreSQL database for verification. No parser/mapping/calculation redesign or expenditure, purchase order, inventory movement or GRN creation was introduced.

## Delivered behavior

- Upload, preview, confirmation, importing, completion, warning, failure and cancellation messaging use plain-language outcomes. Preview explicitly states that no annual-plan records have been imported. In-flight UI state is not presented as a committed receipt.
- Dismissible action notices link to reopenable batch results. Persisted history/results survive component reload; notices themselves are not a separate notification-inbox database.
- History supports refresh and 100-batch pages; every accessible batch can open its full results. Summary indicators cover all facility batches, not just the history page. Selected-plan imported-record counts query actual active imported item/uniform records, not preview counts or unrelated manual entries.
- Confirmation remains explicit and bound to the reviewed destination/content hash. Destination, facility, financial year, conflicts, valid/invalid rows, create/update/skip operations and defaulting implications remain reviewable. Mapping/destination edits invalidate review.
- Results show actual created/updated IDs, skipped/rejected/excluded/rolled-back rows, reasons and corrective recommendations. All/Successful/Warnings/Skipped/Failed filters, 100-row/default-entry display pages and whole-evidence CSV exports are available.
- Worksheet/row, duplicate-name identity, raw source values, reviewed/stored values and supplied/defaulted/normalized/recalculated origins are retained. Missing values, dashes and explicit zero remain distinguishable; ZERO_FILL is visibly a default, not an attested source value. Skipped rows clearly show reviewed source values rather than claiming those values were written.
- Lifecycle events include upload/review/confirmation/result evidence with available actor/time, filename, hash, destination, counts and failure details. Legacy unavailable provenance/counts are marked unknown/unavailable, not fabricated.
- Successful counts derive only from an `IMPORTED` batch with its committed result: created + updated. Uploads, previews, rejected/skipped rows and rolled-back writes do not count as imported.
- Confirmation writes, receipt and audit remain in one transaction; response follows COMMIT. A replay returns the stored result. Failed confirmation evidence is persisted separately only while the batch remains pending; valid preview rows in that failed attempt are shown as `ROLLED_BACK`. A transport failure alone is reported as unverified, not proof of rollback.
- Existing facility/tenant scope, read/import/export permissions, DRAFT protection and transaction/idempotency rules are preserved. Read-only users can inspect outcomes without upload/confirmation controls. CSV downloads use authenticated requests, require export permission and neutralize spreadsheet formula prefixes.
- Cancelled batches remain inspectable without automatic reactivation; retry is explicit, audited and requires fresh review/confirmation.

## Endpoints

All paths below are under `/api/budget-planning`; existing authentication, planning read permission and facility scope apply.

| Endpoint                                                    | Purpose                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /imports?facilityId=…&page=…`                          | Scoped history, 100 batches/page; rejects invalid pages                                       |
| `GET /imports/summary?facilityId=…&planId=…`                | All-batch indicators and optional selected-plan imported-record count                         |
| `GET /imports/:id/results?facilityId=…`                     | Reopenable batch, row evidence, lifecycle and committed counts                                |
| `GET /imports/:id/results.csv?facilityId=…&errorsOnly=true` | Errors/warnings CSV; omit/disable errorsOnly for all results; also requires export permission |

Existing upload/preview/confirm/cancel/retry endpoints remain in use. Outcome evidence was added around those operations rather than introducing a parallel import pipeline.

## Exact implementation files

### Existing files modified (six)

1. `src/budget-planning/import-destination.ts` — canonical key-order-independent review hashing for PostgreSQL JSONB round trips; content/destination binding preserved.
2. `src/budget-planning/planning.service.ts` — durable preview/failure and postcommit receipt evidence, actual row outcomes/IDs, audit lifecycle and paginated history; historical normalization response compatibility retained.
3. `src/budget-planning/planning.routes.ts` — scoped summary/results/CSV endpoints and history page parameter.
4. `src/api/clients/planning.client.ts` — authenticated result/error CSV downloads.
5. `src/components/modules/planning/PlanningImport.tsx` — notices, reopenable results, explicit action states, paginated history/loading and safe refresh-failure wording.
6. `src/components/modules/planning/PlanningWorkspace.tsx` — read-only import-history access and overview without requiring a selected plan.

### New source, tests and verification script

- `src/budget-planning/import-outcome.ts` — shared lifecycle labels, committed counts, indicators and formula-safe rectangular CSV encoding.
- `src/budget-planning/import-review.ts` — reporting-only row/default/duplicate/rejection/source-origin evidence.
- `src/budget-planning/import-results.service.ts` — scoped repeatable-read results/summary and CSV generation.
- `src/components/modules/planning/ImportResults.tsx` — notices, summary, filtered/paginated results, lifecycle, provenance and export controls.
- `src/tests/planning-import-outcomes.spec.ts` — 16 pure behavior tests.
- `src/tests/planning-import-outcomes.db.spec.ts` — 13 disposable-database/API tests.
- `src/tests/vitest/planning-import-outcomes-ui.spec.tsx` — 12 UI tests, including result pagination.
- `scripts/verify-planning-import-outcomes-browser.ts` — read-only component-browser evidence harness.

### Report and evidence

- `docs/audits/PLANNING_IMPORT_OUTCOMES.md` — this report.
- `docs/audits/planning-import-outcomes-evidence/01-preview-not-imported.png`
- `docs/audits/planning-import-outcomes-evidence/02-committed-results-and-warnings.png`
- `docs/audits/planning-import-outcomes-evidence/03-failure-lifecycle.png`
- `docs/audits/planning-import-outcomes-evidence/browser-results.json`

Disposable runtime, snapshot exporter, task-start inventory and fixture data are local verification helpers under `.tmp-tools/import-outcomes/`, not application deliverables or production inputs. Build outputs/dependencies follow existing ignored-directory conventions.

## Verification results

| Verification                                                                                                                                | Result                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Focused regression: 15 suites spanning outcomes, destination, budget planning, stationery mapping, ZERO_FILL, reconciliation and related UI | **179/179 passed**, no skips                       |
| Final UI rerun after history refresh/loading edits: outcome/history/destination suites                                                      | **27/27 passed**                                   |
| Final TypeScript `npm run typecheck`                                                                                                        | **Passed**                                         |
| Final scoped ESLint, all 14 source/test/script files above                                                                                  | **Passed**, zero warnings/errors                   |
| Final scoped Prettier check, same files                                                                                                     | **Passed**                                         |
| Final frontend `npm run build`                                                                                                              | **Passed**; large-chunk warning remains            |
| Final server `npm run build:server`                                                                                                         | **Passed**                                         |
| Final read-only Chromium verification                                                                                                       | **8/8 passed**, no runtime errors or API mutations |

The 179-test run used the disposable database with required-DB checking and `SYRONA_SOURCE_DIR=/tmp/arena-coding-uploads`, including the available official-source fixture regression. The subsequent UI-only edits were verified by the 27-test rerun plus typecheck, lint, builds and refreshed browser evidence.

### Evidence for preview ≠ import and accurate committed counts

The database suite directly verifies:

1. Upload and successful preview leave **zero plan records and zero imported counts**.
2. Confirmation resolves only after COMMIT; reopened counts, record IDs, physical database records and audit agree.
3. Missing/dash/explicit-zero, duplicate-name and recalculated-value distinctions survive storage.
4. Rejected rows remain preview evidence; current imports are atomic, not partial.
5. A failure on a later row rolls back earlier writes; the result has **zero imported counts**, no successful import audit events and `ROLLED_BACK` rows. Corrected retry followed by replay produces only the intended records.
6. A deferred COMMIT failure never publishes a success result/count.
7. SKIP does not inflate imported counts; UPDATE reports actual affected IDs separately from CREATE and SKIP.
8. Cancellation/retry stays on the same batch without duplicate uploads.
9. Results and selected-plan summary are tenant/facility isolated; history is scoped and paginated while summary totals all batches.
10. Legacy provenance is not invented; read-only/import/export/unauthenticated access is enforced.

An earlier broad run exposed a history-normalizations compatibility failure; it was fixed without changing calculation semantics. The final 179-test run is green. Final frontend output still warns about a chunk exceeding 500 kB; unrelated code splitting was not attempted.

## Limitations and rollout cautions

- Verification is synthetic/disposable, not a production import or deployment certification. Production needs authorized tenant/facility/year/currency context and review of its existing deployment/migration state.
- Browser evidence renders the actual React components using read-only snapshots exported from the synthetic database. It is **not** a live authenticated end-to-end session. The browser export action is mocked; authenticated CSV authorization/content is exercised by API/database tests.
- Legacy batches may lack original row-level/raw/default/actor evidence. The UI reports unavailable evidence rather than reconstructing unprovable facts.
- Unexpected internal SQL errors are intentionally sanitized in user-facing failure evidence; validation errors and safe corrective guidance remain visible. Internal diagnostics are not exposed as raw database exceptions.
- Current confirmation is atomic, so newly executed failures do not create partial imports. The partial label supports stored outcomes without relaxing this guarantee.
- Row/default pagination limits rendered elements, but the results endpoint still returns the full persisted evidence; it is not server-side row streaming. Summary currently reads all scoped batch summary metadata.
- No asynchronous worker or cross-tab progress channel was added. During a request the UI shows importing; after an interrupted connection the authoritative state must be reopened from the server.
