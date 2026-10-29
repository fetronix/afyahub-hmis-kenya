import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpJson, startTestServer } from './support/http-harness.ts';

const queries = vi.hoisted(() => ({
  createRadiologyOrder: vi.fn(),
  getFacilityByIdScoped: vi.fn(),
  getRadiologyOrderScoped: vi.fn(),
  updateRadiologyReport: vi.fn(),
}));
vi.mock('../../db/queries.ts', () => queries);
vi.mock('../../auth/authorization.middleware.ts', () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAnyPermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import radiologyRoutes from '../../routes/radiology.routes.ts';

describe('radiology write body validation', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, {
        authContext: { tenantId: 1, facilityId: 10, userId: 2, isSuperAdmin: false },
      });
      next();
    });
    app.use(radiologyRoutes);
    ({ baseUrl, close } = await startTestServer(app));
  });
  afterAll(async () => {
    if (close) await close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    queries.getFacilityByIdScoped.mockResolvedValue({ id: 10, tenantId: 1 });
  });

  it('POST /api/radiology-orders rejects malformed requests before scope or write', async () => {
    for (const body of [
      {},
      { patientId: -1, modality: 'X-ray', procedureName: 'Study' },
      { patientId: 2, modality: '', procedureName: 'Study' },
      { patientId: 2, modality: 'X-ray', procedureName: 'Study', status: 'Reported' },
    ]) {
      const response = await httpJson(baseUrl, 'POST', '/api/radiology-orders', { body });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    }
    expect(queries.createRadiologyOrder).not.toHaveBeenCalled();
    expect(queries.getFacilityByIdScoped).not.toHaveBeenCalled();
  });

  it('POST /api/radiology-orders uses validated fields and the resolved facility', async () => {
    queries.createRadiologyOrder.mockResolvedValue({});
    const response = await httpJson(baseUrl, 'POST', '/api/radiology-orders', {
      body: {
        patientId: '2',
        facilityId: 10,
        modality: ' X-ray ',
        procedureName: ' Study ',
        tenantId: 99,
        id: 99,
      },
    });
    expect(response.status).toBe(201);
    expect(queries.createRadiologyOrder).toHaveBeenCalledWith({
      tenantId: 1,
      facilityId: 10,
      patientId: 2,
      modality: 'X-ray',
      procedureName: 'Study',
    });
  });
});
