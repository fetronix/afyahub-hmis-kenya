/**
 * JaliCare HMIS — synthetic workforce fixture (development only).
 *
 * Creates a clearly-labelled synthetic tenant, one facility, a chain of
 * command (finance/HR) accounts and the permission grants needed to exercise
 * Phase 5 in a browser. It exists so acceptance evidence never touches real
 * patient or staff data.
 *
 * SAFETY
 * ------
 * - Refuses to run when NODE_ENV is production.
 * - Refuses without SYNTHETIC_FIXTURE_CONFIRM=yes.
 * - Refuses if the target tenant slug already exists with a different
 *   identity: it never resets or reuses an existing database.
 * - Reads passwords from environment variables and never prints them.
 * - Idempotent for the synthetic tenant only: re-running updates the
 *   synthetic users' password hash and permission grants, nothing else.
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { db, pool } from '../src/db/index.ts';
import * as schema from '../src/db/schema.ts';
import { hashPassword } from '../src/utils/password.ts';

const SLUG = 'jalicare-synthetic-training';
const TENANT_NAME = 'JaliCare Synthetic Training Tenant';
const FACILITY_CODE = 'SYNTH-WF-01';

const ACCOUNTS = [
  {
    username: 'synthetic.admin',
    email: 'synthetic.admin@example.test',
    fullName: 'Synthetic Facility Administrator',
    role: 'FACILITY_ADMIN',
    roleDescription: 'Synthetic facility administrator — approves leave',
    passwordEnv: 'SYNTH_FACILITY_ADMIN_PASSWORD',
  },
  {
    username: 'synthetic.hr',
    email: 'synthetic.hr@example.test',
    fullName: 'Synthetic HR Officer',
    role: 'HR_OFFICER',
    roleDescription: 'Synthetic HR officer — records staff, leave and payroll preparation',
    passwordEnv: 'SYNTH_HR_PASSWORD',
  },
  {
    username: 'synthetic.finance',
    email: 'synthetic.finance@example.test',
    fullName: 'Synthetic Finance Manager',
    role: 'FINANCE_MANAGER',
    roleDescription: 'Synthetic finance manager — statutory rules, payroll approval and posting',
    passwordEnv: 'SYNTH_FINANCE_PASSWORD',
  },
] as const;

/* Permissions each synthetic account needs for the Phase 5 journey. */
const HR_PERMISSIONS = [
  'hr.read',
  'hr.manage',
  'hr.approve',
  'payroll.read',
  'payroll.manage',
] as const;
/* The facility administrator also lands on the operational dashboard, so it
   needs the read scopes that dashboard aggregates. Least privilege otherwise. */
const ADMIN_PERMISSIONS = [
  ...HR_PERMISSIONS,
  'patients.read',
  'billing.read',
  'inventory.read',
  'reports.read',
] as const;
const FINANCE_PERMISSIONS = [
  'hr.read',
  'payroll.read',
  // The finance manager may also prepare a run. That is deliberate: it lets
  // acceptance prove the database's segregation-of-duties rule rather than
  // only the route permission.
  'payroll.manage',
  'payroll.approve',
  'payroll.post',
  'payroll.statutory.manage',
  'accounting.read',
  'accounting.coa.manage',
  'accounting.journals.post',
  'accounting.periods.close',
] as const;

function requireEnvironment() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('The synthetic fixture refuses to run with NODE_ENV=production.');
  if (process.env.SYNTHETIC_FIXTURE_CONFIRM !== 'yes')
    throw new Error(
      'Set SYNTHETIC_FIXTURE_CONFIRM=yes to confirm this is a synthetic, non-production database.',
    );
  for (const account of ACCOUNTS) {
    const password = process.env[account.passwordEnv];
    if (!password || password.length < 12)
      throw new Error(`${account.passwordEnv} must contain at least 12 characters.`);
  }
}

async function main() {
  requireEnvironment();

  const existing = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, SLUG))
    .limit(1);

  let tenantId: number;
  let facilityId: number;

  if (existing.length > 0) {
    if (existing[0].name !== TENANT_NAME)
      throw new Error('A non-synthetic tenant already uses this slug. Refusing to modify it.');
    tenantId = existing[0].id;
    const [facility] = await db
      .select()
      .from(schema.facilities)
      .where(
        and(eq(schema.facilities.tenantId, tenantId), eq(schema.facilities.code, FACILITY_CODE)),
      )
      .limit(1);
    if (!facility)
      throw new Error('Synthetic tenant exists without its facility. Manual review required.');
    facilityId = facility.id;
    console.log(`Synthetic tenant ${tenantId} and facility ${facilityId} already exist.`);
  } else {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: TENANT_NAME,
        slug: SLUG,
        domain: 'synthetic.example.test',
        contactEmail: 'synthetic.admin@example.test',
        contactPhone: '+254700000000',
        currency: 'KES',
        timezone: 'Africa/Nairobi',
        settings: { synthetic: true, purpose: 'Phase 5 acceptance evidence' },
      })
      .returning();
    tenantId = tenant.id;
    const [facility] = await db
      .insert(schema.facilities)
      .values({
        tenantId,
        code: FACILITY_CODE,
        name: 'Synthetic Training Health Centre',
        level: 'Level 4',
        county: 'Nyeri',
        subCounty: 'Nyeri Central',
        mflCode: 'SYNTH0001',
        address: 'Synthetic address — not a real facility',
        phone: '+254700000000',
        email: 'facility@example.test',
        enabledModules: [
          'registration',
          'reception',
          'opd',
          'inpatient',
          'maternity',
          'theatre',
          'specialty',
          'laboratory',
          'radiology',
          'pharmacy',
          'inventory',
          'billing',
          'accounting',
          'hr',
          'payroll',
        ],
      })
      .returning();
    facilityId = facility.id;
    console.log(`Created synthetic tenant ${tenantId} and facility ${facilityId}.`);
  }

  const permissionRows = await db.select().from(schema.permissions);
  const byCode = new Map(permissionRows.map((row) => [row.code, row]));
  const rolesByAccount = new Map<string, number>();

  for (const account of ACCOUNTS) {
    let [role] = await db
      .select()
      .from(schema.roles)
      .where(and(eq(schema.roles.name, account.role), eq(schema.roles.tenantId, tenantId)))
      .limit(1);
    if (!role) {
      [role] = await db
        .insert(schema.roles)
        .values({
          tenantId,
          name: account.role,
          description: account.roleDescription,
          isSystem: false,
          isActive: true,
        })
        .returning();
    }
    rolesByAccount.set(account.username, role.id);
  }

  for (const account of ACCOUNTS) {
    const role = { id: rolesByAccount.get(account.username)! };
    const passwordHash = await hashPassword(process.env[account.passwordEnv]!);
    let [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, account.username))
      .limit(1);

    if (user) {
      if (user.tenantId !== tenantId)
        throw new Error(`${account.username} belongs to another tenant. Refusing to modify it.`);
      await db
        .update(schema.users)
        .set({
          passwordHash,
          fullName: account.fullName,
          email: account.email,
          accountStatus: 'ACTIVE',
          isActive: true,
          mustChangePassword: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, user.id));
    } else {
      [user] = await db
        .insert(schema.users)
        .values({
          uid: `usr_${randomUUID()}`,
          tenantId,
          facilityId,
          username: account.username,
          email: account.email,
          fullName: account.fullName,
          phone: '+254700000000',
          designation: account.fullName,
          passwordHash,
          accountStatus: 'ACTIVE',
          mustChangePassword: false,
          isActive: true,
        })
        .returning();
    }

    // This fixture owns these synthetic users; any other role link on them is
    // stale output from an earlier fixture revision and is removed here.
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, user.id));
    await db.insert(schema.userRoles).values({
      userId: user.id,
      roleId: role.id,
      assignedBy: 'synthetic-workforce-fixture',
    });

    const codes =
      account.username === 'synthetic.finance'
        ? FINANCE_PERMISSIONS
        : account.username === 'synthetic.admin'
          ? ADMIN_PERMISSIONS
          : HR_PERMISSIONS;
    for (const code of codes) {
      const permission = byCode.get(code);
      if (!permission)
        throw new Error(`Permission ${code} is not seeded. Run db:seed:permissions.`);
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
        await db.insert(schema.rolePermissions).values({
          roleId: role.id,
          permissionId: permission.id,
        });
    }
  }

  // A separate open financial period lets the payroll journal post during
  // acceptance. It is created only for this synthetic facility.
  const [period] = await db
    .select()
    .from(schema.financialPeriods)
    .where(eq(schema.financialPeriods.facilityId, facilityId))
    .limit(1);
  if (!period) {
    const year = new Date().getUTCFullYear();
    await db.insert(schema.financialPeriods).values({
      tenantId,
      facilityId,
      periodCode: `SYNTH-${year}`,
      name: `Synthetic financial year ${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      status: 'OPEN',
    });
  }

  console.log(
    JSON.stringify(
      {
        tenantId,
        facilityId,
        roles: Object.fromEntries(rolesByAccount),
        accounts: ACCOUNTS.map((account) => account.username),
        note: 'Passwords were read from the environment and are not printed.',
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
