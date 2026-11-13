# P0 Document Generation — Completion Report

**Date:** 2026-11-13
**Branch:** `arena/e088f11d-afyahub-hmis-kenya`
**Base commit:** `34b00d1` (published tip of this branch; the local clone had been
rewound to `0111b55` by a sandbox reset and the branch pointer was restored from
`origin` before committing — see §9)
**Verification:** TypeScript 0 errors · ESLint 0 errors / 103 warnings · 289 test
files, 2,707 tests passing · production build passing

---

## 1. What was asked for, and what exists now

The requirement was that a facility's letterhead be **dynamic, versioned and
facility-scoped** — never hardcoded, never tied to one facility, changeable with
no code change, no manual SQL and no redeployment — and that **every** supported
document type print on the version that was active **when it was issued**, while
previously issued documents keep their original letterhead on reprint.

| Requirement                                                    | Status | Evidence                                                                                   |
| -------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Upload / preview / activate / replace / withdraw               | Done   | `src/branding/letterhead.service.ts`, `letterhead.routes.ts`, `BrandingDocumentsPanel.tsx` |
| Version history with activation timestamps                     | Done   | `facility_letterheads` (`0089`, `0090`); immutable content triggers                        |
| Uploader and activator identity                                | Done   | `created_by`, `activated_by`, `retired_by`; `letterhead_events`                            |
| Audit events                                                   | Done   | `letterhead_events` rows written by every lifecycle call                                   |
| Strict tenant + facility isolation                             | Done   | every query filters both; cross-tenant id returns 404 (`letterhead-branding.db.spec.ts`)   |
| PDF validation (extension, MIME, `%PDF-`, `%%EOF`, size)       | Done   | upload route; invalid files rejected with 400                                              |
| Stored outside public paths, never exposed                     | Done   | `bytea` column, no filesystem path, authorized download only                               |
| One shared renderer, no per-template letterhead code           | Done   | `src/documents/render.ts` is the only PDF composer                                         |
| Preview of the **actual** generated document before activation | Done   | `GET …/letterheads/:id/preview-document` renders a real finalized invoice on a draft       |
| A→B acceptance test for every document type                    | Done   | `document-generation.db.spec.ts` → 5 tests, all 8 types, 20/20 passing                     |
| Historical preservation on reprint                             | Done   | invoice prints its stamped `letterhead_id`; the other seven resolve by issuance instant    |
| Missing-letterhead fallback                                    | Done   | renders plain A4, `X-Letterhead-Applied: false`                                            |
| Multi-page, no overlap, consistent A4                          | Done   | content laid out inside a stored body rectangle; letterhead page 2 for continuations       |
| Printable == downloadable                                      | Done   | same bytes; `?download=1` changes only the disposition                                     |

---

## 2. Files

### Created

| File                                                   | Purpose                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `drizzle/0090_letterhead_pdf_documents.sql`            | adds the PDF payload, hashes, geometry, body rectangle and the lifecycle guarantees to `facility_letterheads` |
| `src/branding/letterhead.service.ts`                   | upload, validate, measure, activate, withdraw, resolve-by-instant                                             |
| `src/branding/letterhead-layout.ts`                    | infers the printable body rectangle from a PDF's content stream                                               |
| `src/branding/letterhead-pdf.ts`                       | low-level PDF inspection (page count, size, signature)                                                        |
| `src/branding/letterhead.routes.ts`                    | HTTP surface, including `preview-document`                                                                    |
| `src/documents/document-model.ts`                      | the 8-kind document model the renderer consumes                                                               |
| `src/documents/render.ts`                              | the single renderer (pdfkit content + pdf-lib letterhead compose)                                             |
| `src/documents/document.service.ts`                    | builds each document from persisted rows and authorizes the caller                                            |
| `src/documents/document.routes.ts`                     | 8 print endpoints                                                                                             |
| `src/api/clients/branding.client.ts`                   | browser client: branding lifecycle, `documentClient`, `fetchBinary`, `openBlob`                               |
| `src/components/modules/BrandingDocumentsPanel.tsx`    | the branding workflow UI                                                                                      |
| `src/tests/integration/letterhead-branding.db.spec.ts` | 13 tests                                                                                                      |
| `src/tests/integration/document-generation.db.spec.ts` | 20 tests (15 document + 5 letterhead-versioning acceptance)                                                   |
| `src/tests/fixtures/letterhead-sample-a4.pdf`          | synthetic A4 stationery fixture                                                                               |
| `docs/branding/facility-letterheads.md`                | operator and engineer guide                                                                                   |

### Modified

| File                                               | Change                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `package.json`, `package-lock.json`                | `pdf-lib@^1.17.1`                                                                           |
| `drizzle/meta/_journal.json`                       | journal entry `idx 90` for `0090`                                                           |
| `src/db/schema/facility-branding.ts`               | `sourcePdf`, hashes, page geometry, body rectangle, `layoutSource`                          |
| `src/app.ts`                                       | mounts `/api/facility-branding` above `express.json()` (the upload body is the PDF)         |
| `src/routes/index.ts`                              | mounts `/api/documents`                                                                     |
| `src/seeds/permissions.ts`                         | `facility.branding.read`, `facility.branding.manage`; granted to the facility administrator |
| `src/billing/finalized-invoice.service.ts`         | finalization stamps `letterhead_id` (NULL when none is active)                              |
| `scripts/backup/engines.mjs`                       | `bytea` is dumped as `\x<hex>` and restored byte-for-byte                                   |
| `src/tests/integration/backup-restore.db.spec.ts`  | regression test for binary columns                                                          |
| `src/components/modules/ConfigurationModule.tsx`   | "Branding & documents" tab                                                                  |
| `src/components/modules/FinalizedInvoicePanel.tsx` | **Open / Download invoice PDF**                                                             |
| `src/components/modules/RefundsPanel.tsx`          | **Receipt PDF**, **Thermal**, **Credit note PDF**                                           |
| `src/components/modules/LaboratoryModule.tsx`      | **Print laboratory report** (completed orders only)                                         |
| `src/components/modules/RadiologyModule.tsx`       | **Print report** (reported examinations only)                                               |
| `src/components/modules/InpatientModule.tsx`       | **Summary PDF** per discharged admission                                                    |
| `src/components/modules/ProcurementModule.tsx`     | **Order PDF** per purchase order                                                            |
| `src/components/procurement/ReceivingPanel.tsx`    | **GRN PDF** per goods received note                                                         |

---

## 3. Database

Migration `0090` extends the existing `facility_letterheads` table — no duplicate
tables, no new migration family. It adds:

- `source_pdf bytea`, `source_pdf_sha256`, `source_pdf_bytes`, `source_pdf_pages`
- `page_width_pt`, `page_height_pt`
- `body_top_pt`, `body_bottom_pt`, `body_left_pt`, `body_right_pt`, `layout_source`
- a partial unique index guaranteeing **one `ACTIVE` version per facility**
- triggers that reject `DELETE`, reject any change to the bytes/hash/geometry,
  reject `DRAFT → SUPERSEDED`, reject `ACTIVE → ACTIVE`, and freeze retired rows
- a second trigger that freezes the body rectangle once a version is `ACTIVE`

Schema state after migration: 91 journal entries, 236 tables, 119/119 schema
contract checks. Nothing in this change requires manual SQL: the only rows an
operator creates are letterhead uploads, and those go through the API.

---

## 4. Endpoints

**Branding** (`facility.branding.read` to view, `.manage` to change):

```
GET    /api/facility-branding/facilities/:facilityId/letterheads
POST   /api/facility-branding/facilities/:facilityId/letterheads?filename=…
GET    /api/facility-branding/facilities/:facilityId/letterheads/:id
GET    /api/facility-branding/facilities/:facilityId/letterheads/:id/file[?download=1]
GET    /api/facility-branding/facilities/:facilityId/letterheads/:id/preview-document[?invoiceId=|?document=receipt&paymentId=]
PATCH  /api/facility-branding/facilities/:facilityId/letterheads/:id       (body rectangle, DRAFT only)
POST   /api/facility-branding/facilities/:facilityId/letterheads/:id/activate
POST   /api/facility-branding/facilities/:facilityId/letterheads/:id/withdraw
```

`preview-document` renders a **real finalized invoice** through the production
renderer. With no `invoiceId` it selects the newest finalized invoice at the
facility, so the button works without the administrator knowing an invoice
number; if the facility has never finalized one, it answers `409
DOCUMENT_NOT_PRINTABLE` with an instruction rather than a blank page.

**Documents** (`?download=1` → attachment; otherwise inline):

```
GET /api/documents/invoices/:id/pdf                        billing.read
GET /api/documents/receipts/:id/pdf[?thermal=1]            billing.read
GET /api/documents/credit-notes/:id/pdf                    billing.read
GET /api/documents/purchase-orders/:id/pdf                 procurement.read
GET /api/documents/goods-received-notes/:id/pdf            procurement.read
GET /api/documents/laboratory-orders/:id/pdf               laboratory.read
GET /api/documents/radiology-orders/:id/pdf                radiology.read
GET /api/documents/admissions/:id/discharge-summary.pdf    inpatient.read
```

Every response carries `Cache-Control: private, no-store`,
`X-Content-Type-Options: nosniff`, `X-Document-Pages`,
`X-Letterhead-Applied` and `X-Letterhead-Version`.

---

## 5. Which letterhead a document prints on

```
issue time ───────────────────────────────────────────────►
        [ v1 ACTIVE ]      [ v2 ACTIVE ]      [ v3 ACTIVE ]
             ▲                  ▲                  ▲
        a document issued here prints on v1 ──────┘
```

`resolveLetterheadAt(tenantId, facilityId, issuedAt)` answers from the activation
history alone (`activated_at ≤ t < COALESCE(retired_at, ∞)`, latest wins). Each
builder passes its own **issuance** instant, not the moment Print was pressed:

| Document            | Issuance instant                            |
| ------------------- | ------------------------------------------- |
| Invoice             | the `letterhead_id` stamped at finalization |
| Receipt             | `payment_date`                              |
| Credit note         | `refund.created_at`                         |
| Purchase order      | `order.created_at`                          |
| Goods received note | `grn.created_at`                            |
| Laboratory report   | `completed_at` (fallback `ordered_at`)      |
| Imaging report      | `reported_at`                               |
| Discharge summary   | `discharge_date`                            |

A null answer means no letterhead was in effect then, and the document prints on
plain A4 instead of borrowing today's branding.

### The timezone defect found and fixed in this pass

The receipt reprint printed on letterhead **B** in the acceptance test. The cause
was not the resolver: the test harness sets `TZ=Africa/Nairobi`, and Drizzle maps
a `timestamp` column (`pg` parses it without a zone) to the same wall-clock fields
in UTC. Handing that `Date` to a comparison — either in JS or through the driver —
moved the issuance instant three hours into the future, past the activation of B.

Two changes removed the whole class of defect:

1. **Activation and retirement timestamps are now written with `now()`** (SQL)
   rather than a JS `Date`, so the lifecycle history and the document timestamps
   it is compared against come from the same clock. The driver would otherwise
   have serialised a process-local wall clock into a `timestamp` column.
2. **`resolveLetterheadAt` compares inside PostgreSQL** against an explicit UTC
   `timestamp` literal (`toUtcWallClock`), so no driver-parsed value can shift
   the boundary.

A letterhead history must not answer differently because of the deployment's
`TZ`; after this change it cannot.

---

## 6. Rendering

`src/documents/render.ts` is the only place a PDF is produced:

1. `pdfkit` writes the content inside the body rectangle of an A4 page.
2. `pdf-lib` embeds the letterhead page beneath the content page at identical
   origin and size — no scaling, no reflow, no rasterisation.

Headers repeat on every page. When a letterhead has two or more pages, page 1 of
the letterhead backs the first content page and page 2 backs every continuation,
following the pre-printed stationery convention. Thermal receipts (226 × 900 pt)
never receive a letterhead: the paper is 80 mm wide and the artwork is A4, so the
response reports `letterheadApplied: false` rather than drawing something
unusable.

The body rectangle is inferred from the upload's content stream: painted paths
and images bound the vertical extent exactly; text runs inform the vertical band
only, because their width cannot be known without font metrics; side margins come
from side artwork, not from full-width bands or bleed. If a page cannot be
interpreted, conservative defaults are used — never a blank-page assumption,
which would print content over the artwork. The rectangle stays editable while a
version is a `DRAFT`.

---

## 7. UI workflows

- **Facility settings → Branding & documents**: upload → preview the file →
  **preview on a real document** → adjust content area → activate → replace /
  withdraw, with a version history showing who uploaded and who activated.
- **Billing, finalized invoice**: _Open invoice PDF_ and _Download invoice PDF_
  (the existing audited HTML print is unchanged and still available).
- **Billing, receipt history**: _Receipt PDF_, _Thermal_, and per refund
  _Credit note PDF_.
- **Laboratory**: _Print laboratory report_ on a completed investigation.
- **Radiology**: _Print report_ on a reported examination.
- **Inpatient**: _Summary PDF_ on a discharged admission.
- **Procurement**: _Order PDF_ per purchase order; _GRN PDF_ per goods received
  note in receiving.

Every button calls the same endpoint as the download, so what is shown and what
is saved are identical. Errors from the service (e.g. a document that is not yet
complete) are surfaced verbatim rather than replaced with a generic failure.

---

## 8. Security and isolation

- Every branding endpoint requires a session plus `facility.branding.read`
  (writes: `.manage`) and re-checks the tenant **and** facility of the row.
  Another tenant's id — or a sibling facility's — answers **404**, so the
  endpoint cannot confirm that another hospital has a letterhead.
- The stored bytes leave the database only through an authorization-checked
  endpoint with `no-store`; there is no filesystem path, no public URL and no
  unauthenticated download.
- The upload route is mounted above `express.json()` and parses its own raw body,
  because the body _is_ the PDF.
- Each document type requires its own permission, so a cashier cannot print a
  discharge summary and a laboratory user cannot print an invoice. Unknown ids
  answer 404 without confirming existence.
- Content is immutable after upload, enforced by trigger rather than convention.
- No branding is ever applied to a facility that has not uploaded and activated
  one. There is no platform-wide stationery and no Syrona branding in the
  renderer.

---

## 9. Git state

The local clone had been rewound to `0111b55` by a sandbox reset while the real
tip of this branch, `34b00d1`, was still published on `origin`. The branch pointer
was restored with a compare-and-swap (`git update-ref … 34b00d1 0111b55`) and the
index rebuilt from that tree without touching the worktree (`git read-tree HEAD`),
so the commit below contains only this task's work — 18 modified files and 16 new
files — rather than the 651-file difference against the stale commit.

Presented below are the verified results; the commit itself is recorded in the
task transcript.

### Test results

| Suite                                                            | Result                                             |
| ---------------------------------------------------------------- | -------------------------------------------------- |
| Full suite (`vitest run`, PG16 cluster attested)                 | **289 files / 2,707 tests passed**, 0 failed       |
| `document-generation.db.spec.ts`                                 | 20/20                                              |
| `letterhead-branding.db.spec.ts`                                 | 13/13                                              |
| `backup-restore.db.spec.ts`                                      | 6/6                                                |
| `FinalizedInvoicePanel` / `refunds` / `billing-cashier` UI specs | 10/10                                              |
| Inpatient / laboratory / procurement UI specs                    | 44/44                                              |
| `tsc --noEmit`                                                   | 0 errors                                           |
| `eslint .`                                                       | 0 errors, 103 warnings (all pre-existing patterns) |
| `prettier --check` on every file this task touched               | clean                                              |
| `npm run build`                                                  | success                                            |

The acceptance test that matters most:

> `issues batch A under letterhead A, then batch B under letterhead B` — all eight
> document types are issued twice, once per letterhead, and each PDF is asserted
> to contain its own stationery label and **not** the other's.

> `re-issues every batch-A document on letterhead A after B was activated` — all
> eight batch-A documents are reprinted after B became active and every one still
> prints A.

> `renders a real document on a candidate letterhead before activation` — a
> finalized invoice is rendered on a `DRAFT` version, writing nothing.

> `takes effect for newly issued documents with no restart or code change` and
> `isolates one facility's letterhead from another`.

### Evidence

Two invoices were generated through the production service and renderer for the
same facility, one issued under each letterhead, and written outside the
repository:

- `/home/user/document-proof-letterhead-A.pdf` — 1 page, letterhead applied,
  `Letterhead v1`
- `/home/user/document-proof-letterhead-B.pdf` — 1 page, letterhead applied,
  `Letterhead v2`

Text extracted from the two files begins `Stationery A …` and `Stationery B …`
respectively, on identical bodies (`SYN-LH-A…` / `SYN-LH-B…`, same patient, same
facility `MFL-AC-…`). The synthetic fixtures live only in the test database.

---

## 10. Limitations

- **The body rectangle is an inference.** A designed letterhead with unusual
  artwork may need a one-time adjustment before activation. That is why the
  preview exists and why the rectangle is editable on a draft — but a
  measurement is not a guarantee of print-shop fidelity.
- **No signature or stamp digitisation.** Signatures, seals and stamps must be
  part of the uploaded artwork; nothing is composited at print time.
- **The laboratory and imaging buttons depend on completion.** That is
  deliberate: the service refuses a report with unverified results or no findings
  (409 `DOCUMENT_INCOMPLETE`), so the buttons appear only where a report can
  legitimately exist.
- **Invoice PDFs are authorized by `billing.read` alone**, matching the published
  permission contract; the older HTML print additionally requires `clinical.read`
  and an explicit audit write. Both paths remain available and unchanged.
- **No compliance claim.** Nothing here has been assessed against an external
  standard, and the synthetic fixtures are not production data.
- **The pre-existing repository-wide Prettier state is unchanged.** `prettier
--check .` still reports about 60 files — all documentation that predates this
  task; reformatting them would add noise unrelated to this work.
- **Restoring the branch pointer was a recovery step.** It used a
  compare-and-swap ref update against the published tip; no reset, no rebase, no
  force-push, and the worktree was never rewritten.
