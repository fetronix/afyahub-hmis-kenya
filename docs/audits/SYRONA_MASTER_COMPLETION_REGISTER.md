# Syrona Medical Center HMIS / AfyaHub Kenya — Master Completion Register

## 1. Authority, baseline and executive assessment

**Assessment date:** 2026-10-27. **Source baseline:** `d5098ab36241fb5d82043ae6b2beccdfa2da0161`. **Repository:** `fetronix/afyahub-hmis-kenya`. **Branch:** `arena/e088f11d-afyahub-hmis-kenya`.

**Evidence clock caveat:** Some retained document filenames and artifact timestamps carry November 2026 dates, later than this assessment date. They are identified by their actual paths and commit lineage, not treated as proof that a future-dated review occurred. No statutory effective date or production chronology is inferred from those labels.

This is the **single current working completion baseline** for the accessible repository. It reconciles and supersedes earlier completion _classifications_ at this revision, but does not erase their evidence or replace the existing Reporting Centre architecture. **It is not a signed Syrona contract, regulatory approval or production readiness certificate.** No feature, schema, permission or application data was changed. No production or successful database connection occurred. This assessment uses current source, selected fresh non-DB tests, retained historical evidence and GitHub job conclusions.

### What is still required before an honest completion declaration?

1. Recover and sign the actual original requirement/meeting/workbook baseline, included departments, reports, policies, roles and explicit contractual deferrals. Without originals, an exhaustive original client requirement count is **unknown**, not zero and not the size of this inventory.
2. Close owner-led historical data/credential exposure response, enforce required staff credential-change controls, complete usable approved MFA/recovery, and reaccept all scope/audit boundaries. No fresh real-world compromise is alleged.
3. Establish a green reproducible release: the current published candidate has failed CI coverage/database/bootstrap jobs; the local migration-integrity suite freshly reproduces an unguarded-DDL governance failure at 0095. Resolve safely without rewriting applied history or weakening assertions.
4. Enforce approved official clinical document release/issue rules and complete all included patient journeys under normal role logins, including clinical results, consent, dispensing, pending charges, discharge and immutable corrections.
5. Accept actual tariffs, units, chart/openings/periods, cost/recognition/bed policies, independent bank/refund/AP controls and full source→GL reconciliation. Finish missing financial/procurement budget→actual mappings, cash flow and included clinical consumption/specialty workflows.
6. Deliver the owner-approved report/statutory/template package from real persisted sources in the existing reporting system. Inspect actual saved outputs, not menus. Obtain independent per-provider contracts, implement missing operations, then obtain authorized sandbox/provider acceptance for required integrations.
7. Demonstrate approved staging deployment/upgrade/rollback, current-schema off-host restore with original document bytes, key custody, monitoring/alerts/load/device/printer usability, onboarding/training/support and same-revision signed multidisciplinary UAT.

**Current extracted units: 271 = 127 non-catalogue contracts/decisions + 144 individual catalogue outputs.** The register includes 52 secondary-attested client requirement units. Only 24 earlier Syrona clause groups can be reconstructed from secondary source S02; all 24 are cross-mapped, not authenticated originals. **Zero directly inspectable original signed client requirement documents were supplied.** Recommendations, unconfirmed assessment topics and optional scope are separately typed below. Do not report the inventory total as a confirmed original client requirement count.

| Status          | Units |
| --------------- | ----- |
| COMPLETE        | 2     |
| PARTIAL         | 86    |
| NOT IMPLEMENTED | 108   |
| DEFECTIVE       | 3     |
| BLOCKED         | 42    |
| UNVERIFIED      | 30    |

Only **AST-002** and **FIN-002** are COMPLETE, for narrow freshly verified calculation/safe-evaluation contracts. They do not certify the asset module, budget scenario, finances or facility. UNVERIFIED means source appears to exist but this assessment has insufficient acceptance evidence; it is not synonymous with missing. PARTIAL means a material named gap remains; BLOCKED identifies a decision/provider prerequisite and does not hide missing code. DEFECTIVE includes a failing configured gate or source-confirmed rule mismatch; runtime exploit/reproduction limits are explicit per row.

| Module                    | Units |
| ------------------------- | ----- |
| Accounting                | 7     |
| Billing and finance       | 11    |
| Clinical documents        | 5     |
| Core HMIS                 | 37    |
| Governance                | 3     |
| Integrations              | 11    |
| Optional enhancements     | 1     |
| Patient portal            | 3     |
| Planning and budgets      | 7     |
| Platform and production   | 10    |
| Procurement and inventory | 13    |
| Reporting                 | 8     |
| Reporting catalogue       | 144   |
| Security and access       | 8     |
| Workforce                 | 3     |

### Status by module

| Module                    | Total | COMPLETE | PARTIAL | NOT IMPLEMENTED | DEFECTIVE | BLOCKED | UNVERIFIED |
| ------------------------- | ----: | -------: | ------: | --------------: | --------: | ------: | ---------: |
| Accounting                |     7 |        0 |       4 |               1 |         0 |       1 |          1 |
| Billing and finance       |    11 |        0 |       6 |               0 |         0 |       0 |          5 |
| Clinical documents        |     5 |        0 |       4 |               0 |         1 |       0 |          0 |
| Core HMIS                 |    37 |        0 |      17 |               7 |         0 |       2 |         11 |
| Governance                |     3 |        0 |       0 |               0 |         0 |       3 |          0 |
| Integrations              |    11 |        0 |       2 |               0 |         0 |       9 |          0 |
| Optional enhancements     |     1 |        0 |       0 |               1 |         0 |       0 |          0 |
| Patient portal            |     3 |        0 |       2 |               0 |         0 |       0 |          1 |
| Planning and budgets      |     7 |        1 |       3 |               2 |         0 |       0 |          1 |
| Platform and production   |    10 |        0 |       3 |               0 |         1 |       3 |          3 |
| Procurement and inventory |    13 |        1 |       7 |               0 |         0 |       0 |          5 |
| Reporting                 |     8 |        0 |       5 |               0 |         0 |       2 |          1 |
| Reporting catalogue       |   144 |        0 |      28 |              97 |         0 |      19 |          0 |
| Security and access       |     8 |        0 |       4 |               0 |         1 |       2 |          1 |
| Workforce                 |     3 |        0 |       1 |               0 |         0 |       1 |          1 |

| Requirement provenance/type             | Units |
| --------------------------------------- | ----- |
| ASSESSMENT_SCOPE_UNCONFIRMED            | 29    |
| ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED | 144   |
| EXPLICIT_CLIENT_SECONDARY               | 52    |
| EXTERNAL_DEPENDENCY                     | 8     |
| IMPLIED_WORKFLOW                        | 31    |
| OPTIONAL_ENHANCEMENT                    | 1     |
| TECHNICAL_RECOMMENDATION                | 6     |

### Critical findings and practical next actions

- **SEC-001 BLOCKED:** prior incident reports document historical exposure, current repository metadata is public, and no signed containment/disposition was available. This task did not retrieve archives, historical environment contents, patient data or credentials. Closure needs authorized security/data-controller action, not an unapproved history rewrite.
- **OPS-001 DEFECTIVE:** source candidate CI is red and local migration gate fails. See precise fresh/CI evidence below; do not call the full system green based on focused tests.
- **SEC-002 DEFECTIVE:** mounted staff login returns a session/flag without server-side ordinary-API restriction for `mustChangePassword`. Accounts without the flag are not proof the required gate works.
- **DOC-004 DEFECTIVE:** ordinary lab report PDF permits unverified values with a warning; imaging checks timestamp **or** findings; discharge PDF checks text rather than final discharge state. These are source-confirmed eligibility gaps, not a claim of a production incident. Approved draft/final policy must be enforced.
- Critical transaction/isolation/restore rows remain PARTIAL/UNVERIFIED pending whole-chain evidence, approved configuration and full DB/CI acceptance; they are not automatically missing implementations.
- **Can start now without provider credentials:** reproduce/review failing gates; extend signed-policy negative tests; inventory every protected route/print path; verify existing workflows with disposable fixtures; prepare missing actual-source links and cash-flow/report mappings after finance decisions. No feature work was started here.
- **Client decisions:** D01–D10 and D16. **Provider/host inputs:** D11–D15, with statutory/terminology decisions also D07/D12. Credentials must be provisioned securely outside Git/chat; supplying credentials alone will not implement missing connectors.

## 2. Inspection, provenance and verification limits

### Git and data preservation

Initial local HEAD/index 0111b55 with 785 apparent status entries/no upstream. Fetched current branch; all 1,707 published blobs matched disk, no extras/residual files. Guarded metadata-only fast-forward to d5098ab and index synchronization; no worktree replacement/reset/switch/history rewrite. Clean baseline.

Fetched remote matched `d5098ab36241fb5d82043ae6b2beccdfa2da0161` before the initial assessment. The three explicitly named deliverables were the only changes. Initial publication committed the two Markdown assessments in `7631112`; the subsequent explicit user instruction to push all changes authorized publication of the JSON companion in `d0aee8d`. **All three deliverables are tracked on the current branch.** Push is not deployment.

**Repeated-request revalidation:** At published commit `d0aee8de123777ab6139e63f853cbdb573dc9646`, all 1,710 tracked files matched the checkout byte-for-byte, with no extra unignored files or staged changes. Stale local HEAD/index metadata was fast-forwarded only after this comparison and ancestry verification, without replacing worktree files, switching branches or rewriting history. Relative to assessed source `d5098ab`, only the three assessment deliverables differ. Requirement counts and statuses therefore remain unchanged. Document structure, totals, evidence paths, inventoried document hashes, catalogue/workflow mappings and roadmap coverage were revalidated. **Application tests were not reexecuted for this documentation-only revalidation:** the 313 passed / 1 failed / 13 skipped below are the retained initial-assessment results, not a new run. No new browser, DB, provider, CI, recovery or production acceptance is asserted.

No `.env`/deployment credentials were loaded or sought, historical sensitive archives opened, real patients inspected, live DB queried, migrations applied, data changed or permissions granted. Existing test runners received explicit synthetic/nonexistent loopback database settings (`127.0.0.1:9`); global setup's unavailable probe is not a production connection. No fresh DB/browser/provider/security/load/restore test is claimed. Ignored npm dependencies were installed only for existing focused tests. No application changes or new test code were needed.

### Source authority hierarchy

1. Original signed client notes/workbooks/decisions would outrank interpretations, but are absent.
2. S02/S03, supplied-scenario records S07–S10 and current user instructions provide **secondary or current task provenance**, not authenticated original contract approval.
3. Current mounted source/schema/migrations and existing tests establish implementation/coverage. UI/API/schema/business rules/permission layers are listed for every row; a path means inspected source, **not a running workflow**. Candidate report tables are actual schema entities but not proof of implemented joins or approved semantics.
4. Fresh tests verify only executed assertions; mocks are labeled. Historical synthetic/browser/download reports are retained and hash/source-reconciled, not silently promoted to fresh execution.
5. Internal engineering phases, compliance self-assessments and optional suggestions are not mandatory client clauses without approval.

| Source | Path/origin                                                        | Inspected scope and authority                                                                                                                                                          |
| ------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01    | Current user brief                                                 | Master System Completion Assessment: sections 1–12; audit topics are not proof of original contract scope; current instruction                                                         |
| S02    | docs/audits/SYRONA_REQUIREMENTS_GAP_ASSESSMENT_2026-11-13.md       | §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; secondary client requirements                                                                   |
| S03    | docs/audits/SYRONA_MASTER_SYSTEM_COMPLETION_AUDIT_2026-11-13.md  | §4 SY01–SY18; module matrices and §11 recommendations; secondary client requirements and engineering assessment                                                                        |
| S04    | docs/audits/REPORTING_PROGRAMME_CURRENT_MATRIX.json                | 144 current catalogue entries, compared with source catalogue and engine definitions; engineering inventory; client inclusion not signed                                               |
| S05    | docs/audits/REPORTING_PROGRAMME_BATCH_1_ACCEPTANCE.md              | Bounded recorded register, limitations and actual native download evidence; historical synthetic acceptance                                                                            |
| S06    | docs/audits/CLINICAL_DOCUMENTS_FINAL_ACCEPTANCE.md                 | Signed files/portal/procedure consent/letterhead acceptance and remaining gaps; historical synthetic acceptance                                                                        |
| S07    | docs/audits/SYRONA_2026_SOURCE_RECONCILIATION.md                   | Official CSV identity, categories, arithmetic and unresolved source values; strict mode at that revision; historical direct-source inspection; originals absent now                    |
| S08    | docs/audits/SYRONA_ZERO_FILL_CRUD_IMPLEMENTATION.md                | Subsequent explicit ZERO_FILL direction, 241 source rows, separate source-row identity and nonproduction acceptance; secondary instruction and historical synthetic acceptance         |
| S09    | docs/audits/ANNUAL_FINANCIAL_BUDGET.md                             | 75-line 13-department scenario, safe formulas, January profit, optional fees and actual separation; secondary supplied scenario and historical synthetic acceptance                    |
| S10    | docs/audits/PARTNER_EQUITY_FINAL_ACCEPTANCE.md                     | 84-cell screenshot fixture; provisional formulas, no residual; live identity blocked; secondary supplied screenshot and historical synthetic acceptance                                |
| S11    | docs/audits/SYRONA_BANK_PAYMENTS_IMPLEMENTATION_2026-10-27.md    | Manual declaration, independent verification/settlement; provider limitations; historical synthetic acceptance                                                                         |
| S12    | docs/audits/SYRONA_PAYROLL_CONFIGURATION_READINESS_2026-10-27.md | Effective-dated statutory versions, configured chart, test-only readiness; historical synthetic acceptance and external policy dependencies                                            |
| S13    | docs/project/completion-phases/MASTER-COMPLETION-REGISTER.md       | Internal engineering phases; not the client three-phase contract; superseded engineering register                                                                                      |
| S14    | docs/audits/SYRONA_PHASE_1A_SECURITY_INVESTIGATION.md            | Historical exposure and findings; current fixes must be reconciled, not assumed absent; historical security investigation                                                              |
| S15    | docs/security/DATA-EXPOSURE.md                                     | Owner-led incident response remains required; do not retrieve sensitive historical objects; historical security governance                                                             |
| S16    | docs/audits/SYRONA_PRODUCTION_DEPLOYMENT_GATE.md                   | HOLD, target/permission/backup/currency/letterhead and migration approval gates; production governance, not evidence of deployment                                                     |
| S17    | docs/integrations/mpesa-phase-1-readiness-2026-11-06.md            | Mocked Daraja requests; callback settlement unavailable, manual/posted accounting separate; historical synthetic acceptance                                                            |
| S18    | docs/integrations/PRIVATE-INSURANCE-BRITAM-PACIS.md                | Separate payer contracts/manual workflows and onboarding; integration boundary                                                                                                         |
| S19    | docs/project/operations/BACKUP-RESTORE-RUNBOOK.md                  | Encrypted backup tools; old 230-table drill is not current schema/host restoration proof; engineering and operational recommendation                                                   |
| S20    | docs/audits/STATIONERY_CSV_MAPPING_INSPECTION.md                   | Exact-file mapping hash and 232 rows; no implicit preview/import or source-value approval; historical direct-source inspection                                                         |
| S21    | docs/audits/PLANNING_WORKSPACE_RESET.md                            | Explicit draft-only scoped reset; import bytes/audit/actuals retained; secondary user direction and historical acceptance                                                              |
| S22    | docs/branding/facility-letterheads.md                              | Existing versioned upload/layout/explicit activation/history; no separate stamp authority; implementation specification                                                                |
| S23    | reportfidelis.md                                                   | Earlier cross-module achievements/gaps; superseded where later source differs; engineering report                                                                                      |
| S24    | docs/dha-audit/DHA_REQUIREMENT_TRACEABILITY.md                     | Technical/regulatory self-assessment; not regulator approval or proven client scope; technical recommendation                                                                          |
| S25    | docs/audits/SYRONA_COMPLETE_SYSTEM_AUDIT.md                      | §C.1 emergency/custody/safety crosswalk and §G platform/professional verification; older leads checked against current source; engineering scope leads, not signed client requirements |
| S26    | docs/project/completion-phases/PHASE-1-4-OUTSTANDING-REGISTER.md   | Remaining clinical eMAR, code provenance and legacy missing-value risks; old findings may now be fixed; engineering outstanding register, not current acceptance                       |
| S27    | docs/dha-audit/SECURITY_PRIVACY_GAP_REGISTER.md                    | ODPC/DPIA/retention and subject-access organizational evidence; historical assessment not legal determination; technical/organizational recommendation                                 |

The JSON companion indexes all 131 pre-existing non-evidence project Markdown documents with hashes/titles, and all 23 repository XLSX files with provenance classification. It is a document inventory plus targeted source assessment, not a claim of independently validating every old prose statement. Search found no original `.xls`, original `.xlsx`, meeting `.docx` or signed Syrona specification in the accessible tree; no connected document store/attachments were provided. Historical references to available upload locations are not evidence those external files are present now.

### Supplied workbook/business source reconciliation

- **Stationery/branding:** S07 records official CSV hashes (retained in that historical report),296×32/36×29 shapes and232 stationery +5 monthly branding +4 uniforms. Original Excel formulas/print areas are unknown. S08's later explicit ZERO_FILL instruction supersedes the old “cannot import blanks” software limitation: missing inputs may be normalized with recorded policy/provenance, not declared verified source zeros. Source-row duplicates are supported after0096. Missing prices/unit, currency and original cost discrepancies still need owner treatment; see D02/D08. No official CSV originals are currently available to rerun exact-source checks.
- **Annual financial budget:** S09 and current model preserve75 lines/13 departments/twelve months. January inputs yield a profit, not a requested-looking loss; no invented expense. Optional professional-fees treatment, unusual divisors/formulas and zero statutory projection inputs need finance review. This is not a procurement plan or posted actual.
- **Equity:** S10 and an84-cell independent fixture retain source screenshot identity, nulls,14 rows, original period and provisional full-precision calculations. Do not copy partner identities into new reports unnecessarily, invent admission dates or allocate a residual cent. Original Excel formulas and live facility identity remain unverified.
- **Letterhead:** S16 records an uploaded original PDF fingerprint historically; possession/old report is not authority to activate it. Current renderer accepts scoped approved versions; D09/D16 remain.
- **Other XLSX files:** the 23 found under evidence are saved synthetic generated reports, including financial/clinical/stock/equity outputs. None authenticates an absent original client workbook. Tariff intake CSV/discovery inventories are implementation aids, not the original client requirements.

### Fresh checks — not a whole-system pass

| Run | Result                                          | What it proves                                                                                                        |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| F01 | 221 passed /13 skipped /0 failed across16 files | Pure arithmetic/parser/crypto/export/policy and mocked adapter tests;13 tests require absent official sources.        |
| F02 | 92 passed /1 failed /0 skipped across12 files   | 11 mocked-DOM workflow suites plus migration source-integrity checks; configured gate failure is retained, not fixed. |

**Combined:313 passed,1 failed,13 skipped across28 files.** Reproduction: `npm ci`, explicitly configure only synthetic loopback/nonexistent database variables (as in §2), then `npx vitest run --maxWorkers=2` with each F01/F02 file list below. F02 is expected to retain its failed gate until separately authorized remediation. Do not point the suite at a real database or use invented files for `SYRONA_SOURCE_DIR`. This is not complete coverage or real persisted end-to-end evidence. F01 source-dependent skips: stationery mapping11, zero-fill official source1, strict official reconciliation1. An unmatched nonexistent test filter supplied in F01 did not select a file; only the16 listed/executed suites are counted. No hidden portal-policy suite is claimed.

**F01 executed file inventory:**

| File                                                | Collected | Exception  |
| --------------------------------------------------- | --------- | ---------- |
| src/tests/vitest/field-crypto.spec.ts               | 39        | none       |
| src/tests/vitest/authorization-middleware.spec.ts   | 39        | none       |
| src/tests/consent-allergy.spec.ts                   | 1         | none       |
| src/tests/workforce-payroll-calculator.spec.ts      | 21        | none       |
| src/tests/financial-budget.spec.ts                  | 19        | none       |
| src/tests/partner-equity.spec.ts                    | 27        | none       |
| src/tests/vitest/bank-sandbox-auth.spec.ts          | 13        | none       |
| src/tests/vitest/backup-lib.spec.ts                 | 16        | none       |
| src/tests/stationery-mapping.spec.ts                | 13        | 11 skipped |
| src/tests/syrona-zero-fill.spec.ts                  | 10        | 1 skipped  |
| src/tests/fixed-asset-depreciation.spec.ts          | 15        | none       |
| src/tests/syrona-reconciliation.spec.ts             | 5         | 1 skipped  |
| src/tests/inpatient-bed-night-policy.spec.ts        | 5         | none       |
| src/tests/vitest/reporting-programme-matrix.spec.ts | 4         | none       |
| src/tests/vitest/report-catalogue-integrity.spec.ts | 5         | none       |
| src/tests/vitest/report-centre-export.spec.ts       | 2         | none       |

**F02 executed file inventory:**

| File                                                   | Collected | Exception |
| ------------------------------------------------------ | --------- | --------- |
| src/tests/vitest/report-centre-ui.spec.tsx             | 16        | none      |
| src/tests/vitest/outpatient-safety-ui.spec.tsx         | 19        | none      |
| src/tests/vitest/bank-payments-ui.spec.tsx             | 8         | none      |
| src/tests/migrations.spec.ts                           | 7         | 1 failed  |
| src/tests/vitest/procurement-matching-returns.spec.tsx | 7         | none      |
| src/tests/vitest/appointment-facility-ui.spec.tsx      | 3         | none      |
| src/tests/vitest/billing-cashier-ui.spec.tsx           | 4         | none      |
| src/tests/vitest/laboratory-safety-ui.spec.tsx         | 5         | none      |
| src/tests/vitest/financial-budget-ui.spec.tsx          | 14        | none      |
| src/tests/vitest/partner-equity-acceptance.spec.tsx    | 4         | none      |
| src/tests/vitest/clinical-document-report-ui.spec.tsx  | 5         | none      |
| src/tests/vitest/phase1-portal-ui.spec.tsx             | 1         | none      |

Fresh failing assertion: `src/tests/migrations.spec.ts → Migration file integrity tests → Guarded Ddl`, at line200: `0095_budget_procurement_planning.sql` has eight unguarded planning table creates. Six other migration assertions pass. This is a repository migration governance conflict, **not proof production lacks tables, migration execution failed, or all CI failures share this cause**. Do not edit an applied historical migration or fake a migration ledger row to satisfy a regex. Review proper forward recovery/governance with owners; test and guards were not weakened here.

**GitHub baseline CI:** [run 43678187584](https://github.com/fetronix/afyahub-hmis-kenya/actions/runs/43678187584), head `d5098ab`: Production build, Typecheck/lint, Formatting and Dependency audit succeeded; Coverage with PostgreSQL 16, Migrations/database specs and Fresh-checkout Docker bootstrap failed. Conclusions/failed step names were retrieved; detailed logs could not be downloaded because the redirected Actions log host returned a network EOF. Record unknown causes rather than infer them. No claim of newly passed typecheck/build/full suite from this documentation task.

**Historical reconciliation:** H01's31 source fingerprints were recomputed:30 match; only `src/reporting/report-catalogue.ts` differs, explained by Batch1. H02 is the exact baseline Batch1 evidence. H03/H04 source/fixtures and selected fresh tests were inspected, with original formula/live identity/demo limitations preserved. Relevant counts remain historical139/61/180/1012 (clinical),79/34/32/101 (Batch1),59 browser pass+1 blocked/11DB/68 focused/15export (equity). Do not add them into fresh totals. No successful current provider connection, host restore, complete independent security assessment or production sign-off is evidenced.

## 3. Reconciliation of previous completion claims

| Older claim/lead                                          | Current source finding                                                                                                                   | Completion consequence                                                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Receipt/LPO/GRN/clinical PDFs or letterhead absent        | Owning-module builders, common versioned letterhead and report exports exist.                                                            | Credit implementation; catalogue picker absence is separate from renderer absence. Clinical final-release/audit/issue policy still incomplete. |
| Patient file custody/portal document release absent       | Signed originals, immutable versions, explicit per-version release/withdrawal, content validation and own-session access exist.          | DOC-001/002 are partial acceptance/policy work, not a new storage rebuild.                                                                     |
| Supplier AP and supplier payment missing                  | Receiving/matching/return/AP/pay services and journals exist.                                                                            | PRC-005 needs complete acceptance, not duplicate payables architecture.                                                                        |
| Bank reconciliation has no UI                             | BankPaymentsWorkspace includes statement/matching/reconciliation; manual declaration→verify→settle is separate from bank API.            | Reaccept actual staff workflow; do not claim bank API connection.                                                                              |
| Annual budget not implemented                             | Separate annual financial scenario/model/service exists; procurement planning/source-row imports exist too.                              | Actual attribution/variance still missing in both planning dimensions.                                                                         |
| Portal lockout/overview leaks listed in old investigation | Current account locks/security-version rechecks and overview order+result patient/facility filters address those specific old findings.  | Do not reassert old exploit as current; fresh all-path race/release acceptance still required.                                                 |
| 151 catalogue entries/120 or117 unavailable               | Current source has144,28partial,116no integrated engine/workflow.                                                                        | Preserve per-entry mapping below; no false all-report completion.                                                                              |
| Everything green/production ready                         | Current CI failed three jobs; local0095 gate fails; no owner/host/provider acceptance.                                                   | Release remains held for objective evidence, not cosmetic counts.                                                                              |
| Inventory movement ledger proves historical balances      | Producer services append movements but no immutable DB trigger/completeness/opening proof found; register net is filtered per-item only. | Historical stock/valuation needs separate evidence/policy.                                                                                     |

## 4. Original-secondary clause crosswalk

S02 clauses1–24 are the only complete accessible earlier Syrona list, explicitly secondary. Additional documented workbook/report/equity directions are distinct sources, not silently omitted or folded into invented originals.

| S02 clause | Secondary requirement title                             | Current requirement IDs                     |
| ---------- | ------------------------------------------------------- | ------------------------------------------- |
| 1          | Unified online HMIS and facility administration         | SEC-004, SEC-006, OPS-008                   |
| 2          | Reception and patient registration                      | PAT-001, REC-001                            |
| 3          | Unique patient identification and duplicate detection   | PAT-001, PAT-004                            |
| 4          | OPD and clinical records                                | OPD-001                                     |
| 5          | Medical history, diagnoses, prescriptions and allergies | PAT-002, OPD-002, OPD-003                   |
| 6          | Signed forms, consent documents and radiology requests  | DOC-001, DOC-002, RAD-001, RAD-002, BRD-002 |
| 7          | Laboratory workflows and reports                        | LAB-001, LAB-002, LAB-003, DOC-004          |
| 8          | Pharmacy inventory, dispensing and usage                | PHA-001, PHA-002, BIL-007, INV-003, INV-005 |
| 9          | Radiology workflows                                     | RAD-001, RAD-003                            |
| 10         | Inpatient admissions, bed management and billing        | IPD-001, IPD-002, IPD-003                   |
| 11         | Invoices, receipts and local billing                    | BIL-001, BIL-002, BIL-003, BIL-004, BIL-005 |
| 12         | Financial reporting and revenue tracking                | BIL-006, ACC-002, ACC-003, ACC-004, RPT-005 |
| 13         | Procurement, LPOs and GRNs                              | PRC-001, PRC-003, PRC-004, PRC-005          |
| 14         | Inventory and supply contracts                          | PRC-002, INV-001, INV-002, INV-004          |
| 15         | Fixed assets and depreciation                           | AST-001, AST-002                            |
| 16         | Role-based access control                               | SEC-004, SEC-006                            |
| 17         | Backups and security documentation                      | SEC-001, SEC-005, SEC-007, OPS-003          |
| 18         | Insurance eligibility, benefit verification and claims  | INS-001, INS-003, INS-004                   |
| 19         | Britam integration                                      | INS-002                                     |
| 20         | NCBA and Equity integration                             | INT-002, INT-003                            |
| 21         | Safaricom integration status                            | INT-001                                     |
| 22         | Hosting and deployment arrangements                     | OPS-004, OPS-005, OPS-006                   |
| 23         | Tax requirements and outstanding consultant decisions   | ACC-005, HR-003                             |
| 24         | Three-phase implementation and confirmed Phase 1 scope  | GOV-001, GOV-003                            |

### Earlier master-roadmap items retained, not silently discarded

The S03 older P0/P1/P2/P3 IDs map below. Their old priority/“complete” language is not adopted as client scope; current source/status/acceptance governs. In particular eMAR, imaging access, emergency/ambulance/mortuary/transfusion/quality and organizational privacy leads remain explicit unconfirmed or technical requirements (IPD-004, RAD-004, SPC-003–SPC-007, SEC-008), rather than disappearing from the assessment. Current scoped diagnosis reads now check encounter/diagnosis patient equality; that older leak lead is **fixed in source**, while coding-system/release preservation still needs OPD-005 acceptance.

| Earlier S03 ID | Current requirement IDs            |
| -------------- | ---------------------------------- |
| P0-01          | SEC-001, SEC-008                   |
| P0-02          | OPS-001, OPS-002, OPS-003          |
| P0-03          | DOC-003, DOC-004, DOC-005          |
| P0-04          | BIL-002, IPD-003, ACC-002          |
| P0-05          | OPS-003, OPS-004                   |
| P1-01          | GOV-001, GOV-002, GOV-003          |
| P1-02          | DOC-001, DOC-002, RAD-002          |
| P1-03          | DOC-005, BRD-001, BRD-002, PRC-003 |
| P1-04          | BIL-006, ACC-003, ACC-004, RPT-005 |
| P1-05          | FIN-001, FIN-003, PLN-004          |
| P1-06          | BNK-001, BNK-002                   |
| P1-07          | INV-002, INV-005, SPC-001          |
| P1-08          | SEC-002, SEC-003, SEC-006          |
| P1-09          | INS-001, INS-002                   |
| P1-10          | INT-001, INT-004                   |
| P2-01          | THR-001, THR-002                   |
| P2-02          | IPD-004, PHA-002                   |
| P2-03          | RAD-004                            |
| P2-04          | LAB-003, MCH-002, DIA-002          |
| P2-05          | STA-001, STA-002                   |
| P2-06          | AST-001, AST-002                   |
| P2-07          | OPS-003, OPS-005, OPS-006          |
| P2-08          | INT-002, INT-003, INS-003, INS-004 |
| P2-09          | HR-001, HR-002, HR-003             |
| P3-01          | OPT-001                            |
| P3-02          | GOV-003, SPC-001, SPC-002, RPT-001 |
| P3-03          | OPT-001                            |

## 5. Individual non-catalogue requirements

Every entry has the required provenance, priority/status, current-layer evidence, precise gap/task, blockers, measurable criteria, method and owner-verification boundary. Paths are relative to the repository. DependenciesD01–D16 are defined in §8; requirement-ID dependencies point to rows here.

### GOV-001 — Original client baseline

- **Module / requirement:** Governance — Recover and approve the original Syrona requirements, meeting decisions and contractual phase scope.
- **Provenance:** EXTERNAL_DEPENDENCY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** Critical / **BLOCKED**. **Roadmap phase:** 1.
- **Current implementation:** S02/S03 reconstruct earlier briefs; original signed notes and client phase plan are absent from current tracked tree.
- **Inspected layer paths:** UI: `README.md`; API: `src/routes/index.ts`; businessRules: `docs/audits/SYRONA_PRODUCTION_DEPLOYMENT_GATE.md`; persistence: `drizzle/meta/_journal.json`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/migrations.spec.ts`.
- **Missing functionality / defect:** Cannot establish the exhaustive original client requirement total or signed launch exclusions.
- **Required task:** Client supplies originals; version and hash them privately and map each clause to this register.
- **Dependencies / blockers:** D01.
- **Measurable acceptance:** Each original clause has a unique ID and provenance; client signs inclusion/exclusion and phase mapping.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client sponsor and clinical/finance leads.

### GOV-002 — Original templates

- **Module / requirement:** Governance — Recover all supplied workbook/CSV/layout originals and approve their authoritative versions.
- **Provenance:** EXTERNAL_DEPENDENCY; S07: Official CSV identity, categories, arithmetic and unresolved source values; strict mode at that revision; S08: Subsequent explicit ZERO_FILL direction, 241 source rows, separate source-row identity and nonproduction acceptance; S09: 75-line 13-department scenario, safe formulas, January profit, optional fees and actual separation; S10: 84-cell screenshot fixture; provisional formulas, no residual; live identity blocked; S20: Exact-file mapping hash and 232 rows; no implicit preview/import or source-value approval
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 1.
- **Current implementation:** S07/S20 record CSV hashes; S09 is a transcribed scenario; S10 has a screenshot fixture. Current XLSX files are synthetic exports, not client templates.
- **Inspected layer paths:** UI: `src/components/modules/planning/PlanningWorkspace.tsx`; API: `src/budget-planning/planning.routes.ts`; businessRules: `src/budget-planning/planning.service.ts`; persistence: `src/db/schema/planning.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/budget-planning.db.spec.ts`.
- **Missing functionality / defect:** Original XLS/workbooks and official CSV bytes unavailable; source-specific checks skip.
- **Required task:** Obtain originals via approved secure channel; inventory sheets/formulas/print areas and independent expected results.
- **Dependencies / blockers:** D02.
- **Measurable acceptance:** All originals have hashes and version ownership; source-dependent tests run without replacement synthetic files.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client finance/procurement owners.

### GOV-003 — Scope decisions

- **Module / requirement:** Governance — Approve launch departments, minimum report package, roles and signatories without silently dropping unresolved requirements.
- **Provenance:** EXTERNAL_DEPENDENCY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 1.
- **Current implementation:** Internal phase documents exist but are not evidence of the client three-phase agreement.
- **Inspected layer paths:** UI: `README.md`; API: `src/routes/index.ts`; businessRules: `docs/audits/SYRONA_PRODUCTION_DEPLOYMENT_GATE.md`; persistence: `drizzle/meta/_journal.json`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/migrations.spec.ts`.
- **Missing functionality / defect:** Launch shortlist, included theatre/dental/dialysis and sign-off roles are not supplied.
- **Required task:** Record signed scope and explicit deferred requirements; retain each unresolved entry.
- **Dependencies / blockers:** D01, D03.
- **Measurable acceptance:** All rows have approved owner and launch/deferred decision; no unavailable screen counted complete.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client sponsor.

### SEC-001 — Exposure response

- **Module / requirement:** Security and access — Close the historical repository data/credential exposure through authorized incident governance.
- **Provenance:** TECHNICAL_RECOMMENDATION; S14: Historical exposure and findings; current fixes must be reconciled, not assumed absent; S15: Owner-led incident response remains required; do not retrieve sensitive historical objects
- **Priority / status:** Critical / **BLOCKED**. **Roadmap phase:** 1.
- **Current implementation:** S14/S15 document historical archives/environment exposure; repository metadata currently reports public. No sensitive historical objects were opened in this assessment.
- **Inspected layer paths:** UI: `src/components/LoginScreen.tsx`; API: `src/auth/auth.routes.ts`; businessRules: `src/auth/auth.service.ts`; persistence: `src/db/schema/auth.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/authorization-middleware.spec.ts`.
- **Missing functionality / defect:** No owner-signed containment, credential/session disposition or privacy/legal closure available; current compromise is not established.
- **Required task:** Privately appoint incident owner; preserve restricted evidence, rotate/revoke as appropriate and document containment/disposition under separate authority.
- **Dependencies / blockers:** D04.
- **Measurable acceptance:** Security/data controller approves evidence-based closure; affected access and recovery controls verified without exposing values.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Security owner and data controller.

### SEC-002 — Staff authentication

- **Module / requirement:** Security and access — Enforce required staff password change before ordinary protected API access.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations; S14: Historical exposure and findings; current fixes must be reconciled, not assumed absent
- **Priority / status:** High / **DEFECTIVE**. **Roadmap phase:** 1.
- **Current implementation:** auth.service.ts returns requiresPasswordChange and still creates a session; auth.middleware.ts attaches mustChangePassword without a restricted-route gate.
- **Inspected layer paths:** UI: `src/components/LoginScreen.tsx`; API: `src/auth/auth.routes.ts`; businessRules: `src/auth/auth.service.ts`; persistence: `src/db/schema/auth.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/authorization-middleware.spec.ts`.
- **Missing functionality / defect:** Source-confirmed missing gate for accounts carrying the flag; no runtime exploit attempted.
- **Required task:** Define recovery/change workflow and enforce a server-side restricted session until password rotation.
- **Dependencies / blockers:** D05.
- **Measurable acceptance:** Flagged account cannot read clinical/financial APIs; successful rotation invalidates old sessions and unlocks only authorized access.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Security owner.

### SEC-003 — MFA and recovery

- **Module / requirement:** Security and access — Provide an operable owner-approved MFA and account recovery lifecycle where required.
- **Provenance:** TECHNICAL_RECOMMENDATION; S03: §4 SY01–SY18; module matrices and §11 recommendations; S14: Historical exposure and findings; current fixes must be reconciled, not assumed absent
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 1.
- **Current implementation:** Mounted auth controller uses auth.service.ts, which refuses a full session for MFA and comments that a proper challenge flow is still needed. The separate login.service.ts is not the mounted login proof.
- **Inspected layer paths:** UI: `src/components/LoginScreen.tsx`; API: `src/auth/auth.routes.ts`; businessRules: `src/auth/auth.service.ts`; persistence: `src/db/schema/auth.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/authorization-middleware.spec.ts`.
- **Missing functionality / defect:** Challenge/verification/recovery endpoint flow not established; enabling MFA can prevent login rather than provide usable MFA.
- **Required task:** Implement approved enrollment/challenge/recovery and atomic revocation; verify mounted path rather than dormant service.
- **Dependencies / blockers:** D05.
- **Measurable acceptance:** Required MFA yields no full session until valid challenge; replay, expiry, recovery and lockout negative tests pass.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Security owner.

### SEC-004 — Tenant and facility isolation

- **Module / requirement:** Security and access — Enforce tenant/facility scope and module policy across all operational routes and exports.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** Critical / **UNVERIFIED**. **Roadmap phase:** 1.
- **Current implementation:** Central scope, module gates and domain RBAC exist; selected HTTP/DB isolation suites and reporting guards cover bounded resources.
- **Inspected layer paths:** UI: `src/components/modules/ConfigurationModule.tsx`; API: `src/routes/platform/facilities.routes.ts`; businessRules: `src/auth/scope.service.ts`; persistence: `src/db/schema/tenancy.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/tenancy-billing-rbac-http.spec.ts`.
- **Missing functionality / defect:** No fresh exhaustive route/resource/legacy-path sweep or facility role acceptance; selected passing paths do not prove all tenancy.
- **Required task:** Inventory mounted routes and test each tenant/facility/disabled-module/foreign-ID boundary against signed access matrix.
- **Dependencies / blockers:** D03, SEC-006.
- **Measurable acceptance:** Every in-scope API and export has a negative ownership case; platform metadata authority never grants clinical/money access.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/authorization-middleware.spec.ts`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Security and facility administrators.

### SEC-005 — Identifier encryption

- **Module / requirement:** Security and access — Deploy and verify approved identifier/storage encryption and key custody.
- **Provenance:** TECHNICAL_RECOMMENDATION; S14: Historical exposure and findings; current fixes must be reconciled, not assumed absent; S15: Owner-led incident response remains required; do not retrieve sensitive historical objects
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 1.
- **Current implementation:** src/security/field-crypto.ts uses authenticated encryption but intentionally passes plaintext through when no key exists; fresh tests verify this behavior.
- **Inspected layer paths:** UI: `src/components/LoginScreen.tsx`; API: `src/auth/auth.routes.ts`; businessRules: `src/auth/auth.service.ts`; persistence: `src/db/schema/auth.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/authorization-middleware.spec.ts`.
- **Additional current source:** `src/security/field-crypto.ts`.
- **Missing functionality / defect:** Deployed key coverage, historical data treatment, document/backup encryption and rotation not observed.
- **Required task:** Agree mandatory startup policy and legacy migration/rotation procedure; verify keys through secure operations, not chat.
- **Dependencies / blockers:** D04, D15.
- **Measurable acceptance:** Required keys fail closed if absent; scoped historical encryption treatment and recovery drill signed off.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/field-crypto.spec.ts`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Security and operations.

### SEC-006 — RBAC and segregation

- **Module / requirement:** Security and access — Approve and enforce staff/department roles, grants and independent approvals.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 1.
- **Current implementation:** Protected staff-role policy, scope and independent approvals exist; report and bank permissions are checked server-side.
- **Inspected layer paths:** UI: `src/components/modules/ConfigurationModule.tsx`; API: `src/routes/platform/facilities.routes.ts`; businessRules: `src/auth/scope.service.ts`; persistence: `src/db/schema/tenancy.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/tenancy-billing-rbac-http.spec.ts`.
- **Missing functionality / defect:** Actual staff matrix and department row policy not signed; feature permission is not automatically departmental segregation.
- **Required task:** Map named roles to capabilities and row scopes; verify direct APIs, independent approvers and revoked sessions.
- **Dependencies / blockers:** D03, D05.
- **Measurable acceptance:** Wrong/self-approver and unauthorized department/tenant denied; approved role can complete work without blanket grants.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/authorization-middleware.spec.ts`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Facility administrator and department leads.

### SEC-007 — Audit completeness

- **Module / requirement:** Security and access — Make sensitive access/mutations durably auditable and fail closed where mandatory.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations; S14: Historical exposure and findings; current fixes must be reconciled, not assumed absent
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 1.
- **Current implementation:** Signed-document and reporting reads include persisted audit; document.routes.ts sendDocument renders and returns without a central document-issue/access audit call.
- **Inspected layer paths:** UI: `src/components/LoginScreen.tsx`; API: `src/auth/auth.routes.ts`; businessRules: `src/auth/auth.service.ts`; persistence: `src/db/schema/auth.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/authorization-middleware.spec.ts`.
- **Missing functionality / defect:** Generated clinical/financial print audit coverage and raw error sanitization remain uneven; no global all-path audit proof.
- **Required task:** Review generated-document and legacy paths; enforce mandatory audit and sanitized errors consistently.
- **Dependencies / blockers:** D04, D05.
- **Measurable acceptance:** Injected audit failure returns no protected output where required; logs/exports omit secrets and patient payloads; immutable events retain actor/scope.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Security and records owner.

### PAT-001 — Registration and MRN

- **Module / requirement:** Core HMIS — Register/edit a scoped patient with server-allocated unique identity and validated demographics.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 2.
- **Current implementation:** Scoped create/query and sequence-backed MRN allocation plus DB uniqueness/tests exist; audited paginated directory exists.
- **Inspected layer paths:** UI: `src/components/modules/PatientRegistrationModule.tsx`; API: `src/routes/domains/patients.routes.ts`; businessRules: `src/db/queries/patients.ts`; persistence: `src/db/schema/patients.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/patient-mrn-allocation.db.spec.ts`.
- **Missing functionality / defect:** Fresh registration→queue DB/browser acceptance and client required-field/dedup policy not established here.
- **Required task:** Run concurrent identity creation and demographic correction UAT using synthetic records and approved identity rules.
- **Dependencies / blockers:** D03.
- **Measurable acceptance:** Concurrent creates produce distinct MRNs; invalid/foreign edits refused; correction preserves linked clinical and financial records.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### PAT-002 — Longitudinal history

- **Module / requirement:** Core HMIS — Provide usable longitudinal clinical history and structured problems/history where required.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** Encounters, vitals, diagnoses, allergy/consent and journey fan-out exist; encounter historyOfPresentIllness is not a longitudinal problem list.
- **Inspected layer paths:** UI: `src/components/modules/OutpatientModule.tsx`; API: `src/routes/domains/encounters.routes.ts`; businessRules: `src/db/queries/encounters.ts`; persistence: `src/db/schema/clinical.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/outpatient-safety-ui.spec.tsx`.
- **Missing functionality / defect:** Complete medical/surgical/family/social history/problem-list model and signed content scope not established.
- **Required task:** Confirm structured-history requirement; integrate agreed persisted history and cross-visit context with provenance.
- **Dependencies / blockers:** D03, D05.
- **Measurable acceptance:** Agreed history fields persist and appear on later visits; sensitive notes stay out of patient/payer release unless authorized.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### PAT-003 — Patient directory usability

- **Module / requirement:** Core HMIS — Keep patient selection scoped and usable beyond the first directory page.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations; S14: Historical exposure and findings; current fixes must be reconciled, not assumed absent
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** New paginated audited directory/appointment picker exists; legacy getPatients in queries/patients.ts still has limit(50), used by SpecialtyModule.
- **Inspected layer paths:** UI: `src/components/modules/PatientRegistrationModule.tsx`; API: `src/routes/domains/patients.routes.ts`; businessRules: `src/db/queries/patients.ts`; persistence: `src/db/schema/patients.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/patient-mrn-allocation.db.spec.ts`.
- **Missing functionality / defect:** Not all selectors are proven to support large directories; source cap persists on legacy clients.
- **Required task:** Audit remaining consumers and verify page/search/selection identity under facility changes.
- **Dependencies / blockers:** D03.
- **Measurable acceptance:** A patient after row 50 can be selected in every required workflow; delayed results cannot populate another patient/facility.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### REC-001 — Reception and appointments

- **Module / requirement:** Core HMIS — Book/reschedule/cancel appointments and route patients from reception to the right care queue.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 2.
- **Current implementation:** Persisted appointments/queues, facility-scoped routes and fresh mock-DOM facility-change tests exist.
- **Inspected layer paths:** UI: `src/components/modules/ReceptionQueueModule.tsx`; API: `src/routes/appointments.routes.ts`; businessRules: `src/db/queries/queues.ts`; persistence: `src/db/schema/clinical.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/appointment-facility-ui.spec.tsx`.
- **Missing functionality / defect:** No fresh real DB/browser reception handoff and owner-specific scheduling policy acceptance.
- **Required task:** Run reception→encounter UAT including concurrent slot/queue changes and cancellations.
- **Dependencies / blockers:** D03.
- **Measurable acceptance:** Correct patient/facility appears once in receiving worklist; conflicts/cancelled appointments cannot create duplicate visits.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/appointment-facility-ui.spec.tsx`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### REC-002 — Website booking

- **Module / requirement:** Core HMIS — Integrate approved external booking channels with internal appointments.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S23: Earlier cross-module achievements/gaps; superseded where later source differs
- **Priority / status:** Medium / **BLOCKED**. **Roadmap phase:** 6.
- **Current implementation:** src/booking/website-booking.service.ts has clients, slots, idempotent booking, confirmation and reminders.
- **Inspected layer paths:** UI: `src/components/modules/ReceptionQueueModule.tsx`; API: `src/routes/appointments.routes.ts`; businessRules: `src/db/queries/queues.ts`; persistence: `src/db/schema/clinical.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/appointment-facility-ui.spec.tsx`.
- **Missing functionality / defect:** No verified client WordPress/website installation, owner routing or real delivery.
- **Required task:** Confirm channel scope; provision authorized client credentials and test approved staging site to appointment handoff.
- **Dependencies / blockers:** D14, D03.
- **Measurable acceptance:** Authorized site creates one scoped appointment; retry/cancel and invalid signature/key cases pass; no unnecessary patient details exposed.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### OPD-001 — Consultation

- **Module / requirement:** Core HMIS — Record triage, encounter, notes, observations and diagnoses linked to the selected patient/facility.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 2.
- **Current implementation:** Persisted encounters and diagnoses routes, service identity and fresh stale-patient/ordering DOM checks exist.
- **Inspected layer paths:** UI: `src/components/modules/OutpatientModule.tsx`; API: `src/routes/domains/encounters.routes.ts`; businessRules: `src/db/queries/encounters.ts`; persistence: `src/db/schema/clinical.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/outpatient-safety-ui.spec.tsx`.
- **Missing functionality / defect:** No fresh whole clinical journey DB execution or clinician sign-off; structured note requirements unresolved.
- **Required task:** Exercise nurse/clinician handoff through completion and correction with approved templates.
- **Dependencies / blockers:** D03, SEC-006.
- **Measurable acceptance:** Wrong patient/encounter link denied; notes persist across login; chronology and allowed amendments match approved policy.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/outpatient-safety-ui.spec.tsx`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### OPD-002 — Prescribing and allergies

- **Module / requirement:** Core HMIS — Persist prescriptions with allergy checking and a traceable pharmacy handoff.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 2.
- **Current implementation:** Medications state/events, allergy checking and FEFO dispensation linkage exist; UI explicitly distinguishes saved prescription from unconfirmed routing.
- **Inspected layer paths:** UI: `src/components/modules/PharmacyModule.tsx`; API: `src/routes/pharmacy.routes.ts`; businessRules: `src/inventory/inventory.service.ts`; persistence: `src/db/schema/pharmacy-workflow.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/pharmacy-inventory-billing.db.spec.ts`.
- **Missing functionality / defect:** Full partial dispensing/cancel/return clinical UAT not fresh; approved drug/unit/formulary needed.
- **Required task:** Verify selected medicine, patient, route/dose, allergy warning and later dispensing against approved catalogue.
- **Dependencies / blockers:** D06.
- **Measurable acceptance:** Warnings visible and authorized override documented; two partial dispenses cannot exceed prescription; canceled medication not dispensed.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/outpatient-safety-ui.spec.tsx`, `src/tests/consent-allergy.spec.ts`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### OPD-003 — Terminology

- **Module / requirement:** Core HMIS — Use approved ICD-10/ICD-11 terminology without inventing code conversion or licensed content.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S23: Earlier cross-module achievements/gaps; superseded where later source differs
- **Priority / status:** Medium / **BLOCKED**. **Roadmap phase:** 2.
- **Current implementation:** ICD history and src/clinical/icd11 WHO boundary exist; no complete offline catalogue verified.
- **Inspected layer paths:** UI: `src/components/modules/OutpatientModule.tsx`; API: `src/routes/domains/encounters.routes.ts`; businessRules: `src/db/queries/encounters.ts`; persistence: `src/db/schema/clinical.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/outpatient-safety-ui.spec.tsx`.
- **Missing functionality / defect:** WHO release/license/access and payer/clinical mapping approval unavailable.
- **Required task:** Obtain authorized terminology version and scope; verify search/fallback without silently recoding old diagnoses.
- **Dependencies / blockers:** D07.
- **Measurable acceptance:** Every selected code has system/release; offline/unavailable status explicit; prior diagnosis codes preserved.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### LAB-001 — Orders and specimens

- **Module / requirement:** Core HMIS — Order exact facility tests with compatible patient/encounter/specimen identities and accession tracking.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 2.
- **Current implementation:** Catalogue/specimen selectors, collection/accession services and wrong-link checks/tests exist; fresh laboratory-safety DOM checks exercise UI controls.
- **Inspected layer paths:** UI: `src/components/modules/LaboratoryModule.tsx`; API: `src/routes/laboratory.routes.ts`; businessRules: `src/db/queries/laboratory.ts`; persistence: `src/db/schema/laboratory.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/laboratory-facility-identity.db.spec.ts`.
- **Missing functionality / defect:** Approved panels/specimens/reference intervals and real collection UAT not established.
- **Required task:** Configure approved lab catalogue; execute order→collection scenarios including shared specimens and concurrency.
- **Dependencies / blockers:** D06.
- **Measurable acceptance:** No result without required sample identity; duplicate accession/conflicting patient rejected; correct panel/order visible to lab.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/laboratory-safety-ui.spec.tsx`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### LAB-002 — Results and verification

- **Module / requirement:** Core HMIS — Record/correct/verify laboratory results and expose only appropriately released clinical output.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** Persisted results, verification/completion and portal verified-result query exist.
- **Inspected layer paths:** UI: `src/components/modules/LaboratoryModule.tsx`; API: `src/routes/laboratory.routes.ts`; businessRules: `src/db/queries/laboratory.ts`; persistence: `src/db/schema/laboratory.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/laboratory-facility-identity.db.spec.ts`.
- **Missing functionality / defect:** Verification is not an independently defined release event; official PDF path accepts mixed unverified results.
- **Required task:** Approve release semantics and enforce lab completion/verification before official issue, with explicit draft workflow if needed.
- **Dependencies / blockers:** D06, DOC-004.
- **Measurable acceptance:** Mixed/absent/unverified results cannot become official report; authorized correction retains history and downstream access policy.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### LAB-003 — Lab charging and consumption

- **Module / requirement:** Core HMIS — Link completed investigations to exactly-once charges and required reagent usage.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** Clinical billing attempts/outbox and lab completion paths exist; no general approved test→reagent consumption mapping established.
- **Inspected layer paths:** UI: `src/components/modules/LaboratoryModule.tsx`; API: `src/routes/laboratory.routes.ts`; businessRules: `src/db/queries/laboratory.ts`; persistence: `src/db/schema/laboratory.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/laboratory-facility-identity.db.spec.ts`.
- **Missing functionality / defect:** Reagent packs, units, wastage/return policy and end-to-end stock/cost attribution incomplete.
- **Required task:** Agree whether reagent tracking is included; implement approved mapping where required and accept billing failure/retry.
- **Dependencies / blockers:** D06, D08.
- **Measurable acceptance:** One completed investigation creates one charge; retry does not duplicate; required reagent lot/quantity reconciles or is explicitly excluded.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### RAD-001 — Imaging request

- **Module / requirement:** Core HMIS — Persist scoped procedure-specific imaging requests without charging an unperformed request.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 2.
- **Current implementation:** Radiology route validates encounter/patient/facility and request idempotency; creation returns billing:null.
- **Inspected layer paths:** UI: `src/components/modules/RadiologyModule.tsx`; API: `src/routes/radiology.routes.ts`; businessRules: `src/documents/patient-documents.service.ts`; persistence: `drizzle/0100_patient_signed_documents.sql`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/patient-signed-documents.db.spec.ts`.
- **Missing functionality / defect:** Fresh complete procedure/report/billing journey not run.
- **Required task:** Run request/cancel/perform/report UAT against configured imaging services.
- **Dependencies / blockers:** D06.
- **Measurable acceptance:** Canceled/request-only study not charged; wrong encounter denied; accepted performed study billed once.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### RAD-002 — Procedure consent

- **Module / requirement:** Core HMIS — Enforce request-specific radiology consent and authorized documented exceptions before performance.
- **Provenance:** IMPLIED_WORKFLOW; S06: Signed files/portal/procedure consent/letterhead acceptance and remaining gaps
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** 0100 plus patient-documents service implement request-specific verification/exception gate; historical 38 signed-document/consent/login DB tests and browser evidence present.
- **Inspected layer paths:** UI: `src/components/modules/RadiologyModule.tsx`; API: `src/routes/radiology.routes.ts`; businessRules: `src/documents/patient-documents.service.ts`; persistence: `drizzle/0100_patient_signed_documents.sql`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/patient-signed-documents.db.spec.ts`.
- **Missing functionality / defect:** Actual clinician eligibility, consent types/validity and exception policy require owner review, not staff signature-presence metadata alone.
- **Required task:** Reaccept configured consent gate under signed policy, including direct HTTP and legacy-request cases.
- **Dependencies / blockers:** D05, D06.
- **Measurable acceptance:** Generic/other-order/withdrawn consent rejected; authorized exception records clinician/time/reason; wrong role denied.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### RAD-003 — Reported results

- **Module / requirement:** Core HMIS — Release only authorized reported imaging findings to clinicians and patients.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S03: §4 SY01–SY18; module matrices and §11 recommendations; S06: Signed files/portal/procedure consent/letterhead acceptance and remaining gaps
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** Report-time findings and performed path exist; generated report builder checks timestamp OR findings, not a full approved release state.
- **Inspected layer paths:** UI: `src/components/modules/RadiologyModule.tsx`; API: `src/routes/radiology.routes.ts`; businessRules: `src/documents/patient-documents.service.ts`; persistence: `drizzle/0100_patient_signed_documents.sql`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/patient-signed-documents.db.spec.ts`.
- **Missing functionality / defect:** Final-release semantics and issue audit need enforcement; PACS/DICOM is not inferred as client scope.
- **Required task:** Define draft/final/amendment states and authorized clinical/portal issue behavior.
- **Dependencies / blockers:** D06, DOC-004.
- **Measurable acceptance:** Only approved state issues official report; correction preserves previous evidence; premature and cross-facility access rejected.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### IPD-001 — Admissions and beds

- **Module / requirement:** Core HMIS — Admit, allocate/transfer beds and retain historical occupancy and nursing care.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 2.
- **Current implementation:** Occupancy/transfer history, wards/beds and nursing services exist, with inpatient billing integration suites.
- **Inspected layer paths:** UI: `src/components/modules/InpatientModule.tsx`; API: `src/routes/inpatient.routes.ts`; businessRules: `src/inpatient/ward-bed.service.ts`; persistence: `src/db/schema/inpatient.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/inpatient-bed-billing.db.spec.ts`.
- **Missing functionality / defect:** No fresh real multi-ward nursing/admission workflow or facility capacity/staff acceptance.
- **Required task:** Exercise concurrent allocation, transfer, notes/vitals, discharge and wrong-patient boundaries.
- **Dependencies / blockers:** D03, D06.
- **Measurable acceptance:** No double active occupancy; transfers preserve event-time rates/ward history; permitted staff see only scoped admission.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### IPD-002 — Bed-night policy

- **Module / requirement:** Core HMIS — Accrue bed charges using approved local-time cutoff, grace and same-day rules.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 3.
- **Current implementation:** Configurable occupancy/night/rate-snapshot services exist; fresh pure policy tests pass.
- **Inspected layer paths:** UI: `src/components/modules/InpatientModule.tsx`; API: `src/routes/inpatient.routes.ts`; businessRules: `src/inpatient/ward-bed.service.ts`; persistence: `src/db/schema/inpatient.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/inpatient-bed-billing.db.spec.ts`.
- **Missing functionality / defect:** Client same-day ONE/ZERO choice, timezone/cutoff/grace and historical treatment not signed.
- **Required task:** Approve policy and run midnight/transfer/same-day/concurrent retry cases against DB.
- **Dependencies / blockers:** D08.
- **Measurable acceptance:** Expected nights and exact cents match approved examples; no duplicate charge on rerun; policy change preserves prior evidence.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/inpatient-bed-night-policy.spec.ts`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### IPD-003 — Discharge and final invoice

- **Module / requirement:** Core HMIS — Coordinate discharge, outstanding ward/pharmacy/lab charges and final invoice/summary.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 3.
- **Current implementation:** Discharge/summary, finalization and charge-recovery functions exist.
- **Inspected layer paths:** UI: `src/components/modules/InpatientModule.tsx`; API: `src/routes/inpatient.routes.ts`; businessRules: `src/inpatient/ward-bed.service.ts`; persistence: `src/db/schema/inpatient.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/inpatient-bed-billing.db.spec.ts`.
- **Missing functionality / defect:** No proven all-department completion barrier; discharge PDF checks only nonempty summary, not final discharge state.
- **Required task:** Agree pending-service/settlement policy and complete discharge reconciliation and official output gates.
- **Dependencies / blockers:** D06, D08, DOC-004.
- **Measurable acceptance:** Pending charges explicitly resolved/rejected per policy; final invoice includes every accepted service once; draft admission cannot issue final summary.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### PHA-001 — Dispensing

- **Module / requirement:** Core HMIS — Dispense correct unexpired lots with quantity, stock and immutable medicine price evidence.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 3.
- **Current implementation:** FEFO, pharmacy_dispense_allocations, price/date snapshots and durable billing work are in inventory.service.ts.
- **Inspected layer paths:** UI: `src/components/modules/PharmacyModule.tsx`; API: `src/routes/pharmacy.routes.ts`; businessRules: `src/inventory/inventory.service.ts`; persistence: `src/db/schema/pharmacy-workflow.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/pharmacy-inventory-billing.db.spec.ts`.
- **Missing functionality / defect:** Fresh real dispensing→billing acceptance absent; actual formulary prices/units and returns owner approval needed.
- **Required task:** Run split-lot/partial/expired-stock/concurrent/retry dispensing with approved medicine list.
- **Dependencies / blockers:** D06, D08.
- **Measurable acceptance:** Exact lots and quantity reduce once; charge uses dispensation snapshot not later tariff; failed billing remains visible/recoverable.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### PHA-002 — Medication returns

- **Module / requirement:** Core HMIS — Support approved patient medication return/cancellation policy through stock and finance.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 3.
- **Current implementation:** Supplier returns and stock adjustments exist; they are not a proven patient prescription-return workflow.
- **Inspected layer paths:** UI: `src/components/modules/PharmacyModule.tsx`; API: `src/routes/pharmacy.routes.ts`; businessRules: `src/inventory/inventory.service.ts`; persistence: `src/db/schema/pharmacy-workflow.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/pharmacy-inventory-billing.db.spec.ts`.
- **Missing functionality / defect:** Patient return eligibility, usable-lot custody, charge/refund reversal and cross-module state not established.
- **Required task:** Define clinical/pharmacy policy and implement missing patient-return transitions if required.
- **Dependencies / blockers:** D06, D08.
- **Measurable acceptance:** Return links original dispense/lot and financial correction; no double restock/refund; damaged/expired goods not resold.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### MCH-001 — Maternity and MCH

- **Module / requirement:** Core HMIS — Persist ANC, labour/partograph, delivery/baby, postnatal and immunisation records.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 2.
- **Current implementation:** Maternity services/schema, postnatal and immunisation paths exist; arithmetic/regression specs do not constitute clinical approval.
- **Inspected layer paths:** UI: `src/components/modules/MaternityModule.tsx`; API: `src/routes/maternal-health.routes.ts`; businessRules: `src/maternity/maternity.service.ts`; persistence: `src/db/schema/maternity.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/maternity.spec.ts`.
- **Missing functionality / defect:** Included scope, reference protocols, mother/baby linking and specialist UAT outstanding.
- **Required task:** Run full maternal journey including multiple babies and corrections with approved clinicians.
- **Dependencies / blockers:** D03, D06.
- **Measurable acceptance:** Mother and each baby link correctly; delivery count not baby count; recorded observations and follow-up persist with scope.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### MCH-002 — Maternity outputs/consumption

- **Module / requirement:** Core HMIS — Connect required MCH summaries, clinical outputs and consumables to accepted source records.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** Medium / **PARTIAL**. **Roadmap phase:** 5.
- **Current implementation:** Delivery billing hook exists, but full approved maternity/statutory/consumption output is not established.
- **Inspected layer paths:** UI: `src/components/modules/MaternityModule.tsx`; API: `src/routes/maternal-health.routes.ts`; businessRules: `src/maternity/maternity.service.ts`; persistence: `src/db/schema/maternity.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/maternity.spec.ts`.
- **Missing functionality / defect:** Department-specific layouts/consumption and indicator definitions missing.
- **Required task:** Obtain included outputs and packs; finish only approved persisted chains.
- **Dependencies / blockers:** D03, D06, D10.
- **Measurable acceptance:** All included maternity outputs match synthetic maternal/baby cases; consumed lots and charges reconcile independently.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### THR-001 — Theatre scheduling

- **Module / requirement:** Core HMIS — Manage scoped theatre rooms, bookings, readiness review and scheduling history.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** Medium / **UNVERIFIED**. **Roadmap phase:** 2.
- **Current implementation:** Real scheduling UI and event schema/services exist; UI explicitly says booking does not establish clinical readiness.
- **Inspected layer paths:** UI: `src/components/modules/TheatreModule.tsx`; API: `src/routes/theatre-scheduling.routes.ts`; businessRules: `src/routes/theatre.routes.ts`; persistence: `src/db/schema/theatre-scheduling.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/theatre-scheduling-ui.spec.tsx`.
- **Missing functionality / defect:** Fresh concurrency/room-conflict/readiness role acceptance not run.
- **Required task:** Validate included scheduling workflow without relabeling a booking as performed surgery.
- **Dependencies / blockers:** D03, D06.
- **Measurable acceptance:** Overlapping unavailable room bookings refused; changes/review revocation audited; schedule state cannot certify surgery.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### THR-002 — Operative and anaesthetic care

- **Module / requirement:** Core HMIS — Persist required operative/anaesthetic notes, procedure completion, consumables and charges.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **NOT IMPLEMENTED**. **Roadmap phase:** 2.
- **Current implementation:** Scheduling and legacy theatre case rows exist; no adequate complete operative/anaesthetic documentation lifecycle found.
- **Inspected layer paths:** UI: `src/components/modules/TheatreModule.tsx`; API: `src/routes/theatre-scheduling.routes.ts`; businessRules: `src/routes/theatre.routes.ts`; persistence: `src/db/schema/theatre-scheduling.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/theatre-scheduling-ui.spec.tsx`.
- **Missing functionality / defect:** Scheduling is not an operative record, clinician sign-off or source-linked consumables chain.
- **Required task:** Confirm inclusion; implement approved theatre clinical record and surgical/anaesthetic sign-off links.
- **Dependencies / blockers:** D03, D06.
- **Measurable acceptance:** Completed case has signed approved note versions and exact consumed items/charges; amendments audited and previous notes preserved.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### SPC-001 — Dental care and consumables

- **Module / requirement:** Core HMIS — Record dental procedure, consumed materials and associated stock/cost/billing.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **NOT IMPLEMENTED**. **Roadmap phase:** 2.
- **Current implementation:** SpecialtyModule states old dental forms were local examples and now provides navigation; generic adjustments are not procedure-linked consumption.
- **Inspected layer paths:** UI: `src/components/modules/SpecialtyModule.tsx`; API: `src/routes/domains/encounters.routes.ts`; businessRules: `src/components/modules/SpecialtyModule.tsx`; persistence: `src/db/schema/clinical.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `docs/audits/SYRONA_MASTER_SYSTEM_COMPLETION_AUDIT_2026-11-13.md`.
- **Missing functionality / defect:** No adequate dental clinical record→consumables→stock→charge workflow.
- **Required task:** Confirm included dental charts/procedures/packs and implement persisted approved chain.
- **Dependencies / blockers:** D03, D06, D08.
- **Measurable acceptance:** A recorded dental procedure consumes correct lots once and creates approved charge/cost evidence; correction reverses with history.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### SPC-002 — Optical/ENT/specialties

- **Module / requirement:** Core HMIS — Supply persisted specialty-specific care only for explicitly included departments.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** Medium / **NOT IMPLEMENTED**. **Roadmap phase:** 2.
- **Current implementation:** Optical/ENT tabs are honest navigation, not saved specialist records.
- **Inspected layer paths:** UI: `src/components/modules/SpecialtyModule.tsx`; API: `src/routes/domains/encounters.routes.ts`; businessRules: `src/components/modules/SpecialtyModule.tsx`; persistence: `src/db/schema/clinical.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `docs/audits/SYRONA_MASTER_SYSTEM_COMPLETION_AUDIT_2026-11-13.md`.
- **Missing functionality / defect:** No adequate structured specialty note/exam workflow; not automatically a mandatory client requirement.
- **Required task:** Client confirms included specialties; implement or contractually defer identified records.
- **Dependencies / blockers:** D03, D06.
- **Measurable acceptance:** Each included specialty persists approved fields and follow-up; excluded specialties remain explicitly unavailable.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### DIA-001 — Dialysis clinical journey

- **Module / requirement:** Core HMIS — Use authorized protocols/plans, safe machine scheduling, sessions, observations and adverse events.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S03: §4 SY01–SY18; module matrices and §11 recommendations; S23: Earlier cross-module achievements/gaps; superseded where later source differs
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** Dialysis service has protocol approval, plan authorization, schedule/start/complete and adverse-event handling, not just scheduling.
- **Inspected layer paths:** UI: `src/components/modules/DialysisModule.tsx`; API: `src/routes/dialysis.routes.ts`; businessRules: `src/dialysis/dialysis.service.ts`; persistence: `src/db/schema/dialysis.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/client-dialysis.spec.ts`.
- **Missing functionality / defect:** Facility protocol values, clinician sign-off and complete session UAT unavailable.
- **Required task:** Approve protocols then run realistic included treatment scenarios, overlaps and unsafe starts.
- **Dependencies / blockers:** D03, D06.
- **Measurable acceptance:** Only authorized compatible plan/machine starts; observations and outcomes persist; adverse events receive auditable follow-up.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### DIA-002 — Dialysis consumption and billing

- **Module / requirement:** Core HMIS — Link actual dialysis consumption/session outcomes to stock and exactly-once billing.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 4.
- **Current implementation:** recordConsumableScoped locks stock/batches and bills completed sessions via existing charge path; recorded usage is not automatically a complete movement/GL trail.
- **Inspected layer paths:** UI: `src/components/modules/DialysisModule.tsx`; API: `src/routes/dialysis.routes.ts`; businessRules: `src/dialysis/dialysis.service.ts`; persistence: `src/db/schema/dialysis.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/client-dialysis.spec.ts`.
- **Missing functionality / defect:** No fresh consumed-lot→movement/valuation→charge ledger reconciliation for dialysis; included reports incomplete.
- **Required task:** Trace actual session consumables across all stock representations and recoverable billing.
- **Dependencies / blockers:** D06, D08.
- **Measurable acceptance:** Same session retry does not double deduct/charge; movement/lot/item/GL differences are zero or explained; cancel/failed treatment policy approved.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### DOC-001 — Original-file custody

- **Module / requirement:** Clinical documents — Store safe patient document originals with versioned corrections and independently recorded signature presence.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S03: §4 SY01–SY18; module matrices and §11 recommendations; S06: Signed files/portal/procedure consent/letterhead acceptance and remaining gaps
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** Current signed-document service validates MIME/extension/content/size, stores original bytes/SHA256 and independent signature metadata; immutable 0100 guards exist.
- **Inspected layer paths:** UI: `src/components/PatientDocumentsPanel.tsx`; API: `src/documents/patient-documents.routes.ts`; businessRules: `src/documents/patient-documents.service.ts`; persistence: `drizzle/0100_patient_signed_documents.sql`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/patient-signed-documents.db.spec.ts`.
- **Missing functionality / defect:** Client file/retention/content-release policy and deployment controls not accepted; uploaded image does not cryptographically authenticate a signature.
- **Required task:** Reaccept real staff upload/correction/history/download and records retention roles against approved policy.
- **Dependencies / blockers:** D05, D15.
- **Measurable acceptance:** Original bytes/hash unchanged after correction; invalid/oversize/executable files denied; patient/doctor signature states independent; correction requires reason.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### DOC-002 — Controlled portal release

- **Module / requirement:** Clinical documents — Release only explicitly authorized patient-owned document versions through secure preview/download.
- **Provenance:** IMPLIED_WORKFLOW; S06: Signed files/portal/procedure consent/letterhead acceptance and remaining gaps
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** Explicit per-version portal release/withdrawal, reduced patient metadata and own-patient session checks exist, with actual prior browser/download evidence.
- **Inspected layer paths:** UI: `src/components/PatientDocumentsPanel.tsx`; API: `src/documents/patient-documents.routes.ts`; businessRules: `src/documents/patient-documents.service.ts`; persistence: `drizzle/0100_patient_signed_documents.sql`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/patient-signed-documents.db.spec.ts`.
- **Missing functionality / defect:** Facility release roles/retention and actual document content review outstanding; correction does not automatically withdraw old release.
- **Required task:** Approve version release/withdrawal policy and reaccept two patients/two facilities/failed-audit cases.
- **Dependencies / blockers:** D05, D15.
- **Measurable acceptance:** Unreleased/other-patient versions unavailable; staff notes/audit excluded; preview/download audit durable; old-version withdrawal explicit.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### DOC-003 — Generated document access

- **Module / requirement:** Clinical documents — Enforce scoped permissions, module policy and access audit on generated official documents.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations; S06: Signed files/portal/procedure consent/letterhead acceptance and remaining gaps
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 1.
- **Current implementation:** document.service.ts checks domain read and scope; routes/index.ts deliberately mounts /documents without module gates. sendDocument lacks shared issue/read audit.
- **Inspected layer paths:** UI: `src/components/PatientDocumentsPanel.tsx`; API: `src/documents/patient-documents.routes.ts`; businessRules: `src/documents/patient-documents.service.ts`; persistence: `drizzle/0100_patient_signed_documents.sql`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/patient-signed-documents.db.spec.ts`.
- **Missing functionality / defect:** Disabled-module policy can differ from report/workspace guards; durable generated-PDF issue/access audit incomplete.
- **Required task:** Approve document module availability policy; enforce applicable gates and mandatory access/issue audit centrally.
- **Dependencies / blockers:** D05, SEC-007.
- **Measurable acceptance:** Direct PDF URL denied when disallowed by signed policy; cross-facility denied; failed mandatory audit yields no bytes.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/clinical-document-report-ui.spec.tsx`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### DOC-004 — Official clinical release gates

- **Module / requirement:** Clinical documents — Distinguish draft clinical PDFs from approved final lab/imaging/discharge documents.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations; S06: Signed files/portal/procedure consent/letterhead acceptance and remaining gaps
- **Priority / status:** High / **DEFECTIVE**. **Roadmap phase:** 2.
- **Current implementation:** Current builders: lab requires only ≥1 result and warns on unverified values; imaging accepts reportedAt OR findings; discharge accepts nonempty summary. Routes return ordinary titled PDFs.
- **Inspected layer paths:** UI: `src/components/PatientDocumentsPanel.tsx`; API: `src/documents/patient-documents.routes.ts`; businessRules: `src/documents/patient-documents.service.ts`; persistence: `drizzle/0100_patient_signed_documents.sql`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/patient-signed-documents.db.spec.ts`.
- **Additional current source:** `src/documents/document.service.ts`, `src/documents/document.routes.ts`.
- **Missing functionality / defect:** Source-confirmed permissive final-document eligibility; no fresh runtime PDF premature-release test. Presence of fields is not final clinical approval.
- **Required task:** Agree draft/final policy; gate official issue by approved source state and authorized signer, preserving correction/issue history.
- **Dependencies / blockers:** D06, D05.
- **Measurable acceptance:** Mixed unverified lab, unperformed/unreleased imaging and active-admission summary cannot issue final document; approved outputs contain exact eligible data and issue audit.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### DOC-005 — Issued history

- **Module / requirement:** Clinical documents — Preserve issued-document content and approved historical branding on reprint/amendment.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations; S22: Existing versioned upload/layout/explicit activation/history; no separate stamp authority
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 5.
- **Current implementation:** Finalized invoices snapshot finance; active/historical letterhead resolution exists. Most other generated documents read current source rows at print time.
- **Inspected layer paths:** UI: `src/components/modules/BrandingDocumentsPanel.tsx`; API: `src/branding/letterhead.routes.ts`; businessRules: `src/branding/letterhead.service.ts`; persistence: `src/db/schema/facility-branding.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/letterhead-branding.db.spec.ts`.
- **Missing functionality / defect:** No universal immutable issue snapshot; event-time lookup is not a frozen issued document.
- **Required task:** Approve document-kind issue/snapshot/reissue policy; extend existing document evidence rather than create second renderer.
- **Dependencies / blockers:** D05, D09.
- **Measurable acceptance:** Issue under A then change source/template to B; reprint follows signed policy and never silently alters prior issued evidence.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### POR-001 — Authentication and isolation

- **Module / requirement:** Patient portal — Authenticate patients separately with lockout, forced reset and atomic security-version/session controls.
- **Provenance:** IMPLIED_WORKFLOW; S06: Signed files/portal/procedure consent/letterhead acceptance and remaining gaps; S14: Historical exposure and findings; current fixes must be reconciled, not assumed absent
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 1.
- **Current implementation:** Current portal-auth.service.ts locks accounts and rechecks password/security version; prior active-lock clearing finding is no longer true in source.
- **Inspected layer paths:** UI: `src/components/portal/PortalApp.tsx`; API: `src/portal/portal.routes.ts`; businessRules: `src/portal/portal-records.service.ts`; persistence: `src/db/schema/platform.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/phase1-portal-isolation.db.spec.ts`.
- **Missing functionality / defect:** Fresh real PostgreSQL race/recovery tests and recovery-channel owner acceptance not run in this assessment.
- **Required task:** Reexecute portal auth/isolation suites and approved recovery UAT; do not reimplement already fixed lockout.
- **Dependencies / blockers:** D05, SEC-003.
- **Measurable acceptance:** Additional bad guesses never shorten lock; changed/revoked credentials invalidate sessions; digit-heavy email logs in only as exact account.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/phase1-portal-ui.spec.tsx`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### POR-002 — Clinical record release

- **Module / requirement:** Patient portal — Limit portal clinical records to approved patient/facility-specific subsets and verified results.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations; S06: Signed files/portal/procedure consent/letterhead acceptance and remaining gaps; S14: Historical exposure and findings; current fixes must be reconciled, not assumed absent
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** Current overview query scopes both order/result patient and allowed facility IDs; old missing-lab-scope/notes findings have source fixes.
- **Inspected layer paths:** UI: `src/components/portal/PortalApp.tsx`; API: `src/portal/portal.routes.ts`; businessRules: `src/portal/portal-records.service.ts`; persistence: `src/db/schema/platform.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/phase1-portal-isolation.db.spec.ts`.
- **Missing functionality / defect:** Account+registration-facility policy ownership and cross-facility sharing governance remain decisions; not every clinical object release certified.
- **Required task:** Approve facility-specific release policy and test every list/overview/export/sharing path with mismatched legacy rows.
- **Dependencies / blockers:** D05.
- **Measurable acceptance:** No clinician-only note or other-patient row in any view/export; withheld labs and cross-facility conflicts fail closed.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### POR-003 — Sharing and digital card

- **Module / requirement:** Patient portal — Provide approved secure sharing, correction requests and digital identification without granting general chart access.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S03: §4 SY01–SY18; module matrices and §11 recommendations; S23: Earlier cross-module achievements/gaps; superseded where later source differs
- **Priority / status:** Medium / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** Sharing grants, expiry/revocation, QR-card and correction request APIs exist.
- **Inspected layer paths:** UI: `src/components/portal/PortalApp.tsx`; API: `src/portal/portal.routes.ts`; businessRules: `src/portal/portal-records.service.ts`; persistence: `src/db/schema/platform.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/phase1-portal-isolation.db.spec.ts`.
- **Missing functionality / defect:** Recipient identity/single-use concurrency and patient consent policy require acceptance; QR is not authorization to all records.
- **Required task:** Confirm required sharing design, then verify recipient/expiry/revocation/replay and correction workflow.
- **Dependencies / blockers:** D05.
- **Measurable acceptance:** Expired/revoked/single-use codes cannot be reused; only authorized released subset shared; correction does not edit clinical source directly.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### BIL-001 — Facility service tariffs

- **Module / requirement:** Billing and finance — Resolve approved facility-specific service prices from exact selected catalogue identities.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 3.
- **Current implementation:** Master/facility service linking, import, reviewed specimen setup, price history and scoped charge resolvers exist.
- **Inspected layer paths:** UI: `src/components/modules/FacilityServiceTariffsPanel.tsx`; API: `src/routes/service-tariffs.routes.ts`; businessRules: `src/billing/facility-charge-resolver.ts`; persistence: `src/db/schema/facility-services.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/clinical-catalogue-selection.db.spec.ts`.
- **Missing functionality / defect:** Actual Syrona service/medicine prices, effective dates, unpriced decisions and account mappings not owner-approved.
- **Required task:** Reconcile authorized catalogue/prices and test exact selected service→price→charge evidence.
- **Dependencies / blockers:** D06, D08.
- **Measurable acceptance:** No ambiguous free-text fallback bills wrong service; inactive/foreign/unpriced selection blocks or enters explicit review; historical price snapshots retained.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### BIL-002 — Clinical billing recovery

- **Module / requirement:** Billing and finance — Turn accepted clinical activity into exactly-once persisted charges with durable retry and visible failures.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** Critical / **UNVERIFIED**. **Roadmap phase:** 3.
- **Current implementation:** billing/charge-attempts.ts stages clinical billing outbox; pharmacy transaction records billable work separately from successful billing.
- **Inspected layer paths:** UI: `src/components/modules/BillingCashierModule.tsx`; API: `src/routes/domains/invoices.routes.ts`; businessRules: `src/billing/finalized-invoice.service.ts`; persistence: `src/db/schema/billing.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/invoice-payment-acceptance.db.spec.ts`.
- **Missing functionality / defect:** Fresh all-department failure/retry/void/race acceptance not run; an outbox row is not a posted charge.
- **Required task:** Exercise every included clinical producer and recovery queue, including interrupted network and price correction.
- **Dependencies / blockers:** D06, D08.
- **Measurable acceptance:** One source identity yields one charge; concurrent retries converge; failed/unpriced sources stay visible and cannot be falsely marked settled.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### BIL-003 — Invoice finalization

- **Module / requirement:** Billing and finance — Finalize immutable itemized invoices with correct patient/insurer responsibility.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** Critical / **UNVERIFIED**. **Roadmap phase:** 3.
- **Current implementation:** Finalized invoice service/schema snapshots, version gates and patient/insurer attribution exist; claims require finalized evidence.
- **Inspected layer paths:** UI: `src/components/modules/BillingCashierModule.tsx`; API: `src/routes/domains/invoices.routes.ts`; businessRules: `src/billing/finalized-invoice.service.ts`; persistence: `src/db/schema/billing.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/invoice-payment-acceptance.db.spec.ts`.
- **Missing functionality / defect:** Fresh real DB/browser finalization and concurrent payer allocation UAT absent.
- **Required task:** Run item/rate/party allocation/finalization/void corrections through complete invoice journey.
- **Dependencies / blockers:** D08, BIL-001.
- **Measurable acceptance:** Finalized figures cannot mutate; exact cents sum; wrong payer/encounter denied; claims snapshot references correct finalized version.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### BIL-004 — Payments and receipts

- **Module / requirement:** Billing and finance — Record authorized payment/allocation/receipt atomically without treating a declaration as settled money.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations; S11: Manual declaration, independent verification/settlement; provider limitations
- **Priority / status:** Critical / **UNVERIFIED**. **Roadmap phase:** 3.
- **Current implementation:** payments.service.ts recordSettledPayment and bank settle path share invoice/allocation/audit primitives; pending bank transfer creates no receipt.
- **Inspected layer paths:** UI: `src/components/modules/BillingCashierModule.tsx`; API: `src/routes/domains/invoices.routes.ts`; businessRules: `src/billing/finalized-invoice.service.ts`; persistence: `src/db/schema/billing.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/invoice-payment-acceptance.db.spec.ts`.
- **Missing functionality / defect:** Fresh complete payment→receipt→GL acceptance and client payment-method policy not established.
- **Required task:** Test duplicates, uncertain outcomes, overpayment/party balances and signed bank-only controls.
- **Dependencies / blockers:** D08, BNK-001.
- **Measurable acceptance:** Concurrent replay produces one receipt/allocation; wrong amount/party rejected; pending transfer never reduces outstanding balance.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### BIL-005 — Refunds and credits

- **Module / requirement:** Billing and finance — Approve and record source-linked refunds with independent evidence and safe financial correction.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S03: §4 SY01–SY18; module matrices and §11 recommendations; S11: Manual declaration, independent verification/settlement; provider limitations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 3.
- **Current implementation:** Refund request/approval/revocation, manual and bank-evidence refund paths exist; printable credit note renders a recorded refund.
- **Inspected layer paths:** UI: `src/components/modules/BillingCashierModule.tsx`; API: `src/routes/domains/invoices.routes.ts`; businessRules: `src/billing/finalized-invoice.service.ts`; persistence: `src/db/schema/billing.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/invoice-payment-acceptance.db.spec.ts`.
- **Missing functionality / defect:** Full line-level credit/waiver/AR-note accounting is not established; payment refund is not automatically revenue correction.
- **Required task:** Agree client credit/refund/waiver products and posting policy; implement missing distinctions and UAT.
- **Dependencies / blockers:** D08.
- **Measurable acceptance:** No self-approval or duplicate/excess refund; bank refund uses exact approved outflow; AR/revenue/payment effects match approved cases.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### BIL-006 — Receivables and ageing

- **Module / requirement:** Billing and finance — Provide reconciled patient/insurer outstanding balances and required aged receivable statements.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** Invoice payment ledger and report-centre invoice-balances return persisted outstanding responsibility.
- **Inspected layer paths:** UI: `src/components/modules/BillingCashierModule.tsx`; API: `src/routes/domains/invoices.routes.ts`; businessRules: `src/billing/finalized-invoice.service.ts`; persistence: `src/db/schema/billing.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/invoice-payment-acceptance.db.spec.ts`.
- **Missing functionality / defect:** Full approved AR ageing cutoffs/as-of history, department/payer statements and source coverage not established.
- **Required task:** Specify ageing and attribution; implement missing source-backed views and reconcile to posted control accounts.
- **Dependencies / blockers:** D08, ACC-002.
- **Measurable acceptance:** Age buckets sum to approved as-of AR; refunds/reversals/unposted items reconciled; patient/insurer balances never double-counted.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### BIL-007 — Pharmacy charging

- **Module / requirement:** Billing and finance — Bill actual dispensed quantity from immutable medicine selling-price snapshots.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 3.
- **Current implementation:** pharmacy-inventory-charge.ts and dispense snapshot/outbox exist; prescription is not treated as dispensing.
- **Inspected layer paths:** UI: `src/components/modules/PharmacyModule.tsx`; API: `src/routes/pharmacy.routes.ts`; businessRules: `src/inventory/inventory.service.ts`; persistence: `src/db/schema/pharmacy-workflow.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/pharmacy-inventory-billing.db.spec.ts`.
- **Missing functionality / defect:** Fresh multi-dispensation stock/charge/receipt reconciliation and actual price review missing.
- **Required task:** Execute two partial dispensings, later price change and charge retry with same prescription.
- **Dependencies / blockers:** D06, BIL-001.
- **Measurable acceptance:** Charged quantity equals accepted dispensations only; later service tariff changes do not reprice dispensed medication.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### BIL-008 — Expense management

- **Module / requirement:** Billing and finance — Approve/post expense requests with independently verifiable supporting evidence and settlement.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S01: Master System Completion Assessment: sections 1–12; audit topics are not proof of original contract scope; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** Expense request/decision/posting exists; accounting.service.ts explicitly says supporting documents are references only and posted expense is payable, not payment.
- **Inspected layer paths:** UI: `src/components/modules/AccountingModule.tsx`; API: `src/routes/accounting.routes.ts`; businessRules: `src/accounting/accounting.service.ts`; persistence: `src/db/schema/financial-ledger.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/billing-posting.db.spec.ts`.
- **Missing functionality / defect:** Secure support-file custody/existence validation and full expense-payment UX not established.
- **Required task:** Agree expense documentary and settlement policy; reuse secure storage pattern for required evidence and payment reconciliation.
- **Dependencies / blockers:** D08, D15.
- **Measurable acceptance:** Approved supported expense posts once; unauthorized/self-approval refused; payment/receipt/GL tie out without double expensing.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### BNK-001 — Manual bank transfers

- **Module / requirement:** Billing and finance — Verify declared bank receipts using exact statement evidence and independent verification/settlement.
- **Provenance:** IMPLIED_WORKFLOW; S11: Manual declaration, independent verification/settlement; provider limitations
- **Priority / status:** Critical / **PARTIAL**. **Roadmap phase:** 3.
- **Current implementation:** Current bank service/policy and bank-payments schema implement pending declaration, separate actors, exact statement inflow and atomic receipt settlement; fresh bank UI tests pass with mocks.
- **Inspected layer paths:** UI: `src/components/modules/payment-hub/BankPaymentsWorkspace.tsx`; API: `src/bank-payments/routes.ts`; businessRules: `src/bank-payments/service.ts`; persistence: `src/db/schema/bank-payments.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/bank-payments.db.spec.ts`.
- **Missing functionality / defect:** Client bank-only/payment-channel policy, receiving accounts and role staffing not accepted; no fresh DB acceptance here.
- **Required task:** Reaccept complete three-person flow and concurrent evidence reuse/overpayments under approved accounts/policy.
- **Dependencies / blockers:** D08, D11, SEC-006.
- **Measurable acceptance:** Pending declaration creates no receipt; verifier/settler distinct; exact unconsumed inflow required; one evidence line cannot settle twice.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/bank-payments-ui.spec.tsx`, `src/tests/vitest/billing-cashier-ui.spec.tsx`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### BNK-002 — Bank reconciliation

- **Module / requirement:** Billing and finance — Import statements, investigate/match, approve signed reconciliations and preserve signed periods.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations; S11: Manual declaration, independent verification/settlement; provider limitations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 4.
- **Current implementation:** accounting/bank-integration.service.ts has preview/import, exact suggestions, matching, adjustments and approval; bank reconciliation UI exists.
- **Inspected layer paths:** UI: `src/components/modules/payment-hub/BankPaymentsWorkspace.tsx`; API: `src/bank-payments/routes.ts`; businessRules: `src/bank-payments/service.ts`; persistence: `src/db/schema/bank-payments.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/bank-payments.db.spec.ts`.
- **Additional current source:** `src/accounting/bank-integration.service.ts`.
- **Missing functionality / defect:** Approved real-format statement samples/openings, current DB proof and finance UAT absent; not a live bank feed.
- **Required task:** Run duplicate/overlap imports, unmatched items, correct ledger match and independent approval.
- **Dependencies / blockers:** D08, D11.
- **Measurable acceptance:** Signed worksheet reconciles exact opening/closing and all differences; later retroactive changes/imports cannot invalidate approval silently.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/bank-payments-ui.spec.tsx`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### BNK-003 — Cash management

- **Module / requirement:** Billing and finance — Provide approved cashbook/petty-cash and day-close controls separately from bank statements.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** Recorded payment channels, ledger accounts and accounting overview exist.
- **Inspected layer paths:** UI: `src/components/modules/AccountingModule.tsx`; API: `src/routes/accounting.routes.ts`; businessRules: `src/accounting/accounting.service.ts`; persistence: `src/db/schema/financial-ledger.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/billing-posting.db.spec.ts`.
- **Missing functionality / defect:** Complete client cashbook/day-close/till-float/petty-cash workflow not established; bank-only design may intentionally exclude cash.
- **Required task:** Client decides permitted cash scope; implement required custody/close/reconciliation or explicitly contractually exclude.
- **Dependencies / blockers:** D08.
- **Measurable acceptance:** Agreed cashier opening/receipts/refunds/deposits/closing reconcile; cash and bank settlements never conflated.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### ACC-001 — Chart periods journals

- **Module / requirement:** Accounting — Post/reverse balanced scoped journals under configured chart and closed-period controls.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** Critical / **UNVERIFIED**. **Roadmap phase:** 4.
- **Current implementation:** accounting.service.ts enforces balanced lines/periods and post/reversal; source-linked billing and inventory journal bridges exist.
- **Inspected layer paths:** UI: `src/components/modules/AccountingModule.tsx`; API: `src/routes/accounting.routes.ts`; businessRules: `src/accounting/accounting.service.ts`; persistence: `src/db/schema/financial-ledger.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/billing-posting.db.spec.ts`.
- **Missing functionality / defect:** Actual chart/openings/periods and fresh end-to-end monetary integrity not approved in this assessment.
- **Required task:** Approve finance configuration and run posted/reversed/closed-period/concurrent posting scenarios.
- **Dependencies / blockers:** D08.
- **Measurable acceptance:** Unbalanced/cross-facility/closed-period journals refused; reversals preserve originals; all source ids unique as intended.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### ACC-002 — Source to ledger reconciliation

- **Module / requirement:** Accounting — Reconcile clinical invoices, receipts, refunds and inventory/AP activity to reviewed posted journals.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations; S11: Manual declaration, independent verification/settlement; provider limitations
- **Priority / status:** Critical / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** billing-posting, source-ledger-coverage, billing-GL and journal exception diagnostics exist; explicit reviewed posting remains separate from cash receipt.
- **Inspected layer paths:** UI: `src/components/modules/AccountingModule.tsx`; API: `src/routes/accounting.routes.ts`; businessRules: `src/accounting/accounting.service.ts`; persistence: `src/db/schema/financial-ledger.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/billing-posting.db.spec.ts`.
- **Missing functionality / defect:** Diagnostics disclose limited source/date coverage; no proof all historical sources, manual journals/classifications/openings are correctly posted.
- **Required task:** Accept source coverage and account mappings; reconcile all agreed source classes and interrupted posting recovery.
- **Dependencies / blockers:** D08, BIL-003, ACC-001.
- **Measurable acceptance:** No unexplained source-control-GL difference; unposted sources visible; retry never duplicates or re-recognizes revenue.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### ACC-003 — Financial statements

- **Module / requirement:** Accounting — Produce finance-approved trial balance, income/profit and loss and balance sheet from posted data.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** Posted accounting overview and three ledger report engines exist; recorded trial movements are not a full opening/closing trial balance.
- **Inspected layer paths:** UI: `src/components/modules/AccountingModule.tsx`; API: `src/routes/accounting.routes.ts`; businessRules: `src/accounting/accounting.service.ts`; persistence: `src/db/schema/financial-ledger.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/billing-posting.db.spec.ts`.
- **Missing functionality / defect:** Approved account classifications/opening balances, full formats and all-source posting coverage outstanding.
- **Required task:** Map approved statement lines, openings, reversals and periods; compare independent finance fixtures and PDF/XLSX.
- **Dependencies / blockers:** D08, ACC-002.
- **Measurable acceptance:** Debits/credits and assets/liabilities/equity reconcile under approved convention; statement totals tie to posted journal detail.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### ACC-004 — Cash flow

- **Module / requirement:** Accounting — Produce an approved actual cash-flow statement distinct from income and projections.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **NOT IMPLEMENTED**. **Roadmap phase:** 4.
- **Current implementation:** No adequate report-centre cash-flow engine/approved cash-flow classification found; income is not cash flow.
- **Inspected layer paths:** UI: `src/components/modules/AccountingModule.tsx`; API: `src/routes/accounting.routes.ts`; businessRules: `src/accounting/accounting.service.ts`; persistence: `src/db/schema/financial-ledger.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/billing-posting.db.spec.ts`.
- **Missing functionality / defect:** Operating/investing/financing mappings, method, opening cash and noncash treatment missing.
- **Required task:** Finance approves method/mappings; implement source-backed cash-flow and tie-out.
- **Dependencies / blockers:** D08.
- **Measurable acceptance:** Opening plus net cash movement equals closing reconciled cash; noncash journals excluded/classified; method disclosed.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### ACC-005 — Tax decisions

- **Module / requirement:** Accounting — Confirm effective tax/accounting/statutory treatments rather than infer rates or legal compliance.
- **Provenance:** EXTERNAL_DEPENDENCY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S12: Effective-dated statutory versions, configured chart, test-only readiness
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 4.
- **Current implementation:** Tax/rate configuration and payroll source-reference machinery exist; no complete consultant-approved facility policy.
- **Inspected layer paths:** UI: `src/components/modules/AccountingModule.tsx`; API: `src/routes/accounting.routes.ts`; businessRules: `src/accounting/accounting.service.ts`; persistence: `src/db/schema/financial-ledger.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/billing-posting.db.spec.ts`.
- **Missing functionality / defect:** Outstanding tax/VAT/withholding/depreciation/recognition decisions and current statutory sources require professional approval.
- **Required task:** Obtain written professional policy and authoritative effective versions before implementation/configuration.
- **Dependencies / blockers:** D07, D08.
- **Measurable acceptance:** All in-scope tax examples match approved reference/version; unsupported cases block or disclose limits; filing never implied.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### PRC-001 — Requisitions and approvals

- **Module / requirement:** Procurement and inventory — Create/submit/independently approve requisitions and convert accepted revisions to LPOs.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 4.
- **Current implementation:** requisitions.service.ts implements draft/version/approval/convert; approval policies exist and matching/returns DOM tests pass with mocks.
- **Inspected layer paths:** UI: `src/components/modules/ProcurementModule.tsx`; API: `src/routes/procurement-workflow.routes.ts`; businessRules: `src/procurement/receiving.service.ts`; persistence: `src/db/schema/procurement.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/procurement-matching-returns.db.spec.ts`.
- **Missing functionality / defect:** Named approvers, limits and complete real workflow UAT outstanding.
- **Required task:** Configure signed approval thresholds and exercise self/wrong approver, stale revision and duplicate conversion.
- **Dependencies / blockers:** D08, SEC-006.
- **Measurable acceptance:** Approved current requisition converts once; self/over-limit/wrong-scope decisions rejected with audit.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### PRC-002 — Suppliers and contracts

- **Module / requirement:** Procurement and inventory — Manage supplier records and any required contract/effective terms lifecycle.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** Supplier create/update/deactivate and PO terms exist; no full supplier framework-contract register established.
- **Inspected layer paths:** UI: `src/components/modules/ProcurementModule.tsx`; API: `src/routes/procurement-workflow.routes.ts`; businessRules: `src/procurement/receiving.service.ts`; persistence: `src/db/schema/procurement.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/procurement-matching-returns.db.spec.ts`.
- **Missing functionality / defect:** Contract version/dates/prices/renewal custody not provided by PO payment terms.
- **Required task:** Confirm contract scope; implement contract evidence/lifecycle only if required, preserving supplier history.
- **Dependencies / blockers:** D08, D15.
- **Measurable acceptance:** Inactive supplier cannot receive new unauthorized order; required contract prices/expiry enforced and old terms recoverable.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### PRC-003 — LPO issue

- **Module / requirement:** Procurement and inventory — Issue approved scoped LPOs with exact items, quantities, costs and authorized stationery.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations; S22: Existing versioned upload/layout/explicit activation/history; no separate stamp authority
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** Order calculation/status and buildPurchaseOrderDocument exist with actual common letterhead renderer.
- **Inspected layer paths:** UI: `src/components/modules/ProcurementModule.tsx`; API: `src/routes/procurement-workflow.routes.ts`; businessRules: `src/procurement/receiving.service.ts`; persistence: `src/db/schema/procurement.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/procurement-matching-returns.db.spec.ts`.
- **Missing functionality / defect:** Client signatory/layout and immutable issue policy acceptance missing; Reporting Centre navigation is still unavailable separately.
- **Required task:** Reaccept LPO lifecycle and issue/reissue against approved template/version rules.
- **Dependencies / blockers:** D08, D09, DOC-005.
- **Measurable acceptance:** Wrong state cannot issue official order; exact order totals/terms print; prior issued version preserved per approved policy.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### PRC-004 — Receiving and GRN

- **Module / requirement:** Procurement and inventory — Receive accepted LPO lines into correct stock lots with cost/expiry/GRN evidence.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 4.
- **Current implementation:** postGoodsReceivedNote records receiving/stock and costs; GRN PDF renderer exists, not merely a menu.
- **Inspected layer paths:** UI: `src/components/modules/ProcurementModule.tsx`; API: `src/routes/procurement-workflow.routes.ts`; businessRules: `src/procurement/receiving.service.ts`; persistence: `src/db/schema/procurement.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/procurement-matching-returns.db.spec.ts`.
- **Missing functionality / defect:** Fresh partial/over/damaged receiving→stock accounting→GRN acceptance not executed.
- **Required task:** Run partial receipt, rejected quantity, cost change and retry cases with scoped lots.
- **Dependencies / blockers:** D08, D06.
- **Measurable acceptance:** Received quantity/cost links order and lots once; over-receive policy enforced; printed GRN exactly matches posted receipt.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### PRC-005 — Supplier AP matching payment

- **Module / requirement:** Procurement and inventory — Match supplier invoice to order/GRN and settle payable with source-linked accounting.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** Critical / **UNVERIFIED**. **Roadmap phase:** 4.
- **Current implementation:** createSupplierInvoice/paySupplierInvoice and matching/assertPayable/overrideMatch exist; old missing-AP claim is obsolete.
- **Inspected layer paths:** UI: `src/components/modules/ProcurementModule.tsx`; API: `src/routes/procurement-workflow.routes.ts`; businessRules: `src/procurement/receiving.service.ts`; persistence: `src/db/schema/procurement.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/procurement-matching-returns.db.spec.ts`.
- **Missing functionality / defect:** Full real-browser supplier invoice→matching→approved variance→payment UAT and live terms evidence absent.
- **Required task:** Exercise quantities/prices, independent override, duplicate invoice/payment and closed period failure.
- **Dependencies / blockers:** D08, ACC-001.
- **Measurable acceptance:** Unapproved mismatch blocks payment; accepted AP and payment post once; supplier control and statement reconcile.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/procurement-matching-returns.spec.tsx`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### PRC-006 — Supplier returns/credits

- **Module / requirement:** Procurement and inventory — Handle supplier goods returns and credit notes without inventing patient refunds.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 4.
- **Current implementation:** returns.service.ts and inventory-accounting supplier-return/credit posting functions exist; fresh mock-DOM matching/returns checks pass.
- **Inspected layer paths:** UI: `src/components/modules/ProcurementModule.tsx`; API: `src/routes/procurement-workflow.routes.ts`; businessRules: `src/procurement/receiving.service.ts`; persistence: `src/db/schema/procurement.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/procurement-matching-returns.db.spec.ts`.
- **Missing functionality / defect:** Fresh multi-lot real return→stock→AP/clearing→GL verification absent.
- **Required task:** Run partial returns and credits after invoice/payment with exact original provenance.
- **Dependencies / blockers:** D08.
- **Measurable acceptance:** Return cannot exceed received/available quantities; credit links actual supplier invoice; stock/AP/GL reconcile and retry is idempotent.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/procurement-matching-returns.spec.tsx`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### INV-001 — Catalogue and units

- **Module / requirement:** Procurement and inventory — Maintain governed inventory item identity, units, batches, price and stock associations.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** Item/current unit, batches, reorder and selling-price management exist.
- **Inspected layer paths:** UI: `src/components/modules/InventoryModule.tsx`; API: `src/routes/inventory-control.routes.ts`; businessRules: `src/inventory/stock-control.service.ts`; persistence: `src/db/schema/inventory-control.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/inventory-stock-count.db.spec.ts`.
- **Missing functionality / defect:** Approved master units/conversions, source duplicate identities and opening physical reconciliation unavailable.
- **Required task:** Approve catalogue/units and reconcile starting lots/stock; define conversions if required.
- **Dependencies / blockers:** D06, D08.
- **Measurable acceptance:** No mixed-unit quantity total; lot/item quantities reconcile under approved unit policy; inactive/foreign items refused.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### INV-002 — Issues counts adjustments transfers

- **Module / requirement:** Procurement and inventory — Record authorized stock changes/counts/store transfers with reasons and correct facility totals.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** Stock-control appends movements transactionally; store transfer preserves facility quantity using recorded locations.
- **Inspected layer paths:** UI: `src/components/modules/InventoryModule.tsx`; API: `src/routes/inventory-control.routes.ts`; businessRules: `src/inventory/stock-control.service.ts`; persistence: `src/db/schema/inventory-control.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/inventory-stock-count.db.spec.ts`.
- **Missing functionality / defect:** Free-text stores are not a fully governed multi-store location ledger; movement history does not prove historical balances.
- **Required task:** Approve store identity/transfer/variance controls and test lot/item/movement consistency.
- **Dependencies / blockers:** D06, D08.
- **Measurable acceptance:** Concurrent issue cannot produce negative lot/item stock; transfer legs reconcile by approved store identity; count variance posts once.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### INV-003 — Expiry and reorder

- **Module / requirement:** Procurement and inventory — Provide correct unexpired FEFO, near-expiry and reorder visibility from actual inventory.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 4.
- **Current implementation:** Batch expiry, FEFO, reorder alert and report-expiry paths exist.
- **Inspected layer paths:** UI: `src/components/modules/InventoryModule.tsx`; API: `src/routes/inventory-control.routes.ts`; businessRules: `src/inventory/stock-control.service.ts`; persistence: `src/db/schema/inventory-control.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/inventory-stock-count.db.spec.ts`.
- **Missing functionality / defect:** No fresh large/scope/boundary/notification owner acceptance; threshold/timezone policy needs approval.
- **Required task:** Accept expired/today/future/inactive and low-stock scenarios under facility thresholds.
- **Dependencies / blockers:** D06.
- **Measurable acceptance:** Expired stock cannot dispense; expected scoped alerts equal source lots; unknown dates explicit not silently valid.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### INV-004 — Inventory valuation and GL

- **Module / requirement:** Procurement and inventory — Use approved cost/opening policy to reconcile valued receipts/issues/counts/returns and ledger.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** Critical / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** inventory-accounting.service.ts has activation/policy/valuation/allocations and atomic posting bridges.
- **Inspected layer paths:** UI: `src/components/modules/InventoryModule.tsx`; API: `src/routes/inventory-control.routes.ts`; businessRules: `src/inventory/stock-control.service.ts`; persistence: `src/db/schema/inventory-control.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/inventory-stock-count.db.spec.ts`.
- **Additional current source:** `src/inventory/inventory-accounting.service.ts`.
- **Missing functionality / defect:** Actual opening costs, capitalization/expense mappings, policy activation and every producer coverage not owner-accepted.
- **Required task:** Reconcile each producer including dialysis/ward use against lots, movement allocations and posted GL.
- **Dependencies / blockers:** D08, D06, ACC-001.
- **Measurable acceptance:** No unexplained stock quantity/value/GL gap; activation refuses inconsistent openings; unit cost snapshots do not follow later price edits.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### INV-005 — Ward/lab/dental consumption

- **Module / requirement:** Procurement and inventory — Trace included department consumables to actual clinical activity, not generic unlinked adjustments.
- **Provenance:** IMPLIED_WORKFLOW; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** Generic issues/counts and dialysis consumption exist; dental/ward/test-specific packs are not an adequate completed traceable consumption product.
- **Inspected layer paths:** UI: `src/components/modules/InventoryModule.tsx`; API: `src/routes/inventory-control.routes.ts`; businessRules: `src/inventory/stock-control.service.ts`; persistence: `src/db/schema/inventory-control.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/inventory-stock-count.db.spec.ts`.
- **Missing functionality / defect:** Clinical item mappings, wastage, returns and billable-versus-expense policies missing.
- **Required task:** Approve included department consumption models and integrate existing stock primitives at each clinical event.
- **Dependencies / blockers:** D03, D06, D08.
- **Measurable acceptance:** Each included use links patient/procedure/event and lot/quantity; no duplicate deduction; cancellation/refund/cost policy reconciles.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### AST-001 — Fixed asset lifecycle

- **Module / requirement:** Procurement and inventory — Maintain approved register, acquisitions, custodians/transfers, maintenance, impairment/revaluation and disposal.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** Fixed assets schema/service/routes/UI and ledger events exist.
- **Inspected layer paths:** UI: `src/components/modules/FixedAssetsModule.tsx`; API: `src/routes/fixed-assets.routes.ts`; businessRules: `src/assets/fixed-assets.service.ts`; persistence: `src/db/schema/assets.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/fixed-asset-depreciation.spec.ts`.
- **Missing functionality / defect:** Actual opening register/physical verification/capitalization/useful-life policies and receipt→asset handoff not established.
- **Required task:** Approve source register and accounting policy; implement missing approved receiving/capitalization handoff and verify lifecycle.
- **Dependencies / blockers:** D08, PRC-004.
- **Measurable acceptance:** Asset acquisition capitalizes once; transfer/custodian/disposal retain history; no same cost both expensed and capitalized.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### AST-002 — Depreciation calculation

- **Module / requirement:** Procurement and inventory — Calculate book depreciation with cent rounding, salvage bounds and final-period remainder under configured useful life.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** Medium / **COMPLETE**. **Roadmap phase:** 4.
- **Current implementation:** Current src/assets/depreciation.ts monthlyDepreciation uses integer cents; all 15 focused pure depreciation tests passed freshly.
- **Inspected layer paths:** UI: `src/components/modules/FixedAssetsModule.tsx`; API: `src/routes/fixed-assets.routes.ts`; businessRules: `src/assets/fixed-assets.service.ts`; persistence: `src/db/schema/assets.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/fixed-asset-depreciation.spec.ts`.
- **Additional current source:** `src/assets/depreciation.ts`.
- **Missing functionality / defect:** No gap against this narrow arithmetic contract; actual asset policies/tax/GL acceptance remain AST-001/ACC-005, not certified here.
- **Required task:** Preserve arithmetic tests; approve real asset inputs separately.
- **Dependencies / blockers:** None for this narrow contract; parent requirement remains separately scoped.
- **Measurable acceptance:** Configured depreciable base spread correctly; final period takes remainder without exceeding salvage; invalid negative/fully-depreciated inputs handled.
- **Verification:** Fresh src/tests/fixed-asset-depreciation.spec.ts (15/15); no database or legal-rate assertion Fresh selected tests: `src/tests/fixed-asset-depreciation.spec.ts`.
- **Synthetic sufficient?** Yes, only this narrowly specified pure contract. **Owner:** Finance policy owner.

### PLN-001 — Procurement planning

- **Module / requirement:** Planning and budgets — Maintain approved annual stationery, branding and uniform planning distinct from actual procurement.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S07: Official CSV identity, categories, arithmetic and unresolved source values; strict mode at that revision; S08: Subsequent explicit ZERO_FILL direction, 241 source rows, separate source-row identity and nonproduction acceptance
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** Scoped draft/version/approval planning workspace and monthly item/uniform arithmetic exist; eight sections, no second procurement system.
- **Inspected layer paths:** UI: `src/components/modules/planning/PlanningWorkspace.tsx`; API: `src/budget-planning/planning.routes.ts`; businessRules: `src/budget-planning/planning.service.ts`; persistence: `src/db/schema/planning.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/budget-planning.db.spec.ts`.
- **Missing functionality / defect:** Original workbook formulas/layouts, currency and final facility plan sign-off unavailable.
- **Required task:** Reconcile approved original version and accept planning create/edit/approve/export without operational side effects.
- **Dependencies / blockers:** D02, D08.
- **Measurable acceptance:** Approved plans immutable; totals reconcile exact source fixture; planning never creates stock/PO/expense/ledger entries automatically.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### PLN-002 — Source import provenance

- **Module / requirement:** Planning and budgets — Import official CSV/XLS/XLSX with explicit reviewed mapping/default policy and original-row identity.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S07: Official CSV identity, categories, arithmetic and unresolved source values; strict mode at that revision; S08: Subsequent explicit ZERO_FILL direction, 241 source rows, separate source-row identity and nonproduction acceptance; S20: Exact-file mapping hash and 232 rows; no implicit preview/import or source-value approval
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** CSV worker, strict/ZERO_FILL policies, reviewed hash/confirm and migration0096 source-row composite identity exist.
- **Inspected layer paths:** UI: `src/components/modules/planning/PlanningWorkspace.tsx`; API: `src/budget-planning/planning.routes.ts`; businessRules: `src/budget-planning/planning.service.ts`; persistence: `src/db/schema/planning.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/budget-planning.db.spec.ts`.
- **Missing functionality / defect:** Original CSVs unavailable now; 13 source-dependent checks skip; source defaulting is normalization, not verified original zero.
- **Required task:** Restore approved originals; reexecute 241-row import proof retaining raw/defaulted/source-row identity and approval.
- **Dependencies / blockers:** D02, D08.
- **Measurable acceptance:** 232 stationery+5 branding+4 uniforms retained including duplicates; all defaults disclosed; changed preview cannot confirm; no overwrite of approved records.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/syrona-reconciliation.spec.ts`, `src/tests/syrona-zero-fill.spec.ts`, `src/tests/stationery-mapping.spec.ts`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### PLN-003 — Import history and safe CRUD/reset

- **Module / requirement:** Planning and budgets — Provide scoped import destination/history, draft CRUD and explicit audited selective reset without erasing provenance.
- **Provenance:** IMPLIED_WORKFLOW; S08: Subsequent explicit ZERO_FILL direction, 241 source rows, separate source-row identity and nonproduction acceptance; S21: Explicit draft-only scoped reset; import bytes/audit/actuals retained
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 4.
- **Current implementation:** Import-results/destination/reset contracts and transactional services exist, with preserved original bytes/audit/issued reports and explicit confirmation.
- **Inspected layer paths:** UI: `src/components/modules/planning/PlanningWorkspace.tsx`; API: `src/budget-planning/planning.routes.ts`; businessRules: `src/budget-planning/planning.service.ts`; persistence: `src/db/schema/planning.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/budget-planning.db.spec.ts`.
- **Missing functionality / defect:** Fresh real DB reset/isolation/provenance and operator training acceptance not run; no reset authorized in this assessment.
- **Required task:** Run disposable draft-only preview/confirm/stale/failed-audit and preserved-history tests.
- **Dependencies / blockers:** D03, D05.
- **Measurable acceptance:** Preview writes nothing; reset affects selected eligible draft rows only; actual/purchases/import bytes/approved plans/audit preserved.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### PLN-004 — Procurement plan versus purchases

- **Module / requirement:** Planning and budgets — Attribute approved real procurement to source plan/version/line and compare planned versus actual spend.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S03: §4 SY01–SY18; module matrices and §11 recommendations; S07: Official CSV identity, categories, arithmetic and unresolved source values; strict mode at that revision
- **Priority / status:** High / **NOT IMPLEMENTED**. **Roadmap phase:** 4.
- **Current implementation:** reports.service.ts explicitly rejects ACTUAL with ACTUALS_NOT_AVAILABLE; PO/GRN/AP exist separately.
- **Inspected layer paths:** UI: `src/components/modules/planning/PlanningWorkspace.tsx`; API: `src/budget-planning/planning.routes.ts`; businessRules: `src/budget-planning/planning.service.ts`; persistence: `src/db/schema/planning.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/budget-planning.db.spec.ts`.
- **Additional current source:** `src/budget-planning/reports.service.ts`.
- **Missing functionality / defect:** Verified plan-item→purchase/receipt/actual attribution and variance definitions absent.
- **Required task:** Approve commitment/received/invoiced/paid bases and build explicit source links/variance, not simulated actuals.
- **Dependencies / blockers:** D08, PRC-005.
- **Measurable acceptance:** Each actual amount traces to accepted operational source; approved plan version preserved; variance ties to scope/date/currency without treating all plan quantities as purchases.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### FIN-001 — Annual financial budget

- **Module / requirement:** Planning and budgets — Maintain versioned annual income/expense financial projections separately from procurement and posted actuals.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S09: 75-line 13-department scenario, safe formulas, January profit, optional fees and actual separation
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** 0098 table/service and 75-line/13-department scenario exist; fresh 19 engine/export and 14 mock-DOM grid tests pass.
- **Inspected layer paths:** UI: `src/components/modules/planning/AnnualFinancialBudget.tsx`; API: `src/budget-planning/planning.routes.ts`; businessRules: `src/budget-planning/financial-budget.service.ts`; persistence: `drizzle/0098_annual_financial_budget.sql`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/financial-budget.spec.ts`.
- **Missing functionality / defect:** Original scenario/workbook ownership/formula decisions and real authenticated financial-budget browser acceptance not fresh; prior browser was isolated demo.
- **Required task:** Approve baseline anomalies/formulas and complete real DB/browser adoption/revision/export UAT.
- **Dependencies / blockers:** D02, D08.
- **Measurable acceptance:** Read preview creates no data; explicit adoption persists; stale/approved writes fail; independent expected twelve-month/annual totals match.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/financial-budget.spec.ts`, `src/tests/vitest/financial-budget-ui.spec.tsx`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### FIN-002 — Safe financial formula engine

- **Module / requirement:** Planning and budgets — Evaluate only inert approved arithmetic dependencies and refuse cycles/invalid references.
- **Provenance:** IMPLIED_WORKFLOW; S09: 75-line 13-department scenario, safe formulas, January profit, optional fees and actual separation
- **Priority / status:** Medium / **COMPLETE**. **Roadmap phase:** 4.
- **Current implementation:** Current engine validates bounded arithmetic, references/dependencies and fixed-point inputs; fresh financial-budget.spec.ts 19/19 includes injection/cycle/export checks.
- **Inspected layer paths:** UI: `src/components/modules/planning/AnnualFinancialBudget.tsx`; API: `src/budget-planning/planning.routes.ts`; businessRules: `src/budget-planning/financial-budget.service.ts`; persistence: `drizzle/0098_annual_financial_budget.sql`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/financial-budget.spec.ts`.
- **Additional current source:** `src/budget-planning/financial-budget.engine.ts`, `src/budget-planning/financial-budget.export.ts`.
- **Missing functionality / defect:** No gap against narrow safe-evaluation contract; underlying client formulas and ratios still require FIN-001 policy review.
- **Required task:** Retain unit contract and independent expected fixtures; do not execute arbitrary spreadsheet/JavaScript formulas.
- **Dependencies / blockers:** None for this narrow contract; parent requirement remains separately scoped.
- **Measurable acceptance:** Unsupported expressions/cycles/references block persistence; calculations and exported numeric cells agree; no executable workbook formulas generated.
- **Verification:** Fresh src/tests/financial-budget.spec.ts (19/19), engine/export source inspection; not real workbook validation Fresh selected tests: `src/tests/financial-budget.spec.ts`.
- **Synthetic sufficient?** Yes, only this narrowly specified pure contract. **Owner:** Finance model owner.

### FIN-003 — Financial budget versus actual

- **Module / requirement:** Planning and budgets — Compare approved financial budget lines with real posted financial performance and explain variances.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S03: §4 SY01–SY18; module matrices and §11 recommendations; S09: 75-line 13-department scenario, safe formulas, January profit, optional fees and actual separation
- **Priority / status:** High / **NOT IMPLEMENTED**. **Roadmap phase:** 4.
- **Current implementation:** Financial projection model exists, while no adequate approved model-line→posted GL/department actual mapping/variance engine found.
- **Inspected layer paths:** UI: `src/components/modules/planning/AnnualFinancialBudget.tsx`; API: `src/budget-planning/planning.routes.ts`; businessRules: `src/budget-planning/financial-budget.service.ts`; persistence: `drizzle/0098_annual_financial_budget.sql`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/financial-budget.spec.ts`.
- **Missing functionality / defect:** Operational source dates, recognition/classification, approved version, account/department mapping and unposted coverage undefined.
- **Required task:** Approve actual basis and mapping then implement linked budget/posted-actual/variance views in existing finance workspace.
- **Dependencies / blockers:** D08, FIN-001, ACC-003.
- **Measurable acceptance:** Selected approved version and same-period/facility/currency actuals reconcile to posted statements; unposted/unknown dimensions disclosed; forecasts never relabeled actual.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### EQT-001 — Partners equity statement

- **Module / requirement:** Accounting — Maintain reviewed partner equity statements, approval/revision/history and controlled carry-forward.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S10: 84-cell screenshot fixture; provisional formulas, no residual; live identity blocked
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** 0099 schema/service and 84-cell screenshot fixture exist; fresh 27 pure/export and 4 presentation checks pass; prior real browser/11 DB acceptance retained.
- **Inspected layer paths:** UI: `src/components/modules/accounting/PartnerEquityWorkspace.tsx`; API: `src/partner-equity/routes.ts`; businessRules: `src/partner-equity/service.ts`; persistence: `drizzle/0099_partner_equity_statements.sql`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/partner-equity.spec.ts`.
- **Missing functionality / defect:** Original Excel formulas/admission dates and live facility identity/finance approval remain unverified; provisional ownership method must stay provisional.
- **Required task:** Obtain owner formula/period/identity decisions; reaccept original cells/history/review/carry and exports without residual adjustments.
- **Dependencies / blockers:** D02, D08, D16.
- **Measurable acceptance:** All 84 source cells and unspecified values preserved; provisional formula warnings remain until approved; no balancing cent or overwrite of approved statements.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/partner-equity.spec.ts`, `src/tests/vitest/partner-equity-acceptance.spec.tsx`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### RPT-001 — Shared catalogue and query controls

- **Module / requirement:** Reporting — Preserve existing Reporting Centre and accurately expose real engine/workflow availability.
- **Provenance:** IMPLIED_WORKFLOW; S04: 144 current catalogue entries, compared with source catalogue and engine definitions; S05: Bounded recorded register, limitations and actual native download evidence
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 5.
- **Current implementation:** Source and fresh catalogue/matrix tests reconcile 144 entries: 24 subset labels/20 engines plus 4 document workflows, 116 unintegrated entries.
- **Inspected layer paths:** UI: `src/components/modules/report-centre/ReportWorkbench.tsx`; API: `src/routes/domains/report-centre.routes.ts`; businessRules: `src/reporting/report-centre.service.ts`; persistence: `src/reporting/report-centre.operational-queries.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/reporting-programme-matrix.spec.ts`.
- **Missing functionality / defect:** 144 visible labels are not accepted client reports; required shortlist/business definitions still unsigned.
- **Required task:** Confirm output shortlist and finish existing engine/workflow paths rather than rebuild reporting.
- **Dependencies / blockers:** D03, D10.
- **Measurable acceptance:** Each included label has tested source query/workflow; unsupported labels remain honest; catalogue and matrix counts match source.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/reporting-programme-matrix.spec.ts`, `src/tests/vitest/report-catalogue-integrity.spec.ts`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### RPT-002 — Filters scope and dates

- **Module / requirement:** Reporting — Apply server-validated relevant date/status/department/selector filters under authenticated facility scope.
- **Provenance:** IMPLIED_WORKFLOW; S04: 144 current catalogue entries, compared with source catalogue and engine definitions; S05: Bounded recorded register, limitations and actual native download evidence; S06: Signed files/portal/procedure consent/letterhead acceptance and remaining gaps
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 5.
- **Current implementation:** Shared definitions/auth/selection/query service validate dates and ownership; limited per-engine filters deliberately reject invented departments.
- **Inspected layer paths:** UI: `src/components/modules/report-centre/ReportWorkbench.tsx`; API: `src/routes/domains/report-centre.routes.ts`; businessRules: `src/reporting/report-centre.service.ts`; persistence: `src/reporting/report-centre.operational-queries.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/reporting-programme-matrix.spec.ts`.
- **Missing functionality / defect:** Fresh all-engine DB/permission/date acceptance not rerun; approved event-time definitions still needed for unavailable outputs.
- **Required task:** Retain shared filters and test all included engines against independent dated/cross-facility fixtures.
- **Dependencies / blockers:** D10.
- **Measurable acceptance:** Invalid/reversed/excessive dates fail; foreign selector/disabled module rejected; screen totals match exact filtered source.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/report-centre-ui.spec.tsx`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### RPT-003 — Exports and parity

- **Module / requirement:** Reporting — Export complete filtered results to CSV/XLSX/PDF with explicit unknowns and scoped permission.
- **Provenance:** IMPLIED_WORKFLOW; S04: 144 current catalogue entries, compared with source catalogue and engine definitions; S05: Bounded recorded register, limitations and actual native download evidence; S06: Signed files/portal/procedure consent/letterhead acceptance and remaining gaps
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 5.
- **Current implementation:** Shared export service and 1000-row refusal/real prior saved downloads exist; fresh CSV safety and mock-DOM workbench tests pass.
- **Inspected layer paths:** UI: `src/components/modules/report-centre/ReportWorkbench.tsx`; API: `src/routes/domains/report-centre.routes.ts`; businessRules: `src/reporting/report-centre.service.ts`; persistence: `src/reporting/report-centre.operational-queries.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/reporting-programme-matrix.spec.ts`.
- **Missing functionality / defect:** Not all client outputs/source definitions implemented; no new browser/native Excel or large/load acceptance in this assessment.
- **Required task:** Inspect all included saved files against source cells and scope under row-cap/empty/error cases.
- **Dependencies / blockers:** D10, D09.
- **Measurable acceptance:** Export is full filtered result not current screen page; over-limit request refuses rather than truncates; unknown values remain explicit; saved file values exact.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/report-centre-ui.spec.tsx`, `src/tests/vitest/report-centre-export.spec.ts`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### RPT-004 — Recorded stock movement boundary

- **Module / requirement:** Reporting — Keep recorded stock-movement register distinct from verified historical balances and valuation.
- **Provenance:** IMPLIED_WORKFLOW; S05: Bounded recorded register, limitations and actual native download evidence
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 5.
- **Current implementation:** Batch1 engine uses scoped movement predicates/same-facility item join and per-item prepagination net; 12 DB/32 browser/101 saved inspection checks are historical evidence at BASE.
- **Inspected layer paths:** UI: `src/components/modules/report-centre/ReportWorkbench.tsx`; API: `src/routes/domains/report-centre.routes.ts`; businessRules: `src/reporting/report-centre.service.ts`; persistence: `src/reporting/report-centre.operational-queries.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/reporting-programme-matrix.spec.ts`.
- **Missing functionality / defect:** No historical coverage/opening-closing/cost certification; current metadata is not immutable event-time identity.
- **Required task:** Preserve bounded acceptance; add broader stock reports only with approved provenance and costing rules.
- **Dependencies / blockers:** D08, D10.
- **Measurable acceptance:** Alpha/Beta signed nets remain separate by unit; bad linked metadata withheld; no false historical opening/closing/valuation total.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### BRD-001 — Existing facility letterhead

- **Module / requirement:** Reporting — Use existing scoped upload/layout/explicit activation/history renderer across required documents and PDF reports.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S06: Signed files/portal/procedure consent/letterhead acceptance and remaining gaps; S22: Existing versioned upload/layout/explicit activation/history; no separate stamp authority
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 5.
- **Current implementation:** Versioned letterhead service and common report PDF rendering exist; historical clinical/stock native downloads show active and no-template fallback.
- **Inspected layer paths:** UI: `src/components/modules/BrandingDocumentsPanel.tsx`; API: `src/branding/letterhead.routes.ts`; businessRules: `src/branding/letterhead.service.ts`; persistence: `src/db/schema/facility-branding.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/letterhead-branding.db.spec.ts`.
- **Missing functionality / defect:** Authorized client stationery/version/margins and required kind-by-kind current acceptance not established; no new live activation allowed here.
- **Required task:** Obtain approved asset and inspect two-facility A/B historical/fallback outputs through existing controls.
- **Dependencies / blockers:** D09, D16.
- **Measurable acceptance:** Upload stays draft; activation scoped and audited; no foreign/hardcoded stationery; multi-page exports readable and correct version policy applied.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### BRD-002 — Stamps/signature authority

- **Module / requirement:** Reporting — Distinguish decorative stationery/stamp artwork from authorized clinical/financial signature and issue approval.
- **Provenance:** EXTERNAL_DEPENDENCY; S03: §4 SY01–SY18; module matrices and §11 recommendations; S22: Existing versioned upload/layout/explicit activation/history; no separate stamp authority
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 5.
- **Current implementation:** Letterhead may include static stamp/signature art; signed file metadata records presence, not cryptographic authentication.
- **Inspected layer paths:** UI: `src/components/modules/BrandingDocumentsPanel.tsx`; API: `src/branding/letterhead.routes.ts`; businessRules: `src/branding/letterhead.service.ts`; persistence: `src/db/schema/facility-branding.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/letterhead-branding.db.spec.ts`.
- **Missing functionality / defect:** Client stamp custody, authorized signers, e-sign requirements and legal/clinical acceptance not supplied.
- **Required task:** Approve stamp/signature/issue policy and implement required controls within current documents.
- **Dependencies / blockers:** D05, D09.
- **Measurable acceptance:** Unauthorized actor cannot issue as signer; image upload never claims cryptographic authenticity; signer/reviewer/time/version recoverable.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### STA-001 — MOH official forms

- **Module / requirement:** Reporting — Produce required official MOH returns using approved form versions and indicator definitions.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S03: §4 SY01–SY18; module matrices and §11 recommendations; S24: Technical/regulatory self-assessment; not regulator approval or proven client scope
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 5.
- **Current implementation:** Local surveillance/correction exists; interop MOH705 endpoint explicitly returns501; report catalogue has no official engine.
- **Inspected layer paths:** UI: `src/components/modules/PublicHealthModule.tsx`; API: `src/routes/domains/interop.routes.ts`; businessRules: `src/public-health/surveillance.service.ts`; persistence: `src/db/schema/public-health.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/public-health-corrections.db.spec.ts`.
- **Missing functionality / defect:** Current official forms/age-sex bands/denominators/correction rules and client included forms not supplied; implementation still required after approval.
- **Required task:** Obtain official definitions/fixtures; implement agreed forms in existing reporting paths with independent validation.
- **Dependencies / blockers:** D10, D12.
- **Measurable acceptance:** Every included indicator matches official golden cases; corrected record counted once; PDF/XLSX format and facility/period accepted.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### STA-002 — KHIS/DHIS2 transmission

- **Module / requirement:** Integrations — Submit only authorized national indicator payloads and retain acknowledgment/rejection evidence.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S03: §4 SY01–SY18; module matrices and §11 recommendations; S24: Technical/regulatory self-assessment; not regulator approval or proven client scope
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 6.
- **Current implementation:** No adequate KHIS/DHIS2 national submission adapter found; local surveillance explicitly disclaims submission.
- **Inspected layer paths:** UI: `src/components/modules/PublicHealthModule.tsx`; API: `src/routes/domains/interop.routes.ts`; businessRules: `src/public-health/surveillance.service.ts`; persistence: `src/db/schema/public-health.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/public-health-corrections.db.spec.ts`.
- **Missing functionality / defect:** Authorized national contract/access/test environment and indicator approval absent.
- **Required task:** Confirm required transport and obtain onboarding, then implement/accept real authorized sandbox transmission.
- **Dependencies / blockers:** D12, STA-001.
- **Measurable acceptance:** Official sandbox accepts exact facility/period payload; correction/retry avoids duplicate totals; local save never labeled submitted.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### RPT-005 — Audit and management outputs

- **Module / requirement:** Reporting — Provide approved managerial/operational/audit reports without unrestricted raw audit/HR data exports.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S03: §4 SY01–SY18; module matrices and §11 recommendations; S04: 144 current catalogue entries, compared with source catalogue and engine definitions
- **Priority / status:** Medium / **PARTIAL**. **Roadmap phase:** 5.
- **Current implementation:** Restricted audit and operations APIs/dashboard source counters exist; many audit/HR/report outputs have no engine.
- **Inspected layer paths:** UI: `src/components/modules/report-centre/ReportWorkbench.tsx`; API: `src/routes/domains/report-centre.routes.ts`; businessRules: `src/reporting/report-centre.service.ts`; persistence: `src/reporting/report-centre.operational-queries.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/reporting-programme-matrix.spec.ts`.
- **Missing functionality / defect:** Management KPI definitions/timezone, privacy/redaction and source-attributed summaries not agreed or complete.
- **Required task:** Define included managerial decisions and outputs; implement scoped minimal datasets and independently verified totals.
- **Dependencies / blockers:** D03, D05, D10.
- **Measurable acceptance:** Agreed KPIs reconcile to persisted source/date; unauthorized staff cannot export raw secrets/clinical notes/payroll; empty/error never fabricated zero.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### INT-001 — M-Pesa Daraja

- **Module / requirement:** Integrations — Complete authorized M-Pesa request/status/callback settlement and recovery without simulated payments.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S17: Mocked Daraja requests; callback settlement unavailable, manual/posted accounting separate
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 6.
- **Current implementation:** Daraja request/status boundary and mock tests exist; webhook settlement refuses unsupported verification; earlier test orchestration is not production callback worker.
- **Inspected layer paths:** UI: `src/components/modules/InteroperabilityModule.tsx`; API: `src/payment-hub/routes.ts`; businessRules: `src/payment-hub/adapters/banks.ts`; persistence: `src/db/schema/payment-hub.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/bank-sandbox-auth.spec.ts`.
- **Missing functionality / defect:** Provider-approved authenticity contract, credentials/callback endpoint/UAT plus application callback/atomic recovery implementation missing.
- **Required task:** Confirm bank-only scope vs M-Pesa; obtain provider contract and implement missing verified settlement/recovery behind existing hub.
- **Dependencies / blockers:** D11, D13, D08.
- **Measurable acceptance:** Authorized sandbox success/cancel/timeout/duplicate callback cases pass; only authenticated matching outcome yields one receipt and reviewed posting; unknown outcome never blindly retried.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### INT-002 — KCB Buni and Equity Jenga

- **Module / requirement:** Integrations — Deliver only contracted bank transaction capabilities, not authentication-only status as full integration.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S11: Manual declaration, independent verification/settlement; provider limitations
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 6.
- **Current implementation:** Banks adapters advertise HEALTH only; fresh 13 mocked transport tests verify token-check boundaries, no financial capabilities.
- **Inspected layer paths:** UI: `src/components/modules/InteroperabilityModule.tsx`; API: `src/payment-hub/routes.ts`; businessRules: `src/payment-hub/adapters/banks.ts`; persistence: `src/db/schema/payment-hub.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/bank-sandbox-auth.spec.ts`.
- **Missing functionality / defect:** Approved account/statement/transfer/callback specs, credentials and actual transaction adapters/UAT missing.
- **Required task:** Obtain per-bank capability contracts; implement and accept each separately if included.
- **Dependencies / blockers:** D11.
- **Measurable acceptance:** Each required bank operation succeeds under authorized sandbox with references/replay/unknown-state tests; token check never labeled account/payment proof.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/bank-sandbox-auth.spec.ts`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### INT-003 — NCBA and Co-operative Bank

- **Module / requirement:** Integrations — Provide contracted NCBA/Co-operative capability or clearly accepted manual evidence fallback.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S11: Manual declaration, independent verification/settlement; provider limitations
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 6.
- **Current implementation:** NCBA descriptor has no implemented capabilities; manual statement/verification workflow exists; no supported Co-operative transaction adapter established.
- **Inspected layer paths:** UI: `src/components/modules/InteroperabilityModule.tsx`; API: `src/payment-hub/routes.ts`; businessRules: `src/payment-hub/adapters/banks.ts`; persistence: `src/db/schema/payment-hub.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/bank-sandbox-auth.spec.ts`.
- **Missing functionality / defect:** Official interfaces/credentials/provider approvals and operation implementations missing.
- **Required task:** Client signs required operations/manual interim scope; obtain contracts and implement adapters only from official specs.
- **Dependencies / blockers:** D11.
- **Measurable acceptance:** Each included transaction has authorized provider evidence and receipt/reconciliation parity; manual evidence labeled manual.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### INS-001 — Local payer workflows

- **Module / requirement:** Integrations — Prepare controlled eligibility/preauth/claims and reconcile remittances to independently recorded receipts.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations; S18: Separate payer contracts/manual workflows and onboarding
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 3.
- **Current implementation:** Local private/SHA claims, invoice gate, clinical evidence preview and remittance linkage exist with separate payer boundary.
- **Inspected layer paths:** UI: `src/components/modules/InsuranceClaimsModule.tsx`; API: `src/routes/private-insurance.routes.ts`; businessRules: `src/insurance/claims/private-claims.service.ts`; persistence: `src/db/schema/private-insurance.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/private-insurance.db.spec.ts`.
- **Missing functionality / defect:** Claim evidence preview explicitly does not attach/transmit external docs; actual tariff/benefit/authorization rules and staff UAT lacking.
- **Required task:** Approve payer manual workflow and complete claim evidence custody/attachment where required.
- **Dependencies / blockers:** D08, D13.
- **Measurable acceptance:** Finalized patient/invoice only; verified evidence explicitly selected; remittance cannot manufacture receipt or reuse payment; unknown external state honest.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### INS-002 — Britam direct/gateway

- **Module / requirement:** Integrations — Connect Britam using its approved direct or explicitly authorized gateway contract.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations; S18: Separate payer contracts/manual workflows and onboarding
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 6.
- **Current implementation:** britam.adapter.ts always returns unsupported/AWAITING_DOCUMENTATION for direct operations with detailed onboarding checklist.
- **Inspected layer paths:** UI: `src/components/modules/InsuranceClaimsModule.tsx`; API: `src/routes/private-insurance.routes.ts`; businessRules: `src/insurance/claims/private-claims.service.ts`; persistence: `src/db/schema/private-insurance.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/private-insurance.db.spec.ts`.
- **Missing functionality / defect:** Official Britam specification, provider IDs, credentials, routing agreement and real operation implementation/UAT absent.
- **Required task:** Obtain Britam written contract/routing and tariff/benefit rules; implement approved operations, not guessed endpoints.
- **Dependencies / blockers:** D13.
- **Measurable acceptance:** Authorized sandbox eligibility/preauth/submit/status/remit meet contract and retain references; gateway cannot masquerade as direct; manual decisions clearly labeled.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### INS-003 — Other private insurers

- **Module / requirement:** Integrations — Accept each included PACIS/CIC/other insurer independently.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S18: Separate payer contracts/manual workflows and onboarding; S23: Earlier cross-module achievements/gaps; superseded where later source differs
- **Priority / status:** Medium / **BLOCKED**. **Roadmap phase:** 6.
- **Current implementation:** Distinct registry/adapters and local insurer records exist; shared hub is governance, not universal provider connectivity.
- **Inspected layer paths:** UI: `src/components/modules/InsuranceClaimsModule.tsx`; API: `src/routes/private-insurance.routes.ts`; businessRules: `src/insurance/claims/private-claims.service.ts`; persistence: `src/db/schema/private-insurance.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/private-insurance.db.spec.ts`.
- **Missing functionality / defect:** Per-payer signed inclusion, specs/credentials/tariffs/benefits and independent acceptance absent.
- **Required task:** Identify contracted insurers and obtain operation-specific onboarding; retain supported manual paths.
- **Dependencies / blockers:** D13, D03.
- **Measurable acceptance:** Each included insurer passes its own approved cases; unsupported capabilities remain disabled and history readable.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### INS-004 — SHA/AfyaLink/DHA

- **Module / requirement:** Integrations — Complete approved SHA eClaims/eligibility/preauth/remittance and national exchange capabilities separately.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations; S23: Earlier cross-module achievements/gaps; superseded where later source differs
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 6.
- **Current implementation:** Local SHA workflows and HIE/FHIR/SHR boundaries exist; external calls/callback verification have explicit501/unavailable paths.
- **Inspected layer paths:** UI: `src/components/modules/InsuranceClaimsModule.tsx`; API: `src/routes/private-insurance.routes.ts`; businessRules: `src/insurance/claims/private-claims.service.ts`; persistence: `src/db/schema/private-insurance.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/private-insurance.db.spec.ts`.
- **Missing functionality / defect:** Provider specification/identities, authorization/consent scopes, certificates/credentials and conformance acceptance absent; code operations still incomplete.
- **Required task:** Agree exact SHA vs AfyaLink vs SHR operations; implement contract gaps and authorized sandbox tests, never treating mock as national acceptance.
- **Dependencies / blockers:** D12, D13, D05.
- **Measurable acceptance:** Each contracted operation has official acknowledgment and secure callback/idempotency/consent handling; no mock claim can settle against real receipt.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### INT-004 — Notifications

- **Module / requirement:** Integrations — Send approved SMS/email reminders/invitations and report actual delivery/failure.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S23: Earlier cross-module achievements/gaps; superseded where later source differs
- **Priority / status:** Medium / **BLOCKED**. **Roadmap phase:** 6.
- **Current implementation:** notification-provider.ts default UnconfiguredProvider has no HTTP client; environment variables alone do not install transport. In-app inbox exists.
- **Inspected layer paths:** UI: `src/components/modules/InteroperabilityModule.tsx`; API: `src/payment-hub/routes.ts`; businessRules: `src/payment-hub/adapters/banks.ts`; persistence: `src/db/schema/payment-hub.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/bank-sandbox-auth.spec.ts`.
- **Missing functionality / defect:** Gateway contract/sender/credentials and actual transport/delivery/retry implementation missing.
- **Required task:** Choose authorized channel/provider and privacy templates; implement transport and outcome tracking.
- **Dependencies / blockers:** D14, D05.
- **Measurable acceptance:** No provider means NOT_CONFIGURED; actual sandbox delivery reference/status recorded; retries avoid duplicate sensitive messages.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### INT-005 — WHO and external exchange

- **Module / requirement:** Integrations — Secure required external terminology/FHIR exchange without exporting stale or unauthorized clinical context.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S23: Earlier cross-module achievements/gaps; superseded where later source differs; S24: Technical/regulatory self-assessment; not regulator approval or proven client scope
- **Priority / status:** Medium / **PARTIAL**. **Roadmap phase:** 6.
- **Current implementation:** WHO boundary, FHIR/clinical exchange and context-safe UI tests exist; interface presence is not external conformance.
- **Inspected layer paths:** UI: `src/components/modules/InteroperabilityModule.tsx`; API: `src/payment-hub/routes.ts`; businessRules: `src/payment-hub/adapters/banks.ts`; persistence: `src/db/schema/payment-hub.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/bank-sandbox-auth.spec.ts`.
- **Missing functionality / defect:** Signed required resources/consent/terminology release/partner acceptance not established.
- **Required task:** Confirm included interfaces and complete each approved read/write contract with context/isolation tests.
- **Dependencies / blockers:** D05, D07, D12.
- **Measurable acceptance:** Wrong patient/facility late response never displayed/exported; approved exchange independently validates profile/terminology/consent.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### HR-001 — Employee/attendance/leave

- **Module / requirement:** Workforce — Maintain required HR employees, departments, roster, attendance and leave with dedicated privacy controls.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S03: §4 SY01–SY18; module matrices and §11 recommendations; S12: Effective-dated statutory versions, configured chart, test-only readiness
- **Priority / status:** Medium / **UNVERIFIED**. **Roadmap phase:** 4.
- **Current implementation:** Workforce schema/services/routes and UI contain persisted employees, shifts/roster/attendance and leave decisions.
- **Inspected layer paths:** UI: `src/components/modules/PayrollModule.tsx`; API: `src/routes/workforce.routes.ts`; businessRules: `src/workforce/workforce.service.ts`; persistence: `src/db/schema/workforce.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/workforce-payroll-calculator.spec.ts`.
- **Missing functionality / defect:** Actual client HR inclusion/privacy roles, policy data and fresh staff UAT missing.
- **Required task:** Confirm scope and run realistic employee lifecycle/leave/roster rules under approved dedicated grants.
- **Dependencies / blockers:** D03, D05.
- **Measurable acceptance:** Restricted staff cannot retrieve payroll/bank details; attendance/leave balances persist and respect approved dates/policy.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### HR-002 — Payroll and posting

- **Module / requirement:** Workforce — Calculate/review/independently approve/finalize payroll and post actual liabilities under approved chart/rules.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S12: Effective-dated statutory versions, configured chart, test-only readiness
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** Payroll calculator/versioned snapshots/GL and readiness checks exist; fresh 21 calculator tests use configured synthetic rules.
- **Inspected layer paths:** UI: `src/components/modules/PayrollModule.tsx`; API: `src/routes/workforce.routes.ts`; businessRules: `src/workforce/workforce.service.ts`; persistence: `src/db/schema/workforce.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/workforce-payroll-calculator.spec.ts`.
- **Missing functionality / defect:** No actual payroll chart/statutory policy/employee inputs or professional payroll acceptance; app deliberately productionReady:false.
- **Required task:** Configure and review approved inputs; run full payroll-period UAT including wrong maps, retroactive rules, independent actors and payment separation.
- **Dependencies / blockers:** D07, D08.
- **Measurable acceptance:** One reviewed payslip per employee/period; wrong/missing rule/map blocks; salary liability is not salary payment; final snapshot immutable.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/workforce-payroll-calculator.spec.ts`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### HR-003 — Statutory payroll outputs

- **Module / requirement:** Workforce — Use approved effective PAYE/NSSF/SHIF/AHL rules and accepted P9/P10/required outputs.
- **Provenance:** EXTERNAL_DEPENDENCY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S12: Effective-dated statutory versions, configured chart, test-only readiness
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 5.
- **Current implementation:** Effective-dated source verification and gated extracts exist; internal extracts are not filings, synthetic source attestation not authority validation.
- **Inspected layer paths:** UI: `src/components/modules/PayrollModule.tsx`; API: `src/routes/workforce.routes.ts`; businessRules: `src/workforce/workforce.service.ts`; persistence: `src/db/schema/workforce.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/workforce-payroll-calculator.spec.ts`.
- **Missing functionality / defect:** Current authoritative rate/form versions, professional review, approved filing/remittance and bank output specs unavailable.
- **Required task:** Obtain current official sources and specialist sign-off; implement any unsupported calculation/form cases and authorized filing integrations only if required.
- **Dependencies / blockers:** D07.
- **Measurable acceptance:** Whole period/pay date covered uniquely; approved golden employee cases exact; document forms/version accepted; filing/payment never inferred.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### OPS-001 — Green release baseline

- **Module / requirement:** Platform and production — Restore a reproducible passing release candidate without weakening safeguards.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations; S16: HOLD, target/permission/backup/currency/letterhead and migration approval gates
- **Priority / status:** Critical / **DEFECTIVE**. **Roadmap phase:** 1.
- **Current implementation:** GitHub run 43678187584 at BASE: coverage/database/Docker bootstrap failed, static/build/format/audit succeeded. Fresh migration spec reproduces Guarded Ddl on 0095.
- **Inspected layer paths:** UI: `docs/deployment/operations-runbook.md`; API: `src/routes/operations.routes.ts`; businessRules: `scripts/backup/backup-lib.mjs`; persistence: `drizzle/meta/_journal.json`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/backup-lib.spec.ts`.
- **Missing functionality / defect:** Release is not green; download of detailed CI logs blocked by network host; root causes of all three failed jobs not determined.
- **Required task:** Retrieve complete CI artifacts and reproduce required DB/coverage/bootstrap; resolve reviewed migration-governance conflict without rewriting applied history or weakening tests.
- **Dependencies / blockers:** D15.
- **Measurable acceptance:** Same candidate passes every required CI gate; all required attested DB specs execute without unintended skips; no historical migration replay/checksum fabrication.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/migrations.spec.ts`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Engineering release owner.

### OPS-002 — Current migration/upgrade proof

- **Module / requirement:** Platform and production — Verify fresh install and approved upgrade/drift/recovery for the current 101-migration source chain.
- **Provenance:** IMPLIED_WORKFLOW; S16: HOLD, target/permission/backup/currency/letterhead and migration approval gates
- **Priority / status:** Critical / **UNVERIFIED**. **Roadmap phase:** 7.
- **Current implementation:** 101 SQL migrations and101 journal entries present; file/journal/timestamp safety tests pass except guarded DDL. No DB connected this assessment.
- **Inspected layer paths:** UI: `docs/deployment/operations-runbook.md`; API: `src/routes/operations.routes.ts`; businessRules: `scripts/backup/backup-lib.mjs`; persistence: `drizzle/meta/_journal.json`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/backup-lib.spec.ts`.
- **Missing functionality / defect:** Applied schema/hash/privilege state of any deployed target unknown; historical fresh101 migration run not upgrade proof.
- **Required task:** Reproduce disposable fresh and previous-version upgrades, explicit pending-set review and schema contract/downgrade recovery plan.
- **Dependencies / blockers:** OPS-001, D15.
- **Measurable acceptance:** Expected columns/constraints/triggers and hashes agree; partial/hash-drift state refuses unsafe replay; deployment only under separate owner authorization.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/migrations.spec.ts`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** DBA and release owner.

### OPS-003 — Backup restoration

- **Module / requirement:** Platform and production — Prove encrypted offsite backup/recovery including binary documents and retained audit history.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S03: §4 SY01–SY18; module matrices and §11 recommendations; S19: Encrypted backup tools; old 230-table drill is not current schema/host restoration proof
- **Priority / status:** Critical / **PARTIAL**. **Roadmap phase:** 7.
- **Current implementation:** Backup library/runbooks and fresh16 pure encryption/retention/tamper tests exist; old230-table restore is historical only.
- **Inspected layer paths:** UI: `docs/deployment/operations-runbook.md`; API: `src/routes/operations.routes.ts`; businessRules: `scripts/backup/backup-lib.mjs`; persistence: `drizzle/meta/_journal.json`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/backup-lib.spec.ts`.
- **Missing functionality / defect:** Current101-schema restoration with bytea/immutable guards, off-host restore, separated keys and agreed RPO/RTO not proven here; old audit reported restore concerns.
- **Required task:** Drill both supported backup paths as appropriate against a fresh disposable target; witness host/offsite recovery using approved runbook.
- **Dependencies / blockers:** D15, D04.
- **Measurable acceptance:** Exact source/restore row hashes and uploaded document bytes match; audit immutability preserved; key recovery and RPO/RTO achieved with evidence.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: `src/tests/vitest/backup-lib.spec.ts`.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Operations/DBA and data controller.

### OPS-004 — Secure deployment

- **Module / requirement:** Platform and production — Deploy the approved build with HTTPS, safe configuration, storage, rollback and verified revision.
- **Provenance:** EXTERNAL_DEPENDENCY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S16: HOLD, target/permission/backup/currency/letterhead and migration approval gates
- **Priority / status:** Critical / **BLOCKED**. **Roadmap phase:** 7.
- **Current implementation:** Deployment scripts/Docker/cPanel guides exist; latest CI production build succeeds, not a deployed host observation.
- **Inspected layer paths:** UI: `docs/deployment/operations-runbook.md`; API: `src/routes/operations.routes.ts`; businessRules: `scripts/backup/backup-lib.mjs`; persistence: `drizzle/meta/_journal.json`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/backup-lib.spec.ts`.
- **Missing functionality / defect:** Authorized hosting target/TLS/proxy/secrets/storage/migration window and owner approval not supplied.
- **Required task:** Obtain approved staging/host context; rehearse deploy/upgrade/rollback and verify runtime/storage/security controls.
- **Dependencies / blockers:** D15, OPS-001, OPS-003.
- **Measurable acceptance:** Deployed revision identified; health/readiness plus authorized journeys pass; secure TLS/origin/proxy and backups confirmed; no production changes by this assessment.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Host and release owner.

### OPS-005 — Monitoring and errors

- **Module / requirement:** Platform and production — Provide actionable logs/metrics/alerts and owners for clinical/billing/integration/recovery failures.
- **Provenance:** TECHNICAL_RECOMMENDATION; S03: §4 SY01–SY18; module matrices and §11 recommendations; S19: Encrypted backup tools; old 230-table drill is not current schema/host restoration proof
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 7.
- **Current implementation:** Health/ready/ops/status, structured logging and in-app notifications exist.
- **Inspected layer paths:** UI: `docs/deployment/operations-runbook.md`; API: `src/routes/operations.routes.ts`; businessRules: `scripts/backup/backup-lib.mjs`; persistence: `drizzle/meta/_journal.json`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/backup-lib.spec.ts`.
- **Missing functionality / defect:** No proven off-host actionable paging, alert acknowledgment, operational SLOs or complete error sanitization.
- **Required task:** Approve SLO/alert/on-call policy; implement required sinks/metrics and rehearse faults.
- **Dependencies / blockers:** D15, D04.
- **Measurable acceptance:** Database/queue/unpriced/outbox/backup failure raises actionable scoped alert; owner receives/acknowledges; logs omit secrets and patient payloads.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Operations owner.

### OPS-006 — Performance/reliability

- **Module / requirement:** Platform and production — Meet agreed load, availability and recovery targets without silently dropping records or jobs.
- **Provenance:** TECHNICAL_RECOMMENDATION; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 7.
- **Current implementation:** Bounded selectors/reports and service retry patterns exist; historical frontend bundle size warnings remain leads.
- **Inspected layer paths:** UI: `docs/deployment/operations-runbook.md`; API: `src/routes/operations.routes.ts`; businessRules: `scripts/backup/backup-lib.mjs`; persistence: `drizzle/meta/_journal.json`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/backup-lib.spec.ts`.
- **Missing functionality / defect:** No client workload/SLO, production-like load/soak/concurrency or scale acceptance evidence.
- **Required task:** Agree expected users/patients/jobs/data volumes; measure critical journeys and failure recovery on safe staging.
- **Dependencies / blockers:** D15.
- **Measurable acceptance:** Agreed p95/error/throughput and recovery targets met; jobs converge after failure; no skipped/truncated business records.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Operations and clinical/finance owners.

### OPS-007 — Responsive/mobile accessibility

- **Module / requirement:** Platform and production — Accept critical workflows on actual client desktop/mobile devices, printers and assistive needs.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S03: §4 SY01–SY18; module matrices and §11 recommendations; S10: 84-cell screenshot fixture; provisional formulas, no residual; live identity blocked
- **Priority / status:** Medium / **PARTIAL**. **Roadmap phase:** 7.
- **Current implementation:** Prior planning/equity mobile screenshots and responsive components exist; complex tables intentionally scroll.
- **Inspected layer paths:** UI: `docs/deployment/operations-runbook.md`; API: `src/routes/operations.routes.ts`; businessRules: `scripts/backup/backup-lib.mjs`; persistence: `drizzle/meta/_journal.json`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/backup-lib.spec.ts`.
- **Missing functionality / defect:** Whole clinical/finance/mobile/keyboard/browser/printer acceptance not demonstrated.
- **Required task:** Agree supported devices/browsers/accessibility needs; test included complete journeys, critical dialogs and printed outputs.
- **Dependencies / blockers:** D03, D09, D15.
- **Measurable acceptance:** No inaccessible required action or hidden wrong-patient identity at approved widths; keyboard/error states and client printers usable.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client role representatives.

### OPS-008 — Onboarding documentation and final UAT

- **Module / requirement:** Platform and production — Handover approved configuration, training, support, incident/recovery plans and signed role-based acceptance.
- **Provenance:** EXTERNAL_DEPENDENCY; S01: Master System Completion Assessment: sections 1–12; audit topics are not proof of original contract scope; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 7.
- **Current implementation:** README, runbooks and many task acceptance records exist; no signed complete Syrona acceptance pack.
- **Inspected layer paths:** UI: `docs/deployment/operations-runbook.md`; API: `src/routes/operations.routes.ts`; businessRules: `scripts/backup/backup-lib.mjs`; persistence: `drizzle/meta/_journal.json`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/backup-lib.spec.ts`.
- **Missing functionality / defect:** Named owners/support/training and single agreed requirement/test/deployment baseline missing.
- **Required task:** Reconcile this register with original signed scope, close required items, document explicit contractual deferrals and witness final UAT/handover.
- **Dependencies / blockers:** D01, D03, D15.
- **Measurable acceptance:** Clinical/pharmacy/lab/finance/procurement/admin/security sign same revision and evidence pack; all required critical/high gaps closed or formally contracted out.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client sponsor and all domain leads.

### OPT-001 — Advanced automation

- **Module / requirement:** Optional enhancements — Consider advanced bank matching, forecasting and scheduled report distribution only after agreed core acceptance.
- **Provenance:** OPTIONAL_ENHANCEMENT; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** Low / **NOT IMPLEMENTED**. **Roadmap phase:** 7.
- **Current implementation:** Exact-match suggestions exist; no approved advanced forecast/scheduled-distribution product established.
- **Inspected layer paths:** UI: `src/components/modules/report-centre/ReportWorkbench.tsx`; API: `src/routes/domains/report-centre.routes.ts`; businessRules: `src/reporting/report-centre.service.ts`; persistence: `src/reporting/report-centre.operational-queries.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/reporting-programme-matrix.spec.ts`.
- **Missing functionality / defect:** Not an authenticated original client requirement; optional scope must not prevent or inflate contracted completion.
- **Required task:** Seek separate change approval only if desired; do not build as part of this assessment.
- **Dependencies / blockers:** D03.
- **Measurable acceptance:** Signed optional change scope exists before work; projections stay labeled; scheduled recipients authorized and audited.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client sponsor.

### PAT-004 — Duplicate identity policy

- **Module / requirement:** Core HMIS — Detect likely duplicate patient identities and apply an approved audited resolution policy.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** Server MRN uniqueness and normalized identifiers/directory search exist; unique MRN does not prevent two records for the same person.
- **Inspected layer paths:** UI: `src/components/modules/PatientRegistrationModule.tsx`; API: `src/routes/domains/patients.routes.ts`; businessRules: `src/db/queries/patients.ts`; persistence: `src/db/schema/patients.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/patient-mrn-allocation.db.spec.ts`.
- **Missing functionality / defect:** No complete client-approved cross-facility duplicate detection/merge policy or validated legacy resolution established.
- **Required task:** Define duplicate warning/block/merge and sensitive-identity policy; implement any missing audited resolution without losing links.
- **Dependencies / blockers:** D05, D03.
- **Measurable acceptance:** Known duplicate fixtures flagged; legitimate shared contacts/minors not wrongly merged; any approved merge preserves all clinical/financial history and audit.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### OPD-004 — Referrals and cross-facility care

- **Module / requirement:** Core HMIS — Trace referral state, authorization and patient/encounter identity across permitted care facilities.
- **Provenance:** IMPLIED_WORKFLOW; S03: §4 SY01–SY18; module matrices and §11 recommendations; S23: Earlier cross-module achievements/gaps; superseded where later source differs
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** Referral schema and exchange boundaries exist; claim evidence preview notes referrals have no direct encounter link and require relevance review.
- **Inspected layer paths:** UI: `src/components/modules/OutpatientModule.tsx`; API: `src/routes/domains/encounters.routes.ts`; businessRules: `src/db/queries/encounters.ts`; persistence: `src/db/schema/clinical.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/outpatient-safety-ui.spec.tsx`.
- **Missing functionality / defect:** Agreed cross-facility care authorization, referral encounter linkage and receiving/completion UAT absent.
- **Required task:** Approve care/referral data-sharing policy and validate or complete missing source links.
- **Dependencies / blockers:** D05, D03.
- **Measurable acceptance:** Unauthorized facility cannot access referral records; accepting facility receives correct consented patient/context; referral not automatically completed or billed.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### SEC-008 — Privacy and retention governance

- **Module / requirement:** Security and access — Approve responsible data-processing roles, privacy impact/retention/subject-access and incident procedures.
- **Provenance:** TECHNICAL_RECOMMENDATION; S24: Technical/regulatory self-assessment; not regulator approval or proven client scope; S27: ODPC/DPIA/retention and subject-access organizational evidence; historical assessment not legal determination
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 1.
- **Current implementation:** Privacy/DPIA draft and self-assessment exist; signed-file immutability and portal correction/access functions are real controls, not approved legal policy.
- **Inspected layer paths:** UI: `src/components/LoginScreen.tsx`; API: `src/auth/auth.routes.ts`; businessRules: `src/auth/auth.service.ts`; persistence: `src/db/schema/auth.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/authorization-middleware.spec.ts`.
- **Additional current source:** `docs/dha-audit/DPIA_DRAFT.md`, `docs/dha-audit/SECURITY_PRIVACY_GAP_REGISTER.md`.
- **Missing functionality / defect:** Reviewed DPIA, applicable registration/agreements, retention/legal-hold and formal subject-access process evidence unavailable.
- **Required task:** Data controller/legal specialists determine applicable obligations and approve operational policy; implement any software gaps without destructive default deletion.
- **Dependencies / blockers:** D04, D05, D15.
- **Measurable acceptance:** Approved responsible entities and policies documented securely; sample subject-access/retention/legal-hold cases follow authorized procedure; no invented regulatory certification.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Data controller and qualified legal/privacy owners.

### IPD-004 — Ward treatment/eMAR

- **Module / requirement:** Core HMIS — Provide approved administered/omitted/refused medicine and ward treatment records if included.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S03: §4 SY01–SY18; module matrices and §11 recommendations; S26: Remaining clinical eMAR, code provenance and legacy missing-value risks; old findings may now be fixed
- **Priority / status:** High / **NOT IMPLEMENTED**. **Roadmap phase:** 2.
- **Current implementation:** Nursing notes/vitals, prescriptions and dispensations exist; no adequate dedicated medication-administration/treatment-chart event lifecycle found.
- **Inspected layer paths:** UI: `src/components/modules/InpatientModule.tsx`; API: `src/routes/inpatient.routes.ts`; businessRules: `src/inpatient/ward-bed.service.ts`; persistence: `src/db/schema/inpatient.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/inpatient-bed-billing.db.spec.ts`.
- **Missing functionality / defect:** Dispensed is not administered; dose/time/actor/omission/countersignature and return custody rules not established.
- **Required task:** Confirm ward eMAR inclusion; build approved administration events linked to actual orders and clinical staff, reusing existing patient/stock services.
- **Dependencies / blockers:** D03, D06, D05.
- **Measurable acceptance:** Ordered/dispensed/administered quantities remain distinct; late/missed/refused/held doses traceable; correction preserves actor/time/history.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### RAD-004 — Imaging calendar and viewing

- **Module / requirement:** Core HMIS — Provide required radiology scheduling and secure image access beyond a transcribed text report.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S03: §4 SY01–SY18; module matrices and §11 recommendations
- **Priority / status:** Medium / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** RadiologyModule explicitly supports requests/text reports and disclaims PACS connection/DICOM study presence; no adequate resource calendar/approved image viewer integration established.
- **Inspected layer paths:** UI: `src/components/modules/RadiologyModule.tsx`; API: `src/routes/radiology.routes.ts`; businessRules: `src/documents/patient-documents.service.ts`; persistence: `drizzle/0100_patient_signed_documents.sql`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/patient-signed-documents.db.spec.ts`.
- **Missing functionality / defect:** Resource/appointment conflict rules and PACS/vendor scope/access missing if required.
- **Required task:** Client decides calendar/image scope; integrate approved scheduling/viewing contract, not arbitrary public links.
- **Dependencies / blockers:** D03, D06, D12.
- **Measurable acceptance:** Required study slot conflicts controlled; images accessible only to scoped authorized users; report/image identity exact and unavailable images explicit.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### SPC-003 — Emergency/casualty

- **Module / requirement:** Core HMIS — Complete the included emergency triage/escalation/casualty lifecycle beyond a queue priority.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S25: §C.1 emergency/custody/safety crosswalk and §G platform/professional verification; older leads checked against current source
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** Emergency queue/encounter/admission values exist; no dedicated complete emergency clinical lifecycle established.
- **Inspected layer paths:** UI: `src/components/modules/OutpatientModule.tsx`; API: `src/routes/domains/encounters.routes.ts`; businessRules: `src/db/queries/encounters.ts`; persistence: `src/db/schema/clinical.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/outpatient-safety-ui.spec.tsx`.
- **Missing functionality / defect:** Department-specific resuscitation/escalation/handover protocols and acceptance scope not approved.
- **Required task:** Confirm included emergency workflow; implement/accept missing clinical events only to approved policy.
- **Dependencies / blockers:** D03, D06.
- **Measurable acceptance:** Triage severity/time and escalations traceable; safe handover and completed services/charges documented; no generic note claimed as full emergency record.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### SPC-004 — Ambulance dispatch

- **Module / requirement:** Core HMIS — Provide ambulance dispatch/trip/care transfer if explicitly included in client scope.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S25: §C.1 emergency/custody/safety crosswalk and §G platform/professional verification; older leads checked against current source
- **Priority / status:** Medium / **NOT IMPLEMENTED**. **Roadmap phase:** 2.
- **Current implementation:** No dedicated ambulance lifecycle UI/API/schema found; an insurer ambulance benefit code is not dispatch.
- **Inspected layer paths:** UI: `src/components/modules/SpecialtyModule.tsx`; API: `src/routes/domains/encounters.routes.ts`; businessRules: `src/components/modules/SpecialtyModule.tsx`; persistence: `src/db/schema/clinical.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `docs/audits/SYRONA_MASTER_SYSTEM_COMPLETION_AUDIT_2026-11-13.md`.
- **Missing functionality / defect:** Vehicle/crew/dispatch/patient transfer/custody/charge workflow missing; inclusion unknown.
- **Required task:** Client explicitly includes/excludes; obtain approved dispatch/care requirements before implementation.
- **Dependencies / blockers:** D03, D06.
- **Measurable acceptance:** Included trip has authorized crew/vehicle/patient/status/times and handover; service charge linked once; no benefit code mislabeled dispatched trip.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### SPC-005 — Mortuary custody

- **Module / requirement:** Core HMIS — Provide mortuary register, custody/storage and authorized release if included.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S25: §C.1 emergency/custody/safety crosswalk and §G platform/professional verification; older leads checked against current source
- **Priority / status:** Medium / **NOT IMPLEMENTED**. **Roadmap phase:** 2.
- **Current implementation:** Inpatient deceased discharge context exists; no dedicated mortuary custody lifecycle found.
- **Inspected layer paths:** UI: `src/components/modules/SpecialtyModule.tsx`; API: `src/routes/domains/encounters.routes.ts`; businessRules: `src/components/modules/SpecialtyModule.tsx`; persistence: `src/db/schema/clinical.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `docs/audits/SYRONA_MASTER_SYSTEM_COMPLETION_AUDIT_2026-11-13.md`.
- **Missing functionality / defect:** Deceased disposition is not body identity/custody/release/retention workflow.
- **Required task:** Confirm inclusion and lawful custody/release roles; implement approved traceability without leaking sensitive records.
- **Dependencies / blockers:** D03, D05, D06.
- **Measurable acceptance:** Included body record retains verified identity/custodian/storage/release authority and immutable events; unauthorized release/read denied.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### SPC-006 — Blood bank/transfusion

- **Module / requirement:** Core HMIS — Provide donor/product compatibility/transfusion/reaction traceability if included.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S25: §C.1 emergency/custody/safety crosswalk and §G platform/professional verification; older leads checked against current source
- **Priority / status:** High / **NOT IMPLEMENTED**. **Roadmap phase:** 2.
- **Current implementation:** Generic lab/inventory exist; no dedicated blood-product/transfusion chain found in current schema/routes.
- **Inspected layer paths:** UI: `src/components/modules/SpecialtyModule.tsx`; API: `src/routes/domains/encounters.routes.ts`; businessRules: `src/components/modules/SpecialtyModule.tsx`; persistence: `src/db/schema/clinical.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `docs/audits/SYRONA_MASTER_SYSTEM_COMPLETION_AUDIT_2026-11-13.md`.
- **Missing functionality / defect:** Compatibility, product custody, recipient verification and reaction/recall clinical controls absent as dedicated product.
- **Required task:** Client confirms scope; design and implement only approved specialist transfusion protocols.
- **Dependencies / blockers:** D03, D06.
- **Measurable acceptance:** Each included transfusion traces product/compatibility/patient/clinicians/time and reaction/recall; generic stock issue cannot imply compatible transfusion.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### SPC-007 — Quality/incident/infection prevention

- **Module / requirement:** Core HMIS — Support approved safety incident, corrective-action and infection-control processes if included.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S25: §C.1 emergency/custody/safety crosswalk and §G platform/professional verification; older leads checked against current source
- **Priority / status:** Medium / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** Nursing Incident note and local surveillance records exist; no adequate facility-wide investigation/corrective-action/complaints lifecycle established.
- **Inspected layer paths:** UI: `src/components/modules/NursingPanel.tsx`; API: `src/routes/domains/public-health.routes.ts`; businessRules: `src/nursing/nursing.service.ts`; persistence: `src/db/schema/inpatient.ts` (nursing notes only, not a dedicated safety schema); permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/nursing-contracts.spec.ts` (not a dedicated safety-programme test).
- **Missing functionality / defect:** Classification/escalation/privacy/ownership/closure and included indicators not agreed.
- **Required task:** Approve scope/policy and connect existing observations to required tracked investigation and closure.
- **Dependencies / blockers:** D03, D05, D06.
- **Measurable acceptance:** Included incident can be assigned/escalated/investigated/closed with evidence and access restriction; local disease tally never claimed as complete infection-control programme.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### OPD-005 — Coding provenance in claims

- **Module / requirement:** Core HMIS — Preserve explicit diagnosis coding system/release and reject unknown-system relabeling in clinical/claim outputs.
- **Provenance:** IMPLIED_WORKFLOW; S26: Remaining clinical eMAR, code provenance and legacy missing-value risks; old findings may now be fixed
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 2.
- **Current implementation:** private-claims.service.ts auto snapshot uses codingSystem===ICD-11 else ICD-10 and omits ICD11 release; scoped diagnosis read now checks encounter and diagnosis patient match.
- **Inspected layer paths:** UI: `src/components/modules/InsuranceClaimsModule.tsx`; API: `src/routes/private-insurance.routes.ts`; businessRules: `src/insurance/claims/private-claims.service.ts`; persistence: `src/db/schema/private-insurance.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/private-insurance.db.spec.ts`.
- **Additional current source:** `src/insurance/claims/private-claims.service.ts`, `src/db/queries/clinical.ts`.
- **Missing functionality / defect:** Unexpected/historical coding values can be mislabeled as ICD10; exact release absent from this snapshot. Old mislinked diagnosis-read gap is fixed, not reasserted.
- **Required task:** Add governed unknown-system handling and release provenance across required snapshots; do not recode old diagnoses automatically.
- **Dependencies / blockers:** D06, D07.
- **Measurable acceptance:** Unknown source system explicitly rejected/withheld/reviewed; ICD11 code/release retained; mismatched patient diagnosis never exposed.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### ACC-006 — Legacy missing monetary data

- **Module / requirement:** Accounting — Distinguish genuinely unknown/incomplete source amounts from a known zero in legacy financial analytics.
- **Provenance:** IMPLIED_WORKFLOW; S26: Remaining clinical eMAR, code provenance and legacy missing-value risks; old findings may now be fixed
- **Priority / status:** High / **PARTIAL**. **Roadmap phase:** 4.
- **Current implementation:** billing.service.ts toCents returns0 for null/invalid values and some legacy aggregates coalesce missing sums; new reporting paths have explicit notes/null handling.
- **Inspected layer paths:** UI: `src/components/modules/AccountingModule.tsx`; API: `src/routes/accounting.routes.ts`; businessRules: `src/accounting/accounting.service.ts`; persistence: `src/db/schema/financial-ledger.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/billing-posting.db.spec.ts`.
- **Additional current source:** `src/reporting/financial-transactions.service.ts`, `src/billing/billing.service.ts`.
- **Missing functionality / defect:** Legacy cohort/analytics may hide missing inputs; no actual bad production row asserted.
- **Required task:** Audit required legacy financial outputs and replace unknown-as-zero semantics with explicit incompleteness; reconcile against accepted newer ledger reports.
- **Dependencies / blockers:** D08, D10.
- **Measurable acceptance:** All-null/invalid/empty-source synthetic cases separately distinguish no rows vs unknown amount vs confirmed zero; no false profit/revenue totals.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

### PLT-001 — Tenant/facility administration

- **Module / requirement:** Platform and production — Provision tenants/facilities/modules/subscriptions/staff invitations without granting platform clinical or money authority.
- **Provenance:** EXPLICIT_CLIENT_SECONDARY; S02: §2 requirements 1–24; secondary reconstruction of a supplied list, not original notes; S25: §C.1 emergency/custody/safety crosswalk and §G platform/professional verification; older leads checked against current source
- **Priority / status:** High / **UNVERIFIED**. **Roadmap phase:** 7.
- **Current implementation:** Platform routes, facility modules, staff-role/invitation and subscription access services exist; metadata admin separated from scoped money paths.
- **Inspected layer paths:** UI: `src/components/modules/ConfigurationModule.tsx`; API: `src/routes/platform/facilities.routes.ts`; businessRules: `src/auth/scope.service.ts`; persistence: `src/db/schema/tenancy.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/tenancy-billing-rbac-http.spec.ts`.
- **Missing functionality / defect:** Fresh complete onboarding/disable/suspend/restore operator acceptance and subscription policy not established.
- **Required task:** Run new synthetic tenant/facility onboarding including scope/roles/modules/subscription transitions.
- **Dependencies / blockers:** D03, D05, D15.
- **Measurable acceptance:** Invited users get only approved facility capabilities; disabled/suspended states apply to direct APIs; platform-only user cannot inspect clinical data or settle money.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Platform and facility administrators.

### PLT-002 — Professional verification

- **Module / requirement:** Platform and production — Accept required clinician/practitioner credential verification and revalidation policy.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S25: §C.1 emergency/custody/safety crosswalk and §G platform/professional verification; older leads checked against current source
- **Priority / status:** High / **BLOCKED**. **Roadmap phase:** 7.
- **Current implementation:** Professional credential/event and verification boundaries exist; a stored reviewed clinician identity is not live regulator verification.
- **Inspected layer paths:** UI: `src/components/modules/ConfigurationModule.tsx`; API: `src/routes/platform/facilities.routes.ts`; businessRules: `src/auth/scope.service.ts`; persistence: `src/db/schema/tenancy.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/integration/tenancy-billing-rbac-http.spec.ts`.
- **Additional current source:** `src/integrations/professional/professional-verification.service.ts`, `src/db/schema/platform.ts`.
- **Missing functionality / defect:** Official registry/authority access, eligible clinician policy, renewal/revocation and client sign-off unavailable.
- **Required task:** Confirm required verification sources; implement/accept supported official operations or explicitly reviewed manual evidence.
- **Dependencies / blockers:** D05, D06, D12.
- **Measurable acceptance:** Only eligible clinician can perform approved restricted acts; expiry/revocation reflects signed policy; manual review never labeled live registry verification.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Clinical governance and professional authority.

### INT-006 — Card/external disbursements

- **Module / requirement:** Integrations — Provide contracted card processing/outgoing payment/automated refunds only with verified provider operations.
- **Provenance:** ASSESSMENT_SCOPE_UNCONFIRMED; S25: §C.1 emergency/custody/safety crosswalk and §G platform/professional verification; older leads checked against current source
- **Priority / status:** Medium / **BLOCKED**. **Roadmap phase:** 6.
- **Current implementation:** Manual payment/refund records and method labels exist; bank service apiInitiationAvailable remains false. No adequate accepted card/acquirer or outgoing-transfer operation established.
- **Inspected layer paths:** UI: `src/components/modules/InteroperabilityModule.tsx`; API: `src/payment-hub/routes.ts`; businessRules: `src/payment-hub/adapters/banks.ts`; persistence: `src/db/schema/payment-hub.ts`; permissions: `src/auth/authorization.middleware.ts`; tests: `src/tests/vitest/bank-sandbox-auth.spec.ts`.
- **Missing functionality / defect:** Provider contract/PCI/payment boundary and client inclusion undefined; no code or live transfer proof.
- **Required task:** Obtain explicit inclusion/provider design and implement required approved operations; retain honest manual evidence workflows meanwhile.
- **Dependencies / blockers:** D03, D11.
- **Measurable acceptance:** Each included external operation has authenticated provider reference and duplicate/unknown-state recovery; manual bank outflow/refund not mislabeled initiated transfer.
- **Verification:** Scoped synthetic PostgreSQL/HTTP + role-based built-browser UAT; inspect saved outputs where applicable Fresh selected tests: None; source/inspected coverage/historical evidence only.
- **Synthetic sufficient?** No for overall requirement closure; synthetic source tests plus named owner UAT/policy/provider or host evidence required. **Owner:** Client module owner.

## 6. All144 Reporting Centre output requirements

No new reporting system or batch was created. Current output classifications are derived from catalogue bindings and actual existing source query/document paths; fresh matrix/catalogue integrity tests confirm the144-entry mapping. There are **zero complete verified full catalogue outputs**. Existing20 engines back24 operational/accounting subset labels; four individual document workflows are also partial.116 entries lack integrated query/workflow; some additionally await approved definitions. A blocked definition is not a completed query.

| Reporting classification                                        | Entries |
| --------------------------------------------------------------- | ------- |
| Complete and verified                                           | 0       |
| Blocked by missing source data or approved business definitions | 19      |
| Partially supported                                             | 28      |
| Unavailable                                                     | 97      |

All catalogue children share existing Reporting Centre auth/selection/service/export/renderer controls, not a competing design. Their dependencies include D03 (signed inclusion) and D10 (exact definitions), and D12 for MOH. They each have separate JSON rows with source entities, API, actual engine/workflow, supported filters, exports, letterhead, gap, task and acceptance criteria. **Common acceptance for each child:** approved source-event/period/denominator fixture; scoped real PostgreSQL/HTTP date/calculation/empty/error/isolation tests; normal authenticated built browser; every required saved PDF/XLSX value agrees with persisted source and full filtered set; correct active/historical/fallback letterhead and authorized print issue. Synthetic engineering proof is necessary but client output approval remains required. Phase 5, priorityHigh for partial outputs/Medium for unavailable candidates; no new role grants. Existing API references in the matrix describe source, not executed live endpoints.

### CAT-001 — Sick-off certificates — PRINTABLES

- **Source/type:** S04 `printables-sick-off-certificates`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID printables-sick-off-certificates; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `practitioners` (`src/db/schema/patients.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Approved certificate, signatory and output. Clinical eligibility, signature/release, sensitive patient access and approved document content must be specified; a stored clinical row is not an approved certificate.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Clinicians; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-sick-off-certificates; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-002 — Medical notes — PRINTABLES

- **Source/type:** S04 `printables-medical-notes`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID printables-medical-notes; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `practitioners` (`src/db/schema/patients.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Signed print template and referral workflow. Clinical eligibility, signature/release, sensitive patient access and approved document content must be specified; a stored clinical row is not an approved certificate.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Clinicians; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-medical-notes; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-003 — Referral letters — PRINTABLES

- **Source/type:** S04 `printables-referral-letters`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID printables-referral-letters; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `referrals` (`src/db/schema/referrals.ts`), `referral_documents` (`src/db/schema/referrals.ts`), `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Signed print template and referral workflow. Distinguish outgoing/incoming/accepted/completed referrals, document access and facility event ownership; do not count all states as completed care.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Clinicians; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-referral-letters; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-004 — Inpatient statements — PRINTABLES

- **Source/type:** S04 `printables-inpatient-statements`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID printables-inpatient-statements; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `practitioners` (`src/db/schema/patients.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Approved integrated printable output and clinical sign-off. Clinical eligibility, signature/release, sensitive patient access and approved document content must be specified; a stored clinical row is not an approved certificate.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Clinicians; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-inpatient-statements; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-005 — Discharge summaries — PRINTABLES

- **Source/type:** S04 `printables-discharge-summaries`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID printables-discharge-summaries; engine=none; workflow=discharge. No integrated query; candidate entities are requirements, not implemented joins. GET /api/documents/admissions/:id/discharge-summary.pdf Filters: source document reference. Exports: PDF. Letterhead: Existing document historical/pinned renderer.
- **Schema candidate evidence:** `admissions` (`src/db/schema/inpatient.ts`), `patients` (`src/db/schema/patients.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `facility_letterheads` (`src/db/schema/facility-branding.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Approved integrated printable output and clinical sign-off. Clinical eligibility, signature/release, sensitive patient access and approved document content must be specified; a stored clinical row is not an approved certificate.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Clinicians; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-discharge-summaries; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-006 — Operation notes — PRINTABLES

- **Source/type:** S04 `printables-operation-notes`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID printables-operation-notes; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `theatre_cases` (`src/db/schema/inpatient.ts`), `patients` (`src/db/schema/patients.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Structured authorized notes and approved printable output. Clinical eligibility, signature/release, sensitive patient access and approved document content must be specified; a stored clinical row is not an approved certificate. Approved immutable operation-note/signature workflow is not exposed here.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Clinicians; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-operation-notes; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-007 — Anaesthetist notes — PRINTABLES

- **Source/type:** S04 `printables-anaesthetist-notes`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID printables-anaesthetist-notes; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `theatre_cases` (`src/db/schema/inpatient.ts`), `patients` (`src/db/schema/patients.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Structured authorized notes and approved printable output. Clinical eligibility, signature/release, sensitive patient access and approved document content must be specified; a stored clinical row is not an approved certificate. No approved integrated anaesthetic note output established.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Clinicians; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-anaesthetist-notes; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-008 — Bill consent forms — PRINTABLES

- **Source/type:** S04 `printables-bill-consent-forms`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID printables-bill-consent-forms; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `billing_invoices` (`src/db/schema/billing.ts`), `patient_consents` (`src/db/schema/patients.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Financial-consent workflow, signatory and approved template. Structured consent does not prove a signed financial agreement. Define approved financial-consent template and signatory workflow.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Clinicians; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-bill-consent-forms; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-009 — Radiology reports — PRINTABLES

- **Source/type:** S04 `printables-radiology-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID printables-radiology-reports; engine=none; workflow=radiology. No integrated query; candidate entities are requirements, not implemented joins. GET /api/documents/radiology-orders/:id/pdf Filters: source document reference. Exports: PDF. Letterhead: Existing document historical/pinned renderer.
- **Schema candidate evidence:** `radiology_orders` (`src/db/schema/laboratory.ts`), `patients` (`src/db/schema/patients.ts`), `facility_letterheads` (`src/db/schema/facility-branding.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Verified released result and approved print template. Clinical eligibility, signature/release, sensitive patient access and approved document content must be specified; a stored clinical row is not an approved certificate.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Clinicians; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-radiology-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-010 — Laboratory reports — PRINTABLES

- **Source/type:** S04 `printables-laboratory-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID printables-laboratory-reports; engine=none; workflow=laboratory. No integrated query; candidate entities are requirements, not implemented joins. GET /api/documents/laboratory-orders/:id/pdf Filters: source document reference. Exports: PDF. Letterhead: Existing document historical/pinned renderer.
- **Schema candidate evidence:** `lab_orders` (`src/db/schema/laboratory.ts`), `lab_results` (`src/db/schema/laboratory.ts`), `patients` (`src/db/schema/patients.ts`), `facility_letterheads` (`src/db/schema/facility-branding.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Verified released result and approved print template. Clinical eligibility, signature/release, sensitive patient access and approved document content must be specified; a stored clinical row is not an approved certificate.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Clinicians; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-laboratory-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-011 — Invoices — PRINTABLES

- **Source/type:** S04 `printables-invoices`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID printables-invoices; engine=none; workflow=invoice. No integrated query; candidate entities are requirements, not implemented joins. GET /api/documents/invoices/:id/pdf Filters: source document reference. Exports: PDF. Letterhead: Existing document historical/pinned renderer.
- **Schema candidate evidence:** `billing_invoices` (`src/db/schema/billing.ts`), `billing_invoice_finalizations` (`src/db/schema/billing.ts`), `billing_items` (`src/db/schema/billing.ts`), `facility_letterheads` (`src/db/schema/facility-branding.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Real printable output and facility-approved template unverified. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Billing officers; cashiers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-invoices; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-012 — Receipts — PRINTABLES

- **Source/type:** S04 `printables-receipts`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID printables-receipts; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Existing owning-module document builder exists in src/documents/document.service.ts; this entry is unavailable only as an integrated Reporting Centre workflow. Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `billing_payments` (`src/db/schema/billing.ts`), `billing_invoices` (`src/db/schema/billing.ts`), `facility_letterheads` (`src/db/schema/facility-branding.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Standalone receipt print template. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names. Existing receipt PDF service is a candidate, not an integrated Reporting Centre workflow.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-receipts; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-013 — Purchase requisitions — PRINTABLES

- **Source/type:** S04 `printables-purchase-requisitions`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID printables-purchase-requisitions; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `procurement_requisitions` (`src/db/schema/procurement.ts`), `procurement_requisition_items` (`src/db/schema/procurement.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Requisition or receiving workflow and approved template. Clinical eligibility, signature/release, sensitive patient access and approved document content must be specified; a stored clinical row is not an approved certificate.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Procurement officers; stores receiving officers; authorized approvers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-purchase-requisitions; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-014 — Local purchase orders — PRINTABLES

- **Source/type:** S04 `printables-local-purchase-orders`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID printables-local-purchase-orders; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Existing owning-module document builder exists in src/documents/document.service.ts; this entry is unavailable only as an integrated Reporting Centre workflow. Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `purchase_orders` (`src/db/schema/inventory.ts`), `purchase_order_items` (`src/db/schema/inventory.ts`), `suppliers` (`src/db/schema/inventory.ts`), `facility_letterheads` (`src/db/schema/facility-branding.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Approved LPO output and print validation. Clinical eligibility, signature/release, sensitive patient access and approved document content must be specified; a stored clinical row is not an approved certificate.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Procurement officers; stores receiving officers; authorized approvers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-local-purchase-orders; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-015 — Goods received notes — PRINTABLES

- **Source/type:** S04 `printables-goods-received-notes`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID printables-goods-received-notes; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Existing owning-module document builder exists in src/documents/document.service.ts; this entry is unavailable only as an integrated Reporting Centre workflow. Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `goods_received_notes` (`src/db/schema/procurement.ts`), `goods_received_note_items` (`src/db/schema/procurement.ts`), `facility_letterheads` (`src/db/schema/facility-branding.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Requisition or receiving workflow and approved template. Clinical eligibility, signature/release, sensitive patient access and approved document content must be specified; a stored clinical row is not an approved certificate.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Procurement officers; stores receiving officers; authorized approvers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for printables-goods-received-notes; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-016 — Cashier daily summary — FINANCIAL

- **Source/type:** S04 `financial-cashier-daily-summary`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID financial-cashier-daily-summary; engine=cashier-receipts; workflow=none. billing_payments, billing_invoices. POST /api/reporting/centre/cashier-receipts/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, receiptFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `billing_invoices` (`src/db/schema/billing.ts`), `billing_items` (`src/db/schema/billing.ts`), `billing_payments` (`src/db/schema/billing.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete transaction-date data, cashier/department identity and verified reconciliation. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-cashier-daily-summary; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-017 — All-cashier daily summary — FINANCIAL

- **Source/type:** S04 `financial-all-cashier-daily-summary`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID financial-all-cashier-daily-summary; engine=cashier-receipts; workflow=none. billing_payments, billing_invoices. POST /api/reporting/centre/cashier-receipts/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, receiptFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `billing_invoices` (`src/db/schema/billing.ts`), `billing_items` (`src/db/schema/billing.ts`), `billing_payments` (`src/db/schema/billing.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete transaction-date data, cashier/department identity and verified reconciliation. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-all-cashier-daily-summary; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-018 — Department receipt summary — FINANCIAL

- **Source/type:** S04 `financial-department-receipt-summary`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID financial-department-receipt-summary; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `billing_invoices` (`src/db/schema/billing.ts`), `billing_items` (`src/db/schema/billing.ts`), `billing_payments` (`src/db/schema/billing.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete transaction-date data, cashier/department identity and verified reconciliation. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-department-receipt-summary; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-019 — Department receipt breakdown — FINANCIAL

- **Source/type:** S04 `financial-department-receipt-breakdown`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID financial-department-receipt-breakdown; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `billing_invoices` (`src/db/schema/billing.ts`), `billing_items` (`src/db/schema/billing.ts`), `billing_payments` (`src/db/schema/billing.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete transaction-date data, cashier/department identity and verified reconciliation. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-department-receipt-breakdown; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-020 — Managerial daily summary — FINANCIAL

- **Source/type:** S04 `financial-managerial-daily-summary`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID financial-managerial-daily-summary; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `billing_invoices` (`src/db/schema/billing.ts`), `billing_items` (`src/db/schema/billing.ts`), `billing_payments` (`src/db/schema/billing.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete transaction-date data, cashier/department identity and verified reconciliation. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-managerial-daily-summary; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-021 — Trial balance — FINANCIAL

- **Source/type:** S04 `financial-trial-balance`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID financial-trial-balance; engine=ledger-trial-movements; workflow=none. chart_of_accounts, journal_lines, journal_entries. POST /api/reporting/centre/ledger-trial-movements/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, accountFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `journal_entries` (`src/db/schema/financial-ledger.ts`), `journal_lines` (`src/db/schema/financial-ledger.ts`), `chart_of_accounts` (`src/db/schema/financial-ledger.ts`), `financial_periods` (`src/db/schema/financial-ledger.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Opening balances, posting completeness, mappings and source reconciliation; the available view is posted account movements only. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-trial-balance; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-022 — Income statement — FINANCIAL

- **Source/type:** S04 `financial-income-statement`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID financial-income-statement; engine=ledger-income; workflow=none. chart_of_accounts, journal_lines, journal_entries. POST /api/reporting/centre/ledger-income/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, accountFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `journal_entries` (`src/db/schema/financial-ledger.ts`), `journal_lines` (`src/db/schema/financial-ledger.ts`), `chart_of_accounts` (`src/db/schema/financial-ledger.ts`), `financial_periods` (`src/db/schema/financial-ledger.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Posting completeness, recognized revenue/cost policies, account mappings and source reconciliation. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-income-statement; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-023 — Balance sheet — FINANCIAL

- **Source/type:** S04 `financial-balance-sheet`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID financial-balance-sheet; engine=ledger-balance-sheet; workflow=none. chart_of_accounts, journal_lines, journal_entries. POST /api/reporting/centre/ledger-balance-sheet/{options,generate,export} Filters: facility, as-of date, literal search, accountFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `journal_entries` (`src/db/schema/financial-ledger.ts`), `journal_lines` (`src/db/schema/financial-ledger.ts`), `chart_of_accounts` (`src/db/schema/financial-ledger.ts`), `financial_periods` (`src/db/schema/financial-ledger.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Posting completeness, opening balances, classification, account mappings and source reconciliation. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-balance-sheet; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-024 — Monthly profit and loss — FINANCIAL

- **Source/type:** S04 `financial-monthly-profit-and-loss`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID financial-monthly-profit-and-loss; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `journal_entries` (`src/db/schema/financial-ledger.ts`), `journal_lines` (`src/db/schema/financial-ledger.ts`), `chart_of_accounts` (`src/db/schema/financial-ledger.ts`), `financial_periods` (`src/db/schema/financial-ledger.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Auto posting, mappings, costs and source reconciliation; current statements are not complete. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-monthly-profit-and-loss; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-025 — Cash flow statement — FINANCIAL

- **Source/type:** S04 `financial-cash-flow-statement`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID financial-cash-flow-statement; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `journal_entries` (`src/db/schema/financial-ledger.ts`), `journal_lines` (`src/db/schema/financial-ledger.ts`), `chart_of_accounts` (`src/db/schema/financial-ledger.ts`), `bank_accounts` (`src/db/schema/banking.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Dedicated controlled workflow and reconciled classification. Approved cash-equivalent classification and direct/indirect cash-flow mapping are missing; a bank movement list is not a cash-flow statement.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-cash-flow-statement; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-026 — Budget management — FINANCIAL

- **Source/type:** S04 `financial-budget-management`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID financial-budget-management; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `planning_plans` (`src/db/schema/planning.ts`), `planning_categories` (`src/db/schema/planning.ts`), `planning_items` (`src/db/schema/planning.ts`), `planning_months` (`src/db/schema/planning.ts`), `planning_reports` (`src/db/schema/planning.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Dedicated controlled workflow and reconciled classification. Projections/imported budgets must stay separate from posted actuals and actual purchases. Define approved plan/version and comparisons.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-budget-management; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-027 — Credit notes — FINANCIAL

- **Source/type:** S04 `financial-credit-notes`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID financial-credit-notes; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `billing_refunds` (`src/db/schema/billing.ts`), `supplier_credit_notes` (`src/db/schema/procurement-matching.ts`), `supplier_credit_note_items` (`src/db/schema/procurement-matching.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Dedicated controlled workflow and reconciled classification. Patient credit notes and supplier credit notes are distinct. Establish intended subject; refund does not automatically mean finalized credit note.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-credit-notes; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-028 — Waiver reports — FINANCIAL

- **Source/type:** S04 `financial-waiver-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID financial-waiver-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `billing_invoices` (`src/db/schema/billing.ts`), `audit_logs` (`src/db/schema/public-health.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Dedicated controlled workflow and reconciled classification. No complete dedicated waiver-decision lifecycle established for this report; do not equate discounts/refunds with authorized waivers.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-waiver-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-029 — Income by cashier — FINANCIAL

- **Source/type:** S04 `financial-income-by-cashier`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID financial-income-by-cashier; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `billing_invoices` (`src/db/schema/billing.ts`), `billing_items` (`src/db/schema/billing.ts`), `billing_payments` (`src/db/schema/billing.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-income-by-cashier; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-030 — Departmental revenue — FINANCIAL

- **Source/type:** S04 `financial-departmental-revenue`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID financial-departmental-revenue; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `billing_invoices` (`src/db/schema/billing.ts`), `billing_items` (`src/db/schema/billing.ts`), `billing_payments` (`src/db/schema/billing.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-departmental-revenue; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-031 — Patient outstanding balances — FINANCIAL

- **Source/type:** S04 `financial-patient-outstanding-balances`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID financial-patient-outstanding-balances; engine=invoice-balances; workflow=none. billing_invoices, patients. POST /api/reporting/centre/invoice-balances/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, invoiceFilter, patientFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `billing_invoices` (`src/db/schema/billing.ts`), `billing_items` (`src/db/schema/billing.ts`), `billing_payments` (`src/db/schema/billing.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-patient-outstanding-balances; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-032 — SHA receivables — FINANCIAL

- **Source/type:** S04 `financial-sha-receivables`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID financial-sha-receivables; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `sha_eclaims` (`src/db/schema/sha-claims.ts`), `sha_eclaim_items` (`src/db/schema/sha-claims.ts`), `insurance_remittances` (`src/db/schema/insurance-remittances.ts`), `insurance_reconciliation_entries` (`src/db/schema/insurance-remittances.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names. Claim submission/acceptance is not settlement or posted receivable.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-sha-receivables; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-033 — Private insurance receivables — FINANCIAL

- **Source/type:** S04 `financial-private-insurance-receivables`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID financial-private-insurance-receivables; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `private_insurance_claims` (`src/db/schema/private-insurance.ts`), `private_insurance_claim_lines` (`src/db/schema/private-insurance.ts`), `private_insurance_remittance_allocations` (`src/db/schema/private-insurance.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names. Preserve payer-specific allocation and claim status rules.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-private-insurance-receivables; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-034 — M-Pesa reconciliation — FINANCIAL

- **Source/type:** S04 `financial-m-pesa-reconciliation`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID financial-m-pesa-reconciliation; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `payment_hub_transactions` (`src/db/schema/payment-hub.ts`), `payment_hub_webhook_events` (`src/db/schema/payment-hub.ts`), `payment_hub_reconciliations` (`src/db/schema/payment-hub.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names. Provider identifiers and trusted settlement evidence required, not callback success alone.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-m-pesa-reconciliation; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-035 — Card payment reconciliation — FINANCIAL

- **Source/type:** S04 `financial-card-payment-reconciliation`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID financial-card-payment-reconciliation; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `payment_hub_transactions` (`src/db/schema/payment-hub.ts`), `payment_hub_reconciliations` (`src/db/schema/payment-hub.ts`), `bank_transactions` (`src/db/schema/banking.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names. No assumed card settlement contract or provider mapping.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-card-payment-reconciliation; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-036 — Refund reports — FINANCIAL

- **Source/type:** S04 `financial-refund-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID financial-refund-reports; engine=recorded-refunds; workflow=none. billing_refunds, billing_invoices. POST /api/reporting/centre/recorded-refunds/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, staffFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `billing_refunds` (`src/db/schema/billing.ts`), `billing_invoices` (`src/db/schema/billing.ts`), `billing_refund_requests` (`src/db/schema/billing.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Approved attribution and verified payer/bank/provider reconciliation; no inferred settlement. Operational amounts are not posted/reconciled revenue or cash. Confirm attribution, reversals, missing amounts, period and currency; do not join on free-text names.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Cashiers; billing supervisors; finance; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for financial-refund-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-037 — Stock usage — STOCK / GOODS

- **Source/type:** S04 `stock-goods-stock-usage`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID stock-goods-stock-usage; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `inventory_items` (`src/db/schema/inventory.ts`), `inventory_batches` (`src/db/schema/inventory.ts`), `inventory_movements` (`src/db/schema/inventory-control.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete movement/receipt/return ledger and report. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-stock-usage; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-038 — Stock movements — STOCK / GOODS

- **Source/type:** S04 `stock-goods-stock-movements`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID stock-goods-stock-movements; engine=inventory-movements; workflow=none. inventory_movements, inventory_items. POST /api/reporting/centre/inventory-movements/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, status, inventoryItemFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `inventory_items` (`src/db/schema/inventory.ts`), `inventory_batches` (`src/db/schema/inventory.ts`), `inventory_movements` (`src/db/schema/inventory-control.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Recorded movement register only; historical opening/closing balances, cost valuation and completeness before movement capture are not established. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-stock-movements; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-039 — Goods received — STOCK / GOODS

- **Source/type:** S04 `stock-goods-goods-received`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID stock-goods-goods-received; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `goods_received_notes` (`src/db/schema/procurement.ts`), `goods_received_note_items` (`src/db/schema/procurement.ts`), `inventory_movements` (`src/db/schema/inventory-control.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete movement/receipt/return ledger and report. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-goods-received; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-040 — Goods returned — STOCK / GOODS

- **Source/type:** S04 `stock-goods-goods-returned`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID stock-goods-goods-returned; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `supplier_returns` (`src/db/schema/procurement-matching.ts`), `supplier_return_items` (`src/db/schema/procurement-matching.ts`), `supplier_credit_notes` (`src/db/schema/procurement-matching.ts`), `inventory_movements` (`src/db/schema/inventory-control.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete movement/receipt/return ledger and report. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-goods-returned; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-041 — LPO summaries — STOCK / GOODS

- **Source/type:** S04 `stock-goods-lpo-summaries`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID stock-goods-lpo-summaries; engine=purchase-orders; workflow=none. purchase_orders, suppliers. POST /api/reporting/centre/purchase-orders/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, status, supplierFilter, purchaseOrderFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `purchase_orders` (`src/db/schema/inventory.ts`), `purchase_order_items` (`src/db/schema/inventory.ts`), `suppliers` (`src/db/schema/inventory.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete filtered/exportable report. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-lpo-summaries; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-042 — Inward invoices — STOCK / GOODS

- **Source/type:** S04 `stock-goods-inward-invoices`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID stock-goods-inward-invoices; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `supplier_invoices` (`src/db/schema/financial-ledger.ts`), `supplier_invoice_matches` (`src/db/schema/procurement-matching.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Stock-linked invoice classification and matching. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-inward-invoices; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-043 — Outward invoices — STOCK / GOODS

- **Source/type:** S04 `stock-goods-outward-invoices`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID stock-goods-outward-invoices; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `billing_invoices` (`src/db/schema/billing.ts`), `billing_items` (`src/db/schema/billing.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Stock-linked invoice classification and matching. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-outward-invoices; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-044 — Bin cards — STOCK / GOODS

- **Source/type:** S04 `stock-goods-bin-cards`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID stock-goods-bin-cards; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `inventory_movements` (`src/db/schema/inventory-control.ts`), `inventory_items` (`src/db/schema/inventory.ts`), `inventory_batches` (`src/db/schema/inventory.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Location-aware movement ledger, stocktake and transfers. Define opening balance provenance, chronological event order, back-dated corrections and lot/store semantics; current stock is not a historical opening balance.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-bin-cards; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-045 — Inventory by store — STOCK / GOODS

- **Source/type:** S04 `stock-goods-inventory-by-store`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID stock-goods-inventory-by-store; engine=inventory-store; workflow=none. inventory_items, facilities. POST /api/reporting/centre/inventory-store/{options,generate,export} Filters: facility, literal search, status, inventoryItemFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `inventory_items` (`src/db/schema/inventory.ts`), `inventory_batches` (`src/db/schema/inventory.ts`), `inventory_movements` (`src/db/schema/inventory-control.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete safe grouping, historical/cost evidence, filters and export. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-inventory-by-store; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-046 — Inventory by category — STOCK / GOODS

- **Source/type:** S04 `stock-goods-inventory-by-category`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID stock-goods-inventory-by-category; engine=inventory-category; workflow=none. inventory_items, facilities. POST /api/reporting/centre/inventory-category/{options,generate,export} Filters: facility, literal search, status, inventoryItemFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `inventory_items` (`src/db/schema/inventory.ts`), `inventory_batches` (`src/db/schema/inventory.ts`), `inventory_movements` (`src/db/schema/inventory-control.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete safe grouping, historical/cost evidence, filters and export. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-inventory-by-category; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-047 — Expiry reports — STOCK / GOODS

- **Source/type:** S04 `stock-goods-expiry-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID stock-goods-expiry-reports; engine=inventory-expiry; workflow=none. inventory_batches, inventory_items, facilities. POST /api/reporting/centre/inventory-expiry/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, inventoryItemFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `inventory_items` (`src/db/schema/inventory.ts`), `inventory_batches` (`src/db/schema/inventory.ts`), `inventory_movements` (`src/db/schema/inventory-control.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete safe grouping, historical/cost evidence, filters and export. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-expiry-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-048 — Stock variance — STOCK / GOODS

- **Source/type:** S04 `stock-goods-stock-variance`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID stock-goods-stock-variance; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `inventory_stock_counts` (`src/db/schema/inventory-control.ts`), `inventory_stock_count_lines` (`src/db/schema/inventory-control.ts`), `inventory_movements` (`src/db/schema/inventory-control.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Location-aware movement ledger, stocktake and transfers. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-stock-variance; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-049 — Stock transfers — STOCK / GOODS

- **Source/type:** S04 `stock-goods-stock-transfers`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID stock-goods-stock-transfers; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `inventory_transfers` (`src/db/schema/inventory-control.ts`), `inventory_transfer_items` (`src/db/schema/inventory-control.ts`), `inventory_movements` (`src/db/schema/inventory-control.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Location-aware movement ledger, stocktake and transfers. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-stock-transfers; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-050 — Goods price lists — STOCK / GOODS

- **Source/type:** S04 `stock-goods-goods-price-lists`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID stock-goods-goods-price-lists; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `inventory_items` (`src/db/schema/inventory.ts`), `inventory_batches` (`src/db/schema/inventory.ts`), `inventory_movements` (`src/db/schema/inventory-control.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete safe grouping, historical/cost evidence, filters and export. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-goods-price-lists; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-051 — Supplier reports — STOCK / GOODS

- **Source/type:** S04 `stock-goods-supplier-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID stock-goods-supplier-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `suppliers` (`src/db/schema/inventory.ts`), `purchase_orders` (`src/db/schema/inventory.ts`), `supplier_invoices` (`src/db/schema/financial-ledger.ts`), `supplier_payments` (`src/db/schema/banking.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete safe grouping, historical/cost evidence, filters and export. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-supplier-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-052 — Stock valuation — STOCK / GOODS

- **Source/type:** S04 `stock-goods-stock-valuation`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID stock-goods-stock-valuation; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `inventory_movements` (`src/db/schema/inventory-control.ts`), `inventory_movement_allocations` (`src/db/schema/inventory-accounting.ts`), `inventory_movement_journals` (`src/db/schema/inventory-accounting.ts`), `facility_inventory_accounting` (`src/db/schema/inventory-accounting.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete safe grouping, historical/cost evidence, filters and export. Require approved cost layers, method/effective date and complete opening values; selling price times current stock is not a defensible inventory valuation.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-stock-valuation; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-053 — Asset register — STOCK / GOODS

- **Source/type:** S04 `stock-goods-asset-register`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID stock-goods-asset-register; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `fixed_assets` (`src/db/schema/financial-ledger.ts`), `fixed_asset_categories` (`src/db/schema/assets.ts`), `fixed_asset_movements` (`src/db/schema/financial-ledger.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Mounted asset, movement and maintenance workflows. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-asset-register; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-054 — Asset tracking — STOCK / GOODS

- **Source/type:** S04 `stock-goods-asset-tracking`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID stock-goods-asset-tracking; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `fixed_assets` (`src/db/schema/financial-ledger.ts`), `fixed_asset_transfers` (`src/db/schema/assets.ts`), `fixed_asset_movements` (`src/db/schema/financial-ledger.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Mounted asset, movement and maintenance workflows. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-asset-tracking; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-055 — Asset maintenance — STOCK / GOODS

- **Source/type:** S04 `stock-goods-asset-maintenance`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID stock-goods-asset-maintenance; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `fixed_assets` (`src/db/schema/financial-ledger.ts`), `fixed_asset_maintenance` (`src/db/schema/assets.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Mounted asset, movement and maintenance workflows. Historical coverage starts with recorded movements; item labels may change; units cannot be summed across items; current balances are not historical valuations.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Storekeepers; pharmacists; inventory supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for stock-goods-asset-maintenance; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-056 — OPD attendance — DEPARTMENTAL / OPD

- **Source/type:** S04 `departmental-opd-opd-attendance`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID departmental-opd-opd-attendance; engine=outpatient-encounters; workflow=none. encounters, patients, departments, practitioners. POST /api/reporting/centre/outpatient-encounters/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, status, patientFilter, departmentFilter, staffFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `encounters` (`src/db/schema/clinical.ts`), `patients` (`src/db/schema/patients.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `departments` (`src/db/schema/tenancy.ts`), `practitioners` (`src/db/schema/patients.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined report events, referral lifecycle, clinician attribution and exports. Encounter state is not proof of attendance or clinical completion; diagnosis rows are not unique patients or statutory cases.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Clinicians; OPD supervisor; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-opd-opd-attendance; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-057 — Consultation reports — DEPARTMENTAL / OPD

- **Source/type:** S04 `departmental-opd-consultation-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-opd-consultation-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `encounters` (`src/db/schema/clinical.ts`), `patients` (`src/db/schema/patients.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `departments` (`src/db/schema/tenancy.ts`), `practitioners` (`src/db/schema/patients.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined report events, referral lifecycle, clinician attribution and exports. Encounter state is not proof of attendance or clinical completion; diagnosis rows are not unique patients or statutory cases.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Clinicians; OPD supervisor; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-opd-consultation-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-058 — Diagnosis reports — DEPARTMENTAL / OPD

- **Source/type:** S04 `departmental-opd-diagnosis-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID departmental-opd-diagnosis-reports; engine=outpatient-diagnoses; workflow=none. encounters, patients, departments, diagnoses. POST /api/reporting/centre/outpatient-diagnoses/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, status, patientFilter, departmentFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `encounters` (`src/db/schema/clinical.ts`), `patients` (`src/db/schema/patients.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `departments` (`src/db/schema/tenancy.ts`), `practitioners` (`src/db/schema/patients.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Recorded encounter/diagnosis register only; deduplicated morbidity, verified MOH 705 definitions and facility acceptance remain outstanding. Encounter state is not proof of attendance or clinical completion; diagnosis rows are not unique patients or statutory cases.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Clinicians; OPD supervisor; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-opd-diagnosis-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-059 — Referral reports — DEPARTMENTAL / OPD

- **Source/type:** S04 `departmental-opd-referral-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-opd-referral-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `referrals` (`src/db/schema/referrals.ts`), `referral_documents` (`src/db/schema/referrals.ts`), `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined report events, referral lifecycle, clinician attribution and exports. Distinguish outgoing/incoming/accepted/completed referrals, document access and facility event ownership; do not count all states as completed care.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Clinicians; OPD supervisor; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-opd-referral-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-060 — Doctor workload — DEPARTMENTAL / OPD

- **Source/type:** S04 `departmental-opd-doctor-workload`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID departmental-opd-doctor-workload; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `encounters` (`src/db/schema/clinical.ts`), `patients` (`src/db/schema/patients.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `departments` (`src/db/schema/tenancy.ts`), `practitioners` (`src/db/schema/patients.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined report events, referral lifecycle, clinician attribution and exports. Encounter state is not proof of attendance or clinical completion; diagnosis rows are not unique patients or statutory cases.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Clinicians; OPD supervisor; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-opd-doctor-workload; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-061 — Current inpatient list — DEPARTMENTAL / INPATIENT

- **Source/type:** S04 `departmental-inpatient-current-inpatient-list`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID departmental-inpatient-current-inpatient-list; engine=current-inpatients; workflow=none. admissions, patients, wards, beds. POST /api/reporting/centre/current-inpatients/{options,generate,export} Filters: facility, literal search, patientFilter, wardFilter, bedFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `admissions` (`src/db/schema/inpatient.ts`), `wards` (`src/db/schema/inpatient.ts`), `beds` (`src/db/schema/inpatient.ts`), `inpatient_bed_occupancies` (`src/db/schema/inpatient.ts`), `admission_transfers` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Scoped detailed reports and reconciliation of billing; rate evidence and policy. Current ward/bed references cannot reconstruct past occupancy. Establish bed-capacity denominator and event-time rules before occupancy percentages.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Ward nurses; admissions desk; inpatient supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-inpatient-current-inpatient-list; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-062 — Admissions — DEPARTMENTAL / INPATIENT

- **Source/type:** S04 `departmental-inpatient-admissions`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID departmental-inpatient-admissions; engine=inpatient-admissions; workflow=none. admissions, patients, wards, beds. POST /api/reporting/centre/inpatient-admissions/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, patientFilter, wardFilter, bedFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `admissions` (`src/db/schema/inpatient.ts`), `wards` (`src/db/schema/inpatient.ts`), `beds` (`src/db/schema/inpatient.ts`), `inpatient_bed_occupancies` (`src/db/schema/inpatient.ts`), `admission_transfers` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Scoped detailed reports and reconciliation of billing; rate evidence and policy. Current ward/bed references cannot reconstruct past occupancy. Establish bed-capacity denominator and event-time rules before occupancy percentages.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Ward nurses; admissions desk; inpatient supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-inpatient-admissions; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-063 — Discharges — DEPARTMENTAL / INPATIENT

- **Source/type:** S04 `departmental-inpatient-discharges`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID departmental-inpatient-discharges; engine=inpatient-discharges; workflow=none. admissions, patients, wards, beds. POST /api/reporting/centre/inpatient-discharges/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, patientFilter, wardFilter, bedFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `admissions` (`src/db/schema/inpatient.ts`), `wards` (`src/db/schema/inpatient.ts`), `beds` (`src/db/schema/inpatient.ts`), `inpatient_bed_occupancies` (`src/db/schema/inpatient.ts`), `admission_transfers` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Scoped detailed reports and reconciliation of billing; rate evidence and policy. Current ward/bed references cannot reconstruct past occupancy. Establish bed-capacity denominator and event-time rules before occupancy percentages.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Ward nurses; admissions desk; inpatient supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-inpatient-discharges; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-064 — Ward occupancy — DEPARTMENTAL / INPATIENT

- **Source/type:** S04 `departmental-inpatient-ward-occupancy`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-inpatient-ward-occupancy; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `admissions` (`src/db/schema/inpatient.ts`), `wards` (`src/db/schema/inpatient.ts`), `beds` (`src/db/schema/inpatient.ts`), `inpatient_bed_occupancies` (`src/db/schema/inpatient.ts`), `admission_transfers` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Scoped detailed reports and reconciliation of billing; rate evidence and policy. Current ward/bed references cannot reconstruct past occupancy. Establish bed-capacity denominator and event-time rules before occupancy percentages.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Ward nurses; admissions desk; inpatient supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-inpatient-ward-occupancy; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-065 — Bed billing — DEPARTMENTAL / INPATIENT

- **Source/type:** S04 `departmental-inpatient-bed-billing`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-inpatient-bed-billing; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `inpatient_bed_nights` (`src/db/schema/inpatient.ts`), `inpatient_bed_billing_work` (`src/db/schema/inpatient.ts`), `inpatient_bed_stay_snapshots` (`src/db/schema/inpatient.ts`), `inpatient_bed_billing_reviews` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Scoped detailed reports and reconciliation of billing; rate evidence and policy. Use recorded nightly evidence; exclude disputed/reversed work correctly; occupancy days do not equal chargeable nights or recognized revenue.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Ward nurses; admissions desk; inpatient supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-inpatient-bed-billing; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-066 — Test reports — DEPARTMENTAL / LABORATORY

- **Source/type:** S04 `departmental-laboratory-test-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID departmental-laboratory-test-reports; engine=laboratory-orders; workflow=none. lab_orders, patients. POST /api/reporting/centre/laboratory-orders/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, status, labTestFilter, serviceFilter, patientFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `lab_orders` (`src/db/schema/laboratory.ts`), `lab_results` (`src/db/schema/laboratory.ts`), `lab_tests` (`src/db/schema/laboratory.ts`), `lab_specimens` (`src/db/schema/lab-specimens.ts`), `lab_specimen_orders` (`src/db/schema/lab-specimens.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Precise result/release and timing rules, grouped reports and safe exports. Verified result is not necessarily released. Define cancelled/rejected/partial orders, result versions, release authority and timing; do not infer release from completion.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Laboratory scientists; laboratory supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-laboratory-test-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-067 — Patient reports — DEPARTMENTAL / LABORATORY

- **Source/type:** S04 `departmental-laboratory-patient-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-laboratory-patient-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `lab_orders` (`src/db/schema/laboratory.ts`), `lab_results` (`src/db/schema/laboratory.ts`), `lab_tests` (`src/db/schema/laboratory.ts`), `lab_specimens` (`src/db/schema/lab-specimens.ts`), `lab_specimen_orders` (`src/db/schema/lab-specimens.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Precise result/release and timing rules, grouped reports and safe exports. Verified result is not necessarily released. Define cancelled/rejected/partial orders, result versions, release authority and timing; do not infer release from completion.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Laboratory scientists; laboratory supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-laboratory-patient-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-068 — Specimen reports — DEPARTMENTAL / LABORATORY

- **Source/type:** S04 `departmental-laboratory-specimen-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-laboratory-specimen-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `lab_orders` (`src/db/schema/laboratory.ts`), `lab_results` (`src/db/schema/laboratory.ts`), `lab_tests` (`src/db/schema/laboratory.ts`), `lab_specimens` (`src/db/schema/lab-specimens.ts`), `lab_specimen_orders` (`src/db/schema/lab-specimens.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Precise result/release and timing rules, grouped reports and safe exports. Verified result is not necessarily released. Define cancelled/rejected/partial orders, result versions, release authority and timing; do not infer release from completion.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Laboratory scientists; laboratory supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-laboratory-specimen-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-069 — Sample reports — DEPARTMENTAL / LABORATORY

- **Source/type:** S04 `departmental-laboratory-sample-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-laboratory-sample-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `lab_orders` (`src/db/schema/laboratory.ts`), `lab_results` (`src/db/schema/laboratory.ts`), `lab_tests` (`src/db/schema/laboratory.ts`), `lab_specimens` (`src/db/schema/lab-specimens.ts`), `lab_specimen_orders` (`src/db/schema/lab-specimens.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Precise result/release and timing rules, grouped reports and safe exports. Verified result is not necessarily released. Define cancelled/rejected/partial orders, result versions, release authority and timing; do not infer release from completion.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Laboratory scientists; laboratory supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-laboratory-sample-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-070 — Section reports — DEPARTMENTAL / LABORATORY

- **Source/type:** S04 `departmental-laboratory-section-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-laboratory-section-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `lab_orders` (`src/db/schema/laboratory.ts`), `lab_results` (`src/db/schema/laboratory.ts`), `lab_tests` (`src/db/schema/laboratory.ts`), `lab_specimens` (`src/db/schema/lab-specimens.ts`), `lab_specimen_orders` (`src/db/schema/lab-specimens.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Precise result/release and timing rules, grouped reports and safe exports. Verified result is not necessarily released. Define cancelled/rejected/partial orders, result versions, release authority and timing; do not infer release from completion.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Laboratory scientists; laboratory supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-laboratory-section-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-071 — Pending results — DEPARTMENTAL / LABORATORY

- **Source/type:** S04 `departmental-laboratory-pending-results`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-laboratory-pending-results; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `lab_orders` (`src/db/schema/laboratory.ts`), `lab_results` (`src/db/schema/laboratory.ts`), `lab_tests` (`src/db/schema/laboratory.ts`), `lab_specimens` (`src/db/schema/lab-specimens.ts`), `lab_specimen_orders` (`src/db/schema/lab-specimens.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Precise result/release and timing rules, grouped reports and safe exports. Verified result is not necessarily released. Define cancelled/rejected/partial orders, result versions, release authority and timing; do not infer release from completion.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Laboratory scientists; laboratory supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-laboratory-pending-results; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-072 — Released results — DEPARTMENTAL / LABORATORY

- **Source/type:** S04 `departmental-laboratory-released-results`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-laboratory-released-results; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `lab_orders` (`src/db/schema/laboratory.ts`), `lab_results` (`src/db/schema/laboratory.ts`), `lab_tests` (`src/db/schema/laboratory.ts`), `lab_specimens` (`src/db/schema/lab-specimens.ts`), `lab_specimen_orders` (`src/db/schema/lab-specimens.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Precise result/release and timing rules, grouped reports and safe exports. Verified result is not necessarily released. Define cancelled/rejected/partial orders, result versions, release authority and timing; do not infer release from completion.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Laboratory scientists; laboratory supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-laboratory-released-results; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-073 — Turnaround times — DEPARTMENTAL / LABORATORY

- **Source/type:** S04 `departmental-laboratory-turnaround-times`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID departmental-laboratory-turnaround-times; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `lab_orders` (`src/db/schema/laboratory.ts`), `lab_results` (`src/db/schema/laboratory.ts`), `lab_tests` (`src/db/schema/laboratory.ts`), `lab_specimens` (`src/db/schema/lab-specimens.ts`), `lab_specimen_orders` (`src/db/schema/lab-specimens.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Precise result/release and timing rules, grouped reports and safe exports. Verified result is not necessarily released. Define cancelled/rejected/partial orders, result versions, release authority and timing; do not infer release from completion.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Laboratory scientists; laboratory supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-laboratory-turnaround-times; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-074 — Imaging requests — DEPARTMENTAL / RADIOLOGY

- **Source/type:** S04 `departmental-radiology-imaging-requests`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID departmental-radiology-imaging-requests; engine=radiology-requests; workflow=none. radiology_orders, patients. POST /api/reporting/centre/radiology-requests/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, status, serviceFilter, patientFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `radiology_orders` (`src/db/schema/laboratory.ts`), `patients` (`src/db/schema/patients.ts`), `facility_services` (`src/db/schema/facility-services.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Completed procedure definition, report grouping; reconciled finance for revenue. Reported is recorded state, not independently proven performance. Consent is enforced at completion; revenue requires source-linked billing attribution.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Radiographers; radiologists; imaging supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-radiology-imaging-requests; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-075 — Completed procedures — DEPARTMENTAL / RADIOLOGY

- **Source/type:** S04 `departmental-radiology-completed-procedures`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-radiology-completed-procedures; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `radiology_orders` (`src/db/schema/laboratory.ts`), `patients` (`src/db/schema/patients.ts`), `facility_services` (`src/db/schema/facility-services.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Completed procedure definition, report grouping; reconciled finance for revenue. Reported is recorded state, not independently proven performance. Consent is enforced at completion; revenue requires source-linked billing attribution.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Radiographers; radiologists; imaging supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-radiology-completed-procedures; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-076 — Patient reports — DEPARTMENTAL / RADIOLOGY

- **Source/type:** S04 `departmental-radiology-patient-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-radiology-patient-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `radiology_orders` (`src/db/schema/laboratory.ts`), `patients` (`src/db/schema/patients.ts`), `facility_services` (`src/db/schema/facility-services.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Completed procedure definition, report grouping; reconciled finance for revenue. Reported is recorded state, not independently proven performance. Consent is enforced at completion; revenue requires source-linked billing attribution.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Radiographers; radiologists; imaging supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-radiology-patient-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-077 — Radiology revenue — DEPARTMENTAL / RADIOLOGY

- **Source/type:** S04 `departmental-radiology-radiology-revenue`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-radiology-radiology-revenue; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `radiology_orders` (`src/db/schema/laboratory.ts`), `patients` (`src/db/schema/patients.ts`), `facility_services` (`src/db/schema/facility-services.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Completed procedure definition, report grouping; reconciled finance for revenue. Reported is recorded state, not independently proven performance. Consent is enforced at completion; revenue requires source-linked billing attribution.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Radiographers; radiologists; imaging supervisor; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-radiology-radiology-revenue; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-078 — Prescriptions — DEPARTMENTAL / PHARMACY

- **Source/type:** S04 `departmental-pharmacy-prescriptions`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-pharmacy-prescriptions; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `medications` (`src/db/schema/inpatient.ts`), `pharmacy_dispensations` (`src/db/schema/inventory.ts`), `pharmacy_dispense_allocations` (`src/db/schema/pharmacy-workflow.ts`), `inventory_movements` (`src/db/schema/inventory-control.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Report filtering, full movement ledger and controlled returns. Prescription is not dispensing; distinguish stock issue/return from charge/revenue. Preserve item and dose snapshots; no mixed-unit totals.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Pharmacists; dispensing supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-pharmacy-prescriptions; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-079 — Dispensing — DEPARTMENTAL / PHARMACY

- **Source/type:** S04 `departmental-pharmacy-dispensing`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID departmental-pharmacy-dispensing; engine=pharmacy-dispensations; workflow=none. pharmacy_dispensations, patients. POST /api/reporting/centre/pharmacy-dispensations/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, inventoryItemFilter, patientFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `medications` (`src/db/schema/inpatient.ts`), `pharmacy_dispensations` (`src/db/schema/inventory.ts`), `pharmacy_dispense_allocations` (`src/db/schema/pharmacy-workflow.ts`), `inventory_movements` (`src/db/schema/inventory-control.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Report filtering, full movement ledger and controlled returns. Prescription is not dispensing; distinguish stock issue/return from charge/revenue. Preserve item and dose snapshots; no mixed-unit totals.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Pharmacists; dispensing supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-pharmacy-dispensing; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-080 — Drug movement — DEPARTMENTAL / PHARMACY

- **Source/type:** S04 `departmental-pharmacy-drug-movement`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-pharmacy-drug-movement; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `medications` (`src/db/schema/inpatient.ts`), `pharmacy_dispensations` (`src/db/schema/inventory.ts`), `pharmacy_dispense_allocations` (`src/db/schema/pharmacy-workflow.ts`), `inventory_movements` (`src/db/schema/inventory-control.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Report filtering, full movement ledger and controlled returns. Prescription is not dispensing; distinguish stock issue/return from charge/revenue. Preserve item and dose snapshots; no mixed-unit totals.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Pharmacists; dispensing supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-pharmacy-drug-movement; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-081 — Returns — DEPARTMENTAL / PHARMACY

- **Source/type:** S04 `departmental-pharmacy-returns`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-pharmacy-returns; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `inventory_movements` (`src/db/schema/inventory-control.ts`), `supplier_returns` (`src/db/schema/procurement-matching.ts`), `supplier_return_items` (`src/db/schema/procurement-matching.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Report filtering, full movement ledger and controlled returns. Supplier return is not patient medication return. Establish intended return workflow before integration.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Pharmacists; dispensing supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-pharmacy-returns; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-082 — Stock and expiry — DEPARTMENTAL / PHARMACY

- **Source/type:** S04 `departmental-pharmacy-stock-and-expiry`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-pharmacy-stock-and-expiry; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `medications` (`src/db/schema/inpatient.ts`), `pharmacy_dispensations` (`src/db/schema/inventory.ts`), `pharmacy_dispense_allocations` (`src/db/schema/pharmacy-workflow.ts`), `inventory_movements` (`src/db/schema/inventory-control.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Report filtering, full movement ledger and controlled returns. Prescription is not dispensing; distinguish stock issue/return from charge/revenue. Preserve item and dose snapshots; no mixed-unit totals.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Pharmacists; dispensing supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-pharmacy-stock-and-expiry; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-083 — Procedure lists — DEPARTMENTAL / THEATRE

- **Source/type:** S04 `departmental-theatre-procedure-lists`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-theatre-procedure-lists; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `theatre_cases` (`src/db/schema/inpatient.ts`), `theatre_bookings` (`src/db/schema/theatre-scheduling.ts`), `theatre_rooms` (`src/db/schema/theatre-scheduling.ts`), `theatre_schedule_events` (`src/db/schema/theatre-scheduling.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Actual performed cases and utilization definitions. Booking is not procedure completion. Utilization needs approved capacity, cancellation, overlap and operating-time definitions.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Theatre coordinator; surgeons; anaesthetists; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-theatre-procedure-lists; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-084 — Patient procedure reports — DEPARTMENTAL / THEATRE

- **Source/type:** S04 `departmental-theatre-patient-procedure-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-theatre-patient-procedure-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `theatre_cases` (`src/db/schema/inpatient.ts`), `theatre_bookings` (`src/db/schema/theatre-scheduling.ts`), `theatre_rooms` (`src/db/schema/theatre-scheduling.ts`), `theatre_schedule_events` (`src/db/schema/theatre-scheduling.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Actual performed cases and utilization definitions. Booking is not procedure completion. Utilization needs approved capacity, cancellation, overlap and operating-time definitions.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Theatre coordinator; surgeons; anaesthetists; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-theatre-patient-procedure-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-085 — Theatre utilization — DEPARTMENTAL / THEATRE

- **Source/type:** S04 `departmental-theatre-theatre-utilization`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID departmental-theatre-theatre-utilization; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `theatre_cases` (`src/db/schema/inpatient.ts`), `theatre_bookings` (`src/db/schema/theatre-scheduling.ts`), `theatre_rooms` (`src/db/schema/theatre-scheduling.ts`), `theatre_schedule_events` (`src/db/schema/theatre-scheduling.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Actual performed cases and utilization definitions. Booking is not procedure completion. Utilization needs approved capacity, cancellation, overlap and operating-time definitions.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Theatre coordinator; surgeons; anaesthetists; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-theatre-theatre-utilization; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-086 — ANC — DEPARTMENTAL / MATERNITY / MCH

- **Source/type:** S04 `departmental-maternity-mch-anc`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-maternity-mch-anc; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `maternity_pregnancies` (`src/db/schema/maternity.ts`), `anc_visits` (`src/db/schema/maternity.ts`), `deliveries` (`src/db/schema/maternity.ts`), `delivery_babies` (`src/db/schema/maternity.ts`), `postnatal_visits` (`src/db/schema/maternity.ts`), `immunisation_records` (`src/db/schema/maternity.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Validated grouped reports and privacy controls. Protect maternal/child linkage; multiple babies are not multiple deliveries; no statutory classification or immunisation coverage denominator inferred.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Midwives; MCH supervisor; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-maternity-mch-anc; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-087 — Deliveries — DEPARTMENTAL / MATERNITY / MCH

- **Source/type:** S04 `departmental-maternity-mch-deliveries`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-maternity-mch-deliveries; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `maternity_pregnancies` (`src/db/schema/maternity.ts`), `anc_visits` (`src/db/schema/maternity.ts`), `deliveries` (`src/db/schema/maternity.ts`), `delivery_babies` (`src/db/schema/maternity.ts`), `postnatal_visits` (`src/db/schema/maternity.ts`), `immunisation_records` (`src/db/schema/maternity.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Validated grouped reports and privacy controls. Protect maternal/child linkage; multiple babies are not multiple deliveries; no statutory classification or immunisation coverage denominator inferred.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Midwives; MCH supervisor; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-maternity-mch-deliveries; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-088 — Postnatal — DEPARTMENTAL / MATERNITY / MCH

- **Source/type:** S04 `departmental-maternity-mch-postnatal`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-maternity-mch-postnatal; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `maternity_pregnancies` (`src/db/schema/maternity.ts`), `anc_visits` (`src/db/schema/maternity.ts`), `deliveries` (`src/db/schema/maternity.ts`), `delivery_babies` (`src/db/schema/maternity.ts`), `postnatal_visits` (`src/db/schema/maternity.ts`), `immunisation_records` (`src/db/schema/maternity.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Validated grouped reports and privacy controls. Protect maternal/child linkage; multiple babies are not multiple deliveries; no statutory classification or immunisation coverage denominator inferred.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Midwives; MCH supervisor; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-maternity-mch-postnatal; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-089 — Child health — DEPARTMENTAL / MATERNITY / MCH

- **Source/type:** S04 `departmental-maternity-mch-child-health`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-maternity-mch-child-health; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `maternity_pregnancies` (`src/db/schema/maternity.ts`), `anc_visits` (`src/db/schema/maternity.ts`), `deliveries` (`src/db/schema/maternity.ts`), `delivery_babies` (`src/db/schema/maternity.ts`), `postnatal_visits` (`src/db/schema/maternity.ts`), `immunisation_records` (`src/db/schema/maternity.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Validated grouped reports and privacy controls. Protect maternal/child linkage; multiple babies are not multiple deliveries; no statutory classification or immunisation coverage denominator inferred.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Midwives; MCH supervisor; records staff; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-maternity-mch-child-health; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-090 — Patient sessions — DEPARTMENTAL / DIALYSIS

- **Source/type:** S04 `departmental-dialysis-patient-sessions`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-dialysis-patient-sessions; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `dialysis_sessions` (`src/db/schema/dialysis.ts`), `dialysis_treatment_plans` (`src/db/schema/dialysis.ts`), `dialysis_consumable_usages` (`src/db/schema/dialysis.ts`), `dialysis_patient_assessments` (`src/db/schema/dialysis.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Clinician-verified session facts and reconciled billing; no inferred completion. Scheduled is not completed treatment. Separate session clinical state, consumables, billing and posted revenue.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Dialysis nurses; nephrologists; unit manager; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-dialysis-patient-sessions; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-091 — Treatment records — DEPARTMENTAL / DIALYSIS

- **Source/type:** S04 `departmental-dialysis-treatment-records`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-dialysis-treatment-records; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `dialysis_sessions` (`src/db/schema/dialysis.ts`), `dialysis_treatment_plans` (`src/db/schema/dialysis.ts`), `dialysis_consumable_usages` (`src/db/schema/dialysis.ts`), `dialysis_patient_assessments` (`src/db/schema/dialysis.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Clinician-verified session facts and reconciled billing; no inferred completion. Scheduled is not completed treatment. Separate session clinical state, consumables, billing and posted revenue.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Dialysis nurses; nephrologists; unit manager; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-dialysis-treatment-records; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-092 — Session billing — DEPARTMENTAL / DIALYSIS

- **Source/type:** S04 `departmental-dialysis-session-billing`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-dialysis-session-billing; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `dialysis_sessions` (`src/db/schema/dialysis.ts`), `dialysis_treatment_plans` (`src/db/schema/dialysis.ts`), `dialysis_consumable_usages` (`src/db/schema/dialysis.ts`), `dialysis_patient_assessments` (`src/db/schema/dialysis.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Clinician-verified session facts and reconciled billing; no inferred completion. Scheduled is not completed treatment. Separate session clinical state, consumables, billing and posted revenue.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Dialysis nurses; nephrologists; unit manager; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-dialysis-session-billing; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-093 — Waivers — DEPARTMENTAL / SOCIAL WORK

- **Source/type:** S04 `departmental-social-work-waivers`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-social-work-waivers; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** No complete source established. Candidate tables do not prove a query.
- **Missing / risk:** Approved, confidential case and waiver workflows. No integrated social-work counselling/support register established by these candidate entities; define the workflow before reporting. Refund is not waiver.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Social workers; authorized waiver approvers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-social-work-waivers; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-094 — Counselling — DEPARTMENTAL / SOCIAL WORK

- **Source/type:** S04 `departmental-social-work-counselling`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-social-work-counselling; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** No complete source established. Candidate tables do not prove a query.
- **Missing / risk:** Approved, confidential case and waiver workflows. No integrated social-work counselling/support register established by these candidate entities; define the workflow before reporting. Refund is not waiver.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Social workers; authorized waiver approvers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-social-work-counselling; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-095 — Patient support reports — DEPARTMENTAL / SOCIAL WORK

- **Source/type:** S04 `departmental-social-work-patient-support-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID departmental-social-work-patient-support-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** No complete source established. Candidate tables do not prove a query.
- **Missing / risk:** Approved, confidential case and waiver workflows. No integrated social-work counselling/support register established by these candidate entities; define the workflow before reporting. Refund is not waiver.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Social workers; authorized waiver approvers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for departmental-social-work-patient-support-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-096 — Birth reports — RECORDS

- **Source/type:** S04 `records-birth-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID records-birth-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `deliveries` (`src/db/schema/maternity.ts`), `delivery_babies` (`src/db/schema/maternity.ts`), `maternity_pregnancies` (`src/db/schema/maternity.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined reporting data and relationships; cashier finance reconciliation where applicable. Clinical recorded birth is not a statutory birth certificate/registration; define live/stillbirth and multiple-birth rules.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Medical records officers; clinical supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-birth-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-097 — Death reports — RECORDS

- **Source/type:** S04 `records-death-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID records-death-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `admissions` (`src/db/schema/inpatient.ts`), `public_health_reports` (`src/db/schema/public-health.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined reporting data and relationships; cashier finance reconciliation where applicable. Discharge type alone is not a complete certified mortality register; cause-of-death and certification workflow must be defined.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Medical records officers; clinical supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-death-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-098 — Current inpatient lists — RECORDS

- **Source/type:** S04 `records-current-inpatient-lists`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID records-current-inpatient-lists; engine=current-inpatients; workflow=none. admissions, patients, wards, beds. POST /api/reporting/centre/current-inpatients/{options,generate,export} Filters: facility, literal search, patientFilter, wardFilter, bedFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `admissions` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined reporting data and relationships; cashier finance reconciliation where applicable. Patient identity/link scope, duplicate rows, denominator, event dates and clinical definitions require review.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Medical records officers; clinical supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-current-inpatient-lists; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-099 — Patient reports — RECORDS

- **Source/type:** S04 `records-patient-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID records-patient-reports; engine=patient-registrations; workflow=none. patients. POST /api/reporting/centre/patient-registrations/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, patientFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `admissions` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Complete longitudinal records and governed patient-report definitions; the available view covers facility registrations only. Patient identity/link scope, duplicate rows, denominator, event dates and clinical definitions require review.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Medical records officers; clinical supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-patient-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-100 — Patient review reports — RECORDS

- **Source/type:** S04 `records-patient-review-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID records-patient-review-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `admissions` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined reporting data and relationships; cashier finance reconciliation where applicable. Patient identity/link scope, duplicate rows, denominator, event dates and clinical definitions require review.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Medical records officers; clinical supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-patient-review-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-101 — Unregistered patient reports — RECORDS

- **Source/type:** S04 `records-unregistered-patient-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID records-unregistered-patient-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** No complete source established. Candidate tables do not prove a query.
- **Missing / risk:** Defined reporting data and relationships; cashier finance reconciliation where applicable. No complete unregistered-person workflow is established; absence from patients cannot be enumerated as an unregistered patient.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Medical records officers; clinical supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-unregistered-patient-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-102 — Referral reports — RECORDS

- **Source/type:** S04 `records-referral-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID records-referral-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `referrals` (`src/db/schema/referrals.ts`), `referral_documents` (`src/db/schema/referrals.ts`), `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined reporting data and relationships; cashier finance reconciliation where applicable. Distinguish outgoing/incoming/accepted/completed referrals, document access and facility event ownership; do not count all states as completed care.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Medical records officers; clinical supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-referral-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-103 — OPD diagnosis reports — RECORDS

- **Source/type:** S04 `records-opd-diagnosis-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID records-opd-diagnosis-reports; engine=outpatient-diagnoses; workflow=none. encounters, patients, departments, diagnoses. POST /api/reporting/centre/outpatient-diagnoses/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, status, patientFilter, departmentFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `admissions` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Recorded encounter/diagnosis register only; deduplicated morbidity, verified MOH 705 definitions and facility acceptance remain outstanding. Patient identity/link scope, duplicate rows, denominator, event dates and clinical definitions require review.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Medical records officers; clinical supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-opd-diagnosis-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-104 — IPD diagnosis reports — RECORDS

- **Source/type:** S04 `records-ipd-diagnosis-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID records-ipd-diagnosis-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `admissions` (`src/db/schema/inpatient.ts`), `encounters` (`src/db/schema/clinical.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `patients` (`src/db/schema/patients.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined reporting data and relationships; cashier finance reconciliation where applicable. Patient identity/link scope, duplicate rows, denominator, event dates and clinical definitions require review.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Medical records officers; clinical supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-ipd-diagnosis-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-105 — Triage analysis — RECORDS

- **Source/type:** S04 `records-triage-analysis`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID records-triage-analysis; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `observations` (`src/db/schema/clinical.ts`), `encounters` (`src/db/schema/clinical.ts`), `queues` (`src/db/schema/clinical.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined reporting data and relationships; cashier finance reconciliation where applicable. Define observations/codes, acuity scale and timestamp provenance; do not infer triage category from a single vital sign.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Medical records officers; clinical supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-triage-analysis; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-106 — Doctors' workload — RECORDS

- **Source/type:** S04 `records-doctors-workload`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID records-doctors-workload; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `encounters` (`src/db/schema/clinical.ts`), `practitioners` (`src/db/schema/patients.ts`), `users` (`src/db/schema/auth.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined reporting data and relationships; cashier finance reconciliation where applicable. Linked practitioner user is available for some encounters; define workload units, team attribution and completion state without inferring from free-text names.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Medical records officers; clinical supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-doctors-workload; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-107 — Nurses' workload — RECORDS

- **Source/type:** S04 `records-nurses-workload`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID records-nurses-workload; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `nursing_notes` (`src/db/schema/inpatient.ts`), `inpatient_bed_occupancies` (`src/db/schema/inpatient.ts`), `users` (`src/db/schema/auth.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined reporting data and relationships; cashier finance reconciliation where applicable. A note count is not nursing workload, staffing hours or acuity; establish approved units and actor coverage.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Medical records officers; clinical supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-nurses-workload; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-108 — Cashier workload — RECORDS

- **Source/type:** S04 `records-cashier-workload`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID records-cashier-workload; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `billing_payments` (`src/db/schema/billing.ts`), `billing_invoices` (`src/db/schema/billing.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined reporting data and relationships; cashier finance reconciliation where applicable. Cashier name is recorded free text, not verified staff identity. Define workload units and attribution before grouping.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Medical records officers; clinical supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-cashier-workload; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-109 — Inpatient discharges — RECORDS

- **Source/type:** S04 `records-inpatient-discharges`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** High / **PARTIAL**; Partially supported.
- **Actual current support:** Catalogue ID records-inpatient-discharges; engine=inpatient-discharges; workflow=none. admissions, patients, wards, beds. POST /api/reporting/centre/inpatient-discharges/{options,generate,export} Filters: facility, inclusive from/to (max 366 days), literal search, patientFilter, wardFilter, bedFilter. Exports: PDF, XLSX, CSV. Letterhead: Existing common active-facility PDF/Print PDF renderer.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `admissions` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Defined reporting data and relationships; cashier finance reconciliation where applicable. Patient identity/link scope, duplicate rows, denominator, event dates and clinical definitions require review.
- **Task:** Complete the missing named scope using existing query/workflow/renderer; do not mark the operational subset as a complete business report.
- **Dependencies:** D03, D10; source owners: Medical records officers; clinical supervisors; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-inpatient-discharges; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-110 — MOH 505-IDSR — RECORDS

- **Source/type:** S04 `records-moh-505-idsr`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID records-moh-505-idsr; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `admissions` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Current authoritative forms, indicator dictionaries, approved data mappings and submission process. Official form/version, case definitions, aggregation, age/sex bands, deduplication, reporting period and KHIS/MOH validation/sign-off are required. Existing operational registers do not establish these rules.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10, D12; source owners: Records officers; authorized statutory reporting officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-moh-505-idsr; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-111 — MOH 705A — RECORDS

- **Source/type:** S04 `records-moh-705a`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID records-moh-705a; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `admissions` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Current authoritative forms, indicator dictionaries, approved data mappings and submission process. Official form/version, case definitions, aggregation, age/sex bands, deduplication, reporting period and KHIS/MOH validation/sign-off are required. Existing operational registers do not establish these rules.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10, D12; source owners: Records officers; authorized statutory reporting officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-moh-705a; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-112 — MOH 705B — RECORDS

- **Source/type:** S04 `records-moh-705b`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID records-moh-705b; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `admissions` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Current authoritative forms, indicator dictionaries, approved data mappings and submission process. Official form/version, case definitions, aggregation, age/sex bands, deduplication, reporting period and KHIS/MOH validation/sign-off are required. Existing operational registers do not establish these rules.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10, D12; source owners: Records officers; authorized statutory reporting officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-moh-705b; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-113 — MOH 717 — RECORDS

- **Source/type:** S04 `records-moh-717`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID records-moh-717; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `admissions` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Current authoritative forms, indicator dictionaries, approved data mappings and submission process. Official form/version, case definitions, aggregation, age/sex bands, deduplication, reporting period and KHIS/MOH validation/sign-off are required. Existing operational registers do not establish these rules.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10, D12; source owners: Records officers; authorized statutory reporting officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-moh-717; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-114 — MOH 301-IPD admissions — RECORDS

- **Source/type:** S04 `records-moh-301-ipd-admissions`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID records-moh-301-ipd-admissions; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `admissions` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Current authoritative forms, indicator dictionaries, approved data mappings and submission process. Official form/version, case definitions, aggregation, age/sex bands, deduplication, reporting period and KHIS/MOH validation/sign-off are required. Existing operational registers do not establish these rules.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10, D12; source owners: Records officers; authorized statutory reporting officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-moh-301-ipd-admissions; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-115 — MOH 204-OPD register — RECORDS

- **Source/type:** S04 `records-moh-204-opd-register`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID records-moh-204-opd-register; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `admissions` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Current authoritative forms, indicator dictionaries, approved data mappings and submission process. Official form/version, case definitions, aggregation, age/sex bands, deduplication, reporting period and KHIS/MOH validation/sign-off are required. Existing operational registers do not establish these rules.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10, D12; source owners: Records officers; authorized statutory reporting officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-moh-204-opd-register; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-116 — MOH 240 laboratory and radiology reports — RECORDS

- **Source/type:** S04 `records-moh-240-laboratory-and-radiology-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID records-moh-240-laboratory-and-radiology-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `admissions` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Current authoritative forms, indicator dictionaries, approved data mappings and submission process. Official form/version, case definitions, aggregation, age/sex bands, deduplication, reporting period and KHIS/MOH validation/sign-off are required. Existing operational registers do not establish these rules.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10, D12; source owners: Records officers; authorized statutory reporting officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-moh-240-laboratory-and-radiology-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-117 — MOH financial reports — RECORDS

- **Source/type:** S04 `records-moh-financial-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID records-moh-financial-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `patients` (`src/db/schema/patients.ts`), `encounters` (`src/db/schema/clinical.ts`), `diagnoses` (`src/db/schema/clinical.ts`), `admissions` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Current authoritative forms, indicator dictionaries, approved data mappings and submission process. Official form/version, case definitions, aggregation, age/sex bands, deduplication, reporting period and KHIS/MOH validation/sign-off are required. Existing operational registers do not establish these rules.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10, D12; source owners: Records officers; authorized statutory reporting officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for records-moh-financial-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-118 — Employee list — HR

- **Source/type:** S04 `hr-employee-list`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID hr-employee-list; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `hr_employees` (`src/db/schema/workforce.ts`), `hr_departments` (`src/db/schema/workforce.ts`), `hr_designations` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Employment register and HR-authorized report. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-employee-list; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-119 — Employee summaries — HR

- **Source/type:** S04 `hr-employee-summaries`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID hr-employee-summaries; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `hr_employees` (`src/db/schema/workforce.ts`), `hr_departments` (`src/db/schema/workforce.ts`), `hr_designations` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Employment register and HR-authorized report. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-employee-summaries; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-120 — Salary summaries — HR

- **Source/type:** S04 `hr-salary-summaries`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID hr-salary-summaries; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `hr_employees` (`src/db/schema/workforce.ts`), `hr_departments` (`src/db/schema/workforce.ts`), `payroll_runs` (`src/db/schema/workforce.ts`), `payroll_payslips` (`src/db/schema/workforce.ts`), `payroll_payslip_lines` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Payroll and approved current-year HR/KRA and secure payment policies. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-salary-summaries; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-121 — Individual payslips — HR

- **Source/type:** S04 `hr-individual-payslips`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID hr-individual-payslips; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `hr_employees` (`src/db/schema/workforce.ts`), `hr_departments` (`src/db/schema/workforce.ts`), `payroll_runs` (`src/db/schema/workforce.ts`), `payroll_payslips` (`src/db/schema/workforce.ts`), `payroll_payslip_lines` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Payroll and approved current-year HR/KRA and secure payment policies. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-individual-payslips; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-122 — All payslips — HR

- **Source/type:** S04 `hr-all-payslips`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID hr-all-payslips; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `hr_employees` (`src/db/schema/workforce.ts`), `hr_departments` (`src/db/schema/workforce.ts`), `payroll_runs` (`src/db/schema/workforce.ts`), `payroll_payslips` (`src/db/schema/workforce.ts`), `payroll_payslip_lines` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Payroll and approved current-year HR/KRA and secure payment policies. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-all-payslips; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-123 — Attendance — HR

- **Source/type:** S04 `hr-attendance`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID hr-attendance; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `hr_employees` (`src/db/schema/workforce.ts`), `hr_attendance` (`src/db/schema/workforce.ts`), `hr_shifts` (`src/db/schema/workforce.ts`), `hr_roster_entries` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Payroll and approved current-year HR/KRA and secure payment policies. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-attendance; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-124 — Overtime — HR

- **Source/type:** S04 `hr-overtime`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID hr-overtime; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `hr_employees` (`src/db/schema/workforce.ts`), `hr_attendance` (`src/db/schema/workforce.ts`), `hr_shifts` (`src/db/schema/workforce.ts`), `hr_roster_entries` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Payroll and approved current-year HR/KRA and secure payment policies. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-overtime; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-125 — Leave reports — HR

- **Source/type:** S04 `hr-leave-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID hr-leave-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `hr_employees` (`src/db/schema/workforce.ts`), `hr_leave_requests` (`src/db/schema/workforce.ts`), `hr_leave_types` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Payroll and approved current-year HR/KRA and secure payment policies. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-leave-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-126 — Monthly deductions — HR

- **Source/type:** S04 `hr-monthly-deductions`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID hr-monthly-deductions; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `hr_employees` (`src/db/schema/workforce.ts`), `hr_departments` (`src/db/schema/workforce.ts`), `payroll_runs` (`src/db/schema/workforce.ts`), `payroll_payslips` (`src/db/schema/workforce.ts`), `payroll_payslip_lines` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Payroll and approved current-year HR/KRA and secure payment policies. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-monthly-deductions; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-127 — Monthly bank summaries — HR

- **Source/type:** S04 `hr-monthly-bank-summaries`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID hr-monthly-bank-summaries; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `hr_employees` (`src/db/schema/workforce.ts`), `hr_departments` (`src/db/schema/workforce.ts`), `payroll_runs` (`src/db/schema/workforce.ts`), `payroll_payslips` (`src/db/schema/workforce.ts`), `payroll_payslip_lines` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Payroll and approved current-year HR/KRA and secure payment policies. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-monthly-bank-summaries; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-128 — Individual bank summaries — HR

- **Source/type:** S04 `hr-individual-bank-summaries`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID hr-individual-bank-summaries; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `hr_employees` (`src/db/schema/workforce.ts`), `hr_departments` (`src/db/schema/workforce.ts`), `payroll_runs` (`src/db/schema/workforce.ts`), `payroll_payslips` (`src/db/schema/workforce.ts`), `payroll_payslip_lines` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Payroll and approved current-year HR/KRA and secure payment policies. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-individual-bank-summaries; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-129 — P9A reports — HR

- **Source/type:** S04 `hr-p9a-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID hr-p9a-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `payroll_form_profiles` (`src/db/schema/workforce.ts`), `payroll_statutory_versions` (`src/db/schema/workforce.ts`), `payroll_payslips` (`src/db/schema/workforce.ts`), `payroll_payslip_lines` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Payroll and approved current-year HR/KRA and secure payment policies. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-p9a-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-130 — P10 reports — HR

- **Source/type:** S04 `hr-p10-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID hr-p10-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `payroll_form_profiles` (`src/db/schema/workforce.ts`), `payroll_statutory_versions` (`src/db/schema/workforce.ts`), `payroll_payslips` (`src/db/schema/workforce.ts`), `payroll_payslip_lines` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Payroll and approved current-year HR/KRA and secure payment policies. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-p10-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-131 — P10A reports — HR

- **Source/type:** S04 `hr-p10a-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **BLOCKED**; Blocked by missing source data or approved business definitions.
- **Actual current support:** Catalogue ID hr-p10a-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `payroll_form_profiles` (`src/db/schema/workforce.ts`), `payroll_statutory_versions` (`src/db/schema/workforce.ts`), `payroll_payslips` (`src/db/schema/workforce.ts`), `payroll_payslip_lines` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Payroll and approved current-year HR/KRA and secure payment policies. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-p10a-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-132 — Locum reports — HR

- **Source/type:** S04 `hr-locum-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID hr-locum-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `hr_employees` (`src/db/schema/workforce.ts`), `hr_departments` (`src/db/schema/workforce.ts`), `payroll_runs` (`src/db/schema/workforce.ts`), `payroll_payslips` (`src/db/schema/workforce.ts`), `payroll_payslip_lines` (`src/db/schema/workforce.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Payroll and approved current-year HR/KRA and secure payment policies. Payroll and bank details need dedicated source/export permissions. Statutory output requires approved form/version and effective-dated mappings; do not infer current statutory rates.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Restricted HR/payroll officers; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for hr-locum-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-133 — System user list — ACTIVITY

- **Source/type:** S04 `activity-system-user-list`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID activity-system-user-list; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `audit_logs` (`src/db/schema/public-health.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Durable complete logs, server filtering/pagination, specific access policy and exports. Audit logs may contain sensitive details. Require dedicated source/export authorization, redaction, retention and precise event semantics, not unrestricted JSON export.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Authorized audit officers; system administrators; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for activity-system-user-list; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-134 — Queue reports — ACTIVITY

- **Source/type:** S04 `activity-queue-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID activity-queue-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `audit_logs` (`src/db/schema/public-health.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Durable complete logs, server filtering/pagination, specific access policy and exports. Audit logs may contain sensitive details. Require dedicated source/export authorization, redaction, retention and precise event semantics, not unrestricted JSON export.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Authorized audit officers; system administrators; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for activity-queue-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-135 — Complete activity logs — ACTIVITY

- **Source/type:** S04 `activity-complete-activity-logs`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID activity-complete-activity-logs; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `audit_logs` (`src/db/schema/public-health.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Durable complete logs, server filtering/pagination, specific access policy and exports. Audit logs may contain sensitive details. Require dedicated source/export authorization, redaction, retention and precise event semantics, not unrestricted JSON export.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Authorized audit officers; system administrators; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for activity-complete-activity-logs; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-136 — Activity logs by user — ACTIVITY

- **Source/type:** S04 `activity-activity-logs-by-user`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID activity-activity-logs-by-user; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `audit_logs` (`src/db/schema/public-health.ts`), `users` (`src/db/schema/auth.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Durable complete logs, server filtering/pagination, specific access policy and exports. Audit logs may contain sensitive details. Require dedicated source/export authorization, redaction, retention and precise event semantics, not unrestricted JSON export.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Authorized audit officers; system administrators; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for activity-activity-logs-by-user; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-137 — Failed login reports — ACTIVITY

- **Source/type:** S04 `activity-failed-login-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID activity-failed-login-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `login_attempts` (`src/db/schema/auth.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Durable complete logs, server filtering/pagination, specific access policy and exports. Failed-attempt records contain identifiers/IP addresses. Restricted security reporting/redaction is required; avoid account enumeration.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Authorized audit officers; system administrators; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for activity-failed-login-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-138 — Patient record access logs — ACTIVITY

- **Source/type:** S04 `activity-patient-record-access-logs`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID activity-patient-record-access-logs; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `patient_record_access_logs` (`src/db/schema/patients.ts`), `users` (`src/db/schema/auth.ts`), `patients` (`src/db/schema/patients.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Durable complete logs, server filtering/pagination, specific access policy and exports. Audit logs may contain sensitive details. Require dedicated source/export authorization, redaction, retention and precise event semantics, not unrestricted JSON export.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Authorized audit officers; system administrators; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for activity-patient-record-access-logs; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-139 — Financial approval logs — ACTIVITY

- **Source/type:** S04 `activity-financial-approval-logs`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID activity-financial-approval-logs; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `expense_requests` (`src/db/schema/financial-ledger.ts`), `procurement_requisition_events` (`src/db/schema/procurement.ts`), `billing_refund_requests` (`src/db/schema/billing.ts`), `approval_policies` (`src/db/schema/approval-policies.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Durable complete logs, server filtering/pagination, specific access policy and exports. Different approval state machines and evidence schemas must not be flattened into an invented common event chronology.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Authorized audit officers; system administrators; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for activity-financial-approval-logs; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-140 — SMS reports — ACTIVITY

- **Source/type:** S04 `activity-sms-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID activity-sms-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `notification_alert_states` (`src/db/schema/notifications.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Authorized provider and verified delivery events. No complete durable SMS delivery/provider evidence source established; UI alerts are not SMS delivery receipts.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Authorized audit officers; system administrators; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for activity-sms-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-141 — Notification delivery reports — ACTIVITY

- **Source/type:** S04 `activity-notification-delivery-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID activity-notification-delivery-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `notification_alert_states` (`src/db/schema/notifications.ts`), `notification_read_receipts` (`src/db/schema/notifications.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Authorized provider and verified delivery events. An in-app read receipt is not external delivery; define channels and trusted provider status.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Authorized audit officers; system administrators; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for activity-notification-delivery-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-142 — Messages reports — ACTIVITY

- **Source/type:** S04 `activity-messages-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID activity-messages-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** No complete source established. Candidate tables do not prove a query.
- **Missing / risk:** Message/delivery data and report definitions. No complete messaging register/channel model established. Define source and restricted content projection first.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Authorized audit officers; system administrators; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for activity-messages-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-143 — Custom administrative reports — ACTIVITY

- **Source/type:** S04 `activity-custom-administrative-reports`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID activity-custom-administrative-reports; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** No complete source established. Candidate tables do not prove a query.
- **Missing / risk:** Governed report definitions or durable job-run failure records. Custom report specification absent; do not expose arbitrary SQL or unrestricted database export.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Authorized audit officers; system administrators; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for activity-custom-administrative-reports; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

### CAT-144 — Background job failures — ACTIVITY

- **Source/type:** S04 `activity-background-job-failures`; S01 §8; ENGINEERING_CATALOGUE_SCOPE_UNCONFIRMED (not signed client inclusion). **Priority/status:** Medium / **NOT IMPLEMENTED**; Unavailable.
- **Actual current support:** Catalogue ID activity-background-job-failures; engine=none; workflow=none. No integrated query; candidate entities are requirements, not implemented joins. NONE in Reporting Centre; source-module APIs do not imply report acceptance Filters: none integrated. Exports: none integrated. Letterhead: Not integrated; reuse common renderer when implemented.
- **Schema candidate evidence:** `billing_charge_attempts` (`src/db/schema/billing.ts`), `inpatient_bed_billing_work` (`src/db/schema/inpatient.ts`). Candidate tables do not prove a query.
- **Missing / risk:** Governed report definitions or durable job-run failure records. These are domain-specific work queues, not a complete global job registry. Define retry/error redaction and intended job coverage.
- **Task:** Approve exact source semantics then implement/integrate this output into the existing Reporting Centre; reuse owning-module document builder where it already exists.
- **Dependencies:** D03, D10; source owners: Authorized audit officers; system administrators; client reporting owner.
- **Acceptance / verification:** Owner approves purpose, source event, date/status/department semantics and output fixture for activity-background-job-failures; Synthetic persisted rows from two facilities/two tenants yield exact accepted values; unauthorized source/export access denied; Relevant date boundaries, selected filters, empty/error and calculations pass independently; Screen and full saved PDF/XLSX values agree; active scoped letterhead/historical or explicit fallback policy verified as applicable; no truncation or fabricated missing values. Use the per-child real-DB/browser/saved-file gate above; shared current source paths: `src/reporting/report-catalogue.ts`, `report-centre.auth.ts`, `report-centre.selection.ts`, `report-centre.service.ts`, `report-centre.operational-definitions.ts`, `report-centre.operational-queries.ts`, `report-centre.ledger-queries.ts`, `report-centre.export.ts` under `src/reporting/`; document workflows use `src/documents/document.service.ts`. **Synthetic sufficient:** no; output owner acceptance needed. **Phase:**5.

## 7. Critical cross-module workflows and first unresolved links

A first _unverified evidence boundary_ is not asserted to be a broken implementation. Where current source has the whole basic chain, the register says so. Where a link is actually absent or permissive, it is explicitly identified.

### WF-01 — Registration → reception → OPD → diagnosis → prescription → dispensing → billing → receipt

- **Traced chain:** patients.routes + queries/patients MRN → appointments/queues + encounters.routes → diagnoses/medications.routes → pharmacy.routes + inventory.service dispenseFefoScoped → billing outbox → charge recovery → finalized invoice → payment/receipt.
- **First unresolved link:** First evidence boundary: concurrent registration/duplicate-policy and real role handoff have not been freshly reaccepted. First confirmed functional gap in the extended pharmacy loop: patient return/reversal policy/chain, not initial dispensing.
- **Classification:** UNVERIFIED chain; PARTIAL return workflow.
- **Downstream consequence:** Cannot certify a single patient journey or complete price/receipt correctness by adding isolated tests; failed billing work may remain pending.
- **Requirement IDs:** PAT-001, PAT-004, REC-001, OPD-001, OPD-002, PHA-001, PHA-002, BIL-002, BIL-004.
- **Required end-to-end proof:** One synthetic patient through normal staff role logins; persist IDs across every handoff; dispense partially twice, interrupt billing and retry, settle by approved channel, inspect exact receipt/source-to-GL.

### WF-02 — OPD/lab order → specimen → result → verification → clinical access → billing

- **Traced chain:** laboratory.routes → queries/laboratory sample collection/accession/result verification/completion → clinical journey/portal verified subset → document.service buildLaboratoryReportDocument → billing service-charges/outbox.
- **First unresolved link:** Official report issue: builder accepts any recorded result and only warns about unverified rows; approved final-release boundary missing. Earlier ordering/specimen/verification source exists.
- **Classification:** DEFECTIVE final-output eligibility (source-confirmed; no fresh DB exploit).
- **Downstream consequence:** Unverified preliminary values may be issued as ordinary Laboratory Report; does not prove current production exposure. Clinical release/billing UAT remains incomplete.
- **Requirement IDs:** LAB-001, LAB-002, LAB-003, DOC-004, BIL-002.
- **Required end-to-end proof:** Order exact panel/sample; test duplicate/wrong patient, mixed verification, premature PDF denial, approved final result access and exactly-once charge/recovery.

### WF-03 — Radiology request → consent → performed study → report → clinical access → billing

- **Traced chain:** radiology.routes request returns billing:null → patient-documents procedure-specific consent +0100 gate → queries/laboratory imaging report/performed transition → document.service buildRadiologyReportDocument → radiologyChargeRequest → charge recovery.
- **First unresolved link:** Consent/performance controls exist; final issue checks reportedAt OR findings, not the approved performed/released final state.
- **Classification:** PARTIAL/DEFECTIVE final-release rule (DOC-004).
- **Downstream consequence:** A findings-only record can satisfy printable eligibility; consent presence metadata is not cryptographic signer proof; no proof of a deployed bypass.
- **Requirement IDs:** RAD-001, RAD-002, RAD-003, DOC-004, BIL-002.
- **Required end-to-end proof:** Request with no charge, deny generic/missing consent, verify specific procedure or audited exception, perform/report, gate final issue, bill once and test canceled/unperformed negative cases.

### WF-04 — Admission → bed allocation → ward services → pharmacy/lab charges → discharge → final invoice

- **Traced chain:** inpatient.routes and ward-bed.service occupancy → nursing.service vitals/handover → service charges and occupancy billing policy/recovery → finalized-invoice.service → document.service discharge summary.
- **First unresolved link:** Cross-department all-charge readiness and discharge/finalization barrier not proven; summary PDF requires text only and does not enforce discharged state.
- **Classification:** PARTIAL chain; DEFECTIVE final-summary issue contract.
- **Downstream consequence:** Final discharge package may omit pending charges or be issued before approved discharge; bed rules cannot be inferred from a summary.
- **Requirement IDs:** IPD-001, IPD-002, IPD-003, INV-005, DOC-004, BIL-002.
- **Required end-to-end proof:** Occupied bed/ward transfer/midnight/same-day case with medication/lab services and failed billing retry; finalization policy checks pending work; exact summary/invoice/receipt and old occupancy retained.

### WF-05 — Pharmacy purchase → GRN → stock/lot balance → dispensing → billing → inventory reports

- **Traced chain:** procurement order/receiving postGoodsReceivedNote → inventory batches/item/movement + inventory-accounting policy → dispenseFefoScoped + immutable price → clinical billing outbox → inventory current snapshots + inventory-movements report.
- **First unresolved link:** No freshly accepted complete costed opening/receipt→lot→dispense→movement/GL→report tie-out; recorded movement report deliberately lacks verified historical opening/closing valuation.
- **Classification:** UNVERIFIED costed chain; PARTIAL broad stock report.
- **Downstream consequence:** Cannot infer inventory valuation/profit/complete balances from current stock or per-item signed movement nets; different units never added.
- **Requirement IDs:** PRC-004, INV-001, INV-003, INV-004, PHA-001, BIL-007, RPT-004.
- **Required end-to-end proof:** Two items/different units, partial receipts/split lots/expiry/retry; reconcile received less dispensed/returns to lots/item/movements and accepted GL; compare full saved report files.

### WF-06 — Requisition → approval → LPO → GRN → supplier AP → payment → accounting

- **Traced chain:** requisitions create/submit/decide/convert → procurement transitionPurchaseOrder → receiving postGoodsReceivedNote/createSupplierInvoice → matching assertPayable/overrideMatch → paySupplierInvoice + inventory/AP journal bridge.
- **First unresolved link:** No missing generic AP/payment service found. First unresolved evidence link is approved role/threshold/contract configuration and complete real-browser chain, including mismatch override.
- **Classification:** UNVERIFIED end-to-end; PARTIAL contract/issue-policy scope.
- **Downstream consequence:** Old reports saying supplier invoices/payments are absent are wrong; existence still does not prove approved supplier terms, payable/GL correctness or UAT.
- **Requirement IDs:** PRC-001, PRC-002, PRC-003, PRC-004, PRC-005, PRC-006, ACC-001.
- **Required end-to-end proof:** One approved requisition/PO with partial GRN, invoice variance, independent approved override, partial/full settlement and return/credit; exact AP/clearing/stock/GL and document evidence; duplicate/concurrent denial.

### WF-07 — Invoice → payment → receipt → reviewed journal → ledger → statements

- **Traced chain:** finalized-invoice.service → payments.service + bank verification → document.service receipt → billing-posting postBillingSourceScoped → source-ledger/billing-GL diagnostics → posted statement engines.
- **First unresolved link:** Receipt→reviewed GL is an explicit separate controlled action, not automatic atomic full-system settlement. Complete posting coverage and mappings are not accepted.
- **Classification:** PARTIAL accepted-accounting scope; UNVERIFIED whole chain.
- **Downstream consequence:** Recorded collections can differ from posted cash/AR/revenue until review; balanced journal alone does not validate recognition/classification; no cash-flow product.
- **Requirement IDs:** BIL-003, BIL-004, BNK-001, ACC-001, ACC-002, ACC-003, ACC-004.
- **Required end-to-end proof:** Known invoice with patient/insurer allocation and partial payment/refund; interrupt between receipt and reviewed journal; diagnostics expose gap; safe retry, reversal and posted statement/control-account reconciliation.

### WF-08 — Annual financial budget → actual financial performance → variance

- **Traced chain:** financial-budget model/engine/service (0098) → posted journals and accounting reports exist separately → no approved financial budget-line/account/department actual mapping.
- **First unresolved link:** Financial budget line → correctly scoped recognized posted actual is not implemented/approved.
- **Classification:** NOT IMPLEMENTED mapping/variance.
- **Downstream consequence:** No honest budget-versus-actual result; projection, zero assumption or arbitrary department revenue cannot be substituted.
- **Requirement IDs:** FIN-001, FIN-002, FIN-003, ACC-002, ACC-003.
- **Required end-to-end proof:** Approved budget revision and independently posted sample period; account/department mappings, unposted sources and signed variance convention; source drill-down and PDF/XLSX parity.

### WF-09 — Procurement plan → approved procurement → actual purchases → plan comparison

- **Traced chain:** planning scoped approved/versioned projections → operational requisition/PO/GRN/AP exist independently → reports.service ACTUAL explicitly409 ACTUALS_NOT_AVAILABLE.
- **First unresolved link:** Plan/version/source line → approved procurement/receipt/invoice attribution is missing.
- **Classification:** NOT IMPLEMENTED explicit attribution/variance.
- **Downstream consequence:** Planned quantities cannot become stock/purchases/expense automatically; commitment, received, invoiced and paid bases need separate approved meanings.
- **Requirement IDs:** PLN-001, PLN-002, PLN-004, PRC-001, PRC-005.
- **Required end-to-end proof:** Approved plan with partial real purchases/returns; explicit source links and basis; exact remaining commitments/actual/variance, no duplicate cost and original plan/import bytes unchanged.

### WF-10 — Patient document upload → authorization → portal release → secure viewing

- **Traced chain:** PatientDocumentsPanel → patient-file-validation + immutable original/version tables → patient-documents permission and explicit release per version → portal session scoped list/file + access audit.
- **First unresolved link:** No missing basic upload/release/view link found in current source. First unresolved boundary is client release/retention/signer policy and fresh same-build multi-patient DB/browser reacceptance.
- **Classification:** PARTIAL owner acceptance; historically synthetic end-to-end supported.
- **Downstream consequence:** Do not reimplement file storage from older missing-feature claims; uploaded content still needs staff review and old released versions need explicit withdrawal after correction.
- **Requirement IDs:** DOC-001, DOC-002, POR-001, POR-002.
- **Required end-to-end proof:** Two patient/two facility normal logins; original-byte match, unsafe/oversized upload refusal, explicit release/withdrawal, correction version isolation, no staff metadata, failed mandatory audit denies file bytes.

### WF-11 — Report generation → facility/date filters → PDF/XLSX export → active letterhead

- **Traced chain:** existing ReportWorkbench and selectors → report-centre auth/selection/service/operational+ledger queries → common export service→active facility letterhead/render → saved historical actual browser PDFs/XLSX incl Batch1.
- **First unresolved link:** For the 28 supported partial entries the bounded path exists; for the other116 catalogue labels the first missing link is query/workflow integration or approved source/business definitions.
- **Classification:** PARTIAL existing paths; 116 unavailable/definition-blocked outputs.
- **Downstream consequence:** Cannot claim all 144 reports; stock movement net not balance/valuation, posted income not cash settlement; unavailable document navigation may coexist with owning-module PDF.
- **Requirement IDs:** RPT-001, RPT-002, RPT-003, RPT-004, BRD-001, DOC-004.
- **Required end-to-end proof:** Each approved engine/workflow independently seeded across tenant/facility/date boundaries; ordinary login/actual download, compare every required cell/page/header/full filtered result and active/historical/fallback stationery.

## 8. Unresolved client decisions and external dependencies

| ID  | Decision/input owner                                        | Exact unresolved decision/input                                                                                                                                                                                 | Impact                                                                                                         |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| D01 | Client sponsor                                              | Original contract/meeting notes, requirement wording, client three-phase agreement and signed launch/exclusion scope.                                                                                           | GOV-001/GOV-003 and final contractual completeness                                                             |
| D02 | Client finance/procurement/records owners                   | Supply authoritative original XLS/XLSX/CSV/screenshot/layout assets with version/hash; authorize retention and formula interpretation.                                                                          | Original-source reexecution and workbook equality; do not substitute synthetic exports                         |
| D03 | Client sponsor and department leads                         | Included clinical specialties, payroll/website/cash/report outputs, workload units and named acceptance roles; define mobile/printer support.                                                                   | Avoid imposing engineering catalogue/recommendations as client contract                                        |
| D04 | Security lead and data controller                           | Private incident-response disposition, credential/session rotation evidence, retention/breach assessment and approved evidence custody.                                                                         | Historical exposure closure; no patient/secret disclosure in this register                                     |
| D05 | Clinical/records/security leads                             | Role/department matrix, cross-facility care and portal release/sharing policy, recovery/MFA requirements, retention and signature/exception authority.                                                          | Server-side access controls and clinical release decisions                                                     |
| D06 | Clinical, lab, radiology, pharmacy and specialty leads      | Approved tests/specimens/reference ranges/drug units/protocols, draft/final/correction criteria, consumption packs/returns/wastage.                                                                             | Core clinical and consumed-stock/revenue integrity                                                             |
| D07 | Payroll/tax professionals and authorized terminology owners | Current authoritative statutory/tax rates/forms/effective dates, special cases and WHO release/license/access.                                                                                                  | Statutory configuration and unsupported policy cases; no research seeded as verified law                       |
| D08 | Finance/procurement owners                                  | COA/openings/periods, currency, recognition, cash/bank-only policy, bed-night/cutoff/grace, costing/capitalization, credit/waiver/AP policy, supplier terms/approvals and budget actual bases/mappings.         | Correct financial statements, stock/AP/AR controls and variance                                                |
| D09 | Authorized facility records/finance owner                   | Approve exact letterhead/template/stamp/signer, margins and immutable issue/reprint/amendment policy per document.                                                                                              | Decorative artwork does not establish signer authority                                                         |
| D10 | Client reporting owners and finance/clinical leads          | Sign required report shortlist plus exact source events, formulas, as-of/period/denominator/department definitions and golden output fixtures.                                                                  | 144 engineering labels are not a signed report contract                                                        |
| D11 | Client treasury and each bank/Safaricom provider            | Confirm required manual/API capabilities, accounts/sandbox onboarding, official authentication/statement/transaction/callback contracts, credentials securely provisioned and provider UAT/production approval. | KCB/Equity token checks, NCBA/Co-op boundaries and Daraja settlement still require code as well as credentials |
| D12 | Authorized MOH/KHIS/DHIS2/SHA/DHA counterpart and client    | Official forms/profiles/indicator versions, facility identifiers, national system access/certificates/consent and authorized conformance sandbox/approval.                                                      | Local surveillance/FHIR/mock status is not accepted national transmission                                      |
| D13 | Britam/other insurers/SHA and client payer team             | Direct vs authorized gateway, provider IDs, tariffs/schemes/benefits, API/file attachment and callback contracts, secure credentials and per-capability acceptance.                                             | Manual eligibility/preauth/claim preparation is not electronic payer acknowledgment or bank settlement         |
| D14 | Client channel owner and messaging/website provider         | Approved website client/site install, SMS/email gateway/sender/SMTP/consent templates, secure credentials, delivery and retry contract.                                                                         | Environment variables alone do not implement notification transport                                            |
| D15 | Host/DBA/operations and client IT                           | Approved staging/host target, secrets/storage/TLS/proxy/maintenance/rollback, backup/key custody/offsite RPO/RTO, workload/SLOs/on-call and explicit deployment authorization.                                  | No production inspection/migration/deployment performed; live target cannot be inferred from fixtures          |
| D16 | Client facility/finance owner                               | Confirm authorized Syrona tenant/facility identity/display name and currency; approve equity provisional formula/admission dates/source blanks/full-precision rounding without residual.                        | Do not rename facility or alter original equity cells to force agreement                                       |

## 9. Completion and change-control rules

- Use only COMPLETE/PARTIAL/NOT IMPLEMENTED/DEFECTIVE/BLOCKED/UNVERIFIED on requirement rows. Reporting classification labels are a second, requested output classification, not competing requirement statuses.
- Close only the explicitly scoped acceptance contract, with named source/fixture, executed evidence, revision and owner. Do not infer facility/provider/regulatory acceptance from a test count, menu, source hash, internal register or synthetically approved record.
- A client-approved exclusion/deferment changes contracted scope; it must retain original requirement/provenance and decision, not delete the row. Optional OPT-001 is not a completion blocker absent separate approval.
- Follow `SYRONA_MASTER_COMPLETION_ROADMAP.md`. It groups whole workflows/dependencies, not artificial one-screen batches; source/report semantics and preserved historical equity/planning/ledger remain distinct.
- No production data access or feature work was authorized/performed. Future production inspection/deployment requires separate secure owner authorization. An audit report push is not acceptance or deployment.
