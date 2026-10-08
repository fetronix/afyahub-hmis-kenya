import dotenv from "dotenv";
import { eq, ne, isNull, isNotNull, and } from "drizzle-orm";

import { db } from "./index.ts";
import * as schema from "./schema.ts";

dotenv.config();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

if (!ADMIN_USERNAME && !ADMIN_EMAIL) {
  throw new Error(
    "ADMIN_USERNAME or ADMIN_EMAIL must be configured in .env",
  );
}

async function cleanDatabase() {
  console.log("==============================================");
  console.log(" JaliCare HMIS DATABASE CLEANUP");
  console.log("==============================================");

  await db.transaction(async (tx) => {
    // ============================================================
    // 1. LOCATE SUPER USER
    // ============================================================

    const adminResult = await tx
      .select({
        id: schema.users.id,
        username: schema.users.username,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(
        ADMIN_USERNAME
          ? eq(schema.users.username, ADMIN_USERNAME)
          : eq(schema.users.email, ADMIN_EMAIL!),
      )
      .limit(1);

    if (adminResult.length === 0) {
      throw new Error(
        `Super User not found using username/email from .env.
Username: ${ADMIN_USERNAME ?? "(not configured)"}
Email: ${ADMIN_EMAIL ?? "(not configured)"}`,
      );
    }

    const admin = adminResult[0];

    console.log(
      `Preserving Super User: ${admin.username} (${admin.email})`,
    );

    // ============================================================
    // 2. VERIFY SUPER ADMIN ROLE
    // ============================================================

    const superAdminRole = await tx
      .select({
        id: schema.roles.id,
        name: schema.roles.name,
        tenantId: schema.roles.tenantId,
      })
      .from(schema.roles)
      .where(
        and(
          eq(schema.roles.name, "SUPER_ADMIN"),
          isNull(schema.roles.tenantId),
        ),
      )
      .limit(1);

    if (superAdminRole.length === 0) {
      throw new Error(
        "Global SUPER_ADMIN role was not found. Cleanup stopped.",
      );
    }

    const superAdmin = superAdminRole[0];

    const adminRole = await tx
      .select()
      .from(schema.userRoles)
      .where(
        and(
          eq(schema.userRoles.userId, admin.id),
          eq(schema.userRoles.roleId, superAdmin.id),
        ),
      )
      .limit(1);

    if (adminRole.length === 0) {
      throw new Error(
        "The configured Super User does not have the global SUPER_ADMIN role. Cleanup stopped for safety.",
      );
    }

    // ============================================================
    // 3. SECURITY / AUTH DATA
    // ============================================================

    console.log("Removing sessions...");
    await tx.delete(schema.sessions);

    console.log("Removing login attempts...");
    await tx.delete(schema.loginAttempts);

    console.log("Removing password reset tokens...");
    await tx.delete(schema.passwordResets);

    console.log("Removing facility admin invitations...");
    await tx.delete(schema.facilityAdminInvitations);

    console.log("Removing user invitations...");
    await tx.delete(schema.userInvitations);

    // ============================================================
    // 4. AUDIT LOGS
    // ============================================================

    console.log("Removing old audit logs...");
    await tx.delete(schema.auditLogs);

    // ============================================================
    // 5. FINANCE / INSURANCE
    // ============================================================

    console.log("Removing insurance claims...");
    await tx.delete(schema.insuranceClaims);

    console.log("Removing billing payments...");
    await tx.delete(schema.billingPayments);

    console.log("Removing billing items...");
    await tx.delete(schema.billingItems);

    console.log("Removing billing invoices...");
    await tx.delete(schema.billingInvoices);

    // ============================================================
    // 6. PHARMACY / INVENTORY / PROCUREMENT
    // ============================================================

    console.log("Removing pharmacy dispensations...");
    await tx.delete(schema.pharmacyDispensations);

    console.log("Removing inventory batches...");
    await tx.delete(schema.inventoryBatches);

    console.log("Removing inventory items...");
    await tx.delete(schema.inventoryItems);

    console.log("Removing purchase orders...");
    await tx.delete(schema.purchaseOrders);

    console.log("Removing suppliers...");
    await tx.delete(schema.suppliers);

    // ============================================================
    // 7. LAB / RADIOLOGY
    // ============================================================

    console.log("Removing lab results...");
    await tx.delete(schema.labResults);

    console.log("Removing lab orders...");
    await tx.delete(schema.labOrders);

    console.log("Removing lab tests...");
    await tx.delete(schema.labTests);

    console.log("Removing radiology orders...");
    await tx.delete(schema.radiologyOrders);

    // ============================================================
    // 8. THEATRE / INPATIENT
    // ============================================================

    console.log("Removing theatre cases...");
    await tx.delete(schema.theatreCases);

    console.log("Removing admissions...");
    await tx.delete(schema.admissions);

    console.log("Removing beds...");
    await tx.delete(schema.beds);

    console.log("Removing wards...");
    await tx.delete(schema.wards);

    // ============================================================
    // 9. APPOINTMENTS / QUEUES / CLINICAL DATA
    // ============================================================

    console.log("Removing observations...");
    await tx.delete(schema.observations);

    console.log("Removing diagnoses...");
    await tx.delete(schema.diagnoses);

    console.log("Removing clinical procedures...");
    await tx.delete(schema.clinicalProcedures);

    console.log("Removing medications...");
    await tx.delete(schema.medications);

    console.log("Removing queues...");
    await tx.delete(schema.queues);

    console.log("Removing appointments...");
    await tx.delete(schema.appointments);

    console.log("Removing encounters...");
    await tx.delete(schema.encounters);

    // ============================================================
    // 10. PUBLIC HEALTH
    // ============================================================

    console.log("Removing public health reports...");
    await tx.delete(schema.publicHealthReports);

    // ============================================================
    // 11. PATIENT IDENTIFIERS
    // ============================================================

    console.log("Removing patient identifiers...");
    await tx.delete(schema.patientIdentifiers);

    // ============================================================
    // 12. PATIENTS
    // ============================================================

    console.log("Removing patients...");
    await tx.delete(schema.patients);

    // ============================================================
    // 13. PRACTITIONERS
    // ============================================================

    console.log("Removing practitioners...");
    await tx.delete(schema.practitioners);

    // ============================================================
    // 14. DEPARTMENTS
    // ============================================================

    console.log("Removing departments...");
    await tx.delete(schema.departments);

    // ============================================================
    // 15. FACILITY DOCUMENTS / ONBOARDING
    // ============================================================

    console.log("Removing facility documents...");
    await tx.delete(schema.facilityDocuments);

    console.log("Removing facility onboarding records...");
    await tx.delete(schema.facilityOnboarding);

    // ============================================================
    // 16. USER ROLE ASSIGNMENTS
    // ============================================================

    console.log("Removing non-admin role assignments...");

    await tx
      .delete(schema.userRoles)
      .where(ne(schema.userRoles.userId, admin.id));

    // ============================================================
    // 17. REMOVE TENANT-SCOPED ROLES
    //
    // Keep only global roles such as SUPER_ADMIN.
    // ============================================================

    console.log("Removing tenant-specific role permissions...");

    const tenantRoles = await tx
      .select({
        id: schema.roles.id,
      })
      .from(schema.roles)
      .where(isNotNull(schema.roles.tenantId));

    for (const role of tenantRoles) {
      await tx
        .delete(schema.rolePermissions)
        .where(eq(schema.rolePermissions.roleId, role.id));
    }

    console.log("Removing tenant-specific roles...");

    await tx
      .delete(schema.roles)
      .where(isNotNull(schema.roles.tenantId));

    // ============================================================
    // 18. REMOVE FACILITIES
    // ============================================================

    console.log("Removing facilities...");
    await tx.delete(schema.facilities);

    // ============================================================
    // 19. REMOVE TENANTS
    // ============================================================

    console.log("Removing tenants...");
    await tx.delete(schema.tenants);

    // ============================================================
    // 20. REMOVE NON-ADMIN USERS
    // ============================================================

    console.log("Removing non-admin users...");

    await tx
      .delete(schema.users)
      .where(ne(schema.users.id, admin.id));

    // ============================================================
    // 21. VERIFY ADMIN STILL EXISTS
    // ============================================================

    const remainingUsers = await tx
      .select({
        id: schema.users.id,
        username: schema.users.username,
        email: schema.users.email,
      })
      .from(schema.users);

    if (remainingUsers.length !== 1) {
      throw new Error(
        `Cleanup verification failed: expected exactly 1 user, found ${remainingUsers.length}.`,
      );
    }

    if (remainingUsers[0].id !== admin.id) {
      throw new Error(
        "Cleanup verification failed: preserved user is not the original Super User.",
      );
    }

    // ============================================================
    // 22. VERIFY NO TENANTS
    // ============================================================

    const remainingTenants = await tx
      .select({ id: schema.tenants.id })
      .from(schema.tenants);

    if (remainingTenants.length !== 0) {
      throw new Error(
        `Cleanup verification failed: ${remainingTenants.length} tenants remain.`,
      );
    }

    // ============================================================
    // 23. VERIFY NO FACILITIES
    // ============================================================

    const remainingFacilities = await tx
      .select({ id: schema.facilities.id })
      .from(schema.facilities);

    if (remainingFacilities.length !== 0) {
      throw new Error(
        `Cleanup verification failed: ${remainingFacilities.length} facilities remain.`,
      );
    }

    // ============================================================
    // 24. VERIFY NO PATIENTS
    // ============================================================

    const remainingPatients = await tx
      .select({ id: schema.patients.id })
      .from(schema.patients);

    if (remainingPatients.length !== 0) {
      throw new Error(
        `Cleanup verification failed: ${remainingPatients.length} patients remain.`,
      );
    }

    // ============================================================
    // SUCCESS
    // ============================================================

    console.log("");
    console.log("==============================================");
    console.log(" CLEANUP COMPLETED SUCCESSFULLY");
    console.log("==============================================");
    console.log("");
    console.log("Preserved:");
    console.log(`  Super User: ${admin.username}`);
    console.log(`  Email:      ${admin.email}`);
    console.log("  Role:       SUPER_ADMIN");
    console.log("");
    console.log("Removed:");
    console.log("  Demo tenants");
    console.log("  Demo facilities");
    console.log("  Demo patients");
    console.log("  Demo practitioners");
    console.log("  Demo clinical records");
    console.log("  Demo billing data");
    console.log("  Demo inventory");
    console.log("  Demo insurance");
    console.log("  Demo public health data");
    console.log("  Demo users");
    console.log("  Old audit logs");
    console.log("");
  });
}

cleanDatabase()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("");
    console.error("==============================================");
    console.error(" DATABASE CLEANUP FAILED");
    console.error("==============================================");
    console.error(error);
    console.error("");
    console.error(
      "Because the cleanup runs inside a transaction, PostgreSQL should have rolled back the changes.",
    );
    process.exit(1);
  });