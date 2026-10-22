SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    r.id AS role_id,
    r.name AS role_name,
    r."isActive" AS is_active,
    COALESCE(
        string_agg(p.code, ', ' ORDER BY p.code),
        '(no permissions)'
    ) AS permission_codes
FROM tenants t
JOIN roles r ON r."tenantId" = t.id
LEFT JOIN role_permissions rp ON rp."roleId" = r.id
LEFT JOIN permissions p ON p.id = rp."permissionId"
WHERE t.id IN (5, 6, 7, 8)
GROUP BY t.id, t.name, r.id, r.name, r."isActive"
ORDER BY t.id, r.name;
