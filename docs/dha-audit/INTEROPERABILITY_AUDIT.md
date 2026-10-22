# Interoperability Audit — HIE, FHIR, terminology and exchange

**Audit date:** 21 October 2026
**Code under audit:** `src/integrations/`, `src/db/schema.ts`, `src/app.ts` (interop routes)

---

## 1. Verdict first

| Question | Answer |
|---|---|
| Does Jalicare have a DHA integration? | **A partially implemented adapter, exercised only against local fixtures.** |
| Has it ever exchanged data with DHA? | **No evidence.** No sandbox credential was available, and no live call was made. |
| Is production enabled? | **No.** `DHA_ALLOW_PRODUCTION` defaults to false, and production requires a base URL DHA has not published. |
| Is the FHIR layer complete? | **No.** One read-only `Patient` resource. |
| Is terminology mapped? | **No.** ICD-10 is free text; no KNHTS, LOINC or ATC mapping table. |
| Is the claimed 74% justified? | **Not by this code.** The evidence supports roughly a quarter of the interoperability requirements, most of it untested against DHA. |

The register scores interoperability at **42.9%** with **zero verified**
requirements (see `DHA_REQUIREMENT_TRACEABILITY.md`). Nothing in that category
has been exercised against the real service, so nothing is marked verified.

---

## 2. What exists, operation by operation

Source of truth: `DHA_OPERATIONS` in `src/integrations/dha/dha.readiness.ts`.

| Operation | Method | Path | Implemented | Notes |
|---|---|---|---|---|
| `auth.token` | POST | `/tenants/token` | **Yes** | Client-credentials exchange, cached |
| `eligibility.check` | GET | `/patients/eligibility` | **Yes** | Returns SHA coverage |
| `coverage.benefits` | GET | `/patients/benefits` | **Yes** | |
| `coverage.interventions` | GET | `/patients/benefits/interventions` | **Yes** | |
| `coverage.subBenefits` | GET | `/patients/sub-benefits` | **Yes** | |
| `coverage.utilization` | GET | `/patients/benefits/utilization` | **Yes** | |
| `coverage.pomsf` | GET | `/patients/pomsf-balances` | **Yes** | |
| `patients.search` | GET | `/patients` | No | Response schema not captured |
| `consent.authorize` | POST | `/claims/authorize` | No | No OTP channel, no biometric agent |
| `claim.startVisit` | POST | `/claims/visit` | No | Depends on consent |
| `claim.lines` | POST | — | No | Contract not captured |
| `claim.diagnoses` | POST | — | No | Contract not captured |
| `preauth.submit` | POST | — | No | Contract not captured |
| `remittance.read` | GET | — | No | Contract not captured |

**7 implemented, 7 not.** The reasons are recorded per operation rather than
summarised as "in progress".

### 2.1 Configuration model

`src/integrations/dha/dha.config.ts` defines three modes:

| Mode | Behaviour |
|---|---|
| `mock` | Deterministic fixtures. No network call. Every UI result displays a **MOCK** badge. |
| `sandbox` | Calls the published UAT base URL. Requires client id, secret and facility code. |
| `production` | Refused unless `DHA_ALLOW_PRODUCTION=true` **and** `DHA_BASE_URL` is set. |

Environment variables: `DHA_MODE`, `DHA_BASE_URL`, `DHA_CLIENT_ID`,
`DHA_CLIENT_SECRET`, `DHA_FACILITY_CODE`, `DHA_TIMEOUT_MS`,
`DHA_MAX_RETRIES`, `DHA_ALLOW_PRODUCTION`.

The readiness endpoint reports credentials only as **configured** or **missing**.
It never returns a secret. Verified by reading `describeDhaConfig()` and the
response assembly.

### 2.2 Reliability features

| Feature | Present? |
|---|---|
| Timeout | Yes (`DHA_TIMEOUT_MS`, default 15 s) |
| Retry | Yes (`DHA_MAX_RETRIES`, default 2) |
| Structured errors | Yes (`DhaError` with code) |
| Token caching | Yes |
| Idempotency key | **No** |
| Outbound message store | **No** |
| Reconciliation job | **No** |
| Failed-message replay | **No** |

Without an outbound store, a claim that fails at the network boundary is lost
rather than queued. This is the main reason the integration is rated partial.

---

## 3. FHIR

### 3.1 What is implemented

`GET /api/interop/fhir/patient/:id`

- Requires `interop.fhir.patient.read`.
- Returns `application/fhir+json`.
- Builds a `Patient` with identifier, name, gender, birth date and
  `managingOrganization`.
- The read is audited (`accessChannel: 'FHIR'`).

### 3.2 What is not

| Resource | Status |
|---|---|
| Patient | Partial — read only, no `$everything`, no search |
| Practitioner | Missing |
| Organization | Missing |
| Encounter | Missing |
| Condition | Missing |
| Observation | Missing |
| MedicationRequest | Missing |
| MedicationDispense | Missing |
| ServiceRequest | Missing |
| DiagnosticReport | Missing |
| AllergyIntolerance | Missing — and there is no allergy data to map |
| Procedure | Missing |

**No FHIR validator was run.** The resource was never submitted to a validator,
so even the Patient resource's conformance is unproven. The UI does not claim
conformance.

---

## 4. Terminology

| Domain | Current representation | Standard mapping |
|---|---|---|
| Diagnoses | Free-text ICD-10 code strings | No validation, no KNHTS |
| Medicines | Facility medication catalogue (name, form, strength) | No ATC or KNHTS |
| Laboratory | Facility test catalogue, tariff codes | No LOINC |
| Procedures | Free text + tariff codes | No standard code system |
| Units | Free text | No UCUM |
| Public health conditions | Six hard-coded ICD-10 codes in the surveillance screen | Small, correct, but not a terminology service |

The DHA terminology service (KNHTS) and its release files are **not present**.
No codes were generated or inferred to fill the gap.

**Dependency:** official KNHTS release files and the DHA terminology endpoint.

---

## 5. SDMX and other exchange formats

No supplied requirement names SDMX for this deployment. It is recorded as
**NOT_APPLICABLE** in the register rather than implemented to raise a score. If
the certification scope names SDMX, this decision must be revisited.

---

## 6. Integration matrix

| Integration | Specification | Implementation | Test evidence | Status |
|---|---|---|---|---|
| DHA token | Published OAuth2 client credentials | Complete | Fixture tests (`test:dha`, 176 assertions) | Mock-verified only |
| DHA eligibility | Published reference (6 operations) | Complete | Fixture tests | Mock-verified only |
| DHA claims / consent | Partly published | Not implemented | — | Blocked on contract + OTP |
| FHIR Patient | HL7 FHIR R4 (assumed) | Read-only | None | Untested |
| FHIR clinical resources | HL7 FHIR R4 | None | — | Missing |
| KNHTS terminology | Not supplied | None | — | Blocked on data |
| KHIS / DHIS2 reporting | Not supplied | None | — | Missing |
| SDMX | Not required | None | — | Not applicable |
| Patient-initiated sharing (portal, 2026-10-22) | **No external specification** | Grants name a recipient, a scope and an expiry, and are revocable; the recipient is a clinician the patient identifies, not a registry lookup | 178-assertion portal suite, policy only | **Not an HIE integration** — no message leaves the facility, and the UI says so |

The last row is here to stop a predictable misreading. "The patient can share their
record" is not the same as "the record interoperates with the national exchange".
No `Patient`, `Encounter` or document is transmitted anywhere, no registry is
queried, and nothing in the portal can satisfy an interoperability requirement.

---

## 7. What must happen before a certification review

1. Obtain **sandbox credentials** (client id, secret, facility registry code) and
   record one successful token exchange. Only then can `IO-01` move from
   IMPLEMENTED_UNTESTED to VERIFIED.
2. Capture the missing claim contracts from the published reference — not from
   memory, and not by guessing.
3. Implement an outbound message store with idempotency and replay before any
   production claim submission.
4. Add at least `Encounter`, `Condition`, `Observation` and `DiagnosticReport` to
   the FHIR surface, and run them through a validator.
5. Obtain KNHTS release files and map the diagnosis and medicine catalogues.

---

## 8. Honesty controls added in this audit

- The compliance panel (`DhaCompliancePanel.tsx`) shows interoperability at
  42.9% with **0 verified**, and lists the blocked items by name.
- The existing DHA readiness panel already refused to publish a score; it now sits
  beneath the self-assessment, so the two cannot contradict each other.
- No mock response is rendered without a **MOCK** badge.
