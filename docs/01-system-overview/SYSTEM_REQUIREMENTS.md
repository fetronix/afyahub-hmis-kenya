# System requirements

| Field | Value |
| --- | --- |
| Document | SYSTEM_REQUIREMENTS |
| Version | 1.0 |
| Last reviewed | 2026-11-18 |
| Applies to | Syrona Medical Center HMIS 0.1.0, commit `9d7274c` |
| Audience | Engineers, procurement, QA, implementation teams |
| Status | Verified against `package.json`, `src/config/env.ts`, CI and the deployment scripts |

## Functional requirements (as implemented)

Requirements are grouped by capability. Each is met by the source referenced in the
[module catalogue](MODULE_CATALOGUE.md); the traceability matrix records the evidence.

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| FR-01 | Register a patient with a unique medical record number | Met | `patients.mrn` carries a unique index (`patients_mrn_unique`), so MRNs are unique across the database, not only within a facility |
| FR-02 | Detect probable duplicate patients before registration | Met | Identifier matching in the registration service; UI shows match state |
| FR-03 | Record consent and allergies with audit | Met | `patient_consents`, `patient_allergies` |
| FR-04 | Book, reschedule, cancel and check in appointments | Met | `appointments`, `queues`; public booking API |
| FR-05 | Record an outpatient encounter with vitals, diagnosis and procedures | Met | `encounters`, `observations`, `diagnoses`, `procedures` |
| FR-06 | Admit, transfer, discharge and bill an inpatient | Met | `admissions`, `admission_transfers`, `inpatient_bed_nights` |
| FR-07 | Order laboratory tests, track specimens, enter and release results | Met | `lab_orders`, `lab_specimens`, `lab_results` |
| FR-08 | Order imaging, record consent and attach a report | Partially met | Imaging and consent met; findings are documents, not structured fields |
| FR-09 | Dispense medication with batch allocation | Met | `pharmacy_dispense_*`, `inventory_batches` |
| FR-10 | Raise invoices from clinical charges and record payments | Met | `billing_invoices`, `billing_items`, `billing_payments` |
| FR-11 | Support cash, card, mobile money and insurance payment methods | Partially met | Cash/card/insurance recorded; mobile money depends on provider integration |
| FR-12 | Submit SHA eClaims | Partially met | Adapter and payload implemented; live submission requires credentials and approval |
| FR-13 | Post billing and payments to a double-entry ledger | Met | `journal_entries`, `journal_lines`, `accounting_billing_postings` |
| FR-14 | Reconcile bank statements | Met | `bank_statement_imports`, `bank_transactions`, `bank_reconciliations` |
| FR-15 | Manage inventory with batches, movements and counts | Met | `inventory_*` |
| FR-16 | Procure through requisitions, purchase orders and goods receipt | Met | `procurement_*`, `purchase_orders`, `goods_received_notes` |
| FR-17 | Maintain employees, attendance and leave | Met | `hr_*` |
| FR-18 | Run payroll with statutory bands and post to the ledger | Met | `payroll_*`; statutory values are configured per deployment |
| FR-19 | Provide a report centre with a documented catalogue | Partially met | 144 entries; 28 runnable, 116 not implemented |
| FR-20 | Give patients access to their released documents | Met | Portal session, release workflow, document bytes |
| FR-21 | Manage tenants, facilities and subscriptions | Met | Platform routers and tables |
| FR-22 | Enforce facility module switches on the server | Met | `requireFacilityModule` |
| FR-23 | Keep an audit trail of clinical, financial and configuration actions | Met | `audit_logs`, document events, ledger events |
| FR-24 | Export or import a patient's health record on request | **Not implemented** | Tables `health_record_exports` and `health_record_imports` exist, but no route or service serves them |

## Non-functional requirements

| ID | Requirement | Implementation | Verification |
| --- | --- | --- | --- |
| NFR-01 | Runs on Node.js 20.19+ or 22.12+ | `engines` in `package.json`; CI uses Node 22 | `npm ci` and build run in CI |
| NFR-02 | PostgreSQL 16 | Drizzle schema and SQL migrations target 16; CI uses `postgres:16` | Migrations applied to PG 16 in CI and in this documentation build |
| NFR-03 | Single deployable artifact serving UI and API | `vite build` + `npm run build:server` | Build scripts and CI job |
| NFR-04 | No secrets in the repository | `.env` ignored; CI refuses to embed `FIELD_ENCRYPTION_KEY`; tracked-backup check | `npm run security:check-tracked-database-backups` |
| NFR-05 | All API access authenticated except a documented public set | 712 of 725 routes require a staff or portal session; 13 are public by design | API inventory |
| NFR-06 | Tenant isolation at query level | Scope services and `WHERE` clauses; isolation test | `tenant-isolation.db.spec.ts` |
| NFR-07 | Permission checks server-side | `requirePermission` guards; 640 routes guarded | API inventory and permissions matrix |
| NFR-08 | Structured, redacted logging | Pino with credential and patient-identity redaction | `src/logging/` |
| NFR-09 | Deterministic migrations, applied explicitly | Numbered SQL; `npm run db:migrate`; CI applies them | CI database job |
| NFR-10 | Backup and restore commands exist and are verifiable | `db:backup`, `db:backup:verify`, `db:restore`, `db:restore:drill` | Scripted; drill documented in area 09 |
| NFR-11 | Health and readiness endpoints | `/api/health`, `/api/ready` with cached DB probe | Source and public route list |
| NFR-12 | Rate limiting | 300 requests/min per IP on `/api`; 10 failed logins per 15 minutes | `src/middleware/http-security.middleware.ts` |
| NFR-13 | Encryption of sensitive fields at rest | AES-256-GCM field crypto with `FIELD_ENCRYPTION_KEY` | `src/security/field-crypto.ts` |
| NFR-14 | Reproducible installs | `npm ci` with lockfile | CI |
| NFR-15 | Documentation can be validated and regenerated | `scripts/docs/build-*.ts` and `scripts/docs/validate-docs.ts` | Validator run recorded in [VALIDATION_REPORT.md](../VALIDATION_REPORT.md); wiring it into CI is a recommendation, not yet a pipeline step |

## Performance expectations

The system was not benchmarked during this documentation exercise. Known design facts that bound
performance:

- Reporting runs against the live database at query time; there is no warehouse.
- The connection pool is small and fixed at start-up.
- File downloads stream document bytes from PostgreSQL.

No throughput or latency target is claimed. A facility planning high report volume should size the
database and test its own workloads.

## Deployment requirements

| Requirement | Detail |
| --- | --- |
| Runtime | Node.js 20.19+ / 22.12+ |
| Database | PostgreSQL 16, database owner rights for migrations |
| Web server | TLS-terminating reverse proxy forwarding to the Node port |
| Environment | Variables listed in [ENVIRONMENT_VARIABLES.md](../09-deployment-and-maintenance/ENVIRONMENT_VARIABLES.md) |
| Storage | Database storage for documents; disk for the built artifacts |
| Backup | PostgreSQL backups via the provided scripts or the hosting provider's database backups |
| Time | `TZ` set to the facility's timezone (`Africa/Nairobi` by default) |

## Out of scope

The requirements in [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md#explicitly-out-of-scope-in-this-revision)
are excluded, including statutory financial statements, KHIS/DHIS2 submission, live M-Pesa
production collections and multi-currency support.

## Limitations

- Functional requirements are described at capability level; a requirement is "met" when the API and
  data model exist and the service is exercised by at least one test. Individual workflow steps may
  still have UI gaps, which the manuals note.
- No load, availability or recovery-time objective has been measured; any such figure in a
  procurement document must come from that facility's own testing.

## Related documents

- [Product scope](PRODUCT_SCOPE.md)
- [Module catalogue](MODULE_CATALOGUE.md)
- [Environment variables](../09-deployment-and-maintenance/ENVIRONMENT_VARIABLES.md)
- [Quality gates](../11-testing-and-acceptance/QUALITY_GATES.md)
