# Facility Integration Hub — implementation and evidence (2026-11-06)

## Status and scope

**PARTIALLY IMPLEMENTED; not production-ready.** The new facility marketplace brings the existing payment/banking and payer catalogues together. It adds a write-only API backed by AES-256-GCM storage for the existing **Daraja sandbox** adapter, credential-expiry enforcement, per-record key re-encryption, a sanitized scoped configuration audit, and a manual-only Jubilee listing. It does not make the existing application a complete universal live integration platform. No provider granted an API contract or credentials for this work; no live or real sandbox provider transaction was performed.

Provider activation, live callback authentication, verified eligibility, claim submission, settlement, bank feeds and financial postings must not be inferred from a catalogue listing, saved credentials, an OAuth token, a manual payer workflow or a recorded approval. No patient, invoice, claim, account or historical transaction was fabricated or rewritten for this change.

## Repository inspection and reuse

| Existing surface | Evidence and current role |
| --- | --- |
| `src/payment-hub/{service,routes,secrets,webhook.routes}.ts`; `adapters/{contracts,index,daraja,banks}.ts` | Facility/provider/environment assignment, policies, audit, OAuth/STK/status sandbox boundary, transaction references, sandbox unverified callback hints and manual receipt-link review. Production adapters remain blocked. |
| `src/insurance/hub`, `src/insurance/core`, `src/insurance/payers` | Facility assignment and workflow policy; manual/private payer workflows and separate unsupported electronic boundaries. Payer secrets still use facility/environment-specific server references, **not** the new Daraja vault. |
| `src/integrations/{sha,dha}`, `src/insurance/{eclaims,eligibility,claims,remittance}` | Separate SHA/DHA draft and manual workflows; live facility-isolated transport and authenticated callbacks remain blocked. SHA, AfyaLink and DHA are not interchangeable products. |
| `src/accounting/bank-integration.service.ts`, `src/routes/accounting.routes.ts`, `src/db/schema/banking.ts` | Facility bank accounts, CSV statement import and manually reviewed matching. This is not an API feed, transfer or proof of bank payment. |
| `src/billing/payments.service.ts`, `src/components/modules/payment-hub/PaymentTransactions.tsx`, `src/App.tsx` | Existing separately permissioned sandbox request/status/reconciliation screen and independent receipt service. The hub does not automatically create receipts or post accounting entries. |
| `src/auth`, `src/context/HmisContext.tsx`, `src/middleware/facility-module.middleware.ts` | Existing role, tenant/facility and module checks. A global `SUPER_ADMIN` is not automatically a facility finance or clinical user. |
| `src/db/schema/{payment-hub,insurance-payers,banking,private-insurance,sha-claims}.ts`; `drizzle/0028`, `0029`, `0067` | Reuse existing scoped provider, configuration, credential, account, payer, callback and audit records rather than creating parallel transaction tables. |
| `src/security/field-crypto.ts` | Legacy identifier encryption permits plaintext fallback and is **not** used for provider credentials. |

## Provider evidence and honest capability boundaries

| Provider/interface | Official information | Implemented boundary and remaining evidence |
| --- | --- | --- |
| Safaricom M-Pesa / Daraja | [Developer portal](https://developer.safaricom.co.ke/) and [Safaricom Node reference](https://github.com/safaricom/mpesa-node-library) | Sandbox OAuth, STK initiation and conservative status query exist. Automated tests mock transport; the public notification is an **unverified hint**. Production, authenticated callback, automatic receipt/settlement and GL posting remain blocked. Confirm current documentation, facility credentials, callback security and provider approval. |
| KCB / BUNI | [KCB BUNI](https://buni.kcbgroup.com/) | Separate adapter boundary; no implemented bank HTTP operations. Contract, facility-specific permissions and sandbox evidence are outstanding. |
| Equity | [Equity Online for Business](https://equitygroupholdings.com/ke/pay-send-money/sme-small-business/payment-services/equity-online-for-business/) | Business product advertises API/host-to-host features; no facility contract or bank adapter operations are established here. |
| NCBA | [NCBA](https://ncbagroup.com/) | Separate unavailable boundary; obtain official technical contract, authentication, permissions and sandbox details. |
| Britam | [Medical claims information](https://ke.britam.com/help/file-a-claim/medical-insurance-claim) | Local/manual payer workflow; no verified electronic provider API. |
| PACIS | [Medical cover preferred-provider form](https://www.pacisinsurance.com/wp-content/uploads/2025/08/PACIS-Insurance-Medical-Cover-Preferred-Provider-Outpatient-Claim-Form.pdf) | Local/manual payer workflow; no verified electronic provider API. |
| Jubilee | [Medical provider application and resources](https://jubileeinsurance.com/ke/medical-provider/) | New registry metadata uses the existing manual adapter, is unassigned by default and establishes no API access. Existing insurer definitions/policies are not overwritten. |
| SHA | [Provider EDI portal](https://api-edi.provider.sha.go.ke/) | Manual/internal workflows only; live facility-isolated eligibility, claims, remittance and callback transport remain blocked. |
| AfyaLink | [DHA AfyaLink integration information](https://afyalink.dha.go.ke/sha-portal-api-integration) | Informational marketplace card only, distinct from SHA. No facility-specific transport or configuration was implemented. |
| DHA eClaims/HIE | [DHA draft eClaims implementation guide](https://fhir.dha.go.ke/ig/eclaims/), [HIE documentation](https://hie-docs.dha.go.ke/introduction) | Informational card and existing draft internal code; no certified facility-specific live transport. The guide describes a draft/UAT interface, not provider approval or payment. |

No undocumented endpoint, bank password, customer PIN, OTP, provider success, claim approval or payment was invented. The marketplace also retains other providers already registered in the existing catalogue.

## Implemented behaviour and security

- **System Configuration → Integration Hub** provides categories and uses the existing independent catalogue APIs and permission gates. Provider assignments are still server-controlled; a frontend facility ID is only an authorization-checked hint. Existing bank and payer screens remain the operational source rather than duplicating their records. Static AfyaLink/DHA cards are explicitly informational.
- Daraja sandbox setup accepts exactly the five fields used by the existing adapter, or preserves the prior facility/environment-specific server-reference route. It rejects extra fields such as a PIN. The provider secret is encrypted before persistence; source and optional expiry are separate metadata, with an authenticated copy inside new ciphertext to detect alteration. API catalogue, audit and response payloads never return values; the UI clears entered fields after submission. HTTP credential configuration is rejected in production when the trusted TLS proxy does not mark the request secure.
- AES-256-GCM uses random IVs and associated tenant/facility/integration context; the integration row is uniquely tied to its provider and environment. Existing `v1` references remain readable. Named `v2` keys are server-provisioned and per-record re-encryption is scoped, authorized and audited, even for a revoked integration. An expiry blocks credential use; saved/rotated provider credentials disable setup and invalidate review. A failed OAuth test also blocks new collection until a successful recheck. Pending transaction status queries remain distinct from new collection.
- **Important rotation limitation:** the legacy `PAYMENT_HUB_ENCRYPTION_KEY` is also the stable HMAC key for existing idempotency/credential-identity digests. Do not change or retire it without a future reviewed migration. There is no bulk re-encryption inventory, complete key-retirement process or verified restore of encrypted backups. Back up named keys separately from database backups and retain old keys for all ciphertext and backups. See [payment-banking-hub.md](payment-banking-hub.md).
- `payment_hub.facility.manage` or `payer_hub.facility.manage`, respectively, gates the last 100 configuration events per domain. The history is tenant/facility scoped and excludes raw details, patient records and transaction details. Sensitive field names are also added to centralized log redaction. No credential read-back permission is provided.
- The dashboard displays selected environments/capabilities, current sandbox health, credential expiry/source and sanitized last error. It does **not** yet provide comprehensive last-successful transaction or verified callback-health metrics. Saving credentials does not mark production active.

## Outstanding work and safety blockers

1. A truly common adapter/registry, generic encrypted vault for banks and payers, environment switching for every domain, automated capability-to-module dispatch, token lifecycle management, comprehensive monitoring and bulk key rotation remain unimplemented.
2. Equity, KCB, NCBA, Britam, PACIS, Jubilee, SHA, AfyaLink and DHA require official versioned contracts, facility authorization and reviewed implementations before electronic operations can be enabled. No automated transfers or web scraping are provided.
3. Authenticated, provider-specific callbacks, durable retry/failure monitoring and their facility correlation require documented provider security schemes and authorized tests. Daraja callback events remain untrusted and never settle an invoice. SHA callback transport remains blocked.
4. Insurance eligibility, benefit estimates, preauthorization, claim approval, remittance advice, bank settlement and cash receipt remain separate states. The existing private remittance service contains legacy `parseMoneyToCents(...) ?? 0` branches for some claimed/approved/paid values; review missing-data semantics before claiming complete or production-safe reconciliation. No affected historical record was rewritten here.
5. Approved account mappings, correct ledger automation, bank/receipt matching, provider authorization, independent security review, TLS/proxy configuration, recovery testing, operational monitoring and real-facility UAT are prerequisites for production. No production database or provider was accessed.
6. The original request visible in this session ends mid-security requirement; omitted requirements cannot be assumed to have been implemented.

## Migration and verification

Migration `0067_facility_integration_vault` is additive: nullable source/expiry columns on `facility_payment_secrets`, plus a conflict-safe manual Jubilee registry seed and policies only when that seed is newly inserted. It neither assigns providers to facilities nor changes existing clinical, financial or audit history. Existing rows retain unknown metadata rather than invented expiry/source values.

- Populated synthetic database upgrade: only `0067` applied. Before/after counts preserved 9 payment configurations, 6 secret records, 500 invoices and 5,857 audit records; payer definitions increased from 16 to 17 and no Jubilee assignment was created.
- Fresh, separately named empty synthetic PostgreSQL database: all 68 journal migrations applied successfully; Jubilee had ten local/manual workflow policies and there were no seeded payment or payer assignments. Historical migration `0002`'s destructive statements ran **only on this newly created empty synthetic database**. No existing database was reset or deleted.
- Authenticated HTTP/PostgreSQL focused tests: 20 passed, including facility/permission isolation, encrypted storage, expiry, re-encryption, sanitized audit, callback/idempotency boundaries and mocked OAuth. No real provider network was used.
- UI/crypto/permission focused tests: 33 passed across the marketplace, credential form, encryption and existing role/module tests. A separate real Chromium-to-PostgreSQL smoke test over a local self-signed HTTPS proxy passed marketplace configuration, write-only encrypted sandbox save, re-encryption, audit, cross-facility denial and tablet/mobile layout. Self-signed certificate trust was bypassed **only** for this isolated synthetic test; it is not a deployment TLS verification. The first browser attempt could not load `libnspr4.so`; correcting the local library path allowed the passing rerun.
- The first full PostgreSQL regression ran 2,052 tests: 2,050 passed and two schema-contract tests failed because the reviewed additive columns were not yet reflected in the schema-contract helper. The historical baseline was kept intact; the exact two new column definitions were added to the reviewed-additions helper, after which the focused schema contracts passed.
- **Final full regression: 223 files and 2,052 tests passed, no skips**, with PostgreSQL mandatory and a fresh synthetic field-encryption key. This run used a second newly created, separately named empty synthetic database, on which all 68 migrations were applied; no existing database was reset. Coverage: 63.49% statements, 59.08% branches, 63.86% functions, 64.59% lines. A separate six-file targeted rerun passed 165 tests, including credential-source/expiry tamper detection.
- **Quality gates passed:** TypeScript typecheck; Prettier format check; ESLint (0 errors, 87 warnings); client and server production builds (Vite warned about a >500 kB chunk); `git diff --check`; production dependency audit (0 vulnerabilities); and the current-tree tracked-database-backup guard. An initial attempt to run a nonexistent `security:check-backups` npm script failed; invoking `node scripts/check-tracked-database-backups.mjs` passed. The guard does not inspect Git history or external copies.
- The final Chromium smoke reran successfully with explicit `BROWSER_NO_SANDBOX=1` in this isolated environment; the flag is opt-in, not the script default. It used real login and PostgreSQL but a synthetic self-signed certificate and synthetic credentials; no provider call was made.
- **Not performed:** real provider sandbox/UAT, production database migration/deployment, live certificate/proxy assessment, independent security review, authenticated provider callbacks, external settlement and live bank/payer integration. GitHub checks for the new commit must be reviewed separately.

## Exact changed-file inventory

- `.env.example`
- `docs/integrations/payer-integration-hub.md`
- `docs/integrations/payment-banking-hub.md`
- `docs/integrations/universal-facility-integration-hub-2026-11-06.md`
- `drizzle/0067_facility_integration_vault.sql`
- `drizzle/meta/_journal.json`
- `scripts/integration-hub-browser-synthetic.mjs`
- `src/api/integration-hub.types.ts`
- `src/api/payer-hub.client.ts`
- `src/api/payment-hub.client.ts`
- `src/components/modules/ConfigurationModule.tsx`
- `src/components/modules/FacilityIntegrationHub.tsx`
- `src/components/modules/IntegrationConfigurationAudit.tsx`
- `src/components/modules/payer-hub/FacilityPayerIntegrations.tsx`
- `src/components/modules/payment-hub/FacilityPaymentIntegrations.tsx`
- `src/db/schema/payment-hub.ts`
- `src/insurance/hub/routes.ts`
- `src/integrations/hub/configuration-audit.ts`
- `src/logging/logger.ts`
- `src/payment-hub/routes.ts`
- `src/payment-hub/secrets.ts`
- `src/payment-hub/service.ts`
- `src/tests/facility-modules.spec.ts`
- `src/tests/staff-roles.spec.ts`
- `src/tests/support/schema-contract.ts`
- `src/tests/vitest/integration-marketplace-ui.spec.tsx`
- `src/tests/vitest/logger.spec.ts`
- `src/tests/vitest/payer-hub.db.spec.ts`
- `src/tests/vitest/payment-hub-ui.spec.tsx`
- `src/tests/vitest/payment-hub.db.spec.ts`
- `src/tests/vitest/payment-hub.spec.ts`
