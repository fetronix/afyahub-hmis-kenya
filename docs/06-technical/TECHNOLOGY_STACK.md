# Technology stack

| Field | Value |
| --- | --- |
| Document | TECHNOLOGY_STACK |
| Version | 1.0 |
| Last reviewed | 2026-11-18 |
| Applies to | JaliCare HMIS 0.1.0, commit `9d7274c` |
| Audience | Engineers, architects, security reviewers |
| Status | Verified against `package.json`, `tsconfig.json`, `vite.config.ts` and CI |

## Runtime and platform

| Concern | Choice | Version constraint | Evidence |
| --- | --- | --- | --- |
| JavaScript runtime | Node.js | `^20.19.0 \|\| >=22.12.0` | `package.json` `engines`; CI uses Node 22 |
| Language | TypeScript (strict, bundler resolution) | `^7.0.2` | `package.json`, `tsconfig.json` |
| Database | PostgreSQL | 16 | Drizzle SQL and CI `postgres:16` service |
| Module system | ES modules with `.ts` import specifiers; `tsx` runs source directly in development | — | `package.json` scripts, `server.ts` |

Node 20.19+ is required because the server imports TypeScript directly in development and uses
modern `import.meta` behaviour; Node 22 is the tested target.

## Server

| Library | Purpose | Version |
| --- | --- | --- |
| Express | HTTP framework and router | `^4.21.2` |
| Drizzle ORM | Typed query builder and schema definition | `^0.45.3` |
| `pg` | PostgreSQL driver and pool | `^8.23.1` |
| zod | Request validation and schema typing | `^4.6.7` |
| pino | Structured JSON logging with redaction | `^10.4.0` |
| argon2 | Password hashing (argon2id) | `^0.45.1` |
| helmet | Security headers | `^8.3.0` |
| express-rate-limit | Login and API rate limiting | `^7.5.1` |
| pdfkit | Server-side PDF rendering (documents, receipts, reports) | `^0.20.2` |
| dotenv | Environment loading for scripts and development | `^17.2.3` |
| drizzle-kit | Migration generation and tooling | `^0.31.11` (dev) |

## Client

| Library | Purpose | Version |
| --- | --- | --- |
| React | UI runtime | `^19.0.1` |
| React DOM | Rendering | `^19.0.1` |
| Vite | Development server and production bundler | `^8.3.5` |
| Tailwind CSS | Utility-first styling | `^4.3.3` |
| lucide-react | Icon set | `^0.546.0` |

The client is a single-page application with hand-rolled state and routing: there is no React
Router, Redux, React Query or component library dependency. Navigation is a module identifier held
in `HmisContext`, and each module is a component under `src/components/modules/`.

## Testing and quality

| Tool | Purpose | Version |
| --- | --- | --- |
| Vitest | Unit, integration and database-backed test runner | `^5.0.5` |
| ESLint | Static analysis | `^9.39.5` |
| Prettier | Formatting | declared in `devDependencies` |
| `tsc --noEmit` | Type check | TypeScript compiler |

CI (`.github/workflows/ci.yml`) runs static analysis, the full test suite with coverage thresholds, a
clean-checkout bootstrap, migrations against PostgreSQL 16, the client and server builds, `npm audit`
for high and critical advisories, and a Prettier check.

## What is deliberately absent

| Not used | Consequence |
| --- | --- |
| ORM migrations at boot | Schema changes are explicit release steps (`npm run db:migrate`). |
| A client-side router library | Deep links are handled by the module switch and browser history; there are no nested URL routes per screen. |
| A cache tier (Redis) | Sessions and rate-limit state live in PostgreSQL or process memory; multi-instance deployment would need shared state. |
| A job queue | Long-running work happens inside requests or in external cron commands. |
| Containerisation in production | The reference deployment is cPanel/Passenger or a plain Node service behind nginx. |

## Limitations

- Version numbers are the declared ranges in `package.json`; `package-lock.json` pins the exact
  resolved versions for reproducible installs.
- The stack table describes application dependencies, not operating-system packages or browser
  support matrices. No minimum browser version is asserted by the codebase.

## Related documents

- [Repository structure](REPOSITORY_STRUCTURE.md)
- [Build and release](../09-deployment-and-maintenance/BUILD_AND_RELEASE.md)
- [Quality gates](../11-testing-and-acceptance/QUALITY_GATES.md)
