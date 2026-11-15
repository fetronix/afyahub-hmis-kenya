import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { hasAllPermissions } from '../auth/authorization.service.ts';
import type { PortalSession } from '../portal/portal-auth.service.ts';
import { loadPortalPolicy } from '../portal/portal.service.ts';
import { insist, validatePatientFile } from './patient-file-validation.ts';

export const DOCUMENT_FIELDS =
  'id,patient_id,root_id,version,title,category,document_type,signing_date,patient_signature,doctor_signature,doctor_id,notes,filename,mime_type,sha256,uploaded_by,uploaded_at,radiology_order_id,procedure_name,reason';
export const PORTAL_DOCUMENT_FIELDS =
  'd.id,d.title,d.category,d.document_type,d.signing_date,d.uploaded_at,d.mime_type,d.version';
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
  const s = text(v, 500);
  insist(s.length >= 10, 'REASON_REQUIRED', 'Explain the operation in 10–500 characters.');
  return s;
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
  // Retain the explicit clinical metadata path for authorized review/version workflows.
  const simple =
    meta.uploadMode === 'SIMPLE' ||
    ![
      'category',
      'documentType',
      'patientSignature',
      'doctorSignature',
      'doctorId',
      'signingDate',
    ].some((key) => Object.prototype.hasOwnProperty.call(meta, key));
  const filename = text(meta.filename, 180),
    title = text(meta.title, 180),
    category = simple ? 'Document' : text(meta.category, 80),
    type = simple ? 'Patient document' : text(meta.documentType, 80),
    notes = text(meta.notes, 2000, false),
    reason = simple
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
      `INSERT INTO patient_signed_documents(tenant_id,facility_id,patient_id,root_id,version,title,category,document_type,signing_date,patient_signature,doctor_signature,doctor_id,notes,filename,mime_type,sha256,original_bytes,uploaded_by,radiology_order_id,procedure_name,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING ${DOCUMENT_FIELDS}`,
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
      ],
    );
    await event(c, s, p, r.rows[0].id, root ? 'NEW_VERSION' : 'UPLOAD', reason, {
      responsibleDoctorId: doctorId,
      responsibleDoctorName: responsibleDoctor?.name ?? null,
      assignment: simple ? 'NOT_ASSERTED' : doctorId === s.userId ? 'SELF' : 'DELEGATED',
      uploadMode: simple ? 'SIMPLE' : 'CLINICAL_METADATA',
      previousDocumentId: meta.previousId ? idOf(meta.previousId) : null,
    });
    // Preserve historical completed decisions; a new file is never substituted into them.
    // For a pending procedure invalidate verification explicitly and retain its previous snapshot.
    if (o && !['Reported', 'Performed', 'Completed'].includes(o.status)) {
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
    return { ...r.rows[0], doctor_name: responsibleDoctor?.name ?? null };
  });
}
export async function listPatientDocuments(
  s: AuthorizationContext,
  p: number,
  filters: Record<string, unknown> = {},
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
  return transaction(async (c) => {
    await patient(c, s, p);
    const requestId = filters.radiologyOrderId ? idOf(filters.radiologyOrderId) : null;
    if (requestId) await order(c, s, requestId, p);
    const r = await c.query(
      `SELECT ${DOCUMENT_FIELDS},COALESCE((SELECT released FROM patient_document_releases rel WHERE rel.document_id=d.id),false) AS portal_released FROM patient_signed_documents d WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 AND ($4='' OR position(lower($4) in lower(title))>0) AND ($5='' OR document_type=$5) AND ($6::date IS NULL OR signing_date >= $6::date) AND ($7::date IS NULL OR signing_date <= $7::date) AND ($8::int IS NULL OR radiology_order_id=$8) ORDER BY uploaded_at DESC,id DESC LIMIT 200`,
      [s.tenantId, s.facilityId, p, search, type, ...dates, requestId],
    );
    await event(c, s, p, null, 'VIEW', 'List patient signed document versions');
    return withDocumentReview(c, s, r.rows);
  });
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
export async function releasePatientDocument(
  s: AuthorizationContext,
  p: number,
  id: number,
  released: unknown,
  why: unknown,
) {
  requireDocumentPermission(s, 'patients.documents.release', 'patients.documents.read');
  insist(typeof released === 'boolean', 'INVALID_RELEASE', 'Specify release or withdrawal.');
  const reason = auditReason(why);
  return transaction(async (c) => {
    await document(c, s, p, id);
    await c.query(
      'INSERT INTO patient_document_releases(document_id,released,actor_id) VALUES($1,$2,$3) ON CONFLICT(document_id) DO UPDATE SET released=excluded.released,actor_id=excluded.actor_id,updated_at=now()',
      [id, released, s.userId],
    );
    await event(c, s, p, id, released ? 'PORTAL_RELEASE' : 'PORTAL_WITHDRAW', reason);
    return { released };
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
    const docs = (
      await c.query(
        `SELECT ${DOCUMENT_FIELDS} FROM patient_signed_documents WHERE radiology_order_id=$1 AND tenant_id=$2 AND facility_id=$3 AND patient_id=$4 ORDER BY id DESC`,
        [id, s.tenantId, s.facilityId, o.patient_id],
      )
    ).rows;
    await event(c, s, o.patient_id, null, 'VIEW', 'Read procedure-specific consent status');
    return {
      policy,
      decision,
      documents: await withDocumentReview(c, s, docs),
      request: {
        id: o.id,
        patientId: o.patient_id,
        procedureName: o.procedure_name,
        status: o.status,
      },
      currentDoctor:
        (
          await c.query(
            `SELECT u.id,u.full_name AS name FROM users u JOIN user_roles ur ON ur.user_id=u.id
         JOIN roles r ON r.id=ur.role_id WHERE ${activeDoctor} AND u.id=$3 LIMIT 1`,
            [s.tenantId, s.facilityId, s.userId],
          )
        ).rows[0] ?? null,
      status: ['cancelled', 'canceled'].includes(o.status?.trim().toLowerCase() ?? '')
        ? 'PROCEDURE_CANCELLED'
        : ((decision?.status === 'VERIFIED' &&
          !docs.some((d) => d.id === decision.document_id && d.procedure_name === o.procedure_name)
            ? 'AWAITING_VERIFICATION'
            : decision?.status === 'EXCEPTION' && !policy.allow_exception
              ? 'CONSENT_REQUIRED'
              : decision?.status) ??
          (docs.length
            ? 'AWAITING_VERIFICATION'
            : policy.required
              ? 'CONSENT_REQUIRED'
              : 'NOT_REQUIRED')),
    };
  });
}
export async function decideRadiologyConsent(
  s: AuthorizationContext,
  id: number,
  input: Record<string, unknown>,
) {
  const exception = input.status === 'EXCEPTION';
  requireDocumentPermission(
    s,
    'patients.documents.read',
    exception ? 'radiology.consent.exception' : 'radiology.consent.verify',
  );
  insist(
    exception || input.status === 'VERIFIED',
    'INVALID_CONSENT_STATUS',
    'Select verified or authorized exception.',
  );
  const reason = auditReason(input.reason),
    clinicianId = idOf(input.clinicianId);
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
      !['reported', 'performed', 'completed'].includes(o.status?.trim().toLowerCase() ?? ''),
      'PROCEDURE_ALREADY_COMPLETED',
      'Do not alter consent decisions after procedure completion.',
      409,
    );
    let docId: number | null = null;
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
      insist(
        clinicianId === s.userId,
        'AUTHORIZING_CLINICIAN_REQUIRED',
        'The authorized clinician must record their own exception.',
        403,
      );
    } else {
      docId = idOf(input.documentId);
      const d = await document(c, s, o.patient_id, docId);
      insist(
        d.radiology_order_id === id &&
          d.procedure_name === o.procedure_name &&
          d.patient_signature === 'PRESENT' &&
          d.doctor_signature === 'PRESENT' &&
          d.doctor_id === clinicianId &&
          d.signing_date,
        'CONSENT_INCOMPLETE',
        'Use this procedure’s signed document with patient and responsible doctor signatures and signing date.',
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
        'Preview or download this original signed version before verifying its signature assertions.',
        409,
      );
    }
    await c.query(
      'INSERT INTO radiology_consent_decisions(order_id,tenant_id,facility_id,patient_id,document_id,status,clinician_id,reason,decided_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(order_id) DO UPDATE SET document_id=excluded.document_id,status=excluded.status,clinician_id=excluded.clinician_id,reason=excluded.reason,decided_by=excluded.decided_by,decided_at=now()',
      [
        id,
        s.tenantId,
        s.facilityId,
        o.patient_id,
        docId,
        input.status,
        clinicianId,
        reason,
        s.userId,
      ],
    );
    await event(
      c,
      s,
      o.patient_id,
      docId,
      exception ? 'RADIOLOGY_EXCEPTION' : 'RADIOLOGY_VERIFIED',
      reason,
      { orderId: id, documentId: docId, clinicianId, status: input.status },
    );
    return { status: input.status };
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

/** Portal projection intentionally excludes staff notes, identifiers, hashes and internal audit. */
export async function portalPatientDocuments(s: PortalSession, id?: number, download = false) {
  insist(s.facilityId, 'DOCUMENT_NOT_FOUND', 'Document not found.', 404);
  const policy = await loadPortalPolicy(s.facilityId);
  insist(
    !download || policy.allowDownloads,
    'DOWNLOAD_DISABLED',
    'The facility has disabled portal downloads.',
    403,
  );
  return transaction(async (c) => {
    const result = await c.query(
      `SELECT ${PORTAL_DOCUMENT_FIELDS}${id ? ',d.original_bytes,d.filename' : ''} FROM patient_signed_documents d JOIN patient_document_releases r ON r.document_id=d.id AND r.released=true WHERE d.tenant_id=$1 AND d.facility_id=$2 AND d.patient_id=$3 ${id ? 'AND d.id=$4' : ''} ORDER BY d.uploaded_at DESC LIMIT 200`,
      id ? [s.tenantId, s.facilityId, s.patientId, id] : [s.tenantId, s.facilityId, s.patientId],
    );
    if (id) insist(result.rowCount, 'DOCUMENT_NOT_FOUND', 'Document not found.', 404);
    await c.query(
      "INSERT INTO patient_document_events(document_id,tenant_id,facility_id,patient_id,portal_account_id,action,reason) VALUES($1,$2,$3,$4,$5,$6,'Patient accessed explicitly released own document')",
      [
        id ?? null,
        s.tenantId,
        s.facilityId,
        s.patientId,
        s.accountId,
        download ? 'PORTAL_DOWNLOAD' : 'PORTAL_VIEW',
      ],
    );
    await c.query(
      "INSERT INTO patient_record_access_logs(patient_id,tenant_id,facility_id,user_id,action,access_channel,record_type,record_id,purpose) VALUES($1,$2,$3,NULL,$4,'PATIENT_PORTAL','SIGNED_DOCUMENT',$5,'PATIENT_REQUEST')",
      [s.patientId, s.tenantId, s.facilityId, download ? 'DOWNLOAD' : 'VIEW', id ?? null],
    );
    return id ? result.rows[0] : result.rows;
  });
}
