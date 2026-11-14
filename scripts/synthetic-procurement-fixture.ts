/**
 * JaliCare HMIS — synthetic procurement fixture (development only).
 *
 * Creates a clearly labelled synthetic tenant with the minimum chart of
 * accounts, an open financial period, one bank account, one supplier and one
 * inventory item, plus a requester and an approver so the whole chain
 * (requisition → order → goods receipt → invoice → payment) can be exercised
 * against real endpoints.
 *
 * SAFETY
 * ------
 * - Refuses to run when NODE_ENV is production.
 * - Refuses without SYNTHETIC_FIXTURE_CONFIRM=yes.
 * - Idempotent for its own synthetic tenant only; it never resets a database.
 * - Reads passwords from environment variables and never prints them.
 */

import 'dotenv/config';
import { and, eq } from 'drizzle-orm';

import { db, pool } from '../src/db/index.ts';
import * as schema from '../src/db/schema.ts';
import { hashPassword } from '../src/utils/password.ts';

const SLUG = 'jalicare-synthetic-procurement';
const TENANT_NAME = 'JaliCare Synthetic Procurement Tenant';
const FACILITY_CODE = 'SYNTH-PROC-01';

const REQUESTER = {
  username: 'synthetic.procurement',
  fullName: 'Synthetic Procurement Officer',
  role: 'PROCUREMENT_OFFICER',
  passwordEnv: 'SYNTH_PROCUREMENT_PASSWORD',
  // The approver permission is included on purpose: it lets the journey prove
  // the service-level segregation-of-duties rule, not just the route gate.
  permissions: ['procurement.read', 'procurement.create', 'procurement.approve'],
} as const;

const APPROVER = {
  username: 'synthetic.procurement.approver',
  fullName: 'Synthetic Procurement Approver',
  role: 'PROCUREMENT_APPROVER',
  passwordEnv: 'SYNTH_PROCUREMENT_APPROVER_PASSWORD',
  permissions: [
    'procurement.read',
    'procurement.create',
    'procurement.approve',
    'procurement.complete',
    'accounting.read',
  ],
} as const;

function requireEnvironment() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('The synthetic fixture refuses to run with NODE_ENV=production.');
  if (process.env.SYNTHETIC_FIXTURE_CONFIRM !== 'yes')
    throw new Error('Set SYNTHETIC_FIXTURE_CONFIRM=yes to create synthetic records.');
  for (const account of [REQUESTER, APPROVER]) {
    if (!process.env[account.passwordEnv])
      throw new Error(`${account.passwordEnv} is required (the value is never printed).`);
  }
}

async function main() {
  requireEnvironment();

  /* Tenant and facility. */
  const [existingFacility] = await db
    .select({ id: schema.facilities.id, tenantId: schema.facilities.tenantId })
    .from(schema.facilities)
    .where(eq(schema.facilities.code, FACILITY_CODE))
    .limit(1);

  let tenantId: number;
  let facilityId: number;
  if (existingFacility) {
    tenantId = existingFacility.tenantId;
    facilityId = existingFacility.id;
  } else {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: TENANT_NAME, slug: SLUG })
      .returning();
    tenantId = tenant.id;
    const [facility] = await db
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
    facilityId = facility.id;
  }

  /* Chart of accounts — only what the chain posts to. */
  const accountSpec = [
    ['PR-5100', 'Medical consumables', 'EXPENSE', 'DEBIT', 'COST_OF_SERVICE'],
    ['PR-2100', 'Accounts payable — suppliers', 'LIABILITY', 'CREDIT', 'PAYABLES'],
    ['PR-1100', 'Bank — operating', 'ASSET', 'DEBIT', 'BANK'],
  ] as const;
  const accounts: Record<string, number> = {};
  for (const [code, name, type, normal, subType] of accountSpec) {
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
          subType,
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
        eq(schema.financialPeriods.periodCode, 'SYNTH-PROC-2026'),
      ),
    )
    .limit(1);
  if (!period)
    await db.insert(schema.financialPeriods).values({
      tenantId,
      facilityId,
      periodCode: 'SYNTH-PROC-2026',
      name: 'Synthetic procurement year 2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'OPEN',
    });

  /* Bank account so supplier payments have somewhere to clear. */
  const [bank] = await db
    .select()
    .from(schema.bankAccounts)
    .where(
      and(
        eq(schema.bankAccounts.facilityId, facilityId),
        eq(schema.bankAccounts.accountName, 'Synthetic operating account'),
      ),
    )
    .limit(1);
  if (!bank)
    await db.insert(schema.bankAccounts).values({
      tenantId,
      facilityId,
      accountName: 'Synthetic operating account',
      bankCode: 'SYNTH',
      bankName: 'Synthetic Bank',
      branchName: 'Synthetic branch',
      accountNumberMasked: '****0000',
      glAccountId: accounts['PR-1100'],
      connectorMode: 'STATEMENT_IMPORT_ONLY',
      openingBalanceKes: '500000.00',
      bookBalanceKes: '500000.00',
    });

  /* Supplier. */
  const [supplier] = await db
    .select()
    .from(schema.suppliers)
    .where(
      and(
        eq(schema.suppliers.tenantId, tenantId),
        eq(schema.suppliers.name, 'Synthetic Supplies Ltd'),
      ),
    )
    .limit(1);
  const supplierId =
    supplier?.id ??
    (
      await db
        .insert(schema.suppliers)
        .values({
          tenantId,
          name: 'Synthetic Supplies Ltd',
          contactPerson: 'Synthetic contact',
          phone: '+254000000000',
          email: 'supplier@example.test',
          isActive: true,
        })
        .returning()
    )[0].id;

  /* Stock item so the receipt changes a real batch. */
  const [item] = await db
    .select()
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.facilityId, facilityId),
        eq(schema.inventoryItems.itemCode, 'SYNTH-GLOVE-M'),
      ),
    )
    .limit(1);
  const inventoryItemId =
    item?.id ??
    (
      await db
        .insert(schema.inventoryItems)
        .values({
          facilityId,
          itemCode: 'SYNTH-GLOVE-M',
          name: 'Synthetic examination gloves (medium)',
          category: 'Consumables',
          unit: 'box',
          currentStock: 0,
          reorderLevel: 10,
          unitCost: '1200.00',
        })
        .returning()
    )[0].id;

  /* Accounts. */
  async function ensureAccount(spec: typeof REQUESTER | typeof APPROVER) {
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
      .values({ userId, roleId, assignedBy: 'synthetic-procurement-fixture' });

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

  const requesterId = await ensureAccount(REQUESTER);
  const approverId = await ensureAccount(APPROVER);

  /* One approved order with an outstanding quantity, ready to receive. */
  const [order] = await db
    .select()
    .from(schema.purchaseOrders)
    .where(
      and(
        eq(schema.purchaseOrders.facilityId, facilityId),
        eq(schema.purchaseOrders.poNumber, 'PO-SYNTH-1001'),
      ),
    )
    .limit(1);
  if (!order) {
    const [created] = await db
      .insert(schema.purchaseOrders)
      .values({
        tenantId,
        facilityId,
        supplierId,
        poNumber: 'PO-SYNTH-1001',
        totalAmount: '24000.00',
        status: 'Approved',
        orderedBy: REQUESTER.fullName,
        approvedBy: APPROVER.fullName,
        description: 'Synthetic consumables order for acceptance',
        createdByUserId: requesterId,
      })
      .returning();
    await db.insert(schema.purchaseOrderItems).values([
      {
        purchaseOrderId: created.id,
        lineNumber: 1,
        description: 'Synthetic examination gloves (medium)',
        quantity: '10.000',
        unit: 'box',
        unitPrice: '1200.00',
        lineTotal: '12000.00',
      },
      {
        purchaseOrderId: created.id,
        lineNumber: 2,
        description: 'Synthetic sharps container (5L)',
        quantity: '20.000',
        unit: 'unit',
        unitPrice: '600.00',
        lineTotal: '12000.00',
      },
    ]);
    await db.insert(schema.purchaseOrderEvents).values({
      purchaseOrderId: created.id,
      eventType: 'CREATED',
      toStatus: 'Approved',
      actorUserId: approverId,
      note: 'Synthetic fixture order; approved for acceptance testing.',
    });
  }

  console.log(
    JSON.stringify(
      {
        tenantId,
        facilityId,
        supplierId,
        inventoryItemId,
        accounts,
        accountsCreated: [REQUESTER.username, APPROVER.username],
        requesterId,
        approverId,
        purchaseOrder: 'PO-SYNTH-1001',
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
