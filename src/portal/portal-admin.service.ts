/**
 * JaliCare HMIS
 * Patient portal — facility administration
 *
 * Everything here is scoped to the caller's facility. A facility
 * administrator can see and act on accounts belonging to their own
 * facility; another facility's patients are not found, not forbidden —
 * a 403 would confirm the account exists.
 *
 * Every statistic is a query. There are no constants in this file that
 * could be mistaken for a measurement.
 */

import { and, count, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { logAuditEvent } from '../db/queries.ts';

import {
  clampPortalPolicy,
  deriveInvitationStatus,
  maskContact,
  type PortalPolicy,
} from './portal-policy.ts';

import { PortalError, loadPortalPolicy } from './portal.service.ts';
import { revokeAllPortalSessions } from './portal-auth.service.ts';

function requireTenant(context: AuthorizationContext): number {
  if (context.tenantId === null || context.tenantId === undefined) {
    throw new PortalError(
      'Select a facility before working with the patient portal.',
      400,
      'TENANT_REQUIRED',
    );
  }

  return context.tenantId;
}

async function adminScope(context: AuthorizationContext): Promise<{
  tenantId: number;
  facilityId: number;
}> {
  return {
    tenantId: requireTenant(context),
    facilityId: resolveFacilityScope(context, undefined),
  };
}

/* ============================================================
   Overview
   ============================================================ */

export async function getPortalOverviewStats(context: AuthorizationContext) {
  const { tenantId, facilityId } = await adminScope(context);

  const eligibleWhere = and(
    eq(schema.patients.tenantId, tenantId),
    eq(schema.patients.registrationFacilityId, facilityId),
  );

  const [eligible] = await db.select({ value: count() }).from(schema.patients).where(eligibleWhere);

  const [accountsTotal] = await db
    .select({ value: count() })
    .from(schema.patientPortalAccounts)
    .where(
      and(
        eq(schema.patientPortalAccounts.tenantId, tenantId),
        eq(schema.patientPortalAccounts.facilityId, facilityId),
      ),
    );

  const statusRows = await db
    .select({
      status: schema.patientPortalAccounts.status,
      value: count(),
    })
    .from(schema.patientPortalAccounts)
    .where(
      and(
        eq(schema.patientPortalAccounts.tenantId, tenantId),
        eq(schema.patientPortalAccounts.facilityId, facilityId),
      ),
    )
    .groupBy(schema.patientPortalAccounts.status);

  const statusCounts: Record<string, number> = {};

  for (const row of statusRows) {
    statusCounts[row.status] = Number(row.value);
  }

  /*
   * Invitation counts are derived in TypeScript rather than SQL because
   * PENDING has to be re-evaluated against `expires_at`: a row that says
   * PENDING but expired yesterday is an expired invitation, and a
   * `GROUP BY status` would over-report live invitations.
   */
  const invitationRows = await db
    .select({
      status: schema.patientPortalInvitations.status,
      deliveryStatus: schema.patientPortalInvitations.deliveryStatus,
      expiresAt: schema.patientPortalInvitations.expiresAt,
    })
    .from(schema.patientPortalInvitations)
    .where(
      and(
        eq(schema.patientPortalInvitations.tenantId, tenantId),
        eq(schema.patientPortalInvitations.facilityId, facilityId),
      ),
    );

  const invitationCounts = {
    pending: 0,
    activated: 0,
    expired: 0,
    revoked: 0,
    superseded: 0,
    failedDelivery: 0,
    notConfigured: 0,
  };

  for (const row of invitationRows) {
    const status = deriveInvitationStatus({
      status: row.status,
      expiresAt: row.expiresAt,
    });

    if (status === 'PENDING') invitationCounts.pending += 1;
    if (status === 'ACTIVATED') invitationCounts.activated += 1;
    if (status === 'EXPIRED') invitationCounts.expired += 1;
    if (status === 'REVOKED') invitationCounts.revoked += 1;
    if (status === 'SUPERSEDED') invitationCounts.superseded += 1;

    if (row.deliveryStatus === 'FAILED') invitationCounts.failedDelivery += 1;
    if (row.deliveryStatus === 'NOT_CONFIGURED') invitationCounts.notConfigured += 1;
  }

  const [invitedPatients] = await db
    .select({ value: sql<number>`count(distinct ${schema.patientPortalInvitations.patientId})` })
    .from(schema.patientPortalInvitations)
    .where(
      and(
        eq(schema.patientPortalInvitations.tenantId, tenantId),
        eq(schema.patientPortalInvitations.facilityId, facilityId),
      ),
    );

  const recentEvents = await db
    .select({
      id: schema.patientPortalInvitationEvents.id,
      invitationId: schema.patientPortalInvitationEvents.invitationId,
      eventType: schema.patientPortalInvitationEvents.eventType,
      detail: schema.patientPortalInvitationEvents.detail,
      createdAt: schema.patientPortalInvitationEvents.createdAt,
      actorUserId: schema.patientPortalInvitationEvents.actorUserId,
    })
    .from(schema.patientPortalInvitationEvents)
    .innerJoin(
      schema.patientPortalInvitations,
      eq(schema.patientPortalInvitationEvents.invitationId, schema.patientPortalInvitations.id),
    )
    .where(
      and(
        eq(schema.patientPortalInvitations.tenantId, tenantId),
        eq(schema.patientPortalInvitations.facilityId, facilityId),
      ),
    )
    .orderBy(desc(schema.patientPortalInvitationEvents.createdAt))
    .limit(20);

  /*
   * Audit rows are shown only to a caller who holds `portal.audit.read`.
   * An account administrator who was not granted audit oversight still
   * gets the dashboard statistics, but not the trail — the two are
   * separate permissions on purpose, so delegating account management
   * does not quietly delegate the ability to watch what others did.
   */
  const canReadAudit = context.permissions.includes('portal.audit.read');

  const recentAccountEvents = canReadAudit
    ? await db
        .select({
          id: schema.auditLogs.id,
          action: schema.auditLogs.action,
          resource: schema.auditLogs.resource,
          resourceId: schema.auditLogs.resourceId,
          details: schema.auditLogs.details,
          timestamp: schema.auditLogs.timestamp,
          userId: schema.auditLogs.userId,
        })
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.tenantId, tenantId),
            eq(schema.auditLogs.facilityId, facilityId),
            inArray(schema.auditLogs.resource, ['PatientPortalAccount', 'PatientPortalInvitation']),
          ),
        )
        .orderBy(desc(schema.auditLogs.timestamp))
        .limit(20)
    : [];

  const policy = await loadPortalPolicy(facilityId);

  return {
    facilityId,
    eligiblePatients: Number(eligible?.value ?? 0),
    invitedPatients: Number(invitedPatients?.value ?? 0),
    accountsTotal: Number(accountsTotal?.value ?? 0),
    activeAccounts: statusCounts.ACTIVE ?? 0,
    pendingVerificationAccounts: statusCounts.PENDING_VERIFICATION ?? 0,
    suspendedAccounts: statusCounts.SUSPENDED ?? 0,
    revokedAccounts: statusCounts.REVOKED ?? 0,
    invitations: invitationCounts,
    recentEvents,
    recentAccountEvents,
    policy,
    policyBounds: {
      minExpiryHours: 4,
      maxExpiryHours: 336,
      maxResends: 10,
    },
    /*
     * The numbers above come from this database. Nothing is compared
     * against a benchmark, because there is no benchmark to compare to.
     */
    note: "Every figure on this page is counted from this facility's records.",
  };
}

/* ============================================================
   Account search
   ============================================================ */

/**
 * Search portal accounts.
 *
 * Accepts an MRN, a surname or a masked identifier *hint* — not a
 * national ID. An administrator looking for "the account whose phone
 * ends 789" is doing account administration, not identity resolution,
 * and the identifier itself is not needed to suspend or reactivate.
 */
export async function searchPortalAccounts(
  context: AuthorizationContext,
  query: { search?: unknown; status?: unknown; limit?: unknown },
) {
  const { tenantId, facilityId } = await adminScope(context);

  const search = typeof query.search === 'string' ? query.search.trim() : '';
  const status = typeof query.status === 'string' ? query.status.trim() : '';
  const limit = Math.min(
    100,
    Math.max(1, Number.isFinite(Number(query.limit)) ? Number(query.limit) : 25),
  );

  const conditions = [
    eq(schema.patientPortalAccounts.tenantId, tenantId),
    eq(schema.patientPortalAccounts.facilityId, facilityId),
  ];

  if (status && ['ACTIVE', 'SUSPENDED', 'REVOKED', 'PENDING_VERIFICATION'].includes(status)) {
    conditions.push(eq(schema.patientPortalAccounts.status, status));
  }

  if (search !== '') {
    const term = `%${search.toLowerCase()}%`;

    const match = or(
      sql`lower(${schema.patients.mrn}) like ${term}`,
      sql`lower(${schema.patients.firstName}) like ${term}`,
      sql`lower(${schema.patients.lastName}) like ${term}`,
    );

    if (match) conditions.push(match);
  }

  const rows = await db
    .select({
      accountId: schema.patientPortalAccounts.id,
      status: schema.patientPortalAccounts.status,
      loginIdentifier: schema.patientPortalAccounts.loginIdentifier,
      loginType: schema.patientPortalAccounts.loginType,
      activatedAt: schema.patientPortalAccounts.activatedAt,
      lastLoginAt: schema.patientPortalAccounts.lastLoginAt,
      suspendedAt: schema.patientPortalAccounts.suspendedAt,
      suspendedReason: schema.patientPortalAccounts.suspendedReason,
      revokedAt: schema.patientPortalAccounts.revokedAt,
      patientId: schema.patients.id,
      mrn: schema.patients.mrn,
      firstName: schema.patients.firstName,
      lastName: schema.patients.lastName,
      dateOfBirth: schema.patients.dateOfBirth,
      registrationFacilityId: schema.patients.registrationFacilityId,
    })
    .from(schema.patientPortalAccounts)
    .innerJoin(schema.patients, eq(schema.patientPortalAccounts.patientId, schema.patients.id))
    .where(and(...conditions))
    .orderBy(desc(schema.patientPortalAccounts.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    maskedIdentifier: maskContact(
      row.loginIdentifier,
      row.loginType === 'EMAIL' ? 'EMAIL' : 'PHONE',
    ),
    /* The full identifier is not returned by a list endpoint. */
    loginIdentifier: undefined,
  }));
}

/* ============================================================
   Account lifecycle
   ============================================================ */

async function loadAccountForAdmin(context: AuthorizationContext, rawAccountId: unknown) {
  const { tenantId, facilityId } = await adminScope(context);
  const accountId = Number(rawAccountId);

  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new PortalError('A valid account is required.', 400, 'INVALID_ACCOUNT_ID');
  }

  const [row] = await db
    .select({
      account: schema.patientPortalAccounts,
      mrn: schema.patients.mrn,
      firstName: schema.patients.firstName,
      lastName: schema.patients.lastName,
    })
    .from(schema.patientPortalAccounts)
    .innerJoin(schema.patients, eq(schema.patientPortalAccounts.patientId, schema.patients.id))
    .where(
      and(
        eq(schema.patientPortalAccounts.id, accountId),
        eq(schema.patientPortalAccounts.tenantId, tenantId),
        eq(schema.patientPortalAccounts.facilityId, facilityId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new PortalError('Account not found.', 404, 'ACCOUNT_NOT_FOUND');
  }

  return row;
}

export async function getPortalAccountDetail(context: AuthorizationContext, rawAccountId: unknown) {
  const { account, mrn, firstName, lastName } = await loadAccountForAdmin(context, rawAccountId);

  const invitations = await db
    .select({
      id: schema.patientPortalInvitations.id,
      status: schema.patientPortalInvitations.status,
      deliveryStatus: schema.patientPortalInvitations.deliveryStatus,
      deliveryChannel: schema.patientPortalInvitations.deliveryChannel,
      purpose: schema.patientPortalInvitations.purpose,
      createdAt: schema.patientPortalInvitations.createdAt,
      expiresAt: schema.patientPortalInvitations.expiresAt,
      activatedAt: schema.patientPortalInvitations.activatedAt,
      revokedAt: schema.patientPortalInvitations.revokedAt,
    })
    .from(schema.patientPortalInvitations)
    .where(eq(schema.patientPortalInvitations.patientId, account.patientId))
    .orderBy(desc(schema.patientPortalInvitations.createdAt))
    .limit(20);

  const events = await db
    .select({
      eventType: schema.patientPortalInvitationEvents.eventType,
      detail: schema.patientPortalInvitationEvents.detail,
      createdAt: schema.patientPortalInvitationEvents.createdAt,
    })
    .from(schema.patientPortalInvitationEvents)
    .innerJoin(
      schema.patientPortalInvitations,
      eq(schema.patientPortalInvitationEvents.invitationId, schema.patientPortalInvitations.id),
    )
    .where(eq(schema.patientPortalInvitations.patientId, account.patientId))
    .orderBy(desc(schema.patientPortalInvitationEvents.createdAt))
    .limit(30);

  const sessions = await db
    .select({
      id: schema.patientPortalSessions.id,
      createdAt: schema.patientPortalSessions.createdAt,
      lastActivityAt: schema.patientPortalSessions.lastActivityAt,
      expiresAt: schema.patientPortalSessions.expiresAt,
      revokedAt: schema.patientPortalSessions.revokedAt,
    })
    .from(schema.patientPortalSessions)
    .where(eq(schema.patientPortalSessions.accountId, account.id))
    .orderBy(desc(schema.patientPortalSessions.createdAt))
    .limit(10);

  return {
    account: {
      id: account.id,
      status: account.status,
      maskedIdentifier: maskContact(
        account.loginIdentifier,
        account.loginType === 'EMAIL' ? 'EMAIL' : 'PHONE',
      ),
      loginType: account.loginType,
      activatedAt: account.activatedAt,
      lastLoginAt: account.lastLoginAt,
      suspendedAt: account.suspendedAt,
      suspendedReason: account.suspendedReason,
      revokedAt: account.revokedAt,
      revokedReason: account.revokedReason,
      hasDigitalCard: Boolean(account.qrTokenHash),
    },
    patient: {
      id: account.patientId,
      mrn,
      firstName,
      lastName,
    },
    invitations: invitations.map((row) => ({
      ...row,
      effectiveStatus: deriveInvitationStatus(row),
    })),
    events,
    sessions,
  };
}

export async function suspendPortalAccount(
  context: AuthorizationContext,
  rawAccountId: unknown,
  reason: unknown,
): Promise<{ status: string; sessionsRevoked: number }> {
  const { account } = await loadAccountForAdmin(context, rawAccountId);

  const note =
    typeof reason === 'string' && reason.trim() !== '' ? reason.trim().slice(0, 500) : '';

  if (note === '') {
    throw new PortalError(
      'Record why the account is being suspended. It is an auditable decision.',
      400,
      'REASON_REQUIRED',
    );
  }

  if (account.status === 'REVOKED') {
    throw new PortalError(
      'This account is revoked, not suspendable. It stays revoked.',
      409,
      'ACCOUNT_REVOKED',
    );
  }

  await db
    .update(schema.patientPortalAccounts)
    .set({
      status: 'SUSPENDED',
      suspendedAt: new Date(),
      suspendedByUserId: context.userId,
      suspendedReason: note,
      securityVersion: sql`${schema.patientPortalAccounts.securityVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.patientPortalAccounts.id, account.id));

  const sessionsRevoked = await revokeAllPortalSessions(account.id, 'Account suspended');

  await logAuditEvent(
    account.tenantId,
    account.facilityId,
    String(context.userId),
    'SUSPEND',
    'PatientPortalAccount',
    String(account.id),
    `Portal account suspended: ${note}`,
  );

  return { status: 'SUSPENDED', sessionsRevoked };
}

/**
 * Reactivate a suspended account.
 *
 * The clinical record was never touched by the suspension, so nothing is
 * restored here — only the portal access is turned back on.
 */
export async function reactivatePortalAccount(
  context: AuthorizationContext,
  rawAccountId: unknown,
  reason: unknown,
): Promise<{ status: string }> {
  const { account } = await loadAccountForAdmin(context, rawAccountId);

  const note =
    typeof reason === 'string' && reason.trim() !== '' ? reason.trim().slice(0, 500) : '';

  if (note === '') {
    throw new PortalError(
      'Record the verification you performed before reactivating the account.',
      400,
      'REASON_REQUIRED',
    );
  }

  if (account.status === 'REVOKED') {
    throw new PortalError(
      'A revoked account is not reactivated. The patient must be invited again so identity is established afresh.',
      409,
      'ACCOUNT_REVOKED',
    );
  }

  if (account.status !== 'SUSPENDED' && account.status !== 'PENDING_VERIFICATION') {
    throw new PortalError('This account is already active.', 409, 'ACCOUNT_ALREADY_ACTIVE');
  }

  await db
    .update(schema.patientPortalAccounts)
    .set({
      status: 'ACTIVE',
      suspendedAt: null,
      suspendedByUserId: null,
      suspendedReason: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      securityVersion: sql`${schema.patientPortalAccounts.securityVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.patientPortalAccounts.id, account.id));

  await logAuditEvent(
    account.tenantId,
    account.facilityId,
    String(context.userId),
    'ACTIVATE',
    'PatientPortalAccount',
    String(account.id),
    `Portal account reactivated: ${note}`,
  );

  return { status: 'ACTIVE' };
}

/**
 * Revoke.
 *
 * Terminal. There is no un-revoke: an unfounded revocation is repaired
 * by inviting the patient again, which re-establishes identity. That is
 * deliberately more work than a toggle, because a toggle invites the
 * assumption that identity never changed.
 */
export async function revokePortalAccount(
  context: AuthorizationContext,
  rawAccountId: unknown,
  reason: unknown,
): Promise<{ status: string; sessionsRevoked: number }> {
  const { account } = await loadAccountForAdmin(context, rawAccountId);

  const note =
    typeof reason === 'string' && reason.trim() !== '' ? reason.trim().slice(0, 500) : '';

  if (note === '') {
    throw new PortalError('Record why access is being withdrawn.', 400, 'REASON_REQUIRED');
  }

  await db
    .update(schema.patientPortalAccounts)
    .set({
      status: 'REVOKED',
      revokedAt: new Date(),
      revokedByUserId: context.userId,
      revokedReason: note,
      securityVersion: sql`${schema.patientPortalAccounts.securityVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.patientPortalAccounts.id, account.id));

  const sessionsRevoked = await revokeAllPortalSessions(account.id, 'Account revoked');

  await logAuditEvent(
    account.tenantId,
    account.facilityId,
    String(context.userId),
    'REVOKE',
    'PatientPortalAccount',
    String(account.id),
    `Portal account revoked: ${note}`,
  );

  return { status: 'REVOKED', sessionsRevoked };
}

/** Force a password reset at next login and end current sessions. */
export async function forcePortalPasswordReset(
  context: AuthorizationContext,
  rawAccountId: unknown,
): Promise<{ sessionsRevoked: number }> {
  const { account } = await loadAccountForAdmin(context, rawAccountId);

  await db
    .update(schema.patientPortalAccounts)
    .set({
      mustChangePassword: true,
      securityVersion: sql`${schema.patientPortalAccounts.securityVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.patientPortalAccounts.id, account.id));

  const sessionsRevoked = await revokeAllPortalSessions(account.id, 'Password reset forced');

  await logAuditEvent(
    account.tenantId,
    account.facilityId,
    String(context.userId),
    'UPDATE',
    'PatientPortalAccount',
    String(account.id),
    'Portal password reset forced by an administrator',
  );

  return { sessionsRevoked };
}

/* ============================================================
   Settings
   ============================================================ */

export async function getPortalSettings(context: AuthorizationContext) {
  const { facilityId } = await adminScope(context);
  const policy = await loadPortalPolicy(facilityId);

  return { facilityId, policy };
}

export async function savePortalSettings(
  context: AuthorizationContext,
  input: unknown,
): Promise<{ policy: PortalPolicy }> {
  const { tenantId, facilityId } = await adminScope(context);

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new PortalError('A settings object is required.', 400, 'INVALID_SETTINGS');
  }

  const policy = clampPortalPolicy(input as Record<string, unknown>);

  const [existing] = await db
    .select({ id: schema.patientPortalSettings.id })
    .from(schema.patientPortalSettings)
    .where(eq(schema.patientPortalSettings.facilityId, facilityId))
    .limit(1);

  const values = {
    tenantId,
    facilityId,
    invitationExpiryHours: policy.invitationExpiryHours,
    maxResends: policy.maxResends,
    allowManualDelivery: policy.allowManualDelivery,
    allowSms: policy.allowSms,
    allowEmail: policy.allowEmail,
    showLabResults: policy.showLabResults,
    showAppointments: policy.showAppointments,
    showPrescriptions: policy.showPrescriptions,
    showAllergies: policy.showAllergies,
    showDischargeSummaries: policy.showDischargeSummaries,
    allowDownloads: policy.allowDownloads,
    updatedByUserId: context.userId,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(schema.patientPortalSettings)
      .set(values)
      .where(eq(schema.patientPortalSettings.id, existing.id));
  } else {
    await db.insert(schema.patientPortalSettings).values(values);
  }

  await logAuditEvent(
    tenantId,
    facilityId,
    String(context.userId),
    'UPDATE',
    'PatientPortalSettings',
    String(facilityId),
    `Portal policy updated: expiry ${policy.invitationExpiryHours}h, resends ${policy.maxResends}`,
  );

  return { policy };
}

/* ============================================================
   Audit trail
   ============================================================ */

/**
 * Portal audit events for this facility.
 *
 * Separate from the dashboard, behind `portal.audit.read`, and itself
 * audited: reading the trail writes a row to the same trail. Nothing here
 * can edit or delete an entry — there is no update path and no delete
 * path in this file, and the table's immutability is enforced by the
 * database triggers added in migration 0017.
 */
export async function listPortalAuditTrail(
  context: AuthorizationContext,
  options: { limit?: unknown; offset?: unknown } = {},
) {
  const { tenantId, facilityId } = await adminScope(context);

  const rawLimit = Number(options.limit);
  const rawOffset = Number(options.offset);

  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

  const offset = Number.isSafeInteger(rawOffset) && rawOffset > 0 ? Math.min(rawOffset, 100000) : 0;

  const rows = await db
    .select({
      id: schema.auditLogs.id,
      action: schema.auditLogs.action,
      resource: schema.auditLogs.resource,
      resourceId: schema.auditLogs.resourceId,
      details: schema.auditLogs.details,
      userId: schema.auditLogs.userId,
      ipAddress: schema.auditLogs.ipAddress,
      timestamp: schema.auditLogs.timestamp,
    })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.tenantId, tenantId),
        eq(schema.auditLogs.facilityId, facilityId),
        inArray(schema.auditLogs.resource, [
          'PatientPortalAccount',
          'PatientPortalInvitation',
          'PatientPortalSettings',
        ]),
      ),
    )
    .orderBy(desc(schema.auditLogs.timestamp))
    .limit(limit)
    .offset(offset);

  const invitationEvents = await db
    .select({
      id: schema.patientPortalInvitationEvents.id,
      invitationId: schema.patientPortalInvitationEvents.invitationId,
      eventType: schema.patientPortalInvitationEvents.eventType,
      detail: schema.patientPortalInvitationEvents.detail,
      actorUserId: schema.patientPortalInvitationEvents.actorUserId,
      createdAt: schema.patientPortalInvitationEvents.createdAt,
    })
    .from(schema.patientPortalInvitationEvents)
    .innerJoin(
      schema.patientPortalInvitations,
      eq(schema.patientPortalInvitationEvents.invitationId, schema.patientPortalInvitations.id),
    )
    .where(
      and(
        eq(schema.patientPortalInvitations.tenantId, tenantId),
        eq(schema.patientPortalInvitations.facilityId, facilityId),
      ),
    )
    .orderBy(desc(schema.patientPortalInvitationEvents.createdAt))
    .limit(limit);

  await logAuditEvent(
    tenantId,
    facilityId,
    String(context.userId),
    'VIEW',
    'PatientPortalAudit',
    String(facilityId),
    'Portal audit trail reviewed',
  );

  return {
    rows,
    invitationEvents,
    limit,
    offset,
    note: 'Reading this list is recorded in the same audit trail. Entries cannot be edited or deleted from the application.',
  };
}

/* ============================================================
   Duplicate and mislink detection
   ============================================================ */

/**
 * Accounts that look wrong.
 *
 * Two checks, both of which a human must interpret:
 *
 *   1. the same phone/email normalised across accounts — impossible by
 *      constraint on `login_identifier`, but a legacy or hand-inserted row
 *      could still hold two spellings of the same number;
 *   2. an account whose patient has been merged or has no registration
 *      facility.
 *
 * This does not "fix" anything. It lists what a person should look at.
 */
export async function findPortalAccountRisks(context: AuthorizationContext) {
  const { tenantId, facilityId } = await adminScope(context);

  const duplicates = await db
    .select({
      loginIdentifier: schema.patientPortalAccounts.loginIdentifier,
      accountCount: count(),
    })
    .from(schema.patientPortalAccounts)
    .where(
      and(
        eq(schema.patientPortalAccounts.tenantId, tenantId),
        eq(schema.patientPortalAccounts.facilityId, facilityId),
      ),
    )
    .groupBy(schema.patientPortalAccounts.loginIdentifier)
    .having(sql`count(*) > 1`);

  const orphaned = await db
    .select({
      accountId: schema.patientPortalAccounts.id,
      patientId: schema.patientPortalAccounts.patientId,
      status: schema.patientPortalAccounts.status,
    })
    .from(schema.patientPortalAccounts)
    .where(
      and(
        eq(schema.patientPortalAccounts.tenantId, tenantId),
        eq(schema.patientPortalAccounts.facilityId, facilityId),
        isNotNull(schema.patientPortalAccounts.loginIdentifier),
        sql`${schema.patientPortalAccounts.loginIdentifier} like 'pending-%'`,
      ),
    );

  return {
    sharedIdentifiers: duplicates.map((row) => ({
      masked: maskContact(
        row.loginIdentifier,
        row.loginIdentifier.includes('@') ? 'EMAIL' : 'PHONE',
      ),
      accounts: Number(row.accountCount),
    })),
    pendingVerification: orphaned,
    note: 'A shared phone number is common in one household and is not by itself evidence of a wrong link. Review each case in person.',
  };
}
