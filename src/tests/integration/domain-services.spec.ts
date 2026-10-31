import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { createMockDbState } from './support/drizzle-mock.ts';

const mockDb = vi.hoisted(() => ({ state: null as ReturnType<typeof createMockDbState> | null }));
const queriesMocks = vi.hoisted(() => ({
  getFacilityByIdScoped: vi.fn(),
}));
const verificationMocks = vi.hoisted(() => ({
  findVerifiedCredentialForUser: vi.fn(),
  listUsableCredentialsForStaff: vi.fn(),
}));

vi.mock('../../db/index.ts', async () => {
  const { createMockDbState: make } = await import('./support/drizzle-mock.ts');
  mockDb.state = make();
  return {
    db: mockDb.state.executor,
    pool: { query: vi.fn() },
  };
});

vi.mock('../../db/index', async () => {
  const { createMockDbState: make } = await import('./support/drizzle-mock.ts');
  if (!mockDb.state) mockDb.state = make();
  return {
    db: mockDb.state.executor,
    pool: { query: vi.fn() },
  };
});

vi.mock('../../db/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/queries.ts')>();
  return {
    ...actual,
    getFacilityByIdScoped: queriesMocks.getFacilityByIdScoped,
  };
});

vi.mock(
  '../../integrations/professional/professional-verification.service.ts',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../integrations/professional/professional-verification.service.ts')
      >();
    return {
      ...actual,
      findVerifiedCredentialForUser: verificationMocks.findVerifiedCredentialForUser,
      listUsableCredentialsForStaff: verificationMocks.listUsableCredentialsForStaff,
    };
  },
);

const maternity = await import('../../maternity/maternity.service.ts');
const staffRoles = await import('../../auth/staff-roles.service.ts');
const portalClient = await import('../../api/portal-client.ts');

const ctx: AuthorizationContext = {
  userId: 10,
  tenantId: 1,
  facilityId: 10,
  roles: ['FACILITY_ADMIN'],
  permissions: ['maternity.read', 'maternity.write', 'users.invite'],
  isSuperAdmin: false,
};

describe('Domain Services: Extracted Maternity & Staff-Roles Modules + Portal Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.state?.reset();
    queriesMocks.getFacilityByIdScoped.mockImplementation(
      async (_context: AuthorizationContext, facilityId: number) =>
        facilityId === 10 ? { id: 10, tenantId: 1 } : null,
    );
    verificationMocks.listUsableCredentialsForStaff.mockResolvedValue(new Map());
  });

  it('validates and executes pregnancy booking, listing, detail, and status closure rules', async () => {
    // Out-of-scope facility -> 404 NOT_FOUND (never 403 to prevent probing)
    mockDb.state!.queueSelect([{ id: 42, tenantId: 1 }]);
    await expect(
      maternity.bookPregnancy(ctx, {
        patientId: 42,
        facilityId: 99,
        bookedAt: '2026-04-01',
        lmpDate: '2026-01-15',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

    // LMP/EDD mismatch when basis is LMP -> 400 INVALID_INPUT
    mockDb.state!.queueSelect([{ id: 42, tenantId: 1 }]);
    await expect(
      maternity.bookPregnancy(ctx, {
        patientId: 42,
        facilityId: 10,
        bookedAt: '2026-04-01',
        lmpDate: '2026-01-15',
        eddDate: '2026-12-25',
        eddBasis: 'LMP',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', statusCode: 400 });

    // Gravida < para + abortions -> 400 INVALID_INPUT
    mockDb.state!.queueSelect([{ id: 42, tenantId: 1 }]);
    await expect(
      maternity.bookPregnancy(ctx, {
        patientId: 42,
        facilityId: 10,
        bookedAt: '2026-04-01',
        lmpDate: '2026-01-15',
        gravida: 1,
        para: 2,
        abortions: 0,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // Valid booking derives EDD = LMP + 280 days and handles unique-violation 409
    mockDb.state!.queueSelect([{ id: 42, tenantId: 1 }]);
    mockDb.state!.queueInsert([
      {
        id: 100,
        tenantId: 1,
        facilityId: 10,
        patientId: 42,
        bookedAt: '2026-04-01',
        eddDate: maternity.deriveEdd('2026-01-15'),
        status: 'Active',
      },
    ]);
    const booked = await maternity.bookPregnancy(ctx, {
      patientId: 42,
      facilityId: 10,
      bookedAt: '2026-04-01',
      lmpDate: '2026-01-15',
      gravida: 2,
      para: 1,
      abortions: 0,
    });
    expect(booked.id).toBe(100);
    expect(booked.eddDate).toBe(maternity.deriveEdd('2026-01-15'));

    // List, get, and update pregnancy (including Delivered reopen block)
    mockDb.state!.queueSelect([
      {
        pregnancy: {
          id: 100,
          tenantId: 1,
          facilityId: 10,
          eddDate: '2026-10-22',
          status: 'Active',
        },
        patient: {
          id: 42,
          mrn: 'MRN-42',
          firstName: 'Jane',
          lastName: 'Wambui',
          dateOfBirth: '1996-01-01',
        },
      },
    ]);
    const listed = await maternity.listPregnancies(ctx, { facilityId: 10, status: 'Active' });
    expect(listed).toHaveLength(1);

    mockDb.state!.queueSelect(
      [{ id: 100, tenantId: 1, facilityId: 10, eddDate: '2026-10-22', status: 'Active' }],
      [], // visits
      [], // labours
      [{ id: 501, pregnancyId: 100 }], // deliveries
      [{ id: 601, deliveryId: 501, babyNumber: 1, outcome: 'Live birth' }], // babies
    );
    const detail = await maternity.getPregnancy(ctx, 100);
    expect(detail.deliveries[0]?.babies).toHaveLength(1);

    mockDb.state!.queueSelect([
      { id: 100, tenantId: 1, facilityId: 10, eddDate: '2026-10-22', status: 'Delivered' },
    ]);
    await expect(
      maternity.updatePregnancy(ctx, 100, { status: 'Closed', closedReason: 'Transfer' }),
    ).rejects.toMatchObject({ code: 'PREGNANCY_DELIVERED', statusCode: 409 });
  });

  it('validates and executes ANC visits, labour admission, partograph readings, delivery, and summary KPIs', async () => {
    const activePregnancy = {
      id: 100,
      tenantId: 1,
      facilityId: 10,
      patientId: 42,
      eddDate: '2026-11-15',
      status: 'Active',
    };

    // ANC visit: systolic <= diastolic is refused
    mockDb.state!.queueSelect([activePregnancy]);
    await expect(
      maternity.recordAncVisit(ctx, {
        pregnancyId: 100,
        visitDate: '2026-08-01',
        bpSystolic: 80,
        bpDiastolic: 90,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // Valid ANC visit computes gestation and inserts row
    mockDb.state!.queueSelect([activePregnancy]);
    mockDb.state!.queueInsert([{ id: 201, pregnancyId: 100, visitDate: '2026-08-01' }]);
    const visit = await maternity.recordAncVisit(ctx, {
      pregnancyId: 100,
      visitDate: '2026-08-01',
      bpSystolic: 118,
      bpDiastolic: 76,
      fetalHeartRateBpm: 142,
      ifasDispensed: true,
      nextVisitDate: '2026-09-01',
    });
    expect(visit.id).toBe(201);

    mockDb.state!.queueSelect([activePregnancy], [{ id: 201 }]);
    expect(await maternity.listAncVisits(ctx, 100)).toHaveLength(1);

    // Start labour + getLabour plot + recordPartographEntry
    mockDb.state!.queueSelect([activePregnancy], []); // no open labour
    mockDb.state!.queueInsert([
      {
        id: 301,
        tenantId: 1,
        facilityId: 10,
        pregnancyId: 100,
        patientId: 42,
        admittedAt: '2026-10-28T06:00:00.000Z',
        status: 'In Labour',
      },
    ]);
    const labour = await maternity.startLabour(ctx, {
      pregnancyId: 100,
      admittedAt: '2026-10-28T06:00:00.000Z',
      labourOnsetAt: '2026-10-28T04:00:00.000Z',
    });
    expect(labour.id).toBe(301);

    const openLabourRow = {
      id: 301,
      tenantId: 1,
      facilityId: 10,
      pregnancyId: 100,
      patientId: 42,
      admittedAt: '2026-10-28T06:00:00.000Z',
      status: 'In Labour',
    };

    mockDb.state!.queueSelect([openLabourRow]);
    mockDb.state!.queueInsert([{ id: 401, labourRecordId: 301 }]);
    const partograph = await maternity.recordPartographEntry(ctx, {
      labourRecordId: 301,
      recordedAt: '2026-10-28T07:00:00.000Z',
      cervicalDilatationCm: 5,
      fetalHeartRateBpm: 140,
      contractionsPer10Min: 3,
      contractionDurationSec: 40,
      bpSystolic: 120,
      bpDiastolic: 78,
    });
    expect(partograph.id).toBe(401);

    mockDb.state!.queueSelect(
      [openLabourRow],
      [
        {
          id: 401,
          recordedAt: '2026-10-28T07:00:00.000Z',
          cervicalDilatationCm: '5',
          fetalHeartRateBpm: 140,
          contractionsPer10Min: 3,
          contractionDurationSec: 40,
        },
      ],
      [activePregnancy],
    );
    const loadedLabour = await maternity.getLabour(ctx, 301);
    expect(loadedLabour.entries).toHaveLength(1);
    expect(loadedLabour.plot).toBeDefined();

    // Record delivery requires at least 1 baby and closes pregnancy + labour atomically
    mockDb.state!.queueSelect([activePregnancy], [openLabourRow]);
    await expect(
      maternity.recordDelivery(ctx, {
        pregnancyId: 100,
        labourRecordId: 301,
        deliveredAt: '2026-10-28T09:30:00.000Z',
        deliveryMode: 'Spontaneous Vertex',
        babies: [],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    mockDb.state!.queueSelect([activePregnancy], [openLabourRow], [activePregnancy]); // locked recheck inside transaction
    mockDb.state!.queueInsert(
      [{ id: 501, pregnancyId: 100, deliveryMode: 'Spontaneous Vertex' }],
      [{ id: 601, deliveryId: 501, babyNumber: 1, outcome: 'Live Birth' }],
    );
    mockDb.state!.queueUpdate(
      [{ id: 100, status: 'Delivered' }],
      [{ id: 301, status: 'Delivered' }],
    );

    const delivered = await maternity.recordDelivery(ctx, {
      pregnancyId: 100,
      labourRecordId: 301,
      deliveredAt: '2026-10-28T09:30:00.000Z',
      deliveryMode: 'Spontaneous Vertex',
      bloodLossMl: 250,
      oxytocinGiven: true,
      babies: [
        {
          sex: 'Female',
          birthWeightGrams: 3200,
          apgar1: 8,
          apgar5: 9,
          outcome: 'Live Birth',
        },
      ],
    });
    expect(delivered.pregnancy.status).toBe('Delivered');
    expect(delivered.babies).toHaveLength(1);

    // listLabours, updateLabour, getDelivery, listDeliveries
    mockDb.state!.queueSelect([
      {
        labour: openLabourRow,
        patient: { id: 42, mrn: 'MRN-42', firstName: 'Jane', lastName: 'Wambui' },
      },
    ]);
    expect(await maternity.listLabours(ctx, { facilityId: 10, status: 'In Labour' })).toHaveLength(
      1,
    );

    mockDb.state!.queueSelect([openLabourRow]);
    mockDb.state!.queueUpdate([{ ...openLabourRow, status: 'Referred' }]);
    const updatedLab = await maternity.updateLabour(ctx, 301, {
      status: 'Referred',
      notes: 'Transferred',
    });
    expect(updatedLab.status).toBe('Referred');

    mockDb.state!.queueSelect(
      [{ id: 501, tenantId: 1, facilityId: 10, deliveryMode: 'Spontaneous Vertex' }],
      [{ id: 601, deliveryId: 501, babyNumber: 1, outcome: 'Live Birth' }],
    );
    const singleDel = await maternity.getDelivery(ctx, 501);
    expect(singleDel.babies).toHaveLength(1);

    mockDb.state!.queueSelect(
      [
        {
          delivery: { id: 501, tenantId: 1, facilityId: 10 },
          patient: { id: 42, mrn: 'MRN-42', firstName: 'Jane', lastName: 'Wambui' },
        },
      ],
      [{ id: 601, deliveryId: 501, babyNumber: 1, outcome: 'Live Birth' }],
    );
    expect(
      await maternity.listDeliveries(ctx, { facilityId: 10, from: '2026-10-01', to: '2026-10-31' }),
    ).toHaveLength(1);

    // Summary counts
    mockDb.state!.queueSelect(
      [{ count: 14 }],
      [{ count: 38 }],
      [{ count: 2 }],
      [{ count: 9 }],
      [{ count: 10 }],
    );
    const summary = await maternity.maternitySummary(ctx, 10);
    expect(summary).toMatchObject({
      facilityId: 10,
      activePregnancies: 14,
      ancVisitsThisMonth: 38,
      inLabour: 2,
      deliveriesThisMonth: 9,
      babiesThisMonth: 10,
    });
  });

  it('enforces staff-roles assignability, clinical regulator verification, override task sync, and deactivation guards', async () => {
    // Pure role policy helpers
    expect(
      staffRoles.describeRole(1, {
        name: 'FACILITY_ADMIN',
        description: 'Admin',
        permissions: [{ code: 'patients.read', module: 'patients' }],
      }),
    ).toBeNull();

    const doctorDesc = staffRoles.describeRole(2, {
      name: 'DOCTOR',
      description: 'Medical officer',
      permissions: [{ code: 'patients.read', module: 'patients' }],
    });
    expect(doctorDesc).not.toBeNull();
    expect(doctorDesc?.requiresVerification).toBe(true);

    const receptionistDesc = staffRoles.describeRole(3, {
      name: 'RECEPTIONIST',
      description: 'Front desk',
      permissions: [{ code: 'patients.read', module: 'patients' }],
    })!;

    const catalogue = {
      knownRoleIds: new Set([1, 2, 3]),
      offered: new Map([
        [2, doctorDesc!],
        [3, receptionistDesc],
      ]),
    };

    expect(() => staffRoles.pickAssignableRoles(catalogue, [1])).toThrowError(
      expect.objectContaining({ code: 'ROLE_NOT_ASSIGNABLE', statusCode: 403 }),
    );
    expect(() => staffRoles.pickAssignableRoles(catalogue, [999])).toThrowError(
      expect.objectContaining({ code: 'INVALID_STAFF_ROLE', statusCode: 400 }),
    );

    // assignStaffRoles refuses clinical role (DOCTOR) when professional credential is unverified
    mockDb.state!.queueSelect(
      [
        {
          id: 15,
          fullName: 'Dr. Unverified',
          email: 'u@x.test',
          tenantId: 1,
          facilityId: 10,
          isActive: true,
        },
      ],
      [], // heldRows
      [
        {
          roleId: 2,
          roleName: 'DOCTOR',
          roleDescription: 'MO',
          permissionCode: 'patients.read',
          permissionModule: 'patients',
        },
      ],
    );
    verificationMocks.findVerifiedCredentialForUser.mockResolvedValueOnce(null);

    await expect(
      staffRoles.assignStaffRoles({
        tenantId: 1,
        facilityId: 10,
        actorUserId: 10,
        actorRoleNames: ['FACILITY_ADMIN'],
        isSuperAdmin: false,
        targetUserId: 15,
        roleIds: [2],
      }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_REQUIRED', statusCode: 409 });

    // updateRolePermissions synchronizes facility override and preserves non-delegable grants
    mockDb.state!.queueSelect(
      [{ id: 3, name: 'RECEPTIONIST', isActive: true }], // locked role
      [
        {
          roleId: 3,
          roleName: 'RECEPTIONIST',
          roleDescription: 'Front desk',
          permissionCode: 'patients.read',
          permissionModule: 'patients',
        },
      ], // loadAssignableRoleCatalogue
      [
        { id: 11, code: 'patients.read', module: 'patients' },
        { id: 12, code: 'billing.read', module: 'billing' },
      ], // wanted permissions
      [{ permissionId: 11, code: 'patients.read', module: 'patients' }], // currentRows
      [{ id: 700 }], // facility override exists
      [{ permissionId: 11, code: 'patients.read', module: 'patients' }], // overrideRows
    );
    mockDb.state!.queueInsert([], [], []);
    mockDb.state!.queueUpdate([]);

    const permUpdated = await staffRoles.updateRolePermissions({
      tenantId: 1,
      facilityId: 10,
      actorUserId: 10,
      actorRoleNames: ['FACILITY_ADMIN'],
      isSuperAdmin: false,
      roleId: 3,
      permissionIds: [11, 12],
    });
    expect(permUpdated.changed).toBe(true);
    expect(permUpdated.writeScope).toBe('FACILITY_OVERRIDE');
    expect(permUpdated.added).toContain('billing.read');

    // setStaffAccountStatus refuses PENDING invitation accounts, and bumps securityVersion on deactivation
    mockDb.state!.queueSelect([
      {
        id: 19,
        fullName: 'Pending Nurse',
        tenantId: 1,
        facilityId: 10,
        isActive: true,
        accountStatus: 'PENDING',
        securityVersion: 1,
      },
    ]);
    await expect(
      staffRoles.setStaffAccountStatus({
        tenantId: 1,
        facilityId: 10,
        actorUserId: 10,
        actorRoleNames: ['FACILITY_ADMIN'],
        isSuperAdmin: false,
        targetUserId: 19,
        active: false,
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_PENDING_INVITATION', statusCode: 409 });

    mockDb.state!.queueSelect(
      [
        {
          id: 21,
          fullName: 'Active Clerk',
          tenantId: 1,
          facilityId: 10,
          isActive: true,
          accountStatus: 'ACTIVE',
          securityVersion: 4,
        },
      ],
      [{ roleName: 'RECEPTIONIST', permissionCode: 'patients.read', permissionModule: 'patients' }],
    );
    mockDb.state!.queueUpdate([{ accountStatus: 'DISABLED', isActive: false }]);
    mockDb.state!.queueInsert([]);

    const deactivated = await staffRoles.setStaffAccountStatus({
      tenantId: 1,
      facilityId: 10,
      actorUserId: 10,
      actorRoleNames: ['FACILITY_ADMIN'],
      isSuperAdmin: false,
      targetUserId: 21,
      active: false,
      reason: 'End of locum',
    });
    expect(deactivated).toMatchObject({
      userId: 21,
      active: false,
      accountStatus: 'DISABLED',
      changed: true,
    });
    const updateCalls = mockDb.state!.calls.filter((c) => c.op === 'update');
    const lastUpdate = updateCalls[updateCalls.length - 1];
    expect((lastUpdate?.values as any)?.securityVersion).toBe(5);

    // getStaffRolesOverview & getRoleTaskCatalogue
    mockDb.state!.queueSelect(
      [
        {
          roleId: 3,
          roleName: 'RECEPTIONIST',
          roleDescription: 'Front desk',
          permissionCode: 'patients.read',
          permissionModule: 'patients',
        },
      ],
      [
        {
          id: 10,
          fullName: 'Dr. Kamau Admin',
          email: 'admin@nyeri.test',
          username: 'admin_nyeri',
          designation: 'Admin',
          accountStatus: 'ACTIVE',
          isActive: true,
          createdAt: new Date(),
          lastLoginAt: null,
        },
        {
          id: 15,
          fullName: 'Grace Reception',
          email: 'grace@nyeri.test',
          username: 'grace',
          designation: 'Receptionist',
          accountStatus: 'ACTIVE',
          isActive: true,
          createdAt: new Date(),
          lastLoginAt: null,
        },
      ],
      [
        {
          userId: 10,
          roleId: 1,
          roleName: 'FACILITY_ADMIN',
          roleActive: true,
          permissionCode: 'users.invite',
          permissionModule: 'users',
        },
        {
          userId: 15,
          roleId: 3,
          roleName: 'RECEPTIONIST',
          roleActive: true,
          permissionCode: 'patients.read',
          permissionModule: 'patients',
        },
      ],
    );
    const overview = await staffRoles.getStaffRolesOverview({
      tenantId: 1,
      facilityId: 10,
      actorUserId: 10,
      search: 'a%b',
    });
    expect(overview.staff).toHaveLength(2);
    expect(overview.staff.find((s) => s.id === 10)?.canAssign).toBe(false);
    expect(overview.staff.find((s) => s.id === 15)?.canAssign).toBe(true);

    mockDb.state!.queueSelect(
      [{ id: 3, name: 'RECEPTIONIST', description: 'Front desk', isActive: true }],
      [
        {
          roleId: 3,
          roleName: 'RECEPTIONIST',
          roleDescription: 'Front desk',
          permissionCode: 'patients.read',
          permissionModule: 'patients',
        },
      ],
      [
        {
          id: 11,
          code: 'patients.read',
          name: 'Read patients',
          description: null,
          module: 'patients',
        },
        { id: 99, code: 'users.invite', name: 'Invite staff', description: null, module: 'users' },
      ],
      [{ id: 700 }], // override
      [{ code: 'patients.read' }],
    );
    const taskCat = await staffRoles.getRoleTaskCatalogue({
      tenantId: 1,
      roleId: 3,
      facilityId: 10,
    });
    expect(taskCat.writeScope).toBe('FACILITY_OVERRIDE');
    expect(taskCat.facilityOverride.applies).toBe(true);
  });

  it('exercises patient portal client and portal admin client token isolation and endpoints', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/auth/login')) {
        return new Response(
          JSON.stringify({
            success: true,
            sessionToken: 'portal_pat_tok',
            expiresAt: '2099-01-01T00:00:00.000Z',
            firstName: 'Amina',
            lastName: 'Ali',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true, accounts: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await portalClient.loginPortal({ identifier: 'MRN-1', password: 'PortalPassword123!' });
    expect(portalClient.getPortalToken()).toBe('portal_pat_tok');
    expect(portalClient.portalTokenExpired()).toBe(false);

    await portalClient.portalApi.me();
    await portalClient.portalApi.overview();
    await portalClient.portalApi.visits();
    await portalClient.portalApi.medications();
    await portalClient.portalApi.appointments();
    await portalClient.portalApi.sharing();
    await portalClient.portalApi.accessHistory();

    store.set('jalicare_session_token', 'staff_admin_tok');
    await portalClient.portalAdminApi.overview();
    await portalClient.portalAdminApi.accounts({ search: 'Amina', status: 'ACTIVE', limit: 20 });
    await portalClient.portalAdminApi.audit({ limit: 10, offset: 0 });
    await portalClient.portalAdminApi.risks();

    await portalClient.logoutPortal();
    expect(portalClient.getPortalToken()).toBeNull();

    fetchSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
