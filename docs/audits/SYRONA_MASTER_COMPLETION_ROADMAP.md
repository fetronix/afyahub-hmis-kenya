# Syrona Medical Center HMIS / AfyaHub Kenya — Master Completion Roadmap

## Decision and use

**Assessment baseline:** `d5098ab36241fb5d82043ae6b2beccdfa2da0161`, branch `arena/e088f11d-afyahub-hmis-kenya`. Assessment/documentation only. No implementation, production access, migration, grant or deployment was authorized or performed.

`SYRONA_MASTER_COMPLETION_REGISTER.{md,json}` is the authoritative working requirement/status/evidence register at this baseline. This roadmap is its execution order, **not another completion claim or a replacement Reporting Centre programme**. Original signed Syrona scope/workbooks/meeting notes are absent; D01/D02 are real scope holds. Requirements labeled unconfirmed/recommendation/optional must be approved before becoming mandatory client work.

### Scheduling principles

- Work on **integrated whole workflows** and their shared controls, not isolated attractive forms. IDs identify acceptance units, not instructions to create a separate feature batch for every row.
- Begin source/policy/provider/host decisions D01–D16 immediately in parallel. Integration implementation is phase 6, but asking providers for contracts need not wait for reporting.
- Critical/high verification holds are not always known broken code. Reproduce before replacing implemented functions; preserve existing authorization, cluster attestation, consent, invoice gate, immutability, financial separation and historical evidence.
- An included emergency/theatre/ward/transfusion/specialty requirement must be promoted to the clinical safety path when launch scope requires it. It cannot silently become “optional” to improve completion counts.
- Phase IDs cover every register row exactly once as its primary closure phase; dependencies/cross-phase UAT repeat where necessary. Narrow COMPLETE arithmetic rows are preserved regression gates, not new work.
- Do not modify production while assessing. Future target inspections/migrations/deployment require separate secure owner authorization, reviewed pending set and backup/rollback plan.

## Baseline evidence to preserve

- Fresh focused assessment: **313 passed /1 failed /13 skipped**,28 selected test files. Mock DOM/transport and pure calculations are not real browser/DB/provider journeys.
- Source candidate CI run 43678187584 has failed coverage/database/Docker-bootstrap jobs; local migration `Guarded Ddl` fails on 0095. Full CI log redirect unavailable here; remaining CI causes unknown. Do not call focused success a green release.
- Existing 144-report programme: 0 fully accepted catalogue reports, 28 partial, 116 without integrated engine/workflow (97 unavailable implementation, 19 additionally blocked on source definitions in this assessment). Keep per-entry CAT mapping.
- Clinical-document, Batch1 stock and partner-equity real synthetic DB/browser/native-export evidence is historical and retained; do not discard it or count it as fresh reexecution.

## Phase 1 — Baseline, critical security, data integrity and access control

**Requirement IDs (14 primary units):** GOV-001, GOV-002, GOV-003, SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, DOC-003, POR-001, OPS-001, SEC-008.

**Dependencies:** D01–D05: named sponsor/security/data-controller/role owners; accessible full CI artifacts and approved disposable PostgreSQL 16/Docker. Establish D15 recovery/host owners now. Requirements discovery and provider onboarding may run in parallel, not be postponed until their phase.

### Exact deliverables

1. Signed original-requirement/source inventory or explicit unresolved-original scope hold; no invented workbook contents or client phase assumptions.
2. Private owner-led incident disposition plan/evidence; no unauthorized Git history cleanup, production access or exposure in reports.
3. Required staff password-change restriction, agreed usable MFA/recovery, complete mounted-route/module/scope/role audit and document access/mandatory audit policy.
4. Reproducible green same-revision full CI/database/coverage/fresh-bootstrap candidate; investigate 0095 guarded-DDL governance without editing applied history or bypassing tests.
5. Early current-schema restore feasibility proof and documented escalation for binary/immutable audit/consistency concerns; final off-host/RPO/RTO certification remains phase 7.

### Acceptance tests

- Existing/new direct HTTP scope/role/disabled-module/flagged-password/pre-MFA/revoked-session/foreign-ID negatives using disposable fixtures; no production login testing.
- Mandatory audit failure injection for sensitive data/output; no unauthorized bytes and safe logs.
- All configured CI jobs on same candidate; every required attested DB test executes. Preserve a failed gate until resolved; no skip/regex relaxation as cosmetic fix.

**Exit criteria:** Security owner signs dispositions and required control evidence; no unresolved exploitable critical gate in included paths; CI is genuinely green; exact requirement source/scope holds are visible and owned. No declaration of incident closure without owner evidence.

**Explicit deferrals / boundaries:** No clinical feature expansion, financial rule guessing or provider/live activation here. Optional features remain outside contract until approved.

## Phase 2 — Complete included patient and clinical journeys as integrated workflows

**Requirement IDs (35 primary units):** PAT-001, PAT-002, PAT-003, REC-001, OPD-001, OPD-002, OPD-003, LAB-001, LAB-002, LAB-003, RAD-001, RAD-002, RAD-003, IPD-001, MCH-001, THR-001, THR-002, SPC-001, SPC-002, DIA-001, DOC-001, DOC-002, DOC-004, POR-002, POR-003, PAT-004, OPD-004, IPD-004, RAD-004, SPC-003, SPC-004, SPC-005, SPC-006, SPC-007, OPD-005.

**Dependencies:** Phase 1 security/green candidate; D03/D05/D06 approved clinical departments, catalogue/protocols, role/consent/release/retention policy; D07 terminology decisions where applicable. D02 originals needed for specific clinical templates.

### Exact deliverables

1. Accepted registration/MRN/duplicate identity→reception/appointment→OPD/history/diagnosis/prescription/referral flow, including all directory pages and late-response safety.
2. Specimen/accession→result→verification→authorized final lab issue; procedure-specific radiology consent→performance/report→approved final access, with explicit drafts and immutable corrections.
3. Nursing/admission/bed handoff and required eMAR/treatment chart; approved maternity/MCH/dialysis clinical scope; theatre execution/dental consumption/specialties/emergency/custody departments only as signed included requirements.
4. Secure original file upload/correction→explicit per-version portal release→own-patient viewing and approved sharing/withdrawal. Do not rebuild already existing storage/letterhead/consent systems.
5. Correct coding-system/release provenance in clinical and payer snapshots; preserve historical codes without automatic conversion.

### Acceptance tests

- WF-01 clinical portion; WF-02,WF-03 and WF-10 through normal staff/patient logins with real PostgreSQL and native saved document inspection.
- Wrong patient/order/encounter, shared contact/minor identity, duplicate accession, mixed verification, generic/wrong-order consent, revoked grant, unsafe file, correction/old release and mandatory audit failure.
- Clinical owner scenario walkthrough for every included specialty, with immutable version/signature metadata and no automatic unperformed-care completion.

**Exit criteria:** Clinical/lab/radiology/pharmacy/nursing/records owners approve persisted same-patient handoffs and source-specific issue eligibility; no open required clinical NOT IMPLEMENTED/DEFECTIVE row. Any excluded department has a signed contractual decision retained in register.

**Explicit deferrals / boundaries:** Provider electronic submission and actual financial valuation wait for their contracts; clinical acceptance is not statutory/legal/provider certification. Do not defer an included mandatory ward/theatre/blood-bank safety flow merely because it is large.

## Phase 3 — Billing and financial transaction integrity across care delivery

**Requirement IDs (12 primary units):** IPD-002, IPD-003, PHA-001, PHA-002, BIL-001, BIL-002, BIL-003, BIL-004, BIL-005, BIL-007, BNK-001, INS-001.

**Dependencies:** Phase 2 accepted events; D06/D08 approved service/medicine prices, payment methods, bed-night/recognition/refund/waiver rules; signed role/approver staffing. D11 owner-approved manual bank evidence inputs, not necessarily bank API credentials.

### Exact deliverables

1. All included clinical events create exactly-once charge evidence, with durable pending/unpriced/retry/cancel states.
2. Invoice immutable finalization and patient/insurer allocation; receipts only after approved channel settlement, manual bank declaration→independent verification→independent settlement.
3. Correct partial dispensing/returns and snapshot medicine prices; bed occupancy/rate/cutoff/same-day and all-service discharge reconciliation.
4. Refund/credit/waiver distinctions with exact independent source evidence; accepted manual payer preparation/claims and separately recorded receipt reconciliation.

### Acceptance tests

- WF-01 care-to-receipt, WF-03 billing, WF-04 complete discharge billing; multi-actor normal-login DB/browser scenarios.
- Unpriced service, price changes after dispense, same-day/midnight/transfer, simultaneous posting, uncertain response/retry, overpayment, patient vs insurer, wrong/self-approver, reused bank evidence, overrefund and canceled-care negatives.
- Actual finalized invoice/receipt/refund output matches accepted cents/payer/source and branding; deferred GL reviewed-posting gap remains visible.

**Exit criteria:** Every included clinical source reconciles to one approved charge; accepted payment/refund is atomic/idempotent and correct-party; no declaration/method label can manufacture settlement; clinical and finance owners sign end-to-end transaction truth.

**Explicit deferrals / boundaries:** Bank/M-Pesa API settlement is not assumed by manual verification; advanced credit products need signed design, not reuse of a printed refund title.

## Phase 4 — Procurement, inventory, assets, accounting and planning-to-actual completion

**Requirement IDs (34 primary units):** DIA-002, BIL-006, BIL-008, BNK-002, BNK-003, ACC-001, ACC-002, ACC-003, ACC-004, ACC-005, PRC-001, PRC-002, PRC-003, PRC-004, PRC-005, PRC-006, INV-001, INV-002, INV-003, INV-004, INV-005, AST-001, AST-002, PLN-001, PLN-002, PLN-003, PLN-004, FIN-001, FIN-002, FIN-003, EQT-001, HR-001, HR-002, ACC-006.

**Dependencies:** Phases1–3; D02/D06/D08/D16 original sources, units/openings/costs/chart/periods/account classifications/supplier policies, budget bases, equity formula/identity and approved tax decisions. D07 for payroll and tax.

### Exact deliverables

1. WF-06 whole requisition→approval→LPO→GRN→match→AP→pay/returns with approved source documents and independent approval/variance controls.
2. Costed lot/item/location/movement/GL reconciliation including pharmacy/dialysis/ward/dental producers; governed stores where required; do not infer historical balances from recorded movements.
3. Reviewed source→journal→ledger/control accounts with complete coverage and gap recovery; approved statements and cash flow; accepted cash management only where included.
4. Fixed-asset procurement handoff, opening register/physical verification and lifecycle; preserve narrow accepted depreciation arithmetic.
5. Retained original planning imports/source-row/default provenance and safe CRUD/reset; separate approved financial budget, procurement plan and actual records. Implement explicit source links/actual mappings and financial/procurement variances.
6. Partner equity original cells/nulls/history/provisional precision preserved; approve original formula and facility identity before final finance acceptance. Required HR/payroll/chart/rules reviewed without guessing statutory rates.

### Acceptance tests

- WF-05,WF-06,WF-07,WF-08,WF-09 using independent expected cents/quantities; two facilities/two tenants, failure rollback, concurrent retry, closed periods and immutability.
- Received/returned/dispensed/count/transfer quantities agree across lots/items/movements; accepted cost basis and AP/stock/AR/cash/GL controls reconcile with no unexplained differences.
- Approved plan revision vs partial commitment/GRN/invoice/payment/posted-actual basis; zero vs unknown preserved; full saved PDF/XLSX and independent finance fixture review.
- Original source tests run with authorized originals, no skips/synthetic substitutions; safe reset tests only disposable drafts and preserve imported bytes/audit/actuals.

**Exit criteria:** Finance/stores/procurement/HR owners sign source-to-control/GL and actual-variance mappings; all included financial/stock/asset/plan figures trace to accepted records, not projected guesses; independent workbook/policy fixtures exact.

**Explicit deferrals / boundaries:** Uncontracted multi-currency/consolidation/advanced forecasts not invented. Original formula/actual policy gaps cannot be closed by balancing cents, zero filling undisclosed unknowns, or declaring a model actual.

## Phase 5 — Required reporting, statutory outputs and issued-document branding

**Requirement IDs (155 primary units):** MCH-002, DOC-005, RPT-001, RPT-002, RPT-003, RPT-004, BRD-001, BRD-002, STA-001, RPT-005, HR-003; CAT-001–CAT-144 (every individual current catalogue output).

**Dependencies:** Correct accepted sources from phases 2–4; D03/D09/D10 signed output shortlist/definitions/templates/issue policy; D07/D12 authoritative statutory forms/versions. Continue existing Reporting Centre only.

### Exact deliverables

1. Resolve each included catalogue output CAT-001–CAT-144 against its explicit source/period/denominator/status/null semantics; unchanged unavailable labels remain honest until accepted or contractually deferred.
2. Common scope/date/selection/filter/export parity and active/historical/fallback letterhead across all included report kinds.
3. Preserved issue-time body/version/history per approved document policy and authorized stamps/signers; no decorative signature falsely authenticated.
4. Finance/management/audit reports, MCH outputs and approved MOH/payroll forms using complete sources; formal national transmission remains phase 6.

### Acceptance tests

- WF-11 for every included output: real DB/HTTP/source arithmetic/scope/date/empty/error/permission tests, actual normal-login browser and native downloads.
- Parse each saved PDF/XLSX against every required row/total and full filtered scope; check no unauthorized metadata, exact currencies/unknowns, active template/version/page count and representative visual pages.
- Two-facility A/B activation and historical reprint cases, no-template fallback, >page-size and export-limit refusal; source-specific clinical official-release negatives and statutory gold fixtures.

**Exit criteria:** Each included client-required output COMPLETE with owner sign-off and saved-artifact evidence; remaining144 catalogue candidates retain explicit inclusion/deferment decisions. Catalogue completeness is never inferred from shared engine count.

**Explicit deferrals / boundaries:** Unapproved report variants remain blocked/unavailable; automated report distribution and arbitrary audit/payroll exports are not mandatory without signed inclusion. No second renderer/API/reporting architecture.

## Phase 6 — Per-provider integrations and external acceptance

**Requirement IDs (11 primary units):** REC-002, STA-002, INT-001, INT-002, INT-003, INS-002, INS-003, INS-004, INT-004, INT-005, INT-006.

**Dependencies:** Start D11–D14 contracts/onboarding now, in parallel; implementation only from approved capability specs. Financial/clinical/consent/identity and recovery primitives accepted first. Production approvals remain separate from sandbox.

### Exact deliverables

1. Each included bank/M-Pesa/card/disbursement operation implemented from its own authorized spec, with secure credential custody and callback/unknown-outcome recovery. KCB/Equity HEALTH token checks are not transaction adapters.
2. Britam direct or explicitly authorized gateway and each other insurer independently accepted; SHA/eClaims/AfyaLink/SHR and KHIS/DHIS2 requirements separated by real capability/profile.
3. Operational SMS/email provider transport/delivery outcomes and required website booking site configured and accepted, not enabled by variable presence alone.

### Acceptance tests

- Contract/mocked unit tests first, then authorized provider sandbox normal/negative/timeout/duplicate/replay/invalid-signature/credential-revocation/environment-isolation cases.
- Provider references/acknowledgments retained with scope; rejected/unknown outcomes recover without blind retry; only verified exact settlement creates receipt, never mock or claim advice.
- Accepted national indicator/form payload and correction acknowledgments; private manual decisions clearly distinguished from provider electronic decisions.

**Exit criteria:** Each included operation has required official spec, executed sandbox evidence and named provider/client acceptance; production activation only through separately authorized deployment/go-live process. Missing transport code remains missing even when credentials arrive.

**Explicit deferrals / boundaries:** Uncontracted providers/capabilities explicitly excluded; no guessed endpoints, banking passwords/OTP handling, screen scraping or synthetic/live mixing.

## Phase 7 — Production readiness, facility onboarding and final same-revision acceptance

**Requirement IDs (10 primary units):** OPS-002, OPS-003, OPS-004, OPS-005, OPS-006, OPS-007, OPS-008, OPT-001, PLT-001, PLT-002.

**Dependencies:** All included requirements in phases 1–6 closed or formally contractually deferred; D04/D15 host/security/data-controller approvals, RPO/RTO/SLOs, supported devices and training owners. Optional OPT-001 not a blocker absent signed change order.

### Exact deliverables

1. Current101-chain fresh-install and supported-upgrade/drift proof with exact checksums/contracts; no unauthorized production DB inspection/mutation.
2. Authorized staging deployment/runtime/HTTPS/proxy/storage/migration/rollback rehearsal with known revision.
3. Current-schema/document-byte off-host backup/restore, separated/recoverable keys, scheduling/retention and measured recovery objectives.
4. Actionable monitoring/metrics/alerts/on-call ownership; fault recovery/load/soak evidence under agreed clinical/finance workload.
5. Responsive/mobile/keyboard/accessibility/printer supported-role acceptance; tenant/facility/module/subscription/invitation onboarding, professional verification where required, training/support/handover documentation.
6. Final signed requirement-to-test-to-output/provider/deployment pack; retain unresolved/deferred obligations rather than delete them.

### Acceptance tests

- Full required CI at exact candidate with all mandatory DB assertions; repeatable fresh Docker bootstrap and safe prior-version upgrade.
- Restore into separate empty disposable environment: row/content hashes, original binary bytes, ledger/stock balances and immutable audit agree; host/key loss and alert receipt drills meet approved RPO/RTO.
- All11 workflows normal authenticated browser+API+PG journeys and owner scenario sign-offs at same revision; provider/host evidence separately identified; production pilot only if separately authorized.

**Exit criteria:** Named clinical, nursing, lab, radiology, pharmacy, finance, procurement, records, administration, security/privacy and IT owners sign the agreed scope at exact deployed revision; no unresolved required Critical/High defects/gaps; support/recovery custody transferred. Completion against original contract can only be asserted once D01/D02 scope evidence is resolved.

**Explicit deferrals / boundaries:** Optional OPT-001 advanced matching/forecast/scheduled distribution needs separate signed change order. No claim of regulatory certification or live operation from this roadmap, Git push, passing mocks or a synthetic approval.

## Critical-workflow closure map

| Workflow                                                              | Integrated phases | Evidence required before closing                                                                                              |
| --------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| WF-01 patient→OPD→dispense→receipt                                    | 1–4               | One persisted patient/source identity across roles; correct dose/quantity/price, recovery, approved payment and source-to-GL. |
| WF-02 lab specimen→verified result→clinical issue→charge              | 1–3,5             | Exact sample/order/patient; premature/mixed unverified official issue denied; approved charge once.                           |
| WF-03 imaging→specific consent→performed/report→clinical issue→charge | 1–3,5             | Approved procedure-bound consent/exception, final-release eligibility and no unperformed charge.                              |
| WF-04 admission→bed/ward/ancillaries→discharge→invoice                | 2–4,5             | Bed event/rate/history and pending charge policy; final discharge document and invoice accepted.                              |
| WF-05 purchase→stock/dispense→billing→inventory report                | 3–5               | Lot/item/movement/value/GL consistency, true price snapshots, no false historical balance claim.                              |
| WF-06 requisition→approval→LPO→GRN→AP→pay→GL                          | 3–5               | Approved current revisions, variance/evidence/actors, source-linked balanced AP/payment, no duplicates.                       |
| WF-07 invoice→receipt→reviewed journal→statements                     | 3–5               | Gap diagnostics, exact AR/revenue/cash/source coverage, approved classes/openings and reversals.                              |
| WF-08 financial budget→posted actual→variance                         | 4–5               | Approved financial model/account/department mapping and exact actual recognition; projections stay separate.                  |
| WF-09 procurement plan→accepted purchase→comparison                   | 4–5               | Explicit original-plan/source-line links and approved commitment/received/invoiced/paid basis.                                |
| WF-10 file upload→authorization→portal release→view                   | 1–2,7             | Original bytes/versions, explicit release/withdrawal, own-session isolation and durable audit.                                |
| WF-11 report→filters→native PDF/XLSX→letterhead                       | 4–5               | Actual persisted values and full filtered exports, correctly scoped active/historical/fallback stationery.                    |

## Inputs that must be requested now

The register's §8 and JSON `decisionsAndExternalDependencies` contain the precise D01–D16 owners, requests and impacts. Minimum actionable requests:

1. **Sponsor:** original signed requirements/meeting decisions/three-phase scope, included departments and required report/template shortlist, named signatories and explicit deferrals (D01–D03/D10).
2. **Clinical/records/security:** catalogue/protocols/sample/medication/consent/final-release/retention/sharing/role and stamp/signer rules, MFA/recovery and lawful privacy governance (D04–D07/D09).
3. **Finance/procurement:** original plan/scenario/equity files and unresolved formulas/null/default/currency decisions; chart/openings/periods/costs/recognition/bed/credit/refund/AP/bank-only/approval/actual mapping; exact authorized facility identity (D02/D08/D16).
4. **Banks/Safaricom/insurers/national authorities:** separate operation contracts, capability choices, IDs, secure credentials/certificates, callbacks/environment/UAT and production-approval process; manual fallback signed separately (D11–D13).
5. **Messaging/website/host/IT:** approved channels/site, real transport/sender contracts, authorized staging/target/storage/TLS/proxy, restore/key/SLO/on-call/load/device/support owners and maintenance/rollback authority (D14–D15).

No password, API secret, patient data or original medical document should be supplied in Git commits, public issues or chat. Use the approved secure custody channel. Public reference material, a token check or a configured variable is insufficient evidence of an agreed provider API or delivered message.

## Final declaration gate

Syrona Medical Center may honestly be declared complete **against Syrona's requirements** only when the original agreed scope is authenticated, every included acceptance contract and cross-module chain is verified at the same candidate revision, required client/provider/host approvals exist, and critical security, release, financial integrity, restore and deployment gaps are closed. Formally signed exclusions/deferments remain recorded. The following are never substitutes: menu count, test count, old “complete” label, mock approval, workbook-looking grid, recorded transfer/reference, balanced journal alone, local disease tally, or Git push.

No time estimate or invented completion percentage is assigned before the missing scope/policy/provider inputs are resolved.
