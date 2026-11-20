/**
 * Syrona Medical Center HMIS — HR department/designation synthetic fixture.
 *
 * Creates one clearly-labelled synthetic tenant, one facility, an HR officer
 * account and the five departments and six designations the acceptance run
 * exercises. It exists so the department/designation evidence never touches
 * real staff data.
 *
 * SAFETY
 * ------
 * - Refuses to run with NODE_ENV=production.
 * - Refuses without SYNTHETIC_HR_CONFIRM=yes.
 * - Only ever writes to the tenant whose slug is SLUG.
 * - Idempotent: re-running repairs the same rows rather than adding duplicates.
 * - Reads the password from the environment and never prints it.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { db, pool } from '../../src/db/index.ts';
import * as schema from '../../src/db/schema.ts';
import { hashPassword } from '../../src/utils/password.ts';

const SLUG = 'syrona-hr-synthetic';
const TENANT_NAME = 'Syrona Medical Center HR Synthetic Tenant';
const FACILITY_CODE = 'SYNTH-HR-01';
const USERNAME = 'synthetic.hr';

const DEPARTMENTS = [
  { code: 'NUR', name: 'Nursing', description: 'Ward, theatre and outpatient nursing staff.' },
  { code: 'FIN', name: 'Finance', description: 'Accounts, billing and payroll administration.' },
  { code: 'LAB', name: 'Laboratory', description: 'Diagnostics, specimen handling and results.' },
  { code: 'PHR', name: 'Pharmacy', description: 'Dispensing, stock control and medication review.' },
  { code: 'ADM', name: 'Administration', description: 'Records, human resources and facility management.' },
] as const;

const DESIGNATIONS = [
  { title: 'Nurse', department: 'NUR', grade: 'JG-6', description: 'Registered nurse delivering direct patient care.' },
  { title: 'Nursing Officer', department: 'NUR', grade: 'JG-8', description: 'Leads a nursing shift and supervises the ward team.' },
  { title: 'Accountant', department: 'FIN', grade: 'JG-7', description: 'Prepares and reconciles the facility accounts.' },
  { title: 'Laboratory Technician', department: 'LAB', grade: 'JG-6', description: 'Runs specimen tests and records results.' },
  { title: 'Pharmacist', department: 'PHR', grade: 'JG-7', description: 'Dispenses medicines and reviews prescriptions.' },
  { title: 'HR Officer', department: 'ADM', grade: 'JG-6', description: 'Maintains staff records, leave and designations.' },
] as const;

/* Two employees prove that existing records survive, and give the
   "designation in use" rule something real to refuse. */
const EMPLOYEES = [
  { number: 'SYNTH-HR-0001', first: 'Synthetic', last: 'Nurse', designation: 'Nurse', department: 'NUR' },
  { number: 'SYNTH-HR-0002', first: 'Synthetic', last: 'Accountant', designation: 'Accountant', department: 'FIN' },
] as const;

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('The synthetic HR fixture refuses to run with NODE_ENV=production.');
  if (process.env.SYNTHETIC_HR_CONFIRM !== 'yes')
    throw new Error('Set SYNTHETIC_HR_CONFIRM=yes to confirm this is a synthetic database.');
  const password = process.env.SYNTH_HR_PASSWORD;
  if (!password || password.length < 12)
    throw new Error('SYNTH_HR_PASSWORD must contain at least 12 characters.');

  let [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, SLUG)).limit(1);
  if (!tenant) {
    [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: TENANT_NAME,
        slug: SLUG,
        domain: 'synthetic.example.test',
        contactEmail: 'synthetic.hr@example.test',
      })
      .returning();
  } else if (tenant.name !== TENANT_NAME) {
    throw new Error('A non-synthetic tenant already uses this slug. Refusing to modify it.');
  }
  const tenantId = tenant.id;

  let [facility] = await db
    .select()
    .from(schema.facilities)
    .where(and(eq(schema.facilities.tenantId, tenantId), eq(schema.facilities.code, FACILITY_CODE)))
    .limit(1);
  if (!facility) {
    [facility] = await db
      .insert(schema.facilities)
      .values({
        tenantId,
        code: FACILITY_CODE,
        name: 'Syrona Medical Center — Synthetic HR Facility',
        enabledModules: ['hr', 'payroll'],
      })
      .returning();
  }
  const facilityId = facility.id;

  /* ---- account and role ---- */
  const permissionRows = await db.select().from(schema.permissions);
  const byCode = new Map(permissionRows.map((row) => [row.code, row]));

  let [role] = await db
    .select()
    .from(schema.roles)
    .where(and(eq(schema.roles.name, 'HR_OFFICER'), eq(schema.roles.tenantId, tenantId)))
    .limit(1);
  if (!role) {
    [role] = await db
      .insert(schema.roles)
      .values({
        tenantId,
        name: 'HR_OFFICER',
        description: 'Synthetic HR officer — records staff, departments and designations',
        isSystem: false,
        isActive: true,
      })
      .returning();
  }
  for (const code of ['hr.read', 'hr.manage', 'payroll.read']) {
    const permission = byCode.get(code);
    if (!permission) throw new Error(`Permission ${code} is not seeded. Run db:seed:permissions.`);
    const [grant] = await db
      .select()
      .from(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.roleId, role.id),
          eq(schema.rolePermissions.permissionId, permission.id),
        ),
      )
      .limit(1);
    if (!grant)
      await db
        .insert(schema.rolePermissions)
        .values({ roleId: role.id, permissionId: permission.id });
  }

  const passwordHash = await hashPassword(password);
  let [user] = await db.select().from(schema.users).where(eq(schema.users.username, USERNAME)).limit(1);
  if (user) {
    if (user.tenantId !== tenantId)
      throw new Error(`${USERNAME} belongs to another tenant. Refusing to modify it.`);
    await db
      .update(schema.users)
      .set({ passwordHash, accountStatus: 'ACTIVE', isActive: true, mustChangePassword: false, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));
  } else {
    [user] = await db
      .insert(schema.users)
      .values({
        uid: `usr_${randomUUID()}`,
        tenantId,
        facilityId,
        username: USERNAME,
        email: 'synthetic.hr@example.test',
        fullName: 'Synthetic HR Officer',
        phone: '+254700000000',
        designation: 'HR Officer',
        passwordHash,
        accountStatus: 'ACTIVE',
        mustChangePassword: false,
        isActive: true,
      })
      .returning();
  }
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, user.id));
  await db
    .insert(schema.userRoles)
    .values({ userId: user.id, roleId: role.id, assignedBy: 'hr-department-designation-fixture' });

  /* ---- departments ---- */
  const departmentIds = new Map<string, number>();
  for (const department of DEPARTMENTS) {
    const [existing] = await db
      .select()
      .from(schema.hrDepartments)
      .where(
        and(
          eq(schema.hrDepartments.tenantId, tenantId),
          eq(schema.hrDepartments.facilityId, facilityId),
          eq(schema.hrDepartments.code, department.code),
        ),
      )
      .limit(1);
    const row =
      existing ??
      (
        await db
          .insert(schema.hrDepartments)
          .values({
            tenantId,
            facilityId,
            code: department.code,
            name: department.name,
            description: department.description,
            createdBy: user.id,
          })
          .returning()
      )[0];
    departmentIds.set(department.code, row.id);
  }

  /* ---- designations ---- */
  const designationIds = new Map<string, number>();
  for (const designation of DESIGNATIONS) {
    const departmentId = departmentIds.get(designation.department);
    if (!departmentId) throw new Error(`Department ${designation.department} was not created.`);
    const [existing] = await db
      .select()
      .from(schema.hrDesignations)
      .where(
        and(
          eq(schema.hrDesignations.tenantId, tenantId),
          eq(schema.hrDesignations.facilityId, facilityId),
          eq(schema.hrDesignations.title, designation.title),
        ),
      )
      .limit(1);
    const row =
      existing ??
      (
        await db
          .insert(schema.hrDesignations)
          .values({
            tenantId,
            facilityId,
            departmentId,
            title: designation.title,
            description: designation.description,
            grade: designation.grade,
            createdBy: user.id,
          })
          .returning()
      )[0];
    designationIds.set(designation.title, row.id);
  }

  /* ---- employees ---- */
  for (const employee of EMPLOYEES) {
    const designationId = designationIds.get(employee.designation);
    const departmentId = departmentIds.get(employee.department);
    if (!designationId || !departmentId) throw new Error('Employee fixture is inconsistent.');
    const [existing] = await db
      .select()
      .from(schema.hrEmployees)
      .where(
        and(
          eq(schema.hrEmployees.tenantId, tenantId),
          eq(schema.hrEmployees.facilityId, facilityId),
          eq(schema.hrEmployees.employeeNumber, employee.number),
        ),
      )
      .limit(1);
    if (!existing)
      await db.insert(schema.hrEmployees).values({
        tenantId,
        facilityId,
        employeeNumber: employee.number,
        firstName: employee.first,
        lastName: employee.last,
        departmentId,
        designationId,
        hireDate: '2026-01-05',
        employmentStatus: 'ACTIVE',
        employmentType: 'PERMANENT',
        createdBy: user.id,
      });
  }

  console.log(
    JSON.stringify(
      {
        tenantId,
        facilityId,
        departments: [...departmentIds.keys()],
        designations: [...designationIds.keys()],
        employees: EMPLOYEES.map((employee) => employee.number),
        account: USERNAME,
        note: 'The password was read from the environment and is not printed.',
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} finally {
  await pool.end();
}
