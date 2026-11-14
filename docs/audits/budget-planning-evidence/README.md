# Budget planning — synthetic verification evidence

All data, users, facilities, workbooks and uploaded letterhead in this directory are **synthetic**. These files are not evidence that the requested original SYRONA workbook was available or imported.

## Browser captures

1. [Planning dashboard](01-dashboard.png)
2. [Annual plans and categories](02-annual-plans.png)
3. [Monthly item table](03-items.png)
4. [Uniform projections](04-uniforms.png)
5. [Planning periods](05-periods.png)
6. [Secure import and history](06-import.png)
7. [Report generation](07-reports.png)
8. [Audit history](08-audit.png)
9. [Issued report and retained branding version](09-issued-report.png)
10. [Editable mapped import preview](10-import-preview.png)
11. [Explicitly confirmed import summary](11-import-complete.png)
12. [390px mobile item view](12-mobile-items.png)

The authenticated production-server Chromium run completed **24 checks**, including negative-input validation, item/uniform CRUD, full-year preservation during filtered editing, built `.xls` worker parsing, explicit import confirmation, PDF/Excel download and mobile overflow checks. There were no page runtime errors. The only HTTP error responses were the expected initial 401 session probe and deliberate negative-price 400 validation test.

Machine-readable results: [browser-results.json](browser-results.json).

## Report and layout evidence

- [Two-page synthetic PDF](synthetic-multipage-report.pdf)
- [Excel export of the retained synthetic report](synthetic-multipage-report.xlsx)
- [Rendered PDF page 1](13-pdf-page-1.png)
- [Rendered PDF page 2](13-pdf-page-2.png)
- [PDF text-bound/margin checks](pdf-layout-results.json)

The PDF uses an uploaded/activated synthetic facility letterhead through existing Facility Branding. Its 62 item rows span two pages, with repeated table header, branding and page numbering. A separate synthetic workflow test verifies unchanged issued bytes after a replacement letterhead is activated. The PDF render images/layout checks used validation-only PDF.js/canvas tools, not an added application rendering/storage system.

## Synthetic import-count evidence

[synthetic-import-results.json](synthetic-import-results.json) records the generated workload only: 133 + 40 + 59 = 232 stationery items, five monthly branding items, seven uniform projections, 244 created records and 2,844 monthly child entries. The exact source category spellings were intentionally retained in that synthetic fixture. An empty Sheet3 and separate source rows 20–26 were also exercised.

**Those figures do not verify the original workbook.** The original file is still needed to reconcile its actual descriptions, source positions, formula structure, prices, contribution semantics and totals.

See the [implementation report](../BUDGET_PROCUREMENT_PLANNING_IMPLEMENTATION_2026-10-27.md) for file/table inventory, authorization, migration/testing results, reproduction commands and remaining limitations. Evidence timestamps reflect the sandbox runtime clock rather than a production timestamp attestation.
