# Syrona Medical Center HMIS — Documentation Index

**Document set:** JC-PKG-001 · version 1.0 · issued 19 November 2026
**Repository:** `fetronix/afyahub-hmis-kenya` · branch `arena/e088f11d-afyahub-hmis-kenya` · base commit `0111b55`

This index says what each deliverable contains, who it is for, and how the pieces relate. Every document describes the same build; where they differ in depth, they do not differ in facts.

---

## The seven deliverables

| # | File | What it is | Read it if you are |
| --- | --- | --- | --- |
| 1 | `docs/SYRONA_COMPLETE_SYSTEM_DOCUMENTATION.docx` | The full volume: 29 chapters plus an evidence appendix, 97 figures, 91 tables | Anyone who needs the whole picture |
| 2 | `docs/SYRONA_COMPLETE_SYSTEM_DOCUMENTATION.md` | The same volume as readable Markdown, generated from the same chapter sources | Reading in a browser, reviewing a diff, or searching text |
| 3 | `docs/SYRONA_USER_MANUAL.docx` | Operator edition: the clinical, billing, stores, workforce, reporting and configuration chapters | Reception, clinical, nursing, pharmacy, cashier, stores, HR and payroll staff |
| 4 | `docs/SYRONA_TECHNICAL_MANUAL.docx` | Architecture, accounting and reporting engines, security, deployment and verification | Engineers, DBAs, system administrators, technical reviewers |
| 5 | `docs/SYRONA_TEST_AND_VERIFICATION_REPORT.docx` | The test register, the completion register and the evidence appendix | Reviewers, auditors, facility management signing off |
| 6 | `docs/SYRONA_REPORT_CATALOGUE.xlsx` | All 144 catalogue entries: status, engine, dependency, filters, outputs, permission | Report owners and anyone promising a report to a regulator |
| 7 | `docs/SYRONA_DOCUMENTATION_TRACEABILITY_MATRIX.xlsx` | Each requirement mapped to where it is answered, with open items | Whoever is checking that the brief was met |

Supporting directories:

| Path | Contents |
| --- | --- |
| `docs/documentation/assets/screenshots/` | 88 browser captures organised by module |
| `docs/documentation/assets/diagrams/` | 16 explanatory diagrams |
| `docs/documentation/SCREENSHOT_PROVENANCE.md` | The origin of every capture, with its source path and byte count |
| `docs/documentation/assets/screenshot-manifest.json` | Machine-readable version of the same |
| `docs/documentation/source/` | The Markdown chapter sources the Word files are built from |
| `docs/documentation/api-inventory.csv` | 571 API handlers with method, path and file |
| `docs/documentation/permission-catalogue.csv` | 226 permission codes |
| `docs/documentation/report-catalogue.csv` | The catalogue as data |
| `scripts/documentation/` | The build scripts: diagrams, screenshot assembly, Word, Excel |

---

## How the volumes relate

```
docs/documentation/source/*.md        (single source of truth)
        │
        ├── build-docs.py ──► COMPLETE (all chapters + appendix)
        │                 ├─► USER MANUAL (chapters 3–24)
        │                 ├─► TECHNICAL MANUAL (2, 15–17, 23, 25–29, appendix)
        │                 ├─► TEST REPORT (27–29 + appendix)
        │                 └─► Markdown master
        │
        ├── build-xlsx.py ──► REPORT CATALOGUE, TRACEABILITY MATRIX
        ├── make-diagrams.py ──► assets/diagrams/
        └── assemble-screenshots.mjs ──► assets/screenshots/ + provenance
```

A correction made in the source and rebuilt appears in every volume at once, which is why the four Word files never disagree with each other or with the Markdown master.

---

## Chapter map

| Chapters | Subject | In which volumes |
| --- | --- | --- |
| 1–2 | Introduction, architecture | Complete, technical |
| 3–4 | Login and users; dashboard | Complete, user |
| 5–13 | Clinical modules | Complete, user |
| 14 | Billing and revenue | Complete, user, technical |
| 15–17 | Accounting, statements, partners' equity | Complete, user, technical |
| 18–21 | Payroll, assets, inventory and procurement, HR | Complete, user |
| 22 | Insurance and integrations | Complete, user |
| 23–24 | Reporting centre; administration | Complete, user (23–24), technical (23) |
| 25–26 | Security and audit; deployment | Complete, technical |
| 27–29 | Testing; limitations; glossary | Complete, technical, test report |
| Appendix A | Evidence appendix | Complete, technical, test report |

---

## What the package does not contain

Stated here as well as in the volumes, because a reader of an index should not have to discover it later:

- No claim that the system is complete, certified, or compliant with any standard or law.
- No claim that statutory rates are legally certified: they are configured versions that a named user verifies and activates.
- No fabricated screenshots: 88 genuine captures are included, and six module screens that could not be captured are documented in words instead.
- No real patient, employee or facility data, and no credentials, keys or tokens.
- No test result that was not produced by a run recorded in this repository.

## Package status at issue

| Item | State |
| --- | --- |
| Chapters written | 29 plus appendix |
| Figures | 97 in the complete volume (88 captures, 16 diagrams, some reused) |
| Tables | 91 in the complete volume |
| Tests executed | 3,560 across 876 files; 36 failures, of which 18 were a database-name artefact, 6 genuine, 12 untriaged |
| Report catalogue | 144 entries: 24 available, 4 existing document, 116 not implemented |
| Open items | 7, listed in the traceability workbook |

## How to keep it current

1. Change the code.
2. Change the affected Markdown file in `docs/documentation/source/`.
3. Run `python3 scripts/documentation/make-diagrams.py` if a diagram changed.
4. Run `node scripts/documentation/assemble-screenshots.mjs` if a capture changed.
5. Run `python3 scripts/documentation/build-docs.py` and `python3 scripts/documentation/build-xlsx.py`.
6. Read the build output: it states the figure and table counts. A missing image stops the build rather than producing a placeholder.
