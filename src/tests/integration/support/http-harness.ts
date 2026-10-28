import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

import type { AuthorizationContext } from '../../../auth/authorization.types.ts';

function makeToken(prefix: string): string {
  return `${prefix}${'0'.repeat(64)}`.slice(0, 64);
}

export const TOKENS = {
  superAdmin: makeToken('test_super_admin_session_token_1_'),
  facilityAdminA: makeToken('test_facility_a_admin_session_token_2_'),
  facilityAdminB: makeToken('test_facility_b_admin_session_token_3_'),
  tenantTwoAdmin: makeToken('test_tenant_two_admin_session_token_4_'),
  receptionistA: makeToken('test_receptionist_fac_a_session_token_5_'),
  billingClerkA: makeToken('test_billing_clerk_fac_a_session_token_6_'),
  disabledUser: makeToken('test_disabled_account_session_token_7_'),
  lockedUser: makeToken('test_locked_account_session_token_8_'),
  revokedToken: makeToken('test_revoked_expired_session_token_9_'),
} as const;

export interface TestSessionPersona {
  session: {
    id: number;
    userId: number;
    expiresAt: Date;
    lastActivityAt: Date;
  };
  user: {
    id: number;
    uid: string;
    username: string;
    email: string;
    fullName: string;
    tenantId: number | null;
    facilityId: number | null;
    designation?: string | null;
    isActive: boolean;
    accountStatus: string;
    mustChangePassword: boolean;
    mfaEnabled: boolean;
    mfaRequired: boolean;
  };
  authContext: AuthorizationContext | null;
}

const futureDate = new Date('2027-01-01T00:00:00.000Z');
const recentDate = new Date('2026-10-28T08:00:00.000Z');

export const PERSONAS: Record<string, TestSessionPersona> = {
  [TOKENS.superAdmin]: {
    session: { id: 1, userId: 1, expiresAt: futureDate, lastActivityAt: recentDate },
    user: {
      id: 1,
      uid: 'usr-super-1',
      username: 'platform_root',
      email: 'root@jalicare.example.test',
      fullName: 'Platform Super Admin',
      tenantId: null,
      facilityId: null,
      designation: 'Platform Administrator',
      isActive: true,
      accountStatus: 'ACTIVE',
      mustChangePassword: false,
      mfaEnabled: false,
      mfaRequired: false,
    },
    authContext: {
      userId: 1,
      tenantId: null,
      facilityId: null,
      roles: ['SUPER_ADMIN'],
      permissions: ['users.invite', 'audit.read', 'patients.read'],
      isSuperAdmin: true,
    },
  },
  [TOKENS.facilityAdminA]: {
    session: { id: 2, userId: 10, expiresAt: futureDate, lastActivityAt: recentDate },
    user: {
      id: 10,
      uid: 'usr-fac-a-admin',
      username: 'admin_nyeri',
      email: 'admin@nyeri.example.test',
      fullName: 'Dr. Kamau Admin',
      tenantId: 1,
      facilityId: 10,
      designation: 'Facility Administrator',
      isActive: true,
      accountStatus: 'ACTIVE',
      mustChangePassword: false,
      mfaEnabled: false,
      mfaRequired: false,
    },
    authContext: {
      userId: 10,
      tenantId: 1,
      facilityId: 10,
      roles: ['FACILITY_ADMIN'],
      permissions: [
        'audit.read',
        'patients.read',
        'patients.create',
        'patients.update',
        'billing.read',
        'billing.create',
        'billing.payments.record',
        'insurance.read',
        'insurance.claims.create',
        'insurance.claims.manage',
        'users.invite',
        'users.invitations.read',
        'users.invitations.reissue',
        'users.invitations.revoke',
        'maternity.read',
        'maternity.write',
        'inpatient.read',
        'inpatient.write',
      ],
      isSuperAdmin: false,
    },
  },
  [TOKENS.facilityAdminB]: {
    session: { id: 3, userId: 20, expiresAt: futureDate, lastActivityAt: recentDate },
    user: {
      id: 20,
      uid: 'usr-fac-b-admin',
      username: 'admin_othaya',
      email: 'admin@othaya.example.test',
      fullName: 'Dr. Njeri Admin',
      tenantId: 1,
      facilityId: 20,
      designation: 'Facility Administrator',
      isActive: true,
      accountStatus: 'ACTIVE',
      mustChangePassword: false,
      mfaEnabled: false,
      mfaRequired: false,
    },
    authContext: {
      userId: 20,
      tenantId: 1,
      facilityId: 20,
      roles: ['FACILITY_ADMIN'],
      permissions: ['audit.read', 'patients.read', 'billing.read'],
      isSuperAdmin: false,
    },
  },
  [TOKENS.tenantTwoAdmin]: {
    session: { id: 4, userId: 30, expiresAt: futureDate, lastActivityAt: recentDate },
    user: {
      id: 30,
      uid: 'usr-tenant-2-admin',
      username: 'admin_kisumu',
      email: 'admin@kisumu.example.test',
      fullName: 'Dr. Otieno Admin',
      tenantId: 2,
      facilityId: 99,
      designation: 'Facility Administrator',
      isActive: true,
      accountStatus: 'ACTIVE',
      mustChangePassword: false,
      mfaEnabled: false,
      mfaRequired: false,
    },
    authContext: {
      userId: 30,
      tenantId: 2,
      facilityId: 99,
      roles: ['FACILITY_ADMIN'],
      permissions: ['audit.read', 'patients.read', 'billing.read', 'users.invite'],
      isSuperAdmin: false,
    },
  },
  [TOKENS.receptionistA]: {
    session: { id: 5, userId: 15, expiresAt: futureDate, lastActivityAt: recentDate },
    user: {
      id: 15,
      uid: 'usr-recep-a',
      username: 'desk_nyeri',
      email: 'desk@nyeri.example.test',
      fullName: 'Grace Reception',
      tenantId: 1,
      facilityId: 10,
      designation: 'Receptionist',
      isActive: true,
      accountStatus: 'ACTIVE',
      mustChangePassword: false,
      mfaEnabled: false,
      mfaRequired: false,
    },
    authContext: {
      userId: 15,
      tenantId: 1,
      facilityId: 10,
      roles: ['RECEPTIONIST'],
      permissions: ['patients.read', 'patients.create'],
      isSuperAdmin: false,
    },
  },
  [TOKENS.billingClerkA]: {
    session: { id: 6, userId: 16, expiresAt: futureDate, lastActivityAt: recentDate },
    user: {
      id: 16,
      uid: 'usr-billing-a',
      username: 'cashier_nyeri',
      email: 'cashier@nyeri.example.test',
      fullName: 'Peter Cashier',
      tenantId: 1,
      facilityId: 10,
      designation: 'Billing Clerk',
      isActive: true,
      accountStatus: 'ACTIVE',
      mustChangePassword: false,
      mfaEnabled: false,
      mfaRequired: false,
    },
    authContext: {
      userId: 16,
      tenantId: 1,
      facilityId: 10,
      roles: ['BILLING_CLERK'],
      permissions: [
        'billing.read',
        'billing.create',
        'billing.payments.record',
        'insurance.read',
        'insurance.claims.create',
      ],
      isSuperAdmin: false,
    },
  },
  [TOKENS.disabledUser]: {
    session: { id: 7, userId: 70, expiresAt: futureDate, lastActivityAt: recentDate },
    user: {
      id: 70,
      uid: 'usr-disabled',
      username: 'former_staff',
      email: 'former@nyeri.example.test',
      fullName: 'Former Staff',
      tenantId: 1,
      facilityId: 10,
      isActive: false,
      accountStatus: 'DISABLED',
      mustChangePassword: false,
      mfaEnabled: false,
      mfaRequired: false,
    },
    authContext: null,
  },
  [TOKENS.lockedUser]: {
    session: { id: 8, userId: 80, expiresAt: futureDate, lastActivityAt: recentDate },
    user: {
      id: 80,
      uid: 'usr-locked',
      username: 'locked_staff',
      email: 'locked@nyeri.example.test',
      fullName: 'Locked Staff',
      tenantId: 1,
      facilityId: 10,
      isActive: true,
      accountStatus: 'LOCKED',
      mustChangePassword: false,
      mfaEnabled: false,
      mfaRequired: false,
    },
    authContext: null,
  },
};

export function resolveMockSession(token: string) {
  const persona = PERSONAS[token];
  if (!persona) return null;
  return {
    session: persona.session,
    user: persona.user,
  };
}

export function resolveMockAuthContext(userId: number): AuthorizationContext | null {
  for (const persona of Object.values(PERSONAS)) {
    if (persona.user.id === userId) {
      return persona.authContext;
    }
  }
  return null;
}

export async function startTestServer(app: Express): Promise<{
  server: Server;
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function httpJson<T = any>(
  baseUrl: string,
  method: string,
  path: string,
  options: {
    token?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; headers: Headers; body: T }> {
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  };

  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }

  let payload: string | undefined;
  if (options.rawBody !== undefined) {
    headers['content-type'] ??= 'application/json';
    payload = options.rawBody;
  } else if (options.body !== undefined) {
    headers['content-type'] ??= 'application/json';
    payload = JSON.stringify(options.body);
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: payload,
  });

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return {
    status: res.status,
    headers: res.headers,
    body: parsed as T,
  };
}
