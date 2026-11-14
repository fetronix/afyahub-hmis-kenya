import { randomUUID, randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import argon2 from 'argon2';
import { pool } from '../src/db/index.ts';
import * as planning from '../src/budget-planning/planning.service.ts';
import { uploadLetterhead, activateLetterhead } from '../src/branding/letterhead.service.ts';
import { PDFDocument } from 'pdf-lib';
if (
  process.env.BUDGET_BROWSER_SYNTHETIC !== 'YES' ||
  !/synthetic.*test|test.*synthetic/i.test(process.env.SQL_DB_NAME ?? '') ||
  !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '')
)
  throw new Error(
    'Requires BUDGET_BROWSER_SYNTHETIC=YES and an explicitly local synthetic test database.',
  );
const suffix = randomUUID().slice(0, 8),
  username = `planning_browser_${suffix}`,
  password = randomBytes(20).toString('base64url');
const t = (
  await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
    'Synthetic budget browser tenant',
    `budget-browser-${suffix}`,
  ])
).rows[0].id;
const f = (
  await pool.query(
    'INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,$3,$4::jsonb) RETURNING id',
    [t, `BP-${suffix}`, 'Synthetic Planning Facility', JSON.stringify(['accounting', 'finance'])],
  )
).rows[0].id;
const user = (
  await pool.query(
    "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic Planning User',$3,'ACTIVE',$4,$5) RETURNING id",
    [username, `${username}@example.test`, await argon2.hash(password), t, f],
  )
).rows[0].id;
const role = (
  await pool.query('INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id', [
    t,
    `SYNTHETIC_PLANNER_${suffix}`,
  ])
).rows[0].id;
await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
const permissions = [
  'reports.read',
  'accounting.read',
  'accounting.coa.manage',
  'facility.branding.read',
  'facility.branding.manage',
  ...['read', 'manage', 'import', 'approve', 'export', 'audit'].map(
    (p) => `accounting.planning.${p}`,
  ),
];
for (const permission of permissions) {
  await pool.query(
    "INSERT INTO permissions(code,name,module) VALUES($1,$1,'accounting') ON CONFLICT(code) DO NOTHING",
    [permission],
  );
  await pool.query(
    'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
    [role, permission],
  );
}
const scope = { tenantId: t, facilityId: f, actorId: user };
let plan = await planning.createPlan(scope, {
  name: '2026 Facility Procurement Projections',
  planType: 'MIXED',
  financialYear: 2026,
  currency: 'KES',
  inflationPercent: '5',
});
for (const [name, items] of [
  [
    'OPD CONSUMABLES',
    [
      'Examination gloves — synthetic',
      'Clinical stationery — synthetic',
      'Patient files — synthetic',
    ],
  ],
  ['DENTAL CONSUABLES', ['Dental bibs — synthetic', 'Dental suction tips — synthetic']],
  ['CONSUMABLE ITEMS', ['Printer paper — synthetic', 'Cleaning supplies — synthetic']],
  ['Branding', ['Facility signage — synthetic', 'Staff ID holders — synthetic']],
] as const) {
  const category = await planning.saveCategory(scope, plan.id, null, {
    version: plan.version,
    name,
  });
  plan = category.plan;
  for (const [n, description] of items.entries()) {
    plan = (
      await planning.saveItem(scope, plan.id, null, {
        version: plan.version,
        categoryId: category.changedId,
        description,
        unit: 'Pack',
        basePrice: String(250 + n * 150),
        quantities: Array.from({ length: 12 }, (_, m) => String(10 + m + n)),
      })
    ).plan;
  }
  if (name === 'Branding')
    plan = (
      await planning.saveUniform(scope, plan.id, null, {
        version: plan.version,
        categoryId: category.changedId,
        description: 'Nursing uniforms — synthetic',
        existingBalance: '8',
        balanceLabel: 'December 2025',
        buyingCost: '2500',
        staffCount: 30,
        quantityPerStaff: '2',
        contributionPercent: '50',
        balanceRule: 'SUBTRACT',
      })
    ).plan;
}
const doc = await PDFDocument.create();
const page = doc.addPage([595.28, 841.89]);
page.drawText('SYNTHETIC PLANNING FACILITY', { x: 36, y: 799, size: 16 });
page.drawText('Synthetic verification only', { x: 36, y: 25, size: 9 });
const context = {
  userId: user,
  tenantId: t,
  facilityId: f,
  roles: ['SYNTHETIC_PLANNER'],
  permissions,
  isSuperAdmin: false,
};
const head = await uploadLetterhead(context, {
  facilityId: f,
  filename: 'synthetic-facility-letterhead.pdf',
  mimeType: 'application/pdf',
  bytes: Buffer.from(await doc.save()),
  body: { bodyTopPt: 85, bodyBottomPt: 60, bodyLeftPt: 36, bodyRightPt: 36 },
});
await activateLetterhead(context, head.letterhead.id);
await mkdir('.tmp-tools/budget', { recursive: true });
await writeFile(
  '.tmp-tools/budget/browser-session.json',
  JSON.stringify({
    syntheticOnly: true,
    username,
    password,
    facilityId: f,
    tenantId: t,
    actorId: user,
    planId: plan.id,
  }),
);
console.log('SYNTHETIC_BROWSER_FIXTURE_READY');
await pool.end();
