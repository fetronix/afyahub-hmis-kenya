# System overview

| Field | Value |
| --- | --- |
| Document | SYSTEM_OVERVIEW |
| Version | 1.0 |
| Last reviewed | 2026-11-18 |
| Applies to | Syrona Medical Center HMIS 0.1.0, commit `9d7274c` |
| Audience | Everyone — staff, administrators, engineers, buyers |
| Status | Verified against source, schema and the generated inventories |

## What Syrona Medical Center is

Syrona Medical Center HMIS is a multi-tenant hospital management information system built for Kenyan
facilities. One deployment serves a group of facilities belonging to one or more
organisations. It covers the patient journey from registration and appointment through
outpatient consultation, diagnostics, pharmacy, admission, maternity, theatre and dialysis, to
billing, insurance claims and the facility's accounting ledger.

The system is a single Node.js process that serves both the JSON API (`/api/*`) and the React
single-page application. It stores data in PostgreSQL and integrates with external systems for
patient identity (DHA), national health insurance claims (SHA eClaims), private payer eClaims,
mobile money and bank collections.

## What the system does today

| Capability | Implemented in this revision | Evidence |
| --- | --- | --- |
| Patient registration, identifiers, consent and allergies | Yes | 12 `/api/patients` routes; `patients`, `patient_identifiers`, `patient_consents`, `patient_allergies` |
| Appointments, queueing and website booking | Yes | 10 appointment routes, 3 queue routes, 11 public booking routes |
| Outpatient encounters, vitals, diagnoses, procedures | Yes | 13 clinical routes; `encounters`, `observations`, `diagnoses`, `procedures` |
| Inpatient admissions, wards, beds, nursing notes | Yes | 26 routes; `admissions`, `beds`, `wards`, `nursing_notes` |
| Maternity (antenatal, labour, delivery, postnatal, immunisation) | Yes | 18 routes; `maternity_*` tables and partograph support |
| Theatre scheduling and case management | Yes | 15 routes; `theatre_*` tables |
| Dialysis unit (machines, schedules, sessions, protocols) | Yes | 16 routes; `dialysis_*` tables |
| Laboratory orders and results | Yes | 9 routes; `lab_orders`, `lab_results`, specimen workflow |
| Radiology orders, consent and reporting | Yes | 5 routes plus document consent endpoints; `radiology_*` |
| Pharmacy stock, dispensing and medication records | Yes | 8 routes; `pharmacy_*`, `medications` |
| Inventory and suppliers | Yes | 29 routes; `inventory_*`, `suppliers` |
| Procurement, purchase orders and receiving | Yes | 33 routes; `procurement_*`, `purchase_orders` |
| Billing, invoices, tariffs and cashier receipts | Yes | 47 routes; `invoices`, `billing_*`, `facility_services` |
| Insurance, SHA eClaims and private payer claims | Yes, with provider caveats | 113 routes; `insurance_*`, `sha_eclaims`, `private_insurance_claims` |
| General ledger, expenses, banking, assets, equity, budgets | Yes | 116 routes; `financial_ledger`, `fixed_assets`, `partner_equity`, budgeting tables |
| Human resources and payroll | Yes | 40 HR routes, 25 payroll routes; `staff_*`, `payroll_*` |
| Public health and immunisation | Yes | 9 routes; `public_health_*`, `immunisation_*` |
| Reporting centre and exports | Partially — catalogue of 144, 28 runnable | `src/reporting/report-catalogue.ts`, report engines |
| Patient portal (records, documents, appointment requests) | Yes, with feature limits | 42 portal routes plus 11 document routes |
| Platform administration (tenants, facilities, subscriptions, RBAC) | Yes | 43 routes under `/api/platform`, `/api/tenants`, `/api/facilities` |
| Payment integrations (bank collections, M-Pesa) | Partially — M-Pesa is sandbox-only | `src/payment-hub/adapters/` |
| DHA / AfyaConnect interoperability | Mock and sandbox modes implemented; production gated | `src/integrations/dha/` |
| KHIS / DHIS2 reporting | **Not implemented** | No adapter, route or table found |

## The system in numbers

Numbers below are reproducible from the evidence artefacts in [`docs/evidence/`](../evidence).

| Measure | Value |
| --- | --- |
| Effective HTTP routes | 725 |
| API path prefixes | 70 |
| Route modules (`*.routes.ts` and mounted routers) | 68 route files |
| Unauthenticated routes | 13 |
| Routes behind a permission or administrator guard | 640 |
| Database tables | 256 |
| Database views | 1 |
| Columns | 3,909 |
| Foreign keys | 1,061 |
| Indexes | 758 |
| Migrations applied | 103 (`drizzle/0001`–`0102`) |
| Permission codes | 214 |
| Seeded roles | 10 (2 administrator roles, 8 staff roles) |
| Switchable facility modules | 25 (plus one always-on configuration module) |
| Report catalogue entries | 144 in 10 categories; 24 engine-backed and 4 document-backed (28 runnable), 116 not implemented |
| UI module components | 64 under `src/components/modules` (excluding editor backup files) |

## Who uses it

Facility staff sign in against a facility and see only their facility's data: receptionists,
nurses, doctors, clinical officers, laboratory and radiology staff, pharmacists, billing clerks,
finance officers, HR and payroll officers, and facility administrators. Platform administrators
work above the facilities, managing tenants, subscriptions and the permission catalogue.
Patients use a separate portal with its own login and a deliberately limited view of their own
record. [USER_ROLES_AND_PERSONAS.md](USER_ROLES_AND_PERSONAS.md) describes each group.

## How it is operated

The process is deployed behind a TLS-terminating reverse proxy, connects to PostgreSQL with a
pooled connection, and reads configuration from environment variables validated at start-up.
Migrations are applied by an explicit command, never on boot. Health and readiness endpoints are
public so a proxy or container platform can probe the process.

## What the system is not

- It is **not** a compliance certificate. It implements controls that support Kenya's Data
  Protection Act and health-sector record-keeping expectations; no certification is claimed.
- It is **not** a full financial ERP. It posts billing and payments to a double-entry ledger but
  does not produce statutory financial statements without an accountant's review.
- It is **not** a live SHA or DHA integration by default. Mock mode is the default and production
  submission requires explicit configuration and external approval.
- It is **not** a complete reporting suite. 116 of the 144 catalogue entries are marked unavailable
  because no engine produces them yet.

## Limitations

- The status table above distinguishes implemented from partial; per-module detail and gaps are in
  [MODULE_CATALOGUE.md](MODULE_CATALOGUE.md) and the [traceability matrix](../DOCUMENTATION_TRACEABILITY_MATRIX.md).
- Counts describe commit `9d7274c`. They are regenerated by the scripts in `scripts/docs/` and will
  change as the system evolves.

## Related documents

- [Product scope](PRODUCT_SCOPE.md)
- [System architecture](SYSTEM_ARCHITECTURE.md)
- [Module catalogue](MODULE_CATALOGUE.md)
- [Security overview](../10-security-and-governance/SECURITY_OVERVIEW.md)
