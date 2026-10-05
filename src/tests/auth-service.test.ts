import "dotenv/config";
import crypto from "crypto";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  sessions,
  loginAttempts,
} from "../db/schema";

import { hashPassword } from "../utils/password";
import {
  login,
  validateSession,
  revokeSession,
} from "../auth/auth.service";

/*
|--------------------------------------------------------------------------
| Test Configuration
|--------------------------------------------------------------------------
*/

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const TEST_PASSWORD = "JaliCareTestPassword2026!";

const TEST_IP = "127.0.0.1";
const TEST_USER_AGENT = "JaliCare-Authentication-Test";

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function requireEnvironmentVariable(
  name: string,
  value: string | undefined
): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}`
    );
  }

  return value;
}

function hashSessionToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function assert(
  condition: boolean,
  message: string
): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }

  console.log(`✓ ${message}`);
}

/*
|--------------------------------------------------------------------------
| Main Test
|--------------------------------------------------------------------------
*/

async function runAuthenticationServiceTest() {
  console.log("");
  console.log("==============================================");
  console.log("JaliCare HMIS - Authentication Service Test");
  console.log("==============================================");
  console.log("");

  const adminUsername = requireEnvironmentVariable(
    "ADMIN_USERNAME",
    ADMIN_USERNAME
  );

  const adminPassword = requireEnvironmentVariable(
    "ADMIN_PASSWORD",
    ADMIN_PASSWORD
  );

  let temporaryUserId: number | null = null;

  const temporaryUsername =
    `auth_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

  const temporaryEmail =
    `${temporaryUsername}@test.jalicare.local`;

  /*
  |--------------------------------------------------------------------------
  | TEST 1 — Real Administrator Login
  |--------------------------------------------------------------------------
  */

  console.log("TEST 1: Testing real administrator login...");

  const adminLogin = await login({
    identifier: adminUsername,
    password: adminPassword,
    ipAddress: TEST_IP,
    userAgent: TEST_USER_AGENT,
  });

  assert(
    adminLogin.success === true,
    "Administrator can authenticate through AuthService"
  );

  assert(
    !!adminLogin.sessionToken,
    "Administrator receives a session token"
  );

  assert(
    !!adminLogin.expiresAt,
    "Administrator session has an expiration time"
  );

  assert(
    adminLogin.user?.username === adminUsername,
    "Authenticated user is the administrator"
  );

  const adminSessionToken = adminLogin.sessionToken!;

  /*
  |--------------------------------------------------------------------------
  | TEST 2 — Verify Admin Session Exists
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 2: Validating administrator session...");

  const adminSessionHash =
    hashSessionToken(adminSessionToken);

  const adminSessionRows = await db
    .select()
    .from(sessions)
    .where(
      eq(
        sessions.sessionTokenHash,
        adminSessionHash
      )
    )
    .limit(1);

  assert(
    adminSessionRows.length === 1,
    "Administrator session exists in database"
  );

  assert(
    adminSessionRows[0].userId === adminLogin.user?.id,
    "Administrator session belongs to administrator"
  );

  assert(
    adminSessionRows[0].sessionTokenHash !== adminSessionToken,
    "Raw administrator session token is not stored"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 3 — Validate Admin Session
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 3: Testing session validation...");

  const validatedAdminSession =
    await validateSession(adminSessionToken);

  assert(
    validatedAdminSession !== null,
    "Administrator session validates successfully"
  );

  assert(
    validatedAdminSession?.user.id === adminLogin.user?.id,
    "Validated session belongs to administrator"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 4 — Revoke Admin Session
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 4: Testing administrator session revocation...");

  const adminRevoked = await revokeSession(
    adminSessionToken,
    "AUTH_SERVICE_TEST"
  );

  assert(
    adminRevoked === true,
    "Administrator session can be revoked"
  );

  const revokedAdminSession =
    await validateSession(adminSessionToken);

  assert(
    revokedAdminSession === null,
    "Revoked administrator session can no longer authenticate"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 5 — Create Temporary Test User
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 5: Creating temporary authentication test user...");

  const testPasswordHash =
    await hashPassword(TEST_PASSWORD);

  const insertedUsers = await db
    .insert(users)
    .values({
      uid: `usr_test_${crypto.randomUUID()}`,
      tenantId: null,
      facilityId: null,
      username: temporaryUsername,
      email: temporaryEmail,
      fullName: "JaliCare Authentication Test User",
      phone: null,
      designation: "Authentication Test Account",
      passwordHash: testPasswordHash,
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      accountStatus: "ACTIVE",
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

  assert(
    temporaryUserId > 0,
    "Temporary authentication test user was created"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 6 — Wrong Password #1
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 6: Testing failed login attempt #1...");

  const attempt1 = await login({
    identifier: temporaryUsername,
    password: "WrongPassword-1!",
    ipAddress: TEST_IP,
    userAgent: TEST_USER_AGENT,
  });

  assert(
    attempt1.success === false,
    "Incorrect password #1 is rejected"
  );

  let testUser = await db
    .select()
    .from(users)
    .where(eq(users.id, temporaryUserId))
    .limit(1);

  assert(
    testUser[0].failedLoginAttempts === 1,
    "Failed login counter is 1"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 7 — Wrong Password #2
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 7: Testing failed login attempt #2...");

  const attempt2 = await login({
    identifier: temporaryUsername,
    password: "WrongPassword-2!",
    ipAddress: TEST_IP,
    userAgent: TEST_USER_AGENT,
  });

  assert(
    attempt2.success === false,
    "Incorrect password #2 is rejected"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 8 — Wrong Password #3
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 8: Testing failed login attempt #3...");

  const attempt3 = await login({
    identifier: temporaryUsername,
    password: "WrongPassword-3!",
    ipAddress: TEST_IP,
    userAgent: TEST_USER_AGENT,
  });

  assert(
    attempt3.success === false,
    "Incorrect password #3 is rejected"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 9 — Wrong Password #4
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 9: Testing failed login attempt #4...");

  const attempt4 = await login({
    identifier: temporaryUsername,
    password: "WrongPassword-4!",
    ipAddress: TEST_IP,
    userAgent: TEST_USER_AGENT,
  });

  assert(
    attempt4.success === false,
    "Incorrect password #4 is rejected"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 10 — Wrong Password #5
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 10: Testing failed login attempt #5 and lockout...");

  const attempt5 = await login({
    identifier: temporaryUsername,
    password: "WrongPassword-5!",
    ipAddress: TEST_IP,
    userAgent: TEST_USER_AGENT,
  });

  assert(
    attempt5.success === false,
    "Incorrect password #5 is rejected"
  );

  assert(
    attempt5.message.includes("locked"),
    "Account reports lockout after threshold is reached"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 11 — Verify Real Database Lockout
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 11: Verifying database-backed lockout...");

  testUser = await db
    .select()
    .from(users)
    .where(eq(users.id, temporaryUserId))
    .limit(1);

  assert(
    testUser[0].failedLoginAttempts === 5,
    "Database failedLoginAttempts is exactly 5"
  );

  assert(
    testUser[0].lockedUntil !== null,
    "Database lockedUntil is set"
  );

  assert(
    testUser[0].lockedUntil!.getTime() > Date.now(),
    "lockedUntil is in the future"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 12 — Correct Password While Locked
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 12: Testing correct password while account is locked...");

  const lockedLogin = await login({
    identifier: temporaryUsername,
    password: TEST_PASSWORD,
    ipAddress: TEST_IP,
    userAgent: TEST_USER_AGENT,
  });

  assert(
    lockedLogin.success === false,
    "Correct password is rejected while account is locked"
  );

  assert(
    lockedLogin.message.toLowerCase().includes("locked"),
    "Authentication service identifies locked account"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 13 — Expire Lockout
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 13: Expiring temporary account lockout...");

  await db
    .update(users)
    .set({
      lockedUntil: new Date(Date.now() - 1000),
    })
    .where(eq(users.id, temporaryUserId));

  testUser = await db
    .select()
    .from(users)
    .where(eq(users.id, temporaryUserId))
    .limit(1);

  assert(
    testUser[0].lockedUntil!.getTime() < Date.now(),
    "Temporary lockout has expired"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 14 — Login After Lockout Expiration
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 14: Testing successful login after lockout expires...");

  const recoveredLogin = await login({
    identifier: temporaryUsername,
    password: TEST_PASSWORD,
    ipAddress: TEST_IP,
    userAgent: TEST_USER_AGENT,
  });

  assert(
    recoveredLogin.success === true,
    "Correct password is accepted after lockout expires"
  );

  assert(
    !!recoveredLogin.sessionToken,
    "New session is created after successful login"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 15 — Verify Failed Counter Reset
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 15: Verifying security counters reset after login...");

  testUser = await db
    .select()
    .from(users)
    .where(eq(users.id, temporaryUserId))
    .limit(1);

  assert(
    testUser[0].failedLoginAttempts === 0,
    "Failed login counter resets to zero"
  );

  assert(
    testUser[0].lockedUntil === null,
    "Lockout is cleared after successful login"
  );

  assert(
    testUser[0].lastLoginAt !== null,
    "lastLoginAt is recorded"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 16 — Validate New Session
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 16: Validating recovered login session...");

  const recoveredSession =
    await validateSession(
      recoveredLogin.sessionToken!
    );

  assert(
    recoveredSession !== null,
    "Recovered session validates successfully"
  );

  assert(
    recoveredSession?.user.id === temporaryUserId,
    "Recovered session belongs to test user"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 17 — Revoke Recovered Session
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 17: Revoking recovered session...");

  const recoveredRevoked =
    await revokeSession(
      recoveredLogin.sessionToken!,
      "AUTH_SERVICE_TEST"
    );

  assert(
    recoveredRevoked === true,
    "Recovered session can be revoked"
  );

  const revokedRecoveredSession =
    await validateSession(
      recoveredLogin.sessionToken!
    );

  assert(
    revokedRecoveredSession === null,
    "Revoked session is rejected"
  );

  /*
  |--------------------------------------------------------------------------
  | TEST 18 — Verify Login Attempt Records
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("TEST 18: Verifying login attempt audit records...");

  const attempts = await db
    .select()
    .from(loginAttempts)
    .where(
      eq(
        loginAttempts.userId,
        temporaryUserId
      )
    );

  assert(
    attempts.length >= 7,
    "Authentication attempts were recorded"
  );

  const successfulAttempts =
    attempts.filter(
      (attempt) => attempt.successful === true
    );

  const failedAttempts =
    attempts.filter(
      (attempt) => attempt.successful === false
    );

  assert(
    successfulAttempts.length >= 1,
    "Successful login was recorded"
  );

  assert(
    failedAttempts.length >= 5,
    "Failed login attempts were recorded"
  );

  /*
  |--------------------------------------------------------------------------
  | CLEANUP
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("Cleaning up authentication test records...");

  if (temporaryUserId !== null) {
    await db
      .delete(sessions)
      .where(
        eq(
          sessions.userId,
          temporaryUserId
        )
      );

    await db
      .delete(loginAttempts)
      .where(
        eq(
          loginAttempts.userId,
          temporaryUserId
        )
      );

    await db
      .delete(users)
      .where(
        eq(
          users.id,
          temporaryUserId
        )
      );
  }

  console.log("✓ Temporary sessions removed");
  console.log("✓ Temporary login attempts removed");
  console.log("✓ Temporary test user removed");

  console.log("");
  console.log("==============================================");
  console.log("AUTHENTICATION SERVICE TEST PASSED");
  console.log("==============================================");
  console.log("");
  console.log("Verified:");
  console.log("✓ Real administrator login");
  console.log("✓ Administrator session creation");
  console.log("✓ Raw session token is not stored");
  console.log("✓ Session validation");
  console.log("✓ Session revocation");
  console.log("✓ Failed login tracking");
  console.log("✓ Database-backed lockout after 5 failures");
  console.log("✓ Correct password rejected while locked");
  console.log("✓ Lockout expiration");
  console.log("✓ Successful login after lockout expiration");
  console.log("✓ Failed-attempt counter reset");
  console.log("✓ Login audit records");
  console.log("");
}

/*
|--------------------------------------------------------------------------
| Execute
|--------------------------------------------------------------------------
*/

runAuthenticationServiceTest()
  .catch((error) => {
    console.error("");
    console.error("==============================================");
    console.error("AUTHENTICATION SERVICE TEST FAILED");
    console.error("==============================================");
    console.error("");
    console.error(error);
    console.error("");

    process.exitCode = 1;
  });