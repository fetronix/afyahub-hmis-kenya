import { and, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  loginAttempts,
} from "../db/schema";

import { verifyPassword } from "../utils/password";

import {
  createSession,
  validateSession as validateDatabaseSession,
  revokeSession as revokeDatabaseSession,
  revokeAllUserSessions as revokeAllDatabaseSessions,
} from "./session.service";

import type {
  LoginInput,
  AuthenticatedUser,
  LoginResult,
} from "./auth.types";


/*
|--------------------------------------------------------------------------
| Authentication Configuration
|--------------------------------------------------------------------------
*/

const MAX_FAILED_LOGIN_ATTEMPTS = 5;

const LOCKOUT_DURATION_MINUTES = 15;


/*
|--------------------------------------------------------------------------
| Utility Functions
|--------------------------------------------------------------------------
*/

/**
 * Convert a database user into the safe user object
 * returned by the authentication layer.
 *
 * Never expose passwordHash or other sensitive fields.
 */
function toAuthenticatedUser(
  user: typeof users.$inferSelect,
): AuthenticatedUser {
  return {
    id: user.id,
    uid: user.uid,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    tenantId: user.tenantId,
    facilityId: user.facilityId,
    accountStatus: user.accountStatus,
    mustChangePassword: user.mustChangePassword,
    mfaEnabled: user.mfaEnabled,
    mfaRequired: user.mfaRequired,
  };
}


/**
 * Normalize username/email identifiers.
 */
function normalizeIdentifier(
  identifier: string,
): string {
  return identifier
    .trim()
    .toLowerCase();
}


/**
 * Calculate temporary account lock expiration.
 */
function getLockoutExpiry(): Date {
  return new Date(
    Date.now() +
      LOCKOUT_DURATION_MINUTES * 60 * 1000,
  );
}


/*
|--------------------------------------------------------------------------
| Find User
|--------------------------------------------------------------------------
*/

async function findUser(
  identifier: string,
) {
  const normalizedIdentifier =
    normalizeIdentifier(identifier);

  const result =
    await db
      .select()
      .from(users)
      .where(
        or(
          eq(
            users.username,
            normalizedIdentifier,
          ),
          eq(
            users.email,
            normalizedIdentifier,
          ),
        ),
      )
      .limit(1);

  return result[0] ?? null;
}


/*
|--------------------------------------------------------------------------
| Record Login Attempt
|--------------------------------------------------------------------------
*/

async function recordLoginAttempt(
  params: {
    identifier: string;
    userId?: number;
    ipAddress?: string | null;
    userAgent?: string | null;
    successful: boolean;
    failureReason?: string;
  },
): Promise<void> {
  await db
    .insert(loginAttempts)
    .values({
      usernameOrEmail:
        params.identifier,

      userId:
        params.userId ?? null,

      ipAddress:
        params.ipAddress ?? null,

      userAgent:
        params.userAgent ?? null,

      successful:
        params.successful,

      failureReason:
        params.failureReason ?? null,
    });
}


/*
|--------------------------------------------------------------------------
| Clear Expired Lockout
|--------------------------------------------------------------------------
*/

async function clearExpiredLockout(
  user: typeof users.$inferSelect,
): Promise<void> {
  if (
    user.lockedUntil &&
    user.lockedUntil.getTime() <= Date.now()
  ) {
    await db
      .update(users)
      .set({
        lockedUntil: null,

        failedLoginAttempts: 0,

        lastFailedLoginAt: null,

        accountStatus:
          user.accountStatus === "LOCKED"
            ? "ACTIVE"
            : user.accountStatus,

        updatedAt:
          new Date(),
      })
      .where(
        eq(
          users.id,
          user.id,
        ),
      );
  }
}


/*
|--------------------------------------------------------------------------
| LOGIN
|--------------------------------------------------------------------------
*/

export async function login(
  input: LoginInput,
): Promise<LoginResult> {

  /*
   * Normalize identifier.
   */
  const identifier =
    normalizeIdentifier(
      input.identifier,
    );


  /*
   * Basic validation.
   */
  if (
    !identifier ||
    !input.password
  ) {
    return {
      success: false,

      message:
        "Invalid username/email or password.",

      error:
        "INVALID_CREDENTIALS",
    };
  }


  /*
   * Find account.
   *
   * We deliberately return the same generic
   * credentials error when the account doesn't exist.
   */
  const user =
    await findUser(identifier);


  if (!user) {

    await recordLoginAttempt({
      identifier,

      ipAddress:
        input.ipAddress,

      userAgent:
        input.userAgent,

      successful:
        false,

      failureReason:
        "INVALID_CREDENTIALS",
    });

    return {
      success: false,

      message:
        "Invalid username/email or password.",

      error:
        "INVALID_CREDENTIALS",
    };
  }


  /*
   * Clear an expired temporary lock.
   */
  if (
    user.lockedUntil &&
    user.lockedUntil.getTime() <= Date.now()
  ) {
    await clearExpiredLockout(user);
  }


  /*
   * Check active temporary lock.
   */
  if (
    user.lockedUntil &&
    user.lockedUntil.getTime() > Date.now()
  ) {

    await recordLoginAttempt({
      identifier,

      userId:
        user.id,

      ipAddress:
        input.ipAddress,

      userAgent:
        input.userAgent,

      successful:
        false,

      failureReason:
        "ACCOUNT_LOCKED",
    });

    return {
      success: false,

      message:
        "This account is temporarily locked. Please try again later.",

      error:
        "ACCOUNT_LOCKED",
    };
  }


  /*
   * Account availability.
   */
  if (
    !user.isActive ||
    user.accountStatus === "SUSPENDED" ||
    user.accountStatus === "DISABLED"
  ) {

    await recordLoginAttempt({
      identifier,

      userId:
        user.id,

      ipAddress:
        input.ipAddress,

      userAgent:
        input.userAgent,

      successful:
        false,

      failureReason:
        "ACCOUNT_UNAVAILABLE",
    });

    return {
      success: false,

      message:
        "This account is not available for login.",

      error:
        "ACCOUNT_UNAVAILABLE",
    };
  }


  /*
   * Normalize stale LOCKED status.
   *
   * If the lock has already expired, the account
   * should be ACTIVE.
   */
  if (
    user.accountStatus === "LOCKED"
  ) {
    await db
      .update(users)
      .set({
        accountStatus:
          "ACTIVE",

        failedLoginAttempts:
          0,

        lastFailedLoginAt:
          null,

        lockedUntil:
          null,

        updatedAt:
          new Date(),
      })
      .where(
        eq(
          users.id,
          user.id,
        ),
      );
  }


  /*
   * Password must exist.
   */
  if (!user.passwordHash) {

    await recordLoginAttempt({
      identifier,

      userId:
        user.id,

      ipAddress:
        input.ipAddress,

      userAgent:
        input.userAgent,

      successful:
        false,

      failureReason:
        "NO_PASSWORD",
    });

    return {
      success: false,

      message:
        "This account cannot authenticate with a password.",

      error:
        "NO_PASSWORD",
    };
  }


  /*
   * Verify Argon2id password.
   */
  const passwordValid =
    await verifyPassword(
      input.password,
      user.passwordHash,
    );


  /*
   |--------------------------------------------------------------------------
   | INVALID PASSWORD
   |--------------------------------------------------------------------------
   */

  if (!passwordValid) {

    const currentFailedAttempts =
      user.failedLoginAttempts ?? 0;

    const newFailedAttempts =
      currentFailedAttempts + 1;

    const shouldLock =
      newFailedAttempts >=
      MAX_FAILED_LOGIN_ATTEMPTS;

    const lockedUntil =
      shouldLock
        ? getLockoutExpiry()
        : null;

    const now =
      new Date();


    await db
      .update(users)
      .set({

        failedLoginAttempts:
          newFailedAttempts,

        lastFailedLoginAt:
          now,

        lockedUntil,

        accountStatus:
          shouldLock
            ? "LOCKED"
            : user.accountStatus,

        updatedAt:
          now,
      })
      .where(
        eq(
          users.id,
          user.id,
        ),
      );


    await recordLoginAttempt({

      identifier,

      userId:
        user.id,

      ipAddress:
        input.ipAddress,

      userAgent:
        input.userAgent,

      successful:
        false,

      failureReason:
        shouldLock
          ? "ACCOUNT_LOCKED"
          : "INVALID_PASSWORD",
    });


    if (shouldLock) {
      return {
        success: false,

        message:
          "Too many failed login attempts. Your account has been temporarily locked.",

        error:
          "ACCOUNT_LOCKED",
      };
    }


    return {
      success: false,

      message:
        "Invalid username/email or password.",

      error:
        "INVALID_CREDENTIALS",
    };
  }


  /*
   |--------------------------------------------------------------------------
   | MFA CHECK
   |--------------------------------------------------------------------------
   |
   | IMPORTANT:
   |
   | We do NOT create a normal authenticated session
   | when MFA is required.
   |
   | A proper MFA challenge/session flow should be
   | implemented before allowing access to protected
   | resources.
   |
   */

  const requiresMfa =
    user.mfaRequired ||
    user.mfaEnabled;


  /*
   * If MFA is required, record the successful password
   * verification but DO NOT create a full session yet.
   */
  if (requiresMfa) {

    await db
      .update(users)
      .set({
        failedLoginAttempts:
          0,

        lastFailedLoginAt:
          null,

        lockedUntil:
          null,

        accountStatus:
          "ACTIVE",

        lastLoginAt:
          new Date(),

        lastLoginIp:
          input.ipAddress ?? null,

        updatedAt:
          new Date(),
      })
      .where(
        eq(
          users.id,
          user.id,
        ),
      );


    await recordLoginAttempt({
      identifier,

      userId:
        user.id,

      ipAddress:
        input.ipAddress,

      userAgent:
        input.userAgent,

      successful:
        true,

      failureReason:
        "MFA_REQUIRED",
    });


    return {
      success: true,

      message:
        "Password authentication successful. MFA verification required.",

      user:
        toAuthenticatedUser(user),

      requiresMfa:
        true,

      requiresPasswordChange:
        user.mustChangePassword,
    };
  }


  /*
   |--------------------------------------------------------------------------
   | SUCCESSFUL LOGIN
   |--------------------------------------------------------------------------
   */

  const now =
    new Date();


  /*
   * Reset failed login counters.
   */
  await db
    .update(users)
    .set({

      failedLoginAttempts:
        0,

      lastFailedLoginAt:
        null,

      lockedUntil:
        null,

      accountStatus:
        "ACTIVE",

      lastLoginAt:
        now,

      lastLoginIp:
        input.ipAddress ?? null,

      updatedAt:
        now,
    })
    .where(
      eq(
        users.id,
        user.id,
      ),
    );


  /*
   * Create authenticated database session
   * through the dedicated session service.
   */
  const session =
    await createSession({

      userId:
        user.id,

      securityVersion:
        user.securityVersion,

      ipAddress:
        input.ipAddress,

      userAgent:
        input.userAgent,
    });


  /*
   * Record successful login.
   */
  await recordLoginAttempt({

    identifier,

    userId:
      user.id,

    ipAddress:
      input.ipAddress,

    userAgent:
      input.userAgent,

    successful:
      true,
  });


  /*
   * Return authenticated user.
   */
  return {

    success:
      true,

    message:
      user.mustChangePassword
        ? "Login successful. Password change required."
        : "Login successful.",

    user:
      toAuthenticatedUser(user),

    sessionToken:
      session.sessionToken,

    expiresAt:
      session.expiresAt,

    requiresMfa:
      false,

    requiresPasswordChange:
      user.mustChangePassword,
  };
}


/*
|--------------------------------------------------------------------------
| VALIDATE SESSION
|--------------------------------------------------------------------------
*/

export async function validateSession(
  sessionToken: string,
) {
  const result =
    await validateDatabaseSession(
      sessionToken,
    );

  if (!result) {
    return null;
  }

  return {
    session:
      result.session,

    user:
      result.user,
  };
}


/*
|--------------------------------------------------------------------------
| REVOKE SESSION
|--------------------------------------------------------------------------
*/

export async function revokeSession(
  sessionToken: string,
  reason = "LOGOUT",
): Promise<boolean> {
  return revokeDatabaseSession(
    sessionToken,
    reason,
  );
}


/*
|--------------------------------------------------------------------------
| REVOKE ALL USER SESSIONS
|--------------------------------------------------------------------------
*/

export async function revokeAllUserSessions(
  userId: number,
  reason = "SECURITY_ACTION",
): Promise<void> {
  await revokeAllDatabaseSessions(
    userId,
    reason,
  );
}