/**
 * JaliCare HMIS — synthetic fixed-asset fixture (development only).
 *
 * Creates a clearly-labelled synthetic facility with the chart-of-accounts
 * slice, open financial period, asset category and one capitalised asset the
 * browser demonstration needs. It never touches a real facility.
 *
 * SAFETY
 * ------
 * - Refuses when NODE_ENV is production.
 * - Refuses without SYNTHETIC_FIXTURE_CONFIRM=yes.
 * - Refuses to adopt an existing tenant with a different name.
 * - Passwords are read from the environment and never printed.
 */

import 'dotenv/config';
import { and, eq } from 'drizzle-orm';

import { db, pool } from '../src/db/index.ts';
import * as schema from '../src/db/schema.ts';
import { createAsset, createCategory } from '../src/assets/fixed-assets.service.ts';
import { hashPassword } from '../src/utils/password.ts';

const SLUG = 'jalicare-synthetic-assets';
const TENANT_NAME = 'JaliCare Synthetic Fixed Asset Tenant';
const FACILITY_CODE = 'SYNTH-FA-01';
const USERNAME = 'synthetic.assets';
const PASSWORD_ENV = 'SYNTH_ASSET_PASSWORD';

const PERMISSIONS = [
  'assets.read',
  'assets.manage',
  'assets.depreciate',
  'assets.dispose',
  'accounting.read',
  'patients.read',
  'billing.read',
  'reports.read',
] as const;

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('The synthetic fixture refuses to run with NODE_ENV=production.');
  if (process.env.SYNTHETIC_FIXTURE_CONFIRM !== 'yes')
    throw new Error(
      'Set SYNTHETIC_FIXTURE_CONFIRM=yes to confirm a synthetic, non-production database.',
    );
  const password = process.env[PASSWORD_ENV];
  if (!password || password.length < 12)
    throw new Error(`${PASSWORD_ENV} must contain at least 12 characters.`);

  const existing = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, SLUG))
    .limit(1);

  let tenantId: number;
  let facilityId: number;
  if (existing.length) {
    if (existing[0].name !== TENANT_NAME)
      throw new Error('A non-synthetic tenant already uses this slug. Refusing to modify it.');
    tenantId = existing[0].id;
  } else {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: TENANT_NAME,
        slug: SLUG,
        domain: 'synthetic-assets.example.test',
        contactEmail: 'synthetic.assets@example.test',
        contactPhone: '+254700000000',
        currency: 'KES',
        timezone: 'Africa/Nairobi',
        settings: { synthetic: true, purpose: 'Phase 5 fixed-asset acceptance' },
      })
      .returning();
    tenantId = tenant.id;
  }

  const [facility] = await db
    .select()
    .from(schema.facilities)
    .where(and(eq(schema.facilities.tenantId, tenantId), eq(schema.facilities.code, FACILITY_CODE)))
    .limit(1);
  if (facility) facilityId = facility.id;
  else {
    const [created] = await db
      .insert(schema.facilities)
      .values({
        tenantId,
        code: FACILITY_CODE,
        name: 'Synthetic Asset Health Centre',
        level: 'Level 4',
        county: 'Nyeri',
        subCounty: 'Nyeri Central',
        mflCode: 'SYNTHFA01',
        address: 'Synthetic address — not a real facility',
        enabledModules: ['accounting', 'finance', 'registration', 'analytics'],
      })
      .returning();
    facilityId = created.id;
  }

  /* Chart of accounts — only the accounts the register needs. */
  const accountSpec = [
    ['FA-1500', 'Medical equipment', 'ASSET', 'DEBIT'],
    ['FA-1590', 'Accumulated depreciation — equipment', 'ASSET', 'CREDIT'],
    ['FA-5200', 'Depreciation expense', 'EXPENSE', 'DEBIT'],
    ['FA-1100', 'Bank — operating', 'ASSET', 'DEBIT'],
    ['FA-1110', 'Disposal proceeds', 'ASSET', 'DEBIT'],
    ['FA-4300', 'Gain or loss on asset disposal', 'REVENUE', 'CREDIT'],
    ['FA-5300', 'Equipment maintenance', 'EXPENSE', 'DEBIT'],
  ] as const;
  const accounts: Record<string, number> = {};
  for (const [code, name, type, normal] of accountSpec) {
    const [row] = await db
      .select()
      .from(schema.chartOfAccounts)
      .where(
        and(
          eq(schema.chartOfAccounts.facilityId, facilityId),
          eq(schema.chartOfAccounts.accountCode, code),
        ),
      )
      .limit(1);
    if (row) accounts[code] = row.id;
    else {
      const [created] = await db
        .insert(schema.chartOfAccounts)
        .values({
          tenantId,
          facilityId,
          accountCode: code,
          accountName: name,
          accountType: type,
          subType: 'FIXED_ASSET',
          normalBalance: normal,
        })
        .returning();
      accounts[code] = created.id;
    }
  }

  const [period] = await db
    .select()
    .from(schema.financialPeriods)
    .where(
      and(
        eq(schema.financialPeriods.facilityId, facilityId),
        eq(schema.financialPeriods.periodCode, 'SYNTH-FA-2026'),
      ),
    )
    .limit(1);
  if (!period)
    await db.insert(schema.financialPeriods).values({
      tenantId,
      facilityId,
      periodCode: 'SYNTH-FA-2026',
      name: 'Synthetic financial year 2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'OPEN',
    });

  /* The synthetic operator. */
  const passwordHash = await hashPassword(password);
  const [role] = await db
    .select()
    .from(schema.roles)
    .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.name, 'ASSET_OFFICER')))
    .limit(1);
  let roleId: number;
  if (role) roleId = role.id;
  else {
    const [created] = await db
      .insert(schema.roles)
      .values({
        tenantId,
        name: 'ASSET_OFFICER',
        description: 'Synthetic asset officer — register, depreciate and dispose',
        isActive: true,
      })
      .returning();
    roleId = created.id;
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, USERNAME))
    .limit(1);
  let userId: number;
  if (user) {
    if (user.tenantId !== tenantId)
      throw new Error(`${USERNAME} belongs to another tenant. Refusing to modify it.`);
    userId = user.id;
    await db
      .update(schema.users)
      .set({ passwordHash, accountStatus: 'ACTIVE', facilityId, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  } else {
    const [created] = await db
      .insert(schema.users)
      .values({
        uid: `${USERNAME}-${tenantId}`,
        username: USERNAME,
        email: 'synthetic.assets@example.test',
        fullName: 'Synthetic Asset Officer',
        passwordHash,
        accountStatus: 'ACTIVE',
        tenantId,
        facilityId,
      })
      .returning();
    userId = created.id;
  }

  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
  await db
    .insert(schema.userRoles)
    .values({ userId, roleId, assignedBy: 'synthetic-fixed-assets-fixture' });

  for (const code of PERMISSIONS) {
    const [permission] = await db
      .select()
      .from(schema.permissions)
      .where(eq(schema.permissions.code, code))
      .limit(1);
    if (!permission) throw new Error(`Permission ${code} is not seeded. Run db:seed:permissions.`);
    const [grant] = await db
      .select()
      .from(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.roleId, roleId),
          eq(schema.rolePermissions.permissionId, permission.id),
        ),
      )
      .limit(1);
    if (!grant)
      await db.insert(schema.rolePermissions).values({ roleId, permissionId: permission.id });
  }

  const scope = {
    tenantId,
    facilityId,
    actorId: userId,
    actorName: 'Synthetic Asset Officer',
  };

  const [existingCategory] = await db
    .select()
    .from(schema.fixedAssetCategories)
    .where(
      and(
        eq(schema.fixedAssetCategories.facilityId, facilityId),
        eq(schema.fixedAssetCategories.code, 'IMAGING'),
      ),
    )
    .limit(1);
  const category =
    existingCategory ??
    (await createCategory(scope, {
      code: 'IMAGING',
      name: 'Imaging equipment',
      defaultUsefulLifeMonths: 60,
      assetAccountId: accounts['FA-1500'],
      accumDepAccountId: accounts['FA-1590'],
      depExpenseAccountId: accounts['FA-5200'],
    }));

  const [existingAsset] = await db
    .select()
    .from(schema.fixedAssets)
    .where(
      and(
        eq(schema.fixedAssets.facilityId, facilityId),
        eq(schema.fixedAssets.assetCode, 'SYNTH-US-001'),
      ),
    )
    .limit(1);
  if (!existingAsset) {
    await createAsset(scope, {
      assetCode: 'SYNTH-US-001',
      assetName: 'Synthetic ultrasound scanner',
      categoryId: category.id,
      acquisitionDate: '2026-01-15',
      acquisitionCostKes: '1200000.00',
      salvageValueKes: '120000.00',
      usefulLifeMonths: 60,
      acquisitionCreditAccountId: accounts['FA-1100'],
      location: 'Synthetic imaging room',
      serialNumber: 'SYNTH-SN-0001',
      notes: 'Synthetic acceptance asset. Not real equipment.',
    });
  }

  const [secondAsset] = await db
    .select()
    .from(schema.fixedAssets)
    .where(
      and(
        eq(schema.fixedAssets.facilityId, facilityId),
        eq(schema.fixedAssets.assetCode, 'SYNTH-BED-010'),
      ),
    )
    .limit(1);
  if (!secondAsset) {
    await createAsset(scope, {
      assetCode: 'SYNTH-BED-010',
      assetName: 'Synthetic ward bed',
      categoryId: category.id,
      acquisitionDate: '2026-03-01',
      acquisitionCostKes: '85000.00',
      salvageValueKes: '5000.00',
      usefulLifeMonths: 60,
      acquisitionCreditAccountId: accounts['FA-1100'],
      location: 'Synthetic ward A',
      serialNumber: 'SYNTH-SN-0010',
      notes: 'Synthetic acceptance asset. Not real equipment.',
    });
  }

  console.log(
    JSON.stringify(
      {
        tenantId,
        facilityId,
        username: USERNAME,
        assets: ['SYNTH-US-001', 'SYNTH-BED-010'],
        note: 'Passwords were read from the environment and are not printed.',
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} finally {
  await pool.end().catch(() => undefined);
}
