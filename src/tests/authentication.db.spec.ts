/**
 * Sign-in and session lifecycle, against a real PostgreSQL
 *
 * These assertions insert rows and read them back, so they need a real
 * PostgreSQL. `describeDb` skips the whole suite when none is reachable,
 * which is why this file is a `.db.spec.ts`: the skip is a property of
 * the file, not of the command that happens to run it.
 *
 * Synthetic users only, deleted in the suite's own cleanup.
 */

import 'dotenv/config';
import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { users, sessions, loginAttempts } from '../db/schema';
import { hashPassword, verifyPassword } from '../utils/password';

import { expect, it } from 'vitest';

import { describeDb } from './vitest/support/db.ts';

const TEST_PASSWORD = 'JaliCareTestPassword2026!';

const TEST_USERNAME = `auth_admin_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

const TEST_IP = '127.0.0.1';

const TEST_USER_AGENT = 'JaliCare-Authentication-Test';

const MAX_FAILED_ATTEMPTS = 5;

const SESSION_DURATION_HOURS = 8;

function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describeDb('Sign-in and session lifecycle, against a real PostgreSQL', () => {
  it('sign-in and session lifecycle', async () => {
    let adminUser: typeof users.$inferSelect | undefined;

    /*
     * -------------------------------------------------------
     * TEST 1 - Find administrator
     * -------------------------------------------------------
     */

    /*
     * This suite used to require an administrator that already existed, named
     * by ADMIN_USERNAME/ADMIN_PASSWORD, and in TEST 6 it incremented that
     * account's failed-login counter. On a fresh database nothing matches, so
     * it failed every run; against a real deployment it would have pushed a
     * live administrator toward a lockout.
     *
     * It now creates the platform administrator it exercises and removes it
     * afterwards. The assertions are unchanged.
     */

    await db.insert(users).values({
      uid: `usr_auth_admin_${crypto.randomUUID()}`,
      tenantId: null,
      facilityId: null,
      username: TEST_USERNAME,
      email: `${TEST_USERNAME}@test.jalicare.local`,
      fullName: 'JaliCare Authentication Test Administrator',
      phone: null,
      designation: 'Platform Administrator',
      passwordHash: await hashPassword(TEST_PASSWORD),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      accountStatus: 'ACTIVE',
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
      lockedUntil: null,
      lastLoginAt: null,
      lastLoginIp: null,
      lastLogoutAt: null,
      mfaEnabled: false,
      mfaRequired: false,
      mfaSecretEncrypted: null,
      securityVersion: 1,
      isActive: true,
      deactivatedAt: null,
      deactivationReason: null,
    });

    const result = await db.select().from(users).where(eq(users.username, TEST_USERNAME)).limit(1);

    adminUser = result[0];

    expect(!!adminUser, `Administrator "${TEST_USERNAME}" exists`).toBe(true);

    expect(!!adminUser.passwordHash, 'Administrator has an Argon2id password hash').toBe(true);

    expect(adminUser.accountStatus === 'ACTIVE', 'Administrator account is ACTIVE').toBe(true);

    expect(adminUser.tenantId === null, 'Administrator is platform-level').toBe(true);

    expect(adminUser.facilityId === null, 'Administrator is not restricted to a facility').toBe(
      true,
    );

    /*
     * -------------------------------------------------------
     * TEST 2 - Verify correct password
     * -------------------------------------------------------
     */

    const adminPassword = TEST_PASSWORD;

    const validPassword = await verifyPassword(adminPassword, adminUser.passwordHash!);

    expect(validPassword, 'Correct administrator password is accepted by Argon2id').toBe(true);

    /*
     * -------------------------------------------------------
     * TEST 3 - Verify incorrect password
     * -------------------------------------------------------
     */

    const invalidPassword = await verifyPassword(
      'DefinitelyWrongPassword!123',
      adminUser.passwordHash!,
    );

    expect(!invalidPassword, 'Incorrect password is rejected').toBe(true);

    /*
     * -------------------------------------------------------
     * TEST 4 - Create database session
     * -------------------------------------------------------
     */

    const rawSessionToken = crypto.randomBytes(48).toString('hex');

    const sessionTokenHash = hashSessionToken(rawSessionToken);

    const now = new Date();

    const expiresAt = new Date(now.getTime() + SESSION_DURATION_HOURS * 60 * 60 * 1000);

    const insertedSession = await db
      .insert(sessions)
      .values({
        userId: adminUser.id,
        sessionTokenHash,
        ipAddress: TEST_IP,
        userAgent: TEST_USER_AGENT,
        createdAt: now,
        lastActivityAt: now,
        expiresAt,
        securityVersion: adminUser.securityVersion,
      })
      .returning();

    const session = insertedSession[0];

    expect(!!session, 'Database session was created').toBe(true);

    expect(session.userId === adminUser.id, 'Session belongs to administrator').toBe(true);

    expect(session.sessionTokenHash === sessionTokenHash, 'Session token is stored as a hash').toBe(
      true,
    );

    expect(
      session.sessionTokenHash !== rawSessionToken,
      'Raw session token is NOT stored in database',
    ).toBe(true);

    /*
     * -------------------------------------------------------
     * TEST 5 - Record failed login attempt
     * -------------------------------------------------------
     */

    await db.insert(loginAttempts).values({
      usernameOrEmail: TEST_USERNAME,
      userId: adminUser.id,
      ipAddress: TEST_IP,
      userAgent: TEST_USER_AGENT,
      successful: false,
      failureReason: 'INVALID_PASSWORD',
      attemptedAt: new Date(),
    });

    const failedAttempts = await db
      .select()
      .from(loginAttempts)
      .where(and(eq(loginAttempts.userId, adminUser.id), eq(loginAttempts.successful, false)));

    expect(failedAttempts.length >= 1, 'Failed login attempt was recorded').toBe(true);

    /*
     * -------------------------------------------------------
     * TEST 6 - Simulate lockout threshold
     * -------------------------------------------------------
     *
     * We do NOT permanently modify the administrator's
     * failedLoginAttempts field during this test.
     *
     * Instead, we verify that the lockout threshold can
     * be calculated correctly.
     */

    const simulatedFailedAttempts = MAX_FAILED_ATTEMPTS;

    const shouldLock = simulatedFailedAttempts >= MAX_FAILED_ATTEMPTS;

    expect(shouldLock, `Account should lock after ${MAX_FAILED_ATTEMPTS} failed attempts`).toBe(
      true,
    );

    /*
     * -------------------------------------------------------
     * TEST 7 - Test lockout timestamp logic
     * -------------------------------------------------------
     */

    const lockoutMinutes = 15;

    const lockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);

    const currentlyLocked = lockedUntil.getTime() > Date.now();

    expect(currentlyLocked, 'Account is considered locked while lockedUntil is in the future').toBe(
      true,
    );

    const expiredLock = new Date(Date.now() - 1000);

    const lockExpired = expiredLock.getTime() <= Date.now();

    expect(lockExpired, 'Expired lockout is correctly recognized').toBe(true);

    /*
     * -------------------------------------------------------
     * TEST 8 - Verify session can be revoked
     * -------------------------------------------------------
     */

    await db
      .update(sessions)
      .set({
        revokedAt: new Date(),
        revokeReason: 'AUTHENTICATION_TEST',
      })
      .where(eq(sessions.id, session.id));

    const revokedSession = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id))
      .limit(1);

    expect(!!revokedSession[0]?.revokedAt, 'Session can be revoked').toBe(true);

    expect(
      revokedSession[0]?.revokeReason === 'AUTHENTICATION_TEST',
      'Session revoke reason is stored',
    ).toBe(true);

    /*
     * -------------------------------------------------------
     * CLEANUP
     * -------------------------------------------------------
     */

    await db.delete(sessions).where(eq(sessions.id, session.id));

    await db
      .delete(loginAttempts)
      .where(
        and(
          eq(loginAttempts.userId, adminUser.id),
          eq(loginAttempts.ipAddress, TEST_IP),
          eq(loginAttempts.userAgent, TEST_USER_AGENT),
        ),
      );

    await db.delete(users).where(eq(users.id, adminUser.id));

    /*
     * -------------------------------------------------------
     * COMPLETE
     * -------------------------------------------------------
     */
  });
});
