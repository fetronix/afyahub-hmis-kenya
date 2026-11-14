# Checkpoint — Phase A3 (finalized-invoice claim enforcement)

Date: 2026-10-27
Branch: `arena/e088f11d-afyahub-hmis-kenya`
Commit: `6b744f7` (A3 feature), on top of `4cdbc93`

## Delivered

- `src/insurance/core/claim-invoice-gate.ts` — single gate used by SHA and
  private claims: `assertInvoiceClaimable` (void beats not-finalized),
  `loadClaimInvoiceFacts` (scoped finalization snapshot or refuse),
  `assertClaimInvoiceStillValid` (dispatch-time re-check).
- Migration `drizzle/0088_claim_invoice_finalization.sql` (+ journal idx 88):
  `invoice_finalized_at`, `invoice_snapshot` on `sha_eclaims` and
  `private_insurance_claims`, paired both-or-neither CHECKs, no backfill.
- Wired into `prepareShaClaim` / `submitShaClaim` and the private equivalents.
- Tests: `sha-eclaims.db.spec.ts` 2/2 (incl. new negative suite),
  `private-insurance.db.spec.ts` 1/1, `payer-hub.db.spec.ts` 1/1,
  `finalized-invoices.db.spec.ts` 10/10 (needs `jalicare_synthetic_test`).
- `tsc --noEmit` clean, eslint clean on changed files.

## Environment notes

- Embedded PostgreSQL 16 on `127.0.0.1:55432`, trust auth, user `jalicare_test`.
- Databases: `jalicare_dev`, `jalicare_test2`, `jalicare_synthetic_test`
  (all at 89 migrations).
- DB-spec command (test DB must contain "test"):
  `SYSID=$(cat /tmp/sysid.txt) SQL_HOST=127.0.0.1 SQL_PORT=55432 SQL_DB_NAME=<db> SQL_ADMIN_USER=jalicare_test SQL_ADMIN_PASSWORD=jalicare_test JALICARE_REQUIRE_DB=1 JALICARE_TEST_PG_SYSTEM_IDENTIFIER=$SYSID npx vitest run <spec>`
- Specs that assert a *synthetic* test DB (`assertSyntheticTarget`) need a DB
  named `jalicare_synthetic_test`.

## Next

Phase A4 — source-to-ledger completeness (every billable source type posts a
balanced, idempotent journal), then Phase B — facility letterhead.
