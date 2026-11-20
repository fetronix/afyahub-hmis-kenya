/** Additive synthetic fixtures shared by PostgreSQL and real-browser acceptance; never production. */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { hashPassword } from '../../../utils/password.ts';
import { createSession } from '../../../auth/session.service.ts';

export async function assertReportingScratch(pool: Pool) {
  if (
    process.env.SQL_HOST !== '127.0.0.1' ||
    process.env.SQL_DB_NAME !== 'reporting_programme_synthetic_test' ||
    !/^\d{1,20}$/.test(process.env.SYRONA_TEST_PG_SYSTEM_IDENTIFIER ?? '') ||
    !process.env.REPORTING_TEST_PG_DATA_DIRECTORY
  )
    throw Error('Explicit independently attested disposable reporting cluster required');
  const row = (
    await pool.query(
      "SELECT current_database() AS db, inet_server_addr()::text AS address, system_identifier::text AS cluster, current_setting('data_directory') AS directory FROM pg_control_system()",
    )
  ).rows[0];
  if (
    row.db !== process.env.SQL_DB_NAME ||
    (row.address !== '127.0.0.1/32' && row.address !== '127.0.0.1') ||
    row.cluster !== process.env.SYRONA_TEST_PG_SYSTEM_IDENTIFIER ||
    row.directory !== process.env.REPORTING_TEST_PG_DATA_DIRECTORY
  )
    throw Error('Disposable reporting cluster identity mismatch');
}
export async function createReportingMovementsFixture(pool: Pool) {
  await assertReportingScratch(pool);
  const suffix = randomUUID().slice(0, 8),
    password = randomBytes(32).toString('base64url');
  const tenant = (
    await pool.query(
      "INSERT INTO tenants(name,slug,currency) VALUES('Synthetic reporting programme',$1,'KES') RETURNING id",
      ['reporting-' + suffix],
    )
  ).rows[0].id as number;
  const foreignTenant = (
    await pool.query(
      "INSERT INTO tenants(name,slug,currency) VALUES('Synthetic foreign reporting tenant',$1,'KES') RETURNING id",
      ['reporting-foreign-' + suffix],
    )
  ).rows[0].id as number;
  const facilities = [] as number[];
  for (const [t, label] of [
    [tenant, 'Main'],
    [tenant, 'Sibling'],
    [foreignTenant, 'Foreign'],
  ] as const)
    facilities.push(
      (
        await pool.query(
          'INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,$3,\'["analytics","inventory"]\') RETURNING id',
          [t, `RP-${label}-${suffix}`, `Synthetic Reporting ${label}`],
        )
      ).rows[0].id,
    );
  const [facility, sibling, foreignFacility] = facilities;
  const permissions = [
    'reports.read',
    'reports.export',
    'inventory.read',
    'facility.branding.read',
    'facility.branding.manage',
  ];
  for (const code of permissions)
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES($1,$1,'reporting_synthetic') ON CONFLICT(code) DO NOTHING",
      [code],
    );
  const hash = await hashPassword(password);
  async function user(label: string, codes: string[], f = facility, t = tenant) {
    const username = `reporting_${label}_${suffix}`;
    const id = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id,account_status) VALUES($1,$1,$2,'Synthetic reporting reviewer',$3,$4,$5,'ACTIVE') RETURNING id",
        [username, username + '@example.test', hash, t, f],
      )
    ).rows[0].id as number;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [t, `REPORTING_${label}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=ANY($2::text[])',
      [role, codes],
    );
    return {
      id,
      username,
      token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken,
    };
  }
  const full = await user('full', permissions),
    noDomain = await user('reports_only', ['reports.read', 'reports.export']),
    noExport = await user('no_export', ['reports.read', 'inventory.read']),
    foreign = await user('foreign', permissions, foreignFacility, foreignTenant);
  const items = [] as number[];
  for (const [f, label, unit] of [
    [facility, 'Alpha', 'Pieces'],
    [facility, 'Beta', 'mL'],
    [sibling, 'Sibling Secret', 'Pieces'],
    [foreignFacility, 'Foreign Secret', 'Pieces'],
  ] as const)
    items.push(
      (
        await pool.query(
          'INSERT INTO inventory_items(facility_id,item_code,name,unit,current_stock) VALUES($1,$2,$3,$4,999) RETURNING id',
          [f, `RP-${label}-${suffix}`, `Synthetic ${label}`, unit],
        )
      ).rows[0].id,
    );
  const [itemA, itemB, siblingItem, foreignItem] = items;
  const inserted = [] as number[];
  async function movement(
    f: number,
    t: number,
    item: number,
    type: string,
    delta: number,
    stock: number,
    date: string,
    reference: string,
  ) {
    const id = (
      await pool.query(
        "INSERT INTO inventory_movements(tenant_id,facility_id,item_id,movement_type,quantity_delta,stock_after,movement_date,actor_name,reference_type,reference_id,store_from,store_to) VALUES($1,$2,$3,$4,$5,$6,$7,'Synthetic recorder','SYNTHETIC_ACCEPTANCE',$8,NULL,'Synthetic Main') RETURNING id",
        [t, f, item, type, delta, stock, date, reference + '-' + suffix],
      )
    ).rows[0].id as number;
    inserted.push(id);
    return id;
  }
  // A: +10 -3 = 7; B: +100 -20 = 80. Different units must never be combined into 87.
  await movement(facility, tenant, itemA, 'RECEIPT', 10, 10, '2026-01-01', 'literal_%_alpha-start');
  await movement(facility, tenant, itemA, 'DISPENSE', -3, 7, '2026-01-31', 'alpha-end');
  await movement(facility, tenant, itemB, 'RECEIPT', 100, 100, '2026-01-15', 'beta-receipt');
  await movement(facility, tenant, itemB, 'WRITE_OFF', -20, 80, '2026-01-15', 'beta-loss');
  await movement(facility, tenant, itemA, 'RECEIPT', 5, 12, '2025-12-31', 'before-range');
  await movement(facility, tenant, itemA, 'RECEIPT', 2, 14, '2026-02-01', 'after-range');
  await movement(sibling, tenant, siblingItem, 'RECEIPT', 600, 600, '2026-01-15', 'sibling-secret');
  await movement(
    foreignFacility,
    foreignTenant,
    foreignItem,
    'RECEIPT',
    900,
    900,
    '2026-01-15',
    'foreign-secret',
  );
  // Legacy inconsistent item scope is flagged, not joined into cross-facility metadata.
  const mismatched = await movement(
    facility,
    tenant,
    siblingItem,
    'ADJUSTMENT',
    1,
    1,
    '2026-01-20',
    'mismatched-item',
  );
  return {
    tenant,
    foreignTenant,
    facility,
    sibling,
    foreignFacility,
    itemA,
    itemB,
    siblingItem,
    foreignItem,
    full,
    noDomain,
    noExport,
    foreign,
    password,
    suffix,
    mismatched,
    inserted,
    filters: { facilityId: facility, from: '2026-01-01', to: '2026-01-31' },
  };
}
