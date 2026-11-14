import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { expect, it, vi } from 'vitest';
import { pool as applicationPool } from '../../db/index.ts';
import { getAccountingOverviewScoped } from '../../accounting/accounting.service.ts';
import { hasPostedJournalScopeMismatch } from '../../accounting/journal-scope-integrity.ts';
import { describeDb, testPool } from './support/db.ts';

describeDb('journal scope integrity with synthetic PostgreSQL fixtures', () => {
  const pool = testPool();

  it('detects both sides of a posted cross-facility account link without exposing foreign identifiers', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // Test-only temporary tables simulate legacy/trigger-bypassed evidence;
      // no application trigger is disabled and no persisted journal is edited.
      await c.query(
        'CREATE TEMP TABLE journal_entries(id int,tenant_id int,facility_id int,status text) ON COMMIT DROP',
      );
      await c.query(
        'CREATE TEMP TABLE chart_of_accounts(id int,tenant_id int,facility_id int) ON COMMIT DROP',
      );
      await c.query(
        'CREATE TEMP TABLE journal_lines(journal_entry_id int,account_id int) ON COMMIT DROP',
      );
      await c.query("INSERT INTO journal_entries VALUES(1,10,100,'POSTED'),(2,10,100,'DRAFT')");
      await c.query('INSERT INTO chart_of_accounts VALUES(1,20,200),(2,10,100)');
      await c.query('INSERT INTO journal_lines VALUES(1,1),(2,2)');
      expect(await hasPostedJournalScopeMismatch(c, 10, 100)).toBe(true);
      expect(await hasPostedJournalScopeMismatch(c, 20, 200)).toBe(true);
      expect(await hasPostedJournalScopeMismatch(c, 30, 300)).toBe(false);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('fails the accounting overview closed rather than displaying a partial legacy ledger', async () => {
    const c = await applicationPool.connect();
    const release = c.release.bind(c);
    let released = false;
    const releaseSpy = vi.spyOn(c, 'release').mockImplementation(() => {
      released = true;
      release(true); // Drop only this test connection and its temporary tables.
    });
    try {
      await c.query(
        'CREATE TEMP TABLE journal_entries(id int,tenant_id int,facility_id int,status text)',
      );
      await c.query('CREATE TEMP TABLE chart_of_accounts(id int,tenant_id int,facility_id int)');
      await c.query('CREATE TEMP TABLE journal_lines(journal_entry_id int,account_id int)');
      await c.query("INSERT INTO journal_entries VALUES(1,10,100,'POSTED')");
      await c.query('INSERT INTO chart_of_accounts VALUES(1,20,200)');
      await c.query('INSERT INTO journal_lines VALUES(1,1)');
      const promisePool: { connect: () => Promise<PoolClient> } = applicationPool;
      const connect = vi.spyOn(promisePool, 'connect').mockResolvedValueOnce(c);
      try {
        await expect(
          getAccountingOverviewScoped(
            { tenantId: 10, facilityId: 100, actorUserId: 1 },
            '2026-01-01',
            '2026-01-31',
          ),
        ).rejects.toMatchObject({ code: 'LEDGER_SCOPE_INCONSISTENT', status: 409 });
      } finally {
        connect.mockRestore();
      }
    } finally {
      releaseSpy.mockRestore();
      if (!released) release(true);
    }
  });

  it('refuses to adopt an unexpected pre-existing scope guard object', async () => {
    const c = await pool.connect();
    const schema = `scope_collision_${randomUUID().replaceAll('-', '')}`;
    try {
      await c.query('BEGIN');
      await c.query(`CREATE SCHEMA "${schema}"`);
      await c.query(`SET LOCAL search_path TO "${schema}"`);
      await c.query(
        'CREATE TABLE journal_entries(id int,tenant_id int,facility_id int,status text)',
      );
      await c.query('CREATE TABLE chart_of_accounts(id int,tenant_id int,facility_id int)');
      await c.query('CREATE TABLE journal_lines(journal_entry_id int,account_id int)');
      await c.query(
        'CREATE FUNCTION jcare_account_scope_immutable() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql',
      );
      const statements = (await readFile('drizzle/0070_journal_facility_scope_guards.sql', 'utf8'))
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);
      await c.query(statements[0]);
      await c.query('SAVEPOINT preflight');
      await expect(c.query(statements[1])).rejects.toMatchObject({ code: 'P0001' });
      await c.query('ROLLBACK TO SAVEPOINT preflight');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('installs without rewriting an inconsistent legacy draft but blocks it from posting', async () => {
    const c = await pool.connect();
    const schema = `scope_draft_${randomUUID().replaceAll('-', '')}`;
    try {
      await c.query('BEGIN');
      await c.query(`CREATE SCHEMA "${schema}"`);
      await c.query(`SET LOCAL search_path TO "${schema}"`);
      await c.query(
        'CREATE TABLE journal_entries(id int,tenant_id int,facility_id int,status text)',
      );
      await c.query(
        'CREATE TABLE chart_of_accounts(id int,tenant_id int,facility_id int,is_active boolean)',
      );
      await c.query('CREATE TABLE journal_lines(journal_entry_id int,account_id int)');
      await c.query("INSERT INTO journal_entries VALUES(1,10,100,'DRAFT')");
      await c.query('INSERT INTO chart_of_accounts VALUES(1,20,200,true)');
      await c.query('INSERT INTO journal_lines VALUES(1,1)');
      const statements = (await readFile('drizzle/0070_journal_facility_scope_guards.sql', 'utf8'))
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const statement of statements) await c.query(statement);
      await c.query('SAVEPOINT before_post');
      await expect(
        c.query("UPDATE journal_entries SET status='POSTED' WHERE id=1"),
      ).rejects.toMatchObject({ code: '23514' });
      await c.query('ROLLBACK TO SAVEPOINT before_post');
      expect((await c.query('SELECT status FROM journal_entries WHERE id=1')).rows[0].status).toBe(
        'DRAFT',
      );
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('refuses migration when synthetic posted history has a scope mismatch', async () => {
    const c = await pool.connect();
    const schema = `scope_preflight_${randomUUID().replaceAll('-', '')}`;
    try {
      await c.query('BEGIN');
      await c.query(`CREATE SCHEMA "${schema}"`);
      await c.query(`SET LOCAL search_path TO "${schema}"`);
      await c.query(
        'CREATE TABLE journal_entries(id int,tenant_id int,facility_id int,status text)',
      );
      await c.query('CREATE TABLE chart_of_accounts(id int,tenant_id int,facility_id int)');
      await c.query('CREATE TABLE journal_lines(journal_entry_id int,account_id int)');
      await c.query("INSERT INTO journal_entries VALUES(1,10,100,'POSTED')");
      await c.query('INSERT INTO chart_of_accounts VALUES(1,20,200)');
      await c.query('INSERT INTO journal_lines VALUES(1,1)');
      const statements = (await readFile('drizzle/0070_journal_facility_scope_guards.sql', 'utf8'))
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);
      await c.query(statements[0]);
      await c.query('SAVEPOINT preflight');
      await expect(c.query(statements[1])).rejects.toMatchObject({ code: 'P0001' });
      await c.query('ROLLBACK TO SAVEPOINT preflight');
      expect((await c.query('SELECT count(*)::int AS n FROM journal_lines')).rows[0].n).toBe(1);
      expect((await c.query('SELECT count(*)::int AS n FROM journal_entries')).rows[0].n).toBe(1);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
