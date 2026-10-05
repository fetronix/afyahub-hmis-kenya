import 'dotenv/config';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';


/* ============================================================
   DATABASE ENVIRONMENT
   ============================================================ */

const SQL_HOST = process.env.SQL_HOST;
const SQL_PORT = process.env.SQL_PORT;
const SQL_DB_NAME = process.env.SQL_DB_NAME;
const SQL_ADMIN_USER = process.env.SQL_ADMIN_USER;
const SQL_ADMIN_PASSWORD = process.env.SQL_ADMIN_PASSWORD;


/* ============================================================
   VALIDATION
   ============================================================ */

const missing: string[] = [];

if (!SQL_HOST) {
  missing.push('SQL_HOST');
}

if (!SQL_PORT) {
  missing.push('SQL_PORT');
}

if (!SQL_DB_NAME) {
  missing.push('SQL_DB_NAME');
}

if (!SQL_ADMIN_USER) {
  missing.push('SQL_ADMIN_USER');
}

if (!SQL_ADMIN_PASSWORD) {
  missing.push('SQL_ADMIN_PASSWORD');
}

if (missing.length > 0) {
  throw new Error(
    `Missing required database environment variables: ${missing.join(', ')}`,
  );
}


/* ============================================================
   POSTGRESQL CONNECTION POOL
   ============================================================ */

export const pool = new Pool({
  host: SQL_HOST,
  port: Number(SQL_PORT),
  database: SQL_DB_NAME,
  user: SQL_ADMIN_USER,
  password: SQL_ADMIN_PASSWORD,

  /*
   * Connection pool settings.
   */

  max: 10,

  idleTimeoutMillis: 30_000,

  connectionTimeoutMillis: 10_000,
});


/* ============================================================
   DRIZZLE
   ============================================================ */

export const db = drizzle(pool);