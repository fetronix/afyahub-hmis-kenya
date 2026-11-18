/**
 * Build the permissions matrix from the sources that actually decide access:
 *
 *   - `src/seeds/permissions.ts` — the permission catalogue (code, module, label)
 *   - `src/auth/staff-role-catalogue.ts` — what each staff role is granted
 *   - `src/routes/platform/tenants.routes.ts` — the facility-admin delegation set
 *   - `src/components/Sidebar.tsx` — which permission opens each navigation module
 *   - `docs/evidence/API_ROUTE_INVENTORY.json` — which routes require each code
 *
 * The cross-checks at the end are the point of the exercise: a permission that
 * no role holds, a role that names a permission that does not exist, and a
 * navigation module that no permission can open are all defects that a static
 * matrix would hide.
 *
 *   npx tsx scripts/docs/build-permissions-matrix.ts
 *
 * Outputs:
 *   docs/evidence/PERMISSIONS_MATRIX.json
 *   docs/05-administration/PERMISSIONS_MATRIX.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const EVIDENCE = join(ROOT, 'docs', 'evidence', 'PERMISSIONS_MATRIX.json');
const MD = join(ROOT, 'docs', '05-administration', 'PERMISSIONS_MATRIX.md');

const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Balanced [] or {} from an opening index. */
function balanced(source: string, open: number, openChar: string, closeChar: string): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === openChar) depth++;
    if (char === closeChar) {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

const blockAfter = (source: string, marker: string, openChar: string, closeChar: string) => {
  const index = source.indexOf(marker);
  if (index < 0) return '';
  const open = source.indexOf(openChar, index);
  return balanced(source, open, openChar, closeChar);
};

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Top-level `{ ... }` objects inside an array literal block. */
function objectsIn(block: string): string[] {
  const objects: string[] = [];
  for (let i = 0; i < block.length; i++) {
    if (block[i] !== '{') continue;
    const object = balanced(block, i, '{', '}');
    objects.push(object);
    i += object.length - 1;
  }
  return objects;
}

/* ---------------------------------------------------------------- *
 * 1. Permission catalogue
 * ---------------------------------------------------------------- */

interface Permission {
  code: string;
  name: string;
  module: string;
  description: string;
}

const seedSource = read('src/seeds/permissions.ts');
const permissionBlock = stripComments(
  blockAfter(seedSource, 'const PERMISSIONS = [', '[', ']'),
);
const field = (object: string, name: string) => {
  const match = new RegExp(`${name}:\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|\`([^\`]*)\`)`).exec(object);
  return (match?.[1] ?? match?.[2] ?? '').replace(/\\\\'/g, "'");
};
const permissions: Permission[] = objectsIn(permissionBlock)
  .map((object) => ({
    code: field(object, 'code'),
    name: field(object, 'name'),
    module: field(object, 'module'),
    description: field(object, 'description'),
  }))
  .filter((permission) => permission.code);

const permissionsArray = (object: string) => {
  const match = /permissions:\s*\[/.exec(object);
  if (!match) return '';
  const open = (match.index ?? 0) + match[0].length - 1;
  return balanced(object, open, '[', ']');
};

/* ---------------------------------------------------------------- *
 * 2. Roles
 * ---------------------------------------------------------------- */

interface Role {
  name: string;
  description: string;
  permissions: string[];
  source: string;
}

const roleSource = read('src/auth/staff-role-catalogue.ts');
const roleBlock = stripComments(blockAfter(roleSource, 'STAFF_ROLE_CATALOGUE = [', '[', ']'));
const roles: Role[] = objectsIn(roleBlock)
  .map((object) => ({
    name: field(object, 'name'),
    description: field(object, 'description'),
    permissions: [
      ...(field(object, 'permissions') + permissionsArray(object)).matchAll(/'([^']+)'/g),
    ].map((code) => code[1]),
    source: 'src/auth/staff-role-catalogue.ts',
  }))
  .filter((role) => role.name);

const facilityAdminSource = read('src/routes/platform/tenants.routes.ts');
const facilityAdminBlock = blockAfter(
  facilityAdminSource,
  'export const FACILITY_ADMIN_PERMISSION_CODES = [',
  '[',
  ']',
);
const facilityAdminPermissions = [
  ...new Set([...facilityAdminBlock.matchAll(/'([^']+)'/g)].map((match) => match[1])),
];

/* ---------------------------------------------------------------- *
 * 3. Facility modules and navigation
 * ---------------------------------------------------------------- */

const moduleSource = read('src/config/facility-modules.ts');
const moduleBlock = blockAfter(moduleSource, 'export const FACILITY_MODULES', 'Object.freeze([', ']');
const facilityModules = [...moduleBlock.matchAll(/id:\s*'([a-z0-9_]+)'/g)].map((match) => match[1]);

interface NavModule {
  module: string;
  permissions: string[];
}

const sidebarSource = read('src/components/Sidebar.tsx');
const requiredBlock = blockAfter(
  sidebarSource,
  'const required: Partial<Record<ModuleId, string[]>> = {',
  '{',
  '}',
);
const navModules: NavModule[] = [...requiredBlock.matchAll(/(\w+):\s*\[([^\]]*)\]/g)].map(
  (match) => ({
    module: match[1],
    permissions: [...match[2].matchAll(/'([^']+)'/g)].map((code) => code[1]),
  }),
);

/* ---------------------------------------------------------------- *
 * 4. Route usage from the generated API inventory
 * ---------------------------------------------------------------- */

const inventory = JSON.parse(read('docs/evidence/API_ROUTE_INVENTORY.json')) as {
  routes: { method: string; path: string; permissions: string[]; anyPermissions: string[] }[];
};

const routeUsage = new Map<string, { count: number; examples: string[] }>();
for (const route of inventory.routes) {
  for (const code of new Set([...route.permissions, ...route.anyPermissions])) {
    const entry = routeUsage.get(code) ?? { count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 2) entry.examples.push(`${route.method} ${route.path}`);
    routeUsage.set(code, entry);
  }
}

/* ---------------------------------------------------------------- *
 * 5. Cross-checks
 * ---------------------------------------------------------------- */

/** The seed grants SUPER_ADMIN every code except these owned delegations. */
const SUPER_ADMIN_EXCLUSIONS = new Set<string>();
{
  const exclusionBlock = /const SUPER_ADMIN_EXCLUSIONS = \[([\s\S]*?)\]/.exec(seedSource);
  for (const match of exclusionBlock?.[1].matchAll(/'([^']+)'/g) ?? []) {
    SUPER_ADMIN_EXCLUSIONS.add(match[1]);
  }
}

function roleUsageOfSuperAdmin(code: string): boolean {
  return !SUPER_ADMIN_EXCLUSIONS.has(code);
}

const knownCodes = new Set(permissions.map((permission) => permission.code));
const unknownInRoles = [
  ...new Set(
    roles.flatMap((role) => role.permissions.filter((code) => !knownCodes.has(code))),
  ),
];
const unknownInFacilityAdmin = facilityAdminPermissions.filter((code) => !knownCodes.has(code));
const unknownInNav = [
  ...new Set(
    navModules.flatMap((module) => module.permissions.filter((code) => !knownCodes.has(code))),
  ),
];
const unknownInRoutes = [
  ...new Set(
    inventory.routes
      .flatMap((route) => [...route.permissions, ...route.anyPermissions])
      .filter((code) => !knownCodes.has(code)),
  ),
];

const heldByAnyRole = new Set(roles.flatMap((role) => role.permissions));
const unheld = permissions
  .map((permission) => permission.code)
  .filter(
    (code) =>
      !heldByAnyRole.has(code) &&
      !facilityAdminPermissions.includes(code) &&
      !roleUsageOfSuperAdmin(code),
  );
const unusedByRoutes = permissions
  .map((permission) => permission.code)
  .filter((code) => !routeUsage.has(code));

const rows = permissions
  .map((permission) => {
    const holders: string[] = [];
    if (roleUsageOfSuperAdmin(permission.code)) holders.push('SUPER_ADMIN');
    if (facilityAdminPermissions.includes(permission.code)) holders.push('FACILITY_ADMIN');
    for (const role of roles) {
      if (role.permissions.includes(permission.code)) holders.push(role.name);
    }
    return {
      ...permission,
      roles: holders,
      routeCount: routeUsage.get(permission.code)?.count ?? 0,
      routeExamples: routeUsage.get(permission.code)?.examples ?? [],
      navModules: navModules
        .filter((module) => module.permissions.includes(permission.code))
        .map((module) => module.module),
    };
  })
  .sort((a, b) => a.module.localeCompare(b.module) || a.code.localeCompare(b.code));

const payload = {
  generatedAt: new Date().toISOString(),
  generatedBy: 'scripts/docs/build-permissions-matrix.ts',
  sources: {
    catalogue: 'src/seeds/permissions.ts',
    staffRoles: 'src/auth/staff-role-catalogue.ts',
    facilityAdminDelegation: 'src/routes/platform/tenants.routes.ts',
    navigation: 'src/components/Sidebar.tsx',
    routeUsage: 'docs/evidence/API_ROUTE_INVENTORY.json',
  },
  totals: {
    permissions: permissions.length,
    roles: roles.length + 2,
    facilityModules: facilityModules.length,
    navModules: navModules.length,
    permissionsHeldByNoRole: unheld.length,
    permissionsUsedByNoRoute: unusedByRoutes.length,
  },
  superAdminExclusions: [...SUPER_ADMIN_EXCLUSIONS],
  roles: [
    {
      name: 'SUPER_ADMIN',
      description:
        'Platform administrator. Holds every catalogue permission except the delegations listed in superAdminExclusions; operates without a tenant or facility assignment.',
      permissions: permissions
        .map((permission) => permission.code)
        .filter((code) => !SUPER_ADMIN_EXCLUSIONS.has(code)),
      source: 'src/seeds/permissions.ts',
    },
    {
      name: 'FACILITY_ADMIN',
      description:
        'Facility administrator created by platform invitation. Holds the delegated set below; independent approval duties stay with other roles.',
      permissions: facilityAdminPermissions,
      source: 'src/routes/platform/tenants.routes.ts',
    },
    ...roles,
  ],
  facilityModules,
  navModules,
  permissions: rows,
  findings: {
    unknownCodesInRoles: unknownInRoles,
    unknownCodesInFacilityAdminSet: unknownInFacilityAdmin,
    unknownCodesInNavigation: unknownInNav,
    unknownCodesInRoutes: unknownInRoutes,
    permissionsHeldByNoRole: unheld,
    permissionsUsedByNoRoute: unusedByRoutes,
  },
};

writeFileSync(EVIDENCE, `${JSON.stringify(payload, null, 1)}\n`);

/* ---------------------------------------------------------------- *
 * 6. Markdown
 * ---------------------------------------------------------------- */

const md: string[] = [];
const byModule = new Map<string, typeof rows>();
for (const row of rows) {
  if (!byModule.has(row.module)) byModule.set(row.module, []);
  byModule.get(row.module)!.push(row);
}

md.push('# Permissions matrix');
md.push('');
md.push(
  '> Generated from the permission catalogue, the staff role catalogue, the facility-admin ' +
    'delegation set, the navigation guard and the registered API routes. Regenerate with ' +
    '`npx tsx scripts/docs/build-permissions-matrix.ts`.',
);
md.push('');
md.push(`Generated: ${payload.generatedAt.slice(0, 10)}`);
md.push('');
md.push('**Intended audience:** system administrators, facility administrators, auditors, integrators.');
md.push('');
md.push('## Summary');
md.push('');
md.push('| Measure | Value |');
md.push('| --- | --- |');
md.push(`| Permission codes in the catalogue | ${permissions.length} |`);
md.push(`| Seeded staff roles plus the two administrator roles | ${roles.length + 2} |`);
md.push(`| Facility modules that can be switched off individually | ${facilityModules.length} |`);
md.push(`| Navigation modules with a permission guard | ${navModules.length} |`);
md.push(`| Codes held by no seeded role | ${unheld.length} |`);
md.push(`| Codes that no registered API route requires | ${unusedByRoutes.length} |`);
md.push('');
md.push(
  'Roles are seeded, not fixed: a facility administrator can create custom roles and grant or ' +
    'withhold individual codes, and `facility_role_permission_overrides` can narrow a role for one ' +
    'facility. The matrix therefore describes the default grants, not every possible deployment.',
);
md.push('');
md.push('## How access is decided');
md.push('');
md.push('A request reaches a handler only if all of the following hold:');
md.push('');
md.push('1. **Session** — `requireAuth` validates the staff session cookie (`requirePortalAuth` for the patient portal).');
md.push('2. **Facility module** — `requireFacilityModule(code)` refuses modules the facility has switched off, and the navigation rail hides them.');
md.push('3. **Role permission** — `requirePermission(...)` (all listed codes) or `requireAnyPermission([...])` (at least one).');
md.push('4. **Scope** — the handler resolves the tenant and facility from the session and rejects a body or query facility that disagrees.');
md.push('');
md.push('A permission never grants scope by itself: it allows an action, while the scope check decides which tenant and facility rows that action may touch.');
md.push('');
md.push('## Roles');
md.push('');
md.push('| Role | Permissions granted | Source |');
md.push('| --- | --- | --- |');
for (const role of payload.roles) {
  md.push(`| ${role.name} | ${role.permissions.length} | \`${role.source}\` |`);
}
md.push('');
md.push(
  '`SUPER_ADMIN` is a platform role: it operates without a tenant or facility and is barred from ' +
    'facility financial operations that require a facility assignment. The exclusions applied by ' +
    'the seed are: ' +
    (payload.superAdminExclusions.length
      ? payload.superAdminExclusions.map((code) => `\`${code}\``).join(', ')
      : 'none found in a `SUPER_ADMIN_EXCLUSIONS` constant'),
);
md.push('');
md.push('## Permissions by module');
md.push('');
for (const [module, moduleRows] of [...byModule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  md.push(`### ${module}`);
  md.push('');
  md.push('| Code | Label | Default roles | Routes requiring it | Navigation module |');
  md.push('| --- | --- | --- | --- | --- |');
  for (const row of moduleRows) {
    md.push(
      `| \`${row.code}\` | ${row.name} | ${row.roles.join(', ') || '—'} | ${row.routeCount} | ${
        row.navModules.join(', ') || '—'
      } |`,
    );
  }
  md.push('');
}
md.push('## Cross-checks');
md.push('');
const describe = (label: string, codes: string[]) => {
  md.push(`**${label}:** ${codes.length ? codes.map((code) => `\`${code}\``).join(', ') : 'none'}`);
  md.push('');
};
describe('Permission codes named by a seeded role but absent from the catalogue', unknownInRoles);
describe('Permission codes named by the facility-admin delegation but absent', unknownInFacilityAdmin);
describe('Permission codes named by a navigation guard but absent', unknownInNav);
describe('Permission codes required by a registered route but absent', unknownInRoutes);
describe('Catalogue codes no seeded role holds', unheld);
describe('Catalogue codes no registered route requires', unusedByRoutes);
md.push('## Limitations');
md.push('');
md.push(
  '- Custom roles created in a deployment are not listed; only seeded defaults are.',
);
md.push(
  '- Route counts come from the generated API inventory and count each route once per code, ' +
    'including routes that require the code through a router-level guard.',
);
md.push(
  '- A code that no route requires may still be meaningful: it can be a delegated capability for a ' +
    'custom role, or a guard that the inventory attributes to a router rather than a route.',
);
md.push('');
md.push('## Related documents');
md.push('');
md.push('- [Roles and personas](../01-system-overview/USER_ROLES_AND_PERSONAS.md)');
md.push('- [User management](USER_MANAGEMENT.md)');
md.push('- [API reference](../06-technical/API_REFERENCE.md)');
md.push('- [Multitenancy architecture](../06-technical/MULTITENANCY_ARCHITECTURE.md)');
md.push('');

writeFileSync(MD, `${md.join('\n')}\n`);

console.info('Permissions matrix', payload.totals, payload.findings);
process.exit(0);
