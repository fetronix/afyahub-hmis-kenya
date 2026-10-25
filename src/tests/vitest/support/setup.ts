/**
 * Vitest setup — node environment
 *
 * Supplies the environment the server modules require at import time.
 *
 * `src/config/env.ts` validates on import and throws when `SQL_HOST` is
 * absent. That is correct for the application (a server with no database
 * configuration must not start quietly) but it means a unit test that
 * imports any module reaching `db/index.ts` cannot run without it.
 *
 * These are obviously-fake values. They are never used to connect
 * anywhere: the only specs that talk to PostgreSQL are the *.db.spec.ts
 * ones, and they read the real connection from the same variables and skip
 * when unreachable. Nothing here is a credential for anything real.
 */

process.env.NODE_ENV ??= 'test';

process.env.SQL_HOST ??= '127.0.0.1';
process.env.SQL_PORT ??= '5432';
process.env.SQL_DB_NAME ??= 'jalicare_test';
process.env.SQL_ADMIN_USER ??= 'jalicare_test';
process.env.SQL_ADMIN_PASSWORD ??= 'jalicare_test';
process.env.SQL_SSL ??= 'false';
process.env.SQL_SSL_REJECT_UNAUTHORIZED ??= 'true';

process.env.TRUST_PROXY ??= 'false';
process.env.DEFAULT_TIMEZONE ??= 'Africa/Nairobi';
process.env.TZ ??= 'Africa/Nairobi';
process.env.APP_BASE_URL ??= 'http://localhost:3000';

/* DHA stays in mock mode: no test may reach a real registry. */
process.env.DHA_MODE ??= 'mock';
process.env.DHA_ALLOW_PRODUCTION = 'false';

/*
 * A deterministic encryption key for the field-crypto tests. 32 bytes,
 * base64. Generated for tests only and useless anywhere else — a real key
 * must never appear in the repository.
 */
process.env.FIELD_ENCRYPTION_KEY ??=
  'dGVzdC1vbmx5LWtleS1ub3QtZm9yLXByb2R1Y3Rpb24tMDAwMDA=';
