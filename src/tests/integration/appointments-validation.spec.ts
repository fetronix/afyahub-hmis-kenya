import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpJson, startTestServer } from './support/http-harness.ts';

const service = vi.hoisted(() => ({
  createAppointmentScoped: vi.fn(),
  listAppointmentsScoped: vi.fn(),
}));
vi.mock('../../appointments/appointments.service.ts', () => ({
  ...service,
  AppointmentError: class AppointmentError extends Error {},
  appointmentRequestKey: (key: string | undefined) => key,
}));
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
    app.use((req: any, _res, next) => {
      req.authContext = {
        userId: 7,
        tenantId: 1,
        facilityId: 10,
        roles: [],
        permissions: [],
        isSuperAdmin: false,
      };
      next();
    });
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
    expect(service.createAppointmentScoped).not.toHaveBeenCalled();
  });

  it('forwards normalized known fields and strips client-controlled record metadata', async () => {
    service.createAppointmentScoped.mockResolvedValue({
      appointment: { id: 4 },
      idempotentReplay: false,
    });
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
    expect(service.createAppointmentScoped).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, tenantId: 1, facilityId: 10 }),
      { tenantId: 1, facilityId: 10, patientId: 3, scheduledTime: '2027-05-01T10:00' },
      undefined,
    );
  });
});
