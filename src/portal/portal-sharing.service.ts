/**
 * JaliCare HMIS
 * Patient-authorised record sharing
 *
 * A patient records a sharing request for selected categories. This is
 * **not** a public link or a national HIE integration: redemption requires
 * an authenticated staff session with `patients.read` in the same tenant.
 * The recipient name is descriptive, not verified against the redeemer.
 * A code is time-limited, revocable and single-use; redemption returns
 * request metadata, not the underlying clinical records.
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

  const grant = await db.transaction(async (tx) => {
    const [created] = await tx
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

    // Do not copy arbitrary recipient or purpose text into the audit log.
    await tx.insert(schema.auditLogs).values({
      tenantId: session.tenantId,
      facilityId: session.facilityId,
      userId: null,
      action: 'SHARE',
      resource: 'PatientRecordSharingGrant',
      resourceId: String(created.id),
      details: 'Patient created a sharing request',
    });
    return created;
  });

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
    .where(
      and(
        eq(schema.patientRecordSharingGrants.patientId, session.patientId),
        eq(schema.patientRecordSharingGrants.tenantId, session.tenantId),
      ),
    )
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

  return db.transaction(async (tx) => {
    const [grant] = await tx
      .select()
      .from(schema.patientRecordSharingGrants)
      .where(
        and(
          eq(schema.patientRecordSharingGrants.id, grantId),
          eq(schema.patientRecordSharingGrants.patientId, session.patientId),
          eq(schema.patientRecordSharingGrants.tenantId, session.tenantId),
        ),
      )
      .for('update');

    if (!grant) throw new PortalError('Grant not found.', 404, 'GRANT_NOT_FOUND');
    if (grant.revokedAt) return { state: 'REVOKED' };

    await tx
      .update(schema.patientRecordSharingGrants)
      .set({ revokedAt: new Date() })
      .where(eq(schema.patientRecordSharingGrants.id, grant.id));
    await tx.insert(schema.auditLogs).values({
      tenantId: session.tenantId,
      facilityId: session.facilityId,
      userId: null,
      action: 'REVOKE',
      resource: 'PatientRecordSharingGrant',
      resourceId: String(grant.id),
      details: 'Patient revoked a sharing request',
    });

    return { state: 'REVOKED' };
  });
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
export async function redeemSharingGrant(context: AuthorizationContext, rawCode: unknown) {
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';

  if (code === '' || code.length > 200) {
    throw new PortalError('That sharing code is not valid.', 404, 'GRANT_NOT_FOUND');
  }

  if (context.tenantId === null || context.tenantId === undefined) {
    throw new PortalError('Select a facility first.', 400, 'TENANT_REQUIRED');
  }

  return db.transaction(async (tx) => {
    // Locking the grant serializes redemption and patient revocation. Audit
    // and access history commit with the transition or none of them do.
    const [grant] = await tx
      .select()
      .from(schema.patientRecordSharingGrants)
      .where(
        and(
          eq(schema.patientRecordSharingGrants.codeHash, hashInvitationToken(code)),
          eq(schema.patientRecordSharingGrants.tenantId, context.tenantId!),
        ),
      )
      .for('update');

    if (!grant) throw new PortalError('That sharing code is not valid.', 404, 'GRANT_NOT_FOUND');
    if (grant.revokedAt)
      throw new PortalError('The patient withdrew this sharing grant.', 410, 'GRANT_REVOKED');
    if (grant.expiresAt.getTime() <= Date.now())
      throw new PortalError('This sharing grant has expired.', 410, 'GRANT_EXPIRED');
    if (grant.redeemedAt)
      throw new PortalError('This sharing code has already been used.', 410, 'GRANT_USED');

    await tx
      .update(schema.patientRecordSharingGrants)
      .set({ redeemedAt: new Date(), redeemedByUserId: context.userId })
      .where(eq(schema.patientRecordSharingGrants.id, grant.id));

    await tx.insert(schema.auditLogs).values({
      tenantId: grant.tenantId,
      facilityId: context.facilityId,
      userId: String(context.userId),
      action: 'VIEW',
      resource: 'PatientRecordSharingGrant',
      resourceId: String(grant.id),
      details: 'Staff redeemed a sharing request',
    });

    await tx.insert(schema.patientRecordAccessLogs).values({
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

    const categories = Array.isArray(grant.categories) ? (grant.categories as string[]) : [];
    return {
      patientId: grant.patientId,
      recipientName: grant.recipientName,
      purpose: grant.purpose,
      categories: SHARING_CATEGORIES.filter((category) => categories.includes(category)),
      expiresAt: grant.expiresAt,
    };
  });
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
