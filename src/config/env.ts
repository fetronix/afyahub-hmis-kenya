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

export const env = Object.freeze({
  database: Object.freeze({
    host: requiredString('SQL_HOST'),
    port: requiredPort('SQL_PORT'),
    name: requiredString('SQL_DB_NAME'),
    user: requiredString('SQL_ADMIN_USER'),
    password: requiredString('SQL_ADMIN_PASSWORD'),
    ssl: false as const,
  }),
});
