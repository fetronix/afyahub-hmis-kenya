import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { hasAllPermissions } from '../auth/authorization.service.ts';
import type { PortalSession } from '../portal/portal-auth.service.ts';
import { loadPortalPolicy } from '../portal/portal.service.ts';
import { insist, PatientDocumentError, validatePatientFile } from './patient-file-validation.ts';

export const DOCUMENT_FIELDS =
  'id,patient_id,root_id,version,title,category,document_type,signing_date,patient_signature,doctor_signature,doctor_id,notes,filename,mime_type,sha256,uploaded_by,uploaded_at,radiology_order_id,procedure_name,reason,radiology_attachment_context';
/**
 * Portal projection. Staff notes, uploader/doctor identities, hashes, ages,
 * reasons and audit history never leave the facility: a patient receives only
 * what identifies their own document.
 */
export const PORTAL_DOCUMENT_FIELDS =
  'd.id,d.root_id,d.title,d.category,d.document_type,d.signing_date,d.uploaded_at,d.mime_type,d.version,d.procedure_name,d.radiology_attachment_context,(d.radiology_order_id IS NOT NULL) AS radiology_linked';
export type PortalDocumentGroup = 'CONSENT' | 'CLINICAL' | 'OTHER';
export const PORTAL_GROUP_LABELS: Record<PortalDocumentGroup, string> = {
  CONSENT: 'Consent forms',
  CLINICAL: 'Clinical documents',
  OTHER: 'Other documents',
};
/**
 * Category shown in the portal. Documents are immutable, so classifying from
 * the recorded title/type/link at read time cannot drift from what was stored.
 * This is a display grouping, not a claim that anything was signed or verified.
 */
export function portalDocumentGroup(d: {
  title?: unknown;
  category?: unknown;
  document_type?: unknown;
  radiology_linked?: unknown;
  radiology_attachment_context?: unknown;
}): PortalDocumentGroup {
  if (d.radiology_linked)
    return d.radiology_attachment_context === 'POST_REPORTING_HISTORICAL' ? 'CLINICAL' : 'CONSENT';
  if (d.category === 'Radiology') return 'CLINICAL';
  const text = `${d.title ?? ''} ${d.category ?? ''} ${d.document_type ?? ''}`.toLowerCase();
  if (/consent|authoris|authoriz/.test(text)) return 'CONSENT';
  if (
    /laborator|patholog|histolog|\blab\b|radiolog|imaging|scan|x-ray|ultrasound|clinical|discharge|referral|summary|report/.test(
      text,
    )
  )
    return 'CLINICAL';
  return 'OTHER';
}
export function portalDocumentKind(d: {
  title?: unknown;
  document_type?: unknown;
  radiology_linked?: unknown;
  radiology_attachment_context?: unknown;
}): string {
  const text = `${d.title ?? ''} ${d.document_type ?? ''}`.toLowerCase();
  if (d.radiology_linked)
    return d.radiology_attachment_context === 'POST_REPORTING_HISTORICAL'
      ? 'Radiology supporting document'
      : 'Radiology / procedure consent';
  if (portalDocumentGroup(d) === 'CONSENT')
    return /treatment/.test(text) ? 'Treatment consent' : 'Signed consent form';
  if (/laborator|patholog|histolog|\blab\b/.test(text)) return 'Laboratory document';
  if (/radiolog|imaging|scan|x-ray|ultrasound|report/.test(text)) return 'Radiology report';
  if (portalDocumentGroup(d) === 'CLINICAL') return 'Clinical document';
  return 'General patient document';
}
export function portalDocumentSource(d: {
  title?: unknown;
  document_type?: unknown;
  radiology_linked?: unknown;
}): string {
  if (d.radiology_linked) return 'Radiology & Imaging';
  if (/laborator|patholog|histolog|\blab\b/i.test(`${d.title ?? ''} ${d.document_type ?? ''}`))
    return 'Laboratory & Pathology';
  return 'Patient records';
}
/**
 * The same three-way grouping in SQL, so search, category filters and the
 * server-side page all run over the full authorized set instead of a slice.
 */
const PORTAL_GROUP_SQL = `CASE
 WHEN d.radiology_order_id IS NOT NULL AND COALESCE(d.radiology_attachment_context,'PRE_PROCEDURE')='PRE_PROCEDURE' THEN 'CONSENT'
 WHEN d.radiology_order_id IS NOT NULL THEN 'CLINICAL'
 WHEN d.category='Radiology' THEN 'CLINICAL'
 WHEN concat_ws(' ',d.title,d.category,d.document_type) ~* '(consent|authoris|authoriz)' THEN 'CONSENT'
 WHEN concat_ws(' ',d.title,d.category,d.document_type) ~* '(laborator|patholog|histolog|\\ylab\\y|radiolog|imaging|scan|x-ray|ultrasound|clinical|discharge|referral|summary|report)' THEN 'CLINICAL'
 ELSE 'OTHER' END`;
const completedRadiologyStatuses = ['reported', 'performed', 'completed'];
export function radiologyRequestCompleted(status: unknown): boolean {
  return completedRadiologyStatuses.includes(
    String(status ?? '')
      .trim()
      .toLowerCase(),
  );
}
export function idOf(raw: unknown): number {
  const n = Number(raw);
  insist(Number.isSafeInteger(n) && n > 0, 'INVALID_ID', 'A positive identifier is required.');
  return n;
}
function text(v: unknown, max: number, required = true): string {
  insist(
    (!required && (v === undefined || v === null || v === '')) ||
      (typeof v === 'string' &&
        v.trim().length > 0 &&
        v.length <= max &&
        !Array.from(v).some(
          (char) => char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)),
        )),
    'INVALID_METADATA',
    'Check document metadata and required fields.',
  );
  return typeof v === 'string' ? v.trim() : '';
}
export function auditReason(v: unknown) {
  insist(
    typeof v === 'string' && v.trim().length > 0,
    'REASON_REQUIRED',
    'Explain the operation in 10–500 characters.',
  );
  const s = text(v, 500);
  insist(s.length >= 10, 'REASON_REQUIRED', 'Explain the operation in 10–500 characters.');
  return s;
}
export interface DocumentPageInfo {
  limit: number;
  total: number;
  returned: number;
  has_more: boolean;
  next_cursor: string | null;
}
export interface DocumentCursor {
  uploadedAt: string;
  id: number;
}
/** Page size for list/search. Bounded so one request cannot walk a whole history. */
export function pageLimit(raw: unknown, fallback = 50, max = 100): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  insist(
    Number.isSafeInteger(n) && n >= 1 && n <= max,
    'INVALID_LIMIT',
    `Choose between 1 and ${max} documents per page.`,
  );
  return n;
}
/**
 * Keyset cursor over (uploaded_at, id) newest first. A cursor is opaque to the
 * browser and only ever narrows the caller's own authorized scope, so changing
 * it cannot widen what is returned.
 */
export function encodeDocumentCursor(row: { uploaded_at: unknown; id: number }): string {
  return Buffer.from(
    JSON.stringify({ t: new Date(String(row.uploaded_at)).toISOString(), i: row.id }),
  ).toString('base64url');
}
export function decodeDocumentCursor(raw: unknown): DocumentCursor | null {
  if (raw === undefined || raw === null || raw === '') return null;
  insist(
    typeof raw === 'string' && raw.length <= 200,
    'INVALID_CURSOR',
    'The document page cursor is invalid.',
  );
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      t?: unknown;
      i?: unknown;
    };
    insist(
      typeof parsed?.t === 'string' &&
        !isNaN(Date.parse(parsed.t)) &&
        Number.isSafeInteger(parsed.i) &&
        Number(parsed.i) > 0,
      'INVALID_CURSOR',
      'The document page cursor is invalid.',
    );
    return { uploadedAt: new Date(parsed.t).toISOString(), id: Number(parsed.i) };
  } catch (error) {
    if (error instanceof PatientDocumentError) throw error;
    throw new PatientDocumentError('INVALID_CURSOR', 'The document page cursor is invalid.', 400);
  }
}
export type PortalReleaseStatus = 'NOT_RELEASED' | 'RELEASED' | 'REVOKED';
export function portalReleaseStatus(row: {
  released?: unknown;
  document_id?: unknown;
}): PortalReleaseStatus {
  if (!row || row.document_id === null || row.document_id === undefined) return 'NOT_RELEASED';
  return row.released === true ? 'RELEASED' : 'REVOKED';
}
export function requireDocumentPermission(context: AuthorizationContext, ...permissions: string[]) {
  insist(
    !context.isSuperAdmin &&
      !context.roles.includes('SUPER_ADMIN') &&
      context.tenantId &&
      context.facilityId &&
      hasAllPermissions(context, ['patients.read', ...permissions]),
    'DOCUMENT_FORBIDDEN',
    'A scoped facility account and document permissions are required.',
    403,
  );
}
async function transaction<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
async function patient(c: PoolClient, s: AuthorizationContext, patientId: number) {
  const r = await c.query(
    'SELECT id FROM patients WHERE id=$1 AND tenant_id=$2 AND registration_facility_id=$3',
    [patientId, s.tenantId, s.facilityId],
  );
  insist(r.rowCount, 'DOCUMENT_NOT_FOUND', 'Patient or document not found in this facility.', 404);
}
async function clinician(c: PoolClient, s: AuthorizationContext, id: number) {
  const r = await c.query(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id
     JOIN roles r ON r.id=ur.role_id WHERE ${activeDoctor} AND u.id=$3 LIMIT 1`,
    [s.tenantId, s.facilityId, id],
  );
  insist(r.rowCount, 'INVALID_CLINICIAN', 'Identify an active Doctor in this facility.');
}
// Use the same active, non-revoked, tenant-owned role boundary as staff authorization.
// A designation or a client/session role label alone is not proof of being a doctor.
const activeDoctor = `u.tenant_id=$1 AND u.facility_id=$2 AND u.account_status='ACTIVE'
  AND u.is_active=true AND u.deactivated_at IS NULL
  AND (u.locked_until IS NULL OR u.locked_until <= now())
  AND ur.is_active=true AND ur.revoked_at IS NULL
  AND r.is_active=true AND r.tenant_id=u.tenant_id AND upper(r.name)='DOCTOR'`;
export function canAssignResponsibleDoctor(s: AuthorizationContext) {
  // Existing permission used for patient/consent editing. Upload alone allows self only.
  return hasAllPermissions(s, ['patients.update']);
}
export async function responsibleDoctorOptions(
  s: AuthorizationContext,
  p: number,
  search: unknown = '',
) {
  requireDocumentPermission(s, 'patients.documents.read', 'patients.documents.upload');
  const query = text(search, 80, false);
  return transaction(async (c) => {
    await patient(c, s, p);
    const current = await c.query(
      `SELECT u.id,u.full_name AS name,u.designation FROM users u
       JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
       WHERE ${activeDoctor} AND u.id=$3 LIMIT 1`,
      [s.tenantId, s.facilityId, s.userId],
    );
    const canAssignOthers = canAssignResponsibleDoctor(s);
    const results = await c.query(
      `SELECT DISTINCT u.id,u.full_name AS name,u.designation FROM users u
       JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
       WHERE ${activeDoctor} AND ($3::boolean OR u.id=$4)
       AND ($5='' OR position(lower($5) in lower(u.full_name))>0
         OR position(lower($5) in lower(COALESCE(u.designation,'')))>0)
       ORDER BY name,u.id LIMIT 51`,
      [s.tenantId, s.facilityId, canAssignOthers, s.userId, query],
    );
    return {
      currentDoctor: current.rows[0] ?? null,
      canAssignOthers,
      doctors: results.rows.slice(0, 50),
      hasMore: results.rows.length > 50,
    };
  });
}
async function resolveResponsibleDoctor(
  c: PoolClient,
  s: AuthorizationContext,
  requested: unknown,
) {
  const explicit = requested !== undefined && requested !== null && requested !== '';
  const selectedId = explicit ? idOf(requested) : s.userId;
  insist(
    selectedId === s.userId || canAssignResponsibleDoctor(s),
    'DOCTOR_ASSIGNMENT_FORBIDDEN',
    'Assigning another responsible doctor requires patient update permission.',
    403,
  );
  const selected = await c.query(
    `SELECT u.id,u.full_name AS name FROM users u
     JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
     WHERE ${activeDoctor} AND u.id=$3 LIMIT 1 FOR SHARE OF u,ur,r`,
    [s.tenantId, s.facilityId, selectedId],
  );
  insist(
    selected.rowCount,
    explicit ? 'INVALID_RESPONSIBLE_DOCTOR' : 'DOCTOR_REQUIRED',
    'Select an active Doctor in this facility before uploading. Non-doctors are not assigned automatically.',
  );
  return selected.rows[0] as { id: number; name: string };
}
async function withDoctorNames<T extends Record<string, any>>(
  c: PoolClient,
  s: AuthorizationContext,
  rows: T[],
) {
  // Historical IDs are immutable; keep inactive doctors readable without making them selectable.
  const users = await c.query(
    'SELECT id,full_name FROM users WHERE tenant_id=$1 AND facility_id=$2 AND id=ANY($3::int[])',
    [s.tenantId, s.facilityId, rows.flatMap((d) => [d.doctor_id, d.uploaded_by]).filter(Boolean)],
  );
  const names = new Map(users.rows.map((u) => [u.id, u.full_name]));
  return rows.map((d) => ({
    ...d,
    doctor_name: names.get(d.doctor_id) ?? null,
    uploader_name: names.get(d.uploaded_by) ?? null,
    historical: d.radiology_attachment_context === 'POST_REPORTING_HISTORICAL',
  }));
}
async function withDocumentReview(
  c: PoolClient,
  s: AuthorizationContext,
  rows: Array<Record<string, any>>,
) {
  const state = await c.query(
    `SELECT d.id,
       NOT EXISTS(SELECT 1 FROM patient_signed_documents newer
         WHERE newer.root_id=COALESCE(d.root_id,d.id) AND newer.version>d.version) AS is_latest_version,
       EXISTS(SELECT 1 FROM patient_document_events e WHERE e.document_id=d.id
         AND e.tenant_id=d.tenant_id AND e.facility_id=d.facility_id AND e.actor_id=$3
         AND e.action IN ('VIEW','DOWNLOAD') AND e.reason='Retrieve original signed document version') AS reviewed_by_actor
     FROM patient_signed_documents d WHERE d.tenant_id=$1 AND d.facility_id=$2 AND d.id=ANY($4::int[])`,
    [s.tenantId, s.facilityId, s.userId, rows.map((d) => d.id)],
  );
  const states = new Map(state.rows.map((d) => [d.id, d]));
  return (await withDoctorNames(c, s, rows)).map((d) => ({ ...d, ...states.get(d.id) }));
}
async function order(c: PoolClient, s: AuthorizationContext, id: number, patientId?: number) {
  const r = await c.query(
    'SELECT * FROM radiology_orders WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
    [id, s.tenantId, s.facilityId],
  );
  const o = r.rows[0];
  insist(
    o && (!patientId || o.patient_id === patientId),
    'DOCUMENT_NOT_FOUND',
    'Radiology request not found in this facility.',
    404,
  );
  return o;
}
async function event(
  c: PoolClient,
  s: AuthorizationContext,
  p: number,
  doc: number | null,
  action: string,
  reason: string,
  facts: Record<string, unknown> = {},
) {
  await c.query(
    'INSERT INTO patient_document_events(document_id,tenant_id,facility_id,patient_id,actor_id,action,reason,facts) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [doc, s.tenantId, s.facilityId, p, s.userId, action, reason, JSON.stringify(facts)],
  );
  await c.query(
    "INSERT INTO patient_record_access_logs(patient_id,tenant_id,facility_id,user_id,action,access_channel,record_type,record_id,purpose) VALUES($1,$2,$3,$4,$5,'STAFF_PORTAL','SIGNED_DOCUMENT',$6,'DIRECT_CARE')",
    [
      p,
      s.tenantId,
      s.facilityId,
      s.userId,
      ['VIEW', 'DOWNLOAD'].includes(action) ? action : 'UPDATE',
      doc,
    ],
  );
}
async function document(
  c: PoolClient,
  s: AuthorizationContext,
  p: number,
  id: number,
  bytes = false,
) {
  await patient(c, s, p);
  const r = await c.query(
    `SELECT ${DOCUMENT_FIELDS}${bytes ? ',original_bytes' : ''} FROM patient_signed_documents WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 AND patient_id=$4`,
    [id, s.tenantId, s.facilityId, p],
  );
  insist(r.rowCount, 'DOCUMENT_NOT_FOUND', 'Document not found.', 404);
  return r.rows[0];
}
export async function uploadPatientDocument(
  s: AuthorizationContext,
  p: number,
  meta: Record<string, unknown>,
  bytes: Buffer,
  mime: string,
): Promise<Record<string, any>> {
  requireDocumentPermission(s, 'patients.documents.upload', 'patients.documents.read');
  // The simple path records an upload, not a clinician/signature assertion.
  // Historical attachments are always simple and carry an explicit reason.
  const historicalRequested = meta.radiologyAttachmentMode === 'HISTORICAL';
  insist(
    meta.radiologyAttachmentMode === undefined || historicalRequested,
    'INVALID_METADATA',
    'Unsupported radiology attachment mode.',
  );
  const clinicalKeys = [
    'category',
    'documentType',
    'patientSignature',
    'doctorSignature',
    'doctorId',
    'signingDate',
  ];
  insist(
    !historicalRequested ||
      !clinicalKeys.some((key) => Object.prototype.hasOwnProperty.call(meta, key)),
    'INVALID_METADATA',
    'A historical supporting document is recorded without clinical assertions.',
  );
  const simple =
    historicalRequested ||
    meta.uploadMode === 'SIMPLE' ||
    !clinicalKeys.some((key) => Object.prototype.hasOwnProperty.call(meta, key));
  const filename = text(meta.filename, 180),
    title = text(meta.title, 180),
    category = simple ? 'Document' : text(meta.category, 80),
    type = simple ? 'Patient document' : text(meta.documentType, 80),
    notes = text(meta.notes, 2000, false),
    reason = historicalRequested
      ? `Historical supporting document attached after reporting: ${auditReason(meta.reason)}`.slice(
          0,
          500,
        )
      : simple
        ? meta.previousId
          ? 'Create corrected patient document version'
          : 'Upload original patient document'
        : auditReason(meta.reason);
  const sig = (v: unknown) => {
    insist(
      ['PRESENT', 'ABSENT', 'UNKNOWN'].includes(String(v)),
      'INVALID_SIGNATURE_STATUS',
      'Explicit signature status required.',
    );
    return String(v);
  };
  const patientSignature = simple ? 'UNKNOWN' : sig(meta.patientSignature),
    doctorSignature = simple ? 'UNKNOWN' : sig(meta.doctorSignature);
  const signingDate = !simple && meta.signingDate ? text(meta.signingDate, 10) : null;
  insist(
    !signingDate ||
      (/^\d{4}-\d{2}-\d{2}$/.test(signingDate) &&
        !isNaN(Date.parse(signingDate)) &&
        new Date(signingDate).toISOString().slice(0, 10) === signingDate),
    'INVALID_SIGNING_DATE',
    'Use a valid signing date.',
  );
  insist(
    (patientSignature !== 'PRESENT' && doctorSignature !== 'PRESENT') || signingDate,
    'SIGNING_DATE_REQUIRED',
    'Record the date when signatures are marked present.',
  );
  let orderId = meta.radiologyOrderId ? idOf(meta.radiologyOrderId) : null;
  await validatePatientFile(bytes, filename, mime);
  return transaction(async (c) => {
    await patient(c, s, p);
    const responsibleDoctor = simple ? null : await resolveResponsibleDoctor(c, s, meta.doctorId);
    const doctorId = responsibleDoctor?.id ?? null;
    if (meta.previousId && !orderId)
      orderId = (await document(c, s, p, idOf(meta.previousId))).radiology_order_id;
    const o = orderId ? await order(c, s, orderId, p) : null;
    insist(
      !o || !['cancelled', 'canceled'].includes(o.status?.trim().toLowerCase() ?? ''),
      'PROCEDURE_NOT_ACTIVE',
      'A cancelled request cannot receive new consent. Create an authorized new request.',
      409,
    );
    const completed = o ? radiologyRequestCompleted(o.status) : false;
    insist(
      !historicalRequested || o,
      'HISTORICAL_NOT_APPLICABLE',
      'Historical supporting documents require an imaging request.',
      400,
    );
    insist(
      !completed || historicalRequested,
      'RADIOLOGY_REQUEST_COMPLETED',
      'This request is already reported. Attach a historical supporting document instead; it cannot count as pre-procedure consent.',
      409,
    );
    insist(
      !historicalRequested || completed,
      'HISTORICAL_NOT_APPLICABLE',
      'This request is not reported. Upload a normal consent document instead.',
      409,
    );
    const attachmentContext = historicalRequested
      ? 'POST_REPORTING_HISTORICAL'
      : o
        ? 'PRE_PROCEDURE'
        : null;
    // Serialize every version in this patient/facility, including concurrent initial uploads.
    await c.query('SELECT pg_advisory_xact_lock($1,$2)', [s.facilityId, p]);
    let root: number | null = null,
      version = 1;
    let savedCategory = simple && o ? 'Radiology' : category;
    let savedType = simple && o ? 'Radiology procedure document' : type;
    if (meta.previousId) {
      const previous = await document(c, s, p, idOf(meta.previousId));
      insist(
        previous.radiology_order_id === orderId,
        'VERSION_LINK_MISMATCH',
        'A version must retain the original radiology association.',
      );
      if (simple) {
        savedCategory = previous.category;
        savedType = previous.document_type;
      }
      root = previous.root_id ?? previous.id;
      const latest = (
        await c.query(
          'SELECT max(version) AS version FROM patient_signed_documents WHERE id=$1 OR root_id=$1',
          [root],
        )
      ).rows[0];
      insist(
        Number(latest.version) === previous.version,
        'STALE_DOCUMENT_VERSION',
        'A newer version exists; reload before correcting.',
        409,
      );
      version = previous.version + 1;
    }
    const r = await c.query(
      `INSERT INTO patient_signed_documents(tenant_id,facility_id,patient_id,root_id,version,title,category,document_type,signing_date,patient_signature,doctor_signature,doctor_id,notes,filename,mime_type,sha256,original_bytes,uploaded_by,radiology_order_id,procedure_name,reason,radiology_attachment_context) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING ${DOCUMENT_FIELDS}`,
      [
        s.tenantId,
        s.facilityId,
        p,
        root,
        version,
        title,
        savedCategory,
        savedType,
        signingDate,
        patientSignature,
        doctorSignature,
        doctorId,
        notes || null,
        filename,
        mime,
        createHash('sha256').update(bytes).digest('hex'),
        bytes,
        s.userId,
        orderId,
        o?.procedure_name ?? null,
        reason,
        attachmentContext,
      ],
    );
    if (historicalRequested && o) {
      await event(c, s, p, r.rows[0].id, 'HISTORICAL_ATTACHMENT', reason, {
        orderId: o.id,
        orderStatus: o.status,
        reportedAt: o.reported_at ?? null,
        attachmentContext: 'POST_REPORTING_HISTORICAL',
        preProcedureConsentSatisfied: false,
        uploadMode: 'SIMPLE',
        previousDocumentId: meta.previousId ? idOf(meta.previousId) : null,
      });
    } else {
      await event(c, s, p, r.rows[0].id, root ? 'NEW_VERSION' : 'UPLOAD', reason, {
        responsibleDoctorId: doctorId,
        responsibleDoctorName: responsibleDoctor?.name ?? null,
        assignment: simple ? 'NOT_ASSERTED' : doctorId === s.userId ? 'SELF' : 'DELEGATED',
        uploadMode: simple ? 'SIMPLE' : 'CLINICAL_METADATA',
        previousDocumentId: meta.previousId ? idOf(meta.previousId) : null,
      });
    }
    // Preserve historical completed decisions; a new file is never substituted into them.
    // For a pending procedure invalidate verification explicitly and retain its previous snapshot.
    if (o && !completed) {
      const previousDecision = (
        await c.query('SELECT * FROM radiology_consent_decisions WHERE order_id=$1', [o.id])
      ).rows[0];
      if (previousDecision?.status !== 'EXCEPTION' && previousDecision) {
        await event(c, s, p, r.rows[0].id, 'RADIOLOGY_REVIEW_INVALIDATED', reason, {
          previousDecision,
          newDocumentId: r.rows[0].id,
        });
        await c.query(
          "UPDATE radiology_consent_decisions SET status='AWAITING_VERIFICATION',document_id=$2,decided_at=now() WHERE order_id=$1",
          [o.id, r.rows[0].id],
        );
      }
    }
    return {
      ...r.rows[0],
      doctor_name: responsibleDoctor?.name ?? null,
      historical: historicalRequested,
    };
  });
}
async function listDocuments(
  s: AuthorizationContext,
  p: number,
  filters: Record<string, unknown>,
  paginate: boolean,
) {
  requireDocumentPermission(s, 'patients.documents.read');
  const search = text(filters.search, 80, false),
    type = text(filters.type, 80, false);
  const dates = [filters.from, filters.to].map((v) => (v ? text(v, 10) : null));
  for (const d of dates)
    insist(
      !d ||
        (/^\d{4}-\d{2}-\d{2}$/.test(d) &&
          !isNaN(Date.parse(d)) &&
          new Date(d).toISOString().slice(0, 10) === d),
      'INVALID_DATE_FILTER',
      'Use ISO signing-date filters.',
    );
  insist(
    !dates[0] || !dates[1] || dates[0] <= dates[1],
    'INVALID_DATE_FILTER',
    'Signing-date range is reversed.',
  );
  // The page envelope carries the full authorized history; the plain array
  // stays for facility tooling that already reads the flat response.
  const limit = paginate ? pageLimit(filters.limit, 50, 200) : 200;
  const cursor = paginate ? decodeDocumentCursor(filters.cursor) : null;
  const scope = `d.tenant_id=$1 AND d.facility_id=$2 AND d.patient_id=$3
    AND ($4='' OR position(lower($4) in lower(d.title))>0)
    AND ($5='' OR d.document_type=$5)
    AND ($6::date IS NULL OR d.signing_date >= $6::date)
    AND ($7::date IS NULL OR d.signing_date <= $7::date)
    AND ($8::int IS NULL OR d.radiology_order_id=$8)`;
  const cursorSql = cursor ? ' AND (d.uploaded_at, d.id) < ($9::timestamptz, $10::int)' : '';
  return transaction(async (c) => {
    await patient(c, s, p);
    const requestId = filters.radiologyOrderId ? idOf(filters.radiologyOrderId) : null;
    if (requestId) await order(c, s, requestId, p);
    const values = cursor
      ? [s.tenantId, s.facilityId, p, search, type, ...dates, requestId, cursor.uploadedAt, cursor.id]
      : [s.tenantId, s.facilityId, p, search, type, ...dates, requestId];
    const r = await c.query(
      `SELECT ${DOCUMENT_FIELDS.split(',')
        .map((field) => `d.${field}`)
        .join(',')},
        rel.document_id AS portal_release_document_id,
        COALESCE(rel.released,false) AS portal_released,
        rel.released_at AS portal_released_at,
        rel.revoked_at AS portal_revoked_at,
        rel.reviewed_original AS portal_reviewed_original
       FROM patient_signed_documents d
       LEFT JOIN patient_document_releases rel ON rel.document_id=d.id
       WHERE ${scope}${cursorSql}
       ORDER BY d.uploaded_at DESC,d.id DESC LIMIT ${limit + 1}`,
      values,
    );
    const rows = r.rows.slice(0, limit);
    await event(c, s, p, null, 'VIEW', 'List patient signed document versions');
    const documents = (await withDocumentReview(c, s, rows)).map((row) => {
      const { portal_release_document_id, ...d } = row;
      return {
        ...d,
        portal_release_status: portalReleaseStatus({
          document_id: portal_release_document_id,
          released: d.portal_released,
        }),
      };
    });
    if (!paginate) return documents;
    const total = Number(
      (
        await c.query(
          `SELECT count(*)::int AS n FROM patient_signed_documents d WHERE ${scope}`,
          values.slice(0, 8),
        )
      ).rows[0].n,
    );
    const page: DocumentPageInfo = {
      limit,
      total,
      returned: documents.length,
      has_more: r.rows.length > limit,
      next_cursor: r.rows.length > limit ? encodeDocumentCursor(rows[rows.length - 1]) : null,
    };
    return { documents, page };
  });
}
/** Flat list, newest first, capped at one page of 200 versions. */
export async function listPatientDocuments(
  s: AuthorizationContext,
  p: number,
  filters: Record<string, unknown> = {},
): Promise<Record<string, any>[]> {
  return (await listDocuments(s, p, filters, false)) as Record<string, any>[];
}
/** Paged list with the explicit portal-release state for each version. */
export async function listPatientDocumentPage(
  s: AuthorizationContext,
  p: number,
  filters: Record<string, unknown> = {},
): Promise<{ documents: Record<string, any>[]; page: DocumentPageInfo }> {
  return (await listDocuments(s, p, filters, true)) as {
    documents: Record<string, any>[];
    page: DocumentPageInfo;
  };
}
export async function readPatientDocument(
  s: AuthorizationContext,
  p: number,
  id: number,
  download: boolean,
) {
  requireDocumentPermission(s, 'patients.documents.read');
  return transaction(async (c) => {
    const d = await document(c, s, p, id, true);
    await event(
      c,
      s,
      p,
      id,
      download ? 'DOWNLOAD' : 'VIEW',
      'Retrieve original signed document version',
    );
    return d;
  });
}
export async function documentHistory(s: AuthorizationContext, p: number, id: number) {
  requireDocumentPermission(s, 'patients.documents.read');
  return transaction(async (c) => {
    const d = await document(c, s, p, id);
    const root = d.root_id ?? d.id;
    const versions = (
      await c.query(
        `SELECT ${DOCUMENT_FIELDS} FROM patient_signed_documents WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 AND (id=$4 OR root_id=$4) ORDER BY version`,
        [s.tenantId, s.facilityId, p, root],
      )
    ).rows;
    const events = (
      await c.query(
        'SELECT id,document_id,actor_id,portal_account_id,action,reason,facts,created_at FROM patient_document_events WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 AND document_id=ANY($4::int[]) ORDER BY id',
        [s.tenantId, s.facilityId, p, versions.map((v) => v.id)],
      )
    ).rows;
    await event(c, s, p, id, 'VIEW', 'Read original document version and audit history');
    return { versions: await withDoctorNames(c, s, versions), events };
  });
}
/**
 * Record one explicit release decision. Uploading never releases, and a
 * release never claims a signature: the recorded signature states are copied
 * into the audit facts exactly as they were stored.
 */
async function applyPortalRelease(
  c: PoolClient,
  s: AuthorizationContext,
  p: number,
  d: Record<string, any>,
  released: boolean,
  reason: string,
  reviewedOriginal: boolean,
) {
  const consent = portalDocumentGroup(d) === 'CONSENT';
  if (released && consent && !reviewedOriginal)
    throw new PatientDocumentError(
      'CONSENT_REVIEW_REQUIRED',
      'Open and review the original consent document before releasing it to the patient portal.',
      409,
    );
  const r = await c.query(
    `INSERT INTO patient_document_releases(document_id,released,actor_id,reason,released_at,revoked_at,reviewed_original)
     VALUES($1,$2,$3,$4,CASE WHEN $2 THEN now() END,CASE WHEN $2 THEN NULL ELSE now() END,$5)
     ON CONFLICT(document_id) DO UPDATE SET
       released=excluded.released,actor_id=excluded.actor_id,reason=excluded.reason,
       released_at=CASE WHEN excluded.released THEN now() ELSE patient_document_releases.released_at END,
       revoked_at=CASE WHEN excluded.released THEN NULL ELSE now() END,
       reviewed_original=(patient_document_releases.reviewed_original OR excluded.reviewed_original),
       updated_at=now()
     RETURNING released,released_at,revoked_at,reviewed_original`,
    [d.id, released, s.userId, reason, reviewedOriginal],
  );
  const row = r.rows[0];
  await event(c, s, p, d.id, released ? 'PORTAL_RELEASE' : 'PORTAL_WITHDRAW', reason, {
    documentVersion: d.version,
    documentGroup: portalDocumentGroup(d),
    consentDocument: consent,
    consentReviewed: consent ? reviewedOriginal : false,
    // Recorded, not verified: these are the stored states, nothing more.
    recordedPatientSignature: d.patient_signature,
    recordedDoctorSignature: d.doctor_signature,
    recordedSigningDate: d.signing_date,
  });
  return {
    document_id: d.id,
    released,
    portal_release_status: (released ? 'RELEASED' : 'REVOKED') as PortalReleaseStatus,
    released_at: row.released_at,
    revoked_at: row.revoked_at,
    reviewed_original: row.reviewed_original === true,
    consent_document: consent,
  };
}
export async function releasePatientDocument(
  s: AuthorizationContext,
  p: number,
  id: number,
  released: unknown,
  why: unknown,
  reviewedOriginal: unknown = false,
) {
  requireDocumentPermission(s, 'patients.documents.release', 'patients.documents.read');
  insist(typeof released === 'boolean', 'INVALID_RELEASE', 'Specify release or withdrawal.');
  insist(
    reviewedOriginal === undefined || typeof reviewedOriginal === 'boolean',
    'INVALID_RELEASE',
    'Specify whether the original was reviewed.',
  );
  const reason = auditReason(why);
  return transaction(async (c) => {
    const d = await document(c, s, p, id);
    return applyPortalRelease(c, s, p, d, released, reason, reviewedOriginal === true);
  });
}
/** Release or withdraw a staff selection in one authorized transaction. */
export async function releasePatientDocuments(
  s: AuthorizationContext,
  p: number,
  ids: unknown,
  released: unknown,
  why: unknown,
  reviewedOriginal: unknown = false,
) {
  requireDocumentPermission(s, 'patients.documents.release', 'patients.documents.read');
  insist(Array.isArray(ids), 'INVALID_RELEASE', 'Select the documents to release.');
  const documentIds = [...new Set(ids.map((id) => idOf(id)))];
  insist(
    documentIds.length >= 1 && documentIds.length <= 50,
    'INVALID_RELEASE',
    'Select between one and fifty documents.',
  );
  insist(typeof released === 'boolean', 'INVALID_RELEASE', 'Specify release or withdrawal.');
  insist(
    reviewedOriginal === undefined || typeof reviewedOriginal === 'boolean',
    'INVALID_RELEASE',
    'Specify whether the originals were reviewed.',
  );
  const reason = auditReason(why);
  return transaction(async (c) => {
    await patient(c, s, p);
    const rows = [];
    for (const id of documentIds) {
      const d = await document(c, s, p, id);
      rows.push(await applyPortalRelease(c, s, p, d, released, reason, reviewedOriginal === true));
    }
    return { released, documents: rows };
  });
}

export async function radiologyConsent(s: AuthorizationContext, id: number) {
  requireDocumentPermission(s, 'patients.documents.read');
  return transaction(async (c) => {
    const o = await order(c, s, id);
    const policy = (
      await c.query(
        'SELECT required,allow_exception FROM radiology_consent_policies WHERE facility_id=$1 AND tenant_id=$2',
        [s.facilityId, s.tenantId],
      )
    ).rows[0] ?? { required: true, allow_exception: false };
    const decision =
      (
        await c.query(
          'SELECT * FROM radiology_consent_decisions WHERE order_id=$1 AND tenant_id=$2 AND facility_id=$3',
          [id, s.tenantId, s.facilityId],
        )
      ).rows[0] ?? null;
    const documents = await withDocumentReview(
      c,
      s,
      (
        await c.query(
          `SELECT ${DOCUMENT_FIELDS} FROM patient_signed_documents WHERE radiology_order_id=$1 AND tenant_id=$2 AND facility_id=$3 AND patient_id=$4 ORDER BY id DESC`,
          [id, s.tenantId, s.facilityId, o.patient_id],
        )
      ).rows,
    );
    const currentDoctor =
      (
        await c.query(
          `SELECT u.id,u.full_name AS name FROM users u JOIN user_roles ur ON ur.user_id=u.id
           JOIN roles r ON r.id=ur.role_id WHERE ${activeDoctor} AND u.id=$3 LIMIT 1`,
          [s.tenantId, s.facilityId, s.userId],
        )
      ).rows[0] ?? null;
    // Non-doctors may identify who should review, but cannot attest for that doctor.
    const reviewDoctors = currentDoctor
      ? []
      : (
          await c.query(
            `SELECT DISTINCT u.id,u.full_name AS name,u.designation FROM users u
             JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
             WHERE ${activeDoctor} ORDER BY u.full_name,u.id LIMIT 50`,
            [s.tenantId, s.facilityId],
          )
        ).rows;
    await event(c, s, o.patient_id, null, 'VIEW', 'Read procedure-specific consent status');
    const decisionDocument = decision
      ? documents.find((d: any) => d.id === decision.document_id)
      : null;
    const verifiedDocumentCurrent = Boolean(
      decision?.status === 'VERIFIED' &&
      decisionDocument &&
      decision.clinician_id === decision.decided_by &&
      decisionDocument.procedure_name === o.procedure_name &&
      decisionDocument.radiology_attachment_context !== 'POST_REPORTING_HISTORICAL' &&
      decisionDocument.is_latest_version !== false,
    );
    const cancelled = ['cancelled', 'canceled'].includes(o.status?.trim().toLowerCase() ?? '');
    const completed = radiologyRequestCompleted(o.status);
    const status = cancelled
      ? 'PROCEDURE_CANCELLED'
      : verifiedDocumentCurrent
        ? 'VERIFIED'
        : decision?.status === 'REJECTED'
          ? 'REJECTED'
          : decision?.status === 'EXCEPTION'
            ? policy.allow_exception
              ? 'EXCEPTION'
              : completed
                ? 'COMPLETED_UNVERIFIED'
                : 'CONSENT_REQUIRED'
            : completed
              ? 'COMPLETED_UNVERIFIED'
              : documents.length
                ? 'AWAITING_VERIFICATION'
                : policy.required
                  ? 'CONSENT_REQUIRED'
                  : 'NOT_REQUIRED';
    return {
      policy,
      decision,
      documents,
      currentDoctor,
      viewerIsDoctor: Boolean(currentDoctor),
      reviewDoctors,
      request: {
        id: o.id,
        patientId: o.patient_id,
        procedureName: o.procedure_name,
        status: o.status,
        reportedAt: o.reported_at ?? null,
        completed,
      },
      status,
    };
  });
}
export async function radiologyConsentPolicy(s: AuthorizationContext) {
  requireDocumentPermission(s, 'radiology.consent.policy');
  const row = (
    await pool.query(
      'SELECT required,allow_exception FROM radiology_consent_policies WHERE facility_id=$1 AND tenant_id=$2',
      [s.facilityId, s.tenantId],
    )
  ).rows[0];
  return { required: row?.required ?? true, allowException: row?.allow_exception ?? false };
}
export async function decideRadiologyConsent(
  s: AuthorizationContext,
  id: number,
  input: Record<string, unknown>,
) {
  const status = input.status,
    exception = status === 'EXCEPTION',
    rejection = status === 'REJECTED';
  insist(
    exception || status === 'VERIFIED' || rejection,
    'INVALID_CONSENT_STATUS',
    'Select verified, rejected or authorized exception.',
  );
  requireDocumentPermission(
    s,
    'patients.documents.read',
    exception ? 'radiology.consent.exception' : 'radiology.consent.verify',
  );
  const clinicianId = idOf(input.clinicianId ?? s.userId);
  // Verification is a personal clinical attestation. An administrator or
  // colleague must never record it on the doctor's behalf.
  insist(
    clinicianId === s.userId,
    'SELF_VERIFICATION_REQUIRED',
    'The doctor must record their own decision while signed in; another account cannot attest on their behalf.',
    403,
  );
  const providedReason =
    input.reason === undefined || input.reason === null || String(input.reason).trim() === ''
      ? null
      : auditReason(input.reason);
  insist(
    !rejection || providedReason,
    'REASON_REQUIRED',
    'Explain why the consent was not accepted.',
  );
  const reason =
    providedReason ??
    `Doctor reviewed the original consent document and confirmed the recorded consent information for request #${id}.`;
  return transaction(async (c) => {
    const o = await order(c, s, id);
    await clinician(c, s, clinicianId);
    insist(
      !['cancelled', 'canceled'].includes(o.status?.trim().toLowerCase() ?? ''),
      'PROCEDURE_NOT_ACTIVE',
      'Do not authorize a cancelled procedure. Create an authorized new request.',
      409,
    );
    insist(
      !radiologyRequestCompleted(o.status),
      'PROCEDURE_ALREADY_COMPLETED',
      'Do not alter consent decisions after procedure completion. Attach historical support instead.',
      409,
    );
    let docId: number | null = null;
    let reviewedDocument: Record<string, any> | null = null;
    if (exception) {
      const policy = (
        await c.query(
          'SELECT allow_exception FROM radiology_consent_policies WHERE tenant_id=$1 AND facility_id=$2',
          [s.tenantId, s.facilityId],
        )
      ).rows[0];
      insist(
        policy?.allow_exception,
        'EXCEPTION_NOT_PERMITTED',
        'Facility policy does not permit an exception.',
        403,
      );
    } else {
      docId = idOf(input.documentId);
      const d = await document(c, s, o.patient_id, docId);
      insist(
        d.radiology_order_id === id &&
          d.procedure_name === o.procedure_name &&
          d.radiology_attachment_context !== 'POST_REPORTING_HISTORICAL',
        'CONSENT_INCOMPLETE',
        'Use this procedure’s pre-procedure consent document. Historical attachments cannot satisfy consent.',
      );
      const newer = await c.query(
        'SELECT id FROM patient_signed_documents WHERE root_id=$1 AND version>$2',
        [d.root_id ?? d.id, d.version],
      );
      insist(
        !newer.rowCount,
        'STALE_DOCUMENT_VERSION',
        'Verify the latest corrected document version.',
        409,
      );
      const reviewed = (await withDocumentReview(c, s, [d]))[0];
      insist(
        reviewed.reviewed_by_actor,
        'CONSENT_REVIEW_REQUIRED',
        'Preview or download this original consent document before recording your decision.',
        409,
      );
      reviewedDocument = reviewed;
    }
    await c.query(
      'INSERT INTO radiology_consent_decisions(order_id,tenant_id,facility_id,patient_id,document_id,status,clinician_id,reason,decided_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(order_id) DO UPDATE SET document_id=excluded.document_id,status=excluded.status,clinician_id=excluded.clinician_id,reason=excluded.reason,decided_by=excluded.decided_by,decided_at=now()',
      [id, s.tenantId, s.facilityId, o.patient_id, docId, status, clinicianId, reason, s.userId],
    );
    await event(
      c,
      s,
      o.patient_id,
      docId,
      exception ? 'RADIOLOGY_EXCEPTION' : rejection ? 'RADIOLOGY_REJECTED' : 'RADIOLOGY_VERIFIED',
      reason,
      {
        orderId: id,
        documentId: docId,
        clinicianId,
        status,
        reviewedOriginal: !exception,
        signatureAssertions: reviewedDocument
          ? {
              patient: reviewedDocument.patient_signature,
              doctor: reviewedDocument.doctor_signature,
              signingDate: reviewedDocument.signing_date,
            }
          : null,
      },
    );
    return { status };
  });
}
export async function setRadiologyConsentPolicy(
  s: AuthorizationContext,
  input: Record<string, unknown>,
) {
  requireDocumentPermission(s, 'radiology.consent.policy');
  insist(
    typeof input.required === 'boolean' && typeof input.allowException === 'boolean',
    'INVALID_POLICY',
    'Specify consent requirement and exception policy.',
  );
  const reason = auditReason(input.reason);
  return transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1,0)', [s.facilityId]);
    const previous = (
      await c.query(
        'SELECT required,allow_exception FROM radiology_consent_policies WHERE tenant_id=$1 AND facility_id=$2',
        [s.tenantId, s.facilityId],
      )
    ).rows[0] ?? { required: true, allow_exception: false };
    await c.query(
      'INSERT INTO radiology_consent_policies(tenant_id,facility_id,required,allow_exception,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(facility_id) DO UPDATE SET required=excluded.required,allow_exception=excluded.allow_exception,updated_by=excluded.updated_by,updated_at=now()',
      [s.tenantId, s.facilityId, input.required, input.allowException, s.userId],
    );
    await c.query(
      "INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details) VALUES($1,$2,$3,'UPDATE','RadiologyConsentPolicy',$4,$5)",
      [
        s.tenantId,
        s.facilityId,
        String(s.userId),
        String(s.facilityId),
        JSON.stringify({
          reason,
          previous,
          next: { required: input.required, allow_exception: input.allowException },
        }),
      ],
    );
    return { required: input.required, allowException: input.allowException };
  });
}

/**
 * Portal projection intentionally excludes staff notes, uploader/doctor
 * identities, hashes, release reasons and internal audit. A patient only ever
 * reads their own explicitly released versions inside their own facility.
 */
function portalScope(s: PortalSession) {
  insist(
    s.facilityId,
    'PORTAL_FACILITY_REQUIRED',
    'Your portal account is not linked to a facility yet. Ask the facility to finish your portal setup.',
    409,
  );
  return s.facilityId as number;
}
function portalItem(row: Record<string, any>) {
  const group = portalDocumentGroup(row);
  return {
    id: row.id,
    title: row.title,
    group,
    group_label: PORTAL_GROUP_LABELS[group],
    kind: portalDocumentKind(row),
    document_type: row.document_type,
    category: row.category,
    signing_date: row.signing_date,
    uploaded_at: row.uploaded_at,
    version: row.version,
    is_superseded: row.is_superseded === true,
    has_versions: row.has_versions === true,
    mime_type: row.mime_type,
    source: portalDocumentSource(row),
    procedure_name: row.procedure_name ?? null,
  };
}
const portalVersionSql = `EXISTS(SELECT 1 FROM patient_signed_documents newer
   WHERE newer.root_id=COALESCE(d.root_id,d.id) AND newer.version>d.version) AS is_superseded,
 EXISTS(SELECT 1 FROM patient_signed_documents sibling
   JOIN patient_document_releases sr ON sr.document_id=sibling.id AND sr.released=true
   WHERE sibling.root_id=COALESCE(d.root_id,d.id) AND sibling.version<>d.version) AS has_versions`;
async function portalAudit(
  c: PoolClient,
  s: PortalSession,
  id: number | null,
  download: boolean,
  reason: string,
) {
  await c.query(
    'INSERT INTO patient_document_events(document_id,tenant_id,facility_id,patient_id,portal_account_id,action,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      id,
      s.tenantId,
      s.facilityId,
      s.patientId,
      s.accountId,
      download ? 'PORTAL_DOWNLOAD' : 'PORTAL_VIEW',
      reason,
    ],
  );
  await c.query(
    "INSERT INTO patient_record_access_logs(patient_id,tenant_id,facility_id,user_id,action,access_channel,record_type,record_id,purpose) VALUES($1,$2,$3,NULL,$4,'PATIENT_PORTAL','SIGNED_DOCUMENT',$5,'PATIENT_REQUEST')",
    [s.patientId, s.tenantId, s.facilityId, download ? 'DOWNLOAD' : 'VIEW', id],
  );
}
/**
 * One server-side page of the authenticated patient's released documents.
 * Search, category and date filters run in SQL over the whole authorized set,
 * so an older release can never fall outside a fixed 200-row window.
 */
export async function portalDocumentPage(s: PortalSession, query: Record<string, unknown> = {}) {
  const facilityId = portalScope(s);
  const policy = await loadPortalPolicy(facilityId);
  const search = text(query.search, 80, false);
  const group = String(query.group ?? 'ALL').toUpperCase();
  insist(
    ['ALL', 'CONSENT', 'CLINICAL', 'OTHER'].includes(group),
    'INVALID_FILTER',
    'Choose a document category.',
  );
  const dates = [query.from, query.to].map((v) => (v ? text(v, 10) : null));
  for (const d of dates)
    insist(
      !d ||
        (/^\d{4}-\d{2}-\d{2}$/.test(d) &&
          !isNaN(Date.parse(d)) &&
          new Date(d).toISOString().slice(0, 10) === d),
      'INVALID_DATE_FILTER',
      'Use ISO upload-date filters.',
    );
  insist(
    !dates[0] || !dates[1] || dates[0] <= dates[1],
    'INVALID_DATE_FILTER',
    'Upload-date range is reversed.',
  );
  const limit = pageLimit(query.limit, 50, 100);
  const cursor = decodeDocumentCursor(query.cursor);
  const filtered = Boolean(search || dates[0] || dates[1] || group !== 'ALL');
  const scope = `d.tenant_id=$1 AND d.facility_id=$2 AND d.patient_id=$3 AND r.released=true
    AND ($4='' OR position(lower($4) in lower(d.title))>0 OR position(lower($4) in lower(d.document_type))>0)
    AND ($5::date IS NULL OR d.uploaded_at >= $5::date)
    AND ($6::date IS NULL OR d.uploaded_at < ($6::date + interval '1 day'))`;
  return transaction(async (c) => {
    const base = [s.tenantId, facilityId, s.patientId, search, dates[0], dates[1]];
    const groupSql = group === 'ALL' ? '' : ` AND ${PORTAL_GROUP_SQL} = $7`;
    const values = group === 'ALL' ? base : [...base, group];
    const cursorSql = cursor
      ? ` AND (d.uploaded_at, d.id) < ($${values.length + 1}::timestamptz, $${values.length + 2}::int)`
      : '';
    const rows = await c.query(
      `SELECT ${PORTAL_DOCUMENT_FIELDS},${portalVersionSql}
       FROM patient_signed_documents d
       JOIN patient_document_releases r ON r.document_id=d.id AND r.released=true
       WHERE ${scope}${groupSql}${cursorSql}
       ORDER BY d.uploaded_at DESC,d.id DESC LIMIT ${limit + 1}`,
      cursor ? [...values, cursor.uploadedAt, cursor.id] : values,
    );
    const pageRows = rows.rows.slice(0, limit);
    const total = Number(
      (
        await c.query(
          `SELECT count(*)::int AS n FROM patient_signed_documents d
           JOIN patient_document_releases r ON r.document_id=d.id AND r.released=true
           WHERE ${scope}${groupSql}`,
          values,
        )
      ).rows[0].n,
    );
    const groupRows = (
      await c.query(
        `SELECT ${PORTAL_GROUP_SQL} AS portal_group,count(*)::int AS n
         FROM patient_signed_documents d
         JOIN patient_document_releases r ON r.document_id=d.id AND r.released=true
         WHERE ${scope}
         GROUP BY 1`,
        base,
      )
    ).rows;
    const groups: Record<string, number> = { ALL: 0, CONSENT: 0, CLINICAL: 0, OTHER: 0 };
    for (const row of groupRows) {
      groups[row.portal_group] = Number(row.n);
      groups.ALL += Number(row.n);
    }
    let emptyState: 'NONE_RELEASED' | 'AWAITING_RELEASE' | 'NO_MATCHES' | null = null;
    if (total === 0) {
      if (filtered) emptyState = 'NO_MATCHES';
      else {
        const awaiting = await c.query(
          `SELECT EXISTS(SELECT 1 FROM patient_signed_documents d
             LEFT JOIN patient_document_releases r ON r.document_id=d.id
             WHERE d.tenant_id=$1 AND d.facility_id=$2 AND d.patient_id=$3
               AND COALESCE(r.released,false)=false) AS awaiting`,
          [s.tenantId, facilityId, s.patientId],
        );
        emptyState = awaiting.rows[0].awaiting ? 'AWAITING_RELEASE' : 'NONE_RELEASED';
      }
    }
    await portalAudit(c, s, null, false, 'Patient viewed their released documents');
    return {
      documents: pageRows.map(portalItem),
      page: {
        limit,
        total,
        returned: pageRows.length,
        has_more: rows.rowCount! > limit,
        next_cursor:
          rows.rowCount! > limit ? encodeDocumentCursor(pageRows[pageRows.length - 1]) : null,
      } satisfies DocumentPageInfo,
      groups,
      empty_state: emptyState,
      filters: { search, group, from: dates[0], to: dates[1] },
      downloads_enabled: policy.allowDownloads,
    };
  });
}
/** Details of one released document plus the other released versions of it. */
export async function portalDocumentDetail(s: PortalSession, id: number) {
  const facilityId = portalScope(s);
  return transaction(async (c) => {
    const found = await c.query(
      `SELECT ${PORTAL_DOCUMENT_FIELDS},${portalVersionSql}
       FROM patient_signed_documents d
       JOIN patient_document_releases r ON r.document_id=d.id AND r.released=true
       WHERE d.tenant_id=$1 AND d.facility_id=$2 AND d.patient_id=$3 AND d.id=$4`,
      [s.tenantId, facilityId, s.patientId, id],
    );
    insist(found.rowCount, 'DOCUMENT_NOT_FOUND', 'Document not found.', 404);
    const target = found.rows[0];
    const versions = await c.query(
      `SELECT ${PORTAL_DOCUMENT_FIELDS},${portalVersionSql}
       FROM patient_signed_documents d
       JOIN patient_document_releases r ON r.document_id=d.id AND r.released=true
       WHERE d.tenant_id=$1 AND d.facility_id=$2 AND d.patient_id=$3
         AND COALESCE(d.root_id,d.id)=$4
       ORDER BY d.version`,
      [s.tenantId, facilityId, s.patientId, target.root_id ?? target.id],
    );
    await portalAudit(c, s, id, false, 'Patient viewed a released document and its versions');
    return {
      document: portalItem(target),
      versions: versions.rows.map((row) => {
        const item = portalItem(row);
        return {
          id: item.id,
          version: item.version,
          title: item.title,
          uploaded_at: item.uploaded_at,
          signing_date: item.signing_date,
          is_superseded: item.is_superseded,
          current: item.id === target.id,
        };
      }),
    };
  });
}
/** Released versions of the same document, newest last. */
export async function portalDocumentHistory(s: PortalSession, id: number) {
  const detail = await portalDocumentDetail(s, id);
  return {
    document_id: detail.document.id,
    versions: detail.versions.map(({ current, ...version }) => version),
  };
}
export async function portalPatientDocuments(s: PortalSession, id?: number, download = false) {
  const facilityId = portalScope(s);
  const policy = await loadPortalPolicy(facilityId);
  insist(
    !download || policy.allowDownloads,
    'DOWNLOAD_DISABLED',
    'The facility has disabled portal downloads.',
    403,
  );
  insist(
    Number.isSafeInteger(id) && Number(id) > 0,
    'INVALID_ID',
    'A positive identifier is required.',
  );
  return transaction(async (c) => {
    const result = await c.query(
      `SELECT ${PORTAL_DOCUMENT_FIELDS},d.original_bytes,d.filename
       FROM patient_signed_documents d
       JOIN patient_document_releases r ON r.document_id=d.id AND r.released=true
       WHERE d.tenant_id=$1 AND d.facility_id=$2 AND d.patient_id=$3 AND d.id=$4`,
      [s.tenantId, facilityId, s.patientId, id],
    );
    insist(result.rowCount, 'DOCUMENT_NOT_FOUND', 'Document not found.', 404);
    await portalAudit(
      c,
      s,
      Number(id),
      download,
      download
        ? 'Patient downloaded their released original document'
        : 'Patient accessed their released original document',
    );
    return result.rows[0];
  });
}
