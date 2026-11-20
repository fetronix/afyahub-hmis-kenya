# Product scope

| Field | Value |
| --- | --- |
| Document | PRODUCT_SCOPE |
| Version | 1.0 |
| Last reviewed | 2026-11-18 |
| Applies to | Syrona Medical Center HMIS 0.1.0, commit `9d7274c` |
| Audience | Product owners, procurement, delivery managers, facility administrators |
| Status | Verified against the module catalogue and generated inventories |

## Purpose of this document

It states what the product covers in this revision, what it does not, and how certain each
statement is. It exists to prevent the two common failures of HMIS procurement: assuming a menu
entry is a working feature, and assuming a working feature is a complete statutory report.

## Scope summary

| Domain | In scope | Status | Where documented |
| --- | --- | --- | --- |
| Patient registration and identity | Registration, MRN allocation, identifiers, consent, allergies, duplicate checks | **VERIFIED** | [Patient management](../02-user-manuals/PATIENT_MANAGEMENT.md) |
| Appointments and queue | Appointment diary, categories, queue and triage, website booking | **VERIFIED** | [Reception](../02-user-manuals/RECEPTION_AND_APPOINTMENTS.md) |
| Outpatient care | Encounters, vitals, diagnoses (ICD-11), procedures, clinical notes | **VERIFIED** | [Outpatient](../02-user-manuals/OUTPATIENT.md) |
| Inpatient care | Admissions, wards, beds, transfers, nursing notes, bed billing | **VERIFIED** | [Inpatient](../02-user-manuals/INPATIENT_AND_NURSING.md) |
| Maternity | Antenatal register, labour and partograph, deliveries, postnatal, immunisation | **VERIFIED** | [Maternity](../02-user-manuals/MATERNITY.md) |
| Theatre | Rooms, scheduling, case list, change of case, scheduling report | **VERIFIED** | [Theatre](../02-user-manuals/THEATRE.md) |
| Dialysis | Machines, schedules, sessions, facility protocols | **VERIFIED** | [Dialysis](../02-user-manuals/DIALYSIS.md) |
| Laboratory | Orders, specimens, results, release | **VERIFIED** | [Laboratory](../02-user-manuals/LABORATORY.md) |
| Radiology | Orders, consent policy and verification, report documents | **PARTIALLY VERIFIED** | [Radiology](../02-user-manuals/RADIOLOGY.md) |
| Pharmacy | Stock, dispensing, medication records | **VERIFIED** | [Pharmacy](../02-user-manuals/PHARMACY.md) |
| Inventory | Items, stock control, movements, suppliers | **VERIFIED** | [Inventory](../04-operations/INVENTORY_MANAGEMENT.md) |
| Procurement | Requisitions, purchase orders, receiving, matching | **VERIFIED** | [Procurement](../04-operations/PROCUREMENT.md) |
| Billing and cashier | Invoices, charges, receipts, refunds, tariffs, payment allocation | **VERIFIED** | [Billing](../02-user-manuals/BILLING_AND_CASHIER.md), [Finance](../03-finance-and-accounting/BILLING_AND_INVOICING.md) |
| Insurance and claims | Eligibility, benefits, preauthorisation, SHA eClaims, private payer claims, remittances | **PARTIALLY VERIFIED** — provider submission is gated | [SHA](../07-integrations/SHA_ECLAIMS.md) |
| General ledger and finance | Chart of accounts, journals, expenses, periods, banking, fixed assets, partner equity, budgets | **VERIFIED** for ledger mechanics; **PARTIALLY VERIFIED** for exports | [Finance area](../03-finance-and-accounting/README.md) |
| HR and payroll | Employees, departments, attendance, leave, payroll runs, statutory rules | **VERIFIED** for mechanics; statutory rates are configuration, not seeded values | [HR](../04-operations/HR_AND_WORKFORCE.md), [Payroll](../04-operations/PAYROLL.md) |
| Public health | Public-health register and immunisation | **PARTIALLY VERIFIED** | [Public health](../04-operations/PUBLIC_HEALTH_AND_IMMUNISATION.md) |
| Reporting | Report centre, 144-entry catalogue, 28 runnable reports, exports | **PARTIALLY VERIFIED** — 116 entries not implemented | [Reporting area](../08-reporting/README.md) |
| Patient portal | Portal accounts, own documents, appointment requests, access history | **VERIFIED** for authentication and document release; **PARTIALLY VERIFIED** for UI | [Patient portal](../02-user-manuals/PATIENT_PORTAL.md) |
| Platform administration | Tenants, facilities, facility administrators, subscriptions, RBAC, provider registry | **VERIFIED** | [Platform administration](../05-administration/PLATFORM_ADMINISTRATION.md) |
| Integrations | DHA, SHA, payment hub (bank collections, M-Pesa Daraja), private payer adapters | **PARTIALLY VERIFIED** — see area 07 | [Integrations area](../07-integrations/README.md) |
| KHIS / DHIS2 aggregate reporting | Not present | **NOT IMPLEMENTED** | [KHIS](../07-integrations/KHIS_DHIS2.md) |

## Explicitly out of scope in this revision

- **Statutory financial statements.** The ledger is double-entry and can produce a trial balance and
  ledger extracts, but no audited financial statement pack is generated.
- **Full statutory report suite.** 116 catalogue entries have no engine; the reporting centre shows
  them as *Not implemented* with the dependency that blocks them.
- **Live M-Pesa production collections.** The Daraja adapter is sandbox-only and the callback webhook
  answers `503` in this revision.
- **KhIS/DHIS2 submission.** No aggregate export or submission adapter exists.
- **Claims adjudication for private payers.** The adapters prepare and submit claim payloads; they do
  not implement payer-side adjudication logic.
- **Human resource statutory filings.** Payroll computes and posts; it does not file PAYE or NSSF
  returns electronically.
- **Multi-currency and multi-country localisation.** The system is single-currency (KES) and built
  around Kenyan identifiers and insurance schemes.
- **Offline operation.** The SPA requires connectivity to the API.

## Scope decisions that shape the product

1. **One process serves API and UI.** Simplifies deployment on shared hosting, at the cost of a
   shared failure domain. See [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md).
2. **Tenant and facility are separate axes.** A tenant isolates customers; a facility scopes staff.
   Every table that holds clinical or financial data carries `tenant_id`, and most also carry
   `facility_id` (189 and 192 of 257 relations respectively).
3. **Facility modules are a server-side contract.** Turning a module off hides it in navigation and
   refuses its API, not just its menu.
4. **Mock-first integrations.** DHA defaults to `mock`; production requires an explicit flag and
   credentials. This protects development from submitting real claims.
5. **Explicit migrations.** The application never migrates on start; a release step runs
   `npm run db:migrate`.

## Assumptions and dependencies

| Assumption | Consequence if false |
| --- | --- |
| PostgreSQL 16 reachable with a database the application may read and write | The process still starts (the pool connects lazily) but `/api/ready` reports `not_ready` and every data request fails. |
| TLS terminated by a reverse proxy | Session and portal tokens travel in the `Authorization` header; without TLS they are exposed on the network. |
| Node.js supported version (`^20.19.0` or `>=22.12.0`) | Build or runtime failures; the engines field and CI enforce it. |
| Facility staff have individual accounts | Shared accounts defeat the audit trail and the per-user permission model. |
| External providers supply credentials and approve the integration | SHA/DHA/payment features remain in mock or sandbox mode. |
| A backup routine exists outside the application | The application can export and verify backups (`npm run db:backup`) but does not schedule them. |

## Limitations

- Scope statements are binary where the code is binary (implemented or not) and qualified where the
  code is partial. Look for the status in the module manual before quoting a capability.
- "Verified" here means verified against source and available tests at commit `9d7274c`; it is not a
  certification of fitness for a particular facility's statutory obligations.

## Related documents

- [System overview](SYSTEM_OVERVIEW.md)
- [Module catalogue](MODULE_CATALOGUE.md)
- [Traceability matrix](../DOCUMENTATION_TRACEABILITY_MATRIX.md)
- [Known limitations](../10-security-and-governance/VULNERABILITY_AND_LIMITATIONS.md)
