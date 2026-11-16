# Patient portal: downloadable medical record PDF — acceptance report

## Decision: delivered, verified against the built application

Patients could generate a raw JSON/text copy of their record from the portal's Account tab. That is replaced by a hospital-style, multi-page PDF generated on request from the same authorised record retrieval the portal already uses, downloadable as a real attachment.

Work is on `arena/e088f11d-afyahub-hmis-kenya`. No production database, facility or patient was contacted. Every patient, account, facility, ward, medicine, result and document in the evidence below is synthetic and lives only in the disposable `clinical_documents_synthetic_test` cluster. Runtime timestamps in fixtures are the sandbox clock, not a claimed deployment date.

## What changed

| Area | File | Behaviour |
| --- | --- | --- |
| Rendering | `src/portal/medical-record-pdf.ts` | A4 document: facility letterhead, repeated header and footer on every page, `Page X of N`, patient card, history, allergies, medications, laboratory, radiology, appointments, released documents, closing note. |
| Data | `src/portal/portal-records.service.ts` | One builder, scoped by the portal session's tenant and patient. No second medical-record model; it reuses the portal's existing authorised queries. |
| Route | `src/portal/portal.routes.ts` | `GET /api/portal/records/download` → PDF bytes, `Content-Disposition: attachment`, `no-store`, `nosniff`, and the existing `EXPORT` access-log row. |
| Portal UI | `src/components/portal/PortalApp.tsx` | **My Medical Record** panel, `Download Medical Record (PDF)`, explicit generating state, last-generated date, readable failures. |
| Client | `src/api/portal-client.ts` | `downloadRecord()` returns the blob and the server's filename. |
| Documents | `src/documents/patient-documents.service.ts` | Released-document dates use the recorded wall clock, not a timezone-shifted instant. |
| Reuse | `src/documents/render.ts` | Content frame and letterhead composition extracted so the record and staff documents share one renderer. |

## Accuracy decisions worth recording

- **Clinical timestamps are wall clocks.** The clinical tables store `timestamp without time zone`; a stored `09:15` is 09:15 at the facility. Formatting those values through a timezone formatter printed `12:15`. The builder now passes the recorded wall clock through and the renderer prints it as recorded. Only true instants — the generation stamp — are converted into the facility zone.
- **Missing data is never presented as normal data.** `No allergy information recorded` and `No known allergies` are different sentences. An order whose only result is unverified reads `Result pending verification`; an order with nothing recorded reads `No result has been recorded for this test yet`; a cancelled order reads `Order cancelled. No result was issued`.
- **Radiology** prints the report only when one exists; an unreported request says `No report has been issued yet`, no findings are invented, and the section states that images are not part of the copy.
- **Documents** are listed only when explicitly released to this patient. Unreleased documents and staff release reasons never appear.
- **Facility attribution** is per encounter, so a record covering two facilities names the facility that treated the patient on each entry.

## Verification

### Integration — real Express, real PostgreSQL, PDF parsed back

`src/tests/integration/portal-medical-record.db.spec.ts` — **9/9 passing**. Each test downloads through HTTP and reads the returned PDF:

1. multi-page document: branding, profile, history, diagnoses, notes, admission/discharge, medicines, verified and pending results, radiology, appointments, released documents, page furniture, and no JSON/column names;
2. per-encounter facility attribution for a two-facility patient;
3. a long history: repeated header and `Page i of N` on every page;
4. a patient with no history: correct empty wording and no invented content;
5. allergy wording: `NULL` versus a recorded `No known allergies`;
6. isolation: another patient, a forged `?patientId=`, and a foreign tenant;
7. portal policy switches and the explanation shown to the patient;
8. `allow_downloads = false` → `403 DOWNLOADS_DISABLED`;
9. the access-log row (`MedicalRecord`, `DOWNLOAD`, `PATIENT_PORTAL`) and no `Location` header.

`src/tests/integration/phase1-portal-isolation.db.spec.ts` (14) now asserts download isolation against the PDF instead of the retired JSON export. `portal-documents.db.spec.ts` (15) and `simple-patient-documents.db.spec.ts` (11) pass with the document-date change.

### Component

`src/tests/vitest/portal-medical-record-ui.spec.tsx` — 3 tests: the section and its control, a busy state that only reports success after the file exists, and a failure that does not claim a download.

### Browser acceptance — built SPA, built server, real Chromium

`scripts/portal-medical-record-acceptance.ts` → `docs/audits/portal-medical-record-evidence/results.json`, **119 checks passed**, screenshots `01`–`05`. A real Chromium signs in as synthetic patients, presses the real button, and the downloaded file is parsed and read. The ten requested scenarios:

| Scenario | Evidence |
| --- | --- |
| Outpatient encounters | `12 March 2026 at 09:15`, `Outpatient (OPD)`, note, `ICD-10 M54.5 Low back pain` |
| Inpatient encounters | `Inpatient`, `Admitted 1 May 2026`, `Discharged 4 May 2026`, `Recovered`, discharge summary |
| Laboratory results | verified `Haemoglobin 12.4` shown; unverified value absent and labelled; `Sputum AFB` with no result; `Urinalysis` cancelled |
| Radiology reports | `Chest X-ray PA view` findings and impression; `Abdominal ultrasound` with no report; no invented findings; no DICOM claim |
| Prescriptions | dose, frequency, route, `Dispensed 12 March 2026`, and a cancelled prescription labelled |
| No history | complete PDF, `No known allergies`, `No encounters have been recorded…`, no invented results |
| Multiple facilities | both facilities named, each visit attributed under its own heading |
| Released + unreleased documents | released title present, unreleased title absent and `404` by id |
| Long multi-page history | 34 extra visits → 9 pages, `Page 1 of 9` … `Page 9 of 9`, first and last visit present |
| Another patient's record | own record only; forged `patientId=999999` and `patientId=<other>` return the caller, never the other patient; unauthenticated request refused |

Also checked in the browser run: `Content-Type: application/pdf`, attachment filename containing the patient number, `Cache-Control: no-store`, the file actually landing on disk, the success notice appearing only after the file exists, the last-generated date appearing afterwards, and an access-log row with `access_channel = PATIENT_PORTAL`.

### Static and build

- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors (repository-wide warnings unchanged).
- `npm run build` and `npm run build:server` — both succeed; acceptance runs against those artefacts.

## Limits stated plainly

- The letterhead is the facility's uploaded artwork. A facility that has not uploaded one gets a correct plain record with its name and contacts, not a fabricated logo.
- Laboratory values appear only after verification. A patient looking for an unverified value will not find it here, by design.
- Radiology images are never included; the copy says so.
- This is a patient-facing copy of held records, not a certified medico-legal extract and not a signed document.
