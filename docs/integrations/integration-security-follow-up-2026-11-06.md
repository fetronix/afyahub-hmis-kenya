# Facility Integration Hub — security follow-up (2026-11-06)

## Status

**PARTIALLY IMPLEMENTED; not production-ready.** This follow-up hardens the existing hub without enabling a provider or inventing a callback-authentication scheme. Daraja and SHA callbacks return HTTP 503 and do not apply events. No real provider, facility credential, patient or production database was used. A passing synthetic test is not provider approval, a verified settlement, a security certification, or permission to deploy.

## Requirements and evidence

| # | Security requirement | Status and remaining limitations |
| --- | --- | --- |
| 1 | Authenticated encryption at rest | **PARTIALLY IMPLEMENTED.** The Daraja sandbox vault uses random-IV AES-256-GCM with tenant/facility/integration AAD and authenticated configuration metadata. Payer entries are server-side secret references, not a generic encrypted provider vault. Existing free-text fields and historical notes/JSON were preserved and may contain improperly entered material; no production inventory or remediation has been performed. |
| 2 | Keys outside PostgreSQL and frontend | **IMPLEMENTED BUT NOT VERIFIED in deployment.** Keys are read from server environment/secret manager, never requested from the browser. Real secret-manager policy, access controls, TLS and deployment configuration were not inspected. |
| 3 | No credentials in responses, logs, audit or exports | **PARTIALLY IMPLEMENTED.** Vault values are write-only and masked. Scoped configuration audit omits details; historical payer notes/unknown requirements and diagnostic/callback payloads are withheld, and new diagnostics minimize provider text. Key-name redaction and validation cannot prove that arbitrary legacy or user-entered free text contains no secret. No production data scan or complete legacy cleanup was performed. |
| 4 | Tenant/facility isolation | **PARTIALLY IMPLEMENTED.** The hub and the corrected diagnostic/SHA report paths check authenticated tenant and facility; tests cover sibling and cross-tenant denial and inconsistent historical associations. This is not an independent proof that every legacy module, deployment and historical record is isolated. |
| 5 | Sandbox/production separation | **PARTIALLY IMPLEMENTED.** Payment configurations, references and transactions are scoped by environment. For the same facility/provider, newly saved Daraja credentials cannot share the consumer secret or passkey between environments; old environment references lacking component evidence require review. Identical consumer keys are rejected across integrations. This is not a global check for every secret component across different facilities, and payer live transport remains blocked. No real endpoint or callback separation has been verified with a provider. |
| 6 | Facility-administrator RBAC | **IMPLEMENTED AND SYNTHETICALLY TESTED for the hub.** A facility-bound `FACILITY_ADMIN` must also hold the route permission for configuration, credentials, tests, activation and disablement. Global SUPER_ADMIN and delegated non-admin roles alone do not grant facility access. Operational payment permissions remain separate. |
| 7 | Replacement, re-encryption, expiry, revocation | **PARTIALLY IMPLEMENTED.** Local payment revocation disables the integration and resets health/approval; re-encryption is scoped/audited and does not change provider credentials. An encrypted history of keyed fingerprints prevents reusing revoked Daraja secret components within the same integration after replacement; legacy environment references without component evidence can only be checked against the previously recorded full-bundle fingerprint. Payer reference revocation advances the reference version on replacement but cannot verify provider rotation. Local revocation cannot cancel in-flight requests or revoke a credential at the provider. |
| 8 | Auditable configuration/test/activation changes | **IMPLEMENTED AND SYNTHETICALLY TESTED for hub actions.** Scoped audit records actor, facility, timestamp and action; output omits free-form details. An unavailable payer connection-test attempt is audited as not tested, not success. Historical audit records are not rewritten. |
| 9 | Authenticate and validate callbacks | **BLOCKED BY PROVIDER DOCUMENTATION/APPROVAL.** Daraja and SHA callbacks reject all requests; SHA's old exported processor also fails closed. Provider-specific authentication, event/reference, amount, currency, facility and state validation have not been implemented or verified. Never enable them from an HTTP 200 or guessed signature. |
| 10 | Replay-safe financial side effects | **PARTIALLY IMPLEMENTED.** Disabled callbacks cannot mutate or duplicate payment/claim/remittance state. Synthetic tests exercise rejected replays, request idempotency and existing receipt-matching guards. They do not prove end-to-end idempotency for a future authenticated callback. Automatic provider settlement and GL posting remain unavailable. |
| 11 | Backup protection and key recovery | **DOCUMENTED, NOT VERIFIED.** See the runbook below. No real encrypted backup, key-escrow recovery, restore exercise, external revocation ledger or key-retirement procedure was tested. |
| 12 | Production approval and activation | **BLOCKED.** Production operation is hard-blocked even after a recorded administrative approval and sandbox health. Provider-issued production credentials, official approval, facility validation, security review and authorized activation are still required. |
| 13 | No sensitive information in errors/logs | **PARTIALLY IMPLEMENTED.** Hub error paths avoid returning provider bodies; high-risk SHA transport error details and diagnostic summaries are withheld. Arbitrary historical/free-text or other legacy application paths have not been exhaustively remediated. Do not put secrets or patient data in tickets, diagnostics or test fixtures. |
| 14 | Automated security tests | **PARTIALLY IMPLEMENTED.** Synthetic PostgreSQL/HTTP, unit, UI and browser tests exercise AES-GCM/AAD, roles, isolation, expiry, tampering, environment separation, rotation, revocation, rejected callback replay and transaction guards. Verified provider-specific callback authentication, positive callback validation/replay and live-provider tests remain unimplemented. |

## Operational key, backup and revocation runbook

1. Use a controlled server-side secrets manager with least privilege, access monitoring and an approved incident owner. Never put keys or provider secrets in Git, browser-visible variables, database rows, tickets or logs. Encrypt database backups independently, restrict and audit access, apply retention rules, and keep key escrow separately protected from database copies. Historical records and free text may contain sensitive information even if vault rows are encrypted.
2. `PAYMENT_HUB_ENCRYPTION_KEY` is both the legacy `v1` AES key and the stable HMAC key used for existing credential identity, revoked-material fingerprints and idempotency digests. **Do not rotate or retire it casually:** a safe HMAC migration and complete key-retirement process are not implemented.
3. To stage a named `v2` vault key, provision `PAYMENT_HUB_VAULT_KEY_<ID>` on every application instance, retain the old keys, and set `PAYMENT_HUB_ACTIVE_VAULT_KEY_ID` through the approved change process. An authorized facility administrator may re-encrypt each retained record, including records for an unassigned or disabled provider. This changes ciphertext only, not provider-issued credentials. There is no bulk inventory tool; separately inventory key IDs without printing ciphertext, credential values or digests. Keep old keys for every remaining record and retained backup until a reviewed restore exercise and retention policy permit retirement.
4. To revoke, use the scoped administrator control and record the incident externally. Ask the provider to revoke/replace the underlying credentials, and ask the server operator to rotate any secret-manager value. The facility must enter the distinct replacement and repeat authorized validation. Revoking a payer reference creates a new versioned namespace on replacement, but provisioning a different namespace is **not** proof that the provider credentials changed. Manual payer workflows remain separate.
5. A database restore or malicious full rollback can restore an older ciphertext and old revocation flags together; authenticated encryption cannot detect an entire valid historical snapshot. Before any restored integration is used, compare with an independently retained incident/revocation record, reconcile affected transactions, revoke or rotate provider credentials as needed, and obtain authorized review. An external monotonic revocation ledger is not implemented. Never silently replay pending financial operations after a restore.
6. If a key is lost, encrypted records/backups requiring it cannot be decrypted; recovery depends on independently secured key escrow or provider credential replacement. If a key is compromised, disable affected integrations, contact the provider and security owner, and follow the approved incident and rekey plan. No recovery drill, key escrow or provider revocation was performed here.

## Migration and verification

- Additive `0068_integration_credential_revocation` adds nullable revocation timestamps and payer-reference generation. On two isolated synthetic PostgreSQL databases, only this migration was applied; no existing database was reset. In the second upgrade, 7 payment configurations, 5 secrets, 156 invoices and 1,654 audit rows were preserved; existing rows were not marked revoked.
- Focused synthetic HTTP/PostgreSQL/UI tests passed: 5 files, 45 tests. Additional financial-safety tests passed for invalid stored amounts, no fabricated zero and unchanged state.
- Real-login Chromium to synthetic PostgreSQL over a local self-signed HTTPS proxy passed save, re-encryption, revocation, distinct replacement, scoped audit, sibling denial and responsive layout. Chromium certificate trust and sandbox bypass were enabled only for this isolated test; this is not a TLS deployment assessment.
- Initial expanded tests caught stale callback/status assumptions and a fixture issue; they were corrected and rerun. The first full regression had 2,057 passes and one failure: an old payer-configuration test still submitted free-text notes. The positive configuration assertions were retained, a negative unsafe-notes assertion was added, and the focused rerun passed.
- A second full regression had 2,060 passes and one existing pharmacy timezone-test failure: `timestamp without time zone` was parsed in the test process timezone. The test now explicitly reads the newly written UTC instant as UTC without changing its assertion or historical records; the focused pharmacy suite passed 19 tests. Legacy timestamp interpretation remains a separate review item. The next full mandatory-PostgreSQL regression passed 223 files and 2,061 tests.
- The authenticated SHA mapping endpoint now preserves existing notes when the field is omitted, permits explicit edits or clearing, and keeps sibling-facility mappings isolated. The dedicated synthetic HTTP/PostgreSQL suite passed 7 tests; mapping audit entries omit those notes. A subsequent full mandatory-PostgreSQL regression passed 223 files and 2,062 tests (before the last additional audit-existence assertion, which was checked separately).
- Final local formatting and typecheck passed; lint passed with 87 pre-existing warnings. The current-tree database-backup guard passed but does not inspect Git history or external copies.
- The implementation commit `e4edc4a` passed all seven [GitHub CI jobs](https://github.com/fetronix/afyahub-hmis-kenya/actions/runs/42202732622), including formatting, typecheck/lint, PostgreSQL coverage and migrations, production build, dependency audit and fresh-checkout Docker bootstrap. These results precede the mapping-note follow-up.
- Not performed: real provider sandbox/UAT, live callbacks or claims, production migration/deployment, actual backup restore, provider-side credential rotation, deployment TLS review, independent security assessment, or real-facility acceptance.

The prior implementation and provider evidence are in [the facility integration hub report](universal-facility-integration-hub-2026-11-06.md), with operational instructions in [the payment/banking guide](payment-banking-hub.md) and [the payer guide](payer-integration-hub.md).

## Security follow-up changed-file inventory

- `.env.example`
- `docs/integrations/integration-security-follow-up-2026-11-06.md`
- `docs/integrations/payer-integration-hub.md`
- `docs/integrations/payment-banking-hub.md`
- `docs/integrations/universal-facility-integration-hub-2026-11-06.md`
- `drizzle/0068_integration_credential_revocation.sql`
- `drizzle/meta/_journal.json`
- `scripts/integration-hub-browser-synthetic.mjs`
- `src/api/payer-hub.client.ts`
- `src/api/payment-hub.client.ts`
- `src/components/modules/FacilityIntegrationHub.tsx`
- `src/components/modules/payer-hub/FacilityPayerIntegrations.tsx`
- `src/components/modules/payment-hub/FacilityPaymentIntegrations.tsx`
- `src/components/modules/payment-hub/PaymentTransactions.tsx`
- `src/db/schema/insurance-payers.ts`
- `src/db/schema/payment-hub.ts`
- `src/insurance/audit/diagnostics.service.ts`
- `src/insurance/claims/private-claims.service.ts`
- `src/insurance/eclaims/benefits.service.ts`
- `src/insurance/eclaims/claims-workflow.service.ts`
- `src/insurance/eclaims/configuration.service.ts`
- `src/insurance/eclaims/contracts.ts`
- `src/insurance/eclaims/preauthorization.service.ts`
- `src/insurance/eclaims/remittance.service.ts`
- `src/insurance/hub/guards.ts`
- `src/insurance/hub/routes.ts`
- `src/insurance/hub/service.ts`
- `src/insurance/payers/payer-config.service.ts`
- `src/insurance/payers/smartlink.adapter.ts`
- `src/insurance/remittance/remittance-reconciliation.service.ts`
- `src/integrations/hub/configuration-audit.ts`
- `src/integrations/hub/facility-authorization.ts`
- `src/payment-hub/adapters/daraja.ts`
- `src/payment-hub/adapters/index.ts`
- `src/payment-hub/routes.ts`
- `src/payment-hub/service.ts`
- `src/payment-hub/webhook.routes.ts`
- `src/routes/private-insurance.routes.ts`
- `src/routes/sha-eclaims.routes.ts`
- `src/tests/integration/pharmacy-inventory-billing.db.spec.ts`
- `src/tests/payer-policy-guards.db.spec.ts`
- `src/tests/private-payer-configuration.db.spec.ts`
- `src/tests/support/schema-contract.ts`
- `src/tests/vitest/integration-marketplace-ui.spec.tsx`
- `src/tests/vitest/payer-hub.db.spec.ts`
- `src/tests/vitest/payment-hub-ui.spec.tsx`
- `src/tests/vitest/payment-hub.db.spec.ts`
- `src/tests/vitest/payment-hub.spec.ts`
- `src/tests/vitest/private-insurance.db.spec.ts`
- `src/tests/vitest/private-insurance.spec.ts`
- `src/tests/vitest/sha-eclaims.db.spec.ts`
- `src/tests/vitest/sha-eclaims.spec.ts`
