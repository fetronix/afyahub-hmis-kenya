
import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

const sqlHost = process.env.SQL_HOST || "localhost";
const sqlPort = Number(process.env.SQL_PORT || 5432);
const sqlDbName = process.env.SQL_DB_NAME || "jalicaredb";
const user = process.env.SQL_ADMIN_USER || "postgres";
const password = process.env.SQL_ADMIN_PASSWORD;

if (!password) {
  throw new Error(
    "SQL_ADMIN_PASSWORD must be set in your .env file."
  );
}

console.log(
  `Connecting to PostgreSQL at ${sqlHost}:${sqlPort}/${sqlDbName} as ${user}`
);

export default defineConfig({
  schema: "./src/db/schema.ts",

  // Drizzle migration files
  out: "./drizzle",

  // PostgreSQL
  dialect: "postgresql",

  // Only use the public PostgreSQL schema
  schemaFilter: ["public"],

  // Local PostgreSQL connection
  dbCredentials: {
    host: sqlHost,
    port: sqlPort,
    user,
    password,
    database: sqlDbName,
    ssl: false,
  },

  // Show detailed information when running Drizzle commands
  verbose: true,

  // Fail on warnings that could cause unexpected schema changes
  strict: true,
});
