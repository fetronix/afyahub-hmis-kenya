import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockDbState } from './support/drizzle-mock.ts';
import {
  TOKENS,
  httpJson,
  resolveMockAuthContext,
  resolveMockSession,
  startTestServer,
} from './support/http-harness.ts';

const mockDb = vi.hoisted(() => ({ state: null as ReturnType<typeof createMockDbState> | null }));
const authServiceMocks = vi.hoisted(() => ({ validateSession: vi.fn() }));
const authzServiceMocks = vi.hoisted(() => ({ loadAuthorizationContext: vi.fn() }));
const queriesMocks = vi.hoisted(() => ({
  getFacilityByIdScoped: vi.fn(),
  getWardsScoped: vi.fn(),
  getBedsScoped: vi.fn(),
  getAdmissionsScoped: vi.fn(),
  logAuditEvent: vi.fn(),
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

vi.mock('../../auth/auth.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/auth.service.ts')>();
  return { ...actual, validateSession: authServiceMocks.validateSession };
});

vi.mock('../../auth/auth.service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/auth.service.ts')>();
  return { ...actual, validateSession: authServiceMocks.validateSession };
});

vi.mock('../../auth/authorization.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/authorization.service.ts')>();
  return { ...actual, loadAuthorizationContext: authzServiceMocks.loadAuthorizationContext };
});

vi.mock('../../auth/authorization.service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/authorization.service.ts')>();
  return { ...actual, loadAuthorizationContext: authzServiceMocks.loadAuthorizationContext };
});

vi.mock('../../db/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/queries.ts')>();
  return {
    ...actual,
    getFacilityByIdScoped: queriesMocks.getFacilityByIdScoped,
    getWardsScoped: queriesMocks.getWardsScoped,
    getBedsScoped: queriesMocks.getBedsScoped,
    getAdmissionsScoped: queriesMocks.getAdmissionsScoped,
    logAuditEvent: queriesMocks.logAuditEvent,
  };
});

vi.mock('../../db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/queries.ts')>();
  return {
    ...actual,
    getFacilityByIdScoped: queriesMocks.getFacilityByIdScoped,
    getWardsScoped: queriesMocks.getWardsScoped,
    getBedsScoped: queriesMocks.getBedsScoped,
    getAdmissionsScoped: queriesMocks.getAdmissionsScoped,
    logAuditEvent: queriesMocks.logAuditEvent,
  };
});

const { createApp } = await import('../../app.ts');

describe('HTTP Integration: Platform Subscriptions, Maternal Health & Inpatient Routers', () => {
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const app = await createApp();
    const started = await startTestServer(app);
    baseUrl = started.baseUrl;
    closeServer = started.close;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
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
    queriesMocks.getFacilityByIdScoped.mockImplementation(
      async (_ctx: unknown, facilityId: number) =>
        facilityId === 10
          ? {
              id: 10,
              tenantId: 1,
              enabledModules: ['maternity', 'inpatient'],
            }
          : null,
    );
  });

  it('drives the platform subscription lifecycle over HTTP: create, record M-Pesa payment, verify, suspend, reactivate & price change', async () => {
    // Non-super-admin blocked from /api/platform/subscription-periods
    const forbidden = await httpJson(baseUrl, 'GET', '/api/platform/subscription-periods', {
      token: TOKENS.facilityAdminA,
    });
    expect(forbidden.status).toBe(403);

    // List periods
    mockDb.state!.queueSelect([
      {
        id: 1,
        tenantId: 1,
        facilityId: 10,
        subscriptionName: 'Annual HMIS Tier 2',
        amountDue: '15000.00',
        status: 'PENDING',
      },
    ]);
    const listRes = await httpJson(baseUrl, 'GET', '/api/platform/subscription-periods', {
      token: TOKENS.superAdmin,
    });
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);

    // Invalid period dates -> 400 INVALID_PERIOD_DATES
    const badDates = await httpJson(baseUrl, 'POST', '/api/platform/subscription-periods', {
      token: TOKENS.superAdmin,
      body: {
        tenantId: 1,
        facilityId: 10,
        subscriptionName: 'Annual',
        amountDue: '15000.00',
        periodStart: '2026-12-01',
        periodEnd: '2026-01-01',
        dueDate: '2026-12-15',
      },
    });
    expect(badDates.status).toBe(400);
    expect(badDates.body.error).toBe('INVALID_PERIOD_DATES');

    // Valid period creation -> 201 + audit log
    mockDb.state!.queueSelect([{ id: 10, tenantId: 1 }]);
    mockDb.state!.queueInsert(
      [{ id: 70, tenantId: 1, facilityId: 10, amountDue: '15000.00', status: 'PENDING' }],
      [{ id: 1 }],
    );
    const createdPeriod = await httpJson(baseUrl, 'POST', '/api/platform/subscription-periods', {
      token: TOKENS.superAdmin,
      body: {
        tenantId: 1,
        facilityId: 10,
        subscriptionName: 'Annual HMIS Tier 2',
        amountDue: '15000.00',
        periodStart: '2026-01-01',
        periodEnd: '2026-12-31',
        dueDate: '2026-02-01',
        gracePeriodEnd: '2026-02-15',
      },
    });
    expect(createdPeriod.status).toBe(201);

    // Record M-Pesa payment as PENDING verification -> 201
    mockDb.state!.queueSelect([{ id: 70, tenantId: 1, facilityId: 10, amountDue: '15000.00' }]);
    mockDb.state!.queueInsert(
      [{ id: 88, transactionCode: 'SJK123456', verificationStatus: 'PENDING' }],
      [{ id: 2 }],
    );
    const payRes = await httpJson(
      baseUrl,
      'POST',
      '/api/platform/subscription-periods/70/payments',
      {
        token: TOKENS.superAdmin,
        body: { transactionCode: 'SJK123456', amount: '15000.00' },
      },
    );
    expect(payRes.status).toBe(201);

    // Verify M-Pesa payment -> 200 PAID
    mockDb.state!.queueSelect(
      [
        {
          id: 88,
          subscriptionPeriodId: 70,
          tenantId: 1,
          facilityId: 10,
          transactionCode: 'SJK123456',
          amount: '15000.00',
          verificationStatus: 'PENDING',
        },
      ],
      [{ id: 70, tenantId: 1, facilityId: 10, amountDue: '15000.00', status: 'PENDING' }],
      [{ amount: '15000.00' }],
    );
    mockDb.state!.queueUpdate(
      [{ id: 88, verificationStatus: 'VERIFIED' }],
      [{ id: 70, status: 'PAID' }],
    );
    mockDb.state!.queueInsert([{ id: 3 }]);
    const verifyRes = await httpJson(
      baseUrl,
      'POST',
      '/api/platform/subscription-payments/88/verify',
      {
        token: TOKENS.superAdmin,
        body: { decision: 'VERIFIED', verificationNotes: 'M-Pesa statement matched' },
      },
    );
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.period.status).toBe('PAID');

    // Suspend overdue unpaid subscription -> 200 SUSPENDED
    mockDb.state!.queueSelect(
      [
        {
          id: 71,
          tenantId: 1,
          facilityId: 10,
          amountDue: '15000.00',
          dueDate: '2026-01-15',
          gracePeriodEnd: '2026-01-31',
        },
      ],
      [], // 0 verified payments
      [], // no existing access row
    );
    mockDb.state!.queueInsert([{ id: 1, facilityId: 10, accessStatus: 'SUSPENDED' }], [{ id: 4 }]);
    const suspendRes = await httpJson(
      baseUrl,
      'POST',
      '/api/platform/subscription-periods/71/suspend',
      {
        token: TOKENS.superAdmin,
        body: { reason: 'Overdue beyond grace period' },
      },
    );
    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.data.accessStatus).toBe('SUSPENDED');

    // Reactivate once paid -> 200 ACTIVE
    mockDb.state!.queueSelect(
      [
        {
          id: 71,
          tenantId: 1,
          facilityId: 10,
          amountDue: '15000.00',
          dueDate: '2026-01-15',
          gracePeriodEnd: '2026-01-31',
        },
      ],
      [{ id: 1, tenantId: 1, facilityId: 10, accessStatus: 'SUSPENDED' }],
      [{ amount: '15000.00' }],
      [
        {
          id: 71,
          amountDue: '15000.00',
          dueDate: '2026-01-15',
          gracePeriodEnd: '2026-01-31',
        },
      ],
      [{ subscriptionPeriodId: 71, amount: '15000.00' }],
    );
    mockDb.state!.queueUpdate([{ id: 1, facilityId: 10, accessStatus: 'ACTIVE' }]);
    mockDb.state!.queueInsert([{ id: 5 }]);
    const reactivateRes = await httpJson(
      baseUrl,
      'POST',
      '/api/platform/subscription-periods/71/reactivate',
      { token: TOKENS.superAdmin, body: {} },
    );
    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.data.accessStatus).toBe('ACTIVE');

    // Price change on current period -> 200
    mockDb.state!.queueSelect(
      [
        {
          id: 71,
          tenantId: 1,
          facilityId: 10,
          subscriptionName: 'Annual',
          amountDue: '15000.00',
          periodStart: '2026-01-01',
          periodEnd: '2026-12-31',
          dueDate: '2026-02-01',
          gracePeriodEnd: '2026-02-15',
        },
      ],
      [{ id: 10, tenantId: 1 }],
      [],
    );
    mockDb.state!.queueUpdate([{ id: 71, amountDue: '18000.00', status: 'PENDING' }]);
    mockDb.state!.queueInsert([{ id: 9, newAmount: '18000.00' }], [{ id: 6 }]);
    const priceRes = await httpJson(
      baseUrl,
      'POST',
      '/api/platform/subscription-periods/71/price-changes',
      {
        token: TOKENS.superAdmin,
        body: {
          newAmount: '18000.00',
          effectiveTiming: 'CURRENT_PERIOD',
          reason: 'Upgraded bed tier',
        },
      },
    );
    expect([200, 201]).toContain(priceRes.status);
  });

  it('exercises maternal health and inpatient HTTP endpoints with RBAC and module gating', async () => {
    // Nurse lacking maternity.read -> 403 on /api/maternity/summary
    authzServiceMocks.loadAuthorizationContext.mockImplementationOnce(async () => ({
      userId: 11,
      tenantId: 1,
      facilityId: 10,
      roles: ['CLINICAL_OFFICER'],
      permissions: ['inpatient.read', 'inpatient.wards.create'],
      isSuperAdmin: false,
    }));
    const noMatPerm = await httpJson(baseUrl, 'GET', '/api/maternity/summary', {
      token: TOKENS.receptionistA,
    });
    expect(noMatPerm.status).toBe(403);

    // Authorised maternity clinician -> 200 summary & 201 book pregnancy
    authzServiceMocks.loadAuthorizationContext.mockImplementation(async () => ({
      userId: 11,
      tenantId: 1,
      facilityId: 10,
      roles: ['NURSE'],
      permissions: [
        'maternity.read',
        'maternity.create',
        'immunisation.read',
        'inpatient.read',
        'inpatient.wards.create',
      ],
      isSuperAdmin: false,
    }));

    mockDb.state!.queueSelect(
      [{ count: 5 }],
      [{ count: 12 }],
      [{ count: 1 }],
      [{ count: 3 }],
      [{ count: 3 }],
    );
    const matSummary = await httpJson(baseUrl, 'GET', '/api/maternity/summary', {
      token: TOKENS.receptionistA,
    });
    expect(matSummary.status).toBe(200);
    expect(matSummary.body.activePregnancies).toBe(5);

    mockDb.state!.queueSelect([{ id: 42, tenantId: 1 }]);
    mockDb.state!.queueInsert([{ id: 100, patientId: 42, status: 'Active' }]);
    const booked = await httpJson(baseUrl, 'POST', '/api/maternity/pregnancies', {
      token: TOKENS.receptionistA,
      body: {
        patientId: 42,
        facilityId: 10,
        bookedAt: '2026-05-01',
        lmpDate: '2026-02-01',
      },
    });
    expect(booked.status).toBe(201);

    // Inpatient HTTP routes: GET /api/wards + POST /api/wards
    queriesMocks.getWardsScoped.mockResolvedValue([
      { id: 1, facilityId: 10, code: 'MW-1', name: 'Maternity Ward', totalBeds: 12 },
    ]);
    const wardsList = await httpJson(baseUrl, 'GET', '/api/wards', {
      token: TOKENS.receptionistA,
    });
    expect(wardsList.status).toBe(200);
    expect(wardsList.body).toHaveLength(1);

    mockDb.state!.queueInsert([
      { id: 2, facilityId: 10, code: 'PW-1', name: 'Paediatric Ward', totalBeds: 0 },
    ]);
    const wardCreated = await httpJson(baseUrl, 'POST', '/api/wards', {
      token: TOKENS.receptionistA,
      body: {
        name: 'Paediatric Ward',
        code: 'PW-1',
        wardType: 'Paediatric',
        genderAllocation: 'Mixed',
        dailyRate: '1800',
      },
    });
    expect(wardCreated.status).toBe(201);
    expect(queriesMocks.logAuditEvent).toHaveBeenCalled();
  });
});
