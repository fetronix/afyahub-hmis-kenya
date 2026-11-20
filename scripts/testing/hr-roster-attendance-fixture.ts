/**
 * Syrona Medical Center HMIS — duty roster / attendance synthetic fixture.
 *
 * Prepares the synthetic facility built by
 * `hr-department-designation-fixture.ts` for roster and attendance testing:
 *
 *  - the three shifts the acceptance run uses (Day, Evening, overnight Night);
 *  - an annual leave type;
 *  - a second login (`synthetic.staff`) that is an ordinary employee: it is
 *    linked to SYNTH-HR-0002 and holds `hr.read` only, so the run can prove an
 *    employee cannot clock a colleague's attendance.
 *
 * SAFETY
 * ------
 * - Refuses to run with NODE_ENV=production.
 * - Refuses without SYNTHETIC_HR_CONFIRM=yes.
 * - Only writes inside the tenant whose slug is SLUG, and only to the
 *   synthetic facility.
 * - Idempotent: re-running repairs the same rows instead of duplicating them.
 * - Reads both passwords from the environment and never prints them.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { db, pool } from '../../src/db/index.ts';
import * as schema from '../../src/db/schema.ts';
import { hashPassword } from '../../src/utils/password.ts';

const SLUG = 'syrona-hr-synthetic';
const FACILITY_CODE = 'SYNTH-HR-01';
const HR_USERNAME = 'synthetic.hr';
const STAFF_USERNAME = 'synthetic.staff';
const STAFF_EMPLOYEE_NUMBER = 'SYNTH-HR-0002';

const SHIFTS = [
  { name: 'Day Shift', description: 'Standard ward and outpatient day shift.', startTime: '07:00', endTime: '18:00', breakMinutes: 60 },
  { name: 'Evening Shift', description: 'Afternoon cover through the evening.', startTime: '14:00', endTime: '22:00', breakMinutes: 30 },
  { name: 'Night Shift', description: 'Overnight cover; ends on the following day.', startTime: '19:00', endTime: '07:00', breakMinutes: 45 },
] as const;

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('The synthetic roster fixture refuses to run with NODE_ENV=production.');
  if (process.env.SYNTHETIC_HR_CONFIRM !== 'yes')
    throw new Error('Set SYNTHETIC_HR_CONFIRM=yes to confirm this is a synthetic database.');
  const password = process.env.SYNTH_HR_PASSWORD;
  if (!password || password.length < 12)
    throw new Error('SYNTH_HR_PASSWORD must contain at least 12 characters.');
  const staffPassword = process.env.SYNTH_STAFF_PASSWORD ?? password;

  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, SLUG)).limit(1);
  if (!tenant)
    throw new Error(
      'Run scripts/testing/hr-department-designation-fixture.ts first: the synthetic tenant is missing.',
    );
  const [facility] = await db
    .select()
    .from(schema.facilities)
    .where(
      and(eq(schema.facilities.tenantId, tenant.id), eq(schema.facilities.code, FACILITY_CODE)),
    )
    .limit(1);
  if (!facility) throw new Error('The synthetic facility SYNTH-HR-01 is missing.');

  const permissions = await db.select().from(schema.permissions);
  const byCode = new Map(permissions.map((permission) => [permission.code, permission]));

  async function grantRole(name: string, codes: string[], description: string) {
    let [role] = await db
      .select()
      .from(schema.roles)
      .where(and(eq(schema.roles.name, name), eq(schema.roles.tenantId, tenant.id)))
      .limit(1);
    if (!role) {
      [role] = await db
        .insert(schema.roles)
        .values({ tenantId: tenant.id, name, description, isSystem: false, isActive: true })
        .returning();
    }
    for (const code of codes) {
      const permission = byCode.get(code);
      if (!permission) throw new Error(`Permission ${code} is not seeded. Run db:seed:permissions.`);
      const [existing] = await db
        .select()
        .from(schema.rolePermissions)
        .where(
          and(
            eq(schema.rolePermissions.roleId, role.id),
            eq(schema.rolePermissions.permissionId, permission.id),
          ),
        )
        .limit(1);
      if (!existing)
        await db
          .insert(schema.rolePermissions)
          .values({ roleId: role.id, permissionId: permission.id });
    }
    return role;
  }

  /* The HR officer may also decide leave, so the run can create an approved absence. */
  const hrRole = await grantRole(
    'HR_OFFICER',
    ['hr.read', 'hr.manage', 'hr.approve', 'payroll.read'],
    'Synthetic HR officer — records staff, departments and designations',
  );
  const staffRole = await grantRole(
    'STAFF',
    ['hr.read'],
    'Synthetic ordinary employee — may view HR but not manage it',
  );

  const passwordHash = await hashPassword(password);
  const staffHash = await hashPassword(staffPassword);

  /* ---- HR officer keeps its existing role assignment ---- */
  const [hrUserRow] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, HR_USERNAME))
    .limit(1);
  if (hrUserRow) {
    await db
      .update(schema.users)
      .set({ passwordHash, accountStatus: 'ACTIVE', isActive: true, updatedAt: new Date() })
      .where(eq(schema.users.id, hrUserRow.id));
    const [assignment] = await db
      .select()
      .from(schema.userRoles)
      .where(
        and(
          eq(schema.userRoles.userId, hrUserRow.id),
          eq(schema.userRoles.roleId, hrRole.id),
        ),
      )
      .limit(1);
    if (!assignment)
      await db
        .insert(schema.userRoles)
        .values({ userId: hrUserRow.id, roleId: hrRole.id, assignedBy: 'roster-fixture' });
  }

  /* ---- ordinary employee login ---- */
  let [staffUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, STAFF_USERNAME))
    .limit(1);
  if (!staffUser) {
    [staffUser] = await db
      .insert(schema.users)
      .values({
        uid: `usr_${randomUUID()}`,
        tenantId: tenant.id,
        facilityId: facility.id,
        username: STAFF_USERNAME,
        email: 'synthetic.staff@example.test',
        fullName: 'Synthetic Pharmacist',
        passwordHash: staffHash,
        accountStatus: 'ACTIVE',
        mustChangePassword: false,
        isActive: true,
      })
      .returning();
  } else {
    await db
      .update(schema.users)
      .set({ passwordHash: staffHash, accountStatus: 'ACTIVE', isActive: true, updatedAt: new Date() })
      .where(eq(schema.users.id, staffUser.id));
  }
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, staffUser.id));
  await db
    .insert(schema.userRoles)
    .values({ userId: staffUser.id, roleId: staffRole.id, assignedBy: 'roster-fixture' });

  const [staffEmployee] = await db
    .select()
    .from(schema.hrEmployees)
    .where(
      and(
        eq(schema.hrEmployees.tenantId, tenant.id),
        eq(schema.hrEmployees.facilityId, facility.id),
        eq(schema.hrEmployees.employeeNumber, STAFF_EMPLOYEE_NUMBER),
      ),
    )
    .limit(1);
  if (!staffEmployee)
    throw new Error(`${STAFF_EMPLOYEE_NUMBER} is missing. Run the department fixture first.`);
  await db
    .update(schema.hrEmployees)
    .set({ userId: staffUser.id, email: staffUser.email, updatedAt: new Date() })
    .where(eq(schema.hrEmployees.id, staffEmployee.id));

  /* ---- shifts ---- */
  const shiftIds: Record<string, number> = {};
  for (const shift of SHIFTS) {
    const [existing] = await db
      .select()
      .from(schema.hrShifts)
      .where(
        and(
          eq(schema.hrShifts.tenantId, tenant.id),
          eq(schema.hrShifts.facilityId, facility.id),
          eq(schema.hrShifts.name, shift.name),
        ),
      )
      .limit(1);
    const row =
      existing ??
      (
        await db
          .insert(schema.hrShifts)
          .values({
            tenantId: tenant.id,
            facilityId: facility.id,
            name: shift.name,
            description: shift.description,
            startTime: shift.startTime,
            endTime: shift.endTime,
            breakMinutes: shift.breakMinutes,
          })
          .returning()
      )[0];
    shiftIds[shift.name] = row.id;
  }

  /* ---- leave type ---- */
  let [leaveType] = await db
    .select()
    .from(schema.hrLeaveTypes)
    .where(
      and(
        eq(schema.hrLeaveTypes.tenantId, tenant.id),
        eq(schema.hrLeaveTypes.facilityId, facility.id),
        eq(schema.hrLeaveTypes.code, 'ANNUAL'),
      ),
    )
    .limit(1);
  if (!leaveType) {
    [leaveType] = await db
      .insert(schema.hrLeaveTypes)
      .values({
        tenantId: tenant.id,
        facilityId: facility.id,
        code: 'ANNUAL',
        name: 'Annual leave',
        annualEntitlementDays: '21.00',
        paid: true,
        requiresApproval: true,
        createdBy: hrUserRow?.id ?? null,
      })
      .returning();
  }

  console.log(
    JSON.stringify(
      {
        tenant: tenant.slug,
        facility: facility.code,
        shifts: shiftIds,
        leaveTypeId: leaveType.id,
        accounts: { hr: HR_USERNAME, staff: STAFF_USERNAME },
        staffEmployee: STAFF_EMPLOYEE_NUMBER,
        note: 'Passwords were read from the environment and are not printed.',
      },
      null,
      2,
    ),
  );
  await pool.end();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
