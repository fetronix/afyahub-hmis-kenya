# JaliCare HMIS — Private Insurance Multi-Payer Module (Britam & PACIS First)

## 1. Purpose & Architectural Principles

JaliCare's Private Insurance & Multi-Payer Engine (`src/insurance/*`, `/api/insurance/*`) provides end-to-end hospital private insurance workflows inside the existing JaliCare multi-tenant HMIS without duplicating patient, clinical, diagnostic, pharmacy, tariff, or billing records.

First-class priority insurers:
1. **Britam Insurance Kenya (`BRITAM`)**
2. **PACIS Insurance Company Ltd (`PACIS`)**

Additional insurers (e.g. AAR, Jubilee, CIC, Madison) can be added dynamically per facility via `/api/insurance/payers` without schema changes. Public **SHA** eClaims (`src/integrations/sha/`, `/api/insurance/sha/*`) remains intact and interoperable alongside private insurers.

---

## 2. SmartLink Workflow Reference vs Insurer Independence

SmartLink workflow concepts are implemented as **canonical workflow capabilities** in `src/insurance/core/types.ts` and `src/insurance/payers/smartlink.adapter.ts`:
1. OAuth2 client-credentials token exchange (`OAUTH2_TOKEN`)
2. Visit / session creation & biometric/virtual activation (`VISIT_SESSION_CREATE`, `VISIT_SESSION_CLOSE`)
3. Member & benefit verification (`MEMBER_ELIGIBILITY`, `BENEFITS_INQUIRY`)
4. Service-rule & copayment inquiry (`SERVICE_RULE_CHECK`, `COPAYMENT_INQUIRY`)
5. Preauthorization submission, document attachment & feedback (`PREAUTH_SUBMIT`, `PREAUTH_STATUS`)
6. Claim submission, clinical record submission & claim status tracking (`CLAIM_SUBMIT`, `CLAIM_STATUS`, `CLINICAL_RECORDS_SUBMIT`)
7. New service-code mapping submission (`SERVICE_MAPPING_SYNC`)

**Strict non-assumption rules enforced in code:**
- Britam (`britam_direct`) and PACIS (`pacis_direct`) are independent payer adapters with separate configurations, endpoints, secret prefixes, provider panel codes, service mappings, benefit rules, copayments, preauthorizations, claims, and remittances.
- Neither Britam nor PACIS is assumed to use SmartLink unless a hospital explicitly configures that insurer with `integrationType = 'THIRD_PARTY_GATEWAY'` and `adapterKey = 'smartlink_gateway'`.
- No unverified production URLs, endpoints, auth scopes, payload schemas, or approval codes are hardcoded or fabricated.

---

## 3. Relational Reuse Across JaliCare Modules

```text
patients (existing)
  └── insurance_member_policies (multiple policies per patient & payer)
        ├── encounters / admissions / diagnoses / lab_orders / medications (existing)
        ├── private_insurance_preauthorizations + private_insurance_preauth_attachments
        └── billing_invoices + billing_items + billing_payments (existing — never mutated on claim prep/submit)
              └── private_insurance_claims + private_insurance_claim_lines
                    ├── private_insurance_claim_submissions + private_insurance_claim_status_history
                    └── private_insurance_remittances -> billing_payments + private_insurance_reconciliation_entries
```

---

## 4. Security, Secret Handling & RBAC

- **Zero raw secrets in DB or UI**: `insurance_payer_configs.secret_env_prefix` stores only an alphanumeric prefix (e.g. `BRITAM_API`, `PACIS_API`, `SMARTLINK_API`). The backend checks `process.env[${PREFIX}_CLIENT_ID]`, `process.env[${PREFIX}_CLIENT_SECRET]`, and `process.env[${PREFIX}_API_KEY]` server-side only and exposes boolean presence indicators.
- **Diagnostics redaction**: `sanitizeDiagnosticSummary()` scrubs Bearer tokens, client secrets, API keys, passwords, and national IDs before persisting to `audit_logs` or `insurance_integration_diagnostics`.
- **Granular RBAC permissions**:
  - `insurance.payers.read`, `insurance.payers.manage` (protected admin-only)
  - `insurance.members.read`, `insurance.members.manage`
  - `insurance.eligibility.check`
  - `insurance.benefits.validate`
  - `insurance.mappings.manage` (protected admin-only)
  - `insurance.preauthorization.manage`
  - `insurance.private.claims.prepare`, `insurance.private.claims.submit`
  - `insurance.private.remittance.reconcile`

---

## 5. Exact Onboarding Checklist Required from Britam & PACIS for Live API Dispatch

Until the items below are issued by each insurer (or an approved gateway partner), JaliCare honestly displays **`Awaiting insurer documentation`** and supports complete internal policy management, audited manual verification, benefit estimation, preauthorization tracking, claim preparation, portal/batch export recording, and remittance reconciliation:

1. **Britam Insurance Kenya (`BRITAM`)**:
   - Official hospital provider API specification (or written confirmation of an approved aggregator gateway such as SmartLink / Slade360)
   - Contracted Britam Hospital Provider Panel Code (`providerIdentifier`)
   - Sandbox & production HTTPS base URLs and authentication contract (`BRITAM_API_CLIENT_ID` / `BRITAM_API_CLIENT_SECRET` or mTLS certificate)
   - Contracted Britam service tariff schedule & scheme copayment/exclusion schedule

2. **PACIS Insurance Company Ltd (`PACIS`)**:
   - Official PACIS provider API specification or approved electronic claims aggregator onboarding confirmation
   - Assigned PACIS Preferred Provider Code (`providerIdentifier`)
   - Sandbox & production HTTPS base URLs and credentials (`PACIS_API_CLIENT_ID` / `PACIS_API_CLIENT_SECRET`)
   - Contracted PACIS outpatient/inpatient tariff schedule, preauthorization thresholds, and claim attachment rules
