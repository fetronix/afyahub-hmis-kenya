import {
  SHIFT_NAMES,
  VITALS_OVERDUE_HOURS,
  VITALS_REFERENCE,
  assessVitals,
  currentShift,
  dateKey,
  shiftForHour,
} from '../nursing/nursing-contracts.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('Nursing UI — clinical flagging, shift, and wiring tests', () => {
  it('1. NORMAL RANGES PRODUCE NO FLAGS', async () => {
    const flags = assessVitals({
      systolicBp: 120,
      diastolicBp: 80,
      pulseRate: 76,
      temperatureC: '36.8',
      respiratoryRate: 16,
      spo2Percent: 98,
      bloodGlucoseMmol: '5.4',
    });

    expect(flags.length, 'normal adult vitals produce no flags').toBe(0);

    /* Explicit nulls and empty strings must not be treated as zero. */
    const empty = assessVitals({
      systolicBp: null,
      diastolicBp: null,
      pulseRate: null,
      temperatureC: '',
      respiratoryRate: null,
      spo2Percent: null,
      bloodGlucoseMmol: null,
    });

    expect(empty.length, 'missing values produce no flags').toBe(0);

    /* A blank observation object must not blow up. */
    expect(assessVitals({}).length, 'empty observation is safe').toBe(0);
  });

  it('2. WARNING BOUNDARIES', async () => {
    const warning = (payload: Parameters<typeof assessVitals>[0], field: string) => {
      const flags = assessVitals(payload);
      const match = flags.find((flag) => flag.field === field);

      expect(Boolean(match), `expected a flag on ${field}`).toBe(true);
      expect(match?.severity, `${field} severity is warning`).toBe('warning');

      return match!;
    };

    /* One unit inside the range is normal; one unit outside is a warning. */
    expect(assessVitals({ systolicBp: 140 }).length, 'systolic 140 (upper bound) is normal').toBe(
      0,
    );
    const systolic = warning({ systolicBp: 141 }, 'systolicBp');
    expect(systolic.direction, 'systolic 141 flags high').toBe('high');

    expect(assessVitals({ pulseRate: 100 }).length, 'pulse 100 (upper bound) is normal').toBe(0);
    warning({ pulseRate: 101 }, 'pulseRate');
    warning({ pulseRate: 59 }, 'pulseRate');

    expect(assessVitals({ spo2Percent: 94 }).length, 'SpO2 94 (lower bound) is normal').toBe(0);
    warning({ spo2Percent: 93 }, 'spo2Percent');

    /* Strings from Postgres numeric columns are parsed, not compared as text. */
    warning({ temperatureC: '38.2' }, 'temperatureC');
    warning({ bloodGlucoseMmol: '3.2' }, 'bloodGlucoseMmol');

    expect(
      assessVitals({ temperatureC: '37.5' }).length,
      'temperature 37.5 (upper bound) is normal',
    ).toBe(0);
  });

  it('3. CRITICAL BOUNDARIES', async () => {
    const severityOf = (payload: Parameters<typeof assessVitals>[0], field: string) =>
      assessVitals(payload).find((flag) => flag.field === field)?.severity;

    /*
     * Boundaries are inclusive: SpO2 <= 90, systolic <= 80 or >= 180,
     * pulse <= 45 or >= 130, temperature >= 39.5, RR >= 30,
     * glucose >= 20 or <= 2.8.
     */
    expect(severityOf({ spo2Percent: 90 }, 'spo2Percent'), 'SpO2 90 is critical').toBe('critical');
    expect(severityOf({ spo2Percent: 91 }, 'spo2Percent'), 'SpO2 91 is warning').toBe('warning');

    expect(severityOf({ systolicBp: 80 }, 'systolicBp'), 'systolic 80 is critical').toBe(
      'critical',
    );
    expect(severityOf({ systolicBp: 81 }, 'systolicBp'), 'systolic 81 is warning').toBe('warning');
    expect(severityOf({ systolicBp: 180 }, 'systolicBp'), 'systolic 180 is critical').toBe(
      'critical',
    );
    expect(severityOf({ systolicBp: 179 }, 'systolicBp'), 'systolic 179 is warning').toBe(
      'warning',
    );

    expect(severityOf({ pulseRate: 45 }, 'pulseRate'), 'pulse 45 is critical').toBe('critical');
    expect(severityOf({ pulseRate: 130 }, 'pulseRate'), 'pulse 130 is critical').toBe('critical');
    expect(severityOf({ pulseRate: 46 }, 'pulseRate'), 'pulse 46 is warning').toBe('warning');
    expect(severityOf({ pulseRate: 129 }, 'pulseRate'), 'pulse 129 is warning').toBe('warning');

    expect(
      severityOf({ temperatureC: '39.5' }, 'temperatureC'),
      'temperature 39.5 is critical',
    ).toBe('critical');
    expect(
      severityOf({ respiratoryRate: 30 }, 'respiratoryRate'),
      'respiratory rate 30 is critical',
    ).toBe('critical');
    expect(
      severityOf({ bloodGlucoseMmol: '20' }, 'bloodGlucoseMmol'),
      'glucose 20 is critical',
    ).toBe('critical');
    expect(
      severityOf({ bloodGlucoseMmol: '2.8' }, 'bloodGlucoseMmol'),
      'glucose 2.8 is critical',
    ).toBe('critical');

    /* Critical flags must come first so the ward badge shows the worst finding. */
    const ordered = assessVitals({
      pulseRate: 105, // warning
      spo2Percent: 88, // critical
      temperatureC: '38.5', // warning
    });

    expect(ordered[0].severity, 'critical flag sorts first').toBe('critical');
    expect(ordered[0].field, 'most severe finding leads').toBe('spo2Percent');
  });

  it('4. SHIFT CONTRACT', async () => {
    expect(SHIFT_NAMES.length, 'three ward shifts are defined').toBe(3);
    expect(SHIFT_NAMES[0], 'morning shift name').toBe('Morning');
    expect(SHIFT_NAMES[1], 'afternoon shift name').toBe('Afternoon');
    expect(SHIFT_NAMES[2], 'night shift name').toBe('Night');

    /* Morning 07:00–14:59 */
    expect(shiftForHour(7), '07:00 is Morning').toBe('Morning');
    expect(shiftForHour(14), '14:00 is Morning').toBe('Morning');

    /* Afternoon 15:00–19:59 */
    expect(shiftForHour(15), '15:00 is Afternoon').toBe('Afternoon');
    expect(shiftForHour(19), '19:00 is Afternoon').toBe('Afternoon');

    /* Night 20:00–06:59 */
    expect(shiftForHour(20), '20:00 is Night').toBe('Night');
    expect(shiftForHour(0), '00:00 is Night').toBe('Night');
    expect(shiftForHour(6), '06:00 is Night').toBe('Night');

    /* currentShift must agree with the explicit hour mapping. */
    const probe = new Date(2026, 9, 21, 9, 30, 0);
    expect(currentShift(probe), 'currentShift reads the clock hour').toBe('Morning');
    expect(currentShift(new Date(2026, 9, 21, 23, 0, 0)), 'currentShift at night').toBe('Night');

    /* Overdue threshold is a single source of truth. */
    expect(VITALS_OVERDUE_HOURS, 'vitals become overdue after 8 hours').toBe(8);
  });

  it('5. DATE KEY', async () => {
    expect(dateKey(new Date(2026, 0, 5, 13, 0, 0)), 'date key pads month and day').toBe(
      '2026-01-05',
    );
    expect(dateKey(new Date(2026, 11, 31, 23, 59, 0)), 'date key at year end').toBe('2026-12-31');
    expect(dateKey('not-a-date'), 'invalid date yields an empty key').toBe('');

    /* Two notes in the same local day must land in the same handover date. */
    expect(dateKey(new Date(2026, 9, 21, 0, 5, 0)), 'same local day shares a handover date').toBe(
      dateKey(new Date(2026, 9, 21, 23, 55, 0)),
    );
  });

  it('6. ROUTE & UI WIRING', async () => {
    const app = readRepoFile('src/app.ts');
    const wiring = readRepoFile('src/routes/index.ts');

    /*
     * The mount lines live in src/routes/index.ts now. That router is
     * mounted at '/api' by app.ts, so the prefix is relative here - the
     * assertion still pins the same gate to the same public path.
     */

    /* Facility-module guards for ward care. */
    expect(
      wiring.includes("api.use('/inpatient', requireFacilityModule('inpatient'))"),
      'inpatient routes are module-guarded',
    ).toBe(true);
    expect(
      wiring.includes("api.use('/nursing-notes', requireFacilityModule('inpatient'))"),
      'nursing note routes are module-guarded',
    ).toBe(true);

    /*
     * The three nursing endpoints the UI calls must exist and be
     * permission-guarded. They moved to src/routes/inpatient.routes.ts with
     * the rest of the inpatient routes, so they are looked up there; the
     * router is mounted at /api, hence the prefix is dropped for the search.
     */
    const routes = readRepoFile('src/routes/inpatient.routes.ts');

    expect(
      wiring.includes('api.use(inpatientRoutes)'),
      'the inpatient router is mounted at /api',
    ).toBe(true);

    for (const route of [
      '/api/inpatient/board',
      '/api/admissions/:id/vitals',
      '/api/nursing-notes/handover',
    ]) {
      const index = routes.indexOf(route.replace(/^\/api/, ''));
      expect(index > -1, `${route} is registered`).toBe(true);

      const window = routes.slice(index, index + 400);
      expect(window.includes('requirePermission('), `${route} declares a permission guard`).toBe(
        true,
      );
      expect(window.includes('requireAuthContext'), `${route} resolves the auth context`).toBe(
        true,
      );
    }

    /*
     * Unscoped observation writes are the hole this work closed. Both the
     * observation routes moved to src/routes/vitals.routes.ts, so the marker
     * is read there - and it is a bare path now, not `app.post(` plus a
     * handler, because the verb is on the router.
     */
    const vitals = readRepoFile('src/routes/vitals.routes.ts');
    const postIndex = vitals.indexOf("router.post(\n  '/api/observations'");
    expect(postIndex > -1, 'POST /api/observations still exists for OPD triage').toBe(true);

    const postBody = vitals.slice(postIndex, postIndex + 1600);
    expect(
      postBody.includes('admissionId') && postBody.includes('encounterId'),
      'observation writes require an admission or encounter',
    ).toBe(true);
    expect(
      postBody.includes('recordObservationForEncounterScoped'),
      'OPD triage observations route through the scoped encounter path',
    ).toBe(true);
  });

  it('Ui Wiring', async () => {
    const inpatient = readRepoFile('src/components/modules/InpatientModule.tsx');
    expect(
      inpatient.includes("from './NursingPanel.tsx'"),
      'inpatient module imports the nursing panel',
    ).toBe(true);
    expect(inpatient.includes('<NursingPanel'), 'nursing panel is mounted on the ward screen').toBe(
      true,
    );
    expect(inpatient.includes('getInpatientBoard'), 'ward screen loads the nursing board').toBe(
      true,
    );

    const dashboard = readRepoFile('src/components/modules/DashboardModule.tsx');
    expect(dashboard.includes('getInpatientBoard'), 'dashboard reads the inpatient board').toBe(
      true,
    );
    /*
     * The redesign renamed the panel "Ward round"; the nursing columns
     * must still be rendered, so assert the table itself, not the old
     * heading alone.
     */
    expect(dashboard.includes('Ward round'), 'dashboard renders the ward nursing section').toBe(
      true,
    );
    for (const column of ['Last vitals', 'Notes today', 'Ward / bed']) {
      expect(dashboard.includes(column), `dashboard ward table keeps the "${column}" column`).toBe(
        true,
      );
    }
    expect(
      dashboard.includes('vitalsOverdueCount'),
      'dashboard surfaces the vitals-overdue KPI',
    ).toBe(true);

    const panel = readRepoFile('src/components/modules/NursingPanel.tsx');
    for (const tab of ['Vitals', 'Notes', 'Handover']) {
      expect(panel.includes(tab), `nursing panel has a ${tab} tab`).toBe(true);
    }
    expect(panel.includes('getShiftHandover'), 'nursing panel reads the shift handover').toBe(true);
    expect(panel.includes('recordWardVitals'), 'nursing panel records ward vitals').toBe(true);
  });

  it('cross-section checks', async () => {
    expect(VITALS_REFERENCE.spo2Percent.min, 'SpO2 reference minimum').toBe(94);
  });
});
