import { pool } from "../src/db/index.ts";
import { STAFF_ROLE_CATALOGUE } from "../src/auth/staff-role-catalogue.ts";

/*
 * JaliCare HMIS
 * Backfill the staff role catalogue into existing tenants.
 *
 * Roles are tenant-scoped and were only created at tenant creation, so a
 * tenant that predates a catalogue change has a role in the invitation
 * form that nobody can hold. The Super Admin facility screen now does
 * this per tenant; this script does it in bulk.
 *
 * DRY RUN BY DEFAULT. Nothing is written unless --apply is passed.
 *
 *   npx tsx scripts/repair-tenant-staff-roles.ts            # tenants 7 and 8
 *   npx tsx scripts/repair-tenant-staff-roles.ts --tenant 12,15
 *   npx tsx scripts/repair-tenant-staff-roles.ts --all
 *   npx tsx scripts/repair-tenant-staff-roles.ts --all --apply
 *
 * Additive only: it creates missing roles and adds permission links whose
 * row is absent. It never deletes a role, never removes a link and never
 * touches a facility override.
 */

const APPLY = process.argv.includes("--apply");

function parseTenantTargets(): number[] | "all" {
  const index = process.argv.indexOf("--tenant");

  if (index > -1) {
    const raw = process.argv[index + 1] ?? "";
    const ids = raw
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isSafeInteger(value) && value > 0);

    if (ids.length === 0) {
      throw new Error("--tenant needs a comma-separated list of tenant IDs.");
    }

    return ids;
  }

  if (process.argv.includes("--all")) return "all";

  return [7, 8];
}

const TENANT_TARGET = parseTenantTargets();



async function main() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tenantResult = TENANT_TARGET === "all"
      ? await client.query(`SELECT id, name FROM tenants ORDER BY id`)
      : await client.query(
          `SELECT id, name FROM tenants WHERE id = ANY($1::int[]) ORDER BY id`,
          [TENANT_TARGET],
        );

    if (tenantResult.rowCount === 0) {
      throw new Error("Aborting: no tenant matched the requested target.");
    }

    if (TENANT_TARGET !== "all") {
      const foundIds = new Set(
        tenantResult.rows.map((row: { id: number }) => Number(row.id)),
      );
      const missingTenants = TENANT_TARGET.filter((id) => !foundIds.has(id));

      if (missingTenants.length) {
        throw new Error(
          `Aborting: target tenant IDs not found: ${missingTenants.join(", ")}`,
        );
      }
    }

    console.log(APPLY ? "\nAPPLY MODE" : "\nDRY-RUN MODE — no changes will be committed");
    console.table(tenantResult.rows);

    const allCodes = [
      ...new Set(STAFF_ROLE_CATALOGUE.flatMap((role) => role.permissions)),
    ];

    const permissionResult = await client.query(
      `SELECT id, code FROM permissions WHERE code = ANY($1::text[])`,
      [allCodes],
    );

    const permissionIds = new Map<string, number>(
      permissionResult.rows.map(
        (row: { id: number; code: string }) => [row.code, Number(row.id)],
      ),
    );

    const missingCodes = allCodes.filter((code) => !permissionIds.has(code));
    if (missingCodes.length) {
      throw new Error(
        `Aborting: required permission codes are missing: ${missingCodes.join(", ")}`,
      );
    }

    let rolesCreated = 0;
    let linksAdded = 0;

    for (const tenant of tenantResult.rows) {
      console.log(`\nTenant ${tenant.id}: ${tenant.name}`);

      for (const role of STAFF_ROLE_CATALOGUE) {
        let roleId: number;
        const existing = await client.query(
          `SELECT id, is_active FROM roles
           WHERE tenant_id = $1 AND name = $2`,
          [tenant.id, role.name],
        );

        if (existing.rowCount) {
          roleId = Number(existing.rows[0].id);
          console.log(
            `  Existing role: ${role.name} (active: ${existing.rows[0].is_active})`,
          );
        } else {
          console.log(`  Missing role: ${role.name}`);
          if (APPLY) {
            const inserted = await client.query(
              `INSERT INTO roles
                 (tenant_id, name, description, is_system, is_active)
               VALUES ($1, $2, $3, false, true)
               ON CONFLICT (tenant_id, name) DO NOTHING
               RETURNING id`,
              [tenant.id, role.name, role.description],
            );

            if (inserted.rowCount) {
              roleId = Number(inserted.rows[0].id);
              rolesCreated++;
            } else {
              const reread = await client.query(
                `SELECT id FROM roles WHERE tenant_id = $1 AND name = $2`,
                [tenant.id, role.name],
              );
              if (!reread.rowCount) {
                throw new Error(`Could not resolve role ${role.name} for tenant ${tenant.id}`);
              }
              roleId = Number(reread.rows[0].id);
            }
          } else {
            continue;
          }
        }

        for (const code of role.permissions) {
          const permissionId = permissionIds.get(code)!;

          if (!APPLY) {
            const link = await client.query(
              `SELECT 1 FROM role_permissions
               WHERE role_id = $1 AND permission_id = $2`,
              [roleId, permissionId],
            );
            if (!link.rowCount) {
              console.log(`    Missing permission link: ${code}`);
            }
            continue;
          }

          const insertedLink = await client.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             VALUES ($1, $2)
             ON CONFLICT (role_id, permission_id) DO NOTHING
             RETURNING id`,
            [roleId, permissionId],
          );
          linksAdded += insertedLink.rowCount ?? 0;
        }
      }
    }

    if (APPLY) {
      await client.query("COMMIT");
      console.log(`\nCommitted. New roles: ${rolesCreated}; new permission links: ${linksAdded}`);
    } else {
      await client.query("ROLLBACK");
      console.log("\nDry run finished. Database changes rolled back.");
      console.log("If the plan is correct, rerun with --apply.");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Staff role repair failed:", error);
  process.exitCode = 1;
});
