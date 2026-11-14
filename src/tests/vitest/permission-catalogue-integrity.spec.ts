/**
 * Permission catalogue integrity.
 *
 * A route that requires a permission the seed never inserts is a dead gate: no
 * role can be granted it, so either the feature is unreachable or (worse) the
 * gate was never exercised in production. A role-catalogue entry naming an
 * unseeded permission silently grants nothing and looks like it works.
 *
 * This is a static check over source text — no database, no HTTP — and it runs
 * in milliseconds. It is deliberately bidirectional where it can be: every code
 * the routes demand must be seeded, and every code the staff catalogue hands out
 * must exist. It does not assert the reverse for the catalogue because some
 * permissions are used only by UI modules or by services rather than by a route
 * middleware.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

/** Route families that mount authenticated API routers. */
const ROUTE_FILES = [
  'src/routes/accounting.routes.ts',
  'src/routes/appointments.routes.ts',
  'src/routes/approval-policy.routes.ts',
  'src/routes/billing.routes.ts',
  'src/routes/dha.routes.ts',
  'src/routes/diagnoses.routes.ts',
  'src/routes/dialysis.routes.ts',
  'src/routes/facility-services.routes.ts',
  'src/routes/fixed-assets.routes.ts',
  'src/routes/inpatient.routes.ts',
  'src/routes/inventory-accounting.routes.ts',
  'src/routes/inventory-control.routes.ts',
  'src/routes/laboratory.routes.ts',
  'src/routes/master-tariffs.routes.ts',
  'src/routes/maternal-health.routes.ts',
  'src/routes/medications.routes.ts',
  'src/routes/pharmacy.routes.ts',
  'src/routes/private-insurance.routes.ts',
  'src/routes/procurement-workflow.routes.ts',
  'src/routes/procurement.routes.ts',
  'src/routes/queues.routes.ts',
  'src/routes/radiology.routes.ts',
  'src/routes/service-tariffs.routes.ts',
  'src/routes/sha-eclaims.routes.ts',
  'src/routes/theatre-scheduling.routes.ts',
  'src/routes/theatre.routes.ts',
  'src/routes/vitals.routes.ts',
  'src/routes/workforce.routes.ts',
  'src/routes/domains/audit.routes.ts',
  'src/routes/domains/billing-analytics.routes.ts',
  'src/routes/domains/billing-charges.routes.ts',
  'src/routes/domains/claims.routes.ts',
  'src/routes/domains/encounters.routes.ts',
  'src/routes/domains/interop.routes.ts',
  'src/routes/domains/invoices.routes.ts',
  'src/routes/domains/patients.routes.ts',
  'src/routes/domains/public-health.routes.ts',
  'src/routes/domains/report-centre.routes.ts',
  'src/routes/domains/service-tariff-links.routes.ts',
  'src/routes/domains/tenancy.routes.ts',
];

function demandedPermissions(file: string): string[] {
  const source = read(file);

  // Some routers keep their permission lists in file-local constants and spread
  // them into the middleware (`requireAnyPermission(...CAN_READ)`). Resolve those
  // so the sweep measures the gate rather than the call syntax.
  const constants = new Map<string, string[]>();
  for (const match of source.matchAll(/const\s+(\w+)\s*(?::[^=]+)?=\s*\[([^\]]*)\]/gs)) {
    const codes = [...match[2].matchAll(/'([a-z][a-z0-9]*(?:[._-][a-z0-9]+)+)'/g)].map((m) => m[1]);
    if (codes.length) constants.set(match[1], codes);
  }

  const codes: string[] = [];
  const call = /require(?:Any)?Permission\(([^)]*)\)/gs;
  for (const match of source.matchAll(call)) {
    for (const code of match[1].matchAll(/'([a-z][a-z0-9]*(?:[._-][a-z0-9]+)+)'/g))
      codes.push(code[1]);
    for (const spread of match[1].matchAll(/\.\.\.(\w+)/g))
      codes.push(...(constants.get(spread[1]) ?? []));
  }
  return codes;
}

function seededPermissions(): Set<string> {
  const seed = read('src/seeds/permissions.ts');
  const codes = new Set<string>();
  for (const match of seed.matchAll(/code:\s*'([^']+)'/g)) codes.add(match[1]);
  return codes;
}

function cataloguePermissions(): string[] {
  const source = read('src/auth/staff-role-catalogue.ts');
  const start = source.indexOf('permissions: [');
  if (start === -1) return [];
  const codes: string[] = [];
  for (const match of source.matchAll(/'([a-z][a-z0-9]*(?:[._-][a-z0-9]+)+)'/g))
    codes.push(match[1]);
  return codes;
}

describe('permission catalogue integrity', () => {
  const seeded = seededPermissions();

  it('seeds every permission a route requires', () => {
    const missing: string[] = [];
    for (const file of ROUTE_FILES) {
      for (const code of new Set(demandedPermissions(file))) {
        if (!seeded.has(code)) missing.push(`${file}: ${code}`);
      }
    }
    expect(missing, `Unseeded permissions requested by routes:\n${missing.join('\n')}`).toEqual([]);
  });

  it('seeds every permission the staff role catalogue grants', () => {
    const missing = [...new Set(cataloguePermissions())].filter((code) => !seeded.has(code));
    expect(missing, `Role catalogue grants unseeded permissions: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('never passes an empty or malformed permission code to a route gate', () => {
    const bad: string[] = [];
    for (const file of ROUTE_FILES) {
      for (const code of demandedPermissions(file))
        if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(code)) bad.push(`${file}: ${code}`);
    }
    expect(bad).toEqual([]);
  });

  it('has at least one route gate per file in the inventory', () => {
    // A file listed here that no longer mounts a permission gate means the sweep
    // has drifted from the router layout and is no longer measuring the API.
    const silent = ROUTE_FILES.filter((file) => demandedPermissions(file).length === 0);
    expect(silent).toEqual([]);
  });
});
