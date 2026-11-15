import { beforeAll, afterAll, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { describeDb } from '../vitest/support/db.ts';
import { pool } from '../../db/index.ts';
import { createApp } from '../../app.ts';
import { startTestServer } from './support/http-harness.ts';
import { createResponsibleDoctorFixture } from './support/responsible-doctor.fixture.ts';

describeDb('Simple document uploads — attested disposable DB and real mounted HTTP', () => {
  let f: Awaited<ReturnType<typeof createResponsibleDoctorFixture>>,
    server: Awaited<ReturnType<typeof startTestServer>>,
    bytes: Buffer,
    order: number,
    other: number,
    otherPatient: number,
    general: any,
    linked: any;
  beforeAll(async () => {
    f = await createResponsibleDoctorFixture();
    await pool.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code='radiology.consent.verify' ON CONFLICT DO NOTHING",
      [f.doctorRole],
    );
    order = (
      await pool.query(
        "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name) VALUES($1,$2,$3,'X-Ray','Synthetic simplified request') RETURNING id",
        [f.tenant, f.facility, f.patient],
      )
    ).rows[0].id;
    other = (
      await pool.query(
        "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name) VALUES($1,$2,$3,'X-Ray','Other synthetic request') RETURNING id",
        [f.tenant, f.facility, f.patient],
      )
    ).rows[0].id;
    otherPatient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Other','2000-01-01','Other') RETURNING id",
        [f.tenant, f.facility, 'SIMPLE-' + order],
      )
    ).rows[0].id;
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText('Synthetic simple upload', { x: 40, y: 750, size: 12 });
    bytes = Buffer.from(await pdf.save());
    server = await startTestServer(await createApp());
  });
  afterAll(async () => {
    await server?.close();
  });
  async function upload(
    meta: Record<string, unknown>,
    token = f.staff.token,
    p = f.patient,
    body = bytes,
  ) {
    const r = await fetch(`${server.baseUrl}/api/patient-documents/patients/${p}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/pdf',
        'X-Document-Metadata': encodeURIComponent(
          JSON.stringify({
            filename: 'synthetic.pdf',
            title: 'Synthetic simple document',
            ...meta,
          }),
        ),
      },
      body: new Uint8Array(body),
    });
    return { status: r.status, data: await r.json() };
  }
  async function get(path: string, token = f.staff.token) {
    const r = await fetch(server.baseUrl + path, { headers: { Authorization: `Bearer ${token}` } });
    return { status: r.status, data: await r.json() };
  }
  async function verify(o: number, id: number, token = f.doctorA.token) {
    const r = await fetch(`${server.baseUrl}/api/patient-documents/radiology/${o}/consent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'VERIFIED',
        documentId: id,
        clinicianId: f.doctorA.id,
        reason: 'Synthetic verification boundary test',
      }),
    });
    return { status: r.status, data: await r.json() };
  }
  const base = () => `/api/patient-documents/patients/${f.patient}`;
  it('accepts title/file only from authorized non-doctor and persists neutral server-managed metadata', async () => {
    const r = await upload({});
    expect(r.status).toBe(201);
    general = r.data;
    expect(general).toMatchObject({
      patient_id: f.patient,
      category: 'Document',
      document_type: 'Patient document',
      doctor_id: null,
      signing_date: null,
      patient_signature: 'UNKNOWN',
      doctor_signature: 'UNKNOWN',
      notes: null,
      uploaded_by: f.staff.id,
      radiology_order_id: null,
    });
    const saved = (
      await pool.query(
        'SELECT tenant_id,facility_id,reason FROM patient_signed_documents WHERE id=$1',
        [general.id],
      )
    ).rows[0];
    expect(saved).toMatchObject({
      tenant_id: f.tenant,
      facility_id: f.facility,
      reason: 'Upload original patient document',
    });
  });
  it('does not fabricate assertions even for doctors or forged simple-mode metadata', async () => {
    const r = await upload(
      {
        uploadMode: 'SIMPLE',
        doctorId: f.doctorB.id,
        signingDate: '2026-01-01',
        patientSignature: 'PRESENT',
        doctorSignature: 'PRESENT',
        uploadedBy: f.staff.id,
        facilityId: f.sibling,
      },
      f.doctorA.token,
    );
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({
      doctor_id: null,
      signing_date: null,
      patient_signature: 'UNKNOWN',
      doctor_signature: 'UNKNOWN',
      uploaded_by: f.doctorA.id,
    });
  });
  it('persists optional notes and exact radiology context without granting verification or portal release', async () => {
    const r = await upload({
      notes: 'Synthetic optional notes',
      radiologyOrderId: order,
      procedureName: 'FORGED PROCEDURE',
      facilityId: f.sibling,
    });
    expect(r.status).toBe(201);
    linked = r.data;
    expect(linked).toMatchObject({
      radiology_order_id: order,
      procedure_name: 'Synthetic simplified request',
      patient_id: f.patient,
      notes: 'Synthetic optional notes',
      doctor_id: null,
      patient_signature: 'UNKNOWN',
    });
    expect((await get(`/api/patient-documents/radiology/${order}/consent`)).data.status).toBe(
      'AWAITING_VERIFICATION',
    );
    expect(
      (
        await pool.query('SELECT * FROM patient_document_releases WHERE document_id=$1', [
          linked.id,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it('lists the same radiology ID exactly once centrally and returns uploader name', async () => {
    const r = await get(base());
    expect(r.status).toBe(200);
    expect(r.data.filter((d: any) => d.id === linked.id)).toHaveLength(1);
    expect(r.data.find((d: any) => d.id === linked.id).uploader_name).toBe(f.staff.name);
  });
  it('retrieves the immutable original byte-for-byte', async () => {
    const r = await fetch(`${server.baseUrl}${base()}/${linked.id}/file`, {
      headers: { Authorization: `Bearer ${f.staff.token}` },
    });
    expect(r.status).toBe(200);
    expect(Buffer.from(await r.arrayBuffer())).toEqual(bytes);
  });
  it('does not allow unknown signatures or a general document to verify consent', async () => {
    expect((await verify(order, linked.id)).status).toBe(400);
    expect((await verify(order, general.id)).status).toBe(400);
    expect((await verify(other, linked.id)).status).toBe(400);
  });
  it('rejects wrong patient request linkage, file retrieval and cross-facility access', async () => {
    expect((await upload({ radiologyOrderId: order }, f.staff.token, otherPatient)).status).toBe(
      404,
    );
    expect(
      (await get(`/api/patient-documents/patients/${otherPatient}/${linked.id}/file`)).status,
    ).toBe(404);
    expect((await get(base(), f.cross.token)).status).toBe(404);
  });
  it('denies upload/read/verification without the required authorization', async () => {
    expect((await upload({}, 'not-a-session')).status).toBe(401);
    expect((await verify(order, linked.id, f.staff.token)).status).toBe(403);
    // Revoke upload from a fresh, fixture-only uploader role without affecting other personas.
    await pool.query(
      "DELETE FROM role_permissions WHERE role_id IN (SELECT role_id FROM user_roles WHERE user_id=$1) AND permission_id IN (SELECT id FROM permissions WHERE code='patients.documents.upload')",
      [f.unauthorized.id],
    );
    expect((await upload({}, f.unauthorized.token)).status).toBe(403);
  });
  it('keeps mandatory title and decoded file validation', async () => {
    expect((await upload({ title: '' })).status).toBe(400);
    expect((await upload({}, f.staff.token, f.patient, Buffer.from('not a PDF'))).status).toBe(400);
  });
  it('creates correction versions with unknown assertions, keeps originals and records audit events', async () => {
    const r = await upload({
      previousId: linked.id,
      title: 'Synthetic corrected title',
      notes: 'Correction notes',
    });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({
      root_id: linked.id,
      version: 2,
      radiology_order_id: order,
      procedure_name: 'Synthetic simplified request',
      doctor_id: null,
      signing_date: null,
      patient_signature: 'UNKNOWN',
    });
    const history = await get(`${base()}/${r.data.id}/history`);
    expect(history.data.versions).toHaveLength(2);
    expect(history.data.versions[0].sha256).toBe(history.data.versions[1].sha256);
    expect(
      history.data.events.some((e: any) => e.action === 'NEW_VERSION' && e.actor_id === f.staff.id),
    ).toBe(true);
    await expect(
      pool.query('UPDATE patient_signed_documents SET title=$2 WHERE id=$1', [
        linked.id,
        'Illegal overwrite',
      ]),
    ).rejects.toThrow();
  });
  it('rejects cancelled-request uploads and decisions', async () => {
    await pool.query("UPDATE radiology_orders SET status='Cancelled' WHERE id=$1", [other]);
    expect((await upload({ radiologyOrderId: other })).status).toBe(409);
    expect((await verify(other, linked.id)).status).toBe(409);
  });
});
