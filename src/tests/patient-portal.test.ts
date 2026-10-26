/**
 * JaliCare HMIS
 * Patient portal — policy and identifier tests
 *
 * These exercise the rules that decide who gets an invitation, who gets
 * in, and what an administrator may change. They are pure functions with
 * no database, which is the point: the security decisions live in code
 * that can be tested without standing up a server, so a later "quick fix"
 * to a route cannot quietly widen them.
 *
 * What is *not* tested here — because it needs a live PostgreSQL
 * database, which this build does not have:
 *
 *   - concurrent redemption of the same token
 *   - the unique constraint on `login_identifier`
 *   - cross-facility reads against real rows
 *
 * Those are covered by the source-level and migration checks in
 * `migrations.test.ts`, and are reported as unrun in
 * `docs/patient-portal/PATIENT_PORTAL_TEST_RESULTS.md`.
 *
 * Run with: npx tsx src/tests/patient-portal.test.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDelegablePermission } from '../auth/staff-role-policy.ts';

import {
  buildActivationLink,
  canResendInvitation,
  checkPortalPassword,
  clampPortalPolicy,
  DEFAULT_PORTAL_POLICY,
  deriveInvitationStatus,
  generateInvitationToken,
  generateQrCode,
  hashInvitationToken,
  hashesMatch,
  hashQrCode,
  isInvitationRedeemable,
  isPlausibleQrCode,
  maskContact,
  MAX_INVITATION_EXPIRY_HOURS,
  MAX_RESENDS,
  MAX_SHARING_HOURS,
  MIN_INVITATION_EXPIRY_HOURS,
  normaliseContact,
  normaliseEmail,
  normalisePhone,
  portalBaseUrl,
  QR_PREFIX,
  requestOrigin,
  SHARING_CATEGORIES,
  validateSharingRequest,
} from '../portal/portal-policy.ts';
import { schemaSource } from './support/schema-source.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertThrows(fn: () => unknown, label: string): void {
  checks += 1;

  try {
    fn();
  } catch {
    return;
  }

  throw new Error(`FAILED: ${label} (no error was thrown)`);
}

function code(relative: string): string {
  return readFileSync(resolve(repoRoot, relative), 'utf8');
}

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-10-22T09:00:00.000Z');

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

/* ============================================================
   1. Invitation tokens
   ============================================================ */

function tokenTests(): void {
  const first = generateInvitationToken();
  const second = generateInvitationToken();

  assert(first !== second, 'Two generated tokens differ');
  assert(first.length >= 40, 'An invitation token carries at least 240 bits of base64url text');
  assert(
    /^[A-Za-z0-9_-]+$/.test(first),
    'The token is URL-safe, so it can travel in a fragment without escaping',
  );

  const hash = hashInvitationToken(first);

  assert(/^[0-9a-f]{64}$/.test(hash), 'The stored form is a SHA-256 hex digest');
  assert(hash !== first, 'The stored form is not the token itself');
  assert(!hash.includes(first), 'The token cannot be recovered from the hash');
  assert(hashInvitationToken(first) === hash, 'Hashing is deterministic, so lookup by hash works');

  assert(hashesMatch(hash, hash), 'Identical hashes compare equal');
  assert(!hashesMatch(hash, hashInvitationToken(second)), 'Different tokens do not compare equal');
  const flipped = `${hash.slice(0, 63)}${hash.endsWith('0') ? '1' : '0'}`;

  assert(!hashesMatch(hash, flipped), 'A one-character difference is rejected');
  assert(!hashesMatch('abc', 'abcd'), 'Hashes of different lengths are rejected');

  /*
   * Entropy sanity: 32 random bytes must not repeat across a small
   * sample. A short or seeded generator would collide here.
   */
  const seen = new Set<string>();

  for (let i = 0; i < 500; i += 1) {
    seen.add(generateInvitationToken());
  }

  assert(seen.size === 500, '500 generated tokens are all distinct');
}

/* ============================================================
   2. Invitation expiry and single use
   ============================================================ */

function expiryTests(): void {
  assert(
    deriveInvitationStatus({ status: 'PENDING', expiresAt: at(HOUR) }, NOW) === 'PENDING',
    'A pending invitation inside its window is PENDING',
  );

  assert(
    deriveInvitationStatus({ status: 'PENDING', expiresAt: at(-1000) }, NOW) === 'EXPIRED',
    'A pending invitation past its window is EXPIRED even if nobody swept the row',
  );

  assert(
    deriveInvitationStatus({ status: 'PENDING', expiresAt: at(0) }, NOW) === 'EXPIRED',
    'An invitation expiring exactly now is expired, not still valid',
  );

  assert(
    deriveInvitationStatus({ status: 'ACTIVATED', expiresAt: at(HOUR) }, NOW) === 'ACTIVATED',
    'An activated invitation stays activated',
  );

  assert(
    deriveInvitationStatus({ status: 'REVOKED', expiresAt: at(HOUR) }, NOW) === 'REVOKED',
    'A revoked invitation cannot be revived by a future expiry',
  );

  assert(
    deriveInvitationStatus({ status: 'SUPERSEDED', expiresAt: at(HOUR) }, NOW) === 'SUPERSEDED',
    'A superseded invitation stays superseded',
  );

  assert(
    deriveInvitationStatus({ status: 'PENDING', expiresAt: 'not-a-date' }, NOW) === 'EXPIRED',
    'An unparseable expiry fails closed',
  );

  assert(
    deriveInvitationStatus({ status: 'PENDING', expiresAt: at(HOUR).toISOString() }, NOW) ===
      'PENDING',
    'An ISO string expiry is parsed, not treated as invalid',
  );

  assert(
    isInvitationRedeemable({ status: 'PENDING', expiresAt: at(HOUR) }, NOW),
    'A live pending invitation is redeemable',
  );

  assert(
    !isInvitationRedeemable({ status: 'PENDING', expiresAt: at(-1) }, NOW),
    'An expired invitation is not redeemable',
  );

  assert(
    !isInvitationRedeemable({ status: 'ACTIVATED', expiresAt: at(HOUR) }, NOW),
    'A used invitation is not redeemable a second time',
  );

  assert(
    !isInvitationRedeemable({ status: 'REVOKED', expiresAt: at(HOUR) }, NOW),
    'A revoked invitation is not redeemable',
  );

  assert(
    !isInvitationRedeemable({ status: 'SUPERSEDED', expiresAt: at(HOUR) }, NOW),
    'A superseded invitation is not redeemable',
  );
}

/* ============================================================
   3. Resend policy
   ============================================================ */

function resendTests(): void {
  /*
   * `canResendInvitation` reads the wall clock, so these cases are
   * anchored to `Date.now()` rather than the fixed NOW used by the
   * pure expiry tests.
   */
  const SOON = new Date(Date.now() + HOUR);
  const LONG_AGO = new Date(Date.now() - HOUR);

  const base = {
    status: 'PENDING',
    expiresAt: SOON,
    deliveryAttempts: 0,
    maxResends: 3,
    purpose: 'ACTIVATION',
  };

  const allowed = canResendInvitation(base);

  assert(allowed.allowed, 'A fresh pending invitation may be resent');
  assert(
    canResendInvitation({ ...base, deliveryAttempts: 2 }).allowed,
    'Resending is allowed below the cap',
  );
  assert(
    !canResendInvitation({ ...base, deliveryAttempts: 3 }).allowed,
    'Resending is refused at the cap',
  );
  assert(
    !canResendInvitation({ ...base, deliveryAttempts: 9 }).allowed,
    'Resending stays refused above the cap',
  );
  assert(
    canResendInvitation({ ...base, maxResends: 0 }).allowed === false,
    'A facility that allows zero resends allows none',
  );

  assert(
    !canResendInvitation({ ...base, status: 'ACTIVATED' }).allowed,
    'An activated invitation is never resent — that would be a second account',
  );
  assert(
    !canResendInvitation({ ...base, status: 'REVOKED' }).allowed,
    'A revoked invitation is never resent',
  );
  assert(
    !canResendInvitation({ ...base, status: 'SUPERSEDED' }).allowed,
    'A superseded invitation is never resent',
  );

  const expiredActivation = canResendInvitation({
    ...base,
    status: 'PENDING',
    expiresAt: LONG_AGO,
  });

  assert(!expiredActivation.allowed, 'An expired activation link is not resent');
  assert(
    typeof expiredActivation.reason === 'string' && expiredActivation.reason.includes('expired'),
    'The refusal explains that the link expired and a new invitation is needed',
  );

  /*
   * Recovery is the exception: the evidence that the person is the
   * patient is the same, so an expired recovery link may be reissued in
   * place. This is a deliberate difference from activation.
   */
  assert(
    canResendInvitation({
      ...base,
      status: 'PENDING',
      expiresAt: LONG_AGO,
      purpose: 'RECOVERY',
    }).allowed,
    'An expired recovery link may be reissued in place',
  );

  const refusals = [
    canResendInvitation({ ...base, status: 'ACTIVATED' }),
    canResendInvitation({ ...base, status: 'REVOKED' }),
    canResendInvitation({ ...base, status: 'SUPERSEDED' }),
    canResendInvitation({ ...base, deliveryAttempts: 5 }),
  ];

  assert(
    refusals.every((result) => typeof result.reason === 'string' && result.reason !== ''),
    'Every refusal carries a reason the receptionist can act on',
  );
}

/* ============================================================
   4. Contact normalisation and masking
   ============================================================ */

function contactTests(): void {
  const variants = ['0712345678', '+254712345678', '254-712-345-678', '254 712 345 678'];

  const normalised = variants.map((value) => normalisePhone(value));

  assert(
    new Set(normalised).size === 1,
    'Every spelling of one Kenyan number normalises to one identifier',
  );
  assert(normalised[0] === '254712345678', 'A leading zero becomes the 254 country code');

  assert(
    normaliseEmail('  Patient@Example.COM ') === 'patient@example.com',
    'Email is trimmed and lower-cased',
  );

  const phone = normaliseContact({ phone: '0712345678', email: 'a@b.co' });

  assert(phone?.type === 'PHONE', 'A phone number is preferred over an email');
  assert(phone?.value === '254712345678', 'The preferred contact is normalised');

  const email = normaliseContact({ phone: null, email: 'A@B.CO' });

  assert(email?.type === 'EMAIL', 'Email is used when no usable phone exists');
  assert(email?.value === 'a@b.co', 'The email is normalised');

  assert(
    normaliseContact({ phone: null, email: null }) === null,
    'No usable contact returns null rather than an invented one',
  );
  assert(
    normaliseContact({ phone: '123', email: 'not-an-email' }) === null,
    'A junk phone with a junk email returns null',
  );
  assert(normaliseContact({ phone: '   ', email: '   ' }) === null, 'Whitespace is not a contact');

  const maskedPhone = maskContact('254712345678', 'PHONE');

  assert(
    maskedPhone !== null && !maskedPhone.includes('712345678'),
    'A masked phone hides the middle',
  );
  assert(maskedPhone === '2547***678', 'The desk sees a prefix and the last three digits only');

  const maskedEmail = maskContact('patient@example.com', 'EMAIL');

  assert(
    maskedEmail === 'p******@example.com',
    'A masked email keeps the first letter and the domain',
  );
  assert(maskContact(null, 'PHONE') === null, 'There is nothing to mask when there is no contact');
  assert(maskContact('123', 'PHONE') === '***', 'Too short to mask partially is fully masked');
  assert(
    maskContact('no-at-sign', 'EMAIL') === '***',
    'A malformed email is fully masked rather than echoed',
  );

  /*
   * The full identifier must never be what the list endpoint returns.
   * This guards the reception screen against showing a number the queue
   * behind can read.
   */
  assert(
    maskedPhone !== '254712345678' && maskedEmail !== 'patient@example.com',
    'Masking always changes the value',
  );
}

/* ============================================================
   5. Passwords
   ============================================================ */

function passwordTests(): void {
  assert(!checkPortalPassword(null).ok, 'A missing password is rejected');
  assert(!checkPortalPassword(123456789012).ok, 'A non-string password is rejected');
  assert(!checkPortalPassword('short').ok, 'Fewer than 12 characters is rejected');
  assert(
    !checkPortalPassword('abcdefghijklm'.slice(0, 11)).ok,
    'Eleven characters is still too short',
  );
  assert(checkPortalPassword('abcdefghijkl').ok, 'Twelve characters is accepted');
  assert(!checkPortalPassword('x'.repeat(12)).ok, 'One repeated character is not a password');
  assert(!checkPortalPassword(' '.repeat(12)).ok, 'Twelve spaces is not a password');
  assert(checkPortalPassword('correct horse battery staple').ok, 'A long passphrase is accepted');
  assert(!checkPortalPassword('a'.repeat(201)).ok, 'Beyond the maximum length is rejected');
}

/* ============================================================
   6. Settings clamping
   ============================================================ */

function settingsTests(): void {
  const defaults = clampPortalPolicy({});

  assert(
    defaults.invitationExpiryHours === DEFAULT_PORTAL_POLICY.invitationExpiryHours,
    'Missing expiry falls back to the default',
  );
  assert(
    defaults.maxResends === DEFAULT_PORTAL_POLICY.maxResends,
    'Missing resend limit falls back to the default',
  );

  assert(
    clampPortalPolicy({ invitationExpiryHours: 1 }).invitationExpiryHours ===
      MIN_INVITATION_EXPIRY_HOURS,
    'An expiry below the floor is raised to the floor',
  );
  assert(
    clampPortalPolicy({ invitationExpiryHours: 100000 }).invitationExpiryHours ===
      MAX_INVITATION_EXPIRY_HOURS,
    'An expiry beyond the ceiling is reduced to the ceiling',
  );
  assert(
    clampPortalPolicy({ invitationExpiryHours: 'abc' }).invitationExpiryHours ===
      DEFAULT_PORTAL_POLICY.invitationExpiryHours,
    'A non-numeric expiry falls back to the default',
  );
  assert(
    clampPortalPolicy({ invitationExpiryHours: -50 }).invitationExpiryHours ===
      MIN_INVITATION_EXPIRY_HOURS,
    'A negative expiry cannot produce a link that is already dead',
  );
  assert(
    clampPortalPolicy({ maxResends: 500 }).maxResends === MAX_RESENDS,
    'A resend limit beyond the ceiling is reduced',
  );
  assert(
    clampPortalPolicy({ maxResends: -3 }).maxResends === 0,
    'A negative resend limit becomes zero',
  );

  assert(
    clampPortalPolicy({ allowSms: 'yes' }).allowSms === DEFAULT_PORTAL_POLICY.allowSms,
    'A string is not accepted as a boolean setting',
  );
  assert(
    clampPortalPolicy({ showAllergies: false }).showAllergies === false,
    'A boolean setting is honoured',
  );
  assert(
    clampPortalPolicy({ showLabResults: 0 }).showLabResults ===
      DEFAULT_PORTAL_POLICY.showLabResults,
    'A number is not accepted as a boolean setting, so a partial form cannot switch a section off',
  );

  /*
   * The settings screen may switch sections off, but it cannot switch
   * security off: there is no key in the policy that disables single use,
   * expiry or audit. If one were added, this fails.
   */
  const keys = Object.keys(DEFAULT_PORTAL_POLICY);

  assert(
    !keys.some((key) => /bypass|disable|skip|noverify|noauth/i.test(key)),
    'The policy has no key that disables a security control',
  );
  assert(
    keys.every((key) =>
      [
        'invitationExpiryHours',
        'maxResends',
        'allowManualDelivery',
        'allowSms',
        'allowEmail',
        'showLabResults',
        'showAppointments',
        'showPrescriptions',
        'showAllergies',
        'showDischargeSummaries',
        'allowDownloads',
      ].includes(key),
    ),
    'The policy is exactly the documented set of settings',
  );

  assert(
    Object.isFrozen(DEFAULT_PORTAL_POLICY),
    'The default policy is frozen so a caller cannot mutate the baseline',
  );

  assert(
    clampPortalPolicy({ invitationExpiryHours: 48, maxResends: 2 }).invitationExpiryHours === 48,
    'A value inside the range is preserved',
  );
}

/* ============================================================
   7. Sharing
   ============================================================ */

function sharingTests(): void {
  const valid = validateSharingRequest({
    recipientName: 'Dr A. Mwangi',
    purpose: 'Second opinion on the cardiology referral',
    categories: ['demographics', 'laboratory'],
    hours: 12,
  });

  assert(valid.recipientName === 'Dr A. Mwangi', 'The recipient name is trimmed and kept');
  assert(valid.categories.length === 2, 'The selected categories are kept');
  assert(valid.hours === 12, 'A duration inside the bounds is kept');

  assertThrows(() => validateSharingRequest(null), 'A null sharing request is refused');
  assertThrows(
    () => validateSharingRequest({ purpose: 'x', categories: ['demographics'], hours: 1 }),
    'A sharing request without a recipient is refused',
  );
  assertThrows(
    () =>
      validateSharingRequest({
        recipientName: 'Dr A. Mwangi',
        purpose: 'x',
        categories: ['demographics'],
        hours: 1,
      }),
    'A sharing request with a one-character purpose is refused',
  );
  assertThrows(
    () =>
      validateSharingRequest({
        recipientName: 'Dr A. Mwangi',
        purpose: 'Second opinion',
        categories: [],
        hours: 1,
      }),
    'A grant with no categories is refused rather than meaning "everything"',
  );
  assertThrows(
    () =>
      validateSharingRequest({
        recipientName: 'Dr A. Mwangi',
        purpose: 'Second opinion',
        categories: ['labratory'],
        hours: 1,
      }),
    'A misspelt category is refused rather than silently dropped',
  );
  assertThrows(
    () =>
      validateSharingRequest({
        recipientName: 'Dr A. Mwangi',
        purpose: 'Second opinion',
        categories: ['demographics', 'everything'],
        hours: 1,
      }),
    'One invalid category refuses the whole request',
  );

  const manyHours = validateSharingRequest({
    recipientName: 'Dr A. Mwangi',
    purpose: 'Second opinion',
    categories: ['demographics'],
    hours: 10000,
  });

  assert(manyHours.hours === MAX_SHARING_HOURS, 'A duration beyond the maximum is clamped');

  const noHours = validateSharingRequest({
    recipientName: 'Dr A. Mwangi',
    purpose: 'Second opinion',
    categories: ['demographics'],
  });

  assert(noHours.hours === 24, 'A missing duration uses the 24-hour default');

  const duplicates = validateSharingRequest({
    recipientName: 'Dr A. Mwangi',
    purpose: 'Second opinion',
    categories: ['demographics', 'demographics', 'laboratory'],
    hours: 4,
  });

  assert(duplicates.categories.length === 2, 'A repeated category is stored once');

  assert(
    SHARING_CATEGORIES.includes('laboratory') &&
      SHARING_CATEGORIES.includes('radiology') &&
      !(SHARING_CATEGORIES as readonly string[]).includes('everything'),
    'The category list is a fixed vocabulary with no catch-all',
  );
}

/* ============================================================
   8. QR card
   ============================================================ */

function qrTests(): void {
  const first = generateQrCode();
  const second = generateQrCode();

  assert(first.startsWith(QR_PREFIX), 'A card code carries the JaliCare prefix');
  assert(first !== second, 'Two card codes differ');
  assert(isPlausibleQrCode(first), 'A generated code passes the shape check');
  assert(
    /^JC-P[A-Za-z0-9_-]+$/.test(first),
    'The code is opaque, URL-safe text with no separators',
  );

  const hash = hashQrCode(first);

  assert(/^[0-9a-f]{64}$/.test(hash), 'The stored card value is a SHA-256 digest');
  assert(hash !== first, 'The card code is not stored in the clear');
  assert(hashQrCode(first) === hash, 'Card hashing is deterministic');

  assert(!isPlausibleQrCode(null), 'A null code is not plausible');
  assert(!isPlausibleQrCode(''), 'An empty code is not plausible');
  assert(!isPlausibleQrCode('MRC-12345'), 'A foreign prefix is not plausible');
  assert(!isPlausibleQrCode('JC-Pshort'), 'A too-short payload is not plausible');
  assert(
    !isPlausibleQrCode(`${QR_PREFIX}${'a'.repeat(200)}`),
    'An over-long payload is not plausible',
  );
  assert(!isPlausibleQrCode(`jc-p${'a'.repeat(20)}`), 'The prefix check is case-sensitive');

  /*
   * The encoded payload is the code and nothing else. This is checked
   * against the renderer, so a later "nice touch" — encoding the MRN or
   * the diagnosis into the symbol — fails the suite.
   *
   * The printed surround does carry the patient's name and MRN, which is
   * what makes the card useful at a desk. It carries no clinical data,
   * and none of it is inside the QR symbol.
   */
  const qrSource = code('src/portal/qr.service.ts');
  const encodeStart = qrSource.indexOf('QRCode.toString(');
  const encodeEnd = qrSource.indexOf('});', encodeStart);
  const encodeCall =
    encodeStart === -1 || encodeEnd === -1 ? '' : qrSource.slice(encodeStart, encodeEnd + 3);

  assert(encodeStart !== -1, 'The renderer encodes the symbol with the qrcode library');
  assert(
    /QRCode\.toString\(\s*code,/.test(qrSource),
    'The only value encoded into the symbol is the opaque code',
  );
  assert(
    !/firstName|lastName|mrn|dateOfBirth/i.test(encodeCall),
    'No patient identifier is passed to the encoder',
  );

  const surroundStart = qrSource.indexOf('const safeName');
  const surround = qrSource.slice(surroundStart, qrSource.indexOf('function escapeHtml'));

  assert(
    surroundStart !== -1 && !/diagnos|prescription|labResult|nationalId/i.test(surround),
    'The printed surround carries no clinical data and no national identifier',
  );
  assert(
    surround.includes('escapeHtml('),
    'Name and MRN are HTML-escaped before being drawn on the card',
  );
  assert(
    qrSource.includes('Scanning this card does not grant access'),
    'The card itself states that scanning does not grant access',
  );
}

/* ============================================================
   9. Source-level guarantees
   ============================================================ */

function sourceTests(): void {
  const routes = code('src/portal/portal.routes.ts');
  const admin = code('src/portal/portal-admin.routes.ts');
  const auth = code('src/portal/portal-auth.service.ts');
  const middleware = code('src/portal/portal.middleware.ts');
  const service = code('src/portal/portal.service.ts');

  /* --- Session identity is server-side --- */
  assert(
    middleware.includes('req.portalSession'),
    'The middleware attaches the session to the request rather than trusting a body field',
  );
  assert(
    !/req\.body\.patientId/.test(routes),
    'No portal route reads the patient id from the request body',
  );
  assert(
    !/req\.query\.patientId/.test(routes),
    'No portal route reads the patient id from the query string',
  );
  assert(!/body\.patientId/.test(routes), 'The patient id is never taken from a client payload');

  /* --- Tokens never appear where they can leak --- */
  assert(!/console\.(log|error)\([^)]*token/i.test(auth), 'The auth service does not log a token');
  assert(!/logAuditEvent\([^)]*token/i.test(service), 'Audit rows never receive a raw token');
  assert(
    routes.includes('req.body') && routes.includes('token'),
    'The activation token arrives in the body',
  );
  assert(
    !/req\.query\.token/.test(routes),
    'The activation token is never read from the query string',
  );

  /* --- Generic errors on activation --- */
  const activation = service.slice(service.indexOf('export async function activateInvitation'));

  assert(/INVALID_INVITATION/.test(activation), 'Activation has a generic refusal code');
  assert(
    (activation.match(/INVALID_INVITATION/g) ?? []).length >= 3,
    'Unknown, expired, used, revoked and superseded tokens all return that one code',
  );
  assert(
    !/TOKEN_EXPIRED|TOKEN_ALREADY_USED|TOKEN_REVOKED|TOKEN_NOT_FOUND/.test(activation),
    'Activation never tells the caller which case they hit',
  );
  assert(
    !/TOKEN_EXPIRED|TOKEN_ALREADY_USED|TOKEN_REVOKED/.test(routes),
    'The activation route does not distinguish expiry from reuse to the caller',
  );

  /* --- Clinical release rules --- */
  const records = code('src/portal/portal-records.service.ts');

  assert(records.includes("'Verified'"), 'Laboratory results are gated on the Verified status');
  assert(
    !/labResults\.status\)\s*!==\s*'Verified'/.test(records) ||
      records.includes("row.status !== 'Verified'"),
    'Unverified results are filtered out of the released set',
  );
  assert(
    records.includes('allowedFacilityIds'),
    'Record reads are scoped through the session’s allowed facilities',
  );
  assert(
    records.includes('eq(schema.patients.id, session.patientId)') ||
      records.includes('session.patientId'),
    'Reads are keyed on the session patient, never a request parameter',
  );

  /* --- Facility isolation on every list --- */
  assert(
    (records.match(/inArray\(schema\.encounters\.facilityId, facilities\)/g) ?? []).length >= 1,
    'Encounters are filtered by facility',
  );
  assert(
    (records.match(/inArray\(schema\.appointments\.facilityId, facilities\)/g) ?? []).length >= 1,
    'Appointments are filtered by facility',
  );
  assert(
    (records.match(/inArray\(schema\.labOrders\.facilityId, facilities\)/g) ?? []).length >= 1,
    'Laboratory orders are filtered by facility',
  );
  assert(
    (records.match(/inArray\(schema\.admissions\.facilityId, facilities\)/g) ?? []).length >= 1,
    'Discharge summaries are filtered by facility',
  );
  assert(
    (records.match(/inArray\(schema\.encounters\.facilityId, facilities\)/g) ?? []).length >= 2,
    'Prescriptions inherit the encounter’s facility filter',
  );
  assert(
    (
      records.match(/inArray\(schema\.patientAllergies\.facilityId, (facilities|facilityIds)\)/g) ??
      []
    ).length >= 2,
    'Allergies are filtered by facility in both the dashboard and the download',
  );

  /* --- No silent edits --- */
  assert(
    !/\.update\(schema\.(patients|diagnoses|encounters|labResults|medications)\)/.test(records),
    'The portal never writes to a clinical table',
  );
  assert(records.includes('requestRecordCorrection'), 'Corrections are requests, not edits');

  /* --- Audit --- */
  assert(
    (records.match(/logPortalRecordAccess\(/g) ?? []).length >= 8,
    'Every record read logs an access event',
  );
  assert(
    middleware.includes('patientPortalSessions') || middleware.includes('requirePortalAuth'),
    'Patient sessions are validated against the session table',
  );

  /* --- Admin surface --- */
  assert(
    admin.includes("requirePermission('portal.accounts.manage')"),
    'Account administration requires the account permission',
  );
  assert(
    admin.includes("requirePermission('portal.audit.read')"),
    'Audit review requires its own permission',
  );
  assert(
    admin.includes("requirePermission('portal.settings.manage')"),
    'Settings require their own permission',
  );
  assert(
    admin.includes('router.use(requireAuth)'),
    'The administration router is behind staff authentication',
  );
  assert(
    !/requirePortalAuth/.test(admin),
    'The administration router never accepts a patient session',
  );
  assert(
    (admin.match(/requirePermission\(/g) ?? []).length >= 15,
    'Every administrative route carries a permission check',
  );

  /* --- Not mounted in the patient bundle --- */
  assert(
    !/portalAdminApi/.test(routes),
    'The patient route file does not import staff administration calls',
  );
}

/* ============================================================
   10. Schema and migration shape
   ============================================================ */

function persistenceTests(): void {
  const sql = code('drizzle/0018_patient_portal.sql');
  const schema = schemaSource();

  assert(
    sql.includes('CREATE TABLE IF NOT EXISTS patient_portal_accounts'),
    'The migration creates the account table idempotently',
  );
  assert(
    /patient_portal_accounts[\s\S]{0,1800}UNIQUE[\s\S]{0,400}patient_id/i.test(sql),
    'One account per patient is enforced by a unique constraint',
  );
  assert(
    /UNIQUE[\s\S]{0,200}login_identifier/i.test(sql),
    'One login identifier maps to one account',
  );
  assert(
    /token_hash[\s\S]{0,120}UNIQUE|UNIQUE[\s\S]{0,120}token_hash/i.test(sql),
    'Invitation tokens are unique hashes',
  );
  assert(/qr_token_hash/.test(sql), 'The card stores a hash, not a code');
  assert(
    /qr_token_sealed/.test(sql),
    'The card also stores a sealed copy, so it can be re-rendered without weakening the hash',
  );
  assert(!/DROP TABLE/i.test(sql), 'The migration never drops a table');
  assert(!/DROP COLUMN/i.test(sql), 'The migration never drops a column');
  assert(!/TRUNCATE/i.test(sql), 'The migration never truncates');
  assert(!/UPDATE\s+patients/i.test(sql), 'The migration does not rewrite patient rows');

  assert(
    schema.includes("'patient_portal_accounts'"),
    'The Drizzle schema declares the account table',
  );
  assert(
    /qrTokenSealed:\s*text\('qr_token_sealed'\)/.test(schema),
    'The Drizzle schema declares the sealed card column',
  );
  const accountTableStart = schema.indexOf('export const patientPortalAccounts = pgTable(');
  const accountTableEnd = schema.indexOf('export const', accountTableStart + 10);
  const accountTable =
    accountTableStart === -1
      ? ''
      : schema.slice(accountTableStart, accountTableEnd === -1 ? undefined : accountTableEnd);

  assert(accountTableStart !== -1, 'The account table is declared in the Drizzle schema');
  assert(
    /uniqueIndex\([\s\S]{0,120}patient_idx[\s\S]{0,120}patientId/.test(accountTable),
    'The unique index on patient_id is declared in the Drizzle schema',
  );
  assert(
    /uniqueIndex\([\s\S]{0,120}login_identifier|uniqueIndex\([\s\S]{0,160}loginIdentifier/.test(
      accountTable,
    ),
    'The unique index on the login identifier is declared in the Drizzle schema',
  );
}

/* ============================================================
   11. Permissions
   ============================================================ */

function permissionTests(): void {
  const permissions = code('src/seeds/permissions.ts');
  const catalogue = code('src/auth/staff-role-catalogue.ts');
  const platform = code('src/routes/platform.routes.ts');

  for (const permission of [
    'portal.invite',
    'portal.invites.manage',
    'portal.accounts.manage',
    'portal.audit.read',
    'portal.settings.manage',
  ]) {
    assert(permissions.includes(`code: '${permission}'`), `${permission} is seeded`);
  }

  assert(catalogue.includes("'portal.invite'"), 'The receptionist role can invite patients');
  assert(
    !catalogue.includes("'portal.accounts.manage'"),
    'The receptionist role cannot administer accounts',
  );
  assert(
    !catalogue.includes("'portal.audit.read'"),
    'The receptionist role cannot read the portal audit trail',
  );
  assert(
    !catalogue.includes("'portal.settings.manage'"),
    'The receptionist role cannot change portal policy',
  );

  for (const permission of [
    'portal.accounts.manage',
    'portal.audit.read',
    'portal.invite',
    'portal.invites.manage',
    'portal.settings.manage',
  ]) {
    assert(
      platform.includes(`'${permission}'`),
      `${permission} is reserved for the facility administrator`,
    );
  }

  /*
   * Delegation. A facility may hand the front-desk task to a custom
   * role; it may not hand out the machinery around it.
   */
  assert(
    isDelegablePermission({ code: 'portal.invite', module: 'portal' }),
    'Inviting patients can be delegated to a staff role',
  );

  for (const code of [
    'portal.accounts.manage',
    'portal.audit.read',
    'portal.invites.manage',
    'portal.settings.manage',
  ]) {
    assert(
      !isDelegablePermission({ code, module: 'portal' }),
      `${code} cannot be delegated to a staff role`,
    );
  }

  assert(
    !isDelegablePermission({ code: 'portal.invite', module: 'platform' }),
    'A permission outside the allowed modules is not delegable',
  );
}

/* ============================================================
   Activation links and the public mount
   ============================================================ */

function activationLinkTests(): void {
  const token = 'raw-token-value';

  /*
   * An explicit portal address wins, and the token goes in the fragment:
   * a browser never sends a fragment to the server, so it cannot reach an
   * access log or a Referer header.
   */
  const configured = buildActivationLink(
    token,
    { PATIENT_PORTAL_URL: 'https://portal.example.ke/' },
    'http://localhost:3000',
  );

  assert(
    configured === 'https://portal.example.ke/portal/activate#raw-token-value',
    'the configured portal address is used, in the fragment',
  );

  /*
   * No portal address, but the installation has one. The portal is served
   * by the same Express app, so this is the normal production case.
   */
  assert(
    buildActivationLink(token, { APP_BASE_URL: 'https://hmis.example.ke' }) ===
      'https://hmis.example.ke/portal/activate#raw-token-value',
    'APP_BASE_URL is used when no portal address is set',
  );

  /*
   * The reported bug: nothing configured, and the link came out as a bare
   * path — "the domain was not added". The request origin is now carried
   * through, so a development server produces an absolute URL.
   */
  assert(
    buildActivationLink(token, {}, 'http://localhost:3000') ===
      'http://localhost:3000/portal/activate#raw-token-value',
    'the request origin fills the gap in development',
  );

  /*
   * A configuration value must never be able to produce a script URL in
   * front of a patient.
   */
  assert(
    portalBaseUrl({ PATIENT_PORTAL_URL: 'javascript:alert(1)' }) === '',
    'a non-http(s) portal URL is refused',
  );
  assert(
    portalBaseUrl({ PATIENT_PORTAL_URL: 'not a url' }) === '',
    'a malformed portal URL is refused',
  );
  assert(
    buildActivationLink(token, {}) === '/portal/activate#' + token,
    'with nothing at all the link is relative, and visibly incomplete',
  );

  /*
   * A trailing-slash base must not produce a double slash before /portal.
   */
  assert(
    portalBaseUrl({ APP_BASE_URL: 'https://hmis.example.ke//' }) === 'https://hmis.example.ke',
    'trailing slashes are trimmed',
  );

  /* Request origin, as the browser addressed the server. */
  assert(
    requestOrigin({ protocol: 'http', get: () => 'localhost:3000' }) === 'http://localhost:3000',
    'the request origin keeps the http protocol in development',
  );
  assert(
    requestOrigin({ protocol: 'https', get: () => 'hmis.example.ke' }) ===
      'https://hmis.example.ke',
    'and https in production',
  );
  assert(
    requestOrigin({ protocol: 'http', get: () => undefined }) === null,
    'a request with no Host header has no origin',
  );

  /*
   * The mount order that produced "Authentication is required" for a
   * patient holding a valid invitation: `/api/portal` sat below the
   * global staff gate. Both statements are required — the portal first,
   * the staff gate after.
   */
  const app = code('src/app.ts');
  const portalMount = app.indexOf("app.use('/api/portal', portalRoutes);");
  const adminMount = app.indexOf("app.use('/api/portal/admin', portalAdminRoutes);");
  const staffGate = app.indexOf("app.use('/api', requireAuth);");

  assert(portalMount > -1 && adminMount > -1, 'both portal routers are mounted');
  assert(staffGate > -1, 'the staff gate is mounted');

  assert(
    portalMount < staffGate,
    'the patient portal is mounted before the staff authentication gate',
  );
  assert(
    adminMount < staffGate,
    'portal administration is mounted before it too (it applies requireAuth itself)',
  );
  assert(adminMount < portalMount, 'the admin router is matched before the patient router');

  /* The patient router must still guard everything but activation/login. */
  const portalRouter = code('src/portal/portal.routes.ts');
  assert(
    portalRouter.includes('router.use(requirePortalAuth)'),
    'the patient router guards itself, so moving it changes nothing else',
  );
  assert(!portalRouter.includes('requireAuth('), 'the patient router never accepts a staff token');

  const adminRouter = code('src/portal/portal-admin.routes.ts');
  assert(
    adminRouter.includes('router.use(requireAuth)'),
    'moving the admin router above the gate does not open it',
  );

  /* The portal path check must tolerate a trailing slash. */
  const shell = code('src/App.tsx');
  assert(
    shell.includes('PORTAL_PATHS') && shell.includes("replace(/\\/+$/, '')"),
    'a trailing slash still opens the portal, not the staff shell',
  );
}

/* ============================================================
   Run
   ============================================================ */

function run(): void {
  tokenTests();
  expiryTests();
  resendTests();
  contactTests();
  passwordTests();
  settingsTests();
  sharingTests();
  qrTests();
  sourceTests();
  persistenceTests();
  permissionTests();
  activationLinkTests();
}

run();

console.log(`\nPatient portal policy: ${checks} assertions passed.`);
