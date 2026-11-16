import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { describeDb } from '../vitest/support/db.ts';
import { pool } from '../../db/index.ts';
import { createApp } from '../../app.ts';
import { startTestServer } from './support/http-harness.ts';
import { createResponsibleDoctorFixture } from './support/responsible-doctor.fixture.ts';
import { hashPassword } from '../../utils/password.ts';

/**
 * Portal document visibility, over the real mounted HTTP stack and the
 * disposable synthetic database: release, revoke, ownership, categories,
 * pagination and the privacy projection.
 */
describeDb('Patient portal released documents — attested disposable DB and real HTTP', () => {
  let f: Awaited<ReturnType<typeof createResponsibleDoctorFixture>>,
    server: Awaited<ReturnType<typeof startTestServer>>,
    pdf: Buffer,
    patient: number,
    otherPatient: number,
    order: number,
    portalToken: string,
    password: string,
    identifiers: { general: number; consent: number; radiology: number; hidden: number },
    session: { accountId: number; patientId: number; tenantId: number; facilityId: number };
  beforeAll(async () => {
    f = await createResponsibleDoctorFixture();
    const doc = await PDFDocument.create();
    doc.addPage().drawText('Synthetic released document', { x: 40, y: 750, size: 12 });
    pdf = Buffer.from(await doc.save());
    patient = f.patient;
    otherPatient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Portal Other','1992-02-02','Other') RETURNING id",
        [f.tenant, f.facility, 'PORTAL-B-' + f.tenant],
      )
    ).rows[0].id as number;
    order = (
      await pool.query(
        "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name) VALUES($1,$2,$3,'XR','Synthetic Chest X-Ray PA View') RETURNING id",
        [f.tenant, f.facility, patient],
      )
    ).rows[0].id as number;
    password = 'Synthetic-portal-matrix-only!7';
    const login = `portal-matrix-${f.tenant}@example.test`;
    const account = (
      await pool.query(
        "INSERT INTO patient_portal_accounts(tenant_id,facility_id,patient_id,login_identifier,login_type,password_hash,status,activated_at) VALUES($1,$2,$3,$4,'EMAIL',$5,'ACTIVE',now()) RETURNING id",
        [f.tenant, f.facility, patient, login, await hashPassword(password)],
      )
    ).rows[0].id as number;
    session = {
      accountId: account,
      patientId: patient,
      tenantId: f.tenant,
      facilityId: f.facility,
    };
    server = await startTestServer(await createApp());
    const loginResponse = await fetch(`${server.baseUrl}/api/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: login, password }),
    });
    expect(loginResponse.status).toBe(200);
    portalToken = ((await loginResponse.json()) as { sessionToken: string }).sessionToken;
  });
  afterAll(async () => {
    await server?.close();
  });
  async function upload(title: string, meta: Record<string, unknown> = {}) {
    const r = await fetch(`${server.baseUrl}/api/patient-documents/patients/${patient}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${f.staff.token}`,
        'Content-Type': 'application/pdf',
        'X-Document-Metadata': encodeURIComponent(
          JSON.stringify({
            filename: `${title.replaceAll(' ', '-').toLowerCase()}.pdf`,
            title,
            notes: 'PRIVATE STAFF NOTE — never portal visible',
            uploadMode: 'SIMPLE',
            ...meta,
          }),
        ),
      },
      body: new Uint8Array(pdf),
    });
    return { status: r.status, data: (await r.json()) as Record<string, any> };
  }
  function release(id: number, released = true, body: Record<string, unknown> = {}) {
    return fetch(`${server.baseUrl}/api/patient-documents/patients/${patient}/${id}/release`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${f.staff.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        released,
        reason: 'Explicit synthetic portal release decision',
        ...body,
      }),
    });
  }
  async function portal(path = '', token = portalToken) {
    const r = await fetch(`${server.baseUrl}/api/portal/documents${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const type = r.headers.get('content-type') ?? '';
    return {
      status: r.status,
      data: type.includes('json') ? ((await r.json()) as any) : null,
      bytes: type.includes('json') ? null : Buffer.from(await r.arrayBuffer()),
      headers: r.headers,
    };
  }
  it('uploads four documents without releasing any of them', async () => {
    identifiers = {
      general: (await upload('General outpatient letter')).data.id,
      consent: (await upload('Treatment consent form')).data.id,
      radiology: (await upload('Radiology consent form', { radiologyOrderId: order })).data.id,
      hidden: (await upload('Internal billing note')).data.id,
    };
    expect(Object.values(identifiers).every((id) => Number.isInteger(id))).toBe(true);
    // Upload is not release and does not claim a signature.
    const page = await portal();
    expect(page.status).toBe(200);
    expect(page.data.documents).toEqual([]);
    expect(page.data.empty_state).toBe('AWAITING_RELEASE');
  });
  it('makes a released general document visible to the correct patient only', async () => {
    expect((await release(identifiers.general)).status).toBe(200);
    const page = await portal();
    expect(page.data.page.total).toBe(1);
    expect(page.data.documents[0]).toMatchObject({
      id: identifiers.general,
      title: 'General outpatient letter',
      group: 'OTHER',
      source: 'Patient records',
    });
    // Another patient's session can never see it, even by guessing the id.
    const intruder = await portal(`/${identifiers.general}/file?download=1`, 'not-a-session');
    expect(intruder.status).toBe(401);
    const other = await portal(`/${identifiers.general}`);
    expect(other.status).toBe(200);
    await pool.query(
      "INSERT INTO patient_portal_accounts(tenant_id,facility_id,patient_id,login_identifier,login_type,password_hash,status,activated_at) VALUES($1,$2,$3,$4,'EMAIL',$5,'ACTIVE',now())",
      [
        f.tenant,
        f.facility,
        otherPatient,
        `portal-other-${f.tenant}@example.test`,
        await hashPassword(password),
      ],
    );
    const otherLogin = await fetch(`${server.baseUrl}/api/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: `portal-other-${f.tenant}@example.test`, password }),
    });
    const otherToken = ((await otherLogin.json()) as { sessionToken: string }).sessionToken;
    const otherList = await portal('', otherToken);
    expect(otherList.data.documents).toEqual([]);
    expect((await portal(`/${identifiers.general}/file?download=1`, otherToken)).status).toBe(404);
  });
  it('keeps an unreleased document invisible and unreachable by guessed id', async () => {
    expect((await portal(`/${identifiers.hidden}/file?download=1`)).status).toBe(404);
    expect((await portal(`/${identifiers.hidden}`)).status).toBe(404);
    const page = await portal();
    expect(page.data.documents.some((d: any) => d.id === identifiers.hidden)).toBe(false);
  });
  it('puts a released treatment consent under Consent forms and a radiology consent under procedure context', async () => {
    expect((await release(identifiers.consent, true, { reviewedOriginal: true })).status).toBe(200);
    expect((await release(identifiers.radiology, true, { reviewedOriginal: true })).status).toBe(200);
    const page = await portal();
    const consent = page.data.documents.find((d: any) => d.id === identifiers.consent);
    const radiology = page.data.documents.find((d: any) => d.id === identifiers.radiology);
    expect(consent).toMatchObject({ group: 'CONSENT', group_label: 'Consent forms' });
    expect(radiology).toMatchObject({
      group: 'CONSENT',
      kind: 'Radiology / procedure consent',
      procedure_name: 'Synthetic Chest X-Ray PA View',
      source: 'Radiology & Imaging',
    });
    expect(page.data.groups).toMatchObject({ CONSENT: 2, OTHER: 1, ALL: 3 });
  });
  it('requires an explicit consent review before releasing a consent document', async () => {
    const consent = await upload('Second treatment consent form');
    const rejected = await release(consent.data.id, true, { reviewedOriginal: false });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ error: 'CONSENT_REVIEW_REQUIRED' });
    expect((await portal()).data.documents.some((d: any) => d.id === consent.data.id)).toBe(false);
    // A general document does not demand the consent review.
    const general = await upload('Second general letter');
    expect((await release(general.data.id)).status).toBe(200);
  });
  it('supports multi-select release of eligible documents in one decision', async () => {
    const first = await upload('Batch general one'),
      second = await upload('Batch general two');
    const response = await fetch(
      `${server.baseUrl}/api/patient-documents/patients/${patient}/releases`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${f.staff.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentIds: [first.data.id, second.data.id],
          released: true,
          reason: 'Synthetic batch portal release',
        }),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.documents.map((d: any) => d.portal_release_status)).toEqual([
      'RELEASED',
      'RELEASED',
    ]);
    const page = await portal();
    expect(page.data.documents.some((d: any) => d.id === first.data.id)).toBe(true);
    expect(page.data.documents.some((d: any) => d.id === second.data.id)).toBe(true);
    // Batch withdrawal removes both again.
    const withdrawn = await fetch(
      `${server.baseUrl}/api/patient-documents/patients/${patient}/releases`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${f.staff.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentIds: [first.data.id, second.data.id],
          released: false,
          reason: 'Synthetic batch portal withdrawal',
        }),
      },
    );
    expect(withdrawn.status).toBe(200);
    const after = await portal();
    expect(after.data.documents.some((d: any) => d.id === first.data.id)).toBe(false);
    expect(after.data.documents.some((d: any) => d.id === second.data.id)).toBe(false);
  });
  it('reports a partial bulk release without claiming the refused document succeeded', async () => {
    const good = await upload('Partial release good');
    // A consent document without the explicit original review is refused by
    // the server even when a stale client sends it in the same decision.
    const refused = await upload('Partial release consent form');
    const response = await fetch(
      `${server.baseUrl}/api/patient-documents/patients/${patient}/releases`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${f.staff.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentIds: [good.data.id, refused.data.id],
          released: true,
          reason: 'Synthetic partial portal release',
        }),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.partial).toBe(true);
    expect(body.documents.map((d: any) => d.document_id)).toEqual([good.data.id]);
    expect(body.failures).toEqual([
      expect.objectContaining({
        document_id: refused.data.id,
        error: 'CONSENT_REVIEW_REQUIRED',
      }),
    ]);
    const released = await pool.query(
      'SELECT released FROM patient_document_releases WHERE document_id=$1',
      [good.data.id],
    );
    expect(released.rows[0].released).toBe(true);
    const refusedRow = await pool.query(
      'SELECT released FROM patient_document_releases WHERE document_id=$1',
      [refused.data.id],
    );
    expect(refusedRow.rowCount).toBe(0);
    // A selection where nothing can be released is an error, never a silent
    // success.
    const nothing = await fetch(
      `${server.baseUrl}/api/patient-documents/patients/${patient}/releases`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${f.staff.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentIds: [refused.data.id],
          released: true,
          reason: 'Synthetic refused portal release',
        }),
      },
    );
    expect(nothing.status).toBe(409);
    expect(((await nothing.json()) as any).error).toBe('CONSENT_REVIEW_REQUIRED');
  });
  it('records one audit action for a repeated release decision', async () => {
    const doc = await upload('Idempotent release decision');
    expect((await release(doc.data.id)).status).toBe(200);
    const again = await release(doc.data.id);
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).already_recorded).toBe(true);
    const events = await pool.query(
      "SELECT action,reason,actor_id,created_at FROM patient_document_events WHERE document_id=$1 AND action='PORTAL_RELEASE'",
      [doc.data.id],
    );
    expect(events.rowCount).toBe(1);
    expect(events.rows[0]).toMatchObject({
      action: 'PORTAL_RELEASE',
      reason: 'Explicit synthetic portal release decision',
      actor_id: f.staff.id,
    });
    expect(events.rows[0].created_at).toBeTruthy();
  });
  it('shows a revoked release as inaccessible while the staff list keeps the revoked state', async () => {
    expect((await release(identifiers.general, false)).status).toBe(200);
    const page = await portal();
    expect(page.data.documents.some((d: any) => d.id === identifiers.general)).toBe(false);
    const staffPage = await fetch(
      `${server.baseUrl}/api/patient-documents/patients/${patient}?paginate=1&limit=50`,
      { headers: { Authorization: `Bearer ${f.staff.token}` } },
    );
    const staffBody = (await staffPage.json()) as any;
    const revoked = staffBody.documents.find((d: any) => d.id === identifiers.general);
    expect(revoked.portal_release_status).toBe('REVOKED');
    expect(revoked.portal_revoked_at).toBeTruthy();
  });
  it('serves preview and original download for a released document', async () => {
    const preview = await portal(`/${identifiers.consent}/file?preview=1`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toBe('application/pdf');
    expect(preview.bytes!.subarray(0, 5).toString()).toBe('%PDF-');
    const download = await portal(`/${identifiers.consent}/file?download=1`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(download.bytes!.equals(pdf)).toBe(true);
  });
  it('returns released version history and details without staff metadata', async () => {
    const version = await upload('Treatment consent form', {
      previousId: identifiers.consent,
    });
    expect(version.status).toBe(201);
    // The corrected version is not released until staff says so.
    expect((await portal(`/${version.data.id}`)).status).toBe(404);
    expect((await release(version.data.id, true, { reviewedOriginal: true })).status).toBe(200);
    const detail = await portal(`/${identifiers.consent}`);
    expect(detail.status).toBe(200);
    expect(detail.data.document).not.toHaveProperty('notes');
    expect(detail.data.versions.map((v: any) => v.version)).toEqual([1, 2]);
    const history = await portal(`/${identifiers.consent}/history`);
    expect(history.status).toBe(200);
    expect(history.data.versions).toHaveLength(2);
    for (const key of ['notes', 'uploaded_by', 'sha256', 'reason', 'doctor_id', 'uploader_name'])
      expect(detail.data.document).not.toHaveProperty(key);
  });
  it('searches and filters across the whole authorized set, including older documents', async () => {
    const page = await portal('?search=radiology');
    expect(page.data.documents).toHaveLength(1);
    expect(page.data.documents[0].id).toBe(identifiers.radiology);
    const consentOnly = await portal('?group=CONSENT');
    expect(consentOnly.data.documents.every((d: any) => d.group === 'CONSENT')).toBe(true);
    const none = await portal('?search=no-such-synthetic-document');
    expect(none.data.documents).toEqual([]);
    expect(none.data.empty_state).toBe('NO_MATCHES');
    const inverted = await portal('?from=2020-05-05&to=2020-01-01');
    expect(inverted.status).toBe(400);
    const badGroup = await portal('?group=EVERYTHING');
    expect(badGroup.status).toBe(400);
    const badCursor = await portal('?cursor=not-a-real-cursor');
    expect(badCursor.status).toBe(400);
  });
  it('pages beyond 200 released versions and reaches the oldest authorized document', async () => {
    // Seed a realistic long history in the disposable database only.
    const rows: number[] = [];
    for (let index = 0; index < 205; index += 1) {
      const inserted = await pool.query(
        `INSERT INTO patient_signed_documents
          (tenant_id,facility_id,patient_id,version,title,category,document_type,patient_signature,doctor_signature,filename,mime_type,sha256,original_bytes,uploaded_by,uploaded_at,reason)
         VALUES($1,$2,$3,1,$4,'Document','Patient document','UNKNOWN','UNKNOWN',$5,'application/pdf',$6,$7,$8,now() - ($9 || ' days')::interval,'Synthetic long history') RETURNING id`,
        [
          f.tenant,
          f.facility,
          patient,
          index === 0 ? 'ARCHIVE-DEEPEST released document' : `Synthetic history ${index}`,
          `history-${index}.pdf`,
          'c'.repeat(64),
          pdf,
          f.staff.id,
          String(300 - index),
        ],
      );
      const id = inserted.rows[0].id as number;
      rows.push(id);
      await pool.query(
        "INSERT INTO patient_document_releases(document_id,released,actor_id,reason,released_at) VALUES($1,true,$2,'Synthetic long history release',now())",
        [id, f.staff.id],
      );
    }
    const seen: number[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 40; guard += 1) {
      const query = new URLSearchParams({ limit: '25' });
      if (cursor) query.set('cursor', cursor);
      const page = (await portal(`?${query.toString()}`)).data;
      seen.push(...page.documents.map((d: any) => d.id));
      cursor = page.page.next_cursor;
      if (!cursor) break;
    }
    expect(seen.length).toBe(new Set(seen).size);
    expect(new Set(seen).size).toBeGreaterThanOrEqual(205);
    expect(seen).toContain(rows[0]);
    const deepSearch = await portal('?search=ARCHIVE-DEEPEST');
    expect(deepSearch.data.documents).toHaveLength(1);
    const oldest = await portal(`/${rows[0]}/file?download=1`);
    expect(oldest.status).toBe(200);
  });
  it('shows newly released documents after a refresh and hides notes and audit reasons', async () => {
    const fresh = await upload('Freshly released document');
    const before = await portal();
    expect(before.data.documents.some((d: any) => d.id === fresh.data.id)).toBe(false);
    expect((await release(fresh.data.id)).status).toBe(200);
    const after = await portal();
    const item = after.data.documents.find((d: any) => d.id === fresh.data.id);
    expect(item).toBeTruthy();
    for (const key of ['notes', 'uploader_name', 'sha256', 'reason'])
      expect(item).not.toHaveProperty(key);
    const serialized = JSON.stringify(after.data);
    expect(serialized).not.toContain('PRIVATE STAFF NOTE');
    expect(serialized).not.toContain('Explicit synthetic portal release decision');
    const audit = await pool.query(
      "SELECT count(*)::int AS n FROM patient_document_events WHERE patient_id=$1 AND action='PORTAL_VIEW'",
      [patient],
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });
  it('refuses a portal account that is not linked to a facility', async () => {
    const { portalDocumentPage } = await import('../../documents/patient-documents.service.ts');
    await expect(
      portalDocumentPage({
        accountId: session.accountId,
        patientId: session.patientId,
        tenantId: session.tenantId,
        facilityId: null,
        sessionId: 1,
        loginIdentifier: 'synthetic',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'PORTAL_FACILITY_REQUIRED' });
  });
});
