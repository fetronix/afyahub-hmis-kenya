import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpJson, startTestServer } from './support/http-harness.ts';

const storage = vi.hoisted(() => ({
  touched: vi.fn(() => {
    throw new Error('Unexpected database access');
  }),
}));
vi.mock('../../db/index.ts', () => ({
  db: new Proxy({}, { get: () => storage.touched }),
  pool: { query: storage.touched, connect: storage.touched },
}));
vi.mock('../../auth/authorization.middleware.ts', async (original) => ({
  ...(await original<typeof import('../../auth/authorization.middleware.ts')>()),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAnyPermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
// Isolate the route middleware. In the full app, payer policy guards run first and may query the database.
vi.mock('../../insurance/hub/guards.ts', async (original) => ({
  ...(await original<typeof import('../../insurance/hub/guards.ts')>()),
  shaPolicyGuard: (_req: unknown, _res: unknown, next: () => void) => next(),
  privatePolicyGuard: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import shaRoutes from '../../routes/sha-eclaims.routes.ts';
import privateInsuranceRoutes from '../../routes/private-insurance.routes.ts';
import { facilityActionBodySchema } from '../../validation/schemas/index.ts';

describe('bodyless action boundaries', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, {
        authContext: { tenantId: 1, facilityId: 10, userId: 2, isSuperAdmin: false },
        user: { id: 2, fullName: 'Synthetic', username: 'synthetic' },
      });
      next();
    });
    app.use('/api/insurance/sha', shaRoutes);
    app.use('/api/insurance', privateInsuranceRoutes);
    ({ baseUrl, close } = await startTestServer(app));
  });
  afterAll(async () => {
    if (close) await close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /api/insurance/claims/:id/validate rejects a non-object body at the route', async () => {
    const response = await httpJson(baseUrl, 'POST', '/api/insurance/claims/1/validate', {
      body: [],
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(storage.touched).not.toHaveBeenCalled();
    expect(facilityActionBodySchema.safeParse({}).success).toBe(true);
  });

  it('POST /api/insurance/sha/claims/:id/submit rejects a non-object body at the route', async () => {
    const response = await httpJson(baseUrl, 'POST', '/api/insurance/sha/claims/1/submit', {
      body: [],
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(storage.touched).not.toHaveBeenCalled();
    expect(facilityActionBodySchema.safeParse({}).success).toBe(true);
  });

  it('POST /api/insurance/sha/claims/:id/validate rejects invalid scope input before database access', async () => {
    const response = await httpJson(baseUrl, 'POST', '/api/insurance/sha/claims/1/validate', {
      body: { facilityId: -1 },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(storage.touched).not.toHaveBeenCalled();
    expect(facilityActionBodySchema.safeParse({}).success).toBe(true);
  });
});
