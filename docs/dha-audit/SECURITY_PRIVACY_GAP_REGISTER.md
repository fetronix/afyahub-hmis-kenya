# Security and Privacy Gap Register

**Audit date:** 21 October 2026 · **Commit:** `9d504b3` + this branch
**Scope:** the Jalicare HMIS repository and its documented deployment.

Each row separates three things that are often conflated:

- **technical controls** — in the code and verifiable here;
- **deployment controls** — real, but owned by whoever runs the server;
- **organisational evidence** — certificates, assessments and signatures that no
  repository can contain.

A green tick in the product is not evidence for the third column.

---

## 1. ODPC registration (legal/organisational)

| Question | Answer |
|---|---|
| Is a registration recorded in the repository? | **No.** No certificate, number, entity name or ODPC reference exists in any file. |
| Who is the responsible entity? | **Unknown from the code.** The product is "JaliCare"; the operating entity must be named by the organisation, not inferred from a repository. |
| Controller or processor? | Depends on the deployment: a facility running its own installation is the controller; a vendor hosting it on their behalf is a processor. Both may need registration for the roles they hold. |
| What evidence is required? | ODPC registration certificate for the responsible entity, naming the role (controller / processor), plus the registration number and date. |
| Status | **BLOCKED — external.** |

Nothing in this repository was fabricated to fill this gap.

### What the organisation must do

1. Identify the legal entity that determines the purpose of processing.
2. Register (or confirm existing registration) with the Office of the Data
   Protection Commissioner.
3. Record the certificate number and entity in the deployment documentation
   **outside** this repository if it contains personal data.
4. Tell the audit owner which role each party holds.

---

## 2. DPIA (organisational, informed by this code)

**Status: BLOCKED — no DPIA exists.** A populated draft is delivered as
`DPIA_DRAFT.md`. It is not reviewed, not approved and not signed.

| DPIA section | Ready? | Blocker |
|---|---|---|
| Processing purposes | Yes — from the code | Requires confirmation of intended use |
| Data categories | Yes — from the schema | — |
| Data subject categories | Yes — from the schema | — |
| Data flows and integrations | Partly | DHA production flows are not enabled; hosting topology unknown |
| Legal basis | **No** | A legal decision, not a technical one |
| Necessity and proportionality | **No** | Requires clinical and legal review |
| Risks and mitigations | Partly | Technical mitigations listed; residual risk acceptance needs an owner |
| Sign-off | **No** | Responsible officer |

---

## 3. Technical control audit

### 3.1 Authentication

| Control | Finding | Evidence |
|---|---|---|
| Password hashing | **argon2** (memory-hard), not a general-purpose hash | `src/utils/password.ts`, used by `auth.service`, `login.service`, invitations |
| Password policy | Enforced at registration and acceptance | `src/auth/auth.validation.ts` |
| Session token | 48 random bytes, base64url, stored only as SHA-256 | `src/auth/session.service.ts` |
| Session lifetime | 8 hours, `expires_at` indexed | same |
| Revocation | `security_version` bump invalidates live sessions; deactivation bumps it | `staff-roles.service.ts` |
| Lockout | `failed_login_attempts` + `locked_until` | `auth.service.ts:174-298` |
| Rate limiting | 15-minute window on `/api/auth`, 60-second window on `/api` | `http-security.middleware.ts:168-209` |
| Multi-factor | **Absent** | no TOTP/WebAuthn/SMS anywhere |
| Password reset | **No self-service backend**; the login screen says so instead of pretending | `password-reset.service.ts` is empty |

**Assessment:** authentication is stronger than most systems at this stage.
MFA is the notable gap, and it matters more once DHA credentials exist.

### 3.2 Authorisation and isolation

This is where the audit found the most serious defects.

| Finding | Detail | Status |
|---|---|---|
| Six routes had no permission check | theatre cases (read/write), radiology (read/write/report), suppliers, purchase orders | **Fixed** |
| Reads without a facility returned every facility's rows | `getTheatreCases`, `getRadiologyOrders`, `getPurchaseOrders`, `getSuppliers` | **Fixed** |
| Writes trusted `req.body.facilityId` / `tenantId` | theatre, radiology, purchase orders | **Fixed** — identifiers are overwritten from the session |
| Object-level ownership | theatre `PUT`, radiology report `PUT` updated by id with no check | **Fixed** — scoped readers added |
| Five routes still unguarded | see §3.2.1 | **Open** |
| 33 id-addressed routes unaudited | `Number(req.params.id)` used in 33 places | **Open** |

#### 3.2.1 The remaining unguarded routes

The static scan flagged 20 routes without a visible guard. Fifteen were resolved:
ten already used scoped queries or were mounted behind a router-level guard, and
five were the ones fixed above (the count differs because some routes share a
handler block). The routes that still need review before any deployment are the
ones that take an id and call a query directly. The audit did **not** enumerate
all 33; that is deliberate honesty rather than a claim of completeness.

**Required next action:** for each route using `Number(req.params.id)`, prove that
the row is fetched through a scoped query or that the update includes
`facility_id = <session facility>`. Until then, treat object-level access control
as unproven.

### 3.3 Audit trail

| Property | Finding |
|---|---|
| Table | `audit_logs` with tenant, facility, user, action, resource, resource id, details, severity, timestamp, request id, user agent |
| Write path | `logAuditEvent()` on sensitive writes (facility modules, staff status, roles, claims, DHA calls) |
| Read path | `GET /api/audit-logs` requires `audit.read`, scoped |
| Immutability (application) | No route updates or deletes audit rows |
| Immutability (database) | **None.** No trigger, no `REVOKE UPDATE, DELETE ON audit_logs`. A database user can rewrite history. |
| Record *views* | Patient record reads are **not** logged in `audit_logs`; `patient_record_access_logs` exists in the schema but is not written by the patient read path. |

**Remediation SQL (not executed by this audit — see `DATABASE_MIGRATION_AUDIT.md`):**

```sql
CREATE OR REPLACE FUNCTION deny_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;
```

Apply only after confirming the application never updates the table (it does not)
and after a backup.

### 3.4 Encryption

| Path | Status | Notes |
|---|---|---|
| Browser → server | **Deployment** | The Express app serves no TLS. TLS 1.2+ must terminate in front of it. `helmet` sets HSTS only over HTTPS. |
| Server → PostgreSQL | **Configurable, default off** | `SQL_SSL` + `SQL_SSL_REJECT_UNAUTHORIZED` added in this audit. Previously hard-coded `false`. |
| Database at rest | **Absent** | No volume encryption, TDE or `pgcrypto` usage is configured in the repository. |
| Backups | **Absent** | No backup mechanism, therefore no encrypted backup. |
| Secrets | **Partly** | `.env` and `firebase-applet-config.json` are git-ignored; `.env.example` holds names only; no secret manager or rotation. |

No claim of AES-256 or TLS 1.3 is made anywhere, because neither was configured
where it could be verified.

### 3.5 Application security review (non-destructive)

| Class | Finding |
|---|---|
| SQL injection | Drizzle parameterises every query observed; raw SQL is confined to migrations. No string-concatenated user input found in query paths. |
| XSS | React escapes by default; no `dangerouslySetInnerHTML` found. |
| CSRF | The API authenticates with an `Authorization: Bearer` header, not cookies, so classic CSRF does not apply. No CSRF token is issued, and none is needed while that remains true. |
| IDOR | **Partly unproven** — see §3.2. |
| Input validation | Strong on billing, claims, public health, staff roles and DHA; weaker on older operational writes that accepted `req.body` directly. |
| File upload | No upload endpoint found. |
| Debug endpoints | None found; `/api/health` returns status only. |
| Secrets in logs | Audit logging records action metadata; DHA tokens are excluded from the readiness response. No token logging found. |
| Dependency risk | Not assessed: no audit tool was run (`npm audit` was not executed in this environment). **BLOCKED** |
| Race conditions | Billing and claims use transactions; stock and appointment paths were not stress-tested. **UNVERIFIED** |

---

## 4. Privacy obligations that are software-visible

| Obligation | Status | Where |
|---|---|---|
| Consent capture | **Missing** | `patient_consents` unused |
| Access logging for record views | **Missing** | `patient_record_access_logs` unused |
| Data subject access / export | **Partial** | `health_record_exports` table exists; no export route found for a patient request |
| Retention and deletion | **Missing** | No retention policy, no erasure path |
| Breach notification | **Organisational** | No procedure in the repository |
| Data minimisation in logs | **Good** | Audit records action and ids, not clinical payloads |

---

## 5. Priority order for the organisation

1. **ODPC registration** — legal prerequisite; nothing technical can substitute.
2. **DPIA review and signature** — use `DPIA_DRAFT.md` as the starting point.
3. **Close the remaining authorisation gaps** — five unguarded routes and the
   object-level audit.
4. **Encryption at rest and encrypted backups** — hosting decision, documented in
   `DEPLOYMENT_AND_RECOVERY.md`.
5. **Audit-log immutability** — apply the SQL above, after a backup.
6. **Consent and access logging** — schema exists; build the paths.
7. **MFA** — before DHA production credentials are issued.

---

## 6. What this register does not claim

- It is not a penetration test.
- It does not certify the absence of vulnerabilities.
- It does not replace a legal review of the Data Protection Act, 2019 obligations.
- It does not assert ODPC registration or DPIA approval.
