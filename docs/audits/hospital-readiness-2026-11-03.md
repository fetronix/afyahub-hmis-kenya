# Hospital readiness — evidence and outstanding gates

**Status: NOT READY for hospital production.** This record covers synthetic
work only. It is not a deployment authorization, incident closure, clinical
approval, or facility acceptance.

## Database migration evidence

- PostgreSQL 16: the official journal through 0063 was applied to a new,
  isolated synthetic database, representative linked clinical, booking,
  dialysis, finance and audit rows were inserted, and the final guarded 0064
  was applied as the only pending migration. The prior columns and rows in
  20 inspected table sets were unchanged; seven new legacy appointment fields
  remained null. Reapplying 0064 was rejected and rolled back. A separate
  transaction-scoped integration regression exercises preservation, facility
  constraints, immutable events and the partial-object guard.
- This does **not** establish the state of any real database or prove that an
  arbitrary historical dataset is safe. Before release, the authorized database
  owner must compare the real migration ledger and structures, review the
  pending plan and rehearse it against an appropriately protected,
  owner-approved representative copy. Do not alter the migration journal to
  suppress a mismatch, infer history, or run destructive migrations without an
  approved plan and a verified recoverable backup.
- A separate new synthetic database applied all 66 migrations through 0065.
  Historical destructive migration 0002 was run only on new synthetic
  databases; no production migration was executed.

## Regression investigation

The previous complete PostgreSQL 16 run had 1,930 passing tests, 18 failures,
11 skipped tests after one suite setup failed, and no coverage report. The
failures were not all one issue:

- Fourteen failures were in the old master-tariff workflow. The active product
  deliberately uses facility-owned services instead of the retired master
  endpoints and mappings. The synthetic tests now exercise current service
  identity, price and audit behavior, preserve historical master records, and
  verify that old mappings cannot price new care. The affected fixtures also
  needed valid dispense batch/prescription/encounter evidence and an authorized
  inpatient encounter with real bed-rate snapshots; those were not mere HTTP
  404s.
- Two accounting tests and two tariff-validation tests expected retired review
  or import routes. Those routes remain unavailable. Their historical evaluator
  and import safety checks are retained in-process, while current HTTP service
  endpoints are tested for permission, facility isolation and transactional
  audit rollback. The in-process legacy helpers do not themselves authorize a
  caller and are not evidence of an available import feature.
- The clinical catalogue suite's setup called a retired specimen-admin route.
  Seeding reviewed synthetic options through the existing scoped service allowed
  all 11 previously blocked tests to run. Current facility-service orders retain
  explicit individual specimens, and unknown free-text investigations are not
  priced by name. A regression in the legacy test-ID-only path was corrected:
  unreviewed or retired/mismatched specimen evidence remains in care but cannot
  silently be billed. Direct facility-service orders may continue to record the
  clinician's specimen text. No historical records are automatically altered.

Focused results: the 15-test facility/master compatibility suite, eight-test
accounting suite, two-test tariff-validation suite and 11-test clinical suite
passed on synthetic PostgreSQL 16. Six additional focused laboratory, pharmacy,
inpatient and 0064 suites passed 106 tests. A full clean-database coverage run
and the actual Docker bootstrap must be recorded separately below; focused
results do not replace those gates.

The legacy specimen-admin UI and its endpoint remain retired. An existing
legacy test-ID-only order without reviewed specimen evidence may remain
unresolved; there is no claim here that a new authorized historical correction
workflow or facility sign-off exists.

## Security incident — open release blocker

The public repository's reachable history contains four real database dumps,
including personal data and credential material. The current-index path guard
and ignore rules only reduce accidental reintroduction; they do not remove
history, copies, caches or forks. See [DATA-EXPOSURE.md](../security/DATA-EXPOSURE.md)
for the owner-approved containment, account/session remediation, secret
rotation, history-cleanup and notification-assessment requirements. None of
those external actions has been completed or verified here. Do not blindly
rotate the encryption key: retain access to existing encrypted records and use
an approved key-versioning/re-encryption plan.

## Required production cutover and recovery plan

The facility owner, data controller, security lead and authorized operations
team must approve and record all of the following before any production action:

1. Contain the data exposure and verify account, session and credential
   remediation; complete an owner-approved history and external-copy cleanup
   assessment. Keep integrations in mock/disabled mode until individually
   authorized.
2. Obtain passing required CI on the exact release revision, including the
   PostgreSQL coverage ratchet, formatting and **actual** fresh-checkout Docker
   bootstrap. Review the complete remaining clinical, pharmacy, inpatient and
   interoperability work; passing software tests do not confer clinical approval.
3. Identify the exact target, operator, change window, dependencies, current
   migration journal and rollback/recovery decision points. Run read-only
   preflight, status and dry-run checks and resolve every blocking warning.
4. Create a consistent, encrypted, access-controlled pre-change backup outside
   the repository and web/build roots. Restore that actual backup into a newly
   created isolated non-production database, verify database identity, ledger,
   representative scoped clinical/financial/audit data and encryption-key
   availability without logging patient values. Record recovery time and obtain
   owner approval. A nonempty file or `pg_restore --list` alone is not a restore.
5. Rehearse the exact pending migrations on the owner-approved representative
   database and compare unchanged historical values. Stop for partial objects,
   missing evidence, unexpected effects or journal drift; do not mark migrations
   applied by guesswork. Only then may the authorized operator execute the
   approved migration and deployment plan.
6. Verify the real HTTPS hostname, certificate/chain and expiry, HTTP redirect,
   secure cookie/HSTS behavior and correctly scoped trusted-proxy/origin
   configuration. Verify migrations, backups, health, permissions, facility
   isolation, logs, monitoring, recovery access and a controlled synthetic smoke
   workflow. Do not submit real claims, payments or messages as a test.
7. Rehearse and document recovery. Application rollback does not automatically
   reverse database changes. Never test a restore over live data; any production
   restore or failover needs a separate authorized plan, a current backup and
   an explicit decision on possible data loss.

No production host, credentials, backup, change approval, TLS endpoint or
recovery exercise were supplied or accessed in this work.

## Facility acceptance — not performed

Real facility representatives must execute and sign off role-based UAT on an
approved environment, including registration and identity, OPD and specimen
flow, lab completion and selected prices, pharmacy dispensing and partial fills,
actual bed policy/rates and discharge invoices, cashier/receipt and controlled
reversals, appointments/dialysis, tenant isolation, downtime and recovery.
External payer/provider workflows need their own documented onboarding and
approval; local mock responses do not prove external success. Capture defects,
clinical and finance approvals, training, and unresolved limitations before a
go-live decision. No facility participants or approvals were supplied here.
