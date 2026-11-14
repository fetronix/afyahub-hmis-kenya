import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Facility tariff audit history (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  let tenant: number,
    facility: number,
    other: number,
    actor: number,
    tariffId: number,
    serviceId: number;
  let token: string,
    otherToken: string,
    noRoleToken: string,
    noPermissionToken: string,
    foreignToken: string,
    platformToken: string,
    base: string,
    close: () => Promise<void>;
  const call = (method: string, path: string, body?: Record<string, unknown>, session = token) =>
    httpJson(base, method, path, { token: session, body });
  const history = (id: number, target = facility, session = token, beforeId?: string) =>
    call(
      'GET',
      `/api/facility-tariffs/${id}/history?facilityId=${target}${beforeId === undefined ? '' : `&beforeId=${beforeId}`}`,
      undefined,
      session,
    );
  beforeAll(async () => {
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic history tenant',
        `p3-history-${suffix}`,
      ])
    ).rows[0].id;
    [facility, other] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic facility A',$4::jsonb),($1,$3,'Synthetic facility B',$4::jsonb) RETURNING id`,
        [tenant, `P3A-${suffix}`, `P3B-${suffix}`, JSON.stringify(['finance'])],
      )
    ).rows.map((r) => r.id);
    const users = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic A','test-only','ACTIVE',$7,$8),($3,$3,$4,'Synthetic B','test-only','ACTIVE',$7,$9),($5,$5,$6,'Synthetic clerk','test-only','ACTIVE',$7,$8) RETURNING id`,
        [
          `p3a-${suffix}`,
          `p3a-${suffix}@example.test`,
          `p3b-${suffix}`,
          `p3b-${suffix}@example.test`,
          `p3c-${suffix}`,
          `p3c-${suffix}@example.test`,
          tenant,
          facility,
          other,
        ],
      )
    ).rows.map((r) => r.id);
    actor = users[0];
    const admin = (
      await pool.query(
        "INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) RETURNING id",
        [tenant],
      )
    ).rows[0].id;
    const clerk = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, `CLERK_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$4),($2,$4),($3,$5)', [
      ...users,
      admin,
      clerk,
    ]);
    for (const permission of ['tariffs.read', 'tariffs.manage']) {
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
        [permission],
      );
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [admin, permission],
      );
    }
    await pool.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code='tariffs.read'",
      [clerk],
    );
    token = (await createSession({ userId: users[0], securityVersion: 1 })).sessionToken;
    otherToken = (await createSession({ userId: users[1], securityVersion: 1 })).sessionToken;
    noRoleToken = (await createSession({ userId: users[2], securityVersion: 1 })).sessionToken;
    const unprivileged = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic unprivileged','test-only','ACTIVE',$3,$4) RETURNING id",
        [`p3np-${suffix}`, `p3np-${suffix}@example.test`, tenant, facility],
      )
    ).rows[0].id;
    noPermissionToken = (await createSession({ userId: unprivileged, securityVersion: 1 }))
      .sessionToken;
    const foreignTenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic foreign tenant',
        `p3foreign-${suffix}`,
      ])
    ).rows[0].id;
    const foreignFacility = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic foreign facility',$3::jsonb) RETURNING id",
        [foreignTenant, `P3X-${suffix}`, JSON.stringify(['finance'])],
      )
    ).rows[0].id;
    const foreignActor = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic foreign admin','test-only','ACTIVE',$3,$4) RETURNING id",
        [`p3x-${suffix}`, `p3x-${suffix}@example.test`, foreignTenant, foreignFacility],
      )
    ).rows[0].id;
    const foreignRole = (
      await pool.query(
        "INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) RETURNING id",
        [foreignTenant],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
      foreignActor,
      foreignRole,
    ]);
    await pool.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code='tariffs.read'",
      [foreignRole],
    );
    foreignToken = (await createSession({ userId: foreignActor, securityVersion: 1 })).sessionToken;
    const superRoleResult = await pool.query(
      "SELECT id FROM roles WHERE tenant_id IS NULL AND name='SUPER_ADMIN' AND is_active=true LIMIT 1",
    );
    const superRole =
      superRoleResult.rows[0]?.id ??
      (
        await pool.query(
          "INSERT INTO roles(tenant_id,name,is_active) VALUES(NULL,'SUPER_ADMIN',true) RETURNING id",
        )
      ).rows[0].id;
    const platformActor = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic platform','test-only','ACTIVE',NULL,NULL) RETURNING id",
        [`p3s-${suffix}`, `p3s-${suffix}@example.test`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
      platformActor,
      superRole,
    ]);
    platformToken = (await createSession({ userId: platformActor, securityVersion: 1 }))
      .sessionToken;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
    const created = await call('POST', '/api/facility-services', {
      facilityId: facility,
      code: `P3-${suffix}`,
      name: 'Synthetic service',
      description: 'Synthetic service',
      department: 'finance',
      category: 'OTHER',
      unit: 'Service',
      isActive: true,
      autoBill: true,
    });
    expect(created.status).toBe(201);
    tariffId = created.body.tariff.id;
    serviceId = created.body.service.id;
    const edit = await call('PUT', `/api/facility-tariffs/${tariffId}`, {
      facilityId: facility,
      serviceId,
      expectedRevision: created.body.tariff.revision,
      code: created.body.tariff.code,
      description: 'Synthetic revised service',
      department: 'finance',
      unit: 'Service',
      fee: '456.00',
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      isActive: true,
      autoBill: true,
    });
    expect(edit.status).toBe(200);
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('returns recorded old/new prices, validity and staff, and audits the history read', async () => {
    const response = await history(tariffId);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.body.coverage).toBe('RECORDED_EVENTS_ONLY');
    expect(response.body.timestampTimezone).toBe('NOT_RECORDED');
    expect(response.body.nextCursor).toBeNull();
    const edit = response.body.events.find(
      (event: { action: string }) => event.action === 'UPDATE',
    );
    expect(edit).toMatchObject({
      actorUserId: String(actor),
      before: { fee: '0.00' },
      after: { fee: '456.00', effectiveFrom: '2020-01-01', effectiveTo: null },
    });
    expect(edit.recordedTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    const created = response.body.events.find(
      (event: { action: string }) => event.action === 'CREATE',
    );
    expect(created.after.fee).toBe('0.00');
    const count = (
      await pool.query(
        "SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND resource='FACILITY_SERVICE_TARIFF_HISTORY' AND resource_id=$3 AND action='VIEW' AND user_id=$4",
        [tenant, facility, String(tariffId), String(actor)],
      )
    ).rows[0].n;
    expect(count).toBe(1);
  });

  it('requires authentication, tariff permission, facility-admin role and exact facility', async () => {
    const unauthenticated = await httpJson(
      base,
      'GET',
      `/api/facility-tariffs/${tariffId}/history?facilityId=${facility}`,
    );
    expect(unauthenticated.status).toBe(401);
    expect((await history(tariffId, facility, noRoleToken)).status).toBe(403);
    expect((await history(tariffId, facility, noPermissionToken)).status).toBe(403);
    expect([403, 404]).toContain((await history(tariffId, facility, foreignToken)).status);
    expect((await history(tariffId, facility, platformToken)).status).toBe(403);
    expect([403, 404]).toContain((await history(tariffId, facility, otherToken)).status);
    expect((await history(tariffId, other, otherToken)).status).toBe(404);
    expect((await history(tariffId, facility, token, '-1')).status).toBe(400);
    expect((await history(tariffId, facility, token, '1.5')).status).toBe(400);
  });

  it('keeps master-only tariffs hidden and never returns arbitrary legacy audit text or another facility event', async () => {
    const master = (
      await pool.query(
        'SELECT id FROM master_services WHERE tenant_id IS NULL AND origin_facility_id IS NULL ORDER BY id LIMIT 1',
      )
    ).rows[0].id;
    const historical = (
      await pool.query(
        `INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee,master_service_id,is_active,auto_bill) VALUES($1,$2,$3,'Synthetic legacy','finance','Service',1,$4,false,false) RETURNING id`,
        [tenant, facility, `P3LEGACY-${suffix}`, master],
      )
    ).rows[0].id;
    expect((await history(historical)).status).toBe(404);
    await pool.query(
      `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details) VALUES
      ($1,$2,$4,'UPDATE','FACILITY_SERVICE_TARIFF',$5,$6),
      ($1,$3,$4,'UPDATE','FACILITY_SERVICE_TARIFF',$5,$7)`,
      [
        tenant,
        facility,
        other,
        String(actor),
        String(tariffId),
        JSON.stringify({
          before: { fee: 'bad', secret: 'synthetic-canary' },
          after: { fee: '200.00', secret: 'synthetic-canary' },
          arbitrary: 'synthetic-canary',
        }),
        JSON.stringify({ after: { fee: '999.99' } }),
      ],
    );
    const result = await history(tariffId);
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toContain('synthetic-canary');
    expect(JSON.stringify(result.body)).not.toContain('999.99');
    expect(result.body.events[0]).toMatchObject({ before: null, after: { fee: '200.00' } });
  });

  it('paginates recorded events without duplicates or cross-facility records', async () => {
    await pool.query(
      `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details)
      SELECT $1,$2,$3,'UPDATE','FACILITY_SERVICE_TARIFF',$4,'{}' FROM generate_series(1,53)`,
      [tenant, facility, String(actor), String(tariffId)],
    );
    const all: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await history(tariffId, facility, token, cursor);
      expect(page.status).toBe(200);
      expect(page.body.events.length).toBeLessThanOrEqual(25);
      all.push(...page.body.events.map((event: { id: number }) => event.id));
      cursor = page.body.nextCursor === null ? undefined : String(page.body.nextCursor);
    } while (cursor);
    expect(all.length).toBeGreaterThanOrEqual(55);
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((id, index) => index === 0 || all[index - 1] > id)).toBe(true);
  });

  it('fails closed if the access-audit insert fails and leaves tariff values unchanged', async () => {
    const fn = `p3_history_audit_${suffix}`,
      trigger = `p3_history_trigger_${suffix}`;
    const before = (
      await pool.query(
        'SELECT fee::text,revision FROM facility_service_tariffs WHERE id=$1 AND tenant_id=$2 AND facility_id=$3',
        [tariffId, tenant, facility],
      )
    ).rows[0];
    await pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.facility_id=${facility} AND NEW.resource='FACILITY_SERVICE_TARIFF_HISTORY' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    try {
      const result = await history(tariffId);
      expect(result.status).toBe(500);
      expect(result.body.events).toBeUndefined();
      expect(
        (
          await pool.query(
            'SELECT fee::text,revision FROM facility_service_tariffs WHERE id=$1 AND tenant_id=$2 AND facility_id=$3',
            [tariffId, tenant, facility],
          )
        ).rows[0],
      ).toEqual(before);
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${fn}()`);
    }
  });
});
