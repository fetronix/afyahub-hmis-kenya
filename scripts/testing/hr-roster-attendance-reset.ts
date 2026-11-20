/**
 * Clears one synthetic day of roster and attendance data.
 *
 * The browser evidence run clocks the same two synthetic employees in and out,
 * so a second run on the same day would find them already clocked. This script
 * removes that day's roster assignments, attendance rows and corrections for
 * the synthetic facility only. Shift definitions are kept: they are templates,
 * not occurrences.
 *
 * SAFETY
 * ------
 * - Refuses to run with NODE_ENV=production.
 * - Refuses without SYNTHETIC_HR_CONFIRM=yes.
 * - Refuses unless the facility's code is exactly SYNTH-HR-01.
 * - Only deletes rows for one date; it never truncates a table.
 */
import 'dotenv/config';
import { and, eq, inArray } from 'drizzle-orm';

import { db, pool } from '../../src/db/index.ts';
import * as schema from '../../src/db/schema.ts';

const SLUG = 'syrona-hr-synthetic';
const FACILITY_CODE = 'SYNTH-HR-01';

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('The synthetic reset refuses to run with NODE_ENV=production.');
  if (process.env.SYNTHETIC_HR_CONFIRM !== 'yes')
    throw new Error('Set SYNTHETIC_HR_CONFIRM=yes to confirm this is a synthetic database.');

  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, SLUG))
    .limit(1);
  if (!tenant) throw new Error(`Tenant ${SLUG} not found.`);
  const [facility] = await db
    .select()
    .from(schema.facilities)
    .where(
      and(eq(schema.facilities.tenantId, tenant.id), eq(schema.facilities.code, FACILITY_CODE)),
    )
    .limit(1);
  if (!facility) throw new Error(`Facility ${FACILITY_CODE} not found.`);
  if (facility.code !== FACILITY_CODE) throw new Error('Refusing to touch a non-synthetic facility.');

  const zone = process.env.SYNTH_TIME_ZONE ?? 'Africa/Nairobi';
  const date =
    process.env.SYNTH_DATE ??
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

  const attendance = await db
    .select({ id: schema.hrAttendance.id })
    .from(schema.hrAttendance)
    .where(
      and(
        eq(schema.hrAttendance.facilityId, facility.id),
        eq(schema.hrAttendance.workDate, date),
      ),
    );
  const attendanceIds = attendance.map((row) => row.id);
  if (attendanceIds.length) {
    await db
      .delete(schema.hrAttendanceCorrections)
      .where(inArray(schema.hrAttendanceCorrections.attendanceId, attendanceIds));
    await db.delete(schema.hrAttendance).where(inArray(schema.hrAttendance.id, attendanceIds));
  }
  const roster = await db
    .delete(schema.hrRosterEntries)
    .where(
      and(
        eq(schema.hrRosterEntries.facilityId, facility.id),
        eq(schema.hrRosterEntries.workDate, date),
      ),
    )
    .returning({ id: schema.hrRosterEntries.id });

  console.log(
    JSON.stringify(
      {
        facility: facility.code,
        date,
        deleted: {
          attendance: attendanceIds.length,
          corrections: attendanceIds.length ? 'all for those records' : 0,
          rosterEntries: roster.length,
        },
      },
      null,
      2,
    ),
  );
  await pool.end();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
