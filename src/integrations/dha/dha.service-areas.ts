/**
 * JaliCare HMIS
 * DHA / AfyaConnect — service area mapping
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * DHA adjudicates CLAIM LINES against INTERVENTION CODES. This HMIS bills
 * against its own tariff catalogue. Something has to connect the two, and
 * that something cannot be a guess: an invented intervention code is a
 * rejected claim and, worse, a false statement to the authority.
 *
 * So the connection is configuration, not inference:
 *
 *   1. Each billable line carries a provenance (`billing_items.source_type`).
 *   2. Provenance resolves to one of the eight service areas below.
 *   3. An administrator records, per facility, which intervention code
 *      covers that service area — copied from the patient's actual
 *      intervention list in the DHA portal.
 *   4. Until step 3 is done, the line is reported as UNMAPPED rather than
 *      priced, claimed or quietly dropped.
 *
 * This file contains no intervention codes. It cannot: the codes belong
 * to DHA, and the only authoritative copy is the beneficiary's own
 * intervention list returned by /patients/benefits/interventions.
 *
 * The attributes that DO come from the documented contract — access point
 * (IP/OP), payment mechanism (PER_DIEM/FEE_FOR_SERVICE), the preauth
 * requirement, and the fund — are recorded here as the values the DHA
 * portal reports for that intervention. They are captured per facility
 * alongside the code so that a claim can be assembled without a second
 * round trip.
 */

export type DhaAccessPoint = 'OP' | 'IP';

export type DhaPaymentMechanism = 'PER_DIEM' | 'FEE_FOR_SERVICE';

export type DhaFund = 'SHIF' | 'UHC' | 'ECCIF';

export type DhaServiceAreaId =
  | 'outpatient_consultation'
  | 'inpatient_admission'
  | 'laboratory'
  | 'pharmacy'
  | 'imaging'
  | 'theatre_procedure'
  | 'maternity'
  | 'emergency';

export interface DhaServiceAreaDefinition {
  id: DhaServiceAreaId;
  label: string;
  /** Where the service is delivered, per the documented access_point enum. */
  accessPoint: DhaAccessPoint;
  /** How DHA pays for it, per the documented paymentMechanism enum. */
  paymentMechanism: DhaPaymentMechanism;
  /** Fund that typically carries it. The beneficiary's own record wins. */
  fund: DhaFund;
  /**
   * Whether the documented flow requires authorisation before the service
   * is delivered. The intervention's own `needsPreauth` flag is
   * authoritative; this is only the expectation to check against.
   */
  expectsPreauth: boolean;
  /** `billing_items.source_type` values that resolve here. */
  sourceTypes: string[];
  /** Facility departments that resolve here when provenance is absent. */
  departments: string[];
  /** Plain-language note shown to administrators. */
  note: string;
}

/**
 * The eight service areas the integration has to cover.
 *
 * `expectsPreauth` reflects the documented decision matrix: elective
 * inpatient work, theatre and maternity require authorisation, while an
 * emergency presentation may be submitted within 24 hours and may even
 * precede identification (ECCIF).
 */
export const DHA_SERVICE_AREAS: DhaServiceAreaDefinition[] = [
  {
    id: 'outpatient_consultation',
    label: 'Outpatient consultation and follow-up',
    accessPoint: 'OP',
    paymentMechanism: 'FEE_FOR_SERVICE',
    fund: 'SHIF',
    expectsPreauth: false,
    sourceTypes: ['CONSULTATION'],
    departments: ['opd', 'reception', 'registration'],
    note: 'Fee-for-service. The intervention code is per consultation type, so a facility will normally map more than one code across this area.',
  },
  {
    id: 'inpatient_admission',
    label: 'Inpatient admission and daily care',
    accessPoint: 'IP',
    paymentMechanism: 'PER_DIEM',
    fund: 'SHIF',
    expectsPreauth: true,
    sourceTypes: ['ADMISSION', 'BED_DAY'],
    departments: ['inpatient'],
    note: 'Paid per diem against the admission, not per calendar day of the invoice. The per-diem rate comes from the intervention, never from the tariff.',
  },
  {
    id: 'laboratory',
    label: 'Laboratory',
    accessPoint: 'OP',
    paymentMechanism: 'FEE_FOR_SERVICE',
    fund: 'SHIF',
    expectsPreauth: false,
    sourceTypes: ['LAB_ORDER'],
    departments: ['laboratory'],
    note: 'Access point follows the encounter: an inpatient lab order is still billed against the admission. Confirm the intervention before claiming.',
  },
  {
    id: 'pharmacy',
    label: 'Pharmacy and dispensing',
    accessPoint: 'OP',
    paymentMechanism: 'FEE_FOR_SERVICE',
    fund: 'SHIF',
    expectsPreauth: false,
    sourceTypes: ['PHARMACY'],
    departments: ['pharmacy'],
    note: 'Billed per dispensed item at the facility tariff. A medicine that is not on the mapped intervention is simply not claimable.',
  },
  {
    id: 'imaging',
    label: 'Imaging and radiology',
    accessPoint: 'OP',
    paymentMechanism: 'FEE_FOR_SERVICE',
    fund: 'SHIF',
    expectsPreauth: false,
    sourceTypes: ['RADIOLOGY'],
    departments: ['radiology'],
    note: 'Advanced imaging is commonly restricted by benefit limits. Read the utilisation balance before promising the patient cover.',
  },
  {
    id: 'theatre_procedure',
    label: 'Procedures and theatre',
    accessPoint: 'IP',
    paymentMechanism: 'FEE_FOR_SERVICE',
    fund: 'SHIF',
    expectsPreauth: true,
    sourceTypes: ['PROCEDURE'],
    departments: ['theatre', 'specialty'],
    note: 'Authorisation is expected before the procedure. Manual preauthorisation approval is a documented outcome, not an error.',
  },
  {
    id: 'maternity',
    label: 'Maternity',
    accessPoint: 'IP',
    paymentMechanism: 'PER_DIEM',
    fund: 'SHIF',
    expectsPreauth: true,
    sourceTypes: ['ADMISSION', 'BED_DAY', 'PROCEDURE'],
    departments: ['maternity'],
    note: 'Delivery and antenatal packages carry their own interventions. Map them separately from general inpatient care.',
  },
  {
    id: 'emergency',
    label: 'Emergency and casualty',
    accessPoint: 'OP',
    paymentMechanism: 'FEE_FOR_SERVICE',
    fund: 'ECCIF',
    expectsPreauth: false,
    sourceTypes: ['CONSULTATION', 'PROCEDURE'],
    departments: ['emergency', 'casualty'],
    note: 'The documented ECCIF flow allows submission within 24 hours and permits treatment before identification is complete. Record the time of presentation.',
  },
];

const AREA_BY_ID = new Map<DhaServiceAreaId, DhaServiceAreaDefinition>(
  DHA_SERVICE_AREAS.map((area) => [area.id, area]),
);

export function getServiceArea(
  id: string | null | undefined,
): DhaServiceAreaDefinition | null {
  if (!id) return null;

  return AREA_BY_ID.get(id as DhaServiceAreaId) ?? null;
}

/**
 * Resolve a billable line to a service area.
 *
 * Provenance wins over the department name: a lab order raised on the ward
 * is still a laboratory charge. The department is the fallback for lines
 * captured by hand.
 */
export function resolveServiceArea(input: {
  sourceType?: string | null;
  department?: string | null;
}): DhaServiceAreaDefinition | null {
  const sourceType = (input.sourceType ?? '').trim().toUpperCase();

  if (sourceType) {
    const matches = DHA_SERVICE_AREAS.filter((area) =>
      area.sourceTypes.includes(sourceType),
    );

    /*
     * CONSULTATION and PROCEDURE each appear in more than one area, so
     * provenance alone cannot decide. Fall through to the department,
     * and if that is silent pick the first area in catalogue order — the
     * caller sees `ambiguous` and must confirm.
     */
    if (matches.length === 1) return matches[0];

    const department = (input.department ?? '').trim().toLowerCase();

    if (department) {
      const byDepartment = matches.find((area) =>
        area.departments.some(
          (candidate) => candidate === department || department.includes(candidate),
        ),
      );

      if (byDepartment) return byDepartment;
    }

    return matches[0] ?? null;
  }

  const department = (input.department ?? '').trim().toLowerCase();

  if (!department) return null;

  return (
    DHA_SERVICE_AREAS.find((area) =>
      area.departments.some(
        (candidate) => candidate === department || department.includes(candidate),
      ),
    ) ?? null
  );
}

export interface ServiceAreaMapping {
  serviceArea: DhaServiceAreaId;
  /** Copied from the DHA intervention list. Null when not yet configured. */
  interventionCode: string | null;
  accessPoint: DhaAccessPoint | null;
  paymentMechanism: DhaPaymentMechanism | null;
  fund: DhaFund | null;
  needsPreauth: boolean | null;
}

export interface ServiceAreaCoverage {
  serviceArea: DhaServiceAreaId;
  label: string;
  mapped: boolean;
  note: string;
}

/**
 * Which of the eight areas this facility has configured.
 *
 * Used by the readiness report and the mapping screen: an unmapped area is
 * a service the facility cannot yet claim for, and saying so is the whole
 * point of the report.
 */
export function describeServiceAreaCoverage(
  mappings: ServiceAreaMapping[],
): ServiceAreaCoverage[] {
  const configured = new Set(
    mappings
      .filter((mapping) => (mapping.interventionCode ?? '').trim().length > 0)
      .map((mapping) => mapping.serviceArea),
  );

  return DHA_SERVICE_AREAS.map((area) => ({
    serviceArea: area.id,
    label: area.label,
    mapped: configured.has(area.id),
    note: area.note,
  }));
}

/** Areas with no intervention code yet. */
export function unmappedServiceAreas(
  mappings: ServiceAreaMapping[],
): DhaServiceAreaId[] {
  return describeServiceAreaCoverage(mappings)
    .filter((coverage) => !coverage.mapped)
    .map((coverage) => coverage.serviceArea);
}
