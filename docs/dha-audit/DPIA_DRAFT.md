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
| R1 | Cross-facility exposure through an unprotected API route | **Was high** — confirmed on six routes | Severe | Permissions and scope added across three rounds; `/api/departments` was the last unscoped read found and is now tenant-scoped. No exhaustive pass over id-addressed routes | **Medium — open** |
| R2 | Record filed against the wrong facility | Was high (six screens defaulted to facility 1) | High | Guard added; server ignores client-supplied facility on the fixed routes | Low |
| R3 | Unauthorised access by a compromised staff account | Medium | Severe | argon2, 8-hour sessions, lockout, rate limiting | Medium — no MFA |
| R4 | Insider alteration of the audit trail | Low | Severe | No application route exists; append-only triggers and a `REVOKE` are written in migration 0017 but **not applied** | **High until 0017 is applied** |
| R5 | Loss of data through failed hardware | Medium | Severe | **No backup exists** | **Critical** |
| R6 | Disclosure through an unencrypted database volume | Medium | Severe | National ID and SHA number sealed by the application (AES-256-GCM); volume, snapshots and backups still unencrypted; names, phones and dates of birth still plaintext | **Critical — hosting control outstanding** |
| R7 | Consent not demonstrable | Was high | High | Consent capture with purpose, method, scope, expiry and revocation, visible on the patient record; not yet enforced on sharing | **Medium — enforcement outstanding** |
| R8 | Patient harmed by prescribing without allergy data | Was medium | Severe | Structured allergy registry; a match blocks the prescription until acknowledged, and the override is audited. No interaction engine | **Medium — name matching only** |
| R9 | Over-broad platform-administrator access | Medium | High | Role-scoped, audited | Medium — needs a policy decision |
| R10 | Data sent to DHA unintentionally | Low | Severe | Production switch off by default; mock clearly labelled | Low |
| R11 | Someone other than the patient reaches the portal account (2026-10-22) | Medium | Severe | Single-use invitation bound to the existing patient row, delivered to the contact already on file; 12-character minimum; 2-hour session; lock after five failures; activation is not granted by a successful SMS | **Medium — no second factor, no verified contact channel** |
| R12 | Portal account used to read another patient's record | Low | Severe | Reads are keyed to the session's `patient_id`, never to a request parameter; facility union scope; 404 for accounts outside the caller's facility | Low |
| R13 | Patient-initiated sharing exposes the record to the wrong clinician | Medium | High | Sharing requires the patient to enter the recipient's registration details, is time-limited and revocable, and is **not** national HIE integration; each grant is audited | Medium |
| R14 | QR card scanned by a stranger reveals clinical data | Low | High | The symbol contains one opaque random code and nothing else; scanning grants no access; lookup requires a signed-in staff session and is audited | Low |

---

## 6. Measures required before approval

| Measure | Owner | Reference |
|---|---|---|
| Complete the authorisation audit | Engineering | P1-1 |
| Encrypt database and backups at rest | Operations | P1-4 |
| Implement and test backups | Operations | P1-5 |
| Make the audit log append-only | DBA | P1-6 |
| Build consent capture | Engineering + clinical | P1-7 — **built; enforcement in P2-9** |
| Build allergy recording | Engineering + clinical | P1-8 — **built; interaction data in P2-10** |
| Define retention and deletion | Organisation | §4 |
| Decide the legal basis | Organisation / DPO | §4 |
| Add MFA for privileged accounts | Engineering | P2-7 |
| Define hosting location and cross-border position | Organisation | §3.3 |
| Decide how patients are told what the portal does, and obtain a lawful basis for patient-initiated access | Organisation / DPO | §7.3 |

---

## 7. Patient portal — scope added 2026-10-22

This section exists because the portal is new processing, not a new screen on old
processing. It was written by engineering from the code and **does not discharge
the DPIA**; §4, §8 and §9 remain outstanding.

### 7.1 What is processed

| Element | Detail |
|---|---|
| Identity | Mobile number or patient number, password hash (argon2id), display name, last sign-in, lock state |
| Session | Opaque token, stored only as SHA-256, 2-hour expiry, separate from staff sessions |
| Invitation | Single-use token (hashed at rest), delivery channel, expiry, and an event log of issue/redeem/revoke |
| Record projection | The patient's own visits, laboratory results, medications, appointments, discharge summaries — read from the existing tables, nothing copied into a second store |
| Access history | Who read the record and when, from `patient_record_access_logs`, shown back to the patient |
| Sharing grants | Recipient details entered by the patient, scope, expiry, revocation, and an audit row per action |
| Card | Opaque code (SHA-256 lookup key plus sealed copy) and a server-rendered SVG |

### 7.2 What is deliberately not processed

No second clinical record. No portal-side editing of clinical data: a correction
becomes a request routed to staff, never a write. No national ID, diagnosis or
result inside the QR symbol. No public link to a medical record. No guardianship
account — a guardian must be their own patient identity with verified authority,
which the portal does **not** currently implement.

### 7.3 Questions the organisation must answer before the portal is enabled

1. On what lawful basis is a patient given direct access to their own record, and
   does that differ from the basis for treatment?
2. How is the contact number on file verified before an invitation is sent, and who
   is accountable when it is wrong?
3. What is the position on minors and on patients without capacity — at what age,
   and with what evidence of guardianship?
4. Is patient-initiated sharing a disclosure by the facility or by the patient, and
   does it need a separate consent record?
5. How long are portal accounts, sessions, invitations and access history retained
   after a patient stops using the portal?
6. What happens to the portal account when the patient dies, or when the record is
   subject to a legal hold?
7. Does the facility's data-protection notice mention the portal, the card and the
   access history?

**Status: UNANSWERED. The portal is disabled by policy in the sense that no
migration has been applied and no account can exist yet. It must not be enabled for
real patients until §7.3 is answered and this DPIA is signed.**

---

## 8. Consultation

| Party | Consulted? | Date | Outcome |
|---|---|---|---|
| Data protection officer | ☐ | | |
| Clinical leadership | ☐ | | |
| Facility administration | ☐ | | |
| Patients or their representatives | ☐ | | **[TO BE COMPLETED]** — whether consultation is required |

---

## 9. Decision

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
