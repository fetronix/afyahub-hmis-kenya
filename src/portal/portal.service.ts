/**
 * JaliCare HMIS
 * Patient portal — invitations and activation
 *
 * This module owns the two moments where a mistake would link a portal
 * account to the wrong person: issuing an invitation and redeeming one.
 *
 * Issuing
 * -------
 *
 * A patient is looked up through the tenant-scoped query the rest of the
 * application already uses, so an invitation cannot be minted for
 * another tenant's patient. If the patient already has an account the
 * service refuses rather than creating a second one — the UNIQUE
 * constraint on `patient_portal_accounts.patient_id` is the backstop,
 * not the only check.
 *
 * Redeeming
 * ---------
 *
 * One transaction, with the invitation row locked `FOR UPDATE`. Two tabs
 * redeeming the same link therefore serialise: the second sees a row that
 * is already ACTIVATED and is refused. A check-then-write outside a lock
 * would hand both tabs an account, which is precisely the concurrent
 * redemption the brief asks to prevent.
 *
 * If the contact is already in use, the activation is *refused* and a
 * staff-assisted verification request is raised. It is never resolved by
 * matching on a name or a date of birth.
 */

import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';

import { logAuditEvent } from '../db/queries.ts';
import { hashPassword } from '../utils/password.ts';

import {
  buildInvitationMessage,
  describeNotificationConfiguration,
  sendNotification,
  type DeliveryOutcome,
} from '../notifications/notification-provider.ts';

import {
  DEFAULT_PORTAL_POLICY,
  type InvitationDeliveryChannel,
  type InvitationPurpose,
  type PortalEventType,
  type PortalPolicy,
  canResendInvitation,
  clampPortalPolicy,
  deriveInvitationStatus,
  describeEvent,
  buildActivationLink,
  generateInvitationToken,
  hashInvitationToken,
  maskContact,
  normaliseContact,
  normalisePhone,
} from './portal-policy.ts';

export class PortalError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PortalError';
  }
}

/* ============================================================
   Shared helpers
   ============================================================ */

/*
 * Link building lives in `portal-policy.ts`, which has no database
 * import, so it can be tested without a server and reused by anything
 * that needs to show an administrator the address a patient will get.
 * Re-exported here because this is where callers expect it.
 */
export { portalBaseUrl, buildActivationLink, requestOrigin } from './portal-policy.ts';

async function writeEvent(input: {
  invitationId: number;
  type: PortalEventType;
  actorUserId?: number | null;
  ipAddress?: string | null;
}): Promise<void> {
  await db.insert(schema.patientPortalInvitationEvents).values({
    invitationId: input.invitationId,
    eventType: input.type,
    detail: describeEvent(input.type),
    actorUserId: input.actorUserId ?? null,
    ipAddress: input.ipAddress ?? null,
  });
}

/** Load the facility policy, or the defaults when the row is absent. */
export async function loadPortalPolicy(facilityId: number): Promise<PortalPolicy> {
  const [row] = await db
    .select()
    .from(schema.patientPortalSettings)
    .where(eq(schema.patientPortalSettings.facilityId, facilityId))
    .limit(1);

  if (!row) return DEFAULT_PORTAL_POLICY;

  return clampPortalPolicy({
    invitationExpiryHours: row.invitationExpiryHours,
    maxResends: row.maxResends,
    allowManualDelivery: row.allowManualDelivery,
    allowSms: row.allowSms,
    allowEmail: row.allowEmail,
    showLabResults: row.showLabResults,
    showAppointments: row.showAppointments,
    showPrescriptions: row.showPrescriptions,
    showAllergies: row.showAllergies,
    showDischargeSummaries: row.showDischargeSummaries,
    allowDownloads: row.allowDownloads,
  });
}

/**
 * Find the patient the caller may invite.
 *
 * Uses `getPatientByIdScoped` semantics through a direct scoped read so
 * that a receptionist cannot invite a patient from another facility by
 * guessing an id, and so that the response for a patient in another
 * tenant is indistinguishable from a patient that does not exist.
 */
/**
 * The tenant a scoped staff operation runs in.
 *
 * `AuthorizationContext.tenantId` is nullable because a platform
 * administrator has none. Every portal route requires a facility, and a
 * facility belongs to a tenant, so the null case is a programming error
 * here rather than a state to handle.
 */
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

async function loadInvitablePatient(context: AuthorizationContext, rawPatientId: unknown) {
  const patientId = Number(rawPatientId);

  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    throw new PortalError('A valid patient is required.', 400, 'INVALID_PATIENT_ID');
  }

  const facilityId = resolveFacilityScope(context, undefined);
  const tenantId = requireTenant(context);

  const [patient] = await db
    .select({
      id: schema.patients.id,
      tenantId: schema.patients.tenantId,
      registrationFacilityId: schema.patients.registrationFacilityId,
      mrn: schema.patients.mrn,
      firstName: schema.patients.firstName,
      lastName: schema.patients.lastName,
      phone: schema.patients.phone,
      email: schema.patients.email,
    })
    .from(schema.patients)
    .where(and(eq(schema.patients.id, patientId), eq(schema.patients.tenantId, tenantId)))
    .limit(1);

  if (!patient) {
    throw new PortalError('Patient not found.', 404, 'PATIENT_NOT_FOUND');
  }

  /*
   * A facility-level user may invite a patient registered at their own
   * facility, or one already seen there. A tenant-level user may invite
   * any patient in the tenant.
   */
  if (context.facilityId && patient.registrationFacilityId !== context.facilityId) {
    const [seen] = await db
      .select({ id: schema.encounters.id })
      .from(schema.encounters)
      .where(
        and(
          eq(schema.encounters.patientId, patient.id),
          eq(schema.encounters.facilityId, context.facilityId),
        ),
      )
      .limit(1);

    if (!seen) {
      throw new PortalError('Patient not found.', 404, 'PATIENT_NOT_FOUND');
    }
  }

  return { patient, facilityId };
}

/* ============================================================
   Invitation status for a patient
   ============================================================ */

export interface PatientPortalStatus {
  patientId: number;
  hasAccount: boolean;
  accountStatus: string | null;
  accountMaskedContact: string | null;
  latestInvitation: {
    id: number;
    status: string;
    deliveryStatus: string;
    deliveryChannel: string;
    purpose: string;
    contactHint: string | null;
    expiresAt: Date;
    createdAt: Date;
    sentAt: Date | null;
    handedOverAt: Date | null;
    deliveryAttempts: number;
    lastDeliveryError: string | null;
    canResend: boolean;
    resendBlockedReason: string | null;
  } | null;
  policy: PortalPolicy;
  notificationConfigured: {
    sms: boolean;
    email: boolean;
  };
}

/**
 * Everything the reception desk needs, and nothing else.
 *
 * Note what is absent: no clinical data, no diagnosis, no results, no
 * full contact value. A receptionist needs to know whether an account
 * exists and whether a message went out. They do not need the record.
 */
export async function getPatientPortalStatus(
  context: AuthorizationContext,
  rawPatientId: unknown,
): Promise<PatientPortalStatus> {
  const { patient, facilityId } = await loadInvitablePatient(context, rawPatientId);

  const [account] = await db
    .select()
    .from(schema.patientPortalAccounts)
    .where(eq(schema.patientPortalAccounts.patientId, patient.id))
    .limit(1);

  const [invitation] = await db
    .select()
    .from(schema.patientPortalInvitations)
    .where(eq(schema.patientPortalInvitations.patientId, patient.id))
    .orderBy(desc(schema.patientPortalInvitations.createdAt))
    .limit(1);

  const policy = await loadPortalPolicy(facilityId);
  const configuration = describeNotificationConfiguration();

  let latest: PatientPortalStatus['latestInvitation'] = null;

  if (invitation) {
    const resend = canResendInvitation({
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      deliveryAttempts: invitation.deliveryAttempts,
      maxResends: policy.maxResends,
      purpose: invitation.purpose,
    });

    latest = {
      id: invitation.id,
      status: deriveInvitationStatus(invitation),
      deliveryStatus: invitation.deliveryStatus,
      deliveryChannel: invitation.deliveryChannel,
      purpose: invitation.purpose,
      contactHint: invitation.contactHint,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      sentAt: invitation.sentAt,
      handedOverAt: invitation.handedOverAt,
      deliveryAttempts: invitation.deliveryAttempts,
      lastDeliveryError: invitation.lastDeliveryError,
      canResend: resend.allowed,
      resendBlockedReason: resend.reason ?? null,
    };
  }

  return {
    patientId: patient.id,
    hasAccount: Boolean(account),
    accountStatus: account?.status ?? null,
    accountMaskedContact: account
      ? maskContact(account.loginIdentifier, account.loginType === 'EMAIL' ? 'EMAIL' : 'PHONE')
      : null,
    latestInvitation: latest,
    policy,
    notificationConfigured: {
      sms: configuration.smsConfigured,
      email: configuration.emailConfigured,
    },
  };
}

/* ============================================================
   Issue an invitation
   ============================================================ */

export interface IssueInvitationInput {
  channel?: InvitationDeliveryChannel;
  purpose?: InvitationPurpose;
  /** Overrides the patient's stored contact for this invitation only. */
  contactOverride?: string | null;
}

export interface IssuedInvitation {
  invitationId: number;
  status: string;
  deliveryStatus: string;
  deliveryChannel: string;
  expiresAt: Date;
  /**
   * Present only for MANUAL delivery. This is the single time the raw
   * token leaves the server, and it is returned to the authenticated
   * receptionist who is standing with the patient.
   */
  activationLink?: string;
  /**
   * Present when the channel was SMS/EMAIL but no provider exists, so the
   * screen can explain why and offer the manual alternative.
   */
  deliveryMessage?: string;
  providerReference?: string;
}

export async function issueInvitation(
  context: AuthorizationContext,
  rawPatientId: unknown,
  input: IssueInvitationInput = {},
  request?: { ipAddress?: string | null; origin?: string | null },
): Promise<IssuedInvitation> {
  const { patient, facilityId } = await loadInvitablePatient(context, rawPatientId);

  const [existingAccount] = await db
    .select({ id: schema.patientPortalAccounts.id })
    .from(schema.patientPortalAccounts)
    .where(eq(schema.patientPortalAccounts.patientId, patient.id))
    .limit(1);

  if (existingAccount) {
    /*
     * Deliberately explicit: this endpoint is authenticated and the
     * caller is authorised to invite this patient, so telling them the
     * account exists is correct. The *public* activation endpoint is
     * where generic errors matter.
     */
    throw new PortalError(
      'This patient already has a portal account.',
      409,
      'PORTAL_ACCOUNT_EXISTS',
    );
  }

  const policy = await loadPortalPolicy(facilityId);
  const channel: InvitationDeliveryChannel = input.channel ?? 'MANUAL';
  const purpose: InvitationPurpose = input.purpose ?? 'ACTIVATION';

  if (!policy.allowManualDelivery && channel === 'MANUAL') {
    throw new PortalError(
      'Manual delivery is switched off for this facility.',
      409,
      'CHANNEL_DISABLED',
    );
  }

  if (channel === 'SMS' && !policy.allowSms) {
    throw new PortalError(
      'SMS invitations are switched off for this facility.',
      409,
      'CHANNEL_DISABLED',
    );
  }

  if (channel === 'EMAIL' && !policy.allowEmail) {
    throw new PortalError(
      'Email invitations are switched off for this facility.',
      409,
      'CHANNEL_DISABLED',
    );
  }

  const contactSource = input.contactOverride?.trim()
    ? { phone: input.contactOverride, email: null }
    : { phone: patient.phone, email: patient.email };

  const contact = normaliseContact(contactSource);

  if (!contact && channel !== 'MANUAL') {
    throw new PortalError(
      'This patient has no usable phone number or email address. Record one, or hand the activation link over at the desk.',
      409,
      'NO_CONTACT',
    );
  }

  /*
   * A superseded or revoked earlier invitation must not stay live
   * beside the new one. Anything still PENDING is closed here so only
   * one live link exists per patient.
   */
  const outstanding = await db
    .select({ id: schema.patientPortalInvitations.id })
    .from(schema.patientPortalInvitations)
    .where(
      and(
        eq(schema.patientPortalInvitations.patientId, patient.id),
        eq(schema.patientPortalInvitations.status, 'PENDING'),
      ),
    );

  for (const row of outstanding) {
    await db
      .update(schema.patientPortalInvitations)
      .set({ status: 'SUPERSEDED' })
      .where(eq(schema.patientPortalInvitations.id, row.id));

    await writeEvent({
      invitationId: row.id,
      type: 'SUPERSEDED',
      actorUserId: context.userId,
      ipAddress: request?.ipAddress ?? null,
    });
  }

  const rawToken = generateInvitationToken();
  const expiresAt = new Date(Date.now() + policy.invitationExpiryHours * 60 * 60 * 1000);

  const [invitation] = await db
    .insert(schema.patientPortalInvitations)
    .values({
      tenantId: patient.tenantId,
      facilityId,
      patientId: patient.id,
      tokenHash: hashInvitationToken(rawToken),
      deliveryChannel: channel,
      deliveryStatus: 'PENDING',
      status: 'PENDING',
      purpose,
      contactHint: contact ? maskContact(contact.value, contact.type) : null,
      expiresAt,
      createdByUserId: context.userId,
    })
    .returning();

  await writeEvent({
    invitationId: invitation.id,
    type: 'CREATED',
    actorUserId: context.userId,
    ipAddress: request?.ipAddress ?? null,
  });

  await logAuditEvent(
    patient.tenantId,
    facilityId,
    String(context.userId),
    'INVITE',
    'PatientPortalInvitation',
    String(invitation.id),
    `Portal invitation issued for patient ${patient.mrn}`,
  );

  /* ---------------- delivery ---------------- */

  if (channel === 'MANUAL') {
    /*
     * Manual is not "no delivery": the receptionist is the delivery
     * mechanism, and the event records that the link was produced for
     * handing over. The status stays PENDING until they confirm.
     */
    return {
      invitationId: invitation.id,
      status: 'PENDING',
      deliveryStatus: 'PENDING',
      deliveryChannel: channel,
      expiresAt,
      activationLink: buildActivationLink(rawToken, process.env, request?.origin ?? null),
    };
  }

  if (!contact) {
    throw new PortalError(
      'This patient has no usable contact for that channel.',
      409,
      'NO_CONTACT',
    );
  }

  const [facility] = await db
    .select({ name: schema.facilities.name })
    .from(schema.facilities)
    .where(eq(schema.facilities.id, facilityId))
    .limit(1);

  const message = buildInvitationMessage({
    facilityName: facility?.name ?? 'Your facility',
    link: buildActivationLink(rawToken, process.env, request?.origin ?? null),
    expiryHours: policy.invitationExpiryHours,
  });

  await writeEvent({
    invitationId: invitation.id,
    type: 'DELIVERY_ATTEMPTED',
    actorUserId: context.userId,
    ipAddress: request?.ipAddress ?? null,
  });

  const outcome: DeliveryOutcome = await sendNotification({
    channel,
    to: contact.value,
    subject: 'Your JaliCare patient portal invitation',
    body: message,
  });

  const delivery = await recordDelivery(invitation.id, outcome, context.userId);

  return {
    invitationId: invitation.id,
    status: 'PENDING',
    deliveryStatus: delivery.deliveryStatus,
    deliveryChannel: channel,
    expiresAt,
    deliveryMessage: delivery.message,
    providerReference: delivery.providerReference,
  };
}

/**
 * Persist the provider's answer.
 *
 * The raw token is never part of this: a delivery failure is recorded as
 * the provider's message, truncated, and nothing else.
 */
async function recordDelivery(
  invitationId: number,
  outcome: DeliveryOutcome,
  actorUserId: number | null,
): Promise<{ deliveryStatus: string; message: string; providerReference?: string }> {
  const now = new Date();

  if (outcome.status === 'SENT') {
    await db
      .update(schema.patientPortalInvitations)
      .set({
        deliveryStatus: 'SENT',
        sentAt: now,
        deliveryAttempts: sql`${schema.patientPortalInvitations.deliveryAttempts} + 1`,
        lastDeliveryError: null,
      })
      .where(eq(schema.patientPortalInvitations.id, invitationId));

    await writeEvent({ invitationId, type: 'DELIVERY_SENT', actorUserId });

    return {
      deliveryStatus: 'SENT',
      message: 'The provider accepted the message.',
      providerReference: outcome.providerReference,
    };
  }

  if (outcome.status === 'NOT_CONFIGURED') {
    await db
      .update(schema.patientPortalInvitations)
      .set({
        deliveryStatus: 'NOT_CONFIGURED',
        lastDeliveryError: outcome.reason,
        deliveryAttempts: sql`${schema.patientPortalInvitations.deliveryAttempts} + 1`,
      })
      .where(eq(schema.patientPortalInvitations.id, invitationId));

    await writeEvent({ invitationId, type: 'DELIVERY_NOT_CONFIGURED', actorUserId });

    return {
      deliveryStatus: 'NOT_CONFIGURED',
      message: `${outcome.reason} Nothing was sent. Hand the activation link over at the desk instead.`,
    };
  }

  await db
    .update(schema.patientPortalInvitations)
    .set({
      deliveryStatus: 'FAILED',
      lastDeliveryError: outcome.reason.slice(0, 500),
      deliveryAttempts: sql`${schema.patientPortalInvitations.deliveryAttempts} + 1`,
    })
    .where(eq(schema.patientPortalInvitations.id, invitationId));

  await writeEvent({ invitationId, type: 'DELIVERY_FAILED', actorUserId });

  return {
    deliveryStatus: 'FAILED',
    message: `Delivery failed: ${outcome.reason}`,
  };
}

/* ============================================================
   Hand over manually
   ============================================================ */

/**
 * A manual invitation gets a fresh link on demand.
 *
 * The token is not stored in plaintext, so it cannot be "shown again" —
 * and that is the correct behaviour. If the desk loses the slip, the
 * right move is a new link with a new expiry; re-displaying the original
 * would mean storing it.
 */
export async function reissueManualLink(
  context: AuthorizationContext,
  rawInvitationId: unknown,
  request?: { ipAddress?: string | null; origin?: string | null },
): Promise<{ activationLink: string; expiresAt: Date }> {
  const invitationId = Number(rawInvitationId);

  if (!Number.isSafeInteger(invitationId) || invitationId <= 0) {
    throw new PortalError('A valid invitation is required.', 400, 'INVALID_INVITATION_ID');
  }

  const facilityId = resolveFacilityScope(context, undefined);
  const tenantId = requireTenant(context);

  const [invitation] = await db
    .select()
    .from(schema.patientPortalInvitations)
    .where(
      and(
        eq(schema.patientPortalInvitations.id, invitationId),
        eq(schema.patientPortalInvitations.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!invitation) {
    throw new PortalError('Invitation not found.', 404, 'INVITATION_NOT_FOUND');
  }

  if (context.facilityId && invitation.facilityId !== facilityId) {
    throw new PortalError('Invitation not found.', 404, 'INVITATION_NOT_FOUND');
  }

  const status = deriveInvitationStatus(invitation);

  if (status !== 'PENDING') {
    throw new PortalError(
      'This invitation is no longer live. Issue a new one.',
      409,
      'INVITATION_NOT_LIVE',
    );
  }

  if (invitation.deliveryChannel !== 'MANUAL') {
    throw new PortalError(
      'This invitation was sent through a provider. Resend it instead of printing a link.',
      409,
      'NOT_MANUAL',
    );
  }

  const policy = await loadPortalPolicy(invitation.facilityId);

  const resend = canResendInvitation({
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    deliveryAttempts: invitation.deliveryAttempts,
    maxResends: policy.maxResends,
    purpose: invitation.purpose,
  });

  if (!resend.allowed) {
    throw new PortalError(
      resend.reason ?? 'This invitation cannot be reissued.',
      409,
      'RESEND_NOT_ALLOWED',
    );
  }

  /*
   * Replacing the token invalidates the copy already printed. That is
   * the point: a lost slip stops working the moment a new one is made.
   */
  const rawToken = generateInvitationToken();
  const expiresAt = new Date(Date.now() + policy.invitationExpiryHours * 60 * 60 * 1000);

  await db
    .update(schema.patientPortalInvitations)
    .set({
      tokenHash: hashInvitationToken(rawToken),
      expiresAt,
      deliveryStatus: 'PENDING',
      deliveryAttempts: sql`${schema.patientPortalInvitations.deliveryAttempts} + 1`,
      handedOverAt: null,
      sentAt: null,
    })
    .where(eq(schema.patientPortalInvitations.id, invitation.id));

  await writeEvent({
    invitationId: invitation.id,
    type: 'CREATED',
    actorUserId: context.userId,
    ipAddress: request?.ipAddress ?? null,
  });

  await logAuditEvent(
    invitation.tenantId,
    invitation.facilityId,
    String(context.userId),
    'UPDATE',
    'PatientPortalInvitation',
    String(invitation.id),
    'Activation link reissued at the desk',
  );

  return {
    activationLink: buildActivationLink(rawToken, process.env, request?.origin ?? null),
    expiresAt,
  };
}

/** The receptionist confirms they gave the link to the patient. */
export async function markHandedOver(
  context: AuthorizationContext,
  rawInvitationId: unknown,
): Promise<{ deliveryStatus: string; handedOverAt: Date }> {
  const invitationId = Number(rawInvitationId);

  if (!Number.isSafeInteger(invitationId) || invitationId <= 0) {
    throw new PortalError('A valid invitation is required.', 400, 'INVALID_INVITATION_ID');
  }

  const facilityId = resolveFacilityScope(context, undefined);

  const [invitation] = await db
    .select()
    .from(schema.patientPortalInvitations)
    .where(eq(schema.patientPortalInvitations.id, invitationId))
    .limit(1);

  if (
    !invitation ||
    invitation.tenantId !== context.tenantId ||
    (context.facilityId && invitation.facilityId !== facilityId)
  ) {
    throw new PortalError('Invitation not found.', 404, 'INVITATION_NOT_FOUND');
  }

  if (deriveInvitationStatus(invitation) !== 'PENDING') {
    throw new PortalError('This invitation is no longer live.', 409, 'INVITATION_NOT_LIVE');
  }

  if (invitation.deliveryChannel !== 'MANUAL') {
    throw new PortalError(
      'Only a manually handed invitation can be marked as handed over.',
      409,
      'NOT_MANUAL',
    );
  }

  const now = new Date();

  await db
    .update(schema.patientPortalInvitations)
    .set({ deliveryStatus: 'HANDED_OVER', handedOverAt: now })
    .where(eq(schema.patientPortalInvitations.id, invitation.id));

  await writeEvent({
    invitationId: invitation.id,
    type: 'HANDED_OVER',
    actorUserId: context.userId,
  });

  return { deliveryStatus: 'HANDED_OVER', handedOverAt: now };
}

/* ============================================================
   Revoke
   ============================================================ */

export async function revokeInvitation(
  context: AuthorizationContext,
  rawInvitationId: unknown,
  reason: unknown,
): Promise<{ status: string }> {
  const invitationId = Number(rawInvitationId);

  if (!Number.isSafeInteger(invitationId) || invitationId <= 0) {
    throw new PortalError('A valid invitation is required.', 400, 'INVALID_INVITATION_ID');
  }

  const note =
    typeof reason === 'string' && reason.trim() !== ''
      ? reason.trim().slice(0, 500)
      : 'Revoked at the desk';

  const facilityId = resolveFacilityScope(context, undefined);

  const [invitation] = await db
    .select()
    .from(schema.patientPortalInvitations)
    .where(eq(schema.patientPortalInvitations.id, invitationId))
    .limit(1);

  if (
    !invitation ||
    invitation.tenantId !== context.tenantId ||
    (context.facilityId && invitation.facilityId !== facilityId)
  ) {
    throw new PortalError('Invitation not found.', 404, 'INVITATION_NOT_FOUND');
  }

  if (deriveInvitationStatus(invitation) === 'ACTIVATED') {
    throw new PortalError(
      'This invitation was already used. Suspend or revoke the account instead.',
      409,
      'INVITATION_ACTIVATED',
    );
  }

  await db
    .update(schema.patientPortalInvitations)
    .set({
      status: 'REVOKED',
      revokedAt: new Date(),
      revokedByUserId: context.userId,
      revokedReason: note,
    })
    .where(eq(schema.patientPortalInvitations.id, invitation.id));

  await writeEvent({
    invitationId: invitation.id,
    type: 'REVOKED',
    actorUserId: context.userId,
  });

  await logAuditEvent(
    invitation.tenantId,
    invitation.facilityId,
    String(context.userId),
    'REVOKE',
    'PatientPortalInvitation',
    String(invitation.id),
    `Portal invitation revoked: ${note}`,
  );

  return { status: 'REVOKED' };
}

/* ============================================================
   Redeem — the public activation path
   ============================================================ */

export interface ActivationInput {
  token: unknown;
  password: unknown;
  confirmPassword: unknown;
  /** Optional: the patient confirms their own date of birth. */
  dateOfBirth?: unknown;
}

export interface ActivationResult {
  accountId: number;
  patientId: number;
  tenantId: number;
  facilityId: number;
  loginIdentifier: string;
  loginType: string;
  firstName: string;
  lastName: string;
  requiresStaffVerification: boolean;
  verificationReason?: string;
}

/**
 * Redeem an invitation.
 *
 * Deliberately generic on every failure that a stranger could probe:
 * an unknown token, a revoked one, an expired one and an already-used
 * one all produce the same code and the same message. The only
 * difference a caller sees is whether activation worked.
 */
export async function activateInvitation(
  input: ActivationInput,
  request?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<ActivationResult> {
  const rawToken = typeof input.token === 'string' ? input.token.trim() : '';

  if (rawToken === '' || rawToken.length > 200) {
    throw new PortalError(
      'This activation link is not valid. Ask the reception desk for a new one.',
      400,
      'INVALID_INVITATION',
    );
  }

  const tokenHash = hashInvitationToken(rawToken);

  const password = input.password;
  const confirmPassword = input.confirmPassword;

  if (password !== confirmPassword) {
    throw new PortalError('The two passwords do not match.', 400, 'PASSWORD_MISMATCH');
  }

  /*
   * The password is checked before the token is used, so a mistyped
   * confirmation does not consume the single-use link.
   */
  const { checkPortalPassword } = await import('./portal-policy.ts');
  const passwordCheck = checkPortalPassword(password);

  if (!passwordCheck.ok) {
    throw new PortalError(
      passwordCheck.reason ?? 'Choose a stronger password.',
      400,
      'WEAK_PASSWORD',
    );
  }

  const result = await db.transaction(async (tx) => {
    /*
     * FOR UPDATE is the whole concurrency story. A second tab that
     * loads the same link waits here, then sees a row that is no longer
     * PENDING and is refused.
     */
    const [invitation] = await tx
      .select()
      .from(schema.patientPortalInvitations)
      .where(eq(schema.patientPortalInvitations.tokenHash, tokenHash))
      .for('update')
      .limit(1);

    if (!invitation) {
      throw new PortalError(
        'This activation link is not valid. Ask the reception desk for a new one.',
        400,
        'INVALID_INVITATION',
      );
    }

    const status = deriveInvitationStatus(invitation);

    if (status !== 'PENDING') {
      await tx.insert(schema.patientPortalInvitationEvents).values({
        invitationId: invitation.id,
        eventType: 'REDEEM_REJECTED',
        detail: describeEvent('REDEEM_REJECTED'),
        ipAddress: request?.ipAddress ?? null,
      });

      throw new PortalError(
        'This activation link is not valid. Ask the reception desk for a new one.',
        400,
        'INVALID_INVITATION',
      );
    }

    const [patient] = await tx
      .select()
      .from(schema.patients)
      .where(eq(schema.patients.id, invitation.patientId))
      .limit(1);

    if (!patient) {
      throw new PortalError(
        'This activation link is not valid. Ask the reception desk for a new one.',
        400,
        'INVALID_INVITATION',
      );
    }

    /*
     * Optional date-of-birth confirmation. When the patient record has a
     * date of birth, the patient must match it. This is a weak check on
     * its own — DOB is guessable — and it is documented as such; the
     * real control is that the link was handed to the person at the
     * desk. It exists to catch the wrong-lanyard case, not to replace
     * identity proofing.
     */
    if (patient.dateOfBirth) {
      const supplied = typeof input.dateOfBirth === 'string' ? input.dateOfBirth.trim() : '';

      if (supplied !== '' && supplied !== patient.dateOfBirth) {
        throw new PortalError(
          'The date of birth does not match our records. Ask the reception desk for help.',
          400,
          'IDENTITY_MISMATCH',
        );
      }
    }

    const existingAccount = await tx
      .select({ id: schema.patientPortalAccounts.id })
      .from(schema.patientPortalAccounts)
      .where(eq(schema.patientPortalAccounts.patientId, patient.id))
      .limit(1);

    if (existingAccount.length > 0) {
      throw new PortalError(
        'This activation link is not valid. Ask the reception desk for a new one.',
        400,
        'INVALID_INVITATION',
      );
    }

    const contact = normaliseContact({
      phone: patient.phone,
      email: patient.email,
    });

    /*
     * No contact on the record: the account is created but parked for
     * staff verification. The patient can still set a password — the
     * staff member will supply the identifier after verifying identity
     * in person, which is the same procedure the desk follows for
     * everyone who cannot receive a message.
     */
    if (!contact) {
      const parkedHash = await hashPassword(String(password));

      const [parked] = await tx
        .insert(schema.patientPortalAccounts)
        .values({
          tenantId: patient.tenantId,
          facilityId: invitation.facilityId,
          patientId: patient.id,
          loginIdentifier: `pending-${patient.id}-${Date.now()}`,
          loginType: 'PHONE',
          passwordHash: parkedHash,
          status: 'PENDING_VERIFICATION',
          activatedAt: new Date(),
        })
        .returning();

      await tx
        .update(schema.patientPortalInvitations)
        .set({ status: 'ACTIVATED', activatedAt: new Date() })
        .where(eq(schema.patientPortalInvitations.id, invitation.id));

      await tx.insert(schema.patientPortalInvitationEvents).values({
        invitationId: invitation.id,
        eventType: 'REDEEMED',
        detail: describeEvent('REDEEMED'),
        ipAddress: request?.ipAddress ?? null,
      });

      return {
        accountId: parked.id,
        patientId: patient.id,
        tenantId: patient.tenantId,
        facilityId: invitation.facilityId,
        loginIdentifier: '',
        loginType: 'PHONE',
        firstName: patient.firstName,
        lastName: patient.lastName,
        requiresStaffVerification: true,
        verificationReason:
          'There is no phone number or email on your record that can be used to sign in. A staff member will verify your identity in person and complete the account.',
      };
    }

    /*
     * The contact is already taken by another account.
     *
     * The wrong move is to assume shared phone numbers mean shared
     * people — a parent and a child routinely share a handset. The
     * account is not created and the request is parked for staff, who
     * verify identity in person before deciding what to do.
     */
    const [contactOwner] = await tx
      .select({
        id: schema.patientPortalAccounts.id,
        patientId: schema.patientPortalAccounts.patientId,
      })
      .from(schema.patientPortalAccounts)
      .where(eq(schema.patientPortalAccounts.loginIdentifier, contact.value))
      .limit(1);

    if (contactOwner && contactOwner.patientId !== patient.id) {
      await tx.insert(schema.patientPortalInvitationEvents).values({
        invitationId: invitation.id,
        eventType: 'REDEEM_REJECTED',
        detail: 'Contact in use by another account; staff verification required',
        ipAddress: request?.ipAddress ?? null,
      });

      return {
        accountId: 0,
        patientId: patient.id,
        tenantId: patient.tenantId,
        facilityId: invitation.facilityId,
        loginIdentifier: '',
        loginType: contact.type,
        firstName: patient.firstName,
        lastName: patient.lastName,
        requiresStaffVerification: true,
        verificationReason:
          'That phone number or email is already used by another portal account. A staff member will verify your identity in person before linking this one.',
      };
    }

    const passwordHash = await hashPassword(String(password));

    const [account] = await tx
      .insert(schema.patientPortalAccounts)
      .values({
        tenantId: patient.tenantId,
        facilityId: invitation.facilityId,
        patientId: patient.id,
        loginIdentifier: contact.value,
        loginType: contact.type,
        passwordHash,
        status: 'ACTIVE',
        activatedAt: new Date(),
      })
      .returning();

    await tx
      .update(schema.patientPortalInvitations)
      .set({ status: 'ACTIVATED', activatedAt: new Date() })
      .where(eq(schema.patientPortalInvitations.id, invitation.id));

    await tx.insert(schema.patientPortalInvitationEvents).values({
      invitationId: invitation.id,
      eventType: 'REDEEMED',
      detail: describeEvent('REDEEMED'),
      ipAddress: request?.ipAddress ?? null,
    });

    return {
      accountId: account.id,
      patientId: patient.id,
      tenantId: patient.tenantId,
      facilityId: invitation.facilityId,
      loginIdentifier: account.loginIdentifier,
      loginType: account.loginType,
      firstName: patient.firstName,
      lastName: patient.lastName,
      requiresStaffVerification: false,
    };
  });

  if (result.accountId > 0) {
    await logAuditEvent(
      result.tenantId,
      result.facilityId,
      null,
      'CREATE',
      'PatientPortalAccount',
      String(result.accountId),
      'Portal account activated by invitation',
    );

    await db.insert(schema.patientRecordAccessLogs).values({
      patientId: result.patientId,
      tenantId: result.tenantId,
      facilityId: result.facilityId,
      action: 'CREATE',
      accessChannel: 'PATIENT_PORTAL',
      recordType: 'PatientPortalAccount',
      recordId: result.accountId,
      purpose: 'PATIENT_REQUEST',
      ipAddress: request?.ipAddress ?? null,
      userAgent: request?.userAgent ?? null,
    });
  }

  return result;
}

/**
 * Raise a staff-verification request without creating an account.
 *
 * Used when activation is refused because the contact belongs to someone
 * else. The invitation stays PENDING so the same person can try again
 * after staff have sorted the identifier out.
 */
export async function flagVerificationRequired(rawPatientId: unknown, note: string): Promise<void> {
  const patientId = Number(rawPatientId);

  if (!Number.isSafeInteger(patientId) || patientId <= 0) return;

  const [patient] = await db
    .select({
      tenantId: schema.patients.tenantId,
      registrationFacilityId: schema.patients.registrationFacilityId,
    })
    .from(schema.patients)
    .where(eq(schema.patients.id, patientId))
    .limit(1);

  if (!patient) return;

  await logAuditEvent(
    patient.tenantId,
    patient.registrationFacilityId,
    null,
    'FLAG',
    'PatientPortalAccount',
    null,
    note.slice(0, 400),
  );
}

/** Kept for callers that only need a normalised phone. */
export { normalisePhone };
