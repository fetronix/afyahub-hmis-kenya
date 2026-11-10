# Phase 6 — external integration matrix (preparation only)

**This document is a readiness assessment. No Phase 6 implementation has begun.**
It records what exists, what is simulated, and what each integration needs before it can be built
and verified. Nothing here is an authorization to use a live provider, and no row may be described
as a working integration until authorized sandbox evidence exists.

**Baseline verified at `d729178`.** Phase 6 work is blocked until the user authorizes it.

---

## How to read the status column

| Status | Meaning |
| ------ | ------- |
| **Implemented (local)** | Code path exists and is exercised by synthetic tests; no provider contact |
| **Simulated** | Returns fabricated provider-shaped data so the internal workflow can be built; never claims provider acceptance |
| **Fail-closed stub** | Deliberately refuses (e.g. HTTP 503) because verifying it would require a contract we do not have |
| **Missing** | Nothing exists yet |
| **Externally blocked** | Cannot progress without a provider contract, credentials, sandbox access or regulator approval |

---

## A. M-Pesa Daraja

| Capability | Status today | Where | What Phase 6 must add | External dependency |
| ---------- | ------------ | ----- | --------------------- | ------------------- |
| STK Push (collection) | Simulated | `src/payment-hub/adapters/daraja.ts` (`DarajaSandboxAdapter`: OAuth + status only) | Real request/response handling, phone normalisation, amount/currency validation | Safaricom app credentials, shortcode, passkey |
| Authenticated callbacks | **Fail-closed stub** | `src/payment-hub/webhook.routes.ts` returns `503 CALLBACK_VERIFICATION_UNAVAILABLE` for every `/mpesa` delivery | A reviewed provider-specific verifier; replay protection keyed on `CheckoutRequestID`/`Receipt`; amount and reference checks; idempotent persistence | Daraja callback specification and a registered callback URL |
| Transaction verification | Simulated | `collection-status.ts`, `payment-lifecycle.ts` | Query the real status endpoint; never treat "no answer" as success; persist raw evidence with redaction | Sandbox access |
| Receipts | Partial, local | `src/billing/payments.service.ts`, payment transactions | Map a confirmed callback to exactly one receipt; reject duplicates; keep manual and provider evidence distinguishable | — |
| Ledger posting | Implemented locally for recorded payments | `src/billing` posting + accounting `postInsideTransaction` | Prove one journal per confirmed receipt under replay and concurrency | — |
| Reversals and reconciliation | Missing | — | Reversal reason codes, partial reversal rules, and a daily provider-vs-ledger reconciliation report | Contract terms for reversals |

## B. Banking

| Provider | Status today | Where | What Phase 6 must add | External dependency |
| -------- | ------------ | ----- | --------------------- | ------------------- |
| KCB (BUNI) | Simulated, fail-closed boundary | `KcbBuniAdapter` in `src/payment-hub/adapters/banks.ts` | Operation-specific contracts (collection, status, settlement), statement retrieval, reconciliation | KCB BUNI agreement, credentials, sandbox host |
| Equity (Jenga) | Simulated | `EquityAdapter` | Same, plus statement matching rules | Equity sandbox onboarding |
| NCBA | Simulated, explicitly unimplemented | `NcbaAdapter` returns "No provider adapter has been implemented." | All operations | NCBA contract |
| Transaction verification / reconciliation | Missing | — | Match provider transactions to receipts and bank statements; report unmatched items rather than guessing | Statements/API access |

Explicit non-approach: no screen-scraping, password automation or OTP interception. A mocked
authentication handshake is not banking.

## C. SHA / AfyaLink

| Capability | Status today | Where | What Phase 6 must add | External dependency |
| ---------- | ------------ | ----- | --------------------- | ------------------- |
| Eligibility | Simulated (`isSimulated: true` in mock mode) | `sha.eligibility.ts`, `sha.eligibility-parser.ts`, `sha.authorization.ts` | Live verification with authenticated transport; unknown benefit is not zero | SHA/AfyaLink credentials, endpoints, mTLS/OAuth profile |
| Preauthorization | Simulated | `sha.preauthorization.ts` | Submission, status polling, approval/partial/rejection handling | Contract + sandbox |
| Claims submission | Simulated | `sha.claims.ts`, `sha.virtual-claim.ts` | Payload conformance, batch/individual submission, error taxonomy, acknowledgement storage | Conformance pack |
| Claims status | Missing for live | — | Poll/ingest status transitions with audit trail | Status endpoint |
| Remittances | Simulated | `sha.remittances.ts` returns synthetic remittances (`SIM-SHA-REM-…`) | Ingest real remittance advice, allocate to claims, post settlement, reconcile shortfalls | Remittance file/API specification |

`sha.config.ts` defaults to `mock`; `production` requires both `SHA_ALLOW_PRODUCTION=true` and
explicit HTTPS URLs. That guard is correct and must stay.

## D. Private insurance

| Provider | Status today | Where | Notes |
| -------- | ------------ | ----- | ----- |
| Jubilee | Adapter key defined (`jubilee_direct`), no transport | `src/insurance/core/types.ts` | Benefits, claims and eligibility are modelled generically |
| Britam | Adapter key defined (`britam_direct`) | same | Do not assume Britam and PACIS share tariffs, rules or exclusions |
| PACIS | Adapter key defined (`pacis_direct`) | same | Same |
| CIC | Adapter key defined (`cic_direct`), has measured test coverage | `src/insurance/payers/cic.adapter.ts` | Closest to a real adapter shape; still synthetic |
| SmartLink gateway | Key defined (`smartlink_gateway`) | — | Reference workflow concepts only |
| Other/configurable | Payer hub config | `src/insurance/hub/` | Each payer gets its own configuration, environment and credentials |

Phase 6 must add, per insurer: member/benefit verification, preauthorization where offered, claim
submission, status, remittance, and per-payer mapping — never a shared assumption.

## E. Integration infrastructure

| Requirement | Status today | Evidence | Gap |
| ----------- | ------------ | -------- | --- |
| Facility-specific provider configuration | Partial | `facility_payment_integrations`, `insurance_payer_environment_configs`, `src/insurance/hub/service.ts` | Per-provider environment rows exist; not yet exercised against a live provider |
| Sandbox vs production separation | Partial | `DHA_MODE`, `SHA_MODE`, `SHA_ALLOW_PRODUCTION`, `DHA_ALLOW_PRODUCTION`; adapter `sandboxOnly`/`productionReady` flags | Needs a single house-wide rule and a UI that cannot silently point a facility at production |
| Encrypted credentials | Implemented locally | `src/payment-hub/secrets.ts` AES-GCM with versioned keys, never stored in the DB as plaintext | Key rotation and recovery still need proof (Phase 1 item 1.8) |
| Callback authentication | **Missing** | Daraja callback returns 503 by design; insurance callbacks under `sha.callbacks.ts` are mock-mode | Provider-specific verifiers, replay windows and idempotency keys |
| Retry and recovery | Partial | `collection-retry-storage.ts`, `inventory/receipt-retry-storage.ts` | Bounded retry with backoff, dead-letter review, no silent duplicate postings |
| Audit logging | Partial | Audit rows on configuration and secret access | Needs a verifiable access log for every credential use and every provider call |
| Failure monitoring | Missing | — | Provider health surface, error-rate and stuck-transaction reporting, alerting |

---

## Prerequisites before Phase 6 implementation starts

1. **Phase 1 items 1.1–1.9** — tenancy, session and audit boundaries, because every provider call
   carries facility identity and financial effect.
2. **Phase 3 ledger controls** — one journal per confirmed money movement, closed periods,
   controlled reversals. Phase 6 will post through this ledger.
3. **A credential policy** — which key encrypts which environment, who may rotate it, and how
   recovery is proven.
4. **Provider paperwork** — contracts, sandbox access and credentials for each provider. Until
   then those rows stay *Externally blocked*.

## Deliberate constraints for the Phase 6 build

- Sandbox only. No production endpoints, no live payments, no real patient or financial data.
- Unknown provider outcomes must never be converted into success, zero or silence.
- Each provider's evidence is separate: a sandbox acknowledgement is not adjudication, and an
  adjudication is not a remittance.
- Failed or unverifiable callbacks fail closed, as they do today.
- Every integration row in the delivery matrix must state one of: Complete and tested, Awaiting
  facility UAT, Sandbox tested, Manual workflow, Externally blocked, Not implemented.

## Readiness verdict

| Track | Ready to start? | Blocker |
| ----- | --------------- | ------- |
| Daraja | Partially | Needs credential policy + callback verifier design; sandbox credentials |
| Banking (KCB/Equity/NCBA) | No | No contracts; NCBA unimplemented |
| SHA/AfyaLink | Partially | Mock plumbing exists; needs conformance pack and credentials |
| Private insurers | Partially | Generic models exist; per-insurer contracts absent |
| Infrastructure | Partially | Credential encryption exists; callback auth, monitoring and rotation proof missing |

**Assessment: Phase 6 is not ready to begin.** Its infrastructure prerequisites (Phase 1 controls,
callback verification design, monitoring) are achievable locally and should be scheduled first;
everything provider-specific remains externally blocked until contracts and sandbox credentials
exist.
