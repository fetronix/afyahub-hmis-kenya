# Simple patient document upload — acceptance report

## Delivered experience

Both **Patient Management → Consent & Signed Documents** and **Radiology → Procedure-specific radiology consent · request #…** now use the same simple upload form:

1. **Document title** — required, maximum180 characters.
2. **Notes (optional)** — optional textarea, maximum2000 characters.
3. **Original file (PDF/JPG/JPEG/PNG)** — required; original filename, local preview and replacement controls remain available.

The submit button is **Upload document**. No doctor lookup or clinical metadata is required before uploading, including for an authorized non-doctor records user. Corrections use the same three-field form and create a new version; they never overwrite the original.

The introduction is exactly:

> Original files are preserved. Uploading a document does not automatically verify signatures or release it to the patient portal.

### Removed from the normal upload UI

- Document category.
- Consent/document type.
- Signing date.
- Document audit reason.
- Responsible doctor selection and its doctor-search control.
- Patient signature status.
- Doctor signature status.

These database fields and the existing explicit clinical-metadata API behavior were **not deleted**. Existing metadata remains available in document details and version history. Search/title/type/signing-date filters remain unchanged.

### Simplified document cards

Staff see the title, supplied notes, upload date, scoped uploader name, original filename, version, preview/download, details and version/audit history. Radiology entries additionally show imaging request number and procedure title, with existing navigation to/from the central repository. Clinical signature metadata is no longer crowded onto the normal card; it remains in details/history and the separate consent-review section.

Portal records still use the restricted patient-own projection. Internal notes and staff identities are not newly exposed to the portal just because the staff card was simplified.

## Server-managed values and safeguards

The existing upload endpoint accepts a simple metadata envelope (the UI sends `uploadMode: 'SIMPLE'`). Title/file-only metadata without clinical fields also selects the simple path. Server-managed values are:

| Field                    | Simple upload value                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Patient                  | Authorized patient in the existing URL/request context                                                             |
| Tenant/facility/uploader | Authenticated server context, not caller-supplied identity fields                                                  |
| Category/type            | `Document` / `Patient document`; linked Radiology uploads use `Radiology` / `Radiology procedure document`         |
| Patient/doctor signature | Both **UNKNOWN**, even if forged Present values accompany SIMPLE mode                                              |
| Signing date             | Null; never fabricated from upload date                                                                            |
| Responsible doctor       | Null; the uploader is not silently declared responsible or a signatory                                             |
| Notes                    | Supplied text, or null when blank                                                                                  |
| Audit reason             | Server-generated operation description for upload/correction; actor, timestamp and version events remain persisted |
| Portal release           | No release is created automatically                                                                                |

Simple corrections retain the prior category/type and exact request association, record the previous document ID in audit facts, and reset clinical assertions to Unknown/null for the replacement file. Existing versions are unchanged. The explicit rich metadata path still validates responsible doctors, delegation authority, signing dates and independent signature assertions; its existing20-test HTTP/database suite still passes.

### Radiology linking

The Radiology screen supplies its selected request ID without a manual field. The server validates the request against the authorized patient/facility and reads the actual procedure title from that request. Caller-supplied procedure/facility/uploader fields cannot redirect the stored record. The same persisted ID appears exactly once in the central patient repository; navigating to Patient Management does not copy the stored file.

Cancelled-request uploads, wrong-patient links, unrelated/general-document verification, unauthorized access and unauthorized verification remain rejected. File content/MIME/extension/size checks, immutable originals, transactional audit, latest-version checks and the existing SQL completion guard remain in place. No schema migration, new route, new storage system, new permission code or production role grant was added.

### Separate signature review and verification

A simple upload intentionally cannot satisfy a policy requiring signed consent. To keep the existing verification workflow usable without reintroducing fields into upload:

- The existing authorized Radiology review section has a separately expandable **Record signature details for consent review** action. It is shown only with consent-verification and document-upload permissions.
- After retrieving the original, the reviewer explicitly records the observed signing date, named eligible responsible doctor, independent signature assertions and review reason. Unknown remains the initial signature state.
- **Save reviewed signature details as new version** reuses the existing upload/version API and the saved original bytes. It creates an immutable metadata version, rather than updating the original, and **does not verify consent or release it**.
- The saved version must then be retrieved and explicitly confirmed before the existing separately authorized **Verify this procedure consent** action. Existing server eligibility, original-retrieval, exact request/procedure, signature, date, latest-version, policy and permission checks remain authoritative.
- A later simple file correction clears signature assertions and invalidates the earlier pending-procedure verification. Historical reviewed versions remain intact.

Portal release is also separate: an authorized user selects the document/version, enters a **Portal release reason** in its own decision form and confirms the action. Uploading never grants release authority or silently releases a file.

A recorded scan/signature assertion is not cryptographic authentication, and file retrieval alone does not establish that a human examined or authenticated a signature.

## Fresh verification

All fixtures were synthetic and additive in a newly initialized disposable PostgreSQL16.12 cluster on loopback55439. Before migration/fixture writes, the cluster identifier read directly from the new local `global/pg_control` file was compared with the connected server identifier and data directory. All101 existing migrations were applied only there. Existing independently attested fixture guards were retained. Runtime tools, environment values and database files remain ignored; no production connection, data or migration was used.

| Check                                                                                          | Result                                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual built Vite SPA + bundled Express + Chromium143 + normal staff and portal password login | **36 checks passed**, no mocked/intercepted HTTP or SQL, no uncaught staff browser errors or same-origin500 responses                       |
| New simple-upload mounted-HTTP/PostgreSQL suite                                                | **11 passed**                                                                                                                               |
| Existing signed-document/consent/portal/SQL regression suite                                   | **43 passed**                                                                                                                               |
| Existing explicit responsible-doctor metadata mounted-HTTP/PostgreSQL suite                    | **20 passed**                                                                                                                               |
| Updated document UI/review DOM suite                                                           | **12 passed**                                                                                                                               |
| Existing workflow regression DOM suite                                                         | **19 passed**                                                                                                                               |
| Combined focused Vitest run                                                                    | **105 passed across5 files**,0 failed,0 skipped                                                                                             |
| Bounded `tsc --noEmit --singleThreaded`                                                        | Passed                                                                                                                                      |
| Scoped ESLint                                                                                  | Passed,0 errors,0 warnings                                                                                                                  |
| Scoped Prettier / Git whitespace checks                                                        | Passed                                                                                                                                      |
| Frontend and server production builds                                                          | Passed; Vite large-chunk warning remains                                                                                                    |
| Actual original-file retrieval                                                                 | Byte-identical PDF; independently extracted/rendered with PyMuPDF and visually inspected; complete expected synthetic text without clipping |

### Requested acceptance matrix

| #   | Requirement                              | Result/evidence                                                                                                                                                                          |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Patient Management needs only title/file | PASS: normal records-staff login, exactly3 controls/two required, actual upload with blank notes.                                                                                        |
| 2   | Blank notes accepted                     | PASS: stored null on both actual central and Radiology uploads; backend optional-notes test also passes.                                                                                 |
| 3   | Upload appears in patient list           | PASS: real UI list and persisted uploader/filename.                                                                                                                                      |
| 4   | Preview/retrieve original                | PASS: selected-file preview, saved-original iframe retrieval and byte-identical downloaded PDF.                                                                                          |
| 5   | Radiology needs only title/file          | PASS: same3 controls/two required, actual upload with blank notes and no clinical fields.                                                                                                |
| 6   | Automatic exact Radiology linkage        | PASS: persisted patient/request/procedure; scoped server context; forged procedure/facility inputs do not override context.                                                              |
| 7   | Same Radiology document centrally        | PASS: one matching ID, actual navigation both ways, exact source/request/procedure display.                                                                                              |
| 8   | Upload never auto-verifies               | PASS: Unknown/null assertions; awaiting verification; direct verification rejected; separate review-version save also remains unverified until explicit decision.                        |
| 9   | Upload never auto-releases               | PASS: no release record; separate normal patient login sees neither upload until explicit per-version release.                                                                           |
| 10  | Authorization/cancellation intact        | PASS: missing authorization401, missing upload permission403, staff verification403, wrong-patient404, cross-facility404 and cancelled upload409; legacy policy/SQL negatives also pass. |
| 11  | Versions/history continue                | PASS: simple correction and reviewed metadata create immutable versions; originals preserved, audit events present, replacement resets assertions and invalidates verification.          |
| 12  | Invalid files/access rejected            | PASS: malformed PDF rejected through actual browser HTTP and backend; existing content/MIME/size/active-content tests and cross-scope negatives remain passing.                          |

## Browser evidence

- [Patient Management — simple form, blank notes](simple-document-upload-evidence/01-patient-management-simple-form.png)
- [Radiology — same simple form, blank notes](simple-document-upload-evidence/02-radiology-simple-form.png)
- [Central repository — linked request and uploader](simple-document-upload-evidence/03-central-linked-document.png)
- [Separate authorized consent verification](simple-document-upload-evidence/04-separate-consent-verification.png)
- [Explicit per-version portal release](simple-document-upload-evidence/05-explicit-portal-release.png)
- [Downloaded PDF render](simple-document-upload-evidence/06-original-pdf-render.png), [original synthetic PDF](simple-document-upload-evidence/synthetic-original.pdf), [extracted text](simple-document-upload-evidence/synthetic-original-text.txt)
- [36 named browser assertions and synthetic fixture IDs](simple-document-upload-evidence/results.json), [verification summary](simple-document-upload-evidence/verification-summary.json), source/build/evidence SHA256 manifests in the same folder.

The evidence preserves sandbox runtime timestamps. Those timestamps are not production deployment evidence.

## Changed files

Application:

- `src/components/PatientDocumentsPanel.tsx` — shared simple form, simplified cards, separate release decision.
- `src/components/RadiologyConsentPanel.tsx` — separate review-version action and attachment refresh after review.
- `src/components/RadiologyConsentMetadata.tsx` — new small, separate review control; existing APIs/storage only, not a new consent subsystem.
- `src/documents/patient-documents.service.ts` — neutral simple defaults, server audit values, preserved rich path, scoped uploader-name projection.
- `src/api/patient-documents.client.ts` — optional uploader ID/name metadata typing.

Verification/delivery:

- `src/tests/vitest/patient-documents-ui.spec.tsx` — updated for simple upload and separate review requirements.
- `src/tests/integration/simple-patient-documents.db.spec.ts` — new11-test real HTTP/database suite.
- `scripts/simple-document-upload-acceptance.ts` — new actual built-app browser acceptance harness.
- This report and `docs/audits/simple-document-upload-evidence/` — synthetic evidence/manifests only.

The earlier rich-upload UI browser harnesses/evidence describe the superseded form and are retained as historical records; use the new simple-upload harness for the current UI. Legacy backend metadata functionality is still regression-tested.

## Reproduction, Git and limits

With a separately provisioned, independently attested disposable fixture environment and controlled Chromium, build first, then run:

```sh
npm run build
npm run build:server
RESPONSIBLE_DOCTOR_SYNTHETIC=YES node --import tsx scripts/simple-document-upload-acceptance.ts
```

The existing doctor-fixture guard is reused; it is not a production configuration. Do not run the harness against a production database.

Current branch: `arena/e088f11d-afyahub-hmis-kenya`, tracking the same origin branch. Parent delivery: `671378fe3806283e74daf65851ac4391828a8be2`. The restored checkout initially had stale base metadata; all1847 local files were independently blob-compared with that published parent before fast-forwarding metadata only. No working file was overwritten. No branch switch, reset, clean, rebase, force-push or history rewrite was used. The final handoff records the enclosing task-specific commit SHA, clean working-tree check and ordinary same-branch push result.

Limitations: this is synthetic functional acceptance in Chromium, not production deployment, legal consent certification, professional licensing validation, e-signature authentication or cross-browser PDF-viewer certification. Signature review requires the existing permissions and explicit clinical observations; a title/file-only upload deliberately leaves required clinical consent incomplete. Embedded PDF viewing depends on the browser; original download remains the fallback. No unrelated reporting, letterhead, finance, procurement or clinical workflow was redesigned.

Dependency note: `npm ci` reported4 moderate advisories in the existing lockfile. No dependency upgrade or forced audit fix was made as part of this UI/consent task.
