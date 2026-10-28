import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { schemaSource, appSource } from './support/schema-source.ts';
import { api } from '../api/client.ts';
import { billingClient } from '../api/clients/billing.client.ts';

import { describe, expect, it, vi } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('Insurance claims workflow', () => {
  it('1. MIGRATION AND SCHEMA', async () => {
    const sql = readRepoFile('drizzle/0011_insurance_claims_workflow.sql');

    expect(
      sql.includes('CREATE TABLE IF NOT EXISTS "insurance_claim_items"'),
      'the migration creates the claim lines table',
    ).toBe(true);
    expect(
      sql.includes('ADD COLUMN IF NOT EXISTS "settled_payment_id"'),
      'claims record the payment that settled them',
    ).toBe(true);
    expect(
      sql.includes('ADD COLUMN IF NOT EXISTS "settled_at"'),
      'claims record when they were settled',
    ).toBe(true);
    expect(
      sql.includes('insurance_claims_settled_payment_id_billing_payments_id_fk'),
      'the settled payment is a foreign key, not a loose integer',
    ).toBe(true);
    expect(
      sql.includes('insurance_claim_items_claim_id_insurance_claims_id_fk'),
      'claim lines cascade with the claim',
    ).toBe(true);
    expect(
      sql.includes('CREATE SEQUENCE IF NOT EXISTS "insurance_claim_number_seq"'),
      'claim numbers come from a sequence',
    ).toBe(true);

    /*
     * A partial unique index would fail on a database that already holds
     * two open claims on one invoice, so uniqueness is enforced under an
     * invoice row lock instead. Confirm the guard did not creep back in.
     */
    expect(
      !/UNIQUE\s+INDEX[^;]*insurance_claims/i.test(sql),
      'no unique index that could block migrating existing data',
    ).toBe(true);

    expect(sql.charCodeAt(0) !== 0xfeff, 'the migration has no BOM').toBe(true);

    const schema = schemaSource();
    expect(
      schema.includes('export const insuranceClaimItems'),
      'schema mirrors the claim lines table',
    ).toBe(true);
    expect(
      schema.includes("settledPaymentId: integer('settled_payment_id')"),
      'schema has settledPaymentId',
    ).toBe(true);

    /* Every .sql in the journal must load cleanly. */
    const journal = JSON.parse(readRepoFile('drizzle/meta/_journal.json')) as {
      entries: Array<{ tag: string }>;
    };

    expect(
      journal.entries.some((entry) => entry.tag === '0011_insurance_claims_workflow'),
      '0011 is registered in the journal',
    ).toBe(true);

    for (const entry of journal.entries) {
      const file = readRepoFile(`drizzle/${entry.tag}.sql`);

      expect(file.charCodeAt(0) !== 0xfeff, `${entry.tag} must not start with a BOM`).toBe(true);
    }

    /* No orphan .sql files that the journal does not know about. */
    const sqlFiles = readdirSync(resolve(process.cwd(), 'drizzle')).filter((name) =>
      /^\d{4}_.*\.sql$/.test(name),
    );

    for (const file of sqlFiles) {
      const tag = file.replace(/\.sql$/, '');

      expect(
        journal.entries.some((entry) => entry.tag === tag),
        `${file} must be registered in the journal`,
      ).toBe(true);
    }
  });

  it('2. STATE MACHINE', async () => {
    const service = readRepoFile('src/insurance/claims.service.ts');

    expect(
      service.includes("const OPEN_STATUSES = ['Draft', 'Submitted', 'Approved']"),
      'only one claim may be open per invoice',
    ).toBe(true);
    expect(
      service.includes(".for('update')"),
      'the invoice is locked while a claim is drafted',
    ).toBe(true);
    expect(service.includes('INVALID_TRANSITION'), 'illegal status jumps are refused').toBe(true);
    expect(
      service.includes('APPROVED_EXCEEDS_CLAIM'),
      'a payer cannot approve more than was claimed',
    ).toBe(true);
    expect(
      service.includes('CLAIM_EXCEEDS_BALANCE') || service.includes('cappedAtBalance'),
      'a claim cannot exceed the outstanding balance',
    ).toBe(true);

    /*
     * Settling must write a payment row. If the only thing that happened
     * was a status update, the invoice balance would lie.
     */
    const settleIndex = service.indexOf('export async function settleClaimScoped');
    expect(settleIndex > -1, 'settleClaimScoped exists').toBe(true);

    const settleBody = service.slice(settleIndex);

    expect(
      settleBody.includes('matchRecordedPayerPayment'),
      'settlement matches an existing receipt',
    ).toBe(true);
    expect(
      settleBody.includes('insert(schema.billingPayments)'),
      'settlement never creates receipts',
    ).toBe(false);
    expect(
      settleBody.includes('update(schema.billingInvoices)'),
      'settlement never rewrites invoices',
    ).toBe(false);
    expect(settleBody.includes("status: 'Settled'"), 'matching marks the claim settled').toBe(true);
    const settledWrites = service.match(/status:\s*'Settled'/g) ?? [];
    expect(settledWrites.length).toBe(1);
  });

  it('3. ROUTES', async () => {
    const app = appSource();
    const wiring = readRepoFile('src/routes/index.ts');

    /*
     * The mount lines live in src/routes/index.ts now. That router is
     * mounted at '/api' by app.ts, so the prefix is relative here - the
     * assertion still pins the same gate to the same public path.
     */

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

    /*
     * Match on the method and the path, not on the indentation between
     * them. The handlers now sit at module scope in
     * `src/routes/domains/claims.routes.ts` rather than nested inside
     * `createApp`, so Prettier indents the arguments two spaces instead of
     * four - a formatting change, not a wiring change.
     */
    const registration = (method: string, route: string) =>
      app.search(new RegExp(`router\\.${method}\\(\\s*'${route}'`));

    for (const [method, route, permission] of routes) {
      const index = registration(method, route);
      expect(index > -1, `${method.toUpperCase()} ${route} is registered`).toBe(true);

      const window = app.slice(index, index + 300);
      expect(
        window.includes(`requirePermission('${permission}')`),
        `${method.toUpperCase()} ${route} requires ${permission}`,
      ).toBe(true);
    }

    expect(
      wiring.includes("api.use('/claims', requireFacilityModule('insurance'))"),
      'claims are gated by the insurance facility module',
    ).toBe(true);

    /*
     * Reads keep the module gate but no new permission requirement: no
     * role in the catalogue currently holds an insurance permission, so
     * adding one here would take the claims screen away from clerks who
     * can see it today. Tighten this once roles are granted the code.
     */
    for (const route of [
      '/api/claims',
      '/api/claims/:id/items',
      '/api/invoices/:id/claimable-lines',
    ]) {
      const index = registration('get', route);
      expect(index > -1, `GET ${route} is registered`).toBe(true);

      const window = app.slice(index, index + 200);
      expect(
        !window.includes("requirePermission('insurance.read')"),
        `GET ${route} must not add an ungranted permission`,
      ).toBe(true);
    }

    /* The legacy status endpoint must still settle through the service. */
    const legacyIndex = app.indexOf("'/api/claims/:id/status'");
    const legacyBody = app.slice(legacyIndex, legacyIndex + 2500);
    expect(
      legacyBody.includes('settleClaimScoped'),
      'the legacy status route settles through the state machine',
    ).toBe(true);
    expect(
      !legacyBody.includes('queries.updateClaimStatus'),
      'the legacy route no longer writes status directly',
    ).toBe(true);
  });

  it('4. HONESTY', async () => {
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
      expect(!ui.includes(invention), `the screen must not prefill "${invention}"`).toBe(true);
    }

    expect(!ui.includes('Math.random()'), 'claim numbers are not invented in the browser').toBe(
      true,
    );
    expect(!/4450\.00/.test(ui), 'no hardcoded claim amount').toBe(true);

    /* Unsupported compliance claims that used to be printed on the screen. */
    const overclaims = [
      'API Integration Ready',
      'DHA Electronic Remittance Ready',
      'Payer abstraction engine',
      'submitted to the SHA portal',
    ];

    for (const phrase of overclaims) {
      expect(!ui.includes(phrase), `the screen must not claim "${phrase}"`).toBe(true);
    }

    /* And the truthful statement must be present. */
    expect(
      ui.includes('No live SHA connection'),
      'the screen states there is no SHA connection',
    ).toBe(true);
    expect(
      ui.includes('does not transmit claims'),
      'the screen says claims are not transmitted',
    ).toBe(true);

    /* The module must not call any external URL. */
    expect(!/https?:\/\//.test(ui), 'the claims screen makes no external requests').toBe(true);
  });

  it('5. CLIENT CONTRACT (behavioural)', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({
        url: String(input),
        method: (init?.method ?? 'GET').toUpperCase(),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    try {
      await api.getClaimableLines(42, 7);
      await billingClient.draftClaim({ invoiceId: 42, lineItemIds: [1, 2], payerName: 'SHIF' });
      await api.submitClaim(99, 7);
      await api.adjudicateClaim(99, '1500.00', 'Approved per tariff', 7);
      await api.settleClaim(99, 7);
      await api.getClaimItems(99, 7);
    } finally {
      fetchSpy.mockRestore();
    }

    expect(calls).toEqual([
      { url: '/api/invoices/42/claimable-lines?facilityId=7', method: 'GET', body: undefined },
      {
        url: '/api/claims',
        method: 'POST',
        body: { invoiceId: 42, lineItemIds: [1, 2], payerName: 'SHIF' },
      },
      { url: '/api/claims/99/submit', method: 'POST', body: { facilityId: 7 } },
      {
        url: '/api/claims/99/adjudicate',
        method: 'POST',
        body: { approvedAmount: '1500.00', notes: 'Approved per tariff', facilityId: 7 },
      },
      { url: '/api/claims/99/settle', method: 'POST', body: { facilityId: 7 } },
      { url: '/api/claims/99/items?facilityId=7', method: 'GET', body: undefined },
    ]);

    const types = readRepoFile('src/types/index.ts');
    expect(types.includes('export interface ClaimableLinesResponse'), 'claimable lines typed').toBe(
      true,
    );
    expect(types.includes('export interface DraftClaimResult'), 'draft result typed').toBe(true);
    expect(
      types.includes('export interface ClaimSettlementResult'),
      'settlement result typed',
    ).toBe(true);
  });
});
