/**
 * JaliCare HMIS — synthetic stock-control fixture (development only).
 *
 * Reuses the synthetic procurement facility when it exists, then adds the
 * minimum stock-control evidence: four items (two at or below their reorder
 * level), their opening batches, a storekeeper, a read-only viewer and one
 * synthetic patient so FEFO dispensing can be exercised.
 *
 * SAFETY
 * ------
 * - Refuses to run when NODE_ENV is production.
 * - Refuses without SYNTHETIC_FIXTURE_CONFIRM=yes.
 * - Idempotent for its own records; never resets or truncates a database.
 * - Reads passwords from environment variables and never prints them.
 */

import 'dotenv/config';
import { and, eq } from 'drizzle-orm';

import { db, pool } from '../src/db/index.ts';
import * as schema from '../src/db/schema.ts';
import { hashPassword } from '../src/utils/password.ts';

const FACILITY_CODE = 'SYNTH-PROC-01';
const TENANT_NAME = 'JaliCare Synthetic Procurement Tenant';
const TENANT_SLUG = 'jalicare-synthetic-procurement';

const STOREKEEPER = {
  username: 'synthetic.inventory',
  fullName: 'Synthetic Stores Officer',
  role: 'INVENTORY_STOREKEEPER',
  passwordEnv: 'SYNTH_INVENTORY_PASSWORD',
  permissions: [
    'inventory.read',
    'inventory.manage',
    'pharmacy.read',
    'pharmacy.dispense',
    'billing.read',
    'billing.create',
    'billing.update',
    'patients.read',
    'procurement.read',
  ],
} as const;

const VIEWER = {
  username: 'synthetic.inventory.reader',
  fullName: 'Synthetic Inventory Viewer',
  role: 'INVENTORY_VIEWER',
  passwordEnv: 'SYNTH_INVENTORY_READER_PASSWORD',
  permissions: ['inventory.read'],
} as const;

const ITEMS = [
  {
    itemCode: 'SYNTH-CTRL-GAUZE',
    name: 'Synthetic gauze swabs',
    category: 'Consumables',
    unit: 'pack',
    currentStock: 0,
    reorderLevel: 20,
    unitCost: '350.00',
    sellingPrice: '500.00',
    storeLocation: 'Main Store',
  },
  {
    itemCode: 'SYNTH-CTRL-SYRINGE',
    name: 'Synthetic syringes 5ml',
    category: 'Consumables',
    unit: 'unit',
    currentStock: 120,
    reorderLevel: 30,
    unitCost: '45.00',
    sellingPrice: '80.00',
    storeLocation: 'Main Store',
  },
  {
    itemCode: 'SYNTH-CTRL-ALCOHOL',
    name: 'Synthetic alcohol swabs',
    category: 'Consumables',
    unit: 'box',
    currentStock: 8,
    reorderLevel: 10,
    unitCost: '620.00',
    sellingPrice: '900.00',
    storeLocation: 'Main Store',
  },
  {
    itemCode: 'SYNTH-CTRL-GLOVE',
    name: 'Synthetic nitrile gloves (large)',
    category: 'Consumables',
    unit: 'box',
    currentStock: 60,
    reorderLevel: 15,
    unitCost: '1100.00',
    sellingPrice: '1500.00',
    storeLocation: 'Satellite Store',
  },
] as const;

function requireEnvironment() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('The synthetic fixture refuses to run with NODE_ENV=production.');
  if (process.env.SYNTHETIC_FIXTURE_CONFIRM !== 'yes')
    throw new Error('Set SYNTHETIC_FIXTURE_CONFIRM=yes to create synthetic records.');
  for (const account of [STOREKEEPER, VIEWER]) {
    if (!process.env[account.passwordEnv])
      throw new Error(`${account.passwordEnv} is required (the value is never printed).`);
  }
}

async function main() {
  requireEnvironment();

  const [facility] = await db
    .select()
    .from(schema.facilities)
    .where(eq(schema.facilities.code, FACILITY_CODE))
    .limit(1);

  let tenantId: number;
  let facilityId: number;

  if (facility) {
    tenantId = facility.tenantId;
    facilityId = facility.id;
    /* The stock-control journey dispenses, which needs the pharmacy module. */
    const modules = (facility.enabledModules ?? []) as string[];
    if (!modules.includes('pharmacy'))
      await db
        .update(schema.facilities)
        .set({ enabledModules: [...modules, 'pharmacy'], updatedAt: new Date() })
        .where(eq(schema.facilities.id, facilityId));
  } else {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: TENANT_NAME, slug: TENANT_SLUG })
      .returning();
    tenantId = tenant.id;
    const [created] = await db
      .insert(schema.facilities)
      .values({
        tenantId,
        name: 'Synthetic Procurement Health Centre',
        code: FACILITY_CODE,
        county: 'Nyeri',
        subCounty: 'Nyeri Central',
        mflCode: 'SYNTHPC01',
        address: 'Synthetic address — not a real facility',
        enabledModules: ['procurement', 'inventory', 'finance', 'accounting'],
      })
      .returning();
    facilityId = created.id;
  }

  const itemIds: Record<string, number> = {};
  for (const spec of ITEMS) {
    const [existing] = await db
      .select()
      .from(schema.inventoryItems)
      .where(
        and(
          eq(schema.inventoryItems.facilityId, facilityId),
          eq(schema.inventoryItems.itemCode, spec.itemCode),
        ),
      )
      .limit(1);
    const item =
      existing ??
      (
        await db
          .insert(schema.inventoryItems)
          .values({
            facilityId,
            itemCode: spec.itemCode,
            name: spec.name,
            category: spec.category,
            unit: spec.unit,
            currentStock: spec.currentStock,
            reorderLevel: spec.reorderLevel,
            unitCost: spec.unitCost,
            sellingPrice: spec.sellingPrice,
            storeLocation: spec.storeLocation,
            isActive: true,
          })
          .returning()
      )[0];
    itemIds[spec.itemCode] = item.id;

    /* One opening batch per item, matching the recorded stock. */
    if (spec.currentStock > 0) {
      const batchNumber = `SYNTH-OPEN-${spec.itemCode.replace('SYNTH-CTRL-', '')}`;
      const [batch] = await db
        .select()
        .from(schema.inventoryBatches)
        .where(
          and(
            eq(schema.inventoryBatches.itemId, item.id),
            eq(schema.inventoryBatches.batchNumber, batchNumber),
          ),
        )
        .limit(1);
      if (!batch)
        await db.insert(schema.inventoryBatches).values({
          itemId: item.id,
          batchNumber,
          expiryDate: '2027-06-30',
          quantityRemaining: spec.currentStock,
          costPerUnit: spec.unitCost,
        });
    }
  }

  async function ensureAccount(spec: typeof STOREKEEPER | typeof VIEWER) {
    const passwordHash = await hashPassword(process.env[spec.passwordEnv]!);
    const [role] = await db
      .select()
      .from(schema.roles)
      .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.name, spec.role)))
      .limit(1);
    const roleId =
      role?.id ??
      (
        await db
          .insert(schema.roles)
          .values({
            tenantId,
            name: spec.role,
            description: `Synthetic ${spec.role}`,
            isActive: true,
          })
          .returning()
      )[0].id;

    const [existing] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, spec.username))
      .limit(1);
    let userId: number;
    if (existing) {
      if (existing.tenantId !== tenantId)
        throw new Error(`${spec.username} belongs to another tenant. Refusing to modify it.`);
      userId = existing.id;
      await db
        .update(schema.users)
        .set({ passwordHash, accountStatus: 'ACTIVE', facilityId, updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    } else {
      const [created] = await db
        .insert(schema.users)
        .values({
          uid: `${spec.username}-${tenantId}`,
          username: spec.username,
          email: `${spec.username}@example.test`,
          fullName: spec.fullName,
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
      .values({ userId, roleId, assignedBy: 'synthetic-inventory-fixture' });

    for (const code of spec.permissions) {
      const [permission] = await db
        .select()
        .from(schema.permissions)
        .where(eq(schema.permissions.code, code))
        .limit(1);
      if (!permission)
        throw new Error(`Permission ${code} is not seeded. Run db:seed:permissions.`);
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
    return userId;
  }

  const storekeeperId = await ensureAccount(STOREKEEPER);
  const viewerId = await ensureAccount(VIEWER);

  /* One synthetic patient for FEFO dispensing evidence. */
  const patientMrn = 'SYN-INV-0001';
  const [existingPatient] = await db
    .select({ id: schema.patients.id })
    .from(schema.patients)
    .where(and(eq(schema.patients.tenantId, tenantId), eq(schema.patients.mrn, patientMrn)))
    .limit(1);
  const patientId =
    existingPatient?.id ??
    (
      await db
        .insert(schema.patients)
        .values({
          tenantId,
          registrationFacilityId: facilityId,
          mrn: patientMrn,
          firstName: 'Synthetic',
          lastName: 'Stock Control Patient',
          dateOfBirth: '1990-01-01',
          gender: 'Other',
        })
        .returning({ id: schema.patients.id })
    )[0].id;

  console.log(
    JSON.stringify(
      {
        tenantId,
        facilityId,
        itemIds,
        storekeeperId,
        viewerId,
        patientId,
        accounts: [STOREKEEPER.username, VIEWER.username],
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
