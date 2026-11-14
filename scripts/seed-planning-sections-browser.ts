/** Extend the guarded synthetic browser fixture with actual-source drafts. Never production. */
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import argon2 from 'argon2';
import { pool } from '../src/db/index.ts';
import * as planning from '../src/budget-planning/planning.service.ts';
import type { Mapping } from '../src/budget-planning/workbook.ts';
if (
  process.env.BUDGET_BROWSER_SYNTHETIC !== 'YES' ||
  !/synthetic.*test|test.*synthetic/i.test(process.env.SQL_DB_NAME ?? '') ||
  !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '') ||
  !process.env.SYRONA_SOURCE_DIR
)
  throw new Error(
    'Requires an explicitly disposable local synthetic test database and official source directory.',
  );
const config = JSON.parse(await readFile('.tmp-tools/budget/browser-session.json', 'utf8'));
if (config.syntheticOnly !== true) throw new Error('Synthetic fixture required.');
const s = { tenantId: config.tenantId, facilityId: config.facilityId, actorId: config.actorId };
const evidence = JSON.parse(
  await readFile(
    'docs/audits/syrona-source-acceptance-evidence/source-reconciliation.json',
    'utf8',
  ),
);
let planId: number | undefined;
const imports = [];
for (const file of ['Syrona_Stationery.csv', 'Syrona_Branding.csv']) {
  const bytes = await readFile(path.join(process.env.SYRONA_SOURCE_DIR, file));
  const b = await planning.upload(s, bytes, file, 'text/csv');
  const mappings: Mapping[] = evidence.mappings
    .filter((m: Mapping) => m.sheet === (file.includes('Stationery') ? 'Stationery' : 'Branding'))
    .map((m: Mapping) => ({ ...m, sheet: 'CSV' }));
  if (file.includes('Branding'))
    mappings.push({
      sheet: 'CSV',
      kind: 'UNIFORM',
      startRow: 22,
      endRow: 25,
      category: 'Staff Uniforms',
      description: 'C',
      price: 'E',
      existingBalance: 'D',
      staff: 'G',
      perStaff: 'H',
      balanceRule: 'SUBTRACT',
      balanceLabel: 'December 2025 — ZERO_FILL test assumptions; half-pay unverified',
    });
  const preview = await planning.previewImport(s, b.id, {
    mappings,
    inflationPercent: '5',
    policy: 'ZERO_FILL',
  });
  if (preview.errors.length) throw new Error('Official source preview errors.');
  const current = planId
    ? await planning.transaction((c) => planning.scopedPlan(c, s, planId!))
    : undefined;
  const r = await planning.confirmImport(s, b.id, {
    name: 'Official CSV section verification — TEST ONLY',
    financialYear: 2026,
    planType: 'MIXED',
    currency: 'KES',
    inflationPercent: '5',
    policy: 'ZERO_FILL',
    mode: planId ? 'SKIP' : 'NEW',
    planId,
    version: current?.version,
    confirm: true,
    confirmAdditionalPlan: true,
    mappings,
    previewHash: preview.previewHash,
  });
  planId = r.planId;
  imports.push({ filename: file, batchId: b.id, created: r.created });
}
const otherYear = await planning.createPlan(s, {
  name: 'Year filter verification — TEST ONLY',
  financialYear: 2027,
  planType: 'MIXED',
  currency: 'KES',
  inflationPercent: '5',
});
const username = 'planning_viewer_' + randomUUID().slice(0, 8),
  password = randomBytes(20).toString('base64url');
const user = (
  await pool.query(
    "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic Read-only Viewer',$3,'ACTIVE',$4,$5) RETURNING id",
    [username, username + '@example.test', await argon2.hash(password), s.tenantId, s.facilityId],
  )
).rows[0];
const role = (
  await pool.query('INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id', [
    s.tenantId,
    'SYNTHETIC_VIEWER_' + randomUUID().slice(0, 8),
  ])
).rows[0];
await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user.id, role.id]);
for (const permission of ['accounting.read', 'accounting.planning.read'])
  await pool.query(
    'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
    [role.id, permission],
  );
await writeFile(
  '.tmp-tools/budget/browser-session.json',
  JSON.stringify({
    ...config,
    planId,
    otherYearPlanId: otherYear.id,
    sectionImports: imports,
    viewer: { username, password },
  }),
);
console.log(
  JSON.stringify({ syntheticOnly: true, importedRows: imports, year: 2026, viewerCreated: true }),
);
await pool.end();
