# Permissions matrix

> Generated from the permission catalogue, the staff role catalogue, the facility-admin delegation set, the navigation guard and the registered API routes. Regenerate with `npx tsx scripts/docs/build-permissions-matrix.ts`.

Generated: 2026-11-18

**Intended audience:** system administrators, facility administrators, auditors, integrators.

## Summary

| Measure | Value |
| --- | --- |
| Permission codes in the catalogue | 214 |
| Seeded staff roles plus the two administrator roles | 10 |
| Facility modules that can be switched off individually | 25 |
| Navigation modules with a permission guard | 28 |
| Codes held by no seeded role | 0 |
| Codes that no registered API route requires | 61 |

Roles are seeded, not fixed: a facility administrator can create custom roles and grant or withhold individual codes, and `facility_role_permission_overrides` can narrow a role for one facility. The matrix therefore describes the default grants, not every possible deployment.

## How access is decided

A request reaches a handler only if all of the following hold:

1. **Session** — `requireAuth` validates the staff session cookie (`requirePortalAuth` for the patient portal).
2. **Facility module** — `requireFacilityModule(code)` refuses modules the facility has switched off, and the navigation rail hides them.
3. **Role permission** — `requirePermission(...)` (all listed codes) or `requireAnyPermission([...])` (at least one).
4. **Scope** — the handler resolves the tenant and facility from the session and rejects a body or query facility that disagrees.

A permission never grants scope by itself: it allows an action, while the scope check decides which tenant and facility rows that action may touch.

## Roles

| Role | Permissions granted | Source |
| --- | --- | --- |
| SUPER_ADMIN | 214 | `src/seeds/permissions.ts` |
| FACILITY_ADMIN | 75 | `src/routes/platform/tenants.routes.ts` |
| BILLING_CLERK | 28 | `src/auth/staff-role-catalogue.ts` |
| CLINICAL_OFFICER | 20 | `src/auth/staff-role-catalogue.ts` |
| DOCTOR | 21 | `src/auth/staff-role-catalogue.ts` |
| INVENTORY_OFFICER | 5 | `src/auth/staff-role-catalogue.ts` |
| LABORATORY_TECHNICIAN | 4 | `src/auth/staff-role-catalogue.ts` |
| NURSE | 8 | `src/auth/staff-role-catalogue.ts` |
| PHARMACIST | 3 | `src/auth/staff-role-catalogue.ts` |
| RECEPTIONIST | 17 | `src/auth/staff-role-catalogue.ts` |

`SUPER_ADMIN` is a platform role: it operates without a tenant or facility and is barred from facility financial operations that require a facility assignment. The exclusions applied by the seed are: none found in a `SUPER_ADMIN_EXCLUSIONS` constant

## Permissions by module

### accounting

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `accounting.assets.manage` | Manage Fixed Asset Register & Depreciation | SUPER_ADMIN | 0 | — |
| `accounting.bank.manage` | Manage Bank Accounts & Reconciliation | SUPER_ADMIN | 8 | — |
| `accounting.coa.manage` | Manage Chart of Accounts & Periods | SUPER_ADMIN | 2 | — |
| `accounting.equity.approve` | Approve reviewed partner equity statements | SUPER_ADMIN | 0 | — |
| `accounting.equity.audit` | Read partner equity audit history | SUPER_ADMIN | 0 | — |
| `accounting.equity.export` | Export full partner equity statements | SUPER_ADMIN | 0 | — |
| `accounting.equity.manage` | Prepare draft partner equity statements | SUPER_ADMIN | 0 | — |
| `accounting.equity.partners` | Manage effective-dated partner register | SUPER_ADMIN | 0 | — |
| `accounting.equity.read` | View partner equity statements | SUPER_ADMIN | 13 | — |
| `accounting.equity.review` | Independently review partner equity statements | SUPER_ADMIN | 0 | — |
| `accounting.expenses.approve` | Approve & Post Expense Requests | SUPER_ADMIN | 2 | — |
| `accounting.expenses.request` | Submit Expense Requests | SUPER_ADMIN | 1 | — |
| `accounting.journals.post` | Post General Ledger Journals & Reversals | SUPER_ADMIN | 7 | — |
| `accounting.payables.manage` | Manage Accounts Payable & Supplier Payments | SUPER_ADMIN | 0 | — |
| `accounting.periods.close` | Close Financial Periods | SUPER_ADMIN | 1 | — |
| `accounting.planning.approve` | Independently approve and archive budget plans | SUPER_ADMIN | 0 | — |
| `accounting.planning.audit` | Read planning audit history | SUPER_ADMIN | 1 | — |
| `accounting.planning.export` | Issue and export planning reports | SUPER_ADMIN | 0 | — |
| `accounting.planning.import` | Import planning workbooks | SUPER_ADMIN | 0 | — |
| `accounting.planning.manage` | Manage draft budget plans | SUPER_ADMIN | 3 | — |
| `accounting.planning.read` | View budget plans | SUPER_ADMIN | 32 | — |
| `accounting.planning.reset` | Reset draft planning data | SUPER_ADMIN | 3 | — |
| `accounting.read` | View Accounting & Financial Statements | SUPER_ADMIN | 64 | accounting |
| `accounting.reports.export` | Export Accounting Reports | SUPER_ADMIN | 1 | — |

### appointments

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `appointments.cancel` | Cancel Appointments | SUPER_ADMIN, FACILITY_ADMIN | 2 | — |
| `appointments.categories.manage` | Manage appointment categories | SUPER_ADMIN | 2 | — |
| `appointments.create` | Create Appointments | SUPER_ADMIN, FACILITY_ADMIN, RECEPTIONIST | 4 | — |
| `appointments.read` | View Appointments | SUPER_ADMIN, FACILITY_ADMIN, CLINICAL_OFFICER, DOCTOR, RECEPTIONIST | 5 | dashboard, reception |
| `appointments.update` | Update Appointments | SUPER_ADMIN, FACILITY_ADMIN, RECEPTIONIST | 3 | — |

### assets

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `assets.depreciate` | Post Depreciation | SUPER_ADMIN | 1 | — |
| `assets.dispose` | Dispose of Fixed Assets | SUPER_ADMIN | 3 | — |
| `assets.manage` | Manage Fixed Assets | SUPER_ADMIN | 7 | — |
| `assets.read` | View Fixed Assets | SUPER_ADMIN | 11 | fixed_assets |

### audit

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `audit.read` | View Audit Logs | SUPER_ADMIN, FACILITY_ADMIN | 3 | audit |
| `audit.security.read` | View Security Audit Logs | SUPER_ADMIN | 1 | audit |

### authentication

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `auth.mfa.manage` | Manage MFA | SUPER_ADMIN | 0 | — |
| `auth.password.reset` | Reset Passwords | SUPER_ADMIN | 0 | — |
| `auth.sessions.read` | View Sessions | SUPER_ADMIN | 0 | — |
| `auth.sessions.revoke` | Revoke Sessions | SUPER_ADMIN | 0 | — |

### billing

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `bank_payments.configure` | Administer Facility Bank Accounts and Bank-only Policy | SUPER_ADMIN | 0 | — |
| `bank_payments.read` | View Bank Payments | SUPER_ADMIN | 0 | payment_transactions |
| `bank_payments.settle` | Approve Verified Bank Settlement | SUPER_ADMIN | 0 | — |
| `bank_payments.submit` | Submit Pending Bank Transfers | SUPER_ADMIN | 0 | — |
| `bank_payments.verify` | Independently Verify Bank Evidence | SUPER_ADMIN | 0 | — |
| `billing.create` | Create Bills | SUPER_ADMIN, BILLING_CLERK | 5 | — |
| `billing.payments.record` | Record Payments | SUPER_ADMIN, BILLING_CLERK | 5 | — |
| `billing.read` | View Billing | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK | 98 | dashboard, finance |
| `billing.refunds.approve` | Independently Review Refund Requests | SUPER_ADMIN | 3 | — |
| `billing.refunds.record` | Record Manual Refunds | SUPER_ADMIN | 5 | — |
| `billing.update` | Update Bills | SUPER_ADMIN, BILLING_CLERK | 10 | — |
| `tariffs.manage` | Manage Service Tariffs | SUPER_ADMIN, FACILITY_ADMIN | 18 | — |
| `tariffs.read` | View Service Tariffs | SUPER_ADMIN, FACILITY_ADMIN | 11 | — |

### clinical

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `clinical.create` | Create Clinical Records | SUPER_ADMIN, CLINICAL_OFFICER, DOCTOR, NURSE | 10 | — |
| `clinical.icd11.manage` | Manage ICD-11 Sync & Mapping Reviews | SUPER_ADMIN | 1 | — |
| `clinical.icd11.read` | Search ICD-11 Catalogue & Mappings | SUPER_ADMIN | 3 | — |
| `clinical.read` | View Clinical Records | SUPER_ADMIN, FACILITY_ADMIN, CLINICAL_OFFICER, DOCTOR, NURSE | 73 | dashboard, reception, opd, specialty, radiology |
| `clinical.update` | Update Clinical Records | SUPER_ADMIN, CLINICAL_OFFICER, DOCTOR | 6 | — |

### dialysis

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `dialysis.adverse_events.manage` | Record Dialysis Adverse Events & Follow-Up | SUPER_ADMIN | 2 | — |
| `dialysis.assessments.manage` | Record Dialysis Patient Assessments | SUPER_ADMIN | 2 | — |
| `dialysis.machines.manage` | Manage Dialysis Machines & Maintenance | SUPER_ADMIN | 2 | — |
| `dialysis.plans.authorize` | Authorize Dialysis Treatment Plans | SUPER_ADMIN | 1 | — |
| `dialysis.protocols.manage` | Configure Facility Dialysis Protocols | SUPER_ADMIN | 1 | — |
| `dialysis.read` | View Dialysis Unit | SUPER_ADMIN | 1 | dialysis |
| `dialysis.schedule.manage` | Manage Dialysis Schedules & Machine Allocation | SUPER_ADMIN | 2 | — |
| `dialysis.sessions.record` | Record Dialysis Sessions & Consumables | SUPER_ADMIN | 4 | — |

### facilities

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `facilities.approve` | Approve Facilities | SUPER_ADMIN | 0 | — |
| `facilities.create` | Create Facilities | SUPER_ADMIN | 0 | — |
| `facilities.deactivate` | Deactivate Facilities | SUPER_ADMIN | 0 | — |
| `facilities.modules.manage` | Manage Facility Modules | SUPER_ADMIN, FACILITY_ADMIN | 0 | — |
| `facilities.read` | View Facilities | SUPER_ADMIN, FACILITY_ADMIN | 0 | — |
| `facilities.update` | Update Facilities | SUPER_ADMIN, FACILITY_ADMIN | 0 | configuration |
| `facility.branding.manage` | Manage Facility Letterhead | SUPER_ADMIN | 4 | — |
| `facility.branding.read` | View Facility Letterhead | SUPER_ADMIN | 4 | — |

### hr

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `hr.approve` | Approve Leave | SUPER_ADMIN | 1 | — |
| `hr.manage` | Manage Human Resources | SUPER_ADMIN, FACILITY_ADMIN | 12 | — |
| `hr.read` | View Human Resources | SUPER_ADMIN, FACILITY_ADMIN | 11 | hr |

### inpatient

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `inpatient.admit` | Admit Patients | SUPER_ADMIN, CLINICAL_OFFICER, DOCTOR, NURSE | 4 | — |
| `inpatient.beds.create` | Create Beds | SUPER_ADMIN | 1 | — |
| `inpatient.beds.delete` | Delete Beds | SUPER_ADMIN | 1 | — |
| `inpatient.beds.update` | Update Beds | SUPER_ADMIN | 1 | — |
| `inpatient.discharge` | Discharge Patients | SUPER_ADMIN, DOCTOR | 1 | — |
| `inpatient.read` | View Inpatient Records | SUPER_ADMIN, FACILITY_ADMIN, CLINICAL_OFFICER, DOCTOR, NURSE | 19 | dashboard, inpatient |
| `inpatient.wards.create` | Create Wards | SUPER_ADMIN | 1 | — |
| `inpatient.wards.delete` | Delete Wards | SUPER_ADMIN | 1 | — |
| `inpatient.wards.update` | Update Wards | SUPER_ADMIN | 2 | — |

### insurance

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `insurance.benefits.validate` | Validate Private Insurance Benefits & Copayments | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK, CLINICAL_OFFICER, DOCTOR, RECEPTIONIST | 3 | private_insurance |
| `insurance.claims.create` | Create Claims | SUPER_ADMIN, BILLING_CLERK | 3 | — |
| `insurance.claims.manage` | Manage Claims | SUPER_ADMIN, BILLING_CLERK | 3 | — |
| `insurance.claims.submit` | Submit Claims | SUPER_ADMIN, BILLING_CLERK | 0 | — |
| `insurance.eligibility.check` | Check Private Insurance Eligibility | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK, RECEPTIONIST | 4 | private_insurance |
| `insurance.mappings.manage` | Manage Insurer Service Mappings & Benefit Rules | SUPER_ADMIN, FACILITY_ADMIN | 4 | — |
| `insurance.members.manage` | Manage Insurance Memberships & Policies | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK, RECEPTIONIST | 2 | private_insurance |
| `insurance.members.read` | View Insurance Memberships & Policies | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK, CLINICAL_OFFICER, DOCTOR, RECEPTIONIST | 5 | private_insurance |
| `insurance.payers.manage` | Manage Private Insurer Configurations | SUPER_ADMIN, FACILITY_ADMIN | 2 | private_insurance |
| `insurance.payers.read` | View Private Insurer Configurations | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK, CLINICAL_OFFICER, DOCTOR, RECEPTIONIST | 9 | private_insurance |
| `insurance.preauthorization.manage` | Manage Private Insurance Preauthorizations | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK, CLINICAL_OFFICER, DOCTOR | 6 | private_insurance |
| `insurance.private.claims.prepare` | Prepare & Validate Private Insurance Claims | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK | 9 | private_insurance |
| `insurance.private.claims.submit` | Submit & Resubmit Private Insurance Claims | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK | 8 | private_insurance |
| `insurance.private.remittance.reconcile` | Import & Reconcile Private Insurance Remittances | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK | 4 | private_insurance |
| `insurance.read` | View Insurance | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK, RECEPTIONIST | 25 | claims, private_insurance |
| `insurance.sha.benefits.validate` | Validate SHA Service Benefits | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK, CLINICAL_OFFICER, DOCTOR, RECEPTIONIST | 5 | claims |
| `insurance.sha.claims.prepare` | Prepare SHA eClaims | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK | 6 | — |
| `insurance.sha.claims.read` | View SHA eClaims | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK | 8 | claims |
| `insurance.sha.claims.resubmit` | Resubmit Rejected SHA eClaims | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK | 1 | — |
| `insurance.sha.claims.submit` | Submit SHA eClaims | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK | 1 | — |
| `insurance.sha.configuration.manage` | Manage SHA Payer Configuration & Rules | SUPER_ADMIN, FACILITY_ADMIN | 9 | — |
| `insurance.sha.eligibility.check` | Check SHA Patient Eligibility | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK, RECEPTIONIST | 6 | claims |
| `insurance.sha.preauthorization.create` | Create & Submit SHA Preauthorization | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK, CLINICAL_OFFICER, DOCTOR | 9 | claims |
| `insurance.sha.read` | View SHA eClaims & Readiness | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK, CLINICAL_OFFICER, DOCTOR, RECEPTIONIST | 19 | claims |
| `insurance.sha.reconciliation.manage` | Reconcile SHA Remittances | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK | 10 | — |
| `insurance.sha.remittance.read` | View SHA Remittances | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK | 3 | — |

### interop

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `interop.fhir.patient.read` | Export FHIR Patient Resource | SUPER_ADMIN | 1 | interoperability |

### inventory

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `inventory.manage` | Manage Inventory | SUPER_ADMIN, INVENTORY_OFFICER | 14 | — |
| `inventory.read` | View Inventory | SUPER_ADMIN, FACILITY_ADMIN, INVENTORY_OFFICER | 13 | dashboard, inventory |

### laboratory

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `laboratory.orders.create` | Create Laboratory Orders | SUPER_ADMIN, CLINICAL_OFFICER, DOCTOR, LABORATORY_TECHNICIAN | 2 | — |
| `laboratory.read` | View Laboratory | SUPER_ADMIN, FACILITY_ADMIN, CLINICAL_OFFICER, DOCTOR, LABORATORY_TECHNICIAN | 7 | dashboard, laboratory, radiology |
| `laboratory.results.enter` | Enter Laboratory Results | SUPER_ADMIN, LABORATORY_TECHNICIAN | 3 | — |
| `laboratory.results.verify` | Verify Laboratory Results | SUPER_ADMIN | 2 | — |

### maternity

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `maternity.create` | Record Maternity Care | SUPER_ADMIN, CLINICAL_OFFICER, DOCTOR, NURSE | 6 | — |
| `maternity.read` | View Maternity Records | SUPER_ADMIN, CLINICAL_OFFICER, DOCTOR, NURSE, RECEPTIONIST | 15 | maternity |
| `maternity.update` | Update Maternity Records | SUPER_ADMIN, CLINICAL_OFFICER, DOCTOR, NURSE | 3 | — |

### patients

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `patients.create` | Register Patients | SUPER_ADMIN, FACILITY_ADMIN, RECEPTIONIST | 1 | — |
| `patients.deactivate` | Deactivate Patients | SUPER_ADMIN | 0 | — |
| `patients.documents.read` | Read signed patient documents | SUPER_ADMIN | 0 | — |
| `patients.documents.release` | Release patient documents to portal | SUPER_ADMIN | 0 | — |
| `patients.documents.upload` | Upload signed patient documents | SUPER_ADMIN | 1 | — |
| `patients.read` | View Patients | SUPER_ADMIN, FACILITY_ADMIN, BILLING_CLERK, CLINICAL_OFFICER, DOCTOR, LABORATORY_TECHNICIAN, NURSE, PHARMACIST, RECEPTIONIST | 12 | dashboard, registration, reception |
| `patients.update` | Update Patients | SUPER_ADMIN, FACILITY_ADMIN, CLINICAL_OFFICER, DOCTOR, RECEPTIONIST | 3 | — |

### payer_hub

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `payer_hub.assign` | Assign Payers to Facilities | SUPER_ADMIN | 2 | — |
| `payer_hub.catalogue.read` | View Facility Payer Catalogue | SUPER_ADMIN, FACILITY_ADMIN | 1 | configuration |
| `payer_hub.credentials.manage` | Manage Payer Credential References | SUPER_ADMIN, FACILITY_ADMIN | 2 | — |
| `payer_hub.facility.manage` | Manage Facility Payer Activation | SUPER_ADMIN, FACILITY_ADMIN | 4 | — |
| `payer_hub.global.manage` | Manage Global Payer Registry | SUPER_ADMIN | 3 | — |
| `payer_hub.global.read` | View Global Payer Registry | SUPER_ADMIN | 1 | — |
| `payer_hub.production.approve` | Review Payer Production Requests | SUPER_ADMIN | 1 | — |
| `payer_hub.production.request` | Request Payer Production Approval | SUPER_ADMIN, FACILITY_ADMIN | 1 | — |

### payment_hub

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `payment_hub.accounts.read` | View Masked Payment Accounts | SUPER_ADMIN, FACILITY_ADMIN | 0 | — |
| `payment_hub.assign` | Assign Payment Providers | SUPER_ADMIN | 2 | — |
| `payment_hub.catalogue.read` | View Facility Payment Catalogue | SUPER_ADMIN, FACILITY_ADMIN | 1 | configuration |
| `payment_hub.collection.initiate` | Initiate Payment Collection | SUPER_ADMIN | 4 | — |
| `payment_hub.credentials.manage` | Manage Facility Provider Credentials | SUPER_ADMIN, FACILITY_ADMIN | 3 | — |
| `payment_hub.facility.manage` | Manage Facility Payment Integrations | SUPER_ADMIN, FACILITY_ADMIN | 6 | — |
| `payment_hub.global.manage` | Manage Global Payment Providers | SUPER_ADMIN | 4 | — |
| `payment_hub.global.read` | View Global Payment Providers | SUPER_ADMIN | 1 | — |
| `payment_hub.payments.verify` | Check Provider Payment Status | SUPER_ADMIN | 1 | — |
| `payment_hub.production.approve` | Approve Production Integration Requests | SUPER_ADMIN | 1 | — |
| `payment_hub.production.request` | Request Production Payment Access | SUPER_ADMIN, FACILITY_ADMIN | 1 | — |
| `payment_hub.reconciliation.manage` | Reconcile Payment Transactions | SUPER_ADMIN | 2 | — |
| `payment_hub.transactions.read` | View Payment Transactions | SUPER_ADMIN | 1 | — |
| `payment_hub.transfers.initiate` | Initiate Provider Transfers | SUPER_ADMIN | 0 | — |

### payroll

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `payroll.approve` | Approve Payroll | SUPER_ADMIN | 2 | — |
| `payroll.manage` | Prepare Payroll | SUPER_ADMIN, FACILITY_ADMIN | 6 | — |
| `payroll.post` | Post Payroll to Ledger | SUPER_ADMIN | 1 | — |
| `payroll.read` | View Payroll | SUPER_ADMIN, FACILITY_ADMIN | 13 | payroll |
| `payroll.statutory.manage` | Record Statutory Payroll Rules | SUPER_ADMIN | 4 | — |

### pharmacy

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `pharmacy.dispense` | Dispense Medicines | SUPER_ADMIN, PHARMACIST | 2 | — |
| `pharmacy.inventory.manage` | Manage Pharmacy Inventory | SUPER_ADMIN | 0 | — |
| `pharmacy.read` | View Pharmacy | SUPER_ADMIN, FACILITY_ADMIN, PHARMACIST | 4 | dashboard, pharmacy |

### platform

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `platform.manage` | Manage Platform | SUPER_ADMIN | 0 | — |
| `platform.read` | View Platform | SUPER_ADMIN | 0 | — |
| `platform.settings.manage` | Manage Platform Settings | SUPER_ADMIN | 0 | — |

### portal

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `portal.accounts.manage` | Manage Patient Portal Accounts | SUPER_ADMIN, FACILITY_ADMIN | 9 | patient_portal |
| `portal.audit.read` | Review Portal Audit Events | SUPER_ADMIN, FACILITY_ADMIN | 1 | — |
| `portal.invite` | Invite Patients to the Portal | SUPER_ADMIN, FACILITY_ADMIN, RECEPTIONIST | 4 | — |
| `portal.invites.manage` | Revoke Portal Invitations | SUPER_ADMIN, FACILITY_ADMIN | 1 | — |
| `portal.settings.manage` | Manage Patient Portal Settings | SUPER_ADMIN, FACILITY_ADMIN | 2 | — |

### practitioners

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `practitioners.create` | Create Practitioners | SUPER_ADMIN | 0 | — |
| `practitioners.read` | View Practitioners | SUPER_ADMIN, FACILITY_ADMIN | 0 | — |
| `practitioners.update` | Update Practitioners | SUPER_ADMIN | 0 | — |
| `practitioners.verify` | Verify Practitioner Credentials | SUPER_ADMIN | 0 | — |

### procurement

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `approval_policies.manage` | Manage Approval Policies | SUPER_ADMIN | 0 | — |
| `approval_policies.read` | View Approval Policies | SUPER_ADMIN | 0 | — |
| `procurement.approve` | Approve Purchase Orders | SUPER_ADMIN, FACILITY_ADMIN | 2 | — |
| `procurement.complete` | Complete Purchase Orders | SUPER_ADMIN, FACILITY_ADMIN | 7 | — |
| `procurement.create` | Create Suppliers and Purchase Orders | SUPER_ADMIN, INVENTORY_OFFICER | 6 | — |
| `procurement.delete` | Cancel Procurement | SUPER_ADMIN | 2 | — |
| `procurement.read` | View Suppliers and Purchase Orders | SUPER_ADMIN, FACILITY_ADMIN, INVENTORY_OFFICER | 35 | procurement |
| `procurement.reject` | Reject Purchase Orders | SUPER_ADMIN, FACILITY_ADMIN | 0 | — |
| `procurement.update` | Edit Procurement | SUPER_ADMIN, INVENTORY_OFFICER | 2 | — |

### public_health

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `public_health.reports.create` | Create Public Health Reports | SUPER_ADMIN | 2 | — |

### radiology

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `radiology.consent.exception` | Authorize procedure consent exception | SUPER_ADMIN | 0 | — |
| `radiology.consent.policy` | Manage facility radiology consent policy | SUPER_ADMIN | 0 | — |
| `radiology.consent.verify` | Verify procedure-specific consent | SUPER_ADMIN | 0 | — |
| `radiology.read` | View Radiology | SUPER_ADMIN | 2 | — |

### reports

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `reports.export` | Export Reports | SUPER_ADMIN, FACILITY_ADMIN | 0 | — |
| `reports.read` | View Reports | SUPER_ADMIN, FACILITY_ADMIN | 12 | dashboard, analytics, public_health |

### roles

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `roles.create` | Create Roles | SUPER_ADMIN | 0 | — |
| `roles.permissions.manage` | Manage Role Permissions | SUPER_ADMIN | 0 | configuration |
| `roles.read` | View Roles | SUPER_ADMIN, FACILITY_ADMIN | 0 | — |
| `roles.update` | Update Roles | SUPER_ADMIN | 0 | — |

### system

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `system.health.read` | View System Health | SUPER_ADMIN | 0 | — |
| `system.settings.manage` | Manage System Settings | SUPER_ADMIN | 3 | configuration |

### tenants

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `tenants.create` | Create Tenants | SUPER_ADMIN | 0 | — |
| `tenants.deactivate` | Deactivate Tenants | SUPER_ADMIN | 0 | — |
| `tenants.read` | View Tenants | SUPER_ADMIN | 0 | — |
| `tenants.update` | Update Tenants | SUPER_ADMIN | 0 | — |

### theatre

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `theatre.read` | Read theatre schedule | SUPER_ADMIN | 7 | dashboard, theatre |
| `theatre.reports.read` | Read theatre scheduling reports | SUPER_ADMIN | 1 | — |
| `theatre.rooms.manage` | Manage theatre rooms | SUPER_ADMIN | 2 | — |
| `theatre.schedule.create` | Schedule theatre cases | SUPER_ADMIN | 2 | — |
| `theatre.schedule.manage` | Change theatre bookings | SUPER_ADMIN | 3 | — |
| `theatre.schedule.reconcile` | Review historical theatre reservations | SUPER_ADMIN | 1 | — |

### users

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `users.create` | Create Users | SUPER_ADMIN, FACILITY_ADMIN | 0 | — |
| `users.deactivate` | Deactivate Users | SUPER_ADMIN | 0 | — |
| `users.invitations.read` | View Staff Invitations | SUPER_ADMIN, FACILITY_ADMIN | 2 | — |
| `users.invitations.reissue` | Reissue Staff Invitations | SUPER_ADMIN, FACILITY_ADMIN | 1 | — |
| `users.invitations.revoke` | Revoke Staff Invitations | SUPER_ADMIN, FACILITY_ADMIN | 1 | — |
| `users.invite` | Invite Staff | SUPER_ADMIN, FACILITY_ADMIN | 11 | configuration |
| `users.read` | View Users | SUPER_ADMIN, FACILITY_ADMIN | 0 | — |
| `users.roles.manage` | Manage User Roles | SUPER_ADMIN | 0 | configuration |
| `users.update` | Update Users | SUPER_ADMIN, FACILITY_ADMIN | 0 | — |

### website_booking

| Code | Label | Default roles | Routes requiring it | Navigation module |
| --- | --- | --- | --- | --- |
| `booking.clients.manage` | Manage Website Booking API Clients | SUPER_ADMIN | 2 | — |
| `booking.manage` | Manage Website Bookings & Reminders | SUPER_ADMIN | 3 | — |
| `booking.read` | View Website Bookings | SUPER_ADMIN | 1 | — |

## Cross-checks

**Permission codes named by a seeded role but absent from the catalogue:** none

**Permission codes named by the facility-admin delegation but absent:** none

**Permission codes named by a navigation guard but absent:** none

**Permission codes required by a registered route but absent:** none

**Catalogue codes no seeded role holds:** none

**Catalogue codes no registered route requires:** `platform.read`, `platform.manage`, `platform.settings.manage`, `tenants.read`, `tenants.create`, `tenants.update`, `tenants.deactivate`, `facilities.read`, `facilities.create`, `facilities.update`, `facilities.modules.manage`, `facilities.approve`, `facilities.deactivate`, `users.read`, `users.create`, `users.update`, `users.deactivate`, `users.roles.manage`, `roles.read`, `roles.create`, `roles.update`, `roles.permissions.manage`, `auth.sessions.read`, `auth.sessions.revoke`, `auth.password.reset`, `auth.mfa.manage`, `practitioners.read`, `practitioners.create`, `practitioners.update`, `practitioners.verify`, `patients.documents.read`, `patients.documents.release`, `radiology.consent.verify`, `radiology.consent.exception`, `radiology.consent.policy`, `patients.deactivate`, `pharmacy.inventory.manage`, `insurance.claims.submit`, `procurement.reject`, `approval_policies.read`, `approval_policies.manage`, `reports.export`, `system.health.read`, `accounting.planning.import`, `accounting.planning.approve`, `accounting.planning.export`, `accounting.equity.manage`, `accounting.equity.partners`, `accounting.equity.review`, `accounting.equity.approve`, `accounting.equity.export`, `accounting.equity.audit`, `accounting.assets.manage`, `accounting.payables.manage`, `bank_payments.read`, `bank_payments.submit`, `bank_payments.verify`, `bank_payments.settle`, `bank_payments.configure`, `payment_hub.accounts.read`, `payment_hub.transfers.initiate`

## Limitations

- Custom roles created in a deployment are not listed; only seeded defaults are.
- Route counts come from the generated API inventory and count each route once per code, including routes that require the code through a router-level guard.
- A code that no route requires may still be meaningful: it can be a delegated capability for a custom role, or a guard that the inventory attributes to a router rather than a route.

## Related documents

- [Roles and personas](../01-system-overview/USER_ROLES_AND_PERSONAS.md)
- [User management](USER_MANAGEMENT.md)
- [API reference](../06-technical/API_REFERENCE.md)
- [Multitenancy architecture](../06-technical/MULTITENANCY_ARCHITECTURE.md)

