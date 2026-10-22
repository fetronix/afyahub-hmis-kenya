import { defineConfig } from 'drizzle-kit';

import { env } from './src/config/env.ts';

console.log(
  `Connecting to PostgreSQL at ${env.database.host}:${env.database.port}/${env.database.name} as ${env.database.user}`,
);

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],

  dbCredentials: {
    host: env.database.host,
    port: env.database.port,
    user: env.database.user,
    password: env.database.password,
    database: env.database.name,
    ssl: env.database.ssl,
  },

  verbose: true,
  strict: true,
});
