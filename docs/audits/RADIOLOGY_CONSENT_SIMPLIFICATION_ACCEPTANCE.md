# Simplified radiology consent upload and doctor verification

## Outcome

The radiology request screen now has one **Upload consent document** action whose form asks only for a title, optional notes and the original PDF/JPG/JPEG/PNG. The server resolves the patient, exact imaging request, procedure, facility and uploader from the authenticated request and stored records. Doctors verify under their own sign-in; non-doctors may upload where permitted but cannot attest for a doctor. Reported requests accept only clearly marked historical supporting documents.

## Why upload was disabled

Two independent causes produced the reported behaviour.

1. **Reported requests were treated as inactive.** `RadiologyConsentPanel.tsx` computed
   `inactive` from `['cancelled','canceled','reported','performed','completed']` and passed
   `disabled: inactive || loading || busy` into the upload/attachments panel. The shared panel
   disabled both the upload button and the form submit. The service itself rejected only
   cancelled requests, so this was a UI-side over-restriction that also made every already
   reported request — including the seeded `Chest X-Ray PA View` request, which is created with
   `status: 'Reported'` in `src/db/seed.ts` — permanently un-uploadable.
2. **Simple uploads could never satisfy verification.** Verification required
   `patient_signature='PRESENT'`, `doctor_signature='PRESENT'`, a doctor id and a signing date on
   the document. The simple upload path deliberately records `UNKNOWN` for all of those, so even a
   successful upload could not be verified: the workflow was internally contradictory.

## Responsible clinician detection

The old message **“No active authenticated Doctor identity”** came from
`state.currentDoctor?.name ?? 'No active authenticated Doctor identity'`. `currentDoctor` is the
_signed-in_ user looked up through the active `DOCTOR` role, so it is always null for a Facility
Administrator. The screen presented that as a missing doctor instead of distinguishing “your
account is not a doctor” from “no doctor exists”.

The panel now returns both:

- `currentDoctor` / `viewerIsDoctor`: the signed-in user when they hold an active, non-revoked
  `DOCTOR` role in this tenant and facility; and
- `reviewDoctors`: up to 50 active doctors in the same facility, offered for _identification only_
  to non-doctors.

Only `viewerIsDoctor` enables the confirmation checkbox and **Verify consent**. The server also
rejects any decision where `clinicianId !==` the authenticated user (`SELF_VERIFICATION_REQUIRED`, 403) and still requires an active `DOCTOR` role in the exact facility
(`INVALID_CLINICIAN`). This closes a real impersonation gap: the previous service checked that the
document's doctor matched the submitted `clinicianId` but never that the caller _was_ that doctor,
so an administrator holding `radiology.consent.verify` could record verification naming a doctor.

## Simple upload

`RadiologyConsentPanel.tsx` replaces the previous nested metadata form and signature-detail panel.
The form contains exactly three controls (title required, notes optional, original file required),
shows the selected filename, previews the local selection, allows replacement, and uploads through
the existing `POST /api/patient-documents/patients/:patientId` endpoint with
`uploadMode: 'SIMPLE'` and `radiologyOrderId`. `radiologyOrderId` is the only association the client
supplies; the procedure name, facility, patient and uploader are read server-side. Unsupported
request fields (`patientId`, `facilityId`, `doctorId`, category, consent type, signing date, audit
reason, signature statuses) are not collected and are ignored on the simple path.

The document is stored once in `patient_signed_documents` and therefore appears in both the request
panel and Patient Management → Consent & Signed Documents, with no copy or synchronisation job.

The request panel now shows: consent status, request number and procedure, upload/attach action,
attached documents (title, original filename, upload date, uploader, review state, preview,
download, version history, correction, central hand-off), and doctor verification. Facility-wide
policy moved to **System Configuration → Radiology Consent**.

## Reported requests

`decideRadiologyConsent` continues to refuse completion-state changes. Uploads now split explicitly:

| Request state                    | Ordinary consent upload                      | Verification                                 | Historical attachment                 |
| -------------------------------- | -------------------------------------------- | -------------------------------------------- | ------------------------------------- |
| Requested / pending              | allowed                                      | allowed by a signed-in doctor after review   | refused (`HISTORICAL_NOT_APPLICABLE`) |
| Reported / performed / completed | refused (`RADIOLOGY_REQUEST_COMPLETED`, 409) | refused (`PROCEDURE_ALREADY_COMPLETED`, 409) | allowed with a reason                 |

A historical attachment sets `radiology_attachment_context='POST_REPORTING_HISTORICAL'`, keeps the
real `uploaded_at` (never back-dated), records a `HISTORICAL_ATTACHMENT` event with
`preProcedureConsentSatisfied: false` and the request's reporting state, and is excluded from
verification and from the completion trigger. It cannot retroactively satisfy consent and does not
alter an existing decision or report.

No audited radiology reopening workflow exists in this repository: the only writer of
`radiology_orders.status` outside creation is the report update, and no route reopens a completed
request. Nothing was invented to make a demonstration pass; a wrongly reported request needs an
authorized correction to the clinical record outside this task, and the UI does not silently reopen
anything.

## Enforced safeguards

- Completion remains guarded in PostgreSQL. `0101_radiology_consent_simplification.sql` strengthens
  `jcare_radiology_consent_guard()`: it now also requires the decision's clinician to be the
  deciding user, to hold an active `DOCTOR` role in that exact tenant/facility, to reference the
  request's own procedure document, that the document is not a post-reporting historical
  attachment and is the latest version, and that a `RADIOLOGY_VERIFIED` event by that clinician
  exists for that order and document.
- `REJECTED` decisions are now recordable (with a reason) and block completion, giving the requested
  "Consent rejected" status; migration `0101` widens the status check constraint.
- Uploading never verifies. Original bytes and hashes remain immutable; corrections create a new
  version. Cancelled requests still refuse uploads and decisions. Wrong-patient and wrong-request
  documents are rejected. Portal release remains a separate, explicitly reasoned action with the
  existing per-version policy.

## Tests

Synthetic only, against a disposable PostgreSQL 16 cluster on `127.0.0.1:55439` created for this
task (control file identifier and data directory independently attested before any write). No
production database, patient document or credential was read.

| Suite                                                                                | Result                             |
| ------------------------------------------------------------------------------------ | ---------------------------------- |
| `src/tests/vitest/radiology-consent-simple-ui.spec.tsx`                              | 6 passed                           |
| `src/tests/vitest/radiology-consent-policy-ui.spec.tsx`                              | 3 passed                           |
| `src/tests/vitest/patient-documents-ui.spec.tsx`                                     | 8 passed                           |
| `src/tests/integration/radiology-consent-simplified.db.spec.ts`                      | 11 passed (real HTTP + PostgreSQL) |
| `src/tests/integration/patient-signed-documents.db.spec.ts`                          | 43 passed                          |
| `src/tests/integration/simple-patient-documents.db.spec.ts`                          | 11 passed                          |
| Built-app browser acceptance (`scripts/radiology-simple-consent-acceptance.ts`)      | 41 checks passed                   |
| Built-app consent/portal regression (`scripts/simple-document-upload-acceptance.ts`) | 35 checks passed                   |

The database suite covers the requested matrix: simple upload; exact patient/request/procedure
linkage; single central record; byte-identical preview/download; administrator upload without
impersonation; doctor self-verification; missing consent and unverified consent both blocking
completion; wrong patient/request rejection; cancellation; reported-request refusal including
historical handling; and unchanged portal release.

Browser evidence in `docs/audits/radiology-consent-simplification-evidence/`:

- `01-consent-uploaded.png` — simple upload completed, status "Document uploaded — awaiting doctor
  review", attached list with filename/uploader/preview.
- `02-administrator-cannot-verify.png` — administrator sees the doctor-selection note and disabled
  verification controls.
- `03-doctor-verified.png` — doctor identified as "you, signed in", verification recorded, report
  saved.
- `04-report-blocked.png` — missing-consent report refused with the consent-required message.
- `05-reported-historical.png` — reported request offering only historical attachment.
- `06-configuration-policy.png` — facility-wide policy in System Configuration.
- `results.json`, `synthetic-consent.pdf` — named checks and the synthetic fixture bytes.

### Limits

Headless Chromium does not paint the application's `<iframe>` PDF viewer; the original was retrieved
byte-for-byte through the authenticated endpoint and the app's own preview control was exercised.
This is not a signature-authentication, legal-consent or clinical-validation claim. The repository's
pre-existing, unrelated failures in `migrations.spec.ts` (unguarded DDL in historical migration
`0095`) and in unrelated billing/reporting suites are unchanged by this task; `0101` itself follows
the guarded-DDL rule and applies cleanly from an empty database (102 migrations).

## Changed files

- `drizzle/0101_radiology_consent_simplification.sql`, `drizzle/meta/_journal.json`
- `src/documents/patient-documents.service.ts`, `src/documents/patient-documents.routes.ts`
- `src/components/RadiologyConsentPanel.tsx` (rewritten)
- `src/components/PatientDocumentsPanel.tsx` (request-mode workflow removed)
- `src/components/modules/RadiologyConsentPolicyPanel.tsx` (new), `ConfigurationModule.tsx`
- `src/api/patient-documents.client.ts`
- Removed: `src/components/RadiologyConsentMetadata.tsx` (the redundant clinical-assertion form)
- Tests and harnesses listed above; `scripts/radiology-consent-acceptance.ts` removed as superseded
  by the simplified browser acceptance, whose historical evidence remains in
  `docs/audits/radiology-consent-evidence/`.

## Reproduction

```sh
# Disposable synthetic PostgreSQL required; credentials stay in an ignored env file.
npx tsx scripts/migrate.ts
npx vitest run --maxWorkers=1 \
  src/tests/integration/radiology-consent-simplified.db.spec.ts \
  src/tests/integration/patient-signed-documents.db.spec.ts \
  src/tests/integration/simple-patient-documents.db.spec.ts \
  src/tests/vitest/radiology-consent-simple-ui.spec.tsx \
  src/tests/vitest/radiology-consent-policy-ui.spec.tsx
npm run build && npm run build:server
RESPONSIBLE_DOCTOR_SYNTHETIC=YES npx tsx scripts/radiology-simple-consent-acceptance.ts
```
