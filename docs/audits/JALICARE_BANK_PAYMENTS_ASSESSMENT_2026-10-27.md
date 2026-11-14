# JALICARE HMIS — bank-only payments assessment and implementation plan

Date: 27 October 2026. **Assessment only; implementation is not authorized or performed.**

## 1. Decision summary

Replace the standard facility Payment Transactions experience with **Bank Payments & Reconciliation**, but reuse the existing invoice, receipt, refund, accounting and statement-reconciliation domains. This is not a label change and does not require rebuilding billing.

**Current readiness: not ready for bank-only production settlement.** There is genuine statement-import/reconciliation backend code, genuine billing/receipt/accounting code, and two narrowly implemented bank sandbox authentication checks. There is no established end-to-end authenticated bank confirmation → verified allocation → receipt → journal workflow. None of the four assessed banks is demonstrated operational in this HMIS.

The first deliverable should be controlled manual bank transfers plus statement reconciliation. Automated bank capabilities must remain unavailable until bank-approved specifications, facility authorization, a reviewed adapter/verifier and successful synthetic UAT exist. A bank-branded mobile-money API is not a bank-only payment channel.

**Critical backend gap:** the generic receipt service accepts a payment-method string and does not require bank verification evidence before recording a non-mobile payment. Merely hiding STK or adding a bank screen would leave a route around the new control. Bank-only enforcement must be server-side and cover every receipt writer.

## 2. Evidence and preservation boundary

- Inspected current frontend, API clients, payment hub routes/services/adapters/secrets, accounting bank services/routes, billing payments/refunds, receipt rendering, schemas, migrations and relevant tests.
- The 1,244 files in fetched published commit `c9fd2b23fe5077fd9d4d189eb246446d940589bf` matched workspace contents before this report. Local HEAD remains `0111b5502e1a8d8a21faf53845360122275727df`; the checkout already contained substantial published-looking work relative to that HEAD. It was not reset, staged, committed or pushed.
- Captured an initial content-hash manifest and checked it after inspection/testing: every pre-existing path was unchanged, including the initially missing path. Existing Git status is not this task's patch.
- Installed locked dependencies with `npm ci --ignore-scripts --no-audit --no-fund` to run targeted synthetic tests. No application source, dependency manifests, migration or test was edited. This report is the only intended addition.
- No production database, patient data, real credentials, provider authentication request, live transfer or deployed browser session was used. Public provider documentation establishes documented products, not operational integration.

## 3. Current capability assessment

| Area | Actual implementation | Gap / consequence |
|---|---|---|
| Standard payment UI | `PaymentTransactions.tsx` mounts `SandboxCollectionForm`; invoice selection, balance, sandbox request/recovery, status query and existing-receipt matching exist. | Still phone/STK-oriented, not a bank workflow. It explicitly does not settle sandbox requests. |
| Other entry points | `BillingCashierModule.tsx` defaults to M-Pesa and offers M-Pesa, Airtel, Cash and Card. | Bank-only must cover cashier entry points as well as navigation. Preserve history; do not silently reclassify historical payments. |
| Provider contracts | `adapters/contracts.ts` collection initiation requires phone, KES amount and callback URL. | Introduce separate bank-neutral capability contracts; do not adapt banks by supplying a dummy phone. |
| KCB BUNI | Real bounded HTTP sandbox token-check code, OAuth client credentials; adapter exposes only `HEALTH`. | No collection, account access, statement retrieval, transfer or authenticated notification implementation. Mocked tests are not live authentication proof. |
| Equity/Jenga | Real bounded sandbox merchant-token-check code; only `HEALTH`. | Same financial-capability gaps as KCB. No actual credential validation was performed. |
| NCBA / Co-op | NCBA fail-closed descriptor with no implemented capabilities; no Co-op adapter registered. | Controlled manual transfer and statement reconciliation only until onboarding and implementation. |
| M-Pesa sandbox | Daraja collection/status request code exists, sandbox-only, production not ready. | Remove from standard bank-only UI; retain existing sandbox history and deny disallowed channels server-side. It must not become a disguised bank integration. |
| Confirmations | `webhook.routes.ts` rejects M-Pesa callbacks with 503 because a verified contract is unavailable. Query lifecycle distinguishes reported provider success from settlement. | No implemented authenticated bank confirmation. Keep fail-closed behavior; never substitute a guessed signature/shared URL secret. |
| Integration administration | Facility-scoped provider accounts, optional `bank_accounts` link, credential configuration, audit, production gates. | Integration administration currently requires `FACILITY_ADMIN` plus route permission; this is not an explicit finance-admin policy. Bank-account CRUD separately uses `accounting.bank.manage`. Align policies without widening access. |
| Secrets | Scoped AES-256-GCM, random IV, tenant/facility/integration AAD, versioned key support. Inspected list paths return masks/configuration metadata rather than credential ciphertext/plaintext. | Reuse vault controls; extend to signing keys/secure bank identifiers. Do not put credentials in `connector_config`, browser storage, logs or API responses. Verify every new DTO with leakage tests. |
| Bank account registry | Real tenant/facility-owned bank accounts, bank/name/code, branch/currency/active columns, masked identifier, GL link and connector metadata. | Current creation API only accepts account/bank name/code, GL and last four digits. No usable full identifier is collected; branch/currency/active/provider/environment lifecycle is incomplete in exposed API. |
| Statement import | CSV parser, exact decimal handling, atomic import, date checks, scoped active account lookup, whole-import hash and unique account/line fingerprint. | Fixed CSV contract, not bank-native PDFs/XLSX or live feed. Overlapping duplicate lines roll back the import; no preview/resolution workbench. Fingerprint uses date/reference/direction/amount and can collide for genuinely separate identical entries. |
| Matching / reconciliation | Scoped exact posted-GL-line matching, suggestions, unmatched investigation, worksheets, reviewed-import save, second-person approval, history/report service, unmatch audit and bank-charge adjustments. | Matches existing ledger entries, not invoice payment intents. No complete first-class bank workbench found in frontend; procurement can read bank-account choices. Imported statements remain explicitly non-live evidence. |
| Receipt and invoice settlement | `recordSettledPayment` locks/checks scoped invoices, calculates settlement, records receipt, attribution, balance update and audit transactionally; idempotency supported. | It accepts generic method text; non-mobile reference is optional and is not bank evidence. A bank-specific verified-only gate is missing. |
| Payment-hub reconciliation | `reconcileReceipt` checks production/provider-confirmed state and matches an already existing invoice receipt by invoice, amount and reviewed reference. | Does not create a receipt or change invoice. Production is blocked, so this is not a working bank settlement bridge. |
| General ledger | `billing-posting.service.ts` posts reviewed immutable billing sources with balanced/source-linked journals; finalized invoice posting precedes receipt/refund posting. Settlement recovery exposes unresolved accounting work. | Receipt creation and journal posting are separate today. Do not claim automatic atomic bank settlement/GL, or post revenue again on receiving an invoice payment. |
| Refunds / reversals | Refund approval and immutable refund records exist; accounting has reversal and source-linked posting paths. Unmatching only changes reconciliation, not money. | No bank transfer/refund execution or provider reversal bridge established. Bank evidence must drive authorized compensating events, not deletion or a status-only reversal. |

### Additional integrity issues to address in the implementation

1. **Currencies:** current amounts/services are KES-centric. Allow metadata currency but block non-KES settlement/import unless a separately approved multi-currency design exists. Never treat USD as KES because the account has a currency column.
2. **Parent scope:** integration-account links have composite scope constraints in migration 0028. Banking migration 0027 scopes rows to a facility/tenant but uses ordinary parent-ID references in several places. Add verified composite parent constraints for bank → import → transaction → reconciliation; do not rely solely on separate facility checks.
3. **Schema alignment:** migration 0081 adds reconciliation approval columns that are absent from the inspected Drizzle `bankReconciliations` declaration. Align the declaration additively; do not rerun or rewrite published migrations.
4. **Reconciliation concurrency:** approval locks the reconciliation and recomputes its worksheet, but related mutation paths do not all share that lock. Adjustment validation, journal posting and audit occur in separate transactions. Treat approval-versus-match/adjustment races and partial audit failure as risks requiring reproduction and repair, not as proven safe behavior. Existing unmatch-after-approval protection is useful but not a complete serialization strategy.
5. **Duplicate identifiers:** bank references are not globally unique. Deduplicate within bank/account/environment/source semantics, and distinguish duplicate delivery from legitimate same-day same-amount entries.
6. **Finance authorization:** account management currently uses a delegable accounting permission; provider administration uses facility-admin membership plus permission. Neither should silently become broad finance administration. Define the explicit finance-admin eligibility policy and independent verifier/approver permissions before rollout.

## 4. Official bank evidence and dependencies

Only official sources below are used for provider capability claims. No third-party SDK endpoint, unrelated country's specification, or AI-generated integration example is accepted as a contract.

### KCB Bank — BUNI

- Official onboarding describes app registration, product subscription, sandbox keys and OAuth client-credentials authentication using HTTP Basic client ID/secret. This matches the limited implemented token check. [1](https://buni.kcbgroup.com/getting-started)
- Official FAQ describes sandbox testing, production credential request, and a KCB/VOOMA account prerequisite for production. Sandbox data is test data. [2](https://buni.kcbgroup.com/faqs)
- **Needed:** facility mandate, selected bank-account collection/notification/statement product specification, callback authentication and replay contract, sandbox subscription/credentials, UAT evidence and bank production approval. Do not infer transaction support or callback security from successful OAuth.

### Equity Bank Kenya / Finserve — Jenga

- Official Jenga API documentation specifies merchant-code/consumer-secret authentication with an API-key header to obtain a bearer token; separate test and live environments are documented. [1](https://developer.jengahq.io/guides/get-started/developer-quickstart)
- Official merchant-payment documentation requires a bearer token and signed request, including security-key registration with Finserve. Published product availability does not establish permission to debit an arbitrary patient's bank account. [3](https://developer.jengahq.io/guides/jenga-api/receive-money/merchant-payments)
- Official overview describes sandbox registration, subscriptions and bank-transfer/account-statement products; Jenga API and payment-gateway products must not be conflated. [4](https://developer.jengahq.io/guides)
- **Needed:** exact approved Jenga product/version, facility merchant/account mandate, keys and product access, signing-key management, confirmed settlement/query/notification specification and UAT/live approval. HMIS currently implements authentication only.

### NCBA Kenya

- Official Kenyan API Solutions page advertises automatic payment notifications for auto-collect reconciliation and payment recognition. [1](https://ke.ncbagroup.com/payment-solution/api-solutions/)
- **Not established from inspected public evidence:** exact authentication, sandbox availability, endpoint schemas, signature verification, retries or reversal semantics. Obtain the Kenyan bank's current technical/onboarding pack. Do not borrow Tanzania EFT/TISS specifications or invent Loop endpoints.
- **Current usable mode proposed:** controlled transfer recording and statement import, clearly labelled manual, until those dependencies are met.

### Co-operative Bank of Kenya

- Official Co-op Connect material lists PesaLink-to-account, internal funds transfer, balance, full/mini statements and instant transaction notifications; it also lists mobile-money products, which are outside this client's bank-only default. [2](https://www.co-opbank.co.ke/corporate/corporates/) [3](https://www.co-opbank.co.ke/corporate/ngos/)
- **Not established from inspected public evidence:** usable technical auth/sandbox/callback specification or this facility's product approval. Obtain the bank's approved pack and sandbox/production onboarding. UK Co-operative Bank open-banking documentation is unrelated.
- **Current usable mode proposed:** controlled manual transfer/reconciliation. Adding a provider catalogue entry alone would not implement Co-op Connect.

**Operational conclusion:** none of these providers can be marked live/working from this assessment. KCB and Equity have implemented sandbox-authentication code only. NCBA and Co-op require technical discovery before any API work. Real credentials and approvals must be provisioned through secure administration, not supplied in chat or committed to Git.

## 5. Proposed workflow and control model

### A. Facility configuration

Finance-admin-only account create/update/activate/deactivate, with separate credential-write permission. Capture bank code/name, account name, authorized account identifier, branch, KES currency, facility, GL account and optional provider/environment link. A manual account must not require invented provider credentials or a successful API health check.

Keep sensitive identifier/signing material encrypted or vault-referenced; expose mask and safe payment instructions according to explicit permission. Credentials are write-only. Never return tokens/private keys/ciphertext through listing, errors, exports or audit. Audit account revisions, assignments, activation, credential change/revocation and capability approval without secret values.

### B. Incoming bank payments

1. Select a scoped finalized/eligible invoice; display patient-safe invoice summary, party allocation and server-calculated outstanding balance.
2. Select an active facility-owned receiving bank account. Display only approved account instructions and supported actions.
3. For external transfer: record expected/declared amount, bank reference, payment date and protected evidence. Create **PENDING / UNVERIFIED** record and acknowledgement, never an official receipt.
4. For approved API product: initiate only the specific implemented/subscribed capability. Store immutable request identity and provider reference. An accepted request is still pending; timeout becomes **UNKNOWN / REVIEW REQUIRED**, not failed-and-retry automatically.
5. Authenticate confirmation with the actual provider contract; validate receiving account/facility, amount, currency, transaction reference, timestamps/replay and contradictory events. Persist deduplicated evidence before acknowledging it. Never trust browser status, a screenshot alone, a callback URL or an unauthenticated payload.
6. Manual verification requires finance comparison with independently obtained bank evidence/statement and a different authorized verifier. A further independent approval controls settlement. Submitted evidence is not itself proof of receipt.
7. Under locks, recompute remaining invoice/party balances, validate evidence is unconsumed, approve allocations and atomically create receipt(s), immutable allocation/evidence links, invoice update and audit. Replays return the same result. Reject changed payload under the same key. Overpayments require the existing explicit policy; do not force the invoice balance negative.

Keep **request status**, **verification status**, **settlement status**, **journal status** and **reconciliation status** separate. UI may summarize pending/success/failed/reversed, but success requires verified posted receipt allocation; journal-pending must remain visible. A query reporting success is not automatically authenticated evidence.

### C. Accounting and unmatched money

Reuse the existing reviewed billing-source posting rules and source uniqueness. Receiving an invoiced payment normally debits the selected bank asset and credits the relevant receivable, not revenue a second time; overpayment follows the existing liability allocation rules. Amounts use exact minor units.

Preserve the current reviewed GL model: verified receipt/invoice settlement commits atomically, and source-linked accounting work remains visibly pending until reviewed posting succeeds. Do not label it fully accounted until the balanced journal exists. If automatic atomic receipt-plus-journal is later required, extend both services to a shared transaction explicitly; do not call two independently committing services and claim atomicity.

An unmatched statement deposit must not reduce an invoice or create an invoice receipt. It stays in the investigation queue. Where finance policy requires recognition of an evidenced bank deposit before allocation, post a separately authorized bank-to-unidentified-receipts/suspense-liability journal. Later allocation clears that liability without debiting bank twice. This requires an explicit source-linked reclassification path; never simply rematch the same bank journal to a second receipt posting.

### D. Statement reconciliation

Reuse existing import, match, worksheet and approval services. Add import preview/validation, bank CSV mapping, source provenance, duplicate/overlap report, account/date/reference filters and pagination. No automatic matching based solely on amount/date. Suggestions are non-mutating.

Bridge verified bank evidence/allocations to the posted bank journal line. The same deposit may fund several approved invoice allocations, but total allocation cannot exceed the verified deposit. Keep payment allocation distinct from one-to-one statement-to-GL matching; do not remove existing uniqueness to support split invoices.

Show unmatched deposits/withdrawals, ledger-only entries, differences, adjustments, preparation, second-person approval and immutable history. Serialize approval and statement/match/adjustment mutations against a common scoped lock/revision. Recompute under that lock, enforce open periods, retain signed snapshots, and reject post-approval changes or require an explicitly authorized reopen workflow.

### E. Reversal/refund

A bank reversal report enters independent review; unauthorized or conflicting events cannot silently undo receipts. An authorized reversal/refund creates immutable compensating records, correct invoice/party balance changes, linked journal reversal/reclassification and an audit trail. Preserve the original receipt. Partial reversal limits and retry idempotency apply.

A request to send a refund is not proof that money left the bank. Track requested/approved/sent/confirmed separately; unsupported API refunds require controlled externally executed bank transfer with verified evidence. Unmatching a statement line is never a refund.

## 6. Exact proposed change surface — not implemented

### Frontend

- `src/components/modules/payment-hub/PaymentTransactions.tsx`: replace standard content with bank workspace orchestration; show tabs for Payments, Statements & Matching, Unmatched, Reconciliations and History.
- Add `BankPaymentForm.tsx`, `BankPaymentReview.tsx`, `BankStatementImport.tsx`, `BankReconciliationWorkspace.tsx`, `FacilityBankAccounts.tsx` in that module. Forms include selected bank account, invoice/outstanding, bank reference/date, amount, status, verification and histories; never include mandatory payment phone/STK controls.
- `FacilityPaymentIntegrations.tsx`: show real bank capability/evidence state; distinguish authentication-only from transaction support and manual-only mode. Reuse write-only secret controls.
- `BillingCashierModule.tsx`: route this client's payment action into the same bank workflow. Do not leave generic manual bank receipt recording behind it. Preserve read/print/history for previous methods.
- `src/App.tsx`, `src/components/Sidebar.tsx`: label/navigation Bank Payments & Reconciliation, facility finance guards and consistent permissions. Retain old navigation compatibility where needed without mounting STK. Sandbox becomes separately permissioned diagnostics only, never a client default.
- Add `src/api/clients/bank-payments.client.ts`; update exports/types. Facility changes clear all selected accounts/invoices, asynchronous results and retry state. Use relative authenticated URLs; no browser-local service hosts, credential persistence or unrestricted evidence URLs.

### Backend

- Extend `src/accounting/bank-integration.service.ts` and `src/routes/accounting.routes.ts` for full account lifecycle, safe DTOs, import preview, pagination and shared reconciliation locking. Reuse existing `/api/accounting/bank/...` routes instead of duplicating reconciliation logic.
- Add `src/bank-payments/{service.ts,routes.ts,verification.ts,settlement.ts}` and mount through existing authenticated app routing. Proposed routes: GET/POST `/api/bank-payments`, GET `/:id`, POST `/:id/submit`, `/:id/verify`, `/:id/approve-and-settle`, `/:id/reject`, `/:id/reversal-requests`; use scoped request/response schemas, idempotency keys and review revisions. These are proposed HMIS routes, not claimed bank endpoints.
- Separate bank capabilities in `src/payment-hub/adapters/contracts.ts` / `index.ts`: initiation where approved, authenticated confirmation, transaction query and statements. Existing `banks.ts` remains authentication-only until a product-specific implementation is authorized. Add Co-op only as unavailable/manual metadata initially if required; no financial capability flag without code and evidence.
- Preserve `src/payment-hub/webhook.routes.ts` fail-closed behavior. Add provider-specific ingestion only once exact authentication/replay contracts are reviewed. Use fixed approved hosts, bounded requests, no redirects, sanitized errors and durable event inbox/recovery.
- Extend `src/billing/payments.service.ts` with an internal verified-bank settlement boundary and a shared transaction primitive. Reject generic bank/manual method bypass on bank-only facilities; enforce allowed channels server-side, not by payment-method text matching alone. Review legacy `src/db/queries/billing.ts` receipt writer and every caller. Do not weaken finalized-invoice, attribution or payer gates.
- Extend `src/accounting/billing-posting.service.ts` / settlement recovery only for explicit evidence and bank-account binding and suspense reclassification. Preserve invoice-first posting, balanced journals, source uniqueness and unresolved-work visibility.
- Reuse `src/billing/refunds.service.ts`, refund approval and accounting reversal services; attach bank evidence/approval and bank-only channel policy without bypassing payer-specific safeguards.
- Receipt renderer `src/documents/document.service.ts`: retain current official receipt branding/history. Pending transfers have a separate non-receipt acknowledgement. New bank receipts must be reachable only from settled verified allocations; historical receipts remain unchanged.
- Add explicit bank finance-admin/configure, submit, verify, settle/approve, import, match, reconcile-approve and reversal permissions to existing auth infrastructure. Map roles deliberately; separate preparer/verifier/approver; keep super-admin metadata administration distinct from facility finance.

## 7. Proposed additive database migrations

Assign the next migration numbers only after checking the migration journal at implementation time. Do not edit migrations 0027, 0028 or 0081 or use schema-push as a substitute.

1. **Bank account lifecycle and policy:** extend existing `bank_accounts` with secure identifier/reference and metadata revision/audit linkage; use existing branch/currency/active columns. Add a facility payment-channel policy with explicit bank-only configuration. Do not silently change unrelated facilities or migrate historical methods.
2. **Bank payment intent and evidence:** new tenant/facility-scoped `bank_payment_intents`, append-only `bank_payment_events`, protected `bank_payment_evidence`, `bank_payment_reviews`; amount/currency/account/provider/environment/date/reference, state/revision, creator/verifier/approver, source provenance, evidence digest and request hash. Constraints enforce valid transitions, positive amounts, independent decisions and immutable verified evidence. Provider references use bank-documented uniqueness scope.
3. **Allocation and settlement linkage:** `bank_payment_allocations` links verified deposit/evidence to invoice, attribution, existing `billing_payments` receipt and journal/reclassification source. Lock deposit and invoices, enforce aggregate allocation bounds and unique settlement identity. Receipt linkage stays optional until settlement, then immutable. Reversal records link originals and authorized compensating records, with unique retry identity.
4. **Durable confirmations:** extend existing event storage where compatible, otherwise add bank event inbox with scoped unique event identity, payload digest/protected evidence reference, authentication outcome, processing/retry state and append-only audit. Unauthenticated or sandbox evidence cannot be used for live settlement.
5. **Integrity/schema alignment:** composite scoped foreign keys for account/import/transaction/reconciliation/invoice/provider links; reconcile the Drizzle approval fields with migration 0081; add approved snapshot/revision and mutation guards. Retain existing duplicate import and journal-match indexes. Quarantine discrepancies for review before validating new constraints; never auto-repair financial history.
6. **Legacy rollout:** preflight duplicate/scope/GL mismatches and unresolved receipts; retain existing receipts and marks as historical rather than retroactively claiming verification. Enable bank-only per authorized facility only after migration, permissions, synthetic tests and finance sign-off. Rollback disables new initiation/settlement while preserving all immutable history, receipts and reconciliation records.

## 8. Test execution and the 12 requested acceptance checks

Targeted existing tests executed with synthetic mocks and an explicitly unavailable loopback PostgreSQL address, so no real database could be used:

**9 files passed; 60 tests passed; 3 database files / 42 tests skipped; 0 failures.**

Passing files: `bank-sandbox-auth.spec.ts`, `payment-hub.spec.ts`, `payment-lifecycle.spec.ts`, `payment-hub-ui.spec.tsx`, `payment-hub-collection-ui.spec.tsx`, `billing-cashier-ui.spec.tsx`, `payment-settlement-work-ui.spec.tsx`, `client-accounting.spec.ts`, `src/tests/payments.spec.ts`.

Skipped: `client-bank.db.spec.ts` (3), `bank-reconciliation.db.spec.ts` (12), `payment-hub.db.spec.ts` (27). Existing DB tests describe import/matching/isolation/approval controls, but their existence is not a pass. No production bank, real token, callback or end-to-end settlement was tested. Build/typecheck/full suite were not rerun for this assessment.

| # | Requested acceptance check | Current evidence / status | Required implementation test |
|---|---|---|---|
| 1 | Authorized account configuration succeeds | Partial backend; full bank-account lifecycle missing. DB execution not performed. | Finance admin creates/updates/activates own account; correct GL/metadata and secret-free response/audit. |
| 2 | Unauthorized configuration denied | Existing role/permission guards and mocked hub UI coverage; complete proposed policy untested. | Direct API denial for cashier, delegated non-admin, wrong facility and platform-only admin; no writes. |
| 3 | Invoice selection and outstanding balance | Existing sandbox UI selection/recovery tests pass, not bank-flow acceptance. | Bank form loads only eligible scoped invoices and server balance; stale/void/paid invoice rejected at settlement. |
| 4 | Pending creates no receipt | Existing sandbox tests support no receipt behavior. Manual bank intents missing. | Submit manual/API pending/unknown, then assert no receipt, balance change or receipt journal. |
| 5 | Verified payment settles correctly | Missing bank evidence-to-receipt bridge; generic method bypass identified. | Independent verified evidence and approval produce one receipt, right party/balance/account; generic route cannot bypass. |
| 6 | Duplicate does not duplicate | Existing request/import uniqueness and mock tests; bank evidence idempotency missing. | Concurrent confirmations/approvals/retries create one settlement; altered payload conflicts; legitimate repeated reference handled safely. |
| 7 | Correct balanced GL | Arithmetic tests pass; existing source-posting design inspected. Bank-linked DB path untested. | Invoice-first Dr bank/Cr correct receivable, approved overpayment liability and suspense clearing, no double revenue/bank debit. |
| 8 | Authorized reversal/refund | Existing approval/refund/reversal code; no bank bridge demonstrated. | Independent authorization, partial/full compensating entries, restored balances, immutable original and idempotent reversal; no false transfer success. |
| 9 | Import/reconcile/review/approve | CSV/worksheet primitives pass; 15 bank DB tests skipped. | Synthetic import→posted-line match→fresh balanced worksheet→different-person approval; duplicates, wrong matches and approval races rejected. |
| 10 | Unmatched investigation | Existing backend suggestions/investigation; proposed UI and allocation bridge missing. | Unmatched deposit remains unallocated/no invoice receipt; authorized suspense and later allocation clear correctly. |
| 11 | Facility/tenant isolation | Scope code/composite integration constraints inspected; DB isolation tests skipped. | Tenant A / facilities A1+A2 and tenant B: deny every cross-scope ID, evidence, file, account, invoice, event and journal; verify no side effects. |
| 12 | Unsupported provider is clear | Mocked capability tests pass for authentication-only/unavailable boundaries. | NCBA/Co-op/manual account shows manual reconciliation and clear API-unavailable state; no guessed request, fake success or credential-only capability activation. |

Additional mandatory tests: forged/unsigned/replayed callback, wrong beneficiary/currency/amount, duplicate differing payload, out-of-order success/reversal, credential rotation/revocation/redaction, account deactivation mid-request, non-KES rejection, split allocation limits, period-close/approval races, audit failure rollback, duplicate import resolution, protected evidence downloads, stale facility UI responses and historic receipt compatibility.

Run new and existing financial DB suites on an authorized disposable synthetic PostgreSQL instance with required attestation; never weaken the test guards or use production. Provider UAT follows only with authorized sandbox access, then finance/bank security sign-off before facility production enablement.

## 9. Recommended delivery order and stop point

1. Approve scope and finance-role policy, receiving-account data treatment, KES boundary and controlled-manual evidence/approval rules.
2. Add schema/constraints and close all generic receipt/channel bypasses; retain existing financial behavior for other explicitly permitted facilities.
3. Deliver account configuration, bank payment intents, verification/approval, receipt allocation and visible reviewed accounting work.
4. Deliver the bank statement/matching/unmatched/reconciliation UI over the existing backend; harden approval concurrency and audit atomicity.
5. Validate all 12 checks plus regressions on synthetic DB; finance reviews receipts, ledgers, statements and reversals together.
6. Implement one approved bank product at a time after receiving its exact contract and credentials; perform UAT and independent go-live approval. Keep unsupported capabilities/manual providers honest.

**Stopped at assessment and plan. No bank-payment implementation, migration, capability activation, production credential test, commit or push was performed.**
