import 'dotenv/config';
import crypto from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createApp } from '../../app.ts';
import { STAFF_ROLE_CATALOGUE } from '../../auth/staff-role-catalogue.ts';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { FACILITY_ADMIN_PERMISSION_CODES } from '../../routes/platform/tenants.routes.ts';
import { hashPassword } from '../../utils/password.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('End-to-End HTTP + PostgreSQL Integration (Auth, Platform, Tenancy & Audit)', () => {
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const superUsername = `e2e_super_${suffix}`;
  const facilityUsername = `e2e_fac_${suffix}`;
  const password = 'E2eValidPassword2026!';

  let superUserId: number | null = null;
  let facilityUserId: number | null = null;
  let superRoleId: number | null = null;
  const createdTenantIds: number[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_URL = 'https://hmis.e2e.example.test';

    // Ensure required permission catalogue codes exist for tenant provisioning
    const requiredCodes = [
      ...new Set([
        ...FACILITY_ADMIN_PERMISSION_CODES,
        ...STAFF_ROLE_CATALOGUE.flatMap((role) => [...role.permissions]),
      ]),
    ];

    for (const code of requiredCodes) {
      const moduleName = code.split('.')[0] ?? 'general';
      await db
        .insert(schema.permissions)
        .values({
          code,
          name: code,
          module: moduleName,
          description: `Seeded by E2E integration test (${code})`,
        })
        .onConflictDoNothing();
    }

    // Ensure global SUPER_ADMIN system role exists
    const [existingSuperRole] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(
        and(
          eq(schema.roles.name, 'SUPER_ADMIN'),
          isNull(schema.roles.tenantId),
          eq(schema.roles.isActive, true),
        ),
      )
      .limit(1);

    if (existingSuperRole) {
      superRoleId = existingSuperRole.id;
    } else {
      const [insertedRole] = await db
        .insert(schema.roles)
        .values({
          tenantId: null,
          name: 'SUPER_ADMIN',
          description: 'Platform super administrator',
          isSystem: true,
          isActive: true,
        })
        .returning({ id: schema.roles.id });
      superRoleId = insertedRole.id;
    }

    const [createdSuper] = await db
      .insert(schema.users)
      .values({
        uid: `usr_e2e_super_${suffix}`,
        tenantId: null,
        facilityId: null,
        username: superUsername,
        email: `${superUsername}@e2e.jalicare.local`,
        fullName: 'E2E Super Admin',
        passwordHash: await hashPassword(password),
        accountStatus: 'ACTIVE',
        isActive: true,
        mustChangePassword: false,
        mfaEnabled: false,
        mfaRequired: false,
      })
      .returning({ id: schema.users.id });

    superUserId = createdSuper.id;

    await db.insert(schema.userRoles).values({
      userId: superUserId,
      roleId: superRoleId,
      assignedBy: 'system',
      isActive: true,
    });

    const app = await createApp();
    const started = await startTestServer(app);
    baseUrl = started.baseUrl;
    closeServer = started.close;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }

    if (facilityUserId) {
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, facilityUserId));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, facilityUserId));
      await db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.userId, facilityUserId));
      await db
        .delete(schema.loginAttempts)
        .where(eq(schema.loginAttempts.usernameOrEmail, facilityUsername));
      await db.delete(schema.users).where(eq(schema.users.id, facilityUserId));
    }

    if (superUserId) {
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, superUserId));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, superUserId));
      await db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.userId, superUserId));
      await db
        .delete(schema.loginAttempts)
        .where(eq(schema.loginAttempts.usernameOrEmail, superUsername));
      await db.delete(schema.users).where(eq(schema.users.id, superUserId));
    }

    // Note: audit_logs is protected by the PostgreSQL append-only trigger
    // (0017_consent_allergy_audit_integrity) and has no FK to tenants/facilities.
    if (createdTenantIds.length > 0) {
      await db
        .delete(schema.facilityOnboarding)
        .where(inArray(schema.facilityOnboarding.tenantId, createdTenantIds));
      const tenantRoles = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(inArray(schema.roles.tenantId, createdTenantIds));
      if (tenantRoles.length > 0) {
        await db.delete(schema.rolePermissions).where(
          inArray(
            schema.rolePermissions.roleId,
            tenantRoles.map((r) => r.id),
          ),
        );
        await db.delete(schema.roles).where(inArray(schema.roles.tenantId, createdTenantIds));
      }
      await db
        .delete(schema.facilities)
        .where(inArray(schema.facilities.tenantId, createdTenantIds));
      await db.delete(schema.tenants).where(inArray(schema.tenants.id, createdTenantIds));
    }
  });

  it('authenticates via HTTP, provisions a tenant & two facilities, enforces facility boundaries, and records audit logs', async () => {
    // 1. Health check
    const health = await httpJson(baseUrl, 'GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('healthy');

    // 2. Login with wrong password -> 401; login with valid password -> 200 + sessionToken
    const badLogin = await httpJson(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: superUsername, password: 'WrongPassword2026!' },
    });
    expect(badLogin.status).toBe(401);

    const okLogin = await httpJson(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: superUsername, password },
    });
    expect(okLogin.status).toBe(200);
    const superToken = okLogin.body.sessionToken as string;
    expect(superToken).toHaveLength(64);

    // 3. Create tenant via POST /api/platform/tenants
    const tenantRes = await httpJson(baseUrl, 'POST', '/api/platform/tenants', {
      token: superToken,
      body: {
        name: `E2E County Network ${suffix}`,
        slug: `e2e-network-${suffix}`,
        contactEmail: `ops-${suffix}@e2e.jalicare.local`,
      },
    });
    expect(tenantRes.status).toBe(201);
    const tenantId = tenantRes.body.data.id as number;
    createdTenantIds.push(tenantId);

    // 4. Create two facilities under that tenant
    const facARes = await httpJson(baseUrl, 'POST', '/api/platform/facilities', {
      token: superToken,
      body: {
        tenantId,
        code: `E2EA-${suffix.slice(0, 6)}`,
        name: 'E2E Facility Alpha',
        county: 'Nyeri',
        subCounty: 'Nyeri Town',
      },
    });
    expect(facARes.status).toBe(201);
    const facilityAId = facARes.body.data.facility.id as number;

    const facBRes = await httpJson(baseUrl, 'POST', '/api/platform/facilities', {
      token: superToken,
      body: {
        tenantId,
        code: `E2EB-${suffix.slice(0, 6)}`,
        name: 'E2E Facility Beta',
        county: 'Nyeri',
        subCounty: 'Othaya',
      },
    });
    expect(facBRes.status).toBe(201);
    const facilityBId = facBRes.body.data.facility.id as number;

    // 5. Provision a Facility A administrator user and verify cross-facility isolation
    const [facAdminRole] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.name, 'FACILITY_ADMIN')))
      .limit(1);

    const [createdFacUser] = await db
      .insert(schema.users)
      .values({
        uid: `usr_e2e_fac_${suffix}`,
        tenantId,
        facilityId: facilityAId,
        username: facilityUsername,
        email: `${facilityUsername}@e2e.jalicare.local`,
        fullName: 'E2E Facility A Admin',
        passwordHash: await hashPassword(password),
        accountStatus: 'ACTIVE',
        isActive: true,
        mustChangePassword: false,
        mfaEnabled: false,
        mfaRequired: false,
      })
      .returning({ id: schema.users.id });
    facilityUserId = createdFacUser.id;

    await db.insert(schema.userRoles).values({
      userId: facilityUserId,
      roleId: facAdminRole.id,
      assignedBy: String(superUserId),
      isActive: true,
    });

    const facLogin = await httpJson(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: facilityUsername, password },
    });
    expect(facLogin.status).toBe(200);
    const facToken = facLogin.body.sessionToken as string;

    // Facility A admin cannot create platform tenants (403)
    const tenantAttempt = await httpJson(baseUrl, 'POST', '/api/platform/tenants', {
      token: facToken,
      body: { name: 'Unauthorized Tenant' },
    });
    expect(tenantAttempt.status).toBe(403);

    // Facility A admin can view RBAC for Facility A (200)
    const ownRbac = await httpJson(
      baseUrl,
      'GET',
      `/api/platform/rbac/roles?facilityId=${facilityAId}`,
      { token: facToken },
    );
    expect(ownRbac.status).toBe(200);

    // Facility A admin CANNOT view RBAC for Facility B (403 FACILITY_OUT_OF_SCOPE)
    const crossFacRbac = await httpJson(
      baseUrl,
      'GET',
      `/api/platform/rbac/roles?facilityId=${facilityBId}`,
      { token: facToken },
    );
    expect(crossFacRbac.status).toBe(403);
    expect(crossFacRbac.body.error).toBe('FACILITY_OUT_OF_SCOPE');

    // Verify real audit_logs rows exist for TENANT and FACILITY creation
    // and that the append-only PostgreSQL trigger blocks deletion
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.tenantId, tenantId));
    expect(audits.some((a) => a.resource === 'TENANT' && a.action === 'CREATE')).toBe(true);
    expect(audits.some((a) => a.resource === 'FACILITY' && a.action === 'CREATE')).toBe(true);

    await expect(
      db.delete(schema.auditLogs).where(eq(schema.auditLogs.tenantId, tenantId)),
    ).rejects.toThrow(/append-only/i);
  });
});
