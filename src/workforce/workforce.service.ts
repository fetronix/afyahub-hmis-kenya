import {
  assessPayrollAccounts,
  assessPayrollRules,
  payrollRuleIssues,
  type VerifiedPayrollVersion,
  type PayrollReadinessPeriod,
} from './payroll-readiness.ts';
/**
 * JaliCare HMIS
 * Workforce service — HR records, attendance, leave and payroll.
 *
 * SCOPE AND SAFETY RULES
 * ----------------------
 * 1. Every read and write is constrained by the tenant and facility resolved
 *    from the authenticated request. A browser-supplied facility id is never
 *    trusted on its own; the route resolves it through `requireScopedFacility`
 *    and passes the resulting ids here.
 * 2. Mutations write an audit row in the same transaction as the change.
 * 3. Payroll never contains statutory figures of its own. A run costs only
 *    from ACTIVE, effective-dated versions recorded by an administrator with
 *    a source reference; missing or ambiguous rules abort the calculation.
 * 4. A payroll run is calculated by one user and approved by another. The
 *    database enforces this, and the service reports it clearly.
 * 5. Posting a run to the ledger is idempotent: the journal idempotency key is
 *    derived from the run id, so a retried post replays the same journal
 *    instead of creating a second one.
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';

import { db, pool } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import {
  postInsideTransaction,
  transaction as ledgerTransaction,
  type AccountingScope,
  type JournalLine,
} from '../accounting/accounting.service.ts';
import {
  calculatePayroll,
  type PayrollEmployeeInput,
  type PayslipResult,
  type StatutoryVersion,
} from './payroll-calculator.ts';

export type WorkforceScope = {
  tenantId: number;
  facilityId: number;
  actorId: number;
  actorName: string;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class WorkforceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkforceError';
  }
}

/**
 * Declared as a function rather than a const arrow so TypeScript narrows
 * control flow after a call: `if (!x) fail(...)` makes `x` non-null below.
 */
function fail(statusCode: number, code: string, message: string): never {
  throw new WorkforceError(statusCode, code, message);
}

/* ============================================================
   INPUT VALIDATION
   ============================================================ */

// Rejecting control characters is the point: they corrupt printed payslips
// and can be used to spoof names in exports.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') fail(400, 'INVALID_INPUT', `${label} is required.`);
  const text = value.trim();
  if (text.length < 1 || text.length > max || CONTROL_CHARACTERS.test(text))
    fail(400, 'INVALID_INPUT', `${label} is required and must be at most ${max} characters.`);
  return text;
}

export function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, label, max);
}

export function isoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value)))
    fail(400, 'INVALID_DATE', `${label} must be a date in YYYY-MM-DD format.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (parsed.toISOString().slice(0, 10) !== value)
    fail(400, 'INVALID_DATE', `${label} is not a real calendar date.`);
  return value;
}

export function optionalIsoDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return isoDate(value, label);
}

export function positiveId(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    fail(400, 'INVALID_ID', `A valid ${label} is required.`);
  return parsed;
}

export function optionalPositiveId(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  return positiveId(value, label);
}

/** Money arrives as integer cents; a negative or fractional amount is refused. */
export function cents(value: unknown, label: string, { allowZero = true } = {}): bigint {
  if (value === undefined || value === null || value === '')
    fail(400, 'INVALID_AMOUNT', `${label} is required.`);
  const text = typeof value === 'bigint' ? value.toString() : String(value).trim();
  if (!/^\d{1,15}$/.test(text))
    fail(400, 'INVALID_AMOUNT', `${label} must be a whole number of cents.`);
  const amount = BigInt(text);
  if (!allowZero && amount === 0n)
    fail(400, 'INVALID_AMOUNT', `${label} must be greater than zero.`);
  return amount;
}

function decimalDays(value: unknown, label: string): string {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 366)
    fail(400, 'INVALID_DAYS', `${label} must be between 0 and 366 days.`);
  return (Math.round(parsed * 100) / 100).toFixed(2);
}

function optionalTime(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !TIME_OF_DAY.test(value))
    fail(400, 'INVALID_TIME', `${label} must be a 24-hour time such as 08:30.`);
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    fail(400, 'INVALID_INPUT', `${label} must be one of: ${allowed.join(', ')}.`);
  return value as T;
}

const EMPLOYMENT_TYPES = ['PERMANENT', 'CONTRACT', 'CASUAL', 'INTERN', 'LOCUM'] as const;
const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'EXITED'] as const;
const ATTENDANCE_STATUSES = [
  'PRESENT',
  'ABSENT',
  'LEAVE',
  'HOLIDAY',
  'OFF_DUTY',
  'TRAINING',
] as const;
const STATUTES = ['PAYE', 'NSSF', 'SHIF', 'AHL'] as const;
const STATUTORY_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;

/* ============================================================
   SHARED HELPERS
   ============================================================ */

async function audit(
  tx: Tx,
  scope: WorkforceScope,
  resource: string,
  resourceId: number | string,
  action: string,
  details: string,
) {
  await tx.insert(schema.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: String(scope.actorId),
    resource,
    resourceId: String(resourceId),
    action,
    details,
  });
}

function money(value: bigint | null | undefined): string {
  return (value ?? 0n).toString();
}

function day(value: string | null): string | null {
  return value ?? null;
}

/** Escape a user search term for a LIKE pattern. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/* ============================================================
   DEPARTMENTS AND DESIGNATIONS
   ============================================================ */

export async function listDepartments(scope: WorkforceScope) {
  const rows = await db
    .select()
    .from(schema.hrDepartments)
    .where(
      and(
        eq(schema.hrDepartments.tenantId, scope.tenantId),
        eq(schema.hrDepartments.facilityId, scope.facilityId),
      ),
    )
    .orderBy(asc(schema.hrDepartments.name));
  const counts = await db
    .select({
      departmentId: schema.hrEmployees.departmentId,
      employees: sql<number>`count(*)::int`,
    })
    .from(schema.hrEmployees)
    .where(
      and(
        eq(schema.hrEmployees.tenantId, scope.tenantId),
        eq(schema.hrEmployees.facilityId, scope.facilityId),
        eq(schema.hrEmployees.employmentStatus, 'ACTIVE'),
      ),
    )
    .groupBy(schema.hrEmployees.departmentId);
  const byDepartment = new Map(counts.map((row) => [row.departmentId, row.employees]));
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    activeEmployees: byDepartment.get(row.id) ?? 0,
  }));
}

export async function createDepartment(scope: WorkforceScope, input: Record<string, unknown>) {
  const code = requiredText(input.code, 'Department code', 24).toUpperCase();
  if (!/^[A-Z0-9_-]{2,24}$/.test(code))
    fail(
      400,
      'INVALID_CODE',
      'Department code must be 2–24 characters of A–Z, 0–9, dash or underscore.',
    );
  const name = requiredText(input.name, 'Department name', 120);
  const description = optionalText(input.description, 'Description', 500);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.hrDepartments)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        code,
        name,
        description,
        createdBy: scope.actorId,
      })
      .returning();
    await audit(
      tx,
      scope,
      'hr_department',
      row.id,
      'CREATE',
      `Created department ${code} — ${name}`,
    );
    return row;
  });
}

export async function updateDepartment(
  scope: WorkforceScope,
  id: number,
  input: Record<string, unknown>,
) {
  const name = requiredText(input.name, 'Department name', 120);
  const description = optionalText(input.description, 'Description', 500);
  const isActive = input.isActive === undefined ? true : Boolean(input.isActive);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.hrDepartments)
      .set({ name, description, isActive, updatedAt: new Date() })
      .where(
        and(
          eq(schema.hrDepartments.id, id),
          eq(schema.hrDepartments.tenantId, scope.tenantId),
          eq(schema.hrDepartments.facilityId, scope.facilityId),
        ),
      )
      .returning();
    if (!row) fail(404, 'DEPARTMENT_NOT_FOUND', 'Department not found in this facility.');
    await audit(tx, scope, 'hr_department', id, 'UPDATE', `Updated department ${row.code}`);
    return row;
  });
}

export async function listDesignations(scope: WorkforceScope) {
  return db
    .select({
      id: schema.hrDesignations.id,
      departmentId: schema.hrDesignations.departmentId,
      departmentName: schema.hrDepartments.name,
      title: schema.hrDesignations.title,
      grade: schema.hrDesignations.grade,
      isActive: schema.hrDesignations.isActive,
    })
    .from(schema.hrDesignations)
    .leftJoin(schema.hrDepartments, eq(schema.hrDesignations.departmentId, schema.hrDepartments.id))
    .where(
      and(
        eq(schema.hrDesignations.tenantId, scope.tenantId),
        eq(schema.hrDesignations.facilityId, scope.facilityId),
      ),
    )
    .orderBy(asc(schema.hrDesignations.title));
}

export async function createDesignation(scope: WorkforceScope, input: Record<string, unknown>) {
  const title = requiredText(input.title, 'Designation title', 120);
  const grade = optionalText(input.grade, 'Grade', 40);
  const departmentId = optionalPositiveId(input.departmentId, 'department');
  return db.transaction(async (tx) => {
    if (departmentId) {
      const [department] = await tx
        .select({ id: schema.hrDepartments.id })
        .from(schema.hrDepartments)
        .where(
          and(
            eq(schema.hrDepartments.id, departmentId),
            eq(schema.hrDepartments.tenantId, scope.tenantId),
            eq(schema.hrDepartments.facilityId, scope.facilityId),
          ),
        )
        .limit(1);
      if (!department) fail(404, 'DEPARTMENT_NOT_FOUND', 'Department not found in this facility.');
    }
    const [row] = await tx
      .insert(schema.hrDesignations)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        departmentId,
        title,
        grade,
        createdBy: scope.actorId,
      })
      .returning();
    await audit(tx, scope, 'hr_designation', row.id, 'CREATE', `Created designation ${title}`);
    return row;
  });
}

/* ============================================================
   EMPLOYEES
   ============================================================ */

const employeeSelection = {
  id: schema.hrEmployees.id,
  employeeNumber: schema.hrEmployees.employeeNumber,
  firstName: schema.hrEmployees.firstName,
  middleName: schema.hrEmployees.middleName,
  lastName: schema.hrEmployees.lastName,
  gender: schema.hrEmployees.gender,
  phone: schema.hrEmployees.phone,
  email: schema.hrEmployees.email,
  departmentId: schema.hrEmployees.departmentId,
  departmentName: schema.hrDepartments.name,
  designationId: schema.hrEmployees.designationId,
  designationTitle: schema.hrDesignations.title,
  managerId: schema.hrEmployees.managerId,
  employmentType: schema.hrEmployees.employmentType,
  employmentStatus: schema.hrEmployees.employmentStatus,
  hireDate: schema.hrEmployees.hireDate,
  exitDate: schema.hrEmployees.exitDate,
  baseSalaryCents: schema.hrEmployees.baseSalaryCents,
  kraPin: schema.hrEmployees.kraPin,
  nssfNumber: schema.hrEmployees.nssfNumber,
  shifNumber: schema.hrEmployees.shifNumber,
  userId: schema.hrEmployees.userId,
};

function presentEmployee<T extends { baseSalaryCents: bigint }>(row: T) {
  return { ...row, baseSalaryCents: money(row.baseSalaryCents) };
}

export async function listEmployees(
  scope: WorkforceScope,
  options: { search?: string; status?: string; departmentId?: number; limit?: number } = {},
) {
  const filters = [
    eq(schema.hrEmployees.tenantId, scope.tenantId),
    eq(schema.hrEmployees.facilityId, scope.facilityId),
  ];
  if (options.status && (EMPLOYMENT_STATUSES as readonly string[]).includes(options.status))
    filters.push(eq(schema.hrEmployees.employmentStatus, options.status));
  if (options.departmentId) filters.push(eq(schema.hrEmployees.departmentId, options.departmentId));
  if (options.search?.trim()) {
    const term = likePattern(options.search.trim().slice(0, 80));
    filters.push(
      or(
        sql`${schema.hrEmployees.firstName} ILIKE ${term}`,
        sql`${schema.hrEmployees.lastName} ILIKE ${term}`,
        sql`${schema.hrEmployees.employeeNumber} ILIKE ${term}`,
        sql`${schema.hrEmployees.phone} ILIKE ${term}`,
      )!,
    );
  }
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const rows = await db
    .select(employeeSelection)
    .from(schema.hrEmployees)
    .leftJoin(schema.hrDepartments, eq(schema.hrEmployees.departmentId, schema.hrDepartments.id))
    .leftJoin(schema.hrDesignations, eq(schema.hrEmployees.designationId, schema.hrDesignations.id))
    .where(and(...filters))
    .orderBy(asc(schema.hrEmployees.lastName), asc(schema.hrEmployees.firstName))
    .limit(limit);
  return rows.map((row) => presentEmployee(row));
}

export async function employeeDetail(scope: WorkforceScope, id: number) {
  const [row] = await db
    .select({
      ...employeeSelection,
      middleName: schema.hrEmployees.middleName,
      nationalId: schema.hrEmployees.nationalId,
      dateOfBirth: schema.hrEmployees.dateOfBirth,
      bankName: schema.hrEmployees.bankName,
      bankAccountMasked: schema.hrEmployees.bankAccountMasked,
      notes: schema.hrEmployees.notes,
      createdAt: schema.hrEmployees.createdAt,
    })
    .from(schema.hrEmployees)
    .leftJoin(schema.hrDepartments, eq(schema.hrEmployees.departmentId, schema.hrDepartments.id))
    .leftJoin(schema.hrDesignations, eq(schema.hrEmployees.designationId, schema.hrDesignations.id))
    .where(
      and(
        eq(schema.hrEmployees.id, id),
        eq(schema.hrEmployees.tenantId, scope.tenantId),
        eq(schema.hrEmployees.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!row) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found in this facility.');

  const [documents, components, payslips, attendance] = await Promise.all([
    db
      .select()
      .from(schema.hrEmployeeDocuments)
      .where(
        and(
          eq(schema.hrEmployeeDocuments.employeeId, id),
          eq(schema.hrEmployeeDocuments.facilityId, scope.facilityId),
        ),
      )
      .orderBy(desc(schema.hrEmployeeDocuments.createdAt)),
    db
      .select()
      .from(schema.payrollEmployeeComponents)
      .where(
        and(
          eq(schema.payrollEmployeeComponents.employeeId, id),
          eq(schema.payrollEmployeeComponents.facilityId, scope.facilityId),
        ),
      )
      .orderBy(desc(schema.payrollEmployeeComponents.effectiveFrom)),
    db
      .select({
        id: schema.payrollPayslips.id,
        runId: schema.payrollPayslips.runId,
        grossCents: schema.payrollPayslips.grossCents,
        netCents: schema.payrollPayslips.netCents,
        createdAt: schema.payrollPayslips.createdAt,
        periodName: schema.payrollPeriods.name,
        payDate: schema.payrollPeriods.payDate,
        runStatus: schema.payrollRuns.status,
      })
      .from(schema.payrollPayslips)
      .innerJoin(schema.payrollRuns, eq(schema.payrollPayslips.runId, schema.payrollRuns.id))
      .innerJoin(schema.payrollPeriods, eq(schema.payrollRuns.periodId, schema.payrollPeriods.id))
      .where(
        and(
          eq(schema.payrollPayslips.employeeId, id),
          eq(schema.payrollPayslips.facilityId, scope.facilityId),
        ),
      )
      .orderBy(desc(schema.payrollPeriods.payDate))
      .limit(24),
    db
      .select()
      .from(schema.hrAttendance)
      .where(
        and(
          eq(schema.hrAttendance.employeeId, id),
          eq(schema.hrAttendance.facilityId, scope.facilityId),
        ),
      )
      .orderBy(desc(schema.hrAttendance.workDate))
      .limit(14),
  ]);

  return {
    ...presentEmployee(row),
    documents,
    components: components.map((component) => ({
      ...component,
      amountCents: money(component.amountCents),
    })),
    payslips: payslips.map((slip) => ({
      ...slip,
      grossCents: money(slip.grossCents),
      netCents: money(slip.netCents),
    })),
    attendance,
  };
}

async function assertDepartmentAndDesignation(
  tx: Tx,
  scope: WorkforceScope,
  departmentId: number | null,
  designationId: number | null,
) {
  if (departmentId) {
    const [department] = await tx
      .select({ id: schema.hrDepartments.id })
      .from(schema.hrDepartments)
      .where(
        and(
          eq(schema.hrDepartments.id, departmentId),
          eq(schema.hrDepartments.tenantId, scope.tenantId),
          eq(schema.hrDepartments.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!department) fail(404, 'DEPARTMENT_NOT_FOUND', 'Department not found in this facility.');
  }
  if (designationId) {
    const [designation] = await tx
      .select({ id: schema.hrDesignations.id })
      .from(schema.hrDesignations)
      .where(
        and(
          eq(schema.hrDesignations.id, designationId),
          eq(schema.hrDesignations.tenantId, scope.tenantId),
          eq(schema.hrDesignations.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!designation) fail(404, 'DESIGNATION_NOT_FOUND', 'Designation not found in this facility.');
  }
}

function employeeFields(input: Record<string, unknown>) {
  const firstName = requiredText(input.firstName, 'First name', 80);
  const middleName = optionalText(input.middleName, 'Middle name', 80);
  const lastName = requiredText(input.lastName, 'Last name', 80);
  const employeeNumber = requiredText(input.employeeNumber, 'Employee number', 40);
  const gender = optionalText(input.gender, 'Gender', 20);
  const dateOfBirth = optionalIsoDate(input.dateOfBirth, 'Date of birth');
  const nationalId = optionalText(input.nationalId, 'National ID', 40);
  const phone = optionalText(input.phone, 'Phone', 40);
  const email = optionalText(input.email, 'Email', 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail(400, 'INVALID_EMAIL', 'Email address is not valid.');
  const employmentType = enumValue(
    input.employmentType ?? 'PERMANENT',
    EMPLOYMENT_TYPES,
    'Employment type',
  );
  const hireDate = isoDate(input.hireDate, 'Hire date');
  const baseSalaryCents = cents(input.baseSalaryCents ?? 0, 'Base salary');
  const departmentId = optionalPositiveId(input.departmentId, 'department');
  const designationId = optionalPositiveId(input.designationId, 'designation');
  const managerId = optionalPositiveId(input.managerId, 'manager');
  const bankName = optionalText(input.bankName, 'Bank name', 80);
  const bankAccountMasked = optionalText(input.bankAccountMasked, 'Bank account', 40);
  if (bankAccountMasked && !/^(?=.*[*xX])[*xX\s\d-]{4,40}$/.test(bankAccountMasked))
    fail(
      400,
      'UNMASKED_BANK_ACCOUNT',
      'Store only a masked bank account (for example ****1234), never the full number.',
    );
  const kraPin = optionalText(input.kraPin, 'KRA PIN', 20);
  const nssfNumber = optionalText(input.nssfNumber, 'NSSF number', 30);
  const shifNumber = optionalText(input.shifNumber, 'SHIF number', 30);
  const notes = optionalText(input.notes, 'Notes', 1000);
  return {
    employeeNumber,
    firstName,
    middleName,
    lastName,
    gender,
    dateOfBirth,
    nationalId,
    phone,
    email,
    departmentId,
    designationId,
    managerId,
    employmentType,
    hireDate,
    baseSalaryCents,
    bankName,
    bankAccountMasked,
    kraPin,
    nssfNumber,
    shifNumber,
    notes,
  };
}

export async function createEmployee(scope: WorkforceScope, input: Record<string, unknown>) {
  const fields = employeeFields(input);
  return db.transaction(async (tx) => {
    await assertDepartmentAndDesignation(tx, scope, fields.departmentId, fields.designationId);
    if (fields.managerId) {
      const [manager] = await tx
        .select({ id: schema.hrEmployees.id })
        .from(schema.hrEmployees)
        .where(
          and(
            eq(schema.hrEmployees.id, fields.managerId),
            eq(schema.hrEmployees.facilityId, scope.facilityId),
          ),
        )
        .limit(1);
      if (!manager) fail(404, 'MANAGER_NOT_FOUND', 'Reporting manager not found in this facility.');
    }
    const [row] = await tx
      .insert(schema.hrEmployees)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        ...fields,
        createdBy: scope.actorId,
      })
      .returning();
    await audit(
      tx,
      scope,
      'hr_employee',
      row.id,
      'CREATE',
      `Registered employee ${row.employeeNumber} — ${row.firstName} ${row.lastName}`,
    );
    return { ...row, baseSalaryCents: money(row.baseSalaryCents) };
  });
}

export async function updateEmployee(
  scope: WorkforceScope,
  id: number,
  input: Record<string, unknown>,
) {
  const fields = employeeFields(input);
  return db.transaction(async (tx) => {
    await assertDepartmentAndDesignation(tx, scope, fields.departmentId, fields.designationId);
    const [row] = await tx
      .update(schema.hrEmployees)
      .set({ ...fields, updatedAt: new Date() })
      .where(
        and(
          eq(schema.hrEmployees.id, id),
          eq(schema.hrEmployees.tenantId, scope.tenantId),
          eq(schema.hrEmployees.facilityId, scope.facilityId),
        ),
      )
      .returning();
    if (!row) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found in this facility.');
    await audit(tx, scope, 'hr_employee', id, 'UPDATE', `Updated employee ${row.employeeNumber}`);
    return { ...row, baseSalaryCents: money(row.baseSalaryCents) };
  });
}

export async function changeEmployeeStatus(
  scope: WorkforceScope,
  id: number,
  input: Record<string, unknown>,
) {
  const status = enumValue(input.status, EMPLOYMENT_STATUSES, 'Employment status');
  const exitDate = status === 'EXITED' ? isoDate(input.exitDate, 'Exit date') : null;
  if (status === 'EXITED' && !exitDate)
    fail(400, 'EXIT_DATE_REQUIRED', 'An exit date is required when an employee leaves.');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.hrEmployees)
      .set({ employmentStatus: status, exitDate, updatedAt: new Date() })
      .where(
        and(
          eq(schema.hrEmployees.id, id),
          eq(schema.hrEmployees.tenantId, scope.tenantId),
          eq(schema.hrEmployees.facilityId, scope.facilityId),
        ),
      )
      .returning();
    if (!row) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found in this facility.');
    await audit(tx, scope, 'hr_employee', id, 'STATUS_CHANGE', `Status changed to ${status}`);
    return { ...row, baseSalaryCents: money(row.baseSalaryCents) };
  });
}

export async function addEmployeeDocument(
  scope: WorkforceScope,
  employeeId: number,
  input: Record<string, unknown>,
) {
  const documentType = requiredText(input.documentType, 'Document type', 60);
  const title = requiredText(input.title, 'Document title', 160);
  if (title.length < 2) fail(400, 'INVALID_TITLE', 'Document title must be at least 2 characters.');
  const fileReference = optionalText(input.fileReference, 'File reference', 300);
  const issuedOn = optionalIsoDate(input.issuedOn, 'Issue date');
  const expiresOn = optionalIsoDate(input.expiresOn, 'Expiry date');
  if (issuedOn && expiresOn && expiresOn < issuedOn)
    fail(400, 'INVALID_DATES', 'Expiry date cannot be before the issue date.');
  return db.transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: schema.hrEmployees.id })
      .from(schema.hrEmployees)
      .where(
        and(
          eq(schema.hrEmployees.id, employeeId),
          eq(schema.hrEmployees.tenantId, scope.tenantId),
          eq(schema.hrEmployees.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!employee) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found in this facility.');
    const [row] = await tx
      .insert(schema.hrEmployeeDocuments)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        employeeId,
        documentType,
        title,
        fileReference,
        issuedOn,
        expiresOn,
        uploadedBy: scope.actorId,
      })
      .returning();
    await audit(tx, scope, 'hr_employee', employeeId, 'DOCUMENT_ADDED', `Document added: ${title}`);
    return row;
  });
}

/* ============================================================
   ATTENDANCE, ROSTER AND SHIFTS
   ============================================================ */

export async function listShifts(scope: WorkforceScope) {
  return db
    .select()
    .from(schema.hrShifts)
    .where(
      and(
        eq(schema.hrShifts.tenantId, scope.tenantId),
        eq(schema.hrShifts.facilityId, scope.facilityId),
      ),
    )
    .orderBy(asc(schema.hrShifts.startTime));
}

export async function createShift(scope: WorkforceScope, input: Record<string, unknown>) {
  const name = requiredText(input.name, 'Shift name', 60);
  const startTime = optionalTime(input.startTime, 'Start time');
  const endTime = optionalTime(input.endTime, 'End time');
  if (!startTime || !endTime) fail(400, 'INVALID_TIME', 'Start and end times are required.');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.hrShifts)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        name,
        startTime,
        endTime,
        createdBy: scope.actorId,
      })
      .returning();
    await audit(tx, scope, 'hr_shift', row.id, 'CREATE', `Created shift ${name}`);
    return row;
  });
}

export async function recordAttendance(scope: WorkforceScope, input: Record<string, unknown>) {
  const employeeId = positiveId(input.employeeId, 'employee');
  const workDate = isoDate(input.workDate, 'Work date');
  const status = enumValue(input.status, ATTENDANCE_STATUSES, 'Attendance status');
  const checkIn = optionalTime(input.checkIn, 'Check-in time');
  const checkOut = optionalTime(input.checkOut, 'Check-out time');
  const hours =
    input.hours === undefined || input.hours === null || input.hours === ''
      ? null
      : decimalDays(input.hours, 'Hours worked');
  const notes = optionalText(input.notes, 'Notes', 500);
  return db.transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: schema.hrEmployees.id, status: schema.hrEmployees.employmentStatus })
      .from(schema.hrEmployees)
      .where(
        and(
          eq(schema.hrEmployees.id, employeeId),
          eq(schema.hrEmployees.tenantId, scope.tenantId),
          eq(schema.hrEmployees.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!employee) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found in this facility.');
    if (employee.status === 'EXITED')
      fail(409, 'EMPLOYEE_EXITED', 'Attendance cannot be recorded for an exited employee.');
    const [row] = await tx
      .insert(schema.hrAttendance)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        employeeId,
        workDate,
        status,
        checkIn,
        checkOut,
        hours,
        notes,
        recordedBy: scope.actorId,
      })
      .onConflictDoUpdate({
        target: [schema.hrAttendance.employeeId, schema.hrAttendance.workDate],
        set: {
          status,
          checkIn,
          checkOut,
          hours,
          notes,
          recordedBy: scope.actorId,
          updatedAt: new Date(),
        },
      })
      .returning();
    await audit(
      tx,
      scope,
      'hr_attendance',
      row.id,
      'RECORD',
      `Attendance ${status} for employee ${employeeId} on ${workDate}`,
    );
    return row;
  });
}

export async function attendanceForDate(scope: WorkforceScope, date: string) {
  const workDate = isoDate(date, 'Work date');
  const [records, employees] = await Promise.all([
    db
      .select({
        id: schema.hrAttendance.id,
        employeeId: schema.hrAttendance.employeeId,
        status: schema.hrAttendance.status,
        checkIn: schema.hrAttendance.checkIn,
        checkOut: schema.hrAttendance.checkOut,
        hours: schema.hrAttendance.hours,
        notes: schema.hrAttendance.notes,
      })
      .from(schema.hrAttendance)
      .where(
        and(
          eq(schema.hrAttendance.tenantId, scope.tenantId),
          eq(schema.hrAttendance.facilityId, scope.facilityId),
          eq(schema.hrAttendance.workDate, workDate),
        ),
      ),
    listEmployees(scope, { status: undefined }),
  ]);
  const byEmployee = new Map(records.map((record) => [record.employeeId, record]));
  const active = employees.filter((employee) => employee.employmentStatus !== 'EXITED');
  return {
    date: workDate,
    summary: {
      expected: active.length,
      recorded: records.length,
      present: records.filter((record) => record.status === 'PRESENT').length,
      absent: records.filter((record) => record.status === 'ABSENT').length,
    },
    rows: active.map((employee) => ({
      employeeId: employee.id,
      employeeNumber: employee.employeeNumber,
      name: `${employee.firstName} ${employee.lastName}`,
      departmentName: employee.departmentName,
      status: byEmployee.get(employee.id)?.status ?? null,
      checkIn: byEmployee.get(employee.id)?.checkIn ?? null,
      checkOut: byEmployee.get(employee.id)?.checkOut ?? null,
      hours: byEmployee.get(employee.id)?.hours ?? null,
    })),
  };
}

export async function listRoster(scope: WorkforceScope, from: string, to: string) {
  const start = isoDate(from, 'From date');
  const end = isoDate(to, 'To date');
  if (end < start) fail(400, 'INVALID_RANGE', 'The end date cannot be before the start date.');
  return db
    .select({
      id: schema.hrRosterEntries.id,
      employeeId: schema.hrRosterEntries.employeeId,
      employeeName: sql<string>`${schema.hrEmployees.firstName} || ' ' || ${schema.hrEmployees.lastName}`,
      workDate: schema.hrRosterEntries.workDate,
      shiftId: schema.hrRosterEntries.shiftId,
      shiftName: schema.hrShifts.name,
      startTime: schema.hrShifts.startTime,
      endTime: schema.hrShifts.endTime,
      notes: schema.hrRosterEntries.notes,
    })
    .from(schema.hrRosterEntries)
    .innerJoin(schema.hrEmployees, eq(schema.hrRosterEntries.employeeId, schema.hrEmployees.id))
    .innerJoin(schema.hrShifts, eq(schema.hrRosterEntries.shiftId, schema.hrShifts.id))
    .where(
      and(
        eq(schema.hrRosterEntries.tenantId, scope.tenantId),
        eq(schema.hrRosterEntries.facilityId, scope.facilityId),
        gte(schema.hrRosterEntries.workDate, start),
        lte(schema.hrRosterEntries.workDate, end),
      ),
    )
    .orderBy(asc(schema.hrRosterEntries.workDate), asc(schema.hrShifts.startTime));
}

export async function saveRosterEntry(scope: WorkforceScope, input: Record<string, unknown>) {
  const employeeId = positiveId(input.employeeId, 'employee');
  const shiftId = positiveId(input.shiftId, 'shift');
  const workDate = isoDate(input.workDate, 'Work date');
  const notes = optionalText(input.notes, 'Notes', 300);
  return db.transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: schema.hrEmployees.id })
      .from(schema.hrEmployees)
      .where(
        and(
          eq(schema.hrEmployees.id, employeeId),
          eq(schema.hrEmployees.tenantId, scope.tenantId),
          eq(schema.hrEmployees.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!employee) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found in this facility.');
    const [shift] = await tx
      .select({ id: schema.hrShifts.id })
      .from(schema.hrShifts)
      .where(and(eq(schema.hrShifts.id, shiftId), eq(schema.hrShifts.facilityId, scope.facilityId)))
      .limit(1);
    if (!shift) fail(404, 'SHIFT_NOT_FOUND', 'Shift not found in this facility.');
    const [row] = await tx
      .insert(schema.hrRosterEntries)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        employeeId,
        shiftId,
        workDate,
        notes,
        createdBy: scope.actorId,
      })
      .onConflictDoUpdate({
        target: [schema.hrRosterEntries.employeeId, schema.hrRosterEntries.workDate],
        set: { shiftId, notes, createdBy: scope.actorId },
      })
      .returning();
    await audit(
      tx,
      scope,
      'hr_roster',
      row.id,
      'SAVE',
      `Roster set for employee ${employeeId} on ${workDate}`,
    );
    return row;
  });
}

/* ============================================================
   LEAVE
   ============================================================ */

export async function listLeaveTypes(scope: WorkforceScope) {
  return db
    .select()
    .from(schema.hrLeaveTypes)
    .where(
      and(
        eq(schema.hrLeaveTypes.tenantId, scope.tenantId),
        eq(schema.hrLeaveTypes.facilityId, scope.facilityId),
      ),
    )
    .orderBy(asc(schema.hrLeaveTypes.name));
}

export async function createLeaveType(scope: WorkforceScope, input: Record<string, unknown>) {
  const code = requiredText(input.code, 'Leave type code', 24).toUpperCase();
  if (!/^[A-Z0-9_]{2,24}$/.test(code))
    fail(400, 'INVALID_CODE', 'Leave type code must be 2–24 characters of A–Z, 0–9 or underscore.');
  const name = requiredText(input.name, 'Leave type name', 80);
  const entitlement =
    input.annualEntitlementDays === undefined ? 0 : Number(input.annualEntitlementDays);
  if (!Number.isFinite(entitlement) || entitlement < 0 || entitlement > 366)
    fail(400, 'INVALID_DAYS', 'Annual entitlement must be between 0 and 366 days.');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.hrLeaveTypes)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        code,
        name,
        annualEntitlementDays: entitlement.toFixed(2),
        paid: input.paid === undefined ? true : Boolean(input.paid),
        requiresApproval:
          input.requiresApproval === undefined ? true : Boolean(input.requiresApproval),
        createdBy: scope.actorId,
      })
      .returning();
    await audit(tx, scope, 'hr_leave_type', row.id, 'CREATE', `Created leave type ${code}`);
    return row;
  });
}

export async function listLeaveRequests(scope: WorkforceScope, status?: string) {
  const filters = [
    eq(schema.hrLeaveRequests.tenantId, scope.tenantId),
    eq(schema.hrLeaveRequests.facilityId, scope.facilityId),
  ];
  if (status && ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status))
    filters.push(eq(schema.hrLeaveRequests.status, status));
  return db
    .select({
      id: schema.hrLeaveRequests.id,
      employeeId: schema.hrLeaveRequests.employeeId,
      employeeName: sql<string>`${schema.hrEmployees.firstName} || ' ' || ${schema.hrEmployees.lastName}`,
      employeeNumber: schema.hrEmployees.employeeNumber,
      leaveTypeId: schema.hrLeaveRequests.leaveTypeId,
      leaveTypeName: schema.hrLeaveTypes.name,
      startDate: schema.hrLeaveRequests.startDate,
      endDate: schema.hrLeaveRequests.endDate,
      days: schema.hrLeaveRequests.days,
      reason: schema.hrLeaveRequests.reason,
      status: schema.hrLeaveRequests.status,
      decidedAt: schema.hrLeaveRequests.decidedAt,
      decisionNote: schema.hrLeaveRequests.decisionNote,
      createdAt: schema.hrLeaveRequests.createdAt,
    })
    .from(schema.hrLeaveRequests)
    .innerJoin(schema.hrEmployees, eq(schema.hrLeaveRequests.employeeId, schema.hrEmployees.id))
    .innerJoin(schema.hrLeaveTypes, eq(schema.hrLeaveRequests.leaveTypeId, schema.hrLeaveTypes.id))
    .where(and(...filters))
    .orderBy(desc(schema.hrLeaveRequests.createdAt))
    .limit(300);
}

export async function createLeaveRequest(scope: WorkforceScope, input: Record<string, unknown>) {
  const employeeId = positiveId(input.employeeId, 'employee');
  const leaveTypeId = positiveId(input.leaveTypeId, 'leave type');
  const startDate = isoDate(input.startDate, 'Start date');
  const endDate = isoDate(input.endDate, 'End date');
  if (endDate < startDate)
    fail(400, 'INVALID_RANGE', 'The end date cannot be before the start date.');
  const days = decimalDays(input.days, 'Days requested');
  const reason = optionalText(input.reason, 'Reason', 500);
  return db.transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: schema.hrEmployees.id })
      .from(schema.hrEmployees)
      .where(
        and(
          eq(schema.hrEmployees.id, employeeId),
          eq(schema.hrEmployees.tenantId, scope.tenantId),
          eq(schema.hrEmployees.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!employee) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found in this facility.');
    const [leaveType] = await tx
      .select({ id: schema.hrLeaveTypes.id })
      .from(schema.hrLeaveTypes)
      .where(
        and(
          eq(schema.hrLeaveTypes.id, leaveTypeId),
          eq(schema.hrLeaveTypes.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!leaveType) fail(404, 'LEAVE_TYPE_NOT_FOUND', 'Leave type not found in this facility.');
    const [overlap] = await tx
      .select({ id: schema.hrLeaveRequests.id })
      .from(schema.hrLeaveRequests)
      .where(
        and(
          eq(schema.hrLeaveRequests.employeeId, employeeId),
          inArray(schema.hrLeaveRequests.status, ['PENDING', 'APPROVED']),
          lte(schema.hrLeaveRequests.startDate, endDate),
          gte(schema.hrLeaveRequests.endDate, startDate),
        ),
      )
      .limit(1);
    if (overlap)
      fail(
        409,
        'LEAVE_OVERLAP',
        'This employee already has pending or approved leave in that period.',
      );
    const [row] = await tx
      .insert(schema.hrLeaveRequests)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        employeeId,
        leaveTypeId,
        startDate,
        endDate,
        days,
        reason,
        createdBy: scope.actorId,
      })
      .returning();
    await audit(
      tx,
      scope,
      'hr_leave_request',
      row.id,
      'CREATE',
      `Leave requested for employee ${employeeId}: ${startDate} to ${endDate}`,
    );
    return row;
  });
}

export async function decideLeaveRequest(
  scope: WorkforceScope,
  id: number,
  input: Record<string, unknown>,
) {
  const decision = enumValue(input.decision, ['APPROVED', 'REJECTED'] as const, 'Decision');
  const note = optionalText(input.note, 'Decision note', 500);
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(schema.hrLeaveRequests)
      .where(
        and(
          eq(schema.hrLeaveRequests.id, id),
          eq(schema.hrLeaveRequests.tenantId, scope.tenantId),
          eq(schema.hrLeaveRequests.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!request) fail(404, 'LEAVE_REQUEST_NOT_FOUND', 'Leave request not found in this facility.');
    if (request.status !== 'PENDING')
      fail(
        409,
        'LEAVE_ALREADY_DECIDED',
        `This request is already ${request.status.toLowerCase()}.`,
      );
    if (request.createdBy === scope.actorId)
      fail(
        403,
        'LEAVE_SELF_APPROVAL',
        'A leave request must be decided by someone other than the person who recorded it.',
      );
    const [row] = await tx
      .update(schema.hrLeaveRequests)
      .set({
        status: decision,
        decidedBy: scope.actorId,
        decidedAt: new Date(),
        decisionNote: note,
      })
      .where(eq(schema.hrLeaveRequests.id, id))
      .returning();
    if (decision === 'APPROVED') {
      await tx
        .update(schema.hrEmployees)
        .set({ employmentStatus: 'ON_LEAVE', updatedAt: new Date() })
        .where(
          and(
            eq(schema.hrEmployees.id, request.employeeId),
            eq(schema.hrEmployees.employmentStatus, 'ACTIVE'),
          ),
        );
    }
    await audit(
      tx,
      scope,
      'hr_leave_request',
      id,
      decision,
      note ?? `Leave ${decision.toLowerCase()}`,
    );
    return row;
  });
}

export async function leaveBalances(scope: WorkforceScope) {
  const year = new Date().getUTCFullYear();
  const rows = await db
    .select({
      employeeId: schema.hrEmployees.id,
      employeeNumber: schema.hrEmployees.employeeNumber,
      name: sql<string>`${schema.hrEmployees.firstName} || ' ' || ${schema.hrEmployees.lastName}`,
      leaveTypeId: schema.hrLeaveTypes.id,
      leaveTypeName: schema.hrLeaveTypes.name,
      entitlement: schema.hrLeaveTypes.annualEntitlementDays,
      taken: sql<string>`coalesce(sum(CASE WHEN ${schema.hrLeaveRequests.status} = 'APPROVED'
        AND extract(year from ${schema.hrLeaveRequests.startDate}) = ${year}
        THEN ${schema.hrLeaveRequests.days} ELSE 0 END), 0)`,
    })
    .from(schema.hrEmployees)
    .crossJoin(schema.hrLeaveTypes)
    .leftJoin(
      schema.hrLeaveRequests,
      and(
        eq(schema.hrLeaveRequests.employeeId, schema.hrEmployees.id),
        eq(schema.hrLeaveRequests.leaveTypeId, schema.hrLeaveTypes.id),
      ),
    )
    .where(
      and(
        eq(schema.hrEmployees.tenantId, scope.tenantId),
        eq(schema.hrEmployees.facilityId, scope.facilityId),
        eq(schema.hrEmployees.employmentStatus, 'ACTIVE'),
        eq(schema.hrLeaveTypes.isActive, true),
        eq(schema.hrLeaveTypes.facilityId, scope.facilityId),
      ),
    )
    .groupBy(
      schema.hrEmployees.id,
      schema.hrEmployees.employeeNumber,
      schema.hrEmployees.firstName,
      schema.hrEmployees.lastName,
      schema.hrLeaveTypes.id,
      schema.hrLeaveTypes.name,
      schema.hrLeaveTypes.annualEntitlementDays,
    )
    .orderBy(asc(schema.hrEmployees.lastName), asc(schema.hrLeaveTypes.name));
  return rows.map((row) => ({
    ...row,
    entitlement: Number(row.entitlement),
    taken: Number(row.taken),
    remaining: Math.max(0, Number(row.entitlement) - Number(row.taken)),
  }));
}

/* ============================================================
   PAYROLL CONFIGURATION — STATUTORY VERSIONS
   ============================================================ */

type BandInput = {
  sequence?: number;
  lowerBoundCents?: string | number;
  upperBoundCents?: string | number | null;
  employeeRateBp?: string | number;
  employerRateBp?: string | number;
  employeeFixedCents?: string | number;
  employerFixedCents?: string | number;
  employeeCapCents?: string | number | null;
  employerCapCents?: string | number | null;
  reliefCents?: string | number;
};

function optionalCents(value: unknown, label: string): bigint | null {
  if (value === undefined || value === null || value === '') return null;
  return cents(value, label, { allowZero: true });
}

function basisPoints(value: unknown, label: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000)
    fail(400, 'INVALID_RATE', `${label} must be 0–10000 basis points (1% = 100).`);
  return parsed;
}

function normalizeBands(statute: string, raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0)
    fail(400, 'BANDS_REQUIRED', 'At least one band is required.');
  const bands = raw.map((entry, index) => {
    const band = (entry ?? {}) as BandInput;
    const lowerBoundCents = cents(band.lowerBoundCents ?? 0, `Band ${index + 1} lower bound`);
    const upperBoundCents = optionalCents(band.upperBoundCents, `Band ${index + 1} upper bound`);
    if (upperBoundCents !== null && upperBoundCents <= lowerBoundCents)
      fail(400, 'INVALID_BAND', `Band ${index + 1} upper bound must exceed its lower bound.`);
    return {
      sequence: index + 1,
      lowerBoundCents,
      upperBoundCents,
      employeeRateBp: basisPoints(band.employeeRateBp, `Band ${index + 1} employee rate`),
      employerRateBp: basisPoints(band.employerRateBp, `Band ${index + 1} employer rate`),
      employeeFixedCents: cents(band.employeeFixedCents ?? 0, `Band ${index + 1} employee fixed`),
      employerFixedCents: cents(band.employerFixedCents ?? 0, `Band ${index + 1} employer fixed`),
      employeeCapCents: optionalCents(band.employeeCapCents, `Band ${index + 1} employee cap`),
      employerCapCents: optionalCents(band.employerCapCents, `Band ${index + 1} employer cap`),
      reliefCents: cents(band.reliefCents ?? 0, `Band ${index + 1} relief`),
    };
  });
  if (statute !== 'PAYE' && bands.length !== 1)
    fail(400, 'BAND_SHAPE', `${statute} must be recorded as exactly one band.`);
  if (statute === 'PAYE') {
    const sorted = [...bands].sort((a, b) => (a.lowerBoundCents < b.lowerBoundCents ? -1 : 1));
    if (sorted[0].lowerBoundCents !== 0n || sorted.at(-1)!.upperBoundCents !== null)
      fail(400, 'BAND_COVERAGE', 'PAYE bands must cover zero through an open-ended final band.');
    for (let index = 1; index < sorted.length; index += 1) {
      const previousUpper = sorted[index - 1].upperBoundCents;
      if (previousUpper === null)
        fail(400, 'INVALID_BAND', 'Only the final PAYE band may be open-ended.');
      if (previousUpper !== sorted[index].lowerBoundCents)
        fail(
          400,
          'BAND_GAP',
          'PAYE bands must be contiguous: each band starts where the last ends.',
        );
    }
  }
  return bands;
}

export async function listStatutoryVersions(scope: WorkforceScope) {
  const versions = await db
    .select()
    .from(schema.payrollStatutoryVersions)
    .where(
      and(
        eq(schema.payrollStatutoryVersions.tenantId, scope.tenantId),
        eq(schema.payrollStatutoryVersions.facilityId, scope.facilityId),
      ),
    )
    .orderBy(desc(schema.payrollStatutoryVersions.effectiveFrom));
  if (versions.length === 0) return [];
  const bands = await db
    .select()
    .from(schema.payrollStatutoryBands)
    .where(
      inArray(
        schema.payrollStatutoryBands.versionId,
        versions.map((version) => version.id),
      ),
    )
    .orderBy(asc(schema.payrollStatutoryBands.sequence));
  return versions.map((version) => ({
    ...version,
    bands: bands
      .filter((band) => band.versionId === version.id)
      .map((band) => ({
        sequence: band.sequence,
        lowerBoundCents: money(band.lowerBoundCents),
        upperBoundCents: band.upperBoundCents === null ? null : money(band.upperBoundCents),
        employeeRateBp: band.employeeRateBp,
        employerRateBp: band.employerRateBp,
        employeeFixedCents: money(band.employeeFixedCents),
        employerFixedCents: money(band.employerFixedCents),
        employeeCapCents: band.employeeCapCents === null ? null : money(band.employeeCapCents),
        employerCapCents: band.employerCapCents === null ? null : money(band.employerCapCents),
        reliefCents: money(band.reliefCents),
      })),
  }));
}

export async function createStatutoryVersion(
  scope: WorkforceScope,
  input: Record<string, unknown>,
) {
  const statute = enumValue(input.statute, STATUTES, 'Statute');
  const label = requiredText(input.label, 'Version label', 120);
  const effectiveFrom = isoDate(input.effectiveFrom, 'Effective from');
  const effectiveTo = optionalIsoDate(input.effectiveTo, 'Effective to');
  if (effectiveTo && effectiveTo < effectiveFrom)
    fail(400, 'INVALID_RANGE', 'Effective-to cannot be before effective-from.');
  const authority = requiredText(input.authority, 'Authority', 160);
  const sourceReference = requiredText(input.sourceReference, 'Source reference', 500);
  if (sourceReference.trim().length < 8)
    fail(
      400,
      'SOURCE_REQUIRED',
      'Record the authority publication this version comes from (at least 8 characters).',
    );
  const basis = enumValue(input.basis ?? 'GROSS', ['GROSS'] as const, 'Basis');
  const notes = optionalText(input.notes, 'Notes', 1000);
  const rawConfig = input.calculationConfig as Record<string, unknown> | undefined;
  if (
    rawConfig &&
    (typeof rawConfig !== 'object' ||
      ['deductNssf', 'deductShif', 'deductAhl'].some((k) => typeof rawConfig[k] !== 'boolean'))
  )
    fail(
      400,
      'INVALID_CALCULATION_CONFIG',
      'Explicit contribution deduction settings are required.',
    );
  const calculationConfig = rawConfig
    ? {
        deductNssf: rawConfig.deductNssf as boolean,
        deductShif: rawConfig.deductShif as boolean,
        deductAhl: rawConfig.deductAhl as boolean,
        employeeMinimumCents: cents(
          rawConfig.employeeMinimumCents ?? '0',
          'Employee minimum',
        ).toString(),
        employerMinimumCents: cents(
          rawConfig.employerMinimumCents ?? '0',
          'Employer minimum',
        ).toString(),
      }
    : null;
  const bands = normalizeBands(statute, input.bands);
  // These employer charges/minima have no supported ledger representation. Never silently
  // accept a new explicit policy whose requested amounts would be discarded by the engine.
  if (
    calculationConfig &&
    ((['PAYE', 'SHIF'].includes(statute) &&
      (BigInt(calculationConfig.employerMinimumCents) > 0n ||
        bands.some((b) => b.employerRateBp !== 0 || b.employerFixedCents !== 0n))) ||
      (statute === 'PAYE' && BigInt(calculationConfig.employeeMinimumCents) > 0n))
  )
    fail(
      400,
      'UNSUPPORTED_STATUTORY_POLICY',
      'PAYE/SHIF employer charges and a PAYE contribution minimum are not supported. Record a supported authority policy; these inputs must not be silently discarded.',
    );

  if (
    calculationConfig &&
    bands.some(
      (b) =>
        (b.employeeCapCents !== null &&
          BigInt(calculationConfig.employeeMinimumCents) > b.employeeCapCents) ||
        (b.employerCapCents !== null &&
          BigInt(calculationConfig.employerMinimumCents) > b.employerCapCents),
    )
  )
    fail(400, 'INVALID_MINIMUM', 'A minimum cannot exceed the contribution cap.');

  return db.transaction(async (tx) => {
    const [version] = await tx
      .insert(schema.payrollStatutoryVersions)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        statute,
        label,
        effectiveFrom,
        effectiveTo,
        authority,
        sourceReference,
        basis,
        calculationConfig,
        status: 'DRAFT',
        notes,
        createdBy: scope.actorId,
      })
      .returning();
    await tx.insert(schema.payrollStatutoryBands).values(
      bands.map((band) => ({
        versionId: version.id,
        ...band,
      })),
    );
    await audit(
      tx,
      scope,
      'payroll_statutory_version',
      version.id,
      'CREATE',
      `${statute} version ${label} effective ${effectiveFrom}`,
    );
    return version;
  });
}

export async function setStatutoryVersionStatus(
  scope: WorkforceScope,
  id: number,
  input: Record<string, unknown>,
) {
  const status = enumValue(input.status, ['ACTIVE', 'RETIRED'] as const, 'Status');
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended('payroll-statutory', ${scope.facilityId}))`,
    );

    const [version] = await tx
      .select()
      .from(schema.payrollStatutoryVersions)
      .where(
        and(
          eq(schema.payrollStatutoryVersions.id, id),
          eq(schema.payrollStatutoryVersions.tenantId, scope.tenantId),
          eq(schema.payrollStatutoryVersions.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!version) fail(404, 'STATUTORY_VERSION_NOT_FOUND', 'Statutory version not found.');
    if (status === 'ACTIVE') {
      if (
        !version.verifiedBy ||
        !version.verifiedOn ||
        !version.verificationReference ||
        !version.verificationPurpose
      )
        fail(
          409,
          'STATUTORY_VERIFICATION_REQUIRED',
          'Verify the source and rule values on a draft before activation. Legacy versions need a verified replacement.',
        );
      const loaded = (await loadStatutoryVersions(tx, scope)).find((v) => v.id === id)!;
      const issues = payrollRuleIssues(loaded);
      if (issues.length) fail(409, 'STATUTORY_CONFIGURATION_INCOMPLETE', issues.join(' '));
      // Two ACTIVE versions of one statute covering the same day would make a
      // payroll run ambiguous, so overlapping activation is refused.
      const [overlap] = await tx
        .select({ id: schema.payrollStatutoryVersions.id })
        .from(schema.payrollStatutoryVersions)
        .where(
          and(
            eq(schema.payrollStatutoryVersions.facilityId, scope.facilityId),
            eq(schema.payrollStatutoryVersions.statute, version.statute),
            or(
              eq(schema.payrollStatutoryVersions.status, 'ACTIVE'),
              and(
                eq(schema.payrollStatutoryVersions.status, 'RETIRED'),
                sql`${schema.payrollStatutoryVersions.verifiedBy} IS NOT NULL`,
                sql`${schema.payrollStatutoryVersions.effectiveTo} IS NOT NULL`,
              ),
            ),
            sql`${schema.payrollStatutoryVersions.id} <> ${id}`,
            or(
              sql`${schema.payrollStatutoryVersions.effectiveTo} IS NULL`,
              gte(schema.payrollStatutoryVersions.effectiveTo, version.effectiveFrom),
            )!,
            ...(version.effectiveTo
              ? [
                  sql`${version.effectiveTo}::date >= ${schema.payrollStatutoryVersions.effectiveFrom}`,
                ]
              : []),
          ),
        )
        .limit(1);
      if (overlap)
        fail(
          409,
          'STATUTORY_OVERLAP',
          'Another active version of this statute covers the same dates. Retire it first.',
        );
    }
    const [row] = await tx
      .update(schema.payrollStatutoryVersions)
      .set({ status })
      .where(eq(schema.payrollStatutoryVersions.id, id))
      .returning();
    await audit(
      tx,
      scope,
      'payroll_statutory_version',
      id,
      status,
      `${version.statute} ${version.label} → ${status}`,
    );
    return row;
  });
}

/* ============================================================
   EMPLOYEE PAY COMPONENTS
   ============================================================ */

export async function createPayComponent(scope: WorkforceScope, input: Record<string, unknown>) {
  const employeeId = positiveId(input.employeeId, 'employee');
  const code = requiredText(input.code, 'Component code', 24).toUpperCase();
  if (!/^[A-Z0-9_]{2,24}$/.test(code))
    fail(400, 'INVALID_CODE', 'Component code must be 2–24 characters of A–Z, 0–9 or underscore.');
  const name = requiredText(input.name, 'Component name', 120);
  const kind = enumValue(input.kind, ['EARNING', 'DEDUCTION'] as const, 'Component kind');
  const amountCents = cents(input.amountCents, 'Amount', { allowZero: false });
  if (input.taxable !== undefined && typeof input.taxable !== 'boolean')
    fail(400, 'INVALID_TAXABLE', 'Taxable must be true or false.');
  const taxable = input.taxable === undefined ? true : input.taxable;
  const exclusions = input.statutoryExclusions ?? [];
  if (!Array.isArray(exclusions) || exclusions.some((x) => !['NSSF', 'SHIF', 'AHL'].includes(x)))
    fail(400, 'INVALID_EXCLUSIONS', 'Choose contribution bases explicitly.');
  const statutoryExclusions = [...new Set(exclusions)] as string[];
  const effectiveFrom = isoDate(input.effectiveFrom, 'Effective from');
  const effectiveTo = optionalIsoDate(input.effectiveTo, 'Effective to');
  if (effectiveTo && effectiveTo < effectiveFrom)
    fail(400, 'INVALID_RANGE', 'Effective-to cannot precede effective-from.');
  return db.transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: schema.hrEmployees.id })
      .from(schema.hrEmployees)
      .where(
        and(
          eq(schema.hrEmployees.id, employeeId),
          eq(schema.hrEmployees.tenantId, scope.tenantId),
          eq(schema.hrEmployees.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!employee) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found in this facility.');
    const [row] = await tx
      .insert(schema.payrollEmployeeComponents)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        employeeId,
        code,
        name,
        kind,
        amountCents,
        taxable,
        statutoryExclusions,
        effectiveFrom,
        effectiveTo,
        createdBy: scope.actorId,
      })
      .returning();
    await audit(
      tx,
      scope,
      'payroll_component',
      row.id,
      'CREATE',
      `${kind} ${code} for employee ${employeeId}`,
    );
    return { ...row, amountCents: money(row.amountCents) };
  });
}

export async function deactivatePayComponent(scope: WorkforceScope, id: number) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.payrollEmployeeComponents)
      .set({ isActive: false, effectiveTo: new Date().toISOString().slice(0, 10) })
      .where(
        and(
          eq(schema.payrollEmployeeComponents.id, id),
          eq(schema.payrollEmployeeComponents.tenantId, scope.tenantId),
          eq(schema.payrollEmployeeComponents.facilityId, scope.facilityId),
        ),
      )
      .returning();
    if (!row) fail(404, 'COMPONENT_NOT_FOUND', 'Pay component not found in this facility.');
    await audit(tx, scope, 'payroll_component', id, 'DEACTIVATE', `Deactivated ${row.code}`);
    return { ...row, amountCents: money(row.amountCents) };
  });
}

/* ============================================================
   PAYROLL ACCOUNT SETTINGS
   ============================================================ */

/**
 * Active accounts a payroll mapping may reference. Only the facility's own
 * chart is returned, so the browser cannot point a posting at another
 * facility's ledger.
 */
export async function listPayrollAccounts(scope: WorkforceScope) {
  return db
    .select({
      id: schema.chartOfAccounts.id,
      accountCode: schema.chartOfAccounts.accountCode,
      accountName: schema.chartOfAccounts.accountName,
      accountType: schema.chartOfAccounts.accountType,
      normalBalance: schema.chartOfAccounts.normalBalance,
      isActive: schema.chartOfAccounts.isActive,
    })
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, scope.tenantId),
        eq(schema.chartOfAccounts.facilityId, scope.facilityId),
      ),
    )
    .orderBy(asc(schema.chartOfAccounts.accountCode));
}

export async function getPayrollAccountSettings(
  scope: WorkforceScope,
  connection: NodePgDatabase = db,
) {
  const [settings] = await connection
    .select()
    .from(schema.payrollAccountSettings)
    .where(
      and(
        eq(schema.payrollAccountSettings.facilityId, scope.facilityId),
        eq(schema.payrollAccountSettings.tenantId, scope.tenantId),
      ),
    )
    .limit(1);
  return settings ?? null;
}

export async function savePayrollAccountSettings(
  scope: WorkforceScope,
  input: Record<string, unknown>,
) {
  const ids = {
    salaryExpenseAccountId: positiveId(input.salaryExpenseAccountId, 'salary expense account'),
    employerCostAccountId: positiveId(input.employerCostAccountId, 'employer cost account'),
    netPayPayableAccountId: positiveId(input.netPayPayableAccountId, 'net pay payable account'),
    payePayableAccountId: positiveId(input.payePayableAccountId, 'PAYE payable account'),
    nssfPayableAccountId: positiveId(input.nssfPayableAccountId, 'NSSF payable account'),
    shifPayableAccountId: positiveId(input.shifPayableAccountId, 'SHIF payable account'),
    ahlPayableAccountId: positiveId(input.ahlPayableAccountId, 'housing levy payable account'),
    otherDeductionsPayableAccountId: optionalPositiveId(
      input.otherDeductionsPayableAccountId,
      'other deductions payable account',
    ),
  };
  return db.transaction(async (tx) => {
    const accounts = await tx
      .select()
      .from(schema.chartOfAccounts)
      .where(
        and(
          eq(schema.chartOfAccounts.tenantId, scope.tenantId),
          eq(schema.chartOfAccounts.facilityId, scope.facilityId),
        ),
      )
      .for('share');
    const assessed = assessPayrollAccounts(ids, accounts);
    if (!assessed.ready)
      fail(
        409,
        'PAYROLL_MAPPING_INVALID',
        assessed.mappings
          .filter((m) => m.nextAction)
          .map((m) => m.nextAction)
          .join(' '),
      );
    const [row] = await tx
      .insert(schema.payrollAccountSettings)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        ...ids,
        updatedBy: scope.actorId,
      })
      .onConflictDoUpdate({
        target: [schema.payrollAccountSettings.facilityId],
        set: { ...ids, updatedBy: scope.actorId, updatedAt: new Date() },
      })
      .returning();
    await audit(
      tx,
      scope,
      'payroll_account_settings',
      row.id,
      'UPDATE',
      'Payroll account mapping saved',
    );
    return row;
  });
}

/* ============================================================
   PAYROLL PERIODS AND RUNS
   ============================================================ */

export async function listPeriods(scope: WorkforceScope) {
  const periods = await db
    .select()
    .from(schema.payrollPeriods)
    .where(
      and(
        eq(schema.payrollPeriods.tenantId, scope.tenantId),
        eq(schema.payrollPeriods.facilityId, scope.facilityId),
      ),
    )
    .orderBy(desc(schema.payrollPeriods.payDate))
    .limit(60);
  if (periods.length === 0) return [];
  const runs = await db
    .select()
    .from(schema.payrollRuns)
    .where(
      and(
        eq(schema.payrollRuns.tenantId, scope.tenantId),
        eq(schema.payrollRuns.facilityId, scope.facilityId),
        inArray(
          schema.payrollRuns.periodId,
          periods.map((period) => period.id),
        ),
      ),
    );
  return periods.map((period) => {
    const run = runs.find((candidate) => candidate.periodId === period.id) ?? null;
    return {
      ...period,
      run: run
        ? {
            id: run.id,
            status: run.status,
            employeeCount: run.employeeCount,
            grossCents: money(run.grossCents),
            netCents: money(run.netCents),
            payeCents: money(run.payeCents),
            nssfEmployeeCents: money(run.nssfEmployeeCents),
            nssfEmployerCents: money(run.nssfEmployerCents),
            shifCents: money(run.shifCents),
            ahlEmployeeCents: money(run.ahlEmployeeCents),
            ahlEmployerCents: money(run.ahlEmployerCents),
            otherDeductionsCents: money(run.otherDeductionsCents),
            calculatedAt: run.calculatedAt,
            calculatedBy: run.calculatedBy,
            approvedAt: run.approvedAt,
            approvedBy: run.approvedBy,
            journalEntryId: run.journalEntryId,
          }
        : null,
    };
  });
}

export async function createPeriod(scope: WorkforceScope, input: Record<string, unknown>) {
  const name = requiredText(input.name, 'Period name', 80);
  const startDate = isoDate(input.startDate, 'Start date');
  const endDate = isoDate(input.endDate, 'End date');
  const payDate = isoDate(input.payDate, 'Pay date');
  if (endDate < startDate)
    fail(400, 'INVALID_RANGE', 'The end date cannot be before the start date.');
  if (payDate < startDate)
    fail(400, 'INVALID_RANGE', 'The pay date cannot be before the period starts.');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.payrollPeriods)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        name,
        startDate,
        endDate,
        payDate,
        status: 'OPEN',
        createdBy: scope.actorId,
      })
      .returning();
    await audit(tx, scope, 'payroll_period', row.id, 'CREATE', `Payroll period ${name}`);
    return row;
  });
}

async function loadStatutoryVersions(
  tx: NodePgDatabase,
  scope: WorkforceScope,
): Promise<VerifiedPayrollVersion[]> {
  const versions = await tx
    .select()
    .from(schema.payrollStatutoryVersions)
    .where(
      and(
        eq(schema.payrollStatutoryVersions.tenantId, scope.tenantId),
        eq(schema.payrollStatutoryVersions.facilityId, scope.facilityId),
      ),
    );
  if (versions.length === 0) return [];
  const bands = await tx
    .select()
    .from(schema.payrollStatutoryBands)
    .where(
      inArray(
        schema.payrollStatutoryBands.versionId,
        versions.map((version) => version.id),
      ),
    )
    .orderBy(asc(schema.payrollStatutoryBands.sequence));
  return versions.map((version) => ({
    id: version.id,
    statute: version.statute as StatutoryVersion['statute'],
    label: version.label,
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
    authority: version.authority,
    sourceReference: version.sourceReference,
    status: version.status as StatutoryVersion['status'],
    calculationConfig: version.calculationConfig,
    verifiedOn: version.verifiedOn,
    verifiedBy: version.verifiedBy,
    verificationReference: version.verificationReference,
    verificationPurpose: version.verificationPurpose,
    bands: bands
      .filter((band) => band.versionId === version.id)
      .map((band) => ({
        sequence: band.sequence,
        lowerBoundCents: band.lowerBoundCents,
        upperBoundCents: band.upperBoundCents,
        employeeRateBp: band.employeeRateBp,
        employerRateBp: band.employerRateBp,
        employeeFixedCents: band.employeeFixedCents,
        employerFixedCents: band.employerFixedCents,
        employeeCapCents: band.employeeCapCents,
        employerCapCents: band.employerCapCents,
        reliefCents: band.reliefCents,
      })),
  }));
}

function breakdownOf(slip: PayslipResult) {
  return {
    grossCents: slip.grossCents.toString(),
    taxableCents: slip.taxableCents.toString(),
    payeCents: slip.payeCents.toString(),
    nssfEmployeeCents: slip.nssfEmployeeCents.toString(),
    nssfEmployerCents: slip.nssfEmployerCents.toString(),
    shifCents: slip.shifCents.toString(),
    ahlEmployeeCents: slip.ahlEmployeeCents.toString(),
    ahlEmployerCents: slip.ahlEmployerCents.toString(),
    otherDeductionsCents: slip.otherDeductionsCents.toString(),
    netCents: slip.netCents.toString(),
    lines: slip.lines.map((line) => ({
      code: line.code,
      name: line.name,
      kind: line.kind,
      amountCents: line.amountCents.toString(),
    })),
    statutes: slip.statutes,
  };
}

export async function calculateRun(scope: WorkforceScope, periodId: number) {
  return db.transaction(async (tx) => {
    const [period] = await tx
      .select()
      .from(schema.payrollPeriods)
      .where(
        and(
          eq(schema.payrollPeriods.id, periodId),
          eq(schema.payrollPeriods.tenantId, scope.tenantId),
          eq(schema.payrollPeriods.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!period) fail(404, 'PERIOD_NOT_FOUND', 'Payroll period not found in this facility.');
    if (period.status === 'CLOSED')
      fail(409, 'PERIOD_CLOSED', 'This payroll period is closed and cannot be recalculated.');

    const [existingRun] = await tx
      .select()
      .from(schema.payrollRuns)
      .where(eq(schema.payrollRuns.periodId, period.id))
      .limit(1)
      .for('update');
    if (existingRun && (existingRun.status === 'APPROVED' || existingRun.status === 'POSTED'))
      fail(
        409,
        'RUN_LOCKED',
        `This period's run is ${existingRun.status.toLowerCase()} and cannot be recalculated.`,
      );

    const employees = await tx
      .select({
        id: schema.hrEmployees.id,
        employeeNumber: schema.hrEmployees.employeeNumber,
        firstName: schema.hrEmployees.firstName,
        lastName: schema.hrEmployees.lastName,
        departmentId: schema.hrEmployees.departmentId,
        designationId: schema.hrEmployees.designationId,
        baseSalaryCents: schema.hrEmployees.baseSalaryCents,
        kraPin: schema.hrEmployees.kraPin,
        nssfNumber: schema.hrEmployees.nssfNumber,
        shifNumber: schema.hrEmployees.shifNumber,
        bankName: schema.hrEmployees.bankName,
        bankAccountMasked: schema.hrEmployees.bankAccountMasked,
      })
      .from(schema.hrEmployees)
      .where(
        and(
          eq(schema.hrEmployees.tenantId, scope.tenantId),
          eq(schema.hrEmployees.facilityId, scope.facilityId),
          inArray(schema.hrEmployees.employmentStatus, ['ACTIVE', 'ON_LEAVE']),
          lte(schema.hrEmployees.hireDate, period.endDate),
          or(
            sql`${schema.hrEmployees.exitDate} IS NULL`,
            gte(schema.hrEmployees.exitDate, period.startDate),
          )!,
        ),
      )
      .orderBy(asc(schema.hrEmployees.lastName));
    if (employees.length === 0)
      fail(409, 'NO_EMPLOYEES', 'There are no active employees to pay for this period.');

    const components = await tx
      .select()
      .from(schema.payrollEmployeeComponents)
      .where(
        and(
          eq(schema.payrollEmployeeComponents.facilityId, scope.facilityId),
          eq(schema.payrollEmployeeComponents.isActive, true),
          lte(schema.payrollEmployeeComponents.effectiveFrom, period.endDate),
          or(
            sql`${schema.payrollEmployeeComponents.effectiveTo} IS NULL`,
            gte(schema.payrollEmployeeComponents.effectiveTo, period.startDate),
          )!,
        ),
      );

    const readiness = await payrollReadinessInside(scope, period, tx);
    assertPayrollConfigured(readiness);
    const verified = await loadStatutoryVersions(tx, scope);
    const ids = new Set(readiness.rules.map((r) => r.versionId));
    const versions = verified
      .filter((v) => ids.has(v.id))
      .map((v) => ({ ...v, status: 'ACTIVE' as const }));

    // A payroll withheld through the calculator's own error is stored nowhere:
    // the run does not exist until every employee has been costed.
    const result = calculatePayroll({
      versions,
      payDate: period.payDate,
      employees: employees.map<PayrollEmployeeInput>((employee) => ({
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber,
        fullName: `${employee.firstName} ${employee.lastName}`,
        baseSalaryCents: employee.baseSalaryCents,
        components: components
          .filter((component) => component.employeeId === employee.id)
          .map((component) => ({
            code: component.code,
            name: component.name,
            kind: component.kind as 'EARNING' | 'DEDUCTION',
            amountCents: component.amountCents,
            taxable: component.taxable,
            statutoryExclusions: component.statutoryExclusions,
          })),
      })),
    });

    let run = existingRun;
    if (run) {
      await tx.delete(schema.payrollPayslips).where(eq(schema.payrollPayslips.runId, run.id));
      const [updated] = await tx
        .update(schema.payrollRuns)
        .set({
          status: 'CALCULATED',
          employeeCount: result.totals.employeeCount,
          grossCents: result.totals.grossCents,
          taxableCents: result.totals.taxableCents,
          payeCents: result.totals.payeCents,
          nssfEmployeeCents: result.totals.nssfEmployeeCents,
          nssfEmployerCents: result.totals.nssfEmployerCents,
          shifCents: result.totals.shifCents,
          ahlEmployeeCents: result.totals.ahlEmployeeCents,
          ahlEmployerCents: result.totals.ahlEmployerCents,
          otherDeductionsCents: result.totals.otherDeductionsCents,
          netCents: result.totals.netCents,
          statutoryVersionIds: [
            result.versions.PAYE.id,
            result.versions.NSSF.id,
            result.versions.SHIF.id,
            result.versions.AHL.id,
          ],
          calculatedBy: scope.actorId,
          calculatedAt: new Date(),
          approvedBy: null,
          approvedAt: null,
        })
        .where(eq(schema.payrollRuns.id, run.id))
        .returning();
      run = updated;
    } else {
      const [created] = await tx
        .insert(schema.payrollRuns)
        .values({
          tenantId: scope.tenantId,
          facilityId: scope.facilityId,
          periodId: period.id,
          status: 'CALCULATED',
          employeeCount: result.totals.employeeCount,
          grossCents: result.totals.grossCents,
          taxableCents: result.totals.taxableCents,
          payeCents: result.totals.payeCents,
          nssfEmployeeCents: result.totals.nssfEmployeeCents,
          nssfEmployerCents: result.totals.nssfEmployerCents,
          shifCents: result.totals.shifCents,
          ahlEmployeeCents: result.totals.ahlEmployeeCents,
          ahlEmployerCents: result.totals.ahlEmployerCents,
          otherDeductionsCents: result.totals.otherDeductionsCents,
          netCents: result.totals.netCents,
          statutoryVersionIds: [
            result.versions.PAYE.id,
            result.versions.NSSF.id,
            result.versions.SHIF.id,
            result.versions.AHL.id,
          ],
          calculatedBy: scope.actorId,
          calculatedAt: new Date(),
        })
        .returning();
      run = created;
    }

    const [facility] = await tx
      .select({ name: schema.facilities.name })
      .from(schema.facilities)
      .where(
        and(
          eq(schema.facilities.id, scope.facilityId),
          eq(schema.facilities.tenantId, scope.tenantId),
        ),
      )
      .limit(1);
    const departments = await tx
      .select()
      .from(schema.hrDepartments)
      .where(
        and(
          eq(schema.hrDepartments.tenantId, scope.tenantId),
          eq(schema.hrDepartments.facilityId, scope.facilityId),
        ),
      );
    const designations = await tx
      .select()
      .from(schema.hrDesignations)
      .where(
        and(
          eq(schema.hrDesignations.tenantId, scope.tenantId),
          eq(schema.hrDesignations.facilityId, scope.facilityId),
        ),
      );
    for (const slip of result.payslips) {
      const [payslip] = await tx
        .insert(schema.payrollPayslips)
        .values({
          tenantId: scope.tenantId,
          facilityId: scope.facilityId,
          runId: run!.id,
          employeeId: slip.employeeId,
          grossCents: slip.grossCents,
          taxableCents: slip.taxableCents,
          payeCents: slip.payeCents,
          nssfEmployeeCents: slip.nssfEmployeeCents,
          nssfEmployerCents: slip.nssfEmployerCents,
          shifCents: slip.shifCents,
          ahlEmployeeCents: slip.ahlEmployeeCents,
          ahlEmployerCents: slip.ahlEmployerCents,
          otherDeductionsCents: slip.otherDeductionsCents,
          netCents: slip.netCents,
          breakdown: {
            ...breakdownOf(slip),
            sourceVerifications: versions.map((v) => ({
              versionId: v.id,
              verifiedOn: v.verifiedOn,
              verifiedBy: v.verifiedBy,
              verificationPurpose: v.verificationPurpose,
              verificationReference: v.verificationReference,
            })),
            employeeSnapshot: (() => {
              const employee = employees.find((e) => e.id === slip.employeeId)!;
              return {
                employeeNumber: employee.employeeNumber,
                firstName: employee.firstName,
                lastName: employee.lastName,
                kraPin: employee.kraPin,
                nssfNumber: employee.nssfNumber,
                shifNumber: employee.shifNumber,
                bankName: employee.bankName,
                bankAccountMasked: employee.bankAccountMasked,
                departmentName:
                  departments.find((d) => d.id === employee.departmentId)?.name ?? null,
                designationTitle:
                  designations.find((d) => d.id === employee.designationId)?.title ?? null,
                facilityName: facility?.name ?? null,
              };
            })(),
          },
        })
        .returning();
      await tx.insert(schema.payrollPayslipLines).values(
        slip.lines.map((line, index) => ({
          payslipId: payslip.id,
          sequence: index + 1,
          code: line.code,
          name: line.name,
          kind: line.kind,
          amountCents: line.amountCents,
        })),
      );
    }

    await audit(
      tx,
      scope,
      'payroll_run',
      run!.id,
      'CALCULATE',
      `Calculated ${result.totals.employeeCount} payslips for ${period.name}; gross ${result.totals.grossCents}`,
    );

    return {
      runId: run!.id,
      status: run!.status,
      employeeCount: result.totals.employeeCount,
      totals: Object.fromEntries(
        Object.entries(result.totals).map(([key, value]) => [
          key,
          typeof value === 'bigint' ? value.toString() : value,
        ]),
      ),
      versions: Object.fromEntries(
        Object.entries(result.versions).map(([statute, version]) => [
          statute,
          {
            id: version.id,
            label: version.label,
            effectiveFrom: version.effectiveFrom,
            authority: version.authority,
          },
        ]),
      ),
    };
  });
}

export async function approveRun(scope: WorkforceScope, runId: number) {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(schema.payrollRuns)
      .where(
        and(
          eq(schema.payrollRuns.id, runId),
          eq(schema.payrollRuns.tenantId, scope.tenantId),
          eq(schema.payrollRuns.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');
    if (!run) fail(404, 'RUN_NOT_FOUND', 'Payroll run not found in this facility.');
    if (run.status !== 'CALCULATED')
      fail(409, 'RUN_NOT_CALCULATED', `A ${run.status.toLowerCase()} run cannot be approved.`);
    if (run.calculatedBy === scope.actorId)
      fail(
        403,
        'PAYROLL_SELF_APPROVAL',
        'The person who calculated this payroll cannot approve it. Ask another authorized approver.',
      );
    const [row] = await tx
      .update(schema.payrollRuns)
      .set({ status: 'APPROVED', approvedBy: scope.actorId, approvedAt: new Date() })
      .where(eq(schema.payrollRuns.id, runId))
      .returning();
    await audit(
      tx,
      scope,
      'payroll_run',
      runId,
      'APPROVE',
      `Approved run with net pay ${run.netCents}`,
    );
    // Return an explicit, serialisable summary: the Drizzle row carries
    // BigInt columns, and JSON.stringify refuses BigInt. Sending the row
    // directly would commit the approval and then fail the response.
    return {
      id: row.id,
      status: row.status,
      employeeCount: row.employeeCount,
      grossCents: money(row.grossCents),
      netCents: money(row.netCents),
      payeCents: money(row.payeCents),
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      calculatedBy: row.calculatedBy,
    };
  });
}

export async function runDetail(scope: WorkforceScope, runId: number) {
  const [run] = await db
    .select({
      id: schema.payrollRuns.id,
      periodId: schema.payrollRuns.periodId,
      status: schema.payrollRuns.status,
      employeeCount: schema.payrollRuns.employeeCount,
      grossCents: schema.payrollRuns.grossCents,
      taxableCents: schema.payrollRuns.taxableCents,
      payeCents: schema.payrollRuns.payeCents,
      nssfEmployeeCents: schema.payrollRuns.nssfEmployeeCents,
      nssfEmployerCents: schema.payrollRuns.nssfEmployerCents,
      shifCents: schema.payrollRuns.shifCents,
      ahlEmployeeCents: schema.payrollRuns.ahlEmployeeCents,
      ahlEmployerCents: schema.payrollRuns.ahlEmployerCents,
      otherDeductionsCents: schema.payrollRuns.otherDeductionsCents,
      netCents: schema.payrollRuns.netCents,
      statutoryVersionIds: schema.payrollRuns.statutoryVersionIds,
      calculatedBy: schema.payrollRuns.calculatedBy,
      calculatedAt: schema.payrollRuns.calculatedAt,
      approvedBy: schema.payrollRuns.approvedBy,
      approvedAt: schema.payrollRuns.approvedAt,
      journalEntryId: schema.payrollRuns.journalEntryId,
      periodName: schema.payrollPeriods.name,
      periodStart: schema.payrollPeriods.startDate,
      periodEnd: schema.payrollPeriods.endDate,
      payDate: schema.payrollPeriods.payDate,
      periodStatus: schema.payrollPeriods.status,
    })
    .from(schema.payrollRuns)
    .innerJoin(schema.payrollPeriods, eq(schema.payrollRuns.periodId, schema.payrollPeriods.id))
    .where(
      and(
        eq(schema.payrollRuns.id, runId),
        eq(schema.payrollRuns.tenantId, scope.tenantId),
        eq(schema.payrollRuns.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!run) fail(404, 'RUN_NOT_FOUND', 'Payroll run not found in this facility.');

  const payslips = await db
    .select({
      id: schema.payrollPayslips.id,
      employeeId: schema.payrollPayslips.employeeId,
      employeeNumber: schema.hrEmployees.employeeNumber,
      firstName: schema.hrEmployees.firstName,
      lastName: schema.hrEmployees.lastName,
      grossCents: schema.payrollPayslips.grossCents,
      taxableCents: schema.payrollPayslips.taxableCents,
      payeCents: schema.payrollPayslips.payeCents,
      nssfEmployeeCents: schema.payrollPayslips.nssfEmployeeCents,
      nssfEmployerCents: schema.payrollPayslips.nssfEmployerCents,
      shifCents: schema.payrollPayslips.shifCents,
      ahlEmployeeCents: schema.payrollPayslips.ahlEmployeeCents,
      ahlEmployerCents: schema.payrollPayslips.ahlEmployerCents,
      otherDeductionsCents: schema.payrollPayslips.otherDeductionsCents,
      netCents: schema.payrollPayslips.netCents,
      breakdown: schema.payrollPayslips.breakdown,
    })
    .from(schema.payrollPayslips)
    .innerJoin(schema.hrEmployees, eq(schema.payrollPayslips.employeeId, schema.hrEmployees.id))
    .where(eq(schema.payrollPayslips.runId, runId))
    .orderBy(asc(schema.hrEmployees.lastName));

  const keys = [
    'grossCents',
    'taxableCents',
    'payeCents',
    'nssfEmployeeCents',
    'nssfEmployerCents',
    'shifCents',
    'ahlEmployeeCents',
    'ahlEmployerCents',
    'otherDeductionsCents',
    'netCents',
  ] as const;
  const serializedRun = { ...run } as Record<string, unknown>;
  for (const key of keys) serializedRun[key] = money(run[key] as bigint);

  return {
    run: serializedRun,
    payslips: payslips.map((slip) => {
      const snapshot = (slip.breakdown as { employeeSnapshot?: Record<string, unknown> })
        .employeeSnapshot;
      const serialized = {
        ...slip,
        ...(snapshot ?? {}),
        identitySnapshotAvailable: !!snapshot,
      } as Record<string, unknown>;
      for (const key of keys) {
        if (key in slip) serialized[key] = money(slip[key] as bigint);
      }
      return serialized;
    }),
  };
}

export async function postRun(scope: WorkforceScope, runId: number) {
  return ledgerTransaction(async (client) => {
    // All reads share the locked ledger connection: no second pool checkout or stale settings.
    const connection = drizzle(client);
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('bank-reconciliation', $1))",
      [scope.facilityId],
    );
    const locked = await client.query(
      'SELECT id FROM payroll_runs WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [runId, scope.tenantId, scope.facilityId],
    );
    if (!locked.rows.length) fail(404, 'RUN_NOT_FOUND', 'Payroll run not found in this facility.');
    const [run] = await connection
      .select({
        id: schema.payrollRuns.id,
        status: schema.payrollRuns.status,
        grossCents: schema.payrollRuns.grossCents,
        netCents: schema.payrollRuns.netCents,
        payeCents: schema.payrollRuns.payeCents,
        nssfEmployeeCents: schema.payrollRuns.nssfEmployeeCents,
        nssfEmployerCents: schema.payrollRuns.nssfEmployerCents,
        shifCents: schema.payrollRuns.shifCents,
        ahlEmployeeCents: schema.payrollRuns.ahlEmployeeCents,
        ahlEmployerCents: schema.payrollRuns.ahlEmployerCents,
        otherDeductionsCents: schema.payrollRuns.otherDeductionsCents,
        journalEntryId: schema.payrollRuns.journalEntryId,
        periodName: schema.payrollPeriods.name,
        payDate: schema.payrollPeriods.payDate,
        startDate: schema.payrollPeriods.startDate,
        endDate: schema.payrollPeriods.endDate,
        statutoryVersionIds: schema.payrollRuns.statutoryVersionIds,
      })
      .from(schema.payrollRuns)
      .innerJoin(schema.payrollPeriods, eq(schema.payrollRuns.periodId, schema.payrollPeriods.id))
      .where(
        and(
          eq(schema.payrollRuns.id, runId),
          eq(schema.payrollRuns.tenantId, scope.tenantId),
          eq(schema.payrollRuns.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!run) fail(404, 'RUN_NOT_FOUND', 'Payroll run not found in this facility.');
    if (run.journalEntryId)
      fail(409, 'RUN_ALREADY_POSTED', 'This run is already posted to the ledger.');
    if (run.status !== 'APPROVED')
      fail(409, 'RUN_NOT_APPROVED', 'Only an approved payroll run can be posted.');

    const readiness = await payrollReadinessInside(
      scope,
      run,
      connection,
      run.otherDeductionsCents > 0n,
    );
    assertPayrollConfigured(readiness);
    if (!readiness.accountingPeriod.ready)
      fail(
        409,
        'PAYROLL_FINANCIAL_PERIOD_REQUIRED',
        'Exactly one open accounting period must cover this payroll pay date.',
      );
    if (
      readiness.rules.some(
        (rule) =>
          !(
            Array.isArray(run.statutoryVersionIds) &&
            run.statutoryVersionIds.includes(rule.versionId!)
          ),
      )
    )
      fail(
        409,
        'PAYROLL_RULE_SNAPSHOT_MISMATCH',
        'The configured verified rules do not match this approved run. Do not rewrite approved history; review the payroll correction process.',
      );
    const settings = await getPayrollAccountSettings(scope, connection);
    if (!settings)
      fail(
        409,
        'PAYROLL_ACCOUNTS_REQUIRED',
        'Map the payroll accounts for this facility before posting a run.',
      );

    const lines: JournalLine[] = [];
    const push = (accountId: number, debit: bigint, credit: bigint, description: string) => {
      if (debit === 0n && credit === 0n) return;
      lines.push({
        accountId,
        debitCents: debit,
        creditCents: credit,
        description,
        serviceLine: 'PAYROLL',
      });
    };

    const employerNssf = run.nssfEmployerCents;
    const employerAhl = run.ahlEmployerCents;
    push(settings.salaryExpenseAccountId, run.grossCents, 0n, `Gross pay — ${run.periodName}`);
    push(
      settings.employerCostAccountId,
      employerNssf + employerAhl,
      0n,
      `Employer statutory cost — ${run.periodName}`,
    );
    push(settings.netPayPayableAccountId, 0n, run.netCents, 'Net pay payable');
    push(settings.payePayableAccountId, 0n, run.payeCents, 'PAYE payable');
    push(
      settings.nssfPayableAccountId,
      0n,
      run.nssfEmployeeCents + employerNssf,
      'NSSF payable (employee + employer)',
    );
    push(settings.shifPayableAccountId, 0n, run.shifCents, 'SHIF payable');
    push(
      settings.ahlPayableAccountId,
      0n,
      run.ahlEmployeeCents + employerAhl,
      'Affordable housing levy payable (employee + employer)',
    );
    if (settings.otherDeductionsPayableAccountId)
      push(
        settings.otherDeductionsPayableAccountId,
        0n,
        run.otherDeductionsCents,
        'Other payroll deductions payable',
      );

    const debitTotal = lines.reduce((sum, line) => sum + line.debitCents, 0n);
    const creditTotal = lines.reduce((sum, line) => sum + line.creditCents, 0n);
    if (debitTotal !== creditTotal)
      fail(
        500,
        'PAYROLL_JOURNAL_UNBALANCED',
        'The payroll journal would not balance. Posting refused.',
      );

    const accountingScope: AccountingScope = {
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      actorUserId: scope.actorId,
    };

    // The idempotency key is derived from the run, so a retried post replays the
    // existing journal instead of creating a second liability.
    const posted = await postInsideTransaction(client, accountingScope, {
      entryDate: run.payDate,
      description: `Payroll — ${run.periodName}`,
      idempotencyKey: `payroll-run:${runId}`,
      sourceType: 'PAYROLL',
      sourceId: String(runId),
      lines,
      totalCents: debitTotal,
    });
    const journalId = Number(posted.journal.id);
    await client.query(
      `UPDATE payroll_runs SET status='POSTED',posted_by=$1,posted_at=now(),journal_entry_id=$2 WHERE id=$3`,
      [scope.actorId, journalId, runId],
    );
    await client.query(
      `INSERT INTO audit_logs(tenant_id,facility_id,user_id,resource,resource_id,action,details) VALUES($1,$2,$3,'payroll_run',$4,'POST',$5)`,
      [
        scope.tenantId,
        scope.facilityId,
        String(scope.actorId),
        String(runId),
        `Posted to journal ${journalId}`,
      ],
    );

    return {
      runId,
      status: 'POSTED',
      journalEntryId: journalId,
      journalNumber: posted.journal.journalNumber,
      idempotentReplay: Boolean(posted.idempotentReplay),
      debitTotalCents: debitTotal.toString(),
      creditTotalCents: creditTotal.toString(),
    };
  });
}

export async function payslipDetail(scope: WorkforceScope, payslipId: number) {
  const [slip] = await db
    .select({
      id: schema.payrollPayslips.id,
      runId: schema.payrollPayslips.runId,
      employeeId: schema.payrollPayslips.employeeId,
      employeeNumber: schema.hrEmployees.employeeNumber,
      firstName: schema.hrEmployees.firstName,
      lastName: schema.hrEmployees.lastName,
      departmentName: schema.hrDepartments.name,
      designationTitle: schema.hrDesignations.title,
      kraPin: schema.hrEmployees.kraPin,
      nssfNumber: schema.hrEmployees.nssfNumber,
      shifNumber: schema.hrEmployees.shifNumber,
      breakdown: schema.payrollPayslips.breakdown,
      grossCents: schema.payrollPayslips.grossCents,
      netCents: schema.payrollPayslips.netCents,
      payeCents: schema.payrollPayslips.payeCents,
      taxableCents: schema.payrollPayslips.taxableCents,
      nssfEmployerCents: schema.payrollPayslips.nssfEmployerCents,
      ahlEmployerCents: schema.payrollPayslips.ahlEmployerCents,
      nssfEmployeeCents: schema.payrollPayslips.nssfEmployeeCents,
      shifCents: schema.payrollPayslips.shifCents,
      ahlEmployeeCents: schema.payrollPayslips.ahlEmployeeCents,
      otherDeductionsCents: schema.payrollPayslips.otherDeductionsCents,
      periodName: schema.payrollPeriods.name,
      payDate: schema.payrollPeriods.payDate,
      runStatus: schema.payrollRuns.status,
      facilityName: schema.facilities.name,
    })
    .from(schema.payrollPayslips)
    .innerJoin(schema.hrEmployees, eq(schema.payrollPayslips.employeeId, schema.hrEmployees.id))
    .innerJoin(schema.payrollRuns, eq(schema.payrollPayslips.runId, schema.payrollRuns.id))
    .innerJoin(schema.payrollPeriods, eq(schema.payrollRuns.periodId, schema.payrollPeriods.id))
    .innerJoin(schema.facilities, eq(schema.payrollPayslips.facilityId, schema.facilities.id))
    .leftJoin(schema.hrDepartments, eq(schema.hrEmployees.departmentId, schema.hrDepartments.id))
    .leftJoin(schema.hrDesignations, eq(schema.hrEmployees.designationId, schema.hrDesignations.id))
    .where(
      and(
        eq(schema.payrollPayslips.id, payslipId),
        eq(schema.payrollPayslips.tenantId, scope.tenantId),
        eq(schema.payrollPayslips.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!slip) fail(404, 'PAYSLIP_NOT_FOUND', 'Payslip not found in this facility.');
  return {
    ...slip,
    ...((slip.breakdown as { employeeSnapshot?: Record<string, unknown> }).employeeSnapshot ?? {}),
    identitySnapshotAvailable: !!(slip.breakdown as { employeeSnapshot?: unknown })
      .employeeSnapshot,
    grossCents: money(slip.grossCents),
    netCents: money(slip.netCents),
    payeCents: money(slip.payeCents),
    taxableCents: money(slip.taxableCents),
    nssfEmployerCents: money(slip.nssfEmployerCents),
    ahlEmployerCents: money(slip.ahlEmployerCents),
    nssfEmployeeCents: money(slip.nssfEmployeeCents),
    shifCents: money(slip.shifCents),
    ahlEmployeeCents: money(slip.ahlEmployeeCents),
    otherDeductionsCents: money(slip.otherDeductionsCents),
  };
}

/* ============================================================
   OVERVIEW
   ============================================================ */

export async function workforceOverview(scope: WorkforceScope) {
  const [[headcount], [departments], [pendingLeave], [periods], [statutory]] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${schema.hrEmployees.employmentStatus} = 'ACTIVE')::int`,
        onLeave: sql<number>`count(*) filter (where ${schema.hrEmployees.employmentStatus} = 'ON_LEAVE')::int`,
        monthlySalary: sql<string>`coalesce(sum(${schema.hrEmployees.baseSalaryCents}) filter (where ${schema.hrEmployees.employmentStatus} in ('ACTIVE','ON_LEAVE')), 0)`,
      })
      .from(schema.hrEmployees)
      .where(
        and(
          eq(schema.hrEmployees.tenantId, scope.tenantId),
          eq(schema.hrEmployees.facilityId, scope.facilityId),
        ),
      ),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.hrDepartments)
      .where(
        and(
          eq(schema.hrDepartments.tenantId, scope.tenantId),
          eq(schema.hrDepartments.facilityId, scope.facilityId),
          eq(schema.hrDepartments.isActive, true),
        ),
      ),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.hrLeaveRequests)
      .where(
        and(
          eq(schema.hrLeaveRequests.tenantId, scope.tenantId),
          eq(schema.hrLeaveRequests.facilityId, scope.facilityId),
          eq(schema.hrLeaveRequests.status, 'PENDING'),
        ),
      ),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.payrollPeriods)
      .where(
        and(
          eq(schema.payrollPeriods.tenantId, scope.tenantId),
          eq(schema.payrollPeriods.facilityId, scope.facilityId),
        ),
      ),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.payrollStatutoryVersions)
      .where(
        and(
          eq(schema.payrollStatutoryVersions.tenantId, scope.tenantId),
          eq(schema.payrollStatutoryVersions.facilityId, scope.facilityId),
          eq(schema.payrollStatutoryVersions.status, 'ACTIVE'),
        ),
      ),
  ]);

  return {
    headcount: headcount.total,
    activeEmployees: headcount.active,
    onLeave: headcount.onLeave,
    monthlyBasicCents: headcount.monthlySalary,
    departments: departments.total,
    pendingLeave: pendingLeave.total,
    payrollPeriods: periods.total,
    activeStatutoryVersions: statutory.total,
    payrollReady: statutory.total >= 4,
  };
}

/* ============================================================
   STATUTORY FORM EXTRACTS (P9 / P10)

   These produce the *data* a form requires from payroll that has actually been
   posted. They do not claim to reproduce a regulator's layout: the layout is
   chosen by the authority and can change, so a facility records which published
   version it is producing and the extract carries that citation with every row.
   With no such record the extract refuses, because a plausible-looking return
   assembled from an unverified layout is worse than no return.
   ============================================================ */

const FORM_CODES = ['P9', 'P10'] as const;

export async function listFormProfiles(scope: WorkforceScope) {
  return db
    .select()
    .from(schema.payrollFormProfiles)
    .where(
      and(
        eq(schema.payrollFormProfiles.tenantId, scope.tenantId),
        eq(schema.payrollFormProfiles.facilityId, scope.facilityId),
      ),
    )
    .orderBy(
      asc(schema.payrollFormProfiles.formCode),
      desc(schema.payrollFormProfiles.effectiveFrom),
    );
}

export async function createFormProfile(scope: WorkforceScope, input: Record<string, unknown>) {
  const formCode = enumValue(input.formCode, FORM_CODES, 'Form');
  const formVersion = requiredText(input.formVersion, 'Form version', 120);
  const authorityReference = requiredText(input.authorityReference, 'Authority reference', 500);
  if (authorityReference.trim().length < 8)
    fail(
      400,
      'SOURCE_REQUIRED',
      'Cite the published form this version comes from (at least 8 characters).',
    );
  const effectiveFrom = isoDate(input.effectiveFrom, 'Effective from');
  const effectiveTo = optionalIsoDate(input.effectiveTo, 'Effective to');
  if (effectiveTo && effectiveTo < effectiveFrom)
    fail(400, 'INVALID_RANGE', 'Effective-to cannot be before effective-from.');

  return db.transaction(async (tx) => {
    const [profile] = await tx
      .insert(schema.payrollFormProfiles)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        formCode,
        formVersion,
        authorityReference,
        effectiveFrom,
        effectiveTo,
        createdBy: scope.actorId,
      })
      .returning();
    await audit(
      tx,
      scope,
      'payroll_form_profile',
      profile.id,
      'CREATE',
      `${formCode} ${formVersion} from ${effectiveFrom}: ${authorityReference}`,
    );
    return profile;
  });
}

/**
 * Annual per-employee figures from posted payroll, for a tax year.
 *
 * Only runs that reached POSTED are included: an approved but unposted run has
 * not touched the ledger, and reporting it alongside posted pay would make the
 * return disagree with the books.
 */
export async function statutoryFormExtract(
  scope: WorkforceScope,
  input: { formCode: string; taxYear: number },
) {
  const formCode = enumValue(input.formCode, FORM_CODES, 'Form');
  const taxYear = Number(input.taxYear);
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100)
    fail(400, 'INVALID_TAX_YEAR', 'Tax year must be a four-digit year.');
  const yearStart = `${taxYear}-01-01`;
  const yearEnd = `${taxYear}-12-31`;

  const profiles = await db
    .select()
    .from(schema.payrollFormProfiles)
    .where(
      and(
        eq(schema.payrollFormProfiles.tenantId, scope.tenantId),
        eq(schema.payrollFormProfiles.facilityId, scope.facilityId),
        eq(schema.payrollFormProfiles.formCode, formCode),
        eq(schema.payrollFormProfiles.isActive, true),
      ),
    )
    .orderBy(desc(schema.payrollFormProfiles.effectiveFrom));
  const coveringProfiles = profiles.filter(
    (row) =>
      row.effectiveFrom <= yearStart && (row.effectiveTo === null || row.effectiveTo >= yearEnd),
  );
  if (coveringProfiles.length !== 1)
    fail(
      409,
      'FORM_PROFILE_REQUIRED',
      `Record exactly one active ${formCode} published form version and citation covering the whole of ${taxYear} before producing this annual internal extract.`,
    );
  const profile = coveringProfiles[0];
  const amounts = [
    'grossCents',
    'taxableCents',
    'payeCents',
    'nssfEmployeeCents',
    'shifCents',
    'ahlEmployeeCents',
    'otherDeductionsCents',
    'netCents',
  ] as const;
  const slips = await db
    .select({
      employeeId: schema.payrollPayslips.employeeId,
      payslipId: schema.payrollPayslips.id,
      employeeNumber: schema.hrEmployees.employeeNumber,
      firstName: schema.hrEmployees.firstName,
      lastName: schema.hrEmployees.lastName,
      breakdown: schema.payrollPayslips.breakdown,
      payDate: schema.payrollPeriods.payDate,
      grossCents: schema.payrollPayslips.grossCents,
      taxableCents: schema.payrollPayslips.taxableCents,
      payeCents: schema.payrollPayslips.payeCents,
      nssfEmployeeCents: schema.payrollPayslips.nssfEmployeeCents,
      shifCents: schema.payrollPayslips.shifCents,
      ahlEmployeeCents: schema.payrollPayslips.ahlEmployeeCents,
      otherDeductionsCents: schema.payrollPayslips.otherDeductionsCents,
      netCents: schema.payrollPayslips.netCents,
    })
    .from(schema.payrollPayslips)
    .innerJoin(schema.payrollRuns, eq(schema.payrollPayslips.runId, schema.payrollRuns.id))
    .innerJoin(schema.payrollPeriods, eq(schema.payrollRuns.periodId, schema.payrollPeriods.id))
    .innerJoin(schema.hrEmployees, eq(schema.payrollPayslips.employeeId, schema.hrEmployees.id))
    .where(
      and(
        eq(schema.payrollPayslips.tenantId, scope.tenantId),
        eq(schema.payrollPayslips.facilityId, scope.facilityId),
        eq(schema.payrollRuns.status, 'POSTED'),
        gte(schema.payrollPeriods.payDate, yearStart),
        lte(schema.payrollPeriods.payDate, yearEnd),
      ),
    )
    .orderBy(asc(schema.payrollPeriods.payDate), asc(schema.payrollPayslips.id));
  const monthlyRows = slips.map((slip) => {
    const snapshot = (slip.breakdown as { employeeSnapshot?: Record<string, unknown> })
      .employeeSnapshot;
    return {
      employeeId: slip.employeeId,
      payslipId: slip.payslipId,
      payDate: slip.payDate,
      employeeNumber: String(snapshot?.employeeNumber ?? slip.employeeNumber),
      firstName: String(snapshot?.firstName ?? slip.firstName),
      lastName: String(snapshot?.lastName ?? slip.lastName),
      identitySnapshotAvailable: !!snapshot,
      ...Object.fromEntries(amounts.map((key) => [key, slip[key].toString()])),
    } as {
      employeeId: number;
      payslipId: number;
      payDate: string;
      employeeNumber: string;
      firstName: string;
      lastName: string;
      identitySnapshotAvailable: boolean;
    } & Record<(typeof amounts)[number], string>;
  });
  const byEmployee = new Map<number, (typeof monthlyRows)[number] & { payslipCount: number }>();
  for (const row of monthlyRows) {
    const previous = byEmployee.get(row.employeeId);
    const combined = { ...row, payslipCount: (previous?.payslipCount ?? 0) + 1 };
    for (const key of amounts)
      combined[key] = (BigInt(previous?.[key] ?? '0') + BigInt(row[key])).toString();
    byEmployee.set(row.employeeId, combined);
  }
  const rows = [...byEmployee.values()].sort((a, b) =>
    a.employeeNumber.localeCompare(b.employeeNumber),
  );
  const total = (key: (typeof amounts)[number]) =>
    rows.reduce((sum, row) => sum + BigInt(row[key]), 0n).toString();
  await db.insert(schema.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: String(scope.actorId),
    resource: 'payroll_extract',
    resourceId: `${formCode}:${taxYear}`,
    action: 'VIEW',
    details: 'Internal annual extract by payroll pay date; no filing or payment performed.',
  });

  return {
    formCode,
    taxYear,
    monthlyRows,
    filingStatus: 'NOT_FILED',
    paymentStatus: 'NOT_EVIDENCED',
    periodBasis: 'PAY_DATE',
    formVersion: profile.formVersion,
    authorityReference: profile.authorityReference,
    employees: rows.map((row) => ({
      employeeId: row.employeeId,
      employeeNumber: row.employeeNumber,
      employeeName: `${row.firstName} ${row.lastName}`.trim(),
      payslipCount: row.payslipCount,
      grossCents: row.grossCents,
      taxableCents: row.taxableCents,
      payeCents: row.payeCents,
      nssfEmployeeCents: row.nssfEmployeeCents,
      shifCents: row.shifCents,
      ahlEmployeeCents: row.ahlEmployeeCents,
      otherDeductionsCents: row.otherDeductionsCents,
      netCents: row.netCents,
    })),
    totals: {
      grossCents: total('grossCents'),
      taxableCents: total('taxableCents'),
      payeCents: total('payeCents'),
      nssfEmployeeCents: total('nssfEmployeeCents'),
      shifCents: total('shifCents'),
      ahlEmployeeCents: total('ahlEmployeeCents'),
      otherDeductionsCents: total('otherDeductionsCents'),
      netCents: total('netCents'),
    },
    notice:
      'Internal annual review extract only, grouped by payroll pay date (not journal posting timestamp); monthlyRows retain each payslip identity snapshot. Legacy snapshots may be unavailable. Not an official P9/P10 layout, filing or evidence of salary payment; producing it is not a claim that a return has been accepted. Independently verify all fields, payment dates and the authority form before submission.',
  };
}

/** Salary writes are isolated from ordinary HR edits and always audited. */
export async function setEmployeeSalary(
  scope: WorkforceScope,
  employeeId: number,
  input: Record<string, unknown>,
) {
  const salary = cents(input.baseSalaryCents, 'Basic salary');
  const reason = requiredText(input.reason, 'Salary change reason', 500);
  return db.transaction(async (tx) => {
    const [prior] = await tx
      .select()
      .from(schema.hrEmployees)
      .where(
        and(
          eq(schema.hrEmployees.id, employeeId),
          eq(schema.hrEmployees.tenantId, scope.tenantId),
          eq(schema.hrEmployees.facilityId, scope.facilityId),
        ),
      )
      .for('update');
    if (!prior) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found in this facility.');
    await tx
      .update(schema.hrEmployees)
      .set({ baseSalaryCents: salary, updatedAt: new Date() })
      .where(eq(schema.hrEmployees.id, employeeId));
    await audit(
      tx,
      scope,
      'payroll_salary',
      employeeId,
      'UPDATE',
      `Basic salary ${prior.baseSalaryCents} → ${salary}; ${reason}`,
    );
    return {
      employeeId,
      baseSalaryCents: salary.toString(),
      notice:
        'Existing calculated/approved payslips are snapshots; recalculate an unapproved run explicitly to use a changed salary.',
    };
  });
}

export async function payrollHistory(scope: WorkforceScope) {
  const rows = await pool.query(
    `SELECT id,action,resource,resource_id AS "resourceId",user_id AS "actorId",timestamp AS "createdAt",details FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND resource LIKE 'payroll\\_%' ESCAPE '\\' ORDER BY id DESC LIMIT 300`,
    [scope.tenantId, scope.facilityId],
  );
  return { events: rows.rows, limit: 300 };
}

/** Internal review schedules, not bank instructions or statutory filing formats. */
export async function payrollRunReports(scope: WorkforceScope, runId: number) {
  const detail = await runDetail(scope, runId);
  if (detail.run.status !== 'POSTED')
    fail(
      409,
      'FINALIZED_RUN_REQUIRED',
      'Finalize the approved payroll to its verified journal before producing payment/remittance schedules.',
    );
  const payslips = await Promise.all(
    detail.payslips.map((p) => payslipDetail(scope, Number(p.id))),
  );
  const sum = (key: string) =>
    payslips
      .reduce((n, p) => n + BigInt(String((p as Record<string, unknown>)[key] ?? '0')), 0n)
      .toString();
  const bankSchedule = payslips.map((p) => {
    const snapshot = (p.breakdown as { employeeSnapshot?: Record<string, unknown> })
      .employeeSnapshot;
    return {
      employeeId: p.employeeId,
      employeeNumber: p.employeeNumber,
      employeeName: `${p.firstName} ${p.lastName}`,
      netCents: p.netCents,
      bankName: snapshot?.bankName ?? null,
      bankAccountMasked: snapshot?.bankAccountMasked ?? null,
      paymentStatus: 'NOT_EVIDENCED',
      instructionReady: false,
    };
  });
  const remittances = [
    { statute: 'PAYE', employeeCents: sum('payeCents'), employerCents: '0' },
    {
      statute: 'NSSF',
      employeeCents: sum('nssfEmployeeCents'),
      employerCents: sum('nssfEmployerCents'),
    },
    { statute: 'SHIF', employeeCents: sum('shifCents'), employerCents: '0' },
    {
      statute: 'AHL',
      employeeCents: sum('ahlEmployeeCents'),
      employerCents: sum('ahlEmployerCents'),
    },
  ].map((row) => ({
    ...row,
    totalCents: (BigInt(row.employeeCents) + BigInt(row.employerCents)).toString(),
    filingStatus: 'NOT_FILED',
    paymentStatus: 'NOT_EVIDENCED',
  }));
  const rows = payslips.map((p) => ({
    employeeNumber: p.employeeNumber,
    employeeName: `${p.firstName} ${p.lastName}`,
    kraPin: p.kraPin,
    nssfNumber: p.nssfNumber,
    shifNumber: p.shifNumber,
    payeCents: p.payeCents,
    nssfEmployeeCents: p.nssfEmployeeCents,
    nssfEmployerCents: p.nssfEmployerCents,
    shifCents: p.shifCents,
    ahlEmployeeCents: p.ahlEmployeeCents,
    ahlEmployerCents: p.ahlEmployerCents,
  }));
  await db.insert(schema.auditLogs).values({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    userId: String(scope.actorId),
    resource: 'payroll_report',
    resourceId: String(runId),
    action: 'VIEW',
    details: 'Generated internal finalized payroll schedules; no filing or payment performed.',
  });
  return {
    run: detail.run,
    payslips,
    bankSchedule,
    remittances,
    statutoryRows: rows,
    notice:
      'Internal schedules only — not statutory filing, remittance, salary payment authorization or bank-upload instructions. Bank accounts are masked; complete independent account verification and payment authorization outside this schedule. POSTED means liability journal posted, not salaries paid.',
  };
}

/** A user attests the cited source; the software never claims it has certified Kenyan rates. */
export async function verifyStatutoryVersion(
  scope: WorkforceScope,
  id: number,
  input: Record<string, unknown>,
) {
  const verifiedOn = isoDate(input.verifiedOn, 'Source verification date');
  if (
    verifiedOn > new Date().toISOString().slice(0, 10) ||
    new Date(verifiedOn).toISOString().slice(0, 10) !== verifiedOn
  )
    fail(
      400,
      'INVALID_VERIFICATION_DATE',
      'Source verification date must be a real, non-future date.',
    );
  const verificationReference = requiredText(
    input.verificationReference,
    'Verification evidence/review reference',
    1000,
  );
  if (verificationReference.length < 8)
    fail(
      400,
      'VERIFICATION_REFERENCE_REQUIRED',
      'Record the source review and verification evidence reference (at least 8 characters).',
    );
  const verificationPurpose = enumValue(
    input.verificationPurpose,
    ['AUTHORITY_SOURCE', 'SYNTHETIC_TEST'] as const,
    'Verification purpose',
  );
  if (input.confirmSourceReviewed !== true)
    fail(
      400,
      'SOURCE_REVIEW_CONFIRMATION_REQUIRED',
      'Explicitly confirm that the cited source, dates and every rule value were reviewed.',
    );
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended('payroll-statutory',${scope.facilityId}))`,
    );
    const [version] = await tx
      .select()
      .from(schema.payrollStatutoryVersions)
      .where(
        and(
          eq(schema.payrollStatutoryVersions.id, id),
          eq(schema.payrollStatutoryVersions.tenantId, scope.tenantId),
          eq(schema.payrollStatutoryVersions.facilityId, scope.facilityId),
        ),
      )
      .for('update');
    if (!version)
      fail(404, 'STATUTORY_VERSION_NOT_FOUND', 'Statutory version not found in this facility.');
    if (version.status !== 'DRAFT' || version.verifiedBy)
      fail(
        409,
        'STATUTORY_VERIFICATION_LOCKED',
        'Only an unverified draft may be verified once; create a replacement for corrections.',
      );
    const loaded = (await loadStatutoryVersions(tx, scope)).find((v) => v.id === id)!;
    const issues = payrollRuleIssues(loaded);
    if (issues.length) fail(409, 'STATUTORY_CONFIGURATION_INCOMPLETE', issues.join(' '));
    const [row] = await tx
      .update(schema.payrollStatutoryVersions)
      .set({
        verifiedOn,
        verifiedBy: scope.actorId,
        verifiedAt: new Date(),
        verificationReference,
        verificationPurpose,
      })
      .where(eq(schema.payrollStatutoryVersions.id, id))
      .returning();
    await audit(
      tx,
      scope,
      'payroll_statutory_version',
      id,
      'VERIFY',
      `${verificationPurpose}; source reviewed ${verifiedOn}; ${verificationReference}`,
    );
    return row;
  });
}

async function payrollReadinessInside(
  scope: WorkforceScope,
  period: PayrollReadinessPeriod,
  connection: NodePgDatabase = db,
  otherRequired?: boolean,
) {
  // Same facility policy lock as activation/verification; meaningful for calculate/post transactions.
  await connection.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended('payroll-statutory',${scope.facilityId}))`,
  );
  const [settings] = await connection
    .select()
    .from(schema.payrollAccountSettings)
    .where(
      and(
        eq(schema.payrollAccountSettings.tenantId, scope.tenantId),
        eq(schema.payrollAccountSettings.facilityId, scope.facilityId),
      ),
    )
    .for('share');
  const accounts = await connection
    .select({
      id: schema.chartOfAccounts.id,
      accountCode: schema.chartOfAccounts.accountCode,
      accountName: schema.chartOfAccounts.accountName,
      accountType: schema.chartOfAccounts.accountType,
      isActive: schema.chartOfAccounts.isActive,
    })
    .from(schema.chartOfAccounts)
    .where(
      and(
        eq(schema.chartOfAccounts.tenantId, scope.tenantId),
        eq(schema.chartOfAccounts.facilityId, scope.facilityId),
      ),
    )
    .for('share');
  const deductions = await connection
    .select({ id: schema.payrollEmployeeComponents.id })
    .from(schema.payrollEmployeeComponents)
    .where(
      and(
        eq(schema.payrollEmployeeComponents.tenantId, scope.tenantId),
        eq(schema.payrollEmployeeComponents.facilityId, scope.facilityId),
        eq(schema.payrollEmployeeComponents.isActive, true),
        eq(schema.payrollEmployeeComponents.kind, 'DEDUCTION'),
        sql`${schema.payrollEmployeeComponents.amountCents}>0`,
        lte(schema.payrollEmployeeComponents.effectiveFrom, period.endDate),
        or(
          sql`${schema.payrollEmployeeComponents.effectiveTo} IS NULL`,
          gte(schema.payrollEmployeeComponents.effectiveTo, period.startDate),
        ),
      ),
    );
  const mapping = assessPayrollAccounts(
    settings ?? null,
    accounts,
    otherRequired ?? deductions.length > 0,
  );
  const versions = await loadStatutoryVersions(connection, scope);
  const rules = assessPayrollRules(versions, period, new Date().toISOString().slice(0, 10));
  const financial = await connection
    .select({ id: schema.financialPeriods.id, status: schema.financialPeriods.status })
    .from(schema.financialPeriods)
    .where(
      and(
        eq(schema.financialPeriods.tenantId, scope.tenantId),
        eq(schema.financialPeriods.facilityId, scope.facilityId),
        lte(schema.financialPeriods.startDate, period.payDate),
        gte(schema.financialPeriods.endDate, period.payDate),
      ),
    )
    .for('share');
  const accountingPeriod = {
    ready: financial.length === 1 && financial[0].status === 'OPEN',
    status:
      financial.length === 0 ? 'MISSING' : financial.length > 1 ? 'AMBIGUOUS' : financial[0].status,
  };
  const configurationReady =
    mapping.activeAccountCount > 0 && mapping.ready && rules.every((r) => r.ready);
  const testOnly = rules.some((r) => r.status === 'TEST_ONLY');
  return {
    facilityId: scope.facilityId,
    period,
    chartOfAccounts: {
      status: mapping.activeAccountCount ? 'AVAILABLE' : 'NO_ACTIVE_ACCOUNTS',
      activeCount: mapping.activeAccountCount,
      totalCount: mapping.totalAccountCount,
    },
    mapping,
    rules,
    accountingPeriod,
    configurationReady,
    canCalculate: configurationReady,
    canFinalize: configurationReady && accountingPeriod.ready,
    productionReady: false as const,
    status: !configurationReady
      ? 'BLOCKED'
      : testOnly
        ? 'TEST_CONFIGURATION_ONLY'
        : 'CONFIGURATION_COMPLETE_REVIEW_REQUIRED',
    nextActions: [
      ...(!mapping.activeAccountCount
        ? [
            'Ask the facility accounting administrator to create or reactivate approved chart accounts in Accounting; payroll does not create them.',
          ]
        : []),
      ...mapping.mappings.filter((m) => m.nextAction).map((m) => m.nextAction!),
      ...rules.filter((r) => r.nextAction).map((r) => `${r.statute}: ${r.nextAction}`),
      ...(!accountingPeriod.ready
        ? [
            'Have Accounting open exactly one accounting period covering the payroll pay date before finalization.',
          ]
        : []),
    ],
    notice:
      'Configuration checks only, not production certification, legal verification, salary payment or statutory filing. Source verification records a responsible user attestation; synthetic policies are test-only. A rule must cover the whole period and pay date; mixed-rule periods are blocked rather than guessed.',
  };
}
function assertPayrollConfigured(readiness: Awaited<ReturnType<typeof payrollReadinessInside>>) {
  const invalid = readiness.rules.find((r) => !r.ready);
  if (invalid)
    fail(
      409,
      invalid.status === 'MISSING' ? 'STATUTORY_VERSION_REQUIRED' : `STATUTORY_${invalid.status}`,
      `${invalid.statute}: ${invalid.nextAction}`,
    );
  if (!readiness.mapping.ready || !readiness.mapping.activeAccountCount)
    fail(
      409,
      'PAYROLL_MAPPING_REQUIRED',
      readiness.mapping.mappings
        .filter((m) => m.nextAction)
        .map((m) => m.nextAction)
        .join(' '),
    );
}
export async function payrollReadiness(scope: WorkforceScope, periodId?: number) {
  return db.transaction(async (tx) => {
    let period: PayrollReadinessPeriod;
    if (periodId) {
      const [row] = await tx
        .select()
        .from(schema.payrollPeriods)
        .where(
          and(
            eq(schema.payrollPeriods.id, periodId),
            eq(schema.payrollPeriods.tenantId, scope.tenantId),
            eq(schema.payrollPeriods.facilityId, scope.facilityId),
          ),
        )
        .limit(1);
      if (!row) fail(404, 'PERIOD_NOT_FOUND', 'Payroll period not found in this facility.');
      period = row;
    } else {
      const today = new Date().toISOString().slice(0, 10);
      period = { startDate: today, endDate: today, payDate: today };
    }
    return {
      ...(await payrollReadinessInside(scope, period, tx)),
      periodId: periodId ?? null,
      assessmentMode: periodId ? 'SELECTED_PERIOD' : 'TODAY_PREVIEW_ONLY',
    };
  });
}
