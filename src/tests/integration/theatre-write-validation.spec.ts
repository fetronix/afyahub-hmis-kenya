import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpJson, startTestServer } from './support/http-harness.ts';

const queries = vi.hoisted(() => ({
  createTheatreCase: vi.fn(),
  updateTheatreCase: vi.fn(),
  getTheatreCaseScoped: vi.fn(),
  getFacilityByIdScoped: vi.fn(),
}));
vi.mock('../../db/queries.ts', () => queries);
vi.mock('../../auth/authorization.middleware.ts', () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAnyPermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import theatreRoutes from '../../routes/theatre.routes.ts';

describe('theatre write body validation', () => {
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
    app.use(theatreRoutes);
    ({ baseUrl, close } = await startTestServer(app));
  });
  afterAll(async () => {
    if (close) await close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    queries.getFacilityByIdScoped.mockResolvedValue({ id: 10, tenantId: 1 });
  });

  it('POST /api/theatre-cases rejects incomplete or pre-completed cases before scope or write', async () => {
    const valid = {
      patientId: 1,
      procedureName: 'Procedure',
      leadSurgeon: 'Clinician',
      scheduledStart: '2027-01-01 10:00',
    };
    for (const body of [
      {},
      { ...valid, patientId: -1 },
      { ...valid, procedureName: ' ' },
      { ...valid, status: 'Completed' },
    ]) {
      const response = await httpJson(baseUrl, 'POST', '/api/theatre-cases', { body });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    }
    expect(queries.createTheatreCase).not.toHaveBeenCalled();
    expect(queries.getFacilityByIdScoped).not.toHaveBeenCalled();
  });

  it('PUT /api/theatre-cases/:id rejects invalid or empty changes before scope lookup', async () => {
    for (const body of [
      {},
      { status: 'invented' },
      { preOpChecklist: { confirmed: 'yes' } },
      { id: 99 },
    ]) {
      const response = await httpJson(baseUrl, 'PUT', '/api/theatre-cases/1', { body });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    }
    expect(queries.getFacilityByIdScoped).not.toHaveBeenCalled();
    expect(queries.updateTheatreCase).not.toHaveBeenCalled();
  });

  it('PUT /api/theatre-cases/:id refuses even a scoped direct status change', async () => {
    queries.getTheatreCaseScoped.mockResolvedValue({ id: 1 });
    const response = await httpJson(baseUrl, 'PUT', '/api/theatre-cases/1', {
      body: { status: 'Recovery', patientId: 99, id: 99 },
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('LEGACY_THEATRE_WRITE_DISABLED');
    expect(queries.getTheatreCaseScoped).toHaveBeenCalledWith(1, 10);
    expect(queries.updateTheatreCase).not.toHaveBeenCalled();
  });

  it('POST /api/theatre-cases refuses the old free-text path after scope resolution', async () => {
    const response = await httpJson(baseUrl, 'POST', '/api/theatre-cases', {
      body: {
        patientId: '2',
        procedureName: ' Procedure ',
        leadSurgeon: ' Clinician ',
        scheduledStart: '2027-01-01 10:00',
        tenantId: 99,
        id: 99,
      },
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('LEGACY_THEATRE_WRITE_DISABLED');
    expect(queries.getFacilityByIdScoped).toHaveBeenCalled();
    expect(queries.createTheatreCase).not.toHaveBeenCalled();
  });
});
