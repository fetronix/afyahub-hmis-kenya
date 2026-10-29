import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpJson, startTestServer } from './support/http-harness.ts';

const queries = vi.hoisted(() => ({ updateQueueStatusScoped: vi.fn(), createQueueEntry: vi.fn() }));
vi.mock('../../db/queries.ts', () => queries);
vi.mock('../../auth/authorization.middleware.ts', () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import queueRoutes from '../../routes/queues.routes.ts';

describe('queue write body validation', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { authContext: { tenantId: 1, facilityId: 10, userId: 2 } });
      next();
    });
    app.use(queueRoutes);
    ({ baseUrl, close } = await startTestServer(app));
  });
  afterAll(async () => {
    if (close) await close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PUT /api/queues/:id/status rejects invalid bodies before invoking the service', async () => {
    for (const body of [{}, { status: 42 }, { status: '  ' }]) {
      const response = await httpJson(baseUrl, 'PUT', '/api/queues/1/status', { body });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    }
    expect(queries.updateQueueStatusScoped).not.toHaveBeenCalled();
  });

  it('PUT /api/queues/:id/status forwards a normalized status for domain validation', async () => {
    queries.updateQueueStatusScoped.mockResolvedValue({ id: 1, status: 'Waiting' });
    const response = await httpJson(baseUrl, 'PUT', '/api/queues/1/status', {
      body: { status: ' Waiting ' },
    });
    expect(response.status).toBe(200);
    expect(queries.updateQueueStatusScoped).toHaveBeenCalledWith(expect.any(Object), 1, 'Waiting');
  });
});
