import { and, eq, or } from 'drizzle-orm';

import { db } from '../db';
import {
  users,
  loginAttempts,
} from '../db/schema';

import {
  verifyPassword,
} from '../utils/password';

import {
  createSession,
} from './session.service';

import {
  LoginInput,
  LoginResult,
} from './auth.types';


/* ============================================================
   LOGIN SECURITY SETTINGS
   ============================================================ */

const MAX_FAILED_ATTEMPTS = 5;

const LOCKOUT_DURATION_MS =
  1000 * 60 * 15; // 15 minutes


/* ============================================================
   NORMALIZE IDENTIFIER
   ============================================================ */

function normalizeIdentifier(
  identifier: string,
): string {
  return identifier
    .trim()
    .toLowerCase();
}


/* ============================================================
   RECORD LOGIN ATTEMPT
   ============================================================ */

async function recordLoginAttempt(params: {
  identifier: string;
  userId?: number;
  ipAddress?: string;
  userAgent?: string;
  successful: boolean;
  failureReason?: string;
}) {
  await db.insert(loginAttempts).values({
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


/* ============================================================
   FIND USER
   ============================================================ */

async function findUser(
  identifier: string,
) {
  return db
    .select()
    .from(users)
    .where(
      or(
        eq(users.username, identifier),
        eq(users.email, identifier),
      ),
    )
    .limit(1);
}


/* ============================================================
   LOGIN
   ============================================================ */

export async function login(
  input: LoginInput,
): Promise<LoginResult> {

  const identifier =
    normalizeIdentifier(
      input.identifier,
    );

  /* ----------------------------------------------------------
     Basic validation
     ---------------------------------------------------------- */

  if (
    !identifier ||
    !input.password
  ) {
    return {
      success: false,
      error: 'Invalid credentials.',
    };
  }

  /* ----------------------------------------------------------
     Find account
     ---------------------------------------------------------- */

  const result =
    await findUser(identifier);

  const user = result[0];

  /*
   * Important:
   * Do not reveal whether the username/email exists.
   */

  if (!user) {

    await recordLoginAttempt({
      identifier,
      ipAddress:
        input.ipAddress,
      userAgent:
        input.userAgent,
      successful: false,
      failureReason:
        'INVALID_CREDENTIALS',
    });

    return {
      success: false,
      error: 'Invalid credentials.',
    };
  }


  /* ----------------------------------------------------------
     Account status
     ---------------------------------------------------------- */

  if (
    !user.isActive ||
    user.accountStatus ===
      'DISABLED' ||
    user.accountStatus ===
      'SUSPENDED'
  ) {

    await recordLoginAttempt({
      identifier,
      userId: user.id,
      ipAddress:
        input.ipAddress,
      userAgent:
        input.userAgent,
      successful: false,
      failureReason:
        'ACCOUNT_UNAVAILABLE',
    });

    return {
      success: false,
      error:
        'This account is currently unavailable.',
    };
  }


  /* ----------------------------------------------------------
     Check lockout
     ---------------------------------------------------------- */

  const now = new Date();

  if (
    user.lockedUntil &&
    user.lockedUntil > now
  ) {

    await recordLoginAttempt({
      identifier,
      userId: user.id,
      ipAddress:
        input.ipAddress,
      userAgent:
        input.userAgent,
      successful: false,
      failureReason:
        'ACCOUNT_LOCKED',
    });

    return {
      success: false,
      error:
        'Invalid credentials.',
    };
  }


  /* ----------------------------------------------------------
     Verify password
     ---------------------------------------------------------- */

  if (!user.passwordHash) {

    await recordLoginAttempt({
      identifier,
      userId: user.id,
      ipAddress:
        input.ipAddress,
      userAgent:
        input.userAgent,
      successful: false,
      failureReason:
        'NO_PASSWORD_CONFIGURED',
    });

    return {
      success: false,
      error:
        'Invalid credentials.',
    };
  }

  const validPassword =
    await verifyPassword(
      input.password,
      user.passwordHash,
    );


  /* ----------------------------------------------------------
     Invalid password
     ---------------------------------------------------------- */

  if (!validPassword) {

    const failedAttempts =
      user.failedLoginAttempts + 1;

    const shouldLock =
      failedAttempts >=
      MAX_FAILED_ATTEMPTS;

    const lockedUntil =
      shouldLock
        ? new Date(
            now.getTime() +
              LOCKOUT_DURATION_MS,
          )
        : null;

    await db
      .update(users)
      .set({
        failedLoginAttempts:
          failedAttempts,

        lastFailedLoginAt:
          now,

        lockedUntil,

        updatedAt: now,
      })            
      .where(
        eq(users.id, user.id),
      );

    await recordLoginAttempt({
      identifier,
      userId: user.id,
      ipAddress:
        input.ipAddress,
      userAgent:
        input.userAgent,
      successful: false,
      failureReason:
        shouldLock
          ? 'ACCOUNT_LOCKED'
          : 'INVALID_CREDENTIALS',
    });

    return {
      success: false,
      error:
        'Invalid credentials.',
    };
  }


  /* ----------------------------------------------------------
     Successful login
     ---------------------------------------------------------- */

  await db
    .update(users)
    .set({
      failedLoginAttempts: 0,

      lastFailedLoginAt: null,

      lockedUntil: null,

      accountStatus: 'ACTIVE',

      lastLoginAt: now,

      lastLoginIp:
        input.ipAddress ?? null,

      updatedAt: now,
    })
    .where(
      eq(users.id, user.id),
    );


  await recordLoginAttempt({
    identifier,
    userId: user.id,
    ipAddress:
      input.ipAddress,
    userAgent:
      input.userAgent,
    successful: true,
  });


  /* ----------------------------------------------------------
     Create database session
     ---------------------------------------------------------- */

  const session =
    await createSession({
      userId: user.id,

      securityVersion:
        user.securityVersion,

      ipAddress:
        input.ipAddress,

      userAgent:
        input.userAgent,
    });


  /* ----------------------------------------------------------
     Return authenticated user
     ---------------------------------------------------------- */

  return {
    success: true,

    user: {
      id: user.id,
      uid: user.uid,
      username: user.username,
      email: user.email,
      fullName: user.fullName,

      tenantId:
        user.tenantId,

      facilityId:
        user.facilityId,

      accountStatus:
        user.accountStatus,

      mustChangePassword:
        user.mustChangePassword,

      mfaEnabled:
        user.mfaEnabled,

      mfaRequired:
        user.mfaRequired,
    },

    sessionToken:
      session.sessionToken,

    expiresAt:
      session.expiresAt,

    requiresMfa:
      user.mfaRequired &&
      !user.mfaEnabled,

    requiresPasswordChange:
      user.mustChangePassword,
  };
}