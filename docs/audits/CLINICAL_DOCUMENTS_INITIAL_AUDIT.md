# Clinical documents, radiology, letterhead and Reporting Centre — initial audit

## Baseline / safety

Branch `arena/e088f11d-afyahub-hmis-kenya`; published baseline `4947c6885e8553295e2804d54161e8874fe7facd`. On session restoration Git metadata pointed at `0111b55` although all 1,578 working-tree files exactly matched the published baseline. After comparing every blob and checking for additional files, branch/index metadata was aligned without changing working-tree files, switching branches, resetting or rewriting published history. Working tree was clean before this audit document. No production connection or patient files were inspected.

This is a **source/schema audit before implementation**, not a runtime acceptance claim. Existing historical audit reports are not treated as fresh verification.

## Patient management

- Creation/editing: `src/routes/domains/patients.routes.ts`, scoped query services, `PatientRegistrationModule.tsx`; journey modal displays a selected record.
- Existing `PatientConsentAllergyPanel.tsx` and `clinical/consent.service.ts` support structured consent purposes, scopes, method, version/hash, grant/revoke and allergies. `patient_consents` is not a signed-file store. A WRITTEN method does not prove an actual file or signatures exist.
- No dedicated immutable patient-file/version store or signed-file upload/download UI was found. `attachment_url` on radiology orders is not a secure managed document/version workflow.
- Patient portal already has separate patient authentication, own-record release, policy-controlled clinical record views/downloads and record-access logs. It has no controlled uploaded signed-document section.
- Existing infrastructure suitable for reuse: authenticated staff authorization context, facility checks, `patient_record_access_logs`, separate portal sessions, immutable bytea storage pattern used by facility letterheads.
- Gap: dedicated RBAC, safe content validation, immutable originals/versions, signature metadata, explicit portal release, patient-specific read and download checks.

## Radiology

- Requests: `POST /api/radiology-orders`, facility/patient/encounter validation and optional idempotency.
- Workflow: Requested → Reported in `updateRadiologyReport` (`src/db/queries/laboratory.ts`); reporting stages performed-service billing once under a row lock. Reporting is therefore the existing performance/completion boundary.
- No procedure-specific consent linkage, verification state, exception policy or completion gate exists. A generic patient consent must not satisfy this gap.
- Gap: explicit facility policy, request-specific uploaded version/clinician linkage, verified/exception status and transactional enforcement at the existing reporting boundary. Historical reported requests must not be retroactively marked as having verified consent.

## Letterhead / rendering inventory

Existing single source: `facility_letterheads` and append-only lifecycle events (migration0090); immutable PDF bytea, scoped upload/read/preview, DRAFT → ACTIVE → SUPERSEDED/WITHDRAWN, one active version per facility; layout preview and explicit activation already exist. `FacilityLetterheadPanel` is used by configuration. Upload is not activation. Facility metadata comes from facility rows. Uploaded template may contain a logo/contact details; there is no reason to introduce a second branding store.

| Document family | Actual implementation | Existing letterhead behavior / limitation |
| --- | --- | --- |
| Finalized invoice | `documents/document.service.ts` → `documents/render.ts` | Pinned stored letterhead version; safe plain fallback |
| Receipt / credit note | Same common model/renderer | Resolves historical letterhead by event time; thermal receipts intentionally plain |
| Purchase order / GRN | Same common model/renderer | Facility-scoped historical letterhead resolution |
| Laboratory report | Same common model/renderer | Verified-result restrictions; historical letterhead resolution |
| Radiology report | Same common model/renderer | Reported result; historical letterhead resolution |
| Discharge summary | Same common model/renderer | Existing clinical summary, scoped historical letterhead |
| Budget plans / annual financial budget | Budget document builder + common renderer | Existing integration; separate planning semantics |
| Partners’ equity | Equity document builder + common renderer | Existing scoped active template and provisional warnings |
| Reporting Centre PDF | `reporting/report-centre.export.ts`, separate PDFKit writer | **Confirmed missing letterhead and common page footer** |
| Reporting Centre browser print | `ReportWorkbench.tsx`, CSS + `window.print()` | **Separate HTML output, no common uploaded PDF letterhead**; prints current page, not full export |
| Portal medical record summary | `portal-records.service.ts` + portal download route | Plain own-record text summary; not an official signed PDF |
| Prescriptions / other printable catalogue entries | Catalogue contains unavailable workflows | No integrated prescription PDF inferred; must remain unavailable until implemented |

Common renderer already composes original PDF under flowing content with aspect-preserving page geometry, repeated template and page numbers. No-template fallback is deliberately identified rather than made to resemble official stationery. Rendering and facility-isolation behavior still require fresh testing.

## Reporting Centre

Catalogue: `reporting/report-catalogue.ts`; definitions in `report-centre.types.ts`, `report-centre.operational-definitions.ts`, `report-centre.ledger-definitions.ts`. Generate/options/export API: `POST /api/reporting/centre/:engine/{generate,options,export}`. `report-centre.service.ts` builds real SQL in repeatable-read transactions, validates supported filters, limits exports and enforces report/domain permissions. Ledger and operational queries remain distinct.

There are **19 query engine identifiers**, with catalogue entries mapping to implemented subsets, one existing invoice-document workflow, and entries whose engine/workflow is null. Null entries are **missing backend/workflow**, not completed reports. An implemented subset is **partially functional pending runtime verification**, not proof of the entire named report. The per-entry inventory will be generated directly from the actual catalogue/definitions before implementation. Existing engine exports support PDF/XLSX/CSV. PDF and browser print branding defects above are confirmed by source; calculation/filter defects are not presumed without data evidence.

Fresh runtime work must verify all engine queries (including empty states), changing supported filters, selected totals, authorization and exports on synthetic data. Any catalogue feature not implemented or executed will remain explicitly limited. No production-readiness or legal-compliance assertion follows from this audit.
