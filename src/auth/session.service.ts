import { randomBytes, createHash } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '../db';
import { sessions, users } from '../db/schema';


/* ============================================================
   SESSION SECURITY SETTINGS
   ============================================================ */

const SESSION_DURATION_MS =
  1000 * 60 * 60 * 8; // 8 hours


/* ============================================================
   HASH SESSION TOKEN
   ============================================================ */

export function hashSessionToken(
  token: string,
): string {
  return createHash('sha256')
    .update(token)
    .digest('hex');
}


/* ============================================================
   CREATE SESSION
   ============================================================ */

export async function createSession(params: {
  userId: number;
  securityVersion: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const sessionToken =
    randomBytes(48).toString('base64url');

  const sessionTokenHash =
    hashSessionToken(sessionToken);

  const now = new Date();

  const expiresAt =
    new Date(
      now.getTime() +
        SESSION_DURATION_MS,
    );

  await db
    .insert(sessions)
    .values({
      userId:
        params.userId,

      sessionTokenHash,

      ipAddress:
        params.ipAddress ?? null,

      userAgent:
        params.userAgent ?? null,

      createdAt:
        now,

      lastActivityAt:
        now,

      expiresAt,

      securityVersion:
        params.securityVersion,
    });

  return {
    sessionToken,
    expiresAt,
  };
}


/* ============================================================
   VALIDATE SESSION
   ============================================================ */

export async function validateSession(
  sessionToken: string,
) {
  if (
    !sessionToken ||
    typeof sessionToken !== 'string'
  ) {
    return null;
  }

  const tokenHash =
    hashSessionToken(sessionToken);

  const result =
    await db
      .select({
        session: sessions,
        user: users,
      })
      .from(sessions)
      .innerJoin(
        users,
        eq(
          sessions.userId,
          users.id,
        ),
      )
      .where(
        and(
          eq(
            sessions.sessionTokenHash,
            tokenHash,
          ),
          isNull(
            sessions.revokedAt,
          ),
        ),
      )
      .limit(1);

  if (
    result.length === 0
  ) {
    return null;
  }

  const {
    session,
    user,
  } = result[0];

  const now =
    new Date();


  /* ----------------------------------------------------------
     SESSION EXPIRED
     ---------------------------------------------------------- */

  if (
    session.expiresAt <= now
  ) {
    await db
      .update(sessions)
      .set({
        revokedAt:
          now,

        revokeReason:
          'SESSION_EXPIRED',
      })
      .where(
        eq(
          sessions.id,
          session.id,
        ),
      );

    return null;
  }


  /* ----------------------------------------------------------
     ACCOUNT UNAVAILABLE
     ---------------------------------------------------------- */

  if (
  !user.isActive ||
  user.accountStatus === 'DISABLED' ||
  user.accountStatus === 'SUSPENDED' ||
  user.accountStatus === 'LOCKED'
) {
  return null;
}
  /* ----------------------------------------------------------
     SECURITY VERSION MISMATCH
     ---------------------------------------------------------- */

  if (
    session.securityVersion !==
    user.securityVersion
  ) {
    await db
      .update(sessions)
      .set({
        revokedAt:
          now,

        revokeReason:
          'SECURITY_VERSION_CHANGED',
      })
      .where(
        eq(
          sessions.id,
          session.id,
        ),
      );

    return null;
  }


  /* ----------------------------------------------------------
     UPDATE LAST ACTIVITY
     ---------------------------------------------------------- */

  await db
    .update(sessions)
    .set({
      lastActivityAt:
        now,
    })
    .where(
      eq(
        sessions.id,
        session.id,
      ),
    );


  /* ----------------------------------------------------------
     RETURN AUTHENTICATED SESSION
     ---------------------------------------------------------- */

  return {
    session,
    user,
  };
}


/* ============================================================
   REVOKE SESSION
   ============================================================ */

export async function revokeSession(
  sessionToken: string,
  reason = 'USER_LOGOUT',
) {
  if (
    !sessionToken ||
    typeof sessionToken !== 'string'
  ) {
    return false;
  }

  const tokenHash =
    hashSessionToken(
      sessionToken,
    );

  const now =
    new Date();

  const result =
    await db
      .update(sessions)
      .set({
        revokedAt:
          now,

        revokeReason:
          reason,
      })
      .where(
        and(
          eq(
            sessions.sessionTokenHash,
            tokenHash,
          ),
          isNull(
            sessions.revokedAt,
          ),
        ),
      )
      .returning({
        id:
          sessions.id,
      });

  return result.length > 0;
}


/* ============================================================
   REVOKE ALL USER SESSIONS
   ============================================================ */

export async function revokeAllUserSessions(
  userId: number,
  reason = 'SECURITY_ACTION',
) {
  const now =
    new Date();

  await db
    .update(sessions)
    .set({
      revokedAt:
        now,

      revokeReason:
        reason,
    })
    .where(
      and(
        eq(
          sessions.userId,
          userId,
        ),
        isNull(
          sessions.revokedAt,
        ),
      ),
    );
}