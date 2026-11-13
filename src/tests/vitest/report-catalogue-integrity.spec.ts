/**
 * Navigation integrity for the report centre.
 *
 * A report catalogue is not evidence that a report works, and an engine is not
 * evidence that anyone can reach it. These two maps drift apart easily: a name
 * added to `REPORT_CATEGORIES` with an engine nobody registered shows a menu
 * item that returns a server error, and an engine nobody listed is dead code
 * that still counts as "reporting coverage".
 *
 * No database is required; this is a pure metadata check.
 */
import { describe, expect, it } from 'vitest';
import { REPORT_CATEGORIES } from '../../reporting/report-catalogue.ts';
import { REPORT_ENGINES } from '../../reporting/report-centre.types.ts';
import { queryPlan } from '../../reporting/report-centre.service.ts';

const entries = REPORT_CATEGORIES.flatMap((category) =>
  category.reports.map((report) => ({ category: category.id, ...report })),
);
const reachable = entries.filter((entry) => entry.engine !== null);

describe('report catalogue integrity', () => {
  it('never offers a report whose engine is not registered', () => {
    expect(reachable.length).toBeGreaterThan(0);
    const unregistered = reachable
      .filter((entry) => !(entry.engine! in REPORT_ENGINES))
      .map((entry) => `${entry.id} -> ${entry.engine}`);
    expect(unregistered).toEqual([]);
  });

  it('never registers an engine that no catalogue entry reaches', () => {
    const listed = new Set(reachable.map((entry) => entry.engine!));
    const unlisted = Object.keys(REPORT_ENGINES).filter((id) => !listed.has(id as never));
    expect(unlisted).toEqual([]);
  });

  it('explains the dependency for every report it does not produce', () => {
    const unexplained = entries
      .filter((entry) => entry.engine === null)
      .filter((entry) => !entry.dependency || entry.dependency.trim().length < 8);
    expect(unexplained.map((entry) => entry.id)).toEqual([]);
  });

  it('builds a scoped query plan for every reachable engine', () => {
    // The plan is built without touching a database; a missing plan is exactly the
    // defect this guards, so it must throw for none of them.
    const failures: string[] = [];
    for (const id of Object.keys(REPORT_ENGINES) as Array<keyof typeof REPORT_ENGINES>) {
      try {
        const plan = queryPlan(id, 1, { facilityId: 2 });
        if (!plan.from || !plan.select || !plan.params.length) failures.push(`${id}: empty plan`);
        // Every report is scoped by binding the tenant and facility as parameters
        // 1 and 2. Ledger plans place theirs in a subquery, so the whole statement
        // is checked rather than the top-level WHERE clause alone.
        if (plan.params[0] !== 1) failures.push(`${id}: tenant is not the first parameter`);
        if (plan.params[1] !== 2) failures.push(`${id}: facility is not the second parameter`);
        const sql = `${plan.from} ${plan.where.join(' AND ')} ${plan.select}`;
        if (!sql.includes('$1') || !sql.includes('$2'))
          failures.push(`${id}: tenant or facility parameter is unused`);
      } catch (error) {
        failures.push(`${id}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps catalogue identifiers unique so navigation cannot collapse two reports', () => {
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
