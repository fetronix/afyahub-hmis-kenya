import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { STAFF_ROLE_CATALOGUE } from '../../auth/staff-role-catalogue.ts';
import { FACILITY_ADMIN_PERMISSION_CODES } from '../../routes/platform/tenants.routes.ts';
import { createMockDbState } from './support/drizzle-mock.ts';
import {
  TOKENS,
  httpJson,
  resolveMockAuthContext,
  resolveMockSession,
  startTestServer,
} from './support/http-harness.ts';

const mockDb = vi.hoisted(() => ({ state: null as ReturnType<typeof createMockDbState> | null }));

const authServiceMocks = vi.hoisted(() => ({
  validateSession: vi.fn(),
}));

const authzServiceMocks = vi.hoisted(() => ({
  loadAuthorizationContext: vi.fn(),
}));

const auditSpy = vi.hoisted(() => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../db/index.ts', async () => {
  const { createMockDbState: make } = await import('./support/drizzle-mock.ts');
  mockDb.state = make();
  return {
    db: mockDb.state.executor,
    pool: { query: vi.fn() },
  };
});

vi.mock('../../auth/auth.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/auth.service')>();
  return {
    ...actual,
    validateSession: authServiceMocks.validateSession,
  };
});

vi.mock('../../auth/authorization.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/authorization.service')>();
  return {
    ...actual,
    loadAuthorizationContext: authzServiceMocks.loadAuthorizationContext,
  };
});

vi.mock('../../db/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/queries.ts')>();
  return {
    ...actual,
    logAuditEvent: auditSpy.logAuditEvent,
  };
});

const { createApp } = await import('../../app.ts');

describe('HTTP Integration: Platform Administration, Tenant/Facility Isolation, Invitations & RBAC', () => {
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_BASE_URL = 'https://hmis.nyeri.example.test';
    const app = await createApp();
    const started = await startTestServer(app);
    baseUrl = started.baseUrl;
    closeServer = started.close;
  });

  afterAll(async () => {
    await closeServer();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.state?.reset();
    authServiceMocks.validateSession.mockImplementation(async (token: string) =>
      resolveMockSession(token),
    );
    authzServiceMocks.loadAuthorizationContext.mockImplementation(async (userId: number) =>
      resolveMockAuthContext(userId),
    );
  });

  it('enforces authentication (401) and super-admin authorization (403) before body validation on /api/platform/tenants', async () => {
    const unauth = await httpJson(baseUrl, 'POST', '/api/platform/tenants', {
      body: {},
    });
    expect(unauth.status).toBe(401);

    // Facility admin receives 403 FORBIDDEN even when sending an invalid body (AuthZ runs before Zod!)
    const forbidden = await httpJson(baseUrl, 'POST', '/api/platform/tenants', {
      token: TOKENS.facilityAdminA,
      body: {},
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe('FORBIDDEN');

    // Super admin with invalid body receives 400 VALIDATION_ERROR
    const invalidBody = await httpJson(baseUrl, 'POST', '/api/platform/tenants', {
      token: TOKENS.superAdmin,
      body: { name: '', slug: 'BAD SLUG!!' },
    });
    expect(invalidBody.status).toBe(400);
    expect(invalidBody.body).toMatchObject({
      success: false,
      error: 'VALIDATION_ERROR',
    });
  });

  it('provisions tenant + roles + audit log on POST /api/platform/tenants and handles PATCH, 404, 409, and safe 500s', async () => {
    // A tenant created after seeding receives the same limited onboarding grants,
    // without automatically acquiring finance or platform-wide hub permissions.
    expect(FACILITY_ADMIN_PERMISSION_CODES).toEqual(
      expect.arrayContaining([
        'insurance.sha.read',
        'insurance.private.claims.prepare',
        'payment_hub.facility.manage',
        'payment_hub.credentials.manage',
        'payment_hub.production.request',
      ]),
    );
    expect(FACILITY_ADMIN_PERMISSION_CODES).not.toContain('payment_hub.transactions.read');
    expect(FACILITY_ADMIN_PERMISSION_CODES).not.toContain('payment_hub.global.manage');

    const allPermCodes = [
      ...new Set([
        ...FACILITY_ADMIN_PERMISSION_CODES,
        ...STAFF_ROLE_CATALOGUE.flatMap((r) => [...r.permissions]),
      ]),
    ];
    const permRows = allPermCodes.map((code, idx) => ({ id: idx + 1, code }));

    mockDb.state!.queueInsert(
      [{ id: 5, name: 'Mt Kenya Health', slug: 'mt-kenya-health' }],
      [{ id: 50 }], // FACILITY_ADMIN role
      [], // FACILITY_ADMIN rolePermissions
      ...STAFF_ROLE_CATALOGUE.flatMap((_, idx) => [[{ id: 60 + idx }], []]),
    );
    mockDb.state!.queueSelect(permRows, permRows);

    const created = await httpJson(baseUrl, 'POST', '/api/platform/tenants', {
      token: TOKENS.superAdmin,
      body: {
        name: 'Mt Kenya Health',
        contactEmail: 'ops@mtkenya.example.test',
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      id: 5,
      name: 'Mt Kenya Health',
      slug: 'mt-kenya-health',
    });
    expect(auditSpy.logAuditEvent).toHaveBeenCalledWith(
      5,
      null,
      '1',
      'CREATE',
      'TENANT',
      '5',
      expect.stringContaining('Created tenant "Mt Kenya Health"'),
    );

    // Unique slug conflict -> 409 CONFLICT
    const dupErr = Object.assign(new Error('duplicate key value'), { code: '23505' });
    mockDb.state!.throwOnce(dupErr);
    const conflict = await httpJson(baseUrl, 'POST', '/api/platform/tenants', {
      token: TOKENS.superAdmin,
      body: { name: 'Mt Kenya Health' },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('CONFLICT');

    // PATCH /api/platform/tenants/:id -> 404 when missing, 200 + audit log when updated
    mockDb.state!.queueUpdate([]);
    const missingPatch = await httpJson(baseUrl, 'PATCH', '/api/platform/tenants/999', {
      token: TOKENS.superAdmin,
      body: { isActive: false },
    });
    expect(missingPatch.status).toBe(404);

    mockDb.state!.queueUpdate([{ id: 5, name: 'Mt Kenya Health', isActive: false }]);
    const okPatch = await httpJson(baseUrl, 'PATCH', '/api/platform/tenants/5', {
      token: TOKENS.superAdmin,
      body: { isActive: false },
    });
    expect(okPatch.status).toBe(200);
    expect(auditSpy.logAuditEvent).toHaveBeenLastCalledWith(
      5,
      null,
      '1',
      'UPDATE',
      'TENANT',
      '5',
      expect.stringContaining('isActive'),
    );

    // Unexpected DB error -> 500 without leaking raw SQL
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDb.state!.throwOnce(new Error('SELECT * FROM tenants -- secret_pg_password'));
    const safe500 = await httpJson(baseUrl, 'PATCH', '/api/platform/tenants/5', {
      token: TOKENS.superAdmin,
      body: { name: 'Crash Test' },
    });
    errSpy.mockRestore();
    expect(safe500.status).toBe(500);
    expect(JSON.stringify(safe500.body)).not.toContain('secret_pg_password');
    expect(JSON.stringify(safe500.body)).not.toContain('SELECT');
  });

  it('exercises facility create, location validation, onboarding lifecycle, and tenant-reassignment block', async () => {
    // Mismatched county/subCounty -> 400 VALIDATION_ERROR
    const badLoc = await httpJson(baseUrl, 'POST', '/api/platform/facilities', {
      token: TOKENS.superAdmin,
      body: {
        tenantId: 1,
        code: 'NYR-01',
        name: 'Nyeri Outpatient',
        county: 'Nyeri',
        subCounty: 'Westlands',
      },
    });
    expect(badLoc.status).toBe(400);
    expect(badLoc.body.error).toBe('VALIDATION_ERROR');

    // Tenant not found -> 404 TENANT_NOT_FOUND
    mockDb.state!.queueSelect([]);
    const noTenant = await httpJson(baseUrl, 'POST', '/api/platform/facilities', {
      token: TOKENS.superAdmin,
      body: { tenantId: 404, code: 'NYR-01', name: 'Nyeri Outpatient' },
    });
    expect(noTenant.status).toBe(404);
    expect(noTenant.body.error).toBe('TENANT_NOT_FOUND');

    // Inactive tenant -> 409 TENANT_INACTIVE
    mockDb.state!.queueSelect([{ id: 1, isActive: false }]);
    const inactiveTenant = await httpJson(baseUrl, 'POST', '/api/platform/facilities', {
      token: TOKENS.superAdmin,
      body: { tenantId: 1, code: 'NYR-01', name: 'Nyeri Outpatient' },
    });
    expect(inactiveTenant.status).toBe(409);
    expect(inactiveTenant.body.error).toBe('TENANT_INACTIVE');

    // Valid facility create -> 201 + PROSPECT onboarding + audit log
    mockDb.state!.queueSelect([{ id: 1, isActive: true }]);
    mockDb.state!.queueInsert(
      [{ id: 12, tenantId: 1, code: 'NYR-01', name: 'Nyeri Outpatient', county: 'Nyeri' }],
      [{ id: 1, tenantId: 1, facilityId: 12, status: 'PROSPECT' }],
    );
    const created = await httpJson(baseUrl, 'POST', '/api/platform/facilities', {
      token: TOKENS.superAdmin,
      body: {
        tenantId: 1,
        code: 'nyr-01',
        name: 'Nyeri Outpatient',
        county: 'Nyeri',
        subCounty: 'Nyeri Town',
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.facility.code).toBe('NYR-01');
    expect(created.body.data.onboarding.status).toBe('PROSPECT');
    expect(auditSpy.logAuditEvent).toHaveBeenCalledWith(
      1,
      12,
      '1',
      'CREATE',
      'FACILITY',
      '12',
      expect.stringContaining('PROSPECT'),
    );

    // GET & POST /api/platform/facilities/:id/onboarding
    mockDb.state!.queueSelect(
      [{ id: 12, tenantId: 1, name: 'Nyeri Outpatient' }],
      [{ id: 1, facilityId: 12, status: 'PROSPECT' }],
    );
    const getOnb = await httpJson(baseUrl, 'GET', '/api/platform/facilities/12/onboarding', {
      token: TOKENS.superAdmin,
    });
    expect(getOnb.status).toBe(200);

    mockDb.state!.queueSelect([{ id: 12, tenantId: 1, name: 'Nyeri Outpatient' }], [{ id: 1 }]);
    const dupOnb = await httpJson(baseUrl, 'POST', '/api/platform/facilities/12/onboarding', {
      token: TOKENS.superAdmin,
    });
    expect(dupOnb.status).toBe(409);
    expect(dupOnb.body.error).toBe('ONBOARDING_EXISTS');

    // PATCH /api/platform/facilities/:id blocks tenantId reassignment
    const reassign = await httpJson(baseUrl, 'PATCH', '/api/platform/facilities/12', {
      token: TOKENS.superAdmin,
      body: { tenantId: 2, name: 'Moved Facility' },
    });
    expect(reassign.status).toBe(400);
    expect(reassign.body.error).toBe('VALIDATION_ERROR');

    // Unknown IDs and clinical protocol mutations cannot be smuggled into module configuration.
    const unknown = await httpJson(baseUrl, 'PATCH', '/api/platform/facilities/12', {
      token: TOKENS.superAdmin,
      body: { enabledModules: ['clinical'] },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toMatchObject({ error: 'UNKNOWN_MODULE', modules: ['clinical'] });

    const clinicalProtocols = await httpJson(baseUrl, 'PATCH', '/api/platform/facilities/12', {
      token: TOKENS.superAdmin,
      body: { name: 'Facility', clinicalProtocols: { dialysis: {} } },
    });
    expect(clinicalProtocols.status).toBe(400);

    // Valid facility PATCH -> normalized modules and an audit record in the same transaction.
    mockDb.state!.queueUpdate([
      {
        id: 12,
        tenantId: 1,
        name: 'Nyeri Outpatient Centre',
        enabledModules: ['opd', 'finance', 'configuration'],
        hiddenModules: ['dialysis'],
      },
    ]);
    const patched = await httpJson(baseUrl, 'PATCH', '/api/platform/facilities/12', {
      token: TOKENS.superAdmin,
      body: {
        name: 'Nyeri Outpatient Centre',
        enabledModules: ['opd', 'finance'],
        hiddenModules: ['dialysis', 'dialysis'],
      },
    });
    expect(patched.status).toBe(200);
    expect(mockDb.state!.calls).toContainEqual({
      op: 'update',
      values: expect.objectContaining({
        enabledModules: expect.arrayContaining(['opd', 'finance', 'configuration']),
        hiddenModules: ['dialysis'],
      }),
    });
    const audit = mockDb.state!.calls.find(
      (call) => call.op === 'insert' && (call.values as any)?.resource === 'FACILITY',
    );
    expect(audit?.values).toMatchObject({
      tenantId: 1,
      facilityId: 12,
      userId: '1',
      action: 'UPDATE',
      resourceId: '12',
    });
    expect(JSON.parse((audit!.values as any).details)).toMatchObject({
      enabledModules: expect.arrayContaining(['opd', 'finance']),
      hiddenModules: ['dialysis'],
    });
  });

  it('manages facility-admin invitations (create, list without token hashes, revoke, reissue)', async () => {
    // Create invitation -> 201 + audit log
    mockDb.state!.queueSelect(
      [{ id: 10, tenantId: 1, name: 'Nyeri County Hospital', isActive: true, tenantActive: true }],
      [{ id: 50 }], // FACILITY_ADMIN role
      [{ id: 500 }], // rolePermission check
      [], // no pending invitation
    );
    mockDb.state!.queueInsert([
      {
        id: 88,
        email: 'lead@nyeri.example.test',
        expiresAt: new Date('2026-10-30T08:00:00.000Z'),
      },
    ]);

    const created = await httpJson(baseUrl, 'POST', '/api/platform/facility-admin-invitations', {
      token: TOKENS.superAdmin,
      body: {
        facilityId: 10,
        fullName: 'Dr. Muthoni',
        email: 'LEAD@NYERI.EXAMPLE.TEST',
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.invitationLink).toContain(
      'https://hmis.nyeri.example.test/accept-facility-admin-invitation?token=',
    );
    expect(auditSpy.logAuditEvent).toHaveBeenCalledWith(
      1,
      10,
      '1',
      'CREATE',
      'FACILITY_ADMIN_INVITATION',
      '88',
      expect.stringContaining('lead@nyeri.example.test'),
    );

    // List invitations derives status and omits hashes
    mockDb.state!.queueSelect([
      {
        id: 88,
        tenantId: 1,
        tenantName: 'Nyeri',
        facilityId: 10,
        facilityName: 'Nyeri Hospital',
        email: 'lead@nyeri.example.test',
        fullName: 'Dr. Muthoni',
        createdAt: new Date('2026-10-28T07:00:00.000Z'),
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        acceptedAt: null,
        acceptedUserId: null,
        revokedAt: null,
      },
    ]);
    const list = await httpJson(baseUrl, 'GET', '/api/platform/facility-admin-invitations', {
      token: TOKENS.superAdmin,
    });
    expect(list.status).toBe(200);
    expect(list.body.data[0].status).toBe('PENDING');
    expect(list.body.data[0].invitationTokenHash).toBeUndefined();

    // Reissue preserves an application sub-path as well as validation and audit behavior.
    vi.stubEnv('APP_BASE_URL', 'https://hmis.nyeri.example.test/hmis/');
    mockDb.state!.queueSelect([
      { id: 88, acceptedAt: null, revokedAt: null, email: 'lead@nyeri.example.test' },
    ]);
    mockDb.state!.queueUpdate([
      {
        id: 88,
        tenantId: 1,
        facilityId: 10,
        email: 'lead@nyeri.example.test',
        fullName: 'Dr. Muthoni',
        expiresAt: new Date('2026-10-30T10:00:00.000Z'),
      },
    ]);
    const reissued = await httpJson(
      baseUrl,
      'POST',
      '/api/platform/facility-admin-invitations/88/reissue',
      { token: TOKENS.superAdmin },
    );
    expect(reissued.status).toBe(200);
    expect(reissued.body.data.invitationLink).toContain(
      'https://hmis.nyeri.example.test/hmis/accept-facility-admin-invitation?token=',
    );
    vi.unstubAllEnvs();

    mockDb.state!.queueUpdate([
      { id: 88, tenantId: 1, facilityId: 10, email: 'lead@nyeri.example.test' },
    ]);
    const revoked = await httpJson(
      baseUrl,
      'POST',
      '/api/platform/facility-admin-invitations/88/revoke',
      { token: TOKENS.superAdmin },
    );
    expect(revoked.status).toBe(200);
    expect(auditSpy.logAuditEvent).toHaveBeenLastCalledWith(
      1,
      10,
      '1',
      'REVOKE',
      'FACILITY_ADMIN_INVITATION',
      '88',
      expect.stringContaining('Revoked'),
    );
  });

  it('enforces facility RBAC scope boundaries, self-role-edit block, privileged-permission block, and HIGH audit logging', async () => {
    // Non-admin staff member is refused with 403
    const recepDenied = await httpJson(baseUrl, 'GET', '/api/platform/rbac/roles?facilityId=10', {
      token: TOKENS.receptionistA,
    });
    expect(recepDenied.status).toBe(403);

    // Facility A admin requesting Facility B (id 20) -> 403 FACILITY_OUT_OF_SCOPE
    mockDb.state!.queueSelect([{ id: 20, tenantId: 1, name: 'Othaya Hospital' }]);
    const crossFacility = await httpJson(baseUrl, 'GET', '/api/platform/rbac/roles?facilityId=20', {
      token: TOKENS.facilityAdminA,
    });
    expect(crossFacility.status).toBe(403);
    expect(crossFacility.body.error).toBe('FACILITY_OUT_OF_SCOPE');

    // Facility A admin requesting Tenant 2 facility (id 99) -> 403 FACILITY_OUT_OF_SCOPE
    mockDb.state!.queueSelect([{ id: 99, tenantId: 2, name: 'Kisumu Hospital' }]);
    const crossTenant = await httpJson(baseUrl, 'GET', '/api/platform/rbac/roles?facilityId=99', {
      token: TOKENS.facilityAdminA,
    });
    expect(crossTenant.status).toBe(403);
    expect(crossTenant.body.error).toBe('FACILITY_OUT_OF_SCOPE');

    // Facility A admin editing a role assigned to their own account -> 403 SELF_ROLE_MODIFICATION_BLOCKED
    mockDb.state!.queueSelect(
      [{ id: 10, tenantId: 1, name: 'Nyeri Hospital' }],
      [{ id: 7, tenantId: 1, name: 'NURSE', isSystem: false, isActive: true }],
      [{ id: 901 }], // selfAssignment exists!
    );
    const selfEdit = await httpJson(baseUrl, 'PUT', '/api/platform/rbac/roles/7/permissions', {
      token: TOKENS.facilityAdminA,
      body: { facilityId: 10, permissionIds: [1] },
    });
    expect(selfEdit.status).toBe(403);
    expect(selfEdit.body.error).toBe('SELF_ROLE_MODIFICATION_BLOCKED');

    // Facility A admin attempting to grant privileged permission (`platform.manage`) -> 403 PRIVILEGED_PERMISSION_BLOCKED
    mockDb.state!.queueSelect(
      [{ id: 10, tenantId: 1, name: 'Nyeri Hospital' }],
      [{ id: 7, tenantId: 1, name: 'NURSE', isSystem: false, isActive: true }],
      [], // not self-assigned
      [{ id: 99, code: 'platform.manage', module: 'platform' }],
    );
    const privEsc = await httpJson(baseUrl, 'PUT', '/api/platform/rbac/roles/7/permissions', {
      token: TOKENS.facilityAdminA,
      body: { facilityId: 10, permissionIds: [99] },
    });
    expect(privEsc.status).toBe(403);
    expect(privEsc.body.error).toBe('PRIVILEGED_PERMISSION_BLOCKED');

    // Valid facility override save -> 200 + writes HIGH-severity audit_logs entry inside transaction
    mockDb.state!.queueSelect(
      [{ id: 10, tenantId: 1, name: 'Nyeri Hospital' }],
      [{ id: 7, tenantId: 1, name: 'NURSE', isSystem: false, isActive: true }],
      [], // not self-assigned
      [
        { id: 1, code: 'patients.read', module: 'patients' },
        { id: 2, code: 'clinical.read', module: 'clinical' },
      ],
      [], // no existing override
    );
    mockDb.state!.queueInsert(
      [{ id: 301 }], // created override
      [], // override permission links
      [], // auditLogs insert
    );

    const saved = await httpJson(baseUrl, 'PUT', '/api/platform/rbac/roles/7/permissions', {
      token: TOKENS.facilityAdminA,
      body: { facilityId: 10, permissionIds: [1, 2] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      success: true,
      data: {
        facilityId: 10,
        roleId: 7,
        permissionCodes: ['patients.read', 'clinical.read'],
        hasFacilityOverride: true,
      },
    });

    const auditInsert = mockDb.state!.calls.find(
      (c) =>
        c.op === 'insert' &&
        typeof c.values === 'object' &&
        c.values !== null &&
        (c.values as any).resource === 'facility_role_permission_override',
    );
    expect(auditInsert).toBeDefined();
    expect((auditInsert!.values as any).severity).toBe('HIGH');
  });
});
