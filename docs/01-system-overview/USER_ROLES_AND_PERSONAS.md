# User roles and personas

| Field | Value |
| --- | --- |
| Document | USER_ROLES_AND_PERSONAS |
| Version | 1.0 |
| Last reviewed | 2026-11-18 |
| Applies to | JaliCare HMIS 0.1.0, commit `9d7274c` |
| Audience | Administrators, trainers, implementation teams |
| Status | Verified against `src/seeds/permissions.ts`, `src/auth/staff-role-catalogue.ts` and `src/components/Sidebar.tsx` |

## Two kinds of actors

**Staff users** authenticate with a username and password against a facility and hold one or more
roles. Their session lasts eight hours. **Patients** use the separate patient portal, which has its
own account, its own bearer token and a deliberately narrow view of the patient's own record.

A user may hold several staff roles; the effective permission set is the union of their roles'
permissions, minus any facility-level override that narrows a role for that facility.

## Seeded roles

The system seeds two administrator roles and eight staff roles. Deployments can add custom roles.

| Role | Scope | What they do | Permissions (default) | Source |
| --- | --- | --- | --- | --- |
| `SUPER_ADMIN` | Platform, across tenants | Manages tenants, facilities, facility administrators, subscriptions, RBAC and provider registries; operates without a tenant or facility assignment | All 214 catalogue codes except the facility-owned delegations listed in `SUPER_ADMIN_EXCLUSIONS` | `src/seeds/permissions.ts` |
| `FACILITY_ADMIN` | One facility | Runs the facility: staff and roles, tariffs, facility profile, modules, approvals, HR and payroll preparation | 75 delegated codes | `FACILITY_ADMIN_PERMISSION_CODES` in `src/routes/platform/tenants.routes.ts` |
| `DOCTOR` | One facility | Consultations, diagnoses, procedures, admissions, discharge, maternity care, insurance validation | 21 | `src/auth/staff-role-catalogue.ts` |
| `CLINICAL_OFFICER` | One facility | Consultation and maternity care under the Clinical Officers Council; discharge is deliberately not granted | 20 | same |
| `NURSE` | One facility | Triage, vitals, nursing notes, ward care, maternity support | 8 | same |
| `PHARMACIST` | One facility | Dispensing and pharmacy records | 3 | same |
| `LABORATORY_TECHNICIAN` | One facility | Laboratory orders, specimens and results | 4 | same |
| `BILLING_CLERK` | One facility | Invoices, receipts, billing and insurance claim preparation | 28 | same |
| `INVENTORY_OFFICER` | One facility | Inventory and procurement | 5 | same |
| `RECEPTIONIST` | One facility | Registration, appointments and patient lookup | 17 | same |

The complete code-by-code matrix, including which navigation module each code opens and how many
routes require it, is generated in [PERMISSIONS_MATRIX.md](../05-administration/PERMISSIONS_MATRIX.md).

## Personas and what they need

### Receptionist

Registers walk-in and booked patients, confirms identifiers, prints or records the MRN, checks
patients into the queue and routes them to a service point. Needs: fast patient search, duplicate
warnings, appointment diary, queue board. Does not need clinical or financial access.

### Triage nurse and ward nurse

Records vitals, triages by acuity, writes nursing notes, manages bed occupancy and observes
inpatients. Needs: patient lookup restricted to their facility, the bed board, observation entry.
Cannot approve discharges unless a role grants it.

### Doctor and clinical officer

Runs the consultation: history, examination, diagnosis using ICD-11, procedures, orders for
laboratory, radiology and pharmacy, admission or discharge. Needs: the encounter workspace, results
review, prescribing, admissions. A clinical officer can deliver maternity care; discharge authority
is a facility policy decision and is not granted by default.

### Laboratory technologist

Receives orders, registers specimens, enters and reviews results, releases reports. Needs the work
queue by status, specimen tracking, reference ranges, and a release step that is auditable.

### Radiologist and radiology staff

Creates imaging orders, records consent and verification, attaches the report document. Needs
consent policy enforcement and patient document upload; the report itself is a document, not a
structured finding, in this revision.

### Pharmacist

Sees prescriptions, checks stock, dispenses and records allocation from batches. Needs the
dispensing queue and stock visibility, and must not be able to edit clinical notes.

### Billing clerk and cashier

Raises invoices from clinical charges, records payments (cash, card, mobile, insurance), prints
receipts, requests refunds and follows up claims. Needs patient-level balances, receipt history and
payment attribution. Refunds require approval rather than a single clerk's decision.

### Finance officer and accountant

Maintains the chart of accounts, posts and reverses journals, reconciles bank statements, closes
periods, runs expense approvals, manages fixed assets, partner equity and budgets. Needs the ledger
views, tie-out reports and exports. Cannot post clinical data.

### HR and payroll officer

Maintains employees, departments, attendance and leave; prepares payroll runs and posts them to the
ledger. Needs employee records and payroll rules; statutory rates are configuration and must be
entered per jurisdiction and effective date.

### Facility administrator

Configures the facility: profile and branding, module switches, staff invitations, roles and
permission overrides, tariffs, approval policies, integration credentials. Needs broad
configuration access but is intentionally excluded from some financial actions that require an
independent approver.

### Platform administrator (superadmin)

Onboards tenants and facilities, issues facility administrator invitations, manages subscription
periods and payments, curates the RBAC catalogue and the payment and payer provider registries.
Operates above facilities and does not participate in facility clinical or cashier work.

### Patient (portal user)

Sees their own released documents, visit summaries, appointment requests and access history. Can
request an appointment and download a released document. Cannot see staff notes, other patients, or
anything not explicitly released.

## Segregation of duties

| Duty | Held by | Deliberately not held by |
| --- | --- | --- |
| Preparing an expense request | Facility staff with `accounting.expenses.request` | The approver |
| Approving an expense | A different user with `accounting.expenses.approve` | The requester |
| Preparing and approving payroll | HR prepares; approval and posting are separate delegated duties | The same person |
| Recording a payment | Billing clerk | — |
| Approving a refund | Approver with refund permission | The clerk who requested it |
| Closing a financial period | Finance officer with `accounting.periods.close` | — |
| Facility configuration | Facility administrator | Superadmin (facility-owned configuration) |

These separations are enforced by permission codes and, where the workflow requires it, by the
service layer rejecting self-approval. Where a control is only procedural, the document says so.

## Limitations

- Role permissions listed here are the seeded defaults; a deployment's custom roles and
  facility-level overrides change the effective set. Always check the permissions matrix for the
  deployment in question.
- Persona narratives describe intended use. Screen-level verification was not performed in a
  browser for this revision.

## Related documents

- [Permissions matrix](../05-administration/PERMISSIONS_MATRIX.md)
- [User management](../05-administration/USER_MANAGEMENT.md)
- [Role management](../05-administration/ROLE_MANAGEMENT.md)
- [Access control](../10-security-and-governance/ACCESS_CONTROL.md)
