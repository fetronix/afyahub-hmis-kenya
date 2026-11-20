import {
  assessPayrollAccounts,
  assessPayrollRules,
  payrollRuleIssues,
  type VerifiedPayrollVersion,
  type PayrollReadinessPeriod,
} from './payroll-readiness.ts';
/**
 * Syrona Medical Center HMIS
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
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

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
  calculatePayslip,
  resolveStatutoryVersions,
  type PayrollEmployeeInput,
  type PayslipResult,
  type StatutoryVersion,
} from './payroll-calculator.ts';
import {
  PAYROLL_SOURCE_GUIDANCE,
  RULEBOOK_STATUTES,
  STATUTORY_RULEBOOK,
  rulebookEntryForDate,
} from './statutory-rulebook.ts';

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
  'LATE',
  'ABSENT',
  'LEAVE',
  'HOLIDAY',
  'OFF_DUTY',
  'TRAINING',
  'INCOMPLETE',
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
  const designationCounts = await db
    .select({
      departmentId: schema.hrDesignations.departmentId,
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${schema.hrDesignations.isActive})::int`,
    })
    .from(schema.hrDesignations)
    .where(
      and(
        eq(schema.hrDesignations.tenantId, scope.tenantId),
        eq(schema.hrDesignations.facilityId, scope.facilityId),
      ),
    )
    .groupBy(schema.hrDesignations.departmentId);
  const byDepartment = new Map(counts.map((row) => [row.departmentId, row.employees]));
  const designationsByDepartment = new Map(
    designationCounts.map((row) => [row.departmentId, row]),
  );
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    activeEmployees: byDepartment.get(row.id) ?? 0,
    /* How many designations belong here, so the department list can say so. */
    designations: designationsByDepartment.get(row.id)?.total ?? 0,
    activeDesignations: designationsByDepartment.get(row.id)?.active ?? 0,
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
  const assigned = db
    .select({
      designationId: schema.hrEmployees.designationId,
      employees: sql<number>`count(*)::int`.as('employees'),
    })
    .from(schema.hrEmployees)
    .where(
      and(
        eq(schema.hrEmployees.tenantId, scope.tenantId),
        eq(schema.hrEmployees.facilityId, scope.facilityId),
        eq(schema.hrEmployees.employmentStatus, 'ACTIVE'),
      ),
    )
    .groupBy(schema.hrEmployees.designationId)
    .as('assigned');
  return db
    .select({
      id: schema.hrDesignations.id,
      departmentId: schema.hrDesignations.departmentId,
      departmentName: schema.hrDepartments.name,
      departmentIsActive: schema.hrDepartments.isActive,
      title: schema.hrDesignations.title,
      description: schema.hrDesignations.description,
      grade: schema.hrDesignations.grade,
      isActive: schema.hrDesignations.isActive,
      activeEmployees: sql<number>`coalesce(${assigned.employees}, 0)::int`,
    })
    .from(schema.hrDesignations)
    .leftJoin(schema.hrDepartments, eq(schema.hrDesignations.departmentId, schema.hrDepartments.id))
    .leftJoin(assigned, eq(assigned.designationId, schema.hrDesignations.id))
    .where(
      and(
        eq(schema.hrDesignations.tenantId, scope.tenantId),
        eq(schema.hrDesignations.facilityId, scope.facilityId),
      ),
    )
    .orderBy(asc(schema.hrDepartments.name), asc(schema.hrDesignations.title));
}

/**
 * A designation must name a department that exists in this facility. An inactive
 * department cannot take new designations: the picker offers active ones, and
 * accepting a hidden value would be a bypass of that list.
 */
async function requireActiveDepartment(tx: Tx, scope: WorkforceScope, departmentId: number) {
  const [department] = await tx
    .select({ id: schema.hrDepartments.id, isActive: schema.hrDepartments.isActive })
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
  if (!department.isActive)
    fail(
      409,
      'DEPARTMENT_INACTIVE',
      'That department is inactive. Reactivate it before adding designations to it.',
    );
  return department;
}

function designationFields(input: Record<string, unknown>) {
  const title = requiredText(input.title, 'Designation title', 120);
  const departmentId = positiveId(input.departmentId, 'department');
  const description = optionalText(input.description, 'Description', 500);
  const grade = optionalText(input.grade, 'Grade', 40);
  const isActive = input.isActive === undefined ? true : Boolean(input.isActive);
  return { title, departmentId, description, grade, isActive };
}

export async function createDesignation(scope: WorkforceScope, input: Record<string, unknown>) {
  const fields = designationFields(input);
  return db.transaction(async (tx) => {
    await requireActiveDepartment(tx, scope, fields.departmentId);
    const [row] = await tx
      .insert(schema.hrDesignations)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        departmentId: fields.departmentId,
        title: fields.title,
        description: fields.description,
        grade: fields.grade,
        isActive: fields.isActive,
        createdBy: scope.actorId,
      })
      .returning();
    await audit(tx, scope, 'hr_designation', row.id, 'CREATE', `Created designation ${row.title}`);
    return row;
  });
}

export async function updateDesignation(
  scope: WorkforceScope,
  id: number,
  input: Record<string, unknown>,
) {
  const fields = designationFields(input);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.hrDesignations)
      .where(
        and(
          eq(schema.hrDesignations.id, id),
          eq(schema.hrDesignations.tenantId, scope.tenantId),
          eq(schema.hrDesignations.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!existing) fail(404, 'DESIGNATION_NOT_FOUND', 'Designation not found in this facility.');
    await requireActiveDepartment(tx, scope, fields.departmentId);

    /*
     * Moving a designation to another department would leave the people who
     * hold it recorded under the old one. Refuse while such employees exist
     * rather than silently producing staff whose designation contradicts their
     * department; the message names how many need reassigning first.
     */
    if (existing.departmentId !== fields.departmentId) {
      const [mismatch] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.hrEmployees)
        .where(
          and(
            eq(schema.hrEmployees.tenantId, scope.tenantId),
            eq(schema.hrEmployees.facilityId, scope.facilityId),
            eq(schema.hrEmployees.designationId, id),
            eq(schema.hrEmployees.employmentStatus, 'ACTIVE'),
          ),
        );
      if ((mismatch?.count ?? 0) > 0)
        fail(
          409,
          'DESIGNATION_IN_USE',
          `${mismatch.count} active employee(s) hold this designation. Move those employees to the new department first, or create a designation in the target department.`,
        );
    }

    const [row] = await tx
      .update(schema.hrDesignations)
      .set({
        departmentId: fields.departmentId,
        title: fields.title,
        description: fields.description,
        grade: fields.grade,
        isActive: fields.isActive,
      })
      .where(
        and(
          eq(schema.hrDesignations.id, id),
          eq(schema.hrDesignations.tenantId, scope.tenantId),
          eq(schema.hrDesignations.facilityId, scope.facilityId),
        ),
      )
      .returning();
    if (!row) fail(404, 'DESIGNATION_NOT_FOUND', 'Designation not found in this facility.');
    await audit(tx, scope, 'hr_designation', id, 'UPDATE', `Updated designation ${row.title}`);
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
  // Every cents column leaves the service as a decimal string: JSON has no BigInt.
  return {
    ...row,
    baseSalaryCents: money(row.baseSalaryCents),
    ...('insurancePremiumMonthlyCents' in row
      ? { insurancePremiumMonthlyCents: money(row.insurancePremiumMonthlyCents as bigint) }
      : {}),
  };
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

/**
 * Validates an employee's department and designation as one relationship, not two
 * lookups: the designation must belong to the chosen department, and a newly
 * assigned designation must be active. A designation already on the record is
 * allowed to stay even after it is deactivated, so editing an unaffected field
 * never fails on legacy data.
 */
async function assertDepartmentAndDesignation(
  tx: Tx,
  scope: WorkforceScope,
  departmentId: number | null,
  designationId: number | null,
  currentDesignationId: number | null = null,
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
      .select({
        id: schema.hrDesignations.id,
        departmentId: schema.hrDesignations.departmentId,
        isActive: schema.hrDesignations.isActive,
        title: schema.hrDesignations.title,
      })
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
    if (designation.departmentId !== null && designation.departmentId !== departmentId)
      fail(
        409,
        'DESIGNATION_DEPARTMENT_MISMATCH',
        `“${designation.title}” belongs to a different department. Choose a designation from the employee's department.`,
      );
    if (designationId !== currentDesignationId && !designation.isActive)
      fail(
        409,
        'DESIGNATION_INACTIVE',
        `“${designation.title}” is inactive and cannot be assigned to an employee.`,
      );
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
  /*
   * Tax residency decides whether the personal relief is granted. Defaulting
   * to resident matches the payroll the facility already runs; a non-resident
   * must be switched deliberately so relief is never granted by accident.
   */
  const taxResidency =
    input.taxResidency === undefined || input.taxResidency === null || input.taxResidency === ''
      ? 'RESIDENT'
      : enumValue(input.taxResidency, ['RESIDENT', 'NON_RESIDENT'] as const, 'Tax residency');
  const insurancePremiumMonthlyCents =
    input.insurancePremiumMonthlyCents === undefined
      ? 0n
      : cents(input.insurancePremiumMonthlyCents, 'Declared insurance premium');
  if (insurancePremiumMonthlyCents < 0n)
    fail(400, 'INVALID_PREMIUM', 'A declared insurance premium cannot be negative.');
  const insuranceReliefEvidenceReference = optionalText(
    input.insuranceReliefEvidenceReference,
    'Insurance relief evidence reference',
    200,
  );
  // Relief is granted on declared premiums; a declaration without evidence is not evidence.
  if (insurancePremiumMonthlyCents > 0n && !insuranceReliefEvidenceReference)
    fail(
      400,
      'INSURANCE_EVIDENCE_REQUIRED',
      'Record the evidence reference for the declared insurance premium before it can earn relief.',
    );
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
    taxResidency,
    insurancePremiumMonthlyCents,
    insuranceReliefEvidenceReference,
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
    return presentEmployee(row);
  });
}

export async function updateEmployee(
  scope: WorkforceScope,
  id: number,
  input: Record<string, unknown>,
) {
  const fields = employeeFields(input);
  return db.transaction(async (tx) => {
    /*
     * The designation already on the record is passed through so an employee who
     * holds a since-deactivated designation can still have other fields edited.
     * Only a *new* choice has to be active.
     */
    const [current] = await tx
      .select({ designationId: schema.hrEmployees.designationId })
      .from(schema.hrEmployees)
      .where(
        and(
          eq(schema.hrEmployees.id, id),
          eq(schema.hrEmployees.tenantId, scope.tenantId),
          eq(schema.hrEmployees.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!current) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found in this facility.');
    await assertDepartmentAndDesignation(
      tx,
      scope,
      fields.departmentId,
      fields.designationId,
      current.designationId,
    );
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
    return presentEmployee(row);
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
    return presentEmployee(row);
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

/*
 * A shift is a reusable template. A roster entry is an employee assigned to a
 * shift on one date. Attendance is what actually happened. They are three
 * different records and this module keeps them separate:
 *
 *   hr_shifts          → 07:00–18:00, 60 minutes of break
 *   hr_roster_entries  → employee 12 is on the Day shift on 2026-11-20
 *   hr_attendance      → employee 12 clocked in at 07:04:11 and out at 18:02:40
 *
 * Creating a shift therefore creates no roster entry and no attendance row.
 * Rostering does not create attendance either: only the employee clocking in
 * (or an authorised correction) does.
 */

const DEFAULT_TIME_ZONE = 'Africa/Nairobi';
const DEFAULT_GRACE_MINUTES = 10;
const DEFAULT_ABSENCE_CUTOFF_MINUTES = 240;
const MAX_ROSTER_WINDOW_DAYS = 366;

export type AttendancePolicy = {
  graceMinutes: number;
  absenceCutoffMinutes: number;
  timeZone: string;
  allowRosterConflicts: boolean;
};

type LocalClock = { date: string; minutes: number };

/** Local wall clock for an instant. Never derived from the UTC date. */
export function localClock(instant: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  /* Some ICU builds render midnight as 24 rather than 00. */
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(hour) * 60 + Number(get('minute')),
  };
}

function assertTimeZone(value: unknown): string {
  const timeZone = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
  } catch {
    fail(400, 'INVALID_TIME_ZONE', 'Time zone must be a valid IANA name such as Africa/Nairobi.');
  }
  return timeZone;
}

function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

type ShiftTiming = {
  startMinutes: number;
  endMinutes: number;
  /** True when the shift ends on the following calendar day. */
  overnight: boolean;
  /** Minutes on the clock, before breaks. */
  grossMinutes: number;
  /** Expected working minutes, after the configured break. */
  scheduledMinutes: number;
};

export function shiftTiming(shift: {
  startTime: string;
  endTime: string;
  breakMinutes: number;
}): ShiftTiming {
  const startMinutes = clockMinutes(shift.startTime);
  const endMinutes = clockMinutes(shift.endTime);
  const overnight = endMinutes <= startMinutes;
  const grossMinutes = overnight ? endMinutes + 1440 - startMinutes : endMinutes - startMinutes;
  return {
    startMinutes,
    endMinutes,
    overnight,
    grossMinutes,
    scheduledMinutes: Math.max(0, grossMinutes - shift.breakMinutes),
  };
}

/**
 * Minutes late, relative to a shift start. `offsetDays` is 1 when the shift
 * began yesterday and is still running (a night shift clocked in after
 * midnight), so the comparison stays on the shift's own clock rather than the
 * calendar's.
 */
export function lateMinutesFor(
  clockMinutes: number,
  startMinutes: number,
  offsetDays: number,
  graceMinutes: number,
): number {
  const late = clockMinutes + offsetDays * 1440 - startMinutes;
  return late > graceMinutes ? late - graceMinutes : 0;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

async function readPolicy(scope: WorkforceScope): Promise<AttendancePolicy> {
  const [row] = await db
    .select()
    .from(schema.hrAttendancePolicies)
    .where(eq(schema.hrAttendancePolicies.facilityId, scope.facilityId))
    .limit(1);
  return {
    graceMinutes: row?.graceMinutes ?? DEFAULT_GRACE_MINUTES,
    absenceCutoffMinutes: row?.absenceCutoffMinutes ?? DEFAULT_ABSENCE_CUTOFF_MINUTES,
    timeZone: row?.timeZone ?? DEFAULT_TIME_ZONE,
    allowRosterConflicts: row?.allowRosterConflicts ?? false,
  };
}

export async function getAttendancePolicy(scope: WorkforceScope) {
  const policy = await readPolicy(scope);
  return { ...policy, configured: await hasPolicyRow(scope) };
}

async function hasPolicyRow(scope: WorkforceScope): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.hrAttendancePolicies.id })
    .from(schema.hrAttendancePolicies)
    .where(eq(schema.hrAttendancePolicies.facilityId, scope.facilityId))
    .limit(1);
  return Boolean(row);
}

export async function saveAttendancePolicy(scope: WorkforceScope, input: Record<string, unknown>) {
  const graceMinutes = integerInRange(
    input.graceMinutes ?? DEFAULT_GRACE_MINUTES,
    'Grace period',
    0,
    240,
  );
  const absenceCutoffMinutes = integerInRange(
    input.absenceCutoffMinutes ?? DEFAULT_ABSENCE_CUTOFF_MINUTES,
    'Absence cutoff',
    0,
    1440,
  );
  const timeZone = assertTimeZone(input.timeZone);
  const allowRosterConflicts =
    input.allowRosterConflicts === undefined ? false : Boolean(input.allowRosterConflicts);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.hrAttendancePolicies)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        graceMinutes,
        absenceCutoffMinutes,
        timeZone,
        allowRosterConflicts,
        updatedBy: scope.actorId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.hrAttendancePolicies.facilityId],
        set: {
          graceMinutes,
          absenceCutoffMinutes,
          timeZone,
          allowRosterConflicts,
          updatedBy: scope.actorId,
          updatedAt: new Date(),
        },
      })
      .returning();
    await audit(
      tx,
      scope,
      'hr_attendance_policy',
      row.id,
      'UPDATE',
      `Grace ${graceMinutes}m, absence cutoff ${absenceCutoffMinutes}m, ${timeZone}`,
    );
    return row;
  });
}

function integerInRange(value: unknown, label: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    fail(400, 'INVALID_INPUT', `${label} must be a whole number between ${min} and ${max}.`);
  return parsed;
}

/* ------------------------------------------------------------
   HOLIDAYS
   ------------------------------------------------------------ */

export async function listHolidays(scope: WorkforceScope, from?: string, to?: string) {
  const start = from ? isoDate(from, 'From date') : `${new Date().getUTCFullYear()}-01-01`;
  const end = to ? isoDate(to, 'To date') : `${new Date().getUTCFullYear()}-12-31`;
  return db
    .select()
    .from(schema.hrHolidays)
    .where(
      and(
        eq(schema.hrHolidays.tenantId, scope.tenantId),
        eq(schema.hrHolidays.facilityId, scope.facilityId),
        gte(schema.hrHolidays.holidayDate, start),
        lte(schema.hrHolidays.holidayDate, end),
      ),
    )
    .orderBy(asc(schema.hrHolidays.holidayDate));
}

export async function createHoliday(scope: WorkforceScope, input: Record<string, unknown>) {
  const holidayDate = isoDate(input.holidayDate ?? input.date, 'Holiday date');
  const name = requiredText(input.name, 'Holiday name', 120);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.hrHolidays.id })
      .from(schema.hrHolidays)
      .where(
        and(
          eq(schema.hrHolidays.facilityId, scope.facilityId),
          eq(schema.hrHolidays.holidayDate, holidayDate),
        ),
      )
      .limit(1);
    if (existing) fail(409, 'HOLIDAY_EXISTS', 'A holiday is already recorded on that date.');
    const [row] = await tx
      .insert(schema.hrHolidays)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        holidayDate,
        name,
        createdBy: scope.actorId,
      })
      .returning();
    await audit(tx, scope, 'hr_holiday', row.id, 'CREATE', `Holiday ${name} on ${holidayDate}`);
    return row;
  });
}

export async function deleteHoliday(scope: WorkforceScope, id: number) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.hrHolidays)
      .where(
        and(
          eq(schema.hrHolidays.id, id),
          eq(schema.hrHolidays.tenantId, scope.tenantId),
          eq(schema.hrHolidays.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!row) fail(404, 'HOLIDAY_NOT_FOUND', 'Holiday not found in this facility.');
    await tx.delete(schema.hrHolidays).where(eq(schema.hrHolidays.id, id));
    await audit(tx, scope, 'hr_holiday', id, 'DELETE', `Removed holiday ${row.name}`);
    return { id };
  });
}

/* ------------------------------------------------------------
   SHIFTS — reusable definitions of expected working hours
   ------------------------------------------------------------ */

export type ShiftRow = {
  id: number;
  name: string;
  description: string | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  departmentId: number | null;
  departmentName: string | null;
  isActive: boolean;
  overnight: boolean;
  expectedHours: number;
  scheduledMinutes: number;
  assignedToday: number;
};

export async function listShifts(scope: WorkforceScope, date?: string): Promise<ShiftRow[]> {
  const policy = await readPolicy(scope);
  const workDate = date ? isoDate(date, 'Work date') : localClock(new Date(), policy.timeZone).date;
  const rows = await db
    .select({
      id: schema.hrShifts.id,
      name: schema.hrShifts.name,
      description: schema.hrShifts.description,
      startTime: schema.hrShifts.startTime,
      endTime: schema.hrShifts.endTime,
      breakMinutes: schema.hrShifts.breakMinutes,
      departmentId: schema.hrShifts.departmentId,
      departmentName: schema.hrDepartments.name,
      isActive: schema.hrShifts.isActive,
      assignedToday: sql<number>`(
        SELECT COUNT(*) FROM ${schema.hrRosterEntries} roster
        WHERE roster.shift_id = ${schema.hrShifts.id}
          AND roster.work_date = ${workDate}
          AND roster.status = 'ASSIGNED'
      )`,
    })
    .from(schema.hrShifts)
    .leftJoin(schema.hrDepartments, eq(schema.hrShifts.departmentId, schema.hrDepartments.id))
    .where(
      and(
        eq(schema.hrShifts.tenantId, scope.tenantId),
        eq(schema.hrShifts.facilityId, scope.facilityId),
      ),
    )
    .orderBy(asc(schema.hrShifts.startTime), asc(schema.hrShifts.name));
  return rows.map((row) => {
    const timing = shiftTiming(row);
    return {
      ...row,
      assignedToday: Number(row.assignedToday ?? 0),
      overnight: timing.overnight,
      scheduledMinutes: timing.scheduledMinutes,
      expectedHours: Math.round((timing.scheduledMinutes / 60) * 100) / 100,
    };
  });
}

type ShiftInput = {
  name: string;
  description: string | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  departmentId: number | null;
  isActive: boolean;
};

async function validateShiftInput(
  tx: Tx,
  scope: WorkforceScope,
  input: Record<string, unknown>,
  existingId: number | null,
): Promise<ShiftInput> {
  const name = requiredText(input.name, 'Shift name', 60);
  const description = optionalText(input.description, 'Description', 200);
  const startTime = optionalTime(input.startTime, 'Start time');
  const endTime = optionalTime(input.endTime, 'End time');
  if (!startTime || !endTime) fail(400, 'INVALID_TIME', 'Start and end times are required.');
  if (startTime === endTime)
    fail(400, 'INVALID_TIME', 'Start and end times cannot be identical.');
  const breakMinutes =
    input.breakMinutes === undefined || input.breakMinutes === null || input.breakMinutes === ''
      ? 0
      : integerInRange(input.breakMinutes, 'Break duration', 0, 480);
  const departmentId = optionalPositiveId(input.departmentId, 'department');
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
  /* Names are unique per facility; compare case-insensitively so "Day" and
     "day" cannot both exist and confuse the roster. */
  const [duplicate] = await tx
    .select({ id: schema.hrShifts.id })
    .from(schema.hrShifts)
    .where(
      and(
        eq(schema.hrShifts.facilityId, scope.facilityId),
        sql`lower(${schema.hrShifts.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (duplicate && duplicate.id !== existingId)
    fail(409, 'SHIFT_EXISTS', `A shift named ${name} already exists in this facility.`);
  const isActive = input.isActive === undefined ? true : Boolean(input.isActive);
  return { name, description, startTime, endTime, breakMinutes, departmentId, isActive };
}

export async function createShift(scope: WorkforceScope, input: Record<string, unknown>) {
  return db.transaction(async (tx) => {
    const values = await validateShiftInput(tx, scope, input, null);
    const [row] = await tx
      .insert(schema.hrShifts)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        ...values,
        createdBy: scope.actorId,
      })
      .returning();
    const timing = shiftTiming(row);
    await audit(
      tx,
      scope,
      'hr_shift',
      row.id,
      'CREATE',
      `Created shift ${row.name} ${row.startTime}–${row.endTime}` +
        `${timing.overnight ? ' (overnight)' : ''}, ${row.breakMinutes}m break`,
    );
    return {
      ...row,
      overnight: timing.overnight,
      scheduledMinutes: timing.scheduledMinutes,
      expectedHours: Math.round((timing.scheduledMinutes / 60) * 100) / 100,
      assignedToday: 0,
    };
  });
}

export async function updateShift(
  scope: WorkforceScope,
  id: number,
  input: Record<string, unknown>,
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.hrShifts)
      .where(
        and(
          eq(schema.hrShifts.id, id),
          eq(schema.hrShifts.tenantId, scope.tenantId),
          eq(schema.hrShifts.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!existing) fail(404, 'SHIFT_NOT_FOUND', 'Shift not found in this facility.');
    const values = await validateShiftInput(tx, scope, input, id);
    const [row] = await tx
      .update(schema.hrShifts)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.hrShifts.id, id))
      .returning();
    await audit(
      tx,
      scope,
      'hr_shift',
      id,
      'UPDATE',
      `Updated shift ${row.name} ${row.startTime}–${row.endTime}` +
        `${row.isActive ? '' : ' (inactive)'}`,
    );
    const timing = shiftTiming(row);
    return {
      ...row,
      overnight: timing.overnight,
      scheduledMinutes: timing.scheduledMinutes,
      expectedHours: Math.round((timing.scheduledMinutes / 60) * 100) / 100,
      assignedToday: 0,
    };
  });
}

/* ------------------------------------------------------------
   ROSTER — an employee assigned to a shift on a date
   ------------------------------------------------------------ */

export type RosterRow = {
  id: number;
  employeeId: number;
  employeeNumber: string;
  employeeName: string;
  departmentId: number | null;
  departmentName: string | null;
  designationTitle: string | null;
  workDate: string;
  shiftId: number;
  shiftName: string;
  startTime: string;
  endTime: string;
  overnight: boolean;
  scheduledMinutes: number;
  status: string;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  lateMinutes: number | null;
};

export async function listRoster(
  scope: WorkforceScope,
  query: {
    from?: string;
    to?: string;
    departmentId?: number | null;
    employeeId?: number | null;
    shiftId?: number | null;
    includeCancelled?: boolean;
  },
): Promise<RosterRow[]> {
  const policy = await readPolicy(scope);
  const today = localClock(new Date(), policy.timeZone).date;
  const from = query.from ? isoDate(query.from, 'From date') : today;
  const to = query.to ? isoDate(query.to, 'To date') : from;
  if (to < from) fail(400, 'INVALID_RANGE', 'The end date cannot be before the start date.');
  const conditions = [
    eq(schema.hrRosterEntries.tenantId, scope.tenantId),
    eq(schema.hrRosterEntries.facilityId, scope.facilityId),
    gte(schema.hrRosterEntries.workDate, from),
    lte(schema.hrRosterEntries.workDate, to),
  ];
  if (!query.includeCancelled) conditions.push(eq(schema.hrRosterEntries.status, 'ASSIGNED'));
  if (query.departmentId) conditions.push(eq(schema.hrRosterEntries.departmentId, query.departmentId));
  if (query.employeeId) conditions.push(eq(schema.hrRosterEntries.employeeId, query.employeeId));
  if (query.shiftId) conditions.push(eq(schema.hrRosterEntries.shiftId, query.shiftId));

  const rows = await db
    .select({
      id: schema.hrRosterEntries.id,
      employeeId: schema.hrRosterEntries.employeeId,
      employeeNumber: schema.hrEmployees.employeeNumber,
      firstName: schema.hrEmployees.firstName,
      lastName: schema.hrEmployees.lastName,
      departmentId: schema.hrRosterEntries.departmentId,
      departmentName: schema.hrDepartments.name,
      designationTitle: schema.hrDesignations.title,
      workDate: schema.hrRosterEntries.workDate,
      shiftId: schema.hrShifts.id,
      shiftName: schema.hrShifts.name,
      startTime: schema.hrShifts.startTime,
      endTime: schema.hrShifts.endTime,
      breakMinutes: schema.hrShifts.breakMinutes,
      status: schema.hrRosterEntries.status,
      notes: schema.hrRosterEntries.notes,
      cancelledAt: schema.hrRosterEntries.cancelledAt,
      cancelReason: schema.hrRosterEntries.cancelReason,
      clockInAt: schema.hrAttendance.clockInAt,
      clockOutAt: schema.hrAttendance.clockOutAt,
      lateMinutes: schema.hrAttendance.lateMinutes,
    })
    .from(schema.hrRosterEntries)
    .innerJoin(schema.hrEmployees, eq(schema.hrRosterEntries.employeeId, schema.hrEmployees.id))
    .innerJoin(schema.hrShifts, eq(schema.hrRosterEntries.shiftId, schema.hrShifts.id))
    .leftJoin(schema.hrDepartments, eq(schema.hrRosterEntries.departmentId, schema.hrDepartments.id))
    .leftJoin(schema.hrDesignations, eq(schema.hrEmployees.designationId, schema.hrDesignations.id))
    .leftJoin(
      schema.hrAttendance,
      and(
        eq(schema.hrAttendance.employeeId, schema.hrRosterEntries.employeeId),
        eq(schema.hrAttendance.workDate, schema.hrRosterEntries.workDate),
      ),
    )
    .where(and(...conditions))
    .orderBy(
      asc(schema.hrRosterEntries.workDate),
      asc(schema.hrShifts.startTime),
      asc(schema.hrEmployees.lastName),
      asc(schema.hrEmployees.firstName),
    );

  return rows.map((row) => {
    const timing = shiftTiming(row);
    return {
      id: row.id,
      employeeId: row.employeeId,
      employeeNumber: row.employeeNumber,
      employeeName: `${row.firstName} ${row.lastName}`,
      departmentId: row.departmentId,
      departmentName: row.departmentName,
      designationTitle: row.designationTitle,
      workDate: row.workDate,
      shiftId: row.shiftId,
      shiftName: row.shiftName,
      startTime: row.startTime,
      endTime: row.endTime,
      overnight: timing.overnight,
      scheduledMinutes: timing.scheduledMinutes,
      status: row.status,
      notes: row.notes,
      cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
      cancelReason: row.cancelReason,
      clockInAt: row.clockInAt ? row.clockInAt.toISOString() : null,
      clockOutAt: row.clockOutAt ? row.clockOutAt.toISOString() : null,
      lateMinutes: row.lateMinutes,
    };
  });
}

export async function assignRoster(scope: WorkforceScope, input: Record<string, unknown>) {
  const shiftId = positiveId(input.shiftId, 'shift');
  const workDate = isoDate(input.workDate, 'Work date');
  const notes = optionalText(input.notes, 'Notes', 300);
  const rawIds = Array.isArray(input.employeeIds) ? input.employeeIds : [input.employeeId];
  if (!rawIds.length) fail(400, 'INVALID_ID', 'Select at least one employee.');
  const employeeIds = [...new Set(rawIds.map((value) => positiveId(value, 'employee')))];
  const policy = await readPolicy(scope);
  const today = localClock(new Date(), policy.timeZone).date;
  const offset = daysBetween(today, workDate);
  if (offset < -MAX_ROSTER_WINDOW_DAYS || offset > MAX_ROSTER_WINDOW_DAYS)
    fail(400, 'INVALID_DATE', 'A roster can only be built within one year of today.');

  return db.transaction(async (tx) => {
    const [shift] = await tx
      .select()
      .from(schema.hrShifts)
      .where(
        and(
          eq(schema.hrShifts.id, shiftId),
          eq(schema.hrShifts.tenantId, scope.tenantId),
          eq(schema.hrShifts.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!shift) fail(404, 'SHIFT_NOT_FOUND', 'Shift not found in this facility.');
    if (!shift.isActive)
      fail(409, 'SHIFT_INACTIVE', `Shift ${shift.name} is inactive and cannot be assigned.`);

    const saved: Array<{ id: number; employeeId: number; employeeName: string }> = [];
    const skipped: Array<{ employeeId: number; employeeName: string; reason: string }> = [];

    for (const employeeId of employeeIds) {
      const [employee] = await tx
        .select({
          id: schema.hrEmployees.id,
          employeeNumber: schema.hrEmployees.employeeNumber,
          firstName: schema.hrEmployees.firstName,
          lastName: schema.hrEmployees.lastName,
          departmentId: schema.hrEmployees.departmentId,
          employmentStatus: schema.hrEmployees.employmentStatus,
          hireDate: schema.hrEmployees.hireDate,
        })
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
      const employeeName = `${employee.firstName} ${employee.lastName}`;
      if (employee.employmentStatus === 'EXITED') {
        /* A bulk assignment reports the refusal instead of failing the batch. */
        if (employeeIds.length === 1)
          fail(409, 'EMPLOYEE_EXITED', `${employeeName} has left; they cannot be rostered.`);
        skipped.push({ employeeId, employeeName, reason: 'Employee has left the facility.' });
        continue;
      }
      if (employee.hireDate > workDate) {
        if (employeeIds.length === 1)
          fail(
            400,
            'EMPLOYEE_NOT_HIRED',
            `${employeeName} was not yet employed on ${workDate}.`,
          );
        skipped.push({ employeeId, employeeName, reason: `Not employed on ${workDate}.` });
        continue;
      }
      if (shift.departmentId && employee.departmentId !== shift.departmentId) {
        const message = `${employeeName} is not in the department this shift belongs to.`;
        if (employeeIds.length === 1) fail(409, 'SHIFT_DEPARTMENT_MISMATCH', message);
        skipped.push({ employeeId, employeeName, reason: message });
        continue;
      }

      const [existing] = await tx
        .select({
          id: schema.hrRosterEntries.id,
          shiftId: schema.hrRosterEntries.shiftId,
          status: schema.hrRosterEntries.status,
          shiftName: schema.hrShifts.name,
        })
        .from(schema.hrRosterEntries)
        .innerJoin(schema.hrShifts, eq(schema.hrRosterEntries.shiftId, schema.hrShifts.id))
        .where(
          and(
            eq(schema.hrRosterEntries.employeeId, employeeId),
            eq(schema.hrRosterEntries.workDate, workDate),
          ),
        )
        .limit(1);

      if (existing && existing.status === 'ASSIGNED' && existing.shiftId !== shiftId) {
        if (!policy.allowRosterConflicts) {
          const message = `${employeeName} is already rostered on ${existing.shiftName} that day.`;
          if (employeeIds.length === 1) fail(409, 'ROSTER_CONFLICT', message);
          skipped.push({ employeeId, employeeName, reason: message });
          continue;
        }
      } else if (existing && existing.status === 'ASSIGNED' && existing.shiftId === shiftId) {
        const message = `${employeeName} is already rostered on ${shift.name} that day.`;
        if (employeeIds.length === 1) fail(409, 'ROSTER_DUPLICATE', message);
        skipped.push({ employeeId, employeeName, reason: message });
        continue;
      }

      let row;
      if (existing) {
        [row] = await tx
          .update(schema.hrRosterEntries)
          .set({
            shiftId,
            departmentId: employee.departmentId,
            status: 'ASSIGNED',
            notes,
            cancelledAt: null,
            cancelledBy: null,
            cancelReason: null,
            createdBy: scope.actorId,
            updatedAt: new Date(),
          })
          .where(eq(schema.hrRosterEntries.id, existing.id))
          .returning();
        await audit(
          tx,
          scope,
          'hr_roster',
          row.id,
          existing.status === 'CANCELLED' ? 'REASSIGN' : 'REPLACE',
          `${employeeName} (${employee.employeeNumber}) ${existing.status === 'CANCELLED' ? 're-rostered' : `moved from ${existing.shiftName}`} to ${shift.name} on ${workDate}`,
        );
      } else {
        [row] = await tx
          .insert(schema.hrRosterEntries)
          .values({
            tenantId: scope.tenantId,
            facilityId: scope.facilityId,
            employeeId,
            shiftId,
            departmentId: employee.departmentId,
            workDate,
            status: 'ASSIGNED',
            notes,
            createdBy: scope.actorId,
          })
          .returning();
        await audit(
          tx,
          scope,
          'hr_roster',
          row.id,
          'ASSIGN',
          `${employeeName} (${employee.employeeNumber}) rostered on ${shift.name} for ${workDate}`,
        );
      }
      saved.push({ id: row.id, employeeId, employeeName });
    }

    return { saved, skipped, workDate, shiftId };
  });
}

export async function cancelRosterEntry(
  scope: WorkforceScope,
  id: number,
  input: Record<string, unknown>,
) {
  const reason = optionalText(input.reason, 'Cancellation reason', 300);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.hrRosterEntries)
      .where(
        and(
          eq(schema.hrRosterEntries.id, id),
          eq(schema.hrRosterEntries.tenantId, scope.tenantId),
          eq(schema.hrRosterEntries.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!existing) fail(404, 'ROSTER_NOT_FOUND', 'Roster assignment not found in this facility.');
    if (existing.status === 'CANCELLED')
      fail(409, 'ROSTER_ALREADY_CANCELLED', 'This assignment is already cancelled.');
    const [row] = await tx
      .update(schema.hrRosterEntries)
      .set({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: scope.actorId,
        cancelReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(schema.hrRosterEntries.id, id))
      .returning();
    await audit(
      tx,
      scope,
      'hr_roster',
      id,
      'CANCEL',
      `Cancelled roster for employee ${existing.employeeId} on ${existing.workDate}` +
        `${reason ? `: ${reason}` : ''}`,
    );
    return row;
  });
}

/* ------------------------------------------------------------
   ATTENDANCE — what actually happened
   ------------------------------------------------------------ */

type EmployeeForAttendance = {
  id: number;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  departmentId: number | null;
  departmentName: string | null;
  designationTitle: string | null;
  employmentStatus: string;
  hireDate: string;
  userId: number | null;
};

type RosterContext = {
  rosterEntryId: number;
  shiftId: number;
  shiftName: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  timing: ShiftTiming;
};

export type AttendanceState =
  | 'CLOCKED_IN'
  | 'CLOCKED_OUT'
  | 'NOT_STARTED'
  | 'ABSENT'
  | 'EXCUSED'
  | 'UNROSTERED';

export type AttendanceRow = {
  employeeId: number;
  attendanceId: number | null;
  employeeNumber: string;
  name: string;
  departmentId: number | null;
  departmentName: string | null;
  designationTitle: string | null;
  rosterEntryId: number | null;
  shiftId: number | null;
  shiftName: string | null;
  startTime: string | null;
  endTime: string | null;
  overnight: boolean;
  scheduledMinutes: number | null;
  expectedHours: number | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  clockInLocal: string | null;
  clockOutLocal: string | null;
  status: string | null;
  attendanceState: AttendanceState;
  lateMinutes: number | null;
  workedMinutes: number | null;
  overtimeMinutes: number | null;
  hoursWorked: number | null;
  canClockIn: boolean;
  canClockOut: boolean;
  excusedReason: string | null;
  notes: string | null;
};

function timeLabel(instant: Date | null, timeZone: string): string | null {
  if (!instant) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}

/**
 * The attendance day. One row per active employee, combining four sources:
 * the roster (what was expected), the attendance record (what happened), the
 * leave book (why it did not) and the holiday calendar.
 *
 * A roster assignment is never treated as attendance, and a manual status is
 * never treated as a clock-in.
 */
export async function attendanceForDate(
  scope: WorkforceScope,
  date?: string,
  filters: {
    departmentId?: number | null;
    employeeId?: number | null;
    shiftId?: number | null;
    status?: string | null;
  } = {},
) {
  const policy = await readPolicy(scope);
  const now = new Date();
  const todayLocal = localClock(now, policy.timeZone);
  const workDate = date ? isoDate(date, 'Work date') : todayLocal.date;
  const isToday = workDate === todayLocal.date;
  const isPast = workDate < todayLocal.date;

  const employeeConditions = [
    eq(schema.hrEmployees.tenantId, scope.tenantId),
    eq(schema.hrEmployees.facilityId, scope.facilityId),
    lte(schema.hrEmployees.hireDate, workDate),
  ];
  if (filters.employeeId) employeeConditions.push(eq(schema.hrEmployees.id, filters.employeeId));

  const [employees, rosterRows, records, leaveRows, holidayRows] = await Promise.all([
    db
      .select({
        id: schema.hrEmployees.id,
        employeeNumber: schema.hrEmployees.employeeNumber,
        firstName: schema.hrEmployees.firstName,
        lastName: schema.hrEmployees.lastName,
        departmentId: schema.hrEmployees.departmentId,
        departmentName: schema.hrDepartments.name,
        designationTitle: schema.hrDesignations.title,
        employmentStatus: schema.hrEmployees.employmentStatus,
        hireDate: schema.hrEmployees.hireDate,
        userId: schema.hrEmployees.userId,
      })
      .from(schema.hrEmployees)
      .leftJoin(schema.hrDepartments, eq(schema.hrEmployees.departmentId, schema.hrDepartments.id))
      .leftJoin(schema.hrDesignations, eq(schema.hrEmployees.designationId, schema.hrDesignations.id))
      .where(and(...employeeConditions))
      .orderBy(asc(schema.hrEmployees.lastName), asc(schema.hrEmployees.firstName)),
    db
      .select({
        id: schema.hrRosterEntries.id,
        employeeId: schema.hrRosterEntries.employeeId,
        shiftId: schema.hrShifts.id,
        shiftName: schema.hrShifts.name,
        startTime: schema.hrShifts.startTime,
        endTime: schema.hrShifts.endTime,
        breakMinutes: schema.hrShifts.breakMinutes,
      })
      .from(schema.hrRosterEntries)
      .innerJoin(schema.hrShifts, eq(schema.hrRosterEntries.shiftId, schema.hrShifts.id))
      .where(
        and(
          eq(schema.hrRosterEntries.tenantId, scope.tenantId),
          eq(schema.hrRosterEntries.facilityId, scope.facilityId),
          eq(schema.hrRosterEntries.workDate, workDate),
          eq(schema.hrRosterEntries.status, 'ASSIGNED'),
        ),
      ),
    db
      .select()
      .from(schema.hrAttendance)
      .where(
        and(
          eq(schema.hrAttendance.tenantId, scope.tenantId),
          eq(schema.hrAttendance.facilityId, scope.facilityId),
          eq(schema.hrAttendance.workDate, workDate),
        ),
      ),
    db
      .select({
        employeeId: schema.hrLeaveRequests.employeeId,
        leaveTypeName: schema.hrLeaveTypes.name,
      })
      .from(schema.hrLeaveRequests)
      .innerJoin(schema.hrLeaveTypes, eq(schema.hrLeaveRequests.leaveTypeId, schema.hrLeaveTypes.id))
      .where(
        and(
          eq(schema.hrLeaveRequests.tenantId, scope.tenantId),
          eq(schema.hrLeaveRequests.facilityId, scope.facilityId),
          eq(schema.hrLeaveRequests.status, 'APPROVED'),
          lte(schema.hrLeaveRequests.startDate, workDate),
          gte(schema.hrLeaveRequests.endDate, workDate),
        ),
      ),
    db
      .select({ name: schema.hrHolidays.name })
      .from(schema.hrHolidays)
      .where(
        and(
          eq(schema.hrHolidays.tenantId, scope.tenantId),
          eq(schema.hrHolidays.facilityId, scope.facilityId),
          eq(schema.hrHolidays.holidayDate, workDate),
        ),
      )
      .limit(1),
  ]);

  const rosterByEmployee = new Map<number, RosterContext>();
  for (const row of rosterRows) {
    rosterByEmployee.set(row.employeeId, {
      rosterEntryId: row.id,
      shiftId: row.shiftId,
      shiftName: row.shiftName,
      startTime: row.startTime,
      endTime: row.endTime,
      breakMinutes: row.breakMinutes,
      timing: shiftTiming(row),
    });
  }
  const recordByEmployee = new Map(records.map((record) => [record.employeeId, record]));
  const leaveByEmployee = new Map(leaveRows.map((leave) => [leave.employeeId, leave]));
  const holiday = holidayRows[0] ?? null;

  const active = employees.filter((employee) => employee.employmentStatus !== 'EXITED');
  const rows: AttendanceRow[] = active.map((employee) => {
    const roster = rosterByEmployee.get(employee.id) ?? null;
    const record = recordByEmployee.get(employee.id) ?? null;
    const leave = leaveByEmployee.get(employee.id) ?? null;
    const timing = roster?.timing ?? null;

    let status: string | null = null;
    let attendanceState: AttendanceState = 'UNROSTERED';
    let excusedReason: string | null = null;

    if (record?.clockInAt) {
      status = record.status;
      attendanceState = record.clockOutAt ? 'CLOCKED_OUT' : 'CLOCKED_IN';
    } else if (leave) {
      status = 'LEAVE';
      attendanceState = 'EXCUSED';
      excusedReason = `Approved ${leave.leaveTypeName}`;
    } else if (holiday) {
      status = 'HOLIDAY';
      attendanceState = 'EXCUSED';
      excusedReason = holiday.name;
    } else if (record?.status) {
      status = record.status;
      attendanceState =
        record.status === 'ABSENT'
          ? 'ABSENT'
          : ['LEAVE', 'HOLIDAY', 'OFF_DUTY', 'TRAINING'].includes(record.status)
            ? 'EXCUSED'
            : 'EXCUSED';
      if (record.notes) excusedReason = record.notes;
    } else if (roster) {
      const startMinutes = timing!.startMinutes;
      const minutesSinceStart = isToday
        ? todayLocal.minutes - startMinutes
        : isPast
          ? Number.POSITIVE_INFINITY
          : -1;
      if (minutesSinceStart > policy.absenceCutoffMinutes) {
        status = 'ABSENT';
        attendanceState = 'ABSENT';
      } else {
        status = null;
        attendanceState = 'NOT_STARTED';
      }
    }

    /* A previous day that was started but never finished is incomplete, not present. */
    if (
      isPast &&
      record?.clockInAt &&
      !record.clockOutAt &&
      status !== 'LEAVE' &&
      status !== 'HOLIDAY' &&
      status !== 'OFF_DUTY'
    ) {
      status = 'INCOMPLETE';
      attendanceState = 'CLOCKED_IN';
    }

    const clockIn = record?.clockInAt ?? null;
    const clockOut = record?.clockOutAt ?? null;
    return {
      employeeId: employee.id,
      attendanceId: record?.id ?? null,
      employeeNumber: employee.employeeNumber,
      name: `${employee.firstName} ${employee.lastName}`,
      departmentId: employee.departmentId,
      departmentName: employee.departmentName,
      designationTitle: employee.designationTitle,
      rosterEntryId: roster?.rosterEntryId ?? null,
      shiftId: roster?.shiftId ?? null,
      shiftName: roster?.shiftName ?? null,
      startTime: roster?.startTime ?? null,
      endTime: roster?.endTime ?? null,
      overnight: timing?.overnight ?? false,
      scheduledMinutes: timing?.scheduledMinutes ?? null,
      expectedHours:
        timing === null ? null : Math.round((timing.scheduledMinutes / 60) * 100) / 100,
      clockInAt: clockIn ? clockIn.toISOString() : null,
      clockOutAt: clockOut ? clockOut.toISOString() : null,
      clockInLocal: timeLabel(clockIn, policy.timeZone),
      clockOutLocal: timeLabel(clockOut, policy.timeZone),
      status,
      attendanceState,
      lateMinutes: record?.lateMinutes ?? null,
      workedMinutes: record?.workedMinutes ?? null,
      overtimeMinutes: record?.overtimeMinutes ?? null,
      hoursWorked:
        record?.workedMinutes === null || record?.workedMinutes === undefined
          ? null
          : Math.round((record.workedMinutes / 60) * 100) / 100,
      canClockIn: Boolean(roster) && !clockIn && !leave && !holiday && isToday,
      canClockOut: Boolean(clockIn) && !clockOut,
      excusedReason,
      notes: record?.notes ?? null,
    };
  });

  const filtered = rows.filter((row) => {
    if (filters.departmentId && row.departmentId !== filters.departmentId) return false;
    if (filters.shiftId && row.shiftId !== filters.shiftId) return false;
    if (filters.status) {
      if (filters.status === 'NOT_CLOCKED_IN') return row.attendanceState === 'NOT_STARTED';
      if (filters.status === 'CLOCKED_IN') return row.attendanceState === 'CLOCKED_IN';
      if (filters.status === 'UNROSTERED') return row.attendanceState === 'UNROSTERED';
      return row.status === filters.status;
    }
    return true;
  });

  const count = (predicate: (row: AttendanceRow) => boolean) => filtered.filter(predicate).length;
  const summary = {
    expected: count((row) => row.rosterEntryId !== null || row.clockInAt !== null),
    present: count((row) => row.clockInAt !== null),
    late: count((row) => row.status === 'LATE'),
    absent: count((row) => row.status === 'ABSENT'),
    onLeave: count((row) => row.status === 'LEAVE'),
    offDuty: count((row) => row.status === 'OFF_DUTY'),
    holiday: count((row) => row.status === 'HOLIDAY'),
    training: count((row) => row.status === 'TRAINING'),
    incomplete: count((row) => row.status === 'INCOMPLETE'),
    notClockedIn: count((row) => row.attendanceState === 'NOT_STARTED'),
    clockedInNotOut: count((row) => row.attendanceState === 'CLOCKED_IN' && row.status !== 'INCOMPLETE'),
    unrostered: count((row) => row.attendanceState === 'UNROSTERED'),
  };

  return {
    date: workDate,
    timeZone: policy.timeZone,
    policy: {
      graceMinutes: policy.graceMinutes,
      absenceCutoffMinutes: policy.absenceCutoffMinutes,
    },
    holiday: holiday?.name ?? null,
    summary,
    rows: filtered,
  };
}

async function employeeForClock(
  tx: Tx,
  scope: WorkforceScope,
  employeeId: number,
): Promise<EmployeeForAttendance> {
  const [employee] = await tx
    .select({
      id: schema.hrEmployees.id,
      employeeNumber: schema.hrEmployees.employeeNumber,
      firstName: schema.hrEmployees.firstName,
      lastName: schema.hrEmployees.lastName,
      departmentId: schema.hrEmployees.departmentId,
      departmentName: schema.hrDepartments.name,
      designationTitle: schema.hrDesignations.title,
      employmentStatus: schema.hrEmployees.employmentStatus,
      hireDate: schema.hrEmployees.hireDate,
      userId: schema.hrEmployees.userId,
    })
    .from(schema.hrEmployees)
    .leftJoin(schema.hrDepartments, eq(schema.hrEmployees.departmentId, schema.hrDepartments.id))
    .leftJoin(schema.hrDesignations, eq(schema.hrEmployees.designationId, schema.hrDesignations.id))
    .where(
      and(
        eq(schema.hrEmployees.id, employeeId),
        eq(schema.hrEmployees.tenantId, scope.tenantId),
        eq(schema.hrEmployees.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  if (!employee) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found in this facility.');
  return employee;
}

/** The employee record linked to a login, if any. Used for self-service. */
export async function employeeIdForUser(
  scope: WorkforceScope,
  userId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ id: schema.hrEmployees.id })
    .from(schema.hrEmployees)
    .where(
      and(
        eq(schema.hrEmployees.userId, userId),
        eq(schema.hrEmployees.tenantId, scope.tenantId),
        eq(schema.hrEmployees.facilityId, scope.facilityId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * The roster entry that justifies attendance right now. Today's assignment is
 * preferred; a night shift assigned yesterday still counts while it runs.
 */
async function rosterForMoment(
  tx: Tx,
  scope: WorkforceScope,
  employeeId: number,
  timeZone: string,
  now: Date,
): Promise<{ roster: RosterContext; workDate: string; lateMinutes: number } | null> {
  const clock = localClock(now, timeZone);
  const candidates = [
    { workDate: clock.date, offset: 0 },
    { workDate: addDays(clock.date, -1), offset: 1 },
  ];
  for (const candidate of candidates) {
    const [row] = await tx
      .select({
        id: schema.hrRosterEntries.id,
        workDate: schema.hrRosterEntries.workDate,
        shiftId: schema.hrShifts.id,
        shiftName: schema.hrShifts.name,
        startTime: schema.hrShifts.startTime,
        endTime: schema.hrShifts.endTime,
        breakMinutes: schema.hrShifts.breakMinutes,
      })
      .from(schema.hrRosterEntries)
      .innerJoin(schema.hrShifts, eq(schema.hrRosterEntries.shiftId, schema.hrShifts.id))
      .where(
        and(
          eq(schema.hrRosterEntries.tenantId, scope.tenantId),
          eq(schema.hrRosterEntries.facilityId, scope.facilityId),
          eq(schema.hrRosterEntries.employeeId, employeeId),
          eq(schema.hrRosterEntries.workDate, candidate.workDate),
          eq(schema.hrRosterEntries.status, 'ASSIGNED'),
        ),
      )
      .limit(1);
    if (!row) continue;
    const timing = shiftTiming(row);
    /* Yesterday's entry only covers now when its shift crosses midnight. */
    if (candidate.offset === 1) {
      if (!timing.overnight) continue;
      if (clock.minutes > timing.endMinutes) continue;
    }
    return {
      roster: {
        rosterEntryId: row.id,
        shiftId: row.shiftId,
        shiftName: row.shiftName,
        startTime: row.startTime,
        endTime: row.endTime,
        breakMinutes: row.breakMinutes,
        timing,
      },
      workDate: candidate.workDate,
      /* Raw minutes past the start; the policy's grace is applied at clock-in. */
      lateMinutes: Math.max(0, clock.minutes + candidate.offset * 1440 - timing.startMinutes),
    };
  }
  return null;
}

export async function clockIn(scope: WorkforceScope, input: Record<string, unknown>) {
  const employeeId = positiveId(input.employeeId, 'employee');
  return db.transaction(async (tx) => {
    const policy = await readPolicy(scope);
    const now = new Date();
    const employee = await employeeForClock(tx, scope, employeeId);
    if (employee.employmentStatus === 'EXITED')
      fail(409, 'EMPLOYEE_EXITED', 'Attendance cannot be recorded for an employee who has left.');

    const match = await rosterForMoment(tx, scope, employeeId, policy.timeZone, now);
    if (!match) {
      fail(
        409,
        'NO_ROSTER_ASSIGNMENT',
        'No roster assignment covers this moment. Ask HR to add you to the roster before clocking in.',
      );
    }

    const [existing] = await tx
      .select()
      .from(schema.hrAttendance)
      .where(
        and(
          eq(schema.hrAttendance.employeeId, employeeId),
          eq(schema.hrAttendance.workDate, match.workDate),
          eq(schema.hrAttendance.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (existing?.clockInAt)
      fail(409, 'ALREADY_CLOCKED_IN', 'This employee has already clocked in for that shift.');
    if (existing?.clockOutAt)
      fail(409, 'ALREADY_CLOCKED_OUT', 'This employee has already completed that shift.');

    const lateMinutes = lateMinutesFor(
      localClock(now, policy.timeZone).minutes,
      match.roster.timing.startMinutes,
      0,
      policy.graceMinutes,
    );
    const status = lateMinutes > 0 ? 'LATE' : 'PRESENT';
    const values = {
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      employeeId,
      workDate: match.workDate,
      status,
      rosterEntryId: match.roster.rosterEntryId,
      shiftId: match.roster.shiftId,
      clockInAt: now,
      scheduledMinutes: match.roster.timing.scheduledMinutes,
      lateMinutes,
      recordedBy: scope.actorId,
      updatedAt: now,
    };
    const [row] = await tx
      .insert(schema.hrAttendance)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.hrAttendance.employeeId, schema.hrAttendance.workDate],
        set: {
          status,
          rosterEntryId: values.rosterEntryId,
          shiftId: values.shiftId,
          clockInAt: now,
          scheduledMinutes: values.scheduledMinutes,
          lateMinutes,
          recordedBy: scope.actorId,
          updatedAt: now,
        },
      })
      .returning();
    await audit(
      tx,
      scope,
      'hr_attendance',
      row.id,
      'CLOCK_IN',
      `${employee.firstName} ${employee.lastName} clocked in at ${now.toISOString()} for ${match.workDate}` +
        `${lateMinutes ? ` (${lateMinutes}m late)` : ''}`,
    );
    return {
      attendance: row,
      workDate: match.workDate,
      shiftName: match.roster.shiftName,
      lateMinutes,
      status,
    };
  });
}

export async function clockOut(scope: WorkforceScope, input: Record<string, unknown>) {
  const employeeId = positiveId(input.employeeId, 'employee');
  return db.transaction(async (tx) => {
    const employee = await employeeForClock(tx, scope, employeeId);
    const [open] = await tx
      .select()
      .from(schema.hrAttendance)
      .where(
        and(
          eq(schema.hrAttendance.employeeId, employeeId),
          eq(schema.hrAttendance.facilityId, scope.facilityId),
          isNotNull(schema.hrAttendance.clockInAt),
          isNull(schema.hrAttendance.clockOutAt),
        ),
      )
      .orderBy(desc(schema.hrAttendance.clockInAt))
      .limit(1);
    if (!open)
      fail(409, 'NOT_CLOCKED_IN', 'There is no open clock-in to close for this employee.');

    const now = new Date();
    const elapsed = Math.max(
      0,
      Math.round((now.getTime() - (open.clockInAt as Date).getTime()) / 60_000),
    );
    /* The break is already netted out of scheduledMinutes when the shift's
       expected hours are derived; subtracting it again from the elapsed time
       would report a one-minute shift as zero minutes worked. */
    const workedMinutes = elapsed;
    const scheduled = open.scheduledMinutes ?? null;
    const overtimeMinutes = scheduled === null ? 0 : Math.max(0, workedMinutes - scheduled);
    const status = open.status === 'LATE' ? 'LATE' : 'PRESENT';
    const [row] = await tx
      .update(schema.hrAttendance)
      .set({
        clockOutAt: now,
        workedMinutes,
        overtimeMinutes,
        status,
        recordedBy: scope.actorId,
        updatedAt: now,
      })
      .where(eq(schema.hrAttendance.id, open.id))
      .returning();
    await audit(
      tx,
      scope,
      'hr_attendance',
      row.id,
      'CLOCK_OUT',
      `${employee.firstName} ${employee.lastName} clocked out at ${now.toISOString()} after ${workedMinutes}m` +
        `${overtimeMinutes ? ` (${overtimeMinutes}m over the ${scheduled}m scheduled)` : ''}`,
    );
    return { attendance: row, workedMinutes, overtimeMinutes };
  });
}

/**
 * Authorised correction. Adds a missing record or rewrites clock instants, and
 * always stores who changed what, why, and the values before the change.
 */
export async function correctAttendance(scope: WorkforceScope, input: Record<string, unknown>) {
  const reason = requiredText(input.reason, 'Correction reason', 500);
  if (reason.trim().length < 5)
    fail(400, 'INVALID_INPUT', 'Explain the correction in at least five characters.');
  const attendanceId = optionalPositiveId(input.attendanceId, 'attendance record');
  const employeeId = optionalPositiveId(input.employeeId, 'employee');
  const workDate = input.workDate ? isoDate(input.workDate, 'Work date') : null;
  if (!attendanceId && (!employeeId || !workDate))
    fail(400, 'INVALID_ID', 'Provide the attendance record, or the employee and work date.');

  return db.transaction(async (tx) => {
    let existing = null as typeof schema.hrAttendance.$inferSelect | null;
    if (attendanceId) {
      [existing] = await tx
        .select()
        .from(schema.hrAttendance)
        .where(
          and(
            eq(schema.hrAttendance.id, attendanceId),
            eq(schema.hrAttendance.tenantId, scope.tenantId),
            eq(schema.hrAttendance.facilityId, scope.facilityId),
          ),
        )
        .limit(1);
      if (!existing)
        fail(404, 'ATTENDANCE_NOT_FOUND', 'Attendance record not found in this facility.');
    } else if (employeeId && workDate) {
      [existing] = await tx
        .select()
        .from(schema.hrAttendance)
        .where(
          and(
            eq(schema.hrAttendance.employeeId, employeeId),
            eq(schema.hrAttendance.workDate, workDate),
            eq(schema.hrAttendance.facilityId, scope.facilityId),
          ),
        )
        .limit(1);
    }

    const status = input.status ? enumValue(input.status, ATTENDANCE_STATUSES, 'Status') : null;
    const clockInAt = parseInstant(input.clockInAt, 'Clock-in');
    const clockOutAt = parseInstant(input.clockOutAt, 'Clock-out');

    const resolvedEmployeeId = existing?.employeeId ?? (employeeId as number);
    const resolvedDate = existing?.workDate ?? (workDate as string);
    const employee = await employeeForClock(tx, scope, resolvedEmployeeId);

    const nextIn = clockInAt ?? existing?.clockInAt ?? null;
    const nextOut = clockOutAt ?? existing?.clockOutAt ?? null;
    if (nextIn && nextOut && nextOut.getTime() < nextIn.getTime())
      fail(400, 'INVALID_TIME', 'Clock-out cannot be before clock-in.');

    const nextStatus =
      status ?? existing?.status ?? (nextIn ? 'PRESENT' : 'ABSENT');
    let workedMinutes = existing?.workedMinutes ?? null;
    let overtimeMinutes = existing?.overtimeMinutes ?? null;
    if (nextIn && nextOut) {
      const elapsed = Math.round((nextOut.getTime() - nextIn.getTime()) / 60_000);
      workedMinutes = Math.max(0, elapsed);
      const scheduled = existing?.scheduledMinutes ?? null;
      overtimeMinutes = scheduled === null ? 0 : Math.max(0, workedMinutes - scheduled);
    }

    let row;
    if (existing) {
      [row] = await tx
        .update(schema.hrAttendance)
        .set({
          status: nextStatus,
          clockInAt: nextIn,
          clockOutAt: nextOut,
          workedMinutes,
          overtimeMinutes,
          notes: input.notes === undefined ? existing.notes : optionalText(input.notes, 'Notes', 500),
          recordedBy: scope.actorId,
          correctedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.hrAttendance.id, existing.id))
        .returning();
    } else {
      [row] = await tx
        .insert(schema.hrAttendance)
        .values({
          tenantId: scope.tenantId,
          facilityId: scope.facilityId,
          employeeId: resolvedEmployeeId,
          workDate: resolvedDate,
          status: nextStatus,
          clockInAt: nextIn,
          clockOutAt: nextOut,
          workedMinutes,
          overtimeMinutes,
          notes: optionalText(input.notes, 'Notes', 500),
          recordedBy: scope.actorId,
          correctedAt: new Date(),
        })
        .returning();
    }

    await tx.insert(schema.hrAttendanceCorrections).values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      attendanceId: row.id,
      employeeId: resolvedEmployeeId,
      reason,
      previousStatus: existing?.status ?? null,
      newStatus: nextStatus,
      previousClockInAt: existing?.clockInAt ?? null,
      newClockInAt: nextIn,
      previousClockOutAt: existing?.clockOutAt ?? null,
      newClockOutAt: nextOut,
      correctedBy: scope.actorId,
      correctedByName: scope.actorName,
    });
    await audit(
      tx,
      scope,
      'hr_attendance',
      row.id,
      'CORRECT',
      `Corrected attendance for ${employee.firstName} ${employee.lastName} on ${resolvedDate}: ${reason}`,
    );
    return row;
  });
}

function parseInstant(value: unknown, label: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime()))
    fail(400, 'INVALID_TIME', `${label} must be a date and time.`);
  return parsed;
}

export async function attendanceHistory(scope: WorkforceScope, attendanceId: number) {
  return db
    .select()
    .from(schema.hrAttendanceCorrections)
    .where(
      and(
        eq(schema.hrAttendanceCorrections.attendanceId, attendanceId),
        eq(schema.hrAttendanceCorrections.tenantId, scope.tenantId),
        eq(schema.hrAttendanceCorrections.facilityId, scope.facilityId),
      ),
    )
    .orderBy(desc(schema.hrAttendanceCorrections.createdAt));
}

/**
 * HR recording an excused day (leave, holiday, off duty, training) or an
 * absence. Refuses to overwrite a clocked record: the correction endpoint is
 * the only path that may change what the clock recorded, and it demands a
 * reason.
 */
export async function recordAttendance(scope: WorkforceScope, input: Record<string, unknown>) {
  const employeeId = positiveId(input.employeeId, 'employee');
  const workDate = isoDate(input.workDate, 'Work date');
  const status = enumValue(input.status, ATTENDANCE_STATUSES, 'Attendance status');
  if (['PRESENT', 'LATE', 'INCOMPLETE'].includes(status))
    fail(
      400,
      'INVALID_STATUS',
      'Present, late and incomplete are produced by clock-in and clock-out, not recorded by hand.',
    );
  const notes = optionalText(input.notes, 'Notes', 500);
  return db.transaction(async (tx) => {
    const employee = await employeeForClock(tx, scope, employeeId);
    if (employee.employmentStatus === 'EXITED')
      fail(409, 'EMPLOYEE_EXITED', 'Attendance cannot be recorded for an employee who has left.');
    const [existing] = await tx
      .select()
      .from(schema.hrAttendance)
      .where(
        and(
          eq(schema.hrAttendance.employeeId, employeeId),
          eq(schema.hrAttendance.workDate, workDate),
          eq(schema.hrAttendance.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (existing?.clockInAt)
      fail(
        409,
        'ATTENDANCE_HAS_CLOCK',
        'This day has clock times. Use a correction with a reason to change it.',
      );
    const [row] = await tx
      .insert(schema.hrAttendance)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        employeeId,
        workDate,
        status,
        notes,
        recordedBy: scope.actorId,
      })
      .onConflictDoUpdate({
        target: [schema.hrAttendance.employeeId, schema.hrAttendance.workDate],
        set: { status, notes, recordedBy: scope.actorId, updatedAt: new Date() },
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
  /*
   * Approval audit trail. A rule row may only move between statuses, so the
   * sequence of decisions is read back from the audit log instead of a column
   * that could be overwritten.
   */
  const history = await db
    .select({
      resourceId: schema.auditLogs.resourceId,
      action: schema.auditLogs.action,
      details: schema.auditLogs.details,
      userId: schema.auditLogs.userId,
      createdAt: schema.auditLogs.timestamp,
    })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.tenantId, scope.tenantId),
        eq(schema.auditLogs.facilityId, scope.facilityId),
        eq(schema.auditLogs.resource, 'payroll_statutory_version'),
        inArray(
          schema.auditLogs.resourceId,
          versions.map((version) => String(version.id)),
        ),
      ),
    )
    .orderBy(asc(schema.auditLogs.timestamp));
  return versions.map((version) => ({
    ...version,
    statusHistory: history
      .filter((row) => row.resourceId === String(version.id))
      .map((row) => ({
        action: row.action,
        byUserId: row.userId,
        at: row.createdAt,
        details: row.details,
      })),
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
  /*
   * Provenance beyond the free-text citation. A facility that has to defend a
   * payslip needs the instrument's own title, where it was published and when,
   * not only a sentence written by whoever typed the rates.
   */
  const ruleName = optionalText(input.ruleName, 'Rule name', 200);
  const calculationMethod = optionalText(input.calculationMethod, 'Calculation method', 80);
  const currency = (
    typeof input.currency === 'string' && input.currency.trim()
      ? input.currency.trim().toUpperCase()
      : 'KES'
  ) as string;
  if (!/^[A-Z]{3}$/.test(currency))
    fail(400, 'INVALID_CURRENCY', 'Currency must be a three-letter ISO code.');
  const sourceTitle = optionalText(input.sourceTitle, 'Source title', 300);
  const sourceUrl = optionalText(input.sourceUrl, 'Source URL', 500);
  if (sourceUrl && !/^https?:\/\/[^\s]+$/i.test(sourceUrl))
    fail(400, 'INVALID_SOURCE_URL', 'A source URL must start with http:// or https://.');
  const sourcePublishedOn = optionalIsoDate(input.sourcePublishedOn, 'Source publication date');
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
        ruleName,
        calculationMethod,
        currency,
        effectiveFrom,
        effectiveTo,
        authority,
        sourceReference,
        sourceTitle,
        sourceUrl,
        sourcePublishedOn,
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
    /*
     * Only the status changes. The rule row's history — every earlier status,
     * who verified it and when — is append-only in `audit_logs`; the database
     * guard refuses any other column change, which is what keeps a version
     * used by an approved run from being quietly rewritten later.
     */
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
      status === 'ACTIVE'
        ? `${version.statute} ${version.label} approved and activated by ${scope.actorName ?? scope.actorId}`
        : `${version.statute} ${version.label} → ${status}`,
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
    taxableGrossCents: slip.taxableGrossCents.toString(),
    taxableCents: slip.taxableCents.toString(),
    payeCents: slip.payeCents.toString(),
    payeBeforeReliefCents: slip.payeBeforeReliefCents.toString(),
    personalReliefCents: slip.personalReliefCents.toString(),
    insuranceReliefCents: slip.insuranceReliefCents.toString(),
    qualifyingPensionCents: slip.qualifyingPensionCents.toString(),
    nssfEmployeeCents: slip.nssfEmployeeCents.toString(),
    nssfEmployerCents: slip.nssfEmployerCents.toString(),
    shifCents: slip.shifCents.toString(),
    ahlEmployeeCents: slip.ahlEmployeeCents.toString(),
    ahlEmployerCents: slip.ahlEmployerCents.toString(),
    statutoryDeductionsCents: slip.statutoryDeductionsCents.toString(),
    otherDeductionsCents: slip.otherDeductionsCents.toString(),
    netCents: slip.netCents.toString(),
    employerContributionsCents: slip.employerContributionsCents.toString(),
    employerCostCents: slip.employerCostCents.toString(),
    taxResidency: slip.taxResidency,
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

    /*
     * One live run per period. A reversed run is retained as history, so the
     * period may be recalculated into a new run while the reversed one keeps
     * its payslips, journal link and reversal evidence.
     */
    const [existingRun] = await tx
      .select()
      .from(schema.payrollRuns)
      .where(
        and(
          eq(schema.payrollRuns.periodId, period.id),
          sql`${schema.payrollRuns.status} <> 'REVERSED'`,
        ),
      )
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
        taxResidency: schema.hrEmployees.taxResidency,
        insurancePremiumMonthlyCents: schema.hrEmployees.insurancePremiumMonthlyCents,
        insuranceReliefEvidenceReference: schema.hrEmployees.insuranceReliefEvidenceReference,
        hireDate: schema.hrEmployees.hireDate,
        exitDate: schema.hrEmployees.exitDate,
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

    /*
     * A person who joins or leaves mid-period is paid for the calendar days
     * they were employed in it. The proration is computed here, recorded on the
     * payslip, and then treated as ordinary basic pay: every statutory charge
     * is calculated on the amount actually earned, not on a full month the
     * facility never owed.
     */
    const prorations = new Map(
      employees.map((employee) => [employee.id, prorationOf(employee, period)]),
    );

    // A payroll withheld through the calculator's own error is stored nowhere:
    // the run does not exist until every employee has been costed.
    const result = calculatePayroll({
      versions,
      payDate: period.payDate,
      employees: employees.map<PayrollEmployeeInput>((employee) => ({
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber,
        fullName: `${employee.firstName} ${employee.lastName}`,
        baseSalaryCents: prorations.get(employee.id)!.baseSalaryCents,
        taxResidency: employee.taxResidency as 'RESIDENT' | 'NON_RESIDENT',
        insurancePremiumCents: reliefPremium(employee),
        components: components
          .filter((component) => component.employeeId === employee.id)
          .map((component) => ({
            code: component.code,
            name: component.name,
            kind: component.kind as 'EARNING' | 'DEDUCTION',
            amountCents: component.amountCents,
            taxable: component.taxable,
            taxDeductible: component.taxDeductible,
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
            // JSONB cannot hold BigInt; the cents leave as decimal strings.
            proration: (() => {
              const applied = prorations.get(slip.employeeId);
              return applied
                ? {
                    ...applied,
                    baseSalaryCents: applied.baseSalaryCents.toString(),
                    fullBaseSalaryCents: applied.fullBaseSalaryCents.toString(),
                  }
                : null;
            })(),
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
        "The active verified rules no longer match this run's rule snapshot. Do not rewrite approved history: review the change, then recalculate the period against the rules now in force.",
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
  /*
   * When a statute has no usable rule, say which published entry would cover
   * the period. "Configuration missing" is a dead end; the administrator needs
   * to know whether the catalogue has the rule or whether it must be recorded
   * by hand.
   */
  const catalogueSuggestions = rules
    .filter((rule) => !rule.ready)
    .map((rule) => {
      const entry =
        rulebookEntryForDate(rule.statute, period.endDate) ??
        rulebookEntryForDate(rule.statute, period.payDate);
      return entry
        ? {
            statute: rule.statute,
            ruleKey: entry.key,
            label: entry.label,
            effectiveFrom: entry.effectiveFrom,
            effectiveTo: entry.effectiveTo,
            sourceTitle: entry.sourceTitle,
            sourceUrl: entry.sourceUrl,
            action: `Install ${entry.key} as a draft, verify it against the cited source, then activate it.`,
          }
        : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
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
    catalogueSuggestions,
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
type ProrationSource = {
  id: number;
  baseSalaryCents: bigint;
  hireDate: string;
  exitDate: string | null;
};

/** Inclusive calendar days between two ISO dates. */
function calendarDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Pay for the days employed inside the period.
 *
 * Only basic salary is prorated. Allowances and deductions are configured
 * amounts for the period and are applied as recorded; the payslip shows the
 * proration explicitly so the figure is explained rather than merely smaller.
 */
function prorationOf(
  employee: ProrationSource,
  period: { startDate: string; endDate: string },
): { baseSalaryCents: bigint; paidDays: number; totalDays: number; fullBaseSalaryCents: bigint } {
  const totalDays = calendarDays(period.startDate, period.endDate);
  const from = employee.hireDate > period.startDate ? employee.hireDate : period.startDate;
  const to =
    employee.exitDate && employee.exitDate < period.endDate ? employee.exitDate : period.endDate;
  const paidDays = Math.max(0, calendarDays(from, to));
  const baseSalaryCents =
    paidDays >= totalDays
      ? employee.baseSalaryCents
      : (employee.baseSalaryCents * BigInt(paidDays)) / BigInt(totalDays);
  return {
    baseSalaryCents,
    paidDays,
    totalDays,
    fullBaseSalaryCents: employee.baseSalaryCents,
  };
}

/**
 * Relief follows evidence, not a typed number.
 *
 * A premium recorded without a document reference cannot earn insurance
 * relief; the calculation stops instead of quietly granting or dropping it,
 * because either would misstate the payslip.
 */
function reliefPremium(employee: {
  insurancePremiumMonthlyCents: bigint;
  insuranceReliefEvidenceReference: string | null;
}): bigint {
  if (employee.insurancePremiumMonthlyCents > 0n && !employee.insuranceReliefEvidenceReference)
    fail(
      409,
      'INSURANCE_RELIEF_EVIDENCE_REQUIRED',
      'An insurance premium is recorded without evidence. Record the document reference or clear the premium before calculating.',
    );
  return employee.insurancePremiumMonthlyCents;
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

/* ============================================================
   PUBLISHED RULE CATALOGUE
   ============================================================ */

/**
 * The published Kenyan rules this application can install, with what the
 * facility already has. Nothing is installed until an administrator asks for
 * it, and an installed entry is still a DRAFT until a named user verifies the
 * source and a second decision activates it.
 */
export async function statutoryRulebook(scope: WorkforceScope, effectiveOn?: string) {
  const on = effectiveOn ?? new Date().toISOString().slice(0, 10);
  const installed = await loadStatutoryVersions(db, scope);
  const entries = STATUTORY_RULEBOOK.map((entry) => {
    /*
     * A catalogue entry is "installed" when this facility already holds a
     * version of that statute with the same label and effective start. Source
     * text is not compared: an administrator may have corrected a citation.
     */
    const match = installed.find(
      (version) =>
        version.statute === entry.statute &&
        version.effectiveFrom === entry.effectiveFrom &&
        version.label === entry.label,
    );
    return {
      key: entry.key,
      statute: entry.statute,
      label: entry.label,
      ruleName: entry.ruleName,
      effectiveFrom: entry.effectiveFrom,
      effectiveTo: entry.effectiveTo,
      authority: entry.authority,
      calculationMethod: entry.calculationMethod,
      currency: entry.currency,
      basis: entry.basis,
      sourceTitle: entry.sourceTitle,
      sourceUrl: entry.sourceUrl,
      sourcePublishedOn: entry.sourcePublishedOn,
      sourceReference: entry.sourceReference,
      citedPassage: entry.citedPassage,
      verificationNote: entry.verificationNote,
      notes: entry.notes,
      appliesOnSelectedDate:
        entry.effectiveFrom <= on && (entry.effectiveTo === null || entry.effectiveTo >= on),
      bands: entry.bands.map((band) => ({
        sequence: band.sequence,
        lowerBoundCents: band.lowerBoundCents.toString(),
        upperBoundCents: band.upperBoundCents === null ? null : band.upperBoundCents.toString(),
        employeeRateBp: band.employeeRateBp,
        employerRateBp: band.employerRateBp,
        employeeCapCents: band.employeeCapCents === null ? null : band.employeeCapCents.toString(),
        employerCapCents: band.employerCapCents === null ? null : band.employerCapCents.toString(),
      })),
      calculationConfig: entry.calculationConfig,
      installedVersionId: match?.id ?? null,
      installedStatus: match?.status ?? null,
    };
  });
  return {
    effectiveOn: on,
    entries,
    guidance: PAYROLL_SOURCE_GUIDANCE,
    notice:
      'Reference data transcribed from the cited publications. Installing copies an entry into this facility as a DRAFT; it becomes usable only after a named user verifies the source and activates it. The application does not certify legal compliance.',
  };
}

/**
 * Install the published rule that covers a date into this facility as a draft.
 *
 * Idempotent per (statute, effectiveFrom): a second call reports the existing
 * version instead of creating a duplicate. Nothing is activated here — that
 * stays a separate, auditable decision.
 */
export async function installStatutoryRulebook(
  scope: WorkforceScope,
  input: Record<string, unknown>,
) {
  const effectiveOn = input.effectiveOn
    ? isoDate(input.effectiveOn, 'Effective on')
    : new Date().toISOString().slice(0, 10);
  const requested =
    Array.isArray(input.statutes) && input.statutes.length
      ? input.statutes.map((value) => enumValue(value, STATUTES, 'Statute'))
      : [...RULEBOOK_STATUTES];

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended('payroll-statutory', ${scope.facilityId}))`,
    );
    const existing = await tx
      .select({
        id: schema.payrollStatutoryVersions.id,
        statute: schema.payrollStatutoryVersions.statute,
        effectiveFrom: schema.payrollStatutoryVersions.effectiveFrom,
        status: schema.payrollStatutoryVersions.status,
      })
      .from(schema.payrollStatutoryVersions)
      .where(
        and(
          eq(schema.payrollStatutoryVersions.tenantId, scope.tenantId),
          eq(schema.payrollStatutoryVersions.facilityId, scope.facilityId),
        ),
      );

    const installed: Array<{ key: string; statute: string; versionId: number }> = [];
    const skipped: Array<{ statute: string; reason: string; versionId?: number }> = [];
    for (const statute of requested) {
      const entry = rulebookEntryForDate(statute, effectiveOn);
      if (!entry) {
        skipped.push({
          statute,
          reason: `No published ${statute} rule in the catalogue covers ${effectiveOn}. Record the authority's version manually.`,
        });
        continue;
      }
      const match = existing.find(
        (row) => row.statute === statute && row.effectiveFrom === entry.effectiveFrom,
      );
      if (match) {
        skipped.push({
          statute,
          reason: `${entry.key} is already recorded (${match.status}).`,
          versionId: match.id,
        });
        continue;
      }
      const [version] = await tx
        .insert(schema.payrollStatutoryVersions)
        .values({
          tenantId: scope.tenantId,
          facilityId: scope.facilityId,
          statute: entry.statute,
          label: entry.label,
          ruleName: entry.ruleName,
          calculationMethod: entry.calculationMethod,
          currency: entry.currency,
          effectiveFrom: entry.effectiveFrom,
          effectiveTo: entry.effectiveTo,
          authority: entry.authority,
          sourceReference: entry.sourceReference,
          sourceTitle: entry.sourceTitle,
          sourceUrl: entry.sourceUrl,
          sourcePublishedOn: entry.sourcePublishedOn,
          basis: entry.basis,
          calculationConfig: entry.calculationConfig,
          status: 'DRAFT',
          notes: [entry.citedPassage, ...entry.notes].join('\n'),
          createdBy: scope.actorId,
        })
        .returning();
      await tx.insert(schema.payrollStatutoryBands).values(
        entry.bands.map((band) => ({
          versionId: version.id,
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
      );
      await audit(
        tx,
        scope,
        'payroll_statutory_version',
        version.id,
        'INSTALL',
        `Installed ${entry.key} from ${entry.sourceTitle}; status DRAFT pending verification.`,
      );
      installed.push({ key: entry.key, statute, versionId: version.id });
    }
    return {
      effectiveOn,
      installed,
      skipped,
      nextActions: installed.length
        ? [
            'Verify each draft against the cited source with a named verifier, then activate it. A run cannot use an unverified or inactive version.',
          ]
        : [],
    };
  });
}

/* ============================================================
   CALCULATION PREVIEW
   ============================================================ */

/**
 * Cost one employee for a period without creating a run.
 *
 * Either an existing employee, or synthetic values an authorised user types to
 * test a rule before activating it. The response carries the same trace a
 * payslip stores, so a preview can be reconciled against the run that follows.
 */
export async function previewPayroll(scope: WorkforceScope, input: Record<string, unknown>) {
  const payDate = input.payDate
    ? isoDate(input.payDate, 'Pay date')
    : new Date().toISOString().slice(0, 10);
  const componentInput = Array.isArray(input.components) ? input.components : [];
  if (!input.employeeId && (input.grossKes === undefined || input.grossKes === '')) {
    fail(
      400,
      'PREVIEW_INPUT_REQUIRED',
      'Select an employee or enter a synthetic gross salary to preview.',
    );
  }

  return db.transaction(async (tx) => {
    let employee: PayrollEmployeeInput;
    if (input.employeeId) {
      const employeeId = positiveId(input.employeeId, 'Employee');
      const [row] = await tx
        .select()
        .from(schema.hrEmployees)
        .where(
          and(
            eq(schema.hrEmployees.id, employeeId),
            eq(schema.hrEmployees.tenantId, scope.tenantId),
            eq(schema.hrEmployees.facilityId, scope.facilityId),
          ),
        )
        .limit(1);
      if (!row) fail(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found in this facility.');
      const components = await tx
        .select()
        .from(schema.payrollEmployeeComponents)
        .where(
          and(
            eq(schema.payrollEmployeeComponents.employeeId, employeeId),
            eq(schema.payrollEmployeeComponents.isActive, true),
            lte(schema.payrollEmployeeComponents.effectiveFrom, payDate),
            or(
              sql`${schema.payrollEmployeeComponents.effectiveTo} IS NULL`,
              gte(schema.payrollEmployeeComponents.effectiveTo, payDate),
            )!,
          ),
        );
      employee = {
        employeeId: row.id,
        employeeNumber: row.employeeNumber,
        fullName: `${row.firstName} ${row.lastName}`,
        baseSalaryCents: row.baseSalaryCents,
        taxResidency: row.taxResidency as 'RESIDENT' | 'NON_RESIDENT',
        insurancePremiumCents: reliefPremium(row),
        components: components.map((component) => ({
          code: component.code,
          name: component.name,
          kind: component.kind as 'EARNING' | 'DEDUCTION',
          amountCents: component.amountCents,
          taxable: component.taxable,
          taxDeductible: component.taxDeductible,
          statutoryExclusions: component.statutoryExclusions,
        })),
      };
    } else {
      const grossCents = centsFromKesInput(input.grossKes, 'Gross salary');
      const residency =
        input.taxResidency === undefined || input.taxResidency === ''
          ? 'RESIDENT'
          : enumValue(input.taxResidency, ['RESIDENT', 'NON_RESIDENT'] as const, 'Tax residency');
      const premium =
        input.insurancePremiumKes === undefined || input.insurancePremiumKes === ''
          ? 0n
          : centsFromKesInput(input.insurancePremiumKes, 'Declared insurance premium');
      employee = {
        employeeId: 0,
        employeeNumber: 'PREVIEW',
        fullName: 'Synthetic preview',
        baseSalaryCents: grossCents,
        taxResidency: residency,
        insurancePremiumCents: premium,
        components: componentInput.map((raw) => {
          const component = raw as Record<string, unknown>;
          return {
            code: requiredText(component.code, 'Component code', 24).toUpperCase(),
            name: requiredText(component.name, 'Component name', 80),
            kind: enumValue(
              component.kind ?? 'DEDUCTION',
              ['EARNING', 'DEDUCTION'] as const,
              'Component kind',
            ),
            amountCents: centsFromKesInput(component.amountKes, 'Component amount'),
            taxable: component.taxable === undefined ? true : component.taxable === true,
            taxDeductible: component.taxDeductible === true,
            statutoryExclusions: Array.isArray(component.statutoryExclusions)
              ? (component.statutoryExclusions as string[])
              : [],
          };
        }),
      };
    }

    const versions = await loadStatutoryVersions(tx, scope);
    let resolved: Record<string, StatutoryVersion>;
    try {
      resolved = resolveStatutoryVersions(versions, payDate) as Record<string, StatutoryVersion>;
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'STATUTORY_VERSION_REQUIRED';
      fail(
        (err as { status?: number }).status ?? 409,
        code,
        (err as Error).message +
          ' Install or record the rule that covers this pay date before previewing.',
      );
    }
    const slip = calculatePayslip({ employee, versions: resolved, payDate });
    const ruleVersions = Object.values(resolved).map((version) => ({
      statute: version.statute,
      versionId: version.id,
      label: version.label,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo,
      authority: version.authority,
      sourceReference: version.sourceReference,
      status: version.status,
    }));
    return {
      payDate,
      employee: {
        id: employee.employeeId,
        employeeNumber: employee.employeeNumber,
        fullName: employee.fullName,
        taxResidency: slip.taxResidency,
      },
      slip: {
        ...slip,
        grossCents: slip.grossCents.toString(),
        taxableGrossCents: slip.taxableGrossCents.toString(),
        taxableCents: slip.taxableCents.toString(),
        payeCents: slip.payeCents.toString(),
        payeBeforeReliefCents: slip.payeBeforeReliefCents.toString(),
        personalReliefCents: slip.personalReliefCents.toString(),
        insuranceReliefCents: slip.insuranceReliefCents.toString(),
        qualifyingPensionCents: slip.qualifyingPensionCents.toString(),
        nssfEmployeeCents: slip.nssfEmployeeCents.toString(),
        nssfEmployerCents: slip.nssfEmployerCents.toString(),
        shifCents: slip.shifCents.toString(),
        ahlEmployeeCents: slip.ahlEmployeeCents.toString(),
        ahlEmployerCents: slip.ahlEmployerCents.toString(),
        statutoryDeductionsCents: slip.statutoryDeductionsCents.toString(),
        otherDeductionsCents: slip.otherDeductionsCents.toString(),
        netCents: slip.netCents.toString(),
        employerContributionsCents: slip.employerContributionsCents.toString(),
        employerCostCents: slip.employerCostCents.toString(),
        lines: slip.lines.map((line) => ({
          code: line.code,
          name: line.name,
          kind: line.kind,
          amountCents: line.amountCents.toString(),
        })),
        statutes: slip.statutes,
      },
      ruleVersions,
      notice:
        'Preview only. Nothing is written to the ledger and no payslip is stored. A run uses the rules ACTIVE on its own pay date, which may differ from these if a version is retired in between.',
    };
  });
}

/** KES entered by a user → integer cents, refusing fractions of a cent. */
function centsFromKesInput(value: unknown, label: string): bigint {
  if (value === undefined || value === null || value === '')
    fail(400, 'INVALID_AMOUNT', `${label} is required.`);
  const text = String(value).trim().replace(/,/g, '');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text))
    fail(400, 'INVALID_AMOUNT', `${label} must be an amount in KES with at most two decimals.`);
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

/* ============================================================
   PAYROLL REVERSAL
   ============================================================ */

/**
 * Reverse a posted run with a contra journal.
 *
 * The original journal, payslips and snapshot stay exactly as they were: a
 * posted payroll is an accounting fact, and correction is a second fact that
 * points at the first. Deleting either would destroy the audit trail the
 * statutory extracts depend on.
 */
export async function reversePayrollRun(
  scope: WorkforceScope,
  runId: number,
  input: Record<string, unknown>,
) {
  const reason = requiredText(input.reason, 'Reversal reason', 500);
  return ledgerTransaction(async (client) => {
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
        journalEntryId: schema.payrollRuns.journalEntryId,
        reversalJournalEntryId: schema.payrollRuns.reversalJournalEntryId,
        periodId: schema.payrollRuns.periodId,
      })
      .from(schema.payrollRuns)
      .where(
        and(
          eq(schema.payrollRuns.id, runId),
          eq(schema.payrollRuns.tenantId, scope.tenantId),
          eq(schema.payrollRuns.facilityId, scope.facilityId),
        ),
      )
      .limit(1);
    if (!run) fail(404, 'RUN_NOT_FOUND', 'Payroll run not found in this facility.');
    // A run is reversed at most once. Report the existing contra rather than
    // calling the run "not posted", which would hide what already happened.
    if (run.reversalJournalEntryId)
      fail(409, 'RUN_ALREADY_REVERSED', 'This run has already been reversed.');
    if (run.status !== 'POSTED' || !run.journalEntryId)
      fail(409, 'RUN_NOT_POSTED', 'Only a posted payroll run can be reversed.');

    const original = await client.query(
      'SELECT id, journal_number, total_debit_cents FROM journal_entries WHERE id=$1 FOR UPDATE',
      [run.journalEntryId],
    );
    if (!original.rows.length)
      fail(
        409,
        'JOURNAL_MISSING',
        'The posted journal could not be found; do not amend history silently.',
      );

    /*
     * Mirror the original lines with debit and credit swapped. The accounting
     * layer refuses to derive them silently, so the reversal states its own
     * amounts and the balance check below proves they mirror the original.
     */
    const originalLines = await client.query(
      `SELECT account_id, description, service_line, debit_cents, credit_cents
         FROM journal_lines WHERE journal_entry_id=$1 ORDER BY id`,
      [run.journalEntryId],
    );
    const reversalLines: JournalLine[] = originalLines.rows.map((line) => ({
      accountId: Number(line.account_id),
      debitCents: BigInt(line.credit_cents),
      creditCents: BigInt(line.debit_cents),
      description: `Reversal — ${line.description ?? 'payroll'}`.slice(0, 200),
      serviceLine: line.service_line ?? null,
    }));
    const reversalTotal = reversalLines.reduce((sum, line) => sum + line.debitCents, 0n);
    if (reversalTotal !== BigInt(original.rows[0].total_debit_cents))
      fail(
        409,
        'REVERSAL_TOTAL_MISMATCH',
        'The original journal lines do not add up to its recorded total. Do not reverse silently; investigate the journal.',
      );

    const reversal = await postInsideTransaction(
      client,
      { tenantId: scope.tenantId, facilityId: scope.facilityId, actorUserId: scope.actorId },
      {
        entryDate: new Date().toISOString().slice(0, 10),
        description: `Reversal of payroll run ${runId} — ${reason}`.slice(0, 500),
        idempotencyKey: `payroll-run-reversal:${runId}`,
        /*
         * A reversal is its own source. Reusing the run's PAYROLL source id
         * would collide with the journal it reverses: the ledger allows one
         * journal per (facility, source type, source id), which is precisely
         * what stops a run being posted twice.
         */
        sourceType: 'REVERSAL',
        sourceId: String(run.journalEntryId),
        reversalOf: Number(run.journalEntryId),
        reversalReason: reason,
        lines: reversalLines,
        totalCents: reversalTotal,
      },
    );

    await client.query(
      `UPDATE payroll_runs
         SET status='REVERSED', reversed_by=$1, reversed_at=now(),
             reversal_journal_entry_id=$2, reversal_reason=$3
       WHERE id=$4`,
      [scope.actorId, Number(reversal.journal.id), reason, runId],
    );
    await client.query(
      `INSERT INTO audit_logs(tenant_id,facility_id,user_id,resource,resource_id,action,details)
       VALUES($1,$2,$3,'payroll_run',$4,'REVERSE',$5)`,
      [
        scope.tenantId,
        scope.facilityId,
        String(scope.actorId),
        String(runId),
        `Reversed with journal ${reversal.journal.journalNumber}: ${reason}`,
      ],
    );
    return {
      runId,
      status: 'REVERSED',
      reversalJournalEntryId: Number(reversal.journal.id),
      reversalJournalNumber: reversal.journal.journalNumber,
      reason,
      notice:
        'The original journal and payslips are unchanged. The reversal is a separate posted journal; recalculate the period to run payroll again.',
    };
  });
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
