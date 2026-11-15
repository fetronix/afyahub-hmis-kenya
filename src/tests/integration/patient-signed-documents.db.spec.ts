import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import sharp from 'sharp';
import { describeDb } from '../vitest/support/db.ts';
import { pool } from '../../db/index.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import * as docs from '../../documents/patient-documents.service.ts';
import { validatePatientFile } from '../../documents/patient-file-validation.ts';
import { generateReport } from '../../reporting/report-centre.service.ts';
import { portalLogin } from '../../portal/portal-auth.service.ts';
import { hashPassword } from '../../utils/password.ts';
import { REPORT_ENGINES } from '../../reporting/report-centre.types.ts';
import { updateRadiologyReport } from '../../db/queries/laboratory.ts';
import type { ReportEngineId } from '../../reporting/report-catalogue.ts';

const reason = 'Synthetic independently checked consent evidence';
describeDb('signed originals, procedure consent and report retrieval — disposable only', () => {
  let a: AuthorizationContext,
    b: AuthorizationContext,
    patient: number,
    otherPatient: number,
    order: number,
    pdf: Buffer,
    doc: any,
    version: any;
  const suffix = randomUUID();
  const metadata = (extra: Record<string, unknown> = {}) => ({
    filename: 'synthetic.pdf',
    title: 'Synthetic signed consent',
    category: 'Consent',
    documentType: 'Treatment consent',
    patientSignature: 'UNKNOWN',
    doctorSignature: 'UNKNOWN',
    reason,
    ...extra,
  });
  beforeAll(async () => {
    if (
      process.env.SQL_HOST !== '127.0.0.1' ||
      process.env.SQL_DB_NAME !== 'clinical_documents_synthetic_test'
    )
      throw Error('Explicit disposable loopback database only');
    const tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic clinical test',
        suffix,
      ])
    ).rows[0].id;
    const fs = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic clinical A',$4::jsonb),($1,$3,'Synthetic clinical B',$4::jsonb) RETURNING id",
        [
          tenant,
          'da-' + suffix,
          'db-' + suffix,
          JSON.stringify([
            'registration',
            'analytics',
            'radiology',
            'laboratory',
            'inventory',
            'finance',
            'accounting',
            'procurement',
            'pharmacy',
            'opd',
            'inpatient',
          ]),
        ],
      )
    ).rows;
    const users = [];
    for (const f of fs)
      users.push(
        (
          await pool.query(
            "INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id,account_status) VALUES($1,$1,$2,'Synthetic clinician','not-a-login',$3,$4,'ACTIVE') RETURNING id",
            [randomUUID(), randomUUID() + '@example.test', tenant, f.id],
          )
        ).rows[0].id,
      );
    const permissions = [
      'patients.read',
      'patients.documents.read',
      'patients.documents.upload',
      'patients.documents.release',
      'radiology.consent.verify',
      'radiology.consent.exception',
      'radiology.consent.policy',
      'reports.read',
      'reports.export',
      ...Object.values(REPORT_ENGINES).flatMap((d) => [
        ...d.permissions,
        ...(d.exportPermissions ?? []),
      ]),
    ];
    a = {
      userId: users[0],
      tenantId: tenant,
      facilityId: fs[0].id,
      roles: [],
      isSuperAdmin: false,
      permissions,
    };
    b = { ...a, userId: users[1], facilityId: fs[1].id };
    const p = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Consent A','2000-01-01','Other'),($1,$2,$4,'Synthetic','Consent B','2000-01-01','Other') RETURNING id",
        [tenant, a.facilityId, 'a-' + suffix, 'b-' + suffix],
      )
    ).rows;
    patient = p[0].id;
    otherPatient = p[1].id;
    order = (
      await pool.query(
        "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name) VALUES($1,$2,$3,'CT','Synthetic procedure') RETURNING id",
        [tenant, a.facilityId, patient],
      )
    ).rows[0].id;
    const d = await PDFDocument.create();
    d.addPage().drawText('Synthetic consent only');
    pdf = Buffer.from(await d.save());
  });
  it('uploads valid PDF without inferring signatures and retains exact original hash/bytes', async () => {
    doc = await docs.uploadPatientDocument(a, patient, metadata(), pdf, 'application/pdf');
    expect(doc.patient_signature).toBe('UNKNOWN');
    expect(doc.doctor_signature).toBe('UNKNOWN');
    const file = await docs.readPatientDocument(a, patient, doc.id, false);
    expect(file.original_bytes.equals(pdf)).toBe(true);
    expect(doc.version).toBe(1);
  });
  it.each(['png', 'jpeg'] as const)('decodes and accepts valid %s images', async (format) => {
    const bytes = await sharp({ create: { width: 3, height: 3, channels: 3, background: 'white' } })
      .toFormat(format)
      .toBuffer();
    await expect(
      docs.uploadPatientDocument(
        a,
        patient,
        metadata({ filename: 'synthetic.' + format }),
        bytes,
        'image/' + format,
      ),
    ).resolves.toMatchObject({ mime_type: 'image/' + format });
  });
  it('rejects malformed images, unsupported extension, MIME mismatch and DOCX', async () => {
    await expect(
      validatePatientFile(Buffer.from('not png'), 'x.png', 'image/png'),
    ).rejects.toMatchObject({ code: 'MALFORMED_DOCUMENT' });
    for (const [name, mime] of [
      ['x.exe', 'application/pdf'],
      ['x.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['x.png', 'image/jpeg'],
    ])
      await expect(validatePatientFile(pdf, name, mime)).rejects.toMatchObject({
        code: 'UNSUPPORTED_DOCUMENT',
      });
  });
  it('rejects truncated, encrypted-like and active-content PDFs', async () => {
    await expect(
      validatePatientFile(pdf.subarray(0, 40), 'x.pdf', 'application/pdf'),
    ).rejects.toMatchObject({ code: 'INVALID_PDF' });
    const active = await PDFDocument.create();
    active.addPage();
    active.catalog.set(
      PDFName.of('OpenAction'),
      active.context.obj({ S: PDFName.of('JavaScript'), JS: PDFString.of('app.alert(1)') }),
    );
    await expect(
      validatePatientFile(Buffer.from(await active.save()), 'x.pdf', 'application/pdf'),
    ).rejects.toMatchObject({ code: 'UNSAFE_PDF' });
  });
  it('authenticates digit-heavy patient email as email, not an unrelated phone identifier', async () => {
    const identifier = `synthetic-12345678901-${suffix.replace(/[0-9]/g, (digit) => String.fromCharCode(97 + Number(digit)))}@example.test`,
      password = 'Synthetic-portal-password-only!';
    await pool.query(
      "INSERT INTO patient_portal_accounts(tenant_id,facility_id,patient_id,login_identifier,login_type,password_hash,status,activated_at) VALUES($1,$2,$3,$4,'EMAIL',$5,'ACTIVE',now())",
      [a.tenantId, a.facilityId, patient, identifier, await hashPassword(password)],
    );
    const result = await portalLogin(
      { identifier, password },
      { ipAddress: '127.0.0.1', userAgent: 'Synthetic integration' },
    );
    expect(result.sessionToken.length).toBeGreaterThan(20);
    await expect(
      portalLogin(
        { identifier, password: 'wrong-synthetic-password' },
        { ipAddress: '127.0.0.1', userAgent: 'Synthetic integration' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
  it('enforces configurable byte limit', async () => {
    const old = process.env.PATIENT_DOCUMENT_MAX_BYTES;
    try {
      process.env.PATIENT_DOCUMENT_MAX_BYTES = '1024';
      await expect(
        validatePatientFile(Buffer.alloc(1025), 'x.pdf', 'application/pdf'),
      ).rejects.toMatchObject({ status: 413 });
    } finally {
      if (old) process.env.PATIENT_DOCUMENT_MAX_BYTES = old;
      else delete process.env.PATIENT_DOCUMENT_MAX_BYTES;
    }
  });
  it('rejects invalid signature metadata and invalid signing date', async () => {
    await expect(
      docs.uploadPatientDocument(
        a,
        patient,
        metadata({ patientSignature: 'PRESENT' }),
        pdf,
        'application/pdf',
      ),
    ).rejects.toMatchObject({ code: 'SIGNING_DATE_REQUIRED' });
    await expect(
      docs.uploadPatientDocument(
        a,
        patient,
        metadata({ signingDate: '2026-02-31' }),
        pdf,
        'application/pdf',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNING_DATE' });
    await expect(
      docs.uploadPatientDocument(
        a,
        patient,
        metadata({ doctorSignature: 'PRESENT', signingDate: '2026-01-02' }),
        pdf,
        'application/pdf',
      ),
    ).rejects.toMatchObject({ code: 'DOCTOR_REQUIRED' });
  });
  it('retains originals and adds corrections with version and audit history', async () => {
    version = await docs.uploadPatientDocument(
      a,
      patient,
      metadata({ previousId: doc.id, title: 'Synthetic corrected consent' }),
      pdf,
      'application/pdf',
    );
    expect(version.version).toBe(2);
    const history = await docs.documentHistory(a, patient, version.id);
    expect(history.versions.map((d) => d.version)).toEqual([1, 2]);
    expect(history.events.some((e) => e.action === 'NEW_VERSION')).toBe(true);
    await expect(
      pool.query("UPDATE patient_signed_documents SET title='overwrite' WHERE id=$1", [doc.id]),
    ).rejects.toThrow('append-only');
    await expect(
      docs.uploadPatientDocument(
        a,
        patient,
        metadata({ previousId: doc.id }),
        pdf,
        'application/pdf',
      ),
    ).rejects.toMatchObject({ code: 'STALE_DOCUMENT_VERSION' });
  });
  it('searches document type and signing dates without losing null distinction', async () => {
    expect((await docs.listPatientDocuments(a, patient, { search: 'corrected' })).length).toBe(1);
    expect(await docs.listPatientDocuments(a, patient, { type: 'Other type' })).toEqual([]);
    expect(
      await docs.listPatientDocuments(a, patient, { from: '2026-01-01', to: '2026-01-02' }),
    ).toEqual([]);
  });
  it('denies missing permission, other patient, other facility and other tenant', async () => {
    await expect(
      docs.readPatientDocument({ ...a, permissions: ['patients.read'] }, patient, doc.id, true),
    ).rejects.toMatchObject({ status: 403 });
    await expect(docs.readPatientDocument(a, otherPatient, doc.id, true)).rejects.toMatchObject({
      status: 404,
    });
    await expect(docs.readPatientDocument(b, patient, doc.id, true)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      docs.readPatientDocument({ ...a, tenantId: 999999 }, patient, doc.id, true),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('requires explicit portal release and projects no internal metadata; denies cross-patient/facility access', async () => {
    const s = {
      accountId: 123,
      patientId: patient,
      tenantId: a.tenantId!,
      facilityId: a.facilityId,
      sessionId: 1,
      loginIdentifier: 'synthetic',
    };
    expect(await docs.portalPatientDocuments(s)).toEqual([]);
    await docs.releasePatientDocument(a, patient, doc.id, true, reason);
    const list = await docs.portalPatientDocuments(s);
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('notes');
    expect(list[0]).not.toHaveProperty('uploaded_by');
    expect(list[0]).not.toHaveProperty('sha256');
    expect((await docs.portalPatientDocuments(s, doc.id, true)).original_bytes.equals(pdf)).toBe(
      true,
    );
    await expect(
      docs.portalPatientDocuments({ ...s, patientId: otherPatient }, doc.id, true),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      docs.portalPatientDocuments({ ...s, facilityId: b.facilityId }, doc.id, true),
    ).rejects.toMatchObject({ status: 404 });
    await docs.releasePatientDocument(a, patient, doc.id, false, reason);
    expect(await docs.portalPatientDocuments(s)).toEqual([]);
  });
  it('defaults to consent required and blocks real completion SQL without consent', async () => {
    expect((await docs.radiologyConsent(a, order)).status).toBe('CONSENT_REQUIRED');
    await expect(
      pool.query("UPDATE radiology_orders SET status='Reported' WHERE id=$1", [order]),
    ).rejects.toThrow('RADIOLOGY_CONSENT_REQUIRED');
  });
  it('does not accept generic consent as procedure-specific verification', async () => {
    await expect(
      docs.decideRadiologyConsent(a, order, {
        status: 'VERIFIED',
        documentId: doc.id,
        clinicianId: a.userId,
        reason,
      }),
    ).rejects.toMatchObject({ code: 'CONSENT_INCOMPLETE' });
  });
  it('links consent to procedure/patient/doctor, records verification, invalidates correction, then allows completion', async () => {
    const specific = metadata({
      radiologyOrderId: order,
      patientSignature: 'PRESENT',
      doctorSignature: 'PRESENT',
      doctorId: a.userId,
      signingDate: '2026-01-02',
    });
    const consent = await docs.uploadPatientDocument(a, patient, specific, pdf, 'application/pdf');
    expect((await docs.radiologyConsent(a, order)).status).toBe('AWAITING_VERIFICATION');
    await docs.decideRadiologyConsent(a, order, {
      status: 'VERIFIED',
      documentId: consent.id,
      clinicianId: a.userId,
      reason,
    });
    const corrected = await docs.uploadPatientDocument(
      a,
      patient,
      { ...specific, previousId: consent.id },
      pdf,
      'application/pdf',
    );
    expect((await docs.radiologyConsent(a, order)).status).toBe('AWAITING_VERIFICATION');
    await expect(
      pool.query("UPDATE radiology_orders SET status='Reported' WHERE id=$1", [order]),
    ).rejects.toThrow('RADIOLOGY_CONSENT_REQUIRED');
    await docs.decideRadiologyConsent(a, order, {
      status: 'VERIFIED',
      documentId: corrected.id,
      clinicianId: a.userId,
      reason,
    });
    // A changed procedure must not reuse consent verified for the original procedure.
    await pool.query(
      "UPDATE radiology_orders SET procedure_name='Changed synthetic procedure' WHERE id=$1",
      [order],
    );
    expect((await docs.radiologyConsent(a, order)).status).toBe('AWAITING_VERIFICATION');
    await expect(
      pool.query("UPDATE radiology_orders SET status='Reported' WHERE id=$1", [order]),
    ).rejects.toThrow('RADIOLOGY_CONSENT_REQUIRED');
    await expect(
      docs.decideRadiologyConsent(a, order, {
        status: 'VERIFIED',
        documentId: corrected.id,
        clinicianId: a.userId,
        reason,
      }),
    ).rejects.toMatchObject({ code: 'CONSENT_INCOMPLETE' });
    await pool.query(
      "UPDATE radiology_orders SET procedure_name='Synthetic procedure' WHERE id=$1",
      [order],
    );
    expect(
      (
        await pool.query("UPDATE radiology_orders SET status='Reported' WHERE id=$1 RETURNING id", [
          order,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (await docs.listPatientDocuments(a, patient)).some((d) => d.radiology_order_id === order),
    ).toBe(true);
    const history = await docs.documentHistory(a, patient, corrected.id);
    expect(history.events.find((e) => e.action === 'RADIOLOGY_VERIFIED').facts.clinicianId).toBe(
      a.userId,
    );
  });
  it('denies exception by default; allows only explicit policy, permitted clinician and audited reason', async () => {
    const o = (
      await pool.query(
        "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name) VALUES($1,$2,$3,'X-Ray','Synthetic exception') RETURNING id",
        [a.tenantId, a.facilityId, patient],
      )
    ).rows[0].id;
    const input = { status: 'EXCEPTION', clinicianId: a.userId, reason };
    await expect(docs.decideRadiologyConsent(a, o, input)).rejects.toMatchObject({
      code: 'EXCEPTION_NOT_PERMITTED',
    });
    await docs.setRadiologyConsentPolicy(a, { required: true, allowException: true, reason });
    await expect(
      docs.decideRadiologyConsent(
        { ...a, permissions: ['patients.read', 'patients.documents.read'] },
        o,
        input,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await docs.decideRadiologyConsent(a, o, input);
    expect(
      (
        await pool.query("UPDATE radiology_orders SET status='Reported' WHERE id=$1 RETURNING id", [
          o,
        ])
      ).rowCount,
    ).toBe(1);
    const history = await pool.query(
      "SELECT facts FROM patient_document_events WHERE patient_id=$1 AND action='RADIOLOGY_EXCEPTION'",
      [patient],
    );
    expect(history.rows[0].facts.clinicianId).toBe(a.userId);
    await expect(docs.radiologyConsent(b, o)).rejects.toMatchObject({ status: 404 });
  });
  it.each(['Cancelled', 'CANCELLED', 'Canceled'])(
    'denies consent decisions and performance for a %s request even with earlier consent',
    async (status) => {
      const o = (
        await pool.query(
          "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,modality,procedure_name) VALUES($1,$2,$3,'CT','Synthetic cancelled procedure') RETURNING id",
          [a.tenantId, a.facilityId, patient],
        )
      ).rows[0].id;
      await docs.setRadiologyConsentPolicy(a, { required: true, allowException: true, reason });
      const input = { status: 'EXCEPTION', clinicianId: a.userId, reason };
      await docs.decideRadiologyConsent(a, o, input);
      await pool.query('UPDATE radiology_orders SET status=$2 WHERE id=$1', [o, status]);
      expect((await docs.radiologyConsent(a, o)).status).toBe('PROCEDURE_CANCELLED');
      await expect(docs.decideRadiologyConsent(a, o, input)).rejects.toMatchObject({
        code: 'PROCEDURE_NOT_ACTIVE',
        status: 409,
      });
      await expect(
        updateRadiologyReport(
          o,
          'Synthetic findings',
          'Synthetic impression',
          'Synthetic clinician',
          a.userId,
        ),
      ).rejects.toMatchObject({ code: 'RADIOLOGY_ORDER_CANCELLED', status: 409 });
      expect(
        (await pool.query('SELECT status FROM radiology_orders WHERE id=$1', [o])).rows[0].status,
      ).toBe(status);
      expect(
        (
          await pool.query(
            "SELECT id FROM billing_charge_attempts WHERE source_id=$1 AND source_type='RADIOLOGY'",
            [String(o)],
          )
        ).rowCount,
      ).toBe(0);
    },
  );

  it('fails closed and rolls back originals if document auditing fails', async () => {
    const tag = 'doc_audit_' + suffix.replaceAll('-', '').slice(0, 16);
    const before = Number(
      (
        await pool.query('SELECT count(*) AS n FROM patient_signed_documents WHERE patient_id=$1', [
          patient,
        ])
      ).rows[0].n,
    );
    await pool.query(
      `CREATE FUNCTION ${tag}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.patient_id=${patient} THEN RAISE EXCEPTION 'synthetic document audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${tag} BEFORE INSERT ON patient_document_events FOR EACH ROW EXECUTE FUNCTION ${tag}()`,
    );
    try {
      await expect(
        docs.uploadPatientDocument(a, patient, metadata(), pdf, 'application/pdf'),
      ).rejects.toThrow('synthetic document audit failure');
    } finally {
      await pool.query(`DROP TRIGGER ${tag} ON patient_document_events`);
      await pool.query(`DROP FUNCTION ${tag}()`);
    }
    expect(
      Number(
        (
          await pool.query(
            'SELECT count(*) AS n FROM patient_signed_documents WHERE patient_id=$1',
            [patient],
          )
        ).rows[0].n,
      ),
    ).toBe(before);
  });
  it('does not bypass portal download policy with inline preview', async () => {
    const session = {
      accountId: 124,
      patientId: patient,
      tenantId: a.tenantId!,
      facilityId: a.facilityId,
      sessionId: 1,
      loginIdentifier: 'synthetic',
    };
    await docs.releasePatientDocument(a, patient, doc.id, true, reason);
    await pool.query(
      'INSERT INTO patient_portal_settings(tenant_id,facility_id,allow_downloads) VALUES($1,$2,false)',
      [a.tenantId, a.facilityId],
    );
    try {
      await expect(docs.portalPatientDocuments(session, doc.id, true)).rejects.toMatchObject({
        code: 'DOWNLOAD_DISABLED',
      });
    } finally {
      await pool.query(
        'UPDATE patient_portal_settings SET allow_downloads=true WHERE facility_id=$1',
        [a.facilityId],
      );
    }
  });
  it('rejects invalid signing-date filters and treats wildcard search literally', async () => {
    await expect(
      docs.listPatientDocuments(a, patient, { from: '2026-02-31' }),
    ).rejects.toMatchObject({ code: 'INVALID_DATE_FILTER' });
    await expect(
      docs.listPatientDocuments(a, patient, { from: '2026-03-01', to: '2026-01-01' }),
    ).rejects.toMatchObject({ code: 'INVALID_DATE_FILTER' });
    expect(await docs.listPatientDocuments(a, patient, { search: '%' })).toEqual([]);
  });
  for (const [id, definition] of Object.entries(REPORT_ENGINES))
    it(`executes real scoped ${id} SQL and its empty/filtered query`, async () => {
      const filters = {
        facilityId: a.facilityId!,
        ...(definition.dateMode === 'asOf'
          ? { to: '2026-12-31' }
          : definition.dateLabel
            ? { from: '2026-01-01', to: '2026-12-31' }
            : {}),
      };
      const result = await generateReport(a, id, filters, 'VIEW');
      expect(result.reportId).toBe(id);
      expect(result.rows).toBeInstanceOf(Array);
      const empty = await generateReport(b, id, { ...filters, facilityId: b.facilityId! }, 'VIEW');
      expect(empty.rows).toEqual([]);
      const searched = await generateReport(
        a,
        id,
        { ...filters, search: 'does-not-exist-' + suffix },
        'VIEW',
      );
      expect(searched.rows).toEqual([]);
      await expect(generateReport(b, id, { ...filters }, 'VIEW')).rejects.toBeDefined();
      expect(result.columns).toEqual(REPORT_ENGINES[id as ReportEngineId].columns);
    });
});
