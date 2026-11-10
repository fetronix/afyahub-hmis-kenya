/**
 * JaliCare HMIS
 * Schema: workforce — employees, attendance, leave, rosters and payroll.
 *
 * Every table is facility-scoped. `tenant_id` is carried alongside
 * `facility_id` so a row can be checked without a join, and so the
 * facility filter is never the only thing standing between two tenants.
 *
 * Money is stored in integer cents. Payroll statutory rules are stored as
 * *versions* with explicit effective dates and a source reference: this
 * application ships no Kenyan statutory rates of its own. A payroll run
 * refuses to calculate until an administrator has recorded the version
 * that applies on the pay date.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  numeric,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { facilities, tenants } from './tenancy.ts';
import { users } from './auth.ts';

/* ============================================================
   ORGANISATION
   ============================================================ */

export const hrDepartments = pgTable(
  'hr_departments',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('hr_departments_facility_code_idx').on(table.facilityId, table.code),
    index('hr_departments_tenant_idx').on(table.tenantId, table.facilityId),
    check('hr_departments_code_check', sql`${table.code} ~ '^[A-Z0-9_-]{2,24}$'`),
  ],
);

export const hrDesignations = pgTable(
  'hr_designations',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    departmentId: integer('department_id').references(() => hrDepartments.id),
    title: text('title').notNull(),
    grade: text('grade'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('hr_designations_facility_title_idx').on(table.facilityId, table.title),
    index('hr_designations_department_idx').on(table.departmentId),
  ],
);

/* ============================================================
   EMPLOYEES
   ============================================================ */

export const hrEmployees = pgTable(
  'hr_employees',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    employeeNumber: text('employee_number').notNull(),
    firstName: text('first_name').notNull(),
    middleName: text('middle_name'),
    lastName: text('last_name').notNull(),
    gender: text('gender'),
    dateOfBirth: date('date_of_birth'),
    nationalId: text('national_id'),
    phone: text('phone'),
    email: text('email'),
    departmentId: integer('department_id').references(() => hrDepartments.id),
    designationId: integer('designation_id').references(() => hrDesignations.id),
    managerId: integer('manager_id'),
    employmentType: text('employment_type').notNull().default('PERMANENT'),
    employmentStatus: text('employment_status').notNull().default('ACTIVE'),
    hireDate: date('hire_date').notNull(),
    exitDate: date('exit_date'),
    /** Contracted monthly basic salary in cents. */
    baseSalaryCents: bigint('base_salary_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    bankName: text('bank_name'),
    bankAccountMasked: text('bank_account_masked'),
    kraPin: text('kra_pin'),
    nssfNumber: text('nssf_number'),
    shifNumber: text('shif_number'),
    /** Optional link to an application login. Never required: not every employee signs in. */
    userId: integer('user_id').references(() => users.id),
    notes: text('notes'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('hr_employees_facility_number_idx').on(table.facilityId, table.employeeNumber),
    index('hr_employees_facility_status_idx').on(table.facilityId, table.employmentStatus),
    index('hr_employees_department_idx').on(table.departmentId),
    check(
      'hr_employees_type_check',
      sql`${table.employmentType} IN ('PERMANENT','CONTRACT','CASUAL','INTERN','LOCUM')`,
    ),
    check(
      'hr_employees_status_check',
      sql`${table.employmentStatus} IN ('ACTIVE','ON_LEAVE','SUSPENDED','EXITED')`,
    ),
    check('hr_employees_salary_check', sql`${table.baseSalaryCents} >= 0`),
    check(
      'hr_employees_exit_check',
      sql`(${table.employmentStatus} = 'EXITED') = (${table.exitDate} IS NOT NULL)`,
    ),
  ],
);

export const hrEmployeeDocuments = pgTable(
  'hr_employee_documents',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    employeeId: integer('employee_id')
      .references(() => hrEmployees.id)
      .notNull(),
    documentType: text('document_type').notNull(),
    title: text('title').notNull(),
    /** Reference to a document stored elsewhere. Never the document body. */
    fileReference: text('file_reference'),
    issuedOn: date('issued_on'),
    expiresOn: date('expires_on'),
    uploadedBy: integer('uploaded_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('hr_employee_documents_employee_idx').on(table.employeeId),
    check('hr_employee_documents_title_check', sql`length(trim(${table.title})) BETWEEN 2 AND 160`),
  ],
);

/* ============================================================
   ATTENDANCE AND ROSTERS
   ============================================================ */

export const hrShifts = pgTable(
  'hr_shifts',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    name: text('name').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('hr_shifts_facility_name_idx').on(table.facilityId, table.name),
    check(
      'hr_shifts_time_check',
      sql`${table.startTime} ~ '^[0-2][0-9]:[0-5][0-9]$' AND ${table.endTime} ~ '^[0-2][0-9]:[0-5][0-9]$'`,
    ),
  ],
);

export const hrRosterEntries = pgTable(
  'hr_roster_entries',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    employeeId: integer('employee_id')
      .references(() => hrEmployees.id)
      .notNull(),
    shiftId: integer('shift_id')
      .references(() => hrShifts.id)
      .notNull(),
    workDate: date('work_date').notNull(),
    notes: text('notes'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('hr_roster_employee_date_idx').on(table.employeeId, table.workDate),
    index('hr_roster_facility_date_idx').on(table.facilityId, table.workDate),
  ],
);

export const hrAttendance = pgTable(
  'hr_attendance',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    employeeId: integer('employee_id')
      .references(() => hrEmployees.id)
      .notNull(),
    workDate: date('work_date').notNull(),
    status: text('status').notNull(),
    checkIn: text('check_in'),
    checkOut: text('check_out'),
    hours: numeric('hours', { precision: 6, scale: 2 }),
    notes: text('notes'),
    recordedBy: integer('recorded_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('hr_attendance_employee_date_idx').on(table.employeeId, table.workDate),
    index('hr_attendance_facility_date_idx').on(table.facilityId, table.workDate),
    check(
      'hr_attendance_status_check',
      sql`${table.status} IN ('PRESENT','ABSENT','LEAVE','HOLIDAY','OFF_DUTY','TRAINING')`,
    ),
  ],
);

/* ============================================================
   LEAVE
   ============================================================ */

export const hrLeaveTypes = pgTable(
  'hr_leave_types',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    annualEntitlementDays: numeric('annual_entitlement_days', { precision: 6, scale: 2 })
      .notNull()
      .default(sql`0`),
    paid: boolean('paid').notNull().default(true),
    requiresApproval: boolean('requires_approval').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('hr_leave_types_facility_code_idx').on(table.facilityId, table.code),
    check('hr_leave_types_code_check', sql`${table.code} ~ '^[A-Z0-9_]{2,24}$'`),
    check('hr_leave_types_days_check', sql`${table.annualEntitlementDays} BETWEEN 0 AND 366`),
  ],
);

export const hrLeaveRequests = pgTable(
  'hr_leave_requests',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    employeeId: integer('employee_id')
      .references(() => hrEmployees.id)
      .notNull(),
    leaveTypeId: integer('leave_type_id')
      .references(() => hrLeaveTypes.id)
      .notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    days: numeric('days', { precision: 6, scale: 2 }).notNull(),
    reason: text('reason'),
    status: text('status').notNull().default('PENDING'),
    decidedBy: integer('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at'),
    decisionNote: text('decision_note'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('hr_leave_requests_facility_status_idx').on(table.facilityId, table.status),
    index('hr_leave_requests_employee_idx').on(table.employeeId),
    check(
      'hr_leave_requests_status_check',
      sql`${table.status} IN ('PENDING','APPROVED','REJECTED','CANCELLED')`,
    ),
    check('hr_leave_requests_range_check', sql`${table.endDate} >= ${table.startDate}`),
    check('hr_leave_requests_days_check', sql`${table.days} > 0 AND ${table.days} <= 366`),
    check(
      'hr_leave_requests_decision_check',
      sql`(${table.status} IN ('APPROVED','REJECTED')) = (${table.decidedBy} IS NOT NULL AND ${table.decidedAt} IS NOT NULL)`,
    ),
  ],
);

/* ============================================================
   PAYROLL — CONFIGURATION
   ============================================================ */

/**
 * A statutory version is a dated snapshot of one statute's bands, for one
 * facility. `source_reference` records where the figures came from. The
 * application seeds none: an administrator records the authority's own
 * publication before payroll can run.
 */
export const payrollStatutoryVersions = pgTable(
  'payroll_statutory_versions',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    /** PAYE | NSSF | SHIF | AHL — the four Kenyan deductions this engine supports. */
    statute: text('statute').notNull(),
    label: text('label').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    authority: text('authority').notNull(),
    sourceReference: text('source_reference').notNull(),
    /** Whether the employee or employer side is capped (NSSF uses a ceiling). */
    basis: text('basis').notNull().default('GROSS'),
    status: text('status').notNull().default('DRAFT'),
    notes: text('notes'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payroll_statutory_versions_facility_statute_from_idx').on(
      table.facilityId,
      table.statute,
      table.effectiveFrom,
    ),
    index('payroll_statutory_versions_lookup_idx').on(
      table.facilityId,
      table.statute,
      table.status,
    ),
    check(
      'payroll_statutory_versions_statute_check',
      sql`${table.statute} IN ('PAYE','NSSF','SHIF','AHL')`,
    ),
    check(
      'payroll_statutory_versions_status_check',
      sql`${table.status} IN ('DRAFT','ACTIVE','RETIRED')`,
    ),
    check(
      'payroll_statutory_versions_range_check',
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
    check(
      'payroll_statutory_versions_source_check',
      sql`length(trim(${table.sourceReference})) BETWEEN 8 AND 500`,
    ),
  ],
);

/**
 * One band of a statutory version. PAYE is progressive, so bands are
 * ordered; NSSF, SHIF and the housing levy are recorded as a single band
 * with a percentage and, where the statute sets one, a ceiling.
 */
export const payrollStatutoryBands = pgTable(
  'payroll_statutory_bands',
  {
    id: serial('id').primaryKey(),
    versionId: integer('version_id')
      .references(() => payrollStatutoryVersions.id, { onDelete: 'cascade' })
      .notNull(),
    sequence: integer('sequence').notNull(),
    /** Inclusive lower bound of the band, in cents. */
    lowerBoundCents: bigint('lower_bound_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** Exclusive upper bound; NULL means "and above". */
    upperBoundCents: bigint('upper_bound_cents', { mode: 'bigint' }),
    employeeRateBp: integer('employee_rate_bp').notNull().default(0),
    employerRateBp: integer('employer_rate_bp').notNull().default(0),
    employeeFixedCents: bigint('employee_fixed_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    employerFixedCents: bigint('employer_fixed_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** Ceiling on the amount charged, not on the base. NULL means no ceiling. */
    employeeCapCents: bigint('employee_cap_cents', { mode: 'bigint' }),
    employerCapCents: bigint('employer_cap_cents', { mode: 'bigint' }),
    /** Relief subtracted from this band's tax, used by PAYE personal relief. */
    reliefCents: bigint('relief_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
  },
  (table) => [
    uniqueIndex('payroll_statutory_bands_order_idx').on(table.versionId, table.sequence),
    check('payroll_statutory_bands_bounds_check', sql`${table.lowerBoundCents} >= 0`),
    check(
      'payroll_statutory_bands_range_check',
      sql`${table.upperBoundCents} IS NULL OR ${table.upperBoundCents} > ${table.lowerBoundCents}`,
    ),
    check(
      'payroll_statutory_bands_rate_check',
      sql`${table.employeeRateBp} BETWEEN 0 AND 10000 AND ${table.employerRateBp} BETWEEN 0 AND 10000`,
    ),
  ],
);

/** Recurring earnings and deductions attached to one employee. */
export const payrollEmployeeComponents = pgTable(
  'payroll_employee_components',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    employeeId: integer('employee_id')
      .references(() => hrEmployees.id)
      .notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** EARNING | DEDUCTION */
    kind: text('kind').notNull(),
    amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
    taxable: boolean('taxable').notNull().default(true),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payroll_employee_components_key_idx').on(
      table.employeeId,
      table.code,
      table.effectiveFrom,
    ),
    index('payroll_employee_components_lookup_idx').on(table.employeeId, table.isActive),
    check('payroll_employee_components_kind_check', sql`${table.kind} IN ('EARNING','DEDUCTION')`),
    check('payroll_employee_components_amount_check', sql`${table.amountCents} > 0`),
  ],
);

/**
 * Facility chart-of-accounts mapping for payroll posting. Payroll cannot
 * post to invented account numbers; the administrator selects the six
 * accounts once and every run reuses them.
 */
export const payrollAccountSettings = pgTable(
  'payroll_account_settings',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    salaryExpenseAccountId: integer('salary_expense_account_id').notNull(),
    employerCostAccountId: integer('employer_cost_account_id').notNull(),
    netPayPayableAccountId: integer('net_pay_payable_account_id').notNull(),
    payePayableAccountId: integer('paye_payable_account_id').notNull(),
    nssfPayableAccountId: integer('nssf_payable_account_id').notNull(),
    shifPayableAccountId: integer('shif_payable_account_id').notNull(),
    ahlPayableAccountId: integer('ahl_payable_account_id').notNull(),
    otherDeductionsPayableAccountId: integer('other_deductions_payable_account_id'),
    updatedBy: integer('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('payroll_account_settings_facility_idx').on(table.facilityId)],
);

/* ============================================================
   PAYROLL — PERIODS, RUNS AND PAYSLIPS
   ============================================================ */

export const payrollPeriods = pgTable(
  'payroll_periods',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    name: text('name').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    payDate: date('pay_date').notNull(),
    status: text('status').notNull().default('DRAFT'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payroll_periods_facility_range_idx').on(
      table.facilityId,
      table.startDate,
      table.endDate,
    ),
    check('payroll_periods_range_check', sql`${table.endDate} >= ${table.startDate}`),
    check('payroll_periods_status_check', sql`${table.status} IN ('DRAFT','OPEN','CLOSED')`),
  ],
);

export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    periodId: integer('period_id')
      .references(() => payrollPeriods.id)
      .notNull(),
    status: text('status').notNull().default('DRAFT'),
    employeeCount: integer('employee_count').notNull().default(0),
    grossCents: bigint('gross_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    taxableCents: bigint('taxable_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    payeCents: bigint('paye_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    nssfEmployeeCents: bigint('nssf_employee_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    nssfEmployerCents: bigint('nssf_employer_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    shifCents: bigint('shif_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    ahlEmployeeCents: bigint('ahl_employee_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    ahlEmployerCents: bigint('ahl_employer_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    otherDeductionsCents: bigint('other_deductions_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    netCents: bigint('net_cents', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** Statutory version ids used, so a payslip can always be reconstructed. */
    statutoryVersionIds: jsonb('statutory_version_ids')
      .notNull()
      .default(sql`'[]'::jsonb`),
    calculatedBy: integer('calculated_by').references(() => users.id),
    calculatedAt: timestamp('calculated_at'),
    approvedBy: integer('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    postedBy: integer('posted_by').references(() => users.id),
    postedAt: timestamp('posted_at'),
    journalEntryId: integer('journal_entry_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payroll_runs_period_idx').on(table.periodId),
    index('payroll_runs_facility_status_idx').on(table.facilityId, table.status),
    check(
      'payroll_runs_status_check',
      sql`${table.status} IN ('DRAFT','CALCULATED','APPROVED','POSTED')`,
    ),
    check(
      'payroll_runs_approval_check',
      sql`(${table.status} IN ('APPROVED','POSTED')) = (${table.approvedBy} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)`,
    ),
    check(
      'payroll_runs_segregation_check',
      sql`${table.approvedBy} IS NULL OR ${table.calculatedBy} IS NULL OR ${table.approvedBy} <> ${table.calculatedBy}`,
    ),
  ],
);

export const payrollPayslips = pgTable(
  'payroll_payslips',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),
    runId: integer('run_id')
      .references(() => payrollRuns.id, { onDelete: 'cascade' })
      .notNull(),
    employeeId: integer('employee_id')
      .references(() => hrEmployees.id)
      .notNull(),
    grossCents: bigint('gross_cents', { mode: 'bigint' }).notNull(),
    taxableCents: bigint('taxable_cents', { mode: 'bigint' }).notNull(),
    payeCents: bigint('paye_cents', { mode: 'bigint' }).notNull(),
    nssfEmployeeCents: bigint('nssf_employee_cents', { mode: 'bigint' }).notNull(),
    nssfEmployerCents: bigint('nssf_employer_cents', { mode: 'bigint' }).notNull(),
    shifCents: bigint('shif_cents', { mode: 'bigint' }).notNull(),
    ahlEmployeeCents: bigint('ahl_employee_cents', { mode: 'bigint' }).notNull(),
    ahlEmployerCents: bigint('ahl_employer_cents', { mode: 'bigint' }).notNull(),
    otherDeductionsCents: bigint('other_deductions_cents', { mode: 'bigint' }).notNull(),
    netCents: bigint('net_cents', { mode: 'bigint' }).notNull(),
    /** Snapshot of the computed lines and the rules applied. */
    breakdown: jsonb('breakdown').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payroll_payslips_run_employee_idx').on(table.runId, table.employeeId),
    index('payroll_payslips_employee_idx').on(table.employeeId),
    check('payroll_payslips_net_check', sql`${table.netCents} >= 0`),
  ],
);

export const payrollPayslipLines = pgTable(
  'payroll_payslip_lines',
  {
    id: serial('id').primaryKey(),
    payslipId: integer('payslip_id')
      .references(() => payrollPayslips.id, { onDelete: 'cascade' })
      .notNull(),
    sequence: integer('sequence').notNull().default(0),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  },
  (table) => [
    index('payroll_payslip_lines_payslip_idx').on(table.payslipId),
    check(
      'payroll_payslip_lines_kind_check',
      sql`${table.kind} IN ('EARNING','DEDUCTION','EMPLOYER')`,
    ),
  ],
);
