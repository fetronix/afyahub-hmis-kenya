/**
 * JaliCare HMIS
 * Patient-authorised record sharing
 *
 * A patient releases selected categories to a named recipient for a
 * limited window. This is **not** a public link and **not** a national
 * HIE integration: redeeming requires an authenticated staff session
 * with `patients.read` inside the same tenant, and the code is
 * single-recipient, time-limited and revocable.
 *
 * The grant carries a purpose and a category list because "share my
 * record" without either is not a decision a patient can meaningfully
 * make — and minimum necessary disclosure is a legal requirement, not a
 * nicety.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { logAuditEvent } from '../db/queries.ts';

import type { PortalSession } from './portal-auth.service.ts';
import { PortalError } from './portal.service.ts';
import {
  SHARING_CATEGORIES,
  generateInvitationToken,
  hashInvitationToken,
  validateSharingRequest,
  type SharingCategory,
} from './portal-policy.ts';

/* ============================================================
   Create
   ============================================================ */

export async function createSharingGrant(
  session: PortalSession,
  input: unknown,
): Promise<{ grantId: number; code: string; expiresAt: Date; categories: SharingCategory[] }> {
  let request: ReturnType<typeof validateSharingRequest>;

  try {
    request = validateSharingRequest(input);
  } catch (error) {
    throw new PortalError(
      error instanceof Error ? error.message : 'The sharing request is not valid.',
      400,
      'INVALID_SHARING_REQUEST',
    );
  }

  const code = generateInvitationToken();
  const expiresAt = new Date(Date.now() + request.hours * 60 * 60 * 1000);

  const [grant] = await db
    .insert(schema.patientRecordSharingGrants)
    .values({
      tenantId: session.tenantId,
      patientId: session.patientId,
      createdByAccountId: session.accountId,
      codeHash: hashInvitationToken(code),
      recipientName: request.recipientName,
      purpose: request.purpose,
      categories: request.categories,
      expiresAt,
    })
    .returning();

  await logAuditEvent(
    session.tenantId,
    session.facilityId,
    null,
    'SHARE',
    'PatientRecordSharingGrant',
    String(grant.id),
    `Patient authorised sharing with ${request.recipientName} until ${expiresAt.toISOString()}`,
  );

  /*
   * The code is returned once. Only its hash is stored, so it cannot be
   * displayed again — the patient writes it down or reads it to the
   * recipient on the phone, which is the intended flow.
   */
  return {
    grantId: grant.id,
    code,
    expiresAt,
    categories: request.categories,
  };
}

/* ============================================================
   List and revoke
   ============================================================ */

export async function listSharingGrants(session: PortalSession) {
  const rows = await db
    .select({
      id: schema.patientRecordSharingGrants.id,
      recipientName: schema.patientRecordSharingGrants.recipientName,
      purpose: schema.patientRecordSharingGrants.purpose,
      categories: schema.patientRecordSharingGrants.categories,
      expiresAt: schema.patientRecordSharingGrants.expiresAt,
      revokedAt: schema.patientRecordSharingGrants.revokedAt,
      redeemedAt: schema.patientRecordSharingGrants.redeemedAt,
      createdAt: schema.patientRecordSharingGrants.createdAt,
    })
    .from(schema.patientRecordSharingGrants)
    .where(eq(schema.patientRecordSharingGrants.patientId, session.patientId))
    .orderBy(desc(schema.patientRecordSharingGrants.createdAt))
    .limit(50);

  const now = Date.now();

  return rows.map((row) => ({
    ...row,
    state: row.revokedAt
      ? 'REVOKED'
      : row.expiresAt.getTime() <= now
        ? 'EXPIRED'
        : row.redeemedAt
          ? 'USED'
          : 'OPEN',
  }));
}

export async function revokeSharingGrant(
  session: PortalSession,
  rawGrantId: unknown,
): Promise<{ state: string }> {
  const grantId = Number(rawGrantId);

  if (!Number.isSafeInteger(grantId) || grantId <= 0) {
    throw new PortalError('A valid grant is required.', 400, 'INVALID_GRANT_ID');
  }

  const [grant] = await db
    .select()
    .from(schema.patientRecordSharingGrants)
    .where(
      and(
        eq(schema.patientRecordSharingGrants.id, grantId),
        /* The account's own patient — never an id from the body. */
        eq(schema.patientRecordSharingGrants.patientId, session.patientId),
      ),
    )
    .limit(1);

  if (!grant) {
    throw new PortalError('Grant not found.', 404, 'GRANT_NOT_FOUND');
  }

  if (grant.revokedAt) {
    return { state: 'REVOKED' };
  }

  await db
    .update(schema.patientRecordSharingGrants)
    .set({ revokedAt: new Date() })
    .where(eq(schema.patientRecordSharingGrants.id, grant.id));

  await logAuditEvent(
    session.tenantId,
    session.facilityId,
    null,
    'REVOKE',
    'PatientRecordSharingGrant',
    String(grant.id),
    'Patient revoked record sharing',
  );

  return { state: 'REVOKED' };
}

/* ============================================================
   Redeem — staff side
   ============================================================ */

/**
 * A staff member opens a grant the patient gave them.
 *
 * Requires the code *and* an authenticated staff session with
 * `patients.read` in the same tenant. The grant is marked used on first
 * redemption: a code read aloud on a ward round should not become a
 * permanent key.
 */
export async function redeemSharingGrant(
  context: AuthorizationContext,
  rawCode: unknown,
) {
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';

  if (code === '' || code.length > 200) {
    throw new PortalError('That sharing code is not valid.', 404, 'GRANT_NOT_FOUND');
  }

  if (context.tenantId === null || context.tenantId === undefined) {
    throw new PortalError('Select a facility first.', 400, 'TENANT_REQUIRED');
  }

  const [grant] = await db
    .select()
    .from(schema.patientRecordSharingGrants)
    .where(
      and(
        eq(
          schema.patientRecordSharingGrants.codeHash,
          hashInvitationToken(code),
        ),
        eq(schema.patientRecordSharingGrants.tenantId, context.tenantId),
      ),
    )
    .limit(1);

  if (!grant) {
    throw new PortalError('That sharing code is not valid.', 404, 'GRANT_NOT_FOUND');
  }

  if (grant.revokedAt) {
    throw new PortalError('The patient withdrew this sharing grant.', 410, 'GRANT_REVOKED');
  }

  if (grant.expiresAt.getTime() <= Date.now()) {
    throw new PortalError('This sharing grant has expired.', 410, 'GRANT_EXPIRED');
  }

  if (grant.redeemedAt) {
    throw new PortalError('This sharing code has already been used.', 410, 'GRANT_USED');
  }

  await db
    .update(schema.patientRecordSharingGrants)
    .set({ redeemedAt: new Date(), redeemedByUserId: context.userId })
    .where(eq(schema.patientRecordSharingGrants.id, grant.id));

  await logAuditEvent(
    grant.tenantId,
    context.facilityId,
    String(context.userId),
    'VIEW',
    'PatientRecordSharingGrant',
    String(grant.id),
    `Sharing grant redeemed for ${grant.recipientName}`,
  );

  await db.insert(schema.patientRecordAccessLogs).values({
    patientId: grant.patientId,
    userId: context.userId,
    tenantId: grant.tenantId,
    facilityId: context.facilityId,
    action: 'SHARE',
    accessChannel: 'REFERRAL',
    recordType: 'PatientRecordSharingGrant',
    recordId: grant.id,
    purpose: 'CARE_COORDINATION',
  });

  const categories = Array.isArray(grant.categories)
    ? (grant.categories as string[])
    : [];

  return {
    patientId: grant.patientId,
    recipientName: grant.recipientName,
    purpose: grant.purpose,
    categories: SHARING_CATEGORIES.filter((category) => categories.includes(category)),
    expiresAt: grant.expiresAt,
  };
}

/* ============================================================
   Access history for the patient
   ============================================================ */

export async function listPortalRecordAccessHistory(session: PortalSession) {
  const rows = await db
    .select({
      action: schema.patientRecordAccessLogs.action,
      accessChannel: schema.patientRecordAccessLogs.accessChannel,
      recordType: schema.patientRecordAccessLogs.recordType,
      createdAt: schema.patientRecordAccessLogs.createdAt,
    })
    .from(schema.patientRecordAccessLogs)
    .where(
      and(
        eq(schema.patientRecordAccessLogs.patientId, session.patientId),
        isNull(schema.patientRecordAccessLogs.userId),
      ),
    )
    .orderBy(desc(schema.patientRecordAccessLogs.createdAt))
    .limit(50);

  return rows;
}
