import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { httpJson, startTestServer } from './support/http-harness.ts';

const service = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('../../reporting/report-centre.service.ts', async (original) => ({
  ...(await original<typeof import('../../reporting/report-centre.service.ts')>()),
  generateReport: service.generate,
}));
import reportCentre from '../../routes/domains/report-centre.routes.ts';

describe('report centre error redaction', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    // Unit-test context: the real permission middleware still checks reports.read.
    app.use((req, _res, next) => {
      Object.assign(req, {
        user: { id: 1 },
        authContext: {
          userId: 1,
          tenantId: 1,
          facilityId: 1,
          roles: [],
          permissions: ['reports.read'],
          isSuperAdmin: false,
        },
      });
      next();
    });
    app.use(reportCentre);
    ({ baseUrl, close } = await startTestServer(app));
  });
  afterAll(async () => {
    if (close) await close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    service.generate.mockReset();
  });

  it.each([
    {
      error: Object.assign(new Error('synthetic sensitive search and patient text'), {
        code: '23505',
        detail: 'synthetic secret detail',
      }),
      expectedCode: '23505',
    },
    {
      error: Object.assign(new Error('synthetic sensitive search and patient text'), {
        code: 'synthetic-secret-code',
      }),
      expectedCode: 'UNEXPECTED',
    },
  ])('logs only safe codes and returns a generic error', async ({ error, expectedCode }) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    service.generate.mockRejectedValueOnce(error);
    const response = await httpJson(baseUrl, 'POST', '/laboratory-orders/generate', { body: {} });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'The request could not be completed.' });
    expect(log).toHaveBeenCalledWith('[api] report centre failed', { code: expectedCode });
    const serialized = JSON.stringify(log.mock.calls);
    expect(serialized).not.toContain('sensitive');
    expect(serialized).not.toContain('secret');
  });
});
