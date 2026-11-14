# Budget & Procurement Planning — cancelled import-history investigation

## Result and evidence boundary

**A reproducible workflow defect is fixed and tested. The actual incident's cancellation actor/time/reason remains unverified because this checkout has no configured connection to the affected database.**

No actual Syrona batch or plan was accessed or changed. No production import, preview, migration, retry, or reactivation was performed. Nothing was committed or pushed in this task.

The supplied UI evidence identifies Stationery batch **2** and Branding batch **1**, both CANCELLED / Not previewed, and a 2026 annual DRAFT / KES / revision 1 / 5% plan. Those facts were used to reproduce the problem in a **new disposable synthetic facility**, not treated as a database/audit extract.

## Findings against the six requests

| Request                                             | Finding                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inspect actual batches and audits                   | **Blocked:** no runtime SQL configuration, saved database, affected tenant/facility IDs, or authorized live database connection is present. A scoped, read-only diagnostic is supplied below. Synthetic database records and audit events were inspected separately.                                                                                                    |
| Establish why/when/by whom cancellation occurred    | **Not established for either actual batch.** The application mutation path is known, but a screenshot cannot identify its caller or time. Do not substitute the synthetic cancellation timestamps/actor for the real incident.                                                                                                                                          |
| Are cancelled batches intentionally non-reviewable? | Preview and confirmation are intentionally closed by server state guards. Read-only inspection is already allowed by `inspectBatch`; the UI was hiding it.                                                                                                                                                                                                              |
| Why does uploading still say “already uploaded”?    | Deduplication looks up the file's SHA-256 regardless of status; the schema also has `UNIQUE(facility_id, sha256)`. Cancellation preserves the batch/source/hash. The generic error incorrectly directed users to an actionless cancelled history row.                                                                                                                   |
| Should history offer safe retry/re-upload?          | Yes: read-only inspection, plus an **explicitly confirmed, audited retry of review of the same unapplied batch**. Re-uploading identical bytes must not create another batch or silently reopen anything.                                                                                                                                                               |
| Can the 2026 draft be selected?                     | A second UI defect restricted targets to the workspace's currently filtered/paginated plan list. The fix independently loads the facility's drafts for the import year, across pages. Selection of a matching 2026 DRAFT / KES / revision-1 / 5% target passed browser and component tests. Availability of the actual database row still requires the read-only check. |

## Exact demonstrated root cause

Three existing behaviors combined into the dead end:

1. `cancelImport` changes a pending batch from UPLOADED to CANCELLED, retaining source bytes, hash, validation/result fields and upload metadata. `previewImport` and `confirmImport` reject a cancelled batch.
2. `upload` checks the stored file hash without distinguishing CANCELLED from other statuses, and the database uniqueness constraint continues to reserve that hash. The old message always said to use the history entry.
3. `PlanningImport` rendered a history action only when `status === 'UPLOADED'`. Cancelled rows had neither a source-inspection action nor an explicit recovery path.

Consequently, the very history row recommended by the upload error had no action. **This explains the reported inability to proceed; it does not explain who originally cancelled the two actual batches.**

The target-selection defect was separate: `PlanningWorkspace` passes a filtered page of plans, and `PlanningImport` previously used only that page as the complete target list. A valid draft on another page or outside navigation filters could disappear from the selector.

## What can and cannot be said about cancellation

- The application path is authenticated `POST /api/budget-planning/imports/:id/cancel`, protected by the existing facility scope and `accounting.planning.import` permission.
- The UI calls it only after **Cancel pending import** and the browser confirmation dialog. Inspection, upload, duplicate detection, leaving the page, and parse/preview errors do not call cancellation in the reviewed code.
- The reviewed module/schema has no cancellation expiry, scheduled cleanup, worker transition, or database trigger that automatically cancels these batches. Other callers could still issue the authenticated endpoint or mutate a database externally.
- A successful service cancellation records **CANCEL_IMPORT** in `planning_events`, linked by **import_id**, with **actor_id** and **created_at**, and an entry in `audit_logs`.
- Legacy cancellation events have null `plan_id` and may have null `entity_id`/previous/updated values. Filtering audit events by the selected plan can therefore miss them. Look up `import_id`, not just the annual plan ID.
- The batch's `created_at` is the **upload** time, not the cancellation time. “Not previewed” is the UI's rendering of no current `validation`/`result`; it is not an explanation of cancellation.
- Existing cancellation events do **not** record a reason or whether the caller was a human browser interaction versus an authenticated script. Actor/time evidence plus server access/request logs may establish more, but the event alone cannot prove a human clicked the button.

For both actual batches, **actor, cancellation time, originating client and reason remain unknown** until the actual records are retrieved. If no matching cancellation event exists, treat the state as unexplained and investigate deployment versions/direct database changes; do not invent an automatic transition or reactivate it as a substitute for investigation.

## Narrow fix

### Cancelled inspection and explicit retry

- History now explains why a cancelled batch is closed and offers **Inspect cancelled batch N** and **Retry review of batch N**.
- Inspection shows retained source cells read-only; formulas remain displayed as text. It cannot preview or confirm an import.
- The duplicate-upload message names the cancelled batch and explains the explicit retry path. The file input resets after selection, allowing the same file to be selected again after an error.
- New `POST /imports/:id/retry-review` uses the existing authenticated scope and import permission. It requires `confirmRetry: true`, locks the batch, and accepts only CANCELLED batches with no result, linked plan/item/uniform data, or historical CONFIRM_IMPORT event.
- Retry reuses the existing batch identity and source bytes/hash. It does **not** upload/clone another batch or create/modify a plan. A new `RETRY_IMPORT_REVIEW` event records actor/time, previous status/validation and new status, with the old cancellation events untouched.
- A retry clears the current saved preview but retains its prior validation in the retry audit. Fresh preview and the existing separate import confirmation are still mandatory. Concurrent retries allow only one transition; stale previews, already open/imported batches, and suspicious applied-data states are rejected.
- **The endpoint is not called on upload, inspection, mounting, or navigation.** Actual incident batches were not retried during this task.

### Target selector

Import targets are loaded independently using the existing scoped `/plans` API with `status=DRAFT`, the selected import year and all returned pages. The user must explicitly choose a target. The selector shows currency/inflation/revision, and confirmation is disabled without a selected loaded target in merge mode. Existing server draft/version/year/inflation guards are unchanged.

No schema, migration, parser, calculation, source identity, import-deduplication rule, unrelated module, approval rule or existing audit event was rewritten.

## Files changed

Existing files changed:

1. `src/budget-planning/planning.service.ts` — status-aware duplicate message and explicitly confirmed retry-review service; cancellation/confirmation behavior otherwise retained.
2. `src/budget-planning/planning.routes.ts` — scoped, permission-protected retry-review endpoint.
3. `src/components/modules/planning/PlanningImport.tsx` — cancelled inspection/retry UI, safe file reselection and independently paginated draft-target lookup.
4. `src/tests/budget-planning.db.spec.ts` — four new database/API safety regressions.

New diagnostic/verification files:

- `scripts/diagnose-planning-import-history.sql` — read-only, tenant/facility-scoped incident extract for batches 1 and 2.
- `src/tests/vitest/planning-import-history-ui.spec.tsx` — seven focused UI regressions.
- `scripts/verify-planning-import-history-browser.mjs` — synthetic-only browser verification; never confirms an import.
- This report and `docs/audits/planning-import-history-evidence/` — logs, screenshots, explicitly labelled synthetic diagnostic results and preservation evidence.

The repository contained extensive pre-existing dirty/untracked work. A preservation inventory found only the four existing files above changed by this task and **no missing files among 1,415 baseline files**. Temporary database/runtime files and credentials remain ignored under `.tmp-tools`.

## Tests run

| Verification                                              | Result                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Seven targeted test files, database required              | **82 passed, 0 skipped**                                                                         |
| Real authenticated Chromium against the built application | **16 checks passed**, no runtime errors                                                          |
| TypeScript typecheck                                      | Passed                                                                                           |
| Client and server builds                                  | Passed; existing large-client-chunk advisory remains                                             |
| Scoped ESLint                                             | Passed, no diagnostics                                                                           |
| Prettier on changed TS/TSX/MJS                            | Passed                                                                                           |
| Read-only diagnostic SQL                                  | Executed successfully against the disposable reproduction, before and after browser verification |

The tests cover: non-mutating cancelled inspection and duplicate uploads; rejecting retry confirmation; requiring permission/authenticated facility scope; one successful concurrent retry; preserving original bytes/hash/metadata and old audit rows; blocking imported/result-bearing/linked-data batches; invalidating stale previews; and selecting the draft even when it is absent from the parent navigation page.

The browser reproduction used the supplied CSV bytes, explicitly cancelled both synthetic batches during fixture setup, dismissed one retry prompt, then explicitly retried **only synthetic batch 2**. It sent **no preview or confirm request**. Synthetic batch 1 stayed cancelled; the target plan/categories/items/uniforms remained unchanged. Existing backend regression tests exercise their normal imports only in a separate disposable test database.

Evidence:

- [Browser results](planning-import-history-evidence/browser-results.json)
- [Browser log](planning-import-history-evidence/browser-checks.txt)
- [Test log](planning-import-history-evidence/tests.txt)
- [Synthetic diagnostic before](planning-import-history-evidence/synthetic-diagnostic-before.json) / [after](planning-import-history-evidence/synthetic-diagnostic-after.json) — **not the actual incident records**
- [Cancelled history actions](planning-import-history-evidence/01-cancelled-history-actions.png)
- [Cancelled Branding source inspection](planning-import-history-evidence/02-inspect-cancelled-1.png)
- [Cancelled Stationery source inspection](planning-import-history-evidence/02-inspect-cancelled-2.png)
- [Existing 2026 draft selected](planning-import-history-evidence/03-selected-existing-draft.png)

## Safe next action for the user

1. **Before changing the actual batches**, have an authorized operator run `scripts/diagnose-planning-import-history.sql` read-only against the affected environment, supplying the actual tenant/facility IDs using psql variables. Connection details belong in the operator's secure environment, not chat. The script returns no source bytes, tokens or passwords and ends with ROLLBACK. Review/share the relevant batch and event rows securely so the real cancellation actor/time can be established; use request/access logs for client attribution if available.
2. Keep the original CSV files unchanged. Do not rename/edit files merely to evade the hash guard, delete history, manually change statuses, or create another annual plan as a workaround.
3. After the fix is reviewed and deployed to the intended environment, use read-only inspection first. If the audit confirms a cancelled batch is unapplied and retry is desired, explicitly choose **Retry review** for that batch and accept its clearly described confirmation. Nothing is automatically reopened.
4. Choose **Merge into draft — skip matching source rows**, import year **2026**, and the existing **Syrona Medical Center Annual Plan**. Verify DRAFT / KES / revision 1 (or its current actual revision) / 5% and review mappings/normalization evidence. **Stop before Confirm import** pending the separate authorized import decision.

Production import/migration remains out of scope. The code fix is locally implemented and verified, not a claim that the affected live environment has been repaired or its incident fully attributed.
