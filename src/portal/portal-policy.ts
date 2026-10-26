/**
 * JaliCare HMIS
 * Patient portal — policy
 *
 * Every rule in this file is pure: no database, no clock it cannot be
 * given, no network. That is deliberate. The security decisions that
 * matter most — when an invitation expires, whether a token may be
 * redeemed twice, how long a session lives, what a facility is allowed
 * to configure — are then testable without a running server, and a
 * regression in any of them fails a test rather than quietly weakening
 * the product.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/* ============================================================
   Vocabulary
   ============================================================ */

export const INVITATION_DELIVERY_CHANNELS = ['MANUAL', 'SMS', 'EMAIL'] as const;
export type InvitationDeliveryChannel = (typeof INVITATION_DELIVERY_CHANNELS)[number];

export const INVITATION_DELIVERY_STATUSES = [
  'PENDING',
  'SENT',
  'FAILED',
  'NOT_CONFIGURED',
  'HANDED_OVER',
] as const;
export type InvitationDeliveryStatus = (typeof INVITATION_DELIVERY_STATUSES)[number];

/**
 * What the UI shows.
 *
 * `SENT` does not appear here on purpose: a provider accepting a message
 * is a delivery fact, not an account fact. The screen shows delivery and
 * activation as two columns precisely so nobody reads one as the other.
 */
export const INVITATION_STATUSES = [
  'PENDING',
  'ACTIVATED',
  'EXPIRED',
  'REVOKED',
  'SUPERSEDED',
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const INVITATION_PURPOSES = ['ACTIVATION', 'RECOVERY', 'REVERIFICATION'] as const;
export type InvitationPurpose = (typeof INVITATION_PURPOSES)[number];

export const ACCOUNT_STATUSES = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'REVOKED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const EVENT_TYPES = [
  'CREATED',
  'DELIVERY_ATTEMPTED',
  'DELIVERY_SENT',
  'DELIVERY_FAILED',
  'DELIVERY_NOT_CONFIGURED',
  'HANDED_OVER',
  'REDEEMED',
  'REDEEM_REJECTED',
  'REVOKED',
  'SUPERSEDED',
] as const;
export type PortalEventType = (typeof EVENT_TYPES)[number];

/* ============================================================
   Bounds
   ============================================================ */

/**
 * How long an invitation stays valid.
 *
 * The floor exists because a one-hour link is useless in a facility
 * where the patient travels home and comes back tomorrow; the ceiling
 * exists because a month-old link is a liability sitting in an SMS
 * inbox. 72 hours is the default.
 */
export const MIN_INVITATION_EXPIRY_HOURS = 4;
export const MAX_INVITATION_EXPIRY_HOURS = 336; // 14 days
export const DEFAULT_INVITATION_EXPIRY_HOURS = 72;

export const MIN_RESENDS = 0;
export const MAX_RESENDS = 10;
export const DEFAULT_MAX_RESENDS = 3;

/** A patient session is shorter than a staff session. */
export const PATIENT_SESSION_HOURS = 2;

/** Wrong passwords before the account locks, and for how long. */
export const MAX_FAILED_LOGINS = 5;
export const LOGIN_LOCK_MINUTES = 15;

/** Invitation minimumn retry backoff is not needed: resends are capped. */

export const MIN_PORTAL_PASSWORD_LENGTH = 12;
export const MAX_PORTAL_PASSWORD_LENGTH = 200;

/* ============================================================
   Tokens
   ============================================================ */

/**
 * A one-time token.
 *
 * 32 random bytes, base64url — 256 bits. It is returned to the caller
 * once and immediately reduced to a hash for storage. Nothing in this
 * module logs it, and no caller may pass it to `describeEvent`.
 */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The same treatment the session table gets: SHA-256, hex, stored only. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of two hashes.
 *
 * The lookup itself is an indexed equality match, so this is a second
 * line rather than the first: it exists so that a future refactor to a
 * scan does not silently introduce a timing oracle.
 */
export function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/* ============================================================
   The address a patient is sent to
   ============================================================ */

/**
 * The origin a portal link should point at.
 *
 * Three sources, in order:
 *
 *   1. `PATIENT_PORTAL_URL` — the portal's own public address, for a
 *      deployment that serves it from a different host.
 *   2. `APP_BASE_URL` — the installation's public address. The portal is
 *      served by the same Express app, so this is normally right.
 *   3. A relative path — no configuration at all. A relative link works
 *      in a browser that is already on the right origin, and is visibly
 *      incomplete to anyone reading it, which is better than a link to a
 *      server nobody chose.
 *
 * The caller may pass the origin of the request that produced the link;
 * that is how a development server ends up with `http://localhost:3000`
 * rather than a bare path. It is a *fallback*, never an override of an
 * explicit setting.
 */
export function portalBaseUrl(
  env: Record<string, string | undefined> = process.env,
  requestOrigin?: string | null,
): string {
  const explicit = env.PATIENT_PORTAL_URL?.trim() || env.APP_BASE_URL?.trim();

  const candidate = explicit || requestOrigin?.trim() || '';

  if (candidate === '') return '';

  /*
   * Only http(s). A link is put in front of a patient; a `javascript:`
   * or `data:` value from a misconfigured environment variable must not
   * become one.
   */
  try {
    const url = new URL(candidate);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';

    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * The activation link handed to a patient.
 *
 * The token goes in the fragment, not the query string. Browsers do not
 * send a fragment to the server, so it stays out of access logs, proxy
 * logs and Referer headers; the activation screen reads it with
 * JavaScript and posts it in a request body.
 */
export function buildActivationLink(
  rawToken: string,
  env: Record<string, string | undefined> = process.env,
  requestOrigin?: string | null,
): string {
  return `${portalBaseUrl(env, requestOrigin)}/portal/activate#${rawToken}`;
}

/**
 * The origin of an incoming request, as the browser addressed it.
 *
 * `req.protocol` honours `trust proxy`, and the Host header is what the
 * staff browser actually used to reach this server — so a link built here
 * opens on the same host the receptionist is sitting at.
 */
export function requestOrigin(req: {
  protocol?: string;
  get?: (name: string) => string | undefined;
}): string | null {
  const host = req.get?.('host')?.trim();

  if (!host) return null;

  const protocol = req.protocol === 'http' ? 'http' : 'https';

  return `${protocol}://${host}`;
}

/* ============================================================
   Contact handling
   ============================================================ */

/**
 * Normalise a Kenyan phone number to digits.
 *
 * `0712 345 678`, `+254712345678` and `254-712-345-678` are the same
 * line. If they were stored as three identifiers, the same person could
 * hold three accounts — which is exactly the duplicate the brief is
 * worried about.
 *
 * This does not validate that the line exists; nothing in this module
 * claims to.
 */
export function normalisePhone(value: string): string {
  const digits = value.replace(/[^\d]/g, '');

  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;

  return digits;
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export type LoginType = 'PHONE' | 'EMAIL';

export interface NormalisedContact {
  type: LoginType;
  value: string;
}

/**
 * Decide what the patient will log in with.
 *
 * A phone number is preferred because it is what a Kenyan facility
 * actually collects. An email is accepted when there is no phone.
 * Returns null when neither is usable — the caller must then route the
 * patient to staff-assisted activation rather than inventing a contact.
 */
export function normaliseContact(input: {
  phone?: string | null;
  email?: string | null;
}): NormalisedContact | null {
  const phone = input.phone ? normalisePhone(input.phone) : '';

  if (phone.length >= 9 && phone.length <= 15) {
    return { type: 'PHONE', value: phone };
  }

  const email = input.email ? normaliseEmail(input.email) : '';

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254) {
    return { type: 'EMAIL', value: email };
  }

  return null;
}

/**
 * What the reception desk is allowed to see.
 *
 * The desk knows who is standing in front of them; it does not need the
 * full number, and the screen may be visible to the queue behind.
 */
export function maskContact(value: string | null, type: LoginType): string | null {
  if (!value) return null;

  if (type === 'EMAIL') {
    const [local, domain] = value.split('@');

    if (!domain) return '***';

    const visible = local.slice(0, 1);

    return `${visible}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
  }

  const digits = normalisePhone(value);

  if (digits.length < 6) return '***';

  return `${digits.slice(0, 4)}***${digits.slice(-3)}`;
}

/* ============================================================
   Invitation state
   ============================================================ */

export interface InvitationStateInput {
  status: string;
  expiresAt: Date | string;
}

/**
 * The status a caller should act on.
 *
 * The stored value can say PENDING forever; this is what makes an old
 * link stop working even if nothing has swept the row. An unparseable
 * expiry is treated as expired: refusing a link is recoverable, silently
 * honouring one forever is not.
 */
export function deriveInvitationStatus(
  invitation: InvitationStateInput,
  now: Date = new Date(),
): InvitationStatus {
  if (invitation.status === 'REVOKED') return 'REVOKED';
  if (invitation.status === 'ACTIVATED') return 'ACTIVATED';
  if (invitation.status === 'SUPERSEDED') return 'SUPERSEDED';

  const expiry =
    invitation.expiresAt instanceof Date ? invitation.expiresAt : new Date(invitation.expiresAt);

  if (Number.isNaN(expiry.getTime())) return 'EXPIRED';

  return expiry.getTime() <= now.getTime() ? 'EXPIRED' : 'PENDING';
}

/** Can this invitation be redeemed right now? */
export function isInvitationRedeemable(
  invitation: InvitationStateInput,
  now: Date = new Date(),
): boolean {
  return deriveInvitationStatus(invitation, now) === 'PENDING';
}

/**
 * May this invitation be resent?
 *
 * A superseded, activated or revoked invitation is history — resending
 * it would revive a link the facility already decided against. Only a
 * live or expired one is resendable, and only within the cap.
 */
export function canResendInvitation(input: {
  status: string;
  expiresAt: Date | string;
  deliveryAttempts: number;
  maxResends: number;
  purpose: string;
}): { allowed: boolean; reason?: string } {
  const status = deriveInvitationStatus(input);

  if (status === 'ACTIVATED') {
    return {
      allowed: false,
      reason:
        'This invitation was already used to activate an account. Resending it would be a second account.',
    };
  }

  if (status === 'REVOKED') {
    return {
      allowed: false,
      reason: 'This invitation was revoked. Create a new one if the patient asks again.',
    };
  }

  if (status === 'SUPERSEDED') {
    return {
      allowed: false,
      reason:
        'A newer invitation already replaced this one. Resend the current invitation instead.',
    };
  }

  if (input.deliveryAttempts >= input.maxResends) {
    return {
      allowed: false,
      reason: `This invitation has already been sent ${input.deliveryAttempts} times, which is the facility limit.`,
    };
  }

  if (input.purpose === 'ACTIVATION' && status === 'EXPIRED') {
    /*
     * An expired activation link is replaced, not resent: the same
     * token must never come back to life after it has been refused.
     */
    return {
      allowed: false,
      reason: 'This activation link has expired. Issue a new invitation instead of resending it.',
    };
  }

  return { allowed: true };
}

/* ============================================================
   Portal settings
   ============================================================ */

export interface PortalPolicy {
  invitationExpiryHours: number;
  maxResends: number;
  allowManualDelivery: boolean;
  allowSms: boolean;
  allowEmail: boolean;
  showLabResults: boolean;
  showAppointments: boolean;
  showPrescriptions: boolean;
  showAllergies: boolean;
  showDischargeSummaries: boolean;
  allowDownloads: boolean;
}

export const DEFAULT_PORTAL_POLICY: PortalPolicy = Object.freeze({
  invitationExpiryHours: DEFAULT_INVITATION_EXPIRY_HOURS,
  maxResends: DEFAULT_MAX_RESENDS,
  allowManualDelivery: true,
  allowSms: false,
  allowEmail: false,
  showLabResults: true,
  showAppointments: true,
  showPrescriptions: true,
  showAllergies: true,
  showDischargeSummaries: true,
  allowDownloads: true,
});

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(parsed)) return fallback;

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Clamp whatever the facility stored into something safe.
 *
 * A settings row is editable by a facility administrator, and an
 * administrator is exactly the person who might set a two-year
 * invitation lifetime to stop complaints at the desk. The bounds are not
 * a preference, so they are applied on read as well as on write.
 *
 * Note what is **not** settable: token length, single use, hashing, the
 * session length, and the requirement that patient identity is
 * established server-side. None of those appear in this interface,
 * because no facility setting is allowed to switch them off.
 */
export function clampPortalPolicy(raw: Partial<Record<keyof PortalPolicy, unknown>>): PortalPolicy {
  return {
    invitationExpiryHours: clampInt(
      raw.invitationExpiryHours,
      MIN_INVITATION_EXPIRY_HOURS,
      MAX_INVITATION_EXPIRY_HOURS,
      DEFAULT_PORTAL_POLICY.invitationExpiryHours,
    ),
    maxResends: clampInt(
      raw.maxResends,
      MIN_RESENDS,
      MAX_RESENDS,
      DEFAULT_PORTAL_POLICY.maxResends,
    ),
    allowManualDelivery: asBool(raw.allowManualDelivery, DEFAULT_PORTAL_POLICY.allowManualDelivery),
    allowSms: asBool(raw.allowSms, DEFAULT_PORTAL_POLICY.allowSms),
    allowEmail: asBool(raw.allowEmail, DEFAULT_PORTAL_POLICY.allowEmail),
    showLabResults: asBool(raw.showLabResults, DEFAULT_PORTAL_POLICY.showLabResults),
    showAppointments: asBool(raw.showAppointments, DEFAULT_PORTAL_POLICY.showAppointments),
    showPrescriptions: asBool(raw.showPrescriptions, DEFAULT_PORTAL_POLICY.showPrescriptions),
    showAllergies: asBool(raw.showAllergies, DEFAULT_PORTAL_POLICY.showAllergies),
    showDischargeSummaries: asBool(
      raw.showDischargeSummaries,
      DEFAULT_PORTAL_POLICY.showDischargeSummaries,
    ),
    allowDownloads: asBool(raw.allowDownloads, DEFAULT_PORTAL_POLICY.allowDownloads),
  };
}

/* ============================================================
   Passwords
   ============================================================ */

export interface PasswordCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Password rules for the portal.
 *
 * Length is the control that matters here: the account is a patient's,
 * used occasionally, on a phone keyboard. Composition rules like
 * "one symbol" push people towards `Password1!` and are not applied.
 * The length floor matches the staff hashPassword() requirement so one
 * module cannot produce a hash the other refuses.
 */
export function checkPortalPassword(password: unknown): PasswordCheck {
  if (typeof password !== 'string') {
    return { ok: false, reason: 'A password is required.' };
  }

  if (password.length < MIN_PORTAL_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `Use at least ${MIN_PORTAL_PASSWORD_LENGTH} characters.`,
    };
  }

  if (password.length > MAX_PORTAL_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `Use at most ${MAX_PORTAL_PASSWORD_LENGTH} characters.`,
    };
  }

  if (/^\s+$/.test(password)) {
    return { ok: false, reason: 'A password of only spaces is not a password.' };
  }

  if (/^(.)\1+$/.test(password)) {
    return { ok: false, reason: 'A password of one repeated character is not a password.' };
  }

  return { ok: true };
}

/* ============================================================
   Sharing
   ============================================================ */

export const SHARING_CATEGORIES = [
  'demographics',
  'encounters',
  'diagnoses',
  'medications',
  'laboratory',
  'radiology',
  'maternity',
  'billing',
] as const;

export type SharingCategory = (typeof SHARING_CATEGORIES)[number];

export const MIN_SHARING_HOURS = 1;
export const MAX_SHARING_HOURS = 24 * 30;
export const DEFAULT_SHARING_HOURS = 24;

/**
 * Validate a sharing request.
 *
 * Empty categories are refused: a grant that shares nothing is a click
 * that does nothing, and a grant that shares everything "because nothing
 * was selected" is the opposite of minimum necessary disclosure.
 */
export function validateSharingRequest(input: unknown): {
  recipientName: string;
  purpose: string;
  categories: SharingCategory[];
  hours: number;
} {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('A sharing request object is required.');
  }

  const body = input as Record<string, unknown>;

  const recipientName = typeof body.recipientName === 'string' ? body.recipientName.trim() : '';

  if (recipientName.length < 2 || recipientName.length > 160) {
    throw new Error('Name the recipient, between 2 and 160 characters.');
  }

  const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : '';

  if (purpose.length < 3 || purpose.length > 300) {
    throw new Error('State the purpose, between 3 and 300 characters.');
  }

  if (!Array.isArray(body.categories) || body.categories.length === 0) {
    throw new Error('Select at least one category to share.');
  }

  const categories: SharingCategory[] = [];

  for (const value of body.categories) {
    if (typeof value !== 'string' || !SHARING_CATEGORIES.includes(value as SharingCategory)) {
      throw new Error(`Categories must be drawn from: ${SHARING_CATEGORIES.join(', ')}.`);
    }

    if (!categories.includes(value as SharingCategory)) {
      categories.push(value as SharingCategory);
    }
  }

  const hours = clampInt(body.hours, MIN_SHARING_HOURS, MAX_SHARING_HOURS, DEFAULT_SHARING_HOURS);

  return { recipientName, purpose, categories, hours };
}

/* ============================================================
   Event descriptions
   ============================================================ */

const EVENT_DETAIL: Record<PortalEventType, string> = {
  CREATED: 'Invitation created',
  DELIVERY_ATTEMPTED: 'Delivery attempted',
  DELIVERY_SENT: 'Provider accepted the message',
  DELIVERY_FAILED: 'Provider rejected the message',
  DELIVERY_NOT_CONFIGURED: 'No provider is configured for this channel',
  HANDED_OVER: 'Handed to the patient at the desk',
  REDEEMED: 'Invitation redeemed and account activated',
  REDEEM_REJECTED: 'Redemption refused',
  REVOKED: 'Invitation revoked',
  SUPERSEDED: 'Invitation replaced by a newer one',
};

/**
 * A fixed description for an event.
 *
 * Callers cannot attach free text, which is how a token ends up in an
 * audit row. If more context is needed it belongs in a typed column,
 * not in a concatenated string.
 */
export function describeEvent(type: PortalEventType): string {
  return EVENT_DETAIL[type];
}

/* ============================================================
   QR payload
   ============================================================ */

/**
 * What the QR code encodes.
 *
 * A random opaque code with a prefix. It contains no patient id, no
 * MRN, no national ID and no token — so a photograph of the card in a
 * wallet discloses nothing on its own. Scanning it does not authenticate
 * anybody; it only helps a staff member find the account they are
 * already authorised to see.
 */
export const QR_PREFIX = 'JC-P';

export function generateQrCode(): string {
  return `${QR_PREFIX}${randomBytes(16).toString('base64url')}`;
}

export function hashQrCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Basic shape check before a hash lookup, so junk never reaches the index. */
export function isPlausibleQrCode(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(QR_PREFIX) &&
    value.length >= QR_PREFIX.length + 16 &&
    value.length <= 64
  );
}
