import { sql } from 'drizzle-orm';
import type { db } from '../db/index.ts';

export type FacilityDeleteTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ParentTable = 'facility_services' | 'facility_service_tariffs';
type ForeignKey = {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  child_columns: string[];
  parent_columns: string[];
  row_security: boolean;
};

/**
 * Refuse deletion if ANY foreign key references the locked records, including
 * ON DELETE SET NULL or CASCADE references that PostgreSQL would otherwise
 * mutate automatically. Discover constraints instead of hard-coding payer or
 * clinical tables so future database relationships are protected too.
 *
 * Callers must hold FOR UPDATE locks on every parent row until commit. FK
 * inserts/updates take a conflicting key-share lock, so the check and delete
 * cannot race a newly created reference. The one excluded relationship is the
 * service's own tariffs: callers lock, check and delete those explicitly.
 */
export async function hasProtectedReferences(
  tx: FacilityDeleteTransaction,
  parentTable: ParentTable,
  ids: number[],
): Promise<boolean> {
  if (!ids.length) return false;
  const metadata = await tx.execute<ForeignKey>(sql`
    SELECT ns.nspname AS schema_name, child.relname AS table_name,
      con.conname AS constraint_name, child.relrowsecurity AS row_security,
      array_agg(child_column.attname::text ORDER BY key.ordinality) AS child_columns,
      array_agg(parent_column.attname::text ORDER BY key.ordinality) AS parent_columns
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    CROSS JOIN LATERAL unnest(con.conkey, con.confkey)
      WITH ORDINALITY AS key(child_num, parent_num, ordinality)
    JOIN pg_attribute child_column ON child_column.attrelid = con.conrelid AND child_column.attnum = key.child_num
    JOIN pg_attribute parent_column ON parent_column.attrelid = con.confrelid AND parent_column.attnum = key.parent_num
    WHERE con.contype = 'f' AND con.confrelid = to_regclass(${`public.${parentTable}`})
    GROUP BY ns.nspname, child.relname, child.relrowsecurity, con.conname
    ORDER BY ns.nspname, child.relname, con.conname
  `);
  const expected =
    parentTable === 'facility_services'
      ? 'facility_tariff_service_scope_fk'
      : 'billing_items_tariff_id_facility_service_tariffs_id_fk';
  const expectedChild =
    parentTable === 'facility_services' ? 'facility_service_tariffs' : 'billing_items';
  if (
    !metadata.rows.some(
      (row) =>
        row.schema_name === 'public' &&
        row.table_name === expectedChild &&
        row.constraint_name === expected,
    )
  )
    throw new Error('Cannot verify deletion dependencies: expected foreign key is missing.');

  const references = metadata.rows.filter(
    (row) =>
      !(
        parentTable === 'facility_services' &&
        row.schema_name === 'public' &&
        row.table_name === 'facility_service_tariffs' &&
        row.constraint_name === 'facility_tariff_service_scope_fk'
      ),
  );
  // RLS could hide a reference even though FK actions can still mutate it.
  // Fail closed until the database has a verified privileged check.
  if (references.some((row) => row.row_security))
    throw new Error('Cannot safely check deletion dependencies while row security is enabled.');
  if (!references.length) return false;

  const checks = references.map((ref) => {
    if (!ref.child_columns.length || ref.child_columns.length !== ref.parent_columns.length)
      throw new Error('Cannot verify an incomplete foreign key definition.');
    const conditions = ref.child_columns.map(
      (column, index) =>
        sql`dependent.${sql.identifier(column)} = target.${sql.identifier(ref.parent_columns[index])}`,
    );
    return sql`SELECT 1 FROM ${sql.identifier(ref.schema_name)}.${sql.identifier(ref.table_name)} AS dependent
      INNER JOIN target_rows AS target ON ${sql.join(conditions, sql` AND `)}`;
  });
  const result = await tx.execute<{ referenced: boolean }>(sql`
    WITH target_rows AS (
      SELECT * FROM ${sql.identifier('public')}.${sql.identifier(parentTable)}
      WHERE id = ANY(${sql.param(ids)}::integer[])
    )
    SELECT EXISTS (${sql.join(checks, sql` UNION ALL `)}) AS referenced
  `);
  if (typeof result.rows[0]?.referenced !== 'boolean')
    throw new Error('Cannot verify deletion dependencies: no result was returned.');
  return result.rows[0].referenced;
}

/** Some legacy clinical sources carry an exact facility service code rather
 * than a foreign key. Preserve those identities too; no descriptions or
 * specimen names are used to infer a match. */
export async function hasCodeBasedClinicalHistory(
  tx: FacilityDeleteTransaction,
  service: { tenantId: number; facilityId: number; category: string; code: string },
): Promise<boolean> {
  const { tenantId, facilityId, code } = service;
  let source;
  let tables: string[];
  switch (service.category) {
    case 'LABORATORY':
      tables = ['lab_orders', 'lab_tests'];
      source = sql`SELECT 1 FROM lab_orders o JOIN lab_tests t ON t.id = o.test_id
        WHERE o.tenant_id = ${tenantId} AND o.facility_id = ${facilityId}
          AND t.facility_id = ${facilityId} AND upper(trim(t.code)) = upper(trim(${code}))`;
      break;
    case 'PHARMACY':
      tables = ['pharmacy_dispensations', 'inventory_items'];
      source = sql`SELECT 1 FROM pharmacy_dispensations d JOIN inventory_items i ON i.id = d.item_id
        WHERE d.tenant_id = ${tenantId} AND d.facility_id = ${facilityId}
          AND i.facility_id = ${facilityId} AND upper(trim(i.item_code)) = upper(trim(${code}))`;
      break;
    case 'PROCEDURE':
      tables = ['procedures', 'encounters'];
      source = sql`SELECT 1 FROM procedures p JOIN encounters e ON e.id = p.encounter_id
        WHERE e.tenant_id = ${tenantId} AND e.facility_id = ${facilityId}
          AND upper(trim(p.procedure_code)) = upper(trim(${code}))`;
      break;
    case 'BED_DAY':
      tables = ['wards', 'admissions', 'admission_transfers'];
      source = sql`SELECT 1 FROM wards w WHERE w.facility_id = ${facilityId}
        AND upper(trim(w.code)) = upper(trim(${code}))
        AND (EXISTS (SELECT 1 FROM admissions a WHERE a.tenant_id = ${tenantId} AND a.facility_id = ${facilityId} AND a.ward_id = w.id)
          OR EXISTS (SELECT 1 FROM admission_transfers x WHERE x.tenant_id = ${tenantId} AND x.facility_id = ${facilityId} AND (x.from_ward_id = w.id OR x.to_ward_id = w.id)))`;
      break;
    default:
      return false;
  }
  // As with foreign-key checks, restricted row visibility must not be
  // mistaken for absence of historical references.
  const visibility = await tx.execute<{ table_count: number; has_rls: boolean | null }>(sql`
    SELECT count(*)::integer AS table_count, bool_or(child.relrowsecurity) AS has_rls
    FROM pg_class child JOIN pg_namespace ns ON ns.oid = child.relnamespace
    WHERE ns.nspname = 'public' AND child.relname = ANY(${sql.param(tables)}::text[])
  `);
  if (visibility.rows[0]?.table_count !== tables.length || visibility.rows[0]?.has_rls !== false)
    throw new Error('Cannot safely check code-based clinical history.');
  const result = await tx.execute<{ referenced: boolean }>(
    sql`SELECT EXISTS (${source}) AS referenced`,
  );
  if (typeof result.rows[0]?.referenced !== 'boolean')
    throw new Error('Cannot verify code-based clinical dependencies.');
  return result.rows[0].referenced;
}
