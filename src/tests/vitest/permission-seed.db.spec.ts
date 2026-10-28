/** Tests the actual dry-run and seed in an isolated schema on the disposable test DB. */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeDb, testPool } from './support/db.ts';

const schema = `seed_test_${randomUUID().replaceAll('-', '')}`;
const env = { ...process.env, PGOPTIONS: `-c search_path=${schema}` };
function run(args: string[]) {
  return execFileSync(
    'node',
    ['node_modules/tsx/dist/cli.mjs', 'src/seeds/permissions.ts', ...args],
    {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      timeout: 60_000,
    },
  )
    .split(String.fromCharCode(27))
    .map((part) => part.replace(/^\[[0-9;]*m/, ''))
    .join('');
}

describeDb('permission seed plans missing rows without writing', () => {
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required');
    const db = testPool();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(
      `CREATE TABLE "${schema}".permissions (id serial PRIMARY KEY,code text NOT NULL UNIQUE,name text NOT NULL,module text NOT NULL,description text,created_at timestamp NOT NULL DEFAULT now())`,
    );
    await db.query(
      `CREATE TABLE "${schema}".roles (id serial PRIMARY KEY,tenant_id integer,name text NOT NULL,description text,is_system boolean NOT NULL DEFAULT false,is_active boolean NOT NULL DEFAULT true,created_at timestamp NOT NULL DEFAULT now(),updated_at timestamp NOT NULL DEFAULT now())`,
    );
    await db.query(
      `CREATE TABLE "${schema}".role_permissions (id serial PRIMARY KEY,role_id integer NOT NULL,permission_id integer NOT NULL,created_at timestamp NOT NULL DEFAULT now(),UNIQUE(role_id,permission_id))`,
    );
    await db.query(
      `INSERT INTO "${schema}".roles(tenant_id,name) VALUES(NULL,'SUPER_ADMIN'),(42,'FACILITY_ADMIN')`,
    );
  });
  afterAll(async () => {
    // Only the randomly named synthetic schema inside the configured test DB.
    await testPool().query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });
  it('plans newly-created permission grants without performing writes', async () => {
    const out = run(['--dry-run']);
    expect(out).toContain('would create permission payment_hub.global.read');
    expect(out).toContain('would grant SUPER_ADMIN -> payment_hub.global.read');
    expect(out).toMatch(/would grant FACILITY_ADMIN\(\d+\) -> payment_hub.catalogue.read/);
    expect(out).not.toMatch(
      /would grant (?:SUPER_ADMIN|FACILITY_ADMIN\(\d+\)) -> payment_hub.collection.initiate/,
    );
    const db = testPool();
    expect((await db.query(`SELECT count(*)::int n FROM "${schema}".permissions`)).rows[0].n).toBe(
      0,
    );
    expect(
      (await db.query(`SELECT count(*)::int n FROM "${schema}".role_permissions`)).rows[0].n,
    ).toBe(0);
  });
  it('applies only intended grants and is idempotent on a second dry-run', async () => {
    run(['--yes']);
    const rows = await testPool().query(
      `SELECT r.name,p.code FROM "${schema}".role_permissions rp JOIN "${schema}".roles r ON r.id=rp.role_id JOIN "${schema}".permissions p ON p.id=rp.permission_id WHERE p.code LIKE 'payment_hub.%'`,
    );
    expect(rows.rows).toContainEqual({ name: 'SUPER_ADMIN', code: 'payment_hub.global.manage' });
    expect(rows.rows).toContainEqual({
      name: 'FACILITY_ADMIN',
      code: 'payment_hub.credentials.manage',
    });
    expect(rows.rows).not.toContainEqual({
      name: 'SUPER_ADMIN',
      code: 'payment_hub.credentials.manage',
    });
    expect(rows.rows).not.toContainEqual({
      name: 'FACILITY_ADMIN',
      code: 'payment_hub.collection.initiate',
    });
    expect(rows.rows).not.toContainEqual({
      name: 'SUPER_ADMIN',
      code: 'payment_hub.transfers.initiate',
    });
    expect(run(['--dry-run'])).toMatch(/Rows that would be written\s*:\s*0/);
  });
});
