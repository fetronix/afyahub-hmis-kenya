/**
 * JaliCare HMIS
 * Backfill inpatient permissions for existing tenant staff roles.
 *
 * WHY THIS EXISTS
 * ---------------
 * Tenant staff roles are provisioned from STAFF_ROLE_CATALOGUE at the
 * moment a tenant is created. Adding `inpatient.admit` /
 * `inpatient.discharge` to the catalogue therefore affects only NEW
 * tenants. Existing DOCTOR and NURSE roles in the database do not gain
 * the codes, and once the inpatient routes enforce them those users
 * would receive HTTP 403 and the module would appear broken.
 *
 * This script grants the missing codes to existing tenant roles.
 *
 * SAFETY
 * ------
 * - Idempotent: existing assignments are skipped.
 * - Non-destructive: it only INSERTs role_permissions rows.
 * - Never touches SUPER_ADMIN (it already holds every permission).
 * - Supports --dry-run to print the plan without writing.
 *
 * USAGE
 * -----
 *   npx tsx scripts/grant-inpatient-permissions.ts --dry-run
 *   npx tsx scripts/grant-inpatient-permissions.ts
 *
 * REQUIRES: src/seeds/permissions.ts to have been run so that the
 * permission codes exist in the `permissions` table.
 */

import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { db, pool } from '../src/db/index.ts';
import { permissions, rolePermissions, roles } from '../src/db/schema.ts';

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Codes granted per staff role. Mirrors STAFF_ROLE_CATALOGUE.
 *
 * NURSE deliberately does not receive inpatient.discharge.
 */
const GRANTS: ReadonlyArray<{ roleName: string; codes: readonly string[] }> = [
  {
    roleName: 'DOCTOR',
    codes: ['inpatient.admit', 'inpatient.discharge'],
  },
  {
    roleName: 'NURSE',
    codes: ['inpatient.admit'],
  },
];

async function main(): Promise<void> {
  console.log('');
  console.log('==============================================');
  console.log('Inpatient permission backfill');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY'}`);
  console.log('==============================================');

  const allCodes = [...new Set(GRANTS.flatMap((grant) => [...grant.codes]))];

  const permissionRows = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, allCodes));

  const permissionIdByCode = new Map(
    permissionRows.map((row) => [row.code, row.id]),
  );

  const missingCodes = allCodes.filter(
    (code) => !permissionIdByCode.has(code),
  );

  if (missingCodes.length > 0) {
    throw new Error(
      `Permission codes missing from the database: ${missingCodes.join(', ')}. ` +
        'Run the permission seeder before this backfill.',
    );
  }

  let inserted = 0;
  let skipped = 0;

  for (const grant of GRANTS) {
    const tenantRoles = await db
      .select({ id: roles.id, name: roles.name, tenantId: roles.tenantId })
      .from(roles)
      .where(
        and(
          eq(roles.name, grant.roleName),
          isNotNull(roles.tenantId),
          eq(roles.isActive, true),
        ),
      );

    console.log('');
    console.log(
      `${grant.roleName}: ${tenantRoles.length} active tenant role(s)`,
    );

    for (const role of tenantRoles) {
      for (const code of grant.codes) {
        const permissionId = permissionIdByCode.get(code);
        if (!permissionId) continue;

        const existing = await db
          .select({ roleId: rolePermissions.roleId })
          .from(rolePermissions)
          .where(
            and(
              eq(rolePermissions.roleId, role.id),
              eq(rolePermissions.permissionId, permissionId),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          skipped += 1;
          continue;
        }

        if (DRY_RUN) {
          console.log(
            `  would grant ${code} -> role ${role.id} (tenant ${role.tenantId})`,
          );
          inserted += 1;
          continue;
        }

        await db.insert(rolePermissions).values({
          roleId: role.id,
          permissionId,
        });

        console.log(
          `  granted ${code} -> role ${role.id} (tenant ${role.tenantId})`,
        );
        inserted += 1;
      }
    }
  }

  console.log('');
  console.log('==============================================');
  console.log(
    `${DRY_RUN ? 'Would insert' : 'Inserted'}: ${inserted}  Skipped (already present): ${skipped}`,
  );
  console.log('==============================================');
  console.log('');
}

main()
  .catch((error) => {
    console.error('');
    console.error('Inpatient permission backfill FAILED');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
