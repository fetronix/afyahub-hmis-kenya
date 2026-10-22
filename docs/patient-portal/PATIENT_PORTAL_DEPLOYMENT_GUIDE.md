# Patient Portal — Deployment Guide

**Date:** 22 October 2026
**Applies to:** JaliCare HMIS, patient digital health record portal (migration 0018)

---

## 1. Read this before anything else

**This build has never been run against a real database.** Every SQL path in the portal is
type-checked and contract-tested; none has been executed. Nothing in this guide, and nothing in the
portal code, supports a statement that the portal is production-ready.

Before a facility goes live, all of the following must be true:

- [ ] A recent, **verified** backup of the database exists and has been restored once as a drill.
- [ ] Migrations 0017 and 0018 have been applied to a **restored copy**, and the acceptance tests in
      `PATIENT_PORTAL_TEST_RESULTS.md` §5 have been run against it.
- [ ] `FIELD_ENCRYPTION_KEY` is set and the key is held in a secret store, not in the repository.
- [ ] TLS terminates in front of the application, and `trust proxy` is configured for that edge.
- [ ] The facility has decided what its patients are told, in what language, and how a patient who
      cannot use a phone is served.
- [ ] The facility has a written position on retention, on guardian access and on deceased patients.
- [ ] A named person owns the portal audit trail, and a second person can read it.
- [ ] The facility acknowledges that no SMS or email provider is configured, so every invitation is
      a manual handover until one is.

If any box is unticked, run the portal with invitations only and tell the staff exactly that. Do not
tell a patient "we sent you a message" in this build.

---

## 2. What must exist in the environment

| Variable | Purpose | Portal behaviour if missing |
|---|---|---|
| `SQL_HOST`, `SQL_PORT`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD` (or the project's `DATABASE_URL`) | PostgreSQL connection | The server refuses to start (`src/config/env.ts` throws) |
| `SESSION_SECRET`-class secrets | Staff sessions (existing) | Existing behaviour |
| `FIELD_ENCRYPTION_KEY` | AES-256-GCM for sealed identifiers **and** the sealed card code | Values are stored unsealed; national IDs are not encrypted. The readiness panel reports this. **Set it.** |
| `PORTAL_BASE_URL` (or the configured base used by `portalBaseUrl()`) | Builds the activation link | The link points at the wrong origin and handover is broken |

**There are no SMS or email variables to set, because there is no provider.** If the facility has a
provider, the integration goes in `src/notifications/notification-provider.ts`; see §6.

Optional but recommended at the edge:

- `trust proxy` set to the load balancer's address range, so `req.ip` is the patient's address and
  the rate limiter and access log mean something.
- A WAF rule capping request bodies on `/api/portal/*` (the app already caps JSON bodies, but two
  layers are better for a public endpoint).

---

## 3. Deployment steps

```bash
# 0. Freeze: put the facility in read-only mode at the desk, or deploy out of hours.

# 1. Back up and verify.
pg_dump --format=custom --file=jalicare-pre-portal.dump "$DATABASE_URL"
pg_restore --list jalicare-pre-portal.dump | head

# 2. Restore into a scratch database and rehearse there first.
createdb jalicare_rehearsal
pg_restore --dbname=jalicare_rehearsal jalicare-pre-portal.dump
DATABASE_URL="postgresql://…/jalicare_rehearsal" npm run db:status
DATABASE_URL="postgresql://…/jalicare_rehearsal" npm run db:migrate
DATABASE_URL="postgresql://…/jalicare_rehearsal" npm run db:status:all

# 3. Seed the five portal permissions.
DATABASE_URL="postgresql://…/jalicare_rehearsal" npm run db:seed:permissions

# 4. Run the acceptance tests from PATIENT_PORTAL_TEST_RESULTS.md §5 against the rehearsal DB.

# 5. Build and deploy the application.
npm ci
npm run lint
npm run build
npm test

# 6. Apply to the target, then restart the server.
DATABASE_URL="$DATABASE_URL" npm run db:migrate
```

> The agent that wrote this did **not** run any of the above, and must not. Migrations are executed
> by the deployment owner, against a backed-up database, with a person watching.

### After the migration, confirm

```sql
SELECT table_name FROM information_schema.tables
 WHERE table_name LIKE 'patient_portal%' OR table_name = 'patient_record_sharing_grants';
-- expect 6 rows

SELECT indexname FROM pg_indexes
 WHERE tablename LIKE 'patient_portal%';
-- expect the unique indexes from PATIENT_PORTAL_DATABASE_CHANGES.md §2

SELECT tgname FROM pg_trigger WHERE tgname = 'jalicare_audit_is_append_only';
-- expect the append-only trigger from 0017
```

---

## 4. Turning it on for a facility

1. Sign in as a facility administrator.
2. **System Configuration → Modules**: enable **Patient portal management**. This adds the
   navigation entry and lets the server accept the portal module. (The patient API `/api/portal` is
   deliberately not behind a facility module gate: a patient must be able to reach their record even
   if, say, pharmacy is switched off.)
3. **Patient Portal Management → Settings**: confirm the invitation lifetime (default 72 hours) and
   the resend limit (default 3). Leave SMS and email **off** unless a provider has been configured
   and tested; the screen says so.
4. Decide which sections are released. Every switch is per facility, and none of them affects
   laboratory verification: an unverified result is never shown even with `showLabResults` on.
5. Give the receptionist role `portal.invite` if the standard role catalogue has not already done so
   (`RECEPTIONIST` carries it in `staff-role-catalogue.ts`). Do not give reception
   `portal.accounts.manage`, `portal.audit.read` or `portal.settings.manage`.
6. Walk one **synthetic** patient through the whole journey before inviting a real one — see §5.

---

## 5. First-run acceptance walk-through (synthetic data only)

Use a test patient created for this purpose. Never test with a real patient's record.

1. Register the test patient at the desk.
2. The **Portal** button appears on the queue row and after registration.
3. Open it: it should read `Not linked` and offer the channel selector with SMS/email disabled and
   the reason shown.
4. Issue a **manual** invitation. Copy the link.
5. Open the link in a private window. The address bar should become `/portal/activate` with no
   fragment after the page loads.
6. Choose a 12-character password and activate. Expect "Your account is ready" and **no** signed-in
   state.
7. Sign in at `/portal`. Expect the dashboard with whatever the test patient actually has — probably
   nothing. Empty states must say what is missing and why, not show sample data.
8. In **Patient Portal Management → Accounts**, find the account. Suspend it with a reason; the
   patient's next request returns 401 and the session list shows revocation. Reactivate; sign in
   again.
9. Revoke it. Sign-in is now refused. Confirm the reason is in the **Audit** tab.
10. Look up the test patient's card code in **Card lookup**; confirm an access-log row appears.
11. Delete nothing. Leave the test account in place, labelled as a test in its name.

---

## 6. Adding an SMS or email provider later

`src/notifications/notification-provider.ts` defines the seam:

```ts
type DeliveryOutcome =
  | { status: 'SENT'; providerReference?: string }
  | { status: 'FAILED'; reason: string }
  | { status: 'NOT_CONFIGURED'; reason: string };
```

To add a provider:

1. Implement `sendNotification()` for the channel, returning exactly one of those outcomes.
   **Do not** return `SENT` on a queued-but-unconfirmed send; `SENT` means the provider accepted it.
2. Read credentials from the environment; never commit them, never log the message body.
3. Keep clinical detail out of the message. The current template contains the facility name, the
   link and the expiry. Nothing else.
4. Set the environment variables, enable the channel in **Settings**, and send one invitation to a
   number the facility controls.
5. Check `delivery_status` and `last_delivery_error` before telling staff the channel works.
6. Record the processor agreement — the provider is a data processor under the DPA.

Until step 4 succeeds, leave the channel switched off. The UI disables the option when no provider
is configured, and the API records `NOT_CONFIGURED` if it is called anyway.

---

## 7. Operational runbook

| Situation | What to do | What not to do |
|---|---|---|
| Patient lost their invitation slip | **Accounts → Open → (invitation) New link**, hand the new one over. The old one stops working | Do not read an old link back from the database; only hashes are stored |
| Patient says they never got an SMS | Check `delivery_status`. If `NOT_CONFIGURED`, say plainly that no message was sent and hand over a link | Do not say "it was sent" |
| Patient forgot their password | **Force password reset** from the account screen, then issue a **RECOVERY** invitation | Do not read or set a password for them |
| Patient's phone was stolen | **Suspend** with a reason; every session ends immediately. Reactivate after verification | Do not delete the account |
| Wrong person linked to an account | **Revoke**, then investigate with the audit trail; re-invite after identity is established | Do not edit the patient id or merge records |
| Staff member leaves | Remove their staff account (existing flow). Portal administration is a staff permission, so it goes with it | — |
| Suspected disclosure | Read the **Audit** tab and `patient_record_access_logs`; preserve them; follow the facility's breach process | Do not delete audit rows — the database refuses it, and it would be the wrong response anyway |
| Facility closes | Revoke accounts; keep the data according to the retention decision | — |

---

## 8. Backup and restore

The portal adds six tables and no changes to existing ones. The backup strategy that already applies
to `patients`, `encounters` and the audit trail is the one that applies here. Two portal-specific
notes:

1. A restored database brings back **live sessions and unexpired invitations**. If the restore is to
   a different environment, revoke the sessions (`UPDATE patient_portal_sessions SET revoked_at =
   now() WHERE revoked_at IS NULL`) and supersede outstanding invitations before allowing traffic.
2. The sealed card codes and sealed national IDs are only recoverable with the **same**
   `FIELD_ENCRYPTION_KEY`. Back up the key separately from the database; losing it does not corrupt
   the records, but it makes the sealed columns unreadable.

---

## 9. Monitoring that actually matters

| Signal | Why | Threshold suggestion |
|---|---|---|
| `delivery_status = 'NOT_CONFIGURED'` count | Shows staff are trying to use a channel that cannot send | Any rise should be explained by configuration, not ignored |
| `delivery_status = 'FAILED'` rate | Provider or contact-data problem | Investigate above a handful per day |
| Invitations expired without activation | The desk is issuing links that are never used — a process problem, not a code one | Watch the ratio over a month |
| `ACCOUNT_LOCKED` responses | Either forgetful patients or a guessing attack | Correlate with source IPs |
| `REDEEM_REJECTED` events | Old links being tried | Spikes suggest superseded slips in circulation |
| Failed logins per account | Attack signal | 5 in 15 minutes is the code's own threshold |
| 5xx on `/api/portal/*` | A query that has never been run in this environment is now running | Treat the first week as a live test |

The portal emits **no analytics** and loads no third-party script. Keep it that way.

---

## 10. Rollback

1. Stop the server or block `/api/portal` at the edge (the patient API is a single prefix).
2. Restore the pre-migration dump if the schema itself is the problem.
3. Do **not** drop the six tables to "clean up": that destroys every invitation, account, session
   and sharing grant, and there is no export of them.

The staff application is unaffected by turning the portal off. Records are untouched either way —
the portal only ever reads them.

---

## 11. Known blockers before a production claim

| # | Blocker | Owner |
|---|---|---|
| B1 | Migration 0017 and 0018 have never been applied | Deployment owner |
| B2 | No runtime test against PostgreSQL (concurrency, constraints, query correctness) | Engineering |
| B3 | No SMS/email provider; manual handover only | Facility / vendor |
| B4 | No retention schedule, no privacy notice specific to the portal | Facility + legal |
| B5 | Guardian access designed but not implemented; legal questions unanswered | Facility + legal |
| B6 | No penetration test, load test or accessibility audit | Engineering |
| B7 | `FIELD_ENCRYPTION_KEY` must be provisioned and held securely | Deployment owner |
| B8 | `trust proxy` / real-client-IP configuration at the edge | Infrastructure |
| B9 | Deceased-patient handling undecided | Facility |
| B10 | Vitals, vaccination and maternal projections are not in the portal yet | Engineering |

Until B1–B7 are closed, the honest description of this work is: **built, type-checked, contract-tested
and not yet operated.**
