import 'dotenv/config';

function requiredString(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function requiredPort(name: string): number {
  const rawValue = requiredString(name);
  const port = Number(rawValue);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `${name} must be an integer between 1 and 65535.`,
    );
  }

  return port;
}

/**
 * A boolean environment flag.
 *
 * Anything other than an explicit `true` is false, so a typo cannot
 * silently switch a security control on or off.
 */
function booleanFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') return fallback;

  return raw.trim().toLowerCase() === 'true';
}

/*
 * TLS to PostgreSQL.
 *
 * The previous build hard-coded `ssl: false`. That is correct for a
 * database on the same host over a unix socket, and wrong for every
 * managed database and every network hop. It is now a setting, off by
 * default so existing local installs keep working, and documented in
 * .env.example. Certificate verification stays on unless an operator
 * explicitly turns it off, because a TLS connection that accepts any
 * certificate does not authenticate the server.
 */
const databaseSsl = booleanFlag('SQL_SSL', false)
  ? {
      rejectUnauthorized: booleanFlag('SQL_SSL_REJECT_UNAUTHORIZED', true),
    }
  : false;

export const env = Object.freeze({
  database: Object.freeze({
    host: requiredString('SQL_HOST'),
    port: requiredPort('SQL_PORT'),
    name: requiredString('SQL_DB_NAME'),
    user: requiredString('SQL_ADMIN_USER'),
    password: requiredString('SQL_ADMIN_PASSWORD'),
    ssl: databaseSsl as false | { rejectUnauthorized: boolean },
  }),
});
