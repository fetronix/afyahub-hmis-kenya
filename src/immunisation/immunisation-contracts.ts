/**
 * JaliCare HMIS
 * Immunisation schedule and due-date logic
 *
 * The schedule lives in code, not in the database, for one reason: a
 * schedule is a policy that changes, and a record of what was given must
 * not change with it. `immunisation_records` stores the antigen, the dose
 * number and the date; this file says what those mean and when the next
 * dose is expected.
 *
 * THE AGES BELOW ARE A REFERENCE, NOT A MANDATE.
 *
 * They follow the Kenya Expanded Programme on Immunization ages that are
 * in common use. Facilities must confirm them against the current KEPI
 * chart before treating the "due" and "overdue" columns as authoritative.
 * Nothing in the application refuses a dose because this table says it is
 * early, and nothing marks a child as unimmunised because a dose is
 * missing from this list.
 */

export type Antigen = {
  code: string;
  name: string;
  /** Age at which the dose is scheduled, in weeks from birth. */
  weeks: number;
  doses: number;
  route: 'Intradermal' | 'Subcutaneous' | 'Intramuscular' | 'Oral';
  /** Shown next to the antigen in the register. */
  note?: string;
};

export const ANTIGENS: Antigen[] = [
  { code: 'BCG', name: 'BCG', weeks: 0, doses: 1, route: 'Intradermal', note: 'At birth' },
  { code: 'OPV-0', name: 'OPV 0', weeks: 0, doses: 1, route: 'Oral', note: 'At birth' },
  { code: 'OPV-1', name: 'OPV 1', weeks: 6, doses: 1, route: 'Oral' },
  { code: 'OPV-2', name: 'OPV 2', weeks: 10, doses: 1, route: 'Oral' },
  { code: 'OPV-3', name: 'OPV 3', weeks: 14, doses: 1, route: 'Oral' },
  { code: 'PENTA-1', name: 'Pentavalent 1', weeks: 6, doses: 1, route: 'Intramuscular' },
  { code: 'PENTA-2', name: 'Pentavalent 2', weeks: 10, doses: 1, route: 'Intramuscular' },
  { code: 'PENTA-3', name: 'Pentavalent 3', weeks: 14, doses: 1, route: 'Intramuscular' },
  { code: 'PCV-1', name: 'PCV 1', weeks: 6, doses: 1, route: 'Intramuscular' },
  { code: 'PCV-2', name: 'PCV 2', weeks: 10, doses: 1, route: 'Intramuscular' },
  { code: 'PCV-3', name: 'PCV 3', weeks: 14, doses: 1, route: 'Intramuscular' },
  { code: 'ROTA-1', name: 'Rotavirus 1', weeks: 6, doses: 1, route: 'Oral' },
  { code: 'ROTA-2', name: 'Rotavirus 2', weeks: 10, doses: 1, route: 'Oral' },
  { code: 'IPV', name: 'IPV', weeks: 14, doses: 1, route: 'Intramuscular' },
  { code: 'MR-1', name: 'Measles-Rubella 1', weeks: 39, doses: 1, route: 'Subcutaneous', note: '9 months' },
  { code: 'MR-2', name: 'Measles-Rubella 2', weeks: 78, doses: 1, route: 'Subcutaneous', note: '18 months' },
  { code: 'YF', name: 'Yellow fever', weeks: 39, doses: 1, route: 'Subcutaneous', note: '9 months, endemic counties' },
  { code: 'HPV-1', name: 'HPV 1', weeks: 520, doses: 1, route: 'Intramuscular', note: 'Girls, 10 years' },
  { code: 'HPV-2', name: 'HPV 2', weeks: 546, doses: 1, route: 'Intramuscular', note: 'Girls, 10 years, second dose' },
];

export const ANTIGEN_BY_CODE = new Map(ANTIGENS.map((antigen) => [antigen.code, antigen]));

export const SCHEDULE_AGREES_NOTE =
  'Dose ages follow the KEPI reference schedule held in code. Confirm them against the current KEPI chart before relying on the due and overdue columns.';

/** Age in completed weeks between a date of birth and a date. */
export function ageInWeeks(dateOfBirth: string, on: string): number {
  const born = Date.parse(`${dateOfBirth}T00:00:00Z`);
  const today = Date.parse(`${on}T00:00:00Z`);

  if (!Number.isFinite(born) || !Number.isFinite(today)) return Number.NaN;

  return Math.floor((today - born) / (7 * 86_400_000));
}

export type DoseStatus = {
  antigenCode: string;
  name: string;
  scheduledWeeks: number;
  route: string;
  note?: string;

  /** Recorded doses of this antigen for this child. */
  givenOn: string | null;

  status: 'Given' | 'Due' | 'Overdue' | 'Not yet due';
};

/**
 * The full schedule for one child, with what has been given.
 *
 * "Overdue" means four weeks or more past the scheduled age. Before that
 * the dose is "Due" — a child seen a fortnight late is late, not overdue,
 * and a list that shouts at every late attendance stops being read.
 */
export function immunisationStatus(
  dateOfBirth: string,
  on: string,
  records: Array<{ antigenCode: string; administeredOn: string }>,
): DoseStatus[] {
  const weeks = ageInWeeks(dateOfBirth, on);

  return ANTIGENS.map((antigen) => {
    const given = records.find((record) => record.antigenCode === antigen.code);

    let status: DoseStatus['status'];

    if (given) status = 'Given';
    else if (!Number.isFinite(weeks)) status = 'Not yet due';
    else if (weeks >= antigen.weeks + 4) status = 'Overdue';
    else if (weeks >= antigen.weeks) status = 'Due';
    else status = 'Not yet due';

    return {
      antigenCode: antigen.code,
      name: antigen.name,
      scheduledWeeks: antigen.weeks,
      route: antigen.route,
      note: antigen.note,
      givenOn: given?.administeredOn ?? null,
      status,
    };
  });
}

/** Only the doses worth acting on today, of which there are usually few. */
export function outstandingDoses(statuses: DoseStatus[]): DoseStatus[] {
  return statuses.filter(
    (dose) => dose.status === 'Due' || dose.status === 'Overdue',
  );
}
