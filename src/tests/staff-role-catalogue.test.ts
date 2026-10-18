import { STAFF_ROLE_CATALOGUE } from "../auth/staff-role-catalogue.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }

  console.log(`PASS: ${message}`);
}

function runStaffRoleCatalogueTests(): void {
  const expectedRoles = [
    "BILLING_CLERK",
    "DOCTOR",
    "INVENTORY_OFFICER",
    "LABORATORY_TECHNICIAN",
    "NURSE",
    "PHARMACIST",
    "RECEPTIONIST",
  ];

  const actualRoles = STAFF_ROLE_CATALOGUE.map((role) => role.name);

  assert(
    actualRoles.length === expectedRoles.length,
    "Catalogue contains exactly seven standard staff roles",
  );

  assert(
    new Set(actualRoles).size === actualRoles.length,
    "Role names are unique",
  );

  assert(
    [...actualRoles].sort().join("|") ===
      [...expectedRoles].sort().join("|"),
    "Catalogue contains every expected staff role",
  );

  assert(
    STAFF_ROLE_CATALOGUE.every(
      (role) => role.description.trim().length > 0,
    ),
    "Every role has a description",
  );

  assert(
    STAFF_ROLE_CATALOGUE.every(
      (role) =>
        role.permissions.length > 0 &&
        new Set(role.permissions).size === role.permissions.length,
    ),
    "Every role has unique, non-empty permissions",
  );

  assert(
    STAFF_ROLE_CATALOGUE.every(
      (role) =>
        !/(SUPER[_ ]?ADMIN|PLATFORM[_ ]?ADMIN|FACILITY[_ ]?ADMIN|TENANT[_ ]?ADMIN)/i.test(
          role.name,
        ),
    ),
    "Privileged administrator roles are not in the staff catalogue",
  );

  console.log("\nStaff role catalogue tests passed.");
}

try {
  runStaffRoleCatalogueTests();
} catch (error) {
  console.error("\nStaff role catalogue tests failed.");
  console.error(error);
  process.exit(1);
}
