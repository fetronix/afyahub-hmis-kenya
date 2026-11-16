# Syrona LETTER HEAD.pdf — safe URI Link acceptance

## Scope and exact cause

Branch: `arena/e088f11d-afyahub-hmis-kenya`. Starting HEAD: `70bdf0b45911c8dc230743c06a2ab2b083807ef1`.

The supplied one-page `LETTER HEAD.pdf` is available in the upload directory as `/tmp/arena-coding-uploads/LETTER HEAD.pdf` and byte-identical to the committed test fixture `src/tests/fixtures/letterhead-sample-a4.pdf`. Its SHA-256 is:

`7650930b5229cd57f58bda9788162b2f56967ba9a72e0aa1cdfa0256adb00ce0`

Independent inspection with PyMuPDF found one page and one link:

- `40 0 R`: `/Subtype /Link`
- `/A << /Type /Action /S /URI /URI (http://www.syronamedicalcenter.co.ke/) >>`
- Visible text: telephone, website, email, address and tagline
- No JavaScript, document-level OpenAction, embedded attachments, AcroForm fields or other automatic actions

At baseline commit `e754a858e6ac3b54ed7f98f874b7e3cb244fd6d3`, `src/documents/patient-file-validation.ts` walked every parsed dictionary and rejected any key in a blanket `forbidden` set containing `'A'` and `'OpenAction'`:

```text
insist(!forbidden.has(key.decodeText()), 'UNSAFE_PDF',
  'Active content, actions and embedded attachments are not supported.')
```

The file therefore failed at `40 0 R/A`, not because of its logo, scan, signature artwork, header or footer. The exact legacy rejection path is recorded as `40 0 R/A` in `docs/audits/pdf-uri-link-evidence/results.json`. The earlier namespace-aware inspector still treated all `URI` actions as `externalActions`, so it also rejected the same ordinary website link with a feature-specific external-action message. Both upload surfaces now share one corrected structural policy.

The current letterhead validator is a separate geometry/parse validator using the same shared inspector; the historical generic message came from the patient validator. Neither browser MIME type, file extension, storage nor preview was the cause. No production database or patient/facility document was accessed.

## Implemented URI policy

`src/security/pdf-static-content.ts` now allows a `URI` action only when all of the following hold:

- The action is the `/A` slot of an actual page `/Link` annotation. URI actions in `/OpenAction`, `/AA`, other annotations, orphaned objects or action chains remain rejected.
- The action dictionary contains only `/Type`, `/S`, `/URI` and an optional inert `/IsMap false`; `/Type`, if present, must be `/Action`. No `/Next` chain or unexpected keys.
- `/URI` is a PDF string or hex string, not another PDF object.
- The string is an absolute `http:` or `https:` URL of at most 4096 characters with a host and no username/password.
- Raw and percent-decoded values contain no whitespace, C0/C1 controls, backslashes or malformed percent escapes. Dangerous schemes such as `javascript:`, `data:`, `file:`, `ftp:`, `mailto:`, `tel:` and `vbscript:` are rejected.

Validation is structural. No URL is fetched, no PDF JavaScript is executed, no Launch action is run, and no external PDF action is dispatched during validation or preview.

### Still blocked

JavaScript and escaped/additional-action JavaScript, Launch, embedded files/file specifications/associated files, nonempty AcroForm fields/widgets/XFA, external GoToR/GoToE/SubmitForm/ImportData actions, unsupported annotation subtypes and multimedia, PostScript XObjects, external stream data, malformed destinations/structures, action chains, unsupported URI schemes and URI actions outside a page Link. Existing PDF signature, extension, MIME, size, page-count/geometry, patient/facility authorization, procedure-specific consent verification, immutable-version and explicit portal-release rules are unchanged.

## Original custody and derived static preview

The original uploaded bytes are never rewritten. Both patient and letterhead APIs continue storing the original bytes and SHA-256, and authorized `download=1` retrieval returns them unchanged. `staticPdfPreview()` in `src/security/pdf-preview.ts` is an **ephemeral, in-memory derivative only**:

1. It validates the original first; unsafe uploads fail closed and are never silently stripped then accepted as safe.
2. It removes `/A` and `/Dest` from Link annotations and removes document `/OpenAction`.
3. It removes now-orphaned indirect action dictionaries and labels the derivative in PDF metadata as `Derived static preview — not the original signed document`.
4. It re-parses and re-inspects the derivative, then returns it only if durable and action-free. If this cannot be trusted, the preview fails with a safe 422 message; the original remains downloadable.

`?preview=1` returns the derivative with `X-Document-Preview: derived-static`, a `derived-static-preview.pdf` filename, an explicit UI label, and a sandboxed iframe. `?download=1` always returns the original. The branding UI has a separate **Download original** control. The derived copy is not written to document storage and is never described as the original signed document. Portal previews use the same explicit-release and download-policy checks as before.

## Actual-file and regression evidence

Evidence directory: `docs/audits/pdf-uri-link-evidence/`.

- `supplied-syrona-letterhead.pdf`: byte-identical original, SHA-256 above.
- `syrona-derived-static-preview.pdf`: clearly named derived preview, SHA-256 `e6f6ea6e2dc0b8aac45c2510c886105fde58b2fb4915e94a9146dba8ed2181cb`.
- `syrona-original.png` and `syrona-derived-static-preview.png`: independently rendered with pinned PyMuPDF 1.26.6.
- `rendering.json`: original has one expected HTTP URI link; derived preview has zero links; visible text and rendered pixel samples are identical.
- `results.json`: 169 built-browser PDF checks, no uncaught errors/failed same-origin 500 responses, synthetic-only, no production access.
- `consent-regression-results.json`: 36 built-browser consent/portal checks.
- `patient-supplied-syrona-letterhead.png`: built-app screenshot showing the derived-preview label. The headless Chromium native PDF viewer does not paint the iframe; actual Blob bytes were captured and compared, and the independently rasterized PDFs were visually inspected instead. This is a headless viewer limitation, not evidence that the stored PDF is empty.

Visual inspection confirms the Syrona logo, header rule and tagline, footer graphics, telephone, website, email and Nyeri address are intact in both the original and derived preview. The website hyperlink no longer triggers rejection but is absent as a clickable action in the derived preview.

## Verification results

- Typecheck: passed (`npm run typecheck -- --singleThreaded`).
- Scoped ESLint: 0 errors, 1 unchanged React hook warning in `BrandingDocumentsPanel.tsx`.
- Production Vite build and server build: passed.
- Targeted Vitest: **164/164 tests in 6 files passed**, including 45 URI-link/preview tests, 36 shared-inspector tests, 25 real HTTP/storage tests, 43 signed-document/consent tests and patient UI/synthetic-DB guard tests.
- Built browser PDF acceptance: **169/169 checks passed** on both patient and branding upload surfaces, including the exact supplied PDF, ordinary HTTP/HTTPS Links, JS, Launch, attachments, unsafe URI schemes, malformed PDFs and oversized/limit cases.
- Built browser consent/portal regression: **36/36 checks passed**, including patient-own scope, explicit reasoned portal release, no upload-time consent verification, immutable versions and unchanged signature defaults.
- Disposable synthetic PostgreSQL `clinical_documents_synthetic_test` on `127.0.0.1:55439`, independently attested cluster/data directory; no production credentials or data.

A separate repository-wide Vitest run was not clean: 3,211 tests passed, 9 unrelated tests failed and 94 were skipped; 13 suites were marked failed, including existing migration-governance, schema-contract, billing and deploy-artifact suites. None of the PDF, consent or portal suites failed. Those unrelated suites were not modified by this task and are outside its scoped acceptance.

## Reproduction

```sh
# Disposable synthetic DB and env are required; see scripts/pdf-compatibility-acceptance.ts.
npx vitest run --maxWorkers=1 \
  src/tests/vitest/pdf-uri-links.spec.ts \
  src/tests/vitest/pdf-static-content.spec.ts \
  src/tests/integration/pdf-compatibility.db.spec.ts \
  src/tests/integration/patient-signed-documents.db.spec.ts
npm run build && npm run build:server
PDF_COMPATIBILITY_EVIDENCE_DIR=docs/audits/pdf-uri-link-evidence \
  npx tsx scripts/pdf-compatibility-acceptance.ts
PYTHONPATH=.tmp-tools/pdf-render python3 scripts/render-pdf-uri-link-evidence.py
```

No application dependency or lockfile changes were made. The implementation is delivered in one ordinary task-only commit on the current branch; the full commit SHA and push verification are reported in the final delivery response.
