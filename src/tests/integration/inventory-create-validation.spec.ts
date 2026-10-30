import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpJson, startTestServer } from './support/http-harness.ts';

const queries = vi.hoisted(() => ({ createInventoryItem: vi.fn() }));
vi.mock('../../db/queries.ts', () => queries);
vi.mock('../../auth/authorization.middleware.ts', () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import pharmacyRoutes from '../../routes/pharmacy.routes.ts';

describe('POST /api/inventory body validation', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(pharmacyRoutes);
    ({ baseUrl, close } = await startTestServer(app));
  });
  afterAll(async () => {
    if (close) await close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects missing, negative or malformed catalogue values before a write', async () => {
    for (const body of [
      {},
      { facilityId: 10, itemCode: 'A', name: 'Item', currentStock: -1 },
      { facilityId: 10, itemCode: 'A', name: 'Item', unitCost: '1.234' },
      { facilityId: 'invalid', itemCode: 'A', name: 'Item' },
    ]) {
      const response = await httpJson(baseUrl, 'POST', '/api/inventory', { body });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    }
    expect(queries.createInventoryItem).not.toHaveBeenCalled();
  });

  it('accepts quoted amounts, forwards known fields and strips record metadata', async () => {
    queries.createInventoryItem.mockResolvedValue({ id: 4 });
    const response = await httpJson(baseUrl, 'POST', '/api/inventory', {
      body: {
        facilityId: '10',
        itemCode: ' A ',
        name: ' Item ',
        unitCost: 1.15,
        sellingPrice: '2.30',
        currentStock: 0,
        id: 99,
      },
    });
    expect(response.status).toBe(201);
    expect(queries.createInventoryItem).toHaveBeenCalledWith({
      facilityId: 10,
      itemCode: 'A',
      name: 'Item',
      unitCost: 1.15,
      sellingPrice: '2.30',
      currentStock: 0,
    });
  });
});
