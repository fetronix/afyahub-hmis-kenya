# Billing and financial work in progress — 2026-11-03

**Status: not production-ready.** This branch is a development snapshot based on main commit `63903c5`. No production database, real patient data, payment provider or deployment was changed as part of this work.

## Changes under development

- Inpatient pricing uses an explicitly configured ward default unless a configured bed override is present. An unconfigured or unconfirmed price requires review; historical occupancy and night-rate evidence must not be silently repriced. Migration `0066` adds ward approval/revision and rate-source evidence.
- An omitted initial facility-service price defaults to KES 0.00, which remains unpriced and is not authorization to bill a free service.
- CI, migration-preservation, database-backup path guards, facility scoping, audit rollback and focused billing/inpatient checks have been strengthened. The backup guard only inspects current tracked paths; it does not remove or scan exposed Git history.
- An experimental financial-transactions API and an **unmounted** UI panel are present but have not been PostgreSQL- or browser-verified. The API treats timezone-less stored timestamps as UTC; the origin of historical timestamps must be verified. Recorded payments and manual refunds do not prove provider or bank settlement. These reports are not a general ledger or historical as-of balance.

## Evidence and outstanding verification

- Earlier synthetic PostgreSQL evidence applied all 67 migrations to a fresh isolated database and applied `0066` to a populated synthetic database, preserving existing values across 26 inspected table sets. Neither demonstrates production safety or a verified production backup.
- Before the latest code edits, a full synthetic PostgreSQL regression passed 1,964 tests across 212 files. A later focused run passed 91 tests and failed one fixture-ordering test; the fixture ordering was adjusted, but that PostgreSQL run has **not** been rerun.
- At this snapshot, TypeScript, formatting, lint, the frontend build and the server build passed; lint reported 87 warnings and the frontend build reported a large-chunk warning. Eight selected non-database suites passed 47 tests. PostgreSQL was unavailable in this environment for that run; those results do not cover database suites, the new reporting API or browser journeys.
- The ward-default browser script, actual Docker bootstrap, backup restore, provider confirmation, accounting automation and facility/user acceptance remain unverified or incomplete. No deployment or live settlement claim should be made from this branch.
- Historical public-repository dump exposure still requires owner-authorized security containment, credential/session remediation and assessment; see `docs/security/DATA-EXPOSURE.md`.
