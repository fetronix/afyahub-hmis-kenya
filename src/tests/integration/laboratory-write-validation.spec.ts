import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpJson, startTestServer } from './support/http-harness.ts';

const queries = vi.hoisted(() => ({ updateLabOrderStatus: vi.fn() }));
vi.mock('../../db/queries.ts', () => queries);
vi.mock('../../auth/authorization.middleware.ts', () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import laboratoryRoutes from '../../routes/laboratory.routes.ts';

describe('laboratory write body validation', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { authContext: { tenantId: 1, facilityId: 10, userId: 2 } });
      next();
    });
    app.use(laboratoryRoutes);
    ({ baseUrl, close } = await startTestServer(app));
  });
  afterAll(async () => {
    if (close) await close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PUT /api/lab-orders/:id/status rejects invalid collection statuses before the service', async () => {
    for (const body of [
      {},
      { status: 'Completed' },
      { status: 'Sample Collected', accessionNumber: 42 },
    ]) {
      const response = await httpJson(baseUrl, 'PUT', '/api/lab-orders/1/status', { body });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    }
    expect(queries.updateLabOrderStatus).not.toHaveBeenCalled();
  });

  it('PUT /api/lab-orders/:id/status accepts collection and forwards normalized accession', async () => {
    queries.updateLabOrderStatus.mockResolvedValue({ id: 1 });
    const response = await httpJson(baseUrl, 'PUT', '/api/lab-orders/1/status', {
      body: { status: 'Sample Collected', accessionNumber: ' A-1 ' },
    });
    expect(response.status).toBe(200);
    expect(queries.updateLabOrderStatus).toHaveBeenCalledWith(
      expect.any(Object),
      1,
      'Sample Collected',
      'A-1',
    );
  });
});
