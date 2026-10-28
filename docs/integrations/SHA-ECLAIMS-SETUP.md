# SHA eClaims, DHA HIE v1 & Kenya eClaims FHIR R4 Integration Guide

This document describes how JaliCare HMIS integrates with Kenya's **Social Health Authority (SHA)** and **Digital Health Agency (DHA)** across:

1. **DHA HIE Middleware v1 REST API** (`https://hie-docs.dha.go.ke` / UAT `https://ilm-dev.dha.go.ke/uat-middleware/api/v1`)
2. **DHA AfyaLink Gateway** (`https://afyalink.dha.go.ke` / UAT `https://uat.dha.go.ke`)
3. **Kenya eClaims FHIR Implementation Guide v0.1.0 — Draft** (`https://fhir.dha.go.ke/ig/eclaims/`, canonical `https://nshr-uat.sha.go.ke/fhir`, FHIR R4 `4.0.1`)

---

## 1. Specification Status & Dual-Protocol Design

- **Kenya eClaims FHIR IG v0.1.0 Draft Notice**: The official FHIR R4 IG published at `https://fhir.dha.go.ke/ig/eclaims/` is currently at **v0.1.0 Draft**. In live UAT/production onboarding, DHA simultaneously operates the **HIE v1 REST Middleware** (`hie-docs.dha.go.ke`) and **AfyaLink SHR Mediator** (`/v1/shr-med/bundle`, `/v1/shr-med/claim-status`).
- JaliCare implements **both** protocols cleanly inside `src/integrations/sha/` while keeping internal insurance workflows (`src/insurance/eclaims/`) and the Private Insurance module (`src/insurance/*` for Britam/PACIS) strictly separated:
  - **FHIR R4 4.0.1 Conformance (`src/integrations/sha/sha.fhir.ts`)**: Generates and validates `KenyaClaimSubmission` (`collection` Bundle), `KenyaClaimBase`, `EClaimsPatient` (`name.family 1..1`), `EclaimsCoverage` (`subscriber 1..1`, `class 1..*`), `EClaimsOrganization` (`Provider` + inline `Organization/sha-insurer`), `EClaimsEncounter`, `EpisodeOfCare`, `EClaimsCondition` (ICD-11 primary coding), `Practitioner` (`KMPDC`/`COC`/`NCK`/`PPB`), `MedicationRequest`, `MedicationDispense`, `DiagnosticReport`, and specialist preauth profiles (`surgicalpreauth`, `renalpreauth`, `oncologypreauth`, `opticalpreauth`, `imagingpreauth`).
  - **Hard Clinical & Terminology Guardrails**:
    - **SNOMED CT (`http://snomed.info/sct`) is strictly prohibited** per Kenya eClaims IG terminology bindings (`MOH-KENYA` OCL + HL7 `required` bindings).
    - **Currency**: `KES` (ISO 4217) only.
    - **Intervention Catalogue & Combination Rules**: Enforces `SHA-*` / `PMF-*` service codes and blocks standalone primary interventions (`SHA-01`, `SHA-05`, `SHA-06`, `SHA-09`, `SHA-10`, `SHA-12`, `SHA-18`) from combining with other interventions in a single claim.

---

## 2. All 10 Connected SHA Workflows

| #   | Workflow                                             | Official Endpoint / Profile                                                                                                                        | JaliCare Implementation                                                                                                                                                                                                 |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Client Registry Identity (`CR ID`) & Eligibility     | `GET /patients`, `POST /fhir/Patient/$match`, `GET /patients/eligibility` (`X-Facility-Id`, `X-Facility-Id-Type: fr-code`)                         | Resolves MPI `CR ID`, prefers `ClientRegistry ID`, blocks deceased beneficiaries (`isAlive === false` -> `CONFIRMED_DECEASED`), matches `POMSF*`/`TSC`/`USALAMA` prefixes, and never maps API failures to `Ineligible`. |
| 2   | Benefit, Sub-Benefit & Intervention Coverage         | `GET /patients/benefits`, `/patients/sub-benefits`, `/patients/benefits/interventions`                                                             | Retrieves `needsPreauth`, `needsManualPreauthApproval`, `needsDoctorAuthorization`, specialist flags, and tariffs.                                                                                                      |
| 3   | Benefit Utilization, POMSF & Bed Occupancy           | `GET /patients/benefits/utilization`, `/patients/pomsf-balances`, `/facilities/{code}/beds/occupancy`                                              | Persists `sha_benefit_utilization_snapshots` and blocks exhausted individual/household limits.                                                                                                                          |
| 4   | Service-Code & Tariff Mapping Validation             | `SHA-*` / `PMF-*` catalogue + approved `payer_benefit_rules`                                                                                       | Preserves JaliCare facility tariffs intact while rejecting SNOMED CT or unmapped codes.                                                                                                                                 |
| 5   | Beneficiary Consent, Visit Auth & Preauthorization   | `POST /claims/authorize` (`AUTHORIZED` vs `AUTHORIZED_PENDING_VISIT`), `POST /claims/visit`, `POST/GET /preauths`, `/preauths/cancel`, FHIR `T-02` | Supports OTP/Biometrics consent, 6 specialist preauth variants, doctor consent (`doctorApproved`), and locks approved scope against un-audited edits.                                                                   |
| 6   | Claim Preparation from Clinical & Billing Records    | JaliCare `encounters`, `diagnoses`, `medications`, `lab_orders`, `admissions`, `billing_invoices`                                                  | Assembles OPD/Pharmacy/IPD claim packages without mutating JaliCare invoices or marking them paid prematurely.                                                                                                          |
| 7   | Claim Bundle / Virtual Claim Validation & Submission | `POST /v1/shr-med/bundle` / `/Bundle` (`T-01`/`T-04`/`T-05`) & HIE `/claims/submit` (OPD) vs `/claims/discharge` (IPD)                             | Pre-submission FHIR + combination validator, unique `claimUuid`, and zero blind retries on non-idempotent `POST` submissions.                                                                                           |
| 8   | Claim Status Polling, Push Callbacks & Resubmission  | `GET /v1/shr-med/claim-status`, `/ClaimResponse`, `POST /api/webhooks/sha/status`, `Claim.related`                                                 | Constant-time `SHA_WEBHOOK_SECRET` verification, idempotent `sha_callback_events`, and audited resubmission of `REJECTED` claims.                                                                                       |
| 9   | 2-Step Remittance Sync & Invoice Reconciliation      | HIE `Get Remittances` (`bank_reference`) -> `Get Claims Paid by Remittance` + FHIR `PaymentNotice` (`T-06`)                                        | Posts additive `'SHA'` receipts to `billing_payments` and reconciles Claimed vs Approved vs Paid variances.                                                                                                             |
| 10  | Operational Reporting & IHE ATNA Audit History       | `GET /api/insurance/sha/operational-report`                                                                                                        | Facility-scoped SHA financial/clinical KPIs and RFC 3881 / IHE ATNA-structured audit trail.                                                                                                                             |

---

## 3. Environment Variables (Server-Side Only)

Configure in `.env` or host secret manager (never prefix with `VITE_`):

```dotenv
SHA_MODE=mock                    # mock | sandbox | production
SHA_ALLOW_PRODUCTION=false       # Required true when SHA_MODE=production
SHA_MIDDLEWARE_BASE_URL=         # UAT default: https://ilm-dev.dha.go.ke/uat-middleware/api/v1
SHA_AFYALINK_BASE_URL=           # UAT default: https://uat.dha.go.ke
SHA_FHIR_IG_BASE_URL=            # UAT default: https://nshr-uat.sha.go.ke/fhir
SHA_CLIENT_ID=                   # Issued via AfyaConnect / AfyaLink onboarding
SHA_CLIENT_SECRET=               # Issued via AfyaConnect / AfyaLink onboarding
SHA_FACILITY_REGISTRY_CODE=      # Facility Registry code (fr-code), e.g. FID-47-xxxxxx-x
SHA_FACILITY_ID_TYPE=fr-code     # fr-code | registration-number | fid
SHA_TENANT_ID=                   # Required only when registering HIE callback endpoints
SHA_WEBHOOK_SECRET=              # Required to accept inbound /api/webhooks/sha/status callbacks
SHA_TIMEOUT_MS=15000
SHA_MAX_GET_RETRIES=1
```

### Deterministic Sandbox Simulation Suffixes (`SHA_MODE=mock`)

All mock responses carry `isSimulated: true` and `source: 'SANDBOX_SIMULATION'`:

- Identifier ending in `6666` → `Ineligible` (`CONFIRMED_DECEASED`, `isAlive: false`)
- Identifier ending in `0000` → `Ineligible` (`UNPAID_CONTRIBUTION`)
- Identifier ending in `9999` → `Pending` (`PENDING_ACTIVATION`)
- Identifier ending in `8888` → `Manual review required` (`MANUAL_REVIEW`)
- Identifier ending in `7777` → `Eligible` with `POMSF-TSC` + `SHIF` + `PHC`
- Identifier ending in `5000` → `Unable to verify` (simulated gateway timeout)
- Identifier ending in `4040` → Client Registry `Not Found`
- OTP `'000000'` → Beneficiary consent declined

---

## 4. Database Migrations & RBAC Provisioning

1. Apply forward-only migrations (`0024_sha_eclaims_and_benefits.sql` and `0026_sha_hie_workflows_and_fhir_ig.sql`):
   ```bash
   npm run db:migrate:deploy
   ```
2. Synchronize granular `insurance.sha.*` permissions:
   ```bash
   npm run db:seed:permissions -- --yes
   ```
