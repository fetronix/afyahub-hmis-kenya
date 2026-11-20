# Authentication and authorisation

| Field | Value |
| --- | --- |
| Document | AUTHENTICATION_AND_AUTHORISATION |
| Version | 1.0 |
| Last reviewed | 2026-11-18 |
| Applies to | Syrona Medical Center HMIS 0.1.0, commit `9d7274c` |
| Audience | Engineers, security reviewers, administrators |
| Status | Verified against `src/auth/`, `src/portal/`, `src/utils/password.ts` and the API inventory |

## Two identities, two systems

| | Staff | Patient portal |
| --- | --- | --- |
| Credential | Username + password | Portal account + password (invitation activation) |
| Token | 48 random bytes, base64url | Portal token, separate format and table |
| Storage | `sessions` (SHA-256 hash of the token) | `patient_portal_sessions` |
| Transport | `Authorization: Bearer <token>` | `Authorization: Bearer <token>` on portal routes |
| Lifetime | 8 hours | 2 hours |
| Middleware | `requireAuth` | `requirePortalAuth` |

The two systems share no session table, no middleware and no user object. A portal token presented to
a staff route fails, because `requireAuth` looks only in `sessions`; a staff token presented to a
portal route fails for the same reason.

## Login

1. `POST /api/auth/login` accepts a username and password. Passwords are verified with argon2id
   (`memoryCost` 64 MiB, `timeCost` 3, `parallelism` 4).
2. Failures increment a counter on the user row. At **5** consecutive failures the account is locked
   for **15 minutes**; a successful login clears the counter.
3. On success a session token is generated, only its SHA-256 hash is stored, and the plain token is
   returned to the client.
4. The client stores the token under `syrona_session_token` in `localStorage` (or in memory when
   storage is unavailable) and sends it as a Bearer token.

`login_attempts` records attempts for operational review. The `/api/auth` route family also has an
IP-level limiter of 10 failed attempts per 15 minutes, counted only for failures.

## Session lifecycle

| Event | Behaviour |
| --- | --- |
| Issue | Row in `sessions` with `expires_at = now + 8h`, `security_version` copied from the user |
| Use | `requireAuth` hashes the presented token, finds a non-revoked, unexpired row, and loads the user and authorisation context |
| Expiry | Rejected after `expires_at`; the client receives `401` and returns to login |
| Logout | `POST /api/auth/logout` revokes the session row |
| Password change | Increments the user's `security_version`, invalidating sessions issued under the old version |
| Revocation | Sessions can be revoked administratively; `auth.sessions.revoke` exists in the catalogue |

## Authorisation model

Authorisation is a conjunction of four checks, in this order:

1. **Authentication** — a valid session (or portal session).
2. **Tenant and facility context** — from the session, never from the request body.
3. **Facility module** — `requireFacilityModule(code)` reads `facilities.enabled_modules`.
4. **Permission** — `requirePermission(...)` requires *all* listed codes;
   `requireAnyPermission(...)` requires at least one; `requireSuperAdmin()` and `requireRole(...)`
   check roles.

A permission allows an action; it never grants scope. The scope check (`resolveFacilityScope`)
decides which facility rows the action may touch:

- A facility user's requested facility must equal their own, or the request is `403 FACILITY_ACCESS_DENIED`.
- A superadmin must name a target facility for facility-scoped operations, or receives `403 FACILITY_REQUIRED`.

`SUPER_ADMIN` holds every catalogue permission except the facility-owned delegations; in addition,
`hasPermission` returns `false` for facility financial permissions when the caller is a superadmin,
so platform administration cannot be used to move facility money.

## Invitations

| Invitation | Flow |
| --- | --- |
| Staff invitation | A facility administrator creates an invitation; the recipient opens `/accept-staff-invitation`, validates the token (`GET /api/auth/staff-invitations/validate`) and accepts it (`POST /api/auth/staff-invitations/accept`), setting a password and receiving a role. |
| Facility administrator invitation | Created by a platform administrator; accepted at `/accept-facility-admin-invitation` through `/api/auth/facility-admin-invitations/*`. |

Invitation tokens are single-use, expiring records in `user_invitations` and
`facility_admin_invitations`, with events recorded for issue, revoke, reissue, validate and accept.
Both validation endpoints are public by design; acceptance is rate-limited.

## Portal authentication

- Accounts are created by staff (`/api/portal/admin/accounts`) or by invitation
  (`patient_portal_invitations`), and activate through `/portal/activate`.
- Portal sessions last **2 hours** (`PATIENT_SESSION_HOURS` in `src/portal/portal-policy.ts`).
- The portal policy controls what a patient may see: released documents only, no staff notes, no
  other patients, and access history recorded in `patient_record_access_logs` and document events.
- Portal activation and login are rate-limited through the shared `/api/auth` limiter; the portal
  service records attempts, but the 5-attempt/15-minute account lockout described for staff applies
  to the staff login service (`src/auth/login.service.ts`).

## Password handling

- Hashing: argon2id with the parameters above; verification uses `argon2.verify`.
- Length policy: 12–128 characters, enforced by `acceptInvitationBodySchema` when an invitation is
  accepted and by the login schema, so an account cannot authenticate with a shorter password.
  There is no composition rule (upper case, symbol, digit) and no breached-password check.
- Reset: the `password_resets` table exists, but **no route or service currently serves a
  self-service password reset**. Recovery is an administrative action. Treat any claim of an
  email-based reset as unimplemented until a route exists.
- Change: a password change increments `security_version`, which invalidates sessions issued
  earlier.

## Evidence

- `/api/auth/session` returns the authenticated user, roles, permissions, facility and enabled
  modules; it is behind `requireAuth`.
- The API inventory lists the exact guard chain for every route:
  [API_REFERENCE.md](API_REFERENCE.md).
- Role-to-permission defaults: [PERMISSIONS_MATRIX.md](../05-administration/PERMISSIONS_MATRIX.md).

## Limitations

- Tokens live in `localStorage`, which is readable by any script running on the origin. A strict
  Content-Security-Policy and a trustworthy dependency supply chain are therefore load-bearing; see
  [VULNERABILITY_AND_LIMITATIONS.md](../10-security-and-governance/VULNERABILITY_AND_LIMITATIONS.md).
- There is no multi-factor authentication, no SSO and no device management.
- The `sessions` table grows with every login; expired rows are not pruned automatically and no
  pruning command was found in `scripts/`, so housekeeping is a manual SQL task.
- There is no password reset self-service flow (see above).
- Password reset delivery is not built in.

## Related documents

- [Access control](../10-security-and-governance/ACCESS_CONTROL.md)
- [Session and password policy](../10-security-and-governance/SESSION_AND_PASSWORD_POLICY.md)
- [Multitenancy architecture](MULTITENANCY_ARCHITECTURE.md)
- [Permissions matrix](../05-administration/PERMISSIONS_MATRIX.md)
