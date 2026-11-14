import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PERSONAS,
  TOKENS,
  httpJson,
  resolveMockAuthContext,
  resolveMockSession,
  startTestServer,
} from './support/http-harness.ts';

const authServiceMocks = vi.hoisted(() => ({
  login: vi.fn(),
  validateSession: vi.fn(),
  revokeSession: vi.fn(),
}));

const authzServiceMocks = vi.hoisted(() => ({
  loadAuthorizationContext: vi.fn(),
}));

const facilityAdminInviteMocks = vi.hoisted(() => ({
  validateFacilityAdminInvitation: vi.fn(),
  acceptFacilityAdminInvitation: vi.fn(),
}));

const staffInviteMocks = vi.hoisted(() => ({
  validateStaffInvitation: vi.fn(),
  acceptStaffInvitation: vi.fn(),
}));

vi.mock('../../auth/auth.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/auth.service')>();
  return {
    ...actual,
    login: authServiceMocks.login,
    validateSession: authServiceMocks.validateSession,
    revokeSession: authServiceMocks.revokeSession,
  };
});

vi.mock('../../auth/authorization.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/authorization.service')>();
  return {
    ...actual,
    loadAuthorizationContext: authzServiceMocks.loadAuthorizationContext,
  };
});

vi.mock('../../auth/facility-admin-invitation.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../auth/facility-admin-invitation.service')>();
  return {
    ...actual,
    validateFacilityAdminInvitation: facilityAdminInviteMocks.validateFacilityAdminInvitation,
    acceptFacilityAdminInvitation: facilityAdminInviteMocks.acceptFacilityAdminInvitation,
  };
});

vi.mock('../../auth/staff-invitation.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/staff-invitation.service')>();
  return {
    ...actual,
    validateStaffInvitation: staffInviteMocks.validateStaffInvitation,
    acceptStaffInvitation: staffInviteMocks.acceptStaffInvitation,
  };
});

const { createApp } = await import('../../app.ts');
const { FacilityAdminInvitationError } =
  await import('../../auth/facility-admin-invitation.service.ts');
const { StaffInvitationError } = await import('../../auth/staff-invitation.service.ts');

describe('HTTP Integration: Health, Authentication, Sessions & Public Invitations', () => {
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
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
  });

  it('GET /api/health returns 200 ok status and echoes X-Correlation-Id without requiring auth', async () => {
    const res = await httpJson(baseUrl, 'GET', '/api/health', {
      headers: { 'x-correlation-id': 'corr-health-probe-001' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-correlation-id')).toBe('corr-health-probe-001');
    expect(res.body).toMatchObject({ status: 'healthy' });
  });

  it('rejects malformed JSON bodies with HTTP 400 and correlation ID without leaking stack traces', async () => {
    const res = await httpJson(baseUrl, 'POST', '/api/auth/login', {
      rawBody: '{"identifier": "broken_json"',
      headers: { 'x-correlation-id': 'corr-bad-json-01' },
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('x-correlation-id')).toBe('corr-bad-json-01');
    expect(JSON.stringify(res.body)).not.toContain('SyntaxError');
    expect(JSON.stringify(res.body)).not.toContain('node_modules');
  });

  it('POST /api/auth/login enforces Zod schema validation, credential failures, lockouts, MFA, and safe 500s', async () => {
    // 1. Missing or invalid login payload -> 400 VALIDATION_ERROR before calling login()
    const invalidPayload = await httpJson(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: '', password: 'short' },
    });
    expect(invalidPayload.status).toBe(400);
    expect(invalidPayload.body).toMatchObject({
      success: false,
      error: 'VALIDATION_ERROR',
      code: 'INVALID_IDENTIFIER',
    });
    expect(authServiceMocks.login).not.toHaveBeenCalled();

    const shortPw = await httpJson(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'dr_kamau', password: 'short' },
    });
    expect(shortPw.status).toBe(400);
    expect(shortPw.body).toMatchObject({
      success: false,
      error: 'VALIDATION_ERROR',
      code: 'INVALID_PASSWORD',
    });

    // 2. Wrong password -> 401 INVALID_CREDENTIALS
    authServiceMocks.login.mockResolvedValueOnce({
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid username/email or password.',
    });
    const wrongCreds = await httpJson(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'dr_kamau', password: 'WrongPassword123!' },
    });
    expect(wrongCreds.status).toBe(401);
    expect(wrongCreds.body).toMatchObject({
      success: false,
      error: 'INVALID_CREDENTIALS',
    });

    // 3. Locked account -> 423 ACCOUNT_LOCKED
    authServiceMocks.login.mockResolvedValueOnce({
      success: false,
      error: 'ACCOUNT_LOCKED',
      message: 'Account temporarily locked after repeated failed attempts.',
    });
    const locked = await httpJson(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'locked_staff', password: 'ValidPassword123!' },
    });
    expect(locked.status).toBe(423);
    expect(locked.body.error).toBe('ACCOUNT_LOCKED');

    // 4. Disabled/unavailable account -> 403 ACCOUNT_UNAVAILABLE
    authServiceMocks.login.mockResolvedValueOnce({
      success: false,
      error: 'ACCOUNT_UNAVAILABLE',
      message: 'Account is disabled.',
    });
    const unavailable = await httpJson(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'former_staff', password: 'ValidPassword123!' },
    });
    expect(unavailable.status).toBe(403);
    expect(unavailable.body.error).toBe('ACCOUNT_UNAVAILABLE');

    // 5. MFA challenge -> 200 requiresMfa: true without issuing sessionToken
    authServiceMocks.login.mockResolvedValueOnce({
      success: true,
      requiresMfa: true,
      user: PERSONAS[TOKENS.facilityAdminA]!.user,
    });
    const mfaRes = await httpJson(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'admin_nyeri', password: 'ValidPassword123!' },
    });
    expect(mfaRes.status).toBe(200);
    expect(mfaRes.body.requiresMfa).toBe(true);
    expect(mfaRes.body.sessionToken).toBeUndefined();

    // 6. Valid login -> 200 with sessionToken & user
    authServiceMocks.login.mockResolvedValueOnce({
      success: true,
      user: PERSONAS[TOKENS.facilityAdminA]!.user,
      sessionToken: TOKENS.facilityAdminA,
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    });
    const okLogin = await httpJson(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: '  ADMIN_NYERI  ', password: 'ValidPassword123!' },
      headers: { 'x-forwarded-for': '197.232.10.5', 'user-agent': 'Vitest-Integration/1.0' },
    });
    expect(okLogin.status).toBe(200);
    expect(okLogin.body).toMatchObject({
      success: true,
      sessionToken: TOKENS.facilityAdminA,
      requiresMfa: false,
    });
    expect(authServiceMocks.login).toHaveBeenLastCalledWith(
      expect.objectContaining({
        identifier: 'admin_nyeri',
        ipAddress: '197.232.10.5',
      }),
    );

    // 7. Database/driver crash during login -> 500 without leaking SQL or connection strings
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    authServiceMocks.login.mockRejectedValueOnce(
      new Error(
        'SELECT password_hash FROM users WHERE username = $1 -- postgres://admin:supersecret@db.internal:5432/hmis',
      ),
    );
    const dbCrash = await httpJson(baseUrl, 'POST', '/api/auth/login', {
      body: { identifier: 'admin_nyeri', password: 'ValidPassword123!' },
    });
    errSpy.mockRestore();

    expect(dbCrash.status).toBe(500);
    expect(dbCrash.body).toEqual({
      success: false,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected authentication error occurred.',
    });
    expect(JSON.stringify(dbCrash.body)).not.toContain('postgres://');
    expect(JSON.stringify(dbCrash.body)).not.toContain('supersecret');
    expect(JSON.stringify(dbCrash.body)).not.toContain('SELECT');
  });

  it('GET /api/auth/session and POST /api/auth/logout enforce bearer validation, account states, and revocation', async () => {
    // Missing token -> 401
    const noToken = await httpJson(baseUrl, 'GET', '/api/auth/session');
    expect(noToken.status).toBe(401);
    expect(noToken.body.error).toBe('UNAUTHORIZED');

    // Malformed token -> 401 INVALID_SESSION
    const badFormat = await httpJson(baseUrl, 'GET', '/api/auth/session', {
      token: 'short!!bad',
    });
    expect(badFormat.status).toBe(401);
    expect(badFormat.body.error).toBe('INVALID_SESSION');

    // Revoked/unknown token -> 401 INVALID_SESSION
    const revoked = await httpJson(baseUrl, 'GET', '/api/auth/session', {
      token: TOKENS.revokedToken,
    });
    expect(revoked.status).toBe(401);
    expect(revoked.body.error).toBe('INVALID_SESSION');

    // Disabled user -> 403 ACCOUNT_DISABLED
    const disabled = await httpJson(baseUrl, 'GET', '/api/auth/session', {
      token: TOKENS.disabledUser,
    });
    expect(disabled.status).toBe(403);
    expect(disabled.body.error).toBe('ACCOUNT_DISABLED');

    // Locked user -> 403 ACCOUNT_LOCKED
    const locked = await httpJson(baseUrl, 'GET', '/api/auth/session', {
      token: TOKENS.lockedUser,
    });
    expect(locked.status).toBe(403);
    expect(locked.body.error).toBe('ACCOUNT_LOCKED');

    // Active session -> 200 with scoped roles & permissions
    const validSession = await httpJson(baseUrl, 'GET', '/api/auth/session', {
      token: TOKENS.facilityAdminA,
    });
    expect(validSession.status).toBe(200);
    expect(validSession.body).toMatchObject({
      success: true,
      user: {
        id: 10,
        tenantId: 1,
        facilityId: 10,
        roles: ['FACILITY_ADMIN'],
        isSuperAdmin: false,
      },
    });

    // Logout -> 200 revokes session
    authServiceMocks.revokeSession.mockResolvedValueOnce(true);
    const logoutRes = await httpJson(baseUrl, 'POST', '/api/auth/logout', {
      token: TOKENS.facilityAdminA,
    });
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body).toEqual({
      success: true,
      message: 'Logout successful.',
    });
    expect(authServiceMocks.revokeSession).toHaveBeenCalledWith(
      TOKENS.facilityAdminA,
      'USER_LOGOUT',
    );
  });

  it('validates and accepts public facility-admin and staff invitations with structured 400/410/201 responses', async () => {
    // Missing token query -> 400 VALIDATION_ERROR + INVALID_INVITATION_TOKEN
    const badValidate = await httpJson(
      baseUrl,
      'GET',
      '/api/auth/facility-admin-invitations/validate',
    );
    expect(badValidate.status).toBe(400);
    expect(badValidate.body).toMatchObject({
      success: false,
      error: 'VALIDATION_ERROR',
      code: 'INVALID_INVITATION_TOKEN',
    });

    const validInviteToken = 'invite_token_0000000000000000000000000001';
    facilityAdminInviteMocks.validateFacilityAdminInvitation.mockResolvedValueOnce({
      email: 'admin@nyeri.example.test',
      facilityName: 'Nyeri Referral',
    });
    const okValidate = await httpJson(
      baseUrl,
      'GET',
      `/api/auth/facility-admin-invitations/validate?token=${validInviteToken}`,
    );
    expect(okValidate.status).toBe(200);
    expect(okValidate.body.invitation.facilityName).toBe('Nyeri Referral');

    // Expired invitation -> domain status code 410
    facilityAdminInviteMocks.validateFacilityAdminInvitation.mockRejectedValueOnce(
      new FacilityAdminInvitationError('Invitation has expired.', 410, 'INVITATION_EXPIRED'),
    );
    const expiredRes = await httpJson(
      baseUrl,
      'GET',
      `/api/auth/facility-admin-invitations/validate?token=${validInviteToken}`,
    );
    expect(expiredRes.status).toBe(410);
    expect(expiredRes.body.error).toBe('INVITATION_EXPIRED');

    // Invalid accept payload -> 400 VALIDATION_ERROR
    const badAccept = await httpJson(
      baseUrl,
      'POST',
      '/api/auth/facility-admin-invitations/accept',
      { body: { token: 'short', username: 'ab', password: 'short' } },
    );
    expect(badAccept.status).toBe(400);
    expect(badAccept.body.error).toBe('VALIDATION_ERROR');

    // Valid facility-admin accept -> 201
    facilityAdminInviteMocks.acceptFacilityAdminInvitation.mockResolvedValueOnce({
      success: true,
      userId: 55,
    });
    const okAccept = await httpJson(
      baseUrl,
      'POST',
      '/api/auth/facility-admin-invitations/accept',
      {
        body: {
          token: validInviteToken,
          username: 'dr_wanjiru',
          password: 'StrongPassword123!',
        },
      },
    );
    expect(okAccept.status).toBe(201);
    expect(okAccept.body).toMatchObject({ success: true, userId: 55 });

    // Staff invitation validate & accept
    staffInviteMocks.validateStaffInvitation.mockRejectedValueOnce(
      new StaffInvitationError('Invitation revoked.', 409, 'INVITATION_REVOKED'),
    );
    const revokedStaff = await httpJson(
      baseUrl,
      'GET',
      `/api/auth/staff-invitations/validate?token=${validInviteToken}`,
    );
    expect(revokedStaff.status).toBe(409);
    expect(revokedStaff.body.error).toBe('INVITATION_REVOKED');

    staffInviteMocks.acceptStaffInvitation.mockResolvedValueOnce({
      success: true,
      userId: 77,
    });
    const okStaffAccept = await httpJson(baseUrl, 'POST', '/api/auth/staff-invitations/accept', {
      body: {
        token: validInviteToken,
        username: 'nurse_achieng',
        password: 'StrongPassword123!',
      },
    });
    expect(okStaffAccept.status).toBe(201);
    expect(okStaffAccept.body).toMatchObject({ success: true, userId: 77 });
  });
});
