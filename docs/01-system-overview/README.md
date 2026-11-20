# 01 — System overview

This area explains what Syrona Medical Center HMIS is, what it covers, how it is built and who uses it. Read
it before the manuals: the manuals assume the vocabulary introduced here.

| Document | Purpose | Audience |
| --- | --- | --- |
| [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) | What the system is, what it does, and the numbers behind it | Everyone |
| [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md) | What is in scope, what is not, and the status of each capability | Product owners, buyers, delivery managers |
| [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) | How the parts fit together: process, layers, data, tenancy, integrations | Engineers, architects, security reviewers |
| [MODULE_CATALOGUE.md](MODULE_CATALOGUE.md) | Every module with its purpose, status, screens, API prefixes, tables and permissions | Everyone |
| [USER_ROLES_AND_PERSONAS.md](USER_ROLES_AND_PERSONAS.md) | The seeded roles, what they can do, and the people behind them | Administrators, trainers |
| [SYSTEM_REQUIREMENTS.md](SYSTEM_REQUIREMENTS.md) | Functional and non-functional requirements as implemented | Engineers, procurement, QA |

## Terms used throughout

| Term | Meaning in this system |
| --- | --- |
| Tenant | An organisation (a hospital group, a county, a single private facility). Isolates customers from one another. |
| Facility | One site inside a tenant: a hospital, clinic or dispensary. Scopes staff to their workplace. |
| Facility module | A switchable capability of a facility (`laboratory`, `theatre`, `payroll`…). Switching it off hides navigation **and** refuses its API. |
| Permission code | A named capability such as `billing.create`. Roles hold codes; routes require them. |
| Encounter | One clinical contact between a patient and the facility. Outpatient visits, admissions and maternity episodes attach to encounters. |
| Session | A server-side record for a signed-in staff user, valid for eight hours. |
| Portal account | A patient-facing account, separate from a staff session and authenticated by its own bearer token. |
| Report catalogue | The list of 144 named reports the reporting centre can show, of which 28 currently produce output. |

## Documentation conventions

Terminology follows the application: UI labels are quoted as they appear, permission codes are
written in `code` style, and file paths are repository-relative. Statuses (**VERIFIED**,
**PARTIALLY VERIFIED**, **UNVERIFIED**, **NOT IMPLEMENTED**, **BLOCKED**) are defined in the
[library README](../README.md#status-vocabulary) and applied in the
[traceability matrix](../DOCUMENTATION_TRACEABILITY_MATRIX.md).
