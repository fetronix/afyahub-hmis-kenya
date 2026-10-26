/**
 * JaliCare HMIS
 * Maternity / MCH contracts
 *
 * Pure functions and vocabularies. Nothing here touches the database, so
 * every rule below can be tested without one.
 *
 * The clinical conventions encoded here are deliberately narrow:
 *
 *   - an EDD from LMP is LMP + 280 days (Naegele's rule, 40 weeks);
 *   - gestation at a date is measured backwards from the EDD, because the
 *     EDD is what the record carries and the LMP may be unknown;
 *   - the partograph alert line starts at 4 cm and runs at 1 cm per hour,
 *     with the action line four hours to its right. This module reports
 *     which side of those lines a reading falls on. It does not tell a
 *     clinician what to do, and it does not raise an obstetric emergency
 *     on its own.
 */

/* ============================================================
   VOCABULARIES
   ============================================================ */

export const PREGNANCY_STATUSES = ['Active', 'Delivered', 'Closed', 'Transferred'] as const;

export type PregnancyStatus = (typeof PREGNANCY_STATUSES)[number];

export const EDD_BASES = ['LMP', 'Ultrasound', 'Other'] as const;

export const LABOUR_STATUSES = ['In Labour', 'Delivered', 'Referred', 'Closed'] as const;

export const DELIVERY_MODES = [
  'Spontaneous Vertex',
  'Assisted Vaginal',
  'Breech',
  'Vacuum',
  'Forceps',
  'Caesarean Section',
] as const;

export const BABY_OUTCOMES = [
  'Live Birth',
  'Stillbirth Fresh',
  'Stillbirth Macerated',
  'Neonatal Death',
] as const;

export const BABY_SEXES = ['Male', 'Female', 'Ambiguous', 'Not recorded'] as const;

export const MEMBRANES = ['Intact', 'Ruptured'] as const;

export const LIQUORS = [
  'Clear',
  'Meconium I',
  'Meconium II',
  'Meconium III',
  'Bloody',
  'Absent',
] as const;

export const URINE_DIPSTICK = ['Negative', 'Trace', '+', '++', '+++'] as const;

export const PERINEUM_STATES = [
  'Intact',
  '1st Degree',
  '2nd Degree',
  '3rd Degree',
  '4th Degree',
  'Episiotomy',
] as const;

export const INVOLUTION = ['Normal', 'Subinvolution', 'Not examined'] as const;

export const LOCHIA = ['Rubra', 'Serosa', 'Alba', 'Abnormal', 'Not examined'] as const;

export const POSTPARTUM_PERINEUM = [
  'Intact',
  'Healing',
  'Infected',
  'Dehisced',
  'Episiotomy healing',
  'Not examined',
] as const;

export const BREASTS = ['Normal', 'Engorged', 'Cracked nipples', 'Mastitis'] as const;

export const BREASTFEEDING = ['Exclusive', 'Mixed', 'Formula', 'Not breastfeeding'] as const;

export const MOOD_SCREENING = ['Not screened', 'No concern', 'Concern — referred'] as const;

export const PRESENTATIONS = [
  'Cephalic',
  'Breech',
  'Transverse',
  'Oblique',
  'Compound',
  'Not recorded',
] as const;

/* ============================================================
   DATES
   ============================================================ */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True only for a real calendar date in YYYY-MM-DD. 2026-02-30 is false. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const match = ISO_DATE.exec(value.trim());

  if (!match) return false;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

function toUtcDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  if (!isIsoDate(iso)) throw new Error(`Not an ISO date: ${iso}`);

  const date = toUtcDate(iso);
  date.setUTCDate(date.getUTCDate() + days);

  return toIso(date);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new Error('daysBetween needs two ISO dates');
  }

  const millis = toUtcDate(to).getTime() - toUtcDate(from).getTime();

  return Math.round(millis / 86_400_000);
}

/** 40 weeks from the last menstrual period. */
export const GESTATION_DAYS = 280;

export function deriveEdd(lmp: string): string {
  return addDays(lmp, GESTATION_DAYS);
}

export type Gestation = {
  totalDays: number;
  weeks: number;
  days: number;
};

/**
 * Gestation on a given date, measured from the EDD.
 *
 * Returns null when the result would be nonsense — a date more than a
 * year before or after the EDD — rather than a negative number dressed
 * up as a week count.
 */
export function gestationAt(edd: string, on: string): Gestation | null {
  if (!isIsoDate(edd) || !isIsoDate(on)) return null;

  const totalDays = GESTATION_DAYS - daysBetween(on, edd);

  if (totalDays < -31 || totalDays > GESTATION_DAYS + 31) return null;
  if (totalDays < 0) return null;

  return {
    totalDays,
    weeks: Math.floor(totalDays / 7),
    days: totalDays % 7,
  };
}

export function formatGestation(weeks: number, days: number): string {
  return `${weeks}w ${days}d`;
}

/* ============================================================
   VALIDATION
   ============================================================ */

export type FieldError = { field: string; message: string };

/**
 * A number inside an inclusive range, or null when the value is absent.
 * Absent is not zero: a missing fundal height must stay missing.
 */
export function numberInRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
  unit = '',
): { value: number | null; error?: FieldError } {
  if (value === undefined || value === null || value === '') {
    return { value: null };
  }

  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return {
      value: null,
      error: { field, message: `${field} must be a number.` },
    };
  }

  if (parsed < min || parsed > max) {
    return {
      value: null,
      error: {
        field,
        message: `${field} must be between ${min} and ${max}${unit ? ` ${unit}` : ''}.`,
      },
    };
  }

  return { value: parsed };
}

export function oneOf<T extends readonly string[]>(
  value: unknown,
  field: string,
  allowed: T,
): { value: T[number] | null; error?: FieldError } {
  if (value === undefined || value === null || value === '') {
    return { value: null };
  }

  if (typeof value !== 'string' || !allowed.includes(value)) {
    return {
      value: null,
      error: {
        field,
        message: `${field} must be one of: ${allowed.join(', ')}.`,
      },
    };
  }

  return { value: value as T[number] };
}

/* ============================================================
   PARTOGRAPH PLOT
   ============================================================ */

export type PlottedReading = {
  recordedAt: string;
  hoursSinceAdmission: number;
  dilatationCm: number | null;
  fetalHeartRateBpm: number | null;
  contractionsPer10Min: number | null;
  contractionDurationSec: number | null;
};

export type PlotLine = {
  /** Hours since admission where the line starts and ends. */
  startHour: number;
  endHour: number;
  startCm: number;
  endCm: number;
};

export type PartographPlot = {
  readings: PlottedReading[];
  /** Null until a reading reaches 4 cm. */
  alertLine: PlotLine | null;
  actionLine: PlotLine | null;
  /** Furthest plotted hour, for the x axis. At least 12 to keep the sheet. */
  maxHour: number;
  zone: PartographZone;
  note: string;
};

/**
 * Turns stored readings into the geometry a partograph chart needs.
 *
 * The x axis is hours since admission, because that is how the sheet is
 * read. The alert line begins at the reading that first reaches 4 cm and
 * climbs 1 cm per hour to 10 cm; the action line is the same line four
 * hours to its right. Nothing is extrapolated beyond the last reading —
 * an empty right-hand side of the chart means no readings, not a stall.
 */
export function buildPartographPlot(
  admittedAt: string,
  readings: Array<{
    recordedAt: string;
    cervicalDilatationCm: number | string | null;
    fetalHeartRateBpm?: number | null;
    contractionsPer10Min?: number | null;
    contractionDurationSec?: number | null;
  }>,
): PartographPlot {
  const admission = new Date(admittedAt).getTime();

  const plotted: PlottedReading[] = readings
    .map((reading) => {
      const at = new Date(reading.recordedAt).getTime();

      const raw =
        reading.cervicalDilatationCm === null ||
        reading.cervicalDilatationCm === undefined ||
        reading.cervicalDilatationCm === ''
          ? null
          : Number(reading.cervicalDilatationCm);

      return {
        recordedAt: reading.recordedAt,
        hoursSinceAdmission:
          Number.isFinite(at) && Number.isFinite(admission)
            ? Math.round(((at - admission) / 3_600_000) * 100) / 100
            : 0,
        dilatationCm: Number.isFinite(raw) ? raw : null,
        fetalHeartRateBpm: reading.fetalHeartRateBpm ?? null,
        contractionsPer10Min: reading.contractionsPer10Min ?? null,
        contractionDurationSec: reading.contractionDurationSec ?? null,
      };
    })
    .sort((a, b) => a.hoursSinceAdmission - b.hoursSinceAdmission);

  const atFour = plotted.find((point) => (point.dilatationCm ?? 0) >= 4);

  let alertLine: PlotLine | null = null;

  if (atFour) {
    const startCm = 4;
    const hoursToTen = 10 - startCm;

    alertLine = {
      startHour: atFour.hoursSinceAdmission,
      endHour: atFour.hoursSinceAdmission + hoursToTen,
      startCm,
      endCm: 10,
    };
  }

  const actionLine: PlotLine | null = alertLine
    ? {
        startHour: alertLine.startHour + 4,
        endHour: alertLine.endHour + 4,
        startCm: alertLine.startCm,
        endCm: alertLine.endCm,
      }
    : null;

  const lastHour = plotted.at(-1)?.hoursSinceAdmission ?? 0;

  /*
   * The axis has to reach the end of the action line, not just the last
   * reading: a chart that crops its own action line is worse than no
   * chart, because the line simply appears to stop.
   */
  const lineEnd = actionLine?.endHour ?? alertLine?.endHour ?? 0;

  const guidance = partographGuidance(
    plotted.map((point) => ({
      recordedAt: point.recordedAt,
      cervicalDilatationCm: point.dilatationCm,
    })),
  );

  return {
    readings: plotted,
    alertLine,
    actionLine,
    maxHour: Math.max(12, Math.ceil(Math.max(lastHour, lineEnd)) + 1),
    zone: guidance.zone,
    note: guidance.note,
  };
}

/* ============================================================
   PARTOGRAPH
   ============================================================ */

export type PartographReading = {
  recordedAt: string;
  cervicalDilatationCm: number | null;
};

export type PartographZone =
  | 'Too few readings'
  | 'On or left of the alert line'
  | 'Between the alert and action lines'
  | 'Right of the action line';

export type PartographGuidance = {
  zone: PartographZone;
  hoursSinceFourCm: number | null;
  dilatationCm: number | null;
  /** Hours of labour beyond the alert line at the latest reading. */
  hoursBeyondAlert: number | null;
  note: string;
};

/**
 * Where the latest plotted point sits relative to the alert and action
 * lines.
 *
 * The alert line starts where labour is recorded at 4 cm and advances
 * 1 cm per hour; the action line is the same line four hours later. A
 * reading to the right of the alert line means labour is slower than the
 * reference curve — a fact about the plot, not a diagnosis.
 */
export function partographGuidance(readings: PartographReading[]): PartographGuidance {
  const plotted = readings
    .filter(
      (reading): reading is { recordedAt: string; cervicalDilatationCm: number } =>
        Number.isFinite(reading.cervicalDilatationCm) && reading.cervicalDilatationCm !== null,
    )
    .slice()
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  const note =
    'A plotting aid only. It compares the recorded dilatation with the reference curve and does not recommend an intervention.';

  if (plotted.length < 2) {
    return {
      zone: 'Too few readings',
      hoursSinceFourCm: null,
      dilatationCm: plotted.at(-1)?.cervicalDilatationCm ?? null,
      hoursBeyondAlert: null,
      note,
    };
  }

  const entryToFourCm = plotted.find((reading) => reading.cervicalDilatationCm >= 4);

  if (!entryToFourCm) {
    return {
      zone: 'Too few readings',
      hoursSinceFourCm: null,
      dilatationCm: plotted.at(-1)!.cervicalDilatationCm,
      hoursBeyondAlert: null,
      note,
    };
  }

  const latest = plotted.at(-1)!;

  const hoursSinceFourCm =
    (new Date(latest.recordedAt).getTime() - new Date(entryToFourCm.recordedAt).getTime()) /
    3_600_000;

  if (!Number.isFinite(hoursSinceFourCm) || hoursSinceFourCm < 0) {
    return {
      zone: 'Too few readings',
      hoursSinceFourCm: null,
      dilatationCm: latest.cervicalDilatationCm,
      hoursBeyondAlert: null,
      note,
    };
  }

  const expectedCm = 4 + hoursSinceFourCm;
  const hoursBeyondAlert =
    expectedCm - latest.cervicalDilatationCm > 0 ? expectedCm - latest.cervicalDilatationCm : 0;

  let zone: PartographZone = 'On or left of the alert line';

  if (hoursBeyondAlert > 0 && hoursBeyondAlert <= 4) {
    zone = 'Between the alert and action lines';
  } else if (hoursBeyondAlert > 4) {
    zone = 'Right of the action line';
  }

  return {
    zone,
    hoursSinceFourCm: Math.round(hoursSinceFourCm * 10) / 10,
    dilatationCm: latest.cervicalDilatationCm,
    hoursBeyondAlert: Math.round(hoursBeyondAlert * 10) / 10,
    note,
  };
}
