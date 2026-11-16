import { createHash } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { describeDb } from '../vitest/support/db.ts';
import { pool } from '../../db/index.ts';
import { createApp } from '../../app.ts';
import { startTestServer } from './support/http-harness.ts';
import { createResponsibleDoctorFixture } from './support/responsible-doctor.fixture.ts';

describeDb(
  'simplified radiology consent — real HTTP, disposable synthetic persistence only',
  () => {
    let f: Awaited<ReturnType<typeof createResponsibleDoctorFixture>>,
      server: Awaited<ReturnType<typeof startTestServer>>,
      pdf: Buffer,
      pending: number,
      otherRequest: number,
      noConsent: number,
      cancelled: number,
      otherPatient: number,
      uploaded: any;
    const reviewReason = 'Synthetic doctor reviewed the original consent document';
    beforeAll(async () => {
      f = await createResponsibleDoctorFixture();
      for (const code of ['radiology.consent.verify', 'clinical.update'])
        await pool.query(
          "INSERT INTO permissions(code,name,module) VALUES($1,$1,'patients') ON CONFLICT(code) DO NOTHING",
          [code],
        );
      for (const userId of [f.doctorA.id, f.doctorB.id])
        await pool.query(
          "INSERT INTO role_permissions(role_id,permission_id) SELECT ur.role_id,p.id FROM user_roles ur CROSS JOIN permissions p WHERE ur.user_id=$1 AND p.code='radiology.consent.verify' ON CONFLICT DO NOTHING",
          [userId],
        );
      // Deliberately give the non-doctor uploader verification permission:
      // permission alone must still not let them impersonate a doctor.
      for (const userId of [f.staff.id])
        for (const code of ['radiology.consent.verify', 'clinical.update'])
          await pool.query(
            'INSERT INTO role_permissions(role_id,permission_id) SELECT ur.role_id,p.id FROM user_roles ur CROSS JOIN permissions p WHERE ur.user_id=$1 AND p.code=$2 ON CONFLICT DO NOTHING',
            [userId, code],
          );
      const orders = async (procedure: string, status = 'Requested') =>
        (
          await pool.query(
            'INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
            [f.tenant, f.facility, f.patient, 'CT', procedure, status],
          )
        ).rows[0].id;
      pending = await orders('Synthetic simplified CT head');
      otherRequest = await orders('Synthetic other CT');
      noConsent = await orders('Synthetic missing consent CT');
      cancelled = await orders('Synthetic cancelled CT');
      await pool.query("UPDATE radiology_orders SET status='Cancelled' WHERE id=$1", [cancelled]);
      otherPatient = (
        await pool.query(
          "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Other consent patient','2000-01-01','Other') RETURNING id",
          [f.tenant, f.facility, 'RAD-CONSENT-' + pending],
        )
      ).rows[0].id;
      const document = await PDFDocument.create();
      document.addPage().drawText('Synthetic simplified procedure consent', { x: 40, y: 760 });
      pdf = Buffer.from(await document.save());
      server = await startTestServer(await createApp());
    });
    afterAll(async () => {
      await server?.close();
    });
    async function upload(
      order: number,
      meta: Record<string, unknown> = {},
      token = f.staff.token,
      patient = f.patient,
      body = pdf,
    ) {
      const r = await fetch(`${server.baseUrl}/api/patient-documents/patients/${patient}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/pdf',
          'X-Document-Metadata': encodeURIComponent(
            JSON.stringify({
              title: 'Synthetic procedure consent',
              filename: 'synthetic-consent.pdf',
              uploadMode: 'SIMPLE',
              radiologyOrderId: order,
              ...meta,
            }),
          ),
        },
        body: new Uint8Array(body),
      });
      return { status: r.status, data: await r.json() };
    }
    async function state(order: number, token = f.staff.token) {
      const r = await fetch(`${server.baseUrl}/api/patient-documents/radiology/${order}/consent`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: r.status, data: await r.json() };
    }
    async function decide(order: number, body: Record<string, unknown>, token: string) {
      const r = await fetch(`${server.baseUrl}/api/patient-documents/radiology/${order}/consent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: r.status, data: await r.json() };
    }
    async function report(order: number) {
      const r = await fetch(
        `${server.baseUrl}/api/radiology-orders/${order}/report?facilityId=${f.facility}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${f.staff.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            findings: 'Synthetic findings',
            impression: 'Synthetic impression',
            reportedBy: 'Synthetic Records',
          }),
        },
      );
      return { status: r.status, data: await r.json() };
    }

    it('accepts a simple title/notes/file upload and records neutral metadata', async () => {
      const r = await upload(pending, { notes: 'Synthetic optional notes' });
      expect(r.status, JSON.stringify(r.data)).toBe(201);
      uploaded = r.data;
      expect(uploaded).toMatchObject({
        patient_id: f.patient,
        radiology_order_id: pending,
        procedure_name: 'Synthetic simplified CT head',
        radiology_attachment_context: 'PRE_PROCEDURE',
        historical: false,
        doctor_id: null,
        signing_date: null,
        patient_signature: 'UNKNOWN',
        doctor_signature: 'UNKNOWN',
        uploaded_by: f.staff.id,
        notes: 'Synthetic optional notes',
      });
      const saved = (
        await pool.query(
          'SELECT tenant_id,facility_id,sha256,original_bytes,radiology_attachment_context FROM patient_signed_documents WHERE id=$1',
          [uploaded.id],
        )
      ).rows[0];
      expect(saved).toMatchObject({
        tenant_id: f.tenant,
        facility_id: f.facility,
        sha256: createHash('sha256').update(pdf).digest('hex'),
        radiology_attachment_context: 'PRE_PROCEDURE',
      });
      expect(Buffer.from(saved.original_bytes)).toEqual(pdf);
      expect((await state(pending)).data.status).toBe('AWAITING_VERIFICATION');
    });

    it('links the exact patient/request/procedure and appears once in Patient Management', async () => {
      const list = await fetch(
        `${server.baseUrl}/api/patient-documents/patients/${f.patient}?radiologyOrderId=${pending}`,
        { headers: { Authorization: `Bearer ${f.staff.token}` } },
      );
      expect(list.status).toBe(200);
      const rows = await list.json();
      expect(rows.filter((d: any) => d.id === uploaded.id)).toHaveLength(1);
      expect(rows.find((d: any) => d.id === uploaded.id)).toMatchObject({
        radiology_order_id: pending,
        procedure_name: 'Synthetic simplified CT head',
        uploader_name: f.staff.name,
        historical: false,
      });
      const consent = await state(pending);
      expect(consent.status).toBe(200);
      expect(consent.data.request).toMatchObject({
        id: pending,
        patientId: f.patient,
        procedureName: 'Synthetic simplified CT head',
        completed: false,
      });
      expect(consent.data.documents.map((d: any) => d.id)).toContain(uploaded.id);
      expect(consent.data.viewerIsDoctor).toBe(false);
      expect(consent.data.currentDoctor).toBeNull();
      expect(consent.data.reviewDoctors.map((d: any) => d.id)).toEqual(
        expect.arrayContaining([f.doctorA.id, f.doctorB.id]),
      );
      const wrongPatient = await fetch(
        `${server.baseUrl}/api/patient-documents/patients/${otherPatient}?radiologyOrderId=${pending}`,
        { headers: { Authorization: `Bearer ${f.staff.token}` } },
      );
      expect(wrongPatient.status).toBe(404);
    });

    it('retrieves the original for preview and download without changing bytes', async () => {
      for (const query of ['preview=1', 'download=1']) {
        const r = await fetch(
          `${server.baseUrl}/api/patient-documents/patients/${f.patient}/${uploaded.id}/file?${query}`,
          { headers: { Authorization: `Bearer ${f.staff.token}` } },
        );
        expect(r.status).toBe(200);
        expect(Buffer.from(await r.arrayBuffer())).toEqual(pdf);
      }
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM patient_document_releases WHERE document_id=$1',
            [uploaded.id],
          )
        ).rows[0].n,
      ).toBe(0);
    });

    it('lets an authorized administrator upload but never impersonate a doctor', async () => {
      const asOtherDoctor = await decide(
        pending,
        {
          status: 'VERIFIED',
          documentId: uploaded.id,
          clinicianId: f.doctorA.id,
          reason: reviewReason,
        },
        f.staff.token,
      );
      expect(asOtherDoctor.status).toBe(403);
      expect(asOtherDoctor.data.error).toBe('SELF_VERIFICATION_REQUIRED');
      const asSelf = await decide(
        pending,
        {
          status: 'VERIFIED',
          documentId: uploaded.id,
          clinicianId: f.staff.id,
          reason: reviewReason,
        },
        f.staff.token,
      );
      expect(asSelf.status).toBe(400);
      expect(asSelf.data.error).toBe('INVALID_CLINICIAN');
      expect((await state(pending)).data.status).toBe('AWAITING_VERIFICATION');
    });

    it('requires the doctor to open the original, records self verification, then allows reporting', async () => {
      const beforeReview = await decide(
        pending,
        {
          status: 'VERIFIED',
          documentId: uploaded.id,
          clinicianId: f.doctorA.id,
        },
        f.doctorA.token,
      );
      expect(beforeReview.status).toBe(409);
      expect(beforeReview.data.error).toBe('CONSENT_REVIEW_REQUIRED');
      const file = await fetch(
        `${server.baseUrl}/api/patient-documents/patients/${f.patient}/${uploaded.id}/file?preview=1`,
        { headers: { Authorization: `Bearer ${f.doctorA.token}` } },
      );
      expect(file.status).toBe(200);
      const verified = await decide(
        pending,
        {
          status: 'VERIFIED',
          documentId: uploaded.id,
          clinicianId: f.doctorA.id,
        },
        f.doctorA.token,
      );
      expect(verified.status, JSON.stringify(verified.data)).toBe(200);
      const consent = await state(pending, f.doctorA.token);
      expect(consent.data.status).toBe('VERIFIED');
      expect(consent.data.viewerIsDoctor).toBe(true);
      expect(consent.data.currentDoctor).toMatchObject({ id: f.doctorA.id });
      expect(consent.data.decision).toMatchObject({
        status: 'VERIFIED',
        document_id: uploaded.id,
        clinician_id: f.doctorA.id,
        decided_by: f.doctorA.id,
      });
      expect((await report(pending)).status).toBe(200);
      expect(
        (await pool.query('SELECT status FROM radiology_orders WHERE id=$1', [pending])).rows[0]
          .status,
      ).toBe('Reported');
    });

    it('blocks completion without consent and while consent is unverified', async () => {
      const missing = await report(noConsent);
      expect(missing.status).toBe(409);
      expect(missing.data.error).toBe('RADIOLOGY_CONSENT_REQUIRED');
      const late = await upload(noConsent);
      expect(late.status).toBe(201);
      const stillBlocked = await report(noConsent);
      expect(stillBlocked.status).toBe(409);
      expect(stillBlocked.data.error).toBe('RADIOLOGY_CONSENT_REQUIRED');
      expect((await state(noConsent)).data.status).toBe('AWAITING_VERIFICATION');
      expect(
        (await pool.query('SELECT status FROM radiology_orders WHERE id=$1', [noConsent])).rows[0]
          .status,
      ).toBe('Requested');
    });

    it('rejects wrong-patient and wrong-request documents', async () => {
      const wrongPatient = await upload(pending, {}, f.staff.token, otherPatient);
      expect(wrongPatient.status).toBe(404);
      const wrongRequest = await decide(
        otherRequest,
        {
          status: 'VERIFIED',
          documentId: uploaded.id,
          clinicianId: f.doctorA.id,
        },
        f.doctorA.token,
      );
      expect(wrongRequest.status).toBe(400);
      expect(wrongRequest.data.error).toBe('CONSENT_INCOMPLETE');
    });

    it('retains cancellation protections for uploads and decisions', async () => {
      expect((await upload(cancelled)).status).toBe(409);
      const decision = await decide(
        cancelled,
        {
          status: 'VERIFIED',
          documentId: uploaded.id,
          clinicianId: f.doctorA.id,
        },
        f.doctorA.token,
      );
      expect(decision.status).toBe(409);
      expect(decision.data.error).toBe('PROCEDURE_NOT_ACTIVE');
    });

    it('treats post-reporting uploads as historical support, never retrospective consent', async () => {
      const ordinary = await upload(pending);
      expect(ordinary.status).toBe(409);
      expect(ordinary.data.error).toBe('RADIOLOGY_REQUEST_COMPLETED');
      const missingReason = await upload(pending, { radiologyAttachmentMode: 'HISTORICAL' });
      expect(missingReason.status).toBe(400);
      expect(missingReason.data.error).toBe('REASON_REQUIRED');
      const historical = await upload(pending, {
        radiologyAttachmentMode: 'HISTORICAL',
        reason: 'Found in the paper file after the report was issued',
      });
      expect(historical.status, JSON.stringify(historical.data)).toBe(201);
      expect(historical.data).toMatchObject({
        radiology_order_id: pending,
        radiology_attachment_context: 'POST_REPORTING_HISTORICAL',
        historical: true,
        doctor_id: null,
        patient_signature: 'UNKNOWN',
      });
      const reportedAt = (
        await pool.query('SELECT reported_at FROM radiology_orders WHERE id=$1', [pending])
      ).rows[0].reported_at;
      expect(new Date(historical.data.uploaded_at).getTime()).toBeGreaterThanOrEqual(
        new Date(reportedAt).getTime(),
      );
      const event = (
        await pool.query(
          "SELECT action,facts FROM patient_document_events WHERE document_id=$1 AND action='HISTORICAL_ATTACHMENT'",
          [historical.data.id],
        )
      ).rows[0];
      expect(event).toBeTruthy();
      expect(event.facts).toMatchObject({
        orderId: pending,
        preProcedureConsentSatisfied: false,
        attachmentContext: 'POST_REPORTING_HISTORICAL',
      });
      const retrospective = await decide(
        pending,
        {
          status: 'VERIFIED',
          documentId: historical.data.id,
          clinicianId: f.doctorA.id,
        },
        f.doctorA.token,
      );
      expect(retrospective.status).toBe(409);
      expect(retrospective.data.error).toBe('PROCEDURE_ALREADY_COMPLETED');
      const consent = await state(pending);
      expect(consent.data.status).toBe('VERIFIED');
      expect(consent.data.decision.document_id).toBe(uploaded.id);
      expect(consent.data.documents.find((d: any) => d.id === historical.data.id).historical).toBe(
        true,
      );
      const wrongRequest = await decide(
        otherRequest,
        {
          status: 'VERIFIED',
          documentId: historical.data.id,
          clinicianId: f.doctorA.id,
        },
        f.doctorA.token,
      );
      expect(wrongRequest.status).toBe(400);
      expect(wrongRequest.data.error).toBe('CONSENT_INCOMPLETE');
    });

    it('refuses historical mode on a pending request', async () => {
      const r = await upload(otherRequest, {
        radiologyAttachmentMode: 'HISTORICAL',
        reason: 'Attempted historical attachment on a pending request',
      });
      expect(r.status).toBe(409);
      expect(r.data.error).toBe('HISTORICAL_NOT_APPLICABLE');
    });

    it('keeps portal release a separate authorized action after verification', async () => {
      const before = (
        await pool.query(
          'SELECT count(*)::int AS n FROM patient_document_releases WHERE document_id=$1',
          [uploaded.id],
        )
      ).rows[0].n;
      expect(before).toBe(0);
      const release = await fetch(
        `${server.baseUrl}/api/patient-documents/patients/${f.patient}/${uploaded.id}/release`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${f.staff.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            released: true,
            reason: 'Explicit synthetic portal release after doctor verification',
          }),
        },
      );
      expect(release.status).toBe(200);
      expect(
        (
          await pool.query('SELECT released FROM patient_document_releases WHERE document_id=$1', [
            uploaded.id,
          ])
        ).rows[0].released,
      ).toBe(true);
    });
  },
);
