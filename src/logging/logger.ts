/**
 * Structured logging
 *
 * WHAT CHANGES WITH PINO
 *
 * The application currently writes 390-odd `console.log` calls. A line like
 *
 *     2026-10-25 09:14:02  Patient found: 12345
 *
 * cannot be filtered, counted, alerted on, or joined across services. A line
 * like
 *
 *     {"level":30,"time":...,"correlationId":"...","patientRef":"hmac:9f2a",
 *      "msg":"patient.lookup","outcome":"found"}
 *
 * can. That difference is what makes "at 14:32 the billing service started
 * logging 401s" answerable from an incident instead of from memory.
 *
 * WHY REDACTION IS CENTRAL AND NOT OPTIONAL
 *
 * This is a Kenyan health information system under the Data Protection Act
 * 2019. Log files are a copy of patient data with none of the access control
 * of the database: they land in journald, in cPanel logs, in support bundles,
 * in `docker logs`, and in whatever a hosting provider keeps. A password in a
 * log line is a credential leak even if the database is encrypted, and a
 * patient name in a log line is a disclosure even if nobody reads it.
 *
 * So the redaction list below is deliberately paranoid, and it covers both
 * key names (`password`, `authorization`) and key shapes that tend to carry
 * the same content (`*.req.headers.authorization`, `err.config.headers.Authorization`).
 * `logger.test.ts` asserts that each one actually redacts, so the list cannot
 * silently rot.
 *
 * WHAT IS DELIBERATELY NOT LOGGED
 *
 * - Request bodies. A discharge summary is a request body.
 * - Query strings on patient routes. `?nationalId=...` is a request body.
 * - Patient names, national IDs, phone numbers, dates of birth.
 *
 * Where a log line genuinely needs to correlate two events about the same
 * patient, use `patientRef()` below: a keyed hash, stable per installation,
 * which correlates without being reversible by anyone who has the log.
 */

import { createHmac, randomUUID } from 'node:crypto';

import pino, { type Logger } from 'pino';

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/**
 * LOG_LEVEL: fatal | error | warn | info | debug | trace | silent.
 *
 * `silent` exists because the test suites exercise error paths on purpose —
 * a failing-payment test should not print a stack trace that looks like a
 * real incident in CI output.
 */
const level =
  process.env.LOG_LEVEL ??
  (isTest ? 'silent' : isProduction ? 'info' : 'debug');

/**
 * Every path here is redacted to `[REDACTED]`.
 *
 * Pino matches these against object keys with `*` as a single-segment
 * wildcard. Two groups matter more than the rest:
 *
 *   - credentials: password, token, secret, api key, cookie, session
 *   - patient identity: nationalId, phone, dateOfBirth, name
 *
 * The second group is why `redact` is not just a nicety here.
 */
/*
 * Keys whose value must never reach a log line, at any nesting depth.
 *
 * Enumerating `*.clientSecret` by hand is how the DHA client secret leaked
 * in the first version of this file: the real shape is
 * `dha.credentials.clientSecret`, two levels down, and a single `*` only
 * matches one. The paths are therefore generated to a fixed depth below,
 * which is both shorter to read and impossible to get half-right.
 */
const SECRET_KEYS = [
  /* Credentials */
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'apiKey',
  'secret',
  'clientSecret',
  'authorization',
  'cookie',
  'FIELD_ENCRYPTION_KEY',
  'DHA_CLIENT_SECRET',
  'SQL_ADMIN_PASSWORD',

  /* Patient identity — redacted for the same reason as credentials: a log
   * file is a copy of patient data with none of the database's access
   * control. */
  'nationalId',
  'national_id',
  'phone',
  'phoneNumber',
  'dateOfBirth',
  'dob',
  'patientName',
  'firstName',
  'lastName',
  'email',
  'shaPatientId',
] as const;

/**
 * How deep to generate. Four covers `dha.credentials.clientSecret` and the
 * `err.config.headers.authorization` shape that axios-shaped errors produce,
 * with room to spare. Deeper than this and a value is living in a structure
 * that should be flattened before it is logged anyway.
 */
const REDACT_DEPTH = 4;

function buildRedactPaths(): string[] {
  const paths = new Set<string>();

  for (const key of SECRET_KEYS) {
    paths.add(key);

    for (let depth = 1; depth <= REDACT_DEPTH; depth += 1) {
      paths.add(`${'*.'.repeat(depth)}${key}`);
    }
  }

  /* Header paths that are common enough to name explicitly, because a
   * request object is the most likely thing to be logged by accident. */
  paths.add('req.headers.authorization');
  paths.add('req.headers.cookie');
  paths.add('req.headers["x-api-key"]');
  paths.add('res.headers["set-cookie"]');
  paths.add('headers.authorization');
  paths.add('config.headers.authorization');
  paths.add('err.config.headers.authorization');

  return [...paths];
}

export const REDACT_PATHS: string[] = buildRedactPaths();

/**
 * The application logger.
 *
 * In production: newline-delimited JSON, which every log shipper parses and
 * `jq` reads.
 *
 * In development: `pino-pretty` is *not* a dependency, deliberately. It
 * would add a package (and its transitive tree) to every deployment to
 * improve a terminal that engineers can already read JSON in — or pipe
 * through `npx pino-pretty`. Development output stays JSON so that the
 * format a developer sees is the format production emits; a log statement
 * that is unreadable in production should be discovered before deployment.
 */
export const logger: Logger = pino({
  level,
  base: {
    /* The service name, so a shared log store can filter by it. */
    service: 'jalicare-hmis',
    env: process.env.NODE_ENV ?? 'development',
  },
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
    /* Remove the key entirely rather than logging [REDACTED]? No:
       seeing that a field was present is itself useful when debugging an
       auth failure, and a missing key is indistinguishable from a bug. */
    remove: false,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    /*
     * Numeric levels are correct for machines and unreadable for people.
     * 30 -> "info". Costs nothing and makes `docker logs` usable.
     */
    level: (label) => ({ level: label }),
  },
  /*
   * Errors: keep the stack, drop the fields that duplicate redacted data.
   * `err.type` and `err.code` are how a caller distinguishes "database
   * down" (ECONNREFUSED) from "wrong password" without parsing a message.
   */
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
});

/* ------------------------------------------------------------------ */
/* Child loggers                                                       */
/* ------------------------------------------------------------------ */

/**
 * A logger bound to one request or one unit of work.
 *
 * Everything logged through the child carries the correlation id, which is
 * the whole point: a request that touches billing, then inventory, then
 * audit, produces three log lines that can be joined.
 */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}

/**
 * A logger bound to a domain module.
 *
 *   const log = moduleLogger('billing');
 *   log.info({ invoiceId }, 'invoice.created');
 *
 * Preferred over importing `logger` directly, because the module name is
 * then always present and a log line never needs to be traced back to its
 * file to be understood.
 */
export function moduleLogger(module: string): Logger {
  return logger.child({ module });
}

/* ------------------------------------------------------------------ */
/* Correlation and pseudonymisation                                    */
/* ------------------------------------------------------------------ */

/**
 * A correlation id for a request or a background job.
 *
 * `randomUUID` rather than a counter: counters collide across processes,
 * which is exactly when correlation matters.
 */
export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * An HMAC of a patient id, for correlation without disclosure.
 *
 * Why not log the patient id: an internal id is still a direct link to a
 * person for anyone who can query the database, and a log file is often
 * readable by people who cannot. A keyed hash keeps the correlation
 * property — the same patient produces the same ref — while making the log
 * useless to anyone who does not also hold the key.
 *
 * Falls back to a fixed development salt when no key is configured, and
 * says so once, because a silent fallback would make two installations
 * produce the same refs for the same patient and quietly link them.
 */
let warnedAboutFallbackSalt = false;

export function patientRef(patientId: number | string): string {
  const key = process.env.LOG_PSEUDONYM_KEY ?? process.env.FIELD_ENCRYPTION_KEY;

  if (!key && !warnedAboutFallbackSalt) {
    warnedAboutFallbackSalt = true;

    logger.warn(
      'LOG_PSEUDONYM_KEY is not set; falling back to FIELD_ENCRYPTION_KEY, then to a fixed development salt. Patient references in logs will not be unique per installation.',
    );
  }

  const secret = key ?? 'jalicare-development-log-salt';

  return `hmac:${createHmac('sha256', secret).update(String(patientId)).digest('hex').slice(0, 16)}`;
}

/**
 * A correlation id extracted from an inbound request, or a fresh one.
 *
 * Honours `x-correlation-id` when the caller supplies one, so a request can
 * be followed from a proxy or another service. It is *validated* first: a
 * caller-chosen value goes into every log line for that request, so an
 * attacker who could inject newlines would be able to forge log entries.
 */
export function correlationIdFrom(header: unknown): string {
  if (typeof header === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(header)) {
    return header;
  }

  return newCorrelationId();
}
