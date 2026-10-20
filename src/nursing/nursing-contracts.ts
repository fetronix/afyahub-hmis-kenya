/**
 * JaliCare HMIS
 * Nursing contracts: vital-sign reference ranges and shift definitions.
 *
 * Deliberately free of database imports so the clinical flagging rules
 * can be unit-tested without a PostgreSQL connection.
 */

/* ============================================================
   VITALS ASSESSMENT
   ============================================================ */

/**
 * Adult reference thresholds used to flag a ward observation.
 *
 * These are general adult ranges for triage attention, not a diagnosis
 * and not a substitute for facility protocol or a paediatric chart.
 * Paediatric patients need age-specific ranges, which are not
 * implemented here.
 */
export const VITALS_REFERENCE = Object.freeze({
  systolicBp: { min: 90, max: 140 },
  diastolicBp: { min: 60, max: 90 },
  pulseRate: { min: 60, max: 100 },
  temperatureC: { min: 36.0, max: 37.5 },
  respiratoryRate: { min: 12, max: 20 },
  spo2Percent: { min: 94, max: 100 },
  bloodGlucoseMmol: { min: 3.9, max: 11.1 },
});

export type VitalSeverity = 'warning' | 'critical';

export interface VitalFlag {
  field: string;
  label: string;
  value: number;
  severity: VitalSeverity;
  direction: 'low' | 'high';
}

/**
 * Flag abnormal observations.
 *
 * SpO2 below 90 and systolic below 80 or above 180 are treated as
 * critical because they usually trigger immediate escalation.
 */
export function assessVitals(observation: {
  systolicBp?: number | null;
  diastolicBp?: number | null;
  pulseRate?: number | null;
  temperatureC?: string | number | null;
  respiratoryRate?: number | null;
  spo2Percent?: number | null;
  bloodGlucoseMmol?: string | number | null;
}): VitalFlag[] {
  const flags: VitalFlag[] = [];

  const check = (
    field: keyof typeof VITALS_REFERENCE,
    label: string,
    value: number | null | undefined,
    criticalLow?: number,
    criticalHigh?: number,
  ) => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return;
    }

    const range = VITALS_REFERENCE[field];

    if (value < range.min) {
      const critical = criticalLow !== undefined && value <= criticalLow;

      flags.push({
        field,
        label,
        value,
        direction: 'low',
        severity: critical ? 'critical' : 'warning',
      });
      return;
    }

    if (value > range.max) {
      const critical = criticalHigh !== undefined && value >= criticalHigh;

      flags.push({
        field,
        label,
        value,
        direction: 'high',
        severity: critical ? 'critical' : 'warning',
      });
    }
  };

  const numeric = (value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  check('systolicBp', 'Systolic BP', observation.systolicBp, 80, 180);
  check('diastolicBp', 'Diastolic BP', observation.diastolicBp, 50, 110);
  check('pulseRate', 'Pulse', observation.pulseRate, 45, 130);
  check(
    'temperatureC',
    'Temperature',
    numeric(observation.temperatureC),
    35,
    39.5,
  );
  check(
    'respiratoryRate',
    'Respiratory rate',
    observation.respiratoryRate,
    8,
    30,
  );
  check('spo2Percent', 'SpO2', observation.spo2Percent, 90, undefined);
  check(
    'bloodGlucoseMmol',
    'Blood glucose',
    numeric(observation.bloodGlucoseMmol),
    2.8,
    20,
  );

  /* Rank critical flags first so the UI can surface them immediately. */
  return flags.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1,
  );
}

/**
 * Hours after which a ward patient is considered to need new vitals.
 * A common default is four-hourly observation; eight hours is the
 * escalation threshold used for the "overdue" badge.
 */
export const VITALS_OVERDUE_HOURS = 8;

/* ============================================================
   SHIFTS
   ============================================================ */

export const SHIFT_NAMES = ['Morning', 'Afternoon', 'Night'] as const;
export type ShiftName = (typeof SHIFT_NAMES)[number];

/**
 * Ward shifts, in local server time.
 *
 *   07:00–14:59  Morning
 *   15:00–19:59  Afternoon
 *   20:00–06:59  Night
 *
 * Facilities that run different handover times can pass an explicit
 * shift when recording a note; this function only supplies the default.
 */
export function shiftForHour(hour: number): ShiftName {
  if (hour >= 7 && hour < 15) return 'Morning';
  if (hour >= 15 && hour < 20) return 'Afternoon';
  return 'Night';
}

export function currentShift(now: Date = new Date()): ShiftName {
  return shiftForHour(now.getHours());
}

/** Local date key (YYYY-MM-DD) used to group handover notes. */
export function dateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) return '';

  const pad = (input: number) => String(input).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

