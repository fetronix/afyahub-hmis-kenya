/**
 * JaliCare HMIS
 * Patient portal — authentication
 *
 * A patient identity is not a staff identity. It lives in its own table,
 * has its own session table and its own middleware, and its sessions are
 * two hours rather than eight. Nothing here can mint a staff session and
 * nothing in the staff middleware accepts a patient token.
 */

import { createHash, randomBytes } from 'node:crypto';

import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import { hashPassword, verifyPassword } from '../utils/password.ts';

import {
  LOGIN_LOCK_MINUTES,
  MAX_FAILED_LOGINS,
  PATIENT_SESSION_HOURS,
  checkPortalPassword,
  normaliseContact,
} from './portal-policy.ts';

import { PortalError } from './portal.service.ts';

export interface PortalAccountRow {
  id: number;
  tenantId: number;
  facilityId: number | null;
  patientId: number;
  loginIdentifier: string;
  loginType: string;
  status: string;
  securityVersion: number;
}

export interface PortalSession {
  accountId: number;
  patientId: number;
  tenantId: number;
  facilityId: number | null;
  sessionId: number;
  loginIdentifier: string;
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/* ============================================================
   Login
   ============================================================ */

/**
 * Log a patient in.
 *
 * The same generic message covers "no such account" and "wrong
 * password", because a distinctive error on this endpoint would let
 * anyone with a phone number test whether a person is a patient at a
 * given facility. Lockout is counted per account, not per IP: an
 * attacker rotating addresses still runs into it.
 */
export async function portalLogin(
  input: { identifier: unknown; password: unknown },
  request?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<{
  sessionToken: string;
  expiresAt: Date;
  account: PortalAccountRow;
  firstName: string;
  lastName: string;
}> {
  const identifier = typeof input.identifier === 'string' ? input.identifier.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';

  const generic = new PortalError(
    'Those details did not match an account. Check them and try again, or contact the facility.',
    401,
    'INVALID_CREDENTIALS',
  );

  if (identifier === '' || password === '') {
    throw generic;
  }

  const normalised = normaliseContact({ phone: identifier, email: identifier });

  if (!normalised) {
    throw generic;
  }

  const [account] = await db
    .select()
    .from(schema.patientPortalAccounts)
    .where(eq(schema.patientPortalAccounts.loginIdentifier, normalised.value))
    .limit(1);

  if (!account) {
    throw generic;
  }

  /*
   * The password is checked **before** anything is said about the
   * account's existence or state.
   *
   * The earlier version returned distinct errors for a suspended,
   * revoked or unverified account. That turned the sign-in form into a
   * lookup service: anyone holding a phone number could learn whether
   * that number belongs to a patient here, and how their access stands.
   * Now every unproven caller gets the same generic refusal; only
   * someone who already knows the password is told that the account is
   * suspended or locked.
   */
  const valid = await verifyPassword(password, account.passwordHash);

  if (!valid) {
    const attempts = account.failedLoginAttempts + 1;
    const lockedUntil =
      attempts >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000) : null;

    await db
      .update(schema.patientPortalAccounts)
      .set({
        failedLoginAttempts: lockedUntil ? 0 : attempts,
        lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(schema.patientPortalAccounts.id, account.id));

    throw generic;
  }

  if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
    /*
     * A correct password does not unlock the account. The lock exists
     * because someone was guessing; the patient is told to wait or ask
     * the facility, and nothing about the record is returned.
     */
    throw new PortalError(
      'Too many failed attempts. Try again in a few minutes, or contact the facility.',
      429,
      'ACCOUNT_LOCKED',
    );
  }

  if (account.status === 'REVOKED') {
    throw new PortalError(
      'This account no longer has access. Contact the facility for help.',
      403,
      'ACCOUNT_REVOKED',
    );
  }

  if (account.status === 'SUSPENDED') {
    throw new PortalError(
      'This account is suspended. Contact the facility to restore it.',
      403,
      'ACCOUNT_SUSPENDED',
    );
  }

  if (account.status === 'PENDING_VERIFICATION') {
    throw new PortalError(
      'This account still needs a staff member to verify your identity. Visit the reception desk.',
      403,
      'ACCOUNT_PENDING_VERIFICATION',
    );
  }

  if (account.failedLoginAttempts !== 0 || account.lockedUntil) {
    await db
      .update(schema.patientPortalAccounts)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(schema.patientPortalAccounts.id, account.id));
  }

  const [patient] = await db
    .select({
      firstName: schema.patients.firstName,
      lastName: schema.patients.lastName,
    })
    .from(schema.patients)
    .where(eq(schema.patients.id, account.patientId))
    .limit(1);

  const sessionToken = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + PATIENT_SESSION_HOURS * 60 * 60 * 1000);

  await db.insert(schema.patientPortalSessions).values({
    accountId: account.id,
    sessionTokenHash: hashSessionToken(sessionToken),
    ipAddress: request?.ipAddress ?? null,
    userAgent: request?.userAgent ?? null,
    expiresAt,
  });

  await db
    .update(schema.patientPortalAccounts)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.patientPortalAccounts.id, account.id));

  return {
    sessionToken,
    expiresAt,
    account: {
      id: account.id,
      tenantId: account.tenantId,
      facilityId: account.facilityId,
      patientId: account.patientId,
      loginIdentifier: account.loginIdentifier,
      loginType: account.loginType,
      status: account.status,
      securityVersion: account.securityVersion,
    },
    firstName: patient?.firstName ?? '',
    lastName: patient?.lastName ?? '',
  };
}

/* ============================================================
   Session validation
   ============================================================ */

/**
 * Resolve a bearer token into a portal session.
 *
 * Returns null for every failure mode — expired, revoked, wrong account
 * status — because the middleware turns that into one 401. The patient
 * does not need to know which of them happened, and an attacker probing
 * tokens learns nothing from a uniform answer.
 */
export async function resolvePortalSession(rawToken: string): Promise<PortalSession | null> {
  if (!rawToken || rawToken.length < 20 || rawToken.length > 200) return null;

  const tokenHash = hashSessionToken(rawToken);

  const [row] = await db
    .select({
      accountId: schema.patientPortalAccounts.id,
      patientId: schema.patientPortalAccounts.patientId,
      tenantId: schema.patientPortalAccounts.tenantId,
      facilityId: schema.patientPortalAccounts.facilityId,
      loginIdentifier: schema.patientPortalAccounts.loginIdentifier,
      status: schema.patientPortalAccounts.status,
      sessionId: schema.patientPortalSessions.id,
      expiresAt: schema.patientPortalSessions.expiresAt,
      revokedAt: schema.patientPortalSessions.revokedAt,
    })
    .from(schema.patientPortalSessions)
    .innerJoin(
      schema.patientPortalAccounts,
      eq(schema.patientPortalSessions.accountId, schema.patientPortalAccounts.id),
    )
    .where(eq(schema.patientPortalSessions.sessionTokenHash, tokenHash))
    .limit(1);

  if (!row) return null;

  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  if (row.status !== 'ACTIVE') return null;

  await db
    .update(schema.patientPortalSessions)
    .set({ lastActivityAt: new Date() })
    .where(eq(schema.patientPortalSessions.id, row.sessionId));

  return {
    accountId: row.accountId,
    patientId: row.patientId,
    tenantId: row.tenantId,
    facilityId: row.facilityId,
    sessionId: row.sessionId,
    loginIdentifier: row.loginIdentifier,
  };
}

export async function revokePortalSession(rawToken: string, reason: string): Promise<void> {
  if (!rawToken) return;

  await db
    .update(schema.patientPortalSessions)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(eq(schema.patientPortalSessions.sessionTokenHash, hashSessionToken(rawToken)));
}

/**
 * Revoke every session for an account.
 *
 * Called on suspension and on password change. Without this, a stolen
 * session would outlive the password reset that was meant to contain it.
 */
export async function revokeAllPortalSessions(accountId: number, reason: string): Promise<number> {
  const revoked = await db
    .update(schema.patientPortalSessions)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(
      and(
        eq(schema.patientPortalSessions.accountId, accountId),
        isNull(schema.patientPortalSessions.revokedAt),
      ),
    )
    .returning({ id: schema.patientPortalSessions.id });

  return revoked.length;
}

/** Housekeeping: delete expired sessions for one account. */
export async function prunePortalSessions(accountId: number): Promise<void> {
  await db
    .delete(schema.patientPortalSessions)
    .where(
      and(
        eq(schema.patientPortalSessions.accountId, accountId),
        lt(schema.patientPortalSessions.expiresAt, new Date()),
      ),
    );
}

/* ============================================================
   Password change
   ============================================================ */

export async function changePortalPassword(
  session: PortalSession,
  input: { currentPassword: unknown; newPassword: unknown; confirmPassword: unknown },
): Promise<{ sessionsRevoked: number }> {
  const currentPassword = typeof input.currentPassword === 'string' ? input.currentPassword : '';
  const newPassword = input.newPassword;

  const [account] = await db
    .select()
    .from(schema.patientPortalAccounts)
    .where(eq(schema.patientPortalAccounts.id, session.accountId))
    .limit(1);

  if (!account) {
    throw new PortalError('Account not found.', 404, 'ACCOUNT_NOT_FOUND');
  }

  const valid = await verifyPassword(currentPassword, account.passwordHash);

  if (!valid) {
    throw new PortalError('The current password is not correct.', 400, 'INVALID_PASSWORD');
  }

  if (newPassword !== input.confirmPassword) {
    throw new PortalError('The two new passwords do not match.', 400, 'PASSWORD_MISMATCH');
  }

  const check = checkPortalPassword(newPassword);

  if (!check.ok) {
    throw new PortalError(check.reason ?? 'Choose a stronger password.', 400, 'WEAK_PASSWORD');
  }

  if (newPassword === currentPassword) {
    throw new PortalError(
      'Choose a password you have not used here before.',
      400,
      'PASSWORD_REUSED',
    );
  }

  const passwordHash = await hashPassword(String(newPassword));

  await db
    .update(schema.patientPortalAccounts)
    .set({
      passwordHash,
      mustChangePassword: false,
      securityVersion: sql`${schema.patientPortalAccounts.securityVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.patientPortalAccounts.id, account.id));

  const sessionsRevoked = await revokeAllPortalSessions(account.id, 'Password changed');

  return { sessionsRevoked };
}

/* ============================================================
   Account overview
   ============================================================ */

export async function getPortalAccountSummary(session: PortalSession) {
  const [account] = await db
    .select({
      id: schema.patientPortalAccounts.id,
      loginIdentifier: schema.patientPortalAccounts.loginIdentifier,
      loginType: schema.patientPortalAccounts.loginType,
      status: schema.patientPortalAccounts.status,
      activatedAt: schema.patientPortalAccounts.activatedAt,
      lastLoginAt: schema.patientPortalAccounts.lastLoginAt,
      hasQrCard: schema.patientPortalAccounts.qrTokenHash,
    })
    .from(schema.patientPortalAccounts)
    .where(eq(schema.patientPortalAccounts.id, session.accountId))
    .limit(1);

  const [patient] = await db
    .select({
      id: schema.patients.id,
      mrn: schema.patients.mrn,
      firstName: schema.patients.firstName,
      middleName: schema.patients.middleName,
      lastName: schema.patients.lastName,
      dateOfBirth: schema.patients.dateOfBirth,
      gender: schema.patients.gender,
      phone: schema.patients.phone,
      county: schema.patients.county,
    })
    .from(schema.patients)
    .where(eq(schema.patients.id, session.patientId))
    .limit(1);

  const [facility] = session.facilityId
    ? await db
        .select({ name: schema.facilities.name })
        .from(schema.facilities)
        .where(eq(schema.facilities.id, session.facilityId))
        .limit(1)
    : [];

  return {
    account: account
      ? {
          id: account.id,
          loginIdentifier: account.loginIdentifier,
          loginType: account.loginType,
          status: account.status,
          activatedAt: account.activatedAt,
          lastLoginAt: account.lastLoginAt,
          hasDigitalCard: Boolean(account.hasQrCard),
        }
      : null,
    patient: patient ?? null,
    facilityName: facility?.name ?? null,
  };
}
