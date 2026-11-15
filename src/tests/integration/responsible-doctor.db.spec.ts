import { beforeAll, afterAll, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { describeDb } from '../vitest/support/db.ts';
import { pool } from '../../db/index.ts';
import { createApp } from '../../app.ts';
import { startTestServer } from './support/http-harness.ts';
import { createResponsibleDoctorFixture } from './support/responsible-doctor.fixture.ts';

describeDb('Responsible doctor assignment — disposable PostgreSQL and actual HTTP', () => {
  let f: Awaited<ReturnType<typeof createResponsibleDoctorFixture>>;
  let server: Awaited<ReturnType<typeof startTestServer>>, pdf: Buffer;
  const metadata = (extra: Record<string, unknown> = {}) => ({
    filename: 'synthetic.pdf',
    title: 'Synthetic doctor consent',
    category: 'Consent',
    documentType: 'Treatment consent',
    patientSignature: 'UNKNOWN',
    doctorSignature: 'UNKNOWN',
    reason: 'Synthetic responsible doctor verification',
    ...extra,
  });
  async function request(token: string, suffix = '', extra?: Record<string, unknown>) {
    const response = await fetch(
      `${server.baseUrl}/api/patient-documents/patients/${f.patient}${suffix}`,
      {
        method: extra ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(extra
            ? {
                'Content-Type': 'application/pdf',
                'X-Document-Metadata': encodeURIComponent(JSON.stringify(metadata(extra))),
              }
            : {}),
        },
        body: extra ? new Uint8Array(pdf) : undefined,
      },
    );
    return { status: response.status, data: await response.json() };
  }
  beforeAll(async () => {
    f = await createResponsibleDoctorFixture();
    server = await startTestServer(await createApp());
    const doc = await PDFDocument.create();
    doc.addPage().drawText('Synthetic responsible doctor only');
    pdf = Buffer.from(await doc.save());
  });
  afterAll(async () => {
    await server?.close();
  });
  it.each(['doctorA', 'doctorB'] as const)(
    'resolves %s from authenticated identity, not caller role/identity fields',
    async (key) => {
      const actor = f[key];
      const options = await request(actor.token, '/doctors');
      expect(options.status).toBe(200);
      expect(options.data.currentDoctor).toMatchObject({ id: actor.id, name: actor.name });
      expect(options.data.canAssignOthers).toBe(false);
      expect(options.data.doctors.map((d: any) => d.id)).toEqual([actor.id]);
      const saved = await request(actor.token, '', { userId: f.staff.id, roles: ['DOCTOR'] });
      expect(saved.status).toBe(201);
      expect(saved.data).toMatchObject({
        doctor_id: actor.id,
        doctor_name: actor.name,
        doctor_signature: 'UNKNOWN',
      });
    },
  );
  it('offers authorized staff only active same-facility Doctor-role identities with safe search', async () => {
    const result = await request(f.staff.token, '/doctors');
    expect(result.status).toBe(200);
    expect(result.data.currentDoctor).toBeNull();
    expect(result.data.canAssignOthers).toBe(true);
    expect(result.data.doctors.map((d: any) => d.id).sort()).toEqual(
      [f.doctorA.id, f.doctorB.id].sort(),
    );
    expect(Object.keys(result.data.doctors[0]).sort()).toEqual(['designation', 'id', 'name']);
    expect(
      (await request(f.staff.token, '/doctors?search=Doctor%20B')).data.doctors.map(
        (d: any) => d.id,
      ),
    ).toEqual([f.doctorB.id]);
    expect((await request(f.staff.token, '/doctors?search=%25')).data.doctors).toEqual([]);
  });
  it('lets authorized records staff select another active doctor and records identity in audit', async () => {
    const result = await request(f.staff.token, '', { doctorId: f.doctorB.id });
    expect(result.status).toBe(201);
    expect(result.data.doctor_id).toBe(f.doctorB.id);
    const event = (
      await pool.query(
        "SELECT facts FROM patient_document_events WHERE document_id=$1 AND action='UPLOAD'",
        [result.data.id],
      )
    ).rows[0];
    expect(event.facts).toMatchObject({
      responsibleDoctorId: f.doctorB.id,
      responsibleDoctorName: f.doctorB.name,
      assignment: 'DELEGATED',
    });
  });
  it('denies doctor override without patients.update, even when the other doctor is valid', async () => {
    const result = await request(f.doctorA.token, '', { doctorId: f.doctorB.id });
    expect(result.status).toBe(403);
    expect(result.data.error).toBe('DOCTOR_ASSIGNMENT_FORBIDDEN');
  });
  it('does not silently assign a non-doctor, even with a medical designation or forged roles', async () => {
    const result = await request(f.staff.token, '', { roles: ['DOCTOR'], userId: f.doctorA.id });
    expect(result.status).toBe(400);
    expect(result.data.error).toBe('DOCTOR_REQUIRED');
    const explicit = await request(f.staff.token, '', { doctorId: f.staff.id });
    expect(explicit.status).toBe(400);
    expect(explicit.data.error).toBe('INVALID_RESPONSIBLE_DOCTOR');
  });
  it('does not let unauthorized non-doctor staff browse or assign other doctors', async () => {
    const options = await request(f.unauthorized.token, '/doctors');
    expect(options.data).toMatchObject({
      currentDoctor: null,
      canAssignOthers: false,
      doctors: [],
    });
    const saved = await request(f.unauthorized.token, '', { doctorId: f.doctorA.id });
    expect(saved.status).toBe(403);
  });
  it.each(['inactive', 'suspended', 'cross', 'revoked', 'deactivated', 'locked'] as const)(
    'rejects %s doctor IDs at upload, regardless of client options',
    async (key) => {
      const result = await request(f.staff.token, '', { doctorId: f[key].id });
      expect(result.status).toBe(400);
      expect(result.data.error).toBe('INVALID_RESPONSIBLE_DOCTOR');
    },
  );
  it('rejects fabricated and deleted user IDs', async () => {
    const result = await request(f.staff.token, '', { doctorId: 2147483647 });
    expect(result.status).toBe(400);
    expect(result.data.error).toBe('INVALID_RESPONSIBLE_DOCTOR');
    const id = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,tenant_id,facility_id,account_status) VALUES($1,$1,$2,'Synthetic deleted Doctor',$3,$4,'ACTIVE') RETURNING id",
        ['deleted-' + f.patient, 'deleted-' + f.patient + '@example.test', f.tenant, f.facility],
      )
    ).rows[0].id;
    await pool.query('DELETE FROM users WHERE id=$1', [id]);
    expect((await request(f.staff.token, '', { doctorId: id })).data.error).toBe(
      'INVALID_RESPONSIBLE_DOCTOR',
    );
  });
  it('revalidates inactive role and assignment state before committing', async () => {
    await pool.query('UPDATE roles SET is_active=false WHERE id=$1', [f.doctorRole]);
    try {
      expect((await request(f.staff.token, '', { doctorId: f.doctorA.id })).data.error).toBe(
        'INVALID_RESPONSIBLE_DOCTOR',
      );
    } finally {
      await pool.query('UPDATE roles SET is_active=true WHERE id=$1', [f.doctorRole]);
    }
    await pool.query('UPDATE user_roles SET is_active=false WHERE user_id=$1', [f.doctorB.id]);
    try {
      expect((await request(f.staff.token, '', { doctorId: f.doctorB.id })).data.error).toBe(
        'INVALID_RESPONSIBLE_DOCTOR',
      );
    } finally {
      await pool.query('UPDATE user_roles SET is_active=true WHERE user_id=$1', [f.doctorB.id]);
    }
  });
  it('rejects a Doctor role owned by another tenant', async () => {
    const t = (
      await pool.query(
        "INSERT INTO tenants(name,slug) VALUES('Synthetic foreign Doctor role',$1) RETURNING id",
        ['foreign-doctor-' + f.patient],
      )
    ).rows[0].id;
    const role = (
      await pool.query("INSERT INTO roles(tenant_id,name) VALUES($1,'DOCTOR') RETURNING id", [t])
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [f.staff.id, role]);
    expect((await request(f.staff.token, '', { doctorId: f.staff.id })).data.error).toBe(
      'INVALID_RESPONSIBLE_DOCTOR',
    );
  });
  it('requires document upload permission and patient facility scope to browse doctors', async () => {
    expect((await request(f.cross.token, '/doctors')).status).toBe(404);
    const id = f.unauthorized.id;
    await pool.query('UPDATE user_roles SET is_active=false WHERE user_id=$1', [id]);
    try {
      expect((await request(f.unauthorized.token, '/doctors')).status).toBe(403);
    } finally {
      await pool.query('UPDATE user_roles SET is_active=true WHERE user_id=$1', [id]);
    }
    expect((await request('invalid-token', '/doctors')).status).toBe(401);
  });
  it('retains original doctor, hash and version metadata after correction and doctor deactivation', async () => {
    const first = (await request(f.doctorA.token, '', {})).data;
    const correction = await request(f.staff.token, '', {
      previousId: first.id,
      doctorId: f.doctorB.id,
    });
    expect(correction.status).toBe(201);
    await pool.query('UPDATE users SET is_active=false WHERE id=$1', [f.doctorA.id]);
    try {
      const history = await request(f.staff.token, `/${first.id}/history`);
      expect(history.data.versions.map((v: any) => [v.doctor_id, v.doctor_name, v.sha256])).toEqual(
        [
          [f.doctorA.id, f.doctorA.name, first.sha256],
          [f.doctorB.id, f.doctorB.name, first.sha256],
        ],
      );
      const list = await request(f.staff.token);
      expect(list.data.find((v: any) => v.id === first.id)).toMatchObject({
        doctor_id: f.doctorA.id,
        doctor_name: f.doctorA.name,
      });
    } finally {
      await pool.query('UPDATE users SET is_active=true WHERE id=$1', [f.doctorA.id]);
    }
  });
  it('does not backfill or reassign a legacy original with no recorded doctor', async () => {
    const first = (await request(f.doctorA.token, '', {})).data;
    const legacy = (
      await pool.query(
        `INSERT INTO patient_signed_documents
      (tenant_id,facility_id,patient_id,version,title,category,document_type,patient_signature,doctor_signature,filename,mime_type,sha256,original_bytes,uploaded_by,reason)
      SELECT tenant_id,facility_id,patient_id,1,'Synthetic legacy original',category,document_type,patient_signature,doctor_signature,filename,mime_type,sha256,original_bytes,uploaded_by,reason
      FROM patient_signed_documents WHERE id=$1 RETURNING id`,
        [first.id],
      )
    ).rows[0].id;
    expect(
      (await request(f.staff.token, '', { previousId: legacy, doctorId: f.doctorB.id })).status,
    ).toBe(201);
    const history = (await request(f.staff.token, `/${legacy}/history`)).data;
    expect(history.versions[0]).toMatchObject({ doctor_id: null, doctor_name: null });
    expect(history.versions[1]).toMatchObject({
      doctor_id: f.doctorB.id,
      doctor_name: f.doctorB.name,
    });
  });
  it('bounds large facility searches and can find a doctor beyond the first 50', async () => {
    const inserted = await pool.query(
      `INSERT INTO users(uid,username,email,full_name,tenant_id,facility_id,account_status)
      SELECT 'synthetic-option-'||$3||'-'||n,'synthetic-option-'||$3||'-'||n,'synthetic-option-'||$3||'-'||n||'@example.test','Synthetic option '||lpad(n::text,2,'0'),$1,$2,'ACTIVE'
      FROM generate_series(1,51) n RETURNING id`,
      [f.tenant, f.facility, f.patient],
    );
    await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT unnest($1::int[]),$2', [
      inserted.rows.map((r) => r.id),
      f.doctorRole,
    ]);
    const all = await request(f.staff.token, '/doctors');
    expect(all.data.doctors).toHaveLength(50);
    expect(all.data.hasMore).toBe(true);
    const searched = await request(f.staff.token, '/doctors?search=Synthetic%20option%2051');
    expect(searched.data.doctors).toHaveLength(1);
    expect(searched.data.hasMore).toBe(false);
    expect(searched.data.doctors[0].name).toBe('Synthetic option 51');
  });
});
