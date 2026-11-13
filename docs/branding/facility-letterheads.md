# Facility letterheads and generated documents

Every invoice, receipt, credit note, purchase order, goods received note,
laboratory report, imaging report and discharge summary is printed by one shared
renderer, underneath the letterhead of the facility that issued it. Nothing about
that letterhead lives in the source code: it is uploaded by each facility, stored
as bytes in PostgreSQL, and resolved from the database on every request.

This document describes how that works, what is guaranteed, and what is not.

---

## 1. Why it is built this way

A hospital's stationery is not configuration: it is the visual identity of a
legal document. If it were compiled into the application, changing it would mean
a redeploy, and a document printed last year could not be reproduced this year.
If it were global, one hospital's branding would appear on another's invoices.

So the rules are:

| Requirement                       | How it is met                                                             |
| --------------------------------- | ------------------------------------------------------------------------- |
| No code change to change branding | the PDF is uploaded and stored as a row                                   |
| Facility-scoped                   | every row carries `tenant_id` and `facility_id`; every query filters both |
| Versioned and auditable           | versions are immutable, activation writes an event                        |
| Historical fidelity               | a document prints the version that was active when it was issued          |
| One renderer                      | `src/documents/render.ts` draws every document type                       |
| Preview before activation         | a real finalized invoice can be rendered on a draft version               |

---

## 2. The data

`facility_letterheads` (migration `0089`, extended by `0090`)

| Column                                                           | Meaning                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `source_pdf`                                                     | the uploaded file, stored verbatim as `bytea`                      |
| `source_pdf_sha256`                                              | content hash; a duplicate upload of the same file is refused       |
| `source_pdf_bytes`, `source_pdf_pages`                           | size and page count, for the UI                                    |
| `page_width_pt`, `page_height_pt`                                | the first page's geometry                                          |
| `body_top_pt`, `body_bottom_pt`, `body_left_pt`, `body_right_pt` | the printable body rectangle, measured from the artwork            |
| `layout_source`                                                  | `MEASURED`, `ADJUSTED` or `DEFAULT`                                |
| `status`                                                         | `DRAFT` → `ACTIVE` → `SUPERSEDED`, or `WITHDRAWN`                  |
| `activated_at`, `retired_at`                                     | when the version became and ceased to be the facility's stationery |
| `created_by`, `activated_by`, `retired_by`, `retire_reason`      | who did what, and why                                              |

Three guarantees are enforced by the database itself, not only by the service:

1. **Content is immutable.** A trigger rejects any change to the bytes, hash,
   geometry or the original text fields, and rejects `DELETE` outright.
2. **One active version per facility.** A partial unique index on
   `(facility_id) WHERE status = 'ACTIVE'`.
3. **The layout freezes on activation.** The body rectangle may be corrected
   while the version is a `DRAFT`; once it is `ACTIVE`, documents have already
   been laid out against it.

Activation and retirement timestamps are written with `now()` — the database's
clock, not the application's — because they are compared against document
timestamps.

---

## 3. Which letterhead a document prints on

```
issued at T ───────────────────────────────────────────────►
              [ v1 ACTIVE ]        [ v2 ACTIVE ]      [ v3 ACTIVE ]
                   ▲ activated_at        ▲                  ▲
                   └ a document issued here prints on v1 ───┘
```

`resolveLetterheadAt(tenantId, facilityId, issuedAt)` answers "which version was
the facility's stationery at that instant" from the activation history alone.
Every builder passes the moment its document was **issued**, not the moment
somebody pressed Print:

| Document            | Issuance instant                                                         |
| ------------------- | ------------------------------------------------------------------------ |
| Invoice             | the letterhead recorded on `billing_invoice_finalizations.letterhead_id` |
| Receipt             | `billing_payments.payment_date`                                          |
| Credit note         | `billing_refunds.created_at`                                             |
| Purchase order      | `purchase_orders.created_at`                                             |
| Goods received note | `goods_received_notes.created_at`                                        |
| Laboratory report   | `lab_orders.completed_at` (falling back to `ordered_at`)                 |
| Imaging report      | `radiology_orders.reported_at`                                           |
| Discharge summary   | `admissions.discharge_date`                                              |

Invoices are the exception that proves the rule: the finalization row records the
letterhead **id**, so a reprint resolves that exact version even if the facility
has since replaced or withdrawn it. Every other document derives the version from
the history, which is why no letterhead id had to be added to eight tables.

A null answer is meaningful: it means no letterhead was in effect (never
activated, or withdrawn and not replaced), and the document prints on plain A4
rather than borrowing today's branding.

---

## 4. Rendering

`src/documents/render.ts` is the only place a PDF is produced.

1. `pdfkit` writes the document content inside the body rectangle of an A4 page,
   starting below the letterhead's ink and stopping above its footer.
2. `pdf-lib` loads the letterhead page and the content page and composes them at
   1:1 scale, at the same origin: letterhead underneath, content on top.

Nothing is scaled, reflowed or rasterised, so content cannot overlap artwork by
accident — the content is laid out inside a rectangle that was measured to be
empty. A letterhead with two or more pages follows the pre-printed stationery
convention: page 1 for the first content page, page 2 for every continuation.

Thermal receipts (226 × 900 pt) are never given a letterhead: the paper is 80 mm
wide and the branding is A4. The response reports `letterheadApplied: false`
rather than silently drawing something unusable.

---

## 5. Measuring the body rectangle

`src/branding/letterhead-layout.ts` reads the first page's content stream and
collects the boxes that carry ink.

- Painted paths and images bound the **vertical** extent exactly: the body starts
  `8 pt` below the lowest header ink and ends `8 pt` above the highest footer ink.
- Text runs are used for the vertical band only. Their width is unknown without
  parsing font metrics, and treating the estimate as real collapsed every
  designed letterhead to the minimum side margin.
- Side margins come from **side artwork** — logos, rules, blocks that do not span
  the page. Full-width bands say nothing about where a column may start, and
  bleed wider than the page is clamped instead of pulling a margin negative.
- If the page cannot be interpreted (an unparseable stream, an unresolved
  `/Contents`), the layout falls back to conservative defaults instead of
  assuming the page is blank. A blank assumption would print content over the
  artwork.

The measurement never throws: an administrator can correct a default in the UI,
but cannot correct a failure they were not told about.

---

## 6. The workflow

**Facility Settings → Branding & Documents**

1. **Upload** an A4 portrait PDF (≤ 8 MB). Extension, declared MIME type and the
   `%PDF-` signature must all agree; `%%EOF` must be present, so a truncated
   upload is rejected rather than half-stored. The file becomes a `DRAFT`.
2. **Preview the file** to see the stored bytes, and **preview a document** to
   see a real finalized invoice rendered on the candidate letterhead — the same
   renderer that will print it.
3. **Adjust the content area** if the measurement needs correction. Allowed on a
   draft only.
4. **Activate**. The incumbent is superseded in the same transaction; there is
   never a moment with two active versions or none.
5. **Replace** by uploading the next version, or **deactivate** with a reason.

Replacing a letterhead affects newly issued documents only. Everything already
issued keeps the version it was printed on, permanently.

---

## 7. Security and tenancy

- Every endpoint requires a session and `facility.branding.read`; writing also
  requires `facility.branding.manage`.
- The facility in the path must match the facility on the row, and the caller's
  scope is checked against both. Another tenant's id returns **404**, not 403, so
  the endpoint cannot be used to discover that another hospital has a letterhead.
- The stored bytes leave the database only through an authorization-checked
  endpoint with `Cache-Control: private, no-store`. There is no filesystem path,
  no public URL and no unauthenticated download.
- The upload route is mounted **before** `express.json()` and parses its own raw
  body, because the request body _is_ the PDF.
- Documents are authorized per type: `billing.read`, `procurement.read`,
  `laboratory.read`, `radiology.read`, `inpatient.read`. A cashier cannot print a
  discharge summary and a laboratory user cannot print an invoice.

---

## 8. Backups

`source_pdf` is a `bytea` column and the first real binary payload in the schema.
The logical backup engine now encodes `bytea` as PostgreSQL's `\x<hex>` form, so
a dump/restore cycle preserves the letterhead byte-for-byte. This is covered by a
regression test (`preserves binary columns byte for byte across a restore`); the
previous behaviour stored the JSON form of a Node `Buffer` and silently inflated
1,039 bytes into 3,727.

---

## 9. What this does not do

- It does not compose a letterhead from a logo and text fields. The `0089` text
  and logo columns remain for that earlier feature; the document pipeline uses the
  uploaded PDF.
- It does not digitise signatures, seals or stamps; those must be part of the
  uploaded artwork.
- It does not guarantee that a third-party PDF is print-shop perfect. The body
  rectangle is an inference from the artwork, which is why the preview exists and
  why the rectangle is editable before activation.
- It does not apply any branding to a facility that has not uploaded and activated
  one. There is no fallback logo, no platform-wide stationery and no Syrona
  branding anywhere in the renderer.
