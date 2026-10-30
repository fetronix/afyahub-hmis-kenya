import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpJson, startTestServer } from './support/http-harness.ts';

const queries = vi.hoisted(() => ({ voidInvoiceScoped: vi.fn(), logAuditEvent: vi.fn() }));
vi.mock('../../db/queries.ts', () => queries);
vi.mock('../../auth/authorization.middleware.ts', () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import billingRoutes from '../../routes/billing.routes.ts';

describe('POST /api/invoices/:id/void body validation', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { authContext: { tenantId: 1, facilityId: 10, userId: 2 } });
      next();
    });
    app.use(billingRoutes);
    ({ baseUrl, close } = await startTestServer(app));
  });
  afterAll(async () => {
    if (close) await close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for an invalid reason without attempting to void', async () => {
    for (const body of [{}, { reason: '  ' }, { reason: 123 }, { reason: 'ab' }]) {
      const response = await httpJson(baseUrl, 'POST', '/api/invoices/1/void', { body });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    }
    expect(queries.voidInvoiceScoped).not.toHaveBeenCalled();
    expect(queries.logAuditEvent).not.toHaveBeenCalled();
  });

  it('passes a normalized reason to the existing scoped void service', async () => {
    queries.voidInvoiceScoped.mockResolvedValue({
      id: 1,
      tenantId: 1,
      facilityId: 10,
      invoiceNumber: 'synthetic',
    });
    const response = await httpJson(baseUrl, 'POST', '/api/invoices/1/void', {
      body: { reason: ' Duplicate entry ' },
    });
    expect(response.status).toBe(200);
    expect(queries.voidInvoiceScoped).toHaveBeenCalledWith(
      expect.any(Object),
      1,
      'Duplicate entry',
    );
  });
});
