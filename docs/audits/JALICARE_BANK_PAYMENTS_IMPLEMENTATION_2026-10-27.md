# Bank Payments & Reconciliation — implementation and validation

Date: 2026-10-27  
Scope: controlled manual bank transfers, not live bank API activation.  
Companion plan: `JALICARE_BANK_PAYMENTS_ASSESSMENT_2026-10-27.md`.

## Delivery boundary

The standard payments module and selected-invoice cashier entry now use **Bank Payments & Reconciliation**. They collect the receiving account, finalized invoice, outstanding balance, KES amount, bank reference, transfer date and payer party. They do not ask for a phone number, STK push, mobile-money sandbox or integration selection.

An entry is a declaration of an externally completed transfer. It starts **PENDING**, creates no official receipt and changes no invoice balance. A different authorized staff member must attest exact imported statement credit evidence; a third authorized person approves settlement. Settlement reuses the existing atomic billing receipt/allocation/invoice/audit path. A statement import, an unmatched deposit, a reference or a verification button alone never settles an invoice.

This is application implementation plus synthetic validation. It is **not** bank certification, production deployment, live bank confirmation, legal/compliance certification, operator sign-off or permission to process real funds.

## What changed

### Facility configuration and policy

- Facility-owned receiving accounts: account/bank names, bank code, branch, KES currency, debit-normal asset GL account, activation state and provider label.
- Full account identifiers are encrypted with facility/tenant/account-bound authenticated encryption. Standard API responses expose only the masked identifier, never ciphertext or the full identifier. Identifiers are write-only in this workflow; no bank transaction credentials are solicited here.
- Configuration requires both `FACILITY_ADMIN` membership and `bank_payments.configure`; a delegated grant or platform `SUPER_ADMIN` is not facility financial authority. Configuration permission is protected from ordinary custom staff-role delegation.
- Changes write safe audit details in the same transaction. The workspace shows scoped configuration and payment-event history.
- A facility administrator must explicitly enable bank-only policy after configuring an active KES receiving account. Migration does not silently enroll all facilities. The ordinary client UI is bank-first even before enrollment and explains setup is required.
- Once enabled, generic cash/mobile-money/other receipt writers cannot bypass bank verification in that facility. Bank/transfer/EFT/RTGS/PesaLink method aliases also cannot be used as generic manual bank receipts outside enrollment. Existing historical rows are retained.
- Bank account identity and GL cannot be silently reassigned after financial use. Replacement accounts preserve history.

### Evidence, settlement and accounting

- Scoped pending records and append-only transition events; stable retry keys reject payload changes and replay the same operation safely.
- Independent verification requires an unconsumed same-account, same-scope imported **INFLOW** with exact reference and amount. Future-dated evidence is not settlement authority.
- Authorized settlement rechecks account/policy, status, independent actors, invoice finalization, payer attribution, outstanding party balance and evidence under locks. Receipt, allocation, invoice update and audit either commit together or roll back together.
- SQL guards additionally protect parent scope, evidence identity, actor scope, policy/receipt concurrency and deferred settled-record/receipt consistency. Historical bank records are not rewritten into this new flow.
- Existing reviewed billing-to-ledger posting is reused: bank asset debit / receivable credit for receipts; original invoice revenue is not posted again. The receiving bank GL must match. Until reviewed posting occurs, the workspace says `PENDING_REVIEW`, not “posted”.
- No destructive reversal of receipt or settled evidence. The UI derives partial/full reversal presentation from compensating refund records while the original payment remains `SETTLED`.

### Refunds and reconciliation

- Bank refunds reuse independent refund-request approval. Cash substitution or a bank reference/manual-confirmation checkbox is insufficient.
- A recorded bank refund needs exact same-account **OUTFLOW** statement evidence, a matching separately approved request, an independent recorder versus evidence importer, available refundable patient attribution, and an evidence line consumed only once. This records a transfer completed outside the system; it does not initiate an outgoing transfer.
- The additive refund migration preserves the original refund guards and narrowly extends eligible source receipts to same-scope settled patient-attributed bank receipts. Insurer, payer-link, amount, actor and immutable-history protections remain.
- Existing statement CSV import, unmatched investigation, exact-match suggestions, worksheet, reviewed journals and second-person reconciliation approval are reused.
- Import preview reports duplicate/overlapping lines and shows a sample. UI import requires a current duplicate-free preview; changing account/dates/balance/CSV invalidates it. Actual import independently revalidates atomically.
- Signed reconciliations block covered unmatching, retroactive overlapping imports and journal changes affecting the signed range. A zero worksheet difference is explicitly **not** live bank confirmation.

### Provider honesty

| Provider | Implemented transaction capability in this delivery |
| --- | --- |
| Manual bank transfer | Controlled declaration → imported evidence → independent verification → authorized settlement |
| KCB Buni | Existing authentication diagnostics only; no collection initiation or authenticated bank payment confirmation implemented |
| Equity/Jenga | Existing authentication diagnostics only; no collection initiation or authenticated bank payment confirmation implemented |
| NCBA | Manual statement/evidence workflow; no supported transaction API adapter |
| Co-operative Bank | Manual statement/evidence workflow; no supported transaction API adapter |

`apiInitiationAvailable` remains false. Provider labels do not grant capability. Historical payment-hub records and separate diagnostics implementation remain; they are not the standard bank-only collection screen. No new guessed bank URLs, callback contracts, signatures or credentials were introduced.

## Acceptance evidence

The following are synthetic automated evidence, not a claim that every production scenario or browser journey has been accepted.

| Area | Implemented behavior and exercised evidence |
| --- | --- |
| 1. Authorized configuration | Active facility finance administrator saves an encrypted KES account; masked API output and audit history checked |
| 2. Unauthorized denial | Delegated/platform configuration denied; unauthenticated mounted route returns 401; ungranted configuration returns 403 |
| 3. Invoice / outstanding balance | Only finalized scoped outstanding invoices listed; cashier keeps selected invoice; party balance rechecked on settlement |
| 4. Pending without receipt | Pending 60 against invoice 100 leaves balance 100 and zero receipts; generic service aliases and direct SQL bypass denied |
| 5. Verified settlement | Exact imported credit and independent verifier required; third-person settlement creates receipt and balance 40; forced audit failure rolls everything back |
| 6. Duplicate handling | Changed retry payload denied; concurrent settlement retries yield one receipt; mounted HTTP retry replays; duplicate preview/import and evidence reuse checked |
| 7. General ledger | Receipt bank debit 60 / AR credit 60; invoice AR 100 / revenue 100; wrong bank GL denied; pending posting displayed honestly |
| 8. Reversal / refund | Unsafe/manual-only/cash refund denied; independently approved evidenced refund 20 updates paid amount to 40 and balance to 60; compensating bank credit 20 / AR debit 20; safe replay |
| 9. Reconciliation | Receipt/refund exact matches yield zero difference and zero unmatched; separate approval; signed evidence cannot be unmatched or extended retroactively |
| 10. Unmatched investigation | Statement/import preview, account/reference filters, unmatched lines and match suggestions use existing reconciliation services; unmatched credit never auto-settles |
| 11. Isolation | Other tenant and same-tenant other facility denied; mounted HTTP verifies same-tenant isolation; encrypted identifier scoped to tenant/facility/account |
| 12. Unsupported providers | NCBA/provider labeling still returns manual mode and API initiation false; KCB/Equity auth diagnostics regressions retained |

New bank tests are `src/tests/vitest/bank-payments.db.spec.ts` (13 tests, including mounted authenticated HTTP) and `bank-payments-ui.spec.tsx` (8 tests). The cashier suite now verifies the selected-invoice pending bank path instead of a standard sandbox/STK prompt. Existing financial expectations were not relaxed to accommodate bank settlement.

## Validation performed

All database work used disposable synthetic PostgreSQL on loopback. No production database, patient data, production credentials or live provider calls were used.

- **Fresh migrations: PASS.** All 93 migrations, including additive `0091_verified_bank_payments.sql` and `0092_bank_refund_evidence.sql`, applied to a new empty synthetic database after the final SQL edits.
- **Financial database regressions: PASS — 139 tests, 11 suites.** Bank lifecycle/HTTP, bank reconciliation, client bank, payment hub, billing posting, billing-to-GL reconciliation, refund receipt acceptance, independent refund approval, clinical-to-ledger journeys, billing RBAC HTTP and facility-owned billing.
- **Bank HTTP + UI focused run: PASS — 21 tests.** Includes safe HTTP retry and configuration history, import-preview invalidation, independent review, stale facility-response suppression and retry identity.
- **Schema/migration contract checks: PASS.** Original schema fixture remains unchanged; the helper explicitly accounts for the nullable unique bank receipt link and previously migrated reconciliation approval fields, and barrel expectations enumerate new domain tables. Existing table metadata/joins remain asserted.
- **TypeScript: PASS.** `GOMAXPROCS=2 GOGC=50 npx tsc --noEmit`.
- **Lint: PASS with warnings.** Zero errors, 104 warnings across the existing workspace, including one effect-state warning in the new workspace. No lint suppressions added to hide bank failures.
- **Build and deploy artifact consistency: PASS.** `npm run build`, `npm run build:server`, `npm run deploy:verify`. Client build retains the existing large-chunk warning. Artifact verification does not prove a deployed host is running the build.
- **Full offline regression run: PASS — 1,910 tests passed, 818 skipped; 203 suites passed, 88 skipped, zero failures.** Database-dependent tests skip with the explicitly unavailable test connection and are not counted as database evidence. This run also includes the schema/migration contracts and existing UI/domain regressions.

One earlier full offline run had 1,907 passing tests and one guarded-DDL failure in the new migration. The migration was corrected to use the repository's `IF NOT EXISTS` convention without changing the test. The guarded-DDL suite and a fresh migration then passed. A later concurrent validation attempt was stopped after unconstrained TypeScript exhausted resources and caused test timeouts; constrained TypeScript and the 139-test financial rerun subsequently passed. Interrupted runs are not counted as successful validation.

### Reproduction

Use an approved disposable database and the repository's synthetic-target/identity guards. Set test connection variables through the normal local environment; do not copy production connection settings.

```sh
node scripts/run-script.mjs migrate
GOMAXPROCS=2 GOGC=50 npx tsc --noEmit
npm run lint
npm run build
npm run build:server
npm run deploy:verify
npx vitest run src/tests/vitest/bank-payments.db.spec.ts \
  src/tests/vitest/bank-reconciliation.db.spec.ts \
  src/tests/vitest/client-bank.db.spec.ts \
  src/tests/vitest/payment-hub.db.spec.ts \
  src/tests/integration/billing-posting.db.spec.ts \
  src/tests/integration/billing-gl-reconciliation.db.spec.ts \
  src/tests/integration/refund-receipt-acceptance.db.spec.ts \
  src/tests/integration/phase3b-refund-approval.db.spec.ts \
  src/tests/integration/phase3-financial-journeys.db.spec.ts \
  src/tests/integration/tenancy-billing-rbac-http.spec.ts \
  src/tests/integration/facility-owned-billing.db.spec.ts
npx vitest run src/tests/vitest/bank-payments-ui.spec.tsx \
  src/tests/vitest/billing-cashier-ui.spec.tsx
```

For full offline tests, point the connection explicitly at an unavailable local test port and set `JALICARE_REQUIRE_DB=0`. For actual DB evidence use `JALICARE_REQUIRE_DB=1` and a migrated approved synthetic target. Run heavyweight TypeScript separately from the regression suite in memory-constrained environments.

## Controlled rollout / operator handover

1. Obtain separate deployment approval. Review backups, additive migrations and source-linked financial controls in the deployment process; do not downgrade by deleting financial history.
2. Provision the existing payment-hub encryption key via the approved secret mechanism. Do not use synthetic test material. Preserve key recoverability for encrypted identifiers.
3. Seed the five new `bank_payments.*` permissions using the existing permission-seeding workflow. Review persisted role grants; configuration requires a designated facility administrator and `bank_payments.configure`, not platform status.
4. Ensure facility finance is enabled. In **Accounts**, configure the facility's real authorized receiving account and corresponding debit-normal asset GL. Confirm details out of band before activation.
5. Explicitly enable bank-only payments for that facility. This has no standard self-service policy deletion/downgrade: it is a deliberate financial control, not a reversible UI toggle. Other collection channels need explicit scope/approval and implementation review, not a receipt-method workaround.
6. Assign separate submitter, verifier and settlement approver. Settlement also requires the existing `billing.payments.record` grant. Statement and reconciliation operators require existing accounting permissions; refund operators retain existing independent approval permissions.
7. Rehearse a pending transfer, independently sourced statement CSV, exact verification, third-person settlement, reviewed GL posting, unmatched investigation and independent reconciliation approval in a non-production environment.
8. For a refund, independently approve the exact refund request and obtain outgoing statement evidence after the real transfer is completed externally. Never use a status edit, a journal-only reversal or record deletion as a bank refund.
9. Obtain facility finance UAT and deployment sign-off before processing real financial operations. No real facility or live provider was activated by this task.

## Known limits and work deliberately not claimed

- No live collection initiation, callback verification, automated bank-feed ingestion or outgoing refund initiation.
- Manual statement authenticity is an operational responsibility; imported CSV is evidence attested by authorized people, not cryptographic bank confirmation.
- KES only. Bank refund automation here covers eligible patient-attributed receipts; insurer-source refunds remain subject to the existing exclusions.
- Account/configuration history and payment history are bounded lists (100 config events, 300 payment events; 200 payment rows/invoices). Statement workspace uses its existing bounded import/line lists. A complete archival export/paginated bank register is not claimed.
- Reviewed GL posting is separate from receipt settlement. A receipt may exist with accounting pending; the UI labels this rather than pretending posting succeeded.
- Automated DOM/service/HTTP tests are not a real-browser visual/accessibility audit or facility operator UAT.
- Historical diagnostics remain separate; bank-only policy denies new STK initiation, but does not erase historical collections or discard legitimate historical financial records.
- No full all-database-suite run or production performance/concurrency certification is claimed; the 11 listed financial suites were actually executed.

## Preservation

Compared with the saved pre-implementation content baseline: 1,216 files remain byte-identical; 29 pre-existing paths changed for this bank implementation, plus new bank/migration/test/report files. The absent empty `auth-api.test.ts` was already marked deleted before implementation and was not recreated or treated as new deletion. The Git index was empty at the baseline and remains empty. No staging, commit, push, branch switch or history rewrite was performed.

Published migrations through 0090, the original schema-contract fixture, the claim invoice gate, synthetic identity attestation guards and existing letterhead implementation remain unchanged against that baseline. Pre-existing unrelated work remains in place.
