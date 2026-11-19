# JaliCare HMIS — Complete System Documentation

**AfyaHub Kenya · Health Information Management System**

| Field | Value |
| --- | --- |
| Document title | JaliCare HMIS — Complete System Documentation |
| Document identifier | JC-DOC-001 |
| Version | 1.0 |
| Document date | 19 November 2026 |
| System version | 0.1.0 (package manifest) |
| Repository | `fetronix/afyahub-hmis-kenya` |
| Branch documented | `arena/e088f11d-afyahub-hmis-kenya` |
| Base commit | `0111b5502e1a8d8a21faf53845360122275727df` |
| Database platform | PostgreSQL 16 |
| Runtime | Node.js 22 |
| Classification | Internal — facility operations and technical support |

> **How this document was produced.** Every statement about implemented behaviour was checked against source code, the database schema and migrations, or the running application. Where a feature could not be verified it is marked **Not verified** or **Not implemented** rather than described as working. Screenshots are browser captures recorded in this repository as acceptance evidence; their origin is listed in `docs/documentation/SCREENSHOT_PROVENANCE.md`. Diagrams are explanatory drawings, and each caption says whether it describes the intended process or an evidenced one. No figure, table or test result in this document was written from memory or assumed.

## Document control

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| 1.0 | 19 Nov 2026 | Engineering documentation task | First complete issue: 29 chapters, module inventory, screenshot library, report catalogue, traceability matrix. |

## Audience

This document is written for facility management, hospital administrators, clinicians, nursing staff, laboratory and radiology staff, pharmacists, accountants, procurement and stores staff, HR and payroll staff, system administrators, developers and support engineers. Each chapter opens with the roles it addresses. Chapters 1–2 and 25–26 address administrators and technical staff; the clinical chapters address the staff who use those screens.

## Reading conventions

- **Verified** — observed in the running application and/or asserted by an automated test whose output is recorded in Chapter 27.
- **Implemented, not exercised** — source code and schema exist and the screen renders, but no end-to-end run with data was performed for this issue.
- **Not implemented** — the feature is absent; the report catalogue or the screen says so explicitly.
- **Not verified** — no evidence either way was available. Treated as a gap, never as a capability.
- Amounts are in Kenya Shillings (KES) unless stated. The database stores money as integer **cents** (`*_cents` columns); the interface divides by 100 for display.
- Dates are ISO `YYYY-MM-DD` unless a screen is described, in which case the screen's own format is quoted.
- "The synthetic facility" means **Syrona Medical Center (Synthetic)**, facility code `SYN-SMC-01`, tenant `syrona-synthetic-company`. Every figure in this document is synthetic test data. It is not a real facility's accounts and must never be presented as audited records.

---

# Chapter 1 — Introduction

**Roles:** all. **Purpose:** what the system is, what it covers, and how to read the rest of this volume.

## 1.1 Purpose of the system

JaliCare HMIS (AfyaHub Kenya) is a multi-tenant hospital information management system for Kenyan health facilities. It covers the patient journey from registration through outpatient and inpatient care, diagnostics, pharmacy, billing and payment, and it carries the facility's accounting through to financial statements and partners' equity. It also carries workforce records and payroll, fixed assets, procurement and stock, insurance claims, budget planning and a reporting centre.

The system is a single Node.js process serving a React single-page application and a JSON API, backed by PostgreSQL. It is designed for facilities that must produce auditable financial records alongside clinical records, and it enforces that separation: a clinical action that creates a charge posts through the billing module, and a financial posting is only made through the accounting service with an open period, a balanced journal and an audit trail.

## 1.2 System overview

| Layer | Technology | What it does |
| --- | --- | --- |
| Presentation | React 18 + TypeScript, Vite | Single-page application, role-aware navigation, facility switcher, patient portal |
| API | Express + TypeScript (`server.ts`, `src/app.ts`, `src/routes/*`) | JSON API, request context, authorization, module gates |
| Domain services | TypeScript modules under `src/*` | Clinical workflows, billing, accounting, payroll, assets, procurement, reporting |
| Persistence | PostgreSQL 16, Drizzle ORM and SQL migrations | 108 migrations; every record, including clinical narrative and financial postings |
| Documents | Server-side PDF rendering (`src/documents`, `src/financial-statements/export.ts`) | Payslips, statements, receipts, reports |
| Exports | XLSX and PDF generation returned by the API | Partner statements, annual statements, report-centre exports |

The API exposes **571 route handlers across 57 route files**, listed with method, path and source file in `docs/documentation/api-inventory.csv`.

## 1.3 Intended facilities and users

The system targets private clinics, medical centres and small hospitals: facilities with a handful of clinical departments, a cashier, an accountant, and partners who contribute capital. The synthetic reference facility is a medical centre with five partners, an outpatient department, a maternity unit, a theatre list, a dialysis unit, a laboratory, a radiology room and a pharmacy.

Roles in the permission catalogue and staff-role policy include facility administrators, clinicians (doctors and clinical officers), nurses, laboratory technologists, radiographers, pharmacists, cashiers, accountants, finance controllers and approvers, auditors, HR officers, payroll officers, stores and procurement officers, and platform administrators. The permission model is described in Chapter 3; the full catalogue of **226 permissions** is in `docs/documentation/permission-catalogue.csv`.

## 1.4 Scope of this volume

| In scope | Out of scope |
| --- | --- |
| The build in this repository and the running instance used for evidence | Any other version, branch or deployment |
| Every module reachable in the navigation rail | Third-party systems the facility connects to |
| Financial records, statements and partners' equity | Tax filing, statutory certification and audit opinions |
| Reports that have an engine | The 116 catalogue reports that do not |
| Controls that exist in code and schema | Compliance attestations of any standard |

## 1.5 Capability map

| Area | Chapters | State |
| --- | --- | --- |
| Authentication, roles, permissions | 3, 25 | Verified |
| Patient registration and records | 5 | Screens verified; data path evidenced by acceptance suites |
| Reception, outpatient, inpatient | 6, 7 | Screens verified; ward configuration absent in the synthetic dataset |
| Laboratory, radiology | 8, 9 | Screens verified; no analyser or PACS integration |
| Pharmacy, inventory, procurement | 10, 20 | Verified through the Phase 5 evidence run |
| Maternity, theatre, dialysis | 11–13 | Implemented; screens and endpoints present, workflow not exercised in this issue |
| Billing and payments | 14 | Verified |
| Accounting, statements | 15, 16 | Verified figures as at 19 Nov 2026 |
| Partners' equity | 17 | Verified: 24/24 comparisons, zero difference |
| Payroll and statutory deductions | 18 | Calculation verified against configured versions; no statutory filing |
| Fixed assets | 19 | Verified through the Phase 5 evidence run |
| Human resources | 21 | Verified screens; training, appraisal and recruitment absent |
| Insurance and integrations | 22 | Claim preparation verified; live submission not verified |
| Reporting centre | 23 | 24 engines of 144 catalogue entries |
| Administration | 24 | Verified |
| Deployment and maintenance | 26 | Procedures documented; no production deployment performed |
| Testing | 27 | Executed and recorded, with gaps named |

## 1.6 What this document will not claim

It does not claim that the system is complete, that it conforms to any accounting standard, that its statutory rates are legally certified, that it is compliant with the Data Protection Act or any other regulation, or that it has been load-tested, penetration-tested or audited. Those claims would need evidence this issue does not hold; Chapter 25 sets out the controls that do exist, and Chapter 28 sets out everything that does not.
