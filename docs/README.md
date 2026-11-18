# JaliCare HMIS — documentation library

Professional documentation for JaliCare HMIS, the hospital management system in this
repository (also referred to as AfyaHub Kenya in older material). The library describes the
system **as implemented in this codebase**, not as planned: every significant claim is traced to
source, schema, migrations or tests, and the [traceability matrix](DOCUMENTATION_TRACEABILITY_MATRIX.md)
records the evidence and verification status behind each capability.

> **Publication status.** This is an incremental commit of the documentation programme, not its
> final state. The documents below are the ones written and checked so far; links to areas that have
> not been committed yet will not resolve until those areas land. Nothing here is a placeholder claim
> about the software: every published page was written against the code, schema and generated evidence
> in this commit.

## Library metadata

| Field | Value |
| --- | --- |
| Documentation version | 1.0 |
| Last reviewed | 2026-11-18 |
| Software version | JaliCare HMIS 0.1.0 (`package.json`) |
| Commit described | `9d7274c` — documentation adds no application changes |
| Audience | Facility staff, facility administrators, platform operators, engineers, auditors, integrators |
| Status | **Work in progress.** Areas 01, 05 (permissions matrix) and 06 (partial) and the generated evidence are published; areas 02–04 and 07–12, the traceability matrix and the validation report follow on this branch. |

## How to read this library

Start with the areas in order if you are new to the system. Every area has a `README.md` that
states what it covers and who it is for; every document states its audience and its limitations.

| Area | Contents | Primary readers |
| --- | --- | --- |
| [01 System overview](01-system-overview/README.md) | What the product does, its architecture, modules, roles and requirements | Everyone |
| [02 User manuals](02-user-manuals/README.md) | Screen-by-screen operating instructions for clinical and front-desk staff | Facility staff |
| [03 Finance and accounting](03-finance-and-accounting/README.md) | Billing, receipts, ledgers, banking, assets, equity, budgets, period close | Finance staff, auditors |
| [04 Operations](04-operations/README.md) | Inventory, procurement, workforce, payroll, facility configuration, public health | Operations staff |
| [05 Administration](05-administration/README.md) | Users, roles, the permissions matrix, tenants, facilities, audit | Administrators |
| [06 Technical](06-technical/README.md) | Stack, architecture, auth, tenancy, data dictionary, API reference | Engineers |
| [07 Integrations](07-integrations/README.md) | Payment providers, M-Pesa, SHA eClaims, DHA, KHIS/DHIS2, webhooks | Integrators |
| [08 Reporting](08-reporting/README.md) | Report catalogue, engines, exports, analytics | Managers, analysts |
| [09 Deployment and maintenance](09-deployment-and-maintenance/README.md) | Environment, build, release, migrations, backup, monitoring | Operators, DevOps |
| [10 Security and governance](10-security-and-governance/README.md) | Access control, data protection, audit, session policy, limitations | Security reviewers, management |
| [11 Testing and acceptance](11-testing-and-acceptance/README.md) | Test strategy, inventory, how to run, known gaps, acceptance | QA, delivery managers |
| [12 Reference](12-reference/README.md) | Glossary, status legend, file map, regulatory references | Everyone |

Two cross-cutting documents sit outside the areas:

- [Documentation traceability matrix](DOCUMENTATION_TRACEABILITY_MATRIX.md) — every documented
  capability mapped to code, routes, tables, migrations, tests, the document that describes it, and
  a verification status.
- [Validation report](VALIDATION_REPORT.md) — what was checked, what passed, what could not be
  verified, and what remains.

## Status vocabulary

Statuses are used consistently across the library. They describe evidence, not intentions.

| Status | Meaning |
| --- | --- |
| **VERIFIED** | The behaviour is implemented and was checked against source **and** at least one of: an executed test, a migrated database, or a runtime request. |
| **PARTIALLY VERIFIED** | Implemented and checked against source, but some part of the claim (a UI workflow, a provider response, a report total) could not be exercised in this environment. |
| **UNVERIFIED** | Described from source but not executed; treat as needing confirmation before relying on it. |
| **NOT IMPLEMENTED** | No implementation exists. A menu entry, catalogue row or plan does not count. |
| **BLOCKED** | Implementation exists but cannot be used because of a configuration, credential or external dependency that is absent. |

A page that renders is never sufficient evidence for **VERIFIED**. See
[the status legend](12-reference/STATUS_LEGEND.md) for the full rules and for how to change a status.

## Evidence artefacts

The library is backed by generated evidence, so numbers in the documents can be reproduced:

| Artefact | Produced by | Contents |
| --- | --- | --- |
| [`docs/evidence/API_ROUTE_INVENTORY.json`](evidence/API_ROUTE_INVENTORY.json) | `npx tsx scripts/docs/build-api-inventory.ts` | Every effective route walked from `createApp()`, matched to its source registration, with auth, permissions, module gates and input schemas |
| [`docs/evidence/DATABASE_SCHEMA_INVENTORY.json`](evidence/DATABASE_SCHEMA_INVENTORY.json) | `npx tsx scripts/docs/build-data-dictionary.ts` | Every table and view of a database built by `npm run db:migrate`, with columns, keys, indexes and the migration that introduced it |
| [`docs/evidence/PERMISSIONS_MATRIX.json`](evidence/PERMISSIONS_MATRIX.json) | `npx tsx scripts/docs/build-permissions-matrix.ts` | Permission catalogue, role grants, navigation guards, route usage and cross-check findings |

Regenerating an artefact and rebuilding the documents that quote it is described in
[09 Deployment and maintenance → Documentation build](09-deployment-and-maintenance/MAINTENANCE_TASKS.md#documentation-build).

## Conventions used in this library

- **Facts before prose.** Numbers (routes, tables, permissions, migrations) are stated explicitly and
  are reproducible from the evidence artefacts.
- **No invented behaviour.** If a workflow could not be confirmed, the document says so and the
  traceability matrix marks it **UNVERIFIED**.
- **Synthetic examples only.** All names, identifiers, amounts and MRNs in examples are invented.
  No production credentials, tokens or patient records appear anywhere in this library; environment
  variables are named, never valued.
- **Honest limitations.** Each technical and financial document ends with a *Limitations* section.
  Where the product has a known gap, the gap is documented rather than smoothed over.
- **Cross-references.** Documents link to the related manual, API section and data dictionary entry
  instead of repeating themselves.
- **Diagrams** are Mermaid and represent verified structure only.

## Known limitations of the documentation itself

- Browser-level acceptance was **not** executed for this revision: the environment used to write the
  library had no browser runtime. User manuals therefore describe screens and workflows from the
  components and the API contracts they call, and are marked **PARTIALLY VERIFIED** where a visual step
  could not be confirmed. Nothing in this library claims screenshot verification.
- Provider-facing integrations (SHA, DHA, payment providers) are documented from the adapter code and
  the configuration they read. Live provider responses were not observed; those sections are marked
  accordingly.
- Report figures are documented from the engines that compute them. Report output was not reconciled
  against a real facility's books, because no real data was used.

## Maintaining the library

1. Change the code.
2. Regenerate the evidence artefacts (see the commands above).
3. Rebuild the generated documents: `API_REFERENCE.md`, `DATABASE_SCHEMA_APPENDIX.md`,
   `PERMISSIONS_MATRIX.md`, `TEST_INVENTORY.md`.
4. Update the affected authored documents and the traceability matrix.
5. Run the documentation validator (`scripts/docs/validate-docs.ts`, added with the final areas of
   this library) and fix anything it reports.
6. Bump the document version and the *Last reviewed* date of every file you touched.

The conventions, template and validation rules are in
[09 Deployment and maintenance → Documentation build](09-deployment-and-maintenance/MAINTENANCE_TASKS.md#documentation-build).
