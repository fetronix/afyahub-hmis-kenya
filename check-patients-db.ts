import { db } from "./src/db/index.ts";
import * as schema from "./src/db/schema.ts";

async function checkDatabase() {
  try {
    const tenants = await db.select().from(schema.tenants);
    const facilities = await db.select().from(schema.facilities);
    const users = await db.select().from(schema.users);

    console.log("\n==============================================");
    console.log(" JaliCare DATABASE CHECK");
    console.log("==============================================\n");

    console.log("TENANTS:");
    console.log(tenants);

    console.log("\nFACILITIES:");
    console.log(facilities);

    console.log("\nUSERS:");
    console.log(
      users.map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        accountStatus: user.accountStatus,
      })),
    );

    console.log("\n==============================================");
    console.log(`Tenant count:   ${tenants.length}`);
    console.log(`Facility count: ${facilities.length}`);
    console.log(`User count:     ${users.length}`);
    console.log("==============================================\n");
  } catch (error) {
    console.error("DATABASE CHECK FAILED:");
    console.error(error);
    process.exitCode = 1;
  }
}

checkDatabase();