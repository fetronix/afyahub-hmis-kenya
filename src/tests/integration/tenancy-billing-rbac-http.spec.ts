import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TOKENS,
  httpJson,
  resolveMockAuthContext,
  resolveMockSession,
  startTestServer,
} from './support/http-harness.ts';

const authServiceMocks = vi.hoisted(() => ({
  validateSession: vi.fn(),
}));

const authzServiceMocks = vi.hoisted(() => ({
  loadAuthorizationContext: vi.fn(),
}));

const queriesMocks = vi.hoisted(() => ({
  getTenantsScoped: vi.fn(),
  getTenantByIdScoped: vi.fn(),
  getFacilitiesScoped: vi.fn(),
  getFacilityByIdScoped: vi.fn(),
  getAuditLogs: vi.fn(),
  getPatientsScoped: vi.fn(),
  getPatientByIdScoped: vi.fn(),
  createPatientScoped: vi.fn(),
  updatePatientScoped: vi.fn(),
  createInvoice: vi.fn(),
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

const accessLogMocks = vi.hoisted(() => ({
  logPatientAccess: vi.fn().mockResolvedValue(undefined),
}));

const paymentsMocks = vi.hoisted(() => ({
  recordSettledPayment: vi.fn(),
  getPaymentLedgerScoped: vi.fn(),
}));

const claimsMocks = vi.hoisted(() => ({
  getClaimsScoped: vi.fn(),
  getClaimableLinesScoped: vi.fn(),
  draftClaimScoped: vi.fn(),
  submitClaimScoped: vi.fn(),
  adjudicateClaimScoped: vi.fn(),
  settleClaimScoped: vi.fn(),
}));

const staffRolesMocks = vi.hoisted(() => ({
  getStaffRolesOverview: vi.fn(),
  listAssignableStaffRoles: vi.fn(),
  assignStaffRoles: vi.fn(),
  getRoleTaskCatalogue: vi.fn(),
  updateRolePermissions: vi.fn(),
  setStaffAccountStatus: vi.fn(),
}));

const staffInviteMocks = vi.hoisted(() => ({
  createStaffInvitation: vi.fn(),
  listStaffInvitations: vi.fn(),
  reissueStaffInvitation: vi.fn(),
  revokeStaffInvitation: vi.fn(),
}));

vi.mock('../../auth/auth.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/auth.service')>();
  return { ...actual, validateSession: authServiceMocks.validateSession };
});

vi.mock('../../auth/authorization.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/authorization.service')>();
  return { ...actual, loadAuthorizationContext: authzServiceMocks.loadAuthorizationContext };
});

vi.mock('../../db/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/queries.ts')>();
  return {
    ...actual,
    ...queriesMocks,
  };
});

vi.mock('../../clinical/access-log.service.ts', () => ({
  logPatientAccess: accessLogMocks.logPatientAccess,
}));

vi.mock('../../billing/payments.service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../billing/payments.service.ts')>();
  return { ...actual, ...paymentsMocks };
});

// This legacy route/permission suite uses a mocked database. Real payer policy
// and isolation are exercised by the DB-backed payer-hub HTTP suite.
vi.mock('../../insurance/hub/guards.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../insurance/hub/guards.ts')>();
  return {
    ...actual,
    legacyClaimsGuard: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

vi.mock('../../insurance/claims.service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../insurance/claims.service.ts')>();
  return { ...actual, ...claimsMocks };
});

vi.mock('../../auth/staff-roles.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/staff-roles.service')>();
  return { ...actual, ...staffRolesMocks };
});

vi.mock('../../auth/staff-invitation.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/staff-invitation.service')>();
  return { ...actual, ...staffInviteMocks };
});

const { createApp } = await import('../../app.ts');
const { ScopeAccessError } = await import('../../auth/scope.service.ts');
const { PatientMrnConflictError } = await import('../../db/queries.ts');
const { StaffRoleError } = await import('../../auth/staff-roles.service.ts');

describe('HTTP Integration: Tenancy Boundaries, Patients, Billing, Claims & Staff RBAC', () => {
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_BASE_URL = 'https://hmis.nyeri.example.test';
    const app = await createApp();
    const started = await startTestServer(app);
    baseUrl = started.baseUrl;
    closeServer = started.close;
  });

  afterAll(async () => {
    await closeServer();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authServiceMocks.validateSession.mockImplementation(async (token: string) =>
      resolveMockSession(token),
    );
    authzServiceMocks.loadAuthorizationContext.mockImplementation(async (userId: number) =>
      resolveMockAuthContext(userId),
    );
    queriesMocks.getFacilityByIdScoped.mockImplementation(
      async (_ctx: unknown, facilityId: number) =>
        facilityId === 999
          ? null
          : {
              id: facilityId,
              tenantId: 1,
              enabledModules: [
                'registration',
                'reception',
                'opd',
                'inpatient',
                'maternity',
                'finance',
                'insurance',
                'audit',
              ],
            },
    );
  });

  it('enforces tenant, facility, and audit-log context boundaries and missing-resource 404s', async () => {
    // Invalid tenant ID param -> 400 VALIDATION_ERROR
    const badTenantId = await httpJson(baseUrl, 'GET', '/api/tenants/abc', {
      token: TOKENS.facilityAdminA,
    });
    expect(badTenantId.status).toBe(400);
    expect(badTenantId.body.error).toBe('VALIDATION_ERROR');

    // Cross-tenant query refused by scope guard -> 403
    queriesMocks.getTenantByIdScoped.mockRejectedValueOnce(
      new ScopeAccessError('Cross-tenant access denied.', 'TENANT_ACCESS_DENIED'),
    );
    const crossTenant = await httpJson(baseUrl, 'GET', '/api/tenants/2', {
      token: TOKENS.facilityAdminA,
    });
    expect(crossTenant.status).toBe(403);

    // Missing facility -> 404
    queriesMocks.getFacilityByIdScoped.mockResolvedValueOnce(null);
    const missingFac = await httpJson(baseUrl, 'GET', '/api/facilities/999', {
      token: TOKENS.superAdmin,
    });
    expect(missingFac.status).toBe(404);

    // Audit logs: Receptionist lacks `audit.read` -> 403
    const recepAudit = await httpJson(baseUrl, 'GET', '/api/audit-logs', {
      token: TOKENS.receptionistA,
    });
    expect(recepAudit.status).toBe(403);

    // Audit logs: Facility A admin attempting to read Facility B (id 20) logs -> 403 FACILITY_ACCESS_DENIED
    const crossFacAudit = await httpJson(baseUrl, 'GET', '/api/audit-logs?facilityId=20', {
      token: TOKENS.facilityAdminA,
    });
    expect(crossFacAudit.status).toBe(403);
    expect(crossFacAudit.body.error).toBe('FACILITY_ACCESS_DENIED');

    // Audit logs: invalid facilityId=0 -> 400
    const invalidAuditQuery = await httpJson(baseUrl, 'GET', '/api/audit-logs?facilityId=0', {
      token: TOKENS.facilityAdminA,
    });
    expect(invalidAuditQuery.status).toBe(400);
    expect(['VALIDATION_ERROR', 'INVALID_FACILITY_ID']).toContain(invalidAuditQuery.body.error);

    // Audit logs: Facility A admin reading own facility (id 10) -> 200
    queriesMocks.getAuditLogs.mockResolvedValueOnce([{ id: 1, action: 'CREATE' }]);
    const ownAudit = await httpJson(baseUrl, 'GET', '/api/audit-logs?facilityId=10', {
      token: TOKENS.facilityAdminA,
    });
    expect(ownAudit.status).toBe(200);
    expect(ownAudit.body).toEqual([{ id: 1, action: 'CREATE' }]);
  });

  it('handles patient empty collections, validation, location rules, MRN conflicts, DPA access logs, and audit logs', async () => {
    // Empty collection -> 200 []
    queriesMocks.getPatientsScoped.mockResolvedValueOnce([]);
    const emptyList = await httpJson(baseUrl, 'GET', '/api/patients?facilityId=10&limit=25', {
      token: TOKENS.receptionistA,
    });
    expect(emptyList.status).toBe(200);
    expect(emptyList.body).toEqual([]);

    // Oversized pagination limit -> 400 VALIDATION_ERROR
    const hugeLimit = await httpJson(baseUrl, 'GET', '/api/patients?limit=5000', {
      token: TOKENS.receptionistA,
    });
    expect(hugeLimit.status).toBe(400);
    expect(hugeLimit.body.error).toBe('VALIDATION_ERROR');

    // Missing patient -> 404 PATIENT_NOT_FOUND (no access log written!)
    queriesMocks.getPatientByIdScoped.mockResolvedValueOnce(null);
    const missingPatient = await httpJson(baseUrl, 'GET', '/api/patients/404', {
      token: TOKENS.receptionistA,
    });
    expect(missingPatient.status).toBe(404);
    expect(accessLogMocks.logPatientAccess).not.toHaveBeenCalled();

    // Existing patient -> 200 + DPA patient access log recorded
    queriesMocks.getPatientByIdScoped.mockResolvedValueOnce({
      id: 42,
      tenantId: 1,
      registrationFacilityId: 10,
      firstName: 'Wanjiku',
      lastName: 'Ndungu',
    });
    const foundPatient = await httpJson(baseUrl, 'GET', '/api/patients/42', {
      token: TOKENS.receptionistA,
    });
    expect(foundPatient.status).toBe(200);
    expect(accessLogMocks.logPatientAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 42,
        action: 'VIEW',
        purpose: 'DIRECT_CARE',
      }),
    );

    // POST /api/patients: invalid body -> 400 VALIDATION_ERROR
    const invalidPatient = await httpJson(baseUrl, 'POST', '/api/patients', {
      token: TOKENS.receptionistA,
      body: { firstName: '' },
    });
    expect(invalidPatient.status).toBe(400);
    expect(invalidPatient.body.error).toBe('VALIDATION_ERROR');

    // POST /api/patients: mismatched county/subCounty -> 400 INVALID_SUB_COUNTY
    const badSubCounty = await httpJson(baseUrl, 'POST', '/api/patients', {
      token: TOKENS.receptionistA,
      body: {
        firstName: 'Amina',
        lastName: 'Ali',
        dateOfBirth: '1995-03-10',
        gender: 'Female',
        registrationFacilityId: 10,
        county: 'Nyeri',
        subCounty: 'Westlands',
      },
    });
    expect(badSubCounty.status).toBe(400);
    expect(badSubCounty.body.error).toBe('INVALID_SUB_COUNTY');

    // POST /api/patients: MRN conflict -> 409
    queriesMocks.createPatientScoped.mockRejectedValueOnce(new PatientMrnConflictError('MRN-001'));
    const mrnConflict = await httpJson(baseUrl, 'POST', '/api/patients', {
      token: TOKENS.receptionistA,
      body: {
        firstName: 'Amina',
        lastName: 'Ali',
        dateOfBirth: '1995-03-10',
        gender: 'Female',
        registrationFacilityId: 10,
      },
    });
    expect(mrnConflict.status).toBe(409);

    // POST /api/patients: valid create -> 201 + audit log
    queriesMocks.createPatientScoped.mockResolvedValueOnce({
      id: 55,
      tenantId: 1,
      registrationFacilityId: 10,
      firstName: 'Amina',
      lastName: 'Ali',
    });
    const createdPatient = await httpJson(baseUrl, 'POST', '/api/patients', {
      token: TOKENS.receptionistA,
      body: {
        firstName: 'Amina',
        lastName: 'Ali',
        dateOfBirth: '1995-03-10',
        gender: 'Female',
        registrationFacilityId: 10,
        county: 'Nyeri',
        subCounty: 'Othaya',
      },
    });
    expect(createdPatient.status).toBe(201);
    expect(queriesMocks.logAuditEvent).toHaveBeenCalledWith(
      1,
      10,
      '15',
      'CREATE',
      'Patient',
      '55',
      'Patient registered',
    );

    // PUT /api/patients/:id: receptionist lacks `patients.update` -> 403; admin succeeds -> 200 + access & audit logs
    const recepUpdate = await httpJson(baseUrl, 'PUT', '/api/patients/55', {
      token: TOKENS.receptionistA,
      body: { phone: '+254711000000' },
    });
    expect(recepUpdate.status).toBe(403);

    queriesMocks.updatePatientScoped.mockResolvedValueOnce({
      id: 55,
      tenantId: 1,
      registrationFacilityId: 10,
      phone: '+254711000000',
    });
    const okUpdate = await httpJson(baseUrl, 'PUT', '/api/patients/55', {
      token: TOKENS.facilityAdminA,
      body: { phone: '+254711000000' },
    });
    expect(okUpdate.status).toBe(200);
    expect(accessLogMocks.logPatientAccess).toHaveBeenLastCalledWith(
      expect.objectContaining({ patientId: 55, action: 'UPDATE' }),
    );
  });

  it('enforces invoice, payment, and insurance claim permissions, facility scope, validation, and transitions', async () => {
    // Receptionist lacks `billing.create` -> 403
    const recepInv = await httpJson(baseUrl, 'POST', '/api/invoices', {
      token: TOKENS.receptionistA,
      body: {},
    });
    expect(recepInv.status).toBe(403);

    // Billing clerk with empty items -> 400 VALIDATION_ERROR
    const emptyItems = await httpJson(baseUrl, 'POST', '/api/invoices', {
      token: TOKENS.billingClerkA,
      body: {
        invoice: { facilityId: 10, patientId: 42, invoiceNumber: 'INV-001' },
        items: [],
      },
    });
    expect(emptyItems.status).toBe(400);
    expect(emptyItems.body.error).toBe('VALIDATION_ERROR');

    // Cross-facility invoice creation attempt (Clerk at Facility 10 targeting Facility 20) -> 403
    const crossFacInv = await httpJson(baseUrl, 'POST', '/api/invoices', {
      token: TOKENS.billingClerkA,
      body: {
        invoice: { facilityId: 20, patientId: 42, invoiceNumber: 'INV-002' },
        items: [{ itemType: 'OPD', description: 'Consultation', quantity: 1, unitPrice: 1000 }],
      },
    });
    expect(crossFacInv.status).toBe(403);

    // Valid invoice creation -> 201 with exact decimal total
    queriesMocks.getFacilityByIdScoped.mockResolvedValueOnce({
      id: 10,
      tenantId: 1,
      enabledModules: ['clinical', 'finance'],
    });
    queriesMocks.getPatientByIdScoped.mockResolvedValueOnce({
      id: 42,
      tenantId: 1,
    });
    queriesMocks.createInvoice.mockImplementationOnce(async (inv: any, items: any) => ({
      id: 900,
      ...inv,
      items,
    }));

    const createdInv = await httpJson(baseUrl, 'POST', '/api/invoices', {
      token: TOKENS.billingClerkA,
      body: {
        invoice: { facilityId: 10, patientId: 42, invoiceNumber: 'INV-2026-100' },
        items: [
          {
            itemType: 'Consultation',
            description: 'Specialist Review',
            quantity: 2,
            unitPrice: '750.50',
          },
        ],
      },
    });
    expect(createdInv.status).toBe(201);
    expect(createdInv.body.totalAmount).toBe('1501.00');

    // Payments: invalid negative amount -> 400 VALIDATION_ERROR; bounded ledger query -> 400 on limit=999
    const badPay = await httpJson(baseUrl, 'POST', '/api/billing/payments', {
      token: TOKENS.billingClerkA,
      body: { invoiceId: 900, amount: -50 },
    });
    expect(badPay.status).toBe(400);
    expect(badPay.body.error).toBe('VALIDATION_ERROR');

    const badPayLedger = await httpJson(baseUrl, 'GET', '/api/billing/payments?limit=999', {
      token: TOKENS.billingClerkA,
    });
    expect(badPayLedger.status).toBe(400);

    // Claims: draft -> submit -> adjudicate (clerk lacks `insurance.claims.manage` -> 403, admin succeeds) -> illegal status jump -> 400
    claimsMocks.draftClaimScoped.mockResolvedValueOnce({ id: 301, status: 'Draft' });
    const drafted = await httpJson(baseUrl, 'POST', '/api/claims', {
      token: TOKENS.billingClerkA,
      body: { invoiceId: 900, payerName: 'SHA', payerCode: 'SHA' },
    });
    expect(drafted.status).toBe(201);

    const clerkAdjudicate = await httpJson(baseUrl, 'POST', '/api/claims/301/adjudicate', {
      token: TOKENS.billingClerkA,
      body: { approvedAmount: 1500 },
    });
    expect(clerkAdjudicate.status).toBe(403);

    claimsMocks.adjudicateClaimScoped.mockResolvedValueOnce({ id: 301, status: 'Approved' });
    const adminAdjudicate = await httpJson(baseUrl, 'POST', '/api/claims/301/adjudicate', {
      token: TOKENS.facilityAdminA,
      body: { approvedAmount: '1500.00' },
    });
    expect(adminAdjudicate.status).toBe(200);

    const illegalJump = await httpJson(baseUrl, 'PUT', '/api/claims/301/status', {
      token: TOKENS.facilityAdminA,
      body: { status: 'Draft' },
    });
    expect(illegalJump.status).toBe(400);
    expect(illegalJump.body.error).toBe('INVALID_TRANSITION');
  });

  it('enforces staff-roles and staff-invitations permissions, facility scope, and Zod validation', async () => {
    // Super-admin without facilityId gets 403 FACILITY_SCOPE_REQUIRED on facility-scoped /api/staff-roles
    const superNoFac = await httpJson(baseUrl, 'GET', '/api/staff-roles', {
      token: TOKENS.superAdmin,
    });
    expect(superNoFac.status).toBe(403);
    expect(superNoFac.body.code).toBe('FACILITY_SCOPE_REQUIRED');

    // Invalid role selection -> 400 VALIDATION_ERROR + INVALID_ROLE_SELECTION
    const badRoles = await httpJson(baseUrl, 'PUT', '/api/staff-roles/15/roles', {
      token: TOKENS.facilityAdminA,
      body: { roleIds: ['not-a-number'] },
    });
    expect(badRoles.status).toBe(400);
    expect(badRoles.body).toMatchObject({
      success: false,
      error: 'VALIDATION_ERROR',
      code: 'INVALID_ROLE_SELECTION',
    });

    // Valid role update -> 200
    staffRolesMocks.assignStaffRoles.mockResolvedValueOnce({
      userId: 15,
      changed: true,
      roles: [3],
      added: ['NURSE'],
      removed: [],
    });
    const okRoles = await httpJson(baseUrl, 'PUT', '/api/staff-roles/15/roles', {
      token: TOKENS.facilityAdminA,
      body: { roleIds: [3] },
    });
    expect(okRoles.status).toBe(200);
    expect(okRoles.body.message).toBe('Roles updated.');

    // Self-deactivation blocked by service -> 403 SELF_STATUS_CHANGE_NOT_ALLOWED
    staffRolesMocks.setStaffAccountStatus.mockRejectedValueOnce(
      new StaffRoleError('Cannot deactivate own account.', 403, 'SELF_STATUS_CHANGE_NOT_ALLOWED'),
    );
    const selfDeactivate = await httpJson(baseUrl, 'PUT', '/api/staff-roles/10/status', {
      token: TOKENS.facilityAdminA,
      body: { active: false, reason: 'Testing' },
    });
    expect(selfDeactivate.status).toBe(403);
    expect(selfDeactivate.body.code).toBe('SELF_STATUS_CHANGE_NOT_ALLOWED');

    // Staff invitations: regulator list + validation + create
    const regs = await httpJson(baseUrl, 'GET', '/api/staff-invitations/regulators', {
      token: TOKENS.facilityAdminA,
    });
    expect(regs.status).toBe(200);
    expect(regs.body.regulators.length).toBeGreaterThan(0);

    const badStaffInvite = await httpJson(baseUrl, 'POST', '/api/staff-invitations', {
      token: TOKENS.facilityAdminA,
      body: { email: 'not-an-email', fullName: '', roleId: 0 },
    });
    expect(badStaffInvite.status).toBe(400);
    expect(badStaffInvite.body.error).toBe('VALIDATION_ERROR');

    staffInviteMocks.createStaffInvitation.mockResolvedValueOnce({
      token: 'staff_invite_raw_token_12345',
      invitation: { id: 71, email: 'nurse@nyeri.example.test' },
    });
    const okStaffInvite = await httpJson(baseUrl, 'POST', '/api/staff-invitations', {
      token: TOKENS.facilityAdminA,
      body: {
        email: 'nurse@nyeri.example.test',
        fullName: 'Nurse Faith',
        roleId: 3,
      },
    });
    expect(okStaffInvite.status).toBe(201);
    expect(okStaffInvite.body.invitationUrl).toContain(
      'https://hmis.nyeri.example.test/accept-staff-invitation?token=staff_invite_raw_token_12345',
    );

    // Reissue still uses Zod-validated parameters and preserves a deployment sub-path.
    vi.stubEnv('APP_BASE_URL', 'https://hmis.nyeri.example.test/hmis/');
    staffInviteMocks.reissueStaffInvitation.mockResolvedValueOnce({
      token: 'staff_invite_reissued_token_12345',
      invitation: { id: 71, email: 'nurse@nyeri.example.test' },
    });
    const reissued = await httpJson(baseUrl, 'POST', '/api/staff-invitations/71/reissue', {
      token: TOKENS.facilityAdminA,
    });
    expect(reissued.status).toBe(200);
    expect(reissued.body.invitationUrl).toBe(
      'https://hmis.nyeri.example.test/hmis/accept-staff-invitation?token=staff_invite_reissued_token_12345',
    );
    vi.unstubAllEnvs();
  });
});
