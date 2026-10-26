/**
 * JaliCare HMIS
 * Operational reporting: bed occupancy and length of stay.
 *
 * Every figure here is derived from records the facility already owns —
 * beds, admissions and discharge dates. Nothing is estimated, and a
 * patient with an unparseable admission date is excluded and counted
 * rather than silently treated as a zero-day stay.
 *
 * Tenant and facility scope is enforced by the query helpers in
 * db/queries.ts, which throw when the requested facility falls outside
 * the caller's authorised scope.
 */

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { getAdmissionsScoped, getWardsScoped } from '../db/queries.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';

import { daysBetween, mean, median, parseLooseDate, roundDays } from '../utils/dates.ts';

import {
  bucketStays,
  countOverstays,
  occupancyPercent,
  occupiesBedOn,
  summariseStays,
  type StayBucket,
} from './reporting-contracts.ts';

export type { StayBucket } from './reporting-contracts.ts';

/* ============================================================
   TYPES
   ============================================================ */

export interface WardOccupancyRow {
  wardId: number;
  wardName: string;
  wardType: string | null;
  totalBeds: number;
  occupiedBeds: number;
  availableBeds: number;
  cleaningBeds: number;
  outOfServiceBeds: number;
  occupancyRate: number;
  activeAdmissions: number;
  averageStayDays: number | null;
}

export interface LengthOfStaySummary {
  activeAdmissions: number;
  averageStayDays: number | null;
  medianStayDays: number | null;
  longestStayDays: number | null;
  /** Active stays of seven days or more — the usual discharge-review cue. */
  overstayCount: number;
  /** Admissions whose admission date could not be read. */
  unparseableCount: number;
  dischargedInWindow: number;
  averageDischargedStayDays: number | null;
  medianDischargedStayDays: number | null;
  /** The window used for the discharged figures, in days. */
  dischargedWindowDays: number;
  buckets: StayBucket[];
}

export interface LongestStayRow {
  admissionId: number;
  patientId: number;
  patientName: string;
  wardName: string;
  bedNumber: string | null;
  admissionDate: string;
  days: number;
}

export interface OperationsReport {
  facilityId: number;
  generatedAt: string;
  occupancy: {
    wardCount: number;
    bedCount: number;
    occupiedBeds: number;
    availableBeds: number;
    cleaningBeds: number;
    outOfServiceBeds: number;
    occupancyRate: number;
  };
  wards: WardOccupancyRow[];
  lengthOfStay: LengthOfStaySummary;
  longestStays: LongestStayRow[];
}

/* ============================================================
   HELPERS
   ============================================================ */

const DISCHARGED_WINDOW_DAYS = 30;
const LONGEST_STAY_LIMIT = 10;

/**
 * Beds belonging to already-scoped wards.
 *
 * beds has no facility column — it hangs off the ward — so scoping goes
 * through the ward list. Passing a facility to getBedsScoped would work
 * for a facility user but fail for a platform admin viewing a facility
 * they have no home facility in, which is exactly who reads this report.
 */
async function loadBedsForWards(wardIds: number[]) {
  if (wardIds.length === 0) return [];

  return db
    .select()
    .from(schema.beds)
    .where(inArray(schema.beds.wardId, wardIds))
    .orderBy(schema.beds.bedNumber);
}

/* ============================================================
   REPORT
   ============================================================ */

export async function getOperationsReportScoped(
  context: AuthorizationContext,
  requestedFacilityId?: number | null,
): Promise<OperationsReport> {
  /* Every helper resolves and proves the facility is in scope. */
  const wards = await getWardsScoped(context, requestedFacilityId);
  const admissions = await getAdmissionsScoped(context, requestedFacilityId);
  const beds = await loadBedsForWards(wards.map((ward) => ward.id));

  const facilityId = wards[0]?.facilityId ?? admissions[0]?.facilityId ?? 0;

  const activeAdmissions = admissions.filter((admission) => admission.status === 'Admitted');

  /* Bed counts per ward. getBedsScoped already filters by tenant scope. */
  const bedsByWard = new Map<number, typeof beds>();

  for (const bed of beds) {
    const list = bedsByWard.get(bed.wardId);

    if (list) {
      list.push(bed);
    } else {
      bedsByWard.set(bed.wardId, [bed]);
    }
  }

  const wardNameById = new Map(wards.map((ward) => [ward.id, ward.name]));
  const bedNumberById = new Map(beds.map((bed) => [bed.id, bed.bedNumber]));

  const now = new Date();

  /*
   * Active stays, measured in whole days from admission to now.
   * Rows whose date cannot be read are counted, not assumed to be zero.
   */
  const activeStays: Array<{
    admission: (typeof activeAdmissions)[number];
    days: number;
  }> = [];

  let unparseableCount = 0;

  for (const admission of activeAdmissions) {
    const admittedAt = parseLooseDate(admission.admissionDate);

    if (!admittedAt) {
      unparseableCount += 1;
      continue;
    }

    activeStays.push({ admission, days: daysBetween(admittedAt, now) });
  }

  const activeDays = activeStays.map((stay) => stay.days);

  const buckets = bucketStays(activeDays);
  const stats = summariseStays(activeDays);

  /*
   * Discharged stays over the last 30 days, for the "how long do
   * patients actually stay" figure. Discharges are spread across text
   * dates, so the window is applied after parsing.
   */
  const windowStart = new Date(now.getTime() - DISCHARGED_WINDOW_DAYS * 86_400_000);

  const dischargedDays: number[] = [];

  for (const admission of admissions) {
    if (admission.status !== 'Discharged') continue;

    const admittedAt = parseLooseDate(admission.admissionDate);
    const dischargedAt = parseLooseDate(admission.dischargeDate);

    if (!admittedAt || !dischargedAt) continue;
    if (dischargedAt.getTime() < windowStart.getTime()) continue;

    dischargedDays.push(daysBetween(admittedAt, dischargedAt));
  }

  const activeByWard = new Map<number, number[]>();

  for (const stay of activeStays) {
    const list = activeByWard.get(stay.admission.wardId);

    if (list) {
      list.push(stay.days);
    } else {
      activeByWard.set(stay.admission.wardId, [stay.days]);
    }
  }

  const wardRows: WardOccupancyRow[] = wards
    .map((ward) => {
      const wardBeds = bedsByWard.get(ward.id) ?? [];

      const occupiedBeds = wardBeds.filter((bed) => bed.status === 'Occupied').length;
      const availableBeds = wardBeds.filter((bed) => bed.status === 'Available').length;
      const cleaningBeds = wardBeds.filter((bed) => bed.status === 'Cleaning').length;

      const stays = activeByWard.get(ward.id) ?? [];
      const average = mean(stays);

      return {
        wardId: ward.id,
        wardName: ward.name,
        wardType: ward.wardType ?? null,
        totalBeds: wardBeds.length,
        occupiedBeds,
        availableBeds,
        cleaningBeds,
        outOfServiceBeds: wardBeds.length - occupiedBeds - availableBeds - cleaningBeds,
        occupancyRate: occupancyPercent(occupiedBeds, wardBeds.length),
        activeAdmissions: stays.length,
        averageStayDays: average === null ? null : roundDays(average),
      };
    })
    .sort((a, b) => a.wardName.localeCompare(b.wardName));

  const occupiedBeds = beds.filter((bed) => bed.status === 'Occupied').length;
  const availableBeds = beds.filter((bed) => bed.status === 'Available').length;
  const cleaningBeds = beds.filter((bed) => bed.status === 'Cleaning').length;

  /* Patient names for the longest-stay list only — one query, no N+1. */
  const longest = [...activeStays].sort((a, b) => b.days - a.days).slice(0, LONGEST_STAY_LIMIT);

  const patientIds = [...new Set(longest.map((stay) => stay.admission.patientId))];

  const patientById = new Map<number, string>();

  if (patientIds.length > 0) {
    const rows = await db
      .select({
        id: schema.patients.id,
        firstName: schema.patients.firstName,
        middleName: schema.patients.middleName,
        lastName: schema.patients.lastName,
      })
      .from(schema.patients)
      .where(inArray(schema.patients.id, patientIds));

    for (const row of rows) {
      patientById.set(
        row.id,
        [row.firstName, row.middleName, row.lastName]
          .filter((part): part is string => Boolean(part && part.trim()))
          .join(' '),
      );
    }
  }

  const longestStays: LongestStayRow[] = longest.map((stay) => ({
    admissionId: stay.admission.id,
    patientId: stay.admission.patientId,
    patientName:
      patientById.get(stay.admission.patientId) ?? `Patient #${stay.admission.patientId}`,
    wardName: wardNameById.get(stay.admission.wardId) ?? 'Ward',
    bedNumber: bedNumberById.get(stay.admission.bedId) ?? null,
    admissionDate: stay.admission.admissionDate,
    days: stay.days,
  }));

  return {
    facilityId,
    generatedAt: now.toISOString(),
    occupancy: {
      wardCount: wards.length,
      bedCount: beds.length,
      occupiedBeds,
      availableBeds,
      cleaningBeds,
      outOfServiceBeds: beds.length - occupiedBeds - availableBeds - cleaningBeds,
      occupancyRate: occupancyPercent(occupiedBeds, beds.length),
    },
    wards: wardRows,
    lengthOfStay: {
      activeAdmissions: stats.count,
      averageStayDays: stats.averageDays,
      medianStayDays: stats.medianDays,
      longestStayDays: stats.longestDays,
      overstayCount: countOverstays(activeDays),
      unparseableCount,
      dischargedInWindow: dischargedDays.length,
      averageDischargedStayDays:
        dischargedDays.length === 0 ? null : roundDays(mean(dischargedDays) as number),
      medianDischargedStayDays:
        dischargedDays.length === 0 ? null : roundDays(median(dischargedDays) as number),
      dischargedWindowDays: DISCHARGED_WINDOW_DAYS,
      buckets,
    },
    longestStays,
  };
}

/**
 * Occupancy trend: occupied bed-days per day for the last `days` days.
 *
 * A bed-day is a night a patient spent in a bed, which is also the unit
 * the bed-day charge bills, so the trend reconciles with revenue. Days
 * before an admission began and after it ended are not counted; a
 * same-day admission and discharge still counts as one bed-day, matching
 * the billing rule in billing.service.ts.
 */
export async function getOccupancyTrendScoped(
  context: AuthorizationContext,
  requestedFacilityId?: number | null,
  days = 14,
): Promise<Array<{ date: string; occupiedBeds: number }>> {
  const safeDays = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), 90) : 14;

  const wards = await getWardsScoped(context, requestedFacilityId);

  const [beds, admissions] = await Promise.all([
    loadBedsForWards(wards.map((ward) => ward.id)),
    getAdmissionsScoped(context, requestedFacilityId),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const points: Array<{ date: string; occupiedBeds: number }> = [];

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const day = new Date(today.getTime() - offset * 86_400_000);

    let occupied = 0;

    for (const admission of admissions) {
      const admittedAt = parseLooseDate(admission.admissionDate);

      if (!admittedAt) continue;

      const dischargedAt = parseLooseDate(admission.dischargeDate);

      if (occupiesBedOn(admittedAt, dischargedAt, day)) occupied += 1;
    }

    points.push({
      date: [
        day.getFullYear(),
        String(day.getMonth() + 1).padStart(2, '0'),
        String(day.getDate()).padStart(2, '0'),
      ].join('-'),
      occupiedBeds: Math.min(occupied, Math.max(beds.length, occupied)),
    });
  }

  return points;
}
