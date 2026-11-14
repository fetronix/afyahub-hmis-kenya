# Clinical documents, radiology consent, letterhead and Reporting Centre — acceptance report

## Decision: verified enhancement, overall request still incomplete

The implemented patient-document and procedure-consent paths have real synthetic PostgreSQL/HTTP/browser evidence. Reporting PDF/Print PDF now uses the existing facility letterhead renderer. **This is not completion of every Reporting Centre report or every requested printable document.** Of 144 catalogue entries, 23 map to tested subsets across 19 query engines, four reuse existing individual-document workflows, and **117 still have no integrated backend/workflow**. They remain explicitly unavailable. Do not present this branch as production-ready, legally compliant or deployed.

Work is on `arena/e088f11d-afyahub-hmis-kenya`, extending baseline `4947c6885e8553295e2804d54161e8874fe7facd`. No production database connection, migration, data inspection, reset or deployment was performed. All patients, accounts, documents, facilities and stationery in this evidence are synthetic. Runtime timestamps in exported fixtures reflect the sandbox clock, not a claimed deployment date.

## Initial findings and reuse

The preimplementation findings and full initial inventory are in [CLINICAL_DOCUMENTS_INITIAL_AUDIT.md](CLINICAL_DOCUMENTS_INITIAL_AUDIT.md) and [CLINICAL_DOCUMENTS_INITIAL_REPORT_CATALOGUE.json](CLINICAL_DOCUMENTS_INITIAL_REPORT_CATALOGUE.json).

- Structured consent/allergy records existed, but were not immutable signed-file storage. Radiology attachments did not constitute procedure-specific verified consent, and the performance boundary had no consent gate.
- Existing staff authorization/facility context, separate portal sessions, patient access logs, PostgreSQL storage patterns, letterhead administration, historical letterhead resolution and common document rendering were reused. No second branding system was created.
- The Reporting Centre already had real scoped SQL, domain/report permissions, filters and PDF/XLSX/CSV exports for 19 engines. Its separate PDF writer omitted the uploaded letterhead. HTML print was a different path and printed only the displayed page.
- Posted-ledger reports and operational registers were deliberately kept separate. No ledger, equity, budget, payroll, bank or planning source values were manufactured or remapped. Historical partner-equity implementation/evidence was not edited.

## Implemented workflows and confirmed fixes

### Patient record: Consent & Signed Documents

- Integrated a scoped document workspace into the existing patient journey. Supports authenticated upload, literal title search, exact type filter, inclusive signing-date filters, list, image/PDF preview, original download, version history and audit history.
- Originals are immutable database bytes with SHA-256. Correction creates a linked, numbered new version with a required reason; previous originals are never overwritten or deleted. Database triggers reject updates/deletes of originals and document audit events.
- Records retain patient/facility scope, title/category/type, signing/upload dates, independent patient/doctor signature presence (`UNKNOWN`, `ABSENT`, `PRESENT`), responsible doctor, uploader, notes, filename, MIME, hash, version and optional procedure linkage.
- Merely uploading does not mark anything signed, verified or portal-released. Signature assertions and doctor/date/notes are cleared before the next new upload. Scanned signatures are **staff-observed metadata, not cryptographically authenticated signatures**.
- Matching PDF/JPG/JPEG/PNG extension, MIME and decoded content are required. PDFs must parse, have supported geometry and 1–100 pages; active actions/scripts/embedded files are refused. PNG/JPEG are decoded with a 25-million-pixel ceiling. Invalid files, executable extensions and oversized bodies are rejected server-side. Originals are validated without rewriting.
- Default upload limit: 8 MiB; `PATIENT_DOCUMENT_MAX_BYTES` permits 1,024–33,554,432 bytes and requires worker restart. DOCX is deliberately unsupported rather than pretending to preview it safely.
- Same-file correction selection now clears the native file input after success. Loading/filter requests hide stale list results and distinguish an error from an empty result.

### Portal: My Documents & Signed Consents

- Uses the existing, separate patient session, not the staff token. Only individually released versions belonging to the session's tenant/facility/patient are returned.
- Patient JSON omits internal notes, uploader/doctor identifiers, hashes, staff signature assertions and staff audit/history. Originals still necessarily contain whatever was printed on the uploaded page; staff must inspect content before release.
- Cross-patient and cross-facility file requests are denied. Existing portal download policy is checked on download. Preview/list/download access is audited; failed audit writes roll back the read operation.
- Fixed a real login defect revealed by randomized browser fixtures: a valid email containing 9–15 digits could be stripped into a phone lookup. Login now chooses email or phone from the identifier shape before normalization. A digit-heavy email database regression and the existing portal password/lockout/session-isolation suite pass; no authentication checks were weakened.
- Release is explicit per version. A correction is not automatically released, nor does it silently withdraw an older released original. Staff must explicitly withdraw an obsolete version if necessary.

### Radiology procedure consent

- Existing order panel now displays required/awaiting-verification/verified/exception state, request-specific files, clinician/reason/time and facility policy. Generic treatment consent cannot satisfy this workflow.
- Default is consent required and exceptions disallowed. Verification requires this order/patient's latest corrected evidence, both signature-presence assertions, signing date and responsible doctor matching the decision. Changed procedure names cannot reuse verified evidence for the old procedure.
- At the existing Reported performance/billing boundary, a PostgreSQL trigger also protects alternative writers setting Reported/Performed/Completed. Missing or stale consent is refused; the actual HTTP route translates the guarded SQL failure into 409 instead of 500. Historical completed requests are not retroactively claimed to have consent.
- Exception requires dedicated permission, a policy allowing it, an active scoped user identifying themselves as the authorizing clinician, a reason, timestamp and persisted audit. No undocumented bypass was introduced.
- Policy writes use a facility advisory lock and audit previous/next policy plus reason. Decisions and policy changes do not infer signatures or amend source documents.

### Existing letterhead and document rendering

- Reused existing facility letterhead upload → draft → preview/layout → explicit activate → replace/history administration. Upload does not activate. Existing facility metadata and original PDF template remain the source of truth.
- Reporting PDF and Print PDF now share the common facility renderer and all filtered rows up to the existing enforced 1,000-row export ceiling. Browser screen pagination does not truncate the export. Oversized exports are refused, not silently truncated. Excel/CSV remain data exports, not simulated stationery.
- Invoice Print now performs the existing audited print authorization and opens the existing official invoice PDF, instead of separate unbranded HTML. Scope-change guards remain in place.
- Reporting Centre laboratory, radiology and discharge entries reuse the existing authorized individual PDF services by source request/admission reference; they do not fabricate new tabular reports or change clinical release rules. Invoice uses its existing selection workflow.
- Fixed-assets residual HTML print is explicitly labelled **Print working register (no letterhead)**. This does not complete an official fixed-asset report.
- Existing common paths cover invoice, receipt/credit note, procurement, laboratory, radiology, discharge, budget and equity where already implemented. Prescription PDFs and other unavailable printables were not invented.

## Migration, API and permissions

New migration: `drizzle/0100_patient_signed_documents.sql`, journal entry 100. Adds `patient_signed_documents`, `patient_document_events`, `patient_document_releases`, `radiology_consent_policies`, `radiology_consent_decisions`, scope/immutability/performance guards and six permission catalogue entries. The original 101-migration chain was applied only to the disposable cluster. During final development the consent guard function was refreshed in that same scratch cluster before rerunning tests; no production migration ran.

Dedicated permissions, with **no automatic staff/role grants**:

| Permission | Purpose |
| --- | --- |
| `patients.documents.read` | Scoped originals, metadata and history |
| `patients.documents.upload` | New immutable original/correction; also requires document read |
| `patients.documents.release` | Explicit version release/withdrawal |
| `radiology.consent.verify` | Request-specific verification |
| `radiology.consent.exception` | Policy-controlled exception |
| `radiology.consent.policy` | Facility policy change |

Staff operations additionally require a non-platform facility account and `patients.read`; existing report/document routes retain their own source permissions. Migration/seeding adds permission definitions only. The broad synthetic acceptance persona is not a default application role grant.

| API | Operation |
| --- | --- |
| `GET/POST /api/patient-documents/patients/:patientId` | Filtered list / raw original upload; URL-encoded JSON `X-Document-Metadata` |
| `GET /api/patient-documents/patients/:patientId/:id/file?download=1` | Authorized unchanged bytes; omit download for preview |
| `GET /api/patient-documents/patients/:patientId/:id/history` | Immutable version/audit history |
| `POST /api/patient-documents/patients/:patientId/:id/release` | `{released, reason}` |
| `GET/POST /api/patient-documents/radiology/:id/consent` | Scoped status / decision with document, clinician, reason |
| `POST /api/patient-documents/radiology-policy` | `{required, allowException, reason}` |
| `GET /api/portal/documents` and `GET /api/portal/documents/:id/file` | Separate authenticated patient's explicitly released records |
| Existing `/api/reporting/centre/:engine/{options,generate,export}` | Existing scoped queries; export now resolves active facility letterhead for PDF |
| Existing `/api/documents/...` | Reused individual invoice, laboratory, radiology and discharge PDFs |

Files are not served from a public static directory. File responses use private/no-store, nosniff, sandbox CSP and safe encoded filenames. Access/audit failure does not silently grant access.

## Verification and evidence

Latest consolidated results:

| Check | Result |
| --- | --- |
| Disposable PostgreSQL integration: nine files | **139 passed**, including 38 signed-document/consent/login tests, 20 document generation, 13 letterhead, 54 Reporting Centre and 14 portal-isolation tests |
| Focused UI/service/portal regression: ten files | **61 passed** |
| Actual built SPA + Express, normal staff/patient logins, no adapters | **180 acceptance checks**, zero uncaught browser errors |
| Saved PDF/XLSX content/geometry inspection | **1,012 checks**, across all 19 engines plus clinical PDF and before/after fallback |
| TypeScript | `npm run typecheck` passed |
| Frontend / backend bundles | `npm run build` and `npm run build:server` passed |
| Targeted ESLint | Zero errors; eight existing-area warnings (React effect/state and unused declarations) disclosed |
| Changed TypeScript/JSON formatting and patch whitespace | Targeted Prettier / staged diff check passed (allow CR-at-EOL for original CSV exports) |

The database test files are `patient-signed-documents`, `letterhead-branding`, `document-generation`, `report-centre`, `report-centre-operational`, `report-centre-ledger`, `report-centre-selectors`, `report-centre-diagnoses`, and `phase1-portal-isolation` under `src/tests/integration/`. Nonempty financial, diagnosis, selection, procurement, laboratory and operational fixtures/calculations are exercised by these integration suites, not inferred from the empty states in the presentation fixture.

The focused run covers report UI/export/invoice print, finalized-invoice scope changes, consent/allergy, portal, laboratory-safety UI, document UI, clinical-document selection/stale response, and catalogue integrity. **The entire repository suite, coverage run, whole-repository lint and production-like load/security testing were not run.** Build warns about the existing large frontend bundle. Some DB runs emit Vite WebSocket-port and PDF test-worker warnings; passing assertions are not a claim of clean full-system CI.

### What was actually inspected

- `clinical-documents-evidence/verification-summary.json`: consolidated counts, commands, omissions and tested source hashes. Original downloaded CSV files retain their CRLF bytes; staged whitespace validation allows CR-at-EOL rather than altering export evidence.
- `clinical-documents-evidence/results.json`: named browser/HTTP checks and the exact synthetic fixture identifiers. Verifies original-byte equality, independent signatures, correction/audit, invalid/oversized/unauthorized upload refusal, own-patient portal access, procedure-specific 409 gate, authorized exception, explicit activation and historical plain fallback.
- `report-results.json`: all 19 actual query responses with columns, values, supported filters and counts. Every engine was queried again with changed filters and exported as actual PDF/XLSX/CSV. Presentation fixtures intentionally leave unrelated clinical/financial engines empty; those PDFs say no records rather than inventing patients or transactions.
- `export-inspection.json`: parses saved PDFs with PyMuPDF and XLSX ZIP/XML; checks actual saved row values, no worksheet formulas, repeated correct template, page counts/numbering, geometry and empty states. Inventory has 35 records across six PDF pages and includes the last record beyond the screen page in both PDF and XLSX.
- Visually inspected representative first/last inventory pages, plain fallback, branded clinical PDF and actual workflow screenshots. Automated content inspection covers all 19 PDFs/XLSX; this is not a claim of visually reviewing every page or opening every workbook in desktop Excel.
- Native embedded PDF rendering is unavailable in this headless Chromium build. The authenticated PDF bytes and browser-opener invocation are checked, and image preview is checked by real browser decode. Final generated PDF samples are separately rasterized and inspected. Browser-specific PDF printing still needs human UAT.

### Evidence index

All links below contain synthetic data only:

- [Patient signed-document PDF preview controls](clinical-documents-evidence/01-patient-consent-preview.png), [actual decoded image preview](clinical-documents-evidence/01b-patient-image-preview.png), [immutable version/audit history](clinical-documents-evidence/02-patient-document-audit.png)
- [Patient portal own released documents](clinical-documents-evidence/03-patient-portal-own-documents.png)
- [Radiology verified procedure consent](clinical-documents-evidence/04-radiology-verified-consent.png)
- [Existing letterhead explicit activation/history](clinical-documents-evidence/05-letterhead-active-version.png)
- [Reporting catalogue](clinical-documents-evidence/06-reporting-centre-catalogue.png), [generated report/count](clinical-documents-evidence/07-reporting-centre-after.png), [actual returned table rows](clinical-documents-evidence/07b-reporting-centre-returned-rows.png), [clinical PDF workflow](clinical-documents-evidence/08-reporting-centre-clinical-document.png)
- [Before activation: plain fallback](clinical-documents-evidence/report-before-activation-page1.png), [after activation: first page](clinical-documents-evidence/report-after-activation-page1.png), [last page](clinical-documents-evidence/report-after-activation-last-page.png), [branded radiology PDF](clinical-documents-evidence/radiology-after-activation-page1.png)
- [Actual inventory PDF](clinical-documents-evidence/inventory-category.pdf), [XLSX](clinical-documents-evidence/inventory-category.xlsx), [radiology PDF](clinical-documents-evidence/radiology-after-activation.pdf)
- [Every-entry final catalogue](CLINICAL_DOCUMENTS_REPORT_CATALOGUE.md), [machine-readable catalogue](clinical-documents-evidence/report-catalogue.json)

The before/after images show actual no-template versus explicitly activated-template output in this implementation, not a fabricated screenshot of baseline code.

## Remaining limits and deployment blockers

1. **117 unavailable catalogue entries remain incomplete.** The other 27 are limited subsets or individual documents, not completion of the full names/specifications in the catalogue. Source data/workflows/templates for payroll, prescriptions, many financial/clinical/stock/HR reports remain outstanding; see every-entry catalogue.
2. Responsible doctor validation proves an ACTIVE user in this facility, not professional registration or a medically credentialled role. Exception authority is a deliberately assigned permission and self-attribution. Clinical governance must approve role assignment and clinician eligibility before use.
3. No antivirus/CDR service, cryptographic scanned-signature authentication, legal-consent certification, e-signing or DOCX support is claimed. PDF/image parsing is a content gate, not proof that every possible malicious file is safe. Establish malware screening, resource/time limits, storage encryption, backup, retention and incident processes before production approval.
4. Document lists are capped at 200; no document pagination or complete archive search is implemented. Metadata uses free-text categories/types and numeric doctor/source IDs, not credentialled clinician/source pickers. Portal releases are per-version and require deliberate withdrawal when superseded.
5. Report PDFs use the active template when regenerated; they are not persisted immutable report snapshots. Existing clinical/event-time and pinned invoice rendering is retained. A stock record may flow across PDF pages; repeated stationery/footer and all values are retained, not row-atomic layout.
6. Individual clinical source reference browsing is not implemented; those workflows provide PDF only. Letterhead wording on every legacy HTML/thermal/plain output is not universally replaced; fixed-assets working print, portal text summary and thermal receipts are not official branded A4 documents.
7. No real production data, external providers, managed backup/restore, cross-browser print, mobile accessibility audit, clinician/legal UAT, full CI or load test was performed. These remain release gates.

## Deployment guidance — instructions only, not executed on production

1. Review/approve the unresolved limitations and clinical consent policy. Do not deploy as “all reports completed.” Back up and rehearse restore on an isolated staging copy under the organization's approved process; this agent did not connect to production.
2. Install from the lockfile (`npm ci`); the new `sharp` dependency requires its compatible native platform packages. Configure the private PostgreSQL connection and existing application secrets outside Git. Set/review the upload limit and reverse-proxy body limits; restart all workers after changes.
3. Build using the existing deployment process (`npm run build`, `npm run build:server`). Review `npm run db:migrate:dry` against approved staging, then apply `npm run db:migrate` and verify `npm run db:status:all` there. Migration 0100 enables a fail-closed radiology performance gate: coordinate permissions/workflow before allowing new reports.
4. Seed/review permission definitions with the existing permission tools. Explicitly assign only the six required capabilities to approved facility roles; do not grant them to all staff. Confirm authorized clinicians, policy administrators and portal release staff separately. Keep default required consent/no exceptions unless an approved, audited policy says otherwise.
5. In existing Branding & Documents, upload approved facility stationery, inspect margins and sample documents, then explicitly activate. Confirm the intended authenticated facility and historical reprints. Upload alone must remain draft.
6. Run synthetic UAT in staging: valid/invalid/oversized uploads, two independent signature fields, correction/history, separate patient portal accounts, release/withdrawal, cross-facility denial, no-consent 409, authorized exception, real filters/calculations, PDF print and Excel/CSV contents. Validate source-specific clinical release rules.
7. Use normal operational monitoring and rollback planning. Do not drop the immutable document tables or reset data as an application rollback. A Git push is source publication, **not** migration or deployment.

## Reproducing evidence safely

Use only a disposable loopback database named `clinical_documents_synthetic_test`, with independent PostgreSQL cluster attestation for database specs. Apply the migration chain there. `scripts/clinical-documents-acceptance.ts` refuses a non-loopback/non-synthetic target and requires explicit `CLINICAL_DOCUMENTS_SYNTHETIC=YES` plus a Chromium executable; it creates unique synthetic fixtures and runs the built application on port 4195. It does not reset the database. After successful acceptance, run `scripts/clinical-report-catalogue.ts` with the same scratch SQL environment (source imports require configuration; no query is performed), then `scripts/inspect-clinical-document-exports.py` with PyMuPDF installed. Browser/inspection tooling and the disposable database are ignored, not application deliverables. Do not run this harness against production.
