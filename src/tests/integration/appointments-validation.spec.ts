import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpJson, startTestServer } from './support/http-harness.ts';

const queries = vi.hoisted(() => ({ createAppointment: vi.fn(), getAppointments: vi.fn() }));
vi.mock('../../db/queries.ts', () => queries);
vi.mock('../../auth/authorization.middleware.ts', () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import appointmentsRoutes from '../../routes/appointments.routes.ts';

describe('POST /api/appointments body validation', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(appointmentsRoutes);
    ({ baseUrl, close } = await startTestServer(app));
  });
  afterAll(async () => {
    if (close) await close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for invalid payloads without attempting a database write', async () => {
    const invalid = [
      {},
      { tenantId: 1, facilityId: 10, patientId: 'bad', scheduledTime: '2027-05-01T10:00' },
      { tenantId: 1, facilityId: 10, patientId: 3, scheduledTime: ' ', durationMinutes: -1 },
    ];
    for (const body of invalid) {
      const response = await httpJson(baseUrl, 'POST', '/api/appointments', { body });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    }
    expect(queries.createAppointment).not.toHaveBeenCalled();
  });

  it('forwards normalized known fields and strips client-controlled record metadata', async () => {
    queries.createAppointment.mockResolvedValue({ id: 4 });
    const response = await httpJson(baseUrl, 'POST', '/api/appointments', {
      body: {
        tenantId: 1,
        facilityId: '10',
        patientId: 3,
        scheduledTime: ' 2027-05-01T10:00 ',
        id: 99,
      },
    });
    expect(response.status).toBe(201);
    expect(queries.createAppointment).toHaveBeenCalledWith({
      tenantId: 1,
      facilityId: 10,
      patientId: 3,
      scheduledTime: '2027-05-01T10:00',
    });
  });
});
