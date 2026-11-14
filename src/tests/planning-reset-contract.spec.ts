import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isRestrictedRolePermission } from '../auth/staff-role-policy.ts';
const read = (p: string) => readFileSync(p, 'utf8');
describe('planning reset migration and permission boundary', () => {
  it('registers the new migration without changing the original planning guards', () => {
    const journal = JSON.parse(read('drizzle/meta/_journal.json'));
    expect(journal.entries.at(-1).tag).toBe('0097_controlled_planning_reset');
    const migration = read('drizzle/0097_controlled_planning_reset.sql');
    expect(migration).toContain("p.status<>'DRAFT'");
    expect(migration).toContain('pg_current_xact_id()');
    expect(migration).toContain('e.tenant_id=p.tenant_id AND e.facility_id=p.facility_id');
    expect(migration).toContain('planning_events WHERE plan_id=pid');
    expect(migration).toContain('planning_reports WHERE plan_id=pid');
    expect(migration).not.toMatch(/DISABLE TRIGGER|TRUNCATE|DELETE FROM|DROP TABLE|CASCADE/i);
    expect(migration).not.toMatch(
      /DROP TRIGGER planning_events_immutable|DROP TRIGGER planning_reports_immutable/,
    );
    for (const table of ['category', 'item', 'month', 'uniform']) {
      expect(migration).toContain(`CREATE TRIGGER planning_${table}_guard BEFORE INSERT OR UPDATE`);
      expect(migration).toContain(`CREATE TRIGGER planning_${table}_reset_delete BEFORE DELETE`);
    }
  });
  it('prevents ordinary staff role delegation of the destructive permission', () => {
    expect(
      isRestrictedRolePermission({ code: 'accounting.planning.reset', module: 'accounting' }),
    ).toBe(true);
    expect(read('src/seeds/permissions.ts')).toContain("code: 'accounting.planning.reset'");
  });
});
