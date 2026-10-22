import { pool } from '../src/db/index.ts';

try {
  const result = await pool.query(`
    SELECT
      t.id AS tenant_id,
      t.name AS tenant_name,
      r.id AS role_id,
      r.name AS role_name,
      r.is_active,
      COALESCE(
        string_agg(p.code, ', ' ORDER BY p.code),
        '(no permissions)'
      ) AS permission_codes
    FROM tenants t
    JOIN roles r ON r.tenant_id = t.id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE t.id IN (5, 6, 7, 8)
    GROUP BY t.id, t.name, r.id, r.name, r.is_active
    ORDER BY t.id, r.name;
  `);

  console.table(result.rows);
} finally {
  await pool.end();
}
