/**
 * JaliCare HMIS
 * Insurance claims workflow
 *
 * These tests enforce two things.
 *
 * The first is the state machine: a claim is drafted from real invoice
 * lines, only a submitted claim can be adjudicated, and "Settled" means
 * a payment row exists — never that someone changed a dropdown.
 *
 * The second is honesty. The previous screen invented policy numbers,
 * pre-authorisation codes and claim amounts, and told the clerk a claim
 * had been "submitted to the SHA portal" when nothing had been sent
 * anywhere. Those strings are checked for absence here, so they cannot
 * creep back in.
 *
 * Run with: npx tsx src/tests/claims.test.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { schemaSource } from './support/schema-source.ts';

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(
    actual === expected,
    `${label} (expected ${String(expected)}, got ${String(actual)})`,
  );
}

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

/* ============================================================
   1. MIGRATION AND SCHEMA
   ============================================================ */

function testMigration(): void {
  const sql = readRepoFile('drizzle/0011_insurance_claims_workflow.sql');

  assert(
    sql.includes('CREATE TABLE IF NOT EXISTS "insurance_claim_items"'),
    'the migration creates the claim lines table',
  );
  assert(
    sql.includes('ADD COLUMN IF NOT EXISTS "settled_payment_id"'),
    'claims record the payment that settled them',
  );
  assert(
    sql.includes('ADD COLUMN IF NOT EXISTS "settled_at"'),
    'claims record when they were settled',
  );
  assert(
    sql.includes('insurance_claims_settled_payment_id_billing_payments_id_fk'),
    'the settled payment is a foreign key, not a loose integer',
  );
  assert(
    sql.includes('insurance_claim_items_claim_id_insurance_claims_id_fk'),
    'claim lines cascade with the claim',
  );
  assert(
    sql.includes('CREATE SEQUENCE IF NOT EXISTS "insurance_claim_number_seq"'),
    'claim numbers come from a sequence',
  );

  /*
   * A partial unique index would fail on a database that already holds
   * two open claims on one invoice, so uniqueness is enforced under an
   * invoice row lock instead. Confirm the guard did not creep back in.
   */
  assert(
    !/UNIQUE\s+INDEX[^;]*insurance_claims/i.test(sql),
    'no unique index that could block migrating existing data',
  );

  assertEqual(sql.charCodeAt(0) !== 0xfeff, true, 'the migration has no BOM');

  const schema = schemaSource();
  assert(schema.includes('export const insuranceClaimItems'), 'schema mirrors the claim lines table');
  assert(schema.includes("settledPaymentId: integer('settled_payment_id')"), 'schema has settledPaymentId');

  /* Every .sql in the journal must load cleanly. */
  const journal = JSON.parse(readRepoFile('drizzle/meta/_journal.json')) as {
    entries: Array<{ tag: string }>;
  };

  assert(
    journal.entries.some((entry) => entry.tag === '0011_insurance_claims_workflow'),
    '0011 is registered in the journal',
  );

  for (const entry of journal.entries) {
    const file = readRepoFile(`drizzle/${entry.tag}.sql`);

    assert(file.charCodeAt(0) !== 0xfeff, `${entry.tag} must not start with a BOM`);
  }

  /* No orphan .sql files that the journal does not know about. */
  const sqlFiles = readdirSync(resolve(process.cwd(), 'drizzle')).filter((name) =>
    /^\d{4}_.*\.sql$/.test(name),
  );

  for (const file of sqlFiles) {
    const tag = file.replace(/\.sql$/, '');

    assert(
      journal.entries.some((entry) => entry.tag === tag),
      `${file} must be registered in the journal`,
    );
  }
}

/* ============================================================
   2. STATE MACHINE
   ============================================================ */

function testStateMachine(): void {
  const service = readRepoFile('src/insurance/claims.service.ts');

  assert(
    service.includes("const OPEN_STATUSES = ['Draft', 'Submitted', 'Approved']"),
    'only one claim may be open per invoice',
  );
  assert(
    service.includes(".for('update')"),
    'the invoice is locked while a claim is drafted',
  );
  assert(
    service.includes('INVALID_TRANSITION'),
    'illegal status jumps are refused',
  );
  assert(
    service.includes('APPROVED_EXCEEDS_CLAIM'),
    'a payer cannot approve more than was claimed',
  );
  assert(
    service.includes('CLAIM_EXCEEDS_BALANCE') || service.includes('cappedAtBalance'),
    'a claim cannot exceed the outstanding balance',
  );

  /*
   * Settling must write a payment row. If the only thing that happened
   * was a status update, the invoice balance would lie.
   */
  const settleIndex = service.indexOf('export async function settleClaimScoped');
  assert(settleIndex > -1, 'settleClaimScoped exists');

  const settleBody = service.slice(settleIndex);

  assert(
    settleBody.includes('insert(schema.billingPayments)'),
    'settling inserts a payment',
  );
  assert(
    settleBody.includes('update(schema.billingInvoices)'),
    'settling updates the invoice balance',
  );
  assert(
    settleBody.includes("status: 'Settled'"),
    'only the settle path marks a claim Settled',
  );

  /* Nothing else may set Settled. */
  const settledWrites = service.match(/status:\s*'Settled'/g) ?? [];
  assertEqual(settledWrites.length, 1, 'exactly one place writes Settled');

  /*
   * Approved money beyond the balance is not posted; it is reported.
   * Inventing credit for a payer would be creating money.
   */
  assert(
    settleBody.includes('Math.min(approvedCents, balanceCents)'),
    'settlement is capped at the outstanding balance',
  );
  assert(
    settleBody.includes('unappliedCents'),
    'the unapplied remainder is reported',
  );
}

/* ============================================================
   3. ROUTES
   ============================================================ */

function testRoutes(): void {
  const app = readRepoFile('src/app.ts');

  /*
   * Match on "app.<method>( '<route>'" so the module gate on line 180
   * (app.use('/api/claims', ...)) is not mistaken for the route itself.
   */
  const routes: Array<[string, string, string]> = [
    ['post', '/api/claims', 'insurance.claims.create'],
    ['post', '/api/claims/:id/submit', 'insurance.claims.create'],
    ['post', '/api/claims/:id/adjudicate', 'insurance.claims.manage'],
    ['post', '/api/claims/:id/settle', 'insurance.claims.manage'],
  ];

  for (const [method, route, permission] of routes) {
    const index = app.indexOf(`app.${method}(\n    '${route}'`);
    assert(index > -1, `${method.toUpperCase()} ${route} is registered`);

    const window = app.slice(index, index + 300);
    assert(
      window.includes(`requirePermission('${permission}')`),
      `${method.toUpperCase()} ${route} requires ${permission}`,
    );
  }

  assert(
    app.includes("app.use('/api/claims', requireFacilityModule('insurance'))"),
    'claims are gated by the insurance facility module',
  );

  /*
   * Reads keep the module gate but no new permission requirement: no
   * role in the catalogue currently holds an insurance permission, so
   * adding one here would take the claims screen away from clerks who
   * can see it today. Tighten this once roles are granted the code.
   */
  for (const route of ['/api/claims', '/api/claims/:id/items', '/api/invoices/:id/claimable-lines']) {
    const index = app.indexOf(`app.get(\n    '${route}'`);
    assert(index > -1, `GET ${route} is registered`);

    const window = app.slice(index, index + 200);
    assert(
      !window.includes("requirePermission('insurance.read')"),
      `GET ${route} must not add an ungranted permission`,
    );
  }

  /* The legacy status endpoint must still settle through the service. */
  const legacyIndex = app.indexOf("'/api/claims/:id/status'");
  const legacyBody = app.slice(legacyIndex, legacyIndex + 2500);
  assert(
    legacyBody.includes('settleClaimScoped'),
    'the legacy status route settles through the state machine',
  );
  assert(
    !legacyBody.includes('queries.updateClaimStatus'),
    'the legacy route no longer writes status directly',
  );
}

/* ============================================================
   4. HONESTY
   ============================================================ */

function testNoInventedData(): void {
  const ui = readRepoFile('src/components/modules/InsuranceClaimsModule.tsx');

  /* Fabricated identifiers that previously prefilled the form. */
  const inventions = [
    'SHA-KEN-2026-9921',
    'AUTH-SHA-782109',
    'Jubilee Health Insurance',
    'APA Insurance Kenya',
    'AHS-SHA',
  ];

  for (const invention of inventions) {
    assert(!ui.includes(invention), `the screen must not prefill "${invention}"`);
  }

  assert(
    !ui.includes('Math.random()'),
    'claim numbers are not invented in the browser',
  );
  assert(
    !/4450\.00/.test(ui),
    'no hardcoded claim amount',
  );

  /* Unsupported compliance claims that used to be printed on the screen. */
  const overclaims = [
    'API Integration Ready',
    'DHA Electronic Remittance Ready',
    'Payer abstraction engine',
    'submitted to the SHA portal',
  ];

  for (const phrase of overclaims) {
    assert(!ui.includes(phrase), `the screen must not claim "${phrase}"`);
  }

  /* And the truthful statement must be present. */
  assert(ui.includes('No live SHA connection'), 'the screen states there is no SHA connection');
  assert(
    ui.includes('does not transmit claims'),
    'the screen says claims are not transmitted',
  );

  /* The module must not call any external URL. */
  assert(!/https?:\/\//.test(ui), 'the claims screen makes no external requests');
}

/* ============================================================
   5. CLIENT CONTRACT
   ============================================================ */

function testClient(): void {
  const client = readRepoFile('src/api/client.ts');

  for (const method of [
    'getClaimableLines',
    'draftClaim',
    'submitClaim',
    'adjudicateClaim',
    'settleClaim',
    'getClaimItems',
  ]) {
    assert(client.includes(`${method}:`), `client exposes ${method}`);
  }

  const types = readRepoFile('src/types/index.ts');
  assert(types.includes('export interface ClaimableLinesResponse'), 'claimable lines typed');
  assert(types.includes('export interface DraftClaimResult'), 'draft result typed');
  assert(types.includes('export interface ClaimSettlementResult'), 'settlement result typed');
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('INSURANCE CLAIMS TESTS');
  console.log('==============================================');

  testMigration();
  console.log('  1. Migration 0011 and the schema agree');

  testStateMachine();
  console.log('  2. The claim state machine holds');

  testRoutes();
  console.log('  3. Routes are guarded');

  testNoInventedData();
  console.log('  4. No invented identifiers or compliance claims');

  testClient();
  console.log('  5. Client and types are wired');

  console.log('');
  console.log('==============================================');
  console.log(`INSURANCE CLAIMS TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('INSURANCE CLAIMS TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
