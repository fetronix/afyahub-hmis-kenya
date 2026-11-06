import { randomUUID } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import PDFParser from 'pdf2json';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createAccountScoped,
  createFinancialPeriodScoped,
  postJournalScoped,
  reverseJournalScoped,
} from '../../accounting/accounting.service.ts';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Reporting Centre posted ledger subsets (synthetic PostgreSQL and HTTP)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number,
    otherTenant: number,
    facility: number,
    sibling: number,
    foreign: number,
    actor: number;
  let full: string,
    noDomainExport: string,
    reportsOnly: string,
    base: string,
    close: () => Promise<void>;
  const post = (
    id: string,
    action: 'generate' | 'export',
    body: Record<string, unknown> = {},
    token = full,
  ) =>
    httpJson(base, 'POST', `/api/reporting/centre/${id}/${action}`, {
      token,
      body: { facilityId: facility, ...body },
    });
  async function createUser(tag: string, permissions: string[]) {
    const id = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
      VALUES($1,$1,$2,'Synthetic ledger reporter','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`ledger-${tag}-${suffix}`, `ledger-${tag}-${suffix}@example.test`, tenant, facility],
      )
    ).rows[0].id;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, `LEDGER_${tag}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    for (const code of permissions) {
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
        [code],
      );
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, code],
      );
    }
    return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
  }
  beforeAll(async () => {
    if (
      !/(?:synthetic.*test|test.*synthetic)/i.test(process.env.SQL_DB_NAME ?? '') ||
      !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '')
    )
      throw new Error('Isolated loopback synthetic test database required.');
    [tenant, otherTenant] = (
      await pool.query(
        "INSERT INTO tenants(name,slug,currency) VALUES($1,$2,'USD'),($3,$4,'KES') RETURNING id",
        [
          `Synthetic ledger ${suffix}`,
          `led-${suffix}`,
          `Synthetic foreign ${suffix}`,
          `led-other-${suffix}`,
        ],
      )
    ).rows.map((r) => r.id);
    [facility, sibling, foreign] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES
      ($1,$3,'Synthetic Ledger Facility',$6::jsonb),($1,$4,'Synthetic Sibling',$6::jsonb),($2,$5,'Synthetic Foreign',$6::jsonb) RETURNING id`,
        [
          tenant,
          otherTenant,
          `LA-${suffix}`,
          `LB-${suffix}`,
          `LC-${suffix}`,
          JSON.stringify(['analytics', 'accounting']),
        ],
      )
    ).rows.map((r) => r.id);
    const user = await createUser('full', [
      'reports.read',
      'reports.export',
      'accounting.read',
      'accounting.reports.export',
    ]);
    actor = user.id;
    full = user.token;
    noDomainExport = (
      await createUser('noexport', ['reports.read', 'reports.export', 'accounting.read'])
    ).token;
    reportsOnly = (await createUser('reportsonly', ['reports.read', 'reports.export'])).token;
    const scope = { tenantId: tenant, facilityId: facility, actorUserId: actor };
    const createAccount = (code: string, name: string, type: string, normal: string) =>
      createAccountScoped(scope, {
        accountCode: code,
        accountName: name,
        accountType: type,
        normalBalance: normal,
        subType: 'SYNTHETIC',
      });
    const asset = await createAccount('1100', 'Synthetic Cash', 'ASSET', 'DEBIT');
    const revenue = await createAccount('4000', 'Synthetic Revenue', 'REVENUE', 'CREDIT');
    const expense = await createAccount('5000', 'Synthetic Expense', 'EXPENSE', 'DEBIT');
    await createFinancialPeriodScoped(scope, {
      periodCode: '2026',
      name: 'Synthetic 2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    const journal = (key: string, date: string, lines: unknown[]) =>
      postJournalScoped(scope, {
        entryDate: date,
        description: 'Synthetic posted transaction',
        idempotencyKey: `${key}-${suffix}`,
        lines,
      });
    await journal('opening', '2026-03-01', [
      { accountId: asset.id, debitKes: '10.00' },
      { accountId: revenue.id, creditKes: '10.00' },
    ]);
    await journal('sale', '2026-04-01', [
      { accountId: asset.id, debitKes: '120.10' },
      { accountId: revenue.id, creditKes: '120.10' },
    ]);
    await journal('expense', '2026-04-02', [
      { accountId: expense.id, debitKes: '20.05' },
      { accountId: asset.id, creditKes: '20.05' },
    ]);
    const reversed = await journal('reverse-me', '2026-04-10', [
      { accountId: asset.id, debitKes: '5.00' },
      { accountId: revenue.id, creditKes: '5.00' },
    ]);
    await reverseJournalScoped(scope, reversed.journal.id, {
      entryDate: '2026-04-15',
      reason: 'Synthetic correction',
      idempotencyKey: `reverse-${suffix}`,
    });
    // A foreign chart is enough to prove it is not enumerated; no cross-scope journal is created.
    await pool.query(
      `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,normal_balance,sub_type)
      VALUES($1,$2,'9999','ForeignPrivate Account','ASSET','DEBIT','SYNTHETIC')`,
      [otherTenant, foreign],
    );
    const { createApp } = await import('../../../src/app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  }, 20000);
  afterAll(async () => {
    if (close) await close();
  });

  it('uses exact posted movements, respects period dates, and retains reversals as separate postings', async () => {
    const result = await post('ledger-trial-movements', 'generate', {
      from: '2026-04-01',
      to: '2026-04-30',
      limit: 1,
    });
    expect(result.status).toBe(200);
    expect(result.body.currency).toBe('KES');
    expect(result.body.total).toBe(3);
    expect(result.body.rows).toHaveLength(1);
    expect(result.body.summaries.map((x: { value: string }) => x.value)).toEqual([
      '150.15',
      '150.15',
    ]);
    expect(result.body.notes.join(' ')).toContain('not an as-of trial balance');
    const cash = await post('ledger-trial-movements', 'generate', {
      from: '2026-04-01',
      to: '2026-04-30',
      search: 'Synthetic Cash',
    });
    expect(cash.body.rows[0]).toMatchObject({
      debits: '125.10',
      credits: '25.05',
      netDebit: '100.05',
      netCredit: '0.00',
    });
    expect(JSON.stringify(cash.body)).not.toContain('ForeignPrivate');
  });

  it('reports signed posted income and an inception-to-date balance sheet, without asserting reconciliation', async () => {
    const income = await post('ledger-income', 'generate', {
      from: '2026-04-01',
      to: '2026-04-30',
    });
    expect(income.status).toBe(200);
    expect(income.body.summaries.map((x: { value: string }) => x.value)).toEqual([
      '120.10',
      '20.05',
      '100.05',
    ]);
    const balance = await post('ledger-balance-sheet', 'generate', { to: '2026-04-30' });
    expect(balance.status).toBe(200);
    expect(balance.body.summaries.map((x: { value: string }) => x.value)).toEqual([
      '110.05',
      '0.00',
      '110.05',
    ]);
    expect(balance.body.notes.join(' ')).toContain('not complete, certified financial statements');
    const early = await post('ledger-balance-sheet', 'generate', { to: '2026-04-01' });
    expect(early.body.summaries.map((x: { value: string }) => x.value)).toEqual([
      '130.10',
      '0.00',
      '130.10',
    ]);
    expect((await post('ledger-balance-sheet', 'generate', {})).status).toBe(400);
    expect(
      (await post('ledger-balance-sheet', 'generate', { from: '2026-04-01', to: '2026-04-30' }))
        .status,
    ).toBe(400);
    expect((await post('ledger-balance-sheet', 'generate', { to: '2026-02-30' })).status).toBe(400);
  });

  it.each(['ledger-trial-movements', 'ledger-income', 'ledger-balance-sheet'])(
    '%s enforces scope and both export permissions and exports actual source values',
    async (id) => {
      const filters =
        id === 'ledger-balance-sheet'
          ? { to: '2026-04-30' }
          : { from: '2026-04-01', to: '2026-04-30' };
      expect((await post(id, 'generate', { ...filters, facilityId: sibling })).status).toBe(403);
      expect((await post(id, 'generate', { ...filters, facilityId: foreign })).status).toBe(403);
      expect((await post(id, 'generate', filters, reportsOnly)).status).toBe(403);
      expect(
        (await post(id, 'generate', { ...filters, intent: 'print' }, noDomainExport)).status,
      ).toBe(403);
      expect(
        (await post(id, 'export', { ...filters, format: 'xlsx' }, noDomainExport)).status,
      ).toBe(403);
      expect((await post(id, 'export', { ...filters, format: 'csv' }, noDomainExport)).status).toBe(
        403,
      );
      const pdf = await post(id, 'export', { ...filters, format: 'pdf' });
      expect(pdf.status).toBe(200);
      const parser = new PDFParser(null, true);
      const text = await new Promise<string>((resolve, reject) => {
        parser.on('pdfParser_dataError', reject);
        parser.on('pdfParser_dataReady', () => resolve(parser.getRawTextContent()));
        parser.parseBuffer(Buffer.from(pdf.body.base64, 'base64'));
      });
      parser.destroy();
      expect(text).toContain('Synthetic');
      expect(text).toContain('KES');
      expect(text).not.toContain('ForeignPrivate');
      const xlsx = await post(id, 'export', { ...filters, format: 'xlsx' });
      expect(xlsx.status).toBe(200);
      const xml = Object.entries(unzipSync(Buffer.from(xlsx.body.base64, 'base64')))
        .filter(([name]) => name.endsWith('.xml'))
        .map(([, bytes]) => strFromU8(bytes))
        .join('\n');
      expect(xml).toContain('Synthetic');
      expect(xml).toContain('KES');
      expect(xml).not.toContain('ForeignPrivate');
      expect(xml).not.toMatch(/<f[ >]/);
    },
  );
});
