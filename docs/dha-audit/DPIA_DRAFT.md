# Data Protection Impact Assessment — DRAFT

> **STATUS: DRAFT — NOT REVIEWED, NOT APPROVED, NOT SIGNED.**
>
> This document was assembled from verified facts about the Jalicare HMIS source
> code on 21 October 2026. It contains no legal opinion. Sections marked **[TO BE
> COMPLETED]** require a decision by the responsible organisation or its data
> protection officer, and must not be filled in by an engineer guessing.
>
> Preparing a draft does not satisfy the DPIA obligation under the Data Protection
> Act, 2019. The assessment is complete only when the responsible officer has
> reviewed, signed and dated it.

---

## 1. Identification

| Field | Value |
|---|---|
| System | Jalicare HMIS |
| Version / commit | Branch `arena/14785aa5-afyahub-hmis-kenya`, commits up to and including the audit commit |
| Responsible entity (controller) | **[TO BE COMPLETED]** — not stated anywhere in the repository |
| Processor(s) | **[TO BE COMPLETED]** — hosting provider, support provider |
| DPO / responsible officer | **[TO BE COMPLETED]** |
| DPIA reference | **[TO BE COMPLETED]** |
| Date of draft | 21 October 2026 |
| Reviewed | ☐ No |

---

## 2. Why a DPIA is required

Jalicare processes **personal health data**, which the Act treats as sensitive
personal data. The processing includes:

- recording diagnoses, prescriptions, laboratory results, maternity records and
  immunisation status;
- transferring eligibility queries to DHA when the integration is enabled;
- retaining records across encounters for the patient's lifetime.

Sensitive data at this scale, with an external health-information exchange in
scope, meets the threshold for a DPIA.

---

## 3. Description of processing (verified from the code)

### 3.1 Data subjects

| Category | Evidence |
|---|---|
| Patients, including children and newborns | `patients`, `pregnancies`, `deliveries`, `immunisations` |
| Guardians / next of kin | `patients.guardian_*`, `emergency_contact_*` |
| Staff and practitioners | `users`, `practitioners`, `staff_invitations`, `professional_verifications` |
| Facility administrators | `users`, `user_roles` |

### 3.2 Categories of personal data

| Category | Fields (actual column names) |
|---|---|
| Identity | `first_name`, `middle_name`, `last_name`, `date_of_birth`, `gender`, `national_id`, `mrn` |
| Contact | `phone`, `email`, `residential_address`, `county`, `sub_county` |
| Insurance | `sha_number`, `dha_client_registry_id`, `dha_eligibility_status`, `dha_eligibility_schemes` |
| Next of kin | `guardian_name`, `guardian_relationship`, `guardian_phone`, `emergency_contact_*` |
| Clinical | encounters, observations, diagnoses, prescriptions, dispensations, lab orders and results, radiology, admissions, nursing notes, maternity, immunisation |
| Financial | invoices, items, payments, claims, tariffs |
| Professional | practitioner registration numbers, regulator, verification status |
| Technical | sessions, IP address, user agent, login attempts, audit log entries |

### 3.3 Storage and location

| Item | Finding |
|---|---|
| Primary store | PostgreSQL, schema in `src/db/schema.ts` (75 tables) |
| Encryption at rest | **Not configured** — see `SECURITY_PRIVACY_GAP_REGISTER.md` §3.4 |
| Backups | **No mechanism exists** |
| Hosting location | **[TO BE COMPLETED]** — whether data leaves Kenya is unknown |
| Retention | **Not defined** — no policy, no automated deletion |

### 3.4 Data flows

| Flow | Status |
|---|---|
| Browser → Jalicare API | HTTPS **if** TLS is terminated by the deployment; the app serves no TLS itself |
| API → PostgreSQL | TLS configurable (`SQL_SSL`), **off by default** |
| Jalicare → DHA (eligibility, benefits) | **Disabled.** Mock mode by default; production requires an explicit opt-in and credentials that are not present |
| Jalicare → national reporting (KHIS/DHIS2) | **Does not exist** |
| Jalicare → email/SMS | **Does not exist** — no mail or SMS transport in the code |
| Export | `health_record_exports` table exists; no patient-facing export route was found |

### 3.5 Recipients

- Facility staff according to role permissions (`role_permissions`).
- Platform administrators, who can see facilities and audit logs across tenants.
- DHA, **only when enabled** and only for the configured operations.

### 3.6 Automated decision-making

None. No profiling, scoring or automated clinical decision exists in the code.
Clinical decision support is not implemented.

---

## 4. Necessity and proportionality — **[TO BE COMPLETED]**

The organisation must answer, in writing:

1. Is each data category necessary for care, billing or a statutory return?
2. Can any field be removed, masked or aggregated?
3. How long is each category retained, and why?
4. What is the legal basis for processing — consent, contract, legal obligation,
   vital interests, or public interest?
5. Are children's records handled with the additional care the Act requires?

**An engineer cannot answer these.** The code shows what *can* be stored; it does
not show what *should* be.

---

## 5. Risks to data subjects

| # | Risk | Likelihood | Impact | Existing controls | Residual |
|---|---|---|---|---|---|
| R1 | Cross-facility exposure through an unprotected API route | **Was high** — confirmed on six routes | Severe | Permissions and scope added; five routes and 33 id-routes still unaudited | **Medium — open** |
| R2 | Record filed against the wrong facility | Was high (six screens defaulted to facility 1) | High | Guard added; server ignores client-supplied facility on the fixed routes | Low |
| R3 | Unauthorised access by a compromised staff account | Medium | Severe | argon2, 8-hour sessions, lockout, rate limiting | Medium — no MFA |
| R4 | Insider alteration of the audit trail | Low | Severe | No application route to edit audit rows | **High — no database restriction** |
| R5 | Loss of data through failed hardware | Medium | Severe | **No backup exists** | **Critical** |
| R6 | Disclosure through an unencrypted database volume | Medium | Severe | **No encryption at rest** | **Critical** |
| R7 | Consent not demonstrable | High | High | **No consent capture** | **Critical** |
| R8 | Patient harmed by prescribing without allergy data | Medium | Severe | **No allergy record** | **Critical** |
| R9 | Over-broad platform-administrator access | Medium | High | Role-scoped, audited | Medium — needs a policy decision |
| R10 | Data sent to DHA unintentionally | Low | Severe | Production switch off by default; mock clearly labelled | Low |

---

## 6. Measures required before approval

| Measure | Owner | Reference |
|---|---|---|
| Complete the authorisation audit | Engineering | P1-1 |
| Encrypt database and backups at rest | Operations | P1-4 |
| Implement and test backups | Operations | P1-5 |
| Make the audit log append-only | DBA | P1-6 |
| Build consent capture | Engineering + clinical | P1-7 |
| Build allergy recording | Engineering + clinical | P1-8 |
| Define retention and deletion | Organisation | §4 |
| Decide the legal basis | Organisation / DPO | §4 |
| Add MFA for privileged accounts | Engineering | P2-7 |
| Define hosting location and cross-border position | Organisation | §3.3 |

---

## 7. Consultation

| Party | Consulted? | Date | Outcome |
|---|---|---|---|
| Data protection officer | ☐ | | |
| Clinical leadership | ☐ | | |
| Facility administration | ☐ | | |
| Patients or their representatives | ☐ | | **[TO BE COMPLETED]** — whether consultation is required |

---

## 8. Decision

| Field | Value |
|---|---|
| Risk accepted? | ☐ No ☐ Yes, with conditions |
| Conditions | **[TO BE COMPLETED]** |
| Approved by | ______________________ |
| Role | ______________________ |
| Signature | ______________________ |
| Date | ______________________ |
| Review date | ______________________ |

**Until this table is completed, the DPIA does not exist for compliance purposes,
and the Jalicare readiness assessment records it as BLOCKED.**
