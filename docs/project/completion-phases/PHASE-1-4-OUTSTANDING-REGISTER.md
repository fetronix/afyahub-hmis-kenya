# Outstanding-work register — Phases 1 to 4

Preserved from the [completion register](../JALICARE-COMPLETION-REGISTER.md), which remains the
authoritative record. **No phase below is complete.** This document restates what each phase still
owes so that Phase 6 work cannot be mistaken for a finished foundation.

Nothing here has been closed by Phase 5. Phase 5 added workforce, procurement, inventory and
fixed-asset modules on top of these foundations; it did not repair them.

---

## Phase 1 — Security and multi-tenancy

**Status: Partial. Critical dependencies remain.** These are prerequisites for Phase 6, because
provider credentials, callbacks and remittances all pass through the same tenancy and
authentication boundaries.

| # | Outstanding item | Why it blocks |
| - | ---------------- | ------------- |
| 1.1 | Revalidate the Phase 1 crosswalk against currently mounted routes, schemas and tests | The original audit predates Phase 2–5 routes; a stale crosswalk cannot support a security claim |
| 1.2 | Server-side portal ownership and verification | Portal identity must not rely on client-supplied identifiers |
| 1.3 | Session, password-reset, lockout and revocation review | Account takeover and stale-session risk |
| 1.4 | Sharing and safe record release | Cross-facility record release needs explicit consent and audit |
| 1.5 | Clinical patient/tenant/facility context enforcement | A mis-scoped clinical read is a patient-safety event |
| 1.6 | Staff session, MFA and RBAC; platform vs facility boundaries | `SUPER_ADMIN` must not be an unrestricted facility actor |
| 1.7 | Negative and authorized synthetic PostgreSQL/HTTP tests at every changed boundary | Positive tests alone cannot show a refusal |
| 1.8 | Audit atomicity, redaction and encryption review; TLS and key handling | Logs and errors must not leak identifiers or secrets |
| 1.9 | Cross-domain isolation matrix and policy-dependent exceptions | Undocumented exceptions become silent holes |

Not done, and not to be implied by any green test run: independent penetration testing,
deployment review, key-recovery proof, or a production security sign-off. A hidden UI control is
never authorization; every check above must hold at the API.

## Phase 2 — Clinical workflows

**Status: Partial.** Every row below is a working, permission-gated feature with recorded gaps.

| Area | Still owed |
| ---- | ---------- |
| Registration, reception, queue, booking | Real scoped selectors, >50-record behaviour, identity/duplicate handling, cancellation/reschedule audit, notification/payment/refund truth; no invented capacity |
| OPD, triage, encounters, diagnoses | Verified patient/encounter association, clinical history, completed-vs-unperformed care |
| Laboratory and radiology | Verified result reporting, facility service identity, provenance, negative access tests |
| Pharmacy, inpatient, nursing | Charge only dispensed quantities and real inventory prices; partial fills and reversals; bed rate snapshots; transfer and cutoff policy; cleaning independent of billing; unresolved PostgreSQL timezone discrepancy |
| Maternity, MCH, immunisation | Mother/baby relationships, real completion, single delivery charge, longitudinal scoped journey, facility sign-off |
| Theatre, dialysis, specialties | Surgical checklist and consent (scheduling is not surgery); no discharge from surgery; no invented dialysis protocols or inferred completion |
| Emergency, ambulance, mortuary, blood bank, infection control, quality | Dedicated lifecycles, custody and traceability; a generic note or code is not a department |
| Referrals, consent, allergy, continuity | Approved consent/access/release; no silent reconciliation or rewriting of historical rows |

**Exit still unmet:** browser → API → synthetic PostgreSQL journey from registration through
triage, orders, verified results, actual dispensing and admission/transfer/discharge across
authorized and unauthorized tenants and facilities, plus clinical UAT.

## Phase 3 — Billing and accounting

**Status: Partial.** Phase 5 postings (procurement, payroll, fixed assets) rely on this ledger, so
its gaps propagate.

| Area | Still owed |
| ---- | ---------- |
| Facility services, tariffs, historical references | Effective dates and immutable source snapshots; inactive/expired/future tariffs must not bill; legacy master-tariff UI stays unmounted |
| Source-traceable charges and invoices | No charges for unconfirmed care; retry and duplicate/concurrent identity; unpriced work visible without repricing history |
| Receipts, payments, refunds, reconciliation | Amount/currency/state verification, manual vs provider evidence, idempotency, partial payment, controlled reversal; a manual refund is not a transfer |
| Ledger, journals, statements, assets, AP | Balanced idempotent approved postings, closed-period enforcement, controlled reversals, no silent edits to posted entries; facility-approved mappings, opening balances, payable/asset lifecycles, reconciliation |
| Reporting from the ledger | Legacy financial-transactions SQL coalesces all-null invoice/line sums to zero, and the invoice-cohort revenue path converts null/non-finite amounts to zero — unresolved data-quality risks that must not be read as known zero |

**Exit still unmet:** multi-facility source → charge → invoice → independently evidenced
receipt/refund → reviewed journal/ledger/statements, including negative, duplicate, concurrent and
reversal paths, with finance-owner sign-off.

## Phase 4 — Reporting, MOH and KHIS/DHIS2

**Status: Partial.** The report centre is inventoried, not finished.

- **144-entry inventory** re-inspected: **23 links to 19 limited engines**, one invoice-document
  workflow, and **120 unavailable** entries. The baseline was 21 links / 18 engines / 122
  unavailable; the outpatient diagnosis register is the only addition.
- All unsupported entries remain **Missing**. A partial engine is not a statutory report.
- The diagnosis register is **not MOH 705**, not a case count, and not a KHIS submission. It
  preserves duplicate and no-diagnosis rows, recorded ICD-10/ICD-11 release, missing and
  inconsistent links and explicit status, within an inclusive ≤366-day range.
- A pre-existing encounter-based clinical diagnosis read can expose a mislinked patient diagnosis.
  The new report withholds it but **does not fix the API**.
- Unexpected coding systems are treated as ICD-10 by clinical presentation and private claims,
  whose snapshot lacks an ICD-11 release.
- WHO supports ICD-11 MMS `2026-01`; the application defaults to `2025-01`. Neither a recorded
  release nor local validation establishes external acceptance.
- Every statutory report still needs agreed source/date/denominator/null semantics, true
  calculations, facility and role scope, real scoped selectors, audited exports and source
  reconciliation — plus current authoritative forms and authority acceptance for MOH 705,
  KHIS/DHIS2, maternal/child, IPD, laboratory/IDSR and commodity reports.

No historical ICD-10 recoding, national submission, provider action or financial policy change
has been performed.

---

## Standing rule

A phase is **Complete** only when its full required scope and decisions have evidence. Otherwise
it is reported Partial or Externally blocked, and the next phase does not inherit a completion
claim. Phase 6 implementation must not begin until the user authorizes it, and Phase 6 work must
not be presented as having fixed anything in this register.
