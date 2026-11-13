/**
 * JaliCare HMIS — the two backup engines.
 *
 * See `backup-lib.mjs` for why there are two. In short: `pgdump` is the
 * production answer and needs the PostgreSQL client tools; `logical` is the
 * fallback for hosts that have only the server, and restores data onto a
 * schema that the repository already knows how to build.
 */
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { Pool } from 'pg';

const TOOL_NAMES = ['pg_dump', 'pg_restore'];

/**
 * Locate the PostgreSQL client tools without assuming a PATH layout.
 *
 * `PGBIN` is honoured first because that is how the deployment host and the
 * test sandbox both point at a specific installation. Returns null for a tool
 * that is genuinely absent — the caller decides whether that is fatal, because
 * "no pg_dump" is fatal for a production backup and merely informative when
 * the logical engine is being used deliberately.
 */
export async function findTools(env = process.env) {
  const candidates = [];
  if (env.PGBIN) candidates.push(env.PGBIN);
  candidates.push('');

  const found = {};
  for (const tool of TOOL_NAMES) {
    found[tool] = null;
    for (const dir of candidates) {
      const path = dir ? join(dir, tool) : tool;
      const resolvedPath = dir ? path : await which(tool);
      if (!resolvedPath) continue;
      try {
        await access(resolvedPath);
        found[tool] = resolvedPath;
        break;
      } catch {
        /* try the next candidate */
      }
    }
  }
  return found;
}

async function which(tool) {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue;
    const candidate = join(dir, tool);
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function connectionArgs(config) {
  return [
    '-h',
    config.host,
    '-p',
    String(config.port),
    '-U',
    config.user,
    '--no-password',
    config.database,
  ];
}

/** Run a child process, feeding `stdin` if given, returning stdout as a Buffer. */
function run(command, args, { env, stdin } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...(env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      const stderr = Buffer.concat(err).toString('utf8');
      if (code !== 0) {
        /* Never echo the password: it is not in argv, but scrub anyway. */
        reject(new Error(`${command} exited ${code}: ${stderr.replace(/password=\S+/gi, '')}`));
        return;
      }
      resolvePromise({ stdout: Buffer.concat(out), stderr });
    });
    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

/** PGPASSWORD is used rather than a URL so the secret never appears in argv. */
function pgEnv(config) {
  return config.password ? { PGPASSWORD: config.password } : {};
}

/* ------------------------------------------------------------ pg_dump engine */

export async function dumpWithPgDump(config, tools = {}) {
  const pgDump = tools.pg_dump ?? (await findTools()).pg_dump;
  if (!pgDump)
    throw new Error(
      'pg_dump not found. Set PGBIN to the PostgreSQL bin directory, or run with --engine logical.',
    );
  const { stdout } = await run(
    pgDump,
    ['--format=custom', '--compress=6', '--no-owner', '--no-privileges', ...connectionArgs(config)],
    { env: pgEnv(config) },
  );
  return { payload: stdout, engine: 'pgdump', schemaIncluded: true };
}

export async function restoreWithPgRestore(config, payload, tools = {}) {
  const pgRestore = tools.pg_restore ?? (await findTools()).pg_restore;
  if (!pgRestore)
    throw new Error('pg_restore not found. Set PGBIN to the PostgreSQL bin directory.');
  await run(
    pgRestore,
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '-d',
      config.database,
      '-h',
      config.host,
      '-p',
      String(config.port),
      '-U',
      config.user,
      '--no-password',
    ],
    { env: pgEnv(config), stdin: payload },
  );
  return { restored: true };
}

/* ------------------------------------------------------------ logical engine */

/**
 * Types the driver would otherwise round-trip lossily. Read as text and let
 * PostgreSQL parse them back on insert.
 */
const TEXT_PRESERVED_TYPES = new Set([
  'timestamp with time zone',
  'timestamp without time zone',
  'date',
  'time with time zone',
  'time without time zone',
  'interval',
]);

function poolFor(config) {
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
    max: 4,
    connectionTimeoutMillis: 10_000,
  });
}

async function listTables(client) {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
}

async function listColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows;
}

/**
 * Capture every row of every table, plus sequence positions.
 *
 * Sequence positions matter: without them a restored serial column restarts at
 * 1 and the next insert collides with existing data — a restore that appears to
 * succeed and then breaks on first use.
 */
export async function dumpLogical(config) {
  const pool = poolFor(config);
  try {
    const client = await pool.connect();
    try {
      const tables = await listTables(client);
      const captured = [];
      for (const table of tables) {
        const columns = await listColumns(client, table);
        /*
         * Temporal and interval values are read as text, not as driver types.
         *
         * PostgreSQL timestamps carry microseconds; a JavaScript Date carries
         * milliseconds, so reading them as Date and writing them back silently
         * shaves the last three digits off every timestamp. That is a real loss
         * of fidelity in a backup, and it is invisible unless you compare the
         * restored rows — which the drill does. Text keeps the value exactly.
         */
        const selectList = columns
          .map((column) =>
            TEXT_PRESERVED_TYPES.has(column.data_type)
              ? `"${column.column_name}"::text AS "${column.column_name}"`
              : `"${column.column_name}"`,
          )
          .join(', ');
        /* Quoted identifiers: names come from the catalogue, never from a user. */
        const { rows } = await client.query(`SELECT ${selectList} FROM "${table}"`);
        captured.push({ table, columns, rows });
      }

      const sequences = await client
        .query(
          `SELECT sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`,
        )
        .then((result) => result.rows)
        .catch(() => []);

      const migrationCount = await client
        .query('SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations')
        .then((result) => result.rows[0]?.n ?? null)
        .catch(() => null);

      const archive = {
        engine: 'logical',
        capturedAt: new Date().toISOString(),
        migrationCount,
        tables: captured,
        sequences,
      };
      return {
        payload: Buffer.from(JSON.stringify(archive), 'utf8'),
        engine: 'logical',
        schemaIncluded: false,
      };
    } finally {
      client.release();
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/**
 * Load a logical archive into an existing schema.
 *
 * Foreign keys make insertion order matter. `session_replication_role = replica`
 * suspends FK triggers outright, which is the fastest correct answer when the
 * restoring role may set it. When it may not, tables are inserted in dependency
 * order instead; a cycle that defeats that is reported rather than half-loaded,
 * because a partially restored database is worse than a refused one.
 */
export async function restoreLogical(config, payload) {
  const archive = JSON.parse(payload.toString('utf8'));
  if (archive.engine !== 'logical') throw new Error('Not a logical archive.');

  const pool = poolFor(config);
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = new Set(await listTables(client));
      const missing = archive.tables.filter((entry) => !existing.has(entry.table));
      if (missing.length > 0)
        throw new Error(
          `Target schema is missing ${missing.length} table(s) the archive contains (first: "${missing[0].table}"). ` +
            'Run the migrations for the recorded version before restoring.',
        );

      /*
       * Empty the target before loading, but only the tables that hold anything.
       *
       * Two reasons. A fresh restore target is already empty, so truncating it
       * is pointless work. More importantly, this schema protects `audit_logs`
       * with a BEFORE TRUNCATE trigger: an audit log that can be wiped in place
       * is not an audit log. Skipping empty tables means a restore into a clean
       * database simply works, while a restore over a database that already has
       * audit history is refused rather than silently disabling the control.
       */
      const occupied = [];
      for (const entry of archive.tables) {
        const { rows } = await client.query(
          `SELECT EXISTS (SELECT 1 FROM "${entry.table}") AS any`,
        );
        if (rows[0].any) occupied.push(`"${entry.table}"`);
      }
      if (occupied.length > 0) {
        try {
          /* One statement: TRUNCATE must see every table at once when foreign
             keys are involved. */
          await client.query(`TRUNCATE ${occupied.join(', ')} CASCADE`);
        } catch (error) {
          throw new Error(
            `The target database is not empty and could not be cleared (${error.message}). ` +
              'Restore into a freshly created database instead of over live data: ' +
              'an in-place restore cannot clear append-only tables such as the audit log.',
          );
        }
      }

      let replicaMode = false;
      try {
        await client.query("SET LOCAL session_replication_role = 'replica'");
        replicaMode = true;
      } catch {
        replicaMode = false;
      }

      const order = replicaMode ? archive.tables : orderByDependencies(archive.tables);

      for (const entry of order) {
        if (entry.rows.length === 0) continue;
        const columns = entry.columns.map((column) => column.column_name);
        const columnList = columns.map((column) => `"${column}"`).join(', ');
        /*
         * The driver turns a JS array into a Postgres array literal (`{a,b}`),
         * which is right for an array column and wrong for a `json` one that
         * happens to hold a JSON array. Serialise by declared type instead of
         * by the shape of whatever came back.
         */
        const jsonColumns = new Set(
          entry.columns
            .filter((column) => column.data_type === 'json' || column.data_type === 'jsonb')
            .map((column) => column.column_name),
        );
        /* Chunked so a wide table cannot exceed the parameter limit. */
        const chunkSize = Math.max(1, Math.floor(30_000 / Math.max(1, columns.length)));
        for (let offset = 0; offset < entry.rows.length; offset += chunkSize) {
          const chunk = entry.rows.slice(offset, offset + chunkSize);
          const values = [];
          const placeholders = chunk.map((row) => {
            const slots = columns.map((column) => {
              const value = row[column];
              values.push(
                jsonColumns.has(column) && value !== null && typeof value !== 'string'
                  ? JSON.stringify(value)
                  : value,
              );
              return `$${values.length}`;
            });
            return `(${slots.join(', ')})`;
          });
          await client.query(
            `INSERT INTO "${entry.table}" (${columnList}) VALUES ${placeholders.join(', ')}`,
            values,
          );
        }
      }

      if (replicaMode) await client.query('SET LOCAL session_replication_role = origin');

      for (const sequence of archive.sequences) {
        if (sequence.last_value === null) continue;
        await client
          .query('SELECT setval($1::regclass, $2, true)', [
            `"${sequence.sequencename}"`,
            sequence.last_value,
          ])
          .catch(() => undefined);
      }

      await client.query('COMMIT');
      return { restored: true, engine: 'logical', tables: archive.tables.length };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Cheap dependency ordering: tables referenced by nothing first. */
function orderByDependencies(tables) {
  const byName = new Map(tables.map((entry) => [entry.table, entry]));
  return [...tables].sort((a, b) => {
    const aRefs = referencesIn(a, byName);
    const bRefs = referencesIn(b, byName);
    return aRefs - bRefs;
  });
}

function referencesIn(entry, byName) {
  return entry.columns.filter((column) => byName.has(`${column.column_name}_id`)).length;
}

/* ------------------------------------------------------------------- probe */

/** Row counts per table, used to prove a restore actually carried the data. */
export async function tableFingerprint(config) {
  const pool = poolFor(config);
  try {
    const client = await pool.connect();
    try {
      const tables = await listTables(client);
      const fingerprint = {};
      for (const table of tables) {
        const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
        fingerprint[table] = rows[0].n;
      }
      return fingerprint;
    } finally {
      client.release();
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function databaseExists(config) {
  const admin = { ...config, database: 'postgres' };
  const pool = poolFor(admin);
  try {
    const { rows } = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      config.database,
    ]);
    return rows.length > 0;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function createDatabase(config) {
  const admin = { ...config, database: 'postgres' };
  const pool = poolFor(admin);
  try {
    await pool.query(`CREATE DATABASE "${config.database}"`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function dropDatabase(config) {
  const admin = { ...config, database: 'postgres' };
  const pool = poolFor(admin);
  try {
    await pool.query(`DROP DATABASE IF EXISTS "${config.database}" WITH (FORCE)`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}
