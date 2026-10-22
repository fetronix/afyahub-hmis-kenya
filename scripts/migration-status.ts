/**
 * JaliCare HMIS
 * Migration status — read-only.
 *
 * Answers two questions before and after you run `npm run db:migrate`:
 *
 *   1. Which migrations in drizzle/meta/_journal.json does the target
 *      database still owe?
 *   2. Do the structures that migration 0009 creates actually exist,
 *      with the shape the code depends on?
 *
 * SAFETY
 * ------
 * - Read only. It runs SELECTs against information_schema / pg_catalog
 *   and nothing else. No INSERT, no UPDATE, no DDL, no DROP.
 * - It never prints the password.
 * - Exits 0 when everything it checked is in place, 1 otherwise, so it
 *   can gate a deploy.
 *
 * USAGE
 * -----
 *   npx tsx scripts/migration-status.ts
 *   npx tsx scripts/migration-status.ts --expect-0009   (alias: --expect-all)
 *
 * REQUIRES: a .env with SQL_HOST, SQL_PORT, SQL_DB_NAME, SQL_ADMIN_USER,
 * SQL_ADMIN_PASSWORD — the same values drizzle.config.ts uses.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Pool } from 'pg';

const EXPECT_0009 =
  process.argv.includes('--expect-0009') ||
  process.argv.includes('--expect-all');

const RESET = '\u001b[0m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const DIM = '\u001b[2m';

const tick = `${GREEN}✓${RESET}`;
const cross = `${RED}✗${RESET}`;
const warn = `${YELLOW}!${RESET}`;

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface ColumnCheck {
  table: string;
  column: string;
}

interface IndexCheck {
  name: string;
  table: string;
  mustBeUnique: boolean;
  /** The idempotency index must not be partial or ON CONFLICT cannot infer it. */
  mustBeTotal: boolean;
}

interface TableCheck {
  name: string;
}

const TABLES: TableCheck[] = [
  { name: 'admission_transfers' },
  { name: 'nursing_notes' },
  { name: 'dha_api_calls' },
  { name: 'dha_service_mappings' },
];

const COLUMNS: ColumnCheck[] = [
  { table: 'billing_items', column: 'source_type' },
  { table: 'billing_items', column: 'source_id' },
  { table: 'billing_items', column: 'idempotency_key' },
  { table: 'billing_invoices', column: 'voided_at' },
  { table: 'billing_invoices', column: 'void_reason' },
  { table: 'admissions', column: 'discharged_by' },
  { table: 'admissions', column: 'discharge_disposition' },
  { table: 'patients', column: 'dha_client_registry_id' },
  { table: 'patients', column: 'dha_eligibility_status' },
  { table: 'patients', column: 'dha_eligibility_checked_at' },
  { table: 'patients', column: 'dha_eligibility_schemes' },
];

const INDEXES: IndexCheck[] = [
  {
    name: 'billing_items_idempotency_key_unique',
    table: 'billing_items',
    mustBeUnique: true,
    mustBeTotal: true,
  },
  {
    name: 'billing_items_source_idx',
    table: 'billing_items',
    mustBeUnique: false,
    mustBeTotal: false,
  },
  {
    name: 'billing_invoices_facility_status_idx',
    table: 'billing_invoices',
    mustBeUnique: false,
    mustBeTotal: false,
  },
  {
    name: 'admission_transfers_admission_idx',
    table: 'admission_transfers',
    mustBeUnique: false,
    mustBeTotal: false,
  },
  {
    name: 'nursing_notes_admission_idx',
    table: 'nursing_notes',
    mustBeUnique: false,
    mustBeTotal: false,
  },
  {
    name: 'nursing_notes_patient_idx',
    table: 'nursing_notes',
    mustBeUnique: false,
    mustBeTotal: false,
  },
  {
    name: 'dha_api_calls_facility_idx',
    table: 'dha_api_calls',
    mustBeUnique: false,
    mustBeTotal: false,
  },
  {
    name: 'dha_api_calls_operation_idx',
    table: 'dha_api_calls',
    mustBeUnique: false,
    mustBeTotal: false,
  },
  {
    /*
     * This one must be UNIQUE. The mapping screen upserts on
     * (facility_id, service_area); without the constraint ON CONFLICT
     * cannot match and every save fails.
     */
    name: 'dha_service_mappings_facility_area_idx',
    table: 'dha_service_mappings',
    mustBeUnique: true,
    mustBeTotal: true,
  },
  {
    name: 'dha_service_mappings_tenant_idx',
    table: 'dha_service_mappings',
    mustBeUnique: false,
    mustBeTotal: false,
  },
];

function readJournal(): JournalEntry[] {
  const path = resolve(process.cwd(), 'drizzle/meta/_journal.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    entries: JournalEntry[];
  };

  return parsed.entries ?? [];
}

/**
 * Drizzle records `created_at` = the journal entry's `when` for every
 * migration it applies, so the two can be matched without hashing.
 */
async function findMigrationTable(pool: Pool): Promise<string | null> {
  const { rows } = await pool.query<{ schema: string; table: string }>(
    `SELECT table_schema AS schema, table_name AS table
       FROM information_schema.tables
      WHERE table_name = '__drizzle_migrations'
      ORDER BY CASE WHEN table_schema = 'drizzle' THEN 0 ELSE 1 END`,
  );

  if (rows.length === 0) return null;

  return `"${rows[0].schema}"."${rows[0].table}"`;
}

async function reportMigrations(
  pool: Pool,
): Promise<{ pending: string[]; applied: string[] }> {
  const journal = readJournal();
  const table = await findMigrationTable(pool);

  if (!table) {
    console.log('');
    console.log(`${warn} No __drizzle_migrations table found.`);
    console.log(
      '   This database has never had a drizzle migration applied, or',
    );
    console.log(
      '   the migration user cannot see it. Running db:migrate would try',
    );
    console.log('   to apply every migration from 0000 upwards.');
    console.log('');

    return {
      pending: journal.map((entry) => entry.tag),
      applied: [],
    };
  }

  const { rows } = await pool.query<{ created_at: string }>(
    `SELECT created_at FROM ${table}`,
  );

  const appliedMillis = new Set(rows.map((row) => Number(row.created_at)));

  const applied: string[] = [];
  const pending: string[] = [];

  for (const entry of journal) {
    if (appliedMillis.has(Number(entry.when))) {
      applied.push(entry.tag);
    } else {
      pending.push(entry.tag);
    }
  }

  console.log('');
  console.log(`${DIM}journal: ${journal.length} migrations, tracking table: ${table}${RESET}`);
  console.log('');

  for (const tag of applied) {
    console.log(`  ${tick} ${tag}`);
  }

  for (const tag of pending) {
    console.log(`  ${warn} ${tag}  ${YELLOW}PENDING${RESET}`);
  }

  if (pending.length === 0) {
    console.log('');
    console.log(`${GREEN}All migrations in the journal are applied.${RESET}`);
  } else {
    console.log('');
    console.log(
      `${YELLOW}${pending.length} migration(s) pending: ${pending.join(', ')}${RESET}`,
    );
  }

  return { pending, applied };
}

async function reportStructures(pool: Pool): Promise<{ failures: string[] }> {
  const failures: string[] = [];

  console.log('');
  console.log('Structures required by migrations 0009, 0012 and 0013');
  console.log('----------------------------------------------');

  /* Tables */
  const { rows: tableRows } = await pool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [TABLES.map((table) => table.name)],
  );

  const presentTables = new Set(tableRows.map((row) => row.table_name));

  for (const table of TABLES) {
    if (presentTables.has(table.name)) {
      console.log(`  ${tick} table ${table.name}`);
    } else {
      console.log(`  ${cross} table ${table.name} ${RED}MISSING${RESET}`);
      failures.push(`table ${table.name}`);
    }
  }

  /* Sequence */
  const { rows: sequenceRows } = await pool.query<{ sequence_name: string }>(
    `SELECT sequence_name
       FROM information_schema.sequences
      WHERE sequence_schema = 'public'
        AND sequence_name = 'billing_invoice_number_seq'`,
  );

  if (sequenceRows.length > 0) {
    console.log(`  ${tick} sequence billing_invoice_number_seq`);
  } else {
    console.log(
      `  ${cross} sequence billing_invoice_number_seq ${RED}MISSING${RESET}`,
    );
    failures.push('sequence billing_invoice_number_seq');
  }

  /* Columns */
  const { rows: columnRows } = await pool.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (
          ${COLUMNS.map((_, index) => `($${index * 2 + 1}::text, $${index * 2 + 2}::text)`).join(', ')}
        )`,
    COLUMNS.flatMap((column) => [column.table, column.column]),
  );

  const presentColumns = new Set(
    columnRows.map((row) => `${row.table_name}.${row.column_name}`),
  );

  for (const column of COLUMNS) {
    const key = `${column.table}.${column.column}`;

    if (presentColumns.has(key)) {
      console.log(`  ${tick} column ${key}`);
    } else {
      console.log(`  ${cross} column ${key} ${RED}MISSING${RESET}`);
      failures.push(`column ${key}`);
    }
  }

  /* Indexes — check uniqueness and, for the idempotency index, totality. */
  const { rows: indexRows } = await pool.query<{
    indexname: string;
    tablename: string;
    is_unique: boolean;
    is_partial: boolean;
  }>(
    `SELECT c.relname AS indexname,
            t.relname AS tablename,
            i.indisunique AS is_unique,
            i.indpred IS NOT NULL AS is_partial
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])`,
    [INDEXES.map((index) => index.name)],
  );

  const indexByName = new Map(indexRows.map((row) => [row.indexname, row]));

  for (const index of INDEXES) {
    const found = indexByName.get(index.name);

    if (!found) {
      console.log(`  ${cross} index ${index.name} ${RED}MISSING${RESET}`);
      failures.push(`index ${index.name}`);
      continue;
    }

    const problems: string[] = [];

    if (index.mustBeUnique && !found.is_unique) {
      problems.push('should be UNIQUE but is not');
    }

    if (index.mustBeTotal && found.is_partial) {
      problems.push(
        'is a PARTIAL index — ON CONFLICT cannot infer it, every dispense will fail',
      );
    }

    if (problems.length === 0) {
      const kind = found.is_unique ? 'unique' : 'index';
      console.log(`  ${tick} ${kind} ${index.name} on ${found.tablename}`);
    } else {
      console.log(`  ${cross} index ${index.name} ${RED}${problems.join('; ')}${RESET}`);
      failures.push(`index ${index.name} (${problems.join('; ')})`);
    }
  }

  return { failures };
}

async function main(): Promise<void> {
  console.log('');
  console.log('==============================================');
  console.log('Migration status (read-only)');
  console.log('==============================================');

  let pool: Pool;

  try {
    const [{ pool: createdPool }, { env }] = await Promise.all([
      import('../src/db/index.ts'),
      import('../src/config/env.ts'),
    ]);

    pool = createdPool;

    console.log(
      `Target: ${env.database.user}@${env.database.host}:${env.database.port}/${env.database.name}`,
    );
  } catch (error) {
    console.log('');
    console.log(`${RED}Cannot read the database configuration.${RESET}`);
    console.log('');
    console.log('drizzle.config.ts and this script both read these .env keys:');
    console.log('  SQL_HOST  SQL_PORT  SQL_DB_NAME  SQL_ADMIN_USER  SQL_ADMIN_PASSWORD');
    console.log('');
    console.log(
      `Reason: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.log('');
    process.exitCode = 1;
    return;
  }

  try {
    const { pending } = await reportMigrations(pool);
    const { failures } = await reportStructures(pool);

    const unresolved0009 =
      pending.some((tag) => tag.startsWith('0009')) || failures.length > 0;

    console.log('');
    console.log('==============================================');

    if (pending.length === 0 && failures.length === 0) {
      console.log(`${GREEN}READY — every migration is applied and 0009 is intact.${RESET}`);
      console.log('==============================================');
      console.log('');
      return;
    }

    if (unresolved0009 && EXPECT_0009) {
      console.log(`${RED}NOT READY — migration 0009 is incomplete.${RESET}`);

      if (failures.length > 0) {
        console.log('');
        console.log('Missing or wrong structures:');
        for (const failure of failures) {
          console.log(`  - ${failure}`);
        }
      }

      console.log('==============================================');
      console.log('');
      process.exitCode = 1;
      return;
    }

    console.log(`${YELLOW}Pending work shown above.${RESET}`);
    console.log('==============================================');
    console.log('');
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';

    console.log('');
    console.log(`${RED}Could not inspect the database.${RESET}`);
    console.log('');
    console.log(
      `Reason: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    );

    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
      console.log('');
      console.log('Is PostgreSQL running, and is it listening on that host and port?');
      console.log('On Truehost the host is always localhost and the port 5432.');
    }

    if (code === '28P01') {
      console.log('');
      console.log('The database rejected the SQL_ADMIN_USER / SQL_ADMIN_PASSWORD pair.');
    }

    if (code === '3D000') {
      console.log('');
      console.log('That database does not exist. Create it in cPanel first.');
    }

    console.log('');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('');
  console.error(`${RED}Migration status check failed.${RESET}`);
  console.error(error);
  process.exit(1);
});
