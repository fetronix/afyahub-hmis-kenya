import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpJson, startTestServer } from './support/http-harness.ts';

const queries = vi.hoisted(() => ({
  updateLabOrderStatus: vi.fn(),
  addLabResult: vi.fn(),
  createLabOrderBatch: vi.fn(),
  createLabOrder: vi.fn(),
}));
vi.mock('../../billing/service-charges.ts', async (original) => ({
  ...(await original<typeof import('../../billing/service-charges.ts')>()),
  chargeLabOrderBatch: vi.fn().mockResolvedValue([]),
}));
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

  it('POST /api/lab-orders/batch rejects invalid requests before the service', async () => {
    const valid = {
      patientId: 2,
      encounterId: 3,
      investigations: ['Requested test'],
      clinicalIndication: 'Clinical indication',
      specimenType: 'Specimen',
      priority: 'Routine',
    };
    for (const body of [
      {},
      { ...valid, priority: 'unsupported' },
      { ...valid, investigations: [] },
      { ...valid, patientId: -1 },
    ]) {
      const response = await httpJson(baseUrl, 'POST', '/api/lab-orders/batch', { body });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    }
    expect(queries.createLabOrderBatch).not.toHaveBeenCalled();
  });

  it('POST /api/lab-orders/batch accepts actual investigations without assigning codes or prices', async () => {
    queries.createLabOrderBatch.mockResolvedValue({ orders: [], queue: {} });
    const response = await httpJson(baseUrl, 'POST', '/api/lab-orders/batch', {
      body: {
        patientId: 2,
        encounterId: 3,
        investigations: [' Requested test '],
        clinicalIndication: 'Clinical indication',
        specimenType: 'Specimen',
        priority: 'Routine',
      },
    });
    expect(response.status).toBe(201);
    expect(queries.createLabOrderBatch).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ investigations: ['Requested test'] }),
    );
  });

  it('POST /api/lab-orders rejects invalid and pre-completed orders before the service', async () => {
    for (const body of [
      {},
      { patientId: 2, testName: '' },
      { patientId: 2, testName: 'Test', status: 'Completed' },
      { patientId: 'bad', testName: 'Test' },
    ]) {
      const response = await httpJson(baseUrl, 'POST', '/api/lab-orders', { body });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    }
    expect(queries.createLabOrder).not.toHaveBeenCalled();
  });

  it('POST /api/lab-orders accepts an encounter-linked order without inventing a code', async () => {
    queries.createLabOrder.mockResolvedValue({ testName: 'Requested test' });
    const response = await httpJson(baseUrl, 'POST', '/api/lab-orders', {
      body: { encounterId: '3', testName: ' Requested test ' },
    });
    expect(response.status).toBe(201);
    expect(queries.createLabOrder).toHaveBeenCalledWith(expect.any(Object), {
      encounterId: 3,
      testName: 'Requested test',
    });
  });

  it('POST /api/lab-results rejects invalid measurement payloads before the service', async () => {
    for (const body of [
      {},
      { orderId: -1, patientId: 2, parameterName: 'Parameter', measuredValue: '4' },
      { orderId: 1, patientId: 2, parameterName: 'Parameter', measuredValue: 4 },
    ]) {
      const response = await httpJson(baseUrl, 'POST', '/api/lab-results', { body });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    }
    expect(queries.addLabResult).not.toHaveBeenCalled();
  });

  it('POST /api/lab-results forwards normalized values without claiming clinical interpretation', async () => {
    queries.addLabResult.mockResolvedValue({ id: 1 });
    const response = await httpJson(baseUrl, 'POST', '/api/lab-results', {
      body: { orderId: '1', patientId: 2, parameterName: ' Parameter ', measuredValue: ' 4 ' },
    });
    expect(response.status).toBe(201);
    expect(queries.addLabResult).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        orderId: 1,
        patientId: 2,
        parameterName: 'Parameter',
        measuredValue: '4',
      }),
    );
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
