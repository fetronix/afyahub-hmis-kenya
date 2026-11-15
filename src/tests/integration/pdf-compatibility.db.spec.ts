import { beforeAll, afterAll, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { describeDb } from '../vitest/support/db.ts';
import { pool } from '../../db/index.ts';
import { createApp } from '../../app.ts';
import { startTestServer } from './support/http-harness.ts';
import { createResponsibleDoctorFixture } from './support/responsible-doctor.fixture.ts';
import { pdfCompatibilityFixtures, type PdfFixture } from '../fixtures/pdf-compatibility.ts';
import { documentLimit } from '../../documents/patient-file-validation.ts';

describeDb(
  'PDF compatibility — both real HTTP upload/storage surfaces, attested disposable only',
  () => {
    let f: Awaited<ReturnType<typeof createResponsibleDoctorFixture>>,
      server: Awaited<ReturnType<typeof startTestServer>>,
      fixtures: PdfFixture[];
    beforeAll(async () => {
      f = await createResponsibleDoctorFixture();
      fixtures = await pdfCompatibilityFixtures();
      for (const code of ['facility.branding.read', 'facility.branding.manage']) {
        await pool.query(
          "INSERT INTO permissions(code,name,module) VALUES($1,$1,'configuration') ON CONFLICT(code) DO NOTHING",
          [code],
        );
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT ur.role_id,p.id FROM user_roles ur CROSS JOIN permissions p WHERE ur.user_id=$1 AND p.code=$2 ON CONFLICT DO NOTHING',
          [f.staff.id, code],
        );
      }
      server = await startTestServer(await createApp());
    });
    afterAll(async () => {
      await server?.close();
    });
    async function post(fixture: PdfFixture, letterhead = false, token = f.staff.token) {
      const path = letterhead
        ? `/api/facility-branding/facilities/${f.facility}/letterheads?filename=${fixture.name}.pdf`
        : `/api/patient-documents/patients/${f.patient}`;
      const r = await fetch(server.baseUrl + path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/pdf',
          ...(!letterhead
            ? {
                'X-Document-Metadata': encodeURIComponent(
                  JSON.stringify({
                    title: 'Synthetic ' + fixture.name,
                    filename: fixture.name + '.pdf',
                    uploadMode: 'SIMPLE',
                  }),
                ),
              }
            : {}),
        },
        body: new Uint8Array(fixture.bytes),
      });
      return { status: r.status, data: await r.json() };
    }
    it.each([
      'static-text',
      'scanned-letterhead',
      'images',
      'scanned-signature',
      'graphics',
      'type3-glyph-A',
      'tagged-layout-A',
      'initial-view-fit',
      'static-annotations',
      'internal-link',
      'form-xobject',
      'local-navigation',
    ])('stores and retrieves %s unchanged on patient and letterhead APIs', async (name) => {
      const fixture = fixtures.find((f) => f.name === name)!;
      const hash = createHash('sha256').update(fixture.bytes).digest('hex');
      for (const letterhead of [false, true]) {
        const saved = await post(fixture, letterhead);
        expect(saved.status, JSON.stringify(saved.data)).toBe(201);
        const id = letterhead ? saved.data.letterhead.id : saved.data.id;
        const file = await fetch(
          server.baseUrl +
            (letterhead
              ? `/api/facility-branding/facilities/${f.facility}/letterheads/${id}/file`
              : `/api/patient-documents/patients/${f.patient}/${id}/file`),
          { headers: { Authorization: `Bearer ${f.staff.token}` } },
        );
        expect(file.status).toBe(200);
        expect(file.headers.get('cache-control')).toContain('private');
        expect(file.headers.get('cache-control')).toContain('no-store');
        expect(file.headers.get('content-type')).toContain('application/pdf');
        expect(file.headers.get('x-content-type-options')).toBe('nosniff');
        expect(file.headers.get('content-security-policy')).toContain('sandbox');
        expect(Buffer.from(await file.arrayBuffer())).toEqual(fixture.bytes);
        const row = (
          await pool.query(
            letterhead
              ? 'SELECT source_pdf AS bytes,source_pdf_sha256 AS sha256,status FROM facility_letterheads WHERE id=$1'
              : 'SELECT original_bytes AS bytes,sha256,patient_signature,doctor_signature,signing_date FROM patient_signed_documents WHERE id=$1',
            [id],
          )
        ).rows[0];
        expect(row.bytes).toEqual(fixture.bytes);
        expect(row.sha256).toBe(hash);
        if (letterhead) expect(row.status).toBe('DRAFT');
        else {
          expect(row.patient_signature).toBe('UNKNOWN');
          expect(row.doctor_signature).toBe('UNKNOWN');
          expect(row.signing_date).toBeNull();
          expect(
            (await pool.query('SELECT * FROM patient_document_releases WHERE document_id=$1', [id]))
              .rowCount,
          ).toBe(0);
        }
      }
    });
    it.each([
      'javascript',
      'additional-javascript',
      'escaped-javascript',
      'launch',
      'attachments',
      'interactive-form',
      'external-link',
      'unsupported-media',
      'corrupted',
    ])('rejects %s without persisting any patient document or letterhead', async (name) => {
      const fixture = fixtures.find((f) => f.name === name)!;
      const counts = async () =>
        Promise.all(
          ['patient_signed_documents', 'facility_letterheads'].map(
            async (table) =>
              (
                await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1`, [
                  f.tenant,
                ])
              ).rows[0].n,
          ),
        );
      const before = await counts();
      for (const letterhead of [false, true]) {
        const r = await post(fixture, letterhead);
        expect(r.status).toBe(400);
        expect(r.data.message).toContain(fixture.message!);
        expect(r.data.message).not.toMatch(
          /node_modules|\.ts:\d|\bat (?:Object|Function)|\/home\//,
        );
      }
      expect(await counts()).toEqual(before);
    });
    it('keeps size limits on both mounted upload routes', async () => {
      const fixture = {
        name: 'oversized',
        bytes: Buffer.alloc(documentLimit() + 1),
        supported: false,
        feature: 'oversized',
      };
      const patient = await post(fixture);
      expect(patient.status).toBe(413);
      expect(patient.data.message).toContain('size limit');
      const letterhead = await post(fixture, true);
      expect(letterhead.status).toBe(413);
      // The existing application-level raw-body limit uses the generic safe error envelope.
      expect(letterhead.data.error).toContain('too large');
    });
    it('keeps authorization independent of file compatibility', async () => {
      expect((await post(fixtures[0], false, 'not-a-session')).status).toBe(401);
      expect((await post(fixtures[0], true, f.doctorA.token)).status).toBe(403);
      expect((await post(fixtures[0], false, f.cross.token)).status).toBe(404);
    });
  },
);
