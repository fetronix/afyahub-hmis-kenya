/**
 * Authentication service, against a real PostgreSQL
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
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users, sessions, loginAttempts } from '../db/schema';
import { hashPassword } from '../utils/password';
import { login, validateSession, revokeSession } from '../auth/auth.service';

import { expect, it } from 'vitest';

import { describeDb } from './vitest/support/db.ts';

const TEST_PASSWORD = 'JaliCareTestPassword2026!';

const TEST_IP = '127.0.0.1';

const TEST_USER_AGENT = 'JaliCare-Authentication-Test';

function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describeDb('Authentication service, against a real PostgreSQL', () => {
  it('sign-in, validation and lockout', async () => {
    let temporaryUserId: number | null = null;
    let adminUserId: number | null = null;

    const temporaryUsername = `auth_test_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

    const temporaryEmail = `${temporaryUsername}@test.jalicare.local`;

    try {
      /*
      |--------------------------------------------------------------------------
      | TEST 1 — Real Administrator Login
      |--------------------------------------------------------------------------
      */

      /*
       * This suite used to sign in as an administrator that was assumed to
       * already exist, named by ADMIN_USERNAME/ADMIN_PASSWORD. Nothing in the
       * repository creates that account: src/bootstrap-admin.ts does, but it
       * is a manual, separate step, and `npm run db:seed` does not call it.
       * On a fresh database the suite therefore failed every time it ran,
       * which is why it was never in the CI gate.
       *
       * It now creates the account it tests, exactly as TEST 5 already did for
       * the ordinary user, and deletes it in the cleanup below. Every
       * assertion is unchanged; they simply no longer depend on state outside
       * the test.
       */

      const adminUsername = `auth_admin_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

      const adminPassword = TEST_PASSWORD;

      const insertedAdmins = await db
        .insert(users)
        .values({
          uid: `usr_auth_admin_${crypto.randomUUID()}`,
          tenantId: null,
          facilityId: null,
          username: adminUsername,
          email: `${adminUsername}@test.jalicare.local`,
          fullName: 'JaliCare Authentication Test Administrator',
          phone: null,
          designation: 'Platform Administrator',
          passwordHash: await hashPassword(adminPassword),
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
        })
        .returning({
          id: users.id,
          username: users.username,
        });

      adminUserId = insertedAdmins[0].id;

      expect(adminUserId > 0, 'Test administrator was created').toBe(true);

      const adminLogin = await login({
        identifier: adminUsername,
        password: adminPassword,
        ipAddress: TEST_IP,
        userAgent: TEST_USER_AGENT,
      });

      expect(
        adminLogin.success === true,
        'Administrator can authenticate through AuthService',
      ).toBe(true);

      expect(!!adminLogin.sessionToken, 'Administrator receives a session token').toBe(true);

      expect(!!adminLogin.expiresAt, 'Administrator session has an expiration time').toBe(true);

      expect(
        adminLogin.user?.username === adminUsername,
        'Authenticated user is the administrator',
      ).toBe(true);

      const adminSessionToken = adminLogin.sessionToken!;

      /*
      |--------------------------------------------------------------------------
      | TEST 2 — Verify Admin Session Exists
      |--------------------------------------------------------------------------
      */

      const adminSessionHash = hashSessionToken(adminSessionToken);

      const adminSessionRows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.sessionTokenHash, adminSessionHash))
        .limit(1);

      expect(adminSessionRows.length === 1, 'Administrator session exists in database').toBe(true);

      expect(
        adminSessionRows[0].userId === adminLogin.user?.id,
        'Administrator session belongs to administrator',
      ).toBe(true);

      expect(
        adminSessionRows[0].sessionTokenHash !== adminSessionToken,
        'Raw administrator session token is not stored',
      ).toBe(true);

      /*
      |--------------------------------------------------------------------------
      | TEST 3 — Validate Admin Session
      |--------------------------------------------------------------------------
      */

      const validatedAdminSession = await validateSession(adminSessionToken);

      expect(validatedAdminSession !== null, 'Administrator session validates successfully').toBe(
        true,
      );

      expect(
        validatedAdminSession?.user.id === adminLogin.user?.id,
        'Validated session belongs to administrator',
      ).toBe(true);

      /*
      |--------------------------------------------------------------------------
      | TEST 4 — Revoke Admin Session
      |--------------------------------------------------------------------------
      */

      const adminRevoked = await revokeSession(adminSessionToken, 'AUTH_SERVICE_TEST');

      expect(adminRevoked === true, 'Administrator session can be revoked').toBe(true);

      const revokedAdminSession = await validateSession(adminSessionToken);

      expect(
        revokedAdminSession === null,
        'Revoked administrator session can no longer authenticate',
      ).toBe(true);

      /*
      |--------------------------------------------------------------------------
      | TEST 5 — Create Temporary Test User
      |--------------------------------------------------------------------------
      */

      const testPasswordHash = await hashPassword(TEST_PASSWORD);

      const insertedUsers = await db
        .insert(users)
        .values({
          uid: `usr_test_${crypto.randomUUID()}`,
          tenantId: null,
          facilityId: null,
          username: temporaryUsername,
          email: temporaryEmail,
          fullName: 'JaliCare Authentication Test User',
          phone: null,
          designation: 'Authentication Test Account',
          passwordHash: testPasswordHash,
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
        })
        .returning({
          id: users.id,
          username: users.username,
        });

      temporaryUserId = insertedUsers[0].id;

      expect(temporaryUserId > 0, 'Temporary authentication test user was created').toBe(true);

      /*
      |--------------------------------------------------------------------------
      | TEST 6 — Wrong Password #1
      |--------------------------------------------------------------------------
      */

      const attempt1 = await login({
        identifier: temporaryUsername,
        password: 'WrongPassword-1!',
        ipAddress: TEST_IP,
        userAgent: TEST_USER_AGENT,
      });

      expect(attempt1.success === false, 'Incorrect password #1 is rejected').toBe(true);

      let testUser = await db.select().from(users).where(eq(users.id, temporaryUserId)).limit(1);

      expect(testUser[0].failedLoginAttempts === 1, 'Failed login counter is 1').toBe(true);

      /*
      |--------------------------------------------------------------------------
      | TEST 7 — Wrong Password #2
      |--------------------------------------------------------------------------
      */

      const attempt2 = await login({
        identifier: temporaryUsername,
        password: 'WrongPassword-2!',
        ipAddress: TEST_IP,
        userAgent: TEST_USER_AGENT,
      });

      expect(attempt2.success === false, 'Incorrect password #2 is rejected').toBe(true);

      /*
      |--------------------------------------------------------------------------
      | TEST 8 — Wrong Password #3
      |--------------------------------------------------------------------------
      */

      const attempt3 = await login({
        identifier: temporaryUsername,
        password: 'WrongPassword-3!',
        ipAddress: TEST_IP,
        userAgent: TEST_USER_AGENT,
      });

      expect(attempt3.success === false, 'Incorrect password #3 is rejected').toBe(true);

      /*
      |--------------------------------------------------------------------------
      | TEST 9 — Wrong Password #4
      |--------------------------------------------------------------------------
      */

      const attempt4 = await login({
        identifier: temporaryUsername,
        password: 'WrongPassword-4!',
        ipAddress: TEST_IP,
        userAgent: TEST_USER_AGENT,
      });

      expect(attempt4.success === false, 'Incorrect password #4 is rejected').toBe(true);

      /*
      |--------------------------------------------------------------------------
      | TEST 10 — Wrong Password #5
      |--------------------------------------------------------------------------
      */

      const attempt5 = await login({
        identifier: temporaryUsername,
        password: 'WrongPassword-5!',
        ipAddress: TEST_IP,
        userAgent: TEST_USER_AGENT,
      });

      expect(attempt5.success === false, 'Incorrect password #5 is rejected').toBe(true);

      expect(
        (attempt5.message ?? '').toLowerCase().includes('locked'),
        'Account reports lockout after threshold is reached',
      ).toBe(true);

      /*
      |--------------------------------------------------------------------------
      | TEST 11 — Verify Real Database Lockout
      |--------------------------------------------------------------------------
      */

      testUser = await db.select().from(users).where(eq(users.id, temporaryUserId)).limit(1);

      expect(
        testUser[0].failedLoginAttempts === 5,
        'Database failedLoginAttempts is exactly 5',
      ).toBe(true);

      expect(testUser[0].lockedUntil !== null, 'Database lockedUntil is set').toBe(true);

      expect(testUser[0].lockedUntil!.getTime() > Date.now(), 'lockedUntil is in the future').toBe(
        true,
      );

      /*
      |--------------------------------------------------------------------------
      | TEST 12 — Correct Password While Locked
      |--------------------------------------------------------------------------
      */

      const lockedLogin = await login({
        identifier: temporaryUsername,
        password: TEST_PASSWORD,
        ipAddress: TEST_IP,
        userAgent: TEST_USER_AGENT,
      });

      expect(
        lockedLogin.success === false,
        'Correct password is rejected while account is locked',
      ).toBe(true);

      expect(
        (lockedLogin.message ?? '').toLowerCase().includes('locked'),
        'Authentication service identifies locked account',
      ).toBe(true);

      /*
      |--------------------------------------------------------------------------
      | TEST 13 — Expire Lockout
      |--------------------------------------------------------------------------
      */

      await db
        .update(users)
        .set({
          lockedUntil: new Date(Date.now() - 1000),
        })
        .where(eq(users.id, temporaryUserId));

      testUser = await db.select().from(users).where(eq(users.id, temporaryUserId)).limit(1);

      expect(testUser[0].lockedUntil!.getTime() < Date.now(), 'Temporary lockout has expired').toBe(
        true,
      );

      /*
      |--------------------------------------------------------------------------
      | TEST 14 — Login After Lockout Expiration
      |--------------------------------------------------------------------------
      */

      const recoveredLogin = await login({
        identifier: temporaryUsername,
        password: TEST_PASSWORD,
        ipAddress: TEST_IP,
        userAgent: TEST_USER_AGENT,
      });

      expect(
        recoveredLogin.success === true,
        'Correct password is accepted after lockout expires',
      ).toBe(true);

      expect(!!recoveredLogin.sessionToken, 'New session is created after successful login').toBe(
        true,
      );

      /*
      |--------------------------------------------------------------------------
      | TEST 15 — Verify Failed Counter Reset
      |--------------------------------------------------------------------------
      */

      testUser = await db.select().from(users).where(eq(users.id, temporaryUserId)).limit(1);

      expect(testUser[0].failedLoginAttempts === 0, 'Failed login counter resets to zero').toBe(
        true,
      );

      expect(testUser[0].lockedUntil === null, 'Lockout is cleared after successful login').toBe(
        true,
      );

      expect(testUser[0].lastLoginAt !== null, 'lastLoginAt is recorded').toBe(true);

      /*
      |--------------------------------------------------------------------------
      | TEST 16 — Validate New Session
      |--------------------------------------------------------------------------
      */

      const recoveredSession = await validateSession(recoveredLogin.sessionToken!);

      expect(recoveredSession !== null, 'Recovered session validates successfully').toBe(true);

      expect(
        recoveredSession?.user.id === temporaryUserId,
        'Recovered session belongs to test user',
      ).toBe(true);

      /*
      |--------------------------------------------------------------------------
      | TEST 17 — Revoke Recovered Session
      |--------------------------------------------------------------------------
      */

      const recoveredRevoked = await revokeSession(
        recoveredLogin.sessionToken!,
        'AUTH_SERVICE_TEST',
      );

      expect(recoveredRevoked === true, 'Recovered session can be revoked').toBe(true);

      const revokedRecoveredSession = await validateSession(recoveredLogin.sessionToken!);

      expect(revokedRecoveredSession === null, 'Revoked session is rejected').toBe(true);

      /*
      |--------------------------------------------------------------------------
      | TEST 18 — Verify Login Attempt Records
      |--------------------------------------------------------------------------
      */

      const attempts = await db
        .select()
        .from(loginAttempts)
        .where(eq(loginAttempts.userId, temporaryUserId));

      expect(attempts.length >= 7, 'Authentication attempts were recorded').toBe(true);

      const successfulAttempts = attempts.filter((attempt) => attempt.successful === true);

      const failedAttempts = attempts.filter((attempt) => attempt.successful === false);

      expect(successfulAttempts.length >= 1, 'Successful login was recorded').toBe(true);

      expect(failedAttempts.length >= 5, 'Failed login attempts were recorded').toBe(true);

      /*
      |--------------------------------------------------------------------------
      | SUCCESS
      |--------------------------------------------------------------------------
      */
    } finally {
      /*
      |--------------------------------------------------------------------------
      | CLEANUP
      |--------------------------------------------------------------------------
      */

      if (adminUserId !== null) {
        await db.delete(sessions).where(eq(sessions.userId, adminUserId));

        await db.delete(loginAttempts).where(eq(loginAttempts.userId, adminUserId));

        await db.delete(users).where(eq(users.id, adminUserId));
      }

      if (temporaryUserId !== null) {
        await db.delete(sessions).where(eq(sessions.userId, temporaryUserId));

        await db.delete(loginAttempts).where(eq(loginAttempts.userId, temporaryUserId));

        await db.delete(users).where(eq(users.id, temporaryUserId));
      }
    }
  });
});
