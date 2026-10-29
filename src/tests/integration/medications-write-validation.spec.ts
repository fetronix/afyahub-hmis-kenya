import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpJson, startTestServer } from './support/http-harness.ts';

const queries = vi.hoisted(() => ({
  updateMedicationStatus: vi.fn(),
  createMedication: vi.fn(),
  logAuditEvent: vi.fn(),
}));
vi.mock('../../db/queries.ts', () => queries);
vi.mock('../../auth/authorization.middleware.ts', () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import medicationRoutes from '../../routes/medications.routes.ts';

describe('medication write body validation', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { authContext: { tenantId: 1, facilityId: 10, userId: 2 } });
      next();
    });
    app.use(medicationRoutes);
    ({ baseUrl, close } = await startTestServer(app));
  });
  afterAll(async () => {
    if (close) await close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PUT /api/medications/:id/status rejects malformed statuses before the service', async () => {
    for (const body of [{}, { status: 42 }, { status: '  ' }]) {
      const response = await httpJson(baseUrl, 'PUT', '/api/medications/1/status', { body });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    }
    expect(queries.updateMedicationStatus).not.toHaveBeenCalled();
  });

  it('PUT /api/medications/:id/status forwards a normalized value', async () => {
    queries.updateMedicationStatus.mockResolvedValue({ id: 1, status: 'Dispensed' });
    const response = await httpJson(baseUrl, 'PUT', '/api/medications/1/status', {
      body: { status: ' Dispensed ' },
    });
    expect(response.status).toBe(200);
    expect(queries.updateMedicationStatus).toHaveBeenCalledWith(1, 'Dispensed');
  });
});
