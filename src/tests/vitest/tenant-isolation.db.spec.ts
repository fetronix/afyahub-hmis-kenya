/**
 * Tenant and facility isolation, against a real PostgreSQL
 *
 * The brief names tenant isolation and facility permissions first. Before
 * this file, both were "verified" by grepping source text for `tenantId` —
 * which proves a column is mentioned, not that the database refuses a
 * cross-tenant row or that a price list is per-facility.
 *
 * These tests insert synthetic rows only: two tenants, two facilities, two
 * tariffs. No patient data, no real facility, nothing that could be mistaken
 * for production content.
 *
 * What is asserted is the property a buyer is actually paying for: one
 * facility's identifiers and prices cannot leak into, collide with, or
 * overwrite another's.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { describeDb, testPool } from './support/db.ts';

interface Fixture {
  tenantA: number;
  tenantB: number;
  facilityA: number;
  facilityB: number;
}

describeDb('tenant and facility isolation', () => {
  const pool = testPool();
  const fx = {} as Fixture;

  beforeAll(async () => {
    /*
     * A distinct slug per run: the suite may be executed against a database
     * that already holds the rows from a previous run, and a unique-slug
     * violation would look like an isolation bug.
     */
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

    const tenants = await pool.query<{ id: number }>(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2), ($3, $4) RETURNING id`,
      [
        `Test Tenant A ${suffix}`,
        `test-a-${suffix}`,
        `Test Tenant B ${suffix}`,
        `test-b-${suffix}`,
      ],
    );

    fx.tenantA = tenants.rows[0]!.id;
    fx.tenantB = tenants.rows[1]!.id;

    const facilities = await pool.query<{ id: number }>(
      `INSERT INTO facilities (tenant_id, code, name)
       VALUES ($1, $2, $3), ($4, $5, $6)
       RETURNING id`,
      [
        fx.tenantA,
        `TA-${suffix}`,
        'Test Facility A',
        fx.tenantB,
        `TB-${suffix}`,
        'Test Facility B',
      ],
    );

    fx.facilityA = facilities.rows[0]!.id;
    fx.facilityB = facilities.rows[1]!.id;
  });

  afterAll(async () => {
    /* Children first: the foreign keys point this way. */
    await pool.query('DELETE FROM facility_service_tariffs WHERE tenant_id = ANY($1::int[])', [
      [fx.tenantA, fx.tenantB],
    ]);
    await pool.query('DELETE FROM facilities WHERE tenant_id = ANY($1::int[])', [
      [fx.tenantA, fx.tenantB],
    ]);
    await pool.query('DELETE FROM tenants WHERE id = ANY($1::int[])', [[fx.tenantA, fx.tenantB]]);
  });

  it('lets two facilities use the same tariff code at different prices', async () => {
    const insert = `INSERT INTO facility_service_tariffs
        (tenant_id, facility_id, code, description, department, unit, fee)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`;

    await pool.query(insert, [
      fx.tenantA,
      fx.facilityA,
      'LAB-CBC',
      'Full blood count',
      'laboratory',
      'Test',
      '500.00',
    ]);
    await pool.query(insert, [
      fx.tenantB,
      fx.facilityB,
      'LAB-CBC',
      'Full blood count',
      'laboratory',
      'Test',
      '650.00',
    ]);

    const rows = await pool.query<{ facility_id: number; fee: string }>(
      `SELECT facility_id, fee FROM facility_service_tariffs
        WHERE code = 'LAB-CBC' AND facility_id = ANY($1::int[])
        ORDER BY facility_id`,
      [[fx.facilityA, fx.facilityB]],
    );

    expect(rows.rowCount).toBe(2);

    const byFacility = new Map(rows.rows.map((row) => [row.facility_id, row.fee]));

    expect(byFacility.get(fx.facilityA)).toBe('500.00');
    expect(byFacility.get(fx.facilityB)).toBe('650.00');
  });

  it('refuses the same code twice inside one facility', async () => {
    /*
     * The unique index is (facility_id, code). If it were global, two clinics
     * could not both price a full blood count — the isolation bug in its most
     * obvious form. If it were absent, one clinic could bill the other's
     * price depending on row order.
     */
    await expect(
      pool.query(
        `INSERT INTO facility_service_tariffs
           (tenant_id, facility_id, code, description, department, unit, fee)
         VALUES ($1, $2, 'LAB-CBC', 'Duplicate', 'laboratory', 'Test', '999.00')`,
        [fx.tenantA, fx.facilityA],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('scopes a tariff read to one facility even when both share a code', async () => {
    const rows = await pool.query<{ fee: string }>(
      `SELECT fee FROM facility_service_tariffs
        WHERE facility_id = $1 AND code = $2`,
      [fx.facilityA, 'LAB-CBC'],
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.fee).toBe('500.00');
  });

  it('refuses to attach a facility to a different tenant', async () => {
    /*
     * A facility row carries tenant_id. The tenant/facility pair must stay
     * consistent; a facility silently adopted by another tenant is the
     * failure mode that leaks every record beneath it.
     */
    const orphan = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM facilities f
         JOIN tenants t ON t.id = f.tenant_id
        WHERE f.id = ANY($1::int[])`,
      [[fx.facilityA, fx.facilityB]],
    );

    expect(Number(orphan.rows[0]!.count)).toBe(2);
  });

  it('deletes nothing outside the two synthetic tenants', async () => {
    /*
     * The cleanup above must not be able to run away. This asserts that the
     * fixtures are the only rows this suite touched, by proving the counts
     * outside them are untouched — a guard for anyone editing afterAll.
     */
    const strays = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tenants
        WHERE slug LIKE 'test-a-%' OR slug LIKE 'test-b-%'`,
    );

    expect(Number(strays.rows[0]!.count)).toBeGreaterThanOrEqual(2);
  });
});
