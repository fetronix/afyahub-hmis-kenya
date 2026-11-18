# 06 — Technical documentation

| Document | Purpose |
| --- | --- |
| [TECHNOLOGY_STACK.md](TECHNOLOGY_STACK.md) | Runtime, frameworks, libraries and versions as declared |
| [REPOSITORY_STRUCTURE.md](REPOSITORY_STRUCTURE.md) | Where everything lives and the conventions that keep it findable |
| [APPLICATION_ARCHITECTURE.md](APPLICATION_ARCHITECTURE.md) | Process, middleware order, request lifecycle, error handling |
| [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md) | React application, routing, module switching, API clients |
| [BACKEND_ARCHITECTURE.md](BACKEND_ARCHITECTURE.md) | Routers, services, data access and the rules that bind them |
| [AUTHENTICATION_AND_AUTHORISATION.md](AUTHENTICATION_AND_AUTHORISATION.md) | Sessions, tokens, passwords, permissions, portal authentication |
| [MULTITENANCY_ARCHITECTURE.md](MULTITENANCY_ARCHITECTURE.md) | Tenant and facility isolation, scope resolution, superadmin exceptions |
| [DATABASE_DATA_DICTIONARY.md](DATABASE_DATA_DICTIONARY.md) | Core tables, relationships, scope columns, migration history |
| [DATABASE_SCHEMA_APPENDIX.md](DATABASE_SCHEMA_APPENDIX.md) | Generated reference for every table and column |
| [API_REFERENCE.md](API_REFERENCE.md) | Generated reference for all 725 registered routes |
| [ERROR_HANDLING_AND_VALIDATION.md](ERROR_HANDLING_AND_VALIDATION.md) | Validation schemas, error envelopes, status codes |
| [BACKGROUND_PROCESSES.md](BACKGROUND_PROCESSES.md) | What runs outside a request, and what does not |
| [FILE_STORAGE_AND_RETENTION.md](FILE_STORAGE_AND_RETENTION.md) | Documents, letterheads, hashing, limits and retention |

## Generated documents

`API_REFERENCE.md`, `DATABASE_SCHEMA_APPENDIX.md` and `PERMISSIONS_MATRIX.md` (area 05) are produced
by scripts and must not be edited by hand. Regeneration commands are listed in
[MAINTENANCE_TASKS.md](../09-deployment-and-maintenance/MAINTENANCE_TASKS.md#documentation-build).

## Conventions for readers

- Paths are repository-relative and refer to commit `9d7274c`.
- "Route" means an HTTP method and path registered by an Express router, not a React route.
- "Table" means a PostgreSQL relation created by `drizzle/*.sql`; the one view is called out as a view.
- Permission codes are quoted exactly as the catalogue stores them.
