# Radiology consent placement and central document visibility

> **Superseded (UI):** the signature-metadata upload form and its browser harness were replaced by the simplified upload and doctor self-verification described in [RADIOLOGY_CONSENT_SIMPLIFICATION_ACCEPTANCE.md](RADIOLOGY_CONSENT_SIMPLIFICATION_ACCEPTANCE.md). The evidence below is retained as the historical record of that earlier delivery and is not a current test result.

## Outcome and location

On the existing **Radiology & Imaging → selected request → Radiology Report** screen, the retained **Procedure-specific radiology consent · request #…** panel now appears **above Findings/Impression**. Its internal sequence is:

1. Required/not-required policy, consent status, exact procedure/request, selected patient and whether authorized exceptions are permitted.
2. **Upload signed consent**. This opens the request-specific form immediately above the attachments, before verification. Choose a validated PDF/JPG/JPEG/PNG, see its filename, preview the local selection or replace it, record signing date and independent patient/doctor signature assertions, and select the named responsible doctor. **Save signed consent** uploads; it does not verify or release it.
3. **Attached consent documents · request #…**. Exact-request attachments show title/category/type, signing/upload dates, named doctor, signature assertions, version/latest/superseded state, retrieval and request-verification state. Controls retrieve the original, show details/version/audit history, create an immutable correction, or open the same document in Patient Management.
4. **Review and verify this procedure consent**. Select an attached version, retrieve its saved original, check the confirmation, provide an audit reason, then use **Verify this procedure consent** if authorized. The clinician ID comes from the saved document, not a typed ID. Exceptions remain separate, explicit, facility-policy and permission gated; the UI uses the authenticated active Doctor identity.

There is no second full generic upload form at the bottom of Radiology. Patient Management retains its existing general upload, search/type/date filters, original preview/download, details, version/history/audit and deliberate portal-release controls.

## One repository, no duplicate records

Radiology and Patient Management use the same existing `patient_signed_documents` records, original bytes, IDs, immutable version roots, audit events and release records. The existing upload endpoint persists the selected patient plus the server-validated `radiologyOrderId` and server-read procedure name. Central visibility is not a copy or synchronisation job.

Central entries display source/context. Radiology entries show **Radiology consent**, request number and procedure title. General entries remain general; laboratory/other clinical category labels explicitly disclose when no linked request is recorded, rather than inventing an association. This task does not add laboratory or other source-request schemas.

- **Open in Patient Management #document** navigates from Radiology to the selected patient's **Consent & Signed Documents** tab and focuses the same ID.
- **Open imaging request #request** returns from the central entry to its matching patient/request in Radiology. This control is gated by the existing radiology module visibility and worklist-read permissions (`clinical.read` or `laboratory.read`), not an unrelated catalogue-reader permission.
- Handoffs include tenant/facility/patient/request/document scope. Scope clearing removes the handoff; an in-flight reverse lookup is discarded after scope change, unmount or request reselection. Destination APIs remain authoritative.

General central uploads have no radiology link and cannot satisfy procedure-specific consent. Original signed bytes remain immutable; corrections create a new ID/version with a reason and audit trail. Superseded versions remain accessible to authorized staff and cannot verify the request.

## Portal appearance

No upload automatically appears in the portal. A separately authorized **per-version release** is still required. After release, the patient sees that version's title/type/dates/version and original preview/download under **My Documents & Signed Consents**. Unreleased originals, other general uploads, staff notes, audit history, clinician controls and verification controls are not exposed. Patient-own authentication and existing portal download policy remain enforced.

## Implementation scope

### Backend / client

- `src/documents/patient-documents.service.ts`: optional exact-request patient-list filter with patient/request validation; staff-only named doctor, latest-version and current-actor original-retrieval projection; consent response includes exact request and eligible session Doctor; cancelled-request uploads rejected; verification/exception clinicians must satisfy the existing active same-facility Doctor predicate. Verification additionally rejects an actor who has not retrieved this original version (`CONSENT_REVIEW_REQUIRED`,409).
- `src/api/patient-documents.client.ts`: typed optional latest/retrieved indicators.
- No new API route, document storage, database migration, permission code, production role grant or parallel consent module. Existing immutable-version rules, file validation, transactional audit, procedure completion guard and portal projections remain in place.

Original retrieval is transport evidence, **not proof a person read or authenticated a signature**. The UI requires a separate review confirmation; stored signature statuses remain staff assertions, not cryptographically authenticated e-signatures.

### Frontend

- `RadiologyConsentPanel.tsx`: status → reusable request upload/attachments → review/verify; no raw document/clinician ID inputs.
- `PatientDocumentsPanel.tsx`: request-workflow mode reuses the central form, validated upload, retrieval, correction and history; local selected-file preview/replacement; source/version/detail display and navigation. General central mode remains available.
- `RadiologyModule.tsx`: consent precedes Findings/Impression; scoped bidirectional request navigation.
- `PatientJourneyModal.tsx` / `HmisContext.tsx`: scoped repository-tab/focus handoff.

## Fresh verification

Actual production-built Vite SPA + bundled Express + normal authenticated Chromium143 staff and portal sessions, against newly added synthetic fixtures in the independently attested disposable PostgreSQL16 cluster on loopback55439. No HTTP/SQL interception, production connection, production migration, patient data or real signed document was used. Synthetic fixture role grants are confined to the disposable fixture tenant. The existing patient-record loader's read-only prerequisites are reused, not granted to real roles.

| Check                                                                                                      | Result                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Built-app browser/real-DB acceptance (`scripts/radiology-consent-acceptance.ts`)                           | **35 checks passed**; no uncaught staff browser errors or same-origin500 responses                                                                             |
| Focused Vitest: signed documents/consent + responsible doctor HTTP/DB + document UI + workflow regressions | **94 passed across4 files**,0 failed,0 skipped                                                                                                                 |
| Signed-document/consent real-DB suite included above                                                       | 43 passed, including changed procedure, missing/superseded consent, immutable originals, exceptions, portal policy and completion SQL                          |
| TypeScript `tsc --noEmit --singleThreaded` with bounded resources                                          | Passed                                                                                                                                                         |
| Scoped ESLint                                                                                              | 0 errors;4 React effect/set-state warnings (including existing module-loader warnings); no rule disabled                                                       |
| Frontend and bundled server builds                                                                         | Passed; Vite large-chunk warning remains                                                                                                                       |
| Scoped Prettier and `git diff --check`                                                                     | Passed                                                                                                                                                         |
| Actual retrieved PDF                                                                                       | Byte-identical to fixture; independently parsed/text-extracted/rendered using PyMuPDF; complete one-line synthetic content visually inspected with no clipping |
| Narrow consent-panel layout                                                                                | 390px browser viewport; no internal horizontal overflow; screenshot inspected                                                                                  |

### Requested acceptance matrix

| #   | Scenario                                    | Evidence/result                                                                                                                                             |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Upload inside Radiology before verification | PASS, actual UI upload and local-file preview; panel ordered above Findings.                                                                                |
| 2   | Same document in central repository         | PASS, actual reverse navigation and exactly one matching persisted ID.                                                                                      |
| 3   | Exact request/procedure link                | PASS, persisted API metadata and source/context entry.                                                                                                      |
| 4   | Other patient rejection                     | PASS, wrong patient/request list rejected and original retrieval404; scoped DB negatives also pass.                                                         |
| 5   | Other request cannot reuse consent          | PASS, direct verification denied and separate request attachment list empty.                                                                                |
| 6   | Preview actual original                     | PASS, saved-original UI iframe retrieval plus byte-for-byte authenticated file retrieval and independent PDF inspection.                                    |
| 7   | Metadata/clinician survive refresh          | PASS, actual browser reload displays doctor and signing date.                                                                                               |
| 8   | Unauthorized verification                   | PASS, normal records-staff login receives403 on direct verification. Before-original-retrieval verification also returns409.                                |
| 9   | Cancellation safe                           | PASS, cancelled-request upload and verification rejected by backend.                                                                                        |
| 10  | Portal only after explicit release          | PASS, separate normal portal login sees nothing before release and only the released correction afterward.                                                  |
| 11  | Immutable correction versions               | PASS, UI creates version2/new ID with preserved original hash; verification invalidated; DB suite checks immutable-byte update rejection and audit history. |
| 12  | General central uploads remain              | PASS, actual general UI upload succeeds without radiology association; central UI/filter/history and assignment regression tests pass.                      |

The integration completion test still exercises the real PostgreSQL guard: missing consent blocks completion; verification allows it; a new correction or changed procedure blocks it. No bypass was introduced to make browser acceptance pass. Broader historical Reporting Centre/export test totals are **not** counted as fresh verification for this task.

## Evidence and reproducibility

See [results.json](radiology-consent-evidence/results.json) for synthetic fixture IDs and35 named assertions; [verification-summary.json](radiology-consent-evidence/verification-summary.json), `SOURCE_SHA256SUMS`, `BUILD_SHA256SUMS` and `SHA256SUMS` anchor source/build/evidence content without retaining credentials or runtime/database files.

- [Radiology status/upload/attachments/review sequence](radiology-consent-evidence/01-radiology-verified.png)
- [Central source and request navigation](radiology-consent-evidence/02-central-source.png)
- [Explicitly released portal correction](radiology-consent-evidence/03-portal-release.png)
- [Narrow-screen consent panel](radiology-consent-evidence/04-mobile-consent.png)
- [Downloaded original render](radiology-consent-evidence/05-downloaded-original.png), [synthetic original PDF](radiology-consent-evidence/synthetic-original.pdf), [extracted text](radiology-consent-evidence/synthetic-original-text.txt)

Run the focused browser harness only with an independently attested disposable fixture environment and controlled Chromium, after `npm run build` and `npm run build:server`:

```sh
RESPONSIBLE_DOCTOR_SYNTHETIC=YES node --import tsx scripts/radiology-consent-acceptance.ts
```

The harness deliberately reuses the existing independently attested doctor fixture guard. Secrets/env/runtime tools stay ignored. Evidence preserves the sandbox runtime timestamps (its clock reports2026-11-15); those timestamps are not a claim about production deployment or the session's calendar date.

## Limits / delivery

This is synthetic functional acceptance, not deployment, production validation, legal consent certification, clinician licensing validation or e-signature authentication. Headless Chromium does not certify every browser's embedded PDF renderer; the unchanged original download is the fallback. The mobile screenshot covers the narrow panel; it is not certification of every unrelated application screen. No Reporting Centre, letterhead, finance, procurement or other clinical workflow was redesigned.

Delivery is a task-specific ordinary commit on the existing `arena/e088f11d-afyahub-hmis-kenya` branch (parent `71dbf32250809f151f36329592660e926dcafd88`). The enclosing Git commit identifies the delivered source; the final handoff records its SHA and push result. No branch switch, reset, clean, rebase, force-push or history rewrite was used.
