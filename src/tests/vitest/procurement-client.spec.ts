import { afterEach, describe, expect, it, vi } from 'vitest';
import { diagnosticsPharmacyClient } from '../../api/clients/diagnostics-pharmacy.client.ts';

afterEach(() => vi.unstubAllGlobals());

describe('procurement API client', () => {
  it('includes the facility for supplier reads while preserving tenant-only calls', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    await diagnosticsPharmacyClient.getSuppliers(17, 21);
    await diagnosticsPharmacyClient.getSuppliers(17);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/suppliers?tenantId=17&facilityId=21');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/suppliers?tenantId=17');
  });

  it('serializes the new supplier name without fabricating a supplier ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"supplierId":55}', {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await diagnosticsPharmacyClient.createPurchaseOrder({
      facilityId: 21,
      supplierName: 'New supplier',
      poNumber: 'PO-TEST',
    });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/purchase-orders');
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body as string)).toEqual({
      facilityId: 21,
      supplierName: 'New supplier',
      poNumber: 'PO-TEST',
    });
  });
  it('sends scoped optimistic revisions for updates, decisions and soft deletion', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    await diagnosticsPharmacyClient.getPurchaseOrder(44, 21);
    await diagnosticsPharmacyClient.updatePurchaseOrder(44, {
      facilityId: 21,
      expectedRevision: 2,
      items: [{ description: 'Synthetic', quantity: '1', unit: 'box', unitPrice: '10' }],
    });
    await diagnosticsPharmacyClient.transitionPurchaseOrder(44, 'approve', {
      facilityId: 21,
      expectedRevision: 3,
    });
    await diagnosticsPharmacyClient.transitionPurchaseOrder(44, 'cancel', {
      facilityId: 21,
      expectedRevision: 4,
      note: 'Duplicate',
    });
    await diagnosticsPharmacyClient.deactivateSupplier(4, {
      facilityId: 21,
      expectedRevision: 1,
      note: 'Inactive',
    });
    expect(
      fetchMock.mock.calls.map((call) => [call[0], (call[1] as RequestInit | undefined)?.method]),
    ).toEqual([
      ['/api/purchase-orders/44?facilityId=21', undefined],
      ['/api/purchase-orders/44', 'PUT'],
      ['/api/purchase-orders/44/approve', 'POST'],
      ['/api/purchase-orders/44', 'DELETE'],
      ['/api/suppliers/4', 'DELETE'],
    ]);
    expect(JSON.parse((fetchMock.mock.calls[3][1] as RequestInit).body as string)).toEqual({
      facilityId: 21,
      expectedRevision: 4,
      note: 'Duplicate',
    });
  });
});
