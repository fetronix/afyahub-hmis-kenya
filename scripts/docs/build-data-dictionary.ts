/**
 * Build the database inventory the data dictionary is written from.
 *
 * The source of truth is the migrated schema, not the Drizzle definitions in
 * `src/db/schema/`: the question a data dictionary answers is what columns,
 * constraints and indexes actually exist in a database built by
 * `npm run db:migrate`. The migration that introduced each table is recovered
 * from `drizzle/*.sql`, so every table can be traced to a numbered change.
 *
 *   set -a && . .tmp-tools/docs.env && set +a
 *   npx tsx scripts/docs/build-data-dictionary.ts
 *
 * Outputs:
 *   docs/evidence/DATABASE_SCHEMA_INVENTORY.json
 *   docs/06-technical/DATABASE_SCHEMA_APPENDIX.md
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

process.env.NODE_ENV = 'test';

const ROOT = resolve(import.meta.dirname, '..', '..');
const EVIDENCE = join(ROOT, 'docs', 'evidence', 'DATABASE_SCHEMA_INVENTORY.json');
const APPENDIX = join(ROOT, 'docs', '06-technical', 'DATABASE_SCHEMA_APPENDIX.md');

interface Column {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  maxLength: number | null;
}

interface Table {
  name: string;
  /** `BASE TABLE` or `VIEW`, as reported by information_schema. */
  kind: string;
  columns: Column[];
  primaryKey: string[];
  foreignKeys: { columns: string[]; references: string }[];
  unique: string[][];
  indexes: { name: string; definition: string }[];
  scopes: { tenant: boolean; facility: boolean };
  migration: string | null;
  columnCount: number;
}

const pool = new pg.Pool({
  host: process.env.SQL_HOST,
  port: Number(process.env.SQL_PORT ?? 5432),
  database: process.env.SQL_DB_NAME,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD,
  ssl: process.env.SQL_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 2,
});

const migrationFor = new Map<string, string>();
const migrations = readdirSync(join(ROOT, 'drizzle'))
  .filter((file) => file.endsWith('.sql'))
  .sort();
for (const file of migrations) {
  const sql = readFileSync(join(ROOT, 'drizzle', file), 'utf8');
  for (const match of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?([a-z0-9_]+)"?/gi)) {
    if (!migrationFor.has(match[1])) migrationFor.set(match[1], file);
  }
}
for (const file of migrations) {
  const sql = readFileSync(join(ROOT, 'drizzle', file), 'utf8');
  for (const match of sql.matchAll(/ALTER TABLE (?:ONLY )?"?([a-z0-9_]+)"?/gi)) {
    if (!migrationFor.has(match[1])) migrationFor.set(match[1], file);
  }
}

const { rows: columnRows } = await pool.query<{
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
  character_maximum_length: number | null;
}>(`
  SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default,
         character_maximum_length
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position
`);

const { rows: constraintRows } = await pool.query<{
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  column_name: string | null;
  ref_table: string | null;
  ref_column: string | null;
}>(`
  SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
         kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
  FROM information_schema.table_constraints tc
  LEFT JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  LEFT JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')
  ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
`);

const { rows: kindRows } = await pool.query<{ table_name: string; table_type: string }>(
  `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public'`,
);
const kindFor = new Map(kindRows.map((row) => [row.table_name, row.table_type]));

const { rows: indexRows } = await pool.query<{
  tablename: string;
  indexname: string;
  indexdef: string;
}>(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`);

const tables = new Map<string, Table>();
const ensure = (name: string) => {
  if (!tables.has(name)) {
    tables.set(name, {
      name,
      kind: 'BASE TABLE',
      columns: [],
      primaryKey: [],
      foreignKeys: [],
      unique: [],
      indexes: [],
      scopes: { tenant: false, facility: false },
      migration: migrationFor.get(name) ?? null,
      columnCount: 0,
    });
  }
  return tables.get(name)!;
};

for (const row of columnRows) {
  const table = ensure(row.table_name);
  const type =
    row.data_type === 'character varying' && row.character_maximum_length
      ? `varchar(${row.character_maximum_length})`
      : row.data_type === 'USER-DEFINED'
        ? row.udt_name
        : row.data_type;
  table.columns.push({
    name: row.column_name,
    type,
    nullable: row.is_nullable === 'YES',
    default: row.column_default,
    maxLength: row.character_maximum_length,
  });
}

for (const table of tables.values()) {
  table.kind = kindFor.get(table.name) ?? 'BASE TABLE';
  table.columnCount = table.columns.length;
  const names = new Set(table.columns.map((column) => column.name));
  table.scopes = { tenant: names.has('tenant_id'), facility: names.has('facility_id') };
}

const grouped = new Map<string, typeof constraintRows>();
for (const row of constraintRows) {
  if (!grouped.has(row.constraint_name)) grouped.set(row.constraint_name, []);
  grouped.get(row.constraint_name)!.push(row);
}

for (const rows of grouped.values()) {
  const first = rows[0];
  const table = tables.get(first.table_name);
  if (!table) continue;
  const columns = rows.map((row) => row.column_name).filter((name): name is string => !!name);
  if (first.constraint_type === 'PRIMARY KEY') table.primaryKey = columns;
  if (first.constraint_type === 'UNIQUE') table.unique.push(columns);
  if (first.constraint_type === 'FOREIGN KEY') {
    const refs = [
      ...new Set(
        rows
          .filter((row) => row.ref_table)
          .map((row) => `${row.ref_table}.${row.ref_column}`),
      ),
    ];
    table.foreignKeys.push({ columns, references: refs.join(', ') });
  }
}

for (const row of indexRows) {
  const table = tables.get(row.tablename);
  if (!table) continue;
  table.indexes.push({ name: row.indexname, definition: row.indexdef });
}

const list = [...tables.values()].sort((a, b) => a.name.localeCompare(b.name));

const payload = {
  generatedAt: new Date().toISOString(),
  generatedBy: 'scripts/docs/build-data-dictionary.ts',
  source: {
    database: 'synthetic local PostgreSQL 16 database migrated with npm run db:migrate',
    migrations: `drizzle/*.sql (${migrations.length} files)`,
  },
  totals: {
    tables: list.filter((table) => table.kind === 'BASE TABLE').length,
    views: list.filter((table) => table.kind === 'VIEW').length,
    relations: list.length,
    columns: list.reduce((sum, table) => sum + table.columnCount, 0),
    foreignKeys: list.reduce((sum, table) => sum + table.foreignKeys.length, 0),
    indexes: list.reduce((sum, table) => sum + table.indexes.length, 0),
    tenantScoped: list.filter((table) => table.scopes.tenant).length,
    facilityScoped: list.filter((table) => table.scopes.facility).length,
    withoutMigration: list.filter((table) => !table.migration).length,
  },
  tables: list,
};

writeFileSync(EVIDENCE, `${JSON.stringify(payload, null, 1)}\n`);

/* Machine-generated appendix: one row per column, so the document never drifts
 * from the schema without regenerating. */
const md: string[] = [];
md.push('# Database schema appendix');
md.push('');
md.push(
  '> Generated by `scripts/docs/build-data-dictionary.ts` from a database built by ' +
    '`npm run db:migrate`. Do not edit by hand: regenerate instead. Column types are the ' +
    'PostgreSQL types as installed, not the Drizzle declarations.',
);
md.push('');
md.push(`Generated: ${payload.generatedAt.slice(0, 10)}`);
md.push('');
md.push(
  `Tables: **${payload.totals.tables}** · Views: **${payload.totals.views}** · ` +
    `Columns: **${payload.totals.columns}** · Foreign keys: **${payload.totals.foreignKeys}** · ` +
    `Indexes: **${payload.totals.indexes}**`,
);
md.push('');
md.push('## Contents');
md.push('');
for (const table of list) {
  md.push(`- [${table.name}](#${table.name.replace(/_/g, '_')}) — ${table.columnCount} columns`);
}
md.push('');
for (const table of list) {
  const scope = [table.scopes.tenant && 'tenant', table.scopes.facility && 'facility']
    .filter(Boolean)
    .join(' + ');
  md.push(`## ${table.name}`);
  md.push('');
  md.push(`Kind: ${table.kind}`);
  md.push('');
  md.push(
    `Rows scoped by: ${scope || 'no tenant/facility column'} · Introduced by: ` +
      `${table.migration ? `\`drizzle/${table.migration}\`` : 'not found in migration files'} · ` +
      `Primary key: ${table.primaryKey.length ? table.primaryKey.map((c) => `\`${c}\``).join(', ') : 'none'}`,
  );
  md.push('');
  md.push('| Column | Type | Null | Default |');
  md.push('| --- | --- | --- | --- |');
  for (const column of table.columns) {
    const defaultValue = column.default ? `\`${column.default}\`` : '';
    md.push(
      `| \`${column.name}\` | ${column.type} | ${column.nullable ? 'yes' : 'no'} | ${defaultValue} |`,
    );
  }
  md.push('');
  if (table.foreignKeys.length) {
    md.push('Foreign keys:');
    md.push('');
    for (const foreignKey of table.foreignKeys) {
      md.push(
        `- \`${foreignKey.columns.join(', ')}\` → \`${foreignKey.references}\``,
      );
    }
    md.push('');
  }
  if (table.unique.length) {
    md.push(
      `Unique constraints: ${table.unique.map((columns) => columns.map((c) => `\`${c}\``).join(' + ')).join('; ')}`,
    );
    md.push('');
  }
  const indexes = table.indexes.filter(
    (index) => !index.definition.includes('UNIQUE') && !index.definition.includes('PRIMARY'),
  );
  if (indexes.length) {
    md.push('Indexes:');
    md.push('');
    for (const index of indexes) {
      md.push(`- \`${index.name}\` — \`${index.definition.replace(/^CREATE /, '')}\``);
    }
    md.push('');
  }
}

writeFileSync(APPENDIX, `${md.join('\n')}\n`);

console.info('Database inventory', payload.totals);
await pool.end();
process.exit(0);
