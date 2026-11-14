# Operations runbook

**Scope:** how to tell whether this installation is working, what to do when it
is not, and what this document is _not_ evidence of.

**Last verified against the code on 2026-10-27** by running the checks below in
this repository. Nothing in this file has been exercised on a production host,
because no production host was available. Items that need a real deployment are
marked **HOST ACTION**.

---

## 1. What is implemented, and what is only configured

| Capability                | State                                                                     | Evidence                                           |
| ------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Liveness endpoint         | Implemented, public, always `200`                                         | `src/routes/system.routes.ts`, `GET /api/health`   |
| Readiness endpoint        | Implemented, public, `200`/`503`, 2 s cache                               | `GET /api/ready`                                   |
| Operations status         | Implemented, authenticated (`audit.read`), aggregate counters only        | `src/operations/operations-status.service.ts`, §3  |
| Structured logging        | Implemented, redacts credentials and patient identity by default          | `src/logging/logger.ts`                            |
| Graceful shutdown         | Implemented for `SIGINT`, `SIGTERM`, uncaught errors, 10 s cap            | `server.ts`                                        |
| Rate limiting             | Implemented, per IP; needs `TRUST_PROXY=true` behind a proxy              | `src/middleware/http-security.middleware.ts`       |
| Security headers / CORS   | Implemented, allowlist-based                                              | same file                                          |
| Backup + verified restore | Implemented and drilled **on a synthetic database only**                  | `scripts/backup/*.mjs`, `npm run db:restore:drill` |
| Alert delivery            | **Not implemented.** Nothing pages anyone.                                | —                                                  |
| Log shipping / retention  | **Not implemented.** Logs go to the process output.                       | —                                                  |
| Container definition      | `Dockerfile` + `docker-compose.yml` exist; HEALTHCHECK calls `/api/ready` | not built or run in this environment               |
| Metrics scraping          | **Not implemented.** No Prometheus/OpenMetrics endpoint exists.           | —                                                  |

If any row above says "not implemented", no dashboard, deployment guide or
sales conversation should imply otherwise.

---

## 2. The three probes

```bash
curl -sS http://HOST:PORT/api/health   # is the process alive?
curl -sS -i http://HOST:PORT/api/ready # can this instance serve traffic?
```

- **`/api/health`** answers `200` whenever the process can write a response. It
  exists so an orchestrator restarts a wedged process. It says nothing about the
  database.
- **`/api/ready`** answers `200` only when a trivial query succeeds, and `503`
  otherwise. It exists so a proxy stops sending traffic to an instance that has
  lost its database. The database error itself is written to the log and never
  to the response, because the endpoint is public and the message names a host
  and sometimes a user. Results are cached for two seconds; uncached, the probe
  becomes the busiest query in the system and causes the outage it is meant to
  detect.
- `/api/ready` also reports `schema.expectedMigrations` (the packaged journal)
  next to the fact that it does **not** know how many migrations the database
  has applied. Run `npm run db:status` for that comparison. A pending migration
  is an alert, not a reason to refuse traffic: refusing traffic turns a
  maintenance task into an outage for a hospital that is still being paid and
  still treating patients.

## 3. Operations status (`GET /api/ops/status`)

Authenticated, facility-scoped, requires `audit.read`. It returns **counts and
ages only** — no patient, staff, amount or free-text field, because a monitoring
endpoint that leaks one patient name into a log aggregator is a breach with a
dashboard.

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "http://HOST:PORT/api/ops/status?facilityId=12"
```

Reported work queues:

| Queue                            | Meaning                                                          | How it is cleared                                                             |
| -------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `claimDispatchReviews`           | Claims held by a dispatch reservation (an unknown payer outcome) | Review the payer record in the claim screen and record what it shows (§4)     |
| `unbilledCharges`                | Charges the billing engine could not price                       | Fix the tariff, then retry the charge; void with a reason if it must not bill |
| `refundRequestsAwaitingDecision` | Refund requests awaiting a second approver                       | A second approver decides; the requester cannot approve their own             |

It also returns `integration` (diagnostics recorded in the last 24 hours,
grouped by operation and outcome, with a failure count limited to the listed
failure outcomes) and `schema` (journal count versus applied count, and whether
they match).

**It invents no thresholds.** Nothing is labelled "critical" or "degraded" by an
age this file would have to make up. Read the numbers and decide with the
facility.

## 4. A claim whose dispatch outcome is unknown

This is the failure that matters most in practice: the request was sent, the
response was lost, and the database does not know whether the payer has the
claim.

1. `GET /api/ops/status` → `workQueues.claimDispatchReviews.count > 0`.
2. Open the claim in the SHA eClaims or private insurance tracking screen. The
   dispatch review panel appears with the reservation state, attempt number and
   correlation id.
3. **Check the payer's own record by whatever channel the facility actually
   has** — portal, batch report, telephone reference. Nothing in this software
   can do that for you, and no code in this repository contacts a payer to find
   out.
4. Record the finding:
   - _received_ → requires the payer-side reference; the claim becomes
     `ACKNOWLEDGED` with that reference;
   - _not received_ → the claim keeps its status and the block is released so a
     human may dispatch it again;
   - _still unresolved_ → the check is recorded and the claim **stays blocked**.

Every finding is permanent, audited, and written in the same transaction that
releases the reservation. Do not work around the block by editing the database:
the reservation is the only thing preventing a double submission to a payer.

## 5. When something is wrong

| Symptom                                          | First check                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `/api/ready` returns 503                         | Database reachable? `pg_isready`/connection limits. Detail is in the log, not the response.                  |
| Readiness flaps                                  | Is the probe interval shorter than the 2 s cache? Two probes per second is plenty.                           |
| Everything is 429                                | `TRUST_PROXY=true` behind a proxy, or the limiter sees the proxy's IP and one client locks out the facility. |
| Browser blocks every API call                    | `APP_BASE_URL` / `CORS_ALLOWED_ORIGINS` must list the site's own origin.                                     |
| Process exits on deploy                          | Port already in use, or `PORT` unset — both are logged explicitly before exit.                               |
| Claim screen shows "dispatch outcome unresolved" | §4.                                                                                                          |
| Integration failures climbing                    | `integration.byOperation` in §3; the adapter's own readiness/config screen says what is missing.             |

## 6. Restart and shutdown

`server.ts` handles `SIGINT` and `SIGTERM`, closes the HTTP server, runs any
registered `closeResources`, then ends the pool, capped at 10 seconds. An
unhandled rejection or uncaught exception is logged and then triggers the same
shutdown, so a supervisor restarts a clean process instead of leaving one
answering requests it can no longer complete.

**HOST ACTION:** confirm the process supervisor (cPanel/Passenger, systemd,
Docker) sends `SIGTERM` and waits at least 10 seconds before `SIGKILL`.

## 7. Backup and restore

- `npm run db:backup` writes an archive; `npm run db:backup:verify` checks it.
- `npm run db:restore:drill` restores into an isolated database and compares
  contents. It has **passed in this repository** against a synthetic database.
- The logical engine is proven here. The `pg_dump` engine is **not** proven in
  this sandbox because the client tools are absent.
- **HOST ACTION:** run the drill on the real host, record the output, copy
  archives off the database host, and schedule both commands. Until that is
  done, "we have backups" is a claim about script existence, not about recovery.

## 8. What this runbook does not claim

- No alerting exists. Someone has to look at §3 or the probes.
- No log retention, rotation or shipping is configured by this repository.
- No metrics endpoint exists; do not point a scraper at `/api/ready` and call it
  monitoring.
- `Dockerfile` and `docker-compose.yml` exist and their HEALTHCHECK points at
  `/api/ready`, but **no image was built or run in this environment**, so their
  correctness is untested here. A compose file is not a deployed system.
- None of this has been exercised on a production host, and no facility has
  accepted it.
