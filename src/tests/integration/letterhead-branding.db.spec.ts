/**
 * Facility letterhead management, against a real PostgreSQL database.
 *
 * The workflow under test is the one an administrator performs: upload a PDF,
 * correct the content area if the measurement is wrong, preview it, activate it,
 * replace it, and see who did what. Every step is exercised through the HTTP
 * surface because that is where isolation is actually decided — a service that
 * checks scope but a route that does not is still a hole.
 *
 * Tenant isolation is tested by attacking it: a second tenant holds a valid
 * session and a valid facility id, and every read and write it attempts against
 * the first tenant's letterhead must fail as "not found" rather than "forbidden",
 * so the endpoint cannot be used to enumerate other hospitals.
 *
 * Synthetic data only. No real facility, patient or provider appears here, and
 * the letterhead fixtures are generated rectangles plus one synthetic sample.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { startTestServer } from './support/http-harness.ts';

const A4_W = 595.28;
const A4_H = 841.89;

/**
 * An A4 letterhead with a solid header and footer band.
 *
 * Measured body: top 100 pt + 8 pt padding = 108; bottom 70 pt + 8 = 78. The
 * test asserts those numbers, so the measurement code is verified against known
 * geometry rather than against whatever it happens to return.
 */
async function syntheticLetterhead(options: { pages?: number; label?: string } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = Math.max(1, options.pages ?? 1);
  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([A4_W, A4_H]);
    page.drawRectangle({
      x: 0,
      y: A4_H - 100,
      width: A4_W,
      height: 100,
      color: rgb(0.05, 0.15, 0.35),
    });
    page.drawRectangle({ x: 0, y: 0, width: A4_W, height: 70, color: rgb(0.05, 0.15, 0.35) });
    page.drawText(options.label ?? 'Synthetic Letterhead', {
      x: 40,
      y: A4_H - 60,
      size: 16,
      font,
      color: rgb(1, 1, 1),
    });
    page.drawText(index === 0 ? 'Header page' : 'Continuation page', {
      x: 40,
      y: 30,
      size: 9,
      font,
      color: rgb(1, 1, 1),
    });
  }
  return Buffer.from(await pdf.save());
}

const BRANDING_READ = 'facility.branding.read';
const BRANDING_MANAGE = 'facility.branding.manage';

describeDb('Facility letterhead branding', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenantA: number, tenantB: number;
  let facilityA: number, facilityA2: number, facilityB: number;
  let adminToken: string, viewerToken: string, foreignToken: string, otherFacilityToken: string;
  let adminId: number;
  let base: string;
  let close: () => Promise<void>;
  /** The exact bytes of the first accepted upload, for the duplicate check. */
  let firstUpload: Buffer;

  const route = (facilityId: number, tail = '') =>
    `/api/facility-branding/facilities/${facilityId}/letterheads${tail}`;

  async function makeActor(tag: string, tenantId: number, facilityId: number, grants: string[]) {
    const id = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic user','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`brand-${tag}-${suffix}`, `brand-${tag}-${suffix}@example.test`, tenantId, facilityId],
      )
    ).rows[0].id as number;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenantId, `BRAND_${tag}_${suffix}`],
      )
    ).rows[0].id as number;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    for (const code of grants) {
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, code],
      );
    }
    const { sessionToken } = await createSession({ userId: id, securityVersion: 1 });
    return { id, token: sessionToken };
  }

  interface HttpResult {
    status: number;
    headers: Headers;
    json: any;
    bytes?: Buffer;
  }

  async function call(
    token: string | null,
    method: string,
    path: string,
    options: { body?: unknown; pdf?: Buffer; filename?: string; contentType?: string } = {},
  ): Promise<HttpResult> {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    let payload: BodyInit | undefined;
    if (options.pdf) {
      headers['content-type'] = options.contentType ?? 'application/pdf';
      payload = new Uint8Array(options.pdf);
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(options.body);
    }
    const response = await fetch(
      `${base}${path}${options.filename ? `?filename=${encodeURIComponent(options.filename)}` : ''}`,
      { method, headers, body: payload },
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
    return {
      status: response.status,
      headers: response.headers,
      json: isJson && buffer.length ? JSON.parse(buffer.toString('utf8')) : null,
      bytes: isJson ? undefined : buffer,
    };
  }

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test')) {
      throw new Error('Synthetic test database required.');
    }

    for (const code of [BRANDING_READ, BRANDING_MANAGE]) {
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'facilities') ON CONFLICT(code) DO NOTHING`,
        [code],
      );
    }

    tenantA = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Branding ${suffix}`,
        `brand-${suffix}`,
      ])
    ).rows[0].id as number;
    tenantB = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Foreign ${suffix}`,
        `foreign-${suffix}`,
      ])
    ).rows[0].id as number;

    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,mfl_code,address,county,phone,enabled_modules)
       VALUES($1,$2,'Synthetic Branding Hospital',$3,'Synthetic Road','Nyeri','0000000000','["finance"]'),
             ($1,$4,'Synthetic Branding Annex',$5,'Synthetic Road','Nyeri','0000000001','["finance"]'),
             ($6,$7,'Foreign Hospital',$8,'Foreign Road','Nyeri','0000000002','["finance"]')
       RETURNING id`,
      [
        tenantA,
        `BR-${suffix}`,
        `MFL-BR-${suffix}`,
        `BRA-${suffix}`,
        `MFL-BRA-${suffix}`,
        tenantB,
        `FB-${suffix}`,
        `MFL-FB-${suffix}`,
      ],
    );
    [facilityA, facilityA2, facilityB] = facilities.rows.map((row) => row.id as number);

    const admin = await makeActor('admin', tenantA, facilityA, [BRANDING_READ, BRANDING_MANAGE]);
    const viewer = await makeActor('viewer', tenantA, facilityA, [BRANDING_READ]);
    const foreign = await makeActor('foreign', tenantB, facilityB, [
      BRANDING_READ,
      BRANDING_MANAGE,
    ]);
    const annex = await makeActor('annex', tenantA, facilityA2, [BRANDING_READ, BRANDING_MANAGE]);
    adminId = admin.id;
    adminToken = admin.token;
    viewerToken = viewer.token;
    foreignToken = foreign.token;
    otherFacilityToken = annex.token;

    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });

  afterAll(async () => {
    if (close) await close();
  });

  /* ---------------------------------------------------------------- upload */

  it('rejects a file that is not a PDF and stores nothing', async () => {
    const before = await pool.query(
      'SELECT count(*)::int AS n FROM facility_letterheads WHERE facility_id=$1',
      [facilityA],
    );

    const notPdf = await call(adminToken, 'POST', route(facilityA), {
      pdf: Buffer.from('this is a text file pretending to be a letterhead'),
      filename: 'letterhead.pdf',
    });
    expect(notPdf.status).toBe(400);
    expect(notPdf.json.code).toBe('LETTERHEAD_SIGNATURE_INVALID');

    const wrongExtension = await call(adminToken, 'POST', route(facilityA), {
      pdf: await syntheticLetterhead(),
      filename: 'letterhead.png',
    });
    expect(wrongExtension.status).toBe(400);
    expect(wrongExtension.json.code).toBe('LETTERHEAD_EXTENSION_INVALID');

    const wrongType = await call(adminToken, 'POST', route(facilityA), {
      pdf: await syntheticLetterhead(),
      filename: 'letterhead.pdf',
      contentType: 'image/png',
    });
    expect(wrongType.status).toBe(400);

    const after = await pool.query(
      'SELECT count(*)::int AS n FROM facility_letterheads WHERE facility_id=$1',
      [facilityA],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('requires the manage permission to upload and read to list', async () => {
    const denied = await call(viewerToken, 'POST', route(facilityA), {
      pdf: await syntheticLetterhead(),
      filename: 'letterhead.pdf',
    });
    /* Refused by the shared permission middleware, before the handler runs. */
    expect(denied.status).toBe(403);
    expect(String(denied.json.code ?? denied.json.error)).toMatch(/FORBIDDEN/);

    const allowed = await call(viewerToken, 'GET', route(facilityA));
    expect(allowed.status).toBe(200);
    expect(Array.isArray(allowed.json.versions)).toBe(true);
  });

  it('stores an uploaded PDF as a draft and measures the printable area', async () => {
    const pdf = await syntheticLetterhead({ label: 'Nyeri Synthetic Hospital' });
    firstUpload = pdf;
    const uploaded = await call(adminToken, 'POST', route(facilityA), {
      pdf,
      filename: 'letterhead.pdf',
    });

    expect(uploaded.status).toBe(201);
    const letterhead = uploaded.json.letterhead;
    expect(letterhead.status).toBe('DRAFT');
    expect(letterhead.version).toBe(1);
    expect(letterhead.hasPdf).toBe(true);
    expect(letterhead.sourcePdfBytes).toBe(pdf.length);
    expect(letterhead.sourcePdfPages).toBe(1);
    expect(letterhead.uploadedByUserId).toBe(adminId);

    /* 100 pt header + 8 pt padding; 70 pt footer + 8 pt padding. */
    expect(letterhead.bodyTopPt).toBeCloseTo(108, 1);
    expect(letterhead.bodyBottomPt).toBeCloseTo(78, 1);
    expect(letterhead.layoutSource).toBe('MEASURED');

    const stored = await pool.query(
      'SELECT length(source_pdf)::int AS bytes, source_pdf_sha256 FROM facility_letterheads WHERE id=$1',
      [letterhead.id],
    );
    expect(stored.rows[0].bytes).toBe(pdf.length);
    expect(stored.rows[0].source_pdf_sha256).toMatch(/^[0-9a-f]{64}$/);

    const events = await pool.query(
      'SELECT action, actor_user_id FROM facility_letterhead_events WHERE letterhead_id=$1',
      [letterhead.id],
    );
    expect(events.rows).toEqual([{ action: 'UPLOADED', actor_user_id: adminId }]);
  });

  it('refuses the same file twice with a message naming the version', async () => {
    const duplicate = await call(adminToken, 'POST', route(facilityA), {
      pdf: firstUpload,
      filename: 'letterhead.pdf',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.json.code).toBe('LETTERHEAD_DUPLICATE');
    expect(duplicate.json.message).toContain('version 1');
  });

  /* ------------------------------------------------------------ activation */

  it('activates a version and keeps the previous one as history', async () => {
    const [first] = (
      await pool.query(
        'SELECT id FROM facility_letterheads WHERE facility_id=$1 ORDER BY version',
        [facilityA],
      )
    ).rows;

    const activated = await call(adminToken, 'POST', route(facilityA, `/${first.id}/activate`), {
      body: { reason: 'Approved stationery' },
    });
    expect(activated.status).toBe(200);
    expect(activated.json.letterhead.status).toBe('ACTIVE');
    expect(activated.json.letterhead.activatedByUserId).toBe(adminId);

    const active = await pool.query(
      `SELECT count(*)::int AS n FROM facility_letterheads WHERE facility_id=$1 AND status='ACTIVE'`,
      [facilityA],
    );
    expect(active.rows[0].n).toBe(1);

    const second = await call(adminToken, 'POST', route(facilityA), {
      pdf: await syntheticLetterhead({ label: 'Replacement Letterhead' }),
      filename: 'letterhead-v2.pdf',
    });
    expect(second.status).toBe(201);
    expect(second.json.letterhead.version).toBe(2);

    const replaced = await call(
      adminToken,
      'POST',
      route(facilityA, `/${second.json.letterhead.id}/activate`),
      {
        body: {},
      },
    );
    expect(replaced.status).toBe(200);

    const rows = await pool.query(
      'SELECT version, status, retired_by, retire_reason FROM facility_letterheads WHERE facility_id=$1 ORDER BY version',
      [facilityA],
    );
    expect(rows.rows).toEqual([
      { version: 1, status: 'SUPERSEDED', retired_by: adminId, retire_reason: expect.any(String) },
      { version: 2, status: 'ACTIVE', retired_by: null, retire_reason: null },
    ]);

    /* The superseded version is still readable: reprints depend on it. */
    const history = await call(adminToken, 'GET', route(facilityA, `/${first.id}`));
    expect(history.status).toBe(200);
    expect(history.json.letterhead.status).toBe('SUPERSEDED');
    expect(history.json.letterhead.hasPdf).toBe(true);

    /* The full audit trail names both actors for both moves. */
    const events = await pool.query(
      'SELECT action, version, actor_user_id FROM facility_letterhead_events WHERE facility_id=$1 ORDER BY id',
      [facilityA],
    );
    expect(events.rows.map((row) => `${row.action}:${row.version}`)).toEqual([
      'UPLOADED:1',
      'ACTIVATED:1',
      'UPLOADED:2',
      'SUPERSEDED:1',
      'ACTIVATED:2',
    ]);
  });

  it('will not activate or adjust a version that is already active', async () => {
    const active = (
      await pool.query(
        `SELECT id FROM facility_letterheads WHERE facility_id=$1 AND status='ACTIVE'`,
        [facilityA],
      )
    ).rows[0];

    const again = await call(adminToken, 'POST', route(facilityA, `/${active.id}/activate`), {
      body: {},
    });
    expect(again.status).toBe(200);
    expect(again.json.letterhead.status).toBe('ACTIVE');

    const adjust = await call(adminToken, 'PATCH', route(facilityA, `/${active.id}`), {
      body: { bodyTopPt: 120 },
    });
    expect(adjust.status).toBe(409);
    expect(adjust.json.code).toBe('LETTERHEAD_IMMUTABLE');

    const superseded = (
      await pool.query(
        `SELECT id FROM facility_letterheads WHERE facility_id=$1 AND status='SUPERSEDED'`,
        [facilityA],
      )
    ).rows[0];
    const revive = await call(adminToken, 'POST', route(facilityA, `/${superseded.id}/activate`), {
      body: {},
    });
    expect(revive.status).toBe(409);
    expect(revive.json.code).toBe('LETTERHEAD_NOT_ACTIVATABLE');
  });

  it('adjusts the body rectangle of a draft and records that it was adjusted', async () => {
    const draft = await call(adminToken, 'POST', route(facilityA), {
      pdf: await syntheticLetterhead({ label: 'Adjusted' }),
      filename: 'adjusted.pdf',
    });
    expect(draft.status).toBe(201);

    const id = draft.json.letterhead.id as number;
    const adjusted = await call(adminToken, 'PATCH', route(facilityA, `/${id}`), {
      body: { bodyTopPt: 130, bodyBottomPt: 70, bodyLeftPt: 48, bodyRightPt: 48 },
    });
    expect(adjusted.status).toBe(200);
    expect(adjusted.json.letterhead.bodyTopPt).toBe(130);
    expect(adjusted.json.letterhead.bodyLeftPt).toBe(48);
    expect(adjusted.json.letterhead.layoutSource).toBe('ADJUSTED');

    const tooTall = await call(adminToken, 'PATCH', route(facilityA, `/${id}`), {
      body: { bodyTopPt: 500, bodyBottomPt: 400 },
    });
    expect(tooTall.status).toBe(400);
    expect(tooTall.json.code).toBe('LETTERHEAD_LAYOUT_INVALID');

    const negative = await call(adminToken, 'PATCH', route(facilityA, `/${id}`), {
      body: { bodyLeftPt: -5 },
    });
    expect(negative.status).toBe(400);
  });

  /* --------------------------------------------------------------- preview */

  it('serves the stored bytes only to an authorized session', async () => {
    const id = (
      await pool.query(
        `SELECT id FROM facility_letterheads WHERE facility_id=$1 AND status='ACTIVE'`,
        [facilityA],
      )
    ).rows[0].id as number;

    const file = await call(adminToken, 'GET', route(facilityA, `/${id}/file`));
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect(file.headers.get('cache-control')).toBe('private, no-store');
    expect(file.headers.get('content-disposition')).toContain('inline');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(file.bytes?.subarray(0, 5).toString()).toBe('%PDF-');

    const download = await call(adminToken, 'GET', `${route(facilityA, `/${id}/file`)}?download=1`);
    expect(download.headers.get('content-disposition')).toContain('attachment');

    const anonymous = await call(null, 'GET', route(facilityA, `/${id}/file`));
    expect(anonymous.status).toBe(401);

    const foreign = await call(foreignToken, 'GET', route(facilityA, `/${id}/file`));
    expect(foreign.status).toBe(404);

    /* Another facility in the SAME tenant cannot read it through this path. */
    const sibling = await call(otherFacilityToken, 'GET', route(facilityA, `/${id}/file`));
    expect(sibling.status).toBe(404);
  });

  /* ------------------------------------------------------------ isolation */

  it("hides another tenant's letterheads behind a not-found answer", async () => {
    const id = (
      await pool.query(
        `SELECT id FROM facility_letterheads WHERE facility_id=$1 AND status='ACTIVE'`,
        [facilityA],
      )
    ).rows[0].id as number;

    const list = await call(foreignToken, 'GET', route(facilityA));
    expect(list.status).toBe(404);

    const read = await call(foreignToken, 'GET', route(facilityA, `/${id}`));
    expect(read.status).toBe(404);

    const upload = await call(foreignToken, 'POST', route(facilityA), {
      pdf: await syntheticLetterhead({ label: 'Hostile upload' }),
      filename: 'hostile.pdf',
    });
    expect(upload.status).toBe(404);

    const activate = await call(foreignToken, 'POST', route(facilityA, `/${id}/activate`), {
      body: {},
    });
    expect(activate.status).toBe(404);

    const withdraw = await call(foreignToken, 'POST', route(facilityA, `/${id}/withdraw`), {
      body: { reason: 'Hostile withdraw' },
    });
    expect(withdraw.status).toBe(404);

    const stored = await pool.query('SELECT status FROM facility_letterheads WHERE id=$1', [id]);
    expect(stored.rows[0].status).toBe('ACTIVE');
  });

  /* ------------------------------------------------------------- withdraw */

  it('withdraws the active version and requires a reason', async () => {
    const id = (
      await pool.query(
        `SELECT id FROM facility_letterheads WHERE facility_id=$1 AND status='ACTIVE'`,
        [facilityA],
      )
    ).rows[0].id as number;

    const noReason = await call(adminToken, 'POST', route(facilityA, `/${id}/withdraw`), {
      body: { reason: ' ' },
    });
    expect(noReason.status).toBe(400);
    expect(noReason.json.code).toBe('LETTERHEAD_REASON_REQUIRED');

    const withdrawn = await call(adminToken, 'POST', route(facilityA, `/${id}/withdraw`), {
      body: { reason: 'Stationery withdrawn by administrator' },
    });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.json.letterhead.status).toBe('WITHDRAWN');
    expect(withdrawn.json.letterhead.retireReason).toBe('Stationery withdrawn by administrator');

    const active = await pool.query(
      `SELECT count(*)::int AS n FROM facility_letterheads WHERE facility_id=$1 AND status='ACTIVE'`,
      [facilityA],
    );
    expect(active.rows[0].n).toBe(0);

    /* The file of a withdrawn version is still readable for the record. */
    const file = await call(adminToken, 'GET', route(facilityA, `/${id}/file`));
    expect(file.status).toBe(200);
  });

  /* ------------------------------------------------------------- database */

  it('keeps the database invariants behind the service', async () => {
    const id = (
      await pool.query(
        'SELECT id FROM facility_letterheads WHERE facility_id=$1 ORDER BY version',
        [facilityA],
      )
    ).rows[0].id as number;

    await expect(pool.query('DELETE FROM facility_letterheads WHERE id=$1', [id])).rejects.toThrow(
      /retained for reprint fidelity/i,
    );

    await expect(
      pool.query('UPDATE facility_letterheads SET source_pdf=$1 WHERE id=$2', [
        Buffer.from('%PDF-1.4 forged'),
        id,
      ]),
    ).rejects.toThrow(/immutable/i);

    await expect(
      pool.query('UPDATE facility_letterhead_events SET reason=$1 WHERE letterhead_id=$2', [
        'rewritten',
        id,
      ]),
    ).rejects.toThrow(/append-only/i);
  });
});

/**
 * The service-level resolver is what document rendering calls. It is tested
 * separately because the HTTP surface never exposes a "current letterhead"
 * shortcut: reading branding for a document is not the same permission as
 * managing it.
 */
describeDb('Letterhead resolution for document rendering', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, facility: number, otherFacility: number, userId: number;

  beforeAll(async () => {
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Resolve ${suffix}`,
        `resolve-${suffix}`,
      ])
    ).rows[0].id as number;
    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,mfl_code,address,county,phone,enabled_modules)
       VALUES($1,$2,'Resolve Hospital',$3,'Resolve Road','Nyeri','0000000000','["finance"]'),
             ($1,$4,'Resolve Annex',$5,'Resolve Road','Nyeri','0000000001','["finance"]')
       RETURNING id`,
      [tenant, `RS-${suffix}`, `MFL-RS-${suffix}`, `RSA-${suffix}`, `MFL-RSA-${suffix}`],
    );
    facility = facilities.rows[0].id as number;
    otherFacility = facilities.rows[1].id as number;
    userId = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic resolver','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`resolve-${suffix}`, `resolve-${suffix}@example.test`, tenant, facility],
      )
    ).rows[0].id as number;
  });

  it('returns null when a facility has no active letterhead', async () => {
    const service = await import('../../branding/letterhead.service.ts');
    expect(await service.resolveActiveLetterhead(tenant, otherFacility)).toBeNull();
    expect(await service.activeLetterheadIdFor(tenant, otherFacility)).toBeNull();
  });

  it('resolves the active version, and a retired version by id for reprints', async () => {
    const service = await import('../../branding/letterhead.service.ts');
    const firstBytes = await syntheticLetterhead({ label: 'Resolved' });
    const secondBytes = await syntheticLetterhead({ label: 'Resolved v2' });

    const insert = async (version: number, status: string, bytes: Buffer) => {
      const retired = status === 'SUPERSEDED';
      return pool.query(
        `INSERT INTO facility_letterheads(tenant_id,facility_id,version,status,source_pdf,
           source_pdf_sha256,source_pdf_bytes,source_pdf_pages,page_width_pt,page_height_pt,
           body_top_pt,body_bottom_pt,body_left_pt,body_right_pt,layout_source,checksum,created_by,
           activated_by,activated_at,retired_by,retired_at,retire_reason)
         VALUES($1,$2,$3,$4,$5,$6,$7,1,595.28,841.89,108,78,40,40,'MEASURED',$8,$9,$9,now(),
                $10,$11,$12)
         RETURNING id`,
        [
          tenant,
          facility,
          version,
          status,
          bytes,
          service.sha256Hex(bytes),
          bytes.length,
          service.sha256Hex(bytes),
          userId,
          retired ? userId : null,
          retired ? new Date() : null,
          retired ? 'Replaced by version 2' : null,
        ],
      );
    };

    const first = await insert(1, 'SUPERSEDED', firstBytes);
    const second = await insert(2, 'ACTIVE', secondBytes);

    const active = await service.resolveActiveLetterhead(tenant, facility);
    expect(active?.id).toBe(second.rows[0].id);
    expect(active?.version).toBe(2);
    expect(active?.bodyTopPt).toBe(108);
    expect(await service.activeLetterheadIdFor(tenant, facility)).toBe(second.rows[0].id);

    const historical = await service.resolveLetterheadVersion(tenant, facility, first.rows[0].id);
    expect(historical?.status).toBe('SUPERSEDED');
    expect(historical?.bytes?.subarray(0, 5).toString()).toBe('%PDF-');

    /* Another tenant cannot resolve it even with the right id and facility. */
    expect(
      await service.resolveLetterheadVersion(tenant + 9999, facility, first.rows[0].id),
    ).toBeNull();
  });
});
