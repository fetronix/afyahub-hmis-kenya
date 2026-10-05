import crypto from "crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  sessions,
  loginAttempts,
} from "../db/schema";

import { verifyPassword } from "../utils/password";

/*
|--------------------------------------------------------------------------
| Authentication Configuration
|--------------------------------------------------------------------------
*/

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;
const SESSION_DURATION_HOURS = 8;

/*
|--------------------------------------------------------------------------
| Types
|--------------------------------------------------------------------------
*/

export interface LoginInput {
  identifier: string;
  password: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthenticatedUser {
  id: number;
  uid: string;
  username: string;
  email: string;
  fullName: string;
  tenantId: number | null;
  facilityId: number | null;
}

export interface LoginResult {
  success: boolean;
  message: string;
  user?: AuthenticatedUser;
  sessionToken?: string;
  expiresAt?: Date;
}

/*
|--------------------------------------------------------------------------
| Utility Functions
|--------------------------------------------------------------------------
*/

/**
 * Generate a cryptographically secure random session token.
 *
 * The raw token is returned to the application only once.
 * Only its SHA-256 hash is stored in the database.
 */
function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Hash a session token before storing/searching it.
 */
function hashSessionToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

/**
 * Calculate when the account should be unlocked.
 */
function getLockoutExpiry(): Date {
  return new Date(
    Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000
  );
}

/**
 * Calculate session expiration.
 */
function getSessionExpiry(): Date {
  return new Date(
    Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000
  );
}

/*
|--------------------------------------------------------------------------
| Find User
|--------------------------------------------------------------------------
*/

async function findUser(identifier: string) {
  const normalizedIdentifier = identifier.trim().toLowerCase();

  const result = await db
    .select()
    .from(users)
    .where(
      or(
        eq(users.username, normalizedIdentifier),
        eq(users.email, normalizedIdentifier)
      )
    )
    .limit(1);

  return result[0] ?? null;
}

/*
|--------------------------------------------------------------------------
| Check Account Lockout
|--------------------------------------------------------------------------
*/

function isAccountLocked(user: typeof users.$inferSelect): boolean {
  if (!user.lockedUntil) {
    return false;
  }

  return user.lockedUntil.getTime() > Date.now();
}

/*
|--------------------------------------------------------------------------
| Login
|--------------------------------------------------------------------------
*/

export async function login(
  input: LoginInput
): Promise<LoginResult> {
  const identifier = input.identifier.trim().toLowerCase();

  if (!identifier || !input.password) {
    return {
      success: false,
      message: "Invalid username/email or password.",
    };
  }

  /*
   * Find account
   */
  const user = await findUser(identifier);

  /*
   * Do not reveal whether an account exists.
   */
  if (!user) {
    await db.insert(loginAttempts).values({
      usernameOrEmail: identifier,
      userId: null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      successful: false,
      failureReason: "INVALID_CREDENTIALS",
    });

    return {
      success: false,
      message: "Invalid username/email or password.",
    };
  }

  /*
   * Check whether account is active.
   */
  if (!user.isActive || user.accountStatus !== "ACTIVE") {
    await db.insert(loginAttempts).values({
      usernameOrEmail: identifier,
      userId: user.id,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      successful: false,
      failureReason: "ACCOUNT_INACTIVE",
    });

    return {
      success: false,
      message: "This account is not available for login.",
    };
  }

  /*
   * Check account lockout.
   */
  if (isAccountLocked(user)) {
    await db.insert(loginAttempts).values({
      usernameOrEmail: identifier,
      userId: user.id,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      successful: false,
      failureReason: "ACCOUNT_LOCKED",
    });

    return {
      success: false,
      message:
        "This account is temporarily locked. Please try again later.",
    };
  }

  /*
   * If an old lockout has expired, clear it.
   */
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
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
  }

  /*
   * Account must have a password.
   */
  if (!user.passwordHash) {
    await db.insert(loginAttempts).values({
      usernameOrEmail: identifier,
      userId: user.id,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      successful: false,
      failureReason: "NO_PASSWORD",
    });

    return {
      success: false,
      message: "This account cannot authenticate with a password.",
    };
  }

  /*
   * Verify Argon2id password.
   */
  const passwordValid = await verifyPassword(
    input.password,
    user.passwordHash
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
      newFailedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;

    const lockedUntil = shouldLock
      ? getLockoutExpiry()
      : null;

    await db
      .update(users)
      .set({
        failedLoginAttempts: newFailedAttempts,
        lastFailedLoginAt: new Date(),
        lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await db.insert(loginAttempts).values({
      usernameOrEmail: identifier,
      userId: user.id,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      successful: false,
      failureReason: shouldLock
        ? "ACCOUNT_LOCKED"
        : "INVALID_PASSWORD",
    });

    if (shouldLock) {
      return {
        success: false,
        message:
          "Too many failed login attempts. Your account has been temporarily locked.",
      };
    }

    return {
      success: false,
      message: "Invalid username/email or password.",
    };
  }

  /*
   |--------------------------------------------------------------------------
   | SUCCESSFUL LOGIN
   |--------------------------------------------------------------------------
   */

  const sessionToken = generateSessionToken();
  const sessionTokenHash = hashSessionToken(sessionToken);
  const expiresAt = getSessionExpiry();

  /*
   * Reset failed login counters.
   */
  await db
    .update(users)
    .set({
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: input.ipAddress ?? null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  /*
   * Create database session.
   */
  await db.insert(sessions).values({
    userId: user.id,
    sessionTokenHash,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    expiresAt,
    revokedAt: null,
    revokeReason: null,
    securityVersion: user.securityVersion ?? 1,
  });

  /*
   * Record successful login.
   */
  await db.insert(loginAttempts).values({
    usernameOrEmail: identifier,
    userId: user.id,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    successful: true,
    failureReason: null,
  });

  return {
    success: true,
    message: "Login successful.",
    user: {
      id: user.id,
      uid: user.uid,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      tenantId: user.tenantId,
      facilityId: user.facilityId,
    },
    sessionToken,
    expiresAt,
  };
}

/*
|--------------------------------------------------------------------------
| Validate Session
|--------------------------------------------------------------------------
*/

export async function validateSession(sessionToken: string) {
  if (!sessionToken) {
    return null;
  }

  const sessionTokenHash =
    hashSessionToken(sessionToken);

  const result = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(
      users,
      eq(sessions.userId, users.id)
    )
    .where(
      and(
        eq(
          sessions.sessionTokenHash,
          sessionTokenHash
        ),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(
          sessions.securityVersion,
          users.securityVersion
        ),
        eq(users.isActive, true)
      )
    )
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  const { session, user } = result[0];

  /*
   * Update session activity.
   */
  await db
    .update(sessions)
    .set({
      lastActivityAt: new Date(),
    })
    .where(eq(sessions.id, session.id));

  return {
    session,
    user: {
      id: user.id,
      uid: user.uid,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      tenantId: user.tenantId,
      facilityId: user.facilityId,
    },
  };
}

/*
|--------------------------------------------------------------------------
| Revoke Session
|--------------------------------------------------------------------------
*/

export async function revokeSession(
  sessionToken: string,
  reason = "LOGOUT"
): Promise<boolean> {
  if (!sessionToken) {
    return false;
  }

  const sessionTokenHash =
    hashSessionToken(sessionToken);

  const result = await db
    .update(sessions)
    .set({
      revokedAt: new Date(),
      revokeReason: reason,
    })
    .where(
      and(
        eq(
          sessions.sessionTokenHash,
          sessionTokenHash
        ),
        isNull(sessions.revokedAt)
      )
    )
    .returning({
      id: sessions.id,
    });

  return result.length > 0;
}

/*
|--------------------------------------------------------------------------
| Revoke All User Sessions
|--------------------------------------------------------------------------
*/

export async function revokeAllUserSessions(
  userId: number,
  reason = "SECURITY_ACTION"
): Promise<void> {
  await db
    .update(sessions)
    .set({
      revokedAt: new Date(),
      revokeReason: reason,
    })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt)
      )
    );
}