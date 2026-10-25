import { createHash } from 'node:crypto';
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
 * An encryption key for the field-crypto tests, derived at run time.
 *
 * It is deliberately NOT a literal. A committed 32-byte base64 string is
 * indistinguishable from a real key to any secret scanner, so storing even a
 * fake one makes every future scan of this repository a false positive that
 * has to be explained and waived. Deriving it means the repository contains
 * no key-shaped string at all, and the value is still stable across runs
 * (which the field-crypto tests need: ciphertext written by one test must be
 * readable by the next).
 */
const TEST_ONLY_KEY_MATERIAL = 'jalicare-test-only-field-encryption-key';

process.env.FIELD_ENCRYPTION_KEY ??= createHash('sha256')
  .update(TEST_ONLY_KEY_MATERIAL)
  .digest('base64');
