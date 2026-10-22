/**
 * JaliCare HMIS
 * Facility module catalogue
 *
 * `facilities.enabled_modules` decides two separate things:
 *
 *   1. what the navigation rail draws, and
 *   2. whether the server answers a module's API at all
 *      (`src/middleware/facility-module.middleware.ts`).
 *
 * Because of (2) this list is a contract, not a display preference. It
 * lives here with no imports so the browser can render the switches
 * from the same list the server validates against.
 */

export interface FacilityModuleDefinition {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly description: string;
  /**
   * Always-on modules cannot be switched off. Configuration is one:
   * a facility administrator who turned it off would lose the only
   * screen that can turn it back on.
   */
  readonly alwaysOn?: boolean;
}

export const FACILITY_MODULES: readonly FacilityModuleDefinition[] = Object.freeze([
  {
    id: 'registration',
    label: 'Patient registration',
    group: 'Front desk',
    description: 'Register patients, issue MRNs and maintain identifiers.',
  },
  {
    id: 'reception',
    label: 'Reception & queue',
    group: 'Front desk',
    description: 'Check patients in and route them to a service point.',
  },
  {
    id: 'opd',
    label: 'Outpatient & triage',
    group: 'Clinical care',
    description: 'Triage, consultations and the outpatient journey.',
  },
  {
    id: 'inpatient',
    label: 'Inpatient & wards',
    group: 'Clinical care',
    description: 'Admissions, wards, beds and transfers.',
  },
  {
    id: 'maternity',
    label: 'Maternity & MCH',
    group: 'Clinical care',
    description:
      'Antenatal register, labour partograph, deliveries, postnatal care and immunisation.',
  },
  {
    id: 'theatre',
    label: 'Operating theatre',
    group: 'Clinical care',
    description: 'Theatre lists, procedures and recovery.',
  },
  {
    id: 'specialty',
    label: 'Specialty clinics',
    group: 'Clinical care',
    description: 'Specialist clinics and follow-up visits.',
  },
  {
    id: 'laboratory',
    label: 'Laboratory',
    group: 'Diagnostics',
    description: 'Orders, specimens, results and pathology.',
  },
  {
    id: 'radiology',
    label: 'Radiology & imaging',
    group: 'Diagnostics',
    description: 'Imaging requests, studies and reports.',
  },
  {
    id: 'pharmacy',
    label: 'Pharmacy',
    group: 'Pharmacy & supplies',
    description: 'Dispensing, stock batches and prescriptions.',
  },
  {
    id: 'inventory',
    label: 'Inventory & batches',
    group: 'Pharmacy & supplies',
    description: 'Stores, stock levels, batches and expiry.',
  },
  {
    id: 'procurement',
    label: 'Procurement',
    group: 'Pharmacy & supplies',
    description: 'Suppliers, purchase orders and goods received.',
  },
  {
    id: 'finance',
    label: 'Billing & cashier',
    group: 'Revenue & payers',
    description: 'Invoices, payments, cashiering and reconciliation.',
  },
  {
    id: 'insurance',
    label: 'SHA & e-claims',
    group: 'Revenue & payers',
    description: 'Insurance payers, claims and pre-authorisation.',
  },
  {
    id: 'public_health',
    label: 'MOH surveillance',
    group: 'Intelligence & DHA',
    description: 'Public health indicators and MOH reporting.',
  },
  {
    id: 'analytics',
    label: 'Reports & revenue',
    group: 'Intelligence & DHA',
    description: 'Operational reports and revenue analytics.',
  },
  {
    id: 'interoperability',
    label: 'DHA readiness & FHIR',
    group: 'Intelligence & DHA',
    description: 'Registry readiness and FHIR interoperability.',
  },
  {
    id: 'configuration',
    label: 'System configuration',
    group: 'Administration',
    description:
      'Facility profile, module provisioning, tariffs and staff. Always available to administrators.',
    alwaysOn: true,
  },
  {
    id: 'patient_portal',
    label: 'Patient portal management',
    group: 'Administration',
    description:
      'Invitations, patient accounts, portal policy and portal audit oversight.',
  },
  {
    id: 'audit',
    label: 'Audit trail & security',
    group: 'Administration',
    description: 'Audit logs and security events.',
  },
]);

export const FACILITY_MODULE_IDS: readonly string[] = Object.freeze(
  FACILITY_MODULES.map((module) => module.id),
);

const KNOWN_MODULES = new Set<string>(FACILITY_MODULE_IDS);

/** Modules that can never be switched off. */
export const ALWAYS_ENABLED_MODULES: readonly string[] = Object.freeze(
  FACILITY_MODULES.filter((module) => module.alwaysOn).map((module) => module.id),
);

export function isKnownFacilityModule(id: string): boolean {
  return KNOWN_MODULES.has(id);
}

export function isAlwaysEnabledModule(id: string): boolean {
  return ALWAYS_ENABLED_MODULES.includes(id);
}

/** Ids present in `input` that this build does not know about. */
export function unknownFacilityModules(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const unknown = new Set<string>();

  for (const value of input) {
    if (typeof value === 'string' && value.trim().length > 0) {
      const id = value.trim();
      if (!isKnownFacilityModule(id)) unknown.add(id);
    }
  }

  return [...unknown];
}

/**
 * Turns a persisted list into the list the UI should show: known ids
 * only, de-duplicated, in catalogue order, with always-on modules
 * forced on. Unknown strings in an old database row are dropped here
 * (the write path rejects them instead).
 */
export function resolveFacilityModules(input: unknown): string[] {
  const requested = new Set<string>();

  if (Array.isArray(input)) {
    for (const value of input) {
      if (typeof value === 'string' && isKnownFacilityModule(value.trim())) {
        requested.add(value.trim());
      }
    }
  }

  for (const id of ALWAYS_ENABLED_MODULES) requested.add(id);

  return FACILITY_MODULE_IDS.filter((id) => requested.has(id));
}
