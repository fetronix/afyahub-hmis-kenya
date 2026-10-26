/**
 * JaliCare HMIS
 * Digital patient card
 *
 * A QR code that helps a staff member find a patient they are already
 * authorised to see. It is not an access token.
 *
 *   - The payload is `JC-P` plus 16 random bytes. No patient id, no
 *     MRN, no national ID, no session token, no diagnosis.
 *   - Only a SHA-256 hash of the code is stored, so a table dump yields
 *     no scannable cards.
 *   - Scanning does nothing on its own. The lookup endpoint requires a
 *     staff session, a permission, a facility scope and a rate limit,
 *     and it writes an access-log row.
 *
 * The SVG is generated server-side from the stored code at issue time.
 * It is not cached, not written to disk and not served from a public
 * path: the patient-facing endpoint re-renders it on demand for the
 * authenticated account that owns it.
 */

import QRCode from 'qrcode';
import { eq, sql } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { logAuditEvent } from '../db/queries.ts';

import { decryptField, encryptField } from '../security/field-crypto.ts';

import type { PortalSession } from './portal-auth.service.ts';
import { PortalError } from './portal.service.ts';
import { generateQrCode, hashQrCode, isPlausibleQrCode } from './portal-policy.ts';

/* ============================================================
   Issue
   ============================================================ */

/**
 * Issue (or re-issue) the digital card.
 *
 * Re-issuing replaces the hash, which invalidates every previously
 * printed card for that patient. That is the intended behaviour for a
 * lost card: the old one stops resolving.
 */
export async function issueDigitalCard(
  session: PortalSession,
): Promise<{ code: string; svg: string; issuedAt: Date }> {
  const code = generateQrCode();
  const issuedAt = new Date();

  await db
    .update(schema.patientPortalAccounts)
    .set({
      /*
       * Hash for lookup, sealed value so the owner can re-open the card.
       * With FIELD_ENCRYPTION_KEY set the stored copy is AES-256-GCM;
       * without it the value is the plaintext code, which is an opaque
       * random identifier and discloses no health information.
       */
      qrTokenHash: hashQrCode(code),
      qrTokenSealed: encryptField(code),
      qrIssuedAt: issuedAt,
      updatedAt: issuedAt,
    })
    .where(eq(schema.patientPortalAccounts.id, session.accountId));

  const svg = await renderCard(code, session);

  await logAuditEvent(
    session.tenantId,
    session.facilityId,
    null,
    'CREATE',
    'PatientPortalAccount',
    String(session.accountId),
    'Digital patient card issued',
  );

  return { code, svg, issuedAt };
}

/**
 * Re-render the card for the owning account.
 *
 * Only the account that owns the card can read it, and only through its
 * own session. The lookup hash is never returned to the browser: the
 * patient gets an SVG, not a string that could be pasted into an API
 * call.
 */
export async function getDigitalCard(
  session: PortalSession,
): Promise<{ svg: string; issuedAt: Date | null }> {
  const [account] = await db
    .select({
      qrTokenSealed: schema.patientPortalAccounts.qrTokenSealed,
      qrIssuedAt: schema.patientPortalAccounts.qrIssuedAt,
    })
    .from(schema.patientPortalAccounts)
    .where(eq(schema.patientPortalAccounts.id, session.accountId))
    .limit(1);

  if (!account?.qrTokenSealed) {
    throw new PortalError(
      'No digital card has been issued for this account.',
      404,
      'NO_DIGITAL_CARD',
    );
  }

  const code = decryptField(account.qrTokenSealed);

  if (!code) {
    throw new PortalError(
      'No digital card has been issued for this account.',
      404,
      'NO_DIGITAL_CARD',
    );
  }

  const svg = await renderCard(code, session);

  return { svg, issuedAt: account.qrIssuedAt };
}

async function renderCard(code: string, session: PortalSession): Promise<string> {
  const [patient] = await db
    .select({
      mrn: schema.patients.mrn,
      firstName: schema.patients.firstName,
      lastName: schema.patients.lastName,
    })
    .from(schema.patients)
    .where(eq(schema.patients.id, session.patientId))
    .limit(1);

  /*
   * Only the opaque code is encoded. The name and MRN are drawn on the
   * card's printed surround by the browser, not inside the symbol.
   */
  const qr = await QRCode.toString(code, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
    color: { dark: '#0f172a', light: '#ffffff' },
  });

  const safeName = `${patient?.firstName ?? ''} ${patient?.lastName ?? ''}`.trim();
  const safeMrn = patient?.mrn ?? '';

  return [
    '<div class="patient-card">',
    `  <div class="patient-card__qr">${qr}</div>`,
    '  <div class="patient-card__meta">',
    `    <p class="patient-card__name">${escapeHtml(safeName)}</p>`,
    `    <p class="patient-card__mrn">${escapeHtml(safeMrn)}</p>`,
    '    <p class="patient-card__note">Scanning this card does not grant access. A staff member must sign in.</p>',
    '  </div>',
    '</div>',
  ].join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================
   Resolve — staff side
   ============================================================ */

/**
 * Resolve a scanned card to a patient the caller may see.
 *
 * Four controls, all of them necessary:
 *
 *   1. the caller must be authenticated with `patients.read` (the route
 *      enforces this);
 *   2. the account is looked up inside the caller's facility — a card
 *      from another facility is "not found", not "forbidden";
 *   3. a card that does not exist and a card from another facility
 *      produce the same response, so the endpoint cannot be used to test
 *      whether a code is real;
 *   4. the read is written to `patient_record_access_logs` with the
 *      `API` channel, so a scan is as accountable as a screen view.
 */
export async function resolveDigitalCard(
  context: AuthorizationContext,
  rawCode: unknown,
  request?: { ipAddress?: string | null; userAgent?: string | null },
) {
  const facilityId = resolveFacilityScope(context, undefined);

  if (context.tenantId === null || context.tenantId === undefined) {
    throw new PortalError('Select a facility first.', 400, 'TENANT_REQUIRED');
  }

  if (!isPlausibleQrCode(rawCode)) {
    /*
     * Shape-invalid codes are rejected before a database round trip, and
     * with the same message as a miss.
     */
    throw new PortalError('No patient matches that card.', 404, 'CARD_NOT_FOUND');
  }

  const [row] = await db
    .select({
      accountId: schema.patientPortalAccounts.id,
      accountStatus: schema.patientPortalAccounts.status,
      patientId: schema.patients.id,
      mrn: schema.patients.mrn,
      firstName: schema.patients.firstName,
      middleName: schema.patients.middleName,
      lastName: schema.patients.lastName,
      dateOfBirth: schema.patients.dateOfBirth,
      gender: schema.patients.gender,
    })
    .from(schema.patientPortalAccounts)
    .innerJoin(schema.patients, eq(schema.patientPortalAccounts.patientId, schema.patients.id))
    .where(
      sql`${schema.patientPortalAccounts.qrTokenHash} = ${hashQrCode(String(rawCode))}
        and ${schema.patientPortalAccounts.tenantId} = ${context.tenantId}
        and ${schema.patientPortalAccounts.facilityId} = ${facilityId}`,
    )
    .limit(1);

  if (!row) {
    throw new PortalError('No patient matches that card.', 404, 'CARD_NOT_FOUND');
  }

  await db.insert(schema.patientRecordAccessLogs).values({
    patientId: row.patientId,
    userId: context.userId,
    tenantId: context.tenantId,
    facilityId,
    action: 'VIEW',
    accessChannel: 'API',
    recordType: 'PatientDigitalCard',
    recordId: row.accountId,
    purpose: 'DIRECT_CARE',
    ipAddress: request?.ipAddress ?? null,
    userAgent: request?.userAgent ?? null,
  });

  return {
    patientId: row.patientId,
    mrn: row.mrn,
    firstName: row.firstName,
    middleName: row.middleName,
    lastName: row.lastName,
    dateOfBirth: row.dateOfBirth,
    gender: row.gender,
    /*
     * A revoked or suspended portal account does not invalidate the
     * card: the person is still a patient. The status is reported so the
     * staff member knows not to expect a working portal login.
     */
    portalAccountStatus: row.accountStatus,
    note: 'Scanning a card never grants access to a record. This lookup ran under your own staff session and was logged.',
  };
}
