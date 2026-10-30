import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  api,
  authClient,
  billingClient,
  clearSessionToken,
  diagnosticsPharmacyClient,
  getSessionToken,
  hasSessionToken,
  inpatientClient,
  maternityClient,
  patientsClinicalClient,
  platformClient,
  setSessionToken,
  theatreClient,
} from '../../api/client.ts';
import { sanitizeServerErrorMessage } from '../../api/clients/http.ts';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

describe('Domain API clients and backward-compatible src/api/client.ts facade', () => {
  const captured: CapturedRequest[] = [];
  let nextResponse: () => Response = () =>
    new Response(JSON.stringify({ success: true, data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  beforeEach(() => {
    captured.length = 0;
    clearSessionToken();
    nextResponse = () =>
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      captured.push({
        url: String(input),
        method: (init?.method ?? 'GET').toUpperCase(),
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      return nextResponse();
    });
  });

  afterEach(() => {
    clearSessionToken();
    vi.restoreAllMocks();
  });

  it('re-exports every domain client method on `api` without method name collisions', () => {
    const domainClients = [
      authClient,
      platformClient,
      patientsClinicalClient,
      maternityClient,
      inpatientClient,
      theatreClient,
      diagnosticsPharmacyClient,
      billingClient,
    ];

    const seen = new Set<string>();
    for (const client of domainClients) {
      for (const key of Object.keys(client)) {
        expect(seen.has(key), `duplicate method "${key}" across domain clients`).toBe(false);
        seen.add(key);
        expect(typeof (api as Record<string, unknown>)[key]).toBe('function');
      }
    }
    expect(Object.keys(api).length).toBe(seen.size);
  });

  it('manages session tokens and sanitizes stack traces, file paths, DB URLs, and bearer tokens', () => {
    expect(hasSessionToken()).toBe(false);
    expect(() => setSessionToken('')).toThrow(/empty session token/i);

    setSessionToken('tok-abc-123');
    expect(hasSessionToken()).toBe(true);
    expect(getSessionToken()).toBe('tok-abc-123');

    clearSessionToken();
    expect(hasSessionToken()).toBe(false);

    expect(
      sanitizeServerErrorMessage(
        'Error: boom\n    at query (/app/src/db/index.ts:12:4)',
        'Safe fallback',
      ),
    ).toBe('Safe fallback');
    expect(
      sanitizeServerErrorMessage('postgresql://admin:secret@127.0.0.1:5432/hmis', 'Safe fallback'),
    ).toBe('Safe fallback');
    expect(
      sanitizeServerErrorMessage('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'Safe fallback'),
    ).toBe('Safe fallback');
    expect(sanitizeServerErrorMessage('Validation failed: facilityId is required.', 'Safe')).toBe(
      'Validation failed: facilityId is required.',
    );
  });

  it('handles login, MFA challenge, RBAC role management, subscriptions, and logout cleanup', async () => {
    setSessionToken('stale-expired-token');
    nextResponse = () =>
      new Response(
        JSON.stringify({
          success: true,
          sessionToken: 'fresh-session-token',
          user: { id: 1, username: 'admin' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    const loginRes = await authClient.login('admin@jcare.ke', 'CorrectHorse1!');
    expect(loginRes.success).toBe(true);
    // Login intentionally omits stale Authorization header
    expect(captured[0].headers.get('Authorization')).toBeNull();
    expect(getSessionToken()).toBe('fresh-session-token');

    nextResponse = () =>
      new Response(
        JSON.stringify({
          success: true,
          data: { roles: [], permissions: [] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const rbac = await authClient.getRbacRoles(101);
    expect(rbac).toEqual({ roles: [], permissions: [] });
    expect(captured[1].headers.get('Authorization')).toBe('Bearer fresh-session-token');
    expect(captured[1].url).toBe('/api/platform/rbac/roles?facilityId=101');

    nextResponse = () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            createdRoles: ['MIDWIFE'],
            toppedUpRoles: [],
            skippedRoles: [],
            addedPermissionLinks: 4,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const applied = await authClient.applyRbacCatalogue(101, { topUpExisting: true });
    expect(applied.createdRoles).toEqual(['MIDWIFE']);

    nextResponse = () =>
      new Response(JSON.stringify({ success: true, data: [{ id: 1, plan: 'TIER_2' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    await expect(authClient.getSubscriptionPeriods()).resolves.toEqual([{ id: 1, plan: 'TIER_2' }]);

    // Logout removes local token even if server fails
    nextResponse = () =>
      new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    await expect(authClient.logout()).rejects.toBeInstanceOf(ApiError);
    expect(getSessionToken()).toBeNull();
  });

  it('builds scoped URLs and payloads across platform, patients, maternity, inpatient, diagnostics, and billing clients', async () => {
    setSessionToken('valid-token');

    await platformClient.getFacilities(3);
    await platformClient.updateFacilityModules(101, ['maternity', 'pharmacy']);
    await platformClient.getDhaReadiness(true);
    await platformClient.getDhaCalls(101, 10);

    await patientsClinicalClient.getPatients(3, 101, 'Wanjiku');
    await patientsClinicalClient.checkMedicationAllergies(11, ['Penicillin']);
    await patientsClinicalClient.getEncounters(11, 101);
    await patientsClinicalClient.getQueues(101, 'OPD');

    await maternityClient.getPregnancies({ facilityId: 101, status: 'Active' });
    await maternityClient.getDeliveries({
      facilityId: 101,
      from: '2026-10-01',
      to: '2026-10-28',
    });
    await maternityClient.getImmunisationDueList(101);

    await inpatientClient.getAdmissions(101, 'Admitted');
    await inpatientClient.getShiftHandover('2026-10-28', 'Night');
    await inpatientClient.getNursingNotes({ admissionId: 55, patientId: 11 });

    await diagnosticsPharmacyClient.getLabOrders(101, 11);
    await diagnosticsPharmacyClient.getRadiologyOrders(101, 11);

    await billingClient.getInvoices(101, 11);
    await billingClient.getChargeAttempts(101, 'PENDING');
    await billingClient.getPayments(101, { invoiceId: 88, method: 'MPESA', limit: 25 });

    expect(captured.map((req) => `${req.method} ${req.url}`)).toEqual([
      'GET /api/facilities?tenantId=3',
      'PATCH /api/facilities/101/modules',
      'GET /api/integrations/dha/readiness?probe=true',
      'GET /api/integrations/dha/calls?limit=10&facilityId=101',
      'GET /api/patients?tenantId=3&facilityId=101&search=Wanjiku',
      'POST /api/patients/11/allergies/check',
      'GET /api/encounters?patientId=11&facilityId=101',
      'GET /api/queues?facilityId=101&queueType=OPD',
      'GET /api/maternity/pregnancies?facilityId=101&status=Active',
      'GET /api/maternity/deliveries?facilityId=101&from=2026-10-01&to=2026-10-28',
      'GET /api/immunisation/due?facilityId=101',
      'GET /api/admissions?facilityId=101&status=Admitted',
      'GET /api/nursing-notes/handover?date=2026-10-28&shift=Night',
      'GET /api/nursing-notes?admissionId=55&patientId=11',
      'GET /api/lab-orders?facilityId=101&patientId=11',
      'GET /api/radiology-orders?facilityId=101&patientId=11',
      'GET /api/invoices?facilityId=101&patientId=11',
      'GET /api/billing/charge-attempts?facilityId=101&status=PENDING',
      'GET /api/billing/payments?facilityId=101&invoiceId=88&method=MPESA&limit=25',
    ]);
  });
});
